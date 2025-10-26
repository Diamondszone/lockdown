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

// Single proxy fallback
const _CORS_PROXY       = (process.env.CORS_PROXY || "https://cors-anywhere-vercel-dzone.vercel.app/").replace(/\/+$/, "");

// Multi-proxy (baru)
const CORS_PROXIES      = (process.env.CORS_PROXIES || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean)
  .map(s => s.replace(/\/+$/, ""));
if (CORS_PROXIES.length === 0) CORS_PROXIES.push(_CORS_PROXY);

const PROXY_FAIL_COOLDOWN_MS = Number(process.env.PROXY_FAIL_COOLDOWN_MS || 60_000);

// Loop delay (prioritas: MS > SEC > MIN). Default: 0 ms
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
dns.setDefaultResultOrder?.("ipv4first");

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
    validateStatus: () => true, // nilai sendiri (200 + JSON = success)
    maxContentLength: 5 * 1024 * 1024,
    maxBodyLength: 5 * 1024 * 1024,
    transformResponse: [(data) => data] // biar bisa ambil snippet raw body
  });
}

// init awal
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
    "Origin": `${u.protocol}//${u.host}`,
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

/* =========================
 * Proxy rotation helpers
 * ========================= */
const proxyCooldownUntil = new Map(); // proxyBase -> timestamp ms
let proxyIndex = 0;

function isProxyOnCooldown(base) {
  const until = proxyCooldownUntil.get(base) || 0;
  return Date.now() < until;
}
function cooldownProxy(base) {
  proxyCooldownUntil.set(base, Date.now() + PROXY_FAIL_COOLDOWN_MS);
  console.log(`🚫 Proxy cooldown ${base} for ${PROXY_FAIL_COOLDOWN_MS} ms`);
}
function nextHealthyProxy() {
  const n = CORS_PROXIES.length;
  for (let i = 0; i < n; i++) {
    const idx = (proxyIndex + i) % n;
    const base = CORS_PROXIES[idx];
    if (!isProxyOnCooldown(base)) {
      proxyIndex = idx; // point ke sini
      return base;
    }
  }
  // semua cooldown → pilih yang cooldown-nya paling cepat berakhir
  let soonestBase = CORS_PROXIES[0], soonest = proxyCooldownUntil.get(soonestBase) || 0;
  for (const b of CORS_PROXIES) {
    const t = proxyCooldownUntil.get(b) || 0;
    if (t < soonest) { soonest = t; soonestBase = b; }
  }
  return soonestBase;
}

/* =========================
 * Format proxy khusus: ".../<https:/domain/...>"
 * ========================= */
// Ubah "https://" -> "https:/" dan "http://" -> "http:/"
function normalizeForSingleSlashScheme(targetUrl) {
  return String(targetUrl).replace(/^https?:\/\//i, (m) => m.replace(/\/+$/, "/"));
}
// Selalu hasilkan: <proxy_base>/<https:/domain/...>
function viaCorsWith(base, targetUrl) {
  const cleanBase = String(base).replace(/\/+$/, ""); // buang trailing slash pada base
  const normTarget = normalizeForSingleSlashScheme(targetUrl); // jadikan https:/...
  return `${cleanBase}/${normTarget}`;
}

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
const sleep  = (ms) => new Promise(r => setTimeout(r, ms));
const jitter = (min=1, max=50) => Math.floor(Math.random()*(max-min+1))+min;

function newCacheBuster() {
  const rnd = crypto.randomBytes(4).toString("hex");
  return `${Date.now()}_${rnd}`;
}

function maybeRefreshClient() {
  _reqCountSinceReset++;
  if (!KEEP_ALIVE) return;
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
      httpAgent: forceClose ? undefined : httpAgent,
      httpsAgent: forceClose ? undefined : httpsAgent,
      validateStatus: () => true
    });
    const ms = Date.now() - t0;
    const status = res.status ?? 0;

    let bodySnippet = "";
    try { if (typeof res.data === "string") bodySnippet = res.data.slice(0, 200); } catch {}

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

    return { ok, status, isJson: json, ms, bodySnippet, res };
  } catch (e) {
    const ms = Date.now() - t0;
    const status = e?.response?.status ?? 0;
    const code = e?.code || "UNKNOWN";
    console.log(`  ❌ ${method} error after ${ms}ms: ${e?.message || e} (code=${code})`);
    return { ok: false, status, isJson: false, code, ms, res: e?.response };
  } finally {
    maybeRefreshClient();
  }
}

