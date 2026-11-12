// Interactive color-draping experience: live camera (or photo) -> measured coloring -> drape comparisons (you vote) -> season.
import { measureFace, Session, evaluateDrape, hexToRgb, rgbToHex, rgbToLab, seasonById, SEASONS } from './color.js';
import { store } from './store.js';
import { explainSeason, MAKEUP } from './profiles.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const ease = (t) => t * t * (3 - 2 * t);
const ROUND_IDS = ['temp', 'chroma', 'depth', 'confirm', 'neutrals'];
const ROUND_LABEL = { temp: 'Warm vs cool', chroma: 'Bright vs muted', depth: 'Light vs deep', confirm: 'Confirm season', neutrals: 'Neutrals' };

const S = {
  stage: 'setup',            // setup | check | drape | results
  still: null, lm: null, W: 0, H: 0, meas: null, session: null,
  roundIdx: 0, round: null, items: [], idx: 0, playing: false, hold: 3200, view: 'sequential',
  shownAt: 0, anim: { from: null, to: null, start: 0 }, cur: { L: [40, 40, 40], R: [40, 40, 40] },
  preview: false, previewMirror: true, voted: {}, lastResult: null,
  live: false, buf: [], lastSample: 0, lastCheckRender: 0, base: null, drift: 0, lock: null, faceOk: false, geom: null,
};
const photo = $('c-photo'), drape = $('c-drape');
const pctx = photo.getContext('2d'), dctx = drape.getContext('2d');

// ------------------------------------------------------------------ drape drawing ----
function geometry() {
  const P = (i) => [S.lm[i * 3] * S.W, S.lm[i * 3 + 1] * S.Hp];
  const l = P(234), r = P(454), chin = P(152), top = P(10);
  const fw = Math.hypot(r[0] - l[0], r[1] - l[1]), fh = Math.hypot(chin[0] - top[0], chin[1] - top[1]);
  return { cx: (l[0] + r[0]) / 2, chinY: chin[1], fw, fh };
}
function catmullPath(ctx, pts) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
  }
}
function shade(rgb, k) { return `rgb(${rgb.map((v) => clamp(Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)), 0, 255)).join(',')})`; }

/** Fabric draped under the chin and over the shoulders. Left/right halves may differ (split view). Never touches the photo. */
function drawDrape(ctx, g, W, H, left, right, split, vidH = H) {
  ctx.clearRect(0, 0, W, H);
  if (!left) return;
  const { cx, chinY, fw, fh } = g;
  const edge = [[-0.1 * W, chinY + 0.78 * fh], [cx - 1.05 * fw, chinY + 0.42 * fh], [cx - 0.62 * fw, chinY + 0.17 * fh], [cx - 0.27 * fw, chinY + 0.075 * fh], [cx, chinY + 0.055 * fh],
    [cx + 0.27 * fw, chinY + 0.075 * fh], [cx + 0.62 * fw, chinY + 0.17 * fh], [cx + 1.05 * fw, chinY + 0.42 * fh], [1.1 * W, chinY + 0.78 * fh]];
  const body = (rgb, x0, x1) => {
    ctx.save();
    ctx.beginPath(); catmullPath(ctx, edge); ctx.lineTo(1.1 * W, H + 10); ctx.lineTo(-0.1 * W, H + 10); ctx.closePath(); ctx.clip();
    ctx.beginPath(); ctx.rect(x0, 0, x1 - x0, H + 20); ctx.clip();
    ctx.fillStyle = shade(rgb, 0); ctx.fillRect(x0, 0, x1 - x0, H + 20);
    // soft fabric shading: darker toward the bottom and the outer shoulders, a few diagonal folds
    const gr = ctx.createLinearGradient(0, chinY, 0, H); gr.addColorStop(0, 'rgba(255,255,255,0.06)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.04)'); gr.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = gr; ctx.fillRect(x0, 0, x1 - x0, H + 20);
    ctx.globalAlpha = 0.07; ctx.lineWidth = fw * 0.05;
    for (let k = -3; k <= 3; k++) { ctx.strokeStyle = k % 2 ? '#000' : '#fff'; ctx.beginPath(); ctx.moveTo(cx + k * fw * 0.34, chinY + 0.1 * fh); ctx.quadraticCurveTo(cx + k * fw * 0.5, chinY + 0.8 * fh, cx + k * fw * 0.75, H + 20); ctx.stroke(); }
    ctx.restore();
  };
  if (split && right) { body(left, -50, cx); body(right, cx, W + 50); } else body(left, -50, W + 50);
  if (vidH < H - 1) {      // below the video frame there is only fabric (the extra room added so the drape is visible)
    const pad = (rgb, x0, x1) => { ctx.fillStyle = shade(rgb, 0); ctx.fillRect(x0, vidH, x1 - x0, H - vidH + 20); const gr = ctx.createLinearGradient(0, vidH, 0, H); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.16)'); ctx.fillStyle = gr; ctx.fillRect(x0, vidH, x1 - x0, H - vidH + 20); };
    if (split && right) { pad(left, -50, cx); pad(right, cx, W + 50); } else pad(left, -50, W + 50);
  }
  // neckline edge
  ctx.save(); ctx.beginPath(); catmullPath(ctx, edge); ctx.lineWidth = Math.max(1.5, fw * 0.012); ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.stroke(); ctx.restore();
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!$('view-color') || $('view-color').hidden) return;
  if (S.live && (S.preview || S.stage !== 'setup')) liveUpdate(now);
  if (S.preview) return drawPreview();
  if (S.live && S.stage === 'check') return drawRegions();
  if (S.stage === 'results' && S.geom && S.resultColor) {
    drawDrape(dctx, S.geom, S.W, S.H, S.resultColor, S.resultColor, false, S.Hp); return;
  }
  if (S.stage !== 'drape' || !S.items.length) return;
  const it = S.items[S.idx];
  const t = ease(clamp((now - S.anim.start) / 650, 0, 1));
  const mixc = (a, b) => a.map((v, i) => v + (b[i] - v) * t);
  S.cur.L = mixc(S.anim.from.L, S.anim.to.L); S.cur.R = mixc(S.anim.from.R, S.anim.to.R);
  if (S.geom) drawDrape(dctx, S.geom, S.W, S.H, S.cur.L, S.cur.R, it.split, S.Hp);
  if (S.playing) {
    const prog = clamp((now - S.shownAt) / S.hold, 0, 1);
    $('c-timer-bar').style.width = `${prog * 100}%`;
    if (prog >= 1) next(true);
  } else $('c-timer-bar').style.width = '0%';
}

