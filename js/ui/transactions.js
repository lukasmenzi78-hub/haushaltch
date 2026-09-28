// transactions.js — Buchungsliste mit Filtern, Massenbearbeitung und Detailansicht
import { store } from '../core/store.js';
import { h, fmtMoney, fmtDate, sortBy, todayISO, round2, debounce, escapeHtml, clear } from '../core/util.js';
import { filterTransactions, resolvePeriod, PERIOD_TYPES } from '../core/reports.js';
import { newTransaction, newRule } from '../core/model.js';
import { ruleFromTransaction, applyRulesTo } from '../core/rules.js';
import {
  categorySelect, accountSelect, memberSelect, modal, toast, emptyState,
  categoryChip, confirmDialog, segmented,
} from './components.js';
import { amountBase, isSplit, splitParts } from '../core/analytics.js';

const ui = {
  period: { type: 'last3' },
  filters: { search: '', accountIds: [], categoryIds: [], ownerIds: [], includeTransfers: true, uncategorizedOnly: false },
  sort: { key: 'date', dir: -1 },
  limit: 150,
  selected: new Set(),
};

export function renderTransactions({ params, navigate }) {
  if (params.account) ui.filters.accountIds = [params.account];
  if (params.category) { ui.filters.categoryIds = [params.category]; }
  if (params.month) ui.period = { type: 'month', month: params.month };
  if (params.uncategorized) ui.filters.uncategorizedOnly = true;

  const root = h('div', {});
  root.append(filterBar(() => refresh()));

  const listBox = h('div', { class: 'card' });
  root.append(listBox);

  function refresh() {
    const txns = sortBy(
      filterTransactions({ period: ui.period, filters: ui.filters }),
      (t) => (ui.sort.key === 'amount' ? amountBase(t) : ui.sort.key === 'payee' ? (t.payee || '').toLowerCase() : t.date),
      ui.sort.dir);
    listBox.replaceChildren(renderList(txns, refresh, navigate));
  }
  refresh();
  return root;
}

/* ---------------- Filterleiste ---------------- */

function filterBar(refresh) {
  const search = h('input', {
    type: 'search', placeholder: 'Suchen (Empfänger, Text, Notiz) …', value: ui.filters.search,
    onInput: debounce((e) => { ui.filters.search = e.target.value; refresh(); }, 250),
    style: { maxWidth: '280px' },
  });

  const periodSel = h('select', {
    onChange: (e) => { ui.period = { type: e.target.value }; refresh(); }, style: { maxWidth: '190px' },
  }, PERIOD_TYPES.filter((p) => p.id !== 'custom').map((p) => h('option', { value: p.id, selected: ui.period.type === p.id }, p.label)));

  const accSel = accountSelect({
    value: ui.filters.accountIds[0] || '', includeEmpty: true,
    onChange: (v) => { ui.filters.accountIds = v ? [v] : []; refresh(); },
  });
  accSel.style.maxWidth = '210px';

  const catSel = categorySelect({
    value: ui.filters.categoryIds[0] || '',
    onChange: (v) => { ui.filters.categoryIds = v ? [v] : []; refresh(); },
  });
  catSel.style.maxWidth = '210px';
  catSel.querySelector('option').textContent = '— alle Kategorien —';

  const ownerSel = memberSelect({
    value: ui.filters.ownerIds[0] || '', emptyLabel: '— alle Personen —',
    onChange: (v) => { ui.filters.ownerIds = v ? [v] : []; refresh(); },
  });
  ownerSel.style.maxWidth = '170px';

  const uncat = h('button', {
    class: 'chip' + (ui.filters.uncategorizedOnly ? ' active' : ''),
    onClick: (e) => { ui.filters.uncategorizedOnly = !ui.filters.uncategorizedOnly; e.target.classList.toggle('active'); refresh(); },
  }, 'Nur nicht zugeordnet');

  const transfers = h('button', {
    class: 'chip' + (ui.filters.includeTransfers ? ' active' : ''),
    onClick: (e) => { ui.filters.includeTransfers = !ui.filters.includeTransfers; e.target.classList.toggle('active'); refresh(); },
  }, 'Überträge zeigen');

  const addBtn = h('button', { class: 'btn primary', onClick: () => openEditor(null, refresh) }, '+ Buchung');
  const rulesBtn = h('button', {
    class: 'btn', onClick: async () => {
      const updates = applyRulesTo(store.idx.transactions, store.idx.rules, { onlyUncategorized: true });
      if (!updates.length) { toast('Keine weiteren Buchungen zuzuordnen.'); return; }
      store.upsertMany('transactions', updates, 'Regeln angewendet');
      toast(`${updates.length} Buchungen zugeordnet`, 'success');
      refresh();
    },
  }, '⚡ Regeln anwenden');

  return h('div', { class: 'card', style: { marginBottom: '14px' } },
    h('div', { class: 'row' }, search, periodSel, accSel, catSel, ownerSel, h('div', { class: 'grow' }), rulesBtn, addBtn),
    h('div', { class: 'row tight', style: { marginTop: '10px' } }, uncat, transfers));
}

