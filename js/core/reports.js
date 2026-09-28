// reports.js — Abfrage-Engine für eigene Auswertungen
import { store } from './store.js';
import { amountBase, isTransferCategory, countableParts } from './analytics.js';
import {
  round2, monthKey, monthLabel, addMonths, currentMonthKey, startOfMonth, endOfMonth,
  todayISO, normText, colorFor, sum, parseISO, cmpStr, monthRange,
} from './util.js';

export const PERIOD_TYPES = [
  { id: 'thisMonth', label: 'Dieser Monat' },
  { id: 'lastMonth', label: 'Letzter Monat' },
  { id: 'last3', label: 'Letzte 3 Monate' },
  { id: 'last6', label: 'Letzte 6 Monate' },
  { id: 'last12', label: 'Letzte 12 Monate' },
  { id: 'thisYear', label: 'Dieses Jahr' },
  { id: 'lastYear', label: 'Letztes Jahr' },
  { id: 'allTime', label: 'Gesamter Zeitraum' },
  { id: 'custom', label: 'Eigener Zeitraum' },
];

export const GROUP_BY = [
  { id: 'category', label: 'Kategorie' },
  { id: 'group', label: 'Kategoriegruppe' },
  { id: 'month', label: 'Monat' },
  { id: 'year', label: 'Jahr' },
  { id: 'account', label: 'Konto' },
  { id: 'owner', label: 'Person' },
  { id: 'payee', label: 'Zahlungsempfänger' },
  { id: 'merchantCategory', label: 'Branche' },
  { id: 'weekday', label: 'Wochentag' },
  { id: 'tag', label: 'Schlagwort' },
];

export const METRICS = [
  { id: 'ausgaben', label: 'Ausgaben' },
  { id: 'einnahmen', label: 'Einnahmen' },
  { id: 'netto', label: 'Netto (Einnahmen − Ausgaben)' },
  { id: 'beides', label: 'Einnahmen und Ausgaben' },
  { id: 'sparquote', label: 'Sparquote' },
  { id: 'anzahl', label: 'Anzahl Buchungen' },
  { id: 'durchschnitt', label: 'Durchschnittsbetrag' },
];

export const CHART_TYPES = [
  { id: 'bar', label: 'Balken' },
  { id: 'line', label: 'Linie' },
  { id: 'donut', label: 'Ring' },
  { id: 'stacked', label: 'Gestapelt' },
  { id: 'table', label: 'Tabelle' },
];

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

/* ---------------- Zeitraum ---------------- */

