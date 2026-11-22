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
// mode 'top': ganze Anfrage abweisen; mode 'partial': wie bei Lukas beobachtet – Titel
// bis zum Limit kommen, die übrigen im selben Paket erhalten je einen 429-Eintrag
const api = { calls: [], rejected: 0, window: [], mode: 'top' };
const quoteFor = (sym) => {
  if (sym === 'NOPE') return { code: 404, status: 'error', message: `symbol ${sym} not found` };
  // So lehnt der Anbieter z. B. einen nicht abgedeckten Titel ab – darf den Abruf nicht stoppen
  if (sym === 'BADSYM') return { code: 400, status: 'error', message: '**symbol** or **figi** parameter is missing or invalid.' };
  return { symbol: sym, name: `${sym} Test`, close: String(100 + sym.length), change: '1.5', currency: sym === 'WRONGCUR' ? 'EUR' : 'USD' };
};
async function twelveData(route) {
  const url = new URL(route.request().url());
  const symbols = (url.searchParams.get('symbol') || '').split(',').filter(Boolean);
  const nowT = Date.now();
  api.window = api.window.filter((x) => nowT - x.t < WINDOW_MS);
  const used = api.window.reduce((a, x) => a + x.n, 0);
  api.calls.push({ symbols, exchange: url.searchParams.get('exchange') });
  if (used + symbols.length > LIMIT && api.mode === 'partial' && symbols.length > 1) {
    api.rejected++;
    const room = Math.max(0, LIMIT - used);
    api.window.push({ t: nowT, n: room });
    const body = Object.fromEntries(symbols.map((sym, i) => [sym, i < room ? quoteFor(sym)
      : { code: 429, status: 'error', message: 'You have run out of API credits for the current minute.' }]));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  }
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
    // steht absichtlich vor den übrigen Titeln: ein Abbruch hier würde alle folgenden verhindern
  ].concat([]).sort((a, b) => (a.symbol === 'BADSYM' ? -1 : 0)), 'Test');
  store.upsert('holdings', hold('BADSYM', 'NYSE', 'USD'), 'Test');
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
check(s.by.BADSYM.p === 50 && usUpdated === US.length, 'ein vom Anbieter abgelehnter Titel („… invalid“) stoppt den Abruf nicht');
check(s.snapshotToday, 'Tagesstand für den Depotverlauf geschrieben');
const toastText = await page.locator('#toasts').innerText().catch(() => '');
check(/ausserhalb der USA/i.test(toastText) && /ohne Ergebnis/i.test(toastText), 'Meldung nennt übersprungene und fehlgeschlagene Titel');

