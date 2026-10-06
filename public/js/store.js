// SAMAR-AGOS state store + simulated IoT engine + forecasting + workflow actions.
// Everything the UI shows is derived from this single connected state.
import { makeSeed, makeReport, ZONES, zoneById, RESIDENT, PROVIDER_USER, REPORT_STEPS, WO_STEPS, SCENARIOS, reportTypeLabel, CRITICAL_FACILITIES } from './data.js';
import { clamp, rng, parsePoly, pointInPolygon, fmtTime, hoursLabel } from './util.js';

const KEY = 'samaragos.state.v5';
export const TICK_MS = 3000;
export const DT_MIN = 5; // simulated minutes per tick (accelerated time)
export const RES_CAP_ML = 2.0;
export const MIN_RESERVE = 0.3;
export const OPERATING_LEVEL = 0.72;
export const BASE_DEMAND = 2.65; // ML/day
const SRC = { intake: 1.9, wel1: 0.5, wel2: 0.4 }; // ML/day
const EMERGENCY_RATE = 0.8; // ML/day max transfer from backup storage
const HIST_LEN = 288; // 24 h at 5-min steps
export const mlToLs = (ml) => (ml * 1e6) / 86400;

let state;
const listeners = { change: new Set(), tick: new Set(), toast: new Set() };
const rand = rng(Date.now() % 100000);

export const on = (evt, fn) => (listeners[evt].add(fn), () => listeners[evt].delete(fn));
const emit = (evt, payload) => listeners[evt].forEach((fn) => fn(payload));
export const toast = (msg, kind = 'success') => emit('toast', { msg, kind });
export const getState = () => state;

// ---------------------------------------------------------------- persistence
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      /* storage full or blocked — demo keeps running in memory */
    }
  }, 600);
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.version === 5 && s.tele) {
        state = s;
        return;
      }
    }
  } catch (e) {
    /* ignore */
  }
  reset(false);
}

function freshState() {
  const s = makeSeed();
  s.factors = { demandMult: 1, inflowMult: 1 };
  s.emergency = { active: false, poolML: 0 };
  s.activeScenarios = [];
  return s;
}

export async function reset(notify = true) {
  state = freshState();
  warmup();
  if (remote) {
    clearShared();
    if (notify) toast('Resetting shared demo data…', 'info');
    await remote.reset();
  }
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    /* ignore */
  }
  if (notify) {
    emit('change');
    toast('Demo data reset to the starting scenario', 'info');
  }
}

export function commit(msg, kind) {
  save();
  remote?.flush();
  emit('change');
  if (msg) toast(msg, kind);
}

// ---------------------------------------------------------------- remote (Firebase) bridge
// When a backend is attached, shared collections come from Firestore listeners and
// commit() writes changed documents back. Without it the app runs on local demo data.
let remote = null;
export function setRemote(r) {
  remote = r;
}
export const isRemote = () => !!remote;
const session = () => remote?.getSession() || null;
const SHARED = ['reports', 'incidents', 'workOrders', 'advisories', 'notifications', 'altWater', 'emergencyTanks', 'assets'];
const SORT = {
  reports: (a, b) => a.submittedAt - b.submittedAt,
  incidents: (a, b) => b.detectedAt - a.detectedAt,
  workOrders: (a, b) => b.createdAt - a.createdAt,
  advisories: (a, b) => b.startAt - a.startAt,
  notifications: (a, b) => b.at - a.at,
  altWater: (a, b) => a.id.localeCompare(b.id),
  emergencyTanks: (a, b) => a.id.localeCompare(b.id),
  assets: (a, b) => 0,
};
let notifParts = {};
let emitQueued = false;
function emitSoon() {
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => ((emitQueued = false), emit('change')));
}

export function clearShared() {
  SHARED.forEach((c) => (state[c] = []));
  notifParts = {};
  state.publicStats = null;
}

// Seed data shaped for Firestore: simulated reports belong to placeholder residents.
export function buildSeedState() {
  const s = freshState();
  s.reports.forEach((r) => {
    r.reporterUid = r.mine ? 'seed-resident' : 'seed-sim';
    delete r.mine;
  });
  s.notifications.forEach((n) => ((n.uid = n.audience === 'resident' ? 'seed-resident' : null), (n.zone = null)));
  return s;
}

export function applyRemote(coll, docs, part) {
  const me = session();
  if (coll === 'reports') docs.forEach((r) => (r.mine = !!me && r.reporterUid === me.uid));
  if (coll === 'notifications') {
    const ns = me?.profile?.notifState || {};
    notifParts[part || 'all'] = docs
      .filter((n) => part !== 'broadcast' || !n.zone || n.zone === RESIDENT.zone)
      .map((n) => (part === 'broadcast' && ns[n.id] ? { ...n, state: ns[n.id] } : n));
    const local = state.notifications.filter((n) => n.local);
    state.notifications = [...Object.values(notifParts).flat(), ...local].sort(SORT.notifications);
  } else {
    state[coll] = docs.sort(SORT[coll]);
  }
  if (coll === 'reports' && me?.isProvider) processResidentResponses();
  emitSoon();
}

export function applyControl(d) {
  if (!d) return;
  const s = state;
  s.scenario = d.scenario || 'normal';
  s.activeScenarios = d.activeScenarios || [];
  s.factors = d.factors || { demandMult: 1, inflowMult: 1 };
  s.zoneIssues = d.zoneIssues || {};
  s.pumpsOffline = d.pumpsOffline || [];
  s.scenarioLog = d.scenarioLog || [];
  if (d.emergencyActive && !s.emergency.active) s.emergency = { active: true, poolML: 0.4 };
  if (!d.emergencyActive) s.emergency = { active: false, poolML: 0 };
  if (d.volOverride && d.volOverride.at > (s.volOverride?.at || 0)) s.tele.volML = d.volOverride.volML;
  s.volOverride = d.volOverride || null;
  updateDerived(s.tele, s.tele.simTime);
  emitSoon();
}

export function applyPublic(d) {
  state.publicStats = d;
  emitSoon();
}

// Resident feedback is recorded on the report; staff devices apply it to the incident.
function processResidentResponses() {
  let changed = false;
  state.reports.forEach((r) => {
    const resp = r.residentResponse;
    if (!resp || resp.processed || !r.incidentId) return;
    const inc = state.incidents.find((i) => i.id === r.incidentId);
    if (!inc) return;
    applyResponseToIncident(r, inc);
    resp.processed = true;
    changed = true;
  });
  if (changed) commit();
}

