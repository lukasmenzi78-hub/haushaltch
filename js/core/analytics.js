// analytics.js — Salden, Nettovermögen, Cashflow
import { store } from './store.js';
import { toBase, convert } from './fx.js';
import { round2, monthKey, endOfMonth, addMonths, currentMonthKey, monthRange, sum, todayISO, byDateAsc } from './util.js';
import { ACCOUNT_TYPES, ASSET_TYPES } from './model.js';

export function accountTypeInfo(typeId) {
  return ACCOUNT_TYPES.find((t) => t.id === typeId) || { id: typeId, label: typeId, group: 'liquid', sign: 1 };
}
export function assetTypeInfo(typeId) {
  return ASSET_TYPES.find((t) => t.id === typeId) || { id: typeId, label: typeId, side: 'asset' };
}

/** Saldo eines Kontos in Kontowährung, optional per Stichtag. */
export function accountBalance(account, asOf = null) {
  if (!account) return 0;
  const date = asOf || todayISO();
  const manual = (account.manualBalances || [])
    .filter((b) => b.date <= date)
    .sort(byDateAsc());
  const txns = store.idx.txnByAccount.get(account.id) || [];
  const live = txns.filter((t) => !t.deleted && !t.hidden);

  // Depot: Saldo ergibt sich aus den Positionen plus Barbestand.
  // Für vergangene Stichtage zählt der damals festgehaltene Stand – sonst würde die
  // Vermögenskurve den heutigen Depotwert rückwirkend in alle Monate schreiben.
  if (account.balanceMode === 'holdings') {
    const isToday = !asOf || date >= todayISO();
    if (!isToday) {
      const snaps = store.idx.snapshots.filter((s) => s.date <= date && s.byAccount && s.byAccount[account.id] !== undefined);
      if (snaps.length) {
        const snap = snaps[snaps.length - 1];
        return round2(convert(snap.byAccount[account.id], store.baseCurrency, account.currency)
          + (Number(account.cashBalance) || 0));
      }
      // Kein Stand vorhanden: das Depot gab es damals aus Sicht der App noch nicht
      return 0;
    }
    const hs = store.idx.holdings.filter((h) => h.accountId === account.id && !h.archived);
    const value = sum(hs, (h) => convert((Number(h.quantity) || 0) * (Number(h.lastPrice) || 0), h.currency, account.currency));
    return round2(value + (Number(account.cashBalance) || 0));
  }
  if (account.balanceMode === 'manual') {
    return manual.length ? manual[manual.length - 1].value : (account.openingBalance || 0);
  }
  if (manual.length) {
    const anchor = manual[manual.length - 1];
    const delta = sum(live.filter((t) => t.date > anchor.date && t.date <= date), (t) => t.amount);
    return round2(anchor.value + delta);
  }
  const delta = sum(live.filter((t) => t.date <= date), (t) => t.amount);
  return round2((account.openingBalance || 0) + delta);
}

export function accountBalanceBase(account, asOf = null) {
  return round2(toBase(accountBalance(account, asOf), account.currency, asOf));
}

export function assetValue(asset, asOf = null) {
  const date = asOf || todayISO();
  const vals = (asset.valuations || []).filter((v) => v.date <= date).sort(byDateAsc());
  if (!vals.length) return 0;
  return vals[vals.length - 1].value;
}

export function assetValueBase(asset, asOf = null) {
  return round2(toBase(assetValue(asset, asOf), asset.currency, asOf));
}

/** Aufteilung des Vermögens zu einem Stichtag. */
export function netWorthAt(asOf = null) {
  const date = asOf || todayISO();
  let assets = 0, liabilities = 0;
  const rows = [];
  for (const a of store.idx.accounts) {
    if (a.archived || a.includeInNetWorth === false) continue;
    const v = accountBalanceBase(a, date);
    rows.push({ kind: 'account', id: a.id, name: a.name, type: a.type, value: v, currency: a.currency, ownerId: a.ownerId });
    if (v >= 0) assets += v; else liabilities += -v;
  }
  for (const a of store.idx.assets) {
    if (a.includeInNetWorth === false) continue;
    const info = assetTypeInfo(a.type);
    const raw = assetValueBase(a, date);
    const v = info.side === 'liability' ? -Math.abs(raw) : Math.abs(raw);
    rows.push({ kind: 'asset', id: a.id, name: a.name, type: a.type, value: v, currency: a.currency, ownerId: a.ownerId });
    if (v >= 0) assets += v; else liabilities += -v;
  }
  return { date, assets: round2(assets), liabilities: round2(liabilities), net: round2(assets - liabilities), rows };
}

