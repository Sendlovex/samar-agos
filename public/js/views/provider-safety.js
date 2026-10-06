// Provider: Water Safety — quality checks on water for daily household use.
import * as S from '../store.js';
import { ZONES } from '../data.js';
import { icon, src, card, register, SEV } from '../ui.js';
import { lineChart } from '../charts.js';
import { esc, fmt, fmtTime, relTime } from '../util.js';
import { openAdvisoryModal } from './provider-shared.js';
import { isDemoMode } from '../app.js';

const val = (p, v = p.value) => (v == null ? '—' : `${fmt(v, p.d ?? 1)}${p.unit ? ` ${p.unit}` : ''}`);
const VERDICT = {
  safe: { label: 'Safe to use', text: 'All readings are within the limits for daily household use at every monitoring point.' },
  caution: { label: 'Needs attention', text: 'Health limits are met, but an operational reading is outside its normal range.' },
  unsafe: { label: 'Not safe to use', text: 'Readings exceed the limits for daily household use. Hold or treat water before it reaches residents.' },
};
const SEV_OF = { safe: 'normal', caution: 'warning', unsafe: 'critical' };
const MARK = { normal: '#1E3A5F', warning: '#D97706', critical: '#C0262D', offline: '#9AA6B4' };

// Display scale for each reading (gauge and range bars); the safe band comes from the limits.
const SCALE = { ph: [4, 10], turb: [0, 12], cl: [0, 2], temp: [15, 40], tds: [0, 1000] };

