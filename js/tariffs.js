// Pure tariff logic: London time, product classification, rate lookups and costing.
// No DOM and no network in here, so it can be exercised from Node.

export const REGIONS = {
  A: 'Eastern England', B: 'East Midlands', C: 'London', D: 'Merseyside & North Wales',
  E: 'West Midlands', F: 'North East England', G: 'North West England', H: 'Southern England',
  J: 'South East England', K: 'South Wales', L: 'South West England', M: 'Yorkshire',
  N: 'Southern Scotland', P: 'Northern Scotland',
};

// Tracker is not in Octopus's public product list, so its versions are listed here, newest first.
// `from` is the first day that version was sold; older versions fill in earlier history.
export const TRACKER_VERSIONS = [
  { code: 'SILVER-26-04-01', from: '2026-04-01' },
  { code: 'SILVER-25-09-02', from: '2025-09-02' },
  { code: 'SILVER-25-04-15', from: '2025-04-15' },
  { code: 'SILVER-24-12-31', from: '2024-12-31' },
  { code: 'SILVER-24-10-01', from: '2024-10-01' },
];

/* ---------- London time ---------- */

const HOUR = 3600000;
export const HALF = 1800000;
export const DAY = 86400000;
const dstCache = {};

function lastSunday1am(year, month) {
  const d = new Date(Date.UTC(year, month + 1, 0, 1));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.getTime();
}

/** Milliseconds London is ahead of UTC at instant `ts` (BST = last Sunday of March to last Sunday of October). */
export function londonOffset(ts) {
  const y = new Date(ts).getUTCFullYear();
  const c = dstCache[y] || (dstCache[y] = [lastSunday1am(y, 2), lastSunday1am(y, 9)]);
  return ts >= c[0] && ts < c[1] ? HOUR : 0;
}

const shifted = (ts) => new Date(ts + londonOffset(ts));

/** Half-hour slot of the London day, 0 (00:00) to 47 (23:30). */
export function slotOf(ts) {
  const d = shifted(ts);
  return d.getUTCHours() * 2 + (d.getUTCMinutes() >= 30 ? 1 : 0);
}

/** London calendar date as YYYY-MM-DD. */
export function dayKey(ts) {
  return shifted(ts).toISOString().slice(0, 10);
}

/** UTC instant of London midnight at the start of the day containing `ts`. */
export function londonMidnight(ts) {
  const d = shifted(ts);
  const k = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return k - londonOffset(k);
}

/** London midnight `n` calendar days after the day containing `ts` (handles 23/25-hour days). */
export function addDays(ts, n) {
  return londonMidnight(londonMidnight(ts) + n * DAY + 2 * HOUR);
}

