// Field responder module. One continuous workflow per work order, in the same shell and components as the
// operator and resident portals: My Assignments → Work Order → Field Inspection → Repair & Evidence → Verification → Complete.
// Form inputs are kept as on-device drafts while typing; a step is sent to the provider when saved.
import * as S from '../store.js';
import * as B from '../backend.js';
import { zoneById, PROVIDER_USER, RESPONDER_USER } from '../data.js';
import { uploadBox, icon, status, src, card, kpi, empty, register, registerInputs, openModal, closeOverlay, field, SEV, busy, confirmDialog, priorityBadge, alertBanner, activityLog } from '../ui.js';
import { renderMap } from '../map.js';
import { esc, fmt, fmtTime, fmtDateTime, relTime, readImage, toLL } from '../util.js';
import { go } from '../app.js';

const st = () => S.getState();
const ACTIVE = ['En Route', 'Inspecting', 'Repairing', 'Testing'];
const PRI = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const STAGES = ['Assigned', 'Understand', 'Inspect', 'Repair', 'Verify'];

// ---------------------------------------------------------------- responder settings (this device)
const VIEW_KEY = 'samaragos.fieldViewAs'; // staff preview: whose assignments to show
const ls = {
  get: (k, d = null) => {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : JSON.parse(v);
    } catch (e) {
      return d;
    }
  },
  set: (k, v) => {
    try {
      v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {
      /* storage blocked — drafts last for this visit only */
    }
  },
};
// A signed-in responder sees their own work orders. Offline, the demo responder is used.
// Staff previewing the app pick a responder on the Profile page (or see every assigned job).
const isCrew = () => !B.FB_ENABLED || !!B.getSession()?.isResponder;
const viewAs = () => (isCrew() ? RESPONDER_USER.loginEmail : ls.get(VIEW_KEY, ''));
const whoName = () => {
  const e = viewAs();
  return e === RESPONDER_USER.loginEmail ? RESPONDER_USER.name : S.responders().find((r) => r.loginEmail === e)?.name || '';
};

// ---------------------------------------------------------------- drafts (saved on this device while typing)
const draftKey = (id, sec) => `samaragos.fieldDraft.${id}.${sec}`;
const drafts = {};
function draft(id, sec, init) {
  const k = draftKey(id, sec);
  if (!drafts[k]) drafts[k] = ls.get(k) || structuredClone(init());
  return drafts[k];
}
const saveDraft = (id, sec) => ls.set(draftKey(id, sec), drafts[draftKey(id, sec)]);
function clearDraft(id, sec) {
  delete drafts[draftKey(id, sec)];
  ls.set(draftKey(id, sec), null);
}

// ---------------------------------------------------------------- work order helpers
const woOf = (id) => st().workOrders.find((w) => w.id === id);
const incOf = (wo) => st().incidents.find((i) => i.id === wo.incidentId);
const fieldOf = (wo) => wo.field || { log: [], photos: [], assistance: [] };
export const mine = () => {
  const e = viewAs();
  return st().workOrders.filter((w) => w.status !== 'New' && (e ? w.responder === e : w.responder || w.team));
};
const issueOf = (wo) => incOf(wo)?.title || wo.description?.split('.')[0] || 'Field work';
const zoneOfWo = (wo) => zoneById(incOf(wo)?.zone || st().assets.find((a) => a.id === wo.assetId)?.zone);
const assignedAt = (wo) => wo.history.find((h) => h.status === 'Assigned')?.at || wo.createdAt;
function pinOf(wo) {
  const a = st().assets.find((x) => x.id === wo.assetId && x.x != null);
  if (a) return { x: a.x, y: a.y };
  const z = zoneOfWo(wo);
  return z?.label ? { x: z.label[0], y: z.label[1] } : null;
}
function kindOf(wo) {
  const t = `${incOf(wo)?.type || ''} ${issueOf(wo)} ${wo.description || ''}`;
  if (/pressure/i.test(t)) return 'pressure';
  if (/leak|burst|break/i.test(t)) return 'leak';
  if (/pump|equipment|motor/i.test(t)) return 'pump';
  if (/quality|turbid|chlorin|colou?r|odou?r/i.test(t)) return 'quality';
  if (/no water|interrupt/i.test(t)) return 'nowater';
  return 'pressure';
}
function stageOf(wo) {
  if (wo.status === 'Completed') return 5;
  return { New: 0, Assigned: 0, 'En Route': 1, Inspecting: 2, Repairing: 3, Testing: 4 }[wo.status] ?? 0;
}
function statusWord(wo) {
  if (wo.status === 'En Route' && fieldOf(wo).arrivedAt) return ['warning', 'On site'];
  return { New: ['offline', 'Assigned'], Assigned: ['offline', 'Assigned'], 'En Route': ['warning', 'En route'], Inspecting: ['warning', 'Inspecting'], Repairing: ['warning', 'Repairing'], Testing: ['info', 'Testing'], Completed: ['normal', 'Completed'] }[wo.status] || ['info', wo.status];
}
const statusBadge = (wo) => status(...statusWord(wo));
const sortWos = (a, b) => (PRI[a.priority] ?? 9) - (PRI[b.priority] ?? 9) || ACTIVE.includes(b.status) - ACTIVE.includes(a.status) || assignedAt(a) - assignedAt(b);
const dotSub = (sev, text) => `<span class="sys-dot sys-dot--${SEV[sev].cls}" aria-hidden="true"></span> ${text}`;

// The one "next required action" for a work order.
function nextAction(wo) {
  const f = fieldOf(wo);
  if (['New', 'Assigned'].includes(wo.status)) return { label: 'Start Response', icon: 'truck', action: 'fx-start' };
  if (wo.status === 'En Route' && !f.arrivedAt) return { label: 'I Have Arrived', icon: 'pin', action: 'fx-arrive' };
  if (wo.status === 'En Route') return { label: 'Start Inspection', icon: 'search', action: 'fx-inspect' };
  if (wo.status === 'Inspecting') return { label: 'Continue Inspection', icon: 'clipboard', href: `#/c/inspect/${wo.id}` };
  if (wo.status === 'Repairing') return { label: 'Continue Repair', icon: 'wrench', href: `#/c/repair/${wo.id}` };
  if (wo.status === 'Testing') return f.verify?.restored === 'full' ? { label: 'Review & Complete', icon: 'check-circle', href: `#/c/done/${wo.id}` } : { label: 'Continue Verification', icon: 'gauge', href: `#/c/verify/${wo.id}` };
  return { label: 'View Summary', icon: 'check-circle', href: `#/c/done/${wo.id}` };
}
const actionBtn = (wo, cls = 'btn--primary') => {
  const n = nextAction(wo);
  return n.href ? `<a class="btn ${cls}" href="${n.href}">${n.label}</a>` : `<button class="btn ${cls}" data-action="${n.action}" data-id="${wo.id}">${n.label}</button>`;
};

