// networth.js — Nettovermögen, manuelle Vermögenswerte und Verbindlichkeiten
import { store } from '../core/store.js';
import { h, fmtMoney, fmtDate, monthLabel, todayISO, CURRENCIES, sortBy, round2, addMonths, currentMonthKey } from '../core/util.js';
import { newAsset, ASSET_TYPES } from '../core/model.js';
import { netWorthAt, netWorthSeries, assetValue, assetTypeInfo, accountTypeInfo } from '../core/analytics.js';
import { chart } from './charts.js';
import { modal, toast, confirmDialog, statTile, memberSelect, emptyState, segmented, warningCard } from './components.js';
import { unknownCurrencies, fetchRates } from '../core/fx.js';

const ui = { months: 24 };

export function renderNetWorth({ navigate }) {
  const cur = store.baseCurrency;
  const root = h('div', {});
  const snap = netWorthAt();
  const series = netWorthSeries(ui.months);
  const prevYear = series.length > 12 ? series[series.length - 13].net : series[0].net;

  const missing = unknownCurrencies();
  if (missing.length) {
    root.append(warningCard(
      `Kein Wechselkurs für ${missing.join(', ')}`,
      `Beträge in ${missing.join(', ')} fliessen zurzeit 1:1 ins Nettovermögen ein.`,
      { label: 'Kurse holen', onClick: () => fetchRates().then(() => rerender()).catch((e) => toast(e.message, 'error')) }));
  }
  root.append(h('div', { class: 'card' },
    h('div', { class: 'row' },
      h('div', { class: 'grow stat-row' },
        statTile({
          label: 'Nettovermögen heute', value: fmtMoney(snap.net, cur), hero: true,
          sub: `${snap.net - prevYear >= 0 ? '▲' : '▼'} ${fmtMoney(Math.abs(snap.net - prevYear), cur, { noDecimals: true })} gegenüber ${monthLabel(addMonths(currentMonthKey(), -12), true)}`,
        }),
        statTile({ label: 'Vermögen', value: fmtMoney(snap.assets, cur, { noDecimals: true }) }),
        statTile({ label: 'Verbindlichkeiten', value: fmtMoney(snap.liabilities, cur, { noDecimals: true }) })),
      segmented([{ value: 12, label: '1 J' }, { value: 24, label: '2 J' }, { value: 60, label: '5 J' }], ui.months,
        (v) => { ui.months = v; rerender(); }))));

  root.append(h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, 'Entwicklung')),
    chart({
      type: 'line', height: 260, area: true, currency: cur,
      labels: series.map((x) => monthLabel(x.month, true)),
      series: [
        { label: 'Nettovermögen', color: 'var(--series-1)', values: series.map((x) => x.net) },
        { label: 'Vermögen', color: 'var(--series-3)', values: series.map((x) => x.assets), area: false },
        { label: 'Verbindlichkeiten', color: 'var(--series-2)', values: series.map((x) => -x.liabilities), area: false },
      ],
    })));

  // Zusammensetzung
  const positive = snap.rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const negative = snap.rows.filter((r) => r.value < 0).sort((a, b) => a.value - b.value);
  const compo = h('div', { class: 'grid' });
  compo.append(h('section', { class: 'card g-6' },
    h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, 'Vermögen')),
    positive.length
      ? chart({
        type: 'hbar', height: Math.max(120, positive.length * 30), currency: cur, legend: false,
        rows: positive.map((r, i) => ({ label: r.name, value: r.value, color: `var(--series-${(i % 8) + 1})` })),
      })
      : h('p', { class: 'muted small' }, 'Noch keine Positionen.')));
  compo.append(h('section', { class: 'card g-6' },
    h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, 'Verbindlichkeiten')),
    negative.length
      ? chart({
        type: 'hbar', height: Math.max(120, negative.length * 30), currency: cur, legend: false,
        rows: negative.map((r) => ({ label: r.name, value: Math.abs(r.value), color: 'var(--series-2)' })),
      })
      : h('p', { class: 'muted small' }, 'Keine Schulden erfasst – schön.')));
  root.append(compo);

  // Manuelle Positionen
  const card = h('section', { class: 'card' });
  card.append(h('div', { class: 'card-head' },
    h('h3', { class: 'grow' }, 'Weitere Positionen'),
    h('button', { class: 'btn primary sm', onClick: () => openAssetEditor(null) }, '+ Position')));
  card.append(h('p', { class: 'small muted' }, 'Hier gehören Werte hin, die nicht als Konto geführt werden: Immobilie, Fahrzeug, Hypothek, Steuerschuld, Beteiligungen.'));

  const assets = store.idx.assets;
  if (!assets.length) {
    card.append(emptyState('▲', 'Noch keine weiteren Positionen', 'Zum Beispiel eine Wohnung mit dazugehöriger Hypothek.',
      { label: 'Position anlegen', onClick: () => openAssetEditor(null) }));
  } else {
    for (const a of assets) {
      const info = assetTypeInfo(a.type);
      const val = assetValue(a);
      card.append(h('div', { class: 'list-row', style: { cursor: 'pointer' }, onClick: () => openAssetEditor(a) },
        h('div', { class: 'grow' },
          h('div', { class: 'title' }, a.name),
          h('div', { class: 'txn-sub' }, `${info.label}${a.valuations?.length ? ` · Stand ${fmtDate(sortBy(a.valuations, (v) => v.date, -1)[0].date)}` : ''}`)),
        h('span', { class: `mono ${info.side === 'liability' ? 'neg' : ''}` },
          fmtMoney(info.side === 'liability' ? -Math.abs(val) : val, a.currency))));
    }
  }
  root.append(card);
  return root;

  function rerender() {
    const parent = root.parentElement;
    if (parent) parent.replaceChild(renderNetWorth({ navigate }), root);
  }
}

