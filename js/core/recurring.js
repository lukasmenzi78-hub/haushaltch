// recurring.js — wiederkehrende Zahlungen und Einkünfte: erkennen, führen, fällig stellen
import { store } from './store.js';
import { amountBase, isTransferCategory } from './analytics.js';
import { toBase } from './fx.js';
import {
  round2, sum, todayISO, parseISO, fmtISO, normText, monthKey, startOfMonth, endOfMonth,
  currentMonthKey, addMonths, daysInMonth, pad2, uid, now, sortBy, cmpStr,
} from './util.js';

export const CADENCES = [
  { id: 'woechentlich', label: 'wöchentlich', days: 7, perYear: 52 },
  { id: 'zweiwoechentlich', label: 'alle zwei Wochen', days: 14, perYear: 26 },
  { id: 'monatlich', label: 'monatlich', days: 30, perYear: 12 },
  { id: 'zweimonatlich', label: 'alle zwei Monate', days: 61, perYear: 6 },
  { id: 'quartalsweise', label: 'vierteljährlich', days: 91, perYear: 4 },
  { id: 'halbjaehrlich', label: 'halbjährlich', days: 182, perYear: 2 },
  { id: 'jaehrlich', label: 'jährlich', days: 365, perYear: 1 },
];

export function cadenceInfo(id) {
  return CADENCES.find((c) => c.id === id) || CADENCES[2];
}

const DAY = 86400000;
const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / DAY);
const addDays = (iso, n) => fmtISO(new Date(parseISO(iso).getTime() + n * DAY));

