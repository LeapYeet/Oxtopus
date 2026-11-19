// "Compare": a typical home or your own readings priced on every tariff. Also exports the ranking used by My usage.

import * as api from './api.js';
import * as T from './tariffs.js';
import { h, put, stepLines } from './charts.js';
import {
  state, store, hooks, primary, profileToday, famById, candidates, priceProduct, actualCost, loadUsage, productName,
  card, fill, seg, tag, delta, gbp, p1, kwhFmt,
} from './core.js';

export const PERIODS = [{ v: 7, label: '7 days' }, { v: 30, label: '30 days' }, { v: 90, label: '90 days' }, { v: 365, label: '12 months' }];

export const setPeriod = (v) => { state.period = v; store.set('period', v); hooks.render(); };
export const rangeText = (cons) => T.fmtDate(cons[0].s) + ' – ' + T.fmtDate(cons[cons.length - 1].s, { year: true });

/* ---------- ranking ---------- */

/**
 * rows: priced products. base: the row everything is measured against (your tariff, or Flexible).
 * factor scales period totals (e.g. 30 days -> a year). Returns DOM nodes.
 */
export function ranking({ rows, base, kind, factor = 1, per = '' }) {
  const lowerGood = kind !== 'export';
  const all = rows.slice();
  if (base && !all.includes(base)) all.push(base);
  all.sort((a, b) => (lowerGood ? a.total - b.total : b.total - a.total));
  const partial = (r) => r.kwh > 0 && r.missing / r.kwh > 0.02;
  const usable = all.filter((r) => !partial(r));
  const best = usable[0];
  const max = Math.max(...all.map((r) => Math.abs(r.total)), 1);
  // Estimates are shown to the nearest pound; real readings to the penny.
  const money = (v) => gbp(v * factor, { round: factor !== 1 || Math.abs(v * factor) >= 100000 }) + per;
  const open = (r) => !r.needs || r.needs === 'Smart meter';
  const better = (a, b) => (lowerGood ? a.total < b.total : a.total > b.total);
  const gap = (r) => h('strong', { text: money(Math.abs(r.total - base.total)) });

  let headline;
  if (!best || !base) headline = h('p', { class: 'headline', text: 'Not enough data to rank tariffs for this period.' });
  else if (best === base) headline = h('p', { class: 'headline' }, h('strong', { text: base.label }), lowerGood ? ' is the cheapest option for this usage.' : ' already pays the most for this export.');
  else {
    // The overall winner often needs an EV, heat pump or battery, so also name the best one anyone can join.
    const bestOpen = usable.find(open);
    headline = h('p', { class: 'headline' },
      h('strong', { text: best.label }),
      lowerGood ? ' comes out cheapest: ' : ' pays the most: ', gap(best),
      (lowerGood ? ' less than ' : ' more than ') + (base.inline || base.label) + '.',
      open(best) ? null : h('span', { class: 'muted' }, ' Needs: ' + best.needs.toLowerCase() + '. ',
        bestOpen && bestOpen !== base && better(bestOpen, base)
          ? ['Without extra kit, ', h('strong', { text: bestOpen.label }), lowerGood ? ' saves ' : ' pays ', gap(bestOpen), lowerGood ? '.' : ' more.']
          : 'Without extra kit, nothing beats ' + (base.inline || base.label) + '.'));
  }

  const list = h('div', { class: 'rank', role: 'table', 'aria-label': 'Tariffs ranked by cost' }, all.map((r) => {
    const bar = h('span', { class: 'rank-fill' });
    bar.style.width = Math.max(1, (Math.abs(r.total) / max) * 100) + '%';
    const avg = r.kwh ? r.unit / (r.kwh - r.missing || 1) : NaN;
    const sub = [];
    if (r.sub) sub.push(r.sub);
    sub.push((lowerGood ? 'avg ' : 'paid avg ') + p1(avg) + '/kWh');
    if (lowerGood && r.standing) sub.push('standing ' + money(r.standing));
    return h('div', { class: 'rank-row' + (r === base ? ' is-base' : '') + (r === best ? ' is-best' : ''), role: 'row' },
      h('div', { class: 'rank-name', role: 'cell' },
        h('div', { class: 'rank-title' }, h('span', { text: r.label }),
          r === base && r.isYou ? tag('You', 'you') : null,
          r === best && r !== base ? tag(lowerGood ? 'Cheapest' : 'Best', 'best') : null,
          r.needs && r.needs !== 'Smart meter' ? tag('Needs: ' + r.needs) : null,
          partial(r) ? tag('Partial data', 'warn') : null),
        h('div', { class: 'rank-sub', text: sub.join(' · ') }),
        r.note ? h('div', { class: 'rank-sub', text: r.note }) : null),
      h('div', { class: 'rank-track', role: 'presentation' }, bar),
      h('div', { class: 'rank-total', role: 'cell', text: money(r.total) }),
      h('div', { class: 'rank-delta', role: 'cell' }, r === base || !base ? h('span', { class: 'delta flat', text: 'baseline' }) : delta((r.total - base.total) * factor, lowerGood, factor !== 1)));
  }));
  return [headline, list];
}

export async function priceAll(kind, cons) {
  return (await api.pool(candidates(kind), (p) => priceProduct(p, kind, cons), 4)).filter((r) => r && r.kwh > 0);
}

export const BASIS = 'Agile and Tracker are priced at the real rate for every half hour. Other tariffs use today’s prices, '
  + 'because that is what you would get by switching now. All prices include VAT.';

/* ---------- Compare ---------- */

