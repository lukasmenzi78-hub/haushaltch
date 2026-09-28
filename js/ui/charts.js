// charts.js — schlanke SVG-Diagramme (ohne externe Bibliothek), hell/dunkel-fähig
import { fmtMoney, fmtCompact, fmtNumber, fmtPercent, escapeHtml, debounce } from '../core/util.js';

const NS = 'http://www.w3.org/2000/svg';

function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    el.setAttribute(k, v);
  }
  for (const c of children.flat(3)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const AXIS = { grid: 'var(--grid)', base: 'var(--axis)', ink: 'var(--ink-muted)' };

/* ---------------- Rahmen mit Grössenanpassung ---------------- */

export function chart(spec) {
  const wrap = document.createElement('div');
  wrap.className = 'chart' + (spec.class ? ' ' + spec.class : '');
  const holder = document.createElement('div');
  holder.className = 'chart-svg';
  wrap.append(holder);

  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  wrap.append(tip);

  const ctx = { tip, wrap };
  const render = () => {
    const w = Math.max(220, holder.clientWidth || wrap.clientWidth || 320);
    const h = spec.height || 200;
    holder.replaceChildren(build(spec, w, h, ctx));
  };

  requestAnimationFrame(render);
  const ro = new ResizeObserver(debounce(render, 80));
  ro.observe(holder);
  wrap._rerender = render;

  if (spec.legend !== false && spec.type !== 'sparkline') {
    const box = legend(spec);
    if (box.childNodes?.length) wrap.append(box);
  }
  return wrap;
}

function build(spec, w, h, ctx) {
  switch (spec.type) {
    case 'line': return lineChart(spec, w, h, ctx);
    case 'bar': return barChart(spec, w, h, ctx);
    case 'hbar': return hBarChart(spec, w, h, ctx);
    case 'donut': return donutChart(spec, w, h, ctx);
    case 'stacked': return stackedChart(spec, w, h, ctx);
    case 'sparkline': return sparkline(spec, w, h);
    default: return s('svg', { width: w, height: h });
  }
}

function legend(spec) {
  const items = spec.legendItems
    ? spec.legendItems
    : spec.type === 'donut' || spec.type === 'hbar'
      ? (spec.rows || []).slice(0, 12).map((r) => ({ label: r.label, color: r.color }))
      : spec.type === 'bar'
        ? []   // Säulen tragen ihre Beschriftung an der Achse
        : (spec.series || []).map((r) => ({ label: r.label, color: r.color }));
  if (items.length < 2) return document.createDocumentFragment();
  const box = document.createElement('div');
  box.className = 'chart-legend';
  for (const it of items) {
    const li = document.createElement('span');
    li.className = 'legend-item';
    li.innerHTML = `<i style="background:${it.color}"></i>${escapeHtml(it.label)}`;
    box.append(li);
  }
  return box;
}

/* ---------------- Hilfen ---------------- */

function niceTicks(min, max, count = 4) {
  if (min === max) { min = Math.min(0, min); max = max || 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(step0) || 1)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : v);
  return { ticks, min: start, max: end };
}

function fmtAxis(v, spec) {
  if (spec.percent) return fmtPercent(v, 0);
  return fmtCompact(v);
}

function showTip(ctx, evt, html) {
  const { tip, wrap } = ctx;
  tip.innerHTML = html;
  tip.hidden = false;
  const r = wrap.getBoundingClientRect();
  let x = evt.clientX - r.left + 12;
  let y = evt.clientY - r.top - 8;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  if (x + tw > r.width - 4) x = Math.max(4, evt.clientX - r.left - tw - 12);
  if (y + th > r.height - 4) y = Math.max(4, r.height - th - 4);
  tip.style.transform = `translate(${x}px, ${y}px)`;
}
function hideTip(ctx) { ctx.tip.hidden = true; }

