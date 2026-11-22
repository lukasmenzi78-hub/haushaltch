// budget.js — Budget-Ansicht (nullbasiert oder Flex-Topf)
import { store } from '../core/store.js';
import { h, fmtMoney, fmtPercent, monthLabel, currentMonthKey, addMonths, round2, debounce } from '../core/util.js';
import { monthOverview, setBudget, copyBudgets, suggestBudgets, applySuggestions, categoryHistory, budgetAmount, balanceInto } from '../core/budget.js';
import { activeMonth } from '../core/analytics.js';
import { BUDGET_TYPES } from '../core/model.js';
import { chart, meter } from './charts.js';
import { monthPicker, modal, toast, statTile, categorySelect, segmented } from './components.js';
import { renderForecast, renderRecurring } from './planning.js';

const ui = { period: null, hideEmpty: true, ownerId: null, tab: 'budget' };

export function renderBudget({ params, navigate }) {
  if (params?.tab && ['budget', 'prognose', 'serien'].includes(params.tab)) ui.tab = params.tab;
  if (!ui.period) ui.period = activeMonth();
  const root = h('div', {});
  const cur = store.baseCurrency;

  const rerender = () => {
    const parent = root.parentElement;
    if (parent) parent.replaceChild(renderBudget({ params: {}, navigate }), root);
  };

  root.append(h('div', { class: 'card', style: { marginBottom: '14px' } },
    segmented([
      { value: 'budget', label: 'Budget' },
      { value: 'prognose', label: 'Prognose' },
      { value: 'serien', label: 'Wiederkehrend' },
    ], ui.tab, (v) => { ui.tab = v; rerender(); })));

  if (ui.tab === 'prognose') { root.append(renderForecast(rerender)); return root; }
  if (ui.tab === 'serien') { root.append(renderRecurring(rerender)); return root; }

  const o = monthOverview(ui.period, { hideEmpty: ui.hideEmpty, ownerId: ui.ownerId || undefined });

  root.append(h('div', { class: 'card' },
    h('div', { class: 'row' },
      monthPicker(ui.period, (m) => { ui.period = m; rerender(); }),
      h('div', { class: 'grow' }),
      h('button', {
        class: 'chip' + (ui.hideEmpty ? ' active' : ''),
        onClick: () => { ui.hideEmpty = !ui.hideEmpty; rerender(); },
      }, 'Leere ausblenden'),
      h('button', {
        class: 'btn', onClick: () => {
          const from = addMonths(ui.period, -1);
          const n = copyBudgets(from, ui.period);
          toast(n ? `${n} Budgets aus ${monthLabel(from)} übernommen` : 'Im Vormonat sind keine Budgets erfasst', n ? 'success' : 'error');
          rerender();
        },
      }, 'Vormonat übernehmen'),
      h('button', {
        class: 'btn', onClick: () => {
          const entries = suggestBudgets(ui.period, 3);
          if (!entries.length) { toast('Keine Vorschläge – zu wenig Verlauf.', 'error'); return; }
          applySuggestions(entries);
          toast(`${entries.length} Budgets aus dem 3-Monats-Schnitt gesetzt`, 'success');
          rerender();
        },
      }, 'Aus Ø 3 Monate'))));

  root.append(o.method === 'zero' ? zeroCard(o, cur, rerender) : flexCard(o, cur));
  root.append(groupsCard(o, cur, navigate));
  return root;
}

/* ---------------- Nullbasiert ---------------- */

const SPEND_TYPES = ['fix', 'unregelmaessig', 'flex', 'sparen'];
const balanceUi = { categoryId: null };

