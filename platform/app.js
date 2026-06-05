/* ─────────────────────────────────────────────────────────────
   TRADE INTEL — Unified Market Intelligence
   app.js — all logic for Gap Signal, NFP, and CPI sections
───────────────────────────────────────────────────────────── */

// ── API Keys (from existing .env files) ───────────────────────
// Replace with your own or set via Netlify environment variables
const FRED_KEY = '02a8ca7ded31a46ee848a9d813691a2a';  // NFP + CPI
const EIA_KEY  = 'l5scorAtu74RXwmyO3AoqOtQHolMxruZ7iOxD4Hj'; // CPI oil/gas

// ── FRED helpers ──────────────────────────────────────────────
const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

async function fredObs(series, limit = 3) {
  try {
    const url = `${FRED_BASE}?series_id=${series}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=${limit}`;
    const res  = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return (data.observations || []).filter(o => o.value !== '.').map(o => parseFloat(o.value));
  } catch { return null; }
}

async function fredLatest(series) {
  const obs = await fredObs(series, 3);
  return obs?.length ? obs[0] : null;
}

async function fredMoMPct(series) {
  const obs = await fredObs(series, 3);
  if (!obs || obs.length < 2) return null;
  return Math.round(((obs[0] - obs[1]) / obs[1]) * 10000) / 100;
}

async function fredYoYPct(series) {
  const obs = await fredObs(series, 14);
  if (!obs || obs.length < 13) return null;
  return Math.round(((obs[0] - obs[12]) / obs[12]) * 10000) / 100;
}

// ── EIA helpers ───────────────────────────────────────────────
async function fetchEiaOilPrice() {
  try {
    const url = `https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=${EIA_KEY}&frequency=daily&data[0]=value&sort[0][column]=period&sort[0][direction]=desc&length=1&facets[series][]=RCLC1`;
    const res  = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.response?.data?.[0]?.value ?? null;
  } catch { return null; }
}

async function fetchEiaGasPrice() {
  try {
    const url = `https://api.eia.gov/v2/petroleum/pri/gnd/data/?api_key=${EIA_KEY}&frequency=weekly&data[0]=value&sort[0][column]=period&sort[0][direction]=desc&length=1&facets[product][]=EPM0&facets[duoarea][]=NUS`;
    const res  = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.response?.data?.[0]?.value ?? null;
  } catch { return null; }
}

// ── Live data fetchers ─────────────────────────────────────────

async function fetchNFPLiveData() {
  const [claims, contClaims, jolts, fedRate, umich, confBoard, payems, unrate, ahe, housing] = await Promise.all([
    fredObs('IC4WSA',           3),   // initial claims (k)
    fredObs('CCSA',             3),   // continuing claims (k)
    fredObs('JTSJOL',           3),   // JOLTS openings (thousands)
    fredLatest('FEDFUNDS'),           // fed funds rate
    fredLatest('UMCSENT'),            // UMich sentiment
    fredLatest('CSCICP03USM665S'),    // Conference Board CC
    fredObs('PAYEMS',           3),   // total nonfarm payrolls (thousands)
    fredLatest('UNRATE'),             // unemployment rate
    fredObs('CES0500000003',    3),   // avg hourly earnings ($/hr)
    fredLatest('HOUST'),              // housing starts (thousands)
  ]);

  const prevNfp = payems?.length >= 2
    ? Math.round(payems[0] - payems[1])
    : null;

  const prevAhe = ahe?.length >= 2
    ? Math.round(((ahe[0] - ahe[1]) / ahe[1]) * 10000) / 100
    : null;

  return {
    initialClaims:    claims?.[0]    ? Math.round(claims[0] / 1000)        : null,
    continuingClaims: contClaims?.[0]? Math.round(contClaims[0] / 1000)   : null,
    joltsOpenings:    jolts?.[0]     ? Math.round((jolts[0] / 1000) * 1000) / 1000 : null,
    fedRate,
    umich,
    confBoardCC:      confBoard,
    prevNfp,
    prevUnemployment: unrate,
    prevAhe,
    housingStarts:    housing,
    month:            new Date().getMonth() + 1,
  };
}

async function fetchCPILiveData() {
  const [fedRate, m2YoY, importPricesMoM, wagesYoY, cpiYoY, coreCpiMoM, oil, gas, ppiMoM, inflExp] = await Promise.all([
    fredLatest('FEDFUNDS'),           // fed funds rate
    fredYoYPct('M2SL'),               // M2 money supply YoY
    fredMoMPct('IR'),                 // import price index MoM
    fredYoYPct('CES0500000003'),      // avg hourly earnings YoY
    fredYoYPct('CPIAUCSL'),           // CPI all items YoY (replaces BLS call)
    fredMoMPct('CPILFESL'),           // Core CPI (less food & energy) MoM
    fetchEiaOilPrice(),               // WTI crude ($/bbl)
    fetchEiaGasPrice(),               // US avg retail gas ($/gal)
    fredMoMPct('PPIACO'),             // PPI All Commodities MoM (replaces BLS)
    fredLatest('MICH'),               // UMich inflation expectations
  ]);

  return {
    fedRate,
    m2:          m2YoY,
    importPrices: importPricesMoM,
    wages:       wagesYoY,
    prevCpi:     cpiYoY,
    coreCpiPrev: coreCpiMoM,
    oil,
    gas,
    ppi:         ppiMoM,
    inflExp,
  };
}

// ── Apply live data & update slider UI ────────────────────────

function applyLiveDataToInputs(section, liveData, inputDefs, inputs) {
  let updated = 0;
  Object.entries(liveData).forEach(([key, value]) => {
    if (value === null || value === undefined || isNaN(value)) return;
    inputs[key] = value;
    updated++;
    // Update slider thumb and value label if inputs panel is rendered
    const slider = document.querySelector(`#${section}-input-grid [data-key="${key}"]`);
    const valEl  = document.getElementById(`${section}-iv-${key}`);
    const def    = inputDefs.find(d => d.key === key);
    if (slider) slider.value = value;
    if (valEl && def) valEl.textContent = value + (def.unit || '');
  });
  return updated;
}

function setDataBadge(section, status, detail) {
  const el = document.getElementById(`${section}-data-badge`);
  if (!el) return;
  el.className = `data-badge ${status}`;
  if (status === 'loading') {
    el.innerHTML = '<span class="db-dot"></span> Fetching live data…';
  } else if (status === 'live') {
    el.innerHTML = `<span class="db-dot"></span> Live data · ${detail}`;
  } else {
    el.innerHTML = `⚡ Fallback values · <span style="opacity:.7">set FRED/EIA keys to enable</span>`;
  }
}

let nfpDataLoaded = false;
let cpiDataLoaded = false;

async function loadNFPLiveData() {
  setDataBadge('nfp', 'loading');
  try {
    const data    = await fetchNFPLiveData();
    const updated = applyLiveDataToInputs('nfp', data, NFP_INPUT_DEFS, nfpInputs);
    if (updated > 0) {
      generateNFP(); // recompute with live inputs
      const sources = ['FRED'];
      setDataBadge('nfp', 'live', `${updated} fields · ${sources.join(' + ')}`);
    } else {
      setDataBadge('nfp', 'fallback');
    }
  } catch (e) {
    setDataBadge('nfp', 'fallback');
  }
}

async function loadCPILiveData() {
  setDataBadge('cpi', 'loading');
  try {
    const data    = await fetchCPILiveData();
    const updated = applyLiveDataToInputs('cpi', data, CPI_INPUT_DEFS, cpiInputs);
    if (updated > 0) {
      generateCPI(); // recompute with live inputs
      const sources = ['FRED'];
      if (data.oil !== null || data.gas !== null) sources.push('EIA');
      setDataBadge('cpi', 'live', `${updated} fields · ${sources.join(' + ')}`);
    } else {
      setDataBadge('cpi', 'fallback');
    }
  } catch (e) {
    setDataBadge('cpi', 'fallback');
  }
}

// ── Constants ─────────────────────────────────────────────────

const FOREX = ["EURUSD","GBPUSD","USDJPY","USDCHF","AUDUSD","NZDUSD","USDCAD","EURJPY","GBPJPY","EURGBP","AUDJPY","EURAUD","GBPAUD","EURCAD","CADJPY"];
const INDICES = ["US30","NAS100"];
const COMMODITIES = ["GOLD","OIL"];

const PAIR_NAMES = {
  EURUSD:"Euro / Dollar", GBPUSD:"Pound / Dollar", USDJPY:"Dollar / Yen",
  USDCHF:"Dollar / Franc", AUDUSD:"Aussie / Dollar", NZDUSD:"Kiwi / Dollar",
  USDCAD:"Dollar / Loonie", EURJPY:"Euro / Yen", GBPJPY:"Pound / Yen",
  EURGBP:"Euro / Pound", AUDJPY:"Aussie / Yen", EURAUD:"Euro / Aussie",
  GBPAUD:"Pound / Aussie", EURCAD:"Euro / Loonie", CADJPY:"Loonie / Yen",
  US30:"Dow Jones", NAS100:"Nasdaq 100", GOLD:"Gold / Dollar", OIL:"Crude Oil WTI"
};

const NFP_SEASONAL = {
  1:-55, 2:-15, 3:35, 4:25, 5:45,
  6:15, 7:-25, 8:10, 9:40, 10:50, 11:25, 12:-35
};

const NFP_FALLBACK = {
  adp:155, initialClaims:209, continuingClaims:1786,
  joltsOpenings:7.618, joltsQuits:3.1, challengerCuts:105,
  ismServicesEmp:49.2, ismMfgEmp:45.4, compositePmi:51.3,
  sp500Trend:4.8, nfib:93, confBoardCC:98.9, umich:49.8,
  federalLayoffs:22, govtShutdownRisk:3, tariffImpact:7,
  geopoliticalRisk:5, trumpSentiment:0, immigrationRestriction:8,
  tradeWarSeverity:6, fedRate:3.63, creditSpread:118,
  dxyStrength:-1.8, yieldCurve:-0.15, housingStarts:1465,
  retailSalesTrend:1.4, techLayoffs:14, healthcareHiring:36,
  mfgOrders:0.8, prevNfp:115, prevUnemployment:4.3,
  prevAhe:0.16, month:new Date().getMonth()+1,
  weatherImpact:0, revisionTendency:-0.3
};

const CPI_FALLBACK = {
  oil:82.5, gas:3.42, ppi:0.4, wages:4.1,
  prevCpi:3.5, coreCpiPrev:0.3, fedRate:5.33,
  importPrices:0.4, umichSentiment:69.1, inflExp:3.1,
  nfp:175, m2:2.8
};

const NFP_ASSETS = [
  { asset:'US30',      name:'Dow Jones',        key:'us30Signal',
    rationale:{ Buy:'Strong economy → earnings optimism → cyclical rally', Sell:'Recession fears → revenue guidance cuts', Neutral:'Mixed signals — awaiting Fed clarity' } },
  { asset:'SPX',       name:'S&P 500',           key:'spxSignal',
    rationale:{ Buy:'Broad market rally; financials & industrials lead', Sell:'Growth scare → broad selloff across sectors', Neutral:'In-line print; no shift in Fed narrative' } },
  { asset:'NAS100',    name:'Nasdaq 100',         key:'nasdaqSignal',
    rationale:{ Buy:'Rate cut expectations boost long-duration tech', Sell:'Hot jobs → rate hike fears → P/E compression', Neutral:'Offsetting forces: growth vs rate risk' } },
  { asset:'GOLD',      name:'Gold / XAU',         key:'goldSignal',
    rationale:{ Buy:'Weak jobs → rate cut hopes → lower real yields', Sell:'Hawkish Fed → higher real yields → gold pressured', Neutral:'In-line print → no directional catalyst' } },
  { asset:'DXY',       name:'US Dollar Index',    key:'dxySignal',
    rationale:{ Buy:'Fed hawkish repricing → USD yield advantage', Sell:'Rate cut expectations reduce USD carry', Neutral:'No shift in rate narrative → range-bound' } },
  { asset:'10Y YIELD', name:'US Treasury 10Y',    key:'usTenYSignal',
    rationale:{ Higher:'Strong labor removes Fed pivot justification', Lower:'Rate cut pricing surges → bond rally', Unchanged:'In-line print → no repricing of rates' } },
  { asset:'EUR/USD',   name:'Euro / Dollar',      key:'eurusdSignal',
    rationale:{ Buy:'USD weakens → EUR recovers; ECB hawkishness amplifies', Sell:'USD strength → EUR/USD falls; rate differential widens', Neutral:'No significant USD catalyst' } },
];

