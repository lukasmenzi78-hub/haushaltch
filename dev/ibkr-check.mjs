// Gegenprobe für den IBKR-Import: vergleicht, was der Parser liest, mit den Summen, die der
// Auszug selbst enthält (deutsche „Umsatzübersicht“). Ausgegeben werden nur Differenzen –
// überall 0.00 heisst: Positionen, Einstand, Dividenden, Quellensteuer und Barbestand stimmen.
//   node dev/ibkr-check.mjs <Ordner mit Auszügen>
import fs from 'node:fs';
import path from 'node:path';
import { parseCSV } from '../js/core/util.js';
import { parseIbkr, detectIbkr } from '../js/core/ibkr.js';
const dir = process.argv[2];
if (!dir) { console.error('Ordner mit Auszügen angeben'); process.exit(2); }
const mask = (s) => String(s).replace(/\d/g, '9');
let n = 0;
for (const f of fs.readdirSync(dir).filter((x) => /\.csv$/i.test(x)).sort()) {
  const rows = parseCSV(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (!detectIbkr(rows) || !rows.some((x) => x[0] === 'Offene Positionen')) continue;
  n++;
  const r = parseIbkr(rows);
  console.log(`===== IBKR-Auszug ${n}`);
  const tot = rows.filter((x) => x[0] === 'Offene Positionen' && x[1] === 'Total');
  console.log(' Summenzeilen:', tot.map((x) => `${x[3]}/${x[4]}/${mask(x[11]).length}`).join('  '));
  const byCur = {}; for (const h of r.holdings) byCur[h.currency] = (byCur[h.currency] || 0) + h.quantity * h.lastPrice;
  const seen = {};
  for (const x of tot) { if (!/^[A-Z]{3}$/.test(x[4]) || seen[x[4]]) continue; seen[x[4]] = 1; console.log(`  ${x[4]}: Differenz Positionen − erste Summenzeile = ${(byCur[x[4]] - Number(x[11])).toFixed(2)}`); }
  const costCheck = {}; for (const h of r.holdings) costCheck[h.currency] = (costCheck[h.currency] || 0) + h.quantity * h.avgCost;
  const seen2 = {};
  for (const x of tot) { if (!/^[A-Z]{3}$/.test(x[4]) || seen2[x[4]]) continue; seen2[x[4]] = 1; console.log(`  ${x[4]}: Differenz Einstand − Kostenbasis laut Datei = ${(costCheck[x[4]] - Number(x[9])).toFixed(2)}`); }
  for (const [sec, field] of [['Dividenden', 'amount'], ['Quellensteuer', 'withholding']]) {
    const file = {}; for (const x of rows.filter((x) => x[0] === sec && x[1] === 'Data' && /^[A-Z]{3}$/.test(x[2]))) file[x[2]] = (file[x[2]] || 0) + Number(x[5]);
    const got = {}; for (const d of r.dividends) got[d.currency] = (got[d.currency] || 0) + d[field];
    for (const c of Object.keys(file)) console.log(`  ${sec} ${c}: Differenz gelesen − Datei = ${(got[c] - Math.abs(file[c]) * (field === 'withholding' ? 1 : Math.sign(file[c]))).toFixed(2)}`);
  }
  const dep = {}; for (const x of rows.filter((x) => x[0] === 'Einzahlungen & Auszahlungen' && x[1] === 'Data' && /^[A-Z]{3}$/.test(x[2]))) dep[x[2]] = (dep[x[2]] || 0) + Number(x[5]);
  const gd = {}; for (const d of r.deposits) gd[d.currency] = (gd[d.currency] || 0) + d.amount;
  for (const c of Object.keys(dep)) console.log(`  Einzahlungen ${c}: Zeilen Datei ${rows.filter((x) => x[0] === 'Einzahlungen & Auszahlungen' && x[1] === 'Data' && x[2] === c).length}, Differenz = ${(gd[c] - dep[c]).toFixed(2)}`);
  const nav = rows.find((x) => x[0] === 'Nettovermögenswert' && x[1] === 'Data' && x[2] === 'Barmittel');
  console.log('  Barbestand: Differenz gelesen − „Barmittel“ im Nettovermögen =', (r.meta.cash - Number(nav[6])).toFixed(2));
}
