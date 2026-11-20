// App shell: routing, region and theme controls, connecting an account, and the refresh loop.

import * as api from './api.js';
import * as T from './tariffs.js';
import { h, hideTip } from './charts.js';
import { state, store, hooks, ensureCatalog, parseAccount, sampleAccount, currentAgreement, clearUsage, loading, errorBox } from './core.js';
import { viewNow } from './view-now.js';
import { viewTariffs } from './view-tariffs.js';
import { viewCompare } from './view-compare.js';
import { viewUsage } from './view-usage.js';
import { viewSettings } from './view-settings.js';
import { drawInstallHint, watchInstall } from './install.js';

const VIEWS = { now: viewNow, tariffs: viewTariffs, compare: viewCompare, usage: viewUsage, settings: viewSettings };
// No hash means "home", which is whichever page the visitor chose as their start page.
const viewFromHash = () => { const v = location.hash.slice(1); return VIEWS[v] ? v : state.prefs.start; };
const main = document.getElementById('view');
const regionSel = document.getElementById('region');
const hintEl = document.getElementById('install-hint');
// Settings has the full install guide, so the one-line tip steps aside there.
const syncInstallHint = () => drawInstallHint(hintEl, { hide: state.view === 'settings' });
watchInstall('hint', syncInstallHint);
let seq = 0;

/* ---------- rendering ---------- */

/** soft = build off-screen and swap in when ready, so a background refresh never flashes a spinner. */
async function render({ soft = false } = {}) {
  const mine = ++seq;
  const alive = () => mine === seq;
  hideTip();
  const root = h('div', { class: 'view view-' + state.view });
  if (!soft) main.replaceChildren(root);
  for (const a of document.querySelectorAll('nav a')) {
    const on = a.dataset.view === state.view;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  syncHeader();
  try {
    if (!state.cat) {
      if (!soft) root.append(loading('Loading tariffs from Octopus…'));
      await ensureCatalog();
      if (!alive()) return;
      root.replaceChildren();
    }
    const done = VIEWS[state.view](root, alive);
    if (soft) {
      // Charts need to be in the document to size themselves, so park the new view invisibly first.
      root.classList.add('staging');
      main.append(root);
      await done;
      if (!alive()) { root.remove(); return; }
      root.classList.remove('staging');
      main.replaceChildren(root);
    }
  } catch (e) {
    console.error(e);
    if (alive()) { root.classList.remove('staging'); main.replaceChildren(errorBox(e, () => render())); }
  }
}

/** Header state that depends on settings: the account dot, the settings button and where the logo leads. */
function syncHeader() {
  document.getElementById('acct-dot').classList.toggle('on', !!state.acct);
  document.getElementById('settings-link').classList.toggle('on', state.view === 'settings');
  document.querySelector('.brand').setAttribute('href', '#' + state.prefs.start);
  syncInstallHint();
}

function go(view) {
  if (!VIEWS[view]) view = state.prefs.start;
  if (location.hash !== '#' + view) { location.hash = view; return; }
  state.view = view;
  render();
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => {
  state.view = viewFromHash();
  render();
  window.scrollTo(0, 0);
});

/* ---------- region and theme ---------- */

for (const [k, name] of Object.entries(T.REGIONS)) regionSel.append(h('option', { value: k, text: name }));
regionSel.value = state.region;
regionSel.addEventListener('change', () => setRegion(regionSel.value));

function setRegion(r, { rerender = true } = {}) {
  if (!T.REGIONS[r]) return;
  state.region = r;
  regionSel.value = r;
  store.set('region', r);
  if (rerender) render();
}

function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  const dark = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#120b1d' : '#f6f3fa');
}
function setTheme(t) {
  if (t) store.set('theme', t); else store.del('theme');
  applyTheme(t);
}
applyTheme(store.get('theme', null));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(store.get('theme', null)));

/* ---------- account ---------- */

const CREDS = 'ox.creds';

function readCreds() {
  for (const s of [sessionStorage, localStorage]) {
    try {
      const raw = s.getItem(CREDS);
      if (raw) return JSON.parse(raw);
    } catch { /* storage blocked */ }
  }
  return null;
}

