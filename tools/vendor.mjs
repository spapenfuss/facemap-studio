// Optional: download MediaPipe (JS + WASM + face model) into web/vendor so the app works offline.
//   npm run vendor
import { mkdir, cp, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const VERSION = '0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'web', 'vendor');

console.log(`Installing @mediapipe/tasks-vision@${VERSION} (not saved to package.json)...`);
execSync(`npm install --no-save --no-package-lock @mediapipe/tasks-vision@${VERSION}`, { cwd: root, stdio: 'inherit' });

const pkg = join(root, 'node_modules', '@mediapipe', 'tasks-vision');
await mkdir(join(dest, 'mediapipe'), { recursive: true });
await cp(join(pkg, 'vision_bundle.mjs'), join(dest, 'mediapipe', 'vision_bundle.mjs'));
await cp(join(pkg, 'wasm'), join(dest, 'mediapipe', 'wasm'), { recursive: true });

console.log('Downloading face_landmarker.task ...');
const res = await fetch(MODEL);
if (!res.ok) throw new Error(`model download failed: ${res.status}`);
await writeFile(join(dest, 'face_landmarker.task'), Buffer.from(await res.arrayBuffer()));
console.log('Done. Restart the server; the app now loads MediaPipe from web/vendor.');
