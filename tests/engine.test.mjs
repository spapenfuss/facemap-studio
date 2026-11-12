// Run with:  node --test tests/
// Feeds procedural faces (web/js/demo.js) through the real WebAssembly engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadEngine, KIND } from '../web/js/engine.js';
import { makeDemoFace, VARIANTS } from '../web/js/demo.js';

const here = dirname(fileURLToPath(import.meta.url));
const wasm = readFileSync(join(here, '../web/wasm/engine.wasm'));
const W = 1280, H = 720;

async function settle(engine, opts, frames = 60) {
  const lm = makeDemoFace({ W, H, ...opts });
  let prims = null;
  for (let i = 0; i < frames; i++) prims = engine.process(lm, W, H, 1000 + i * 33);
  return { prims, lm };
}
const find = (prims, kind, side, sub = null) =>
  prims.find((p) => p.kind === kind && p.side === side && (sub === null || p.sub === sub));
const centroid = (pts) => {
  let x = 0, y = 0; const n = pts.length / 2;
  for (let i = 0; i < pts.length; i += 2) { x += pts[i]; y += pts[i + 1]; }
  return [x / n, y / n];
};

test('engine loads and reports a version', async () => {
  const e = await loadEngine(wasm);
  assert.equal(e.N, 478);
  assert.equal(e.x.engine_version(), 103);
});

test('no face -> null output and ok:false report', async () => {
  const e = await loadEngine(wasm);
  assert.equal(e.process(new Float32Array(10), W, H, 0), null);
  assert.equal(e.report().ok, false);
});

test('frontal scan locks, produces all primitive kinds and a valid report', async () => {
  const e = await loadEngine(wasm);
  const { prims } = await settle(e, {}, 80);
  const kinds = new Set(prims.map((p) => p.kind));
  for (const k of [KIND.CONTOUR, KIND.BLUSH,
    KIND.HIGHLIGHT, KIND.EYE_LID, KIND.EYE_CREASE, KIND.EYE_WING]) assert.ok(kinds.has(k), `missing kind ${k}`);
  const r = e.report();
  assert.equal(r.ok, true);
  assert.equal(r.scan.locked, true);
  assert.ok(r.face.shape && r.face.ranking.length === 6);
  assert.equal(r.brows, undefined, 'brow mapping was removed from the engine');
  assert.ok(r.tips.contour.length >= 1 && r.eyes.tips.length === 4);
  assert.ok(r.symmetry.score >= 0 && r.symmetry.score <= 100);
});

test('overlay shrinks like the face when the head turns (foreshortening)', async () => {
  const e = await loadEngine(wasm);
  const f = await settle(e, { yaw: 0 }, 60);
  const wide0 = Math.abs(centroid(find(f.prims, KIND.BLUSH, 1).pts)[0] - centroid(find(f.prims, KIND.BLUSH, 0).pts)[0]);
  const e2 = await loadEngine(wasm);
  const g = await settle(e2, { yaw: 30 }, 60);
  const wide30 = Math.abs(centroid(find(g.prims, KIND.BLUSH, 1).pts)[0] - centroid(find(g.prims, KIND.BLUSH, 0).pts)[0]);
  const ratio = wide30 / wide0;
  assert.ok(ratio > 0.78 && ratio < 0.97, `blush spacing ratio ${ratio.toFixed(3)} (cos 30deg = 0.866)`);
});

test('smoothing: output jitter is far smaller than input jitter', async () => {
  const e = await loadEngine(wasm);
  const base = makeDemoFace({ W, H });
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5;
  const outs = [];
  for (let f = 0; f < 120; f++) {
    const lm = base.slice();
    for (let i = 0; i < lm.length; i += 3) { lm[i] += (rnd() * 3) / W; lm[i + 1] += (rnd() * 3) / H; }
    const prims = e.process(lm, W, H, 1000 + f * 33);
    if (f > 30) outs.push(centroid(find(prims, KIND.BLUSH, 0).pts));
  }
  const mean = outs.reduce((a, p) => [a[0] + p[0] / outs.length, a[1] + p[1] / outs.length], [0, 0]);
  const sd = Math.sqrt(outs.reduce((a, p) => a + (p[0] - mean[0]) ** 2 + (p[1] - mean[1]) ** 2, 0) / outs.length);
  assert.ok(sd < 0.9, `output jitter ${sd.toFixed(2)} px (input noise +-1.5 px uniform)`);
});

test('blinking does not corrupt eye makeup guides', async () => {
  const e = await loadEngine(wasm);
  await settle(e, {}, 60);
  const open = e.report().measure.eyeOpenness;
  const lm = makeDemoFace({ W, H, blink: 1 });
  for (let i = 0; i < 10; i++) e.process(lm, W, H, 5000 + i * 33);
  assert.ok(Math.abs(e.report().measure.eyeOpenness - open) < 0.02, 'blink frames must not update eye measurements');
});

test('procedural face variants classify as intended', async () => {
  const rows = [];
  for (const v of Object.keys(VARIANTS)) {
    const e = await loadEngine(wasm);
    await settle(e, { variant: v }, 70);
    const r = e.report();
    assert.equal(r.face.shape.toLowerCase(), v, `${v} classified as ${r.face.shape}`);
    rows.push(`${v.padEnd(8)} -> ${r.face.shape.padEnd(8)} ${(r.face.confidence * 100).toFixed(0)}%  len/w ${r.measure.lengthToWidth}  fore ${r.measure.foreheadToCheek}  jaw ${r.measure.jawToCheek}  chin ${r.measure.chinAngle}  jawAng ${r.measure.jawAngle}`);
  }
  console.log('\n' + rows.join('\n'));
});

test('performance: < 1.5 ms per frame', async () => {
  const e = await loadEngine(wasm);
  const lm = makeDemoFace({ W, H, yaw: 10 });
  for (let i = 0; i < 30; i++) e.process(lm, W, H, i * 33);
  const t0 = performance.now(); const N = 300;
  for (let i = 0; i < N; i++) e.process(lm, W, H, 2000 + i * 33);
  const ms = (performance.now() - t0) / N;
  console.log(`\nengine_process: ${ms.toFixed(3)} ms/frame`);
  assert.ok(ms < 1.5, `${ms} ms/frame`);
});

