// ibkr.js — Auszüge von Interactive Brokers einlesen
// Unterstützt den abschnittsbasierten Activity Statement (CSV) und flache Flex-Query-Exporte.
import { newHolding, newDividend } from './model.js';
import { toISODate, parseNumber, normText, round2 } from './util.js';

/** Anteile werden bei IBKR bruchteilig geführt – auf keinen Fall auf 2 Stellen runden. */
const qty = (n) => Number(Number(n).toFixed(8));

const norm = (v) => String(v ?? '').trim();
const lower = (v) => norm(v).toLowerCase();

/** Erkennt IBKR-Dateien an den typischen Abschnitten bzw. Spalten. */
export function detectIbkr(rows) {
  if (!rows || !rows.length) return false;
  const firstCells = rows.slice(0, 80).map((r) => lower(r?.[0]));
  if (firstCells.some((c) => c === 'open positions' || c === 'statement' || c === 'net asset value')) return true;
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
  stocks: 'aktie', stock: 'aktie', stk: 'aktie', equity: 'aktie',
  etfs: 'etf', etf: 'etf', funds: 'fonds', fund: 'fonds',
  bonds: 'anleihe', bond: 'anleihe', bnd: 'anleihe',
  cash: 'bargeld', forex: 'bargeld',
  crypto: 'krypto', cryptocurrency: 'krypto',
  commodities: 'rohstoff', futures: 'rohstoff',
};

/** ETFs und Aktien lassen sich im Auszug nicht sicher unterscheiden – der Name hilft. */
export function classify(assetCategory, name = '', symbol = '') {
  const base = ASSET_MAP[lower(assetCategory).replace(/[^a-z]/g, '')] || null;
  if (base && base !== 'aktie') return base;
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
  const meta = { baseCurrency: null, accountId: null, accountName: null, period: null };

  const info = secs.get('Statement') || secs.get('Account Information');
  if (info) {
    for (const r of info.rows) {
      const k = lower(r[0]);
      if (k.includes('base currency')) meta.baseCurrency = norm(r[1]).toUpperCase();
      if (k === 'account' || k.includes('account id')) meta.accountId = norm(r[1]);
      if (k === 'name') meta.accountName = norm(r[1]);
      if (k === 'period') meta.period = norm(r[1]);
    }
  }
  const acct = secs.get('Account Information');
  if (acct) {
    for (const r of acct.rows) {
      const k = lower(r[0]);
      if (k.includes('base currency')) meta.baseCurrency = norm(r[1]).toUpperCase();
      if (k === 'account') meta.accountId = norm(r[1]);
    }
  }

  const pos = secs.get('Open Positions');
  if (pos) {
    const h = pos.header;
    const ix = {
      disc: col(h, 'DataDiscriminator'),
      asset: col(h, 'Asset Category'),
      cur: col(h, 'Currency'),
      sym: col(h, 'Symbol'),
      qty: col(h, 'Quantity'),
      costPrice: col(h, 'Cost Price', 'CostBasisPrice'),
      costBasis: col(h, 'Cost Basis', 'CostBasisMoney'),
      close: col(h, 'Close Price', 'MarkPrice'),
      value: col(h, 'Value', 'PositionValue'),
      desc: col(h, 'Description'),
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
      const name = ix.desc >= 0 ? norm(r[ix.desc]) : '';
      holdings.push(newHolding({
        symbol, name,
        assetClass: classify(ix.asset >= 0 ? r[ix.asset] : '', name, symbol),
        currency,
        quantity: qty(quantity),
        avgCost: avgCost ? Number(avgCost.toFixed(6)) : 0,
        lastPrice: price ? round2(price) : 0,
        lastPriceAt: price ? Date.now() : null,
        priceSource: price ? 'IBKR-Auszug' : 'manuell',
      }));
    }
  }

  const div = secs.get('Dividends');
  if (div) {
    const h = div.header;
    const ix = { cur: col(h, 'Currency'), date: col(h, 'Date'), desc: col(h, 'Description'), amount: col(h, 'Amount') };
    for (const r of div.rows) {
      const currency = norm(r[ix.cur]).toUpperCase();
      const date = toISODate(r[ix.date]);
      const amount = parseNumber(r[ix.amount]);
      if (!date || !amount || currency.startsWith('TOTAL')) continue;
      const { symbol, isin } = parseDividendDescription(r[ix.desc]);
      dividends.push(newDividend({
        symbol, isin, date, amount: round2(amount), currency,
        note: norm(r[ix.desc]).slice(0, 120), source: 'IBKR',
      }));
    }
  }

  // Quellensteuer den Dividenden zuordnen (gleiches Datum und Symbol)
  const wh = secs.get('Withholding Tax');
  if (wh) {
    const h = wh.header;
    const ix = { cur: col(h, 'Currency'), date: col(h, 'Date'), desc: col(h, 'Description'), amount: col(h, 'Amount') };
    for (const r of wh.rows) {
      const date = toISODate(r[ix.date]);
      const amount = parseNumber(r[ix.amount]);
      if (!date || !amount) continue;
      const { symbol } = parseDividendDescription(r[ix.desc]);
      const match = dividends.find((d) => d.date === date && d.symbol === symbol);
      if (match) match.withholding = round2(Math.abs(amount));
      else {
        dividends.push(newDividend({
          symbol, date, amount: 0, withholding: round2(Math.abs(amount)),
          currency: norm(r[ix.cur]).toUpperCase(), note: 'Quellensteuer', source: 'IBKR',
        }));
      }
    }
  }

  const dep = secs.get('Deposits & Withdrawals');
  if (dep) {
    const h = dep.header;
    const ix = { cur: col(h, 'Currency'), date: col(h, 'Settle Date', 'Date'), desc: col(h, 'Description'), amount: col(h, 'Amount') };
    for (const r of dep.rows) {
      const date = toISODate(r[ix.date]);
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
