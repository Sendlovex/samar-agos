// Provider: barangay households — registered resident accounts and their monthly meter readings.
import * as B from '../backend.js';
import { zoneById, SERVICE_ZONES, RESIDENT, waterBill, CWD_FACTS } from '../data.js';
import { icon, src, field, empty, openModal, register, registerInputs, showToast } from '../ui.js';
import { barChart } from '../charts.js';
import { esc, fmt, fmtDate } from '../util.js';

// Offline mode has no user database: the demo resident is the only household, readings stay in this browser.
const OFFLINE_KEY = 'samaragos.meterReadings';
const offlineReadings = () => {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]');
  } catch (e) {
    return [];
  }
};

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const MONTHS = Array.from({ length: 6 }, (_, i) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - i);
  return monthKey(d);
});
const monthLabel = (k, opts = { month: 'long', year: 'numeric' }) => new Date(`${k}-01T12:00:00`).toLocaleDateString('en-US', opts);

// Modal state
let cur = null; // { zone, households, readings, month, q, uid, loading, error }

async function load(zone) {
  if (!B.FB_ENABLED) {
    const hh = RESIDENT.barangay === zone.short ? [{ uid: 'demo-resident', name: RESIDENT.name, address: RESIDENT.address, phone: RESIDENT.phone, email: '', barangay: zone.short, demo: true }] : [];
    return { households: hh, readings: offlineReadings().filter((r) => r.barangay === zone.short) };
  }
  const [households, readings] = await Promise.all([B.listHouseholds(zone.short), B.listReadings(zone.short)]);
  return { households, readings };
}

const readingOf = (uid, month) => cur.readings.find((r) => r.uid === uid && r.month === month);

function summary() {
  const { households, month } = cur;
  const rs = households.map((h) => readingOf(h.uid, month)).filter(Boolean);
  const total = rs.reduce((n, r) => n + r.m3, 0);
  const avg = rs.length ? total / rs.length : null;
  const cell = (k, v, s) => `<div><dt>${k}</dt><dd>${v}</dd>${s ? `<span>${s}</span>` : ''}</div>`;
  return `<dl class="hh-sum">
    ${cell('Households', fmt(households.length), cur.zone.connections ? `of about ${fmt(cur.zone.connections)} connections` : 'Level I, communal supply')}
    ${cell(`Total, ${monthLabel(month, { month: 'short', year: 'numeric' })}`, `${fmt(total, 1)} m³`, `${rs.length} of ${households.length} households read`)}
    ${cell('Average', avg != null ? `${fmt(avg, 1)} m³` : '—', `City average ${fmt(CWD_FACTS.avgM3PerConnection, 1)} m³`)}
    ${cell('Est. billing', `₱${fmt(rs.reduce((n, r) => n + (waterBill(r.m3) || 0), 0), 2)}`, 'Domestic rates')}
  </dl>`;
}

