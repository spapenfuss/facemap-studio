// Canvas renderer for the primitives produced by the C++ engine.
// Coordinates from the engine are video pixels; `view` maps them to the (zoomed, mirrored) stage.
import { KIND } from './engine.js';

// All layers start switched off; `group` decides which toolbar tab the toggle lives in.
export const LAYERS = [
  { id: 'brows',     group: 'brows', label: 'Brow template', color: '#ffffff', kinds: [KIND.BROW_TARGET, KIND.BROW_ANGULAR, KIND.BROW_POINT], on: false },
  { id: 'guides',    group: 'brows', label: 'Map lines',     color: '#ffffff', kinds: [], on: false },
  { id: 'steps',     group: 'brows', label: 'Step numbers',  color: '#ffffff', kinds: [], on: false },
  { id: 'diamond',   group: 'brows', label: 'Diamond frame', color: '#ffffff', kinds: [], on: false },
  { id: 'contour',   group: 'face',  label: 'Contour',       color: '#a8745a', kinds: [KIND.CONTOUR], on: false },
  { id: 'bronzer',   group: 'face',  label: 'Bronzer',       color: '#e8963c', kinds: [KIND.BRONZER], on: false },
  { id: 'blush',     group: 'face',  label: 'Blush',         color: '#ff5f93', kinds: [KIND.BLUSH], on: false },
  { id: 'highlight', group: 'face',  label: 'Highlight',     color: '#ffe8a3', kinds: [KIND.HIGHLIGHT], on: false },
  { id: 'eyes',      group: 'face',  label: 'Eye makeup',    color: '#a77bff', kinds: [KIND.EYE_LID, KIND.EYE_OUTERV, KIND.EYE_CREASE, KIND.EYE_INNER, KIND.EYE_WING], on: false },
  { id: 'labels',    group: 'face',  label: 'Labels',        color: '#cfc6bf', kinds: [], on: false },
];
const layerOfKind = {};
for (const l of LAYERS) for (const k of l.kinds) layerOfKind[k] = l.id;
const COLORS = Object.fromEntries(LAYERS.map((l) => [l.id, l.color]));
COLORS.brows = '#2fe3b0';                     // smooth-outline style colour

