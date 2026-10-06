// Asset lifecycle and usage: install date, service life, operating hours and a daily run log.
// Install years come only from the asset record (documented in the CWD Water Safety Plan 2022); when a
// year isn't published the age is "Not recorded". Run hours/logs are SIMULATED from typical duty cycles.
import { rng } from './util.js';

const DAY = 864e5;
const YEAR = 365.25 * DAY;


// Typical design life (years) and average daily run hours by asset type.
const LIFE = { Pump: 15, Well: 20, 'Water Source': 50, 'Treatment Equipment': 25, Reservoir: 50, Tank: 40, Valve: 25, Pipeline: 50, Sensor: 8 };
const DUTY = { Pump: 20, Well: 16, 'Treatment Equipment': 22, 'Water Source': 23, Sensor: 24, Reservoir: 24, Tank: 24, Valve: 24, Pipeline: 24 };
// Assets that start and stop (run hours and starts are meaningful); the rest are "in service" hours.
const CYCLED = new Set(['Pump', 'Well', 'Treatment Equipment', 'Water Source']);

// Categories shown on the Assets page (in display order).
export const ASSET_CATEGORIES = [
  { id: 'source', label: 'Sources & wells', types: ['Water Source', 'Well'], art: 'source', blurb: 'Springs and deep wells' },
  { id: 'treatment', label: 'Treatment', types: ['Treatment Equipment'], art: 'treatment', blurb: 'Kulador plant (Antiao River)' },
  { id: 'pumping', label: 'Pumping', types: ['Pump'], art: 'pump', blurb: 'Caramayon pumping stations and boosters' },
  { id: 'storage', label: 'Storage', types: ['Reservoir', 'Tank'], art: 'storage', blurb: 'Poblacion 13 ground reservoir' },
  { id: 'network', label: 'Distribution network', types: ['Pipeline', 'Valve'], art: 'network', blurb: '45.6 km of mains and distribution lines' },
  { id: 'sensors', label: 'Monitoring sensors', types: ['Sensor'], art: 'sensor', blurb: 'None registered yet' },
];
export const categoryOf = (a) => ASSET_CATEGORIES.find((c) => c.types.includes(a.type)) || ASSET_CATEGORIES[ASSET_CATEGORIES.length - 1];

const seedOf = (id) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const kwOf = (a) => {
  const m = /(\d+)\s*×\s*(\d+)\s*kW/.exec(a.spec || '') || /(\d+)\s*kW/.exec(a.spec || '');
  if (!m) return a.type === 'Well' ? 11 : null;
  return m[2] ? (a.spec.includes('standby') ? +m[2] : +m[1] * +m[2]) : +m[1];
};

