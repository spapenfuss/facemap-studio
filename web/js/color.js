// Personal color analysis engine (pure functions; no DOM except the optional canvas passed to measureFace).
//
// How it follows real seasonal color analysis
//   * Three dimensions decide a season: temperature (warm/cool undertone), depth (light/deep) and chroma/clarity
//     (bright/clear vs soft/muted). 12 seasons = the 4 seasons x 3 sub-seasons, each with one "primary" dimension.
//   * A professional session compares drapes in groups: warm vs cool first, then bright vs muted, then light vs deep,
//     then signature colors of the leading candidates. The analyst *looks* at the face. We combine
//       (1) what is measured from the photo (skin, brow/hair, iris, with a white-balance estimate), and
//       (2) the person's own judgement of each comparison (votes),
//     because a still photo cannot change when a fabric moves - the photograph stays untouched.
//   * evaluateDrape() is a transparent *model* of the effects an analyst looks for (brightness, dullness, yellow cast,
//     redness, shadows, harmony, contrast). It is an explanation aid, not a measurement of a real fabric on real skin.

// ---------------------------------------------------------------- color math ----
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
export function hexToRgb(h) { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function rgbToHex(r, g, b) { return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join(''); }
export function rgbToLab(r, g, b) {
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.0721750 * B;
  const Z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export const hexToLab = (h) => rgbToLab(...hexToRgb(h));
export const labHue = (a, b) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
const angDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Warm/cool character of a color, -1 (cool) .. +1 (warm). Hue-based for chromatic colors, b*-based for neutrals. */
export function warmth(lab) {
  const [, a, b] = lab, C = Math.hypot(a, b), h = labHue(a, b);
  const dW = angDist(h, 55), dC = angDist(h, 320);
  const wh = (dC - dW) / (dC + dW + 1e-9);
  const wn = clamp(b / 12, -1, 1);
  const k = clamp(C / 25, 0, 1);
  return k * wh + (1 - k) * wn;
}

// ------------------------------------------------------------------- seasons ----
// T temperature (-1 cool .. +1 warm), D depth (-1 light .. +1 deep), C chroma (-1 muted .. +1 bright), P primary dimension.
export const SEASONS = [
  { id: 'light-spring',  name: 'Light Spring',  family: 'Spring', T: 0.5,  D: -0.7, C: 0.3,  P: 'D', blurb: 'Warm, light and clear. Delicate, fresh colors with a hint of sunshine.',
    best: ['#F8B7A0', '#F6CFA0', '#F3E6A0', '#A8DDB5', '#F59FAA', '#7FD6D6', '#FFE0C2', '#E9C9A0'], avoid: ['#111111', '#5A1632', '#6B7A8F', '#8C8F99', '#2B2B5E'],
    metals: 'Light gold, champagne, rose gold', makeup: { blush: 'Peach, apricot, warm pink', lips: 'Peachy coral, warm pink, light salmon', eyes: 'Champagne, warm peach, soft teal, golden brown' } },
  { id: 'true-spring',   name: 'True Spring',   family: 'Spring', T: 0.9,  D: -0.1, C: 0.5,  P: 'T', blurb: 'Warm, medium and clear. Sunny, golden, lively colors.',
    best: ['#FF4A2E', '#FF8A3D', '#F2B705', '#00A896', '#3CB44B', '#FF7F6B', '#F5E6C8', '#C68B59'], avoid: ['#8A8D96', '#1A1A1A', '#C8A2C8', '#4B5563', '#6B3A5B'],
    metals: 'Yellow gold, brass, copper', makeup: { blush: 'Warm coral, apricot', lips: 'Poppy red, coral, orange-red', eyes: 'Golden brown, warm green, turquoise, bronze' } },
  { id: 'bright-spring', name: 'Bright Spring', family: 'Spring', T: 0.35, D: 0.1,  C: 1.0,  P: 'C', blurb: 'Clear, vivid and a touch warm, with higher contrast. Saturated colors work.',
    best: ['#FF5E5B', '#00C2D1', '#FF3E9D', '#B5E61D', '#FFD400', '#1E7BFF', '#FFFFFF', '#3B2F2F'], avoid: ['#A08C8C', '#8A7F6A', '#6B5B5B', '#C9B8A6', '#7A6F8A'],
    metals: 'Bright gold, polished silver (either can work)', makeup: { blush: 'Bright coral, warm hot pink', lips: 'Bright coral, clear red, hot pink', eyes: 'Aqua, bright teal, chocolate brown, vivid violet' } },
  { id: 'light-summer',  name: 'Light Summer',  family: 'Summer', T: -0.5, D: -0.7, C: -0.3, P: 'D', blurb: 'Cool, light and soft. Gentle, airy, powdery colors.',
    best: ['#F4C2D7', '#BFD7EA', '#CDB8E8', '#A8B8E0', '#BFE3D6', '#E8D9E3', '#C9D3DB', '#F0B6C8'], avoid: ['#FF6A00', '#111111', '#C2410C', '#D4A017', '#5E3A1E'],
    metals: 'Silver, white gold, rose gold', makeup: { blush: 'Soft rose, cool peach-pink', lips: 'Soft rose, raspberry sheer, pink-nude', eyes: 'Taupe, soft lavender, powder blue, soft grey' } },
  { id: 'true-summer',   name: 'True Summer',   family: 'Summer', T: -0.9, D: -0.1, C: -0.5, P: 'T', blurb: 'Cool, medium and soft. Rosy, blue-based colors with a dusty edge.',
    best: ['#D77FA1', '#7E9CCB', '#9DB8A5', '#8B3A62', '#6E7FA3', '#B9A2C9', '#E6E0EA', '#5C6B8C'], avoid: ['#FF6A00', '#D97706', '#8B4513', '#F2B705', '#111111'],
    metals: 'Silver, platinum', makeup: { blush: 'Rose, cool pink', lips: 'Rose, berry, raspberry', eyes: 'Soft plum, slate blue, cool taupe, mauve' } },
  { id: 'soft-summer',   name: 'Soft Summer',   family: 'Summer', T: -0.35, D: 0.1, C: -1.0, P: 'C', blurb: 'Cool-leaning neutral, very soft and dusty. Blended, low-intensity colors.',
    best: ['#A99A94', '#B88AA3', '#6F7F8F', '#7D5A7B', '#8FA89B', '#9AA7B5', '#D8C7C9', '#6E8B86'], avoid: ['#FF0000', '#FFD400', '#111111', '#00E0FF', '#FF6A00'],
    metals: 'Soft silver, rose gold, antique brass', makeup: { blush: 'Dusty rose, muted mauve', lips: 'Mauve, dusty rose, muted berry', eyes: 'Taupe, smoky plum, soft sage, grey-brown' } },
  { id: 'soft-autumn',   name: 'Soft Autumn',   family: 'Autumn', T: 0.35, D: 0.1,  C: -0.9, P: 'C', blurb: 'Warm-leaning neutral, soft and earthy. Gentle, blended warm colors.',
    best: ['#C8A27A', '#5F8D87', '#C98E8A', '#9AA27A', '#B98B5A', '#8E9A6B', '#E8D8BC', '#A66E5B'], avoid: ['#111111', '#FF2E93', '#00B7FF', '#FFFFFF', '#6B2FFF'],
    metals: 'Soft gold, rose gold, antique brass', makeup: { blush: 'Soft terracotta, dusty peach', lips: 'Muted rose, soft terracotta, warm nude', eyes: 'Olive, soft bronze, warm taupe, muted teal' } },
  { id: 'true-autumn',   name: 'True Autumn',   family: 'Autumn', T: 0.9,  D: 0.2,  C: -0.2, P: 'T', blurb: 'Warm, rich and earthy. Golden, spicy, leafy colors.',
    best: ['#E07A1F', '#6B7A2E', '#D9A116', '#B5482A', '#2F5D3A', '#8A4B2A', '#F0DDB4', '#1F7A78'], avoid: ['#E0007A', '#6A5ACD', '#FFFFFF', '#111111', '#9AA5B1'],
    metals: 'Gold, copper, bronze', makeup: { blush: 'Terracotta, warm apricot', lips: 'Brick, terracotta, warm red', eyes: 'Copper, olive, bronze, warm brown' } },
  { id: 'deep-autumn',   name: 'Deep Autumn',   family: 'Autumn', T: 0.5,  D: 0.8,  C: -0.1, P: 'D', blurb: 'Warm-leaning, deep and rich. Dark, earthy colors with warmth.',
    best: ['#4A2C20', '#1F5E5B', '#7A1F2B', '#3F4A2A', '#8B1E1E', '#B05A2F', '#E8D5B0', '#2C3E2D'], avoid: ['#F4C2D7', '#BFD7EA', '#FFFFFF', '#C9D3DB', '#E6E0EA'],
    metals: 'Antique gold, bronze, copper', makeup: { blush: 'Deep terracotta, warm berry', lips: 'Brick red, chocolate rose, deep warm berry', eyes: 'Dark chocolate, deep olive, bronze, forest' } },
  { id: 'deep-winter',   name: 'Deep Winter',   family: 'Winter', T: -0.5, D: 0.8,  C: 0.3,  P: 'D', blurb: 'Cool-leaning, deep and strong. Dark, rich colors with a cool edge.',
    best: ['#4A0E2E', '#14213D', '#0B6E4F', '#7A1236', '#2D1E5F', '#B0003A', '#F5F5F5', '#111111'], avoid: ['#F5C6A0', '#D9A116', '#E8D8BC', '#C8A27A', '#9AA27A'],
    metals: 'Silver, white gold, dark gunmetal', makeup: { blush: 'Deep rose, burgundy-pink', lips: 'Black cherry, deep berry, blue-red', eyes: 'Charcoal, deep plum, navy, emerald' } },
  { id: 'true-winter',   name: 'True Winter',   family: 'Winter', T: -0.9, D: 0.2,  C: 0.5,  P: 'T', blurb: 'Cool, strong and clear. Icy, jewel-toned, high-contrast colors.',
    best: ['#111111', '#FFFFFF', '#DC143C', '#1E3A8A', '#D6336C', '#0F8B5D', '#5B2A86', '#C0C8D8'], avoid: ['#E07A1F', '#D9A116', '#C8A27A', '#8A6A3A', '#F0DDB4'],
    metals: 'Silver, platinum', makeup: { blush: 'Cool pink, blue-rose', lips: 'Blue-red, fuchsia, cool pink', eyes: 'Charcoal, icy pink, navy, plum' } },
  { id: 'bright-winter', name: 'Bright Winter', family: 'Winter', T: -0.4, D: 0.1,  C: 1.0,  P: 'C', blurb: 'Cool-leaning, vivid and clear with high contrast. Electric, saturated colors.',
    best: ['#E0007A', '#00A86B', '#1E6BFF', '#E10600', '#8A2BE2', '#FFFFFF', '#111111', '#00C2D1'], avoid: ['#A89A8A', '#8A7F6A', '#C9A27A', '#9C6B4E', '#B5A0A8'],
    metals: 'Bright silver, white gold', makeup: { blush: 'Vivid cool pink, raspberry', lips: 'True red, fuchsia, vivid berry', eyes: 'Black liner, electric blue, violet, icy shimmer' } },
];
export const seasonById = (id) => SEASONS.find((s) => s.id === id);

/** Probability of each season for estimated dimensions {T, D, C} (each -1..1). The primary dimension counts double. */
export function classify(dims, tau = 0.45) {
  const sc = SEASONS.map((s) => {
    let d = 0;
    for (const k of ['T', 'D', 'C']) d += (s.P === k ? 2.0 : 1.0) * Math.pow(dims[k] - s[k], 2);
    return d;
  });
  const m = Math.min(...sc), ex = sc.map((d) => Math.exp(-(d - m) / tau)), z = ex.reduce((a, b) => a + b, 0);
  return SEASONS.map((s, i) => ({ season: s, p: ex[i] / z, dist: sc[i] })).sort((a, b) => b.p - a.p);
}

// ------------------------------------------------------- measuring a photograph ----
const IRIS_R = [468, 469, 470, 471, 472], IRIS_L = [473, 474, 475, 476, 477];
const EYE_R = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7];
const EYE_L = [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249];
const BROW_R = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46], BROW_L = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];

