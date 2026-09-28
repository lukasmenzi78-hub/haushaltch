// budget.js — Flex-Budget nach Monarch-Vorbild, angepasst an Schweizer Fixkosten
import { store } from './store.js';
import { amountBase, isTransferCategory, countableParts } from './analytics.js';
import { round2, monthKey, addMonths, currentMonthKey, daysInMonth, startOfMonth, endOfMonth, sum, monthRange, todayISO } from './util.js';
import { newBudgetEntry } from './model.js';

export const FLEX_TYPES = ['flex'];
export const FIXED_TYPES = ['fix'];
export const RESERVE_TYPES = ['unregelmaessig'];
export const SAVING_TYPES = ['sparen'];

export function budgetEntry(period, categoryId) {
  return store.idx.budgets.find((b) => b.period === period && b.categoryId === categoryId) || null;
}

export function budgetAmount(period, categoryId) {
  const e = budgetEntry(period, categoryId);
  if (e) return e.amount;
  const cat = store.category(categoryId);
  if (cat?.annualAmount) return round2(cat.annualAmount / 12);
  return 0;
}

export function setBudget(period, categoryId, amount, note = '') {
  const entry = newBudgetEntry({ period, categoryId, amount: round2(Number(amount) || 0), note });
  store.upsert('budgets', entry, 'Budget geändert');
  return entry;
}

export function clearBudget(period, categoryId) {
  const e = budgetEntry(period, categoryId);
  if (e) store.hardRemove('budgets', e.id, 'Budget entfernt');
}

/** Tatsächliche Beträge je Kategorie in einem Monat (positiv = Ausgabe, Einnahmen positiv). */
export function actualsForMonth(period, opts = {}) {
  const from = startOfMonth(period);
  const to = endOfMonth(period);
  const map = new Map();
  for (const t of store.idx.transactions) {
    if (t.deleted || t.hidden) continue;
    if (t.date < from || t.date > to) continue;
    if (t.excludeFromBudget) continue;
    if (t.isTransfer || isTransferCategory(t.categoryId)) continue;
    if (opts.ownerId && t.ownerId !== opts.ownerId) continue;
    for (const p of countableParts(t)) {
      const cat = store.category(p.categoryId);
      const signed = cat?.budgetType === 'einkommen' ? p.base : -p.base;   // Ausgaben positiv machen
      map.set(p.categoryId, round2((map.get(p.categoryId) || 0) + signed));
    }
  }
  return map;
}

/** Übertrag (Rollover) einer Kategorie bis zum Beginn des Monats. */
export function rolloverFor(period, categoryId, cache = null, cached = null) {
  const cat = store.category(categoryId);
  if (!cat?.rollover) return 0;
  const budgets = store.idx.budgets.filter((b) => b.categoryId === categoryId).map((b) => b.period).sort();
  if (!budgets.length) return 0;
  const startPeriod = budgets[0];
  if (period <= startPeriod) return 0;
  let carry = 0;
  for (const m of monthRange(startPeriod, addMonths(period, -1))) {
    const budget = budgetAmount(m, categoryId);
    const actual = (cached ? cached(m) : (cache?.get(m) || actualsForMonth(m))).get(categoryId) || 0;
    carry = round2(carry + budget - actual);
    if (carry < 0 && !cat.rolloverNegative) carry = 0;
  }
  return carry;
}