// ------------------------------------------------------- live camera frames ----
/** Draws the live video (mirrored, never altered), tracks the face for the drape, and samples colors in the background. */
/** Keep the stage the same shape as the canvas so nothing is letterboxed. */
function fitStage(w, h) { const st = $('c-stage'); st.style.aspectRatio = `${w} / ${h}`; st.style.setProperty('--ar', String(w / h)); }
function liveUpdate(now) {
  const FM = window.FM, src = FM && FM.source(); if (!src) return;
  const { W, H } = FM.size();
  const HH = H + (S.pad || 0);
  if (photo.width !== W || photo.height !== HH) { photo.width = drape.width = W; photo.height = drape.height = HH; fitStage(W, HH); }
  S.W = W; S.H = HH; S.Hp = H;
  if (S.pad) { pctx.fillStyle = '#1a1411'; pctx.fillRect(0, H, W, HH - H); }
  pctx.save(); pctx.setTransform(-1, 0, 0, 1, W, 0); pctx.drawImage(src, 0, 0, W, H); pctx.restore();
  const L = FM.landmarks(); S.faceOk = !!L && FM.faceFresh();
  if (L && S.faceOk) {
    const m = new Float32Array(L.lm); for (let i = 0; i < 478; i++) m[i * 3] = 1 - m[i * 3];   // the view is mirrored
    S.lm = m;
    const g = geometry();
    S.geom = S.geom ? { cx: S.geom.cx + (g.cx - S.geom.cx) * 0.35, chinY: S.geom.chinY + (g.chinY - S.geom.chinY) * 0.35, fw: S.geom.fw + (g.fw - S.geom.fw) * 0.35, fh: S.geom.fh + (g.fh - S.geom.fh) * 0.35 } : g;
  }
  // background sampling: ~4 per second, only from the unaltered video layer
  if (now - S.lastSample > 250 && S.faceOk && S.lm && (S.stage === 'check' || S.stage === 'drape')) {
    S.lastSample = now;
    const meas = measureFace(pctx, S.lm, S.W, S.H);
    if (meas) {
      if (S.stage === 'check') { S.meas = meas; S.buf.push(meas); if (S.buf.length > 12) S.buf.shift(); if (now - S.lastCheckRender > 900) { S.lastCheckRender = now; renderCheck(); } }
    }
    if (S.stage === 'drape' && S.base) trackDrift();
  }
  const live = $('c-live'); live.hidden = !(S.preview || S.stage === 'check' || S.stage === 'drape');
  live.classList.toggle('warn', !S.faceOk || (S.stage === 'drape' && S.drift > 4));
  $('c-live-txt').textContent = !S.faceOk ? 'LIVE \u00b7 looking for your face' : S.stage === 'drape' ? (S.drift > 4 ? 'LIVE \u00b7 camera is auto-adjusting' : 'LIVE \u00b7 camera steady') : 'LIVE';
}
/** Average Lab color of the two top corners of the video (normally background, unaffected by your pose or the fabric). */
function bgRef() {
  const W = S.W, h = Math.max(4, Math.round(S.Hp * 0.07)), w = Math.max(4, Math.round(W * 0.07)), out = [];
  try {
    for (const x0 of [0, W - w]) {
      const d = pctx.getImageData(x0, 0, w, h).data; let r = 0, g = 0, b = 0; const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      out.push(rgbToLab(r / n, g / n, b / n));
    }
  } catch { return null; }
  return out;
}
/** A camera that re-exposes or re-balances for the fabric changes the background too. The background is compared with where it started, so the app does not confuse camera auto-adjust with color harmony. */
function trackDrift() {
  const now = bgRef(); if (!now || !S.baseBg) return;
  const dE = Math.min(...now.map((p, i) => Math.hypot(p[0] - S.baseBg[i][0], p[1] - S.baseBg[i][1], p[2] - S.baseBg[i][2])));   // min: one corner may be covered by your head
  S.drift = S.drift * 0.7 + dE * 0.3;
}
function drawRegions() {
  dctx.clearRect(0, 0, S.W, S.H);
  if (!S.meas) return;
  dctx.lineWidth = Math.max(2, S.W / 400); dctx.font = `${Math.max(12, S.W / 55)}px system-ui,sans-serif`;
  for (const r of S.meas.regions) { if (!r.ok) continue; dctx.strokeStyle = '#fff'; dctx.beginPath(); dctx.arc(r.c[0], r.c[1], r.r, 0, 7); dctx.stroke(); dctx.fillStyle = '#fff'; dctx.fillText(r.label, r.c[0] + r.r + 4, r.c[1] + 4); }
}