const CPI_ASSETS = [
  { asset:'US30',    name:'Dow Jones',         key:'us30Signal',
    rationale:{ Buy:'Soft CPI → rate cut path clears → equity expansion', Sell:'Hot CPI → rate hike fears → P/E compression', Neutral:'In-line CPI → no shift in narrative' } },
  { asset:'GOLD',    name:'Gold / XAU',         key:'goldSignal',
    rationale:{ Buy:'Soft CPI → rate cuts likely → lower real yields', Sell:'Hot CPI + hawkish Fed → higher real yields → gold pressured', Neutral:'Balanced outlook → no catalyst' } },
  { asset:'DXY',     name:'US Dollar Index',    key:null,  // inferred from regime
    rationale:{ Buy:'Hot CPI → Fed stays hawkish → USD supported', Sell:'Soft CPI → rate cuts expected → USD weakens', Neutral:'In-line CPI → no rate narrative change' } },
  { asset:'EUR/USD', name:'Euro / Dollar',      key:null,  // inverse of inferred DXY
    rationale:{ Buy:'USD weakens on soft CPI → EUR recovers', Sell:'USD strengthens on hot CPI → EUR pressured', Neutral:'No significant catalyst' } },
  { asset:'NAS100',  name:'Nasdaq 100',         key:null,  // inferred from regime
    rationale:{ Buy:'Soft CPI → rate cuts → long-duration tech benefits', Sell:'Hot CPI → rates stay higher → tech P/E compression', Neutral:'Neutral CPI → no rate re-pricing' } },
  { asset:'10Y YIELD', name:'US Treasury 10Y',  key:null,  // inferred
    rationale:{ Higher:'Hot CPI → bond sell-off → yields rise to price in hikes', Lower:'Soft CPI → rate cut bets → bond rally → yields fall', Unchanged:'In-line CPI → steady rate expectations' } },
];

// NFP input definitions for slider UI
const NFP_INPUT_DEFS = [
  { key:'adp',                  label:'ADP Employment',      min:50,   max:350,  step:5,    unit:'k' },
  { key:'initialClaims',        label:'Initial Claims',      min:150,  max:400,  step:5,    unit:'k' },
  { key:'ismServicesEmp',       label:'ISM Services Emp.',   min:40,   max:62,   step:0.5,  unit:'' },
  { key:'joltsOpenings',        label:'JOLTS Openings',      min:4,    max:13,   step:0.1,  unit:'M' },
  { key:'federalLayoffs',       label:'Gov/DOGE Layoffs',    min:0,    max:120,  step:1,    unit:'k' },
  { key:'challengerCuts',       label:'Challenger Cuts',     min:0,    max:200,  step:5,    unit:'k' },
  { key:'tariffImpact',         label:'Tariff Impact',       min:0,    max:10,   step:0.5,  unit:'' },
  { key:'trumpSentiment',       label:'Trump Sentiment',     min:-5,   max:5,    step:0.5,  unit:'' },
  { key:'immigrationRestriction',label:'Immigration Restr.', min:0,    max:10,   step:0.5,  unit:'' },
  { key:'geopoliticalRisk',     label:'Geopolitical Risk',   min:0,    max:10,   step:0.5,  unit:'' },
  { key:'prevNfp',              label:'Prev NFP',            min:-50,  max:400,  step:5,    unit:'k' },
  { key:'prevUnemployment',     label:'Prev Unemployment',   min:3,    max:7,    step:0.1,  unit:'%' },
];

const CPI_INPUT_DEFS = [
  { key:'oil',          label:'Oil Price',           min:40,   max:150,  step:1,    unit:'$/bbl' },
  { key:'gas',          label:'Gas Price',           min:2,    max:7,    step:0.05, unit:'$/gal' },
  { key:'ppi',          label:'PPI MoM',             min:-1,   max:3,    step:0.1,  unit:'%' },
  { key:'wages',        label:'Wages YoY',           min:2,    max:8,    step:0.1,  unit:'%' },
  { key:'prevCpi',      label:'Prev CPI YoY',        min:1,    max:7,    step:0.1,  unit:'%' },
  { key:'coreCpiPrev',  label:'Core CPI prev MoM',   min:0,    max:1,    step:0.01, unit:'%' },
  { key:'fedRate',      label:'Fed Rate',            min:0,    max:8,    step:0.25, unit:'%' },
  { key:'importPrices', label:'Import Prices MoM',   min:-2,   max:5,    step:0.1,  unit:'%' },
  { key:'inflExp',      label:'Inflation Exp.',      min:2,    max:7,    step:0.1,  unit:'%' },
  { key:'nfp',          label:'NFP (prev)',          min:-100, max:400,  step:5,    unit:'k' },
  { key:'m2',           label:'M2 Money Supply YoY', min:-5,   max:10,   step:0.1,  unit:'%' },
];

// ── State ──────────────────────────────────────────────────────
let currentSection   = 'gap';
let gapData          = null;
let gapActiveGroup   = 'all';
let gapRecommended   = [];
let gapAvoid         = [];
let gapAllSignals    = {};

let nfpInputs      = { ...NFP_FALLBACK };
let nfpPrediction  = null;
let nfpActiveVtab  = 'signals';
let nfpConsensus   = null;

let cpiInputs      = { ...CPI_FALLBACK };
let cpiPrediction  = null;
let cpiActiveVtab  = 'signals';
let cpiConsensus   = null;

// ── NFP Prediction (ported from TypeScript) ────────────────────
function computeNFP(inputs) {
  const BASE = 165;

  const adpContrib       = (inputs.adp - 150) * 0.85;
  const claimsContrib    = (225 - inputs.initialClaims) * 1.5;
  const ismSvcContrib    = (inputs.ismServicesEmp - 50) * 7.5;
  const ismMfgContrib    = (inputs.ismMfgEmp - 50) * 3.0;
  const joltsContrib     = (inputs.joltsOpenings - 7.5) * 18;
  const nfibNorm         = (inputs.nfib - 95) * 1.0;
  const ccNorm           = (inputs.confBoardCC - 100) * 0.3;
  const umichNorm        = (inputs.umich - 70) * 0.3;
  const sentimentContrib = (nfibNorm + ccNorm + umichNorm) / 3;
  const challengerContrib= -(Math.max(0, inputs.challengerCuts - 40) * 0.45);
  const govContrib       = -Math.abs(inputs.federalLayoffs) * 0.7;
  const tariffContrib    = -(Math.max(0, inputs.tariffImpact - 2) * 3.0) - (Math.max(0, inputs.tradeWarSeverity - 2) * 1.5);
  const trumpContrib     = inputs.trumpSentiment * 4.5;
  const immigContrib     = -(Math.max(0, inputs.immigrationRestriction - 4) * 2.0);
  const rateContrib      = -(Math.max(0, inputs.fedRate - 3.0) * 2.5);
  const spreadContrib    = -(Math.max(0, inputs.creditSpread - 100) * 0.055);
  const yieldContrib     = inputs.yieldCurve < 0 ? inputs.yieldCurve * 5 : 0;
  const finContrib       = rateContrib + spreadContrib + yieldContrib;
  const geoContrib       = -(Math.max(0, inputs.geopoliticalRisk - 3) * 3);
  const housingContrib   = (inputs.housingStarts - 1400) * 0.03;
  const healthContrib    = inputs.healthcareHiring - 30;
  const techContrib      = -(Math.max(0, inputs.techLayoffs - 5) * 1.2);
  const sp500Contrib     = inputs.sp500Trend * 1.5;
  const mfgContrib       = inputs.mfgOrders * 0.5;
  const contClaimsContrib= (1800 - inputs.continuingClaims) * 0.015;

  const components = [
    adpContrib, claimsContrib, ismSvcContrib, ismMfgContrib,
    joltsContrib, sentimentContrib, challengerContrib, govContrib,
    tariffContrib, trumpContrib, immigContrib, finContrib,
    geoContrib, housingContrib, healthContrib, techContrib,
    sp500Contrib, mfgContrib, contClaimsContrib
  ];

  const rawSum  = components.reduce((a, b) => a + b, 0);
  const seasonal = NFP_SEASONAL[inputs.month] ?? 0;
  const weather  = inputs.weatherImpact * 15;
  const revision = inputs.revisionTendency * 10;

  let headline = Math.round(BASE + rawSum * 0.45 + seasonal + weather + revision);
  headline = Math.min(Math.max(headline, -200), 700);

  const unemploymentDelta = -((headline - 150) / 1000) * 0.28;
  const unemployment = Math.round((inputs.prevUnemployment + unemploymentDelta) * 10) / 10;

  const laborTightness = Math.max(0, 4.5 - unemployment) * 0.035;
  const immigWagePush  = inputs.immigrationRestriction * 0.004;
  const aheMoM = Math.round((inputs.prevAhe * 0.55 + laborTightness + immigWagePush + 0.09) * 100) / 100;
  const aheYoY = Math.round((aheMoM * 12 * 0.55 + 2.8) * 10) / 10;
  const lfpr   = Math.round((62.5 + (headline > 150 ? 0.1 : -0.1) - inputs.immigrationRestriction * 0.04) * 10) / 10;

  const uncertaintyBand = 55 + inputs.geopoliticalRisk * 3 + inputs.tariffImpact * 2 + inputs.govtShutdownRisk * 2;
  const bear = Math.round(headline - uncertaintyBand * 0.85);
  const bull = Math.round(headline + uncertaintyBand * 0.65);

  const CONSENSUS = (typeof nfpConsensus === 'number' && nfpConsensus > 0) ? nfpConsensus : 160;
  const direction = headline >= CONSENSUS + 20 ? 'stronger' : headline <= CONSENSUS - 20 ? 'weaker' : 'in-line';

  let regime;
  if      (headline >= 250) regime = 'Hot';
  else if (headline >= 150) regime = 'Solid';
  else if (headline >= 60)  regime = 'Cooling';
  else                      regime = 'Weak';

  let fomcReaction;
  if      (headline >= 250 || aheMoM >= 0.35) fomcReaction = 'Hawkish';
  else if (headline <= 75  || unemployment >= 4.6) fomcReaction = 'Dovish';
  else    fomcReaction = 'Neutral';

  let us30Signal, spxSignal, nasdaqSignal, goldSignal, dxySignal, usTenYSignal, eurusdSignal;

  if (regime === 'Hot') {
    us30Signal='Buy'; spxSignal='Buy'; nasdaqSignal='Neutral';
    goldSignal='Sell'; dxySignal='Buy'; usTenYSignal='Higher'; eurusdSignal='Sell';
  } else if (regime === 'Solid') {
    us30Signal='Buy'; spxSignal='Buy'; nasdaqSignal='Buy';
    goldSignal='Neutral'; dxySignal='Buy'; usTenYSignal='Higher'; eurusdSignal='Sell';
  } else if (regime === 'Cooling') {
    us30Signal='Neutral'; spxSignal='Neutral'; nasdaqSignal='Buy';
    goldSignal='Buy'; dxySignal='Neutral'; usTenYSignal='Unchanged'; eurusdSignal='Neutral';
  } else {
    us30Signal='Sell'; spxSignal='Sell'; nasdaqSignal='Buy';
    goldSignal='Buy'; dxySignal='Sell'; usTenYSignal='Lower'; eurusdSignal='Buy';
  }

  // Stagflation override
  if (headline < 100 && aheMoM >= 0.4) {
    us30Signal='Sell'; spxSignal='Sell'; nasdaqSignal='Sell'; goldSignal='Buy';
  }

  const keySignals  = [adpContrib, claimsContrib, ismSvcContrib, joltsContrib, sentimentContrib];
  const bullishCount = keySignals.filter(s => s > 0).length;
  const alignmentScore = headline > BASE ? bullishCount / 5 : (5 - bullishCount) / 5;
  const spreadPenalty  = Math.abs(headline - BASE) < 30 ? 8 : 0;
  const confidence = Math.round(Math.min(92, Math.max(42, 42 + alignmentScore * 38 + spreadPenalty)));

  const driverDefs = [
    ['ADP Employment',    22, adpContrib],
    ['Jobless Claims',    14, claimsContrib],
    ['ISM Services Emp.', 13, ismSvcContrib],
    ['JOLTS Openings',     8, joltsContrib],
    ['Gov/DOGE Layoffs',   8, govContrib],
    ['Sentiment Composite',6, sentimentContrib],
    ['ISM Mfg. Emp.',      7, ismMfgContrib],
    ['Tariff & Trade War', 5, tariffContrib],
    ['Challenger Cuts',    5, challengerContrib],
    ['Financial Conditions',4,finContrib],
    ['Trump Policy',       3, trumpContrib],
    ['Immigration',        3, immigContrib],
    ['Geopolitical Risk',  2, geoContrib],
    ['Housing Starts',     2, housingContrib],
    ['Healthcare Hiring',  2, healthContrib],
    ['Tech Layoffs',       2, techContrib],
  ];

  const totalAbs = driverDefs.reduce((s, [,,r]) => s + Math.abs(r), 0) || 1;
  const drivers  = driverDefs.map(([name, weight, raw]) => ({
    name, weight, raw: Math.round(raw), bullish: raw >= 0,
    contribution: Math.round((Math.abs(raw) / totalAbs) * 100)
  }));

  return {
    headline, unemployment, aheMoM, aheYoY, lfpr,
    bear, base: headline, bull, direction, confidence,
    regime, fomcReaction,
    us30Signal, spxSignal, nasdaqSignal,
    goldSignal, dxySignal, usTenYSignal, eurusdSignal,
    drivers
  };
}

