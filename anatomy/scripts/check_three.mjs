#!/usr/bin/env node
/**
 * QA: load the published GLB with three.js' own GLTFLoader (+ MeshoptDecoder), headless, and list what the viewer
 * will see: custom attributes as three.js names them (`_segment`, `_vein`, `_dist_heart`, `_dist_hilum`, `_arclen`)
 * and the baked maps on the heart-wall material.
 *
 *   node anatomy/scripts/check_three.mjs [frontend_dir]
 *
 * Uses the viewer's own three.js from frontend/node_modules; image decoding is stubbed (geometry and material
 * wiring are what is checked).
 */
import { readFileSync } from 'node:fs';
// minimal browser shims so GLTFLoader can run headless (image decoding is stubbed: geometry is what we check)
globalThis.self = globalThis;
globalThis.Image = class { set src(v) { setTimeout(() => { this.height = 1; this.width = 1; this.onload && this.onload(); }); } };
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
import { pathToFileURL } from 'node:url';
const base = process.argv[2] ?? new URL('../../frontend', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const THREE = await import(pathToFileURL(base + '/node_modules/three/build/three.module.js').href);
const { GLTFLoader } = await import(pathToFileURL(base + '/node_modules/three/examples/jsm/loaders/GLTFLoader.js').href);
const { MeshoptDecoder } = await import(pathToFileURL(base + '/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js').href);
const buf = readFileSync((process.env.CARDIOTWIN_PUBLIC_DIR ?? base + '/public/anatomy') + '/cardiotwin_anatomy.glb');
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
// Node has no image decoder: textures resolve to empty Texture objects (geometry is what we check here)
loader.register(() => ({ name: 'stub_textures', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
loader.parse(ab, '', (gltf) => {
  const out = {};
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const a = o.geometry.attributes;
    out[o.name] = Object.keys(a).filter((k) => k.startsWith('_') || k === 'uv' || k === 'color');
    if (o.name === 'Coronary_LAD') {
      const s = a._segment; const vals = new Set(); for (let i = 0; i < s.count; i++) vals.add(s.getX(i));
      console.log('LAD _segment values', [...vals].sort((x, y) => x - y));
    }
    if (o.name === 'Heart_Wall_Anterior') console.log('wall material maps', ['map', 'normalMap', 'roughnessMap', 'aoMap'].filter((k) => o.material[k]));
  });
  for (const n of ['Coronary_LAD', 'Coronary_RCA', 'CardiacVeins', 'GreatVessel_PulmonaryArtery', 'Heart_Wall_Anterior', 'EpicardialFat_Anterior', 'Valve_Aortic']) console.log(n, out[n]);
}, (e) => { console.error('ERR', e); process.exit(1); });
