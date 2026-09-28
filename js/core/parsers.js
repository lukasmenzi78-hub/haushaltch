// parsers.js — Erkennung und Auswertung der Bank- und Kartenexporte.
// Bewusst frei von DOM-Zugriffen, damit dieselbe Logik auch im Test-Harness läuft.
import { toISODate, parseNumber, normText, titleCasePayee, hashString, round2 } from './util.js';

export const FORMATS = {
  CARD13: 'card13',
  UBS_EXTRACT: 'ubs_extract',
  POSTFINANCE_CSV: 'postfinance_csv',
  UBS_CSV: 'ubs_csv',
  GENERIC: 'generic',
};

export const FORMAT_LABELS = {
  card13: 'Karten-/Kontoauszug (Viseca, Supercard, UBS Kreditkarte, PostFinance)',
  ubs_extract: 'UBS Privatkonto – Auszug aus PDF-Extraktion',
  postfinance_csv: 'PostFinance CSV-Auszug',
  ubs_csv: 'UBS CSV-Auszug',
  generic: 'Unbekanntes Format – Spalten manuell zuordnen',
};

const norm = (v) => normText(v);

function rowCells(row) { return (row || []).map((c) => (c === null || c === undefined ? '' : c)); }

function findHeaderRow(rows, predicate, limit = 30) {
  const max = Math.min(rows.length, limit);
  for (let i = 0; i < max; i++) {
    const cells = rowCells(rows[i]).map(norm);
    if (predicate(cells, rows[i])) return i;
  }
  return -1;
}

function colIndex(headerCells, candidates) {
  const normalized = headerCells.map(norm);
  for (const cand of candidates) {
    const c = norm(cand);
    const exact = normalized.indexOf(c);
    if (exact >= 0) return exact;
  }
  for (const cand of candidates) {
    const c = norm(cand);
    const partial = normalized.findIndex((h) => h && (h.startsWith(c) || h.includes(c)));
    if (partial >= 0) return partial;
  }
  return -1;
}

function currencyFromHeader(text) {
  const m = String(text || '').match(/\(([A-Z]{3})\)/);
  return m ? m[1] : null;
}

/* ------------------------------------------------------------------ */
/* Formaterkennung                                                     */
/* ------------------------------------------------------------------ */

export function detectFormat(rows) {
  if (!rows || !rows.length) return { format: FORMATS.GENERIC, headerRow: -1 };

  let hr = findHeaderRow(rows, (c) => c.includes('kontonummer') && c.includes('buchungstext'));
  if (hr >= 0) return { format: FORMATS.CARD13, headerRow: hr };

  hr = findHeaderRow(rows, (c) => c.includes('date') && c.some((x) => x.startsWith('amount')) && c.includes('counterparty'));
  if (hr >= 0) return { format: FORMATS.UBS_EXTRACT, headerRow: hr };

  hr = findHeaderRow(rows, (c) => c.includes('datum') && c.includes('avisierungstext'));
  if (hr >= 0) return { format: FORMATS.POSTFINANCE_CSV, headerRow: hr };

  hr = findHeaderRow(rows, (c) => (c.includes('abschluss') || c.includes('handelsdatum') || c.includes('valuta'))
    && (c.includes('belastung') || c.includes('gutschrift')) && c.includes('beschreibung'));
  if (hr >= 0) return { format: FORMATS.UBS_CSV, headerRow: hr };

  // Generisch: erste Zeile mit ≥3 nicht-leeren Textzellen als Kopfzeile annehmen
  hr = findHeaderRow(rows, (c) => c.filter((x) => x && !/^\d+([.,]\d+)?$/.test(x)).length >= 3);
  return { format: FORMATS.GENERIC, headerRow: hr };
}

/* ------------------------------------------------------------------ */
/* Metadaten oberhalb der Kopfzeile (UBS-Extrakt)                      */
/* ------------------------------------------------------------------ */

function scanMeta(rows, headerRow) {
  const meta = {};
  for (let i = 0; i < headerRow; i++) {
    const cells = rowCells(rows[i]);
    const key = norm(cells[0]);
    const val = cells[1];
    if (!key || val === '' || val === undefined) continue;
    if (key.includes('iban')) meta.iban = String(val).trim();
    else if (key === 'account' || key.includes('account type') || key.includes('kontoart')) meta.accountName = String(val).trim();
    else if (key.includes('current balance')) meta.balance = parseNumber(val);
    else if (key.includes('statement created')) meta.balanceDate = toISODate(val);
    else if (key.includes('bic')) meta.bic = String(val).trim();
    else if (key.includes('account holder') || key.includes('kontoinhaber')) meta.holder = String(val).trim();
    else if (key.includes('source pdf') || key === 'source') meta.source = String(val).trim();
  }
  return meta;
}

