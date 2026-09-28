// importview.js — Import-Assistent für Excel- und CSV-Auszüge
import { store } from '../core/store.js';
import { h, fmtMoney, fmtDate, clear, uid, now, todayISO, escapeHtml } from '../core/util.js';
import {
  readFile, analyseWorkbook, matchAccount, buildPlan, applyPlan, accountDraftFromHint,
  deriveClosingBalance, undoImport, detectTransfers, linkTransfers,
  detectCardPayments, markAsCardPayments,
} from '../core/importer.js';
import { FORMAT_LABELS, FORMATS, guessMapping, parseGeneric } from '../core/parsers.js';
import { modal, toast, confirmDialog, emptyState, statTile, memberSelect, accountSelect, categoryChip } from './components.js';
import { migrate } from '../core/model.js';
import { detectIbkr, parseIbkr } from '../core/ibkr.js';
import { mergeHoldings, writeSnapshot } from '../core/investments.js';
import { newAccount } from '../core/model.js';

export function renderImport({ navigate }) {
  const root = h('div', {});

  const drop = h('div', { class: 'dropzone' },
    h('div', { style: { fontSize: '2rem' } }, '⤓'),
    h('div', { style: { fontWeight: '600', marginTop: '6px' } }, 'Auszug hierher ziehen oder klicken'),
    h('div', { class: 'small muted' }, 'Excel (.xlsx), CSV oder eine JSON-Sicherung. Mehrere Dateien gleichzeitig sind möglich.'));
  const input = h('input', { type: 'file', accept: '.xlsx,.xls,.csv,.txt,.json', multiple: true, style: { display: 'none' } });
  drop.append(input);
  drop.addEventListener('click', () => input.click());
  input.addEventListener('change', (e) => handleFiles(Array.from(e.target.files), navigate));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('over');
    handleFiles(Array.from(e.dataTransfer.files), navigate);
  });

  root.append(h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, 'Daten importieren')),
    drop,
    h('div', { class: 'small muted', style: { marginTop: '12px' } },
      'Erkannte Formate: ',
      h('span', {}, [...Object.values(FORMAT_LABELS).filter((x) => !x.startsWith('Unbekannt')),
        'Interactive Brokers (Activity Statement und Flex Query)'].join(' · ')))));

  // Werkzeuge
  root.append(h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, 'Nach dem Import')),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onClick: () => openDoubleCountCheck() }, '🔍 Doppelzählungen prüfen'),
      h('button', {
        class: 'btn', onClick: () => {
          const pairs = detectTransfers();
          if (!pairs.length) { toast('Keine Gegenbuchungen gefunden.'); return; }
          const n = linkTransfers(pairs);
          toast(`${n} Übertragspaare verknüpft und aus dem Budget genommen`, 'success');
        },
      }, '🔁 Überträge zwischen Konten erkennen'),
      h('button', { class: 'btn', onClick: () => navigate('buchungen', { uncategorized: '1' }) }, 'Nicht zugeordnete Buchungen prüfen'),
      h('button', { class: 'btn ghost', onClick: () => exportBackup() }, '⤓ Sicherung herunterladen'))));

  // Verlauf
  const imports = [...store.idx.imports].sort((a, b) => b.at - a.at);
  const hist = h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, 'Import-Verlauf')));
  if (!imports.length) hist.append(h('p', { class: 'small muted' }, 'Noch keine Importe.'));
  for (const imp of imports.slice(0, 25)) {
    hist.append(h('div', { class: 'list-row' },
      h('div', { class: 'grow truncate' },
        h('div', { class: 'title truncate' }, imp.fileName || 'Import'),
        h('div', { class: 'txn-sub' },
          `${new Date(imp.at).toLocaleString('de-CH')} · ${imp.count} Buchungen${imp.skipped ? `, ${imp.skipped} Duplikate übersprungen` : ''}${imp.from ? ` · ${fmtDate(imp.from)}–${fmtDate(imp.to)}` : ''}`)),
      h('span', { class: 'small muted' }, store.account(imp.accountId)?.name || ''),
      h('button', {
        class: 'btn ghost sm danger', onClick: async () => {
          if (!await confirmDialog(`Import „${imp.fileName}“ mit ${imp.count} Buchungen rückgängig machen?`)) return;
          const n = undoImport(imp.id);
          toast(`${n} Buchungen entfernt`, 'success');
        },
      }, 'Rückgängig')));
  }
  root.append(hist);
  return root;
}

