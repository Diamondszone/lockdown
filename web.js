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

// TAMBAHKAN SETELAH fungsi isCaptcha:
function getStatusText(status) {
  const statusMap = {
    0: 'Network Error',
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    301: 'Moved Permanently',
    302: 'Found',
    304: 'Not Modified',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    408: 'Request Timeout',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout'
  };
  return statusMap[status] || `Status ${status}`;
}

// GANTI fungsi fetchText yang LAMA dengan INI:
const fetchText = async (url) => {
  try {
    const resp = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 15000,
      validateStatus: () => true,  // Biarkan true untuk dapat semua response
      responseType: "text",
    });

    return {
      ok: true,
      status: resp.status,  // <-- TAMBAHKAN INI
      statusText: resp.statusText,  // <-- TAMBAHKAN INI
      text: typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data),
    };
  } catch (e) {
    return { 
      ok: false, 
      error: e.message,
      status: 0,  // 0 untuk network error
      statusText: e.message
    };
  }
};

const buildProxyUrl = (u) => `${CORS_PROXY}/${u}`;

// ======================== HIT URL ===========================

async function hitUrl(url) {
  stats.totalHits++;
  stats.lastUpdate = new Date().toISOString();
  
  const direct = await fetchText(url);
  // TAMBAHKAN CHECK: status === 200
  const directOk = direct.ok && direct.status === 200 && !isCaptcha(direct.text) && isJson(direct.text);

  if (directOk) {
    stats.success++;
    successUrls.set(url, (successUrls.get(url) || 0) + 1);
    failedUrls.delete(url);
    broadcastLog(`✅ ${url}`, "success");
    return { success: true, method: "direct", url };
  }

  const proxied = await fetchText(buildProxyUrl(url));
  // TAMBAHKAN CHECK: status === 200
  const proxyOk = proxied.ok && proxied.status === 200 && !isCaptcha(proxied.text) && isJson(proxied.text);

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
    
    // TAMBAHKAN INFORMASI ERROR YANG LEBIH DETAIL
    let errorMsg = `❌ ${url}`;
    if (direct.status && direct.status !== 200) {
      errorMsg += ` [${direct.status}]`;
    } else if (direct.error) {
      errorMsg += ` [${direct.error}]`;
    }
    
    broadcastLog(errorMsg, "error");
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
  <title>Lockdown Cyber Control</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      font-family: 'Orbitron', 'Segoe UI', 'Microsoft YaHei', sans-serif;
    }

    body {
      background: #0a0a14;
      color: #f8fafc;
      min-height: 100vh;
      overflow-x: hidden;
      position: relative;
    }

    /* ==== DIGITAL MATRIX RAIN EFFECT (PERBAIKAN) ==== */
    .metric-rain {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: -1;
      overflow: hidden;
      background: linear-gradient(to bottom, 
        rgba(10, 10, 20, 0.1) 0%,
        rgba(168, 85, 247, 0.05) 50%,
        rgba(10, 10, 20, 0.1) 100%);
    }

    .metric-column {
      position: absolute;
      top: -100px;
      width: 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      animation: matrixFall linear infinite;
      opacity: 0.7;
    }

    .metric-drop {
      font-family: 'Orbitron', 'Microsoft YaHei', 'SimHei', monospace;
      font-weight: 900;
      font-size: 20px;
      color: rgba(168, 85, 247, 0.9);
      text-shadow: 
        0 0 5px rgba(168, 85, 247, 1),
        0 0 10px rgba(168, 85, 247, 0.8),
        0 0 15px rgba(168, 85, 247, 0.6),
        0 0 20px rgba(168, 85, 247, 0.4);
      line-height: 1;
      margin: 2px 0;
      opacity: 0;
      animation: charFlicker 0.5s infinite alternate;
    }

    .metric-drop:first-child {
      color: rgba(236, 72, 153, 0.9);
      text-shadow: 
        0 0 5px rgba(236, 72, 153, 1),
        0 0 10px rgba(236, 72, 153, 0.8);
      animation: charFlicker 0.3s infinite alternate;
    }

    .metric-drop:nth-child(2) {
      color: rgba(139, 92, 246, 0.9);
      text-shadow: 
        0 0 5px rgba(139, 92, 246, 1),
        0 0 10px rgba(139, 92, 246, 0.8);
      animation: charFlicker 0.4s infinite alternate;
    }

    @keyframes matrixFall {
      0% {
        transform: translateY(-100px);
        opacity: 0;
      }
      5% {
        opacity: 0.8;
      }
      95% {
        opacity: 0.8;
      }
      100% {
        transform: translateY(100vh);
        opacity: 0;
      }
    }

    @keyframes charFlicker {
      0%, 100% {
        opacity: 0.9;
        transform: scale(1);
      }
      50% {
        opacity: 0.5;
        transform: scale(0.95);
      }
    }

    /* TRAIL EFFECT */
    .metric-drop::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      width: 2px;
      height: 40px;
      background: linear-gradient(to bottom, 
        rgba(168, 85, 247, 0.8),
        rgba(168, 85, 247, 0));
      filter: blur(2px);
    }

    /* Chinese Characters Background Effect */
    body::before {
      content: "锁 封 控 网 安 全 系 统 监 视 安 全 锁 封 控 网 安 全 系 统 监 视 安 全 锁 封 控 网 安 全 系 统 监 视 安 全";
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      font-size: 24px;
      color: rgba(168, 85, 247, 0.05);
      line-height: 1.8;
      word-break: break-all;
      z-index: -2;
      animation: floatBackground 120s linear infinite;
      text-shadow: 0 0 10px rgba(168, 85, 247, 0.1);
      font-family: 'Microsoft YaHei', 'SimHei', sans-serif;
      font-weight: 900;
      letter-spacing: 8px;
      padding: 20px;
      opacity: 0.4;
    }

    @keyframes floatBackground {
      0% { transform: translateY(0) translateX(0); }
      100% { transform: translateY(-1000px) translateX(-200px); }
    }

    /* Glitch Effect */
    .glitch {
      position: relative;
      animation: glitch 5s infinite;
    }

    @keyframes glitch {
      0% { transform: translate(0); }
      2% { transform: translate(-2px, 2px); }
      4% { transform: translate(-2px, -2px); }
      6% { transform: translate(2px, 2px); }
      8% { transform: translate(2px, -2px); }
      10% { transform: translate(0); }
      100% { transform: translate(0); }
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
      position: relative;
      z-index: 1;
    }

    /* Header */
    header {
      background: rgba(10, 10, 20, 0.85);
      border-radius: 16px;
      padding: 24px 32px;
      margin-bottom: 24px;
      border: 1px solid #a855f7;
      box-shadow: 
        0 0 30px rgba(168, 85, 247, 0.3),
        0 8px 32px rgba(0, 0, 0, 0.6),
        inset 0 0 20px rgba(168, 85, 247, 0.1);
      position: relative;
      overflow: hidden;
      backdrop-filter: blur(10px);
    }

    header::before {
      content: '';
      position: absolute;
      top: -2px;
      left: -2px;
      right: -2px;
      bottom: -2px;
      background: linear-gradient(45deg, 
        #a855f7, #ec4899, #8b5cf6, #a855f7);
      z-index: -1;
      border-radius: 18px;
      animation: borderGlow 3s linear infinite;
    }

    @keyframes borderGlow {
      0%, 100% { filter: hue-rotate(0deg); }
      50% { filter: hue-rotate(180deg); }
    }

    .header-title {
      display: flex;
      align-items: center;
      gap: 20px;
      margin-bottom: 12px;
    }

    .header-title h1 {
      font-size: 42px;
      font-weight: 900;
      background: linear-gradient(135deg, #a855f7 0%, #ec4899 50%, #8b5cf6 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: 2px;
      text-shadow: 
        0 0 20px rgba(168, 85, 247, 0.5),
        0 0 40px rgba(168, 85, 247, 0.3);
      animation: textGlow 2s ease-in-out infinite alternate;
    }

    @keyframes textGlow {
      from { text-shadow: 0 0 20px rgba(168, 85, 247, 0.5), 0 0 40px rgba(168, 85, 247, 0.3); }
      to { text-shadow: 0 0 30px rgba(168, 85, 247, 0.8), 0 0 60px rgba(168, 85, 247, 0.5), 0 0 80px rgba(168, 85, 247, 0.3); }
    }

    .header-title i {
      font-size: 48px;
      color: #a855f7;
      filter: drop-shadow(0 0 15px rgba(168, 85, 247, 0.7));
      animation: skullFloat 3s ease-in-out infinite;
    }

    @keyframes skullFloat {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      50% { transform: translateY(-10px) rotate(5deg); }
    }

    .header-subtitle {
      color: #c4b5fd;
      font-size: 16px;
      margin-bottom: 32px;
      text-shadow: 0 0 10px rgba(168, 85, 247, 0.3);
      letter-spacing: 1px;
    }

    /* Stats Grid - NEON PURPLE METRICS */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 24px;
      margin-bottom: 32px;
    }

    .stat-card {
      background: rgba(20, 15, 35, 0.9);
      border-radius: 14px;
      padding: 24px;
      border: 1px solid #a855f7;
      backdrop-filter: blur(10px);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      overflow: hidden;
      box-shadow: 
        0 0 20px rgba(168, 85, 247, 0.2),
        inset 0 0 20px rgba(168, 85, 247, 0.05);
    }

    .stat-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, #a855f7, #ec4899, #8b5cf6);
      animation: gradientMove 2s linear infinite;
    }

    @keyframes gradientMove {
      0% { background-position: 0% 50%; }
      100% { background-position: 200% 50%; }
    }

    .stat-card:hover {
      transform: translateY(-8px) scale(1.02);
      border-color: #ec4899;
      box-shadow: 
        0 0 40px rgba(168, 85, 247, 0.4),
        0 15px 30px rgba(0, 0, 0, 0.4),
        inset 0 0 30px rgba(168, 85, 247, 0.1);
    }

    .stat-label {
      font-size: 13px;
      color: #c4b5fd;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      margin-bottom: 12px;
      font-weight: 600;
      text-shadow: 0 0 10px rgba(168, 85, 247, 0.3);
    }

    .stat-value {
      font-size: 46px;
      font-weight: 900;
      margin-bottom: 8px;
      text-shadow: 
        0 0 20px currentColor,
        0 0 40px rgba(168, 85, 247, 0.3);
      font-family: 'Orbitron', monospace;
    }

    .stat-success { 
      color: #00ff88;
      animation: successPulse 2s infinite;
    }

    @keyframes successPulse {
      0%, 100% { text-shadow: 0 0 20px #00ff88, 0 0 40px rgba(0, 255, 136, 0.3); }
      50% { text-shadow: 0 0 30px #00ff88, 0 0 60px rgba(0, 255, 136, 0.5), 0 0 80px rgba(0, 255, 136, 0.3); }
    }

    .stat-failed { 
      color: #ff2a6d;
      animation: failedPulse 2s infinite;
    }

    @keyframes failedPulse {
      0%, 100% { text-shadow: 0 0 20px #ff2a6d, 0 0 40px rgba(255, 42, 109, 0.3); }
      50% { text-shadow: 0 0 30px #ff2a6d, 0 0 60px rgba(255, 42, 109, 0.5), 0 0 80px rgba(255, 42, 109, 0.3); }
    }

    .stat-total { 
      color: #a855f7;
      animation: totalPulse 3s infinite;
    }

    @keyframes totalPulse {
      0%, 100% { text-shadow: 0 0 20px #a855f7, 0 0 40px rgba(168, 85, 247, 0.3); }
      50% { text-shadow: 0 0 30px #a855f7, 0 0 60px rgba(168, 85, 247, 0.5), 0 0 80px rgba(168, 85, 247, 0.3); }
    }

    .stat-unique { 
      color: #8b5cf6;
      animation: uniquePulse 2.5s infinite;
    }

    @keyframes uniquePulse {
      0%, 100% { text-shadow: 0 0 20px #8b5cf6, 0 0 40px rgba(139, 92, 246, 0.3); }
      50% { text-shadow: 0 0 30px #8b5cf6, 0 0 60px rgba(139, 92, 246, 0.5), 0 0 80px rgba(139, 92, 246, 0.3); }
    }

    .stat-detail {
      font-size: 13px;
      color: #a78bfa;
      font-weight: 500;
      text-shadow: 0 0 5px rgba(168, 85, 247, 0.2);
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
      background: rgba(20, 15, 35, 0.9);
      border-radius: 16px;
      border: 1px solid #a855f7;
      backdrop-filter: blur(10px);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 
        0 0 30px rgba(168, 85, 247, 0.2),
        inset 0 0 20px rgba(168, 85, 247, 0.05);
      position: relative;
    }

    .panel::before {
      content: '';
      position: absolute;
      top: -2px;
      left: -2px;
      right: -2px;
      bottom: -2px;
      background: linear-gradient(45deg, #a855f7, #8b5cf6, #ec4899, #a855f7);
      z-index: -1;
      border-radius: 18px;
      opacity: 0.5;
      filter: blur(5px);
      animation: panelGlow 4s linear infinite;
    }

    @keyframes panelGlow {
      0% { opacity: 0.3; }
      50% { opacity: 0.6; }
      100% { opacity: 0.3; }
    }

    .panel-header {
      padding: 20px 24px;
      background: rgba(30, 25, 50, 0.9);
      border-bottom: 1px solid #a855f7;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: relative;
    }

    .panel-header::after {
      content: '';
      position: absolute;
      bottom: -1px;
      left: 0;
      width: 100%;
      height: 1px;
      background: linear-gradient(90deg, 
        transparent, #a855f7, #ec4899, #8b5cf6, transparent);
      animation: scanLine 3s linear infinite;
    }

    @keyframes scanLine {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }

    .panel-title {
      font-size: 22px;
      font-weight: 700;
      color: #e2e8f0;
      display: flex;
      align-items: center;
      gap: 12px;
      text-shadow: 0 0 10px rgba(168, 85, 247, 0.3);
    }

    .panel-actions {
      display: flex;
      gap: 12px;
    }

    .btn {
      padding: 10px 20px;
      border-radius: 10px;
      border: 1px solid #a855f7;
      background: linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(139, 92, 246, 0.1));
      color: #e2e8f0;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      gap: 8px;
      text-shadow: 0 0 5px rgba(168, 85, 247, 0.3);
      position: relative;
      overflow: hidden;
    }

    .btn::before {
      content: '';
      position: absolute;
      top: 0;
      left: -100%;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, transparent, rgba(168, 85, 247, 0.3), transparent);
      transition: 0.5s;
    }

    .btn:hover {
      background: linear-gradient(135deg, rgba(168, 85, 247, 0.3), rgba(139, 92, 246, 0.2));
      border-color: #ec4899;
      transform: scale(1.05);
      box-shadow: 0 0 20px rgba(168, 85, 247, 0.4);
    }

    .btn:hover::before {
      left: 100%;
    }

    .btn:active {
      transform: scale(0.95);
    }

    .btn-clear {
      background: linear-gradient(135deg, rgba(255, 42, 109, 0.2), rgba(220, 38, 38, 0.1));
      border-color: #ff2a6d;
      color: white;
    }

    .btn-clear:hover {
      background: linear-gradient(135deg, rgba(255, 42, 109, 0.3), rgba(220, 38, 38, 0.2));
      border-color: #ff6b9d;
      box-shadow: 0 0 20px rgba(255, 42, 109, 0.4);
    }

    /* NEW: Copy Button */
    .copy-btn {
      padding: 6px 12px;
      border-radius: 8px;
      border: 1px solid rgba(168, 85, 247, 0.5);
      background: linear-gradient(135deg, rgba(168, 85, 247, 0.15), rgba(139, 92, 246, 0.1));
      color: #c4b5fd;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      gap: 6px;
      text-shadow: 0 0 5px rgba(168, 85, 247, 0.3);
      position: relative;
      overflow: hidden;
      margin-left: auto;
    }

    .copy-btn:hover {
      background: linear-gradient(135deg, rgba(168, 85, 247, 0.3), rgba(139, 92, 246, 0.2));
      border-color: #a855f7;
      color: #ffffff;
      box-shadow: 0 0 15px rgba(168, 85, 247, 0.5);
      transform: scale(1.05);
    }

    .copy-btn:active {
      transform: scale(0.95);
    }

    .copy-btn.copied {
      background: linear-gradient(135deg, rgba(0, 255, 136, 0.3), rgba(0, 220, 130, 0.2));
      border-color: #00ff88;
      color: #00ff88;
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
      background: rgba(10, 10, 20, 0.5);
    }

    .log-item {
      padding: 16px 20px;
      border-bottom: 1px solid rgba(168, 85, 247, 0.2);
      font-size: 14px;
      line-height: 1.5;
      animation: fadeIn 0.5s ease-out;
      transition: all 0.2s ease;
      position: relative;
    }

    .log-item:hover {
      background: rgba(168, 85, 247, 0.1);
      border-left: 4px solid #a855f7;
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
      border-left: 4px solid #a855f7;
      background: rgba(168, 85, 247, 0.05);
    }

    .log-item.success {
      border-left: 4px solid #00ff88;
      background: rgba(0, 255, 136, 0.05);
    }

    .log-item.success .log-time {
      color: #00ff88;
      text-shadow: 0 0 5px rgba(0, 255, 136, 0.3);
    }

    .log-item.error {
      border-left: 4px solid #ff2a6d;
      background: rgba(255, 42, 109, 0.05);
    }

    .log-item.error .log-time {
      color: #ff2a6d;
      text-shadow: 0 0 5px rgba(255, 42, 109, 0.3);
    }

    .log-time {
      font-size: 12px;
      color: #c4b5fd;
      margin-bottom: 4px;
      font-family: 'Courier New', monospace;
      font-weight: 500;
      letter-spacing: 1px;
    }

    .log-message {
      word-break: break-all;
      color: #f1f5f9;
      font-family: 'Courier New', monospace;
    }

    /* URL Panel */
    .url-panel {
      height: 100%;
    }

    .url-tabs {
      display: flex;
      background: rgba(30, 25, 50, 0.9);
      border-bottom: 1px solid #a855f7;
    }

    .url-tab {
      flex: 1;
      padding: 16px 20px;
      text-align: center;
      cursor: pointer;
      font-size: 15px;
      font-weight: 600;
      color: #c4b5fd;
      transition: all 0.2s ease;
      border-bottom: 3px solid transparent;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      position: relative;
    }

    .url-tab:hover {
      background: rgba(168, 85, 247, 0.2);
      color: #e2e8f0;
    }

    .url-tab.active {
      color: #a855f7;
      border-bottom-color: #a855f7;
      background: rgba(168, 85, 247, 0.15);
      text-shadow: 0 0 10px rgba(168, 85, 247, 0.5);
    }

    .badge {
      background: linear-gradient(135deg, #a855f7, #8b5cf6);
      color: white;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 700;
      min-width: 28px;
      box-shadow: 0 0 10px rgba(168, 85, 247, 0.5);
      animation: badgePulse 2s infinite;
    }

    @keyframes badgePulse {
      0%, 100% { box-shadow: 0 0 10px rgba(168, 85, 247, 0.5); }
      50% { box-shadow: 0 0 20px rgba(168, 85, 247, 0.8); }
    }

    .url-content {
      flex: 1;
      padding: 0;
      overflow-y: auto;
      background: rgba(10, 10, 20, 0.5);
    }

    .url-list {
      display: flex;
      flex-direction: column;
    }

    .url-item {
      padding: 16px 20px;
      border-bottom: 1px solid rgba(168, 85, 247, 0.2);
      font-size: 13px;
      line-height: 1.5;
      transition: all 0.2s ease;
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .url-item:hover {
      background: rgba(168, 85, 247, 0.1);
    }

    .url-item.success {
      border-left: 4px solid #00ff88;
      background: rgba(0, 255, 136, 0.05);
    }

    .url-item.success .url-text {
      color: #00ff88;
      text-shadow: 0 0 5px rgba(0, 255, 136, 0.3);
    }

    .url-item.failed {
      border-left: 4px solid #ff2a6d;
      background: rgba(255, 42, 109, 0.05);
    }

    .url-item.failed .url-text {
      color: #ff2a6d;
      text-shadow: 0 0 5px rgba(255, 42, 109, 0.3);
    }

    .url-text {
      word-break: break-all;
      color: #f1f5f9;
      font-weight: 500;
      font-family: 'Courier New', monospace;
      font-size: 14px;
    }

    .url-meta {
      font-size: 12px;
      color: #a78bfa;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 500;
      text-shadow: 0 0 5px rgba(168, 85, 247, 0.2);
      width: 100%;
    }

    .url-status {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* Scrollbar */
    ::-webkit-scrollbar {
      width: 10px;
    }

    ::-webkit-scrollbar-track {
      background: rgba(30, 25, 50, 0.5);
      border-radius: 5px;
    }

    ::-webkit-scrollbar-thumb {
      background: linear-gradient(135deg, #a855f7, #8b5cf6);
      border-radius: 5px;
      box-shadow: 0 0 10px rgba(168, 85, 247, 0.5);
    }

    ::-webkit-scrollbar-thumb:hover {
      background: linear-gradient(135deg, #8b5cf6, #a855f7);
      box-shadow: 0 0 20px rgba(168, 85, 247, 0.7);
    }

    /* Footer */
    footer {
      text-align: center;
      color: #a78bfa;
      font-size: 13px;
      padding: 20px;
      border-top: 1px solid #a855f7;
      margin-top: 20px;
      background: rgba(20, 15, 35, 0.8);
      border-radius: 10px;
      box-shadow: 0 0 20px rgba(168, 85, 247, 0.2);
    }

    .status-indicator {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      animation: statusPulse 1.5s infinite;
    }

    @keyframes statusPulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }

    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #00ff88;
      box-shadow: 0 0 10px #00ff88;
      animation: dotPulse 2s infinite;
    }

    @keyframes dotPulse {
      0%, 100% { box-shadow: 0 0 10px #00ff88; }
      50% { box-shadow: 0 0 20px #00ff88, 0 0 30px rgba(0, 255, 136, 0.5); }
    }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #a78bfa;
    }

    .empty-state i {
      font-size: 48px;
      margin-bottom: 16px;
      opacity: 0.7;
      text-shadow: 0 0 20px rgba(168, 85, 247, 0.5);
    }

    /* Terminal Effect */
    .terminal-line {
      position: relative;
      padding-left: 20px;
    }

    .terminal-line::before {
      content: '>';
      position: absolute;
      left: 0;
      color: #00ff88;
      text-shadow: 0 0 10px #00ff88;
      animation: blink 1s infinite;
    }

    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }

    /* Sparkle Animation untuk Matrix Rain */
    @keyframes sparklePulse {
      0%, 100% { 
        opacity: 0;
        transform: scale(0.5);
      }
      50% { 
        opacity: 1;
        transform: scale(1.5);
      }
    }
  </style>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
</head>
<body>
  <!-- NEON PURPLE METRIC RAIN -->
  <div class="metric-rain" id="metricRain"></div>

  <div class="container">
    <header class="glitch">
      <div class="header-title">
        <i>💀</i>
        <h1>LOCKDOWN CONTROL</h1>
      </div>
      <div class="header-subtitle">
        CYBER SECURITY MONITORING SYSTEM • REAL-TIME ENDPOINT VERIFICATION
      </div>
      
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">TOTAL REQUESTS</div>
          <div class="stat-value stat-total" id="total-hits">0</div>
          <div class="stat-detail">PROCESSED REQUESTS</div>
        </div>
        
        <div class="stat-card">
          <div class="stat-label">SUCCESS RATE</div>
          <div class="stat-value stat-success" id="success-rate">0%</div>
          <div class="stat-detail"><span id="success-count">0</span> VERIFIED ENDPOINTS</div>
        </div>
        
        <div class="stat-card">
          <div class="stat-label">FAILURE RATE</div>
          <div class="stat-value stat-failed" id="failure-rate">0%</div>
          <div class="stat-detail"><span id="failed-count">0</span> FAILED ATTEMPTS</div>
                </div>
        
        <div class="stat-card">
          <div class="stat-label">ACTIVE TARGETS</div>
          <div class="stat-value stat-unique" id="unique-urls">0</div>
          <div class="stat-detail"><span id="unique-success">0</span> ONLINE / <span id="unique-failed">0</span> OFFLINE</div>
        </div>
      </div>
    </header>

    <main class="main-content">
      <!-- Logs Panel -->
      <div class="panel log-panel">
        <div class="panel-header">
          <div class="panel-title">
            <i>📡</i>
            SYSTEM LOGS
            <div class="status-indicator">
              <div class="status-dot"></div>
              <span>SYNC ACTIVE</span>
            </div>
          </div>
          <div class="panel-actions">
            <button class="btn btn-clear" onclick="clearLogs()">
              <i>🗑️</i>
              PURGE LOGS
            </button>
          </div>
        </div>
        <div class="log-content" id="log-content">
          <div class="empty-state" id="empty-logs">
            <i>📡</i>
            <div>INITIALIZING MONITORING SYSTEM...</div>
            <div style="font-size: 12px; margin-top: 8px;">AWAITING CONNECTION DATA STREAM</div>
          </div>
        </div>
      </div>

      <!-- URLs Panel -->
      <div class="panel url-panel">
        <div class="panel-header">
          <div class="panel-title">
            <i>🎯</i>
            TARGET MONITOR
          </div>
          <div class="panel-actions">
            <button class="btn" onclick="refreshStats()">
              <i>🔄</i>
              FORCE SCAN
            </button>
          </div>
        </div>
        
        <div class="url-tabs">
          <div class="url-tab active" onclick="switchUrlTab('success')">
            <span>ACTIVE TARGETS</span>
            <span class="badge" id="success-badge">0</span>
          </div>
          <div class="url-tab" onclick="switchUrlTab('failed')">
            <span>FAILED TARGETS</span>
            <span class="badge" id="failed-badge">0</span>
          </div>
        </div>
        
        <div class="url-content">
          <div class="url-list" id="url-list">
            <div class="empty-state">
              <i>🎯</i>
              <div>TARGET DATABASE EMPTY</div>
              <div style="font-size: 12px; margin-top: 8px;">AWAITING TARGET ACQUISITION...</div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <footer>
      <p>
        <span class="status-indicator">
          <div class="status-dot"></div>
          <span>SYSTEM STATUS: <strong>OPERATIONAL</strong></span>
        </span>
        | LAST UPDATE: <span id="last-updated">--:--:--</span>
        | SERVER TIME: <span id="server-time">--:--:--</span>
        | <span style="color: #a855f7; text-shadow: 0 0 10px rgba(168,85,247,0.5);">LOCKDOWN PROTOCOL: ACTIVE</span>
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
    const metricRain = document.getElementById('metricRain');
    const evt = new EventSource("/stream");

    // Chinese characters and numbers for matrix effect
    const matrixChars = [
      "0", "1", "锁", "封", "控", "网", "安", "全", 
      "系", "统", "监", "视", "防", "护", "密", "码",
      "验", "证", "数", "据", "流", "量", "节", "点",
      "服", "务", "攻", "击", "防", "御", "入", "侵",
      "检", "测", "安", "全", "系", "统", "警", "报",
      "🚀", "💻", "🔒", "🔓", "📡", "🎯", "⚡", "🔥"
    ];

    // Matrix columns
    const matrixColumns = [];

    // Create matrix column
    function createMatrixColumn(leftPosition) {
      const column = document.createElement('div');
      column.className = 'metric-column';
      
      // Random column properties
      const charsCount = 15 + Math.floor(Math.random() * 20);
      const duration = 8 + Math.random() * 12;
      const delay = Math.random() * 5;
      
      column.style.left = leftPosition + 'px';
      column.style.animationDuration = duration + 's';
      column.style.animationDelay = delay + 's';
      
      // Create characters for this column
      for (let i = 0; i < charsCount; i++) {
        const char = document.createElement('div');
        char.className = 'metric-drop';
        
        // Random character
        const charIndex = Math.floor(Math.random() * matrixChars.length);
        char.textContent = matrixChars[charIndex];
        
        // Random flicker delay for each character
        const flickerDelay = Math.random() * 0.5;
        char.style.animationDelay = flickerDelay + 's';
        
        // Random brightness
        const brightness = 0.6 + Math.random() * 0.4;
        char.style.filter = 'brightness(' + brightness + ')';
        
        column.appendChild(char);
      }
      
      metricRain.appendChild(column);
      matrixColumns.push(column);
      
      // Remove column after animation completes
      setTimeout(() => {
        if (column.parentNode === metricRain) {
          metricRain.removeChild(column);
          const index = matrixColumns.indexOf(column);
          if (index > -1) {
            matrixColumns.splice(index, 1);
          }
        }
      }, (duration + delay) * 1000);
    }

    // Create sparkle effect
    function createSparkleEffect() {
      const sparkle = document.createElement('div');
      sparkle.style.cssText = 
        'position: absolute;' +
        'width: 3px;' +
        'height: 3px;' +
        'background: rgba(168, 85, 247, 0.9);' +
        'border-radius: 50%;' +
        'box-shadow: 0 0 10px rgba(168, 85, 247, 0.8), 0 0 20px rgba(168, 85, 247, 0.6);' +
        'animation: sparklePulse 1s ease-in-out;';
      
      sparkle.style.left = Math.random() * 100 + '%';
      sparkle.style.top = Math.random() * 100 + '%';
      
      metricRain.appendChild(sparkle);
      
      setTimeout(() => {
        if (sparkle.parentNode === metricRain) {
          metricRain.removeChild(sparkle);
        }
      }, 1000);
    }

    // Create matrix rain effect
    function createMetricRain() {
      // Clean up old columns if too many
      if (matrixColumns.length > 30) {
        const columnsToRemove = matrixColumns.splice(0, matrixColumns.length - 20);
        columnsToRemove.forEach(col => {
          if (col.parentNode === metricRain) {
            metricRain.removeChild(col);
          }
        });
      }
      
      // Create 3-8 new columns
      const newColumns = 3 + Math.floor(Math.random() * 6);
      const columnWidth = 24;
      const usedPositions = new Set();
      
      for (let i = 0; i < newColumns; i++) {
        let leftPos;
        let attempts = 0;
        
        // Find unique position
        do {
          leftPos = Math.floor(Math.random() * (window.innerWidth - columnWidth));
          attempts++;
          if (attempts > 20) break; // Prevent infinite loop
        } while (Array.from(usedPositions).some(pos => Math.abs(pos - leftPos) < columnWidth * 2));
        
        if (attempts <= 20) {
          usedPositions.add(leftPos);
          createMatrixColumn(leftPos);
        }
      }
      
      // Random sparkle effect
      if (Math.random() > 0.7) {
        createSparkleEffect();
      }
    }

    // Continuously create matrix rain
    function startMetricRain() {
      createMetricRain();
      // Create new columns every 2-4 seconds
      setInterval(createMetricRain, 2000 + Math.random() * 2000);
    }

    // Handle window resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        // Clear existing columns on resize
        matrixColumns.forEach(col => {
          if (col.parentNode === metricRain) {
            metricRain.removeChild(col);
          }
        });
        matrixColumns.length = 0;
        
        // Restart with new dimensions
        createMetricRain();
      }, 250);
    });

    // Copy URL function
    function copyToClipboard(text) {
      navigator.clipboard.writeText(text).then(() => {
        // Show success feedback
        const event = new CustomEvent('showToast', {
          detail: { message: 'URL copied to clipboard!', type: 'success' }
        });
        window.dispatchEvent(event);
      }).catch(err => {
        console.error('Failed to copy: ', err);
        const event = new CustomEvent('showToast', {
          detail: { message: 'Failed to copy URL', type: 'error' }
        });
        window.dispatchEvent(event);
      });
    }

    // Toast notification function
    function showToast(message, type = 'info') {
      const toast = document.createElement('div');
      toast.style.cssText = 
        'position: fixed;' +
        'top: 20px;' +
        'right: 20px;' +
        'padding: 12px 20px;' +
        'background: ' + (type === 'success' ? 'rgba(0, 255, 136, 0.9)' : 'rgba(255, 42, 109, 0.9)') + ';' +
        'color: white;' +
        'border-radius: 8px;' +
        'font-weight: 600;' +
        'z-index: 10000;' +
        'animation: slideIn 0.3s ease-out, slideOut 0.3s ease-in 2.7s;' +
        'box-shadow: 0 0 20px ' + (type === 'success' ? 'rgba(0, 255, 136, 0.5)' : 'rgba(255, 42, 109, 0.5)') + ';' +
        'border: 1px solid ' + (type === 'success' ? '#00ff88' : '#ff2a6d') + ';';
      toast.textContent = message;
      document.body.appendChild(toast);
      
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 3000);
    }

    // Listen for toast events
    window.addEventListener('showToast', (e) => {
      showToast(e.detail.message, e.detail.type);
    });

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
      const now = new Date();
      const timeStr = now.getHours().toString().padStart(2, '0') + ':' + 
                     now.getMinutes().toString().padStart(2, '0') + ':' + 
                     now.getSeconds().toString().padStart(2, '0');
      document.getElementById('server-time').textContent = timeStr;
      
      // Add glitch effect randomly
      if (Math.random() > 0.95) {
        document.getElementById('server-time').classList.add('glitch');
        setTimeout(() => {
          document.getElementById('server-time').classList.remove('glitch');
        }, 200);
      }
    }
    setInterval(updateServerTime, 1000);

    // Add log to the TOP (newest first)
    function addLog(log) {
      // Remove empty state if it exists
      const emptyLogs = document.getElementById('empty-logs');
      if (emptyLogs) emptyLogs.remove();
      
      const logItem = document.createElement('div');
      logItem.className = 'log-item ' + log.type + ' terminal-line';
      
      // Format time for cyberpunk style
      const now = new Date();
      const timeStr = now.getHours().toString().padStart(2, '0') + ':' + 
                     now.getMinutes().toString().padStart(2, '0') + ':' + 
                     now.getSeconds().toString().padStart(2, '0');
      
      let message = log.message;
      // Add emoji prefix based on type
      if (log.type === 'success') {
        message = '🟢 ' + message;
      } else if (log.type === 'error') {
        message = '🔴 ' + message;
      } else {
        message = '🔵 ' + message;
      }
      
      logItem.innerHTML = 
        '<div class="log-time">[' + timeStr + ']</div>' +
        '<div class="log-message">' + message + '</div>';
      
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
        urlList.innerHTML = 
          '<div class="empty-state">' +
            '<i>' + (currentUrlTab === 'success' ? '🟢' : '🔴') + '</i>' +
            '<div>' + (currentUrlTab === 'success' ? 'NO ACTIVE TARGETS' : 'NO FAILED TARGETS') + '</div>' +
            '<div style="font-size: 12px; margin-top: 8px;">' + 
              (currentUrlTab === 'success' ? 'AWAITING TARGET ACQUISITION...' : 'ALL TARGETS OPERATIONAL') + 
            '</div>' +
          '</div>';
        return;
      }
      
      urlList.innerHTML = urls.map((url, index) => {
        const escapedUrl = url.url.replace(/'/g, "\\'");
        return '<div class="url-item ' + (currentUrlTab === 'success' ? 'success' : 'failed') + '">' +
          '<div class="url-text">' + url.url + '</div>' +
          '<div class="url-meta">' +
            '<div class="url-status">' +
              '<span>HITS: ' + url.count + '</span>' +
              '<span>STATUS: ' + (currentUrlTab === 'success' ? '🟢 ONLINE' : '🔴 OFFLINE') + '</span>' +
            '</div>' +
            '<button class="copy-btn" onclick="copyUrl(\\'' + escapedUrl + '\\', this)">' +
              '<i>📋</i>' +
              'COPY URL' +
            '</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    // Copy URL function
    function copyUrl(url, button) {
      copyToClipboard(url);
      
      // Visual feedback
      button.innerHTML = '<i>✅</i> COPIED';
      button.classList.add('copied');
      
      setTimeout(() => {
        button.innerHTML = '<i>📋</i> COPY URL';
        button.classList.remove('copied');
      }, 2000);
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
      logContent.innerHTML = 
        '<div class="empty-state" id="empty-logs">' +
          '<i>📡</i>' +
          '<div>LOG PURGE COMPLETE</div>' +
          '<div style="font-size: 12px; margin-top: 8px;">AWAITING NEW CONNECTION DATA</div>' +
        '</div>';
      
      // Add system log
      addLog({
        time: new Date().toLocaleTimeString(),
        message: 'SYSTEM: LOG PURGE INITIATED',
        type: 'info'
      });
      
      // Show toast notification
      showToast('Logs purged successfully!', 'success');
    }

    // Refresh stats
    function refreshStats() {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: 'SYSTEM: FORCED SCAN INITIATED',
        type: 'info'
      });
      
      fetch('/api/stats')
        .then(r => r.json())
        .then(data => {
          updateStats(data);
          showToast('Force scan completed!', 'success');
        })
        .catch(err => {
          showToast('Force scan failed!', 'error');
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
          // Add heartbeat pulse effect
          document.querySelectorAll('.stat-card').forEach(card => {
            card.style.animation = 'none';
            setTimeout(() => {
              card.style.animation = '';
            }, 10);
          });
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
        message: '⚠️ CONNECTION LOST - ATTEMPTING RECONNECT...',
        type: 'error'
      });
      
      // Add visual warning effect
      document.querySelector('.status-dot').style.background = '#ff2a6d';
      document.querySelector('.status-dot').style.boxShadow = '0 0 20px #ff2a6d';
      
      setTimeout(() => {
        document.querySelector('.status-dot').style.background = '#00ff88';
        document.querySelector('.status-dot').style.boxShadow = '0 0 10px #00ff88';
      }, 2000);
    };

    // Initial setup
    updateServerTime();
    
    // Add sparkle animation to CSS
    const sparkleStyle = document.createElement('style');
    sparkleStyle.textContent = 
      '@keyframes sparklePulse {' +
        '0%, 100% { ' +
          'opacity: 0;' +
          'transform: scale(0.5);' +
        '}' +
        '50% { ' +
          'opacity: 1;' +
          'transform: scale(1.5);' +
        '}' +
      '}';
    document.head.appendChild(sparkleStyle);
    
    // Add CSS for toast animation
    const style = document.createElement('style');
    style.textContent = 
      '@keyframes slideIn {' +
        'from {' +
          'transform: translateX(100%);' +
          'opacity: 0;' +
        '}' +
        'to {' +
          'transform: translateX(0);' +
          'opacity: 1;' +
        '}' +
      '}' +
      '@keyframes slideOut {' +
        'from {' +
          'transform: translateX(0);' +
          'opacity: 1;' +
        '}' +
        'to {' +
          'transform: translateX(100%);' +
          'opacity: 0;' +
        '}' +
      '}';
    document.head.appendChild(style);
    
    // Start matrix rain effect
    startMetricRain();
    
    // Load initial data
    fetch('/api/stats')
      .then(r => r.json())
      .then(data => {
        updateStats(data);
        // Add initial system message
        addLog({
          time: new Date().toLocaleTimeString(),
          message: 'SYSTEM: LOCKDOWN CONTROL INITIALIZED',
          type: 'info'
        });
        addLog({
          time: new Date().toLocaleTimeString(),
          message: 'SYSTEM: MATRIX DIGITAL RAIN ACTIVATED',
          type: 'info'
        });
        addLog({
          time: new Date().toLocaleTimeString(),
          message: 'SYSTEM: MONITORING PROTOCOL ACTIVE',
          type: 'info'
        });
      });
    
    loadUrlLists();
    
    // Auto-refresh URL lists every 10 seconds
    setInterval(loadUrlLists, 10000);
    
    // Random system status updates
    setInterval(() => {
      if (Math.random() > 0.7) {
        const messages = [
          'SYSTEM: SCAN CYCLE COMPLETE',
          'SYSTEM: ALL SYSTEMS NOMINAL',
          'SYSTEM: PROXY NETWORK ACTIVE',
          'SYSTEM: ENCRYPTION ACTIVE',
          'SYSTEM: TARGET ACQUISITION RUNNING',
          'SYSTEM: MATRIX STREAM STABLE',
          'SYSTEM: DIGITAL RAIN ACTIVE',
          'SYSTEM: NEON PURPLE MATRIX OPERATIONAL',
          'SYSTEM: DATA STREAM OPTIMIZED',
          'SYSTEM: CYBER MONITORING ACTIVE'
        ];
        addLog({
          time: new Date().toLocaleTimeString(),
          message: messages[Math.floor(Math.random() * messages.length)],
          type: 'info'
        });
      }
    }, 15000);
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
  broadcastLog(`🌐 LOCKDOWN SYSTEM ACTIVATED ON PORT ${PORT}`, "info");
});

// Start main loop
mainLoop();
