// SAMAR-AGOS application shell: routing, layouts, login, notifications, demo control.
import * as S from './store.js';
import { RESIDENT, PROVIDER_USER, SCENARIOS, UTILITY } from './data.js';
import { icon, logo, logoMark, cityScene, status, register, installDelegation, openDrawer, closeOverlay, showToast, confirmDialog, empty, tabs, SEV } from './ui.js';
import { installChartHover, measureCharts } from './charts.js';
import { syncMaps } from './livemap.js';
import { esc, relTime, fmtDateTime } from './util.js';
import { residentViews } from './views/resident.js';
import { providerViews } from './views/provider.js';

S.load();
installDelegation();
installChartHover();

const ROLE_KEY = 'samaragos.role';
let role = localStorage.getItem(ROLE_KEY);
const app = document.getElementById('app');
let current = null; // { view, params, key }
let rerendering = false;
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => current && measureCharts() && render(), 200);
});

const RES_NAV = [
  { id: 'home', label: 'My Water Service', short: 'Home', icon: 'home' },
  { id: 'advisories', label: 'Advisories', short: 'Advisories', icon: 'megaphone' },
  { id: 'report', label: 'Report a Problem', short: 'Report', icon: 'plus' },
  { id: 'reports', label: 'My Reports', short: 'My Reports', icon: 'clipboard' },
  { id: 'consumption', label: 'Consumption', icon: 'bars' },
  { id: 'outlook', label: 'Water Outlook', icon: 'forecast' },
  { id: 'water-access', label: 'Alternative Water Access', icon: 'truck' },
  { id: 'notifications', label: 'Notifications', icon: 'bell' },
  { id: 'profile', label: 'Profile', icon: 'user' },
];
const PRO_NAV = [
  { group: 'Monitor', items: [
    { id: 'overview', label: 'Overview', icon: 'grid' },
    { id: 'operations', label: 'Operations', icon: 'activity' },
    { id: 'forecast', label: 'Forecast', icon: 'forecast' },
    { id: 'simulator', label: 'Response Simulator', icon: 'sliders' },
  ] },
  { group: 'Respond', items: [
    { id: 'incidents', label: 'Incidents', icon: 'alert', count: () => S.getState().incidents.filter((i) => i.status !== 'Resolved').length },
    { id: 'work-orders', label: 'Work Orders', icon: 'wrench', count: () => S.getState().workOrders.filter((w) => w.status !== 'Completed').length },
    { id: 'advisories', label: 'Advisories', icon: 'megaphone' },
  ] },
  { group: 'Infrastructure', items: [
    { id: 'assets', label: 'Assets', icon: 'database' },
    { id: 'maintenance', label: 'Maintenance', icon: 'calendar' },
    { id: 'analytics', label: 'Analytics', icon: 'trend' },
  ] },
];

// ---------------------------------------------------------------- routing
function parse() {
  const h = location.hash.replace(/^#\/?/, '');
  const [area, page, id] = h.split('/');
  return { area, page, id };
}

function render() {
  const { area, page, id } = parse();
  if (!role || area === 'login' || !area) return renderLogin();
  if (area === 'r' && role !== 'resident') return go(`#/p/overview`);
  if (area === 'p' && role !== 'provider') return go(`#/r/home`);
  const views = area === 'r' ? residentViews : providerViews;
  const pg = page || (area === 'r' ? 'home' : 'overview');
  const view = views[id && views[`${pg}/:id`] ? `${pg}/:id` : pg] || views[area === 'r' ? 'home' : 'overview'];
  const params = { id, page: pg };
  const key = `${area}/${pg}/${id || ''}`;
  const sameView = current && current.key === key;
  const scroll = sameView ? window.scrollY : 0;
  if (current && !sameView) current.view.leave?.();
  current = { view, params, key, area, page: pg };
  let html;
  try {
    html = view.render(params);
  } catch (err) {
    console.error(err);
    html = empty('Something went wrong rendering this page', esc(err.message), 'octagon');
  }
  if (area === 'r') renderResidentShell(pg, html);
  else renderProviderShell(pg, view, html);
  view.mount?.(document.getElementById('view'), params);
  window.scrollTo(0, scroll || 0);
  if (!rerendering && measureCharts()) {
    rerendering = true;
    render();
    rerendering = false;
  }
  if (!sameView) {
    document.title = `${view.title || 'SAMAR-AGOS'} · SAMAR-AGOS`;
    const h1 = document.querySelector('#view h1');
    h1 && h1.setAttribute('tabindex', '-1');
  }
}

export function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}
window.addEventListener('hashchange', () => {
  closeOverlay();
  render();
});

