// Shared state, catalogue loading, pricing helpers and small UI builders used by every view.

import * as api from './api.js';
import * as T from './tariffs.js';
import { h, put } from './charts.js';

/* ---------- storage ---------- */

export const store = {
  get(k, fallback) {
    try {
      const v = localStorage.getItem('ox.' + k);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(k, v) { try { localStorage.setItem('ox.' + k, JSON.stringify(v)); } catch { /* optional */ } },
  del(k) { try { localStorage.removeItem('ox.' + k); } catch { /* optional */ } },
};

// The old page labelled five regions with the wrong letter. People chose by name, so honour the name.
const OLD_REGION_FIX = { K: 'N', L: 'P', M: 'K', N: 'L', P: 'M' };

function initialRegion() {
  const saved = store.get('region');
  if (saved && T.REGIONS[saved]) return saved;
  let old = null;
  try { old = localStorage.getItem('selectedRegion'); localStorage.removeItem('selectedRegion'); } catch { /* ignore */ }
  const r = old ? (OLD_REGION_FIX[old] || old) : 'C';
  return T.REGIONS[r] ? r : 'C';
}

// Filled in by app.js: render(), go(view), connect(key, account, remember), sample(), disconnect().
export const hooks = {};

// What the visitor has customised. Unknown sections are dropped and new ones appended, so old saves keep working.
export const NOW_SECTIONS = [
  { id: 'mine', label: 'Your latest day', note: 'Shown once an account is connected' },
  { id: 'chart', label: 'Agile half-hourly prices' },
  { id: 'windows', label: 'Cheapest times to run things', half: true },
  { id: 'rates', label: 'Unit rate right now', half: true },
  { id: 'tracker', label: 'Tracker' },
  { id: 'grid', label: 'The grid right now' },
];
export const START_PAGES = [{ v: 'now', label: 'Now' }, { v: 'tariffs', label: 'Tariffs' }, { v: 'compare', label: 'Compare' }, { v: 'usage', label: 'My usage' }];

function loadPrefs() {
  const saved = store.get('prefs', {}) || {};
  const known = NOW_SECTIONS.map((s) => s.id);
  const order = (Array.isArray(saved.order) ? saved.order : []).filter((id) => known.includes(id));
  for (const id of known) if (!order.includes(id)) order.push(id);
  return {
    start: START_PAGES.some((p) => p.v === saved.start) ? saved.start : 'now',
    headline: typeof saved.headline === 'string' ? saved.headline : 'agile',
    order,
    hidden: (Array.isArray(saved.hidden) ? saved.hidden : []).filter((id) => known.includes(id)),
  };
}
export const savePrefs = () => store.set('prefs', state.prefs);

export const state = {
  prefs: loadPrefs(),
  region: initialRegion(),
  creds: null, // { key, account } while connected; never written anywhere but this browser
  connecting: null,
  view: 'now',
  cat: null,
  acct: null, // parsed account, or the sample household
  demo: false,
  period: store.get('period', 30),
  source: 'estimate',
  est: store.get('est', { annual: 2700, ev: 0 }),
  agileView: 'upcoming',
  agileDir: 'import',
  filter: 'all',
  chartOn: new Set(store.get('chartOn', ['flexible', 'agile', 'tracker', 'go', 'cosy'])),
  usageKind: 'overview',
  todMode: 'day',
  dailyMetric: 'kwh',
  gasUnit: store.get('gasUnit', 'm3'),
};

/* ---------- formatting ---------- */

export const p2 = (v) => (Number.isFinite(v) ? v.toFixed(2) + 'p' : '–');
export const p1 = (v) => (Number.isFinite(v) ? v.toFixed(1) + 'p' : '–');

export function gbp(pence, { round = false } = {}) {
  if (!Number.isFinite(pence)) return '–';
  const v = Math.abs(pence) / 100;
  const whole = round || v >= 1000;
  return (pence < 0 ? '−' : '') + '£' + v.toLocaleString('en-GB', {
    minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
  });
}

export const kwhFmt = (v) => v.toLocaleString('en-GB', { maximumFractionDigits: v < 100 ? 1 : 0 }) + ' kWh';
export const constant = (v) => ({ at: () => v });
export const famById = (id) => T.FAMILIES.find((f) => f.id === id);

/* ---------- catalogue ---------- */

export const tf = (p) => (p && p.tariffs[state.region]) || {};

let catPromise = null;

/** Load every Octopus product (plus Tracker, which is unlisted) and slim it down. Cached for six hours. */
export function ensureCatalog() {
  if (state.cat) return Promise.resolve(state.cat);
  if (catPromise) return catPromise;
  catPromise = (async () => {
    const cached = store.get('cat');
    if (cached && cached.e > Date.now() && cached.v === 2) return finish(cached.d);
    const list = await api.productList();
    const mine = list.results.filter((p) => p.brand === 'OCTOPUS_ENERGY' && !p.is_business);
    const details = await api.pool(mine, async (p) => T.slimProduct({ ...(await api.productDetail(p.code)), direction: p.direction }));
    const products = details.filter(Boolean);
    for (const v of T.TRACKER_VERSIONS) {
      try {
        products.push(T.slimProduct({ ...(await api.productDetail(v.code)), direction: 'IMPORT' }));
        break;
      } catch { /* that version has been withdrawn: try the one before */ }
    }
    if (!products.length) throw new Error('Octopus returned no products.');
    store.set('cat', { v: 2, e: Date.now() + 6 * 3600000, d: products });
    return finish(products);
  })();
  catPromise.catch(() => { catPromise = null; });
  return catPromise;
}

function finish(products) {
  const seen = {};
  for (const p of products) seen[p.name] = (seen[p.name] || 0) + 1;
  for (const p of products) p.label = seen[p.name] > 1 ? p.full : p.name;
  state.cat = { products };
  return state.cat;
}

export const primary = (familyId) => T.primaryOf(state.cat.products, familyId);

/** Flexible Octopus unit rate for the region: the yardstick every price band is measured against. */
export function flexRef(fuel = 'E') {
  const t = tf(primary('flexible'));
  if (fuel === 'G') return t.g ? t.g.rate : NaN;
  return t.e1 ? t.e1.rate : 27;
}

const profCache = new Map();

/** Today's 48 half-hourly unit rates for a product in the current region, or null if it has none here. */
export function profileToday(p) {
  const ck = p.code + '|' + state.region + '|' + T.dayKey(Date.now());
  if (profCache.has(ck)) return profCache.get(ck);
  const job = (async () => {
    const t = tf(p);
    const mid = T.londonMidnight(Date.now());
    if (t.e1) {
      const dyn = famById(p.family) && famById(p.family).dyn;
      const ttl = dyn ? 600000 : Math.max(60000, T.addDays(mid, 1) - Date.now());
      const lk = await api.unitRates(t.e1.code, mid, T.addDays(mid, 1), { ttl, persist: true });
      const profile = T.dayProfile(lk, mid);
      if (profile.some(Number.isFinite)) return { profile, sc: t.e1.sc, code: t.e1.code };
    }
    if (t.e4) {
      const fam = famById(p.family);
      const win = (fam && fam.night) || [47, 11];
      const profile = Array.from({ length: 48 }, (_, s) => (T.inWindow(s, win) ? t.e4.night : t.e4.day));
      return { profile, sc: t.e4.sc, code: t.e4.code, assumed: true };
    }
    return null;
  })();
  profCache.set(ck, job);
  job.catch(() => profCache.delete(ck));
  return job;
}

/** Stitch Tracker versions together so a long period is priced on whichever version was on sale each day. */
async function trackerChain(fuel, kind, from, to) {
  const out = [];
  const vs = T.TRACKER_VERSIONS;
  for (let i = 0; i < vs.length; i++) {
    const vFrom = i === vs.length - 1 ? -Infinity : Date.parse(vs[i].from + 'T00:00:00Z');
    const vTo = i === 0 ? Infinity : Date.parse(vs[i - 1].from + 'T00:00:00Z');
    const a = Math.max(from, vFrom), b = Math.min(to, vTo);
    if (a >= b) continue;
    const code = fuel + '-1R-' + vs[i].code + '-' + state.region;
    const lk = kind === 'standing-charges'
      ? await api.standingCharges(code, a, b, { ttl: 3600000 })
      : await api.unitRates(code, a, b, { ttl: 3600000 });
    for (const iv of lk.intervals || []) {
      const f = Math.max(iv.f, a), t = Math.min(iv.t, b);
      if (f < t) out.push({ f, t, v: iv.v });
    }
  }
  out.sort((x, y) => x.f - y.f);
  return T.intervalLookup(out);
}

export function candidates(kind) {
  const ps = state.cat.products;
  if (kind === 'gas') return ps.filter((p) => p.dir === 'IMPORT' && !p.prepay && p.family !== 'zero' && tf(p).g);
  if (kind === 'export') return ps.filter((p) => p.dir === 'EXPORT' && tf(p).e1 && !['zero', 'powerpack'].includes(p.family));
  return ps.filter((p) => p.dir === 'IMPORT' && !p.prepay && p.family !== 'zero' && (tf(p).e1 || tf(p).e4));
}

/**
 * Price a consumption series on one product.
 * Agile and Tracker use the real rate for every half hour; everything else uses today's prices.
 */
export async function priceProduct(p, kind, cons) {
  const from = cons[0].s, to = cons[cons.length - 1].s + T.HALF;
  const t = tf(p);
  const fam = famById(p.family) || {};
  let rate, sc, note = '';
  if (p.family === 'tracker') {
    const fuel = kind === 'gas' ? 'G' : 'E';
    [rate, sc] = await Promise.all([trackerChain(fuel, 'standard-unit-rates', from, to), trackerChain(fuel, 'standing-charges', from, to)]);
  } else if (kind === 'gas') {
    rate = constant(t.g.rate);
    sc = constant(t.g.sc);
  } else if (fam.dyn) {
    [rate, sc] = await Promise.all([
      api.unitRates(t.e1.code, from, to, { ttl: 3600000 }),
      api.standingCharges(t.e1.code, from, to, { ttl: 3600000 }),
    ]);
  } else {
    const prof = await profileToday(p);
    if (!prof) return null;
    rate = T.profileLookup(prof.profile);
    sc = constant(prof.sc);
    if (prof.assumed) note = 'Counts 23:30–05:30 as off-peak. Extra smart-charging slots are not included.';
  }
  const c = T.cost(cons, rate, kind === 'export' ? null : sc);
  return { p, label: p.label, needs: fam.needs || '', note, dyn: !!fam.dyn || p.family === 'tracker', ...c };
}

/** What the account actually paid: each half hour priced on whichever agreement was live at the time. */
export async function actualCost(cons, agreements, kind, each) {
  const from = cons[0].s, to = cons[cons.length - 1].s + T.HALF;
  const merged = { unit: 0, standing: 0, total: 0, kwh: 0, missing: 0, days: [], codes: [], note: '' };
  const byDay = new Map();
  let covered = 0;
  for (const a of agreements) {
    const aFrom = Date.parse(a.valid_from), aTo = a.valid_to ? Date.parse(a.valid_to) : Infinity;
    const sub = cons.filter((c) => c.s >= aFrom && c.s < aTo);
    if (!sub.length) continue;
    covered += sub.length;
    let c;
    try {
      const lo = Math.max(from, aFrom), hi = Math.min(to, aTo);
      const [rate, sc] = await Promise.all([
        api.unitRates(a.tariff_code, lo, hi, { ttl: 3600000 }),
        api.standingCharges(a.tariff_code, lo, hi, { ttl: 3600000 }),
      ]);
      if (rate.assumedWindow) merged.note = 'Your tariff publishes day and night rates without times, so the night window is assumed.';
      c = T.cost(sub, rate, kind === 'export' ? null : sc, each);
    } catch {
      c = T.cost(sub, T.intervalLookup([]), null);
    }
    merged.codes.push(a.tariff_code);
    for (const k of ['unit', 'standing', 'total', 'kwh', 'missing']) merged[k] += c[k];
    for (const d of c.days) {
      const e = byDay.get(d.key);
      if (e) { e.kwh += d.kwh; e.unit += d.unit; e.sc = Math.max(e.sc, d.sc); } else byDay.set(d.key, { ...d });
    }
  }
  if (covered < cons.length) {
    const rest = T.cost(cons.filter((c) => !agreements.some((a) => c.s >= Date.parse(a.valid_from) && c.s < (a.valid_to ? Date.parse(a.valid_to) : Infinity))), T.intervalLookup([]), null);
    merged.kwh += rest.kwh;
    merged.missing += rest.kwh;
    for (const d of rest.days) if (!byDay.has(d.key)) byDay.set(d.key, { ...d });
  }
  merged.days = [...byDay.values()].sort((a, b) => a.ts - b.ts);
  return merged;
}

/** Friendly name for a tariff code, including products that are no longer on sale. */
export function productName(tariffCode) {
  const t = T.parseTariffCode(tariffCode);
  if (!t) return tariffCode;
  const p = state.cat.products.find((x) => x.code === t.product);
  return p ? p.label : T.familyOf(t.product).short + ' (' + t.product + ')';
}

/* ---------- account ---------- */

export function currentAgreement(agreements, now = Date.now()) {
  return agreements.find((a) => Date.parse(a.valid_from) <= now && (!a.valid_to || Date.parse(a.valid_to) > now))
    || agreements[agreements.length - 1] || null;
}

/** Reduce the account response to one import meter, one export meter and one gas meter. */
export function parseAccount(json) {
  const props = json.properties || [];
  const prop = props.filter((p) => !p.moved_out_at).pop() || props[props.length - 1];
  if (!prop) throw new Error('That account has no properties on it.');
  const shape = (mp, idKey) => ({
    point: mp[idKey],
    serials: (mp.meters || []).map((m) => m.serial_number).filter(Boolean),
    agreements: (mp.agreements || []).slice().sort((a, b) => Date.parse(a.valid_from) - Date.parse(b.valid_from)),
  });
  const live = (m) => m.serials.length && m.agreements.length;
  const best = (list) => list.filter(live).sort((a, b) => {
    const ax = currentAgreement(a.agreements), bx = currentAgreement(b.agreements);
    return (bx && !bx.valid_to ? 1 : 0) - (ax && !ax.valid_to ? 1 : 0);
  })[0] || null;
  const elec = prop.electricity_meter_points || [];
  const acct = {
    number: json.number,
    import: best(elec.filter((m) => !m.is_export).map((m) => shape(m, 'mpan'))),
    export: best(elec.filter((m) => m.is_export).map((m) => shape(m, 'mpan'))),
    gas: best((prop.gas_meter_points || []).map((m) => shape(m, 'mprn'))),
  };
  if (!acct.import && !acct.export && !acct.gas) throw new Error('No meters with a tariff were found on that account.');
  return acct;
}

export function sampleAccount() {
  const since = new Date(Date.now() - 800 * T.DAY).toISOString();
  const ag = (code) => [{ tariff_code: code, valid_from: since, valid_to: null }];
  const agile = tf(primary('agile')), flex = tf(primary('flexible')), out = tf(primary('outgoing'));
  return {
    number: 'Sample household',
    import: agile.e1 ? { point: 'sample', serials: ['sample'], agreements: ag(agile.e1.code) } : null,
    export: out.e1 ? { point: 'sample', serials: ['sample'], agreements: ag(out.e1.code) } : null,
    gas: flex.g ? { point: 'sample', serials: ['sample'], agreements: ag(flex.g.code) } : null,
  };
}

// m3 -> kWh: volume correction 1.02264 x calorific value 39.4 MJ/m3 / 3.6
export const GAS_M3_TO_KWH = (1.02264 * 39.4) / 3.6;

const usageCache = new Map();
export const clearUsage = () => usageCache.clear();

/** Half-hourly readings for the last `days` days for one of the account's meters. */
export function loadUsage(kind, days, key) {
  const ck = kind + '|' + days + '|' + (state.demo ? 'demo' : state.acct.number);
  if (usageCache.has(ck)) return usageCache.get(ck);
  const job = (async () => {
    const meter = state.acct[kind];
    const now = Date.now();
    const from = T.addDays(now, -days);
    if (state.demo) return T.sampleUsage({ days: 366, now, fuel: kind === 'gas' ? 'G' : kind === 'export' ? 'X' : 'E' }).filter((c) => c.s >= from);
    const sets = await Promise.all(meter.serials.map((s) =>
      api.consumption(kind === 'gas' ? 'G' : 'E', meter.point, s, from, now, key).catch((e) => { if (e.status === 401) throw e; return []; })));
    const byStart = new Map();
    for (const set of sets) for (const c of set) if (!byStart.has(c.s) || c.kwh > byStart.get(c.s).kwh) byStart.set(c.s, c);
    return [...byStart.values()].sort((a, b) => a.s - b.s);
  })();
  usageCache.set(ck, job);
  job.catch(() => usageCache.delete(ck));
  return job;
}

/* ---------- UI builders ---------- */

export function card(title, { sub, tools, cls } = {}) {
  const body = h('div', { class: 'card-body' });
  const subEl = h('p', { class: 'card-sub', text: sub || '' });
  const el = h('section', { class: 'card ' + (cls || '') },
    title ? h('header', { class: 'card-head' },
      h('div', {}, h('h2', { text: title }), subEl),
      tools ? h('div', { class: 'card-tools' }, tools) : null) : null,
    body);
  return { el, body, setSub: (t) => { subEl.textContent = t; } };
}

export const loading = (text = 'Loading…') => h('div', { class: 'loading' }, h('span', { class: 'spin' }), text);

export function errorBox(err, retry) {
  return h('div', { class: 'error', role: 'alert' },
    h('strong', { text: 'Something went wrong. ' }),
    h('span', { text: (err && err.message) || String(err) }),
    retry ? h('button', { class: 'btn small', onclick: retry, text: 'Retry' }) : null);
}

/** Fill `body` from an async builder, showing a spinner first and an error box on failure. */
export async function fill(body, alive, build) {
  put(body, loading());
  try {
    const nodes = await build();
    if (alive()) put(body, ...[].concat(nodes).filter(Boolean));
  } catch (e) {
    console.error(e);
    if (alive()) put(body, errorBox(e, () => fill(body, alive, build)));
  }
}

/** Segmented control. options: [{ v, label, disabled }] */
export function seg(options, current, onChange, label) {
  return h('div', { class: 'seg', role: 'group', 'aria-label': label || null },
    options.map((o) => h('button', {
      type: 'button', class: o.v === current ? 'on' : '', 'aria-pressed': String(o.v === current),
      disabled: o.disabled, onclick: () => { if (o.v !== current) onChange(o.v); }, text: o.label,
    })));
}

export const tag = (text, cls = '') => h('span', { class: 'tag ' + cls, text });

export function bandChip(band) {
  return h('span', { class: 'chip' }, h('i', { class: 'swatch b-' + band }), T.BANDS[band]);
}

export function tile(label, value, sub, cls = '') {
  return h('div', { class: 'tile ' + cls },
    h('div', { class: 'tile-label', text: label }),
    h('div', { class: 'tile-value', text: value }),
    sub ? h('div', { class: 'tile-sub' }, sub) : null);
}

/** A signed difference with an arrow, so direction never relies on colour alone. `goodWhenLower` flips for export. */
export function delta(pence, goodWhenLower = true, round = false) {
  if (!Number.isFinite(pence) || Math.abs(pence) < (round ? 50 : 0.5)) return h('span', { class: 'delta flat', text: 'same' });
  const good = goodWhenLower ? pence < 0 : pence > 0;
  return h('span', { class: 'delta ' + (good ? 'good' : 'bad') }, (pence < 0 ? '▼ ' : '▲ ') + gbp(Math.abs(pence), { round: round || Math.abs(pence) >= 10000 }));
}
