// planning.js — Liquiditätsprognose und wiederkehrende Zahlungen
import { store } from '../core/store.js';
import {
  h, fmtMoney, fmtDate, fmtNumber, fmtPercent, todayISO, parseISO, fmtISO,
  round2, sortBy, sum, uid, now, clear, CURRENCIES,
} from '../core/util.js';
import { project, weeklyPoints, upcoming, dailyFlexBurn, liquidAccounts } from '../core/forecast.js';
import {
  detectSeries, newCandidates, adoptCandidate, adoptAll, ignoreCandidate, newSeries,
  seriesOverview, seriesStatus, cadenceInfo, CADENCES, monthlyAmount, monthlyAmountBase, nextOccurrence,
} from '../core/recurring.js';
import { chart, meter } from './charts.js';
import {
  modal, toast, confirmDialog, emptyState, statTile, segmented,
  categorySelect, accountSelect, memberSelect,
} from './components.js';

const DAY = 86400000;
const addDays = (iso, n) => fmtISO(new Date(parseISO(iso).getTime() + n * DAY));

const ui = {
  days: 90,
  buffer: 2000,
  includeFlex: true,
  scenario: [],          // bewusst nur für diese Sitzung, nichts wird gespeichert
  showIgnored: false,
};

/* ================================================================== */
/* Prognose                                                            */
/* ================================================================== */

