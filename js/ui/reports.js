// reports.js — eigene Auswertungen bauen, speichern und exportieren
import { store } from '../core/store.js';
import { h, fmtMoney, fmtPercent, fmtDate, uid, now, todayISO, sortBy, clone, round2 } from '../core/util.js';
import { runReport, runStacked, compareReport, PERIOD_TYPES, GROUP_BY, METRICS, CHART_TYPES, resolvePeriod } from '../core/reports.js';
import { chart } from './charts.js';
import { modal, toast, confirmDialog, emptyState, statTile, categorySelect, accountSelect, memberSelect, segmented } from './components.js';

const ui = {
  current: null,
  config: null,
  dirty: false,
};

function defaultConfig() {
  return { metric: 'ausgaben', groupBy: 'category', chart: 'donut', period: { type: 'thisMonth' }, filters: {}, limit: 12 };
}

export function renderReports({ params, navigate }) {
  const reports = sortBy(store.idx.reports, (r) => r.sort ?? 0);
  if (params.id && (!ui.current || ui.current !== params.id)) {
    const r = reports.find((x) => x.id === params.id);
    if (r) { ui.current = r.id; ui.config = clone(r.config); }
  }
  if (!ui.config) {
    const first = reports[0];
    ui.current = first?.id || null;
    ui.config = first ? clone(first.config) : defaultConfig();
  }

  const root = h('div', { class: 'split' });
  const side = h('div', {});
  const main = h('div', {});
  root.append(side, main);

  // Liste gespeicherter Berichte
  const list = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, 'Berichte'),
      h('button', {
        class: 'btn ghost sm', onClick: () => { ui.current = null; ui.config = defaultConfig(); rerender(); },
      }, '+ Neu')));
  for (const r of reports) {
    list.append(h('button', {
      class: 'navlink' + (r.id === ui.current ? ' active' : ''),
      onClick: () => { ui.current = r.id; ui.config = clone(r.config); rerender(); },
    }, h('span', { class: 'ico' }, r.builtin ? '◧' : '★'), h('span', { class: 'truncate' }, r.name)));
  }
  side.append(list);

  main.append(builderCard(rerender));
  main.append(resultCard(navigate));
  return root;

  function rerender() {
    const parent = root.parentElement;
    if (parent) parent.replaceChild(renderReports({ params: {}, navigate }), root);
  }
}

/* ---------------- Baukasten ---------------- */

function builderCard(rerender) {
  const c = ui.config;
  const card = h('section', { class: 'card' });

  const sel = (options, value, onChange, width = '190px') => {
    const s = h('select', { onChange: (e) => { onChange(e.target.value); rerender(); }, style: { maxWidth: width } },
      options.map((o) => h('option', { value: o.id ?? o.value, selected: (o.id ?? o.value) === value }, o.label)));
    return s;
  };

  const filters = c.filters || (c.filters = {});
  const accSel = accountSelect({
    value: filters.accountIds?.[0] || '', includeEmpty: true,
    onChange: (v) => { filters.accountIds = v ? [v] : []; rerender(); },
  });
  accSel.style.maxWidth = '190px';
  const ownSel = memberSelect({
    value: filters.ownerIds?.[0] || '', emptyLabel: 'Alle Personen',
    onChange: (v) => { filters.ownerIds = v ? [v] : []; rerender(); },
  });
  ownSel.style.maxWidth = '170px';

  card.append(h('div', { class: 'card-head' },
    h('h3', { class: 'grow' }, ui.current ? store.idx.reports.find((r) => r.id === ui.current)?.name || 'Bericht' : 'Neuer Bericht'),
    h('button', { class: 'btn sm', onClick: () => saveReport(rerender) }, '💾 Speichern'),
    h('button', { class: 'btn sm', onClick: () => pinToDashboard() }, '📌 Auf Übersicht'),
    ui.current && !store.idx.reports.find((r) => r.id === ui.current)?.builtin
      ? h('button', {
        class: 'btn ghost sm danger', onClick: async () => {
          if (!await confirmDialog('Bericht löschen?')) return;
          store.remove('reports', ui.current, 'Bericht gelöscht');
          ui.current = null; ui.config = defaultConfig(); rerender();
        },
      }, 'Löschen')
      : null));

  card.append(h('div', { class: 'row' },
    labeled('Kennzahl', sel(METRICS, c.metric, (v) => { c.metric = v; })),
    labeled('Gruppiert nach', sel(GROUP_BY, c.groupBy, (v) => { c.groupBy = v; })),
    labeled('Zeitraum', sel(PERIOD_TYPES, c.period.type, (v) => { c.period = v === 'custom' ? { type: 'custom', from: c.period.from, to: c.period.to } : { type: v }; })),
    labeled('Darstellung', sel(CHART_TYPES, c.chart, (v) => { c.chart = v; }, '150px')),
    labeled('Konto', accSel),
    labeled('Person', ownSel)));

  if (c.period.type === 'custom') {
    card.append(h('div', { class: 'row', style: { marginTop: '10px' } },
      labeled('Von', h('input', { type: 'date', value: c.period.from || '', onChange: (e) => { c.period.from = e.target.value; rerender(); } })),
      labeled('Bis', h('input', { type: 'date', value: c.period.to || todayISO(), onChange: (e) => { c.period.to = e.target.value; rerender(); } }))));
  }

  card.append(h('div', { class: 'row tight', style: { marginTop: '10px' } },
    toggleChip('Überträge einbeziehen', filters.includeTransfers, (v) => { filters.includeTransfers = v; rerender(); }),
    toggleChip('Ausgeschlossene einbeziehen', filters.includeExcluded, (v) => { filters.includeExcluded = v; rerender(); }),
    toggleChip('Nur nicht zugeordnet', filters.uncategorizedOnly, (v) => { filters.uncategorizedOnly = v; rerender(); }),
    h('input', {
      type: 'search', placeholder: 'Textsuche …', value: filters.search || '',
      style: { maxWidth: '220px' },
      onChange: (e) => { filters.search = e.target.value; rerender(); },
    })));
  return card;
}

