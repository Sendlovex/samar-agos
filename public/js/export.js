// Operator data export: each page offers its lists, data tables and graphs for a date range,
// as an Excel workbook (one sheet per item) or a printable PDF report.
import * as S from './store.js';
import * as B from './backend.js';
import { ZONES, SERVICE_ZONES, zoneById, reportTypeLabel, UTILITY, PROVIDER_USER } from './data.js';
import { register, registerInputs, showToast, busy } from './ui.js';
import { lineChart, barChart } from './charts.js';
import { esc, fmtDateTime } from './util.js';
import { maintenanceNeed } from './views/provider-incidents.js';
import { analyse as leakAnalysis } from './views/provider-leaks.js';

const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const st = () => S.getState();
const r1 = (v, d = 1) => (v == null || Number.isNaN(v) ? '' : Math.round(v * 10 ** d) / 10 ** d);
const when = (ts) => (ts ? fmtDateTime(ts) : '');
const inRange = (ts, r) => ts != null && ts >= r.from && ts <= r.to;
const zoneName = (id) => zoneById(id)?.short || id || '';

// ---------------------------------------------------------------- date ranges
const RANGES = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'year', label: 'This year' },
  { id: 'custom', label: 'Custom dates' },
];
function rangeOf(id, fromStr, toStr) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (id === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // Monday
  if (id === 'month') start.setDate(1);
  if (id === 'year') start.setMonth(0, 1);
  if (id === 'custom') {
    const f = fromStr ? new Date(`${fromStr}T00:00:00`) : null;
    const t = toStr ? new Date(`${toStr}T23:59:59`) : null;
    if (!f || !t || Number.isNaN(+f) || Number.isNaN(+t)) return { error: 'Choose both a start date and an end date.' };
    if (f > t) return { error: 'The start date must be on or before the end date.' };
    return { from: +f, to: +t, label: `${f.toLocaleDateString('en-PH', { dateStyle: 'medium' })} to ${t.toLocaleDateString('en-PH', { dateStyle: 'medium' })}`, slug: `${fromStr}_to_${toStr}` };
  }
  const label = RANGES.find((r) => r.id === id).label;
  return { from: +start, to: +now, label: `${label} (${start.toLocaleDateString('en-PH', { dateStyle: 'medium' })} to ${now.toLocaleDateString('en-PH', { dateStyle: 'medium' })})`, slug: label.toLowerCase().replace(/\s+/g, '-') };
}

// ---------------------------------------------------------------- shared sections
// A section returns { cols, rows } (and a chart for graphs). Simulated readings cover the latest 24 hours.
const history = (step = 3) => {
  const h = st().history;
  const idx = h.t.map((_, i) => i).filter((i) => (h.t.length - 1 - i) % step === 0);
  return { h, idx, labels: idx.map((i) => new Date(h.t[i]).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })) };
};
const ticks = (n) => [0, Math.round(n / 2), n - 1].map((i, k) => ({ i, label: ['-24 h', '-12 h', 'Now'][k] }));
const SIM_NOTE = 'Simulated readings, latest 24 hours on the simulator clock';