function setItem(i, instant = false) {
  S.idx = clamp(i, 0, S.items.length - 1);
  const it = S.items[S.idx];
  const to = { L: hexToRgb(it.split ? it.A.hex : it.hex), R: hexToRgb(it.split ? it.B.hex : it.hex) };
  S.anim = { from: instant ? to : { L: S.cur.L.slice(), R: S.cur.R.slice() }, to, start: performance.now() };
  S.shownAt = performance.now();
  $('c-badge').textContent = it.split ? `${it.A.label}  |  ${it.B.label}` : `${it.sideName}: ${it.name}`;
  $('c-badge').style.setProperty('--sw', it.split ? it.A.hex : it.hex);
  $('c-count').textContent = `${S.idx + 1} / ${S.items.length}`;
  renderReadout(it); renderPicker();
}

/** Clickable strip of this round's colors, so any color can be revisited directly. */
function renderPicker() {
  const box = $('c-picker'); box.textContent = '';
  S.items.forEach((it, i) => {
    const b = el('button', 'pick', ''); b.type = 'button'; b.title = it.split ? `${it.A.label} | ${it.B.label}` : `${it.sideName}: ${it.name}`;
    b.setAttribute('aria-label', b.title); b.setAttribute('aria-current', String(i === S.idx));
    if (it.split) b.style.background = `linear-gradient(90deg, ${it.A.hex} 50%, ${it.B.hex} 50%)`; else b.style.background = it.hex;
    b.addEventListener('click', () => { S.playing = false; syncPlayBtn(); setItem(i); });
    box.appendChild(b);
  });
}

function next(auto = false) {
  if (S.idx >= S.items.length - 1) { if (auto) { S.playing = false; syncPlayBtn(); $('c-vote-note').textContent = 'That is the last color in this round. Choose which side looked best on you, then go to the next round.'; $('c-vote-note').classList.add('flash'); } return; }
  setItem(S.idx + 1);
}
const prev = () => setItem(S.idx - 1);
function syncPlayBtn() { $('c-play').textContent = S.playing ? 'Pause' : 'Play'; $('c-play').setAttribute('aria-pressed', String(S.playing)); }

