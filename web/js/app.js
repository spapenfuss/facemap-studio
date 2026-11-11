// FaceMap Studio - UI glue: camera + MediaPipe landmarks -> C++/WASM engine -> canvas overlay.
import { loadEngine, flattenLandmarks } from './engine.js';
import { drawOverlay, LAYERS } from './overlay.js';
import { BrowScanner } from './browscan.js';
import { makeDemoFace, OVAL_R, OVAL_L, LIPS_OUTER } from './demo.js';

const MP_VERSION = '0.10.14';
const MP_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_CDN = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

const video = $('video'), overlay = $('overlay'), backdrop = $('backdrop'), stage = $('stage');
const octx = overlay.getContext('2d'), bctx = backdrop.getContext('2d');

const state = {
  engine: null, landmarker: null, stream: null,
  mode: null,                       // 'camera' | 'demo' | null
  W: 960, H: 720,
  layers: Object.fromEntries(LAYERS.map((l) => [l.id, l.on])),
  mirror: true, opacity: 0.85, browStyle: 'mapped', immersive: false, pixelBrows: true, scanStats: null,
  lastVideoTime: -1, fps: 0, lastFrame: 0, lastReportAt: 0, lastReportText: '',
  report: null, hudHideAt: 0, wasLocked: false,
};
const view = { zoom: 1, u: 0.5, v: 0.5, follow: true };   // u,v = focal point in displayed (mirrored) video space
let lastLayout = null;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const lmBuf = new Float32Array(478 * 3);
let lastPrims = null;

// ------------------------------------------------------------------ boot ----
async function boot() {
  try {
    state.engine = await loadEngine('wasm/engine.wasm');
    $('chip-engine').textContent = `engine: C++ / WASM v${state.engine.x.engine_version() / 100}`;
    $('chip-engine').classList.add('ok');
  } catch (err) {
    console.error(err);
    $('chip-engine').textContent = 'engine: failed';
    $('chip-engine').classList.add('bad');
    const w = $('welcome');
    w.querySelector('p').textContent = location.protocol === 'file:'
      ? 'This page must be served over http://localhost (the browser blocks WebAssembly and camera access from file://). See the README: run "npm start" or use VS Code Live Server.'
      : `Could not load the analysis engine: ${err.message}`;
    $('btn-camera').disabled = true; $('btn-demo').disabled = true;
    return;
  }
  buildLayerChips();
  bindUI();
  requestAnimationFrame(tick);
  if (new URLSearchParams(location.search).has('demo')) startDemo();
}

