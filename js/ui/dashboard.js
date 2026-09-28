// dashboard.js — konfigurierbare Übersichtsseite
import { store } from '../core/store.js';
import { h, fmtMoney, fmtDate, fmtPercent, monthLabel, currentMonthKey, monthKey, addMonths, sortBy } from '../core/util.js';
import { chart, meter } from './charts.js';
import { statTile, emptyState, categoryChip, toast, modal, segmented } from './components.js';
import { netWorthSeries, netWorthAt, cashflowSeries, accountsOverview, amountBase, activeMonth } from '../core/analytics.js';
import { seriesOverview, cadenceInfo } from '../core/recurring.js';
import { monthOverview } from '../core/budget.js';
import { goalsOverview, forecast } from '../core/goals.js';
import { runReport } from '../core/reports.js';
import { uid, now } from '../core/util.js';
import { loadDemoData, clearDemoData } from '../core/demo.js';
import { detectCardPayments } from '../core/importer.js';
import { portfolio, allocation } from '../core/investments.js';
import { openDoubleCountCheck } from './importview.js';

const WIDGET_TYPES = [
  { id: 'networth', label: 'Nettovermögen', size: 'wide' },
  { id: 'flexbudget', label: 'Flex-Budget', size: 'normal' },
  { id: 'cashflow', label: 'Cashflow', size: 'normal' },
  { id: 'topcategories', label: 'Grösste Ausgaben', size: 'normal' },
  { id: 'accounts', label: 'Konten', size: 'normal' },
  { id: 'goals', label: 'Sparziele', size: 'normal' },
  { id: 'recent', label: 'Letzte Buchungen', size: 'wide' },
  { id: 'upcoming', label: 'Wiederkehrende Zahlungen', size: 'normal' },
  { id: 'owners', label: 'Ausgaben pro Person', size: 'normal' },
  { id: 'depot', label: 'Wertschriftendepot', size: 'normal' },
  { id: 'report', label: 'Gespeicherter Bericht', size: 'normal' },
];

export function renderDashboard({ navigate }) {
  const root = h('div', {});
  const cur = store.baseCurrency;

  if (!store.idx.transactions.length) {
    const empty = h('div', { class: 'card' }, emptyState('⤓', 'Noch keine Daten',
      'Importiere zuerst einen Konto- oder Kartenauszug. Die App erkennt die Formate von UBS, PostFinance und Supercard automatisch.',
      { label: 'Datei importieren', onClick: () => navigate('import') }));
    if (window.__HAUSHALT_SINGLE_FILE) {
      empty.append(h('div', { class: 'center', style: { marginTop: '-18px' } },
        h('button', {
          class: 'btn', onClick: () => {
            const r = loadDemoData();
            toast(`Beispielhaushalt geladen: ${r.transactions} Buchungen über ${r.months} Monate`, 'success');
          },
        }, 'Beispieldaten laden'),
        h('p', { class: 'small muted', style: { marginTop: '8px' } },
          'Erfundener Musterhaushalt zum Ausprobieren – jederzeit unter Einstellungen → Daten wieder entfernbar.')));
    }
    return h('div', {}, hero(cur), empty);
  }
  if (window.__HAUSHALT_SINGLE_FILE && store.idx.accounts.some((a) => a.id.startsWith('demo_'))) {
    root.append(h('div', { class: 'row', style: { marginBottom: '12px' } },
      h('span', { class: 'badge warn' }, 'Beispieldaten'),
      h('span', { class: 'small muted grow' }, 'Erfundener Musterhaushalt – deine eigenen Importe kommen normal dazu.'),
      h('button', {
        class: 'btn ghost sm', onClick: () => { clearDemoData(); toast('Beispieldaten entfernt', 'success'); },
      }, 'Entfernen')));
  }

  const month = activeMonth();
  root.append(hero(cur, month));
  if (month !== currentMonthKey()) {
    root.append(h('p', { class: 'small muted', style: { marginTop: '-6px', marginBottom: '12px' } },
      `Im laufenden Monat sind noch keine Buchungen erfasst – gezeigt wird ${monthLabel(month)}.`));
  }

  // Warnung, wenn Kreditkartenzahlungen doppelt zählen würden
  const dbl = detectCardPayments();
  const risky = dbl.items.filter((i) => i.confident);
  if (risky.length) {
    root.append(h('section', {
      class: 'card',
      style: { marginBottom: '14px', borderLeft: '3px solid var(--warning)' },
    },
      h('div', { class: 'row' },
        h('div', { class: 'grow' },
          h('div', { style: { fontWeight: '600' } },
            `${risky.length} Kreditkartenzahlung${risky.length > 1 ? 'en' : ''} zählen doppelt`),
          h('div', { class: 'small muted' },
            `${fmtMoney(Math.abs(risky.reduce((a, i) => a + i.txn.amount, 0)), cur, { noDecimals: true })} an Kartenanbieter, `
            + 'deren Einkäufe bereits einzeln erfasst sind. Als Übertrag markieren, damit das Budget stimmt.')),
        h('button', { class: 'btn primary', onClick: () => openDoubleCountCheck() }, 'Prüfen'))));
  }

  const bar = h('div', { class: 'row', style: { marginBottom: '14px' } },
    h('div', { class: 'grow' }),
    h('button', { class: 'btn ghost sm', onClick: () => openCustomizer(navigate) }, '⚙ Übersicht anpassen'));
  root.append(bar);

  const grid = h('div', { class: 'grid' });
  const widgets = sortBy(store.idx.widgets.filter((w) => !w.hidden), (w) => w.sort ?? 0);
  for (const w of widgets) {
    const card = renderWidget(w, navigate);
    if (card) {
      card.classList.add(w.size === 'wide' ? 'g-8' : w.size === 'full' ? 'g-12' : 'g-4');
      grid.append(card);
    }
  }
  root.append(grid);
  return root;
}

