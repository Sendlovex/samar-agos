// Provider: Shortage early warning (forecast).
import * as S from '../store.js';
import { icon, src, card, kpi, empty, register, SEV } from '../ui.js';
import { lineChart, barChart } from '../charts.js';
import { esc, fmt, fmtTime, hoursLabel } from '../util.js';
import { weatherState, dayImpacts, describe as wxDescribe, wIcon, WEATHER_BASE } from '../weather.js';

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
  // Likely range from past forecast errors (90% of scored forecasts fell inside it).
  const band = S.forecastBand();
  const ranges = band
    ? [{ name: 'Likely range (90% of past errors)', color: '#5B7BA3', opacity: 0.16, lo: [...hist.map((v, i) => (i === hist.length - 1 ? v * 100 : null)), ...fpts.map((p) => p.pct * 100 - band(p.h))], hi: [...hist.map((v, i) => (i === hist.length - 1 ? v * 100 : null)), ...fpts.map((p) => p.pct * 100 + band(p.h))] }]
    : [];
  return lineChart({
    id,
    label: 'Reservoir storage: past 24 hours and 48-hour forecast',
    series,
    ranges,
    legend: true,
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
    thresholds: [{ y: S.MIN_RESERVE * 100, label: `Minimum reserve ${Math.round(S.MIN_RESERVE * 100)}%`, color: '#C0262D' }],
    yMin: 0,
    yMax: 100,
    yFmt: (v) => `${Math.round(v)}%`,
    h,
  });
}

