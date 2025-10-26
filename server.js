// server.js
import express from "express";
import axios from "axios";
import http from "http";
import https from "https";
import dns from "dns";
import { URL } from "url";

import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* =========================
 * ENV & Konfigurasi
 * ========================= */
const SOURCE_URL = process.env.SOURCE_URL || "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";
const REQUEST_TIMEOUT = Number(process.env.REQUEST_TIMEOUT || 60000);
const PER_URL_DELAY_MS = Number(process.env.PER_URL_DELAY_MS || 0); // default: tanpa jeda per URL

// NEW: toggle untuk mematikan proxy (0 = OFF / langsung GET ke target, 1 = ON / via CORS proxy)
const USE_PROXY = process.env.USE_PROXY !== "0";

const CORS_PROXY = (process.env.CORS_PROXY || "https://cors-anywhere-vercel-dzone.vercel.app/").replace(/\/+$/, "/");
const USE_ENCODED = process.env.USE_ENCODED === "1"; // set "1" jika proxy perlu encoded target

// Opsi jeda loop (prioritas: MS > SEC > MIN). Default: 0 ms (langsung lanjut)
const _LOOP_DELAY_MS  = process.env.LOOP_DELAY_MS ?? "";
const _LOOP_DELAY_SEC = process.env.LOOP_DELAY_SEC ?? "";
const _LOOP_DELAY_MIN = process.env.LOOP_DELAY ?? "";
const LOOP_SLEEP_MS =
  _LOOP_DELAY_MS  !== "" ? Math.max(0, Number(_LOOP_DELAY_MS)) :
  _LOOP_DELAY_SEC !== "" ? Math.max(0, Number(_LOOP_DELAY_SEC) * 1000) :
  (_LOOP_DELAY_MIN !== "" ? Math.max(0, Number(_LOOP_DELAY_MIN) * 60 * 1000) : 0);

/* =========================
 * Network Prefs & Agents
 * ========================= */
dns.setDefaultResultOrder?.("ipv4first"); // hindari bug "Invalid IP address: undefined"
const httpAgent  = new http.Agent({ keepAlive: true, keepAliveMsecs: 10000, maxSockets: 50 });
const httpsAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 10000, maxSockets: 50 });

/* =========================
 * Headers mirip browser
 * ========================= */
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
];
const rand = (n) => Math.floor(Math.random() * n);
const randomUA = () => USER_AGENTS[rand(USER_AGENTS.length)];

function browserHeaders(targetUrl) {
  const u = new URL(targetUrl);
  return {
    "Origin": "https://yourdomain.com",
    "X-Requested-With": "XMLHttpRequest",
    "User-Agent": randomUA(),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Connection": "keep-alive",
    "Referer": `${u.protocol}//${u.host}/`
  };
}

/* =========================
 * URL Builder (via proxy atau langsung)
 * ========================= */
function buildRequestUrl(targetUrl) {
  if (!USE_PROXY) return targetUrl; // proxy OFF → langsung ke target
  // proxy ON → gabungkan proxy + target (opsional encoded)
  return CORS_PROXY + (USE_ENCODED ? encodeURIComponent(targetUrl) : targetUrl);
}

/* =========================
 * Axios client
 * ========================= */
const axiosClient = axios.create({
  timeout: REQUEST_TIMEOUT,
  maxRedirects: 5,
  httpAgent,
  httpsAgent,
  decompress: true,
  validateStatus: s => s >= 200 && s < 400, // 2xx & 3xx = sukses
  maxContentLength: 5 * 1024 * 1024,
  maxBodyLength: 5 * 1024 * 1024
});

/* =========================
 * Web Service (agar stay-awake)
 * ========================= */
const app = express();
const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`🌐 Web Service aktif di port ${PORT}`);
  startLoop();
});

/* =========================
 * Utils
 * ========================= */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchList() {
  try {
    const res = await axiosClient.get(SOURCE_URL, { headers: browserHeaders(SOURCE_URL) });
    const urls = String(res.data)
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(s => s && s.startsWith("http"));
    console.log(`✅ Ditemukan ${urls.length} URL dari sumber`);
    return urls;
  } catch (e) {
    console.error(`❌ Gagal baca daftar URL: ${e?.message || e}`);
    if (e?.stack) console.log(e.stack.split("\n").slice(0, 2).join("\n"));
    return [];
  }
}

async function timed(method, url, headers) {
  const t0 = Date.now();
  try {
    const res = await axiosClient.request({ method, url, headers });
    const ms = Date.now() - t0;
    console.log(`  ✅ ${method} ${res.status} in ${ms}ms`);
    return { ok: true, status: res.status, res };
  } catch (e) {
    const ms = Date.now() - t0;
    console.log(`  ❌ ${method} error after ${ms}ms: ${e?.message || e}`);
    if (e?.stack) console.log(e.stack.split("\n").slice(0, 2).join("\n"));
    const status = e?.response?.status ?? 0;
    return { ok: false, status, res: e?.response };
  }
}

async function hitOnce(rawUrl) {
  const u = new URL(rawUrl);
  u.searchParams.set("t", Date.now().toString()); // cache-buster
  const finalUrl = buildRequestUrl(u.toString());
  const hdrs = browserHeaders(u.toString());
  return timed("GET", finalUrl, hdrs);
}

async function hitWithRetry(url) {
  const label = USE_PROXY ? "(via CORS)" : "(direct)";
  console.log(`[${new Date().toLocaleString()}] 🔁 GET ${label} ${url}`);
  let { ok, status } = await hitOnce(url);
  if (!ok) {
    const backoff = (status === 429 || status >= 500) ? 1500 : 500;
    await sleep(backoff);
    console.log(`  ↻ Retry (${backoff}ms): ${url}`);
    ({ ok } = await hitOnce(url));
  }
}

async function processAll(urls) {
  for (const url of urls) {
    await hitWithRetry(url);
    if (PER_URL_DELAY_MS > 0) await sleep(PER_URL_DELAY_MS);
  }
}

async function startLoop() {
  console.log(`🚀 Loop dimulai | SOURCE_URL: ${SOURCE_URL}`);
  console.log(`🔧 Proxy: ${USE_PROXY ? `ON | CORS_PROXY: ${CORS_PROXY} | encoded=${USE_ENCODED}` : "OFF (direct requests)"}`);
  console.log(`⏱️ Konfigurasi jeda: PER_URL_DELAY_MS=${PER_URL_DELAY_MS} | LOOP_SLEEP_MS=${LOOP_SLEEP_MS} (~${(LOOP_SLEEP_MS/60000).toFixed(3)} menit)`);
  while (true) {
    const list = await fetchList();
    if (list.length) await processAll(list);

    if (LOOP_SLEEP_MS > 0) {
      const mins = (LOOP_SLEEP_MS / 60000).toFixed(3);
      console.log(`🕒 Menunggu ~${mins} menit (${LOOP_SLEEP_MS} ms) sebelum loop berikutnya...\n`);
      await sleep(LOOP_SLEEP_MS);
    } else {
      await new Promise((r) => setImmediate(r));
    }
  }
}
