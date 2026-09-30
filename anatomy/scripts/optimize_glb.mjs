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
 */
import { statSync } from 'node:fs';
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

// 2. Cleanup, vertex-cache reorder, attribute quantisation (never POSITION).
await doc.transform(
  prune({ keepAttributes: true, keepLeaves: true, keepIndices: true }),
  reorder({ encoder: MeshoptEncoder, target: 'size' }),
  quantize({ pattern: /^(NORMAL|COLOR_0)$/, quantizeNormal: 10, quantizeColor: 8, cleanup: false }),
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
console.log(`[optimize] ${converted} territory attribute(s) converted to RGB`);
console.log(`[optimize] ${input} (${inMB.toFixed(2)} MB) -> ${output} (${outMB.toFixed(2)} MB)`);