function zeroCard(o, cur, rerender) {
  const z = o.zeroBased;
  const money = (v) => fmtMoney(v, cur, { noDecimals: true });
  const card = h('section', { class: 'card' });
  card.append(h('div', { class: 'card-head' },
    h('h3', { class: 'grow' }, `Nullbasiertes Budget · ${monthLabel(o.period)}`),
    h('button', { class: 'btn ghost sm', onClick: () => explainZero() }, 'Wie funktioniert das?')));

  const state = z.balanced ? 'pos' : z.toAssign < 0 ? 'neg' : '';
  card.append(h('div', { class: 'stat-row', style: { marginBottom: '14px' } },
    statTile({
      label: 'Einkommen geplant', value: money(z.income),
      sub: `tatsächlich bisher ${money(o.income.actual)}`,
    }),
    statTile({
      label: 'Verteilt', value: money(z.assigned),
      sub: z.income > 0 ? `${fmtPercent(z.assigned / z.income, 0)} des Einkommens` : 'kein Einkommen geplant',
    }),
    statTile({
      label: 'Noch zu verteilen', value: money(z.toAssign), hero: true, tone: state,
      sub: z.balanced ? 'Jeder Franken hat eine Aufgabe' : z.toAssign > 0 ? 'Ziel: 0' : 'Mehr verteilt als geplant eingeht',
    }),
    statTile({
      label: 'Ausgegeben', value: money(z.spent),
      sub: `von ${money(z.assigned)} verteilt`,
    })));

  card.append(meter({
    label: 'Verteilt vom geplanten Einkommen', value: z.assigned, max: z.income,
    status: z.balanced ? 'good' : z.toAssign < 0 ? 'critical' : 'warning',
    sublabel: `Fixkosten ${money(z.byType.fix)} · Rückstellungen ${money(z.byType.unregelmaessig)} · Sparen ${money(z.byType.sparen)} · Flexibel ${money(z.byType.flex)}`,
  }));
  card.append(meter({
    label: 'Flexible Kategorien', value: o.flex.spent, max: o.flex.pool,
    status: o.flex.pool && o.flex.spent > o.flex.pool ? 'critical' : o.flex.onTrack ? 'good' : 'warning',
    sublabel: o.flex.pool
      ? (o.flex.daysLeft > 0
        ? `${money(o.flex.remaining)} übrig · noch ${o.flex.daysLeft} Tage · ${money(o.flex.perDay)} pro Tag`
        : `${money(o.flex.remaining)} übrig · Monat abgeschlossen`)
      : 'Noch keine flexiblen Kategorien budgetiert',
  }));

  if (z.income <= 0) {
    card.append(h('p', { class: 'small', style: { marginTop: '10px' } },
      'Trage zuerst das geplante Einkommen ein (Gruppe Einkommen, z. B. Lohn). Erst dann lässt sich jeder Franken verteilen.'));
    return card;
  }
  if (z.balanced) {
    card.append(h('p', { class: 'small pos', style: { marginTop: '10px' } },
      '✓ Ausgeglichen: Das geplante Einkommen ist vollständig auf Kategorien verteilt.'));
    return card;
  }

  // Ausgleichen über eine Kategorie: Rest zuschlagen oder Überhang abziehen
  const options = store.idx.categories
    .filter((c) => SPEND_TYPES.includes(c.budgetType) && !c.archived && !c.deleted)
    .filter((c) => z.toAssign > 0 || budgetAmount(o.period, c.id) > 0);
  if (!options.some((c) => c.id === balanceUi.categoryId)) {
    balanceUi.categoryId = (options.find((c) => c.id === 'c_sparen') || options[0])?.id || null;
  }
  const sel = h('select', { style: { width: 'auto', minWidth: '220px', maxWidth: '100%' }, onChange: (e) => { balanceUi.categoryId = e.target.value; } },
    options.map((c) => h('option', { value: c.id, selected: c.id === balanceUi.categoryId },
      `${c.icon || ''} ${c.name}${z.toAssign < 0 ? ` (${money(budgetAmount(o.period, c.id))})` : ''}`.trim())));
  card.append(h('div', { class: 'row', style: { marginTop: '12px', alignItems: 'center', flexWrap: 'wrap', gap: '8px' } },
    h('span', { class: `small ${z.toAssign < 0 ? 'neg' : ''}` }, z.toAssign > 0
      ? `${money(z.toAssign)} haben noch keine Aufgabe. Zuweisen an`
      : `${money(-z.toAssign)} zu viel verteilt. Abziehen von`),
    sel,
    h('button', {
      class: 'btn primary sm', disabled: !balanceUi.categoryId,
      onClick: () => {
        const cat = store.category(balanceUi.categoryId);
        const rest = balanceInto(o.period, balanceUi.categoryId, z.toAssign);
        toast(rest === 0
          ? `Ausgeglichen über ${cat?.name}`
          : `${cat?.name} reicht nicht ganz – noch ${money(-rest)} zu viel verteilt`, rest === 0 ? 'success' : 'info');
        rerender();
      },
    }, 'Ausgleichen')));
  card.append(h('p', { class: 'small muted', style: { marginTop: '6px' } },
    'Oder die Beträge unten in den Kategorien direkt anpassen.'));
  return card;
}

function explainZero() {
  modal({
    title: 'So rechnet das nullbasierte Budget',
    body: h('div', { class: 'small' },
      h('p', {}, h('b', {}, 'Noch zu verteilen = geplantes Einkommen − alle Kategorienbudgets.'),
        ' Ziel ist genau 0: Jeder Franken, der im Monat eingehen soll, bekommt vorab eine Aufgabe – Ausgabe, Rückstellung oder Sparen.'),
      h('p', {}, 'Gezählt werden alle Kategorien mit den Typen Fixkosten, Unregelmässig, Flexibel sowie Sparen & Vorsorge. Einkommen und Überträge zählen nicht.'),
      h('ul', {},
        BUDGET_TYPES.filter((b) => SPEND_TYPES.includes(b.id)).map((b) => h('li', {}, h('b', {}, b.label + ': '), b.hint))),
      h('p', {}, 'Bleibt etwas übrig, weise es zu – am einfachsten mit „Ausgleichen“, z. B. an „Sparen allgemein“. Ist mehr verteilt, als eingeht, ziehe es bei einer Kategorie ab oder plane mehr Einkommen.'),
      h('p', {}, 'Restbudget übertragen (in der Kategorie einstellbar) erhöht das verfügbare Geld der Kategorie im Folgemonat, nicht das zu verteilende Einkommen.'),
      h('p', {}, 'Umstellen auf den Flex-Topf: Einstellungen → Allgemein → Budgetmethode.')),
    actions: [{ label: 'Verstanden', variant: 'primary' }],
  });
}

