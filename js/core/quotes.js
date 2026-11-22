// quotes.js — Kursabruf für Wertschriften.
// Beide Anbieter erlauben Aufrufe direkt aus dem Browser und haben einen Gratis-Tarif.
// Der Schlüssel gehört dem Nutzer und liegt nur lokal im Gerät.
import { store } from './store.js';
import { writeSnapshot } from './investments.js';
import { now, todayISO, round2 } from './util.js';

const LS_PROVIDER = 'swissfin.quoteProvider';
const LS_KEY = 'swissfin.quoteKey';

function rateLimited(message) { const e = new Error(message); e.rateLimited = true; return e; }
const isKeyError = (msg) => /api ?key|apikey|\b401\b|unauthori[sz]ed|token/i.test(String(msg || ''));

/**
 * Börsenkürzel aus dem IBKR-Auszug, die zu den US-Börsen gehören. Nur diese decken die
 * Gratis-Tarife der Anbieter ab. Ein Titel von der SIX (IBKR: „EBS“) würde ohne
 * Börsenangabe sonst womöglich auf ein gleichnamiges US-Papier treffen.
 */
const US_EXCHANGES = new Set(['NASDAQ', 'NMS', 'NYSE', 'ARCA', 'NYSEARCA', 'BATS', 'BYX', 'CBOE', 'AMEX',
  'NYSEAMERICAN', 'NYSEMKT', 'IEX', 'ISLAND', 'PINK', 'OTC', 'OTCM', 'PSE']);
const EXCHANGE_LABELS = { EBS: 'SIX', SWX: 'SIX', VIRTX: 'SIX', IBIS: 'Xetra', FWB: 'Frankfurt', LSE: 'London', SBF: 'Euronext Paris', AEB: 'Euronext Amsterdam' };
export function isUsListing(h) {
  if (String(h.symbol || '').includes(':')) return false;
  const ex = String(h.exchange || '').toUpperCase();
  return !ex || US_EXCHANGES.has(ex);
}