// ── CPI Prediction (ported from TypeScript) ────────────────────
function computeCPI(inputs) {
  const { oil, gas, ppi, wages, prevCpi, coreCpiPrev, fedRate, importPrices, inflExp, nfp, m2 } = inputs;

  const oilContrib  = Math.max(0, (oil - 75) * 0.008);
  const gasContrib  = Math.max(0, (gas - 3.0) * 0.18);
  const energyScore = (oilContrib + gasContrib) * 0.28;

  const trendScore  = prevCpi * 0.20;
  const ppiScore    = ppi * 0.4 * 0.15;
  const shelterScore= (Math.max(0, 4.5 - fedRate * 0.3) + 0.2) * 0.12;
  const wageScore   = Math.max(0, wages - 3.0) * 0.25 * 0.10;
  const expScore    = inflExp * 0.12 * 0.08;
  const importScore = importPrices * 0.15 * 0.05;
  const m2Score     = Math.max(0, m2 - 2.0) * 0.05 * 0.02;

  let headline = 2.5 + energyScore + trendScore + ppiScore +
    shelterScore + wageScore + expScore + importScore + m2Score;

  headline = Math.min(Math.max(headline, 1.5), 6.5);
  headline = Math.round(headline * 100) / 100;

  const coreMoM = Math.round((coreCpiPrev * 0.6 + (wages > 3 ? (wages - 3) * 0.04 : 0) + 0.15) * 100) / 100;
  const bear    = Math.round((headline - 0.3) * 100) / 100;
  const bull    = Math.round((headline + 0.2) * 100) / 100;

  const prevDiff  = headline - prevCpi;
  const direction = prevDiff > 0.1 ? 'higher' : prevDiff < -0.1 ? 'lower' : 'in-line';
  const stagflation = headline >= 3.7 && nfp < 100;

  let us30Signal, goldSignal;
  if (stagflation) {
    us30Signal = 'Sell'; goldSignal = 'Buy';
  } else if (headline >= 3.7 || coreMoM >= 0.35) {
    us30Signal = 'Sell'; goldSignal = 'Sell';
  } else if (headline <= 3.2) {
    us30Signal = 'Buy'; goldSignal = 'Buy';
  } else {
    us30Signal = 'Neutral'; goldSignal = 'Neutral';
  }

  let regime;
  if      (headline >= 3.7) regime = 'Hot';
  else if (headline <= 3.2) regime = 'Soft';
  else                      regime = 'Neutral';

  const scores = [energyScore, trendScore, ppiScore, shelterScore, wageScore, expScore, importScore, m2Score];
  const totalScore = scores.reduce((a, b) => a + b, 0);

  const driverNames   = ['Energy / Oil','CPI Trend','PPI Passthrough','Shelter / OER','Wages / Labor','Inflation Expectations','Import Prices','M2 Money Supply'];
  const driverWeights = [28, 20, 15, 12, 10, 8, 5, 2];

  const drivers = driverNames.map((name, i) => ({
    name,
    contribution: totalScore > 0 ? Math.round((scores[i] / totalScore) * 100) : driverWeights[i],
    weight: driverWeights[i],
    bullish: scores[i] > 0
  }));

  const maxScore = 6.5 - 2.5;
  const normalizedScore     = (headline - 2.5) / maxScore;
  const componentAgreement  = 1 - (Math.max(...scores) - Math.min(...scores)) / (Math.max(...scores) + 0.01);
  const confidence = Math.round(Math.min(95, Math.max(40, (normalizedScore * 30 + componentAgreement * 40 + 50))) * 10) / 10;

  return { headline, coreMoM, bear, base: headline, bull, us30Signal, goldSignal, direction, confidence, regime, stagflation, drivers };
}

// ── Helpers ────────────────────────────────────────────────────

function groupOf(a) {
  if (FOREX.includes(a))       return 'forex';
  if (INDICES.includes(a))     return 'indices';
  return 'commodities';
}

function confClass(c)  { return c >= 70 ? 'high' : c >= 55 ? 'mid' : 'low'; }
function confTier(c)   { return c >= 70 ? 'tier-high' : c >= 55 ? 'tier-mid' : ''; }
function tierLabel(c)  { return c >= 70 ? 'HIGH CONF' : c >= 55 ? 'MED CONF' : 'LOW CONF'; }
function dirArrow(d)   {
  if (d === 'Buy'   || d === 'BUY')   return '↑';
  if (d === 'Sell'  || d === 'SELL')  return '↓';
  if (d === 'Higher')                  return '↑';
  if (d === 'Lower')                   return '↓';
  return '→';
}

function signalClass(s) {
  if (s === 'Buy' || s === 'BUY' || s === 'Higher' || s === 'Dovish') return 'BUY';
  if (s === 'Sell'|| s === 'SELL'|| s === 'Lower'  || s === 'Hawkish') return 'SELL';
  return 'NEUTRAL';
}

function regimeBadgeClass(regime) {
  const m = { Hot:'hot', Solid:'soft', Cooling:'warn', Weak:'', Neutral:'warn', Soft:'soft' };
  return m[regime] || '';
}

function fomcBadgeClass(fomc) {
  return fomc === 'Hawkish' ? 'hawk' : fomc === 'Dovish' ? 'dove' : '';
}

