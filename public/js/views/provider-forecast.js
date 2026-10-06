// Provider: Shortage early warning (forecast) and Response Simulator.
import * as S from '../store.js';
import { icon, status, src, card, empty, register, registerInputs, alertBanner, openModal, closeOverlay, field, SEV } from '../ui.js';
import { lineChart, barChart } from '../charts.js';
import { esc, fmt, fmtL, fmtTime, hoursLabel, relTime } from '../util.js';
import { weatherState, dayImpacts, describe as wxDescribe, wIcon, WEATHER_BASE } from '../weather.js';
import { go } from '../app.js';

const st = () => S.getState();
const pct = (v) => `${Math.round(v * 100)}%`;

function historyAndForecast(fc, id, { h = 260, forecastSeries } = {}) {
  const s = st();
  const hist = s.history.level.filter((_, i, a) => (a.length - 1 - i) % 6 === 0); // 30-min samples
  const fpts = fc.pts.filter((p) => p.h > 0 && p.h <= 48);
  const n = hist.length + fpts.length;
  const histVals = [...hist.map((v) => v * 100), ...fpts.map(() => null)];
  const fcVals = [...hist.map((v, i) => (i === hist.length - 1 ? v * 100 : null)), ...fpts.map((p) => p.pct * 100)];
  const labels = [...hist.map((_, i) => `${((i - hist.length + 1) / 2).toFixed(1)} h`), ...fpts.map((p) => `+${p.h} h`)];
  const nowI = hist.length - 1;
  const series = [
    { name: 'Measured storage (simulated)', color: '#1E3A5F', values: histVals, area: true },
    { name: 'Forecast storage', color: '#5B7BA3', values: fcVals, dash: true, endLabel: true },
  ];
  if (forecastSeries) series.push(forecastSeries(hist.length));
  return lineChart({
    id,
    label: 'Reservoir storage: past 24 hours and 48-hour forecast',
    series,
    labels,
    xTicks: [
      { i: 0, label: '−24 h' },
      { i: nowI - 24, label: '−12 h' },
      { i: nowI + 24, label: '+12 h' },
      { i: nowI + 48, label: '+24 h' },
      { i: n - 1, label: '+48 h' },
    ],
    nowIndex: nowI,
    bands: [{ from: nowI, to: n - 1, color: '#F5F7FA', label: 'FORECAST' }],
    thresholds: [{ y: 30, label: 'Minimum reserve 30%', color: '#C0262D' }],
    yMin: 0,
    yMax: 100,
    yFmt: (v) => `${Math.round(v)}%`,
    h,
  });
}