// Reading icons (24px stroke, same style as the app's icon set)
const P = {
  ph: '<path d="M9 3h6M10 3v6L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9V3"/><path d="M7 15h10"/>',
  turb: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5S5 13 5 15a7 7 0 0 0 7 7z"/><circle cx="10" cy="15" r=".9" fill="currentColor"/><circle cx="14" cy="13" r=".9" fill="currentColor"/><circle cx="13" cy="17.5" r=".9" fill="currentColor"/>',
  cl: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M11 9.2a3 3 0 1 0 0 5.6M14 8.5V15.5h2.5"/>',
  temp: '<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/><path d="M11.5 9v7"/>',
  tds: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5S5 13 5 15a7 7 0 0 0 7 7z"/><path d="M8.5 15h7M9.5 18h5"/>',
  germ: '<circle cx="12" cy="12" r="5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/><circle cx="10.5" cy="11" r=".8" fill="currentColor"/><circle cx="13.5" cy="13.5" r=".8" fill="currentColor"/>',
  sensor: '<rect x="6" y="9" width="12" height="12" rx="2"/><path d="M12 9V5M8.5 3.5a5 5 0 0 1 7 0M10 15h4"/>',
};
const ico = (k, size = 20) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k]}</svg>`;

let trendKey = 'ph';
let selStation = 'WQ-1';

// ---------------------------------------------------------------- illustration: source → homes with IoT sensors
function journey(ws) {
  const bad = ws.verdict === 'unsafe';
  const flow = bad ? '#A8865A' : '#5B9BD5'; // muddy vs clear water
  const nodes = [
    { st: ws.stations[0], x: 470 },
    { st: ws.stations[1], x: 750 },
    { st: ws.stations[2], x: 880 },
  ];
  const node = ({ st, x }) => {
    const c = MARK[st.sev];
    const on = st.id === selStation;
    const ok = st.sev === 'normal';
    return `<g class="ws-node ${on ? 'is-sel' : ''}" data-action="ws-station" data-id="${st.id}" role="button" tabindex="0" aria-label="${esc(st.name)}: ${ok ? 'within limits' : 'outside limits'}">
      <path d="M${x} 110 Q ${(x + 563) / 2} 40 ${x < 563 ? 540 : 590} 62" fill="none" stroke="#B8C4D3" stroke-width="1.4" stroke-dasharray="3 5" class="ws-link"/>
      <line x1="${x}" y1="172" x2="${x}" y2="200" stroke="#7690B0" stroke-width="3"/>
      <rect x="${x - 17}" y="136" width="34" height="36" rx="7" fill="#fff" stroke="${on ? '#0B2545' : '#7690B0'}" stroke-width="${on ? 2.4 : 1.6}"/>
      <rect x="${x - 10}" y="143" width="20" height="10" rx="2" fill="#EEF2F7"/>
      <circle cx="${x}" cy="163" r="3.5" fill="${c}"/>
      <line x1="${x}" y1="136" x2="${x}" y2="122" stroke="#7690B0" stroke-width="1.6"/>
      <path d="M${x - 7} 119 a9 9 0 0 1 14 0 M${x - 12} 114 a15 15 0 0 1 24 0" fill="none" stroke="#7690B0" stroke-width="1.4" stroke-linecap="round" class="ws-wave"/>
      <text x="${x + 24}" y="150" class="ws-svg-id">${st.id}</text>
      <text x="${x + 24}" y="165" class="ws-svg-s" style="fill:${ok ? '#6B7A8C' : '#C0262D'};font-weight:${ok ? 500 : 700}">${ok ? 'Within' : 'Outside'}</text>
    </g>`;
  };
  return `<svg class="ws-journey" viewBox="0 6 1100 270" role="img" aria-label="Water journey from the river intake through treatment and storage to homes, with three IoT water-quality sensors">
    <defs>
      <linearGradient id="wsRes" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bad ? '#D9C3A4' : '#BFDAF2'}"/><stop offset="1" stop-color="${bad ? '#B8946A' : '#6FA6DB'}"/></linearGradient>
    </defs>
    <!-- cloud platform -->
    <g>
      <path d="M520 70h86a20 20 0 0 0 0-40 28 28 0 0 0-53-8 22 22 0 0 0-33 21 14 14 0 0 0 0 27z" fill="#F4F7FB" stroke="#9FB2CA" stroke-width="1.6"/>
      <text x="563" y="56" text-anchor="middle" class="ws-svg-t">SAMAR-AGOS</text>
      <text x="630" y="22" class="ws-svg-s">IoT cloud, readings every 5 minutes</text>
    </g>
    <!-- ground -->
    <line x1="0" y1="226" x2="1100" y2="226" stroke="#E3E8EF" stroke-width="1.5"/>
    <!-- source: hills + river -->
    <path d="M0 200 C 40 150, 80 150, 120 185 C 150 160, 190 165, 215 200 Z" fill="#EEF3EA" stroke="#C9D6C2"/>
    <path d="M0 196 C 30 190, 60 202, 95 196 S 160 190, 200 198 L 200 226 L 0 226 Z" fill="#DCEAF7"/>
    <path d="M10 208 q 12 -6 24 0 t 24 0 M70 216 q 12 -6 24 0 t 24 0 M130 207 q 12 -6 24 0 t 24 0" fill="none" stroke="#9CC3E6" stroke-width="1.6" stroke-linecap="round"/>
    <rect x="186" y="178" width="34" height="30" rx="3" fill="#fff" stroke="#7690B0" stroke-width="1.6"/>
    <path d="M182 180 l21 -12 21 12" fill="none" stroke="#7690B0" stroke-width="1.6"/>
    <text x="100" y="250" text-anchor="middle" class="ws-svg-t">Water sources</text>
    <text x="100" y="266" text-anchor="middle" class="ws-svg-s">Springs + Antiao River</text>
    <!-- main pipe with flowing water -->
    <line x1="220" y1="204" x2="1000" y2="204" stroke="#C9D4E2" stroke-width="9" stroke-linecap="round"/>
    <line x1="220" y1="204" x2="1000" y2="204" stroke="${flow}" stroke-width="3" stroke-dasharray="8 12" stroke-linecap="round" class="ws-flow"/>
    <!-- treatment plant -->
    <rect x="285" y="138" width="120" height="66" rx="4" fill="#fff" stroke="#7690B0" stroke-width="1.6"/>
    <path d="M280 140 l65 -26 65 26" fill="none" stroke="#7690B0" stroke-width="1.6"/>
    <rect x="300" y="160" width="38" height="28" rx="3" fill="#EEF2F7" stroke="#9FB2CA"/>
    <path d="M300 172 q 9.5 -4 19 0 t 19 0" fill="none" stroke="${flow}" stroke-width="1.4"/>
    <rect x="352" y="160" width="38" height="28" rx="3" fill="#EEF2F7" stroke="#9FB2CA"/>
    <path d="M352 172 q 9.5 -4 19 0 t 19 0" fill="none" stroke="${flow}" stroke-width="1.4"/>
    <text x="345" y="250" text-anchor="middle" class="ws-svg-t">Kulador plant</text>
    <text x="345" y="266" text-anchor="middle" class="ws-svg-s">Filtration + chlorination</text>
    <!-- reservoir -->
    <path d="M560 112 v84 a55 12 0 0 0 110 0 v-84" fill="#fff" stroke="#7690B0" stroke-width="1.6"/>
    <path d="M560 146 a55 12 0 0 0 110 0 v50 a55 12 0 0 1 -110 0 z" fill="url(#wsRes)" opacity="0.9"/>
    <ellipse cx="615" cy="112" rx="55" ry="12" fill="#F4F7FB" stroke="#7690B0" stroke-width="1.6"/>
    <text x="615" y="250" text-anchor="middle" class="ws-svg-t">Poblacion 13 reservoir</text>
    <text x="615" y="266" text-anchor="middle" class="ws-svg-s">440 m³ storage</text>
    <!-- homes -->
    ${[975, 1025, 1075]
      .map((x, i) => `<g transform="translate(${x} ${i === 1 ? 150 : 160})"><path d="M-20 22 l20 -18 20 18" fill="none" stroke="#7690B0" stroke-width="1.6" stroke-linejoin="round"/><rect x="-15" y="21" width="30" height="${i === 1 ? 34 : 24}" fill="#fff" stroke="#7690B0" stroke-width="1.6"/><rect x="-4" y="${i === 1 ? 41 : 31}" width="8" height="${i === 1 ? 14 : 14}" fill="#EEF2F7" stroke="#9FB2CA"/></g>`)
      .join('')}
    <text x="1025" y="250" text-anchor="middle" class="ws-svg-t">Homes</text>
    <text x="1025" y="266" text-anchor="middle" class="ws-svg-s">26 barangays</text>
    ${nodes.map(node).join('')}
  </svg>`;
}

// ---------------------------------------------------------------- gauges and range bars
function gauge(p) {
  const [lo, hi] = SCALE[p.key];
  const T = (v) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  const pt = (t, r = 46) => [60 - r * Math.cos(Math.PI * t), 62 - r * Math.sin(Math.PI * t)];
  const arc = (t0, t1) => {
    const [x0, y0] = pt(t0);
    const [x1, y1] = pt(t1);
    return `M${x0.toFixed(1)} ${y0.toFixed(1)} A46 46 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  };
  const [mx, my] = pt(T(p.value ?? lo));
  return `<svg class="ws-gauge" viewBox="0 0 120 70" aria-hidden="true">
    <path d="${arc(0, 1)}" fill="none" stroke="#EDF1F6" stroke-width="10" stroke-linecap="round"/>
    <path d="${arc(T(p.min ?? lo), T(p.max ?? hi))}" fill="none" stroke="#C7D9EE" stroke-width="10"/>
    <circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="7" fill="#fff" stroke="${MARK[p.sev]}" stroke-width="3.5"/>
    <text x="14" y="69" class="ws-g-t">${lo}</text><text x="106" y="69" text-anchor="end" class="ws-g-t">${hi}</text>
  </svg>`;
}

