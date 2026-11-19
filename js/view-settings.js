// "Settings": everything a visitor can customise. All of it is saved in this browser only.

import * as api from './api.js';
import * as T from './tariffs.js';
import { h, put } from './charts.js';
import { state, store, hooks, savePrefs, primary, card, seg, NOW_SECTIONS, START_PAGES } from './core.js';

const HEADLINES = ['agile', 'tracker', 'flexible', 'go', 'igo', 'cosy', 'snug', 'flux'];

export function viewSettings(root) {
  /* ----- start page ----- */
  const start = card('Start page', { sub: 'The page that opens when you visit, or tap the Oxtopus logo' });
  const drawStart = () => put(start.body, seg(START_PAGES, state.prefs.start, (v) => { state.prefs.start = v; savePrefs(); hooks.header(); drawStart(); }, 'Start page'));
  drawStart();

  /* ----- headline tariff ----- */
  const head = card('Headline tariff', { sub: 'The big price at the top of the Now page' });
  const options = HEADLINES.map((id) => primary(id)).filter(Boolean).map((p) => [p.family, p.label]);
  options.push(['mine', state.acct && state.acct.import ? 'My own tariff' : 'My own tariff (connect an account first)']);
  head.body.append(
    h('label', { class: 'field wide' }, h('span', { text: 'Show the current price for' }),
      h('select', { onchange: (e) => { state.prefs.headline = e.target.value; savePrefs(); } },
        options.map(([v, text]) => h('option', { value: v, selected: v === state.prefs.headline, text })))),
    h('p', { class: 'fine', text: 'With “My own tariff”, the headline follows whatever tariff your account is on, including older versions. '
      + 'Until an account is connected it shows Agile.' }));

  /* ----- sections ----- */
  const secs = card('Sections on the Now page', { sub: 'Untick to hide. Use the arrows to reorder.' });
  const list = h('ul', { class: 'sortlist' });
  secs.body.append(list);
  const drawList = (focus) => {
    const { order, hidden } = state.prefs;
    put(list, order.map((id, i) => {
      const s = NOW_SECTIONS.find((x) => x.id === id);
      const box = h('input', { type: 'checkbox', checked: !hidden.includes(id), onchange: (e) => {
        state.prefs.hidden = e.target.checked ? hidden.filter((x) => x !== id) : [...hidden, id];
        savePrefs();
      } });
      const move = (dir) => () => {
        const j = i + dir;
        [order[i], order[j]] = [order[j], order[i]];
        savePrefs();
        drawList(id + (dir < 0 ? ':up' : ':down'));
      };
      const up = h('button', { type: 'button', class: 'icon-btn small', 'aria-label': 'Move ' + s.label + ' up', disabled: i === 0, onclick: move(-1), text: '↑', 'data-k': id + ':up' });
      const down = h('button', { type: 'button', class: 'icon-btn small', 'aria-label': 'Move ' + s.label + ' down', disabled: i === order.length - 1, onclick: move(1), text: '↓', 'data-k': id + ':down' });
      return h('li', {},
        h('label', { class: 'check' }, box, h('span', {}, s.label, s.note ? h('span', { class: 'muted', text: ' · ' + s.note }) : null)),
        h('span', { class: 'sort-btns' }, up, down));
    }));
    // Keep keyboard focus on the arrow that was pressed (or its twin if it is now disabled).
    if (focus) {
      const btn = list.querySelector('[data-k="' + focus + '"]');
      const alt = list.querySelector('[data-k="' + focus.split(':')[0] + (focus.endsWith('up') ? ':down' : ':up') + '"]');
      (btn && !btn.disabled ? btn : alt).focus();
    }
  };
  drawList();

  /* ----- region ----- */
  const region = card('Region', { sub: 'Prices differ between the 14 electricity regions' });
  const sel = h('select', { 'aria-label': 'Region', onchange: (e) => hooks.setRegion(e.target.value) },
    Object.entries(T.REGIONS).map(([k, name]) => h('option', { value: k, selected: k === state.region, text: name })));
  const pc = h('input', { type: 'text', name: 'postcode', autocomplete: 'postal-code', placeholder: 'e.g. LS1 4AP', 'aria-label': 'Postcode' });
  const pcMsg = h('p', { class: 'fine', role: 'status' });
  const find = h('button', { type: 'submit', class: 'btn', text: 'Find my region' });
  region.body.append(
    h('label', { class: 'field wide' }, h('span', { text: 'Your region' }), sel),
    h('form', { class: 'inline-form', onsubmit: async (e) => {
      e.preventDefault();
      const value = pc.value.trim();
      if (!value) return;
      find.disabled = true;
      pcMsg.textContent = 'Looking up…';
      try {
        const found = await api.regionsForPostcode(value);
        if (!found.length) pcMsg.textContent = 'Octopus did not recognise that postcode.';
        else if (found.length === 1) {
          hooks.setRegion(found[0]);
          sel.value = found[0];
          pcMsg.textContent = 'Set to ' + T.REGIONS[found[0]] + '.';
        } else {
          put(pcMsg, 'That postcode area spans more than one region. Enter the full postcode, or pick: ',
            found.map((r, i) => [i ? ', ' : '', h('button', { type: 'button', class: 'link', onclick: () => { hooks.setRegion(r); sel.value = r; pcMsg.textContent = 'Set to ' + T.REGIONS[r] + '.'; }, text: T.REGIONS[r] })]));
        }
      } catch (err) {
        pcMsg.textContent = err.message;
      }
      find.disabled = false;
    } }, pc, find),
    pcMsg,
    h('p', { class: 'fine', text: 'The postcode is sent to Octopus to look up the region and is not stored. Connecting an account sets the region automatically.' }));

  /* ----- appearance ----- */
  const look = card('Appearance', {});
  const drawLook = () => put(look.body, seg([{ v: 'system', label: 'Match device' }, { v: 'light', label: 'Light' }, { v: 'dark', label: 'Dark' }],
    store.get('theme', null) || 'system', (v) => { hooks.setTheme(v === 'system' ? null : v); drawLook(); }, 'Theme'));
  drawLook();

  /* ----- data ----- */
  const data = card('Your data', { sub: 'Everything is kept in this browser. Nothing is sent to a server of ours, because there isn’t one.' });
  data.body.append(
    h('p', {}, state.demo ? 'You are viewing the sample household. ' : state.acct ? 'An Octopus account is connected. ' : 'No Octopus account is connected. ',
      h('a', { href: '#usage', text: state.acct ? 'Open My usage' : 'Connect one in My usage' }), '.'),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn', onclick: () => {
        if (window.confirm('Reset all settings and remove any saved API key from this browser?')) hooks.reset();
      }, text: 'Reset everything on this device' })));

  root.append(
    h('div', { class: 'page-head' }, h('h1', { text: 'Settings' }),
      h('p', { class: 'card-sub', text: 'Make Oxtopus yours. Changes save as you make them, in this browser only.' })),
    h('div', { class: 'grid two' }, start.el, head.el),
    secs.el,
    h('div', { class: 'grid two' }, region.el, h('div', { class: 'stack' }, look.el, data.el)));
  return Promise.resolve();
}
