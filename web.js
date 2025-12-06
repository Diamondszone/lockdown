// web.js
import express from "express";
import axios from "axios";

// ======================== CONFIG ===========================
const SOURCE_URL =
  process.env.SOURCE_URL ||
  "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";

const CORS_PROXY =
  process.env.CORS_PROXY ||
  "https://cors-anywhere-railway-production.up.railway.app";

// ======================== DATA STRUCTURE ===========================
const clients = [];
const successUrls = new Set();
const failedUrls = new Set();
let stats = {
  totalHits: 0,
  success: 0,
  failed: 0,
  lastUpdate: new Date().toISOString()
};

// ======================== BROADCAST SYSTEM ===========================
function broadcastLog(msg, type = "info") {
  const line = {
    id: Date.now(),
    time: new Date().toISOString(),
    message: msg,
    type: type // info, success, error
  };
  
  console.log(`[${line.time}] ${msg}`);

  // broadcast ke dashboard (hanya realtime, tidak simpan di memori)
  for (const client of clients) {
    client.res.write(`data: ${JSON.stringify(line)}\n\n`);
  }
}

function broadcastStats() {
  const statData = {
    type: "stats",
    data: {
      ...stats,
      successUrls: Array.from(successUrls).slice(-50), // simpan 50 terakhir
      failedUrls: Array.from(failedUrls).slice(-50),   // simpan 50 terakhir
      uniqueSuccess: successUrls.size,
      uniqueFailed: failedUrls.size
    }
  };
  
  for (const client of clients) {
    client.res.write(`data: ${JSON.stringify(statData)}\n\n`);
  }
}

// ======================== PARSER ===========================
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
      text:
        typeof resp.data === "string"
          ? resp.data
          : JSON.stringify(resp.data),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};

const buildProxyUrl = (u) => `${CORS_PROXY}/${u}`;

// ======================== HIT URL (Realtime Log) ===========================
async function hitUrl(url) {
  stats.totalHits++;
  
  const direct = await fetchText(url);
  const directOk = direct.ok && !isCaptcha(direct.text) && isJson(direct.text);

  if (directOk) {
    stats.success++;
    successUrls.add(url);
    failedUrls.delete(url);
    broadcastLog(`✅ ${url}`, "success");
    broadcastStats();
    return { success: true, method: "direct", url };
  }

  const proxied = await fetchText(buildProxyUrl(url));
  const proxyOk =
    proxied.ok && !isCaptcha(proxied.text) && isJson(proxied.text);

  if (proxyOk) {
    stats.success++;
    successUrls.add(url);
    failedUrls.delete(url);
    broadcastLog(`✅ ${url} (via Proxy)`, "success");
    broadcastStats();
    return { success: true, method: "proxy", url };
  } else {
    stats.failed++;
    failedUrls.add(url);
    successUrls.delete(url);
    broadcastLog(`❌ ${url}`, "error");
    broadcastStats();
    return { success: false, url };
  }
}