function rangeBar(p) {
  const [lo, hi] = SCALE[p.key];
  const T = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  const a = T(p.min ?? lo);
  const b = T(p.max ?? hi);
  return `<div class="ws-bar" aria-hidden="true"><span class="ws-bar-ok" style="left:${a}%;width:${b - a}%"></span><i style="left:${T(p.value ?? lo)}%;border-color:${MARK[p.sev]}"></i></div>`;
}

// ---------------------------------------------------------------- sections
function verdictStrip(ws) {
  const v = VERDICT[ws.verdict];
  return `<section class="ws-verdict ws-verdict--${ws.verdict}">
    <div class="ws-v-t"><span class="kpi-label">Water for daily use</span><strong>${v.label}</strong><span>${v.text}</span></div>
    <div class="ws-v-n">
      <div><span>IoT sensors</span><strong>${ws.stations.length}</strong></div>
      <div><span>Readings in range</span><strong>${ws.stations.length * S.WQ_PARAMS.length - ws.failures.filter((f) => f.station.id).length} of ${ws.stations.length * S.WQ_PARAMS.length}</strong></div>
      <div><span>Lab bacteria test</span><strong>${ws.lab.every((l) => l.sev === 'normal') ? 'Clear' : 'Detected'}</strong></div>
    </div>
  </section>`;
}