/** Monatliche Nettovermögens-Reihe. */
export function netWorthSeries(months = 12, endMonth = null) {
  const end = endMonth || currentMonthKey();
  const start = addMonths(end, -(months - 1));
  return monthRange(start, end).map((m) => {
    const snap = netWorthAt(endOfMonth(m));
    return { month: m, assets: snap.assets, liabilities: snap.liabilities, net: snap.net };
  });
}

/** Erster Monat mit Daten. */
export function firstDataMonth() {
  const dates = store.idx.transactions.map((t) => t.date).filter(Boolean);
  if (!dates.length) return currentMonthKey();
  return monthKey(dates.reduce((a, b) => (a < b ? a : b)));
}

export function lastDataMonth() {
  const dates = store.idx.transactions.map((t) => t.date).filter(Boolean);
  if (!dates.length) return currentMonthKey();
  return monthKey(dates.reduce((a, b) => (a > b ? a : b)));
}

/** Monat, den die App standardmässig anzeigt: der laufende Monat, sofern er
 *  Buchungen enthält – sonst der letzte Monat mit Daten. So steht nach einem
 *  Import älterer Auszüge nicht überall „keine Daten“. */
export function activeMonth() {
  const cur = currentMonthKey();
  const hasCurrent = store.idx.transactions.some((t) => monthKey(t.date) === cur);
  return hasCurrent ? cur : lastDataMonth();
}

/**
 * Zerlegt eine Buchung in ihre Kategorieanteile.
 * Ohne Aufteilung ist das ein einziger Teil. Deckt die Aufteilung den Betrag nicht
 * vollständig ab, fällt der Rest auf die Kategorie der Buchung zurück – so geht in
 * keiner Auswertung Geld verloren.
 */
export function splitParts(txn) {
  const total = Number(txn.amount) || 0;
  if (!txn.splits || !txn.splits.length) {
    return [{ categoryId: txn.categoryId || 'c_unkategorisiert', amount: total, base: amountBase(txn) }];
  }
  const parts = txn.splits
    .filter((s) => Number(s.amount))
    .map((s) => ({
      categoryId: s.categoryId || 'c_unkategorisiert',
      amount: Number(s.amount),
      base: toBase(Number(s.amount), txn.currency || 'CHF', txn.date),
      note: s.note || '',
    }));
  const covered = sum(parts, (p) => p.amount);
  const rest = round2(total - covered);
  if (Math.abs(rest) > 0.005) {
    parts.push({
      categoryId: txn.categoryId || 'c_unkategorisiert',
      amount: rest,
      base: toBase(rest, txn.currency || 'CHF', txn.date),
      note: 'Rest',
    });
  }
  return parts;
}

/** Wie splitParts, aber ohne Übertragsanteile – für Budget, Berichte und Auswertungen. */
export function countableParts(txn) {
  return splitParts(txn).filter((p) => !isTransferCategory(p.categoryId));
}

export function isSplit(txn) {
  return !!(txn.splits && txn.splits.length);
}

/** Betrag einer Buchung in Basiswährung. */
export function amountBase(txn) {
  return toBase(txn.amount, txn.currency || 'CHF', txn.date);
}

function isCountable(t, opts = {}) {
  if (t.deleted || t.hidden) return false;
  if (!opts.includeTransfers && (t.isTransfer || isTransferCategory(t.categoryId))) return false;
  if (!opts.includeExcluded && t.excludeFromBudget) return false;
  if (opts.ownerId && t.ownerId !== opts.ownerId) return false;
  if (opts.accountIds && opts.accountIds.length && !opts.accountIds.includes(t.accountId)) return false;
  return true;
}

export function isTransferCategory(categoryId) {
  const c = store.category(categoryId);
  return !!c && (c.budgetType === 'transfer' || c.kind === 'transfer');
}

export function isIncomeCategory(categoryId) {
  const c = store.category(categoryId);
  return !!c && c.budgetType === 'einkommen';
}

