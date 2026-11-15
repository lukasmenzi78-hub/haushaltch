// Misst, wie gut die Standardregeln die echten Auszüge einordnen.
import fs from 'node:fs';
import path from 'node:path';
import { parseCSV } from '../js/core/util.js';
import { parseSheet } from '../js/core/parsers.js';
import { detectIbkr } from '../js/core/ibkr.js';
import { evaluate } from '../js/core/rules.js';
import { DEFAULT_RULES, DEFAULT_CATEGORIES } from '../js/core/categories.js';
import { readLikeApp } from './lib.mjs';

const dir = process.argv[2];
const detail = process.argv[3] || '';
const catName = Object.fromEntries(DEFAULT_CATEGORIES.map((c) => [c.id, c.name]));
const all = [];
for (const f of fs.readdirSync(dir).filter((x) => /\.csv$/i.test(x) && !x.startsWith('export_')).sort()) {
  const rows = parseCSV(readLikeApp(path.join(dir, f)));
  if (detectIbkr(rows)) continue;
  const r = parseSheet(rows);
  let cat = 0, tr = 0;
  for (const t of r.transactions) {
    const { patch } = evaluate({ ...t }, DEFAULT_RULES);
    const x = { ...t, file: f, ruleId: patch.ruleId || '', categoryId: patch.categoryId || 'c_unkategorisiert', isTransfer: !!patch.isTransfer };
    if (x.categoryId !== 'c_unkategorisiert') cat++;
    if (x.isTransfer) tr++;
    all.push(x);
  }
  console.log(f.padEnd(36), String(r.transactions.length).padStart(4), 'Buchungen |', String(Math.round(100 * cat / (r.transactions.length || 1))).padStart(3) + ' % eingeordnet |', tr, 'Überträge');
}
const n = all.length, c = all.filter((x) => x.categoryId !== 'c_unkategorisiert').length;
console.log('GESAMT', n, '|', Math.round(100 * c / n), '% eingeordnet |', all.filter((x) => x.isTransfer).length, 'Überträge');
if (detail === 'offen') {
  const m = new Map();
  for (const x of all.filter((x) => x.categoryId === 'c_unkategorisiert')) { const k = x.payee.slice(0, 34) + ' | ' + (x.merchantCategory || x.description).slice(0, 34); m.set(k, (m.get(k) || 0) + 1); }
  for (const [k, v] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, Number(process.argv[4] || 60))) console.log(String(v).padStart(3), k);
}
if (detail === 'heuristik') {
  for (const id of ['sys_lohneingang', 'sys_gutschrift_gross', 'sys_dauerauftrag_sparen', 'sys_uebertrag', 'sys_zahlung_an_karte', 'sys_bargeldbezug']) {
    const hit = all.filter((x) => x.ruleId === id);
    console.log('##', id, hit.length);
    const m = new Map(); for (const x of hit) { const k = `${x.file.slice(0, 22)} | ${x.amount > 0 ? '+' : '-'} | ${x.payee.slice(0, 34)} | ${x.description.slice(0, 40)}`; m.set(k, (m.get(k) || 0) + 1); }
    for (const [k, v] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log('  ', String(v).padStart(3), k);
  }
}
if (detail === 'kategorien') {
  const m = new Map(); for (const x of all) m.set(x.categoryId, (m.get(x.categoryId) || 0) + 1);
  console.log([...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${catName[k] || k} ${v}`).join(' · '));
}