function journeyCard(ws) {
  return card(
    'Water journey and sensors',
    `<div class="ws-j-wrap">${journey(ws)}</div>
    <div class="ws-j-legend"><span><i class="ws-l-flow"></i>Water flow</span><span><i class="ws-l-link"></i>Wireless sensor link</span><span class="ws-j-hint">Select a sensor to see its readings</span></div>`,
    { sub: 'Online analysers check the water three times before it reaches homes', actions: src('SIMULATED IoT') }
  );
}

function gaugesCard(ws) {
  const st = ws.stations.find((x) => x.id === selStation) || ws.stations[0];
  return card(
    `Readings at ${st.name}`,
    `<div class="ws-gauges">${st.params
      .map(
        (p) => `<div class="ws-g ${p.sev !== 'normal' ? 'is-bad' : ''}">
        <div class="ws-g-h"><span class="ws-g-ic">${ico(p.key, 18)}</span><span>${esc(p.short || p.label)}</span></div>
        ${gauge(p)}
        <div class="ws-g-v">${fmt(p.value, p.d ?? 1)}<small>${esc(p.unit)}</small></div>
        <div class="ws-g-s">${p.sev === 'normal' ? 'Safe' : '<b>Outside limit</b>, safe'} ${esc(p.std.replace(' (operational)', ''))}</div>
      </div>`
      )
      .join('')}</div>
    <div class="ws-g-legend"><span><i class="ws-l-band"></i>Safe range</span><span><i class="ws-l-mark"></i>Current reading</span></div>`,
    { sub: `${st.id}, ${st.where}`, actions: `<div class="ws-seg">${ws.stations.map((x) => `<button class="${x.id === st.id ? 'is-on' : ''}" data-action="ws-station" data-id="${x.id}">${x.id}</button>`).join('')}</div>` }
  );
}

function actionsCard(ws) {
  if (ws.verdict === 'safe') return '';
  const steps =
    ws.verdict === 'unsafe'
      ? [
          ['octagon', 'Hold supply', 'Stop sending water from the plant to the reservoir.'],
          ['flask', 'Adjust treatment', 'Check the chlorine dosing pump and coagulant feed.'],
          ['droplets', 'Flush and re-test', 'Flush the main line, then re-test all three points.'],
          ['clipboard', 'Confirm with lab', 'Take a sample for E. coli and total coliform.'],
          ['megaphone', 'Warn residents', 'Advise residents to limit tap water use until results are clear.'],
        ]
      : [
          ['activity', 'Investigate', 'Find out why the reading is outside its normal range.'],
          ['clock', 'Re-test', 'Re-test within the hour and watch the trend.'],
        ];
  return card(
    'Recommended actions',
    `<ol class="ws-steps">${steps.map(([ic, t, d], i) => `<li><span class="ws-step-ic">${icon(ic, 18)}<b>${i + 1}</b></span><strong>${esc(t)}</strong><span>${esc(d)}</span></li>`).join('')}</ol>
    ${ws.verdict === 'unsafe' ? `<div class="ws-act"><a class="btn btn--outline btn--sm" href="#/p/work-orders">Open work orders</a><button class="btn btn--primary btn--sm" data-action="ws-boil">Issue water quality advisory</button></div>` : ''}`,
    { sub: 'Follow the utility’s water safety plan' }
  );
}

