// importer.js — Dateien einlesen, Import planen, Buchungen übernehmen
import { store } from './store.js';
import { parseSheet, dedupKey, dedupKeyLoose, FORMATS, FORMAT_LABELS } from './parsers.js';
import { newTransaction, newAccount } from './model.js';
import { parseCSV, normText, uid, now, round2, todayISO, groupBy, cmpStr, sortBy } from './util.js';
import { evaluate } from './rules.js';
import { toBase } from './fx.js';

/* ---------------- Dateien einlesen ---------------- */

export async function readFile(file) {
  const name = file.name || 'Datei';
  const lower = name.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt') || lower.endsWith('.tsv')) {
    const text = await readAsText(file);
    return { name, sheets: [{ name: 'CSV', rows: parseCSV(text) }] };
  }
  if (lower.endsWith('.json')) {
    const text = await readAsText(file);
    return { name, json: JSON.parse(text), sheets: [] };
  }
  const buf = await file.arrayBuffer();
  if (typeof XLSX === 'undefined') throw new Error('Excel-Bibliothek nicht geladen.');
  const wb = XLSX.read(buf, { type: 'array', cellDates: true, raw: false });
  const sheets = wb.SheetNames.map((sn) => ({
    name: sn,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '', raw: true, blankrows: false }),
  }));
  return { name, sheets };
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    // Schweizer Bankexporte sind oft ISO-8859-1; UTF-8 zuerst versuchen
    fr.readAsText(file, 'utf-8');
  }).then((text) => {
    if (text.includes('�')) {
      return new Promise((resolve, reject) => {
        const fr2 = new FileReader();
        fr2.onload = () => resolve(fr2.result);
        fr2.onerror = () => reject(fr2.error);
        fr2.readAsText(file, 'iso-8859-1');
      });
    }
    return text;
  });
}

/** Wählt das Blatt mit den meisten erkannten Buchungen. */
export function analyseWorkbook(fileObj, opts = {}) {
  const results = fileObj.sheets.map((sheet) => {
    let parsed;
    try { parsed = parseSheet(sheet.rows, opts); }
    catch (e) { parsed = { format: FORMATS.GENERIC, transactions: [], warnings: [String(e.message || e)], account: null }; }
    return { sheetName: sheet.name, rows: sheet.rows, parsed };
  });
  const best = results.slice().sort((a, b) => b.parsed.transactions.length - a.parsed.transactions.length)[0];
  return { fileName: fileObj.name, sheets: results, best };
}

/* ---------------- Konten zuordnen ---------------- */

export function matchAccount(accountHint) {
  if (!accountHint) return null;
  const accounts = store.idx.accounts;
  const key = normText(accountHint.accountKey || '');
  const iban = normText(accountHint.iban || '');
  return accounts.find((a) => a.importSignature && normText(a.importSignature) === key)
    || (iban && accounts.find((a) => normText(a.iban) === iban))
    || null;
}

export function guessMember(holderName) {
  const members = store.idx.members;
  const n = normText(holderName);
  if (!n) return null;
  for (const m of members) {
    const mn = normText(m.name);
    if (!mn || mn === 'gemeinsam') continue;
    if (n.includes(mn) || mn.includes(n.split(' ')[0])) return m.id;
  }
  return null;
}

/* ---------------- Importplan ---------------- */

/**
 * @param parsed  Ergebnis von parseSheet
 * @param options { accountId, splitByCard, cardAccounts: {last4: accountId}, ownerMap: {holderNorm: memberId},
 *                  applyRules, defaultOwnerId, fileName, sheetName }
 */
/**
 * Buchungen, die bereits zu diesem Bankkonto gehören – auch wenn sie beim letzten Mal
 * einem anderen App-Konto zugeordnet wurden. Ohne das gälte derselbe Auszug als neu,
 * sobald man beim zweiten Import „Je Karte ein eigenes Konto“ einschaltet.
 */
