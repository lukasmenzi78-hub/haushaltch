// Prüft die OneDrive-Synchronisation mit zwei Geräten – ohne echtes Microsoft-Konto.
// Zwei getrennte Browserprofile spielen zwei Geräte; Microsoft Graph wird durch einen
// kleinen OneDrive-Nachbau ersetzt, der eTags vergibt und „if-match“ wie das Original
// prüft (412 bei veraltetem Stand). Die Anmeldung (MSAL) wird durch eine Attrappe ersetzt.
//
//   node dev/test-sync.mjs <Ordner mit Auszügen> [App-Ordner]
//
// Aus dem Ordner werden die drei kleinsten Konto- oder Kartenauszüge verwendet.
// Ausgegeben werden nur Stückzahlen.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2];
const appDir = path.resolve(process.argv[3] || path.join(here, '..'));
if (!dir) { console.error('Ordner mit Auszügen angeben'); process.exit(2); }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = path.join(appDir, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(appDir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const base = `http://localhost:${server.address().port}`;

/* ---------- OneDrive-Nachbau ---------- */
const drive = { file: null, puts: 0, rejected: 0 };
const metaOf = (f) => ({ id: f.id, name: f.name, eTag: `"{F00D-${f.id}},${f.version}"`, size: f.content.length, parentReference: { driveId: 'd1' } });
async function graphRoute(route) {
  const req = route.request();
  const url = new URL(req.url());
  const p = decodeURIComponent(url.pathname.replace(/^\/v1\.0/, ''));
  const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const byPath = p.match(/^\/me\/drive\/root:\/(.+?)(:\/content)?$/);
  const byItem = p.match(/^\/drives\/d1\/items\/([^/]+)(\/content)?$/);
  const method = req.method();
  if (byPath && method === 'GET' && !byPath[2]) return drive.file ? json(200, metaOf(drive.file)) : json(404, { error: { code: 'itemNotFound' } });
  if (byPath && method === 'PUT' && byPath[2]) {
    drive.puts++;
    drive.file = drive.file
      ? { ...drive.file, content: req.postData(), version: drive.file.version + 1 }
      : { id: 'i1', name: byPath[1].split('/').pop(), content: req.postData(), version: 1 };
    return json(drive.file.version === 1 ? 201 : 200, metaOf(drive.file));
  }
  if (byItem && drive.file && byItem[1] === drive.file.id) {
    if (method === 'GET' && !byItem[2]) return json(200, metaOf(drive.file));
    if (method === 'GET' && byItem[2]) return route.fulfill({ status: 200, contentType: 'application/json', body: drive.file.content });
    if (method === 'PUT' && byItem[2]) {
      const ifMatch = req.headers()['if-match'];
      if (ifMatch && ifMatch !== metaOf(drive.file).eTag) { drive.rejected++; return json(412, { error: { code: 'resourceModified' } }); }
      drive.puts++;
      drive.file = { ...drive.file, content: req.postData(), version: drive.file.version + 1 };
      return json(200, metaOf(drive.file));
    }
  }
  return json(404, { error: { code: 'notMocked', message: `${method} ${p}` } });
}

const MSAL_STUB = `window.msal = { PublicClientApplication: class {
  async initialize() {} async handleRedirectPromise() { return null; }
  getAllAccounts() { return [{ username: 'test@example.ch', name: 'Test' }]; }
  setActiveAccount() {}
  async acquireTokenSilent() { return { accessToken: 't' }; }
  async acquireTokenPopup() { return { accessToken: 't' }; }
  async loginPopup() { return { account: { username: 'test@example.ch', name: 'Test' } }; }
  async loginRedirect() {} async logoutPopup() {}
} };`;

/* ---------- Geräte ---------- */
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
const errors = [];
async function device(label) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await ctx.route('https://graph.microsoft.com/**', graphRoute);
  await ctx.route('**/vendor/msal-browser.min.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: MSAL_STUB }));
  await ctx.route('**/api.frankfurter.app/**', (r) => r.fulfill({ status: 503, body: '' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.goto(`${base}/index.html#import`);
  await page.waitForSelector('.dropzone', { timeout: 15000 });
  return { label, page };
}
async function importFile(d, file) {
  await d.page.locator('.dropzone input[type=file]').setInputFiles(path.join(dir, file));
  const dlg = d.page.locator('dialog[open]').last();
  await dlg.waitFor({ timeout: 15000 });
  await dlg.getByRole('button', { name: /^(Importieren|Übernehmen)$/ }).click();
  await d.page.locator('dialog[open]').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
}
const connect = async (d) => {
  await d.page.evaluate(() => localStorage.setItem('swissfin.clientId', '00000000-0000-0000-0000-000000000001'));
  await d.page.reload(); await d.page.waitForSelector('.dropzone');
  await settle(d);
};
/** Wartet, bis keine Synchronisation mehr läuft und nichts mehr hochzuladen ist. */
async function settle(d, rounds = 3) {
  for (let i = 0; i < rounds; i++) {
    await d.page.evaluate(async () => {
      const sync = await import('./js/core/sync.js');
      const { store } = await import('./js/core/store.js');
      for (let k = 0; k < 50 && sync.syncState.busy; k++) await new Promise((r) => setTimeout(r, 100));
      await sync.syncNow().catch((e) => console.warn(e.message));
      if (store.meta.dirty) await sync.push().catch((e) => console.warn(e.message));
    });
  }
}
const idsOn = (d) => d.page.evaluate(async () => {
  const { store } = await import('./js/core/store.js');
  return store.idx.transactions.map((t) => t.id).sort();
});
const remoteIds = () => (drive.file ? JSON.parse(drive.file.content).transactions.filter((t) => !t.deleted).map((t) => t.id).sort() : []);
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

let failed = 0;
const check = (ok, text) => { console.log(`   ${ok ? '✓' : '✗'} ${text}`); if (!ok) failed++; };

const files = fs.readdirSync(dir)
  .filter((f) => /\.csv$/i.test(f) && !/ibrk|ibkr|^u\d/i.test(f) && !f.startsWith('export_'))
  .map((f) => ({ f, size: fs.statSync(path.join(dir, f)).size }))
  .sort((a, b) => a.size - b.size).slice(0, 3).map((x) => x.f);
if (files.length < 3) { console.error('Es braucht mindestens drei Auszüge im Ordner'); process.exit(2); }

console.log(`App: ${path.relative(process.cwd(), appDir) || '.'}`);

// 1) Gerät B ist zuerst verbunden und legt die Datei mit seinen Daten an
const B = await device('B');
await connect(B);
await importFile(B, files[0]);
await settle(B);
const nB = (await idsOn(B)).length;

// 2) Gerät A hat schon lokale Daten und verbindet sich danach mit derselben Datei
const A = await device('A');
await importFile(A, files[1]);
const nA = (await idsOn(A)).length;
await connect(A);
await settle(B);
console.log(`\n1. Zweites Gerät mit eigenen Daten verbindet sich (B ${nB}, A ${nA} Buchungen)`);
check(same(remoteIds(), [...new Set([...(await idsOn(B)), ...(await idsOn(A))])].sort()) && remoteIds().length === nA + nB,
  `OneDrive enthält beide Bestände (${remoteIds().length} von ${nA + nB})`);
check(same(await idsOn(A), remoteIds()), 'Gerät A hat den vollständigen Stand');
check(same(await idsOn(B), remoteIds()), 'Gerät B hat den vollständigen Stand');

// 3) A importiert weiter, B holt die Änderung ab
await importFile(A, files[2]);
await settle(A);
await settle(B);
console.log('\n2. Änderung auf einem Gerät kommt auf dem anderen an');
check(same(await idsOn(B), remoteIds()) && same(await idsOn(A), remoteIds()), `beide Geräte gleich (${remoteIds().length} Buchungen)`);

// 4) Beide ändern gleichzeitig, ohne vom anderen zu wissen
// A ändert jeweils die erste, B die letzte noch unbeschriftete Buchung – zwei verschiedene
// Datensätze. Ändern beide denselben, gewinnt bewusst der jüngere Stand.
const edit = (d, note) => d.page.evaluate(async (n) => {
  const { store } = await import('./js/core/store.js');
  const free = store.idx.transactions.filter((x) => !x.notes).sort((a, b) => (a.id < b.id ? -1 : 1));
  const t = (n.endsWith('B') ? free[free.length - 1] : free[0]) || store.idx.transactions[0];
  store.patch('transactions', t.id, { notes: n }, 'Notiz');
  return t.id;
}, note);
const ta = await edit(A, 'von A');
const tb = await edit(B, 'von B');
await settle(A);
await settle(B);
await settle(A);
const notes = JSON.parse(drive.file.content).transactions.filter((t) => t.notes).map((t) => t.notes);
console.log('\n3. Gleichzeitige Änderungen auf beiden Geräten');
check(ta !== tb && notes.includes('von A') && notes.includes('von B'), `keine Änderung geht verloren (${notes.length} Notizen in OneDrive)`);
check(same(await idsOn(A), remoteIds()) && same(await idsOn(B), remoteIds()), 'beide Geräte danach gleich');

// 5) Upload mit veraltetem Stand: B lädt hoch, ohne vorher zu holen
const rejectedBefore = drive.rejected;
await edit(A, 'zweite von A');
await settle(A, 1);
await edit(B, 'zweite von B');
await B.page.evaluate(async () => { const sync = await import('./js/core/sync.js'); await sync.push(); });
await settle(A);
const notes2 = JSON.parse(drive.file.content).transactions.filter((t) => t.notes).map((t) => t.notes);
console.log('\n4. Upload mit veraltetem Stand');
check(drive.rejected > rejectedBefore, 'OneDrive weist den veralteten Upload ab (412)');
check(notes2.includes('zweite von A') && notes2.includes('zweite von B'), 'nach dem Zusammenführen sind beide Änderungen in OneDrive');
check(same(await idsOn(A), remoteIds()) && same(await idsOn(B), remoteIds()), 'beide Geräte danach gleich');

console.log(`\nOneDrive-Nachbau: ${drive.puts} Uploads, ${drive.rejected} wegen veraltetem Stand abgewiesen`);
check(errors.length === 0, `keine Fehler in der Konsole${errors.length ? ': ' + errors.slice(0, 2).join(' / ') : ''}`);
await browser.close(); server.close();
console.log(failed ? `\n✗ ${failed} Prüfung(en) fehlgeschlagen` : '\n✓ Alle Prüfungen bestanden');
process.exit(failed ? 1 : 0);
