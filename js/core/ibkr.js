// ibkr.js — Auszüge von Interactive Brokers einlesen
// Unterstützt den abschnittsbasierten Activity Statement (CSV, englisch und deutsch –
// dort heisst er „Umsatzübersicht“) und flache Flex-Query-Exporte.
import { newHolding, newDividend } from './model.js';
import { toISODate, parseNumber, normText, round2 } from './util.js';

/** Anteile werden bei IBKR bruchteilig geführt – auf keinen Fall auf 2 Stellen runden. */
const qty = (n) => Number(Number(n).toFixed(8));

const norm = (v) => String(v ?? '').trim();
const lower = (v) => norm(v).toLowerCase();

/* Abschnittsnamen des Auszugs: englisch und deutsch. */
const SECTION = {
  statement: ['Statement'],
  account: ['Account Information', 'Kontoinformation'],
  positions: ['Open Positions', 'Offene Positionen'],
  dividends: ['Dividends', 'Dividenden'],
  withholding: ['Withholding Tax', 'Quellensteuer'],
  deposits: ['Deposits & Withdrawals', 'Einzahlungen & Auszahlungen'],
  instruments: ['Financial Instrument Information', 'Informationen zum Finanzinstrument'],
  cash: ['Cash Report', 'Cash-Bericht'],
};
const section = (secs, key) => { for (const n of SECTION[key]) if (secs.has(n)) return secs.get(n); return null; };

/**
 * Datum aus einem IBKR-Auszug. IBKR selbst schreibt ISO („2026-05-14“). Wurde die Datei
 * in einem Excel mit US-Einstellung geöffnet und gespeichert, steht dort „5/14/2026“ –
 * Monat zuerst. Die allgemeine Datumsroutine liest Schrägstriche als Tag/Monat und
 * würde daraus den 5. des 14. Monats machen.
 */
