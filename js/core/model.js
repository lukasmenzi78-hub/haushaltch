// model.js — Datenschema, Standardwerte, Migration und Merge-Logik
import { uid, now, clone, todayISO } from './util.js';
import { DEFAULT_CATEGORY_GROUPS, DEFAULT_CATEGORIES, DEFAULT_RULES } from './categories.js';

export const SCHEMA_VERSION = 3;

/** Alle Sammlungen sind Arrays von Records mit { id, updatedAt, deleted? }.
 *  Dadurch lässt sich ein Dokument zweier Geräte record-genau zusammenführen. */
export const COLLECTIONS = [
  'accounts', 'transactions', 'categoryGroups', 'categories', 'rules',
  'budgets', 'goals', 'assets', 'reports', 'widgets', 'fxRates', 'imports', 'recurring',
  'holdings', 'dividends', 'snapshots',
];

export const ACCOUNT_TYPES = [
  { id: 'giro', label: 'Privatkonto', group: 'liquid', sign: 1 },
  { id: 'sparen', label: 'Sparkonto', group: 'liquid', sign: 1 },
  { id: 'kreditkarte', label: 'Kreditkarte', group: 'kredit', sign: -1 },
  { id: 'bargeld', label: 'Bargeld', group: 'liquid', sign: 1 },
  { id: 'depot', label: 'Wertschriftendepot', group: 'anlage', sign: 1 },
  { id: 'vorsorge3a', label: 'Säule 3a', group: 'vorsorge', sign: 1 },
  { id: 'freizuegigkeit', label: 'Freizügigkeit / Säule 2', group: 'vorsorge', sign: 1 },
  { id: 'darlehen', label: 'Darlehen / Kredit', group: 'kredit', sign: -1 },
  { id: 'hypothek', label: 'Hypothek', group: 'kredit', sign: -1 },
];

export const ASSET_TYPES = [
  { id: 'immobilie', label: 'Immobilie', side: 'asset' },
  { id: 'fahrzeug', label: 'Fahrzeug', side: 'asset' },
  { id: 'wertgegenstand', label: 'Wertgegenstand', side: 'asset' },
  { id: 'beteiligung', label: 'Beteiligung', side: 'asset' },
  { id: 'sonstiges_aktiv', label: 'Sonstiges Vermögen', side: 'asset' },
  { id: 'hypothek', label: 'Hypothek', side: 'liability' },
  { id: 'kredit', label: 'Kredit', side: 'liability' },
  { id: 'steuerschuld', label: 'Steuerschuld', side: 'liability' },
  { id: 'sonstiges_passiv', label: 'Sonstige Verbindlichkeit', side: 'liability' },
];

export const ASSET_CLASSES = [
  { id: 'etf', label: 'ETF', color: 'var(--series-1)' },
  { id: 'aktie', label: 'Einzelaktie', color: 'var(--series-2)' },
  { id: 'fonds', label: 'Fonds', color: 'var(--series-3)' },
  { id: 'anleihe', label: 'Anleihe', color: 'var(--series-4)' },
  { id: 'krypto', label: 'Krypto', color: 'var(--series-5)' },
  { id: 'rohstoff', label: 'Rohstoff', color: 'var(--series-7)' },
  { id: 'bargeld', label: 'Barbestand', color: 'var(--ink-muted)' },
  { id: 'sonstiges', label: 'Sonstiges', color: 'var(--series-8)' },
];

export const REGIONS = [
  { id: 'welt', label: 'Welt' },
  { id: 'usa', label: 'USA' },
  { id: 'europa', label: 'Europa' },
  { id: 'schweiz', label: 'Schweiz' },
  { id: 'schwellen', label: 'Schwellenländer' },
  { id: 'unbekannt', label: 'Nicht zugeordnet' },
];

