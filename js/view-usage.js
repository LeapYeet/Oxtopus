// "My usage": connect an Octopus account, then explore electricity, export and gas readings.

import * as T from './tariffs.js';
import { h, put, columns, stepLines, heat, segbar } from './charts.js';
import {
  state, store, hooks, primary, flexRef, actualCost, currentAgreement, loadUsage, productName, GAS_M3_TO_KWH,
  card, fill, seg, tile, gbp, p1, kwhFmt, loading,
} from './core.js';
import { PERIODS, setPeriod, rangeText, ranking, priceAll, BASIS, youRow, dropOwn } from './view-compare.js';

const KIND_LABEL = { overview: 'Overview', import: 'Electricity', export: 'Export', gas: 'Gas' };
const day = (d) => (d ? T.fmtDate(d.ts, { dow: true }) : '');
const kw = (kwh) => (kwh * 2 >= 1 ? (kwh * 2).toFixed(1) + ' kW' : Math.round(kwh * 2000) + ' W');

/* ---------- connecting ---------- */

function connectForm() {
  const key = h('input', { type: 'password', id: 'apikey', name: 'apikey', autocomplete: 'off', spellcheck: 'false', placeholder: 'sk_live_…', required: true });
  const acc = h('input', { type: 'text', id: 'accno', name: 'accno', autocomplete: 'off', spellcheck: 'false', placeholder: 'A-1234ABCD' });
  const remember = h('input', { type: 'checkbox', id: 'remember', checked: true });
  const msg = h('p', { class: 'form-msg', role: 'alert' });
  const submit = h('button', { type: 'submit', class: 'btn primary', text: 'Connect' });
  return h('form', { class: 'connect', onsubmit: async (e) => {
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
}

function connectView(root) {
  root.append(
    h('div', { class: 'page-head' }, h('h1', { text: 'My usage' }),
      h('p', { class: 'card-sub', text: 'See what you used, exported and paid, and what every other tariff would have charged.' })),
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

/* ---------- shell ---------- */

export function viewUsage(root, alive) {
  if (state.connecting) {
    root.append(loading('Connecting to your Octopus account…'));
    return state.connecting.then(() => { if (alive()) hooks.render(); }, () => { if (alive()) hooks.render(); });
  }
  if (!state.acct) return connectView(root);

  const meters = ['import', 'export', 'gas'].filter((k) => state.acct[k]);
  const tabs = meters.length > 1 ? ['overview', ...meters] : meters;
  if (!tabs.includes(state.usageKind)) state.usageKind = tabs[0];
  const kind = state.usageKind;
  const cur = currentAgreement((state.acct[kind === 'overview' ? meters[0] : kind]).agreements);
  const masked = state.demo ? state.acct.number : state.acct.number.replace(/^(A-)(.*)(.{4})$/, (_, a, mid, end) => a + '•'.repeat(mid.length) + end);

  const filters = h('div', { class: 'filters' }, seg(PERIODS, state.period, setPeriod, 'Period'));
  if (tabs.length > 1) filters.append(seg(tabs.map((k) => ({ v: k, label: KIND_LABEL[k] })), kind, (v) => { state.usageKind = v; hooks.render(); }, 'Meter'));
  if (state.acct.gas && !state.demo && (kind === 'gas' || kind === 'overview')) {
    filters.append(seg([{ v: 'm3', label: 'Gas meter reads m³' }, { v: 'kwh', label: 'reads kWh' }], state.gasUnit,
      (v) => { state.gasUnit = v; store.set('gasUnit', v); hooks.render(); }, 'Gas meter units'));
  }

  put(root,
    h('div', { class: 'page-head split' },
      h('div', {}, h('h1', { text: 'My usage' }),
        h('p', { class: 'card-sub', text: masked + (cur ? ' · ' + productName(cur.tariff_code) : '') })),
      h('button', { class: 'btn', onclick: () => hooks.disconnect(), text: state.demo ? 'Close sample' : 'Disconnect' })),
    state.demo ? h('p', { class: 'banner' }, h('strong', { text: 'Sample data. ' }), 'A made-up household with an EV, solar panels and gas heating, so you can see how this works. ',
      h('button', { class: 'link', onclick: () => hooks.disconnect(), text: 'Connect your own account' }), '.') : null,
    filters);

  const body = h('div', { class: 'stack' });
  root.append(body);
  return fill(body, alive, () => (kind === 'overview' ? overviewPanel(meters) : usagePanel(kind)));
}

/** Readings, what they actually cost, and summary statistics for one meter over the chosen period. */
async function loadKind(kind, each) {
  let cons = await loadUsage(kind, state.period, state.creds && state.creds.key);
  if (kind === 'gas' && !state.demo && state.gasUnit === 'm3') cons = cons.map((c) => ({ s: c.s, kwh: c.kwh * GAS_M3_TO_KWH }));
  if (!cons.length) return null;
  const actual = await actualCost(cons, state.acct[kind].agreements, kind, each);
  return { kind, cons, actual, stats: T.usageStats(cons), priced: actual.kwh - actual.missing };
}

const noData = (what) => h('section', { class: 'card' }, h('p', { class: 'empty', text: 'No half-hourly ' + what + ' readings for this period. '
  + 'Readings usually arrive a day behind, and some meters only send them once the smart meter is fully set up.' }));

function weeklyBuckets(days, pick) {
  const weekly = days.length > 100;
  const out = [];
  for (const d of days) {
    const last = out[out.length - 1];
    if (weekly && last && last.n < 7) { for (const k of Object.keys(pick(d))) last[k] += pick(d)[k]; last.n++; last.end = d.ts; } else out.push({ ts: d.ts, end: d.ts, n: 1, ...pick(d) });
  }
  return { weekly, list: out };
}

const bucketTitle = (b, weekly) => (weekly ? T.fmtDate(b.ts) + ' – ' + T.fmtDate(b.end) : T.fmtDate(b.ts, { dow: true }));
const bucketTicks = (list) => {
  const every = Math.max(1, Math.ceil(list.length / 6));
  return list.map((b, i) => (i % every === 0 ? { i, label: T.fmtDate(b.ts) } : null)).filter(Boolean);
};

/* ---------- overview: every meter together ---------- */

async function overviewPanel(meters) {
  const loaded = {};
  for (const d of await Promise.all(meters.map((k) => loadKind(k)))) if (d) loaded[d.kind] = d;
  const imp = loaded.import, exp = loaded.export, gas = loaded.gas;
  if (!imp && !exp && !gas) return noData('meter');
  const first = imp || exp || gas;
  const elec = imp ? imp.actual.total : 0, earned = exp ? exp.actual.total : 0, gasCost = gas ? gas.actual.total : 0;
  const net = elec + gasCost - earned;
  const out = [];

  out.push(h('div', { class: 'tiles kpi' },
    imp ? tile('Electricity', gbp(elec), kwhFmt(imp.actual.kwh) + ' bought') : null,
    exp ? tile('Export', gbp(earned), kwhFmt(exp.actual.kwh) + ' sold', 'good') : null,
    gas ? tile('Gas', gbp(gasCost), kwhFmt(gas.actual.kwh) + ' burned') : null,
    tile(exp ? 'Net energy bill' : 'Energy bill', gbp(net), exp ? 'after export · ' + gbp(net / (first.actual.days.length || 1)) + ' a day' : gbp(net / (first.actual.days.length || 1)) + ' a day')));

  if (imp && exp) {
    const impAvg = imp.priced ? imp.actual.unit / imp.priced : NaN;
    const expAvg = exp.priced ? exp.actual.unit / exp.priced : NaN;
    const expByDay = new Map(exp.actual.days.map((d) => [d.key, d]));
    // What a battery could at most have moved: on each day, the smaller of what was sold and what was bought.
    let shift = 0, bothDays = 0;
    for (const d of imp.actual.days) {
      const e = expByDay.get(d.key);
      if (e && e.kwh > 0.05 && d.kwh > 0.05) { shift += Math.min(d.kwh, e.kwh); bothDays++; }
    }
    const shiftValue = shift * (impAvg - expAvg);
    const cover = elec > 0 ? (earned / elec) * 100 : 0;

    /* balance chart */
    const bal = card('Bought and sold', { sub: rangeText(first.cons) + ' · import above the line, export below' });
    const balBox = h('div', { class: 'chart-box' });
    const allDays = imp.actual.days.map((d) => ({ ts: d.ts, imp: d.kwh, exp: (expByDay.get(d.key) || { kwh: 0 }).kwh }));
    const { weekly, list } = weeklyBuckets(allDays, (d) => ({ imp: d.imp, exp: d.exp }));
    bal.body.append(
      h('p', { class: 'headline' }, 'Export earned ', h('strong', { text: gbp(earned) }), ', which covers ',
        h('strong', { text: cover.toFixed(0) + '%' }), ' of your electricity bill.'),
      balBox,
      h('div', { class: 'legend' },
        h('span', { class: 'chip' }, h('i', { class: 'swatch s-usage' }), 'Imported'),
        h('span', { class: 'chip' }, h('i', { class: 'swatch b-export' }), 'Exported')));
    const drawBal = () => columns(balBox, list.map((b) => ({
      v: b.imp, cls: 's-usage', v2: -b.exp, cls2: 'b-export',
      tipTitle: bucketTitle(b, weekly),
      tipRows: [{ value: kwhFmt(b.imp), label: 'imported', cls: 'key-box s-usage' }, { value: kwhFmt(b.exp), label: 'exported', cls: 'key-box b-export' },
        { value: kwhFmt(Math.abs(b.imp - b.exp)), label: b.imp >= b.exp ? 'net import' : 'net export' }],
    })), { height: 260, fmtY: (v) => String(Math.abs(v)), xTicks: bucketTicks(list), label: (weekly ? 'Weekly' : 'Daily') + ' import and export in kWh' });

    /* through the day */
    const prof = card('Through the day', { sub: 'Average kWh in each half hour: when you buy and when you sell' });
    const profBox = h('div', { class: 'chart-box' });
    prof.body.append(
      h('div', { class: 'legend toggles' },
        h('span', { class: 'chip' }, h('i', { class: 'key-line s-usage' }), 'Imported'),
        h('span', { class: 'chip' }, h('i', { class: 'key-line b-export' }), 'Exported')),
      profBox);
    const drawProf = () => stepLines(profBox, [
      { name: 'Imported', cls: 's-usage', values: imp.stats.slotAvg },
      { name: 'Exported', cls: 'b-export', values: exp.stats.slotAvg },
    ], { height: 240, labelAt: T.slotLabel, fmt: (v) => v.toFixed(2) + ' kWh', fmtY: (v) => String(v), minTop: 0.1, label: 'Average import and export by time of day' });

    const facts = card('Worth knowing', {});
    facts.body.append(h('div', { class: 'tiles facts-grid' },
      tile('You buy at', p1(impAvg), 'average per kWh'),
      tile('You sell at', p1(expAvg), Number.isFinite(impAvg) && impAvg > 0 ? (expAvg / impAvg * 100).toFixed(0) + '% of what you pay' : 'average per kWh'),
      tile('Net from the grid', kwhFmt(Math.abs(imp.actual.kwh - exp.actual.kwh)), imp.actual.kwh >= exp.actual.kwh ? 'more bought than sold' : 'more sold than bought'),
      tile('Days you exported', exp.stats.activeDays + ' of ' + exp.stats.fullDays, 'best: ' + kwhFmt(exp.stats.busiest ? exp.stats.busiest.kwh : 0) + ' on ' + day(exp.stats.busiest)),
      shift > 0.5 && shiftValue > 0 ? tile('A battery could move', 'up to ' + kwhFmt(shift), 'worth up to ' + gbp(shiftValue) + ' over ' + bothDays + ' days') : null,
      gas ? tile('Gas share of bill', ((gasCost / ((elec + gasCost) || 1)) * 100).toFixed(0) + '%', gbp(gasCost) + ' of ' + gbp(elec + gasCost)) : null));
    if (shift > 0.5 && shiftValue > 0) {
      facts.body.append(h('p', { class: 'fine', text: 'The battery figure is an upper limit: on each day it takes the smaller of what you sold and what you bought, '
        + 'valued at the gap between your buying and selling price. It ignores battery size, losses and the cost of the battery.' }));
    }
    out.push(bal.el, h('div', { class: 'grid two' }, prof.el, facts.el));
    queueMicrotask(() => { drawBal(); drawProf(); });
  } else {
    const facts = card('Worth knowing', {});
    facts.body.append(h('div', { class: 'tiles facts-grid' },
      imp ? tile('Electricity a day', (imp.actual.kwh / (imp.actual.days.length || 1)).toFixed(1) + ' kWh', gbp(elec / (imp.actual.days.length || 1)) + ' a day') : null,
      gas ? tile('Gas a day', (gas.actual.kwh / (gas.actual.days.length || 1)).toFixed(1) + ' kWh', gbp(gasCost / (gas.actual.days.length || 1)) + ' a day') : null,
      gas && imp ? tile('Gas share of bill', ((gasCost / ((elec + gasCost) || 1)) * 100).toFixed(0) + '%', gbp(gasCost) + ' of ' + gbp(elec + gasCost)) : null,
      exp ? tile('Export a day', (exp.actual.kwh / (exp.actual.days.length || 1)).toFixed(1) + ' kWh', gbp(earned / (exp.actual.days.length || 1)) + ' a day') : null));
    out.push(facts.el);
  }
  const parts = [
    imp ? { label: 'Electricity used', value: imp.actual.unit, cls: 's-agile', text: gbp(imp.actual.unit) } : null,
    imp ? { label: 'Electricity standing charge', value: imp.actual.standing, cls: 's-snug', text: gbp(imp.actual.standing) } : null,
    gas ? { label: 'Gas used', value: gas.actual.unit, cls: 's-tracker', text: gbp(gas.actual.unit) } : null,
    gas ? { label: 'Gas standing charge', value: gas.actual.standing, cls: 's-igo', text: gbp(gas.actual.standing) } : null,
  ].filter((x) => x && x.value > 0);
  if (parts.length > 1) {
    const standing = (imp ? imp.actual.standing : 0) + (gas ? gas.actual.standing : 0);
    const split = card('Where your bill goes', { sub: gbp(elec + gasCost) + ' before export · ' + rangeText(first.cons) });
    split.body.append(segbar(parts, { label: 'Bill split between energy used and standing charges' }),
      h('p', { class: 'fine', text: 'Standing charges are ' + ((standing / ((elec + gasCost) || 1)) * 100).toFixed(0) + '% of the bill (' + gbp(standing)
        + '). You pay them whatever you use, so they are the part a cheaper unit rate cannot touch.' }));
    out.push(split.el);
  }
  out.push(h('p', { class: 'fine', text: 'Pick ' + meters.map((k) => KIND_LABEL[k]).join(', ').replace(/, ([^,]*)$/, ' or $1') + ' above for the detail on each meter and what other tariffs would have charged.' }));
  return out;
}

/* ---------- one meter ---------- */

function highlights(kind, d) {
  const s = d.stats, a = d.actual;
  const avg = d.priced ? a.unit / d.priced : NaN;
  const costOf = (x) => x.unit + x.sc;
  const dearest = a.days.reduce((m, x) => (!m || costOf(x) > costOf(m) ? x : m), null);
  const list = [];
  if (kind === 'export') {
    list.push(
      tile('Best day', kwhFmt(s.busiest ? s.busiest.kwh : 0), day(s.busiest)),
      tile('Days you exported', s.activeDays + ' of ' + s.fullDays, s.fullDays ? ((s.activeDays / s.fullDays) * 100).toFixed(0) + '% of days' : ''),
      tile('Peak export', s.peak ? kw(s.peak.kwh) : '–', s.peak ? T.fmtTime(s.peak.s) + ' on ' + T.fmtDate(s.peak.s) : ''),
      tile('Sold in the 16:00–19:00 peak', ((s.slotTotal.slice(32, 38).reduce((x, y) => x + y, 0) / (s.total || 1)) * 100).toFixed(0) + '%', 'when Agile Outgoing and Flux pay most'),
      tile('Sold 10:00–15:00', ((s.slotTotal.slice(20, 30).reduce((x, y) => x + y, 0) / (s.total || 1)) * 100).toFixed(0) + '%', 'the middle of the day'),
      dearest ? tile('Best-paid day', gbp(dearest.unit), day(dearest)) : null);
  } else {
    const always = kind === 'import' && Number.isFinite(s.baseKw);
    list.push(
      always ? tile('Always-on load', Math.round(s.baseKw * 1000) + ' W', Number.isFinite(avg) ? 'about ' + gbp(s.baseKw * 8760 * avg, { round: true }) + ' a year at your average rate' : 'what runs around the clock') : null,
      tile('Busiest day', kwhFmt(s.busiest ? s.busiest.kwh : 0), day(s.busiest)),
      tile('Quietest day', kwhFmt(s.quietest ? s.quietest.kwh : 0), day(s.quietest)),
      Number.isFinite(s.weekdayAvg) && Number.isFinite(s.weekendAvg) ? tile('Weekday / weekend', s.weekdayAvg.toFixed(1) + ' / ' + s.weekendAvg.toFixed(1), 'kWh on an average day') : null,
      tile('Biggest half hour', s.peak ? kw(s.peak.kwh) : '–', s.peak ? T.fmtTime(s.peak.s) + ' on ' + T.fmtDate(s.peak.s) : ''),
      dearest ? tile('Dearest day', gbp(costOf(dearest)), day(dearest)) : null);
  }
  const c = card('Worth knowing', {});
  c.body.append(h('div', { class: 'tiles facts-grid' }, list));
  return c.el;
}

async function usagePanel(kind) {
  const lowerGood = kind !== 'export';
  const ref = flexRef();
  const bands = { plunge: 0, cheap: 0, fair: 0, pricey: 0, peak: 0 };
  const d = await loadKind(kind, kind === 'import' ? (c, r) => { bands[T.bandOf(r, ref)] += c.kwh; } : null);
  if (!d) return noData(KIND_LABEL[kind].toLowerCase());
  const { cons, actual, stats } = d;
  const rows = await priceAll(kind, cons);
  const days = actual.days.length || 1;
  const flex = kind === 'export' ? null : rows.find((r) => r.p === primary('flexible'));

  const tiles = h('div', { class: 'tiles four' },
    tile(kind === 'export' ? 'Exported' : 'Used', kwhFmt(actual.kwh), (actual.kwh / days).toFixed(1) + ' kWh a day'),
    tile(kind === 'export' ? 'Earned' : 'Cost', gbp(actual.total), lowerGood ? 'including ' + gbp(actual.standing) + ' standing charge' : gbp(actual.total / days) + ' a day'),
    tile(kind === 'export' ? 'Average paid' : 'Average unit rate', d.priced > 0 ? p1(actual.unit / d.priced) : '–',
      lowerGood && d.priced > 0 ? p1(actual.total / d.priced) + ' with standing charge' : 'per kWh'),
    flex ? tile('Against Flexible', gbp(Math.abs(flex.total - actual.total)), flex.total >= actual.total ? '▼ less than Flexible would have cost' : '▲ more than Flexible would have cost',
      flex.total >= actual.total ? 'good' : 'bad')
      : tile('Days of data', String(days), rangeText(cons)));

  /* daily chart, with a monthly table for longer periods */
  const lastEnd = cons[cons.length - 1].s + T.HALF;
  const daily = card(kind === 'export' ? 'Export by day' : 'Usage by day', { sub: rangeText(cons) + ' · readings up to ' + T.fmtTime(lastEnd) + ' on ' + T.fmtDate(lastEnd, { dow: true }) });
  const dailyBox = h('div', { class: 'chart-box' });
  const dailyTools = h('div', { class: 'card-tools' });
  daily.el.querySelector('.card-head').append(dailyTools);
  daily.body.append(dailyBox);
  const { weekly, list: buckets } = weeklyBuckets(actual.days, (x) => ({ kwh: x.kwh, cost: x.unit + x.sc }));
  const months = T.byMonth(actual.days);
  if (months.length > 1) {
    daily.body.append(h('details', { class: 'table-view' },
      h('summary', { text: 'Show monthly totals' }),
      h('div', { class: 'table-scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { text: 'Month' }), h('th', { class: 'num', text: 'kWh' }), h('th', { class: 'num', text: lowerGood ? 'Cost' : 'Earned' }), h('th', { class: 'num', text: 'Per day' }))),
        h('tbody', {}, months.map((m) => h('tr', {},
          h('td', { text: m.label + (m.days < 28 ? ' (' + m.days + ' days)' : '') }),
          h('td', { class: 'num', text: m.kwh.toLocaleString('en-GB', { maximumFractionDigits: 0 }) }),
          h('td', { class: 'num', text: gbp(m.cost) }),
          h('td', { class: 'num', text: gbp(m.cost / m.days) }))))))));
  }
  const drawDaily = () => {
    const money = state.dailyMetric === 'cost';
    put(dailyTools, seg([{ v: 'kwh', label: 'kWh' }, { v: 'cost', label: '£' }], state.dailyMetric, (v) => { state.dailyMetric = v; drawDaily(); }, 'Measure'));
    columns(dailyBox, buckets.map((b) => ({
      v: money ? b.cost / 100 : b.kwh, cls: kind === 'export' ? 'b-export' : 's-usage',
      tipTitle: bucketTitle(b, weekly),
      tipRows: [{ value: kwhFmt(b.kwh), label: kind === 'export' ? 'exported' : 'used' }, { value: gbp(b.cost), label: lowerGood ? 'cost' : 'earned' }],
    })), { height: 240, fmtY: (v) => (money ? '£' + v : String(v)), xTicks: bucketTicks(buckets), label: (weekly ? 'Weekly ' : 'Daily ') + (money ? 'cost' : 'energy') });
  };

  /* time of day: an average day, or split by weekday */
  const share = (a, b) => (stats.slotTotal.slice(a, b).reduce((x, y) => x + y, 0) / (stats.total || 1)) * 100;
  const tod = card(kind === 'export' ? 'When you export' : 'When you use it', { sub: '' });
  const todTools = h('div', { class: 'card-tools' });
  tod.el.querySelector('.card-head').append(todTools);
  const todBox = h('div', { class: 'chart-box' });
  const todNote = kind === 'import'
    ? share(0, 14).toFixed(0) + '% falls overnight (00:00–07:00) and ' + share(32, 38).toFixed(0)
      + '% in the 16:00–19:00 peak. Shifting use out of the peak is what makes Agile, Go and Cosy pay off.'
    : kind === 'export'
      ? share(32, 38).toFixed(0) + '% of your export lands in the 16:00–19:00 peak, when Agile Outgoing and Flux pay the most.'
      : '';
  tod.body.append(todBox);
  if (todNote) tod.body.append(h('p', { class: 'fine', text: todNote }));
  const cls = kind === 'export' ? 'b-export' : 's-usage';
  const drawTod = () => {
    put(todTools, seg([{ v: 'day', label: 'Average day' }, { v: 'week', label: 'By weekday' }], state.todMode, (v) => { state.todMode = v; drawTod(); }, 'View'));
    if (state.todMode === 'week') {
      tod.setSub('Average kWh in each hour, for each day of the week');
      put(todBox, heat(stats.grid, { cls, rowLabels: T.DOW_NAMES, unit: 'kWh', fmt: (v) => v.toFixed(2), label: 'Average energy by weekday and hour' }));
      return;
    }
    tod.setSub('Average kWh in each half hour of the day');
    columns(todBox, stats.slotAvg.map((v, s) => ({
      v, cls, tipTitle: T.slotLabel(s) + '–' + T.slotLabel((s + 1) % 48), tipRows: [{ value: v.toFixed(2) + ' kWh', label: 'average' }],
    })), { height: 220, fmtY: (v) => String(v), xTicks: [0, 12, 24, 36].map((i) => ({ i, edge: true, label: T.slotLabel(i) })), label: 'Average energy by time of day' });
  };

  /* what you paid per kWh, split by price band */
  let bandCard = null;
  const used = Object.entries(bands).filter(([, v]) => v > 0.005 * (actual.kwh || 1));
  if (kind === 'import' && used.length > 1) {
    const c = card('What you paid for it', { sub: 'Your kWh split by how the price compared with Flexible (' + p1(ref) + ')' });
    const below = bands.plunge + bands.cheap + bands.fair;
    c.body.append(
      segbar(Object.entries(bands).map(([b, v]) => ({ label: T.BANDS[b], value: v, cls: 'b-' + b, text: kwhFmt(v) })), { label: 'Share of your usage in each price band' }),
      h('p', { class: 'fine', text: ((below / (actual.kwh || 1)) * 100).toFixed(0) + '% of what you used was bought at or below the Flexible rate.' }));
    bandCard = c.el;
  }

  /* ranking */
  const rank = card(kind === 'export' ? 'What each export tariff would have paid' : 'What each tariff would have cost', { sub: kwhFmt(actual.kwh) + ' · ' + rangeText(cons) });
  rank.body.append(...ranking({ rows: dropOwn(rows, actual), base: youRow(actual), kind }),
    h('p', { class: 'fine', text: (kind === 'gas' ? 'Tracker is priced at the real rate for every day. Other tariffs use today’s prices. All prices include VAT.'
      : kind === 'export' ? 'Agile Outgoing is priced at the real rate for every half hour. Other export tariffs use today’s prices.' : BASIS)
      + (actual.note ? ' ' + actual.note : '')
      + (actual.missing > 0.02 * actual.kwh ? ' Some of your readings fall where no rate is published, so your own total is incomplete.' : '')
      + (kind === 'gas' && !state.demo && state.gasUnit === 'm3' ? ' Gas converted from m³ at ' + GAS_M3_TO_KWH.toFixed(2) + ' kWh per m³.' : '') }));

  queueMicrotask(() => { drawDaily(); drawTod(); });
  return [tiles, highlights(kind, d), daily.el, tod.el, bandCard, rank.el];
}
