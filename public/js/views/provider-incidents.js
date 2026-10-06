// Provider: Incident & report inbox, incident detail, work orders.
import * as S from '../store.js';
import { ZONES, zoneById, CRITICAL_FACILITIES, reportTypeLabel, REPORT_TYPES, WO_STEPS, TEAMS } from '../data.js';
import { icon, status, src, card, kpi, timeline, activityLog, empty, tabs, table, field, openModal, closeOverlay, register, registerInputs, formData, confirmDialog, updatedAgo, priorityBadge, sevBadge, alertBanner, SEV, pill, busy } from '../ui.js';
import { lineChart, sparkline } from '../charts.js';
import { renderMap } from '../map.js';
import { esc, fmt, fmtTime, fmtTime24, fmtDate, fmtDateTime, relTime, toLocalInput, fromLocalInput, readImage } from '../util.js';
import { go } from '../app.js';
import * as B from '../backend.js';
import { openWorkOrderModal, openAdvisoryModal, incStatus, woStatusBadge, incSev, incidentTable } from './provider-shared.js';

const st = () => S.getState();
let selCluster = null;
let inboxTab = 'inbox';

// ---------------------------------------------------------------- evidence helpers
function zoneEvidence(zone) {
  const s = st();
  const z = zoneById(zone);
  const zt = s.tele.zones[zone];
  const lvl = s.tele.volML / S.RES_CAP_ML;
  const pressDelta = zt.pressure - z.basePressure;
  return [
    { k: 'Pressure', v: zt.status === 'normal' ? 'Within normal range' : 'Below normal', d: `${fmt(zt.pressure, 0)} PSI vs ~${z.basePressure} PSI normal (${fmt(pressDelta, 0)} PSI)`, sev: zt.status, src: 'SIMULATED' },
    { k: 'Flow', v: Math.abs(zt.flowDeltaPct) < 8 ? 'As expected' : zt.flowDeltaPct < 0 ? `Down ${fmt(-zt.flowDeltaPct, 0)}%` : `Up ${fmt(zt.flowDeltaPct, 0)}%`, d: `${fmt(zt.flow, 1)} L/s at zone inlet`, sev: Math.abs(zt.flowDeltaPct) < 8 ? 'normal' : 'warning', src: 'SIMULATED' },
    { k: 'Storage', v: lvl > 0.42 ? 'Stable' : 'Low', d: `Poblacion 13 reservoir ${Math.round(lvl * 100)}%`, sev: lvl > 0.42 ? 'normal' : lvl > S.MIN_RESERVE ? 'warning' : 'critical', src: 'SIMULATED' },
    { k: 'Equipment', v: s.pumpsOffline.length ? `${s.pumpsOffline.join(', ')} offline` : 'No equipment alarms', d: s.pumpsOffline.length ? 'Supply reduced while pumps are down' : 'Pumps reporting normally', sev: s.pumpsOffline.length ? 'critical' : 'normal', src: 'SIMULATED' },
  ];
}

function typeBreakdown(reps) {
  const counts = {};
  reps.forEach((r) => (counts[r.type] = (counts[r.type] || 0) + 1));
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => ({ t, n, label: reportTypeLabel(t) }));
}

// ---------------------------------------------------------------- INBOX
const dot = (sev) => `<span class="sys-dot sys-dot--${SEV[sev].cls}" aria-hidden="true"></span>`;
const clusterOf = (zone) => S.reportClusters().find((x) => x.zone === zone);
const openIncidentIn = (zone) => st().incidents.find((i) => i.zone === zone && i.status !== 'Resolved' && i.type !== 'Equipment' && i.type !== 'Water Quality');

function clusterList() {
  const clusters = S.reportClusters();
  if (!clusters.length) return empty('Inbox clear', 'No unreviewed resident reports.', 'check-circle');
  const s = st();
  const total = clusters.reduce((a, c) => a + c.reports.length, 0);
  return `<ul class="ib-list">${clusters
    .map((c) => {
      const z = zoneById(c.zone);
      const zt = s.tele.zones[c.zone];
      const on = selCluster === c.zone;
      const br = typeBreakdown(c.reports).slice(0, 3).map((b) => `${b.n} ${b.label.toLowerCase()}`).join(', ');
      const share = (c.reports.length / total) * 100;
      return `<li><button class="ib-item ${on ? 'is-on' : ''}" data-action="inbox-sel" data-zone="${c.zone}" aria-pressed="${on}">
        <span class="ib-item-main">
          <span class="ib-item-h">${dot(zt.status)}<strong>${esc(z.name)}</strong></span>
          <span class="ib-item-s">${esc(br.charAt(0).toUpperCase() + br.slice(1))}</span>
          <span class="ib-share" aria-hidden="true"><span style="width:${share}%"></span></span>
          <span class="ib-item-f">${zt.status === 'normal' ? 'Pressure normal' : `Pressure ${fmt(zt.pressure, 0)} PSI`}, since ${fmtTime(c.reports[0].submittedAt)}</span>
        </span>
        <span class="ib-item-n"><strong>${c.reports.length}</strong><small>reports</small></span>
        ${icon('chev-r', 16, 'ib-chev')}
      </button></li>`;
    })
    .join('')}</ul>`;
}

function wsHead() {
  const c = clusterOf(selCluster);
  if (!c) return '';
  const z = zoneById(c.zone);
  const inc = openIncidentIn(c.zone);
  return `<div class="ib-head"><div><div class="ib-k">Possible service issue</div><h2>${esc(z.name)}</h2><div class="ib-sub">${esc(z.barangays.join(', '))}, ${fmt(z.connections)} service connections</div></div>
    <div class="ib-actions">
      <button class="btn btn--ghost btn--sm" data-action="inbox-ack" data-zone="${c.zone}">${icon('check', 15)} Acknowledge only</button>
      ${inc ? `<button class="btn btn--outline btn--sm" data-action="inbox-link" data-zone="${c.zone}" data-inc="${inc.id}">${icon('link', 15)} Link to ${inc.id}</button>` : ''}
      <button class="btn btn--primary btn--sm" data-action="inbox-create" data-zone="${c.zone}">${icon('plus', 15)} Create incident</button>
    </div></div>`;
}

function wsSummary() {
  const c = clusterOf(selCluster);
  if (!c) return '';
  const br = typeBreakdown(c.reports);
  const inc = openIncidentIn(c.zone);
  return `<div class="ib-sum">
    <div class="ib-stat"><span class="ib-stat-v">${c.reports.length}</span><span class="ib-stat-l">unreviewed resident reports</span>${src('RESIDENT REPORTED')}</div>
    <table class="ib-br"><tbody>${br.map((b) => `<tr><th>${esc(b.label)}</th><td><div class="meter"><span style="width:${(b.n / c.reports.length) * 100}%"></span></div></td><td class="num">${b.n}</td></tr>`).join('')}</tbody></table>
    <dl class="ib-times"><div><dt>First</dt><dd>${fmtTime(c.reports[0].submittedAt)}</dd></div><div><dt>Latest</dt><dd>${relTime(c.reports[c.reports.length - 1].submittedAt).replace(' minutes', ' min').replace(' minute', ' min')}</dd></div><div><dt>Incident</dt><dd>${inc ? `<a href="#/p/incidents/${inc.id}" class="mono">${inc.id}</a>` : 'None'}</dd></div></dl>
  </div>`;
}

