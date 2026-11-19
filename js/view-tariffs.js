// "Tariffs": every Octopus product from the live API, one card each.

import * as T from './tariffs.js';
import { h, put, strip } from './charts.js';
import { state, tf, flexRef, profileToday, famById, tag, p2, gbp, loading } from './core.js';

const CAT_LABEL = Object.fromEntries(T.CATEGORIES.map((c) => [c.id, c.label]));

function matches(p, filter) {
  if (filter === 'all') return true;
  if (filter === 'gas') return !!tf(p).g;
  return p.cat === filter;
}

function rateCells(profile, ref, isExport) {
  const max = Math.max(...profile.filter(Number.isFinite), 0.01);
  return profile.map((v, s) => {
    const title = T.slotLabel(s) + '–' + T.slotLabel((s + 1) % 48);
    if (!Number.isFinite(v)) return { cls: 'b-none', title, rows: [{ value: '–', label: 'not published yet' }] };
    if (isExport) return { cls: 'b-export', opacity: 0.25 + 0.75 * (v / max), title, rows: [{ value: p2(v), label: 'paid per kWh' }] };
    const band = T.bandOf(v, ref);
    return { cls: 'b-' + band, title, rows: [{ value: p2(v), label: T.BANDS[band], cls: 'key-box b-' + band }] };
  });
}

function fact(label, value) {
  return h('div', {}, h('dt', { text: label }), h('dd', { text: value }));
}

function tariffCard(p, ref) {
  const t = tf(p);
  const fam = famById(p.family) || {};
  const isExport = p.dir === 'EXPORT';
  const main = t.e1 || t.e4 || t.e2;
  const rateEl = h('div', { class: 'rate-slot' }, main ? loading('') : null);
  const facts = h('dl', { class: 'facts' });
  if (main && !isExport) facts.append(fact('Standing charge', p2(main.sc) + '/day'));
  if (t.e2 && (t.e1 || t.e4)) facts.append(fact('Economy 7', p2(t.e2.day) + ' day · ' + p2(t.e2.night) + ' night'));
  if (t.g) facts.append(fact('Gas', (fam.dyn ? 'priced daily' : p2(t.g.rate) + '/kWh') + ' · ' + p2(t.g.sc) + '/day'));
  if (p.term) facts.append(fact('Term', p.term + ' months'));
  const exit = main ? main.exit : t.g ? t.g.exit : 0;
  if (!isExport || exit) facts.append(fact('Exit fee', exit ? gbp(exit, { round: true }) + (t.g && main ? ' per fuel' : '') : 'None'));

  const el = h('article', { class: 'card tariff' },
    h('header', {},
      h('h3', { text: p.label }),
      h('div', { class: 'tags' },
        tag(CAT_LABEL[p.cat] || 'Other', 'cat'),
        p.variable ? null : tag('Fixed'),
        fam.needs ? tag('Needs: ' + fam.needs) : null,
        p.restricted ? tag('Restricted') : null)),
    rateEl,
    facts,
    p.desc && p.desc.trim() !== p.full ? h('p', { class: 'desc', text: p.desc.trim() }) : null,
    h('code', { class: 'code', text: (main || t.g || {}).code || p.code }));

  if (!main) {
    put(rateEl, h('p', { class: 'muted', text: t.g ? 'Gas only in this region.' : 'Not offered in this region.' }));
    return el;
  }
  (async () => {
    let prof = null;
    try { prof = await profileToday(p); } catch { /* shown as unavailable below */ }
    if (!prof && t.e2) {
      put(rateEl, h('div', { class: 'rate-line' }, h('span', { class: 'big-num', text: t.e2.day.toFixed(2) }), h('span', { class: 'unit', text: 'p day · ' + t.e2.night.toFixed(2) + 'p night' })));
      return;
    }
    if (!prof) { put(rateEl, h('p', { class: 'muted', text: 'Rates unavailable right now.' })); return; }
    const vals = prof.profile.filter(Number.isFinite);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const flat = hi - lo < 0.005;
    const now = prof.profile[T.slotOf(Date.now())];
    const unit = isExport ? 'p/kWh paid' : 'p/kWh';
    put(rateEl, h('div', { class: 'rate-line' },
        h('span', { class: 'big-num', text: flat ? lo.toFixed(2) : lo.toFixed(2) + ' – ' + hi.toFixed(2) }),
        h('span', { class: 'unit', text: unit })),
      flat ? (fam.dyn ? h('div', { class: 'rate-now', text: 'Today’s price · changes daily' }) : null)
        : h('div', { class: 'rate-now', text: 'Now ' + p2(now) + (fam.dyn ? ' · changes every half hour' : '') }),
      flat ? null : strip(rateCells(prof.profile, ref, isExport)),
      prof.assumed ? h('p', { class: 'fine', text: 'Off-peak shown as 23:30–05:30. Octopus publishes the two rates but not the times.' }) : null);
  })();
  return el;
}

export function viewTariffs(root) {
  const ref = flexRef();
  const products = state.cat.products.slice().sort((a, b) => {
    const order = ['smart', 'ev', 'heat', 'solar', 'standard', 'export', 'prepay', 'other'];
    return (order.indexOf(a.cat) - order.indexOf(b.cat)) || (b.variable - a.variable) || a.label.localeCompare(b.label);
  });
  const list = h('div', { class: 'grid cards' });
  const count = h('p', { class: 'card-sub' });
  const chips = h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter tariffs' });

  const draw = () => {
    const shown = products.filter((p) => matches(p, state.filter));
    put(chips, ...T.CATEGORIES
      .filter((c) => c.id === 'all' || products.some((p) => matches(p, c.id)))
      .map((c) => h('button', {
        type: 'button', class: 'pill' + (c.id === state.filter ? ' on' : ''), 'aria-pressed': String(c.id === state.filter),
        onclick: () => { state.filter = c.id; draw(); }, text: c.label,
      })));
    count.textContent = shown.length + ' of ' + products.length + ' Octopus tariffs · prices for ' + T.REGIONS[state.region] + ', including VAT';
    put(list, ...shown.map((p) => tariffCard(p, ref)));
  };

  root.append(
    h('div', { class: 'page-head' },
      h('h1', { text: 'Every Octopus tariff' }),
      count),
    chips, list,
    h('p', { class: 'fine', text: 'Read live from the Octopus Energy API, so new tariffs appear here as soon as Octopus publishes them. '
      + 'The coloured strip shows the unit rate across the day against Flexible Octopus (' + p2(ref) + ').' }));
  draw();
  return Promise.resolve();
}
