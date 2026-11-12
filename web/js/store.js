// Shared results: Face analysis and Color analysis publish here, Makeup (and the navigation) subscribe.
// Persisted in localStorage when available, so a returning user keeps their season.
const KEY = 'onfleek.v1';
let data = { face: null, color: null };
const subs = new Set();
try { const raw = localStorage.getItem(KEY); if (raw) data = { face: null, color: null, ...JSON.parse(raw) }; } catch { /* storage unavailable */ }

const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* ignore */ } };
const emit = () => subs.forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });

export const store = {
  get: () => data,
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  /** {shape, confidence, measure} from the engine after the scan locks. */
  setFace(face) {
    if (data.face && data.face.shape === face.shape && Math.abs(data.face.confidence - face.confidence) < 0.005) return;
    data = { ...data, face }; save(); emit();
  },
  /** {seasonId, name, confidence, label, est:{T,D,C}} after the draping results are shown. */
  setColor(color) { data = { ...data, color }; save(); emit(); },
  clear() { data = { face: null, color: null }; save(); emit(); },
};