const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
function labMean(px) { let L = 0, a = 0, b = 0; for (const p of px) { const l = rgbToLab(p[0], p[1], p[2]); L += l[0]; a += l[1]; b += l[2]; } const n = px.length || 1; return [L / n, a / n, b / n]; }

/**
 * Measure the person's own coloring from a photo.
 * @param {CanvasRenderingContext2D} ctx  context of a canvas holding the (unmirrored, unfiltered) photo, size W x H
 * @param {Float32Array} lm 478*3 normalised landmarks (x/W, y/H, z/W)
 * @returns measurement object, or null when the face is unusable
 */
export function measureFace(ctx, lm, W, H) {
  const P = (i) => [lm[i * 3] * W, lm[i * 3 + 1] * H];
  const a = P(468), b = P(473), ied = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(ied > 25)) return null;
  let img;
  try { img = ctx.getImageData(0, 0, W, H).data; } catch { return null; }
  const at = (x, y) => { const xi = Math.round(x), yi = Math.round(y); if (xi < 0 || yi < 0 || xi >= W || yi >= H) return null; const o = (yi * W + xi) * 4; return [img[o], img[o + 1], img[o + 2]]; };
  const disc = (cx, cy, r, step = 1.5) => { const out = []; for (let y = -r; y <= r; y += step) for (let x = -r; x <= r; x += step) if (x * x + y * y <= r * r) { const p = at(cx + x, cy + y); if (p) out.push(p); } return out; };
  const polyPts = (idx, step = 1.5) => {
    const pts = idx.map(P); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const inside = (x, y) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
    const out = []; for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) if (inside(x, y)) { const p = at(x, y); if (p) out.push(p); }
    return out;
  };

  // ---- white balance from the eye whites (approximate; strength-limited)
  const sclera = [];
  for (const idx of [EYE_R, EYE_L]) {
    const px = polyPts(idx, 1).map((p) => ({ p, l: 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2] }));
    px.sort((u, v) => v.l - u.l);
    for (const q of px.slice(0, Math.max(0, Math.floor(px.length * 0.30)))) {
      const mx = Math.max(...q.p), mn = Math.min(...q.p);
      if (q.l > 90 && (mx - mn) / (mx + 1) < 0.28) sclera.push(q.p);      // bright and not strongly colored = eye white
    }
  }
  let gains = [1, 1, 1], wbApplied = false;
  if (sclera.length >= 25) {
    const m = [0, 1, 2].map((c) => sclera.reduce((s, p) => s + p[c], 0) / sclera.length), g = (m[0] + m[1] + m[2]) / 3;
    gains = m.map((v) => clamp(1 + 0.7 * (g / (v + 1e-6) - 1), 0.88, 1.14));
    wbApplied = true;
  }
  const wb = (p) => [clamp(p[0] * gains[0], 0, 255), clamp(p[1] * gains[1], 0, 255), clamp(p[2] * gains[2], 0, 255)];
  const trimmed = (px) => {                                    // drop the darkest/brightest 20 % (shadows, shine) then average
    const s = px.map((p) => ({ p: wb(p), l: 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2] })).sort((u, v) => u.l - v.l);
    const lo = Math.floor(s.length * 0.2), hi = Math.ceil(s.length * 0.8);
    return s.slice(lo, hi).map((q) => q.p);
  };

  // ---- skin: the same four facial regions on every photo
  const rS = 0.11 * ied;
  const regionsDef = [
    { id: 'cheekR', label: 'Right cheek', c: P(50) }, { id: 'cheekL', label: 'Left cheek', c: P(280) },
    { id: 'forehead', label: 'Forehead', c: [(P(151)[0] + P(9)[0]) / 2, (P(151)[1] + P(9)[1]) / 2 + 0.05 * ied] },
    { id: 'chin', label: 'Chin', c: [(P(199)[0] + P(152)[0]) / 2, (P(199)[1] + P(152)[1]) / 2 - 0.10 * ied] },
  ];
  const regions = regionsDef.map((r) => {
    const px = disc(r.c[0], r.c[1], rS);
    if (px.length < 12) return { ...r, ok: false, r: rS };
    const t = trimmed(px), lab = labMean(t);
    return { ...r, ok: true, r: rS, lab, rgb: [0, 1, 2].map((c) => t.reduce((s, p) => s + p[c], 0) / t.length) };
  });
  const okR = regions.filter((r) => r.ok);
  if (okR.length < 2) return null;
  const w = { cheekR: 1.2, cheekL: 1.2, forehead: 0.8, chin: 0.8 };
  const sw = okR.reduce((s, r) => s + w[r.id], 0);
  const skin = [0, 1, 2].map((k) => okR.reduce((s, r) => s + w[r.id] * r.lab[k], 0) / sw);

  // ---- brows (hair proxy) and optional hairline band
  const browDark = (idx) => { const px = polyPts(idx, 1).map((p) => ({ p: wb(p), l: p[0] * 0.299 + p[1] * 0.587 + p[2] * 0.114 })).sort((u, v) => u.l - v.l); return px.slice(0, Math.max(3, Math.floor(px.length * 0.4))).map((q) => q.p); };
  const browPx = [...browDark(BROW_R), ...browDark(BROW_L)];
  const browLab = browPx.length >= 6 ? labMean(browPx) : null;
  const top = P(10), band = disc(top[0], top[1] - 0.45 * ied, 0.28 * ied, 2);
  const bandLab = band.length > 20 ? labMean(trimmed(band)) : null;
  let hair = browLab;
  let hairSource = browLab ? 'brows' : 'none';
  if (bandLab && browLab && bandLab[0] < skin[0] - 12) { hair = [0.6 * bandLab[0] + 0.4 * browLab[0], 0.6 * bandLab[1] + 0.4 * browLab[1], 0.6 * bandLab[2] + 0.4 * browLab[2]]; hairSource = 'hair + brows'; }
  else if (!browLab && bandLab && bandLab[0] < skin[0] - 12) { hair = bandLab; hairSource = 'hair'; }
  if (hair && hair[0] > skin[0] - 4) { hair = [skin[0] - 14, hair[1], hair[2]]; hairSource += ' (very low contrast)'; }

  // ---- irises
  const eyeLab = [];
  for (const ring of [IRIS_R, IRIS_L]) {
    const c = P(ring[0]); let rr = 0; for (let i = 1; i < 5; i++) { const q = P(ring[i]); rr += Math.hypot(q[0] - c[0], q[1] - c[1]); } rr /= 4;
    const px = [];
    for (let k = 0; k < 24; k++) for (const f of [0.5, 0.7]) { const t = (k / 24) * Math.PI * 2, p = at(c[0] + Math.cos(t) * rr * f, c[1] + Math.sin(t) * rr * f); if (p) px.push(wb(p)); }
    if (px.length > 10) eyeLab.push(labMean(px));
  }
  const eye = eyeLab.length ? [0, 1, 2].map((k) => eyeLab.reduce((s, l) => s + l[k], 0) / eyeLab.length) : null;

  // ---- quality
  const cheekDiff = regions[0].ok && regions[1].ok ? Math.abs(regions[0].lab[0] - regions[1].lab[0]) : 0;
  const flags = [];
  if (cheekDiff > 8) flags.push({ id: 'uneven', text: 'Lighting looks uneven (one cheek is clearly brighter). Face a window or turn so light hits both sides equally.' });
  if (skin[0] < 38) flags.push({ id: 'dark', text: 'The photo is quite dark. Use brighter, indirect daylight.' });
  if (skin[0] > 88) flags.push({ id: 'bright', text: 'Skin looks over-exposed. Move away from direct light or lower the exposure.' });
  if (Math.hypot(skin[1], skin[2]) < 7) flags.push({ id: 'flat', text: 'Very little color in the skin. A filter, black-and-white mode or heavy makeup would skew the result.' });
  if (!wbApplied) flags.push({ id: 'wb', text: 'Could not find enough of the eye whites to estimate the lighting color, so no color correction was applied.' });
  if (!hair) flags.push({ id: 'hair', text: 'Brow/hair color could not be read; contrast is estimated from skin and eyes only.' });
  const quality = clamp(1 - 0.28 * flags.filter((f) => f.id !== 'wb' && f.id !== 'hair').length - (wbApplied ? 0 : 0.12) - (hair ? 0 : 0.15) - clamp(cheekDiff / 40, 0, 0.2), 0.1, 1);

  const dims = dimsFromMeasurement({ skin, hair, eye });
  return { skin, hair, eye, hairSource, regions, wbApplied, gains, cheekDiff, flags, quality, dims, ied };
}