function ageStr(h) {
  if (h < 1)  return '<1h ago';
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h/24)}d ago`;
}

// ── News Filtering ─────────────────────────────────────────────

const NFP_KEYWORDS      = ['jobs','payroll','labour','labor','employment','unemployment','nonfarm','nfp','hiring','layoff','wages','salary','worker','job','workforce','jobless'];
const CPI_KEYWORDS      = ['inflation','cpi','consumer price','fed','fomc','rate','energy','oil','gas','price index','monetary','tariff','ppi','hawkish','dovish','rate hike','rate cut'];
const GEO_KEYWORDS      = ['war','conflict','geopolit','ceasefire','iran','russia','ukraine','china','taiwan','sanction','missile','military','nato','middle east','terror'];
const MARKETS_KEYWORDS  = ['stock','equity','s&p','nasdaq','dow','rally','selloff','sell-off','yield','bond','dollar','euro','yen','gold','crude','bitcoin','crypto','market'];

function articleText(a) { return ((a.title || '') + ' ' + (a.summary || '')).toLowerCase(); }

function filterNews(articles, keywords) {
  return articles.filter(a => keywords.some(kw => articleText(a).includes(kw)));
}

function getGapArticles() {
  return gapData ? (gapData.news_articles || []) : [];
}

// ── Gap Signal Rendering ───────────────────────────────────────

async function loadGapData() {
  // Try platform/data/ copy first (Netlify), fall back to local dev path
  const DATA_PATHS = ['data/latest.json', '../gap_signals/dashboard/data/latest.json'];
  let data = null;
  for (const path of DATA_PATHS) {
    try {
      const res = await fetch(path + '?t=' + Date.now());
      if (res.ok) { data = await res.json(); break; }
    } catch { continue; }
  }

  if (!data) {
    document.getElementById('gap-page-sub').textContent = 'Could not load gap signal data — run python3 main.py --save';
    document.getElementById('gap-alert-bar').className  = 'alert-bar neutral';
    document.getElementById('gap-alert-text').textContent = 'No data — run python3 /Users/Aryan/BBS/gap_signals/main.py --save to generate signals';
    return;
  }

  gapData        = data;
  gapAllSignals  = data.signals || {};
  gapRecommended = data.recommended_assets || [];
  gapAvoid       = data.assets_to_avoid || [];

  applyGapToSidebar(data);
  renderGapStats(data);
  renderGapTable();
  renderGapPicks();
  renderGapMacro(data);
  renderGapNews(data.news_articles || []);

  if (nfpPrediction) renderNFPNews();
  if (cpiPrediction) renderCPINews();
  renderMainNews();

  const raw = data.generated_at || '';
  const dt  = raw ? new Date(raw).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }) : '—';
  document.getElementById('sidebar-time').textContent = dt;
  document.getElementById('sidebar-meta').textContent = 'Gap data: ' + (raw
    ? new Date(raw).toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', year:'numeric' })
    : '—');
  document.getElementById('sidebar-theme').textContent = (data.macro_theme || '').slice(0, 110) + '…';

  const buys  = Object.values(gapAllSignals).filter(s => s.direction === 'BUY').length;
  const sells = Object.values(gapAllSignals).filter(s => s.direction === 'SELL').length;
  document.getElementById('nav-gap-badge').textContent = `${buys}B ${sells}S`;

  // Update gap sub-nav badges
  const articleCount = (data.news_articles || []).length;
  const buyCountEl   = document.getElementById('gap-nav-buy-count');
  const newsCountEl  = document.getElementById('gap-nav-news-count');
  if (buyCountEl) buyCountEl.textContent = `${buys}B ${sells}S`;
  if (newsCountEl) {
    newsCountEl.textContent = articleCount;
    newsCountEl.style.background = articleCount ? 'var(--purple-bg)' : 'var(--muted-bg)';
    newsCountEl.style.color      = articleCount ? 'var(--purple)'    : 'var(--muted)';
  }
}

function applyGapToSidebar(data) {
  const trump = data.trump_risk_level || 'LOW';
  const geo   = data.geopolitical_risk || 'LOW';
  const sbT   = document.getElementById('sb-trump');
  sbT.textContent = trump; sbT.className = `risk-val risk-${trump}`;
  const sbG   = document.getElementById('sb-geo');
  sbG.textContent = geo; sbG.className = `risk-val risk-${geo}`;
}

function renderGapStats(data) {
  const sigs  = Object.values(gapAllSignals);
  const dirs  = sigs.map(s => s.direction);
  const buys  = dirs.filter(d => d === 'BUY').length;
  const sells = dirs.filter(d => d === 'SELL').length;
  const bias  = buys > sells + 2 ? 'BULLISH' : sells > buys + 2 ? 'BEARISH' : 'MIXED';
  const biasColor = { BULLISH:'var(--green)', BEARISH:'var(--red)', MIXED:'var(--yellow)' };

  const biasEl = document.getElementById('gap-stat-bias');
  biasEl.textContent = bias; biasEl.style.color = biasColor[bias] || '';
  document.getElementById('gap-stat-bias-sub').textContent = `${buys} buy · ${sells} sell`;

  const strongest = Object.entries(gapAllSignals).sort((a,b) => (b[1].confidence||0) - (a[1].confidence||0))[0];
  if (strongest) {
    const [name, sig] = strongest;
    document.getElementById('gap-stat-strongest').textContent = name;
    document.getElementById('gap-stat-strongest-sub').textContent = `${sig.direction} · ${sig.confidence}% confidence`;
  }

  const trump = data.trump_risk_level || 'LOW';
  const geo   = data.geopolitical_risk || 'LOW';
  const riskScore = { NONE:0, LOW:1, MEDIUM:2, HIGH:3, EXTREME:4 };
  const maxRisk   = Math.max(riskScore[trump] || 0, riskScore[geo] || 0);
  const labels    = ['LOW','LOW','MEDIUM','HIGH','EXTREME'];
  const riskLabel = labels[maxRisk] || 'LOW';
  const riskEl    = document.getElementById('gap-stat-risk');
  riskEl.textContent = riskLabel; riskEl.className = `stat-value risk-${riskLabel}`;

  const contCount = sigs.filter(s => s.gap_type === 'CONTINUATION').length;
  const total     = sigs.length || 1;
  const contPct   = Math.round(contCount / total * 100);
  document.getElementById('gap-stat-gap').textContent = contPct + '%';
  document.getElementById('gap-stat-gap-sub').textContent = `${contCount} continuation signals`;

  const raw = data.generated_at || '';
  const dt  = raw ? new Date(raw).toLocaleString('en-GB', { weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : '—';
  document.getElementById('gap-page-sub').textContent = `Last updated: ${dt} UTC · ${Object.keys(gapAllSignals).length} assets analysed`;

  const alertBar  = document.getElementById('gap-alert-bar');
  const alertText = document.getElementById('gap-alert-text');
  if (maxRisk >= 3) {
    alertBar.className = 'alert-bar danger';
    alertText.textContent = `High risk environment — ${geo} geopolitical risk + Trump ${trump}. Expect large continuation gaps.`;
  } else if (maxRisk === 2) {
    alertBar.className = 'alert-bar warn';
    alertText.textContent = `Elevated risk this weekend. Watch for gap continuation on high-conviction signals.`;
  } else {
    alertBar.className = 'alert-bar good';
    alertText.textContent = `No major alerts. Quiet weekend expected — gap fill bias elevated across most pairs.`;
  }
}

function renderGapTable() {
  const tbody = document.getElementById('gap-signal-tbody');
  tbody.innerHTML = '';
  const order = [...FOREX, ...INDICES, ...COMMODITIES];

  order.forEach(asset => {
    const sig = gapAllSignals[asset];
    if (!sig) return;

    const dir     = sig.direction || 'NEUTRAL';
    const conf    = sig.confidence || 0;
    const gapType = sig.gap_type || 'UNCERTAIN';
    const isStar  = gapRecommended.includes(asset);
    const grp     = groupOf(asset);

    if (gapActiveGroup === 'forex'       && grp !== 'forex')       return;
    if (gapActiveGroup === 'indices'     && grp !== 'indices')      return;
    if (gapActiveGroup === 'commodities' && grp !== 'commodities')  return;
    if (gapActiveGroup === 'buy'  && dir !== 'BUY')                 return;
    if (gapActiveGroup === 'sell' && dir !== 'SELL')                return;
    if (gapActiveGroup === 'high' && conf < 65)                     return;

    const cc = confClass(conf); const ct = confTier(conf); const tl = tierLabel(conf);
    const da = dir === 'BUY' ? '↑' : dir === 'SELL' ? '↓' : '→';
    const gc = gapType === 'CONTINUATION' ? 'cont' : gapType === 'FILL' ? 'fill' : '';
    const driver = (sig.key_drivers || [])[0] || '—';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="inst-name">${asset}${isStar ? '<span class="star-tag">★</span>' : ''}</div>
        <div class="inst-sub">${PAIR_NAMES[asset] || ''}</div>
      </td>
      <td><span class="dir-badge dir-${dir}">${da} ${dir}</span></td>
      <td>
        <div class="conv-wrap">
          <span class="conv-label">STRENGTH</span>
          <div class="conv-track"><div class="conv-fill fill-${dir}" style="width:0%" data-w="${conf}"></div></div>
        </div>
      </td>
      <td>
        <div class="conf-wrap">
          <span class="conf-pct ${cc}">${conf}%</span>
          <span class="conf-tier ${ct}">${tl}</span>
        </div>
      </td>
      <td><span class="gap-badge ${gc}">${gapType}</span></td>
      <td><span class="driver-pill" title="${driver}">${driver}</span></td>
      <td><span class="chevron">›</span></td>
    `;
    tr.onclick = () => openDetailModal(asset);
    tbody.appendChild(tr);
  });

  requestAnimationFrame(() => {
    document.querySelectorAll('#gap-signal-tbody .conv-fill').forEach(el => {
      el.style.width = el.dataset.w + '%';
    });
  });
}

function renderGapPicks() {
  const grid = document.getElementById('gap-picks-grid');
  grid.innerHTML = '';
  const featured = [...gapRecommended, ...Object.keys(gapAllSignals).filter(a => !gapAvoid.includes(a) && !gapRecommended.includes(a))];

  featured.slice(0, 6).forEach(asset => {
    const sig = gapAllSignals[asset]; if (!sig) return;
    const dir  = sig.direction || 'NEUTRAL';
    const conf = sig.confidence || 0;
    const dirColor = dir === 'BUY' ? 'var(--green)' : dir === 'SELL' ? 'var(--red)' : 'var(--muted)';
    const isStar   = gapRecommended.includes(asset);
    const card     = document.createElement('div');
    card.className = 'picks-card';
    card.innerHTML = `
      <div class="picks-card-asset" style="color:${dirColor}">${asset}${isStar ? ' ★' : ''}</div>
      <div class="picks-card-dir" style="color:${dirColor}">${dir} · ${conf}% confidence · ${sig.gap_type}</div>
      <div class="picks-card-bias">${sig.trade_bias || '—'}</div>
    `;
    card.onclick = () => openDetailModal(asset);
    grid.appendChild(card);
  });
}

function renderGapMacro(data) {
  document.getElementById('gap-macro-text').textContent = data.macro_theme || '—';

  const grid = document.getElementById('gap-macro-grid');
  grid.innerHTML = '';
  const sigs    = Object.values(gapAllSignals);
  const avgConf = Math.round(sigs.reduce((a,s) => a + (s.confidence||0), 0) / (sigs.length||1));
  const contCnt = sigs.filter(s => s.gap_type === 'CONTINUATION').length;

  [
    { label:'Avg Confidence',       val: avgConf + '%',              sub:'Across all signals' },
    { label:'Continuation Signals', val: contCnt,                   sub:'Gap continuation bias' },
    { label:'Best Setup',           val: gapRecommended[0] || '—',  sub: gapAllSignals[gapRecommended[0]]?.direction || '' },
    { label:'Avoid',                val: gapAvoid[0] || '—',        sub:'Conflicted signals' },
  ].forEach(({ label, val, sub }) => {
    const el = document.createElement('div');
    el.className = 'macro-item';
    el.innerHTML = `<div class="macro-item-label">${label}</div><div class="macro-item-val">${val}</div><div class="macro-item-sub">${sub}</div>`;
    grid.appendChild(el);
  });
}

function renderGapNews(articles) {
  const feed = document.getElementById('gap-news-feed');
  feed.innerHTML = '';
  const badge = document.getElementById('nav-gap-badge');

  if (!articles.length) {
    feed.innerHTML = `<div class="news-empty">No news articles in this report.<br>Re-run <code>python3 main.py --save</code> to fetch live news.</div>`;
    return;
  }

  articles.forEach(a => {
    const el = document.createElement('a');
    el.className = 'news-item';
    el.href = a.url || '#'; el.target = '_blank'; el.rel = 'noopener';
    el.innerHTML = `
      <div>
        <div class="news-source">${a.source}</div>
        <div class="news-title">${a.title}</div>
        <div class="news-summary">${a.summary || ''}</div>
      </div>
      <div class="news-age">${ageStr(a.age_hours)}</div>
    `;
    feed.appendChild(el);
  });
}

// ── Detail Modal (Gap Signal) ──────────────────────────────────

function openDetailModal(asset) {
  const sig = gapAllSignals[asset]; if (!sig) return;
  const dir  = sig.direction || 'NEUTRAL';
  const conf = sig.confidence || 0;
  const dirColor = dir === 'BUY' ? '#22c55e' : dir === 'SELL' ? '#ef4444' : '#6b7280';

  document.getElementById('modal-header-bar').style.background = dirColor;
  const ma = document.getElementById('modal-asset');
  ma.textContent = asset + (gapRecommended.includes(asset) ? ' ★' : '');
  ma.style.color = dirColor;

  const gc = sig.gap_type === 'CONTINUATION' ? 'cont' : sig.gap_type === 'FILL' ? 'fill' : '';
  document.getElementById('modal-top-badges').innerHTML = `
    <span class="dir-badge dir-${dir}" style="font-size:13px">${dir} ${conf}%</span>
    <span class="gap-badge ${gc}" style="font-size:11px">${sig.gap_type}</span>
    <span style="font-size:11px;color:var(--muted)">${sig.expected_gap_size || ''}</span>
  `;
  document.getElementById('modal-bias').textContent = sig.trade_bias || '—';

  const dl = document.getElementById('modal-drivers'); dl.innerHTML = '';
  (sig.key_drivers || []).forEach(d => { const li = document.createElement('li'); li.textContent = d; dl.appendChild(li); });
  const rl = document.getElementById('modal-risks'); rl.innerHTML = '';
  (sig.risks || []).forEach(r => { const li = document.createElement('li'); li.textContent = r; rl.appendChild(li); });

  document.getElementById('modal-overlay').classList.add('open');
}

// ── NFP Rendering ──────────────────────────────────────────────

function generateNFP() {
  nfpPrediction = computeNFP(nfpInputs);
  renderNFPStats();
  renderNFPSignalTable();
  renderNFPForecast();
  renderNFPDrivers();
  renderNFPNews();
  updateSidebarForSection();
  updateNFPConsensusDisplay();
}