// ---------------------------------------------------------------- FORECAST
const sentence = (t) => t.charAt(0) + t.slice(1).toLowerCase();
const signed = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), 0)}%`;
const signedC = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), 1)} °C`;
const dayName = (date, i) => (i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' }));

// Plain-language weather effects; shared by the weather card and "why" list.
function weatherEffects() {
  const imp = dayImpacts();
  if (!imp.length) return null;
  const { climate } = weatherState();
  const base = climate?.normalTmax ?? WEATHER_BASE.tmax;
  const baseTxt = climate ? `${fmt(base, 1)} °C ${climate.monthName} normal` : `${WEATHER_BASE.tmax} °C typical maximum`;
  const hot = imp.reduce((a, b) => (b.demandPct > a.demandPct ? b : a));
  const wet = imp.filter((x) => x.rainNote === 'heavy' || x.rainNote === 'moderate').sort((a, b) => b.rain - a.rain)[0];
  const dry = imp.every((x) => x.rainNote === 'dry');
  const gust = imp.reduce((a, b) => ((b.gust || 0) > (a.gust || 0) ? b : a));
  const day = (x) => dayName(x.date, imp.indexOf(x));
  const demand =
    hot.demandPct > 0.5
      ? { sev: 'warn', label: 'Water demand', value: signed(hot.demandPct), text: `${day(hot)}: high of ${fmt(hot.tmax, 0)} °C, above the ${baseTxt}`, reason: `Hot weather (${day(hot).toLowerCase()}, ${fmt(hot.tmax, 0)} °C) may raise demand by about ${fmt(hot.demandPct, 0)}%` }
      : { sev: 'off', label: 'Water demand', value: 'No change', text: `Highs up to ${fmt(Math.max(...imp.map((x) => x.tmax)), 0)} °C, near the ${baseTxt}` };
  const supply = wet
    ? { sev: wet.rainNote === 'heavy' ? 'crit' : 'warn', label: 'Treatment output', value: signed(wet.supplyPct), text: `${day(wet)}: ${fmt(wet.rain, 0)} mm of rain — muddier river intake slows treatment`, reason: `Rain ${day(wet).toLowerCase()} (${fmt(wet.rain, 0)} mm) may reduce treatment output by about ${fmt(-wet.supplyPct, 0)}% while the intake water is muddy` }
    : dry
      ? { sev: 'warn', label: 'River inflow', value: signed(-6), text: climate ? `Only ${fmt(climate.pctOfNormal, 0)}% of normal rain in 30 days and little ahead — river flow drops` : `Under ${WEATHER_BASE.dryTotalMm} mm of rain expected in 3 days — river flow drops`, reason: climate ? `A dry spell (${fmt(climate.pctOfNormal, 0)}% of normal rain over 30 days) may reduce river inflow by about 6%` : `A dry spell (under ${WEATHER_BASE.dryTotalMm} mm of rain in 3 days) may reduce river inflow by about 6%` }
      : { sev: 'off', label: 'River inflow', value: 'No change', text: climate ? `Last 30 days: ${fmt(climate.rain30, 0)} mm of rain (${fmt(climate.pctOfNormal, 0)}% of normal)` : 'Rainfall within normal range for the intake' };
  const wind =
    (gust.gust || 0) >= WEATHER_BASE.gustRiskKmh
      ? { sev: 'crit', label: 'Storm risk', value: `${fmt(gust.gust, 0)} km/h`, text: `${day(gust)}: strong gusts — check standby power at pump stations`, reason: `Strong gusts up to ${fmt(gust.gust, 0)} km/h ${day(gust).toLowerCase()} could interrupt power to pump stations` }
      : { sev: 'off', label: 'Storm risk', value: 'Low', text: `Gusts up to ${fmt(gust.gust || 0, 0)} km/h; no disruption expected` };
  return [demand, supply, wind];
}

function weatherCard() {
  const { data, status } = weatherState();
  if (status === 'loading' && !data) return card('Weather & climate outlook', '<div class="skel" role="status"><span></span><span></span><span></span><span class="sr-only">Loading the weather forecast</span></div>', { actions: src('FORECAST') });
  if (!data) return card('Weather & climate outlook', empty('Weather forecast unavailable', 'The shortage forecast is running without weather adjustments. It will retry automatically.', 'cloud'), { actions: src('FORECAST') });
  const c = data.current;
  const now = wxDescribe(c.weather_code);
  const d = data.daily;
  const fx = weatherEffects();
  const { climate } = weatherState();
  // Start at the current hour in Catbalogan time (the API returns local hours from midnight).
  const h0 = Math.max(0, data.hourly.time.indexOf(c.time.slice(0, 13) + ':00'));
  const rain = data.hourly.precipitation.slice(h0, h0 + 48);
  const rainTimes = data.hourly.time.slice(h0, h0 + 48);
  return card(
    'Weather & climate outlook',
    `<div class="wx">
      <div class="wx-now">
        <div class="wx-now-h">${wIcon(now.icon, 34)}<div><div class="wx-temp">${fmt(c.temperature_2m, 0)}<small>°C</small></div><div class="wx-cond">${now.text}</div></div></div>
        <dl class="wx-meta"><div><dt>Feels like</dt><dd>${fmt(c.apparent_temperature, 0)} °C</dd></div><div><dt>Humidity</dt><dd>${fmt(c.relative_humidity_2m, 0)}%</dd></div><div><dt>Wind</dt><dd>${fmt(c.wind_speed_10m, 0)} km/h</dd></div><div><dt>Rain now</dt><dd>${fmt(c.precipitation || 0, 1)} mm</dd></div></dl>
      </div>
      <div class="wx-days">${d.time
        .map((date, i) => {
          const w = wxDescribe(d.weather_code[i]);
          return `<div class="wx-day"><div class="wx-day-n">${dayName(date, i)}</div>${wIcon(w.icon, 26)}<div class="wx-day-c">${w.text}</div><div class="wx-day-t"><strong>${fmt(d.temperature_2m_max[i], 0)}°</strong> / ${fmt(d.temperature_2m_min[i], 0)}°</div><div class="wx-day-r">${fmt(d.precipitation_sum[i] || 0, 0)} mm rain, ${fmt(d.precipitation_probability_max[i] || 0, 0)}% chance</div></div>`;
        })
        .join('')}</div>
      <div class="wx-fx"><div class="wx-fx-h"><span>Effect on water supply</span>${src('ESTIMATED')}</div>
        <ul>${fx.map((x) => `<li class="wx-fx--${x.sev}"><div><div class="wx-fx-l">${x.label}<strong>${x.value}</strong></div><div class="wx-fx-t">${esc(x.text)}</div></div></li>`).join('')}</ul>
      </div>
    </div>
    ${climate ? `<div class="wx-clim"><div class="wx-fx-h"><span>Climate for ${climate.monthName}</span>${src('CLIMATE RECORD')}</div>
      <dl><div><dt>Normal daily high</dt><dd>${fmt(climate.normalTmax, 1)} °C</dd><span>${climate.years} average</span></div>
      <div><dt>Today's forecast high</dt><dd>${fmt(d.temperature_2m_max[0], 0)} °C</dd><span>${signedC(d.temperature_2m_max[0] - climate.normalTmax)} vs normal</span></div>
      <div><dt>Rain, last 30 days</dt><dd>${fmt(climate.rain30, 0)} mm</dd><span>Normal ${fmt(climate.normalRain30, 0)} mm</span></div>
      <div><dt>Versus normal</dt><dd>${fmt(climate.pctOfNormal, 0)}%</dd><span>${climate.pctOfNormal < 50 ? 'Dry' : climate.pctOfNormal > 150 ? 'Wetter than usual' : 'Near normal'}</span></div></dl></div>` : ''}
    <div class="wx-rain">${barChart({ id: 'wx-rain', label: 'Rainfall, next 48 hours, millimetres per hour', bars: rain.map((v, i) => ({ label: i % 12 === 0 ? new Date(rainTimes[i]).toLocaleTimeString('en-US', { weekday: 'short', hour: 'numeric' }) : '', value: v || 0, color: '#8A9BB0', tip: `${new Date(rainTimes[i]).toLocaleString('en-US', { weekday: 'short', hour: 'numeric' })}: ${fmt(v || 0, 1)} mm` })), yFmt: (v) => `${fmt(v, 1)}`, h: 110, yMax: Math.max(2, ...rain.map((v) => v || 0)) })}
      <div class="chart-cap">Rainfall, next 48 hours (mm per hour) ${src('FORECAST')}</div></div>`,
    { sub: `Catbalogan City. Open-Meteo forecast${climate ? ' and ERA5 climate record' : ''}, updated ${fmtTime(data.fetchedAt)}`, actions: src('FORECAST') }
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
  const minPct = Math.round(S.MIN_RESERVE * 100);
  const below = fc.now <= S.MIN_RESERVE;
  const msg = below
    ? `Storage is already below the ${minPct}% firefighting reserve.`
    : fc.crossH != null
      ? `Based on current conditions, storage may reach the minimum reserve in approximately <strong>${hoursLabel(fc.crossH)}</strong>.`
      : 'Based on current conditions, storage stays above the minimum reserve for the next 72 hours.';
  const imp = dayImpacts()[0];
  const sevCls = SEV[fs.sev].cls;
  const lowAt = (v) => (v <= S.MIN_RESERVE ? 'is-low' : '');
  const delta24 = (fc.at24 - fc.now) * 100;
  return `<div class="kgrid">
    <section class="kp-primary fc-primary fc-primary--${sevCls}">
      <div class="kpi-top"><span class="kpi-label">Supply outlook, next 72 hours</span>${src('FORECAST')}</div>
      <div class="fc-head">${sentence(fs.label)}</div>
      <p class="fc-msg">${msg}</p>
      <div class="fc-proj">${rows
        .map(([l, v]) => `<div class="${lowAt(v)}"><span>${l.replace('In ', '')}</span><strong>${pct(v)}</strong><div class="fc-proj-b"><i style="height:${Math.max(2, Math.min(100, v * 100))}%"></i><b style="bottom:${minPct}%"></b></div></div>`)
        .join('')}</div>
      <div class="kp-foot"><span>Minimum reserve <strong>${minPct}%</strong> (100 m³ firefighting reserve)</span>${src('MANUAL')}</div>
    </section>
    ${kpi({ label: 'Storage now', value: pct(fc.now), source: 'SIMULATED', sub: `${fmt(t.volML * 1000, 0)} m³ of 440 m³` })}
    ${kpi({ label: 'In 24 hours', value: pct(fc.at24), source: 'FORECAST', sub: `${delta24 >= 0 ? '+' : '−'}${fmt(Math.abs(delta24), 0)} pts from now`, sev: fc.at24 <= S.MIN_RESERVE ? 'critical' : null })}
    ${kpi({ label: 'Reaches reserve', value: below ? 'Now' : fc.crossH != null ? hoursLabel(fc.crossH) : 'Not in 72 h', source: 'FORECAST', sub: fc.crossH != null ? '<span class="txt-warn">Plan a response</span>' : 'No shortage expected', sev: fc.crossH != null ? (fc.crossH <= 6 ? 'critical' : 'warning') : null })}
    ${kpi({ label: 'Weather effect', value: imp ? signed(imp.demandPct) : '—', unit: imp ? 'demand' : '', source: 'ESTIMATED', sub: imp ? (imp.supplyPct ? `Supply ${signed(imp.supplyPct)} today` : 'No change to supply today') : 'Weather forecast unavailable' })}
  </div>
  ${card(
    warn ? 'Why this warning appeared' : fc.status === 'watch' ? 'Why storage is declining' : 'Why the outlook is stable',
    `<div class="fc-why"><ol class="why">${reasons.map((r) => `<li><span class="why-n" aria-hidden="true"></span><span>${esc(r)}</span></li>`).join('')}</ol>
    <div class="fc-actions">${warn ? `<a class="btn btn--outline btn--sm" href="#/p/advisories">${icon('megaphone', 15)} Prepare advisory</a>` : ''}</div></div>
    <p class="fine">Forecasts are projections based on current conditions${S.weatherActive() ? ' and the weather outlook' : ''}. They are not guaranteed.</p>`
  )}
  ${card('Storage trend and forecast', historyAndForecast(fc, 'fc-main'), { sub: `Poblacion 13 reservoir level, past 24 hours (simulated) and next 48 hours (forecast)${S.forecastBand() ? '. Shaded area shows the likely range from past forecast errors.' : ''}` })}
  ${weatherCard()}
  ${accuracyCard()}
  ${card(
    'Forecast inputs',
    `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Input</th><th class="num">Value</th><th>Source</th><th>Notes</th></tr></thead><tbody>
      <tr><td>Current storage</td><td class="num">${fmt(t.volML, 2)} ML (${pct(fc.now)})</td><td>${src('SIMULATED')}</td><td class="muted">Poblacion 13 reservoir, 440 m³ capacity</td></tr>
      <tr><td>Production capacity</td><td class="num">${fmt(S.productionCapacity(), 2)} ML/day</td><td>${src('SIMULATED')}</td><td class="muted">Caramayon, Masacpasac, Kulador plant and deep wells${s.pumpsOffline.length ? `; ${s.pumpsOffline.join(', ')} offline` : ''}</td></tr>
      <tr><td>Reservoir inflow</td><td class="num">${fmt(S.mlToLs(t.production + t.transfer), 0)} L/s</td><td>${src('SIMULATED')}</td><td class="muted">Plant output follows demand near the normal operating level</td></tr>
      <tr><td>Consumption history (24 h avg)</td><td class="num">${fmt(hist24, 2)} ML/day</td><td>${src('SIMULATED')}</td><td class="muted">From outlet flow meter</td></tr>
      <tr><td>Current demand</td><td class="num">${fmt(t.demand, 2)} ML/day</td><td>${src('SIMULATED')}</td><td class="muted">Instantaneous rate incl. estimated losses</td></tr>
      <tr><td>Estimated demand (next 24 h avg)</td><td class="num">${fmt(fc.avgDemand, 2)} ML/day</td><td>${src('ESTIMATED')}</td><td class="muted">Daily demand pattern × current demand factor${imp ? ' × weather' : ''}</td></tr>
      <tr><td>Weather: demand adjustment (today)</td><td class="num">${imp ? signed(imp.demandPct) : '—'}</td><td>${src('ESTIMATED')}</td><td class="muted">+${WEATHER_BASE.hotPctPerDeg}% per °C above ${weatherState().climate ? `the ${fmt(weatherState().climate.normalTmax, 1)} °C climate normal (ERA5 ${weatherState().climate.years})` : `a ${WEATHER_BASE.tmax} °C daily high`} (Open-Meteo forecast)</td></tr>
      <tr><td>Weather: supply adjustment (today)</td><td class="num">${imp ? signed(imp.supplyPct) : '—'}</td><td>${src('ESTIMATED')}</td><td class="muted">−15% at ≥${WEATHER_BASE.heavyRainMm} mm/day rain, −5% at ≥${WEATHER_BASE.moderateRainMm} mm, −6% in a dry spell${weatherState().climate ? ` (under ${WEATHER_BASE.dryPctOfNormal}% of normal 30-day rain)` : ''}</td></tr>
      <tr><td>Reserve threshold</td><td class="num">${Math.round(S.MIN_RESERVE * 100)}% (100 m³)</td><td>${src('MANUAL')}</td><td class="muted">Firefighting reserve, CWD Water Safety Plan 2022</td></tr>
    </tbody></table></div><p class="fine">Model: mass balance (storage + production − estimated demand) in 15-minute steps over 72 hours, adjusted by the daily weather outlook. Updated with every telemetry update.</p>`
  )}`;
}

// ---------------------------------------------------------------- forecast accuracy
let fcaH = 6;
const horizonLabel = (h) => `${h} hour${h > 1 ? 's' : ''} ahead`;
const pts = (v, d = 1) => (v == null ? '—' : `${fmt(v, d)} pts`);

function accuracyCard() {
  const s = st();
  const acc = S.forecastAccuracy();
  const scored = acc.reduce((n, a) => n + a.n, 0);
  const pending = acc.reduce((n, a) => n + a.pending, 0);
  const tile = (a) => {
    const ok = a.n >= S.FC_MIN_SAMPLES ? a.mae <= a.target : null;
    return `<button class="fca-t ${a.h === fcaH ? 'is-on' : ''}" data-action="fca-h" data-h="${a.h}" aria-pressed="${a.h === fcaH}">
      <span class="fca-h">${horizonLabel(a.h)}</span>
      <span class="fca-v">${a.mae == null ? '—' : `±${fmt(a.mae, 1)}`}<small>${a.mae == null ? '' : 'pts avg error'}</small></span>
      <span class="fca-s ${ok === false ? 'txt-warn' : ''}">${ok == null ? (a.n < S.FC_MIN_SAMPLES ? `Collecting, ${a.n} of ${S.FC_MIN_SAMPLES} checks` : '') : `${ok ? 'Within' : 'Outside'} target of ±${a.target} pts`}</span>
      <dl><div><dt>Within target</dt><dd>${a.withinPct == null ? '—' : `${fmt(a.withinPct, 0)}%`}</dd></div><div><dt>Bias</dt><dd>${a.bias == null ? '—' : `${a.bias > 0 ? '+' : a.bias < 0 ? '−' : ''}${fmt(Math.abs(a.bias), 1)}`}</dd></div><div><dt>Demand error</dt><dd>${a.mape == null ? '—' : `${fmt(a.mape, 1)}%`}</dd></div><div><dt>Checks</dt><dd>${a.n}</dd></div></dl>
    </button>`;
  };
  const sel = (s.fcLog || []).filter((e) => e.h === fcaH && e.actual != null).slice(-48);
  const chart = sel.length >= 2
    ? lineChart({
        id: 'fca-chart',
        label: `Forecast made ${horizonLabel(fcaH)} versus measured storage`,
        series: [
          { name: 'Measured storage (simulated)', color: '#1E3A5F', values: sel.map((e) => e.actual * 100) },
          { name: `Forecast made ${fcaH} h earlier`, color: '#8A9BB0', values: sel.map((e) => e.pred * 100), dash: true },
        ],
        labels: sel.map((e) => fmtTime(e.target)),
        xTicks: [{ i: 0, label: fmtTime(sel[0].target) }, { i: sel.length - 1, label: fmtTime(sel[sel.length - 1].target) }],
        yFmt: (v) => `${fmt(v, 1)}%`,
        h: 200,
      })
    : `<div class="fca-empty">${icon('clock', 18)}<span>The first comparisons appear once forecasts made ${horizonLabel(fcaH)} reach their target time. Forecasts are logged every 30 simulated minutes (about every 18 seconds), so 1-hour checks arrive within a minute, 6-hour checks in about 4 minutes and 24-hour checks in about 15 minutes.</span></div>`;
  const recent = (s.fcLog || []).filter((e) => e.actual != null).slice(-6).reverse();
  return card(
    'Forecast accuracy',
    `<div class="fca-tiles">${acc.map(tile).join('')}</div>
    <div class="fca-chart"><div class="fca-ch-h"><strong>Forecast vs measured, ${horizonLabel(fcaH)}</strong><span>Last ${sel.length} checks</span></div>${chart}</div>
    ${recent.length ? `<div class="tbl-wrap"><table class="tbl fca-tbl"><thead><tr><th>Forecast made</th><th>Horizon</th><th class="num">Predicted</th><th class="num">Measured</th><th class="num">Error</th><th>Result</th></tr></thead><tbody>${recent
      .map((e) => {
        const err = (e.pred - e.actual) * 100;
        const ok = Math.abs(err) <= S.FC_TARGETS.level[e.h];
        return `<tr><td>${fmtTime(e.made)}</td><td>+${e.h} h</td><td class="num">${fmt(e.pred * 100, 1)}%</td><td class="num">${fmt(e.actual * 100, 1)}%</td><td class="num">${err > 0 ? '+' : err < 0 ? '−' : ''}${fmt(Math.abs(err), 1)} pts</td><td><span class="fca-r ${ok ? '' : 'txt-warn'}">${ok ? 'Within target' : 'Outside target'}</span></td></tr>`;
      })
      .join('')}</tbody></table></div>` : ''}
    <p class="fine">Each forecast is saved and later compared with the measured reservoir level. Error is in percentage points of storage; demand error is the average percentage difference. Targets (±${S.FC_TARGETS.level[1]} / ±${S.FC_TARGETS.level[6]} / ±${S.FC_TARGETS.level[24]} pts) are proposed and should be agreed with the utility. <strong>Measured values here come from simulated telemetry</strong>, so these scores show how the method works; they become a real accuracy measure once meter data is connected.</p>`,
    { sub: `${scored} forecasts scored, ${pending} waiting for their target time`, actions: src('SIMULATED') }
  );
}

register({
  'fca-h': (el) => {
    fcaH = +el.dataset.h;
    const r = document.querySelector('[data-region="main"]');
    if (r) r.innerHTML = forecastMain();
  },
});

const forecastView = {
  title: 'Forecast',
  regions: { main: forecastMain },
  render() {
    return `<div class="page-h"><div><h1>Shortage Early Warning</h1><p class="page-sub">Supply-demand forecast with the local weather outlook. Act before shortages become severe.</p></div></div><div data-region="main">${forecastMain()}</div>`;
  },
};

export const forecastViews = { forecast: forecastView };
