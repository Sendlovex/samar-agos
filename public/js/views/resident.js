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
  stable: { sev: 'normal', label: 'Enough water', text: 'There should be enough water for your area over the next day.' },
  watch: { sev: 'info', label: 'Enough water for now', text: 'There should be enough water. Your water provider is keeping a close eye on supply.' },
  risk: { sev: 'warning', label: 'Water may run low', text: 'Water may run low within the next day. Consider storing some for drinking and cooking.' },
  critical: { sev: 'critical', label: 'Water likely to run low', text: 'Water may run low within a few hours. Store water now for drinking and cooking.' },
};

function outlookStrip(fc) {
  const segs = [
    ['Now', fc.now],
    ['In 6 hrs', fc.at6],
    ['In 12 hrs', fc.at12],
    ['Tomorrow', fc.at24],
  ];
  const lv = (p) => (p < 0.3 ? ['critical', 'Low'] : p < 0.42 ? ['warning', 'Limited'] : p < 0.5 ? ['info', 'Enough'] : ['normal', 'Plenty']);
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
// Written for residents, not engineers: answer "Do I have water?", "What should I do?" and
// "How do I get help?" in everyday words. Same cards and tokens as the operator portal.
const brgyName = (b) => (/^barangay\b/i.test(b) ? b : `Barangay ${b}`);
const titleCase = (t) => t.charAt(0) + t.slice(1).toLowerCase();

// Plain-language headline for each service state the provider can publish.
const FRIENDLY = {
  'NORMAL SERVICE': ['Your water is working normally', 'No problems have been reported in your area.'],
  'SERVICE RESTORED': ['Your water is back', 'The problem in your area has been fixed.'],
  'REDUCED PRESSURE': ['Water pressure is low in your area', 'Water may come out weakly, especially upstairs.'],
  'NO WATER': ['No water in your area right now', 'Your water provider is working to bring it back.'],
  'INTERMITTENT SUPPLY': ['Water is on and off in your area', 'You may have water only at certain times.'],
  'QUALITY ADVISORY': ['Take care before drinking tap water', 'Please follow the advice from your water provider below.'],
  'SCHEDULED MAINTENANCE': ['Planned repair work in your area', 'Water may be off for a while during the work.'],
  'SUPPLY WARNING': ['Water may run low soon', 'Your water provider is asking residents to use water wisely.'],
  'UNDER INVESTIGATION': ["We're checking a problem in your area", "We'll post an update once we know more."],
  'REPORTS UNDER REVIEW': ['Neighbors reported a water problem', 'Your water provider is looking into it.'],
};

// Simple 4-step tracker shown while a problem is being handled.
const FIX_STEPS = ['Problem reported', 'Being checked', 'Repair underway', 'Water restored'];
function fixStep(svc) {
  if (svc.restored) return 3;
  const inc = svc.incident;
  if (!inc) return svc.label === 'REPORTS UNDER REVIEW' ? 0 : -1;
  return { Investigating: 1, 'Response in Progress': 2, Monitoring: 2, Resolved: 3 }[inc.status] ?? 1;
}

function homeStatus() {
  const s = st();
  const svc = S.residentService(s);
  // Water service only (is water flowing?). Drinking-water safety has its own banner and card.
  const [headline, fallback] = FRIENDLY[svc.label] || [titleCase(svc.label), ''];
  const cls = SEV[svc.sev].cls;
  const fromProvider = svc.advisory && !svc.restored;
  const step = fixStep(svc);
  let when = '';
  if (fromProvider && svc.etr) when = `<div class="rsvc-when">${icon('clock', 18)}<div><span>Water expected back by</span><strong>${fmtTime(svc.etr)}</strong><em>This is an estimate and may change.</em></div></div>`;
  else if (fromProvider && svc.nextUpdate) when = `<div class="rsvc-when">${icon('clock', 18)}<div><span>Next update by</span><strong>${fmtTime(svc.nextUpdate)}</strong><em>We don't know yet when water will be back.</em></div></div>`;
  return `<section class="rsvc rsvc--${cls}" aria-labelledby="rsvc-title">
    <div class="rsvc-main">
      <div class="rsvc-txt">
        <span class="rsvc-k">Your water service</span>
        <h2 id="rsvc-title" class="rsvc-h">${esc(headline)}</h2>
        <p class="rsvc-p">${esc(fromProvider ? svc.message : fallback || svc.message)}</p>
        ${fromProvider ? `<p class="rsvc-by">${icon('megaphone', 14)} Message from ${esc(UTILITY.name)}</p>` : ''}
      </div>
    </div>
    ${when}
    ${step >= 0 ? `<ol class="rsvc-steps" aria-label="Repair progress: ${esc(FIX_STEPS[step])}">${FIX_STEPS.map((t, i) => `<li class="${i < step ? 'is-done' : i === step ? 'is-now' : ''}"><span class="rsvc-dot">${i < step || (i === step && step === 3) ? icon('check', 12) : ''}</span><span>${t}</span></li>`).join('')}</ol>` : ''}
    <div class="rsvc-upd">${icon('refresh', 13)} Checked ${updatedAgo(svc.updatedAt)}</div>
  </section>`;
}

// "What you can do" — short, concrete tips for the current situation.
function homeTips() {
  const s = st();
  const svc = S.residentService(s);
  const out = S.forecast({ hours: 24 }).status;
  const alt = s.altWater.filter((p) => p.active && p.zone === RESIDENT.zone && p.status !== 'CLOSED');
  const tips = [];
  const problem = svc.sev !== 'normal' && !svc.restored;
  if (S.waterSafety(s).verdict === 'unsafe') tips.push('<strong>Do not drink tap water.</strong> Boil it for at least 1 minute, or use bottled water, for drinking, cooking and brushing teeth.');
  else if (svc.label === 'QUALITY ADVISORY') tips.push('Use boiled or bottled water for drinking and cooking until the advisory ends.');
  else if (problem) tips.push('Save stored water for drinking, cooking and washing hands.');
  if (svc.label === 'NO WATER' || svc.label === 'INTERMITTENT SUPPLY') tips.push('Keep faucets closed so water doesn\'t run when it comes back.');
  if (svc.advisory?.instructions && !svc.restored) tips.push(esc(svc.advisory.instructions));
  if (problem && alt.length) tips.push(`Get water at <a href="#/r/water-access">${esc(alt[0].name)}</a> (${esc(alt[0].hours)}).`);
  if (!problem && (out === 'risk' || out === 'critical')) tips.push('Water may be limited later today. Store some water now for essential needs.');
  if (svc.restored) tips.push('Let the water run for a minute before using it.', 'Still no water? <a href="#/r/reports">Tell us in My Reports</a>.');
  if (!tips.length) tips.push("Nothing to do right now. We'll notify you if anything changes.");
  if (!problem) tips.push('Notice a problem? <a href="#/r/report">Report it</a>. It only takes a minute.');
  return card('What you can do', `<ul class="tips">${tips.map((t) => `<li>${t}</li>`).join('')}</ul>`);
}

// ---------------------------------------------------------------- WATER SAFETY
// The provider's Water Safety verdict in everyday words. Readings come from the monitoring
// points before water reaches every zone, plus lab tests for germs.
const SAFE_WORDS = {
  safe: ['Yes, safe to drink', 'Tap water meets drinking-water standards. It is checked before it reaches your area.'],
  caution: ['Yes, but being watched', 'Water still meets health limits. One reading is slightly off, so your water provider is keeping an eye on it.'],
  unsafe: ['No, do not drink tap water', 'Tests found a problem with the water. Use boiled or bottled water until your provider says it is safe again.'],
};
const SAFE_SEV = { safe: 'normal', caution: 'warning', unsafe: 'critical' };
const SAFE_CHECKS = [
  { label: 'Clear, not cloudy', keys: ['turb'], why: 'Cloudy water can hide germs from the disinfectant.' },
  { label: 'Enough disinfectant', keys: ['cl'], why: 'A small amount of chlorine keeps water clean all the way to your tap.' },
  { label: 'Balanced (not acidic)', keys: ['ph'], why: 'Water that is too acidic or too alkaline can damage pipes and weaken the disinfectant.' },
  { label: 'Low in dissolved minerals', keys: ['tds'], why: 'Too many dissolved minerals can affect taste and may be a sign of pollution.' },
  { label: 'No harmful germs', keys: ['ecoli', 'coliform'], why: 'A laboratory tests water samples for bacteria that can cause stomach illness.' },
];
// Plain names for the provider's monitoring points, in the order water flows.
const SAFE_POINTS = { 'WQ-1': 'At the treatment plant', 'WQ-2': 'Leaving the main reservoir', 'WQ-3': 'Before it reaches your area' };

const safeVerdict = (ws) => {
  const [title, text] = SAFE_WORDS[ws.verdict];
  return `<p class="safe-v"><span class="sys-dot sys-dot--${SEV[SAFE_SEV[ws.verdict]].cls}" aria-hidden="true"></span>${title}</p><p class="ol-t">${text}</p>`;
};
const passMark = (ok) => `<em class="${ok ? '' : 'is-bad'}">${ok ? 'Passed' : 'Problem found'}</em>`;

// Shown under the service card only when tests say the water is not safe to drink.
function homeSafetyAlert() {
  if (S.waterSafety(st()).verdict !== 'unsafe') return '';
  return alertBanner(
    'critical',
    'Do not drink tap water right now',
    'Water tests found a problem. Tap water is fine for flushing and cleaning, but boil it for at least 1 minute or use bottled water for drinking and cooking.',
    `<a class="btn btn--sm btn--outline" href="#/r/water-safety">See test results</a>`
  );
}

// Home: summary only — the details live on the Water Safety page.
function homeSafety() {
  const ws = S.waterSafety(st());
  return card('Is your water safe to drink?', `${safeVerdict(ws)}<p class="fine">Checked all day by sensors. Last lab test for germs: ${relTime(ws.labAt)}.</p>`, {
    sub: 'Checked automatically, every few minutes',
    actions: `<a class="link" href="#/r/water-safety">See details ${icon('chev-r', 14)}</a>`,
  });
}

function safetyMain() {
  const ws = S.waterSafety(st());
  const all = [...ws.stations.flatMap((x) => x.params), ...ws.lab];
  const checks = SAFE_CHECKS.map((c) => {
    const ok = all.filter((p) => c.keys.includes(p.key)).every((p) => p.sev === 'normal');
    return `<li><span class="sys-dot sys-dot--${ok ? 'ok' : 'crit'}" aria-hidden="true"></span><span><strong>${c.label}</strong><small>${c.why}</small></span>${passMark(ok)}</li>`;
  }).join('');
  const points = ws.stations.map((x) => `<li><span class="sys-dot sys-dot--${x.sev === 'normal' ? 'ok' : 'crit'}" aria-hidden="true"></span><span><strong>${SAFE_POINTS[x.id] || esc(x.name)}</strong></span>${passMark(x.sev === 'normal')}</li>`).join('');
  const labOk = ws.lab.every((p) => p.sev === 'normal');
  const unsafe = ws.verdict === 'unsafe';
  return `${card('Is your water safe to drink?', `${safeVerdict(ws)}<p class="fine">Sensors check the water every few minutes. Last lab test for germs: ${relTime(ws.labAt)}.</p>`, { cls: `safe-hero safe-hero--${SEV[SAFE_SEV[ws.verdict]].cls}` })}
    <div class="r-grid">
      <div>${card('What we test for', `<ul class="safe-list safe-list--why">${checks}</ul>`, { sub: 'Based on the Philippine drinking-water standards' })}</div>
      <div class="r-col">
        ${card('Where we check', `<ul class="safe-list">${points}<li><span class="sys-dot sys-dot--${labOk ? 'ok' : 'crit'}" aria-hidden="true"></span><span><strong>Laboratory germ test</strong></span>${passMark(labOk)}</li></ul>`, { sub: 'Water is tested on its way to your home' })}
        ${card(
          unsafe ? 'What to do now' : 'If water is ever unsafe',
          `<ul class="tips">
            <li>Boil water for at least 1 minute, or use bottled water, for drinking, cooking, making ice and brushing teeth.</li>
            <li>Tap water is still fine for flushing toilets, cleaning and washing clothes.</li>
            <li>We will tell you here and send a notification as soon as water is safe again.</li>
            <li>Water looks dirty or smells strange? <a href="#/r/report">Report it</a>.</li>
          </ul>`
        )}
      </div>
    </div>`;
}

const waterSafetyPage = {
  title: 'Water Safety',
  regions: { main: safetyMain },
  render() {
    return `<div class="r-page">
      <div class="page-h"><div><h1>Water Safety</h1><p class="page-sub">Is your tap water safe to drink? Here is what the tests show.</p></div></div>
      <div data-region="main">${safetyMain()}</div>
    </div>`;
  },
};

function homeOutlook() {
  const fc = S.forecast({ hours: 24 });
  const o = OUTLOOK[fc.status];
  return card(
    'Next 24 hours',
    `<p class="ol-big">${status(o.sev, o.label, { lg: true })}</p>
     <p class="ol-t">${o.text}</p>${outlookStrip(fc)}
     <p class="fine">This is a forecast and may change. <a href="#/r/outlook">See more</a></p>`,
    { cls: 'card--outlook', sub: 'Will there be enough water?' }
  );
}

function homeLatest() {
  const s = st();
  const r = s.reports.filter((x) => x.mine).sort((a, b) => b.submittedAt - a.submittedAt)[0];
  if (!r) return '';
  const rs = residentReportStatus(r);
  const last = r.updates[r.updates.length - 1];
  return card(
    'Your latest report',
    `<a class="rep-row" href="#/r/reports/${r.id}">
      <div class="rep-row-h"><strong>${esc(reportTypeLabel(r.type))}</strong>${status(rs.sev, rs.label)}</div>
      ${progressMini(r)}
      ${last ? `<p class="rep-row-u">${esc(last.text)} <span class="muted">· ${relTime(last.at)}</span></p>` : ''}
      ${rs.label === 'Awaiting Your Confirmation' ? `<div class="banner banner--info sm">${icon('info', 16)}<div class="banner-c"><strong>Is your water back?</strong> Tap here to tell us.</div></div>` : ''}
    </a>`,
    { actions: `<a class="link" href="#/r/reports">All my reports ${icon('chev-r', 14)}</a>` }
  );
}

const home = {
  title: 'My Water Service',
  regions: { status: homeStatus, safetyAlert: homeSafetyAlert, safety: homeSafety, tips: homeTips, outlook: homeOutlook },
  render() {
    const s = st();
    const adv = s.advisories.filter((a) => a.status === 'Active' && a.areas.includes(RESIDENT.zone));
    const h = new Date().getHours();
    const hello = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    return `<div class="r-page">
      <div class="page-h"><div><h1>${hello}, ${esc(RESIDENT.name.split(' ')[0])}</h1><p class="page-sub">${icon('pin', 14)} Water service for ${esc(brgyName(RESIDENT.barangay))}</p></div></div>
      <div data-region="status">${homeStatus()}</div>
      <div class="r-alert" data-region="safetyAlert">${homeSafetyAlert()}</div>
      <div class="r-grid">
        <div data-region="safety">${homeSafety()}</div>
        <div data-region="outlook">${homeOutlook()}</div>
      </div>
      <div class="r-row" data-region="tips">${homeTips()}</div>
      ${card(
        'Having a water problem?',
        `<div class="qa">${[
          ['no_water', 'No water', 'droplet-off'],
          ['low_pressure', 'Weak water flow', 'gauge'],
          ['leak', 'Leaking pipe', 'droplets'],
          ['color', 'Dirty or smelly water', 'flask'],
          ['other', 'Something else', 'more'],
        ]
          .map(([id, l, ic]) => `<button class="qa-b" data-action="quick-report" data-type="${id}"><span class="qa-ic">${icon(ic, 20)}</span><span>${l}</span></button>`)
          .join('')}</div>`,
        { sub: 'Tap what you see. We\'ll guide you through the rest.', cls: 'card--qa' }
      )}
      ${adv.length ? card(adv.length > 1 ? 'Notices for your area' : 'Notice for your area', adv.map((a) => advisoryCard(a)).join(''), { actions: `<a class="link" href="#/r/advisories">All notices ${icon('chev-r', 14)}</a>` }) : ''}
      ${homeLatest()}
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
  'water-safety': waterSafetyPage,
  notifications,
  profile,
};
