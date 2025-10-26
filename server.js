// server.js (simple & direct)
import express from "express";
import axios from "axios";
import http from "http";
import https from "https";
import dns from "dns";
import { URL } from "url";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ============== ENV ============== */
const SOURCE_URL = process.env.SOURCE_URL || "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";
const CORS_PROXY = (process.env.CORS_PROXY || "https://cors-anywhere-vercel-dzone.vercel.app/").replace(/\/+$/, "");
const REQUEST_TIMEOUT = Number(process.env.REQUEST_TIMEOUT || 30000);

/* ============== Basic net prefs ============== */
dns.setDefaultResultOrder?.("ipv4first");
const httpAgent  = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

/* ============== App keep-awake ============== */
const app = express();
const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html")); // siapkan file ini jika mau tampilan
});

app.listen(PORT, () => {
  console.log(`🌐 Web service on ${PORT}`);
  startLoop();
});

/* ============== Helpers ============== */
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

function browserHeaders(targetUrl) {
  const u = new URL(targetUrl);
  return {
    "Origin": `${u.protocol}//${u.host}`,
    "Referer": `${u.protocol}//${u.host}/`,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    "Accept": "application/json,text/plain,*/*",
    "X-Requested-With": "XMLHttpRequest",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Connection": "keep-alive"
  };
}

const axiosClient = axios.create({
  timeout: REQUEST_TIMEOUT,
  httpAgent,
  httpsAgent,
  decompress: true,
  // biar kita yang menilai sukses/gagal
  validateStatus: () => true,
});

/* ============== Core logic ============== */
function isJsonResponse(res) {
  try {
    const ct = String(res.headers?.["content-type"] || "").toLowerCase();
    if (ct.includes("application/json")) return true;
    if (res.data && typeof res.data === "object") return true;
    if (typeof res.data === "string") { JSON.parse(res.data); return true; }
  } catch { /* ignore */ }
  return false;
}

async function fetchList() {
  try {
    const r = await axiosClient.get(SOURCE_URL, { headers: browserHeaders(SOURCE_URL) });
    const body = typeof r.data === "string" ? r.data : JSON.stringify(r.data);
    const urls = body.split(/\r?\n/).map(s => s.trim()).filter(s => s && s.startsWith("http"));
    console.log(`✅ Ditemukan ${urls.length} URL`);
    return urls;
  } catch (e) {
    console.log("❌ Gagal ambil daftar:", e?.message || e);
    return [];
  }
}

async function hitUrlOnce(rawUrl) {
  // header pakai bentuk normal (https://), tapi path ke proxy pakai https:/
  const proxied = makeProxiedUrl(CORS_PROXY, rawUrl);
  const headers = browserHeaders(rawUrl);

  const t0 = Date.now();
  const res = await axiosClient.get(proxied, { headers });
  const ms = Date.now() - t0;

  const ok = (res.status === 200) && isJsonResponse(res);
  if (ok) {
    console.log(`  ✅ GET 200 JSON in ${ms}ms`);
  } else {
    const why = res.status !== 200
      ? `status=${res.status}`
      : `non-JSON (ct=${res.headers?.["content-type"] || "unknown"})`;
    console.log(`  ⚠️  not success (${why}) in ${ms}ms`);
  }
  return ok;
}

async function processAll(urls) {
  for (const url of urls) {
    console.log(`[${new Date().toLocaleString()}] 🔁 GET ${makeProxiedUrl(CORS_PROXY, url)}`);
    const ok = await hitUrlOnce(url);
    if (ok) {
      console.log(`  🎯 SUCCESS => ${url}`);
    } else {
      console.log(`  🛑 FAILED  => ${url}`);
    }
  }
}

async function startLoop() {
  while (true) {
    const list = await fetchList();
    if (list.length) await processAll(list);
    // tanpa jeda: lanjut langsung, beri 1 tick agar event loop bernafas
    await new Promise(r => setImmediate(r));
  }
}