export function fmtTime(ts) {
  return shifted(ts).toISOString().slice(11, 16);
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(ts, { dow = false, year = false } = {}) {
  const d = shifted(ts);
  return (dow ? DOW[d.getUTCDay()] + ' ' : '') + d.getUTCDate() + ' ' + MON[d.getUTCMonth()]
    + (year ? ' ' + d.getUTCFullYear() : '');
}

export const slotLabel = (slot) =>
  String(Math.floor(slot / 2)).padStart(2, '0') + ':' + (slot % 2 ? '30' : '00');

/* ---------- product classification ---------- */

// `needs` is shown wherever the tariff is compared, because most smart tariffs have an entry requirement.
export const FAMILIES = [
  { id: 'agile', re: /^AGILE-(?!OUTGOING)/, short: 'Agile', cat: 'smart', dyn: true, needs: 'Smart meter' },
  { id: 'tracker', re: /^SILVER-/, short: 'Tracker', cat: 'smart', dyn: true, needs: 'Smart meter' },
  { id: 'flexible', re: /^VAR-/, short: 'Flexible', cat: 'standard' },
  { id: 'fixed', re: /^OE-(FIX|LOYAL)/, short: 'Fixed', cat: 'standard' },
  { id: 'igo', re: /^(IOG-|INTELLI-(VAR|BB))/, short: 'Intelligent Go', cat: 'ev', needs: 'Compatible EV or charger', night: [47, 11] },
  { id: 'go', re: /^GO-/, short: 'Go', cat: 'ev', needs: 'EV' },
  { id: 'cosy', re: /^COSY-/, short: 'Cosy', cat: 'heat', needs: 'Heat pump' },
  { id: 'snug', re: /^SNUG-/, short: 'Snug', cat: 'heat', needs: 'Storage heaters' },
  { id: 'iflux', re: /^INTELLI-FLUX/, short: 'Intelligent Flux', cat: 'solar', needs: 'Solar and compatible battery' },
  { id: 'flux', re: /^FLUX-/, short: 'Flux', cat: 'solar', needs: 'Solar and battery' },
  { id: 'zero', re: /^ZERO-/, short: 'Zero Bills', cat: 'other', needs: 'Zero Bills home' },
  { id: 'prepay', re: /PREPAY/, short: 'Pay as you go', cat: 'prepay' },
  { id: 'agileout', re: /^AGILE-OUTGOING/, short: 'Agile Outgoing', cat: 'export', dyn: true },
  { id: 'powerpack', re: /^POWER-PACK/, short: 'Power Pack', cat: 'export', needs: 'V2G charger' },
  { id: 'outgoing', re: /^OUTGOING-/, short: 'Outgoing', cat: 'export' },
];

export const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'smart', label: 'Smart' },
  { id: 'ev', label: 'EV' },
  { id: 'heat', label: 'Heating' },
  { id: 'solar', label: 'Solar & battery' },
  { id: 'standard', label: 'Standard & fixed' },
  { id: 'export', label: 'Export' },
  { id: 'gas', label: 'With gas' },
  { id: 'prepay', label: 'Pay as you go' },
  { id: 'other', label: 'Other' },
];

// The eight tariffs drawn on the day-shape chart, each with a fixed colour slot so a tariff never changes colour.
export const CHART_FAMILIES = ['flexible', 'agile', 'tracker', 'go', 'igo', 'cosy', 'flux', 'snug'];

export function familyOf(code, direction) {
  const f = FAMILIES.find((x) => x.re.test(code));
  if (f) return f;
  return direction === 'EXPORT'
    ? { id: 'export-other', short: 'Export', cat: 'export' }
    : { id: 'other', short: 'Other', cat: 'other' };
}

/** "E-1R-AGILE-24-10-01-C" -> { fuel:'E', reg:'1R', product:'AGILE-24-10-01', region:'C' } */
export function parseTariffCode(code) {
  const m = /^([EG])-(\dR)-(.+)-([A-P])$/.exec(code || '');
  return m ? { fuel: m[1], reg: m[2], product: m[3], region: m[4] } : null;
}

const PAYMENT_PREF = ['direct_debit_monthly', 'varying', 'direct_debit_quarterly', 'prepayment'];

function pickPayment(byMethod) {
  if (!byMethod) return null;
  for (const m of PAYMENT_PREF) if (byMethod[m]) return byMethod[m];
  return Object.values(byMethod)[0] || null;
}

/** Reduce a product detail response to the few fields the app uses, for every region. */
export function slimProduct(d) {
  const fam = familyOf(d.code, d.direction);
  const out = {
    code: d.code, name: d.display_name, full: d.full_name, desc: d.description || '',
    dir: d.direction || (fam.cat === 'export' ? 'EXPORT' : 'IMPORT'),
    variable: !!d.is_variable, green: !!d.is_green, prepay: !!d.is_prepay, restricted: !!d.is_restricted,
    term: d.term || null, family: fam.id, cat: fam.cat, tariffs: {},
  };
  const grab = (key, slot, fields) => {
    const src = d[key];
    if (!src || Array.isArray(src)) return;
    for (const r of Object.keys(src)) {
      const t = pickPayment(src[r]);
      if (!t) continue;
      const o = { code: t.code, sc: t.standing_charge_inc_vat, exit: t.exit_fees_inc_vat || 0 };
      for (const [k, f] of Object.entries(fields)) o[k] = t[f];
      (out.tariffs[r.replace('_', '')] ||= {})[slot] = o;
    }
  };
  grab('single_register_electricity_tariffs', 'e1', { rate: 'standard_unit_rate_inc_vat' });
  grab('dual_register_electricity_tariffs', 'e2', { day: 'day_unit_rate_inc_vat', night: 'night_unit_rate_inc_vat' });
  grab('four_rate_ev_electricity_tariffs', 'e4', { day: 'day_unit_rate_inc_vat', night: 'night_unit_rate_inc_vat' });
  grab('single_register_gas_tariffs', 'g', { rate: 'standard_unit_rate_inc_vat' });
  return out;
}

