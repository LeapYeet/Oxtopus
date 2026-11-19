// Small dependency-free SVG charts. Colours come from CSS classes so both themes work
// and nothing needs an inline style attribute (the page's CSP forbids them).

const NS = 'http://www.w3.org/2000/svg';

export function S(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  for (const c of kids) if (c != null) e.append(c);
  return e;
}

/** HTML element helper. Text always goes in via textContent/append, never innerHTML. */
export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(3)) if (c != null && c !== false) e.append(c);
  return e;
}

/** Replace an element's children, skipping null/false (replaceChildren would print them as text). */
export function put(el, ...kids) {
  el.replaceChildren(...kids.flat(3).filter((k) => k != null && k !== false));
}

/* ---------- tooltip ---------- */

let tipEl = null;

/** rows: [{ value, label, cls }] where cls adds a colour key before the label. */
export function showTip(x, y, title, rows) {
  if (!tipEl) {
    tipEl = h('div', { class: 'tip', role: 'status' });
    document.body.append(tipEl);
  }
  put(tipEl,
    title ? h('div', { class: 'tip-title', text: title }) : null,
    ...rows.map((r) => h('div', { class: 'tip-row' },
      h('span', { class: 'tip-key ' + (r.cls || 'tip-key-none') }),
      h('strong', { text: r.value }),
      h('span', { class: 'tip-label', text: r.label }))),
  );
  tipEl.classList.add('on');
  const w = tipEl.offsetWidth, ht = tipEl.offsetHeight;
  let left = x + 14, top = y - ht - 12;
  if (left + w > window.innerWidth - 8) left = x - w - 14;
  if (left < 8) left = 8;
  if (top < 8) top = y + 18;
  tipEl.style.left = left + window.scrollX + 'px';
  tipEl.style.top = top + window.scrollY + 'px';
}

export function hideTip() {
  if (tipEl) tipEl.classList.remove('on');
}

/* ---------- shared ---------- */

const observers = new WeakMap();

/** Render now and again whenever the container's width changes. */
function mount(el, render) {
  let last = -1;
  const draw = () => {
    const w = Math.floor(el.clientWidth);
    if (w < 40 || w === last) return;
    last = w;
    el.replaceChildren(render(w));
  };
  if (observers.has(el)) observers.get(el).disconnect();
  const ro = new ResizeObserver(draw);
  observers.set(el, ro);
  ro.observe(el);
  draw();
}

export function niceTicks(min, max, target = 4) {
  const span = max - min || 1;
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

function frame(w, height, yMin, yMax, fmtY, ref) {
  const m = { l: 42, r: ref ? 58 : 10, t: 14, b: 24 };
  const pw = w - m.l - m.r, ph = height - m.t - m.b;
  const y = (v) => m.t + ph - ((v - yMin) / (yMax - yMin || 1)) * ph;
  const svg = S('svg', { viewBox: '0 0 ' + w + ' ' + height, width: w, height, class: 'chart', role: 'img' });
  for (const t of niceTicks(yMin, yMax)) {
    svg.append(
      S('line', { x1: m.l, x2: m.l + pw, y1: y(t), y2: y(t), class: t === 0 ? 'ax' : 'gl' }),
      S('text', { x: m.l - 8, y: y(t) + 4, class: 'tick', 'text-anchor': 'end' }, fmtY(t)),
    );
  }
  return { svg, m, pw, ph, y };
}

function refLine(f, ref) {
  if (!ref || !(ref.v > 0)) return;
  const yy = f.y(ref.v);
  const x = f.m.l + f.pw;
  f.svg.append(
    S('line', { x1: f.m.l, x2: x + 4, y1: yy, y2: yy, class: 'ref' }),
    S('text', { x: x + 7, y: yy - 2, class: 'ref-label' }, ref.name),
    S('text', { x: x + 7, y: yy + 10, class: 'ref-value' }, ref.value),
  );
}

/** Track the pointer across the plot, calling onIndex(i, clientX, clientY) with the nearest slot. */
function track(f, n, onIndex, onLeave) {
  const hit = S('rect', { x: f.m.l, y: f.m.t, width: f.pw, height: f.ph + f.m.b, class: 'hit' });
  const move = (e) => {
    const box = hit.getBoundingClientRect();
    const i = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - box.left) / box.width) * n)));
    onIndex(i, e.clientX, e.clientY);
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', () => { hideTip(); onLeave(); });
  f.svg.append(hit);
}