function wsEvidence() {
  const c = clusterOf(selCluster);
  if (!c) return '';
  const ev = zoneEvidence(c.zone);
  const n = ev.filter((e) => e.sev !== 'normal').length;
  return `<div class="ib-sec">
    <div class="ib-sec-h"><h3>Supporting operational information</h3>${src('SIMULATED')}</div>
    <div class="ib-ev">${ev.map((e) => `<div class="ib-ev-c"><span class="ib-ev-k">${e.k}</span><span class="ib-ev-v">${dot(e.sev)}${esc(e.v)}</span><span class="ib-ev-d">${esc(e.d)}</span></div>`).join('')}</div>
    <div class="ib-assess">${dot(n ? 'warning' : 'info')}<div><strong>${n ? `Readings support the reports on ${n} of 4 indicators` : 'Readings do not yet support these reports'}</strong><span>${n ? 'Review the evidence, then create an incident or link these reports to an open one.' : 'Reports alone do not determine an incident. Consider a field check first.'} Incidents are never created automatically from report counts.</span></div></div>
  </div>`;
}

function wsReports() {
  const c = clusterOf(selCluster);
  if (!c) return '';
  const rows = c.reports.slice().reverse();
  return `<div class="ib-sec">
    <div class="ib-sec-h"><h3>Reports in this cluster</h3><span class="muted sm">${rows.length} total, newest first</span></div>
    <div class="ib-tbl">${table(
      [
        { label: 'Report', render: (r) => `<span class="mono">${r.id}</span>${r.simulated ? '<div class="it-s">Simulated (demo)</div>' : r.mine ? '<div class="it-s">Your report</div>' : ''}` },
        { label: 'Problem', render: (r) => esc(reportTypeLabel(r.type)) },
        { label: 'Location', render: (r) => `<span class="ib-loc">${esc(r.location)}</span>` },
        { label: 'Submitted', render: (r) => `<span class="nowrap">${fmtTime(r.submittedAt)}</span><div class="it-s">${relTime(r.submittedAt)}</div>` },
        { label: 'Status', render: (r) => (r.status === 'submitted' ? '<span class="muted">Awaiting review</span>' : 'Acknowledged') },
      ],
      rows
    )}</div>
  </div>`;
}

const incidents = {
  title: 'Incidents',
  regions: { list: clusterList, head: wsHead, summary: wsSummary, evidence: wsEvidence, reports: wsReports },
  map() {
    return renderMap({ mode: 'provider', layers: ['zones', 'pipes', 'reports', 'incidents', 'facilities'], focusZone: selCluster, toggles: false, compact: true });
  },
  render() {
    const s = st();
    const clusters = S.reportClusters();
    if (!selCluster || !clusters.find((c) => c.zone === selCluster)) selCluster = clusters[0]?.zone || null;
    const open = s.incidents.filter((i) => i.status !== 'Resolved');
    const unrev = clusters.reduce((a, c) => a + c.reports.length, 0);
    const R = this.regions;
    const head = `<div class="page-h"><div><h1>Incidents</h1><p class="page-sub">Resident reports become operational evidence. Review clusters, confirm with readings, then act.</p></div></div>
      ${tabs([{ id: 'inbox', label: 'Report inbox', count: unrev }, { id: 'active', label: 'Active incidents', count: open.length }, { id: 'resolved', label: 'Resolved' }], inboxTab, 'inc-tab')}`;
    if (inboxTab === 'inbox')
      return `${head}<div class="ib">
        <section class="card ib-side">
          <header class="card-h"><div><h2 class="card-t">Report clusters</h2><p class="card-sub">Unreviewed reports grouped by bone</p></div><div class="ib-total"><strong>${unrev}</strong><span>${clusters.length} zone${clusters.length === 1 ? '' : 's'}</span></div></header>
          <div class="card-b ib-side-b" data-region="list">${R.list()}</div>
          <div class="ib-steps"><div class="ib-steps-h">How to triage</div><ol><li>Select a cluster</li><li>Compare reports with system readings</li><li>Create an incident or link to an open one</li></ol></div>
        </section>
        <section class="card ib-work">${
          selCluster
            ? `<div class="card-b">
                <div data-region="head">${R.head()}</div>
                <div class="ib-top"><div class="ib-map">${this.map()}</div><div data-region="summary">${R.summary()}</div></div>
                <div data-region="evidence">${R.evidence()}</div>
                <div data-region="reports">${R.reports()}</div>
              </div>`
            : `<div class="card-b">${empty('No unreviewed report clusters', 'New resident reports will be grouped here by location.', 'check-circle')}</div>`
        }</section>
      </div>`;
    const list = inboxTab === 'active' ? open : s.incidents.filter((i) => i.status === 'Resolved');
    return `${head}${card('', incidentTable(list, 'No incidents'))}`;
  },
};

register({
  'inc-tab': (el) => ((inboxTab = el.dataset.id), go('#/p/incidents')),
  'inbox-sel': (el) => {
    selCluster = el.dataset.zone;
    go('#/p/incidents');
  },
  'goto-inc': (el) => go(`#/p/incidents/${el.dataset.id}`),
  'inbox-ack': (el) => {
    const c = S.reportClusters().find((x) => x.zone === el.dataset.zone);
    S.acknowledgeReports(c.reports.filter((r) => r.status === 'submitted').map((r) => r.id));
  },
  'inbox-link': async (el) => {
    const c = S.reportClusters().find((x) => x.zone === el.dataset.zone);
    S.linkReports(el.dataset.inc, c.reports.map((r) => r.id));
  },
  'inbox-create': (el) => {
    const c = S.reportClusters().find((x) => x.zone === el.dataset.zone);
    const z = zoneById(c.zone);
    const br = typeBreakdown(c.reports);
    const ev = zoneEvidence(c.zone);
    const main = br[0]?.t;
    const suggestedSev = ev.some((e) => e.sev === 'critical') || c.reports.length > 15 ? 'High' : ev.some((e) => e.sev === 'warning') ? 'Medium' : 'Low';
    const title = `${main === 'leak' ? 'Pipe Leak' : main === 'no_water' ? 'No Water' : main === 'color' ? 'Water Quality' : 'Low Pressure'} — ${z.short}`;
    openModal(
      'Create Incident',
      `<form class="form" id="inc-form">
        <div class="grid-2">
          ${field('Title', `<input name="title" id="inc-title" value="${esc(title)}"/>`, { id: 'inc-title', req: true })}
          ${field('Type', `<select name="type" id="inc-type">${['Low Pressure', 'Leak', 'Supply Interruption', 'Water Quality', 'Equipment'].map((t) => `<option ${t === (main === 'leak' ? 'Leak' : main === 'no_water' ? 'Supply Interruption' : 'Low Pressure') ? 'selected' : ''}>${t}</option>`).join('')}</select>`, { id: 'inc-type', req: true })}
          ${field('Severity', `<select name="severity" id="inc-sev">${['Critical', 'High', 'Medium', 'Low'].map((t) => `<option ${t === suggestedSev ? 'selected' : ''}>${t}</option>`).join('')}</select>`, { id: 'inc-sev', req: true, hint: `Suggested from evidence: ${suggestedSev}. Operator decides.` })}
          ${field('Affected barangay', `<input id="inc-zone" value="${esc(z.name)}" disabled/>`, { id: 'inc-zone' })}
        </div>
        <div class="field"><span class="field-l">Evidence reviewed <span class="req">*</span></span><p class="field-h">Confirm which operational evidence supports this incident. Report count alone is not sufficient.</p>
          <div class="stack-sm">${ev.map((e) => `<label class="chk"><input type="checkbox" name="evidence" data-multi="1" value="${e.k}" ${e.sev !== 'normal' ? 'checked' : ''}/> ${e.k}: ${esc(e.v)} <span class="muted">(${esc(e.d)})</span></label>`).join('')}
          <label class="chk"><input type="checkbox" name="evidence" data-multi="1" value="Resident reports" checked/> Resident reports: ${c.reports.length} in ${esc(z.short)}</label></div></div>
        ${field('Operator note', '<textarea name="note" id="inc-note" rows="2" placeholder="e.g. Pressure drop matches the report cluster."></textarea>', { id: 'inc-note', optional: true })}
      </form>`,
      { footer: `<button class="btn btn--ghost" data-action="ov-close">Cancel</button><button class="btn btn--primary" data-action="inc-create" data-zone="${c.zone}">${icon('alert', 15)} Create incident</button>` }
    );
  },
  'inc-create': (el) => busy(el, async () => {
    const d = formData(document.getElementById('inc-form'));
    const ops = (d.evidence || []).filter((x) => x !== 'Resident reports');
    if (!ops.length) return S.toast('Confirm at least one operational evidence item (pressure, flow, storage, or equipment).', 'error');
    const c = S.reportClusters().find((x) => x.zone === el.dataset.zone);
    const inc = await S.createIncident({ zone: c.zone, reportIds: c.reports.map((r) => r.id), title: d.title, type: d.type, severity: d.severity, note: d.note, evidence: d.evidence });
    closeOverlay();
    go(`#/p/incidents/${inc.id}`);
  }),
});

