// investments.js — Ansicht „Anlagen“: Positionen, Allokation, Verlauf, Dividenden
import { store } from '../core/store.js';
import {
  h, fmtMoney, fmtNumber, fmtPercent, fmtDate, monthLabel, sortBy, todayISO,
  round2, sum, CURRENCIES, uid, now,
} from '../core/util.js';
import { ASSET_CLASSES, REGIONS, newHolding, newDividend } from '../core/model.js';
import {
  portfolio, allocation, evaluatePosition, valueHistory, performanceBreakdown,
  dividendsByYear, dividendYield, writeSnapshot,
} from '../core/investments.js';
import { refreshQuotes, setManualPrice, isConfigured, getProvider, PROVIDERS } from '../core/quotes.js';
import { chart, meter } from './charts.js';
import {
  modal, toast, confirmDialog, emptyState, statTile, segmented, accountSelect, colorSwatches, warningCard,
} from './components.js';
import { unknownCurrencies, seededOnlyCurrencies, fetchRates } from '../core/fx.js';

const ui = { allocDim: 'assetClass', months: 12, sort: { key: 'valueBase', dir: -1 }, showClosed: false };

export function renderInvestments({ params, navigate }) {
  const cur = store.baseCurrency;
  const root = h('div', {});
  const p = portfolio();

  if (!p.positions) {
    return h('div', {}, h('div', { class: 'card' }, emptyState('📈', 'Noch keine Wertschriften',
      'Importiere einen IBKR-Auszug (Activity Statement oder Flex Query) oder erfasse Positionen von Hand.',
      { label: 'Position erfassen', onClick: () => openHoldingEditor(null) })),
    h('div', { class: 'card' },
      h('p', { class: 'small muted' },
        'Der IBKR-Auszug geht über die gewohnte Import-Seite: Datei hineinziehen, die App erkennt ihn automatisch.'),
      h('button', { class: 'btn', onClick: () => navigate('import') }, 'Zum Import')));
  }

  const missing = unknownCurrencies();
  const seeded = seededOnlyCurrencies();
  if (missing.length) {
    root.append(warningCard(
      `Kein Wechselkurs für ${missing.join(', ')}`,
      `Positionen in ${missing.join(', ')} werden zurzeit 1:1 in ${cur} übernommen – der Depotwert stimmt damit nicht. `
      + 'Kurse aktualisieren oder den Kurs unter Einstellungen → Währungen von Hand setzen.',
      { label: 'Kurse holen', onClick: () => fetchRates().then(() => rerender()).catch((e) => toast(e.message, 'error')) }));
  } else if (seeded.length) {
    root.append(warningCard(
      `Nur Näherungskurs für ${seeded.join(', ')}`,
      'Es wird mit einem groben Startwert gerechnet, noch nie mit einem echten Kurs.',
      { label: 'Kurse holen', onClick: () => fetchRates().then(() => rerender()).catch((e) => toast(e.message, 'error')) }));
  }
  root.append(headerCard(p, cur));
  root.append(h('div', { class: 'grid' },
    allocationCard(p, cur),
    historyCard(cur)));
  root.append(positionsCard(p, cur, navigate));
  root.append(dividendCard(cur));
  return root;

  function rerender() {
    const parent = root.parentElement;
    if (parent) parent.replaceChild(renderInvestments({ params: {}, navigate }), root);
  }

  /* ---------------- Kopf ---------------- */

  function headerCard(pf, currency) {
    const stale = pf.staleCount;
    const card = h('section', { class: 'card' });
    card.append(h('div', { class: 'row' },
      h('div', { class: 'grow stat-row' },
        statTile({
          label: 'Depotwert', value: fmtMoney(pf.totalBase, currency, { noDecimals: true }), hero: true,
          sub: pf.cashBase ? `davon ${fmtMoney(pf.cashBase, currency, { noDecimals: true })} Barbestand` : null,
        }),
        statTile({
          label: 'Gewinn/Verlust', value: fmtMoney(pf.gainBase, currency, { noDecimals: true }),
          tone: pf.gainBase < 0 ? 'neg' : 'pos', sub: fmtPercent(pf.gainPct, 1),
        }),
        statTile({ label: 'Einstand', value: fmtMoney(pf.costBase, currency, { noDecimals: true }) }),
        pf.dayChangeBase !== null
          ? statTile({
            label: 'Heute', value: fmtMoney(pf.dayChangeBase, currency, { noDecimals: true }),
            tone: pf.dayChangeBase < 0 ? 'neg' : 'pos',
          })
          : null,
        statTile({ label: 'Positionen', value: String(pf.positions) })),
      h('div', { class: 'row tight' },
        h('button', { class: 'btn', onClick: () => openHoldingEditor(null, rerender) }, '+ Position'),
        h('button', { class: 'btn primary', onClick: () => doRefresh(rerender) }, '⟳ Kurse aktualisieren'))));

    const src = pf.oldestPrice ? new Date(pf.oldestPrice).toLocaleDateString('de-CH') : null;
    card.append(h('div', { class: 'small muted', style: { marginTop: '8px' } },
      !isConfigured()
        ? h('span', {},
          'Kurse werden nicht automatisch geholt – kein Schlüssel hinterlegt. ',
          h('a', { href: '#einstellungen?tab=kurse' }, 'In den Einstellungen einrichten'),
          ' oder Kurse je Position von Hand setzen.')
        : stale
          ? `${stale} Position${stale > 1 ? 'en' : ''} mit altem Kurs${src ? ` (ältester Stand ${src})` : ''}.`
          : `Alle Kurse aktuell${src ? ` (Stand ${src})` : ''} · Quelle ${PROVIDERS[getProvider()]?.label || '—'}`));
    return card;
  }

  /* ---------------- Allokation ---------------- */

  function allocationCard(pf, currency) {
    const rows = allocation(pf.rows, ui.allocDim);
    const card = h('section', { class: 'card g-6' });
    card.append(h('div', { class: 'card-head' },
      h('h3', { class: 'grow' }, 'Aufteilung'),
      segmented([
        { value: 'assetClass', label: 'Anlageart' },
        { value: 'region', label: 'Region' },
        { value: 'currency', label: 'Währung' },
        { value: 'position', label: 'Position' },
      ], ui.allocDim, (v) => { ui.allocDim = v; rerender(); })));
    card.append(chart({
      type: 'donut', height: 240, rows, currency,
      centerValue: fmtMoney(pf.valueBase, currency, { compact: true }), centerLabel: 'Wertschriften',
    }));
    const table = h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Gruppe'), h('th', { class: 'num' }, 'Wert'), h('th', { class: 'num' }, 'Anteil'))));
    const tb = h('tbody', {});
    for (const r of rows) {
      tb.append(h('tr', {},
        h('td', {}, h('i', { class: 'cat-dot', style: { background: r.color } }), r.label),
        h('td', { class: 'num mono' }, fmtMoney(r.value, currency, { noDecimals: true })),
        h('td', { class: 'num muted' }, fmtPercent(r.share, 1))));
    }
    table.append(tb);
    card.append(h('div', { class: 'table-wrap', style: { marginTop: '10px' } }, table));
    return card;
  }

  /* ---------------- Verlauf ---------------- */

  function historyCard(currency) {
    const card = h('section', { class: 'card g-6' });
    const hist = valueHistory(ui.months);
    const known = hist.filter((x) => x.value !== null);
    card.append(h('div', { class: 'card-head' },
      h('h3', { class: 'grow' }, 'Verlauf'),
      segmented([{ value: 12, label: '12 Mt' }, { value: 24, label: '24 Mt' }, { value: 60, label: '5 J' }],
        ui.months, (v) => { ui.months = v; rerender(); })));

    if (known.length < 2) {
      card.append(emptyState('📉', 'Verlauf wird aufgebaut',
        'Die App hält bei jeder Kursaktualisierung den Depotstand fest. Nach dem zweiten Stand erscheint hier die Kurve.'));
      const perf = performanceBreakdown(ui.months);
      card.append(h('p', { class: 'small muted' }, perf.note || ''));
      card.append(h('button', {
        class: 'btn sm', onClick: () => { writeSnapshot(); toast('Depotstand festgehalten', 'success'); rerender(); },
      }, 'Stand jetzt festhalten'));
      return card;
    }

    card.append(chart({
      type: 'line', height: 230, area: true, currency,
      labels: hist.map((x) => monthLabel(x.month, true)),
      series: [
        { label: 'Depotwert', color: 'var(--series-1)', values: hist.map((x) => x.value ?? x.carried) },
        { label: 'Einstand', color: 'var(--series-4)', values: hist.map((x) => x.cost), area: false, dashed: true },
      ],
    }));

    const perf = performanceBreakdown(ui.months);
    if (perf.enoughData) {
      card.append(h('div', { class: 'stat-row', style: { marginTop: '12px' } },
        statTile({
          label: 'Veränderung', value: fmtMoney(perf.change, currency, { noDecimals: true }),
          tone: perf.change < 0 ? 'neg' : 'pos', sub: `${monthLabel(perf.from, true)} – ${monthLabel(perf.to, true)}`,
        }),
        statTile({ label: 'davon Einzahlungen', value: fmtMoney(perf.contributions, currency, { noDecimals: true }) }),
        statTile({
          label: 'davon Marktbewegung', value: fmtMoney(perf.market, currency, { noDecimals: true }),
          tone: perf.market < 0 ? 'neg' : 'pos',
        })));
    }
    return card;
  }

  /* ---------------- Positionen ---------------- */

  function positionsCard(pf, currency, nav) {
    const card = h('section', { class: 'card', id: 'positionen' });
    card.append(h('div', { class: 'card-head' },
      h('h3', { class: 'grow' }, 'Positionen'),
      h('button', { class: 'btn ghost sm', onClick: () => exportPositions(pf) }, '⤓ CSV')));

    const sorted = sortBy(pf.rows, (r) => {
      switch (ui.sort.key) {
        case 'symbol': return (r.holding.symbol || '').toLowerCase();
        case 'gainBase': return r.gainBase;
        case 'gainPct': return r.gainPct;
        default: return r.valueBase;
      }
    }, ui.sort.dir);

    const th = (label, key, num = true) => h('th', {
      class: num ? 'num' : '', style: { cursor: 'pointer' },
      onClick: () => { ui.sort = { key, dir: ui.sort.key === key ? -ui.sort.dir : -1 }; rerender(); },
    }, `${label}${ui.sort.key === key ? (ui.sort.dir === 1 ? ' ▲' : ' ▼') : ''}`);

    const table = h('table', { class: 'data' },
      h('thead', {}, h('tr', {},
        th('Titel', 'symbol', false),
        h('th', { class: 'num' }, 'Anzahl'),
        h('th', { class: 'num' }, 'Kurs'),
        h('th', { class: 'num' }, 'Einstand'),
        th('Wert', 'valueBase'),
        th('G/V', 'gainBase'),
        th('%', 'gainPct'),
        h('th', { class: 'num' }, 'Anteil'))));
    const tb = h('tbody', {});
    for (const r of sorted) {
      const hld = r.holding;
      const tr = h('tr', { style: { cursor: 'pointer' } },
        h('td', {},
          h('div', { class: 'txn-payee' },
            hld.symbol || hld.name || '—',
            hld.currency !== currency ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, hld.currency) : null,
            r.stale ? h('span', { class: 'badge warn', style: { marginLeft: '6px' } }, 'Kurs alt') : null),
          h('div', { class: 'txn-sub truncate', style: { maxWidth: '320px' } },
            [hld.name, ASSET_CLASSES.find((c) => c.id === hld.assetClass)?.label].filter(Boolean).join(' · '))),
        h('td', { class: 'num mono' }, fmtNumber(hld.quantity, hld.quantity % 1 === 0 ? 0 : 4)),
        h('td', { class: 'num mono' }, fmtMoney(hld.lastPrice, hld.currency)),
        h('td', { class: 'num mono muted' }, fmtMoney(hld.avgCost, hld.currency)),
        h('td', { class: 'num mono' }, fmtMoney(r.valueBase, currency, { noDecimals: true })),
        h('td', { class: `num mono ${r.gainBase < 0 ? 'neg' : 'pos'}` }, fmtMoney(r.gainBase, currency, { noDecimals: true })),
        h('td', { class: `num ${r.gain < 0 ? 'neg' : 'pos'}` }, fmtPercent(r.gainPct, 1)),
        h('td', { class: 'num muted' }, fmtPercent(r.share, 1)));
      tr.addEventListener('click', () => openHoldingEditor(hld, rerender));
      tb.append(tr);
    }
    table.append(tb);
    card.append(h('div', { class: 'table-wrap' }, table));
    card.append(h('p', { class: 'small muted', style: { marginTop: '10px' } },
      'Gewinn/Verlust in ', currency, ' rechnet mit dem heutigen Wechselkurs. Wer den Einstand in ',
      currency, ' kennt, trägt ihn in der Position ein – dann weist die App den Währungseffekt separat aus.'));
    return card;
  }

  /* ---------------- Dividenden ---------------- */

  function dividendCard(currency) {
    const years = dividendsByYear();
    const card = h('section', { class: 'card' });
    card.append(h('div', { class: 'card-head' },
      h('h3', { class: 'grow' }, 'Dividenden'),
      h('button', { class: 'btn sm', onClick: () => openDividendEditor(null, rerender) }, '+ Erfassen'),
      years.length ? h('button', { class: 'btn ghost sm', onClick: () => exportDividends() }, '⤓ Für die Steuererklärung') : null));

    if (!years.length) {
      card.append(h('p', { class: 'small muted' },
        'Noch keine Dividenden erfasst. Der IBKR-Auszug bringt sie beim Import automatisch mit, inklusive Quellensteuer.'));
      return card;
    }

    const y = dividendYield();
    card.append(h('div', { class: 'stat-row', style: { marginBottom: '12px' } },
      statTile({ label: 'Letzte 12 Monate', value: fmtMoney(y.amount, currency, { noDecimals: true }), hero: true, sub: `${fmtPercent(y.pct, 2)} auf den Depotwert` }),
      statTile({ label: 'Erfasste Jahre', value: String(years.length) })));

    card.append(chart({
      type: 'bar', height: 190, currency, legend: false,
      rows: [...years].reverse().map((x) => ({ label: x.year, value: x.gross, color: 'var(--series-3)' })),
    }));

    const table = h('table', { class: 'data' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Jahr'), h('th', { class: 'num' }, 'Brutto'),
        h('th', { class: 'num' }, 'Quellensteuer'), h('th', { class: 'num' }, 'Netto'),
        h('th', { class: 'num' }, 'Zahlungen'), h('th', {}, 'Grösste Positionen'))));
    const tb = h('tbody', {});
    for (const x of years) {
      const top = Array.from(x.bySymbol.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([sym, v]) => `${sym} ${fmtMoney(v, currency, { noDecimals: true })}`).join(' · ');
      tb.append(h('tr', {},
        h('td', { class: 'mono' }, x.year),
        h('td', { class: 'num mono' }, fmtMoney(x.gross, currency, { noDecimals: true })),
        h('td', { class: 'num mono muted' }, fmtMoney(x.withholding, currency, { noDecimals: true })),
        h('td', { class: 'num mono' }, fmtMoney(x.net, currency, { noDecimals: true })),
        h('td', { class: 'num muted' }, String(x.count)),
        h('td', { class: 'small muted truncate', style: { maxWidth: '280px' } }, top)));
    }
    table.append(tb);
    card.append(h('div', { class: 'table-wrap', style: { marginTop: '12px' } }, table));
    return card;
  }
}