/** Pick the product that best represents a family: the open-ended variable version, shortest term and name, newest. */
export function primaryOf(products, familyId) {
  const list = products.filter((p) => p.family === familyId);
  list.sort((a, b) => (b.variable - a.variable) || ((a.term || 0) - (b.term || 0)) || (a.name.length - b.name.length) || (a.code < b.code ? 1 : -1));
  return list[0] || null;
}

/* ---------- rate lookups ---------- */

/** Unit-rate API rows -> sorted [{f,t,v}] in ms / pence inc VAT, keeping direct-debit prices. */
export function toIntervals(rows) {
  const out = [];
  for (const r of rows) {
    if (r.payment_method && r.payment_method !== 'DIRECT_DEBIT') continue;
    out.push({ f: Date.parse(r.valid_from), t: r.valid_to ? Date.parse(r.valid_to) : Infinity, v: r.value_inc_vat });
  }
  out.sort((a, b) => a.f - b.f);
  return out;
}

/** Lookup over sorted intervals: at(ts) -> pence, or NaN when no rate covers ts. */
export function intervalLookup(intervals) {
  const starts = intervals.map((i) => i.f);
  return {
    intervals,
    at(ts) {
      let lo = 0, hi = starts.length - 1, k = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid] <= ts) { k = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return k >= 0 && ts < intervals[k].t ? intervals[k].v : NaN;
    },
  };
}

/** True when `slot` is inside a night window [start, end) that may wrap past midnight. */
export function inWindow(slot, [start, end]) {
  return start <= end ? slot >= start && slot < end : slot >= start || slot < end;
}

/** Day/night tariffs publish two flat rates and no times, so the window is applied here. */
export function dayNightLookup(day, night, window) {
  return { at: (ts) => (inWindow(slotOf(ts), window) ? night.at(ts) : day.at(ts)) };
}

/** A fixed 48-slot day repeated forever (today's prices applied to any date). */
export function profileLookup(profile) {
  return { at: (ts) => profile[slotOf(ts)] };
}

/** Sample a lookup at each half hour of the London day starting at `midnight`. */
export function dayProfile(lookup, midnight) {
  const out = new Array(48).fill(NaN);
  const end = addDays(midnight, 1);
  for (let ts = midnight; ts < end; ts += HALF) {
    const s = slotOf(ts);
    if (Number.isNaN(out[s])) out[s] = lookup.at(ts);
  }
  return out;
}

/* ---------- costing ---------- */

/**
 * Price a consumption series.
 * cons: [{s, kwh}] with s = interval start (ms). rate/sc: lookups returning pence.
 * Returns pence totals plus a per-London-day breakdown; `missing` counts kWh with no published rate.
 * `each(reading, rate)` is called for every priced reading (used to split usage by price band).
 */
export function cost(cons, rate, sc, each) {
  const days = new Map();
  let unit = 0, kwh = 0, missing = 0;
  for (const c of cons) {
    const key = dayKey(c.s);
    let d = days.get(key);
    if (!d) { d = { key, ts: londonMidnight(c.s), kwh: 0, unit: 0, sc: 0 }; days.set(key, d); }
    const r = rate.at(c.s);
    d.kwh += c.kwh;
    kwh += c.kwh;
    if (Number.isNaN(r)) { missing += c.kwh; continue; }
    if (each) each(c, r);
    d.unit += c.kwh * r;
    unit += c.kwh * r;
  }
  let standing = 0;
  if (sc) {
    for (const d of days.values()) {
      const v = sc.at(d.ts + 12 * HOUR);
      d.sc = Number.isNaN(v) ? 0 : v;
      standing += d.sc;
    }
  }
  return { unit, standing, total: unit + standing, kwh, missing, days: [...days.values()].sort((a, b) => a.ts - b.ts) };
}