function flexCard(o, cur) {
  const card = h('section', { class: 'card' });
  card.append(h('div', { class: 'card-head' },
    h('h3', { class: 'grow' }, `Flex-Budget · ${monthLabel(o.period)}`),
    h('button', { class: 'btn ghost sm', onClick: () => explainFlex() }, 'Wie funktioniert das?')));

  card.append(h('div', { class: 'stat-row', style: { marginBottom: '14px' } },
    statTile({ label: 'Einkommen', value: fmtMoney(o.income.basis, cur, { noDecimals: true }), sub: o.income.planned ? 'geplant' : 'tatsächlich bisher' }),
    statTile({ label: 'Fixkosten', value: fmtMoney(o.fixed.planned || o.fixed.actual, cur, { noDecimals: true }) }),
    statTile({ label: 'Rückstellungen', value: fmtMoney(o.reserves.planned, cur, { noDecimals: true }), sub: 'unregelmässige Kosten' }),
    statTile({ label: 'Sparen', value: fmtMoney(o.savings.planned || o.savings.actual, cur, { noDecimals: true }) }),
    statTile({
      label: 'Flexibler Topf', value: fmtMoney(o.flex.pool, cur, { noDecimals: true }), hero: true,
      sub: `${fmtMoney(o.flex.remaining, cur, { noDecimals: true })} übrig`,
    })));

  card.append(meter({
    label: `Flexibel ausgegeben (${fmtPercent(o.flex.pool ? o.flex.spent / o.flex.pool : 0, 0)})`,
    value: o.flex.spent, max: o.flex.pool,
    status: o.flex.pool && o.flex.spent > o.flex.pool ? 'critical' : o.flex.onTrack ? 'good' : 'warning',
    sublabel: o.flex.daysLeft > 0
      ? `Noch ${o.flex.daysLeft} Tage · ${fmtMoney(o.flex.perDay, cur, { noDecimals: true })} pro Tag · erwartet bis heute ${fmtMoney(o.flex.expectedByNow, cur, { noDecimals: true })}`
      : 'Monat abgeschlossen',
  }));

  const left = o.summary.leftToBudget;
  card.append(h('div', { class: 'row small', style: { marginTop: '10px' } },
    h('span', { class: left < 0 ? 'neg' : 'muted' },
      left >= 0
        ? `${fmtMoney(left, cur)} des Einkommens sind noch keinem Topf zugewiesen.`
        : `Die Planung übersteigt das Einkommen um ${fmtMoney(-left, cur)}.`)));
  return card;
}

function groupsCard(o, cur, navigate) {
  const card = h('section', { class: 'card' });
  card.append(h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, 'Kategorien')));

  for (const g of o.groups) {
    const det = h('details', { class: 'acc', open: true });
    det.append(h('summary', {},
      h('span', {}, `${g.group.icon || ''} ${g.group.name}`),
      h('span', { style: { float: 'right' }, class: 'mono small' },
        `${fmtMoney(g.actual, cur, { noDecimals: true })} / ${fmtMoney(g.budget, cur, { noDecimals: true })}`)));

    const table = h('table', { class: 'data' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Kategorie'), h('th', {}, 'Typ'),
        h('th', { class: 'num' }, 'Budget'), h('th', { class: 'num' }, 'Übertrag'),
        h('th', { class: 'num' }, 'Ausgegeben'), h('th', { class: 'num' }, 'Verfügbar'), h('th', {}, ''))));
    const tbody = h('tbody', {});

    for (const r of g.rows) {
      const input = h('input', {
        type: 'number', step: '5', value: r.budget || '', placeholder: '0',
        style: { maxWidth: '110px', textAlign: 'right' },
        onChange: (e) => {
          setBudget(o.period, r.category.id, Number(e.target.value) || 0);
          toast(`Budget für ${r.category.name} gespeichert`);
        },
      });
      const bar = h('div', { class: 'meter-track', style: { width: '90px' } },
        h('div', {
          class: 'meter-fill',
          style: {
            width: `${Math.min(100, Math.max(0, r.progress * 100))}%`,
            background: r.available < 0 ? 'var(--critical)' : (r.category.color || g.group.color || 'var(--series-1)'),
          },
        }));
      tbody.append(h('tr', {},
        h('td', {}, h('span', { style: { cursor: 'pointer' }, onClick: () => openCategoryDetail(r.category, o.period, navigate) },
          `${r.category.icon || ''} ${r.category.name}`)),
        h('td', { class: 'small muted' }, BUDGET_TYPES.find((b) => b.id === r.category.budgetType)?.label || ''),
        h('td', { class: 'num' }, input),
        h('td', { class: 'num small muted' }, r.carry ? fmtMoney(r.carry, cur, { noDecimals: true }) : '–'),
        h('td', { class: 'num mono' }, fmtMoney(r.actual, cur, { noDecimals: true })),
        h('td', { class: `num mono ${r.available < 0 ? 'neg' : ''}` }, fmtMoney(r.available, cur, { noDecimals: true })),
        h('td', {}, bar)));
    }
    table.append(tbody);
    det.append(h('div', { class: 'table-wrap' }, table));
    card.append(det);
  }
  return card;
}

