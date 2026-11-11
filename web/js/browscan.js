// Pixel-based brow finder ("colour picker").
// MediaPipe's brow landmarks can sit a few millimetres off the visible hair. For every brow landmark column this
// samples the video pixels, compares them with the person's own skin colour (taken from the forehead and between the
// brows), finds where the darker hair starts and stops across the brow, and nudges the landmarks onto those edges.
// The engine then maps the *real* brow, not the estimated one.
const BROW = [
  { up: [70, 63, 105, 66, 107], lo: [46, 53, 52, 65, 55] },        // subject's right, tail -> head
  { up: [300, 293, 334, 296, 336], lo: [276, 283, 282, 295, 285] }, // subject's left
];
const SKIN_PTS = [9, 168, 151];            // between the brows / bridge / forehead centre

export class BrowScanner {
  constructor() {
    this.cv = document.createElement('canvas');
    this.cx = this.cv.getContext('2d', { willReadFrequently: true });
    this.shift = new Float32Array(478 * 2);   // smoothed per-landmark shift (video px)
    this.stats = { found: 0, total: 20, contrast: 0, ok: false };
  }
  reset() { this.shift.fill(0); }

  /** lm: Float32Array 478*3 (x/W,y/H,z/W), edited in place. src: video or canvas of size W x H. */
  refine(lm, src, W, H) {
    const P = (i) => [lm[i * 3] * W, lm[i * 3 + 1] * H];
    const a = P(468), b = P(473);
    const ied = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(ied > 30)) return this.stats;
    let ex = (b[0] - a[0]) / ied, ey = (b[1] - a[1]) / ied;
    const nx = -ey, ny = ex;                                   // "down" across the brow
    // crop box around both brows
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const s of BROW) for (const i of [...s.up, ...s.lo]) { const [x, y] = P(i); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const pad = 0.7 * ied;
    x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad));
    x1 = Math.min(W, Math.ceil(x1 + pad)); y1 = Math.min(H, Math.ceil(y1 + pad));
    const cw = x1 - x0, ch = y1 - y0;
    if (cw < 20 || ch < 20) return this.stats;
    if (this.cv.width !== cw || this.cv.height !== ch) { this.cv.width = cw; this.cv.height = ch; }
    try { this.cx.drawImage(src, x0, y0, cw, ch, 0, 0, cw, ch); } catch { return this.stats; }
    let img; try { img = this.cx.getImageData(0, 0, cw, ch).data; } catch { return this.stats; }
    const rgb = (x, y) => {
      const xi = Math.round(x - x0), yi = Math.round(y - y0);
      if (xi < 0 || yi < 0 || xi >= cw || yi >= ch) return null;
      const o = (yi * cw + xi) * 4; return [img[o], img[o + 1], img[o + 2]];
    };
    const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

    // ---- the person's own skin colour: patches between the brows and on the forehead above each brow
    const patches = SKIN_PTS.map(P);
    for (const s of BROW) { const [x, y] = P(s.up[2]); patches.push([x - nx * 0.42 * ied, y - ny * 0.42 * ied]); }
    const R = [], G = [], B = [];
    const pr = Math.max(2, 0.035 * ied);
    for (const [px, py] of patches) for (let dy = -pr; dy <= pr; dy += pr / 2) for (let dx = -pr; dx <= pr; dx += pr / 2) {
      const c = rgb(px + dx, py + dy); if (c) { R.push(c[0]); G.push(c[1]); B.push(c[2]); }
    }
    if (R.length < 20) return this.stats;
    const med = (v) => { v.sort((p, q) => p - q); return v[v.length >> 1]; };
    const skin = [med(R), med(G), med(B)], Ls = lum(skin);
    const score = (c) => {
      const dl = Ls - lum(c);
      const dc = Math.hypot(c[0] - skin[0], c[1] - skin[1], c[2] - skin[2]);
      return Math.max(0, dl) + 0.25 * Math.max(0, dc - Math.abs(dl));
    };

    // ---- per brow column: find where the hair starts and stops
    const HALF = 0.26 * ied, STEP = Math.max(1, ied / 160), NS = Math.max(8, Math.round((2 * HALF) / STEP));
    let found = 0, contrastSum = 0;
    const want = new Float32Array(478 * 2).fill(NaN);
    for (const s of BROW) for (let k = 0; k < 5; k++) {
      const u = P(s.up[k]), l = P(s.lo[k]);
      const cx_ = 0.5 * (u[0] + l[0]), cy_ = 0.5 * (u[1] + l[1]);
      const prof = new Float32Array(NS + 1);
      for (let j = 0; j <= NS; j++) {
        const t = -HALF + j * STEP; let acc = 0, cnt = 0;
        for (let m = -2; m <= 2; m++) {                          // average a few neighbouring columns
          const c = rgb(cx_ + ex * m * 0.012 * ied + nx * t, cy_ + ey * m * 0.012 * ied + ny * t);
          if (c) { acc += score(c); cnt++; }
        }
        prof[j] = cnt ? acc / cnt : 0;
      }
      const sm = new Float32Array(NS + 1);
      for (let j = 0; j <= NS; j++) sm[j] = (prof[Math.max(0, j - 1)] + prof[j] + prof[Math.min(NS, j + 1)]) / 3;
      // peak, biased toward the landmark position
      let pk = 0, pj = -1;
      for (let j = 0; j <= NS; j++) { const t = -HALF + j * STEP, w = Math.exp(-Math.pow(t / (0.2 * ied), 2)), v = sm[j] * w; if (v > pk) { pk = v; pj = j; } }
      const peak = pj >= 0 ? sm[pj] : 0;
      if (peak < 14) continue;                                    // not enough contrast with the skin
      const thr = Math.max(8, 0.45 * peak);
      let lo = pj, hi = pj, gap = 0;
      for (let j = pj; j >= 0; j--) { if (sm[j] >= thr) { lo = j; gap = 0; } else if (++gap > 2) break; }
      gap = 0;
      for (let j = pj; j <= NS; j++) { if (sm[j] >= thr) { hi = j; gap = 0; } else if (++gap > 2) break; }
      const tUp = -HALF + lo * STEP, tLo = -HALF + hi * STEP, thick = (tLo - tUp) / ied;
      if (thick < 0.015 || thick > 0.30) continue;
      const tuLm = (u[0] - cx_) * nx + (u[1] - cy_) * ny, tlLm = (l[0] - cx_) * nx + (l[1] - cy_) * ny;
      const cl = (v) => Math.max(-0.2 * ied, Math.min(0.2 * ied, v));
      want[s.up[k] * 2 + 1] = cl(tUp - tuLm); want[s.lo[k] * 2 + 1] = cl(tLo - tlLm);
      found += 2; contrastSum += peak;
    }
    // reject outliers (hair at the temple, the edge of the face...): a brow's columns should agree about how far the
    // landmarks are off, so anything far from that brow's median shift is discarded
    for (const s of BROW) {
      const vals = [...s.up, ...s.lo].map((i) => want[i * 2 + 1]).filter((v) => !Number.isNaN(v));
      if (vals.length < 4) { for (const i of [...s.up, ...s.lo]) want[i * 2 + 1] = NaN; found -= vals.length; continue; }
      vals.sort((p, q) => p - q); const m = vals[vals.length >> 1];
      for (const i of [...s.up, ...s.lo]) if (!Number.isNaN(want[i * 2 + 1]) && Math.abs(want[i * 2 + 1] - m) > 0.07 * ied) { want[i * 2 + 1] = NaN; found -= 1; }
    }
    // columns where the hair was too faint/thin to read (usually the tapering tail) borrow the nearest found column's shift
    for (const s of BROW) for (const edge of [s.up, s.lo]) {
      for (let k = 0; k < 5; k++) {
        if (!Number.isNaN(want[edge[k] * 2 + 1])) continue;
        let best = NaN, bd = 9;
        for (let q = 0; q < 5; q++) { const v = want[edge[q] * 2 + 1]; if (!Number.isNaN(v) && Math.abs(q - k) < bd) { bd = Math.abs(q - k); best = v; } }
        want[edge[k] * 2 + 1] = best;
      }
    }
    // ---- smooth in time and apply (shift is along the brow's "down" axis)
    for (const s of BROW) for (const i of [...s.up, ...s.lo]) {
      const w = want[i * 2 + 1];
      const cur = this.shift[i * 2 + 1];
      this.shift[i * 2 + 1] = Number.isNaN(w) ? cur * 0.96 : cur + 0.35 * (w - cur);
      const d = this.shift[i * 2 + 1];
      lm[i * 3] += (nx * d) / W; lm[i * 3 + 1] += (ny * d) / H;
    }
    this.stats = { found, total: 20, contrast: found ? contrastSum / (found / 2) : 0, ok: found >= 12 };
    return this.stats;
  }
}
