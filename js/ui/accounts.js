// accounts.js — Konten verwalten
import { store } from '../core/store.js';
import { h, fmtMoney, fmtDate, todayISO, sortBy, round2 } from '../core/util.js';
import { ACCOUNT_TYPES, newAccount } from '../core/model.js';
import { accountsOverview, accountBalance, accountSeries, accountTypeInfo } from '../core/analytics.js';
import { chart } from './charts.js';
import { modal, toast, confirmDialog, memberSelect, emptyState, statTile, colorSwatches } from './components.js';
import { CURRENCIES } from '../core/util.js';

export function renderAccounts({ params, navigate }) {
  if (params.id) return accountDetail(params.id, navigate);

  const root = h('div', {});
  const groups = accountsOverview();
  const cur = store.baseCurrency;
  const labels = { liquid: 'Liquide Mittel', kredit: 'Karten, Kredite & Hypotheken', anlage: 'Anlagen', vorsorge: 'Vorsorge' };

  const total = Object.values(groups).flat().reduce((a, r) => a + r.balanceBase, 0);
  root.append(h('div', { class: 'card' },
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, statTile({ label: 'Summe aller Konten', value: fmtMoney(total, cur), hero: false })),
      h('button', { class: 'btn primary', onClick: () => openAccountEditor(null) }, '+ Konto'))));

  const anyAccounts = Object.values(groups).some((g) => g.length);
  if (!anyAccounts) {
    root.append(h('div', { class: 'card' }, emptyState('▤', 'Noch keine Konten',
      'Konten entstehen automatisch beim Import – oder du legst sie hier von Hand an.',
      { label: 'Datei importieren', onClick: () => navigate('import') })));
    return root;
  }

  for (const [key, rows] of Object.entries(groups)) {
    if (!rows.length) continue;
    const card = h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', { class: 'grow' }, labels[key]),
        h('span', { class: 'mono' }, fmtMoney(rows.reduce((a, r) => a + r.balanceBase, 0), cur))));
    for (const r of rows) {
      const series = accountSeries(r.account, 12).map((x) => x.value);
      card.append(h('div', { class: 'list-row', style: { cursor: 'pointer' }, onClick: () => navigate('konten', { id: r.account.id }) },
        h('div', { class: 'grow truncate' },
          h('div', { class: 'title truncate' }, r.account.name),
          h('div', { class: 'txn-sub truncate' },
            [r.info.label, r.account.institution, r.account.iban ? `IBAN ${r.account.iban.slice(-6)}` : '',
              store.member(r.account.ownerId)?.name].filter(Boolean).join(' · '))),
        h('div', { style: { width: '80px' } }, chart({ type: 'sparkline', values: series, height: 30, area: true, legend: false })),
        h('div', { class: 'right' },
          h('div', { class: 'mono', style: { fontWeight: '560' } }, fmtMoney(r.balance, r.account.currency)),
          r.account.currency !== cur ? h('div', { class: 'txn-sub' }, fmtMoney(r.balanceBase, cur)) : null)));
    }
    root.append(card);
  }

  const archived = store.idx.accounts.filter((a) => a.archived);
  if (archived.length) {
    const det = h('details', { class: 'acc' }, h('summary', {}, `Archivierte Konten (${archived.length})`));
    for (const a of archived) {
      det.append(h('div', { class: 'list-row' },
        h('span', { class: 'grow' }, a.name),
        h('button', { class: 'btn ghost sm', onClick: () => store.patch('accounts', a.id, { archived: false }, 'Konto reaktiviert') }, 'Reaktivieren')));
    }
    root.append(det);
  }
  return root;
}

/* ---------------- Detail ---------------- */

function accountDetail(id, navigate) {
  const acc = store.account(id);
  if (!acc) return emptyState('▤', 'Konto nicht gefunden', null, { label: 'Zurück', onClick: () => navigate('konten') });
  const root = h('div', {});
  const txns = sortBy((store.idx.txnByAccount.get(id) || []).filter((t) => !t.deleted), (t) => t.date, -1);
  const series = accountSeries(acc, 24);

  root.append(h('div', { class: 'card' },
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost sm', onClick: () => navigate('konten') }, '‹ Konten'),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn', onClick: () => openBalanceEditor(acc) }, 'Saldo erfassen'),
      h('button', { class: 'btn', onClick: () => openAccountEditor(acc) }, 'Bearbeiten')),
    h('div', { class: 'stat-row', style: { marginTop: '12px' } },
      statTile({ label: acc.name, value: fmtMoney(accountBalance(acc), acc.currency), hero: true, sub: accountTypeInfo(acc.type).label }),
      statTile({ label: 'Buchungen', value: String(txns.length) }),
      statTile({ label: 'Älteste Buchung', value: txns.length ? fmtDate(txns[txns.length - 1].date) : '–' }))));

  root.append(h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, 'Saldoverlauf')),
    chart({
      type: 'line', height: 220, area: true, currency: acc.currency,
      labels: series.map((x) => x.month.slice(2).replace('-', '/')),
      series: [{ label: acc.name, color: 'var(--series-1)', values: series.map((x) => x.value) }],
    })));

  if (acc.manualBalances?.length) {
    const card = h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, 'Erfasste Saldi')));
    for (const b of sortBy(acc.manualBalances, (x) => x.date, -1)) {
      card.append(h('div', { class: 'list-row' },
        h('span', { class: 'grow mono' }, fmtDate(b.date)),
        h('span', { class: 'mono' }, fmtMoney(b.value, acc.currency)),
        h('button', {
          class: 'btn ghost sm', onClick: () => {
            store.patch('accounts', acc.id, { manualBalances: acc.manualBalances.filter((x) => x.date !== b.date) }, 'Saldo entfernt');
          },
        }, '✕')));
    }
    root.append(card);
  }

  const list = h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h3', { class: 'grow' }, 'Letzte Buchungen'),
      h('button', { class: 'btn ghost sm', onClick: () => navigate('buchungen', { account: acc.id }) }, 'Alle anzeigen')));
  for (const t of txns.slice(0, 25)) {
    list.append(h('div', { class: 'list-row' },
      h('div', { class: 'grow truncate' },
        h('div', { class: 'txn-payee truncate' }, t.payee || t.description),
        h('div', { class: 'txn-sub' }, `${fmtDate(t.date)} · ${store.category(t.categoryId)?.name || 'Nicht zugeordnet'}`)),
      h('span', { class: `mono ${t.amount > 0 ? 'pos' : ''}` }, fmtMoney(t.amount, t.currency))));
  }
  root.append(list);
  return root;
}

