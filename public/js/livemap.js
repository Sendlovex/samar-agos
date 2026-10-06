// Interactive geographic map (Leaflet) for Catbalogan City, Samar.
// Operational data keeps planar x/y coordinates; they are projected onto real lat/lng here.
// Barangay boundaries come from OpenStreetMap; facility positions from the CWD Water Safety Plan 2022.
import { getState, RES_CAP_ML } from './store.js';
import { ZONES, MAP, CRITICAL_FACILITIES, RESIDENT, reportTypeLabel, zoneById } from './data.js';
import { parsePoly, esc, fmt, toLL, toXY } from './util.js';
import { actions } from './ui.js';
import { assetLiveStatus, shape, LAYERS, DEFAULT_LAYERS, incidentPos } from './map.js';

const COL = { normal: '#1F8A4C', warning: '#D97706', critical: '#C0262D', offline: '#8A94A3', info: '#1D6FB8' };
const BASE = {
  map: { label: 'Map', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' },
  sat: { label: 'Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' },
};
const TYPE_LAYER = { Reservoir: 'storage', Tank: 'storage', 'Water Source': 'sources', Well: 'sources', 'Treatment Equipment': 'sources', Pump: 'pumps', Sensor: 'pumps', Valve: 'pipes' };

// Two clearly different classes, as on utility network maps: blue mains, red distribution.
const NET = { main: '#1F5BB5', dist: '#E2575F', issue: '#F59E0B' };
// Assets that tap into the street network with a short service connection
const CONNECT = ['RES-P13', 'WTP-KUL', 'WEL-EXE', 'WEL-LAG', 'WEL-PAY']; // facilities joined to the nearest street main

// Street-following pipe network (roads © OpenStreetMap), loaded once.
let network = null;
let networkReq = null;
function loadNetwork() {
  if (!networkReq)
    networkReq = fetch('/data/network.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (network = d && d.lines?.length ? d : null))
      .catch(() => null);
  return networkReq;
}

const instances = new Map(); // id -> instance
const views = new Map(); // id -> { center, zoom } so re-renders keep the user's viewport
let baseChoice = 'map';
let layerChoice = new Set(DEFAULT_LAYERS);

// ---------------------------------------------------------------- host markup
export function liveMapHost(opts = {}) {
  const mode = opts.mode || 'provider';
  const id = opts.id || `lm-${mode}-${opts.compact ? 'c' : 'f'}${opts.readonly ? '-ro' : ''}-${opts.focusZone || ''}`;
  const cls = [`lmap-wrap`, `lmap--${mode}`, opts.compact ? 'lmap--compact' : '', opts.readonly ? 'lmap--ro' : ''].join(' ');
  return `<div class="${cls}"><div class="lmap" data-lmap="${id}" data-opts="${esc(JSON.stringify(opts))}" role="application" aria-label="${mode === 'picker' && !opts.readonly ? 'Map: click or drag the pin to set the problem location' : 'Interactive service area map of Catbalogan City'}"></div></div>`;
}

// ---------------------------------------------------------------- lifecycle
function mountAll() {
  if (!window.L) return;
  document.querySelectorAll('.lmap[data-lmap]:not(.leaflet-container)').forEach(mount);
  prune();
}

function prune() {
  instances.forEach((I, id) => {
    if (!document.body.contains(I.el)) {
      I.map.remove();
      instances.delete(id);
    }
  });
}

export function syncMaps() {
  prune();
  instances.forEach(sync);
}

// Mount maps as soon as their host markup lands in the DOM (timer, not rAF, so
// background tabs still mount and stay live).
let mountTimer;
if (window.L) {
  new MutationObserver(() => {
    clearTimeout(mountTimer);
    mountTimer = setTimeout(mountAll, 0);
  }).observe(document.body, { childList: true, subtree: true });
}

function mount(el) {
  const id = el.dataset.lmap;
  const opts = JSON.parse(el.dataset.opts || '{}');
  const mode = opts.mode || 'provider';
  const ro = !!opts.readonly;
  const full = mode === 'provider' && !opts.compact;
  const old = instances.get(id);
  if (old) old.map.remove();

  const map = L.map(el, { zoomControl: false, attributionControl: true, scrollWheelZoom: false, dragging: !ro, doubleClickZoom: !ro, boxZoom: !ro, keyboard: !ro, touchZoom: !ro, zoomSnap: 0.25, minZoom: 12, maxZoom: 19 });
  map.attributionControl.setPrefix(false);
  const I = { id, el, map, opts, mode, groups: {}, zones: new Map(), pipes: new Map(), markers: new Map(), selected: opts.selected || null, base: null };
  instances.set(id, I);
  setBase(I, baseChoice);

  // Scroll-zoom only after the user engages with the map, so page scrolling isn't hijacked.
  if (!ro) {
    map.on('click focus', () => map.scrollWheelZoom.enable());
    map.on('mouseout blur', () => map.scrollWheelZoom.disable());
  }

  const groupNames = ['zones', 'pipes', 'storage', 'sources', 'pumps', 'facilities', 'reports', 'incidents', 'alt', 'home', 'pin'];
  groupNames.forEach((g) => {
    I.groups[g] = g === 'reports' && L.markerClusterGroup ? L.markerClusterGroup({ maxClusterRadius: 42, showCoverageOnHover: false, spiderfyOnMaxZoom: true, iconCreateFunction: clusterIcon }) : L.layerGroup();
  });
  visibleGroups(I).forEach((g) => I.groups[g].addTo(map));

  if (!ro) addControls(I, full);
  if (full) addLegend(I);

  if (mode === 'picker' && !ro) {
    map.on('click', (e) => pick(I, e.latlng));
  }

  sync(I);
  if (mode === 'provider')
    loadNetwork().then(() => {
      if (instances.get(id) === I && network) (drawNetwork(I), sync(I));
    });

  const v = views.get(id);
  if (v && !ro) map.setView(v.center, v.zoom, { animate: false });
  else fitDefault(I);
  map.on('moveend', () => views.set(id, { center: map.getCenter(), zoom: map.getZoom() }));
  setTimeout(() => map.getContainer().isConnected && map.invalidateSize(), 60); // the page may have redrawn and dropped this map
}

function fitDefault(I) {
  const o = I.opts;
  if (o.pin && (I.mode === 'picker')) return I.map.setView(toLL(o.pin.x, o.pin.y), o.readonly ? 16 : 15.5, { animate: false });
  // the water-points map starts a little wider so neighbouring areas are visible around the resident's own
  if (o.focusZone) return I.map.fitBounds(L.latLngBounds(zoneLL(o.focusZone)), { padding: I.mode === 'resident' && o.alt ? [90, 90] : [24, 24], animate: false });
  const all = ZONES.flatMap((z) => zoneLL(z.id));
  I.map.fitBounds(L.latLngBounds(all), { padding: [16, 16], animate: false });
}

const zoneLL = (id) => parsePoly(zoneById(id).poly).map(([x, y]) => toLL(x, y));

function visibleGroups(I) {
  const m = I.mode;
  if (m === 'picker') return ['zones', 'home', 'pin'];
  if (m === 'resident') return ['zones', 'alt', 'home'];
  const want = I.opts.compact ? new Set(I.opts.layers || ['zones', 'pipes', 'storage', 'sources', 'pumps', 'facilities', 'reports', 'incidents']) : layerChoice;
  return [...want].filter((g) => I.groups[g]);
}

function setBase(I, key) {
  if (I.base) I.map.removeLayer(I.base);
  const b = BASE[key];
  I.base = L.tileLayer(b.url, { attribution: b.attribution, maxZoom: 19 }).addTo(I.map);
  I.base.bringToBack();
  I.el.classList.toggle('is-sat', key === 'sat');
}

// ---------------------------------------------------------------- controls
function ctrl(position, html, onAdd) {
  const C = L.Control.extend({
    onAdd() {
      const d = L.DomUtil.create('div', 'lm-ctrl');
      d.innerHTML = html;
      L.DomEvent.disableClickPropagation(d);
      L.DomEvent.disableScrollPropagation(d);
      onAdd && onAdd(d);
      return d;
    },
  });
  return new C({ position });
}

const SVG = (p, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;

function addControls(I, full) {
  const { map } = I;
  ctrl(
    'topleft',
    `<div class="lm-stack">
      <button type="button" data-z="in" aria-label="Zoom in">${SVG('<path d="M12 5v14M5 12h14"/>')}</button>
      <button type="button" data-z="out" aria-label="Zoom out">${SVG('<path d="M5 12h14"/>')}</button>
    </div>
    <div class="lm-stack">
      <button type="button" data-z="reset" aria-label="Reset view" title="Reset view">${SVG('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>')}</button>
      ${I.mode !== 'picker' ? `<button type="button" data-z="full" aria-label="Toggle full screen" title="Full screen">${SVG('<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>')}</button>` : ''}
    </div>`,
    (d) =>
      d.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.z === 'in') map.zoomIn();
        if (b.dataset.z === 'out') map.zoomOut();
        if (b.dataset.z === 'reset') (views.delete(I.id), fitDefault(I));
        if (b.dataset.z === 'full') {
          const w = I.el.closest('.lmap-wrap');
          w.classList.toggle('is-full');
          document.body.classList.toggle('lm-full-open', w.classList.contains('is-full'));
          setTimeout(() => map.invalidateSize(), 50);
        }
      })
  ).addTo(map);

  ctrl(
    'topright',
    `<div class="lm-seg" role="group" aria-label="Base map">${Object.entries(BASE)
      .map(([k, b]) => `<button type="button" data-b="${k}" class="${k === baseChoice ? 'is-on' : ''}" aria-pressed="${k === baseChoice}">${b.label}</button>`)
      .join('')}</div>`,
    (d) =>
      d.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        baseChoice = b.dataset.b;
        instances.forEach((x) => setBase(x, baseChoice));
        d.querySelectorAll('button').forEach((x) => (x.classList.toggle('is-on', x === b), x.setAttribute('aria-pressed', x === b)));
      })
  ).addTo(map);

  if (full) {
    ctrl(
      'topright',
      `<details class="lm-layers"><summary>${SVG('<path d="m12 2 10 5-10 5L2 7l10-5z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>', 15)} Layers</summary>
        <div class="lm-layers-b">${LAYERS.map((l) => `<label><input type="checkbox" value="${l.id}" ${layerChoice.has(l.id) ? 'checked' : ''}/> ${l.label}</label>`).join('')}</div></details>`,
      (d) =>
        d.addEventListener('change', (e) => {
          const v = e.target.value;
          e.target.checked ? layerChoice.add(v) : layerChoice.delete(v);
          const on = e.target.checked;
          if (on) I.groups[v]?.addTo(map);
          else I.groups[v] && map.removeLayer(I.groups[v]);
        })
    ).addTo(map);
  }
}

