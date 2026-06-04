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

let allSignals = {};
let recommended = [];
let avoid = [];
let activeGroup = "all";
let activeVtab = "signals";

function groupOf(a) {
  if (FOREX.includes(a)) return "forex";
  if (INDICES.includes(a)) return "indices";
  return "commodities";
}

async function loadData() {
  const res = await fetch("data/latest.json?t=" + Date.now());
  const data = await res.json();

  allSignals = data.signals || {};
  recommended = data.recommended_assets || [];
  avoid = data.assets_to_avoid || [];

  // Topbar / sidebar time
  const raw = data.generated_at || "";
  const dt = raw.slice(0, 16).replace("T", " ");
  const dateStr = raw ? new Date(raw).toLocaleDateString("en-GB", {weekday:"short", year:"numeric", month:"short", day:"numeric"}) : "—";
  document.getElementById("topbar-date").textContent = dateStr;
  document.getElementById("topbar-time").textContent = dt + " UTC";
  document.getElementById("sidebar-time").textContent = dt.slice(11) || "—";
  document.getElementById("sidebar-meta").textContent = `Generated ${dateStr}`;
  document.getElementById("sidebar-theme").textContent = (data.macro_theme || "").slice(0, 120) + "…";

  // Risk flags
  const trump = data.trump_risk_level || "LOW";
  const geo   = data.geopolitical_risk || "LOW";
  const sbTrump = document.getElementById("sb-trump");
  sbTrump.textContent = trump;
  sbTrump.className = `risk-val risk-${trump}`;
  const sbGeo = document.getElementById("sb-geo");
  sbGeo.textContent = geo;
  sbGeo.className = `risk-val risk-${geo}`;

  // Nav badge
  const buys = Object.values(allSignals).filter(s => s.direction === "BUY").length;
  const sells = Object.values(allSignals).filter(s => s.direction === "SELL").length;
  document.getElementById("nav-buy-count").textContent = `${buys}B ${sells}S`;

  // Alert bar
  const alertBar = document.getElementById("alert-bar");
  const alertText = document.getElementById("alert-text");
  const riskScore = {NONE:0,LOW:1,MEDIUM:2,HIGH:3,EXTREME:4};
  const maxRisk = Math.max(riskScore[trump] || 0, riskScore[geo] || 0);
  if (maxRisk >= 3) {
    alertBar.className = "alert-bar danger";
    alertText.textContent = `High risk environment — ${geo} geopolitical risk + Trump ${trump}. Expect large continuation gaps.`;
  } else if (maxRisk === 2) {
    alertBar.className = "alert-bar warn";
    alertText.textContent = `Elevated risk this weekend. Watch for gap continuation on high-conviction signals.`;
  } else {
    alertBar.className = "alert-bar good";
    alertText.textContent = `No major alerts. Quiet weekend expected — gap fill bias elevated across most pairs.`;
  }

  // Stat cards
  const dirs = Object.values(allSignals).map(s => s.direction);
  const buyCount  = dirs.filter(d => d === "BUY").length;
  const sellCount = dirs.filter(d => d === "SELL").length;
  const bias = buyCount > sellCount + 2 ? "BULLISH" : sellCount > buyCount + 2 ? "BEARISH" : "MIXED";
  const biasColor = {BULLISH:"var(--green)", BEARISH:"var(--red)", MIXED:"var(--yellow)"};
  const biasEl = document.getElementById("stat-bias");
  biasEl.textContent = bias;
  biasEl.style.color = biasColor[bias] || "";
  document.getElementById("stat-bias-sub").textContent = `${buyCount} buy · ${sellCount} sell`;

  // Strongest signal
  const strongest = Object.entries(allSignals)
    .sort((a,b) => (b[1].confidence||0) - (a[1].confidence||0))[0];
  if (strongest) {
    const [name, sig] = strongest;
    document.getElementById("stat-strongest").textContent = name;
    document.getElementById("stat-strongest-sub").textContent = `${sig.direction} · ${sig.confidence}% confidence`;
  }

  // Risk level
  const riskLabels = ["LOW","LOW","MEDIUM","HIGH","EXTREME"];
  const riskLabel = riskLabels[maxRisk] || "LOW";
  const riskEl = document.getElementById("stat-risk");
  riskEl.textContent = riskLabel;
  riskEl.className = `stat-value risk-${riskLabel}`;

  // Gap probability
  const contCount = Object.values(allSignals).filter(s => s.gap_type === "CONTINUATION").length;
  const total = Object.values(allSignals).length || 1;
  const contPct = Math.round(contCount / total * 100);
  document.getElementById("stat-gap").textContent = contPct + "%";
  document.getElementById("stat-gap-sub").textContent = `${contCount} continuation signals`;

  // Macro
  document.getElementById("macro-full-text").textContent = data.macro_theme || "—";

  // Page sub
  document.getElementById("page-sub").textContent =
    `Last updated: ${dt} UTC · ${Object.keys(allSignals).length} assets analysed`;

  renderTable();
  renderPicks();
  renderNews(data.news_articles || []);
}