export function viewCompare(root, alive) {
  const hasMeter = !!(state.acct && state.acct.import);
  if (state.source === 'account' && !hasMeter) state.source = 'estimate';
  const jobs = [];

  const filters = h('div', { class: 'filters' });
  filters.append(seg(
    [{ v: 'estimate', label: 'Typical home' }, { v: 'account', label: state.demo ? 'Sample readings' : 'My readings' }],
    state.source, (v) => {
      if (v === 'account' && !hasMeter) { hooks.go('usage'); return; }
      state.source = v; hooks.render();
    }, 'Usage to compare'));

  if (state.source === 'estimate') {
    const pick = (label, value, options, onChange) => h('label', { class: 'field' }, h('span', { text: label }),
      h('select', { onchange: (e) => onChange(Number(e.target.value)) },
        options.map(([v, text]) => h('option', { value: v, selected: v === value, text }))));
    const save = () => { store.set('est', state.est); hooks.render(); };
    filters.append(
      pick('Electricity a year', state.est.annual,
        [[1800, '1,800 kWh · low'], [2700, '2,700 kWh · medium'], [4100, '4,100 kWh · high'], [6000, '6,000 kWh'], [9000, '9,000 kWh']],
        (v) => { state.est.annual = v; save(); }),
      pick('Plus EV charging overnight', state.est.ev,
        [[0, 'None'], [1500, '1,500 kWh · about 5,000 miles'], [3000, '3,000 kWh · about 10,000 miles'], [4500, '4,500 kWh · about 15,000 miles']],
        (v) => { state.est.ev = v; save(); }));
  } else {
    filters.append(seg(PERIODS, state.period, setPeriod, 'Period'));
  }

  const rank = card('What each tariff would cost', { sub: '' });
  root.append(
    h('div', { class: 'page-head' }, h('h1', { text: 'Compare tariffs' }),
      h('p', { class: 'card-sub', text: 'Prices for ' + T.REGIONS[state.region] })),
    filters, rank.el);

  jobs.push(fill(rank.body, alive, async () => {
    if (state.source === 'estimate') {
      const cons = T.typicalUsage({ annualKwh: state.est.annual, evKwh: state.est.ev, days: 30, now: Date.now() });
      const rows = await priceAll('import', cons);
      const flex = primary('flexible');
      const base = rows.find((r) => r.p === flex) || rows[0];
      rank.setSub((state.est.annual + state.est.ev).toLocaleString('en-GB') + ' kWh a year, shaped like an average home'
        + (state.est.ev ? ' with the car charged 00:30–04:30' : '') + ' · Agile and Tracker from the last 30 days');
      return [
        // Scale by the exact number of half hours so a 23- or 25-hour clock-change day does not skew the year.
        ...ranking({ rows, base, kind: 'import', factor: (365 * 48) / cons.length, per: '/yr' }),
        h('p', { class: 'fine' }, BASIS + ' An estimate from a typical usage shape: ',
          h('a', { href: '#usage', text: 'add your API key' }), ' to price your real half-hourly readings.'),
      ];
    }
    const cons = await loadUsage('import', state.period, state.creds && state.creds.key);
    if (!cons.length) return h('p', { class: 'empty', text: 'No half-hourly readings for this period yet.' });
    const [rows, actual] = await Promise.all([priceAll('import', cons), actualCost(cons, state.acct.import.agreements, 'import')]);
    rank.setSub(kwhFmt(actual.kwh) + ' · ' + rangeText(cons));
    return [...ranking({ rows: dropOwn(rows, actual), base: youRow(actual), kind: 'import' }), h('p', { class: 'fine', text: BASIS })];
  }));

  /* ----- day shapes ----- */
  const shapes = card('Unit rate through the day', { sub: 'Today’s prices, ' + T.REGIONS[state.region] });
  root.append(shapes.el);
  jobs.push(fill(shapes.body, alive, async () => {
    const data = (await api.pool(T.CHART_FAMILIES, async (id) => {
      const p = primary(id);
      const prof = p && await profileToday(p);
      return prof ? { id, name: famById(id).short, cls: 's-' + id, values: prof.profile } : null;
    })).filter(Boolean);
    const box = h('div', { class: 'chart-box' });
    const chips = h('div', { class: 'legend toggles', role: 'group', 'aria-label': 'Tariffs shown' });
    const draw = () => {
      put(chips, ...data.map((s) => h('button', {
        type: 'button', class: 'pill key' + (state.chartOn.has(s.id) ? ' on' : ''), 'aria-pressed': String(state.chartOn.has(s.id)),
        onclick: () => {
          if (state.chartOn.has(s.id)) state.chartOn.delete(s.id); else state.chartOn.add(s.id);
          store.set('chartOn', [...state.chartOn]);
          draw();
        },
      }, h('i', { class: 'key-line ' + s.cls }), s.name)));
      const on = data.filter((s) => state.chartOn.has(s.id));
      if (!on.length) { put(box, h('p', { class: 'empty', text: 'Pick a tariff above to draw it.' })); return; }
      stepLines(box, on, { height: 300, labelAt: T.slotLabel, label: 'Unit rate for each half hour of today, by tariff' });
    };
    queueMicrotask(draw);
    return [chips, box, h('p', { class: 'fine', text: 'Intelligent Go is drawn with its standard 23:30–05:30 off-peak window.' })];
  }));

  return Promise.allSettled(jobs);
}

export function youRow(actual) {
  const names = [...new Set(actual.codes.map(productName))];
  return { ...actual, label: 'Your tariff', inline: 'your tariff', sub: names.join(', then '), isYou: true, needs: '' };
}

/** When you were on one tariff all period, hide its duplicate candidate row. */
export function dropOwn(rows, actual) {
  if (actual.codes.length !== 1) return rows;
  const t = T.parseTariffCode(actual.codes[0]);
  return rows.filter((r) => !t || r.p.code !== t.product);
}
