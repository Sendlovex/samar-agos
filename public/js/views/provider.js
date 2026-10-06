// Provider portal: overview dashboard, operations, advisories, assets, analytics.
import * as S from '../store.js';
import { ZONES, zoneById, UTILITY, reportTypeLabel, REPORT_TYPES, CWD_FACTS, SERVICE_ZONES } from '../data.js';
import { icon, status, src, card, kpi, empty, tabs, table, field, openModal, closeOverlay, register, registerInputs, formData, updatedAgo, priorityBadge, sevBadge, alertBanner, SEV, confirmDialog } from '../ui.js';
import { lineChart, barChart, sparkline, gaugeBar } from '../charts.js';
import { renderMap, DEFAULT_LAYERS, assetLiveStatus } from '../map.js';
import { esc, fmt, fmtL, fmtTime, fmtDate, fmtDateShort, fmtDateTime, relTime, hoursLabel, toLocalInput, fromLocalInput } from '../util.js';
import { notificationsView, go } from '../app.js';
import { incidentViews } from './provider-incidents.js';
import { forecastViews } from './provider-forecast.js';
import { safetyViews } from './provider-safety.js';
import { leakViews } from './provider-leaks.js';
import { ASSET_CATEGORIES, categoryOf, assetLifecycle, assetArt } from '../assetinfo.js';
import './provider-households.js';
import { openAdvisoryModal, openWorkOrderModal, incStatus, woStatusBadge, ZONE_COLORS, incidentTable } from './provider-shared.js';

const st = () => S.getState();
const pct = (v) => `${Math.round(v * 100)}%`;
let mapLayers = [...DEFAULT_LAYERS];

const last = (arr, n) => arr.slice(-n);
const every = (arr, k) => arr.filter((_, i) => (arr.length - 1 - i) % k === 0);

// ---------------------------------------------------------------- OVERVIEW
function ovStatus() {
  const o = S.overallStatus();
  const label = { normal: 'Normal', warning: 'Warning', critical: 'Critical', offline: 'Unknown' }[o.sev];
  const sentence = (t) => (t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t);
  const dot = (sev) => `<span class="sys-dot sys-dot--${SEV[sev].cls}" aria-hidden="true"></span>`;
  return `<div class="sys">
    <div class="sys-main"><span class="sys-k">Overall water system status</span><div class="sys-v">${dot(o.sev)}<strong>${label}</strong></div><p>${esc(o.summary)}</p></div>
    <div class="sys-subs">${o.subs.map((x) => `<a class="sub" href="${{ supply: '#/p/operations', storage: '#/p/operations', distribution: '#/p/incidents', equipment: '#/p/assets', forecast: '#/p/forecast' }[x.key]}"><span class="sub-l">${x.label}</span><span class="sub-v">${dot(x.sev)}${SEV[x.sev].label}</span><span class="sub-t">${esc(sentence(x.text))}</span></a>`).join('')}</div>
  </div>`;
}

function ovKpis() {
  const s = st();
  const t = s.tele;
  const h = s.history;
  const lvl = t.volML / S.RES_CAP_ML;
  const open = s.incidents.filter((i) => i.status !== 'Resolved');
  const wos = s.workOrders.filter((w) => w.status !== 'Completed');
  const overdue = wos.filter((w) => w.target < Date.now()).length;
  const lvlSev = lvl < S.MIN_RESERVE ? 'critical' : lvl < 0.42 ? 'warning' : 'normal';
  const resSev = t.reserveHours < 10 ? 'critical' : t.reserveHours < 14 ? 'warning' : 'normal';
  const net = t.production + t.transfer - t.demand;
  const flag = { normal: 'Within range', warning: 'Monitor closely', critical: 'Action required' };
  const highSev = open.filter((i) => i.severity === 'High' || i.severity === 'Critical').length;
  return `<div class="kgrid">
    <section class="kp-primary">
      <a class="kpi-link" href="#/p/operations" aria-label="Open storage and supply monitoring"></a>
      <div class="kpi-top"><span class="kpi-label">Poblacion 13 Reservoir</span>${src('SIMULATED')}</div>
      <div class="kp-main">
        <div><div class="kpi-value kpi-value--xl">${fmt(t.volML, 2)}<span class="kpi-unit">ML</span></div>
        <div class="kpi-sub">${pct(lvl)} of 440 m³, 100 m³ firefighting reserve</div></div>
        ${sparkline(every(last(h.level, 144), 4), { color: '#0B2545', w: 132, h: 40, min: 0, max: 1 })}
      </div>
      ${gaugeBar(lvl * 100, { sev: lvlSev, marker: 30 })}
      <dl class="kp-meta">
        <div><dt>Inflow</dt><dd>${fmt(S.mlToLs(t.production + t.transfer), 0)} L/s</dd></div>
        <div><dt>Outflow</dt><dd>${fmt(S.mlToLs(t.demand), 0)} L/s</dd></div>
        <div><dt>Net balance</dt><dd>${net >= 0 ? '+' : ''}${fmt(net, 2)} ML/day</dd></div>
      </dl>
      <div class="kp-foot"><span>Estimated reserve <strong>${fmt(t.reserveHours, 0)} hours</strong> ${src('ESTIMATED')}</span><span class="kp-flag kp-flag--${SEV[resSev].cls}">${flag[resSev]}</span></div>
    </section>
    ${kpi({ label: 'Production', value: fmt(t.production + t.transfer, 2), unit: 'ML/day', sub: s.pumpsOffline.length ? `<span class="txt-crit">Capacity reduced to ${fmt(S.productionCapacity(), 2)}</span>` : `Capacity ${fmt(S.productionCapacity(), 2)} ML/day`, source: 'SIMULATED', link: '#/p/operations' })}
    ${kpi({ label: 'Estimated Demand', value: fmt(t.demand, 2), unit: 'ML/day', sub: s.factors.demandMult > 1.03 ? `<span class="txt-warn">${fmt((s.factors.demandMult - 1) * 100, 0)}% above normal</span>` : 'Normal daily pattern', source: 'ESTIMATED', link: '#/p/forecast' })}
    ${kpi({ label: 'Active Incidents', value: open.length, sub: highSev ? `<span class="txt-crit">${highSev} high severity</span>` : 'No high-severity incidents', source: 'INCIDENTS', link: '#/p/incidents' })}
    ${kpi({ label: 'Open Work Orders', value: wos.length, sub: overdue ? `<span class="txt-warn">${overdue} overdue</span>` : 'None overdue', source: 'FIELD', link: '#/p/work-orders' })}
  </div>`;
}

const overview = {
  title: 'Water Operations',
  regions: {
    status: ovStatus,
    kpis: ovKpis,
  },
  render() {
    const s = st();
    const open = s.incidents.filter((i) => i.status !== 'Resolved');
    return `<div class="page-h"><div><h1>Water Operations</h1><p class="page-sub">${esc(UTILITY.name)}, ${esc(UTILITY.municipality)}</p></div></div>
      <div data-region="status">${ovStatus()}</div>
      <div data-region="kpis">${ovKpis()}</div>
      <section class="card ov-map"><header class="card-h"><div><h2 class="card-t">Service Area Map</h2><p class="card-sub">Catbalogan City, Samar, hover for live readings, click for details, scroll or pinch to zoom</p></div></header><div class="card-b card-b--flush">${renderMap({ mode: 'provider', id: 'lm-overview', layers: mapLayers })}</div></section>
      ${card(
        'Active incidents',
        incidentTable(open),
        { actions: `<a class="link" href="#/p/incidents">All incidents ${icon('chev-r', 14)}</a>` }
      )}`;
  },
};

// Offline SVG fallback only — the live map has its own layer panel.
registerInputs({
  'map-layer': (el) => {
    const set = new Set(mapLayers);
    el.checked ? set.add(el.value) : set.delete(el.value);
    mapLayers = [...set];
    const m = el.closest('.map');
    if (m) m.outerHTML = renderMap({ mode: 'provider', layers: mapLayers });
  },
});

// ---------------------------------------------------------------- OPERATIONS
function hoursTicks(n, stepH = 6) {
  const out = [];
  for (let h = 24; h >= 0; h -= stepH) out.push({ i: Math.round(n - 1 - (h * 60) / S.DT_MIN / (288 / n)), label: h ? `−${h} h` : 'Now' });
  return out.filter((t) => t.i >= 0);
}

// Neutral building blocks: status as dot + word, level as a slate meter.
const dstat = (sev, label) => `<span class="dstat"><span class="sys-dot sys-dot--${SEV[sev].cls}" aria-hidden="true"></span>${esc(label)}</span>`;
const meter = (p, marker) => `<div class="meter" role="meter" aria-valuenow="${Math.round(p)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${Math.max(0, Math.min(100, p))}%"></span>${marker != null ? `<i style="left:${marker}%" title="Minimum ${marker}%"></i>` : ''}</div>`;
const levelSev = (lv) => (lv < S.MIN_RESERVE ? 'critical' : lv < 0.42 ? 'warning' : 'normal');
const RES_MIN_PCT = Math.round(S.MIN_RESERVE * 100);
const OPS_INK = '#1E3A5F';
const OPS_SLATE = '#8A9BB0';