// ---------------------------------------------------------------- FORECAST
const sentence = (t) => t.charAt(0) + t.slice(1).toLowerCase();
const dot = (cls) => `<span class="sys-dot sys-dot--${cls}" aria-hidden="true"></span>`;
const signed = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), 0)}%`;
const dayName = (date, i) => (i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' }));

// Plain-language weather effects; shared by the weather card and "why" list.
function weatherEffects() {
  const imp = dayImpacts();
  if (!imp.length) return null;
  const hot = imp.reduce((a, b) => (b.demandPct > a.demandPct ? b : a));
  const wet = imp.filter((x) => x.rainNote === 'heavy' || x.rainNote === 'moderate').sort((a, b) => b.rain - a.rain)[0];
  const dry = imp.every((x) => x.rainNote === 'dry');
  const gust = imp.reduce((a, b) => ((b.gust || 0) > (a.gust || 0) ? b : a));
  const day = (x) => dayName(x.date, imp.indexOf(x));
  const demand =
    hot.demandPct > 0.5
      ? { sev: 'warn', label: 'Water demand', value: signed(hot.demandPct), text: `${day(hot)}: high of ${fmt(hot.tmax, 0)} °C, above the ${WEATHER_BASE.tmax} °C typical maximum`, reason: `Hot weather (${day(hot).toLowerCase()}, ${fmt(hot.tmax, 0)} °C) may raise demand by about ${fmt(hot.demandPct, 0)}%` }
      : { sev: 'off', label: 'Water demand', value: 'No change', text: `Temperatures near normal (highs up to ${fmt(Math.max(...imp.map((x) => x.tmax)), 0)} °C)` };
  const supply = wet
    ? { sev: wet.rainNote === 'heavy' ? 'crit' : 'warn', label: 'Treatment output', value: signed(wet.supplyPct), text: `${day(wet)}: ${fmt(wet.rain, 0)} mm of rain — muddier river intake slows treatment`, reason: `Rain ${day(wet).toLowerCase()} (${fmt(wet.rain, 0)} mm) may reduce treatment output by about ${fmt(-wet.supplyPct, 0)}% while the intake water is muddy` }
    : dry
      ? { sev: 'warn', label: 'River inflow', value: signed(-6), text: `Under ${WEATHER_BASE.dryTotalMm} mm of rain expected in 3 days — river flow drops`, reason: `A dry spell (under ${WEATHER_BASE.dryTotalMm} mm of rain in 3 days) may reduce river inflow by about 6%` }
      : { sev: 'off', label: 'River inflow', value: 'No change', text: 'Rainfall within normal range for the intake' };
  const wind =
    (gust.gust || 0) >= WEATHER_BASE.gustRiskKmh
      ? { sev: 'crit', label: 'Storm risk', value: `${fmt(gust.gust, 0)} km/h`, text: `${day(gust)}: strong gusts — check standby power at pump stations`, reason: `Strong gusts up to ${fmt(gust.gust, 0)} km/h ${day(gust).toLowerCase()} could interrupt power to pump stations` }
      : { sev: 'off', label: 'Storm risk', value: 'Low', text: `Gusts up to ${fmt(gust.gust || 0, 0)} km/h; no disruption expected` };
  return [demand, supply, wind];
}

function weatherCard() {
  const { data, status } = weatherState();
  if (status === 'loading' && !data) return card('Weather & climate outlook', '<p class="muted">Loading the weather forecast for Catbalogan City…</p>', { actions: src('FORECAST') });
  if (!data) return card('Weather & climate outlook', empty('Weather forecast unavailable', 'The shortage forecast is running without weather adjustments. It will retry automatically.', 'cloud'), { actions: src('FORECAST') });
  const c = data.current;
  const now = wxDescribe(c.weather_code);
  const d = data.daily;
  const fx = weatherEffects();
  const rain = data.hourly.precipitation.slice(new Date().getHours(), new Date().getHours() + 48);
  const rainTimes = data.hourly.time.slice(new Date().getHours(), new Date().getHours() + 48);
  return card(
    'Weather & climate outlook',
    `<div class="wx">
      <div class="wx-now">
        <div class="wx-now-h">${wIcon(now.icon, 34)}<div><div class="wx-temp">${fmt(c.temperature_2m, 0)}°<small>C</small></div><div class="wx-cond">${now.text}</div></div></div>
        <dl class="wx-meta"><div><dt>Feels like</dt><dd>${fmt(c.apparent_temperature, 0)} °C</dd></div><div><dt>Humidity</dt><dd>${fmt(c.relative_humidity_2m, 0)}%</dd></div><div><dt>Wind</dt><dd>${fmt(c.wind_speed_10m, 0)} km/h</dd></div><div><dt>Rain now</dt><dd>${fmt(c.precipitation || 0, 1)} mm</dd></div></dl>
      </div>
      <div class="wx-days">${d.time
        .map((date, i) => {
          const w = wxDescribe(d.weather_code[i]);
          return `<div class="wx-day"><div class="wx-day-n">${dayName(date, i)}</div>${wIcon(w.icon, 26)}<div class="wx-day-c">${w.text}</div><div class="wx-day-t"><strong>${fmt(d.temperature_2m_max[i], 0)}°</strong> / ${fmt(d.temperature_2m_min[i], 0)}°</div><div class="wx-day-r">${fmt(d.precipitation_sum[i] || 0, 0)} mm · ${fmt(d.precipitation_probability_max[i] || 0, 0)}%</div></div>`;
        })
        .join('')}</div>
      <div class="wx-fx"><div class="wx-fx-h"><span>Effect on water supply</span>${src('ESTIMATED')}</div>
        <ul>${fx.map((x) => `<li>${dot(x.sev)}<div><div class="wx-fx-l">${x.label}<strong>${x.value}</strong></div><div class="wx-fx-t">${esc(x.text)}</div></div></li>`).join('')}</ul>
      </div>
    </div>
    <div class="wx-rain">${barChart({ id: 'wx-rain', label: 'Rainfall, next 48 hours, millimetres per hour', bars: rain.map((v, i) => ({ label: i % 12 === 0 ? new Date(rainTimes[i]).toLocaleTimeString('en-US', { weekday: 'short', hour: 'numeric' }) : '', value: v || 0, color: '#8A9BB0', tip: `${new Date(rainTimes[i]).toLocaleString('en-US', { weekday: 'short', hour: 'numeric' })} · ${fmt(v || 0, 1)} mm` })), yFmt: (v) => `${fmt(v, 1)}`, h: 110, yMax: Math.max(2, ...rain.map((v) => v || 0)) })}
      <div class="chart-cap">Rainfall, next 48 hours (mm per hour) ${src('FORECAST')}</div></div>`,
    { sub: `Catbalogan City · Open-Meteo forecast · updated ${fmtTime(data.fetchedAt)}`, actions: src('FORECAST') }
  );
}

function forecastMain() {
  const s = st();
  const t = s.tele;
  const fc = S.forecast({ hours: 72 });
  const fs = S.FORECAST_STATUS[fc.status];
  const fx = weatherEffects();
  const reasons = [...S.forecastReasons(), ...(fx || []).filter((x) => x.reason).map((x) => x.reason)];
  const warn = fc.status === 'risk' || fc.status === 'critical';
  const hist24 = s.history.demand.reduce((a, b) => a + b, 0) / s.history.demand.length;
  const rows = [
    ['Now', fc.now, 'SIMULATED'],
    ['In 6 hours', fc.at6, 'FORECAST'],
    ['In 12 hours', fc.at12, 'FORECAST'],
    ['In 24 hours', fc.at24, 'FORECAST'],
    ['In 48 hours', fc.at48, 'FORECAST'],
  ];
  const below = fc.now <= S.MIN_RESERVE;
  const msg = below
    ? 'Storage is already below the 30% minimum reserve.'
    : fc.crossH != null
      ? `Based on current conditions, storage may reach the minimum reserve in approximately <strong>${hoursLabel(fc.crossH)}</strong>.`
      : 'Based on current conditions, storage stays above the minimum reserve for the next 72 hours.';
  const imp = dayImpacts()[0];
  return `<div class="ops-grid ops-grid--eq">
    ${card(
      'Supply outlook',
      `<div class="fc-status">${dot(SEV[fs.sev].cls)}<div><span>Status</span><strong>${sentence(fs.label)}</strong></div></div>
      <p class="fc-msg">${msg}</p>
      <table class="fc-tbl"><tbody>${rows
        .map(([l, v, sr]) => `<tr><th>${l}</th><td><div class="meter"><span style="width:${Math.max(0, Math.min(100, v * 100))}%"></span><i style="left:30%"></i></div></td><td class="num"><strong>${pct(v)}</strong></td><td>${src(sr)}</td></tr>`)
        .join('')}
        <tr class="fc-min"><th>Minimum reserve</th><td></td><td class="num"><strong>30%</strong></td><td>${src('MANUAL')}</td></tr></tbody></table>`,
      { actions: src('FORECAST') }
    )}
    ${card(
      warn ? 'Why this warning appeared' : fc.status === 'watch' ? 'Why storage is declining' : 'Why the outlook is stable',
      `<ol class="why">${reasons.map((r) => `<li><span class="why-n" aria-hidden="true"></span><span>${esc(r)}</span></li>`).join('')}</ol>
      <div class="fc-actions"><a class="btn btn--primary btn--sm" href="#/p/simulator">${icon('sliders', 15)} Test responses in simulator</a>${warn ? `<a class="btn btn--outline btn--sm" href="#/p/advisories">${icon('megaphone', 15)} Prepare advisory</a>` : ''}</div>
      <p class="fine">Forecasts are projections based on current conditions${S.weatherActive() ? ' and the weather outlook' : ''}. They are not guaranteed.</p>`
    )}
  </div>
  ${weatherCard()}
  ${card('Storage trend and forecast', historyAndForecast(fc, 'fc-main'), { sub: 'Central Reservoir level · past 24 h (simulated telemetry) and next 48 h (forecast)' })}
  ${card(
    'Forecast inputs',
    `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Input</th><th class="num">Value</th><th>Source</th><th>Notes</th></tr></thead><tbody>
      <tr><td>Current storage</td><td class="num">${fmt(t.volML, 2)} ML (${pct(fc.now)})</td><td>${src('SIMULATED')}</td><td class="muted">Central Reservoir, 2.0 ML capacity</td></tr>
      <tr><td>Production capacity</td><td class="num">${fmt(S.productionCapacity(), 2)} ML/day</td><td>${src('SIMULATED')}</td><td class="muted">Intake + Deep Wells 1 & 2${s.pumpsOffline.length ? ' · PS-01 offline' : ''}</td></tr>
      <tr><td>Reservoir inflow</td><td class="num">${fmt(S.mlToLs(t.production + t.transfer), 0)} L/s</td><td>${src('SIMULATED')}</td><td class="muted">Plant output follows demand above 72% operating level</td></tr>
      <tr><td>Consumption history (24 h avg)</td><td class="num">${fmt(hist24, 2)} ML/day</td><td>${src('SIMULATED')}</td><td class="muted">From outlet flow meter</td></tr>
      <tr><td>Current demand</td><td class="num">${fmt(t.demand, 2)} ML/day</td><td>${src('SIMULATED')}</td><td class="muted">Instantaneous rate incl. estimated losses</td></tr>
      <tr><td>Estimated demand (next 24 h avg)</td><td class="num">${fmt(fc.avgDemand, 2)} ML/day</td><td>${src('ESTIMATED')}</td><td class="muted">Daily demand pattern × current demand factor${imp ? ' × weather' : ''}</td></tr>
      <tr><td>Weather: demand adjustment (today)</td><td class="num">${imp ? signed(imp.demandPct) : '—'}</td><td>${src('ESTIMATED')}</td><td class="muted">+${WEATHER_BASE.hotPctPerDeg}% per °C above a ${WEATHER_BASE.tmax} °C daily high (Open-Meteo forecast)</td></tr>
      <tr><td>Weather: supply adjustment (today)</td><td class="num">${imp ? signed(imp.supplyPct) : '—'}</td><td>${src('ESTIMATED')}</td><td class="muted">−15% at ≥${WEATHER_BASE.heavyRainMm} mm/day rain, −5% at ≥${WEATHER_BASE.moderateRainMm} mm, −6% in a dry spell</td></tr>
      <tr><td>Reserve threshold</td><td class="num">30% (0.60 ML)</td><td>${src('MANUAL')}</td><td class="muted">Operating policy</td></tr>
    </tbody></table></div><p class="fine">Model: mass balance (storage + production − estimated demand) in 15-minute steps over 72 hours, adjusted by the daily weather outlook. Updated with every telemetry update.</p>`
  )}`;
}

const forecastView = {
  title: 'Forecast',
  regions: { main: forecastMain },
  render() {
    return `<div class="page-h"><div><h1>Shortage Early Warning</h1><p class="page-sub">Supply-demand forecast with the local weather outlook. Act before shortages become severe.</p></div></div><div data-region="main">${forecastMain()}</div>`;
  },
};

// ---------------------------------------------------------------- SIMULATOR
const SIM0 = { prodDelta: 0, backup: false, emergencyL: 0, reducePct: 0, restorePumps: false, inflowPct: 0, demandPct: 0 };
let sim = { ...SIM0 };
let simInc = null;
let simLabel = 'Custom response';

const CONTROLS = [
  { k: 'prodDelta', label: 'Increase production', unit: 'ML/day', min: 0, max: 1, step: 0.05, desc: 'Additional treated-water output from existing sources.' },
  { k: 'emergencyL', label: 'Add emergency stored water', unit: 'L', min: 0, max: 800000, step: 10000, desc: 'Backup storage released into the system.' },
  { k: 'reducePct', label: 'Reduce distribution', unit: '%', min: 0, max: 30, step: 1, desc: 'Pressure management or scheduled supply rotation.' },
  { k: 'inflowPct', label: 'Change raw-water inflow', unit: '%', min: -50, max: 30, step: 1, desc: 'Change in river intake inflow.' },
  { k: 'demandPct', label: 'Change expected demand', unit: '%', min: -30, max: 40, step: 1, desc: 'Test higher or lower demand assumptions.' },
];

function scenarioCard(title, sub, fc, base, color, tone) {
  const pts = fc.pts.filter((p) => p.h <= 72);
  const chart = lineChart({
    id: `sim-${tone}`,
    label: `${title} storage projection`,
    series: [{ name: title, color, values: pts.map((p) => p.pct * 100), area: true, dash: tone === 'b', endLabel: true }],
    labels: pts.map((p) => `+${p.h} h`),
    xTicks: [0, 24, 48, 72].map((h) => ({ i: pts.findIndex((p) => p.h >= h), label: h ? `+${h} h` : 'Now' })),
    thresholds: [{ y: 30, label: 'Min. reserve', color: '#C0262D' }],
    yMin: 0,
    yMax: 100,
    yFmt: (v) => `${Math.round(v)}%`,
    h: 170,
  });
  const gain = base && fc.crossH !== base.crossH ? (fc.crossH ?? 72) - (base.crossH ?? 72) : null;
  return `<section class="scn-card scn-card--${tone}">
    <div class="scn-card-h"><span class="scn-tag">${tone === 'a' ? 'Scenario A' : 'Scenario B'}</span><strong>${esc(title)}</strong><span class="muted sm">${esc(sub)}</span></div>
    <div class="scn-metrics">
      <div><span>Reserve threshold reached in</span><strong>${fc.crossH != null ? hoursLabel(fc.crossH) : '> 72 hours'}</strong></div>
      <div><span>Storage at 24 h</span><strong>${pct(fc.at24)}</strong></div>
      <div><span>Lowest level (72 h)</span><strong>${pct(fc.minPct)}</strong></div>
    </div>
    ${gain != null ? `<div class="scn-gain ${gain > 0 ? 'up' : 'down'}">${icon(gain > 0 ? 'arrow-up' : 'arrow-down', 15)} ${gain > 0 ? '+' : ''}${fmt(gain, 0)} hours estimated service buffer${fc.crossH == null ? ' (no crossing within 72 h)' : ''}</div>` : tone === 'b' ? `<div class="scn-gain">No change from Scenario A</div>` : `<div class="scn-gain">Baseline for comparison</div>`}
    ${chart}
  </section>`;
}

function simResults() {
  const a = S.forecast({ hours: 72 });
  const b = S.forecast({ hours: 72, ...sim });
  const changed = JSON.stringify(sim) !== JSON.stringify(SIM0);
  return `<div class="scn-pair">${scenarioCard('No Action', 'Current conditions continue', a, null, '#0B2545', 'a')}${scenarioCard(changed ? simLabel : 'Adjust controls to compare', changed ? describe() : 'Same as Scenario A', b, a, '#1D6FB8', 'b')}</div>
  <div class="sim-sum">${icon('info', 16)}<p>${
    a.crossH == null && b.crossH == null
      ? 'Based on current conditions, neither scenario reaches the minimum reserve within 72 hours.'
      : b.crossH == null
        ? `This response keeps storage above the minimum reserve for at least 72 hours (vs. ${hoursLabel(a.crossH)} with no action).`
        : `With this response, minimum reserve may be reached in approximately ${hoursLabel(b.crossH)} (vs. ${a.crossH != null ? hoursLabel(a.crossH) : 'more than 72 hours'} with no action).`
  } Estimates only — results depend on actual demand and equipment performance.</p></div>`;
}

function describe() {
  const parts = [];
  if (sim.prodDelta) parts.push(`+${fmt(sim.prodDelta, 2)} ML/day production`);
  if (sim.backup) parts.push('backup source on');
  if (sim.emergencyL) parts.push(`${fmtL(sim.emergencyL)} emergency water`);
  if (sim.reducePct) parts.push(`distribution −${sim.reducePct}%`);
  if (sim.restorePumps) parts.push('failed pump restored');
  if (sim.inflowPct) parts.push(`inflow ${sim.inflowPct > 0 ? '+' : ''}${sim.inflowPct}%`);
  if (sim.demandPct) parts.push(`demand ${sim.demandPct > 0 ? '+' : ''}${sim.demandPct}%`);
  return parts.join(' · ');
}

function baseline() {
  const s = st();
  const fc = S.forecast({ hours: 72 });
  return `<div class="base">
    <div><span>Current storage</span><strong>${pct(fc.now)}</strong>${src('SIMULATED')}</div>
    <div><span>Demand</span><strong>${fmt(s.tele.demand, 2)} <small>ML/day</small></strong>${src('ESTIMATED')}</div>
    <div><span>Production capacity</span><strong>${fmt(S.productionCapacity(), 2)} <small>ML/day</small></strong>${src('SIMULATED')}</div>
    <div><span>Reserve threshold (no action)</span><strong>${fc.crossH != null ? hoursLabel(fc.crossH) : '> 72 h'}</strong>${src('FORECAST')}</div>
    <div><span>Active conditions</span><strong class="sm">${s.activeScenarios.length ? s.activeScenarios.length + ' scenario(s)' : Object.keys(s.zoneIssues).length ? 'Zone issue' : 'Normal'}</strong></div>
  </div>`;
}

function controlsHtml() {
  const s = st();
  const pumpDown = s.pumpsOffline.includes('PS-01');
  return `<div class="ctl-list">
    ${CONTROLS.map(
      (c) => `<div class="ctl"><div class="ctl-h"><label for="sim-${c.k}">${c.label}</label><span class="ctl-v"><input type="number" id="sim-${c.k}-n" aria-label="${c.label} value" value="${sim[c.k]}" min="${c.min}" max="${c.max}" step="${c.step}" data-input="sim" data-k="${c.k}"/><em>${c.unit}</em></span></div>
      <input type="range" id="sim-${c.k}" min="${c.min}" max="${c.max}" step="${c.step}" value="${sim[c.k]}" data-input="sim" data-k="${c.k}"/><p>${c.desc}</p></div>`
    ).join('')}
    <label class="switch ctl-sw"><input type="checkbox" ${sim.backup ? 'checked' : ''} data-change="sim-bool" data-k="backup"/><span class="switch-t" aria-hidden="true"></span><span><strong>Activate backup source</strong><em>Standby Deep Well No. 3 (+0.5 ML/day, hypothetical)</em></span></label>
    <label class="switch ctl-sw ${pumpDown ? '' : 'is-dis'}"><input type="checkbox" ${sim.restorePumps ? 'checked' : ''} ${pumpDown ? '' : 'disabled'} data-change="sim-bool" data-k="restorePumps"/><span class="switch-t" aria-hidden="true"></span><span><strong>Restore failed pump</strong><em>${pumpDown ? 'PS-01 back to full capacity' : 'No pump is currently offline'}</em></span></label>
  </div>`;
}

const simulator = {
  title: 'Response Simulator',
  regions: { baseline, results: simResults },
  render() {
    const s = st();
    const open = s.incidents.filter((i) => i.status !== 'Resolved');
    return `<div class="sim-banner" role="note">${icon('sliders', 18)}<strong>SIMULATION — NOT LIVE CONTROL</strong><span>Changing values here does not operate any pump, tank, valve, or other equipment.</span></div>
      <div class="page-h"><div><h1>Response Simulator</h1><p class="page-sub">Test hypothetical responses before making operational decisions.</p></div>
      <div class="page-a">${simInc ? `<span class="pill pill--blue">${icon('link', 12)} Context: ${simInc}</span>` : ''}</div></div>
      ${card('Baseline', `<div data-region="baseline">${baseline()}</div>`, { sub: 'Live simulated conditions — refreshed every update' })}
      <div class="sim-grid">
        <section class="card sim-ctl"><header class="card-h"><div><h2 class="card-t">Response options</h2><p class="card-sub">Scenario B inputs</p></div><button class="btn btn--ghost btn--xs" data-action="sim-reset">${icon('refresh', 13)} Reset</button></header>
          <div class="card-b">
            <div class="presets"><span class="muted sm">Presets:</span>
              <button class="chip-btn" data-action="sim-preset" data-p="emergency">Activate Emergency Water</button>
              <button class="chip-btn" data-action="sim-preset" data-p="pump">Restore failed pump</button>
              <button class="chip-btn" data-action="sim-preset" data-p="demand">Demand management</button>
              <button class="chip-btn" data-action="sim-preset" data-p="combined">Combined response</button>
            </div>
            <div id="sim-controls">${controlsHtml()}</div>
          </div></section>
        <section class="sim-res"><div data-region="results">${simResults()}</div>
          <div class="sim-next card"><div class="card-b"><strong>Next steps</strong><div class="sim-next-a">
            <button class="btn btn--outline btn--sm" data-action="sim-attach" ${open.length ? '' : 'disabled'}>${icon('link', 14)} Attach result to incident</button>
            <button class="btn btn--outline btn--sm" data-action="wo-new" data-inc="${simInc || ''}">${icon('wrench', 14)} Create work order</button>
            <button class="btn btn--outline btn--sm" data-action="adv-new" data-inc="${simInc || ''}">${icon('megaphone', 14)} Publish advisory</button>
          </div></div></div>
        </section>
      </div>`;
  },
};

function refreshResults() {
  const el = document.querySelector('[data-region="results"]');
  if (el) el.innerHTML = simResults();
}

registerInputs({
  sim: (el) => {
    const k = el.dataset.k;
    const c = CONTROLS.find((x) => x.k === k);
    let v = parseFloat(el.value);
    if (isNaN(v)) return;
    v = Math.max(c.min, Math.min(c.max, v));
    sim[k] = v;
    simLabel = 'Custom response';
    const other = el.type === 'range' ? document.getElementById(`sim-${k}-n`) : document.getElementById(`sim-${k}`);
    if (other) other.value = v;
    refreshResults();
  },
  'sim-bool': (el) => {
    sim[el.dataset.k] = el.checked;
    simLabel = 'Custom response';
    refreshResults();
  },
});

register({
  'sim-reset': () => {
    sim = { ...SIM0 };
    document.getElementById('sim-controls').innerHTML = controlsHtml();
    refreshResults();
  },
  'sim-preset': (el) => {
    const pumpDown = st().pumpsOffline.includes('PS-01');
    const p = el.dataset.p;
    sim = { ...SIM0 };
    if (p === 'emergency') (sim.emergencyL = 400000), (simLabel = 'Activate Emergency Water');
    if (p === 'pump') (sim.restorePumps = pumpDown), (simLabel = 'Restore Failed Pump');
    if (p === 'demand') (sim.reducePct = 15), (simLabel = 'Demand Management');
    if (p === 'combined') Object.assign(sim, { emergencyL: 400000, reducePct: 10, backup: true, restorePumps: pumpDown }), (simLabel = 'Combined Response');
    if (p === 'pump' && !pumpDown) S.toast('No pump is currently offline — apply the "Pump Failure" demo scenario to test this', 'info');
    document.getElementById('sim-controls').innerHTML = controlsHtml();
    refreshResults();
  },
  'sim-from-inc': (el) => {
    simInc = el.dataset.inc;
    go('#/p/simulator');
  },
  'sim-attach': () => {
    const s = st();
    const open = s.incidents.filter((i) => i.status !== 'Resolved');
    openModal(
      'Attach simulation result',
      `<form class="form">${field('Incident', `<select id="sim-inc">${open.map((i) => `<option value="${i.id}" ${i.id === simInc ? 'selected' : ''}>${i.id} — ${esc(i.title)}</option>`).join('')}</select>`, { id: 'sim-inc', req: true })}</form><p class="fine">The scenario summary is added to the incident notes and timeline for decision records.</p>`,
      { footer: `<button class="btn btn--ghost" data-action="ov-close">Cancel</button><button class="btn btn--primary" data-action="sim-attach-do">Attach</button>` }
    );
  },
  'sim-attach-do': () => {
    const id = document.getElementById('sim-inc').value;
    const a = S.forecast({ hours: 72 });
    const b = S.forecast({ hours: 72, ...sim });
    closeOverlay();
    S.addIncidentNote(id, `Simulation (not live control): ${simLabel}${describe() ? ` [${describe()}]` : ''}. Reserve threshold: no action ${a.crossH != null ? hoursLabel(a.crossH) : '> 72 h'} → with response ${b.crossH != null ? hoursLabel(b.crossH) : '> 72 h'}.`);
    simInc = id;
  },
});

export const forecastViews = { forecast: forecastView, simulator };