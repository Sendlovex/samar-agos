// Resident portal views — mobile-first.
import * as S from '../store.js';
import { RESIDENT, REPORT_TYPES, REPORT_STEPS, ZONES, zoneById, reportTypeLabel, UTILITY, WATER_RATES, waterBill, CWD_FACTS } from '../data.js';
import { icon, status, src, card, kpi, tabs, alertBanner, timeline, empty, register, registerInputs, openModal, closeOverlay, field, updatedAgo, SEV, actions, busy } from '../ui.js';
import { lineChart, barChart, gaugeBar } from '../charts.js';
import { renderMap, svgPoint } from '../map.js';
import { syncMaps } from '../livemap.js';
import { esc, fmt, fmtTime, fmtDate, fmtDateShort, fmtDateTime, relTime, toLocalInput, fromLocalInput, readImage, pointInPolygon, parsePoly, hoursLabel } from '../util.js';
import { notificationsView, go, canSwitchRole } from '../app.js';
import { weatherState, dayImpacts, describe as describeWx, wIcon } from '../weather.js';

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

// Advisory notices in everyday words (shared by Home, Advisories and report pages).
const ADV_LABEL = {
  'REDUCED PRESSURE': 'Low water pressure',
  'NO WATER': 'No water',
  'INTERMITTENT SUPPLY': 'Water on and off',
  'QUALITY ADVISORY': 'Water quality notice',
  'SCHEDULED MAINTENANCE': 'Planned maintenance',
  'SUPPLY WARNING': 'Water may run low',
};
const advSev = (a) => (a.status === 'Resolved' ? 'normal' : a.kind === 'Water Quality' ? 'info' : a.serviceStatus === 'NO WATER' ? 'critical' : 'warning');
const advLabel = (a) => (a.status === 'Resolved' ? 'Resolved' : ADV_LABEL[a.serviceStatus] || titleCase(a.serviceStatus || 'Notice'));
const advWhere = (a) => `${esc(a.barangays.join(', '))} <span class="muted">(${a.areas.map((z) => esc(zoneById(z).short)).join(', ')})</span>`;

function advisoryCard(a, { compact = false } = {}) {
  const sev = advSev(a);
  const done = a.status === 'Resolved';
  const inArea = a.areas.includes(RESIDENT.zone);
  const when = done
    ? `<div><dt>Resolved</dt><dd>${fmtDateTime(a.updatedAt)}</dd></div>`
    : a.etr
      ? `<div><dt>Expected back by</dt><dd><strong>${fmtTime(a.etr)}</strong> <span class="muted">(estimate)</span></dd></div>`
      : a.nextUpdate
        ? `<div><dt>Next update by</dt><dd><strong>${fmtTime(a.nextUpdate)}</strong></dd></div>`
        : '';
  return `<article class="adv radv radv--${SEV[sev].cls} ${done ? 'adv--done' : ''} ${compact ? 'radv--compact' : ''}">
    <div class="radv-top"><span class="radv-k"><span class="sys-dot sys-dot--${SEV[sev].cls}" aria-hidden="true"></span>${esc(advLabel(a))}</span>${inArea && !done ? '<span class="pill pill--blue">Your area</span>' : ''}</div>
    <h3 class="radv-t">${esc(a.title)}</h3>
    <p class="radv-msg">${esc(a.message)}</p>
    <dl class="radv-meta">
      <div><dt>Where</dt><dd>${advWhere(a)}</dd></div>
      ${when}
      ${done ? '' : `<div><dt>Last updated</dt><dd>${relTime(a.updatedAt)}</dd></div>`}
    </dl>
    ${a.instructions && !compact && !done ? `<div class="radv-do"><strong>What you should do</strong><p>${esc(a.instructions)}</p></div>` : ''}
  </article>`;
}

// ---------------------------------------------------------------- HOME
// Written for residents, not engineers: answer "Do I have water?", "What should I do?" and
// "How do I get help?" in everyday words. Same cards and tokens as the operator portal.
const brgyName = (b) => (/^barangay\b/i.test(b) ? b : `Barangay ${b}`);
const titleCase = (t) => t.charAt(0) + t.slice(1).toLowerCase();

// Plain-language headline for each service state the provider can publish.
const FRIENDLY = {
  'NORMAL SERVICE': ['Your water is working normally', 'No problems have been reported in your area.', 'Normal'],
  'SERVICE RESTORED': ['Your water is back', 'The problem in your area has been fixed.', 'Restored'],
  'REDUCED PRESSURE': ['Water pressure is low in your area', 'Water may come out weakly, especially upstairs.', 'Low pressure'],
  'NO WATER': ['No water in your area right now', 'Your water provider is working to bring it back.', 'No water'],
  'INTERMITTENT SUPPLY': ['Water is on and off in your area', 'You may have water only at certain times.', 'On and off'],
  'QUALITY ADVISORY': ['Take care before drinking tap water', 'Please follow the advice from your water provider below.', 'Quality notice'],
  'SCHEDULED MAINTENANCE': ['Planned repair work in your area', 'Water may be off for a while during the work.', 'Maintenance'],
  'SUPPLY WARNING': ['Water may run low soon', 'Your water provider is asking residents to use water wisely.', 'May run low'],
  'UNDER INVESTIGATION': ["We're checking a problem in your area", "We'll post an update once we know more.", 'Being checked'],
  'REPORTS UNDER REVIEW': ['Neighbors reported a water problem', 'Your water provider is looking into it.', 'Under review'],
};

// Simple 4-step tracker shown while a problem is being handled.
const FIX_STEPS = ['Problem reported', 'Being checked', 'Repair underway', 'Water restored'];
function fixStep(svc) {
  if (svc.restored) return 3;
  const inc = svc.incident;
  if (!inc) return svc.label === 'REPORTS UNDER REVIEW' ? 0 : -1;
  return { Investigating: 1, 'Response in Progress': 2, Monitoring: 2, Resolved: 3 }[inc.status] ?? 1;
}

