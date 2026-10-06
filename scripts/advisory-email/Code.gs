/**
 * SAMAR-AGOS advisory emails (Google Apps Script).
 *
 * Every few minutes this script reads service advisories from Firestore and emails the
 * residents of the affected barangays when an advisory is published, updated or resolved.
 * It also emails new field responders their sign-in email and temporary password, then
 * removes the password from Firestore.
 *
 * Setup (once): see scripts/advisory-email/README.md
 *   Script properties:
 *     SERVICE_ACCOUNT_JSON  full JSON key of a Firebase service account (required)
 *     APP_URL               link to the SAMAR-AGOS app shown in the email (optional)
 *     SENDER_NAME           display name of the sender (optional)
 *     REPLY_TO              reply-to address (optional)
 *   Then run setup() from the editor.
 */

const PROJECT_ID = 'samar-agos-ic9sb';
const UTILITY_NAME = 'Catbalogan Water District';
const TIME_ZONE = 'Asia/Manila';
const CHECK_EVERY_MINUTES = 5;
const MAX_AGE_HOURS = 24; // never email about changes older than this (e.g. after downtime)

// ---------------------------------------------------------------- entry points

/** Run once: records existing advisories as already sent and installs the timer. */
function setup() {
  const advisories = fetchAdvisories_();
  const state = {};
  advisories.forEach((a) => (state[a.id] = { updatedAt: a.updatedAt || 0, status: a.status }));
  saveState_(state);
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'checkAdvisories')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkAdvisories').timeBased().everyMinutes(CHECK_EVERY_MINUTES).create();
  Logger.log('Setup complete. %s existing advisories marked as sent. Checking every %s minutes.', advisories.length, CHECK_EVERY_MINUTES);
}

/** Timer handler: emails residents about new, updated and resolved advisories. */
function checkAdvisories() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const state = loadState_();
    const advisories = fetchAdvisories_();
    const cutoff = Date.now() - MAX_AGE_HOURS * 3600000;
    let staff = null;

    advisories.forEach((a) => {
      const seen = state[a.id];
      const changedAt = a.updatedAt || 0;
      let kind = null;
      if (!seen) kind = a.status === 'Resolved' ? null : 'new';
      else if (a.status === 'Resolved' && seen.status !== 'Resolved') kind = 'resolved';
      else if (a.status !== 'Resolved' && changedAt > seen.updatedAt) kind = 'update';

      if (kind && changedAt >= cutoff) {
        if (!staff) staff = fetchStaffEmails_();
        const recipients = fetchResidents_(a.barangays || [], staff);
        const sent = sendAdvisory_(a, kind, recipients);
        Logger.log('%s %s: emailed %s of %s residents', a.id, kind, sent, recipients.length);
        if (sent < recipients.length) return; // quota reached; retry the rest next run
      }
      state[a.id] = { updatedAt: changedAt, status: a.status };
    });
    saveState_(state);
    try {
      checkResponderInvites_();
    } catch (e) {
      Logger.log('Responder credentials: %s', e.message);
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * Web app endpoint. SAMAR-AGOS opens this URL right after staff publish, update or resolve an
 * advisory so residents are emailed immediately. It only runs the same check as the timer, so
 * calling it without a real change sends nothing.
 */
function doGet() {
  checkAdvisories();
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}
function doPost() {
  return doGet();
}

/** Sends a sample email for the latest advisory to yourself (no residents are emailed). */
function sendTestEmail() {
  const advisories = fetchAdvisories_().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!advisories.length) throw new Error('No advisories found in Firestore.');
  const me = Session.getEffectiveUser().getEmail();
  const a = advisories[0];
  const brgy = (a.barangays || [])[0] || 'your barangay';
  const mail = buildEmail_(a, a.status === 'Resolved' ? 'resolved' : 'new', { name: 'Test Recipient', barangay: brgy });
  MailApp.sendEmail({ to: me, subject: '[Test] ' + mail.subject, htmlBody: mail.html, body: mail.text, name: senderName_() });
  Logger.log('Test email for %s sent to %s', a.id, me);
}