// Daily log for the last `days` days (oldest first). Failures inside the window cause downtime.
export function assetLog(a, { days = 14, now = Date.now(), offlineHours = 0, down = false } = {}) {
  const r = rng(seedOf(a.id));
  const duty = DUTY[a.type] ?? 24;
  const cycled = CYCLED.has(a.type);
  const kw = kwOf(a);
  const today0 = new Date(now).setHours(0, 0, 0, 0);
  const out = [];
  for (let k = days - 1; k >= 0; k--) {
    const start = today0 - k * DAY;
    const isToday = k === 0;
    const span = isToday ? (now - start) / 3600e3 : 24; // hours elapsed in the day
    let hours = cycled ? Math.min(span, duty * (span / 24) * (0.9 + r() * 0.2)) : span;
    let note = 'Normal operation';
    const fail = (a.failures || []).find((f) => f.at >= start && f.at < start + DAY);
    if (fail) {
      hours = Math.max(0, hours - (4 + r() * 6));
      note = fail.text;
    }
    if (isToday && offlineHours) {
      hours = Math.max(0, span - offlineHours);
      note = 'Not reporting since ' + new Date(now - offlineHours * 3600e3).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    if (isToday && down) {
      hours = Math.min(hours, span * 0.3);
      note = 'Tripped offline today';
    }
    out.push({
      date: start,
      hours: Math.round(hours * 10) / 10,
      starts: cycled ? Math.max(1, Math.round(hours / 4 + r() * 3)) : null,
      kwh: kw ? Math.round(hours * kw * 0.85) : null,
      note,
    });
  }
  return out;
}

// Lifecycle summary used on the list and the detail page.
export function assetLifecycle(a, opts = {}) {
  const now = opts.now ?? Date.now();
  const life = LIFE[a.type] ?? 25;
  const duty = DUTY[a.type] ?? 24;
  const log = assetLog(a, { ...opts, now });
  const last7 = log.slice(-7).reduce((s, d) => s + d.hours, 0);
  const today = log[log.length - 1]?.hours ?? 0;
  const base = { life, last7, today, log, cycled: CYCLED.has(a.type), duty, known: false, installed: null, ageYears: null, lifeUsed: null, remainingYears: null, totalHours: null };
  if (!a.installed) return base; // install year not published
  const installed = new Date(a.installed, 0, 1).getTime();
  const ageYears = (now - installed) / YEAR;
  // Lifetime hours: average duty with ~94% availability (maintenance and outages). SIMULATED estimate.
  const totalHours = Math.round(((now - installed) / 3600e3) * (duty / 24) * 0.94);
  return { ...base, known: true, installed, ageYears, lifeUsed: ageYears / life, remainingYears: life - ageYears, totalHours };
}

// ---------------------------------------------------------------- category illustrations (line art)
const STROKE = '#1E3A5F';
const WATER = '#CFE1F3';
const ART = {
  source: `<path d="M4 40c8-14 18-14 26-2 6-9 16-9 24 2" fill="#EEF3EA" stroke="#B9C9B2" stroke-width="1.5"/>
    <path d="M2 46c8-4 14 4 22 0s14-4 22 0 14 4 22 0" fill="none" stroke="#8FB8E0" stroke-width="2" stroke-linecap="round"/>
    <path d="M2 53c8-4 14 4 22 0s14-4 22 0 14 4 22 0" fill="none" stroke="#B9D3EE" stroke-width="2" stroke-linecap="round"/>
    <rect x="66" y="26" width="18" height="22" rx="2" fill="#fff" stroke="${STROKE}" stroke-width="1.8"/><path d="M63 28l12-8 12 8" fill="none" stroke="${STROKE}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M75 48v8M70 56h10" stroke="${STROKE}" stroke-width="1.8" stroke-linecap="round"/>`,
  treatment: `<rect x="10" y="24" width="56" height="30" rx="2" fill="#fff" stroke="${STROKE}" stroke-width="1.8"/><path d="M6 26l32-14 32 14" fill="none" stroke="${STROKE}" stroke-width="1.8" stroke-linejoin="round"/>
    <rect x="16" y="34" width="18" height="14" rx="2" fill="${WATER}" stroke="${STROKE}" stroke-width="1.4"/><rect x="42" y="34" width="18" height="14" rx="2" fill="${WATER}" stroke="${STROKE}" stroke-width="1.4"/>
    <path d="M18 40c3-2 5 2 8 0s5-2 6 0M44 40c3-2 5 2 8 0s5-2 6 0" fill="none" stroke="#6FA6DB" stroke-width="1.3"/>
    <path d="M66 46h16v-8" fill="none" stroke="${STROKE}" stroke-width="2.4" stroke-linecap="round"/><circle cx="82" cy="34" r="4" fill="#fff" stroke="${STROKE}" stroke-width="1.6"/>`,
  pump: `<path d="M4 44h18M58 30h30" stroke="#9FB2CA" stroke-width="6" stroke-linecap="round"/>
    <circle cx="36" cy="40" r="15" fill="#fff" stroke="${STROKE}" stroke-width="1.8"/><circle cx="36" cy="40" r="5" fill="${WATER}" stroke="${STROKE}" stroke-width="1.5"/>
    <path d="M36 25h16v10" fill="none" stroke="${STROKE}" stroke-width="1.8"/><rect x="44" y="12" width="22" height="13" rx="2" fill="#F4F7FB" stroke="${STROKE}" stroke-width="1.8"/>
    <path d="M49 16v5M54 16v5M59 16v5" stroke="#7690B0" stroke-width="1.4" stroke-linecap="round"/><path d="M24 55h24" stroke="${STROKE}" stroke-width="1.8" stroke-linecap="round"/>`,
  storage: `<path d="M8 22v26a14 4 0 0 0 28 0V22" fill="#fff" stroke="${STROKE}" stroke-width="1.8"/><path d="M8 34a14 4 0 0 0 28 0v14a14 4 0 0 1-28 0z" fill="${WATER}"/><ellipse cx="22" cy="22" rx="14" ry="4" fill="#F4F7FB" stroke="${STROKE}" stroke-width="1.8"/>
    <rect x="52" y="8" width="30" height="18" rx="4" fill="#fff" stroke="${STROKE}" stroke-width="1.8"/><path d="M52 18h30v4a4 4 0 0 1-4 4H56a4 4 0 0 1-4-4z" fill="${WATER}"/>
    <path d="M56 26l-4 30M78 26l4 30M54 40h26M67 26v30" stroke="${STROKE}" stroke-width="1.6" stroke-linecap="round"/>`,
  network: `<path d="M4 36h88" stroke="#9FB2CA" stroke-width="7" stroke-linecap="round"/><path d="M30 36v20M70 36V14" stroke="#9FB2CA" stroke-width="5" stroke-linecap="round"/>
    <path d="M4 36h88" stroke="#5B9BD5" stroke-width="2" stroke-dasharray="5 6" stroke-linecap="round"/>
    <rect x="44" y="28" width="12" height="16" rx="2" fill="#fff" stroke="${STROKE}" stroke-width="1.8"/><path d="M50 28v-8" stroke="${STROKE}" stroke-width="1.8"/>
    <circle cx="50" cy="16" r="5" fill="#fff" stroke="${STROKE}" stroke-width="1.8"/><path d="M45 16h10M50 11v10" stroke="${STROKE}" stroke-width="1.3"/>`,
  sensor: `<path d="M8 50h80" stroke="#9FB2CA" stroke-width="6" stroke-linecap="round"/>
    <path d="M48 50V40" stroke="${STROKE}" stroke-width="2"/><rect x="36" y="20" width="24" height="20" rx="4" fill="#fff" stroke="${STROKE}" stroke-width="1.8"/>
    <rect x="41" y="25" width="14" height="6" rx="1.5" fill="#EEF2F7"/><circle cx="48" cy="35" r="2" fill="${STROKE}"/>
    <path d="M48 20v-6M41 10a10 10 0 0 1 14 0M36 5a17 17 0 0 1 24 0" fill="none" stroke="#7690B0" stroke-width="1.6" stroke-linecap="round"/>`,
};
export const assetArt = (key, w = 96, h = 64) => `<svg class="as-art" width="${w}" height="${h}" viewBox="0 0 96 64" aria-hidden="true">${ART[key] || ART.network}</svg>`;