/** Budget-Typ steuert das Flex-Budget. */
export const BUDGET_TYPES = [
  { id: 'einkommen', label: 'Einkommen', hint: 'Zufluss – bildet die Basis des Budgets' },
  { id: 'fix', label: 'Fixkosten', hint: 'Jeden Monat etwa gleich hoch (Miete, Krankenkasse, Abos)' },
  { id: 'unregelmaessig', label: 'Unregelmässig', hint: 'Fällt selten an – wird monatlich zurückgestellt (Steuern, Ferien, Versicherungen)' },
  { id: 'flex', label: 'Flexibel', hint: 'Alltagsausgaben – bilden zusammen den flexiblen Topf' },
  { id: 'transfer', label: 'Übertrag', hint: 'Geld wechselt nur das Konto – wird im Budget ignoriert' },
  { id: 'sparen', label: 'Sparen & Vorsorge', hint: 'Zahlung an ein Sparziel oder die Vorsorge' },
];

export function newDoc(opts = {}) {
  const t = now();
  const doc = {
    schemaVersion: SCHEMA_VERSION,
    docId: uid('doc'),
    settings: {
      updatedAt: t,
      baseCurrency: 'CHF',
      householdName: opts.householdName || 'Haushalt',
      members: [
        { id: 'u_lukas', name: 'Lukas', color: '#3b7ea1' },
        { id: 'u_lea', name: 'Lea', color: '#c96f4a' },
        { id: 'u_gemeinsam', name: 'Gemeinsam', color: '#5b8c5a' },
      ],
      activeMemberId: 'u_lukas',
      startMonth: null,          // null = automatisch aus den Daten
      flexBufferPct: 0,          // Sicherheitspuffer auf dem Flex-Topf
      hideZeroCategories: true,
      theme: 'auto',
      fxAutoUpdate: true,
      lastFxUpdate: null,
      dashboardPeriod: 'thisMonth',
    },
  };
  for (const c of COLLECTIONS) doc[c] = [];
  doc.categoryGroups = DEFAULT_CATEGORY_GROUPS.map((g, i) => ({ ...g, sort: i, updatedAt: t }));
  doc.categories = DEFAULT_CATEGORIES.map((c, i) => ({ ...c, sort: i, updatedAt: t }));
  doc.rules = DEFAULT_RULES.map((r, i) => ({ ...r, id: r.id || uid('rule'), sort: i, enabled: true, system: true, updatedAt: t }));
  doc.widgets = defaultWidgets(t);
  doc.reports = defaultReports(t);
  return doc;
}

export function defaultWidgets(t = now()) {
  return [
    { id: 'w_networth', type: 'networth', title: 'Nettovermögen', size: 'wide', sort: 0, config: { months: 12 }, updatedAt: t },
    { id: 'w_flex', type: 'flexbudget', title: 'Flex-Budget', size: 'normal', sort: 1, config: {}, updatedAt: t },
    { id: 'w_cashflow', type: 'cashflow', title: 'Cashflow', size: 'normal', sort: 2, config: { months: 6 }, updatedAt: t },
    { id: 'w_cats', type: 'topcategories', title: 'Grösste Ausgaben', size: 'normal', sort: 3, config: { limit: 8 }, updatedAt: t },
    { id: 'w_accounts', type: 'accounts', title: 'Konten', size: 'normal', sort: 4, config: {}, updatedAt: t },
    { id: 'w_goals', type: 'goals', title: 'Sparziele', size: 'normal', sort: 5, config: {}, updatedAt: t },
    { id: 'w_depot', type: 'depot', title: 'Wertschriftendepot', size: 'normal', sort: 6, config: {}, updatedAt: t },
    { id: 'w_recent', type: 'recent', title: 'Letzte Buchungen', size: 'wide', sort: 7, config: { limit: 12 }, updatedAt: t },
  ];
}