// ---------------------------------------------------------------- physics model
export function diurnal(simTime) {
  const d = new Date(simTime);
  const h = d.getHours() + d.getMinutes() / 60;
  return 1 + 0.16 * Math.cos((2 * Math.PI * (h - 7.5)) / 12) + 0.12 * Math.cos((2 * Math.PI * (h - 14)) / 24);
}

export function leakLoss(s = state) {
  return Object.values(s.zoneIssues).reduce((a, z) => a + (z.lossML || 0), 0);
}

export function productionCapacity(s = state, o = {}) {
  const pumpDown = !o.restorePumps && s.pumpsOffline.includes('PS-01');
  const inflow = s.factors.inflowMult * (1 + (o.inflowPct || 0) / 100);
  return SRC.intake * inflow * (pumpDown ? 0.45 : 1) + SRC.wel1 + SRC.wel2 + (o.backup ? 0.5 : 0) + (o.prodDelta || 0);
}

function demandAt(s, simTime, o = {}) {
  const base = BASE_DEMAND * diurnal(simTime) * s.factors.demandMult * (1 + (o.demandPct || 0) / 100);
  return base * (1 - (o.reducePct || 0) / 100) + leakLoss(s);
}

function step(s, simTime, vol, pool, dtDays, o) {
  const demand = demandAt(s, simTime, o);
  const cap = productionCapacity(s, o);
  const level = vol / RES_CAP_ML;
  const production = level >= OPERATING_LEVEL ? Math.min(cap, demand) : cap;
  let transfer = 0;
  if (pool > 0 && production < demand) transfer = Math.min(pool / dtDays, EMERGENCY_RATE, demand - production);
  const nv = clamp(vol + (production + transfer - demand) * dtDays, 0, RES_CAP_ML);
  return { demand, production, cap, transfer, vol: nv, pool: pool - transfer * dtDays };
}

function warmup() {
  const now = Date.now();
  const n = HIST_LEN;
  const dtDays = DT_MIN / 1440;
  let vol = 0.715 * RES_CAP_ML;
  const savedIssues = state.zoneIssues;
  const h = { t: [], level: [], prod: [], demand: [], inflow: [], outflow: [], pressure: {}, flow: {} };
  ZONES.forEach((z) => ((h.pressure[z.id] = []), (h.flow[z.id] = [])));
  for (let i = n; i > 0; i--) {
    const t = now - i * DT_MIN * 60000;
    state.zoneIssues = Object.fromEntries(Object.entries(savedIssues).filter(([, v]) => v.since <= t));
    const r = step(state, t, vol, 0, dtDays, {});
    vol = r.vol;
    h.t.push(t);
    h.level.push(vol / RES_CAP_ML);
    h.prod.push(r.production);
    h.demand.push(r.demand);
    h.inflow.push(mlToLs(r.production));
    h.outflow.push(mlToLs(r.demand));
    ZONES.forEach((z) => {
      const p = zonePressure(z, t, vol / RES_CAP_ML);
      h.pressure[z.id].push(p);
      h.flow[z.id].push(zoneFlow(z, t));
    });
  }
  state.zoneIssues = savedIssues;
  state.history = h;
  state.tele = {
    simTime: now,
    lastUpdate: now,
    tick: 0,
    volML: vol,
    production: h.prod[n - 1],
    demand: h.demand[n - 1],
    transfer: 0,
    tanks: {},
    zones: {},
    pumps: {},
    turbidityE: 4.6,
  };
  updateDerived(state.tele, now);
}

function zonePressure(z, t, level) {
  const issue = state.zoneIssues[z.id];
  const peak = (diurnal(t) - 1) * 9;
  const low = level < MIN_RESERVE ? (MIN_RESERVE - level) * 70 : 0;
  const booster = z.id === 'B' && state.pumpsOffline.includes('PS-03') ? 8 : 0;
  return Math.max(0, z.basePressure - peak - low - booster - (issue?.pressureDrop || 0) + (rand() - 0.5) * 1.6);
}

function zoneFlow(z, t) {
  const issue = state.zoneIssues[z.id];
  return Math.max(0, z.baseFlow * diurnal(t) * state.factors.demandMult * (1 + (issue?.flowChange || 0) / 100) + (rand() - 0.5) * 0.4);
}

function updateDerived(tele, simTime) {
  const level = tele.volML / RES_CAP_ML;
  ZONES.forEach((z) => {
    const p = zonePressure(z, simTime, level);
    const f = zoneFlow(z, simTime);
    const normalFlow = z.baseFlow * diurnal(simTime) * state.factors.demandMult;
    tele.zones[z.id] = { pressure: p, flow: f, flowDeltaPct: ((f - normalFlow) / normalFlow) * 100, status: p < 15 ? 'critical' : p < 26 ? 'warning' : 'normal' };
  });
  const tankDefs = { 'TNK-01': ['B', 250000], 'TNK-02': ['D', 180000], 'TNK-03': ['E', 300000] };
  Object.entries(tankDefs).forEach(([id, [zone, cap]]) => {
    const prev = tele.tanks[id]?.level ?? 0.7;
    const issue = state.zoneIssues[zone];
    const target = clamp(0.3 + 0.55 * level - (diurnal(simTime) - 1) * 0.5 - (issue ? 0.22 : 0), 0.05, 0.98);
    const lv = prev + (target - prev) * 0.15 + (rand() - 0.5) * 0.004;
    tele.tanks[id] = { level: lv, volL: lv * cap, capL: cap, status: lv < 0.25 ? 'critical' : lv < 0.4 ? 'warning' : 'normal' };
  });
  const ps01Down = state.pumpsOffline.includes('PS-01');
  tele.pumps = {
    'PS-01': { status: ps01Down ? 'offline' : 'running', units: ps01Down ? '1 of 2 running (Unit 1 tripped)' : '2 of 2 running', flowLs: mlToLs(Math.min(tele.production, productionCapacity()) - 0.9 + 0), vibration: 6.8 + rand() * 0.5, powerKw: ps01Down ? 27 + rand() * 2 : 54 + rand() * 3 },
    'PS-02': { status: 'running', units: '1 duty, 1 standby', flowLs: mlToLs(tele.demand - leakLoss()), vibration: 2.1 + rand() * 0.4, powerKw: 39 + rand() * 3 },
    'PS-03': { status: state.pumpsOffline.includes('PS-03') ? 'offline' : 'running', units: '1 of 1 running', flowLs: tele.zones.B.flow, vibration: 2.6 + rand() * 0.4, powerKw: 12 + rand() * 1.5 },
  };
  const tankVol = Object.values(tele.tanks).reduce((a, t) => a + t.volL / 1e6, 0);
  tele.reserveHours = (tele.volML + tankVol + (state.emergency.active ? state.emergency.poolML : 0)) / (tele.demand / 24);
}

