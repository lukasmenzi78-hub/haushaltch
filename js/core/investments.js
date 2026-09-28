// investments.js — Bewertung des Wertschriftendepots
import { store } from './store.js';
import { toBase, convert } from './fx.js';
import { newSnapshot, ASSET_CLASSES, REGIONS } from './model.js';
import { round2, sum, todayISO, monthKey, addMonths, currentMonthKey, monthRange, sortBy, groupBy } from './util.js';

/* ---------------- Einzelposition ---------------- */

export function positionValue(h) {
  return round2((Number(h.quantity) || 0) * (Number(h.lastPrice) || 0));
}

export function positionCost(h) {
  return round2((Number(h.quantity) || 0) * (Number(h.avgCost) || 0));
}

/** Kennzahlen einer Position, in Positions- und in Basiswährung. */
export function evaluatePosition(h) {
  const value = positionValue(h);
  const cost = positionCost(h);
  const gain = round2(value - cost);
  const valueBase = round2(toBase(value, h.currency));
  const costBase = h.avgCostBase
    ? round2((Number(h.quantity) || 0) * Number(h.avgCostBase))
    : round2(toBase(cost, h.currency));
  return {
    holding: h,
    value, cost, gain,
    gainPct: cost > 0 ? gain / cost : 0,
    valueBase, costBase,
    gainBase: round2(valueBase - costBase),
    gainBasePct: costBase > 0 ? (valueBase - costBase) / costBase : 0,
    // Nur aussagekräftig, wenn der Einstand in Basiswährung bekannt ist
    fxEffect: h.avgCostBase ? round2((valueBase - costBase) - toBase(gain, h.currency)) : null,
    dayChangeBase: h.dayChange === null || h.dayChange === undefined ? null : round2(toBase(h.dayChange, h.currency)),
    stale: isStale(h),
  };
}

export function isStale(h, days = 4) {
  if (!h.lastPriceAt) return true;
  return (Date.now() - h.lastPriceAt) > days * 86400000;
}

/* ---------------- Depotübersicht ---------------- */

export function portfolio({ accountId = null } = {}) {
  const holdings = store.idx.holdings.filter((h) => !accountId || h.accountId === accountId);
  const rows = holdings.map(evaluatePosition).sort((a, b) => b.valueBase - a.valueBase);
  const valueBase = round2(sum(rows, (r) => r.valueBase));
  const costBase = round2(sum(rows, (r) => r.costBase));
  const cashBase = round2(sum(
    store.idx.accounts.filter((a) => a.type === 'depot' && (!accountId || a.id === accountId)),
    (a) => toBase(Number(a.cashBalance) || 0, a.currency),
  ));
  const dayRows = rows.filter((r) => r.dayChangeBase !== null);
  for (const r of rows) r.share = valueBase ? r.valueBase / valueBase : 0;
  return {
    rows, valueBase, costBase, cashBase,
    totalBase: round2(valueBase + cashBase),
    gainBase: round2(valueBase - costBase),
    gainPct: costBase > 0 ? (valueBase - costBase) / costBase : 0,
    dayChangeBase: dayRows.length ? round2(sum(dayRows, (r) => r.dayChangeBase)) : null,
    positions: rows.length,
    oldestPrice: rows.reduce((a, r) => (r.holding.lastPriceAt && (!a || r.holding.lastPriceAt < a) ? r.holding.lastPriceAt : a), null),
    staleCount: rows.filter((r) => r.stale).length,
  };
}

/* ---------------- Allokation ---------------- */

function allocate(rows, keyFn, labelFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, { key: k, label: labelFn(k), value: 0, count: 0 });
    const e = map.get(k);
    e.value = round2(e.value + r.valueBase);
    e.count++;
  }
  const list = Array.from(map.values()).sort((a, b) => b.value - a.value);
  const total = sum(list, (x) => x.value);
  for (const x of list) x.share = total ? x.value / total : 0;
  return list;
}

