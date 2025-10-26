// server.js — simple, no-delay, proxy-path "https:/"
import express from "express";
import axios from "axios";
import dns from "dns";
import { URL } from "url";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ============== ENV ============== */
const SOURCE_URL   = process.env.SOURCE_URL || "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";
const CORS_PROXY   = (process.env.CORS_PROXY || "https://cors-anywhere-vercel-dzone.vercel.app/").replace(/\/+$/, "");
const REQUEST_TIMEOUT = Number(process.env.REQUEST_TIMEOUT || 30000);
const PORT = process.env.PORT || 10000;

/* ============== Net prefs ============== */
dns.setDefaultResultOrder?.("ipv4first");

/* ============== Web (keep-awake) ============== */
const app = express();
app.get("/", (req, res) => {
  // opsional: sediakan public/index.html agar ada tampilan
  res.sendFile(path.join(__dirname, "public", "index.html"));
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

// header yang disukai CORS-Anywhere: Origin/Referer = base proxy
function proxyHeaders(baseProxy) {
  const origin = String(baseProxy).replace(/\/+$/, "");
  return {
    "Origin": origin,
    "Referer": origin + "/",
    "X-Requested-With": "fetch",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    "Accept": "application/json,text/plain,*/*",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Connection": "close" // paksa koneksi baru supaya tidak ke-flag
  };
}

const axiosClient = axios.create({
  timeout: REQUEST_TIMEOUT,
  // biar kita yang menilai sukses/gagal
  validateStatus: () => true,
  decompress: true
});

function isJsonResponse(res) {
  try {
    const ct = String(res.headers?.["content-type"] || "").toLowerCase();
    if (ct.includes("application/json")) return true;
    if (res.data && typeof res.data === "object") return true;
    if (typeof res.data === "string") { JSON.parse(res.data); return true; }
  } catch {/* ignore */}
  return false;
}

async function fetchList() {
  try {
    const r = await axiosClient.get(SOURCE_URL, { headers: proxyHeaders(CORS_PROXY) });
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
  // path ke proxy pakai "https:/"; header pakai base proxy
  const proxied = makeProxiedUrl(CORS_PROXY, rawUrl);
  const headers = proxyHeaders(CORS_PROXY);

  console.log(`[${new Date().toLocaleString()}] 🔁 GET ${proxied}`);

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
    // tanpa jeda: lanjut terus, beri 1 tick agar event loop bernapas
    await new Promise(r => setImmediate(r));
  }
}