// ---------------------------------------------------------------- tick
export function tick() {
  const s = state;
  const t = s.tele;
  const dtDays = DT_MIN / 1440;
  const simTime = t.simTime + DT_MIN * 60000;
  const pool = s.emergency.active ? s.emergency.poolML : 0;
  const r = step(s, simTime, t.volML, pool, dtDays, {});
  if (s.emergency.active) s.emergency.poolML = Math.max(0, r.pool);
  t.simTime = simTime;
  t.lastUpdate = Date.now();
  t.tick++;
  t.volML = r.vol;
  t.production = r.production;
  t.demand = r.demand;
  t.transfer = r.transfer;
  const inc39 = s.incidents.find((i) => i.id === 'INC-2026-039');
  const targetTurb = inc39 && inc39.status !== 'Resolved' ? 4.5 : 1.1;
  t.turbidityE = t.turbidityE + (targetTurb - t.turbidityE) * 0.08 + (rand() - 0.5) * 0.15;
  updateDerived(t, simTime);

  // history
  const h = s.history;
  const push = (arr, v) => (arr.push(v), arr.length > HIST_LEN && arr.shift());
  push(h.t, simTime);
  push(h.level, t.volML / RES_CAP_ML);
  push(h.prod, t.production + t.transfer);
  push(h.demand, t.demand);
  push(h.inflow, mlToLs(t.production + t.transfer));
  push(h.outflow, mlToLs(t.demand));
  ZONES.forEach((z) => (push(h.pressure[z.id], t.zones[z.id].pressure), push(h.flow[z.id], t.zones[z.id].flow)));

  // smart emergency tank (simulated IoT)
  s.emergencyTanks.forEach((et) => {
    if (et.mode !== 'SIMULATED') return;
    const draw = s.zoneIssues[et.zone] ? 18 + rand() * 14 : 2 + rand() * 3;
    et.volumeL = clamp(et.volumeL - draw, 0, et.capacityL);
    if (et.volumeL < et.capacityL * 0.2) {
      et.volumeL = et.capacityL * 0.95;
      et.lastRefill = Date.now();
    }
    et.sensor = rand() < 0.02 ? 'intermittent' : 'online';
    et.updatedAt = Date.now();
  });

  // resident reports keep arriving while an unresolved zone issue persists
  // (local demo only — with a shared backend, scenarios add a one-off batch instead)
  Object.entries(s.zoneIssues).forEach(([zone, issue]) => {
    if (!issue.spawn || remote) return;
    const count = s.reports.filter((rp) => rp.zone === zone && rp.submittedAt >= issue.since).length;
    const informed = s.advisories.some((a) => a.status === 'Active' && a.areas.includes(zone));
    const chance = informed ? 0.03 : 0.1;
    if (count < 34 && rand() < chance) spawnReport(zone, issue.type);
  });

  syncAlertNotifications();
  save();
  emit('tick');
}

function spawnReport(zone, issueType, id = `WR-2026-${state.reportSeq++}`) {
  const z = zoneById(zone);
  const p = parsePoly(z.poly);
  const xs = p.map((q) => q[0]);
  const ys = p.map((q) => q[1]);
  let x, y, guard = 0;
  do {
    x = Math.round(Math.min(...xs) + rand() * (Math.max(...xs) - Math.min(...xs)));
    y = Math.round(Math.min(...ys) + rand() * (Math.max(...ys) - Math.min(...ys)));
  } while (!pointInPolygon([x, y], p) && guard++ < 200);
  const pool = issueType === 'leak' ? ['leak', 'low_pressure', 'low_pressure', 'no_water', 'leak'] : ['low_pressure', 'low_pressure', 'low_pressure', 'no_water', 'leak'];
  const type = pool[Math.floor(rand() * pool.length)];
  const rep = makeReport(rand, { id, zone, type, x, y, at: Date.now() });
  if (remote) rep.reporterUid = 'seed-sim';
  state.reports.push(rep);
}

// ---------------------------------------------------------------- forecast
// Optional weather adjustment: hoursAhead → { demandPct, inflowPct } (installed by weather.js)
let weatherModel = null;
export function setWeatherModel(fn) {
  weatherModel = fn;
}
export const weatherActive = () => !!weatherModel;

// opts: hours, prodDelta, backup, emergencyL, reducePct, restorePumps, inflowPct, demandPct
export function forecast(opts = {}, s = state) {
  const hours = opts.hours || 72;
  const stepMin = 15;
  const dtDays = stepMin / 1440;
  let vol = s.tele.volML;
  let pool = (s.emergency.active ? s.emergency.poolML : 0) + (opts.emergencyL || 0) / 1e6;
  const pts = [{ h: 0, pct: vol / RES_CAP_ML }];
  let crossH = vol / RES_CAP_ML <= MIN_RESERVE ? 0 : null;
  let minPct = vol / RES_CAP_ML;
  let sumDemand = 0, sumProd = 0, n = 0;
  for (let k = 1; k <= (hours * 60) / stepMin; k++) {
    const t = s.tele.simTime + k * stepMin * 60000;
    const w = weatherModel && !opts.noWeather ? weatherModel((k * stepMin) / 60) : null;
    const o = w ? { ...opts, demandPct: (opts.demandPct || 0) + w.demandPct, inflowPct: (opts.inflowPct || 0) + w.inflowPct } : opts;
    const r = step(s, t, vol, pool, dtDays, o);
    vol = r.vol;
    pool = r.pool;
    const pct = vol / RES_CAP_ML;
    const hh = (k * stepMin) / 60;
    if (k % 2 === 0) pts.push({ h: hh, pct });
    if (crossH == null && pct <= MIN_RESERVE) crossH = hh;
    minPct = Math.min(minPct, pct);
    if (hh <= 24) (sumDemand += r.demand), (sumProd += r.production + r.transfer), n++;
  }
  const at = (hh) => pts.find((p) => p.h >= hh)?.pct ?? pts[pts.length - 1].pct;
  let status = 'stable';
  if (crossH != null && crossH <= 6) status = 'critical';
  else if (crossH != null && crossH <= 24) status = 'risk';
  else if (crossH != null || at(24) < 0.45) status = 'watch';
  return { pts, crossH, minPct, now: pts[0].pct, at6: at(6), at12: at(12), at24: at(24), at48: at(48), status, avgDemand: sumDemand / n, avgProd: sumProd / n };
}

