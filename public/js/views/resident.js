// Resident portal views — mobile-first.
import * as S from '../store.js';
import { RESIDENT, REPORT_TYPES, REPORT_STEPS, ZONES, zoneById, reportTypeLabel, UTILITY } from '../data.js';
import { icon, status, src, card, alertBanner, timeline, empty, register, registerInputs, openModal, closeOverlay, field, updatedAgo, SEV, actions, busy } from '../ui.js';
import { lineChart, barChart, gaugeBar } from '../charts.js';
import { renderMap, svgPoint } from '../map.js';
import { esc, fmt, fmtTime, fmtDate, fmtDateShort, fmtDateTime, relTime, toLocalInput, fromLocalInput, readImage, pointInPolygon, parsePoly, hoursLabel } from '../util.js';
import { notificationsView, go, canSwitchRole } from '../app.js';

const st = () => S.getState();
const myZone = () => zoneById(RESIDENT.zone);

// ---------------------------------------------------------------- shared bits
export function residentReportStatus(r) {
  if (r.status === 'repair_completed') {
    if (r.residentResponse && !r.residentResponse.restored) return { sev: 'warning', label: 'Follow-up Requested' };
    if (r.awaitingVerification && !r.residentResponse) return { sev: 'info', label: 'Awaiting Your Confirmation' };
    return { sev: 'info', label: 'Repair Completed' };
  }
  return (
    {
      submitted: { sev: 'offline', label: 'Awaiting Provider Review' },
      acknowledged: { sev: 'info', label: 'Provider Acknowledged' },
      investigating: { sev: 'info', label: 'Under Investigation' },
      repair_assigned: { sev: 'warning', label: 'Repair Assigned' },
      verified: { sev: 'normal', label: 'Service Verified' },
    }[r.status] || { sev: 'info', label: r.status }
  );
}

function progressMini(r) {
  const idx = REPORT_STEPS.findIndex((x) => x.id === r.status);
  return `<div class="pmini" aria-label="Step ${idx + 1} of ${REPORT_STEPS.length}: ${esc(REPORT_STEPS[idx].label)}">${REPORT_STEPS.map((_, i) => `<span class="${i <= idx ? 'on' : ''}"></span>`).join('')}</div>`;
}

const OUTLOOK = {
  stable: { sev: 'normal', label: 'Stable', text: 'Expected water supply is sufficient based on current storage, production, and estimated demand.' },
  watch: { sev: 'info', label: 'Stable — being monitored', text: 'Supply is expected to remain available. The provider is monitoring storage levels closely.' },
  risk: { sev: 'warning', label: 'Possible Supply Interruptions', text: 'Based on current conditions, supply may become limited within the next 24 hours. Consider storing water for essential needs.' },
  critical: { sev: 'critical', label: 'Supply Interruptions Likely', text: 'Based on current conditions, supply may become limited within hours. Store water for drinking and cooking.' },
};

function outlookStrip(fc) {
  const segs = [
    ['Now', fc.now],
    ['+6 h', fc.at6],
    ['+12 h', fc.at12],
    ['+24 h', fc.at24],
  ];
  const lv = (p) => (p < 0.3 ? ['critical', 'Low'] : p < 0.42 ? ['warning', 'Limited'] : p < 0.5 ? ['info', 'Adequate'] : ['normal', 'Good']);
  return `<ol class="ostrip">${segs
    .map(([t, p]) => {
      const [sev, word] = lv(p);
      return `<li class="ostrip-i ostrip-i--${SEV[sev].cls}"><span class="ostrip-t">${t}</span><span class="ostrip-bar"></span><span class="ostrip-w">${icon(SEV[sev].icon, 13)} ${word}</span></li>`;
    })
    .join('')}</ol>`;
}

function advisoryCard(a, { compact = false } = {}) {
  const inArea = a.areas.includes(RESIDENT.zone);
  const sev = a.status === 'Resolved' ? 'normal' : a.kind === 'Water Quality' ? 'info' : a.serviceStatus === 'NO WATER' ? 'critical' : 'warning';
  return `<article class="adv ${a.status === 'Resolved' ? 'adv--done' : ''}">
    <div class="adv-h">${status(sev, a.status === 'Resolved' ? 'Resolved' : a.serviceStatus)}${inArea ? '<span class="pill pill--blue">Your area</span>' : ''}<span class="adv-id">${a.id}</span></div>
    <h3 class="adv-t">${esc(a.title)}</h3>
    <dl class="adv-meta">
      <div><dt>Affected areas</dt><dd>${a.areas.map((z) => esc(zoneById(z).short)).join(', ')} — ${esc(a.barangays.join(', '))}</dd></div>
      <div><dt>Started</dt><dd>${fmtDateTime(a.startAt)}</dd></div>
      <div><dt>Latest update</dt><dd>${fmtDateTime(a.updatedAt)}</dd></div>
      ${a.status !== 'Resolved' ? (a.etr ? `<div><dt>Estimated restoration</dt><dd><strong>${fmtTime(a.etr)}</strong> <span class="src src--est">ESTIMATED</span></dd></div>` : a.nextUpdate ? `<div><dt>Next update</dt><dd><strong>${fmtTime(a.nextUpdate)}</strong></dd></div>` : '') : ''}
    </dl>
    <p class="adv-msg">${esc(a.message)}</p>
    ${a.instructions && !compact ? `<div class="adv-ins">${icon('info', 16)}<div><strong>Provider instructions</strong><p>${esc(a.instructions)}</p></div></div>` : ''}
  </article>`;
}

