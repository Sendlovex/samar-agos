// SAMAR-AGOS application shell: routing, layouts, login, notifications, demo control.
import * as S from './store.js';
import * as B from './backend.js';
import { RESIDENT, PROVIDER_USER, SCENARIOS, UTILITY, ZONES, BARANGAY_LL, zoneOfBarangay } from './data.js';
import { icon, logo, logoMark, cityScene, status, register, installDelegation, openDrawer, openModal, closeOverlay, showToast, confirmDialog, empty, tabs, field, busy, SEV } from './ui.js';
import { installChartHover, measureCharts } from './charts.js';
import { syncMaps } from './livemap.js';
import { esc, relTime, fmtDateTime, toXY } from './util.js';
import { residentViews } from './views/resident.js';
import { providerViews } from './views/provider.js';

S.load();
installDelegation();
installChartHover();

const ROLE_KEY = 'samaragos.role';
let role = B.FB_ENABLED ? null : localStorage.getItem(ROLE_KEY);
let authMode = 'signin';
let authError = '';
// Residents can't open the operator console when accounts are real.
export const canSwitchRole = () => !B.FB_ENABLED || !!B.getSession()?.isProvider;
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
  if (B.FB_ENABLED) {
    if (!B.getSession()) return renderAuth();
    if (!role) return; // still syncing
    if (area === 'login' || !area) return go(role === 'resident' ? '#/r/home' : '#/p/overview');
  }
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
  app.innerHTML = `<div class="login">${brandPanel()}
    <section class="login-panel">
      <div class="login-box">
        <div class="login-mobile-logo">${brandMark(54)}</div>
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

// ---------------------------------------------------------------- Firebase accounts
const brandMark = (size = 96) => `<div class="lb-brand">${logoMark(size)}<div><div class="lb-name">SAMAR-AGOS</div><div class="lb-tag">Smart Water Monitoring and Response</div></div></div>`;
const partnerLogos = () => `<div class="lb-partners">
      <img src="/img/partner-logo.png" alt="Partner logo" width="284" height="326"/>
      <img src="/img/los-codigos-logo.png" alt="Los Codigos" width="368" height="315"/>
    </div>`;
const GOOGLE_G = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.3 5.7c4.3-3.9 7-9.7 7-17.1z"/><path fill="#FBBC05" d="M10.5 28.6A14.6 14.6 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2.1 1.4-4.9 2.3-8.6 2.3-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>`;
const point = (ic, text) => `<li><span class="lp-ic">${icon(ic, 16)}</span>${text}</li>`;
const brandPanel = () => `<section class="login-brand">
      ${brandMark()}
      <div class="login-promise">
        <h1>Residents know what to expect.<br/>Water providers know where to act.</h1>
        <p>SAMAR-AGOS connects community water concerns with operational monitoring, incident response, forecasting, and public advisories.</p>
        <ul class="login-points">
          ${point('users', 'Community reports become operational evidence')}
          ${point('forecast', 'Forecasting helps providers act before shortages become severe')}
          ${point('wrench', 'Work orders turn decisions into field response')}
          ${point('megaphone', 'Advisories keep residents informed — and residents verify recovery')}
        </ul>
      </div>
      ${partnerLogos()}
    </section>`;

function renderSplash(msg) {
  current = null;
  app.innerHTML = `<div class="splash" role="status">${logoMark(44)}<p>${esc(msg)}</p></div>`;
}