export function renderForecast(rerender) {
  const cur = store.baseCurrency;
  const root = h('div', {});

  if (!liquidAccounts().length) {
    return h('div', { class: 'card' }, emptyState('◔', 'Keine Zahlungskonten',
      'Die Prognose rechnet mit Privat-, Spar- und Bargeldkonten. Lege zuerst ein Konto an oder importiere einen Auszug.'));
  }

  const p = project({
    days: ui.days, buffer: ui.buffer, includeFlex: ui.includeFlex, scenario: ui.scenario,
  });
  // Der Tagesverbrauch wird unabhängig vom Schalter angezeigt, sonst stünde dort 0
  const burn = dailyFlexBurn();

  /* Steuerung */
  root.append(h('div', { class: 'card' },
    h('div', { class: 'row' },
      segmented([
        { value: 30, label: '30 Tage' }, { value: 90, label: '90 Tage' },
        { value: 180, label: '6 Monate' }, { value: 365, label: '1 Jahr' },
      ], ui.days, (v) => { ui.days = v; rerender(); }),
      h('label', { class: 'field', style: { maxWidth: '150px' } },
        h('span', {}, 'Mindestpolster'),
        h('input', {
          type: 'number', step: '100', value: ui.buffer,
          onChange: (e) => { ui.buffer = Number(e.target.value) || 0; rerender(); },
        })),
      h('button', {
        class: 'chip' + (ui.includeFlex ? ' active' : ''),
        onClick: () => { ui.includeFlex = !ui.includeFlex; rerender(); },
      }, `Alltagsausgaben einrechnen (${fmtMoney(burn.perDay, cur, { noDecimals: true })}/Tag)`),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn', onClick: () => openScenario(rerender) }, '± Was wäre wenn'))));

  if (!p.hasSeries) {
    root.append(h('div', { class: 'card' }, emptyState('🔁', 'Noch keine Serien bestätigt',
      'Die Prognose lebt von wiederkehrenden Zahlungen. Im Reiter „Wiederkehrend“ erkennt die App sie aus deinen Buchungen – ein Klick genügt.',
      { label: 'Serien prüfen', onClick: () => { location.hash = 'budget?tab=serien'; } })));
  }

  /* Kennzahlen */
  const tone = p.shortfall ? 'neg' : '';
  root.append(h('section', { class: 'card' },
    h('div', { class: 'stat-row' },
      statTile({ label: 'Heute verfügbar', value: fmtMoney(p.startBalance, cur, { noDecimals: true }), hero: true,
        sub: `${p.accounts.length} Konten` }),
      statTile({ label: `In ${ui.days} Tagen`, value: fmtMoney(p.endBalance, cur, { noDecimals: true }),
        tone: p.change < 0 ? 'neg' : 'pos',
        sub: `${p.change >= 0 ? '+' : ''}${fmtMoney(p.change, cur, { noDecimals: true })}` }),
      statTile({ label: 'Tiefster Stand', value: fmtMoney(p.min.balance, cur, { noDecimals: true }), tone,
        sub: fmtDate(p.min.date) }),
      statTile({ label: 'Erwartete Eingänge', value: fmtMoney(p.incoming, cur, { noDecimals: true }) }),
      statTile({ label: 'Erwartete Ausgänge', value: fmtMoney(p.outgoing, cur, { noDecimals: true }) }))));

  if (p.shortfall) {
    root.append(h('section', { class: 'card', style: { borderLeft: '3px solid var(--critical)' } },
      h('div', { style: { fontWeight: '600' } },
        `Polster von ${fmtMoney(ui.buffer, cur, { noDecimals: true })} wird am ${fmtDate(p.shortfall.date)} unterschritten`),
      h('div', { class: 'small muted' },
        `Stand dann ${fmtMoney(p.shortfall.balance, cur)}. Grösster Posten davor: `
        + (largestBefore(p) || 'keine grossen Einzelposten'))));
  }

  /* Verlauf */
  const points = weeklyPoints(p);
  root.append(h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, 'Verlauf der Kontostände')),
    chart({
      type: 'line', height: 260, area: true, currency: cur,
      labels: points.map((x) => fmtDate(x.date).slice(0, 6)),
      series: [
        { label: 'Prognose', color: 'var(--series-1)', values: points.map((x) => x.balance) },
        { label: 'Mindestpolster', color: 'var(--series-8)', values: points.map(() => ui.buffer), area: false, dashed: true },
      ],
    }),
    h('p', { class: 'small muted' },
      ui.includeFlex
        ? `Enthält ${fmtMoney(p.flexPerDay, cur)} pro Tag für Alltagsausgaben – der Durchschnitt der letzten drei Monate, ohne die geführten Serien.`
        : 'Alltagsausgaben sind ausgeblendet: gezeigt werden nur die wiederkehrenden Posten.')));

  /* Anstehende Posten */
  const list = upcoming(p, 20);
  const card = h('section', { class: 'card' });
  card.append(h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, 'Anstehende Posten')));
  if (!list.length) {
    card.append(h('p', { class: 'small muted' }, 'Im gewählten Zeitraum sind keine Serien fällig.'));
  } else {
    const table = h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Datum'), h('th', {}, 'Posten'),
        h('th', { class: 'num' }, 'Betrag'), h('th', { class: 'num' }, 'Stand am Tagesende'))));
    const tb = h('tbody', {});
    const balanceAt = new Map(p.series.map((x) => [x.date, x.balance]));
    for (const e of list) {
      tb.append(h('tr', {},
        h('td', { class: 'mono nowrap' }, fmtDate(e.date),
          e.overdue ? h('span', { class: 'badge crit', style: { marginLeft: '6px' } }, 'überfällig') : null),
        h('td', {}, e.label,
          e.kind === 'szenario' ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, 'Szenario') : null),
        h('td', { class: `num mono ${e.amount > 0 ? 'pos' : ''}` }, fmtMoney(e.amount, cur)),
        h('td', { class: 'num mono muted' }, fmtMoney(balanceAt.get(e.date) ?? 0, cur, { noDecimals: true }))));
    }
    table.append(tb);
    card.append(h('div', { class: 'table-wrap' }, table));
  }
  root.append(card);

  if (ui.scenario.length) {
    const sc = h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, 'Angenommene Posten'),
        h('button', { class: 'btn ghost sm', onClick: () => { ui.scenario = []; rerender(); } }, 'Alle entfernen')));
    for (const [i, item] of ui.scenario.entries()) {
      sc.append(h('div', { class: 'list-row' },
        h('span', { class: 'mono' }, fmtDate(item.date)),
        h('span', { class: 'grow' }, item.note),
        h('span', { class: `mono ${item.amount > 0 ? 'pos' : ''}` }, fmtMoney(item.amount, cur)),
        h('button', { class: 'btn ghost sm', onClick: () => { ui.scenario.splice(i, 1); rerender(); } }, '✕')));
    }
    sc.append(h('p', { class: 'small muted' }, 'Angenommene Posten gelten nur für diese Sitzung und werden nicht gespeichert.'));
    root.append(sc);
  }

  return root;
}

