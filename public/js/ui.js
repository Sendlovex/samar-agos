// Reusable UI components for SAMAR-AGOS. Components return HTML strings;
// interactivity uses delegated data-action handlers (see `actions`).
import { esc, relTime, fmtDateTime } from './util.js';

// ---------------------------------------------------------------- icons (Lucide-style, stroke)
const P = {
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  droplet: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  'droplet-off': '<path d="M18.7 13.3a7 7 0 0 0-1.7-3.8L12 2 9.7 5.4"/><path d="M6.6 8.6A7 7 0 0 0 12 22a7 7 0 0 0 5.4-2.5"/><path d="m2 2 20 20"/>',
  droplets: '<path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  octagon: '<polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  'check-circle': '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/>',
  'x-circle': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
  clipboard: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4M12 16h4M8 11h.01M8 16h.01"/>',
  bars: '<path d="M3 3v18h18"/><path d="M8 17V9M13 17V5M18 17v-4"/>',
  trend: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  grid: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/>',
  forecast: '<path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/><path d="M15 7h4v4"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  'chev-r': '<path d="m9 18 6-6-6-6"/>',
  'chev-l': '<path d="m15 18-6-6 6-6"/>',
  'chev-d': '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7l10-5z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  truck: '<path d="M10 17h4V5H2v12h3"/><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h1"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/>',
  flask: '<path d="M9 3h6M10 3v6L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9V3"/><path d="M7 15h10"/>',
  wind: '<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>',
  meter: '<circle cx="12" cy="12" r="9"/><path d="M12 12l4-3"/><path d="M8 16h8"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  'arrow-up': '<path d="m18 15-6-6-6 6"/>',
  'arrow-down': '<path d="m6 9 6 6 6-6"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  tank: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 13h14"/><path d="M9 17h6"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  hospital: '<path d="M12 6v4M14 14h-4M14 18h-4M14 8h-4"/><path d="M18 12h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h2"/><path d="M18 22V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v18"/>',
};
export const icon = (name, size = 18, cls = '') =>
  `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.info}</svg>`;

// ---------------------------------------------------------------- brand
// "A" mark with water rising inside it. Ids are unique per instance: a gradient defined
// inside a display:none copy (e.g. the hidden mobile header) would not render elsewhere.
let logoSeq = 0;
export function logoMark(size = 36) {
  const id = `lm${++logoSeq}`;
  return `<svg class="logo-mark" width="${size}" height="${size}" viewBox="150 140 420 420" aria-hidden="true">
    <defs>
      <linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6aaeea"/><stop offset="1" stop-color="#1f62c9"/></linearGradient>
      <clipPath id="${id}c"><path d="M240 556 360 312 480 556z"/></clipPath>
    </defs>
    <g clip-path="url(#${id}c)">
      <path d="M240 446C292 426 338 404 398 410L480 410V570H240z" fill="#c4e2f8"/>
      <path d="M240 432C296 430 334 468 412 455L480 446V570H240z" fill="url(#${id}g)"/>
    </g>
    <path d="M360 152 170 549H252L360 334 466 549H549z" fill="#130a7c" stroke="#130a7c" stroke-width="14" stroke-linejoin="round"/>
  </svg>`;
}
export function logo({ size = 34, tagline = true, light = false } = {}) {
  return `<span class="logo ${light ? 'logo--light' : ''}">${logoMark(size)}<span class="logo-text"><span class="logo-name">SAMAR-AGOS</span>${tagline ? '<span class="logo-tag">Smart Water Monitoring and Response</span>' : ''}</span></span>`;
}