export function allocation(rows, dimension = 'assetClass') {
  const paint = (list) => list.map((x, i) => ({ ...x, color: x.color || `var(--series-${(i % 8) + 1})` }));
  switch (dimension) {
    case 'currency':
      return paint(allocate(rows, (r) => r.holding.currency, (k) => k));
    case 'region':
      return paint(allocate(rows, (r) => r.holding.region || 'unbekannt',
        (k) => REGIONS.find((x) => x.id === k)?.label || k));
    case 'position':
      return rows.slice(0, 10).map((r, i) => ({
        key: r.holding.id, label: r.holding.symbol || r.holding.name,
        color: `var(--series-${(i % 8) + 1})`, value: r.valueBase, share: r.share, count: 1,
      }));
    case 'assetClass':
    default:
      return allocate(rows, (r) => r.holding.assetClass || 'sonstiges',
        (k) => ASSET_CLASSES.find((x) => x.id === k)?.label || k)
        .map((x) => ({ ...x, color: ASSET_CLASSES.find((c) => c.id === x.key)?.color }))
        .map((x, i) => ({ ...x, color: x.color || `var(--series-${(i % 8) + 1})` }));
  }
}

/* ---------------- Verlauf und Beitrag ---------------- */

/** Schreibt den heutigen Stand fort – Grundlage für den Verlaufschart. */
export function writeSnapshot(date = todayISO()) {
  const p = portfolio();
  if (!p.positions) return null;
  // Wert je Depot festhalten, damit die Vermögenskurve rückwirkend stimmt
  const byAccount = {};
  for (const r of p.rows) {
    const key = r.holding.accountId || '_ohne';
    byAccount[key] = round2((byAccount[key] || 0) + r.valueBase);
  }
  const snap = newSnapshot({
    date, valueBase: p.valueBase, costBase: p.costBase, cashBase: p.cashBase, positions: p.positions, byAccount,
  });
  store.upsert('snapshots', snap, 'Depotstand erfasst');
  return snap;
}

/**
 * Einzahlungen ins Depot.
 * Eine Überweisung erscheint oft zweimal – als Abgang auf dem Giro und als Eingang im
 * Depot. Gezählt wird deshalb nur eine Seite: sind Depotbuchungen vorhanden, gelten
 * diese, sonst die Buchungen der Kategorie „Wertschriften-Käufe“.
 */
export function contributions(fromDate, toDate) {
  const depotIds = new Set(store.idx.accounts.filter((a) => a.type === 'depot').map((a) => a.id));
  const inRange = store.idx.transactions.filter((t) => !t.deleted && !t.hidden && t.date >= fromDate && t.date <= toDate);
  const depotRows = inRange.filter((t) => depotIds.has(t.accountId));
  const useDepotSide = depotRows.length > 0;

  const rows = useDepotSide
    ? depotRows.filter((t) => t.categoryId !== 'c_kapitalertrag')
    : inRange.filter((t) => t.categoryId === 'c_investition');

  let total = 0;
  const items = [];
  for (const t of rows) {
    // Vorzeichen beibehalten: ein Bezug aus dem Depot ist eine negative Einzahlung
    const v = useDepotSide
      ? toBase(t.amount, t.currency, t.date)
      : -toBase(t.amount, t.currency, t.date);
    total += v;
    items.push({ date: t.date, amount: round2(v), payee: t.payee });
  }
  return { total: round2(total), items: sortBy(items, (x) => x.date), source: useDepotSide ? 'depot' : 'kategorie' };
}

/**
 * Verlauf über n Monate. Nutzt echte Tagesstände, wo vorhanden;
 * Monate ohne Stand bleiben leer (keine erfundenen Werte).
 */
export function valueHistory(months = 12) {
  const end = currentMonthKey();
  const keys = monthRange(addMonths(end, -(months - 1)), end);
  const byMonth = new Map();
  for (const s of store.idx.snapshots) {
    const k = monthKey(s.date);
    const cur = byMonth.get(k);
    if (!cur || s.date > cur.date) byMonth.set(k, s);
  }
  let last = null;
  return keys.map((k) => {
    const snap = byMonth.get(k);
    if (snap) last = snap;
    return {
      month: k,
      value: snap ? snap.valueBase : null,
      cost: snap ? snap.costBase : null,
      carried: !snap && last ? last.valueBase : null,
    };
  });
}