console.log('\n2. Limit trotzdem erreicht: die App wartet und versucht es nochmals');
api.calls.length = 0; api.rejected = 0; api.window = [];
const r2 = await page.evaluate(async (win) => {
  const q = await import('./js/core/quotes.js');
  q.PROVIDERS.twelvedata.pauseMs = 20;          // Abfragen zu schnell hintereinander …
  q.PROVIDERS.twelvedata.retryMs = win + 50;    // … aber nach einer Abweisung lange genug warten
  const res = await q.refreshQuotes({ force: true });
  return { updated: res.updated, failed: res.failed.filter((f) => !f.notCovered && !['WRONGCUR', 'NOPE', 'BADSYM'].includes(f.symbol)).map((f) => f.symbol) };
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
// Start nach 8 s, danach ein Titel alle 7,6 s (echter Takt des Gratis-Tarifs)
await page.waitForTimeout(8000 + 3 * 7600 + 2000);
for (let i = 0; i < 50 && await page.evaluate(async () => (await import('./js/core/quotes.js')).isRefreshing()); i++) await page.waitForTimeout(500);
s = await state();
const requested = api.calls.flatMap((c) => c.symbols);
check(US.slice(0, 3).every((x) => s.by[x].fresh && s.by[x].p !== 50), 'die drei veralteten Kurse wurden beim Start erneuert');
check(requested.length === 3 && !requested.includes(US[5]), `aktuelle Kurse wurden nicht nochmals abgefragt (${requested.length} Titel angefragt)`);

console.log('\n4. Einzelne Titel im Paket abgewiesen (Teil-Antwort)');
api.calls.length = 0; api.rejected = 0; api.window = []; api.mode = 'partial';
// Ein Credit ist in dieser „Minute“ schon verbraucht – wie durch „Verbindung testen“
api.window.push({ t: Date.now(), n: 1 });
const r4 = await page.evaluate(async (win) => {
  const q = await import('./js/core/quotes.js');
  q.PROVIDERS.twelvedata.batchSize = 8;        // Pakete, damit Teil-Antworten vorkommen
  q.PROVIDERS.twelvedata.pauseMs = win + 50;
  q.PROVIDERS.twelvedata.retryMs = win + 50;
  const res = await q.refreshQuotes({ force: true });
  q.PROVIDERS.twelvedata.batchSize = 1;
  return { updated: res.updated, failed: res.failed.filter((f) => !f.notCovered && !['WRONGCUR', 'NOPE', 'BADSYM'].includes(f.symbol)).map((f) => f.symbol) };
}, WINDOW_MS);
check(api.rejected > 0, `der Nachbau hat einzelne Titel abgewiesen (${api.rejected}×)`);
check(r4.updated === US.length && r4.failed.length === 0, `abgewiesene Titel wurden nachgeholt: ${r4.updated} aktualisiert, ${r4.failed.length} fehlen`);
api.mode = 'top';

console.log('\n5. App in zwei Fenstern offen');
api.calls.length = 0; api.rejected = 0; api.window = [];
const page2 = await ctx.newPage();
await page2.goto(`${base}/index.html#anlagen`);
await page2.waitForSelector('.card');
const startRun = (pg) => pg.evaluate(async (pause) => {
  const q = await import('./js/core/quotes.js');
  q.PROVIDERS.twelvedata.pauseMs = pause; q.PROVIDERS.twelvedata.retryMs = pause;
  const res = await q.refreshQuotes({ force: true });
  return { updated: res.updated, skipped: !!res.skipped, reason: res.reason || '' };
}, PAUSE_MS);
const [a, b] = await Promise.all([startRun(page), startRun(page2)]);
check([a, b].filter((x) => x.skipped).length === 1, `nur ein Fenster ruft ab, das andere meldet: „${(a.skipped ? a : b).reason}“`);
check(api.rejected === 0, `keine Abweisung durch gleichzeitige Abrufe (${api.rejected})`);
await page2.close();

console.log('\n6. Anzeige des Abrufs');
await page.evaluate(() => { location.hash = '#budget'; });
await page.waitForTimeout(200);
await page.evaluate(() => { location.hash = '#anlagen'; });
await page.waitForTimeout(400);
let txt = await page.locator('main').innerText();
check(/Letzter Kursabruf/i.test(txt), 'Anlagen zeigen den letzten Kursabruf mit Ergebnis');
const running = page.evaluate(async (pause) => {
  const q = await import('./js/core/quotes.js');
  q.PROVIDERS.twelvedata.pauseMs = 1500;
  return q.refreshQuotes({ force: true });
}, PAUSE_MS);
await page.waitForTimeout(700);
txt = await page.locator('main').innerText();
check(/Kurse werden geholt: \d+ von \d+/i.test(txt) && /offen lassen/i.test(txt), 'während des Abrufs: Fortschritt und Hinweis „App bitte offen lassen“');
await running;

check(errors.length === 0, `keine Fehler in der Konsole${errors.length ? ': ' + errors.slice(0, 2).join(' / ') : ''}`);
await browser.close(); server.close();
console.log(failed ? `\n✗ ${failed} Prüfung(en) fehlgeschlagen` : '\n✓ Alle Prüfungen bestanden');
process.exit(failed ? 1 : 0);
