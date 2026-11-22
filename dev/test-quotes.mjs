// Prüft den Kursabruf gegen einen Nachbau von Twelve Data – ohne echten Schlüssel.
// Der Nachbau hält das Limit des Gratis-Tarifs ein (8 Titel pro „Minute“, hier auf
// Sekundenbruchteile verkürzt) und antwortet mit 429, wenn es überschritten wird.
//
//   node dev/test-quotes.mjs [App-Ordner]
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

// ---------- Nachbau Twelve Data ----------
const WINDOW_MS = 400;          // „Minute“ des Nachbaus
const LIMIT = 8;                // Titel pro Fenster (Gratis-Tarif: 8 Credits/Minute)
const PAUSE_MS = 450;           // Pause der App zwischen Paketen im Test
const api = { calls: [], rejected: 0, window: [] };
const quoteFor = (sym) => {
  if (sym === 'NOPE') return { code: 404, status: 'error', message: `symbol ${sym} not found` };
  return { symbol: sym, name: `${sym} Test`, close: String(100 + sym.length), change: '1.5', currency: sym === 'WRONGCUR' ? 'EUR' : 'USD' };
};
async function twelveData(route) {
  const url = new URL(route.request().url());
  const symbols = (url.searchParams.get('symbol') || '').split(',').filter(Boolean);
  const nowT = Date.now();
  api.window = api.window.filter((x) => nowT - x.t < WINDOW_MS);
  const used = api.window.reduce((a, x) => a + x.n, 0);
  api.calls.push({ symbols, exchange: url.searchParams.get('exchange') });
  if (used + symbols.length > LIMIT) {
    api.rejected++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 429, status: 'error', message: `You have run out of API credits for the current minute. ${used + symbols.length} API credits were used, with the current limit being ${LIMIT}.` }) });
  }
  api.window.push({ t: nowT, n: symbols.length });
  const body = symbols.length === 1 ? quoteFor(symbols[0]) : Object.fromEntries(symbols.map((s) => [s, quoteFor(s)]));
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ serviceWorkers: 'block' });
await ctx.route('**/api.twelvedata.com/**', twelveData);
await ctx.route('**/api.frankfurter.app/**', (r) => r.fulfill({ status: 503, body: '' }));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::|frankfurter|ERR_/.test(m.text())) errors.push(m.text()); });

let failed = 0;
const check = (ok, text) => { console.log(`   ${ok ? '✓' : '✗'} ${text}`); if (!ok) failed++; };

await page.goto(`${base}/index.html#anlagen`);
await page.waitForSelector('.card', { timeout: 15000 });

// 22 US-Titel, ein Titel von der SIX, einer mit falscher Währung, einer ohne Kurs
const US = Array.from({ length: 22 }, (_, i) => `US${String.fromCharCode(65 + i)}`);
await page.evaluate(async ({ US }) => {
  const { store } = await import('./js/core/store.js');
  const { newAccount, newHolding } = await import('./js/core/model.js');
  const acc = newAccount({ name: 'Testdepot', type: 'depot', balanceMode: 'holdings', currency: 'USD' });
  store.upsert('accounts', acc, 'Test');
  const old = Date.now() - 3 * 86400000;
  const hold = (symbol, exchange, currency) => newHolding({ accountId: acc.id, symbol, exchange, currency, quantity: 10, avgCost: 50, lastPrice: 50, lastPriceAt: old, priceSource: 'IBKR-Auszug' });
  store.upsertMany('holdings', [
    ...US.map((s) => hold(s, 'ARCA', 'USD')),
    hold('UHRN', 'EBS', 'CHF'),
    hold('WRONGCUR', 'NYSE', 'USD'),
    hold('NOPE', 'NASDAQ', 'USD'),
  ], 'Test');
  localStorage.setItem('swissfin.quoteKey', 'test-key-nur-fuer-den-nachbau');
  localStorage.setItem('swissfin.quoteProvider', 'twelvedata');
}, { US });

