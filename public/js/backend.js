// Firebase backend: Authentication + Cloud Firestore.
//
// The store keeps working on an in-memory state object. This adapter
//  - streams shared collections from Firestore into that state (onSnapshot), and
//  - writes back only documents that changed since they were last synced (flush on commit).
// Telemetry stays a per-device simulation driven by the shared system/control document.
import { FIREBASE_CONFIG, ADVISORY_EMAIL_URL } from './firebase-config.js';
import * as S from './store.js';
import { LOCAL_MODE } from './util.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
export const FB_ENABLED = !!FIREBASE_CONFIG.apiKey && !LOCAL_MODE;

export const COLLS = ['reports', 'incidents', 'workOrders', 'advisories', 'notifications', 'altWater', 'emergencyTanks', 'assets'];
const SEED_COUNTERS = { report: 1, incident: 1, wo: 1, adv: 1 };

let F = null; // SDK functions
let A = null; // firebase-app module (a second app instance creates responder accounts)
let auth = null;
let db = null;
let session = null; // { uid, email, profile, isProvider }
let ready = false;
let unsubs = [];
const synced = Object.fromEntries(COLLS.map((c) => [c, new Map()]));
let syncedControl = null;
let syncedPublic = null;

// ---------------------------------------------------------------- sync status (for the field app)
// "pending" counts batches the server has not confirmed yet; Firestore keeps them queued while offline.
let pending = 0;
let lastSyncedAt = 0;
const syncSubs = new Set();
const emitSync = () => syncSubs.forEach((fn) => fn(syncState()));
export const onSync = (fn) => (syncSubs.add(fn), () => syncSubs.delete(fn));
export const syncState = () => ({ enabled: FB_ENABLED, online: typeof navigator === 'undefined' || navigator.onLine, pending, lastSyncedAt });
if (typeof window !== 'undefined') ['online', 'offline'].forEach((e) => window.addEventListener(e, emitSync));