// ------------------------------------------------------------------- UI ----
let layerTab = 'brows';
function buildLayerChips() {
  for (const l of LAYERS) {
    const b = el('button', 'chip toggle', l.label);
    b.type = 'button'; b.setAttribute('aria-pressed', String(state.layers[l.id]));
    b.style.setProperty('--c', l.color);
    b.addEventListener('click', () => setLayer(l.id, !state.layers[l.id]));
    b.dataset.layer = l.id;
    $(`layers-${l.group}`).appendChild(b);
  }
  document.querySelectorAll('[data-ltab]').forEach((t) => t.addEventListener('click', () => selectLayerTab(t.dataset.ltab)));
  const setAll = (v) => LAYERS.filter((l) => l.group === layerTab).forEach((l) => setLayer(l.id, v));
  $('btn-all-on').addEventListener('click', () => setAll(true));
  $('btn-all-off').addEventListener('click', () => setAll(false));
  selectLayerTab('brows');
}
function selectLayerTab(name) {
  layerTab = name;
  document.querySelectorAll('[data-ltab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.ltab === name)));
  document.querySelectorAll('[data-group]').forEach((g) => { g.hidden = g.dataset.group !== name; });
}
function setLayer(id, v) {
  state.layers[id] = v;
  const b = document.querySelector(`.layers [data-layer="${id}"]`);
  if (b) b.setAttribute('aria-pressed', String(v));
}

function bindUI() {
  $('btn-camera').addEventListener('click', startCamera);
  $('btn-demo').addEventListener('click', startDemo);
  $('btn-stop').addEventListener('click', stop);
  $('btn-rescan').addEventListener('click', () => { state.engine.reset(); state.wasLocked = false; state.lastReportText = ''; });
  $('btn-snap').addEventListener('click', snapshot);
  $('opt-mirror').addEventListener('change', (e) => { state.mirror = e.target.checked; applyMirror(); });
  $('opt-opacity').addEventListener('input', (e) => { state.opacity = +e.target.value; });
  $('opt-brow-style').addEventListener('change', (e) => { state.browStyle = e.target.value; });
  bindView();
  $('demo-sweep').addEventListener('change', (e) => { $('demo-yaw').disabled = e.target.checked; });
  $('demo-yaw').disabled = true;
  $('demo-variant').addEventListener('change', () => state.engine.reset());

  document.querySelectorAll('.tabs [role=tab]').forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.tab)));
  $('opt-pixel').addEventListener('change', (e) => { state.pixelBrows = e.target.checked; scanner.reset(); state.engine.reset(); });
  const fit = [['fit-y', 4], ['fit-top', 5], ['fit-bot', 6], ['fit-tail', 7]];
  for (const [id, param] of fit) $(id).addEventListener('input', (e) => state.engine.setParam(param, +e.target.value));
  $('fit-reset').addEventListener('click', () => { for (const [id, param] of fit) { $(id).value = 0; state.engine.setParam(param, 0); } });
  const cal = [['cal-len', 0], ['cal-fore', 2], ['cal-jaw', 3]];
  for (const [id, param] of cal) {
    $(id).addEventListener('input', (e) => { state.engine.setParam(param, +e.target.value); $(id + '-o').textContent = (+e.target.value).toFixed(2); });
  }
  $('cal-reset').addEventListener('click', () => {
    for (const [id, param] of cal) { $(id).value = 0; $(id + '-o').textContent = '0.00'; state.engine.setParam(param, 0); }
  });
}
function selectTab(name) {
  document.querySelectorAll('.tabs [role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  document.querySelectorAll('.tabpane').forEach((p) => { p.hidden = p.id !== `tab-${name}`; });
  if (!state.report) $('empty').hidden = false;
  if (state.report) showPanes(name);
}
function activeTab() { return document.querySelector('.tabs [aria-selected=true]').dataset.tab; }
function showPanes(name = activeTab()) {
  $('empty').hidden = !!state.report;
  document.querySelectorAll('.tabpane').forEach((p) => { p.hidden = !state.report || p.id !== `tab-${name}`; });
}

function setCanvasSize(w, h) {
  state.W = w; state.H = h;
  backdrop.width = w; backdrop.height = h;
  stage.style.aspectRatio = state.immersive ? 'auto' : `${w} / ${h}`;
  resetView();
}

// ------------------------------------------------- zoom / pan / full screen ----
function layout() {
  const cw = stage.clientWidth, ch = stage.clientHeight;
  if (!cw || !ch) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pw = Math.round(cw * dpr), ph = Math.round(ch * dpr);
  if (overlay.width !== pw || overlay.height !== ph) { overlay.width = pw; overlay.height = ph; }
  const { W, H } = state, fit = Math.min(cw / W, ch / H), s = fit * view.zoom;
  const hw = cw / (2 * s * W), hh = ch / (2 * s * H);
  view.u = hw >= 0.4999 ? 0.5 : clamp(view.u, hw, 1 - hw);
  view.v = hh >= 0.4999 ? 0.5 : clamp(view.v, hh, 1 - hh);
  const ox = cw / 2 - view.u * W * s, oy = ch / 2 - view.v * H * s;
  for (const e of [video, backdrop]) {
    e.style.width = `${W * s}px`; e.style.height = `${H * s}px`; e.style.left = `${ox}px`; e.style.top = `${oy}px`;
  }
  lastLayout = { cw, ch, dpr, W, H, s, ox, oy, fit };
  return lastLayout;
}
function setZoom(z, anchor) {
  const L = lastLayout; z = clamp(z, 1, 4);
  if (anchor && L) {
    const pu = (anchor.x - L.ox) / (L.W * L.s), pv = (anchor.y - L.oy) / (L.H * L.s), s2 = L.fit * z;
    view.u = pu - (anchor.x - L.cw / 2) / (L.W * s2);
    view.v = pv - (anchor.y - L.ch / 2) / (L.H * s2);
  }
  view.zoom = z;
  $('opt-zoom').value = String(z);
  $('zoom-read').textContent = `${Math.round(z * 100)}%`;
}
function resetView() { view.u = 0.5; view.v = 0.5; setZoom(1); }
function setFollow(v) { view.follow = v; $('opt-follow').checked = v; }

function bindView() {
  $('opt-zoom').addEventListener('input', (e) => setZoom(+e.target.value));
  $('opt-follow').addEventListener('change', (e) => { view.follow = e.target.checked; });
  $('btn-fit').addEventListener('click', resetView);
  $('btn-zoom-in').addEventListener('click', () => setZoom(view.zoom * 1.25));
  $('btn-zoom-out').addEventListener('click', () => setZoom(view.zoom / 1.25));
  $('btn-full').addEventListener('click', () => setImmersive(!state.immersive));
  $('btn-drawer').addEventListener('click', () => document.body.classList.toggle('drawer-open'));

  stage.addEventListener('wheel', (e) => {
    if (!state.mode) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    setZoom(view.zoom * Math.exp(-e.deltaY * 0.0015), { x: e.clientX - r.left, y: e.clientY - r.top });
    if (view.zoom > 1.01) setFollow(false);
  }, { passive: false });
  stage.addEventListener('dblclick', (e) => {
    if (!state.mode || e.target.closest('.stage-ctrls')) return;
    const r = stage.getBoundingClientRect();
    if (view.zoom > 1.05) resetView(); else { setZoom(2.2, { x: e.clientX - r.left, y: e.clientY - r.top }); setFollow(false); }
  });
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (!state.mode || view.zoom <= 1.01 || e.target.closest('.stage-ctrls, .hud')) return;
    drag = { x: e.clientX, y: e.clientY, u: view.u, v: view.v };
    stage.setPointerCapture(e.pointerId); stage.classList.add('grabbing'); setFollow(false);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || !lastLayout) return;
    view.u = drag.u - (e.clientX - drag.x) / (lastLayout.W * lastLayout.s);
    view.v = drag.v - (e.clientY - drag.y) / (lastLayout.H * lastLayout.s);
  });
  const end = () => { drag = null; stage.classList.remove('grabbing'); };
  stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);

  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && state.immersive) setImmersive(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.immersive) setImmersive(false);
    else if ((e.key === 'f' || e.key === 'F') && state.mode && !/input|select|textarea/i.test(e.target.tagName)) setImmersive(!state.immersive);
  });
}

