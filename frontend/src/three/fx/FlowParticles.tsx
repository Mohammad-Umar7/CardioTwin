import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  DataTexture,
  FloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Float32BufferAttribute,
  Mesh,
  NearestFilter,
  RGBAFormat,
  Sphere,
  Vector2,
  Vector3,
  type Object3D,
} from 'three';
import { useManifest, useSchemaIndex } from '@/hooks/useData';
import { ANTERIOR_SUFFIX, baseNode, isSplitNode, nodeAt } from '../anatomy/cutSplit';
import { heartFrameFrom } from '../anatomy/explode';
import { VESSEL_INFLATE } from '../anatomy/materials';
import { getRiskLUT } from '../riskLut';
import { sceneRuntime } from '../stage/sceneRuntime';
import {
  DEFAULT_STEP,
  buildFlowPaths,
  computeArcLengths,
  packCentrelines,
  type CentrelineFile,
} from './centreline';
import { QUAD_SCALE, STREAK_WIDTH_PX, createFlowMaterial } from './flowMaterial';
import { BASE_FLOW_SPEED, MAX_NODES, MAX_TARGET_SLOTS, fxFrame, slotOf, targetSlots } from './fxState';
import { allocateParticles, mulberry32, particleShares, thinningFactors } from './particles';
import { NodeTracker, restInverses } from './sceneNodes';

/** Particle budget per tier (instances; each is one streak quad). Tier C draws dashes instead. */
export const PARTICLES_BY_TIER = { A: 4096, B: 2048 } as const;
const MAX_PARTICLES = PARTICLES_BY_TIER.A;

const tmpSize = new Vector2();

/** Fisher–Yates with a seeded PRNG: any prefix of the result is a uniform sample of the whole. */
function shuffleInstances(path: Float32Array, seed: Float32Array, count: number) {
  const random = mulberry32(0x5eed);
  for (let i = count - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    for (let c = 0; c < 4; c += 1) {
      [path[4 * i + c], path[4 * j + c]] = [path[4 * j + c]!, path[4 * i + c]!];
      [seed[4 * i + c], seed[4 * j + c]] = [seed[4 * j + c]!, seed[4 * i + c]!];
    }
  }
}

interface FlowParticlesProps {
  /** The pristine glTF scene (rest-pose node transforms; never rendered, never mutated). */
  pristine: Object3D;
  centrelines: CentrelineFile;
  /** Instances to draw this tier (≤ PARTICLES_BY_TIER.A). */
  count: number;
}

/**
 * Coronary blood-flow particles: ONE instanced draw call of streak sprites that run proximal → distal
 * along every ostium-to-tip path of vessels.json, positioned in the vertex shader (flowMaterial.ts) from
 * an arc-length parameterised centreline texture. They follow the anatomy's live node transforms
 * (explode, rides, heartbeat) via NodeTracker, surge in diastole via the cardiac clock and echo each
 * vessel's predicted risk (sparser, slower, warmer). Illustrative only.
 */
