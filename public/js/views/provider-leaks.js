// Provider: Leak Detection — pressure-drop analysis plus TDR bi-wire sensing along the main pipelines.
//
// Two independent methods:
//  - Pressure drop: a leak lowers pressure in the barangay while flow rises (water escapes the pipe).
//  - TDR bi-wire: a two-wire sensing cable laid beside the pipe. A pulse is sent down the cable;
//    where leaking water wets it, the impedance changes and the pulse reflects back. The return time
//    gives the distance to the leak. Heavy rain soaks the soil and can wet the cable along its length,
//    so TDR readings are not reliable in strong rainfall and alerts then need a pressure drop to confirm.
// All readings are simulated; cable routes and lengths are illustrative.
import * as S from '../store.js';
import { ZONES, zoneById } from '../data.js';
import { src, card, empty, register } from '../ui.js';
import { weatherState } from '../weather.js';
import { esc, fmt } from '../util.js';
import { go, isDemoMode } from '../app.js';

const st = () => S.getState();

// TDR sensing cables (illustrative routes from the Poblacion 13 reservoir).
const SEGMENTS = [
  { id: 'TDR-01', name: 'Reservoir to Canlapwas main', zone: 'canlapwas', lengthM: 1850 },
  { id: 'TDR-02', name: 'Reservoir to Mercedes main', zone: 'mercedes', lengthM: 1420 },
  { id: 'TDR-03', name: 'Poblacion distribution loop', zone: 'poblacion-13', lengthM: 2300 },
  { id: 'TDR-04', name: 'San Andres line', zone: 'san-andres', lengthM: 1600 },
  { id: 'TDR-05', name: 'Maulong line', zone: 'maulong', lengthM: 2700 },
  { id: 'TDR-06', name: 'Guinsorongan line', zone: 'guinsorongan', lengthM: 1950 },
];
const LEAK_AT = 0.62; // simulated leak position along the cable (fraction of its length)
const DROP_ALERT = 15; // % below normal pressure that counts as a significant drop
const FLOW_RISE = 8; // % above expected flow that, with a pressure drop, points to a leak
const RAIN_MODERATE = 2.5; // mm/h (PAGASA: moderate rain)
const RAIN_HEAVY = 7.5; // mm/h (PAGASA: heavy rain)

let selSeg = 'TDR-01';
let demoRain = false;

function rainNow() {
  if (demoRain) return { mmh: 12, simulated: true };
  const c = weatherState().data?.current;
  return { mmh: c ? c.precipitation || 0 : null, simulated: false };
}
const tdrReliability = (mmh) => (mmh == null ? 'unknown' : mmh >= RAIN_HEAVY ? 'unreliable' : mmh >= RAIN_MODERATE ? 'reduced' : 'reliable');

// ---------------------------------------------------------------- analysis
export function analyse() {
  const s = st();
  const rain = rainNow();
  const rel = tdrReliability(rain.mmh);
  const pressure = ZONES.map((z) => {
    const t = s.tele.zones[z.id];
    const drop = t ? Math.max(0, ((z.basePressure - t.pressure) / z.basePressure) * 100) : 0;
    const leakPattern = drop >= DROP_ALERT && t.flowDeltaPct >= FLOW_RISE;
    const sign = leakPattern ? 'leak' : drop >= DROP_ALERT ? 'supply' : 'normal';
    return { z, t, drop, sign };
  }).sort((a, b) => b.drop - a.drop);
  const segments = SEGMENTS.map((g) => {
    const issue = s.zoneIssues[g.zone];
    const wetAt = issue && issue.type === 'leak' ? Math.round(g.lengthM * LEAK_AT) : null;
    const state = rel === 'unreliable' ? 'rain' : wetAt != null ? 'wet' : 'dry';
    return { ...g, wetAt, state };
  });
  const suspects = [];
  ZONES.forEach((z) => {
    const p = pressure.find((x) => x.z.id === z.id);
    const seg = segments.find((g) => g.zone === z.id);
    const tdrHit = seg && seg.wetAt != null;
    const tdrTrusted = tdrHit && rel !== 'unreliable';
    if (p.sign !== 'leak' && !tdrTrusted) return;
    const confidence = p.sign === 'leak' && tdrTrusted ? 'High' : 'Medium';
    const evidence = [];
    if (p.sign === 'leak') evidence.push(`Pressure ${fmt(p.t.pressure, 0)} PSI, ${fmt(p.drop, 0)}% below normal, while flow is ${fmt(p.t.flowDeltaPct, 0)}% above expected`);
    if (tdrTrusted) evidence.push(`TDR moisture on ${seg.id} at ${fmt(seg.wetAt)} m from the reservoir`);
    else if (tdrHit) evidence.push(`TDR reading on ${seg.id} not used: heavy rain`);
    else if (seg) evidence.push(`TDR cable ${seg.id} dry`);
    else evidence.push('No TDR cable in this barangay; location from pressure only');
    const loss = s.zoneIssues[z.id]?.lossML || null;
    const inc = s.incidents.find((i) => i.zone === z.id && i.status !== 'Resolved');
    suspects.push({ z, p, seg: tdrTrusted ? seg : null, confidence, evidence, loss, inc });
  });
  suspects.sort((a, b) => (a.confidence === 'High' ? -1 : 0) - (b.confidence === 'High' ? -1 : 0));
  const ignoredRain = rel === 'unreliable' ? segments.length : 0;
  return { rain, rel, pressure, segments, suspects, ignoredRain };
}