// -------------------------------------------------------------------- rounds ----
function loadRound(i, autoplay = true) {
  S.roundIdx = clamp(i, 0, ROUND_IDS.length - 1);
  const id = ROUND_IDS[S.roundIdx];
  S.round = id === 'confirm' ? S.session.confirmationRound() : S.session.round(id);
  S.items = [];
  const A = S.round.A, B = S.round.B, n = Math.max(A.colors.length, B.colors.length);
  for (let k = 0; k < n; k++) {
    const a = A.colors[Math.min(k, A.colors.length - 1)], b = B.colors[Math.min(k, B.colors.length - 1)];
    if (S.view === 'split') S.items.push({ split: true, A: { hex: a[0], label: `${A.name} ${a[1]}` }, B: { hex: b[0], label: `${B.name} ${b[1]}` }, hexA: a[0], hexB: b[0], sideName: 'Split' });
    else { S.items.push({ side: 'A', sideName: A.name, hex: a[0], name: a[1] }); S.items.push({ side: 'B', sideName: B.name, hex: b[0], name: b[1] }); }
  }
  S.idx = 0; S.playing = autoplay;
  $('c-round-title').textContent = `Round ${S.roundIdx + 1}: ${S.round.title}`;
  $('c-look').textContent = S.round.look;
  $('c-voteA').textContent = `${A.name} looked better`; $('c-voteB').textContent = `${B.name} looked better`;
  $('c-vote-note').textContent = 'Watch each color for a few seconds. Pause or step back any time, then vote.'; $('c-vote-note').classList.remove('flash');
  renderVoteState(); renderRounds(); syncPlayBtn();
  setItem(0, S.stage !== 'drape');
}
function renderRounds() {
  const box = $('c-rounds'); box.textContent = '';
  ROUND_IDS.forEach((id, i) => {
    const b = el('button', 'rchip', `${i + 1}  ${ROUND_LABEL[id]}`); b.type = 'button';
    b.setAttribute('aria-current', String(S.stage === 'drape' && i === S.roundIdx));
    if (S.voted[id]) b.classList.add('done');
    b.addEventListener('click', () => { S.stage = 'drape'; showStage(); loadRound(i, false); });
    box.appendChild(b);
  });
  const rb = el('button', 'rchip result', 'Results'); rb.type = 'button'; rb.setAttribute('aria-current', String(S.stage === 'results'));
  rb.addEventListener('click', showResults); box.appendChild(rb);
}
function renderVoteState() {
  const id = ROUND_IDS[S.roundIdx], v = S.session.votes[id] || S.session.votes[id === 'confirm' ? 'confirm' : id];
  for (const [btn, key] of [['c-voteA', 'A'], ['c-voteS', 'same'], ['c-voteB', 'B']]) $(btn).setAttribute('aria-pressed', String(S.voted[id] === key));
  void v;
}
function vote(side) {
  const id = ROUND_IDS[S.roundIdx];
  S.voted[id] = side;
  if (id === 'confirm') {
    const A = S.round.A, B = S.round.B;
    S.session.finalVotes = side === 'A' ? [A.seasonId] : side === 'B' ? [B.seasonId] : [];
  } else S.session.vote(id, side);
  renderVoteState(); renderRounds();
  $('c-vote-note').classList.remove('flash');
  const est = S.session.ranking()[0];
  $('c-vote-note').textContent = `Saved. Leading season so far: ${est.season.name}. Go to the next round when you are ready.`;
  $('c-next-round').hidden = S.roundIdx >= ROUND_IDS.length - 1;
  $('c-finish').hidden = false;
}

// ----------------------------------------------------------- model read-out ----
const READ = [
  ['harmony', 'Harmony', true], ['brightness', 'Brightness', true], ['contrast', 'Contrast fit', true],
  ['dullness', 'Dullness', false], ['yellow', 'Yellow cast', false], ['redness', 'Redness', false], ['shadows', 'Shadows', false],
];
function renderReadout(it) {
  const box = $('c-read'); box.textContent = '';
  const list = it.split ? [{ label: it.A.label, hex: it.A.hex }, { label: it.B.label, hex: it.B.hex }] : [{ label: `${it.sideName}: ${it.name}`, hex: it.hex }];
  for (const d of list) {
    const ev = evaluateDrape(S.meas, d.hex);
    const col = el('div', 'rcol');
    const head = el('div', 'rhead'); const sw = el('span', 'sw'); sw.style.background = d.hex; head.append(sw, el('span', null, d.label), el('b', null, `${Math.round(ev.overall)}`));
    col.appendChild(head);
    for (const [k, lab, good] of READ) {
      const row = el('div', 'rrow'); row.appendChild(el('span', 'rl', lab));
      const bar = el('span', 'rb'); const f = el('i'); f.style.width = `${Math.round(ev[k])}%`; f.className = good ? 'good' : 'bad'; bar.appendChild(f); row.appendChild(bar);
      row.appendChild(el('span', 'rv', `${Math.round(ev[k])}`)); col.appendChild(row);
    }
    if (ev.overpowers) col.appendChild(el('p', 'rwarn', 'Strong contrast: this color may overpower your natural coloring.'));
    box.appendChild(col);
  }
}

