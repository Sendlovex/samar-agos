// Weather outlook for Catbalogan City from Open-Meteo (free, no API key).
// Weather is real FORECAST data; its effect on water supply is a simple ESTIMATED model.
import { setWeatherModel, commit } from './store.js';

const LAT = 11.7753;
const LNG = 124.8861;
const TZ = 'Asia/Manila';
const URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LNG}&timezone=${encodeURIComponent(TZ)}&forecast_days=3` +
  '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation' +
  '&hourly=temperature_2m,precipitation,precipitation_probability' +
  '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max';
const REFRESH_MS = 30 * 60 * 1000;
const CACHE_KEY = 'samaragos.weather.v1';

// Model assumptions (shown on screen as ESTIMATED)
export const WEATHER_BASE = { tmax: 31, hotPctPerDeg: 2.5, heavyRainMm: 25, moderateRainMm: 10, dryTotalMm: 3, gustRiskKmh: 60 };

let data = null;
let status = 'loading'; // loading | ok | error

export const weatherState = () => ({ data, status });

const localDate = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: TZ });

// Per-day effect of weather on the water system
export function dayImpacts() {
  if (!data) return [];
  const d = data.daily;
  const total3 = d.precipitation_sum.reduce((a, b) => a + (b || 0), 0);
  return d.time.map((date, i) => {
    const tmax = d.temperature_2m_max[i];
    const rain = d.precipitation_sum[i] || 0;
    const demandPct = Math.max(-5, Math.min(12, (tmax - WEATHER_BASE.tmax) * WEATHER_BASE.hotPctPerDeg));
    let supplyPct = 0;
    let rainNote = null;
    if (rain >= WEATHER_BASE.heavyRainMm) (supplyPct = -15), (rainNote = 'heavy');
    else if (rain >= WEATHER_BASE.moderateRainMm) (supplyPct = -5), (rainNote = 'moderate');
    else if (total3 < WEATHER_BASE.dryTotalMm) (supplyPct = -6), (rainNote = 'dry');
    return { date, tmax, rain, demandPct, supplyPct, rainNote, gust: d.wind_gusts_10m_max[i] };
  });
}

function install() {
  const impacts = dayImpacts();
  if (!impacts.length) return setWeatherModel(null);
  const byDate = Object.fromEntries(impacts.map((x) => [x.date, x]));
  // hoursAhead → { demandPct, inflowPct } for the forecast engine
  setWeatherModel((hoursAhead) => {
    const x = byDate[localDate(Date.now() + hoursAhead * 3600000)];
    return x ? { demandPct: x.demandPct, inflowPct: x.supplyPct } : null;
  });
}

async function load() {
  try {
    const r = await fetch(URL);
    if (!r.ok) throw new Error(r.status);
    data = await r.json();
    data.fetchedAt = Date.now();
    status = 'ok';
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch (e) {
      /* ignore */
    }
  } catch (e) {
    // fall back to a recent cached copy (< 6 h) so a brief outage doesn't blank the panel
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (c && Date.now() - c.fetchedAt < 6 * 3600000) (data = c), (status = 'ok');
      else status = 'error';
    } catch (err) {
      status = 'error';
    }
  }
  install();
  commit();
}

load();
setInterval(load, REFRESH_MS);

// ---------------------------------------------------------------- presentation helpers
const WMO = [
  [[0], 'Clear', 'sun'],
  [[1, 2], 'Partly cloudy', 'partly'],
  [[3], 'Overcast', 'cloud'],
  [[45, 48], 'Fog', 'fog'],
  [[51, 53, 55, 56, 57], 'Drizzle', 'drizzle'],
  [[61, 63, 65, 66, 67, 80, 81, 82], 'Rain', 'rain'],
  [[95, 96, 99], 'Thunderstorm', 'storm'],
];
export function describe(code) {
  const m = WMO.find(([codes]) => codes.includes(code));
  return m ? { text: m[1], icon: m[2] } : { text: 'Unknown', icon: 'cloud' };
}

const P = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  partly: '<path d="M12 2v2M4.9 4.9l1.4 1.4M20 12h2M19.1 4.9l-1.4 1.4"/><path d="M15.9 13.1A4 4 0 1 0 8.6 9.2"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9Z"/>',
  fog: '<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M16 17H7M17 21H9"/>',
  drizzle: '<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M8 19v1M8 14v1M16 19v1M16 14v1M12 21v1M12 16v1"/>',
  rain: '<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M16 14v6M8 14v6M12 16v6"/>',
  storm: '<path d="M6 16.3A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 1.5 8.8"/><path d="m13 12-3 5h4l-3 5"/>',
};
export const wIcon = (name, size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.cloud}</svg>`;
