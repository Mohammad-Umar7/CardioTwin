#!/usr/bin/env node
/**
 * Stage 7c — a real three.js capture of the published GLB: docs/media/renders/web_preview_three.jpg.
 *
 *   node anatomy/scripts/web_preview_three.mjs [out.jpg]
 *
 * Serves the repository (and the published anatomy folder, or $CARDIOTWIN_PUBLIC_DIR) on a local port, opens
 * anatomy/scripts/web_preview_three.html in headless Chrome / Edge (Chrome DevTools Protocol over Node's built-in
 * WebSocket, no extra dependency) and saves a 1920x1080 JPEG once the page reports that it has rendered. The page uses
 * the viewer's own three.js (frontend/node_modules/three) with GLTFLoader + MeshoptDecoder, so the image shows what a
 * glTF 2.0 viewer shows from the GLB's baked maps, with the viewer's Realistic rig, studio environment and
 * NeutralToneMapping, from the exact hero camera. The saved image is a side-by-side (Cycles hero_heart.jpg | three.js)
 * and the parity of the two (mean absolute difference and the share of object pixels differing by more than 30 levels)
 * is written to anatomy/build/web_parity.json.
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const PUBLIC = process.env.CARDIOTWIN_PUBLIC_DIR ? resolve(process.env.CARDIOTWIN_PUBLIC_DIR) : join(REPO, 'frontend', 'public', 'anatomy');
const OUT = resolve(process.argv[2] ?? join(REPO, 'docs', 'media', 'renders', 'web_preview_three.jpg'));
const BROWSERS = [
  process.env.CARDIOTWIN_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };

const server = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = url.startsWith('/__public__/') ? join(PUBLIC, url.slice('/__public__/'.length)) : join(REPO, url);
  if (!file.startsWith(REPO) && !file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const exe = BROWSERS.find((b) => existsSync(b));
if (!exe) throw new Error('no Chrome / Edge found (set CARDIOTWIN_CHROME)');
const profile = mkdtempSync(join(tmpdir(), 'ct-preview-'));
const dbg = 9300 + Math.floor(Math.random() * 400);
const browser = spawn(exe, [`--headless=new`, `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--window-size=1920,1080',
  '--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', 'about:blank'], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50 && !targets; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); } catch { await sleep(200); }
}
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });

await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
const url = `http://127.0.0.1:${port}/anatomy/scripts/web_preview_three.html?glb=/__public__/cardiotwin_anatomy.glb&manifest=/__public__/manifest.json`;
await send('Page.navigate', { url });
let ready = false;
for (let i = 0; i < 240 && !ready; i++) {
  await sleep(500);
  const r = await send('Runtime.evaluate', { expression: 'window.__ready === true' });
  ready = r.result?.result?.value === true;
}
if (!ready) {
  const r = await send('Runtime.evaluate', { expression: 'document.title' });
  throw new Error(`page did not render (title: ${r.result?.result?.value})`);
}
const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 } });
const capture = Buffer.from(shot.result.data, 'base64');
// parity with the Cycles hero (same camera): mean absolute difference over the object pixels
const HERO = join(REPO, 'docs', 'media', 'renders', 'hero_heart.jpg');
if (existsSync(HERO)) {
  const a = await sharp(HERO).removeAlpha().resize(1920, 1080).raw().toBuffer();
  const b = await sharp(capture).removeAlpha().resize(1920, 1080).raw().toBuffer();
  let sum = 0, n = 0, big = 0;
  const bgA = [a[0], a[1], a[2]], bgB = [b[0], b[1], b[2]];
  for (let i = 0; i < a.length; i += 3) {
    const objA = Math.abs(a[i] - bgA[0]) + Math.abs(a[i + 1] - bgA[1]) + Math.abs(a[i + 2] - bgA[2]) > 24;
    const objB = Math.abs(b[i] - bgB[0]) + Math.abs(b[i + 1] - bgB[1]) + Math.abs(b[i + 2] - bgB[2]) > 24;
    if (!objA && !objB) continue;
    const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
    sum += d; n++; if (d > 30) big++;
  }
  const parity = { object_pixels: n, mean_abs_diff: Number((sum / Math.max(n, 1)).toFixed(2)), share_over_30: Number((big / Math.max(n, 1)).toFixed(4)) };
  writeFileSync(join(REPO, 'anatomy', 'build', 'web_parity.json'), JSON.stringify(parity, null, 1));
  console.log(`[web-preview] parity with hero_heart.jpg: ${JSON.stringify(parity)}`);
  const half = async (src) => sharp(src).resize(960, 540).toBuffer();
  const label = (text) => Buffer.from(`<svg width="960" height="60"><text x="24" y="40" font-family="Segoe UI, Arial" font-size="26" fill="#c8ccd4">${text}</text></svg>`);
  const out = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#16181c' } })
    .composite([
      { input: await half(HERO), left: 0, top: 270 }, { input: await half(capture), left: 960, top: 270 },
      { input: label('Cycles render (hero_heart.jpg)'), left: 0, top: 200 },
      { input: label(`three.js, baked maps only (MAD ${parity.mean_abs_diff} / 255)`), left: 960, top: 200 },
    ]).jpeg({ quality: 88 }).toBuffer();
  writeFileSync(OUT, out);
} else {
  writeFileSync(OUT, await sharp(capture).jpeg({ quality: 88 }).toBuffer());
}
console.log(`[web-preview] ${OUT} (${(statSync(OUT).size / 1024).toFixed(0)} kB) via ${exe}`);
ws.close();
browser.kill();
server.close();
await sleep(500);
try { rmSync(profile, { recursive: true, force: true }); } catch { /* browser may still hold files */ }
