#!/usr/bin/env node
/**
 * Stage 4b — optimise the raw Blender GLB for the web with glTF-Transform.
 *
 *   node anatomy/scripts/optimize_glb.mjs [input.glb] [output.glb]
 *
 * Defaults: anatomy/build/cardiotwin_anatomy.raw.glb -> frontend/public/anatomy/cardiotwin_anatomy.glb
 *
 * Design constraints (see anatomy/README.md#web-optimisation):
 *  - Node names, hierarchy and TRS are preserved exactly: no join / flatten / instancing, and
 *    POSITION stays float32 so quantisation never rewrites node matrices (KHR_mesh_quantization
 *    folds position dequantisation into node transforms, which would break `node.scale` / explode
 *    offsets in the viewer).
 *  - NORMAL is quantised to 10-bit and the territory COLOR_0 to 8-bit normalised RGB (the alpha
 *    channel Blender writes is dropped so three.js does not switch on per-vertex alpha).
 *  - Vertex caches are reordered and every buffer is compressed losslessly with
 *    EXT_meshopt_compression (decoded by three.js' GLTFLoader via setMeshoptDecoder).
 *  - Materials are not deduplicated: every node owns its material so the viewer can restyle one
 *    structure without touching the others.
 *  - Every coronary mesh gets `_ARCLEN` (DESIGN_SYSTEM §7.8): the normalised arc length 0 -> 1 of the
 *    nearest centreline point in vessels.json, measured along the tree from its ostium (left tree from
 *    the left-main ostium, right tree from the RCA ostium), for flow / ripple effects along the vessels.
 *    The centreline stage therefore runs before this one.
 */
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { prune, quantize, reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const input = resolve(process.argv[2] ?? resolve(REPO, 'anatomy/build/cardiotwin_anatomy.raw.glb'));
const output = resolve(process.argv[3] ?? resolve(REPO, 'frontend/public/anatomy/cardiotwin_anatomy.glb'));
const vesselsPath = resolve(REPO, 'frontend/public/anatomy/vessels.json');

/**
 * Arc length from the tree's ostium for every centreline point, normalised per tree to [0, 1].
 * Returns Map<coronary node name, { pts: Float64Array (xyz), s: Float64Array }>.
 */
function centrelineArclength(vessels) {
  const byId = new Map(vessels.vessels.map((v) => [v.id, v]));
  const out = new Map();
  const nearestS = (entry, p) => {
    let best = Infinity;
    let s = 0;
    for (let i = 0; i < entry.s.length; i++) {
      const d = (entry.pts[3 * i] - p[0]) ** 2 + (entry.pts[3 * i + 1] - p[1]) ** 2 + (entry.pts[3 * i + 2] - p[2]) ** 2;
      if (d < best) [best, s] = [d, entry.s[i]];
    }
    return s;
  };
  const rootOf = (v) => (v.parent && v.parent !== 'aorta' ? rootOf(byId.get(v.parent)) : v.id);
  const visit = (v) => {
    if (out.has(v.id)) return out.get(v.id);
    if (v.parent && v.parent !== 'aorta') visit(byId.get(v.parent));
    const segs = [];
    for (const seg of v.segments) {
      let s0 = 0;
      if (seg.parent !== null && seg.parent !== undefined) s0 = nearestS(segs[seg.parent], seg.points[0]);
      else if (seg.attach && seg.attach !== 'aorta') s0 = nearestS(out.get(seg.attach), seg.points[0]);
      const pts = new Float64Array(seg.points.flat());
      const s = new Float64Array(seg.points.length);
      s[0] = s0;
      for (let i = 1; i < seg.points.length; i++) {
        s[i] = s[i - 1] + Math.hypot(pts[3 * i] - pts[3 * i - 3], pts[3 * i + 1] - pts[3 * i - 2], pts[3 * i + 2] - pts[3 * i - 1]);
      }
      segs.push({ pts, s });
    }
    const entry = {
      id: v.id,
      node: v.node,
      root: rootOf(v),
      pts: Float64Array.from(segs.flatMap((g) => Array.from(g.pts))),
      s: Float64Array.from(segs.flatMap((g) => Array.from(g.s))),
    };
    out.set(v.id, entry);
    return entry;
  };
  vessels.vessels.forEach(visit);
  const treeMax = new Map();
  for (const e of out.values()) treeMax.set(e.root, Math.max(treeMax.get(e.root) ?? 0, ...e.s));
  const byNode = new Map();
  for (const e of out.values()) byNode.set(e.node, { pts: e.pts, s: e.s.map((x) => x / treeMax.get(e.root)) });
  return byNode;
}

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(input);
const root = doc.getRoot();
const nodeSignature = () =>
  root
    .listNodes()
    .map((n) => `${n.getName()}|${n.getTranslation().map((v) => v.toFixed(6))}|${n.getScale()}|${n.listChildren().length}`)
    .sort()
    .join('\n');
const before = nodeSignature();

// 1. Territory colours: RGBA -> RGB (weights live in RGB; alpha is always 1).
let converted = 0;
/** Reference copies (by mesh name) used to verify the written file. */
const reference = new Map();
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const color = prim.getAttribute('COLOR_0');
    if (!color || color.getType() !== 'VEC4') continue;
    const n = color.getCount();
    const rgb = new Float32Array(n * 3);
    const el = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      color.getElement(i, el);
      rgb[3 * i] = el[0];
      rgb[3 * i + 1] = el[1];
      rgb[3 * i + 2] = el[2];
    }
    const accessor = doc.createAccessor(`${mesh.getName()}_territory`).setType('VEC3').setArray(rgb).setBuffer(color.getBuffer());
    prim.setAttribute('COLOR_0', accessor);
    reference.set(mesh.getName(), { rgb, position: prim.getAttribute('POSITION').getArray().slice() });
    converted++;
  }
}