// ---------------------------------------------------------------- HOME
function homeStatus() {
  const s = st();
  const svc = S.residentService(s);
  const z = myZone();
  const sevCls = SEV[svc.sev].cls;
  let expect = '';
  if (svc.advisory && !svc.restored) {
    expect = svc.etr
      ? `<div class="hs-exp"><span>Estimated Restoration</span><strong>${fmtTime(svc.etr)}</strong><em>${src('ESTIMATED')} provided by your water provider</em></div>`
      : svc.nextUpdate
        ? `<div class="hs-exp"><span>Next update expected</span><strong>${fmtTime(svc.nextUpdate)}</strong><em>Restoration time not yet confirmed</em></div>`
        : '';
  }
  return `<section class="hs hs--${sevCls}" aria-labelledby="hs-title">
    <div class="hs-top">
      <div><div class="hs-k">Your Area</div><div class="hs-area">Barangay ${esc(RESIDENT.barangay)}</div><div class="hs-zone">${esc(z.name)}</div></div>
      <div class="hs-ic">${icon(SEV[svc.sev].icon, 28)}</div>
    </div>
    <div class="hs-k">Current Service</div>
    <h1 id="hs-title" class="hs-status">${esc(svc.label)}</h1>
    <div class="hs-upd">${icon('clock', 14)} Updated ${updatedAgo(svc.updatedAt)}</div>
    <p class="hs-msg">${esc(svc.message)}</p>
    ${svc.team ? `<div class="hs-team">${icon('users', 16)} ${esc(svc.team)}</div>` : ''}
    ${expect}
    <div class="hs-actions">
      ${svc.advisory ? `<a class="btn btn--light" href="#/r/advisories">${icon('megaphone', 16)} View Advisory</a>` : ''}
      <a class="btn btn--light" href="#/r/report">${icon('plus', 16)} Report a Problem</a>
      <a class="btn btn--light" href="#/r/reports">${icon('clipboard', 16)} Track My Reports</a>
    </div>
  </section>`;
}

function homeOutlook() {
  const fc = S.forecast({ hours: 24 });
  const o = OUTLOOK[fc.status];
  return card(
    'Water Availability Outlook',
    `<div class="ol-h"><div><div class="ol-k">Next 24 Hours</div><div class="ol-s">${status(o.sev, o.label, { lg: true })}</div></div>${src('FORECAST')}</div>
     <p class="ol-t">${o.text}</p>${outlookStrip(fc)}
     <p class="fine">Based on current conditions. Forecasts are estimates and may change. <a href="#/r/outlook">See full outlook</a></p>`,
    { cls: 'card--outlook' }
  );
}

function homeLatest() {
  const s = st();
  const mine = s.reports.filter((r) => r.mine).sort((a, b) => b.submittedAt - a.submittedAt);
  const r = mine[0];
  if (!r) return card('My Latest Report', empty('No reports yet', 'Report water problems in your area so your provider can investigate.', 'clipboard', '<a class="btn btn--primary btn--sm" href="#/r/report">Report a Problem</a>'));
  const rs = residentReportStatus(r);
  const last = r.updates[r.updates.length - 1];
  return card(
    'My Latest Report',
    `<a class="rep-row" href="#/r/reports/${r.id}">
      <div class="rep-row-h"><span class="mono">${r.id}</span>${status(rs.sev, rs.label)}</div>
      <div class="rep-row-t">${esc(reportTypeLabel(r.type))}</div>
      ${progressMini(r)}
      <dl class="kv kv--2"><div><dt>Submitted</dt><dd>${fmtDateTime(r.submittedAt)}</dd></div><div><dt>Latest update</dt><dd>${last ? relTime(last.at) : '—'}</dd></div></dl>
      ${last ? `<p class="rep-row-u">${esc(last.text)}</p>` : ''}
      ${rs.label === 'Awaiting Your Confirmation' ? `<div class="banner banner--info sm">${icon('info', 16)}<div class="banner-c"><strong>Has your water service returned?</strong> Tap to confirm.</div></div>` : ''}
    </a>`,
    { actions: `<a class="link" href="#/r/reports">All reports ${icon('chev-r', 14)}</a>` }
  );
}

const home = {
  title: 'My Water Service',
  regions: { status: homeStatus, outlook: homeOutlook },
  render() {
    const s = st();
    const adv = s.advisories.filter((a) => a.status === 'Active' && a.areas.includes(RESIDENT.zone));
    const svc = S.residentService(s);
    const disruption = svc.sev !== 'normal' || adv.length;
    const alt = s.altWater.filter((p) => p.active && p.zone === RESIDENT.zone && p.status !== 'CLOSED');
    return `<div class="r-page">
      <div class="r-greet">Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${esc(RESIDENT.name.split(' ')[0])}</div>
      <div data-region="status">${homeStatus()}</div>
      <div class="r-grid">
        <div class="r-col">
          ${card(
            'Active Advisory',
            adv.length ? adv.map((a) => advisoryCard(a)).join('') : empty('No active advisories for your area', 'You will be notified when your provider publishes an advisory.', 'megaphone'),
            { actions: `<a class="link" href="#/r/advisories">All advisories ${icon('chev-r', 14)}</a>` }
          )}
          ${card(
            'Report a problem quickly',
            `<div class="qa">${[
              ['no_water', 'No Water', 'droplet-off'],
              ['low_pressure', 'Low Pressure', 'gauge'],
              ['leak', 'Pipe Leak', 'droplets'],
              ['color', 'Water Quality Concern', 'flask'],
            ]
              .map(([id, l, ic]) => `<button class="qa-b" data-action="quick-report" data-type="${id}">${icon(ic, 22)}<span>${l}</span></button>`)
              .join('')}</div>`
          )}
        </div>
        <div class="r-col">
          ${homeLatest()}
          <div data-region="outlook">${homeOutlook()}</div>
          ${
            disruption && alt.length
              ? card(
                  'Alternative Water Access',
                  `<ul class="mini-list">${alt
                    .slice(0, 2)
                    .map((p) => `<li><div><strong>${esc(p.name)}</strong><span>${esc(p.hours)} · confirmed ${relTime(p.confirmedAt)}</span></div>${altStatus(p.status)}</li>`)
                    .join('')}</ul>`,
                  { actions: `<a class="link" href="#/r/water-access">View all ${icon('chev-r', 14)}</a>` }
                )
              : ''
          }
        </div>
      </div>
    </div>`;
  },
};

