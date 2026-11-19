// "Now": live Agile price, the next two days of half-hourly prices, Tracker, and the grid.

import * as api from './api.js';
import * as T from './tariffs.js';
import { h, put, columns, line } from './charts.js';
import {
  state, tf, primary, flexRef, profileToday, famById, card, fill, seg, tag, bandChip, tile, p1, p2, loading,
} from './core.js';

const slotRange = (f) => T.fmtTime(f) + '–' + T.fmtTime(f + T.HALF);

async function agilePoints(dir) {
  const p = primary(dir === 'export' ? 'agileout' : 'agile');
  const t = tf(p).e1;
  if (!t) return { points: [], name: p ? p.name : 'Agile' };
  const mid = T.londonMidnight(Date.now());
  const lk = await api.unitRates(t.code, mid, T.addDays(mid, 2), { ttl: 300000 });
  return { points: T.toHalfHours(lk.intervals || [], mid, T.addDays(mid, 2)), name: p.name, sc: t.sc };
}

export function viewNow(root, alive) {
  const ref = flexRef();
  const regionName = T.REGIONS[state.region];
  const jobs = [];

  /* ----- hero ----- */
  const hero = h('section', { class: 'card hero' }, loading());
  root.append(hero);

  /* ----- Agile chart ----- */
  const chart = card('Agile half-hourly prices', { sub: regionName });
  const chartTools = h('div', { class: 'card-tools' });
  chart.el.querySelector('.card-head').append(chartTools);
  root.append(chart.el);

  const grid = h('div', { class: 'grid two' });
  root.append(grid);
  const windows = card('Cheapest times to run things', { sub: 'Lowest average Agile price from now on' });
  const nowList = card('Unit rate right now', { sub: 'What each tariff charges this half hour' });
  grid.append(windows.el, nowList.el);

  const drawChart = (data) => {
    const now = Date.now();
    const mid = T.londonMidnight(now);
    const tomorrow = T.addDays(mid, 1);
    const isExport = state.agileDir === 'export';
    const pts = data[state.agileDir].points;
    const sets = {
      upcoming: pts.filter((p) => p.f + T.HALF > now),
      today: pts.filter((p) => p.f < tomorrow),
      tomorrow: pts.filter((p) => p.f >= tomorrow),
    };
    const shown = sets[state.agileView];
    const rerender = () => drawChart(data);
    put(chartTools, seg([{ v: 'upcoming', label: 'Upcoming' }, { v: 'today', label: 'Today' }, { v: 'tomorrow', label: 'Tomorrow' }],
        state.agileView, (v) => { state.agileView = v; rerender(); }, 'Time range'),
      seg([{ v: 'import', label: 'Import' }, { v: 'export', label: 'Export' }],
        state.agileDir, (v) => { state.agileDir = v; rerender(); }, 'Direction'),
    );
    chart.setSub(data[state.agileDir].name + ' · ' + regionName + (isExport ? ' · what you are paid' : ''));
    if (!shown.length) {
      put(chart.body, h('p', { class: 'empty', text: state.agileView === 'tomorrow'
        ? 'Tomorrow’s prices are published at around 4pm.' : 'No prices published for this period yet.' }));
      return;
    }
    const every = shown.length > 30 ? 12 : shown.length > 12 ? 6 : 2;
    const items = shown.map((p) => {
      const band = isExport ? null : T.bandOf(p.v, ref);
      return {
        v: p.v, cls: isExport ? 'b-export' : 'b-' + band,
        tipTitle: T.fmtDate(p.f, { dow: true }) + ' · ' + slotRange(p.f),
        tipRows: [{ value: p2(p.v), label: isExport ? 'paid per kWh' : T.BANDS[band], cls: 'key-box ' + (isExport ? 'b-export' : 'b-' + band) }],
      };
    });
    const xTicks = [];
    shown.forEach((p, i) => {
      const s = T.slotOf(p.f);
      if (s % every === 0) xTicks.push({ i, edge: true, label: s === 0 ? T.fmtDate(p.f, { dow: true }).split(' ')[0] : T.fmtTime(p.f) });
    });
    const el = h('div', { class: 'chart-box' });
    // Each swatch stays with its range so the pair wraps together on a phone.
    const item = (band, note) => h('span', { class: 'legend-item' }, bandChip(band), h('span', { class: 'legend-note', text: note }));
    const legend = isExport ? null : h('div', { class: 'legend' },
      item('plunge', '0p or less'), item('cheap', 'under ' + p1(ref / 2)), item('fair', 'under ' + p1(ref)),
      item('pricey', 'under ' + p1(ref * 1.5)), item('peak', p1(ref * 1.5) + ' or more'));
    const table = h('details', { class: 'table-view' },
      h('summary', { text: 'Show as a table' }),
      h('div', { class: 'table-scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { text: 'Day' }), h('th', { text: 'Time' }), h('th', { class: 'num', text: 'p/kWh' }), isExport ? null : h('th', { text: 'Band' }))),
        h('tbody', {}, shown.map((p) => h('tr', { class: p.f <= now && p.f + T.HALF > now ? 'is-now' : '' },
          h('td', { text: T.fmtDate(p.f, { dow: true }) }),
          h('td', { text: slotRange(p.f) }),
          h('td', { class: 'num', text: p.v.toFixed(2) }),
          isExport ? null : h('td', {}, bandChip(T.bandOf(p.v, ref)))))))));
    put(chart.body, el, legend, table);
    columns(el, items, {
      height: 280, xTicks,
      ref: isExport ? null : { v: ref, name: 'Flexible', value: p1(ref) },
      nowIndex: shown.findIndex((p) => p.f <= now && p.f + T.HALF > now),
      label: 'Agile price for each half hour',
    });
  };

  jobs.push((async () => {
    put(chart.body, loading());
    try {
      const [imp, exp] = await Promise.all([agilePoints('import'), agilePoints('export').catch(() => ({ points: [], name: 'Agile Outgoing' }))]);
      if (!alive()) return;
      const data = { import: imp, export: exp };
      drawHero(hero, imp, exp, ref, regionName);
      drawChart(data);
      drawWindows(windows.body, imp.points);
    } catch (e) {
      if (!alive()) return;
      put(hero, h('p', { class: 'empty', text: 'Agile prices could not be loaded: ' + e.message }));
      put(chart.body, h('p', { class: 'empty', text: 'No chart available.' }));
      put(windows.body, h('p', { class: 'empty', text: 'No prices available.' }));
    }
  })());

  /* ----- right now across tariffs ----- */
  jobs.push(fill(nowList.body, alive, async () => {
    const fams = [...T.CHART_FAMILIES, 'fixed', 'iflux'];
    const slot = T.slotOf(Date.now());
    const rows = (await api.pool(fams, async (id) => {
      const p = primary(id);
      if (!p) return null;
      const prof = await profileToday(p);
      if (!prof || !Number.isFinite(prof.profile[slot])) return null;
      return { p, v: prof.profile[slot], needs: (famById(id) || {}).needs };
    })).filter(Boolean).sort((a, b) => a.v - b.v);
    if (!rows.length) return h('p', { class: 'empty', text: 'No rates available.' });
    const max = Math.max(...rows.map((r) => r.v), 1);
    return h('div', { class: 'meters' }, rows.map((r) => {
      const bar = h('span', { class: 'meter-fill b-' + T.bandOf(r.v, ref) });
      bar.style.width = Math.max(1, (Math.max(0, r.v) / max) * 100) + '%';
      return h('div', { class: 'meter-row' },
        h('div', { class: 'meter-name' }, r.p.label, r.needs && r.needs !== 'Smart meter' ? tag(r.needs) : null),
        h('div', { class: 'meter-track' }, bar),
        h('div', { class: 'meter-val', text: p1(r.v) }));
    }));
  }));

  /* ----- Tracker ----- */
  const tracker = card('Tracker', { sub: 'One price per day, set from wholesale costs · ' + regionName });
  root.append(tracker.el);
  jobs.push(fill(tracker.body, alive, async () => {
    const p = primary('tracker');
    const t = tf(p);
    if (!p || !t.e1) return h('p', { class: 'empty', text: 'Tracker is not available in this region.' });
    const mid = T.londonMidnight(Date.now());
    const from = T.addDays(mid, -30), to = T.addDays(mid, 2);
    const fuels = [{ id: 'E', name: 'Electricity', tar: t.e1, cls: 's-tracker' }, { id: 'G', name: 'Gas', tar: t.g, cls: 's-gas' }].filter((f) => f.tar);
    const blocks = await Promise.all(fuels.map(async (f) => {
      const lk = await api.unitRates(f.tar.code, from, to, { ttl: 900000 });
      const pts = [];
      for (let d = from; d <= mid; d = T.addDays(d, 1)) {
        const v = lk.at(d + 12 * 3600000);
        if (Number.isFinite(v)) pts.push({ label: T.fmtDate(d), v });
      }
      const today = lk.at(mid + 12 * 3600000);
      const tom = lk.at(T.addDays(mid, 1) + 12 * 3600000);
      const yest = pts.length > 1 ? pts[pts.length - 2].v : NaN;
      const fr = flexRef(f.id);
      const box = h('div', { class: 'chart-box' });
      const el = h('div', { class: 'tracker-block' },
        h('div', { class: 'tracker-head' },
          h('div', {},
            h('div', { class: 'tile-label', text: f.name + ' today' }),
            h('div', { class: 'big-num' }, Number.isFinite(today) ? today.toFixed(2) : '–', h('span', { class: 'unit', text: 'p/kWh' }))),
          h('dl', { class: 'facts' },
            h('div', {}, h('dt', { text: 'Tomorrow' }), h('dd', { text: Number.isFinite(tom) ? p2(tom) : 'not yet published' })),
            h('div', {}, h('dt', { text: 'Yesterday' }), h('dd', { text: p2(yest) })),
            h('div', {}, h('dt', { text: 'Flexible' }), h('dd', { text: p2(fr) })),
            h('div', {}, h('dt', { text: 'Standing charge' }), h('dd', { text: p2(f.tar.sc) + '/day' })))),
        box);
      return { el, draw: () => pts.length && line(box, pts, { cls: f.cls, name: f.name, height: 170, ref: Number.isFinite(fr) ? { v: fr, name: 'Flexible', value: p1(fr) } : null, label: 'Tracker ' + f.name + ' price, last 30 days' }) };
    }));
    const wrap = h('div', { class: 'grid two inner' }, blocks.map((b) => b.el));
    queueMicrotask(() => blocks.forEach((b) => b.draw()));
    return [wrap, h('p', { class: 'fine', text: p.full + ' (' + p.code + '). Octopus does not include Tracker in its public product list, so check availability before switching.' })];
  }));

  /* ----- grid ----- */
  const gridCard = card('The grid right now', { sub: 'Great Britain generation mix and the wind and sun ahead' });
  root.append(gridCard.el);
  jobs.push(fill(gridCard.body, alive, async () => {
    const [mix, ci, wx] = await Promise.all([api.generationMix().catch(() => null), api.carbonIntensity().catch(() => null), api.windSolar().catch(() => null)]);
    const out = h('div', { class: 'grid two inner' });
    if (mix && mix.data && mix.data.generationmix) {
      const fuels = mix.data.generationmix.filter((f) => f.perc > 0).sort((a, b) => b.perc - a.perc);
      const low = fuels.filter((f) => ['wind', 'solar', 'hydro', 'nuclear', 'biomass'].includes(f.fuel)).reduce((a, f) => a + f.perc, 0);
      const inten = ci && ci.data && ci.data[0] && ci.data[0].intensity;
      const max = fuels.length ? fuels[0].perc : 1;
      out.append(h('div', {},
        h('div', { class: 'tiles two' },
          tile('Low-carbon share', low.toFixed(0) + '%', 'wind, solar, hydro, nuclear, biomass'),
          inten ? tile('Carbon intensity', (inten.actual != null ? inten.actual : inten.forecast) + ' g', 'CO₂ per kWh · ' + inten.index) : null),
        h('div', { class: 'meters compact' }, fuels.map((f) => {
          const bar = h('span', { class: 'meter-fill s-mix' });
          bar.style.width = (f.perc / max) * 100 + '%';
          return h('div', { class: 'meter-row' },
            h('div', { class: 'meter-name', text: f.fuel.charAt(0).toUpperCase() + f.fuel.slice(1) }),
            h('div', { class: 'meter-track' }, bar),
            h('div', { class: 'meter-val', text: f.perc.toFixed(1) + '%' }));
        }))));
    }
    if (wx && wx.daily && wx.daily.time) {
      const d = wx.daily;
      out.append(h('div', {},
        h('h3', { class: 'h3', text: 'Wind and sun, next 3 days' }),
        h('table', { class: 'plain' },
          h('thead', {}, h('tr', {}, h('th', { text: 'Day' }), h('th', { class: 'num', text: 'Peak wind' }), h('th', { class: 'num', text: 'Sunshine' }))),
          h('tbody', {}, d.time.slice(1, 4).map((day, i) => h('tr', {},
            h('td', { text: T.fmtDate(Date.parse(day + 'T12:00:00Z'), { dow: true }) }),
            h('td', { class: 'num', text: d.wind_speed_10m_max[i + 1] != null ? Math.round(d.wind_speed_10m_max[i + 1]) + ' mph' : '–' }),
            h('td', { class: 'num', text: d.shortwave_radiation_sum[i + 1] != null ? d.shortwave_radiation_sum[i + 1].toFixed(1) + ' MJ/m²' : '–' }))))),
        h('p', { class: 'fine', text: 'Measured at Flamborough Head. Windy, bright days usually mean cheaper Agile prices.' })));
    }
    return out.children.length ? out : h('p', { class: 'empty', text: 'Grid data is unavailable right now.' });
  }));

  return Promise.allSettled(jobs);
}