function tipRow(color, label, value) {
  return `<div class="tip-row"><i style="background:${color}"></i><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

/* ---------------- Linie / Fläche ---------------- */

function lineChart(spec, w, h, ctx) {
  const pad = { l: 46, r: 12, t: 12, b: 26 };
  const series = spec.series || [];
  const labels = spec.labels || [];
  const n = Math.max(1, labels.length);
  const all = series.flatMap((sr) => sr.values.filter((v) => v !== null && isFinite(v)));
  const rawMin = Math.min(0, ...all);
  const rawMax = Math.max(...all, 0);
  const { ticks, min, max } = niceTicks(rawMin, rawMax, 4);
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const x = (i) => pad.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => pad.t + ih - ((v - min) / (max - min || 1)) * ih;

  const svg = s('svg', { width: w, height: h, role: 'img', 'aria-label': spec.title || 'Diagramm' });

  for (const t of ticks) {
    svg.append(s('line', { x1: pad.l, x2: w - pad.r, y1: y(t), y2: y(t), stroke: t === 0 ? AXIS.base : AXIS.grid, 'stroke-width': 1 }));
    svg.append(s('text', { x: pad.l - 6, y: y(t) + 4, 'text-anchor': 'end', class: 'axis-label' }, fmtAxis(t, spec)));
  }

  const step = Math.ceil(n / Math.max(2, Math.floor(iw / 60)));
  labels.forEach((l, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    svg.append(s('text', { x: x(i), y: h - 8, 'text-anchor': 'middle', class: 'axis-label' }, l));
  });

  // Fehlende Werte erzeugen eine Lücke – nicht eine Null. Sonst behauptet der
  // Chart einen Wert von 0 für Monate, für die schlicht keine Daten vorliegen.
  for (const sr of series) {
    const segments = [];
    let current = [];
    sr.values.forEach((v, i) => {
      if (v === null || v === undefined || !isFinite(v)) {
        if (current.length) { segments.push(current); current = []; }
        return;
      }
      current.push([x(i), y(v), i]);
    });
    if (current.length) segments.push(current);

    for (const seg of segments) {
      const line = seg.map((p) => `${p[0]},${p[1]}`).join(' L');
      if (sr.area !== false && spec.area && seg.length > 1) {
        const base = y(Math.max(min, 0));
        svg.append(s('path', {
          d: `M${line} L${seg[seg.length - 1][0]},${base} L${seg[0][0]},${base} Z`,
          fill: sr.color, opacity: 0.14,
        }));
      }
      if (seg.length === 1) {
        svg.append(s('circle', { cx: seg[0][0], cy: seg[0][1], r: 3, fill: sr.color }));
        continue;
      }
      svg.append(s('path', {
        d: `M${line}`,
        fill: 'none', stroke: sr.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        'stroke-dasharray': sr.dashed ? '5 4' : null,
      }));
    }
  }

  // Fadenkreuz + Tooltip
  const cross = s('line', { y1: pad.t, y2: pad.t + ih, stroke: AXIS.base, 'stroke-width': 1, opacity: 0 });
  svg.append(cross);
  const dots = series.map((sr) => {
    const c = s('circle', { r: 4.5, fill: 'var(--surface-1)', stroke: sr.color, 'stroke-width': 2.5, opacity: 0 });
    svg.append(c); return c;
  });
  const hit = s('rect', { x: pad.l, y: pad.t, width: iw, height: ih, fill: 'transparent' });
  svg.append(hit);
  hit.addEventListener('pointermove', (e) => {
    const rect = svg.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - pad.l) / (iw || 1)) * (n - 1))));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', 0.5);
    series.forEach((sr, k) => {
      const v = sr.values[i];
      const missing = v === null || v === undefined || !isFinite(v);
      dots[k].setAttribute('cx', x(i));
      dots[k].setAttribute('cy', missing ? -99 : y(v));
      dots[k].setAttribute('opacity', missing ? 0 : 1);
    });
    const rows = series
      .filter((sr) => sr.values[i] !== null && sr.values[i] !== undefined && isFinite(sr.values[i]))
      .map((sr) => tipRow(sr.color, sr.label, spec.format ? spec.format(sr.values[i]) : fmtMoney(sr.values[i], spec.currency || 'CHF')))
      .join('') || '<div class="tip-sub">keine Daten</div>';
    showTip(ctx, e, `<div class="tip-title">${escapeHtml(labels[i] ?? '')}</div>${rows}`);
  });
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('opacity', 0);
    dots.forEach((d) => d.setAttribute('opacity', 0));
    hideTip(ctx);
  });
  return svg;
}

/* ---------------- Säulen ---------------- */

function barChart(spec, w, h, ctx) {
  const pad = { l: 46, r: 12, t: 14, b: 28 };
  const rows = spec.rows || [];
  const groupsOfTwo = !!spec.dual;
  const values = groupsOfTwo ? rows.flatMap((r) => [r.value, r.value2 ?? 0]) : rows.map((r) => r.value);
  const { ticks, min, max } = niceTicks(Math.min(0, ...values), Math.max(0, ...values), 4);
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const n = Math.max(1, rows.length);
  const slot = iw / n;
  const barW = groupsOfTwo ? Math.max(4, Math.min(22, slot / 2 - 4)) : Math.max(5, Math.min(38, slot * 0.62));
  const y = (v) => pad.t + ih - ((v - min) / (max - min || 1)) * ih;
  const svg = s('svg', { width: w, height: h });

  for (const t of ticks) {
    svg.append(s('line', { x1: pad.l, x2: w - pad.r, y1: y(t), y2: y(t), stroke: t === 0 ? AXIS.base : AXIS.grid, 'stroke-width': 1 }));
    svg.append(s('text', { x: pad.l - 6, y: y(t) + 4, 'text-anchor': 'end', class: 'axis-label' }, fmtAxis(t, spec)));
  }

  const zero = y(0);
  const labelEvery = Math.ceil(n / Math.max(2, Math.floor(iw / 58)));
  rows.forEach((r, i) => {
    const cx = pad.l + slot * i + slot / 2;
    const draw = (val, color, offset) => {
      const top = Math.min(y(val), zero);
      const height = Math.max(1.5, Math.abs(y(val) - zero));
      const rect = s('rect', {
        x: cx + offset - barW / 2, y: top, width: barW, height,
        rx: Math.min(4, barW / 2), fill: color,
      });
      rect.addEventListener('pointerenter', (e) => showTip(ctx, e,
        `<div class="tip-title">${escapeHtml(r.label)}</div>${tipRow(color, spec.valueLabel || 'Betrag', spec.format ? spec.format(val) : fmtMoney(val, spec.currency || 'CHF'))}`));
      rect.addEventListener('pointerleave', () => hideTip(ctx));
      svg.append(rect);
    };
    if (groupsOfTwo) {
      draw(r.value, r.color || 'var(--series-1)', -barW / 2 - 1);
      draw(r.value2 ?? 0, r.color2 || 'var(--series-2)', barW / 2 + 1);
    } else {
      draw(r.value, r.color || 'var(--series-1)', 0);
    }
    if (i % labelEvery === 0 || n <= 12) {
      svg.append(s('text', { x: cx, y: h - 9, 'text-anchor': 'middle', class: 'axis-label' }, r.label));
    }
  });
  return svg;
}

/* ---------------- Balken horizontal ---------------- */

function hBarChart(spec, w, h, ctx) {
  const rows = (spec.rows || []).slice(0, spec.limit || 12);
  const rowH = 30;
  const height = Math.max(h, rows.length * rowH + 12);
  const labelW = Math.min(170, Math.max(96, w * 0.36));
  const valueW = 92;
  const trackW = Math.max(40, w - labelW - valueW - 12);
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  const svg = s('svg', { width: w, height });

  rows.forEach((r, i) => {
    const y = i * rowH + 6;
    svg.append(s('text', { x: 0, y: y + 15, class: 'bar-label' }, clip(r.label, Math.floor(labelW / 7))));
    svg.append(s('rect', { x: labelW, y: y + 5, width: trackW, height: 12, rx: 4, fill: 'var(--track)' }));
    const bw = Math.max(3, (Math.abs(r.value) / max) * trackW);
    const bar = s('rect', { x: labelW, y: y + 5, width: bw, height: 12, rx: 4, fill: r.color || 'var(--series-1)' });
    bar.addEventListener('pointerenter', (e) => showTip(ctx, e,
      `${tipRow(r.color, r.label, spec.format ? spec.format(r.value) : fmtMoney(r.value, spec.currency || 'CHF'))}${r.count ? `<div class="tip-sub">${r.count} Buchungen</div>` : ''}`));
    bar.addEventListener('pointerleave', () => hideTip(ctx));
    svg.append(bar);
    svg.append(s('text', { x: w, y: y + 16, 'text-anchor': 'end', class: 'bar-value' },
      spec.format ? spec.format(r.value) : fmtMoney(r.value, spec.currency || 'CHF', { noDecimals: true })));
  });
  return svg;
}

function clip(text, chars) {
  const t = String(text ?? '');
  return t.length > chars ? t.slice(0, chars - 1) + '…' : t;
}

/* ---------------- Ring ---------------- */

function donutChart(spec, w, h, ctx) {
  const rows = (spec.rows || []).filter((r) => Math.abs(r.value) > 0);
  const size = Math.min(w, h);
  const cx = w / 2, cy = h / 2;
  const outer = size / 2 - 6;
  const inner = outer * 0.62;
  const total = rows.reduce((a, r) => a + Math.abs(r.value), 0) || 1;
  const svg = s('svg', { width: w, height: h });
  const gapAngle = rows.length > 1 ? 0.012 : 0;
  let angle = -Math.PI / 2;

  for (const r of rows) {
    const frac = Math.abs(r.value) / total;
    const a0 = angle + gapAngle / 2;
    const a1 = angle + frac * Math.PI * 2 - gapAngle / 2;
    angle += frac * Math.PI * 2;
    if (a1 <= a0) continue;
    const path = s('path', { d: arcPath(cx, cy, inner, outer, a0, a1), fill: r.color || 'var(--series-1)' });
    path.addEventListener('pointerenter', (e) => showTip(ctx, e,
      tipRow(r.color, r.label, `${spec.format ? spec.format(r.value) : fmtMoney(r.value, spec.currency || 'CHF')} · ${fmtPercent(frac, 0)}`)));
    path.addEventListener('pointerleave', () => hideTip(ctx));
    svg.append(path);
  }

  if (spec.centerValue !== undefined) {
    svg.append(s('text', { x: cx, y: cy - 2, 'text-anchor': 'middle', class: 'donut-value' }, spec.centerValue));
    if (spec.centerLabel) svg.append(s('text', { x: cx, y: cy + 16, 'text-anchor': 'middle', class: 'donut-label' }, spec.centerLabel));
  }
  return svg;
}

function arcPath(cx, cy, r0, r1, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(r1, a0), [x1, y1] = p(r1, a1), [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0);
  return `M${x0},${y0} A${r1},${r1} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 ${large} 0 ${x3},${y3} Z`;
}

/* ---------------- Gestapelte Säulen ---------------- */

function stackedChart(spec, w, h, ctx) {
  const pad = { l: 46, r: 12, t: 14, b: 28 };
  const periods = spec.labels || [];
  const series = spec.series || [];
  const n = Math.max(1, periods.length);
  const totals = periods.map((_, i) => series.reduce((a, sr) => a + (sr.values[i] || 0), 0));
  const { ticks, min, max } = niceTicks(0, Math.max(...totals, 1), 4);
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const slot = iw / n;
  const barW = Math.max(6, Math.min(42, slot * 0.62));
  const y = (v) => pad.t + ih - ((v - min) / (max - min || 1)) * ih;
  const svg = s('svg', { width: w, height: h });

  for (const t of ticks) {
    svg.append(s('line', { x1: pad.l, x2: w - pad.r, y1: y(t), y2: y(t), stroke: t === 0 ? AXIS.base : AXIS.grid, 'stroke-width': 1 }));
    svg.append(s('text', { x: pad.l - 6, y: y(t) + 4, 'text-anchor': 'end', class: 'axis-label' }, fmtAxis(t, spec)));
  }

  const labelEvery = Math.ceil(n / Math.max(2, Math.floor(iw / 58)));
  periods.forEach((label, i) => {
    const cx = pad.l + slot * i + slot / 2;
    let acc = 0;
    series.forEach((sr) => {
      const v = sr.values[i] || 0;
      if (v <= 0) return;
      const yTop = y(acc + v);
      const height = Math.max(1, y(acc) - y(acc + v) - 2); // 2px Abstand zwischen Segmenten
      const rect = s('rect', { x: cx - barW / 2, y: yTop, width: barW, height, rx: 2, fill: sr.color });
      rect.addEventListener('pointerenter', (e) => showTip(ctx, e,
        `<div class="tip-title">${escapeHtml(label)}</div>${tipRow(sr.color, sr.label, fmtMoney(v, spec.currency || 'CHF'))}`));
      rect.addEventListener('pointerleave', () => hideTip(ctx));
      svg.append(rect);
      acc += v;
    });
    if (i % labelEvery === 0 || n <= 12) svg.append(s('text', { x: cx, y: h - 9, 'text-anchor': 'middle', class: 'axis-label' }, label));
  });
  return svg;
}

/* ---------------- Sparkline ---------------- */

function sparkline(spec, w, h) {
  const vals = spec.values || [];
  if (vals.length < 2) return s('svg', { width: w, height: h });
  const min = Math.min(...vals), max = Math.max(...vals);
  const x = (i) => (i / (vals.length - 1)) * (w - 4) + 2;
  const y = (v) => h - 3 - ((v - min) / ((max - min) || 1)) * (h - 6);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  const svg = s('svg', { width: w, height: h, class: 'sparkline' });
  if (spec.area) svg.append(s('path', { d: `${d} L${x(vals.length - 1)},${h} L${x(0)},${h} Z`, fill: spec.color || 'var(--series-1)', opacity: 0.14 }));
  svg.append(s('path', { d, fill: 'none', stroke: spec.color || 'var(--series-1)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  return svg;
}

/* ---------------- Fortschrittsbalken ---------------- */

export function meter({ value, max, color, status, label, sublabel, format }) {
  const pct = max > 0 ? Math.min(1.4, value / max) : 0;
  const wrap = document.createElement('div');
  wrap.className = 'meter';
  const fmt = format || ((v) => fmtMoney(v, 'CHF', { noDecimals: true }));
  const stateColor = status === 'critical' ? 'var(--critical)'
    : status === 'warning' ? 'var(--warning)'
      : status === 'good' ? 'var(--good)' : (color || 'var(--series-1)');
  wrap.innerHTML = `
    <div class="meter-head">
      <span class="meter-label">${escapeHtml(label ?? '')}</span>
      <span class="meter-value">${escapeHtml(fmt(value))}${max ? ` <span class="muted">/ ${escapeHtml(fmt(max))}</span>` : ''}</span>
    </div>
    <div class="meter-track"><div class="meter-fill" style="width:${Math.min(100, pct * 100).toFixed(1)}%;background:${stateColor}"></div>
      ${pct > 1 ? '<div class="meter-over"></div>' : ''}</div>
    ${sublabel ? `<div class="meter-sub">${escapeHtml(sublabel)}</div>` : ''}`;
  return wrap;
}

export { fmtNumber };
