// Thin JS wrapper around the C++/WebAssembly analysis engine (engine/engine.cpp).
// Works in browsers and in Node (pass the wasm bytes instead of a URL).

export const KIND = {
  BROW_TARGET: 1, BROW_NATURAL: 2, BROW_MAP: 3, BROW_GUIDE: 3, BROW_POINT: 4, BROW_ANGULAR: 6,
  CONTOUR: 10, BRONZER: 11, BLUSH: 12, HIGHLIGHT: 13,
  EYE_LID: 14, EYE_OUTERV: 15, EYE_CREASE: 16, EYE_INNER: 17, EYE_WING: 18,
};

export class Engine {
  constructor(exports) {
    this.x = exports;
    this.N = exports.engine_landmark_count();
    this.inPtr = exports.engine_input_ptr();
    this.outPtr = exports.engine_output_ptr();
    this.jsonPtr = exports.engine_json_ptr();
    this._buf = null;
    this._dec = new TextDecoder();
  }

  _mem() {
    const b = this.x.memory.buffer;
    if (b !== this._buf) {
      this._buf = b;
      this._in = new Float32Array(b, this.inPtr, this.N * 3);
      this._out = new Float32Array(b, this.outPtr, 24000);
    }
  }

  /** Reset learned measurements and start a fresh scan. */
  reset() { this.x.engine_reset(); }

  /** 0 = length/width calibration offset (-0.4..0.4), 1 = frontal frames per scan */
  setParam(id, value) { this.x.engine_set_param(id, value); }

  /**
   * @param {Float32Array} landmarks  N*3 normalised (x,y,z) values from MediaPipe
   * @returns {Array<{kind:number, side:number, sub:number, pts:Float32Array}>|null}
   *   Drawing primitives in video-pixel coordinates, or null when no face.
   *   `pts` views WASM memory and is only valid until the next process() call.
   */
  process(landmarks, width, height, tMs) {
    this._mem();
    this._in.set(landmarks.length === this.N * 3 ? landmarks : landmarks.subarray(0, this.N * 3));
    const count = this.x.engine_process(this.N, width, height, tMs);
    if (count < 0) return null;
    const prims = [];
    let i = 0;
    const o = this._out;
    while (i < count) {
      const kind = o[i], side = o[i + 1], sub = o[i + 2], n = o[i + 3];
      prims.push({ kind, side, sub, pts: o.subarray(i + 4, i + 4 + n * 2) });
      i += 4 + n * 2;
    }
    return prims;
  }

  /** Raw JSON string of the analysis (cheap to compare between frames). */
  reportText() {
    const len = this.x.engine_report();
    return this._dec.decode(new Uint8Array(this.x.memory.buffer, this.jsonPtr, len));
  }

  /** Full analysis as a JS object (face shape, eyes, brows, tips ...). */
  report() { return JSON.parse(this.reportText()); }
}

export async function loadEngine(source = 'wasm/engine.wasm') {
  let bytes = source;
  if (typeof source === 'string' || source instanceof URL) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Could not load ${source} (${res.status}). Run the build or use the prebuilt web/wasm/engine.wasm.`);
    bytes = await res.arrayBuffer();
  }
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return new Engine(instance.exports);
}

/** Convert MediaPipe's [{x,y,z}, ...] landmark list into the flat buffer the engine wants. */
export function flattenLandmarks(list, out) {
  const n = Math.min(list.length, out.length / 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = list[i].x; out[i * 3 + 1] = list[i].y; out[i * 3 + 2] = list[i].z;
  }
  return n;
}
