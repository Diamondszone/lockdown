// server.js
import express from "express";
import axios from "axios";

const SOURCE_URL = process.env.SOURCE_URL || "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";
const CORS_PROXY = process.env.CORS_PROXY || "https://cors-anywhere-railway-production.up.railway.app";

// =============================
// Helpers
// =============================
function parseList(txt) {
  return (txt || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

function isJson(body) {
  if (!body) return false;
  try { JSON.parse(body); return true; }
  catch { return false; }
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
      timeout: 15000,
      responseType: "text",
      validateStatus: () => true
    });

    return { ok: true, text: typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// =============================
// Hit URL logic
// =============================
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

// =============================
// Global Queue
// =============================
let queue = [];
let index = 0;

// =============================
// Load awal file node.txt
// =============================
async function loadInitial() {
  const res = await fetchText(SOURCE_URL);
  if (res.ok) {
    queue = parseList(res.text);
    console.log(`📌 Loaded ${queue.length} URL`);
  }
}

// =============================
// Cek URL baru setiap 10 detik
// =============================
async function refreshList() {
  setInterval(async () => {
    const res = await fetchText(SOURCE_URL);
    if (!res.ok) return;

    const latest = parseList(res.text);

    for (const u of latest) {
      if (!queue.includes(u)) {
        queue.push(u);
        console.log(`➕ URL baru masuk queue: ${u}`);
      }
    }

  }, 10000);
}

// =============================
// Worker Stabil
// =============================
async function worker(id) {
  while (true) {
    if (queue.length === 0) {
      await new Promise(r => setTimeout(r, 100));
      continue;
    }

    if (index >= queue.length) {
      index = 0;
    }

    const url = queue[index++];

    await hitUrl(url);

    // micro delay supaya tidak spam (sangat penting)
    await new Promise(r => setTimeout(r, 25));
  }
}

async function startWorkers() {
  const TOTAL = 10; // stabil, cepat, tidak overload
  console.log(`🚀 Starting ${TOTAL} workers…`);

  for (let i = 0; i < TOTAL; i++) {
    worker(i); // fire and forget
  }
}

// =============================
// Web Server
// =============================
const app = express();
app.get("/", (req, res) => res.send("✅ URL Runner Active"));
app.listen(process.env.PORT || 3000, () =>
  console.log("🌐 Service Running")
);

// =============================
// Start System
// =============================
(async () => {
  await loadInitial();
  refreshList();
  startWorkers();
})();