function labeled(label, input) {
  return h('label', { class: 'field' }, h('span', {}, label), input);
}

function toggleChip(label, value, onChange) {
  return h('button', { class: 'chip' + (value ? ' active' : ''), onClick: () => onChange(!value) }, label);
}

/* ---------------- Ergebnis ---------------- */

function resultCard(navigate) {
  const c = ui.config;
  const cur = store.baseCurrency;
  const card = h('section', { class: 'card' });

  let result;
  try { result = compareReport(c); } catch (e) { result = runReport(c); }
  const period = resolvePeriod(c.period);

  card.append(h('div', { class: 'card-head' },
    h('div', { class: 'grow' },
      h('h3', {}, `${METRICS.find((m) => m.id === c.metric)?.label} nach ${GROUP_BY.find((g) => g.id === c.groupBy)?.label}`),
      h('div', { class: 'small muted' }, `${period.label} · ${fmtDate(period.from)} – ${fmtDate(period.to)}`)),
    h('button', { class: 'btn ghost sm', onClick: () => exportReportCsv(result) }, '⤓ CSV')));

  card.append(h('div', { class: 'stat-row', style: { marginBottom: '14px' } },
    statTile({ label: 'Total', value: c.metric === 'sparquote' ? fmtPercent(result.total, 1) : fmtMoney(result.total, cur), hero: true }),
    statTile({ label: 'Einnahmen', value: fmtMoney(result.totals.einnahmen, cur, { noDecimals: true }) }),
    statTile({ label: 'Ausgaben', value: fmtMoney(result.totals.ausgaben, cur, { noDecimals: true }) }),
    statTile({ label: 'Buchungen', value: String(result.totals.count) }),
    result.previousTotal !== undefined
      ? statTile({
        label: 'Vorperiode', value: fmtMoney(result.previousTotal, cur, { noDecimals: true }),
        sub: `${result.delta >= 0 ? '▲' : '▼'} ${fmtMoney(Math.abs(result.delta), cur, { noDecimals: true })}`,
      })
      : null));

  if (!result.rows.length) {
    card.append(emptyState('◧', 'Keine Daten im Zeitraum', 'Passe Zeitraum oder Filter an.',
      c.period.type !== 'last12'
        ? {
          label: 'Letzte 12 Monate anzeigen',
          onClick: () => {
            c.period = { type: 'last12' };
            const parent = card.parentElement;
            if (parent) parent.replaceChild(resultCard(navigate), card);
          },
        }
        : null));
    return card;
  }

  const fmt = c.metric === 'sparquote' ? (v) => fmtPercent(v, 1)
    : c.metric === 'anzahl' ? (v) => String(v) : null;

  if (c.chart === 'stacked') {
    const st = runStacked({ ...c, groupBy: c.groupBy === 'month' ? 'group' : c.groupBy });
    card.append(chart({
      type: 'stacked', height: 300, currency: cur,
      labels: st.periodLabels, series: st.series.slice(0, 8),
    }));
  } else if (c.chart !== 'table') {
    const type = c.chart === 'bar' && !result.timeBased && result.rows.length > 7 ? 'hbar' : c.chart;
    card.append(chart({
      type, height: type === 'hbar' ? Math.max(160, result.rows.length * 30) : 280,
      currency: cur, format: fmt,
      rows: result.rows,
      labels: result.rows.map((r) => r.label),
      series: [{ label: METRICS.find((m) => m.id === c.metric)?.label, color: 'var(--series-1)', values: result.rows.map((r) => r.value) }],
      area: c.chart === 'line',
      centerValue: c.chart === 'donut' ? fmtMoney(result.total, cur, { compact: true }) : undefined,
      centerLabel: c.chart === 'donut' ? 'Total' : undefined,
      percent: c.metric === 'sparquote',
    }));
  }

  // Tabelle (immer, als barrierefreie Zweitansicht)
  const table = h('table', { class: 'data' },
    h('thead', {}, h('tr', {},
      h('th', {}, GROUP_BY.find((g) => g.id === c.groupBy)?.label),
      h('th', { class: 'num' }, 'Wert'),
      h('th', { class: 'num' }, 'Anteil'),
      h('th', { class: 'num' }, 'Buchungen'),
      h('th', { class: 'num' }, 'Vorperiode'))));
  const tbody = h('tbody', {});
  for (const r of result.rows) {
    tbody.append(h('tr', {
      style: { cursor: 'pointer' },
      onClick: () => openDrilldown(r, c, navigate),
    },
      h('td', {}, h('i', { class: 'cat-dot', style: { background: r.color } }), r.label),
      h('td', { class: 'num mono' }, fmt ? fmt(r.value) : fmtMoney(r.value, cur)),
      h('td', { class: 'num muted' }, fmtPercent(r.share || 0, 1)),
      h('td', { class: 'num muted' }, String(r.count)),
      h('td', { class: 'num muted mono' }, r.previous !== undefined ? fmtMoney(r.previous, cur, { noDecimals: true }) : '–')));
  }
  table.append(tbody);
  card.append(h('div', { class: 'table-wrap', style: { marginTop: '14px' } }, table));
  return card;
}