/** Convert measured Lab values into temperature / depth / chroma estimates (-1..1). */
export function dimsFromMeasurement({ skin, hair, eye }) {
  const [Ls, as, bs] = skin, Cs = Math.hypot(as, bs), hs = labHue(as, bs);
  const tSkin = clamp((hs - 58) / 10, -1, 1);
  let tHair = 0, tEye = 0;
  if (hair) { const C = Math.hypot(hair[1], hair[2]), h = labHue(hair[1], hair[2]); tHair = clamp((h - 50) / 25, -1, 1) * clamp(C / 14, 0, 1); }
  if (eye) { const C = Math.hypot(eye[1], eye[2]), h = labHue(eye[1], eye[2]); tEye = Math.cos(((h - 55) * Math.PI) / 180) * clamp(C / 12, 0, 1); }
  const T = clamp(0.65 * tSkin + 0.2 * tHair + 0.15 * tEye, -1, 1);
  const Lh = hair ? hair[0] : Ls - 35, Le = eye ? eye[0] : Ls - 40;
  const Lmix = 0.5 * Ls + 0.3 * Lh + 0.2 * Le;
  const D = clamp((50 - Lmix) / 16, -1, 1);
  const contrast = clamp((Ls - 0.7 * Lh - 0.3 * Le) / 50, 0, 1.3);
  const eyeC = eye ? Math.hypot(eye[1], eye[2]) : 10;
  const chromaN = clamp((0.5 * eyeC + 0.5 * Cs - 12) / 18, 0, 1);
  const C = clamp(2 * (0.6 * clamp(contrast, 0, 1) + 0.4 * chromaN) - 1, -1, 1);
  return { T, D, C, contrast, Cs, hs };
}