// ======================== WORKER NON-BLOCKING ===========================
async function mainLoop() {
  const WORKERS = 20;
  const MAX_PARALLEL = 4;

  while (true) {
    try {
      // Ambil list
      const listResp = await fetchText(SOURCE_URL);
      const urls = listResp.ok ? parseList(listResp.text) : [];

      if (urls.length === 0) {
        broadcastLog("❌ SOURCE kosong → ulangi loop...", "error");
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      broadcastLog(`📌 Memuat ${urls.length} URL…`, "info");

      let current = 0;

      async function worker() {
        while (true) {
          const batch = [];

          for (let i = 0; i < MAX_PARALLEL; i++) {
            let u = urls[current++];
            if (!u) break;
            batch.push(hitUrl(u));
          }

          if (batch.length === 0) break;

          await Promise.race(batch);
          await new Promise((r) => setTimeout(r, 5));
        }
      }

      const pool = [];
      for (let i = 0; i < WORKERS; i++) pool.push(worker());

      await Promise.all(pool);
      
      broadcastLog(`🔄 Loop selesai, mulai ulang...`, "info");
      
    } catch (err) {
      broadcastLog("❌ ERROR LOOP: " + err.message, "error");
      await new Promise(r => setTimeout(r, 10000));
    }
  }
}

// ======================== DASHBOARD WEB ===========================
const app = express();

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>⚡ JSON Checker Pro Dashboard</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      background: linear-gradient(135deg, #0a0a0f 0%, #151522 100%);
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      color: #e0e0ff;
      min-height: 100vh;
      overflow-x: hidden;
    }

    /* HEADER */
    .header {
      background: rgba(10, 10, 20, 0.95);
      backdrop-filter: blur(10px);
      border-bottom: 1px solid rgba(86, 247, 196, 0.2);
      padding: 20px 30px;
      box-shadow: 0 5px 30px rgba(0, 0, 0, 0.5);
      position: sticky;
      top: 0;
      z-index: 1000;
    }

    .title-container {
      display: flex;
      align-items: center;
      gap: 15px;
      margin-bottom: 15px;
    }

    .logo {
      color: #56f7c4;
      font-size: 28px;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }

    .title {
      font-size: 28px;
      font-weight: 800;
      background: linear-gradient(90deg, #56f7c4, #2af598);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      text-shadow: 0 0 30px rgba(86, 247, 196, 0.3);
    }

    .subtitle {
      font-size: 14px;
      color: #88aaff;
      opacity: 0.9;
    }

    /* STATS GRID */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-top: 20px;
    }

    .stat-card {
      background: rgba(20, 20, 30, 0.8);
      border: 1px solid rgba(86, 247, 196, 0.1);
      border-radius: 12px;
      padding: 18px;
      transition: all 0.3s ease;
    }

    .stat-card:hover {
      transform: translateY(-3px);
      border-color: rgba(86, 247, 196, 0.3);
      box-shadow: 0 5px 20px rgba(86, 247, 196, 0.1);
    }

    .stat-card.success {
      border-left: 4px solid #2af598;
    }

    .stat-card.fail {
      border-left: 4px solid #ff6b9d;
    }

    .stat-card.total {
      border-left: 4px solid #56a8f7;
    }

    .stat-label {
      font-size: 12px;
      color: #aaccff;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 8px;
    }

    .stat-value {
      font-size: 32px;
      font-weight: 800;
      margin-bottom: 5px;
    }

    .stat-success { color: #2af598; }
    .stat-fail { color: #ff6b9d; }
    .stat-total { color: #56a8f7; }

    /* MAIN CONTENT */
    .main-content {
      display: flex;
      padding: 20px;
      gap: 20px;
      height: calc(100vh - 250px);
    }

    /* TABS */
    .tabs {
      display: flex;
      background: rgba(20, 20, 30, 0.8);
      border-radius: 12px;
      padding: 5px;
      margin-bottom: 20px;
      border: 1px solid rgba(86, 247, 196, 0.1);
    }

    .tab {
      flex: 1;
      padding: 12px 20px;
      text-align: center;
      cursor: pointer;
      border-radius: 8px;
      transition: all 0.3s ease;
      font-weight: 600;
      color: #88aaff;
    }

    .tab.active {
      background: rgba(86, 247, 196, 0.15);
      color: #56f7c4;
      box-shadow: 0 2px 10px rgba(86, 247, 196, 0.2);
    }

    .tab:hover:not(.active) {
      background: rgba(86, 247, 196, 0.05);
    }

    /* TAB CONTENT */
    .tab-content {
      display: none;
      height: 100%;
    }

    .tab-content.active {
      display: block;
    }

    /* LOG PANEL */
    .log-panel {
      flex: 2;
      background: rgba(10, 10, 15, 0.9);
      border-radius: 15px;
      border: 1px solid rgba(86, 247, 196, 0.15);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    }

    .log-header {
      padding: 15px 20px;
      background: rgba(20, 20, 30, 0.9);
      border-bottom: 1px solid rgba(86, 247, 196, 0.1);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .log-controls button {
      background: rgba(86, 247, 196, 0.1);
      border: 1px solid rgba(86, 247, 196, 0.3);
      color: #56f7c4;
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.3s ease;
      font-weight: 600;
    }

    .log-controls button:hover {
      background: rgba(86, 247, 196, 0.2);
      transform: scale(1.05);
    }

    .log-box {
      flex: 1;
      padding: 20px;
      overflow-y: auto;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.5;
    }

    /* URL LIST PANEL */
    .url-panel {
      flex: 1;
      background: rgba(10, 10, 15, 0.9);
      border-radius: 15px;
      border: 1px solid rgba(86, 247, 196, 0.15);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    }

    .url-list {
      flex: 1;
      padding: 20px;
      overflow-y: auto;
    }

    .url-item {
      padding: 12px 15px;
      margin-bottom: 10px;
      background: rgba(20, 20, 30, 0.7);
      border-radius: 8px;
      border-left: 4px solid;
      word-break: break-all;
      transition: all 0.3s ease;
    }

    .url-item:hover {
      transform: translateX(5px);
      background: rgba(20, 20, 30, 0.9);
    }

    .url-item.success {
      border-left-color: #2af598;
    }

    .url-item.fail {
      border-left-color: #ff6b9d;
    }

    .url-time {
      font-size: 11px;
      color: #88aaff;
      margin-bottom: 5px;
    }

    .url-text {
      font-size: 12px;
    }

    /* LOG ITEMS */
    .log-item {
      padding: 10px 15px;
      margin-bottom: 10px;
      border-radius: 8px;
      background: rgba(20, 20, 30, 0.7);
      border-left: 4px solid;
      animation: fadeIn 0.3s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .log-item.info {
      border-left-color: #56a8f7;
      color: #aaccff;
    }

    .log-item.success {
      border-left-color: #2af598;
      color: #aaffcc;
    }

    .log-item.error {
      border-left-color: #ff6b9d;
      color: #ffaacc;
    }

    .log-time {
      font-size: 11px;
      color: #88aaff;
      margin-bottom: 3px;
    }

    .log-message {
      font-size: 13px;
    }

    /* SCROLLBAR */
    ::-webkit-scrollbar {
      width: 8px;
    }

    ::-webkit-scrollbar-track {
      background: rgba(20, 20, 30, 0.5);
      border-radius: 4px;
    }

    ::-webkit-scrollbar-thumb {
      background: rgba(86, 247, 196, 0.3);
      border-radius: 4px;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: rgba(86, 247, 196, 0.5);
    }

    /* RESPONSIVE */
    @media (max-width: 1024px) {
      .main-content {
        flex-direction: column;
        height: auto;
      }
      
      .log-panel, .url-panel {
        height: 500px;
      }
    }
  </style>
</head>

<body>
  <div class="header">
    <div class="title-container">
      <div class="logo">
        <i class="fas fa-bolt"></i>
      </div>
      <div>
        <div class="title">JSON Checker Pro Dashboard</div>
        <div class="subtitle">Realtime Monitoring & Analytics</div>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card total">
        <div class="stat-label">Total Hits</div>
        <div class="stat-value stat-total" id="s-total">0</div>
        <div class="stat-sub">Live Requests</div>
      </div>
      
      <div class="stat-card success">
        <div class="stat-label">Success</div>
        <div class="stat-value stat-success" id="s-success">0</div>
        <div class="stat-sub" id="s-success-percent">0% Success Rate</div>
      </div>
      
      <div class="stat-card fail">
        <div class="stat-label">Failed</div>
        <div class="stat-value stat-fail" id="s-fail">0</div>
        <div class="stat-sub" id="s-fail-percent">0% Failure Rate</div>
      </div>
      
      <div class="stat-card">
        <div class="stat-label">Unique URLs</div>
        <div class="stat-value stat-total" id="s-unique">0</div>
        <div class="stat-sub" id="s-urls">0 Success / 0 Failed</div>
      </div>
    </div>
  </div>

  <div class="main-content">
    <!-- LEFT PANEL: LOGS -->
    <div class="log-panel">
      <div class="log-header">
        <div style="font-size: 18px; font-weight: 600; color: #56f7c4;">
          <i class="fas fa-stream"></i> Real-time Logs
        </div>
        <div class="log-controls">
          <button onclick="clearLogs()">
            <i class="fas fa-trash"></i> Clear Logs
          </button>
        </div>
      </div>
      
      <div class="tabs">
        <div class="tab active" onclick="switchTab('all-logs')">All Logs</div>
        <div class="tab" onclick="switchTab('success-logs')">Success Only</div>
        <div class="tab" onclick="switchTab('error-logs')">Errors Only</div>
      </div>
      
      <div class="log-box" id="log-box"></div>
    </div>

    <!-- RIGHT PANEL: URL LISTS -->
    <div class="url-panel">
      <div class="log-header">
        <div style="font-size: 18px; font-weight: 600; color: #56f7c4;">
          <i class="fas fa-link"></i> URL Status
        </div>
        <div class="log-controls">
          <button onclick="refreshStats()">
            <i class="fas fa-sync-alt"></i> Refresh
          </button>
        </div>
      </div>
      
      <div class="tabs">
        <div class="tab active" onclick="switchUrlTab('success-urls')">
          <i class="fas fa-check-circle"></i> Success URLs
          <span id="success-count" class="badge">0</span>
        </div>
        <div class="tab" onclick="switchUrlTab('failed-urls')">
          <i class="fas fa-times-circle"></i> Failed URLs
          <span id="fail-count" class="badge">0</span>
        </div>
      </div>
      
      <div class="url-list" id="url-list">
        <!-- URL lists will be populated here -->
      </div>
    </div>
  </div>

  <script>
    let logs = [];
    let currentTab = 'all-logs';
    let currentUrlTab = 'success-urls';
    let statsData = {
      totalHits: 0,
      success: 0,
      failed: 0,
      uniqueSuccess: 0,
      uniqueFailed: 0
    };

    const logBox = document.getElementById('log-box');
    const urlList = document.getElementById('url-list');
    const evt = new EventSource("/stream");

    // Update stats display
    function updateStatsDisplay() {
      const total = statsData.totalHits;
      const success = statsData.success;
      const failed = statsData.failed;
      const uniqueTotal = statsData.uniqueSuccess + statsData.uniqueFailed;
      
      document.getElementById('s-total').textContent = total.toLocaleString();
      document.getElementById('s-success').textContent = success.toLocaleString();
      document.getElementById('s-fail').textContent = failed.toLocaleString();
      document.getElementById('s-unique').textContent = uniqueTotal.toLocaleString();
      document.getElementById('s-urls').textContent = 
        \`\${statsData.uniqueSuccess.toLocaleString()} / \${statsData.uniqueFailed.toLocaleString()}\`;
      
      // Update percentages
      if (total > 0) {
        const successPercent = ((success / total) * 100).toFixed(1);
        const failPercent = ((failed / total) * 100).toFixed(1);
        document.getElementById('s-success-percent').textContent = \`\${successPercent}% Success Rate\`;
        document.getElementById('s-fail-percent').textContent = \`\${failPercent}% Failure Rate\`;
      }
      
      // Update badge counts
      document.getElementById('success-count').textContent = statsData.uniqueSuccess;
      document.getElementById('fail-count').textContent = statsData.uniqueFailed;
    }

    // Add log to display
    function addLog(log) {
      logs.unshift(log);
      
      // Keep only last 200 logs in memory
      if (logs.length > 200) {
        logs = logs.slice(0, 200);
      }
      
      // Filter based on current tab
      let filteredLogs = logs;
      if (currentTab === 'success-logs') {
        filteredLogs = logs.filter(l => l.type === 'success');
      } else if (currentTab === 'error-logs') {
        filteredLogs = logs.filter(l => l.type === 'error');
      }
      
      // Update log display
      logBox.innerHTML = filteredLogs.map(log => \`
        <div class="log-item \${log.type}">
          <div class="log-time">\${new Date(log.time).toLocaleTimeString()}</div>
          <div class="log-message">\${log.message}</div>
        </div>
      \`).join('');
      
      // Auto-scroll
      logBox.scrollTop = 0;
    }

    // Update URL lists
    function updateUrlLists(data) {
      statsData = {
        ...statsData,
        ...data
      };
      
      updateStatsDisplay();
      
      // Show appropriate URL list based on current tab
      if (currentUrlTab === 'success-urls') {
        const urls = data.successUrls || [];
        urlList.innerHTML = urls.map(url => \`
          <div class="url-item success">
            <div class="url-time">Last Checked: \${new Date().toLocaleTimeString()}</div>
            <div class="url-text">\${url}</div>
          </div>
        \`).join('');
      } else {
        const urls = data.failedUrls || [];
        urlList.innerHTML = urls.map(url => \`
          <div class="url-item fail">
            <div class="url-time">Last Checked: \${new Date().toLocaleTimeString()}</div>
            <div class="url-text">\${url}</div>
          </div>
        \`).join('');
      }
    }

    // Tab switching
    function switchTab(tabName) {
      currentTab = tabName;
      document.querySelectorAll('.tabs .tab').forEach(tab => {
        tab.classList.remove('active');
      });
      event.target.classList.add('active');
      
      // Refresh logs display
      if (logs.length > 0) {
        const filteredLogs = tabName === 'all-logs' ? logs :
                           tabName === 'success-logs' ? logs.filter(l => l.type === 'success') :
                           logs.filter(l => l.type === 'error');
        
        logBox.innerHTML = filteredLogs.map(log => \`
          <div class="log-item \${log.type}">
            <div class="log-time">\${new Date(log.time).toLocaleTimeString()}</div>
            <div class="log-message">\${log.message}</div>
          </div>
        \`).join('');
      }
    }

    function switchUrlTab(tabName) {
      currentUrlTab = tabName;
      document.querySelectorAll('.url-panel .tabs .tab').forEach(tab => {
        tab.classList.remove('active');
      });
      event.target.classList.add('active');
      
      // Trigger update with current data
      updateUrlLists(statsData);
    }

    // Clear logs function
    function clearLogs() {
      logs = [];
      logBox.innerHTML = '<div class="log-item info"><div class="log-message">Logs cleared</div></div>';
    }

    function refreshStats() {
      // This would trigger a stats refresh from server if needed
      fetch('/stats').then(r => r.json()).then(updateUrlLists);
    }

    // Event Source Listener
    evt.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        
        if (data.type === 'stats') {
          updateUrlLists(data.data);
        } else {
          addLog(data);
        }
      } catch (err) {
        console.error('Error parsing SSE data:', err);
      }
    };

    evt.onerror = (err) => {
      console.error('SSE Error:', err);
      addLog({
        id: Date.now(),
        time: new Date().toISOString(),
        message: '❌ Connection lost, attempting to reconnect...',
        type: 'error'
      });
    };

    // Initial display
    addLog({
      id: Date.now(),
      time: new Date().toISOString(),
      message: '🚀 Dashboard initialized and ready',
      type: 'info'
    });
  </script>
</body>
</html>
  `);
});

// ======================== STATS ENDPOINT ===========================
app.get("/stats", (req, res) => {
  res.json({
    totalHits: stats.totalHits,
    success: stats.success,
    failed: stats.failed,
    uniqueSuccess: successUrls.size,
    uniqueFailed: failedUrls.size,
    successUrls: Array.from(successUrls).slice(-50),
    failedUrls: Array.from(failedUrls).slice(-50),
    lastUpdate: stats.lastUpdate
  });
});

// ======================== SSE STREAM ===========================
app.get("/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  res.flushHeaders();
  res.write(": connected\n\n");

  const client = { res };
  clients.push(client);

  // Send initial stats
  res.write(`data: ${JSON.stringify({
    type: "stats",
    data: {
      ...stats,
      successUrls: Array.from(successUrls).slice(-50),
      failedUrls: Array.from(failedUrls).slice(-50),
      uniqueSuccess: successUrls.size,
      uniqueFailed: failedUrls.size
    }
  })}\n\n`);

  req.on("close", () => {
    clients.splice(clients.indexOf(client), 1);
  });
});

// ======================== START ===========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  broadcastLog(`🌐 Dashboard aktif di port ${PORT}`, "info");
});

// Start main loop
mainLoop();