/* ------------------------------------------------------------------ */
/* Payee-Aufbereitung                                                  */
/* ------------------------------------------------------------------ */

/** Kartenbuchungstexte sehen aus wie "Coop-1983 ZH Letzipark   Zuerich".
 *  Wir trennen Händler und Ort an ≥2 Leerzeichen. */
export function splitMerchant(text) {
  const raw = String(text || '').trim();
  if (!raw) return { payee: '', place: '' };
  const parts = raw.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { payee: cleanPayee(parts[0]), place: parts.slice(1).join(' ') };
  }
  return { payee: cleanPayee(raw), place: '' };
}

export function cleanPayee(s) {
  let out = String(s || '').replace(/\s{2,}/g, ' ').trim();
  out = out.replace(/^(KAUF\/ONLINE-SHOPPING VOM \d{2}\.\d{2}\.\d{4}\s*)/i, 'Online-Kauf ');
  out = out.replace(/^(LASTSCHRIFT|GUTSCHRIFT|E-BILL|ESR|QR-RECHNUNG)\s+/i, '');
  out = out.replace(/\bCH\d{2}[\s]?\d{4}[\s]?\d{4}[\s]?\d{4}[\s]?\d{4}[\s]?\d?\b/g, '').trim();
  out = out.replace(/\s{2,}/g, ' ').trim();
  return titleCasePayee(out);
}

/* ------------------------------------------------------------------ */
/* Parser: 13-Spalten Karten-/Kontoformat                              */
/* ------------------------------------------------------------------ */

function parseCard13(rows, headerRow) {
  const header = rowCells(rows[headerRow]);
  const ix = {
    konto: colIndex(header, ['Kontonummer']),
    karte: colIndex(header, ['Kartennummer']),
    inhaber: colIndex(header, ['Konto-/Karteninhaber', 'Karteninhaber', 'Kontoinhaber']),
    datum: colIndex(header, ['Einkaufsdatum', 'Datum', 'Transaktionsdatum']),
    text: colIndex(header, ['Buchungstext', 'Text', 'Beschreibung']),
    branche: colIndex(header, ['Branche', 'Kategorie']),
    betrag: colIndex(header, ['Betrag']),
    origWaehrung: colIndex(header, ['Originalwährung', 'Originalwahrung']),
    kurs: colIndex(header, ['Kurs']),
    waehrung: colIndex(header, ['Währung', 'Wahrung']),
    belastung: colIndex(header, ['Belastung']),
    gutschrift: colIndex(header, ['Gutschrift']),
    buchung: colIndex(header, ['Buchung', 'Buchungsdatum', 'Valuta']),
  };

  const txns = [];
  const accountKeys = new Map();
  const cards = new Map();
  let currency = 'CHF';

  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rowCells(rows[i]);
    if (!r.some((c) => String(c).trim() !== '')) continue;
    const date = toISODate(r[ix.datum]);
    if (!date) continue;

    const belastung = ix.belastung >= 0 ? parseNumber(r[ix.belastung]) : null;
    const gutschrift = ix.gutschrift >= 0 ? parseNumber(r[ix.gutschrift]) : null;
    const betrag = ix.betrag >= 0 ? parseNumber(r[ix.betrag]) : null;

    let amount;
    if (gutschrift !== null && gutschrift !== 0) amount = Math.abs(gutschrift);
    else if (belastung !== null && belastung !== 0) amount = -Math.abs(belastung);
    else if (betrag !== null) amount = -Math.abs(betrag); // Fallback: Ausgabe
    else continue;

    const cur = (ix.waehrung >= 0 ? String(r[ix.waehrung] || '').trim().toUpperCase() : '') || 'CHF';
    if (cur) currency = cur;
    const origCur = (ix.origWaehrung >= 0 ? String(r[ix.origWaehrung] || '').trim().toUpperCase() : '') || cur;
    const origAmount = betrag !== null ? Math.abs(betrag) * Math.sign(amount) : null;
    let fxRate = ix.kurs >= 0 ? parseNumber(r[ix.kurs]) : null;
    if (!fxRate && origCur !== cur && origAmount) fxRate = round2Digits(Math.abs(amount) / Math.abs(origAmount), 6);

    const rawText = String(r[ix.text] ?? '').trim();
    const { payee, place } = splitMerchant(rawText);
    const kontoKey = String(r[ix.konto] ?? '').replace(/\s+/g, '') || 'default';
    const karte = String(r[ix.karte] ?? '').trim();
    const last4 = (karte.match(/(\d{4})\s*$/) || [])[1] || '';
    const inhaber = String(r[ix.inhaber] ?? '').trim();

    accountKeys.set(kontoKey, (accountKeys.get(kontoKey) || 0) + 1);
    if (last4) {
      const key = `${kontoKey}|${last4}`;
      const entry = cards.get(key) || { accountKey: kontoKey, last4, holder: inhaber, count: 0 };
      entry.count++;
      if (inhaber) entry.holder = inhaber;
      cards.set(key, entry);
    }

    txns.push({
      date,
      bookingDate: ix.buchung >= 0 ? toISODate(r[ix.buchung]) : null,
      payee: payee || rawText.slice(0, 60),
      description: place ? `${rawText}` : rawText,
      rawText,
      amount: round2(amount),
      currency: cur,
      amountOriginal: origCur !== cur ? round2Digits(origAmount, 2) : null,
      currencyOriginal: origCur !== cur ? origCur : null,
      fxRate: origCur !== cur ? fxRate : null,
      merchantCategory: ix.branche >= 0 ? String(r[ix.branche] ?? '').trim() : '',
      holderName: inhaber,
      cardLast4: last4,
      accountKey: kontoKey,
      place,
      rowIndex: i,
    });
  }

  const iban = Array.from(accountKeys.keys()).find((k) => /^CH\d{2}/i.test(k)) || '';
  const institution = guessInstitution({ iban, keys: Array.from(accountKeys.keys()), txns });

  return {
    format: FORMATS.CARD13,
    transactions: txns,
    account: {
      accountKey: mostCommon(accountKeys),
      iban: iban || '',
      currency,
      institution,
      name: suggestAccountName(institution, cards, iban),
      type: iban ? 'giro' : 'kreditkarte',
      cards: Array.from(cards.values()).sort((a, b) => b.count - a.count),
    },
    warnings: [],
  };
}