// 1b. Coronary arc length (_ARCLEN) from the published centrelines.
const arclen = centrelineArclength(JSON.parse(readFileSync(vesselsPath, 'utf8')));
let withArclen = 0;
for (const node of root.listNodes()) {
  const line = arclen.get(node.getName());
  const mesh = node.getMesh();
  if (!line || !mesh) continue;
  const t = node.getWorldTranslation();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const values = new Float32Array(pos.getCount());
    const p = [0, 0, 0];
    for (let i = 0; i < values.length; i++) {
      pos.getElement(i, p);
      const [x, y, z] = [p[0] + t[0], p[1] + t[1], p[2] + t[2]];
      let best = Infinity;
      for (let k = 0; k < line.s.length; k++) {
        const d = (line.pts[3 * k] - x) ** 2 + (line.pts[3 * k + 1] - y) ** 2 + (line.pts[3 * k + 2] - z) ** 2;
        if (d < best) [best, values[i]] = [d, line.s[k]];
      }
    }
    prim.setAttribute('_ARCLEN', doc.createAccessor(`${mesh.getName()}_arclen`).setType('SCALAR').setArray(values).setBuffer(pos.getBuffer()));
  }
  withArclen++;
}
if (withArclen !== arclen.size) {
  console.error(`[optimize] ERROR: _ARCLEN written for ${withArclen} of ${arclen.size} coronary nodes`);
  process.exit(1);
}

// 1c. Anatomical labels baked per vertex from the nearest labelled centreline point:
//     coronary meshes -> _SEGMENT (SCCT 2014 number, 0 = named but unnumbered branch; CONTRACTS §7.1),
//     CardiacVeins    -> _VEIN (manifest.veins code: 1 CS, 2 GCV, 3 AIV, 4 MCV, 5 PVLV, 6 ACV).
//     Points of a branch that still lie inside its parent's lumen (the junction bridge) are skipped, so a
//     parent's wall keeps the parent's label up to the branch ostium.
const vesselsDoc = JSON.parse(readFileSync(vesselsPath, 'utf8'));
function labelledPoints(segments, labelOf) {
  const pts = [];
  const lab = [];
  segments.forEach((seg, j) => {
    const parent = seg.parent !== null && seg.parent !== undefined ? segments[seg.parent] : null;
    let bridging = !!parent;
    seg.points.forEach((p, i) => {
      if (bridging) {
        let best = Infinity;
        let rp = 0;
        parent.points.forEach((q, k) => {
          const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
          if (d < best) [best, rp] = [d, parent.radius[k]];
        });
        if (Math.sqrt(best) < rp) return; // still inside the parent lumen
        bridging = false;
      }
      pts.push(p[0], p[1], p[2]);
      lab.push(labelOf(seg, i, j));
    });
  });
  return { pts: Float64Array.from(pts), lab: Float32Array.from(lab) };
}
const scctOf = (seg, i) => {
  for (const L of seg.labels ?? []) if (i >= L.from && i < L.to) return L.scct;
  return seg.scct ?? 0;
};
const labelSets = new Map();
for (const v of vesselsDoc.vessels) labelSets.set(v.node, { name: '_SEGMENT', ...labelledPoints(v.segments, scctOf) });
if (vesselsDoc.veins) labelSets.set(vesselsDoc.veins.node, { name: '_VEIN', ...labelledPoints(vesselsDoc.veins.segments, (seg) => seg.code) });
const labelCounts = {};
for (const node of root.listNodes()) {
  const set = labelSets.get(node.getName());
  const mesh = node.getMesh();
  if (!set || !mesh) continue;
  const t = node.getWorldTranslation();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const values = new Float32Array(pos.getCount());
    const p = [0, 0, 0];
    const counts = {};
    for (let i = 0; i < values.length; i++) {
      pos.getElement(i, p);
      const [x, y, z] = [p[0] + t[0], p[1] + t[1], p[2] + t[2]];
      let best = Infinity;
      for (let k = 0; k < set.lab.length; k++) {
        const d = (set.pts[3 * k] - x) ** 2 + (set.pts[3 * k + 1] - y) ** 2 + (set.pts[3 * k + 2] - z) ** 2;
        if (d < best) [best, values[i]] = [d, set.lab[k]];
      }
      counts[values[i]] = (counts[values[i]] ?? 0) + 1;
    }
    prim.setAttribute(set.name, doc.createAccessor(`${mesh.getName()}_${set.name.slice(1).toLowerCase()}`).setType('SCALAR').setArray(values).setBuffer(pos.getBuffer()));
    labelCounts[node.getName()] = counts;
  }
}
for (const [n, c] of Object.entries(labelCounts)) console.log(`[optimize] ${n}: ${labelSets.get(n).name} ${JSON.stringify(c)}`);
if (!Object.keys(labelCounts).some((n) => n.startsWith('Coronary_'))) {
  console.error('[optimize] ERROR: no _SEGMENT labels written (vessels.json without SCCT labels?)');
  process.exit(1);
}

