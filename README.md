# OnFleek

A personal beauty consultation in your browser, in three connected steps:

1. **Face Analysis** - finds your face shape from your proportions, shows *why* (a diagram plus each measurement), and recommends one eyebrow shape with the reason and what to avoid.
2. **Color Analysis** (the centerpiece) - live-camera color draping in the style of a professional 12-season session. Colors are held under your face like fabric, in groups (warm vs cool, bright vs muted, light vs deep, season confirmation, neutrals). You can pause, go back, skip, click any color, and vote. The result is your season with a plain-language explanation, best colors, neutrals, and colors that may be less harmonious.
3. **Makeup** - pick blush, contour, bronzer, highlight, eyeshadow, eyeliner or lips and see the placement on your face. Once Color Analysis is done, the makeup colors (blush, eyeshadow neutrals/accents/combinations, liner, lipstick, lip liner) update automatically for your season.

The geometry and analysis run in a **C++17 engine compiled to WebAssembly**. The browser side (HTML/CSS/JavaScript) handles the camera, the MediaPipe landmark detector and drawing. Nothing leaves your device.

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

1. **Face Analysis**: start the camera (or the demo face), look straight ahead and hold still for ~2 s. Read your face shape, the proportions behind it and the eyebrow recommendation. This is advice only; nothing is drawn on your brows.
2. **Color Analysis**: allow the camera, sit back so your shoulders show, face a window. Continue, let it read your coloring, then watch the drapes. Vote in each round and see your season. No camera? Upload a photo or try the demo face.
3. **Makeup**: choose a category under the video. Placement is tuned to your face shape; colors are tuned to your season. Without a finished Color Analysis the app says so and offers to take you there.

Zoom, follow-face and full screen (`F`) work on the Face and Makeup camera. **Save snapshot** exports what you see as a PNG.

## About the live color draping

- The live video is drawn as-is. The fabric is a separate layer under your chin, positioned from live face landmarks, so it never covers your features and the video is never filtered.
- Your coloring (skin from cheeks/forehead/chin, hair, iris) is sampled in the background from the *unaltered* video, ~4 times a second, from the same landmark-defined regions every time. The median of the steady readings is the baseline.
- The camera's auto exposure and white balance are locked where the browser/camera allows it. Where they cannot be locked, the app compares the background of the live view with where it started and warns ("camera is auto-adjusting"), so camera changes are not mistaken for color harmony.
- The bars shown while draping come from a transparent model that compares each color with the measured undertone, depth, clarity and contrast. They are **not** live readings of your skin changing, and the app says so.
- A single camera view cannot reliably establish a true undertone or season. Confidence is capped and the caveat is shown with the result.

## How it works

| Stage | What happens | Where |
|---|---|---|
| Landmarks | MediaPipe Face Landmarker returns 478 3-D points (incl. irises) per frame | `web/js/app.js` |
| Smoothing | One-Euro filter per coordinate: steady when still, low-lag when moving | `updateFilter()` |
| Pose-free frame | Origin = midpoint of eyes, unit = inter-eye distance, axes from the eye line and forehead→chin vector (Gram-Schmidt). Every landmark is expressed in this *canonical* frame, so measurements and designs don't depend on head pose | `buildFrame()` |
| Measurements | Length/width, forehead/cheek, jaw/cheek, chin & jaw angles, eye openness / tilt / spacing / lid space, mirror-pair symmetry | `computeFeatures()` |
| Face shape | Distance to six prototypes (oval, round, square, heart, oblong, diamond) → softmax probabilities, with hysteresis so the label doesn't flicker | `classifyShape()` |
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
engine/engine.cpp      C++ analysis engine: face shape, eyes, symmetry, makeup zones (freestanding: no STL/libc/heap)
build.sh               clang -> web/wasm/engine.wasm   (prebuilt copy included)
web/index.html         three sections: Face Analysis, Color Analysis, Makeup
web/js/app.js          camera, MediaPipe, main loop, Face + Makeup panels, navigation
web/js/colorui.js      live color draping experience (camera/photo, rounds, votes, results)
web/js/color.js        color science: Lab maths, 12-season model, measuring the face, drape model, session logic
web/js/profiles.js     eyebrow advice per face shape, face-shape explanation, season makeup colors, lip analysis
web/js/store.js        shared results (face shape + season) so Makeup updates when the analyses finish
web/js/overlay.js      canvas drawing of makeup zones, lips and liner
web/js/engine.js       WASM wrapper (also used by the tests)
web/js/demo.js         procedural 478-point face for demo mode + tests
tests/                 engine, color and profile tests (22)
server.mjs             dependency-free static server
tools/vendor.mjs       optional: vendor MediaPipe for offline use
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

`npm test` runs the real WebAssembly through a procedural face, plus the color and profile logic, including:

- every one of the 12 seasons classifies as itself; warm/cool/bright/muted personas land in the right family; drape-model directions; vote handling
- every season has a full, valid, *different* makeup set; warm seasons lean warm, cool seasons lean cool
- each face shape has its own eyebrow recommendation and a proportion explanation
- overlay spacing shrinks with head turn the way the face does (≈ cos 30°)
- landmark jitter is damped; blink frames don't corrupt eye measurements
- all six procedural face variants classify as intended; < 1.5 ms/frame

## Known limits (be upfront about these in interviews)

- **Face-shape thresholds are heuristic.** The prototypes are centred on MediaPipe-mesh proportions, not a labelled dataset. Check the **Details** tab; if labels look consistently off for your camera, use the calibration sliders. The natural next step is collecting labelled faces and fitting the prototypes (or a small classifier) to them.
- Eye shape / tilt / lid-space categories are simple threshold rules; makeup advice is general cosmetic guidance, not professional advice.
- **Color analysis is a guided estimate**, not a lab measurement: webcams differ, rooms are tinted, and one view cannot establish a true undertone. Season palettes and makeup shades are curated starting points.
- Developed and tested without a webcam: the engine and UI were verified with procedural faces in headless Chromium (`?fakecam` feeds the demo face through the live path). The real MediaPipe + camera path and photo upload follow the documented API but were not run in my environment, so expect to spend a few minutes tuning on a real face.

## Resume talking points

- Wrote a **freestanding C++17 geometry engine** (own trig/exp, no STL/heap), compiled to a **78 KB WebAssembly** module and driven from JavaScript through a C ABI and shared linear memory.
- Built a **pose-invariant canonical coordinate frame** from facial landmarks so measurements and AR overlays stay accurate under head rotation; unit-tested at ±30° yaw.
- Implemented **One-Euro filtering**, probabilistic face-shape classification with hysteresis, and a **12-season color analysis** (Lab color science, a transparent drape model and an interactive draping session).
- Real-time (**< 1 ms/frame**) with an automated test suite running the production `.wasm` in Node.
- Zero-dependency toolchain and dev server; privacy-first (no video leaves the browser).

## Ideas to extend it

Saving profiles per user · comparing against real fabric swatches · fitting the season model to labelled data · fitting the classifier to a labelled dataset · WebGL soft-blend rendering of products · AR try-on of recommended shades.

## Credits

Landmarks by [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) (Apache-2.0), loaded from jsDelivr/Google Cloud Storage at runtime.
