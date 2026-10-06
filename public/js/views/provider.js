// Provider portal: overview dashboard, operations, advisories, assets, maintenance, analytics.
import * as S from '../store.js';
import { ZONES, zoneById, UTILITY, reportTypeLabel, REPORT_TYPES } from '../data.js';
import { icon, status, src, card, kpi, empty, tabs, table, field, openModal, closeOverlay, register, registerInputs, formData, updatedAgo, priorityBadge, sevBadge, alertBanner, SEV, confirmDialog } from '../ui.js';
import { lineChart, barChart, sparkline, gaugeBar } from '../charts.js';
import { renderMap, DEFAULT_LAYERS, assetLiveStatus } from '../map.js';
import { esc, fmt, fmtL, fmtTime, fmtDate, fmtDateShort, fmtDateTime, relTime, hoursLabel, toLocalInput, fromLocalInput } from '../util.js';
import { notificationsView, go } from '../app.js';
import { incidentViews } from './provider-incidents.js';
import { forecastViews } from './provider-forecast.js';
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
  const lvlSev = lvl < 0.3 ? 'critical' : lvl < 0.42 ? 'warning' : 'normal';
  const resSev = t.reserveHours < 10 ? 'critical' : t.reserveHours < 14 ? 'warning' : 'normal';
  const net = t.production + t.transfer - t.demand;
  const flag = { normal: 'Within range', warning: 'Monitor closely', critical: 'Action required' };
  const highSev = open.filter((i) => i.severity === 'High' || i.severity === 'Critical').length;
  return `<div class="kgrid">
    <section class="kp-primary">
      <a class="kpi-link" href="#/p/operations" aria-label="Open storage and supply monitoring"></a>
      <div class="kpi-top"><span class="kpi-label">Central Reservoir Storage</span>${src('SIMULATED')}</div>
      <div class="kp-main">
        <div><div class="kpi-value kpi-value--xl">${fmt(t.volML, 2)}<span class="kpi-unit">ML</span></div>
        <div class="kpi-sub">${pct(lvl)} of 2.0 ML capacity · minimum reserve 30%</div></div>
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
    return `<div class="page-h"><div><h1>Water Operations</h1><p class="page-sub">${esc(UTILITY.name)} · ${esc(UTILITY.municipality)}</p></div></div>
      <div data-region="status">${ovStatus()}</div>
      <div data-region="kpis">${ovKpis()}</div>
      <section class="card ov-map"><header class="card-h"><div><h2 class="card-t">Service Area Map</h2><p class="card-sub">Catbalogan City, Samar · hover for live readings, click for details, scroll or pinch to zoom</p></div></header><div class="card-b card-b--flush">${renderMap({ mode: 'provider', id: 'lm-overview', layers: mapLayers })}</div></section>
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
const levelSev = (lv) => (lv < 0.3 ? 'critical' : lv < 0.42 ? 'warning' : 'normal');
const OPS_INK = '#1E3A5F';
const OPS_SLATE = '#8A9BB0';

function opsStrip() {
  const s = st();
  const t = s.tele;
  const lvl = t.volML / S.RES_CAP_ML;
  const net = t.production + t.transfer - t.demand;
  const cell = (label, tag, value, sub, sev) => `<div class="ops-cell"><div class="ops-cell-h"><span>${label}</span>${src(tag)}</div><div class="ops-cell-v">${sev ? `<span class="sys-dot sys-dot--${SEV[sev].cls}" aria-hidden="true"></span>` : ''}${value}</div><div class="ops-cell-s">${sub}</div></div>`;
  return `<div class="ops-strip">
    ${cell('Reservoir level', 'SIMULATED', pct(lvl), `${fmtL(t.volML * 1e6)} of 2,000,000 L`, levelSev(lvl))}
    ${cell('Production', 'SIMULATED', `${fmt(t.production + t.transfer, 2)}<small>ML/day</small>`, t.transfer ? `incl. ${fmt(t.transfer, 2)} from backup` : `Capacity ${fmt(S.productionCapacity(), 2)} ML/day`)}
    ${cell('Demand', 'ESTIMATED', `${fmt(t.demand, 2)}<small>ML/day</small>`, `incl. ${fmt(S.leakLoss(), 2)} ML/day est. losses`)}
    ${cell('Net balance', 'ESTIMATED', `${net >= 0 ? '+' : '−'}${fmt(Math.abs(net), 2)}<small>ML/day</small>`, net >= 0 ? 'Storage stable or filling' : 'Storage drawing down', net < -0.2 ? 'warning' : null)}
    ${cell('Reserve', 'ESTIMATED', `${fmt(t.reserveHours, 0)}<small>hours</small>`, 'All storage at current demand', t.reserveHours < 10 ? 'critical' : t.reserveHours < 14 ? 'warning' : null)}
  </div>`;
}