function round2Digits(n, digits = 2) {
  if (n === null || n === undefined || !isFinite(n)) return null;
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

function mostCommon(map) {
  let best = null, bestN = -1;
  for (const [k, n] of map) if (n > bestN) { best = k; bestN = n; }
  return best;
}

function guessInstitution({ iban, keys, txns }) {
  const ib = String(iban || '').replace(/\s+/g, '').toUpperCase();
  if (/^CH\d{2}09000/.test(ib)) return 'PostFinance';
  if (/^CH\d{2}0023/.test(ib)) return 'UBS';
  if (/^CH\d{2}00700/.test(ib)) return 'ZKB';
  if (/^CH\d{2}0900/.test(ib)) return 'PostFinance';
  const text = normText((txns || []).slice(0, 40).map((t) => t.payee).join(' '));
  if (text.includes('supercard')) return 'Coop Supercard (Viseca)';
  if (keys && keys.some((k) => /^\d{4}\s?\d{4}\s?\d{4}$/.test(k))) return 'Kreditkarte';
  return '';
}

function suggestAccountName(institution, cards, iban) {
  const holders = Array.from(new Set(Array.from(cards.values()).map((c) => titleCasePayee(c.holder)).filter(Boolean)));
  if (institution && holders.length === 1) return `${institution} – ${holders[0]}`;
  if (institution && holders.length > 1) return `${institution} – gemeinsam`;
  if (institution) return institution;
  if (iban) return `Konto ${iban.slice(-6)}`;
  return 'Importiertes Konto';
}

/* ------------------------------------------------------------------ */
/* Parser: UBS Privatkonto (aus PDF extrahiert)                        */
/* ------------------------------------------------------------------ */

function parseUbsExtract(rows, headerRow) {
  const header = rowCells(rows[headerRow]);
  const meta = scanMeta(rows, headerRow);
  const ix = {
    date: colIndex(header, ['Date', 'Datum']),
    weekday: colIndex(header, ['Weekday']),
    counterparty: colIndex(header, ['Counterparty', 'Gegenpartei']),
    details: colIndex(header, ['Details', 'Beschreibung']),
    amount: header.findIndex((h) => norm(h).startsWith('amount')),
    balance: header.findIndex((h) => norm(h).startsWith('balance')),
    direction: colIndex(header, ['Direction']),
    hint: colIndex(header, ['Category hint']),
    source: colIndex(header, ['Source']),
  };
  const currency = currencyFromHeader(header[ix.amount]) || currencyFromHeader(meta.accountName) || 'CHF';

  const txns = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rowCells(rows[i]);
    const date = toISODate(r[ix.date]);
    if (!date) continue;
    let amount = parseNumber(r[ix.amount]);
    if (amount === null) continue;
    const direction = String(r[ix.direction] ?? '').trim().toLowerCase();
    if (direction === 'debit' && amount > 0) amount = -amount;
    if (direction === 'credit' && amount < 0) amount = Math.abs(amount);
    const counterparty = String(r[ix.counterparty] ?? '').trim();
    const details = String(r[ix.details] ?? '').trim();
    if (amount === 0 && !counterparty && !details) continue;
    txns.push({
      date,
      bookingDate: null,
      payee: cleanPayee(counterparty),
      description: details,
      rawText: [counterparty, details].filter(Boolean).join(' – '),
      amount: round2(amount),
      currency,
      amountOriginal: null, currencyOriginal: null, fxRate: null,
      merchantCategory: ix.hint >= 0 ? String(r[ix.hint] ?? '').trim() : '',
      balanceAfter: ix.balance >= 0 ? parseNumber(r[ix.balance]) : null,
      holderName: meta.holder || '',
      cardLast4: '',
      accountKey: meta.iban || meta.accountName || 'ubs',
      rowIndex: i,
    });
  }

  return {
    format: FORMATS.UBS_EXTRACT,
    transactions: txns,
    account: {
      accountKey: (meta.iban || meta.accountName || 'ubs').replace(/\s+/g, ''),
      iban: meta.iban || '',
      currency,
      institution: 'UBS',
      name: meta.accountName ? `UBS ${meta.accountName.replace(/^UBS\s*/i, '')}` : 'UBS Privatkonto',
      type: 'giro',
      balance: meta.balance ?? null,
      balanceDate: meta.balanceDate || null,
      holder: meta.holder || '',
      cards: [],
    },
    warnings: [],
  };
}

