// server.js
import express from "express";
import axios from "axios";
import http from "http";
import https from "https";
import dns from "dns";
import crypto from "crypto";
import { URL } from "url";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* =========================
 * ENV & Konfigurasi
 * ========================= */
const SOURCE_URL        = process.env.SOURCE_URL || "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";
const REQUEST_TIMEOUT   = Number(process.env.REQUEST_TIMEOUT || 60000);
const PER_URL_DELAY_MS  = Number(process.env.PER_URL_DELAY_MS || 0);
const CORS_PROXY        = (process.env.CORS_PROXY || "https://cors-anywhere-vercel-dzone.vercel.app/").replace(/\/+$/, "/");
const USE_ENCODED       = process.env.USE_ENCODED === "1"; // set "1" jika proxy perlu encoded target

// Opsi jeda loop (prioritas: MS > SEC > MIN). Default: 0 ms (langsung lanjut)
const _LOOP_DELAY_MS  = process.env.LOOP_DELAY_MS ?? "";
const _LOOP_DELAY_SEC = process.env.LOOP_DELAY_SEC ?? "";
const _LOOP_DELAY_MIN = process.env.LOOP_DELAY ?? "";
const LOOP_SLEEP_MS =
  _LOOP_DELAY_MS  !== "" ? Math.max(0, Number(_LOOP_DELAY_MS)) :
  _LOOP_DELAY_SEC !== "" ? Math.max(0, Number(_LOOP_DELAY_SEC) * 1000) :
  (_LOOP_DELAY_MIN !== "" ? Math.max(0, Number(_LOOP_DELAY_MIN) * 60 * 1000) : 0);

// Stabilitas koneksi
const KEEP_ALIVE           = process.env.KEEP_ALIVE !== "0";            // default ON
const RECREATE_EACH_LOOP   = process.env.RECREATE_EACH_LOOP === "1";    // recreate axios tiap loop
const AGENT_RESET_EVERY    = Number(process.env.AGENT_RESET_EVERY || 250); // recreate setelah N request

/* =========================
 * Network Prefs & Agents (dinamis)
 * ========================= */
dns.setDefaultResultOrder?.("ipv4first"); // hindari bug "Invalid IP address: undefined"

let httpAgent = null;
let httpsAgent = null;
let axiosClient = null;
let _reqCountSinceReset = 0;

function makeAgents() {
  if (!KEEP_ALIVE) return { httpAgent: undefined, httpsAgent: undefined };
  return {
    httpAgent: new http.Agent({ keepAlive: true, keepAliveMsecs: 10000, maxSockets: 50, maxFreeSockets: 10 }),
    httpsAgent: new https.Agent({ keepAlive: true, keepAliveMsecs: 10000, maxSockets: 50, maxFreeSockets: 10 })
  };
}

function makeAxios() {
  const agents = makeAgents();
  httpAgent = agents.httpAgent || null;
  httpsAgent = agents.httpsAgent || null;
  return axios.create({
    timeout: REQUEST_TIMEOUT,
    maxRedirects: 5,
    httpAgent,
    httpsAgent,
    decompress: true,
    validateStatus: () => true, // kita nilai sendiri (200 + JSON = success)
    maxContentLength: 5 * 1024 * 1024,
    maxBodyLength: 5 * 1024 * 1024
  });
}

// inisialisasi awal
axiosClient = makeAxios();

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
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Connection": "keep-alive",
    "Referer": `${u.protocol}//${u.host}/`
  };
}

function viaCors(targetUrl) {
  return CORS_PROXY + (USE_ENCODED ? encodeURIComponent(targetUrl) : targetUrl);
}

/* =========================
 * Web Service (agar Render stay-awake)
 * ========================= */
const app = express();
const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  // pastikan ada file public/index.html
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`🌐 Web Service aktif di port ${PORT}`);
  startLoop();
});

/* =========================
 * Utils
 * ========================= */
const sleep  = (ms) => new Promise(r => setTimeout(r, ms));
const jitter = (min=1, max=50) => Math.floor(Math.random()*(max-min+1))+min;

function newCacheBuster() {
  // timestamp + 8 hex random → minimalisir cache agresif di sisi proxy
  const rnd = crypto.randomBytes(4).toString("hex");
  return `${Date.now()}_${rnd}`;
}

// rekreasi axios/agents berkala agar koneksi stale tidak menumpuk
function maybeRefreshClient() {
  _reqCountSinceReset++;
  if (!KEEP_ALIVE) return; // kalau keepalive OFF, tak perlu reset
  if (_reqCountSinceReset >= AGENT_RESET_EVERY) {
    try { httpAgent?.destroy?.(); httpsAgent?.destroy?.(); } catch {}
    axiosClient = makeAxios();
    _reqCountSinceReset = 0;
    console.log(`♻️  Agents/axios direfresh setelah ${AGENT_RESET_EVERY} request`);
  }
}