function largestBefore(p) {
  const before = p.events.filter((e) => e.date <= p.shortfall.date && e.amount < 0);
  if (!before.length) return null;
  const biggest = sortBy(before, (e) => e.amount)[0];
  return `${biggest.label} ${fmtMoney(biggest.amount, store.baseCurrency)} am ${fmtDate(biggest.date)}`;
}

function openScenario(rerender) {
  const dateI = h('input', { type: 'date', value: addDays(todayISO(), 14) });
  const amountI = h('input', { type: 'number', step: '100', value: -1000 });
  const noteI = h('input', { type: 'text', placeholder: 'z. B. Ferien anzahlen, Bonus, neue Waschmaschine' });
  modal({
    title: 'Was wäre wenn',
    body: h('div', {},
      h('p', { class: 'small muted' },
        'Einen einmaligen Posten annehmen und sehen, was er mit der Liquidität macht. '
        + 'Negativer Betrag für Ausgaben, positiver für Eingänge.'),
      h('div', { class: 'form-grid' },
        h('label', { class: 'field' }, h('span', {}, 'Datum'), dateI),
        h('label', { class: 'field' }, h('span', {}, 'Betrag'), amountI),
        h('label', { class: 'field', style: { gridColumn: '1 / -1' } }, h('span', {}, 'Bezeichnung'), noteI))),
    actions: [
      { label: 'Abbrechen' },
      {
        label: 'Einrechnen', variant: 'primary',
        onClick: () => {
          ui.scenario.push({
            date: dateI.value, amount: Number(amountI.value),
            note: noteI.value || 'Einmaliger Posten',
          });
          rerender();
        },
      },
    ],
  });
}

/* ================================================================== */
/* Wiederkehrend                                                       */
/* ================================================================== */