// Shared header for every workflow screen — the same page header as the operator Work Order page,
// with the next required action on the right and the Assigned → Verify tracker underneath.
function woHead(wo, here, title) {
  const s = stageOf(wo);
  const done = wo.status === 'Completed';
  const overdue = !done && wo.target && wo.target < Date.now();
  const n = nextAction(wo);
  const btn = n.href === location.hash ? '' : n.href ? `<a class="btn btn--primary" href="${n.href}">${n.label}</a>` : `<button class="btn btn--primary" data-action="${n.action}" data-id="${wo.id}">${n.label}</button>`;
  const hrefs = [`#/c/jobs/${wo.id}`, `#/c/jobs/${wo.id}`, `#/c/inspect/${wo.id}`, `#/c/repair/${wo.id}`, `#/c/verify/${wo.id}`];
  const facts = [
    `<span class="fwh-st">${esc(statusWord(wo)[1])}</span>`,
    `<span class="fxa-pri ${['Critical', 'High'].includes(wo.priority) ? 'is-urgent' : ''}">${esc(wo.priority || 'Medium')} priority</span>`,
    wo.target && !done ? `<span class="${overdue ? 'is-late' : ''}">${overdue ? 'Overdue, target was' : 'Target'} ${fmtDateTime(wo.target)}</span>` : '',
    wo.location ? `<span>${esc(wo.location)}</span>` : '',
  ].filter(Boolean);
  return `<a class="back" href="#/c/jobs">${icon('chev-l', 16)} My Assignments</a>
    <section class="fwh">
      <div class="fwh-top">
        <div class="fwh-id"><span class="mono">${esc(wo.id)}</span><span>${esc(title)}</span></div>
        <h1>${esc(issueOf(wo))}</h1>
        <div class="fwh-facts">${facts.join('')}</div>
      </div>
      <div class="fwh-a">${btn}</div>
      <ol class="fwh-steps" aria-label="Step ${Math.min(s + 1, 5)} of 5: ${esc(STAGES[Math.min(s, 4)])}">${STAGES.map((t, k) => {
        const cls = done || k < s ? 'is-done' : k === s ? 'is-now' : '';
        const label = `<span class="fwh-bar"></span><span class="fwh-l"><small>Step ${k + 1}</small>${esc(t)}</span>`;
        const link = k <= s && k >= 2 && k !== here;
        return `<li class="${cls} ${k === here ? 'is-here' : ''}" ${k === here ? 'aria-current="step"' : ''}>${link ? `<a href="${hrefs[k]}">${label}</a>` : label}</li>`;
      }).join('')}</ol>
      <p class="fwh-hint">${esc(nextHint(wo))}</p>
    </section>`;
}
function nextHint(wo) {
  const f = fieldOf(wo);
  if (['New', 'Assigned'].includes(wo.status)) return 'Next: tap Start Response when you leave for the site. Your provider will see that you are en route.';
  if (wo.status === 'En Route' && !f.arrivedAt) return 'Next: tap I Have Arrived when you reach the work site.';
  if (wo.status === 'En Route') return 'Next: start the inspection and record what you find.';
  if (wo.status === 'Inspecting') return 'Next: finish the checklist and decide if a repair is needed.';
  if (wo.status === 'Repairing') return 'Next: record the repair, materials and photos, then begin verification.';
  if (wo.status === 'Testing') return f.verify?.restored === 'full' ? 'Next: review the summary and complete the work order.' : 'Next: measure after the repair and confirm whether service is restored.';
  return 'Field work is complete. Your provider decides when the incident is resolved.';
}

const fieldBadge = () => src('FIELD MEASUREMENT');
const chips = (name, list, sel, sec) =>
  `<div class="fx-chips" role="group">${list
    .map((o) => `<label class="fx-chip ${sel.includes(o) ? 'is-on' : ''}"><input type="checkbox" ${sel.includes(o) ? 'checked' : ''} data-change="fx-multi" data-sec="${sec}" data-k="${name}" value="${esc(o)}"/>${sel.includes(o) ? icon('check', 13) : ''}${esc(o)}</label>`)
    .join('')}</div>`;
const input = (sec, k, v, attrs = '') => `<input ${attrs} value="${esc(v ?? '')}" data-input="fx-in" data-sec="${sec}" data-k="${k}"/>`;
const select = (sec, k, v, opts) => `<select data-change="fx-in" data-sec="${sec}" data-k="${k}">${['', ...opts].map((o) => `<option value="${esc(o)}" ${o === (v || '') ? 'selected' : ''}>${o ? esc(o) : 'Select…'}</option>`).join('')}</select>`;
const textarea = (sec, k, v, ph) => `<textarea rows="3" placeholder="${esc(ph)}" data-input="fx-in" data-sec="${sec}" data-k="${k}">${esc(v || '')}</textarea>`;
const errBox = (msg) => (msg ? `<div class="err" role="alert">${esc(msg)}</div>` : '');

// ---------------------------------------------------------------- lists used by the forms
const CHECKS = {
  pressure: ['Check for visible leaks', 'Inspect distribution valve', 'Measure line pressure', 'Inspect nearby pipe', 'Check pump condition (if applicable)', 'Observe water flow', 'Check for obstruction or damage'],
  leak: ['Locate the leak source', 'Check pipe condition', 'Inspect nearby valve', 'Measure line pressure', 'Check road or soil damage', 'Check surrounding pipes'],
  pump: ['Check pump is running', 'Check power supply', 'Listen for unusual noise or vibration', 'Inspect pump valves', 'Measure output pressure', 'Check control panel alarms'],
  quality: ['Check water colour and smell', 'Measure chlorine residual', 'Check for nearby leaks or contamination', 'Inspect valves and hydrants', 'Flush the line and observe'],
  nowater: ['Check main valve position', 'Check for visible leaks', 'Measure line pressure', 'Check pump and power supply', 'Check reservoir or tank level', 'Check for obstruction or damage'],
};
const CONDITIONS = ['Leak found', 'Damaged pipe', 'Valve problem', 'Pump problem', 'Low pressure confirmed', 'Blockage suspected', 'No visible issue', 'Other'];
const CAUSES = ['Pipeline damage', 'Valve malfunction', 'Equipment failure', 'High demand', 'Low source supply', 'Power interruption', 'Unknown', 'Other'];
const ACTIONS = ['Repaired damaged pipe', 'Replaced pipe section', 'Replaced valve', 'Repaired valve', 'Restarted pump', 'Repaired pump', 'Cleared blockage', 'Isolated affected line', 'Temporary repair applied', 'Other'];
const MATERIALS = ['PVC coupling', 'Pipe section', 'Clamp', 'Valve', 'Seal', 'Electrical component', 'Fitting'];
const ASSIST = ['Additional crew required', 'Excavation equipment required', 'Replacement parts required', 'Electrical technician required', 'Major pipeline damage', 'Safety issue', 'Unable to access damaged asset', 'Problem larger than expected', 'Other'];
const FINAL = ['Repair completed', 'Leak stopped (if applicable)', 'Pressure checked', 'Flow checked', 'Equipment tested', 'Work area secured', 'Repair evidence uploaded'];
const FLOW = ['Normal', 'Low', 'No flow'];
const PUMP = ['Running', 'Stopped', 'Fault', 'Not applicable'];
const VALVE = ['Open', 'Partly open', 'Closed', 'Not applicable'];

// ---------------------------------------------------------------- side column shared by the workflow screens
function timelineOf(wo) {
  const label = { New: 'Work order created', Assigned: 'Work order assigned', 'En Route': 'Responder en route', Inspecting: 'Inspection started', Repairing: 'Repair started', Testing: 'Testing started', Completed: 'Work order completed' };
  const ev = [...wo.history.map((h) => ({ at: h.at, text: label[h.status] || h.status })), ...fieldOf(wo).log.map((l) => ({ at: l.at, text: l.text }))].sort((a, b) => a.at - b.at);
  return activityLog(ev);
}
function recorded(wo) {
  const f = fieldOf(wo);
  const rows = [
    ['Arrival', f.arrivedAt ? `On site ${fmtTime(f.arrivedAt)}` : null],
    ['Inspection', f.inspection ? (f.inspection.conditions || []).join(', ') || 'Saved' : null],
    ['Repair', f.repair ? (f.repair.actions || []).join(', ') || 'Saved' : null],
    ['Photos', f.photos.length ? `${f.photos.length} attached` : null],
    ['Verification', f.verify ? { full: 'Fully restored', partial: 'Partially restored', no: 'Problem remains' }[f.verify.restored] : null],
  ];
  return `<ul class="fx-rec">${rows.map(([k, v]) => `<li class="${v ? 'is-saved' : ''}"><span><strong>${k}</strong><small>${v ? esc(v) : 'Not yet recorded'}</small></span>${v ? '<em>Saved</em>' : ''}</li>`).join('')}</ul>`;
}
const side = (wo) => `<div class="inc-side">${card('What has been recorded', recorded(wo), { sub: 'Saved to the work order' })}${card('Timeline', timelineOf(wo), { sub: 'Updates as you work' })}</div>`;
const layout = (wo, main) => `<div class="inc-grid"><div class="inc-main">${main}</div>${side(wo)}</div>`;