// Primary KPI tile: the resident's water service, laid out like the operator's storage tile.
function homeStatus() {
  const s = st();
  const svc = S.residentService(s);
  // Water service only (is water flowing?). Drinking-water safety has its own banner, tile and page.
  const [headline, fallback, short] = FRIENDLY[svc.label] || [titleCase(svc.label), '', titleCase(svc.label)];
  const sev = svc.sev;
  const fromProvider = svc.advisory && !svc.restored;
  const problem = sev !== 'normal' && !svc.restored;
  const step = fixStep(svc);
  const repair = step >= 0 ? FIX_STEPS[step] : problem ? 'Not started' : 'None needed';
  const back = fromProvider && svc.etr ? `${fmtTime(svc.etr)} <span class="muted">(estimate)</span>` : problem ? 'Not yet known' : '—';
  const flag = svc.restored ? ['ok', 'Back to normal'] : !problem ? ['ok', 'No action needed'] : sev === 'critical' ? ['crit', 'Water affected'] : ['warn', 'Being fixed'];
  const foot = fromProvider ? `${icon('megaphone', 14)} Message from ${esc(UTILITY.name)}` : "We'll notify you if anything changes";
  return `<section class="kp-primary rkp" aria-labelledby="rkp-t">
    <div class="kpi-top"><span class="kpi-label">Your water service</span><span class="rkp-area">${esc(brgyName(RESIDENT.barangay))}</span></div>
    <div class="rkp-v" id="rkp-t"><span class="sys-dot sys-dot--${SEV[sev].cls}" aria-hidden="true"></span><strong>${esc(short)}</strong></div>
    <p class="rkp-h">${esc(headline)}</p>
    <p class="rkp-p">${esc(fromProvider ? svc.message : fallback || svc.message)}</p>
    <dl class="kp-meta">
      <div><dt>Repair</dt><dd>${repair}</dd></div>
      <div><dt>Expected back</dt><dd>${back}</dd></div>
      <div><dt>Last checked</dt><dd>${updatedAgo(svc.updatedAt)}</dd></div>
    </dl>
    ${step >= 0 ? `<ol class="rsvc-steps" aria-label="Repair progress: ${esc(FIX_STEPS[step])}">${FIX_STEPS.map((t, i) => `<li class="${i < step ? 'is-done' : i === step ? 'is-now' : ''}"><span class="rsvc-dot">${i < step || (i === step && step === 3) ? icon('check', 12) : ''}</span><span>${t}</span></li>`).join('')}</ol>` : ''}
    <div class="kp-foot"><span class="rkp-foot">${foot}</span><span class="kp-flag ${flag[0] === 'ok' ? '' : `kp-flag--${flag[0]}`}">${flag[1]}</span></div>
  </section>`;
}