function opsReservoir() {
  const s = st();
  const t = s.tele;
  const lvl = t.volML / S.RES_CAP_ML;
  const sev = levelSev(lvl);
  const usable = Math.max(0, t.volML - S.MIN_RESERVE * S.RES_CAP_ML);
  const lv = every(s.history.level, 3).map((v) => v * 100);
  const n = lv.length;
  return `<div class="ops-res">
      <div class="ops-tank" aria-hidden="true"><div class="ops-tank-fill" style="height:${lvl * 100}%"></div><i class="ops-tank-min" style="bottom:30%"></i><span>${pct(lvl)}</span></div>
      <dl class="kv kv--3 ops-res-kv">
        <div><dt>Status</dt><dd>${dstat(sev, SEV[sev].label)}</dd></div>
        <div><dt>Current volume</dt><dd>${fmtL(t.volML * 1e6)}</dd></div>
        <div><dt>Capacity</dt><dd>2,000,000 L ${src('MANUAL')}</dd></div>
        <div><dt title="Volume above the 30% minimum reserve">Usable storage</dt><dd>${fmtL(usable * 1e6)}</dd></div>
        <div><dt>Inflow</dt><dd>${fmt(S.mlToLs(t.production + t.transfer), 0)} L/s</dd></div>
        <div><dt>Outflow</dt><dd>${fmt(S.mlToLs(t.demand), 0)} L/s</dd></div>
      </dl>
    </div>
    ${lineChart({ id: 'ops-level', label: 'Central Reservoir level, last 24 hours', series: [{ name: 'Reservoir level', color: OPS_INK, values: lv, area: true, endLabel: true }], labels: lv.map((_, i) => `${(((i - n + 1) * 15) / 60).toFixed(1)} h`), xTicks: hoursTicks(n), thresholds: [{ y: 30, label: 'Minimum reserve 30%', color: '#C0262D' }], yMin: 0, yMax: 100, yFmt: (v) => `${Math.round(v)}%`, h: 210 })}
    <div class="chart-cap">Level, last 24 hours · updated ${updatedAgo(t.lastUpdate)}</div>`;
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
    <div class="chart-cap">Production ${src('SIMULATED')} · Demand ${src('ESTIMATED')}</div>`;
}

function opsTanks() {
  const s = st();
  return table(
    [
      { label: 'Tank', render: (r) => `<div class="it-t">${esc(r.a.name)}</div><div class="it-s">${r.id} · ${esc(zoneById(r.a.zone).name)}</div>` },
      { label: 'Level', render: (r) => `<div class="ops-lv">${meter(r.tk.level * 100)}<span>${pct(r.tk.level)}</span></div>` },
      { label: 'Volume', num: true, render: (r) => `${fmtL(r.tk.volL)}<div class="it-s">of ${fmtL(r.tk.capL)}</div>` },
      { label: 'Status', render: (r) => dstat(r.tk.status, SEV[r.tk.status].label) },
    ],
    Object.entries(s.tele.tanks).map(([id, tk]) => ({ id, tk, a: s.assets.find((x) => x.id === id) }))
  );
}

function opsPumps() {
  const s = st();
  return table(
    [
      { label: 'Pump station', render: (r) => `<div class="it-t">${esc(r.name)}</div><div class="it-s">${r.id} · ${esc(r.p.units)}</div>` },
      { label: 'Status', render: (r) => dstat(r.p.status === 'offline' ? 'critical' : 'normal', r.p.status === 'offline' ? 'Failure' : 'Running') },
      { label: 'Flow', num: true, render: (r) => `${fmt(r.p.flowLs, 1)} L/s` },
      { label: 'Vibration', num: true, render: (r) => (r.p.vibration > 7 ? `<span class="txt-warn">${fmt(r.p.vibration, 1)} mm/s</span>` : `${fmt(r.p.vibration, 1)} mm/s`) },
      { label: 'Power', num: true, render: (r) => `${fmt(r.p.powerKw, 1)} kW` },
    ],
    Object.entries(s.tele.pumps).map(([id, p]) => ({ id, p, name: s.assets.find((a) => a.id === id).name }))
  );
}

function opsZones() {
  const s = st();
  const zt = (z) => s.tele.zones[z.id];
  return table(
    [
      { label: 'Zone', render: (z) => `<div class="it-t">${esc(z.name)}</div><div class="it-s">${esc(z.barangays.join(', '))}</div>` },
      { label: 'Status', render: (z) => dstat(zt(z).status, zt(z).status === 'normal' ? 'Normal' : 'Low pressure') },
      { label: 'Pressure', num: true, render: (z) => `<strong>${fmt(zt(z).pressure, 0)}</strong> PSI<div class="it-s">normal ~${z.basePressure}</div>` },
      { label: 'Last 6 hours', render: (z) => sparkline(every(last(s.history.pressure[z.id], 72), 3), { color: OPS_INK, w: 120, h: 28, min: 0, max: 50 }) },
      { label: 'Flow', num: true, render: (z) => `${fmt(zt(z).flow, 1)} L/s` },
      { label: 'vs expected', num: true, render: (z) => `${zt(z).flowDeltaPct >= 0 ? '+' : '−'}${fmt(Math.abs(zt(z).flowDeltaPct), 0)}%` },
      { label: 'Connections', num: true, render: (z) => fmt(z.connections) },
    ],
    ZONES
  );
}

function opsEmergency() {
  const s = st();
  const backup = s.emergency;
  const rows = s.emergencyTanks.map((t) => ({ ...t, lv: t.volumeL / t.capacityL, sim: t.mode === 'SIMULATED' }));
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
    rows
  )}
  <div class="ops-backup"><div><span class="it-t">Antiao Backup Storage</span> ${src('MANUAL')}<div class="it-s">400,000 L standby supply. Releases up to 0.8 ML/day when production falls short (demo scenario “Emergency Supply Activated”).</div></div>
    <div class="ops-backup-v">${backup.active ? `${fmtL(backup.poolML * 1e6)} remaining · ${dstat('info', 'Supplying')}` : dstat('offline', 'Standby')}</div></div>`;
}

