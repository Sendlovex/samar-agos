// Shared provider components: work-order modal, advisory publishing, map side panels.
import * as S from '../store.js';
import { ZONES, zoneById, TEAMS, CRITICAL_FACILITIES, reportTypeLabel, REPORT_TYPES } from '../data.js';
import { icon, status, src, field, table, openModal, openDrawer, closeOverlay, register, registerInputs, formData, updatedAgo, priorityBadge, sevBadge, SEV, busy } from '../ui.js';
import { gaugeBar } from '../charts.js';
import { assetLiveStatus } from '../map.js';
import { esc, fmt, fmtL, fmtTime, fmtDate, fmtDateTime, relTime, toLocalInput, fromLocalInput } from '../util.js';
import { go } from '../app.js';

const st = () => S.getState();

export const ZONE_COLORS = { A: '#2a78d6', B: '#eb6834', C: '#1baf7a', D: '#e87ba4', E: '#4a3aa7' };
export const incSev = (i) => ({ Critical: 'critical', High: 'critical', Medium: 'warning', Low: 'info' }[i.severity] || 'info');
export const incStatus = (i) => status(i.status === 'Resolved' ? 'normal' : i.status === 'Monitoring' ? 'info' : i.status === 'Investigating' ? 'warning' : 'warning', i.status);
export const woStatusBadge = (w) => status(w.status === 'Completed' ? 'normal' : w.status === 'New' ? 'offline' : w.target < Date.now() ? 'warning' : 'info', w.status === 'Completed' || w.target >= Date.now() || w.status === 'New' ? w.status : `${w.status}, overdue`);

// ---------------------------------------------------------------- incident table (plain language, minimal color)
const SEV_DOT = { Critical: 'crit', High: 'crit', Medium: 'warn', Low: 'low' };
const STAGE = { Investigating: 'Checking the cause', 'Response in Progress': 'Crew assigned', Monitoring: 'Watching readings', Resolved: 'Closed' };
const affectsResidents = (i) => i.reportIds.length > 0 || i.type !== 'Equipment';

function nextStep(i, s) {
  if (i.status === 'Resolved') return 'No action needed';
  const wos = s.workOrders.filter((w) => i.workOrderIds.includes(w.id));
  if (!wos.length) return 'Assign a field crew';
  if (affectsResidents(i) && !i.advisoryIds.length) return 'Inform residents';
  if (wos.every((w) => w.status === 'Completed')) return 'Confirm recovery, then resolve';
  return 'Follow field work';
}

export function incidentTable(list, emptyMsg = 'No active incidents') {
  const s = st();
  return table(
    [
      {
        label: 'Incident',
        render: (i) => `<div class="it-t">${esc(i.title.split(' — ')[0])}</div><div class="it-s"><span class="mono">${i.id}</span>, ${esc(zoneById(i.zone).name)}</div>`,
      },
      { label: 'Severity', render: (i) => `<span class="sev-dot sev-dot--${SEV_DOT[i.severity] || 'low'}" aria-hidden="true"></span>${esc(i.severity)}` },
      {
        label: 'Progress',
        render: (i) => {
          const w = s.workOrders.filter((x) => i.workOrderIds.includes(x.id)).sort((a, b) => b.createdAt - a.createdAt)[0];
          return `<div class="it-t it-t--n">${STAGE[i.status] || esc(i.status)}</div><div class="it-s">${w ? `Field work: ${esc(w.status.toLowerCase())}` : 'No crew assigned yet'}</div>`;
        },
      },
      { label: 'Resident reports', num: true, render: (i) => i.reportIds.length || '<span class="muted">—</span>' },
      { label: 'Residents informed', render: (i) => (i.advisoryIds.length ? 'Yes' : i.status === 'Resolved' ? '<span class="muted">—</span>' : affectsResidents(i) ? '<span class="txt-warn">Not yet</span>' : '<span class="muted">Not needed</span>') },
      { label: 'Next step', render: (i) => `<span class="it-next">${nextStep(i, s)}${icon('chev-r', 14)}</span>` },
    ],
    list,
    { rowAction: { action: 'goto-inc', key: 'id' }, empty: emptyMsg }
  );
}