/** Cheapest run of `n` consecutive half hours in a list of {f, v}; null if the list is too short. */
export function cheapestWindow(slots, n) {
  if (slots.length < n) return null;
  let sum = 0, best = null;
  for (let i = 0; i < slots.length; i++) {
    sum += slots[i].v;
    if (i >= n) sum -= slots[i - n].v;
    if (i >= n - 1) {
      const start = i - n + 1;
      const contiguous = slots[i].f - slots[start].f === (n - 1) * HALF;
      if (contiguous && (!best || sum < best.sum - 1e-9)) best = { sum, from: slots[start].f, to: slots[i].f + HALF, avg: sum / n };
    }
  }
  return best;
}

/** Split [{f,t,v}] of any length into half-hour points, clipped to [from, to). */
export function toHalfHours(intervals, from, to) {
  const out = [];
  for (const i of intervals) {
    const a = Math.max(i.f, from), b = Math.min(i.t, to);
    for (let ts = Math.ceil(a / HALF) * HALF; ts < b; ts += HALF) out.push({ f: ts, v: i.v });
  }
  return out;
}

/* ---------- usage statistics ---------- */

const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : NaN);

/**
 * Facts about a half-hourly series, all in London time.
 * Day-level extremes only consider complete days (at least 46 of 48 readings), so a part-day never "wins".
 */
export function usageStats(cons) {
  const byDay = new Map();
  const slots = new Array(48).fill(0);
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0)); // [Mon..Sun][hour] total kWh
  let total = 0, peak = null;
  for (const c of cons) {
    const d = shifted(c.s);
    const key = d.toISOString().slice(0, 10);
    let day = byDay.get(key);
    if (!day) { day = { key, ts: londonMidnight(c.s), kwh: 0, n: 0, dow: (d.getUTCDay() + 6) % 7 }; byDay.set(key, day); }
    day.kwh += c.kwh;
    day.n++;
    total += c.kwh;
    slots[d.getUTCHours() * 2 + (d.getUTCMinutes() >= 30 ? 1 : 0)] += c.kwh;
    grid[day.dow][d.getUTCHours()] += c.kwh;
    if (!peak || c.kwh > peak.kwh) peak = c;
  }
  const days = [...byDay.values()].sort((a, b) => a.ts - b.ts);
  const full = days.filter((d) => d.n >= 46);
  const dowDays = new Array(7).fill(0);
  for (const d of days) dowDays[d.dow] += d.n / 48;
  const mean = (list) => (list.length ? list.reduce((a, d) => a + d.kwh, 0) / list.length : NaN);
  const sorted = cons.map((c) => c.kwh).sort((a, b) => a - b);
  return {
    total, days, fullDays: full.length,
    busiest: full.reduce((a, d) => (!a || d.kwh > a.kwh ? d : a), null),
    quietest: full.reduce((a, d) => (!a || d.kwh < a.kwh ? d : a), null),
    weekdayAvg: mean(full.filter((d) => d.dow < 5)),
    weekendAvg: mean(full.filter((d) => d.dow >= 5)),
    activeDays: full.filter((d) => d.kwh > 0.05).length,
    peak, // the single largest half hour
    baseKw: quantile(sorted, 0.1) * 2, // the level usage rarely drops below
    slotAvg: slots.map((v) => v / (days.reduce((a, d) => a + d.n, 0) / 48 || 1)),
    slotTotal: slots,
    grid: grid.map((row, i) => row.map((v) => (dowDays[i] ? v / dowDays[i] : 0))), // average kWh in that hour
  };
}

/** Month-by-month totals from a per-day breakdown ([{ts, kwh, unit, sc}]). */
export function byMonth(days) {
  const out = new Map();
  for (const d of days) {
    const k = dayKey(d.ts + 12 * HOUR).slice(0, 7);
    let m = out.get(k);
    if (!m) { m = { key: k, label: MON[Number(k.slice(5)) - 1] + ' ' + k.slice(0, 4), kwh: 0, cost: 0, days: 0 }; out.set(k, m); }
    m.kwh += d.kwh;
    m.cost += (d.unit || 0) + (d.sc || 0);
    m.days++;
  }
  return [...out.values()];
}

export const DOW_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* ---------- price bands ---------- */