/* ---------------- Liste ---------------- */

function renderList(txns, refresh, navigate) {
  const frag = h('div', {});
  if (!txns.length) {
    return emptyState('☰', 'Keine Buchungen gefunden', 'Passe die Filter an oder importiere weitere Auszüge.',
      { label: 'Zum Import', onClick: () => navigate('import') });
  }

  const totalIn = txns.filter((t) => t.amount > 0).reduce((a, t) => a + amountBase(t), 0);
  const totalOut = txns.filter((t) => t.amount < 0).reduce((a, t) => a + amountBase(t), 0);

  const head = h('div', { class: 'card-head' },
    h('div', { class: 'grow' },
      h('h3', {}, `${txns.length} Buchungen`),
      h('div', { class: 'small muted' },
        `Einnahmen ${fmtMoney(totalIn, store.baseCurrency)} · Ausgaben ${fmtMoney(totalOut, store.baseCurrency)} · Saldo ${fmtMoney(totalIn + totalOut, store.baseCurrency)}`)),
    h('button', { class: 'btn ghost sm', onClick: () => exportCsv(txns) }, '⤓ CSV'));
  frag.append(head);

  const bulk = h('div', { class: 'row', style: { display: 'none', marginBottom: '10px' } });
  frag.append(bulk);

  function updateBulk() {
    bulk.replaceChildren();
    if (!ui.selected.size) { bulk.style.display = 'none'; return; }
    bulk.style.display = 'flex';
    bulk.append(h('span', { class: 'badge' }, `${ui.selected.size} ausgewählt`));
    const catSel = categorySelect({
      value: '', onChange: (v) => {
        if (!v) return;
        store.patchMany('transactions', Array.from(ui.selected), { categoryId: v, categoryLockedByUser: true }, 'Kategorie gesetzt');
        toast(`${ui.selected.size} Buchungen zugeordnet`, 'success');
        ui.selected.clear(); refresh();
      },
    });
    catSel.style.maxWidth = '230px';
    catSel.querySelector('option').textContent = 'Kategorie zuweisen …';
    bulk.append(catSel);
    const ownSel = memberSelect({
      value: '', emptyLabel: 'Person zuweisen …', onChange: (v) => {
        if (!v) return;
        store.patchMany('transactions', Array.from(ui.selected), { ownerId: v }, 'Person gesetzt');
        ui.selected.clear(); refresh();
      },
    });
    ownSel.style.maxWidth = '190px';
    bulk.append(ownSel);
    bulk.append(h('button', {
      class: 'btn sm', onClick: () => {
        store.patchMany('transactions', Array.from(ui.selected), { excludeFromBudget: true }, 'Aus Budget ausgeschlossen');
        ui.selected.clear(); refresh();
      },
    }, 'Vom Budget ausnehmen'));
    bulk.append(h('button', {
      class: 'btn sm danger', onClick: async () => {
        if (!await confirmDialog(`${ui.selected.size} Buchungen löschen?`)) return;
        store.removeMany('transactions', Array.from(ui.selected), 'Buchungen gelöscht');
        ui.selected.clear(); refresh();
      },
    }, 'Löschen'));
    bulk.append(h('button', { class: 'btn ghost sm', onClick: () => { ui.selected.clear(); refresh(); } }, 'Auswahl aufheben'));
  }

  const table = h('table', { class: 'data' });
  const thead = h('thead', {}, h('tr', {},
    h('th', { style: { width: '30px' } }, h('input', {
      type: 'checkbox',
      onChange: (e) => {
        if (e.target.checked) txns.slice(0, ui.limit).forEach((t) => ui.selected.add(t.id));
        else ui.selected.clear();
        refresh();
      },
    })),
    sortableTh('Datum', 'date', refresh),
    sortableTh('Empfänger / Text', 'payee', refresh),
    h('th', {}, 'Kategorie'),
    h('th', {}, 'Konto'),
    h('th', {}, 'Person'),
    sortableTh('Betrag', 'amount', refresh, true)));
  const tbody = h('tbody', {});

  for (const t of txns.slice(0, ui.limit)) {
    const acc = store.account(t.accountId);
    const member = store.member(t.ownerId);
    const catSel = categorySelect({
      value: t.categoryId, includeEmpty: false,
      onChange: (v) => { store.patch('transactions', t.id, { categoryId: v, categoryLockedByUser: true }, 'Kategorie geändert'); },
    });
    catSel.classList.add('inline-cat');
    catSel.style.maxWidth = '210px';
    catSel.addEventListener('click', (e) => e.stopPropagation());

    const tr = h('tr', { class: ui.selected.has(t.id) ? 'selected' : '' },
      h('td', {}, h('input', {
        type: 'checkbox', checked: ui.selected.has(t.id),
        onClick: (e) => e.stopPropagation(),
        onChange: (e) => { e.target.checked ? ui.selected.add(t.id) : ui.selected.delete(t.id); updateBulk(); tr.classList.toggle('selected', e.target.checked); },
      })),
      h('td', { class: 'nowrap mono' }, fmtDate(t.date)),
      h('td', {},
        h('div', { class: 'txn-payee' }, t.payee || t.description || '—',
          isSplit(t) ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, `${t.splits.length} Teile`) : null),
        h('div', { class: 'txn-sub truncate', style: { maxWidth: '360px' } },
          [t.description !== t.payee ? t.description : '', t.merchantCategory, t.notes].filter(Boolean).join(' · '))),
      h('td', {}, isSplit(t)
        ? h('div', { class: 'small' }, splitParts(t).map((p) => h('div', { class: 'truncate' },
          h('i', { class: 'cat-dot', style: { background: store.category(p.categoryId)?.color || 'var(--ink-muted)' } }),
          `${store.category(p.categoryId)?.name || 'Nicht zugeordnet'} ${fmtMoney(p.amount, t.currency, { noDecimals: true })}`)))
        : catSel),
      h('td', { class: 'small' }, acc?.name || '—'),
      h('td', { class: 'small' }, member?.name || '—'),
      h('td', { class: `num ${t.amount > 0 ? 'pos' : ''}` },
        fmtMoney(t.amount, t.currency),
        t.currencyOriginal ? h('div', { class: 'txn-sub' }, `${fmtMoney(t.amountOriginal, t.currencyOriginal)}`) : null,
        t.excludeFromBudget ? h('div', { class: 'txn-sub' }, 'ohne Budget') : null));
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', (e) => {
      if (e.target.closest('select, input, button')) return;
      openEditor(t, refresh);
    });
    tbody.append(tr);
  }

  table.append(thead, tbody);
  frag.append(h('div', { class: 'table-wrap' }, table));

  if (txns.length > ui.limit) {
    frag.append(h('div', { class: 'center', style: { marginTop: '12px' } },
      h('button', { class: 'btn', onClick: () => { ui.limit += 250; refresh(); } }, `Weitere ${Math.min(250, txns.length - ui.limit)} laden`)));
  }
  updateBulk();
  return frag;
}

