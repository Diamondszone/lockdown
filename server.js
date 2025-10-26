// server.js — sequential + super cepat pakai curl
import express from "express";
import axios from "axios";
import dns from "dns";
import crypto from "crypto";
import { execFile } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ===== ENV ===== */
const SOURCE_URL  = process.env.SOURCE_URL || "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";
const CORS_PROXY  = (process.env.CORS_PROXY || "https://cors-anywhere-vercel-dzone.vercel.app/").replace(/\/+$/, "");
const REQUEST_TIMEOUT = Number(process.env.REQUEST_TIMEOUT || 30000); // ms
const PORT = process.env.PORT || 10000;

/* ===== Prefer IPv4 ===== */
dns.setDefaultResultOrder?.("ipv4first");

/* ===== Keep-awake web ===== */
const app = express();
app.get("/", (_req, res) => {
  res.type("text/plain").send("OK");
});
app.listen(PORT, () => {
  console.log(`🌐 Web service on ${PORT}`);
  startLoop();
});

/* ===== Helpers ===== */
function toSingleSlashScheme(urlStr) {
  // "https://" -> "https:/", "http://" -> "http:/"
  return String(urlStr).replace(/^https?:\/\//i, (m) => m.replace(/\/+$/, "/"));
}
// hasil: "<proxy>/<https:/domain/...>"
function makeProxiedUrl(proxyBase, targetUrl) {
  const clean = String(proxyBase).replace(/\/+$/, "");
  return `${clean}/${toSingleSlashScheme(targetUrl)}`;
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
];
const randUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

function randHex(n) { return crypto.randomBytes(n).toString("hex"); }
function randBase36(len=16) { return [...Array(len)].map(()=>Math.floor(Math.random()*36).toString(36)).join(""); }

function makeRandomCookie() {
  const parts = [
    `_ga=GA1.2.${Math.floor(1e9+Math.random()*9e9)}.${Date.now()}`,
    `_gid=GA1.2.${Math.floor(1e9+Math.random()*9e9)}.${Math.floor(Date.now()/1000)}`,
    `sessionid=${randHex(16)}`,
    `csrftoken=${randHex(16)}`,
    `__Host-sid=${randHex(18)}`,
    `_utmz=${randBase36(24)}`,
    `_fbp=fb.${Date.now()}.${Math.floor(1e9+Math.random()*1e9)}`
  ];
  return parts.filter(()=>Math.random()>0.35).join("; ");
}

/**
 * Jalankan curl dan ambil:
 * - body (stdout tanpa footer),
 * - http_code & content_type dari --write-out footer.
 */
function curlGet(proxiedUrl, { timeoutMs, proxyBase }) {
  return new Promise((resolve) => {
    // --write-out menambah footer khusus di akhir stdout supaya gampang diparse
    const FOOT = `CURL_FOOTER_${randHex(6)}`;
    const writeOut = `\\n${FOOT}:code=%{http_code};type=%{content_type}\\n`;

    const args = [
      "-sS",                 // silent tapi error tetap muncul
      "-L",                  // follow redirects
      "--compressed",        // terima gzip/deflate/br
      "--max-redirs", "5",
      "--connect-timeout", String(Math.ceil(timeoutMs/1000)),
      "-m", String(Math.ceil(timeoutMs/1000)), // total timeout
      "-A", randUA(),
      "-H", `Origin: ${proxyBase}`,
      "-H", `Referer: ${proxyBase}/`,
      "-H", `Accept: application/json,text/plain,*/*`,
      "-H", `Accept-Language: en-US,en;q=0.9`,
      "-H", `Connection: close`,
      "-H", `Cookie: ${makeRandomCookie()}`,
      "-w", writeOut,
      proxiedUrl
    ];

    const child = execFile("curl", args, { timeout: timeoutMs }, (error, stdout /*, stderr */) => {
      // stdout = <body> + "\nFOOT:code=XXX;type=YYY\n"
      if (error && !stdout) {
        return resolve({ ok: false, status: 0, ctype: "", body: "", err: String(error) });
      }
      const marker = `\n${FOOT}:code=`;
      const idx = stdout.lastIndexOf(marker);
      if (idx === -1) {
        return resolve({ ok: false, status: 0, ctype: "", body: stdout, err: "no footer" });
      }
      const body = stdout.slice(0, idx); // body asli
      const tail = stdout.slice(idx + 1); // mulai dari FOOT...
      // tail format: "FOOT:code=200;type=application/json; charset=utf-8\n"
      let status = 0, ctype = "";
      try {
        const after = tail.split(`${FOOT}:code=`)[1] || "";
        const parts = after.trim().split(";").map(s=>s.trim());
        // parts[0] ex: "200"
        status = parseInt(parts[0].replace(/[^0-9]/g,""), 10) || 0;
        const typePair = parts.find(p=>p.startsWith("type="));
        if (typePair) ctype = typePair.replace(/^type=/,"").trim();
      } catch {}
      // cek JSON
      let isJson = false;
      if (/application\/json/i.test(ctype)) {
        isJson = true;
      } else {
        try { JSON.parse(body); isJson = true; } catch {}
      }
      const ok = status === 200 && isJson;
      resolve({ ok, status, ctype, body });
    });

    // hard kill jika hang (fallback)
    child.on("error", (e) => resolve({ ok:false, status:0, ctype:"", body:"", err:String(e) }));
  });
}

async function fetchList() {
  try {
    // ambil daftar pakai axios biasa (langsung ke SOURCE_URL)
    const r = await axios.get(SOURCE_URL, {
      timeout: REQUEST_TIMEOUT,
      headers: { "User-Agent": randUA(), "Accept": "text/plain,*/*" }
    });
    const txt = typeof r.data === "string" ? r.data : String(r.data);
    const urls = txt.split(/\r?\n/).map(s=>s.trim()).filter(s=>s && s.startsWith("http"));
    console.log(`✅ Ditemukan ${urls.length} URL`);
    return urls;
  } catch (e) {
    console.log("❌ Gagal ambil daftar:", e?.message || e);
    return [];
  }
}

async function hitOnceAndDecide(url) {
  const proxied = makeProxiedUrl(CORS_PROXY, url);
  console.log(`[${new Date().toLocaleString()}] 🔁 GET ${proxied}`);

  const { ok, status, ctype, body } = await curlGet(proxied, {
    timeoutMs: REQUEST_TIMEOUT,
    proxyBase: CORS_PROXY
  });

  if (ok) {
    console.log(`  ✅ GET 200 JSON`);
    console.log(`  🎯 SUCCESS => ${url}`);
  } else {
    const why = status !== 200 ? `status=${status}` : `non-JSON (ct=${ctype || "unknown"})`;
    console.log(`  ⏭️  SKIP (${why}) => ${url}`);
    // kalau perlu debug, uncomment:
    // if (!/application\/json/i.test(ctype)) console.log("BODY_SNIPPET:", String(body).slice(0,120));
  }
}

async function processSequential(urls) {
  for (const url of urls) {
    await hitOnceAndDecide(url); // 1 tembakan; non-JSON/≠200 langsung SKIP
  }
}

async function startLoop() {
  while (true) {
    const list = await fetchList();
    if (list.length) await processSequential(list);
    // tanpa delay: langsung lanjut loop; beri 1 tick supaya event loop bernapas
    await new Promise(r => setImmediate(r));
  }
}