const altStatus = (s) => status({ AVAILABLE: 'normal', LIMITED: 'warning', SCHEDULED: 'info', CLOSED: 'offline' }[s] || 'info', s);

// ---------------------------------------------------------------- REPORT A PROBLEM
let draft = null;
let lastSubmitted = null;
function newDraft(type) {
  return { type: type || '', description: '', useHome: true, location: RESIDENT.address, barangay: RESIDENT.barangay, pin: { x: RESIDENT.x, y: RESIDENT.y }, confirmed: false, observedAt: toLocalInput(Date.now()), photo: null, errors: {} };
}
const zoneAt = (pin) => ZONES.find((z) => pointInPolygon([pin.x, pin.y], parsePoly(z.poly)));

const report = {
  title: 'Report a Problem',
  leave() {
    lastSubmitted = null;
  },
  render() {
    if (lastSubmitted) return submittedView(lastSubmitted);
    if (!draft) draft = newDraft();
    const d = draft;
    const z = zoneAt(d.pin);
    const e = d.errors;
    return `<div class="r-page r-page--narrow">
      <div class="page-h"><div><h1>Report a Problem</h1><p class="page-sub">Tell your water provider what you are experiencing. Your report helps them find and fix problems faster.</p></div></div>
      <form class="form" id="report-form" novalidate>
        <fieldset class="fs"><legend class="fs-l"><span class="fs-n">1</span>What is the problem? <span class="req">*</span></legend>
          <div class="cat-grid" role="radiogroup" aria-label="Problem type">${REPORT_TYPES.map(
            (t) => `<label class="cat ${d.type === t.id ? 'is-on' : ''}"><input type="radio" name="type" value="${t.id}" ${d.type === t.id ? 'checked' : ''} data-change="rp-type"/>${icon(t.icon, 22)}<span>${t.label}</span></label>`
          ).join('')}</div>
          ${e.type ? `<div class="err" role="alert">${icon('alert', 14)} Choose a problem type.</div>` : ''}
        </fieldset>
        <fieldset class="fs"><legend class="fs-l"><span class="fs-n">2</span>Describe what you observed</legend>
          ${field('Description', `<textarea id="rp-desc" rows="3" data-input="rp-desc" placeholder="e.g. Very weak flow from all faucets since 8 AM" maxlength="500">${esc(d.description)}</textarea>`, { id: 'rp-desc', hint: 'Include how long it has been happening and whether neighbors are affected.', optional: true })}
          ${field('Date and time observed', `<input type="datetime-local" id="rp-when" value="${d.observedAt}" max="${toLocalInput(Date.now())}" data-input="rp-when"/>`, { id: 'rp-when', req: true })}
        </fieldset>
        <fieldset class="fs"><legend class="fs-l"><span class="fs-n">3</span>Where is the problem?</legend>
          <div class="seg" role="radiogroup" aria-label="Service location">
            <label class="${d.useHome ? 'is-on' : ''}"><input type="radio" name="loc" value="home" ${d.useHome ? 'checked' : ''} data-change="rp-loc"/>${icon('home', 16)} My service address</label>
            <label class="${!d.useHome ? 'is-on' : ''}"><input type="radio" name="loc" value="other" ${!d.useHome ? 'checked' : ''} data-change="rp-loc"/>${icon('pin', 16)} Another location</label>
          </div>
          ${
            d.useHome
              ? `<div class="loc-box">${icon('home', 18)}<div><strong>${esc(RESIDENT.address)}</strong><span>Account ${RESIDENT.account} · ${esc(myZone().short)}</span></div></div>`
              : `<div class="grid-2">${field('Barangay', `<select id="rp-brgy" data-change="rp-brgy">${ZONES.flatMap((zz) => zz.barangays).map((b) => `<option ${b === d.barangay ? 'selected' : ''}>${b}</option>`).join('')}</select>`, { id: 'rp-brgy', req: true })}
                 ${field('Street / landmark', `<input id="rp-locd" value="${esc(d.location === RESIDENT.address ? '' : d.location)}" data-input="rp-locd" placeholder="e.g. near Mercedes chapel"/>`, { id: 'rp-locd', req: true })}</div>${e.location ? `<div class="err" role="alert">${icon('alert', 14)} Enter a street or landmark.</div>` : ''}`
          }
          <div class="field"><span class="field-l">Map location</span><p class="field-h">Tap the map or drag the red pin to where the problem is. Use the buttons to zoom.</p>
            <div id="rp-map">${renderMap({ mode: 'picker', pin: d.pin, home: true })}</div>
            <div class="pin-info">${icon('pin', 15)} Pin is in <strong>${z ? esc(z.name) : 'outside the service area'}</strong></div>
          </div>
          <label class="chk ${e.confirmed ? 'chk--err' : ''}"><input type="checkbox" ${d.confirmed ? 'checked' : ''} data-change="rp-confirm"/> I confirm the pin and address show where the problem is. <span class="req">*</span></label>
          ${e.confirmed ? `<div class="err" role="alert">${icon('alert', 14)} Please confirm the location.</div>` : ''}
          ${e.zone ? `<div class="err" role="alert">${icon('alert', 14)} The pin must be inside the service area.</div>` : ''}
        </fieldset>
        <fieldset class="fs"><legend class="fs-l"><span class="fs-n">4</span>Photo <span class="opt">(optional)</span></legend>
          ${
            d.photo
              ? `<div class="photo-prev"><img src="${d.photo}" alt="Attached photo preview"/><button type="button" class="btn btn--ghost btn--sm" data-action="rp-photo-rm">${icon('x', 14)} Remove photo</button></div>`
              : `<label class="upload">${icon('camera', 22)}<span><strong>Add a photo</strong><em>JPG or PNG. Helps crews locate leaks and quality issues.</em></span><input type="file" accept="image/*" capture="environment" data-change="rp-photo" class="sr-only"/></label>`
          }
        </fieldset>
        <div class="note">${icon('info', 16)}<p>Your report becomes evidence for the provider's investigation. Reports are reviewed together with system readings — the number of reports alone does not decide priority.</p></div>
        <div class="form-a"><button type="button" class="btn btn--ghost" data-action="rp-cancel">Clear</button><button type="button" class="btn btn--primary btn--lg" data-action="rp-review">Review report ${icon('arrow', 16)}</button></div>
      </form></div>`;
  },
};

