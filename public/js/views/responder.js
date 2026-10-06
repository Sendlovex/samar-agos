// Field responder dashboard: the work orders assigned to the signed-in responder.
// Progress, notes, photos and completion use the same actions as the operator work order page.
import * as S from '../store.js';
import { WO_STEPS, RESPONDER_USER } from '../data.js';
import { icon, status, card, timeline, empty, tabs, register, priorityBadge } from '../ui.js';
import { esc, fmtDateTime, relTime } from '../util.js';
import { go } from '../app.js';
import { woStatusBadge } from './provider-shared.js';

const st = () => S.getState();
const mine = () => st().workOrders.filter((w) => w.responder === RESPONDER_USER.loginEmail);
const rank = { Critical: 0, High: 1, Medium: 2, Low: 3 };
let jobTab = 'open';

function due(w, now) {
  if (w.status === 'Completed') return `Completed ${fmtDateTime(w.completion?.at || w.history.at(-1)?.at)}`;
  const h = (w.target - now) / 3600e3;
  const span = Math.abs(h) >= 24 ? `${Math.round(Math.abs(h) / 24)} days` : `${Math.max(1, Math.round(Math.abs(h)))} hours`;
  return h < 0 ? `<span class="txt-warn">Overdue by ${span}</span>` : `Due in ${span}, ${fmtDateTime(w.target)}`;
}

function jobRow(w, now) {
  const i = WO_STEPS.indexOf(w.status);
  const inc = st().incidents.find((x) => x.id === w.incidentId);
  return `<a class="rj" href="#/c/jobs/${w.id}">
    <div class="rj-m">
      <div class="rj-h"><span class="mono">${w.id}</span>${priorityBadge(w.priority)}</div>
      <div class="rj-t">${esc(w.description)}</div>
      <div class="rj-l">${esc(w.location)}${inc ? `<span>${esc(inc.title)}</span>` : ''}</div>
    </div>
    <div class="rj-s">
      <div class="rj-st"><strong>${esc(w.status)}</strong><span>Step ${i + 1} of ${WO_STEPS.length}</span></div>
      <div class="rj-bar" aria-hidden="true">${WO_STEPS.map((_, k) => `<span class="${k <= i ? 'on' : ''}"></span>`).join('')}</div>
      <div class="rj-d">${due(w, now)}</div>
    </div>
  </a>`;
}

const jobs = {
  title: 'My Work Orders',
  render() {
    const now = Date.now();
    const all = mine();
    const open = all.filter((w) => w.status !== 'Completed');
    const overdue = open.filter((w) => w.target < now);
    const today = open.filter((w) => w.target >= now && w.target < now + 24 * 3600e3);
    const done = all.filter((w) => w.status === 'Completed');
    const list = (jobTab === 'completed' ? done : open).sort((a, b) =>
      jobTab === 'completed' ? (b.completion?.at || 0) - (a.completion?.at || 0) : (b.target < now) - (a.target < now) || (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9) || a.target - b.target
    );
    const next = [...open].sort((a, b) => (b.target < now) - (a.target < now) || (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9) || a.target - b.target)[0];
    return `<div class="page-h"><div><h1>My Work Orders</h1><p class="page-sub">Jobs assigned to you by the water utility. Update each step as you work.</p></div></div>
      <section class="rsum">
        <div class="rsum-main">
          <span class="rsum-k">Next job</span>
          ${next ? `<a class="rsum-job" href="#/c/jobs/${next.id}"><strong>${esc(next.description.split('.')[0])}</strong><span>${esc(next.location)}</span><span>${next.id}, ${due(next, now)}</span></a>` : '<p class="rsum-none">No open jobs. New assignments appear here.</p>'}
        </div>
        <dl class="rsum-n">
          <div><dt>Open</dt><dd>${open.length}</dd></div>
          <div><dt>Overdue</dt><dd class="${overdue.length ? 'txt-warn' : ''}">${overdue.length}</dd></div>
          <div><dt>Due in 24 hours</dt><dd>${today.length}</dd></div>
          <div><dt>Completed</dt><dd>${done.length}</dd></div>
        </dl>
      </section>
      ${tabs([{ id: 'open', label: 'Open', count: open.length }, { id: 'completed', label: 'Completed', count: done.length }], jobTab, 'rj-tab')}
      <div class="card rj-list">${list.length ? list.map((w) => jobRow(w, now)).join('') : `<p class="rj-empty">${jobTab === 'completed' ? 'No completed jobs yet.' : 'No open jobs assigned to you.'}</p>`}</div>`;
  },
};

register({ 'rj-tab': (el) => ((jobTab = el.dataset.id), go('#/c/jobs')) });