// ---------------------------------------------------------------- illustration
function art(an) {
  const seg = an.segments.find((g) => g.id === selSeg) || an.segments[0];
  const z = zoneById(seg.zone);
  const t = st().tele.zones[seg.zone];
  const raining = an.rel === 'unreliable' || an.rel === 'reduced';
  const X0 = 170;
  const X1 = 1040;
  const xAt = (m) => X0 + (m / seg.lengthM) * (X1 - X0);
  // During heavy rain the cable reads wet everywhere, so TDR cannot place the leak.
  const rainBlind = an.rel === 'unreliable';
  const leakX = seg.wetAt != null && !rainBlind ? xAt(seg.wetAt) : null;
  // Pressure along the line: normal upstream, falling past the leak.
  const ps = [0.2, 0.5, 0.8].map((f) => {
    const x = X0 + f * (X1 - X0);
    const base = z.basePressure * (1 - f * 0.08);
    const v = t ? (leakX != null && x > leakX ? t.pressure * (1 - (f - LEAK_AT) * 0.1) : leakX != null ? base * 0.92 : base * (t.pressure / z.basePressure)) : base;
    return { x, v };
  });
  const INK = '#1E3A5F';
  const LINE = '#7690B0';
  const MUTED = '#9AA6B4';
  return `<svg class="lk-art" viewBox="0 0 1100 300" role="img" aria-label="Cross-section of ${esc(seg.name)}: water main with a TDR bi-wire sensing cable and pressure sensors${leakX != null ? `, leak detected at ${seg.wetAt} metres` : ''}">
    <defs>
      <linearGradient id="lkWet" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D5DEE8"/><stop offset="1" stop-color="#EEF2F6"/></linearGradient>
      <radialGradient id="lkLeak"><stop offset="0" stop-color="#C9D5E2"/><stop offset="1" stop-color="#C9D5E2" stop-opacity="0"/></radialGradient>
    </defs>
    <!-- soil -->
    <rect x="0" y="96" width="1100" height="170" fill="#F4F6F9"/>
    ${raining ? '<rect x="0" y="96" width="1100" height="70" fill="url(#lkWet)"/>' : ''}
    <line x1="0" y1="96" x2="1100" y2="96" stroke="#C5CFDA" stroke-width="1.5"/>
    ${[...Array(40)].map((_, i) => `<circle cx="${(i * 97) % 1100 + 12}" cy="${120 + ((i * 53) % 130)}" r="1.3" fill="#D3DAE3"/>`).join('')}
    <text x="16" y="114" class="lk-t-s">Ground level</text>
    ${
      raining
        ? `<g aria-hidden="true">
        <path d="M700 46h70a16 16 0 0 0 0-32 22 22 0 0 0-42-6 18 18 0 0 0-28 16 11 11 0 0 0 0 22z" fill="#F4F7FB" stroke="${MUTED}" stroke-width="1.4"/>
        ${[0, 1, 2, 3, 4, 5].map((i) => `<line x1="${702 + i * 14}" y1="54" x2="${696 + i * 14}" y2="${72 + (i % 2) * 8}" stroke="${MUTED}" stroke-width="1.4" stroke-linecap="round"/>`).join('')}
        <text x="280" y="124" class="lk-t-s">${rainBlind ? 'Rain-soaked soil: the cable reads wet along its length, so TDR cannot locate leaks' : 'Rain is wetting the topsoil: check TDR readings against pressure'}</text>
      </g>`
        : ''
    }
    <!-- TDR unit at the reservoir end -->
    <rect x="40" y="132" width="96" height="58" rx="6" fill="#fff" stroke="${LINE}" stroke-width="1.6"/>
    <rect x="52" y="144" width="52" height="16" rx="2" fill="#EEF2F7"/>
    <path d="M54 152h8l4-6 5 12 4-6h27" fill="none" stroke="${INK}" stroke-width="1.3"/>
    <circle cx="120" cy="152" r="4" fill="${INK}"/>
    <text x="88" y="180" text-anchor="middle" class="lk-t-b">TDR unit</text>
    <path d="M136 176 H${X0} " stroke="${INK}" stroke-width="1.4"/>
    <path d="M136 182 H${X0} " stroke="${INK}" stroke-width="1.4"/>
    <!-- water main -->
    <rect x="${X0 - 20}" y="150" width="${X1 - X0 + 40}" height="18" rx="9" fill="#E3E9F0" stroke="${LINE}" stroke-width="1.6"/>
    <line x1="${X0}" y1="159" x2="${X1}" y2="159" stroke="#9FB7D1" stroke-width="2" stroke-dasharray="7 10" class="lk-flow"/>
    <text x="${X0 - 18}" y="142" class="lk-t-s">Reservoir side</text>
    <text x="${X1 + 18}" y="142" text-anchor="end" class="lk-t-s">Downstream</text>
    <!-- TDR bi-wire along the pipe -->
    <line x1="${X0}" y1="176" x2="${X1}" y2="176" stroke="${INK}" stroke-width="1.4"/>
    <line x1="${X0}" y1="182" x2="${X1}" y2="182" stroke="${INK}" stroke-width="1.4"/>
    ${rainBlind ? `<rect x="${X0}" y="172" width="${X1 - X0}" height="14" fill="#9FB2CA" opacity=".28"/>` : ''}
    ${
      leakX != null
        ? `<ellipse cx="${leakX}" cy="176" rx="70" ry="30" fill="url(#lkLeak)"/>
      <g class="lk-drops" fill="${LINE}">
        <path d="M${leakX} 150 q-4 -10 0 -16 q4 6 0 16z"/><path d="M${leakX - 12} 152 q-4 -8 0 -13 q4 5 0 13z"/><path d="M${leakX + 12} 152 q-4 -8 0 -13 q4 5 0 13z"/>
      </g>
      <path d="M${X0} 196 H${leakX - 6}" stroke="${INK}" stroke-width="1.2" stroke-dasharray="4 4" marker-end="url(#lkArrow)"/>
      <path d="M${leakX - 6} 204 H${X0 + 4}" stroke="${MUTED}" stroke-width="1.2" stroke-dasharray="4 4"/>
      <text x="${(X0 + leakX) / 2}" y="192" text-anchor="middle" class="lk-t-s">Pulse out</text>
      <text x="${(X0 + leakX) / 2}" y="218" text-anchor="middle" class="lk-t-s">Reflection returns</text>
      <line x1="${leakX}" y1="186" x2="${leakX}" y2="236" stroke="#C0262D" stroke-width="1.5"/>
      <circle cx="${leakX}" cy="179" r="4.5" fill="#fff" stroke="#C0262D" stroke-width="2"/>
      <text x="${leakX}" y="252" text-anchor="middle" class="lk-t-leak">Leak at ${fmt(seg.wetAt)} m</text>`
        : ''
    }
    <defs><marker id="lkArrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="${INK}"/></marker></defs>
    <!-- pressure sensors -->
    ${ps
      .map(
        (p, i) => `<g>
      <line x1="${p.x}" y1="150" x2="${p.x}" y2="70" stroke="${LINE}" stroke-width="2"/>
      <circle cx="${p.x}" cy="56" r="17" fill="#fff" stroke="${LINE}" stroke-width="1.6"/>
      <path d="M${p.x - 10} 62 a11 11 0 0 1 20 0" fill="none" stroke="#D3DAE3" stroke-width="3"/>
      <line x1="${p.x}" y1="60" x2="${p.x + 9 * Math.cos(Math.PI * (1 - Math.min(60, p.v) / 60))}" y2="${60 - 9 * Math.sin(Math.PI * (1 - Math.min(60, p.v) / 60))}" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
      <text x="${p.x + 24}" y="52" class="lk-t-b">P${i + 1}</text>
      <text x="${p.x + 24}" y="67" class="lk-t-s">${fmt(p.v, 0)} PSI</text>
    </g>`
      )
      .join('')}
    <!-- distance scale -->
    <line x1="${X0}" y1="272" x2="${X1}" y2="272" stroke="#C5CFDA"/>
    ${[0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="${X0 + f * (X1 - X0)}" y1="268" x2="${X0 + f * (X1 - X0)}" y2="276" stroke="#C5CFDA"/><text x="${X0 + f * (X1 - X0)}" y="292" text-anchor="middle" class="lk-t-s">${fmt(Math.round(seg.lengthM * f))} m</text>`).join('')}
  </svg>`;
}

// ---------------------------------------------------------------- sections
function summary(an) {
  const n = an.suspects.length;
  const high = an.suspects.filter((x) => x.confidence === 'High').length;
  const where = n === 1 ? esc(an.suspects[0].z.short) : `${n} areas`;
  const head = !n ? 'No leak detected' : high ? `Leak confirmed in ${where}` : `Possible leak in ${where}`;
  const tdrOff = an.rel === 'unreliable';
  const text = !n
    ? tdrOff ? 'Pressure is within normal range across the network.' : 'Pressure is within normal range and the TDR cables are dry.'
    : high
      ? 'Pressure drop and TDR cable agree. Send a crew to the reported location.'
      : tdrOff
        ? 'Pressure points to a leak. TDR cannot confirm the location during heavy rain.'
        : 'One method indicates a leak. Check the area to confirm.';
  const tag = !n ? ['ok', 'Normal'] : high ? ['crit', 'Action needed'] : ['warn', 'Check area'];
  const tdrState = { reliable: 'In use', reduced: 'In use, check against pressure', unreliable: 'Set aside during heavy rain', unknown: 'In use, no rain data' }[an.rel];
  const rain = an.rain.mmh == null ? '—' : `${fmt(an.rain.mmh, 1)} mm/h`;
  const note =
    an.rel === 'unreliable'
      ? `Heavy rain${an.rain.simulated ? ' (simulated)' : ''} can soak the soil and make the sensing cables read wet along their length. Leaks are confirmed by pressure drop only until the rain eases.`
      : an.rel === 'reduced'
        ? 'Moderate rain can raise cable moisture readings. TDR alerts are checked against pressure.'
        : '';
  return `<section class="lk-sum2">
    <div class="lk-sum2-top">
      <div class="lk-sum2-st"><div class="lk-sum2-k"><span>Pipe leak status</span><span class="lk-sum2-tag lk-sum2-tag--${tag[0]}">${tag[1]}</span></div><strong>${head}</strong><p>${text}</p></div>
      <dl class="lk-sum2-n">
        <div><dt>TDR cables</dt><dd>${an.segments.length}</dd></div>
        <div><dt>Pressure points</dt><dd>${ZONES.length}</dd></div>
        <div><dt>Rain now</dt><dd>${rain}</dd></div>
      </dl>
    </div>
    <div class="lk-sum2-m">
      <div><span>Pressure drop</span><strong>In use</strong></div>
      <div><span>TDR bi-wire</span><strong>${tdrState}</strong></div>
      ${note ? `<p>${note}</p>` : ''}
    </div>
  </section>`;
}

function artCard(an) {
  const seg = an.segments.find((g) => g.id === selSeg) || an.segments[0];
  return card(
    'How leaks are found',
    `<div class="lk-art-wrap">${art(an)}</div>
    <div class="lk-legend"><span><i class="lk-l-wire"></i>TDR bi-wire cable</span><span><i class="lk-l-pipe"></i>Water main</span><span><i class="lk-l-sensor"></i>Pressure sensor</span><span><i class="lk-l-leak"></i>Leak location</span><span class="lk-legend-r">${esc(seg.name)}, ${fmt(seg.lengthM)} m</span></div>`,
    { sub: 'A pulse travels along the sensing cable and reflects where leaking water wets it', actions: `<div class="ws-seg">${an.segments.map((g) => `<button class="${g.id === seg.id ? 'is-on' : ''}" data-action="lk-seg" data-id="${g.id}">${g.id.replace('TDR-', 'T')}</button>`).join('')}</div>` }
  );
}

function suspectsCard(an) {
  return card(
    'Suspected leaks',
    an.suspects.length
      ? `<ul class="lk-list">${an.suspects
          .map(
            (x) => `<li class="lk-item">
          <div class="lk-item-h"><div><strong>Brgy. ${esc(x.z.short)}</strong><span>${x.seg ? `${esc(x.seg.name)}, ${fmt(x.seg.wetAt)} m from the reservoir` : 'Location: barangay only'}</span></div>
            <span class="lk-conf lk-conf--${x.confidence.toLowerCase()}">${x.confidence} confidence</span></div>
          <ul class="lk-ev">${x.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
          <div class="lk-item-f"><span>${x.loss ? `Estimated loss ${fmt(x.loss * 1000, 0)} m³ per day` : 'Loss not yet estimated'}</span>${
            x.inc ? `<a class="btn btn--outline btn--sm" href="#/p/incidents/${x.inc.id}">View ${x.inc.id}</a>` : `<button class="btn btn--primary btn--sm" data-action="lk-incident" data-zone="${x.z.id}" data-seg="${x.seg ? x.seg.id : ''}">Create incident</button>`
          }</div>
        </li>`
          )
          .join('')}</ul>`
      : empty('No suspected leaks', an.ignoredRain ? `${an.ignoredRain} TDR readings were set aside because of heavy rain. Pressure shows no leak pattern.` : 'Pressure and TDR readings are normal across the network.', 'check-circle'),
    { actions: src('SIMULATED') }
  );
}

function pressureCard(an) {
  const label = { leak: 'Leak pattern', supply: 'Supply-side drop', normal: 'Normal' };
  const rows = an.pressure.slice(0, 8);
  return card(
    'Pressure drop by barangay',
    `<div class="tbl-wrap"><table class="tbl lk-tbl"><thead><tr><th>Barangay</th><th class="num">Now</th><th class="num">Drop</th><th class="num">Flow</th><th>Reading</th></tr></thead><tbody>${rows
      .map(
        (p) => `<tr><td><strong>${esc(p.z.short)}</strong><div class="it-s">normal ~${p.z.basePressure} PSI</div></td><td class="num">${p.t ? fmt(p.t.pressure, 0) : '—'} PSI</td><td class="num">${fmt(p.drop, 0)}%</td><td class="num">${p.t ? `${p.t.flowDeltaPct >= 0 ? '+' : '−'}${fmt(Math.abs(p.t.flowDeltaPct), 0)}%` : '—'}</td><td><span class="lk-tag lk-tag--${p.sign}">${label[p.sign]}</span></td></tr>`
      )
      .join('')}</tbody></table></div>
    <p class="fine">A leak shows as lower pressure with higher flow. Lower pressure with lower flow points to a supply problem instead. Showing the 8 largest drops of ${ZONES.length} barangays.</p>`,
    { actions: src('SIMULATED') }
  );
}

function tdrCard(an) {
  const label = { dry: 'Dry', wet: 'Moisture detected', rain: 'Rain-affected' };
  return card(
    'TDR cable segments',
    `<div class="tbl-wrap"><table class="tbl lk-tbl"><thead><tr><th>Cable</th><th class="num">Length</th><th>Reading</th></tr></thead><tbody>${an.segments
      .map(
        (g) => `<tr class="is-click" data-action="lk-seg" data-id="${g.id}"><td><strong>${g.id}</strong><div class="it-s">${esc(g.name)}</div></td><td class="num">${fmt(g.lengthM)} m</td><td><span class="lk-tag lk-tag--${g.state === 'wet' ? 'leak' : g.state === 'rain' ? 'supply' : 'normal'}">${label[g.state]}</span>${g.state === 'wet' ? `<div class="it-s">at ${fmt(g.wetAt)} m</div>` : g.state === 'rain' ? '<div class="it-s">not used for alerts</div>' : ''}</td></tr>`
      )
      .join('')}</tbody></table></div>
    <p class="fine">Cable routes and lengths are illustrative. Select a cable to show it in the illustration.</p>`,
    { actions: src('SIMULATED IoT') }
  );
}

function methodCard() {
  const items = [
    ['Pressure drop', 'Sensors in each barangay compare pressure with its normal level. A leak lowers pressure while flow rises, because water escapes before it reaches homes.'],
    ['TDR bi-wire', 'A two-wire sensing cable runs beside the main. The TDR unit sends a pulse; where leaking water wets the cable, part of the pulse reflects back. The return time gives the distance to the leak.'],
    ['Rainfall limit', `Above ${RAIN_HEAVY} mm of rain per hour, rainwater soaks the soil and can wet the cable along its length. TDR readings are then set aside and leaks are confirmed by pressure drop only.`],
  ];
  return card('Detection methods', `<div class="lk-methods">${items.map(([t, d]) => `<div><strong>${t}</strong><p>${d}</p></div>`).join('')}</div>`);
}

function main() {
  const an = analyse();
  return `${summary(an)}
    ${artCard(an)}
    ${suspectsCard(an)}
    <div class="ops-grid ops-grid--eq">${pressureCard(an)}${tdrCard(an)}</div>
    ${methodCard()}`;
}

function demoPanel() {
  const leak = !!st().zoneIssues.canlapwas;
  return `<aside class="ws-demo" aria-label="Leak detection demo"><div class="ws-demo-b">
    <button class="${leak ? 'is-on is-bad' : ''}" data-action="lk-demo-leak" aria-pressed="${leak}">${leak ? 'Clear leak' : 'Leak'}</button>
    <button class="${demoRain ? 'is-on' : ''}" data-action="lk-demo-rain" aria-pressed="${demoRain}">Heavy rain</button>
  </div></aside>`;
}

const repaint = () => {
  const r = document.querySelector('[data-region="main"]');
  if (r) r.innerHTML = main();
  const d = document.querySelector('.ws-demo');
  if (d) d.outerHTML = demoPanel();
};

register({
  'lk-seg': (el) => ((selSeg = el.dataset.id), repaint()),
  'lk-demo-rain': () => ((demoRain = !demoRain), repaint()),
  'lk-demo-leak': async () => {
    await S.applyScenario(st().zoneIssues.canlapwas ? 'normal' : 'pipelineLeak', { reports: false }); // sensors only, no resident reports
    repaint();
  },
  'lk-incident': async (el) => {
    const zone = el.dataset.zone;
    const z = zoneById(zone);
    const seg = SEGMENTS.find((g) => g.id === el.dataset.seg);
    const an = analyse();
    const x = an.suspects.find((v) => v.z.id === zone);
    const reports = st().reports.filter((r) => r.zone === zone && !r.incidentId).map((r) => r.id);
    el.disabled = true;
    const inc = await S.createIncident({
      zone,
      reportIds: reports,
      title: `Suspected pipe leak — ${z.short}`,
      type: 'Leak',
      severity: x?.confidence === 'High' ? 'High' : 'Medium',
      note: `Leak detection: ${(x?.evidence || []).join('. ')}.${seg ? ` Check ${seg.name} near ${fmt(Math.round(seg.lengthM * LEAK_AT))} m from the reservoir.` : ''}`,
    });
    go(`#/p/incidents/${inc.id}`);
  },
});

const leakView = {
  title: 'Leak Detection',
  regions: { main },
  render() {
    return `<div class="page-h"><div><h1>Leak Detection</h1><p class="page-sub">Pressure-drop analysis and TDR bi-wire sensing along the main pipelines.</p></div></div>
      <div data-region="main">${main()}</div>${isDemoMode() ? demoPanel() : ''}`;
  },
};

export const leakViews = { 'leak-detection': leakView };
