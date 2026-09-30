#!/usr/bin/env node
/**
 * Decode the published (meshopt-compressed) GLB into plain arrays for geometry QA in Python.
 *
 *   node anatomy/scripts/decode_glb.mjs [input.glb] <out_dir>
 *
 * Writes, per mesh node, `<node>.pos.f32` (world-space positions), `<node>.nrm.f32`, optional
 * `<node>.col.f32` (territories), `<node>.arc.f32` (coronary arc length), `<node>.seg.f32` (SCCT _SEGMENT),
 * `<node>.vein.f32` (_VEIN labels), `<node>.idx.u32`
 * (triangle indices), plus `index.json` with node names, parents, extras and array shapes.
 * Used by anatomy/tests/test_mesh_quality.py.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const [a, b] = process.argv.slice(2);
const input = resolve(b ? a : resolve(REPO, 'frontend/public/anatomy/cardiotwin_anatomy.glb'));
const outDir = resolve(b ?? a ?? 'anatomy/build/decoded');

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input);
mkdirSync(outDir, { recursive: true });

/** Flatten an accessor to Float32 (dequantising normalised integer attributes). */
function floats(accessor) {
  const n = accessor.getCount();
  const k = accessor.getElementSize();
  const out = new Float32Array(n * k);
  const el = new Array(k);
  for (let i = 0; i < n; i++) {
    accessor.getElement(i, el);
    for (let c = 0; c < k; c++) out[i * k + c] = el[c];
  }
  return { out, n, k };
}

const index = [];
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  const entry = { name: node.getName(), parent: node.getParentNode()?.getName() ?? null, extras: node.getExtras() };
  if (mesh) {
    const prim = mesh.listPrimitives()[0];
    const m = node.getWorldMatrix(); // column-major
    const pos = floats(prim.getAttribute('POSITION'));
    for (let i = 0; i < pos.n; i++) {
      const [x, y, z] = [pos.out[3 * i], pos.out[3 * i + 1], pos.out[3 * i + 2]];
      pos.out[3 * i] = m[0] * x + m[4] * y + m[8] * z + m[12];
      pos.out[3 * i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      pos.out[3 * i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
    writeFileSync(join(outDir, `${entry.name}.pos.f32`), Buffer.from(pos.out.buffer));
    entry.vertices = pos.n;
    for (const [semantic, suffix] of [['NORMAL', 'nrm'], ['COLOR_0', 'col'], ['_ARCLEN', 'arc'], ['_SEGMENT', 'seg'], ['_VEIN', 'vein']]) {
      const acc = prim.getAttribute(semantic);
      if (!acc) continue;
      const { out, k } = floats(acc);
      writeFileSync(join(outDir, `${entry.name}.${suffix}.f32`), Buffer.from(out.buffer));
      entry[suffix] = k;
    }
    const idx = Uint32Array.from(prim.getIndices().getArray());
    writeFileSync(join(outDir, `${entry.name}.idx.u32`), Buffer.from(idx.buffer));
    entry.triangles = idx.length / 3;
  }
  index.push(entry);
}
writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 1));
console.log(`[decode] ${index.filter((e) => e.triangles).length} meshes -> ${outDir}`);