const jobDetail = {
  title: 'Work Order',
  render({ id }) {
    const s = st();
    const w = mine().find((x) => x.id === id);
    if (!w) return empty('Work order not found', 'It may have been reassigned to someone else.', 'search', '<a class="btn btn--outline btn--sm" href="#/c/jobs">Back to my work orders</a>');
    const inc = s.incidents.find((i) => i.id === w.incidentId);
    const asset = s.assets.find((a) => a.id === w.assetId);
    const idx = WO_STEPS.indexOf(w.status);
    const next = WO_STEPS[idx + 1];
    const overdue = w.status !== 'Completed' && w.target < Date.now();
    const items = WO_STEPS.map((x, k) => ({ label: x, at: w.history.find((h) => h.status === x)?.at, state: k <= idx ? 'done' : k === idx + 1 ? 'current' : 'todo' }));
    return `<a class="back" href="#/c/jobs">${icon('chev-l', 16)} My Work Orders</a>
      <div class="page-h"><div><div class="mono muted">${w.id}</div><h1>${esc(w.description.split('.')[0])}</h1><div class="inc-badges">${woStatusBadge(w)} ${priorityBadge(w.priority)} ${overdue ? status('warning', 'Overdue') : ''}</div></div>
      <div class="page-a">${next ? `<button class="btn btn--primary" data-action="wo-advance" data-id="${w.id}" data-next="${next}">${next === 'Completed' ? 'Complete work order' : `Move to ${next}`}</button>` : `<span class="muted">Completed ${fmtDateTime(w.completion?.at)}</span>`}</div></div>
      <div class="inc-grid">
        <div class="inc-main">
          ${card(
            'Job details',
            `<dl class="kv kv--3">
            <div><dt>Location</dt><dd>${esc(w.location)}</dd></div>
            <div><dt>Asset</dt><dd>${asset ? `<span class="mono">${asset.id}</span><br/><span class="sm muted">${esc(asset.name)}</span>` : esc(w.assetId)}</dd></div>
            <div><dt>Target completion</dt><dd class="${overdue ? 'txt-warn' : ''}">${fmtDateTime(w.target)}</dd></div>
            <div><dt>Related incident</dt><dd>${inc ? `<span class="mono">${inc.id}</span><br/><span class="sm muted">${esc(inc.title)}</span>` : '<span class="muted">Preventive or routine</span>'}</dd></div>
            <div><dt>Assigned</dt><dd>${fmtDateTime(w.history.find((h) => h.status === 'Assigned')?.at || w.createdAt)}</dd></div>
            <div><dt>Priority</dt><dd>${esc(w.priority)}</dd></div>
            <div class="kv-wide"><dt>Instructions</dt><dd>${esc(w.description)}</dd></div>
            </dl>`
          )}
          ${card(
            'Repair photos',
            `<div class="photos">${['before', 'after']
              .map(
                (k) => `<div class="photo-slot"><div class="photo-l">${k === 'before' ? 'Before repair' : 'After repair'}</div>${
                  w.photos[k]
                    ? `<img src="${w.photos[k]}" alt="${k} repair photo"/>`
                    : w.status === 'Completed'
                      ? '<p class="muted sm">No photo</p>'
                      : `<label class="upload upload--sm">${icon('camera', 20)}<span><strong>Add ${k} photo</strong><em>Take or choose a photo</em></span><input type="file" accept="image/*" capture="environment" class="sr-only" data-change="wo-photo" data-id="${w.id}" data-k="${k}"/></label>`
                }</div>`
              )
              .join('')}</div>
            ${w.completion ? `<dl class="kv kv--3 mt"><div><dt>Completed</dt><dd>${fmtDateTime(w.completion.at)}</dd></div><div><dt>Verification reading</dt><dd>${esc(w.completion.reading || '—')}</dd></div><div class="kv-wide"><dt>Repair notes</dt><dd>${esc(w.completion.notes || '—')}</dd></div></dl>` : ''}`
          )}
          ${card(
            'Field notes',
            `${w.notes.length ? `<ul class="notes">${w.notes.map((n) => `<li><div class="notes-h"><strong>${esc(n.by)}</strong><time>${fmtDateTime(n.at)}</time></div><p>${esc(n.text)}</p></li>`).join('')}</ul>` : '<p class="muted sm">No notes yet. The operations team sees every note you add.</p>'}
            ${w.status !== 'Completed' ? `<div class="note-add"><label class="sr-only" for="wo-note-in">Add a note</label><input id="wo-note-in" placeholder="e.g. On site, isolating the section valve"/><button class="btn btn--outline btn--sm" data-action="wo-note" data-id="${w.id}">Add note</button></div>` : ''}`
          )}
        </div>
        <div class="inc-side">
          ${card('Progress', timeline(items), { sub: `Updated ${relTime(w.history.at(-1)?.at || w.createdAt)}` })}
        </div>
      </div>`;
  },
};

export const responderViews = { jobs, 'jobs/:id': jobDetail };