// Decorative city-by-the-bay scene for the provider sidebar (cathedral, government hall,
// obelisk, monument, bunting, boat).
// Sidebar city scene. It follows the current weather: sun or moon, drifting clouds, rain or a storm,
// waves and the rowing boat moving faster as the wind picks up, and the bunting fluttering.
// wx: { sky: 'clear' | 'partly' | 'cloudy' | 'rain' | 'storm', wind: km/h, night: boolean }
export function cityScene(wx = {}) {
  const sky = wx.sky || 'clear';
  const wind = wx.wind || 0;
  const night = !!wx.night;
  const wet = sky === 'rain' || sky === 'storm';
  const gust = sky === 'storm' ? 3 : wind >= 25 ? 2 : wind >= 10 ? 1 : 0; // calm, breezy, windy, stormy
  const vars = [
    `--cs-wave:${[5, 3.6, 2.4, 1.6][gust]}s`,
    `--cs-bob:${[1.2, 1.8, 2.6, 3.4][gust]}px`,
    `--cs-tilt:${[1.5, 2.5, 4, 6][gust]}deg`,
    `--cs-row:${[2.4, 2, 1.7, 1.4][gust]}s`,
    `--cs-flag:${[2.6, 1.6, 0.9, 0.55][gust]}s`,
    `--cs-cloud:${[60, 42, 28, 18][gust]}s`,
    `--cs-rain:${sky === 'storm' ? 0.45 : 0.7}s`,
  ].join(';');
  const ink = '#1F2A3A';
  const s = `stroke="${ink}" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"`;
  const flags = [[52, 40], [62, 43], [72, 45], [82, 46], [92, 46], [102, 44], [112, 41], [122, 37], [132, 33]];
  const fc = ['#F97316', '#1F2A3A', '#FDBA74', '#3B82F6'];
  const ticks = Array.from({ length: 37 }, (_, i) => `<path d="M${4 + i * 8} 93v3" stroke="#B9A79B" stroke-width="1"/>`).join('');
  // Two copies of the wave row, 150 px apart, so the drift loops seamlessly.
  const waveRow = [[14, 106], [62, 116], [106, 110], [176, 108], [226, 117], [270, 105]];
  const waves = [0, 150, 300]
    .map((dx) => waveRow.map(([x, y]) => `<path d="M${x + dx} ${y}q5-3 10 0t10 0" fill="none" stroke="${wet ? '#88A9CC' : '#9DBCE0'}" stroke-width="1.2" stroke-linecap="round"/>`).join(''))
    .join('');
  const cloud = (x, y, k, cls) => `<path class="${cls}" d="M${x} ${y}h${22 * k}a${6 * k} ${6 * k} 0 0 0 0-${12 * k} ${8 * k} ${8 * k} 0 0 0-${15 * k}-${3 * k} ${6 * k} ${6 * k} 0 0 0-${9 * k} ${5 * k} ${4 * k} ${4 * k} 0 0 0 ${2 * k} ${10 * k}z" fill="${sky === 'storm' ? '#C9D1DB' : wet ? '#DCE2EA' : '#F4F6F9'}" stroke="${sky === 'storm' ? '#8E9AAA' : '#B8C2CE'}" stroke-width="1"/>`;
  const clouds =
    sky === 'clear'
      ? ''
      : sky === 'partly'
        ? cloud(212, 50, 0.9, 'cs-cloud')
        : `${cloud(152, 48, 0.85, 'cs-cloud')}${cloud(204, 52, 0.85, 'cs-cloud cs-cloud--b')}${wet ? cloud(270, 40, 0.8, 'cs-cloud cs-cloud--c') : ''}`;
  const sunMoon =
    sky === 'clear' || sky === 'partly'
      ? night
        ? `<g class="cs-moon"><circle cx="276" cy="38" r="6" fill="#F4F6F9" stroke="#B8C2CE" stroke-width="1"/><circle cx="279" cy="36" r="5" fill="#fff"/></g>`
        : `<g class="cs-sun"><circle cx="276" cy="38" r="5.5" fill="#FDBA74"/>${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<path d="M276 30v-3" stroke="#FDBA74" stroke-width="1.4" stroke-linecap="round" transform="rotate(${a} 276 38)"/>`).join('')}</g>`
      : '';
  const drops = (n, seed) =>
    Array.from({ length: n }, (_, k) => {
      const x = (k * 37 + seed * 13) % 300;
      const y = 24 + ((k * 53 + seed * 29) % 70);
      return `<path d="M${x} ${y}l-2 6" stroke="#8FA6BF" stroke-width="1" stroke-linecap="round"/>`;
    }).join('');
  const rain = wet ? `<g class="cs-rain">${drops(sky === 'storm' ? 34 : 22, 1)}</g><g class="cs-rain cs-rain--b">${drops(sky === 'storm' ? 34 : 22, 2)}</g>` : '';
  const bolt = sky === 'storm' ? `<path class="cs-bolt" d="M178 40l-6 12h5l-4 10 10-14h-5l4-8z" fill="#FDE68A" stroke="#E5B93B" stroke-width=".8"/>` : '';
  const water = night ? '#CFDDEC' : wet ? '#D3E1EF' : '#DCEAF7';
  return `<svg class="city-scene cs--${sky}${night ? ' cs--night' : ''}" style="${vars}" viewBox="0 24 300 100" aria-hidden="true" focusable="false">
    <defs>
      <clipPath id="cs-clip"><rect width="300" height="124" rx="12"/></clipPath>
    </defs>
    <g clip-path="url(#cs-clip)">
      ${night || wet ? `<rect y="24" width="300" height="70" fill="${night ? '#EEF2F8' : sky === 'storm' ? '#EDF0F4' : '#F3F5F8'}"/>` : ''}
      ${sunMoon}${clouds}${bolt}
      <rect y="96" width="300" height="28" fill="${water}"/>
      <g class="cs-waves">${waves}</g>
      <rect y="92" width="300" height="2" fill="#C9B6A9"/>${ticks}
      <!-- cathedral -->
      <path d="M40 27v13M35 32h10" ${s} fill="none"/>
      <path d="M12 57 40 40l28 17Z" fill="#fff" ${s}/>
      <rect x="16" y="57" width="48" height="36" fill="#fff" ${s}/>
      <circle cx="40" cy="50" r="3.4" fill="#fff" ${s}/>
      ${[20, 26, 51, 57].map((x) => `<rect x="${x}" y="62" width="3" height="27" rx="1" fill="${night ? '#FCD9A8' : '#FDE6D8'}" ${s}/>`).join('')}
      <path d="M34 93V78a6 6 0 0 1 12 0v15Z" fill="#374151"/>
      <!-- bunting -->
      <path d="M44 37Q92 52 140 31" fill="none" stroke="${ink}" stroke-width="1"/>
      ${flags.map(([x, y], i) => `<path class="cs-flag" style="animation-delay:-${(i * 0.17).toFixed(2)}s" d="M${x - 3.2} ${y}h6.4L${x} ${y + 7}Z" fill="${fc[i % 4]}"/>`).join('')}
      <!-- government hall -->
      <path d="M125 52V36" ${s}/><path class="cs-pennant" d="M125 36h12l-3 4 3 4h-12Z" fill="#F97316"/>
      <path d="M98 66 125 52l27 14Z" fill="#fff" ${s}/>
      <rect x="84" y="66" width="82" height="27" fill="#fff" ${s}/>
      ${[103, 112, 121, 130, 139].map((x) => `<rect x="${x}" y="69" width="4.5" height="24" fill="${night ? '#FCD9A8' : '#FDE6D8'}" ${s}/>`).join('')}
      ${[[88, 71], [88, 81], [154, 71], [154, 81]].map(([x, y]) => `<rect x="${x}" y="${y}" width="7" height="6" fill="${night ? '#FCD9A8' : '#fff'}" ${s}/>`).join('')}
      <!-- obelisk -->
      <path d="M192.5 89 194.5 45 196.5 40.5 198.5 45 200.5 89Z" fill="#fff" ${s}/>
      <rect x="188" y="89" width="17" height="4" fill="#fff" ${s}/>
      <!-- monument -->
      <circle cx="241" cy="58.5" r="3.6" fill="#fff" ${s}/>
      <rect x="236.5" y="62.5" width="9" height="6" rx="2" fill="#fff" ${s}/>
      <rect x="229" y="68.5" width="24" height="3.5" fill="#F97316" ${s}/>
      <rect x="230.5" y="72" width="21" height="9" fill="#FDBA74" ${s}/>
      ${[234, 239.5, 245].map((x) => `<path d="M${x} 73v7" stroke="${ink}" stroke-width="1"/>`).join('')}
      <rect x="226" y="81" width="30" height="12" fill="#fff" ${s}/>
      <!-- boat: drifts across the water, bobs on the waves, oars row -->
      <g class="cs-boat"><g class="cs-bob">
        <path d="M130 88v15" ${s}/><path class="cs-sail" d="M130 89.5v13h-10Z" fill="#fff" ${s}/>
        <path d="M110 103h40l-6 7.5h-28Z" fill="#F97316" ${s}/>
        <path class="cs-oar cs-oar--l" d="M106 108l8-3" ${s}/>
        <path class="cs-oar cs-oar--r" d="M154 108l-8-3" ${s}/>
      </g></g>
      ${rain}
    </g>
  </svg>`;
}

// ---------------------------------------------------------------- status + source badges
export const SEV = {
  normal: { label: 'Normal', icon: 'check-circle', cls: 'ok' },
  warning: { label: 'Warning', icon: 'alert', cls: 'warn' },
  critical: { label: 'Critical', icon: 'octagon', cls: 'crit' },
  info: { label: 'Information', icon: 'info', cls: 'info' },
  offline: { label: 'Offline', icon: 'x-circle', cls: 'off' },
};
export function status(sev, label, opts = {}) {
  const s = SEV[sev] || SEV.offline;
  return `<span class="status status--${s.cls} ${opts.lg ? 'status--lg' : ''}">${icon(s.icon, opts.lg ? 16 : 13)}<span>${esc(label ?? s.label)}</span></span>`;
}
export const sevFromLevel = (lv) => (lv < 0.3 ? 'critical' : lv < 0.42 ? 'warning' : 'normal');

const SOURCE = {
  LIVE: 'live',
  MANUAL: 'manual',
  ESTIMATED: 'est',
  FORECAST: 'fc',
  SIMULATED: 'sim',
  'SIMULATED IoT': 'sim',
  'RESIDENT REPORTED': 'res',
  MEASURED: 'live',
  'CLIMATE RECORD': 'live',
  INCIDENTS: 'tag',
  FIELD: 'tag',
  'FIELD MEASUREMENT': 'tag',
  'SIMULATED TELEMETRY': 'sim',
};
const SOURCE_TIP = {
  LIVE: 'Live telemetry from a connected sensor',
  MANUAL: 'Entered manually by provider staff',
  ESTIMATED: 'Calculated estimate — not a direct measurement',
  FORECAST: 'Projection based on current conditions — not guaranteed',
  SIMULATED: 'Simulated telemetry for this prototype — not real sensor data',
  'SIMULATED IoT': 'Simulated IoT device for this prototype — not real sensor data',
  'RESIDENT REPORTED': 'Information submitted by residents',
  MEASURED: 'Actual meter reading',
  'CLIMATE RECORD': 'Real historical weather record (ERA5 reanalysis via Open-Meteo)',
  'FIELD MEASUREMENT': 'Measured on site by the field responder — not live sensor data',
  'SIMULATED TELEMETRY': 'Simulated telemetry for this prototype — not real sensor data',
};
export const src = (kind) => `<span class="src src--${SOURCE[kind] || 'est'}" title="${SOURCE_TIP[kind] || ''}">${esc(kind)}</span>`;

export const priorityBadge = (p) => `<span class="pri pri--${(p || '').toLowerCase()}">${icon(p === 'Critical' || p === 'High' ? 'arrow-up' : p === 'Low' ? 'arrow-down' : 'more', 12)}${esc(p)}</span>`;
export const sevBadge = (s) => status({ Critical: 'critical', High: 'critical', Medium: 'warning', Low: 'info' }[s] || 'info', `${s} severity`);

export function pill(text, cls = '') {
  return `<span class="pill ${cls}">${esc(text)}</span>`;
}

// ---------------------------------------------------------------- cards
export function kpi({ label, value, unit = '', sub = '', source, spark = '', sev, updated, link }) {
  return `<div class="kpi ${sev ? `kpi--${SEV[sev]?.cls}` : ''}">
    <div class="kpi-top"><span class="kpi-label">${esc(label)}</span>${source ? src(source) : ''}</div>
    <div class="kpi-value">${value}<span class="kpi-unit">${esc(unit)}</span></div>
    <div class="kpi-foot"><span class="kpi-sub">${sub}</span>${spark}</div>
    ${updated ? `<div class="kpi-upd">${esc(updated)}</div>` : ''}
    ${link ? `<a class="kpi-link" href="${link}" aria-label="Open ${esc(label)}"></a>` : ''}
  </div>`;
}

export function metric(label, value, source, note = '') {
  return `<div class="metric"><div class="metric-label">${esc(label)} ${source ? src(source) : ''}</div><div class="metric-value">${value}</div>${note ? `<div class="metric-note">${note}</div>` : ''}</div>`;
}

export function card(title, body, { actions = '', sub = '', cls = '', id = '' } = {}) {
  return `<section class="card ${cls}" ${id ? `id="${id}"` : ''}>
    ${title ? `<header class="card-h"><div><h2 class="card-t">${title}</h2>${sub ? `<p class="card-sub">${sub}</p>` : ''}</div>${actions ? `<div class="card-actions">${actions}</div>` : ''}</header>` : ''}
    <div class="card-b">${body}</div></section>`;
}

export function alertBanner(sev, title, body = '', actionsHtml = '') {
  const s = SEV[sev] || SEV.info;
  return `<div class="banner banner--${s.cls}" role="${sev === 'critical' ? 'alert' : 'status'}">${icon(s.icon, 20)}<div class="banner-c"><strong>${title}</strong>${body ? `<div>${body}</div>` : ''}</div>${actionsHtml ? `<div class="banner-a">${actionsHtml}</div>` : ''}</div>`;
}

export function timeline(items) {
  // items: [{label, at?, state:'done'|'current'|'todo', detail?}]
  return `<ol class="tl">${items
    .map(
      (it) => `<li class="tl-i tl-i--${it.state}">
      <span class="tl-dot" aria-hidden="true">${it.state === 'done' ? icon('check', 12) : ''}</span>
      <div class="tl-c"><div class="tl-l">${esc(it.label)} <span class="sr-only">(${it.state === 'done' ? 'completed' : it.state === 'current' ? 'current step' : 'not started'})</span></div>
      ${it.at ? `<div class="tl-t">${fmtDateTime(it.at)}</div>` : ''}${it.detail ? `<div class="tl-d">${it.detail}</div>` : ''}</div></li>`
    )
    .join('')}</ol>`;
}

export function activityLog(items) {
  return `<ol class="log">${items
    .map((it) => `<li><time>${new Date(it.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</time><span>${esc(it.text)}</span></li>`)
    .join('')}</ol>`;
}

export function empty(title, body = '', iconName = 'check-circle', action = '') {
  return `<div class="empty">${icon(iconName, 28)}<strong>${esc(title)}</strong>${body ? `<p>${body}</p>` : ''}${action}</div>`;
}

export function skeleton(lines = 3) {
  return `<div class="skel">${Array.from({ length: lines }, (_, i) => `<span style="width:${90 - i * 15}%"></span>`).join('')}</div>`;
}

export function tabs(items, active, action = 'tab') {
  return `<div class="tabs" role="tablist">${items
    .map((t) => `<button role="tab" class="tab ${t.id === active ? 'is-active' : ''}" aria-selected="${t.id === active}" data-action="${action}" data-id="${t.id}">${esc(t.label)}${t.count != null ? `<span class="tab-n">${t.count}</span>` : ''}</button>`)
    .join('')}</div>`;
}

export function table(cols, rows, { empty: emptyMsg = 'No records', rowAction } = {}) {
  if (!rows.length) return empty(emptyMsg, '', 'search');
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${cols.map((c) => `<th ${c.num ? 'class="num"' : ''}>${esc(c.label)}</th>`).join('')}</tr></thead>
  <tbody>${rows
    .map((r) => `<tr ${rowAction ? `class="is-click" tabindex="0" data-action="${rowAction.action}" data-id="${esc(r[rowAction.key])}"` : ''}>${cols.map((c) => `<td ${c.num ? 'class="num"' : ''}>${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

export const updatedAgo = (ts) => `<span class="upd" data-ts="${ts}">${relTime(ts)}</span>`;

// ---------------------------------------------------------------- overlays
const overlayRoot = () => document.getElementById('overlay-root');
let lastFocus = null;

export function openModal(title, bodyHtml, { footer = '', wide = false, onMount } = {}) {
  closeOverlay();
  lastFocus = document.activeElement;
  overlayRoot().innerHTML = `<div class="ov" data-action="ov-backdrop"><div class="modal ${wide ? 'modal--wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="ov-title">
    <header class="modal-h"><h2 id="ov-title">${title}</h2><button class="icon-btn" data-action="ov-close" aria-label="Close dialog">${icon('x')}</button></header>
    <div class="modal-b">${bodyHtml}</div>${footer ? `<footer class="modal-f">${footer}</footer>` : ''}</div></div>`;
  const m = overlayRoot().querySelector('.modal');
  setTimeout(() => (m.querySelector('input,select,textarea,button:not(.icon-btn)') || m).focus(), 30);
  onMount && onMount(m);
  return m;
}

export function openDrawer(title, bodyHtml, { sub = '' } = {}) {
  closeOverlay();
  lastFocus = document.activeElement;
  overlayRoot().innerHTML = `<div class="ov ov--drawer" data-action="ov-backdrop"><aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="ov-title">
    <header class="modal-h"><div><h2 id="ov-title">${title}</h2>${sub ? `<div class="drawer-sub">${sub}</div>` : ''}</div><button class="icon-btn" data-action="ov-close" aria-label="Close panel">${icon('x')}</button></header>
    <div class="drawer-b">${bodyHtml}</div></aside></div>`;
  setTimeout(() => overlayRoot().querySelector('.icon-btn')?.focus(), 30);
}

export function closeOverlay() {
  const r = overlayRoot();
  if (r && r.innerHTML) {
    r.innerHTML = '';
    lastFocus && lastFocus.focus && document.body.contains(lastFocus) && lastFocus.focus();
  }
}
export const overlayOpen = () => !!overlayRoot()?.innerHTML;

export function confirmDialog({ title, body, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    openModal(title, `<p class="muted">${body}</p>`, {
      footer: `<button class="btn btn--ghost" data-action="cd-no">Cancel</button><button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-action="cd-yes">${esc(confirm)}</button>`,
    });
    pendingConfirm = resolve;
  });
}
let pendingConfirm = null;

export function showToast({ msg, kind = 'success' }) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  const label = { success: 'Success', error: 'Error', info: 'Information', warning: 'Warning' }[kind] || 'Notice';
  el.innerHTML = `<div class="toast-b"><strong>${label}</strong><span>${esc(msg)}</span></div><button type="button" class="toast-x">Dismiss</button>`;
  const close = () => (el.classList.add('is-out'), setTimeout(() => el.remove(), 300));
  el.querySelector('.toast-x').addEventListener('click', close);
  root.appendChild(el);
  // errors stay longer so they can be read
  setTimeout(close, kind === 'error' ? 8000 : 4000);
}

// Run an async action with its button disabled (prevents double submits), surfacing failures.
export async function busy(el, fn) {
  if (el?.disabled) return;
  if (el) (el.disabled = true), el.setAttribute('aria-busy', 'true');
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    showToast({ msg: `Could not complete the action: ${e?.code || e?.message || e}`, kind: 'error' });
  } finally {
    if (el && el.isConnected) (el.disabled = false), el.removeAttribute('aria-busy');
  }
}

// ---------------------------------------------------------------- delegated actions
export const actions = {
  'ov-close': () => closeOverlay(),
  'ov-backdrop': (el, e) => e.target === el && closeOverlay(),
  'cd-yes': () => (closeOverlay(), pendingConfirm && pendingConfirm(true), (pendingConfirm = null)),
  'cd-no': () => (closeOverlay(), pendingConfirm && pendingConfirm(false), (pendingConfirm = null)),
};
export const inputs = {}; // name -> (el, e) for input/change events
export function register(map) {
  Object.assign(actions, map);
}
export function registerInputs(map) {
  Object.assign(inputs, map);
}

export function installDelegation() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = actions[el.dataset.action];
    if (fn) {
      if (el.tagName === 'A' || el.tagName === 'BUTTON') e.preventDefault();
      fn(el, e);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayOpen()) closeOverlay();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-action], [role="button"][data-action], g[data-action]')) {
      e.preventDefault();
      actions[e.target.dataset.action]?.(e.target, e);
    }
    if (e.key === 'Tab' && overlayOpen()) trapFocus(e);
  });
  const onInput = (e) => {
    const el = e.target.closest('[data-input]');
    if (el && inputs[el.dataset.input]) inputs[el.dataset.input](el, e);
  };
  document.addEventListener('input', onInput);
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (el && inputs[el.dataset.change]) inputs[el.dataset.change](el, e);
  });
}

function trapFocus(e) {
  const box = overlayRoot().querySelector('.modal, .drawer');
  if (!box) return;
  const f = [...box.querySelectorAll('a[href],button:not([disabled]),input,select,textarea,[tabindex="0"]')].filter((x) => x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0];
  const last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
  else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
}

export function formData(root) {
  const o = {};
  root.querySelectorAll('[name]').forEach((el) => {
    if (el.type === 'checkbox') {
      if (el.dataset.multi) (o[el.name] = o[el.name] || []), el.checked && o[el.name].push(el.value);
      else o[el.name] = el.checked;
    } else if (el.type === 'radio') {
      if (el.checked) o[el.name] = el.value;
    } else o[el.name] = el.value;
  });
  return o;
}

// Philippine mobile number: "+63" is shown as a fixed prefix, so only the 10 digits are typed (9xx xxx xxxx).
const phDigits = (v) => {
  let d = String(v || '').replace(/\D/g, '');
  if (d.startsWith('63')) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 10);
};
const phFormat = (d) => [d.slice(0, 3), d.slice(3, 6), d.slice(6, 10)].filter(Boolean).join(' ');
export function phoneInput(id, value = '') {
  return `<div class="ph-in"><span class="ph-cc" aria-hidden="true">+63</span><input id="${id}" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="12" placeholder="9xx xxx xxxx" aria-label="Mobile number, 10 digits after +63" value="${phFormat(phDigits(value))}" data-input="ph-fmt"/></div>`;
}
// Stored as "+63 9xx xxx xxxx"; empty when nothing was typed. Returns null if the number is incomplete.
export function phoneValue(id) {
  const d = phDigits(document.getElementById(id)?.value);
  if (!d) return '';
  return d.length === 10 && d[0] === '9' ? `+63 ${phFormat(d)}` : null;
}
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el?.dataset?.input !== 'ph-fmt') return;
  const d = phDigits(el.value);
  el.value = phFormat(d);
});

// Shared image upload box: click or drag a file onto it. `input` is the <input type="file"> markup.
export const UPLOAD_MAX_MB = 10;
export function uploadBox(what, input, { hint = `JPEG, PNG or WEBP (max ${UPLOAD_MAX_MB} MB)`, sm = false } = {}) {
  return `<label class="upload ${sm ? 'upload--sm' : ''}"><span class="upload-ic" aria-hidden="true">${icon('image', 18)}</span><strong>Click to upload or drag ${esc(what)}</strong><em>${esc(hint)}</em>${input}</label>`;
}
// Drag and drop onto any upload box; the file goes through the input's normal change handler.
['dragenter', 'dragover'].forEach((t) =>
  document.addEventListener(t, (e) => {
    const box = e.target.closest?.('.upload');
    if (!box) return;
    e.preventDefault();
    box.classList.add('is-drag');
  })
);
document.addEventListener('dragleave', (e) => {
  const box = e.target.closest?.('.upload');
  if (box && !box.contains(e.relatedTarget)) box.classList.remove('is-drag');
});
document.addEventListener('drop', (e) => {
  const box = e.target.closest?.('.upload');
  if (!box) return;
  e.preventDefault();
  box.classList.remove('is-drag');
  const input = box.querySelector('input[type=file]');
  const file = e.dataTransfer?.files?.[0];
  if (!input || !file) return;
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
// Reject files that are not images or are too large before any screen handles them.
document.addEventListener(
  'change',
  (e) => {
    const el = e.target;
    if (el?.type !== 'file' || !el.closest?.('.upload')) return;
    const f = el.files?.[0];
    if (!f) return;
    const bad = !/^image\/(jpeg|png|webp)$/.test(f.type) ? 'Choose a JPEG, PNG or WEBP image.' : f.size > UPLOAD_MAX_MB * 1048576 ? `That image is larger than ${UPLOAD_MAX_MB} MB. Choose a smaller one.` : '';
    if (!bad) return;
    e.stopImmediatePropagation();
    el.value = '';
    showToast({ msg: bad, kind: 'error' });
  },
  true
);

export function field(label, control, { hint = '', id = '', req = false, optional = false } = {}) {
  return `<div class="field"><label class="field-l" ${id ? `for="${id}"` : ''}>${esc(label)}${req ? ' <span class="req" aria-hidden="true">*</span>' : ''}${optional ? ' <span class="opt">(optional)</span>' : ''}</label>${control}${hint ? `<div class="field-h">${hint}</div>` : ''}</div>`;
}