/** Zerlegt die Wertveränderung in Einzahlungen und Marktbewegung. */
export function performanceBreakdown(months = 12) {
  const hist = valueHistory(months).filter((x) => x.value !== null);
  if (hist.length < 2) {
    const p = portfolio();
    return {
      enoughData: false,
      valueNow: p.valueBase,
      gain: p.gainBase,
      note: 'Für die Zerlegung braucht es mindestens zwei erfasste Depotstände. '
        + 'Die App schreibt bei jeder Kursaktualisierung einen Stand fort.',
    };
  }
  const first = hist[0];
  const last = hist[hist.length - 1];
  const from = `${first.month}-01`;
  const to = `${last.month}-31`;
  const contrib = contributions(from, to);
  const change = round2(last.value - first.value);
  return {
    enoughData: true,
    from: first.month, to: last.month,
    startValue: first.value, endValue: last.value,
    change,
    contributions: contrib.total,
    market: round2(change - contrib.total),
    series: hist,
  };
}

/* ---------------- Dividenden ---------------- */

export function dividendsByYear() {
  const map = new Map();
  for (const d of store.idx.dividends) {
    const year = String(d.date).slice(0, 4);
    if (!map.has(year)) map.set(year, { year, gross: 0, withholding: 0, net: 0, count: 0, bySymbol: new Map() });
    const e = map.get(year);
    const gross = toBase(Number(d.amount) || 0, d.currency, d.date);
    const wh = toBase(Number(d.withholding) || 0, d.currency, d.date);
    e.gross = round2(e.gross + gross);
    e.withholding = round2(e.withholding + wh);
    e.net = round2(e.gross - e.withholding);
    e.count++;
    const sym = d.symbol || store.holding(d.holdingId)?.symbol || '—';
    e.bySymbol.set(sym, round2((e.bySymbol.get(sym) || 0) + gross));
  }
  return Array.from(map.values()).sort((a, b) => (a.year < b.year ? 1 : -1));
}

export function dividendYield() {
  const p = portfolio();
  const last12 = store.idx.dividends.filter((d) => d.date >= `${addMonths(currentMonthKey(), -11)}-01`);
  const total = round2(sum(last12, (d) => toBase(Number(d.amount) || 0, d.currency, d.date)));
  return { amount: total, pct: p.valueBase > 0 ? total / p.valueBase : 0 };
}

/* ---------------- Positionen zusammenführen ---------------- */

/** Führt importierte Positionen mit den bestehenden zusammen (Schlüssel: Symbol + Konto). */
export function mergeHoldings(incoming, { accountId = null, replaceMissing = false } = {}) {
  const existing = store.idx.allHoldings;
  const key = (h) => `${(h.symbol || '').toUpperCase()}|${h.accountId || accountId || ''}`;
  const byKey = new Map(existing.map((h) => [key(h), h]));
  const updates = [];
  const seen = new Set();
  let added = 0, changed = 0;

  for (const inc of incoming) {
    const k = key({ ...inc, accountId: inc.accountId || accountId });
    seen.add(k);
    const prev = byKey.get(k);
    if (prev) {
      updates.push({
        ...prev, ...inc,
        id: prev.id,
        accountId: inc.accountId || prev.accountId || accountId,
        // Manuell gepflegte Angaben nicht überschreiben, wenn der Import nichts liefert
        name: inc.name || prev.name,
        assetClass: inc.assetClass || prev.assetClass,
        region: inc.region && inc.region !== 'unbekannt' ? inc.region : prev.region,
        notes: prev.notes,
      });
      changed++;
    } else {
      updates.push({ ...inc, accountId: inc.accountId || accountId });
      added++;
    }
  }

  // Positionen, die im Auszug fehlen, gelten als verkauft
  let closed = 0;
  if (replaceMissing) {
    for (const h of existing) {
      if (accountId && h.accountId !== accountId) continue;
      if (seen.has(key(h))) continue;
      updates.push({ ...h, quantity: 0, archived: true });
      closed++;
    }
  }
  if (updates.length) store.upsertMany('holdings', updates, 'Positionen aktualisiert');
  return { added, changed, closed };
}