export const BANDS = {
  plunge: 'Plunge',
  cheap: 'Cheap',
  fair: 'Flexible or less',
  pricey: 'Above Flexible',
  peak: 'Peak',
};

/** Band a unit rate against the Flexible (price-cap) rate for the region. */
export function bandOf(p, ref) {
  if (p <= 0) return 'plunge';
  if (p < ref * 0.5) return 'cheap';
  if (p <= ref + 0.005) return 'fair';
  if (p < ref * 1.5) return 'pricey';
  return 'peak';
}

/* ---------- typical and sample usage ---------- */

// Relative half-hourly shape of an average UK home with no EV or heat pump (evening peak, quiet overnight).
const SHAPE = [
  0.55, 0.5, 0.45, 0.42, 0.4, 0.38, 0.37, 0.36, 0.36, 0.37, 0.4, 0.45,
  0.55, 0.7, 0.9, 1.0, 1.0, 0.95, 0.9, 0.85, 0.82, 0.8, 0.8, 0.82,
  0.88, 0.9, 0.85, 0.8, 0.78, 0.78, 0.8, 0.88, 1.0, 1.2, 1.4, 1.55,
  1.6, 1.6, 1.5, 1.4, 1.3, 1.2, 1.1, 1.0, 0.9, 0.8, 0.7, 0.6,
];
const SHAPE_SUM = SHAPE.reduce((a, b) => a + b, 0);
export const TYPICAL_SHAPE = SHAPE.map((v) => v / SHAPE_SUM);

// Overnight charging window used for the estimate: 00:30 to 04:30, inside every EV tariff's cheap period.
const EV_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8];

/** Half-hourly series for `days` complete days ending at London midnight before `now`. */
export function typicalUsage({ annualKwh, evKwh = 0, days = 30, now }) {
  const end = londonMidnight(now);
  const start = addDays(end, -days);
  const out = [];
  for (let ts = start; ts < end; ts += HALF) {
    const s = slotOf(ts);
    let kwh = (annualKwh / 365) * TYPICAL_SHAPE[s];
    if (evKwh && EV_SLOTS.includes(s)) kwh += evKwh / 365 / EV_SLOTS.length;
    out.push({ s: ts, kwh });
  }
  return out;
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A made-up household (EV charged a few nights a week, heavier in winter; fuel 'G' gas, 'X' solar export). */
export function sampleUsage({ days = 366, now, fuel = 'E' }) {
  const rnd = mulberry32(fuel === 'G' ? 77 : fuel === 'X' ? 4242 : 20261119);
  const end = londonMidnight(now) - DAY; // smart-meter data usually trails by a day
  const start = addDays(end, -days);
  const out = [];
  let evTonight = false;
  for (let ts = start; ts < end; ts += HALF) {
    const s = slotOf(ts);
    const doy = (ts - Date.UTC(new Date(ts).getUTCFullYear(), 0, 1)) / DAY;
    const winter = (Math.cos(((doy - 15) / 365) * 2 * Math.PI) + 1) / 2; // 1 mid-January, 0 mid-July
    if (s === 0 && fuel !== 'X') evTonight = rnd() < 0.45;
    let kwh;
    if (fuel === 'X') {
      // Rooftop solar surplus: a midday bell, strong in summer, with a different amount of cloud each day.
      if (s === 0) evTonight = rnd();
      const sun = Math.max(0, Math.sin(((s - 15) / 22) * Math.PI));
      kwh = Math.max(0, sun * (0.12 + 1.25 * (1 - winter)) * (0.25 + 0.75 * evTonight) * (0.8 + 0.4 * rnd()) - 0.08);
    } else if (fuel === 'G') {
      const heat = s >= 12 && s < 18 ? 1.6 : s >= 32 && s < 44 ? 1.4 : 0.25;
      kwh = (0.12 + 1.35 * winter * winter) * heat * (0.7 + 0.6 * rnd());
    } else {
      kwh = (3100 / 365) * TYPICAL_SHAPE[s] * (0.8 + 0.4 * winter) * (0.55 + 0.9 * rnd());
      if (evTonight && s >= 1 && s < 9) kwh += 3.4;
    }
    out.push({ s: ts, kwh: Math.round(kwh * 1000) / 1000 });
  }
  return out;
}