// Priority 1: one primary container for storage, supported by four smaller ones.
function opsStrip() {
  const s = st();
  const t = s.tele;
  const lvl = t.volML / S.RES_CAP_ML;
  const sev = levelSev(lvl);
  const usable = Math.max(0, t.volML - S.MIN_RESERVE * S.RES_CAP_ML);
  const net = t.production + t.transfer - t.demand;
  const low = ZONES.filter((z) => s.tele.zones[z.id] && s.tele.zones[z.id].status !== 'normal');
  const flag = sev === 'critical' ? ['crit', 'Below reserve'] : sev === 'warning' ? ['warn', 'Low level'] : ['ok', 'Normal'];
  return `<section class="kp-primary">
      <div class="kpi-top"><span class="kpi-label">Poblacion 13 Reservoir</span>${src('SIMULATED')}</div>
      <div class="kp-main"><div><div class="kpi-value kpi-value--xl">${Math.round(lvl * 100)}<span class="kpi-unit">% full</span></div>
        <div class="kpi-sub">${fmtL(t.volML * 1e6)} of 440,000 L</div></div></div>
      ${meter(lvl * 100, RES_MIN_PCT)}
      <dl class="kp-meta">
        <div><dt>Usable</dt><dd>${fmtL(usable * 1e6)}</dd></div>
        <div><dt>Inflow</dt><dd>${fmt(S.mlToLs(t.production + t.transfer), 0)} L/s</dd></div>
        <div><dt>Outflow</dt><dd>${fmt(S.mlToLs(t.demand), 0)} L/s</dd></div>
      </dl>
      <div class="kp-foot"><span>Lasts <strong>${fmt(t.reserveHours, 0)} ${Math.round(t.reserveHours) === 1 ? 'hour' : 'hours'}</strong> at current demand</span><span class="kp-flag kp-flag--${flag[0]}">${flag[1]}</span></div>
    </section>
    ${kpi({ label: 'Production', value: fmt(t.production + t.transfer, 2), unit: 'ML/day', source: 'SIMULATED', sub: t.transfer ? `Includes ${fmt(t.transfer, 2)} ML/day by tanker` : `Capacity ${fmt(S.productionCapacity(), 2)} ML/day` })}
    ${kpi({ label: 'Demand', value: fmt(t.demand, 2), unit: 'ML/day', source: 'ESTIMATED', sub: `Includes ${fmt(S.leakLoss(), 2)} ML/day estimated losses` })}
    ${kpi({ label: 'Net balance', value: `${net >= 0 ? '+' : '−'}${fmt(Math.abs(net), 2)}`, unit: 'ML/day', source: 'ESTIMATED', sub: net >= 0 ? 'Storage stable or filling' : '<span class="txt-warn">Storage drawing down</span>', sev: net < -0.2 ? 'warning' : null })}
    ${kpi({ label: 'Low pressure', value: low.length, unit: `of ${ZONES.length} barangays`, source: 'SIMULATED', sub: low.length ? `<span class="txt-warn">${esc(low.slice(0, 2).map((z) => z.short).join(', '))}${low.length > 2 ? ` and ${low.length - 2} more` : ''}</span>` : 'All barangays within normal range', sev: low.length ? 'warning' : null })}`;
}

function opsReservoir() {
  const s = st();
  const lv = every(s.history.level, 3).map((v) => v * 100);
  const n = lv.length;
  return `${lineChart({ id: 'ops-level', label: 'Poblacion 13 reservoir level, last 24 hours', series: [{ name: 'Reservoir level', color: OPS_INK, values: lv, area: true, endLabel: true }], labels: lv.map((_, i) => `${(((i - n + 1) * 15) / 60).toFixed(1)} h`), xTicks: hoursTicks(n), thresholds: [{ y: RES_MIN_PCT, label: 'Firefighting reserve 100 m³', color: '#C0262D' }], yMin: 0, yMax: 100, yFmt: (v) => `${Math.round(v)}%`, h: 250 })}
    <div class="chart-cap">Updated ${updatedAgo(s.tele.lastUpdate)}</div>`;
}

function opsSupply() {
  const s = st();
  const h = s.history;
  const p = every(h.prod, 3);
  const d = every(h.demand, 3);
  const n = p.length;
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const deficitH = (h.prod.filter((v, i) => v < h.demand[i]).length * S.DT_MIN) / 60;
  return `${lineChart({ id: 'ops-pd', label: 'Production versus demand, last 24 hours', series: [{ name: 'Production', color: OPS_INK, values: p }, { name: 'Demand', color: OPS_SLATE, values: d, dash: true }], labels: p.map((_, i) => `${(((i - n + 1) * 15) / 60).toFixed(1)} h`), xTicks: hoursTicks(n), yMin: 0, yFmt: (v) => `${fmt(v, 1)} ML/d`, h: 250 })}
    <dl class="ops-mini">
      <div><dt>Avg. production</dt><dd>${fmt(avg(h.prod), 2)} ML/day</dd></div>
      <div><dt>Avg. demand</dt><dd>${fmt(avg(h.demand), 2)} ML/day</dd></div>
      <div><dt>Peak demand</dt><dd>${fmt(Math.max(...h.demand), 2)} ML/day</dd></div>
      <div><dt>Hours in deficit</dt><dd>${fmt(deficitH, 0)} of 24</dd></div>
    </dl>
    <div class="chart-cap">Production ${src('SIMULATED')} Demand ${src('ESTIMATED')}</div>`;
}

// Water sources (CWD Water Safety Plan 2022). Rated capacity is published; current output is simulated.
function opsSources() {
  const s = st();
  const inflow = s.factors.inflowMult;
  const carDown = s.pumpsOffline.some((id) => id.startsWith('PS-CAR'));
  const rows = [
    { name: 'Caramayon I & II springs', sub: 'Pumped, Brgy. Lobo', rated: '91 L/s pumped (spring 140 L/s)', now: carDown ? 0 : 91, down: carDown, why: 'Pumps stopped' },
    { name: 'Masacpasac spring', sub: 'Brgy. Cawayan, about 64% of production', rated: '55 L/s rated', now: 40 * inflow },
    { name: 'Kulador treatment plant', sub: 'Antiao River', rated: '4,000 m³/day (46 L/s) design', now: s.factors.kuladorOff ? 0 : 20 * inflow, down: s.factors.kuladorOff, why: 'River too turbid to treat' },
    { name: 'Deep wells', sub: 'Tumalistis, Executive Heights, Payao', rated: '7.5 L/s combined', now: 4.5 + 1.5 * (3.5 / 24) + 1.5 },
  ];
  const total = rows.reduce((n, r) => n + r.now, 0);
  rows.sort((a, b) => !!b.down - !!a.down);
  return `${table(
    [
      { label: 'Source', render: (r) => `<div class="it-t">${esc(r.name)}</div><div class="it-s">${esc(r.sub)}</div>` },
      { label: 'Rated', render: (r) => `<span class="it-s">${esc(r.rated)}</span>` },
      { label: 'Output now', num: true, render: (r) => `<strong>${fmt(r.now, 1)}</strong> L/s` },
      { label: 'Status', render: (r) => dstat(r.down ? 'critical' : r.now < 1 ? 'offline' : 'normal', r.down ? r.why : 'Producing') },
    ],
    rows
  )}<div class="chart-cap">Total available ${fmt(total, 0)} L/s (${fmt(S.productionCapacity(), 2)} ML/day). Rated capacities from the CWD Water Safety Plan 2022.</div>`;
}

function opsPumps() {
  const s = st();
  return table(
    [
      { label: 'Pump station', render: (r) => `<div class="it-t">${esc(r.name)}</div><div class="it-s mono">${r.id}</div>` },
      { label: 'Status', render: (r) => dstat(r.p.status === 'offline' ? 'critical' : 'normal', r.p.status === 'offline' ? 'Failure' : 'Running') },
      { label: 'Flow', num: true, render: (r) => (r.p.flowLs != null ? `${fmt(r.p.flowLs, 1)} L/s` : '<span class="it-s">not metered</span>') },
      { label: 'Vibration', num: true, render: (r) => (r.p.vibration > 7 ? `<span class="txt-warn">${fmt(r.p.vibration, 1)} mm/s</span>` : `${fmt(r.p.vibration, 1)} mm/s`) },
      { label: 'Power', num: true, render: (r) => `${fmt(r.p.powerKw, 1)} kW` },
    ],
    Object.entries(s.tele.pumps)
      .map(([id, p]) => ({ id, p, name: s.assets.find((a) => a.id === id)?.name || id }))
      .sort((a, b) => (b.p.status === 'offline') - (a.p.status === 'offline') || b.p.vibration - a.p.vibration),
    { empty: 'No pumps registered' }
  );
}