export function defaultReports(t = now()) {
  return [
    {
      id: 'r_ausgaben_kat', name: 'Ausgaben nach Kategorie', builtin: true, sort: 0, updatedAt: t,
      config: { metric: 'ausgaben', groupBy: 'category', chart: 'donut', period: { type: 'thisMonth' }, filters: {} },
    },
    {
      id: 'r_cashflow', name: 'Cashflow pro Monat', builtin: true, sort: 1, updatedAt: t,
      config: { metric: 'beides', groupBy: 'month', chart: 'bar', period: { type: 'last12' }, filters: {} },
    },
    {
      id: 'r_gruppen_trend', name: 'Trend nach Kategoriegruppe', builtin: true, sort: 2, updatedAt: t,
      config: { metric: 'ausgaben', groupBy: 'group', chart: 'stacked', period: { type: 'last12' }, filters: {} },
    },
    {
      id: 'r_haendler', name: 'Top-Händler', builtin: true, sort: 3, updatedAt: t,
      config: { metric: 'ausgaben', groupBy: 'payee', chart: 'table', period: { type: 'thisYear' }, filters: {}, limit: 30 },
    },
    {
      id: 'r_person', name: 'Ausgaben pro Person', builtin: true, sort: 4, updatedAt: t,
      config: { metric: 'ausgaben', groupBy: 'owner', chart: 'bar', period: { type: 'thisYear' }, filters: {} },
    },
    {
      id: 'r_sparquote', name: 'Sparquote', builtin: true, sort: 5, updatedAt: t,
      config: { metric: 'sparquote', groupBy: 'month', chart: 'line', period: { type: 'last12' }, filters: {} },
    },
  ];
}

/* ---------------- Record-Fabriken ---------------- */

export function newAccount(patch = {}) {
  return {
    id: uid('acc'), name: 'Neues Konto', type: 'giro', institution: '', currency: 'CHF',
    ownerId: 'u_gemeinsam', color: null, iban: '', cardLast4: '', notes: '',
    openingBalance: 0, openingDate: null,
    balanceMode: 'transactions',   // 'transactions' | 'manual' | 'holdings'
    cashBalance: 0,                // Barbestand im Depot (in Kontowährung)
    manualBalances: [],            // [{date, value}] für manuelle Konten (Depot, 3a)
    includeInNetWorth: true, archived: false, sort: 0,
    importSignature: null,         // erkannter Schlüssel aus Bank-Exporten
    updatedAt: now(), ...patch,
  };
}

export function newTransaction(patch = {}) {
  return {
    id: uid('txn'), accountId: null, date: todayISO(), bookingDate: null,
    payee: '', description: '', rawText: '',
    amount: 0,                 // in Kontowährung, negativ = Ausgabe
    currency: 'CHF',
    amountOriginal: null, currencyOriginal: null, fxRate: null,
    categoryId: null, tags: [], notes: '', ownerId: null,
    merchantCategory: '', cardLast4: '',
    excludeFromBudget: false, isTransfer: false, transferPairId: null,
    reviewed: false, manual: false, hidden: false,
    importId: null, dedupKey: null, source: '',
    splits: null,              // [{categoryId, amount, notes}]
    updatedAt: now(), ...patch,
  };
}

export function newCategory(patch = {}) {
  return {
    id: uid('cat'), name: 'Neue Kategorie', groupId: null, budgetType: 'flex',
    kind: 'ausgabe', icon: '•', color: null, rollover: false, annualAmount: null,
    archived: false, sort: 999, updatedAt: now(), ...patch,
  };
}

export function newRule(patch = {}) {
  return {
    id: uid('rule'), name: '', enabled: true, match: 'all',
    conditions: [{ field: 'payee', op: 'contains', value: '' }],
    actions: { categoryId: null, ownerId: null, payeeRename: null, tags: [], excludeFromBudget: null, isTransfer: null },
    sort: 500, system: false, updatedAt: now(), ...patch,
  };
}

export function newGoal(patch = {}) {
  return {
    id: uid('goal'), name: 'Neues Sparziel', icon: '🎯', targetAmount: 10000, currency: 'CHF',
    targetDate: null, startAmount: 0, monthlyContribution: 0, expectedReturnPct: 0,
    accountIds: [], categoryIds: [], priority: 1, archived: false,
    manualContributions: [], // [{id, date, amount, note}]
    notes: '', updatedAt: now(), ...patch,
  };
}