export function ibkrDate(value) {
  const s = norm(value);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return toISODate(value);
  let month = Number(m[1]), day = Number(m[2]);
  if (month > 12 && day <= 12) [month, day] = [day, month];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Erkennt IBKR-Dateien an den typischen Abschnitten bzw. Spalten. */
export function detectIbkr(rows) {
  if (!rows || !rows.length) return false;
  const firstCells = rows.slice(0, 80).map((r) => lower(r?.[0]));
  if (firstCells.some((c) => c === 'open positions' || c === 'offene positionen' || c === 'statement'
    || c === 'net asset value' || c === 'nettovermögenswert')) return true;
  for (const r of rows.slice(0, 12)) {
    const cells = (r || []).map(lower);
    const hasSymbol = cells.includes('symbol');
    const hasQty = cells.some((c) => c === 'quantity' || c === 'position');
    const hasCost = cells.some((c) => c.includes('costbasis') || c === 'cost price' || c === 'costprice' || c.includes('markprice'));
    if (hasSymbol && hasQty && hasCost) return true;
  }
  return false;
}

/* ---------------- Abschnittsbasierter Auszug ---------------- */

function sections(rows) {
  const out = new Map();
  let current = null;
  let header = null;
  for (const raw of rows) {
    const r = raw || [];
    const section = norm(r[0]);
    const kind = lower(r[1]);
    if (!section) continue;
    if (kind === 'header') {
      current = section;
      header = r.slice(2).map(norm);
      if (!out.has(section)) out.set(section, { header, rows: [] });
      else out.get(section).header = header;
      continue;
    }
    if (kind === 'data' && current === section && out.has(section)) {
      out.get(section).rows.push(r.slice(2));
    }
  }
  return out;
}

function col(header, ...names) {
  const h = header.map(lower);
  for (const n of names) {
    const i = h.indexOf(lower(n));
    if (i >= 0) return i;
  }
  for (const n of names) {
    const i = h.findIndex((x) => x.replace(/[^a-z]/g, '').includes(lower(n).replace(/[^a-z]/g, '')));
    if (i >= 0) return i;
  }
  return -1;
}

/** „VT(US9220427424) Cash Dividend USD 0.4 per Share“ → { symbol: 'VT', isin: 'US9220427424' } */
export function parseDividendDescription(desc) {
  const s = norm(desc);
  const m = s.match(/^([A-Z0-9.\-]{1,12})\s*\(([A-Z0-9]{9,12})\)/);
  if (m) return { symbol: m[1], isin: m[2] };
  const m2 = s.match(/^([A-Z0-9.\-]{1,12})\b/);
  return { symbol: m2 ? m2[1] : '', isin: '' };
}

/* Im Activity Statement stehen ETFs ebenfalls unter „Stocks“ und oft ohne Bezeichnung.
 * Diese Liste deckt die gängigen Fonds ab; jede Position lässt sich in der App umstellen. */
const ETF_TICKERS = new Set(`
VT VTI VOO VOOG VOOV VTV VUG VB VBR VO VXF VEA VWO VXUS VEU VSS VYM VYMI VIG VNQ VNQI VGT VHT VDE VPU VAW VIS VCR VDC VFH VOX
BND BNDX BNDW BSV BIV BLV VCIT VCSH VCLT VGSH VGIT VGLT VTIP VMBS VTEB
IVV IJH IJR IUSG IUSV IUSB IEFA IEMG IEUR IWM IWB IWF IWD IWN IWO ITOT IXUS IVW IVE IJS IJT
AGG LQD HYG TIP SHY IEF TLT GOVT SGOV BIL TFLO USFR
SPY QQQ QQQM DIA MDY SLY RSP MOAT SCHD SCHG SCHX SCHA SCHB SCHF SCHE SCHZ SCHP SCHO SCHR SCHH SCHY
JEPI JEPQ JPIE JPST JAAA DIVO SPHD SPYD NOBL DGRO DGRW HDV VIGI
MGK MGV MGC VV XLK XLF XLE XLV XLY XLP XLI XLU XLB XLRE XLC
ARKK ARKG ARKW ICLN TAN PHO PBW FDN CIBR SKYY HACK ROBO BOTZ SOXX SMH IGV
GLD IAU SLV PDBC DBC GLDM SGOL
EFA EEM ACWI ACWX IOO URTH VEUR VJPN
CHSPI CHDVD SMICHA SPICHA SLICHA UBSC SMIM
PFF PFFD PFN PTY PDI RQI UTF UTG STK BST BSTZ
`.trim().split(/\s+/));

const ASSET_MAP = {
  stocks: 'aktie', stock: 'aktie', stk: 'aktie', equity: 'aktie', aktien: 'aktie',
  anleihen: 'anleihe', devisen: 'bargeld', investmentfonds: 'fonds', rohstoffe: 'rohstoff',
  etfs: 'etf', etf: 'etf', funds: 'fonds', fund: 'fonds',
  bonds: 'anleihe', bond: 'anleihe', bnd: 'anleihe',
  cash: 'bargeld', forex: 'bargeld',
  crypto: 'krypto', cryptocurrency: 'krypto',
  commodities: 'rohstoff', futures: 'rohstoff',
};

/** ETFs und Aktien lassen sich im Auszug nicht sicher unterscheiden – der Name hilft. */
export function classify(assetCategory, name = '', symbol = '', instrumentType = '') {
  const base = ASSET_MAP[lower(assetCategory).replace(/[^a-z]/g, '')] || null;
  if (base && base !== 'aktie') return base;
  // Der Auszug sagt es im Abschnitt „Informationen zum Finanzinstrument“ selbst
  const type = lower(instrumentType);
  if (type === 'etf' || type === 'etn' || type === 'etc') return 'etf';
  if (type.includes('fund')) return 'fonds';
  if (type === 'common' || type === 'adr' || type === 'reit' || type === 'preferred') return 'aktie';
  const text = normText(`${name} ${symbol}`);
  if (/\betf\b|index fund|ishares|vanguard|spdr|invesco|xtrackers|ucits|trust|portfolio/.test(text)) return 'etf';
  if (ETF_TICKERS.has(norm(symbol).toUpperCase())) return 'etf';
  return base || 'aktie';
}

function parseSectionStatement(rows) {
  const secs = sections(rows);
  const holdings = [];
  const dividends = [];
  const deposits = [];
  const meta = { baseCurrency: null, accountId: null, accountName: null, alias: null, period: null, cash: null, cashByCurrency: {} };

  for (const info of [section(secs, 'statement'), section(secs, 'account')]) {
    if (!info) continue;
    for (const r of info.rows) {
      const k = lower(r[0]);
      if (k.includes('base currency') || k === 'basiswährung') meta.baseCurrency = norm(r[1]).toUpperCase();
      if (k === 'account' || k.includes('account id') || k === 'konto') meta.accountId = norm(r[1]);
      if (k === 'name') meta.accountName = norm(r[1]);
      if (k === 'account alias' || k === 'konto-alias') meta.alias = norm(r[1]);
      if (k === 'period' || k === 'zeitraum') meta.period = norm(r[1]);
    }
  }

  // Bezeichnung, ISIN und Art je Symbol
  const instruments = new Map();
  const ins = section(secs, 'instruments');
  if (ins) {
    const h = ins.header;
    const ix = {
      sym: col(h, 'Symbol'), desc: col(h, 'Description', 'Beschreibung'),
      isin: col(h, 'Security ID', 'Wertpapier-ID'), exch: col(h, 'Listing Exch', 'Börse'), type: col(h, 'Type', 'Typ'),
    };
    for (const r of ins.rows) {
      const symbol = norm(r[ix.sym]).toUpperCase();
      if (!symbol) continue;
      instruments.set(symbol, {
        name: ix.desc >= 0 ? norm(r[ix.desc]) : '', isin: ix.isin >= 0 ? norm(r[ix.isin]) : '',
        exchange: ix.exch >= 0 ? norm(r[ix.exch]) : '', type: ix.type >= 0 ? norm(r[ix.type]) : '',
      });
    }
  }

  // Barbestand: „Ending Cash“ je Währung und in Basiswährung
  const cash = section(secs, 'cash');
  if (cash) {
    for (const r of cash.rows) {
      const label = lower(r[0]);
      if (label !== 'ending cash' && label !== 'endbarsaldo') continue;
      const cur = norm(r[1]);
      const amount = parseNumber(r[2]);
      if (amount === null) continue;
      if (/^[A-Z]{3}$/.test(cur)) meta.cashByCurrency[cur] = round2(amount);
      else meta.cash = round2(amount);          // „Base Currency Summary“ / „Basiswährungsübersicht“
    }
  }

  const pos = section(secs, 'positions');
  if (pos) {
    const h = pos.header;
    const ix = {
      disc: col(h, 'DataDiscriminator'),
      asset: col(h, 'Asset Category', 'Vermögenswertkategorie'),
      cur: col(h, 'Currency', 'Währung'),
      sym: col(h, 'Symbol'),
      qty: col(h, 'Quantity', 'Menge'),
      costPrice: col(h, 'Cost Price', 'CostBasisPrice', 'Einstands Kurs', 'Einstandskurs'),
      costBasis: col(h, 'Cost Basis', 'CostBasisMoney', 'Kostenbasis'),
      close: col(h, 'Close Price', 'MarkPrice', 'Schlusskurs'),
      value: col(h, 'Value', 'PositionValue', 'Wert'),
      desc: col(h, 'Description', 'Beschreibung'),
    };
    for (const r of pos.rows) {
      if (ix.disc >= 0 && lower(r[ix.disc]) && lower(r[ix.disc]) !== 'summary') continue;
      const symbol = norm(r[ix.sym]).toUpperCase();
      const quantity = parseNumber(r[ix.qty]);
      if (!symbol || !quantity) continue;
      const currency = (norm(r[ix.cur]) || 'USD').toUpperCase();
      if (currency === 'TOTAL' || symbol === 'TOTAL') continue;
      let avgCost = ix.costPrice >= 0 ? parseNumber(r[ix.costPrice]) : null;
      const basis = ix.costBasis >= 0 ? parseNumber(r[ix.costBasis]) : null;
      if ((avgCost === null || avgCost === 0) && basis) avgCost = basis / quantity;
      const price = ix.close >= 0 ? parseNumber(r[ix.close]) : null;
      const info = instruments.get(symbol) || {};
      const name = (ix.desc >= 0 ? norm(r[ix.desc]) : '') || info.name || '';
      holdings.push(newHolding({
        symbol, name,
        assetClass: classify(ix.asset >= 0 ? r[ix.asset] : '', name, symbol, info.type),
        currency,
        quantity: qty(quantity),
        avgCost: avgCost ? Number(avgCost.toFixed(6)) : 0,
        lastPrice: price ? round2(price) : 0,
        lastPriceAt: price ? Date.now() : null,
        priceSource: price ? 'IBKR-Auszug' : 'manuell',
        isin: info.isin || '', exchange: info.exchange || '',
      }));
    }
  }

  const fourCols = (h) => ({
    cur: col(h, 'Currency', 'Währung'), date: col(h, 'Date', 'Datum'),
    desc: col(h, 'Description', 'Beschreibung'), amount: col(h, 'Amount', 'Betrag'),
  });

  const div = section(secs, 'dividends');
  if (div) {
    const ix = fourCols(div.header);
    for (const r of div.rows) {
      const currency = norm(r[ix.cur]).toUpperCase();
      const date = ibkrDate(r[ix.date]);
      const amount = parseNumber(r[ix.amount]);
      if (!date || !amount || !/^[A-Z]{3}$/.test(currency)) continue;
      const { symbol, isin } = parseDividendDescription(r[ix.desc]);
      dividends.push(newDividend({
        symbol, isin, date, amount: round2(amount), currency,
        note: norm(r[ix.desc]).slice(0, 120), source: 'IBKR',
      }));
    }
  }

  // Quellensteuer den Dividenden zuordnen (gleiches Datum und Symbol)
  const wh = section(secs, 'withholding');
  if (wh) {
    const ix = fourCols(wh.header);
    for (const r of wh.rows) {
      const date = ibkrDate(r[ix.date]);
      const amount = parseNumber(r[ix.amount]);
      if (!date || !amount) continue;
      const { symbol } = parseDividendDescription(r[ix.desc]);
      // Korrekturbuchungen kommen mit umgekehrtem Vorzeichen – deshalb aufsummieren
      const match = dividends.find((d) => d.date === date && d.symbol === symbol);
      if (match) match.withholding = round2((match.withholding || 0) - amount);
      else {
        dividends.push(newDividend({
          symbol, date, amount: 0, withholding: round2(-amount),
          currency: norm(r[ix.cur]).toUpperCase(), note: 'Quellensteuer', source: 'IBKR',
        }));
      }
    }
  }

  const dep = section(secs, 'deposits');
  if (dep) {
    const h = dep.header;
    const ix = {
      cur: col(h, 'Currency', 'Währung'), date: col(h, 'Settle Date', 'Abwicklungsdatum', 'Date', 'Datum'),
      desc: col(h, 'Description', 'Beschreibung'), amount: col(h, 'Amount', 'Betrag'),
    };
    for (const r of dep.rows) {
      const date = ibkrDate(r[ix.date]);
      const amount = parseNumber(r[ix.amount]);
      if (!date || !amount) continue;
      deposits.push({ date, amount: round2(amount), currency: norm(r[ix.cur]).toUpperCase(), note: norm(r[ix.desc]) });
    }
  }

  return { holdings, dividends, deposits, meta, layout: 'Activity Statement' };
}

/* ---------------- Flacher Flex-Query-Export ---------------- */

function parseFlatFlex(rows) {
  let headerRow = -1;
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const cells = (rows[i] || []).map(lower);
    if (cells.includes('symbol') && cells.some((c) => c === 'quantity' || c === 'position')) { headerRow = i; break; }
  }
  if (headerRow < 0) return { holdings: [], dividends: [], deposits: [], meta: {}, layout: 'unbekannt' };
  const h = (rows[headerRow] || []).map(norm);
  const ix = {
    sym: col(h, 'Symbol'),
    desc: col(h, 'Description', 'SecurityID'),
    qty: col(h, 'Quantity', 'Position'),
    cur: col(h, 'CurrencyPrimary', 'Currency'),
    asset: col(h, 'AssetClass', 'Asset Category'),
    costPrice: col(h, 'CostBasisPrice', 'Cost Price'),
    costMoney: col(h, 'CostBasisMoney', 'Cost Basis'),
    mark: col(h, 'MarkPrice', 'Close Price'),
    isin: col(h, 'ISIN'),
    exchange: col(h, 'ListingExchange', 'Exchange'),
  };
  const holdings = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const symbol = norm(r[ix.sym]).toUpperCase();
    const quantity = parseNumber(r[ix.qty]);
    if (!symbol || !quantity) continue;
    let avgCost = ix.costPrice >= 0 ? parseNumber(r[ix.costPrice]) : null;
    const money = ix.costMoney >= 0 ? parseNumber(r[ix.costMoney]) : null;
    if ((!avgCost || avgCost === 0) && money) avgCost = money / quantity;
    const price = ix.mark >= 0 ? parseNumber(r[ix.mark]) : null;
    const name = ix.desc >= 0 ? norm(r[ix.desc]) : '';
    holdings.push(newHolding({
      symbol, name,
      assetClass: classify(ix.asset >= 0 ? r[ix.asset] : '', name, symbol),
      currency: (norm(r[ix.cur]) || 'USD').toUpperCase(),
      quantity: qty(quantity),
      avgCost: avgCost ? Number(avgCost.toFixed(6)) : 0,
      lastPrice: price ? round2(price) : 0,
      lastPriceAt: price ? Date.now() : null,
      priceSource: price ? 'IBKR-Auszug' : 'manuell',
      isin: ix.isin >= 0 ? norm(r[ix.isin]) : '',
      exchange: ix.exchange >= 0 ? norm(r[ix.exchange]) : '',
    }));
  }
  return { holdings, dividends: [], deposits: [], meta: {}, layout: 'Flex Query' };
}

/* ---------------- Öffentliche API ---------------- */

export function parseIbkr(rows) {
  const bySection = parseSectionStatement(rows);
  if (bySection.holdings.length || bySection.dividends.length) return bySection;
  return parseFlatFlex(rows);
}