export const FORECAST_STATUS = {
  stable: { label: 'STABLE', sev: 'normal', text: 'Expected water supply is sufficient based on current storage, production, and estimated demand.' },
  watch: { label: 'WATCH', sev: 'info', text: 'Storage is expected to decline. Based on current conditions it stays above the minimum reserve within 24 hours.' },
  risk: { label: 'SHORTAGE RISK', sev: 'warning', text: 'Based on current conditions, storage may reach the minimum reserve within 24 hours.' },
  critical: { label: 'CRITICAL SHORTAGE RISK', sev: 'critical', text: 'Based on current conditions, storage may reach the minimum reserve within 6 hours.' },
};

export function forecastReasons(s = state) {
  const out = [];
  const demandAbove = (s.factors.demandMult - 1) * 100;
  if (demandAbove > 3) out.push(`Demand is ${Math.round(demandAbove)}% above normal for this period`);
  const loss = leakLoss(s);
  if (loss > 0) {
    const zones = Object.keys(s.zoneIssues).map((z) => `Zone ${z}`).join(', ');
    out.push(`Estimated distribution losses of ${loss.toFixed(2)} ML/day (${zones} line problem)`);
  }
  if (s.factors.inflowMult < 0.98) out.push(`Raw-water inflow from the river intake decreased by ${Math.round((1 - s.factors.inflowMult) * 100)}%`);
  if (s.pumpsOffline.includes('PS-01')) out.push('Raw Water Pump Station PS-01 is offline — production capacity reduced ~29%');
  const fc = forecast({ hours: 24 }, s);
  if (fc.avgProd < fc.avgDemand - 0.05) out.push(`Estimated demand (${fc.avgDemand.toFixed(2)} ML/day) exceeds available supply (${fc.avgProd.toFixed(2)} ML/day) over the next 24 hours`);
  const lvl = s.tele.volML / RES_CAP_ML;
  if (lvl < 0.62) out.push(`Storage is lower than normal for this period (${Math.round(lvl * 100)}% vs. typical 70%)`);
  if (s.emergency.active && s.emergency.poolML > 0) out.push(`Backup storage is supplementing supply (${Math.round(s.emergency.poolML * 1e6).toLocaleString()} L remaining)`);
  if (!out.length) out.push('Production capacity currently meets estimated demand', 'Central Reservoir is within its normal operating range');
  return out;
}

// ---------------------------------------------------------------- alerts
const SEV_RANK = { critical: 4, warning: 3, offline: 2, info: 1, normal: 0 };
export const worstSev = (list) => list.reduce((w, a) => (SEV_RANK[a] > SEV_RANK[w] ? a : w), 'normal');

export function reportClusters(s = state) {
  const groups = {};
  s.reports
    .filter((r) => !r.incidentId && (r.status === 'submitted' || r.status === 'acknowledged'))
    .forEach((r) => (groups[r.zone] = groups[r.zone] || []).push(r));
  return Object.entries(groups)
    .map(([zone, reps]) => ({ zone, reports: reps.sort((a, b) => a.submittedAt - b.submittedAt) }))
    .sort((a, b) => b.reports.length - a.reports.length);
}

export function deriveAlerts(s = state) {
  const a = [];
  const t = s.tele;
  const lvl = t.volML / RES_CAP_ML;
  if (lvl < MIN_RESERVE) a.push({ key: 'storage', sev: 'critical', cat: 'Storage', title: 'Storage below minimum reserve', detail: `Central Reservoir at ${Math.round(lvl * 100)}% (minimum reserve 30%)`, link: '#/p/operations' });
  else if (lvl < 0.42) a.push({ key: 'storage', sev: 'warning', cat: 'Storage', title: 'Low storage warning', detail: `Central Reservoir at ${Math.round(lvl * 100)}%`, link: '#/p/operations' });
  const fc = forecast({ hours: 48 }, s);
  if (fc.status === 'risk' || fc.status === 'critical')
    a.push({ key: 'forecast', sev: fc.status === 'critical' ? 'critical' : 'warning', cat: 'Forecast', title: 'Shortage forecast', detail: `Minimum reserve may be reached in ~${hoursLabel(fc.crossH)}`, link: '#/p/forecast' });
  ZONES.forEach((z) => {
    const zt = t.zones[z.id];
    if (zt.status !== 'normal') a.push({ key: `pressure-${z.id}`, sev: zt.status, cat: 'Distribution', title: `Pressure anomaly — ${z.short}`, detail: `${zt.pressure.toFixed(0)} PSI (normal ~${z.basePressure} PSI)`, link: '#/p/incidents' });
  });
  s.pumpsOffline.forEach((id) => a.push({ key: `pump-${id}`, sev: 'critical', cat: 'Equipment', title: `Pump failure — ${id}`, detail: `${s.assets.find((x) => x.id === id)?.name} offline`, link: `#/p/assets/${id}` }));
  reportClusters(s)
    .filter((c) => c.reports.length >= 3)
    .forEach((c) => a.push({ key: `cluster-${c.zone}`, sev: 'warning', cat: 'Reports', title: `New report cluster — Zone ${c.zone}`, detail: `${c.reports.length} unreviewed resident reports`, link: '#/p/incidents' }));
  s.assets.filter((x) => x.status === 'offline').forEach((x) => a.push({ key: `offline-${x.id}`, sev: 'offline', cat: 'Equipment', title: `${x.type} offline — ${x.id}`, detail: `${x.name} is not reporting`, link: `#/p/assets/${x.id}` }));
  if (t.turbidityE > 4) a.push({ key: 'turbidity-E', sev: 'info', cat: 'Water Quality', title: 'Turbidity elevated — Zone E', detail: `${t.turbidityE.toFixed(1)} NTU at TS-E1 (guideline 5 NTU)`, link: '#/p/incidents/INC-2026-039' });
  s.workOrders.filter((w) => w.status !== 'Completed' && w.target < Date.now()).forEach((w) => a.push({ key: `overdue-${w.id}`, sev: 'warning', cat: 'Work Orders', title: `Overdue work order — ${w.id}`, detail: w.description, link: `#/p/work-orders/${w.id}` }));
  return a.sort((x, y) => SEV_RANK[y.sev] - SEV_RANK[x.sev]);
}