/** Vollständige Budgetübersicht eines Monats. */
export function monthOverview(period = currentMonthKey(), opts = {}) {
  const actuals = actualsForMonth(period, opts);
  // Ein Cache über alle Monate: rolloverFor braucht die Vormonate je Kategorie,
  // ohne Zwischenspeicher wird derselbe Monat dutzendfach neu durchgerechnet.
  const cache = new Map([[period, actuals]]);
  const cached = (m) => {
    if (!cache.has(m)) cache.set(m, actualsForMonth(m, opts));
    return cache.get(m);
  };
  const groups = [];

  for (const g of store.idx.groups.slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))) {
    // Archivierte Kategorien bleiben sichtbar, solange sie im Monat Bewegungen haben –
    // sonst fehlt ihr Betrag in der Budgetsumme, steht aber im Cashflow.
    const archivedWithActivity = store.idx.categories.filter(
      (c) => c.groupId === g.id && c.archived && Math.abs(actuals.get(c.id) || 0) > 0.005,
    );
    const cats = [...store.categoriesOfGroup(g.id), ...archivedWithActivity].map((c) => {
      const budget = budgetAmount(period, c.id);
      const actual = round2(actuals.get(c.id) || 0);
      const carry = rolloverFor(period, c.id, cache, cached);
      const available = round2(budget + carry - actual);
      return {
        category: c, budget, actual, carry, available,
        progress: (budget + carry) > 0 ? actual / (budget + carry) : (actual > 0 ? 1 : 0),
        hasBudget: !!budgetEntry(period, c.id) || !!c.annualAmount,
      };
    });
    const visible = opts.hideEmpty
      ? cats.filter((r) => r.budget || r.actual || r.carry)
      : cats;
    if (!visible.length) continue;
    groups.push({
      group: g,
      rows: visible,
      budget: round2(sum(cats, (r) => r.budget)),
      actual: round2(sum(cats, (r) => r.actual)),
      available: round2(sum(cats, (r) => r.available)),
    });
  }

  const byType = (types) => store.idx.categories.filter((c) => types.includes(c.budgetType)
    && (!c.archived || Math.abs(actuals.get(c.id) || 0) > 0.005));
  const totalOf = (cats, field) => round2(sum(cats, (c) => field === 'budget' ? budgetAmount(period, c.id) : (actuals.get(c.id) || 0)));

  const incomeCats = byType(['einkommen']);
  const fixedCats = byType(FIXED_TYPES);
  const reserveCats = byType(RESERVE_TYPES);
  const savingCats = byType(SAVING_TYPES);
  const flexCats = byType(FLEX_TYPES);

  const incomePlanned = totalOf(incomeCats, 'budget');
  const incomeActual = totalOf(incomeCats, 'actual');
  const fixedPlanned = totalOf(fixedCats, 'budget');
  const fixedActual = totalOf(fixedCats, 'actual');
  const reservePlanned = round2(sum(reserveCats, (c) => budgetAmount(period, c.id)));
  const reserveActual = totalOf(reserveCats, 'actual');
  const savingPlanned = totalOf(savingCats, 'budget');
  const savingActual = totalOf(savingCats, 'actual');
  const flexPlanned = totalOf(flexCats, 'budget');
  const flexActual = totalOf(flexCats, 'actual');

  const incomeBasis = incomePlanned > 0 ? incomePlanned : incomeActual;
  const bufferPct = Number(store.settings.flexBufferPct || 0) / 100;
  const flexPool = round2(Math.max(0, (incomeBasis - fixedPlanned - reservePlanned - savingPlanned) * (1 - bufferPct)));
  const flexRemaining = round2(flexPool - flexActual);

  const isCurrent = period === currentMonthKey();
  const totalDays = daysInMonth(period);
  const dayOfMonth = isCurrent ? Number(todayISO().slice(8, 10)) : totalDays;
  const daysLeft = Math.max(0, totalDays - dayOfMonth);
  const expectedByNow = round2(flexPool * (dayOfMonth / totalDays));

  return {
    period, groups, actuals,
    income: { planned: incomePlanned, actual: incomeActual, basis: incomeBasis },
    fixed: { planned: fixedPlanned, actual: fixedActual },
    reserves: { planned: reservePlanned, actual: reserveActual },
    savings: { planned: savingPlanned, actual: savingActual },
    flex: {
      planned: flexPlanned,
      pool: flexPool,
      spent: flexActual,
      remaining: flexRemaining,
      perDay: daysLeft > 0 ? round2(flexRemaining / daysLeft) : flexRemaining,
      daysLeft, dayOfMonth, totalDays,
      pace: expectedByNow > 0 ? flexActual / expectedByNow : 0,
      expectedByNow,
      onTrack: flexActual <= expectedByNow * 1.05,
    },
    summary: {
      totalPlannedOut: round2(fixedPlanned + reservePlanned + savingPlanned + flexPool),
      totalActualOut: round2(fixedActual + reserveActual + savingActual + flexActual),
      leftToBudget: round2(incomeBasis - fixedPlanned - reservePlanned - savingPlanned - flexPool),
      netActual: round2(incomeActual - fixedActual - reserveActual - savingActual - flexActual),
    },
  };
}

/** Budgets aus einem anderen Monat übernehmen. */
export function copyBudgets(fromPeriod, toPeriod) {
  const entries = store.idx.budgets.filter((b) => b.period === fromPeriod);
  const copies = entries.map((b) => newBudgetEntry({ period: toPeriod, categoryId: b.categoryId, amount: b.amount, note: b.note }));
  if (copies.length) store.upsertMany('budgets', copies, 'Budgets kopiert');
  return copies.length;
}

/** Budgets aus dem Durchschnitt der letzten n Monate vorschlagen. */
export function suggestBudgets(period, lookback = 3, { onlyEmpty = true } = {}) {
  const months = monthRange(addMonths(period, -lookback), addMonths(period, -1));
  const totals = new Map();
  for (const m of months) {
    const a = actualsForMonth(m);
    for (const [cat, val] of a) totals.set(cat, (totals.get(cat) || 0) + val);
  }
  const entries = [];
  for (const [categoryId, total] of totals) {
    const cat = store.category(categoryId);
    if (!cat || cat.budgetType === 'transfer') continue;
    if (onlyEmpty && budgetEntry(period, categoryId)) continue;
    const avg = round2(total / months.length);
    if (Math.abs(avg) < 1) continue;
    entries.push(newBudgetEntry({ period, categoryId, amount: Math.abs(avg), note: `Ø ${lookback} Monate` }));
  }
  return entries;
}

export function applySuggestions(entries) {
  if (entries.length) store.upsertMany('budgets', entries, 'Budgetvorschläge übernommen');
  return entries.length;
}

/** Jahresübersicht einer Kategorie (für die Detailansicht). */
export function categoryHistory(categoryId, months = 12, endPeriod = currentMonthKey()) {
  const start = addMonths(endPeriod, -(months - 1));
  return monthRange(start, endPeriod).map((m) => ({
    month: m,
    budget: budgetAmount(m, categoryId),
    actual: round2(actualsForMonth(m).get(categoryId) || 0),
  }));
}