function hero(cur, month = currentMonthKey()) {
  const nw = netWorthAt();
  const series = netWorthSeries(13);
  const prev = series.length > 1 ? series[series.length - 2].net : nw.net;
  const delta = nw.net - prev;
  const flex = monthOverview(month);
  const cf = cashflowSeries(1, { endMonth: month })[0];

  return h('div', { class: 'card', style: { marginBottom: '14px' } },
    h('div', { class: 'stat-row' },
      statTile({
        label: 'Nettovermögen', value: fmtMoney(nw.net, cur, { noDecimals: true }), hero: true,
        sub: `${delta >= 0 ? '▲' : '▼'} ${fmtMoney(Math.abs(delta), cur, { noDecimals: true })} seit ${monthLabel(addMonths(currentMonthKey(), -1), true)}`,
      }),
      statTile({ label: `Einnahmen ${monthLabel(month, true)}`, value: fmtMoney(cf?.einnahmen || 0, cur, { noDecimals: true }) }),
      statTile({ label: `Ausgaben ${monthLabel(month, true)}`, value: fmtMoney(cf?.ausgaben || 0, cur, { noDecimals: true }) }),
      statTile({
        label: 'Flexibel frei', value: fmtMoney(flex.flex.remaining, cur, { noDecimals: true }),
        tone: flex.flex.remaining < 0 ? 'neg' : '',
        sub: flex.flex.daysLeft > 0 ? `${fmtMoney(flex.flex.perDay, cur, { noDecimals: true })} pro Tag bis Monatsende` : 'Monat abgeschlossen',
      }),
      statTile({ label: 'Sparquote', value: fmtPercent(cf?.sparquote || 0, 0) }),
    ));
}

/* ---------------- Widgets ---------------- */

function widgetCard(title, body, { action } = {}) {
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, title), action),
    body);
}