/* ------------------------------------------------------------------ */
/* Parser: PostFinance CSV                                             */
/* ------------------------------------------------------------------ */

function parsePostfinanceCsv(rows, headerRow) {
  const header = rowCells(rows[headerRow]);
  const ix = {
    datum: colIndex(header, ['Datum']),
    text: colIndex(header, ['Avisierungstext', 'Buchungstext']),
    gutschrift: colIndex(header, ['Gutschrift']),
    lastschrift: colIndex(header, ['Lastschrift', 'Belastung']),
    valuta: colIndex(header, ['Valuta']),
    saldo: colIndex(header, ['Saldo']),
  };
  let currency = 'CHF';
  for (let i = 0; i < headerRow; i++) {
    const line = rowCells(rows[i]).join(' ');
    const m = line.match(/\b(CHF|EUR|USD)\b/);
    if (m) currency = m[1];
  }
  const txns = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rowCells(rows[i]);
    const date = toISODate(r[ix.datum]);
    if (!date) continue;
    const g = parseNumber(r[ix.gutschrift]);
    const l = parseNumber(r[ix.lastschrift]);
    const amount = g ? Math.abs(g) : l ? -Math.abs(l) : null;
    if (amount === null) continue;
    const rawText = String(r[ix.text] ?? '').trim();
    txns.push({
      date, bookingDate: ix.valuta >= 0 ? toISODate(r[ix.valuta]) : null,
      payee: cleanPayee(rawText.split(/\n|,/)[0]), description: rawText, rawText,
      amount: round2(amount), currency,
      amountOriginal: null, currencyOriginal: null, fxRate: null,
      merchantCategory: '', holderName: '', cardLast4: '',
      balanceAfter: ix.saldo >= 0 ? parseNumber(r[ix.saldo]) : null,
      accountKey: 'postfinance', rowIndex: i,
    });
  }
  return {
    format: FORMATS.POSTFINANCE_CSV, transactions: txns,
    account: { accountKey: 'postfinance', iban: '', currency, institution: 'PostFinance', name: 'PostFinance Konto', type: 'giro', cards: [] },
    warnings: [],
  };
}

/* ------------------------------------------------------------------ */
/* Parser: generisch mit Spaltenzuordnung                              */
/* ------------------------------------------------------------------ */

export function guessMapping(header) {
  const g = (cands) => { const i = colIndex(header, cands); return i >= 0 ? i : null; };
  return {
    date: g(['Datum', 'Date', 'Buchungsdatum', 'Einkaufsdatum', 'Transaktionsdatum', 'Valuta']),
    payee: g(['Zahlungsempfänger', 'Empfänger', 'Payee', 'Counterparty', 'Händler', 'Beschreibung', 'Buchungstext', 'Text', 'Description']),
    description: g(['Details', 'Verwendungszweck', 'Beschreibung', 'Mitteilung', 'Notiz']),
    amount: g(['Betrag', 'Amount', 'Umsatz']),
    debit: g(['Belastung', 'Lastschrift', 'Soll', 'Debit']),
    credit: g(['Gutschrift', 'Haben', 'Credit']),
    currency: g(['Währung', 'Currency', 'Waehrung']),
    category: g(['Kategorie', 'Category', 'Branche']),
    balance: g(['Saldo', 'Balance', 'Kontostand']),
  };
}