// ---------------------------------------------------------------- INCIDENT DETAIL
function incCondition(i) {
  const s = st();
  const z = zoneById(i.zone);
  const zt = s.tele.zones[i.zone];
  const h = s.history;
  const n = 72; // 6 h
  const slice = (a) => a.slice(-n);
  const labels = slice(h.t).map((t, k) => `${Math.round(((k - n + 1) * S.DT_MIN) / 60 * 10) / 10} h`);
  const ticks = [0, 24, 48, n - 1].map((k) => ({ i: k, label: k === n - 1 ? 'Now' : `−${Math.round(((n - 1 - k) * S.DT_MIN) / 60)} h` }));
  return `<div class="grid-2 grid-2--tight">
    <div>${lineChart({ id: `inc-p-${i.id}`, label: `Pressure, ${z.short}, last 6 simulated hours`, series: [{ name: `${z.short} pressure`, color: '#1D6FB8', values: slice(h.pressure[i.zone]), area: true }], labels, xTicks: ticks, thresholds: [{ y: 26, label: 'Low-pressure alarm', color: '#D97706' }], yMin: 0, yFmt: (v) => `${Math.round(v)} PSI`, h: 170 })}
      <div class="chart-cap">Pressure readings ${src('SIMULATED')}, now ${fmt(zt.pressure, 0)} PSI</div></div>
    <div>${lineChart({ id: `inc-f-${i.id}`, label: `Flow, ${z.short}, last 6 simulated hours`, series: [{ name: `${z.short} inlet flow`, color: '#13A8C4', values: slice(h.flow[i.zone]), area: true }], labels, xTicks: ticks, yMin: 0, yFmt: (v) => `${fmt(v, 1)} L/s`, h: 170 })}
      <div class="chart-cap">Flow readings ${src('SIMULATED')}, ${zt.flowDeltaPct >= 0 ? '+' : ''}${fmt(zt.flowDeltaPct, 0)}% vs expected</div></div></div>`;
}

