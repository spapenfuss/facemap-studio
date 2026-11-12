// OnFleek - UI glue: camera + MediaPipe landmarks -> C++/WASM engine -> canvas overlay; navigation between Face, Color and Makeup.
import { loadEngine, flattenLandmarks } from './engine.js';
import { drawOverlay, LAYERS } from './overlay.js';
import { store } from './store.js';
import { BROW_REC, explainShape, shapeDiagramSVG, lipAnalysis, MAKEUP } from './profiles.js';
import { initColor } from './colorui.js';
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
  mirror: true, opacity: 0.85, immersive: false, view: 'color', cat: 'blush',
  lastVideoTime: -1, fps: 0, lastFrame: 0, lastReportAt: 0, lastReportText: '',
  report: null, hudHideAt: 0, wasLocked: false, lastLm: null, lastLmAt: 0, busyImage: false, tint: {},
};
const view = { zoom: 1, u: 0.5, v: 0.5, follow: true };   // u,v = focal point in displayed (mirrored) video space
let lastLayout = null;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const lmBuf = new Float32Array(478 * 3);
let lastPrims = null;

// ------------------------------------------------------------------ boot ----
const VIEWS = ['face', 'color', 'makeup'];
function setView(v) {
  if (!VIEWS.includes(v)) v = 'color';
  state.view = v;
  $('view-color').hidden = v !== 'color'; $('view-face').hidden = v === 'color';
  $('view-face').dataset.mode = v;
  $('pane-face').hidden = v !== 'face'; $('pane-makeup').hidden = v !== 'makeup';
  $('makeup-bar').hidden = v !== 'makeup';
  $('opacity-wrap').hidden = v !== 'makeup';
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
  applyCategory();
  if (v === 'makeup') renderMakeup();
  window.dispatchEvent(new Event('resize'));
  window.scrollTo({ top: 0 });
}
function refreshNav() {
  const d = store.get();
  document.querySelector('[data-view="face"]').classList.toggle('done', !!d.face);
  document.querySelector('[data-view="color"]').classList.toggle('done', !!d.color);
  document.querySelector('[data-view="makeup"]').classList.toggle('ready', !!d.color);
}
async function boot() {
  const qp = new URLSearchParams(location.search);
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.goto)));
  initColor();
  store.subscribe(() => { refreshNav(); updateTint(); if (state.view === 'makeup') renderMakeup(); });
  refreshNav(); updateTint();
  setView(qp.get('view') || (qp.has('demo') ? 'face' : 'color'));
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
  buildCategoryPills();
  bindUI();
  requestAnimationFrame(tick);
  if (new URLSearchParams(location.search).has('demo')) startDemo();
}

// ------------------------------------------------------------------- UI ----
const CATS = [
  { id: 'blush', label: 'Blush', layers: ['blush'] },
  { id: 'contour', label: 'Contour', layers: ['contour'] },
  { id: 'bronzer', label: 'Bronzer', layers: ['bronzer'] },
  { id: 'highlight', label: 'Highlight', layers: ['highlight'] },
  { id: 'eyeshadow', label: 'Eyeshadow', layers: ['eyeshadow'] },
  { id: 'eyeliner', label: 'Eyeliner', layers: ['eyeliner'] },
  { id: 'lips', label: 'Lips', layers: ['lips'] },
];
function buildCategoryPills() {
  const box = $('m-cats');
  for (const c of CATS) {
    const b = el('button', 'pill', c.label); b.type = 'button'; b.dataset.cat = c.id;
    b.addEventListener('click', () => { state.cat = c.id; applyCategory(); renderMakeup(); });
    box.appendChild(b);
  }
}
/** Face view shows no overlays; Makeup view shows the chosen category. */
function applyCategory() {
  for (const l of LAYERS) state.layers[l.id] = false;
  if (state.view === 'makeup') for (const id of CATS.find((c) => c.id === state.cat).layers) state.layers[id] = true;
  document.querySelectorAll('#m-cats .pill').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === state.cat)));
}
function updateTint() {
  const d = store.get(), m = d.color ? MAKEUP[d.color.seasonId] : null;
  state.tint = m ? { blush: m.blush[0][0], eyeshadow: m.shadowAccent[0][0], eyeliner: m.liner[0][0], lips: m.lipEveryday[0][0], liplin: m.lipLiner[0][0] } : {};
}