/**
 * Troubleshooting: run from the editor and read the log. Lists every advisory, whether the
 * script would email it now and why not, and who would receive it. Sends nothing.
 */
function diagnose() {
  const log = (...a) => Logger.log(a.join(' '));
  const props = PropertiesService.getScriptProperties();
  log('SERVICE_ACCOUNT_JSON set:', !!props.getProperty('SERVICE_ACCOUNT_JSON'));
  log('Timer installed:', ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'checkAdvisories'));
  log('Emails left today:', MailApp.getRemainingDailyQuota());
  const advisories = fetchAdvisories_().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  log('Advisories in Firestore:', advisories.length);
  const staff = fetchStaffEmails_();
  log('Staff emails (never emailed):', staff.join(', ') || 'none');
  const state = loadState_();
  const cutoff = Date.now() - MAX_AGE_HOURS * 3600000;
  advisories.slice(0, 10).forEach((a) => {
    const seen = state[a.id];
    const changedAt = a.updatedAt || 0;
    let why;
    if (!seen) why = a.status === 'Resolved' ? 'not sent: already resolved when first seen' : 'WILL SEND as new';
    else if (a.status === 'Resolved' && seen.status !== 'Resolved') why = 'WILL SEND as resolved';
    else if (a.status !== 'Resolved' && changedAt > seen.updatedAt) why = 'WILL SEND as update';
    else why = 'not sent: already handled (or marked as sent by setup)';
    if (why.startsWith('WILL') && changedAt < cutoff) why = `not sent: last change older than ${MAX_AGE_HOURS} hours`;
    const recipients = fetchResidents_(a.barangays || [], staff);
    log(`\n${a.id} "${a.title}" status=${a.status} updated=${fmt_(changedAt)}`);
    log('  barangays:', (a.barangays || []).join(', ') || 'NONE (advisory has no barangays field)');
    log('  decision:', why);
    log(`  residents found: ${recipients.length}`, recipients.map((r) => `${r.email} (${r.barangay})`).join(', '));
  });
  const pending = listCollection_('responders').map(fromDoc_).filter((r) => !r.credSent);
  log(`\nResponders waiting for credentials: ${pending.length}`, pending.map((r) => `${r.name} -> ${r.contactEmail}`).join(', '));
  const users = listCollection_('users').map(fromDoc_);
  log(`\nAll accounts: ${users.length}`);
  users.forEach((u) => log(`  ${u.email || 'NO EMAIL'} barangay=${u.barangay || 'NONE'}${staff.indexOf(String(u.email || '').toLowerCase()) >= 0 ? ' (staff)' : ''}`));
}

/** Emails the newest active advisory to its residents now, even if it was already sent. */
function resendLatest() {
  const a = fetchAdvisories_()
    .filter((x) => x.status !== 'Resolved')
    .sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0))[0];
  if (!a) throw new Error('No active advisory found.');
  const recipients = fetchResidents_(a.barangays || [], fetchStaffEmails_());
  const sent = sendAdvisory_(a, 'new', recipients);
  Logger.log('%s: emailed %s of %s residents', a.id, sent, recipients.length);
}

// ---------------------------------------------------------------- email

function sendAdvisory_(a, kind, recipients) {
  const props = PropertiesService.getScriptProperties();
  const replyTo = props.getProperty('REPLY_TO');
  let sent = 0;
  for (const r of recipients) {
    if (MailApp.getRemainingDailyQuota() < 1) break;
    const mail = buildEmail_(a, kind, r);
    const opts = { to: r.email, subject: mail.subject, htmlBody: mail.html, body: mail.text, name: senderName_() };
    if (replyTo) opts.replyTo = replyTo;
    try {
      MailApp.sendEmail(opts);
      sent++;
    } catch (e) {
      Logger.log('Could not email %s: %s', r.email, e.message);
      sent++; // skip invalid addresses instead of retrying forever
    }
  }
  return sent;
}