function looseKeysOfRelatedAccounts(parsed, options) {
  const root = String(parsed.account?.accountKey || '').replace(/\s+/g, '');
  if (!root) return new Set();
  const related = store.idx.accounts.filter((a) => {
    const sig = String(a.importSignature || '').replace(/\s+/g, '');
    return sig && (sig === root || sig.startsWith(`${root}|`) || root.startsWith(`${sig}|`));
  }).map((a) => a.id);
  if (options.accountId && !related.includes(options.accountId)) related.push(options.accountId);
  for (const id of Object.values(options.cardAccounts || {})) if (!related.includes(id)) related.push(id);

  const keys = new Set();
  const counter = new Map();
  const rows = store.idx.transactions.filter((t) => related.includes(t.accountId));
  for (const t of sortBy(rows, (x) => x.date)) {
    let occ = 0;
    let key = dedupKeyLoose(t, occ);
    while (keys.has(key)) { occ++; key = dedupKeyLoose(t, occ); if (occ > 200) break; }
    keys.add(key);
  }
  return keys;
}

export function buildPlan(parsed, options = {}) {
  const rules = store.idx.rules;
  const existingKeys = store.idx.dedupKeys;
  const looseKeys = looseKeysOfRelatedAccounts(parsed, options);
  const seenLoose = new Map();
  const seen = new Map();
  const items = [];

  for (const t of parsed.transactions) {
    const accountId = resolveAccountId(t, options);
    const holderKey = normText(t.holderName);
    const ownerId = options.ownerMap?.[holderKey]
      || (t.holderName ? guessMember(t.holderName) : null)
      || options.defaultOwnerId
      || (accountId ? store.account(accountId)?.ownerId : null)
      || null;

    // Duplikate: gleiche Buchung mehrfach am selben Tag ist erlaubt (Occurrence-Zähler)
    let occ = 0;
    let key = dedupKey(accountId, t, occ);
    while (seen.has(key)) { occ++; key = dedupKey(accountId, t, occ); }
    seen.set(key, true);

    // zusätzlich kontounabhängig prüfen, innerhalb desselben Bankkontos
    let lOcc = 0;
    let lKey = dedupKeyLoose(t, lOcc);
    while (seenLoose.has(lKey)) { lOcc++; lKey = dedupKeyLoose(t, lOcc); }
    seenLoose.set(lKey, true);

    const isDuplicate = existingKeys.has(key) || looseKeys.has(lKey);

    const draft = newTransaction({
      accountId,
      date: t.date,
      bookingDate: t.bookingDate || null,
      payee: t.payee || '',
      description: t.description || '',
      rawText: t.rawText || '',
      amount: round2(t.amount),
      currency: t.currency || 'CHF',
      amountOriginal: t.amountOriginal ?? null,
      currencyOriginal: t.currencyOriginal ?? null,
      fxRate: t.fxRate ?? null,
      merchantCategory: t.merchantCategory || '',
      cardLast4: t.cardLast4 || '',
      ownerId,
      dedupKey: key,
      source: `${options.fileName || ''}${options.sheetName ? ' / ' + options.sheetName : ''}`.trim(),
    });

    if (options.applyRules !== false) {
      const { patch } = evaluate(draft, rules);
      delete patch.ruleId;
      Object.assign(draft, patch);
    }
    if (!draft.categoryId) draft.categoryId = 'c_unkategorisiert';

    items.push({ txn: draft, duplicate: isDuplicate, balanceAfter: t.balanceAfter ?? null });
  }

  const fresh = items.filter((i) => !i.duplicate);
  const dates = fresh.map((i) => i.txn.date).sort();
  return {
    items,
    format: parsed.format,
    formatLabel: FORMAT_LABELS[parsed.format] || parsed.format,
    account: parsed.account,
    stats: {
      total: items.length,
      duplicates: items.length - fresh.length,
      newCount: fresh.length,
      credits: round2(fresh.filter((i) => i.txn.amount > 0).reduce((s, i) => s + i.txn.amount, 0)),
      debits: round2(fresh.filter((i) => i.txn.amount < 0).reduce((s, i) => s + i.txn.amount, 0)),
      categorized: fresh.filter((i) => i.txn.categoryId && i.txn.categoryId !== 'c_unkategorisiert').length,
      from: dates[0] || null,
      to: dates[dates.length - 1] || null,
    },
  };
}

function resolveAccountId(t, options) {
  if (options.splitByCard && t.cardLast4 && options.cardAccounts?.[t.cardLast4]) return options.cardAccounts[t.cardLast4];
  return options.accountId || null;
}

/** Legt aus den erkannten Kontodaten ein neues Konto an (noch nicht gespeichert). */
export function accountDraftFromHint(hint, extra = {}) {
  if (!hint) return newAccount(extra);
  return newAccount({
    name: hint.name || 'Importiertes Konto',
    type: hint.type || 'giro',
    institution: hint.institution || '',
    currency: hint.currency || 'CHF',
    iban: hint.iban || '',
    importSignature: hint.accountKey || null,
    openingBalance: 0,
    ...extra,
  });
}