// ------------------------------------------------------------- drape model ----
/**
 * Modelled effect of a drape color on this person (0..100 per characteristic). `meas.dims` and `meas.skin` are used.
 * Higher is "more of": brightness/harmony/contrast are good when high; dullness/yellow/redness/shadows are good when low.
 */
export function evaluateDrape(meas, hex) {
  const lab = hexToLab(hex), [Ld, ad, bd] = lab, Cd = Math.hypot(ad, bd), hd = labHue(ad, bd);
  const [Ls, as, bs] = meas.skin, { T, D, C, contrast } = meas.dims;
  const wd = warmth(lab);
  const sens = 0.55 + 0.45 * Math.abs(T);                                        // neutral people tolerate more
  const harmony = clamp(1 - (sens * Math.abs(wd - T)) / 2, 0, 1);
  const Cdn = clamp(Cd / 70, 0, 1), Cpn = (C + 1) / 2;
  const clarityMatch = 1 - Math.abs(Cdn - Cpn);
  const Ddn = clamp((55 - Ld) / 45, -1, 1), valueMatch = 1 - Math.abs(Ddn - D) / 2;
  const cdrape = clamp(Math.abs(Ld - Ls) / 50, 0, 1.3), contrastMatch = 1 - clamp(Math.abs(cdrape - contrast), 0, 1);
  const washout = Math.exp(-Math.pow((Ld - Ls) / 14, 2)) * (1 - Cdn);
  const brightness = 100 * (0.45 * harmony + 0.35 * clarityMatch + 0.2 * valueMatch);
  const dullness = 100 * clamp(0.5 * (1 - harmony) + 0.35 * (1 - clarityMatch) + 0.3 * washout, 0, 1);
  const yellow = 100 * clamp((wd - T) / 1.2, 0, 1);                              // a drape warmer than the undertone pulls yellow/sallow
  const greenness = Math.max(0, Math.cos(((hd - 150) * Math.PI) / 180)) * Cdn;
  const susceptible = clamp((as - 12) / 10, 0, 1) + 0.3;
  const redness = 100 * clamp(greenness * susceptible * 1.2 + 0.25 * Math.max(0, (T - wd) / 2) * (as > 16 ? 1 : 0), 0, 1);
  const shadows = 100 * clamp(((Ls - Ld) / 60) * (1.1 - 0.7 * clamp(contrast, 0, 1)) + (1 - harmony) * 0.15, 0, 1);
  const contrastScore = 100 * contrastMatch;
  const penalty = (yellow + redness + dullness + shadows) / 4;
  const overall = clamp(0.3 * harmony * 100 + 0.2 * clarityMatch * 100 + 0.15 * valueMatch * 100 + 0.15 * contrastMatch * 100 + 0.2 * (100 - penalty), 0, 100);
  return {
    hex, overall, harmony: harmony * 100, brightness, dullness, yellow, redness, shadows, contrast: contrastScore,
    overpowers: cdrape - contrast > 0.35, warmth: wd,
  };
}

