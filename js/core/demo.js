// demo.js — Beispieldaten für die Testfassung (klar als Beispiel gekennzeichnet)
import { store } from './store.js';
import { newAccount, newTransaction, newAsset, newGoal, newBudgetEntry, newHolding, newDividend, newSnapshot } from './model.js';
import { round2, addMonths, currentMonthKey, daysInMonth, pad2, uid, sum } from './util.js';

// Deterministischer Zufall, damit die Beispieldaten reproduzierbar sind
function rng(seed = 42) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

const MERCHANTS = {
  lebensmittel: ['Coop Letzipark Zürich', 'Migros Oberengstringen', 'Coop Sihlcity', 'Denner Altstetten', 'Aldi Suisse Dietikon', 'Migros MM Dietikon'],
  restaurant: ['Restaurant Sonne', 'Pizzeria Da Marco', 'Hitzberger Zürich', 'Tibits Zürich', 'McDonalds Letzipark'],
  kaffee: ['Bäckerei Kleiner', 'Starbucks HB', 'Coffee and Plants', 'Lindt & Sprüngli Kilchberg'],
  benzin: ['Coop Pronto Gerolds', 'Socar Schlieren', 'Migrol Urdorf'],
  kleidung: ['Zalando', 'C&A Zürich', 'Ochsner Sport', 'Globus Zürich'],
  technik: ['Digitec Galaxus', 'Interdiscount'],
  apotheke: ['Coop Vitality Dietikon', 'Amavita Apotheke'],
  haushalt: ['IKEA Spreitenbach', 'Jumbo Dietikon', 'Migros Do it'],
  kultur: ['Ticketino', 'Kino Abaton', 'Theater Winkelwiese'],
  ausflug: ['Bergbahnen Flumserberg', 'Zoo Zürich', 'Thermalbad Zürich'],
};

/** Legt einen kompletten Beispielhaushalt an: Konten, 10 Monate Buchungen,
 *  Vermögenspositionen, Sparziele und Budgets. */