// -------------------------------------------------------------------- results ----
function swatch(hex, title) { const s = el('span', 'sw lg'); s.style.background = hex; s.title = title || hex; return s; }
function bar(label, value, left, right) {
  const row = el('div', 'dim'); row.appendChild(el('div', 'dl', label));
  const track = el('div', 'dtrack'); const mid = el('i', 'mid'); const dot = el('b'); dot.style.left = `${((value + 1) / 2) * 100}%`; track.append(mid, dot); row.appendChild(track);
  const ends = el('div', 'dends'); ends.append(el('span', null, left), el('span', null, right)); row.appendChild(ends); return row;
}
function showResults() {
  S.playing = false; S.stage = 'results'; showStage(); renderRounds();
  const r = S.session.result(), s = r.top.season, box = $('c-results'); box.textContent = '';
  const ex = explainSeason(s, r.est);
  S.resultColor = hexToRgb(s.best[0]);
  store.setColor({ seasonId: s.id, name: s.name, family: s.family, confidence: r.confidence, label: r.confidenceLabel, est: r.est });

  box.appendChild(el('div', 'eyebrow', 'Step 2 of 3 \u00b7 Your result'));
  const hero = el('div', 'hero'); hero.append(el('div', 'eyebrow', `${s.family} palette`), el('div', 'shape', s.name));
  const conf = el('div', 'conf'); conf.append(el('span', null, `${r.confidenceLabel} (${Math.round(r.confidence * 100)}%)`), el('em', null, `  next closest: ${r.second.season.name} ${Math.round(r.second.p * 100)}%`));
  hero.append(conf, el('p', null, ex.summary)); box.appendChild(hero);
  const cav = el('div', 'caveat'); cav.append(el('b', null, 'Please read: '), document.createTextNode('A single camera view cannot reliably establish your true undertone or season. Phone and webcam cameras, screen color, lighting and makeup all change what is captured, and professionals judge real fabric in daylight. Treat this as a well-reasoned starting point, then check it in person.'));
  box.appendChild(cav);

  box.appendChild(el('h3', null, 'What this means'));
  const pts = el('ul', 'tips'); ex.points.forEach((t) => pts.appendChild(el('li', null, t))); box.appendChild(pts);
  box.appendChild(el('p', 'muted', ex.why));

  const T = (v) => (v > 0.25 ? 'warm' : v < -0.25 ? 'cool' : 'neutral'), D = (v) => (v > 0.25 ? 'deep' : v < -0.25 ? 'light' : 'medium'), C = (v) => (v > 0.25 ? 'bright / clear' : v < -0.25 ? 'soft / muted' : 'in between');
  const E = r.est, dimBox = el('div', 'dims');
  dimBox.append(bar(`Undertone: ${T(E.T)}`, E.T, 'Cool', 'Warm'), bar(`Depth: ${D(E.D)}`, E.D, 'Light', 'Deep'), bar(`Clarity: ${C(E.C)}`, E.C, 'Soft / muted', 'Bright / clear'));
  box.append(el('h3', null, 'Your coloring'), dimBox);

  const mk = MAKEUP[s.id];
  box.appendChild(el('h3', null, 'Your best colors'));
  const best = el('div', 'swrow'); s.best.forEach((h) => best.appendChild(swatch(h))); box.appendChild(best);
  if (mk) {
    box.appendChild(el('h3', null, 'Best neutrals for clothing'));
    const nb = el('div', 'swatches'); for (const [h, n] of mk.neutrals) { const c = el('div', 'swatch'); const i = el('i'); i.style.background = h; c.append(i, el('span', null, n)); nb.append(c); } box.appendChild(nb);
  }
  box.appendChild(el('h3', null, 'Colors that may be less harmonious'));
  const avoid = el('div', 'swrow'); s.avoid.forEach((h) => avoid.appendChild(swatch(h))); box.appendChild(avoid);
  box.appendChild(el('p', 'muted small', ex.avoidWhy));
  box.appendChild(el('h3', null, 'Jewelry metals'));
  box.appendChild(el('p', null, s.metals));

  box.appendChild(el('h3', null, 'Closest seasons'));
  const rk = el('div', 'bars');
  r.rank.slice(0, 5).forEach((e) => {
    const row = el('div', 'bar-row'), b = el('div', 'bar'), f = el('span'); f.style.width = `${Math.round(e.p * 100)}%`; b.append(f);
    const nm = el('span', 'bar-name', e.season.name); nm.style.fontSize = '.78rem';
    row.append(nm, b, el('span', 'bar-val', `${Math.round(e.p * 100)}%`)); rk.appendChild(row);
  });
  box.appendChild(rk);

  const ev = el('details', 'steps'); ev.appendChild(el('summary', null, 'How this result was reached'));
  const M = S.meas.dims, el2 = el('ul', 'tips');
  el2.append(el('li', null, `Starting measurement: ${T(M.T)} undertone, ${D(M.D)} depth, ${C(M.C)}. Skin, brow/hair and iris were read from the same areas every time${S.meas.wbApplied ? ', after an approximate lighting correction from your eye whites' : ' (no lighting correction was possible)'}.`));
  el2.append(el('li', null, r.votesGiven ? `Your comparisons: you voted in ${r.votesGiven} of the 3 core rounds${r.agree ? `, and ${r.agree} agreed with the measurement` : ''}.` : 'You have not voted in the core rounds, so this is based on the measurement alone. Run the comparisons for a better result.'));
  el2.append(el('li', null, 'The bars shown during draping come from a model that compares each color with your starting measurements. They are not live readings of your skin changing.'));
  for (const f of S.meas.flags.filter((x) => x.id !== 'wb')) el2.append(el('li', 'warn', f.text));
  ev.appendChild(el2); box.appendChild(ev);

  const row = el('div', 'row'); 
  const go = el('button', 'btn primary', 'Next: get your makeup colors \u2192'); go.type = 'button'; go.addEventListener('click', () => document.querySelector('[data-view="makeup"]').click());
  const again = el('button', 'btn', 'Revisit the drapes'); again.type = 'button'; again.addEventListener('click', () => { S.stage = 'drape'; S.resultColor = null; showStage(); loadRound(0, false); });
  const retake = el('button', 'btn', 'Start over'); retake.type = 'button'; retake.addEventListener('click', resetAll); row.append(go, again, retake); box.appendChild(row);
  S.lastResult = r;
}
// Lab -> sRGB (only to show the measured swatches)
function labToRgbApprox([L, a, b]) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200, f = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const X = 0.95047 * f(fx), Y = f(fy), Z = 1.08883 * f(fz);
  const lin = [3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z, -0.969266 * X + 1.8760108 * Y + 0.041556 * Z, 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z];
  return lin.map((c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055));
}

