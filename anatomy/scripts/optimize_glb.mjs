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
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO, PropertyType, TextureInfo } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP, KHRMaterialsClearcoat, KHRMeshQuantization } from '@gltf-transform/extensions';
import { prune, quantize, reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const input = resolve(process.argv[2] ?? resolve(REPO, 'anatomy/build/cardiotwin_anatomy.raw.glb'));
const publicDir = process.env.CARDIOTWIN_PUBLIC_DIR ? resolve(process.env.CARDIOTWIN_PUBLIC_DIR) : resolve(REPO, 'frontend/public/anatomy');
const output = resolve(process.argv[3] ?? resolve(publicDir, 'cardiotwin_anatomy.glb'));
const vesselsPath = resolve(publicDir, 'vessels.json');
const bakeDir = resolve(REPO, 'anatomy/build/bake');
/** WebP quality per map (normal maps need more bits: block artefacts read as facets). */
const WEBP = { base: { quality: 84, effort: 6 }, normal: { quality: 90, effort: 6 }, orm: { quality: 86, effort: 6 } };

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
    // _TERRITORY: the same weights under a custom name (unorm8). glTF viewers multiply COLOR_0 into the base colour;
    // readers of the territory data should use _TERRITORY (COLOR_0 is kept for contract v1.1 consumers).
    const u8 = new Uint8Array(n * 3);
    for (let i = 0; i < n * 3; i++) u8[i] = Math.round(Math.min(1, Math.max(0, rgb[i])) * 255);
    prim.setAttribute('_TERRITORY', doc.createAccessor(`${mesh.getName()}_territory_u8`).setType('VEC3').setArray(u8).setNormalized(true).setBuffer(color.getBuffer()));
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
// _RADIUS (scene units): lumen radius of the nearest labelled centreline point, so a viewer can inflate each vessel in
// proportion to its calibre (and fade sub-pixel tips) instead of adding a fixed offset.
const radiusSets = new Map();
const radiusOf = (seg, i) => seg.radius[i];
for (const v of vesselsDoc.vessels) radiusSets.set(v.node, { name: '_RADIUS', ...labelledPoints(v.segments, radiusOf) });
if (vesselsDoc.veins) radiusSets.set(vesselsDoc.veins.node, { name: '_RADIUS', ...labelledPoints(vesselsDoc.veins.segments, radiusOf) });
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
let withRadius = 0;
for (const node of root.listNodes()) {
  const set = radiusSets.get(node.getName());
  const mesh = node.getMesh();
  if (!set || !mesh) continue;
  const t = node.getWorldTranslation();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const values = new Float32Array(pos.getCount());
    const p = [0, 0, 0];
    for (let i = 0; i < values.length; i++) {
      pos.getElement(i, p);
      const [x, y, z] = [p[0] + t[0], p[1] + t[1], p[2] + t[2]];
      let best = Infinity;
      for (let k = 0; k < set.lab.length; k++) {
        const d = (set.pts[3 * k] - x) ** 2 + (set.pts[3 * k + 1] - y) ** 2 + (set.pts[3 * k + 2] - z) ** 2;
        if (d < best) [best, values[i]] = [d, set.lab[k]];
      }
    }
    prim.setAttribute('_RADIUS', doc.createAccessor(`${mesh.getName()}_radius`).setType('SCALAR').setArray(values).setBuffer(pos.getBuffer()));
  }
  withRadius++;
}
console.log(`[optimize] _RADIUS on ${withRadius} vessel nodes`);
if (!Object.keys(labelCounts).some((n) => n.startsWith('Coronary_'))) {
  console.error('[optimize] ERROR: no _SEGMENT labels written (vessels.json without SCCT labels?)');
  process.exit(1);
}

// 1d. Baked PBR textures (anatomy/build/bake, from anatomy/blender/bake_textures.py) on each node's own material:
//     baseColor (sRGB, lossy WebP), normal (tangent space; near-lossless WebP, renormalised) and occlusion + roughness
//     from one ORM map (near-lossless WebP). A normal map whose 99th-percentile tilt is under NORMAL_MIN_TILT_DEG
//     carries no relief (8-bit quantisation noise only) and is dropped, as is an ORM map whose occlusion and
//     roughness channels are uniform (replaced by the roughness factor). The decoded GPU footprint (RGBA8 + mips)
//     is summed and must stay under GPU_BUDGET_MIB. The wet look (KHR_materials_clearcoat) goes into the GLB too, so
//     standalone glTF viewers show what the app adds.
const bakeManifestPath = join(bakeDir, 'bake_manifest.json');
const NORMAL_MIN_TILT_DEG = 5.0;
const GPU_BUDGET_MIB = 48;
/** Wet serous / adventitial surfaces: clearcoat factor, clearcoat roughness (matches looks.py Coat_*). */
const CLEARCOAT = {
  Myocardium: [0.08, 0.3], Fat: [0.12, 0.3], Artery: [0.14, 0.28], PulmonaryArtery: [0.14, 0.28], PulmonaryVein: [0.14, 0.28],
  Vein: [0.14, 0.28], CardiacVein: [0.16, 0.28], Valve: [0.12, 0.25], Papillary: [0.08, 0.3], Lung: [0.25, 0.2],
  Airway: [0.3, 0.15], Oesophagus: [0.3, 0.15], Diaphragm: [0.3, 0.15], Cartilage: [0.3, 0.15],
};
/** Upload order hint for the viewer: the heart first, the ghosted outer layers last. */
const TEXTURE_PRIORITY = ['Heart_Wall_Anterior', 'Heart_Wall_Posterior', 'EpicardialFat_Anterior', 'EpicardialFat_Posterior',
  'GreatVessel_Aorta', 'GreatVessel_PulmonaryArtery', 'CardiacVeins', 'Valve_Aortic', 'Valve_Mitral', 'Valve_Tricuspid',
  'Valve_Pulmonary', 'Papillary_Muscles', 'GreatVessel_PulmonaryVeins', 'GreatVessel_SVC', 'GreatVessel_IVC',
  'GreatVessel_Aorta_ArchBranches', 'GreatVessel_SVC_BrachiocephalicVeins'];