const incidentDetail = {
  title: 'Incident Detail',
  regions: {
    cond({ id }) {
      const i = st().incidents.find((x) => x.id === id);
      return i ? incCondition(i) : '';
    },
    live({ id }) {
      const s = st();
      const i = s.incidents.find((x) => x.id === id);
      const zt = s.tele.zones[i.zone];
      const z = zoneById(i.zone);
      return `<span class="${zt.status !== 'normal' ? 'txt-warn' : 'txt-ok'}">${icon(SEV[zt.status].icon, 14)} ${zt.status === 'normal' ? 'Readings within normal range' : 'Readings below normal'}</span> — pressure ${fmt(zt.pressure, 0)} PSI (normal ~${z.basePressure}), flow ${zt.flowDeltaPct >= 0 ? '+' : ''}${fmt(zt.flowDeltaPct, 0)}% ${src('SIMULATED')}`;
    },
  },
  render({ id }) {
    const s = st();
    const i = s.incidents.find((x) => x.id === id);
    if (!i) return empty('Incident not found', '', 'search', '<a class="btn btn--outline btn--sm" href="#/p/incidents">Back to incidents</a>');
    const z = zoneById(i.zone);
    const reps = s.reports.filter((r) => i.reportIds.includes(r.id));
    const br = typeBreakdown(reps);
    const wos = s.workOrders.filter((w) => i.workOrderIds.includes(w.id));
    const advs = s.advisories.filter((a) => i.advisoryIds.includes(a.id));
    const fac = CRITICAL_FACILITIES.filter((f) => i.facilities.includes(f.id));
    const resp = reps.filter((r) => r.residentResponse);
    const restored = resp.filter((r) => r.residentResponse.restored).length;
    const equipAlerts = S.deriveAlerts().filter((a) => a.cat === 'Equipment' || (a.cat === 'Distribution' && a.key.endsWith(i.zone)));
    const resolved = i.status === 'Resolved';
    const woDone = wos.length && wos.every((w) => w.status === 'Completed');
    const newRelated = S.reportClusters().find((c) => c.zone === i.zone);
    return `<a class="back" href="#/p/incidents">${icon('chev-l', 16)} Incidents</a>
    <div class="page-h page-h--inc"><div><div class="mono muted">${i.id}</div><h1>${esc(i.title)}</h1>
      <div class="inc-badges"><span>Status:</span> ${incStatus(i)} <span>Severity:</span> ${sevBadge(i.severity)} <span>Type:</span> <span class="muted">${esc(i.type)}</span></div></div>
      <div class="page-a inc-actions">
        ${!resolved ? `<button class="btn btn--primary btn--sm" data-action="wo-new" data-inc="${i.id}" data-pri="${i.severity === 'Low' ? 'Low' : i.severity === 'Medium' ? 'Medium' : 'High'}">${icon('wrench', 15)} Create Work Order</button>
        <button class="btn btn--outline btn--sm" data-action="adv-new" data-inc="${i.id}">${icon('megaphone', 15)} Publish Advisory</button>
        <button class="btn btn--ghost btn--sm" data-action="inc-update" data-id="${i.id}">${icon('file', 15)} Update Incident</button>
        <button class="btn btn--success btn--sm" data-action="inc-resolve" data-id="${i.id}">${icon('check-circle', 15)} Resolve Incident</button>` : `<span class="muted">Resolved ${fmtDateTime(i.resolvedAt)}</span>`}
      </div></div>
    ${newRelated && !resolved ? alertBanner('info', `${newRelated.reports.length} new resident report${newRelated.reports.length > 1 ? 's' : ''} in ${z.short} not yet linked`, '', `<button class="btn btn--sm btn--outline" data-action="inbox-link" data-zone="${i.zone}" data-inc="${i.id}">Link as evidence</button>`) : ''}
    ${woDone && !resolved ? alertBanner('normal', 'All work orders completed', 'Confirm that operational readings have recovered, then resolve the incident to notify residents.') : ''}
    <div class="inc-grid">
      <div class="inc-main">
        ${card(
          'Incident Summary',
          `<dl class="kv kv--3">
            <div><dt>Detection time</dt><dd>${fmtDateTime(i.detectedAt)}</dd></div>
            <div><dt>Affected zones</dt><dd>${i.zones.map((zz) => esc(zoneById(zz).name)).join(', ')}<br/><span class="muted sm">${esc(z.barangays.join(', '))}</span></dd></div>
            <div><dt>Est. affected connections</dt><dd>${fmt(i.connections)} ${src('ESTIMATED')}</dd></div>
            <div><dt>Critical facilities</dt><dd>${fac.length ? fac.map((f) => `${icon('hospital', 13)} ${esc(f.name)}`).join('<br/>') : 'None in affected area'}</dd></div>
            <div class="kv-wide"><dt>Current operational condition</dt><dd data-region="live">${this.regions.live({ id })}</dd></div>
          </dl>`
        )}
        ${card(
          'Evidence',
          `<div class="evg">
            <div class="evg-i"><div class="evg-h">${icon('users', 16)} Resident reports ${src('RESIDENT REPORTED')}</div><div class="evg-v">${reps.length}</div><div class="evg-d">${br.map((b) => `${b.n} ${esc(b.label)}`).join(', ') || 'No reports linked'}</div></div>
            <div class="evg-i"><div class="evg-h">${icon('gauge', 16)} Pressure readings</div><div class="evg-v">${fmt(s.tele.zones[i.zone].pressure, 0)} <small>PSI</small></div><div class="evg-d">Normal ~${z.basePressure} PSI ${src('SIMULATED')}</div></div>
            <div class="evg-i"><div class="evg-h">${icon('activity', 16)} Flow readings</div><div class="evg-v">${fmt(s.tele.zones[i.zone].flow, 1)} <small>L/s</small></div><div class="evg-d">${s.tele.zones[i.zone].flowDeltaPct >= 0 ? '+' : ''}${fmt(s.tele.zones[i.zone].flowDeltaPct, 0)}% vs expected ${src('SIMULATED')}</div></div>
            <div class="evg-i"><div class="evg-h">${icon('zap', 16)} Equipment & area alerts</div><div class="evg-v">${equipAlerts.length}</div><div class="evg-d">${equipAlerts.map((a) => esc(a.title)).join('; ') || 'None'}</div></div>
          </div>
          <div data-region="cond">${incCondition(i)}</div>
          ${i.evidence?.length ? `<p class="sm muted">Evidence confirmed by operator at creation: ${i.evidence.map(esc).join(', ')}</p>` : ''}
          <h3 class="sec-t sm">Operator notes</h3>
          ${i.notes.length ? `<ul class="notes">${i.notes.map((n) => `<li><div class="notes-h"><strong>${esc(n.by)}</strong><time>${fmtDateTime(n.at)}</time></div><p>${esc(n.text)}</p></li>`).join('')}</ul>` : '<p class="muted sm">No notes yet.</p>'}
          ${!resolved ? `<div class="note-add"><label class="sr-only" for="inc-note-in">Add operator note</label><input id="inc-note-in" placeholder="Add an operator note…"/><button class="btn btn--outline btn--sm" data-action="inc-note" data-id="${i.id}">Add note</button></div>` : ''}`
        )}
        ${card(
          'Work orders',
          wos.length
            ? wos.map((w) => woCard(w)).join('')
            : empty('No work orders yet', 'Create a work order to dispatch a field team.', 'wrench', !resolved ? `<button class="btn btn--primary btn--sm" data-action="wo-new" data-inc="${i.id}">Create Work Order</button>` : '')
        )}
      </div>
      <div class="inc-side">
        ${card('Activity Timeline', activityLog([...i.timeline].sort((a, b) => a.at - b.at)))}
        ${card('Affected area', renderMap({ mode: 'provider', layers: ['zones', 'pipes', 'reports', 'incidents', 'facilities'], focusZone: i.zone, selected: i.id, toggles: false, compact: true }), { cls: 'card--flush' })}
        ${card(
          'Advisories',
          advs.length
            ? advs.map((a) => `<div class="mini-adv"><div>${status(a.status === 'Active' ? 'warning' : 'normal', a.status === 'Active' ? a.serviceStatus : 'Resolved')} <span class="mono muted sm">${a.id}</span></div><strong>${esc(a.title)}</strong><span class="muted sm">Published ${fmtDateTime(a.startAt)}, next update ${a.nextUpdate ? fmtTime(a.nextUpdate) : '—'}</span></div>`).join('')
            : empty('No advisory published', 'Residents are not yet informed about this incident.', 'megaphone', !resolved ? `<button class="btn btn--outline btn--sm" data-action="adv-new" data-inc="${i.id}">Publish Advisory</button>` : '')
        )}
        ${card(
          'Resident verification',
          `<div class="verif"><div><strong>${restored}</strong><span>Service restored</span></div><div><strong>${resp.length - restored}</strong><span>Problem still exists</span></div><div><strong>${reps.filter((r) => r.awaitingVerification && !r.residentResponse).length}</strong><span>Awaiting response</span></div></div>
          <p class="fine">After resolution, reporting residents are asked to confirm whether service has returned. ${src('RESIDENT REPORTED')}</p>`
        )}
      </div>
    </div>`;
  },
};

function woCard(w) {
  const i = WO_STEPS.indexOf(w.status);
  return `<a class="woc" href="#/p/work-orders/${w.id}">
    <div class="woc-h"><span class="mono">${w.id}</span>${woStatusBadge(w)}${priorityBadge(w.priority)}</div>
    <div class="woc-t">${esc(w.description)}</div>
    <div class="woc-steps" aria-label="Step ${i + 1} of ${WO_STEPS.length}">${WO_STEPS.map((x, k) => `<span class="${k <= i ? 'on' : ''}" title="${x}"></span>`).join('')}</div>
    <div class="woc-f"><span>${icon('users', 13)} ${esc(w.team || 'Unassigned')}</span><span>${icon('clock', 13)} Target ${fmtDateTime(w.target)}</span></div></a>`;
}

