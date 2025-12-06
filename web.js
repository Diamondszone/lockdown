// web.js
import express from "express";
import axios from "axios";

// ======================== CONFIG ===========================
const SOURCE_URL =
  process.env.SOURCE_URL ||
  "https://ampnyapunyaku.top/api/lockdown-atc/node.txt";

const CORS_PROXY =
  process.env.CORS_PROXY ||
  "https://cors-anywhere-railway-production.up.railway.app";

// ======================== LOG MEMORY ===========================
let LOGS = [];
function pushLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  LOGS.unshift(line);
  if (LOGS.length > 5000) LOGS = LOGS.slice(0, 5000);
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
  const direct = await fetchText(url);
  const directOk = direct.ok && !isCaptcha(direct.text) && isJson(direct.text);

  if (directOk) {
    pushLog(`🔗 URL: ${url} | ✅ Direct OK | JSON`);
    return;
  }

  const proxied = await fetchText(buildProxyUrl(url));
  const proxyOk =
    proxied.ok && !isCaptcha(proxied.text) && isJson(proxied.text);

  if (proxyOk) {
    pushLog(`🔗 URL: ${url} | ✅ Proxy OK | JSON`);
  } else {
    pushLog(`🔗 URL: ${url} | ❌ Direct & Proxy | BUKAN JSON`);
  }
}

// ======================== WORKER ===========================
async function mainLoop() {
  const WORKERS = 20;

  while (true) {
    try {
      const listResp = await fetchText(SOURCE_URL);
      const urls = listResp.ok ? parseList(listResp.text) : [];

      if (urls.length === 0) {
        pushLog("❌ SOURCE kosong → ulangi loop…");
        continue;
      }

      pushLog(`📌 Memuat ${urls.length} URL…`);

      let current = 0;

      async function worker() {
        while (true) {
          let u = urls[current++];
          if (!u) break;
          await hitUrl(u);
        }
      }

      const pool = [];
      for (let i = 0; i < WORKERS; i++) pool.push(worker());

      await Promise.all(pool);
    } catch (err) {
      pushLog("❌ ERROR LOOP: " + err.message);
    }
  }
}

// ======================== DASHBOARD WEB ===========================
const app = express();

app.get("/", (req, res) => {
  res.send(`
  <html>
  <head>
    <title>JSON Checker Dashboard</title>
    <style>
      body { font-family: Arial; background: #111; color:#eee; padding:20px; }
      h1 { color:#4de34d; }
      pre {
        white-space: pre-wrap;
        background:#000;
        padding:20px;
        border-radius:8px;
        height:85vh;
        overflow-y:scroll;
        font-size:14px;
        line-height:1.4;
      }
      button {
        padding:10px 20px;
        background:#4de34d;
        border:none;
        border-radius:6px;
        cursor:pointer;
        margin-bottom:10px;
      }
    </style>
  </head>

  <body>
    <h1>🔍 JSON CHECKER DASHBOARD</h1>
    <button onclick="location.reload()">Refresh</button>
    <pre id="log">${LOGS.join("\n")}</pre>
  </body>
  </html>
  `);
});

app.get("/logs", (req, res) => {
  res.json({ logs: LOGS });
});

app.listen(process.env.PORT || 3000, () =>
  pushLog("🌐 Dashboard aktif di port 3000")
);

// ======================== START ENGINE ===========================
mainLoop();