let textured = 0;
let textureBytes = 0;
let gpuBytes = 0;
const textureReport = {};
const srgbHex = (lin) => '#' + lin.map((x) => {
  const c = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0');
}).join('');
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gpu = (w, h) => (w * h * 4 * 4) / 3;

async function normalStats(file) {
  const { data, info } = await sharp(readFileSync(join(bakeDir, file))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const tilts = new Float32Array(n);
  const out = Buffer.alloc(n * 3);
  let bad = 0;
  for (let i = 0; i < n; i++) {
    let x = data[3 * i] / 127.5 - 1, y = data[3 * i + 1] / 127.5 - 1, z = data[3 * i + 2] / 127.5 - 1;
    const len = Math.hypot(x, y, z);
    if (len < 0.9) bad++;
    if (len > 1e-6) { x /= len; y /= len; z /= len; } else { x = 0; y = 0; z = 1; }
    if (z < 0.5) { const s = Math.sqrt((1 - 0.25) / Math.max(1e-6, x * x + y * y)); x *= s; y *= s; z = 0.5; } // clamp tilt <= 60 deg
    tilts[i] = Math.acos(Math.min(1, z)) * 180 / Math.PI;
    out[3 * i] = Math.round((x + 1) * 127.5); out[3 * i + 1] = Math.round((y + 1) * 127.5); out[3 * i + 2] = Math.round((z + 1) * 127.5);
  }
  const sorted = Float32Array.from(tilts).sort();
  return { p50: sorted[Math.floor(n * 0.5)], p99: sorted[Math.floor(n * 0.99)], invalid: bad / n, width: info.width, height: info.height,
           image: sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } }) };
}