// ---------------------------------------------------------------- login
function renderLogin() {
  current = null;
  document.title = 'Sign in · SAMAR-AGOS';
  app.innerHTML = `<div class="login">
    <section class="login-brand">
      <div>${logo({ size: 44, light: true })}</div>
      <div class="login-promise">
        <h1>Residents know what to expect.<br/>Water providers know where to act.</h1>
        <p>SAMAR-AGOS connects community water concerns with operational monitoring, incident response, forecasting, and public advisories.</p>
        <ul class="login-points">
          <li>${icon('users', 18)}Community reports become operational evidence</li>
          <li>${icon('forecast', 18)}Forecasting helps providers act before shortages become severe</li>
          <li>${icon('wrench', 18)}Work orders turn decisions into field response</li>
          <li>${icon('megaphone', 18)}Advisories keep residents informed — and residents verify recovery</li>
        </ul>
      </div>
      <div class="login-foot">Connected Water Service Monitoring for Catbalogan City, Samar</div>
    </section>
    <section class="login-panel">
      <div class="login-box">
        <div class="login-mobile-logo">${logo({ size: 40 })}</div>
        <h2>Sign in to SAMAR-AGOS</h2>
        <p class="muted">Choose a demo account to continue.</p>
        <div class="role-cards">
          <button class="role-card" data-action="login" data-role="resident">
            <span class="role-ic">${icon('home', 22)}</span>
            <span class="role-txt"><strong>Resident</strong><span>${esc(RESIDENT.name)} · ${esc(RESIDENT.address)}</span><em>Check service status, report problems, track repairs</em></span>
            ${icon('chev-r', 20)}
          </button>
          <button class="role-card" data-action="login" data-role="provider">
            <span class="role-ic role-ic--navy">${icon('activity', 22)}</span>
            <span class="role-txt"><strong>Water Provider / Operator</strong><span>${esc(PROVIDER_USER.name)} · ${esc(UTILITY.name)}</span><em>Monitor operations, investigate incidents, dispatch crews</em></span>
            ${icon('chev-r', 20)}
          </button>
        </div>
        <div class="demo-note">${icon('info', 16)}<span><strong>Hackathon prototype.</strong> All data is fictional and IoT telemetry is simulated. No real accounts, utilities, or sensors are connected.</span></div>
      </div>
    </section>
  </div>`;
}