async function hitOnce(rawUrl, baseProxy, opts = {}) {
  const u = new URL(rawUrl);
  u.searchParams.set("t", newCacheBuster());
  const original = u.toString();                    // headers pakai bentuk normal
  const proxied  = viaCorsWith(baseProxy, original); // path proxy pakai "https:/"

  const hdrs = browserHeaders(original);
  return timed("GET", proxied, hdrs, opts);
}

function looksLikeProxy403(res, elapsedMs, bodySnippet) {
  const status = res?.status;
  if (status !== 403) return false;
  if (elapsedMs < 50) return true; // super cepat → kemungkinan ditolak di edge/proxy

  const h = Object.fromEntries(
    Object.entries(res?.headers || {}).map(([k, v]) => [String(k).toLowerCase(), v])
  );
  const via = String(h["via"] || "");
  const server = String(h["server"] || "");
  const xpower = String(h["x-powered-by"] || "");
  if (/vercel|cloudflare|fly|heroku|nginx/i.test(via + " " + server + " " + xpower)) return true;

  const b = (bodySnippet || "").toLowerCase();
  if (b.includes("cors") || b.includes("forbidden") || b.includes("missing required request header")) return true;

  return false;
}

async function hitWithRetry(url) {
  console.log(`[${new Date().toLocaleString()}] 🔁 GET (via CORS) ${url}`);

  // daftar proxy yang akan dicoba (mulai dari current healthy, lalu sisanya)
  const startBase = nextHealthyProxy();
  const bases = [];
  const n = CORS_PROXIES.length;
  const startIdx = CORS_PROXIES.indexOf(startBase);
  for (let i = 0; i < n; i++) {
    const idx = (startIdx + i) % n;
    bases.push(CORS_PROXIES[idx]);
  }

  let lastRes = null;

  for (let i = 0; i < bases.length; i++) {
    const base = bases[i];
    if (isProxyOnCooldown(base)) continue;

    // 1) coba normal
    let r = await hitOnce(url, base);
    lastRes = r;

    const proxyLike403 = r && looksLikeProxy403(r.res, r.ms, r.bodySnippet);

    if (r.ok) {
      proxyIndex = CORS_PROXIES.indexOf(base);
      console.log(`  🎯 SUCCESS: 200 + JSON via ${base} => ${url}`);
      await sleep(jitter());
      return;
    }

    // 2) retry pakai Connection: close (masih proxy yang sama)
    const needHardRetry = proxyLike403 || r.status >= 500 || r.status === 429 || ["ECONNRESET","EPIPE","ETIMEDOUT","ECONNABORTED"].includes(r.code);
    const backoff = needHardRetry ? 600 + jitter(0, 300) : 300 + jitter(0, 200);
    console.log(`  ↻ Retry (${backoff}ms) on ${base} (forceClose=${needHardRetry}) : ${url}`);
    await sleep(backoff);
    r = await hitOnce(url, base, { forceClose: needHardRetry });
    lastRes = r;

    if (r.ok) {
      proxyIndex = CORS_PROXIES.indexOf(base);
      console.log(`  🎯 SUCCESS (retry): 200 + JSON via ${base} => ${url}`);
      await sleep(jitter());
      return;
    }

    // 3) kalau kelihatan 403 dari proxy, cooldown proxy ini dan coba berikutnya
    if (proxyLike403 || r.status === 403) {
      cooldownProxy(base);
    }

    // lanjut ke proxy lain
  }

  // semua proxy gagal
  const st = lastRes?.status ?? "-";
  const js = lastRes?.isJson ?? false;
  const code = lastRes?.code || "-";
  console.log(`  🛑 FAILED (all proxies): ${url} (status=${st}, json=${js}, code=${code})`);
  await sleep(jitter());
}

async function processAll(urls) {
  for (const url of urls) {
    await hitWithRetry(url);
    if (PER_URL_DELAY_MS > 0) await sleep(PER_URL_DELAY_MS);
  }
}

async function startLoop() {
  console.log(`🚀 Loop dimulai | SOURCE_URL: ${SOURCE_URL}`);
  console.log(`🛰️  Proxies: ${CORS_PROXIES.join(", ")}`);
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
      await new Promise((r) => setImmediate(r));
    }
  }
}
