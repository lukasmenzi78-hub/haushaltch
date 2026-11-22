// Prüft die beiden Budgetmethoden mit festen Zahlen – ohne echte Kontoauszüge.
// Ein frisches Browserprofil, ein Konto, ein paar Buchungen und Budgets im laufenden
// Monat; danach Rechenlogik und Oberfläche (Budget, Übersicht, Einstellungen).
//
//   node dev/test-budget.mjs [App-Ordner]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(process.argv[2] || path.join(here, '..'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = path.join(appDir, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(appDir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ serviceWorkers: 'block' });
await ctx.route('**/api.frankfurter.app/**', (r) => r.fulfill({ status: 503, body: '' }));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::|frankfurter|ERR_/.test(m.text())) errors.push(m.text()); });

let failed = 0;
const check = (ok, text) => { console.log(`   ${ok ? '✓' : '✗'} ${text}`); if (!ok) failed++; };
const go = async (hash) => {
  await page.evaluate((x) => { location.hash = x; }, hash);
  await page.waitForTimeout(400);
};

await page.goto(`${base}/index.html#budget`);
await page.waitForSelector('.card', { timeout: 15000 });

// Ausgangslage: Einkommen 10'000; verteilt 3'000 Fix + 1'000 Rückstellung + 2'000 Sparen
// + 1'500 Lebensmittel + 500 Restaurants = 8'000. Restaurants mit Restbudget-Übertrag:
// im Vormonat 500 budgetiert, 200 ausgegeben → 300 Übertrag.
await page.evaluate(async () => {
  const { store } = await import('./js/core/store.js');
  const { newAccount, newTransaction } = await import('./js/core/model.js');
  const { setBudget } = await import('./js/core/budget.js');
  const { currentMonthKey, addMonths } = await import('./js/core/util.js');
  const p = currentMonthKey();
  const prev = addMonths(p, -1);
  // Mitgelieferte Jahresbeträge (z. B. Serafe) ausschalten, damit die Summen glatt sind
  for (const c of store.idx.categories.filter((x) => x.annualAmount)) store.patch('categories', c.id, { annualAmount: null }, 'Test');
  const acc = newAccount({ name: 'Testkonto' });
  store.upsert('accounts', acc, 'Test');
  store.patch('categories', 'c_restaurant', { rollover: true }, 'Test');
  for (const [cat, amount] of [['c_lohn', 10000], ['c_miete', 3000], ['c_steuern_kanton', 1000], ['c_sparen', 2000], ['c_lebensmittel', 1500], ['c_restaurant', 500]]) setBudget(p, cat, amount);
  setBudget(prev, 'c_restaurant', 500);
  store.upsertMany('transactions', [
    newTransaction({ accountId: acc.id, date: `${prev}-10`, amount: -200, payee: 'Restaurant Vormonat', categoryId: 'c_restaurant' }),
    newTransaction({ accountId: acc.id, date: `${p}-01`, amount: -300, payee: 'Lebensmittel', categoryId: 'c_lebensmittel' }),
  ], 'Test');
});

const overview = (method) => page.evaluate(async (m) => {
  const { monthOverview } = await import('./js/core/budget.js');
  const { currentMonthKey } = await import('./js/core/util.js');
  const o = monthOverview(currentMonthKey(), { method: m });
  return { method: o.method, toAssign: o.zeroBased.toAssign, assigned: o.zeroBased.assigned, income: o.zeroBased.income, balanced: o.zeroBased.balanced, pool: o.flex.pool, remaining: o.flex.remaining, left: o.summary.leftToBudget };
}, method);

