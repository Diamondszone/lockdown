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
const successUrls = new Map(); // url -> count
const failedUrls = new Map();   // url -> count
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
    time: new Date().toLocaleTimeString(),
    message: msg,
    type: type // info, success, error
  };
  
  console.log(`[${line.time}] ${msg}`);

  // broadcast ke dashboard
  for (const client of clients) {
    client.res.write(`data: ${JSON.stringify(line)}\n\n`);
  }
}

function broadcastStats() {
  const statData = {
    type: "stats",
    data: {
      ...stats,
      successRate: stats.totalHits > 0 ? ((stats.success / stats.totalHits) * 100).toFixed(1) : "0.0",
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
      timeout: 15000, // Turun dari 20s ke 15s
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

// ======================== HIT URL ===========================
async function hitUrl(url) {
  stats.totalHits++;
  stats.lastUpdate = new Date().toISOString();
  
  const direct = await fetchText(url);
  const directOk = direct.ok && !isCaptcha(direct.text) && isJson(direct.text);

  if (directOk) {
    stats.success++;
    successUrls.set(url, (successUrls.get(url) || 0) + 1);
    failedUrls.delete(url);
    broadcastLog(`✅ ${url}`, "success");
    return { success: true, method: "direct", url };
  }

  const proxied = await fetchText(buildProxyUrl(url));
  const proxyOk = proxied.ok && !isCaptcha(proxied.text) && isJson(proxied.text);

  if (proxyOk) {
    stats.success++;
    successUrls.set(url, (successUrls.get(url) || 0) + 1);
    failedUrls.delete(url);
    broadcastLog(`✅ ${url} (Proxy)`, "success");
    return { success: true, method: "proxy", url };
  } else {
    stats.failed++;
    failedUrls.set(url, (failedUrls.get(url) || 0) + 1);
    successUrls.delete(url);
    broadcastLog(`❌ ${url}`, "error");
    return { success: false, url };
  }
}

// ======================== WORKER NON-BLOCKING (SAMA DENGAN CODE LAMA) ===========================
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
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }

      broadcastLog(`📌 Memuat ${urls.length} URL…`, "info");
      
      // Broadcast stats sebelum mulai
      broadcastStats();

      let current = 0;

      async function worker() {
        while (true) {
          const batch = [];

          for (let i = 0; i < MAX_PARALLEL; i++) {
            let u = urls[current++];
            if (!u) break;
            batch.push(hitUrl(u)); // TIDAK menunggu → realtime log
          }

          if (batch.length === 0) break;

          // Menunggu salah satu selesai (bukan semuanya) - SAMA DENGAN CODE LAMA
          await Promise.race(batch);

          // delay mikro agar CPU tidak 100%
          await new Promise((r) => setTimeout(r, 5));
        }
      }

      // jalankan worker
      const pool = [];
      for (let i = 0; i < WORKERS; i++) pool.push(worker());

      await Promise.all(pool);
      
      broadcastLog(`🔄 Loop selesai, mulai ulang...`, "info");
      // Broadcast stats setelah selesai
      broadcastStats();
      
      // Delay singkat sebelum loop berikutnya
      await new Promise(r => setTimeout(r, 100));
      
    } catch (err) {
      broadcastLog("❌ ERROR LOOP: " + err.message, "error");
      await new Promise(r => setTimeout(r, 5000));
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
  <title>JSON Checker Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    }

    body {
      background: #0f172a;
      color: #f8fafc;
      min-height: 100vh;
      overflow-x: hidden;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
    }

    /* Header */
    header {
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      border-radius: 16px;
      padding: 24px 32px;
      margin-bottom: 24px;
      border: 1px solid #334155;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    }

    .header-title {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 12px;
    }

    .header-title h1 {
      font-size: 32px;
      font-weight: 800;
      background: linear-gradient(135deg, #60a5fa, #a78bfa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.5px;
    }

    .header-title i {
      font-size: 36px;
      color: #60a5fa;
      filter: drop-shadow(0 0 10px rgba(96, 165, 250, 0.5));
    }

    .header-subtitle {
      color: #94a3b8;
      font-size: 15px;
      margin-bottom: 32px;
    }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin-bottom: 32px;
    }

    .stat-card {
      background: rgba(30, 41, 59, 0.8);
      border-radius: 14px;
      padding: 24px;
      border: 1px solid #334155;
      backdrop-filter: blur(10px);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      overflow: hidden;
    }

    .stat-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, #60a5fa, #a78bfa);
    }

    .stat-card:hover {
      transform: translateY(-5px);
      border-color: #60a5fa;
      box-shadow: 0 15px 30px rgba(0, 0, 0, 0.3);
    }

    .stat-label {
      font-size: 13px;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      margin-bottom: 12px;
      font-weight: 600;
    }

    .stat-value {
      font-size: 42px;
      font-weight: 900;
      margin-bottom: 8px;
      text-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
    }

    .stat-success { color: #34d399; }
    .stat-failed { color: #f87171; }
    .stat-total { color: #60a5fa; }
    .stat-unique { color: #a78bfa; }

    .stat-detail {
      font-size: 13px;
      color: #64748b;
      font-weight: 500;
    }

    /* Main Content */
    .main-content {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 28px;
      height: 65vh;
      margin-bottom: 32px;
    }

    @media (max-width: 1024px) {
      .main-content {
        grid-template-columns: 1fr;
        height: auto;
      }
    }

    /* Panel */
    .panel {
      background: rgba(30, 41, 59, 0.8);
      border-radius: 16px;
      border: 1px solid #334155;
      backdrop-filter: blur(10px);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    }

    .panel-header {
      padding: 20px 24px;
      background: rgba(15, 23, 42, 0.9);
      border-bottom: 1px solid #334155;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .panel-title {
      font-size: 20px;
      font-weight: 700;
      color: #e2e8f0;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .panel-actions {
      display: flex;
      gap: 12px;
    }

    .btn {
      padding: 10px 20px;
      border-radius: 10px;
      border: 1px solid #475569;
      background: linear-gradient(135deg, #334155, #1e293b);
      color: #e2e8f0;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .btn:hover {
      background: linear-gradient(135deg, #475569, #334155);
      border-color: #64748b;
      transform: scale(1.05);
    }

    .btn:active {
      transform: scale(0.95);
    }

    .btn-clear {
      background: linear-gradient(135deg, #dc2626, #b91c1c);
      border-color: #ef4444;
      color: white;
    }

    .btn-clear:hover {
      background: linear-gradient(135deg, #ef4444, #dc2626);
      border-color: #f87171;
    }

    /* Log Panel */
    .log-panel {
      height: 100%;
    }

    .log-content {
      flex: 1;
      padding: 0;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }

    .log-item {
      padding: 16px 20px;
      border-bottom: 1px solid rgba(51, 65, 85, 0.5);
      font-size: 14px;
      line-height: 1.5;
      animation: fadeIn 0.5s ease-out;
      transition: all 0.2s ease;
    }

    .log-item:hover {
      background: rgba(30, 41, 59, 0.5);
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .log-item.info {
      border-left: 4px solid #60a5fa;
      background: rgba(96, 165, 250, 0.05);
    }

    .log-item.success {
      border-left: 4px solid #34d399;
      background: rgba(52, 211, 153, 0.05);
    }

    .log-item.error {
      border-left: 4px solid #f87171;
      background: rgba(248, 113, 113, 0.05);
    }

    .log-time {
      font-size: 12px;
      color: #94a3b8;
      margin-bottom: 4px;
      font-family: 'Courier New', monospace;
      font-weight: 500;
    }

    .log-message {
      word-break: break-all;
      color: #f1f5f9;
    }

    /* URL Panel */
    .url-panel {
      height: 100%;
    }

    .url-tabs {
      display: flex;
      background: rgba(15, 23, 42, 0.9);
      border-bottom: 1px solid #334155;
    }

    .url-tab {
      flex: 1;
      padding: 16px 20px;
      text-align: center;
      cursor: pointer;
      font-size: 15px;
      font-weight: 600;
      color: #94a3b8;
      transition: all 0.2s ease;
      border-bottom: 3px solid transparent;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
    }

    .url-tab:hover {
      background: rgba(30, 41, 59, 0.5);
      color: #e2e8f0;
    }

    .url-tab.active {
      color: #60a5fa;
      border-bottom-color: #60a5fa;
      background: rgba(30, 41, 59, 0.8);
    }

    .badge {
      background: #475569;
      color: #f8fafc;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 700;
      min-width: 28px;
    }

    .url-content {
      flex: 1;
      padding: 0;
      overflow-y: auto;
    }

    .url-list {
      display: flex;
      flex-direction: column;
    }

    .url-item {
      padding: 16px 20px;
      border-bottom: 1px solid rgba(51, 65, 85, 0.5);
      font-size: 13px;
      line-height: 1.5;
      transition: all 0.2s ease;
    }

    .url-item:hover {
      background: rgba(30, 41, 59, 0.5);
    }

    .url-item.success {
      border-left: 4px solid #34d399;
      background: rgba(52, 211, 153, 0.05);
    }

    .url-item.failed {
      border-left: 4px solid #f87171;
      background: rgba(248, 113, 113, 0.05);
    }

    .url-text {
      word-break: break-all;
      margin-bottom: 6px;
      color: #f1f5f9;
      font-weight: 500;
    }

    .url-meta {
      font-size: 12px;
      color: #94a3b8;
      display: flex;
      justify-content: space-between;
      font-weight: 500;
    }

    /* Scrollbar */
    ::-webkit-scrollbar {
      width: 10px;
    }

    ::-webkit-scrollbar-track {
      background: rgba(30, 41, 59, 0.5);
      border-radius: 5px;
    }

    ::-webkit-scrollbar-thumb {
      background: linear-gradient(135deg, #60a5fa, #a78bfa);
      border-radius: 5px;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: linear-gradient(135deg, #a78bfa, #60a5fa);
    }

    /* Footer */
    footer {
      text-align: center;
      color: #64748b;
      font-size: 13px;
      padding: 20px;
      border-top: 1px solid #334155;
      margin-top: 20px;
    }

    .status-indicator {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }

    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #34d399;
    }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #94a3b8;
    }

    .empty-state i {
      font-size: 48px;
      margin-bottom: 16px;
      opacity: 0.5;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="header-title">
        <i>⚡</i>
        <h1>JSON Checker Dashboard</h1>
      </div>
      <div class="header-subtitle">
        Real-time monitoring of JSON endpoints with automatic proxy fallback
      </div>
      
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Total Hits</div>
          <div class="stat-value stat-total" id="total-hits">0</div>
          <div class="stat-detail">Total requests processed</div>
        </div>
        
        <div class="stat-card">
          <div class="stat-label">Success Rate</div>
          <div class="stat-value stat-success" id="success-rate">0%</div>
          <div class="stat-detail"><span id="success-count">0</span> successful hits</div>
        </div>
        
        <div class="stat-card">
          <div class="stat-label">Failure Rate</div>
          <div class="stat-value stat-failed" id="failure-rate">0%</div>
          <div class="stat-detail"><span id="failed-count">0</span> failed hits</div>
        </div>
        
        <div class="stat-card">
          <div class="stat-label">Active URLs</div>
          <div class="stat-value stat-unique" id="unique-urls">0</div>
          <div class="stat-detail"><span id="unique-success">0</span> success / <span id="unique-failed">0</span> failed</div>
        </div>
      </div>
    </header>

    <main class="main-content">
      <!-- Logs Panel -->
      <div class="panel log-panel">
        <div class="panel-header">
          <div class="panel-title">
            <i>📋</i>
            Real-time Logs
            <div class="status-indicator">
              <div class="status-dot"></div>
              <span>Live</span>
            </div>
          </div>
          <div class="panel-actions">
            <button class="btn btn-clear" onclick="clearLogs()">
              <i>🗑️</i>
              Clear Logs
            </button>
          </div>
        </div>
        <div class="log-content" id="log-content">
          <div class="empty-state" id="empty-logs">
            <i>📝</i>
            <div>Waiting for logs...</div>
            <div style="font-size: 12px; margin-top: 8px;">Logs will appear here in real-time</div>
          </div>
        </div>
      </div>

      <!-- URLs Panel -->
      <div class="panel url-panel">
        <div class="panel-header">
          <div class="panel-title">
            <i>🔗</i>
            URL Status Monitor
          </div>
          <div class="panel-actions">
            <button class="btn" onclick="refreshStats()">
              <i>🔄</i>
              Refresh
            </button>
          </div>
        </div>
        
        <div class="url-tabs">
          <div class="url-tab active" onclick="switchUrlTab('success')">
            <span>Success URLs</span>
            <span class="badge" id="success-badge">0</span>
          </div>
          <div class="url-tab" onclick="switchUrlTab('failed')">
            <span>Failed URLs</span>
            <span class="badge" id="failed-badge">0</span>
          </div>
        </div>
        
        <div class="url-content">
          <div class="url-list" id="url-list">
            <div class="empty-state">
              <i>🔍</i>
              <div>No URLs monitored yet</div>
              <div style="font-size: 12px; margin-top: 8px;">URLs will appear here as they are checked</div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <footer>
      <p>
        <span class="status-indicator">
          <div class="status-dot"></div>
          <span>System Status: <strong>Active</strong></span>
        </span>
        | Last Updated: <span id="last-updated">-</span>
        | Server Time: <span id="server-time">-</span>
      </p>
    </footer>
  </div>

  <script>
    let logs = [];
    let successUrls = [];
    let failedUrls = [];
    let currentUrlTab = 'success';
    let stats = {
      totalHits: 0,
      success: 0,
      failed: 0,
      successRate: '0.0',
      uniqueSuccess: 0,
      uniqueFailed: 0
    };

    const logContent = document.getElementById('log-content');
    const urlList = document.getElementById('url-list');
    const evt = new EventSource("/stream");

    // Update stats display
    function updateStats(data) {
      stats = data;
      document.getElementById('total-hits').textContent = stats.totalHits.toLocaleString();
      document.getElementById('success-count').textContent = stats.success.toLocaleString();
      document.getElementById('failed-count').textContent = stats.failed.toLocaleString();
      document.getElementById('success-rate').textContent = stats.successRate + '%';
      document.getElementById('failure-rate').textContent = (100 - parseFloat(stats.successRate)).toFixed(1) + '%';
      document.getElementById('unique-urls').textContent = (stats.uniqueSuccess + stats.uniqueFailed).toLocaleString();
      document.getElementById('unique-success').textContent = stats.uniqueSuccess.toLocaleString();
      document.getElementById('unique-failed').textContent = stats.uniqueFailed.toLocaleString();
      document.getElementById('success-badge').textContent = stats.uniqueSuccess;
      document.getElementById('failed-badge').textContent = stats.uniqueFailed;
      document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();
    }

    // Update server time
    function updateServerTime() {
      document.getElementById('server-time').textContent = new Date().toLocaleTimeString();
    }
    setInterval(updateServerTime, 1000);

    // Add log to the TOP (newest first)
    function addLog(log) {
      // Remove empty state if it exists
      const emptyLogs = document.getElementById('empty-logs');
      if (emptyLogs) emptyLogs.remove();
      
      const logItem = document.createElement('div');
      logItem.className = \`log-item \${log.type}\`;
      logItem.innerHTML = \`
        <div class="log-time">\${log.time}</div>
        <div class="log-message">\${log.message}</div>
      \`;
      
      // Insert at the TOP of log content
      if (logContent.firstChild) {
        logContent.insertBefore(logItem, logContent.firstChild);
      } else {
        logContent.appendChild(logItem);
      }
      
      logs.unshift(log);
      
      // Keep only last 100 logs in memory
      if (logs.length > 100) {
        logs = logs.slice(0, 100);
      }
      
      // Remove old logs from DOM if there are too many
      const logItems = logContent.querySelectorAll('.log-item');
      if (logItems.length > 100) {
        for (let i = 100; i < logItems.length; i++) {
          logItems[i].remove();
        }
      }
    }

    // Update URL list
    function updateUrlList() {
      const urls = currentUrlTab === 'success' ? successUrls : failedUrls;
      
      if (urls.length === 0) {
        urlList.innerHTML = \`
          <div class="empty-state">
            <i>\${currentUrlTab === 'success' ? '✅' : '❌'}</i>
            <div>No \${currentUrlTab === 'success' ? 'successful' : 'failed'} URLs yet</div>
            <div style="font-size: 12px; margin-top: 8px;">URLs will appear here as they are processed</div>
          </div>
        \`;
        return;
      }
      
      urlList.innerHTML = urls.map(url => \`
        <div class="url-item \${currentUrlTab === 'success' ? 'success' : 'failed'}">
          <div class="url-text">\${url.url}</div>
          <div class="url-meta">
            <span>Hits: \${url.count}</span>
            <span>Status: \${currentUrlTab === 'success' ? 'Success' : 'Failed'}</span>
          </div>
        </div>
      \`).join('');
    }

    // Switch URL tab
    function switchUrlTab(tab) {
      currentUrlTab = tab;
      
      // Update active tab
      document.querySelectorAll('.url-tab').forEach(el => {
        el.classList.remove('active');
      });
      
      const activeTab = tab === 'success' 
        ? document.querySelector('.url-tab:first-child')
        : document.querySelector('.url-tab:last-child');
      
      activeTab.classList.add('active');
      
      updateUrlList();
    }

    // Clear logs
    function clearLogs() {
      logs = [];
      logContent.innerHTML = \`
        <div class="empty-state" id="empty-logs">
          <i>📝</i>
          <div>Logs cleared</div>
          <div style="font-size: 12px; margin-top: 8px;">Waiting for new logs...</div>
        </div>
      \`;
    }

    // Refresh stats
    function refreshStats() {
      fetch('/api/stats')
        .then(r => r.json())
        .then(data => {
          updateStats(data);
        });
    }

    // Load URL lists
    function loadUrlLists() {
      fetch('/api/recent-urls')
        .then(r => r.json())
        .then(data => {
          successUrls = data.success || [];
          failedUrls = data.failed || [];
          updateUrlList();
        });
    }

    // Event Source handling
    evt.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        
        if (data.type === 'stats') {
          updateStats(data.data);
          // Reload URL lists setiap kali stats diupdate
          loadUrlLists();
        } else {
          addLog(data);
        }
      } catch (err) {
        console.error('Error parsing SSE:', err);
      }
    };

    evt.onerror = () => {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: '⚠️ Connection lost, attempting to reconnect...',
        type: 'error'
      });
    };

    // Initial setup
    updateServerTime();
    
    // Load initial data
    fetch('/api/stats')
      .then(r => r.json())
      .then(data => {
        updateStats(data);
      });
    
    loadUrlLists();
    
    // Auto-refresh URL lists every 10 seconds
    setInterval(loadUrlLists, 10000);
  </script>
</body>
</html>
  `);
});

// ======================== API ENDPOINTS ===========================
app.get("/api/stats", (req, res) => {
  res.json({
    ...stats,
    successRate: stats.totalHits > 0 ? ((stats.success / stats.totalHits) * 100).toFixed(1) : "0.0",
    uniqueSuccess: successUrls.size,
    uniqueFailed: failedUrls.size
  });
});

app.get("/api/recent-urls", (req, res) => {
  const successArray = Array.from(successUrls.entries())
    .slice(0, 100)
    .map(([url, count]) => ({
      url,
      count
    }));
  
  const failedArray = Array.from(failedUrls.entries())
    .slice(0, 100)
    .map(([url, count]) => ({
      url,
      count
    }));
  
  res.json({
    success: successArray,
    failed: failedArray
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

  req.on("close", () => {
    const index = clients.indexOf(client);
    if (index > -1) {
      clients.splice(index, 1);
    }
  });
});

// ======================== START ===========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  broadcastLog(`🌐 Dashboard started on port ${PORT}`, "info");
});

// Start main loop
mainLoop();