/* ---------------- Dateien verarbeiten ---------------- */

async function handleFiles(files, navigate) {
  for (const file of files) {
    try {
      const parsed = await readFile(file);
      if (parsed.json) {
        if (parsed.json.kind === 'depot-positionen') await importPositionsFile(parsed.json);
        else await restoreBackup(parsed.json);
        continue;
      }
      const ibkrSheet = parsed.sheets.find((sh) => detectIbkr(sh.rows));
      if (ibkrSheet) { openIbkrWizard(parseIbkr(ibkrSheet.rows), parsed.name); continue; }
      const analysis = analyseWorkbook(parsed);
      if (!analysis.best || !analysis.best.parsed.transactions.length) {
        openMappingWizard(analysis, navigate);
        continue;
      }
      openWizard(analysis, navigate);
    } catch (e) {
      console.error(e);
      toast(`${file.name}: ${e.message}`, 'error', { timeout: 8000 });
    }
  }
}

/* ---------------- Wertschriften ---------------- */

/** Fertige Positionsdatei (z. B. aus dem IBKR-Konto erzeugt) einlesen. */
async function importPositionsFile(data) {
  const ok = await confirmDialog(
    `${data.holdings?.length || 0} Positionen aus „${data.quelle || 'Datei'}“ übernehmen? `
    + 'Bestehende Positionen mit demselben Kürzel werden aktualisiert, nicht verdoppelt.',
    { title: 'Depot übernehmen', confirmLabel: 'Übernehmen', danger: false });
  if (!ok) return;

  if (data.account && !store.account(data.account.id)) {
    store.upsert('accounts', { ...newAccount(), ...data.account }, 'Depot angelegt');
  }
  const res = mergeHoldings(data.holdings || [], { accountId: data.account?.id || null });
  if (data.dividends?.length) store.upsertMany('dividends', data.dividends, 'Dividenden übernommen');
  writeSnapshot();
  toast(`${res.added} neue, ${res.changed} aktualisierte Positionen`, 'success');
}