const operations = {
  title: 'Operations',
  regions: { strip: opsStrip, res: opsReservoir, supply: opsSupply, tanks: opsTanks, pumps: opsPumps, zones: opsZones, em: opsEmergency },
  render() {
    const R = this.regions;
    const tag = src('SIMULATED');
    return `<div class="page-h"><div><h1>Storage & Supply Monitoring</h1><p class="page-sub">Reservoir, tanks, production, demand, pumps, and distribution pressure · ${tag} values come from the SAMAR-AGOS IoT simulator, not real sensors.</p></div></div>
      <div data-region="strip">${R.strip()}</div>
      <div class="ops-grid ops-grid--eq">
        ${card('Central Reservoir', `<div data-region="res">${R.res()}</div>`, { sub: 'RES-01 · Zone C — Canlapwas', actions: tag })}
        ${card('Production vs demand', `<div data-region="supply">${R.supply()}</div>`, { sub: 'Last 24 hours', actions: tag })}
      </div>
      <div class="ops-grid ops-grid--eq">
        ${card('Distribution tanks', `<div data-region="tanks">${R.tanks()}</div>`, { actions: tag })}
        ${card('Pump stations', `<div data-region="pumps">${R.pumps()}</div>`, { actions: tag })}
      </div>
      ${card('Zone pressure & flow', `<div data-region="zones">${R.zones()}</div>`, { actions: tag })}
      ${card('Emergency water storage', `<div data-region="em">${R.em()}</div>`, { sub: 'Manual records and simulated smart-tank monitoring' })}`;
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
});

