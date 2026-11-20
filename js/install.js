// Installing Oxtopus as an app. Some browsers hand the page an install prompt it can show from a
// button; the rest only install from their own menu, so we give the steps for the browser in use.

import { h, put } from './charts.js';
import { store } from './core.js';

let deferred = null;
let justInstalled = false;
const watchers = new Map();
const changed = () => { for (const fn of watchers.values()) fn(); };

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // keep it, so the visitor can install from our button when they choose
  deferred = e;
  changed();
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  justInstalled = true;
  changed();
});

/** One callback per key, so a redrawn view replaces its old callback instead of piling up. */
export const watchInstall = (key, fn) => { watchers.set(key, fn); };

const standalone = () => ['standalone', 'minimal-ui', 'window-controls-overlay']
  .some((m) => matchMedia('(display-mode: ' + m + ')').matches) || navigator.standalone === true;

export const isInstalled = () => justInstalled || standalone();
export const canPrompt = () => !!deferred;

export async function promptInstall() {
  if (!deferred) return;
  const e = deferred;
  deferred = null; // a prompt can only be used once
  // If the browser refuses to show it, the redraw below falls back to the written steps.
  try { await e.prompt(); await e.userChoice; } catch { /* refused or dismissed */ }
  changed();
}

function platform() {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Edg\//.test(ua)) return 'edge';
  if (/Chrome\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua) && /Macintosh/.test(ua)) return 'safari';
  return 'other';
}

const GUIDES = {
  ios: {
    name: 'iPhone or iPad',
    steps: [
      'Tap the Share button, the square with an arrow pointing up. If you can’t see it, tap ••• first.',
      'Scroll down and tap “Add to Home Screen”.',
      'Tap “Add”.',
    ],
  },
  android: {
    name: 'Android',
    steps: [
      'Open the browser menu. In Chrome that is ⋮ at the top right.',
      'Tap “Add to Home screen” (some browsers call it “Install app”).',
      'Tap “Install”.',
    ],
  },
  chrome: {
    name: 'Chrome on a computer',
    steps: [
      'Click the install icon at the right-hand end of the address bar: a screen with a down arrow.',
      'If it isn’t there, open the ⋮ menu, choose “Cast, save and share”, then the “Install” option.',
      'Click “Install”.',
    ],
  },
  edge: {
    name: 'Edge on a computer',
    steps: [
      'Click the app icon at the right-hand end of the address bar: three squares and a plus.',
      'If it isn’t there, open the ··· menu, choose “Apps”, then “Install this site as an app”.',
      'Click “Install”.',
    ],
  },
  safari: {
    name: 'Safari on a Mac',
    steps: [
      'In the menu bar, choose “File”, then “Add to Dock”.',
      'Click “Add”.',
    ],
  },
  firefox: {
    name: 'Firefox on a computer',
    steps: [],
    note: 'Firefox on a computer may not offer this, depending on its version. Opening this page in Chrome, Edge or Safari will, or you can simply bookmark it.',
  },
  other: {
    name: 'This browser',
    steps: [],
    note: 'Look in your browser’s menu for “Install”, “Add to Home screen” or “Add to Dock”. If there is nothing like that, Chrome, Edge and Safari all support it.',
  },
};

const stepList = (g) => [
  g.steps.length ? h('ol', { class: 'steps' }, g.steps.map((s) => h('li', { text: s }))) : null,
  g.note ? h('p', { class: 'fine', text: g.note }) : null,
];

/** The full guide for the Settings page: an install button where the browser allows, steps for every device. */
export function installGuide() {
  if (standalone()) return h('p', { text: 'You are using the installed app. Nothing more to do.' });
  if (justInstalled) return h('p', { text: 'Installed. Oxtopus is now with your other apps, and you can close this tab.' });
  const mine = platform();
  const g = GUIDES[mine];
  return [
    canPrompt() ? h('div', { class: 'row first' },
      h('button', { type: 'button', class: 'btn primary', onclick: promptInstall, text: 'Install Oxtopus' })) : null,
    h('h3', { class: 'steps-head', text: canPrompt() ? 'Or by hand, in ' + lower(g.name) : g.steps.length ? 'On this device (' + g.name + ')' : g.name }),
    stepList(g),
    h('details', { class: 'more' },
      h('summary', { text: 'Steps for other devices' }),
      Object.entries(GUIDES).filter(([k, x]) => k !== mine && x.steps.length)
        .map(([, x]) => [h('h3', { class: 'steps-head', text: x.name }), stepList(x)])),
  ];
}

const lower = (name) => name.replace(/^This/, 'this');

/** The one-line tip under the header. Hidden once installed, dismissed, or where the browser can't install. */
export function drawInstallHint(el, { hide = false } = {}) {
  const g = GUIDES[platform()];
  const show = !hide && !isInstalled() && !store.get('installHint', null) && (canPrompt() || g.steps.length > 0);
  el.hidden = !show;
  if (!show) { put(el); return; }
  const redraw = () => drawInstallHint(el, { hide });
  const open = el.dataset.open === '1';
  const action = canPrompt()
    ? h('button', { type: 'button', class: 'btn small primary', onclick: promptInstall, text: 'Install' })
    : h('button', { type: 'button', class: 'btn small', 'aria-expanded': String(open), 'aria-controls': 'install-steps',
      onclick: () => { el.dataset.open = open ? '0' : '1'; redraw(); }, text: open ? 'Hide steps' : 'Show me how' });
  put(el, h('div', { class: 'install-in' },
    h('p', {}, h('strong', { text: 'Use Oxtopus as an app.' }), ' Its own icon and window, no app store.'),
    h('span', { class: 'install-acts' }, action,
      h('button', { type: 'button', class: 'icon-btn small', 'aria-label': 'Hide this tip', title: 'Hide this tip',
        onclick: () => { store.set('installHint', 'off'); redraw(); }, text: '×' })),
    open && !canPrompt() ? h('div', { id: 'install-steps', class: 'install-steps' }, stepList(g),
      h('p', { class: 'fine' }, 'Steps for other devices are in ', h('a', { href: '#settings', text: 'Settings' }), '.')) : null));
}
