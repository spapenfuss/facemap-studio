// Canvas renderer for the primitives produced by the C++ engine.
// Coordinates from the engine are video pixels; `view` maps them to the (zoomed, mirrored) stage.
import { KIND } from './engine.js';

// Layers map to the makeup categories on the Makeup tab; all start switched off.
export const LAYERS = [
  { id: 'contour',   label: 'Contour',   color: '#a8745a', kinds: [KIND.CONTOUR], on: false },
  { id: 'bronzer',   label: 'Bronzer',   color: '#e8963c', kinds: [KIND.BRONZER], on: false },
  { id: 'blush',     label: 'Blush',     color: '#e8798f', kinds: [KIND.BLUSH], on: false },
  { id: 'highlight', label: 'Highlight', color: '#f6d98c', kinds: [KIND.HIGHLIGHT], on: false },
  { id: 'eyeshadow', label: 'Eyeshadow', color: '#a77bff', kinds: [KIND.EYE_LID, KIND.EYE_OUTERV, KIND.EYE_CREASE, KIND.EYE_INNER], on: false },
  { id: 'eyeliner',  label: 'Eyeliner',  color: '#2a1540', kinds: [KIND.EYE_WING], on: false },
  { id: 'lips',      label: 'Lips',      color: '#c9656f', kinds: [], on: false },
];
const layerOfKind = {};
for (const l of LAYERS) for (const k of l.kinds) layerOfKind[k] = l.id;
const COLORS = Object.fromEntries(LAYERS.map((l) => [l.id, l.color]));


function path(ctx, pts, T, close = true) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    const [x, y] = T(pts[i], pts[i + 1]);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  if (close) ctx.closePath();
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const LIP_LOOP = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
const UP_R = [33, 246, 161, 160, 159, 158, 157, 173, 133], UP_L = [263, 466, 388, 387, 386, 385, 384, 398, 362];
const lmPts = (o, idx) => idx.map((i) => [o.lm[i * 3] * o.W, o.lm[i * 3 + 1] * o.H]);
function strokeSmooth(ctx, pts, T) {
  ctx.beginPath();
  pts.forEach(([x, y], k) => { const [X, Y] = T(x, y); if (k === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); });
}
/** Upper-lash liner line drawn from live landmarks, in the season's liner color when known. */
function drawLiner(ctx, o, T, A) {
  if (!o.lipsOn && !o.linerOn) return;
  if (!o.linerOn || !o.lm) return;
  const col = (o.tint && o.tint.eyeliner) || '#2a1540';
  for (const idx of [UP_R, UP_L]) {
    const pts = lmPts(o, idx);
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    strokeSmooth(ctx, pts, T); ctx.strokeStyle = hexA('#ffffff', 0.85 * A); ctx.lineWidth = Math.max(4.5, o.s * 3.2); ctx.stroke();
    strokeSmooth(ctx, pts, T); ctx.strokeStyle = hexA(col, 0.98 * A); ctx.lineWidth = Math.max(2.6, o.s * 1.8); ctx.stroke();
    ctx.restore();
  }
}
/** Lips: a soft color wash for lipstick, and a dashed liner line just outside the natural lip line. */
function drawLips(ctx, o, T, A) {
  if (!o.lipsOn || !o.lm) return;
  const pts = lmPts(o, LIP_LOOP), fill = (o.tint && o.tint.lips) || '#c9656f', line = (o.tint && o.tint.liplin) || '#8f3a4a';
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const out = pts.map(([x, y]) => [cx + (x - cx) * 1.045, cy + (y - cy) * 1.06]);
  ctx.save();
  strokeSmooth(ctx, pts, T); ctx.closePath(); ctx.fillStyle = hexA(fill, 0.55 * A); ctx.fill();
  strokeSmooth(ctx, out, T); ctx.closePath(); ctx.setLineDash([5, 4]); ctx.lineWidth = 2.2;
  ctx.strokeStyle = hexA('#ffffff', 0.9 * A); ctx.stroke(); ctx.setLineDash([]);
  ctx.lineWidth = 1.4; ctx.strokeStyle = hexA(line, 1 * A); ctx.stroke();
  ctx.restore();
}

/**
 * o = { cw, ch, dpr, W, H, s, ox, oy, mirror, layers, opacity, tint, lm }
 * stage pixel = (ox + x'*s, oy + y*s) where x' = mirror ? W - x : x
 */
export function drawOverlay(ctx, prims, o) {
  const { cw, ch, dpr, W, s, ox, oy, mirror, layers, opacity } = o;
  const T = (x, y) => [ox + (mirror ? W - x : x) * s, oy + y * s];
  o = { ...o, W: o.W, H: o.H };
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  if (!prims) return;
  const on = (id) => layers[id] === true;
  const A = opacity;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // --- makeup zones (soft glow + dashed outline)
  for (const p of prims) {
    const id = layerOfKind[p.kind];
    if (!id || !on(id) || p.kind < 10) continue;
    const col = (o.tint && o.tint[id]) || COLORS[id];
    if (p.kind === KIND.EYE_CREASE) {
      ctx.save(); path(ctx, p.pts, T, false);
      ctx.strokeStyle = hexA('#ffffff', 0.9 * A); ctx.lineWidth = 3.5; ctx.stroke();
      ctx.strokeStyle = hexA('#7a46d8', 0.95 * A); ctx.lineWidth = 1.8; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.restore();
      continue;
    }
    if (p.kind === KIND.EYE_WING) {
      ctx.save(); path(ctx, p.pts, T);
      ctx.fillStyle = hexA((o.tint && o.tint.eyeliner) || '#2a1540', 0.75 * A); ctx.fill();
      ctx.strokeStyle = hexA('#ffffff', 0.95 * A); ctx.lineWidth = 1.4; ctx.stroke(); ctx.restore();
      continue;
    }
    const fillA = (p.kind === KIND.HIGHLIGHT ? 0.30 : p.kind === KIND.EYE_INNER ? 0.45 : 0.28) * A;
    ctx.save();
    ctx.shadowColor = hexA(col, 0.8 * A); ctx.shadowBlur = 16;
    path(ctx, p.pts, T); ctx.fillStyle = hexA(col, fillA); ctx.fill();
    ctx.restore();
    ctx.save();
    path(ctx, p.pts, T); ctx.setLineDash([6, 5]); ctx.lineWidth = 1.6;
    ctx.strokeStyle = hexA(p.kind === KIND.HIGHLIGHT ? '#f2c14e' : col, 0.95 * A); ctx.stroke();
    ctx.restore();
  }

  drawLiner(ctx, o, T, A);
  drawLips(ctx, o, T, A);
}
