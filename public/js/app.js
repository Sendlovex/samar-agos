// SAMAR-AGOS application shell: routing, layouts, login, notifications, demo control.
import * as S from './store.js';
import * as B from './backend.js';
import { RESIDENT, PROVIDER_USER, SCENARIOS, UTILITY, ZONES, BARANGAY_LL, zoneOfBarangay } from './data.js';
import { icon, logoMark, cityScene, status, register, installDelegation, openDrawer, openModal, closeOverlay, showToast, confirmDialog, empty, tabs, field, busy, SEV } from './ui.js';
import { installChartHover, measureCharts } from './charts.js';
import { syncMaps } from './livemap.js';
import { esc, relTime, fmtDateTime, toXY } from './util.js';
import { residentViews } from './views/resident.js';
import { providerViews } from './views/provider.js';
import { setWoFilter } from './views/provider-incidents.js';

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
  { group: 'My Service', items: [
    { id: 'home', label: 'My Water Service', icon: 'home' },
    { id: 'advisories', label: 'Advisories', icon: 'megaphone', count: () => S.getState().advisories.filter((a) => a.status === 'Active' && a.areas.includes(RESIDENT.zone)).length },
    { id: 'water-safety', label: 'Water Safety', icon: 'shield' },
    { id: 'outlook', label: 'Water Outlook', icon: 'forecast' },
  ] },
  { group: 'Reports', items: [
    { id: 'reports', label: 'My Reports', icon: 'clipboard', count: () => S.getState().reports.filter((r) => r.mine && r.status !== 'verified').length },
  ] },
  { group: 'Resources', items: [
    { id: 'consumption', label: 'Consumption', icon: 'bars' },
    { id: 'water-access', label: 'Where to Get Water', icon: 'truck' },
  ] },
];
const PRO_NAV = [
  { group: 'Monitor', items: [
    { id: 'overview', label: 'Overview', icon: 'grid' },
    { id: 'operations', label: 'Operations', icon: 'activity' },
    { id: 'water-safety', label: 'Water Safety', icon: 'shield' },
    { id: 'forecast', label: 'Forecast', icon: 'forecast' },
  ] },
  { group: 'Respond', items: [
    { id: 'incidents', label: 'Incidents', icon: 'alert', count: () => S.getState().incidents.filter((i) => i.status !== 'Resolved').length },
    { id: 'work-orders', label: 'Work Orders', icon: 'wrench', count: () => S.getState().workOrders.filter((w) => w.status !== 'Completed').length },
    { id: 'advisories', label: 'Advisories', icon: 'megaphone' },
  ] },
  { group: 'Infrastructure', items: [
    { id: 'assets', label: 'Assets', icon: 'database' },
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
  // Maintenance now lives inside Work Orders; keep old links working.
  if (area === 'p' && page === 'maintenance') return setWoFilter('maintenance'), go('#/p/work-orders');
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
  renderShell(area, pg, html);
  view.mount?.(document.getElementById('view'), params);
  window.scrollTo(0, scroll || 0);
  if (!rerendering && measureCharts()) {
    rerendering = true;
    render();
    rerendering = false;
  }
  if (!sameView) {
    document.title = `${view.title || 'SAMAR-AGOS'} | SAMAR-AGOS`;
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
  document.title = 'Sign in | SAMAR-AGOS';
  app.innerHTML = `<div class="login">${brandPanel()}
    <section class="login-panel">
      <div class="login-box">
        <div class="login-mobile-logo">${brandMark(54)}</div>
        <h2>Sign in to SAMAR-AGOS</h2>
        <p class="muted">Choose a demo account to continue.</p>
        <div class="role-cards">
          <button class="role-card" data-action="login" data-role="resident">
            <span class="role-ic">${icon('home', 22)}</span>
            <span class="role-txt"><strong>Resident</strong><span>${esc(RESIDENT.name)}, ${esc(RESIDENT.address)}</span><em>Check service status, report problems, track repairs</em></span>
            ${icon('chev-r', 20)}
          </button>
          <button class="role-card" data-action="login" data-role="provider">
            <span class="role-ic role-ic--navy">${icon('activity', 22)}</span>
            <span class="role-txt"><strong>Water Provider / Operator</strong><span>${esc(PROVIDER_USER.name)}, ${esc(UTILITY.name)}</span><em>Monitor operations, investigate incidents, dispatch crews</em></span>
            ${icon('chev-r', 20)}
          </button>
        </div>
        <div class="demo-note">${icon('info', 16)}<span><strong>Offline mode — no database connected.</strong> Reference data comes from Catbalogan Water District’s published figures; live readings are simulated.</span></div>
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
  // Loading screens show only the logo and a progress bar; the message is kept for screen readers.
  app.innerHTML = `<div class="splash" role="status">${logoMark(52)}<span class="splash-bar" aria-hidden="true"></span><span class="sr-only">${esc(msg)}</span></div>`;
}

function renderAuth() {
  current = null;
  const signup = authMode === 'signup';
  document.title = `${signup ? 'Create account' : 'Sign in'} | SAMAR-AGOS`;
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
// Staff settings omit barangay and address; only fields present on the form are read.
const readProfileFields = () => {
  const v = (id) => document.getElementById(id)?.value;
  const d = { name: (v('pf-name') || '').trim(), phone: (v('pf-phone') || '').trim() };
  if (v('pf-brgy') != null) d.barangay = v('pf-brgy');
  if (v('pf-addr') != null) d.address = v('pf-addr').trim();
  return d;
};

function renderOnboarding() {
  current = null;
  const ses = B.getSession();
  document.title = 'Set up your profile | SAMAR-AGOS';
  app.innerHTML = `<div class="login">${brandPanel()}
    <section class="login-panel"><div class="login-box">
      <h2>Set up your profile</h2>
      <p class="muted">Signed in as ${esc(ses.email)}. Your barangay tells us which advisories and service updates apply to you.</p>
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
    account: '—',
    meter: '—',
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
  S.setRemote({ flush: B.flush, allocIds: B.allocIds, getSession: B.getSession, setNotifState: B.setNotifState, reset: B.resetRemote, remove: B.removeDoc });
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

// Account settings: profile, sign-in email and password in one dialog.
let acctTab = 'profile';
function accountSettingsBody() {
  const ses = B.getSession();
  const staff = !!ses?.isProvider && role === 'provider';
  const p = ses?.profile || {};
  const tab = (id, label) => `<button class="${acctTab === id ? 'is-on' : ''}" data-action="acct-tab" data-id="${id}" aria-pressed="${acctTab === id}">${label}</button>`;
  const pwField = (id, label, hint = '') => field(label, `<div class="auth-pw"><input type="password" id="${id}" autocomplete="${id.endsWith('cur') ? 'current-password' : 'new-password'}"/><button type="button" class="auth-show" data-action="auth-showpw" data-for="${id}" aria-pressed="false">Show</button></div>`, { id, req: true, hint });
  const google = `<div class="as-note">${icon('info', 16)}<span>You sign in with Google, so your email and password are managed in your Google account.</span></div>`;
  let body = '';
  if (acctTab === 'profile')
    body = `<form class="form" id="pe-form" onsubmit="return false">${
      staff
        ? `${field('Full name', `<input id="pf-name" value="${esc(p.name || '')}" autocomplete="name" required/>`, { id: 'pf-name', req: true })}
           ${field('Mobile number', `<input id="pf-phone" type="tel" value="${esc(p.phone || '')}" placeholder="+63 9xx xxx xxxx" autocomplete="tel"/>`, { id: 'pf-phone', optional: true })}`
        : profileFields(p)
    }<div class="as-a"><button class="btn btn--primary btn--sm" data-action="profile-save">Save profile</button></div></form>`;
  else if (acctTab === 'email')
    body = !B.usesPassword()
      ? google
      : `<form class="form" id="ae-form" onsubmit="return false">
        ${field('Current email', `<input value="${esc(ses.email)}" disabled/>`, {})}
        ${field('New email', `<input type="email" id="ae-new" autocomplete="email"/>`, { id: 'ae-new', req: true, hint: 'We send a confirmation link to the new address. Your email changes after you open it.' })}
        ${pwField('ae-cur', 'Current password')}
        <div class="auth-err" role="alert" hidden></div>
        <div class="as-a"><button class="btn btn--primary btn--sm" data-action="acct-email">Send confirmation link</button></div></form>`;
  else
    body = !B.usesPassword()
      ? google
      : `<form class="form" id="ap-form" onsubmit="return false">
        ${pwField('ap-cur', 'Current password')}
        ${pwField('ap-new', 'New password', 'At least 8 characters.')}
        ${pwField('ap-new2', 'Confirm new password')}
        <div class="auth-err" role="alert" hidden></div>
        <div class="as-a"><button class="btn btn--primary btn--sm" data-action="acct-password">Change password</button></div></form>`;
  return `<div class="as-tabs" role="group" aria-label="Settings section">${tab('profile', 'Profile')}${tab('email', 'Email')}${tab('password', 'Password')}</div><div class="as-b">${body}</div>`;
}
function openAccountSettings() {
  if (!B.FB_ENABLED) return showToast({ msg: 'Account settings are available when signed in to the SAMAR-AGOS database.', kind: 'info' });
  acctTab = 'profile';
  openModal('Account settings', `<div id="as-body">${accountSettingsBody()}</div>`);
}
const paintAccountSettings = () => {
  const b = document.getElementById('as-body');
  if (b) b.innerHTML = accountSettingsBody();
};
function acctError(formId, e) {
  const box = document.querySelector(`#${formId} .auth-err`);
  const msg = ['auth/invalid-credential', 'auth/wrong-password'].includes(e?.code) ? 'Your current password is incorrect.' : e?.code ? B.authMessage(e) : e?.message || 'Something went wrong.';
  if (box) (box.hidden = false), (box.innerHTML = `${icon('alert', 15)}<span>${esc(msg)}</span>`);
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

// ---------------------------------------------------------------- app shell (shared by both portals)
// Residents and staff get the same sidebar + top bar; only the nav, status pill and menu differ.
function renderShell(area, page, html) {
  const s = S.getState();
  const res = area === 'r';
  const aud = res ? 'resident' : 'provider';
  const unread = s.notifications.filter((n) => n.audience === aud && n.state === 'unread').length;
  const home = res ? '#/r/home' : '#/p/overview';
  app.innerHTML = `<div class="pv">
    <a class="skip" href="#view">Skip to content</a>
    <aside class="sb" id="sidebar" aria-label="${res ? 'Resident' : 'Provider'} navigation">
      <div class="sb-top">
        <a href="${home}" class="sb-logo" aria-label="SAMAR-AGOS ${res ? 'home' : 'overview'}">${logoMark(36)}<span class="sb-brand"><strong>SAMAR-AGOS</strong><span>${res ? 'Resident Portal' : 'Water Operations'}</span></span></a>
        <div class="sb-scene">${cityScene()}</div>
      </div>
      <nav class="sb-nav">
        ${(res ? RES_NAV : PRO_NAV).map((g) => `<div class="sb-group"><div class="sb-gl">${g.group}</div>${g.items.map((n) => {
          const c = n.count ? n.count() : null;
          const on = page === n.id || (res && page === 'report' && n.id === 'reports'); // the report form belongs to My Reports
          return `<a href="#/${area}/${n.id}" class="sb-a ${on ? 'is-active' : ''}" ${on ? 'aria-current="page"' : ''}>${icon(n.icon, 17)}<span>${n.label}</span>${c ? `<span class="sb-n">${c}</span>` : ''}</a>`;
        }).join('')}</div>`).join('')}
      </nav>
    </aside>
    <div class="sb-scrim" data-action="sb-close"></div>
    <div class="pv-main">
      <header class="tb">
        <button class="icon-btn tb-menu" data-action="sb-open" aria-label="Open navigation">${icon('menu', 20)}</button>
        <div class="tb-mlogo">${logoMark(28)}</div>
        <div class="tb-right">
          <span id="tb-status">${headerStatus()}</span>
          <span class="tb-div" aria-hidden="true"></span>
          ${!res && isDemoMode() ? `<button class="btn btn--sm btn--outline tb-demo" data-action="demo-panel">${icon('play', 14)}<span>Demo scenarios</span></button>` : ''}
          <button type="button" class="icon-btn bell" data-action="notif-panel" data-aud="${aud}" aria-haspopup="dialog" aria-label="Notifications, ${unread} unread">${icon('bell', 20)}<span class="bell-n" id="bell-n" ${unread ? '' : 'hidden'}>${unread}</span></button>
          ${accountMenu(res)}
        </div>
      </header>
      <main id="view" class="pv-content ${res ? 'pv-content--res' : ''} scroll-root" tabindex="-1">${html}</main>
    </div>
  </div>`;
}

// Demo tools (scenarios, Safe/Not safe switch) are hidden unless demo mode is on for this browser.
const DEMO_KEY = 'samaragos.demoMode';
export function isDemoMode() {
  try {
    return localStorage.getItem(DEMO_KEY) === '1';
  } catch (e) {
    return false;
  }
}
function setDemoMode(on) {
  try {
    on ? localStorage.setItem(DEMO_KEY, '1') : localStorage.removeItem(DEMO_KEY);
  } catch (e) {
    /* ignore */
  }
}

function accountMenu(res) {
  const user = res ? RESIDENT : PROVIDER_USER;
  const email = B.FB_ENABLED ? B.getSession()?.email : '';
  const av = `<span class="avatar ${res ? '' : 'avatar--navy'}">${user.initials}</span>`;
  return `<details class="acct">
    <summary class="acct-btn" aria-label="Account menu for ${esc(user.name)}"><span class="acct-id"><strong>${esc(user.name)}</strong></span>${icon('chev-d', 14)}</summary>
    <div class="acct-menu">
      <div class="acct-head">${av}<span><strong>${esc(user.name)}</strong>${email || res ? `<span>${esc(email || user.address)}</span>` : ''}</span></div>
      <button data-action="account-settings">${icon('user', 16)}<span>Account settings</span></button>
      ${!res ? `<button data-action="demo-toggle" aria-pressed="${isDemoMode()}">${icon('play', 16)}<span>Demo mode: ${isDemoMode() ? 'On' : 'Off'}</span></button>` : ''}
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

// Top-bar status: a small label over a dot + word (no pill), linking to the overview.
function headerStatus() {
  const cell = (href, k, sev, v, title) => `<a href="${href}" class="tb-sys tb-sys--${SEV[sev]?.cls || 'off'}" title="${esc(title)}"><span class="tb-sys-k">${esc(k)}</span><span class="tb-sys-v">${esc(v)}</span></a>`;
  if (current?.area === 'r') {
    const r = S.residentService();
    const label = r.label.charAt(0) + r.label.slice(1).toLowerCase();
    return cell('#/r/home', `Brgy. ${RESIDENT.barangay}`, r.sev, label, 'Water service in your area');
  }
  const o = S.overallStatus();
  const label = { normal: 'Normal', warning: 'Warning', critical: 'Critical', offline: 'Data unavailable' }[o.sev];
  return cell('#/p/overview', 'System status', o.sev, label, 'Overall water system status');
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
  'account-settings': () => openAccountSettings(),
  'acct-tab': (el) => ((acctTab = el.dataset.id), paintAccountSettings()),
  'acct-email': (el) =>
    busy(el, async () => {
      const next = document.getElementById('ae-new').value.trim();
      const pw = document.getElementById('ae-cur').value;
      try {
        if (!/^\S+@\S+\.\S+$/.test(next)) throw new Error('Enter a valid new email address.');
        if (next.toLowerCase() === B.getSession().email) throw new Error('That is already your email.');
        await B.changeEmail(next, pw);
        closeOverlay();
        showToast({ msg: `Confirmation link sent to ${next}. Open it to finish changing your email.`, kind: 'success' });
      } catch (e) {
        acctError('ae-form', e);
      }
    }),
  'acct-password': (el) =>
    busy(el, async () => {
      const cur = document.getElementById('ap-cur').value;
      const next = document.getElementById('ap-new').value;
      try {
        if (next.length < 8) throw new Error('Use a new password with at least 8 characters.');
        if (next !== document.getElementById('ap-new2').value) throw new Error('The new passwords do not match.');
        if (next === cur) throw new Error('Choose a password different from your current one.');
        await B.changePassword(cur, next);
        closeOverlay();
        showToast({ msg: 'Password changed', kind: 'success' });
      } catch (e) {
        acctError('ap-form', e);
      }
    }),
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
  'demo-panel': () => openDemoPanel(),
  'demo-toggle': () => {
    setDemoMode(!isDemoMode());
    render();
  },
  'apply-scenario': (el) =>
    busy(el, async () => {
      await S.applyScenario(el.dataset.id);
      openDemoPanel();
    }),
  'reset-demo': async () => {
    const ok = await confirmDialog({
      title: 'Reset demo scenarios?',
      body: B.FB_ENABLED
        ? 'Restores normal operations and removes simulated (demo) reports. Real reports, incidents, work orders and advisories are kept.'
        : 'Clears everything recorded in this offline session and restores normal operations.',
      confirm: 'Reset',
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
    if (el.closest('.modal--notif')) closeOverlay();
    if (el.dataset.link) location.hash = el.dataset.link;
  },
  'notif-read': (el) => (S.setNotification(el.dataset.id, el.dataset.to), refreshNotifPanel()),
  'notif-archive': (el) => (S.setNotification(el.dataset.id, 'archived'), refreshNotifPanel()),
  'notif-allread': (el) => (S.markAllRead(el.dataset.aud), refreshNotifPanel()),
  'notif-panel': (el) => openNotifPanel(el.dataset.aud),
  'notif-ptab': (el) => ((panelTab = el.dataset.id), refreshNotifPanel()),
  'notif-tab': (el) => {
    notifTab = el.dataset.id;
    render();
  },
});

// ---------------------------------------------------------------- demo control panel
function openDemoPanel() {
  const s = S.getState();
  const act = new Set(s.activeScenarios);
  openDrawer(
    'Demo scenarios',
    `
    <h3 class="sec-t">Trigger a system scenario</h3>
    <div class="scn-list">${Object.entries(SCENARIOS)
      .map(
        ([k, v]) => `<div class="scn ${act.has(k) ? 'is-on' : ''}"><div><strong>${v.label}</strong>${act.has(k) ? ' ' + status('warning', 'Active') : ''}<p>${v.desc}</p></div><button class="btn btn--sm ${k === 'normal' ? 'btn--outline' : 'btn--primary'}" data-action="apply-scenario" data-id="${k}">${k === 'normal' ? 'Restore normal' : 'Apply'}</button></div>`
      )
      .join('')}</div>
    <button class="btn btn--danger-ghost" data-action="reset-demo">Reset demo scenarios</button>`,
    { sub: 'Simulated readings, not live control' }
  );
}

// ---------------------------------------------------------------- notifications modal (bell)
let panelTab = 'unread';
let panelAud = null;
// Plain category label shown above each notification (e.g. "Distribution", "Advisory").
const notifKind = (n) => {
  const k = String(n.kind || '');
  return { advisory: 'Advisory', restored: 'Service restored', water: 'Water service', report: 'Your report', reading: 'Reading' }[k] || k.charAt(0).toUpperCase() + k.slice(1);
};

function notifPanelBody(aud) {
  const all = S.getState()
    .notifications.filter((n) => n.audience === aud && n.state !== 'archived')
    .sort((a, b) => b.at - a.at);
  const unread = all.filter((n) => n.state === 'unread');
  const read = all.filter((n) => n.state === 'read');
  const list = panelTab === 'read' ? read : unread;
  const tab = (id, label, n) => `<button role="tab" aria-selected="${panelTab === id}" class="${panelTab === id ? 'is-on' : ''}" data-action="notif-ptab" data-id="${id}">${label}<span>${n}</span></button>`;
  return `<div class="np-tabs" role="tablist">${tab('unread', 'Unread', unread.length)}${tab('read', 'Read', read.length)}</div>
    <div class="np-list">${
      list.length
        ? list
            .map(
              (n) => `<article class="np ${n.state === 'unread' ? 'is-unread' : ''}">
          <div class="np-m"><span>${esc(n.kind ? notifKind(n) : 'Update')}</span><span class="np-time">${relTime(n.at)}</span></div>
          <div class="np-c" role="button" tabindex="0" data-action="notif-open" data-id="${n.id}" data-link="${esc(n.link || '')}">
            <div class="np-t">${esc(n.title)}${n.state === 'unread' ? '<span class="sr-only"> (unread)</span>' : ''}</div>
            ${n.body ? `<div class="np-b">${esc(n.body)}</div>` : ''}
          </div>
          <button class="np-x" data-action="notif-read" data-id="${n.id}" data-to="${n.state === 'unread' ? 'read' : 'unread'}">${n.state === 'unread' ? 'Mark as read' : 'Mark as unread'}</button>
        </article>`
            )
            .join('')
        : `<div class="np-empty"><strong>${panelTab === 'unread' ? 'You’re all caught up' : 'No read notifications'}</strong><span>${panelTab === 'unread' ? 'New alerts and updates will appear here.' : 'Notifications you open or mark as read appear here.'}</span></div>`
    }</div>`;
}

function openNotifPanel(aud) {
  panelAud = aud;
  panelSig = '';
  panelTab = S.getState().notifications.some((n) => n.audience === aud && n.state === 'unread') ? 'unread' : 'read';
  openModal('Notifications', notifPanelBody(aud), {
    footer: `<button class="btn btn--outline btn--sm" data-action="notif-allread" data-aud="${aud}">Mark all as read</button>`,
    onMount: (m) => {
      m.classList.add('modal--notif');
      m.parentElement.classList.add('ov--notif');
    },
  });
}

// Re-render the open panel (after read/unread changes or when new alerts arrive).
let panelSig = '';
function refreshNotifPanel() {
  const b = document.querySelector('.modal--notif .modal-b');
  if (!b || !panelAud) return;
  // Only redraw when something changed, so focus and hover aren't lost on every telemetry tick.
  const sig = panelTab + S.getState().notifications.filter((n) => n.audience === panelAud).map((n) => n.id + n.state).join();
  if (sig === panelSig && b.innerHTML) return;
  panelSig = sig;
  const y = b.scrollTop;
  b.innerHTML = notifPanelBody(panelAud);
  b.scrollTop = y;
}
S.on('change', refreshNotifPanel);
S.on('tick', refreshNotifPanel);

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
        <div class="nt-c" role="button" tabindex="0" data-action="notif-open" data-id="${n.id}" data-link="${esc(n.link || '')}"><div class="nt-t">${esc(n.title)} ${n.state === 'unread' ? '<span class="sr-only">(unread)</span><span class="nt-dot" aria-hidden="true"></span>' : ''}</div><div class="nt-b">${esc(n.body)}</div><div class="nt-time">${fmtDateTime(n.at)}, ${relTime(n.at)}</div></div>
        <div class="nt-a">${n.state !== 'archived' ? `<button class="btn btn--ghost btn--xs" data-action="notif-read" data-id="${n.id}" data-to="${n.state === 'unread' ? 'read' : 'unread'}">${n.state === 'unread' ? 'Mark read' : 'Mark unread'}</button><button class="btn btn--ghost btn--xs" data-action="notif-archive" data-id="${n.id}">${icon('archive', 14)} Archive</button>` : `<button class="btn btn--ghost btn--xs" data-action="notif-read" data-id="${n.id}" data-to="read">Restore</button>`}</div></article>`
            )
            .join('')
        : empty(notifTab === 'unread' ? 'You are all caught up' : 'No notifications here', '', 'bell')
    }</div>`;
}

boot();
