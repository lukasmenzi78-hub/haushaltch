// goals.js — Sparziele und Prognose
import { store } from '../core/store.js';
import { h, fmtMoney, fmtDate, monthLabel, todayISO, CURRENCIES, round2, sortBy } from '../core/util.js';
import { newGoal } from '../core/model.js';
import { forecast, goalsOverview, addContribution, removeContribution, currentAmount, simulate, trackingMode, trackingLabel } from '../core/goals.js';
import { chart, meter } from './charts.js';
import { modal, toast, confirmDialog, emptyState, statTile, accountSelect, categorySelect } from './components.js';

export function renderGoals({ navigate }) {
  const root = h('div', {});
  const cur = store.baseCurrency;
  const ov = goalsOverview();

  root.append(h('div', { class: 'card' },
    h('div', { class: 'row' },
      h('div', { class: 'grow stat-row' },
        statTile({ label: 'Zielsumme', value: fmtMoney(ov.totalTarget, cur, { noDecimals: true }) }),
        statTile({ label: 'Bereits erreicht', value: fmtMoney(ov.totalSaved, cur, { noDecimals: true }), hero: true }),
        statTile({ label: 'Monatlich nötig', value: fmtMoney(ov.monthlyNeed, cur, { noDecimals: true }), sub: `geplant ${fmtMoney(ov.monthlyPlanned, cur, { noDecimals: true })}` })),
      h('button', { class: 'btn primary', onClick: () => openGoalEditor(null) }, '+ Sparziel'))));

  if (!ov.rows.length) {
    root.append(h('div', { class: 'card' }, emptyState('◈', 'Noch keine Sparziele',
      'Lege ein Ziel an – zum Beispiel Notgroschen, Ferien, Steuern oder Eigenkapital.',
      { label: 'Erstes Ziel anlegen', onClick: () => openGoalEditor(null) })));
    return root;
  }

  for (const { goal, fc } of ov.rows) root.append(goalCard(goal, fc, navigate));
  return root;
}

function goalCard(goal, fc, navigate) {
  const card = h('section', { class: 'card' });
  card.append(h('div', { class: 'card-head' },
    h('h3', { class: 'grow' }, `${goal.icon || '🎯'} ${goal.name}`),
    h('span', { class: `badge ${fc.onTrack ? 'good' : 'warn'}` }, fc.onTrack ? 'im Plan' : 'hinter dem Plan'),
    h('button', { class: 'btn ghost sm', onClick: () => openContribution(goal) }, '+ Einzahlung'),
    h('button', { class: 'btn ghost sm', onClick: () => openGoalEditor(goal) }, 'Bearbeiten')));

  card.append(h('div', { class: 'stat-row', style: { marginBottom: '10px' } },
    statTile({ label: 'Stand', value: fmtMoney(fc.start, goal.currency, { noDecimals: true }) }),
    statTile({ label: 'Ziel', value: fmtMoney(goal.targetAmount, goal.currency, { noDecimals: true }) }),
    statTile({ label: 'Monatlich', value: fmtMoney(fc.monthly, goal.currency, { noDecimals: true }) }),
    statTile({
      label: 'Voraussichtlich erreicht', value: fc.projectedLabel,
      sub: goal.targetDate ? `Wunschtermin ${fmtDate(goal.targetDate)}` : null,
    }),
    fc.requiredMonthly !== null
      ? statTile({
        label: 'Nötig pro Monat', value: fmtMoney(fc.requiredMonthly, goal.currency, { noDecimals: true }),
        sub: fc.shortfallPerMonth > 0 ? `${fmtMoney(fc.shortfallPerMonth, goal.currency, { noDecimals: true })} mehr als geplant` : 'Rate reicht aus',
      })
      : null));

  card.append(h('div', { class: 'small muted', style: { marginBottom: '6px' } }, trackingLabel(goal)));
  card.append(meter({
    label: 'Fortschritt', value: fc.start, max: goal.targetAmount,
    format: (v) => fmtMoney(v, goal.currency, { noDecimals: true }),
    status: fc.onTrack ? 'good' : 'warning',
  }));

  const view = fc.series.slice(0, Math.min(fc.series.length, (fc.monthsNeeded ?? 60) + 4));
  if (view.length > 2) {
    const target = view.map(() => goal.targetAmount);
    card.append(chart({
      type: 'line', height: 200, area: true, currency: goal.currency,
      labels: view.map((x) => monthLabel(x.month, true)),
      series: [
        { label: 'Prognose', color: 'var(--series-1)', values: view.map((x) => x.value) },
        { label: 'Zielbetrag', color: 'var(--series-4)', values: target, area: false, dashed: true },
      ],
    }));
  }

  const sims = simulate(goal, [fc.monthly * 0.5, fc.monthly, fc.monthly * 1.5, fc.monthly * 2].map((x) => round2(x)).filter((x) => x > 0));
  if (sims.length > 1) {
    const row = h('div', { class: 'pill-row', style: { marginTop: '10px' } });
    for (const s of sims) {
      row.append(h('span', { class: 'chip' }, `${fmtMoney(s.monthly, goal.currency, { noDecimals: true })}/Mt → ${s.label}`));
    }
    card.append(h('div', {}, h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'Was wäre wenn:'), row));
  }

  if (goal.manualContributions?.length) {
    const det = h('details', { class: 'acc', style: { marginTop: '12px' } },
      h('summary', {}, `Erfasste Einzahlungen (${goal.manualContributions.length})`));
    for (const c of sortBy(goal.manualContributions, (c) => c.date, -1)) {
      det.append(h('div', { class: 'list-row' },
        h('span', { class: 'grow mono' }, fmtDate(c.date)),
        h('span', { class: 'small muted grow' }, c.note || ''),
        h('span', { class: 'mono' }, fmtMoney(c.amount, goal.currency)),
        h('button', { class: 'btn ghost sm', onClick: () => removeContribution(goal.id, c.id) }, '✕')));
    }
    card.append(det);
  }
  return card;
}