/* ---------------- Kurse holen ---------------- */

async function doRefresh(rerender) {
  if (!isConfigured()) {
    modal({
      title: 'Kurse automatisch holen',
      body: h('div', { class: 'small' },
        h('p', {}, 'Dafür braucht die App einen Gratis-Schlüssel bei einem Kursanbieter. '
          + 'Der Schlüssel bleibt auf deinem Gerät und wird nicht mitsynchronisiert.'),
        h('p', {}, 'Bis dahin kannst du den Kurs jeder Position von Hand setzen – '
          + 'ein Klick auf die Position, Feld „Kurs“.')),
      actions: [
        { label: 'Später' },
        { label: 'Jetzt einrichten', variant: 'primary', onClick: () => { location.hash = 'einstellungen?tab=kurse'; } },
      ],
    });
    return;
  }
  const t = toast('Kurse werden geholt …', 'info', { timeout: 0 });
  try {
    const res = await refreshQuotes({ force: true });
    t.remove();
    if (res.skipped) toast(res.reason || 'Keine Positionen mit Symbol.', 'info');
    else if (res.failed?.length) {
      toast(`${res.updated} Kurse aktualisiert, ${res.failed.length} ohne Ergebnis`, 'error', {
        action: { label: 'Details', onClick: () => showFailures(res.failed) },
      });
    } else toast(`${res.updated} Kurse aktualisiert (${res.provider})`, 'success');
    rerender?.();
  } catch (e) {
    t.remove();
    toast(`Kursabruf fehlgeschlagen: ${e.message}`, 'error', { timeout: 9000 });
  }
}

