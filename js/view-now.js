// "Now": a headline tariff of the visitor's choice, then whichever sections they have switched on, in their order.

import * as api from './api.js';
import * as T from './tariffs.js';
import { h, put, columns, line } from './charts.js';
import {
  state, tf, primary, flexRef, profileToday, famById, actualCost, currentAgreement, loadUsage, productName,
  card, fill, seg, tag, bandChip, tile, p1, p2, gbp, kwhFmt, loading, NOW_SECTIONS,
} from './core.js';

const slotRange = (f) => T.fmtTime(f) + '–' + T.fmtTime(f + T.HALF);
const at = (points, ts) => points.find((p) => p.f <= ts && p.f + T.HALF > ts);

/** Half-hourly prices for today and tomorrow for any tariff code, whatever shape its rates are published in. */
async function pointsFor(tariffCode, ttl = 300000) {
  const mid = T.londonMidnight(Date.now());
  const end = T.addDays(mid, 2);
  const lk = await api.unitRates(tariffCode, mid, end, { ttl });
  const out = [];
  for (let ts = mid; ts < end; ts += T.HALF) {
    const v = lk.at(ts);
    if (Number.isFinite(v)) out.push({ f: ts, v });
  }
  return out;
}

async function agilePoints(dir) {
  const p = primary(dir === 'export' ? 'agileout' : 'agile');
  const t = tf(p).e1;
  if (!t) return { points: [], name: p ? p.name : 'Agile' };
  return { points: await pointsFor(t.code), name: p.name };
}

/** The tariff the visitor chose to lead with: a family, or their own tariff once connected. */
async function headline() {
  const pref = state.prefs.headline;
  if (pref === 'mine' && state.acct && state.acct.import) {
    const cur = currentAgreement(state.acct.import.agreements);
    if (cur) {
      const mid = T.londonMidnight(Date.now());
      const [points, sc] = await Promise.all([
        pointsFor(cur.tariff_code),
        api.standingCharges(cur.tariff_code, mid, T.addDays(mid, 1), { ttl: 3600000 }).then((lk) => lk.at(Date.now()), () => NaN),
      ]);
      return { name: productName(cur.tariff_code), points, sc: Number.isFinite(sc) ? sc : null, mine: true };
    }
  }
  const p = primary(pref === 'mine' ? 'agile' : pref) || primary('agile');
  const t = tf(p);
  const code = (t.e1 || t.e4 || {}).code;
  if (!code) return { name: p.name, points: [] };
  return { name: p.label, points: await pointsFor(code), sc: (t.e1 || t.e4).sc, family: p.family };
}

/** What export is worth this half hour: the visitor's own export tariff if they have one, else Agile Outgoing. */
async function exportNow(agileOut) {
  const now = Date.now();
  if (state.acct && state.acct.export) {
    const cur = currentAgreement(state.acct.export.agreements);
    if (cur) {
      try {
        const cur0 = at(await pointsFor(cur.tariff_code), now);
        if (cur0) return { v: cur0.v, name: productName(cur.tariff_code) };
      } catch { /* fall back to Agile Outgoing below */ }
    }
  }
  const p = at((await agileOut).points, now);
  return p ? { v: p.v, name: 'Agile Outgoing' } : null;
}