function submittedView(id) {
  const r = st().reports.find((x) => x.id === id);
  return `<div class="r-page r-page--narrow"><section class="done">
    <div class="done-ic">${icon('check-circle', 40)}</div>
    <h1>Report Submitted</h1>
    <div class="done-id"><span>Ticket number</span><strong class="mono">${r.id}</strong></div>
    <dl class="kv kv--2 done-kv"><div><dt>Status</dt><dd>${status('offline', 'Awaiting Provider Review')}</dd></div><div><dt>Problem</dt><dd>${esc(reportTypeLabel(r.type))}</dd></div><div><dt>Location</dt><dd>${esc(r.location)}</dd></div><div><dt>Submitted</dt><dd>${fmtDateTime(r.submittedAt)}</dd></div></dl>
    <div class="note">${icon('info', 16)}<p><strong>What happens next?</strong> The provider reviews your report together with pressure, flow, and equipment readings. Resident reports provide evidence for investigation but do not automatically determine incident priority. You will be notified at each step.</p></div>
    <div class="form-a form-a--c"><a class="btn btn--primary" href="#/r/reports/${r.id}" data-action="rp-done-track" data-id="${r.id}">Track this report</a><a class="btn btn--ghost" href="#/r/home" data-action="rp-done-home">Back to My Water Service</a></div>
  </section></div>`;
}

registerInputs({
  'rp-type': (el) => ((draft.type = el.value), (draft.errors.type = false), rerender()),
  'rp-desc': (el) => (draft.description = el.value),
  'rp-when': (el) => (draft.observedAt = el.value),
  'rp-loc': (el) => {
    draft.useHome = el.value === 'home';
    if (draft.useHome) (draft.location = RESIDENT.address), (draft.barangay = RESIDENT.barangay), (draft.pin = { x: RESIDENT.x, y: RESIDENT.y });
    else draft.location = '';
    draft.confirmed = false;
    rerender();
  },
  'rp-brgy': (el) => {
    draft.barangay = el.value;
    const z = ZONES.find((zz) => zz.barangays.includes(el.value));
    if (z && zoneAt(draft.pin)?.id !== z.id) draft.pin = { x: z.label[0], y: z.label[1] };
    draft.confirmed = false;
    rerender();
  },
  'rp-locd': (el) => (draft.location = el.value),
  'rp-confirm': (el) => ((draft.confirmed = el.checked), (draft.errors.confirmed = false)),
  'rp-photo': async (el) => {
    const f = el.files?.[0];
    if (!f) return;
    try {
      draft.photo = await readImage(f);
    } catch (e) {
      S.toast('Could not read that image', 'error');
    }
    rerender();
  },
});

function rerender() {
  const v = document.getElementById('view');
  if (v) {
    const y = window.scrollY;
    v.innerHTML = report.render();
    window.scrollTo(0, y);
  }
}