// -------------------------------------------------------------- stages / photo ----
function showStage() {
  $('c-setup').hidden = S.stage !== 'setup'; $('c-check').hidden = S.stage !== 'check';
  $('c-round').hidden = S.stage !== 'drape'; $('c-results').hidden = S.stage !== 'results';
  $('c-controls').hidden = S.stage !== 'drape'; $('c-rounds').hidden = !(S.stage === 'drape' || S.stage === 'results');
  $('c-empty').hidden = S.stage !== 'setup' || S.preview; $('c-badge').hidden = S.stage !== 'drape'; $('c-count').hidden = S.stage !== 'drape'; $('c-timerwrap').hidden = S.stage !== 'drape';
  $('c-cam-ctrls').hidden = !S.preview; $('c-picker').hidden = S.stage !== 'drape';
  $('c-live').hidden = !(S.live && (S.preview || S.stage === 'check' || S.stage === 'drape'));
  if (S.stage !== 'drape' && S.stage !== 'results') dctx.clearRect(0, 0, drape.width, drape.height);
}
function setPhoto(canvas, lm) {
  S.preview = false; S.live = false;
  S.W = canvas.width; S.Hp = canvas.height; S.lm = lm;
  // leave room below the chin for the fabric when the face fills the frame (extra space is plain dark, outside the photo)
  const chinY = lm[152 * 3 + 1] * S.Hp, topY = lm[10 * 3 + 1] * S.Hp, pad = Math.max(0, Math.ceil(chinY + 0.65 * (chinY - topY) - S.Hp));
  S.H = S.Hp + pad; S.pad = 0; fitStage(S.W, S.H);
  photo.width = drape.width = S.W; photo.height = drape.height = S.H;
  pctx.fillStyle = '#1a1411'; pctx.fillRect(0, 0, S.W, S.H);
  pctx.drawImage(canvas, 0, 0);
  S.still = canvas;
  const meas = measureFace(pctx, lm, S.W, S.Hp);
  if (!meas) { setupMsg('I could not read enough of the face in that photo. Try a brighter, straight-on photo with the whole face visible.', true); S.stage = 'setup'; showStage(); return; }
  S.meas = meas; S.session = new Session(meas); S.voted = {}; S.geom = geometry();
  S.stage = 'check'; renderCheck(); showStage();
}
function setupMsg(t, bad) { const m = $('c-setup-msg'); m.textContent = t; m.className = bad ? 'warn' : 'muted small'; }
function renderCheck() {
  const m = S.meas, box = $('c-check-body'); box.textContent = '';
  if (!m) { box.append(el('p', 'muted', S.live ? 'Looking for your face. Face the light and look at the camera.' : 'Reading the photo...')); return; }
  if (!S.live) { drawRegions(); }
  const row = el('div', 'swrow');
  for (const r of m.regions) if (r.ok) row.appendChild(swatch(rgbToHex(...r.rgb), `${r.label}`));
  box.append(el('p', 'muted small', 'Your coloring is read from these same areas every time (cheeks, forehead and chin), ignoring the darkest and brightest pixels so shadow and shine do not skew it.'), row);
  const q = el('div', 'gauge'); const qi = el('span'); qi.style.width = `${Math.round(m.quality * 100)}%`; q.appendChild(qi);
  box.append(el('h3', null, `Lighting and image quality: ${m.quality > 0.75 ? 'good' : m.quality > 0.5 ? 'usable' : 'poor'}`), q);
  box.append(el('p', 'muted small', m.wbApplied ? 'The lighting color was estimated from your eye whites and partly corrected (limited to a safe range).' : 'No lighting correction was possible.'));
  if (S.live) {
    const l = S.lock || {};
    box.append(el('p', 'muted small', l.exposure || l.wb
      ? `Camera settings locked: ${[l.exposure && 'exposure', l.wb && 'white balance'].filter(Boolean).join(' and ')}. This stops the camera re-adjusting when colors change.`
      : 'Your camera or browser does not let this page lock exposure and white balance. While draping, OnFleek watches the background of the view and warns you if the camera re-adjusts by itself. It never mistakes that for color harmony, because the results come from your starting reading.'));
    box.append(el('p', 'muted small', `${S.buf.length >= 4 ? 'Ready.' : 'Collecting a steady reading...'} Hold still for a moment.`));
  }
  const ul = el('ul', 'tips'); if (!m.flags.length) ul.appendChild(el('li', null, 'Lighting and exposure look even. Nothing to fix.')); for (const f of m.flags) ul.appendChild(el('li', 'warn', f.text)); box.appendChild(ul);
  $('c-start').disabled = S.live && S.buf.length < 3;
}
/** Median of the recent live readings (by skin lightness), so one odd frame cannot set the baseline. */
function steadyReading() {
  if (!S.buf.length) return S.meas;
  const sorted = S.buf.slice().sort((a, b) => a.skin[0] - b.skin[0]);
  return sorted[Math.floor(sorted.length / 2)];
}
function startDraping() {
  if (S.live) { S.meas = steadyReading(); if (!S.meas) return; S.session = new Session(S.meas); S.voted = {}; }
  S.base = S.meas; S.drift = 0; S.resultColor = null; S.baseBg = S.live ? bgRef() : null;
  S.stage = 'drape'; dctx.clearRect(0, 0, S.W, S.H); showStage(); S.cur = { L: [60, 60, 60], R: [60, 60, 60] }; loadRound(0, true); $('c-next-round').hidden = false; $('c-finish').hidden = false;
}
function resetAll() {
  S.stage = 'setup'; S.meas = null; S.session = null; S.playing = false; S.voted = {}; S.preview = false; S.live = false; S.pad = 0; S.buf = []; S.base = null; S.resultColor = null; S.geom = null;
  if (window.FM && window.FM.unlockExposure) window.FM.unlockExposure();
  showStage(); pctx.clearRect(0, 0, photo.width, photo.height); dctx.clearRect(0, 0, drape.width, drape.height); setupMsg('Your browser will ask permission to use your camera. Nothing leaves your device.');
}

