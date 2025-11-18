// server.js
import express from "express";
import axios from "axios";

const SOURCE_URL = process.env.SOURCE_URL || "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";
const CORS_PROXY = process.env.CORS_PROXY || "https://cors-anywhere-railway-production.up.railway.app";

// ==============================================
// FUNGSI UTAMA
// ==============================================
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

// ==============================================
// LOGIKA HIT URL
// ==============================================
async function hitUrl(url) {
  const direct = await fetchText(url);
  const directJson = direct.ok && !isCaptcha(direct.text) && isJson(direct.text);

  if (directJson) {
    console.log(`🔗 URL: ${url} | ✅ Direct OK | JSON`);
    return;
  }

  const proxied = await fetchText(buildProxyUrl(url));
  const proxyJson = proxied.ok && !isCaptcha(proxied.text) && isJson(proxied.text);

  if (proxyJson) {
    console.log(`🔗 URL: ${url} | ✅ Proxy OK | JSON`);
  } else {
    console.log(`🔗 URL: ${url} | ❌ Direct & Proxy | BUKAN JSON`);
  }
}

// ==============================================
// QUEUE UTAMA (TEMPAT URL DISIMPAN PERMANEN)
// ==============================================
let urlQueue = [];     // semua URL akan terus ada di sini
let pointer = 0;       // penunjuk URL yang sedang diproses

// ==============================================
// FETCH URL AWAL (HANYA SEKALI)
// ==============================================
async function loadInitialList() {
  try {
    const resp = await fetchText(SOURCE_URL);
    if (resp.ok) {
      urlQueue = parseList(resp.text);
      console.log("URL awal dimuat:", urlQueue.length);
    }
  } catch (e) {
    console.log("Gagal load awal:", e.message);
  }
}

// ==============================================
// CEK URL BARU SETIAP 5 DETIK → MASUKKAN KE QUEUE
// ==============================================
async function watchForNewUrls() {
  setInterval(async () => {
    try {
      const resp = await fetchText(SOURCE_URL);
      if (!resp.ok) return;

      const latest = parseList(resp.text);

      for (const u of latest) {
        if (!urlQueue.includes(u)) {
          urlQueue.push(u);
          console.log("➕ URL baru ditambahkan:", u);
        }
      }
    } catch (e) {
      console.log("Error cek URL baru:", e.message);
    }
  }, 5000);
}

// ==============================================
// WORKER UTAMA: NO DELAY, ULTRA FAST LOOP
// ==============================================
async function startWorkers() {
  const WORKERS = 20; // paralel maksimum

  async function worker() {
    while (true) {
      if (urlQueue.length === 0) continue;

      if (pointer >= urlQueue.length) pointer = 0;

      let url = urlQueue[pointer++];
      await hitUrl(url);
    }
  }

  for (let i = 0; i < WORKERS; i++) {
    worker();
  }

  console.log(`Worker berjalan (${WORKERS} paralel).`);
}

// ==============================================
// WEB SERVER
// ==============================================
const app = express();
app.get("/", (req, res) => res.send("✅ URL Runner Active"));
app.listen(process.env.PORT || 3000, () =>
  console.log("🌐 Web service running")
);

// ==============================================
// START SEMUA
// ==============================================
(async () => {
  await loadInitialList();
  await startWorkers();
  watchForNewUrls();
})();