// ---------------------------------------------------------------- init
export async function initBackend() {
  const [app, a, fs] = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`)]);
  F = { ...a, ...fs };
  A = app;
  const fbApp = app.initializeApp(FIREBASE_CONFIG);
  auth = a.getAuth(fbApp);
  db = fs.getFirestore(fbApp);
  S.onAdvisoryChange(pingAdvisoryEmail);
}

// Ask the email script to check now instead of waiting for its 5-minute timer (advisories and
// responder credentials). Delayed so the change has reached Firestore; the script decides what to send.
function pingAdvisoryEmail(delay = 6000) {
  if (!ADVISORY_EMAIL_URL || !session?.isProvider) return;
  setTimeout(() => fetch(ADVISORY_EMAIL_URL, { mode: 'no-cors' }).catch(() => {}), delay);
}

// ---------------------------------------------------------------- writes
// Every write goes through a transaction. A transaction commits with one ordinary HTTPS request,
// while setDoc/writeBatch use Firestore's streaming channel, which ad and tracker blockers often
// block (net::ERR_BLOCKED_BY_CLIENT), leaving the write pending forever.
const commitOps = (ops, store = db) => F.runTransaction(store, async (tx) => ops.forEach((op) => op(tx)));
const setDoc = (ref, data, opts) => commitOps([(t) => (opts ? t.set(ref, data, opts) : t.set(ref, data))], ref.firestore);
const updateDoc = (ref, data) => commitOps([(t) => t.update(ref, data)], ref.firestore);
const deleteDoc = (ref) => commitOps([(t) => t.delete(ref)], ref.firestore);

// ---------------------------------------------------------------- auth
export const onAuth = (cb) => F.onAuthStateChanged(auth, cb);
export const signIn = (email, pw) => F.signInWithEmailAndPassword(auth, email.trim(), pw);
export const signUp = (email, pw) => F.createUserWithEmailAndPassword(auth, email.trim(), pw);
export const signInGoogle = () => F.signInWithPopup(auth, new F.GoogleAuthProvider());
export const resetPassword = (email) => F.sendPasswordResetEmail(auth, email.trim());
export async function signOutUser() {
  stopSync();
  await F.signOut(auth);
}
export const getSession = () => session;

const AUTH_ERRORS = {
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/user-not-found': 'No account found with that email.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/email-already-in-use': 'An account with this email already exists. Sign in instead.',
  'auth/weak-password': 'Use a password with at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
  'auth/network-request-failed': 'Network error. Check your connection.',
  'auth/operation-not-allowed': 'This sign-in method is not enabled for this Firebase project yet.',
  'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
  'auth/cancelled-popup-request': 'Google sign-in was cancelled.',
  'auth/popup-blocked': 'The Google sign-in window was blocked. Allow pop-ups for this site and try again.',
  'auth/account-exists-with-different-credential': 'This email already uses password sign-in. Sign in with your email and password.',
  'auth/unauthorized-domain': 'This site’s domain is not authorized for Google sign-in in Firebase.',
  'auth/requires-recent-login': 'For security, sign out and sign in again, then retry.',
  'auth/missing-password': 'Enter your current password.',
  'auth/configuration-not-found': 'Firebase Authentication is not set up for this project yet (enable Email/Password in the console).',
};
export const authMessage = (e) => AUTH_ERRORS[e?.code] || e?.message || 'Something went wrong.';

// ---------------------------------------------------------------- profile & staff access
export async function loadSession(user) {
  const [prof, access] = await Promise.all([F.getDoc(F.doc(db, 'users', user.uid)), F.getDoc(F.doc(db, 'config', 'access'))]);
  const emails = access.exists() ? access.data().providerEmails || [] : [];
  const responders = access.exists() ? access.data().responderEmails || [] : [];
  const email = (user.email || '').toLowerCase();
  session = {
    uid: user.uid,
    email,
    profile: prof.exists() ? prof.data() : null,
    isProvider: emails.includes(email),
    isResponder: !emails.includes(email) && responders.includes(email),
    accessExists: access.exists(),
  };
  return session;
}

export async function saveProfile(data) {
  const profile = { ...(session.profile || {}), ...data, email: session.email, updatedAt: Date.now() };
  if (!session.profile) profile.createdAt = Date.now();
  await setDoc(F.doc(db, 'users', session.uid), profile, { merge: true });
  session.profile = profile;
  return profile;
}

// ---------------------------------------------------------------- sign-in settings
// Email and password changes need the current password (Firebase requires a recent sign-in).
export const usesPassword = () => !!auth?.currentUser?.providerData.some((p) => p.providerId === 'password');
async function reauth(password) {
  const u = auth.currentUser;
  await F.reauthenticateWithCredential(u, F.EmailAuthProvider.credential(u.email, password));
}
// Sends a confirmation link to the new address; the email changes once the link is opened.
// Staff keep console access: the new address is added to the staff list first.
export async function changeEmail(newEmail, password) {
  const next = newEmail.trim().toLowerCase();
  await reauth(password);
  if (session.isProvider) await updateDoc(F.doc(db, 'config', 'access'), { providerEmails: F.arrayUnion(next), updatedAt: Date.now() });
  await F.verifyBeforeUpdateEmail(auth.currentUser, next);
}
export async function changePassword(current, next) {
  await reauth(current);
  await F.updatePassword(auth.currentUser, next);
}

// ---------------------------------------------------------------- valid ID
// The ID photo lives in its own document (validIds/{uid}) so lists of users stay small.
// Reporting requires that document (enforced in firestore.rules), so a profile flag alone is not enough.
export async function saveValidId(image) {
  await setDoc(F.doc(db, 'validIds', session.uid), { uid: session.uid, image, uploadedAt: Date.now() });
  await saveProfile({ idSubmitted: true, idUploadedAt: Date.now() });
}
export async function getValidId(uid) {
  const d = await F.getDoc(F.doc(db, 'validIds', uid));
  return d.exists() ? d.data() : null;
}
// First user of a fresh project becomes staff administrator.
export async function claimProviderAccess() {
  await setDoc(F.doc(db, 'config', 'access'), { providerEmails: [session.email], createdBy: session.uid, createdAt: Date.now() });
  session.isProvider = true;
  session.accessExists = true;
}

export async function getProviderEmails() {
  const d = await F.getDoc(F.doc(db, 'config', 'access'));
  return d.exists() ? d.data().providerEmails || [] : [];
}
export async function setProviderEmails(list) {
  const clean = [...new Set(list.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  await updateDoc(F.doc(db, 'config', 'access'), { providerEmails: clean, updatedAt: Date.now() });
  return clean;
}

// ---------------------------------------------------------------- responders (staff)
// Staff add a responder by name and contact email. SAMAR-AGOS generates a sign-in email and a
// temporary password, creates the account and lists it in config/access.responderEmails. The email
// script sends the credentials to the contact email, then removes the password from Firestore.
export const RESPONDER_DOMAIN = 'responders.samar-agos.app';
const slug = (name) =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/).filter(Boolean);
export function loginEmailFor(name, taken) {
  const w = slug(name);
  const base = w.length > 1 ? `${w[0]}.${w[w.length - 1]}` : w[0] || 'responder';
  for (let n = 1; ; n++) {
    const e = `${base}${n > 1 ? n : ''}@${RESPONDER_DOMAIN}`;
    if (!taken.includes(e)) return e;
  }
}
export function tempPassword() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(r, (x) => abc[x % abc.length]).join('');
}
export async function createResponder({ name, contactEmail, phone }) {
  const access = await F.getDoc(F.doc(db, 'config', 'access'));
  const taken = access.data()?.responderEmails || [];
  const loginEmail = loginEmailFor(name, taken);
  const password = tempPassword();
  // A second app instance signs in as the new account, so the staff member stays signed in.
  const tmp = A.initializeApp(FIREBASE_CONFIG, `responder-${Date.now()}`);
  try {
    const tAuth = F.getAuth(tmp);
    const cred = await F.createUserWithEmailAndPassword(tAuth, loginEmail, password);
    const uid = cred.user.uid;
    const now = Date.now();
    await setDoc(F.doc(F.getFirestore(tmp), 'users', uid), { name, phone: phone || '', email: loginEmail, contactEmail, role: 'responder', mustChangePassword: true, createdAt: now, updatedAt: now });
    await F.signOut(tAuth);
    await updateDoc(F.doc(db, 'config', 'access'), { responderEmails: F.arrayUnion(loginEmail), updatedAt: now });
    const doc = { uid, name, loginEmail, contactEmail, phone: phone || '', tempPassword: password, credSent: false, createdAt: now, createdBy: session.email };
    await setDoc(F.doc(db, 'responders', uid), doc);
    pingAdvisoryEmail(2500);
    return { ...doc, id: uid };
  } finally {
    A.deleteApp(tmp).catch(() => {});
  }
}
// Removing a responder ends their access at once (rules and app both check the list).
export async function removeResponder(r) {
  await updateDoc(F.doc(db, 'config', 'access'), { responderEmails: F.arrayRemove(r.loginEmail), updatedAt: Date.now() });
  await deleteDoc(F.doc(db, 'responders', r.id));
}
// First sign-in of a responder: replace the temporary password (no re-entry needed right after sign-in).
export async function setNewPassword(next) {
  await F.updatePassword(auth.currentUser, next);
  await saveProfile({ mustChangePassword: false });
}

// ---------------------------------------------------------------- households & meter readings (staff)
// Households are resident accounts registered in a barangay (staff accounts excluded).
export async function listHouseholds(barangay) {
  const [snap, staff] = await Promise.all([F.getDocs(F.query(F.collection(db, 'users'), F.where('barangay', '==', barangay))), getProviderEmails()]);
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((u) => !staff.includes((u.email || '').toLowerCase()));
}
// One reading per household per month (doc id uid_YYYY-MM), so re-recording a month replaces it.
export async function listReadings(barangay) {
  const snap = await F.getDocs(F.query(F.collection(db, 'meterReadings'), F.where('barangay', '==', barangay)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
// A resident's own readings (the rules allow reading only documents with their uid).
export async function myReadings() {
  const snap = await F.getDocs(F.query(F.collection(db, 'meterReadings'), F.where('uid', '==', session.uid)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export async function saveReading({ uid, barangay, month, m3 }) {
  const doc = { uid, barangay, month, m3, recordedAt: Date.now(), recordedBy: session.email };
  await setDoc(F.doc(db, 'meterReadings', `${uid}_${month}`), doc);
  return { id: `${uid}_${month}`, ...doc };
}

export async function setNotifState(id, state) {
  await setDoc(F.doc(db, 'users', session.uid), { notifState: { [id]: state } }, { merge: true });
  session.profile = session.profile || {};
  session.profile.notifState = { ...(session.profile.notifState || {}), [id]: state };
}

// ---------------------------------------------------------------- ticket numbers
const YR = () => new Date().getFullYear();
const FORMAT = {
  report: (n) => `WR-${YR()}-${String(n).padStart(4, '0')}`,
  incident: (n) => `INC-${YR()}-${String(n).padStart(3, '0')}`,
  wo: (n) => `WO-${YR()}-${String(n).padStart(4, '0')}`,
  adv: (n) => `ADV-${YR()}-${String(n).padStart(3, '0')}`,
};
export async function allocIds(kind, count = 1) {
  const ref = F.doc(db, 'counters', 'ids');
  const start = await F.runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists() && snap.data()[kind] != null ? snap.data()[kind] : SEED_COUNTERS[kind];
    tx.set(ref, { [kind]: cur + count }, { merge: true });
    return cur;
  });
  return Array.from({ length: count }, (_, i) => FORMAT[kind](start + i));
}

// ---------------------------------------------------------------- serialization
// Stable JSON (sorted keys) so local objects and Firestore documents compare equal.
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}
function clean(item) {
  const o = { ...item };
  delete o.mine;
  return JSON.parse(JSON.stringify(o));
}

function writable(coll, item) {
  if (!session) return false;
  if (coll === 'notifications') {
    if (item.local) return false;
    if (session.isProvider) return true;
    return item.uid === session.uid || (item.audience === 'provider' && !synced.notifications.has(item.id));
  }
  if (session.isResponder) {
    if (coll === 'workOrders') return item.responder === session.email;
    return coll === 'notifications' && item.uid === session.uid;
  }
  if (session.isProvider) {
    // the smart tank is simulated on each device; only its initial record is stored
    if (coll === 'emergencyTanks' && item.mode === 'SIMULATED') return !synced.emergencyTanks.has(item.id);
    return true;
  }
  return coll === 'reports' && item.reporterUid === session.uid;
}

function controlOf(s) {
  return { scenario: s.scenario, activeScenarios: s.activeScenarios, factors: s.factors, zoneIssues: s.zoneIssues, pumpsOffline: s.pumpsOffline, emergencyActive: !!s.emergency.active, volOverride: s.volOverride || null, wqMode: s.wq?.mode || 'safe', wqAt: s.wq?.at || 0, scenarioLog: (s.scenarioLog || []).slice(0, 20) };
}
function publicOf(s) {
  const pending = {};
  s.reports.filter((r) => r.status === 'submitted' && !r.incidentId).forEach((r) => (pending[r.zone] = (pending[r.zone] || 0) + 1));
  const latest = {};
  s.reports.forEach((r) => (latest[r.zone] = Math.max(latest[r.zone] || 0, r.submittedAt)));
  return { pending, latest };
}

// Write every changed document in one batch. Called from store.commit().
export function flush() {
  if (!ready || !session) return Promise.resolve();
  const s = S.getState();
  const ops = [];
  for (const coll of COLLS) {
    for (const item of s[coll]) {
      if (!item?.id || !writable(coll, item)) continue;
      const data = clean(item);
      const key = stable(data);
      if (synced[coll].get(item.id) === key) continue;
      synced[coll].set(item.id, key);
      ops.push({ coll, id: item.id, op: (t) => t.set(F.doc(db, coll, item.id), data) });
    }
  }
  if (session.isProvider) {
    const c = controlOf(s);
    const ck = stable(c);
    if (ck !== syncedControl) {
      syncedControl = ck;
      const doc = { ...JSON.parse(JSON.stringify(c)), updatedAt: Date.now(), updatedBy: session.email };
      ops.push({ op: (t) => t.set(F.doc(db, 'system', 'control'), doc) });
    }
    const p = publicOf(s);
    const pk = stable(p);
    if (pk !== syncedPublic) {
      syncedPublic = pk;
      ops.push({ op: (t) => t.set(F.doc(db, 'system', 'public'), { ...p, updatedAt: Date.now() }) });
    }
  }
  if (!ops.length) return Promise.resolve();
  const run = async () => {
    for (let i = 0; i < ops.length; i += 400) await commitOps(ops.slice(i, i + 400).map((o) => o.op));
  };
  pending++;
  emitSync();
  return run()
    .then(() => (lastSyncedAt = Date.now()))
    .catch((e) => {
      // forget what failed so the next change retries it
      ops.forEach((o) => o.coll && synced[o.coll].delete(o.id));
      syncedControl = null;
      syncedPublic = null;
      throw e;
    })
    .finally(() => {
      pending--;
      emitSync();
    });
}

// ---------------------------------------------------------------- live sync
export async function startSync() {
  stopSync();
  ready = false;
  S.clearShared();
  const uid = session.uid;
  const col = (c) => F.collection(db, c);
  const sources = [];
  const add = (key, ref, onData) => sources.push({ key, ref, onData });

  const remember = (coll, docs) => docs.forEach((d) => synced[coll].set(d.id, stable(clean(d))));
  const collectionHandler = (coll, part) => (docs) => {
    remember(coll, docs);
    S.applyRemote(coll, docs, part);
  };

  if (session.isProvider) {
    COLLS.filter((c) => c !== 'notifications').forEach((c) => add(c, col(c), collectionHandler(c)));
    add('notifications', F.query(col('notifications'), F.where('audience', '==', 'provider')), collectionHandler('notifications', 'provider'));
    add('responders', col('responders'), (docs) => S.setResponders(docs));
  } else if (session.isResponder) {
    // Responders see only the work orders assigned to them, plus the records those link to.
    add('workOrders', F.query(col('workOrders'), F.where('responder', '==', session.email)), collectionHandler('workOrders'));
    ['incidents', 'assets'].forEach((c) => add(c, col(c), collectionHandler(c)));
    add('notif-own', F.query(col('notifications'), F.where('uid', '==', uid)), collectionHandler('notifications', 'own'));
  } else {
    add('reports', F.query(col('reports'), F.where('reporterUid', '==', uid)), collectionHandler('reports'));
    ['incidents', 'workOrders', 'advisories', 'altWater', 'emergencyTanks', 'assets'].forEach((c) => add(c, col(c), collectionHandler(c)));
    add('notif-own', F.query(col('notifications'), F.where('uid', '==', uid)), collectionHandler('notifications', 'own'));
    add('notif-zone', F.query(col('notifications'), F.where('audience', '==', 'resident'), F.where('uid', '==', null)), collectionHandler('notifications', 'broadcast'));
    add('public', F.doc(db, 'system', 'public'), (d) => S.applyPublic(d));
  }
  add('control', F.doc(db, 'system', 'control'), (d) => {
    if (d) syncedControl = stable(JSON.parse(JSON.stringify({ scenario: d.scenario, activeScenarios: d.activeScenarios, factors: d.factors, zoneIssues: d.zoneIssues, pumpsOffline: d.pumpsOffline, emergencyActive: d.emergencyActive, volOverride: d.volOverride || null, scenarioLog: d.scenarioLog || [] })));
    S.applyControl(d);
  });

  let controlExists = true;
  await Promise.all(
    sources.map(
      (src) =>
        new Promise((resolve) => {
          let first = true;
          const unsub = F.onSnapshot(
            src.ref,
            (snap) => {
              if (snap.docs) src.onData(snap.docs.map((d) => ({ ...d.data(), id: d.id })));
              else {
                if (src.key === 'control' && !snap.exists()) controlExists = false;
                src.onData(snap.exists() ? snap.data() : null);
              }
              if (first) (first = false), resolve();
            },
            (err) => {
              console.error(`Firestore listener ${src.key}:`, err);
              S.toast(`Live updates unavailable for ${src.key} (${err.code})`, 'error');
              if (first) (first = false), resolve();
            }
          );
          unsubs.push(unsub);
        })
    )
  );
  // A fresh project has no data yet: the first staff member seeds the demo dataset.
  if (session.isProvider && !controlExists) await seedRemote();
  ready = true;
  if (session.isProvider) flush().catch((e) => console.error('Initial sync write failed', e));
}

export function stopSync() {
  unsubs.forEach((u) => u());
  unsubs = [];
  ready = false;
  COLLS.forEach((c) => synced[c].clear());
  syncedControl = null;
  syncedPublic = null;
}

// ---------------------------------------------------------------- seeding / reset (staff)
async function commitInChunks(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    await commitOps(ops.slice(i, i + 400));
  }
}

export async function removeDoc(coll, id) {
  if (!session?.isProvider) return;
  synced[coll]?.delete(id);
  await deleteDoc(F.doc(db, coll, id));
}

export async function seedRemote() {
  const s = S.buildSeedState();
  const ops = [];
  COLLS.forEach((coll) =>
    s[coll].forEach((item) => {
      const data = clean(item);
      ops.push((b) => b.set(F.doc(db, coll, item.id), data));
    })
  );
  ops.push((b) => b.set(F.doc(db, 'system', 'control'), { ...JSON.parse(JSON.stringify(controlOf(s))), updatedAt: Date.now(), updatedBy: session.email }));
  ops.push((b) => b.set(F.doc(db, 'system', 'public'), { ...publicOf(s), updatedAt: Date.now() }));
  ops.push((b) => b.set(F.doc(db, 'counters', 'ids'), { ...SEED_COUNTERS }));
  await commitInChunks(ops);
}

// Demo reset: removes only simulated (demo-scenario) reports and restores normal operations.
// Real records created by staff and residents are never deleted.
export async function resetRemote() {
  const ops = [];
  const snap = await F.getDocs(F.query(F.collection(db, 'reports'), F.where('simulated', '==', true)));
  snap.docs.forEach((d) => (ops.push((b) => b.delete(d.ref)), synced.reports.delete(d.id)));
  const s = S.buildSeedState();
  ops.push((b) => b.set(F.doc(db, 'system', 'control'), { ...JSON.parse(JSON.stringify(controlOf(s))), updatedAt: Date.now(), updatedBy: session.email }));
  await commitInChunks(ops);
}