/** Einnahmen/Ausgaben pro Monat. */
export function cashflowSeries(months = 12, opts = {}) {
  const end = opts.endMonth || currentMonthKey();
  const start = addMonths(end, -(months - 1));
  const keys = monthRange(start, end);
  const map = new Map(keys.map((k) => [k, { month: k, einnahmen: 0, ausgaben: 0, netto: 0 }]));
  for (const t of store.idx.transactions) {
    if (!isCountable(t, opts)) continue;
    const k = monthKey(t.date);
    const row = map.get(k);
    if (!row) continue;
    const v = amountBase(t);
    if (v >= 0) row.einnahmen += v; else row.ausgaben += -v;
  }
  for (const row of map.values()) {
    row.einnahmen = round2(row.einnahmen);
    row.ausgaben = round2(row.ausgaben);
    row.netto = round2(row.einnahmen - row.ausgaben);
    row.sparquote = row.einnahmen > 0 ? row.netto / row.einnahmen : 0;
  }
  return keys.map((k) => map.get(k));
}

/** Ausgaben je Kategorie in einem Zeitraum. */
export function spendingByCategory(from, to, opts = {}) {
  const map = new Map();
  for (const t of store.idx.transactions) {
    if (!isCountable(t, opts)) continue;
    if (t.date < from || t.date > to) continue;
    const v = amountBase(t);
    if (v >= 0 && !opts.includeIncome) continue;
    for (const p of countableParts(t)) {
      const key = p.categoryId || 'c_unkategorisiert';
      map.set(key, round2((map.get(key) || 0) + (opts.includeIncome ? p.base : -p.base)));
    }
  }
  return map;
}

/** Kontenübersicht für Listen und Widgets. */
export function accountsOverview() {
  const groups = { liquid: [], kredit: [], anlage: [], vorsorge: [] };
  for (const a of store.idx.accounts) {
    if (a.archived) continue;
    const info = accountTypeInfo(a.type);
    const bal = accountBalance(a);
    (groups[info.group] || groups.liquid).push({
      account: a, info, balance: bal, balanceBase: round2(toBase(bal, a.currency)),
    });
  }
  for (const k of Object.keys(groups)) groups[k].sort((a, b) => Math.abs(b.balanceBase) - Math.abs(a.balanceBase));
  return groups;
}

/** Verlauf eines einzelnen Kontos (für Sparkline / Detailseite). */
export function accountSeries(account, months = 12) {
  const end = currentMonthKey();
  const start = addMonths(end, -(months - 1));
  return monthRange(start, end).map((m) => ({ month: m, value: accountBalance(account, endOfMonth(m)) }));
}

/** Wiederkehrende Zahlungen erkennen (gleicher Empfänger, monatlich ähnlicher Betrag). */
export function detectRecurring(minOccurrences = 3) {
  const byPayee = new Map();
  for (const t of store.idx.transactions) {
    if (t.deleted || t.amount >= 0 || isTransferCategory(t.categoryId)) continue;
    const key = (t.payee || t.description || '').toLowerCase().slice(0, 28);
    if (!key) continue;
    if (!byPayee.has(key)) byPayee.set(key, []);
    byPayee.get(key).push(t);
  }
  const out = [];
  for (const [key, list] of byPayee) {
    if (list.length < minOccurrences) continue;
    const sorted = list.slice().sort(byDateAsc());
    const months = new Set(sorted.map((t) => monthKey(t.date)));
    if (months.size < minOccurrences) continue;
    const amounts = sorted.map((t) => Math.abs(amountBase(t)));
    const avg = sum(amounts) / amounts.length;
    const spread = Math.max(...amounts) - Math.min(...amounts);
    if (avg > 0 && spread / avg > 0.35) continue;
    const last = sorted[sorted.length - 1];
    out.push({
      key, payee: last.payee || key, categoryId: last.categoryId,
      averageAmount: round2(avg), occurrences: sorted.length,
      lastDate: last.date, accountId: last.accountId,
      nextExpected: addMonths(monthKey(last.date), 1) + '-' + last.date.slice(8),
      monthly: months.size >= sorted.length * 0.8,
    });
  }
  return out.sort((a, b) => b.averageAmount - a.averageAmount);
}