// ---------------------------------------------------------------- 1. MY ASSIGNMENTS
let userPos = null; // only after the responder taps "Show distances"
function kmTo(wo) {
  const p = pinOf(wo);
  if (!userPos || !p) return null;
  const [la, lo] = toLL(p.x, p.y);
  const r = Math.PI / 180;
  const a = Math.sin(((la - userPos[0]) * r) / 2) ** 2 + Math.cos(la * r) * Math.cos(userPos[0] * r) * Math.sin(((lo - userPos[1]) * r) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
const STEP_WORD = (wo) => statusWord(wo)[1];
const dueText = (wo) => {
  if (!wo.target) return '';
  const h = (wo.target - Date.now()) / 3600e3;
  const span = Math.abs(h) >= 24 ? `${Math.round(Math.abs(h) / 24)} d` : `${Math.max(1, Math.round(Math.abs(h)))} h`;
  return h < 0 ? `Overdue by ${span}` : `Due in ${span}`;
};
const priText = (wo) => `<span class="fxa-pri ${['Critical', 'High'].includes(wo.priority) ? 'is-urgent' : ''}">${esc(wo.priority || 'Medium')} priority</span>`;
const nextBtn = (wo, cls = 'btn--primary btn--sm') => {
  const n = nextAction(wo);
  return n.href ? `<a class="btn ${cls}" href="${n.href}">${n.label}</a>` : `<button class="btn ${cls}" data-action="${n.action}" data-id="${wo.id}">${n.label}</button>`;
};
const stepBar = (wo) => {
  const s = stageOf(wo);
  return `<div class="fxa-steps" aria-label="Step ${Math.min(s + 1, 5)} of 5">${STAGES.map((_, k) => `<span class="${k < s || wo.status === 'Completed' ? 'is-done' : k === s ? 'is-now' : ''}"></span>`).join('')}</div>`;
};

function assignmentRow(wo) {
  const done = wo.status === 'Completed';
  const km = done ? null : kmTo(wo);
  const late = !done && wo.target && wo.target < Date.now();
  const meta = [esc(wo.location || zoneOfWo(wo)?.name || 'Location not set'), done ? `Completed ${fmtDateTime(wo.completion?.at)}` : `Assigned ${relTime(assignedAt(wo))}`, km != null ? `${fmt(km, 1)} km away` : ''].filter(Boolean);
  return `<div class="fxa-row">
    <div class="fxa-main">
      <div class="fxa-top"><span class="mono">${esc(wo.id)}</span>${priText(wo)}</div>
      <strong class="fxa-issue">${esc(issueOf(wo))}</strong>
      <div class="fxa-meta">${meta.map((m) => `<span>${m}</span>`).join('')}</div>
    </div>
    <div class="fxa-st">
      <div class="fxa-st-t"><strong>${esc(STEP_WORD(wo))}</strong>${done ? '' : `<span class="${late ? 'is-late' : ''}">${dueText(wo)}</span>`}</div>
      ${stepBar(wo)}
    </div>
    <div class="fxa-a">${done ? `<a class="btn btn--outline btn--sm" href="#/c/done/${wo.id}">View summary</a>` : `<a class="btn btn--ghost btn--sm" href="#/c/jobs/${wo.id}">Details</a>${nextBtn(wo)}`}</div>
  </div>`;
}

// The job to work on now: one already in progress, otherwise the most urgent one waiting.
function currentJob(wo, working) {
  const inc = incOf(wo);
  const s = stageOf(wo);
  const late = wo.target && wo.target < Date.now();
  const km = kmTo(wo);
  const conn = inc?.connections || zoneOfWo(wo)?.connections;
  const facts = [
    ['Location', esc(wo.location || zoneOfWo(wo)?.name || 'Not set')],
    ['Target', wo.target ? `<span class="${late ? 'is-late' : ''}">${fmtDateTime(wo.target)}</span><small>${dueText(wo)}</small>` : 'Not set'],
    ['Assigned', `${fmtDateTime(assignedAt(wo))}<small>${relTime(assignedAt(wo))}</small>`],
    km != null ? ['Distance', `${fmt(km, 1)} km`] : conn ? ['Households served', `About ${fmt(conn)}`] : null,
  ].filter(Boolean);
  return `<section class="fxh">
    <div class="fxh-h">
      <div><span class="fxh-k">${working ? 'In progress' : 'Next job'}</span><span class="mono fxh-id">${esc(wo.id)}</span>${priText(wo)}</div>
      <span class="fxh-step">Step ${Math.min(s + 1, 5)} of 5, ${esc(STAGES[Math.min(s, 4)])}</span>
    </div>
    <h2 class="fxh-t">${esc(issueOf(wo))}</h2>
    ${wo.description && wo.description.split('.')[0] !== issueOf(wo) ? `<p class="fxh-d">${esc(wo.description)}</p>` : ''}
    <ol class="fxh-track">${STAGES.map((t, k) => `<li class="${k < s ? 'is-done' : k === s ? 'is-now' : ''}"><span></span>${esc(t)}</li>`).join('')}</ol>
    <dl class="fxh-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    <div class="fxh-f"><p>${esc(nextHint(wo))}</p><div class="fxh-a"><a class="btn btn--outline" href="#/c/jobs/${wo.id}">View work order</a>${nextBtn(wo, 'btn--primary')}</div></div>
  </section>`;
}

// One page for all of the responder's work: current job, then in progress, to do, and completed.
const list = (wos) => `<div class="fxa-list">${wos.map(assignmentRow).join('')}</div>`;
const assignments = {
  title: 'My Assignments',
  render() {
    const all = mine();
    const open = all.filter((w) => w.status !== 'Completed').sort(sortWos);
    const working = open.filter((w) => ACTIVE.includes(w.status));
    const todo = open.filter((w) => !ACTIVE.includes(w.status));
    const done = all.filter((w) => w.status === 'Completed').sort((a, b) => (b.completion?.at || 0) - (a.completion?.at || 0));
    const today = new Date().toDateString();
    const doneToday = done.filter((w) => new Date(w.completion?.at || 0).toDateString() === today).length;
    const urgent = open.filter((w) => w.priority === 'Critical' || w.priority === 'High').length;
    const overdue = open.filter((w) => w.target && w.target < Date.now()).length;
    const who = whoName();
    const cur = working[0] || todo[0];
    const rest = (wos) => wos.filter((w) => w !== cur);
    const cell = (k, v, sub, warn) => `<div><dt>${k}</dt><dd class="${warn ? 'is-warn' : ''}">${v}</dd><span>${sub}</span></div>`;
    return `<div class="page-h"><div><h1>My Assignments</h1><p class="page-sub">${isCrew() ? 'Work orders assigned to you by the water utility.' : `Previewing ${who ? esc(who) : 'all responders'}. <a href="#/c/profile">Change</a>`}</p></div>
      <div class="page-a">${open.length && !userPos ? `<button class="btn btn--outline btn--sm" data-action="fx-locate">Show distances</button>` : ''}</div></div>
      ${
        cur
          ? currentJob(cur, ACTIVE.includes(cur.status))
          : card('', empty('No assignments right now', 'New work orders from your provider will appear here.', 'clipboard', B.FB_ENABLED ? '' : `<button class="btn btn--outline" data-action="fx-demo">Load demo assignment</button>`))
      }
      <dl class="fxs">
        ${cell('Open', open.length, `${working.length} in progress, ${todo.length} not started`)}
        ${cell('Urgent', urgent, 'Critical or high priority', urgent > 0)}
        ${cell('Overdue', overdue, 'Past the target time', overdue > 0)}
        ${cell('Completed today', doneToday, `${done.length} completed in total`)}
      </dl>
      ${rest(working).length ? card('In progress', list(rest(working)), { sub: 'Pick up where you left off', cls: 'card--flush' }) : ''}
      ${rest(todo).length ? card('To do', list(rest(todo)), { sub: 'Most urgent first', cls: 'card--flush' }) : ''}
      ${done.length ? card('Completed', list(done.slice(0, 10)), { sub: done.length > 10 ? 'Latest 10' : 'Newest first', cls: 'card--flush' }) : ''}`;
  },
};

// ---------------------------------------------------------------- 2. WORK ORDER DETAIL
function woDetail(wo) {
  const s = st();
  const inc = incOf(wo);
  const z = zoneOfWo(wo);
  const zt = z && s.tele.zones[z.id];
  const pin = pinOf(wo);
  const ll = pin && toLL(pin.x, pin.y);
  const target = wo.target;
  const main = `
    ${card(
      'Problem summary',
      `<p class="fx-p">${esc(inc?.condition || wo.description || 'No summary yet.')}</p>
      <div class="kpis kpis--4 fx-evid">
        ${inc ? kpi({ label: 'Resident reports', value: inc.reportIds.length, sub: src('RESIDENT REPORTED') }) : ''}
        ${zt ? kpi({ label: 'Pressure', value: fmt(zt.pressure, 0), unit: 'PSI', sub: `${src('SIMULATED TELEMETRY')}`, sev: zt.status !== 'normal' ? zt.status : null }) : ''}
        ${zt ? kpi({ label: 'Flow vs expected', value: `${zt.flowDeltaPct >= 0 ? '+' : ''}${fmt(zt.flowDeltaPct, 0)}`, unit: '%', sub: src('SIMULATED TELEMETRY') }) : ''}
        ${kpi({ label: 'Reservoir', value: Math.round((s.tele.volML / S.RES_CAP_ML) * 100), unit: '%', sub: src('SIMULATED TELEMETRY') })}
      </div>`,
      { sub: inc ? `Related incident ${esc(inc.id)}` : 'No linked incident' }
    )}
    ${card(
      'Assignment',
      `<dl class="kv kv--3">
        <div><dt>Assigned team</dt><dd>${esc(wo.team || 'Unassigned')}</dd></div>
        <div><dt>Assigned</dt><dd>${fmtTime(assignedAt(wo))}</dd></div>
        <div><dt>Target response</dt><dd class="${target && target < Date.now() && wo.status !== 'Completed' ? 'txt-warn' : ''}">${target ? fmtTime(target) : '—'}</dd></div>
        <div><dt>Related incident</dt><dd class="mono">${inc ? esc(inc.id) : '—'}</dd></div>
        <div><dt>Location</dt><dd>${esc(wo.location || z?.name || '—')}</dd></div>
        <div><dt>Asset</dt><dd class="mono">${esc(wo.assetId || '—')}</dd></div>
      </dl>
      ${wo.description ? `<div class="fx-instr"><strong>Provider instruction</strong><p>“${esc(wo.description)}”</p></div>` : ''}`
    )}
    ${card(
      'Location',
      `<div class="fx-map">${renderMap({ mode: 'provider', compact: true, id: `fx-map-${wo.id}`, focusZone: z?.id, selected: wo.assetId, layers: ['zones', 'pipes', 'storage', 'sources', 'pumps', 'incidents'] })}</div>`,
      { sub: esc(wo.location || z?.name || ''), actions: ll ? `<a class="btn btn--outline btn--sm" href="https://www.google.com/maps/dir/?api=1&destination=${ll[0].toFixed(5)},${ll[1].toFixed(5)}" target="_blank" rel="noopener">${icon('pin', 14)} Open Map</a>` : '' }
    )}`;
  return `${woHead(wo, 1, 'Work Order')}${layout(wo, main)}`;
}
const woPage = {
  title: 'Work Order',
  holdOnChange: true,
  render({ id }) {
    const wo = woOf(id);
    return wo ? woDetail(wo) : empty('Work order not found', '', 'search', '<a class="btn btn--outline btn--sm" href="#/c/jobs">My Assignments</a>');
  },
};

// ---------------------------------------------------------------- photos (Inspection, Repair, Verification)
let errs = {};
// Drop errors that have been fixed since the last save attempt, so only real problems stay on screen.
function pruneErrs(wo, d, sec) {
  const ph = fieldOf(wo).photos;
  const has = (st) => ph.some((p) => p.stage === st);
  const ok = {
    conditions: () => d.conditions?.length,
    actions: () => d.actions?.length,
    notes: () => (d.notes || '').trim(),
    photos: () => !majorRepair(wo, d) || (has('before') && has('after')),
    photo: () => has('after'),
    restored: () => d.restored,
    pressure: () => d.pressure,
    final: () => FINAL.every((x) => (d.final || []).includes(x)),
    explain: () => (d.explain || '').trim(),
    reason: () => (d.reason || '').trim() && (d.next || '').trim(),
  };
  Object.keys(errs).forEach((k) => ok[k] && ok[k]() && delete errs[k]);
}
function photoBlock(wo, stage, title, hint) {
  const ph = fieldOf(wo).photos.map((p, i) => ({ ...p, i })).filter((p) => p.stage === stage);
  return `<div class="fx-ph">
    <div class="fx-ph-h"><strong>${title}</strong>${hint ? `<span>${hint}</span>` : ''}</div>
    <div class="fx-ph-list">${ph
      .map(
        (p) => `<figure class="fx-ph-i"><img src="${p.src}" alt="${esc(p.caption || title)}"/><figcaption>
          <input value="${esc(p.caption || '')}" placeholder="Add a caption" aria-label="Photo caption" data-change="fx-cap" data-id="${wo.id}" data-i="${p.i}"/>
          <small>${fmtTime(p.at)}, ${esc(wo.id)}</small>
          <button type="button" class="btn btn--ghost btn--xs" data-action="fx-ph-rm" data-id="${wo.id}" data-i="${p.i}">Remove</button></figcaption></figure>`
      )
      .join('')}
      ${ph.length
        ? `<label class="btn btn--outline btn--sm fx-ph-more">Add another photo<input type="file" accept="image/*" capture="environment" class="sr-only" data-change="fx-ph-add" data-id="${wo.id}" data-stage="${stage}"/></label>`
        : uploadBox('a photo', `<input type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" data-change="fx-ph-add" data-id="${wo.id}" data-stage="${stage}"/>`)}
    </div></div>`;
}
const notStarted = (wo, here, title, msg, ic) => `${woHead(wo, here, title)}${layout(wo, card('', empty(`${title} has not started`, msg, ic, actionBtn(wo))))}`;

// ---------------------------------------------------------------- 3. FIELD INSPECTION
const inspInit = (wo) => () => ({ check: {}, conditions: [], causes: [], pressure: '', flow: '', flowState: '', level: '', pump: '', notes: '', ...(fieldOf(wo).inspection || {}) });
const inspectPage = {
  title: 'Field Inspection',
  holdOnChange: true,
  render({ id }) {
    const wo = woOf(id);
    if (!wo) return empty('Work order not found', '', 'search');
    if (stageOf(wo) < 2) return notStarted(wo, 2, 'Field Inspection', 'Start the response and record your arrival first.', 'clipboard');
    const d = draft(id, 'insp', inspInit(wo));
    pruneErrs(wo, d, 'insp');
    const locked = stageOf(wo) > 2;
    const main = `
      ${locked ? notice('Inspection', 'Already saved', 'You can review it here. Changes on this screen are kept on this device only.') : ''}
      ${card(
        'Inspection checklist',
        `<ul class="fx-check">${CHECKS[kindOf(wo)]
          .map((item, n) => {
            const v = d.check[item] || '';
            const opt = (val, lbl) => `<label class="${v === val ? 'is-on' : ''}"><input type="radio" name="ck${n}" value="${val}" ${v === val ? 'checked' : ''} data-change="fx-check" data-id="${id}" data-item="${esc(item)}"/>${lbl}</label>`;
            return `<li><span>${esc(item)}</span><div class="seg seg--3" role="radiogroup" aria-label="${esc(item)}">${opt('normal', 'Normal')}${opt('issue', 'Issue found')}${opt('na', 'N/A')}</div></li>`;
          })
          .join('')}</ul>`,
        { sub: 'Mark each item as you check it' }
      )}
      ${card('What did you find?', `${chips('conditions', CONDITIONS, d.conditions, 'insp')}${errBox(errs.conditions)}`, { sub: 'Select all that apply' })}
      ${card('Possible cause', chips('causes', CAUSES, d.causes, 'insp'), { sub: 'Select all that apply' })}
      ${card(
        'Field measurements',
        `<div class="grid-2">
          ${field('Water pressure (PSI)', input('insp', 'pressure', d.pressure, 'type="number" inputmode="decimal" min="0" step="0.1" placeholder="e.g. 14"'))}
          ${field('Flow rate (L/s)', input('insp', 'flow', d.flow, 'type="number" inputmode="decimal" min="0" step="0.1" placeholder="e.g. 21"'))}
          ${field('Flow condition', select('insp', 'flowState', d.flowState, FLOW))}
          ${field('Pump status', select('insp', 'pump', d.pump, PUMP))}
          ${field('Water level (%)', input('insp', 'level', d.level, 'type="number" inputmode="decimal" min="0" max="100" placeholder="If relevant"'), { optional: true })}
        </div>`,
        { sub: 'Entered by you on site, not live sensor data', actions: fieldBadge() }
      )}
      ${card('Inspection photo', photoBlock(wo, 'before', 'Before repair', 'Saved as a before-repair photo'), { sub: 'Optional, but it helps your provider see what you found' })}
      ${card('Inspection notes', textarea('insp', 'notes', d.notes, 'e.g. Visible leakage about 10 m from the main distribution valve. Pipe section appears cracked.'))}
      ${
        locked
          ? ''
          : card(
              'Does this issue require repair?',
              `<div class="form-a fx-decide"><button class="btn btn--outline" data-action="fx-insp-save" data-id="${id}" data-repair="0">No, continue investigation</button><button class="btn btn--primary" data-action="fx-insp-save" data-id="${id}" data-repair="1">Yes, proceed to repair</button></div>`,
              { sub: "Saving sends the inspection to your provider's work order and incident timeline" }
            )
      }`;
    return `${woHead(wo, 2, 'Field Inspection')}${layout(wo, main)}`;
  },
};

// ---------------------------------------------------------------- 4. REPAIR & EVIDENCE
const repInit = (wo) => () => ({ actions: [], other: '', notes: '', materials: [{ name: '', qty: '' }], update: '', ...(fieldOf(wo).repair || {}) });
const majorRepair = (wo, d) => wo.priority === 'Critical' || wo.priority === 'High' || d.actions.some((a) => /Replaced|pipe/i.test(a));
const repairPage = {
  title: 'Repair & Evidence',
  holdOnChange: true,
  render({ id }) {
    const wo = woOf(id);
    if (!wo) return empty('Work order not found', '', 'search');
    if (stageOf(wo) < 3) return notStarted(wo, 3, 'Repair', 'Finish the inspection and choose "Proceed to Repair" first.', 'wrench');
    const d = draft(id, 'rep', repInit(wo));
    const insp = fieldOf(wo).inspection || {};
    const z = zoneOfWo(wo);
    const locked = stageOf(wo) > 3;
    const major = majorRepair(wo, d);
    pruneErrs(wo, d, 'rep');
    const main = `
      ${card(
        'Problem confirmed',
        `<dl class="kv kv--2">
          <div><dt>Confirmed issue</dt><dd>${esc((insp.conditions || []).join(', ') || 'Not recorded')}</dd></div>
          <div><dt>Possible cause</dt><dd>${esc((insp.causes || []).join(', ') || '—')}</dd></div>
          <div><dt>Location</dt><dd>${esc(wo.location || z?.name || '—')}</dd></div>
          <div><dt>Pressure before repair</dt><dd>${insp.pressure ? `${esc(insp.pressure)} PSI ${fieldBadge()}` : '—'}</dd></div>
        </dl>`,
        { sub: 'From your inspection' }
      )}
      ${card('Action taken', `${chips('actions', ACTIONS, d.actions, 'rep')}${d.actions.includes('Other') ? field('Other action', input('rep', 'other', d.other, 'placeholder="Describe the action"')) : ''}${errBox(errs.actions)}`, { sub: 'Select all that apply' })}
      ${card('Repair notes', `${textarea('rep', 'notes', d.notes, 'e.g. Damaged pipe section removed and replaced. Coupling installed and line secured before reopening the valve.')}${errBox(errs.notes)}`)}
      ${card(
        'Materials used',
        `<datalist id="fx-mats">${MATERIALS.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
        <ul class="fx-mats">${d.materials
          .map((m, i) => `<li><input list="fx-mats" placeholder="Material, e.g. PVC coupling" aria-label="Material" value="${esc(m.name)}" data-input="fx-mat" data-id="${id}" data-i="${i}" data-k="name"/><input type="number" inputmode="numeric" min="0" placeholder="Qty" aria-label="Quantity" value="${esc(m.qty)}" data-input="fx-mat" data-id="${id}" data-i="${i}" data-k="qty"/><button type="button" class="icon-btn" aria-label="Remove material" data-action="fx-mat-rm" data-id="${id}" data-i="${i}">${icon('x', 16)}</button></li>`)
          .join('')}</ul>`,
        { actions: `<button type="button" class="btn btn--ghost btn--sm" data-action="fx-mat-add" data-id="${id}">${icon('plus', 14)} Add material</button>` }
      )}
      ${card(
        'Photo evidence',
        `<div class="fx-ph-grid">${photoBlock(wo, 'before', 'Before repair')}${photoBlock(wo, 'during', 'During repair')}${photoBlock(wo, 'after', 'After repair')}</div>
        ${errs.photos ? errBox(errs.photos) : `<p class="fine">${major ? 'Major repair: at least one before and one after photo is required.' : 'Before and after photos help your provider confirm the repair.'}</p>`}`,
        { sub: 'Each photo keeps its time and work order number' }
      )}
      ${card(
        'Field update',
        `${textarea('rep', 'update', d.update, 'e.g. Damaged pipe section replaced. Preparing to reopen the line and begin pressure testing.')}
        <p class="fine">Goes to the work order and incident timeline. Residents do not see it; your provider decides what to tell the public.</p>`,
        { sub: 'A short progress note for your provider', actions: `<button type="button" class="btn btn--outline btn--sm" data-action="fx-update" data-id="${id}">${icon('megaphone', 14)} Send update</button>` }
      )}
      <section class="fx-help">
        <div><h3>Need help to finish?</h3><p>Ask your provider for more crew, equipment, parts or a technician. The work order stays open while you wait.</p>${fieldOf(wo).assistance?.length ? `<p class="fx-help-n">${fieldOf(wo).assistance.length} request${fieldOf(wo).assistance.length > 1 ? 's' : ''} sent, last ${relTime(fieldOf(wo).assistance.at(-1).at)}</p>` : ''}</div>
        <button type="button" class="btn btn--outline btn--sm" data-action="fx-assist" data-id="${id}">Request assistance</button>
      </section>
      ${locked ? '' : `<div class="form-a fx-pair"><button type="button" class="btn btn--outline" data-action="fx-rep-save" data-id="${id}">Save progress</button><button type="button" class="btn btn--primary" data-action="fx-verify-start" data-id="${id}">Begin verification</button></div>`}`;
    return `${woHead(wo, 3, 'Repair & Evidence')}${layout(wo, main)}`;
  },
};

// ---------------------------------------------------------------- 5. VERIFICATION
const verInit = (wo) => () => ({ pressure: '', flow: '', flowState: '', leak: '', pump: '', valve: '', level: '', other: '', restored: '', notes: '', explain: '', reason: '', next: '', final: [], ...(fieldOf(wo).verify || {}) });
function compareRows(wo, d) {
  const insp = fieldOf(wo).inspection || {};
  const leakBefore = (insp.conditions || []).some((c) => /Leak|Damaged pipe/.test(c)) ? 'Detected' : 'None seen';
  const row = (label, before, after) => `<div class="fx-cmp-r"><span class="fx-cmp-l">${label}</span><span class="fx-cmp-b"><small>Before</small><strong>${esc(before || '—')}</strong></span>${icon('arrow', 16)}<span class="fx-cmp-a"><small>After</small><strong>${esc(after || '—')}</strong></span></div>`;
  return `<div class="fx-cmp">
    ${row('Water pressure', insp.pressure ? `${insp.pressure} PSI` : '', d.pressure ? `${d.pressure} PSI` : '')}
    ${row('Flow', insp.flowState || (insp.flow ? `${insp.flow} L/s` : ''), d.flowState || (d.flow ? `${d.flow} L/s` : ''))}
    ${row('Leak', leakBefore, d.leak)}
  </div>`;
}
// Plain status card used on the workflow screens (no icon, no coloured stripe).
const notice = (k, title, text, aside = '', tone = '') => `<section class="fx-note ${tone ? `fx-note--${tone}` : ''}"><div><span class="fx-note-k">${esc(k)}</span><strong>${esc(title)}</strong><p>${esc(text)}</p></div>${aside ? `<div class="fx-note-a">${aside}</div>` : ''}</section>`;
function verifyChecks(wo, d) {
  return [!!d.restored, !!d.pressure, !!(d.notes || '').trim(), fieldOf(wo).photos.some((p) => p.stage === 'after'), FINAL.every((x) => d.final.includes(x))];
}
function verdict(wo, d) {
  const ok = d.restored === 'full' && FINAL.every((x) => d.final.includes(x)) && d.pressure && d.notes.trim() && fieldOf(wo).photos.some((p) => p.stage === 'after');
  return ok ? ['normal', 'Service restored', 'Ready to complete the work order.'] : d.restored && d.restored !== 'full' ? ['critical', 'Further action required', 'Send the result to your provider for follow-up.'] : ['info', 'Not verified yet', 'Complete the measurements, restoration check and final checklist.'];
}
const verifyPage = {
  title: 'Verification',
  holdOnChange: true,
  render({ id }) {
    const wo = woOf(id);
    if (!wo) return empty('Work order not found', '', 'search');
    if (stageOf(wo) < 4) return notStarted(wo, 4, 'Verification', 'Finish the repair and choose "Begin Verification" first.', 'gauge');
    const d = draft(id, 'ver', verInit(wo));
    pruneErrs(wo, d, 'ver');
    const done = wo.status === 'Completed';
    const [vs, vw, vt] = verdict(wo, d);
    const opt = (val, title, sub) => `<label class="fx-opt ${d.restored === val ? 'is-on' : ''}"><input type="radio" name="restored" value="${val}" ${d.restored === val ? 'checked' : ''} data-change="fx-in" data-sec="ver" data-k="restored"/><strong>${title}</strong><small>${sub}</small></label>`;
    const main = `
      ${card('Before and after', compareRows(wo, d), { sub: 'Before comes from your inspection' })}
      ${card(
        'Post-repair measurements',
        `<div class="grid-2">
          ${field('Water pressure (PSI)', input('ver', 'pressure', d.pressure, 'type="number" inputmode="decimal" min="0" step="0.1" placeholder="e.g. 31"'))}
          ${field('Flow condition', select('ver', 'flowState', d.flowState, FLOW))}
          ${field('Leak', select('ver', 'leak', d.leak, ['No visible leakage', 'Still leaking', 'Not applicable']))}
          ${field('Pump status', select('ver', 'pump', d.pump, PUMP))}
          ${field('Valve status', select('ver', 'valve', d.valve, VALVE))}
          ${field('Flow rate (L/s)', input('ver', 'flow', d.flow, 'type="number" inputmode="decimal" min="0" step="0.1"'), { optional: true })}
          ${field('Water level (%)', input('ver', 'level', d.level, 'type="number" inputmode="decimal" min="0" max="100"'), { optional: true })}
          ${field('Other reading', input('ver', 'other', d.other, 'placeholder="e.g. Chlorine 0.6 mg/L"'), { optional: true })}
        </div>${errBox(errs.pressure)}`,
        { sub: 'Entered by you on site, not live sensor data', actions: fieldBadge() }
      )}
      ${card(
        'Has water service been restored?',
        `<div class="fx-opts" role="radiogroup">${opt('full', 'Yes — Fully Restored', 'Pressure and flow are back to normal')}${opt('partial', 'Partially Restored', 'Better, but not fully back to normal')}${opt('no', 'No — Problem Remains', 'Service is still affected')}</div>
        ${d.restored === 'full' ? `${field('Final notes', textarea('ver', 'notes', d.notes, 'e.g. Pressure back to 31 PSI after replacing the cracked section. No leakage after 20 minutes.'), { req: true })}${errBox(errs.notes)}${photoBlock(wo, 'after', 'After-repair photo', 'Required')}${errBox(errs.photo)}` : ''}
        ${d.restored === 'partial' ? `${field('What is still wrong?', textarea('ver', 'explain', d.explain, 'e.g. Pressure improved but remains below normal in the eastern part of the zone.'), { req: true })}${errBox(errs.explain)}` : ''}
        ${d.restored === 'no' ? `${field('Reason', textarea('ver', 'reason', d.reason, 'Why is the problem still there?'), { req: true })}${field('Recommended next action', textarea('ver', 'next', d.next, 'e.g. Excavate under the roadway; second crew needed'), { req: true })}${errBox(errs.reason)}` : ''}
        ${errBox(errs.restored)}`
      )}
      ${card(
        'Final checklist',
        `<ul class="fx-final">${FINAL.map((x) => `<li><label class="chk"><input type="checkbox" ${d.final.includes(x) ? 'checked' : ''} data-change="fx-multi" data-sec="ver" data-k="final" value="${esc(x)}"/> ${esc(x)}</label></li>`).join('')}</ul>${errBox(errs.final)}`,
        { sub: 'All items are required to complete the work order' }
      )}
      ${(() => {
        const c = verifyChecks(wo, d);
        const n = c.filter(Boolean).length;
        const aside = vs === 'info' ? `<strong>${n} of ${c.length}</strong><span>checks done</span>` : '';
        return notice('Verification result', vw, vt, aside, vs === 'normal' ? 'ok' : vs === 'critical' ? 'act' : '');
      })()}
      ${
        done
          ? ''
          : `<div class="form-a fx-pair"><button type="button" class="btn btn--outline" data-action="fx-back-repair" data-id="${id}">Back to repair</button>${
              d.restored && d.restored !== 'full'
                ? `<button type="button" class="btn btn--danger" data-action="fx-ver-save" data-id="${id}">Send to provider</button>`
                : `<button type="button" class="btn btn--primary" data-action="fx-ver-save" data-id="${id}">Review and complete</button>`
            }</div>`
      }`;
    return `${woHead(wo, 4, 'Verification')}${layout(wo, main)}`;
  },
};

// ---------------------------------------------------------------- COMPLETE (summary)
const donePage = {
  title: 'Work Order Complete',
  holdOnChange: true,
  render({ id }) {
    const wo = woOf(id);
    if (!wo) return empty('Work order not found', '', 'search');
    const f = fieldOf(wo);
    const v = f.verify;
    if (!v || v.restored !== 'full') return notStarted(wo, 4, 'Completion', 'Confirm on the Verification screen that service is fully restored first.', 'gauge');
    const inc = incOf(wo);
    const done = wo.status === 'Completed';
    const rows = [
      ['Work order', wo.id],
      ['Incident', inc?.id || '—'],
      ['Issue', issueOf(wo)],
      ['Confirmed cause', (f.inspection?.causes || []).join(', ') || (f.inspection?.conditions || []).join(', ') || '—'],
      ['Repair', (f.repair?.actions || []).join(', ') || '—'],
      ['Materials', (f.repair?.materials || []).filter((m) => m.name).map((m) => `${m.name}${m.qty ? ` × ${m.qty}` : ''}`).join(', ') || '—'],
      ['Pressure before', f.inspection?.pressure ? `${f.inspection.pressure} PSI` : '—'],
      ['Pressure after', v.pressure ? `${v.pressure} PSI` : '—'],
      ['Photos', `${f.photos.length} attached`],
      ['Service', 'Restored'],
      ['Completed', done ? fmtDateTime(wo.completion?.at) : 'Not yet'],
      ['Responder', wo.team || RESPONDER_USER.name],
    ];
    const main = `
      ${done ? notice('Work order', 'Complete', 'Your provider has the verified field result. They will decide when the incident is fully resolved.', '', 'ok') : notice('Work order', 'Ready to complete', 'Check the summary, then complete the work order. The incident stays open until your provider resolves it.')}
      ${card('Summary', `<dl class="kv kv--3">${rows.map(([k, val]) => `<div><dt>${k}</dt><dd>${esc(val)}</dd></div>`).join('')}</dl>`, { sub: 'Sent to your provider with the work order' })}
      ${done ? `<div class="form-a fx-pair"><a class="btn btn--primary" href="#/c/jobs">Back to My Assignments</a></div>` : `<div class="form-a fx-pair"><a class="btn btn--outline" href="#/c/verify/${wo.id}">Edit verification</a><button type="button" class="btn btn--primary" data-action="fx-complete" data-id="${wo.id}">Complete work order</button></div>`}`;
    return `${woHead(wo, 4, done ? 'Work Order Complete' : 'Ready to Complete')}${layout(wo, main)}`;
  },
};

// ---------------------------------------------------------------- PROFILE
const profile = {
  title: 'Profile',
  render() {
    const crew = isCrew();
    const u = crew ? RESPONDER_USER : PROVIDER_USER;
    const email = B.getSession()?.email || u.loginEmail || '';
    const ss = B.syncState();
    const e = viewAs();
    return `<div class="page-h"><div><h1>Profile</h1><p class="page-sub">${crew ? 'Your account and how your updates reach the water utility.' : 'Preview the responder app as one of your field responders.'}</p></div></div>
      <div class="rprof"><aside class="rprof-side">
        <section class="card rprof-me"><span class="avatar avatar--navy rprof-av">${esc(u.initials)}</span><h2>${esc(u.name)}</h2>${email ? `<p class="muted">${esc(email)}</p>` : ''}
          <div class="rprof-chips"><span class="pill pill--blue">${icon('wrench', 12)} ${crew ? 'Field responder' : 'Staff preview'}</span></div>
          <div class="rprof-a"><button class="btn btn--outline btn--sm" data-action="account-settings">${icon('user', 15)} Account settings</button>${crew ? '' : `<button class="btn btn--outline btn--sm" data-action="switch-to" data-role="provider">${icon('activity', 15)} Operator view</button>`}<button class="btn btn--ghost btn--sm" data-action="logout">${icon('logout', 15)} Sign out</button></div>
        </section></aside>
        <div class="rprof-main">
          ${
            crew
              ? card(
                  'My details',
                  `<dl class="kv kv--3"><div><dt>Name</dt><dd>${esc(u.name)}</dd></div><div><dt>Sign-in email</dt><dd>${esc(email || '—')}</dd></div><div><dt>Phone</dt><dd>${esc(u.phone || '—')}</dd></div></dl>
                  <p class="fine">Your sign-in email is issued by the water utility. Ask your supervisor to change it.</p>`,
                  { sub: 'Work orders are assigned to this account' }
                )
              : card(
                  'Preview as',
                  `${field('Show assignments for', `<select data-change="fx-view">${[['', 'All responders'], ...S.responders().map((r) => [r.loginEmail, r.name])].map(([v, l]) => `<option value="${esc(v)}" ${v === e ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`)}
                  <p class="fine">Saved on this device. Responders manage their own work orders when they sign in.</p>`,
                  { sub: 'Only their work orders are listed' }
                )
          }
          ${card('Sync', `<p class="fx-p">${syncLabel().html}</p><p class="fine">${ss.enabled ? (ss.online ? 'Each step is sent to the water utility when you save it. What you type is also kept on this device until then.' : 'You are offline. Updates are saved on this device and will sync when a connection is available.') : 'Local copy: nothing is sent to the shared database.'}</p>`, { sub: 'The utility only sees what the server has confirmed' })}
        </div></div>`;
  },
};

export const fieldViews = {
  jobs: assignments,
  profile,
  'jobs/:id': woPage,
  'inspect/:id': inspectPage,
  'repair/:id': repairPage,
  'verify/:id': verifyPage,
  'done/:id': donePage,
};

// Sync status for the top bar (same dot + word cell as the operator "System status").
// Never claims "synced" while the server has not confirmed.
export function syncLabel() {
  const ss = B.syncState();
  const [sev, word, tip] = !ss.enabled
    ? ['info', 'Local copy', 'Nothing is sent to the shared database']
    : !ss.online
      ? ['offline', 'Offline', 'Updates are saved on this device and will sync when a connection is available']
      : ss.pending
        ? ['warning', 'Sending…', 'Waiting for the server to confirm your update']
        : ['normal', ss.lastSyncedAt ? 'Updates synced' : 'Online', 'Your provider has your latest updates'];
  return { sev, word, tip, html: `<span class="sys-dot sys-dot--${SEV[sev].cls}" aria-hidden="true"></span> <strong>${word}</strong>` };
}

// ---------------------------------------------------------------- actions
const rerender = () => go(location.hash);
const top = () => window.scrollTo(0, 0);
const valOf = (el) => (el.type === 'checkbox' ? el.checked : el.value);
registerInputs({
  'fx-in': (el) => {
    const id = location.hash.split('/')[3];
    const sec = el.dataset.sec;
    const d = drafts[draftKey(id, sec)];
    if (!d) return;
    d[el.dataset.k] = valOf(el);
    saveDraft(id, sec);
    if (el.type === 'radio' || el.tagName === 'SELECT') rerender(); // these change what the screen shows
  },
  'fx-multi': (el) => {
    const id = location.hash.split('/')[3];
    const d = drafts[draftKey(id, el.dataset.sec)];
    if (!d) return;
    const arr = d[el.dataset.k];
    const i = arr.indexOf(el.value);
    el.checked ? i < 0 && arr.push(el.value) : i >= 0 && arr.splice(i, 1);
    saveDraft(id, el.dataset.sec);
    rerender();
  },
  'fx-check': (el) => {
    const d = drafts[draftKey(el.dataset.id, 'insp')];
    d.check[el.dataset.item] = el.value;
    saveDraft(el.dataset.id, 'insp');
    rerender();
  },
  'fx-mat': (el) => {
    const d = drafts[draftKey(el.dataset.id, 'rep')];
    d.materials[+el.dataset.i][el.dataset.k] = el.value;
    saveDraft(el.dataset.id, 'rep');
  },
  'fx-cap': (el) => S.fieldPhotoCaption(el.dataset.id, +el.dataset.i, el.value.trim()),
  'fx-ph-add': async (el) => {
    const f = el.files?.[0];
    if (!f) return;
    try {
      await S.fieldAddPhoto(el.dataset.id, { stage: el.dataset.stage, src: S.isRemote() ? await readImage(f, 1280, 0.82) : await readImage(f, 480), caption: '' });
    } catch (e) {
      console.error(e);
      S.toast(e?.code ? `Could not upload the photo (${e.code})` : 'Could not read that photo', 'error');
    }
  },
  'fx-view': (el) => {
    ls.set(VIEW_KEY, el.value || null);
    rerender();
  },
});

register({
  'fx-start': (el) => (S.fieldStartResponse(el.dataset.id), go(`#/c/jobs/${el.dataset.id}`), top()),
  'fx-arrive': (el) => S.fieldArrive(el.dataset.id),
  'fx-inspect': (el) => (S.fieldStartInspection(el.dataset.id), go(`#/c/inspect/${el.dataset.id}`), top()),
  'fx-locate': () => {
    if (!navigator.geolocation) return S.toast('Location is not available on this device', 'info');
    navigator.geolocation.getCurrentPosition(
      (p) => ((userPos = [p.coords.latitude, p.coords.longitude]), rerender()),
      () => S.toast('Could not get your location. Distances are hidden.', 'info'),
      { maximumAge: 120000, timeout: 10000 }
    );
  },
  'fx-demo': (el) =>
    busy(el, async () => {
      const wo = await S.createResponderDemo(RESPONDER_USER);
      go(`#/c/jobs/${wo.id}`);
    }),
  'fx-insp-save': (el) => {
    const id = el.dataset.id;
    const d = drafts[draftKey(id, 'insp')];
    errs = d.conditions.length ? {} : { conditions: 'Select at least one finding.' };
    if (errs.conditions) return (rerender(), document.querySelector('#view .err')?.scrollIntoView({ block: 'center' }));
    const repair = el.dataset.repair === '1';
    S.fieldSaveInspection(id, structuredClone(d), repair);
    if (repair) (clearDraft(id, 'insp'), go(`#/c/repair/${id}`), top());
    else go(`#/c/jobs/${id}`);
  },
  'fx-mat-add': (el) => {
    drafts[draftKey(el.dataset.id, 'rep')].materials.push({ name: '', qty: '' });
    saveDraft(el.dataset.id, 'rep');
    rerender();
  },
  'fx-mat-rm': (el) => {
    const d = drafts[draftKey(el.dataset.id, 'rep')];
    d.materials.splice(+el.dataset.i, 1);
    if (!d.materials.length) d.materials.push({ name: '', qty: '' });
    saveDraft(el.dataset.id, 'rep');
    rerender();
  },
  'fx-ph-rm': async (el) => {
    if (await confirmDialog({ title: 'Remove this photo?', body: 'It will be removed from the work order evidence.', confirm: 'Remove', danger: true })) S.fieldRemovePhoto(el.dataset.id, +el.dataset.i);
  },
  'fx-rep-save': (el) => S.fieldSaveRepair(el.dataset.id, cleanRepair(el.dataset.id)),
  'fx-update': (el) => {
    const id = el.dataset.id;
    const d = drafts[draftKey(id, 'rep')];
    if (!d.update.trim()) return S.toast('Write a short update first', 'info');
    S.fieldUpdate(id, d.update);
    d.update = '';
    saveDraft(id, 'rep');
    rerender();
  },
  'fx-assist': (el) => {
    const id = el.dataset.id;
    openModal(
      'Request Assistance',
      `<form class="form" id="fx-as" onsubmit="return false">
        ${field('Reason', `<select id="fx-as-r">${ASSIST.map((r) => `<option>${esc(r)}</option>`).join('')}</select>`, { id: 'fx-as-r', req: true })}
        ${field('Details', '<textarea id="fx-as-t" rows="3" placeholder="e.g. Pipe damage extends beneath the roadway. Excavation equipment and more personnel are needed."></textarea>', { id: 'fx-as-t' })}
        <p class="fine">Sent to your provider and added to the incident timeline. The work order stays open.</p>
      </form>`,
      { footer: `<button class="btn btn--ghost" data-action="ov-close">Cancel</button><button class="btn btn--danger" data-action="fx-assist-send" data-id="${id}">${icon('alert', 15)} Send request</button>` }
    );
  },
  'fx-assist-send': (el) => {
    S.fieldRequestAssistance(el.dataset.id, document.getElementById('fx-as-r').value, document.getElementById('fx-as-t').value.trim());
    closeOverlay();
  },
  'fx-verify-start': (el) => {
    const id = el.dataset.id;
    const wo = woOf(id);
    const d = drafts[draftKey(id, 'rep')];
    const ph = fieldOf(wo).photos;
    errs = {};
    if (!d.actions.length) errs.actions = 'Select at least one action taken.';
    if (!d.notes.trim()) errs.notes = 'Add short repair notes.';
    if (majorRepair(wo, d) && !(ph.some((p) => p.stage === 'before') && ph.some((p) => p.stage === 'after'))) errs.photos = 'Major repair: add at least one before and one after photo.';
    if (Object.keys(errs).length) return (rerender(), document.querySelector('#view .err')?.scrollIntoView({ block: 'center' }));
    S.fieldBeginVerification(id, cleanRepair(id));
    clearDraft(id, 'rep');
    go(`#/c/verify/${id}`);
    top();
  },
  'fx-back-repair': (el) => (S.fieldBackToRepair(el.dataset.id), go(`#/c/repair/${el.dataset.id}`), top()),
  'fx-ver-save': (el) => {
    const id = el.dataset.id;
    const wo = woOf(id);
    const d = drafts[draftKey(id, 'ver')];
    errs = {};
    if (!d.restored) errs.restored = 'Choose whether service has been restored.';
    if (d.restored === 'full') {
      if (!d.pressure) errs.pressure = 'Enter the pressure after the repair.';
      if (!d.notes.trim()) errs.notes = 'Add final notes.';
      if (!fieldOf(wo).photos.some((p) => p.stage === 'after')) errs.photo = 'Add an after-repair photo.';
      if (!FINAL.every((x) => d.final.includes(x))) errs.final = 'Tick every item on the final checklist.';
    }
    if (d.restored === 'partial' && !d.explain.trim()) errs.explain = 'Explain what is still wrong.';
    if (d.restored === 'no' && !(d.reason.trim() && d.next.trim())) errs.reason = 'Add the reason and the recommended next action.';
    if (Object.keys(errs).length) return (rerender(), document.querySelector('#view .err')?.scrollIntoView({ block: 'center' }));
    S.fieldSaveVerification(id, structuredClone(d));
    if (d.restored === 'full') (go(`#/c/done/${id}`), top());
    else go(`#/c/jobs/${id}`);
  },
  'fx-complete': (el) => {
    const id = el.dataset.id;
    S.fieldComplete(id);
    clearDraft(id, 'ver');
    rerender();
    top();
  },
});
function cleanRepair(id) {
  const d = structuredClone(drafts[draftKey(id, 'rep')]);
  d.materials = d.materials.filter((m) => m.name.trim());
  delete d.update;
  return d;
}
// Clear validation messages when moving between screens.
window.addEventListener('hashchange', () => (errs = {}));