function sortableTh(label, key, refresh, num = false) {
  const active = ui.sort.key === key;
  return h('th', {
    class: num ? 'num' : '', style: { cursor: 'pointer' },
    onClick: () => { ui.sort = { key, dir: active ? -ui.sort.dir : -1 }; refresh(); },
  }, `${label}${active ? (ui.sort.dir === 1 ? ' ▲' : ' ▼') : ''}`);
}

/* ---------------- Detail / Bearbeiten ---------------- */

export function openEditor(txn, refresh) {
  const isNew = !txn;
  const t = txn ? { ...txn } : newTransaction({ accountId: store.idx.accounts[0]?.id, currency: store.idx.accounts[0]?.currency || 'CHF' });

  const body = h('div', {});
  const grid = h('div', { class: 'form-grid' });
  const field = (label, input, full = false) =>
    h('label', { class: 'field', style: full ? { gridColumn: '1 / -1' } : {} }, h('span', {}, label), input);

  const dateI = h('input', { type: 'date', value: t.date, onInput: (e) => { t.date = e.target.value; } });
  const payeeI = h('input', { type: 'text', value: t.payee, onInput: (e) => { t.payee = e.target.value; } });
  const descI = h('input', { type: 'text', value: t.description, onInput: (e) => { t.description = e.target.value; } });
  const amountI = h('input', { type: 'number', step: '0.05', value: t.amount, onInput: (e) => { t.amount = Number(e.target.value); } });
  const accI = accountSelect({ value: t.accountId, onChange: (v) => { t.accountId = v; t.currency = store.account(v)?.currency || t.currency; } });
  const catI = categorySelect({ value: t.categoryId, onChange: (v) => { t.categoryId = v; t.categoryLockedByUser = true; } });
  const ownI = memberSelect({ value: t.ownerId, onChange: (v) => { t.ownerId = v; } });
  const notesI = h('textarea', { rows: 2, onInput: (e) => { t.notes = e.target.value; } }, t.notes || '');
  const tagsI = h('input', { type: 'text', value: (t.tags || []).join(', '), placeholder: 'z. B. Ferien 2026, Steuerbeleg', onInput: (e) => { t.tags = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); } });
  const exclI = h('input', { type: 'checkbox', checked: !!t.excludeFromBudget, onChange: (e) => { t.excludeFromBudget = e.target.checked; } });
  const transferI = h('input', { type: 'checkbox', checked: !!t.isTransfer, onChange: (e) => { t.isTransfer = e.target.checked; } });

  grid.append(
    field('Datum', dateI), field('Betrag', amountI),
    field('Empfänger', payeeI), field('Konto', accI),
    field('Beschreibung', descI, true),
    field('Kategorie', catI), field('Person', ownI),
    field('Schlagwörter', tagsI, true),
    field('Notiz', notesI, true),
    h('label', { class: 'row tight' }, exclI, h('span', {}, 'Vom Budget ausnehmen')),
    h('label', { class: 'row tight' }, transferI, h('span', {}, 'Ist ein Übertrag zwischen eigenen Konten')));
  body.append(grid);

  if (!isNew && (t.rawText || t.source)) {
    body.append(h('details', { class: 'acc', style: { marginTop: '14px' } },
      h('summary', {}, 'Herkunft & Originaltext'),
      h('p', { class: 'small muted', style: { whiteSpace: 'pre-wrap' } },
        [t.rawText, t.merchantCategory && `Branche: ${t.merchantCategory}`, t.source && `Quelle: ${t.source}`,
          t.currencyOriginal && `Original: ${fmtMoney(t.amountOriginal, t.currencyOriginal)} · Kurs ${t.fxRate ?? '–'}`,
          t.cardLast4 && `Karte …${t.cardLast4}`].filter(Boolean).join('\n'))));
  }

  /* ---- Aufteilen ---- */
  const splitBox = h('div', { style: { marginTop: '16px' } });
  let splits = (t.splits || []).map((x) => ({ ...x }));

  function renderSplits() {
    clear(splitBox);
    const head = h('div', { class: 'card-head', style: { marginBottom: '6px' } },
      h('h3', { class: 'grow', style: { margin: 0 } }, 'Aufteilung'),
      splits.length
        ? h('button', {
          class: 'btn ghost sm danger',
          onClick: () => { splits = []; t.splits = null; renderSplits(); },
        }, 'Aufteilung entfernen')
        : h('button', {
          class: 'btn sm',
          onClick: () => {
            const half = round2((Number(t.amount) || 0) / 2);
            splits = [
              { categoryId: t.categoryId, amount: half, note: '' },
              { categoryId: null, amount: round2((Number(t.amount) || 0) - half), note: '' },
            ];
            renderSplits();
          },
        }, '⁄ Buchung aufteilen'));
    splitBox.append(head);

    if (!splits.length) {
      splitBox.append(h('p', { class: 'small muted' },
        'Ein Einkauf, mehrere Kategorien – zum Beispiel Lebensmittel und Haushaltsartikel im selben Beleg.'));
      return;
    }

    for (const [i, sp] of splits.entries()) {
      const cat = categorySelect({ value: sp.categoryId, onChange: (v) => { sp.categoryId = v; } });
      cat.style.maxWidth = '230px';
      const amt = h('input', {
        type: 'number', step: '0.05', value: sp.amount, style: { maxWidth: '120px', textAlign: 'right' },
        onInput: (e) => { sp.amount = Number(e.target.value); updateRest(); },
      });
      const note = h('input', {
        type: 'text', value: sp.note || '', placeholder: 'Notiz', style: { maxWidth: '150px' },
        onInput: (e) => { sp.note = e.target.value; },
      });
      splitBox.append(h('div', { class: 'row', style: { marginBottom: '6px' } },
        cat, amt, note,
        h('button', {
          class: 'btn ghost sm', disabled: splits.length <= 2,
          onClick: () => { splits.splice(i, 1); renderSplits(); },
        }, '✕')));
    }

    const rest = h('div', { class: 'small', style: { marginTop: '6px' } });
    const controls = h('div', { class: 'row', style: { marginTop: '8px' } },
      h('button', {
        class: 'btn sm',
        onClick: () => { splits.push({ categoryId: null, amount: 0, note: '' }); renderSplits(); },
      }, '+ Teil'),
      h('button', {
        class: 'btn sm ghost',
        onClick: () => {
          const covered = splits.slice(0, -1).reduce((a, x) => a + (Number(x.amount) || 0), 0);
          splits[splits.length - 1].amount = round2((Number(t.amount) || 0) - covered);
          renderSplits();
        },
      }, 'Rest auf den letzten Teil'),
      rest);
    splitBox.append(controls);

    function updateRest() {
      const covered = round2(splits.reduce((a, x) => a + (Number(x.amount) || 0), 0));
      const diff = round2((Number(t.amount) || 0) - covered);
      rest.textContent = Math.abs(diff) < 0.005
        ? `✓ aufgeteilt: ${fmtMoney(covered, t.currency)}`
        : `Rest ${fmtMoney(diff, t.currency)} – fällt auf „${store.category(t.categoryId)?.name || 'Nicht zugeordnet'}“`;
      rest.className = `small ${Math.abs(diff) < 0.005 ? 'pos' : 'muted'}`;
    }
    updateRest();
  }
  renderSplits();
  body.append(splitBox);

  const actions = [{ label: 'Abbrechen' }];
  if (!isNew) {
    actions.push({
      label: 'Regel erstellen', onClick: () => { openRuleFromTxn(t); return true; },
    });
    actions.push({
      label: 'Löschen', variant: 'danger',
      onClick: async () => {
        if (!await confirmDialog('Diese Buchung löschen?')) return false;
        store.remove('transactions', t.id, 'Buchung gelöscht');
        refresh?.();
      },
    });
  }
  actions.push({
    label: 'Speichern', variant: 'primary',
    onClick: () => {
      t.amount = round2(Number(t.amount) || 0);
      const valid = splits.filter((x) => Number(x.amount));
      t.splits = valid.length >= 2 ? valid.map((x) => ({
        categoryId: x.categoryId || null, amount: round2(Number(x.amount)), note: x.note || '',
      })) : null;
      t.manual = isNew ? true : t.manual;
      store.upsert('transactions', t, isNew ? 'Buchung erfasst' : 'Buchung geändert');
      toast(isNew ? 'Buchung erfasst' : 'Gespeichert', 'success');
      refresh?.();
    },
  });

  modal({ title: isNew ? 'Neue Buchung' : 'Buchung bearbeiten', body, actions, wide: true });
}