function stationsGrid(ws) {
  return `<div class="ws-grid">${ws.stations
    .map(
      (st) => `<section class="ws-st ${st.id === selStation ? 'is-sel' : ''}">
      <div class="ws-st-h"><span class="ws-st-ic">${ico('sensor', 20)}</span><div><strong>${esc(st.name)}</strong><span>${esc(st.id)}, ${esc(st.where)}</span></div><span class="ws-st-v ws-st-v--${SEV[st.sev]?.cls || 'off'}">${st.sev === 'normal' ? 'Within limits' : st.sev === 'critical' ? 'Outside limits' : 'Check'}</span></div>
      <ul class="ws-rows">${st.params
        .map((p) => `<li class="${p.sev !== 'normal' ? 'is-bad' : ''}"><span class="ws-r-ic">${ico(p.key, 16)}</span><span class="ws-r-l">${esc(p.short || p.label)}</span>${rangeBar(p)}<strong>${val(p)}</strong></li>`)
        .join('')}</ul>
    </section>`
    )
    .join('')}</div>`;
}

function trendCard(ws) {
  const p = S.WQ_PARAMS.find((x) => x.key === trendKey);
  const t = ws.hist.t;
  const n = t.length;
  const step = Math.max(1, Math.floor(n / 72));
  const keep = (arr) => arr.filter((_, i) => (n - 1 - i) % step === 0);
  const colors = ['#1E3A5F', '#5B7BA3', '#9AA6B4'];
  const thresholds = [];
  if (p.max != null) thresholds.push({ y: p.max, label: `Max ${p.max}`, color: '#C0262D' });
  if (p.min != null) thresholds.push({ y: p.min, label: `Min ${p.min}`, color: '#C0262D' });
  const times = keep(t);
  const chart = lineChart({
    id: 'ws-trend',
    label: `${p.label}, last 12 hours, at each monitoring point`,
    series: ws.stations.map((st, i) => ({ name: st.name, color: colors[i], values: keep(ws.hist[st.id][p.key]), endLabel: i === 0 })),
    labels: times.map((x) => fmtTime(x)),
    xTicks: [{ i: 0, label: '−12 h' }, { i: Math.floor((times.length - 1) / 2), label: '−6 h' }, { i: times.length - 1, label: 'Now' }],
    thresholds,
    yMin: 0,
    yFmt: (v) => fmt(v, p.d ?? 1),
    h: 220,
    legend: true,
  });
  return card(
    'Trends',
    `<div class="ws-tabs" role="tablist">${S.WQ_PARAMS.map((x) => `<button role="tab" aria-selected="${x.key === trendKey}" class="${x.key === trendKey ? 'is-on' : ''}" data-action="ws-trend" data-k="${x.key}">${ico(x.key, 14)}${esc(x.short || x.label)}</button>`).join('')}</div>
    ${chart}`,
    { sub: 'Last 12 simulated hours at all three sensors', actions: src('SIMULATED IoT') }
  );
}

function labCard(ws) {
  return card(
    'Laboratory results',
    `<div class="ws-lab">${ws.lab
      .map(
        (p) => `<div class="ws-lab-i ${p.sev !== 'normal' ? 'is-bad' : ''}">
        <span class="ws-lab-ic">${ico('germ', 26)}</span>
        <div><strong>${esc(p.label)}</strong><span>Limit ${esc(p.std)}</span></div>
        <div class="ws-lab-r">${p.sev === 'normal' ? `${icon('check-circle', 16)} Not detected` : `${icon('alert', 16)} ${fmt(p.value, 1)} <small>${esc(p.unit)}</small>`}</div>
      </div>`
      )
      .join('')}</div>
    <p class="fine">${icon('flask', 13)} Bacteria can’t be measured by online sensors, so samples go to the laboratory. Latest sample ${fmtTime(ws.labAt)} (${relTime(ws.labAt)}).</p>`,
    { actions: src('MANUAL') }
  );
}