async function setImmersive(on) {
  state.immersive = on;
  document.body.classList.toggle('immersive', on);
  if (!on) document.body.classList.remove('drawer-open');
  stage.style.aspectRatio = on ? 'auto' : `${state.W} / ${state.H}`;
  $('btn-full').textContent = on ? 'Exit full screen' : 'Full screen';
  $('btn-drawer').hidden = !on;
  try {
    if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
    else if (!on && document.fullscreenElement) await document.exitFullscreen();
  } catch { /* fullscreen API unavailable: the CSS layout still fills the window */ }
}
function applyMirror() {
  video.classList.toggle('mirror', state.mirror);
  backdrop.classList.toggle('mirror', state.mirror);
}
function enterRunning(mode) {
  state.mode = mode;
  $('welcome').hidden = true; $('hud').hidden = false;
  for (const id of ['btn-rescan', 'btn-snap', 'btn-stop']) $(id).disabled = false;
  $('demo-controls').hidden = mode !== 'demo'; $('stage-ctrls').hidden = false;
  video.hidden = mode !== 'camera'; backdrop.hidden = mode !== 'demo';
  state.engine.reset(); state.wasLocked = false; state.lastReportText = ''; state.report = null;
  applyMirror();
}

// --------------------------------------------------------------- sources ----
async function createLandmarker() {
  let mod, base, model;
  try {                                                  // offline copy (npm run vendor) wins if present
    mod = await import('../vendor/mediapipe/vision_bundle.mjs');
    base = 'vendor/mediapipe/wasm'; model = 'vendor/face_landmarker.task';
  } catch {
    mod = await import(`${MP_CDN}/vision_bundle.mjs`);
    base = `${MP_CDN}/wasm`; model = MODEL_CDN;
  }
  const fileset = await mod.FilesetResolver.forVisionTasks(base);
  const make = (delegate) => mod.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: model, delegate },
    runningMode: 'VIDEO', numFaces: 1,
    minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  try { return await make('GPU'); } catch (e) { console.warn('GPU delegate failed, using CPU', e); return make('CPU'); }
}

async function startCamera() {
  const msg = $('welcome').querySelector('p');
  $('btn-camera').disabled = true; $('btn-demo').disabled = true;
  try {
    msg.textContent = 'Loading face model...';
    state.landmarker = state.landmarker || await createLandmarker();
    msg.textContent = 'Waiting for camera permission...';
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
    });
    video.srcObject = state.stream;
    await video.play();
    setCanvasSize(video.videoWidth, video.videoHeight);
    enterRunning('camera');
  } catch (err) {
    console.error(err);
    msg.textContent = err.name === 'NotAllowedError'
      ? 'Camera permission was denied. Allow camera access for this site and try again, or use the demo face.'
      : `Could not start the camera: ${err.message}. (The face model downloads from a CDN, so an internet connection is needed the first time - or run "npm run vendor".)`;
    $('btn-camera').disabled = false; $('btn-demo').disabled = false;
  }
}