/** Assistent für IBKR-Auszüge. */
function openIbkrWizard(parsed, fileName) {
  const depots = store.idx.accounts.filter((a) => a.type === 'depot' && !a.archived);
  const state = {
    accountId: depots[0]?.id || null,
    newAccountName: 'Interactive Brokers',
    replaceMissing: true,
    withDividends: true,
  };
  const body = h('div', {});

  const dlg = modal({
    title: `IBKR-Auszug – ${fileName}`, wide: true, body,
    actions: [
      { label: 'Abbrechen' },
      {
        label: 'Übernehmen', variant: 'primary',
        onClick: () => {
          let accountId = state.accountId;
          if (!accountId) {
            const acc = newAccount({
              name: state.newAccountName, type: 'depot', institution: 'Interactive Brokers',
              currency: parsed.holdings[0]?.currency || 'USD', balanceMode: 'holdings',
              importSignature: parsed.meta?.accountId || 'IBKR',
            });
            store.upsert('accounts', acc, 'Depot angelegt');
            accountId = acc.id;
          } else {
            store.patch('accounts', accountId, { balanceMode: 'holdings' }, 'Depot bewertet sich aus Positionen');
          }
          const res = mergeHoldings(parsed.holdings, { accountId, replaceMissing: state.replaceMissing });
          if (state.withDividends && parsed.dividends.length) {
            const existing = new Set(store.idx.dividends.map((d) => `${d.date}|${d.symbol}|${d.amount}`));
            const fresh = parsed.dividends.filter((d) => !existing.has(`${d.date}|${d.symbol}|${d.amount}`));
            if (fresh.length) store.upsertMany('dividends', fresh, 'Dividenden importiert');
          }
          writeSnapshot();
          store.upsert('imports', {
            id: uid('imp'), at: now(), fileName, format: 'ibkr', accountId,
            count: parsed.holdings.length, skipped: 0, updatedAt: now(),
          }, 'Import erfasst');
          toast(`${res.added} neue, ${res.changed} aktualisierte Positionen`
            + (res.closed ? `, ${res.closed} geschlossen` : ''), 'success');
          dlg.close();
        },
      },
    ],
  });

  function refresh() {
    clear(body);
    body.append(h('div', { class: 'row', style: { marginBottom: '12px' } },
      h('span', { class: 'badge good' }, `IBKR ${parsed.layout}`),
      parsed.meta?.accountId ? h('span', { class: 'badge' }, `Konto ${parsed.meta.accountId}`) : null,
      parsed.meta?.baseCurrency ? h('span', { class: 'badge' }, `Basis ${parsed.meta.baseCurrency}`) : null,
      parsed.meta?.period ? h('span', { class: 'badge' }, parsed.meta.period) : null));

    const value = parsed.holdings.reduce((a, x) => a + x.quantity * x.lastPrice, 0);
    const cost = parsed.holdings.reduce((a, x) => a + x.quantity * x.avgCost, 0);
    body.append(h('div', { class: 'stat-row', style: { marginBottom: '14px' } },
      statTile({ label: 'Positionen', value: String(parsed.holdings.length), hero: true }),
      statTile({ label: 'Wert im Auszug', value: fmtMoney(value, parsed.holdings[0]?.currency || 'USD', { noDecimals: true }) }),
      statTile({ label: 'Einstand', value: fmtMoney(cost, parsed.holdings[0]?.currency || 'USD', { noDecimals: true }) }),
      statTile({ label: 'Dividenden', value: String(parsed.dividends.length) })));

    const accSel = h('select', { onChange: (e) => { state.accountId = e.target.value || null; refresh(); } },
      h('option', { value: '', selected: !state.accountId }, '➕ Neues Depot anlegen'),
      depots.map((a) => h('option', { value: a.id, selected: state.accountId === a.id }, a.name)));
    const box = h('div', { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', {}, 'Depot'), accSel));
    if (!state.accountId) {
      box.append(h('label', { class: 'field' }, h('span', {}, 'Name des Depots'),
        h('input', { type: 'text', value: state.newAccountName, onInput: (e) => { state.newAccountName = e.target.value; } })));
    }
    body.append(box);

    body.append(h('label', { class: 'row tight', style: { marginTop: '10px' } },
      h('input', {
        type: 'checkbox', checked: state.replaceMissing,
        onChange: (e) => { state.replaceMissing = e.target.checked; },
      }),
      h('span', {}, 'Positionen, die im Auszug fehlen, als verkauft behandeln')));
    if (parsed.dividends.length) {
      body.append(h('label', { class: 'row tight' },
        h('input', {
          type: 'checkbox', checked: state.withDividends,
          onChange: (e) => { state.withDividends = e.target.checked; },
        }),
        h('span', {}, `${parsed.dividends.length} Dividendenzahlungen mit übernehmen`)));
    }

    const table = h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Kürzel'), h('th', {}, 'Bezeichnung'), h('th', {}, 'Art'),
        h('th', { class: 'num' }, 'Anzahl'), h('th', { class: 'num' }, 'Kurs'), h('th', { class: 'num' }, 'Wert'))));
    const tb = h('tbody', {});
    for (const x of parsed.holdings.slice(0, 15)) {
      tb.append(h('tr', {},
        h('td', { class: 'txn-payee' }, x.symbol),
        h('td', { class: 'small truncate', style: { maxWidth: '220px' } }, x.name || '—'),
        h('td', { class: 'small muted' }, x.assetClass),
        h('td', { class: 'num mono' }, String(x.quantity)),
        h('td', { class: 'num mono' }, fmtMoney(x.lastPrice, x.currency)),
        h('td', { class: 'num mono' }, fmtMoney(x.quantity * x.lastPrice, x.currency, { noDecimals: true }))));
    }
    table.append(tb);
    body.append(h('div', { class: 'table-wrap', style: { marginTop: '12px' } }, table));
    if (parsed.holdings.length > 15) {
      body.append(h('p', { class: 'small muted' }, `… und ${parsed.holdings.length - 15} weitere.`));
    }
    body.append(h('p', { class: 'small muted', style: { marginTop: '10px' } },
      'Die Anlageart ist geraten (ETFs und Aktien stehen im Auszug beide unter „Stocks“). '
      + 'In der Ansicht „Anlagen“ lässt sie sich je Position korrigieren.'));
  }
  refresh();
}