// ---------------------------------------------------------------- ADVISORIES
const advisories = {
  title: 'Advisories',
  render() {
    const s = st();
    const active = s.advisories.filter((a) => a.status === 'Active');
    const past = s.advisories.filter((a) => a.status !== 'Active');
    const advRow = (a) => `<article class="padv"><div class="padv-h">${status(a.status === 'Active' ? (a.kind === 'Water Quality' ? 'info' : 'warning') : 'normal', a.status === 'Active' ? a.serviceStatus : 'Resolved')}<span class="mono muted sm">${a.id}</span>${a.incidentId ? `<a class="mono sm" href="#/p/incidents/${a.incidentId}">${a.incidentId}</a>` : ''}</div>
      <h3>${esc(a.title)}</h3><p>${esc(a.message)}</p>
      <dl class="kv kv--4"><div><dt>Areas</dt><dd>${a.areas.map((z) => zoneById(z).short).join(', ')}</dd></div><div><dt>Started</dt><dd>${fmtDateTime(a.startAt)}</dd></div><div><dt>Last update</dt><dd>${relTime(a.updatedAt)}</dd></div><div><dt>${a.etr ? 'Est. restoration' : 'Next update'}</dt><dd>${a.etr ? fmtTime(a.etr) : a.nextUpdate ? fmtTime(a.nextUpdate) : '—'}</dd></div></dl>
      ${a.status === 'Active' ? `<div class="padv-a"><button class="btn btn--outline btn--xs" data-action="adv-update" data-id="${a.id}">Post update</button><button class="btn btn--ghost btn--xs" data-action="adv-close" data-id="${a.id}">Mark resolved</button></div>` : ''}</article>`;
    return `<div class="page-h"><div><h1>Advisories</h1><p class="page-sub">Public service notices sent to residents in affected zones.</p></div><div class="page-a"><button class="btn btn--primary btn--sm" data-action="adv-new">${icon('plus', 15)} New advisory</button></div></div>
      <div class="adv-grid"><div>
        <h2 class="sec-t">Active (${active.length})</h2>${active.length ? active.map(advRow).join('') : empty('No active advisories', '', 'megaphone')}
        <h2 class="sec-t">Resolved</h2>${past.map(advRow).join('') || empty('None', '', 'archive')}
      </div>
      <div>${card(
        'Alternative water points',
        `<p class="fine">Residents only see information you confirm here.</p>${s.altWater
          .map(
            (p) => `<div class="awp"><div><strong>${esc(p.name)}</strong><span class="muted sm">${esc(zoneById(p.zone).short)} · ${esc(p.hours)} · confirmed ${relTime(p.confirmedAt)}</span></div>
          <div class="awp-a"><label class="sr-only" for="awp-${p.id}">Status for ${esc(p.name)}</label><select id="awp-${p.id}" data-change="awp-status" data-id="${p.id}">${['AVAILABLE', 'LIMITED', 'SCHEDULED', 'CLOSED'].map((x) => `<option ${x === p.status ? 'selected' : ''}>${x}</option>`).join('')}</select><button class="btn btn--outline btn--xs" data-action="awp-confirm" data-id="${p.id}">Confirm now</button></div></div>`
          )
          .join('')}`,
        { sub: 'Distribution points shown in the resident portal' }
      )}</div></div>`;
  },
};