register({
  'inc-note': (el) => {
    const inp = document.getElementById('inc-note-in');
    if (inp.value.trim()) S.addIncidentNote(el.dataset.id, inp.value.trim());
  },
  'inc-update': (el) => {
    const i = st().incidents.find((x) => x.id === el.dataset.id);
    openModal(
      `Update ${i.id}`,
      `<form class="form" id="incu-form"><div class="grid-2">
        ${field('Status', `<select name="status" id="iu-st">${['Investigating', 'Response in Progress', 'Monitoring'].map((x) => `<option ${x === i.status ? 'selected' : ''}>${x}</option>`).join('')}</select>`, { id: 'iu-st', req: true })}
        ${field('Severity', `<select name="severity" id="iu-sev">${['Critical', 'High', 'Medium', 'Low'].map((x) => `<option ${x === i.severity ? 'selected' : ''}>${x}</option>`).join('')}</select>`, { id: 'iu-sev', req: true })}
        ${field('Est. affected connections', `<input type="number" name="connections" id="iu-conn" value="${i.connections}" min="0"/>`, { id: 'iu-conn' })}
      </div>${field('Update note', '<textarea name="note" id="iu-note" rows="2"></textarea>', { id: 'iu-note', optional: true })}</form>`,
      { footer: `<button class="btn btn--ghost" data-action="ov-close">Cancel</button><button class="btn btn--primary" data-action="inc-update-save" data-id="${i.id}">Save update</button>` }
    );
  },
  'inc-update-save': (el) => {
    const d = formData(document.getElementById('incu-form'));
    const i = st().incidents.find((x) => x.id === el.dataset.id);
    const changes = [];
    if (d.status !== i.status) changes.push(`status → ${d.status}`);
    if (d.severity !== i.severity) changes.push(`severity → ${d.severity}`);
    if (d.note) i.notes.push({ at: Date.now(), by: 'Operator', text: d.note });
    closeOverlay();
    S.updateIncident(i.id, { status: d.status, severity: d.severity, connections: +d.connections || i.connections }, `Incident updated${changes.length ? ': ' + changes.join(', ') : ''}${d.note ? ` — ${d.note}` : ''}`);
  },
  'inc-resolve': (el) => {
    const s = st();
    const i = s.incidents.find((x) => x.id === el.dataset.id);
    const zt = s.tele.zones[i.zone];
    const openWo = s.workOrders.filter((w) => i.workOrderIds.includes(w.id) && w.status !== 'Completed');
    openModal(
      `Resolve ${i.id}`,
      `${openWo.length ? alertBanner('warning', `${openWo.length} work order${openWo.length > 1 ? 's are' : ' is'} not completed`, openWo.map((w) => w.id).join(', ')) : ''}
      ${zt.status !== 'normal' ? alertBanner('warning', 'Readings have not recovered', `${zoneById(i.zone).short} pressure is ${fmt(zt.pressure, 0)} PSI. Resolving now may be premature.`) : alertBanner('normal', 'Operational readings have recovered', `${zoneById(i.zone).short} pressure ${fmt(zt.pressure, 0)} PSI.`)}
      <form class="form" id="res-form">${field('Resolution notes', `<textarea id="res-notes" rows="3" placeholder="e.g. Replaced the failed coupling. Pressure restored to normal."></textarea>`, { id: 'res-notes', req: true })}</form>
      <p class="fine">Resolving will close linked advisories, notify residents that service is restored, and ask reporting residents to confirm whether water service has returned.</p>`,
      { footer: `<button class="btn btn--ghost" data-action="ov-close">Cancel</button><button class="btn btn--success" data-action="inc-resolve-do" data-id="${i.id}">${icon('check-circle', 15)} Resolve & notify residents</button>` }
    );
  },
  'inc-resolve-do': (el) => {
    const notes = document.getElementById('res-notes').value.trim();
    if (!notes) return S.toast('Add resolution notes before resolving', 'error');
    closeOverlay();
    S.resolveIncident(el.dataset.id, notes);
  },
});

// ---------------------------------------------------------------- WORK ORDERS
let woFilter = 'open';
export const setWoFilter = (f) => (woFilter = f);

function woProgress(w) {
  const i = WO_STEPS.indexOf(w.status);
  const late = w.status !== 'Completed' && w.target < Date.now();
  return `<div class="wo-prog ${late ? 'is-late' : ''} ${w.status === 'Completed' ? 'is-done' : ''}">
    <div class="wo-prog-t"><strong>${w.status}</strong><span>${i + 1}/${WO_STEPS.length}</span></div>
    <div class="wo-prog-b" aria-hidden="true">${WO_STEPS.map((_, k) => `<span class="${k <= i ? 'on' : ''}"></span>`).join('')}</div>
  </div>`;
}

function maintTable(rows) {
  const day = 864e5;
  const when = (r) => {
    if (!r.nextMaint) return '<span class="muted">Not scheduled</span>';
    const d = Math.round(Math.abs(r.due) / day);
    if (r.due < 0) return `<div class="wo-due is-late"><span>${fmtDate(r.nextMaint)}</span><small>${icon('alert', 12)} Overdue ${d || 1}d</small></div>`;
    return `<div class="wo-due ${r.due < 14 * day ? 'is-soon' : ''}"><span>${fmtDate(r.nextMaint)}</span><small>${d ? `in ${d}d` : 'today'}</small></div>`;
  };
  const state = (r) => (!r.nextMaint ? '<span class="muted">No schedule</span>' : `<span class="mt-state"><span class="sys-dot sys-dot--${r.due < 0 ? 'warn' : r.due < 14 * day ? 'info' : 'ok'}" aria-hidden="true"></span>${r.due < 0 ? 'Overdue' : r.due < 14 * day ? 'Due soon' : 'Scheduled'}</span>`);
  return `<div class="card wo-list">${table(
    [
      { label: 'Asset', render: (r) => `<div class="wo-id"><strong class="mono">${r.id}</strong><span>${esc(r.type)}</span></div>` },
      { label: 'Name', render: (r) => `<div class="wo-task">${esc(r.name)}</div>` },
      { label: 'Last serviced', render: (r) => `<span class="muted">${r.lastMaint ? fmtDate(r.lastMaint) : 'Not recorded'}</span>` },
      { label: 'Next due', render: when },
      { label: 'State', render: state },
      { label: 'Work order', render: (r) => (r.wo ? `<a class="mono" href="#/p/work-orders/${r.wo.id}">${r.wo.id}</a> <span class="muted sm">${r.wo.status}</span>` : `<button class="btn btn--outline btn--xs" data-action="wo-new" data-asset="${r.id}" data-pri="Low" data-desc="Scheduled preventive maintenance for ${esc(r.name)}.">${icon('plus', 13)} Schedule</button>`) },
    ],
    rows,
    { empty: 'No assets on the maintenance schedule' }
  )}</div>`;
}

