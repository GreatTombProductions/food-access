// Food Access Atlas — Frontend
// County name search + state browse + MD5 detail shards

const DATA_BASE = "data/";
const INDEX_DIR = DATA_BASE + "indices/name/";
const STATE_DIR = DATA_BASE + "indices/state/";
const DETAIL_DIR = DATA_BASE + "detail/";
const NUM_SHARDS = 256;

let currentMode = "search";
let stateSummary = null;
let stateCache = {};

// ── Mode switching ──

function setMode(mode) {
  currentMode = mode;
  document.getElementById("mode-search").classList.toggle("active", mode === "search");
  document.getElementById("mode-state").classList.toggle("active", mode === "state");
  document.getElementById("search-section").style.display = mode === "search" ? "block" : "none";
  document.getElementById("state-section").style.display = mode === "state" ? "block" : "none";
  hideDetail();

  if (mode === "state" && !stateSummary) {
    loadStateSummary();
  }
}

// ── Search ──

async function handleSearch() {
  const q = document.getElementById("search-input").value.trim();
  if (q.length < 1) {
    document.getElementById("search-results").innerHTML = "";
    return;
  }

  const firstChar = q[0].toUpperCase();
  const letter = /[A-Z]/.test(firstChar) ? firstChar : "#";

  try {
    const resp = await fetch(INDEX_DIR + letter + ".json");
    if (!resp.ok) {
      document.getElementById("search-results").innerHTML = '<div class="no-results">No counties found</div>';
      return;
    }
    const counties = await resp.json();

    const qLower = q.toLowerCase();
    const filtered = counties.filter(c =>
      (c.name + " " + c.state).toLowerCase().includes(qLower) ||
      c.county.toLowerCase().includes(qLower)
    ).slice(0, 50);

    if (filtered.length === 0) {
      document.getElementById("search-results").innerHTML = '<div class="no-results">No counties matching "' + escapeHtml(q) + '"</div>';
      return;
    }

    document.getElementById("search-results").innerHTML = filtered.map(c => resultItemHTML(c)).join("");
  } catch (e) {
    document.getElementById("search-results").innerHTML = '<div class="loading">Error loading results</div>';
  }
}

function resultItemHTML(c) {
  const desertPct = c.food_desert_pct != null ? c.food_desert_pct + "%" : "—";
  const desertClass = c.food_desert_pct >= 30 ? 'bad' : c.food_desert_pct >= 10 ? 'warn' : 'good';
  const poverty = c.poverty_rate != null ? c.poverty_rate + "%" : "—";

  return `
    <div class="result-item" onclick="showDetail('${c._md5}')">
      <div>
        <div class="name">${escapeHtml(c.name)}, ${escapeHtml(c.state)}</div>
        <div class="location">${escapeHtml(c.county)} · Pop ${c.pop.toLocaleString()}</div>
      </div>
      <div class="metrics">
        <div class="metric"><div class="val" style="color:var(--${desertClass})">${desertPct}</div><div class="label">Food Desert</div></div>
        <div class="metric"><div class="val">${poverty}</div><div class="label">Poverty</div></div>
      </div>
    </div>`;
}

// ── State browse ──

async function loadStateSummary() {
  try {
    const resp = await fetch(STATE_DIR + "_summary.json");
    stateSummary = await resp.json();
    renderStateList();
  } catch (e) {
    document.getElementById("state-list").innerHTML = '<div class="loading">Error loading states</div>';
  }
}

function renderStateList() {
  if (!stateSummary) return;

  const states = Object.entries(stateSummary).sort((a, b) => b[1].total_pop - a[1].total_pop);

  document.getElementById("state-list").innerHTML = states.map(([st, info]) => {
    const desertPct = info.food_desert_pct + "%";
    const desertClass = info.food_desert_pct >= 30 ? 'bad' : info.food_desert_pct >= 10 ? 'warn' : 'good';
    return `
      <div class="state-card" onclick="loadStateCounties('${st}')">
        <div class="st-name">${st} <span style="color:var(--text2);font-weight:400;font-size:0.85em">${info.county_count} counties</span></div>
        <div class="st-stats">
          <span style="color:var(--${desertClass})">Desert: ${desertPct}</span>
          <span>Poverty: ${info.avg_poverty}%</span>
          <span>Pop ${(info.total_pop / 1e6).toFixed(1)}M</span>
        </div>
      </div>`;
  }).join("");
}