const sec = {
  storageGraph: { id: 'storage', label: 'Reservoir level, last 24 hours', kind: 'Graph', note: SIM_NOTE,
    rows: () => { const { h, idx } = history(); return { cols: ['Simulated time', 'Reservoir level (%)', 'Stored (m³)'], rows: idx.map((i) => [when(h.t[i]), r1(h.level[i] * 100), r1(h.level[i] * S.RES_CAP_ML * 1000, 0)]) }; },
    chart: () => { const { h, idx, labels } = history(); return lineChart({ id: 'ex-storage', w: 680, h: 220, label: 'Reservoir level', series: [{ name: 'Reservoir level', color: '#1E3A5F', values: idx.map((i) => h.level[i] * 100), area: true }], labels, xTicks: ticks(idx.length), yMin: 0, yMax: 100, yFmt: (v) => `${Math.round(v)}%` }); } },
  supplyGraph: { id: 'supply', label: 'Production and consumption, last 24 hours', kind: 'Graph', note: SIM_NOTE,
    rows: () => { const { h, idx } = history(); return { cols: ['Simulated time', 'Production (ML/day)', 'Consumption (ML/day)'], rows: idx.map((i) => [when(h.t[i]), r1(h.prod[i], 2), r1(h.demand[i], 2)]) }; },
    chart: () => { const { h, idx, labels } = history(); return lineChart({ id: 'ex-supply', w: 680, h: 220, label: 'Production and consumption', legend: true, series: [{ name: 'Production', color: '#1E3A5F', values: idx.map((i) => h.prod[i]) }, { name: 'Consumption', color: '#7A93B5', values: idx.map((i) => h.demand[i]), dash: true }], labels, xTicks: ticks(idx.length), yMin: 0, yFmt: (v) => v.toFixed(1) }); } },
  pressureHistory: { id: 'pressure-24h', label: 'Pressure by barangay, last 24 hours', kind: 'Data', note: SIM_NOTE,
    rows: () => { const { h, idx } = history(6); return { cols: ['Simulated time', ...ZONES.map((z) => `${z.short} (PSI)`)], rows: idx.map((i) => [when(h.t[i]), ...ZONES.map((z) => r1(h.pressure[z.id][i], 0))]) }; } },
  zoneReadings: { id: 'zones', label: 'Barangay readings now', kind: 'Data', note: 'Simulated readings',
    rows: () => ({ cols: ['Barangay', 'Service zone', 'Pressure (PSI)', 'Normal (PSI)', 'Flow (L/s)', 'Flow vs expected (%)', 'Status'], rows: ZONES.map((z) => { const t = st().tele.zones[z.id]; return [z.short, SERVICE_ZONES.find((g) => g.id === z.group)?.name || '', r1(t.pressure, 0), z.basePressure, r1(t.flow), r1(t.flowDeltaPct, 0), t.status === 'normal' ? 'Normal' : 'Below normal']; }) }) },
  pressureGraph: { id: 'pressure-now', label: 'Pressure by barangay now', kind: 'Graph', note: 'Simulated readings',
    rows: () => ({ cols: ['Barangay', 'Pressure (PSI)'], rows: ZONES.map((z) => [z.short, r1(st().tele.zones[z.id].pressure, 0)]) }),
    chart: () => barChart({ id: 'ex-pz', w: 680, h: 240, label: 'Pressure by barangay', bars: ZONES.map((z) => ({ label: z.short, value: Math.round(st().tele.zones[z.id].pressure), color: '#1E3A5F' })), yFmt: (v) => Math.round(v) }) },
  alerts: { id: 'alerts', label: 'Active alerts', kind: 'List',
    rows: () => ({ cols: ['Severity', 'Category', 'Alert', 'Details'], rows: S.deriveAlerts().map((a) => [a.sev, a.cat, a.title, a.detail || '']) }) },
  status: { id: 'status', label: 'System status', kind: 'Data',
    rows: () => ({ cols: ['Area', 'Status', 'Details'], rows: S.subsystemStatus().map((x) => [x.label, x.sev, x.text]) }) },
  incidents: { id: 'incidents', label: 'Incidents', kind: 'List', dated: true,
    rows: (r) => ({ cols: ['Incident', 'Title', 'Type', 'Severity', 'Status', 'Barangay', 'Detected', 'Resolved', 'Connections', 'Reports', 'Work orders'], rows: st().incidents.filter((i) => inRange(i.detectedAt, r)).map((i) => [i.id, i.title, i.type, i.severity, i.status, zoneName(i.zone), when(i.detectedAt), when(i.resolvedAt), i.connections, i.reportIds?.length || 0, (i.workOrderIds || []).join(', ')]) }) },
  reports: { id: 'reports', label: 'Resident reports', kind: 'List', dated: true,
    rows: (r) => ({ cols: ['Report', 'Problem', 'Barangay', 'Location', 'Submitted', 'Status', 'Incident'], rows: st().reports.filter((x) => inRange(x.submittedAt, r)).map((x) => [x.id, reportTypeLabel(x.type), x.barangay || zoneName(x.zone), x.location || '', when(x.submittedAt), x.status, x.incidentId || '']) }) },
  reportsGraph: { id: 'reports-by-brgy', label: 'Reports by barangay', kind: 'Graph', dated: true,
    rows: (r) => { const c = countBy(st().reports.filter((x) => inRange(x.submittedAt, r)), (x) => zoneName(x.zone)); return { cols: ['Barangay', 'Reports'], rows: c }; },
    chart: (r) => barChart({ id: 'ex-rep', w: 680, h: 240, label: 'Reports by barangay', bars: countBy(st().reports.filter((x) => inRange(x.submittedAt, r)), (x) => zoneName(x.zone)).map(([label, value]) => ({ label, value, color: '#1E3A5F', showValue: true })) }) },
  workOrders: { id: 'work-orders', label: 'Work orders', kind: 'List', dated: true,
    rows: (r) => ({ cols: ['Work order', 'Task', 'Asset', 'Location', 'Priority', 'Status', 'Assigned to', 'Created', 'Target', 'Completed', 'Incident'], rows: st().workOrders.filter((w) => inRange(w.createdAt, r)).map((w) => [w.id, w.description, w.assetId, w.location, w.priority, w.status, w.team || '', when(w.createdAt), when(w.target), when(w.completion?.at), w.incidentId || '']) }) },
  woGraph: { id: 'wo-status', label: 'Work orders by status', kind: 'Graph', dated: true,
    rows: (r) => ({ cols: ['Status', 'Work orders'], rows: countBy(st().workOrders.filter((w) => inRange(w.createdAt, r)), (w) => w.status) }),
    chart: (r) => barChart({ id: 'ex-wo', w: 680, h: 220, label: 'Work orders by status', bars: countBy(st().workOrders.filter((w) => inRange(w.createdAt, r)), (w) => w.status).map(([label, value]) => ({ label, value, color: '#1E3A5F', showValue: true })) }) },
  maintenance: { id: 'maintenance', label: 'Assets needing maintenance', kind: 'List',
    rows: () => ({ cols: ['Asset', 'Name', 'Type', 'Age (years)', 'State', 'Reasons', 'Open work order'], rows: st().assets.map((a) => [a, maintenanceNeed(a, st().workOrders)]).filter(([, n]) => n).map(([a, n]) => [a.id, a.name, a.type, n.age ?? '', n.level === 2 ? 'Overdue' : 'Due', n.reasons.join('; '), n.wo?.id || '']) }) },
  responders: { id: 'responders', label: 'Responders', kind: 'List',
    rows: () => ({ cols: ['Name', 'Sign-in email', 'Contact email', 'Mobile', 'Open jobs', 'Credentials sent'], rows: S.responders().map((x) => [x.name, x.loginEmail, x.contactEmail, x.phone || '', st().workOrders.filter((w) => w.responder === x.loginEmail && w.status !== 'Completed').length, x.credSent ? when(x.sentAt) : 'Not yet']) }) },
  advisories: { id: 'advisories', label: 'Advisories', kind: 'List', dated: true,
    rows: (r) => ({ cols: ['Advisory', 'Title', 'Service status', 'Status', 'Barangays', 'Started', 'Last update', 'Est. restoration', 'Message'], rows: st().advisories.filter((a) => inRange(a.startAt, r) || inRange(a.updatedAt, r)).map((a) => [a.id, a.title, a.serviceStatus, a.status, (a.barangays?.length ? a.barangays : (a.areas || []).map(zoneName)).join(', '), when(a.startAt), when(a.updatedAt), when(a.etr), a.message]) }) },
  altWater: { id: 'water-points', label: 'Water distribution points', kind: 'List',
    rows: () => ({ cols: ['Point', 'Name', 'Barangay', 'Status', 'Confirmed'], rows: st().altWater.map((p) => [p.id, p.name, zoneName(p.zone), p.status, when(p.confirmedAt)]) }) },
  assets: { id: 'assets', label: 'Asset registry', kind: 'List',
    rows: () => ({ cols: ['Asset', 'Name', 'Type', 'Site', 'Barangay', 'Installed', 'Status', 'Condition', 'Last serviced', 'Failures recorded'], rows: st().assets.map((a) => [a.id, a.name, a.type, a.site || '', zoneName(a.zone), a.installed || '', a.status, a.condition || '', when(a.lastMaint), (a.failures || []).length]) }) },
  failures: { id: 'failures', label: 'Failure history', kind: 'List', dated: true,
    rows: (r) => ({ cols: ['Date', 'Asset', 'Name', 'Failure'], rows: st().assets.flatMap((a) => (a.failures || []).filter((f) => inRange(f.at, r)).map((f) => [when(f.at), a.id, a.name, f.text])) }) },
};
function countBy(list, key) {
  const m = new Map();
  list.forEach((x) => m.set(key(x), (m.get(key(x)) || 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

// ---------------------------------------------------------------- page sections
const wqSections = () => {
  const ws = S.waterSafety();
  const params = S.WQ_PARAMS;
  return [
    { id: 'wq-now', label: 'Water quality readings now', kind: 'Data', note: 'Simulated readings',
      rows: () => ({ cols: ['Station', ...params.map((p) => `${p.short || p.label}${p.unit ? ` (${p.unit})` : ''}`), 'Status'], rows: ws.stations.map((s) => [s.name, ...s.params.map((p) => r1(p.value, p.d ?? 2)), s.sev]) }) },
    { id: 'wq-lab', label: 'Laboratory results', kind: 'Data',
      rows: () => ({ cols: ['Test', 'Result', 'Limit', 'Status', 'Sampled'], rows: ws.lab.map((p) => [p.label, p.value, p.max, p.sev, when(ws.labAt)]) }) },
    { id: 'wq-history', label: 'Water quality readings, last 12 hours', kind: 'Data', note: 'Simulated readings, latest 12 hours',
      rows: () => ({ cols: ['Simulated time', ...ws.stations.flatMap((s) => params.map((p) => `${s.name}: ${p.short || p.label}`))], rows: ws.hist.t.map((t, i) => [when(t), ...ws.stations.flatMap((s) => params.map((p) => r1(ws.hist[s.id][p.key][i], p.d ?? 2)))]).filter((_, i, a) => (a.length - 1 - i) % 6 === 0) }) },
    ...['cl', 'turb'].map((key) => {
      const p = params.find((x) => x.key === key);
      return { id: `wq-${key}`, label: `${p.short || p.label} trend, last 12 hours`, kind: 'Graph', note: 'Simulated readings',
        rows: () => ({ cols: ['Simulated time', ...ws.stations.map((s) => s.name)], rows: ws.hist.t.map((t, i) => [when(t), ...ws.stations.map((s) => r1(ws.hist[s.id][key][i], 2))]) }),
        chart: () => lineChart({ id: `ex-wq-${key}`, w: 680, h: 220, label: p.label, legend: true, series: ws.stations.map((s, k) => ({ name: s.name, color: ['#1E3A5F', '#5B7BA3', '#9AA6B4'][k], values: ws.hist[s.id][key] })), labels: ws.hist.t.map((t) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric' })), xTicks: [{ i: 0, label: '-12 h' }, { i: ws.hist.t.length - 1, label: 'Now' }], yMin: 0, yFmt: (v) => v.toFixed(1) }) };
    }),
  ];
};
const forecastSections = () => {
  const fc = S.forecast();
  return [
    { id: 'fc-storage', label: 'Storage forecast, next 48 hours', kind: 'Graph', note: 'Forecast',
      rows: () => ({ cols: ['Hours ahead', 'Time', 'Reservoir level (%)', 'Consumption (ML/day)'], rows: fc.pts.map((p) => [p.h, when(Date.now() + p.h * 3600e3), r1(p.pct * 100), r1(p.demand, 2)]) }),
      chart: () => lineChart({ id: 'ex-fc', w: 680, h: 220, label: 'Storage forecast', series: [{ name: 'Forecast level', color: '#1E3A5F', values: fc.pts.map((p) => p.pct * 100), area: true }], labels: fc.pts.map((p) => `+${p.h} h`), xTicks: [{ i: 0, label: 'Now' }, { i: fc.pts.length - 1, label: `+${fc.pts.at(-1).h} h` }], thresholds: [{ y: S.MIN_RESERVE * 100, label: 'Minimum reserve', color: '#B45309' }], yMin: 0, yMax: 100, yFmt: (v) => `${Math.round(v)}%` }) },
    { id: 'fc-summary', label: 'Forecast summary', kind: 'Data',
      rows: () => ({ cols: ['Measure', 'Value'], rows: [['Status', S.FORECAST_STATUS[fc.status]?.label || fc.status], ['Level now (%)', r1(fc.now * 100)], ['In 6 hours (%)', r1(fc.at6 * 100)], ['In 12 hours (%)', r1(fc.at12 * 100)], ['In 24 hours (%)', r1(fc.at24 * 100)], ['In 48 hours (%)', r1(fc.at48 * 100)], ['Lowest level (%)', r1(fc.minPct * 100)], ['Average consumption (ML/day)', r1(fc.avgDemand, 2)], ['Average production (ML/day)', r1(fc.avgProd, 2)]] }) },
    { id: 'fc-accuracy', label: 'Forecast accuracy', kind: 'Data',
      rows: () => ({ cols: ['Hours ahead', 'Samples', 'Average error (points)', '90% of errors within (points)', 'Consumption error (%)'], rows: S.forecastAccuracy().map((a) => [a.h, a.n, r1(a.mae, 1), r1(a.p90, 1), r1(a.mape, 1)]) }) },
    sec.supplyGraph,
  ];
};
const leakSections = () => {
  const L = leakAnalysis();
  return [
    { id: 'leak-suspects', label: 'Suspected leaks', kind: 'List',
      rows: () => ({ cols: ['Barangay', 'Confidence', 'Evidence', 'Estimated loss (ML/day)', 'Incident'], rows: L.suspects.map((x) => [x.z.short, x.confidence, x.evidence.join('; '), x.loss ?? '', x.inc?.id || '']) }) },
    { id: 'leak-pressure', label: 'Pressure drop by barangay', kind: 'Data', note: 'Simulated readings',
      rows: () => ({ cols: ['Barangay', 'Pressure (PSI)', 'Normal (PSI)', 'Drop (%)', 'Flow vs expected (%)', 'Pattern'], rows: L.pressure.map((p) => [p.z.short, r1(p.t.pressure, 0), p.z.basePressure, r1(p.drop, 0), r1(p.t.flowDeltaPct, 0), { leak: 'Leak pattern', supply: 'Supply drop', normal: 'Normal' }[p.sign]]) }) },
    { id: 'leak-tdr', label: 'TDR bi-wire cables', kind: 'Data',
      rows: () => ({ cols: ['Cable', 'Line', 'Barangay', 'Length (m)', 'Reading', 'Moisture at (m)'], rows: L.segments.map((g) => [g.id, g.name, zoneName(g.zone), g.lengthM, { dry: 'Dry', wet: 'Moisture detected', rain: 'Not reliable (heavy rain)' }[g.state], g.wetAt ?? '']) }) },
    { id: 'leak-graph', label: 'Pressure drop by barangay', kind: 'Graph', note: 'Simulated readings',
      rows: () => ({ cols: ['Barangay', 'Drop (%)'], rows: L.pressure.map((p) => [p.z.short, r1(p.drop, 0)]) }),
      chart: () => barChart({ id: 'ex-leak', w: 680, h: 240, label: 'Pressure drop', bars: L.pressure.map((p) => ({ label: p.z.short, value: Math.round(p.drop), color: '#1E3A5F' })), yFmt: (v) => `${Math.round(v)}%` }) },
  ];
};
const analyticsSections = () => {
  const zoneFlows = SERVICE_ZONES.map((g) => [`${g.name}, ${g.area}`, Math.round(ZONES.filter((z) => z.group === g.id).reduce((a, z) => a + (st().tele.zones[z.id]?.flow || 0), 0) * 86.4)]);
  return [
    { ...sec.supplyGraph, id: 'consumption', label: 'Consumption trend, last 24 hours' },
    { id: 'consumption-zone', label: 'Consumption by service zone', kind: 'Graph', note: 'Simulated, m³ per day at the current rate',
      rows: () => ({ cols: ['Service zone', 'Consumption (m³/day)'], rows: zoneFlows }),
      chart: () => barChart({ id: 'ex-cz', w: 680, h: 220, label: 'Consumption by service zone', bars: zoneFlows.map(([label, value]) => ({ label, value, color: '#1E3A5F', showValue: true })) }) },
    sec.pressureGraph,
    sec.zoneReadings,
    { id: 'meter-readings', label: 'Household meter readings', kind: 'List', dated: true, async: true,
      rows: async (r) => {
        const list = await B.readingsBetween?.(r).catch(() => null);
        const rows = (list || offlineReadings(r)).sort((a, b) => (a.month < b.month ? 1 : -1));
        return { cols: ['Month', 'Barangay', 'Household', 'Consumption (m³)', 'Recorded', 'Recorded by'], rows: rows.map((x) => [x.month, x.barangay, x.name || x.uid, x.m3, when(x.recordedAt), x.recordedBy || '']) };
      } },
  ];
};
function offlineReadings(r) {
  try {
    return JSON.parse(localStorage.getItem('samaragos.meterReadings') || '[]').filter((x) => inRange(x.recordedAt, r) || monthIn(x.month, r));
  } catch (e) {
    return [];
  }
}
const ym = (ts) => new Date(ts).toLocaleDateString('en-CA').slice(0, 7);
const monthIn = (m, r) => m && m >= ym(r.from) && m <= ym(r.to);

const PAGES = {
  overview: { title: 'Overview', sections: () => [sec.status, sec.alerts, sec.storageGraph, sec.zoneReadings, sec.incidents, sec.workOrders] },
  operations: { title: 'Operations', sections: () => [sec.storageGraph, sec.supplyGraph, sec.pressureGraph, sec.zoneReadings, sec.pressureHistory, { ...sec.assets, label: 'Assets and status' }] },
  'leak-detection': { title: 'Leak Detection', sections: leakSections },
  'water-safety': { title: 'Water Safety', sections: wqSections },
  forecast: { title: 'Forecast', sections: forecastSections },
  incidents: { title: 'Incidents', sections: () => [sec.incidents, sec.reports, sec.reportsGraph] },
  'work-orders': { title: 'Work Orders', sections: () => [sec.workOrders, sec.woGraph, sec.maintenance, sec.responders] },
  advisories: { title: 'Advisories', sections: () => [sec.advisories, sec.altWater] },
  assets: { title: 'Assets', sections: () => [sec.assets, sec.maintenance, sec.failures] },
  analytics: { title: 'Analytics', sections: analyticsSections },
};
export const canExport = (page) => !!PAGES[page];

// ---------------------------------------------------------------- modal
let ctx = null; // { page, range, format }
function body() {
  const p = PAGES[ctx.page];
  const secs = p.sections();
  const groups = ['List', 'Data', 'Graph'].map((k) => [k, secs.filter((x) => x.kind === k)]).filter(([, l]) => l.length);
  const groupLabel = { List: 'Lists', Data: 'Data tables', Graph: 'Graphs' };
  const today = new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD
  return `<form class="form ex" id="ex-form" onsubmit="return false">
    <section class="ex-sec"><h3>1. Date range</h3>
      <div class="ex-chips" role="radiogroup" aria-label="Date range">${RANGES.map((r) => `<button type="button" role="radio" aria-checked="${ctx.range === r.id}" class="ex-chip ${ctx.range === r.id ? 'is-on' : ''}" data-action="ex-range" data-id="${r.id}">${r.label}</button>`).join('')}</div>
      ${ctx.range === 'custom' ? `<div class="ex-dates"><label>From<input type="date" id="ex-from" max="${today}" value="${ctx.from || ''}"/></label><label>To<input type="date" id="ex-to" max="${today}" value="${ctx.to || today}"/></label></div>` : ''}
      <p class="ex-hint">Records such as incidents, reports and work orders are filtered by date. Current readings and simulated graphs cover their latest period only.</p>
    </section>
    <section class="ex-sec"><div class="ex-h"><h3>2. What to export</h3><label class="chk"><input type="checkbox" id="ex-all" data-change="ex-all" checked/> Select all</label></div>
      <div class="ex-groups">${groups.map(([k, l]) => `<div class="ex-g"><span class="ex-gl">${groupLabel[k]}</span>${l.map((x) => `<label class="chk"><input type="checkbox" class="ex-item" value="${x.id}" data-change="ex-item" checked/> <span>${esc(x.label)}${x.note ? `<small>${esc(x.note)}</small>` : ''}</span></label>`).join('')}</div>`).join('')}</div>
    </section>
    <section class="ex-sec"><h3>3. Format</h3>
      <div class="ex-fmt">
        <label class="ex-opt ${ctx.format === 'xlsx' ? 'is-on' : ''}"><input type="radio" name="ex-fmt" value="xlsx" ${ctx.format === 'xlsx' ? 'checked' : ''} data-change="ex-fmt"/><strong>Excel workbook (.xlsx)</strong><small>One sheet per item. Graphs are exported as their data.</small></label>
        <label class="ex-opt ${ctx.format === 'pdf' ? 'is-on' : ''}"><input type="radio" name="ex-fmt" value="pdf" ${ctx.format === 'pdf' ? 'checked' : ''} data-change="ex-fmt"/><strong>PDF report</strong><small>Tables and graphs, ready to print or save as PDF.</small></label>
      </div>
    </section>
    <div class="auth-err" role="alert" hidden></div>
    <div class="ex-a"><button type="button" class="btn btn--outline" data-action="ex-close">Cancel</button><button type="button" class="btn btn--primary" data-action="ex-run">Export</button></div>
  </form>`;
}
const paint = () => {
  const keep = [...document.querySelectorAll('.ex-item')].filter((x) => !x.checked).map((x) => x.value);
  const from = document.getElementById('ex-from')?.value;
  const to = document.getElementById('ex-to')?.value;
  if (from !== undefined) (ctx.from = from), (ctx.to = to);
  document.getElementById('ex-body').innerHTML = body();
  keep.forEach((v) => { const el = document.querySelector(`.ex-item[value="${v}"]`); if (el) el.checked = false; });
  syncAll();
};
const syncAll = () => {
  const items = [...document.querySelectorAll('.ex-item')];
  const all = document.getElementById('ex-all');
  if (all) (all.checked = items.every((x) => x.checked)), (all.indeterminate = !all.checked && items.some((x) => x.checked));
};

// The export panel opens as a dropdown under the Export button (not a centred dialog).
let pop = null;
let anchor = null;
export function closeExport() {
  pop?.remove();
  pop = null;
  anchor?.setAttribute('aria-expanded', 'false');
  anchor?.focus?.();
  anchor = null;
}
function place() {
  if (!pop || !anchor?.isConnected) return;
  const b = anchor.getBoundingClientRect();
  const w = Math.min(560, window.innerWidth - 32);
  const left = Math.max(16, Math.min(b.right - w, window.innerWidth - w - 16));
  Object.assign(pop.style, { width: `${w}px`, left: `${left + window.scrollX}px`, top: `${b.bottom + window.scrollY + 8}px` });
}
export function openExport(page, btn) {
  if (!PAGES[page]) return;
  if (pop && anchor === btn) return closeExport(); // second click closes it
  closeExport();
  ctx = { page, range: 'month', format: 'xlsx' };
  anchor = btn || null;
  pop = document.createElement('div');
  pop.className = 'ex-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', `Export ${PAGES[page].title}`);
  pop.innerHTML = `<div class="ex-pop-h"><strong>Export ${esc(PAGES[page].title)}</strong></div><div id="ex-body">${body()}</div>`;
  document.body.appendChild(pop);
  anchor?.setAttribute('aria-expanded', 'true');
  place();
  pop.querySelector('.ex-chip.is-on')?.focus();
}
// Close on outside click (ignoring clicks on content that was just re-drawn), Escape, or leaving the page.
document.addEventListener('click', (e) => {
  if (!pop || !e.target.isConnected || pop.contains(e.target) || e.target.closest('[data-action="export-open"]')) return;
  closeExport();
});
document.addEventListener('keydown', (e) => e.key === 'Escape' && pop && closeExport());
window.addEventListener('resize', place);
window.addEventListener('hashchange', () => pop && closeExport());

register({
  'ex-range': (el) => ((ctx.range = el.dataset.id), paint()),
  'ex-close': () => closeExport(),
  'ex-run': (el) => busy(el, run),
});
registerInputs({
  'ex-all': (el) => (document.querySelectorAll('.ex-item').forEach((x) => (x.checked = el.checked)), syncAll()),
  'ex-item': () => syncAll(),
  'ex-fmt': (el) => ((ctx.format = el.value), document.querySelectorAll('.ex-opt').forEach((o) => o.classList.toggle('is-on', o.querySelector('input').checked))),
});

// ---------------------------------------------------------------- run
async function run() {
  const err = document.querySelector('#ex-form .auth-err');
  const fail = (m) => ((err.hidden = false), (err.innerHTML = `<span>${esc(m)}</span>`));
  const range = rangeOf(ctx.range, document.getElementById('ex-from')?.value, document.getElementById('ex-to')?.value);
  if (range.error) return fail(range.error);
  const chosen = [...document.querySelectorAll('.ex-item:checked')].map((x) => x.value);
  if (!chosen.length) return fail('Choose at least one item to export.');
  const page = PAGES[ctx.page];
  const secs = page.sections().filter((x) => chosen.includes(x.id));
  const items = [];
  for (const x of secs) items.push({ ...x, data: await x.rows(range), svg: x.chart ? x.chart(range) : null });
  const meta = { page: page.title, range, by: B.getSession?.()?.email || PROVIDER_USER.name, at: Date.now() };
  const name = `SAMAR-AGOS_${page.title.replace(/\s+/g, '-')}_${range.slug}`;
  if (ctx.format === 'xlsx') await toExcel(items, meta, name);
  else toPdf(items, meta);
  closeExport();
  showToast({ msg: ctx.format === 'xlsx' ? `${name}.xlsx downloaded` : 'Report opened. Choose Save as PDF in the print dialog.', kind: 'success' });
}

let xlsxLoading = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  xlsxLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = XLSX_URL;
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => ((xlsxLoading = null), reject(new Error('Could not load the Excel library. Check your connection.')));
    document.head.appendChild(s);
  });
  return xlsxLoading;
}
async function toExcel(items, meta, name) {
  const X = await loadXlsx();
  const wb = X.utils.book_new();
  const about = [['SAMAR-AGOS export'], [], ['Utility', UTILITY.name], ['Page', meta.page], ['Date range', meta.range.label], ['Exported', when(meta.at)], ['Exported by', meta.by], [], ['Sheet', 'Contents', 'Rows', 'Note']];
  items.forEach((x, k) => about.push([`${k + 1}`, x.label, x.data.rows.length, x.note || '']));
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(about), 'About');
  const used = new Set(['About']);
  items.forEach((x, k) => {
    let sheet = `${k + 1} ${x.label}`.replace(/[\\/?*[\]:]/g, '').slice(0, 31);
    while (used.has(sheet)) sheet = `${sheet.slice(0, 28)}${k}`;
    used.add(sheet);
    const aoa = [x.data.cols, ...(x.data.rows.length ? x.data.rows : [[x.dated ? 'No records in this date range' : 'No records']])];
    const ws = X.utils.aoa_to_sheet(aoa);
    ws['!cols'] = x.data.cols.map((c, i) => ({ wch: Math.min(60, Math.max(String(c).length, ...x.data.rows.slice(0, 200).map((r) => String(r[i] ?? '').length)) + 2) }));
    X.utils.book_append_sheet(wb, ws, sheet);
  });
  X.writeFile(wb, `${name}.xlsx`);
}

function toPdf(items, meta) {
  const table = (d, dated) => (d.rows.length ? `<table><thead><tr>${d.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${d.rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : `<p class="none">${dated ? 'No records in this date range.' : 'No records.'}</p>`);
  const font = document.querySelector('link[href*="fonts.googleapis"]')?.outerHTML || '';
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>SAMAR-AGOS ${esc(meta.page)} report</title>${font}<style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: 'Plus Jakarta Sans', Arial, sans-serif; color: #1c2a3a; font-size: 11px; }
    header { border-bottom: 2px solid #0b2545; padding-bottom: 10px; margin-bottom: 14px; }
    header .u { font-size: 11px; color: #6b7785; } header h1 { margin: 4px 0; font-size: 20px; color: #0b2545; }
    header dl { display: flex; gap: 22px; margin: 6px 0 0; } header dt { font-size: 9px; text-transform: uppercase; letter-spacing: .06em; color: #6b7785; } header dd { margin: 0; font-weight: 700; }
    section { margin: 0 0 18px; break-inside: avoid-page; } h2 { font-size: 13px; margin: 0 0 2px; color: #0b2545; } .note { margin: 0 0 6px; color: #6b7785; font-size: 10px; }
    table { width: 100%; border-collapse: collapse; } th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: #6b7785; border-bottom: 1px solid #cfd6de; padding: 5px 6px; }
    td { padding: 5px 6px; border-bottom: 1px solid #eef1f4; vertical-align: top; } tr { break-inside: avoid; }
    svg { width: 100%; height: auto; } svg text { font-family: inherit; } .none { color: #6b7785; }
    .sr-only, .ch-tip { display: none !important; } .chart { max-width: 680px; margin-bottom: 8px; }
    .ch-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 10px; color: #3a4a5c; margin-bottom: 4px; }
    .ch-legend span { display: inline-flex; align-items: center; gap: 6px; } .ch-legend i { display: inline-block; width: 14px; height: 3px; border-radius: 2px; }
    .ch-legend i.thr { height: 0; border-top: 2px dashed; border-radius: 0; }
    .gdata table { font-size: 9.5px; width: auto; min-width: 320px; } .gdata td, .gdata th { padding: 3px 6px; }
    footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #dfe4ea; color: #6b7785; font-size: 9.5px; }
  </style></head><body>
    <header><div class="u">${esc(UTILITY.name)}, SAMAR-AGOS</div><h1>${esc(meta.page)} report</h1>
      <dl><div><dt>Date range</dt><dd>${esc(meta.range.label)}</dd></div><div><dt>Exported</dt><dd>${esc(when(meta.at))}</dd></div><div><dt>Exported by</dt><dd>${esc(meta.by)}</dd></div></dl></header>
    ${items.map((x) => `<section><h2>${esc(x.label)}</h2>${x.note ? `<p class="note">${esc(x.note)}</p>` : '<p class="note"></p>'}${x.svg ? `${x.svg}${x.data.rows.length <= 40 ? `<div class="gdata">${table(x.data, x.dated)}</div>` : ''}` : table(x.data, x.dated)}</section>`).join('')}
    <footer>Generated by SAMAR-AGOS. Simulated values come from the SAMAR-AGOS simulator calibrated to Catbalogan Water District's published figures, not live sensors.</footer>
  </body></html>`;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();
  const go = () => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60000);
  };
  (doc.fonts?.ready || Promise.resolve()).then(() => setTimeout(go, 300));
}