registerInputs({ 'awp-status': (el) => S.confirmAltWater(el.dataset.id, { status: el.value }) });
register({
  'awp-confirm': (el) => S.confirmAltWater(el.dataset.id, {}),
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
let assetType = 'All';
let assetQ = '';
const conditionBadge = (c) => status({ Good: 'normal', Fair: 'warning', Poor: 'critical', Unknown: 'offline' }[c] || 'offline', c);
const assets = {
  title: 'Assets',
  regions: {
    tbl() {
      const s = st();
      const list = s.assets.filter((a) => (assetType === 'All' || a.type === assetType) && (!assetQ || `${a.id} ${a.name}`.toLowerCase().includes(assetQ.toLowerCase())));
      return table(
        [
          { label: 'Asset ID', render: (a) => `<strong class="mono">${a.id}</strong>` },
          { label: 'Name', render: (a) => esc(a.name) },
          { label: 'Type', render: (a) => esc(a.type) },
          { label: 'Location', render: (a) => esc(zoneById(a.zone)?.name || '—') },
          { label: 'Operational status', render: (a) => status(assetLiveStatus(a, s), SEV[assetLiveStatus(a, s)].label) },
          { label: 'Condition', render: (a) => conditionBadge(a.condition) },
          { label: 'Next maintenance', render: (a) => `<span class="${a.nextMaint < Date.now() ? 'txt-warn' : ''}">${fmtDate(a.nextMaint)}</span>` },
        ],
        list,
        { rowAction: { action: 'goto-asset', key: 'id' }, empty: 'No assets match' }
      );
    },
  },
  render() {
    const types = ['All', ...new Set(st().assets.map((a) => a.type))];
    return `<div class="page-h"><div><h1>Assets</h1><p class="page-sub">Operational status of water infrastructure.</p></div></div>
      <div class="filters"><div class="search">${icon('search', 16)}<label class="sr-only" for="as-q">Search assets</label><input id="as-q" placeholder="Search by ID or name" value="${esc(assetQ)}" data-input="asset-q"/></div>
      <div class="chips" role="group" aria-label="Filter by type">${types.map((t) => `<button class="chip-btn ${t === assetType ? 'is-on' : ''}" data-action="asset-type" data-t="${t}" aria-pressed="${t === assetType}">${t}</button>`).join('')}</div></div>
      ${card('', `<div data-region="tbl">${this.regions.tbl()}</div>`)}`;
  },
};
registerInputs({
  'asset-q': (el) => {
    assetQ = el.value;
    const r = document.querySelector('[data-region="tbl"]');
    if (r) r.innerHTML = assets.regions.tbl();
  },
});
register({
  'asset-type': (el) => ((assetType = el.dataset.t), go('#/p/assets')),
  'goto-asset': (el) => go(`#/p/assets/${el.dataset.id}`),
});

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
      else if (a.id === 'TS-E1') rows = `<div><dt>Turbidity</dt><dd><strong>${fmt(t.turbidityE, 1)} NTU</strong> ${src('SIMULATED')}</dd></div>`;
      else if (a.id === 'PT-B1') rows = `<div><dt>Pressure</dt><dd><strong>${fmt(t.zones.B.pressure, 0)} PSI</strong> ${src('SIMULATED')}</dd></div>`;
      return `<dl class="kv kv--3"><div><dt>Operational status</dt><dd>${status(sev, SEV[sev].label)}</dd></div>${rows}<div><dt>Last update</dt><dd>${a.status === 'offline' ? 'Not reporting' : relTime(t.lastUpdate)}</dd></div></dl>`;
    },
  },
  render({ id }) {
    const s = st();
    const a = s.assets.find((x) => x.id === id);
    if (!a) return empty('Asset not found', '', 'search');
    const wos = s.workOrders.filter((w) => w.assetId === a.id);
    return `<a class="back" href="#/p/assets">${icon('chev-l', 16)} Assets</a>
      <div class="page-h"><div><div class="mono muted">${a.id}</div><h1>${esc(a.name)}</h1><div class="inc-badges">${esc(a.type)} · ${esc(zoneById(a.zone)?.name || '')}</div></div><div class="page-a"><button class="btn btn--primary btn--sm" data-action="wo-new" data-asset="${a.id}">${icon('wrench', 15)} Create work order</button></div></div>
      <div class="inc-grid"><div class="inc-main">
        ${card('Live status', `<div data-region="live">${this.regions.live({ id })}</div>`)}
        ${card(
          'Asset information',
          `<dl class="kv kv--3"><div><dt>Asset ID</dt><dd class="mono">${a.id}</dd></div><div><dt>Type</dt><dd>${esc(a.type)}</dd></div><div><dt>Location</dt><dd>${esc(zoneById(a.zone)?.name || '—')}</dd></div><div><dt>Condition</dt><dd>${conditionBadge(a.condition)} ${src('MANUAL')}</dd></div><div><dt>Last maintenance</dt><dd>${fmtDate(a.lastMaint)}</dd></div><div><dt>Next maintenance</dt><dd class="${a.nextMaint < Date.now() ? 'txt-warn' : ''}">${fmtDate(a.nextMaint)}${a.nextMaint < Date.now() ? ' (overdue)' : ''}</dd></div>${a.spec ? `<div class="kv-wide"><dt>Specification</dt><dd>${esc(a.spec)}</dd></div>` : ''}</dl>`
        )}
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

// ---------------------------------------------------------------- MAINTENANCE
const maintenance = {
  title: 'Maintenance',
  render() {
    const s = st();
    const now = Date.now();
    const rows = s.assets
      .map((a) => ({ ...a, due: a.nextMaint - now, wo: s.workOrders.find((w) => w.assetId === a.id && w.status !== 'Completed') }))
      .sort((a, b) => a.due - b.due);
    const overdue = rows.filter((r) => r.due < 0);
    const soon = rows.filter((r) => r.due >= 0 && r.due < 14 * 864e5);
    const prev = s.workOrders.filter((w) => !w.incidentId);
    const recent = s.workOrders.filter((w) => w.status === 'Completed').sort((a, b) => b.completion.at - a.completion.at).slice(0, 5);
    const stateOf = (r) => (r.due < 0 ? status('warning', 'Overdue') : r.due < 14 * 864e5 ? status('info', 'Due soon') : status('normal', 'Scheduled'));
    return `<div class="page-h"><div><h1>Maintenance</h1><p class="page-sub">Preventive maintenance schedule and recent field activity.</p></div></div>
      <div class="kpis kpis--3">${kpi({ label: 'Overdue maintenance', value: overdue.length, sub: 'assets past due date', sev: overdue.length ? 'warning' : null })}${kpi({ label: 'Due in 14 days', value: soon.length, sub: 'assets' })}${kpi({ label: 'Preventive work orders open', value: prev.filter((w) => w.status !== 'Completed').length, sub: 'not linked to incidents' })}</div>
      ${card(
        'Maintenance schedule',
        table(
          [
            { label: 'Asset', render: (r) => `<strong class="mono">${r.id}</strong> ${esc(r.name)}` },
            { label: 'Type', render: (r) => esc(r.type) },
            { label: 'Last maintenance', render: (r) => fmtDate(r.lastMaint) },
            { label: 'Next due', render: (r) => fmtDate(r.nextMaint) },
            { label: 'State', render: stateOf },
            { label: 'Work order', render: (r) => (r.wo ? `<a class="mono" href="#/p/work-orders/${r.wo.id}">${r.wo.id}</a> <span class="muted sm">${r.wo.status}</span>` : `<button class="btn btn--outline btn--xs" data-action="wo-new" data-asset="${r.id}" data-pri="Low" data-desc="Scheduled preventive maintenance for ${esc(r.name)}.">Schedule</button>`) },
          ],
          rows.slice(0, 14)
        )
      )}
      ${card('Recently completed', table([{ label: 'Work order', render: (w) => `<strong class="mono">${w.id}</strong>` }, { label: 'Asset', render: (w) => `<span class="mono">${w.assetId}</span>` }, { label: 'Completed', render: (w) => fmtDateTime(w.completion.at) }, { label: 'Notes', render: (w) => esc(w.completion.notes) }], recent, { rowAction: { action: 'goto-wo', key: 'id' }, empty: 'None yet' }))}`;
  },
};

// ---------------------------------------------------------------- ANALYTICS
const analytics = {
  title: 'Analytics',
  regions: {
    pressure() {
      const h = st().history;
      const n = every(h.pressure.A, 3).length;
      return lineChart({ id: 'an-press', label: 'Pressure by zone, last 24 hours', series: ZONES.map((z) => ({ name: z.short, color: ZONE_COLORS[z.id], values: every(h.pressure[z.id], 3), endLabel: true })), labels: Array.from({ length: n }, (_, i) => `${(((i - n + 1) * 15) / 60).toFixed(1)} h`), xTicks: hoursTicks(n), thresholds: [{ y: 26, label: 'Low-pressure alarm', color: '#D97706' }], yMin: 0, yFmt: (v) => `${Math.round(v)} PSI`, h: 240 });
    },
  },
  render() {
    const s = st();
    const typeCounts = REPORT_TYPES.map((t) => ({ label: t.label.replace('Unusual ', ''), value: s.reports.filter((r) => r.type === t.id).length })).filter((b) => b.value);
    const zoneCounts = ZONES.map((z) => ({ label: z.short, value: s.reports.filter((r) => r.zone === z.id).length, color: '#1D6FB8' }));
    const verified = s.reports.filter((r) => r.residentResponse);
    const restored = verified.filter((r) => r.residentResponse.restored).length;
    const linked = s.reports.filter((r) => r.incidentId).length;
    const nrw = (S.leakLoss() / S.getState().tele.demand) * 100;
    return `<div class="page-h"><div><h1>Analytics</h1><p class="page-sub">Service performance indicators from operational and resident data.</p></div></div>
      <div class="kpis kpis--4">
        ${kpi({ label: 'Resident reports (all)', value: s.reports.length, sub: `${linked} linked to incidents`, source: 'RESIDENT REPORTED' })}
        ${kpi({ label: 'Report-to-incident link rate', value: Math.round((linked / Math.max(1, s.reports.length)) * 100), unit: '%', sub: 'reports used as evidence' })}
        ${kpi({ label: 'Resident-verified restorations', value: verified.length ? `${restored}/${verified.length}` : '—', sub: 'confirmed restored / responses', source: 'RESIDENT REPORTED' })}
        ${kpi({ label: 'Estimated losses (NRW)', value: fmt(nrw, 1), unit: '%', sub: 'of current demand', source: 'ESTIMATED', sev: nrw > 15 ? 'warning' : null })}
      </div>
      ${card('Pressure by zone', `<div data-region="pressure">${this.regions.pressure()}</div>`, { sub: 'Last 24 simulated hours · SIMULATED telemetry' })}
      <div class="ops-grid">
        ${card('Reports by problem type', barChart({ id: 'an-types', label: 'Resident reports by problem type', bars: typeCounts.map((b) => ({ ...b, color: '#1D6FB8', showValue: true })), h: 220 }))}
        ${card('Reports by zone', barChart({ id: 'an-zones', label: 'Resident reports by zone', bars: zoneCounts.map((b) => ({ ...b, showValue: true })), h: 220 }))}
      </div>
      ${card(
        'Incident response',
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
  advisories,
  assets,
  'assets/:id': assetDetail,
  maintenance,
  analytics,
  notifications,
};