function renderNews(articles) {
  const feed = document.getElementById("news-feed");
  feed.innerHTML = "";

  // Update sidebar badge
  const badge = document.getElementById("nav-news-badge");
  badge.textContent = articles.length || "—";
  badge.style.background = articles.length ? "var(--purple-bg)" : "var(--muted-bg)";
  badge.style.color = articles.length ? "var(--purple)" : "var(--muted)";

  if (!articles.length) {
    feed.innerHTML = `<div style="padding:32px;text-align:center;color:var(--muted);font-size:13px">No news articles in this report.<br>Re-run <code style="color:var(--purple)">python3 main.py --save</code> to fetch live news.</div>`;
    return;
  }

  articles.forEach(a => {
    const age = a.age_hours < 1 ? "<1h ago" : a.age_hours < 24 ? `${Math.round(a.age_hours)}h ago` : `${Math.round(a.age_hours/24)}d ago`;
    const el = document.createElement("a");
    el.className = "news-item";
    el.href = a.url || "#";
    el.target = "_blank";
    el.rel = "noopener";
    el.innerHTML = `
      <div>
        <div class="news-source">${a.source}</div>
        <div class="news-title">${a.title}</div>
        <div class="news-summary">${a.summary || ""}</div>
      </div>
      <div class="news-age">${age}</div>
    `;
    feed.appendChild(el);
  });
}

