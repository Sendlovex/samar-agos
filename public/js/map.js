// Schematic SVG service-area map (fictionalized geography) with operational layers.
import { ZONES, MAP, CRITICAL_FACILITIES, RESIDENT, reportTypeLabel } from './data.js';
import { getState, RES_CAP_ML, MIN_RESERVE } from './store.js';
import { esc } from './util.js';
import { liveMapHost } from './livemap.js';

export const LAYERS = [
  { id: 'zones', label: 'Barangays' },
  { id: 'pipes', label: 'Main pipelines' },
  { id: 'storage', label: 'Reservoirs & tanks' },
  { id: 'sources', label: 'Water sources' },
  { id: 'pumps', label: 'Pumps' },
  { id: 'facilities', label: 'Critical facilities' },
  { id: 'reports', label: 'Resident reports' },
  { id: 'incidents', label: 'Active incidents' },
];
export const DEFAULT_LAYERS = LAYERS.map((l) => l.id);

const COL = { normal: '#1F8A4C', warning: '#D97706', critical: '#C0262D', offline: '#8A94A3', info: '#1D6FB8' };
const FILL = { normal: '#EEF6F1', warning: '#FDF1DE', critical: '#FBE3E3', offline: '#EEF0F3' };

export function assetLiveStatus(a, s = getState()) {
  const t = s.tele;
  if (a.type === 'Reservoir') {
    const lv = t.volML / RES_CAP_ML;
    return lv < MIN_RESERVE ? 'critical' : lv < MIN_RESERVE + 0.12 ? 'warning' : 'normal';
  }
  if (a.type === 'Tank') return t.tanks[a.id]?.status || 'normal';
  if (a.type === 'Pump') {
    if (s.pumpsOffline.includes(a.id)) return 'critical';
    return a.status === 'warning' ? 'warning' : 'normal';
  }
  if (a.status === 'offline') return 'offline';
  if (a.status === 'critical') return 'critical';
  if (a.status === 'warning') return 'warning';
  return 'normal';
}

// Incidents without an explicit position sit just off their zone's centre.
export function incidentPos(i) {
  const z = ZONES.find((zz) => zz.id === i.zone);
  return i.pos || [z.label[0] + 18, z.label[1] - 16];
}

export function shape(a, sev, sel) {
  const c = COL[sev];
  const ring = sel ? `<circle r="17" fill="none" stroke="#0B2545" stroke-width="2.5"/>` : '';
  const t = a.type;
  if (t === 'Reservoir')
    return `${ring}<rect x="-13" y="-11" width="26" height="22" rx="4" fill="#fff" stroke="${c}" stroke-width="2.5"/><path d="M-8 2c2.6-2 5.3-2 8 0s5.3 2 8 0" stroke="${c}" stroke-width="2" fill="none"/><path d="M-8 -3h16" stroke="${c}" stroke-width="1.5" opacity=".5"/>`;
  if (t === 'Tank') return `${ring}<rect x="-9" y="-11" width="18" height="22" rx="3" fill="#fff" stroke="${c}" stroke-width="2.4"/><path d="M-9 2h18" stroke="${c}" stroke-width="2"/>`;
  if (t === 'Pump') return `${ring}<circle r="10" fill="#fff" stroke="${c}" stroke-width="2.5"/><path d="M-3-5 5 0l-8 5z" fill="${c}"/>`;
  if (t === 'Water Source' || t === 'Well') return `${ring}<path d="M0-12 11 0 0 12-11 0z" fill="#fff" stroke="${c}" stroke-width="2.4"/><circle r="3.2" fill="${c}"/>`;
  if (t === 'Treatment Equipment') return `${ring}<rect x="-11" y="-11" width="22" height="22" rx="11" fill="#fff" stroke="${c}" stroke-width="2.4"/><path d="M-5 0h10M0-5v10" stroke="${c}" stroke-width="2.2"/>`;
  if (t === 'Sensor') return `${ring}<circle r="6.5" fill="#fff" stroke="${c}" stroke-width="2.2"/><circle r="2.2" fill="${c}"/>`;
  if (t === 'Valve') return `${ring}<path d="M-8-6 8 6M-8 6 8-6" stroke="${c}" stroke-width="2.4"/><path d="M-8-6v12M8-6v12" stroke="${c}" stroke-width="2.4"/>`;
  return `<circle r="6" fill="${c}"/>`;
}

/**
 * opts: { mode:'provider'|'resident'|'picker', layers:[], selected, pin:{x,y}, focusZone, alt:boolean, compact }
 */