/* ---------- column chart ---------- */

/**
 * items: [{ v, cls, v2, cls2, tipTitle, tipRows }], opt: { height, ref:{v,name,value}, nowIndex, xTicks:[{i,label}], fmtY, label }
 * Bars grow from a zero baseline and are capped at 24px wide. v2 (zero or negative) draws a second bar downwards.
 */
export function columns(el, items, opt = {}) {
  mount(el, (w) => {
    const height = opt.height || 260;
    const vals = items.flatMap((d) => [d.v, d.v2]).filter((v) => Number.isFinite(v));
    const top = Math.max(0, ...vals, opt.ref ? opt.ref.v : 0);
    const yMax = (top || 1) * 1.1;
    const yMin = Math.min(0, ...vals) * 1.1;
    const f = frame(w, height, yMin, yMax, opt.fmtY || ((v) => v + 'p'), opt.ref);
    f.svg.setAttribute('aria-label', opt.label || 'Column chart');
    const n = items.length;
    const slot = f.pw / n;
    const gap = slot > 7 ? 2 : slot > 3.5 ? 1 : 0.5;
    const bw = Math.max(1, Math.min(24, slot - gap));
    const r = Math.min(4, bw / 2);
    const zero = f.y(0);
    const bars = [];

    if (opt.nowIndex != null && opt.nowIndex >= 0 && opt.nowIndex < n) {
      f.svg.append(
        S('rect', { x: f.m.l + opt.nowIndex * slot, y: f.m.t, width: slot, height: f.ph, class: 'now-band' }),
        S('text', { x: f.m.l + (opt.nowIndex + 0.5) * slot, y: f.m.t - 3, class: 'now-label', 'text-anchor': opt.nowIndex < 2 ? 'start' : 'middle' }, 'now'),
      );
    }
    // Rounded at the data end, square at the baseline.
    const barPath = (x, v) => {
      const yv = f.y(v);
      const rr = Math.min(r, Math.max(1, Math.abs(zero - yv)));
      return v >= 0
        ? `M${x},${zero}V${yv + rr}Q${x},${yv} ${x + rr},${yv}H${x + bw - rr}Q${x + bw},${yv} ${x + bw},${yv + rr}V${zero}Z`
        : `M${x},${zero}V${yv - rr}Q${x},${yv} ${x + rr},${yv}H${x + bw - rr}Q${x + bw},${yv} ${x + bw},${yv - rr}V${zero}Z`;
    };
    items.forEach((d, i) => {
      const x = f.m.l + i * slot + (slot - bw) / 2;
      const g = S('g', {});
      if (Number.isFinite(d.v) && d.v !== 0) g.append(S('path', { d: barPath(x, d.v), class: 'bar ' + (d.cls || '') }));
      // A second series drawn downwards from the same baseline (e.g. export under import).
      if (Number.isFinite(d.v2) && d.v2 !== 0) g.append(S('path', { d: barPath(x, d.v2), class: 'bar ' + (d.cls2 || '') }));
      bars.push(g.childNodes.length ? g : null);
      if (g.childNodes.length) f.svg.append(g);
    });
    refLine(f, opt.ref);
    for (const t of opt.xTicks || []) {
      f.svg.append(S('text', { x: f.m.l + (t.i + (t.edge ? 0 : 0.5)) * slot, y: height - 7, class: 'tick', 'text-anchor': 'middle' }, t.label));
    }
    let lit = null;
    track(f, n, (i, cx, cy) => {
      if (lit) lit.classList.remove('lit');
      lit = bars[i];
      if (lit) lit.classList.add('lit');
      const d = items[i];
      if (d && d.tipRows) showTip(cx, cy, d.tipTitle, d.tipRows); else hideTip();
    }, () => { if (lit) lit.classList.remove('lit'); lit = null; });
    return f.svg;
  });
}

/* ---------- step lines (rate through the day) ---------- */

