// goals.js — Sparziele inkl. Prognose
import { store } from './store.js';
import { accountBalance } from './analytics.js';
import { toBase, convert } from './fx.js';
import { round2, addMonths, currentMonthKey, monthKey, sum, monthLabel, todayISO } from './util.js';

/**
 * Welche Quelle den Stand eines Ziels bestimmt.
 * Konten und Kategorien dürfen nie addiert werden – die Einzahlung steht sonst
 * zweimal drin: einmal als Kontosaldo, einmal als Buchung in der Kategorie.
 */
export function trackingMode(goal) {
  if (goal.accountIds?.length) return 'konten';
  if (goal.categoryIds?.length) return 'kategorien';
  return 'manuell';
}

export function trackingLabel(goal) {
  return { konten: 'Stand aus den verknüpften Konten',
    kategorien: 'Stand aus den Buchungen der verknüpften Kategorien',
    manuell: 'Stand aus Startbetrag und erfassten Einzahlungen' }[trackingMode(goal)];
}

/** Aktueller Stand eines Ziels in Zielwährung. */
export function currentAmount(goal) {
  let total = Number(goal.startAmount || 0);
  const mode = trackingMode(goal);

  if (mode === 'konten') {
    for (const accId of goal.accountIds || []) {
      const acc = store.account(accId);
      if (!acc) continue;
      total += convert(accountBalance(acc), acc.currency, goal.currency);
    }
  } else if (mode === 'kategorien') {
    for (const t of store.idx.transactions) {
      if (t.deleted || t.hidden || !goal.categoryIds.includes(t.categoryId)) continue;
      // Vorzeichen beibehalten: ein Bezug aus dem Sparziel verringert den Stand
      total += convert(-t.amount, t.currency, goal.currency, t.date);
    }
  }

  for (const c of goal.manualContributions || []) {
    total += Number(c.amount || 0);
  }
  return round2(total);
}

/** Durchschnittliche monatliche Einzahlung der letzten n Monate. */
export function observedMonthly(goal, months = 6) {
  // -(months - 1), damit genau `months` Monate im Fenster liegen und nicht einer mehr
  const since = `${addMonths(currentMonthKey(), -(months - 1))}-01`;
  let total = 0;
  for (const c of goal.manualContributions || []) if (c.date >= since) total += Number(c.amount || 0);
  if (trackingMode(goal) === 'kategorien') {
    for (const t of store.idx.transactions) {
      if (t.deleted || t.hidden || t.date < since || !goal.categoryIds.includes(t.categoryId)) continue;
      total += convert(-t.amount, t.currency, goal.currency, t.date);
    }
  }
  return round2(total / months);
}

/**
 * Prognose: monatliche Fortschreibung mit Einzahlung und optionaler Rendite.
 * Gibt Zeitreihe, voraussichtliches Zieldatum und die nötige Monatsrate zurück.
 */
export function forecast(goal, opts = {}) {
  const start = currentAmount(goal);
  const target = Number(goal.targetAmount || 0);
  const monthly = opts.monthly !== undefined
    ? Number(opts.monthly)
    : (Number(goal.monthlyContribution) || observedMonthly(goal));
  const rMonthly = (Number(goal.expectedReturnPct || 0) / 100) / 12;
  const maxMonths = opts.maxMonths || 600;

  const series = [];
  let balance = start;
  let reachedIndex = null;
  const startMonth = currentMonthKey();

  for (let i = 0; i <= maxMonths; i++) {
    const m = addMonths(startMonth, i);
    series.push({ month: m, value: round2(balance) });
    if (reachedIndex === null && balance >= target && target > 0) reachedIndex = i;
    if (reachedIndex !== null && i > reachedIndex + 2) break;
    balance = balance * (1 + rMonthly) + monthly;
    if (monthly <= 0 && rMonthly <= 0) break;
    if (i > 480) break;
  }

  const projectedMonth = reachedIndex !== null ? addMonths(startMonth, reachedIndex) : null;
  const remaining = round2(Math.max(0, target - start));

  // Nötige Monatsrate, um das Zieldatum zu halten
  let requiredMonthly = null;
  let monthsToTarget = null;
  if (goal.targetDate) {
    const targetMonth = monthKey(goal.targetDate);
    monthsToTarget = monthsBetween(startMonth, targetMonth);
    if (monthsToTarget > 0) {
      if (rMonthly > 0) {
        const growth = Math.pow(1 + rMonthly, monthsToTarget);
        requiredMonthly = round2((target - start * growth) / ((growth - 1) / rMonthly));
      } else {
        requiredMonthly = round2(remaining / monthsToTarget);
      }
      requiredMonthly = Math.max(0, requiredMonthly);
    } else {
      requiredMonthly = remaining;
    }
  }

  const onTrack = goal.targetDate
    ? (projectedMonth !== null && projectedMonth <= monthKey(goal.targetDate))
    : projectedMonth !== null;

  return {
    start, target, monthly, remaining, series,
    projectedMonth,
    projectedLabel: projectedMonth ? monthLabel(projectedMonth) : (monthly > 0 ? 'über 40 Jahre' : 'keine Einzahlungen geplant'),
    monthsNeeded: reachedIndex,
    requiredMonthly, monthsToTarget, onTrack,
    progress: target > 0 ? Math.min(1, start / target) : 0,
    shortfallPerMonth: requiredMonthly !== null ? round2(Math.max(0, requiredMonthly - monthly)) : null,
  };
}

function monthsBetween(a, b) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

export function addContribution(goalId, amount, date = todayISO(), note = '') {
  const goal = store.idx.goals.find((g) => g.id === goalId);
  if (!goal) return null;
  const contributions = [...(goal.manualContributions || []),
    { id: `gc_${Date.now().toString(36)}`, date, amount: Number(amount), note }];
  store.patch('goals', goalId, { manualContributions: contributions }, 'Einzahlung erfasst');
  return contributions;
}

export function removeContribution(goalId, contribId) {
  const goal = store.idx.goals.find((g) => g.id === goalId);
  if (!goal) return;
  store.patch('goals', goalId, {
    manualContributions: (goal.manualContributions || []).filter((c) => c.id !== contribId),
  }, 'Einzahlung gelöscht');
}

/** Überblick über alle Ziele inkl. Gesamtbedarf pro Monat. */
export function goalsOverview() {
  const goals = store.idx.goals.filter((g) => !g.archived);
  const rows = goals
    .map((g) => ({ goal: g, fc: forecast(g) }))
    .sort((a, b) => (a.goal.priority ?? 5) - (b.goal.priority ?? 5));
  return {
    rows,
    totalTarget: round2(sum(rows, (r) => toBase(r.goal.targetAmount, r.goal.currency))),
    totalSaved: round2(sum(rows, (r) => toBase(r.fc.start, r.goal.currency))),
    monthlyNeed: round2(sum(rows, (r) => toBase(r.fc.requiredMonthly ?? r.fc.monthly ?? 0, r.goal.currency))),
    monthlyPlanned: round2(sum(rows, (r) => toBase(r.fc.monthly || 0, r.goal.currency))),
  };
}

/** Was-wäre-wenn: Zieldatum bei geänderter Monatsrate. */
export function simulate(goal, monthlyOptions = []) {
  return monthlyOptions.map((m) => {
    const fc = forecast(goal, { monthly: m });
    return { monthly: m, projectedMonth: fc.projectedMonth, label: fc.projectedLabel };
  });
}