/* ---------------- Doppelzählungen ---------------- */

/** Zeigt Kartenzahlungen, die sonst zusätzlich zu den Kartenumsätzen als Ausgabe zählen. */
export function openDoubleCountCheck() {
  const res = detectCardPayments();
  const body = h('div', {});

  body.append(h('p', { class: 'small muted' },
    'Bezahlst du die Kreditkartenrechnung vom Bankkonto, ist das keine neue Ausgabe – die '
    + 'einzelnen Einkäufe stehen bereits im Kartenauszug. Solche Zahlungen gehören als '
    + 'Übertrag markiert, damit derselbe Betrag nicht zweimal im Budget landet.'));

  if (!res.items.length) {
    body.append(emptyState('✓', 'Keine Doppelzählung gefunden',
      res.hasCardAccounts
        ? 'Alle erkannten Kartenzahlungen sind bereits als Übertrag markiert.'
        : 'Es ist noch kein Kreditkartenkonto vorhanden. Sobald du einen Kartenauszug importierst, prüft die App das hier erneut.'));
    modal({ title: 'Doppelzählungen prüfen', body, wide: true, actions: [{ label: 'Schliessen', variant: 'primary' }] });
    return;
  }

  const selected = new Set(res.items.filter((i) => i.confident).map((i) => i.txn.id));
  const sumLabel = h('div', { class: 'stat-row', style: { margin: '14px 0' } });

  function refreshSum() {
    const chosen = res.items.filter((i) => selected.has(i.txn.id));
    sumLabel.replaceChildren(
      statTile({ label: 'Gefunden', value: String(res.items.length), sub: 'Zahlungen an Karten' }),
      statTile({
        label: 'Wird aus dem Budget genommen', hero: true,
        value: fmtMoney(Math.abs(chosen.reduce((a, i) => a + i.txn.amount, 0)), store.baseCurrency, { noDecimals: true }),
        sub: `${chosen.length} ausgewählt`,
      }));
  }

  const table = h('table', { class: 'data' },
    h('thead', {}, h('tr', {},
      h('th', { style: { width: '32px' } }, ''),
      h('th', {}, 'Datum'), h('th', {}, 'Buchung'), h('th', {}, 'Konto'),
      h('th', {}, 'Erkannt als'), h('th', { class: 'num' }, 'Betrag'))));
  const tbody = h('tbody', {});
  for (const item of res.items) {
    const t = item.txn;
    tbody.append(h('tr', {},
      h('td', {}, h('input', {
        type: 'checkbox', checked: selected.has(t.id),
        onChange: (e) => { e.target.checked ? selected.add(t.id) : selected.delete(t.id); refreshSum(); },
      })),
      h('td', { class: 'mono nowrap' }, fmtDate(t.date)),
      h('td', {},
        h('div', { class: 'txn-payee' }, t.payee || t.description || '—'),
        h('div', { class: 'txn-sub truncate', style: { maxWidth: '260px' } }, t.description || '')),
      h('td', { class: 'small' }, store.account(t.accountId)?.name || '—'),
      h('td', { class: 'small' },
        item.confident
          ? h('span', { class: 'badge good' }, item.matchedAccount ? `→ ${item.matchedAccount.name}` : item.reason)
          : h('span', { class: 'badge warn' }, 'kein Kartenkonto vorhanden')),
      h('td', { class: 'num mono' }, fmtMoney(t.amount, t.currency))));
  }
  table.append(tbody);

  body.append(sumLabel);
  body.append(h('div', { class: 'table-wrap' }, table));

  const unsure = res.items.filter((i) => !i.confident).length;
  if (unsure) {
    body.append(h('p', { class: 'small', style: { marginTop: '12px' } },
      h('b', {}, `${unsure} Zahlung(en) ohne passendes Kartenkonto: `),
      'Wenn du den zugehörigen Kartenauszug nicht importierst, ist die Zahlung eine echte '
      + 'Ausgabe und sollte nicht markiert werden. Diese sind deshalb nicht vorausgewählt.'));
  }
  refreshSum();

  modal({
    title: 'Doppelzählungen prüfen', body, wide: true,
    actions: [
      { label: 'Abbrechen' },
      {
        label: 'Als Übertrag markieren', variant: 'primary',
        onClick: () => {
          const n = markAsCardPayments(Array.from(selected));
          toast(n ? `${n} Zahlungen als Übertrag markiert – sie zählen nicht mehr als Ausgabe` : 'Nichts ausgewählt',
            n ? 'success' : 'error');
        },
      },
    ],
  });
}