function renderWidget(w, navigate) {
  const cur = store.baseCurrency;
  const month = activeMonth();
  try {
    switch (w.type) {
      case 'networth': {
        const months = w.config?.months || 12;
        const s = netWorthSeries(months);
        return widgetCard(w.title || 'Nettovermögen',
          chart({
            type: 'line', height: 210, area: true, currency: cur,
            labels: s.map((x) => monthLabel(x.month, true)),
            series: [{ label: 'Nettovermögen', color: 'var(--series-1)', values: s.map((x) => x.net) }],
          }),
          { action: h('button', { class: 'btn ghost sm', onClick: () => navigate('vermoegen') }, 'Details') });
      }
      case 'flexbudget': {
        const o = monthOverview(month);
        const box = h('div', {});
        box.append(meter({
          label: 'Flexibel ausgegeben', value: o.flex.spent, max: o.flex.pool,
          status: o.flex.pool && o.flex.spent > o.flex.pool ? 'critical' : o.flex.onTrack ? 'good' : 'warning',
          sublabel: o.flex.pool
            ? `${fmtMoney(o.flex.remaining, cur, { noDecimals: true })} übrig · erwartet bis heute ${fmtMoney(o.flex.expectedByNow, cur, { noDecimals: true })}`
            : 'Noch kein Einkommen budgetiert',
        }));
        box.append(meter({ label: 'Fixkosten', value: o.fixed.actual, max: o.fixed.planned || o.fixed.actual, color: 'var(--series-7)' }));
        box.append(meter({ label: 'Rückstellungen', value: o.reserves.actual, max: o.reserves.planned || o.reserves.actual, color: 'var(--series-4)' }));
        box.append(meter({ label: 'Sparen & Vorsorge', value: o.savings.actual, max: o.savings.planned || o.savings.actual, color: 'var(--series-3)' }));
        return widgetCard(w.title || 'Flex-Budget', box,
          { action: h('button', { class: 'btn ghost sm', onClick: () => navigate('budget') }, 'Budget') });
      }
      case 'cashflow': {
        const months = w.config?.months || 6;
        const s = cashflowSeries(months, { endMonth: month });
        return widgetCard(w.title || 'Cashflow',
          chart({
            type: 'bar', height: 200, dual: true, currency: cur,
            legendItems: [
              { label: 'Einnahmen', color: 'var(--series-6)' },
              { label: 'Ausgaben', color: 'var(--series-2)' },
            ],
            rows: s.map((x) => ({
              label: monthLabel(x.month, true), value: x.einnahmen, value2: -x.ausgaben,
              color: 'var(--series-6)', color2: 'var(--series-2)',
            })),
          }));
      }
      case 'topcategories': {
        const r = runReport({ metric: 'ausgaben', groupBy: 'category', period: { type: 'month', month }, limit: w.config?.limit || 8 });
        if (!r.rows.length) return widgetCard(w.title || 'Grösste Ausgaben', h('p', { class: 'muted small' }, `Keine Ausgaben in ${monthLabel(month)}.`));
        return widgetCard(w.title || 'Grösste Ausgaben',
          chart({ type: 'hbar', height: 220, rows: r.rows, currency: cur, legend: false }),
          { action: h('button', { class: 'btn ghost sm', onClick: () => navigate('berichte') }, 'Berichte') });
      }
      case 'accounts': {
        const groups = accountsOverview();
        const list = h('div', {});
        const labels = { liquid: 'Liquide Mittel', kredit: 'Karten & Kredite', anlage: 'Anlagen', vorsorge: 'Vorsorge' };
        for (const [key, rows] of Object.entries(groups)) {
          if (!rows.length) continue;
          list.append(h('div', { class: 'group-head' }, h('span', { class: 'grow' }, labels[key]),
            h('span', { class: 'mono' }, fmtMoney(rows.reduce((a, r) => a + r.balanceBase, 0), cur, { noDecimals: true }))));
          for (const r of rows.slice(0, 6)) {
            list.append(h('div', { class: 'list-row' },
              h('div', { class: 'grow truncate' },
                h('div', { class: 'title truncate' }, r.account.name),
                h('div', { class: 'txn-sub' }, `${r.info.label}${r.account.currency !== cur ? ' · ' + r.account.currency : ''}`)),
              h('span', { class: 'mono' }, fmtMoney(r.balance, r.account.currency, { noDecimals: true }))));
          }
        }
        return widgetCard(w.title || 'Konten', list,
          { action: h('button', { class: 'btn ghost sm', onClick: () => navigate('konten') }, 'Alle') });
      }
      case 'goals': {
        const ov = goalsOverview();
        if (!ov.rows.length) return widgetCard(w.title || 'Sparziele', emptyState('◈', 'Noch keine Sparziele', null, { label: 'Ziel anlegen', onClick: () => navigate('ziele') }));
        const box = h('div', {});
        for (const { goal, fc } of ov.rows.slice(0, 4)) {
          box.append(meter({
            label: `${goal.icon || '🎯'} ${goal.name}`, value: fc.start, max: goal.targetAmount,
            format: (v) => fmtMoney(v, goal.currency, { noDecimals: true }),
            status: fc.onTrack ? 'good' : 'warning',
            sublabel: fc.projectedMonth ? `Erreicht voraussichtlich ${monthLabel(fc.projectedMonth)}` : 'Ohne Einzahlungen nicht erreichbar',
          }));
        }
        return widgetCard(w.title || 'Sparziele', box,
          { action: h('button', { class: 'btn ghost sm', onClick: () => navigate('ziele') }, 'Details') });
      }
      case 'recent': {
        const limit = w.config?.limit || 12;
        const rows = sortBy(store.idx.transactions, (t) => t.date, -1).slice(0, limit);
        const list = h('div', {});
        for (const t of rows) {
          const acc = store.account(t.accountId);
          list.append(h('div', { class: 'list-row' },
            h('div', { class: 'grow truncate' },
              h('div', { class: 'txn-payee truncate' }, t.payee || t.description || '—'),
              h('div', { class: 'txn-sub truncate' }, `${fmtDate(t.date)} · ${acc?.name || 'Konto?'} · `, categoryChip(t.categoryId))),
            h('span', { class: `mono ${t.amount > 0 ? 'pos' : ''}` }, fmtMoney(t.amount, t.currency))));
        }
        return widgetCard(w.title || 'Letzte Buchungen', list,
          { action: h('button', { class: 'btn ghost sm', onClick: () => navigate('buchungen') }, 'Alle') });
      }
      case 'upcoming': {
        const ov = seriesOverview();
        if (!ov.due30.length) {
          return widgetCard(w.title || 'Wiederkehrende Zahlungen',
            h('p', { class: 'muted small' },
              ov.count ? 'In den nächsten 30 Tagen ist nichts fällig.' : 'Noch keine Serien bestätigt.'),
            { action: h('button', { class: 'btn ghost sm', onClick: () => navigate('budget', { tab: 'serien' }) }, 'Serien') });
        }
        const list = h('div', {});
        for (const { series, status } of ov.due30.slice(0, 8)) {
          list.append(h('div', { class: 'list-row' },
            h('div', { class: 'grow truncate' },
              h('div', { class: 'title truncate' }, series.name),
              h('div', { class: 'txn-sub' },
                `${fmtDate(series.nextDate)} · ${cadenceInfo(series.cadence).label}`
                + (status.overdue ? ' · überfällig' : ''))),
            h('span', { class: `mono ${series.amount > 0 ? 'pos' : ''}` }, fmtMoney(series.amount, series.currency, { noDecimals: true }))));
        }
        return widgetCard(w.title || 'Wiederkehrende Zahlungen', list,
          { action: h('button', { class: 'btn ghost sm', onClick: () => navigate('budget', { tab: 'prognose' }) }, 'Prognose') });
      }
      case 'owners': {
        const r = runReport({ metric: 'ausgaben', groupBy: 'owner', period: { type: 'month', month } });
        return widgetCard(w.title || 'Ausgaben pro Person',
          r.rows.length ? chart({ type: 'donut', height: 190, rows: r.rows, currency: cur, centerValue: fmtMoney(r.total, cur, { compact: true }), centerLabel: 'Total' })
            : h('p', { class: 'muted small' }, 'Keine Daten.'));
      }
      case 'depot': {
        const pf = portfolio();
        if (!pf.positions) return widgetCard(w.title || 'Wertschriftendepot',
          h('p', { class: 'muted small' }, 'Noch keine Positionen erfasst.'),
          { action: h('button', { class: 'btn ghost sm', onClick: () => navigate('anlagen') }, 'Anlagen') });
        const box = h('div', {});
        box.append(h('div', { class: 'stat-row', style: { marginBottom: '10px' } },
          statTile({ label: 'Wert', value: fmtMoney(pf.totalBase, cur, { noDecimals: true }), hero: true }),
          statTile({
            label: 'Gewinn', value: fmtMoney(pf.gainBase, cur, { noDecimals: true }),
            tone: pf.gainBase < 0 ? 'neg' : 'pos', sub: fmtPercent(pf.gainPct, 1),
          })));
        box.append(chart({
          type: 'donut', height: 170, currency: cur, rows: allocation(pf.rows, 'assetClass'),
          centerValue: String(pf.positions), centerLabel: 'Positionen',
        }));
        return widgetCard(w.title || 'Wertschriftendepot', box,
          { action: h('button', { class: 'btn ghost sm', onClick: () => navigate('anlagen') }, 'Details') });
      }
      case 'report': {
        const rep = store.idx.reports.find((x) => x.id === w.config?.reportId);
        if (!rep) return widgetCard(w.title || 'Bericht', h('p', { class: 'muted small' }, 'Bericht nicht gefunden.'));
        const r = runReport(rep.config);
        return widgetCard(w.title || rep.name,
          r.rows.length
            ? chart({
              type: rep.config.chart === 'table' ? 'hbar' : rep.config.chart, height: 210, currency: cur,
              rows: r.rows, labels: r.rows.map((x) => x.label),
              series: [{ label: rep.name, color: 'var(--series-1)', values: r.rows.map((x) => x.value) }],
            })
            : h('p', { class: 'muted small' }, 'Keine Daten im Zeitraum.'),
          { action: h('button', { class: 'btn ghost sm', onClick: () => navigate('berichte', { id: rep.id }) }, 'Öffnen') });
      }
      default:
        return null;
    }
  } catch (e) {
    console.error('Widget-Fehler', w.type, e);
    return widgetCard(w.title || w.type, h('p', { class: 'small muted' }, `Fehler: ${e.message}`));
  }
}

