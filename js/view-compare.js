// "Compare" (typical home or your own readings against every tariff) and "My usage" (API key).

import * as api from './api.js';
import * as T from './tariffs.js';
import { h, put, columns, stepLines } from './charts.js';
import {
  state, store, hooks, tf, primary, flexRef, profileToday, famById, candidates, priceProduct, actualCost,
  currentAgreement, loadUsage, GAS_M3_TO_KWH, card, fill, seg, tag, tile, delta, gbp, p1, p2, kwhFmt, loading,
} from './core.js';

const PERIODS = [{ v: 7, label: '7 days' }, { v: 30, label: '30 days' }, { v: 90, label: '90 days' }, { v: 365, label: '12 months' }];
const KIND_LABEL = { import: 'Electricity', export: 'Export', gas: 'Gas' };

const setPeriod = (v) => { state.period = v; store.set('period', v); hooks.render(); };
const rangeText = (cons) => T.fmtDate(cons[0].s) + ' – ' + T.fmtDate(cons[cons.length - 1].s, { year: true });

function productName(tariffCode) {
  const t = T.parseTariffCode(tariffCode);
  if (!t) return tariffCode;
  const p = state.cat.products.find((x) => x.code === t.product);
  return p ? p.label : T.familyOf(t.product).short + ' (' + t.product + ')';
}

/* ---------- ranking ---------- */

/**
 * rows: priced products. base: the row everything is measured against (your tariff, or Flexible).
 * factor scales period totals (e.g. 30 days -> a year). Returns DOM nodes.
 */