export function viewNow(root, alive) {
  const ref = flexRef();
  const regionName = T.REGIONS[state.region];
  const jobs = [];
  // Agile prices feed the hero, the chart and the cheapest-times table, so fetch them once.
  let agile = null;
  const agileData = () => agile || (agile = Promise.all([agilePoints('import'), agilePoints('export').catch(() => ({ points: [], name: 'Agile Outgoing' }))])
    .then(([imp, exp]) => ({ import: imp, export: exp })));

  /* ----- hero ----- */
  const hero = h('section', { class: 'card hero' }, loading());
  root.append(hero);
  jobs.push((async () => {
    try {
      const out = agileData().then((d) => d.export).catch(() => ({ points: [] }));
      const [head, exp, agileNow] = await Promise.all([
        headline(), exportNow(out).catch(() => null),
        agileData().then((d) => at(d.import.points, Date.now())).catch(() => null),
      ]);
      if (alive()) drawHero(hero, head, exp, agileNow, ref, regionName);
    } catch (e) {
      if (alive()) put(hero, h('p', { class: 'empty', text: 'Prices could not be loaded: ' + e.message }));
    }
  })());

  /* ----- sections, in the visitor's order ----- */
  const builders = {
    mine: () => (state.acct && (state.acct.import || state.acct.export) ? mineSection(alive, jobs) : null),
    chart: () => chartSection(alive, jobs, agileData, ref, regionName),
    windows: () => windowsSection(alive, jobs, agileData),
    rates: () => ratesSection(alive, jobs, ref),
    tracker: () => trackerSection(alive, jobs, regionName),
    grid: () => gridSection(alive, jobs),
  };
  const shown = state.prefs.order.filter((id) => !state.prefs.hidden.includes(id))
    .map((id) => ({ id, half: (NOW_SECTIONS.find((s) => s.id === id) || {}).half, el: builders[id] && builders[id]() }))
    .filter((s) => s.el);
  // Two half-width sections next to each other share a row; a lone one takes the full width.
  for (let i = 0; i < shown.length; i++) {
    if (shown[i].half && shown[i + 1] && shown[i + 1].half) {
      root.append(h('div', { class: 'grid two' }, shown[i].el, shown[i + 1].el));
      i++;
    } else root.append(shown[i].el);
  }
  root.append(h('p', { class: 'fine center' }, h('a', { href: '#settings', text: 'Customise this page' }),
    ': choose the headline tariff, which sections appear, and which page opens first.'));

  return Promise.allSettled(jobs);
}

/* ---------- hero ---------- */

function drawHero(hero, head, exp, agileNow, ref, regionName) {
  const now = Date.now();
  const mid = T.londonMidnight(now);
  const today = head.points.filter((p) => p.f < T.addDays(mid, 1));
  const cur = at(head.points, now);
  if (!cur) {
    put(hero, h('p', { class: 'empty', text: 'No ' + head.name + ' price is published for this half hour.' }));
    return;
  }
  const change = head.points.find((p) => p.f > now && Math.abs(p.v - cur.v) > 0.005);
  const lo = today.reduce((a, p) => (p.v < a.v ? p : a), today[0]);
  const hi = today.reduce((a, p) => (p.v > a.v ? p : a), today[0]);
  const flat = hi.v - lo.v < 0.005;
  const avg = today.reduce((a, p) => a + p.v, 0) / (today.length || 1);
  const vs = ((avg - ref) / ref) * 100;
  const vsText = Math.abs(vs) < 0.5 ? 'the Flexible rate' : Math.abs(vs).toFixed(0) + '% ' + (vs < 0 ? 'below' : 'above') + ' Flexible';
  const exportTile = tile('Export now', exp ? p1(exp.v) : '–', exp ? exp.name : 'no export price');
  put(hero,
    h('div', { class: 'hero-main' },
      h('div', { class: 'eyebrow', text: head.name + ' now · ' + regionName }),
      h('div', { class: 'hero-fig' }, h('span', { class: 'hero-num', text: cur.v.toFixed(1) }), h('span', { class: 'unit', text: 'p/kWh' })),
      h('div', { class: 'hero-meta' },
        bandChip(T.bandOf(cur.v, ref)),
        change ? h('span', { text: 'until ' + T.fmtTime(change.f) }) : h('span', { text: flat ? 'same rate all day' : 'no change published yet' }),
        change ? h('span', { text: 'then ' + p1(change.v) + ' ' + (change.v > cur.v ? '▲' : '▼') }) : null)),
    h('div', { class: 'tiles hero-tiles' }, flat
      ? [
        tile('Rate today', p1(cur.v), vsText),
        head.sc != null ? tile('Standing charge', p2(head.sc), 'per day') : tile('Flexible', p1(ref), 'for comparison'),
        tile('Agile now', agileNow ? p1(agileNow.v) : '–', agileNow ? (agileNow.v < cur.v ? p1(cur.v - agileNow.v) + ' cheaper than this' : p1(agileNow.v - cur.v) + ' dearer than this') : ''),
        exportTile]
      : [
        tile('Today’s average', p1(avg), vsText),
        tile('Lowest today', p1(lo.v), 'from ' + T.fmtTime(lo.f)),
        tile('Highest today', p1(hi.v), 'from ' + T.fmtTime(hi.f)),
        exportTile]));
}