// ---------------------------------------------------------------- the session ----
/** Palette families for each comparison round. Pairs are matched in lightness/chroma as far as possible. */
export const ROUNDS = {
  temp: {
    title: 'Warm vs cool', look: 'Which color makes your skin look clearer and your eyes brighter, and which makes it look yellow, grey or tired?',
    A: { name: 'Warm', colors: [['#E8744D', 'Coral'], ['#D6A24A', 'Golden camel']] },
    B: { name: 'Cool', colors: [['#CF5E94', 'Orchid rose'], ['#6F86C9', 'Periwinkle']] },
  },
  chroma: {
    title: 'Bright vs muted', look: 'Does the color look vivid and alive next to your face, or does it overpower you? Does the soft version look flat?',
    warm: { A: { name: 'Bright', colors: [['#FF5B2E', 'Clear orange-red'], ['#F7B500', 'Vivid gold']] }, B: { name: 'Muted', colors: [['#B86F55', 'Terracotta'], ['#A89256', 'Olive mustard']] } },
    cool: { A: { name: 'Bright', colors: [['#E0007A', 'Hot pink'], ['#2F6BFF', 'Royal blue']] }, B: { name: 'Muted', colors: [['#B07A8C', 'Dusty mauve'], ['#7C8DA6', 'Slate blue']] } },
  },
  depth: {
    title: 'Light vs deep', look: 'Does the light color wash you out, or does the deep color swallow you up? Look at how much your face stands out.',
    warm: { A: { name: 'Light', colors: [['#F6C9A8', 'Peach'], ['#F3E3A1', 'Butter']] }, B: { name: 'Deep', colors: [['#7A3B24', 'Chestnut'], ['#3E5B3A', 'Deep olive']] } },
    cool: { A: { name: 'Light', colors: [['#F0C4D8', 'Baby pink'], ['#C9D6F2', 'Powder blue']] }, B: { name: 'Deep', colors: [['#5A1632', 'Burgundy'], ['#1B2A5E', 'Navy']] } },
  },
  neutrals: {
    title: 'Neutrals and metals', look: 'Cool white and black, or ivory and espresso? These are the colors you will wear most.',
    A: { name: 'Cool neutrals', colors: [['#FFFFFF', 'Optic white'], ['#1A1A1F', 'Soft black'], ['#C8CCD2', 'Silver']] },
    B: { name: 'Warm neutrals', colors: [['#F3E7CE', 'Ivory'], ['#4B3426', 'Espresso'], ['#D4AF37', 'Gold']] },
  },
};

