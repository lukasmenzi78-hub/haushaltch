// rules.js — Regelwerk für die automatische Kategorisierung
import { normText } from './util.js';

export const RULE_FIELDS = [
  { id: 'payee', label: 'Zahlungsempfänger' },
  { id: 'description', label: 'Beschreibung' },
  { id: 'merchantCategory', label: 'Branche (aus Bankdatei)' },
  { id: 'rawText', label: 'Originaltext' },
  { id: 'amount', label: 'Betrag' },
  { id: 'accountId', label: 'Konto' },
  { id: 'ownerId', label: 'Person' },
  { id: 'currency', label: 'Währung' },
];

export const RULE_OPS = [
  { id: 'contains', label: 'enthält', text: true },
  { id: 'notContains', label: 'enthält nicht', text: true },
  { id: 'equals', label: 'ist genau', text: true },
  { id: 'startsWith', label: 'beginnt mit', text: true },
  { id: 'endsWith', label: 'endet mit', text: true },
  { id: 'regex', label: 'Regex', text: true },
  { id: 'gt', label: 'grösser als', text: false },
  { id: 'lt', label: 'kleiner als', text: false },
  { id: 'absGt', label: 'Betrag (ohne Vorzeichen) grösser als', text: false },
];

function fieldValue(txn, field) {
  switch (field) {
    case 'payee': return txn.payee || '';
    case 'description': return txn.description || '';
    case 'merchantCategory': return txn.merchantCategory || '';
    case 'rawText': return [txn.payee, txn.description, txn.rawText, txn.merchantCategory].filter(Boolean).join(' ');
    case 'amount': return txn.amount;
    case 'accountId': return txn.accountId || '';
    case 'ownerId': return txn.ownerId || '';
    case 'currency': return txn.currency || '';
    default: return '';
  }
}

export function conditionMatches(txn, cond) {
  const raw = fieldValue(txn, cond.field);
  const op = cond.op;
  if (op === 'gt' || op === 'lt' || op === 'absGt') {
    const n = Number(raw);
    const v = Number(cond.value);
    if (!isFinite(n) || !isFinite(v)) return false;
    if (op === 'gt') return n > v;
    if (op === 'lt') return n < v;
    return Math.abs(n) > Math.abs(v);
  }
  if (op === 'regex') {
    try { return new RegExp(cond.value, 'i').test(String(raw)); } catch { return false; }
  }
  const a = normText(raw);
  const b = normText(cond.value);
  if (!b) return false;
  switch (op) {
    case 'contains': return a.includes(b);
    case 'notContains': return !a.includes(b);
    case 'equals': return a === b;
    case 'startsWith': return a.startsWith(b);
    case 'endsWith': return a.endsWith(b);
    default: return false;
  }
}

export function ruleMatches(txn, rule) {
  if (!rule || rule.enabled === false || rule.deleted) return false;
  const conds = rule.conditions || [];
  if (!conds.length) return false;
  return rule.match === 'any' ? conds.some((c) => conditionMatches(txn, c)) : conds.every((c) => conditionMatches(txn, c));
}

export function sortedRules(rules) {
  return [...rules]
    .filter((r) => !r.deleted && r.enabled !== false)
    .sort((a, b) => (a.sort ?? 500) - (b.sort ?? 500));
}

/** Ermittelt die Änderungen, die die Regeln an einer Buchung vornehmen würden.
 *  Die erste passende Regel bestimmt die Kategorie; Tags aller Treffer werden gesammelt. */
export function evaluate(txn, rules) {
  const patch = {};
  const matched = [];
  const tags = new Set(txn.tags || []);
  let categorySet = false;
  for (const rule of sortedRules(rules)) {
    if (!ruleMatches(txn, rule)) continue;
    matched.push(rule);
    const a = rule.actions || {};
    if (a.categoryId && !categorySet) { patch.categoryId = a.categoryId; categorySet = true; patch.ruleId = rule.id; }
    if (a.payeeRename && !patch.payee) patch.payee = a.payeeRename;
    if (a.ownerId && !patch.ownerId) patch.ownerId = a.ownerId;
    if (a.isTransfer !== null && a.isTransfer !== undefined && patch.isTransfer === undefined) patch.isTransfer = a.isTransfer;
    if (a.excludeFromBudget !== null && a.excludeFromBudget !== undefined && patch.excludeFromBudget === undefined) {
      patch.excludeFromBudget = a.excludeFromBudget;
    }
    for (const t of a.tags || []) tags.add(t);
    if (categorySet && !rule.continueAfterMatch) break;
  }
  if (tags.size !== (txn.tags || []).length) patch.tags = Array.from(tags);
  return { patch, matched };
}

/** Wendet Regeln auf eine Liste an. onlyUncategorized schont manuelle Korrekturen. */
export function applyRulesTo(txns, rules, { onlyUncategorized = true, skipManual = true } = {}) {
  const updates = [];
  for (const t of txns) {
    if (skipManual && t.categoryLockedByUser) continue;
    if (onlyUncategorized && t.categoryId && t.categoryId !== 'c_unkategorisiert') continue;
    const { patch } = evaluate(t, rules);
    delete patch.ruleId;
    if (Object.keys(patch).length) updates.push({ ...t, ...patch });
  }
  return updates;
}

/** Baut aus einer Buchung eine sinnvolle Regel-Vorlage. */
export function ruleFromTransaction(txn, categoryId) {
  const value = (txn.payee || txn.description || '').trim();
  return {
    name: `${value.slice(0, 40)} → Kategorie`,
    match: 'all',
    conditions: [{ field: txn.payee ? 'payee' : 'description', op: 'contains', value: value.slice(0, 40) }],
    actions: { categoryId, ownerId: null, payeeRename: null, tags: [], excludeFromBudget: null, isTransfer: null },
    sort: 100,
  };
}