// 2. Cleanup, vertex-cache reorder, attribute quantisation (never POSITION).
await doc.transform(
  prune({ keepAttributes: true, keepLeaves: true, keepIndices: true }),
  reorder({ encoder: MeshoptEncoder, target: 'size' }),
  quantize({ pattern: /^(NORMAL|COLOR_0|TEXCOORD_0)$/, quantizeNormal: 10, quantizeColor: 8, quantizeTexcoord: 14, cleanup: false }),
  // Drop the float accessors replaced by quantisation (materials are left untouched on purpose).
  prune({ propertyTypes: [PropertyType.ACCESSOR], keepAttributes: true, keepLeaves: true, keepIndices: true }),
);

// quantize() only declares KHR_mesh_quantization when POSITION is quantised; normals stored as
// normalised int16 need it too.
doc.createExtension(KHRMeshQuantization).setRequired(true);

// 3. Lossless meshopt compression of every buffer view.
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({
  method: EXTMeshoptCompression.EncoderMethod.QUANTIZE,
});

if (nodeSignature() !== before) {
  console.error('[optimize] ERROR: node names / transforms / hierarchy changed during optimisation');
  process.exit(1);
}

await io.write(output, doc);

// 4. Verify: decode the written file and compare territory weights and positions with the input.
const check = await io.read(output);
for (const mesh of check.getRoot().listMeshes()) {
  const ref = reference.get(mesh.getName());
  if (!ref) continue;
  const prim = mesh.listPrimitives()[0];
  const color = prim.getAttribute('COLOR_0');
  const pos = prim.getAttribute('POSITION');
  if (!color || color.getType() !== 'VEC3') throw new Error(`${mesh.getName()}: COLOR_0 missing or not VEC3`);
  // reorder() permutes vertices, so compare order-independent statistics per channel.
  const el = [0, 0, 0];
  const sums = [0, 0, 0];
  const refSums = [0, 0, 0];
  for (let i = 0; i < color.getCount(); i++) {
    color.getElement(i, el);
    for (let c = 0; c < 3; c++) sums[c] += el[c];
  }
  for (let i = 0; i < ref.rgb.length; i++) refSums[i % 3] += ref.rgb[i];
  const n = color.getCount();
  const drift = Math.max(...sums.map((v, c) => Math.abs(v - refSums[c]) / n));
  const posSum = (arr) => arr.reduce((a, b) => a + b, 0);
  const posDrift = Math.abs(posSum(pos.getArray()) - posSum(ref.position)) / n;
  if (n * 3 !== ref.rgb.length || drift > 2 / 255 || posDrift > 1e-4) {
    throw new Error(`${mesh.getName()}: territory/position drift after optimisation (colour ${drift}, position ${posDrift})`);
  }
  console.log(`[optimize] verified ${mesh.getName()}: ${n} vertices, mean LAD/LCX/RCA = ${sums.map((v) => (v / n).toFixed(3)).join(' / ')}`);
}
const inMB = statSync(input).size / 1e6;
const outMB = statSync(output).size / 1e6;
console.log(`[optimize] ${converted} territory attribute(s) converted to RGB, _ARCLEN on ${withArclen} coronary nodes`);
console.log(`[optimize] ${input} (${inMB.toFixed(2)} MB) -> ${output} (${outMB.toFixed(2)} MB)`);