export function newAsset(patch = {}) {
  return {
    id: uid('ast'), name: 'Neue Position', type: 'immobilie', currency: 'CHF',
    ownerId: 'u_gemeinsam', valuations: [], // [{date, value}]
    notes: '', includeInNetWorth: true, updatedAt: now(), ...patch,
  };
}

export function newHolding(patch = {}) {
  return {
    id: uid('hld'), symbol: '', name: '', assetClass: 'etf', region: 'unbekannt',
    accountId: null, currency: 'USD',
    quantity: 0,
    avgCost: 0,            // Einstandskurs je Stück in Positionswährung
    avgCostBase: null,     // optional: Einstand je Stück in Basiswährung (falls bekannt)
    lastPrice: 0, lastPriceAt: null, priceSource: 'manuell',
    dayChange: null,       // Tagesveränderung in Positionswährung
    isin: '', exchange: '', contractId: null,
    notes: '', tags: [], archived: false,
    updatedAt: now(), ...patch,
  };
}

export function newDividend(patch = {}) {
  return {
    id: uid('div'), holdingId: null, symbol: '', date: todayISO(),
    amount: 0, currency: 'USD', withholding: 0, note: '', source: '',
    updatedAt: now(), ...patch,
  };
}

/** Tagesstand des Depots – Grundlage für den Verlaufschart. */
export function newSnapshot(patch = {}) {
  return {
    id: `snap_${patch.date || todayISO()}`, date: todayISO(),
    valueBase: 0, costBase: 0, cashBase: 0, positions: 0, byAccount: {},
    updatedAt: now(), ...patch,
  };
}

export function newBudgetEntry(patch = {}) {
  // id = `${period}::${categoryId}` damit Merges deterministisch sind
  return { id: `${patch.period}::${patch.categoryId}`, period: null, categoryId: null, amount: 0, note: '', updatedAt: now(), ...patch };
}

/* ---------------- Migration ---------------- */

export function migrate(doc) {
  if (!doc || typeof doc !== 'object') return newDoc();
  const t = now();
  doc.settings = doc.settings || {};
  for (const c of COLLECTIONS) if (!Array.isArray(doc[c])) doc[c] = [];
  if (!doc.settings.members || !doc.settings.members.length) doc.settings.members = newDoc().settings.members;
  if (!doc.settings.baseCurrency) doc.settings.baseCurrency = 'CHF';
  if (!doc.widgets.length) doc.widgets = defaultWidgets(t);
  if (!doc.categories.length) {
    doc.categoryGroups = DEFAULT_CATEGORY_GROUPS.map((g, i) => ({ ...g, sort: i, updatedAt: t }));
    doc.categories = DEFAULT_CATEGORIES.map((c, i) => ({ ...c, sort: i, updatedAt: t }));
  }
  if (!doc.reports.length) doc.reports = defaultReports(t);
  for (const c of COLLECTIONS) {
    for (const r of doc[c]) {
      if (!r.id) r.id = uid(c.slice(0, 3));
      if (!r.updatedAt) r.updatedAt = t;
    }
  }
  doc.schemaVersion = SCHEMA_VERSION;
  return doc;
}

/* ---------------- Merge (für OneDrive-Sync) ---------------- */

/* Arrays innerhalb eines Datensatzes, die elementweise zusammengeführt werden.
 * Ohne das verliert der Merge z. B. einen erfassten Saldo, sobald das andere Gerät
 * irgendein anderes Feld desselben Kontos ändert. */
const NESTED_ARRAYS = {
  accounts: [['manualBalances', 'date']],
  assets: [['valuations', 'date']],
  goals: [['manualContributions', 'id']],
  holdings: [],
};