register({
  'quick-report': (el) => {
    draft = newDraft(el.dataset.type);
    lastSubmitted = null;
    go('#/r/report');
  },
  'map-pick': (el, e) => actions['map-pick-xy']({ dataset: svgPoint(el, e) }),
  'map-pick-xy': (el) => {
    if (!draft) return;
    const p = { x: +el.dataset.x, y: +el.dataset.y };
    draft.pin = p;
    draft.confirmed = false;
    if (draft.useHome && (Math.abs(p.x - RESIDENT.x) > 25 || Math.abs(p.y - RESIDENT.y) > 25)) {
      draft.useHome = false;
      const z = zoneAt(p);
      draft.barangay = z ? z.barangays[0] : draft.barangay;
      draft.location = '';
    }
    rerender();
  },
  'rp-photo-rm': () => ((draft.photo = null), rerender()),
  'rp-cancel': () => ((draft = newDraft()), rerender()),
  'rp-review': () => {
    const d = draft;
    const z = zoneAt(d.pin);
    d.errors = { type: !d.type, confirmed: !d.confirmed, location: !d.useHome && !d.location.trim(), zone: !z };
    if (Object.values(d.errors).some(Boolean)) {
      rerender();
      document.querySelector('.err')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const loc = d.useHome ? RESIDENT.address : `${d.location}, Brgy. ${d.barangay}`;
    openModal(
      'Review your report',
      `<dl class="kv">
        <div><dt>Problem</dt><dd><strong>${esc(reportTypeLabel(d.type))}</strong></dd></div>
        <div><dt>Description</dt><dd>${esc(d.description) || '<span class="muted">No description</span>'}</dd></div>
        <div><dt>Observed</dt><dd>${fmtDateTime(fromLocalInput(d.observedAt) || Date.now())}</dd></div>
        <div><dt>Location</dt><dd>${esc(loc)}<br/><span class="muted">${esc(z.name)}</span></dd></div>
        <div><dt>Photo</dt><dd>${d.photo ? 'Attached' : 'None'}</dd></div></dl>
        <div class="map-sm">${renderMap({ mode: 'picker', pin: d.pin, readonly: true })}</div>
        <p class="fine">Please confirm the location is correct before submitting. You can track the status of your report under My Reports.</p>`,
      { footer: `<button class="btn btn--ghost" data-action="ov-close">Edit report</button><button class="btn btn--primary" data-action="rp-submit">${icon('check', 16)} Submit report</button>` }
    );
  },
  'rp-submit': (el) => busy(el, async () => {
    const d = draft;
    const z = zoneAt(d.pin);
    const r = await S.submitReport({
      type: d.type,
      description: d.description,
      zone: z.id,
      barangay: d.useHome ? RESIDENT.barangay : d.barangay,
      location: d.useHome ? RESIDENT.address : `${d.location}, Brgy. ${d.barangay}`,
      x: d.pin.x,
      y: d.pin.y,
      observedAt: fromLocalInput(d.observedAt) || Date.now(),
      photo: d.photo,
    });
    closeOverlay();
    lastSubmitted = r.id;
    draft = null;
    go('#/r/report');
  }),
  'rp-done-track': (el) => ((lastSubmitted = null), go(`#/r/reports/${el.dataset.id}`)),
  'rp-done-home': () => ((lastSubmitted = null), go('#/r/home')),
  'rv-respond': (el) => {
    const restored = el.dataset.v === 'yes';
    if (restored) return S.residentVerify(el.dataset.id, true);
    openModal(
      'Problem still exists',
      `<p class="muted">Tell your provider what you are still experiencing. This helps verify whether service has actually recovered.</p>${field('Details', '<textarea id="rv-comment" rows="3" placeholder="e.g. Pressure is still very weak upstairs"></textarea>', { id: 'rv-comment', optional: true })}`,
      { footer: `<button class="btn btn--ghost" data-action="ov-close">Cancel</button><button class="btn btn--primary" data-action="rv-still" data-id="${el.dataset.id}">Send to provider</button>` }
    );
  },
  'rv-still': (el) => {
    const c = document.getElementById('rv-comment')?.value || '';
    closeOverlay();
    S.residentVerify(el.dataset.id, false, c);
  },
  'alt-select': (el) => {
    altSel = el.dataset.id;
    go('#/r/water-access');
    setTimeout(() => document.getElementById(`aw-${altSel}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  },
});

// ---------------------------------------------------------------- MY REPORTS
const reports = {
  title: 'My Reports',
  render() {
    const mine = st().reports.filter((r) => r.mine).sort((a, b) => b.submittedAt - a.submittedAt);
    return `<div class="r-page r-page--narrow">
      <div class="page-h"><div><h1>My Reports</h1><p class="page-sub">Track the progress of problems you reported.</p></div><div class="page-a"><a class="btn btn--primary btn--sm" href="#/r/report">${icon('plus', 15)} New report</a></div></div>
      ${
        mine.length
          ? `<div class="stack">${mine
              .map((r) => {
                const rs = residentReportStatus(r);
                const last = r.updates[r.updates.length - 1];
                return `<a class="rep-card" href="#/r/reports/${r.id}">
                  <div class="rep-row-h"><span class="mono">${r.id}</span>${status(rs.sev, rs.label)}</div>
                  <div class="rep-row-t">${esc(reportTypeLabel(r.type))} <span class="muted">· ${esc(r.location)}</span></div>
                  ${progressMini(r)}
                  <div class="rep-foot"><span>Submitted ${fmtDateTime(r.submittedAt)}</span><span>${last ? `Updated ${relTime(last.at)}` : ''}</span></div>
                </a>`;
              })
              .join('')}</div>`
          : empty('You have not submitted any reports', 'If you experience a water problem, report it so your provider can investigate.', 'clipboard', '<a class="btn btn--primary btn--sm" href="#/r/report">Report a Problem</a>')
      }</div>`;
  },
};

const reportDetail = {
  title: 'Track My Report',
  render({ id }) {
    const s = st();
    const r = s.reports.find((x) => x.id === id && x.mine);
    if (!r) return `<div class="r-page">${empty('Report not found', '', 'search', '<a class="btn btn--outline btn--sm" href="#/r/reports">Back to My Reports</a>')}</div>`;
    const rs = residentReportStatus(r);
    const idx = REPORT_STEPS.findIndex((x) => x.id === r.status);
    const stepAt = (sid) => r.updates.find((u) => u.status === sid)?.at || (sid === 'submitted' ? r.submittedAt : null);
    const items = REPORT_STEPS.map((x, i) => ({ label: x.label, at: i <= idx ? stepAt(x.id) : null, state: i < idx || (i === idx && x.id === 'verified') ? 'done' : i === idx ? 'current' : 'todo' }));
    // the current step is complete once reached; next step is "in progress"
    items.forEach((it, i) => {
      if (i <= idx) it.state = 'done';
      if (i === idx + 1) it.state = 'current';
    });
    const inc = s.incidents.find((i) => i.id === r.incidentId);
    const adv = inc && s.advisories.find((a) => inc.advisoryIds.includes(a.id));
    const wo = inc && s.workOrders.filter((w) => inc.workOrderIds.includes(w.id)).sort((a, b) => b.createdAt - a.createdAt)[0];
    const resolution = inc?.resolution || wo?.completion?.notes;
    const askVerify = r.status === 'repair_completed' && r.awaitingVerification && !r.residentResponse;
    return `<div class="r-page r-page--narrow">
      <a class="back" href="#/r/reports">${icon('chev-l', 16)} My Reports</a>
      <div class="page-h"><div><div class="mono muted">${r.id}</div><h1>${esc(reportTypeLabel(r.type))}</h1></div><div class="page-a">${status(rs.sev, rs.label, { lg: true })}</div></div>
      ${
        askVerify
          ? `<section class="verify" aria-labelledby="vq"><h2 id="vq">Has your water service returned?</h2><p>The provider reports that repairs are complete. Your answer helps verify whether service has actually recovered.</p>
        <div class="verify-a"><button class="btn btn--success btn--lg" data-action="rv-respond" data-v="yes" data-id="${r.id}">${icon('check-circle', 18)} Service Restored</button><button class="btn btn--outline btn--lg" data-action="rv-respond" data-v="no" data-id="${r.id}">${icon('alert', 18)} Problem Still Exists</button></div></section>`
          : ''
      }
      ${r.residentResponse ? alertBanner(r.residentResponse.restored ? 'normal' : 'warning', r.residentResponse.restored ? 'You confirmed service was restored' : 'You reported the problem still exists', r.residentResponse.restored ? `Thank you for verifying on ${fmtDateTime(r.residentResponse.at)}.` : 'Your provider has been notified and will follow up.') : ''}
      <div class="r-grid r-grid--detail">
        <div class="r-col">
          ${card('Progress', timeline(items))}
          ${card(
            'Provider updates',
            r.updates.length
              ? `<ul class="upd-list">${[...r.updates].reverse().map((u) => `<li><time>${fmtDateTime(u.at)}</time><p>${esc(u.text)}</p></li>`).join('')}</ul>`
              : empty('No updates yet', 'You will be notified when the provider reviews your report.', 'clock')
          )}
        </div>
        <div class="r-col">
          ${card(
            'Report details',
            `<dl class="kv">
            <div><dt>Ticket ID</dt><dd class="mono">${r.id}</dd></div>
            <div><dt>Problem type</dt><dd>${esc(reportTypeLabel(r.type))}</dd></div>
            <div><dt>Location</dt><dd>${esc(r.location)}<br/><span class="muted">${esc(zoneById(r.zone).name)}</span></dd></div>
            <div><dt>Observed</dt><dd>${fmtDateTime(r.observedAt)}</dd></div>
            <div><dt>Submitted</dt><dd>${fmtDateTime(r.submittedAt)}</dd></div>
            <div><dt>Current status</dt><dd>${status(rs.sev, rs.label)}</dd></div>
            ${r.description ? `<div><dt>Description</dt><dd>${esc(r.description)}</dd></div>` : ''}
            ${inc ? `<div><dt>Linked investigation</dt><dd class="mono">${inc.id}</dd></div>` : ''}
          </dl>${r.photo ? `<img class="rep-photo" src="${r.photo}" alt="Photo attached to report"/>` : ''}<div class="map-sm">${renderMap({ mode: 'picker', pin: { x: r.x, y: r.y }, readonly: true })}</div>`
          )}
          ${card('Related advisory', adv ? advisoryCard(adv, { compact: true }) : empty('No advisory linked yet', 'If the provider confirms a wider service issue, the advisory will appear here.', 'megaphone'))}
          ${resolution ? card('Resolution notes', `<p>${esc(resolution)}</p>${wo?.completion?.reading ? `<p class="muted sm">Verification reading: ${esc(wo.completion.reading)}</p>` : ''}`) : ''}
        </div>
      </div></div>`;
  },
};

// ---------------------------------------------------------------- ADVISORIES
const advisories = {
  title: 'Advisories',
  render() {
    const s = st();
    const active = s.advisories.filter((a) => a.status === 'Active');
    const mine = active.filter((a) => a.areas.includes(RESIDENT.zone));
    const other = active.filter((a) => !a.areas.includes(RESIDENT.zone));
    const past = s.advisories.filter((a) => a.status !== 'Active').slice(0, 6);
    return `<div class="r-page r-page--narrow">
      <div class="page-h"><div><h1>Service Advisories</h1><p class="page-sub">Official notices from ${esc(UTILITY.name)} (fictional).</p></div></div>
      <h2 class="sec-t">Your area — ${esc(myZone().name)}</h2>
      ${mine.length ? `<div class="stack">${mine.map((a) => advisoryCard(a)).join('')}</div>` : empty('No active advisories for your area', '', 'check-circle')}
      ${other.length ? `<h2 class="sec-t">Other areas</h2><div class="stack">${other.map((a) => advisoryCard(a, { compact: true })).join('')}</div>` : ''}
      ${past.length ? `<h2 class="sec-t">Recently resolved</h2><div class="stack">${past.map((a) => advisoryCard(a, { compact: true })).join('')}</div>` : ''}
    </div>`;
  },
};

// ---------------------------------------------------------------- CONSUMPTION
const consumption = {
  title: 'My Consumption',
  render() {
    const c = st().consumption;
    const cur = c.current;
    const prev = c.periods[c.periods.length - 1];
    const days = cur.daily.length;
    const periodDays = Math.round((cur.end - cur.start) / 864e5) + 1;
    const prevDays = Math.round((prev.end - prev.start) / 864e5) + 1;
    const avgCur = cur.toDate / days;
    const avgPrev = prev.m3 / prevDays;
    const diff = ((avgCur - avgPrev) / avgPrev) * 100;
    const projected = avgCur * periodDays;
    const bars = [
      ...c.periods.map((p) => ({ label: new Date(p.end).toLocaleDateString('en-US', { month: 'short' }), value: p.m3, hatch: p.source === 'ESTIMATED', color: '#1D6FB8', tip: `${fmtDateShort(p.start)} – ${fmtDateShort(p.end)} · ${p.source === 'ESTIMATED' ? 'ESTIMATED reading' : 'Measured reading'}${p.note ? '<br/>' + esc(p.note) : ''}` })),
      { label: 'Now', value: cur.toDate, color: '#13A8C4', tip: `Current period to date · Measured (last reading ${fmtDateTime(cur.lastReading)})` },
    ];
    const dailyChart = barChart({ id: 'daily-use', label: 'Daily water use this period', bars: cur.daily.map((v, i) => ({ label: fmtDateShort(cur.start + i * 864e5).split(' ')[1], value: +(v * 1000).toFixed(0), color: '#1D6FB8', tip: `${fmtDate(cur.start + i * 864e5)} · Measured` })), yFmt: (v) => `${v} L`, h: 190, labelEvery: 3 });
    return `<div class="r-page">
      <div class="page-h"><div><h1>My Consumption</h1><p class="page-sub">Account ${RESIDENT.account} · Meter ${RESIDENT.meter}</p></div></div>
      <div class="note note--plain">${icon('info', 16)}<p><strong>Measured</strong> values are actual meter readings. <strong>Estimated</strong> values are calculated when a meter could not be read — they are never presented as actual readings.</p></div>
      <div class="cons-grid">
        <div class="cons cons--main">
          <div class="cons-k">Current billing period · to date</div>
          <div class="cons-v">${fmt(cur.toDate, 1)} <span>m³</span></div>
          <div class="cons-s">${src('MEASURED')} Measured reading · ${fmtDateTime(cur.lastReading)}</div>
          <div class="cons-p">${fmtDateShort(cur.start)} – ${fmtDateShort(cur.end)} · day ${days} of ${periodDays}</div>
          ${gaugeBar((days / periodDays) * 100)}
          <div class="cons-proj">Projected period total: <strong>${fmt(projected, 1)} m³</strong> ${src('ESTIMATED')}</div>
        </div>
        <div class="cons"><div class="cons-k">Previous billing period</div><div class="cons-v cons-v--sm">${fmt(prev.m3, 1)} <span>m³</span></div><div class="cons-s">${src(prev.source)} ${prev.source === 'MEASURED' ? 'Measured reading' : 'Estimated reading'}</div><div class="cons-p">${fmtDateShort(prev.start)} – ${fmtDateShort(prev.end)}</div></div>
        <div class="cons"><div class="cons-k">Change in daily use</div><div class="cons-v cons-v--sm ${diff > 0 ? 'up' : 'down'}">${icon(diff > 0 ? 'arrow-up' : 'arrow-down', 18)} ${fmt(Math.abs(diff), 1)}<span>%</span></div><div class="cons-s">${diff > 0 ? 'Higher' : 'Lower'} than previous period (per-day average)</div></div>
        <div class="cons"><div class="cons-k">Average daily usage</div><div class="cons-v cons-v--sm">${fmt(avgCur * 1000, 0)} <span>L/day</span></div><div class="cons-s">Previous: ${fmt(avgPrev * 1000, 0)} L/day</div></div>
      </div>
      <div class="r-grid">
        <div class="r-col">${card('Historical consumption', barChart({ id: 'cons-hist', label: 'Monthly consumption, cubic meters', bars, yFmt: (v) => `${fmt(v, v < 10 && v % 1 ? 1 : 0)}`, h: 220, legendHtml: `<div class="ch-legend"><span><i style="background:#1D6FB8"></i>Measured</span><span><i class="hatch-sw"></i>Estimated</span><span><i style="background:#13A8C4"></i>Current period (to date)</span></div>` }), { sub: 'Cubic meters (m³) per billing period' })}</div>
        <div class="r-col">${card('Daily use this period', dailyChart, { sub: 'Liters per day · measured meter reads' })}</div>
      </div>
      ${card(
        'Billing period readings',
        `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Period</th><th class="num">Consumption</th><th>Reading type</th><th>Note</th></tr></thead><tbody>
        <tr><td>${fmtDateShort(cur.start)} – ${fmtDateShort(cur.end)} <span class="muted">(in progress)</span></td><td class="num">${fmt(cur.toDate, 1)} m³ to date</td><td>${src('MEASURED')}</td><td class="muted">Projected ${fmt(projected, 1)} m³ (estimate)</td></tr>
        ${[...c.periods].reverse().map((p) => `<tr><td>${fmtDateShort(p.start)} – ${fmtDateShort(p.end)}</td><td class="num">${fmt(p.m3, 1)} m³</td><td>${src(p.source)}</td><td class="muted">${esc(p.note)}</td></tr>`).join('')}
        </tbody></table></div>`
      )}
    </div>`;
  },
};

// ---------------------------------------------------------------- WATER OUTLOOK
const outlook = {
  title: 'Water Outlook',
  regions: {
    body() {
      const fc = S.forecast({ hours: 72 });
      const o = OUTLOOK[fc.status];
      const pts = fc.pts.filter((p) => p.h <= 48);
      const chart = lineChart({
        id: 'r-outlook',
        label: 'Forecast system storage, next 48 hours',
        series: [{ name: 'Forecast storage', color: '#1D6FB8', values: pts.map((p) => p.pct * 100), area: true, dash: true }],
        labels: pts.map((p) => `+${p.h} h`),
        xTicks: [0, 12, 24, 36, 48].map((h) => ({ i: pts.findIndex((p) => p.h >= h), label: h ? `+${h} h` : 'Now' })),
        thresholds: [{ y: 30, label: 'Minimum reserve', color: '#C0262D' }],
        yMin: 0,
        yMax: 100,
        yFmt: (v) => `${Math.round(v)}%`,
        h: 220,
      });
      return `<section class="card"><div class="card-b">
        <div class="ol-h"><div><div class="ol-k">Next 24 Hours</div><div class="ol-s">${status(o.sev, o.label, { lg: true })}</div></div>${src('FORECAST')}</div>
        <p class="ol-t">${o.text}</p>${outlookStrip(fc)}</div></section>
        ${card('System storage outlook', chart, { sub: 'Shared supply for all zones · projection, not a guarantee' })}
        ${card(
          'What this means for you',
          fc.status === 'stable' || fc.status === 'watch'
            ? `<ul class="bul"><li>No supply interruptions are expected from storage levels.</li><li>Local problems (like line repairs) may still affect your area — check advisories.</li><li>Use water wisely during peak hours (6–8 AM and 6–8 PM).</li></ul>`
            : `<ul class="bul"><li>Store enough water for drinking and cooking for 1 day.</li><li>Avoid non-essential use (washing vehicles, watering plants).</li><li>Check <a href="#/r/water-access">Alternative Water Access</a> for confirmed distribution points.</li></ul>`
        )}
        <p class="fine">Based on current storage, production, and estimated demand. Forecasts are estimates and may change as conditions change. ${relTime(S.getState().tele.lastUpdate) ? '' : ''}</p>`;
    },
  },
  render() {
    return `<div class="r-page r-page--narrow"><div class="page-h"><div><h1>Water Availability Outlook</h1><p class="page-sub">How much water the system expects to have available.</p></div></div><div data-region="body">${this.regions.body()}</div></div>`;
  },
};

// ---------------------------------------------------------------- ALTERNATIVE WATER ACCESS
let altSel = null;
const TANK_FOR = { 'AW-1': 'ET-01', 'AW-2': 'ET-02', 'AW-3': 'ET-03' };
const waterAccess = {
  title: 'Alternative Water Access',
  regions: {
    list() {
      const s = st();
      const pts = s.altWater.filter((p) => p.active && p.confirmedAt).sort((a, b) => (b.zone === RESIDENT.zone) - (a.zone === RESIDENT.zone));
      return pts
        .map((p) => {
          const tank = s.emergencyTanks.find((t) => t.id === TANK_FOR[p.id]);
          return `<article class="aw ${altSel === p.id ? 'is-sel' : ''}" id="aw-${p.id}">
          <div class="aw-h"><h3>${esc(p.name)}</h3>${altStatus(p.status)}</div>
          <div class="aw-addr">${icon('pin', 14)} ${esc(p.address)} ${p.zone === RESIDENT.zone ? '<span class="pill pill--blue">Your area</span>' : ''}</div>
          <dl class="kv kv--2"><div><dt>Hours</dt><dd>${esc(p.hours)}</dd></div><div><dt>Last confirmed</dt><dd>${fmtTime(p.confirmedAt)} <span class="muted">(${relTime(p.confirmedAt)})</span></dd></div>
          ${tank ? `<div><dt>Water on site</dt><dd>${fmt(tank.volumeL)} L ${src(tank.mode === 'SIMULATED' ? 'SIMULATED' : 'MANUAL')}<br/><span class="muted sm">Updated ${relTime(tank.updatedAt)}</span></dd></div>` : ''}</dl>
          <p class="aw-ins">${icon('info', 14)} ${esc(p.instructions)}</p></article>`;
        })
        .join('');
    },
  },
  render() {
    const s = st();
    const svc = S.residentService(s);
    const disrupted = svc.sev !== 'normal';
    return `<div class="r-page">
      <div class="page-h"><div><h1>Alternative Water Access</h1><p class="page-sub">Provider-confirmed water distribution points during service disruptions.</p></div></div>
      ${disrupted ? alertBanner('warning', `Service in your area: ${svc.label}`, 'The following distribution points have been confirmed by your water provider.') : alertBanner('info', 'No disruption in your area right now', 'Points below are on standby. Only provider-confirmed information is shown.')}
      <div class="aw-layout"><div class="aw-map">${renderMap({ mode: 'resident', alt: true, selected: altSel, focusZone: RESIDENT.zone })}<div class="map-legend"><span><i class="lg-dot" style="background:#1F8A4C"></i>Available</span><span><i class="lg-dot" style="background:#D97706"></i>Limited / scheduled</span><span><i class="lg-dot" style="background:#1D6FB8"></i>Your address</span></div></div>
      <div class="aw-list" data-region="list">${this.regions.list()}</div></div>
      <p class="fine">Bring clean, covered containers. Information is only displayed after confirmation by the provider; times show when each point was last confirmed.</p>
    </div>`;
  },
};

// ---------------------------------------------------------------- PROFILE
const profile = {
  title: 'Profile',
  render() {
    return `<div class="r-page r-page--narrow">
      <div class="page-h"><div><h1>Profile</h1></div></div>
      <section class="card"><div class="card-b prof">
        <span class="avatar avatar--lg">${RESIDENT.initials}</span>
        <div><h2>${esc(RESIDENT.name)}</h2><p class="muted">${esc(RESIDENT.email || RESIDENT.address)}</p></div>
        ${RESIDENT.email ? `<button class="btn btn--outline btn--sm prof-edit" data-action="profile-edit">${icon('user', 15)} Edit profile</button>` : ''}
      </div></section>
      ${card(
        'Water service account',
        `<dl class="kv"><div><dt>Account number</dt><dd class="mono">${RESIDENT.account}</dd></div><div><dt>Meter number</dt><dd class="mono">${RESIDENT.meter}</dd></div><div><dt>Service address</dt><dd>${esc(RESIDENT.address)}</dd></div><div><dt>Service zone</dt><dd>${esc(myZone().name)}</dd></div><div><dt>Mobile number</dt><dd>${esc(RESIDENT.phone)}</dd></div><div><dt>Water provider</dt><dd>Maqueda Bay Water Service (fictional)</dd></div></dl>
        ${RESIDENT.email ? '<p class="fine">Account and meter numbers are placeholders in this prototype.</p>' : ''}`
      )}
      ${card(
        'Notification preferences',
        `<div class="stack-sm">${[
          ['New and updated advisories for my area', true],
          ['Updates on my reports', true],
          ['Emergency water availability', true],
          ['Water outlook warnings', true],
          ['Billing reading posted', false],
        ]
          .map(([l, on]) => `<label class="switch"><input type="checkbox" ${on ? 'checked' : ''}/><span class="switch-t" aria-hidden="true"></span>${l}</label>`)
          .join('')}</div>
        ${field('Preferred language', '<select id="pf-lang"><option>English</option><option>Waray-Waray</option><option>Filipino</option></select>', { id: 'pf-lang' })}`
      )}
      <div class="form-a">${canSwitchRole() ? `<button class="btn btn--outline" data-action="switch-role">${icon('activity', 16)} Switch to provider view</button>` : ''}<button class="btn btn--ghost" data-action="logout">${icon('logout', 16)} Sign out</button></div>
    </div>`;
  },
};

const notifications = { title: 'Notifications', render: () => `<div class="r-page r-page--narrow">${notificationsView('resident')}</div>` };

export const residentViews = {
  home,
  advisories,
  report,
  reports,
  'reports/:id': reportDetail,
  consumption,
  outlook,
  'water-access': waterAccess,
  notifications,
  profile,
};