const NAMES = {
  [KIND.CONTOUR]: ['Contour', 'Jaw contour', 'Temple contour', 'Hairline contour', 'Under-chin contour'],
  [KIND.BRONZER]: ['Bronzer: forehead', 'Bronzer: cheek', 'Bronzer: jaw', 'Bronzer: chin'],
  [KIND.BLUSH]: ['Blush'],
  [KIND.HIGHLIGHT]: ['Highlight: cheekbone', 'Brow bone', 'Nose bridge', "Cupid's bow", 'Chin', 'Forehead'],
  [KIND.EYE_LID]: ['Lid colour'], [KIND.EYE_OUTERV]: ['Outer V'], [KIND.EYE_CREASE]: ['Crease'],
  [KIND.EYE_INNER]: ['Inner glow'], [KIND.EYE_WING]: ['Wing'],
};
const POINT_NAMES = ['START', 'ARCH', 'END'];
const SUF = ['th', 'st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'th', 'th'];
const ord = (n) => `${n}${SUF[n % 10]}`;

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
function centroid(pts) {
  let x = 0, y = 0; const n = pts.length / 2;
  for (let i = 0; i < pts.length; i += 2) { x += pts[i]; y += pts[i + 1]; }
  return [x / n, y / n];
}

function label(ctx, text, x, y, color, placed) {
  ctx.save();
  ctx.font = '600 11px system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 12;
  if (placed) {                                   // nudge away from labels already drawn
    for (const dy of [0, -20, 20, -40, 40, -60, 60]) {
      const r = { x: x - w / 2, y: y + dy - 9, w, h: 18 };
      if (!placed.some((q) => r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y)) { y += dy; placed.push(r); break; }
    }
  }
  ctx.fillStyle = 'rgba(16,12,10,.72)';
  ctx.beginPath(); ctx.roundRect(x - w / 2, y - 9, w, 18, 9); ctx.fill();
  ctx.strokeStyle = hexA(color, 0.9); ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}

// step number in the style of a brow-mapping chart ("1st", "2nd" ...)
function stepText(ctx, text, x, y, alpha) {
  ctx.save();
  ctx.font = '700 15px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 3.5; ctx.strokeStyle = `rgba(10,8,7,${0.75 * alpha})`; ctx.strokeText(text, x, y);
  ctx.fillStyle = `rgba(255,255,255,${alpha})`; ctx.fillText(text, x, y);
  ctx.restore();
}

/**
 * o = { cw, ch, dpr, W, H, s, ox, oy, mirror, layers, opacity, browStyle: 'mapped' | 'smooth' }
 * stage pixel = (ox + x'*s, oy + y*s) where x' = mirror ? W - x : x
 */
export function drawOverlay(ctx, prims, o) {
  const { cw, ch, dpr, W, s, ox, oy, mirror, layers, opacity, browStyle } = o;
  const T = (x, y) => [ox + (mirror ? W - x : x) * s, oy + y * s];
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  if (!prims) return;
  const on = (id) => layers[id] !== false;
  const A = opacity, mapped = browStyle === 'mapped';
  const placed = [];
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // --- makeup zones (soft glow + dashed outline)
  for (const p of prims) {
    const id = layerOfKind[p.kind];
    if (!id || !on(id) || p.kind < 10) continue;
    const col = COLORS[id];
    if (p.kind === KIND.EYE_CREASE) {
      ctx.save(); path(ctx, p.pts, T, false);
      ctx.strokeStyle = hexA('#ffffff', 0.9 * A); ctx.lineWidth = 3.5; ctx.stroke();
      ctx.strokeStyle = hexA('#7a46d8', 0.95 * A); ctx.lineWidth = 1.8; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.restore();
      continue;
    }
    if (p.kind === KIND.EYE_WING) {
      ctx.save(); path(ctx, p.pts, T);
      ctx.fillStyle = hexA('#2a1540', 0.55 * A); ctx.fill();
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

  // --- brows: smooth-outline style (the mapped style is drawn by the map lines below)
  for (const side of [0, 1]) {
    const tgt = prims.find((p) => p.kind === KIND.BROW_TARGET && p.side === side);
    if (on('brows') && tgt && !mapped) {
      ctx.save();
      path(ctx, tgt.pts, T);
      ctx.fillStyle = hexA(COLORS.brows, 0.10 * A); ctx.fill();
      ctx.shadowColor = hexA(COLORS.brows, 0.9); ctx.shadowBlur = 8;
      ctx.strokeStyle = hexA(COLORS.brows, 0.98 * A); ctx.lineWidth = 2.2; ctx.stroke();
      ctx.restore();
    }
  }

  // --- brow-map lines (numbered like a brow-mapping chart)
  for (const p of prims) {
    if (p.kind !== KIND.BROW_MAP) continue;
    const outline = p.sub === 8 || p.sub === 9;
    const layer = outline ? 'brows' : p.sub === 11 ? 'diamond' : 'guides';
    if (!on(layer) || (outline && !mapped)) continue;
    ctx.save(); path(ctx, p.pts, T, false);
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 3;
    ctx.strokeStyle = `rgba(255,255,255,${(outline ? 1 : p.sub === 12 ? 0.8 : 0.9) * A})`;
    ctx.lineWidth = outline ? 2.6 : p.sub === 2 ? 1.9 : 1.5;
    if (p.sub === 10) ctx.setLineDash([8, 6]);
    if (p.sub === 12) ctx.setLineDash([3, 5]);
    if (p.sub === 13) ctx.setLineDash([10, 4]);
    ctx.stroke(); ctx.restore();

    if (p.sub === 13 && on('steps')) {
      const e0 = T(p.pts[0], p.pts[1]), e1 = T(p.pts[2], p.pts[3]);
      const dx = e0[0] - e1[0], dy = e0[1] - e1[1], l = Math.hypot(dx, dy) || 1;
      stepText(ctx, 'Bottom line', e0[0] + (dx / l) * 52, e0[1] + (dy / l) * 52 + 2, 0.95 * A);
    }
    if (!on('steps') || !on(layer) || p.sub > 9) continue;
    const n = p.pts.length / 2, T0 = T(p.pts[0], p.pts[1]), T1 = T(p.pts[(n - 1) * 2], p.pts[(n - 1) * 2 + 1]);
    const m = Math.floor((n - 1) / 2), Tm = T(p.pts[m * 2], p.pts[m * 2 + 1]);
    const a = 0.95 * A;
    switch (p.sub) {
      case 1: stepText(ctx, ord(1), T0[0], T0[1] - 14, a); break;
      case 2: stepText(ctx, ord(2), T0[0], T0[1] - 13, a); stepText(ctx, ord(2), T1[0], T1[1] - 13, a); break;
      case 3: stepText(ctx, ord(3), Tm[0] + (p.side === 0 ? 14 : -14) * (mirror ? -1 : 1), Tm[1] + 10, a); break;
      case 4: stepText(ctx, ord(4), Tm[0], Tm[1] + 15, a); break;
      case 5: case 6: stepText(ctx, ord(p.sub), T0[0], T0[1] - 14, a); break;
      case 7: stepText(ctx, ord(7), T1[0], T1[1] + 15, a); break;
      case 8: stepText(ctx, ord(8), (T0[0] + Tm[0]) / 2, (T0[1] + Tm[1]) / 2 - 13, a); break;
      case 9: stepText(ctx, ord(9), Tm[0], Tm[1] + 14, a); break;
      default: break;
    }
  }

  // --- START / ARCH / END markers
  if (on('brows')) {
    for (const p of prims) {
      if (p.kind !== KIND.BROW_POINT) continue;
      const [x, y] = T(p.pts[0], p.pts[1]);
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#0d0a09'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = mapped ? '#ffffff' : COLORS.brows; ctx.stroke();
      ctx.restore();
      if (on('labels') && !on('steps') && p.side === 0) label(ctx, POINT_NAMES[p.sub], x, y - 16, '#2fe3b0', placed);
    }
  }

  // --- labels (only subject's-right + centre zones so the face isn't cluttered)
  if (on('labels')) {
    for (const p of prims) {
      const id = layerOfKind[p.kind];
      if (!id || !on(id) || p.kind < 10 || p.side === 1) continue;
      if (p.kind === KIND.EYE_INNER || p.kind === KIND.EYE_OUTERV || p.kind === KIND.EYE_CREASE) continue;
      if (p.kind === KIND.HIGHLIGHT && p.sub === 1) continue;       // brow-bone label would sit on the brow map
      const names = NAMES[p.kind]; if (!names) continue;
      const [cx, cy] = centroid(p.pts);
      const [x, y] = T(cx, cy);
      label(ctx, names[p.sub] || names[0], x, y, COLORS[id], placed);
    }
  }
}