function drawHero(hero, imp, exp, ref, regionName) {
  const now = Date.now();
  const mid = T.londonMidnight(now);
  const today = imp.points.filter((p) => p.f < T.addDays(mid, 1));
  const cur = imp.points.find((p) => p.f <= now && p.f + T.HALF > now);
  const next = imp.points.find((p) => p.f > now);
  const expNow = exp.points.find((p) => p.f <= now && p.f + T.HALF > now);
  if (!cur) {
    put(hero, h('p', { class: 'empty', text: 'No Agile price is published for this half hour.' }));
    return;
  }
  const avg = today.reduce((a, p) => a + p.v, 0) / (today.length || 1);
  const lo = today.reduce((a, p) => (p.v < a.v ? p : a), today[0]);
  const hi = today.reduce((a, p) => (p.v > a.v ? p : a), today[0]);
  const vs = ((avg - ref) / ref) * 100;
  put(hero, h('div', { class: 'hero-main' },
      h('div', { class: 'eyebrow', text: 'Agile now · ' + regionName }),
      h('div', { class: 'hero-fig' }, h('span', { class: 'hero-num', text: cur.v.toFixed(1) }), h('span', { class: 'unit', text: 'p/kWh' })),
      h('div', { class: 'hero-meta' },
        bandChip(T.bandOf(cur.v, ref)),
        h('span', { text: slotRange(cur.f) }),
        next ? h('span', { text: 'then ' + p1(next.v) + ' ' + (next.v > cur.v ? '▲' : next.v < cur.v ? '▼' : '') }) : null)),
    h('div', { class: 'tiles hero-tiles' },
      tile('Today’s average', p1(avg), Math.abs(vs).toFixed(0) + '% ' + (vs < 0 ? 'below' : 'above') + ' Flexible'),
      tile('Lowest today', p1(lo.v), 'at ' + T.fmtTime(lo.f)),
      tile('Highest today', p1(hi.v), 'at ' + T.fmtTime(hi.f)),
      tile('Export now', expNow ? p1(expNow.v) : '–', 'Agile Outgoing')));
}