/* ---------- your latest day ---------- */

function mineSection(alive, jobs) {
  const c = card('Your latest day', { sub: state.demo ? 'Sample household' : 'From your smart meter' });
  c.el.querySelector('.card-head').append(h('div', { class: 'card-tools' }, h('a', { class: 'btn small', href: '#usage', text: 'Open My usage' })));
  jobs.push(fill(c.body, alive, async () => {
    const key = state.creds && state.creds.key;
    const kinds = ['import', 'export'].filter((k) => state.acct[k]);
    const data = {};
    await Promise.all(kinds.map(async (k) => {
      const cons = await loadUsage(k, 7, key);
      if (cons.length) data[k] = { actual: await actualCost(cons, state.acct[k].agreements, k), stats: T.usageStats(cons) };
    }));
    const main = data.import || data.export;
    if (!main) return h('p', { class: 'empty', text: 'No readings from the last week yet.' });
    // The newest day with a full set of readings; the most recent day is often still arriving.
    const fullDays = main.stats.days.filter((d) => d.n >= 46);
    const last = fullDays[fullDays.length - 1] || main.stats.days[main.stats.days.length - 1];
    const pick = (x) => x && x.actual.days.find((d) => d.key === last.key);
    const imp = pick(data.import), exp = pick(data.export);
    c.setSub(T.fmtDate(last.ts, { dow: true }) + (state.demo ? ' · sample household' : ''));
    const vsWeek = (d, x) => {
      const avg = x.actual.kwh / (x.actual.days.length || 1);
      if (!avg) return '';
      const pct = ((d.kwh - avg) / avg) * 100;
      return Math.abs(pct) < 3 ? 'about your 7-day average' : Math.abs(pct).toFixed(0) + '% ' + (pct > 0 ? 'above' : 'below') + ' your 7-day average';
    };
    return h('div', { class: 'tiles kpi' },
      imp ? tile('Used', kwhFmt(imp.kwh), vsWeek(imp, data.import)) : null,
      imp ? tile('Cost', gbp(imp.unit + imp.sc), imp.kwh ? p1(imp.unit / imp.kwh) + ' average unit rate' : '') : null,
      exp ? tile('Exported', kwhFmt(exp.kwh), vsWeek(exp, data.export)) : null,
      exp ? tile('Earned', gbp(exp.unit), exp.kwh ? p1(exp.unit / exp.kwh) + ' average paid' : 'nothing exported', 'good') : null,
      !exp && data.import ? tile('Last 7 days', gbp(data.import.actual.total), kwhFmt(data.import.actual.kwh)) : null);
  }));
  return c.el;
}

/* ---------- Agile chart ---------- */