function startDemo() {
  setCanvasSize(960, 720);
  enterRunning('demo');
}

function stop() {
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  state.stream = null; video.srcObject = null; state.mode = null; lastPrims = null; state.report = null;
  octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, overlay.width, overlay.height); bctx.clearRect(0, 0, state.W, state.H);
  $('welcome').hidden = false; $('hud').hidden = true; $('stage-ctrls').hidden = true;
  if (state.immersive) setImmersive(false);
  $('welcome').querySelector('p').textContent = 'Start the camera for a live scan, or try the demo face to see how the map follows a turning head.';
  $('btn-camera').disabled = false; $('btn-demo').disabled = false;
  for (const id of ['btn-rescan', 'btn-snap', 'btn-stop']) $(id).disabled = true;
  showPanes();
}

function snapshot() {
  const L = lastLayout; if (!L) return;
  const c = document.createElement('canvas'); c.width = overlay.width; c.height = overlay.height;
  const g = c.getContext('2d'), d = L.dpr;
  g.fillStyle = '#0d0a09'; g.fillRect(0, 0, c.width, c.height);
  g.save();
  if (state.mirror) { g.translate(2 * (L.ox + (L.W * L.s) / 2) * d, 0); g.scale(-1, 1); }
  g.drawImage(state.mode === 'camera' ? video : backdrop, L.ox * d, L.oy * d, L.W * L.s * d, L.H * L.s * d);
  g.restore();
  g.drawImage(overlay, 0, 0);
  const a = document.createElement('a');
  a.download = `facemap-${Date.now()}.png`;
  a.href = c.toDataURL('image/png');
  a.click();
}

// ------------------------------------------------------------ main loop ----
function paintDemoFace(lm, W, H, blink) {
  const P = (i) => [lm[i * 3] * W, lm[i * 3 + 1] * H];
  const poly = (idx, fill, stroke) => {
    bctx.beginPath(); idx.forEach((i, k) => { const [x, y] = P(i); k ? bctx.lineTo(x, y) : bctx.moveTo(x, y); });
    bctx.closePath(); if (fill) { bctx.fillStyle = fill; bctx.fill(); } if (stroke) { bctx.strokeStyle = stroke; bctx.lineWidth = 1.5; bctx.stroke(); }
  };
  const g = bctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#3a2f2b'); g.addColorStop(1, '#201a17');
  bctx.fillStyle = g; bctx.fillRect(0, 0, W, H);
  const [nx, ny] = P(152); const [ex, ey] = P(10);
  bctx.fillStyle = '#c99d85'; bctx.fillRect(nx - W * 0.07, ny - 20, W * 0.14, H);
  poly([...OVAL_R, ...OVAL_L.slice().reverse().slice(1, -1)], '#e9c3a9', '#cfa58b');
  const [bx, by] = P(1);
  bctx.beginPath(); bctx.moveTo(...P(168)); bctx.lineTo(bx, by); bctx.strokeStyle = 'rgba(160,110,90,.35)'; bctx.lineWidth = 3; bctx.stroke();
  poly(LIPS_OUTER, '#c9656f', null);
  for (const [up, lo, ic, ring] of [[[33, 246, 161, 160, 159, 158, 157, 173, 133], [133, 155, 154, 153, 145, 144, 163, 7], 468, 469],
                                    [[263, 466, 388, 387, 386, 385, 384, 398, 362], [362, 382, 381, 380, 374, 373, 390, 249], 473, 474]]) {
    if (!blink) {
      poly([...up, ...lo], '#fbf7f2', null);
      const [ix, iy] = P(ic); const [rx, ry] = P(ring);
      const r = Math.hypot(rx - ix, ry - iy);
      bctx.beginPath(); bctx.ellipse(ix, iy, r, r, 0, 0, 7); bctx.fillStyle = '#4b3424'; bctx.fill();
      bctx.beginPath(); bctx.ellipse(ix, iy, r * 0.45, r * 0.45, 0, 0, 7); bctx.fillStyle = '#120c09'; bctx.fill();
    }
    poly(up, null, '#3b2a22');
  }
  const off = +(new URLSearchParams(location.search).get('browoff') || 0);      // test hook: paint brows off the landmarks
  const Ps = P; const ied = Math.hypot(Ps(473)[0] - Ps(468)[0], Ps(473)[1] - Ps(468)[1]);
  const Pshift = (i) => { const [x, y] = Ps(i); return [x, y + off * ied]; };
  const polyS = (idx, fill) => { bctx.beginPath(); idx.forEach((i, k) => { const [x, y] = Pshift(i); k ? bctx.lineTo(x, y) : bctx.moveTo(x, y); }); bctx.closePath(); bctx.fillStyle = fill; bctx.fill(); };
  polyS([70, 63, 105, 66, 107, 55, 65, 52, 53, 46], '#4e3527');
  polyS([300, 293, 334, 296, 336, 285, 295, 282, 283, 276], '#4e3527');
  void ex; void ey;
}

