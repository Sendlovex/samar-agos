// Lightweight SVG charts (line/area, bar, sparkline) with crosshair tooltips.
import { esc } from './util.js';

const registry = new Map();
let uid = 0;
const _set = registry.set.bind(registry);
registry.set = (k, v) => {
  registry.delete(k);
  if (registry.size > 150) registry.delete(registry.keys().next().value);
  return _set(k, v);
};

const C = {
  grid: '#E6EBF1',
  axis: '#8A97A8',
  text: '#5B6B80',
};

// Use the chart's last measured on-screen width as its SVG coordinate width so
// text renders at true size. Falls back to 640 on first render.
const widths = new Map();
function widthFor(id) {
  const el = document.querySelector(`[data-chart-wrap="${id}"]`);
  const w = el?.clientWidth;
  if (w > 200) widths.set(id, Math.round(w));
  return widths.get(id);
}
export function measureCharts(root = document) {
  let changed = false;
  root.querySelectorAll('[data-chart-wrap]').forEach((el) => {
    const w = Math.round(el.clientWidth);
    if (w > 200 && Math.abs((widths.get(el.dataset.chartWrap) || 640) - w) > 24) (widths.set(el.dataset.chartWrap, w), (changed = true));
  });
  return changed;
}

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const lo = Math.floor(min / step) * step;
  const out = [];
  for (let v = lo; v <= max + step * 0.001; v += step) if (v >= min - step * 0.001) out.push(+v.toFixed(6));
  return out;
}

/**
 * lineChart({ series:[{name,color,values,dash,area,width}], labels:[], xTicks:[{i,label}],
 *   yMin, yMax, yFmt, thresholds:[{y,label,color}], bands:[{from,to,label}], nowIndex, h, tip })
 */
