// server.js
import express from "express";
import axios from "axios";
import http from "http";
import https from "https";

/* =========================
 * ENV & Konfigurasi
 * ========================= */
const SOURCE_URL =
  process.env.SOURCE_URL ||
  "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";

const USE_PROXY = Number(process.env.USE_PROXY || 0);
const CORS_PROXY =
  process.env.CORS_PROXY ||
  "https://cors-anywhere-vercel-dzone.vercel.app/";

const REQUEST_TIMEOUT = Number(process.env.REQUEST_TIMEOUT || 60000);
const LOOP_DELAY_MINUTES = Number(process.env.LOOP_DELAY_MINUTES || 0);
const PER_URL_DELAY_MS = Number(process.env.PER_URL_DELAY_MS || 5000); // ⬅️ DIUBAH: 250 → 5000
const CONCURRENCY = Number(process.env.CONCURRENCY || 1); // ⬅️ DIUBAH: 0 → 1

// ⬇️ BARU: Tambah setting untuk retry dan delay
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 2);
const MIN_DELAY_MS = Number(process.env.MIN_DELAY_MS || 3000);
const MAX_DELAY_MS = Number(process.env.MAX_DELAY_MS || 8000);

/* =========================
 * Axios client (keep-alive)
 * ========================= */
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 }); // ⬅️ DIKURANGI: 200 → 50
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 }); // ⬅️ DIKURANGI: 200 → 50

const client = axios.create({
  timeout: REQUEST_TIMEOUT,
  maxRedirects: 5, // ⬅️ DITAMBAH: 3 → 5
  httpAgent,
  httpsAgent,
  validateStatus: () => true,
});

/* =========================
 * Helpers
 * ========================= */

function toSingleSlashScheme(url) {
  return url.replace(/^https?:\/\//i, (m) => m.slice(0, -1));
}

function normalizeDirectUrl(u) {
  if (!/^https?:\/\//i.test(u)) return "https://" + u.replace(/^\/+/, "");
  return u;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseList(txt) {
  return (txt || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"));
}

function isJsonResponse(resp, bodyStr) {
  const ct = (resp.headers?.["content-type"] || "").toLowerCase();
  if (ct.includes("application/json")) return true;
  try {
    if (typeof resp.data === "object" && resp.data !== null) return true;
    if (typeof bodyStr === "string") {
      const t = bodyStr.trim();
      if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
        JSON.parse(t);
        return true;
      }
    }
  } catch {}
  return false;
}

function shortBody(body) {
  const s = typeof body === "string" ? body : JSON.stringify(body);
  return s.length > 200 ? s.slice(0, 200) + " …" : s;
}

// ⬇️ BARU: Deteksi CAPTCHA
function isCaptchaResponse(bodyStr) {
  if (!bodyStr || typeof bodyStr !== 'string') return false;
  const lowerBody = bodyStr.toLowerCase();
  return lowerBody.includes('captcha') || 
         lowerBody.includes('zcaptcha') ||
         lowerBody.includes('human verification');
}

// ⬇️ BARU: Random User-Agent
function getRandomUserAgent() {
  const agents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0'
  ];
  return agents[Math.floor(Math.random() * agents.length)];
}

/* =========================
 * Core - MODIFIKASI hitOne SAJA
 * ========================= */
async function fetchList() {
  console.log(`📥 Ambil daftar URL dari: ${SOURCE_URL}`);
  const resp = await client.get(SOURCE_URL, { responseType: "text" });
  if (resp.status !== 200) {
    throw new Error(`Gagal ambil node.txt | HTTP ${resp.status}`);
  }
  const list = parseList(resp.data);
  console.log(`📄 Dapat ${list.length} URL dari node.txt`);
  return list;
}

function buildRequestUrl(targetUrl) {
  if (USE_PROXY) {
    const singleSlash = toSingleSlashScheme(targetUrl);
    return `${CORS_PROXY}${singleSlash}`;
  }
  return normalizeDirectUrl(targetUrl);
}

// ⬇️ DIUBAH: hitOne dengan header better dan retry mechanism
async function hitOne(targetUrl, retryCount = 0) {
  const reqUrl = buildRequestUrl(targetUrl);
  const t0 = Date.now();
  let resp;
  
  try {
    resp = await client.get(reqUrl, {
      responseType: "text",
      headers: {
        "Accept": "application/json,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": getRandomUserAgent(), // ⬅️ DIUBAH: Random UA
      },
    });
  } catch (err) {
    console.log(`❌ ${targetUrl} | ERROR request: ${err.message} ${USE_PROXY ? "(proxy)" : "(direct)"}`);
    return { ok: false, status: 0 };
  }

  const ms = Date.now() - t0;
  const bodyText = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);

  // ⬇️ BARU: Cek CAPTCHA dan retry
  if (isCaptchaResponse(bodyText)) {
    console.log(`🛑 CAPTCHA Ditemukan | ${targetUrl} | HTTP ${resp.status} | ${ms} ms`);
    
    if (retryCount < MAX_RETRIES) {
      const retryDelay = 5000 * (retryCount + 1); // 5s, 10s, 15s
      console.log(`⏳ Retry ${retryCount + 1}/${MAX_RETRIES} dalam ${retryDelay}ms...`);
      await sleep(retryDelay);
      return hitOne(targetUrl, retryCount + 1);
    }
    
    return { ok: false, status: resp.status, captcha: true };
  }

  if (isJsonResponse(resp, bodyText)) {
    console.log(`✅ JSON | ${targetUrl} | HTTP ${resp.status} | ${ms} ms ${USE_PROXY ? "(proxy)" : "(direct)"}`);
    return { ok: true, status: resp.status };
  } else {
    console.log(
      `⚠️ BUKAN JSON | ${targetUrl} | HTTP ${resp.status} | ${ms} ms ${USE_PROXY ? "(proxy)" : "(direct)"}`
    );
    return { ok: false, status: resp.status };
  }
}

// ⬇️ DIUBAH SEDIKIT: runBatched dengan random delay
async function runBatched(urls) {
  if (urls.length === 0) return;

  if (CONCURRENCY <= 0) {
    // Sequential dengan delay antar request
    for (let i = 0; i < urls.length; i++) {
      await hitOne(urls[i]);
      if (i < urls.length - 1) {
        const randomDelay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
        await sleep(randomDelay);
      }
    }
    return;
  }

  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const chunk = urls.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(u => hitOne(u)));
    
    if (i + CONCURRENCY < urls.length && PER_URL_DELAY_MS > 0) {
      const randomDelay = PER_URL_DELAY_MS + Math.random() * 2000; // Randomize delay
      await sleep(randomDelay);
    }
  }
}