function mergeNested(older, newer, fields) {
  const out = { ...newer };
  for (const [field, key] of fields) {
    const a = Array.isArray(older?.[field]) ? older[field] : [];
    const b = Array.isArray(newer?.[field]) ? newer[field] : [];
    if (!a.length && !b.length) continue;
    const map = new Map();
    for (const item of a) map.set(item?.[key], item);
    for (const item of b) map.set(item?.[key], item);   // der neuere Stand gewinnt je Schlüssel
    out[field] = Array.from(map.values());
  }
  return out;
}

/** Mitglieder werden je Person zusammengeführt, nicht als ganzes Array ersetzt. */
function mergeMembers(a = [], b = []) {
  const map = new Map();
  for (const m of a) map.set(m.id, m);
  for (const m of b) map.set(m.id, { ...map.get(m.id), ...m });
  return Array.from(map.values());
}

/** Geräteeigene Einstellungen werden nicht synchronisiert. */
export const DEVICE_LOCAL_SETTINGS = ['activeMemberId', 'theme', 'dashboardPeriod'];

/** Führt zwei Dokumente record-genau zusammen: pro ID gewinnt der neuere Stand.
 *  Rückgabe: { doc, stats } */
export function mergeDocs(base, incoming) {
  const out = clone(base);
  const stats = { added: 0, updated: 0, kept: 0, conflicts: 0, duplicates: 0 };

  const incomingNewer = (incoming.settings?.updatedAt || 0) > (base.settings?.updatedAt || 0);
  out.settings = incomingNewer
    ? { ...base.settings, ...incoming.settings }
    : { ...incoming.settings, ...base.settings };
  out.settings.members = mergeMembers(base.settings?.members, incoming.settings?.members);
  for (const key of DEVICE_LOCAL_SETTINGS) {
    if (base.settings?.[key] !== undefined) out.settings[key] = base.settings[key];
  }

  for (const coll of COLLECTIONS) {
    const map = new Map();
    for (const r of base[coll] || []) map.set(r.id, r);
    for (const r of incoming[coll] || []) {
      const existing = map.get(r.id);
      if (!existing) { map.set(r.id, r); stats.added++; continue; }
      const nested = NESTED_ARRAYS[coll];
      if ((r.updatedAt || 0) > (existing.updatedAt || 0)) {
        map.set(r.id, nested ? mergeNested(existing, r, nested) : r);
        stats.updated++;
        if (existing.updatedAt) stats.conflicts++;
      } else {
        if (nested) map.set(r.id, mergeNested(r, existing, nested));
        stats.kept++;
      }
    }
    // Grabsteine bleiben erhalten: ein selten genutztes Zweitgerät würde gelöschte
    // Datensätze sonst wieder einspielen.
    out[coll] = Array.from(map.values());
  }

  // Dieselbe Bankdatei auf beiden Geräten importiert: gleiche Buchung, zwei IDs.
  // Der Import-Schlüssel erkennt das; behalten wird die lexikografisch kleinste ID,
  // damit beide Geräte unabhängig zum selben Ergebnis kommen.
  const byKey = new Map();
  for (const t of out.transactions) {
    if (!t.dedupKey || t.deleted) continue;
    const prev = byKey.get(t.dedupKey);
    if (!prev) { byKey.set(t.dedupKey, t); continue; }
    const loser = t.id < prev.id ? prev : t;
    const winner = t.id < prev.id ? t : prev;
    byKey.set(t.dedupKey, winner);
    loser._duplicateOf = winner.id;
  }
  const before = out.transactions.length;
  out.transactions = out.transactions.filter((t) => !t._duplicateOf);
  stats.duplicates = before - out.transactions.length;

  out.schemaVersion = SCHEMA_VERSION;
  return { doc: out, stats };
}

/** Zählt Datensätze für Statusanzeigen. */
export function docStats(doc) {
  return {
    accounts: doc.accounts.filter((a) => !a.deleted && !a.archived).length,
    transactions: doc.transactions.filter((t) => !t.deleted).length,
    categories: doc.categories.filter((c) => !c.deleted).length,
    goals: doc.goals.filter((g) => !g.deleted && !g.archived).length,
    rules: doc.rules.filter((r) => !r.deleted).length,
  };
}