function openDrilldown(row, config, navigate) {
  const cur = store.baseCurrency;
  const txns = sortBy(row.txns || [], (t) => t.date, -1).slice(0, 200);
  const body = h('div', {});
  body.append(h('p', { class: 'small muted' }, `${row.count} Buchungen · ${fmtMoney(row.value, cur)}`));
  const table = h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Datum'), h('th', {}, 'Empfänger'), h('th', {}, 'Kategorie'), h('th', { class: 'num' }, 'Betrag'))));
  const tbody = h('tbody', {});
  for (const t of txns) {
    tbody.append(h('tr', {},
      h('td', { class: 'mono nowrap' }, fmtDate(t.date)),
      h('td', {}, t.payee || t.description),
      h('td', { class: 'small' }, store.category(t.categoryId)?.name || '–'),
      h('td', { class: `num mono ${t.amount > 0 ? 'pos' : ''}` }, fmtMoney(t.amount, t.currency))));
  }
  table.append(tbody);
  body.append(h('div', { class: 'table-wrap' }, table));
  modal({ title: row.label, body, wide: true, actions: [{ label: 'Schliessen', variant: 'primary' }] });
}

/* ---------------- Speichern / Anheften ---------------- */

function saveReport(rerender) {
  const existing = ui.current ? store.idx.reports.find((r) => r.id === ui.current) : null;
  const nameI = h('input', { type: 'text', value: existing && !existing.builtin ? existing.name : '' , placeholder: 'z. B. Ferienbudget 2026' });
  modal({
    title: 'Bericht speichern',
    body: h('div', {},
      h('label', { class: 'field' }, h('span', {}, 'Name'), nameI),
      existing?.builtin ? h('p', { class: 'small muted' }, 'Vorgefertigte Berichte werden als neue Kopie gespeichert.') : null),
    actions: [
      { label: 'Abbrechen' },
      {
        label: 'Speichern', variant: 'primary',
        onClick: () => {
          const name = nameI.value.trim() || 'Eigener Bericht';
          if (existing && !existing.builtin) {
            store.upsert('reports', { ...existing, name, config: clone(ui.config) }, 'Bericht gespeichert');
          } else {
            const rep = { id: uid('rep'), name, config: clone(ui.config), sort: store.idx.reports.length, builtin: false, updatedAt: now() };
            store.upsert('reports', rep, 'Bericht gespeichert');
            ui.current = rep.id;
          }
          toast('Bericht gespeichert', 'success');
          rerender();
        },
      },
    ],
  });
}

function pinToDashboard() {
  let reportId = ui.current;
  if (!reportId) {
    const rep = { id: uid('rep'), name: 'Eigener Bericht', config: clone(ui.config), sort: store.idx.reports.length, builtin: false, updatedAt: now() };
    store.upsert('reports', rep, 'Bericht gespeichert');
    reportId = rep.id;
    ui.current = rep.id;
  }
  const rep = store.idx.reports.find((r) => r.id === reportId);
  store.upsert('widgets', {
    id: uid('w'), type: 'report', title: rep.name, size: 'normal',
    sort: store.idx.widgets.length, config: { reportId }, updatedAt: now(),
  }, 'Bericht angeheftet');
  toast('Auf der Übersicht angeheftet', 'success');
}

function exportReportCsv(result) {
  const lines = ['Gruppe;Wert;Einnahmen;Ausgaben;Netto;Buchungen'];
  for (const r of result.rows) {
    lines.push([r.label, r.value, r.einnahmen, r.ausgaben, r.netto, r.count]
      .map((v) => `"${String(v).replace(/\./g, ',')}"`).join(';'));
  }
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bericht_${todayISO()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
