// server.js
import express from "express";
import axios from "axios";
import http from "http";
import https from "https";
import crypto from "crypto";

/* =========================
 * ENV & Konfigurasi
 * ========================= */
const SOURCE_URL =
  process.env.SOURCE_URL ||
  "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";

const USE_PROXY = Number(process.env.USE_PROXY || 0);
const CORS_PROXY =
  process.env.CORS_PROXY ||
  "https://cors-anywhere-railway-production.up.railway.app";

const REQUEST_TIMEOUT = Number(process.env.REQUEST_TIMEOUT || 30000); // ⬅️ DIKURANGI: 60000 → 30000
const LOOP_DELAY_MINUTES = Number(process.env.LOOP_DELAY_MINUTES || 0);
const PER_URL_DELAY_MS = Number(process.env.PER_URL_DELAY_MS || 5000);
const CONCURRENCY = Number(process.env.CONCURRENCY || 1);

const MAX_RETRIES = Number(process.env.MAX_RETRIES || 2);
const MIN_DELAY_MS = Number(process.env.MIN_DELAY_MS || 3000);
const MAX_DELAY_MS = Number(process.env.MAX_DELAY_MS || 8000);

/* =========================
 * Axios client (keep-alive)
 * ========================= */
const httpAgent = new http.Agent({ 
  keepAlive: true, 
  maxSockets: 50,
  timeout: 30000 // ⬅️ TAMBAH
});
const httpsAgent = new https.Agent({ 
  keepAlive: true, 
  maxSockets: 50,
  timeout: 30000, // ⬅️ TAMBAH
  rejectUnauthorized: false // ⬅️ TAMBAH: ignore SSL certificate errors
});

const client = axios.create({
  timeout: REQUEST_TIMEOUT,
  maxRedirects: 5,
  httpAgent,
  httpsAgent,
  validateStatus: () => true,
});

// ⬇️ BARU: Client khusus untuk proxy (tanpa keep-alive)
const proxyClient = axios.create({
  timeout: 30000,
  maxRedirects: 5,
  httpAgent: new http.Agent({ 
    keepAlive: false, // ⬅️ Proxy sering masalah dengan keep-alive
    timeout: 30000
  }),
  httpsAgent: new https.Agent({ 
    keepAlive: false,
    timeout: 30000,
    rejectUnauthorized: false
  }),
  validateStatus: () => true,
});

/* =========================
 * Helpers
 * ========================= */

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

function isCaptchaResponse(bodyStr) {
  if (!bodyStr || typeof bodyStr !== 'string') return false;
  const lowerBody = bodyStr.toLowerCase();
  return lowerBody.includes('captcha') || 
         lowerBody.includes('zcaptcha') ||
         lowerBody.includes('human verification');
}

function getRandomUserAgent() {
  const agents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/120.0.0.0 Safari/537.36'
  ];
  return agents[Math.floor(Math.random() * agents.length)];
}

// ⬇️ BARU: Generate ZCOMAFWCHECKHASH seperti di browser
function generateZcomHash() {
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 15);
  const hashInput = `${timestamp}${randomStr}tessa.cz`;
  return crypto.createHash('sha256').update(hashInput).digest('hex');
}

// ⬇️ BARU: Build URL dengan parameter lengkap seperti browser
function buildRequestUrl(targetUrl, useProxy = false) {
  // Parse URL untuk menambahkan parameter ZCOMAFWCHECKHASH
  const urlObj = new URL(targetUrl);
  urlObj.searchParams.set('ZCOMAFWCHECKHASH', generateZcomHash());
  
  const fullUrl = urlObj.toString();
  
  if (useProxy) {
    return `${CORS_PROXY}/${fullUrl}`;
  }
  return normalizeDirectUrl(fullUrl);
}

/* =========================
 * Core
 * ========================= */
async function fetchList() {
  console.log(`📥 Ambil daftar URL dari: ${SOURCE_URL}`);
  const resp = await client.get(SOURCE_URL, { 
    responseType: "text",
    headers: {
      'User-Agent': getRandomUserAgent()
    }
  });
  if (resp.status !== 200) {
    throw new Error(`Gagal ambil node.txt | HTTP ${resp.status}`);
  }
  const list = parseList(resp.data);
  console.log(`📄 Dapat ${list.length} URL dari node.txt`);
  return list;
}