/* ---------------- Position bearbeiten ---------------- */

function openAssetEditor(asset) {
  const isNew = !asset;
  const a = asset ? { ...asset, valuations: [...(asset.valuations || [])] } : newAsset();
  const field = (label, input, full) => h('label', { class: 'field', style: full ? { gridColumn: '1 / -1' } : {} }, h('span', {}, label), input);

  const nameI = h('input', { type: 'text', value: a.name, onInput: (e) => { a.name = e.target.value; } });
  const typeI = h('select', { onChange: (e) => { a.type = e.target.value; } },
    ASSET_TYPES.map((t) => h('option', { value: t.id, selected: t.id === a.type }, `${t.label} (${t.side === 'liability' ? 'Schuld' : 'Vermögen'})`)));
  const curI = h('select', { onChange: (e) => { a.currency = e.target.value; } },
    CURRENCIES.map((c) => h('option', { value: c, selected: c === a.currency }, c)));
  const ownI = memberSelect({ value: a.ownerId, onChange: (v) => { a.ownerId = v; } });

  const valList = h('div', {});
  const dateI = h('input', { type: 'date', value: todayISO(), style: { maxWidth: '160px' } });
  const valI = h('input', { type: 'number', step: '100', placeholder: 'Wert', style: { maxWidth: '150px' } });

  function refreshVals() {
    valList.replaceChildren();
    for (const v of sortBy(a.valuations, (x) => x.date, -1)) {
      valList.append(h('div', { class: 'list-row' },
        h('span', { class: 'grow mono' }, fmtDate(v.date)),
        h('span', { class: 'mono' }, fmtMoney(v.value, a.currency)),
        h('button', {
          class: 'btn ghost sm',
          onClick: () => { a.valuations = a.valuations.filter((x) => x.date !== v.date); refreshVals(); },
        }, '✕')));
    }
    if (!a.valuations.length) valList.append(h('p', { class: 'small muted' }, 'Noch kein Wert erfasst.'));
  }
  refreshVals();

  modal({
    title: isNew ? 'Neue Position' : 'Position bearbeiten', wide: true,
    body: h('div', {},
      h('div', { class: 'form-grid' },
        field('Bezeichnung', nameI), field('Art', typeI),
        field('Währung', curI), field('Gehört zu', ownI)),
      h('h3', { style: { marginTop: '18px' } }, 'Wertverlauf'),
      h('p', { class: 'small muted' }, 'Erfasse den Wert jeweils zum Stichtag – die Vermögenskurve nutzt den jeweils letzten bekannten Wert.'),
      h('div', { class: 'row' }, dateI, valI,
        h('button', {
          class: 'btn', onClick: () => {
            if (!valI.value) return;
            a.valuations = [...a.valuations.filter((x) => x.date !== dateI.value), { date: dateI.value, value: round2(Number(valI.value)) }];
            valI.value = '';
            refreshVals();
          },
        }, '+ Wert erfassen')),
      valList),
    actions: [
      { label: 'Abbrechen' },
      !isNew ? {
        label: 'Löschen', variant: 'danger',
        onClick: async () => {
          if (!await confirmDialog(`Position „${a.name}“ löschen?`)) return false;
          store.remove('assets', a.id, 'Position gelöscht');
        },
      } : null,
      {
        label: 'Speichern', variant: 'primary',
        onClick: () => { store.upsert('assets', a, isNew ? 'Position angelegt' : 'Position geändert'); toast('Gespeichert', 'success'); },
      },
    ].filter(Boolean),
  });
}