function syncAlertNotifications() {
  const alerts = deriveAlerts();
  const keys = new Set(alerts.map((x) => x.key));
  alerts.forEach((al) => {
    if (al.key.startsWith('overdue') || al.key.startsWith('offline') || al.key === 'turbidity-E') return; // seeded already
    const prev = state.seenAlerts[al.key];
    if (!prev || (al.sev === 'critical' && prev !== 'critical')) {
      // derived from this device's telemetry, so kept local (never written to the shared database)
      notify('provider', { kind: al.cat, title: al.title, body: al.detail, link: al.link, severity: al.sev, local: true });
    }
    state.seenAlerts[al.key] = al.sev;
  });
  Object.keys(state.seenAlerts).forEach((k) => !keys.has(k) && delete state.seenAlerts[k]);
}

export function subsystemStatus(s = state) {
  const t = s.tele;
  const lvl = t.volML / RES_CAP_ML;
  const fc = forecast({ hours: 48 }, s);
  const cap = productionCapacity(s);
  const zoneSev = worstSev(ZONES.map((z) => t.zones[z.id].status));
  const affected = ZONES.filter((z) => t.zones[z.id].status !== 'normal');
  const supplySev = cap < 2.2 ? 'critical' : cap < 2.65 ? 'warning' : 'normal';
  const equipSev = s.pumpsOffline.length ? 'critical' : s.assets.some((a) => a.status === 'offline') ? 'offline' : 'normal';
  return [
    { key: 'supply', label: 'Supply', sev: supplySev, text: supplySev === 'normal' ? `Capacity ${cap.toFixed(2)} ML/day` : `Capacity reduced to ${cap.toFixed(2)} ML/day` },
    { key: 'storage', label: 'Storage', sev: lvl < MIN_RESERVE ? 'critical' : lvl < 0.42 ? 'warning' : 'normal', text: `Reservoir ${Math.round(lvl * 100)}%` },
    { key: 'distribution', label: 'Distribution', sev: zoneSev, text: affected.length ? `${affected.length} zone${affected.length > 1 ? 's' : ''} below normal pressure` : 'All zones within range' },
    { key: 'equipment', label: 'Equipment', sev: equipSev, text: s.pumpsOffline.length ? `${s.pumpsOffline.join(', ')} offline` : equipSev === 'offline' ? '1 sensor not reporting' : 'All pumps running' },
    { key: 'forecast', label: 'Forecast', sev: FORECAST_STATUS[fc.status].sev, text: FORECAST_STATUS[fc.status].label },
  ];
}

export function overallStatus(s = state) {
  const subs = subsystemStatus(s);
  const order = ['critical', 'warning', 'info', 'offline', 'normal'];
  const sev = order.find((o) => subs.some((x) => x.sev === o)) || 'normal';
  const affected = ZONES.filter((z) => s.tele.zones[z.id].status !== 'normal');
  let summary = 'All service zones are operating within normal ranges.';
  if (affected.length) summary = `${affected.length} service zone${affected.length > 1 ? 's are' : ' is'} currently experiencing reduced pressure.`;
  const fc = subs.find((x) => x.key === 'forecast');
  if (fc.sev === 'warning' || fc.sev === 'critical') summary += ' Storage is forecast to approach the minimum reserve.';
  if (s.pumpsOffline.length) summary += ` ${s.pumpsOffline.join(', ')} is offline.`;
  return { sev: sev === 'info' ? 'normal' : sev, summary, affected, subs };
}