/* ---------------- Import ausführen ---------------- */

export function applyPlan(plan, options = {}) {
  const include = options.includeDuplicates ? plan.items : plan.items.filter((i) => !i.duplicate);
  if (!include.length) return { imported: 0 };
  const importId = uid('imp');
  const txns = include.map((i) => ({ ...i.txn, importId }));

  store.mutate('Import', ['transactions', 'imports', 'accounts'], (doc) => {
    doc.transactions.push(...txns);
    doc.imports.push({
      id: importId,
      at: now(),
      fileName: options.fileName || plan.fileName || '',
      sheetName: options.sheetName || '',
      format: plan.format,
      accountId: options.accountId || null,
      count: txns.length,
      skipped: plan.stats.duplicates,
      from: plan.stats.from, to: plan.stats.to,
      updatedAt: now(),
    });
    // Saldo aus dem Auszug übernehmen, falls vorhanden
    if (options.setBalance && options.accountId) {
      const acc = doc.accounts.find((a) => a.id === options.accountId);
      if (acc && isFinite(options.setBalance.value)) {
        acc.manualBalances = [...(acc.manualBalances || []).filter((b) => b.date !== options.setBalance.date),
          { date: options.setBalance.date, value: options.setBalance.value }];
        acc.updatedAt = now();
      }
    }
  });
  return { imported: txns.length, importId };
}

/** Import rückgängig machen (alle Buchungen eines Import-Laufs entfernen). */
export function undoImport(importId) {
  const ids = store.idx.transactions.filter((t) => t.importId === importId).map((t) => t.id);
  store.removeMany('transactions', ids, 'Import rückgängig');
  store.remove('imports', importId, 'Import rückgängig');
  return ids.length;
}

/* ---------------- Eröffnungssaldo aus Auszug ableiten ---------------- */

/** Aus "Saldo nach Buchung" der ältesten Zeile lässt sich der Startsaldo herleiten. */
export function deriveOpeningBalance(plan) {
  const withBalance = plan.items.filter((i) => i.balanceAfter !== null && i.balanceAfter !== undefined);
  if (!withBalance.length) return null;
  const sorted = withBalance.slice().sort((a, b) => cmpStr(a.txn.date, b.txn.date) || (a.txn.rowIndex ?? 0) - (b.txn.rowIndex ?? 0));
  const oldest = sorted[0];
  return { date: oldest.txn.date, value: round2(oldest.balanceAfter - oldest.txn.amount) };
}

/** Saldo des Auszugs (jüngste Zeile). */
export function deriveClosingBalance(plan, hint) {
  if (hint?.balance !== null && hint?.balance !== undefined && isFinite(hint.balance)) {
    return { date: hint.balanceDate || plan.stats.to || todayISO(), value: hint.balance };
  }
  const withBalance = plan.items.filter((i) => i.balanceAfter !== null && i.balanceAfter !== undefined);
  if (!withBalance.length) return null;
  const sorted = withBalance.slice().sort((a, b) => cmpStr(b.txn.date, a.txn.date) || (a.txn.rowIndex ?? 0) - (b.txn.rowIndex ?? 0));
  return { date: sorted[0].txn.date, value: sorted[0].balanceAfter };
}

/* ---------------- Doppelzählung durch Kartenzahlungen ---------------- */

const ISSUER_RE = /topcard|viseca|cornercard|corner card|swisscard|american express|amex|cembra|certo|bonuscard|bonus card|card service/i;
const PAYMENT_RE = /zahlung an karte|kartenzahlung|zahlung kreditkarte|kreditkartenabrechnung|abrechnung kreditkarte/i;
const MASKED_CARD_RE = /(?:x{4}[\s-]*){2,3}(\d{4})/i;

/**
 * Findet Zahlungen vom Bankkonto an eine Kreditkarte, die noch nicht als Übertrag
 * markiert sind. Solche Zahlungen dürfen nicht als Ausgabe zählen, sobald der
 * Kartenauszug selbst importiert ist – sonst steht derselbe Betrag zweimal im Budget.
 *
 * Wichtig: Ist die zugehörige Karte NICHT in der App, ist die Zahlung sehr wohl eine
 * echte Ausgabe. Deshalb wird jeder Fund als „sicher“ oder „unsicher“ gekennzeichnet.
 */