function opsZones() {
  const s = st();
  const zt = (z) => s.tele.zones[z.id];
  return table(
    [
      { label: 'Barangay', render: (z) => `<div class="it-t">${esc(z.short)}</div><div class="it-s">${z.level === 'I' ? 'Level I (communal)' : 'Level III'}, pop. ${fmt(z.pop2020)}</div>` },
      { label: 'Status', render: (z) => dstat(zt(z).status, zt(z).status === 'normal' ? 'Normal' : 'Low pressure') },
      { label: 'Pressure', num: true, render: (z) => `<strong>${fmt(zt(z).pressure, 0)}</strong> PSI<div class="it-s">normal ~${z.basePressure}</div>` },
      { label: 'Last 6 hours', render: (z) => sparkline(every(last(s.history.pressure[z.id], 72), 3), { color: OPS_INK, w: 120, h: 28, min: 0, max: 50 }) },
      { label: 'Flow', num: true, render: (z) => `${fmt(zt(z).flow, 1)} L/s` },
      { label: 'vs expected', num: true, render: (z) => `${zt(z).flowDeltaPct >= 0 ? '+' : '−'}${fmt(Math.abs(zt(z).flowDeltaPct), 0)}%` },
      { label: 'Connections', num: true, render: (z) => (z.connections ? `${fmt(z.connections)}<div class="it-s">estimated</div>` : '<span class="it-s">communal</span>') },
    ],
    // Problem barangays first, then lowest pressure relative to normal.
    [...ZONES].sort((a, b) => (zt(b).status !== 'normal') - (zt(a).status !== 'normal') || zt(a).pressure / a.basePressure - zt(b).pressure / b.basePressure)
  );
}

function opsEmergency() {
  const s = st();
  const backup = s.emergency;
  const rows = s.emergencyTanks.map((t) => ({ ...t, lv: t.volumeL / t.capacityL, sim: t.mode === 'SIMULATED' }));
  if (!rows.length && !backup.active)
    return `${empty('No emergency storage recorded', 'Add bladder tanks, water tankers or other standby storage as they are deployed.', 'droplets')}<div class="ops-add"><button class="btn btn--outline btn--sm" data-action="et-new">${icon('plus', 15)} Add emergency storage</button></div>`;
  return `${table(
    [
      { label: 'Storage', render: (t) => `<div class="it-t" title="${esc(t.notes)}">${esc(t.name)}</div><div class="it-s">${esc(t.team)}</div>` },
      { label: 'Data source', render: (t) => src(t.sim ? 'SIMULATED IoT' : 'MANUAL') },
      { label: 'Level', render: (t) => `<div class="ops-lv">${meter(t.lv * 100)}<span>${pct(t.lv)}</span></div>` },
      { label: 'Volume', num: true, render: (t) => `${fmtL(t.volumeL)}<div class="it-s">${t.sim ? 'measured' : 'estimated'}, of ${fmtL(t.capacityL)}</div>` },
      { label: 'Last refill', render: (t) => `<span class="nowrap">${fmtDateTime(t.lastRefill)}</span>` },
      { label: 'Last check', render: (t) => (t.sim ? `<span class="nowrap">Telemetry ${updatedAgo(t.updatedAt)}</span><div class="it-s">${dstat(t.sensor === 'online' ? 'normal' : 'warning', t.sensor === 'online' ? 'Sensor online' : 'Intermittent')}</div>` : `<span class="nowrap">Inspected ${fmtDateShort(t.lastInspection)}</span><div class="it-s nowrap">Updated ${updatedAgo(t.updatedAt)}</div>`) },
      { label: '', render: (t) => (t.sim ? '' : `<button class="btn btn--ghost btn--xs" data-action="et-edit" data-id="${t.id}" aria-label="Update manual record for ${esc(t.name)}">${icon('file', 13)} Update</button>`) },
    ],
    rows,
    { empty: 'No emergency storage recorded' }
  )}
  ${backup.active ? `<div class="ops-backup"><div><span class="it-t">Water tanker deliveries</span> ${src('SIMULATED')}<div class="it-s">Demo scenario: tankers supplementing supply.</div></div><div class="ops-backup-v">${fmtL(backup.poolML * 1e6)} remaining ${dstat('info', 'Supplying')}</div></div>` : ''}
  <div class="ops-add"><button class="btn btn--outline btn--sm" data-action="et-new">${icon('plus', 15)} Add emergency storage</button></div>`;
}

const operations = {
  title: 'Operations',
  regions: { strip: opsStrip, res: opsReservoir, supply: opsSupply, sources: opsSources, pumps: opsPumps, zones: opsZones, em: opsEmergency },
  render() {
    const R = this.regions;
    const tag = src('SIMULATED');
    const s = st();
    // Priority 2: whatever needs attention moves up, directly under the summary.
    const lowP = ZONES.some((z) => s.tele.zones[z.id] && s.tele.zones[z.id].status !== 'normal');
    const srcDown = s.pumpsOffline.length || s.factors.kuladorOff;
    const zones = card('Barangay pressure and flow', `<div data-region="zones">${R.zones()}</div>`, { sub: `${ZONES.length} barangays served by CWD, sorted by need`, actions: tag });
    const assets = `<div class="ops-grid ops-grid--eq">
        ${card('Water sources', `<div data-region="sources">${R.sources()}</div>`, { actions: tag })}
        ${card('Pump stations', `<div data-region="pumps">${R.pumps()}</div>`, { actions: tag })}
      </div>`;
    const trends = `<div class="ops-grid ops-grid--eq">
        ${card('Reservoir level', `<div data-region="res">${R.res()}</div>`, { sub: 'Last 24 hours', actions: tag })}
        ${card('Production vs demand', `<div data-region="supply">${R.supply()}</div>`, { sub: 'Last 24 hours', actions: tag })}
      </div>`;
    const order = srcDown ? [assets, lowP ? zones : '', trends, lowP ? '' : zones] : lowP ? [zones, trends, assets] : [trends, assets, zones];
    return `<div class="page-h"><div><h1>Storage & Supply Monitoring</h1><p class="page-sub">Sources, reservoir, pumps and barangay pressure for Catbalogan Water District.<br/>${tag} values come from the SAMAR-AGOS simulator calibrated to CWD's published figures, not live sensors.</p></div></div>
      <div class="kgrid" data-region="strip">${R.strip()}</div>
      ${order.join('')}
      ${card('Emergency water storage', `<div data-region="em">${R.em()}</div>`, { sub: 'Recorded by staff' })}`;
  },
};

register({
  'et-edit': (el) => {
    const t = st().emergencyTanks.find((x) => x.id === el.dataset.id);
    openModal(
      `Update ${esc(t.name)}`,
      `<form class="form" id="et-form"><div class="grid-2">
        ${field('Capacity (L)', `<input type="number" name="capacityL" id="et-cap" value="${t.capacityL}" min="0"/>`, { id: 'et-cap', req: true })}
        ${field('Estimated current volume (L)', `<input type="number" name="volumeL" id="et-vol" value="${t.volumeL}" min="0"/>`, { id: 'et-vol', req: true })}
        ${field('Last refill', `<input type="datetime-local" name="lastRefill" id="et-ref" value="${toLocalInput(t.lastRefill)}"/>`, { id: 'et-ref' })}
        ${field('Last inspection', `<input type="datetime-local" name="lastInspection" id="et-ins" value="${toLocalInput(t.lastInspection)}"/>`, { id: 'et-ins' })}
        ${field('Responsible team', `<input name="team" id="et-team" value="${esc(t.team)}"/>`, { id: 'et-team' })}
      </div>${field('Notes', `<textarea name="notes" id="et-notes" rows="2">${esc(t.notes)}</textarea>`, { id: 'et-notes', optional: true })}</form><p class="fine">Saved as a MANUAL record with the current timestamp.</p>`,
      { footer: `<button class="btn btn--ghost" data-action="ov-close">Cancel</button><button class="btn btn--primary" data-action="et-save" data-id="${t.id}">Save record</button>` }
    );
  },
  'et-save': (el) => {
    const d = formData(document.getElementById('et-form'));
    const cap = +d.capacityL;
    const vol = +d.volumeL;
    if (!(cap > 0) || vol < 0 || vol > cap) return S.toast('Volume must be between 0 and capacity', 'error');
    closeOverlay();
    S.updateEmergencyTank(el.dataset.id, { capacityL: cap, volumeL: vol, lastRefill: fromLocalInput(d.lastRefill), lastInspection: fromLocalInput(d.lastInspection), team: d.team, notes: d.notes });
  },
  'et-new': () =>
    openModal(
      'Add emergency storage',
      `<form class="form" id="etn-form">
        ${field('Name', '<input name="name" id="etn-name" placeholder="e.g. Bladder tank at Maulong covered court" required/>', { id: 'etn-name', req: true })}
        <div class="grid-2">
          ${field('Barangay', `<select name="zone" id="etn-zone">${ZONES.map((z) => `<option value="${z.id}">${esc(z.short)}</option>`).join('')}</select>`, { id: 'etn-zone', req: true })}
          ${field('Responsible team', '<input name="team" id="etn-team"/>', { id: 'etn-team', optional: true })}
          ${field('Capacity (L)', '<input type="number" name="capacityL" id="etn-cap" min="1" required/>', { id: 'etn-cap', req: true })}
          ${field('Current volume (L)', '<input type="number" name="volumeL" id="etn-vol" min="0" required/>', { id: 'etn-vol', req: true })}
        </div>${field('Notes', '<textarea name="notes" id="etn-notes" rows="2"></textarea>', { id: 'etn-notes', optional: true })}</form>`,
      { footer: `<button class="btn btn--ghost" data-action="ov-close">Cancel</button><button class="btn btn--primary" data-action="et-add">Add storage</button>` }
    ),
  'et-add': () => {
    const d = formData(document.getElementById('etn-form'));
    const cap = +d.capacityL;
    const vol = +d.volumeL;
    if (!d.name?.trim()) return S.toast('Enter a name', 'error');
    if (!(cap > 0) || vol < 0 || vol > cap) return S.toast('Volume must be between 0 and capacity', 'error');
    closeOverlay();
    S.addEmergencyTank({ name: d.name.trim(), zone: d.zone, capacityL: cap, volumeL: vol, team: d.team || '', notes: d.notes || '', lastRefill: Date.now(), lastInspection: Date.now() });
  },
});

