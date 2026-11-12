# OnFleek

A personal beauty consultation in your browser, in three connected steps. Nothing leaves your device.

1. **Face Analysis** - finds your face shape from your proportions, shows why (diagram + measurements), and recommends one eyebrow shape.
2. **Color Analysis** - live-camera color draping in the style of a 12-season session. Colors are held under your face like fabric (warm vs cool, bright vs muted, light vs deep, confirmation, neutrals). Pause, go back, skip, or vote. You get your season, best colors, neutrals and colors that may be less harmonious.
3. **Makeup** - placement for blush, contour, bronzer, highlight, eyeshadow, eyeliner and lips on your face. After Color Analysis, makeup colors update automatically for your season.

## Run it

```bash
npm start        # then open http://localhost:5173
npm test         # 22 tests (engine, color, profiles)
```

Needs Node 18+. No dependencies. The camera works on `localhost` and on HTTPS sites (such as GitHub Pages), but not from `file://`.

## Publish it (GitHub Pages)

The site is static: publish the `web/` folder. Either add a GitHub Actions workflow that uploads `web` with `actions/upload-pages-artifact` and `actions/deploy-pages`, then set **Settings > Pages > Source** to *GitHub Actions*, or copy the contents of `web/` into a `docs/` folder and choose it as the Pages source.

## How it works

```
camera -> MediaPipe Face Landmarker (478 pts) -> C++/WASM engine -> overlays + JSON report -> UI
```

- `engine/engine.cpp` - freestanding C++17 (no STL/heap) compiled to a small WebAssembly module: One-Euro smoothing, a head-pose-independent face frame, face-shape classification, eye and symmetry measures, and makeup zones that follow your head. Rebuild with `bash build.sh` (needs clang + lld).
- `web/js/color.js` - color science: Lab maths, 12-season model, reading skin/hair/eyes from fixed face regions, a transparent drape model, vote logic.
- `web/js/colorui.js` - the draping experience. The live video is never filtered; fabric is a separate layer placed from face landmarks. Camera exposure is locked where possible, and the app warns if the camera adjusts by itself.
- `web/js/profiles.js` - eyebrow advice, face-shape explanation, lip analysis, and makeup colors for each season. `store.js` shares results between sections.

## Honest limits

- Face-shape thresholds are heuristics, not fitted to a labelled dataset.
- A single camera view cannot establish a true undertone or season. The draping bars come from a model, not live skin readings, and confidence is capped.
- Built and tested with a procedural demo face in headless Chromium; the real webcam and photo-upload paths need checking on a real face.

## Credits

Landmarks by [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) (Apache-2.0).