const scanner = new BrowScanner();
function tick(now) {
  requestAnimationFrame(tick);
  if (!state.mode) return;
  let landmarks = null, blink = 0;

  if (state.mode === 'camera') {
    if (video.readyState < 2 || video.currentTime === state.lastVideoTime) return;
    state.lastVideoTime = video.currentTime;
    const res = state.landmarker.detectForVideo(video, now);
    if (res.faceLandmarks && res.faceLandmarks[0] && res.faceLandmarks[0].length >= 478) {
      flattenLandmarks(res.faceLandmarks[0], lmBuf); landmarks = lmBuf;
    }
  } else {
    const t = now / 1000, sweep = $('demo-sweep').checked;
    const yaw = sweep ? 30 * Math.sin(t * 0.8) : +$('demo-yaw').value;
    blink = (t % 4.5) < 0.14 ? 1 : 0;
    landmarks = makeDemoFace({
      yaw, pitch: sweep ? 7 * Math.sin(t * 0.55) : 0, roll: sweep ? 5 * Math.sin(t * 0.37) : 0,
      variant: $('demo-variant').value, W: state.W, H: state.H, blink,
    });
    paintDemoFace(landmarks, state.W, state.H, blink);
  }

  if (landmarks && state.pixelBrows) state.scanStats = scanner.refine(landmarks, state.mode === 'camera' ? video : bctx.canvas, state.W, state.H);
  const prims = landmarks ? state.engine.process(landmarks, state.W, state.H, now) : (state.engine.process(new Float32Array(0), 1, 1, now), null);
  lastPrims = prims;
  if (landmarks && view.follow && view.zoom > 1.01) {          // ease the view toward the face
    const nx = landmarks[168 * 3], ny = landmarks[168 * 3 + 1] - 0.025;   // aim at the brow/eye region
    view.u += ((state.mirror ? 1 - nx : nx) - view.u) * 0.15; view.v += (ny - view.v) * 0.15;
  }
  const L = layout();
  if (L) drawOverlay(octx, prims, { ...L, mirror: state.mirror, layers: state.layers, opacity: state.opacity, browStyle: state.browStyle });

  const dt = now - state.lastFrame; state.lastFrame = now;
  if (dt > 0) state.fps += (1000 / dt - state.fps) * 0.1;

  if (now - state.lastReportAt > 200) {
    state.lastReportAt = now;
    $('chip-fps').textContent = `${state.fps.toFixed(0)} fps`;
    const ss = state.scanStats; $('pixel-stat').textContent = !state.pixelBrows ? '' : (ss && ss.ok ? `brow edges found on ${ss.found}/${ss.total} points` : 'brow colour scan: low contrast, using face landmarks');
    refreshReport(prims, now);
  }
}

// -------------------------------------------------------------- results ----
function refreshReport(prims, now) {
  const text = state.engine.reportText();
  const hud = $('hud-msg'), prog = $('progress');
  if (!prims) {
    hud.textContent = state.mode === 'camera' ? 'Looking for your face - face the camera in good light.' : '';
    hud.classList.toggle('show', state.mode === 'camera'); prog.hidden = true;
    return;
  }
  const r = JSON.parse(text);
  state.report = r;
  const sc = r.scan;
  if (!sc.locked) {
    hud.classList.add('show'); prog.hidden = false;
    $('progress-bar').style.width = `${Math.round(sc.progress * 100)}%`;
    hud.textContent = r.frontal ? `Hold still... scanning ${Math.round(sc.progress * 100)}%` : 'Look straight at the camera to scan';
  } else {
    prog.hidden = true;
    if (!state.wasLocked) { state.wasLocked = true; state.hudHideAt = now + 4500; hud.textContent = 'Scan complete - turn your head, the map follows.'; hud.classList.add('show'); }
    if (now > state.hudHideAt) hud.classList.remove('show');
  }
  if (text === state.lastReportText) return;
  state.lastReportText = text;
  renderReport(r);
}