console.log('\n1. Manueller Abruf über den Knopf');
await page.evaluate(async (pause) => { (await import('./js/core/quotes.js')).PROVIDERS.twelvedata.pauseMs = pause; }, PAUSE_MS);
await page.evaluate(() => { location.hash = '#budget'; });
await page.waitForTimeout(200);
await page.evaluate(() => { location.hash = '#anlagen'; });
await page.getByRole('button', { name: /Kurse aktualisieren/ }).click();
// waitForFunction taugt hier nicht: eine async-Funktion liefert sofort ein (wahres) Promise
await page.waitForTimeout(300);
for (let i = 0; i < 150 && await page.evaluate(async () => (await import('./js/core/quotes.js')).isRefreshing()); i++) await page.waitForTimeout(200);
const state = () => page.evaluate(async () => {
  const { store } = await import('./js/core/store.js');
  const by = Object.fromEntries(store.idx.holdings.map((h) => [h.symbol, { p: h.lastPrice, src: h.priceSource, fresh: Date.now() - (h.lastPriceAt || 0) < 60000 }]));
  return { by, snapshotToday: (store.doc.snapshots || []).some((s) => !s.deleted && s.date === new Date().toISOString().slice(0, 10)) };
});
let s = await state();
const usUpdated = US.filter((x) => s.by[x].fresh && s.by[x].src === 'Twelve Data').length;
check(usUpdated === US.length, `alle ${US.length} US-Titel aktualisiert (${usUpdated})`);
check(api.rejected === 0, `Minutenlimit eingehalten – keine 429 vom Anbieter (${api.rejected})`);
check(api.calls.every((c) => c.symbols.length <= LIMIT), `höchstens ${LIMIT} Titel pro Anfrage (${api.calls.length} Anfragen)`);
check(!api.calls.some((c) => c.symbols.includes('UHRN')), 'SIX-Titel wird im Gratis-Tarif gar nicht erst angefragt');
check(s.by.UHRN.p === 50 && s.by.UHRN.src === 'IBKR-Auszug', 'SIX-Titel behält den Kurs aus dem IBKR-Auszug');
check(s.by.WRONGCUR.p === 50, 'Kurs in fremder Währung wird nicht übernommen');
check(s.by.NOPE.p === 50, 'Titel ohne Kurs bleibt unverändert');
check(s.snapshotToday, 'Tagesstand für den Depotverlauf geschrieben');
const toastText = await page.locator('#toasts').innerText().catch(() => '');
check(/ausserhalb der USA/i.test(toastText) && /ohne Ergebnis/i.test(toastText), 'Meldung nennt übersprungene und fehlgeschlagene Titel');

console.log('\n2. Limit trotzdem erreicht: die App wartet und versucht es nochmals');
api.calls.length = 0; api.rejected = 0; api.window = [];
const r2 = await page.evaluate(async (win) => {
  const q = await import('./js/core/quotes.js');
  q.PROVIDERS.twelvedata.pauseMs = 60;          // Pakete zu schnell hintereinander …
  q.PROVIDERS.twelvedata.retryMs = win + 50;    // … aber nach einer Abweisung lange genug warten
  const res = await q.refreshQuotes({ force: true });
  return { updated: res.updated, failed: res.failed.filter((f) => !f.notCovered && !['WRONGCUR', 'NOPE'].includes(f.symbol)).map((f) => f.symbol) };
}, WINDOW_MS);
check(api.rejected > 0, `der Nachbau hat abgewiesen (${api.rejected}×)`);
check(r2.updated === US.length && r2.failed.length === 0, `trotzdem alle US-Titel aktualisiert (${r2.updated})`);

console.log('\n3. Täglicher Abruf beim Start');
await page.evaluate(async (US) => {
  const { store } = await import('./js/core/store.js');
  const keepOld = new Set(US.slice(0, 3));
  const old = Date.now() - 2 * 86400000;
  store.upsertMany('holdings', store.idx.holdings.map((h) => ({ ...h, lastPrice: 50, lastPriceAt: keepOld.has(h.symbol) ? old : Date.now() })), 'Test');
  await store.persist();
}, US);
api.calls.length = 0;
await page.reload();
await page.waitForSelector('.card');
await page.waitForTimeout(11000);
s = await state();
const requested = api.calls.flatMap((c) => c.symbols);
check(US.slice(0, 3).every((x) => s.by[x].fresh && s.by[x].p !== 50), 'die drei veralteten Kurse wurden beim Start erneuert');
check(requested.length === 3 && !requested.includes(US[5]), `aktuelle Kurse wurden nicht nochmals abgefragt (${requested.length} Titel angefragt)`);

check(errors.length === 0, `keine Fehler in der Konsole${errors.length ? ': ' + errors.slice(0, 2).join(' / ') : ''}`);
await browser.close(); server.close();
console.log(failed ? `\n✗ ${failed} Prüfung(en) fehlgeschlagen` : '\n✓ Alle Prüfungen bestanden');
process.exit(failed ? 1 : 0);