export function lineChart(o) {
  const id = o.id || `ch${++uid}`;
  const w = o.w || widthFor(id) || 640;
  const h = o.h || 220;
  const pad = { l: 46, r: 14, t: 14, b: 26, ...(o.pad || {}) };
  const n = Math.max(...o.series.map((s) => s.values.length));
  const all = o.series.flatMap((s) => s.values.filter((v) => v != null));
  (o.thresholds || []).forEach((t) => all.push(t.y));
  (o.ranges || []).forEach((r) => all.push(...r.lo.filter((v) => v != null), ...r.hi.filter((v) => v != null)));
  let yMin = o.yMin ?? Math.min(...all);
  let yMax = o.yMax ?? Math.max(...all);
  if (o.yMin == null) yMin -= (yMax - yMin) * 0.08;
  if (o.yMax == null) yMax += (yMax - yMin) * 0.08;
  const ticks = niceTicks(yMin, yMax, o.yTickCount || 4);
  const x = (i) => pad.l + (i / Math.max(1, n - 1)) * (w - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin || 1)) * (h - pad.t - pad.b);
  const yFmt = o.yFmt || ((v) => v);

  const path = (vals) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) return (pen = false);
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const area = (vals) => {
    const idx = vals.map((v, i) => (v == null ? null : i)).filter((i) => i != null);
    if (!idx.length) return '';
    const base = y(Math.max(yMin, Math.min(...ticks)));
    return `${path(vals)}L${x(idx[idx.length - 1]).toFixed(1)},${base}L${x(idx[0]).toFixed(1)},${base}Z`;
  };

  let svg = `<svg viewBox="0 0 ${w} ${h}" class="chart-svg" role="img" aria-label="${esc(o.label || 'Chart')}" data-chart="${id}">`;
  (o.bands || []).forEach((b) => {
    svg += `<rect x="${x(b.from)}" y="${pad.t}" width="${x(b.to) - x(b.from)}" height="${h - pad.t - pad.b}" fill="${b.color || '#F2F6FA'}"/>`;
    if (b.label) svg += `<text x="${x(b.from) + 6}" y="${pad.t + 12}" class="ch-band">${esc(b.label)}</text>`;
  });
  ticks.forEach((t) => {
    svg += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke="${C.grid}" stroke-width="1"/>`;
    svg += `<text x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end" class="ch-tick">${esc(yFmt(t))}</text>`;
  });
  (o.xTicks || []).forEach((t) => {
    svg += `<text x="${x(t.i)}" y="${h - 8}" text-anchor="${t.i === 0 ? 'start' : t.i >= n - 1 ? 'end' : 'middle'}" class="ch-tick">${esc(t.label)}</text>`;
  });
  (o.thresholds || []).forEach((t) => {
    svg += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(t.y)}" y2="${y(t.y)}" stroke="${t.color || '#C0262D'}" stroke-width="1.5" stroke-dasharray="5 4"/>`;
    svg += `<text x="${w - pad.r - 4}" y="${y(t.y) - 5}" text-anchor="end" class="ch-thr" fill="${t.color || '#C0262D'}">${esc(t.label)}</text>`;
  });
  if (o.nowIndex != null) {
    svg += `<line x1="${x(o.nowIndex)}" x2="${x(o.nowIndex)}" y1="${pad.t}" y2="${h - pad.b}" stroke="#94A3B8" stroke-width="1"/>`;
    svg += `<text x="${x(o.nowIndex) + 4}" y="${h - pad.b - 6}" class="ch-band">Now</text>`;
  }
  // Shaded ranges (e.g. forecast uncertainty): polygon between hi and lo where both exist.
  (o.ranges || []).forEach((r) => {
    const idx = r.lo.map((v, i) => (v == null || r.hi[i] == null ? null : i)).filter((i) => i != null);
    if (idx.length < 2) return;
    const clampY = (v) => y(Math.max(yMin, Math.min(yMax, v)));
    const d = idx.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${clampY(r.hi[i]).toFixed(1)}`).join('') + [...idx].reverse().map((i) => `L${x(i).toFixed(1)},${clampY(r.lo[i]).toFixed(1)}`).join('') + 'Z';
    svg += `<path d="${d}" fill="${r.color || '#5B7BA3'}" opacity="${r.opacity ?? 0.16}"/>`;
  });
  o.series.forEach((s) => {
    if (s.area) svg += `<path d="${area(s.values)}" fill="${s.color}" opacity="0.09"/>`;
  });
  o.series.forEach((s) => {
    svg += `<path d="${path(s.values)}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? 'stroke-dasharray="6 4"' : ''}/>`;
    if (s.endLabel) {
      const last = s.values.map((v, i) => [v, i]).filter(([v]) => v != null).pop();
      if (last) svg += `<circle cx="${x(last[1])}" cy="${y(last[0])}" r="3.5" fill="${s.color}" stroke="#fff" stroke-width="2"/>`;
    }
  });
  svg += `<g class="ch-hover" style="display:none"><line class="ch-x" y1="${pad.t}" y2="${h - pad.b}" stroke="#64748B" stroke-width="1"/>${o.series.map((s) => `<circle r="4" fill="${s.color}" stroke="#fff" stroke-width="2"/>`).join('')}</g>`;
  svg += `<rect x="${pad.l}" y="${pad.t}" width="${w - pad.l - pad.r}" height="${h - pad.t - pad.b}" fill="transparent" class="ch-hit"/>`;
  svg += '</svg>';

  registry.set(id, { type: 'line', n, x, y, w, h, series: o.series, labels: o.labels || [], tip: o.tip, yFmt });

  const legend =
    o.series.length > 1 || o.legend
      ? `<div class="ch-legend">${o.series.map((s) => `<span><i style="background:${s.color};${s.dash ? 'background:repeating-linear-gradient(90deg,' + s.color + ' 0 5px,transparent 5px 8px)' : ''}"></i>${esc(s.name)}</span>`).join('')}${(o.ranges || []).filter((r) => r.name).map((r) => `<span><i style="background:${r.color || '#5B7BA3'};opacity:${Math.min(1, (r.opacity ?? 0.16) * 2.5)}"></i>${esc(r.name)}</span>`).join('')}${(o.thresholds || []).map((t) => `<span><i class="thr" style="border-color:${t.color || '#C0262D'}"></i>${esc(t.label)}</span>`).join('')}</div>`
      : '';
  return `<div class="chart" data-chart-wrap="${id}">${legend}${svg}<div class="ch-tip" hidden></div>${srTable(o)}</div>`;
}

