// server.js — sequential, no-delay, random Cookie per request, success only if 200+JSON
import express from "express";
import axios from "axios";
import dns from "dns";
import crypto from "crypto";
import { URL } from "url";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ===== ENV ===== */
const SOURCE_URL = process.env.SOURCE_URL || "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";
const CORS_PROXY = (process.env.CORS_PROXY || "https://cors-anywhere-vercel-dzone.vercel.app/").replace(/\/+$/, "");
const REQUEST_TIMEOUT = Number(process.env.REQUEST_TIMEOUT || 30000);
const PORT = process.env.PORT || 10000;
const ENABLE_RANDOM_COOKIE = process.env.ENABLE_RANDOM_COOKIE !== "0"; // default ON

/* ===== Net prefs ===== */
dns.setDefaultResultOrder?.("ipv4first");

/* ===== Web keep-awake (opsional) ===== */
const app = express();
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html")); // opsional
});
app.listen(PORT, () => {
  console.log(`🌐 Web service on ${PORT}`);
  startLoop();
});

/* ===== Helpers ===== */
// ubah "https://" => "https:/" dan "http://" => "http:/"
function toSingleSlashScheme(urlStr) {
  return String(urlStr).replace(/^https?:\/\//i, (m) => m.replace(/\/+$/, "/"));
}

// hasil akhir: "<proxy>/<https:/domain/...>"
function makeProxiedUrl(baseProxy, targetUrl) {
  const cleanBase = String(baseProxy).replace(/\/+$/, "");
  const normTarget = toSingleSlashScheme(targetUrl);
  return `${cleanBase}/${normTarget}`;
}

function randHex(nBytes) {
  return crypto.randomBytes(nBytes).toString("hex");
}
function randBase36(len = 12) {
  return [...Array(len)].map(() => Math.floor(Math.random() * 36).toString(36)).join("");
}
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Cookie random “terlihat realistis” (kombinasi beberapa nama umum)
function makeRandomCookie() {
  // contoh pola: _ga, _gid, csrftoken/sessionid, __Host-sid
  const ga = `_ga=GA1.2.${randInt(100000000, 999999999)}.${Date.now()}`;
  const gid = `_gid=GA1.2.${randInt(100000000, 999999999)}.${Math.floor(Date.now() / 1000)}`;
  const sid = `sessionid=${randHex(16)}`;
  const csrft = `csrftoken=${randHex(16)}`;
  const hostSid = `__Host-sid=${randHex(18)}`;
  const misc = `_utmz=${randBase36(24)}; _fbp=fb.${Date.now()}.${randInt(1000000000, 1999999999)}`;
  // acak subset supaya tidak statis
  const parts = [ga, gid, sid, csrft, hostSid, misc];
  const pick = parts.filter(() => Math.random() > 0.3);
  return pick.join("; ");
}

// beberapa User-Agent populer
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
];
function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Header mirip browser, Origin/Referer ke PROXY base (bukan target)
function proxyLikeHeaders(baseProxy) {
  const origin = String(baseProxy).replace(/\/+$/, "");
  const ua = randomUA();
  const h = {
    "Origin": origin,
    "Referer": origin + "/",
    "User-Agent": ua,
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate", // hindari br untuk mengurangi masalah decoding
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Connection": "close",
    // header “fetch” modern
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "DNT": "1",
    "Upgrade-Insecure-Requests": "1",
    // opsi X-Requested-With bisa membantu pada beberapa proxy,
    // tapi kadang memicu blok; kita tidak set di sini.
  };
  if (ENABLE_RANDOM_COOKIE) {
    h["Cookie"] = makeRandomCookie();
  }
  return h;
}

const http = axios.create({
  timeout: REQUEST_TIMEOUT,
  validateStatus: () => true, // kita yang menentukan sukses/gagal
  decompress: true,
  responseType: "text" // biar kita bisa parse sendiri
});

function isJsonResponse(res) {
  try {
    const ct = String(res.headers?.["content-type"] || "").toLowerCase();
    if (ct.includes("application/json")) return true;
    if (res.data && typeof res.data === "object") return true;
    if (typeof res.data === "string") { JSON.parse(res.data); return true; }
  } catch { /* bukan JSON valid */ }
  return false;
}

async function fetchList() {
  try {
    const r = await http.get(SOURCE_URL, { headers: proxyLikeHeaders(CORS_PROXY) });
    const body = typeof r.data === "string" ? r.data : JSON.stringify(r.data);
    const urls = body.split(/\r?\n/).map(s => s.trim()).filter(s => s && s.startsWith("http"));
    console.log(`✅ Ditemukan ${urls.length} URL`);
    return urls;
  } catch (e) {
    console.log("❌ Gagal ambil daftar:", e?.message || e);
    return [];
  }
}

// Satu kali tembak, putuskan cepat: jika 200+JSON => SUCCESS; selain itu SKIP
async function hitOnceAndDecide(url) {
  const proxied = makeProxiedUrl(CORS_PROXY, url);
  console.log(`[${new Date().toLocaleString()}] 🔁 GET ${proxied}`);

  const headers = proxyLikeHeaders(CORS_PROXY); // random UA + random Cookie tiap request
  const t0 = Date.now();
  const res = await http.get(proxied, { headers });
  const ms = Date.now() - t0;

  if (res.status === 200 && isJsonResponse(res)) {
    console.log(`  ✅ GET 200 JSON in ${ms}ms`);
    console.log(`  🎯 SUCCESS => ${url}`);
  } else {
    const why = res.status !== 200
      ? `status=${res.status}`
      : `non-JSON (ct=${res.headers?.["content-type"] || "unknown"})`;
    console.log(`  ⏭️  SKIP (${why}) in ${ms}ms => ${url}`);
  }
}

async function processSequential(urls) {
  for (const url of urls) {
    await hitOnceAndDecide(url); // 1 request per URL, non-JSON langsung SKIP
  }
}

async function startLoop() {
  while (true) {
    const list = await fetchList();
    if (list.length) await processSequential(list);
    // tanpa delay: langsung ulangi; beri 1 tick agar event loop bernapas
    await new Promise(r => setImmediate(r));
  }
}
