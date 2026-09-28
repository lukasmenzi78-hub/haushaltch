// forecast.js — Liquiditätsprognose: wie entwickeln sich die Kontostände?
import { store } from './store.js';
import { toBase } from './fx.js';
import { accountBalance, accountTypeInfo, amountBase } from './analytics.js';
import { occurrencesBetween, seriesKey, cadenceInfo, seriesStatus } from './recurring.js';
import {
  round2, sum, todayISO, parseISO, fmtISO, monthKey, addMonths, currentMonthKey,
  startOfMonth, endOfMonth, sortBy,
} from './util.js';

const DAY = 86400000;
const addDays = (iso, n) => fmtISO(new Date(parseISO(iso).getTime() + n * DAY));

/** Konten, die für die Liquidität zählen: Zahlungsverkehr, Sparen, Bargeld. */
export function liquidAccounts() {
  return store.idx.accounts.filter((a) => !a.archived && accountTypeInfo(a.type).group === 'liquid');
}

/**
 * Durchschnittlicher Tagesverbrauch in flexiblen Kategorien.
 * Buchungen, die zu einer geführten Serie gehören, werden ausgeklammert –
 * sonst stünde derselbe Betrag zweimal in der Prognose.
 */
export function dailyFlexBurn({ lookbackMonths = 3 } = {}) {
  const from = `${addMonths(currentMonthKey(), -lookbackMonths)}-01`;
  const to = todayISO();
  const seriesKeys = new Set(store.idx.recurring.filter((r) => r.active && !r.ignored)
    .map((r) => seriesKey({ payee: r.payee || r.name })));

  let total = 0;
  let count = 0;
  for (const t of store.idx.transactions) {
    if (t.deleted || t.hidden || t.amount >= 0) continue;
    if (t.date < from || t.date > to) continue;
    if (t.isTransfer || t.excludeFromBudget) continue;
    const cat = store.category(t.categoryId);
    if (!cat || cat.budgetType !== 'flex') continue;
    if (seriesKeys.has(seriesKey(t))) continue;
    total += Math.abs(amountBase(t));
    count++;
  }
  const days = Math.max(1, Math.round((parseISO(to) - parseISO(from)) / DAY));
  return { perDay: round2(total / days), total: round2(total), days, transactions: count };
}

/**
 * Rechnet die Kontostände Tag für Tag voraus.
 * @param options {days, accountIds, includeFlex, buffer, scenario:[{date, amount, note}]}
 */
export function project(options = {}) {
  const {
    days = 90,
    accountIds = null,
    includeFlex = true,
    buffer = 0,
    scenario = [],
  } = options;

  const accounts = (accountIds && accountIds.length
    ? store.idx.accounts.filter((a) => accountIds.includes(a.id))
    : liquidAccounts());

  const start = todayISO();
  const end = addDays(start, days);
  const startBalance = round2(sum(accounts, (a) => toBase(accountBalance(a), a.currency)));

  // Ereignisse sammeln
  const events = [];
  const inScope = new Set(accounts.map((a) => a.id));
  for (const series of store.idx.recurring) {
    if (!series.active || series.ignored) continue;
    // Eine Serie, die auf der Kreditkarte läuft, belastet die Liquidität erst mit der
    // Kartenrechnung – und die ist selbst eine Serie. Sonst zählt sie doppelt.
    if (series.accountId && !inScope.has(series.accountId)) continue;
    const status = seriesStatus(series, start);
    const amount = round2(toBase(series.amount, series.currency || 'CHF'));
    const base = {
      amount, label: series.name, kind: series.direction,
      seriesId: series.id, variable: !!series.variable,
    };

    // Überfälliges wird nicht verschluckt: es steht auf dem ersten Tag der Prognose
    if (status.overdue) {
      events.push({ ...base, date: start, overdue: true, dueSince: series.nextDate });
    }

    let dates = occurrencesBetween(series, start, end);
    // Ist die laufende Fälligkeit bereits bezahlt, zählt sie nicht noch einmal
    if (status.paid && dates[0] === series.nextDate) dates = dates.slice(1);
    for (const date of dates) events.push({ ...base, date });
  }
  for (const item of scenario) {
    if (!item || !item.date || !isFinite(item.amount)) continue;
    if (item.date < start || item.date > end) continue;
    events.push({ date: item.date, amount: round2(Number(item.amount)), label: item.note || 'Einmaliger Posten', kind: 'szenario' });
  }

  const flex = includeFlex ? dailyFlexBurn() : { perDay: 0 };
  const byDate = new Map();
  for (const e of events) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }

  const series = [];
  let balance = startBalance;
  let min = { date: start, balance: Infinity };
  let shortfall = null;

  for (let i = 0; i <= days; i++) {
    const date = addDays(start, i);
    const dayEvents = byDate.get(date) || [];
    // Posten des heutigen Tages, die noch offen sind, zählen bereits mit;
    // der flexible Verbrauch erst ab morgen, denn der heutige ist schon gebucht.
    balance += sum(dayEvents, (e) => e.amount);
    if (i > 0) balance -= flex.perDay;
    balance = round2(balance);
    series.push({ date, balance, events: dayEvents, flex: i > 0 ? flex.perDay : 0 });
    if (balance < min.balance) min = { date, balance };
    if (shortfall === null && balance < buffer) shortfall = { date, balance };
  }

  const incoming = round2(sum(events.filter((e) => e.amount > 0), (e) => e.amount));
  const outgoing = round2(sum(events.filter((e) => e.amount < 0), (e) => e.amount));

  return {
    start, end, days,
    accounts,
    startBalance,
    endBalance: round2(balance),
    change: round2(balance - startBalance),
    series,
    events: sortBy(events, (e) => e.date),
    min, shortfall, buffer,
    flexPerDay: flex.perDay,
    flexTotal: round2(flex.perDay * days),
    incoming, outgoing,
    hasSeries: store.idx.recurring.some((r) => r.active && !r.ignored),
  };
}

/** Verdichtet die Tageswerte auf Wochenpunkte, damit der Chart lesbar bleibt. */
export function weeklyPoints(projection) {
  const out = [];
  for (let i = 0; i < projection.series.length; i += 7) {
    const p = projection.series[i];
    out.push({ date: p.date, balance: p.balance });
  }
  const last = projection.series[projection.series.length - 1];
  if (out[out.length - 1]?.date !== last.date) out.push({ date: last.date, balance: last.balance });
  return out;
}

/** Die grössten Posten im Zeitraum – für die Liste neben dem Chart. */
export function upcoming(projection, limit = 12) {
  return sortBy(projection.events.filter((e) => e.date > projection.start), (e) => e.date).slice(0, limit);
}
