// server.js — pakai Playwright (Chromium) biar “kayak browser” beneran
import express from "express";
import axios from "axios";
import dns from "dns";
import crypto from "crypto";
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ===== ENV ===== */
const SOURCE_URL  = process.env.SOURCE_URL || "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";
const CORS_PROXY  = (process.env.CORS_PROXY || "https://cors-anywhere-vercel-dzone.vercel.app/").replace(/\/+$/, "");
const REQUEST_TIMEOUT = Number(process.env.REQUEST_TIMEOUT || 30000);
const PORT = process.env.PORT || 10000;

/* ===== Prefer IPv4 ===== */
dns.setDefaultResultOrder?.("ipv4first");

/* ===== Keep-awake web ===== */
const app = express();
app.get("/", (_req, res) => res.type("text/plain").send("OK"));
app.listen(PORT, () => {
  console.log(`🌐 Web service on ${PORT}`);
  startLoop().catch(err => console.error("loop error:", err));
});

/* ===== Helpers ===== */
function toSingleSlashScheme(u) {
  return String(u).replace(/^https?:\/\//i, m => m.replace(/\/+$/, "/")); // https:// -> https:/
}
function makeProxiedUrl(proxyBase, target) {
  return `${proxyBase.replace(/\/+$/, "")}/${toSingleSlashScheme(target)}`;
}
function randHex(n) { return crypto.randomBytes(n).toString("hex"); }
function randUA() {
  const uas = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
  ];
  return uas[Math.floor(Math.random() * uas.length)];
}
function makeRandomCookiesFor(host) {
  // beberapa cookie umum, acak subset
  const all = [
    { name: "_ga", value: `GA1.2.${Math.floor(1e9+Math.random()*9e9)}.${Date.now()}` },
    { name: "_gid", value: `GA1.2.${Math.floor(1e9+Math.random()*9e9)}.${Math.floor(Date.now()/1000)}` },
    { name: "sessionid", value: randHex(16) },
    { name: "csrftoken", value: randHex(16) },
    { name: "__Host-sid", value: randHex(18) }
  ].filter(() => Math.random() > 0.35);
  return all.map(c => ({
    ...c,
    domain: new URL(host).hostname,
    path: "/",
    httpOnly: false,
    secure: true,
    sameSite: "Lax"
  }));
}
function isJson(ct, bodyText) {
  if ((ct || "").toLowerCase().includes("application/json")) return true;
  try { JSON.parse(bodyText); return true; } catch { return false; }
}

/* ===== Fetch list (pakai axios biasa saja) ===== */
async function fetchList() {
  try {
    const r = await axios.get(SOURCE_URL, {
      timeout: REQUEST_TIMEOUT,
      headers: { "User-Agent": randUA(), "Accept": "text/plain,*/*" }
    });
    const txt = typeof r.data === "string" ? r.data : String(r.data);
    const urls = txt.split(/\r?\n/).map(s => s.trim()).filter(s => s && s.startsWith("http"));
    console.log(`✅ Ditemukan ${urls.length} URL`);
    return urls;
  } catch (e) {
    console.log("❌ Gagal ambil daftar:", e?.message || e);
    return [];
  }
}

/* ===== Browser init (sekali, hemat resource) ===== */
let browser;
async function initBrowser() {
  if (browser) return browser;
  browser = await chromium.launch({
    headless: true,
    // arg penting di host seperti Render
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-http2"]
  });
  return browser;
}

/* ===== GET via “browser beneran” ===== */
async function getViaBrowser(urlTarget) {
  const proxied = makeProxiedUrl(CORS_PROXY, urlTarget);

  // bikin context baru tiap URL → cookies/UA segar (fingerprint beda-beda)
  const ctx = await browser.newContext({
    userAgent: randUA(),
    extraHTTPHeaders: {
      "Origin": CORS_PROXY.replace(/\/+$/, ""),
      "Referer": CORS_PROXY.replace(/\/+$/, "") + "/",
      "Accept": "application/json,text/plain,*/*",
      "Accept-Language": "en-US,en;q=0.9"
    },
    ignoreHTTPSErrors: true,
    // paksa HTTP/1.1 via flag --disable-http2 di launch
  });
  const page = await ctx.newPage();

  // cookie acak untuk host proxy (bukan target)
  await ctx.addCookies(makeRandomCookiesFor(CORS_PROXY));

  console.log(`[${new Date().toLocaleString()}] 🔁 GET ${proxied}`);

  let resp = null;
  try {
    resp = await page.goto(proxied, { waitUntil: "domcontentloaded", timeout: REQUEST_TIMEOUT });
  } catch (e) {
    await ctx.close();
    return { ok: false, status: 0, reason: e?.message || "goto error" };
  }

  const status = resp?.status() ?? 0;
  let ctype = "";
  try { ctype = resp?.headers()?.["content-type"] || ""; } catch {}
  const body = await resp.text();
  const ok = status === 200 && isJson(ctype, body);

  await ctx.close();
  return { ok, status, ctype, body };
}

/* ===== Proses sequential tanpa delay ===== */
async function processSequential(urls) {
  for (const u of urls) {
    const r = await getViaBrowser(u);
    if (r.ok) {
      console.log("  ✅ GET 200 JSON");
      console.log(`  🎯 SUCCESS => ${u}`);
    } else {
      const why = r.status !== 200 ? `status=${r.status}` : `non-JSON (ct=${r.ctype || "unknown"})`;
      console.log(`  ⏭️  SKIP (${why}) => ${u}`);
      // // debug body:
      // if (!r.ok) console.log("   body_snippet:", String(r.body || "").slice(0, 160));
    }
  }
}

/* ===== Main loop ===== */
async function startLoop() {
  await initBrowser();
  while (true) {
    const list = await fetchList();
    if (list.length) await processSequential(list);
    // tanpa delay: ulangi segera (beri satu tick agar event loop bernafas)
    await new Promise(r => setImmediate(r));
  }
}