function bindUI() {
  $('btn-camera').addEventListener('click', startCamera);
  $('btn-demo').addEventListener('click', startDemo);
  $('btn-stop').addEventListener('click', stop);
  $('btn-rescan').addEventListener('click', () => { state.engine.reset(); state.wasLocked = false; state.lastReportText = ''; });
  $('btn-snap').addEventListener('click', snapshot);
  $('opt-mirror').addEventListener('change', (e) => { state.mirror = e.target.checked; applyMirror(); });
  $('opt-opacity').addEventListener('input', (e) => { state.opacity = +e.target.value; });
  bindView();
  $('demo-sweep').addEventListener('change', (e) => { $('demo-yaw').disabled = e.target.checked; });
  $('demo-yaw').disabled = true;
  $('demo-variant').addEventListener('change', () => state.engine.reset());

  const cal = [['cal-len', 0], ['cal-fore', 2], ['cal-jaw', 3]];
  for (const [id, param] of cal) {
    $(id).addEventListener('input', (e) => { state.engine.setParam(param, +e.target.value); $(id + '-o').textContent = (+e.target.value).toFixed(2); });
  }
  $('cal-reset').addEventListener('click', () => {
    for (const [id, param] of cal) { $(id).value = 0; $(id + '-o').textContent = '0.00'; state.engine.setParam(param, 0); }
  });
}
function showPanes() {
  $('empty').hidden = !!state.report; $('face-results').hidden = !state.report;
  if (state.view === 'makeup') renderMakeup();
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
  $('welcome').querySelector('p').textContent = 'Turn on your camera for a quick scan. OnFleek finds your face shape and where makeup will look best on you.';
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
  a.download = `onfleek-${Date.now()}.png`;
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
  const off = 0;
  const Ps = P; const ied = Math.hypot(Ps(473)[0] - Ps(468)[0], Ps(473)[1] - Ps(468)[1]);
  const Pshift = (i) => { const [x, y] = Ps(i); return [x, y + off * ied]; };
  const polyS = (idx, fill) => { bctx.beginPath(); idx.forEach((i, k) => { const [x, y] = Pshift(i); k ? bctx.lineTo(x, y) : bctx.moveTo(x, y); }); bctx.closePath(); bctx.fillStyle = fill; bctx.fill(); };
  polyS([70, 63, 105, 66, 107, 55, 65, 52, 53, 46], '#4e3527');
  polyS([300, 293, 334, 296, 336, 285, 295, 282, 283, 276], '#4e3527');
  void ex; void ey;
}