export function loadDemoData() {
  const rand = rng(20260907);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const between = (a, b) => round2(a + rand() * (b - a));

  const accounts = [
    newAccount({ id: 'demo_ubs', name: 'UBS Privatkonto (gemeinsam)', type: 'giro', institution: 'UBS', currency: 'CHF', ownerId: 'u_gemeinsam', iban: 'CH27 0023 5235 4350 9140 B' }),
    newAccount({ id: 'demo_post', name: 'PostFinance Lukas', type: 'giro', institution: 'PostFinance', currency: 'CHF', ownerId: 'u_lukas' }),
    newAccount({ id: 'demo_spar', name: 'Sparkonto', type: 'sparen', institution: 'UBS', currency: 'CHF', ownerId: 'u_gemeinsam', balanceMode: 'manual', manualBalances: [{ date: today(), value: 24800 }] }),
    newAccount({ id: 'demo_kk_lu', name: 'Kreditkarte Lukas', type: 'kreditkarte', institution: 'Viseca', currency: 'CHF', ownerId: 'u_lukas', cardLast4: '2919' }),
    newAccount({ id: 'demo_kk_lea', name: 'Supercard Lea', type: 'kreditkarte', institution: 'Coop Supercard', currency: 'CHF', ownerId: 'u_lea', cardLast4: '7314' }),
    newAccount({ id: 'demo_3a', name: 'Säule 3a (finpension)', type: 'vorsorge3a', institution: 'finpension', currency: 'CHF', ownerId: 'u_lukas', balanceMode: 'manual', manualBalances: [{ date: today(), value: 41250 }] }),
    newAccount({ id: 'demo_depot', name: 'Depot USD (IBKR)', type: 'depot', institution: 'Interactive Brokers', currency: 'USD', ownerId: 'u_lukas', balanceMode: 'holdings', cashBalance: 1240 }),
    newAccount({ id: 'demo_eur', name: 'EUR-Konto', type: 'giro', institution: 'UBS', currency: 'EUR', ownerId: 'u_gemeinsam', openingBalance: 2100 }),
  ];

  const txns = [];
  const add = (accountId, date, payee, amount, categoryId, ownerId, extra = {}) => {
    txns.push(newTransaction({
      id: uid('demo'), accountId, date, payee, description: payee, amount: round2(amount),
      currency: store.account?.(accountId)?.currency || extra.currency || 'CHF',
      categoryId, ownerId, source: 'Beispieldaten', demo: true, ...extra,
    }));
  };

  const months = [];
  for (let i = 9; i >= 0; i--) months.push(addMonths(currentMonthKey(), -i));
  const d = (m, day) => `${m}-${pad2(Math.min(day, daysInMonth(m)))}`;

  for (const m of months) {
    // Einkommen
    add('demo_ubs', d(m, 25), 'Lohn Arbeitgeber Lukas', between(7900, 8100), 'c_lohn', 'u_lukas');
    add('demo_post', d(m, 25), 'Lohn Arbeitgeber Lea', between(5200, 5400), 'c_lohn_partner', 'u_lea');
    if (m.endsWith('-12')) add('demo_ubs', d(m, 20), '13. Monatslohn', 7950, 'c_bonus', 'u_lukas');

    // Fixkosten
    add('demo_ubs', d(m, 1), 'Immobilien Verwaltung AG – Miete', -2380, 'c_miete', 'u_gemeinsam');
    add('demo_ubs', d(m, 3), 'CSS Versicherung', -742.4, 'c_krankenkasse', 'u_gemeinsam');
    add('demo_ubs', d(m, 3), 'Swisscom', -119.9, 'c_internet', 'u_gemeinsam');
    add('demo_post', d(m, 5), 'Salt Mobile', -39.95, 'c_mobile', 'u_lukas');
    add('demo_ubs', d(m, 6), 'EWZ Elektrizitätswerk', -87.5, 'c_strom', 'u_gemeinsam');
    add('demo_ubs', d(m, 8), 'SBB Generalabonnement', -340, 'c_oev', 'u_gemeinsam');
    add('demo_kk_lu', d(m, 12), 'Netflix', -19.9, 'c_abos', 'u_lukas');
    add('demo_kk_lu', d(m, 14), 'Spotify', -12.95, 'c_abos', 'u_lukas');
    add('demo_kk_lea', d(m, 16), 'Activ Fitness', -79, 'c_sport', 'u_lea');
    add('demo_ubs', d(m, 28), 'Dienstleistungspreis', -5, 'c_bankgebuehren', 'u_gemeinsam');

    // Sparen und Vorsorge
    add('demo_ubs', d(m, 26), 'finpension 3a', -588, 'c_saeule3a', 'u_lukas');
    add('demo_ubs', d(m, 26), 'Dauerauftrag Sparkonto', -1200, 'c_sparen', 'u_gemeinsam');
    add('demo_post', d(m, 27), 'Interactive Brokers LLC', -500, 'c_investition', 'u_lukas');

    // Unregelmässiges
    if (['-03', '-09'].some((x) => m.endsWith(x))) add('demo_ubs', d(m, 18), 'Steueramt Kanton Zürich', -3400, 'c_steuern_kanton', 'u_gemeinsam');
    if (m.endsWith('-01')) add('demo_ubs', d(m, 14), 'AXA Versicherungen – Auto', -1180, 'c_autoversicherung', 'u_gemeinsam');
    if (m.endsWith('-02')) add('demo_ubs', d(m, 9), 'Strassenverkehrsamt ZH', -278, 'c_autosteuer', 'u_gemeinsam');
    if (m.endsWith('-06')) add('demo_ubs', d(m, 11), 'Serafe AG', -335, 'c_serafe', 'u_gemeinsam');
    if (m.endsWith('-07')) {
      add('demo_kk_lu', d(m, 8), 'Booking.com – Toscana', -1240, 'c_ferien', 'u_gemeinsam');
      add('demo_kk_lea', d(m, 12), 'Autoroutes ASF', -42.6, 'c_ferien', 'u_lea', { amountOriginal: -45, currencyOriginal: 'EUR', fxRate: 0.947 });
    }
    if (m.endsWith('-04') || m.endsWith('-10')) add('demo_kk_lu', d(m, 21), 'Garage Zürich West – Service', -680, 'c_autoservice', 'u_lukas');

    // Alltag: Lebensmittel
    for (let i = 0; i < 11; i++) {
      const who = rand() > 0.45 ? ['demo_kk_lu', 'u_lukas'] : ['demo_kk_lea', 'u_lea'];
      add(who[0], d(m, 2 + i * 2.6 | 0), pick(MERCHANTS.lebensmittel), -between(11, 128), 'c_lebensmittel', who[1]);
    }
    for (let i = 0; i < 5; i++) {
      const who = rand() > 0.5 ? ['demo_kk_lu', 'u_lukas'] : ['demo_kk_lea', 'u_lea'];
      add(who[0], d(m, 4 + i * 5 | 0), pick(MERCHANTS.restaurant), -between(18, 96), 'c_restaurant', who[1]);
    }
    for (let i = 0; i < 6; i++) add('demo_kk_lu', d(m, 1 + i * 4 | 0), pick(MERCHANTS.kaffee), -between(4.5, 16), 'c_kaffee', 'u_lukas');
    for (let i = 0; i < 3; i++) add('demo_kk_lu', d(m, 6 + i * 8 | 0), pick(MERCHANTS.benzin), -between(58, 92), 'c_benzin', 'u_lukas');
    if (rand() > 0.35) add('demo_kk_lea', d(m, 15), pick(MERCHANTS.kleidung), -between(45, 210), 'c_kleidung', 'u_lea');
    if (rand() > 0.6) add('demo_kk_lu', d(m, 19), pick(MERCHANTS.technik), -between(39, 320), 'c_technik', 'u_lukas');
    if (rand() > 0.5) add('demo_kk_lea', d(m, 22), pick(MERCHANTS.apotheke), -between(12, 68), 'c_apotheke', 'u_lea');
    if (rand() > 0.55) add('demo_kk_lu', d(m, 24), pick(MERCHANTS.haushalt), -between(25, 180), 'c_haushaltsartikel', 'u_gemeinsam');
    if (rand() > 0.6) add('demo_kk_lea', d(m, 17), pick(MERCHANTS.kultur), -between(28, 120), 'c_kultur', 'u_gemeinsam');
    if (rand() > 0.65) add('demo_kk_lu', d(m, 13), pick(MERCHANTS.ausflug), -between(35, 145), 'c_ausflug', 'u_gemeinsam');
    add('demo_kk_lu', d(m, 7), 'Parkhaus Sihlcity', -between(4, 22), 'c_parking', 'u_lukas');
    add('demo_ubs', d(m, 10), 'Bargeldbezug Bancomat', -200, 'c_bargeldbezug', 'u_gemeinsam', { isTransfer: true });

    // Kreditkartenrechnungen als Übertrag
    add('demo_ubs', d(m, 5), 'TopCard Service AG', -between(900, 1500), 'c_kk_zahlung', 'u_lukas', { isTransfer: true });
    add('demo_ubs', d(m, 5), 'Coop Supercard Abrechnung', -between(500, 950), 'c_kk_zahlung', 'u_lea', { isTransfer: true });
  }

  // Kartenkonten mit realistischem Saldo verankern (Rechnung jeweils bezahlt)
  for (const id of ['demo_kk_lu', 'demo_kk_lea']) {
    const acc = accounts.find((a) => a.id === id);
    acc.manualBalances = [{ date: today(), value: -round2(between(180, 640)) }];
  }
  accounts.find((a) => a.id === 'demo_ubs').manualBalances = [{ date: today(), value: 14320 }];
  accounts.find((a) => a.id === 'demo_post').manualBalances = [{ date: today(), value: 3860 }];

  const assets = [
    newAsset({ id: 'demo_wohnung', name: 'Eigentumswohnung Zürich', type: 'immobilie', currency: 'CHF', ownerId: 'u_gemeinsam', valuations: [{ date: addMonths(currentMonthKey(), -24) + '-01', value: 890000 }, { date: today(), value: 935000 }] }),
    newAsset({ id: 'demo_hypo', name: 'Hypothek', type: 'hypothek', currency: 'CHF', ownerId: 'u_gemeinsam', valuations: [{ date: addMonths(currentMonthKey(), -24) + '-01', value: 620000 }, { date: today(), value: 596000 }] }),
    newAsset({ id: 'demo_auto', name: 'Škoda Octavia', type: 'fahrzeug', currency: 'CHF', ownerId: 'u_gemeinsam', valuations: [{ date: today(), value: 21500 }] }),
  ];

  const goals = [
    newGoal({ id: 'demo_g1', name: 'Notgroschen', icon: '🛟', targetAmount: 30000, currency: 'CHF', accountIds: ['demo_spar'], monthlyContribution: 1200, priority: 1 }),
    newGoal({ id: 'demo_g2', name: 'Ferien Japan', icon: '⛩️', targetAmount: 9000, currency: 'CHF', targetDate: addMonths(currentMonthKey(), 14) + '-01', startAmount: 2400, monthlyContribution: 400, priority: 2 }),
    newGoal({ id: 'demo_g3', name: 'Wertschriften-Depot', icon: '📈', targetAmount: 100000, currency: 'CHF', accountIds: ['demo_depot'], monthlyContribution: 500, expectedReturnPct: 4.5, priority: 3 }),
  ];

  const budgets = [];
  const budgetPlan = {
    c_lohn: 8000, c_lohn_partner: 5300, c_miete: 2380, c_krankenkasse: 742, c_internet: 120,
    c_mobile: 40, c_strom: 90, c_oev: 340, c_abos: 33, c_sport: 79, c_bankgebuehren: 5,
    c_saeule3a: 588, c_sparen: 1200, c_investition: 500,
    c_steuern_kanton: 570, c_autoversicherung: 98, c_autosteuer: 23, c_serafe: 28,
    c_ferien: 250, c_autoservice: 115,
    c_lebensmittel: 900, c_restaurant: 280, c_kaffee: 60, c_benzin: 220, c_kleidung: 150,
    c_technik: 80, c_apotheke: 50, c_haushaltsartikel: 90, c_kultur: 70, c_ausflug: 80, c_parking: 25,
  };
  for (const m of months.slice(-4)) {
    for (const [categoryId, amount] of Object.entries(budgetPlan)) {
      budgets.push(newBudgetEntry({ period: m, categoryId, amount, note: 'Beispiel' }));
    }
  }

  // Wertschriften
  const t0 = Date.now();
  const holdings = [
    ['VT', 'Vanguard Total World Stock ETF', 'etf', 'welt', 113.075, 133.36, 159.75],
    ['VTI', 'Vanguard Total Stock Market ETF', 'etf', 'usa', 39.4148, 270.95, 377.41],
    ['VWO', 'Vanguard FTSE Emerging Markets ETF', 'etf', 'schwellen', 226.22, 43.08, 60.13],
    ['SCHD', 'Schwab U.S. Dividend Equity ETF', 'etf', 'usa', 217.96, 27.68, 33.28],
    ['CHSPI', 'iShares Core SPI ETF', 'etf', 'schweiz', 95, 128.4, 148.9],
    ['NESN', 'Nestlé SA', 'aktie', 'schweiz', 40, 96.5, 88.2],
    ['AMZN', 'Amazon.com Inc.', 'aktie', 'usa', 10, 135.5, 248.89],
  ].map(([symbol, name, assetClass, region, quantity, avgCost, price], i) => newHolding({
    id: `demo_h_${symbol.toLowerCase()}`, symbol, name, assetClass, region,
    accountId: 'demo_depot',
    currency: ['CHSPI', 'NESN'].includes(symbol) ? 'CHF' : 'USD',
    quantity, avgCost, lastPrice: price, lastPriceAt: t0, priceSource: 'Beispiel',
    dayChange: round2((rand() - 0.45) * quantity * price * 0.004),
  }));

  const dividends = [];
  for (const [symbol, perShare] of [['VT', 0.46], ['SCHD', 0.27], ['VWO', 0.38], ['NESN', 3.05]]) {
    const hld = holdings.find((x) => x.symbol === symbol);
    for (const q of [3, 6, 9]) {
      const m = addMonths(currentMonthKey(), -(12 - q));
      dividends.push(newDividend({
        id: `demo_div_${symbol}_${q}`, holdingId: hld.id, symbol,
        date: d(m, 18), amount: round2(hld.quantity * perShare), currency: hld.currency,
        withholding: hld.currency === 'USD' ? round2(hld.quantity * perShare * 0.15) : 0,
        note: 'Beispiel-Dividende', source: 'Beispiel',
      }));
    }
  }

  // Zwei zurückliegende Depotstände, damit der Verlauf sofort etwas zeigt
  const snapNow = round2(sum(holdings, (x) => convertDemo(x.quantity * x.lastPrice, x.currency)));
  const snapCost = round2(sum(holdings, (x) => convertDemo(x.quantity * x.avgCost, x.currency)));
  const snapshots = months.slice(-6).map((m, i, arr) => newSnapshot({
    id: `snap_${endOfMonthDemo(m)}`, date: endOfMonthDemo(m),
    valueBase: round2(snapNow * (0.82 + 0.18 * ((i + 1) / arr.length))),
    costBase: round2(snapCost * (0.88 + 0.12 * ((i + 1) / arr.length))),
    cashBase: 1100, positions: holdings.length,
  }));

  store.mutate('Beispieldaten geladen', ['accounts', 'transactions', 'assets', 'goals', 'budgets', 'categories', 'holdings', 'dividends', 'snapshots'], (doc) => {
    doc.holdings.push(...holdings);
    doc.dividends.push(...dividends);
    doc.snapshots.push(...snapshots);
    doc.accounts.push(...accounts);
    doc.transactions.push(...txns.map((t) => ({ ...t, currency: accounts.find((a) => a.id === t.accountId)?.currency || 'CHF' })));
    doc.assets.push(...assets);
    doc.goals.push(...goals);
    doc.budgets.push(...budgets);
    // Jahresbeträge für die Rückstellungen, damit das Flex-Budget sofort stimmt
    for (const [id, annual] of Object.entries({ c_steuern_kanton: 6800, c_autoversicherung: 1180, c_autosteuer: 278, c_serafe: 335, c_ferien: 3000, c_autoservice: 1360 })) {
      const cat = doc.categories.find((c) => c.id === id);
      if (cat) { cat.annualAmount = annual; cat.updatedAt = Date.now(); }
    }
  });

  return { accounts: accounts.length, transactions: txns.length, months: months.length, holdings: holdings.length };
}

