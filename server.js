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

const USE_PROXY = Number(process.env.USE_PROXY || 0); // 0=langsung, 1=pakai proxy
const CORS_PROXY =
  process.env.CORS_PROXY ||
  "https://cors-anywhere-vercel-dzone.vercel.app/";

// Timeout request per URL (ms)
const REQUEST_TIMEOUT = Number(process.env.REQUEST_TIMEOUT || 60000);

// Tanpa delay antar putaran (ambil node.txt lagi langsung kalau 0)
const LOOP_DELAY_MINUTES = Number(process.env.LOOP_DELAY_MINUTES || 0);

// Jeda antar-batch (ms) agar aman; 0 = tanpa jeda
const PER_URL_DELAY_MS = Number(process.env.PER_URL_DELAY_MS || 250);

const CONCURRENCY = Number(process.env.CONCURRENCY || 0); // boleh 0 (0= jalan semuanya sekaligus)

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
  validateStatus: () => true, // biar kita yang nilai
});

/* =========================
 * Helpers
 * ========================= */

// Mode proxy (CORS-anywhere) butuh skema satu slash:
// "https://domain/path" -> "https:/domain/path" ; "http://..." -> "http:/..."
function toSingleSlashScheme(url) {
  return url.replace(/^https?:\/\//i, (m) => m.slice(0, -1));
}

// Mode direct: pastikan ada skema; default ke https:// bila tak ada
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
  } catch {}
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
  console.log(`📥 Ambil daftar URL dari: ${SOURCE_URL}`);
  const resp = await client.get(SOURCE_URL, { responseType: "text" });
  if (resp.status !== 200) {
    throw new Error(`Gagal ambil node.txt | HTTP ${resp.status}`);
  }
  const list = parseList(resp.data);
  console.log(`📄 Dapat ${list.length} URL dari node.txt`);
  return list;
}

function buildRequestUrl(targetUrl) {
  if (USE_PROXY) {
    const singleSlash = toSingleSlashScheme(targetUrl);
    return `${CORS_PROXY}${singleSlash}`;
  }
  return normalizeDirectUrl(targetUrl);
}

async function hitOne(targetUrl) {
  const reqUrl = buildRequestUrl(targetUrl);
  const t0 = Date.now();
  let resp;
  try {
    resp = await client.get(reqUrl, {
      responseType: "text",
      headers: {
        "Accept": "*/*",
        "User-Agent": "Railway-Node-Runner/1.0",
      },
    });
  } catch (err) {
    console.log(`❌ ${targetUrl} | ERROR request: ${err.message} ${USE_PROXY ? "(proxy)" : "(direct)"}`);
    return { ok: false, status: 0 };
  }

  const ms = Date.now() - t0;
  const bodyText = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);

  if (isJsonResponse(resp, bodyText)) {
    console.log(`✅ JSON | ${targetUrl} | HTTP ${resp.status} | ${ms} ms ${USE_PROXY ? "(proxy)" : "(direct)"}`);
    return { ok: true, status: resp.status };
  } else {
    console.log(
      `⚠️ BUKAN JSON | ${targetUrl} | HTTP ${resp.status} | ${ms} ms | body: ${shortBody(bodyText)} ${USE_PROXY ? "(proxy)" : "(direct)"}`
    );
    return { ok: false, status: resp.status };
  }
}

// Paralel terbatas (batched)
// async function runBatched(urls) {
//   for (let i = 0; i < urls.length; i += CONCURRENCY) {
//     const chunk = urls.slice(i, i + CONCURRENCY);
//     await Promise.all(chunk.map((u) => hitOne(u)));
//     if (PER_URL_DELAY_MS > 0) await sleep(PER_URL_DELAY_MS);
//   }
// }

async function runBatched(urls) {
  if (urls.length === 0) return;

  if (CONCURRENCY <= 0) {
    // full parallel (semua sekaligus)
    await Promise.all(urls.map(u => hitOne(u)));
    return;
  }

  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const chunk = urls.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(u => hitOne(u)));
    if (PER_URL_DELAY_MS > 0) await sleep(PER_URL_DELAY_MS);
  }
}


async function mainLoop() {
  console.log(
    `🚀 Mulai | mode=${USE_PROXY ? "proxy" : "direct"} | concurrency=${CONCURRENCY} | batchDelay=${PER_URL_DELAY_MS}ms | encoded=${USE_PROXY ? "single-slash" : "normal"}`
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
    }
    // jika 0 → langsung repeat (tanpa delay)
  }
}

/* =========================
 * HTTP Health Check
 * ========================= */
const app = express();
app.get("/", (req, res) => {
  res.type("text/plain").send(
    [
      "✅ Railway URL Runner (batched parallel) aktif.",
      `MODE=${USE_PROXY ? "proxy" : "direct"}`,
      `SOURCE_URL=${SOURCE_URL}`,
      `CORS_PROXY=${CORS_PROXY}`,
      `REQUEST_TIMEOUT=${REQUEST_TIMEOUT}`,
      `CONCURRENCY=${CONCURRENCY} (batched)`,
      `PER_URL_DELAY_MS=${PER_URL_DELAY_MS}`,
      `LOOP_DELAY_MINUTES=${LOOP_DELAY_MINUTES}`,
      "",
      "Sukses jika respons target berupa JSON (header application/json atau isi bisa di-parse JSON).",
      USE_PROXY
        ? "Format request (proxy): <CORS_PROXY> + <https:/single-slash-url>"
        : "Format request (direct): https://target/normal",
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