function showFailures(failed) {
  modal({
    title: 'Positionen ohne Kurs',
    body: h('div', {},
      h('p', { class: 'small muted' },
        'Meist stimmt das Börsenkürzel nicht mit dem des Anbieters überein. '
        + 'Bei nicht-amerikanischen Titeln hilft ein Zusatz wie „UHR:SIX“ oder „NESN:SIX“. '
        + 'Alternativ den Kurs von Hand setzen.'),
      h('ul', { class: 'small' }, failed.map((f) => h('li', {}, `${f.symbol}: ${f.error}`)))),
    actions: [{ label: 'Schliessen', variant: 'primary' }],
  });
}

/* ---------------- Position bearbeiten ---------------- */

export function openHoldingEditor(holding, onSaved) {
  const isNew = !holding;
  const hd = holding ? { ...holding } : newHolding({
    accountId: store.idx.accounts.find((a) => a.type === 'depot')?.id || null,
  });
  const field = (label, input, hint, full) =>
    h('label', { class: 'field', style: full ? { gridColumn: '1 / -1' } : {} },
      h('span', {}, label), input, hint ? h('span', { class: 'small muted' }, hint) : null);

  const symbolI = h('input', { type: 'text', value: hd.symbol, placeholder: 'z. B. VT', onInput: (e) => { hd.symbol = e.target.value.toUpperCase(); } });
  const nameI = h('input', { type: 'text', value: hd.name, onInput: (e) => { hd.name = e.target.value; } });
  const classI = h('select', { onChange: (e) => { hd.assetClass = e.target.value; } },
    ASSET_CLASSES.map((c) => h('option', { value: c.id, selected: c.id === hd.assetClass }, c.label)));
  const regionI = h('select', { onChange: (e) => { hd.region = e.target.value; } },
    REGIONS.map((c) => h('option', { value: c.id, selected: c.id === hd.region }, c.label)));
  const curI = h('select', { onChange: (e) => { hd.currency = e.target.value; } },
    ['USD', 'CHF', 'EUR', 'GBP'].map((c) => h('option', { value: c, selected: c === hd.currency }, c)));
  const qtyI = h('input', { type: 'number', step: 'any', value: hd.quantity, onInput: (e) => { hd.quantity = Number(e.target.value); } });
  const costI = h('input', { type: 'number', step: 'any', value: hd.avgCost, onInput: (e) => { hd.avgCost = Number(e.target.value); } });
  const costBaseI = h('input', {
    type: 'number', step: 'any', value: hd.avgCostBase ?? '',
    onInput: (e) => { hd.avgCostBase = e.target.value === '' ? null : Number(e.target.value); },
  });
  const priceI = h('input', { type: 'number', step: 'any', value: hd.lastPrice, onInput: (e) => { hd.lastPrice = Number(e.target.value); hd.priceSource = 'manuell'; hd.lastPriceAt = Date.now(); } });
  const accI = accountSelect({ value: hd.accountId, includeEmpty: true, emptyLabel: '— kein Konto —', onChange: (v) => { hd.accountId = v; } });
  const isinI = h('input', { type: 'text', value: hd.isin, onInput: (e) => { hd.isin = e.target.value; } });

  const preview = h('div', { class: 'small muted', style: { gridColumn: '1 / -1' } });
  const updatePreview = () => {
    const ev = evaluatePosition(hd);
    preview.textContent = `Wert ${fmtMoney(ev.value, hd.currency)} · Einstand ${fmtMoney(ev.cost, hd.currency)} · `
      + `G/V ${fmtMoney(ev.gain, hd.currency)} (${fmtPercent(ev.gainPct, 1)}) · in ${store.baseCurrency}: ${fmtMoney(ev.valueBase, store.baseCurrency)}`;
  };
  for (const inp of [qtyI, costI, priceI]) inp.addEventListener('input', updatePreview);
  updatePreview();

  modal({
    title: isNew ? 'Neue Position' : `${hd.symbol || hd.name}`, wide: true,
    body: h('div', { class: 'form-grid' },
      field('Kürzel', symbolI, 'Wie beim Kursanbieter, z. B. VT oder NESN:SIX'),
      field('Bezeichnung', nameI),
      field('Anlageart', classI), field('Region', regionI),
      field('Währung', curI), field('Konto', accI),
      field('Anzahl', qtyI), field('Einstandskurs je Stück', costI),
      field('Aktueller Kurs', priceI, hd.lastPriceAt ? `Stand ${new Date(hd.lastPriceAt).toLocaleDateString('de-CH')} · ${hd.priceSource}` : 'noch kein Kurs'),
      field(`Einstand je Stück in ${store.baseCurrency} (optional)`, costBaseI, 'Ermöglicht die Trennung von Kurs- und Währungsgewinn'),
      field('ISIN', isinI, null, true),
      preview),
    actions: [
      { label: 'Abbrechen' },
      !isNew ? {
        label: 'Löschen', variant: 'danger',
        onClick: async () => {
          if (!await confirmDialog(`Position ${hd.symbol || hd.name} löschen?`)) return false;
          store.remove('holdings', hd.id, 'Position gelöscht');
          onSaved?.();
        },
      } : null,
      {
        label: 'Speichern', variant: 'primary',
        onClick: () => {
          store.upsert('holdings', hd, isNew ? 'Position erfasst' : 'Position geändert');
          writeSnapshot();
          toast('Gespeichert', 'success');
          onSaved?.();
        },
      },
    ].filter(Boolean),
  });
}