// ---------------------------------------------------------------- ADVISORIES
const advisories = {
  title: 'Advisories',
  render() {
    const s = st();
    const active = s.advisories.filter((a) => a.status === 'Active').sort((a, b) => (a.nextUpdate || Infinity) - (b.nextUpdate || Infinity));
    const past = s.advisories.filter((a) => a.status !== 'Active').sort((a, b) => b.updatedAt - a.updatedAt);
    const now = Date.now();
    const zones = [...new Set(active.flatMap((a) => a.areas))];
    const reach = zones.reduce((n, z) => n + (zoneById(z)?.connections || 0), 0);
    const dueNext = active.filter((a) => a.nextUpdate).sort((a, b) => a.nextUpdate - b.nextUpdate)[0];
    const lateUpdates = active.filter((a) => a.nextUpdate && a.nextUpdate < now);
    const STALE = 2 * 3600e3; // water point info older than this should be reconfirmed
    const open = s.altWater.filter((p) => p.status === 'AVAILABLE' || p.status === 'LIMITED');
    const stale = s.altWater.filter((p) => now - p.confirmedAt > STALE);
    const inH = (ts) => {
      const h = (ts - now) / 3600e3;
      const v = Math.abs(h) >= 24 ? `${Math.round(Math.abs(h) / 24)}d` : Math.abs(h) >= 1 ? `${Math.round(Math.abs(h))}h` : `${Math.max(1, Math.round(Math.abs(h) * 60))}m`;
      return h < 0 ? `${v} late` : `in ${v}`;
    };
    // Affected areas in map order; a fully covered service zone is named once instead of listing every barangay.
    const areaList = (areas) => {
      const set = new Set(areas);
      const parts = [];
      SERVICE_ZONES.forEach((g) => {
        const hit = g.barangays.filter((b) => set.has(b));
        if (hit.length === g.barangays.length && hit.length > 2) parts.push(`${g.name}, ${g.area} (all ${hit.length} barangays)`);
        else hit.forEach((b) => parts.push(zoneById(b).short));
        hit.forEach((b) => set.delete(b));
      });
      ZONES.filter((z) => set.has(z.id)).forEach((z) => parts.push(z.short));
      return parts.join(', ');
    };
    const advCard = (a) => {
      const late = a.nextUpdate && a.nextUpdate < now;
      return `<article class="padv">
        <div class="padv-h"><span class="padv-kind">${esc(a.serviceStatus)}</span><span class="mono padv-id">${a.id}</span>${a.incidentId ? `<a class="mono padv-id" href="#/p/incidents/${a.incidentId}">${a.incidentId}</a>` : ''}
          <span class="padv-due ${late ? 'is-late' : ''}">${a.nextUpdate ? `Next update ${inH(a.nextUpdate)}` : ''}</span></div>
        <h3>${esc(a.title)}</h3><p>${esc(a.message)}</p>
        <div class="padv-f">
          <dl class="padv-areas"><dt>Areas</dt><dd>${esc(areaList(a.areas))}</dd></dl>
          <dl class="padv-meta"><div><dt>Started</dt><dd>${fmtDateTime(a.startAt)}</dd></div><div><dt>Last update</dt><dd>${relTime(a.updatedAt)}</dd></div><div><dt>Est. restoration</dt><dd>${a.etr ? fmtDateTime(a.etr) : '<span class="muted">Not set</span>'}</dd></div></dl>
          <div class="padv-a"><button class="btn btn--outline btn--xs" data-action="adv-close" data-id="${a.id}">Mark resolved</button><button class="btn btn--outline btn--xs" data-action="adv-update" data-id="${a.id}">Post update</button></div>
        </div></article>`;
    };
    const awStatus = { AVAILABLE: 'Available', LIMITED: 'Limited', SCHEDULED: 'Scheduled', CLOSED: 'Closed' };
    const awDot = { AVAILABLE: 'ok', LIMITED: 'warn', SCHEDULED: 'info', CLOSED: 'off' };
    return `<div class="page-h"><div><h1>Advisories</h1><p class="page-sub">Public service notices sent to residents in affected barangays.</p></div><div class="page-a"><button class="btn btn--primary btn--sm" data-action="adv-new">${icon('plus', 15)} New advisory</button></div></div>
      <div class="kgrid">
        <section class="kp-primary">
          <div class="kpi-top"><span class="kpi-label">Active Advisories</span>${src('MANUAL')}</div>
          <div class="kp-main"><div><div class="kpi-value kpi-value--xl">${active.length}</div>
            <div class="kpi-sub">${active.length ? `Reaching about <strong>${fmt(reach)}</strong> connections` : 'No notices currently shown to residents'}</div></div></div>
          ${active.length ? `<ul class="adv-sum">${active.map((a) => `<li><span>${esc(a.title)}</span><span class="muted">${esc(areaList(a.areas))}</span></li>`).join('')}</ul>` : ''}
          <div class="kp-foot"><span>${dueNext ? `Next resident update <strong class="mono">${dueNext.id}</strong>, ${fmtTime(dueNext.nextUpdate)}` : 'No updates scheduled'}</span><span class="kp-flag kp-flag--${lateUpdates.length ? 'warn' : 'ok'}">${lateUpdates.length ? `${lateUpdates.length} update${lateUpdates.length > 1 ? 's' : ''} late` : 'Updates on schedule'}</span></div>
        </section>
        ${kpi({ label: 'Barangays affected', value: zones.length, sub: zones.length ? zones.map((z) => zoneById(z).short).join(', ') : 'All barangays normal' })}
        ${kpi({ label: 'Next update due', value: dueNext ? fmtTime(dueNext.nextUpdate) : '—', sub: dueNext ? (dueNext.nextUpdate < now ? `<span class="txt-warn">${inH(dueNext.nextUpdate)}</span>` : inH(dueNext.nextUpdate)) : 'Nothing scheduled', sev: lateUpdates.length ? 'warning' : null })}
        ${kpi({ label: 'Water points open', value: `${open.length}<span class="kpi-unit">of ${s.altWater.length}</span>`, sub: 'Available or limited supply', source: 'MANUAL' })}
        ${kpi({ label: 'Needs reconfirming', value: stale.length, sub: stale.length ? 'Not confirmed in 2 hours' : 'All recently confirmed', sev: stale.length ? 'warning' : null })}
      </div>
      <div class="adv-grid"><div>
        <h2 class="sec-t">Active notices</h2>${active.length ? active.map(advCard).join('') : empty('No active advisories', 'Publish one from an incident or with New advisory.', 'megaphone')}
        <h2 class="sec-t">Resolved</h2>${
          past.length
            ? `<div class="card adv-past">${past.map((a) => `<div class="adv-past-r"><span class="sys-dot sys-dot--ok" aria-hidden="true"></span><div><strong>${esc(a.title)}</strong><span>${esc(a.message)}</span></div><span class="mono padv-id">${a.id}</span><span class="adv-past-t">${a.areas.map((z) => zoneById(z).short).join(', ')}, ${relTime(a.updatedAt)}</span></div>`).join('')}</div>`
            : empty('None', '', 'archive')
        }
      </div>
      <div>${card(
        'Alternative water points',
        `${s.altWater
          .map((p) => {
            const old = now - p.confirmedAt > STALE;
            return `<div class="awp">
            <div class="awp-t"><strong>${esc(p.name)}</strong><span>${esc(zoneById(p.zone)?.short || '')}, ${esc(p.hours)}</span>
              <span class="awp-c ${old ? 'is-old' : ''}">${old ? icon('alert', 12) : ''}Confirmed ${relTime(p.confirmedAt)}</span></div>
            <div class="awp-a"><span class="sys-dot sys-dot--${awDot[p.status] || 'off'}" aria-hidden="true"></span><label class="sr-only" for="awp-${p.id}">Status for ${esc(p.name)}</label><select id="awp-${p.id}" data-change="awp-status" data-id="${p.id}">${Object.keys(awStatus).map((x) => `<option value="${x}" ${x === p.status ? 'selected' : ''}>${awStatus[x]}</option>`).join('')}</select><button class="btn btn--${old ? 'outline' : 'ghost'} btn--xs" data-action="awp-confirm" data-id="${p.id}">Confirm</button><button class="btn btn--ghost btn--xs" data-action="awp-remove" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">Remove</button></div></div>`;
          })
          .join('') || empty('No distribution points yet', 'Add water distribution points (tankers, public faucets, water ATMs) when residents need them.', 'droplets')}
          <div class="ops-add"><button class="btn btn--outline btn--sm" data-action="awp-new">${icon('plus', 15)} Add water point</button></div>
          <p class="fine awp-note">${icon('info', 13)} Residents only see what you confirm here.</p>`,
        { sub: 'Distribution points shown in the resident portal' }
      )}</div></div>`;
  },
};