function drawWindows(body, points) {
  const now = Date.now();
  const up = points.filter((p) => p.f + T.HALF > now);
  const rows = [[1, '30 min'], [2, '1 hour'], [4, '2 hours'], [6, '3 hours'], [8, '4 hours']]
    .map(([n, label]) => ({ label, w: T.cheapestWindow(up, n) })).filter((r) => r.w);
  if (!rows.length) { put(body, h('p', { class: 'empty', text: 'No upcoming prices yet.' })); return; }
  const last = up[up.length - 1].f + T.HALF;
  const today = T.dayKey(now);
  put(body, h('table', { class: 'plain' },
      h('thead', {}, h('tr', {}, h('th', { text: 'For' }), h('th', { text: 'Start at' }), h('th', { class: 'num', text: 'Average' }))),
      h('tbody', {}, rows.map((r) => h('tr', {},
        h('td', { text: r.label }),
        h('td', {}, h('strong', { text: T.fmtTime(r.w.from) + '–' + T.fmtTime(r.w.to) }),
          T.dayKey(r.w.from) !== today ? h('span', { class: 'muted', text: ' ' + T.fmtDate(r.w.from, { dow: true }).split(' ')[0] }) : null),
        h('td', { class: 'num', text: p1(r.w.avg) }))))),
    h('p', { class: 'fine', text: 'Looking ahead to ' + T.fmtTime(last) + ' ' + T.fmtDate(last - 1, { dow: true }).split(' ')[0] + ', the last price published so far.' }));
}