/* ---------------- Bearbeiten ---------------- */

export function openGoalEditor(goal) {
  const isNew = !goal;
  const g = goal ? { ...goal } : newGoal();
  const field = (label, input, hint, full) =>
    h('label', { class: 'field', style: full ? { gridColumn: '1 / -1' } : {} },
      h('span', {}, label), input, hint ? h('span', { class: 'small muted' }, hint) : null);

  const nameI = h('input', { type: 'text', value: g.name, onInput: (e) => { g.name = e.target.value; } });
  const iconI = h('input', { type: 'text', value: g.icon, maxlength: 3, style: { maxWidth: '80px' }, onInput: (e) => { g.icon = e.target.value; } });
  const targetI = h('input', { type: 'number', step: '100', value: g.targetAmount, onInput: (e) => { g.targetAmount = Number(e.target.value); } });
  const curI = h('select', { onChange: (e) => { g.currency = e.target.value; } },
    CURRENCIES.map((c) => h('option', { value: c, selected: c === g.currency }, c)));
  const dateI = h('input', { type: 'date', value: g.targetDate || '', onInput: (e) => { g.targetDate = e.target.value || null; } });
  const startI = h('input', { type: 'number', step: '100', value: g.startAmount, onInput: (e) => { g.startAmount = Number(e.target.value); } });
  const monthlyI = h('input', { type: 'number', step: '50', value: g.monthlyContribution, onInput: (e) => { g.monthlyContribution = Number(e.target.value); } });
  const returnI = h('input', { type: 'number', step: '0.5', value: g.expectedReturnPct, onInput: (e) => { g.expectedReturnPct = Number(e.target.value); } });
  const prioI = h('input', { type: 'number', min: 1, max: 9, value: g.priority, onInput: (e) => { g.priority = Number(e.target.value); } });

  const accBox = h('div', { class: 'pill-row' });
  for (const a of store.idx.accounts.filter((x) => !x.archived)) {
    const active = (g.accountIds || []).includes(a.id);
    const chip = h('button', {
      class: 'chip' + (active ? ' active' : ''), type: 'button',
      onClick: (e) => {
        const set = new Set(g.accountIds || []);
        set.has(a.id) ? set.delete(a.id) : set.add(a.id);
        g.accountIds = Array.from(set);
        e.currentTarget.classList.toggle('active');
      },
    }, a.name);
    accBox.append(chip);
  }

  const catBox = h('div', { class: 'pill-row' });
  for (const c of store.idx.categories.filter((x) => x.budgetType === 'sparen')) {
    const active = (g.categoryIds || []).includes(c.id);
    catBox.append(h('button', {
      class: 'chip' + (active ? ' active' : ''), type: 'button',
      onClick: (e) => {
        const set = new Set(g.categoryIds || []);
        set.has(c.id) ? set.delete(c.id) : set.add(c.id);
        g.categoryIds = Array.from(set);
        e.currentTarget.classList.toggle('active');
      },
    }, c.name));
  }

  modal({
    title: isNew ? 'Neues Sparziel' : 'Sparziel bearbeiten', wide: true,
    body: h('div', {},
      h('div', { class: 'form-grid' },
        field('Name', nameI), field('Symbol', iconI),
        field('Zielbetrag', targetI), field('Währung', curI),
        field('Wunschtermin', dateI, 'Leer lassen für „so schnell wie möglich“'),
        field('Startbetrag', startI, 'Bereits vorhandenes Guthaben ausserhalb der Konten'),
        field('Monatliche Einzahlung', monthlyI),
        field('Erwartete Rendite p. a. (%)', returnI, 'Für Anlageziele; 0 für Sparkonto'),
        field('Priorität', prioI, '1 = zuerst')),
      h('div', { style: { marginTop: '14px' } },
        h('div', { class: 'small', style: { fontWeight: '550' } }, 'Konten, die auf dieses Ziel einzahlen'),
        h('div', { class: 'small muted' }, 'Der Saldo dieser Konten zählt zum Fortschritt.'),
        accBox),
      h('div', { style: { marginTop: '14px' } },
        h('div', { class: 'small', style: { fontWeight: '550' } }, 'Kategorien, die als Einzahlung gelten'),
        h('div', { class: 'small muted' },
          'Wird nur ausgewertet, solange kein Konto verknüpft ist – sonst stünde dieselbe '
          + 'Einzahlung zweimal im Fortschritt (einmal als Kontosaldo, einmal als Buchung).'),
        catBox)),
    actions: [
      { label: 'Abbrechen' },
      !isNew ? {
        label: 'Löschen', variant: 'danger',
        onClick: async () => {
          if (!await confirmDialog(`Sparziel „${g.name}“ löschen?`)) return false;
          store.remove('goals', g.id, 'Sparziel gelöscht');
        },
      } : null,
      {
        label: 'Speichern', variant: 'primary',
        onClick: () => { store.upsert('goals', g, isNew ? 'Sparziel angelegt' : 'Sparziel geändert'); toast('Gespeichert', 'success'); },
      },
    ].filter(Boolean),
  });
}

function openContribution(goal) {
  const dateI = h('input', { type: 'date', value: todayISO() });
  const amountI = h('input', { type: 'number', step: '50', value: goal.monthlyContribution || 0 });
  const noteI = h('input', { type: 'text', placeholder: 'Notiz (optional)' });
  modal({
    title: `Einzahlung – ${goal.name}`,
    body: h('div', { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', {}, 'Datum'), dateI),
      h('label', { class: 'field' }, h('span', {}, `Betrag (${goal.currency})`), amountI),
      h('label', { class: 'field', style: { gridColumn: '1 / -1' } }, h('span', {}, 'Notiz'), noteI)),
    actions: [
      { label: 'Abbrechen' },
      {
        label: 'Erfassen', variant: 'primary',
        onClick: () => {
          addContribution(goal.id, Number(amountI.value), dateI.value, noteI.value);
          toast('Einzahlung erfasst', 'success');
        },
      },
    ],
  });
}