function srTable(o) {
  const lab = o.labels || [];
  const n = Math.max(...o.series.map((s) => s.values.length));
  const stepN = Math.max(1, Math.floor(n / 12));
  let rows = '';
  for (let i = 0; i < n; i += stepN) rows += `<tr><th>${esc(lab[i] ?? i)}</th>${o.series.map((s) => `<td>${s.values[i] == null ? '—' : esc((o.yFmt || ((v) => v))(s.values[i]))}</td>`).join('')}</tr>`;
  return `<table class="sr-only"><caption>${esc(o.label || 'Chart data')}</caption><tr><th>Point</th>${o.series.map((s) => `<th>${esc(s.name)}</th>`).join('')}</tr>${rows}</table>`;
}

/** barChart({ bars:[{label,value,color,hatch,tip}], yFmt, h, label }) */
export function barChart(o) {
  const id = o.id || `ch${++uid}`;
  const w = o.w || widthFor(id) || 640;
  const h = o.h || 220;
  const pad = { l: 40, r: 10, t: 14, b: 28 };
  const max = (o.yMax ?? Math.max(...o.bars.map((b) => b.value))) * 1.1;
  const ticks = niceTicks(0, max, 4);
  const top = Math.max(max, ticks[ticks.length - 1]);
  const y = (v) => pad.t + (1 - v / top) * (h - pad.t - pad.b);
  const bw = (w - pad.l - pad.r) / o.bars.length;
  const yFmt = o.yFmt || ((v) => v);
  let svg = `<svg viewBox="0 0 ${w} ${h}" class="chart-svg" role="img" aria-label="${esc(o.label || 'Bar chart')}" data-chart="${id}">
  <defs><pattern id="hatch-${id}" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><rect width="6" height="6" fill="#DCE7F3"/><line x1="0" y1="0" x2="0" y2="6" stroke="#5B8DC4" stroke-width="2.2"/></pattern></defs>`;
  ticks.forEach((t) => {
    svg += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke="${C.grid}"/>`;
    svg += `<text x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end" class="ch-tick">${esc(yFmt(t))}</text>`;
  });
  o.bars.forEach((b, i) => {
    const bx = pad.l + i * bw + bw * 0.18;
    const width = bw * 0.64;
    const by = y(b.value);
    const hh = Math.max(1, y(0) - by);
    const r = Math.min(4, width / 2);
    const d = `M${bx},${y(0)}V${by + r}Q${bx},${by} ${bx + r},${by}H${bx + width - r}Q${bx + width},${by} ${bx + width},${by + r}V${y(0)}Z`;
    svg += `<path d="${d}" fill="${b.hatch ? `url(#hatch-${id})` : b.color || '#1D6FB8'}" ${b.hatch ? `stroke="${b.color || '#1D6FB8'}" stroke-width="1"` : ''} class="ch-bar" data-i="${i}"/>`;
    if (b.showValue) svg += `<text x="${bx + width / 2}" y="${by - 5}" text-anchor="middle" class="ch-val">${esc(yFmt(b.value))}</text>`;
    const every = Math.max(o.labelEvery || 1, Math.ceil(30 / bw));
    if (i % every === 0 || i === o.bars.length - 1) svg += `<text x="${bx + width / 2}" y="${h - 9}" text-anchor="middle" class="ch-tick">${esc(b.label)}</text>`;
    svg += `<rect x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${h - pad.t - pad.b}" fill="transparent" class="ch-barhit" data-i="${i}"/>`;
  });
  svg += '</svg>';
  registry.set(id, { type: 'bar', bars: o.bars, yFmt, w });
  const rows = o.bars.map((b) => `<tr><th>${esc(b.label)}</th><td>${esc(yFmt(b.value))}</td><td>${b.hatch ? 'Estimated' : ''}</td></tr>`).join('');
  return `<div class="chart" data-chart-wrap="${id}">${o.legendHtml || ''}${svg}<div class="ch-tip" hidden></div><table class="sr-only"><caption>${esc(o.label || '')}</caption>${rows}</table></div>`;
}

export function sparkline(values, { color = '#1D6FB8', w = 88, h = 26, min, max } = {}) {
  if (!values || values.length < 2) return '';
  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values);
  const x = (i) => (i / (values.length - 1)) * (w - 4) + 2;
  const y = (v) => h - 3 - ((v - lo) / (hi - lo || 1)) * (h - 6);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = values[values.length - 1];
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/><circle cx="${x(values.length - 1)}" cy="${y(last)}" r="2.4" fill="${color}"/></svg>`;
}

export function gaugeBar(pct, { sev = 'normal', marker } = {}) {
  const p = Math.max(0, Math.min(100, pct));
  return `<div class="gbar gbar--${sev}" role="meter" aria-valuenow="${Math.round(p)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${p}%"></span>${marker != null ? `<i style="left:${marker}%" title="Minimum reserve ${marker}%"></i>` : ''}</div>`;
}

// ------------------------------------------------ hover handling (installed once)
export function installChartHover() {
  const move = (e) => {
    const svg = e.target.closest('svg[data-chart]');
    if (!svg) return;
    const c = registry.get(svg.dataset.chart);
    const wrap = svg.closest('.chart');
    const tip = wrap?.querySelector('.ch-tip');
    if (!c || !tip) return;
    const rect = svg.getBoundingClientRect();
    const scale = rect.width / c.w;
    if (c.type === 'line') {
      const px = (e.clientX - rect.left) / scale;
      let best = 0, bd = Infinity;
      for (let i = 0; i < c.n; i++) {
        const d = Math.abs(c.x(i) - px);
        if (d < bd) (bd = d), (best = i);
      }
      const g = svg.querySelector('.ch-hover');
      g.style.display = '';
      const lx = c.x(best);
      g.querySelector('.ch-x').setAttribute('x1', lx);
      g.querySelector('.ch-x').setAttribute('x2', lx);
      const dots = g.querySelectorAll('circle');
      let rows = '';
      c.series.forEach((s, k) => {
        const v = s.values[best];
        if (v == null) return dots[k].setAttribute('r', 0);
        dots[k].setAttribute('r', 4);
        dots[k].setAttribute('cx', lx);
        dots[k].setAttribute('cy', c.y(v));
        rows += `<div class="ch-tip-r"><i style="background:${s.color}"></i>${esc(s.name)}<b>${esc(c.yFmt(v))}</b></div>`;
      });
      if (!rows) return hide(svg);
      tip.innerHTML = `<div class="ch-tip-h">${esc(c.labels[best] ?? '')}</div>${rows}${c.tip ? c.tip(best) : ''}`;
      place(tip, wrap, lx * scale + (rect.left - wrap.getBoundingClientRect().left), rect.top - wrap.getBoundingClientRect().top + 20);
    } else {
      const el = e.target.closest('[data-i]');
      if (!el) return hide(svg);
      const b = c.bars[+el.dataset.i];
      svg.querySelectorAll('.ch-bar').forEach((x) => x.classList.toggle('is-dim', x.dataset.i !== el.dataset.i));
      tip.innerHTML = `<div class="ch-tip-h">${esc(b.label)}</div><div class="ch-tip-r"><b>${esc(c.yFmt(b.value))}</b></div>${b.tip ? `<div class="ch-tip-n">${b.tip}</div>` : ''}`;
      const r = el.getBoundingClientRect();
      place(tip, wrap, r.left + r.width / 2 - wrap.getBoundingClientRect().left, r.top - wrap.getBoundingClientRect().top + 10);
    }
  };
  const hide = (svg) => {
    const g = svg.querySelector('.ch-hover');
    if (g) g.style.display = 'none';
    svg.querySelectorAll('.ch-bar').forEach((x) => x.classList.remove('is-dim'));
    const tip = svg.closest('.chart')?.querySelector('.ch-tip');
    if (tip) tip.hidden = true;
  };
  document.addEventListener('mousemove', move);
  document.addEventListener(
    'mouseout',
    (e) => {
      const svg = e.target.closest?.('svg[data-chart]');
      if (svg && !svg.contains(e.relatedTarget)) hide(svg);
    },
    true
  );
}

function place(tip, wrap, left, top) {
  tip.hidden = false;
  const ww = wrap.clientWidth;
  const tw = tip.offsetWidth;
  let l = left + 14;
  if (l + tw > ww) l = left - tw - 14;
  tip.style.left = `${Math.max(0, l)}px`;
  tip.style.top = `${top}px`;
}
