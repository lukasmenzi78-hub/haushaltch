// End-zu-End-Prüfung: importiert echte Auszüge über die Oberfläche der App (Datei-Eingabe,
// Assistent, „Importieren“) in einem frischen Browserprofil und wertet danach den Bestand aus.
//   node dev/test-import.mjs <Ordner mit Auszügen>
// Es werden nur Stückzahlen und Kontrollsummen ausgegeben, keine Beträge.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, '..');
const dir = process.argv[2];
if (!dir) { console.error('Ordner mit Auszügen angeben'); process.exit(2); }
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = path.join(appDir, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(appDir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const base = `http://localhost:${server.address().port}`;

const want = (f) => /\.(csv|xlsx)$/i.test(f) && !f.startsWith('export_');
const rank = (f) => (/PC /.test(f) ? 0 : /Checking|Savings/.test(f) ? 1 : /IBRK|IBKR/i.test(f) ? 3 : 2);
const files = fs.readdirSync(dir).filter(want).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
const page = await (await browser.newContext({ serviceWorkers: 'block' })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::|frankfurter|ERR_/.test(m.text())) errors.push('console: ' + m.text()); });
await page.goto(`${base}/index.html#import`);
await page.waitForSelector('.dropzone', { timeout: 15000 });

let failed = 0;
const check = (ok, label) => { console.log(`   ${ok ? '✓' : '✗'} ${label}`); if (!ok) failed++; };

