// server.js
import express from "express";
import axios from "axios";
import http from "http";
import https from "https";

/* =========================
 * ENV & Konfigurasi
 * ========================= */
const SOURCE_URL =
  process.env.SOURCE_URL ||
  "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";

const CORS_PROXY =
  process.env.CORS_PROXY ||
  "https://cors-anywhere-vercel-dzone.vercel.app/";

// Timeout request per URL (ms)
const REQUEST_TIMEOUT = Number(process.env.REQUEST_TIMEOUT || 60000);

// Tanpa delay setelah semua URL? set 0 (default 0)
const LOOP_DELAY_MINUTES = Number(process.env.LOOP_DELAY_MINUTES || 0);

// Jeda antar batch (ms). Untuk full-parallel biasanya 0
const PER_URL_DELAY_MS = Number(process.env.PER_URL_DELAY_MS || 0);

// Paralel:
//   - CONCURRENCY <= 0  --> full parallel (semua URL sekaligus)
//   - CONCURRENCY = n   --> n permintaan sekaligus (batched)
const CONCURRENCY = Number(process.env.CONCURRENCY || 0);

/* =========================
 * Axios client (keep-alive)
 * ========================= */
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 200 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 200 });

const client = axios.create({
  timeout: REQUEST_TIMEOUT,
  maxRedirects: 3,
  httpAgent,
  httpsAgent,
  validateStatus: () => true, // biar kita yang nilai success/fail sendiri
});

/* =========================
 * Helpers
 * ========================= */

// Ubah "https://domain/path" -> "https:/domain/path" (satu slash)
// Ubah "http://domain/path"  -> "http:/domain/path"
function toSingleSlashScheme(url) {
  return url.replace(/^https?:\/\//i, (m) => m.slice(0, -1));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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
  } catch (_) {}
  return false;
}

function shortBody(body) {
  const s = typeof body === "string" ? body : JSON.stringify(body);
  return s.length > 200 ? s.slice(0, 200) + " …" : s;
}

/* =========================
 * Core
 * ========================= */
async function fetchList() {
  console.log(`📥 Mengambil daftar URL dari: ${SOURCE_URL}`);
  const resp = await client.get(SOURCE_URL, { responseType: "text" });
  if (resp.status !== 200) {
    throw new Error(`Gagal ambil node.txt | HTTP ${resp.status}`);
  }
  const list = parseList(resp.data);
  console.log(`📄 Dapat ${list.length} URL dari node.txt`);
  return list;
}

async function hitOne(targetUrl) {
  const singleSlash = toSingleSlashScheme(targetUrl);
  const proxied = `${CORS_PROXY}${singleSlash}`;

  const t0 = Date.now();
  let resp;
  try {
    resp = await client.get(proxied, {
      responseType: "text",
      headers: {
        "Accept": "*/*",
        "User-Agent": "Railway-Node-Runner/1.0",
      },
    });
  } catch (err) {
    console.log(`❌ ${targetUrl} | ERROR request: ${err.message}`);
    return { ok: false, status: 0 };
  }

  const ms = Date.now() - t0;
  const bodyText =
    typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);

  if (isJsonResponse(resp, bodyText)) {
    console.log(`✅ JSON | ${targetUrl} | HTTP ${resp.status} | ${ms} ms`);
    return { ok: true, status: resp.status };
  } else {
    console.log(
      `⚠️ BUKAN JSON | ${targetUrl} | HTTP ${resp.status} | ${ms} ms | body: ${shortBody(bodyText)}`
    );
    return { ok: false, status: resp.status };
  }
}

// Full parallel (CONCURRENCY <= 0) atau batched (CONCURRENCY > 0)
async function runParallel(urls) {
  if (urls.length === 0) return;

  if (CONCURRENCY <= 0) {
    // Semua sekaligus
    await Promise.all(urls.map((u) => hitOne(u)));
    if (PER_URL_DELAY_MS > 0) await sleep(PER_URL_DELAY_MS);
    return;
  }

  // Batched
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const chunk = urls.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map((u) => hitOne(u)));
    if (PER_URL_DELAY_MS > 0) await sleep(PER_URL_DELAY_MS);
  }
}

async function mainLoop() {
  console.log(
    `🚀 Loop mulai | SOURCE_URL=${SOURCE_URL} | CORS_PROXY=${CORS_PROXY} | CONCURRENCY=${CONCURRENCY} | encoded=single-slash`
  );
  while (true) {
    try {
      const list = await fetchList();
      await runParallel(list);
    } catch (e) {
      console.log(`❌ Gagal proses loop: ${e.message}`);
    }

    const waitMs = Math.max(0, LOOP_DELAY_MINUTES * 60 * 1000);
    if (waitMs > 0) {
      console.log(`🕒 Menunggu ${LOOP_DELAY_MINUTES} menit sebelum refresh berikutnya...\n`);
      await sleep(waitMs);
    } else {
      // Tanpa delay; opsional micro-sleep agar event loop tetep lega
      // await sleep(25);
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
      "✅ Railway URL Runner via CORS-anywhere aktif.",
      `SOURCE_URL=${SOURCE_URL}`,
      `CORS_PROXY=${CORS_PROXY}`,
      `REQUEST_TIMEOUT=${REQUEST_TIMEOUT}`,
      `LOOP_DELAY_MINUTES=${LOOP_DELAY_MINUTES}`,
      `PER_URL_DELAY_MS=${PER_URL_DELAY_MS}`,
      `CONCURRENCY=${CONCURRENCY} (${CONCURRENCY <= 0 ? "full-parallel" : "batched"})`,
      "",
      "Sukses didefinisikan jika respons target berupa JSON (header application/json atau isi bisa di-parse JSON).",
      "Format request: <CORS_PROXY> + <https:/single-slash-url>",
    ].join("\n")
  );
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Web service aktif di port ${PORT}`);
});

// Mulai loop
mainLoop().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