// ---------------------------------------------------------------- resident shell
function renderResidentShell(page, html) {
  const s = S.getState();
  const unread = s.notifications.filter((n) => n.audience === 'resident' && n.state === 'unread').length;
  const primary = ['home', 'advisories', 'report', 'reports'];
  const isMore = !primary.includes(page);
  app.innerHTML = `<div class="rv">
    <a class="skip" href="#view">Skip to content</a>
    <header class="rh"><div class="rh-in">
      <a href="#/r/home" class="rh-logo" aria-label="SAMAR-AGOS home">${logo({ size: 32, tagline: false })}</a>
      <nav class="rh-nav" aria-label="Resident">${RES_NAV.filter((n) => !['notifications', 'profile'].includes(n.id)).map((n) => `<a href="#/r/${n.id}" class="${page === n.id || (page === 'reports' && n.id === 'reports') ? 'is-active' : ''}">${esc(n.label)}</a>`).join('')}</nav>
      <div class="rh-right">
        <a href="#/r/notifications" class="icon-btn bell" aria-label="Notifications, ${unread} unread">${icon('bell', 20)}<span class="bell-n" id="bell-n" ${unread ? '' : 'hidden'}>${unread}</span></a>
        <a href="#/r/profile" class="avatar" aria-label="Profile">${RESIDENT.initials}</a>
      </div></div>
    </header>
    <main id="view" class="rv-main scroll-root" tabindex="-1">${html}</main>
    <nav class="bn" aria-label="Resident mobile">
      ${RES_NAV.filter((n) => primary.includes(n.id)).map((n) => `<a href="#/r/${n.id}" class="${page === n.id || (n.id === 'reports' && page === 'reports') ? 'is-active' : ''} ${n.id === 'report' ? 'bn-cta' : ''}" ${page === n.id ? 'aria-current="page"' : ''}>${icon(n.icon, 20)}<span>${esc(n.short)}</span></a>`).join('')}
      <button class="${isMore ? 'is-active' : ''}" data-action="res-more">${icon('menu', 20)}<span>More</span></button>
    </nav>
    <footer class="rv-foot">SAMAR-AGOS prototype · ${esc(UTILITY.name)} (fictional) · Demo data only · <button class="linkish" data-action="switch-role">Switch to provider view</button></footer>
  </div>`;
}

// ---------------------------------------------------------------- provider shell
function renderProviderShell(page, view, html) {
  const s = S.getState();
  const unread = s.notifications.filter((n) => n.audience === 'provider' && n.state === 'unread').length;
  app.innerHTML = `<div class="pv">
    <a class="skip" href="#view">Skip to content</a>
    <aside class="sb" id="sidebar" aria-label="Provider navigation">
      <div class="sb-top">
        <a href="#/p/overview" class="sb-logo" aria-label="SAMAR-AGOS overview">${logoMark(32)}<span class="sb-brand"><strong>SAMAR-AGOS</strong><span>Water Operations</span></span></a>
        <div class="sb-scene">${cityScene()}</div>
      </div>
      <nav class="sb-nav">
        ${PRO_NAV.map((g) => `<div class="sb-group"><div class="sb-gl">${g.group}</div>${g.items.map((n) => {
          const c = n.count ? n.count() : null;
          return `<a href="#/p/${n.id}" class="sb-a ${page === n.id ? 'is-active' : ''}" ${page === n.id ? 'aria-current="page"' : ''}>${icon(n.icon, 17)}<span>${n.label}</span>${c ? `<span class="sb-n">${c}</span>` : ''}</a>`;
        }).join('')}</div>`).join('')}
      </nav>
      <div class="sb-foot">
        <button class="sb-demo" data-action="demo-panel">${icon('play', 14)}<span>Demo scenarios</span></button>
        <button class="sb-a" data-action="switch-role">${icon('home', 17)}<span>Resident view</span></button>
        <div class="sb-user">
          <span class="avatar avatar--navy">${PROVIDER_USER.initials}</span>
          <span class="sb-user-t"><strong>${esc(PROVIDER_USER.name)}</strong><span>${esc(PROVIDER_USER.role)}</span></span>
          <button class="icon-btn sb-out" data-action="logout" aria-label="Sign out" title="Sign out">${icon('logout', 17)}</button>
        </div>
      </div>
    </aside>
    <div class="sb-scrim" data-action="sb-close"></div>
    <div class="pv-main">
      <header class="tb">
        <button class="icon-btn tb-menu" data-action="sb-open" aria-label="Open navigation">${icon('menu', 20)}</button>
        <div class="tb-mlogo">${logoMark(28)}</div>
        <div class="tb-fresh" id="tb-fresh">${freshness()}</div>
        <div class="tb-right">
          <span id="tb-status">${headerStatus()}</span>
          <button class="btn btn--sm btn--outline tb-demo" data-action="demo-panel">${icon('play', 14)}<span>Demo scenarios</span></button>
          <a href="#/p/notifications" class="icon-btn bell" aria-label="Notifications, ${unread} unread">${icon('bell', 20)}<span class="bell-n" id="bell-n" ${unread ? '' : 'hidden'}>${unread}</span></a>
          <span class="avatar avatar--navy" title="${esc(PROVIDER_USER.name)} — ${esc(PROVIDER_USER.role)}">${PROVIDER_USER.initials}</span>
        </div>
      </header>
      <main id="view" class="pv-content scroll-root" tabindex="-1">${html}</main>
    </div>
  </div>`;
}