export const PROVIDERS = {
  twelvedata: {
    id: 'twelvedata',
    label: 'Twelve Data',
    signup: 'https://twelvedata.com/pricing',
    hint: 'Gratis-Tarif: 8 Titel pro Minute, 800 pro Tag, nur US-Börsen. SIX und andere Börsen erst ab einem bezahlten Tarif.',
    // Gratis-Tarif: 8 Credits pro Minute, 1 Credit je Titel. Einzeln abfragen, alle 7,6 s:
    // gleicher Durchsatz wie Pakete à 8 pro Minute, aber ein Titel, den der Anbieter
    // ablehnt, reisst nicht das ganze Paket mit.
    batchSize: 1,
    pauseMs: 7600,
    retryMs: 61000,
    freeUsOnly: true,
    async fetchQuotes(symbols, key, { exchange = null } = {}) {
      const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols.join(','))}`
        + `${exchange ? `&exchange=${encodeURIComponent(exchange)}` : ''}&apikey=${encodeURIComponent(key)}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (res.status === 429) throw rateLimited('Twelve Data: Minutenlimit erreicht');
      if (!res.ok) throw new Error(`Twelve Data antwortet mit ${res.status}`);
      const data = await res.json();
      if (data.status === 'error') {
        if (data.code === 429 || /credits|limit/i.test(data.message || '')) throw rateLimited(data.message || 'Twelve Data: Minutenlimit erreicht');
        throw new Error(data.message || 'Twelve Data meldet einen Fehler');
      }
      const list = symbols.length === 1 ? { [symbols[0]]: data } : data;
      const out = {};
      // In einem Paket kann Twelve Data einzelne Titel abweisen (Minutenlimit, Tarif) –
      // die übrigen kommen trotzdem. Abgewiesene merken, statt sie still zu verlieren.
      const limited = [];
      const errors = {};
      for (const [sym, q] of Object.entries(list)) {
        if (q && q.status === 'error') {
          if (q.code === 429 || /credits|limit/i.test(q.message || '')) limited.push(sym.toUpperCase());
          else errors[sym.toUpperCase()] = q.message || 'Fehler beim Anbieter';
          continue;
        }
        if (!q) continue;
        const price = Number(q.close ?? q.price);
        if (!isFinite(price) || price <= 0) continue;
        out[sym.toUpperCase()] = {
          price,
          change: isFinite(Number(q.change)) ? Number(q.change) : null,
          currency: q.currency || null,
          name: q.name || null,
        };
      }
      Object.defineProperty(out, 'limited', { value: limited });
      Object.defineProperty(out, 'errors', { value: errors });
      return out;
    },
  },
  finnhub: {
    id: 'finnhub',
    label: 'Finnhub',
    signup: 'https://finnhub.io/register',
    hint: 'Gratis 60 Abfragen pro Minute. US-Titel zuverlässig; europäische Börsen nur teilweise.',
    batchSize: 1,
    pauseMs: 1100,
    freeUsOnly: true,
    async fetchQuotes(symbols, key) {
      const out = {};
      for (const sym of symbols) {
        const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(key)}`, { cache: 'no-store' });
        if (res.status === 429) throw rateLimited('Finnhub: Minutenlimit erreicht');
        if (!res.ok) throw new Error(`Finnhub antwortet mit ${res.status}`);
        const q = await res.json();
        if (!q || !isFinite(q.c) || q.c <= 0) continue;
        out[sym.toUpperCase()] = { price: Number(q.c), change: isFinite(q.d) ? Number(q.d) : null, currency: null, name: null };
      }
      return out;
    },
  },
};

export function getProvider() { return localStorage.getItem(LS_PROVIDER) || 'twelvedata'; }
export function setProvider(id) { localStorage.setItem(LS_PROVIDER, id); }
export function getKey() { return localStorage.getItem(LS_KEY) || ''; }
export function setKey(k) { localStorage.setItem(LS_KEY, (k || '').trim()); }
export function isConfigured() { return !!getKey(); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ab diesem Alter gilt ein Kurs als veraltet und wird beim täglichen Abruf erneuert. */
export const STALE_MS = 20 * 3600 * 1000;
let running = null;
export function isRefreshing() { return !!running; }

/**
 * Holt Kurse für alle Positionen mit Symbol.
 *  - force = false (täglicher Abruf): nur Positionen, deren Kurs älter als 20 Stunden ist.
 *    Ein unterbrochener Abruf setzt so beim nächsten Mal dort fort, wo er aufgehört hat.
 *  - Die Gratis-Tarife erlauben nur wenige Titel pro Minute; zwischen den Paketen wird
 *    entsprechend gewartet, und jedes Paket wird sofort gespeichert.
 *  - Titel von Börsen ausserhalb der USA werden im Gratis-Tarif übersprungen statt
 *    falsch zugeordnet. Liefert der Anbieter eine andere Währung als die Position hat,
 *    wird der Kurs verworfen (wahrscheinlich ein anderes Wertpapier).
 * Schlägt etwas fehl, bleiben die letzten bekannten Kurse stehen.
 */
export async function refreshQuotes({ force = false, onProgress = null } = {}) {
  if (running) return running;
  const go = () => run({ force, onProgress });
  // Ist die App in mehreren Fenstern offen, teilen sich alle denselben Schlüssel und
  // damit dasselbe Minutenlimit. Nur ein Fenster darf gleichzeitig abrufen.
  const locked = typeof navigator !== 'undefined' && navigator.locks?.request
    ? () => navigator.locks.request('haushaltch-kursabruf', { ifAvailable: true }, (lock) => (lock ? go()
      : { updated: 0, failed: [], skipped: true, reason: 'Der Kursabruf läuft bereits in einem anderen Fenster der App.' }))
    : go;
  running = locked().finally(() => { running = null; });
  return running;
}

/* Fortschritt und letzter Stand – für die Anzeige, auch wenn der Abruf im Hintergrund läuft */
const LS_STATUS = 'swissfin.quoteStatus';
let current = null;
export function quoteStatus() {
  let st = current ? { ...current } : null;
  if (!st) { try { st = JSON.parse(localStorage.getItem(LS_STATUS) || 'null'); } catch { st = null; } }
  // Ein abgebrochener Abruf (Fenster geschlossen) hinterlässt „läuft“ – nach drei Minuten
  // ohne Lebenszeichen gilt er als beendet (zwischen zwei Paketen liegt gut eine Minute).
  if (st?.running && !running && Date.now() - (st.at || 0) > 3 * 60000) st.running = false;
  return st;
}
export const QUOTE_STATUS_KEY = LS_STATUS;
function publish(patch) {
  current = { ...(current || {}), ...patch, at: Date.now() };
  try { localStorage.setItem(LS_STATUS, JSON.stringify(current)); } catch (e) { /* egal */ }
  try { window.dispatchEvent(new CustomEvent('kurse', { detail: { ...current } })); } catch (e) { /* egal */ }
}

async function run({ force, onProgress }) {
  const progress = (p) => { publish({ running: true, ...p }); onProgress?.(p); };
  const status = (p) => publish(p);
  try {
    const res = await fetchAll({ force, progress, status });
    publish({ running: false, finishedAt: Date.now(), updated: res.updated, failed: res.failed || [], skipped: !!res.skipped, reason: res.reason || null, notCovered: res.notCovered || 0, provider: res.provider || null });
    current = null;
    return res;
  } catch (e) {
    publish({ running: false, finishedAt: Date.now(), error: e.message });
    current = null;
    throw e;
  }
}

async function fetchAll({ force, progress, status }) {
  current = { startedAt: Date.now(), running: true, done: 0, total: 0, updated: 0, failed: [], error: null };
  const key = getKey();
  if (!key) throw new Error('Kein Kurs-Schlüssel hinterlegt. Einstellungen → Kurse.');
  const provider = PROVIDERS[getProvider()] || PROVIDERS.twelvedata;

  const all = store.idx.holdings.filter((h) => h.symbol && !h.archived);
  if (!all.length) return { updated: 0, failed: [], skipped: true, reason: 'Keine Positionen mit Symbol.' };
  const due = force ? all : all.filter((h) => !h.lastPriceAt || Date.now() - h.lastPriceAt > STALE_MS);
  if (!due.length) return { updated: 0, failed: [], skipped: true, reason: 'Alle Kurse sind aktuell.' };

  const failed = [];
  const notCovered = provider.freeUsOnly ? due.filter((h) => !isUsListing(h) && !String(h.symbol).includes(':')) : [];
  for (const h of notCovered) {
    const ex = String(h.exchange || '').toUpperCase();
    failed.push({ symbol: h.symbol, error: `Börse ${EXCHANGE_LABELS[ex] || ex} ist im Gratis-Tarif nicht enthalten – Kurs bleibt aus dem IBKR-Auszug, oder von Hand setzen`, notCovered: true });
  }
  const wanted = due.filter((h) => !notCovered.includes(h));
  // „SYMBOL:BÖRSE“ (von Hand eingetragen, für bezahlte Tarife) einzeln mit Börsenangabe abfragen
  const plain = Array.from(new Set(wanted.filter((h) => !h.symbol.includes(':')).map((h) => h.symbol.toUpperCase())));
  const withExchange = Array.from(new Set(wanted.filter((h) => h.symbol.includes(':')).map((h) => h.symbol.toUpperCase())));
  const jobs = [];
  for (let i = 0; i < plain.length; i += provider.batchSize) jobs.push({ symbols: plain.slice(i, i + provider.batchSize) });
  for (const full of withExchange) { const [sym, exchange] = full.split(':'); jobs.push({ symbols: [sym], exchange, as: full }); }

  const t = now();
  let updated = 0, done = 0;
  const total = plain.length + withExchange.length;
  progress({ done: 0, total, waiting: false });
  const apply = (quotes) => {
    const updates = [];
    for (const h of wanted) {
      const q = quotes[h.symbol.toUpperCase()];
      if (!q) continue;
      if (q.currency && h.currency && q.currency.toUpperCase() !== h.currency.toUpperCase()) {
        failed.push({ symbol: h.symbol, error: `Anbieter liefert ${q.currency}, die Position ist in ${h.currency} – vermutlich ein anderes Wertpapier, Kurs nicht übernommen` });
        continue;
      }
      updates.push({
        ...h,
        lastPrice: round2(q.price),
        dayChange: q.change !== null ? round2(q.change * (Number(h.quantity) || 0)) : h.dayChange,
        lastPriceAt: t,
        priceSource: provider.label,
        name: h.name || q.name || '',
        currency: h.currency || q.currency || 'USD',
      });
    }
    if (updates.length) store.upsertMany('holdings', updates, 'Kurse aktualisiert');
    updated += updates.length;
  };

  const retryMs = provider.retryMs || provider.pauseMs || 61000;
  for (let j = 0; j < jobs.length; j++) {
    const job = jobs[j];
    progress({ done, total, waiting: false });
    let pending = job.symbols.slice();
    const got = {};
    for (let attempt = 0; pending.length && attempt < 3; attempt++) {
      let res;
      try {
        res = await provider.fetchQuotes(pending, key, { exchange: job.exchange || null });
      } catch (e) {
        if (e.rateLimited && attempt < 2) { progress({ done, total, waiting: true }); await sleep(retryMs); continue; }
        // Nur ein Schlüsselproblem bricht ab. Eine Meldung wie „symbol … invalid“ betrifft
        // einen einzelnen Titel und darf den Rest des Abrufs nicht stoppen.
        if (isKeyError(e.message)) throw e;
        failed.push(...pending.map((sym) => ({ symbol: job.as || sym, error: e.message })));
        pending = [];
        break;
      }
      for (const [sym, q] of Object.entries(res)) got[job.as && sym === job.symbols[0] ? job.as : sym] = q;
      for (const [sym, msg] of Object.entries(res.errors || {})) failed.push({ symbol: job.as || sym, error: msg });
      pending = (res.limited || []).filter((sym) => pending.includes(sym));
      if (pending.length && attempt < 2) { progress({ done, total, waiting: true }); await sleep(retryMs); }
    }
    for (const sym of pending) failed.push({ symbol: job.as || sym, error: 'Minutenlimit des Anbieters – kommt beim nächsten Abruf dran' });
    apply(got);
    const expected = job.as ? [job.as] : job.symbols;
    for (const sym of expected) {
      if (!got[sym] && !failed.some((f) => f.symbol.toUpperCase() === sym)) failed.push({ symbol: sym, error: 'kein Kurs geliefert' });
    }
    done += job.symbols.length;
    status({ done, updated, failed: failed.length });
    if (j < jobs.length - 1) {
      progress({ done, total, waiting: true });
      await sleep(provider.pauseMs || 900);
    }
  }

  if (updated) {
    try { localStorage.setItem('swissfin.lastQuoteUpdate', String(t)); } catch (e) { /* egal */ }
    writeSnapshot(todayISO());
  }
  return { updated, failed, notCovered: notCovered.length, provider: provider.label };
}

/** Einzelnen Kurs von Hand setzen (funktioniert immer, auch ohne Schlüssel). */
export function setManualPrice(holdingId, price, date = todayISO()) {
  const h = store.holding(holdingId);
  if (!h) return null;
  store.patch('holdings', holdingId, {
    lastPrice: round2(Number(price)),
    lastPriceAt: new Date(`${date}T12:00:00`).getTime(),
    priceSource: 'manuell',
  }, 'Kurs von Hand gesetzt');
  writeSnapshot(date);
  return store.holding(holdingId);
}

/** Prüft Schlüssel und Anbieter mit einer einzelnen Abfrage. */
export async function testConnection(symbol = 'AAPL') {
  const provider = PROVIDERS[getProvider()] || PROVIDERS.twelvedata;
  const res = await provider.fetchQuotes([symbol], getKey());
  const q = res[symbol.toUpperCase()];
  if (!q) throw new Error(`${provider.label} liefert keinen Kurs für ${symbol}.`);
  return { provider: provider.label, symbol, price: q.price };
}