// ⬇️ DIUBAH BESAR: hitOne dengan improvement untuk proxy
async function hitOne(targetUrl, retryCount = 0, useProxy = false) {
  const reqUrl = buildRequestUrl(targetUrl, useProxy);
  const t0 = Date.now();
  let resp;
  
  try {
    const headers = useProxy ? {
      "Accept": "application/json,text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "User-Agent": getRandomUserAgent(),
      "Origin": "https://tessa.cz", // ⬅️ DIUBAH: pakai domain asli
      "X-Requested-With": "XMLHttpRequest",
      "Referer": "https://tessa.cz/",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "cross-site",
      "Connection": "close" // ⬅️ BARU: close connection untuk proxy
    } : {
      "Accept": "application/json,text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "User-Agent": getRandomUserAgent(),
      "Referer": "https://tessa.cz/",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin"
    };

    // ⬇️ BARU: Gunakan client yang berbeda untuk proxy
    const requestClient = useProxy ? proxyClient : client;
    
    resp = await requestClient.get(reqUrl, {
      responseType: "text",
      headers: headers,
      // ⬇️ BARU: Tambah config untuk handle redirect dan response
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      decompress: true // ⬅️ Enable decompression
    });

  } catch (err) {
    console.log(`❌ ${targetUrl} | ERROR: ${err.message} ${useProxy ? "(PROXY)" : "(direct)"}`);
    
    // ⬇️ BARU: Retry logic yang lebih baik
    if (retryCount < MAX_RETRIES) {
      const retryDelay = 3000 * (retryCount + 1);
      console.log(`⏳ Retry ${retryCount + 1}/${MAX_RETRIES} dalam ${retryDelay}ms...`);
      await sleep(retryDelay);
      return hitOne(targetUrl, retryCount + 1, useProxy);
    }
    
    return { ok: false, status: 0, useProxy, error: err.message };
  }

  const ms = Date.now() - t0;
  const bodyText = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);

  // ⬇️ BARU: Debug response
  console.log(`🔍 ${targetUrl} | HTTP ${resp.status} | ${ms} ms ${useProxy ? "(PROXY)" : "(direct)"} | Size: ${bodyText.length} chars`);

  if (isCaptchaResponse(bodyText)) {
    console.log(`🛑 CAPTCHA Ditemukan | ${targetUrl} | HTTP ${resp.status} | ${ms} ms ${useProxy ? "(PROXY)" : "(direct)"}`);
    
    if (!useProxy && retryCount === 0) {
      console.log(`🔄 Coba dengan PROXY...`);
      await sleep(2000);
      return hitOne(targetUrl, retryCount + 1, true);
    }
    
    if (retryCount < MAX_RETRIES) {
      const retryDelay = 5000 * (retryCount + 1);
      console.log(`⏳ Retry ${retryCount + 1}/${MAX_RETRIES} dalam ${retryDelay}ms...`);
      await sleep(retryDelay);
      return hitOne(targetUrl, retryCount + 1, useProxy);
    }
    
    return { ok: false, status: resp.status, captcha: true, useProxy };
  }

  if (isJsonResponse(resp, bodyText)) {
    console.log(`✅ JSON | ${targetUrl} | HTTP ${resp.status} | ${ms} ms ${useProxy ? "(PROXY)" : "(direct)"}`);
    return { ok: true, status: resp.status, useProxy };
  } else {
    console.log(
      `⚠️ BUKAN JSON | ${targetUrl} | HTTP ${resp.status} | ${ms} ms | Preview: ${shortBody(bodyText)} ${useProxy ? "(PROXY)" : "(direct)"}`
    );
    return { ok: false, status: resp.status, useProxy };
  }
}

async function runBatched(urls) {
  if (urls.length === 0) return;

  if (CONCURRENCY <= 0) {
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
    
    if (i + CONCURRENCY < urls.length) {
      const randomDelay = PER_URL_DELAY_MS + Math.random() * 2000;
      await sleep(randomDelay);
    }
  }
}

async function mainLoop() {
  console.log(
    `🚀 Mulai | mode=${USE_PROXY ? "proxy-first" : "direct-first"} | concurrency=${CONCURRENCY} | timeout=${REQUEST_TIMEOUT}ms`
  );
  while (true) {
    try {
      const list = await fetchList();
      if (list.length) {
        await runBatched(list);
        console.log(`✅ Selesai batch ${list.length} URL`);
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
    } else {
      console.log(`🔄 Refresh daftar URL...\n`);
      await sleep(5000); // Minimal delay 5 detik
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
      "✅ Railway URL Runner (Enhanced Proxy) aktif.",
      `MODE=${USE_PROXY ? "proxy-first" : "direct-first"}`,
      `SOURCE_URL=${SOURCE_URL}`,
      `CORS_PROXY=${CORS_PROXY}`,
      `TIMEOUT=${REQUEST_TIMEOUT}ms`,
      `CONCURRENCY=${CONCURRENCY}`,
      "",
      "Improvements:",
      "• ZCOMAFWCHECKHASH parameter",
      "• Separate proxy client", 
      "• Better headers matching browser",
      "• SSL error handling",
      "• Connection management"
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