function writeCreds(creds, remember) {
  try {
    localStorage.removeItem(CREDS);
    sessionStorage.removeItem(CREDS);
    (remember ? localStorage : sessionStorage).setItem(CREDS, JSON.stringify(creds));
  } catch { /* the key simply will not be remembered */ }
}

function explain(e) {
  if (e.status === 401) return new Error('Octopus did not accept that API key. Check it was copied in full.');
  if (e.status === 404) return new Error('Octopus could not find that account number for this key.');
  if (e.status === 429) return new Error('Octopus is rate-limiting requests. Wait a minute and try again.');
  return e;
}

async function connect(key, number, remember) {
  key = (key || '').trim();
  number = (number || '').trim().toUpperCase();
  if (!key) throw new Error('Paste your API key first.');
  try {
    if (!number) {
      let found = [];
      try { found = await api.accountNumbers(key); } catch (e) {
        if (e.status === 401) throw e;
        throw new Error('Could not look up your account number automatically. Enter it below and try again.');
      }
      if (!found.length) throw new Error('No account was found for that key. Enter your account number as well.');
      number = found[0];
    }
    const acct = parseAccount(await api.account(number, key));
    state.acct = acct;
    state.demo = false;
    state.creds = { key, account: number };
    state.source = acct.import ? 'account' : 'estimate';
    clearUsage();
    writeCreds(state.creds, remember);
    const first = acct.import || acct.export || acct.gas;
    const cur = currentAgreement(first.agreements);
    const t = cur && T.parseTariffCode(cur.tariff_code);
    if (t && T.REGIONS[t.region] && t.region !== state.region) {
      state.region = t.region;
      regionSel.value = t.region;
      store.set('region', t.region);
    }
  } catch (e) {
    throw explain(e);
  }
}

function disconnect() {
  try { localStorage.removeItem(CREDS); sessionStorage.removeItem(CREDS); } catch { /* nothing stored */ }
  state.acct = null;
  state.creds = null;
  state.demo = false;
  state.source = 'estimate';
  clearUsage();
  render();
}

async function sample() {
  await ensureCatalog();
  state.acct = sampleAccount();
  state.demo = true;
  state.creds = null;
  state.source = 'account';
  clearUsage();
  render();
}

/** Forget everything this site has stored in the browser, then start again. */
function reset() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('ox.')) localStorage.removeItem(k);
    }
    sessionStorage.removeItem(CREDS);
  } catch { /* storage blocked: nothing was saved anyway */ }
  location.hash = '';
  location.reload();
}

Object.assign(hooks, {
  render: () => render(), go, connect, sample, disconnect, header: syncHeader, setTheme, reset,
  // From Settings the page should stay put, so only the stored region changes.
  setRegion: (r) => setRegion(r, { rerender: false }),
});

/* ---------- boot ---------- */

state.view = viewFromHash();
api.pruneCache();

const saved = readCreds();
if (saved && saved.key && saved.account) {
  let remembered = false;
  try { remembered = !!localStorage.getItem(CREDS); } catch { /* storage blocked */ }
  state.connecting = connect(saved.key, saved.account, remembered)
    .catch((e) => { console.warn('Saved Octopus key no longer works:', e.message); })
    .finally(() => {
      state.connecting = null;
      if (state.view === 'compare' || state.view === 'now' || state.view === 'settings') render({ soft: state.view === 'now' });
    });
}
render();

// Prices change on the half hour and tomorrow's Agile lands around 4pm: refresh quietly.
let lastSlot = Math.floor(Date.now() / T.HALF);
let lastRefresh = Date.now();
setInterval(() => {
  if (document.hidden || state.view !== 'now') return;
  const slot = Math.floor(Date.now() / T.HALF);
  if (slot !== lastSlot || Date.now() - lastRefresh > 10 * 60000) {
    lastSlot = slot;
    lastRefresh = Date.now();
    render({ soft: true });
  }
}, 30000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.view === 'now' && Date.now() - lastRefresh > 5 * 60000) {
    lastRefresh = Date.now();
    lastSlot = Math.floor(Date.now() / T.HALF);
    render({ soft: true });
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js').catch(() => {}));
}