export function renderMap(opts = {}) {
  // Real interactive basemap when Leaflet loaded; schematic SVG below is the offline fallback.
  if (window.L) return liveMapHost(opts);
  const s = getState();
  const layers = new Set(opts.layers || DEFAULT_LAYERS);
  const mode = opts.mode || 'provider';
  const sel = opts.selected;
  const t = s.tele;
  let g = '';

  // background
  g += `<rect width="1000" height="620" fill="#F7F9FB"/>`;
  if (MAP.sea) g += `<path d="${MAP.sea}" fill="#DCEBF6"/>`;

  if (layers.has('zones') || mode !== 'provider') {
    ZONES.forEach((z) => {
      const zs = mode === 'picker' ? 'normal' : t.zones[z.id].status;
      const focus = opts.focusZone === z.id;
      g += `<polygon points="${z.poly}" fill="${mode === 'picker' ? '#F1F5F9' : FILL[zs]}" stroke="${focus ? '#0B2545' : '#B9C6D3'}" stroke-width="${focus ? 2.5 : 1.2}" ${mode === 'provider' ? `data-action="map-select" data-kind="zone" data-id="${z.id}" class="mz"` : mode === 'picker' ? 'class="mz-pick"' : ''}/>`;
    });
  }
  if (MAP.river) g += `<path d="${MAP.river}" fill="none" stroke="#9CC7E8" stroke-width="7" stroke-linecap="round" opacity=".9"/>`;

  if (layers.has('pipes') && mode !== 'picker') {
    MAP.pipelines.forEach((p) => {
      const issueZone = s.assets.find((a) => a.id === p.id)?.status === 'warning' ? 'warning' : null;
      const col = issueZone ? COL.warning : p.kind === 'raw' ? '#7C93AA' : '#2C5F8F';
      g += `<polyline points="${p.pts}" fill="none" stroke="${col}" stroke-width="${p.kind === 'main' ? 3.2 : 2}" stroke-linecap="round" stroke-linejoin="round" ${p.kind === 'raw' ? 'stroke-dasharray="7 5"' : ''} ${issueZone ? 'class="pipe-alert"' : ''}/>`;
    });
  }

  if (mode !== 'picker')
    ZONES.forEach((z) => {
      const zt = t.zones[z.id];
      const [lx, ly] = z.label;
      g += `<g class="zlabel" pointer-events="none"><text x="${lx}" y="${ly}" class="map-zone">${esc(z.short.toUpperCase())}</text>`;
      if (mode === 'provider') g += `<text x="${lx}" y="${ly + 16}" class="map-zone-sub" fill="${zt.status === 'normal' ? '#475569' : COL[zt.status]}">${zt.pressure.toFixed(0)} PSI${zt.status !== 'normal' ? ' ▼' : ''}</text>`;
      else g += `<text x="${lx}" y="${ly + 16}" class="map-zone-sub">${esc(z.barangays.slice(0, 2).join(', '))}</text>`;
      g += '</g>';
    });
  else ZONES.forEach((z) => (g += `<text x="${z.label[0]}" y="${z.label[1]}" class="map-zone" pointer-events="none">${esc(z.short.toUpperCase())}</text>`));

  // assets
  if (mode === 'provider') {
    const typeLayer = { Reservoir: 'storage', Tank: 'storage', 'Water Source': 'sources', Well: 'sources', Pump: 'pumps', 'Treatment Equipment': 'sources', Sensor: 'pumps', Valve: 'pipes', Pipeline: 'pipes' };
    s.assets
      .filter((a) => a.x != null && layers.has(typeLayer[a.type]) && a.type !== 'Pipeline')
      .forEach((a) => {
        const sev = assetLiveStatus(a, s);
        g += `<g class="mk" transform="translate(${a.x} ${a.y})" data-action="map-select" data-kind="asset" data-id="${a.id}" tabindex="0" role="button" aria-label="${esc(a.name)} — ${sev}">${shape(a, sev, sel === a.id)}</g>`;
        if (['RES-P13', 'WTP-KUL'].includes(a.id)) g += `<text x="${a.x}" y="${a.y + 26}" class="map-lbl" text-anchor="middle" pointer-events="none">${esc(a.name)}</text>`;
      });
    if (layers.has('facilities'))
      CRITICAL_FACILITIES.forEach((f) => {
        g += `<g class="mk" transform="translate(${f.x} ${f.y})" data-action="map-select" data-kind="facility" data-id="${f.id}" tabindex="0" role="button" aria-label="${esc(f.name)}">${sel === f.id ? '<circle r="15" fill="none" stroke="#0B2545" stroke-width="2.5"/>' : ''}<rect x="-8" y="-8" width="16" height="16" rx="3" fill="#5B21B6"/><path d="M0-4.5v9M-4.5 0h9" stroke="#fff" stroke-width="2.2"/></g>`;
      });
    if (layers.has('reports'))
      s.reports
        .filter((r) => r.status !== 'verified' && !(r.status === 'repair_completed' && r.awaitingVerification === false))
        .forEach((r) => {
          const linked = !!r.incidentId;
          g += `<g class="mk mk-rep" transform="translate(${r.x} ${r.y})" data-action="map-select" data-kind="report" data-id="${r.id}" role="button" aria-label="Resident report ${r.id}, ${esc(reportTypeLabel(r.type))}"><circle r="${sel === r.id ? 7 : 4.5}" fill="${linked ? '#A78BFA' : '#6D28D9'}" stroke="#fff" stroke-width="1.5"/></g>`;
        });
    if (layers.has('incidents'))
      s.incidents
        .filter((i) => i.status !== 'Resolved')
        .forEach((i) => {
          const [x, y] = incidentPos(i);
          const c = i.severity === 'High' || i.severity === 'Critical' ? COL.critical : i.severity === 'Medium' ? COL.warning : COL.info;
          g += `<g class="mk" transform="translate(${x} ${y})" data-action="map-select" data-kind="incident" data-id="${i.id}" tabindex="0" role="button" aria-label="Incident ${i.id}: ${esc(i.title)}">${sel === i.id ? '<circle r="18" fill="none" stroke="#0B2545" stroke-width="2.5"/>' : ''}<path d="M0-13 13 10H-13z" fill="${c}" stroke="#fff" stroke-width="2"/><path d="M0-4v6M0 5.5v.5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></g>`;
        });
  }

  if (mode === 'resident' && opts.alt)
    s.altWater
      .filter((p) => p.active)
      .forEach((p) => {
        const c = p.status === 'AVAILABLE' ? COL.normal : p.status === 'CLOSED' ? COL.offline : COL.warning;
        g += `<g class="mk" transform="translate(${p.x} ${p.y})" data-action="alt-select" data-id="${p.id}" tabindex="0" role="button" aria-label="${esc(p.name)}, ${p.status}"><path d="M0 0c-6-8-10-12-10-17a10 10 0 0 1 20 0c0 5-4 9-10 17z" fill="${sel === p.id ? '#0B2545' : '#0E7490'}" stroke="#fff" stroke-width="2"/><circle cy="-17" r="4" fill="${c}" stroke="#fff" stroke-width="1.5"/></g>`;
      });

  if (opts.home || mode === 'resident') {
    g += `<g transform="translate(${RESIDENT.x} ${RESIDENT.y})" pointer-events="none"><circle r="16" fill="#1D6FB8" opacity=".15"/><circle r="7" fill="#1D6FB8" stroke="#fff" stroke-width="2.5"/></g>`;
    g += `<text x="${RESIDENT.x + 12}" y="${RESIDENT.y + 24}" class="map-lbl" pointer-events="none">Your service address</text>`;
  }
  if (opts.pin) {
    g += `<g transform="translate(${opts.pin.x} ${opts.pin.y})" pointer-events="none"><path d="M0 0c-7-9-12-14-12-20a12 12 0 0 1 24 0c0 6-5 11-12 20z" fill="#C0262D" stroke="#fff" stroke-width="2"/><circle cy="-20" r="4.5" fill="#fff"/></g>`;
  }

  const legend =
    mode === 'provider'
      ? `<div class="map-legend" aria-label="Map legend">
      <span><i class="lg-dot" style="background:${COL.normal}"></i>Normal</span><span><i class="lg-dot" style="background:${COL.warning}"></i>Warning</span><span><i class="lg-dot" style="background:${COL.critical}"></i>Critical</span><span><i class="lg-dot" style="background:${COL.offline}"></i>Offline / unknown</span><span><i class="lg-dot" style="background:#6D28D9"></i>Resident report</span><span><i class="lg-tri"></i>Incident</span></div>`
      : '';
  const toggles =
    mode === 'provider' && opts.toggles !== false
      ? `<div class="map-layers" role="group" aria-label="Map layers">${icon_layers()}${LAYERS.map((l) => `<label class="chk-chip"><input type="checkbox" data-change="map-layer" value="${l.id}" ${layers.has(l.id) ? 'checked' : ''}/> ${l.label}</label>`).join('')}</div>`
      : '';
  return `<div class="map ${opts.compact ? 'map--compact' : ''}">${toggles}<div class="map-canvas"><svg viewBox="0 0 1000 620" class="map-svg ${mode === 'picker' && !opts.readonly ? 'map-svg--pick' : ''}" ${mode === 'picker' && !opts.readonly ? 'data-action="map-pick"' : ''} role="${mode === 'picker' && !opts.readonly ? 'application' : 'img'}" aria-label="${mode === 'picker' && !opts.readonly ? 'Tap the map to set the problem location' : 'Schematic service area map'}">${g}</svg><div class="map-note">Schematic map, barangay boundaries from OpenStreetMap</div></div>${legend}</div>`;
}

function icon_layers() {
  return `<span class="map-layers-l"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 2 10 5-10 5L2 7l10-5z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>Layers</span>`;
}

export function svgPoint(svg, e) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return { x: Math.round(p.x), y: Math.round(p.y) };
}