function openRuleFromTxn(t) {
  const draft = newRule(ruleFromTransaction(t, t.categoryId));
  const valueI = h('input', { type: 'text', value: draft.conditions[0].value, onInput: (e) => { draft.conditions[0].value = e.target.value; } });
  const fieldI = h('select', { onChange: (e) => { draft.conditions[0].field = e.target.value; } },
    h('option', { value: 'payee', selected: draft.conditions[0].field === 'payee' }, 'Zahlungsempfänger'),
    h('option', { value: 'description' }, 'Beschreibung'),
    h('option', { value: 'merchantCategory' }, 'Branche'));
  const catI = categorySelect({ value: draft.actions.categoryId, onChange: (v) => { draft.actions.categoryId = v; } });
  const applyI = h('input', { type: 'checkbox', checked: true });

  modal({
    title: 'Regel aus Buchung erstellen',
    body: h('div', { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', {}, 'Feld'), fieldI),
      h('label', { class: 'field' }, h('span', {}, 'enthält'), valueI),
      h('label', { class: 'field', style: { gridColumn: '1 / -1' } }, h('span', {}, 'Kategorie zuweisen'), catI),
      h('label', { class: 'row tight', style: { gridColumn: '1 / -1' } }, applyI, h('span', {}, 'Sofort auf bestehende Buchungen anwenden'))),
    actions: [
      { label: 'Abbrechen' },
      {
        label: 'Regel speichern', variant: 'primary',
        onClick: () => {
          draft.name = `${draft.conditions[0].value} → ${store.category(draft.actions.categoryId)?.name || ''}`;
          draft.sort = 50;
          store.upsert('rules', draft, 'Regel erstellt');
          if (applyI.checked) {
            const updates = applyRulesTo(store.idx.transactions, [draft], { onlyUncategorized: false, skipManual: false });
            if (updates.length) store.upsertMany('transactions', updates, 'Regel angewendet');
            toast(`Regel gespeichert – ${updates.length} Buchungen aktualisiert`, 'success');
          } else toast('Regel gespeichert', 'success');
        },
      },
    ],
  });
}

/* ---------------- CSV-Export ---------------- */

function exportCsv(txns) {
  const head = ['Datum', 'Empfänger', 'Beschreibung', 'Kategorie', 'Gruppe', 'Konto', 'Person', 'Betrag', 'Währung', 'Betrag CHF', 'Schlagwörter', 'Notiz'];
  const lines = [head.join(';')];
  for (const t of txns) {
    const c = store.category(t.categoryId);
    lines.push([
      t.date, t.payee, t.description, c?.name || '', store.group(c?.groupId)?.name || '',
      store.account(t.accountId)?.name || '', store.member(t.ownerId)?.name || '',
      String(t.amount).replace('.', ','), t.currency, String(round2(amountBase(t))).replace('.', ','),
      (t.tags || []).join('|'), t.notes || '',
    ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'));
  }
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `buchungen_${todayISO()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast('CSV exportiert', 'success');
}
