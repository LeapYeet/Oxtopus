// Network layer. Every request goes to one of three hosts (see the CSP in index.html):
// Octopus Energy, the National Grid carbon intensity API, and Open-Meteo.
// The API key is only ever attached to requests for api.octopus.energy.

import { toIntervals, intervalLookup, dayNightLookup, parseTariffCode, familyOf } from './tariffs.js';

export const BASE = 'https://api.octopus.energy/v1';
const LS_PREFIX = 'ox.c.';
const mem = new Map();
const inflight = new Map();

// At most six requests in flight, so opening the tariff list does not fire fifty at once.
let active = 0;
const waiting = [];
async function limited(fn) {
  if (active >= 6) await new Promise((go) => waiting.push(go));
  active++;
  try { return await fn(); } finally {
    active--;
    const next = waiting.shift();
    if (next) next();
  }
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function lsGet(url) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + url);
    if (!raw) return null;
    const { e, d } = JSON.parse(raw);
    if (e > Date.now()) return { exp: e, data: d };
    localStorage.removeItem(LS_PREFIX + url);
  } catch { /* storage unavailable or corrupt: fall through to the network */ }
  return null;
}

function lsSet(url, data, exp) {
  try {
    const raw = JSON.stringify({ e: exp, d: data });
    if (raw.length < 60000) localStorage.setItem(LS_PREFIX + url, raw);
  } catch { /* quota or private mode: caching is optional */ }
}

/** Drop expired cache rows so localStorage does not grow without bound. */
export function pruneCache() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(LS_PREFIX)) continue;
      const { e } = JSON.parse(localStorage.getItem(k));
      if (!(e > Date.now())) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}

/**
 * GET JSON with an in-memory cache. Authenticated responses are never written to localStorage.
 * opts: { key, ttl (ms), persist (bool) }
 */
export async function get(url, { key, ttl = 300000, persist = false } = {}) {
  const ck = (key ? 'auth:' : '') + url;
  const hit = mem.get(ck);
  if (hit && hit.exp > Date.now()) return hit.data;
  if (persist && !key) {
    const stored = lsGet(url);
    if (stored) { mem.set(ck, stored); return stored.data; }
  }
  if (inflight.has(ck)) return inflight.get(ck);
  const p = (async () => {
    let res;
    try {
      res = await limited(() => fetch(url, key ? { headers: { Authorization: 'Basic ' + btoa(key + ':') } } : undefined));
    } catch {
      throw new ApiError(0, 'Could not reach the server. Check your connection.');
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).detail || ''; } catch { /* non-JSON error body */ }
      throw new ApiError(res.status, detail || 'Request failed (' + res.status + ')');
    }
    const data = await res.json();
    const exp = Date.now() + ttl;
    mem.set(ck, { exp, data });
    if (persist && !key) lsSet(url, data, exp);
    return data;
  })();
  inflight.set(ck, p);
  try { return await p; } finally { inflight.delete(ck); }
}

/** Fetch every page of a paginated Octopus list endpoint. */
export async function getAll(url, opts = {}, pageSize = 1500) {
  const sep = url.includes('?') ? '&' : '?';
  const first = await get(url + sep + 'page_size=' + pageSize, opts);
  const rows = first.results.slice();
  const pages = Math.ceil((first.count || 0) / pageSize);
  for (let p = 2; p <= pages; p += 4) {
    const batch = [];
    for (let q = p; q < p + 4 && q <= pages; q++) batch.push(get(url + sep + 'page_size=' + pageSize + '&page=' + q, opts));
    for (const r of await Promise.all(batch)) rows.push(...r.results);
  }
  return rows;
}

/** Run async jobs with limited concurrency, preserving order. A failed job yields null. */
export async function pool(items, fn, size = 6) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i], i); } catch { out[i] = null; }
    }
  }));
  return out;
}

const iso = (ts) => new Date(ts).toISOString().replace('.000Z', 'Z');

function tariffUrl(tariffCode) {
  const t = parseTariffCode(tariffCode);
  if (!t) throw new ApiError(0, 'Unrecognised tariff code ' + tariffCode);
  return BASE + '/products/' + t.product + '/' + (t.fuel === 'G' ? 'gas' : 'electricity') + '-tariffs/' + tariffCode + '/';
}

async function rateRows(tariffCode, kind, from, to, opts) {
  const url = tariffUrl(tariffCode) + kind + '/?period_from=' + iso(from) + '&period_to=' + iso(to);
  return toIntervals(await getAll(url, opts));
}