function buildEmail_(a, kind, r) {
  const status = titleCase_(a.serviceStatus || (kind === 'resolved' ? 'Normal' : 'Service advisory'));
  const heading = { new: 'Service Advisory', update: 'Service Advisory Update', resolved: 'Service Restored' }[kind];
  const subject = kind === 'resolved' ? `Service restored: ${a.title}` : kind === 'update' ? `Advisory update: ${a.title}` : `Water service advisory: ${a.title}`;
  const appUrl = PropertiesService.getScriptProperties().getProperty('APP_URL');
  const areas = (a.barangays || []).join(', ') || 'Selected barangays';
  const intro =
    kind === 'resolved'
      ? `Water service has been restored in the areas covered by the advisory below. Thank you for your patience.`
      : kind === 'update'
        ? `${UTILITY_NAME} has updated the following service advisory for your area.`
        : `${UTILITY_NAME} has issued the following service advisory for your area.`;

  const rows = [
    ['Advisory number', a.id],
    ['Status', kind === 'resolved' ? 'Resolved' : status],
    ['Affected barangays', areas],
    ['Started', fmt_(a.startAt)],
  ];
  if (kind !== 'resolved') {
    if (a.etr) rows.push(['Estimated restoration', fmt_(a.etr)]);
    if (a.nextUpdate) rows.push(['Next update', fmt_(a.nextUpdate)]);
  } else rows.push(['Resolved', fmt_(a.updatedAt)]);

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const accent = kind === 'resolved' ? '#1f7a4d' : a.serviceStatus === 'NO WATER' ? '#b42318' : a.serviceStatus === 'QUALITY ADVISORY' ? '#1d5fa8' : '#b45309';
  const font = "font-family:Arial,Helvetica,sans-serif;";

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f3f5f8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f8;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #dfe4ea;border-radius:8px;${font}color:#1c2a3a;">
  <tr><td style="padding:20px 28px;border-bottom:1px solid #e6eaef;">
    <div style="font-size:15px;font-weight:bold;color:#0b2545;">${esc(UTILITY_NAME)}</div>
    <div style="font-size:12px;color:#6b7785;margin-top:2px;">SAMAR-AGOS Water Service Notice</div>
  </td></tr>
  <tr><td style="padding:24px 28px 8px;">
    <div style="font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${accent};">${esc(heading)}</div>
    <h1 style="margin:6px 0 14px;font-size:21px;line-height:1.3;color:#0b2545;">${esc(a.title)}</h1>
    <p style="margin:0 0 6px;font-size:14px;line-height:1.6;">Dear ${esc(r.name || 'Resident')},</p>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.6;">${esc(intro)}</p>
  </td></tr>
  <tr><td style="padding:0 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6eaef;border-radius:6px;font-size:13.5px;">
      ${rows
        .map(
          ([k, v], i) =>
            `<tr><td style="padding:10px 14px;width:42%;color:#6b7785;${i ? 'border-top:1px solid #eef1f4;' : ''}">${esc(k)}</td><td style="padding:10px 14px;font-weight:bold;color:#1c2a3a;${i ? 'border-top:1px solid #eef1f4;' : ''}">${esc(v)}</td></tr>`
        )
        .join('')}
    </table>
  </td></tr>
  ${
    a.message && kind !== 'resolved'
      ? `<tr><td style="padding:20px 28px 0;"><div style="font-size:13px;font-weight:bold;color:#0b2545;margin-bottom:6px;">Details</div><p style="margin:0;font-size:14px;line-height:1.6;">${esc(a.message)}</p></td></tr>`
      : ''
  }
  ${
    a.instructions && kind !== 'resolved'
      ? `<tr><td style="padding:18px 28px 0;"><div style="border-left:3px solid ${accent};background:#f7f9fb;padding:12px 16px;"><div style="font-size:13px;font-weight:bold;color:#0b2545;margin-bottom:4px;">What you should do</div><p style="margin:0;font-size:14px;line-height:1.6;">${esc(a.instructions)}</p></div></td></tr>`
      : ''
  }
  ${
    appUrl
      ? `<tr><td style="padding:22px 28px 0;"><a href="${esc(appUrl)}" style="display:inline-block;background:#0b2545;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:11px 20px;border-radius:6px;">View advisory in SAMAR-AGOS</a></td></tr>`
      : ''
  }
  <tr><td style="padding:24px 28px 22px;">
    <p style="margin:0;font-size:14px;line-height:1.6;">Thank you for your understanding.</p>
    <p style="margin:12px 0 0;font-size:14px;line-height:1.6;">Respectfully,<br><strong>${esc(UTILITY_NAME)}</strong></p>
  </td></tr>
  <tr><td style="padding:16px 28px;border-top:1px solid #e6eaef;background:#fafbfc;border-radius:0 0 8px 8px;font-size:11.5px;line-height:1.6;color:#7b8794;">
    You are receiving this email because your SAMAR-AGOS account is registered in Brgy. ${esc(r.barangay)}, an area covered by this advisory. To report a problem or check the latest status, sign in to SAMAR-AGOS. Please do not reply to this automated message unless a reply address is provided.
  </td></tr>
</table>
</td></tr></table></body></html>`;

  const text = [
    `${UTILITY_NAME}`,
    `${heading.toUpperCase()}: ${a.title}`,
    '',
    `Dear ${r.name || 'Resident'},`,
    '',
    intro,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(a.message && kind !== 'resolved' ? ['', 'Details:', a.message] : []),
    ...(a.instructions && kind !== 'resolved' ? ['', 'What you should do:', a.instructions] : []),
    ...(appUrl ? ['', `View the advisory: ${appUrl}`] : []),
    '',
    'Thank you for your understanding.',
    '',
    'Respectfully,',
    UTILITY_NAME,
    '',
    `You are receiving this email because your SAMAR-AGOS account is registered in Brgy. ${r.barangay}.`,
  ].join('\n');

  return { subject, html, text };
}

// ---------------------------------------------------------------- responder credentials

/** Emails each new responder their sign-in details, then deletes the temporary password. */
function checkResponderInvites_() {
  listCollection_('responders').forEach((doc) => {
    const r = fromDoc_(doc);
    if (r.credSent || !r.tempPassword || !r.contactEmail) return;
    if (MailApp.getRemainingDailyQuota() < 1) return;
    const id = doc.name.split('/').pop();
    const mail = buildCredentialsEmail_(r);
    const opts = { to: r.contactEmail, subject: mail.subject, htmlBody: mail.html, body: mail.text, name: senderName_() };
    const replyTo = PropertiesService.getScriptProperties().getProperty('REPLY_TO');
    if (replyTo) opts.replyTo = replyTo;
    MailApp.sendEmail(opts);
    // tempPassword is in the update mask but not in the fields, so Firestore deletes it
    firestore_('patch', `/responders/${id}?updateMask.fieldPaths=credSent&updateMask.fieldPaths=sentAt&updateMask.fieldPaths=tempPassword`, {
      fields: { credSent: { booleanValue: true }, sentAt: { integerValue: String(Date.now()) } },
    });
    Logger.log('Credentials for %s sent to %s', r.loginEmail, r.contactEmail);
  });
}

function buildCredentialsEmail_(r) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const appUrl = PropertiesService.getScriptProperties().getProperty('APP_URL');
  const font = 'font-family:Arial,Helvetica,sans-serif;';
  const subject = 'Your SAMAR-AGOS responder account';
  const rows = [
    ['Sign-in email', r.loginEmail],
    ['Temporary password', r.tempPassword],
  ];
  const steps = [
    `Open SAMAR-AGOS${appUrl ? ' using the button below' : ''} and sign in with the email and temporary password above.`,
    'Choose your own password when asked. The temporary password stops working after that.',
    'Your assigned work orders appear on your dashboard. Update each step, add notes and photos, and complete the job there.',
  ];
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f3f5f8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f8;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #dfe4ea;border-radius:8px;${font}color:#1c2a3a;">
  <tr><td style="padding:20px 28px;border-bottom:1px solid #e6eaef;">
    <div style="font-size:15px;font-weight:bold;color:#0b2545;">${esc(UTILITY_NAME)}</div>
    <div style="font-size:12px;color:#6b7785;margin-top:2px;">SAMAR-AGOS Field Response</div>
  </td></tr>
  <tr><td style="padding:24px 28px 8px;">
    <div style="font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#0b2545;">Responder account</div>
    <h1 style="margin:6px 0 14px;font-size:21px;line-height:1.3;color:#0b2545;">Your sign-in details</h1>
    <p style="margin:0 0 6px;font-size:14px;line-height:1.6;">Dear ${esc(r.name || 'Responder')},</p>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.6;">${esc(UTILITY_NAME)} has added you as a field responder in SAMAR-AGOS. Use the details below to sign in and view the work orders assigned to you.</p>
  </td></tr>
  <tr><td style="padding:0 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6eaef;border-radius:6px;font-size:13.5px;">
      ${rows
        .map(
          ([k, v], i) =>
            `<tr><td style="padding:10px 14px;width:42%;color:#6b7785;${i ? 'border-top:1px solid #eef1f4;' : ''}">${esc(k)}</td><td style="padding:10px 14px;font-weight:bold;color:#1c2a3a;font-family:Consolas,Menlo,monospace;${i ? 'border-top:1px solid #eef1f4;' : ''}">${esc(v)}</td></tr>`
        )
        .join('')}
    </table>
  </td></tr>
  <tr><td style="padding:20px 28px 0;">
    <div style="font-size:13px;font-weight:bold;color:#0b2545;margin-bottom:6px;">Getting started</div>
    <ol style="margin:0;padding-left:20px;font-size:14px;line-height:1.6;">${steps.map((t) => `<li style="margin-bottom:4px;">${esc(t)}</li>`).join('')}</ol>
  </td></tr>
  ${
    appUrl
      ? `<tr><td style="padding:22px 28px 0;"><a href="${esc(appUrl)}" style="display:inline-block;background:#0b2545;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:11px 20px;border-radius:6px;">Sign in to SAMAR-AGOS</a></td></tr>`
      : ''
  }
  <tr><td style="padding:18px 28px 0;"><div style="border-left:3px solid #0b2545;background:#f7f9fb;padding:12px 16px;font-size:13.5px;line-height:1.6;">Keep these details private. Staff of ${esc(UTILITY_NAME)} will never ask for your password. If you did not expect this email, please inform the utility office.</div></td></tr>
  <tr><td style="padding:24px 28px 22px;">
    <p style="margin:0;font-size:14px;line-height:1.6;">Respectfully,<br><strong>${esc(UTILITY_NAME)}</strong></p>
  </td></tr>
  <tr><td style="padding:16px 28px;border-top:1px solid #e6eaef;background:#fafbfc;border-radius:0 0 8px 8px;font-size:11.5px;line-height:1.6;color:#7b8794;">
    You are receiving this email because ${esc(UTILITY_NAME)} registered this address for a SAMAR-AGOS responder account. Please do not reply to this automated message unless a reply address is provided.
  </td></tr>
</table>
</td></tr></table></body></html>`;
  const text = [
    UTILITY_NAME,
    'SAMAR-AGOS RESPONDER ACCOUNT',
    '',
    `Dear ${r.name || 'Responder'},`,
    '',
    `${UTILITY_NAME} has added you as a field responder in SAMAR-AGOS. Use the details below to sign in and view the work orders assigned to you.`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'Getting started:',
    ...steps.map((t, i) => `${i + 1}. ${t}`),
    ...(appUrl ? ['', `Sign in: ${appUrl}`] : []),
    '',
    `Keep these details private. Staff of ${UTILITY_NAME} will never ask for your password.`,
    '',
    'Respectfully,',
    UTILITY_NAME,
  ].join('\n');
  return { subject, html, text };
}

