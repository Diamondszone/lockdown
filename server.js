// server.js
import express from "express";
import axios from "axios";

const SOURCE_URL = process.env.SOURCE_URL || "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";
const CORS_PROXY = process.env.CORS_PROXY || "https://cors-anywhere-railway-production.up.railway.app";

// ======================================
// Helper
// ======================================
function parseList(txt) {
  return (txt || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

function isJson(body) {
  if (!body) return false;
  try { JSON.parse(body); return true; } catch { return false; }
}

function isCaptcha(body) {
  if (!body) return false;
  const t = body.toLowerCase();
  return (
    t.includes("captcha") ||
    t.includes("verify") ||
    t.includes("robot") ||
    t.includes("cloudflare")
  );
}

function buildProxyUrl(url) {
  return `${CORS_PROXY}/${url}`;
}

async function fetchText(url) {
  try {
    const resp = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 30000,
      responseType: "text",
      validateStatus: () => true
    });

    return {
      ok: true,
      text: typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data)
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ======================================
// Logika hit URL
// ======================================
async function hitUrl(url) {
  try {
    const direct = await fetchText(url);

    if (direct.ok && !isCaptcha(direct.text) && isJson(direct.text)) {
      console.log(`🔗 ${url} | ✅ Direct OK | JSON`);
      return;
    }

    const proxied = await fetchText(buildProxyUrl(url));

    if (proxied.ok && !isCaptcha(proxied.text) && isJson(proxied.text)) {
      console.log(`🔗 ${url} | ✅ Proxy OK | JSON`);
    } else {
      console.log(`🔗 ${url} | ❌ Direct & Proxy | BUKAN JSON`);
    }
  } catch (err) {
    console.log(`🔗 ${url} | ❌ Error: ${err.message}`);
  }
}

// ======================================
// QUEUE GLOBAL
// ======================================
let urlQueue = [];
let pointer = 0;

// ======================================
// Load awal
// ======================================
async function loadInitial() {
  const res = await fetchText(SOURCE_URL);
  if (res.ok) {
    urlQueue = parseList(res.text);
    console.log(`📌 Load awal: ${urlQueue.length} URL`);
  }
}

// ======================================
// Tambah URL baru tiap 5 detik
// ======================================
async function refreshList() {
  setInterval(async () => {
    const res = await fetchText(SOURCE_URL);
    if (!res.ok) return;

    const latest = parseList(res.text);

    for (const u of latest) {
      if (!urlQueue.includes(u)) {
        urlQueue.push(u);
        console.log(`➕ URL baru: ${u}`);
      }
    }

  }, 5000);
}

// ======================================
// TRUE PARALLEL WORKERS
// ======================================
async function worker(id) {
  while (true) {
    if (urlQueue.length === 0) continue;

    if (pointer >= urlQueue.length) pointer = 0;

    const current = urlQueue[pointer++];
    await hitUrl(current); // SELESAI → LANGSUNG AMBIL URL BARU (NO DELAY)
  }
}

async function startWorkers() {
  const TOTAL = 20; // jumlah worker paralel sebenarnya

  console.log(`🚀 Menjalankan ${TOTAL} worker paralel…`);

  for (let i = 0; i < TOTAL; i++) {
    worker(i); // TIDAK MENUNGGU — langsung jalan semua
  }
}

// ======================================
// WEB SERVER
// ======================================
const app = express();
app.get("/", (req, res) => res.send("✅ URL Runner Active"));
app.listen(process.env.PORT || 3000, () =>
  console.log("🌐 Web service running")
);

// ======================================
// START
// ======================================
(async () => {
  await loadInitial();
  refreshList();
  startWorkers();
})();
