// web.js (SUPER PREMIUM)
// ---------------------------------------------
// Realtime URL Runner + Super Premium Dashboard
// Features:
// - parallel workers
// - queue refill + dedupe (seen Set)
// - logs OK / ERROR (50 latest)
// - SSE (/events) broadcasting: status & log events
// - endpoints: /status-log, /dashboard, /events, /pause, /resume, /toggle-pause, /download
// - dashboard: Chart.js, toast notifications, sound for errors, filter, pause/resume, fullscreen
// ---------------------------------------------

import express from "express";
import axios from "axios";
import { EventEmitter } from "events";

const SOURCE_URL =
  process.env.SOURCE_URL ||
  "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";

const CORS_PROXY =
  process.env.CORS_PROXY ||
  "https://cors-anywhere-railway-production.up.railway.app";

// ────────────── GLOBAL STATE ──────────────
let queue = [];
let seen = new Set();
let logOK = [];
let logError = [];
let loading = false;
const WORKERS = Number(process.env.WORKERS) || 20;
let paused = false;

const MAX_LOG = 50;
const eventBus = new EventEmitter();

// ────────────── HELPERS ──────────────
function parseList(txt) {
  return (txt || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isJson(body) {
  if (!body) return false;
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}

function isCaptcha(body) {
  if (!body) return false;
  const t = body.toLowerCase();
  return (
    t.includes("captcha") ||
    t.includes("verify you are human") ||
    t.includes("verification") ||
    t.includes("robot") ||
    t.includes("cloudflare")
  );
}

function pushLog(list, data) {
  list.push(data);
  if (list.length > MAX_LOG) list.shift();
}

// Simple sleep
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fetchText = async (url) => {
  try {
    const resp = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 20000,
      validateStatus: () => true,
      responseType: "text",
    });

    return {
      ok: true,
      text: typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};

const buildProxyUrl = (u) => `${CORS_PROXY}/${u}`;

// Broadcast helper (internal)
function broadcast(event, payload) {
  try {
    eventBus.emit("broadcast", { event, payload });
  } catch (e) {
    console.error("Broadcast error:", e.message);
  }
}

// ────────────── HIT URL ──────────────
async function hitUrl(url) {
  const ts = new Date().toISOString();

  const direct = await fetchText(url);
  const directOk = direct.ok && !isCaptcha(direct.text) && isJson(direct.text);

  if (directOk) {
    const data = { url, status: "Direct OK", time: ts };
    pushLog(logOK, data);
    broadcast("log", { type: "ok", item: data, queue_length: queue.length, processed_total: seen.size });
    return;
  }

  const proxied = await fetchText(buildProxyUrl(url));
  const proxyOk =
    proxied.ok && !isCaptcha(proxied.text) && isJson(proxied.text);

  if (proxyOk) {
    const data = { url, status: "Proxy OK", time: ts };
    pushLog(logOK, data);
    broadcast("log", { type: "ok", item: data, queue_length: queue.length, processed_total: seen.size });
  } else {
    const data = { url, status: "BUKAN JSON", time: ts };
    pushLog(logError, data);
    broadcast("log", { type: "error", item: data, queue_length: queue.length, processed_total: seen.size });
  }
}

// ────────────── REFILL QUEUE REALTIME ──────────────
async function refillQueue() {
  if (loading) return;
  loading = true;

  try {
    const resp = await fetchText(SOURCE_URL);
    const urls = resp.ok ? parseList(resp.text) : [];

    let added = 0;

    for (const u of urls) {
      if (!seen.has(u)) {
        seen.add(u);
        queue.push(u);
        added++;
      }
    }

    if (added > 0) {
      console.log(`📥 Queue bertambah unik: +${added}`);
      broadcast("status", { queue_length: queue.length, processed_total: seen.size });
    }
  } catch (err) {
    console.log("❌ ERROR refillQueue:", err.message);
  } finally {
    loading = false;
    setTimeout(refillQueue, 2000);
  }
}

// ────────────── WORKER ──────────────
async function worker(id) {
  while (true) {
    if (paused) {
      await sleep(500); // saat paused cek tiap 500ms
      continue;
    }

    const url = queue.shift();

    if (!url) {
      await sleep(100);
      continue;
    }

    try {
      await hitUrl(url);
    } catch (e) {
      console.log("❌ ERROR hitUrl:", e.message);
      // jika error throw, simpan ke logError
      const ts = new Date().toISOString();
      const data = { url, status: `ERROR: ${e.message}`, time: ts };
      pushLog(logError, data);
      broadcast("log", { type: "error", item: data, queue_length: queue.length, processed_total: seen.size });
    }

    // after each processed item, broadcast status update
    broadcast("status", { queue_length: queue.length, processed_total: seen.size });
  }
}

// ────────────── MAIN LOOP ──────────────
async function mainLoop() {
  console.log("⚙ Worker start...");
  refillQueue();

  for (let i = 0; i < WORKERS; i++) {
    worker(i + 1);
  }
}

// ────────────── EXPRESS SERVER ──────────────
const app = express();

app.get("/", (req, res) => res.send("URL Runner Active"));

// JSON API for dashboard initial snapshot
app.get("/status-log", (req, res) => {
  res.json({
    workers: WORKERS,
    queue_length: queue.length,
    processed_total: seen.size,
    timestamp: new Date().toISOString(),
    paused,
    ok: logOK.slice().reverse(),
    error: logError.slice().reverse()
  });
});

// SSE endpoint: /events
// Clients will keep connection open and receive events: 'status' and 'log'
app.get("/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();

  // send initial ping
  res.write(`event: connected\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);

  const listener = ({ event, payload }) => {
    try {
      const id = Date.now();
      res.write(`id: ${id}\n`);
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (e) {
      // ignore
    }
  };

  eventBus.on("broadcast", listener);

  req.on("close", () => {
    eventBus.off("broadcast", listener);
  });
});

// Pause/resume endpoints
app.post("/pause", (req, res) => {
  paused = true;
  broadcast("status", { queue_length: queue.length, processed_total: seen.size, paused });
  res.json({ ok: true, paused });
});

app.post("/resume", (req, res) => {
  paused = false;
  broadcast("status", { queue_length: queue.length, processed_total: seen.size, paused });
  res.json({ ok: true, paused });
});

app.post("/toggle-pause", (req, res) => {
  paused = !paused;
  broadcast("status", { queue_length: queue.length, processed_total: seen.size, paused });
  res.json({ ok: true, paused });
});

// Download logs as CSV
app.get("/download-logs", (req, res) => {
  const rows = [];
  rows.push(["time", "status", "url"].join(","));
  [...logOK, ...logError].forEach((r) => {
    // basic CSV escape
    const u = `"${(r.url || "").replace(/"/g, '""')}"`;
    const s = `"${(r.status || "").replace(/"/g, '""')}"`;
    const t = `"${(r.time || "")}"`;
    rows.push([t, s, u].join(","));
  });
  const csv = rows.join("\n");
  res.setHeader("Content-disposition", "attachment; filename=logs.csv");
  res.setHeader("Content-Type", "text/csv;charset=utf-8;");
  res.send(csv);
});