// Night windows as [startSlot, endSlot): Intelligent Go 23:30-05:30, otherwise a generic Economy 7 00:30-07:30.
const IGO_WINDOW = [47, 11];
const E7_WINDOW = [1, 15];

/**
 * Unit-rate lookup for a tariff over [from, to).
 * Returns { at(ts), intervals?, assumedWindow? }. Tariffs that publish only day and night rates
 * (Intelligent Go, Economy 7) get an assumed night window, flagged in `assumedWindow`.
 */
export async function unitRates(tariffCode, from, to, opts = {}) {
  const t = parseTariffCode(tariffCode);
  if (t && t.reg === '1R') {
    const rows = await rateRows(tariffCode, 'standard-unit-rates', from, to, opts);
    if (rows.length) return intervalLookup(rows);
  }
  const [day, night] = await Promise.all([
    rateRows(tariffCode, 'day-unit-rates', from, to, opts).catch(() => []),
    rateRows(tariffCode, 'night-unit-rates', from, to, opts).catch(() => []),
  ]);
  if (!day.length && !night.length) return intervalLookup([]);
  const window = t && familyOf(t.product).id === 'igo' ? IGO_WINDOW : E7_WINDOW;
  const lk = dayNightLookup(intervalLookup(day), intervalLookup(night), window);
  lk.assumedWindow = window;
  return lk;
}

export async function standingCharges(tariffCode, from, to, opts = {}) {
  return intervalLookup(await rateRows(tariffCode, 'standing-charges', from, to, opts));
}

/* ---------- product catalogue ---------- */

export const productList = () => get(BASE + '/products/?page_size=250', { ttl: 6 * 3600000, persist: true });
export const productDetail = (code) => get(BASE + '/products/' + code + '/', { ttl: 6 * 3600000 });

/* ---------- account ---------- */

async function gql(query, variables, token) {
  let res;
  try {
    res = await fetch(BASE + '/graphql/', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: token } : {}),
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    throw new ApiError(0, 'Could not reach Octopus. Check your connection.');
  }
  const body = await res.json().catch(() => ({}));
  if (body.errors && body.errors.length) {
    const e = body.errors[0];
    throw new ApiError(401, (e.extensions && e.extensions.errorDescription) || e.message || 'Octopus rejected the request');
  }
  return body.data;
}

/** Find the account number(s) that an API key belongs to, so the user only has to paste the key. */
export async function accountNumbers(key) {
  const auth = await gql('mutation($k:String!){obtainKrakenToken(input:{APIKey:$k}){token}}', { k: key });
  const token = auth && auth.obtainKrakenToken && auth.obtainKrakenToken.token;
  if (!token) throw new ApiError(401, 'Octopus did not accept that API key.');
  const data = await gql('{viewer{accounts{number}}}', {}, token);
  return ((data && data.viewer && data.viewer.accounts) || []).map((a) => a.number).filter(Boolean);
}

export const account = (number, key) =>
  get(BASE + '/accounts/' + encodeURIComponent(number) + '/', { key, ttl: 600000 });

/** Half-hourly consumption for one meter: [{s, kwh}] sorted by start. */
export async function consumption(fuel, point, serial, from, to, key) {
  const url = BASE + '/' + (fuel === 'G' ? 'gas' : 'electricity') + '-meter-points/' + encodeURIComponent(point)
    + '/meters/' + encodeURIComponent(serial) + '/consumption/?period_from=' + iso(from) + '&period_to=' + iso(to)
    + '&order_by=period';
  const rows = await getAll(url, { key, ttl: 900000 }, 25000);
  return rows.map((r) => ({ s: Date.parse(r.interval_start), kwh: r.consumption }));
}

/* ---------- grid context ---------- */

export const generationMix = () => get('https://api.carbonintensity.org.uk/generation', { ttl: 900000 });
export const carbonIntensity = () => get('https://api.carbonintensity.org.uk/intensity', { ttl: 900000 });

// Flamborough Head: a reasonable single-point proxy for North Sea wind and UK sun.
export const windSolar = () => get(
  'https://api.open-meteo.com/v1/forecast?latitude=54.3&longitude=-0.1'
  + '&daily=wind_speed_10m_max,shortwave_radiation_sum&wind_speed_unit=mph&forecast_days=4&timezone=Europe%2FLondon',
  { ttl: 3 * 3600000, persist: true },
);