function renderNFPStats() {
  const p = nfpPrediction; if (!p) return;

  const headlineEl = document.getElementById('nfp-stat-headline');
  headlineEl.textContent = p.headline + 'k';
  headlineEl.className   = 'stat-value highlight';

  const dirColor = p.direction === 'stronger' ? 'var(--green)' : p.direction === 'weaker' ? 'var(--red)' : 'var(--cyan)';
  const dirArr   = p.direction === 'stronger' ? '↑' : p.direction === 'weaker' ? '↓' : '→';
  document.getElementById('nfp-stat-headline-sub').textContent = `${dirArr} vs consensus (${p.direction})`;
  document.getElementById('nfp-stat-headline-sub').style.color = dirColor;

  const regEl = document.getElementById('nfp-stat-regime');
  regEl.textContent = p.regime;
  regEl.className   = `stat-value regime-${p.regime.toLowerCase()}`;
  document.getElementById('nfp-stat-regime-sub').textContent = `Bear ${p.bear}k · Bull ${p.bull}k`;

  const fomcEl = document.getElementById('nfp-stat-fomc');
  fomcEl.textContent = p.fomcReaction;
  fomcEl.className   = `stat-value fomc-${p.fomcReaction.toLowerCase()}`;

  const confEl = document.getElementById('nfp-stat-conf');
  confEl.textContent = p.confidence + '%';
  confEl.className   = `stat-value ${confClass(p.confidence) === 'high' ? 'regime-solid' : confClass(p.confidence) === 'mid' ? 'regime-neutral' : 'regime-weak'}`;

  document.getElementById('nfp-page-sub').textContent =
    `Model output: ${p.headline}k NFP · ${p.regime} regime · ${p.confidence}% confidence`;

  const ab = document.getElementById('nfp-alert-bar');
  const at = document.getElementById('nfp-alert-text');
  if (p.regime === 'Hot') {
    ab.className = 'alert-bar danger';
    at.textContent = `Hot labor market — ${p.headline}k forecast. ${p.fomcReaction} FOMC expected. AHE MoM: +${p.aheMoM}%`;
  } else if (p.regime === 'Solid') {
    ab.className = 'alert-bar good';
    at.textContent = `Solid labor market — ${p.headline}k forecast. Fed likely ${p.fomcReaction}. Bear/Bull range: ${p.bear}k–${p.bull}k`;
  } else if (p.regime === 'Cooling') {
    ab.className = 'alert-bar warn';
    at.textContent = `Cooling labor market — ${p.headline}k forecast. Rate cut path possible. FOMC: ${p.fomcReaction}`;
  } else {
    ab.className = 'alert-bar danger';
    at.textContent = `Weak labor market — ${p.headline}k forecast. Recession risk elevated. Expect Dovish Fed pivot.`;
  }

  document.getElementById('nav-nfp-badge').textContent = p.headline + 'k';
}

