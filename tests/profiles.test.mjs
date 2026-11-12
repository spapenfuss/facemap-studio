import test from 'node:test';
import assert from 'node:assert/strict';
import { SEASONS } from '../web/js/color.js';
import { MAKEUP, BROW_REC, PROTO, explainShape, shapeDiagramSVG, lipAnalysis, explainSeason } from '../web/js/profiles.js';
import { makeDemoFace } from '../web/js/demo.js';

const hex = /^#[0-9a-f]{6}$/i;
const groups = ['blush', 'shadowNeutral', 'shadowAccent', 'liner', 'lipEveryday', 'lipBold', 'lipLiner', 'neutrals'];

test('every season has a full, valid makeup set', () => {
  for (const s of SEASONS) {
    const m = MAKEUP[s.id]; assert.ok(m, `missing makeup for ${s.id}`);
    for (const g of groups) { assert.ok(m[g] && m[g].length >= 2, `${s.id}.${g}`); for (const [h, n] of m[g]) { assert.match(h, hex); assert.ok(n.length > 2); } }
    assert.ok(m.combos.length >= 2 && m.combos.every(([n, hs]) => n && hs.length === 3 && hs.every((h) => hex.test(h))));
  }
});

test('different seasons get different recommendations (not generic)', () => {
  const sig = (id) => JSON.stringify([MAKEUP[id].blush, MAKEUP[id].lipEveryday, MAKEUP[id].liner]);
  const all = SEASONS.map((s) => sig(s.id));
  assert.equal(new Set(all).size, SEASONS.length);
  assert.notEqual(MAKEUP['soft-summer'].lipEveryday[0][0], MAKEUP['deep-autumn'].lipEveryday[0][0]);
});

test('warm seasons lean warm and cool seasons lean cool in their lip colors', () => {
  const warmth = (h) => { const n = parseInt(h.slice(1), 16); return ((n >> 16) & 255) - (n & 255); };   // red minus blue: warm colors score higher
  const avg = (id) => MAKEUP[id].lipEveryday.reduce((a, [h]) => a + warmth(h), 0) / 3;
  for (const w of ['true-autumn', 'true-spring']) for (const c of ['true-winter', 'true-summer']) assert.ok(avg(w) > avg(c), `${w} should be warmer than ${c}`);
});

test('each face shape has a specific eyebrow recommendation', () => {
  for (const sh of Object.keys(PROTO)) { const b = BROW_REC[sh]; assert.ok(b && b.name && b.why.length > 60 && b.avoid.length > 30, sh); }
  assert.equal(new Set(Object.values(BROW_REC).map((b) => b.name)).size, 6);
});

test('face shape explanation lists the contributing proportions and a diagram', () => {
  const m = { lengthToWidth: 1.22, foreheadToCheek: 0.64, jawToCheek: 0.82, chinAngle: 132, jawAngle: 165 };
  const rows = explainShape('Oblong', m);
  assert.equal(rows.length, 5);
  assert.ok(rows.every((r) => r.fits), 'a face at the prototype matches every row');
  assert.match(rows[0].text, /longer than it is wide/);
  assert.match(shapeDiagramSVG(m), /<svg[\s\S]*Cheekbones[\s\S]*<\/svg>/);
});

test('lip analysis returns advice from landmarks', () => {
  const lm = makeDemoFace({ W: 960, H: 720 });
  const out = lipAnalysis(lm, 960, 720);
  assert.equal(out.length, 3); assert.ok(out.every((t) => t.length > 30));
});

test('season explanation is plain language and personal', () => {
  const s = SEASONS.find((x) => x.id === 'soft-summer');
  const e = explainSeason(s, { T: -0.4, D: 0.1, C: -0.8 });
  assert.match(e.summary, /Soft Summer/); assert.match(e.points[0], /cool/); assert.match(e.points[2], /soft and muted/);
});