// ---------------------------------------------------------------- work order modal
export function openWorkOrderModal(prefill = {}) {
  const s = st();
  const inc = prefill.incidentId && s.incidents.find((i) => i.id === prefill.incidentId);
  const zone = inc?.zone || prefill.zone;
  const assets = s.assets.filter((a) => !zone || a.zone === zone || a.id === prefill.assetId);
  const defAsset = prefill.assetId || assets[0]?.id || 'PL-NET';
  const target = toLocalInput(Date.now() + (prefill.priority === 'Critical' ? 3 : 6) * 3600000);
  const desc = prefill.description || (inc ? `Inspect and repair cause of ${inc.title.toLowerCase()}. Confirm pressure and flow recovery after repair.` : '');
  openModal(
    'Create Work Order',
    `<form class="form" id="wo-form">
      ${inc ? `<div class="link-box">${icon('link', 15)} Linked to <strong>${inc.id}</strong> — ${esc(inc.title)}</div>` : ''}
      <div class="grid-2">
        ${field('Asset', `<select name="assetId" id="wo-asset">${s.assets.map((a) => `<option value="${a.id}" ${a.id === defAsset ? 'selected' : ''}>${a.id} — ${esc(a.name)}</option>`).join('')}</select>`, { id: 'wo-asset', req: true })}
        ${field('Location', `<input name="location" id="wo-loc" value="${esc(prefill.location || (inc ? `${zoneById(inc.zone).name} — ${zoneById(inc.zone).barangays.join(', ')}` : ''))}" required/>`, { id: 'wo-loc', req: true })}
        ${field('Priority', `<select name="priority" id="wo-pri">${['Critical', 'High', 'Medium', 'Low'].map((p) => `<option ${p === (prefill.priority || (inc?.severity === 'High' ? 'High' : 'Medium')) ? 'selected' : ''}>${p}</option>`).join('')}</select>`, { id: 'wo-pri', req: true })}
        ${field('Assigned team', `<input name="team" id="wo-team" list="wo-teams" value="${esc(prefill.team || '')}" placeholder="Crew or team name"/><datalist id="wo-teams">${[...new Set(s.workOrders.map((w) => w.team).filter(Boolean))].map((t) => `<option value="${esc(t)}"></option>`).join('')}</datalist>`, { id: 'wo-team', optional: true })}
        ${field('Target completion', `<input type="datetime-local" name="target" id="wo-target" value="${target}"/>`, { id: 'wo-target', req: true })}
      </div>
      ${field('Description', `<textarea name="description" id="wo-desc" rows="3">${esc(desc)}</textarea>`, { id: 'wo-desc', req: true })}
    </form>`,
    { footer: `<button class="btn btn--ghost" data-action="ov-close">Cancel</button><button class="btn btn--primary" data-action="wo-create" data-inc="${inc?.id || ''}">${icon('wrench', 16)} Create & assign</button>` }
  );
}

// ---------------------------------------------------------------- advisory modal with live preview
const STATUS_OPTS = ['REDUCED PRESSURE', 'NO WATER', 'INTERMITTENT SUPPLY', 'QUALITY ADVISORY', 'SCHEDULED MAINTENANCE', 'SUPPLY WARNING'];
let advDraft = null;