// ------------------------------------------------------------ camera preview ----
function drawPreview() {
  const FM = window.FM; if (!FM || !FM.source()) return;
  const { W, H } = FM.size(), ok = FM.faceFresh();
  dctx.clearRect(0, 0, W, H); dctx.strokeStyle = ok ? 'rgba(130,255,180,.95)' : 'rgba(255,255,255,.7)'; dctx.lineWidth = 3; dctx.setLineDash([10, 8]);
  dctx.beginPath(); dctx.ellipse(W / 2, H * 0.40, H * 0.20, H * 0.285, 0, 0, 7); dctx.stroke(); dctx.setLineDash([]);
  const faceLow = S.geom && S.geom.chinY > H * 0.74;
  $('c-cam-status').textContent = !ok ? 'Looking for your face... face the light and look straight at the camera.' : faceLow ? 'Face found. Sit back a little so there is room for the fabric under your chin.' : 'Face found. Sit back so your shoulders show, then continue.';
  $('c-take').disabled = !ok;
}
async function useCamera() {
  const FM = window.FM; setupMsg('Starting camera...');
  // ?fakecam is a test hook: it feeds the demo face through the live-camera path
  try { if (new URLSearchParams(location.search).has('fakecam')) FM.startDemo(); else await FM.startCamera(); } catch (e) { setupMsg(`Camera unavailable: ${e.message} You can upload a photo instead.`, true); return; }
  S.live = true; S.preview = true; S.geom = null; S.buf = []; S.stage = 'setup'; showStage();
}
async function continueLive() {
  const FM = window.FM; S.preview = false; S.stage = 'check'; S.meas = null; S.buf = []; S.lock = null;
  // room under the chin for the fabric if the face fills the frame (fixed for the session so the view never jumps)
  const { H } = FM.size(), g = S.geom; S.pad = g ? clamp(Math.ceil(g.chinY + 0.62 * g.fh - H), 0, Math.round(H * 0.5)) : 0;
  showStage(); renderCheck();
  S.lock = await FM.lockExposure();            // freeze exposure + white balance where the camera allows it
  renderCheck();
}
async function useDemo() {
  const FM = window.FM; FM.startDemo(); S.live = false;
  await new Promise((r) => setTimeout(r, 500));
  const still = FM.grabStill(false); if (!still) { setupMsg('Demo face not ready, try again.', true); return; }
  setPhoto(still.canvas, still.lm);
}
async function useUpload(file) {
  if (!file) return;
  setupMsg('Reading photo and finding the face...'); S.live = false; S.preview = false;
  try {
    const url = URL.createObjectURL(file), img = new Image(); img.src = url; await img.decode();
    const sc = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    const lm = await window.FM.detectImage(c);
    if (!lm) { setupMsg('No face found in that photo. Use a clear, front-facing photo in even light.', true); return; }
    setPhoto(c, lm);
  } catch (e) { setupMsg(`Could not use that photo: ${e.message}`, true); }
}

