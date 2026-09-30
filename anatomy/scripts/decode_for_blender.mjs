#!/usr/bin/env node
/**
 * Write a plain copy of the published GLB that Blender's glTF importer can read, for the web-fidelity preview
 * (anatomy/blender/render_web_preview.py):
 *
 *   node anatomy/scripts/decode_for_blender.mjs [input.glb] output.glb
 *
 * The copy is lossless with respect to what three.js renders: meshopt buffers are decoded, quantised
 * attributes (normals, UVs, territory colours) are dequantised to float, and the baked WebP textures are
 * re-encoded as lossless PNG (same pixels). Geometry, UVs, materials and textures are otherwise untouched.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const [a, b] = process.argv.slice(2);
const input = resolve(b ? a : resolve(REPO, 'frontend/public/anatomy/cardiotwin_anatomy.glb'));
const output = resolve(b ?? a);

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input);
await doc.transform(dequantize());
for (const ext of doc.getRoot().listExtensionsUsed()) {
  if (['EXT_meshopt_compression', 'KHR_mesh_quantization', 'EXT_texture_webp'].includes(ext.extensionName)) ext.dispose();
}
let converted = 0;
for (const tex of doc.getRoot().listTextures()) {
  if (tex.getMimeType() !== 'image/webp') continue;
  const png = await sharp(Buffer.from(tex.getImage())).png().toBuffer();
  tex.setImage(new Uint8Array(png)).setMimeType('image/png').setURI(tex.getURI().replace(/\.webp$/, '.png'));
  converted++;
}
await io.write(output, doc);
console.log(`[decode] ${input} -> ${output} (${converted} WebP textures as PNG)`);