function woTarget(w, now) {
  if (w.status === 'Completed') return `<div class="wo-due"><span>${fmtDateTime(w.target)}</span><small>Completed</small></div>`;
  const h = (w.target - now) / 3600e3;
  const span = (x) => (Math.abs(x) >= 24 ? `${Math.round(Math.abs(x) / 24)}d` : `${Math.max(1, Math.round(Math.abs(x)))}h`);
  return h < 0
    ? `<div class="wo-due is-late"><span>${fmtDateTime(w.target)}</span><small>${icon('alert', 12)} Overdue ${span(h)}</small></div>`
    : `<div class="wo-due ${h < 24 ? 'is-soon' : ''}"><span>${fmtDateTime(w.target)}</span><small>in ${span(h)}</small></div>`;
}
const workOrders = {
  title: 'Work Orders',
  render() {
    const s = st();
    const all = s.workOrders;
    const open = all.filter((w) => w.status !== 'Completed');
    const overdue = open.filter((w) => w.target < Date.now());
    const lists = { open, overdue, completed: all.filter((w) => w.status === 'Completed'), all };
    const list = lists[woFilter] || [];
    const now = Date.now();
    const done = lists.completed;
    const dueSoon = open.filter((w) => w.target >= now && w.target < now + 24 * 3600e3);
    const urgent = open.filter((w) => w.priority === 'High' || w.priority === 'Critical');
    // Preventive maintenance schedule (formerly its own page): assets by next due date.
    const maint = s.assets
      .map((a) => ({ ...a, due: a.nextMaint ? a.nextMaint - now : Infinity, wo: all.find((w) => w.assetId === a.id && w.status !== 'Completed') }))
      .sort((a, b) => a.due - b.due);
    const maintLate = maint.filter((r) => r.due < 0);
    const maintSoon = maint.filter((r) => r.due >= 0 && r.due < 14 * 864e5);
    const next = [...open].sort((a, b) => a.target - b.target)[0];
    // Stage counts for the open pipeline (Completed is shown separately).
    const stages = WO_STEPS.filter((x) => x !== 'Completed').map((x) => ({ x, n: open.filter((w) => w.status === x).length }));
    const flag = overdue.length ? ['warn', `${overdue.length} overdue`] : ['ok', 'On schedule'];
    const rank = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    // Most pressing first: overdue, then priority, then nearest target.
    const sorted = [...list].sort((a, b) => {
      const oa = a.status !== 'Completed' && a.target < now, ob = b.status !== 'Completed' && b.target < now;
      return ob - oa || (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9) || a.target - b.target;
    });
    return `<div class="page-h"><div><h1>Work Orders</h1><p class="page-sub">Field response workflow — from assignment to verified repair.</p></div><div class="page-a"><button class="btn btn--primary btn--sm" data-action="wo-new">${icon('plus', 15)} New work order</button></div></div>
      <div class="kgrid">
        <section class="kp-primary">
          <div class="kpi-top"><span class="kpi-label">Open Work Orders</span>${src('FIELD')}</div>
          <div class="kp-main"><div><div class="kpi-value kpi-value--xl">${open.length}</div>
            <div class="kpi-sub">${done.length} completed, ${all.length} total</div></div></div>
          <div class="wo-bar" role="img" aria-label="Open work orders by stage">${stages.filter((b) => b.n).map((b, k) => `<span class="wo-bar-s wo-bar-s--${k}" style="flex:${b.n}" title="${b.x}: ${b.n}"></span>`).join('') || '<span class="wo-bar-s is-empty" style="flex:1"></span>'}</div>
          <ul class="wo-stages">${stages.map((b, k) => `<li class="${b.n ? '' : 'is-zero'}"><span class="wo-key wo-bar-s--${k}" aria-hidden="true"></span><span>${b.x}</span><strong>${b.n}</strong></li>`).join('')}</ul>
          <div class="kp-foot"><span>${next ? `Next due <strong class="mono">${next.id}</strong>, ${fmtDateTime(next.target)}` : 'No open work orders'}</span><span class="kp-flag kp-flag--${flag[0]}">${flag[1]}</span></div>
        </section>
        ${kpi({ label: 'Overdue', value: overdue.length, sub: overdue.length ? `<span class="txt-warn">Past target time</span>` : 'All within target', sev: overdue.length ? 'warning' : null })}
        ${kpi({ label: 'Due in 24 hours', value: dueSoon.length, sub: dueSoon.length ? `Earliest ${fmtDateTime(Math.min(...dueSoon.map((w) => w.target)))}` : 'Nothing due today' })}
        ${kpi({ label: 'High priority', value: urgent.length, sub: urgent.length ? 'Open high / critical jobs' : 'No high-priority jobs', sev: urgent.length ? 'critical' : null })}
        ${kpi({ label: 'Maintenance overdue', value: maintLate.length, sub: `${maintSoon.length} more asset${maintSoon.length === 1 ? '' : 's'} due in 14 days`, sev: maintLate.length ? 'warning' : null })}
      </div>
      ${tabs([{ id: 'open', label: 'Open', count: open.length }, { id: 'overdue', label: 'Overdue', count: overdue.length }, { id: 'completed', label: 'Completed', count: done.length }, { id: 'all', label: 'All', count: all.length }, { id: 'maintenance', label: 'Maintenance schedule', count: maintLate.length + maintSoon.length }], woFilter, 'wo-tab')}
      ${woFilter === 'maintenance' ? maintTable(maint) : `<div class="card wo-list">${table(
        [
          { label: 'Work order', render: (w) => `<div class="wo-id"><strong class="mono">${w.id}</strong><span>${w.incidentId ? `<span class="mono">${w.incidentId}</span>` : 'Preventive'}, <span class="mono">${w.assetId}</span></span></div>` },
          { label: 'Task', render: (w) => `<div class="clamp2 wo-task">${esc(w.description)}</div>` },
          { label: 'Priority', render: (w) => priorityBadge(w.priority) },
          { label: 'Team', render: (w) => (w.team ? esc(w.team) : '<span class="muted">Unassigned</span>') },
          { label: 'Progress', render: (w) => woProgress(w) },
          { label: 'Target', render: (w) => woTarget(w, now) },
        ],
        sorted,
        { rowAction: { action: 'goto-wo', key: 'id' }, empty: 'No work orders in this view' }
      )}</div>`}
      ${respondersCard()}`;
  },
};

// ---------------------------------------------------------------- responders
// Field responders sign in with a generated email and see only the work orders assigned to them.
function respondersCard() {
  const list = S.responders();
  const open = (r) => st().workOrders.filter((w) => w.responder === r.loginEmail && w.status !== 'Completed').length;
  const cred = (r) => (r.credSent ? `<span>Sent</span><small>${fmtDateTime(r.sentAt)}</small>` : B.FB_ENABLED ? '<span class="txt-warn">Sending</span><small>Waiting for the email script</small>' : '<span class="muted">Not sent</span><small>Offline demo</small>');
  return `<section class="card rsp">
    <div class="rsp-h"><div><h2>Responders</h2><p>People who receive work orders in the field. Each one gets a sign-in email and a temporary password by email.</p></div><button class="btn btn--primary btn--sm" data-action="rsp-new">Add responder</button></div>
    ${list.length ? `<div class="rsp-wrap"><table class="tbl rsp-t"><thead><tr><th>Name</th><th>Sign-in email</th><th>Credentials sent to</th><th>Open jobs</th><th>Credentials</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
      ${list.map((r) => `<tr>
        <td><strong>${esc(r.name)}</strong>${r.phone ? `<div class="rsp-sub">${esc(r.phone)}</div>` : ''}</td>
        <td class="mono">${esc(r.loginEmail)}</td>
        <td>${esc(r.contactEmail)}</td>
        <td>${open(r)}</td>
        <td><div class="rsp-cred">${cred(r)}</div></td>
        <td class="rsp-a"><button class="btn btn--ghost btn--xs" data-action="rsp-remove" data-id="${esc(r.id)}">Remove</button></td>
      </tr>`).join('')}
    </tbody></table></div>` : '<p class="rsp-empty">No responders yet. Add one to assign work orders to field crews.</p>'}
  </section>`;
}

function openResponderModal() {
  openModal(
    'Add responder',
    `<div id="rsp-body"><form class="form" id="rsp-form" onsubmit="return false">
      ${field('Full name', '<input id="rsp-name" autocomplete="off" placeholder="e.g. Ramon Dacut"/>', { id: 'rsp-name', req: true })}
      ${field('Email', '<input id="rsp-email" type="email" autocomplete="off" placeholder="name@example.com"/>', { id: 'rsp-email', req: true, hint: 'The sign-in email and temporary password are sent here.' })}
      ${field('Mobile number', '<input id="rsp-phone" type="tel" autocomplete="off" placeholder="+63 9xx xxx xxxx"/>', { id: 'rsp-phone', optional: true })}
      <div class="auth-err" role="alert" hidden></div>
      <div class="as-a"><button class="btn btn--ghost" data-action="ov-close">Cancel</button><button class="btn btn--primary" data-action="rsp-create">Create account and send</button></div>
    </form></div>`
  );
}