export function renderRecurring(rerender) {
  const cur = store.baseCurrency;
  const root = h('div', {});
  const ov = seriesOverview();
  const candidates = newCandidates();

  root.append(h('section', { class: 'card' },
    h('div', { class: 'row' },
      h('div', { class: 'grow stat-row' },
        statTile({ label: 'Fixe Last pro Monat', value: fmtMoney(ov.monthlyExpense, cur, { noDecimals: true }), hero: true,
          sub: `${ov.count} Serien` }),
        statTile({ label: 'Wiederkehrende Einkünfte', value: fmtMoney(ov.monthlyIncome, cur, { noDecimals: true }) }),
        statTile({ label: 'Fällig in 30 Tagen', value: fmtMoney(ov.due30Total, cur, { noDecimals: true }),
          sub: `${ov.due30.length} Posten` }),
        ov.overdue.length
          ? statTile({ label: 'Überfällig', value: String(ov.overdue.length), tone: 'neg' })
          : statTile({ label: 'Diesen Zyklus bezahlt', value: String(ov.paidThisPeriod) })),
      h('button', { class: 'btn primary', onClick: () => openSeriesEditor(null, rerender) }, '+ Serie'))));

  /* Vorschläge */
  if (candidates.length) {
    const card = h('section', { class: 'card', style: { borderLeft: '3px solid var(--series-4)' } });
    card.append(h('div', { class: 'card-head' },
      h('h3', { class: 'grow' }, `${candidates.length} erkannte Serien`),
      h('button', {
        class: 'btn sm primary', onClick: () => {
          const n = adoptAll(candidates);
          toast(`${n} Serien übernommen`, 'success');
          rerender();
        },
      }, 'Alle übernehmen')));
    card.append(h('p', { class: 'small muted' },
      'Aus deinen Buchungen abgeleitet. Übernommene Serien erscheinen in der Prognose und zeigen, was wann fällig ist.'));

    const table = h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Posten'), h('th', {}, 'Rhythmus'),
        h('th', { class: 'num' }, 'Betrag'), h('th', { class: 'num' }, 'pro Monat'),
        h('th', {}, 'Nächste'), h('th', { class: 'num' }, 'Sicherheit'), h('th', {}, ''))));
    const tb = h('tbody', {});
    for (const c of candidates.slice(0, 20)) {
      tb.append(h('tr', {},
        h('td', {},
          h('div', { class: 'txn-payee truncate', style: { maxWidth: '260px' } }, c.name),
          h('div', { class: 'txn-sub' }, `${c.occurrences}× seit ${fmtDate(c.firstDate)}`)),
        h('td', { class: 'small' }, cadenceInfo(c.cadence).label),
        h('td', { class: `num mono ${c.amount > 0 ? 'pos' : ''}` }, fmtMoney(c.amount, c.currency)),
        h('td', { class: 'num mono muted' }, fmtMoney(monthlyAmountBase(c), cur, { noDecimals: true })),
        h('td', { class: 'mono small' }, fmtDate(c.nextDate)),
        h('td', { class: 'num' }, h('span', { class: `badge ${c.confidence > 0.8 ? 'good' : ''}` }, fmtPercent(c.confidence, 0))),
        h('td', {}, h('div', { class: 'row tight' },
          h('button', {
            class: 'btn sm', onClick: () => { adoptCandidate(c); toast(`„${c.name}“ übernommen`, 'success'); rerender(); },
          }, 'Übernehmen'),
          h('button', {
            class: 'btn ghost sm', onClick: () => { ignoreCandidate(c); rerender(); },
          }, 'Ignorieren')))));
    }
    table.append(tb);
    card.append(h('div', { class: 'table-wrap' }, table));
    root.append(card);
  }

  /* Geführte Serien */
  const card = h('section', { class: 'card' });
  card.append(h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, 'Geführte Serien')));
  if (!ov.rows.length) {
    card.append(emptyState('🔁', 'Noch keine Serien',
      candidates.length
        ? 'Oben stehen erkannte Vorschläge – übernimm sie mit einem Klick.'
        : 'Importiere zuerst ein paar Monate Kontoauszüge, dann erkennt die App Miete, Krankenkasse, Abos und Lohn von selbst.'));
  } else {
    const table = h('table', { class: 'data' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Posten'), h('th', {}, 'Kategorie'), h('th', {}, 'Rhythmus'),
        h('th', { class: 'num' }, 'Betrag'), h('th', { class: 'num' }, 'pro Monat'),
        h('th', {}, 'Nächste Fälligkeit'), h('th', {}, 'Status'))));
    const tb = h('tbody', {});
    for (const { series, status } of ov.rows) {
      const badge = status.state === 'bezahlt' ? h('span', { class: 'badge good' }, `bezahlt ${fmtDate(status.paidOn)}`)
        : status.state === 'ueberfaellig' ? h('span', { class: 'badge crit' }, `${Math.abs(status.daysUntil)} Tage überfällig`)
          : status.state === 'faellig' ? h('span', { class: 'badge warn' }, `in ${status.daysUntil} Tagen`)
            : h('span', { class: 'badge' }, `in ${status.daysUntil} Tagen`);
      const tr = h('tr', { style: { cursor: 'pointer' } },
        h('td', {},
          h('div', { class: 'txn-payee truncate', style: { maxWidth: '240px' } }, series.name),
          series.variable ? h('div', { class: 'txn-sub' }, 'Betrag schwankt') : null),
        h('td', { class: 'small' }, store.category(series.categoryId)?.name || '—'),
        h('td', { class: 'small' }, cadenceInfo(series.cadence).label),
        h('td', { class: `num mono ${series.amount > 0 ? 'pos' : ''}` }, fmtMoney(series.amount, series.currency)),
        h('td', { class: 'num mono muted' }, fmtMoney(monthlyAmountBase(series), cur, { noDecimals: true })),
        h('td', { class: 'mono small' }, fmtDate(series.nextDate)),
        h('td', {}, badge));
      tr.addEventListener('click', () => openSeriesEditor(series, rerender));
      tb.append(tr);
    }
    table.append(tb);
    card.append(h('div', { class: 'table-wrap' }, table));
  }
  root.append(card);

  const ignored = store.idx.recurring.filter((r) => r.ignored);
  if (ignored.length) {
    const det = h('details', { class: 'acc' }, h('summary', {}, `Ignorierte Serien (${ignored.length})`));
    for (const r of ignored) {
      det.append(h('div', { class: 'list-row' },
        h('span', { class: 'grow truncate' }, r.name),
        h('button', {
          class: 'btn ghost sm',
          onClick: () => { store.patch('recurring', r.id, { ignored: false, active: true }, 'Serie reaktiviert'); rerender(); },
        }, 'Wieder aufnehmen')));
    }
    root.append(det);
  }
  return root;
}