async function loadStateCounties(st) {
  if (stateCache[st]) {
    renderStateCounties(st, stateCache[st]);
    return;
  }

  try {
    const resp = await fetch(STATE_DIR + st + ".json");
    const counties = await resp.json();
    stateCache[st] = counties;
    renderStateCounties(st, counties);
  } catch (e) {
    document.getElementById("state-counties").innerHTML = '<div class="loading">Error loading counties for ' + st + '</div>';
  }
}

function renderStateCounties(st, counties) {
  document.getElementById("state-list").style.display = "none";
  const el = document.getElementById("state-counties");
  el.style.display = "block";
  el.innerHTML = `
    <div style="margin-bottom:16px">
      <button class="back" onclick="document.getElementById('state-list').style.display='';document.getElementById('state-counties').style.display='none';">← Back to states</button>
      <h3 style="margin-bottom:4px">${st} — ${counties.length} counties</h3>
    </div>
    ${counties.map(c => resultItemHTML(c)).join("")}`;
}

// ── Detail view ──

async function showDetail(md5) {
  const shardId = parseInt(md5.substring(0, 2), 16) % NUM_SHARDS;
  const shardHex = shardId.toString(16).padStart(2, "0");

  const panel = document.getElementById("detail-panel");
  panel.innerHTML = '<div class="loading">Loading...</div>';
  panel.classList.add("active");
  panel.scrollIntoView({ behavior: "smooth" });

  try {
    const resp = await fetch(DETAIL_DIR + shardHex + ".json");
    const shard = await resp.json();
    const c = shard[md5];

    if (!c) {
      panel.innerHTML = '<div class="loading">County not found</div>';
      return;
    }

    panel.innerHTML = detailHTML(c);
  } catch (e) {
    panel.innerHTML = '<div class="loading">Error loading county details</div>';
  }
}

function hideDetail() {
  document.getElementById("detail-panel").classList.remove("active");
}