function freshness() {
  const t = S.getState().tele;
  return `<span class="live-dot" aria-hidden="true"></span><span class="src src--sim">SIMULATED TELEMETRY</span><span class="tb-upd"><span class="tb-upd-l">Last update: </span><span class="upd" data-ts="${t.lastUpdate}">${relTime(t.lastUpdate)}</span></span><span class="tb-acc" title="Each 3-second update advances the simulation by 5 minutes">· accelerated time ×100</span>`;
}
function headerStatus() {
  const o = S.overallStatus();
  const label = { normal: 'System Normal', warning: 'System Warning', critical: 'System Critical', offline: 'Data Unavailable' }[o.sev];
  return `<a href="#/p/overview" class="tb-sys">${status(o.sev, label)}</a>`;
}

// ---------------------------------------------------------------- live updates
S.on('change', () => current && render());
S.on('tick', () => {
  if (!current) return;
  const root = document.getElementById('view');
  const v = current.view;
  if (v.regions && root)
    root.querySelectorAll('[data-region]').forEach((el) => {
      const fn = v.regions[el.dataset.region];
      if (fn) {
        try {
          el.innerHTML = fn(current.params);
        } catch (e) {
          console.error(e);
        }
      }
    });
  v.onTick?.(root, current.params);
  syncMaps();
  const f = document.getElementById('tb-fresh');
  if (f) f.innerHTML = freshness();
  const st = document.getElementById('tb-status');
  if (st) st.innerHTML = headerStatus();
  updateBell();
  refreshTimes();
});
S.on('toast', showToast);
setInterval(refreshTimes, 1000);
function refreshTimes() {
  document.querySelectorAll('.upd[data-ts]').forEach((el) => (el.textContent = relTime(+el.dataset.ts)));
}
function updateBell() {
  const el = document.getElementById('bell-n');
  if (!el || !current) return;
  const aud = current.area === 'r' ? 'resident' : 'provider';
  const n = S.getState().notifications.filter((x) => x.audience === aud && x.state === 'unread').length;
  el.textContent = n;
  el.hidden = !n;
  el.parentElement.setAttribute('aria-label', `Notifications, ${n} unread`);
}

setInterval(() => S.tick(), S.TICK_MS);