export function openAdvisoryModal(prefill = {}) {
  const s = st();
  const inc = prefill.incidentId && s.incidents.find((i) => i.id === prefill.incidentId);
  const z = inc ? zoneById(inc.zone) : null;
  const woAssigned = inc && s.workOrders.some((w) => inc.workOrderIds.includes(w.id) && w.status !== 'Completed');
  const isPressure = inc && /pressure/i.test(inc.title);
  advDraft = {
    incidentId: inc?.id || '',
    title: prefill.title || (inc ? `${isPressure ? 'Reduced Water Pressure' : inc.title.split('—')[0].trim()} — ${z.short}` : ''),
    areas: inc ? [...inc.zones] : prefill.areas || [],
    serviceStatus: prefill.serviceStatus || (inc ? (isPressure ? 'REDUCED PRESSURE' : inc.type === 'Water Quality' ? 'QUALITY ADVISORY' : inc.type === 'Supply Interruption' ? 'NO WATER' : 'REDUCED PRESSURE') : 'SUPPLY WARNING'),
    message:
      prefill.message ||
      (inc
        ? `Residents in Barangays ${z.barangays.join(', ').replace(/, ([^,]*)$/, ', and $1')} may experience ${isPressure ? 'reduced water pressure' : 'service disruption'} while crews investigate a distribution-line issue.${woAssigned ? ' Repair team assigned.' : ''}`
        : ''),
    instructions: prefill.instructions || 'Store water for drinking and cooking. Check SAMAR-AGOS for water distribution point if needed. Report new leaks through SAMAR-AGOS.',
    startAt: toLocalInput(Date.now()),
    etrKnown: false,
    etr: toLocalInput(Date.now() + 4 * 3600000),
    nextUpdate: toLocalInput(Date.now() + 2 * 3600000),
  };
  openModal('Publish Service Advisory', advForm(), {
    wide: true,
    footer: `<span class="muted sm mr-auto">${icon('users', 14)} Residents in the selected barangays are notified on publish.</span><button class="btn btn--ghost" data-action="ov-close">Cancel</button><button class="btn btn--primary" data-action="adv-publish">${icon('megaphone', 16)} Publish advisory</button>`,
  });
}

function advForm() {
  const d = advDraft;
  return `<div class="adv-edit"><form class="form" id="adv-form">
    ${d.incidentId ? `<div class="link-box">${icon('link', 15)} From incident <strong>${d.incidentId}</strong></div>` : ''}
    ${field('Title', `<input id="adv-title" value="${esc(d.title)}" data-input="adv-f" data-k="title" required/>`, { id: 'adv-title', req: true })}
    <div class="field"><span class="field-l">Affected areas <span class="req">*</span></span><div class="chips">${ZONES.map((z) => `<label class="chk-chip"><input type="checkbox" value="${z.id}" ${d.areas.includes(z.id) ? 'checked' : ''} data-change="adv-area"/> ${esc(z.name)}</label>`).join('')}</div></div>
    ${field('Service status shown to residents', `<select id="adv-status" data-change="adv-f" data-k="serviceStatus">${STATUS_OPTS.map((o) => `<option ${o === d.serviceStatus ? 'selected' : ''}>${o}</option>`).join('')}</select>`, { id: 'adv-status', req: true })}
    ${field('Message', `<textarea id="adv-msg" rows="3" data-input="adv-f" data-k="message">${esc(d.message)}</textarea>`, { id: 'adv-msg', req: true })}
    <div class="grid-2">
      ${field('Start time', `<input type="datetime-local" id="adv-start" value="${d.startAt}" data-input="adv-f" data-k="startAt"/>`, { id: 'adv-start', req: true })}
      ${field('Next update time', `<input type="datetime-local" id="adv-next" value="${d.nextUpdate}" data-input="adv-f" data-k="nextUpdate"/>`, { id: 'adv-next', req: true })}
    </div>
    <label class="chk"><input type="checkbox" ${d.etrKnown ? 'checked' : ''} data-change="adv-etr-known"/> A reliable restoration estimate is available</label>
    ${d.etrKnown ? field('Estimated restoration time', `<input type="datetime-local" id="adv-etr" value="${d.etr}" data-input="adv-f" data-k="etr"/>`, { id: 'adv-etr', optional: true, hint: 'Only enter if confident. Residents will see this as an estimate.' }) : '<p class="field-h">Restoration time is optional. If unknown, residents see the next update time instead.</p>'}
    ${field('Instructions for residents', `<textarea id="adv-ins" rows="2" data-input="adv-f" data-k="instructions">${esc(d.instructions)}</textarea>`, { id: 'adv-ins', optional: true })}
  </form>
  <div class="adv-prev"><div class="adv-prev-l">${icon('eye', 14)} Resident preview</div><div id="adv-preview">${advPreview()}</div></div></div>`;
}