// ---------------------------------------------------------------- notifications
let nseq = 100;
// uid targets one resident; zone targets residents of a zone; neither = everyone in the audience.
export function notify(audience, n) {
  const id = `n${Date.now().toString(36)}${(nseq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  state.notifications.unshift({ id, audience, state: 'unread', at: Date.now(), uid: null, zone: null, ...n });
  if (state.notifications.length > 150) state.notifications.length = 150;
}
// Resident-facing notice about zones: one per zone on the shared backend, or for the demo resident locally.
function notifyZones(zones, n) {
  if (remote) zones.forEach((zone) => notify('resident', { ...n, zone }));
  else if (!zones.length || zones.includes(RESIDENT.zone)) notify('resident', n);
}
// Shared broadcast notices keep read/archived state per user (on the user profile).
function setOne(n, st) {
  n.state = st;
  if (remote && n.audience === 'resident' && !n.uid && !n.local) remote.setNotifState(n.id, st);
}
export function setNotification(id, st) {
  const n = state.notifications.find((x) => x.id === id);
  if (n) setOne(n, st);
  commit();
}
export function markAllRead(audience) {
  state.notifications.filter((n) => n.audience === audience && n.state === 'unread').forEach((n) => setOne(n, 'read'));
  commit();
}

// ---------------------------------------------------------------- resident service status
export function residentService(s = state, zone = RESIDENT.zone) {
  const adv = s.advisories.filter((a) => a.status === 'Active' && a.areas.includes(zone)).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const inc = s.incidents.find((i) => i.status !== 'Resolved' && i.zones.includes(zone));
  const recent = s.advisories.filter((a) => a.status === 'Resolved' && a.areas.includes(zone) && Date.now() - a.updatedAt < 6 * 3600000).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const myReports = s.reports.filter((r) => r.mine && r.zone === zone && r.status !== 'verified');
  if (adv) {
    const wo = inc && s.workOrders.find((w) => inc.workOrderIds.includes(w.id) && w.status !== 'Completed');
    return { sev: adv.kind === 'Water Quality' ? 'info' : adv.serviceStatus === 'NO WATER' ? 'critical' : 'warning', label: adv.serviceStatus, message: adv.message, updatedAt: adv.updatedAt, etr: adv.etr, nextUpdate: adv.nextUpdate, advisory: adv, team: wo ? `Repair team assigned (${wo.status})` : null, incident: inc };
  }
  if (recent) return { sev: 'normal', label: 'SERVICE RESTORED', message: recent.message, updatedAt: recent.updatedAt, advisory: recent, restored: true };
  if (inc) return { sev: 'info', label: 'UNDER INVESTIGATION', message: 'The water provider is investigating reported service problems in your area. An advisory will be posted when more is confirmed.', updatedAt: inc.timeline[inc.timeline.length - 1].at, incident: inc };
  // residents can't read other residents' reports on the shared backend; staff publish zone counts instead
  const shared = remote && !session()?.isProvider;
  const pending = shared ? s.publicStats?.pending?.[zone] || 0 : s.reports.filter((r) => r.zone === zone && r.status === 'submitted').length;
  const latestAt = shared ? s.publicStats?.latest?.[zone] || Date.now() : Math.max(...s.reports.filter((r) => r.zone === zone).map((r) => r.submittedAt));
  if (pending >= 3) return { sev: 'info', label: 'REPORTS UNDER REVIEW', message: `Residents in your area have reported water problems (${pending} reports). The provider is reviewing these reports against system readings. No advisory has been issued yet.`, updatedAt: latestAt, myReports };
  return { sev: 'normal', label: 'NORMAL SERVICE', message: 'No service problems are currently reported by your water provider for your area.', updatedAt: s.tele.lastUpdate };
}

// ---------------------------------------------------------------- report actions
const stepIdx = (st) => REPORT_STEPS.findIndex((x) => x.id === st);

function advanceReports(ids, status, text) {
  ids.forEach((id) => {
    const r = state.reports.find((x) => x.id === id);
    if (!r || stepIdx(r.status) >= stepIdx(status)) return;
    r.status = status;
    r.updates.push({ at: Date.now(), status, text });
    const realResident = r.reporterUid && !r.reporterUid.startsWith('seed');
    if (r.mine || realResident) {
      const label = REPORT_STEPS[stepIdx(status)].label;
      notify('resident', { kind: 'report', title: `${label} — ${r.id}`, body: text, link: `#/r/reports/${r.id}`, uid: r.reporterUid || null });
    }
  });
}

// Ticket numbers come from the shared counter when a backend is attached.
async function nextId(kind, local) {
  return remote ? (await remote.allocIds(kind))[0] : local();
}

export async function submitReport(data) {
  const id = await nextId('report', () => `WR-2026-${state.reportSeq++}`);
  const me = session();
  const r = {
    id,
    type: data.type,
    zone: data.zone,
    barangay: data.barangay,
    location: data.location,
    x: data.x,
    y: data.y,
    description: data.description,
    observedAt: data.observedAt,
    submittedAt: Date.now(),
    status: 'submitted',
    incidentId: null,
    mine: true,
    reporterUid: me?.uid || null,
    reporterName: me ? RESIDENT.name : null,
    photo: data.photo || null,
    updates: [{ at: Date.now(), status: 'submitted', text: 'Report received. Awaiting provider review.' }],
    residentResponse: null,
  };
  state.reports.push(r);
  notify('resident', { kind: 'report', title: 'Report submitted', body: `${id} (${reportTypeLabel(r.type)}) is awaiting provider review.`, link: `#/r/reports/${id}`, uid: me?.uid || null });
  if (me) notify('provider', { kind: 'Reports', title: `New resident report — ${zoneById(r.zone).short}`, body: `${id}: ${reportTypeLabel(r.type)}, ${r.location}`, link: '#/p/incidents', severity: 'info' });
  commit();
  return r;
}

export function acknowledgeReports(ids) {
  advanceReports(ids, 'acknowledged', 'Your report was reviewed by the water provider.');
  commit(`${ids.length} report${ids.length > 1 ? 's' : ''} acknowledged`);
}

export function residentVerify(reportId, restored, comment = '') {
  const r = state.reports.find((x) => x.id === reportId);
  if (!r) return;
  r.residentResponse = { restored, comment, at: Date.now(), processed: false };
  if (restored) advanceReports([r.id], 'verified', 'You confirmed that water service has been restored. Thank you.');
  else {
    r.updates.push({ at: Date.now(), status: r.status, text: 'You reported that the problem still exists. The provider has been notified for follow-up.' });
    notify('provider', { kind: 'Reports', title: 'Resident reports problem persists', body: `${r.id} — ${reportTypeLabel(r.type)}, ${r.location}. ${comment}`, link: r.incidentId ? `#/p/incidents/${r.incidentId}` : '#/p/incidents', severity: 'warning' });
  }
  // Locally (or for staff) apply to the incident now; residents on the shared backend
  // can't edit incidents, so a staff device applies it when the report syncs.
  const inc = state.incidents.find((i) => i.id === r.incidentId);
  if (inc && (!remote || session()?.isProvider)) {
    applyResponseToIncident(r, inc);
    r.residentResponse.processed = true;
  }
  commit(restored ? 'Thank you — service restoration confirmed' : 'Feedback sent to your water provider', restored ? 'success' : 'info');
}

function applyResponseToIncident(r, inc) {
  if (r.residentResponse.restored) {
    inc.timeline.push({ at: Date.now(), text: `Resident confirmed service restored (${r.id})` });
    return;
  }
  inc.timeline.push({ at: Date.now(), text: `Resident reports problem still exists (${r.id}) — follow-up required` });
  if (inc.status === 'Resolved') {
    inc.status = 'Investigating';
    inc.resolvedAt = null;
    inc.timeline.push({ at: Date.now(), text: 'Incident reopened for follow-up based on resident feedback' });
  }
}

// ---------------------------------------------------------------- incident actions
const operatorName = () => (session() ? PROVIDER_USER.name : 'Operator');