export function resolvePeriod(period = { type: 'thisMonth' }) {
  const t = period?.type || 'thisMonth';
  const cm = currentMonthKey();
  const year = Number(cm.slice(0, 4));
  switch (t) {
    case 'thisMonth': return { from: startOfMonth(cm), to: endOfMonth(cm), label: monthLabel(cm) };
    case 'lastMonth': {
      const m = addMonths(cm, -1);
      return { from: startOfMonth(m), to: endOfMonth(m), label: monthLabel(m) };
    }
    case 'last3': case 'last6': case 'last12': {
      const n = Number(t.replace('last', ''));
      const start = addMonths(cm, -(n - 1));
      return { from: startOfMonth(start), to: endOfMonth(cm), label: `Letzte ${n} Monate` };
    }
    case 'thisYear': return { from: `${year}-01-01`, to: `${year}-12-31`, label: `${year}` };
    case 'lastYear': return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31`, label: `${year - 1}` };
    case 'allTime': {
      const dates = store.idx.transactions.map((x) => x.date).filter(Boolean).sort();
      return { from: dates[0] || '2000-01-01', to: dates[dates.length - 1] || todayISO(), label: 'Gesamter Zeitraum' };
    }
    case 'month': return { from: startOfMonth(period.month), to: endOfMonth(period.month), label: monthLabel(period.month) };
    case 'custom':
    default:
      return {
        from: period.from || `${year}-01-01`,
        to: period.to || todayISO(),
        label: `${period.from || ''} – ${period.to || ''}`,
      };
  }
}

/* ---------------- Filter ---------------- */

export function filterTransactions(config = {}) {
  const { from, to } = resolvePeriod(config.period);
  const f = config.filters || {};
  const search = normText(f.search || '');
  const accountSet = f.accountIds?.length ? new Set(f.accountIds) : null;
  const categorySet = f.categoryIds?.length ? new Set(f.categoryIds) : null;
  const groupSet = f.groupIds?.length ? new Set(f.groupIds) : null;
  const ownerSet = f.ownerIds?.length ? new Set(f.ownerIds) : null;
  const tagSet = f.tags?.length ? new Set(f.tags) : null;

  return store.idx.transactions.filter((t) => {
    if (t.deleted || (t.hidden && !f.includeHidden)) return false;
    if (t.date < from || t.date > to) return false;
    if (!f.includeTransfers && (t.isTransfer || isTransferCategory(t.categoryId))) return false;
    if (!f.includeExcluded && t.excludeFromBudget) return false;
    if (accountSet && !accountSet.has(t.accountId)) return false;
    if (categorySet && !categorySet.has(t.categoryId)) return false;
    if (groupSet) {
      const cat = store.category(t.categoryId);
      if (!cat || !groupSet.has(cat.groupId)) return false;
    }
    if (ownerSet && !ownerSet.has(t.ownerId)) return false;
    if (tagSet && !(t.tags || []).some((x) => tagSet.has(x))) return false;
    if (f.direction === 'ausgaben' && t.amount >= 0) return false;
    if (f.direction === 'einnahmen' && t.amount <= 0) return false;
    if (f.minAmount != null && Math.abs(t.amount) < Math.abs(f.minAmount)) return false;
    if (f.maxAmount != null && Math.abs(t.amount) > Math.abs(f.maxAmount)) return false;
    if (f.uncategorizedOnly && t.categoryId && t.categoryId !== 'c_unkategorisiert') return false;
    if (search) {
      const hay = normText([t.payee, t.description, t.notes, t.merchantCategory, t.rawText].join(' '));
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

/* ---------------- Gruppierung ---------------- */

function keyFor(txn, groupBy) {
  switch (groupBy) {
    case 'category': return txn.categoryId || 'c_unkategorisiert';
    case 'group': return store.category(txn.categoryId)?.groupId || 'g_sonstiges';
    case 'month': return monthKey(txn.date);
    case 'year': return txn.date.slice(0, 4);
    case 'account': return txn.accountId || '–';
    case 'owner': return txn.ownerId || '–';
    case 'payee': return (txn.payee || txn.description || '–').slice(0, 40);
    case 'merchantCategory': return txn.merchantCategory || '–';
    case 'weekday': return String(parseISO(txn.date).getDay());
    case 'tag': return (txn.tags || [])[0] || '–';
    default: return '–';
  }
}

function labelFor(key, groupBy, index) {
  switch (groupBy) {
    case 'category': return store.category(key)?.name || 'Nicht zugeordnet';
    case 'group': return store.group(key)?.name || 'Sonstiges';
    case 'month': return monthLabel(key, true);
    case 'account': return store.account(key)?.name || 'Unbekanntes Konto';
    case 'owner': return store.member(key)?.name || 'Ohne Person';
    case 'weekday': return WEEKDAYS[Number(key)] || key;
    default: return key;
  }
}

function colorForKey(key, groupBy, index) {
  if (groupBy === 'category') return store.category(key)?.color || store.group(store.category(key)?.groupId)?.color || colorFor(key, index);
  if (groupBy === 'group') return store.group(key)?.color || colorFor(key, index);
  if (groupBy === 'owner') return store.member(key)?.color || colorFor(key, index);
  if (groupBy === 'account') return store.account(key)?.color || colorFor(key, index);
  return colorFor(key, index);
}

/* ---------------- Auswertung ---------------- */

export function runReport(config = {}) {
  const cfg = {
    metric: 'ausgaben', groupBy: 'category', chart: 'donut',
    period: { type: 'thisMonth' }, filters: {}, limit: null, ...config,
  };
  const period = resolvePeriod(cfg.period);
  const txns = filterTransactions(cfg);

  // Aufgeteilte Buchungen fliessen anteilig in die jeweilige Kategorie bzw. Gruppe
  const splitAware = cfg.groupBy === 'category' || cfg.groupBy === 'group';
  const buckets = new Map();
  for (const t of txns) {
    const parts = splitAware
      ? countableParts(t).map((p) => ({
        key: cfg.groupBy === 'category' ? p.categoryId : (store.category(p.categoryId)?.groupId || 'g_sonstiges'),
        value: p.base,
      }))
      : [{ key: keyFor(t, cfg.groupBy), value: amountBase(t) }];
    for (const part of parts) {
      if (!buckets.has(part.key)) buckets.set(part.key, { key: part.key, ein: 0, aus: 0, count: 0, txns: [], ids: new Set() });
      const b = buckets.get(part.key);
      if (part.value >= 0) b.ein += part.value; else b.aus += -part.value;
      if (!b.ids.has(t.id)) { b.ids.add(t.id); b.count++; b.txns.push(t); }
    }
  }

  let rows = Array.from(buckets.values()).map((b, i) => {
    const einnahmen = round2(b.ein);
    const ausgaben = round2(b.aus);
    const netto = round2(einnahmen - ausgaben);
    let value;
    switch (cfg.metric) {
      case 'einnahmen': value = einnahmen; break;
      case 'netto': value = netto; break;
      case 'anzahl': value = b.count; break;
      case 'durchschnitt': value = b.count ? round2((ausgaben || einnahmen) / b.count) : 0; break;
      case 'sparquote': value = einnahmen > 0 ? netto / einnahmen : 0; break;
      case 'beides': value = ausgaben; break;
      case 'ausgaben':
      default: value = ausgaben;
    }
    return {
      key: b.key, label: labelFor(b.key, cfg.groupBy, i), color: colorForKey(b.key, cfg.groupBy, i),
      value, einnahmen, ausgaben, netto, count: b.count, txns: b.txns,
    };
  });

  const timeBased = cfg.groupBy === 'month' || cfg.groupBy === 'year';
  if (timeBased) rows.sort((a, b) => cmpStr(a.key, b.key));
  else if (cfg.groupBy === 'weekday') rows.sort((a, b) => Number(a.key) - Number(b.key));
  else rows.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  if (cfg.limit && rows.length > cfg.limit && !timeBased) {
    const head = rows.slice(0, cfg.limit);
    const tail = rows.slice(cfg.limit);
    head.push({
      key: '__rest', label: `Übrige (${tail.length})`, color: '#9a9a9a',
      value: round2(sum(tail, (r) => r.value)), einnahmen: round2(sum(tail, (r) => r.einnahmen)),
      ausgaben: round2(sum(tail, (r) => r.ausgaben)), netto: round2(sum(tail, (r) => r.netto)),
      count: sum(tail, (r) => r.count), txns: tail.flatMap((r) => r.txns),
    });
    rows = head;
  }

  const total = round2(sum(rows, (r) => r.value));
  for (const r of rows) r.share = total ? r.value / total : 0;

  return {
    config: cfg, period, rows, total, timeBased,
    transactions: txns,
    totals: {
      einnahmen: round2(sum(rows, (r) => r.einnahmen)),
      ausgaben: round2(sum(rows, (r) => r.ausgaben)),
      netto: round2(sum(rows, (r) => r.netto)),
      // über die Buchungen zählen, nicht über die Gruppen: eine aufgeteilte
      // Buchung erscheint in mehreren Gruppen, bleibt aber eine Buchung
      count: txns.length,
    },
  };
}

/** Gestapelte Auswertung: Zeitachse × zweite Dimension. */
export function runStacked(config = {}) {
  const cfg = { groupBy: 'group', stackBy: 'month', metric: 'ausgaben', ...config };
  const txns = filterTransactions(cfg);
  const periods = new Set();
  const seriesMap = new Map();
  const splitAware = cfg.groupBy === 'category' || cfg.groupBy === 'group';
  for (const t of txns) {
    const p = keyFor(t, 'month');
    periods.add(p);
    const parts = splitAware
      ? countableParts(t).map((x) => ({
        key: cfg.groupBy === 'category' ? x.categoryId : (store.category(x.categoryId)?.groupId || 'g_sonstiges'),
        value: x.base,
      }))
      : [{ key: keyFor(t, cfg.groupBy), value: amountBase(t) }];
    for (const part of parts) {
      if (!seriesMap.has(part.key)) seriesMap.set(part.key, new Map());
      const v = part.value;
      const val = cfg.metric === 'einnahmen' ? Math.max(0, v) : cfg.metric === 'netto' ? v : Math.max(0, -v);
      seriesMap.get(part.key).set(p, round2((seriesMap.get(part.key).get(p) || 0) + val));
    }
  }
  // Achse aus dem gewählten Zeitraum aufbauen, nicht aus den vorhandenen Buchungen –
  // ein Monat ohne Umsatz soll als Null erscheinen und nicht fehlen.
  const range = resolvePeriod(cfg.period);
  const axis = monthRange(monthKey(range.from), monthKey(range.to));
  const periodList = axis.length ? axis : Array.from(periods).sort();
  const series = Array.from(seriesMap.entries())
    .map(([key, map], i) => ({
      key, label: labelFor(key, cfg.groupBy, i), color: colorForKey(key, cfg.groupBy, i),
      values: periodList.map((p) => map.get(p) || 0),
      total: round2(sum(Array.from(map.values()))),
    }))
    .sort((a, b) => b.total - a.total);
  return { periods: periodList, periodLabels: periodList.map((p) => monthLabel(p, true)), series, config: cfg };
}

/** Vergleich zweier Zeiträume (z. B. Monat gegen Vormonat). */
export function compareReport(config, offsetMonths = -1) {
  const current = runReport(config);
  const p = config.period || { type: 'thisMonth' };
  const cm = currentMonthKey();
  let prevPeriod = null;

  switch (p.type) {
    case 'thisMonth': prevPeriod = { type: 'month', month: addMonths(cm, offsetMonths) }; break;
    case 'lastMonth': prevPeriod = { type: 'month', month: addMonths(cm, -2) }; break;
    case 'month': prevPeriod = { type: 'month', month: addMonths(p.month, offsetMonths) }; break;
    case 'thisYear': prevPeriod = { type: 'lastYear' }; break;
    case 'lastYear': {
      const y = Number(cm.slice(0, 4)) - 2;
      prevPeriod = { type: 'custom', from: `${y}-01-01`, to: `${y}-12-31` };
      break;
    }
    case 'last3': case 'last6': case 'last12': {
      // Das gleich lange Fenster davor
      const n = Number(p.type.replace('last', ''));
      const end = addMonths(cm, -n);
      const start = addMonths(end, -(n - 1));
      prevPeriod = { type: 'custom', from: startOfMonth(start), to: endOfMonth(end) };
      break;
    }
    case 'custom': {
      if (p.from && p.to) {
        const days = Math.round((parseISO(p.to) - parseISO(p.from)) / 86400000) + 1;
        const to = new Date(parseISO(p.from).getTime() - 86400000);
        const from = new Date(to.getTime() - (days - 1) * 86400000);
        const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        prevPeriod = { type: 'custom', from: iso(from), to: iso(to) };
      }
      break;
    }
    default: prevPeriod = null;
  }

  if (!prevPeriod) return { ...current, previousTotal: undefined, delta: undefined };

  const previous = runReport({ ...config, period: prevPeriod });
  const byKey = new Map(previous.rows.map((r) => [r.key, r]));
  const rows = current.rows.map((r) => {
    const prev = byKey.get(r.key);
    const prevVal = prev ? prev.value : 0;
    return { ...r, previous: prevVal, delta: round2(r.value - prevVal), deltaPct: prevVal ? (r.value - prevVal) / prevVal : null };
  });
  return {
    ...current, rows,
    previousTotal: previous.total,
    previousLabel: resolvePeriod(prevPeriod).label,
    delta: round2(current.total - previous.total),
  };
}
