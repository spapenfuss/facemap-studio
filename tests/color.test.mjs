// node --test tests/   (color analysis engine: pure functions + a synthetic photograph)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rgbToLab, hexToLab, warmth, classify, SEASONS, evaluateDrape, dimsFromMeasurement, Session, ROUNDS, measureFace, seasonById } from '../web/js/color.js';
import { makeDemoFace } from '../web/js/demo.js';

test('Lab conversion matches reference values', () => {
  const w = rgbToLab(255, 255, 255); assert.ok(Math.abs(w[0] - 100) < 0.05 && Math.abs(w[1]) < 0.05 && Math.abs(w[2]) < 0.05);
  const r = rgbToLab(255, 0, 0); assert.ok(Math.abs(r[0] - 53.24) < 0.3 && Math.abs(r[1] - 80.09) < 0.5 && Math.abs(r[2] - 67.2) < 0.5);
  const k = rgbToLab(0, 0, 0); assert.ok(k[0] < 0.01);
});

test('warmth: warm hues positive, cool hues negative, ivory warmer than optic white', () => {
  for (const h of ['#E8744D', '#D6A24A', '#FF5B2E', '#B86F55', '#3CB44B']) assert.ok(warmth(hexToLab(h)) > 0.05, `${h} should be warm`);
  for (const h of ['#CF5E94', '#6F86C9', '#E0007A', '#2F6BFF', '#7C8DA6']) assert.ok(warmth(hexToLab(h)) < -0.05, `${h} should be cool`);
  assert.ok(warmth(hexToLab('#F3E7CE')) > warmth(hexToLab('#FFFFFF')));
});

test('every season is the best match for its own coordinates, and probabilities sum to 1', () => {
  for (const s of SEASONS) {
    const r = classify({ T: s.T, D: s.D, C: s.C });
    assert.equal(r[0].season.id, s.id, `${s.name} should classify as itself`);
    assert.ok(Math.abs(r.reduce((a, e) => a + e.p, 0) - 1) < 1e-9);
  }
  assert.equal(SEASONS.length, 12);
});

test('classic personas land in the expected family', () => {
  const fam = (d) => classify(d)[0].season.family;
  assert.equal(fam({ T: 0.8, D: -0.5, C: 0.4 }), 'Spring');      // warm, light, clear
  assert.equal(fam({ T: -0.7, D: -0.4, C: -0.5 }), 'Summer');    // cool, light, soft
  assert.equal(fam({ T: 0.7, D: 0.5, C: -0.3 }), 'Autumn');      // warm, deep, soft/rich
  assert.equal(fam({ T: -0.7, D: 0.6, C: 0.6 }), 'Winter');      // cool, deep, clear
});

test('drape model: matching undertone beats mismatched; bright drape suits a clear person better than a muted one', () => {
  const warm = { skin: [68, 14, 22], dims: { T: 0.8, D: 0, C: 0.5, contrast: 0.6 } };
  assert.ok(evaluateDrape(warm, '#E8744D').harmony > evaluateDrape(warm, '#CF5E94').harmony + 20);
  assert.ok(evaluateDrape(warm, '#E8744D').overall > evaluateDrape(warm, '#6F86C9').overall);
  const cool = { skin: [70, 18, 12], dims: { T: -0.8, D: 0, C: -0.5, contrast: 0.4 } };
  assert.ok(evaluateDrape(cool, '#CF5E94').overall > evaluateDrape(cool, '#E8744D').overall);
  assert.ok(evaluateDrape(cool, '#E8744D').yellow > evaluateDrape(cool, '#CF5E94').yellow);   // warm drape on a cool face reads yellow/sallow
  const clear = { skin: [75, 14, 14], dims: { T: 0, D: 0, C: 0.9, contrast: 0.9 } };
  assert.ok(evaluateDrape(clear, '#E0007A').overall > evaluateDrape(clear, '#B07A8C').overall);
});

test('session: votes move the estimate toward the person\'s own judgement, confidence is capped below certainty', () => {
  const meas = { skin: [68, 14, 22], quality: 1, dims: { T: 0.1, D: 0, C: 0.0, contrast: 0.5 } };
  const s = new Session(meas);
  const before = s.ranking()[0].season;
  s.vote('temp', 'B'); s.vote('chroma', 'B'); s.vote('depth', 'A');           // cool, muted, light
  const after = s.result();
  assert.equal(after.top.season.family, 'Summer');
  assert.ok(after.confidence <= 0.9 && after.confidence >= 0.1);
  assert.notEqual(before.id, after.top.season.id);
  assert.equal(s.tempFamily, 'cool');
  assert.ok(s.round('chroma').A.name === 'Bright' && s.round('chroma').B.colors.length === 2);
  const c = s.confirmationRound(); assert.ok(c.A.seasonId && c.B.seasonId && c.A.seasonId !== c.B.seasonId);
});

test('measureFace reads a synthetic photograph and keeps the same regions', () => {
  const W = 960, H = 720, lm = makeDemoFace({ W, H });
  // paint a flat warm-skinned face on a dark canvas using the landmarks' bounding region
  const data = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < data.length; i += 4) { data[i] = 20; data[i + 1] = 20; data[i + 2] = 25; data[i + 3] = 255; }
  const skin = [226, 178, 150];
  const xs = [], ys = []; for (let i = 0; i < 478; i++) { xs.push(lm[i * 3] * W); ys.push(lm[i * 3 + 1] * H); }
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  for (let y = Math.floor(y0); y < y1; y++) for (let x = Math.floor(x0); x < x1; x++) { const o = (y * W + x) * 4; data[o] = skin[0]; data[o + 1] = skin[1]; data[o + 2] = skin[2]; }
  const ctx = { getImageData: () => ({ data }) };
  const m = measureFace(ctx, lm, W, H);
  assert.ok(m, 'measurement should succeed');
  assert.equal(m.regions.length, 4);
  const want = rgbToLab(...skin);
  assert.ok(Math.abs(m.skin[0] - want[0]) < 3 && Math.abs(m.skin[1] - want[1]) < 3 && Math.abs(m.skin[2] - want[2]) < 3, `skin Lab ${m.skin.map((v) => v.toFixed(1))} vs ${want.map((v) => v.toFixed(1))}`);
  assert.ok(m.dims.T > 0, 'warm-toned skin should read warm');
  assert.ok(m.cheekDiff < 3);
  for (const id of ['temp', 'neutrals']) assert.ok(ROUNDS[id].A.colors.length >= 2);
  assert.ok(seasonById('true-autumn').best.length === 8);
});
