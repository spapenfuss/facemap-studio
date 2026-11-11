# FaceMap Studio

Scan your face with the webcam and get a personalised **face-shape analysis**, **symmetric brow template**, and **live makeup map** (contour, bronzer, blush, highlight, eye makeup). Overlays are drawn on the video as light ovals and outlines, and they **follow your head** when you turn, tilt or nod.

The geometry and analysis run in a **C++17 engine compiled to WebAssembly**. The browser side (HTML/CSS/JavaScript) handles the camera, the MediaPipe landmark detector and drawing.

```
camera ─► MediaPipe Face Landmarker (478 pts) ─► C++/WASM engine ─► drawing primitives ─► <canvas>
                                                       │
                                                       └──► JSON report ─► results panel
```

## Run it in VS Code (3 steps)

You need **Node.js 18+** (any recent version). No `npm install` is required - there are zero dependencies, and a prebuilt `web/wasm/engine.wasm` is included.

1. Open this folder in VS Code (`File > Open Folder`).
2. Open a terminal (`Ctrl+` `` ` ``) and run: `npm start`  
   (or `Terminal > Run Task... > Serve`). Alternatives: `python -m http.server 5173 --directory web`, or the *Live Server* extension on `web/index.html`.
3. Open **http://localhost:5173** in Chrome/Edge, click **Start camera** and allow access.  
   Prefer to look around first? Click **Try demo face** (or open `http://localhost:5173/?demo`): a procedural face turns its head so you can see the map track it, no camera needed.

> The page must be served over `http://localhost`. Opening `index.html` from disk (`file://`) blocks both WebAssembly loading and the camera.

The first camera start downloads the MediaPipe model (~4 MB) from a CDN. For offline use run `npm run vendor` once (needs internet; copies MediaPipe into `web/vendor/`).

## Using it

1. **Scan**: look straight at the camera and hold still for ~2 s (progress bar). Face shape, bone structure and eye features lock in using only near-frontal frames.
2. **Turn your head**: the brow template and every zone stay glued to your face.
3. **Brows tab**: the brow is drawn like a professional **brow-mapping chart** - numbered white lines (1st midline, 2nd level line, 3rd nostril-to-eye-corner line, 4th inner V, 5th start, 6th arch, 7th tail, 8th/9th upper and lower brow lines) with an optional **Diamond frame**. Both brows get the identical, level shape; Each brow starts at the bridge of the nose. All overlays start switched off; use the **Brows** and **Face** tabs under the video to turn on what you want. Switch **Brow look** to *Smooth outline* for a curved version.
4. **Makeup map tab**: placement tips for your face shape; toggle each layer under the video.
5. **Zoom & full screen**: use the slider, the `+`/`-` buttons, the mouse wheel (zooms toward the cursor) or double-click. **Follow face** keeps the zoom centred on you; drag to pan (this switches follow off). **Full screen** (or press `F`) fills the screen; the toolbar floats at the bottom and an **Analysis** button slides the results panel in. `Esc` exits. Zoom is digital: detection still sees the whole camera frame.
6. **Save snapshot** exports exactly what you see (zoom + overlays) as a PNG.

## How it works

| Stage | What happens | Where |
|---|---|---|
| Landmarks | MediaPipe Face Landmarker returns 478 3-D points (incl. irises) per frame | `web/js/app.js` |
| Smoothing | One-Euro filter per coordinate: steady when still, low-lag when moving | `updateFilter()` |
| Pose-free frame | Origin = midpoint of eyes, unit = inter-eye distance, axes from the eye line and forehead→chin vector (Gram-Schmidt). Every landmark is expressed in this *canonical* frame, so measurements and designs don't depend on head pose | `buildFrame()` |
| Measurements | Length/width, forehead/cheek, jaw/cheek, chin & jaw angles, eye openness / tilt / spacing / lid space, mirror-pair symmetry | `computeFeatures()` |
| Face shape | Distance to six prototypes (oval, round, square, heart, oblong, diamond) → softmax probabilities, with hysteresis so the label doesn't flicker | `classifyShape()` |
| Brow template | Built once from both sides' averaged anchors, then **mirrored**, so both brows are identical and level. Start above the nostril, arch on the nostril→pupil line, end on the nostril→outer-eye-corner line with the tail level with the bottom of the brow head; arch height/sharpness/thickness depend on face shape. Emitted twice: a smooth Bézier outline and an angular "mapped" polygon, plus the numbered mapping lines | `buildTemplate()`, `emitBrowTarget()`, `emitBrowAngular()`, `emitBrowMapSide()` |
| Makeup zones | Ellipses defined in canonical space from anatomical anchors (cheek apple, ear→mouth-corner contour line, hairline, jaw, lid curve…), parameterised per face shape | `emitZones()`, `PROF[]` |
| Back to the screen | Each zone vertex gets a surface depth by inverse-distance weighting over its 4 nearest landmarks, then is rotated back into the image with the live head pose. That is what makes overlays foreshorten correctly when you turn | `toPx()`, `surfZ()` |

Performance: the engine takes **~0.7 ms per frame** (measured in Node on the WASM build); the binary is ~78 KB.

### Engine API (`engine/engine.cpp`, plain C exports)

```c
float* engine_input_ptr();             // 478*3 floats: normalised x,y,z from MediaPipe
float* engine_output_ptr();            // drawing primitives, see below
char*  engine_json_ptr();              // UTF-8 JSON report
int    engine_process(int n, double w, double h, double t_ms);   // -> floats written, or -1 (no face)
int    engine_report();                // builds the JSON, returns its length
void   engine_reset();                 // start a new scan
void   engine_set_param(int id, double v);   // 0 length / 2 forehead / 3 jaw calibration offsets, 1 scan frames
```

Output buffer = repeated `[kind, side, sub, n, x0, y0, … x(n-1), y(n-1)]` in video-pixel coordinates (`web/js/engine.js` parses it and defines the `KIND` ids).

## Project layout

```
engine/engine.cpp     C++ analysis engine (freestanding: no STL/libc/heap)
build.sh              clang -> web/wasm/engine.wasm   (prebuilt copy included)
web/index.html        UI
web/js/app.js         camera, MediaPipe, main loop, results panel
web/js/engine.js      WASM wrapper (also used by the tests)
web/js/overlay.js     canvas drawing
web/js/demo.js        procedural 478-point face for demo mode + tests
tests/engine.test.mjs 11 automated tests against the real .wasm
server.mjs            dependency-free static server
tools/vendor.mjs      optional: vendor MediaPipe for offline use
```

## Rebuilding the C++ (optional)

The engine only uses `<stdint.h>`/`<stddef.h>`, so any clang with the WebAssembly backend works:

```bash
# Ubuntu/Debian/WSL:  sudo apt install clang lld        macOS:  brew install llvm lld
npm run build:wasm          # = bash build.sh
npm test
```

On Windows use WSL, or install LLVM (`winget install LLVM.LLVM`) and run `bash build.sh` from Git Bash. If you use Emscripten, `bash build.sh --emcc` is provided (I could not test this path).

## Tests

`npm test` runs the real WebAssembly through a procedural face, including:

- smooth and angular brow templates mirror-symmetric to < 2.5 px; all 11 mapping-line steps emitted; arch sits 45-80% along the brow
- brow start point stays on the face at yaw ±30°, pitch ±15°, roll 20° and combined poses
- overlay spacing shrinks with head turn the way the face does (≈ cos 30°)
- landmark jitter is damped; blink frames don't corrupt eye measurements
- all six procedural face variants classify as intended; < 1.5 ms/frame

## Known limits (be upfront about these in interviews)

- **Face-shape thresholds are heuristic.** The prototypes are centred on MediaPipe-mesh proportions, not a labelled dataset. Check the **Details** tab; if labels look consistently off for your camera, use the calibration sliders. The natural next step is collecting labelled faces and fitting the prototypes (or a small classifier) to them.
- **Landmarks → hair.** Brow "natural" outline comes from 10 landmarks, so the red/blue areas are a guide, not a hair-level map. Trace with a pencil first.
- Eye shape / tilt / lid-space categories are simple threshold rules; makeup advice is general cosmetic guidance, not professional advice.
- Skin tone / undertone is not analysed (placement only, not colour matching).
- Developed and tested without a webcam: the engine and UI were verified with procedural faces in headless Chromium. The live MediaPipe + camera path follows the documented API but wasn't run in my environment, so expect to spend a few minutes tuning it on a real face.

## Resume talking points

- Wrote a **freestanding C++17 geometry engine** (own trig/exp, no STL/heap), compiled to a **78 KB WebAssembly** module and driven from JavaScript through a C ABI and shared linear memory.
- Built a **pose-invariant canonical coordinate frame** from facial landmarks so measurements and AR overlays stay accurate under head rotation; unit-tested at ±30° yaw.
- Implemented **One-Euro filtering**, probabilistic face-shape classification with hysteresis, and a **mirror-symmetric brow design algorithm** (Bézier spine + width profile).
- Real-time (**< 1 ms/frame**) with an automated test suite running the production `.wasm` in Node.
- Zero-dependency toolchain and dev server; privacy-first (no video leaves the browser).

## Ideas to extend it

Skin-tone and undertone detection for colour recommendations · a lip-shape module · saving looks per user · fitting the classifier to a labelled dataset · WebGL soft-blend rendering of products · AR try-on of recommended shades.

## Credits

Landmarks by [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) (Apache-2.0), loaded from jsDelivr/Google Cloud Storage at runtime.
