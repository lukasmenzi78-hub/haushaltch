// Schnellübersicht ohne Browser: schickt jede CSV-Datei eines Ordners durch den Lesepfad
// der App und zeigt Format, Kopfzeile, Anzahl Buchungen, Zeitraum und Warnungen.
// Es werden keine Beträge und keine Buchungstexte ausgegeben.
//   node dev/probe-all.mjs <Ordner mit Auszügen>
import fs from 'node:fs';
import path from 'node:path';
import { parseCSV } from '../js/core/util.js';
import { parseSheet, detectFormat } from '../js/core/parsers.js';
import { detectIbkr, parseIbkr } from '../js/core/ibkr.js';
import { readLikeApp } from './lib.mjs';

const dir = process.argv[2];
if (!dir) { console.error('Ordner mit Auszügen angeben'); process.exit(2); }
for (const f of fs.readdirSync(dir).filter((x) => /\.csv$/i.test(x)).sort()) {
  const rows = parseCSV(readLikeApp(path.join(dir, f)));
  const label = f.replace(/\d{5,}/g, '#');
  if (detectIbkr(rows)) {
    const p = parseIbkr(rows);
    console.log(`■ ${label}\n  IBKR · Positionen ${p.holdings.length} · Dividenden ${p.dividends.length} · Barbestand ${p.meta.cash === null ? 'nein' : 'ja'} · Warnungen ${JSON.stringify(p.warnings || [])}`);
    continue;
  }
  const det = detectFormat(rows);
  const r = parseSheet(rows);
  console.log(`■ ${label}${rows.excelRewrapped ? '  (in Excel neu gespeichert)' : ''}`);
  console.log(`  ${r.format} · Kopfzeile #${det.headerRow} · Buchungen ${r.totals.count} · ${r.range ? r.range.from + ' … ' + r.range.to : 'kein Zeitraum'} · IBAN ${r.account?.iban ? 'ja' : 'nein'}`);
  if (r.warnings.length) console.log('  Warnungen:', r.warnings.map((w) => w.replace(/-?\d[\d'.,]*/g, '#')));
}