function responderCreated(r) {
  const body = document.getElementById('rsp-body');
  if (!body) return;
  body.innerHTML = `<div class="rsp-done">
      <p>${B.FB_ENABLED ? `The account for <strong>${esc(r.name)}</strong> is ready. The credentials below are being emailed to <strong>${esc(r.contactEmail)}</strong>.` : `Offline demo: <strong>${esc(r.name)}</strong> was added to the list. No account is created and no email is sent.`}</p>
      <dl class="rsp-kv"><div><dt>Sign-in email</dt><dd class="mono">${esc(r.loginEmail)}</dd></div><div><dt>Temporary password</dt><dd class="mono">${esc(r.tempPassword)}</dd></div></dl>
      <p class="fine">They are asked to set their own password the first time they sign in. This password is not shown again.</p>
      <div class="as-a"><button class="btn btn--primary" data-action="ov-close">Done</button></div>
    </div>`;
}

register({
  'rsp-new': () => openResponderModal(),
  'rsp-create': (el) => {
    const v = (id) => document.getElementById(id).value.trim();
    const name = v('rsp-name').replace(/\s+/g, ' ');
    const contactEmail = v('rsp-email').toLowerCase();
    const phone = v('rsp-phone');
    const err = document.querySelector('#rsp-form .auth-err');
    const fail = (m) => ((err.hidden = false), (err.innerHTML = `<span>${esc(m)}</span>`));
    if (!name) return fail('Enter the full name of the responder.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return fail('Enter a valid email address.');
    if (S.responders().some((r) => r.contactEmail === contactEmail)) return fail('A responder with this email is already listed.');
    err.hidden = true;
    busy(el, async () => {
      try {
        let r;
        if (B.FB_ENABLED) r = await B.createResponder({ name, contactEmail, phone });
        else {
          const loginEmail = B.loginEmailFor(name, S.responders().map((x) => x.loginEmail));
          r = { id: `R${Date.now().toString(36)}`, name, contactEmail, phone, loginEmail, tempPassword: B.tempPassword(), credSent: false, createdAt: Date.now() };
          const { tempPassword, ...keep } = r;
          S.addResponderLocal(keep);
        }
        responderCreated(r);
      } catch (e) {
        console.error(e);
        fail(e?.code ? B.authMessage(e) : e?.message || 'Could not create the account.');
      }
    });
  },
  'rsp-remove': async (el) => {
    const r = S.responders().find((x) => x.id === el.dataset.id);
    if (!r) return;
    const open = st().workOrders.filter((w) => w.responder === r.loginEmail && w.status !== 'Completed').length;
    const ok = await confirmDialog({ title: `Remove ${r.name}?`, body: `They can no longer sign in to the responder dashboard.${open ? ` Their ${open} open work order${open > 1 ? 's stay' : ' stays'} assigned until you reassign ${open > 1 ? 'them' : 'it'}.` : ''}`, confirm: 'Remove responder', danger: true });
    if (!ok) return;
    try {
      if (B.FB_ENABLED) await B.removeResponder(r), S.toast(`${r.name} removed`);
      else S.removeResponderLocal(r.id);
    } catch (e) {
      S.toast(`Could not remove the responder (${e.code || e.message})`, 'error');
    }
  },
});

register({
  'wo-tab': (el) => ((woFilter = el.dataset.id), go('#/p/work-orders')),
  'goto-wo': (el) => go(`#/p/work-orders/${el.dataset.id}`),
});

// Field report from the responder app (inspection, repair, photos, verification, assistance requests).
function fieldReport(w) {
  const f = w.field;
  const list = (a) => esc((a || []).join(', ') || '—');
  const rows = [
    f.arrivedAt && ['Arrived on site', fmtDateTime(f.arrivedAt)],
    f.inspection && ['Findings', list(f.inspection.conditions)],
    f.inspection && ['Possible cause', list(f.inspection.causes)],
    f.inspection?.pressure && ['Pressure before', `${esc(f.inspection.pressure)} PSI ${src('FIELD MEASUREMENT')}`],
    f.repair && ['Repair', list(f.repair.actions)],
    f.repair?.materials?.length && ['Materials', esc(f.repair.materials.map((m) => `${m.name}${m.qty ? ` × ${m.qty}` : ''}`).join(', '))],
    f.verify && ['Service', { full: 'Fully restored', partial: 'Partially restored', no: 'Problem remains' }[f.verify.restored] || '—'],
    f.verify?.pressure && ['Pressure after', `${esc(f.verify.pressure)} PSI ${src('FIELD MEASUREMENT')}`],
    f.verify?.explain && ['Still wrong', esc(f.verify.explain)],
    f.verify?.reason && ['Reason / next step', `${esc(f.verify.reason)} — ${esc(f.verify.next || '')}`],
  ].filter(Boolean);
  const ast = (f.assistance || []).map((a) => `<li><strong>${esc(a.reason)}</strong><span>${esc(a.text || '')}</span><time>${fmtDateTime(a.at)}</time></li>`).join('');
  const ph = (f.photos || []).map((p) => `<figure><img src="${p.src}" alt="${esc(p.caption || p.stage + ' photo')}"/><figcaption>${esc({ before: 'Before', during: 'During', after: 'After' }[p.stage] || '')}${p.caption ? ` — ${esc(p.caption)}` : ''} · ${fmtTime(p.at)}</figcaption></figure>`).join('');
  return card(
    'Field report',
    `${rows.length ? `<dl class="kv">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : '<p class="muted sm">Nothing recorded yet.</p>'}
    ${ast ? `<h4 class="sec-t sm">Assistance requested</h4><ul class="fr-assist">${ast}</ul>` : ''}
    ${ph ? `<h4 class="sec-t sm">Field photos</h4><div class="fr-photos">${ph}</div>` : ''}`,
    { sub: 'Recorded by the responder on site', actions: src('FIELD') }
  );
}

const workOrderDetail = {
  title: 'Work Order',
  render({ id }) {
    const s = st();
    const w = s.workOrders.find((x) => x.id === id);
    if (!w) return empty('Work order not found', '', 'search', '<a class="btn btn--outline btn--sm" href="#/p/work-orders">Back</a>');
    const inc = s.incidents.find((i) => i.id === w.incidentId);
    const asset = s.assets.find((a) => a.id === w.assetId);
    const idx = WO_STEPS.indexOf(w.status);
    const next = WO_STEPS[idx + 1];
    const items = WO_STEPS.map((x, k) => ({ label: x, at: w.history.find((h) => h.status === x)?.at, state: k <= idx ? 'done' : k === idx + 1 ? 'current' : 'todo' }));
    const overdue = w.status !== 'Completed' && w.target < Date.now();
    const zt = asset?.zone && s.tele.zones[asset.zone];
    return `<a class="back" href="#/p/work-orders">${icon('chev-l', 16)} Work Orders</a>
      <div class="page-h"><div><div class="mono muted">${w.id}</div><h1>${esc(w.description.split('.')[0])}</h1><div class="inc-badges">${woStatusBadge(w)} ${priorityBadge(w.priority)} ${overdue ? status('warning', 'Overdue') : ''}</div></div>
      <div class="page-a">${next ? `<button class="btn btn--primary" data-action="wo-advance" data-id="${w.id}" data-next="${next}">${icon('arrow', 15)} ${next === 'Completed' ? 'Complete work order' : `Move to ${next}`}</button>` : `<span class="muted">Completed ${fmtDateTime(w.completion?.at)}</span>`}</div></div>
      <div class="inc-grid">
        <div class="inc-main">
          ${card(
            'Details',
            `<dl class="kv kv--3">
            <div><dt>Related incident</dt><dd>${inc ? `<a href="#/p/incidents/${inc.id}" class="mono">${inc.id}</a><br/><span class="sm muted">${esc(inc.title)}</span>` : '<span class="muted">Preventive / routine</span>'}</dd></div>
            <div><dt>Asset</dt><dd>${asset ? `<a href="#/p/assets/${asset.id}" class="mono">${asset.id}</a><br/><span class="sm muted">${esc(asset.name)}</span>` : esc(w.assetId)}</dd></div>
            <div><dt>Location</dt><dd>${esc(w.location)}</dd></div>
            <div><dt>Assigned to</dt><dd>${w.status === 'Completed' ? esc(w.team || 'Unassigned') : `<label class="sr-only" for="wo-assign">Assign to</label><select id="wo-assign" class="wo-assign" data-change="wo-assign" data-id="${w.id}"><option value="">Not assigned</option>${S.responders().map((r) => `<option value="${esc(r.loginEmail)}" ${r.loginEmail === w.responder ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}${w.team && !S.responders().some((r) => r.loginEmail === w.responder) ? `<option selected disabled>${esc(w.team)}</option>` : ''}</select>`}</dd></div>
            <div><dt>Created</dt><dd>${fmtDateTime(w.createdAt)}</dd></div>
            <div><dt>Target completion</dt><dd class="${overdue ? 'txt-warn' : ''}">${fmtDateTime(w.target)}</dd></div>
            <div class="kv-wide"><dt>Description</dt><dd>${esc(w.description)}</dd></div>
            </dl>`
          )}
          ${card(
            'Repair evidence',
            `<div class="photos">${['before', 'after']
              .map(
                (k) => `<div class="photo-slot"><div class="photo-l">${k === 'before' ? 'Before photo' : 'After photo'}</div>${
                  w.photos[k]
                    ? `<img src="${w.photos[k]}" alt="${k} repair photo"/>`
                    : `<label class="upload upload--sm">${icon('camera', 20)}<span><strong>Attach ${k} photo</strong><em>Field team upload</em></span><input type="file" accept="image/*" class="sr-only" data-change="wo-photo" data-id="${w.id}" data-k="${k}"/></label>`
                }</div>`
              )
              .join('')}</div>
            ${w.completion ? `<dl class="kv kv--3 mt"><div><dt>Completion timestamp</dt><dd>${fmtDateTime(w.completion.at)}</dd></div><div><dt>Verification reading</dt><dd>${esc(w.completion.reading || '—')} ${src('MANUAL')}</dd></div><div class="kv-wide"><dt>Repair notes</dt><dd>${esc(w.completion.notes || '—')}</dd></div></dl>` : ''}`
          )}
          ${w.field ? fieldReport(w) : ''}
          ${card(
            'Technician notes',
            `${w.notes.length ? `<ul class="notes">${w.notes.map((n) => `<li><div class="notes-h"><strong>${esc(n.by)}</strong><time>${fmtDateTime(n.at)}</time></div><p>${esc(n.text)}</p></li>`).join('')}</ul>` : '<p class="muted sm">No technician notes yet.</p>'}
            ${w.status !== 'Completed' ? `<div class="note-add"><label class="sr-only" for="wo-note-in">Add technician note</label><input id="wo-note-in" placeholder="e.g. Crew on site, isolating the section valve"/><button class="btn btn--outline btn--sm" data-action="wo-note" data-id="${w.id}">Add note</button></div>` : ''}`
          )}
        </div>
        <div class="inc-side">
          ${card('Progress', timeline(items))}
          ${zt ? card('Live zone readings', `<dl class="kv"><div><dt>${esc(zoneById(asset.zone).short)} pressure</dt><dd><strong>${fmt(zt.pressure, 0)} PSI</strong> ${src('SIMULATED')}</dd></div><div><dt>Flow vs expected</dt><dd>${zt.flowDeltaPct >= 0 ? '+' : ''}${fmt(zt.flowDeltaPct, 0)}% ${src('SIMULATED')}</dd></div></dl><p class="fine">Use for verification after repair.</p>`) : ''}
        </div>
      </div>`;
  },
};

registerInputs({
  'wo-assign': (el) => S.assignWorkOrder(el.dataset.id, S.responders().find((r) => r.loginEmail === el.value) || null),
  'wo-photo': async (el) => {
    const f = el.files?.[0];
    if (!f) return;
    try {
      S.setWorkOrderPhoto(el.dataset.id, el.dataset.k, await readImage(f, 520));
    } catch (e) {
      S.toast('Could not read image', 'error');
    }
  },
});

register({
  'wo-note': (el) => {
    const v = document.getElementById('wo-note-in').value.trim();
    if (v) S.addWorkOrderNote(el.dataset.id, v);
  },
  'wo-advance': (el) => {
    const w = st().workOrders.find((x) => x.id === el.dataset.id);
    if (el.dataset.next !== 'Completed') return S.advanceWorkOrder(w.id);
    const asset = st().assets.find((a) => a.id === w.assetId);
    const zt = asset?.zone && st().tele.zones[asset.zone];
    openModal(
      `Complete ${w.id}`,
      `<form class="form" id="woc-form">
        ${field('Repair notes', `<textarea name="notes" id="woc-notes" rows="3" placeholder="What was found and repaired?"></textarea>`, { id: 'woc-notes', req: true })}
        ${field('Verification reading', `<input name="reading" id="woc-reading" placeholder="e.g. Pressure test after repair: 40 PSI"/>`, { id: 'woc-reading', req: true, hint: 'Manual reading taken by the crew after repair (recorded as MANUAL).' })}
        ${field('Completion time', `<input type="datetime-local" name="at" id="woc-at" value="${toLocalInput(Date.now())}"/>`, { id: 'woc-at', req: true })}
        ${!w.photos.after ? '<p class="fine">Tip: attach an after photo as repair evidence from the work order page.</p>' : ''}
      </form>`,
      { footer: `<button class="btn btn--ghost" data-action="ov-close">Cancel</button><button class="btn btn--success" data-action="wo-complete" data-id="${w.id}">${icon('check-circle', 15)} Mark completed</button>` }
    );
  },
  'wo-complete': (el) => {
    const d = formData(document.getElementById('woc-form'));
    if (!d.notes.trim() || !d.reading.trim()) return S.toast('Repair notes and verification reading are required', 'error');
    closeOverlay();
    S.advanceWorkOrder(el.dataset.id, { notes: d.notes.trim(), reading: d.reading.trim(), at: fromLocalInput(d.at) || Date.now() });
  },
});

export const incidentViews = { incidents, 'incidents/:id': incidentDetail, 'work-orders': workOrders, 'work-orders/:id': workOrderDetail };