export class Session {
  /** @param meas result of measureFace() */
  constructor(meas) {
    this.meas = meas;
    this.votes = {};            // roundId -> 'A' | 'B' | 'same'
    this.finalVotes = [];       // vote on the confirmation round: season id of the preferred candidate
  }
  vote(round, v) { this.votes[round] = v; }

  /** Warm/cool preference from the round-1 vote (+1 warm, -1 cool, 0 none). */
  get tempFamily() {
    const v = this.votes.temp, T = this.meas.dims.T;
    if (v === 'A') return 'warm'; if (v === 'B') return 'cool';
    return T >= 0 ? 'warm' : 'cool';
  }
  /** Palette set for a round, using the temperature found so far. */
  round(id) {
    const R = ROUNDS[id];
    if (id === 'temp' || id === 'neutrals') return R;
    return { title: R.title, look: R.look, ...R[this.tempFamily] };
  }
  /** Current combined estimate of the three dimensions, with how much of it came from the person's own votes. */
  estimate() {
    const M = this.meas.dims;
    const v = (id, a, b) => (this.votes[id] === 'A' ? a : this.votes[id] === 'B' ? b : 0);
    const vT = v('temp', 1, -1), vC = v('chroma', 1, -1), vD = v('depth', -1, 1);
    // photo measurement and the person's own vote count about equally (the vote slightly more); 'same' = the photo is trusted less
    const T = this.votes.temp && this.votes.temp !== 'same' ? clamp(0.45 * M.T + 0.55 * vT, -1, 1) : this.votes.temp === 'same' ? 0.6 * M.T : M.T;
    const C = this.votes.chroma && this.votes.chroma !== 'same' ? clamp(0.45 * M.C + 0.55 * vC, -1, 1) : this.votes.chroma === 'same' ? 0.6 * M.C : M.C;
    const D = this.votes.depth && this.votes.depth !== 'same' ? clamp(0.45 * M.D + 0.55 * vD, -1, 1) : this.votes.depth === 'same' ? 0.6 * M.D : M.D;
    return { T, D, C };
  }
  ranking() {
    const r = classify(this.estimate());
    // the neutrals round nudges temperature-consistent seasons
    const nv = this.votes.neutrals;
    if (nv === 'A' || nv === 'B') for (const e of r) { const warmSeason = e.season.T > 0; e.p *= (nv === 'B') === warmSeason ? 1.25 : 0.8; }
    // the confirmation vote favours the chosen season
    for (const id of this.finalVotes) { const e = r.find((x) => x.season.id === id); if (e) e.p *= 1.6; }
    const z = r.reduce((s, e) => s + e.p, 0); r.forEach((e) => (e.p /= z));
    return r.sort((a, b) => b.p - a.p);
  }
  /** The two leading candidates, used for the confirmation round. */
  candidates() { return this.ranking().slice(0, 2).map((e) => e.season); }
  confirmationRound() {
    const [s1, s2] = this.candidates();
    return {
      title: 'Season confirmation', look: 'Compare the signature colors of your two leading seasons. Which set looks best on you all the way through?',
      A: { name: s1.name, seasonId: s1.id, colors: [[s1.best[0], 'Signature 1'], [s1.best[3], 'Signature 2'], [s1.best[5], 'Signature 3']] },
      B: { name: s2.name, seasonId: s2.id, colors: [[s2.best[0], 'Signature 1'], [s2.best[3], 'Signature 2'], [s2.best[5], 'Signature 3']] },
    };
  }
  /** Final result with a plain-language confidence and the evidence behind it. */
  result() {
    const rank = this.ranking(), top = rank[0], second = rank[1], est = this.estimate();
    const votesGiven = ['temp', 'chroma', 'depth'].filter((k) => this.votes[k] && this.votes[k] !== 'same').length;
    const agree = ['temp', 'chroma', 'depth'].filter((k) => {
      const v = this.votes[k]; if (!v || v === 'same') return false;
      const m = this.meas.dims[k === 'temp' ? 'T' : k === 'chroma' ? 'C' : 'D'], sgn = k === 'depth' ? (v === 'B' ? 1 : -1) : (v === 'A' ? 1 : -1);
      return Math.sign(m) === sgn && Math.abs(m) > 0.12;
    }).length;
    let conf = 0.28 + 0.5 * (top.p - second.p) + 0.1 * votesGiven + 0.06 * agree + 0.1 * this.meas.quality;
    conf = clamp(conf, 0.1, 0.9);                       // never claim certainty from one photograph
    const label = conf > 0.62 ? 'Fairly confident' : conf > 0.42 ? 'Moderate' : 'Low';
    return { top, second, rank, est, confidence: conf, confidenceLabel: label, votesGiven, agree };
  }
}