export async function createIncident({ zone, reportIds, title, type, severity, note, evidence }) {
  const id = await nextId('incident', () => `INC-2026-${String(state.incidentSeq++).padStart(3, '0')}`);
  const z = zoneById(zone);
  const zt = state.tele.zones[zone];
  const reps = state.reports.filter((r) => reportIds.includes(r.id));
  const first = reps.length ? Math.min(...reps.map((r) => r.submittedAt)) : Date.now();
  const now = Date.now();
  const timeline = [];
  if (reps.length) {
    timeline.push({ at: first, text: 'First resident report' });
    timeline.push({ at: Math.min(now - 8 * 60000, first + 6 * 60000), text: `Report cluster identified (${reps.length} reports)` });
  }
  if (zt.status !== 'normal') timeline.push({ at: now - 4 * 60000, text: `Pressure anomaly confirmed (${zt.pressure.toFixed(0)} PSI)` });
  timeline.push({ at: now, text: 'Incident created' });
  const inc = {
    id,
    title,
    type,
    zone,
    zones: [zone],
    status: 'Investigating',
    severity,
    detectedAt: first,
    connections: z.connections,
    facilities: CRITICAL_FACILITIES.filter((f) => f.zone === zone).map((f) => f.id),
    condition: `Pressure ${zt.pressure.toFixed(0)} PSI (normal ~${z.basePressure}); flow ${zt.flowDeltaPct >= 0 ? '+' : ''}${zt.flowDeltaPct.toFixed(0)}% vs. expected.`,
    reportIds: [...reportIds],
    workOrderIds: [],
    advisoryIds: [],
    notes: note ? [{ at: now, by: operatorName(), text: note }] : [],
    evidence: evidence || [],
    timeline,
    resolvedAt: null,
  };
  state.incidents.unshift(inc);
  reps.forEach((r) => (r.incidentId = id));
  advanceReports(reportIds, 'acknowledged', 'Your report was reviewed by the water provider.');
  advanceReports(reportIds, 'investigating', `An investigation has started (${id}). Your report is being used as evidence.`);
  if (state.zoneIssues[zone]) state.zoneIssues[zone].label = title;
  commit(`Incident ${id} created`);
  return inc;
}

export function updateIncident(id, patch, logText) {
  const inc = state.incidents.find((i) => i.id === id);
  Object.assign(inc, patch);
  if (logText) inc.timeline.push({ at: Date.now(), text: logText });
  commit('Incident updated');
}

export function addIncidentNote(id, text) {
  const inc = state.incidents.find((i) => i.id === id);
  inc.notes.push({ at: Date.now(), by: operatorName(), text });
  inc.timeline.push({ at: Date.now(), text: `Operator note: ${text.slice(0, 80)}` });
  commit('Note added');
}

export function linkReports(incidentId, ids) {
  const inc = state.incidents.find((i) => i.id === incidentId);
  ids.forEach((rid) => {
    const r = state.reports.find((x) => x.id === rid);
    if (r && !inc.reportIds.includes(rid)) inc.reportIds.push(rid), (r.incidentId = incidentId);
  });
  advanceReports(ids, 'acknowledged', 'Your report was reviewed by the water provider.');
  advanceReports(ids, 'investigating', `Your report was added as evidence to ${incidentId}.`);
  const woActive = state.workOrders.some((w) => inc.workOrderIds.includes(w.id));
  if (woActive) advanceReports(ids, 'repair_assigned', 'A repair team has been assigned.');
  inc.timeline.push({ at: Date.now(), text: `${ids.length} additional resident report${ids.length > 1 ? 's' : ''} linked` });
  commit(`${ids.length} report${ids.length > 1 ? 's' : ''} linked to ${incidentId}`);
}

export function resolveIncident(id, notes) {
  const inc = state.incidents.find((i) => i.id === id);
  inc.status = 'Resolved';
  inc.resolvedAt = Date.now();
  inc.resolution = notes;
  inc.timeline.push({ at: Date.now(), text: `Incident resolved${notes ? ` — ${notes}` : ''}` });
  delete state.zoneIssues[inc.zone];
  state.advisories
    .filter((a) => inc.advisoryIds.includes(a.id) && a.status === 'Active')
    .forEach((a) => {
      a.status = 'Resolved';
      a.serviceStatus = 'NORMAL';
      a.updatedAt = Date.now();
      a.message = `Water service has been restored in ${a.barangays.join(', ')}. ${notes || ''}`.trim();
      a.etr = null;
      a.nextUpdate = null;
    });
  advanceReports(inc.reportIds, 'repair_completed', 'Repair work is complete.');
  inc.reportIds.forEach((rid) => {
    const r = state.reports.find((x) => x.id === rid);
    if (r && r.status !== 'verified') r.awaitingVerification = true;
  });
  notifyZones(inc.zones, { kind: 'restored', title: 'Water service restored', body: `${inc.title.split('—')[0].trim()} in your area has been resolved. If you reported a problem, please confirm whether your water service has returned.`, link: '#/r/reports' });
  commit(`${id} resolved — residents notified`);
}

// ---------------------------------------------------------------- work orders
export async function createWorkOrder(data) {
  const id = await nextId('wo', () => `WO-2026-${String(state.woSeq++).padStart(4, '0')}`);
  const now = Date.now();
  const wo = { id, photos: { before: null, after: null }, notes: [], completion: null, createdAt: now, status: data.team ? 'Assigned' : 'New', history: [{ status: 'New', at: now }], ...data };
  if (data.team) wo.history.push({ status: 'Assigned', at: now });
  state.workOrders.unshift(wo);
  const inc = state.incidents.find((i) => i.id === data.incidentId);
  if (inc) {
    inc.workOrderIds.push(id);
    if (inc.status === 'Investigating') inc.status = 'Response in Progress';
    inc.timeline.push({ at: now, text: `Work order ${id} assigned to ${data.team || 'unassigned'}` });
    advanceReports(inc.reportIds, 'repair_assigned', `A repair team (${data.team}) has been assigned under ${id}.`);
  }
  commit(`Work order ${id} created`);
  return wo;
}