async function channelStats(file) {
  const { data, info } = await sharp(readFileSync(join(bakeDir, file))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const mean = [0, 0, 0];
  const sq = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { const v = data[3 * i + c] / 255; mean[c] += v; sq[c] += v * v; }
  const m = mean.map((v) => v / n);
  const sd = sq.map((v, c) => Math.sqrt(Math.max(0, v / n - m[c] * m[c])));
  return { mean: m, sd, width: info.width, height: info.height };
}

if (existsSync(bakeManifestPath)) {
  const bake = JSON.parse(readFileSync(bakeManifestPath, 'utf8'));
  doc.createExtension(EXTTextureWebP).setRequired(true);
  const clearcoatExt = doc.createExtension(KHRMaterialsClearcoat);
  for (const node of root.listNodes()) {
    const entry = bake.nodes[node.getName()];
    const mesh = node.getMesh();
    if (!entry || !mesh) continue;
    const prim = mesh.listPrimitives()[0];
    if (!prim.getAttribute('TEXCOORD_0')) throw new Error(`${node.getName()}: baked maps but no TEXCOORD_0`);
    const mat = prim.getMaterial();
    const name = node.getName();
    const rep = {};
    const add = (kind, data, w, h) => {
      textureBytes += data.byteLength;
      gpuBytes += gpu(w, h);
      rep[kind] = { size: w, kB: Math.round(data.byteLength / 1024) };
      return doc.createTexture(`${name}_${kind}`).setImage(new Uint8Array(data)).setMimeType('image/webp').setURI(`${name}_${kind}.webp`);
    };
    // base colour (lossy, full-resolution chroma)
    const base = await channelStats(entry.files.base);
    const baseData = await sharp(readFileSync(join(bakeDir, entry.files.base))).removeAlpha()
      .webp({ quality: 86, effort: 6, smartSubsample: true }).toBuffer();
    const alpha = mat.getBaseColorFactor()[3];
    mat.setBaseColorTexture(add('base', baseData, base.width, base.height)).setBaseColorFactor([1, 1, 1, alpha]);
    const meanLin = base.mean.map(toLinear);
    // normal: keep only real relief
    const nrm = await normalStats(entry.files.normal);
    rep.normal_tilt_p50_p99 = [Number(nrm.p50.toFixed(2)), Number(nrm.p99.toFixed(2))];
    if (nrm.p99 >= NORMAL_MIN_TILT_DEG) {
      // near-lossless (WebP's lossless coder on slightly pre-quantised values): ~half the size of lossless, no block
      // artefacts (lossy WebP blocks read as facets on a normal map)
      const data = await nrm.image.webp({ nearLossless: true, quality: 60, effort: 6 }).toBuffer();
      mat.setNormalTexture(add('normal', data, nrm.width, nrm.height)).setNormalScale(1.0);
    } else {
      mat.setNormalTexture(null);
      rep.normal = 'dropped (flat)';
    }
    // occlusion + roughness
    const orm = await channelStats(entry.files.orm);
    if (Math.max(orm.sd[0], orm.sd[1]) < 0.012) {
      mat.setOcclusionTexture(null).setMetallicRoughnessTexture(null).setMetallicFactor(0.0).setRoughnessFactor(Number(orm.mean[1].toFixed(3)));
      rep.orm = `dropped (uniform: roughness ${orm.mean[1].toFixed(2)})`;
    } else {
      const data = await sharp(readFileSync(join(bakeDir, entry.files.orm))).removeAlpha().webp({ nearLossless: true, quality: 80, effort: 6 }).toBuffer();
      const tex = add('orm', data, orm.width, orm.height);
      mat.setOcclusionTexture(tex).setOcclusionStrength(1.0);
      mat.setMetallicRoughnessTexture(tex).setMetallicFactor(0.0).setRoughnessFactor(1.0);
    }
    // atlases: islands touch the 0 / 1 edges, so the samplers clamp instead of repeating
    for (const info of [mat.getBaseColorTextureInfo(), mat.getNormalTextureInfo(), mat.getOcclusionTextureInfo(), mat.getMetallicRoughnessTextureInfo()]) {
      if (info) info.setWrapS(TextureInfo.WrapMode.CLAMP_TO_EDGE).setWrapT(TextureInfo.WrapMode.CLAMP_TO_EDGE);
    }
    const cc = CLEARCOAT[entry.look];
    if (cc) mat.setExtension('KHR_materials_clearcoat', clearcoatExt.createClearcoat().setClearcoatFactor(cc[0]).setClearcoatRoughnessFactor(cc[1]));
    const prio = TEXTURE_PRIORITY.indexOf(name);
    mat.setExtras({ ...mat.getExtras(), ct_baked: true, ct_look: entry.look, ct_mean_rgb: srgbHex(meanLin),
                    ct_texture_priority: prio >= 0 ? prio : TEXTURE_PRIORITY.length + 1 });
    rep.mean_rgb = srgbHex(meanLin);
    textureReport[name] = rep;
    textured++;
  }
  const gpuMiB = gpuBytes / 2 ** 20;
  console.log(`[optimize] baked textures on ${textured} nodes: ${(textureBytes / 1e6).toFixed(2)} MB of WebP, ${gpuMiB.toFixed(1)} MiB on the GPU (RGBA8 + mips)`);
  if (gpuMiB > GPU_BUDGET_MIB) {
    console.error(`[optimize] ERROR: texture GPU footprint ${gpuMiB.toFixed(1)} MiB exceeds the ${GPU_BUDGET_MIB} MiB budget`);
    process.exit(1);
  }
  writeFileSync(join(bakeDir, 'texture_report.json'), JSON.stringify({ gpu_mib: Number(gpuMiB.toFixed(1)), webp_mb: Number((textureBytes / 1e6).toFixed(2)), nodes: textureReport }, null, 1));
} else {
  console.log('[optimize] no baked textures (anatomy/build/bake/bake_manifest.json missing): geometry-only GLB');
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
// FILTER: NORMAL is stored with the OCTAHEDRAL filter (8-bit), everything else as QUANTIZE; POSITION stays float32.
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({
  method: EXTMeshoptCompression.EncoderMethod.FILTER,
});
root.getAsset().extras = { ...(root.getAsset().extras || {}), ct_build: new Date().toISOString().slice(0, 10), ct_contract: '1.1' };

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
console.log(`[optimize] ${converted} territory attribute(s) converted to RGB, _ARCLEN on ${withArclen} coronary nodes, textures on ${textured} nodes`);
console.log(`[optimize] ${input} (${inMB.toFixed(2)} MB) -> ${output} (${outMB.toFixed(2)} MB)`);
const bytes = readFileSync(output);
writeFileSync(join(bakeDir, '..', 'optimize_report.json'), JSON.stringify({
  glb_bytes: bytes.byteLength, glb_sha256: createHash('sha256').update(bytes).digest('hex'),
  textures_gpu_mib: Number((gpuBytes / 2 ** 20).toFixed(1)), textures_webp_mb: Number((textureBytes / 1e6).toFixed(2)),
}, null, 1));