function renderAuth() {
  current = null;
  const signup = authMode === 'signup';
  document.title = `${signup ? 'Create account' : 'Sign in'} · SAMAR-AGOS`;
  app.innerHTML = `<div class="login">${brandPanel()}
    <section class="login-panel">
      <div class="login-box">
        <div class="login-mobile-logo">${brandMark(54)}</div>
        <div class="auth-head">
          <span class="auth-pill">Water Service Monitoring</span>
          <h2>${signup ? 'Create your account' : 'Welcome back'}</h2>
          <p>${signup ? 'Register to check service status, get advisories, and report problems.' : 'Sign in to access service status, reports, and advisories.'}</p>
        </div>
        <button type="button" class="btn-google" data-action="auth-google">${GOOGLE_G}<span>Continue with Google</span></button>
        <div class="auth-or"><span>or with email</span></div>
        <form class="form auth-form" id="auth-form" novalidate>
          <div class="auth-field">
            <label for="au-email">Email address <span class="req">*</span></label>
            <input type="email" id="au-email" autocomplete="email" required/>
          </div>
          <div class="auth-field">
            <div class="auth-label-row"><label for="au-pw">Password <span class="req">*</span></label>${signup ? '' : '<button type="button" class="linkish" data-action="auth-forgot">Forgot password?</button>'}</div>
            <div class="auth-pw"><input type="password" id="au-pw" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="6" required/><button type="button" class="auth-show" data-action="auth-showpw" data-for="au-pw" aria-pressed="false">Show</button></div>
            ${signup ? '<div class="auth-hint">At least 6 characters.</div>' : ''}
          </div>
          ${signup ? `<div class="auth-field">
            <label for="au-pw2">Confirm password <span class="req">*</span></label>
            <div class="auth-pw"><input type="password" id="au-pw2" autocomplete="new-password" required/><button type="button" class="auth-show" data-action="auth-showpw" data-for="au-pw2" aria-pressed="false">Show</button></div>
          </div>` : ''}
          ${authError ? `<div class="auth-err" role="alert">${icon('alert', 15)}<span>${esc(authError)}</span></div>` : ''}
          <button type="submit" class="auth-submit">${signup ? 'Create account' : 'Sign in'}</button>
        </form>
        <div class="auth-alt">
          ${signup ? `<span>Already have an account?</span> <button class="linkish" data-action="auth-mode" data-mode="signin">Sign in</button>` : `<span>Don't have an account?</span> <button class="linkish" data-action="auth-mode" data-mode="signup">Create account</button>`}
        </div>
        <div class="login-mobile-partners">${partnerLogos()}</div>
      </div>
    </section></div>`;
  const form = document.getElementById('auth-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = form.querySelector('.auth-submit');
    const email = document.getElementById('au-email').value;
    const pw = document.getElementById('au-pw').value;
    busy(btn, async () => {
      authError = '';
      try {
        if (signup) {
          if (pw !== document.getElementById('au-pw2').value) throw { message: 'Passwords do not match.' };
          await B.signUp(email, pw);
        } else await B.signIn(email, pw);
      } catch (err) {
        authError = B.authMessage(err);
        renderAuth();
        document.getElementById('au-email').value = email;
      }
    });
  });
  setTimeout(() => document.getElementById('au-email')?.focus(), 30);
}

const barangayOptions = (sel) =>
  ZONES.map((z) => `<optgroup label="${esc(z.name)}">${z.barangays.map((b) => `<option ${b === sel ? 'selected' : ''}>${esc(b)}</option>`).join('')}</optgroup>`).join('');

function profileFields(p = {}) {
  return `${field('Full name', `<input id="pf-name" value="${esc(p.name || '')}" autocomplete="name" required/>`, { id: 'pf-name', req: true })}
    <div class="grid-2">
      ${field('Barangay', `<select id="pf-brgy">${barangayOptions(p.barangay || 'Mercedes')}</select>`, { id: 'pf-brgy', req: true })}
      ${field('Purok / street', `<input id="pf-addr" value="${esc(p.address || '')}" placeholder="e.g. Purok 3"/>`, { id: 'pf-addr', optional: true })}
    </div>
    ${field('Mobile number', `<input id="pf-phone" type="tel" value="${esc(p.phone || '')}" placeholder="+63 9xx xxx xxxx" autocomplete="tel"/>`, { id: 'pf-phone', optional: true, hint: 'Used only by your water provider for service updates.' })}`;
}
const readProfileFields = () => ({
  name: document.getElementById('pf-name').value.trim(),
  barangay: document.getElementById('pf-brgy').value,
  address: document.getElementById('pf-addr').value.trim(),
  phone: document.getElementById('pf-phone').value.trim(),
});

function renderOnboarding() {
  current = null;
  const ses = B.getSession();
  document.title = 'Set up your profile · SAMAR-AGOS';
  app.innerHTML = `<div class="login">${brandPanel()}
    <section class="login-panel"><div class="login-box">
      <h2>Set up your profile</h2>
      <p class="muted">Signed in as ${esc(ses.email)}. Your barangay tells us which service zone and advisories apply to you.</p>
      <form class="form" id="onb-form" novalidate>
        ${profileFields()}
        ${!ses.accessExists ? `<label class="chk onb-admin"><input type="checkbox" id="onb-admin"/> <span><strong>I'm setting up SAMAR-AGOS for our water utility.</strong> Make this account the first staff administrator (only the first account can do this).</span></label>` : ''}
        <div class="auth-err" role="alert" hidden></div>
        <button type="submit" class="btn btn--primary btn--lg">Continue</button>
      </form>
      <div class="auth-alt"><button class="linkish" data-action="logout">Use a different account</button></div>
    </div></section></div>`;
  const form = document.getElementById('onb-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = readProfileFields();
    const errBox = form.querySelector('.auth-err');
    if (!data.name) return (errBox.hidden = false), (errBox.innerHTML = `${icon('alert', 15)}<span>Please enter your full name.</span>`);
    busy(form.querySelector('button[type=submit]'), async () => {
      await B.saveProfile(data);
      if (document.getElementById('onb-admin')?.checked) await B.claimProviderAccess();
      await enterApp();
    });
  });
}

function hashNum(str, mod) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % mod;
}

// Map the signed-in user's profile onto the resident / staff identity used by the views.
function applyProfile(ses) {
  const p = ses.profile || {};
  const name = p.name || ses.email.split('@')[0];
  const initials = name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'U';
  const barangay = p.barangay || 'Mercedes';
  const zone = zoneOfBarangay(barangay) || ZONES[1];
  const [lat, lng] = BARANGAY_LL[barangay] || [11.7824, 124.8774];
  const home = toXY(lat + ((hashNum(ses.uid, 9) - 4) * 0.0004), lng + ((hashNum(ses.uid + 'x', 9) - 4) * 0.0004));
  Object.assign(RESIDENT, {
    name,
    initials,
    barangay,
    zone: zone.id,
    address: p.address ? `${p.address}, Brgy. ${barangay}` : `Brgy. ${barangay}`,
    x: home.x,
    y: home.y,
    phone: p.phone || 'Not provided',
    account: `04${hashNum(ses.uid, 90) + 10}-${String(hashNum(ses.uid + 'a', 1000)).padStart(3, '0')}-${String(hashNum(ses.uid + 'b', 10000)).padStart(4, '0')}`,
    meter: `MTR-${zone.id}-${String(hashNum(ses.uid + 'm', 100000)).padStart(5, '0')}`,
    email: ses.email,
  });
  Object.assign(PROVIDER_USER, { name, initials, role: ses.isProvider ? 'Water utility staff' : 'Resident', email: ses.email });
}

async function enterApp() {
  const ses = B.getSession();
  applyProfile(ses);
  renderSplash('Syncing with the SAMAR-AGOS database…');
  await B.startSync();
  const pref = localStorage.getItem(ROLE_KEY);
  role = ses.isProvider ? (pref === 'resident' ? 'resident' : 'provider') : 'resident';
  const { area } = parse();
  const want = role === 'resident' ? 'r' : 'p';
  if (area !== want) go(want === 'r' ? '#/r/home' : '#/p/overview');
  else render();
}

async function boot() {
  if (!B.FB_ENABLED) return render();
  renderSplash('Connecting…');
  try {
    await B.initBackend();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="splash">${logoMark(44)}<p>Could not reach the SAMAR-AGOS server. Check your internet connection and reload.</p></div>`;
    return;
  }
  S.setRemote({ flush: B.flush, allocIds: B.allocIds, getSession: B.getSession, setNotifState: B.setNotifState, reset: B.resetRemote });
  B.onAuth(async (user) => {
    if (!user) {
      role = null;
      B.stopSync();
      return renderAuth();
    }
    renderSplash('Loading your account…');
    try {
      const ses = await B.loadSession(user);
      if (!ses.profile) return renderOnboarding();
      await enterApp();
    } catch (e) {
      console.error(e);
      app.innerHTML = `<div class="splash">${logoMark(44)}<p>Could not load your account (${esc(e.code || e.message)}).</p><button class="btn btn--outline" data-action="logout">Sign out</button></div>`;
    }
  });
}