function standardsCard() {
  const items = [
    ...S.WQ_PARAMS.map((p) => ({ k: p.key, label: p.label, std: p.std, why: p.why })),
    { k: 'germ', label: 'E. coli and coliform', std: '< 1.1 MPN/100 mL', why: 'Any detection means the water may carry disease.' },
  ];
  return card(
    'What is checked',
    `<div class="ws-std">${items.map((x) => `<div><span class="ws-std-ic">${ico(x.k, 18)}</span><strong>${esc(x.label)}</strong><em>${esc(x.std)}</em><span>${esc(x.why)}</span></div>`).join('')}</div>
    <p class="fine">Limits follow the Philippine National Standards for Drinking Water (PNSDW 2017), the national water quality standard also applied to piped household supply. Temperature has no health limit; ≤ 32 °C is an operational guide.</p>`
  );
}

// The verdict and illustration only change with the safe/unsafe state, so they sit outside the
// 3-second live region (keeps the illustration's scroll position and animations steady).
function top() {
  const ws = S.waterSafety();
  return `${verdictStrip(ws)}${journeyCard(ws)}${actionsCard(ws)}`;
}

function main() {
  const ws = S.waterSafety();
  return `
    ${gaugesCard(ws)}
    <div class="an-sec"><div><h2>Monitoring points</h2><p>Each bar shows the safe range; the marker is the current reading</p></div>${src('SIMULATED IoT')}</div>
    ${stationsGrid(ws)}
    <div class="ops-grid ws-lower">${trendCard(ws)}${labCard(ws)}</div>
    ${standardsCard()}`;
}

// Floating demo control (outside the live region so clicks aren't lost on refresh).
function demoPanel() {
  const mode = S.waterSafety().mode;
  return `<aside class="ws-demo" aria-label="Water quality demo">
    <div class="ws-demo-b">
      <button class="${mode === 'safe' ? 'is-on' : ''}" data-action="ws-demo" data-mode="safe" aria-pressed="${mode === 'safe'}">Safe</button>
      <button class="${mode === 'unsafe' ? 'is-on is-bad' : ''}" data-action="ws-demo" data-mode="unsafe" aria-pressed="${mode === 'unsafe'}">Not safe</button>
    </div>
  </aside>`;
}

const rerender = () => {
  const wrap = document.querySelector('.ws-j-wrap');
  const x = wrap?.scrollLeft || 0;
  const t = document.getElementById('ws-top');
  const r = document.querySelector('[data-region="main"]');
  if (t) t.innerHTML = top();
  if (r) r.innerHTML = main();
  const w2 = document.querySelector('.ws-j-wrap');
  if (w2) w2.scrollLeft = x;
};

register({
  'ws-demo': (el) => S.setWaterQuality(el.dataset.mode),
  'ws-trend': (el) => ((trendKey = el.dataset.k), rerender()),
  'ws-station': (el) => ((selStation = el.dataset.id), rerender()),
  'ws-boil': () =>
    openAdvisoryModal({
      title: 'Water Quality Advisory — All Served Barangays',
      areas: ZONES.map((z) => z.id),
      serviceStatus: 'QUALITY ADVISORY',
      message: 'Water quality tests found readings outside the limits for daily household use. Please limit the use of tap water until further notice.',
      instructions: 'Use tap water only for flushing and cleaning until further notice. Boil it for at least 1 minute before using it for cooking or washing food. Avoid using it to bathe infants.',
    }),
});

const waterSafety = {
  title: 'Water Safety',
  regions: { main },
  render() {
    return `<div class="page-h"><div><h1>Water Safety</h1><p class="page-sub">Quality checks on water for daily household use before it reaches residents: pH, turbidity, chlorine, temperature and dissolved solids.</p></div></div>
      <div id="ws-top">${top()}</div><div data-region="main">${main()}</div>${isDemoMode() ? demoPanel() : ''}`;
  },
};

export const safetyViews = { 'water-safety': waterSafety };