export function parseGeneric(rows, headerRow, mapping, opts = {}) {
  const header = rowCells(rows[headerRow]);
  const map = mapping || guessMapping(header);
  const currency = opts.currency || 'CHF';
  const txns = [];
  const invert = !!opts.invertAmounts;
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rowCells(rows[i]);
    const date = toISODate(map.date !== null ? r[map.date] : null);
    if (!date) continue;
    let amount = null;
    if (map.debit !== null || map.credit !== null) {
      const d = map.debit !== null ? parseNumber(r[map.debit]) : null;
      const c = map.credit !== null ? parseNumber(r[map.credit]) : null;
      if (c) amount = Math.abs(c);
      else if (d) amount = -Math.abs(d);
    }
    if (amount === null && map.amount !== null) amount = parseNumber(r[map.amount]);
    if (amount === null) continue;
    if (invert) amount = -amount;
    const rawText = [map.payee !== null ? r[map.payee] : '', map.description !== null ? r[map.description] : '']
      .filter((x) => String(x || '').trim()).join(' – ');
    txns.push({
      date, bookingDate: null,
      payee: cleanPayee(map.payee !== null ? r[map.payee] : rawText),
      description: map.description !== null ? String(r[map.description] ?? '') : '',
      rawText,
      amount: round2(amount),
      currency: (map.currency !== null ? String(r[map.currency] || '').toUpperCase() : '') || currency,
      amountOriginal: null, currencyOriginal: null, fxRate: null,
      merchantCategory: map.category !== null ? String(r[map.category] ?? '') : '',
      balanceAfter: map.balance !== null ? parseNumber(r[map.balance]) : null,
      holderName: '', cardLast4: '', accountKey: opts.accountKey || 'generic', rowIndex: i,
    });
  }
  return {
    format: FORMATS.GENERIC, transactions: txns, mapping: map,
    account: { accountKey: opts.accountKey || 'generic', iban: '', currency, institution: '', name: opts.name || 'Importiertes Konto', type: 'giro', cards: [] },
    warnings: [],
  };
}

/* ------------------------------------------------------------------ */
/* Öffentliche API                                                     */
/* ------------------------------------------------------------------ */

export function parseSheet(rows, opts = {}) {
  const detected = opts.format
    ? { format: opts.format, headerRow: opts.headerRow ?? detectFormat(rows).headerRow }
    : detectFormat(rows);
  const { format, headerRow } = detected;
  if (headerRow < 0) {
    return { format: FORMATS.GENERIC, transactions: [], account: null, headerRow: -1, warnings: ['Keine Kopfzeile gefunden.'] };
  }
  let result;
  switch (format) {
    case FORMATS.CARD13: result = parseCard13(rows, headerRow); break;
    case FORMATS.UBS_EXTRACT: result = parseUbsExtract(rows, headerRow); break;
    case FORMATS.POSTFINANCE_CSV: result = parsePostfinanceCsv(rows, headerRow); break;
    case FORMATS.UBS_CSV:
    case FORMATS.GENERIC:
    default: result = parseGeneric(rows, headerRow, opts.mapping, opts); break;
  }
  result.headerRow = headerRow;
  result.header = rowCells(rows[headerRow]);
  if (!result.transactions.length) result.warnings.push('Keine Buchungen erkannt.');
  const dates = result.transactions.map((t) => t.date).filter(Boolean).sort();
  result.range = dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null;
  result.totals = {
    count: result.transactions.length,
    credits: round2(result.transactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0)),
    debits: round2(result.transactions.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0)),
  };
  return result;
}

/** Kontounabhängiger Schlüssel: erkennt dieselbe Buchung auch dann, wenn sie beim
 *  erneuten Import einem anderen Konto zugeordnet wird (z. B. Aufteilung je Karte). */
export function dedupKeyLoose(txn, occurrence = 0) {
  return dedupKey('', txn, occurrence);
}

/** Stabiler Schlüssel zur Duplikaterkennung. */
export function dedupKey(accountId, txn, occurrence = 0) {
  const base = [
    accountId || '',
    txn.date,
    Number(txn.amount).toFixed(2),
    normText(txn.payee || txn.rawText || '').slice(0, 48),
    occurrence,
  ].join('|');
  return hashString(base);
}