// ---------------------------------------------------------------- Firestore (REST, service account)

function fetchAdvisories_() {
  return listCollection_('advisories').map(fromDoc_);
}

/** Residents whose profile barangay is one of the affected barangays (staff excluded). */
function fetchResidents_(barangays, staffEmails) {
  if (!barangays.length) return [];
  const seen = {};
  const out = [];
  // Firestore "in" filters accept up to 30 values.
  for (let i = 0; i < barangays.length; i += 30) {
    const chunk = barangays.slice(i, i + 30);
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'users' }],
        where: { fieldFilter: { field: { fieldPath: 'barangay' }, op: 'IN', value: { arrayValue: { values: chunk.map((b) => ({ stringValue: b })) } } } },
      },
    };
    const res = firestore_('post', ':runQuery', body);
    res.forEach((row) => {
      if (!row.document) return;
      const u = fromDoc_(row.document);
      const email = String(u.email || '').trim().toLowerCase();
      if (!email || seen[email] || staffEmails.indexOf(email) >= 0) return;
      seen[email] = true;
      out.push({ email, name: u.name || '', barangay: u.barangay || '' });
    });
  }
  return out;
}

function fetchStaffEmails_() {
  try {
    const d = fromDoc_(firestore_('get', '/config/access'));
    return (d.providerEmails || []).map((e) => String(e).toLowerCase());
  } catch (e) {
    return [];
  }
}