/** series: [{ name, cls, values:[48] }], opt: { height, labelAt(i) -> "HH:MM", fmt(v), fmtY(v), minTop } */
export function stepLines(el, series, opt = {}) {
  mount(el, (w) => {
    const height = opt.height || 280;
    const all = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
    const fmt = opt.fmt || ((v) => v.toFixed(2) + 'p');
    const f = frame(w, height, Math.min(0, ...all), Math.max(opt.minTop || 1, ...all) * 1.08, opt.fmtY || ((v) => v + 'p'));
    f.svg.setAttribute('aria-label', opt.label || 'Unit rate through the day');
    const n = 48, slot = f.pw / n;
    for (const s of series) {
      let d = '';
      let pen = false;
      s.values.forEach((v, i) => {
        if (!Number.isFinite(v)) { pen = false; return; }
        const x0 = f.m.l + i * slot, x1 = x0 + slot, yy = f.y(v);
        d += (pen ? 'L' : 'M') + x0 + ',' + yy + 'L' + x1 + ',' + yy;
        pen = true;
      });
      f.svg.append(S('path', { d, class: 'line ' + s.cls }));
    }
    const every = w < 520 ? 12 : 6;
    for (let i = 0; i <= n; i += every) {
      f.svg.append(S('text', { x: f.m.l + i * slot, y: height - 7, class: 'tick', 'text-anchor': i === 0 ? 'start' : i === n ? 'end' : 'middle' }, opt.labelAt(i % 48)));
    }
    const cross = S('line', { y1: f.m.t, y2: f.m.t + f.ph, class: 'cross' });
    f.svg.append(cross);
    track(f, n, (i, cx, cy) => {
      const x = f.m.l + (i + 0.5) * slot;
      cross.setAttribute('x1', x);
      cross.setAttribute('x2', x);
      cross.classList.add('on');
      const rows = series.filter((s) => Number.isFinite(s.values[i]))
        .map((s) => ({ value: fmt(s.values[i]), label: s.name, cls: 'key-line ' + s.cls, v: s.values[i] }))
        .sort((a, b) => a.v - b.v);
      showTip(cx, cy, opt.labelAt(i) + ' – ' + opt.labelAt((i + 1) % 48), rows);
    }, () => cross.classList.remove('on'));
    return f.svg;
  });
}

/* ---------- single line (daily history; the axis is zoomed, so no area fill) ---------- */

/** points: [{ label, v }], opt: { height, cls, ref:{v,label}, name, fmt(v) } */
export function line(el, points, opt = {}) {
  mount(el, (w) => {
    const height = opt.height || 170;
    const vals = points.map((p) => p.v);
    const lo = Math.min(...vals, opt.ref ? opt.ref.v : Infinity);
    const hi = Math.max(...vals, opt.ref ? opt.ref.v : -Infinity);
    const pad = (hi - lo || 1) * 0.18;
    const f = frame(w, height, Math.max(0, lo - pad), hi + pad, (v) => v + 'p', opt.ref);
    f.svg.setAttribute('aria-label', opt.label || 'Price history');
    const n = points.length;
    const x = (i) => f.m.l + (n === 1 ? f.pw / 2 : (i / (n - 1)) * (f.pw - 8));
    const d = points.map((p, i) => (i ? 'L' : 'M') + x(i) + ',' + f.y(p.v)).join('');
    const base = f.m.t + f.ph;
    f.svg.append(S('path', { d, class: 'line ' + (opt.cls || '') }));
    refLine(f, opt.ref);
    const step = Math.max(1, Math.ceil(n / (w < 420 ? 3 : 5)));
    for (let i = n - 1; i >= 0; i -= step) {
      f.svg.append(S('text', { x: x(i), y: height - 7, class: 'tick', 'text-anchor': i === n - 1 ? 'end' : 'middle' }, points[i].label));
    }
    const dot = S('circle', { r: 4, class: 'dot ' + (opt.cls || ''), cx: x(n - 1), cy: f.y(points[n - 1].v) });
    const cross = S('line', { y1: f.m.t, y2: base, class: 'cross' });
    f.svg.append(cross, dot);
    const fmt = opt.fmt || ((v) => v.toFixed(2) + 'p');
    track(f, n, (_, cx, cy) => {
      const box = f.svg.getBoundingClientRect();
      const px = ((cx - box.left) / box.width) * w;
      let i = Math.round(((px - f.m.l) / (f.pw - 8)) * (n - 1));
      i = Math.min(n - 1, Math.max(0, i));
      cross.setAttribute('x1', x(i));
      cross.setAttribute('x2', x(i));
      cross.classList.add('on');
      dot.setAttribute('cx', x(i));
      dot.setAttribute('cy', f.y(points[i].v));
      showTip(cx, cy, points[i].label, [{ value: fmt(points[i].v), label: opt.name || '', cls: 'key-line ' + (opt.cls || '') }]);
    }, () => {
      cross.classList.remove('on');
      dot.setAttribute('cx', x(n - 1));
      dot.setAttribute('cy', f.y(points[n - 1].v));
    });
    return f.svg;
  });
}