console.log('\n1. Rechenlogik');
const zero = await overview('zero');
const flex = await overview('flex');
check(zero.income === 10000 && zero.assigned === 8000, `verteilt: ${zero.assigned} von ${zero.income}`);
check(zero.toAssign === 2000 && zero.left === 2000 && !zero.balanced, `nullbasiert: noch zu verteilen ${zero.toAssign}`);
check(zero.pool === 2300 && zero.remaining === 2000, `nullbasiert: flexible Kategorien = Budgets 2000 + Übertrag 300 → ${zero.pool}, übrig ${zero.remaining}`);
check(flex.pool === 4000 && flex.left === 0, `Flex-Methode unverändert: Topf ${flex.pool}, nicht zugewiesen ${flex.left}`);
const def = await page.evaluate(async () => (await import('./js/core/budget.js')).budgetMethod());
check(def === 'flex', `ohne Einstellung gilt weiterhin Flex (${def})`);

console.log('\n2. Ansicht nullbasiert');
await page.evaluate(async () => { const { store } = await import('./js/core/store.js'); store.setSettings({ budgetMethod: 'zero' }); });
await go('#uebersicht'); await go('#budget');
let text = await page.locator('main').innerText();
check(/Nullbasiertes Budget/i.test(text) && /Noch zu verteilen/i.test(text), 'Karte „Nullbasiertes Budget“ mit „Noch zu verteilen“');
check(!/Flexibler Topf/i.test(text), 'kein Flex-Topf mehr in der Budget-Ansicht');
check(/haben noch keine Aufgabe/i.test(text), 'Hinweis auf den unverteilten Rest');
await page.locator('main select').filter({ has: page.locator('option[value="c_sparen"]') }).first().selectOption('c_sparen');
await page.getByRole('button', { name: 'Ausgleichen' }).click();
await page.waitForTimeout(400);
let after = await overview('zero');
const sparen = await page.evaluate(async () => { const { budgetAmount } = await import('./js/core/budget.js'); const { currentMonthKey } = await import('./js/core/util.js'); return budgetAmount(currentMonthKey(), 'c_sparen'); });
check(after.balanced && sparen === 4000, `„Ausgleichen“ an Sparen: Sparen ${sparen}, noch zu verteilen ${after.toAssign}`);
text = await page.locator('main').innerText();
check(/Ausgeglichen/i.test(text), 'Ansicht meldet „Ausgeglichen“');

console.log('\n3. Mehr verteilt als geplant');
await page.evaluate(async () => { const { setBudget } = await import('./js/core/budget.js'); const { currentMonthKey } = await import('./js/core/util.js'); setBudget(currentMonthKey(), 'c_restaurant', 2500); });
await go('#uebersicht');
text = await page.locator('main').innerText();
check(/Noch zu verteilen/i.test(text) && /mehr verteilt als geplant/i.test(text), 'Übersicht zeigt den Überhang an');
await go('#budget');
await page.locator('main select').filter({ has: page.locator('option[value="c_lebensmittel"]') }).first().selectOption('c_lebensmittel');
await page.getByRole('button', { name: 'Ausgleichen' }).click();
await page.waitForTimeout(400);
after = await overview('zero');
const food = await page.evaluate(async () => { const { budgetAmount } = await import('./js/core/budget.js'); const { currentMonthKey } = await import('./js/core/util.js'); return budgetAmount(currentMonthKey(), 'c_lebensmittel'); });
check(food === 0 && after.toAssign === -500, `Abziehen geht nicht unter 0: Lebensmittel ${food}, Rest ${after.toAssign}`);

console.log('\n4. Umschalten in den Einstellungen');
await go('#einstellungen');
const methodSel = page.locator('main select').filter({ has: page.locator('option[value="flex"]') }).first();
check(await methodSel.inputValue() === 'zero', 'Einstellung „Budgetmethode“ steht auf Nullbasiert');
await methodSel.selectOption('flex');
await go('#budget');
text = await page.locator('main').innerText();
check(/Flexibler Topf/i.test(text) && !/Nullbasiertes Budget/i.test(text), 'nach dem Umschalten wieder Flex-Topf');

check(errors.length === 0, `keine Fehler in der Konsole${errors.length ? ': ' + errors.slice(0, 2).join(' / ') : ''}`);
await browser.close(); server.close();
console.log(failed ? `\n✗ ${failed} Prüfung(en) fehlgeschlagen` : '\n✓ Alle Prüfungen bestanden');
process.exit(failed ? 1 : 0);