// ---------------------------------------------------------------- shared actions
register({
  login: (el) => {
    role = el.dataset.role;
    localStorage.setItem(ROLE_KEY, role);
    go(role === 'resident' ? '#/r/home' : '#/p/overview');
  },
  logout: () => {
    role = null;
    localStorage.removeItem(ROLE_KEY);
    go('#/login');
  },
  'switch-role': () => {
    role = role === 'resident' ? 'provider' : 'resident';
    localStorage.setItem(ROLE_KEY, role);
    go(role === 'resident' ? '#/r/home' : '#/p/overview');
    showToast({ msg: `Switched to ${role === 'resident' ? 'resident' : 'provider'} view — same connected demo data`, kind: 'info' });
  },
  'sb-open': () => document.querySelector('.pv')?.classList.add('sb-open'),
  'sb-close': () => document.querySelector('.pv')?.classList.remove('sb-open'),
  'res-more': () => {
    openDrawer(
      'More',
      `<nav class="more-list">${RES_NAV.filter((n) => !['home', 'advisories', 'report', 'reports'].includes(n.id))
        .map((n) => `<a href="#/r/${n.id}">${icon(n.icon, 20)}<span>${n.label}</span>${icon('chev-r', 18)}</a>`)
        .join('')}<button data-action="switch-role">${icon('activity', 20)}<span>Switch to provider view (demo)</span>${icon('chev-r', 18)}</button><button data-action="logout">${icon('logout', 20)}<span>Sign out</span>${icon('chev-r', 18)}</button></nav>`
    );
  },
  'demo-panel': () => openDemoPanel(),
  'apply-scenario': (el) => {
    S.applyScenario(el.dataset.id);
    openDemoPanel();
  },
  'reset-demo': async () => {
    const ok = await confirmDialog({ title: 'Reset demo data?', body: 'All incidents, work orders, advisories, and reports created during this demo will be cleared and the starting scenario restored.', confirm: 'Reset demo', danger: true });
    if (ok) {
      S.reset();
      go(role === 'resident' ? '#/r/home' : '#/p/overview');
    }
  },
  'notif-open': (el) => {
    S.setNotification(el.dataset.id, 'read');
    if (el.dataset.link) location.hash = el.dataset.link;
  },
  'notif-read': (el) => S.setNotification(el.dataset.id, el.dataset.to),
  'notif-archive': (el) => S.setNotification(el.dataset.id, 'archived'),
  'notif-allread': (el) => S.markAllRead(el.dataset.aud),
  'notif-tab': (el) => {
    notifTab = el.dataset.id;
    render();
  },
});

// ---------------------------------------------------------------- demo control panel
function walkthrough() {
  const s = S.getState();
  const incB = s.incidents.find((i) => i.zone === 'B' && i.id !== 'INC-2026-038' && i.detectedAt > s.seededAt - 864e5 && i.type !== 'Equipment');
  const wo = incB && s.workOrders.find((w) => w.incidentId === incB.id);
  const adv = incB && s.advisories.find((a) => a.incidentId === incB.id);
  const mine = s.reports.filter((r) => r.mine);
  return [
    { done: mine.length > 0, text: 'Resident reports low pressure', link: '#/r/report', who: 'Resident' },
    { done: !!incB, text: 'Operator reviews report cluster & evidence → creates incident', link: '#/p/incidents', who: 'Provider' },
    { done: !!incB, text: 'Check forecast impact and run the Response Simulator', link: '#/p/simulator', who: 'Provider' },
    { done: !!wo, text: 'Create a work order from the incident', link: incB ? `#/p/incidents/${incB.id}` : '#/p/incidents', who: 'Provider' },
    { done: !!adv, text: 'Publish an advisory → residents notified', link: incB ? `#/p/incidents/${incB.id}` : '#/p/advisories', who: 'Provider' },
    { done: wo?.status === 'Completed', text: 'Advance field work order to Completed (readings recover)', link: wo ? `#/p/work-orders/${wo.id}` : '#/p/work-orders', who: 'Field' },
    { done: incB?.status === 'Resolved', text: 'Resolve incident → restoration notification', link: incB ? `#/p/incidents/${incB.id}` : '#/p/incidents', who: 'Provider' },
    { done: mine.some((r) => r.residentResponse), text: 'Resident confirms whether service returned', link: '#/r/reports', who: 'Resident' },
  ];
}