function setKV(dl, rows) {
  dl.replaceChildren();
  for (const [k, v] of rows) { dl.append(el('dt', null, k), el('dd', null, String(v))); }
}
function setList(ul, items) {
  ul.replaceChildren(...items.map((t) => el('li', null, t)));
}

function renderReport(r) {
  showPanes();
  $('chip-pose').textContent = `yaw ${r.yaw.toFixed(0)}  pitch ${r.pitch.toFixed(0)}  roll ${r.roll.toFixed(0)}`;
  const f = r.face;
  $('o-shape').textContent = f.shape;
  $('o-conf').textContent = `${Math.round(f.confidence * 100)}% match`;
  $('o-state').textContent = r.scan.locked ? 'locked' : `scanning ${Math.round(r.scan.progress * 100)}%`;
  $('o-state').className = r.scan.locked ? 'locked' : '';
  $('o-blurb').textContent = f.blurb;
  const rank = $('o-rank'); rank.replaceChildren();
  for (const it of f.ranking) {
    const row = el('div', 'bar-row');
    const bar = el('div', 'bar'); const fill = el('span'); fill.style.width = `${Math.round(it.p * 100)}%`; bar.append(fill);
    row.append(el('span', 'bar-name', it.name), bar, el('span', 'bar-val', `${Math.round(it.p * 100)}%`));
    rank.append(row);
  }
  setKV($('o-bone'), [['Cheekbones', f.bone.cheekbones], ['Jaw', f.bone.jaw], ['Chin', f.bone.chin], ['Forehead', f.bone.forehead]]);
  $('o-sym-bar').style.width = `${r.symmetry.score}%`;
  $('o-sym').textContent = `${r.symmetry.score}/100 - average left/right offset ${r.symmetry.meanOffsetMm} mm (assuming a 63 mm eye distance).`;

  setKV($('e-attrs'), [['Shape', r.eyes.shape], ['Tilt', r.eyes.tilt], ['Spacing', r.eyes.spacing], ['Lid space', r.eyes.lidSpace]]);
  setList($('e-tips'), r.eyes.tips);

  $('b-style').textContent = r.brows.style; $('b-why').textContent = r.brows.why;
  setList($('b-asym'), r.brows.asymmetry);

  const secs = $('m-sections'); secs.replaceChildren();
  secs.append(el('p', 'muted', `Placement tuned for a ${f.shape.toLowerCase()} face. Ovals on the camera view show where to apply each product; toggle layers under the video.`));
  const defs = [['contour', 'Contour', 'contour'], ['bronzer', 'Bronzer', 'bronzer'], ['blush', 'Blush', 'blush'], ['highlight', 'Highlight', 'highlight']];
  for (const [key, title, layer] of defs) {
    const sec = el('section', 'mk'); const head = el('h3');
    const sw = el('i'); sw.style.background = LAYERS.find((l) => l.id === layer).color;
    const btn = el('button', 'btn small', state.layers[layer] ? 'Hide' : 'Show'); btn.type = 'button';
    btn.addEventListener('click', () => { setLayer(layer, !state.layers[layer]); btn.textContent = state.layers[layer] ? 'Hide' : 'Show'; });
    head.append(sw, title, btn);
    const ul = el('ul', 'tips'); setList(ul, r.tips[key]);
    sec.append(head, ul); secs.append(sec);
  }

  const m = r.measure;
  setKV($('d-measure'), [
    ['length / width', m.lengthToWidth], ['forehead / cheek', m.foreheadToCheek], ['jaw / cheek', m.jawToCheek],
    ['chin angle', `${m.chinAngle} deg`], ['jaw angle', `${m.jawAngle} deg`], ['cheek prominence', m.cheekProminence],
    ['eye openness', m.eyeOpenness], ['eye tilt', `${m.eyeTilt} deg`], ['eye spacing', m.eyeSpacing], ['lid space', m.lidSpace],
    ['yaw / pitch / roll', `${r.yaw} / ${r.pitch} / ${r.roll}`], ['frontal', r.frontal ? 'yes' : 'no'],
  ]);
}

boot();