async function mainLoop() {
  console.log(
    `🚀 Mulai | mode=${USE_PROXY ? "proxy" : "direct"} | concurrency=${CONCURRENCY} | delays=${MIN_DELAY_MS}-${MAX_DELAY_MS}ms | retries=${MAX_RETRIES}`
  );
  while (true) {
    try {
      const list = await fetchList();
      if (list.length) {
        await runBatched(list);
      } else {
        console.log("ℹ️ node.txt kosong.");
      }
    } catch (e) {
      console.log(`❌ Loop error: ${e.message}`);
    }

    const waitMs = Math.max(0, LOOP_DELAY_MINUTES * 60 * 1000);
    if (waitMs > 0) {
      console.log(`🕒 Tunggu ${LOOP_DELAY_MINUTES} menit sebelum refresh berikutnya...\n`);
      await sleep(waitMs);
    }
  }
}

/* =========================
 * HTTP Health Check
 * ========================= */
const app = express();
app.get("/", (req, res) => {
  res.type("text/plain").send(
    [
      "✅ Railway URL Runner (CAPTCHA-aware) aktif.",
      `MODE=${USE_PROXY ? "proxy" : "direct"}`,
      `SOURCE_URL=${SOURCE_URL}`,
      `CONCURRENCY=${CONCURRENCY}`,
      `DELAYS=${MIN_DELAY_MS}-${MAX_DELAY_MS}ms`,
      `RETRIES=${MAX_RETRIES}`,
      "",
      "Fitur anti-CAPTCHA:",
      "• Random User-Agent",
      "• Retry mechanism", 
      "• Realistic delays"
    ].join("\n")
  );
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Web service di port ${PORT}`));

// Mulai loop
mainLoop().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
