// Procedural 478-point "face" used by Demo mode and by the automated tests.
// It only places the landmarks the engine actually reads (plus filler points on
// the face surface), in MediaPipe's index layout. Units are centimetres.

export const OVAL_R = [10, 109, 67, 103, 54, 21, 162, 127, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152];
export const OVAL_L = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152];
const OVAL_Y = [-6.0, -5.9, -5.7, -5.3, -4.6, -3.6, -2.3, -0.5, 1.6, 3.4, 4.8, 5.8, 6.9, 7.6, 8.2, 8.6, 8.9, 9.15, 9.3];
const CTRL = [[-6.0, 0], [-5.7, 2.2], [-5.3, 3.4], [-4.6, 4.5], [-3.6, 5.2], [-2.3, 6.0], [-0.5, 6.8], [1.6, 7.1], [3.4, 6.9],
  [4.8, 6.4], [5.8, 5.8], [6.9, 4.9], [7.6, 4.2], [8.2, 3.4], [8.6, 2.7], [8.9, 2.0], [9.15, 1.2], [9.3, 0]];

export const LIPS_OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
const UP_R = [33, 246, 161, 160, 159, 158, 157, 173, 133], LO_R = [33, 7, 163, 144, 145, 153, 154, 155, 133];
const UP_L = [263, 466, 388, 387, 386, 385, 384, 398, 362], LO_L = [263, 249, 390, 373, 374, 380, 381, 382, 362];
const BU_R = [70, 63, 105, 66, 107], BL_R = [46, 53, 52, 65, 55];
const BU_L = [300, 293, 334, 296, 336], BL_L = [276, 283, 282, 295, 285];

export const VARIANTS = {
  oval:    { len: 1.00, fm: 1.00, jm: 1.00, chin: 1.0 },
  round:   { len: 0.84, fm: 1.00, jm: 1.04, chin: 1.1 },
  square:  { len: 0.88, fm: 1.04, jm: 1.14, chin: 1.2 },
  heart:   { len: 1.00, fm: 1.10, jm: 0.84, chin: 0.75 },
  oblong:  { len: 1.20, fm: 1.00, jm: 1.00, chin: 1.0 },
  diamond: { len: 1.02, fm: 0.86, jm: 0.84, chin: 0.85 },
};

const lerp = (a, b, t) => a + (b - a) * t;
function halfWidth(y) {
  if (y <= CTRL[0][0]) return 0;
  for (let i = 1; i < CTRL.length; i++) {
    if (y <= CTRL[i][0]) { const [y0, w0] = CTRL[i - 1], [y1, w1] = CTRL[i]; return lerp(w0, w1, (y - y0) / (y1 - y0)); }
  }
  return 0;
}
const surf = (x, y) => -6.0 * Math.sqrt(Math.max(0, 1 - (x / 8.2) ** 2 - ((y - 1) / 11) ** 2));

/**
 * @param {object} o  { yaw, pitch, roll (deg), variant, W, H, blink (0..1), cx, cy }
 * @returns {Float32Array} 478*3 normalised landmarks (x/W, y/H, z/W)
 */