export function advanceWorkOrder(id, completion) {
  const wo = state.workOrders.find((w) => w.id === id);
  const i = WO_STEPS.indexOf(wo.status);
  if (i >= WO_STEPS.length - 1) return;
  const next = WO_STEPS[i + 1];
  wo.status = next;
  wo.history.push({ status: next, at: Date.now() });
  const inc = state.incidents.find((x) => x.id === wo.incidentId);
  if (inc) inc.timeline.push({ at: Date.now(), text: `${wo.id}: ${next}` });
  if (next === 'Completed') {
    wo.completion = { at: Date.now(), ...completion };
    if (inc) {
      // Repair clears the physical problem; readings recover on the next ticks.
      if (state.zoneIssues[inc.zone]) delete state.zoneIssues[inc.zone];
      advanceReports(inc.reportIds, 'repair_completed', 'Repair work is complete. The provider is verifying that service has recovered.');
      inc.status = 'Monitoring';
      inc.timeline.push({ at: Date.now(), text: 'Repair completed — monitoring readings for recovery' });
    }
    if (state.pumpsOffline.includes(wo.assetId)) {
      state.pumpsOffline = state.pumpsOffline.filter((p) => p !== wo.assetId);
      const a = state.assets.find((x) => x.id === wo.assetId);
      if (a) a.status = 'normal';
    }
    const asset = state.assets.find((x) => x.id === wo.assetId);
    if (asset) {
      asset.lastMaint = Date.now();
      if (asset.status === 'warning' || asset.status === 'offline') asset.status = 'normal';
    }
  }
  commit(`${id} → ${next}`);
}

export function addWorkOrderNote(id, text) {
  const wo = state.workOrders.find((w) => w.id === id);
  wo.notes.push({ at: Date.now(), by: wo.team || 'Technician', text });
  commit('Technician note added');
}

export function setWorkOrderPhoto(id, which, dataUrl) {
  const wo = state.workOrders.find((w) => w.id === id);
  wo.photos[which] = dataUrl;
  commit(`${which === 'before' ? 'Before' : 'After'} photo attached`);
}

// ---------------------------------------------------------------- advisories
export async function publishAdvisory(data) {
  const id = await nextId('adv', () => `ADV-2026-${String(state.advSeq++).padStart(3, '0')}`);
  const now = Date.now();
  const adv = { id, status: 'Active', updatedAt: now, ...data };
  state.advisories.unshift(adv);
  const inc = state.incidents.find((i) => i.id === data.incidentId);
  if (inc) {
    inc.advisoryIds.push(id);
    inc.timeline.push({ at: now, text: `Advisory ${id} published to ${data.areas.map((z) => `Zone ${z}`).join(', ')}` });
  }
  notifyZones(data.areas, { kind: 'advisory', title: `New water advisory: ${data.title}`, body: data.message, link: '#/r/advisories' });
  commit(`Advisory ${id} published to residents`);
  return adv;
}

export function updateAdvisory(id, patch) {
  const a = state.advisories.find((x) => x.id === id);
  Object.assign(a, patch, { updatedAt: Date.now() });
  notifyZones(a.areas, { kind: 'advisory', title: `Advisory updated: ${a.title}`, body: patch.message || a.message, link: '#/r/advisories' });
  commit('Advisory updated');
}

export function confirmAltWater(id, patch) {
  const p = state.altWater.find((x) => x.id === id);
  Object.assign(p, patch, { confirmedAt: Date.now() });
  if (patch.status === 'AVAILABLE') notifyZones([p.zone], { kind: 'water', title: 'Emergency water available', body: `${p.name} — ${p.hours}`, link: '#/r/water-access' });
  commit('Distribution point confirmed');
}

export function updateEmergencyTank(id, patch) {
  const t = state.emergencyTanks.find((x) => x.id === id);
  Object.assign(t, patch, { updatedAt: Date.now() });
  commit('Manual tank record updated');
}

// ---------------------------------------------------------------- scenarios
export async function applyScenario(key) {
  const s = state;
  const now = Date.now();
  // storage jumps are shared so every device's simulation starts from the same level
  const setVolume = (v) => ((s.tele.volML = v), (s.volOverride = { volML: v, at: now }));
  if (key === 'normal') {
    s.factors = { demandMult: 1, inflowMult: 1 };
    s.zoneIssues = {};
    s.pumpsOffline = [];
    s.emergency = { active: false, poolML: 0 };
    s.activeScenarios = [];
    s.assets.forEach((a) => a.id.startsWith('PS') && (a.status = 'normal'));
    if (s.tele.volML / RES_CAP_ML < 0.6) setVolume(0.66 * RES_CAP_ML);
  } else {
    if (!s.activeScenarios.includes(key)) s.activeScenarios.push(key);
    if (key === 'highDemand') s.factors.demandMult = 1.22;
    if (key === 'lowReservoir') setVolume(0.335 * RES_CAP_ML), (s.factors.demandMult = Math.max(s.factors.demandMult, 1.06));
    if (key === 'pumpFailure') {
      if (!s.pumpsOffline.includes('PS-01')) s.pumpsOffline.push('PS-01');
      const a = s.assets.find((x) => x.id === 'PS-01');
      a.status = 'critical';
      a.failures.unshift({ at: now, text: 'Unit 1 tripped on motor overload (simulated scenario)' });
    }
    if (key === 'pipelineLeak') s.zoneIssues.C = { type: 'leak', label: 'Suspected main break — Zone C', pressureDrop: 14, flowChange: 18, lossML: 0.6, since: now, spawn: true };
    if (key === 'lowPressure') s.zoneIssues.B = { type: 'line', label: 'Distribution-line problem — Zone B', pressureDrop: 17, flowChange: -21, lossML: 0.5, since: now, spawn: true };
    if (key === 'sourceDisruption') s.factors.inflowMult = 0.62;
    if (key === 'emergencySupply') {
      s.emergency = { active: true, poolML: 0.4 };
      notifyZones(remote ? ZONES.map((z) => z.id) : [], { kind: 'water', title: 'Emergency water supply activated', body: 'Backup storage is now supplementing the system. Distribution points are listed in Alternative Water Access.', link: '#/r/water-access' });
    }
    // On the shared backend, a pressure problem brings one batch of simulated resident reports.
    const issueZone = key === 'pipelineLeak' ? 'C' : key === 'lowPressure' ? 'B' : null;
    if (remote && issueZone) {
      const ids = await remote.allocIds('report', 8);
      ids.forEach((id) => spawnReport(issueZone, s.zoneIssues[issueZone].type, id));
    }
  }
  s.scenario = key;
  s.scenarioLog.unshift({ at: now, key });
  updateDerived(s.tele, s.tele.simTime);
  syncAlertNotifications();
  commit(`Scenario applied: ${SCENARIOS[key].label}`, 'info');
}