registerInputs({ 'awp-status': (el) => S.confirmAltWater(el.dataset.id, { status: el.value }) });
register({
  'awp-confirm': (el) => S.confirmAltWater(el.dataset.id, {}),
  'awp-remove': async (el) => {
    const ok = await confirmDialog({ title: 'Remove this water point?', body: 'It will no longer be shown to residents.', confirm: 'Remove' });
    if (ok) S.removeAltWater(el.dataset.id);
  },
  'awp-new': () =>
    openModal(
      'Add water distribution point',
      `<form class="form" id="awn-form">
        ${field('Name', '<input name="name" id="awn-name" placeholder="e.g. Water tanker at the barangay hall" required/>', { id: 'awn-name', req: true })}
        <div class="grid-2">
          ${field('Barangay', `<select name="zone" id="awn-zone">${ZONES.map((z) => `<option value="${z.id}">${esc(z.short)}</option>`).join('')}</select>`, { id: 'awn-zone', req: true })}
          ${field('Status', '<select name="status" id="awn-st"><option value="AVAILABLE">Available</option><option value="LIMITED">Limited</option><option value="SCHEDULED">Scheduled</option></select>', { id: 'awn-st', req: true })}
          ${field('Address / landmark', '<input name="address" id="awn-addr" required/>', { id: 'awn-addr', req: true })}
          ${field('Hours', '<input name="hours" id="awn-hours" placeholder="e.g. 8:00 AM – 5:00 PM" required/>', { id: 'awn-hours', req: true })}
        </div>${field('Instructions for residents', '<textarea name="instructions" id="awn-ins" rows="2" placeholder="e.g. Bring clean, covered containers."></textarea>', { id: 'awn-ins', optional: true })}</form>
        <p class="fine">The point is placed at the barangay centre on the map.</p>`,
      { footer: `<button class="btn btn--ghost" data-action="ov-close">Cancel</button><button class="btn btn--primary" data-action="awp-add">Add and confirm</button>` }
    ),
  'awp-add': () => {
    const d = formData(document.getElementById('awn-form'));
    if (!d.name?.trim() || !d.address?.trim() || !d.hours?.trim()) return S.toast('Name, address and hours are required', 'error');
    const z = zoneById(d.zone);
    closeOverlay();
    S.addAltWater({ name: d.name.trim(), zone: d.zone, status: d.status, address: d.address.trim(), hours: d.hours.trim(), instructions: d.instructions || '', x: z.label[0], y: z.label[1] });
  },
  'adv-update': (el) => {
    const a = st().advisories.find((x) => x.id === el.dataset.id);
    openModal(
      `Post update — ${esc(a.title)}`,
      `<form class="form" id="advu-form">${field('Updated message', `<textarea name="message" id="au-msg" rows="3">${esc(a.message)}</textarea>`, { id: 'au-msg', req: true })}
      <div class="grid-2">${field('Next update', `<input type="datetime-local" name="nextUpdate" id="au-next" value="${toLocalInput(Date.now() + 2 * 3600000)}"/>`, { id: 'au-next', req: true })}
      ${field('Estimated restoration', `<input type="datetime-local" name="etr" id="au-etr" value="${a.etr ? toLocalInput(a.etr) : ''}"/>`, { id: 'au-etr', optional: true, hint: 'Leave blank if not reliably known.' })}</div></form>`,
      { footer: `<button class="btn btn--ghost" data-action="ov-close">Cancel</button><button class="btn btn--primary" data-action="adv-update-do" data-id="${a.id}">Publish update</button>` }
    );
  },
  'adv-update-do': (el) => {
    const d = formData(document.getElementById('advu-form'));
    closeOverlay();
    S.updateAdvisory(el.dataset.id, { message: d.message, nextUpdate: fromLocalInput(d.nextUpdate), etr: fromLocalInput(d.etr) });
  },
  'adv-close': async (el) => {
    const ok = await confirmDialog({ title: 'Mark advisory resolved?', body: 'Residents will see this advisory as resolved. To resolve the underlying incident, use the incident page.', confirm: 'Mark resolved' });
    if (ok) S.updateAdvisory(el.dataset.id, { status: 'Resolved', serviceStatus: 'NORMAL', etr: null, nextUpdate: null });
  },
});

// ---------------------------------------------------------------- ASSETS
let assetCat = 'all';
let assetQ = '';
const COND_SEV = { Good: 'normal', Fair: 'warning', Poor: 'critical', Unknown: 'offline' };
const conditionBadge = (c) => status(COND_SEV[c] || 'offline', c);
const dotText = (sev, text) => `<span class="as-st"><span class="sys-dot sys-dot--${SEV[sev]?.cls || 'off'}" aria-hidden="true"></span>${esc(text)}</span>`;
const hrs = (h) => `${fmt(Math.round(h))} h`;
const lifeBar = (lc) => `<span class="as-life" title="${Math.round(lc.lifeUsed * 100)}% of ${lc.life}-year design life"><i style="width:${Math.min(100, lc.lifeUsed * 100)}%" class="${lc.lifeUsed >= 1 ? 'is-over' : lc.lifeUsed >= 0.75 ? 'is-late' : ''}"></i></span>`;
const lcOf = (a, s) => assetLifecycle(a, { offlineHours: a.status === 'offline' ? 9 : 0, down: s.pumpsOffline.includes(a.id) });

const assets = {
  title: 'Assets',
  regions: {
    summary() {
      const s = st();
      const lcs = s.assets.map((a) => lcOf(a, s));
      const attention = s.assets.filter((a) => assetLiveStatus(a, s) !== 'normal');
      const dated = lcs.filter((l) => l.known);
      const late = dated.filter((l) => l.lifeUsed >= 0.75);
      const avgAge = dated.reduce((n, l) => n + l.ageYears, 0) / Math.max(1, dated.length);
      const run7 = lcs.filter((l) => l.cycled).reduce((n, l) => n + l.last7, 0);
      return `<div class="kpis kpis--4">
        ${kpi({ label: 'Assets', value: s.assets.length, sub: 'From the CWD Water Safety Plan 2022' })}
        ${kpi({ label: 'Need attention', value: attention.length, sub: attention.length ? attention.map((a) => a.id).slice(0, 4).join(', ') + (attention.length > 4 ? '…' : '') : 'All operating normally', sev: attention.length ? 'warning' : null })}
        ${kpi({ label: 'Average age', value: dated.length ? fmt(avgAge, 1) : '—', unit: dated.length ? 'years' : '', sub: `${dated.length} of ${lcs.length} with a documented install year, ${late.length} past 75% of design life` })}
        ${kpi({ label: 'Run hours, last 7 days', value: fmt(run7, 0), unit: 'h', sub: 'Pumps, wells, springs and plant', source: 'SIMULATED' })}
      </div>`;
    },
    cats() {
      const s = st();
      return `<div class="as-cats">${ASSET_CATEGORIES.map((c) => {
        const list = s.assets.filter((a) => c.types.includes(a.type));
        const bad = list.filter((a) => assetLiveStatus(a, s) !== 'normal').length;
        return `<button class="as-cat ${assetCat === c.id ? 'is-on' : ''}" data-action="asset-cat" data-c="${c.id}" aria-pressed="${assetCat === c.id}">
          ${assetArt(c.art, 84, 56)}
          <span class="as-cat-t"><strong>${esc(c.label)}</strong><span>${esc(c.blurb)}</span></span>
          <span class="as-cat-n"><strong>${list.length}</strong><span>${bad ? `${bad} need attention` : 'All normal'}</span></span>
        </button>`;
      }).join('')}</div>`;
    },
    list() {
      const s = st();
      const q = assetQ.toLowerCase();
      const cats = ASSET_CATEGORIES.filter((c) => assetCat === 'all' || c.id === assetCat);
      const sections = cats
        .map((c) => {
          const list = s.assets.filter((a) => c.types.includes(a.type) && (!q || `${a.id} ${a.name} ${a.type}`.toLowerCase().includes(q)));
          if (!list.length) return '';
          return `<section class="card as-sec">
            <header class="as-sec-h">${assetArt(c.art, 54, 36)}<div><h2>${esc(c.label)}</h2><span>${list.length} asset${list.length > 1 ? 's' : ''}, ${esc(c.blurb)}</span></div></header>
            ${table(
              [
                { label: 'Asset', render: (a) => `<div class="as-id"><strong class="mono">${a.id}</strong><span>${esc(a.name)}</span></div>` },
                { label: 'Location', render: (a) => `<span class="as-muted">${esc(a.site || zoneById(a.zone)?.name || '—')}</span>` },
                { label: 'Status', render: (a) => { const v = assetLiveStatus(a, s); return dotText(v, SEV[v].label); } },
                { label: 'Condition', render: (a) => dotText(COND_SEV[a.condition] || 'offline', a.condition) },
                { label: 'Age', render: (a) => { const lc = lcOf(a, s); return lc.known ? `<div class="as-age"><span>${fmt(lc.ageYears, 0)} yrs <small>since ${a.installed}</small></span>${lifeBar(lc)}</div>` : '<span class="as-muted">Not recorded</span>'; } },
                { label: 'Operating hours', render: (a) => { const lc = lcOf(a, s); return `<div class="as-hrs"><strong>${lc.known ? hrs(lc.totalHours) : '—'}</strong><span>${hrs(lc.last7)} last 7 days</span></div>`; } },
                { label: 'Next maintenance', render: (a) => (a.nextMaint ? `<span class="${a.nextMaint < Date.now() ? 'txt-warn' : ''}">${fmtDate(a.nextMaint)}${a.nextMaint < Date.now() ? ', overdue' : ''}</span>` : '<span class="as-muted">Not scheduled</span>') },
              ],
              list,
              { rowAction: { action: 'goto-asset', key: 'id' } }
            )}
          </section>`;
        })
        .join('');
      return sections || card('', empty('No assets match', 'Try another search or category.', 'search'));
    },
  },
  render() {
    const r = this.regions;
    return `<div class="page-h"><div><h1>Assets</h1><p class="page-sub">Water infrastructure by category — status, condition, age and operating hours.</p></div></div>
      <div data-region="summary">${r.summary()}</div>
      <div data-region="cats">${r.cats()}</div>
      <div class="filters as-filters"><div class="search">${icon('search', 16)}<label class="sr-only" for="as-q">Search assets</label><input id="as-q" placeholder="Search by ID, name or type" value="${esc(assetQ)}" data-input="asset-q"/></div>
        ${assetCat !== 'all' ? `<button class="chip-btn" data-action="asset-cat" data-c="all">Show all categories</button>` : ''}</div>
      <div data-region="list">${r.list()}</div>`;
  },
};
registerInputs({
  'asset-q': (el) => {
    assetQ = el.value;
    const r = document.querySelector('[data-region="list"]');
    if (r) r.innerHTML = assets.regions.list();
  },
});
register({
  'asset-cat': (el) => ((assetCat = assetCat === el.dataset.c ? 'all' : el.dataset.c), go('#/p/assets')),
  'goto-asset': (el) => go(`#/p/assets/${el.dataset.id}`),
});