function ranking({ rows, base, kind, factor = 1, per = '' }) {
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

async function priceAll(kind, cons) {
  return (await api.pool(candidates(kind), (p) => priceProduct(p, kind, cons), 4)).filter((r) => r && r.kwh > 0);
}

const BASIS = 'Agile and Tracker are priced at the real rate for every half hour. Other tariffs use today’s prices, '
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

function youRow(actual) {
  const names = [...new Set(actual.codes.map(productName))];
  return { ...actual, label: 'Your tariff', inline: 'your tariff', sub: names.join(', then '), isYou: true, needs: '' };
}

/** When you were on one tariff all period, hide its duplicate candidate row. */
function dropOwn(rows, actual) {
  if (actual.codes.length !== 1) return rows;
  const t = T.parseTariffCode(actual.codes[0]);
  return rows.filter((r) => !t || r.p.code !== t.product);
}

/* ---------- My usage ---------- */

function connectForm() {
  const key = h('input', { type: 'password', id: 'apikey', name: 'apikey', autocomplete: 'off', spellcheck: 'false', placeholder: 'sk_live_…', required: true });
  const acc = h('input', { type: 'text', id: 'accno', name: 'accno', autocomplete: 'off', spellcheck: 'false', placeholder: 'A-1234ABCD' });
  const remember = h('input', { type: 'checkbox', id: 'remember', checked: true });
  const msg = h('p', { class: 'form-msg', role: 'alert' });
  const submit = h('button', { type: 'submit', class: 'btn primary', text: 'Connect' });
  const form = h('form', { class: 'connect', onsubmit: async (e) => {
    e.preventDefault();
    msg.textContent = '';
    submit.disabled = true;
    submit.textContent = 'Connecting…';
    try {
      await hooks.connect(key.value, acc.value, remember.checked);
      hooks.render();
    } catch (err) {
      msg.textContent = err.message;
      submit.disabled = false;
      submit.textContent = 'Connect';
    }
  } },
  h('label', { for: 'apikey', text: 'API key' }), key,
  h('p', { class: 'fine' }, 'Find it in your Octopus account under ',
    h('a', { href: 'https://octopus.energy/dashboard/new/accounts/personal-details/api-access', target: '_blank', rel: 'noopener noreferrer', text: 'Personal details → API access' }), '.'),
  h('label', { for: 'accno' }, 'Account number ', h('span', { class: 'muted', text: '(optional)' })), acc,
  h('p', { class: 'fine', text: 'Leave blank to look it up from the key. It is on your bill and starts with A-.' }),
  h('label', { class: 'check' }, remember, 'Remember on this device'),
  msg,
  h('div', { class: 'row' }, submit,
    h('button', { type: 'button', class: 'btn', onclick: () => hooks.sample(), text: 'Try with sample data' })));
  return form;
}

function connectView(root) {
  root.append(
    h('div', { class: 'page-head' }, h('h1', { text: 'My usage' }),
      h('p', { class: 'card-sub', text: 'See what you used, what it cost, and what every other tariff would have charged.' })),
    h('div', { class: 'grid two' },
      h('section', { class: 'card' }, h('header', { class: 'card-head' }, h('div', {}, h('h2', { text: 'Connect your Octopus account' }))), connectForm()),
      h('section', { class: 'card' },
        h('header', { class: 'card-head' }, h('div', {}, h('h2', { text: 'Where your key goes' }))),
        h('ul', { class: 'bullets' },
          h('li', { text: 'Your key stays in this browser. It is sent only to api.octopus.energy, straight from your device.' }),
          h('li', { text: 'This site has no server, no analytics and no third-party scripts, so nobody else can see it.' }),
          h('li', { text: 'The key is read-only: it can see readings and tariffs, and cannot change your account.' }),
          h('li', { text: 'Untick “Remember” to keep it for this tab only. “Disconnect” removes it at any time.' }),
          h('li', { text: 'You can revoke the key from the same Octopus page whenever you like.' })))));
  return Promise.resolve();
}

export function viewUsage(root, alive) {
  if (state.connecting) {
    root.append(loading('Connecting to your Octopus account…'));
    return state.connecting.then(() => { if (alive()) hooks.render(); }, () => { if (alive()) hooks.render(); });
  }
  if (!state.acct) return connectView(root);

  const kinds = ['import', 'export', 'gas'].filter((k) => state.acct[k]);
  if (!kinds.includes(state.usageKind)) state.usageKind = kinds[0];
  const kind = state.usageKind;
  const meter = state.acct[kind];
  const cur = currentAgreement(meter.agreements);
  const masked = state.demo ? state.acct.number : state.acct.number.replace(/^(A-)(.*)(.{4})$/, (_, a, mid, end) => a + '•'.repeat(mid.length) + end);

  const filters = h('div', { class: 'filters' }, seg(PERIODS, state.period, setPeriod, 'Period'));
  if (kinds.length > 1) filters.append(seg(kinds.map((k) => ({ v: k, label: KIND_LABEL[k] })), kind, (v) => { state.usageKind = v; hooks.render(); }, 'Meter'));
  if (kind === 'gas' && !state.demo) {
    filters.append(seg([{ v: 'm3', label: 'Meter reads m³' }, { v: 'kwh', label: 'Meter reads kWh' }], state.gasUnit,
      (v) => { state.gasUnit = v; store.set('gasUnit', v); hooks.render(); }, 'Gas meter units'));
  }

  put(root,
    h('div', { class: 'page-head split' },
      h('div', {}, h('h1', { text: 'My usage' }),
        h('p', { class: 'card-sub', text: masked + (cur ? ' · ' + productName(cur.tariff_code) : '') })),
      h('button', { class: 'btn', onclick: () => hooks.disconnect(), text: state.demo ? 'Close sample' : 'Disconnect' })),
    state.demo ? h('p', { class: 'banner' }, h('strong', { text: 'Sample data. ' }), 'A made-up household with an EV on Agile, so you can see how this works. ',
      h('button', { class: 'link', onclick: () => hooks.disconnect(), text: 'Connect your own account' }), '.') : null,
    filters);

  const body = h('div', { class: 'stack' });
  root.append(body);
  return fill(body, alive, () => usagePanel(kind, meter));
}

async function usagePanel(kind, meter) {
  let cons = await loadUsage(kind, state.period, state.creds && state.creds.key);
  if (kind === 'gas' && !state.demo && state.gasUnit === 'm3') cons = cons.map((c) => ({ s: c.s, kwh: c.kwh * GAS_M3_TO_KWH }));
  if (!cons.length) {
    return h('section', { class: 'card' }, h('p', { class: 'empty', text: 'No half-hourly readings for this period. '
      + 'Readings usually arrive a day behind, and some meters only send them once the smart meter is fully set up.' }));
  }
  const lowerGood = kind !== 'export';
  const [rows, actual] = await Promise.all([priceAll(kind, cons), actualCost(cons, meter.agreements, kind)]);
  const days = actual.days.length || 1;
  const flex = kind === 'export' ? null : rows.find((r) => r.p === primary('flexible'));
  const priced = actual.kwh - actual.missing;

  const tiles = h('div', { class: 'tiles four' },
    tile(kind === 'export' ? 'Exported' : 'Used', kwhFmt(actual.kwh), (actual.kwh / days).toFixed(1) + ' kWh a day'),
    tile(kind === 'export' ? 'Earned' : 'Cost', gbp(actual.total), lowerGood ? 'including ' + gbp(actual.standing) + ' standing charge' : gbp(actual.total / days) + ' a day'),
    tile(kind === 'export' ? 'Average paid' : 'Average unit rate', priced > 0 ? p1(actual.unit / priced) : '–',
      lowerGood && priced > 0 ? p1(actual.total / priced) + ' with standing charge' : 'per kWh'),
    flex ? tile('Against Flexible', gbp(Math.abs(flex.total - actual.total)), flex.total >= actual.total ? '▼ less than Flexible would have cost' : '▲ more than Flexible would have cost',
      flex.total >= actual.total ? 'good' : 'bad')
      : tile('Days of data', String(days), rangeText(cons)));

  /* daily chart */
  const daily = card(kind === 'export' ? 'Export by day' : 'Usage by day', { sub: rangeText(cons) + ' · readings up to ' + T.fmtTime(cons[cons.length - 1].s + T.HALF) + ' on ' + T.fmtDate(cons[cons.length - 1].s + T.HALF, { dow: true }) });
  const dailyBox = h('div', { class: 'chart-box' });
  const dailyTools = h('div', { class: 'card-tools' });
  daily.el.querySelector('.card-head').append(dailyTools);
  daily.body.append(dailyBox);
  const weekly = actual.days.length > 100;
  const buckets = [];
  for (const d of actual.days) {
    const last = buckets[buckets.length - 1];
    if (weekly && last && last.n < 7) { last.kwh += d.kwh; last.cost += d.unit + d.sc; last.n++; last.end = d.ts; } else buckets.push({ ts: d.ts, end: d.ts, kwh: d.kwh, cost: d.unit + d.sc, n: 1 });
  }
  const drawDaily = () => {
    const money = state.dailyMetric === 'cost';
    put(dailyTools, seg([{ v: 'kwh', label: 'kWh' }, { v: 'cost', label: '£' }], state.dailyMetric, (v) => { state.dailyMetric = v; drawDaily(); }, 'Measure'));
    const every = Math.max(1, Math.ceil(buckets.length / 6));
    columns(dailyBox, buckets.map((b) => ({
      v: money ? b.cost / 100 : b.kwh, cls: kind === 'export' ? 'b-export' : 's-usage',
      tipTitle: weekly ? T.fmtDate(b.ts) + ' – ' + T.fmtDate(b.end) : T.fmtDate(b.ts, { dow: true }),
      tipRows: [{ value: kwhFmt(b.kwh), label: kind === 'export' ? 'exported' : 'used' }, { value: gbp(b.cost), label: lowerGood ? 'cost' : 'earned' }],
    })), {
      height: 240, fmtY: (v) => (money ? '£' + v : String(v)),
      xTicks: buckets.map((b, i) => (i % every === 0 ? { i, label: T.fmtDate(b.ts) } : null)).filter(Boolean),
      label: (weekly ? 'Weekly ' : 'Daily ') + (money ? 'cost' : 'energy'),
    });
  };

  /* time of day */
  const slots = new Array(48).fill(0);
  for (const c of cons) slots[T.slotOf(c.s)] += c.kwh;
  const share = (a, b) => (slots.slice(a, b).reduce((x, y) => x + y, 0) / (actual.kwh || 1)) * 100;
  const tod = card(kind === 'export' ? 'When you export' : 'When you use it', { sub: 'Average kWh in each half hour of the day' });
  const todBox = h('div', { class: 'chart-box' });
  const todNote = kind === 'import'
    ? share(0, 14).toFixed(0) + '% falls overnight (00:00–07:00) and ' + share(32, 38).toFixed(0)
      + '% in the 16:00–19:00 peak. Shifting use out of the peak is what makes Agile, Go and Cosy pay off.'
    : kind === 'export'
      ? share(32, 38).toFixed(0) + '% of your export lands in the 16:00–19:00 peak, when Agile Outgoing and Flux pay the most.'
      : '';
  tod.body.append(todBox);
  if (todNote) tod.body.append(h('p', { class: 'fine', text: todNote }));
  const drawTod = () => columns(todBox, slots.map((v, s) => ({
    v: v / days, cls: kind === 'export' ? 'b-export' : 's-usage',
    tipTitle: T.slotLabel(s) + '–' + T.slotLabel((s + 1) % 48),
    tipRows: [{ value: (v / days).toFixed(2) + ' kWh', label: 'average' }],
  })), {
    height: 220, fmtY: (v) => String(v),
    xTicks: [0, 12, 24, 36].map((i) => ({ i, edge: true, label: T.slotLabel(i) })),
    label: 'Average energy by time of day',
  });

  /* ranking */
  const rank = card(kind === 'export' ? 'What each export tariff would have paid' : 'What each tariff would have cost', { sub: kwhFmt(actual.kwh) + ' · ' + rangeText(cons) });
  rank.body.append(...ranking({ rows: dropOwn(rows, actual), base: youRow(actual), kind }),
    h('p', { class: 'fine', text: (kind === 'gas' ? 'Tracker is priced at the real rate for every day. Other tariffs use today’s prices. All prices include VAT.'
      : kind === 'export' ? 'Agile Outgoing is priced at the real rate for every half hour. Other export tariffs use today’s prices.' : BASIS)
      + (actual.note ? ' ' + actual.note : '')
      + (actual.missing > 0.02 * actual.kwh ? ' Some of your readings fall where no rate is published, so your own total is incomplete.' : '')
      + (kind === 'gas' && !state.demo && state.gasUnit === 'm3' ? ' Gas converted from m³ at ' + GAS_M3_TO_KWH.toFixed(2) + ' kWh per m³.' : '') }));

  queueMicrotask(() => { drawDaily(); drawTod(); });
  return [tiles, daily.el, tod.el, rank.el];
}