/* ---------------- Anpassen ---------------- */

function openCustomizer(navigate) {
  const body = h('div', {});
  const list = h('div', {});

  function refresh() {
    list.replaceChildren();
    const widgets = sortBy(store.idx.widgets, (w) => w.sort ?? 0);
    widgets.forEach((w, i) => {
      const type = WIDGET_TYPES.find((t) => t.id === w.type);
      list.append(h('div', { class: 'list-row' },
        h('div', { class: 'grow' },
          h('div', { class: 'title' }, w.title || type?.label || w.type),
          h('div', { class: 'txn-sub' }, type?.label || w.type)),
        segmented([{ value: 'normal', label: 'Schmal' }, { value: 'wide', label: 'Breit' }, { value: 'full', label: 'Voll' }],
          w.size || 'normal', (v) => { store.patch('widgets', w.id, { size: v }, 'Widget-Grösse'); refresh(); }),
        h('button', { class: 'btn ghost sm', disabled: i === 0, onClick: () => move(w, -1, widgets) }, '↑'),
        h('button', { class: 'btn ghost sm', disabled: i === widgets.length - 1, onClick: () => move(w, 1, widgets) }, '↓'),
        h('button', { class: 'btn ghost sm danger', onClick: () => { store.hardRemove('widgets', w.id, 'Widget entfernt'); refresh(); } }, '✕')));
    });
  }

  function move(w, dir, widgets) {
    const i = widgets.findIndex((x) => x.id === w.id);
    const j = i + dir;
    if (j < 0 || j >= widgets.length) return;
    const a = widgets[i], b = widgets[j];
    store.upsertMany('widgets', [{ ...a, sort: j }, { ...b, sort: i }], 'Reihenfolge geändert');
    refresh();
  }

  const addSel = h('select', {});
  for (const t of WIDGET_TYPES) addSel.append(h('option', { value: t.id }, t.label));
  const addBtn = h('button', {
    class: 'btn', onClick: () => {
      const type = addSel.value;
      const def = WIDGET_TYPES.find((t) => t.id === type);
      const config = {};
      if (type === 'report') {
        const rep = store.idx.reports[0];
        if (!rep) { toast('Zuerst einen Bericht speichern.', 'error'); return; }
        config.reportId = rep.id;
      }
      store.upsert('widgets', {
        id: uid('w'), type, title: def.label, size: def.size || 'normal',
        sort: store.idx.widgets.length, config, updatedAt: now(),
      }, 'Widget hinzugefügt');
      refresh();
    },
  }, '+ Hinzufügen');

  body.append(h('p', { class: 'small muted' }, 'Reihenfolge, Breite und Auswahl der Kacheln bestimmen, wie deine Übersicht aussieht. Die Einstellung wird mit Lea synchronisiert.'));
  body.append(list);
  body.append(h('div', { class: 'row', style: { marginTop: '14px' } }, addSel, addBtn));
  refresh();
  modal({ title: 'Übersicht anpassen', body, wide: true, actions: [{ label: 'Fertig', variant: 'primary' }] });
}