function detailHTML(c) {
  const fd = c.food_desert;
  const la = c.low_access;
  const t = c.totals;

  // Status tags
  let tags = [];
  tags.push(`<span class="tag">${c.num_tracts} census tracts</span>`);
  tags.push(`<span class="tag">${c.urban_pct}% urban</span>`);
  if (fd.pct_1and10 >= 30) {
    tags.push(`<span class="tag desert">High food desert density</span>`);
  } else if (fd.pct_1and10 >= 10) {
    tags.push(`<span class="tag warn">Moderate food desert density</span>`);
  }

  // Food desert metrics
  const desertClass = (pct) => pct >= 30 ? 'bad' : pct >= 10 ? 'warn' : 'good';

  // Access bar chart
  function barRow(label, pct, color) {
    return `
      <div class="bar-row">
        <div class="label">${label}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.min(pct, 100)}%;background:${color}"></div></div>
        <div class="pct">${pct}%</div>
      </div>`;
  }

  return `
    <button class="back" onclick="hideDetail()">← Back to results</button>
    <h2>${escapeHtml(c.name)}, ${escapeHtml(c.state)}</h2>
    <div class="subtitle">${escapeHtml(c.county)} · Pop ${c.total_pop.toLocaleString()} · ${c.total_ohu.toLocaleString()} households</div>

    <div class="tags">${tags.join(" ")}</div>

    <div class="section"><h3>Food Desert Status</h3></div>
    <div class="metrics-grid">
      <div class="metric-card"><div class="big ${desertClass(fd.pct_1and10)}">${fd.pct_1and10}%</div><div class="small">Tracts that are food deserts (1&10mi)</div></div>
      <div class="metric-card"><div class="big ${desertClass(fd.pct_half10)}">${fd.pct_half10}%</div><div class="small">Tracts (½&10mi measure)</div></div>
      <div class="metric-card"><div class="big">${fd.tracts_1and10}</div><div class="small">Food desert tracts (1&10mi)</div></div>
      <div class="metric-card"><div class="big">${fd.tracts_vehicle}</div><div class="small">Vehicle-access food deserts</div></div>
    </div>

    <div class="section"><h3>Supermarket Access</h3></div>
    ${barRow("Population beyond 1mi urban / 10mi rural", la.pop_pct_1and10, "var(--warn)")}
    ${barRow("Low-income pop beyond 1mi / 10mi", la.lowi_pct_1and10, "var(--bad)")}

    <div class="section" style="margin-top:16px"><h3>Socioeconomic Indicators</h3></div>
    <div class="metrics-grid">
      <div class="metric-card"><div class="big ${c.avg_poverty_rate >= 25 ? 'bad' : c.avg_poverty_rate >= 15 ? 'warn' : 'good'}">${c.avg_poverty_rate}%</div><div class="small">Poverty Rate</div></div>
      <div class="metric-card"><div class="big">${c.avg_median_family_income ? "$" + c.avg_median_family_income.toLocaleString() : "—"}</div><div class="small">Median Family Income</div></div>
      <div class="metric-card"><div class="big ${c.snap_rate >= 25 ? 'bad' : c.snap_rate >= 15 ? 'warn' : 'good'}">${c.snap_rate}%</div><div class="small">SNAP Participation</div></div>
      <div class="metric-card"><div class="big ${c.no_vehicle_rate >= 15 ? 'bad' : c.no_vehicle_rate >= 8 ? 'warn' : 'good'}">${c.no_vehicle_rate}%</div><div class="small">No Vehicle Access</div></div>
      <div class="metric-card"><div class="big">${c.low_income_share}%</div><div class="small">Low-Income Share</div></div>
    </div>

    <div class="section"><h3>Low-Access Population Breakdown</h3></div>
    <div class="metrics-grid">
      <div class="metric-card"><div class="big">${la.pop_1and10.toLocaleString()}</div><div class="small">People beyond 1mi/10mi</div></div>
      <div class="metric-card"><div class="big">${la.lowi_1and10.toLocaleString()}</div><div class="small">Low-income beyond 1mi/10mi</div></div>
      <div class="metric-card"><div class="big">${t.low_income_pop.toLocaleString()}</div><div class="small">Total low-income</div></div>
      <div class="metric-card"><div class="big">${t.no_vehicle_ohu.toLocaleString()}</div><div class="small">HHs without vehicle</div></div>
    </div>

    ${c.worst_desert_tracts && c.worst_desert_tracts.length > 0 ? `
    <div class="section"><h3>Largest Food Desert Tracts</h3></div>
    <div class="results" style="max-width:none">
      ${c.worst_desert_tracts.map(t => `
        <div class="result-item" style="cursor:default">
          <div>
            <div class="name">Tract ${escapeHtml(t.tract)}</div>
            <div class="location">${t.urban ? "Urban" : "Rural"} · Pop ${t.pop.toLocaleString()} · ${t.poverty}% poverty</div>
          </div>
        </div>
      `).join("")}
    </div>` : ""}

    <div class="source-note" style="margin-top:20px;padding:10px">
      "Food desert" = Low-Income, Low-Access tract. Distance thresholds: 1 mile (urban) or 10 miles (rural) from nearest supermarket.
    </div>
  `;
}

// ── Utils ──

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ── Init ──

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("search-input").focus();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== document.getElementById("search-input")) {
    e.preventDefault();
    document.getElementById("search-input").focus();
  }
  if (e.key === "Escape") {
    hideDetail();
    document.getElementById("search-input").focus();
  }
});