async function fetchList() {
  try {
    const res = await axiosClient.get(SOURCE_URL, { headers: browserHeaders(SOURCE_URL) });
    const body = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    const urls = String(body)
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

function isJsonResponse(res) {
  try {
    const ct = String(res.headers?.["content-type"] || "").toLowerCase();
    if (ct.includes("application/json")) return true;
    if (res.data !== null && typeof res.data === "object" && !Buffer.isBuffer(res.data)) return true;
    if (typeof res.data === "string") { JSON.parse(res.data); return true; }
  } catch {}
  return false;
}

async function timed(method, url, headers, { forceClose = false } = {}) {
  const t0 = Date.now();
  try {
    const res = await axiosClient.request({
      method,
      url,
      headers: forceClose ? { ...headers, Connection: "close" } : headers,
      // jika forceClose, override agent supaya koneksi baru (tanpa keep-alive)
      httpAgent: forceClose ? undefined : httpAgent,
      httpsAgent: forceClose ? undefined : httpsAgent,
    });
    const ms = Date.now() - t0;
    const status = res.status ?? 0;
    const json = isJsonResponse(res);
    const ok = status === 200 && json;

    if (ok) {
      console.log(`  ✅ ${method} ${status} JSON in ${ms}ms`);
    } else {
      const why = status !== 200
        ? `status=${status}`
        : `non-JSON (content-type="${res.headers?.["content-type"] || "unknown"}")`;
      console.log(`  ⚠️  ${method} not success (${why}) in ${ms}ms`);
    }

    return { ok, status, isJson: json };
  } catch (e) {
    const ms = Date.now() - t0;
    const status = e?.response?.status ?? 0;
    const code = e?.code || "UNKNOWN";
    console.log(`  ❌ ${method} error after ${ms}ms: ${e?.message || e} (code=${code})`);
    return { ok: false, status, isJson: false, code };
  } finally {
    maybeRefreshClient();
  }
}

async function hitOnce(rawUrl, opts = {}) {
  const u = new URL(rawUrl);
  u.searchParams.set("t", newCacheBuster()); // cache-buster lebih unik
  const proxied = viaCors(u.toString());
  const hdrs = browserHeaders(u.toString());
  return timed("GET", proxied, hdrs, opts);
}

async function hitWithRetry(url) {
  console.log(`[${new Date().toLocaleString()}] 🔁 GET (via CORS) ${url}`);

  // coba normal
  let res = await hitOnce(url);

  if (!res.ok) {
    // jika error jaringan umum, coba lagi dengan Connection: close + tanpa agent
    const transient = ["ECONNRESET", "EPIPE", "ETIMEDOUT", "ECONNABORTED"];
    const needHardRetry = transient.includes(res.code) || res.status >= 500 || res.status === 429;

    const backoff = needHardRetry ? 700 + jitter(0, 400) : 300 + jitter(0, 200);
    await sleep(backoff);
    console.log(`  ↻ Retry (${backoff}ms, forceClose=${needHardRetry}) : ${url}`);

    res = await hitOnce(url, { forceClose: needHardRetry });
  }

  if (res.ok) {
    console.log(`  🎯 SUCCESS: 200 + JSON => ${url}`);
  } else {
    console.log(`  🛑 FAILED: ${url} (status=${res.status}, json=${res.isJson}, code=${res.code || "-"})`);
  }

  // mikro-jeda acak agar tidak burst di proxy
  await sleep(jitter());
}

async function processAll(urls) {
  for (const url of urls) {
    await hitWithRetry(url);
    if (PER_URL_DELAY_MS > 0) await sleep(PER_URL_DELAY_MS);
  }
}

async function startLoop() {
  console.log(`🚀 Loop dimulai | SOURCE_URL: ${SOURCE_URL} | CORS_PROXY: ${CORS_PROXY} | encoded=${USE_ENCODED}`);
  console.log(`⏱️ Konfigurasi jeda: PER_URL_DELAY_MS=${PER_URL_DELAY_MS} | LOOP_SLEEP_MS=${LOOP_SLEEP_MS} (~${(LOOP_SLEEP_MS/60000).toFixed(3)} menit)`);
  while (true) {
    if (RECREATE_EACH_LOOP) {
      try { httpAgent?.destroy?.(); httpsAgent?.destroy?.(); } catch {}
      axiosClient = makeAxios();
      _reqCountSinceReset = 0;
      console.log("♻️  Client direcreate di awal loop (RECREATE_EACH_LOOP=1)");
    }

    const list = await fetchList();
    if (list.length) await processAll(list);

    if (LOOP_SLEEP_MS > 0) {
      const mins = (LOOP_SLEEP_MS / 60000).toFixed(3);
      console.log(`🕒 Menunggu ~${mins} menit (${LOOP_SLEEP_MS} ms) sebelum loop berikutnya...\n`);
      await sleep(LOOP_SLEEP_MS);
    } else {
      // tanpa jeda: lanjut segera, tapi yield 1 tick agar event loop tetap responsif
      await new Promise((r) => setImmediate(r));
    }
  }
}
