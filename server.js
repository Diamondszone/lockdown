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

const REQUEST_TIMEOUT = Number(process.env.REQUEST_TIMEOUT || 30000);
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
  timeout: 30000
});
const httpsAgent = new https.Agent({ 
  keepAlive: true, 
  maxSockets: 50,
  timeout: 30000,
  rejectUnauthorized: false
});

const client = axios.create({
  timeout: REQUEST_TIMEOUT,
  maxRedirects: 5,
  httpAgent,
  httpsAgent,
  validateStatus: () => true,
});

const proxyClient = axios.create({
  timeout: 30000,
  maxRedirects: 5,
  httpAgent: new http.Agent({ 
    keepAlive: false,
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
  if (ct.includes("application/json")) {
    return true;
  }
  
  if (typeof resp.data === "object" && resp.data !== null) {
    return true;
  }
  
  if (typeof bodyStr === "string") {
    const trimmed = bodyStr.trim();
    
    if (!trimmed) return false;
    
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || 
        (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        JSON.parse(trimmed);
        return true;
      } catch (e) {
        return false;
      }
    }
  }
  
  return false;
}

function shortBody(body) {
  const s = typeof body === "string" ? body : JSON.stringify(body);
  if (s.length > 150) {
    return s.slice(0, 150) + " …";
  }
  return s;
}

function isCaptchaResponse(bodyStr) {
  if (!bodyStr || typeof bodyStr !== 'string') return false;
  const lowerBody = bodyStr.toLowerCase();
  return lowerBody.includes('captcha') || 
         lowerBody.includes('zcaptcha') ||
         lowerBody.includes('human verification') ||
         lowerBody.includes('verification') && lowerBody.includes('human');
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

function generateZcomHash() {
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 15);
  const hashInput = `${timestamp}${randomStr}tessa.cz`;
  return crypto.createHash('sha256').update(hashInput).digest('hex');
}

// ⬇️ BARU: Extract domain dari URL target
function getDomainFromUrl(url) {
  try {
    const urlObj = new URL(normalizeDirectUrl(url));
    return urlObj.origin; // Mengembalikan https://domain.com
  } catch (e) {
    return "https://example.com"; // Fallback
  }
}

function buildRequestUrl(targetUrl, useProxy = false) {
  const urlObj = new URL(targetUrl);
  urlObj.searchParams.set('ZCOMAFWCHECKHASH', generateZcomHash());
  
  const fullUrl = urlObj.toString();
  
  if (useProxy) {
    return `${CORS_PROXY}/${fullUrl}`;
  }
  return normalizeDirectUrl(fullUrl);
}

function parseJsonResponse(bodyStr) {
  try {
    if (typeof bodyStr === 'string') {
      return JSON.parse(bodyStr);
    }
    return bodyStr;
  } catch (e) {
    return null;
  }
}

function logResponse(targetUrl, resp, ms, useProxy, bodyText) {
  const isJson = isJsonResponse(resp, bodyText);
  const status = resp.status;
  const size = bodyText.length;
  const mode = useProxy ? "(PROXY)" : "(direct)";
  
  if (isJson) {
    const jsonData = parseJsonResponse(bodyText);
    console.log(`✅ JSON ${status} | ${targetUrl} | ${ms} ms ${mode} | Size: ${size} chars`);
    
    if (jsonData) {
      if (typeof jsonData === 'object') {
        const keys = Object.keys(jsonData).slice(0, 3);
        const preview = keys.map(key => {
          const value = jsonData[key];
          return `${key}: ${typeof value === 'string' ? value.substring(0, 30) + (value.length > 30 ? '...' : '') : typeof value}`;
        }).join(', ');
        
        if (preview) {
          console.log(`   📊 JSON Preview: { ${preview} }`);
        }
      }
    }
  } else if (isCaptchaResponse(bodyText)) {
    console.log(`🛑 CAPTCHA ${status} | ${targetUrl} | ${ms} ms ${mode} | Size: ${size} chars`);
    console.log(`   🔒 Terdeteksi halaman CAPTCHA`);
  } else if (status >= 400) {
    console.log(`❌ ERROR ${status} | ${targetUrl} | ${ms} ms ${mode} | Size: ${size} chars`);
    console.log(`   📄 Response: ${shortBody(bodyText)}`);
  } else {
    console.log(`⚠️ BUKAN JSON ${status} | ${targetUrl} | ${ms} ms ${mode} | Size: ${size} chars`);
    console.log(`   📄 Response: ${shortBody(bodyText)}`);
  }
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

async function hitOne(targetUrl, retryCount = 0, useProxy = false) {
  const reqUrl = buildRequestUrl(targetUrl, useProxy);
  const t0 = Date.now();
  let resp;
  
  try {
    // ⬇️ BARU: Ambil domain secara otomatis dari target URL
    const targetDomain = getDomainFromUrl(targetUrl);
    
    const headers = useProxy ? {
      "Accept": "application/json,text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "User-Agent": getRandomUserAgent(),
      "Origin": targetDomain, // ⬅️ OTOMATIS dari target URL
      "X-Requested-With": "XMLHttpRequest",
      "Referer": targetDomain + "/", // ⬅️ OTOMATIS dari target URL
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "cross-site",
      "Connection": "close"
    } : {
      "Accept": "application/json,text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "User-Agent": getRandomUserAgent(),
      "Referer": targetDomain + "/", // ⬅️ OTOMATIS dari target URL
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin"
    };

    const requestClient = useProxy ? proxyClient : client;
    
    resp = await requestClient.get(reqUrl, {
      responseType: "text",
      headers: headers,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      decompress: true
    });

  } catch (err) {
    const ms = Date.now() - t0;
    console.log(`💥 REQUEST ERROR | ${targetUrl} | ${ms} ms ${useProxy ? "(PROXY)" : "(direct)"}`);
    console.log(`   🚨 Error: ${err.message}`);
    
    if (retryCount < MAX_RETRIES) {
      const retryDelay = 3000 * (retryCount + 1);
      console.log(`   ⏳ Retry ${retryCount + 1}/${MAX_RETRIES} dalam ${retryDelay}ms...`);
      await sleep(retryDelay);
      return hitOne(targetUrl, retryCount + 1, useProxy);
    }
    
    return { ok: false, status: 0, useProxy, error: err.message };
  }

  const ms = Date.now() - t0;
  const bodyText = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);

  logResponse(targetUrl, resp, ms, useProxy, bodyText);

  if (isCaptchaResponse(bodyText)) {
    if (!useProxy && retryCount === 0) {
      console.log(`   🔄 Coba dengan PROXY...`);
      await sleep(2000);
      return hitOne(targetUrl, retryCount + 1, true);
    }
    
    if (retryCount < MAX_RETRIES) {
      const retryDelay = 5000 * (retryCount + 1);
      console.log(`   ⏳ Retry ${retryCount + 1}/${MAX_RETRIES} dalam ${retryDelay}ms...`);
      await sleep(retryDelay);
      return hitOne(targetUrl, retryCount + 1, useProxy);
    }
    
    return { ok: false, status: resp.status, captcha: true, useProxy };
  }

  if (isJsonResponse(resp, bodyText)) {
    return { ok: true, status: resp.status, useProxy, json: true };
  } else {
    return { ok: false, status: resp.status, useProxy, json: false };
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
  } else {
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const chunk = urls.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(u => hitOne(u)));
      
      if (i + CONCURRENCY < urls.length) {
        const randomDelay = PER_URL_DELAY_MS + Math.random() * 2000;
        await sleep(randomDelay);
      }
    }
  }
}

async function mainLoop() {
  console.log(
    `🚀 Mulai URL Runner | mode=${USE_PROXY ? "proxy-first" : "direct-first"} | concurrency=${CONCURRENCY} | timeout=${REQUEST_TIMEOUT}ms\n`
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
    } else {
      console.log(`🔄 Refresh daftar URL...\n`);
      await sleep(5000);
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
      "✅ Railway URL Runner (Enhanced) aktif.",
      `MODE=${USE_PROXY ? "proxy-first" : "direct-first"}`,
      `SOURCE_URL=${SOURCE_URL}`,
      `CORS_PROXY=${CORS_PROXY}`,
      `CONCURRENCY=${CONCURRENCY}`,
      `TIMEOUT=${REQUEST_TIMEOUT}ms`,
      "",
      "Fitur:",
      "• Auto domain detection", 
      "• Deteksi JSON akurat",
      "• Preview JSON response", 
      "• Auto proxy fallback",
      "• Detailed logging"
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
