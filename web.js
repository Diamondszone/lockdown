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
const successUrls = new Map(); // url -> {count, lastSeen}
const failedUrls = new Map();   // url -> {count, lastSeen}
let stats = {
  totalHits: 0,
  success: 0,
  failed: 0,
  lastUpdate: new Date().toISOString()
};

// ======================== BROADCAST SYSTEM ===========================
function broadcastLog(msg, type = "info", url = "") {
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

function broadcastUrlUpdate(type, url) {
  const urlData = {
    type: "urlUpdate",
    data: {
      type: type, // "success" or "failed"
      url: url,
      time: new Date().toLocaleTimeString()
    }
  };
  
  for (const client of clients) {
    client.res.write(`data: ${JSON.stringify(urlData)}\n\n`);
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

// ======================== HIT URL ===========================
async function hitUrl(url) {
  stats.totalHits++;
  stats.lastUpdate = new Date().toISOString();
  
  const direct = await fetchText(url);
  const directOk = direct.ok && !isCaptcha(direct.text) && isJson(direct.text);

  if (directOk) {
    stats.success++;
    successUrls.set(url, {
      count: (successUrls.get(url)?.count || 0) + 1,
      lastSeen: new Date().toISOString()
    });
    failedUrls.delete(url);
    broadcastLog(`✅ Success: ${url}`, "success", url);
    broadcastUrlUpdate("success", url);
    broadcastStats();
    return { success: true, method: "direct", url };
  }

  const proxied = await fetchText(buildProxyUrl(url));
  const proxyOk = proxied.ok && !isCaptcha(proxied.text) && isJson(proxied.text);

  if (proxyOk) {
    stats.success++;
    successUrls.set(url, {
      count: (successUrls.get(url)?.count || 0) + 1,
      lastSeen: new Date().toISOString()
    });
    failedUrls.delete(url);
    broadcastLog(`✅ Success (via Proxy): ${url}`, "success", url);
    broadcastUrlUpdate("success", url);
    broadcastStats();
    return { success: true, method: "proxy", url };
  } else {
    stats.failed++;
    failedUrls.set(url, {
      count: (failedUrls.get(url)?.count || 0) + 1,
      lastSeen: new Date().toISOString()
    });
    successUrls.delete(url);
    broadcastLog(`❌ Failed: ${url}`, "error", url);
    broadcastUrlUpdate("failed", url);
    broadcastStats();
    return { success: false, url };
  }
}

// ======================== WORKER ===========================
async function mainLoop() {
  const WORKERS = 20;
  const MAX_PARALLEL = 4;

  while (true) {
    try {
      // Ambil list
      const listResp = await fetchText(SOURCE_URL);
      const urls = listResp.ok ? parseList(listResp.text) : [];

      if (urls.length === 0) {
        broadcastLog("❌ SOURCE empty, retrying...", "error");
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      broadcastLog(`📥 Loaded ${urls.length} URLs`, "info");

      let current = 0;
      const processedUrls = new Set();

      async function worker() {
        while (true) {
          const batch = [];
          const batchUrls = [];

          for (let i = 0; i < MAX_PARALLEL; i++) {
            if (current >= urls.length) break;
            let u = urls[current++];
            if (!u || processedUrls.has(u)) continue;
            
            processedUrls.add(u);
            batchUrls.push(u);
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
      
      broadcastLog(`🔄 Loop completed, restarting...`, "info");
      await new Promise(r => setTimeout(r, 1000));
      
    } catch (err) {
      broadcastLog(`❌ ERROR: ${err.message}`, "error");
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
  <title>JSON Checker Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    }

    body {
      background: #0f172a;
      color: #f8fafc;
      min-height: 100vh;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
    }

    /* Header */
    header {
      background: #1e293b;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
      border: 1px solid #334155;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
    }

    .header-title {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }

    .header-title h1 {
      font-size: 28px;
      font-weight: 700;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .header-title i {
      font-size: 32px;
      color: #3b82f6;
    }

    .header-subtitle {
      color: #94a3b8;
      font-size: 14px;
      margin-bottom: 24px;
    }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .stat-card {
      background: #1e293b;
      border-radius: 10px;
      padding: 20px;
      border: 1px solid #334155;
      transition: all 0.3s ease;
    }

    .stat-card:hover {
      border-color: #3b82f6;
      transform: translateY(-2px);
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
    }

    .stat-label {
      font-size: 12px;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 8px;
    }

    .stat-value {
      font-size: 32px;
      font-weight: 700;
      margin-bottom: 4px;
    }

    .stat-success { color: #10b981; }
    .stat-failed { color: #ef4444; }
    .stat-total { color: #3b82f6; }
    .stat-unique { color: #8b5cf6; }

    .stat-detail {
      font-size: 12px;
      color: #64748b;
    }

    /* Main Content */
    .main-content {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      height: 60vh;
    }

    @media (max-width: 1024px) {
      .main-content {
        grid-template-columns: 1fr;
        height: auto;
      }
    }

    /* Panel */
    .panel {
      background: #1e293b;
      border-radius: 12px;
      border: 1px solid #334155;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .panel-header {
      padding: 16px 20px;
      background: rgba(30, 41, 59, 0.9);
      border-bottom: 1px solid #334155;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .panel-title {
      font-size: 18px;
      font-weight: 600;
      color: #e2e8f0;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .panel-actions {
      display: flex;
      gap: 8px;
    }

    .btn {
      padding: 8px 16px;
      border-radius: 6px;
      border: 1px solid #475569;
      background: #334155;
      color: #e2e8f0;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .btn:hover {
      background: #475569;
      border-color: #64748b;
    }

    .btn-clear {
      background: #dc2626;
      border-color: #ef4444;
      color: white;
    }

    .btn-clear:hover {
      background: #ef4444;
      border-color: #f87171;
    }

    /* Log Panel */
    .log-panel {
      height: 100%;
    }

    .log-content {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column-reverse;
    }

    .log-item {
      padding: 12px;
      margin-bottom: 8px;
      border-radius: 8px;
      background: rgba(30, 41, 59, 0.7);
      border-left: 4px solid;
      font-size: 13px;
      line-height: 1.4;
      animation: slideIn 0.3s ease;
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateX(-10px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }

    .log-item.info {
      border-left-color: #3b82f6;
      color: #93c5fd;
    }

    .log-item.success {
      border-left-color: #10b981;
      color: #a7f3d0;
    }

    .log-item.error {
      border-left-color: #ef4444;
      color: #fca5a5;
    }

    .log-time {
      font-size: 11px;
      color: #64748b;
      margin-bottom: 4px;
      font-family: 'Courier New', monospace;
    }

    .log-message {
      word-break: break-all;
    }

    /* URL Panel */
    .url-panel {
      height: 100%;
    }

    .url-tabs {
      display: flex;
      background: #0f172a;
      border-bottom: 1px solid #334155;
    }

    .url-tab {
      flex: 1;
      padding: 12px 16px;
      text-align: center;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      color: #94a3b8;
      transition: all 0.2s ease;
      border-bottom: 2px solid transparent;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .url-tab:hover {
      background: rgba(30, 41, 59, 0.5);
    }

    .url-tab.active {
      color: #3b82f6;
      border-bottom-color: #3b82f6;
      background: rgba(30, 41, 59, 0.8);
    }

    .badge {
      background: #475569;
      color: #f8fafc;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
    }

    .url-content {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
    }

    .url-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .url-item {
      padding: 12px;
      border-radius: 8px;
      background: rgba(30, 41, 59, 0.7);
      border: 1px solid #334155;
      font-size: 12px;
      line-height: 1.4;
      transition: all 0.2s ease;
    }

    .url-item:hover {
      border-color: #475569;
      background: rgba(30, 41, 59, 0.9);
    }

    .url-item.success {
      border-left: 4px solid #10b981;
    }

    .url-item.failed {
      border-left: 4px solid #ef4444;
    }

    .url-text {
      word-break: break-all;
      margin-bottom: 4px;
    }

    .url-meta {
      font-size: 11px;
      color: #64748b;
      display: flex;
      justify-content: space-between;
    }

    /* Scrollbar */
    ::-webkit-scrollbar {
      width: 8px;
    }

    ::-webkit-scrollbar-track {
      background: #1e293b;
      border-radius: 4px;
    }

    ::-webkit-scrollbar-thumb {
      background: #475569;
      border-radius: 4px;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: #64748b;
    }

    /* Footer */
    footer {
      margin-top: 24px;
      text-align: center;
      color: #64748b;
      font-size: 12px;
      padding: 16px;
      border-top: 1px solid #334155;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="header-title">
        <i>🔍</i>
        <h1>JSON Checker Dashboard</h1>
      </div>
      <div class="header-subtitle">
        Real-time monitoring of JSON endpoints with automatic proxy fallback
      </div>
      
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Total Hits</div>
          <div class="stat-value stat-total" id="total-hits">0</div>
          <div class="stat-detail">Total requests made</div>
        </div>
        
        <div class="stat-card">
          <div class="stat-label">Success</div>
          <div class="stat-value stat-success" id="success-count">0</div>
          <div class="stat-detail"><span id="success-rate">0%</span> success rate</div>
        </div>
        
        <div class="stat-card">
          <div class="stat-label">Failed</div>
          <div class="stat-value stat-failed" id="failed-count">0</div>
          <div class="stat-detail"><span id="failed-rate">0%</span> failure rate</div>
        </div>
        
        <div class="stat-card">
          <div class="stat-label">Unique URLs</div>
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
          </div>
          <div class="panel-actions">
            <button class="btn" onclick="clearLogs()">
              <i>🗑️</i>
              Clear Logs
            </button>
          </div>
        </div>
        <div class="log-content" id="log-content">
          <div class="log-item info">
            <div class="log-time">System</div>
            <div class="log-message">Dashboard initialized. Waiting for logs...</div>
          </div>
        </div>
      </div>

      <!-- URLs Panel -->
      <div class="panel url-panel">
        <div class="panel-header">
          <div class="panel-title">
            <i>🔗</i>
            URL Status
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
            <div class="url-item success">
              <div class="url-text">No data yet...</div>
              <div class="url-meta">
                <span>Status: Waiting</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <footer>
      <p>Last Updated: <span id="last-updated">-</span> | Server Time: <span id="server-time">-</span></p>
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
    function updateStats() {
      document.getElementById('total-hits').textContent = stats.totalHits.toLocaleString();
      document.getElementById('success-count').textContent = stats.success.toLocaleString();
      document.getElementById('failed-count').textContent = stats.failed.toLocaleString();
      document.getElementById('unique-urls').textContent = (stats.uniqueSuccess + stats.uniqueFailed).toLocaleString();
      document.getElementById('unique-success').textContent = stats.uniqueSuccess.toLocaleString();
      document.getElementById('unique-failed').textContent = stats.uniqueFailed.toLocaleString();
      document.getElementById('success-rate').textContent = stats.successRate + '%';
      document.getElementById('failed-rate').textContent = (100 - parseFloat(stats.successRate)).toFixed(1) + '%';
      document.getElementById('success-badge').textContent = stats.uniqueSuccess;
      document.getElementById('failed-badge').textContent = stats.uniqueFailed;
      document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();
    }

    // Update server time
    function updateServerTime() {
      document.getElementById('server-time').textContent = new Date().toLocaleTimeString();
    }
    setInterval(updateServerTime, 1000);

    // Add log
    function addLog(log) {
      logs.unshift(log);
      
      // Keep only last 100 logs
      if (logs.length > 100) {
        logs.pop();
      }
      
      const logItem = document.createElement('div');
      logItem.className = \`log-item \${log.type}\`;
      logItem.innerHTML = \`
        <div class="log-time">\${log.time}</div>
        <div class="log-message">\${log.message}</div>
      \`;
      
      // Insert at the top (but since we use column-reverse, we append)
      logContent.appendChild(logItem);
      
      // Auto-scroll
      logContent.scrollTop = 0;
    }

    // Update URL list
    function updateUrlList() {
      const urls = currentUrlTab === 'success' ? successUrls : failedUrls;
      
      if (urls.length === 0) {
        urlList.innerHTML = \`
          <div class="url-item \${currentUrlTab === 'success' ? 'success' : 'failed'}">
            <div class="url-text">No \${currentUrlTab === 'success' ? 'successful' : 'failed'} URLs yet...</div>
            <div class="url-meta">
              <span>Status: Waiting for data</span>
            </div>
          </div>
        \`;
        return;
      }
      
      urlList.innerHTML = urls.map(url => \`
        <div class="url-item \${currentUrlTab === 'success' ? 'success' : 'failed'}">
          <div class="url-text">\${url.url}</div>
          <div class="url-meta">
            <span>Count: \${url.count}</span>
            <span>\${url.time}</span>
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
      
      // Update URL list
      updateUrlList();
    }

    // Clear logs
    function clearLogs() {
      logs = [];
      logContent.innerHTML = \`
        <div class="log-item info">
          <div class="log-time">System</div>
          <div class="log-message">Logs cleared at \${new Date().toLocaleTimeString()}</div>
        </div>
      \`;
    }

    // Refresh stats
    function refreshStats() {
      fetch('/api/stats')
        .then(r => r.json())
        .then(data => {
          stats = data;
          updateStats();
        });
    }

    // Get recent URLs
    function getRecentUrls() {
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
        
        switch(data.type) {
          case 'stats':
            stats = data.data;
            updateStats();
            break;
            
          case 'urlUpdate':
            // Add to appropriate list
            const urlData = {
              url: data.data.url,
              time: data.data.time,
              count: 1
            };
            
            if (data.data.type === 'success') {
              const existing = successUrls.find(u => u.url === data.data.url);
              if (existing) {
                existing.count++;
                existing.time = data.data.time;
              } else {
                successUrls.unshift(urlData);
                // Keep only 50 most recent
                if (successUrls.length > 50) successUrls.pop();
              }
            } else {
              const existing = failedUrls.find(u => u.url === data.data.url);
              if (existing) {
                existing.count++;
                existing.time = data.data.time;
              } else {
                failedUrls.unshift(urlData);
                // Keep only 50 most recent
                if (failedUrls.length > 50) failedUrls.pop();
              }
            }
            
            if (currentUrlTab === data.data.type) {
              updateUrlList();
            }
            break;
            
          default:
            addLog(data);
            break;
        }
      } catch (err) {
        console.error('Error parsing SSE:', err);
      }
    };

    evt.onerror = () => {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: '⚠️ Connection error, attempting to reconnect...',
        type: 'error'
      });
    };

    // Initial setup
    updateStats();
    updateServerTime();
    
    // Load initial data
    fetch('/api/initial-data')
      .then(r => r.json())
      .then(data => {
        stats = data.stats;
        successUrls = data.successUrls || [];
        failedUrls = data.failedUrls || [];
        updateStats();
        updateUrlList();
      });
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
  const successArray = Array.from(successUrls.entries()).slice(0, 50).map(([url, data]) => ({
    url,
    count: data.count,
    time: new Date(data.lastSeen).toLocaleTimeString()
  }));
  
  const failedArray = Array.from(failedUrls.entries()).slice(0, 50).map(([url, data]) => ({
    url,
    count: data.count,
    time: new Date(data.lastSeen).toLocaleTimeString()
  }));
  
  res.json({
    success: successArray,
    failed: failedArray
  });
});

app.get("/api/initial-data", (req, res) => {
  const successArray = Array.from(successUrls.entries()).slice(0, 50).map(([url, data]) => ({
    url,
    count: data.count,
    time: new Date(data.lastSeen).toLocaleTimeString()
  }));
  
  const failedArray = Array.from(failedUrls.entries()).slice(0, 50).map(([url, data]) => ({
    url,
    count: data.count,
    time: new Date(data.lastSeen).toLocaleTimeString()
  }));
  
  res.json({
    stats: {
      ...stats,
      successRate: stats.totalHits > 0 ? ((stats.success / stats.totalHits) * 100).toFixed(1) : "0.0",
      uniqueSuccess: successUrls.size,
      uniqueFailed: failedUrls.size
    },
    successUrls: successArray,
    failedUrls: failedArray
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
      successRate: stats.totalHits > 0 ? ((stats.success / stats.totalHits) * 100).toFixed(1) : "0.0",
      uniqueSuccess: successUrls.size,
      uniqueFailed: failedUrls.size
    }
  })}\n\n`);

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
  broadcastLog(`🌐 Dashboard aktif di port ${PORT}`, "info");
});

// Start main loop
mainLoop();