export function makeDemoFace(o = {}) {
  const { yaw = 0, pitch = 0, roll = 0, variant = 'oval', W = 1280, H = 720, blink = 0, cx = 0.5, cy = 0.5 } = o;
  const V = VARIANTS[variant] || VARIANTS.oval;
  const pts = new Array(478).fill(null);
  const set = (i, x, y, dz = 0) => { pts[i] = [x, y, surf(x, y) - dz]; };   // dz > 0 protrudes toward the camera (smaller z)

  // ---- face outline (variant-controlled)
  const wAt = (y) => {
    let w = halfWidth(y);
    if (y < -2.5) w *= V.fm;
    else if (y > 4.5) w *= V.jm * (y > 7.8 ? V.chin : 1);
    return w;
  };
  OVAL_Y.forEach((y0, k) => {
    const y = y0 < 0 ? y0 * V.len : (y0 > 1 ? y0 * lerp(1, V.len, (y0 - 1) / 8.3) : y0);
    const w = wAt(y0);
    if (k === 0 || k === OVAL_Y.length - 1) set(OVAL_R[k], 0, y);
    else { set(OVAL_R[k], -w, y); set(OVAL_L[k], w, y + 0.0); }
  });
  const yTop = -6.0 * V.len, yChin = 9.3 * V.len;
  set(10, 0, yTop); set(152, 0, yChin); set(151, 0, lerp(yTop, -3.6, 0.35)); set(9, 0, -3.6); set(8, 0, -2.2);

  // ---- eyes (right = negative x). Left side has a slightly different shape on purpose.
  const bl = 1 - 0.92 * blink;
  const eye = (sd, UP, LO, irisC, ring) => {
    const sg = sd === 0 ? -1 : 1;
    const out = { x: sg * 4.55, y: -0.15 + (sd === 0 ? 0.05 : 0) }, inn = { x: sg * 1.65, y: 0.05 };
    for (let k = 0; k < 9; k++) {
      const t = k / 8, x = lerp(out.x, inn.x, t), yb = lerp(out.y, inn.y, t), s = Math.sin(Math.PI * t);
      set(UP[k], x, yb - 0.50 * bl * Math.pow(s, 0.9), 0.2 * s);
      set(LO[k], x, yb + 0.42 * bl * Math.pow(s, 0.9), 0.2 * s);
    }
    set(irisC, sg * 3.1, -0.03, 0.5);
    set(ring[0], sg * 3.1 + 0.6, -0.03, 0.5); set(ring[1], sg * 3.1, -0.63, 0.5);
    set(ring[2], sg * 3.1 - 0.6, -0.03, 0.5); set(ring[3], sg * 3.1, 0.57, 0.5);
  };
  eye(0, UP_R, LO_R, 468, [469, 470, 471, 472]);
  eye(1, UP_L, LO_L, 473, [474, 475, 476, 477]);

  // ---- brows (slightly asymmetric: left arch higher, left tail longer)
  const brow = (sd, UP, LO) => {
    const sg = sd === 0 ? -1 : 1, a = sd === 1 ? 1 : 0;
    const cl = [[5.3 + 0.25 * a, -2.15 - 0.1 * a], [4.5, -2.65 - 0.06 * a], [3.6, -2.95 - 0.14 * a], [2.7, -2.65], [1.9, -2.3]];
    const th = [0.25, 0.6, 0.8, 0.9, 0.95];
    for (let k = 0; k < 5; k++) {
      set(UP[k], sg * cl[k][0], cl[k][1] - th[k] / 2, 0.8);
      set(LO[k], sg * cl[k][0], cl[k][1] + th[k] / 2, 0.8);
    }
  };
  brow(0, BU_R, BL_R); brow(1, BU_L, BL_L);

  // ---- nose, mouth
  set(168, 0, -0.6, 0.6); set(6, 0, 0.3, 1.0); set(197, 0, 1.0, 1.4); set(195, 0, 1.9, 1.8);
  set(5, 0, 2.4, 2.2); set(4, 0, 2.8, 2.6); set(1, 0, 3.1, 3.0); set(2, 0, 3.9, 1.6);
  set(129, -1.9, 3.5, 1.2); set(358, 1.9, 3.5, 1.2);
  const my = 5.7 * (V.len > 1 ? 1 + (V.len - 1) * 0.6 : 1 - (1 - V.len) * 0.6);
  LIPS_OUTER.forEach((idx, k) => {
    let th;
    if (k <= 10) th = Math.PI - (Math.PI * k) / 10;           // right corner -> left corner over the top
    else th = -(Math.PI * (k - 10)) / 10;                      // back along the bottom
    set(idx, 2.4 * Math.cos(th), my - (th >= 0 ? 0.75 : 1.0) * Math.sin(th) * (th >= 0 ? 1 : 1), 0.8);
  });
  set(61, -2.4, my); set(291, 2.4, my);
  set(0, 0, my - 0.75, 0.9); set(17, 0, my + 1.0, 0.9);

  // ---- filler points on the surface so nearest-neighbour depth lookups behave
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 478; i++) {
    if (pts[i]) continue;
    let x, y, tries = 0;
    do { y = lerp(yTop + 0.3, yChin - 0.3, rnd()); x = (rnd() * 2 - 1) * wAt(y / V.len) * 0.92; } while (Math.abs(x) < 0.01 && ++tries < 5);
    set(i, x, y);
  }

  // ---- rotate, project to normalised image coords
  const k = (H * 0.80) / 16;
  const [cyaw, syaw] = [Math.cos(yaw * Math.PI / 180), Math.sin(yaw * Math.PI / 180)];
  const [cp, sp] = [Math.cos(pitch * Math.PI / 180), Math.sin(pitch * Math.PI / 180)];
  const [cr, sr] = [Math.cos(roll * Math.PI / 180), Math.sin(roll * Math.PI / 180)];
  const out = new Float32Array(478 * 3);
  for (let i = 0; i < 478; i++) {
    let [x, y, z] = pts[i];
    y -= 0.5; z += 3;                                       // rotate about the middle of the head
    let x1 = x * cyaw + z * syaw, z1 = -x * syaw + z * cyaw; x = x1; z = z1;
    let y1 = y * cp - z * sp; z1 = y * sp + z * cp; y = y1; z = z1;
    x1 = x * cr - y * sr; y1 = x * sr + y * cr; x = x1; y = y1;
    y += 0.5; z -= 3;
    out[i * 3] = cx + (x * k) / W;
    out[i * 3 + 1] = cy + (y * k) / H;
    out[i * 3 + 2] = (z * k) / W;
  }
  return out;
}
