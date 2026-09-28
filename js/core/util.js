// util.js — Helfer für Datum, Geld, DOM, IDs
export const CURRENCIES = ['CHF', 'EUR', 'USD', 'GBP'];

let idCounter = 0;
export function uid(prefix = 'id') {
  idCounter = (idCounter + 1) % 100000;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function now() { return Date.now(); }

/* ---------------- Datum ---------------- */

const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MONTHS_DE_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export function pad2(n) { return String(n).padStart(2, '0'); }

/** Normalisiert alles Mögliche zu 'YYYY-MM-DD' oder null. */
export function toISODate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !isNaN(value)) return fmtISO(value);
  if (typeof value === 'number') {
    // Excel-Seriennummer (1900-System)
    if (value > 20000 && value < 60000) {
      const ms = Math.round((value - 25569) * 86400 * 1000);
      return fmtISO(new Date(ms));
    }
    if (value > 1e12) return fmtISO(new Date(value));
    return null;
  }
  const s = String(value).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/); // 31.12.2025 / 31/12/2025
  if (m) {
    let y = m[3];
    if (y.length === 2) y = (Number(y) > 70 ? '19' : '20') + y;
    return `${y}-${pad2(m[2])}-${pad2(m[1])}`;
  }
  const d = new Date(s);
  if (!isNaN(d)) return fmtISO(d);
  return null;
}

export function fmtISO(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function monthKey(iso) { return String(iso).slice(0, 7); }
export function yearOf(iso) { return String(iso).slice(0, 4); }

export function monthLabel(key, short = false) {
  const [y, m] = key.split('-').map(Number);
  if (short) return `${MONTHS_DE_SHORT[(m || 1) - 1]} ${String(y).slice(2)}`;
  return `${MONTHS_DE[(m || 1) - 1]} ${y}`;
}

export function addMonths(key, delta) {
  let [y, m] = key.split('-').map(Number);
  m += delta;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12 + 12) % 12 + 1;
  return `${y}-${pad2(m)}`;
}

export function monthRange(fromKey, toKey) {
  const out = [];
  let k = fromKey;
  let guard = 0;
  while (k <= toKey && guard++ < 1200) { out.push(k); k = addMonths(k, 1); }
  return out;
}

export function endOfMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return fmtISO(new Date(y, m, 0));
}

export function startOfMonth(key) { return `${key}-01`; }

export function currentMonthKey() { return fmtISO(new Date()).slice(0, 7); }

export function daysInMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  return `${d}.${m}.${y}`;
}

export function fmtDateShort(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  return `${d}.${m}.`;
}

export function todayISO() { return fmtISO(new Date()); }

/* ---------------- Geld / Zahlen ---------------- */

export function parseNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return isFinite(value) ? value : null;
  let s = String(value).trim();
  if (!s || s === '-' || s === '–') return null;
  s = s.replace(/[ \s'’]/g, '');
  s = s.replace(/(CHF|EUR|USD|GBP|Fr\.)/gi, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith('-') && s.length > 1) { neg = true; s = s.slice(0, -1); }
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    const decimals = s.length - lastComma - 1;
    s = decimals <= 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  s = s.replace(/[^0-9.\-+eE]/g, '');
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

export function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

const nfCache = new Map();
function nf(digits) {
  const key = String(digits);
  if (!nfCache.has(key)) {
    nfCache.set(key, new Intl.NumberFormat('de-CH', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  }
  return nfCache.get(key);
}

/** «CHF 1'234.50» bzw. «CHF −1'234.50» – Minuszeichen vor der Zahl, nicht vor der Währung. */
export function fmtMoney(amount, currency = 'CHF', opts = {}) {
  if (amount === null || amount === undefined || !isFinite(amount)) return '–';
  const abs = Math.abs(amount);
  const sign = amount < -0.004 ? '\u2212' : '';
  if (opts.compact && abs >= 10000) return `${currency} ${sign}${fmtCompact(abs)}`;
  const digits = opts.noDecimals ? 0 : 2;
  return `${currency} ${sign}${nf(digits).format(abs)}`;
}

export function fmtCompact(n) {
  const abs = Math.abs(n);
  const sign = n < 0 ? '\u2212' : '';
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace('.', '.')} Mio.`;
  if (abs >= 1e3) return `${sign}${Math.round(abs / 100) / 10}k`;
  return `${sign}${abs.toFixed(0)}`;
}

export function fmtNumber(n, digits = 2) {
  if (n === null || n === undefined || !isFinite(n)) return '–';
  return new Intl.NumberFormat('de-CH', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

export function fmtPercent(n, digits = 0) {
  if (n === null || n === undefined || !isFinite(n)) return '–';
  return `${new Intl.NumberFormat('de-CH', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n * 100)}%`;
}

/* ---------------- Text ---------------- */

export function normText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[äàáâ]/g, 'a').replace(/[öòóô]/g, 'o').replace(/[üùúû]/g, 'u')
    .replace(/[éèêë]/g, 'e').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function titleCasePayee(s) {
  const raw = String(s || '').trim().replace(/\s{2,}/g, ' ');
  if (!raw) return '';
  if (raw === raw.toUpperCase() && raw.length > 3) {
    return raw.toLowerCase().replace(/(^|[\s\-/])(\w)/g, (m, p, c) => p + c.toUpperCase());
  }
  return raw;
}

export function hashString(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- DOM ---------------- */

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  appendAll(el, children);
  return el;
}

function appendAll(el, children) {
  for (const c of children.flat(4)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function el(sel, root = document) { return root.querySelector(sel); }
export function els(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

export function debounce(fn, ms = 300) {
  let t;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.cancel = () => clearTimeout(t);
  wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
  return wrapped;
}

export function download(filename, content, mime = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function clone(o) {
  return typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o));
}

export function sum(arr, fn = (x) => x) {
  let t = 0;
  for (const x of arr) { const v = fn(x); if (typeof v === 'number' && isFinite(v)) t += v; }
  return t;
}

export function groupBy(arr, fn) {
  const m = new Map();
  for (const x of arr) {
    const k = fn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

/** Konsistenter Vergleich – wichtig, damit gleiche Werte die Reihenfolge behalten. */
export function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
export function byDateAsc(get = (x) => x.date) { return (a, b) => cmpStr(get(a), get(b)); }
export function byDateDesc(get = (x) => x.date) { return (a, b) => cmpStr(get(b), get(a)); }

export function sortBy(arr, fn, dir = 1) {
  return [...arr].sort((a, b) => {
    const va = fn(a), vb = fn(b);
    if (va === vb) return 0;
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    return (va > vb ? 1 : -1) * dir;
  });
}

/* ---------------- CSV ---------------- */

export function detectDelimiter(text) {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0) || '';
  const counts = { ';': 0, ',': 0, '\t': 0, '|': 0 };
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ';';
}

export function parseCSV(text, delimiter) {
  const d = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [], field = '', inQ = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === d) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch === '\r') { /* skip */ }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/* ---------------- Farben ---------------- */

// Validierte Kategorienfarben (Reihenfolge ist bewusst gewählt: sie hält den
// Farbabstand auch bei Farbsehschwäche ein). Als CSS-Variablen, damit Hell- und
// Dunkelmodus je eigene, geprüfte Stufen verwenden können.
export const PALETTE = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)',
  'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)',
];

export const PALETTE_HEX = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

export function colorFor(seed, index = null) {
  if (index !== null) return PALETTE[index % PALETTE.length];
  const n = parseInt(hashString(seed).slice(-4), 36) || 0;
  return PALETTE[n % PALETTE.length];
}