/* ---------------- Bearbeiten ---------------- */

export function openAccountEditor(account, onSaved) {
  const isNew = !account;
  const a = account ? { ...account } : newAccount();
  const field = (label, input, full) => h('label', { class: 'field', style: full ? { gridColumn: '1 / -1' } : {} }, h('span', {}, label), input);

  const nameI = h('input', { type: 'text', value: a.name, onInput: (e) => { a.name = e.target.value; } });
  const typeI = h('select', { onChange: (e) => { a.type = e.target.value; } },
    ACCOUNT_TYPES.map((t) => h('option', { value: t.id, selected: t.id === a.type }, t.label)));
  const instI = h('input', { type: 'text', value: a.institution, placeholder: 'UBS, PostFinance, Viseca …', onInput: (e) => { a.institution = e.target.value; } });
  const curI = h('select', { onChange: (e) => { a.currency = e.target.value; } },
    CURRENCIES.map((c) => h('option', { value: c, selected: c === a.currency }, c)));
  const ownI = memberSelect({ value: a.ownerId, onChange: (v) => { a.ownerId = v; } });
  const ibanI = h('input', { type: 'text', value: a.iban, onInput: (e) => { a.iban = e.target.value; } });
  const openI = h('input', { type: 'number', step: '0.05', value: a.openingBalance, onInput: (e) => { a.openingBalance = Number(e.target.value); } });
  const modeI = h('select', { onChange: (e) => { a.balanceMode = e.target.value; } },
    h('option', { value: 'transactions', selected: a.balanceMode === 'transactions' }, 'Aus Buchungen berechnen'),
    h('option', { value: 'manual', selected: a.balanceMode === 'manual' }, 'Manuell gepflegter Wert (Depot, 3a)'));
  const nwI = h('input', { type: 'checkbox', checked: a.includeInNetWorth !== false, onChange: (e) => { a.includeInNetWorth = e.target.checked; } });
  const sigI = h('input', { type: 'text', value: a.importSignature || '', placeholder: 'Kontonummer aus der Bankdatei', onInput: (e) => { a.importSignature = e.target.value; } });

  modal({
    title: isNew ? 'Neues Konto' : 'Konto bearbeiten', wide: true,
    body: h('div', {},
      h('div', { class: 'form-grid' },
        field('Name', nameI), field('Typ', typeI),
        field('Bank / Anbieter', instI), field('Währung', curI),
        field('Gehört zu', ownI), field('IBAN / Kartennummer', ibanI),
        field('Eröffnungssaldo', openI), field('Saldoermittlung', modeI),
        field('Import-Kennung', sigI, true),
        h('label', { class: 'row tight', style: { gridColumn: '1 / -1' } }, nwI, h('span', {}, 'Im Nettovermögen berücksichtigen'))),
      h('div', { style: { marginTop: '12px' } }, h('span', { class: 'small muted' }, 'Farbe'), colorSwatches(a.color, (c) => { a.color = c; }))),
    actions: [
      { label: 'Abbrechen' },
      !isNew ? {
        label: a.archived ? 'Reaktivieren' : 'Archivieren',
        onClick: () => { store.patch('accounts', a.id, { archived: !a.archived }, 'Konto archiviert'); onSaved?.(); },
      } : null,
      {
        label: 'Speichern', variant: 'primary',
        onClick: () => { store.upsert('accounts', a, isNew ? 'Konto angelegt' : 'Konto geändert'); toast('Gespeichert', 'success'); onSaved?.(); },
      },
    ].filter(Boolean),
  });
}

function openBalanceEditor(acc) {
  const dateI = h('input', { type: 'date', value: todayISO() });
  const valI = h('input', { type: 'number', step: '0.05', value: accountBalance(acc) });
  modal({
    title: `Saldo erfassen – ${acc.name}`,
    body: h('div', {},
      h('p', { class: 'small muted' }, 'Der erfasste Saldo dient als Ankerpunkt: spätere Buchungen werden darauf aufgerechnet. So stimmt der Kontostand auch dann, wenn der Auszug nicht bis zur Kontoeröffnung zurückreicht.'),
      h('div', { class: 'form-grid' },
        h('label', { class: 'field' }, h('span', {}, 'Datum'), dateI),
        h('label', { class: 'field' }, h('span', {}, `Saldo (${acc.currency})`), valI))),
    actions: [
      { label: 'Abbrechen' },
      {
        label: 'Speichern', variant: 'primary',
        onClick: () => {
          const list = [...(acc.manualBalances || []).filter((b) => b.date !== dateI.value),
            { date: dateI.value, value: round2(Number(valI.value)) }];
          store.patch('accounts', acc.id, { manualBalances: list }, 'Saldo erfasst');
          toast('Saldo gespeichert', 'success');
        },
      },
    ],
  });
}