function renderTable() {
  const tbody = document.getElementById("signal-tbody");
  tbody.innerHTML = "";
  const order = [...FOREX, ...INDICES, ...COMMODITIES];

  order.forEach(asset => {
    const sig = allSignals[asset];
    if (!sig) return;

    const dir  = sig.direction || "NEUTRAL";
    const conf = sig.confidence || 0;
    const gapType = sig.gap_type || "UNCERTAIN";
    const isStar = recommended.includes(asset);
    const grp = groupOf(asset);

    if (activeGroup === "forex" && grp !== "forex") return;
    if (activeGroup === "indices" && grp !== "indices") return;
    if (activeGroup === "commodities" && grp !== "commodities") return;
    if (activeGroup === "buy" && dir !== "BUY") return;
    if (activeGroup === "sell" && dir !== "SELL") return;
    if (activeGroup === "high" && conf < 65) return;

    const confClass = conf >= 70 ? "high" : conf >= 55 ? "mid" : "low";
    const confTier  = conf >= 70 ? "tier-high" : conf >= 55 ? "tier-mid" : "";
    const tierLabel = conf >= 70 ? "HIGH CONF" : conf >= 55 ? "MED CONF" : "LOW CONF";
    const dirArrow  = dir === "BUY" ? "↑" : dir === "SELL" ? "↓" : "→";
    const gapClass  = gapType === "CONTINUATION" ? "cont" : gapType === "FILL" ? "fill" : "";
    const driver    = (sig.key_drivers || [])[0] || "—";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div class="inst-name">${asset}${isStar ? '<span class="star-tag">★</span>' : ''}</div>
        <div class="inst-sub">${PAIR_NAMES[asset] || ""}</div>
      </td>
      <td>
        <span class="dir-badge dir-${dir}">${dirArrow} ${dir}</span>
      </td>
      <td>
        <div class="conv-wrap">
          <span class="conv-label">STRENGTH</span>
          <div class="conv-track">
            <div class="conv-fill fill-${dir}" style="width:0%" data-w="${conf}"></div>
          </div>
        </div>
      </td>
      <td>
        <div class="conf-wrap">
          <span class="conf-pct ${confClass}">${conf}%</span>
          <span class="conf-tier ${confTier}">${tierLabel}</span>
        </div>
      </td>
      <td><span class="gap-badge ${gapClass}">${gapType}</span></td>
      <td><span class="driver-pill" title="${driver}">${driver}</span></td>
      <td><span class="chevron">›</span></td>
    `;
    tr.onclick = () => openModal(asset);
    tbody.appendChild(tr);
  });

  // Animate bars
  requestAnimationFrame(() => {
    document.querySelectorAll(".conv-fill").forEach(el => {
      el.style.width = el.dataset.w + "%";
    });
  });
}

function renderPicks() {
  const grid = document.getElementById("picks-grid");
  grid.innerHTML = "";
  const featured = [...recommended, ...Object.keys(allSignals).filter(a => !avoid.includes(a) && !recommended.includes(a))];

  featured.slice(0, 6).forEach(asset => {
    const sig = allSignals[asset];
    if (!sig) return;
    const dir = sig.direction || "NEUTRAL";
    const conf = sig.confidence || 0;
    const dirColor = dir === "BUY" ? "var(--green)" : dir === "SELL" ? "var(--red)" : "var(--muted)";
    const isStar = recommended.includes(asset);

    const card = document.createElement("div");
    card.className = "picks-card";
    card.innerHTML = `
      <div class="picks-card-asset" style="color:${dirColor}">${asset}${isStar ? ' ★' : ''}</div>
      <div class="picks-card-dir" style="color:${dirColor}">${dir} · ${conf}% confidence · ${sig.gap_type}</div>
      <div class="picks-card-bias">${sig.trade_bias || "—"}</div>
    `;
    card.onclick = () => openModal(asset);
    grid.appendChild(card);
  });

  // Macro items
  const macroGrid = document.getElementById("macro-grid");
  macroGrid.innerHTML = "";
  const sigs = Object.values(allSignals);
  const avgConf = Math.round(sigs.reduce((a,s) => a + (s.confidence||0), 0) / (sigs.length||1));
  const contCount = sigs.filter(s => s.gap_type === "CONTINUATION").length;

  [
    { label: "Avg Confidence", val: avgConf + "%", sub: "Across all signals" },
    { label: "Continuation Signals", val: contCount, sub: "Gap continuation bias" },
    { label: "Best Setup", val: (recommended[0] || "—"), sub: allSignals[recommended[0]]?.direction || "" },
    { label: "Avoid", val: (avoid[0] || "—"), sub: "Conflicted signals" },
  ].forEach(({ label, val, sub }) => {
    const el = document.createElement("div");
    el.className = "macro-item";
    el.innerHTML = `<div class="macro-item-label">${label}</div><div class="macro-item-val">${val}</div><div class="macro-item-sub">${sub}</div>`;
    macroGrid.appendChild(el);
  });
}

function openModal(asset) {
  const sig = allSignals[asset];
  if (!sig) return;
  const dir = sig.direction || "NEUTRAL";
  const conf = sig.confidence || 0;
  const dirColor = dir === "BUY" ? "#22c55e" : dir === "SELL" ? "#ef4444" : "#6b7280";

  document.getElementById("modal-header-bar").style.background = dirColor;
  document.getElementById("modal-asset").textContent = asset + (recommended.includes(asset) ? " ★" : "");
  document.getElementById("modal-asset").style.color = dirColor;
  document.getElementById("modal-top-badges").innerHTML = `
    <span class="dir-badge dir-${dir}" style="font-size:13px">${dir} ${conf}%</span>
    <span class="gap-badge ${sig.gap_type === "CONTINUATION" ? "cont" : sig.gap_type === "FILL" ? "fill" : ""}" style="font-size:11px">${sig.gap_type}</span>
    <span style="font-size:11px;color:var(--muted)">${sig.expected_gap_size || ""}</span>
  `;
  document.getElementById("modal-bias").textContent = sig.trade_bias || "—";

  const dl = document.getElementById("modal-drivers");
  dl.innerHTML = "";
  (sig.key_drivers || []).forEach(d => { const li = document.createElement("li"); li.textContent = d; dl.appendChild(li); });

  const rl = document.getElementById("modal-risks");
  rl.innerHTML = "";
  (sig.risks || []).forEach(r => { const li = document.createElement("li"); li.textContent = r; rl.appendChild(li); });

  document.getElementById("modal-overlay").classList.add("open");
}

function closeModal() { document.getElementById("modal-overlay").classList.remove("open"); }

// Tabs
document.querySelectorAll(".vtab").forEach(t => {
  t.onclick = () => {
    document.querySelectorAll(".vtab").forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    activeVtab = t.dataset.vtab;
    switchView(activeVtab);
  };
});

// Filters
document.querySelectorAll(".filt").forEach(f => {
  f.onclick = () => {
    document.querySelectorAll(".filt").forEach(x => x.classList.remove("active"));
    f.classList.add("active");
    activeGroup = f.dataset.group;
    renderTable();
  };
});

function switchView(view) {
  document.getElementById("view-signals").style.display = view === "signals" ? "" : "none";
  document.getElementById("view-macro").style.display   = view === "macro"   ? "" : "none";
  document.getElementById("view-picks").style.display   = view === "picks"   ? "" : "none";
  document.getElementById("view-news").style.display    = view === "news"    ? "" : "none";
}

// Nav
document.querySelectorAll(".nav-item").forEach(n => {
  n.onclick = e => {
    e.preventDefault();
    document.querySelectorAll(".nav-item").forEach(x => x.classList.remove("active"));
    n.classList.add("active");
    const view = n.dataset.view;
    if (view === "dashboard" || view === "all") {
      document.querySelectorAll(".vtab").forEach(x => x.classList.remove("active"));
      document.querySelector('.vtab[data-vtab="signals"]').classList.add("active");
      switchView("signals");
    } else if (view === "news") {
      switchView("news");
    }
  };
});

// Modal close
document.getElementById("modal-close").onclick = closeModal;
document.getElementById("modal-overlay").onclick = e => { if (e.target.id === "modal-overlay") closeModal(); };
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

// Live clock
setInterval(() => {
  const now = new Date();
  const t = now.toISOString().slice(11,16) + " UTC";
  const el = document.getElementById("topbar-time");
  if (el) el.textContent = t;
}, 1000);

loadData();