/* ---------------- Assistent ---------------- */

function openWizard(analysis, navigate) {
  const state = {
    sheetIndex: analysis.sheets.indexOf(analysis.best),
    accountId: null,
    newAccountDraft: null,
    splitByCard: false,
    cardAccounts: {},
    ownerMap: {},
    defaultOwnerId: null,
    setBalance: true,
    manualClosing: null,
  };

  const body = h('div', {});
  const dlg = modal({
    title: `Import – ${analysis.fileName}`, wide: true, body,
    actions: [
      { label: 'Abbrechen' },
      { label: 'Importieren', variant: 'primary', onClick: () => doImport() },
    ],
  });

  function sheet() { return analysis.sheets[state.sheetIndex]; }

  function currentPlan() {
    const s = sheet();
    const hint = s.parsed.account;
    // Konto bestimmen
    if (!state.accountId) {
      const match = matchAccount(hint);
      if (match) state.accountId = match.id;
      else if (!state.newAccountDraft) state.newAccountDraft = accountDraftFromHint(hint);
    }
    const accountId = state.accountId || state.newAccountDraft?.id;
    return buildPlan(s.parsed, {
      accountId,
      splitByCard: state.splitByCard,
      cardAccounts: state.cardAccounts,
      ownerMap: state.ownerMap,
      defaultOwnerId: state.defaultOwnerId,
      fileName: analysis.fileName,
      sheetName: s.sheetName,
      applyRules: true,
    });
  }

  function refresh() {
    clear(body);
    const s = sheet();
    const parsed = s.parsed;
    const hint = parsed.account || {};

    // Blattwahl
    if (analysis.sheets.length > 1) {
      const sel = h('select', {
        onChange: (e) => { state.sheetIndex = Number(e.target.value); state.accountId = null; state.newAccountDraft = null; refresh(); },
      }, analysis.sheets.map((x, i) => h('option', { value: i, selected: i === state.sheetIndex },
        `${x.sheetName} (${x.parsed.transactions.length} Buchungen)`)));
      body.append(h('label', { class: 'field', style: { marginBottom: '12px' } }, h('span', {}, 'Tabellenblatt'), sel));
    }

    body.append(h('div', { class: 'row', style: { marginBottom: '12px' } },
      h('span', { class: 'badge good' }, FORMAT_LABELS[parsed.format] || parsed.format),
      parsed.range ? h('span', { class: 'badge' }, `${fmtDate(parsed.range.from)} – ${fmtDate(parsed.range.to)}`) : null,
      h('span', { class: 'badge' }, `${parsed.transactions.length} Zeilen`),
      hint.currency ? h('span', { class: 'badge' }, hint.currency) : null));

    // Kontozuordnung
    const accBox = h('div', { class: 'form-grid' });
    const existing = store.idx.accounts.filter((a) => !a.archived);
    const accSel = h('select', {
      onChange: (e) => {
        state.accountId = e.target.value === '__new' ? null : e.target.value;
        if (e.target.value === '__new' && !state.newAccountDraft) state.newAccountDraft = accountDraftFromHint(hint);
        refresh();
      },
    },
      h('option', { value: '__new', selected: !state.accountId }, `➕ Neues Konto anlegen: ${hint.name || 'Konto'}`),
      existing.map((a) => h('option', { value: a.id, selected: state.accountId === a.id }, `${a.name} (${a.currency})`)));
    accBox.append(h('label', { class: 'field' }, h('span', {}, 'Buchungen zuordnen zu'), accSel));

    if (!state.accountId && state.newAccountDraft) {
      const d = state.newAccountDraft;
      accBox.append(h('label', { class: 'field' }, h('span', {}, 'Name des neuen Kontos'),
        h('input', { type: 'text', value: d.name, onInput: (e) => { d.name = e.target.value; } })));
    }

    accBox.append(h('label', { class: 'field' }, h('span', {}, 'Person (falls nicht erkennbar)'),
      memberSelect({ value: state.defaultOwnerId, emptyLabel: '— automatisch —', onChange: (v) => { state.defaultOwnerId = v; refresh(); } })));
    body.append(accBox);

    // Karten / Inhaber
    const cards = hint.cards || [];
    if (cards.length > 1) {
      const box = h('div', { style: { marginTop: '14px' } },
        h('div', { class: 'small', style: { fontWeight: '550' } }, 'Erkannte Karten in dieser Datei'));
      for (const c of cards) {
        const guess = state.ownerMap[normHolder(c.holder)] ?? '';
        box.append(h('div', { class: 'row', style: { marginTop: '6px' } },
          h('span', { class: 'badge' }, `…${c.last4}`),
          h('span', { class: 'grow small' }, `${c.holder || 'unbekannt'} · ${c.count} Buchungen`),
          memberSelect({
            value: guess, emptyLabel: '— automatisch —',
            onChange: (v) => { state.ownerMap[normHolder(c.holder)] = v; refresh(); },
          })));
      }
      box.append(h('label', { class: 'row tight', style: { marginTop: '8px' } },
        h('input', {
          type: 'checkbox', checked: state.splitByCard,
          onChange: (e) => {
            state.splitByCard = e.target.checked;
            if (state.splitByCard) {
              for (const c of cards) {
                if (!state.cardAccounts[c.last4]) {
                  const draft = accountDraftFromHint(hint, { name: `${hint.name} · …${c.last4}`, importSignature: `${hint.accountKey}|${c.last4}` });
                  state.cardAccounts[c.last4] = draft.id;
                  state.cardDrafts = { ...(state.cardDrafts || {}), [c.last4]: draft };
                }
              }
            }
            refresh();
          },
        }),
        h('span', {}, 'Je Karte ein eigenes Konto anlegen')));
      body.append(box);
    }

    // Vorschau
    const plan = currentPlan();
    body.append(h('div', { class: 'stat-row', style: { margin: '16px 0' } },
      statTile({ label: 'Neu importiert', value: String(plan.stats.newCount), hero: true }),
      statTile({ label: 'Duplikate übersprungen', value: String(plan.stats.duplicates) }),
      statTile({ label: 'Automatisch zugeordnet', value: `${plan.stats.categorized} / ${plan.stats.newCount}` }),
      statTile({ label: 'Einnahmen', value: fmtMoney(plan.stats.credits, hint.currency || 'CHF', { noDecimals: true }) }),
      statTile({ label: 'Ausgaben', value: fmtMoney(plan.stats.debits, hint.currency || 'CHF', { noDecimals: true }) })));

    const closing = deriveClosingBalance(plan, hint);
    if (closing) {
      body.append(h('label', { class: 'row tight', style: { marginBottom: '12px' } },
        h('input', { type: 'checkbox', checked: state.setBalance, onChange: (e) => { state.setBalance = e.target.checked; } }),
        h('span', {}, `Saldo ${fmtMoney(closing.value, hint.currency || 'CHF')} per ${fmtDate(closing.date)} als Kontostand übernehmen`)));
    } else if (plan.stats.to) {
      // Kartenauszüge enthalten oft keinen Saldo. Ohne Ankerpunkt würde das
      // Nettovermögen zu tief liegen, weil bezahlte Rechnungen fehlen.
      const balI = h('input', {
        type: 'number', step: '0.05', placeholder: '0.00', style: { maxWidth: '150px' },
        value: state.manualClosing?.value ?? '',
        onInput: (e) => {
          state.manualClosing = e.target.value === ''
            ? null
            : { date: plan.stats.to, value: Number(e.target.value) };
        },
      });
      body.append(h('div', { style: { marginBottom: '12px' } },
        h('div', { class: 'small muted' },
          `Dieser Auszug enthält keinen Kontostand. Trage den tatsächlichen Saldo per ${fmtDate(plan.stats.to)} ein – sonst rechnet die App nur die Bewegungen zusammen (bei Kreditkarten meist 0.00, wenn die Rechnung bezahlt ist).`),
        h('div', { class: 'row', style: { marginTop: '6px' } },
          h('span', { class: 'small' }, `Saldo per ${fmtDate(plan.stats.to)} (${hint.currency || 'CHF'})`), balI)));
    }

    // Tabellenvorschau
    const preview = plan.items.slice(0, 12);
    const table = h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Datum'), h('th', {}, 'Empfänger'), h('th', {}, 'Kategorie'), h('th', {}, 'Person'), h('th', { class: 'num' }, 'Betrag'), h('th', {}, ''))));
    const tbody = h('tbody', {});
    for (const it of preview) {
      tbody.append(h('tr', {},
        h('td', { class: 'mono nowrap' }, fmtDate(it.txn.date)),
        h('td', { class: 'truncate', style: { maxWidth: '220px' } }, it.txn.payee || it.txn.description),
        h('td', {}, categoryChip(it.txn.categoryId)),
        h('td', { class: 'small' }, store.member(it.txn.ownerId)?.name || '–'),
        h('td', { class: `num mono ${it.txn.amount > 0 ? 'pos' : ''}` }, fmtMoney(it.txn.amount, it.txn.currency)),
        h('td', {}, it.duplicate ? h('span', { class: 'badge warn' }, 'Duplikat') : '')));
    }
    table.append(tbody);
    body.append(h('div', { class: 'table-wrap' }, table));
    if (plan.items.length > preview.length) {
      body.append(h('p', { class: 'small muted' }, `… und ${plan.items.length - preview.length} weitere Zeilen.`));
    }
    body._plan = plan;
  }

  function doImport() {
    const plan = body._plan || currentPlan();
    const s = sheet();
    const hint = s.parsed.account || {};
    // Neue Konten anlegen
    if (!state.accountId && state.newAccountDraft) {
      store.upsert('accounts', state.newAccountDraft, 'Konto aus Import angelegt');
      state.accountId = state.newAccountDraft.id;
    }
    if (state.splitByCard && state.cardDrafts) {
      for (const draft of Object.values(state.cardDrafts)) store.upsert('accounts', draft, 'Kartenkonto angelegt');
    }
    const finalPlan = currentPlan();
    const closing = deriveClosingBalance(finalPlan, hint) || state.manualClosing;
    const res = applyPlan(finalPlan, {
      fileName: analysis.fileName, sheetName: s.sheetName,
      accountId: state.accountId,
      setBalance: state.setBalance && closing ? closing : null,
    });
    toast(`${res.imported} Buchungen importiert`, 'success');
    dlg.close();
  }

  refresh();
}