function advPreview() {
  const d = advDraft;
  const brgys = ZONES.filter((z) => d.areas.includes(z.id)).flatMap((z) => z.barangays);
  return `<div class="phone"><div class="phone-bar">${icon('bell', 12)} SAMAR-AGOS, now</div>
    <div class="phone-n"><strong>New water advisory</strong><span>${esc(d.title || 'Advisory title')}</span></div>
    <article class="adv"><div class="adv-h">${status(d.serviceStatus === 'NO WATER' ? 'critical' : d.serviceStatus === 'QUALITY ADVISORY' ? 'info' : 'warning', d.serviceStatus)}</div>
    <h3 class="adv-t">${esc(d.title || 'Advisory title')}</h3>
    <dl class="adv-meta"><div><dt>Affected areas</dt><dd>${esc(brgys.join(', ') || '—')}</dd></div>
    <div><dt>Started</dt><dd>${d.startAt ? fmtDateTime(fromLocalInput(d.startAt)) : '—'}</dd></div>
    ${d.etrKnown && d.etr ? `<div><dt>Estimated restoration</dt><dd><strong>${fmtTime(fromLocalInput(d.etr))}</strong></dd></div>` : `<div><dt>Next update</dt><dd><strong>${d.nextUpdate ? fmtTime(fromLocalInput(d.nextUpdate)) : '—'}</strong></dd></div>`}</dl>
    <p class="adv-msg">${esc(d.message || 'Message to residents…')}</p>
    ${d.instructions ? `<div class="adv-ins">${icon('info', 14)}<div><strong>Provider instructions</strong><p>${esc(d.instructions)}</p></div></div>` : ''}</article></div>`;
}
const refreshPreview = () => {
  const p = document.getElementById('adv-preview');
  if (p) p.innerHTML = advPreview();
};

registerInputs({
  'adv-f': (el) => ((advDraft[el.dataset.k] = el.value), refreshPreview()),
  'adv-area': (el) => {
    const set = new Set(advDraft.areas);
    el.checked ? set.add(el.value) : set.delete(el.value);
    advDraft.areas = [...set];
    refreshPreview();
  },
  'adv-etr-known': (el) => {
    advDraft.etrKnown = el.checked;
    const box = document.querySelector('.adv-edit');
    if (box) box.outerHTML = advForm();
  },
});