function usageCard(a, s) {
  const lc = lcOf(a, s);
  const remaining = lc.remainingYears;
  const issues = (a.issues || []).length ? `<div class="as-issues"><strong>Known issues</strong><ul>${a.issues.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : '';
  return card(
    'Age and usage',
    `<div class="as-use">
      <div class="as-use-art">${assetArt(categoryOf(a).art, 120, 80)}</div>
      <dl class="as-use-kv">
        <div><dt>In service since</dt><dd>${lc.known ? a.installed : 'Not recorded'}</dd></div>
        <div><dt>Age</dt><dd>${lc.known ? `${fmt(lc.ageYears, 1)} years` : '—'}</dd></div>
        <div><dt>Typical design life</dt><dd>${lc.life} years</dd></div>
        <div><dt>${lc.known && remaining < 0 ? 'Beyond design life' : 'Remaining life'}</dt><dd>${lc.known ? `${fmt(Math.abs(remaining), 1)} years` : '—'}</dd></div>
        <div><dt>${lc.cycled ? 'Lifetime run hours' : 'Hours in service'}</dt><dd>${lc.known ? hrs(lc.totalHours) : '—'}</dd></div>
        <div><dt>Last 7 days</dt><dd>${hrs(lc.last7)} <span class="as-muted">(${fmt(lc.last7 / 7, 1)} h/day)</span></dd></div>
      </dl>
    </div>
    ${lc.known ? `<div class="as-lifeline"><div class="as-lifeline-h"><span>Design life used</span><strong>${Math.round(lc.lifeUsed * 100)}%</strong></div>${lifeBar(lc)}<div class="as-lifeline-s"><span>${a.installed}</span><span>End of typical design life ${a.installed + lc.life}</span></div></div>` : '<p class="fine">The install year for this asset isn’t published in CWD’s Water Safety Plan, so age and lifetime hours aren’t shown.</p>'}
    ${issues}`,
    { sub: `${a.source || 'Asset registry'}, run hours simulated from typical duty cycles`, actions: src('MANUAL') }
  );
}

function logCard(a, s) {
  const lc = lcOf(a, s);
  const log = lc.log;
  const chart = barChart({
    id: `as-log-${a.id}`,
    label: `${a.id} daily operating hours, last 14 days`,
    bars: log.map((d, i) => ({ label: i % 2 === log.length % 2 ? '' : new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), value: d.hours, color: d.note === 'Normal operation' ? '#1E3A5F' : '#9AA6B4', tip: `${fmtDate(d.date)}, ${fmt(d.hours, 1)} h${d.note !== 'Normal operation' ? ', ' + d.note : ''}` })),
    yFmt: (v) => `${fmt(v, 0)} h`,
    yMax: 24,
    h: 170,
  });
  const rows = [...log].reverse().slice(0, 7);
  return card(
    'Operating log',
    `${chart}<div class="chart-cap">${lc.cycled ? 'Run hours' : 'Hours in service'} per day, grey bars mark days with downtime</div>
    <div class="tbl-wrap"><table class="tbl as-log"><thead><tr><th>Date</th><th class="num">Hours</th>${lc.cycled ? '<th class="num">Starts</th>' : ''}${log[0].kwh != null ? '<th class="num">Energy</th>' : ''}<th>Notes</th></tr></thead><tbody>${rows
      .map((d, i) => `<tr><td>${i === 0 ? 'Today' : fmtDate(d.date)}</td><td class="num"><strong>${fmt(d.hours, 1)}</strong></td>${lc.cycled ? `<td class="num">${d.starts}</td>` : ''}${d.kwh != null ? `<td class="num">${fmt(d.kwh)} kWh</td>` : ''}<td class="${d.note === 'Normal operation' ? 'as-muted' : ''}">${esc(d.note)}</td></tr>`)
      .join('')}</tbody></table></div>`,
    { sub: 'Last 14 days of logged operation', actions: src('SIMULATED') }
  );
}

const assetDetail = {
  title: 'Asset',
  regions: {
    live({ id }) {
      const s = st();
      const a = s.assets.find((x) => x.id === id);
      const t = s.tele;
      const sev = assetLiveStatus(a, s);
      let rows = '';
      if (a.type === 'Reservoir') rows = `<div><dt>Level</dt><dd><strong>${pct(t.volML / S.RES_CAP_ML)}</strong> ${src('SIMULATED')}</dd></div><div><dt>Volume</dt><dd>${fmtL(t.volML * 1e6)} ${src('SIMULATED')}</dd></div>`;
      else if (a.type === 'Tank') rows = `<div><dt>Level</dt><dd><strong>${pct(t.tanks[a.id].level)}</strong> ${src('SIMULATED')}</dd></div><div><dt>Volume</dt><dd>${fmtL(t.tanks[a.id].volL)} ${src('SIMULATED')}</dd></div>`;
      else if (a.type === 'Pump') rows = `<div><dt>Run status</dt><dd>${esc(t.pumps[a.id].units)}</dd></div><div><dt>Flow</dt><dd>${fmt(t.pumps[a.id].flowLs, 1)} L/s ${src('SIMULATED')}</dd></div><div><dt>Vibration</dt><dd>${fmt(t.pumps[a.id].vibration, 1)} mm/s ${src('SIMULATED')}</dd></div>`;
      return `<dl class="kv kv--3"><div><dt>Operational status</dt><dd>${status(sev, SEV[sev].label)}</dd></div>${rows}<div><dt>Last update</dt><dd>${a.status === 'offline' ? 'Not reporting' : relTime(t.lastUpdate)}</dd></div></dl>`;
    },
  },
  render({ id }) {
    const s = st();
    const a = s.assets.find((x) => x.id === id);
    if (!a) return empty('Asset not found', '', 'search');
    const wos = s.workOrders.filter((w) => w.assetId === a.id);
    return `<a class="back" href="#/p/assets">${icon('chev-l', 16)} Assets</a>
      <div class="page-h"><div><div class="mono muted">${a.id}</div><h1>${esc(a.name)}</h1><div class="inc-badges">${esc(a.type)}, ${esc(zoneById(a.zone)?.name || '')}</div></div><div class="page-a"><button class="btn btn--primary btn--sm" data-action="wo-new" data-asset="${a.id}">${icon('wrench', 15)} Create work order</button></div></div>
      <div class="inc-grid"><div class="inc-main">
        ${card('Live status', `<div data-region="live">${this.regions.live({ id })}</div>`)}
        ${card(
          'Asset information',
          `<dl class="kv kv--3"><div><dt>Asset ID</dt><dd class="mono">${a.id}</dd></div><div><dt>Type</dt><dd>${esc(a.type)}</dd></div><div><dt>Location</dt><dd>${esc(a.site || zoneById(a.zone)?.name || '—')}</dd></div><div><dt>Condition</dt><dd>${esc(a.condition)} ${src('MANUAL')}</dd></div><div><dt>Last maintenance</dt><dd>${a.lastMaint ? fmtDate(a.lastMaint) : 'Not recorded'}</dd></div><div><dt>Next maintenance</dt><dd class="${a.nextMaint && a.nextMaint < Date.now() ? 'txt-warn' : ''}">${a.nextMaint ? fmtDate(a.nextMaint) + (a.nextMaint < Date.now() ? ' (overdue)' : '') : 'Not scheduled'}</dd></div>${a.spec ? `<div class="kv-wide"><dt>Specification</dt><dd>${esc(a.spec)}</dd></div>` : ''}${a.source ? `<div class="kv-wide"><dt>Source</dt><dd>${esc(a.source)}</dd></div>` : ''}</dl>`
        )}
        ${usageCard(a, s)}
        ${logCard(a, s)}
        ${card(
          'Related work orders',
          table(
            [
              { label: 'Work order', render: (w) => `<strong class="mono">${w.id}</strong>` },
              { label: 'Description', render: (w) => esc(w.description) },
              { label: 'Status', render: woStatusBadge },
              { label: 'Created', render: (w) => fmtDate(w.createdAt) },
            ],
            wos,
            { rowAction: { action: 'goto-wo', key: 'id' }, empty: 'No work orders for this asset' }
          )
        )}
      </div><div class="inc-side">
        ${card('Failure history', a.failures.length ? `<ul class="upd-list">${a.failures.map((f) => `<li><time>${fmtDate(f.at)}</time><p>${esc(f.text)}</p></li>`).join('')}</ul>` : empty('No recorded failures', '', 'check-circle'))}
        ${a.x != null ? card('Location', renderMap({ mode: 'provider', layers: ['zones', 'pipes', 'storage', 'sources', 'pumps'], selected: a.id, focusZone: a.zone, toggles: false, compact: true }), { cls: 'card--flush' }) : ''}
      </div></div>`;
  },
};

// ---------------------------------------------------------------- ANALYTICS
// Water consumption (simulated from the reservoir outflow, calibrated to CWD's 9.6 ML/day average).
function consumptionSection() {
  const s = st();
  const t = s.tele;
  const h = s.history;
  const step = 3; // 15-minute points
  const keep = (a) => a.filter((_, i) => (a.length - 1 - i) % step === 0);
  const act = keep(h.demand);
  const times = keep(h.t);
  const normal = times.map((tm) => S.BASE_DEMAND * S.diurnal(tm));
  const n = act.length;
  const normalNow = S.BASE_DEMAND * S.diurnal(t.simTime);
  const vsNow = ((t.demand - normalNow) / normalNow) * 100;
  const total24 = (h.demand.reduce((a, b) => a + b, 0) / h.demand.length) * 1000; // m³ over 24 h
  const normal24 = S.BASE_DEMAND * 1000;
  const peakI = h.demand.indexOf(Math.max(...h.demand));
  // Scaled from CWD's published 107.7 L per person per day at average demand.
  const lpcd = CWD_FACTS.lpcd * (t.demand / S.BASE_DEMAND);
  const zones = SERVICE_ZONES.map((g) => {
    const flow = ZONES.filter((z) => z.group === g.id).reduce((a, z) => a + (t.zones[z.id]?.flow || 0), 0);
    return { label: `${g.name}, ${g.area}`, value: Math.round(flow * 86.4), color: '#1E3A5F' };
  });
  const sign = (v) => `${v >= 0 ? '+' : '−'}${fmt(Math.abs(v), 0)}%`;
  return `<div class="kpis kpis--4">
      ${kpi({ label: 'Consumption now', value: fmt(t.demand, 2), unit: 'ML/day', source: 'SIMULATED', sub: `${sign(vsNow)} vs normal for this hour`, sev: vsNow > 12 ? 'warning' : null })}
      ${kpi({ label: 'Last 24 hours', value: fmt(total24, 0), unit: 'm³', source: 'SIMULATED', sub: `${sign(((total24 - normal24) / normal24) * 100)} vs a normal day (${fmt(normal24, 0)} m³)` })}
      ${kpi({ label: 'Per person', value: fmt(lpcd, 0), unit: 'L/day', source: 'ESTIMATED', sub: `CWD average ${fmt(CWD_FACTS.lpcd, 0)} L/day` })}
      ${kpi({ label: 'Peak hour', value: h.t[peakI] ? new Date(h.t[peakI]).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—', source: 'SIMULATED', sub: `${fmt(Math.max(...h.demand), 2)} ML/day at peak` })}
    </div>
    <div class="ops-grid ops-grid--eq an-cons">
      ${card(
        'Consumption trend, last 24 hours',
        lineChart({ id: 'an-cons', label: 'Water consumption versus the normal daily pattern, last 24 hours', series: [{ name: 'Consumption', color: '#1E3A5F', values: act, area: true }, { name: 'Normal pattern', color: '#9AA6B4', values: normal, dash: true }], labels: times.map((x) => new Date(x).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })), xTicks: [{ i: 0, label: '−24 h' }, { i: Math.round(n / 2), label: '−12 h' }, { i: n - 1, label: 'Now' }], yMin: 0, yFmt: (v) => `${fmt(v, 1)}`, legend: true, h: 220 }) +
          '<div class="chart-cap">ML/day. Includes estimated losses (non-revenue water).</div>',
        { actions: src('SIMULATED') }
      )}
      ${card('Consumption by service zone', barChart({ id: 'an-cons-z', label: 'Current consumption by service zone, cubic metres per day', bars: zones.map((b) => ({ ...b, showValue: true })), h: 220, yFmt: (v) => fmt(v, 0) }) + '<div class="chart-cap">m³ per day at the current rate.</div>', { actions: src('SIMULATED') })}
    </div>`;
}

let pzZone = 'all';
const PZ_ALARM = 26;
const PZ_LABEL = { normal: 'Normal', warning: 'Low pressure', critical: 'Very low', offline: 'No data' };

function pzCard(z) {
  const s = st();
  const raw = s.history.pressure[z.id].filter((v) => v != null);
  const vals = every(s.history.pressure[z.id], 3);
  const n = vals.length;
  const t = s.tele.zones[z.id];
  const sev = t?.status || 'offline';
  const lo = raw.length ? Math.min(...raw) : null;
  const avg = raw.length ? raw.reduce((a, b) => a + b, 0) / raw.length : null;
  const below = raw.filter((v) => v < PZ_ALARM).length * 5; // samples are 5 sim-minutes apart
  return `<section class="pz pz--click ${sev !== 'normal' ? 'is-bad' : ''}" data-action="brgy-open" data-id="${z.id}" role="button" tabindex="0" aria-label="Open ${esc(z.short)} households and consumption">
    <div class="pz-h"><div><strong>${esc(z.short)}</strong><span>${z.level === 'I' ? 'Level I, communal supply' : `${fmt(z.connections)} connections`}</span></div>
      <span class="pz-st pz-st--${SEV[sev].cls}">${PZ_LABEL[sev]}</span></div>
    <div class="pz-now"><span class="pz-v">${t ? fmt(t.pressure, 0) : '—'}</span><span class="pz-u">PSI now</span></div>
    <div class="pz-chart">${lineChart({ id: `an-pz-${z.id}`, label: `${z.short} pressure, last 24 hours`, series: [{ name: z.short, color: '#1E3A5F', values: vals, area: true }], labels: Array.from({ length: n }, (_, i) => `${(((i - n + 1) * 15) / 60).toFixed(1)} h`), xTicks: hoursTicks(n, 12), thresholds: [{ y: PZ_ALARM, label: '', color: '#9AA6B4' }], yMin: 0, yMax: 60, yTickCount: 3, yFmt: (v) => `${Math.round(v)}`, h: 120, pad: { l: 28, r: 6, t: 8, b: 22 } })}</div>
    <dl class="pz-meta"><div><dt>24 h low</dt><dd>${lo != null ? `${fmt(lo, 0)} PSI` : '—'}</dd></div><div><dt>24 h avg</dt><dd>${avg != null ? `${fmt(avg, 0)} PSI` : '—'}</dd></div><div><dt>Below ${PZ_ALARM} PSI</dt><dd>${below ? hoursLabel(below / 60) : 'None'}</dd></div></dl>
  </section>`;
}

// One section per service zone; the filter narrows the view to a single zone.
function pzZoneStats(g) {
  const s = st();
  const list = ZONES.filter((z) => z.group === g.id);
  const tz = list.map((z) => s.tele.zones[z.id]).filter(Boolean);
  const low = list.filter((z) => s.tele.zones[z.id] && s.tele.zones[z.id].status !== 'normal');
  const avg = tz.length ? tz.reduce((a, b) => a + b.pressure, 0) / tz.length : null;
  return { list, low, avg, conn: list.reduce((n, z) => n + z.connections, 0) };
}

function pressureByZone() {
  const stats = Object.fromEntries(SERVICE_ZONES.map((g) => [g.id, pzZoneStats(g)]));
  const lowAll = SERVICE_ZONES.reduce((n, g) => n + stats[g.id].low.length, 0);
  // Gauge icon: arc from 0 to 60 PSI filled to the zone's average, red tick at the 26 PSI alarm.
  const gaugeIcon = (avg) => {
    const pt = (v, r) => {
      const a = Math.PI * (1 - Math.max(0, Math.min(60, v ?? 0)) / 60);
      return `${(24 + r * Math.cos(a)).toFixed(1)} ${(26 - r * Math.sin(a)).toFixed(1)}`;
    };
    return `<svg class="pzf-g" viewBox="0 0 48 30" width="48" height="30" aria-hidden="true">
      <path d="M4 26 A20 20 0 0 1 44 26" fill="none" stroke="currentColor" stroke-opacity=".2" stroke-width="4" stroke-linecap="round"/>
      <path d="M4 26 A20 20 0 0 1 ${pt(avg, 20)}" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
      <path d="M${pt(PZ_ALARM, 23)} L${pt(PZ_ALARM, 16)}" stroke="#C0262D" stroke-width="1.8"/>
      <path d="M24 26 L${pt(avg, 12)}" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <circle cx="24" cy="26" r="2.6" fill="currentColor"/>
    </svg>`;
  };
  const chip = (id, name, sub, count, low, avg) =>
    `<button class="pzf ${pzZone === id ? 'is-on' : ''} ${low ? 'has-low' : ''}" data-action="pz-zone" data-id="${id}" aria-pressed="${pzZone === id}">
      <span class="pzf-p">${gaugeIcon(avg)}<span class="pzf-pv">${avg != null ? fmt(avg, 0) : '—'}</span><span class="pzf-pu">PSI avg</span></span>
      <span class="pzf-t"><span class="pzf-n">${esc(name)}</span><span class="pzf-s">${esc(sub)}</span><span class="pzf-c">${count} barangays${low ? `, <b>${low} low</b>` : ''}</span></span>
    </button>`;
  const tAll = ZONES.map((z) => st().tele.zones[z.id]).filter(Boolean);
  const avgAll = tAll.length ? tAll.reduce((a, b) => a + b.pressure, 0) / tAll.length : null;
  const shown = pzZone === 'all' ? SERVICE_ZONES : SERVICE_ZONES.filter((g) => g.id === pzZone);
  return `<div class="pzf-bar" role="group" aria-label="Filter by service zone">
      ${chip('all', 'All zones', 'Whole network', ZONES.length, lowAll, avgAll)}
      ${SERVICE_ZONES.map((g) => chip(g.id, g.name, g.area, stats[g.id].list.length, stats[g.id].low.length, stats[g.id].avg)).join('')}
    </div>
    ${shown
      .map((g) => {
        const x = stats[g.id];
        return `<div class="pz-zone">
          <div class="pz-zone-h"><div><h3>${esc(g.name)}<span>${esc(g.area)}</span></h3><p>${esc(g.desc)}</p></div>
            <dl><div><dt>Barangays</dt><dd>${x.list.length}</dd></div><div><dt>Connections</dt><dd>${x.conn ? fmt(x.conn) : 'Communal'}</dd></div><div><dt>Avg. pressure</dt><dd>${x.avg != null ? `${fmt(x.avg, 0)} PSI` : '—'}</dd></div><div><dt>Low pressure</dt><dd class="${x.low.length ? 'pz-warn' : ''}">${x.low.length ? x.low.length : 'None'}</dd></div></dl></div>
          <div class="pz-grid">${[...x.list].sort((a, b) => (st().tele.zones[b.id]?.status !== 'normal') - (st().tele.zones[a.id]?.status !== 'normal')).map(pzCard).join('')}</div>
        </div>`;
      })
      .join('')}`;
}

register({
  'pz-zone': (el) => {
    pzZone = el.dataset.id;
    const r = document.querySelector('[data-region="pressure"]');
    if (r) r.innerHTML = pressureByZone();
  },
});

const analytics = {
  title: 'Analytics',
  regions: { pressure: pressureByZone, consumption: consumptionSection },
  render() {
    const s = st();
    const typeCounts = REPORT_TYPES.map((t) => ({ label: t.label.replace('Unusual ', ''), value: s.reports.filter((r) => r.type === t.id).length })).filter((b) => b.value);
    const zoneCounts = ZONES.map((z) => ({ label: z.short, value: s.reports.filter((r) => r.zone === z.id).length, color: '#1E3A5F' }));
    const verified = s.reports.filter((r) => r.residentResponse);
    const restored = verified.filter((r) => r.residentResponse.restored).length;
    const linked = s.reports.filter((r) => r.incidentId).length;
    return `<div class="page-h"><div><h1>Analytics</h1><p class="page-sub">Service performance indicators from operational and resident data.</p></div></div>
      <div class="kpis kpis--4">
        ${kpi({ label: 'Resident reports (all)', value: s.reports.length, sub: `${linked} linked to incidents`, source: 'RESIDENT REPORTED' })}
        ${kpi({ label: 'Report-to-incident link rate', value: Math.round((linked / Math.max(1, s.reports.length)) * 100), unit: '%', sub: 'reports used as evidence' })}
        ${kpi({ label: 'Resident-verified restorations', value: verified.length ? `${restored}/${verified.length}` : '—', sub: 'confirmed restored / responses', source: 'RESIDENT REPORTED' })}
        ${kpi({ label: 'Non-revenue water', value: CWD_FACTS.nrwPct, unit: '%', sub: `${CWD_FACTS.asOf}, ${CWD_FACTS.nrwPctYear}% for 2022 (LWUA data sheet)`, source: 'MANUAL', sev: CWD_FACTS.nrwPct > 20 ? 'warning' : null })}
      </div>
      <div class="an-sec"><div><h2>Catbalogan Water District at a glance</h2><p>Published operating figures, ${CWD_FACTS.asOf}</p></div>${src('MANUAL')}</div>
      <div class="ops-grid ops-grid--eq">
        ${card('Service connections', barChart({ id: 'an-conn', label: 'Active service connections by class', bars: Object.entries(CWD_FACTS.byClass).map(([label, value]) => ({ label: label.replace('/Industrial', ''), value, color: '#1E3A5F', showValue: true })), h: 200 }), { sub: `${fmt(CWD_FACTS.activeConnections)} active of ${fmt(CWD_FACTS.totalConnections)} total, population served ${fmt(CWD_FACTS.populationServed)}` })}
        ${card('Production and billing', `<dl class="kv kv--2">
          <div><dt>Water produced</dt><dd>${fmt(CWD_FACTS.productionM3Month)} m³ / month</dd></div>
          <div><dt>Water billed</dt><dd>${fmt(CWD_FACTS.billedM3Month)} m³ / month</dd></div>
          <div><dt>Produced in 2022</dt><dd>${fmt(CWD_FACTS.productionM3Year2022)} m³</dd></div>
          <div><dt>Non-revenue water</dt><dd>${CWD_FACTS.nrwPct}% (year: ${CWD_FACTS.nrwPctYear}%)</dd></div>
          <div><dt>Average use</dt><dd>${fmt(CWD_FACTS.avgM3PerConnection, 1)} m³ per connection / month</dd></div>
          <div><dt>Coverage</dt><dd>${CWD_FACTS.barangaysServed} of ${CWD_FACTS.barangaysTotal} barangays, ${fmt(CWD_FACTS.networkKm, 1)} km of pipes</dd></div>
        </dl><p class="fine">Source: ${esc(CWD_FACTS.source)}; Water Safety Plan 2022.</p>`)}
      </div>
      <div class="an-sec"><div><h2>Water consumption</h2><p>How much water the city is using now, compared with a normal day</p></div>${src('SIMULATED')}</div>
      <div data-region="consumption">${this.regions.consumption()}</div>
      <div class="an-sec"><div><h2>Pressure by zone</h2><p>Last 24 simulated hours. The dashed line marks the ${PZ_ALARM} PSI low-pressure alarm. Select a zone to see only its barangays, or a barangay to see its households and consumption.</p></div>${src('SIMULATED')}</div>
      <div data-region="pressure">${this.regions.pressure()}</div>
      <div class="an-sec"><div><h2>Resident reports</h2><p>What residents report, and where</p></div>${src('RESIDENT REPORTED')}</div>
      <div class="ops-grid ops-grid--eq an-reports">
        ${card('By problem type', barChart({ id: 'an-types', label: 'Resident reports by problem type', bars: typeCounts.map((b) => ({ ...b, color: '#1E3A5F', showValue: true })), h: 220 }))}
        ${card('By barangay', barChart({ id: 'an-zones', label: 'Resident reports by barangay', bars: zoneCounts.map((b) => ({ ...b, showValue: true })), h: 220 }))}
      </div>
      <div class="an-sec"><div><h2>Incident response</h2><p>How quickly incidents get a work order and are resolved</p></div></div>
      ${card(
        '',
        table(
          [
            { label: 'Incident', render: (i) => `<strong class="mono">${i.id}</strong> ${esc(i.title)}` },
            { label: 'Status', render: incStatus },
            { label: 'Time to work order', render: (i) => { const w = s.workOrders.find((x) => i.workOrderIds.includes(x.id)); return w ? `${Math.max(1, Math.round((w.createdAt - i.detectedAt) / 60000))} min` : '—'; } },
            { label: 'Time to resolve', render: (i) => (i.resolvedAt ? `${fmt((i.resolvedAt - i.detectedAt) / 3600000, 1)} h` : '—') },
            { label: 'Reports', num: true, render: (i) => i.reportIds.length },
          ],
          s.incidents
        )
      )}`;
  },
};

const notifications = { title: 'Notifications', render: () => notificationsView('provider') };

export const providerViews = {
  overview,
  operations,
  ...incidentViews,
  ...forecastViews,
  ...safetyViews,
  ...leakViews,
  advisories,
  assets,
  'assets/:id': assetDetail,
  analytics,
  notifications,
};