function openProfileEditor() {
  const ses = B.getSession();
  openModal('Edit profile', `<form class="form" id="pe-form">${profileFields(ses.profile || {})}</form>`, {
    footer: `<button class="btn btn--ghost" data-action="ov-close">Cancel</button><button class="btn btn--primary" data-action="profile-save">Save profile</button>`,
  });
}

async function openTeamAccess() {
  const emails = await B.getProviderEmails();
  const me = B.getSession().email;
  openModal(
    'Staff access',
    `<p class="muted">People signed in with these emails can use the provider console. Everyone else uses the resident portal.</p>
    <ul class="team-list">${emails
      .map((e) => `<li><span>${icon('user', 15)} ${esc(e)}${e === me ? ' <span class="muted sm">(you)</span>' : ''}</span>${e === me || emails.length < 2 ? '' : `<button class="btn btn--ghost btn--xs" data-action="team-remove" data-email="${esc(e)}">Remove</button>`}</li>`)
      .join('')}</ul>
    <div class="team-add"><label class="sr-only" for="team-email">Staff email</label><input id="team-email" type="email" placeholder="colleague@utility.gov.ph"/><button class="btn btn--primary btn--sm" data-action="team-add">Add staff</button></div>
    <p class="fine">They must sign in with this exact email. Changes take effect on their next sign-in.</p>`
  );
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
    <footer class="rv-foot">SAMAR-AGOS prototype · ${esc(UTILITY.name)} (fictional) · ${B.FB_ENABLED ? 'Telemetry simulated' : 'Demo data only'}${canSwitchRole() ? ' · <button class="linkish" data-action="switch-role">Switch to provider view</button>' : ''}</footer>
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
          ${accountMenu()}
        </div>
      </header>
      <main id="view" class="pv-content scroll-root" tabindex="-1">${html}</main>
    </div>
  </div>`;
}

function accountMenu() {
  const email = B.FB_ENABLED ? B.getSession()?.email : '';
  return `<details class="acct">
    <summary class="acct-btn" aria-label="Account menu for ${esc(PROVIDER_USER.name)}"><span class="avatar avatar--navy">${PROVIDER_USER.initials}</span>${icon('chev-d', 14)}</summary>
    <div class="acct-menu">
      <div class="acct-head"><span class="avatar avatar--navy">${PROVIDER_USER.initials}</span><span><strong>${esc(PROVIDER_USER.name)}</strong><span>${esc(email || PROVIDER_USER.role)}</span></span></div>
      <button data-action="switch-role">${icon('home', 16)}<span>Resident view</span></button>
      ${B.FB_ENABLED ? `<button data-action="team-open">${icon('users', 16)}<span>Staff access</span></button>` : ''}
      <button data-action="logout" class="acct-out">${icon('logout', 16)}<span>Sign out</span></button>
    </div>
  </details>`;
}
// Close the account menu on outside clicks, item clicks and Escape.
document.addEventListener('click', (e) => {
  document.querySelectorAll('details.acct[open]').forEach((d) => {
    if (!d.contains(e.target) || e.target.closest('.acct-menu [data-action]')) d.open = false;
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('details.acct[open]').forEach((d) => (d.open = false));
});

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
  logout: async () => {
    role = null;
    localStorage.removeItem(ROLE_KEY);
    if (B.FB_ENABLED) {
      closeOverlay();
      authMode = 'signin';
      authError = '';
      await B.signOutUser();
      return;
    }
    go('#/login');
  },
  'auth-mode': (el) => ((authMode = el.dataset.mode), (authError = ''), renderAuth()),
  'auth-forgot': async () => {
    const email = document.getElementById('au-email')?.value.trim();
    if (!email) return showToast({ msg: 'Enter your email first, then choose "Forgot password?"', kind: 'info' });
    try {
      await B.resetPassword(email);
      showToast({ msg: `Password reset email sent to ${email}`, kind: 'success' });
    } catch (e) {
      showToast({ msg: B.authMessage(e), kind: 'error' });
    }
  },
  'auth-google': (el) =>
    busy(el, async () => {
      try {
        authError = '';
        await B.signInGoogle();
      } catch (e) {
        authError = B.authMessage(e);
        renderAuth();
      }
    }),
  'auth-showpw': (el) => {
    const input = document.getElementById(el.dataset.for);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    el.textContent = show ? 'Hide' : 'Show';
    el.setAttribute('aria-pressed', String(show));
  },
  'profile-edit': () => openProfileEditor(),
  'profile-save': (el) =>
    busy(el, async () => {
      const data = readProfileFields();
      if (!data.name) return showToast({ msg: 'Please enter your full name.', kind: 'error' });
      await B.saveProfile(data);
      applyProfile(B.getSession());
      closeOverlay();
      showToast({ msg: 'Profile updated', kind: 'success' });
      await B.startSync(); // zone may have changed → refresh zone notifications
      render();
    }),
  'team-open': () => openTeamAccess().catch((e) => showToast({ msg: `Could not load staff list (${e.code || e.message})`, kind: 'error' })),
  'team-add': (el, e) =>
    busy(el, async () => {
      e?.preventDefault?.();
      const email = document.getElementById('team-email').value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showToast({ msg: 'Enter a valid email address', kind: 'error' });
      await B.setProviderEmails([...(await B.getProviderEmails()), email]);
      showToast({ msg: `${email} can now use the provider console`, kind: 'success' });
      await openTeamAccess();
    }),
  'team-remove': (el) =>
    busy(el, async () => {
      const email = el.dataset.email;
      await B.setProviderEmails((await B.getProviderEmails()).filter((x) => x !== email));
      showToast({ msg: `${email} removed from staff access`, kind: 'info' });
      await openTeamAccess();
    }),
  'switch-role': () => {
    if (!canSwitchRole()) return;
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
        .join('')}${canSwitchRole() ? `<button data-action="switch-role">${icon('activity', 20)}<span>Switch to provider view</span>${icon('chev-r', 18)}</button>` : ''}<button data-action="logout">${icon('logout', 20)}<span>Sign out</span>${icon('chev-r', 18)}</button></nav>`
    );
  },
  'demo-panel': () => openDemoPanel(),
  'apply-scenario': (el) =>
    busy(el, async () => {
      await S.applyScenario(el.dataset.id);
      openDemoPanel();
    }),
  'reset-demo': async () => {
    const ok = await confirmDialog({
      title: 'Reset demo data?',
      body: B.FB_ENABLED
        ? 'This deletes all reports, incidents, work orders, advisories and notifications in the shared database — for every user — and restores the starting scenario. User accounts and staff access are kept.'
        : 'All incidents, work orders, advisories, and reports created during this demo will be cleared and the starting scenario restored.',
      confirm: 'Reset demo',
      danger: true,
    });
    if (ok) {
      try {
        await S.reset();
      } catch (e) {
        return showToast({ msg: `Reset failed (${e.code || e.message})`, kind: 'error' });
      }
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

boot();