function tick(now) {
  requestAnimationFrame(tick);
  if (!state.mode || state.busyImage) return;
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

  if (landmarks) { state.lastLm = landmarks; state.lastLmAt = performance.now(); }
  const prims = landmarks ? state.engine.process(landmarks, state.W, state.H, now) : (state.engine.process(new Float32Array(0), 1, 1, now), null);
  lastPrims = prims;
  if (landmarks && view.follow && view.zoom > 1.01) {          // ease the view toward the face
    const nx = landmarks[168 * 3], ny = landmarks[168 * 3 + 1] - 0.025;   // aim at the brow/eye region
    view.u += ((state.mirror ? 1 - nx : nx) - view.u) * 0.15; view.v += (ny - view.v) * 0.15;
  }
  const L = $('view-face').hidden ? null : layout();
  if (L) drawOverlay(octx, prims, { ...L, mirror: state.mirror, layers: state.layers, opacity: state.opacity, tint: state.tint, lm: landmarks, lipsOn: state.layers.lips, linerOn: state.layers.eyeliner });

  const dt = now - state.lastFrame; state.lastFrame = now;
  if (dt > 0) state.fps += (1000 / dt - state.fps) * 0.1;

  if (now - state.lastReportAt > 200) {
    state.lastReportAt = now;
    $('chip-fps').textContent = `${state.fps.toFixed(0)} fps`;
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
  const f = r.face, m = r.measure;
  $('o-shape').textContent = f.shape;
  $('o-conf').textContent = `${Math.round(f.confidence * 100)}% match`;
  $('o-state').textContent = r.scan.locked ? 'scan complete' : `scanning ${Math.round(r.scan.progress * 100)}%`;
  $('o-state').className = r.scan.locked ? 'locked' : '';
  $('o-blurb').textContent = f.blurb;

  // why this shape: diagram + the proportions that carried the decision
  $('f-diagram').innerHTML = shapeDiagramSVG(m);
  const why = $('f-why'); why.replaceChildren();
  for (const row of explainShape(f.shape, m)) {
    const li = el('li', row.fits ? 'fit' : 'off');
    const head = el('div', 'why-head'); head.append(el('b', null, row.title), el('span', 'why-val', row.value));
    li.append(head, el('div', null, row.text), el('div', 'muted small', row.note));
    why.append(li);
  }
  const rank = $('o-rank'); rank.replaceChildren();
  for (const it of f.ranking) {
    const row = el('div', 'bar-row');
    const bar = el('div', 'bar'); const fill = el('span'); fill.style.width = `${Math.round(it.p * 100)}%`; bar.append(fill);
    row.append(el('span', 'bar-name', it.name), bar, el('span', 'bar-val', `${Math.round(it.p * 100)}%`));
    rank.append(row);
  }

  // eyebrow recommendation (advice only; nothing is drawn on the face)
  const br = BROW_REC[f.shape];
  if (br) { $('f-brow-name').textContent = br.name; $('f-brow-why').textContent = br.why; $('f-brow-avoid').textContent = br.avoid; }

  setKV($('o-bone'), [['Cheekbones', f.bone.cheekbones], ['Jaw', f.bone.jaw], ['Chin', f.bone.chin], ['Forehead', f.bone.forehead]]);
  $('o-sym-bar').style.width = `${r.symmetry.score}%`;
  $('o-sym').textContent = `${r.symmetry.score}/100 - average left/right offset ${r.symmetry.meanOffsetMm} mm (assuming a 63 mm eye distance).`;
  setKV($('d-measure'), [
    ['length / width', m.lengthToWidth], ['forehead / cheek', m.foreheadToCheek], ['jaw / cheek', m.jawToCheek],
    ['chin angle', `${m.chinAngle} deg`], ['jaw angle', `${m.jawAngle} deg`], ['cheek prominence', m.cheekProminence],
    ['eye openness', m.eyeOpenness], ['eye tilt', `${m.eyeTilt} deg`], ['eye spacing', m.eyeSpacing], ['lid space', m.lidSpace],
    ['yaw / pitch / roll', `${r.yaw} / ${r.pitch} / ${r.roll}`], ['frontal', r.frontal ? 'yes' : 'no'],
  ]);
  if (r.scan.locked) store.setFace({ shape: f.shape, confidence: f.confidence, measure: m });
  if (state.view === 'makeup') renderMakeup();
}

// ------------------------------------------------------------- makeup tab ----
const swatchRow = (items) => {
  const row = el('div', 'swatches');
  for (const [hex, name] of items) { const c = el('div', 'swatch'); const chip = el('i'); chip.style.background = hex; chip.title = hex; c.append(chip, el('span', null, name)); row.append(c); }
  return row;
};
const sub = (t) => el('h4', null, t);
/** Colors for one category, from the user's season. */
function categoryColors(cat, mk) {
  const out = [];
  if (cat === 'blush') out.push(sub('Blush shades for you'), swatchRow(mk.blush));
  if (cat === 'eyeshadow') {
    out.push(sub('Everyday neutrals'), swatchRow(mk.shadowNeutral), sub('Color accents'), swatchRow(mk.shadowAccent), sub('Combinations that work together'));
    for (const [name, hexes] of mk.combos) { const r = el('div', 'combo'); r.append(el('span', 'combo-name', name)); for (const h of hexes) { const c = el('i'); c.style.background = h; r.append(c); } out.push(r); }
  }
  if (cat === 'eyeliner') out.push(sub('Liner colors beyond black'), swatchRow(mk.liner));
  if (cat === 'lips') out.push(sub('Everyday lip colors'), swatchRow(mk.lipEveryday), sub('More noticeable shades'), swatchRow(mk.lipBold), sub('Matching lip liners'), swatchRow(mk.lipLiner));
  return out;
}
const PLACEMENT = {
  blush: { tipKey: 'blush', title: 'Blush', why: 'Blush adds a healthy flush. Its position changes how long or wide the face looks, so it is placed to suit your face shape.' },
  contour: { tipKey: 'contour', title: 'Contour', why: 'Contour is a soft shadow that adds definition. It is placed to complement your proportions, never to change them.' },
  bronzer: { tipKey: 'bronzer', title: 'Bronzer', why: 'Bronzer warms the places the sun would naturally touch, placed in the pattern that flatters your shape.' },
  highlight: { tipKey: 'highlight', title: 'Highlight', why: 'Highlight catches light on the high points of the face. These spots bring forward the areas you would like to emphasize.' },
};
function renderMakeup() {
  if (state.view !== 'makeup') return;
  const d = store.get(), mk = d.color ? MAKEUP[d.color.seasonId] : null, r = state.report;
  $('m-lock').hidden = !!d.color;
  $('m-nocam').hidden = !!r;
  const ban = $('m-season'); ban.hidden = !d.color;
  if (d.color) ban.innerHTML = `<span>Colors chosen for your season</span><b></b><small>Based on your Color Analysis. <a href="#" data-goto="color">Redo it</a></small>`, ban.querySelector('b').textContent = d.color.name, ban.querySelector('a').addEventListener('click', (e) => { e.preventDefault(); setView('color'); });
  const box = $('m-detail'); box.replaceChildren();
  const cat = CATS.find((c) => c.id === state.cat), shape = r ? r.face.shape : (d.face ? d.face.shape : null);
  box.append(el('h3', null, cat.label));
  if (PLACEMENT[cat.id]) {
    const P = PLACEMENT[cat.id];
    box.append(el('p', 'muted', P.why));
    box.append(sub(shape ? `Where it goes on a ${shape.toLowerCase()} face` : 'Where it goes'));
    if (r) { const ul = el('ul', 'tips'); setList(ul, r.tips[P.tipKey]); box.append(ul); } else box.append(el('p', 'muted small', 'Start the camera (Face Analysis) and the placement for your face shape appears here.'));
  } else if (cat.id === 'eyeshadow' || cat.id === 'eyeliner') {
    box.append(el('p', 'muted', cat.id === 'eyeshadow' ? 'The overlay shows lid color, the crease and the outer corner. Depth goes where it opens and lifts your eye.' : 'The overlay shows a liner line along the upper lashes and a wing guide. Keep it thin if your eyes are close together.'));
    if (r) {
      box.append(sub('Your eyes'), el('p', 'muted small', `${r.eyes.shape} shape, ${r.eyes.tilt.toLowerCase()} tilt, ${r.eyes.spacing.toLowerCase()} spacing.`));
      const ul = el('ul', 'tips'); setList(ul, r.eyes.tips); box.append(ul);
    } else box.append(el('p', 'muted small', 'Start the camera to see tips for your eye shape.'));
  } else if (cat.id === 'lips') {
    box.append(el('p', 'muted', 'The overlay shows your natural lip line (the liner guide) and a color wash for the lipstick. Line first, then fill.'));
    if (state.lastLm) { box.append(sub('Your lip shape')); const ul = el('ul', 'tips'); setList(ul, lipAnalysis(state.lastLm, state.W, state.H)); box.append(ul); }
    else box.append(el('p', 'muted small', 'Start the camera to get advice for your own lip shape.'));
  }
  if (mk) for (const n of categoryColors(cat.id, mk)) box.append(n);
  else if (['blush', 'eyeshadow', 'eyeliner', 'lips'].includes(cat.id)) box.append(el('p', 'locked-note', 'Your personalized colors for this will appear after you finish Color Analysis.'));

  const pc = $('m-palette-card'); pc.hidden = !mk;
  if (mk) {
    const p = $('m-palette'); p.replaceChildren();
    for (const [t, items] of [['Blush', mk.blush], ['Eyeshadow neutrals', mk.shadowNeutral], ['Eyeshadow accents', mk.shadowAccent], ['Eyeliner', mk.liner], ['Everyday lips', mk.lipEveryday], ['Bold lips', mk.lipBold], ['Lip liner', mk.lipLiner]]) {
      p.append(sub(t), swatchRow(items));
    }
  }
}

boot();

// ---- bridge used by the color-analysis page (colorui.js) ----
window.FM = {
  landmarks: () => (state.lastLm ? { lm: state.lastLm, at: state.lastLmAt } : null),
  async lockExposure() {
    const tr = state.stream && state.stream.getVideoTracks()[0]; if (!tr || !tr.applyConstraints) return { exposure: false, wb: false };
    const caps = tr.getCapabilities ? tr.getCapabilities() : {}, st = tr.getSettings ? tr.getSettings() : {}, out = { exposure: false, wb: false };
    const tryAdv = async (adv) => { try { await tr.applyConstraints({ advanced: [adv] }); return true; } catch { return false; } };
    if ((caps.exposureMode || []).includes('manual')) out.exposure = await tryAdv({ exposureMode: 'manual', ...(st.exposureTime ? { exposureTime: st.exposureTime } : {}) });
    if ((caps.whiteBalanceMode || []).includes('manual')) out.wb = await tryAdv({ whiteBalanceMode: 'manual', ...(st.colorTemperature ? { colorTemperature: st.colorTemperature } : {}) });
    return out;
  },
  async unlockExposure() { const tr = state.stream && state.stream.getVideoTracks()[0]; if (!tr) return; try { await tr.applyConstraints({ advanced: [{ exposureMode: 'continuous' }, { whiteBalanceMode: 'continuous' }] }); } catch { /* ignore */ } },
  source: () => (state.mode === 'camera' ? video : state.mode === 'demo' ? bctx.canvas : null),
  size: () => ({ W: state.W, H: state.H }),
  faceFresh: () => !!state.lastLm && performance.now() - state.lastLmAt < 700,
  async startCamera() {
    if (state.mode === 'demo') stop();
    if (state.mode === 'camera') return;
    await startCamera();
    if (state.mode !== 'camera') throw new Error($('welcome').querySelector('p').textContent);
  },
  startDemo() { if (state.mode === 'camera') stop(); if (state.mode !== 'demo') startDemo(); },
  grabStill(mirror) {
    const src = window.FM.source(); if (!src || !state.lastLm) return null;
    const c = document.createElement('canvas'); c.width = state.W; c.height = state.H;
    const g = c.getContext('2d'); if (mirror) { g.translate(c.width, 0); g.scale(-1, 1); }
    g.drawImage(src, 0, 0, c.width, c.height);
    const lm = new Float32Array(state.lastLm); if (mirror) for (let i = 0; i < 478; i++) lm[i * 3] = 1 - lm[i * 3];
    return { canvas: c, lm };
  },
  async detectImage(canvas) {
    state.landmarker = state.landmarker || await createLandmarker();
    state.busyImage = true;
    try {
      await state.landmarker.setOptions({ runningMode: 'IMAGE' });
      const res = state.landmarker.detect(canvas);
      await state.landmarker.setOptions({ runningMode: 'VIDEO' });
      if (res.faceLandmarks && res.faceLandmarks[0] && res.faceLandmarks[0].length >= 478) { const out = new Float32Array(478 * 3); flattenLandmarks(res.faceLandmarks[0], out); return out; }
      return null;
    } finally { state.busyImage = false; }
  },
};