/* ---------- 24-hour strip ---------- */

/** cells: [{ cls, opacity, title, rows }] laid out as one thin row of 48 half hours. */
export function strip(cells) {
  const row = h('div', { class: 'strip', role: 'img', 'aria-label': 'Unit rate by time of day' });
  cells.forEach((c) => {
    const cell = h('span', { class: 'cell ' + (c.cls || '') });
    if (c.opacity != null) cell.style.opacity = String(c.opacity);
    const show = (e) => showTip(e.clientX, e.clientY, c.title, c.rows);
    cell.addEventListener('pointermove', show);
    cell.addEventListener('pointerdown', show);
    cell.addEventListener('pointerleave', hideTip);
    row.append(cell);
  });
  return h('div', { class: 'strip-wrap' }, row,
    h('div', { class: 'strip-axis' }, ...['00', '06', '12', '18', '24'].map((t) => h('span', { text: t }))));
}

/* ---------- weekday x hour heatmap ---------- */

/**
 * grid: 7 rows (Mon..Sun) of 24 hourly values. One hue, darker = more, so it reads without a legend lookup.
 * opt: { cls, rowLabels, fmt(v), unit }
 */
export function heat(grid, opt = {}) {
  const max = Math.max(...grid.flat(), 1e-9);
  const fmt = opt.fmt || ((v) => v.toFixed(2));
  const wrap = h('div', { class: 'heat', role: 'img', 'aria-label': opt.label || 'Average by weekday and hour' });
  wrap.append(h('span', { class: 'heat-corner' }));
  for (let hr = 0; hr < 24; hr++) wrap.append(h('span', { class: 'heat-x', text: hr % 6 === 0 ? String(hr).padStart(2, '0') : '' }));
  grid.forEach((row, d) => {
    wrap.append(h('span', { class: 'heat-y', text: opt.rowLabels[d] }));
    row.forEach((v, hr) => {
      const cell = h('span', { class: 'heat-cell ' + (opt.cls || '') });
      const fillEl = h('i', {});
      fillEl.style.opacity = String(v <= 0 ? 0 : 0.12 + 0.88 * (v / max));
      cell.append(fillEl);
      const show = (e) => showTip(e.clientX, e.clientY, opt.rowLabels[d] + ' · ' + String(hr).padStart(2, '0') + ':00–' + String((hr + 1) % 24).padStart(2, '0') + ':00',
        [{ value: fmt(v), label: opt.unit || '' }]);
      cell.addEventListener('pointermove', show);
      cell.addEventListener('pointerdown', show);
      cell.addEventListener('pointerleave', hideTip);
      wrap.append(cell);
    });
  });
  return h('div', { class: 'heat-wrap' }, wrap,
    h('div', { class: 'heat-scale' }, h('span', { text: 'Less' }), h('span', { class: 'heat-ramp ' + (opt.cls || '') }), h('span', { text: 'More · up to ' + fmt(max) + ' ' + (opt.unit || '') })));
}

/* ---------- one whole split into parts ---------- */

/** parts: [{ label, value, cls, text }]. A tall segmented bar with the share printed where it fits, plus a legend. */
export function segbar(parts, opt = {}) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const shown = parts.filter((p) => p.value > 0);
  const bar = h('div', { class: 'segbar', role: 'img', 'aria-label': opt.label || 'Share by part' });
  for (const p of shown) {
    const share = (p.value / total) * 100;
    const block = h('span', { class: 'segbar-part ' + (p.cls || '') }, share >= 9 ? h('b', { text: share.toFixed(0) + '%' }) : null);
    block.style.flexGrow = String(p.value);
    const show = (e) => showTip(e.clientX, e.clientY, p.label, [{ value: share.toFixed(1) + '%', label: p.text || '' }]);
    block.addEventListener('pointermove', show);
    block.addEventListener('pointerdown', show);
    block.addEventListener('pointerleave', hideTip);
    bar.append(block);
  }
  const legend = h('div', { class: 'legend' }, shown.map((p) => h('span', { class: 'legend-item' },
    h('span', { class: 'chip' }, h('i', { class: 'swatch ' + (p.cls || '') }), p.label),
    h('span', { class: 'legend-note', text: ((p.value / total) * 100).toFixed(0) + '%' + (p.text ? ' · ' + p.text : '') }))));
  return h('div', {}, bar, legend);
}