// Four small tiles, each opening its own page — same component as the operator KPI tiles.
const SAFE_SHORT = { safe: ['Yes', 'Passed all tests'], caution: ['Yes', 'One reading being watched'], unsafe: ['No', 'Do not drink tap water'] };
const OUTLOOK_TILE = { stable: 'Enough', watch: 'Enough', risk: 'May run low', critical: 'Likely low' };
const dotSub = (sev, text) => `<span class="sys-dot sys-dot--${SEV[sev].cls}" aria-hidden="true"></span> ${text}`;
function homeTiles() {
  const s = st();
  const ws = S.waterSafety(s);
  const fcKey = S.forecast({ hours: 24 }).status;
  const adv = s.advisories.filter((a) => a.status === 'Active' && a.areas.includes(RESIDENT.zone));
  const open = s.reports.filter((r) => r.mine && r.status !== 'verified').sort((a, b) => b.submittedAt - a.submittedAt);
  const [safeV, safeT] = SAFE_SHORT[ws.verdict];
  return [
    kpi({ label: 'Safe to drink', value: safeV, sub: dotSub(SAFE_SEV[ws.verdict], safeT), sev: ws.verdict === 'safe' ? null : SAFE_SEV[ws.verdict], link: '#/r/water-safety' }),
    kpi({ label: 'Next 24 hours', value: OUTLOOK_TILE[fcKey], sub: dotSub(OUTLOOK[fcKey].sev, 'Water supply forecast'), sev: fcKey === 'risk' || fcKey === 'critical' ? OUTLOOK[fcKey].sev : null, link: '#/r/outlook' }),
    kpi({ label: 'Notices', value: adv.length, sub: adv.length ? dotSub(advSev(adv[0]), esc(adv[0].title)) : dotSub('normal', 'None for your area'), link: '#/r/advisories' }),
    kpi({ label: 'My reports', value: open.length, unit: 'open', sub: open.length ? dotSub(residentReportStatus(open[0]).sev, esc(residentReportStatus(open[0]).label)) : 'Report a problem anytime', link: '#/r/reports' }),
  ].join('');
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

// Plain description of each checkpoint, in the order water flows to homes.
const SAFE_POINT_SUB = { 'WQ-1': 'Right after the water is cleaned and disinfected', 'WQ-2': 'As water leaves storage for the city', 'WQ-3': 'On the main line, just before the neighbourhood pipes' };
const SAFE_FLAG = { safe: ['ok', 'Safe to drink'], caution: ['warn', 'Being watched'], unsafe: ['crit', 'Do not drink'] };

function safetyMain() {
  const ws = S.waterSafety(st());
  const all = [...ws.stations.flatMap((x) => x.params), ...ws.lab];
  const passed = (keys) => all.filter((p) => keys.includes(p.key)).every((p) => p.sev === 'normal');
  const results = SAFE_CHECKS.map((c) => ({ ...c, ok: passed(c.keys) }));
  const nPass = results.filter((c) => c.ok).length;
  const labOk = ws.lab.every((p) => p.sev === 'normal');
  const [title, text] = SAFE_WORDS[ws.verdict];
  const flag = SAFE_FLAG[ws.verdict];
  const unsafe = ws.verdict === 'unsafe';

  // Verdict banner — the same component as the operator Water Safety page.
  const verdict = `<section class="ws-verdict ws-verdict--${ws.verdict}">
    <span class="ws-v-ic">${icon(unsafe ? 'alert' : 'shield', 26)}</span>
    <div class="ws-v-t"><span class="kpi-label">Is your water safe to drink?</span><strong>${title}</strong><span>${text}</span></div>
    <div class="ws-v-n">
      <div><strong>${nPass}/${results.length}</strong><span>${icon('check-circle', 15)} tests passed</span></div>
      <div><strong>${labOk ? 'None' : 'Found'}</strong><span>${icon('flask', 15)} harmful germs</span></div>
      <div><strong>${relTime(ws.labAt).replace(' ago', '').replace(/ seconds?/, ' sec').replace(/ minutes?/, ' min').replace(/ hours?/, ' hr')}</strong><span>${icon('clock', 15)} since lab test</span></div>
    </div>
    <span class="kp-flag ${flag[0] === 'ok' ? '' : `kp-flag--${flag[0]}`}">${flag[1]}</span>
  </section>`;

  // Checkpoint journey: where water is tested on its way to homes, left to right.
  const stops = [
    ...ws.stations.map((x) => ({ name: SAFE_POINTS[x.id] || esc(x.name), sub: SAFE_POINT_SUB[x.id] || '', ok: x.sev === 'normal', ic: 'droplet' })),
    { name: 'Laboratory germ test', sub: `Samples tested for bacteria · ${relTime(ws.labAt)}`, ok: labOk, ic: 'flask' },
  ];
  const journey = card(
    'Where we check your water',
    `<ol class="rflow">${stops
      .map((p, i) => `<li class="${p.ok ? '' : 'is-bad'}"><span class="rflow-ic">${icon(p.ic, 20)}<b>${i + 1}</b></span><strong>${p.name}</strong><small>${p.sub}</small>${passMark(p.ok)}</li>`)
      .join('')}<li class="rflow-end"><span class="rflow-ic">${icon('home', 20)}</span><strong>Your home</strong><small>${unsafe ? 'Boil water before drinking' : 'Safe tap water'}</small></li></ol>`,
    { sub: 'In the order water travels from the treatment plant to your tap' }
  );

  const checks = results
    .map((c) => `<li><span class="sys-dot sys-dot--${c.ok ? 'ok' : 'crit'}" aria-hidden="true"></span><span><strong>${c.label}</strong><small>${c.why}</small></span>${passMark(c.ok)}</li>`)
    .join('');
  return `${verdict}
    ${journey}
    <div class="r-grid">
      <div>${card('What we test for', `<ul class="safe-list safe-list--why">${checks}</ul>`, { sub: 'Five checks based on the Philippine drinking-water standards' })}</div>
      <div>${card(
        unsafe ? 'What to do now' : 'If water is ever unsafe',
        `<ul class="tips">
          <li>Boil water for at least 1 minute, or use bottled water, for drinking, cooking, making ice and brushing teeth.</li>
          <li>Tap water is still fine for flushing toilets, cleaning and washing clothes.</li>
          <li>We will tell you here and send a notification as soon as water is safe again.</li>
        </ul>`,
        { sub: unsafe ? 'Tests found a problem with your water' : 'Good to know, just in case' }
      )}</div>
    </div>`;
}

const waterSafetyPage = {
  title: 'Water Safety',
  regions: { main: safetyMain },
  render() {
    return `<div class="r-page">
      <div class="page-h"><div><h1>Water Safety</h1><p class="page-sub">Is your tap water safe to drink? Here is what the tests show.</p></div>
        <div class="page-a"><button class="btn btn--primary btn--sm" data-action="quick-report" data-type="color">${icon('flask', 15)} Report dirty or smelly water</button></div></div>
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
  regions: { kpis: () => homeStatus() + homeTiles(), safetyAlert: homeSafetyAlert, tips: homeTips, outlook: homeOutlook },
  render() {
    const s = st();
    const adv = s.advisories.filter((a) => a.status === 'Active' && a.areas.includes(RESIDENT.zone));
    const h = new Date().getHours();
    const hello = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    return `<div class="r-page">
      <div class="page-h"><div><h1>My Water Service</h1><p class="page-sub">${hello}, ${esc(RESIDENT.name.split(' ')[0])} · ${esc(brgyName(RESIDENT.barangay))} · ${esc(myZone().name)}</p></div>
        <div class="page-a"><a class="btn btn--primary btn--sm" href="#/r/report">${icon('plus', 15)} Report a problem</a></div></div>
      <div class="kgrid rkgrid" data-region="kpis">${homeStatus()}${homeTiles()}</div>
      <div class="r-alert" data-region="safetyAlert">${homeSafetyAlert()}</div>
      ${adv.length ? card(adv.length > 1 ? 'Notices for your area' : 'Notice for your area', adv.map((a) => advisoryCard(a)).join(''), { actions: `<a class="link" href="#/r/advisories">All notices ${icon('chev-r', 14)}</a>` }) : ''}
      <div class="r-grid">
        <div data-region="outlook">${homeOutlook()}</div>
        <div data-region="tips">${homeTips()}</div>
      </div>
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
      ${homeLatest()}
    </div>`;
  },
};

const altStatus = (s) => status({ AVAILABLE: 'normal', LIMITED: 'warning', SCHEDULED: 'info', CLOSED: 'offline' }[s] || 'info', s);

// ---------------------------------------------------------------- REPORT A PROBLEM
let draft = null;
let lastSubmitted = null;
function newDraft(type) {
  return { type: type || '', description: '', useHome: true, location: RESIDENT.address, barangay: RESIDENT.barangay, pin: { x: RESIDENT.x, y: RESIDENT.y }, observedAt: toLocalInput(Date.now()), photo: null, errors: {}, step: type ? 2 : 1 };
}
const zoneAt = (pin) => ZONES.find((z) => pointInPolygon([pin.x, pin.y], parsePoly(z.poly)));

// One "Report a new problem" card: a 4-stop progress line on top, one step visible at a time.
const RP_STEPS = ['Problem', 'Details', 'Location', 'Photo & send'];
const rpLoc = (d) => (d.useHome ? RESIDENT.address : `${d.location.trim() || 'Pinned on map'}, Brgy. ${d.barangay}`);

function rpTrack(d) {
  const answers = [d.type ? reportTypeLabel(d.type) : '', d.step > 2 ? fmtDateTime(fromLocalInput(d.observedAt) || Date.now()) : '', d.step > 3 ? rpLoc(d) : '', ''];
  const fill = (d.step - 1) / (RP_STEPS.length - 1);
  return `<ol class="rp-track" style="--f:${fill}" aria-label="Step ${d.step} of ${RP_STEPS.length}: ${RP_STEPS[d.step - 1]}">${RP_STEPS.map((t, i) => {
    const n = i + 1;
    const state = n < d.step ? 'is-done' : n === d.step ? 'is-now' : '';
    const inner = `<span class="rp-node">${n < d.step ? icon('check', 14) : n}</span><span class="rp-lbl">${t}</span>${n < d.step && answers[i] ? `<small>${esc(answers[i])}</small>` : ''}`;
    return `<li class="${state}">${n < d.step ? `<button type="button" data-action="rp-goto" data-step="${n}" aria-label="Go back to ${t}">${inner}</button>` : `<div>${inner}</div>`}</li>`;
  }).join('')}</ol>`;
}

function rpStep(d) {
  const e = d.errors;
  const nav = (next) => `<div class="rp-nav">${d.step > 1 ? `<button type="button" class="btn btn--ghost" data-action="rp-back">${icon('chev-l', 16)} Back</button>` : '<span></span>'}${next}</div>`;
  if (d.step === 1)
    return `<h3 class="rp-q">What is the problem?</h3><p class="rp-hint">Choose the one that best matches what you see.</p>
      <div class="cat-grid" role="radiogroup" aria-label="Problem type">${REPORT_TYPES.map(
        (t) => `<label class="cat ${d.type === t.id ? 'is-on' : ''}"><input type="radio" name="type" value="${t.id}" ${d.type === t.id ? 'checked' : ''} data-change="rp-type"/>${icon(t.icon, 22)}<span>${t.label}</span></label>`
      ).join('')}</div>`;
  if (d.step === 2)
    return `<h3 class="rp-q">Tell us a bit more</h3><p class="rp-hint">${esc(reportTypeLabel(d.type))} · this helps the crew understand the problem.</p>
      ${field('What did you notice?', `<textarea id="rp-desc" rows="3" data-input="rp-desc" placeholder="e.g. Very weak flow from all faucets since 8 AM" maxlength="500">${esc(d.description)}</textarea>`, { id: 'rp-desc', hint: 'How long has it been happening? Are your neighbours affected too?', optional: true })}
      ${field('When did you notice it?', `<input type="datetime-local" id="rp-when" value="${d.observedAt}" max="${toLocalInput(Date.now())}" data-input="rp-when"/>`, { id: 'rp-when', req: true })}
      ${nav(`<button type="button" class="btn btn--primary" data-action="rp-next">Next ${icon('arrow', 16)}</button>`)}`;
  if (d.step === 3) {
    const z = zoneAt(d.pin);
    return `<h3 class="rp-q">Where is the problem?</h3><p class="rp-hint">Use your address, or move the pin on the map.</p>
      <div class="seg" role="radiogroup" aria-label="Service location">
        <label class="${d.useHome ? 'is-on' : ''}"><input type="radio" name="loc" value="home" ${d.useHome ? 'checked' : ''} data-change="rp-loc"/>${icon('home', 16)} My address</label>
        <label class="${!d.useHome ? 'is-on' : ''}"><input type="radio" name="loc" value="other" ${!d.useHome ? 'checked' : ''} data-change="rp-loc"/>${icon('pin', 16)} Another place</label>
      </div>
      ${
        d.useHome
          ? `<div class="loc-box">${icon('home', 18)}<div><strong>${esc(RESIDENT.address)}</strong><span>${esc(myZone().name)}</span></div></div>`
          : `<div class="grid-2">${field('Barangay', `<select id="rp-brgy" data-change="rp-brgy">${ZONES.flatMap((zz) => zz.barangays).map((b) => `<option ${b === d.barangay ? 'selected' : ''}>${b}</option>`).join('')}</select>`, { id: 'rp-brgy', req: true })}
             ${field('Street or landmark', `<input id="rp-locd" value="${esc(d.location === RESIDENT.address ? '' : d.location)}" data-input="rp-locd" placeholder="e.g. near the barangay hall"/>`, { id: 'rp-locd', optional: true })}</div>`
      }
      <div class="field"><span class="field-l">Map</span><p class="field-h">Tap the map or drag the red pin to where the problem is.</p>
        <div id="rp-map">${renderMap({ mode: 'picker', pin: d.pin, home: true })}</div>
        <div class="pin-info">${icon('pin', 15)} Pin is in <strong>${z ? esc(z.name) : 'outside the service area'}</strong></div>
      </div>
      <p class="rp-pin-note">${icon('info', 14)} Check the pin, then tap <strong>Next</strong> if it is in the right place.</p>
      ${e.zone ? `<div class="err" role="alert">${icon('alert', 14)} The pin must be inside the service area.</div>` : ''}
      ${nav(`<button type="button" class="btn btn--primary" data-action="rp-next">Next ${icon('arrow', 16)}</button>`)}`;
  }
  return `<h3 class="rp-q">Add a photo and send</h3><p class="rp-hint">A photo is optional, but it helps crews find leaks and dirty water faster.</p>
    ${
      d.photo
        ? `<div class="photo-prev"><img src="${d.photo}" alt="Attached photo preview"/><button type="button" class="btn btn--ghost btn--sm" data-action="rp-photo-rm">${icon('x', 14)} Remove photo</button></div>`
        : `<label class="upload">${icon('camera', 22)}<span><strong>Add a photo</strong><em>JPG or PNG, optional</em></span><input type="file" accept="image/*" capture="environment" data-change="rp-photo" class="sr-only"/></label>`
    }
    <dl class="kv rp-sum">
      <div><dt>Problem</dt><dd><strong>${esc(reportTypeLabel(d.type))}</strong></dd></div>
      <div><dt>What you noticed</dt><dd>${esc(d.description) || '<span class="muted">No description</span>'}</dd></div>
      <div><dt>When</dt><dd>${fmtDateTime(fromLocalInput(d.observedAt) || Date.now())}</dd></div>
      <div><dt>Where</dt><dd>${esc(rpLoc(d))}</dd></div>
    </dl>
    ${nav(`<button type="button" class="btn btn--primary btn--lg" data-action="rp-submit">${icon('check', 16)} Send report</button>`)}`;
}

function rpSent(id) {
  const r = st().reports.find((x) => x.id === id);
  if (!r) return '';
  return `<div class="rp-sent">
    <span class="rp-sent-ic">${icon('check-circle', 30)}</span>
    <div><h3 class="rp-q">Report sent</h3><p class="rp-hint">${esc(reportTypeLabel(r.type))} · ${esc(r.location)} · Report ${r.id}</p>
      <p class="rp-next-t">Your water provider will review it together with their sensor readings. We will notify you at every step.</p></div>
    <div class="rp-sent-a"><a class="btn btn--primary" href="#/r/reports/${r.id}" data-action="rp-done-track" data-id="${r.id}">Track this report</a><button type="button" class="btn btn--ghost" data-action="rp-again">Report another problem</button></div>
  </div>`;
}

function reportWizard() {
  if (lastSubmitted) return `<section class="card rp-card" id="rp-wizard">${rpSent(lastSubmitted)}</section>`;
  if (!draft) draft = newDraft();
  const d = draft;
  return `<section class="card rp-card" id="rp-wizard" aria-labelledby="rp-title">
    <header class="card-h"><div><h2 class="card-t" id="rp-title">Report a new problem</h2><p class="card-sub">Four quick steps. Your report helps your water provider find and fix problems faster.</p></div>${d.step > 1 || d.type ? `<div class="card-actions"><button type="button" class="btn btn--ghost btn--sm" data-action="rp-cancel">Start over</button></div>` : ''}</header>
    <div class="card-b">${rpTrack(d)}<div class="rp-step" data-step="${d.step}">${rpStep(d)}</div></div>
  </section>`;
}

registerInputs({
  'rp-type': (el) => ((draft.type = el.value), (draft.errors.type = false), (draft.step = 2), rerender(), rpFocus()),
  'rp-desc': (el) => (draft.description = el.value),
  'rp-when': (el) => (draft.observedAt = el.value),
  'rp-loc': (el) => {
    draft.useHome = el.value === 'home';
    if (draft.useHome) (draft.location = RESIDENT.address), (draft.barangay = RESIDENT.barangay), (draft.pin = { x: RESIDENT.x, y: RESIDENT.y });
    else draft.location = '';
    rerender();
  },
  'rp-brgy': (el) => {
    draft.barangay = el.value;
    const z = ZONES.find((zz) => zz.barangays.includes(el.value));
    if (z && zoneAt(draft.pin)?.id !== z.id) draft.pin = { x: z.label[0], y: z.label[1] };
    rerender();
  },
  'rp-locd': (el) => (draft.location = el.value),
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
  const w = document.getElementById('rp-wizard');
  if (!w) return;
  const y = window.scrollY;
  w.outerHTML = reportWizard();
  window.scrollTo(0, y);
  syncMaps();
}
// Bring the wizard into view below the sticky top bar after moving between steps.
const rpFocus = () => {
  const w = document.getElementById('rp-wizard');
  if (w && w.getBoundingClientRect().top < 60) window.scrollTo(0, w.getBoundingClientRect().top + window.scrollY - 72);
};

register({
  'quick-report': (el) => {
    draft = newDraft(el.dataset.type);
    lastSubmitted = null;
    if (location.hash === '#/r/reports') rerender();
    else go('#/r/reports');
    setTimeout(() => {
      const w = document.getElementById('rp-wizard');
      if (w) window.scrollTo(0, w.getBoundingClientRect().top + window.scrollY - 72);
    }, 60);
  },
  'map-pick': (el, e) => actions['map-pick-xy']({ dataset: svgPoint(el, e) }),
  'map-pick-xy': (el) => {
    if (!draft) return;
    const p = { x: +el.dataset.x, y: +el.dataset.y };
    draft.pin = p;
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
  'rp-back': () => ((draft.step = Math.max(1, draft.step - 1)), (draft.errors = {}), rerender(), rpFocus()),
  'rp-goto': (el) => ((draft.step = +el.dataset.step), (draft.errors = {}), rerender(), rpFocus()),
  'rp-next': () => {
    const d = draft;
    if (d.step === 3) {
      d.errors = { zone: !zoneAt(d.pin) };
      if (Object.values(d.errors).some(Boolean)) {
        rerender();
        document.querySelector('#rp-wizard .err')?.scrollIntoView({ block: 'center' });
        return;
      }
    }
    d.errors = {};
    d.step = Math.min(RP_STEPS.length, d.step + 1);
    rerender();
    rpFocus();
  },
  'rp-submit': (el) => busy(el, async () => {
    const d = draft;
    const z = zoneAt(d.pin);
    const r = await S.submitReport({
      type: d.type,
      description: d.description,
      zone: z.id,
      barangay: d.useHome ? RESIDENT.barangay : d.barangay,
      location: rpLoc(d),
      x: d.pin.x,
      y: d.pin.y,
      observedAt: fromLocalInput(d.observedAt) || Date.now(),
      photo: d.photo,
    });
    lastSubmitted = r.id;
    draft = null;
    go(location.hash); // redraw the card (now "Report sent") and the list below it
  }),
  'rp-done-track': (el) => ((lastSubmitted = null), go(`#/r/reports/${el.dataset.id}`)),
  'rp-again': () => ((lastSubmitted = null), (draft = newDraft()), rerender(), rpFocus()),
  'rep-tab': (el) => {
    repTab = el.dataset.id;
    go(location.hash);
  },
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

// Report progress in everyday words (same 6 steps the provider uses).
const REP_STEP_WORDS = {
  submitted: 'Sent',
  acknowledged: 'Seen by provider',
  investigating: 'Being checked',
  repair_assigned: 'Repair assigned',
  repair_completed: 'Repaired',
  verified: 'Confirmed by you',
};
const REP_ICON = Object.fromEntries(REPORT_TYPES.map((t) => [t.id, t.icon]));
const repStep = (r) => Math.max(0, REPORT_STEPS.findIndex((x) => x.id === r.status));
const repOpen = (r) => r.status !== 'verified' && !(r.residentResponse && r.residentResponse.restored);
const repNeedsAnswer = (r) => r.status === 'repair_completed' && r.awaitingVerification && !r.residentResponse;
let repTab = 'all';

// Work-queue layout (like the operator Incidents / Work Orders pages): count tiles, filter tabs, one list.
const reports = {
  title: 'My Reports',
  leave() {
    lastSubmitted = null;
  },
  render() {
    const mine = st().reports.filter((r) => r.mine).sort((a, b) => b.submittedAt - a.submittedAt);
    const open = mine.filter(repOpen);
    const fixing = open.filter((r) => ['investigating', 'repair_assigned'].includes(r.status));
    const ask = mine.filter(repNeedsAnswer);
    const done = mine.filter((r) => !repOpen(r));
    const list = { all: mine, open, resolved: done }[repTab] || mine;
    const head = `<div class="page-h"><div><h1>My Reports</h1><p class="page-sub">Report a water problem and follow it until it is fixed.</p></div></div>`;
    if (!mine.length)
      return `<div class="r-page">${head}${reportWizard()}<h2 class="sec-t">Your reports</h2>${card('', empty('No reports yet', 'Reports you send will appear here so you can follow them until the problem is fixed.', 'clipboard'))}</div>`;
    const row = (r) => {
      const rs = residentReportStatus(r);
      const i = repStep(r);
      const last = r.updates[r.updates.length - 1];
      return `<a class="rrep-row" href="#/r/reports/${r.id}">
        <span class="rrep-ic">${icon(REP_ICON[r.type] || 'more', 20)}</span>
        <span class="rrep-main"><strong>${esc(reportTypeLabel(r.type))}</strong><span>${esc(r.location)} · sent ${relTime(r.submittedAt)}</span></span>
        <span class="rrep-prog"><span class="pmini" aria-hidden="true">${REPORT_STEPS.map((_, k) => `<span class="${k <= i ? 'on' : ''}"></span>`).join('')}</span><small>Step ${i + 1} of ${REPORT_STEPS.length} · ${REP_STEP_WORDS[r.status] || ''}</small></span>
        <span class="rrep-st">${status(rs.sev, rs.label)}<small>${last ? `Updated ${relTime(last.at)}` : ''}</small></span>
        ${icon('chev-r', 18)}
      </a>`;
    };
    return `<div class="r-page">${head}
      ${ask.length ? alertBanner('info', `${ask.length === 1 ? 'A repair is' : `${ask.length} repairs are`} done. Is your water back?`, 'Your answer tells your water provider whether the problem is really fixed.', `<a class="btn btn--sm btn--primary" href="#/r/reports/${ask[0].id}">Answer now</a>`) : ''}
      ${reportWizard()}
      <h2 class="sec-t">Your reports</h2>
      <div class="kpis kpis--4 rrep-kpis">
        ${kpi({ label: 'Open', value: open.length, sub: open.length ? 'Still being handled' : 'Nothing open' })}
        ${kpi({ label: 'Being fixed', value: fixing.length, sub: dotSub(fixing.length ? 'warning' : 'normal', fixing.length ? 'Checked or repair assigned' : 'No repairs in progress') })}
        ${kpi({ label: 'Needs your answer', value: ask.length, sub: dotSub(ask.length ? 'info' : 'normal', ask.length ? 'Tell us if water is back' : 'Nothing to answer'), sev: ask.length ? 'info' : null })}
        ${kpi({ label: 'Resolved', value: done.length, sub: 'Fixed and confirmed' })}
      </div>
      <section class="card rrep-card">
        <div class="rrep-tabs">${tabs([{ id: 'all', label: 'All', count: mine.length }, { id: 'open', label: 'Open', count: open.length }, { id: 'resolved', label: 'Resolved', count: done.length }], repTab, 'rep-tab')}</div>
        ${list.length ? `<div class="rrep-list">${list.map(row).join('')}</div>` : `<div class="card-b">${empty(repTab === 'open' ? 'No open reports' : 'No resolved reports yet', '', 'check-circle')}</div>`}
      </section>
    </div>`;
  },
};

const reportDetail = {
  title: 'Track My Report',
  render({ id }) {
    const s = st();
    const r = s.reports.find((x) => x.id === id && x.mine);
    if (!r) return `<div class="r-page">${empty('Report not found', '', 'search', '<a class="btn btn--outline btn--sm" href="#/r/reports">Back to My Reports</a>')}</div>`;
    const rs = residentReportStatus(r);
    const idx = repStep(r);
    const stepAt = (sid) => r.updates.find((u) => u.status === sid)?.at || (sid === 'submitted' ? r.submittedAt : null);
    const inc = s.incidents.find((i) => i.id === r.incidentId);
    const adv = inc && s.advisories.find((a) => inc.advisoryIds.includes(a.id));
    const wo = inc && s.workOrders.filter((w) => inc.workOrderIds.includes(w.id)).sort((a, b) => b.createdAt - a.createdAt)[0];
    const resolution = inc?.resolution || wo?.completion?.notes;
    const askVerify = repNeedsAnswer(r);
    // Horizontal tracker across the top, in plain words.
    const tracker = `<section class="card rrep-track"><div class="card-b">
      <ol class="rsvc-steps rrep-steps" aria-label="Report progress: step ${idx + 1} of ${REPORT_STEPS.length}">${REPORT_STEPS.map((x, i) => {
        const at = i <= idx ? stepAt(x.id) : null;
        return `<li class="${i <= idx ? 'is-done' : i === idx + 1 ? 'is-now' : ''}"><span class="rsvc-dot">${i <= idx ? icon('check', 12) : ''}</span><span>${REP_STEP_WORDS[x.id]}</span>${at ? `<small>${fmtDateTime(at)}</small>` : ''}</li>`;
      }).join('')}</ol></div></section>`;
    return `<div class="r-page">
      <a class="back" href="#/r/reports">${icon('chev-l', 16)} My Reports</a>
      <div class="page-h"><div><h1>${esc(reportTypeLabel(r.type))}</h1><p class="page-sub">${esc(r.location)} · Report ${r.id}</p></div><div class="page-a">${status(rs.sev, rs.label, { lg: true })}</div></div>
      ${
        askVerify
          ? `<section class="verify" aria-labelledby="vq"><h2 id="vq">Is your water back?</h2><p>Your water provider says the repair is done. Your answer tells them whether the problem is really fixed.</p>
        <div class="verify-a"><button class="btn btn--success btn--lg" data-action="rv-respond" data-v="yes" data-id="${r.id}">${icon('check-circle', 18)} Yes, water is back</button><button class="btn btn--outline btn--lg" data-action="rv-respond" data-v="no" data-id="${r.id}">${icon('alert', 18)} No, still a problem</button></div></section>`
          : ''
      }
      ${r.residentResponse ? alertBanner(r.residentResponse.restored ? 'normal' : 'warning', r.residentResponse.restored ? 'You confirmed your water is back' : 'You told us the problem is still there', r.residentResponse.restored ? `Thank you for letting us know on ${fmtDateTime(r.residentResponse.at)}.` : 'Your water provider has been notified and will follow up.') : ''}
      ${tracker}
      <div class="r-grid r-grid--detail">
        <div class="r-col">
          ${card(
            'Updates from your water provider',
            r.updates.length
              ? `<ul class="upd-list">${[...r.updates].reverse().map((u) => `<li><time>${fmtDateTime(u.at)}</time><p>${esc(u.text)}</p></li>`).join('')}</ul>`
              : empty('No updates yet', 'You will get a notification when your provider looks at your report.', 'clock'),
            { sub: 'Newest first' }
          )}
          ${resolution ? card('How it was fixed', `<p>${esc(resolution)}</p>`) : ''}
        </div>
        <div class="r-col">
          ${card(
            'What you reported',
            `<dl class="kv">
            <div><dt>Problem</dt><dd>${esc(reportTypeLabel(r.type))}</dd></div>
            <div><dt>Where</dt><dd>${esc(r.location)}<br/><span class="muted">${esc(zoneById(r.zone).name)}</span></dd></div>
            <div><dt>Noticed</dt><dd>${fmtDateTime(r.observedAt)}</dd></div>
            <div><dt>Sent</dt><dd>${fmtDateTime(r.submittedAt)}</dd></div>
            ${r.description ? `<div><dt>Your description</dt><dd>${esc(r.description)}</dd></div>` : ''}
            ${inc ? `<div><dt>Handled as part of</dt><dd>${esc(inc.title)}</dd></div>` : ''}
            <div><dt>Report number</dt><dd class="mono">${r.id}</dd></div>
          </dl>${r.photo ? `<img class="rep-photo" src="${r.photo}" alt="Photo attached to report"/>` : ''}<div class="map-sm">${renderMap({ mode: 'picker', pin: { x: r.x, y: r.y }, readonly: true })}</div>`
          )}
          ${adv ? card('Related notice', advisoryCard(adv, { compact: true })) : ''}
        </div>
      </div></div>`;
  },
};

// ---------------------------------------------------------------- ADVISORIES
const advisories = {
  title: 'Advisories',
  render() {
    const s = st();
    const active = s.advisories.filter((a) => a.status === 'Active').sort((a, b) => b.updatedAt - a.updatedAt);
    const mine = active.filter((a) => a.areas.includes(RESIDENT.zone));
    const other = active.filter((a) => !a.areas.includes(RESIDENT.zone));
    const past = s.advisories.filter((a) => a.status !== 'Active').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
    const place = esc(brgyName(RESIDENT.barangay));
    const worst = mine.length ? S.worstSev(mine.map(advSev)) : 'normal';
    const pick = (k) => mine.map((a) => a[k]).filter(Boolean).sort((a, b) => a - b)[0];
    const nextUpd = pick('nextUpdate');
    const etr = pick('etr');
    const weekDone = s.advisories.filter((a) => a.status !== 'Active' && Date.now() - a.updatedAt < 7 * 864e5).length;
    const dot = (sev) => `<span class="sys-dot sys-dot--${SEV[sev].cls}" aria-hidden="true"></span>`;
    const sub = (label, sev, value, text) => `<div class="sub"><span class="sub-l">${label}</span><span class="sub-v">${dot(sev)}${value}</span><span class="sub-t">${text}</span></div>`;
    // Status band (same component as the operator Overview), then a two-column notice feed.
    return `<div class="r-page">
      <div class="page-h"><div><h1>Advisories</h1><p class="page-sub">Notices from ${esc(UTILITY.name)} about water service.</p></div></div>
      <div class="sys">
        <div class="sys-main"><span class="sys-k">Notices for ${place}</span>
          <div class="sys-v">${dot(worst)}<strong>${mine.length ? `${mine.length} active notice${mine.length > 1 ? 's' : ''}` : 'No notices'}</strong></div>
          <p>${mine.length ? 'Please read the notice below. We will update it as the situation changes.' : `There are no water service problems announced for your area right now. We'll notify you if anything changes.`}</p></div>
        <div class="sys-subs sys-subs--4">
          ${sub('Next update', nextUpd ? 'info' : 'normal', nextUpd ? fmtTime(nextUpd) : 'None', nextUpd ? 'From your water provider' : 'No update scheduled')}
          ${sub('Expected back', etr ? 'warning' : 'normal', etr ? fmtTime(etr) : '—', etr ? 'Estimate, may change' : mine.length ? 'Not yet known' : 'Nothing to restore')}
          ${sub('Other areas', other.length ? 'info' : 'normal', `${other.length} notice${other.length === 1 ? '' : 's'}`, 'Not affecting your area')}
          ${sub('Resolved', 'normal', weekDone, 'In the last 7 days')}
        </div>
      </div>
      <div class="adv-grid">
        <div>
          <h2 class="sec-t">Your area</h2>
          ${mine.length ? `<div class="stack">${mine.map((a) => advisoryCard(a)).join('')}</div>` : card('', empty('No notices for your area', 'When your water provider posts a notice for your area, it will appear here and you will get a notification.', 'check-circle'))}
          ${other.length ? `<h2 class="sec-t">Other areas</h2><p class="radv-note">These do not affect your area.</p><div class="stack">${other.map((a) => advisoryCard(a, { compact: true })).join('')}</div>` : ''}
        </div>
        <aside>
          ${past.length ? `<h2 class="sec-t">Recently resolved</h2><div class="card radv-past">${past
            .map((a) => `<div class="radv-past-r"><span class="sys-dot sys-dot--ok" aria-hidden="true"></span><div><strong>${esc(a.title)}</strong><span>${esc(a.message)}</span></div><span class="radv-past-t">Resolved ${relTime(a.updatedAt)}</span></div>`)
            .join('')}</div>` : ''}
        </aside>
      </div>
    </div>`;
  },
};

// ---------------------------------------------------------------- CONSUMPTION (bill estimator, official CWD rates)
let billM3 = Math.round(CWD_FACTS.avgM3PerConnection * 10) / 10;
let billClass = 'Domestic / Government';
function billBreakdown() {
  const r = WATER_RATES.classes[billClass];
  const rows = [['First 10 m³ (minimum charge)', Math.min(billM3, 10), r.min, true]];
  let left = Math.max(0, billM3 - 10);
  r.tiers.forEach((rate, i) => {
    const use = Math.min(left, i < 3 ? 10 : Infinity);
    rows.push([WATER_RATES.tierLabels[i], use, use * rate, false, rate]);
    left -= use;
  });
  return rows;
}
function billResult() {
  const total = waterBill(billM3, billClass);
  const rows = billBreakdown();
  return `<div class="bill-total"><span>Estimated monthly bill</span><strong>₱${fmt(total, 2)}</strong><em>${fmt(billM3, 1)} m³ · ${esc(billClass)}</em></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Consumption block</th><th class="num">m³</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>
    ${rows.map(([l, m3, amt, min, rate]) => `<tr><td>${esc(l)}</td><td class="num">${fmt(m3, 1)}</td><td class="num">${min ? 'flat' : `₱${fmt(rate, 2)}/m³`}</td><td class="num">₱${fmt(amt, 2)}</td></tr>`).join('')}
    </tbody></table></div>`;
}
const consumption = {
  title: 'My Consumption',
  render() {
    return `<div class="r-page">
      <div class="page-h"><div><h1>My Consumption</h1><p class="page-sub">${esc(UTILITY.name)} · water rates effective ${esc(WATER_RATES.effective)}</p></div></div>
      ${alertBanner('info', 'Meter readings are not linked yet', 'Your monthly meter readings will appear here once your account is connected to the water district’s billing records. Meanwhile, estimate your bill with the official rate schedule below.')}
      <div class="r-grid">
        <div class="r-col">${card(
          'Bill estimator',
          `<form class="form bill-form" onsubmit="return false">
            ${field('Monthly consumption (m³)', `<input type="number" id="bill-m3" min="0" max="500" step="0.1" value="${billM3}" data-input="bill"/>`, { id: 'bill-m3', hint: `Average residential use in Catbalogan: 16.2 m³ per month (${CWD_FACTS.asOf}).` })}
            ${field('Customer class', `<select id="bill-class" data-change="bill">${Object.keys(WATER_RATES.classes).map((c) => `<option ${c === billClass ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`, { id: 'bill-class' })}
          </form>
          <div id="bill-out">${billResult()}</div>
          <p class="fine">Minimum charge shown for a ½-inch meter. Source: ${esc(WATER_RATES.source)}. Your actual bill may include other charges.</p>`,
          { actions: src('MANUAL') }
        )}</div>
        <div class="r-col">${card(
          'How Catbalogan uses water',
          `<dl class="kv kv--2">
            <div><dt>Average use per connection</dt><dd>${fmt(CWD_FACTS.avgM3PerConnection, 1)} m³ / month</dd></div>
            <div><dt>Average residential use</dt><dd>16.2 m³ / month</dd></div>
            <div><dt>Per person</dt><dd>${fmt(CWD_FACTS.lpcd, 1)} liters / day</dd></div>
            <div><dt>Active connections</dt><dd>${fmt(CWD_FACTS.activeConnections)}</dd></div>
            <div><dt>Water lost before billing</dt><dd>${CWD_FACTS.nrwPct}% (non-revenue water)</dd></div>
            <div><dt>Barangays served</dt><dd>${CWD_FACTS.barangaysServed} of ${CWD_FACTS.barangaysTotal}</dd></div>
          </dl><p class="fine">Source: ${esc(CWD_FACTS.source)}.</p>`
        )}</div>
      </div>
    </div>`;
  },
};
registerInputs({
  bill: (el) => {
    if (el.id === 'bill-m3') billM3 = Math.max(0, +el.value || 0);
    else billClass = el.value;
    const o = document.getElementById('bill-out');
    if (o) o.innerHTML = billResult();
  },
});

// ---------------------------------------------------------------- WATER OUTLOOK
// Water Outlook: the operator forecast in everyday words, laid out like the operator pages.
const supplyWord = (p) => (p < 0.3 ? ['critical', 'Low'] : p < 0.42 ? ['warning', 'Limited'] : p < 0.5 ? ['info', 'Enough'] : ['normal', 'Plenty']);
const OUTLOOK_FLAG = { stable: ['ok', 'No action needed'], watch: ['ok', 'Being watched'], risk: ['warn', 'Store some water'], critical: ['crit', 'Store water now'] };

// What a day's weather means for water, in one short line.
function weatherEffect(d) {
  if (d.rainNote === 'heavy') return 'Heavy rain: tap water may look cloudier';
  if (d.demandPct >= 5) return 'Hot day: people will use more water';
  if (d.rainNote === 'dry') return 'Dry spell: less water from the river';
  if (d.rainNote === 'moderate') return 'Rainy: little effect on supply';
  return 'Little effect on your water';
}
const dayName = (date, i) => (i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(`${date}T12:00:00`).toLocaleDateString('en-PH', { weekday: 'long' }));

function outlookMain() {
  const fc = S.forecast({ hours: 72 });
  const o = OUTLOOK[fc.status];
  const flag = OUTLOOK_FLAG[fc.status];
  const [, nowW] = supplyWord(fc.now);
  const [, tmrW] = supplyWord(fc.at24);
  const { data } = weatherState();
  const days = dayImpacts();

  const pts = fc.pts.filter((p) => p.h <= 48);
  const chart = lineChart({
    id: 'r-outlook',
    label: 'Expected water supply level, next 2 days',
    series: [{ name: 'Supply level', color: '#1D6FB8', values: pts.map((p) => p.pct * 100), area: true, dash: true }],
    labels: pts.map((p) => (p.h ? `In ${p.h} hrs` : 'Now')),
    xTicks: [0, 12, 24, 36, 48].map((h) => ({ i: pts.findIndex((p) => p.h >= h), label: h === 0 ? 'Now' : h === 24 ? 'Tomorrow' : h === 48 ? 'In 2 days' : `In ${h} hrs` })),
    thresholds: [{ y: Math.round(S.MIN_RESERVE * 100), label: 'Firefighting reserve', color: '#C0262D' }],
    yMin: 0,
    yMax: 100,
    yFmt: (v) => `${Math.round(v)}%`,
    h: 250,
  });

  // Chart-led split card: the answer on the left, the 2-day forecast on the right.
  const hero = `<section class="card rol-hero">
    <div class="rol-sum">
      <span class="kpi-label">Next 24 hours · all areas</span>
      <div class="rkp-v"><span class="sys-dot sys-dot--${SEV[o.sev].cls}" aria-hidden="true"></span><strong>${OUTLOOK_TILE[fc.status]}</strong></div>
      <p class="rkp-h">${o.label}</p>
      <p class="rkp-p">${o.text}</p>
      <dl class="kp-meta">
        <div><dt>Right now</dt><dd>${nowW}</dd></div>
        <div><dt>Tomorrow</dt><dd>${tmrW}</dd></div>
        <div><dt>Busiest hours</dt><dd>Morning and evening</dd></div>
      </dl>
      <div class="kp-foot"><span class="rkp-foot">A forecast, not a guarantee</span><span class="kp-flag ${flag[0] === 'ok' ? '' : `kp-flag--${flag[0]}`}">${flag[1]}</span></div>
    </div>
    <div class="rol-chart"><div class="rol-chart-h"><strong>Water supply, next 2 days</strong><span>Shared city supply for all areas</span></div>${chart}</div>
  </section>`;

  // Weather as a row of day cards, like a weather app.
  const weather = days.length
    ? `<div class="rol-days">${days
        .map((d, i) => {
          const w = describeWx(data.daily.weather_code[i]);
          const bad = d.rainNote === 'heavy' || d.rainNote === 'dry' || d.demandPct >= 5;
          return `<article class="card rol-day">
            <div class="rol-day-h"><strong>${dayName(d.date, i)}</strong><span class="rol-wx-ic">${wIcon(w.icon, 22)}</span></div>
            <div class="rol-day-t">${fmt(d.tmax, 0)}°C</div>
            <div class="rol-day-w">${w.text}${d.rain >= 1 ? ` · ${fmt(d.rain, 0)} mm rain` : ''}</div>
            <div class="rol-day-e ${bad ? 'is-warn' : ''}"><span class="sys-dot sys-dot--${bad ? 'warn' : 'ok'}" aria-hidden="true"></span>${weatherEffect(d)}</div>
          </article>`;
        })
        .join('')}</div>`
    : card('', empty('Weather forecast unavailable', 'We will try again automatically.', 'cloud'));

  const store = fc.status === 'risk' || fc.status === 'critical';
  const tips = store
    ? ['Store enough water for drinking and cooking for 1 day.', 'Avoid non-essential use, like washing vehicles or watering plants.', 'Find water stations in <a href="#/r/water-access">Alternative Water Access</a> if you run out.']
    : ['No water shortages are expected from the city supply.', 'Local repairs can still affect your street. Check <a href="#/r/advisories">Advisories</a>.', 'Use water wisely during the busiest hours (6–8 AM and 6–8 PM).'];

  return `${hero}
    <h2 class="sec-t">Weather, next 3 days</h2>
    ${weather}
    ${card('What this means for you', `<ul class="tips">${tips.map((t) => `<li>${t}</li>`).join('')}</ul>`, { sub: store ? 'Supply may run low, so plan ahead' : 'Supply looks fine for now' })}`;
}

const outlook = {
  title: 'Water Outlook',
  regions: { main: outlookMain },
  render() {
    return `<div class="r-page">
      <div class="page-h"><div><h1>Water Outlook</h1><p class="page-sub">Will there be enough water in the coming days?</p></div></div>
      <div data-region="main">${outlookMain()}</div>
    </div>`;
  },
};

// ---------------------------------------------------------------- ALTERNATIVE WATER ACCESS
let altSel = null;
const waterAccess = {
  title: 'Alternative Water Access',
  regions: {
    list() {
      const s = st();
      const pts = s.altWater.filter((p) => p.active && p.confirmedAt).sort((a, b) => (b.zone === RESIDENT.zone) - (a.zone === RESIDENT.zone));
      if (!pts.length) return empty('No distribution points right now', 'When your water provider sets up water distribution points, they will appear here.', 'droplets');
      return pts
        .map((p) => {
          const tank = p.tankId ? s.emergencyTanks.find((t) => t.id === p.tankId) : null;
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
        `<dl class="kv"><div><dt>Account number</dt><dd>Not linked yet</dd></div><div><dt>Service address</dt><dd>${esc(RESIDENT.address)}</dd></div><div><dt>Barangay</dt><dd>${esc(myZone().short)}</dd></div><div><dt>Mobile number</dt><dd>${esc(RESIDENT.phone || '—')}</dd></div><div><dt>Water provider</dt><dd>${esc(UTILITY.name)}</dd></div></dl>
        <p class="fine">Linking your water district account number will be available once the billing system is connected.</p>`
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

const notifications = { title: 'Notifications', render: () => `<div class="r-page">${notificationsView('resident')}</div>` };

export const residentViews = {
  home,
  advisories,
  report: reports, // old Report a Problem links open the combined My Reports page
  reports,
  'reports/:id': reportDetail,
  consumption,
  outlook,
  'water-access': waterAccess,
  'water-safety': waterSafetyPage,
  notifications,
  profile,
};