/* ---------------- Dividende erfassen ---------------- */

function openDividendEditor(dividend, onSaved) {
  const d = dividend ? { ...dividend } : newDividend();
  const holdings = store.idx.holdings.filter((x) => x.symbol);
  const symI = h('select', { onChange: (e) => { d.holdingId = e.target.value; d.symbol = store.holding(e.target.value)?.symbol || ''; d.currency = store.holding(e.target.value)?.currency || d.currency; } },
    h('option', { value: '' }, '— frei eingeben —'),
    holdings.map((x) => h('option', { value: x.id, selected: x.id === d.holdingId }, `${x.symbol} · ${x.name || ''}`)));
  const dateI = h('input', { type: 'date', value: d.date, onInput: (e) => { d.date = e.target.value; } });
  const amountI = h('input', { type: 'number', step: '0.01', value: d.amount, onInput: (e) => { d.amount = Number(e.target.value); } });
  const whI = h('input', { type: 'number', step: '0.01', value: d.withholding, onInput: (e) => { d.withholding = Number(e.target.value); } });
  const curI = h('select', { onChange: (e) => { d.currency = e.target.value; } },
    ['USD', 'CHF', 'EUR', 'GBP'].map((c) => h('option', { value: c, selected: c === d.currency }, c)));

  modal({
    title: 'Dividende erfassen',
    body: h('div', { class: 'form-grid' },
      h('label', { class: 'field', style: { gridColumn: '1 / -1' } }, h('span', {}, 'Position'), symI),
      h('label', { class: 'field' }, h('span', {}, 'Datum'), dateI),
      h('label', { class: 'field' }, h('span', {}, 'Währung'), curI),
      h('label', { class: 'field' }, h('span', {}, 'Bruttobetrag'), amountI),
      h('label', { class: 'field' }, h('span', {}, 'Quellensteuer'), whI)),
    actions: [
      { label: 'Abbrechen' },
      {
        label: 'Speichern', variant: 'primary',
        onClick: () => { store.upsert('dividends', d, 'Dividende erfasst'); toast('Gespeichert', 'success'); onSaved?.(); },
      },
    ],
  });
}

