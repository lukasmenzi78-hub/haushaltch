// fx.js — Währungsumrechnung. Alle Kurse werden als "1 <quote> = rate <CHF>" gespeichert.
import { store } from './store.js';
import { uid, now, todayISO, byDateAsc } from './util.js';

// Startwerte, damit die App auch offline sofort rechnen kann. In den
// Einstellungen überschreibbar bzw. per Knopfdruck aktualisierbar.
export const SEED_RATES = { CHF: 1, EUR: 0.94, USD: 0.85, GBP: 1.10 };

function ratesFor(currency) {
  return store.idx.fxRates
    .filter((r) => r.quote === currency)
    .sort(byDateAsc());
}

/** Kurs von 1 Einheit `currency` in CHF, zum Datum (nächster Kurs ≤ Datum). */
export function rateToBase(currency, date = null) {
  const cur = (currency || 'CHF').toUpperCase();
  if (cur === 'CHF') return 1;
  const list = ratesFor(cur);
  if (list.length) {
    if (!date) return list[list.length - 1].rate;
    let best = null;
    for (const r of list) {
      if (r.date <= date) best = r;
      else break;
    }
    return (best || list[0]).rate;
  }
  return SEED_RATES[cur] ?? 1;
}

export function convert(amount, from, to = 'CHF', date = null) {
  if (amount === null || amount === undefined || !isFinite(amount)) return 0;
  const f = (from || 'CHF').toUpperCase();
  const t = (to || 'CHF').toUpperCase();
  if (f === t) return amount;
  const inBase = amount * rateToBase(f, date);
  if (t === 'CHF') return inBase;
  return inBase / rateToBase(t, date);
}

export function toBase(amount, currency, date = null) {
  return convert(amount, currency, store.baseCurrency, date);
}

export function setRate(currency, rate, date = todayISO()) {
  const cur = currency.toUpperCase();
  const id = `fx_${date}_${cur}`;
  store.upsert('fxRates', { id, date, base: 'CHF', quote: cur, rate: Number(rate), updatedAt: now() }, 'Wechselkurs');
}

export function lastFxUpdate() {
  try { return Number(localStorage.getItem('swissfin.lastFxUpdate')) || 0; } catch (e) { return 0; }
}

export function currenciesInUse() {
  const set = new Set([store.baseCurrency]);
  for (const a of store.idx.accounts) if (a.currency) set.add(a.currency);
  for (const g of store.idx.goals) if (g.currency) set.add(g.currency);
  for (const a of store.idx.assets) if (a.currency) set.add(a.currency);
  // Wertschriften und Buchungen sind die häufigsten Fremdwährungsträger
  for (const h of store.idx.holdings) if (h.currency) set.add(h.currency);
  for (const d of store.idx.dividends) if (d.currency) set.add(d.currency);
  for (const t of store.idx.transactions) {
    if (t.currency) set.add(t.currency);
    if (t.currencyOriginal) set.add(t.currencyOriginal);
  }
  return Array.from(set);
}

/**
 * Währungen, für die weder ein abgerufener Kurs noch ein Startwert vorliegt.
 * Sie würden 1:1 umgerechnet – das muss die App zeigen statt still zu rechnen.
 */
export function unknownCurrencies() {
  return currenciesInUse().filter((cur) => {
    if (cur === 'CHF') return false;
    if (store.idx.fxRates.some((r) => r.quote === cur)) return false;
    return SEED_RATES[cur] === undefined;
  });
}

/** Währungen, die nur mit dem groben Startwert rechnen (noch nie abgerufen). */
export function seededOnlyCurrencies() {
  return currenciesInUse().filter((cur) => cur !== 'CHF'
    && !store.idx.fxRates.some((r) => r.quote === cur)
    && SEED_RATES[cur] !== undefined);
}

/** Holt aktuelle EZB-Referenzkurse (frankfurter.app, kein Schlüssel nötig). */
export async function fetchRates(currencies = null) {
  const list = (currencies || currenciesInUse()).filter((c) => c && c !== 'CHF');
  if (!list.length) return { updated: 0 };
  const url = `https://api.frankfurter.app/latest?from=CHF&to=${list.join(',')}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Kursabfrage fehlgeschlagen (${res.status})`);
  const data = await res.json();
  const date = data.date || todayISO();
  const records = [];
  for (const [cur, chfPerUnitInverse] of Object.entries(data.rates || {})) {
    // API liefert: 1 CHF = X <cur>  →  1 <cur> = 1/X CHF
    if (!chfPerUnitInverse) continue;
    records.push({ id: `fx_${date}_${cur}`, date, base: 'CHF', quote: cur, rate: 1 / chfPerUnitInverse, updatedAt: now() });
  }
  if (records.length) store.upsertMany('fxRates', records, 'Wechselkurse aktualisiert');
  try { localStorage.setItem('swissfin.lastFxUpdate', String(now())); } catch (e) { /* egal */ }
  return { updated: records.length, date };
}

/** Historischer Kurs für ein bestimmtes Datum (bei Bedarf nachladen). */
export async function fetchRateForDate(currency, date) {
  const cur = currency.toUpperCase();
  if (cur === 'CHF') return 1;
  const res = await fetch(`https://api.frankfurter.app/${date}?from=CHF&to=${cur}`, { cache: 'force-cache' });
  if (!res.ok) throw new Error('Kursabfrage fehlgeschlagen');
  const data = await res.json();
  const inv = data.rates?.[cur];
  if (!inv) throw new Error('Kein Kurs gefunden');
  const rate = 1 / inv;
  store.upsert('fxRates', { id: `fx_${data.date}_${cur}`, date: data.date, base: 'CHF', quote: cur, rate, updatedAt: now() }, 'Wechselkurs');
  return rate;
}