function chartSection(alive, jobs, agileData, ref, regionName) {
  const chart = card('Agile half-hourly prices', { sub: regionName });
  const tools = h('div', { class: 'card-tools' });
  chart.el.querySelector('.card-head').append(tools);

  const draw = (data) => {
    const now = Date.now();
    const tomorrow = T.addDays(T.londonMidnight(now), 1);
    const isExport = state.agileDir === 'export';
    const pts = data[state.agileDir].points;
    const sets = {
      upcoming: pts.filter((p) => p.f + T.HALF > now),
      today: pts.filter((p) => p.f < tomorrow),
      tomorrow: pts.filter((p) => p.f >= tomorrow),
    };
    const shown = sets[state.agileView];
    put(tools,
      seg([{ v: 'upcoming', label: 'Upcoming' }, { v: 'today', label: 'Today' }, { v: 'tomorrow', label: 'Tomorrow' }],
        state.agileView, (v) => { state.agileView = v; draw(data); }, 'Time range'),
      seg([{ v: 'import', label: 'Import' }, { v: 'export', label: 'Export' }],
        state.agileDir, (v) => { state.agileDir = v; draw(data); }, 'Direction'));
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
      item('plunge', '0p or less'), item('cheap', 'under ' + p1(ref / 2)), item('fair', 'up to ' + p1(ref)),
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

  put(chart.body, loading());
  jobs.push(agileData().then((data) => { if (alive()) draw(data); },
    (e) => { if (alive()) put(chart.body, h('p', { class: 'empty', text: 'Agile prices could not be loaded: ' + e.message })); }));
  return chart.el;
}

/* ---------- cheapest times ---------- */

function windowsSection(alive, jobs, agileData) {
  const c = card('Cheapest times to run things', { sub: 'Lowest average Agile price from now on' });
  put(c.body, loading());
  jobs.push(agileData().then((data) => {
    if (!alive()) return;
    const now = Date.now();
    const up = data.import.points.filter((p) => p.f + T.HALF > now);
    const rows = [[1, '30 min'], [2, '1 hour'], [4, '2 hours'], [6, '3 hours'], [8, '4 hours']]
      .map(([n, label]) => ({ label, w: T.cheapestWindow(up, n) })).filter((r) => r.w);
    if (!rows.length) { put(c.body, h('p', { class: 'empty', text: 'No upcoming prices yet.' })); return; }
    const last = up[up.length - 1].f + T.HALF;
    const today = T.dayKey(now);
    put(c.body,
      h('table', { class: 'plain' },
        h('thead', {}, h('tr', {}, h('th', { text: 'For' }), h('th', { text: 'Start at' }), h('th', { class: 'num', text: 'Average' }))),
        h('tbody', {}, rows.map((r) => h('tr', {},
          h('td', { text: r.label }),
          h('td', {}, h('strong', { text: T.fmtTime(r.w.from) + '–' + T.fmtTime(r.w.to) }),
            T.dayKey(r.w.from) !== today ? h('span', { class: 'muted', text: ' ' + T.fmtDate(r.w.from, { dow: true }).split(' ')[0] }) : null),
          h('td', { class: 'num', text: p1(r.w.avg) }))))),
      h('p', { class: 'fine', text: 'Looking ahead to ' + T.fmtTime(last) + ' ' + T.fmtDate(last - 1, { dow: true }).split(' ')[0] + ', the last price published so far.' }));
  }, () => { if (alive()) put(c.body, h('p', { class: 'empty', text: 'No prices available.' })); }));
  return c.el;
}

/* ---------- right now across tariffs ---------- */

function ratesSection(alive, jobs, ref) {
  const c = card('Unit rate right now', { sub: 'What each tariff charges this half hour' });
  jobs.push(fill(c.body, alive, async () => {
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
  return c.el;
}

/* ---------- Tracker ---------- */

function trackerSection(alive, jobs, regionName) {
  const tracker = card('Tracker', { sub: 'One price per day, set from wholesale costs · ' + regionName });
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
  return tracker.el;
}

/* ---------- grid ---------- */

function gridSection(alive, jobs) {
  const gridCard = card('The grid right now', { sub: 'Great Britain generation mix and the wind and sun ahead' });
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
          h('tbody', {}, d.time.slice(1, 4).map((dayStr, i) => h('tr', {},
            h('td', { text: T.fmtDate(Date.parse(dayStr + 'T12:00:00Z'), { dow: true }) }),
            h('td', { class: 'num', text: d.wind_speed_10m_max[i + 1] != null ? Math.round(d.wind_speed_10m_max[i + 1]) + ' mph' : '–' }),
            h('td', { class: 'num', text: d.shortwave_radiation_sum[i + 1] != null ? d.shortwave_radiation_sum[i + 1].toFixed(1) + ' MJ/m²' : '–' }))))),
        h('p', { class: 'fine', text: 'Measured at Flamborough Head. Windy, bright days usually mean cheaper Agile prices.' })));
    }
    return out.children.length ? out : h('p', { class: 'empty', text: 'Grid data is unavailable right now.' });
  }));
  return gridCard.el;
}