/* ---------------- Export ---------------- */

function exportPositions(pf) {
  const cur = store.baseCurrency;
  const lines = [`Kürzel;Bezeichnung;Anlageart;Währung;Anzahl;Kurs;Einstand je Stück;Wert (${cur});Einstand (${cur});G/V (${cur});Anteil`];
  for (const r of pf.rows) {
    const x = r.holding;
    lines.push([x.symbol, x.name, x.assetClass, x.currency, x.quantity, x.lastPrice, x.avgCost,
      r.valueBase, r.costBase, r.gainBase, (r.share * 100).toFixed(2)]
      .map((v) => `"${String(v ?? '').replace(/\./g, ',')}"`).join(';'));
  }
  downloadCsv(`depot_${todayISO()}.csv`, lines.join('\r\n'));
}

function exportDividends() {
  const cur = store.baseCurrency;
  const lines = [`Datum;Kürzel;Bezeichnung;Währung;Brutto;Quellensteuer;Brutto (${cur});Notiz`];
  for (const d of sortBy(store.idx.dividends, (x) => x.date)) {
    const hld = store.holding(d.holdingId);
    lines.push([d.date, d.symbol || hld?.symbol || '', hld?.name || '', d.currency, d.amount, d.withholding,
      round2(d.amount), d.note || '']
      .map((v) => `"${String(v ?? '').replace(/\./g, ',')}"`).join(';'));
  }
  downloadCsv(`dividenden_${todayISO()}.csv`, lines.join('\r\n'));
  toast('Für das Wertschriftenverzeichnis exportiert', 'success');
}

function downloadCsv(name, content) {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