function openSeriesEditor(series, rerender) {
  const isNew = !series;
  const s = series ? { ...series } : newSeries({ nextDate: addDays(todayISO(), 7) });
  const field = (label, input, hint) =>
    h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('span', { class: 'small muted' }, hint) : null);

  const nameI = h('input', { type: 'text', value: s.name, onInput: (e) => { s.name = e.target.value; } });
  const payeeI = h('input', { type: 'text', value: s.payee, placeholder: 'Wie in den Buchungen', onInput: (e) => { s.payee = e.target.value; } });
  const dirI = h('select', { onChange: (e) => { s.direction = e.target.value; } },
    h('option', { value: 'ausgabe', selected: s.direction === 'ausgabe' }, 'Ausgabe'),
    h('option', { value: 'einnahme', selected: s.direction === 'einnahme' }, 'Einnahme'));
  const amountI = h('input', {
    type: 'number', step: '0.05', value: s.amount,
    onInput: (e) => { s.amount = Number(e.target.value); },
  });
  const curI = h('select', { onChange: (e) => { s.currency = e.target.value; } },
    CURRENCIES.map((c) => h('option', { value: c, selected: c === s.currency }, c)));
  const cadI = h('select', { onChange: (e) => { s.cadence = e.target.value; } },
    CADENCES.map((c) => h('option', { value: c.id, selected: c.id === s.cadence }, c.label)));
  const nextI = h('input', { type: 'date', value: s.nextDate, onInput: (e) => { s.nextDate = e.target.value; } });
  const catI = categorySelect({ value: s.categoryId, onChange: (v) => { s.categoryId = v; } });
  const accI = accountSelect({ value: s.accountId, includeEmpty: true, emptyLabel: '— egal —', onChange: (v) => { s.accountId = v; } });
  const varI = h('input', { type: 'checkbox', checked: !!s.variable, onChange: (e) => { s.variable = e.target.checked; } });
  const activeI = h('input', { type: 'checkbox', checked: s.active !== false, onChange: (e) => { s.active = e.target.checked; } });

  const status = isNew ? null : seriesStatus(s);

  modal({
    title: isNew ? 'Neue Serie' : s.name, wide: true,
    body: h('div', {},
      status ? h('p', { class: 'small muted' },
        status.paid
          ? `Zuletzt bezahlt am ${fmtDate(status.paidOn)} mit ${fmtMoney(status.paidAmount, s.currency)}.`
          : `Noch nicht bezahlt · fällig ${fmtDate(s.nextDate)}.`) : null,
      h('div', { class: 'form-grid' },
        field('Bezeichnung', nameI),
        field('Erkennungstext', payeeI, 'Damit ordnet die App Zahlungen dieser Serie zu'),
        field('Art', dirI), field('Rhythmus', cadI),
        field('Betrag', amountI, 'Bei Ausgaben negativ'), field('Währung', curI),
        field('Nächste Fälligkeit', nextI), field('Kategorie', catI),
        field('Konto', accI),
        h('label', { class: 'row tight' }, varI, h('span', {}, 'Betrag schwankt')),
        h('label', { class: 'row tight' }, activeI, h('span', {}, 'Aktiv – in der Prognose berücksichtigen')))),
    actions: [
      { label: 'Abbrechen' },
      !isNew ? {
        label: 'Löschen', variant: 'danger',
        onClick: async () => {
          if (!await confirmDialog(`Serie „${s.name}“ löschen?`)) return false;
          store.remove('recurring', s.id, 'Serie gelöscht');
          rerender();
        },
      } : null,
      !isNew ? {
        label: 'Fälligkeit vorrücken',
        onClick: () => {
          store.patch('recurring', s.id, { nextDate: nextOccurrence(s.nextDate, s.cadence) }, 'Fälligkeit vorgerückt');
          rerender();
        },
      } : null,
      {
        label: 'Speichern', variant: 'primary',
        onClick: () => {
          if (s.direction === 'ausgabe' && s.amount > 0) s.amount = -s.amount;
          if (s.direction === 'einnahme' && s.amount < 0) s.amount = Math.abs(s.amount);
          store.upsert('recurring', s, isNew ? 'Serie angelegt' : 'Serie geändert');
          toast('Gespeichert', 'success');
          rerender();
        },
      },
    ].filter(Boolean),
  });
}