function monthSelect(id, action) {
  return `<select id="${id}" data-change="${action}" aria-label="Billing month">${MONTHS.map((m) => `<option value="${m}" ${m === cur.month ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select>`;
}

function listView() {
  const q = cur.q.trim().toLowerCase();
  const rows = cur.households.filter((h) => !q || `${h.name} ${h.address} ${h.phone} ${h.email}`.toLowerCase().includes(q));
  const trend = MONTHS.slice().reverse().map((m) => ({ label: monthLabel(m, { month: 'short' }), value: cur.households.reduce((n, h) => n + (readingOf(h.uid, m)?.m3 || 0), 0), color: m === cur.month ? '#1E3A5F' : '#B8C4D3' }));
  return `${summary()}
    <div class="hh-chart"><div class="hh-sec"><strong>Barangay consumption, last 6 months</strong>${src('MANUAL')}</div>
      ${trend.some((b) => b.value) ? barChart({ id: 'hh-trend', label: 'Total recorded consumption per month', bars: trend.map((b) => ({ ...b, showValue: b.value > 0 })), w: 680, h: 160, yFmt: (v) => `${fmt(v, 0)}` }) : '<p class="hh-none">No meter readings recorded yet. Open a household to record its monthly reading.</p>'}
    </div>
    <div class="hh-tools">
      <div class="hh-search">${icon('search', 15)}<input type="search" id="hh-q" placeholder="Search name, purok or phone" value="${esc(cur.q)}" data-input="hh-q" aria-label="Search households"/></div>
      ${monthSelect('hh-month', 'hh-month')}
    </div>
    ${rows.length
      ? `<div class="tbl-wrap"><table class="tbl hh-tbl"><thead><tr><th>Household</th><th>Purok / street</th><th class="num">Consumption</th><th class="num">Est. bill</th><th></th></tr></thead><tbody>${rows
          .map((h) => {
            const r = readingOf(h.uid, cur.month);
            return `<tr class="is-click" data-action="hh-open" data-uid="${esc(h.uid)}" tabindex="0"><td><strong>${esc(h.name || h.email || 'Unnamed account')}</strong><div class="it-s">${esc(h.phone || h.email || '')}</div></td><td>${esc(h.address || '—')}</td><td class="num">${r ? `<strong>${fmt(r.m3, 1)}</strong> m³` : '<span class="muted">Not read</span>'}</td><td class="num">${r ? `₱${fmt(waterBill(r.m3), 2)}` : '—'}</td><td class="num"><span class="hh-go">View ${icon('chev-r', 14)}</span></td></tr>`;
          })
          .join('')}</tbody></table></div>`
      : empty(cur.households.length ? 'No household matches your search' : 'No registered households yet', cur.households.length ? '' : `Households appear here when residents of ${esc(cur.zone.short)} create a SAMAR-AGOS account and choose this barangay.`, 'users')}`;
}

function householdView() {
  const h = cur.households.find((x) => x.uid === cur.uid);
  if (!h) return listView();
  const hist = MONTHS.slice().reverse().map((m) => ({ m, r: readingOf(h.uid, m) }));
  const r = readingOf(h.uid, cur.month);
  const recorded = hist.filter((x) => x.r);
  const avg = recorded.length ? recorded.reduce((n, x) => n + x.r.m3, 0) / recorded.length : null;
  return `<button class="back hh-back" data-action="hh-back">${icon('chev-l', 16)} All households in ${esc(cur.zone.short)}</button>
    <div class="hh-person"><span class="avatar">${esc((h.name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase())}</span>
      <div><strong>${esc(h.name || 'Unnamed account')}</strong><span>${esc([h.address, `Brgy. ${cur.zone.short}`].filter((x, i, a) => x && a.indexOf(x) === i).join(', '))}</span><span>${esc([h.phone, h.email].filter(Boolean).join(', ') || 'No contact details')}${h.demo ? ' (demo account)' : ''}</span></div></div>
    <dl class="hh-sum hh-sum--3">
      <div><dt>${monthLabel(cur.month, { month: 'short', year: 'numeric' })}</dt><dd>${r ? `${fmt(r.m3, 1)} m³` : 'Not read'}</dd><span>${r ? `Est. bill ₱${fmt(waterBill(r.m3), 2)}` : 'No reading recorded'}</span></div>
      <div><dt>6-month average</dt><dd>${avg != null ? `${fmt(avg, 1)} m³` : '—'}</dd><span>${recorded.length} month${recorded.length === 1 ? '' : 's'} recorded</span></div>
      <div><dt>Versus own average</dt><dd>${r && avg != null ? `${r.m3 >= avg ? '+' : '−'}${fmt(Math.abs(((r.m3 - avg) / (avg || 1)) * 100), 0)}%` : '—'}</dd><span>${monthLabel(cur.month, { month: 'long' })} compared with the 6-month average</span></div>
    </dl>
    <div class="hh-chart"><div class="hh-sec"><strong>Monthly consumption</strong>${src('MANUAL')}</div>
      ${recorded.length ? barChart({ id: 'hh-person', label: `${h.name} monthly consumption`, bars: hist.map((x) => ({ label: monthLabel(x.m, { month: 'short' }), value: x.r?.m3 || 0, color: x.m === cur.month ? '#1E3A5F' : '#B8C4D3', showValue: !!x.r })), w: 680, h: 160, yFmt: (v) => `${fmt(v, 0)}` }) : '<p class="hh-none">No meter readings recorded for this household yet.</p>'}
    </div>
    <form class="hh-form" id="hh-form" onsubmit="return false">
      <div class="hh-sec"><strong>Record meter reading</strong></div>
      <div class="grid-2">
        ${field('Billing month', monthSelect('hh-rmonth', 'hh-month'), { id: 'hh-rmonth' })}
        ${field('Consumption (m³)', `<input type="number" id="hh-m3" min="0" max="999" step="0.1" value="${r ? r.m3 : ''}" placeholder="e.g. 16.2"/>`, { id: 'hh-m3', req: true })}
      </div>
      <div class="hh-form-a"><span class="fine">${r ? `Last recorded ${fmtDate(r.recordedAt)}${r.recordedBy ? ` by ${esc(r.recordedBy)}` : ''}. Saving replaces it.` : 'Saved as a manual record for this month.'}</span><button class="btn btn--primary btn--sm" data-action="hh-save">${icon('check', 15)} Save reading</button></div>
    </form>
    ${recorded.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Month</th><th class="num">Consumption</th><th class="num">Est. bill</th><th>Recorded</th></tr></thead><tbody>${recorded
      .slice()
      .reverse()
      .map((x) => `<tr><td>${monthLabel(x.m)}</td><td class="num">${fmt(x.r.m3, 1)} m³</td><td class="num">₱${fmt(waterBill(x.r.m3), 2)}</td><td class="muted">${fmtDate(x.r.recordedAt)}</td></tr>`)
      .join('')}</tbody></table></div>` : ''}`;
}

function body() {
  if (cur.loading) return '<div class="skel" role="status"><span></span><span></span><span></span><span class="sr-only">Loading households</span></div>';
  if (cur.error) return empty('Could not load households', esc(cur.error), 'alert');
  return cur.uid ? householdView() : listView();
}

function paint() {
  const b = document.getElementById('hh-body');
  if (b) b.innerHTML = body();
}

export async function openBarangay(zoneId) {
  const zone = zoneById(zoneId);
  if (!zone) return;
  const g = SERVICE_ZONES.find((x) => x.id === zone.group);
  cur = { zone, households: [], readings: [], month: MONTHS[0], q: '', uid: null, loading: true, error: null };
  openModal(`Brgy. ${esc(zone.short)}<span class="hh-sub">${g ? `${esc(g.name)}, ${esc(g.area)}` : ''}${zone.pop2020 ? `. Population ${fmt(zone.pop2020)} (2020)` : ''}</span>`, `<div id="hh-body" class="hh">${body()}</div>`, { wide: true, onMount: (m) => m.classList.add('modal--hh') });
  try {
    Object.assign(cur, await load(zone), { loading: false });
  } catch (e) {
    console.error(e);
    Object.assign(cur, { loading: false, error: e?.code === 'permission-denied' ? 'Your account does not have permission to read households or meter readings. Deploy the updated Firestore rules.' : e?.message || 'Unknown error' });
  }
  paint();
}

register({
  'brgy-open': (el) => openBarangay(el.dataset.id),
  'hh-open': (el) => ((cur.uid = el.dataset.uid), paint()),
  'hh-back': () => ((cur.uid = null), paint()),
  'hh-save': async (el) => {
    const m3 = parseFloat(document.getElementById('hh-m3').value);
    const month = document.getElementById('hh-rmonth').value;
    if (!(m3 >= 0) || m3 > 999) return showToast({ msg: 'Enter the consumption in cubic metres (0 to 999).', kind: 'error' });
    el.disabled = true;
    try {
      const rec = { uid: cur.uid, barangay: cur.zone.short, month, m3: Math.round(m3 * 10) / 10 };
      let saved;
      if (B.FB_ENABLED) saved = await B.saveReading(rec);
      else {
        saved = { id: `${rec.uid}_${month}`, ...rec, recordedAt: Date.now(), recordedBy: '' };
        const all = offlineReadings().filter((r) => r.id !== saved.id);
        try {
          localStorage.setItem(OFFLINE_KEY, JSON.stringify([...all, saved]));
        } catch (e) {
          /* ignore */
        }
      }
      cur.readings = [...cur.readings.filter((r) => r.id !== saved.id), saved];
      cur.month = month;
      showToast({ msg: `Reading saved: ${fmt(saved.m3, 1)} m³ for ${monthLabel(month)}`, kind: 'success' });
      paint();
    } catch (e) {
      console.error(e);
      showToast({ msg: e?.code === 'permission-denied' ? 'Permission denied. Deploy the updated Firestore rules.' : 'Could not save the reading.', kind: 'error' });
      el.disabled = false;
    }
  },
});
registerInputs({
  'hh-q': (el) => {
    cur.q = el.value;
    const pos = el.selectionStart;
    paint();
    const n = document.getElementById('hh-q');
    if (n) (n.focus(), n.setSelectionRange(pos, pos));
  },
  'hh-month': (el) => ((cur.month = el.value), paint()),
});