function addLegend(I) {
  const dot = (c) => `<i style="background:${c}"></i>`;
  ctrl(
    'bottomleft',
    `<div class="lm-legend"><span><i class="lm-legend-line" style="background:${NET.main}"></i>Transmission main</span><span><i class="lm-legend-line lm-legend-line--thin" style="background:${NET.dist}"></i>Distribution line</span><span><i class="lm-legend-line lm-legend-line--thin" style="background:repeating-linear-gradient(90deg,${NET.issue} 0 5px,transparent 5px 8px)"></i>Low-pressure area</span><span>${dot(COL.normal)}Normal</span><span>${dot(COL.warning)}Warning</span><span>${dot(COL.critical)}Critical</span><span>${dot(COL.offline)}Offline</span><span><i class="lm-legend-rep"></i>Resident report</span><span><i class="lm-legend-inc"></i>Incident</span></div>
     <div class="lm-note">Barangays: OpenStreetMap (some approximate) · facilities: CWD Water Safety Plan 2022 · pipe routes illustrative · readings SIMULATED</div>`
  ).addTo(I.map);
}

// ---------------------------------------------------------------- icons
const icon = (html, size, cls = '') => L.divIcon({ html, className: `lm-ico ${cls}`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
const assetIcon = (a, sev, sel) => icon(`<svg viewBox="-20 -20 40 40" width="34" height="34">${shape(a, sev, sel)}</svg>`, 34, sel ? 'is-sel' : '');
const facilityIcon = (sel) => icon(`<span class="lm-fac ${sel ? 'is-sel' : ''}"><svg viewBox="0 0 16 16" width="12" height="12"><path d="M8 3v10M3 8h10" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg></span>`, 22);
const reportIcon = (r, sel) => icon(`<span class="lm-rep ${r.incidentId ? 'is-linked' : ''} ${sel ? 'is-sel' : ''}"></span>`, sel ? 18 : 14);
const incidentIcon = (i, sel) => {
  const sev = i.severity === 'High' || i.severity === 'Critical' ? 'critical' : i.severity === 'Medium' ? 'warning' : 'info';
  return icon(`<span class="lm-inc lm-inc--${sev} ${sel ? 'is-sel' : ''}"><svg viewBox="-14 -14 28 28" width="28" height="28"><path d="M0-12 12 10H-12z" fill="${COL[sev]}" stroke="#fff" stroke-width="2"/><path d="M0-4v6M0 5.6v.4" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg></span>`, 32);
};
function clusterIcon(c) {
  const n = c.getChildCount();
  const size = n < 10 ? 32 : n < 25 ? 38 : 44;
  return L.divIcon({ html: `<span class="lm-cluster"><b>${n}</b></span>`, className: 'lm-ico', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}
const altIcon = (p, sel) => {
  const c = p.status === 'AVAILABLE' ? COL.normal : p.status === 'CLOSED' ? COL.offline : COL.warning;
  return L.divIcon({ html: `<svg viewBox="-14 -34 28 36" width="30" height="38"><path d="M0 0c-6-8-11-13-11-19a11 11 0 0 1 22 0c0 6-5 11-11 19z" fill="${sel ? '#0B2545' : '#0E7490'}" stroke="#fff" stroke-width="2"/><circle cy="-19" r="4.5" fill="${c}" stroke="#fff" stroke-width="1.5"/></svg>`, className: 'lm-ico', iconSize: [30, 38], iconAnchor: [15, 36] });
};
const homeIcon = () => icon('<span class="lm-home"></span>', 28);
const pinIcon = () => L.divIcon({ html: '<svg viewBox="-14 -34 28 36" width="32" height="40"><path d="M0 0c-7-9-12-14-12-20a12 12 0 0 1 24 0c0 6-5 11-12 20z" fill="#C0262D" stroke="#fff" stroke-width="2"/><circle cy="-20" r="4.5" fill="#fff"/></svg>', className: 'lm-ico lm-pin', iconSize: [32, 40], iconAnchor: [16, 38] });

// ---------------------------------------------------------------- tooltips
function assetTip(a, s, sev) {
  const t = s.tele;
  let r = '';
  if (a.type === 'Reservoir') r = `${Math.round((t.volML / RES_CAP_ML) * 100)}% · ${fmt(t.volML, 2)} ML`;
  else if (a.type === 'Tank' && t.tanks[a.id]) r = `${Math.round(t.tanks[a.id].level * 100)}% full`;
  else if (a.type === 'Pump' && t.pumps[a.id]) r = t.pumps[a.id].status === 'offline' ? 'Offline' : t.pumps[a.id].flowLs != null ? `${fmt(t.pumps[a.id].flowLs, 1)} L/s` : 'Running';
  else if (a.status === 'offline') r = 'Not reporting';
  const label = { normal: 'Normal', warning: 'Warning', critical: 'Critical', offline: 'Offline' }[sev];
  return `<strong>${esc(a.name)}</strong><span>${esc(a.type)} · ${label}${r ? ` · ${r}` : ''}</span>${a.type !== 'Valve' && r ? '<em>SIMULATED</em>' : ''}`;
}
const tipOpts = { direction: 'top', offset: [0, -14], className: 'lm-tip', opacity: 1 };

// ---------------------------------------------------------------- sync (runs on mount and every telemetry tick)
function keyed(I, key, make, update) {
  let m = I.markers.get(key);
  if (!m) {
    m = make();
    I.markers.set(key, m);
  } else update && update(m);
  m._seen = true;
  return m;
}

function setIconIfChanged(m, sig, makeIcon) {
  if (m._sig !== sig) {
    m.setIcon(makeIcon());
    m._sig = sig;
  }
}

function sync(I) {
  const s = getState();
  const t = s.tele;
  const mode = I.mode;
  const sel = I.selected;
  I.markers.forEach((m) => (m._seen = false));

  // zones
  // Resident "Where to Get Water" map: two colours only — blue for the resident's own area (with a
  // permanent label) and one neutral slate for every other area, all with solid outlines.
  const altMap = mode === 'resident' && I.opts.alt;
  ZONES.forEach((z) => {
    const zs = mode === 'picker' ? 'neutral' : t.zones[z.id].status;
    const focus = I.opts.focusZone === z.id;
    const c = zs === 'neutral' ? '#1D6FB8' : COL[zs];
    let style = { color: focus ? '#0B2545' : c, weight: focus ? 3 : 1.6, dashArray: focus ? null : '5 5', fillColor: c, fillOpacity: zs === 'normal' || zs === 'neutral' ? 0.05 : 0.17 };
    if (altMap) {
      style = focus
        ? { color: '#0B2545', weight: 4, dashArray: null, opacity: 1, fillColor: '#1D6FB8', fillOpacity: 0.3 }
        : { color: '#64748B', weight: 2, dashArray: null, opacity: 0.85, fillColor: '#64748B', fillOpacity: 0.14 };
    }
    const label = mode === 'provider' ? `<b>${esc(z.short.toUpperCase())}</b><span>${fmt(t.zones[z.id].pressure, 0)} PSI${zs !== 'normal' ? ' ▼' : ''}</span>` : altMap && focus ? `<b>YOUR AREA</b><span>${esc(z.short)}</span>` : `<b>${esc(z.short.toUpperCase())}</b><span>${esc(z.barangays.join(' · '))}</span>`;
    let p = I.zones.get(z.id);
    if (!p) {
      p = L.polygon(zoneLL(z.id), { ...style, interactive: mode === 'provider' || altMap }).addTo(I.groups.zones);
      p.bindTooltip(label, { permanent: altMap && focus, sticky: !(altMap && focus), direction: altMap && focus ? 'center' : 'top', className: `lm-zone${altMap && focus ? ' lm-zone--mine' : ''}` });
      if (altMap) {
        p.on('mouseover', () => p.setStyle({ weight: focus ? 5 : 3, fillOpacity: Math.min(0.45, p.options.fillOpacity + 0.12) }));
        p.on('mouseout', () => sync(I));
      }
      if (mode === 'provider') {
        p.on('mouseover', () => p.setStyle({ weight: 3, fillOpacity: Math.max(0.12, p.options.fillOpacity + 0.06) }));
        p.on('mouseout', () => sync(I));
        p.on('click', () => select(I, 'zone', z.id));
      }
      I.zones.set(z.id, p);
    } else {
      p.setStyle(style);
      p.setTooltipContent(label);
    }
  });

  if (mode === 'provider') {
    if (I.net) syncNetwork(I, s);
    // Schematic pipelines: only the raw-water/transmission links once the street network is drawn
    MAP.pipelines.forEach((pl) => {
      const issue = s.assets.find((a) => a.id === pl.id)?.status === 'warning';
      const style = { color: issue ? COL.warning : pl.kind === 'raw' ? '#64748B' : '#1E4E8C', weight: pl.kind === 'main' ? 4 : 2.6, opacity: 0.9, dashArray: pl.kind === 'raw' ? '6 6' : issue ? '10 8' : null, className: issue ? 'lm-pipe-alert' : '' };
      let line = I.pipes.get(pl.id);
      const asset = s.assets.find((a) => a.id === pl.id);
      if (!line) {
        line = L.polyline(parsePoly(pl.pts).map(([x, y]) => toLL(x, y)), style).addTo(I.groups.pipes);
        line.bindTooltip(`<strong>${esc(asset?.name || `Pipeline ${pl.id}`)}</strong><span>${pl.kind === 'raw' ? 'Raw-water line' : pl.kind === 'main' ? 'Main line' : 'Distribution line'}${issue ? ' · Warning' : ''}</span>`, { ...tipOpts, sticky: true, offset: [0, -6] });
        if (asset) line.on('click', () => select(I, 'asset', asset.id));
        I.pipes.set(pl.id, line);
      } else line.setStyle(style);
    });

    // assets
    s.assets
      .filter((a) => a.x != null && a.type !== 'Pipeline')
      .forEach((a) => {
        const sev = assetLiveStatus(a, s);
        const isSel = sel === a.id;
        const g = I.groups[TYPE_LAYER[a.type]];
        const m = keyed(
          I,
          `a:${a.id}`,
          () => {
            const mk = L.marker(toLL(a.x, a.y), { icon: assetIcon(a, sev, isSel), keyboard: true, title: a.name, riseOnHover: true }).addTo(g);
            mk._sig = `${sev}${isSel}`;
            mk.bindTooltip(assetTip(a, s, sev), tipOpts);
            mk.on('click', () => select(I, 'asset', a.id));
            return mk;
          },
          (mk) => {
            setIconIfChanged(mk, `${sev}${isSel}`, () => assetIcon(a, sev, isSel));
            mk.setTooltipContent(assetTip(a, s, sev));
          }
        );
        m.setZIndexOffset(isSel ? 1000 : a.type === 'Reservoir' ? 200 : 0);
      });

    // critical facilities
    CRITICAL_FACILITIES.forEach((f) => {
      const isSel = sel === f.id;
      const zt = t.zones[f.zone];
      const tip = `<strong>${esc(f.name)}</strong><span>${esc(f.kind)} · ${zt.status === 'normal' ? 'Supply normal' : 'Pressure below normal'}</span>`;
      keyed(
        I,
        `f:${f.id}`,
        () => {
          const mk = L.marker(toLL(f.x, f.y), { icon: facilityIcon(isSel), title: f.name }).addTo(I.groups.facilities);
          mk._sig = `${isSel}`;
          mk.bindTooltip(tip, tipOpts);
          mk.on('click', () => select(I, 'facility', f.id));
          return mk;
        },
        (mk) => (setIconIfChanged(mk, `${isSel}`, () => facilityIcon(isSel)), mk.setTooltipContent(tip))
      );
    });

    // resident reports (clustered geographically)
    s.reports
      .filter((r) => r.status !== 'verified' && !(r.status === 'repair_completed' && !r.awaitingVerification))
      .forEach((r) => {
        const isSel = sel === r.id;
        const tip = `<strong>${esc(reportTypeLabel(r.type))}</strong><span>${r.id} · ${esc(r.location)}</span><em>RESIDENT REPORTED</em>`;
        keyed(
          I,
          `r:${r.id}:${r.incidentId ? 1 : 0}`,
          () => {
            const mk = L.marker(toLL(r.x, r.y), { icon: reportIcon(r, isSel), title: r.id });
            mk._sig = `${isSel}`;
            mk.bindTooltip(tip, tipOpts);
            mk.on('click', () => select(I, 'report', r.id));
            I.groups.reports.addLayer(mk);
            return mk;
          },
          (mk) => setIconIfChanged(mk, `${isSel}`, () => reportIcon(r, isSel))
        );
      });

    // active incidents
    s.incidents
      .filter((i) => i.status !== 'Resolved')
      .forEach((i) => {
        const [x, y] = incidentPos(i);
        const isSel = sel === i.id;
        const tip = `<strong>${esc(i.title)}</strong><span>${i.id} · ${esc(i.status)} · ${esc(i.severity)} severity</span>`;
        keyed(
          I,
          `i:${i.id}`,
          () => {
            const mk = L.marker(toLL(x, y), { icon: incidentIcon(i, isSel), title: i.title, zIndexOffset: 800 }).addTo(I.groups.incidents);
            mk._sig = `${i.severity}${isSel}`;
            mk.bindTooltip(tip, tipOpts);
            mk.on('click', () => select(I, 'incident', i.id));
            return mk;
          },
          (mk) => (setIconIfChanged(mk, `${i.severity}${isSel}`, () => incidentIcon(i, isSel)), mk.setTooltipContent(tip))
        );
      });
  }

  if (mode === 'resident' && I.opts.alt) {
    s.altWater
      .filter((p) => p.active)
      .forEach((p) => {
        const isSel = sel === p.id;
        const tip = `<strong>${esc(p.name)}</strong><span>${esc(p.status)} · ${esc(p.hours)}</span>`;
        keyed(
          I,
          `w:${p.id}`,
          () => {
            const mk = L.marker(toLL(p.x, p.y), { icon: altIcon(p, isSel), title: p.name }).addTo(I.groups.alt);
            mk._sig = `${p.status}${isSel}`;
            mk.bindTooltip(tip, { ...tipOpts, offset: [0, -34] });
            mk.on('click', () => ((I.selected = p.id), sync(I), actions['alt-select']?.({ dataset: { id: p.id } })));
            return mk;
          },
          (mk) => (setIconIfChanged(mk, `${p.status}${isSel}`, () => altIcon(p, isSel)), mk.setTooltipContent(tip))
        );
      });
  }

  if (mode !== 'provider' && (I.opts.home || mode === 'resident' || mode === 'picker')) {
    keyed(I, 'home', () => L.marker(toLL(RESIDENT.x, RESIDENT.y), { icon: homeIcon(), interactive: true, title: 'Your service address' }).bindTooltip('<strong>Your service address</strong><span>' + esc(RESIDENT.address) + '</span>', tipOpts).addTo(I.groups.home));
  }

  if (mode === 'picker' && I.opts.pin) {
    keyed(
      I,
      'pin',
      () => {
        const mk = L.marker(toLL(I.opts.pin.x, I.opts.pin.y), { icon: pinIcon(), draggable: !I.opts.readonly, autoPan: true, zIndexOffset: 1000, title: 'Problem location' }).addTo(I.groups.pin);
        if (!I.opts.readonly) mk.on('dragend', () => pick(I, mk.getLatLng(), true));
        return mk;
      },
      (mk) => mk.setLatLng(toLL(I.opts.pin.x, I.opts.pin.y))
    );
  }

  // remove markers whose source disappeared (resolved incidents, verified reports...)
  I.markers.forEach((m, k) => {
    if (m._seen) return;
    Object.values(I.groups).forEach((g) => g.hasLayer(m) && g.removeLayer(m));
    I.markers.delete(k);
  });
}

// ---------------------------------------------------------------- street network
const zoneAffected = (s, z) => !!s.zoneIssues[z] || s.tele.zones[z].status !== 'normal';

function drawNetwork(I) {
  // Fictional schematic links drawn before the network loaded are replaced.
  I.pipes.forEach((l, k) => {
    if (!MAP.pipelines.some((pl) => pl.id === k)) (I.groups.pipes.removeLayer(l), I.pipes.delete(k));
  });
  const renderer = L.canvas({ padding: 0.4, tolerance: 6 });
  const s = getState();
  I.net = [];
  // distribution first so mains render on top
  [...network.lines].sort((a, b) => (a.k === b.k ? 0 : a.k === 'd' ? -1 : 1)).forEach((ln) => {
    const z = zoneById(ln.z) || { name: 'Service area' };
    const line = L.polyline(ln.c, { renderer, interactive: true });
    line.bindTooltip(
      () => `<strong>${esc(ln.n || 'Unnamed street')}</strong><span>${ln.k === 'm' ? 'Transmission main' : 'Distribution line'} · ${esc(z.name)}${zoneAffected(getState(), ln.z) ? ' · Pressure below normal' : ''}</span><em>Illustrative routing along OSM roads</em>`,
      { ...tipOpts, sticky: true, offset: [0, -8] }
    );
    line.on('click', () => select(I, 'zone', ln.z));
    line._ln = ln;
    I.groups.pipes.addLayer(line);
    I.net.push(line);
  });
  // Service connections from key assets to the nearest main/distribution vertex
  CONNECT.forEach((id) => {
    const a = s.assets.find((x) => x.id === id);
    if (!a) return;
    const p = toLL(a.x, a.y);
    let best = null;
    let bd = Infinity;
    network.lines.forEach((ln) => {
      ln.c.forEach((c) => {
        const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2;
        if (d < bd) (bd = d), (best = c);
      });
    });
    if (best) {
      const conn = L.polyline([p, best], { renderer, color: NET.main, weight: 3, opacity: 0.9, interactive: false });
      conn._ln = { z: a.zone, k: 'm' };
      I.groups.pipes.addLayer(conn);
      I.net.push(conn);
    }
  });
  I.netSig = null;
}

function syncNetwork(I, s) {
  const sig = ZONES.map((z) => (zoneAffected(s, z.id) ? 1 : 0)).join('');
  if (sig === I.netSig) return;
  I.netSig = sig;
  I.net.forEach((l) => {
    const { z, k } = l._ln;
    const hit = zoneAffected(s, z);
    l.setStyle(k === 'm' ? { color: NET.main, weight: 4, opacity: 1, lineCap: 'round', lineJoin: 'round' } : { color: hit ? NET.issue : NET.dist, weight: hit ? 3 : 2.2, opacity: 0.95, dashArray: hit ? '7 5' : null, lineCap: 'round', lineJoin: 'round' });
  });
}

function select(I, kind, id) {
  I.selected = id;
  sync(I);
  actions['map-select']?.({ dataset: { kind, id } });
}

function pick(I, latlng, fromDrag) {
  const { x, y } = toXY(latlng.lat, latlng.lng);
  I.opts.pin = { x, y };
  I.el.dataset.opts = JSON.stringify(I.opts);
  if (!fromDrag) sync(I);
  actions['map-pick-xy']?.({ dataset: { x, y } });
}