function normHolder(s) {
  return String(s || '').toLowerCase().replace(/[^a-z ]/g, '').trim();
}

/* ---------------- Manuelle Spaltenzuordnung ---------------- */

function openMappingWizard(analysis, navigate) {
  const sheetIdx = 0;
  const sheet = analysis.sheets[sheetIdx];
  const rows = sheet.rows;
  const headerRow = sheet.parsed.headerRow >= 0 ? sheet.parsed.headerRow : 0;
  const header = rows[headerRow] || [];
  const mapping = guessMapping(header);

  const body = h('div', {});
  body.append(h('p', { class: 'small muted' },
    'Das Format wurde nicht automatisch erkannt. Ordne die Spalten einmalig zu – danach funktioniert der Import wie gewohnt.'));

  const fields = [
    ['date', 'Datum *'], ['payee', 'Empfänger / Text *'], ['description', 'Beschreibung'],
    ['amount', 'Betrag (mit Vorzeichen)'], ['debit', 'Belastung'], ['credit', 'Gutschrift'],
    ['currency', 'Währung'], ['category', 'Kategorie / Branche'], ['balance', 'Saldo'],
  ];
  const grid = h('div', { class: 'form-grid' });
  for (const [key, label] of fields) {
    const sel = h('select', { onChange: (e) => { mapping[key] = e.target.value === '' ? null : Number(e.target.value); } },
      h('option', { value: '' }, '— nicht vorhanden —'),
      header.map((hcell, i) => h('option', { value: i, selected: mapping[key] === i }, `${i + 1}: ${String(hcell).slice(0, 32)}`)));
    grid.append(h('label', { class: 'field' }, h('span', {}, label), sel));
  }
  body.append(grid);

  const preview = h('div', { style: { marginTop: '14px' } });
  body.append(preview);

  modal({
    title: `Spalten zuordnen – ${analysis.fileName}`, body, wide: true,
    actions: [
      { label: 'Abbrechen' },
      {
        label: 'Weiter', variant: 'primary',
        onClick: () => {
          const result = parseGeneric(rows, headerRow, mapping, { name: analysis.fileName });
          if (!result.transactions.length) { toast('Mit dieser Zuordnung wurden keine Buchungen erkannt.', 'error'); return false; }
          const newAnalysis = { fileName: analysis.fileName, sheets: [{ sheetName: sheet.sheetName, rows, parsed: result }], best: null };
          newAnalysis.best = newAnalysis.sheets[0];
          openWizard(newAnalysis, navigate);
        },
      },
    ],
  });
}

/* ---------------- Sicherung ---------------- */

function exportBackup() {
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `haushaltch_sicherung_${todayISO()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast('Sicherung heruntergeladen', 'success');
}

async function restoreBackup(json) {
  const ok = await confirmDialog(
    'Diese Sicherung mit den aktuellen Daten zusammenführen? Neuere Datensätze gewinnen; nichts wird gelöscht.',
    { title: 'Sicherung einlesen', confirmLabel: 'Zusammenführen', danger: false });
  if (!ok) return;
  const { mergeDocs } = await import('../core/model.js');
  const { doc, stats } = mergeDocs(store.doc, migrate(json));
  store.replaceDoc(doc, 'restore');
  await store.persist();
  toast(`Zusammengeführt: ${stats.added} neu, ${stats.updated} aktualisiert`, 'success');
}