function cadenceFromGap(days) {
  if (days <= 9) return 'woechentlich';
  if (days <= 20) return 'zweiwoechentlich';
  if (days <= 45) return 'monatlich';
  if (days <= 75) return 'zweimonatlich';
  if (days <= 135) return 'quartalsweise';
  if (days <= 250) return 'halbjaehrlich';
  return 'jaehrlich';
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Schlüssel, unter dem Buchungen derselben Serie zusammenfallen. */
export function seriesKey(txn) {
  const base = normText(txn.payee || txn.description || '');
  return base.split(' ').slice(0, 4).join(' ').slice(0, 32);
}

/* ------------------------------------------------------------------ */
/* Erkennung                                                           */
/* ------------------------------------------------------------------ */

/**
 * Findet Serien in den Buchungen – Ausgaben wie Einnahmen.
 * Bewertet Rhythmus und Betragstreue, damit unregelmässige Einkäufe
 * (jede Woche Coop, aber jedes Mal anders) nicht als Serie gelten.
 */
export function detectSeries({ minOccurrences = 3, maxSpread = 0.25 } = {}) {
  const groups = new Map();
  for (const t of store.idx.transactions) {
    if (t.deleted || t.hidden || !t.amount) continue;
    if (t.isTransfer || isTransferCategory(t.categoryId)) continue;
    const key = `${t.amount > 0 ? '+' : '-'}${seriesKey(t)}`;
    if (key.length < 4) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  const out = [];
  for (const [key, list] of groups) {
    if (list.length < minOccurrences) continue;
    const items = sortBy(list, (t) => t.date);
    const dates = items.map((t) => t.date);
    const gaps = [];
    for (let i = 1; i < dates.length; i++) {
      const g = daysBetween(dates[i - 1], dates[i]);
      if (g > 0) gaps.push(g);
    }
    if (gaps.length < minOccurrences - 1) continue;

    const medGap = median(gaps);
    if (!medGap) continue;
    const gapSpread = median(gaps.map((g) => Math.abs(g - medGap))) / medGap;

    const amounts = items.map((t) => Math.abs(amountBase(t)));
    const medAmount = median(amounts);
    const amountSpread = medAmount ? median(amounts.map((a) => Math.abs(a - medAmount))) / medAmount : 1;
    if (amountSpread > maxSpread) continue;
    if (gapSpread > 0.4) continue;

    const last = items[items.length - 1];
    const cadence = cadenceFromGap(medGap);
    out.push({
      key,
      name: last.payee || last.description || key,
      payee: last.payee || '',
      direction: last.amount > 0 ? 'einnahme' : 'ausgabe',
      amount: round2(median(items.map((t) => t.amount))),
      currency: last.currency || 'CHF',
      amountBase: round2(medAmount * (last.amount > 0 ? 1 : -1)),
      cadence,
      accountId: last.accountId,
      categoryId: last.categoryId,
      ownerId: last.ownerId,
      occurrences: items.length,
      firstDate: dates[0],
      lastDate: last.date,
      nextDate: addDays(last.date, Math.round(medGap)),
      medianGap: Math.round(medGap),
      // Je gleichmässiger Rhythmus und Betrag, desto sicherer die Serie
      confidence: round2(Math.max(0, 1 - gapSpread) * 0.6 + Math.max(0, 1 - amountSpread) * 0.4),
      dayOfMonth: Number(last.date.slice(8, 10)),
      transactionIds: items.map((t) => t.id),
    });
  }
  return sortBy(out, (s) => Math.abs(s.amountBase), -1);
}

/** Erkannte Serien, die noch nicht übernommen oder abgelehnt wurden. */
export function newCandidates() {
  const known = new Set(store.idx.recurring.map((r) => r.key));
  return detectSeries().filter((s) => !known.has(s.key) && s.confidence >= 0.5);
}

/* ------------------------------------------------------------------ */
/* Serien führen                                                       */
/* ------------------------------------------------------------------ */

export function newSeries(patch = {}) {
  return {
    id: uid('rec'),
    key: '', name: '', payee: '',
    direction: 'ausgabe',
    amount: 0, currency: 'CHF',
    cadence: 'monatlich',
    nextDate: todayISO(),
    accountId: null, categoryId: null, ownerId: null,
    anchorDay: null,      // ursprünglicher Stichtag im Monat
    active: true, auto: false, ignored: false,
    variable: false,      // Betrag schwankt (z. B. Strom) – Prognose nutzt den Durchschnitt
    notes: '',
    updatedAt: now(), ...patch,
  };
}

export function adoptCandidate(candidate, extra = {}) {
  const series = newSeries({
    key: candidate.key,
    name: candidate.name,
    payee: candidate.payee,
    direction: candidate.direction,
    amount: candidate.amount,
    currency: candidate.currency,
    cadence: candidate.cadence,
    nextDate: candidate.nextDate,
    anchorDay: candidate.dayOfMonth,
    accountId: candidate.accountId,
    categoryId: candidate.categoryId,
    ownerId: candidate.ownerId,
    auto: true,
    ...extra,
  });
  store.upsert('recurring', series, 'Serie übernommen');
  return series;
}

export function ignoreCandidate(candidate) {
  store.upsert('recurring', newSeries({
    key: candidate.key, name: candidate.name, ignored: true, active: false, auto: true,
  }), 'Serie ignoriert');
}

export function adoptAll(candidates) {
  const list = candidates.map((c) => newSeries({
    key: c.key, name: c.name, payee: c.payee, direction: c.direction, amount: c.amount,
    currency: c.currency, cadence: c.cadence, nextDate: c.nextDate, anchorDay: c.dayOfMonth,
    accountId: c.accountId, categoryId: c.categoryId, ownerId: c.ownerId, auto: true,
  }));
  if (list.length) store.upsertMany('recurring', list, 'Serien übernommen');
  return list.length;
}

/* ------------------------------------------------------------------ */
/* Fälligkeit und Status                                               */
/* ------------------------------------------------------------------ */

/** Buchungen, die zu einer Serie gehören (Zeitfenster um die Fälligkeit). */
export function matchingTransactions(series, from, to) {
  const key = normText(series.payee || series.name).split(' ').slice(0, 4).join(' ').slice(0, 32);
  if (!key) return [];
  return store.idx.transactions.filter((t) => {
    if (t.deleted || t.date < from || t.date > to) return false;
    if (series.direction === 'ausgabe' ? t.amount >= 0 : t.amount <= 0) return false;
    return seriesKey(t) === key;
  });
}

/** Status einer Serie im laufenden Zeitraum: bezahlt, fällig, überfällig. */
export function seriesStatus(series, reference = todayISO()) {
  const info = cadenceInfo(series.cadence);
  const windowFrom = addDays(series.nextDate, -Math.round(info.days * 0.6));
  const windowTo = addDays(series.nextDate, Math.round(info.days * 0.4));
  const hits = matchingTransactions(series, windowFrom, windowTo);
  const paid = hits.length > 0;
  const daysUntil = daysBetween(reference, series.nextDate);
  return {
    paid,
    paidOn: paid ? sortBy(hits, (t) => t.date, -1)[0].date : null,
    paidAmount: paid ? round2(sum(hits, (t) => t.amount)) : null,
    daysUntil,
    overdue: !paid && daysUntil < 0,
    dueSoon: !paid && daysUntil >= 0 && daysUntil <= 7,
    state: paid ? 'bezahlt' : daysUntil < 0 ? 'ueberfaellig' : daysUntil <= 7 ? 'faellig' : 'geplant',
  };
}

/** Rückt die Fälligkeit einer Serie vor, wenn die Zahlung erfolgt ist. */
export function rollForward(series, reference = todayISO()) {
  let next = series.nextDate;
  let guard = 0;
  while (next < reference && guard++ < 400) {
    next = nextOccurrence(next, series.cadence, series.anchorDay);
  }
  if (next !== series.nextDate) store.patch('recurring', series.id, { nextDate: next }, 'Fälligkeit angepasst');
  return next;
}

/**
 * Nächster Termin nach `date` gemäss Rhythmus.
 * `anchorDay` ist der ursprüngliche Stichtag: eine Miete per 31. darf nicht dauerhaft
 * auf den 28. rutschen, nur weil der Februar kürzer ist.
 */
export function nextOccurrence(date, cadence, anchorDay = null) {
  const info = cadenceInfo(cadence);
  if (info.days < 28) return addDays(date, info.days);
  const monthsAhead = Math.round(info.days / 30.4);
  const [y, m, d] = date.split('-').map(Number);
  const anchor = anchorDay || d;
  const targetMonth = addMonths(`${y}-${pad2(m)}`, monthsAhead);
  return `${targetMonth}-${pad2(Math.min(anchor, daysInMonth(targetMonth)))}`;
}

/** Alle Fälligkeiten einer Serie zwischen zwei Daten. */
export function occurrencesBetween(series, from, to) {
  const out = [];
  let d = series.nextDate;
  // Falls die Fälligkeit in der Vergangenheit liegt, zuerst aufholen
  let guard = 0;
  while (d < from && guard++ < 400) d = nextOccurrence(d, series.cadence, series.anchorDay);
  guard = 0;
  while (d <= to && guard++ < 400) {
    out.push(d);
    d = nextOccurrence(d, series.cadence, series.anchorDay);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Übersicht                                                           */
/* ------------------------------------------------------------------ */

export function seriesOverview(reference = todayISO()) {
  const active = store.idx.recurring.filter((r) => r.active && !r.ignored);
  const rows = active.map((series) => ({ series, status: seriesStatus(series, reference) }));
  // in Basiswährung, sonst addiert sich ein EUR-Abo als CHF
  const monthly = (s) => Math.abs(toBase(s.amount, s.currency || 'CHF')) * cadenceInfo(s.cadence).perYear / 12;

  const expenses = rows.filter((r) => r.series.direction === 'ausgabe');
  const income = rows.filter((r) => r.series.direction === 'einnahme');
  const horizon = addDays(reference, 30);

  return {
    rows: sortBy(rows, (r) => r.series.nextDate),
    monthlyExpense: round2(sum(expenses, (r) => monthly(r.series))),
    monthlyIncome: round2(sum(income, (r) => monthly(r.series))),
    due30: sortBy(rows.filter((r) => !r.status.paid && r.series.nextDate <= horizon), (r) => r.series.nextDate),
    due30Total: round2(sum(
      rows.filter((r) => !r.status.paid && r.series.direction === 'ausgabe' && r.series.nextDate <= horizon),
      (r) => Math.abs(toBase(r.series.amount, r.series.currency || 'CHF')),
    )),
    overdue: rows.filter((r) => r.status.overdue),
    paidThisPeriod: rows.filter((r) => r.status.paid).length,
    count: rows.length,
  };
}

/** Monatliche Belastung einer Serie in ihrer eigenen Währung. */
export function monthlyAmount(series) {
  return round2((series.amount * cadenceInfo(series.cadence).perYear) / 12);
}

/** Monatliche Belastung in Basiswährung – für Summen über mehrere Währungen. */
export function monthlyAmountBase(series) {
  return round2(toBase(monthlyAmount(series), series.currency || 'CHF'));
}