// Grobe Umrechnung nur für die Beispieldaten (die echte Logik liegt in fx.js)
function convertDemo(amount, currency) {
  return currency === 'USD' ? amount * 0.85 : amount;
}

function endOfMonthDemo(key) {
  const [y, m] = key.split('-').map(Number);
  const dt = new Date(y, m, 0);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Entfernt alle Beispieldaten wieder. */
export function clearDemoData() {
  const demoAccounts = store.idx.accounts.filter((a) => a.id.startsWith('demo_')).map((a) => a.id);
  store.mutate('Beispieldaten entfernt', ['accounts', 'transactions', 'assets', 'goals', 'budgets', 'holdings', 'dividends', 'snapshots'], (doc) => {
    doc.accounts = doc.accounts.filter((a) => !a.id.startsWith('demo_'));
    doc.transactions = doc.transactions.filter((t) => !t.id.startsWith('demo_') && !demoAccounts.includes(t.accountId));
    doc.assets = doc.assets.filter((a) => !a.id.startsWith('demo_'));
    doc.goals = doc.goals.filter((g) => !g.id.startsWith('demo_'));
    doc.budgets = doc.budgets.filter((b) => b.note !== 'Beispiel');
    doc.holdings = doc.holdings.filter((h) => !h.id.startsWith('demo_h_'));
    doc.dividends = doc.dividends.filter((x) => !x.id.startsWith('demo_div_'));
    doc.snapshots = doc.snapshots.filter((x) => x.positions !== 7);
  });
}