export function FlowParticles({ pristine, centrelines, count }: FlowParticlesProps) {
  const scene = useThree((s) => s.scene);
  const schema = useSchemaIndex();
  const targets = targetSlots(schema?.vessels.map((t) => t.id)).join('|');
  const heart = useManifest().data?.heart;

  const built = useMemo(() => {
    // A vessel split at the heart's cut plane (anatomy/cutSplit.ts) rides two scene nodes: its points on the
    // opening side follow `<node>_Anterior` (the anterior half), so the flow opens with the heart.
    const cut = heartFrameFrom(heart);
    const vesselNodes = [...new Set(centrelines.vessels.map((v) => v.node))];
    const nodeNames = [...vesselNodes, ...vesselNodes.filter(isSplitNode).map((n) => `${n}${ANTERIOR_SUFFIX}`)].slice(0, MAX_NODES);
    const nodeIndex = new Map(nodeNames.map((n, i) => [n, i]));
    const step = DEFAULT_STEP;
    const paths = buildFlowPaths(centrelines, nodeIndex, step, (node, p) => nodeAt(cut, node, p));
    const arc = computeArcLengths(centrelines);
    const keep = thinningFactors(paths, particleShares(paths, MAX_PARTICLES));
    const packed = packCentrelines(paths, step, undefined, keep);
    const slots = targets.split('|');
    const particles = allocateParticles(
      paths,
      packed,
      MAX_PARTICLES,
      (tree) => arc.treeLength.get(tree) ?? 1,
      (target) => slotOf(slots, target),
    );
    shuffleInstances(particles.path, particles.seed, particles.count);

    const texture = new DataTexture(packed.data, packed.width, packed.height, RGBAFormat, FloatType);
    texture.minFilter = NearestFilter;
    texture.magFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    const geometry = new InstancedBufferGeometry();
    // The corner quad is stored shrunk by QUAD_SCALE: only the flow shader knows to scale it back up, so
    // a pass that draws the scene with an override material (depth, normals, picking) sees 4096 sub-pixel
    // specks at the origin instead of 4096 overlapping unit quads.
    const q = QUAD_SCALE;
    geometry.setAttribute('position', new Float32BufferAttribute([-q, -q, 0, q, -q, 0, q, q, 0, -q, q, 0], 3));
    geometry.boundingSphere = new Sphere(new Vector3(), 1e3);
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('aPath', new InstancedBufferAttribute(particles.path, 4));
    geometry.setAttribute('aSeed', new InstancedBufferAttribute(particles.seed, 4));
    geometry.instanceCount = 0;

    const material = createFlowMaterial(getRiskLUT(), VESSEL_INFLATE);
    // Clipped from the start (the anatomy published its section plane before the flow layer mounted), so the
    // shader warm-up compiles the very program the first frame draws.
    if (sceneRuntime.sectionPlanes.length > 0) material.clippingPlanes = sceneRuntime.sectionPlanes;
    material.uniforms.uCentre.value = texture;
    material.uniforms.uTexWidth.value = packed.width;
    material.uniforms.uSpacing.value = step;

    const mesh = new Mesh(geometry, material);
    mesh.name = 'FX_FlowParticles';
    mesh.frustumCulled = false; // positions come from the shader
    mesh.renderOrder = 10; // after the opaque heart and vessels
    mesh.raycast = () => {}; // never intercepts picking
    mesh.userData.ctFx = true;

    // A split part has its source node's rest transform (the pristine scene has no split parts).
    const tracker = new NodeTracker(nodeNames, restInverses(pristine, nodeNames.map(baseNode)), 30, (name) => sceneRuntime.nodes[name]?.solid ?? 1);
    return { mesh, geometry, material, texture, tracker, max: particles.count };
  }, [centrelines, pristine, targets, heart]);

  useEffect(
    () => () => {
      built.geometry.dispose();
      built.material.dispose();
      built.texture.dispose();
    },
    [built],
  );

  useEffect(() => {
    built.geometry.instanceCount = Math.min(count, built.max);
  }, [built, count]);

  // Uniforms are refreshed in onBeforeRender: node matrices are current for THIS frame only after the
  // renderer's updateMatrixWorld, which runs after every useFrame callback.
  useEffect(() => {
    const { mesh, material, tracker } = built;
    const u = material.uniforms;
    mesh.onBeforeRender = (renderer) => {
      const f = fxFrame;
      tracker.update(scene);
      for (let i = 0; i < tracker.matrices.length; i += 1) {
        u.uNode.value[i]!.copy(tracker.matrices[i]!);
        u.uNodeAlpha.value[i] = tracker.visibility[i]!;
      }
      for (let s = 0; s < MAX_TARGET_SLOTS; s += 1) {
        u.uFlowDist.value[s] = f.flowDistance[s]!;
        u.uFlowSpeed.value[s] = f.flowSpeed[s]!;
        u.uDensity.value[s] = f.density[s]!;
        u.uTintMix.value[s] = f.tintMix[s]!;
        u.uP.value[s] = f.p[s]!;
        u.uDim.value[s] = f.dim[s]!;
        u.uHover.value[s] = f.hover[s]!;
      }
      u.uIgnite.value = f.ignite;
      u.uPulseFront.value = f.pulseFront;
      u.uPulseAmp.value = f.pulseAmp;
      u.uOpacity.value = f.flowOpacity;
      u.uMeanSpeed.value = BASE_FLOW_SPEED;
      renderer.getDrawingBufferSize(tmpSize);
      u.uViewport.value.copy(tmpSize);
      u.uWidthPx.value = STREAK_WIDTH_PX * renderer.getPixelRatio();
    };
    return () => {
      mesh.onBeforeRender = () => {};
    };
  }, [built, scene]);

  // Skip the draw entirely while the flow is faded out (Flow off, reduced motion, tier C). Clip with the
  // anatomy's heart section plane(s), so a cut heart never shows flow floating in the removed half.
  useFrame(() => {
    built.mesh.visible = count > 0 && fxFrame.flowOpacity > 0;
    const planes = sceneRuntime.sectionPlanes;
    if (built.material.clippingPlanes !== planes && planes.length > 0) {
      built.material.clippingPlanes = planes;
      built.material.needsUpdate = true;
    }
  });

  return <primitive object={built.mesh} />;
}