// -------------------------------------------------------------------- wiring ----
export function initColor() {
  $('c-cam').addEventListener('click', useCamera);
  $('c-demo').addEventListener('click', useDemo);
  $('c-file').addEventListener('change', (e) => useUpload(e.target.files[0]));
  $('c-take').addEventListener('click', continueLive);
  $('c-cancel-cam').addEventListener('click', resetAll);
  $('c-retake').addEventListener('click', resetAll);
  $('c-start').addEventListener('click', startDraping);
  $('c-play').addEventListener('click', () => { S.playing = !S.playing; if (S.playing) { S.shownAt = performance.now(); if (S.idx >= S.items.length - 1) setItem(0); } syncPlayBtn(); });
  $('c-prev').addEventListener('click', () => { prev(); });
  $('c-next').addEventListener('click', () => { next(false); });
  $('c-restart').addEventListener('click', () => { S.playing = true; setItem(0); syncPlayBtn(); });
  $('c-hold').addEventListener('change', (e) => { S.hold = +e.target.value; S.shownAt = performance.now(); });
  $('c-view').addEventListener('change', (e) => { S.view = e.target.value; loadRound(S.roundIdx, false); });
  $('c-voteA').addEventListener('click', () => vote('A')); $('c-voteB').addEventListener('click', () => vote('B')); $('c-voteS').addEventListener('click', () => vote('same'));
  $('c-next-round').addEventListener('click', () => { if (S.roundIdx < ROUND_IDS.length - 1) loadRound(S.roundIdx + 1, true); });
  $('c-finish').addEventListener('click', showResults);
  document.addEventListener('keydown', (e) => {
    if ($('view-color').hidden || S.stage !== 'drape' || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.key === 'ArrowRight') next(false); else if (e.key === 'ArrowLeft') prev(); else if (e.key === ' ') { e.preventDefault(); $('c-play').click(); }
  });
  showStage(); requestAnimationFrame(frame);
  window.CA = { S, useDemo, startDraping, showResults, vote, loadRound, seasons: SEASONS, seasonById };   // handy for debugging / tests
}