/* ---------------- Kategorie-Detail ---------------- */

function openCategoryDetail(cat, period, navigate) {
  const cur = store.baseCurrency;
  const hist = categoryHistory(cat.id, 12, period);
  const body = h('div', {});

  body.append(chart({
    type: 'bar', height: 200, currency: cur,
    rows: hist.map((x) => ({ label: monthLabel(x.month, true), value: x.actual, color: cat.color || store.group(cat.groupId)?.color || 'var(--series-1)' })),
  }));

  const typeI = h('select', { onChange: (e) => store.patch('categories', cat.id, { budgetType: e.target.value }, 'Budgettyp geändert') },
    BUDGET_TYPES.map((b) => h('option', { value: b.id, selected: b.id === cat.budgetType }, b.label)));
  const rollI = h('input', {
    type: 'checkbox', checked: !!cat.rollover,
    onChange: (e) => store.patch('categories', cat.id, { rollover: e.target.checked }, 'Übertrag geändert'),
  });
  const annualI = h('input', {
    type: 'number', step: '10', value: cat.annualAmount ?? '', placeholder: 'z. B. 3600',
    onChange: (e) => store.patch('categories', cat.id, { annualAmount: e.target.value ? Number(e.target.value) : null }, 'Jahresbetrag geändert'),
  });

  body.append(h('div', { class: 'form-grid', style: { marginTop: '16px' } },
    h('label', { class: 'field' }, h('span', {}, 'Budgettyp'), typeI,
      h('span', { class: 'small muted' }, BUDGET_TYPES.find((b) => b.id === cat.budgetType)?.hint || '')),
    h('label', { class: 'field' }, h('span', {}, 'Jahresbetrag (für Rückstellungen)'), annualI,
      h('span', { class: 'small muted' }, 'Wird durch 12 geteilt und monatlich zurückgestellt.')),
    h('label', { class: 'row tight', style: { gridColumn: '1 / -1' } }, rollI,
      h('span', {}, 'Nicht genutztes Budget in den Folgemonat übertragen'))));

  const avg = hist.reduce((a, x) => a + x.actual, 0) / (hist.length || 1);
  body.append(h('p', { class: 'small muted', style: { marginTop: '10px' } },
    `Durchschnitt der letzten 12 Monate: ${fmtMoney(avg, cur)} · Budget aktuell ${fmtMoney(budgetAmount(period, cat.id), cur)}`));

  modal({
    title: `${cat.icon || ''} ${cat.name}`, body, wide: true,
    actions: [
      { label: 'Buchungen anzeigen', onClick: () => navigate('buchungen', { category: cat.id }) },
      { label: 'Schliessen', variant: 'primary' },
    ],
  });
}

function explainFlex() {
  modal({
    title: 'So rechnet das Flex-Budget',
    body: h('div', { class: 'small' },
      h('p', {}, 'Jede Kategorie hat einen Typ. Daraus ergibt sich der flexible Topf für den Alltag:'),
      h('ul', {},
        BUDGET_TYPES.map((b) => h('li', {}, h('b', {}, b.label + ': '), b.hint))),
      h('p', {}, h('b', {}, 'Flexibler Topf = Einkommen − Fixkosten − Rückstellungen − Sparen.')),
      h('p', {}, 'Unregelmässige Kosten wie Steuern, Ferien oder die Autoversicherung werden über den Jahresbetrag monatlich zurückgestellt – so überrascht dich die Rechnung im November nicht mehr.'),
      h('p', {}, 'Der Balken vergleicht deine bisherigen flexiblen Ausgaben mit dem Betrag, der bis heute im Monat üblich wäre. Grün heisst: im Plan.')),
    actions: [{ label: 'Verstanden', variant: 'primary' }],
  });
}