function listCollection_(name) {
  const docs = [];
  let token = '';
  do {
    const res = firestore_('get', `/${name}?pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
    (res.documents || []).forEach((d) => docs.push(d));
    token = res.nextPageToken || '';
  } while (token);
  return docs;
}

function firestore_(method, path, payload) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents${path}`;
  const opts = { method, headers: { Authorization: `Bearer ${accessToken_()}` }, muteHttpExceptions: true, contentType: 'application/json' };
  if (payload) opts.payload = JSON.stringify(payload);
  const res = UrlFetchApp.fetch(url, opts);
  const code = res.getResponseCode();
  if (code >= 300) throw new Error(`Firestore ${method.toUpperCase()} ${path} failed (${code}): ${res.getContentText().slice(0, 300)}`);
  return JSON.parse(res.getContentText() || '{}');
}

function fromDoc_(doc) {
  const out = {};
  Object.keys(doc.fields || {}).forEach((k) => (out[k] = fromValue_(doc.fields[k])));
  return out;
}

function fromValue_(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return new Date(v.timestampValue).getTime();
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue_);
  if ('mapValue' in v) return fromDoc_({ fields: v.mapValue.fields || {} });
  return null;
}

/** OAuth token for the service account (cached for 50 minutes). */
function accessToken_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('fs_token');
  if (cached) return cached;
  const raw = PropertiesService.getScriptProperties().getProperty('SERVICE_ACCOUNT_JSON');
  if (!raw) throw new Error('Set the SERVICE_ACCOUNT_JSON script property first (see README).');
  const key = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Utilities.base64EncodeWebSafe(JSON.stringify(o)).replace(/=+$/, '');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(unsigned, key.private_key)).replace(/=+$/, '');
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error('Could not get a Firestore access token: ' + res.getContentText().slice(0, 300));
  const token = JSON.parse(res.getContentText()).access_token;
  cache.put('fs_token', token, 3000);
  return token;
}

// ---------------------------------------------------------------- helpers

function loadState_() {
  return JSON.parse(PropertiesService.getScriptProperties().getProperty('SENT_STATE') || '{}');
}
function saveState_(state) {
  PropertiesService.getScriptProperties().setProperty('SENT_STATE', JSON.stringify(state));
}
function senderName_() {
  return PropertiesService.getScriptProperties().getProperty('SENDER_NAME') || `${UTILITY_NAME} (SAMAR-AGOS)`;
}
function fmt_(ms) {
  return ms ? Utilities.formatDate(new Date(ms), TIME_ZONE, "MMMM d, yyyy 'at' h:mm a") : 'To be announced';
}
function titleCase_(s) {
  return String(s)
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