async function importFile(f) {
  await page.locator('.dropzone input[type=file]').setInputFiles(path.join(dir, f));
  const dlg = page.locator('dialog[open]').last();
  await dlg.waitFor({ timeout: 15000 });
  const badges = (await dlg.locator('.badge').allTextContents()).map((b) => b.replace(/\d{6,}/g, '#').trim());
  const warn = (await dlg.locator('p.small').allTextContents()).filter((t) => t.startsWith('⚠')).map((t) => t.replace(/-?\d[\d'.,]*/g, '#'));
  const btn = dlg.getByRole('button', { name: /^(Importieren|Übernehmen)$/ });
  const mapping = (await btn.count()) === 0;
  if (mapping) { await dlg.getByRole('button', { name: 'Abbrechen' }).click(); return { badges, warn, mapping }; }
  await btn.click();
  await page.locator('dialog[open]').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  return { badges, warn, mapping };
}

console.log(`\n${files.length} Dateien`);
for (const f of files) {
  const r = await importFile(f);
  console.log(` ${f}`);
  console.log(`     ${r.mapping ? 'NICHT ERKANNT – Spaltenzuordnung verlangt' : r.badges.slice(0, 4).join(' | ')}`);
  for (const w of r.warn) console.log(`     ${w.slice(0, 110)}`);
  if (r.mapping) failed++;
}

const summary = () => page.evaluate(async () => {
  const { store } = await import('./js/core/store.js');
  const tx = store.idx.transactions;
  const cat = (id) => store.idx.categories.find((c) => c.id === id)?.name || id;
  const acc = store.idx.accounts.map((a) => {
    const t = tx.filter((x) => x.accountId === a.id);
    return {
      name: a.name.replace(/\d{4,}/g, '#'), type: a.type, iban: !!a.iban, n: t.length,
      transfers: t.filter((x) => x.isTransfer).length, linked: t.filter((x) => x.transferPairId).length,
      open: t.filter((x) => x.categoryId === 'c_unkategorisiert').length,
      holdings: store.idx.allHoldings.filter((h) => h.accountId === a.id && !h.archived).length,
      cash: !!a.cashBalance,
    };
  });
  const income = {};
  for (const x of tx.filter((x) => x.amount > 0 && !x.isTransfer)) income[cat(x.categoryId)] = (income[cat(x.categoryId)] || 0) + 1;
  const pairs = tx.filter((x) => x.transferPairId);
  const broken = pairs.filter((x) => { const m = tx.find((y) => y.id === x.transferPairId); return !m || m.transferPairId !== x.id || Math.abs(m.amount + x.amount) > 0.005 || m.accountId === x.accountId; }).length;
  // Lohn darf nur dort stehen, wo er wirklich eingeht – nicht nochmals beim Weiterleiten
  const lohnByAccount = {};
  for (const x of tx.filter((x) => x.categoryId === 'c_lohn' && !x.isTransfer)) { const n = store.account(x.accountId)?.name.replace(/\d{4,}/g, '#'); lohnByAccount[n] = (lohnByAccount[n] || 0) + 1; }
  const transferSum = Math.round(100 * pairs.reduce((s, x) => s + x.amount, 0)) / 100;
  return {
    acc, total: tx.length, income, broken, lohnByAccount, transferSum,
    dividends: store.idx.dividends.length, divWithAccount: store.idx.dividends.filter((d) => d.accountId).length,
    rules: store.idx.rules.length, retired: store.idx.rules.filter((r) => ['sys_gutschrift_gross', 'sys_dauerauftrag_sparen'].includes(r.id)).length,
  };
});

const s1 = await summary();
console.log('\nKonten nach dem Import');
for (const a of s1.acc) console.log(`   ${a.name.padEnd(38)} ${a.type.padEnd(11)} ${String(a.n).padStart(4)} Buchungen · ${String(a.transfers).padStart(3)} Überträge (${a.linked} verknüpft) · ${a.open} offen${a.holdings ? ` · ${a.holdings} Positionen${a.cash ? ' + Barbestand' : ''}` : ''}${a.iban ? ' · IBAN' : ''}`);
console.log('   Einnahmen (ohne Überträge) nach Kategorie:', JSON.stringify(s1.income));
console.log('   Lohn-Buchungen je Konto:', JSON.stringify(s1.lohnByAccount));
console.log(`   Dividenden: ${s1.dividends} (davon mit Depot: ${s1.divWithAccount})`);

console.log('\nPrüfungen');
check(s1.total > 0, `Buchungen importiert (${s1.total})`);
check(s1.broken === 0, 'jede Verknüpfung hat eine Gegenbuchung mit umgekehrtem Betrag auf einem anderen Konto');
check(s1.transferSum === 0, 'verknüpfte Überträge heben sich auf');
check(Object.keys(s1.lohnByAccount).length <= 1, 'Lohn wird nur auf einem Konto als Einkommen gezählt');
check(s1.retired === 0, 'zurückgezogene Regeln sind nicht im Bestand');
check(s1.acc.filter((a) => a.type === 'depot').length === files.filter((f) => /IBRK|IBKR/i.test(f)).length, 'je IBKR-Konto ein eigenes Depot');
check(s1.acc.filter((a) => a.type === 'depot').every((a) => a.holdings > 0 && a.cash), 'jedes Depot hat Positionen und Barbestand');
check(s1.dividends === s1.divWithAccount, 'jede Dividende gehört zu einem Depot');

// Zweiter Durchlauf: dieselben Dateien dürfen nichts hinzufügen
for (const f of files) await importFile(f);
const s2 = await summary();
check(s2.total === s1.total, `erneuter Import derselben Dateien fügt keine Buchung hinzu (${s2.total})`);
check(s2.dividends === s1.dividends, 'erneuter Import fügt keine Dividende hinzu');
check(JSON.stringify(s2.acc.map((a) => [a.n, a.transfers, a.linked, a.holdings])) === JSON.stringify(s1.acc.map((a) => [a.n, a.transfers, a.linked, a.holdings])), 'Konten, Überträge und Positionen unverändert');
check(errors.length === 0, `keine Fehler in der Konsole${errors.length ? ': ' + errors.slice(0, 3).join(' / ') : ''}`);

await browser.close(); server.close();
console.log(failed ? `\n✗ ${failed} Prüfung(en) fehlgeschlagen` : '\n✓ Alle Prüfungen bestanden');
process.exit(failed ? 1 : 0);