// ---------------------------------------------------------------- map side panel
export function openMapPanel(kind, id) {
  const s = st();
  const t = s.tele;
  if (kind === 'asset') {
    const a = s.assets.find((x) => x.id === id);
    const sev = assetLiveStatus(a, s);
    let body = `<div class="pnl-st">${status(sev, SEV[sev].label, { lg: true })}<span class="muted sm">${esc(a.type)}, ${esc(a.site || zoneById(a.zone)?.name || '')}</span></div><dl class="kv">`;
    if (a.type === 'Reservoir') {
      const lv = t.volML / S.RES_CAP_ML;
      body += `<div><dt>Current volume</dt><dd><strong>${fmtL(t.volML * 1e6)}</strong> ${src('SIMULATED')}</dd></div><div><dt>Capacity</dt><dd>440,000 L</dd></div>
        <div><dt>Level</dt><dd><strong>${Math.round(lv * 100)}%</strong>${gaugeBar(lv * 100, { sev, marker: Math.round(S.MIN_RESERVE * 100) })}</dd></div>
        <div><dt>Inflow</dt><dd>${fmt(S.mlToLs(t.production + t.transfer), 0)} L/s ${src('SIMULATED')}</dd></div><div><dt>Outflow</dt><dd>${fmt(S.mlToLs(t.demand), 0)} L/s ${src('SIMULATED')}</dd></div>`;
    } else if (a.type === 'Tank' && t.tanks[a.id]) {
      const tk = t.tanks[a.id];
      body += `<div><dt>Level</dt><dd><strong>${Math.round(tk.level * 100)}%</strong>${gaugeBar(tk.level * 100, { sev: tk.status })}</dd></div><div><dt>Current volume</dt><dd>${fmtL(tk.volL)} ${src('SIMULATED')}</dd></div><div><dt>Capacity</dt><dd>${fmtL(tk.capL)}</dd></div>`;
    } else if (a.type === 'Pump' && t.pumps[a.id]) {
      const p = t.pumps[a.id];
      body += `<div><dt>Run status</dt><dd>${esc(p.units)}</dd></div><div><dt>Flow</dt><dd>${p.flowLs != null ? `${fmt(p.flowLs, 1)} L/s` : 'Not metered'} ${src('SIMULATED')}</dd></div><div><dt>Vibration</dt><dd>${fmt(p.vibration, 1)} mm/s ${src('SIMULATED')}</dd></div><div><dt>Power draw</dt><dd>${fmt(p.powerKw, 1)} kW ${src('SIMULATED')}</dd></div>`;
    } else if (a.status === 'offline') {
      body += `<div><dt>Last data</dt><dd>Not reporting</dd></div>`;
    }
    if (a.spec) body += `<div class="kv-wide"><dt>Specification</dt><dd>${esc(a.spec)}</dd></div>`;
    body += `<div><dt>Condition</dt><dd>${esc(a.condition)}</dd></div><div><dt>Last maintenance</dt><dd>${a.lastMaint ? fmtDate(a.lastMaint) : 'Not recorded'}</dd></div><div><dt>Last update</dt><dd>${a.status === 'offline' ? '—' : updatedAgo(t.lastUpdate)}</dd></div></dl>
      <div class="pnl-a"><a class="btn btn--outline btn--sm" href="#/p/assets/${a.id}">Asset details</a><button class="btn btn--primary btn--sm" data-action="wo-new" data-asset="${a.id}">${icon('wrench', 14)} Work order</button></div>`;
    return openDrawer(esc(a.name), body, { sub: `${a.id}` });
  }
  if (kind === 'zone') {
    const z = zoneById(id);
    const zt = t.zones[id];
    const reps = s.reports.filter((r) => r.zone === id && !['verified', 'repair_completed'].includes(r.status));
    const incs = s.incidents.filter((i) => i.zone === id && i.status !== 'Resolved');
    return openDrawer(
      esc(z.name),
      `<div class="pnl-st">${status(zt.status, zt.status === 'normal' ? 'Normal pressure' : 'Pressure below normal', { lg: true })}</div>
      <dl class="kv"><div><dt>Pressure</dt><dd><strong>${fmt(zt.pressure, 0)} PSI</strong> ${src('SIMULATED')} <span class="muted">normal ~${z.basePressure} PSI</span></dd></div>
      <div><dt>Flow</dt><dd>${fmt(zt.flow, 1)} L/s ${src('SIMULATED')} <span class="muted">(${zt.flowDeltaPct >= 0 ? '+' : ''}${fmt(zt.flowDeltaPct, 0)}% vs expected)</span></dd></div>
      <div><dt>Barangays</dt><dd>${esc(z.barangays.join(', '))}</dd></div><div><dt>Service connections</dt><dd>${fmt(z.connections)} ${src('MANUAL')}</dd></div>
      <div><dt>Open resident reports</dt><dd>${reps.length} ${src('RESIDENT REPORTED')}</dd></div><div><dt>Active incidents</dt><dd>${incs.map((i) => `<a href="#/p/incidents/${i.id}">${i.id}</a>`).join(', ') || 'None'}</dd></div>
      <div><dt>Critical facilities</dt><dd>${CRITICAL_FACILITIES.filter((f) => f.zone === id).map((f) => esc(f.name)).join(', ') || 'None'}</dd></div></dl>
      <div class="pnl-a"><a class="btn btn--primary btn--sm" href="#/p/incidents">Review reports</a></div>`,
      { sub: 'Barangay served by CWD' }
    );
  }
  if (kind === 'report') {
    const r = s.reports.find((x) => x.id === id);
    return openDrawer(
      `Resident report ${r.id}`,
      `<div class="pnl-st">${src('RESIDENT REPORTED')}</div><dl class="kv"><div><dt>Problem</dt><dd><strong>${esc(reportTypeLabel(r.type))}</strong></dd></div><div><dt>Location</dt><dd>${esc(r.location)}</dd></div><div><dt>Submitted</dt><dd>${fmtDateTime(r.submittedAt)} (${relTime(r.submittedAt)})</dd></div><div><dt>Description</dt><dd>${esc(r.description)}</dd></div><div><dt>Status</dt><dd>${esc(r.status.replace('_', ' '))}</dd></div><div><dt>Linked incident</dt><dd>${r.incidentId ? `<a href="#/p/incidents/${r.incidentId}">${r.incidentId}</a>` : 'Not yet linked'}</dd></div></dl>
      ${r.photo ? `<img class="rep-photo" src="${r.photo}" alt="Resident photo"/>` : ''}
      <div class="pnl-a"><a class="btn btn--primary btn--sm" href="#/p/incidents">Open report inbox</a></div>`,
      { sub: zoneById(r.zone).name }
    );
  }
  if (kind === 'incident') {
    const i = s.incidents.find((x) => x.id === id);
    return openDrawer(
      esc(i.title),
      `<div class="pnl-st">${incStatus(i)} ${sevBadge(i.severity)}</div><dl class="kv"><div><dt>Detected</dt><dd>${fmtDateTime(i.detectedAt)}</dd></div><div><dt>Condition</dt><dd>${esc(i.condition)}</dd></div><div><dt>Reports linked</dt><dd>${i.reportIds.length}</dd></div><div><dt>Work orders</dt><dd>${i.workOrderIds.join(', ') || 'None'}</dd></div></dl><div class="pnl-a"><a class="btn btn--primary btn--sm" href="#/p/incidents/${i.id}">Open incident</a></div>`,
      { sub: i.id }
    );
  }
  if (kind === 'facility') {
    const f = CRITICAL_FACILITIES.find((x) => x.id === id);
    const zt = t.zones[f.zone];
    return openDrawer(esc(f.name), `<div class="pnl-st">${status(zt.status, zt.status === 'normal' ? 'Supply normal' : 'Zone pressure below normal', { lg: true })}</div><dl class="kv"><div><dt>Facility type</dt><dd>${esc(f.kind)}</dd></div><div><dt>Zone</dt><dd>${esc(zoneById(f.zone).name)}</dd></div><div><dt>Zone pressure</dt><dd>${fmt(zt.pressure, 0)} PSI ${src('SIMULATED')}</dd></div></dl><p class="fine">Critical facilities are prioritized for emergency water deliveries during disruptions.</p>`, { sub: 'Critical facility' });
  }
}