function renderNFPSignalTable() {
  const p = nfpPrediction;
  const tbody = document.getElementById('nfp-signal-tbody');
  tbody.innerHTML = '';
  if (!p) return;

  const conf = p.confidence;
  const cc   = confClass(conf); const ct = confTier(conf); const tl = tierLabel(conf);

  NFP_ASSETS.forEach(({ asset, name, key }) => {
    const signal  = key ? p[key] : null;
    if (!signal) return;
    const sc  = signalClass(signal);
    const da  = dirArrow(signal);
    const rat = (NFP_ASSETS.find(a => a.asset === asset)?.rationale || {})[signal] || '—';

    // Context badge
    let ctxClass = '', ctxLabel = '';
    if (asset === 'US30' || asset === 'SPX') {
      ctxClass = regimeBadgeClass(p.regime); ctxLabel = p.regime + ' LABOR';
    } else if (asset === 'GOLD' || asset === '10Y YIELD') {
      ctxClass = fomcBadgeClass(p.fomcReaction); ctxLabel = p.fomcReaction + ' FED';
    } else if (asset === 'DXY' || asset === 'EUR/USD') {
      ctxClass = fomcBadgeClass(p.fomcReaction); ctxLabel = 'FOMC: ' + p.fomcReaction;
    } else {
      ctxClass = regimeBadgeClass(p.regime); ctxLabel = p.regime;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="inst-name">${asset}</div>
        <div class="inst-sub">${name}</div>
      </td>
      <td><span class="dir-badge dir-${sc}">${da} ${signal}</span></td>
      <td>
        <div class="conv-wrap">
          <span class="conv-label">STRENGTH</span>
          <div class="conv-track"><div class="conv-fill fill-${sc}" style="width:0%" data-w="${conf}"></div></div>
        </div>
      </td>
      <td>
        <div class="conf-wrap">
          <span class="conf-pct ${cc}">${conf}%</span>
          <span class="conf-tier ${ct}">${tl}</span>
        </div>
      </td>
      <td><span class="gap-badge ${ctxClass}">${ctxLabel}</span></td>
      <td><span class="driver-pill" title="${rat}">${rat}</span></td>
      <td><span class="chevron">›</span></td>
    `;
    tr.onclick = () => openNFPAssetModal(asset, name, signal, rat, p);
    tbody.appendChild(tr);
  });

  requestAnimationFrame(() => {
    document.querySelectorAll('#nfp-signal-tbody .conv-fill').forEach(el => {
      el.style.width = el.dataset.w + '%';
    });
  });
}

function renderNFPForecast() {
  const p = nfpPrediction; if (!p) return;
  const container = document.getElementById('nfp-forecast-content');
  const dirColor  = p.direction === 'stronger' ? 'var(--green)' : p.direction === 'weaker' ? 'var(--red)' : 'var(--cyan)';

  container.innerHTML = `
    <div class="forecast-grid">
      <div class="forecast-card">
        <div class="forecast-card-label">NFP HEADLINE</div>
        <div class="forecast-card-val" style="color:var(--cyan)">${p.headline}k</div>
        <div class="forecast-card-sub" style="color:${dirColor}">${p.direction} than consensus</div>
      </div>
      <div class="forecast-card">
        <div class="forecast-card-label">UNEMPLOYMENT</div>
        <div class="forecast-card-val">${p.unemployment}%</div>
        <div class="forecast-card-sub">Rate estimate</div>
      </div>
      <div class="forecast-card">
        <div class="forecast-card-label">AHE MoM</div>
        <div class="forecast-card-val">${p.aheMoM > 0 ? '+' : ''}${p.aheMoM}%</div>
        <div class="forecast-card-sub">Avg hourly earnings</div>
      </div>
      <div class="forecast-card">
        <div class="forecast-card-label">AHE YoY</div>
        <div class="forecast-card-val">${p.aheYoY}%</div>
        <div class="forecast-card-sub">Annual wage growth</div>
      </div>
      <div class="forecast-card">
        <div class="forecast-card-label">LFPR</div>
        <div class="forecast-card-val">${p.lfpr}%</div>
        <div class="forecast-card-sub">Labor force participation</div>
      </div>
      <div class="forecast-card">
        <div class="forecast-card-label">CONFIDENCE</div>
        <div class="forecast-card-val" style="color:var(--${confClass(p.confidence) === 'high' ? 'green' : confClass(p.confidence) === 'mid' ? 'yellow' : 'red'})">${p.confidence}%</div>
        <div class="forecast-card-sub">Model alignment</div>
      </div>
    </div>
    <div class="scenario-card">
      <div class="scenario-card-label">SCENARIO RANGE</div>
      <div class="scenario-range">
        <div class="scenario-col">
          <div class="scenario-val bear">${p.bear}k</div>
          <div class="scenario-lbl">Bear</div>
        </div>
        <div class="scenario-connector"></div>
        <div class="scenario-col">
          <div class="scenario-val base">${p.base}k</div>
          <div class="scenario-lbl">Base</div>
        </div>
        <div class="scenario-connector"></div>
        <div class="scenario-col">
          <div class="scenario-val bull">${p.bull}k</div>
          <div class="scenario-lbl">Bull</div>
        </div>
      </div>
    </div>
    <div class="macro-card">
      <div class="macro-card-label">FOMC INTERPRETATION</div>
      <div class="macro-card-text">
        ${p.fomcReaction === 'Hawkish'
          ? `A ${p.headline}k print would be hawkish for the Fed — strong labor market removes justification for rate cuts. AHE MoM of ${p.aheMoM}% keeps wage inflation elevated. Expect USD strength and equity pressure on rate-sensitive sectors.`
          : p.fomcReaction === 'Dovish'
          ? `A ${p.headline}k print would be dovish — weak labor market increases pressure on the Fed to cut rates. Unemployment at ${p.unemployment}% signals slack. Expect USD weakness, gold bid, and tech outperformance.`
          : `A ${p.headline}k print is neutral — the Fed is unlikely to shift its current policy stance. Steady unemployment at ${p.unemployment}% with AHE MoM of ${p.aheMoM}% keeps the Fed on hold.`
        }
      </div>
    </div>
  `;
}

function renderNFPInputs() {
  const container = document.getElementById('nfp-inputs-content');
  container.innerHTML = `
    <div class="inputs-note">
      Adjust the 12 highest-impact inputs below. All other variables stay at calibrated defaults.
      Changes take effect when you click <strong>▶ Generate Signal</strong>.
    </div>
    <div class="input-grid" id="nfp-input-grid"></div>
  `;
  const grid = document.getElementById('nfp-input-grid');

  NFP_INPUT_DEFS.forEach(({ key, label, min, max, step, unit }) => {
    const val  = nfpInputs[key];
    const panel = document.createElement('div');
    panel.className = 'input-panel';
    panel.innerHTML = `
      <div class="input-panel-header">
        <span class="input-label">${label}</span>
        <span class="input-val" id="nfp-iv-${key}">${val}${unit}</span>
      </div>
      <input type="range" class="input-slider" min="${min}" max="${max}" step="${step}" value="${val}" data-key="${key}" data-unit="${unit}">
    `;
    grid.appendChild(panel);
  });

  grid.addEventListener('input', e => {
    if (e.target.tagName !== 'INPUT') return;
    const key  = e.target.dataset.key;
    const unit = e.target.dataset.unit || '';
    const v    = parseFloat(e.target.value);
    nfpInputs[key] = v;
    const el = document.getElementById(`nfp-iv-${key}`);
    if (el) el.textContent = v + unit;
  });
}

function renderNFPDrivers() {
  const p = nfpPrediction; if (!p) return;
  const container = document.getElementById('nfp-drivers-content');
  container.innerHTML = '<div class="driver-wrap"><div class="driver-list" id="nfp-driver-list"></div></div>';
  const list = document.getElementById('nfp-driver-list');

  p.drivers.forEach(d => {
    const isBull = d.bullish;
    const cls    = isBull ? 'bull' : 'bear';
    const item   = document.createElement('div');
    item.className = 'driver-item';
    item.innerHTML = `
      <div class="driver-name">${d.name}</div>
      <div class="driver-track"><div class="driver-fill ${cls}" style="width:0%" data-w="${d.contribution}"></div></div>
      <div class="driver-pct ${cls}">${d.contribution}%</div>
      <div class="driver-arrow ${cls}">${isBull ? '↑' : '↓'}</div>
    `;
    list.appendChild(item);
  });

  requestAnimationFrame(() => {
    document.querySelectorAll('#nfp-driver-list .driver-fill').forEach(el => {
      el.style.width = el.dataset.w + '%';
    });
  });
}

function renderNFPNews() {
  const feed     = document.getElementById('nfp-news-feed');
  const articles = filterNews(getGapArticles(), NFP_KEYWORDS);

  feed.innerHTML = '';
  document.getElementById('nav-nfp-badge').dataset.news = articles.length;

  if (!articles.length) {
    feed.innerHTML = `<div class="news-empty">No labor/employment news found in the current Gap Signal data.<br>Run <code>python3 main.py --save</code> to refresh news.</div>`;
    return;
  }

  articles.forEach(a => {
    const el = document.createElement('a');
    el.className = 'news-item';
    el.href = a.url || '#'; el.target = '_blank'; el.rel = 'noopener';
    el.innerHTML = `
      <div>
        <div class="news-source">${a.source}</div>
        <div class="news-title">${a.title}</div>
        <div class="news-summary">${a.summary || ''}</div>
      </div>
      <div class="news-age">${ageStr(a.age_hours)}</div>
    `;
    feed.appendChild(el);
  });
}

// ── CPI Rendering ──────────────────────────────────────────────

function generateCPI() {
  cpiPrediction = computeCPI(cpiInputs);
  renderCPIStats();
  renderCPISignalTable();
  renderCPIForecast();
  renderCPIDrivers();
  renderCPINews();
  updateSidebarForSection();
  updateCPIConsensusDisplay();
}

function renderCPIStats() {
  const p = cpiPrediction; if (!p) return;

  const headlineEl = document.getElementById('cpi-stat-headline');
  headlineEl.textContent = p.headline + '%';
  headlineEl.className   = 'stat-value highlight';

  const dirColor = p.direction === 'higher' ? 'var(--red)' : p.direction === 'lower' ? 'var(--green)' : 'var(--cyan)';
  const dirArr   = p.direction === 'higher' ? '↑' : p.direction === 'lower' ? '↓' : '→';
  document.getElementById('cpi-stat-headline-sub').textContent = `${dirArr} vs prev (${p.direction})`;
  document.getElementById('cpi-stat-headline-sub').style.color = dirColor;

  const coreEl = document.getElementById('cpi-stat-core');
  coreEl.textContent = '+' + p.coreMoM + '%';
  coreEl.className   = `stat-value ${p.coreMoM >= 0.35 ? 'fomc-hawkish' : p.coreMoM <= 0.2 ? 'regime-solid' : 'regime-neutral'}`;

  const regEl = document.getElementById('cpi-stat-regime');
  regEl.textContent = p.regime;
  regEl.className   = `stat-value regime-${p.regime.toLowerCase()}`;
  document.getElementById('cpi-stat-regime-sub').textContent = `Bear ${p.bear}% · Bull ${p.bull}%` + (p.stagflation ? ' · ⚠ Stagflation' : '');

  const confEl = document.getElementById('cpi-stat-conf');
  confEl.textContent = p.confidence + '%';
  confEl.className   = `stat-value ${confClass(p.confidence) === 'high' ? 'regime-solid' : confClass(p.confidence) === 'mid' ? 'regime-neutral' : 'regime-weak'}`;

  document.getElementById('cpi-page-sub').textContent =
    `Model output: ${p.headline}% CPI YoY · ${p.regime} regime · Core MoM ${p.coreMoM}%`;

  const ab = document.getElementById('cpi-alert-bar');
  const at = document.getElementById('cpi-alert-text');
  if (p.stagflation) {
    ab.className = 'alert-bar danger';
    at.textContent = `Stagflation signal — hot CPI (${p.headline}%) combined with weak labor market. Gold bullish; equities at risk.`;
  } else if (p.regime === 'Hot') {
    ab.className = 'alert-bar danger';
    at.textContent = `Hot inflation — ${p.headline}% forecast exceeds the Fed target. Rate hike risk elevated. Bear ${p.bear}%–Bull ${p.bull}%`;
  } else if (p.regime === 'Neutral') {
    ab.className = 'alert-bar warn';
    at.textContent = `Neutral inflation — ${p.headline}% forecast. Fed on hold. Core MoM ${p.coreMoM}% in focus for FOMC guidance.`;
  } else {
    ab.className = 'alert-bar good';
    at.textContent = `Soft inflation — ${p.headline}% forecast. Rate cut path clears. Risk assets supportive. Bear ${p.bear}%–Bull ${p.bull}%`;
  }

  document.getElementById('nav-cpi-badge').textContent = p.headline + '%';
}

function renderCPISignalTable() {
  const cp = cpiPrediction; if (!cp) return;
  const tbody = document.getElementById('cpi-signal-tbody');
  tbody.innerHTML = '';

  const conf = Math.round(cp.confidence);
  const cc   = confClass(conf); const ct = confTier(conf); const tl = tierLabel(conf);

  // Infer DXY, EUR/USD, NAS100, 10Y from CPI regime
  const inferredSignals = {
    DXY:      cp.regime === 'Hot' ? 'Buy' : cp.regime === 'Soft' ? 'Sell' : 'Neutral',
    'EUR/USD': cp.regime === 'Hot' ? 'Sell': cp.regime === 'Soft' ? 'Buy' : 'Neutral',
    NAS100:   cp.regime === 'Hot' ? 'Sell': cp.regime === 'Soft' ? 'Buy' : 'Neutral',
    '10Y YIELD': cp.regime === 'Hot' ? 'Higher': cp.regime === 'Soft' ? 'Lower' : 'Unchanged',
  };

  CPI_ASSETS.forEach(({ asset, name, key, rationale }) => {
    const signal = key ? cp[key] : inferredSignals[asset];
    if (!signal) return;
    const sc  = signalClass(signal);
    const da  = dirArrow(signal);
    const rat = (rationale || {})[signal] || '—';

    const ctxClass = regimeBadgeClass(cp.regime);
    const ctxLabel = cp.regime + ' CPI' + (cp.stagflation ? ' ⚠' : '');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="inst-name">${asset}</div>
        <div class="inst-sub">${name}</div>
      </td>
      <td><span class="dir-badge dir-${sc}">${da} ${signal}</span></td>
      <td>
        <div class="conv-wrap">
          <span class="conv-label">STRENGTH</span>
          <div class="conv-track"><div class="conv-fill fill-${sc}" style="width:0%" data-w="${conf}"></div></div>
        </div>
      </td>
      <td>
        <div class="conf-wrap">
          <span class="conf-pct ${cc}">${conf}%</span>
          <span class="conf-tier ${ct}">${tl}</span>
        </div>
      </td>
      <td><span class="gap-badge ${ctxClass}">${ctxLabel}</span></td>
      <td><span class="driver-pill" title="${rat}">${rat}</span></td>
      <td><span class="chevron">›</span></td>
    `;
    tr.onclick = () => openCPIAssetModal(asset, name, signal, rat, cp);
    tbody.appendChild(tr);
  });

  requestAnimationFrame(() => {
    document.querySelectorAll('#cpi-signal-tbody .conv-fill').forEach(el => {
      el.style.width = el.dataset.w + '%';
    });
  });
}

function renderCPIForecast() {
  const p = cpiPrediction; if (!p) return;
  const container = document.getElementById('cpi-forecast-content');
  const dirColor  = p.direction === 'higher' ? 'var(--red)' : p.direction === 'lower' ? 'var(--green)' : 'var(--cyan)';

  container.innerHTML = `
    <div class="forecast-grid">
      <div class="forecast-card">
        <div class="forecast-card-label">CPI YoY</div>
        <div class="forecast-card-val" style="color:var(--cyan)">${p.headline}%</div>
        <div class="forecast-card-sub" style="color:${dirColor}">${p.direction} than previous</div>
      </div>
      <div class="forecast-card">
        <div class="forecast-card-label">CORE MoM</div>
        <div class="forecast-card-val">${p.coreMoM > 0 ? '+' : ''}${p.coreMoM}%</div>
        <div class="forecast-card-sub">Month-over-month core</div>
      </div>
      <div class="forecast-card">
        <div class="forecast-card-label">REGIME</div>
        <div class="forecast-card-val" style="color:var(--${p.regime==='Hot'?'red':p.regime==='Soft'?'green':'yellow'})">${p.regime}</div>
        <div class="forecast-card-sub">Inflation condition</div>
      </div>
      <div class="forecast-card">
        <div class="forecast-card-label">STAGFLATION</div>
        <div class="forecast-card-val" style="color:var(--${p.stagflation?'red':'green'})">${p.stagflation ? 'RISK' : 'NONE'}</div>
        <div class="forecast-card-sub">Hot CPI + weak jobs</div>
      </div>
      <div class="forecast-card">
        <div class="forecast-card-label">CONFIDENCE</div>
        <div class="forecast-card-val" style="color:var(--${confClass(p.confidence)==='high'?'green':confClass(p.confidence)==='mid'?'yellow':'red'})">${p.confidence}%</div>
        <div class="forecast-card-sub">Model alignment</div>
      </div>
    </div>
    <div class="scenario-card">
      <div class="scenario-card-label">SCENARIO RANGE (YoY %)</div>
      <div class="scenario-range">
        <div class="scenario-col">
          <div class="scenario-val bear">${p.bear}%</div>
          <div class="scenario-lbl">Bear</div>
        </div>
        <div class="scenario-connector"></div>
        <div class="scenario-col">
          <div class="scenario-val base">${p.base}%</div>
          <div class="scenario-lbl">Base</div>
        </div>
        <div class="scenario-connector"></div>
        <div class="scenario-col">
          <div class="scenario-val bull">${p.bull}%</div>
          <div class="scenario-lbl">Bull</div>
        </div>
      </div>
    </div>
    <div class="macro-card">
      <div class="macro-card-label">MARKET INTERPRETATION</div>
      <div class="macro-card-text">
        ${p.regime === 'Hot'
          ? `A ${p.headline}% CPI print would be above the Fed's comfort zone. Core MoM of ${p.coreMoM}% is ${p.coreMoM >= 0.35 ? 'uncomfortably high' : 'elevated'}. Expect hawkish Fed guidance, higher yields, and equity pressure. ${p.stagflation ? 'Stagflation risk is elevated — gold is the standout long.' : 'Gold may face selling pressure from rising real yields.'}`
          : p.regime === 'Soft'
          ? `A ${p.headline}% CPI print would be encouraging disinflation progress. The Fed's rate cut path becomes clearer. Risk assets broadly supported; long-duration tech and gold benefit from lower real yield expectations. EUR/USD likely to rally on USD weakness.`
          : `A ${p.headline}% CPI print is broadly in line with expectations. The Fed remains data-dependent with no immediate catalyst for a policy shift. Core MoM of ${p.coreMoM}% will be the key focus — any surprise in core could move the needle.`
        }
      </div>
    </div>
  `;
}

function renderCPIInputs() {
  const container = document.getElementById('cpi-inputs-content');
  container.innerHTML = `
    <div class="inputs-note">
      Adjust all 11 CPI model inputs below. Changes take effect when you click <strong>▶ Generate Signal</strong>.
    </div>
    <div class="input-grid" id="cpi-input-grid"></div>
  `;
  const grid = document.getElementById('cpi-input-grid');

  CPI_INPUT_DEFS.forEach(({ key, label, min, max, step, unit }) => {
    const val   = cpiInputs[key];
    const panel = document.createElement('div');
    panel.className = 'input-panel';
    panel.innerHTML = `
      <div class="input-panel-header">
        <span class="input-label">${label}</span>
        <span class="input-val" id="cpi-iv-${key}" style="color:var(--orange)">${val}${unit}</span>
      </div>
      <input type="range" class="input-slider orange" min="${min}" max="${max}" step="${step}" value="${val}" data-key="${key}" data-unit="${unit}">
    `;
    grid.appendChild(panel);
  });

  grid.addEventListener('input', e => {
    if (e.target.tagName !== 'INPUT') return;
    const key  = e.target.dataset.key;
    const unit = e.target.dataset.unit || '';
    const v    = parseFloat(e.target.value);
    cpiInputs[key] = v;
    const el = document.getElementById(`cpi-iv-${key}`);
    if (el) el.textContent = v + unit;
  });
}

function renderCPIDrivers() {
  const p = cpiPrediction; if (!p) return;
  const container = document.getElementById('cpi-drivers-content');
  container.innerHTML = '<div class="driver-wrap"><div class="driver-list" id="cpi-driver-list"></div></div>';
  const list = document.getElementById('cpi-driver-list');

  p.drivers.forEach(d => {
    const cls  = d.bullish ? 'bull' : 'bear';
    const item = document.createElement('div');
    item.className = 'driver-item';
    item.innerHTML = `
      <div class="driver-name">${d.name}</div>
      <div class="driver-track"><div class="driver-fill ${cls}" style="width:0%" data-w="${d.contribution}"></div></div>
      <div class="driver-pct ${cls}">${d.contribution}%</div>
      <div class="driver-arrow ${cls}">${d.bullish ? '↑' : '↓'}</div>
    `;
    list.appendChild(item);
  });

  requestAnimationFrame(() => {
    document.querySelectorAll('#cpi-driver-list .driver-fill').forEach(el => {
      el.style.width = el.dataset.w + '%';
    });
  });
}

function renderCPINews() {
  const feed     = document.getElementById('cpi-news-feed');
  const articles = filterNews(getGapArticles(), CPI_KEYWORDS);

  feed.innerHTML = '';
  if (!articles.length) {
    feed.innerHTML = `<div class="news-empty">No inflation/CPI news found in the current Gap Signal data.<br>Run <code>python3 main.py --save</code> to refresh news.</div>`;
    return;
  }

  articles.forEach(a => {
    const el = document.createElement('a');
    el.className = 'news-item';
    el.href = a.url || '#'; el.target = '_blank'; el.rel = 'noopener';
    el.innerHTML = `
      <div>
        <div class="news-source">${a.source}</div>
        <div class="news-title">${a.title}</div>
        <div class="news-summary">${a.summary || ''}</div>
      </div>
      <div class="news-age">${ageStr(a.age_hours)}</div>
    `;
    feed.appendChild(el);
  });
}

// ── News Module ────────────────────────────────────────────────

let newsActiveFilter = 'all';

function tagArticle(a) {
  const txt = articleText(a);
  const tags = [];
  if (NFP_KEYWORDS.some(k => txt.includes(k)))     tags.push('labour');
  if (CPI_KEYWORDS.some(k => txt.includes(k)))     tags.push('inflation');
  if (GEO_KEYWORDS.some(k => txt.includes(k)))     tags.push('geo');
  if (MARKETS_KEYWORDS.some(k => txt.includes(k))) tags.push('markets');
  return tags;
}

function renderMainNews() {
  const articles = getGapArticles();
  const feed     = document.getElementById('main-news-feed');
  if (!feed) return;

  // Update filter counts
  const counts = {
    all:       articles.length,
    labour:    filterNews(articles, NFP_KEYWORDS).length,
    inflation: filterNews(articles, CPI_KEYWORDS).length,
    geo:       filterNews(articles, GEO_KEYWORDS).length,
    markets:   filterNews(articles, MARKETS_KEYWORDS).length,
  };
  Object.entries(counts).forEach(([k, v]) => {
    const el = document.getElementById(`nf-count-${k}`);
    if (el) el.textContent = v;
  });

  // Filter
  let visible = articles;
  if (newsActiveFilter === 'labour')    visible = filterNews(articles, NFP_KEYWORDS);
  if (newsActiveFilter === 'inflation') visible = filterNews(articles, CPI_KEYWORDS);
  if (newsActiveFilter === 'geo')       visible = filterNews(articles, GEO_KEYWORDS);
  if (newsActiveFilter === 'markets')   visible = filterNews(articles, MARKETS_KEYWORDS);

  feed.innerHTML = '';

  if (!visible.length) {
    feed.innerHTML = `<div class="news-empty">No articles match this filter in the current dataset.<br>Run <code>python3 main.py --save</code> to refresh.</div>`;
    return;
  }

  visible.forEach(a => {
    const tags    = tagArticle(a);
    const tagHTML = tags.map(t => `<span class="news-tag tag-${t}">${t === 'labour' ? 'NFP/Labour' : t === 'inflation' ? 'CPI/Inflation' : t === 'geo' ? 'Geopolitical' : 'Markets'}</span>`).join('');

    const el = document.createElement('a');
    el.className = 'news-item';
    el.href = a.url || '#'; el.target = '_blank'; el.rel = 'noopener';
    el.innerHTML = `
      <div>
        <div class="news-source">${a.source}</div>
        <div class="news-title">${a.title}</div>
        <div class="news-summary">${a.summary || ''}</div>
        ${tagHTML ? `<div class="news-tags">${tagHTML}</div>` : ''}
      </div>
      <div class="news-age">${ageStr(a.age_hours)}</div>
    `;
    feed.appendChild(el);
  });

  // Update sidebar badge with total
  document.getElementById('nav-news-badge').textContent = articles.length || '—';

  // Update page sub
  const sub = document.getElementById('news-page-sub');
  if (sub) sub.textContent = `${articles.length} articles · Last run: ${gapData?.generated_at ? new Date(gapData.generated_at).toLocaleString('en-GB', { weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) + ' UTC' : '—'}`;
}

// ── Section Switching ──────────────────────────────────────────

function switchGapSubnav(view) {
  // Update sidebar sub-nav active state
  document.querySelectorAll('.gap-sub').forEach(b => {
    b.classList.toggle('active', b.dataset.gapView === view);
  });

  const tabArea  = document.getElementById('gap-view-tabs');
  const newsView = document.getElementById('gap-view-news');

  if (view === 'news') {
    // Show news, hide tab content area and tabs
    if (tabArea) tabArea.style.display = 'none';
    ['signals','macro','picks'].forEach(v =>
      document.getElementById(`gap-view-${v}`).style.display = 'none');
    newsView.style.display = '';
  } else {
    // Dashboard or All Signals — show tabs, hide news
    if (tabArea) tabArea.style.display = '';
    newsView.style.display = 'none';
    switchGapVtab('signals');
  }
}

function switchSection(section) {
  currentSection = section;

  // Show/hide gap signal sub-nav
  const gapSubnav = document.getElementById('gap-subnav');
  if (gapSubnav) gapSubnav.style.display = section === 'gap' ? '' : 'none';

  // Reset gap subnav to dashboard when re-entering gap section
  if (section === 'gap') switchGapSubnav('dashboard');

  // Update module nav active states (only the top-level buttons, not sub-nav)
  document.querySelectorAll('.nav-item[data-section]').forEach(n => {
    n.classList.toggle('active', n.dataset.section === section);
  });

  // Show/hide sections
  ['gap','cpi','news'].forEach(s => {
    document.getElementById(`section-${s}`).style.display = s === section ? '' : 'none';
  });

  // Update run button
  const btn = document.getElementById('run-btn');
  btn.className = `run-btn section-${section}`;
  if (section === 'gap') {
    btn.textContent = '▶ Generate Signal';
  } else if (section === 'cpi') {
    btn.textContent = '▶ Generate CPI';
  } else {
    btn.textContent = '↺ Refresh News';
    btn.className = 'run-btn section-news';
  }

  // Topbar label
  const labels = { gap:'Gap Signal', cpi:'CPI Forecast', news:'News Feed' };
  document.getElementById('topbar-section-label').textContent = labels[section] || section;

  // Render news module whenever we enter it
  if (section === 'news') renderMainNews();

  // Fetch live API data on first visit
  if (section === 'cpi' && !cpiDataLoaded) {
    cpiDataLoaded = true;
    loadCPILiveData();
  }

  updateSidebarForSection();
}

function updateSidebarForSection() {
  const nfpRiskRow = document.getElementById('sb-fomc-row');
  const cpiRiskRow = document.getElementById('sb-inflation-row');

  if (currentSection === 'gap') {
    nfpRiskRow.style.display = 'none';
    cpiRiskRow.style.display = 'none';
  } else if (currentSection === 'cpi') {
    nfpRiskRow.style.display = 'none';
    cpiRiskRow.style.display = cpiPrediction ? '' : 'none';
    if (cpiPrediction) {
      const el = document.getElementById('sb-inflation');
      el.textContent = cpiPrediction.headline + '% ' + cpiPrediction.regime;
      el.className   = `risk-val risk-${cpiPrediction.regime}`;
      document.getElementById('sidebar-time').textContent = cpiPrediction.headline + '%';
      document.getElementById('sidebar-meta').textContent = `${cpiPrediction.regime} · Core MoM ${cpiPrediction.coreMoM}%`;
    }
  } else {
    nfpRiskRow.style.display = 'none';
    cpiRiskRow.style.display = 'none';
  }
}

// ── Tab switching ──────────────────────────────────────────────

function switchGapVtab(vtab) {
  document.querySelectorAll('[data-section-vtab="gap"]').forEach(t => {
    t.classList.toggle('active', t.dataset.vtab === vtab);
  });
  ['signals','macro','picks'].forEach(v => {
    document.getElementById(`gap-view-${v}`).style.display = v === vtab ? '' : 'none';
  });
}

function switchNFPVtab(vtab) {
  nfpActiveVtab = vtab;
  document.querySelectorAll('[data-section-vtab="nfp"]').forEach(t => {
    t.classList.toggle('active', t.dataset.vtab === vtab);
  });
  ['signals','forecast','inputs','drivers','news'].forEach(v => {
    document.getElementById(`nfp-view-${v}`).style.display = v === vtab ? '' : 'none';
  });

  // Lazy-render inputs and drivers panels
  if (vtab === 'inputs') {
    const g = document.getElementById('nfp-input-grid');
    if (!g) renderNFPInputs();
  }
  if (vtab === 'drivers' && nfpPrediction) renderNFPDrivers();
}

function switchCPIVtab(vtab) {
  cpiActiveVtab = vtab;
  document.querySelectorAll('[data-section-vtab="cpi"]').forEach(t => {
    t.classList.toggle('active', t.dataset.vtab === vtab);
  });
  ['signals','forecast','inputs','drivers','news'].forEach(v => {
    document.getElementById(`cpi-view-${v}`).style.display = v === vtab ? '' : 'none';
  });

  if (vtab === 'inputs') {
    const g = document.getElementById('cpi-input-grid');
    if (!g) renderCPIInputs();
  }
  if (vtab === 'drivers' && cpiPrediction) renderCPIDrivers();
}

// ── Consensus display ──────────────────────────────────────────

function updateNFPConsensusDisplay() {
  const el = document.getElementById('nfp-consensus-vs');
  if (!el) return;
  if (!nfpConsensus || !nfpPrediction) {
    el.textContent = 'Enter street forecast to compare with model';
    el.className = 'cb-vs';
    return;
  }
  const diff = nfpPrediction.headline - nfpConsensus;
  const absDiff = Math.abs(diff);
  if (absDiff < 15) {
    el.textContent = `Model ${nfpPrediction.headline}k · Street ${nfpConsensus}k · In-line (${diff >= 0 ? '+' : ''}${diff}k)`;
    el.className = 'cb-vs inline';
  } else if (diff > 0) {
    el.textContent = `Model ${nfpPrediction.headline}k · Street ${nfpConsensus}k · Model +${diff}k above street → POTENTIAL BEAT`;
    el.className = 'cb-vs beat';
  } else {
    el.textContent = `Model ${nfpPrediction.headline}k · Street ${nfpConsensus}k · Model ${diff}k below street → POTENTIAL MISS`;
    el.className = 'cb-vs miss';
  }
}

function updateCPIConsensusDisplay() {
  const el = document.getElementById('cpi-consensus-vs');
  if (!el) return;
  if (!cpiConsensus || !cpiPrediction) {
    el.textContent = 'Enter street forecast to compare with model';
    el.className = 'cb-vs';
    return;
  }
  const diff = Math.round((cpiPrediction.headline - cpiConsensus) * 100) / 100;
  const absDiff = Math.abs(diff);
  if (absDiff < 0.1) {
    el.textContent = `Model ${cpiPrediction.headline}% · Street ${cpiConsensus}% · In-line (${diff >= 0 ? '+' : ''}${diff}%)`;
    el.className = 'cb-vs inline';
  } else if (diff > 0) {
    el.textContent = `Model ${cpiPrediction.headline}% · Street ${cpiConsensus}% · Model +${diff}% hotter → UPSIDE RISK`;
    el.className = 'cb-vs miss';
  } else {
    el.textContent = `Model ${cpiPrediction.headline}% · Street ${cpiConsensus}% · Model ${diff}% softer → DOWNSIDE RISK`;
    el.className = 'cb-vs beat';
  }
}

// ── NFP / CPI Asset Modals ─────────────────────────────────────

function openNFPAssetModal(asset, name, signal, rat, p) {
  const sc = signalClass(signal);
  const da = dirArrow(signal);

  document.getElementById('modal-header-bar').style.background = '#06b6d4';
  const ma = document.getElementById('modal-asset');
  ma.textContent = `${asset} — NFP`;
  ma.style.color = '#06b6d4';

  document.getElementById('modal-top-badges').innerHTML = `
    <span class="dir-badge dir-${sc}" style="font-size:13px">${da} ${signal} · ${p.confidence}%</span>
    <span class="gap-badge ${regimeBadgeClass(p.regime)}" style="font-size:11px">${p.regime} LABOR</span>
    <span class="gap-badge ${fomcBadgeClass(p.fomcReaction)}" style="font-size:11px">${p.fomcReaction} FOMC</span>
  `;

  document.getElementById('modal-bias').textContent = rat;

  const dl = document.getElementById('modal-drivers'); dl.innerHTML = '';
  const topDrivers = [...p.drivers].sort((a, b) => b.contribution - a.contribution).slice(0, 3);
  [
    `NFP forecast: ${p.headline}k (${p.direction} than consensus)`,
    `Labor regime: ${p.regime} · Fed reaction: ${p.fomcReaction}`,
    ...topDrivers.map(d => `${d.name}: ${d.bullish ? '↑ bullish' : '↓ bearish'} (${d.contribution}% model weight)`)
  ].forEach(t => { const li = document.createElement('li'); li.textContent = t; dl.appendChild(li); });

  const rl = document.getElementById('modal-risks'); rl.innerHTML = '';
  [
    sc === 'BUY'
      ? `Miss below ${p.bear}k reverses bullish thesis`
      : sc === 'SELL'
        ? `Beat above ${p.bull}k negates bearish thesis`
        : `Print outside ${p.bear}k–${p.bull}k range breaks neutrality`,
    `Unexpected Fed guidance shift at next FOMC`,
    `Strong revision to prior month NFP data`
  ].forEach(r => { const li = document.createElement('li'); li.textContent = r; rl.appendChild(li); });

  document.getElementById('modal-overlay').classList.add('open');
}

function openCPIAssetModal(asset, name, signal, rat, cp) {
  const sc = signalClass(signal);
  const da = dirArrow(signal);

  document.getElementById('modal-header-bar').style.background = '#f97316';
  const ma = document.getElementById('modal-asset');
  ma.textContent = `${asset} — CPI`;
  ma.style.color = '#f97316';

  document.getElementById('modal-top-badges').innerHTML = `
    <span class="dir-badge dir-${sc}" style="font-size:13px">${da} ${signal} · ${Math.round(cp.confidence)}%</span>
    <span class="gap-badge ${regimeBadgeClass(cp.regime)}" style="font-size:11px">${cp.regime} CPI${cp.stagflation ? ' ⚠' : ''}</span>
  `;

  document.getElementById('modal-bias').textContent = rat;

  const dl = document.getElementById('modal-drivers'); dl.innerHTML = '';
  const topDrivers = [...cp.drivers].sort((a, b) => b.contribution - a.contribution).slice(0, 3);
  [
    `CPI forecast: ${cp.headline}% YoY · Core MoM: ${cp.coreMoM}%`,
    `Inflation regime: ${cp.regime}${cp.stagflation ? ' (stagflation risk)' : ''}`,
    ...topDrivers.map(d => `${d.name}: ${d.bullish ? '↑ inflationary' : '↓ disinflationary'} (${d.contribution}% weight)`)
  ].forEach(t => { const li = document.createElement('li'); li.textContent = t; dl.appendChild(li); });

  const rl = document.getElementById('modal-risks'); rl.innerHTML = '';
  [
    cp.regime === 'Hot'
      ? `Softer core MoM (below 0.25%) could trigger dovish repricing`
      : cp.regime === 'Soft'
        ? `Energy spike or wage surprise could reignite inflation narrative`
        : `Break above ${cp.bull}% or below ${cp.bear}% shifts regime`,
    `Fed communication overrides data — watch FOMC speakers`,
    `Prior month revision changes trajectory baseline`
  ].forEach(r => { const li = document.createElement('li'); li.textContent = r; rl.appendChild(li); });

  document.getElementById('modal-overlay').classList.add('open');
}

// ── Modals ─────────────────────────────────────────────────────

function closeDetailModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

async function triggerGapSignal() {
  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);

  if (isLocal) {
    // Local dev — show the terminal command
    showCommandModal();
    return;
  }

  // Netlify — call the serverless function to trigger GitHub Actions
  const btn = document.getElementById('run-btn');
  const orig = btn.textContent;
  btn.textContent = '⏳ Generating…';
  btn.disabled = true;

  try {
    const res  = await fetch('/.netlify/functions/trigger-signal', { method: 'POST' });
    const data = await res.json();

    if (data.ok) {
      showGeneratingModal();
    } else {
      alert('Error triggering signal: ' + (data.error || 'unknown'));
      btn.textContent = orig;
      btn.disabled = false;
    }
  } catch (e) {
    alert('Could not reach the trigger function: ' + e.message);
    btn.textContent = orig;
    btn.disabled = false;
  }
}

function showGeneratingModal() {
  document.getElementById('generating-overlay').classList.add('open');

  const currentTs = gapData?.generated_at || '';
  const RAW_URL = 'https://raw.githubusercontent.com/aryanmaharaj645-byte/BBS/main/platform/data/latest.json';

  let attempts = 0;
  const poll = setInterval(async () => {
    attempts++;
    try {
      const res  = await fetch(RAW_URL + '?t=' + Date.now());
      if (!res.ok) return;
      const data = await res.json();
      if (data.generated_at && data.generated_at !== currentTs) {
        clearInterval(poll);
        gapData       = data;
        gapAllSignals = data.signals || {};
        gapRecommended = data.recommended_assets || [];
        gapAvoid      = data.assets_to_avoid || [];
        applyGapToSidebar(data);
        renderGapStats(data);
        renderGapTable();
        renderGapPicks();
        renderGapMacro(data);
        renderGapNews(data.news_articles || []);
        renderMainNews();
        document.getElementById('generating-overlay').classList.remove('open');
      }
    } catch { /* network blip — keep polling */ }
    if (attempts >= 36) { // 3 min timeout fallback
      clearInterval(poll);
      window.location.reload();
    }
  }, 5000);
}

function showCommandModal() {
  document.getElementById('cmd-overlay').classList.add('open');
}

function closeCommandModal() {
  document.getElementById('cmd-overlay').classList.remove('open');
}

// ── Clock ──────────────────────────────────────────────────────

function startClock() {
  const update = () => {
    const now = new Date();
    const t   = now.toISOString().slice(11, 16) + ' UTC';
    const el  = document.getElementById('topbar-time');
    if (el) el.textContent = t;

    const dateEl = document.getElementById('topbar-date');
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString('en-GB', { weekday:'short', year:'numeric', month:'short', day:'numeric' });
    }
  };
  update();
  setInterval(update, 1000);
}

// ── Event Wiring ───────────────────────────────────────────────

function wireEvents() {
  // Hamburger — open/close sidebar on mobile
  const hamburger = document.getElementById('hamburger');
  const sidebar   = document.querySelector('.sidebar');
  const backdrop  = document.getElementById('sidebar-backdrop');

  function openSidebar()  {
    sidebar.classList.add('open');
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeSidebar() {
    sidebar.classList.remove('open');
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
  }

  hamburger.onclick  = () => sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
  backdrop.onclick   = closeSidebar;

  // Module nav (top-level sections)
  document.querySelectorAll('.nav-item[data-section]').forEach(n => {
    n.onclick = () => { switchSection(n.dataset.section); closeSidebar(); };
  });

  // Gap signal sub-nav (Dashboard / All Signals / News Feed)
  document.querySelectorAll('.gap-sub').forEach(b => {
    b.onclick = () => { switchGapSubnav(b.dataset.gapView); closeSidebar(); };
  });

  // Run button
  document.getElementById('run-btn').onclick = () => {
    if (currentSection === 'gap') {
      triggerGapSignal();
    } else if (currentSection === 'cpi') {
      generateCPI();
      if (cpiActiveVtab !== 'inputs') switchCPIVtab('signals');
    } else if (currentSection === 'news') {
      loadGapData();
    }
  };

  // News filter buttons
  document.addEventListener('click', e => {
    const btn = e.target.closest('.news-filt');
    if (!btn) return;
    document.querySelectorAll('.news-filt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    newsActiveFilter = btn.dataset.nfilter;
    renderMainNews();
  });

  // Tab clicks (use event delegation via data attributes)
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-section-vtab]');
    if (!t) return;
    const sec  = t.dataset.sectionVtab;
    const vtab = t.dataset.vtab;
    if (sec === 'gap') switchGapVtab(vtab);
    else if (sec === 'nfp') switchNFPVtab(vtab);
    else if (sec === 'cpi') switchCPIVtab(vtab);
  });

  // Gap filter buttons
  document.querySelectorAll('.filt').forEach(f => {
    f.onclick = () => {
      document.querySelectorAll('.filt').forEach(x => x.classList.remove('active'));
      f.classList.add('active');
      gapActiveGroup = f.dataset.group;
      renderGapTable();
    };
  });

  // Detail modal close
  document.getElementById('modal-close').onclick   = closeDetailModal;
  document.getElementById('modal-overlay').onclick = e => { if (e.target.id === 'modal-overlay') closeDetailModal(); };

  // Command modal close
  document.getElementById('cmd-close').onclick    = closeCommandModal;
  document.getElementById('cmd-overlay').onclick  = e => { if (e.target.id === 'cmd-overlay') closeCommandModal(); };

  // Keyboard
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeDetailModal(); closeCommandModal(); }
  });

  // Consensus inputs
  const nfpCI = document.getElementById('nfp-consensus-input');
  if (nfpCI) nfpCI.addEventListener('input', () => {
    const v = parseFloat(nfpCI.value);
    nfpConsensus = isNaN(v) ? null : v;
    updateNFPConsensusDisplay();
  });

  const cpiCI = document.getElementById('cpi-consensus-input');
  if (cpiCI) cpiCI.addEventListener('input', () => {
    const v = parseFloat(cpiCI.value);
    cpiConsensus = isNaN(v) ? null : v;
    updateCPIConsensusDisplay();
  });
}

// ── Init ───────────────────────────────────────────────────────

async function init() {
  startClock();
  wireEvents();

  // Render CPI inputs panel once so it's ready
  renderCPIInputs();

  // Run initial CPI prediction with fallback data
  generateCPI();

  // Load gap signal data
  await loadGapData();

  // Auto-refresh news every 5 minutes
  setInterval(() => loadGapData(), 5 * 60 * 1000);

  // Show initial section (gap)
  switchSection('gap');
}

init();
