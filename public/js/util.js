// Shared helpers: escaping, formatting, time, geometry.

// Open the app with ?local to run a local copy: no Firebase, nothing written to the shared database.
export const LOCAL_MODE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('local');

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const fmt = (n, d = 0) =>
  Number(n).toLocaleString('en-PH', { minimumFractionDigits: d, maximumFractionDigits: d });

export const fmtL = (liters) => `${fmt(Math.round(liters))} L`;
export const fmtML = (ml, d = 2) => `${fmt(ml, d)} ML`;

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
export function fmtTime24(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
export function fmtDateShort(ts) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
export function fmtDateTime(ts) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? `Today, ${fmtTime(ts)}` : `${fmtDateShort(ts)}, ${fmtTime(ts)}`;
}

export function relTime(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s} second${s === 1 ? '' : 's'} ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export function hoursLabel(h) {
  if (h == null || !isFinite(h)) return '—';
  if (h >= 72) return '> 72 hours';
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${Math.round(h)} hours`;
}

// datetime-local helpers
export function toLocalInput(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const fromLocalInput = (v) => (v ? new Date(v).getTime() : null);

// Deterministic RNG for seed data
export function rng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function pointInPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const parsePoly = (str) => str.split(' ').map((p) => p.split(',').map(Number));

// Local planar grid over Catbalogan City used by all operational data.
// x grows east, y grows south; 1 unit ≈ 11.9 m in both directions.
const LAT_MAX = 11.816;
const LNG_MIN = 124.85;
const DLAT = 0.000107;
const DLNG = DLAT / Math.cos((11.78 * Math.PI) / 180);
export const toLL = (x, y) => [LAT_MAX - y * DLAT, LNG_MIN + x * DLNG];
export const toXY = (lat, lng) => ({ x: Math.round((lng - LNG_MIN) / DLNG), y: Math.round((LAT_MAX - lat) / DLAT) });
export const xy = (lat, lng) => {
  const p = toXY(lat, lng);
  return [p.x, p.y];
};
export const llPoly = (pts) => pts.map(([lat, lng]) => xy(lat, lng).join(',')).join(' ');
export function centroid(polyStr) {
  const p = parsePoly(polyStr);
  return [Math.round(p.reduce((a, q) => a + q[0], 0) / p.length), Math.round(p.reduce((a, q) => a + q[1], 0) / p.length)];
}

// Downscale an uploaded image (small for the offline demo's localStorage, larger for Firebase Storage).
export function readImage(file, max = 640, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