// ---------------------------------------------------------------- actions
register({
  'map-select': (el) => openMapPanel(el.dataset.kind, el.dataset.id),
  'wo-new': (el) => openWorkOrderModal({ assetId: el.dataset.asset, incidentId: el.dataset.inc, priority: el.dataset.pri, description: el.dataset.desc }),
  'wo-create': (el) => busy(el, async () => {
    const f = document.getElementById('wo-form');
    const d = formData(f);
    if (!d.description.trim() || !d.location.trim()) return S.toast('Location and description are required', 'error');
    const wo = await S.createWorkOrder({ incidentId: el.dataset.inc || null, assetId: d.assetId, location: d.location, priority: d.priority, team: d.team, description: d.description, target: fromLocalInput(d.target) || Date.now() + 6 * 3600000 });
    closeOverlay();
    if (!el.dataset.inc) go(`#/p/work-orders/${wo.id}`);
  }),
  'adv-new': (el) => openAdvisoryModal({ incidentId: el.dataset.inc }),
  'adv-publish': (el) => busy(el, async () => {
    const d = advDraft;
    if (!d.title.trim() || !d.message.trim() || !d.areas.length) return S.toast('Title, message, and at least one affected area are required', 'error');
    await S.publishAdvisory({
      incidentId: d.incidentId || null,
      title: d.title.trim(),
      kind: d.serviceStatus === 'QUALITY ADVISORY' ? 'Water Quality' : d.serviceStatus === 'SCHEDULED MAINTENANCE' ? 'Maintenance' : 'Service Disruption',
      areas: d.areas,
      barangays: ZONES.filter((z) => d.areas.includes(z.id)).flatMap((z) => z.barangays),
      message: d.message.trim(),
      instructions: d.instructions.trim(),
      startAt: fromLocalInput(d.startAt) || Date.now(),
      etr: d.etrKnown ? fromLocalInput(d.etr) : null,
      nextUpdate: fromLocalInput(d.nextUpdate),
      serviceStatus: d.serviceStatus,
    });
    closeOverlay();
  }),
});