export function detectCardPayments() {
  const cardAccounts = store.idx.accounts.filter((a) => a.type === 'kreditkarte' && !a.archived);
  const cardTxnDates = new Map();
  for (const a of cardAccounts) {
    const list = (store.idx.txnByAccount.get(a.id) || []).filter((t) => !t.deleted).map((t) => t.date).sort();
    if (list.length) cardTxnDates.set(a.id, { from: list[0], to: list[list.length - 1] });
  }

  const found = [];
  for (const t of store.idx.transactions) {
    if (t.deleted || t.amount >= 0) continue;
    if (t.isTransfer) continue;
    const cat = store.category(t.categoryId);
    if (cat && (cat.budgetType === 'transfer' || cat.kind === 'transfer')) continue;
    const account = store.account(t.accountId);
    if (account?.type === 'kreditkarte') continue;   // Umsätze auf der Karte selbst

    const text = [t.payee, t.description, t.rawText].filter(Boolean).join(' ');
    const last4 = (text.match(MASKED_CARD_RE) || [])[1] || null;
    const byIssuer = ISSUER_RE.test(text);
    const byPhrase = PAYMENT_RE.test(text);
    if (!last4 && !byIssuer && !byPhrase) continue;

    const matchedAccount = last4 ? cardAccounts.find((a) => (a.cardLast4 || '').endsWith(last4)) : null;
    const covering = matchedAccount
      ? [matchedAccount]
      : cardAccounts.filter((a) => {
        const r = cardTxnDates.get(a.id);
        return r && t.date >= r.from && t.date <= r.to;
      });

    found.push({
      txn: t,
      last4,
      matchedAccount: matchedAccount || null,
      candidateAccounts: covering,
      // Sicher, wenn die Karte in der App ist und der Zeitraum abgedeckt ist
      confident: !!matchedAccount || covering.length > 0,
      reason: last4 ? `Karte …${last4}` : byIssuer ? 'Kartenanbieter' : 'Text „Zahlung an Karte“',
    });
  }
  const total = round2(found.reduce((a, f) => a + f.txn.amount, 0));
  return {
    items: found.sort((a, b) => (a.txn.date < b.txn.date ? 1 : -1)),
    total,
    confidentTotal: round2(found.filter((f) => f.confident).reduce((a, f) => a + f.txn.amount, 0)),
    hasCardAccounts: cardAccounts.length > 0,
  };
}

/** Markiert die gewählten Zahlungen als Übertrag – sie zählen dann nicht mehr als Ausgabe. */
export function markAsCardPayments(txnIds) {
  if (!txnIds.length) return 0;
  return store.patchMany('transactions', txnIds, {
    isTransfer: true, categoryId: 'c_kk_zahlung', categoryLockedByUser: true,
  }, 'Kartenzahlungen als Übertrag markiert');
}

/* ---------------- Gegenbuchungen erkennen ---------------- */

/** Findet Paare wie "Zahlung an Karte -1769.50" ↔ "Gutschrift Kreditkarte +1769.50". */
export function detectTransfers(days = 5) {
  const txns = store.idx.transactions.filter((t) => !t.transferPairId);
  const byAmount = groupBy(txns, (t) => Math.abs(round2(toBase(t.amount, t.currency, t.date))).toFixed(2));
  const pairs = [];
  for (const [, list] of byAmount) {
    const debits = list.filter((t) => t.amount < 0);
    const credits = list.filter((t) => t.amount > 0);
    for (const d of debits) {
      const match = credits.find((c) => c.accountId !== d.accountId
        && Math.abs(new Date(c.date) - new Date(d.date)) <= days * 86400000
        && !pairs.some((p) => p.a.id === c.id || p.b.id === c.id));
      if (match) pairs.push({ a: d, b: match });
    }
  }
  return pairs;
}

export function linkTransfers(pairs) {
  const updates = [];
  for (const { a, b } of pairs) {
    updates.push({ ...a, isTransfer: true, transferPairId: b.id, categoryId: a.categoryId || 'c_umbuchung' });
    updates.push({ ...b, isTransfer: true, transferPairId: a.id, categoryId: b.categoryId || 'c_umbuchung' });
  }
  if (updates.length) store.upsertMany('transactions', updates, 'Überträge verknüpft');
  return updates.length / 2;
}