// ────────────── DASHBOARD SUPER PREMIUM (HTML with SSE + Chart + Toast + Sound) ──────────────
app.get("/dashboard", (req, res) => {
  res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>SUPER PREMIUM Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    :root{
      --bg:#07070a; --card:#0f1115; --muted:#9aa3b2; --accent:#00eaff; --ok:#00c853; --err:#ff3d00;
    }
    body{margin:0;font-family:Inter,Segoe UI,Arial;background:linear-gradient(180deg,#05050a 0%, #0b0b10 100%);color:#e6eef6;}
    .wrap{max-width:1200px;margin:20px auto;padding:20px}
    header{display:flex;align-items:center;gap:16px}
    h1{margin:0;font-size:22px;color:var(--accent)}
    .controls{margin-left:auto;display:flex;gap:8px;align-items:center}
    .btn{background:transparent;border:1px solid #222;padding:8px 12px;border-radius:8px;color:#e6eef6;cursor:pointer}
    .btn.primary{background:var(--accent);color:#000;border:none}
    .card{background:var(--card);border:1px solid #111;padding:16px;border-radius:12px;margin-top:16px;box-shadow:0 6px 30px rgba(0,0,0,0.6)}
    .grid{display:grid;grid-template-columns:1fr 420px;gap:16px}
    .small{font-size:13px;color:var(--muted)}
    .status-row{display:flex;gap:12px;flex-wrap:wrap}
    .stat{background:#081018;padding:10px;border-radius:10px;min-width:140px}
    table{width:100%;border-collapse:collapse;color:#dfeefd}
    th,td{padding:8px;border-bottom:1px dashed #101316;text-align:left;font-size:13px}
    th{color:var(--accent);font-weight:600}
    .url{color:#9ad3e8;word-break:break-all}
    .badge{padding:4px 8px;border-radius:7px;font-size:12px;color:#000;font-weight:700}
    .ok{background:var(--ok)}
    .err{background:var(--err)}
    .proxy{background:#2979ff;color:#fff}
    #toast{position:fixed;right:20px;bottom:20px;z-index:9999}
    .toast-item{background:#0b1220;padding:10px 14px;margin-top:8px;border-radius:8px;color:#fff;box-shadow:0 8px 30px rgba(0,0,0,0.6)}
    .toolbar{display:flex;gap:8px;align-items:center}
    .search{padding:8px;border-radius:8px;border:1px solid #222;background:#0b0f14;color:#e6eef6}
    .toggles{display:flex;gap:6px;align-items:center}
    .link{color:var(--accent);text-decoration:none}
    .footer{margin-top:20px;font-size:13px;color:var(--muted)}
    .fullscreen{margin-left:8px}
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>🚀 SUPER PREMIUM Realtime Dashboard</h1>
      <div class="controls">
        <div class="toolbar">
          <input id="filterInput" class="search" placeholder="Filter / search URL..." />
          <button id="pauseBtn" class="btn">Pause</button>
          <button id="resumeBtn" class="btn">Resume</button>
          <button id="toggleBtn" class="btn">Toggle</button>
          <button id="downloadBtn" class="btn">Download CSV</button>
          <button id="fullscreenBtn" class="btn">Fullscreen</button>
        </div>
      </div>
    </header>

    <div class="grid">
      <div>
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <div class="small">System Status</div>
              <div style="font-size:18px;margin-top:6px" id="statusMain">Loading...</div>
              <div class="small" id="lastUpdated"></div>
            </div>
            <div style="min-width:200px">
              <div class="small">Workers</div>
              <div style="font-size:20px" id="workersCount">-</div>
            </div>
          </div>

          <div style="margin-top:12px" class="status-row">
            <div class="stat"><div class="small">Queue</div><div id="qCount" style="font-size:18px">-</div></div>
            <div class="stat"><div class="small">Processed</div><div id="pCount" style="font-size:18px">-</div></div>
            <div class="stat"><div class="small">Paused</div><div id="pausedFlag" style="font-size:18px">-</div></div>
          </div>
        </div>

        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <div class="small">Queue Load (history)</div>
            </div>
            <div class="small">Auto updates via SSE</div>
          </div>
          <canvas id="queueChart" height="80"></canvas>
        </div>

        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div><div class="small">Logs Sukses (OK) — 50 terbaru</div></div>
            <div class="small">Auto-updates & filter</div>
          </div>
          <div style="max-height:260px;overflow:auto;margin-top:8px">
            <table><thead><tr><th>Waktu</th><th>Status</th><th>URL</th></tr></thead>
            <tbody id="okTable"></tbody></table>
          </div>
        </div>

        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div><div class="small">Logs Error — 50 terbaru</div></div>
            <div class="small">Sound & toast on new error</div>
          </div>
          <div style="max-height:260px;overflow:auto;margin-top:8px">
            <table><thead><tr><th>Waktu</th><th>Status</th><th>URL</th></tr></thead>
            <tbody id="errTable"></tbody></table>
          </div>
        </div>
      </div>

      <div>
        <div class="card">
          <div class="small">Quick Controls</div>
          <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px">
            <button id="pauseBtn2" class="btn">Pause</button>
            <button id="resumeBtn2" class="btn primary">Resume</button>
            <button id="clearSeen" class="btn">Clear Processed (seen)</button>
            <a id="downloadLink" class="btn link" href="/download-logs">Download Logs</a>
          </div>
        </div>

        <div class="card">
          <div class="small">Filters</div>
          <div style="margin-top:8px">
            <label class="small">Show: </label>
            <select id="showFilter" class="btn">
              <option value="all">All</option>
              <option value="ok">Only OK</option>
              <option value="error">Only Error</option>
            </select>
            <label style="margin-left:8px" class="small">Auto-scroll:</label>
            <input type="checkbox" id="autoscroll" checked />
          </div>
        </div>

        <div class="card">
          <div class="small">About</div>
          <div style="margin-top:8px;font-size:13px;color:#9bb0c9">
            Super Premium dashboard with SSE, sound, toast, filter, pause/resume and CSV download.<br>
            Deploy on Railway — open <a href="/dashboard" class="link">/dashboard</a>.
          </div>
        </div>

      </div>
    </div>

    <div id="toast"></div>
    <div class="footer">Made with ❤️ — Super Premium</div>
  </div>

<script>
  // Utility
  function $(id){return document.getElementById(id)}

  let queueHistory = [];
  const MAX_HISTORY = 60;
  let chart;
  let lastErrorId = null;

  // Initialize chart
  function initChart() {
    const ctx = $('queueChart').getContext('2d');
    chart = new Chart(ctx, {
      type: 'line',
      data: { labels:[], datasets:[{label:'Queue Size', data:[], borderColor:'#00eaff', borderWidth:2, fill:false}] },
      options: { animation:false, plugins:{legend:{display:false}}, scales:{x:{ticks:{color:'#888'}}, y:{ticks:{color:'#888'}} } }
    });
  }

  function updateChart(val) {
    queueHistory.push(val);
    if (queueHistory.length > MAX_HISTORY) queueHistory.shift();
    chart.data.labels = queueHistory.map((_,i)=>i+1);
    chart.data.datasets[0].data = queueHistory;
    chart.update();
  }

  // Toasts
  function toast(msg, timeout=5000){
    const container = $('toast');
    const el = document.createElement('div');
    el.className='toast-item';
    el.innerText = msg;
    container.appendChild(el);
    setTimeout(()=>{ el.remove(); }, timeout);
  }

  // Sound notification using WebAudio
  let audioCtx;
  function playBeep(freq=440, dur=0.12) {
    try {
      if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      o.connect(g);
      g.connect(audioCtx.destination);
      g.gain.value = 0.02;
      o.start();
      setTimeout(()=>{ o.stop(); }, dur*1000);
    } catch(e){
      // ignore
    }
  }

  // Render tables
  function renderTables(snapshot, filterText='', show='all', autoscroll=true) {
    const ok = snapshot.ok || [];
    const err = snapshot.error || [];

    const ft = filterText.trim().toLowerCase();

    const okRows = ok.filter(r => (show==='all' || show==='ok') && (r.url.toLowerCase().includes(ft) || r.status.toLowerCase().includes(ft)));
    const errRows = err.filter(r => (show==='all' || show==='error') && (r.url.toLowerCase().includes(ft) || r.status.toLowerCase().includes(ft)));

    $('okTable').innerHTML = okRows.map(r => \`<tr><td>\${r.time}</td><td><span class="badge ok">\${r.status}</span></td><td class="url">\${r.url}</td></tr>\`).join('');
    $('errTable').innerHTML = errRows.map(r => \`<tr><td>\${r.time}</td><td><span class="badge err">\${r.status}</span></td><td class="url">\${r.url}</td></tr>\`).join('');

    if (autoscroll) {
      const el = document.querySelector('#errTable').closest('div[style*="overflow:auto"]');
      if (el) el.scrollTop = el.scrollHeight;
    }
  }

  // Get initial snapshot
  async function fetchSnapshot() {
    try {
      const res = await fetch('/status-log');
      return await res.json();
    } catch(e){
      console.error('snapshot error', e);
      return null;
    }
  }

  // SSE connection
  function setupSSE() {
    const es = new EventSource('/events');
    es.addEventListener('connected', e => console.log('SSE connected', e.data));
    es.addEventListener('status', (e) => {
      try {
        const payload = JSON.parse(e.data);
        if ('queue_length' in payload) {
          $('qCount').innerText = payload.queue_length;
          $('pCount').innerText = payload.processed_total || 0;
          $('pausedFlag').innerText = payload.paused ? 'YES' : 'NO';
          $('lastUpdated').innerText = new Date().toLocaleString();
          updateChart(payload.queue_length);
        }
      } catch(err){}
    });
    es.addEventListener('log', (e) => {
      try {
        const payload = JSON.parse(e.data);
        // payload: { type: 'ok'|'error', item: {url,status,time}, queue_length, processed_total }
        // Refresh UI by re-fetching snapshot (cheap) OR apply incremental update
        applyIncremental(payload);
      } catch(err){}
    });
    es.onerror = (err)=> {
      console.warn('SSE error', err);
      // Try reconnect handled by EventSource automatically
    }
  }

  // Apply incremental event to UI & store minimal local state
  function applyIncremental(payload) {
    // update counters
    if (payload.queue_length !== undefined) {
      $('qCount').innerText = payload.queue_length;
      $('pCount').innerText = payload.processed_total || $('pCount').innerText;
      updateChart(payload.queue_length);
    }

    const filterText = $('filterInput').value || '';
    const show = $('showFilter').value || 'all';
    const autoscroll = $('autoscroll').checked;

    // If error -> show toast + sound
    if (payload.type === 'error' && payload.item) {
      toast('ERROR: ' + payload.item.url, 8000);
      playBeep(220, 0.14);
    } else if (payload.type === 'ok' && payload.item) {
      // small positive beep (optional)
      playBeep(800, 0.06);
    }

    // to keep consistent, re-fetch snapshot to avoid state diffs
    fetchSnapshot().then(snap => {
      if (!snap) return;
      renderTables(snap, filterText, show, autoscroll);
    });
  }

  // Setup UI actions
  function setupUI() {
    $('downloadBtn').onclick = ()=> { window.location.href = '/download-logs'; };
    $('pauseBtn').onclick = ()=> fetch('/pause',{method:'POST'}).then(()=>updateStatus());
    $('pauseBtn2').onclick = ()=> fetch('/pause',{method:'POST'}).then(()=>updateStatus());
    $('resumeBtn').onclick = ()=> fetch('/resume',{method:'POST'}).then(()=>updateStatus());
    $('resumeBtn2').onclick = ()=> fetch('/resume',{method:'POST'}).then(()=>updateStatus());
    $('toggleBtn').onclick = ()=> fetch('/toggle-pause',{method:'POST'}).then(()=>updateStatus());
    $('clearSeen').onclick = ()=>{
      if (!confirm('Clear seen (processed) set? This will allow already-processed URLs to be re-added by source later. Continue?')) return;
      fetch('/internal-clear-seen', {method:'POST'}).then(()=>{ toast('Cleared seen'); updateStatus(); });
    };
    $('fullscreenBtn').onclick = ()=>{
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(()=>{});
      else document.exitFullscreen().catch(()=>{});
    };
    $('filterInput').oninput = ()=> {
      fetchSnapshot().then(snap => { if (snap) renderTables(snap, $('filterInput').value, $('showFilter').value, $('autoscroll').checked); });
    };
    $('showFilter').onchange = ()=> {
      fetchSnapshot().then(snap => { if (snap) renderTables(snap, $('filterInput').value, $('showFilter').value, $('autoscroll').checked); });
    };
  }

  async function updateStatus() {
    const snap = await fetchSnapshot();
    if (!snap) return;
    $('workersCount').innerText = snap.workers;
    $('qCount').innerText = snap.queue_length;
    $('pCount').innerText = snap.processed_total;
    $('pausedFlag').innerText = snap.paused ? 'YES' : 'NO';
    $('statusMain').innerText = snap.paused ? 'PAUSED' : 'RUNNING';
    $('lastUpdated').innerText = new Date(snap.timestamp).toLocaleString();
    renderTables(snap, $('filterInput').value, $('showFilter').value, $('autoscroll').checked);
    updateChart(snap.queue_length || 0);
  }

  // Fallback endpoint to clear seen (internal). We'll implement server-side route.
  // Kickstart
  initChart();
  setupUI();
  updateStatus();
  setupSSE();

</script>
</body>
</html>`);
});

// Internal endpoint to clear seen (useful control) - protected lightly by require confirmation in UI
app.post("/internal-clear-seen", (req, res) => {
  seen = new Set();
  logOK = [];
  logError = [];
  broadcast("status", { queue_length: queue.length, processed_total: seen.size, paused });
  res.json({ ok: true });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🌐 Web server OK on port", PORT);
});

// start workers
mainLoop();