function openDemoPanel() {
  const s = S.getState();
  const steps = walkthrough();
  const act = new Set(s.activeScenarios);
  openDrawer(
    'Demo scenarios',
    `<div class="banner banner--info">${icon('info', 18)}<div class="banner-c"><strong>Provider-only demonstration control.</strong><div>Scenarios change simulated telemetry only. Effects propagate to charts, alerts, forecasts, reports, and the resident portal.</div></div></div>
    <h3 class="sec-t">Trigger a system scenario</h3>
    <div class="scn-list">${Object.entries(SCENARIOS)
      .map(
        ([k, v]) => `<div class="scn ${act.has(k) ? 'is-on' : ''}"><div><strong>${v.label}</strong>${act.has(k) ? ' ' + status('warning', 'Active') : ''}<p>${v.desc}</p></div><button class="btn btn--sm ${k === 'normal' ? 'btn--outline' : 'btn--primary'}" data-action="apply-scenario" data-id="${k}">${k === 'normal' ? 'Restore normal' : 'Apply'}</button></div>`
      )
      .join('')}</div>
    <h3 class="sec-t">Core workflow walkthrough</h3>
    <ol class="walk">${steps.map((st, i) => `<li class="${st.done ? 'is-done' : ''}"><span class="walk-n">${st.done ? icon('check', 13) : i + 1}</span><a href="${st.link}">${esc(st.text)}</a><span class="walk-who">${st.who}</span></li>`).join('')}</ol>
    <p class="muted sm">Tip: open the resident view (sidebar → "Open resident view") between steps to see what residents see.</p>
    <button class="btn btn--danger-ghost" data-action="reset-demo">${icon('refresh', 15)} Reset demo data</button>`,
    { sub: 'Simulated data · not live control' }
  );
}

// ---------------------------------------------------------------- notifications page (shared)
let notifTab = 'unread';
export function notificationsView(aud) {
  const s = S.getState();
  const all = s.notifications.filter((n) => n.audience === aud);
  const lists = { unread: all.filter((n) => n.state === 'unread'), all: all.filter((n) => n.state !== 'archived'), archived: all.filter((n) => n.state === 'archived') };
  const list = lists[notifTab] || lists.unread;
  const sevIcon = (n) => {
    const sev = n.severity || { advisory: 'warning', restored: 'normal', water: 'info', report: 'info', reading: 'info' }[n.kind] || 'info';
    return `<span class="nt-ic nt-ic--${SEV[sev]?.cls || 'info'}">${icon(SEV[sev]?.icon || 'info', 18)}</span>`;
  };
  return `<div class="page-h"><div><h1>Notifications</h1><p class="page-sub">${aud === 'resident' ? 'Updates about advisories, your reports, and water service in your area.' : 'Operational alerts, report clusters, equipment warnings, and overdue work.'}</p></div>
    <div class="page-a"><button class="btn btn--outline btn--sm" data-action="notif-allread" data-aud="${aud}">${icon('check', 15)} Mark all as read</button></div></div>
    ${tabs([{ id: 'unread', label: 'Unread', count: lists.unread.length }, { id: 'all', label: 'All', count: lists.all.length }, { id: 'archived', label: 'Archived', count: lists.archived.length }], notifTab, 'notif-tab')}
    <div class="nt-list">${
      list.length
        ? list
            .map(
              (n) => `<article class="nt ${n.state === 'unread' ? 'is-unread' : ''}">${sevIcon(n)}
        <div class="nt-c" role="button" tabindex="0" data-action="notif-open" data-id="${n.id}" data-link="${esc(n.link || '')}"><div class="nt-t">${esc(n.title)} ${n.state === 'unread' ? '<span class="sr-only">(unread)</span><span class="nt-dot" aria-hidden="true"></span>' : ''}</div><div class="nt-b">${esc(n.body)}</div><div class="nt-time">${fmtDateTime(n.at)} · ${relTime(n.at)}</div></div>
        <div class="nt-a">${n.state !== 'archived' ? `<button class="btn btn--ghost btn--xs" data-action="notif-read" data-id="${n.id}" data-to="${n.state === 'unread' ? 'read' : 'unread'}">${n.state === 'unread' ? 'Mark read' : 'Mark unread'}</button><button class="btn btn--ghost btn--xs" data-action="notif-archive" data-id="${n.id}">${icon('archive', 14)} Archive</button>` : `<button class="btn btn--ghost btn--xs" data-action="notif-read" data-id="${n.id}" data-to="read">Restore</button>`}</div></article>`
            )
            .join('')
        : empty(notifTab === 'unread' ? 'You are all caught up' : 'No notifications here', '', 'bell')
    }</div>`;
}

render();
