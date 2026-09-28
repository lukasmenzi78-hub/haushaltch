// quotes.js — Kursabruf für Wertschriften.
// Beide Anbieter erlauben Aufrufe direkt aus dem Browser und haben einen Gratis-Tarif.
// Der Schlüssel gehört dem Nutzer und liegt nur lokal im Gerät.
import { store } from './store.js';
import { writeSnapshot } from './investments.js';
import { now, todayISO, round2 } from './util.js';

const LS_PROVIDER = 'swissfin.quoteProvider';
const LS_KEY = 'swissfin.quoteKey';

export const PROVIDERS = {
  twelvedata: {
    id: 'twelvedata',
    label: 'Twelve Data',
    signup: 'https://twelvedata.com/pricing',
    hint: 'Gratis 800 Abfragen pro Tag. Deckt SIX, Xetra und die US-Börsen ab. Mehrere Symbole pro Abfrage.',
    batchSize: 8,
    async fetchQuotes(symbols, key) {
      const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols.join(','))}&apikey=${encodeURIComponent(key)}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Twelve Data antwortet mit ${res.status}`);
      const data = await res.json();
      if (data.status === 'error') throw new Error(data.message || 'Twelve Data meldet einen Fehler');
      const list = symbols.length === 1 ? { [symbols[0]]: data } : data;
      const out = {};
      for (const [sym, q] of Object.entries(list)) {
        if (!q || q.status === 'error') continue;
        const price = Number(q.close ?? q.price);
        if (!isFinite(price) || price <= 0) continue;
        out[sym.toUpperCase()] = {
          price,
          change: isFinite(Number(q.change)) ? Number(q.change) : null,
          currency: q.currency || null,
          name: q.name || null,
        };
      }
      return out;
    },
  },
  finnhub: {
    id: 'finnhub',
    label: 'Finnhub',
    signup: 'https://finnhub.io/register',
    hint: 'Gratis 60 Abfragen pro Minute. US-Titel zuverlässig; europäische Börsen nur teilweise.',
    batchSize: 1,
    async fetchQuotes(symbols, key) {
      const out = {};
      for (const sym of symbols) {
        const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(key)}`, { cache: 'no-store' });
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

/**
 * Holt Kurse für alle Positionen mit Symbol.
 * Schlägt der Abruf fehl, bleiben die letzten bekannten Kurse stehen –
 * die App zeigt dann an, von wann sie stammen.
 */
export async function refreshQuotes({ force = false, onProgress = null } = {}) {
  const key = getKey();
  if (!key) throw new Error('Kein Kurs-Schlüssel hinterlegt. Einstellungen → Kurse.');
  const provider = PROVIDERS[getProvider()] || PROVIDERS.twelvedata;

  const holdings = store.idx.holdings.filter((h) => h.symbol && !h.archived);
  if (!holdings.length) return { updated: 0, failed: [], skipped: true };

  const last = Number(localStorage.getItem('swissfin.lastQuoteUpdate')) || 0;
  if (!force && Date.now() - last < 6 * 3600 * 1000) {
    return { updated: 0, skipped: true, reason: 'Kurse sind weniger als sechs Stunden alt.' };
  }

  const symbols = Array.from(new Set(holdings.map((h) => h.symbol.toUpperCase())));
  const quotes = {};
  const failed = [];
  for (let i = 0; i < symbols.length; i += provider.batchSize) {
    const batch = symbols.slice(i, i + provider.batchSize);
    try {
      Object.assign(quotes, await provider.fetchQuotes(batch, key));
    } catch (e) {
      failed.push(...batch.map((s) => ({ symbol: s, error: e.message })));
      if (/401|403|invalid|key/i.test(e.message)) throw e;   // Schlüsselproblem: sofort abbrechen
    }
    onProgress?.(Math.min(i + provider.batchSize, symbols.length), symbols.length);
    if (i + provider.batchSize < symbols.length) await sleep(provider.batchSize === 1 ? 250 : 900);
  }

  const t = now();
  const updates = [];
  for (const h of holdings) {
    const q = quotes[h.symbol.toUpperCase()];
    if (!q) { if (!failed.some((f) => f.symbol === h.symbol.toUpperCase())) failed.push({ symbol: h.symbol, error: 'kein Kurs geliefert' }); continue; }
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

  if (updates.length) {
    store.upsertMany('holdings', updates, 'Kurse aktualisiert');
    try { localStorage.setItem('swissfin.lastQuoteUpdate', String(t)); } catch (e) { /* egal */ }
    writeSnapshot(todayISO());
  }
  return { updated: updates.length, failed, provider: provider.label };
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
