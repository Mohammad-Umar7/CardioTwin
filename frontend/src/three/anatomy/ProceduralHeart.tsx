import { useEffect, useMemo } from 'react';
import { BufferAttribute, CatmullRomCurve3, MeshBasicMaterial, Vector3, type BufferGeometry } from 'three';
import { useViewerStore } from '@/state/viewerStore';
import { ANATOMY } from '@/theme/tokens';
import type { TargetId } from '@/types/contracts';
import { clearAnchors, setAnchors, type LabelAnchor } from './anchors';
import { vesselHandlers } from './interaction';
import {
  createGreatVesselMaterial,
  createHullMaterial,
  createLeftMainMaterial,
  createMyocardiumMaterial,
  createVesselMaterial,
  type VesselMaterial,
} from './materials';
import {
  HEART_CENTRE,
  PROCEDURAL_VESSELS,
  anchorOn,
  buildHeartGeometry,
  buildTaperedTube,
  directionAt,
  surfacePoint,
  territoryWeights,
  vesselCurve,
} from './proceduralGeometry';
import { useRiskAnimation } from './useRiskAnimation';

interface BuiltVessel {
  node: string;
  target: TargetId | null;
  geometry: BufferGeometry;
  hull: BufferGeometry;
  hit: BufferGeometry | null;
}

/** Great-vessel stubs: start on the base of the heart, then offsets (scene units). */
function greatVesselCurve(t: number, phi: number, offsets: [number, number, number][]): CatmullRomCurve3 {
  const start = surfacePoint(directionAt(t, phi));
  const inward = start.clone().add(HEART_CENTRE).normalize().multiplyScalar(-0.12);
  const pts = [start.clone().add(inward), start];
  for (const o of offsets) pts.push(start.clone().add(new Vector3(...o)));
  return new CatmullRomCurve3(pts, false, 'centripetal');
}

function build() {
  const heart = buildHeartGeometry(112, 84);
  const curves = PROCEDURAL_VESSELS.map((v) => ({ v, curve: vesselCurve(v) }));
  heart.setAttribute(
    'aTerritory',
    new BufferAttribute(territoryWeights(heart, curves.map(({ v, curve }) => ({ target: v.target, curve }))), 3),
  );

  const vessels: BuiltVessel[] = curves.map(({ v, curve }) => ({
    node: v.node,
    target: v.target,
    geometry: buildTaperedTube(curve, v.radius[0], v.radius[1], 96, 12),
    hull: buildTaperedTube(curve, v.radius[0] * 1.14, v.radius[1] * 1.14, 64, 10),
    hit: v.target ? buildTaperedTube(curve, v.radius[0] * 3, Math.max(v.radius[1] * 3, 0.03), 32, 6) : null,
  }));

  const great = [
    buildTaperedTube(greatVesselCurve(-0.93, 25, [[0.02, 0.32, 0.02], [0.2, 0.62, -0.08], [0.42, 0.62, -0.34], [0.5, 0.35, -0.5]]), 0.13, 0.11, 64, 20),
    buildTaperedTube(greatVesselCurve(-0.8, -24, [[0.06, 0.3, 0.02], [0.2, 0.48, -0.14], [0.36, 0.52, -0.3]]), 0.12, 0.1, 48, 20),
    buildTaperedTube(greatVesselCurve(-0.82, 78, [[-0.02, 0.28, -0.02], [-0.02, 0.62, -0.06]]), 0.085, 0.08, 32, 16),
  ];

  const anchors: LabelAnchor[] = curves
    .filter(({ v }) => v.main && v.target)
    .map(({ v, curve }) => {
      const { anchor, normal } = anchorOn(curve, v.target === 'RCA' ? 0.3 : 0.45);
      return { target: v.target as TargetId, position: anchor, normal };
    });

  return { heart, vessels, great, anchors };
}

/**
 * Procedural placeholder heart (clay myocardium, tapered coronary tubes, great-vessel stubs). Shown when
 * the BodyParts3D GLB is not deployed or fails to load; uses exactly the same risk materials, hover /
 * selection behaviour and label anchors as the real anatomy, so the end-to-end loop is always visible.
 */
export function ProceduralHeart() {
  const built = useMemo(build, []);
  const look = useViewerStore((s) => s.look);
  const setAnatomySource = useViewerStore((s) => s.setAnatomySource);

  const materials = useMemo(() => {
    const vessels = new Map<string, VesselMaterial>();
    for (const v of PROCEDURAL_VESSELS) if (v.target && !vessels.has(v.target)) vessels.set(v.target, createVesselMaterial());
    return {
      myocardium: createMyocardiumMaterial('clay', 'aTerritory'),
      vessels,
      leftMain: createLeftMainMaterial(),
      great: createGreatVesselMaterial(),
      hull: createHullMaterial(),
      hit: new MeshBasicMaterial({ visible: false }),
    };
  }, []);

  useEffect(() => {
    materials.myocardium.color.set(look === 'clay' ? ANATOMY.clay : ANATOMY.flesh);
  }, [look, materials]);

  useRiskAnimation({ vessels: materials.vessels, myocardium: [materials.myocardium] });

  useEffect(() => {
    setAnchors(built.anchors);
    setAnatomySource('procedural');
    return () => clearAnchors();
  }, [built, setAnatomySource]);

  useEffect(
    () => () => {
      built.heart.dispose();
      built.great.forEach((g) => g.dispose());
      built.vessels.forEach((v) => {
        v.geometry.dispose();
        v.hull.dispose();
        v.hit?.dispose();
      });
      materials.myocardium.dispose();
      materials.vessels.forEach((m) => m.dispose());
      materials.leftMain.dispose();
      materials.great.dispose();
      materials.hull.dispose();
      materials.hit.dispose();
    },
    [built, materials],
  );

  return (
    <group name="Layer_Heart_Procedural">
      <mesh name="Heart_Wall" geometry={built.heart} material={materials.myocardium} />
      {built.great.map((g, i) => (
        <mesh key={i} name={['GreatVessel_Aorta', 'GreatVessel_PulmonaryArtery', 'GreatVessel_SVC'][i]} geometry={g} material={materials.great} />
      ))}
      <group name="Layer_Coronary">
        {built.vessels.map((v) => (
          <group key={v.node} name={v.node}>
            <mesh geometry={v.hull} material={materials.hull} renderOrder={1} raycast={() => null} />
            <mesh
              geometry={v.geometry}
              material={v.target ? materials.vessels.get(v.target) : materials.leftMain}
              renderOrder={2}
              raycast={() => null}
            />
            {v.hit && v.target && <mesh geometry={v.hit} material={materials.hit} {...vesselHandlers(v.target)} />}
          </group>
        ))}
      </group>
    </group>
  );
}
