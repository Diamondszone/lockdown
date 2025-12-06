// web.js
import express from "express";
import axios from "axios";

const SOURCE_URL =
  process.env.SOURCE_URL ||
  "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";

const CORS_PROXY =
  process.env.CORS_PROXY ||
  "https://cors-anywhere-railway-production.up.railway.app";

// ────────────── PARSER ──────────────
function parseList(txt) {
  return (txt || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isJson(body) {
  if (!body) return false;
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}

function isCaptcha(body) {
  if (!body) return false;
  const t = body.toLowerCase();
  return (
    t.includes("captcha") ||
    t.includes("verify you are human") ||
    t.includes("verification") ||
    t.includes("robot") ||
    t.includes("cloudflare")
  );
}

const fetchText = async (url) => {
  try {
    const resp = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 20000,
      validateStatus: () => true,
      responseType: "text",
    });

    return {
      ok: true,
      text:
        typeof resp.data === "string"
          ? resp.data
          : JSON.stringify(resp.data),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};

const buildProxyUrl = (u) => `${CORS_PROXY}/${u}`;

// ────────────── HIT URL ──────────────
async function hitUrl(url) {
  const direct = await fetchText(url);
  const directOk = direct.ok && !isCaptcha(direct.text) && isJson(direct.text);

  if (directOk) {
    console.log(`🔗 URL: ${url} | ✅ Direct OK | JSON`);
    process.stdout.write("");
    return;
  }

  const proxied = await fetchText(buildProxyUrl(url));
  const proxyOk =
    proxied.ok && !isCaptcha(proxied.text) && isJson(proxied.text);

  if (proxyOk) {
    console.log(`🔗 URL: ${url} | ✅ Proxy OK | JSON`);
  } else {
    console.log(`🔗 URL: ${url} | ❌ Direct & Proxy | BUKAN JSON`);
  }

  process.stdout.write("");
}

// ────────────── REALTIME PARALLEL WORKER QUEUE ──────────────
async function mainLoop() {
  const WORKERS = 20;

  let queue = [];
  let loading = false;

  // Ambil list dari SOURCE secara periodik
  async function refillQueue() {
    if (loading) return;
    loading = true;

    try {
      const resp = await fetchText(SOURCE_URL);
      const urls = resp.ok ? parseList(resp.text) : [];

      if (urls.length > 0) {
        queue.push(...urls);
        console.log(`📥 Queue bertambah: +${urls.length}`);
        process.stdout.write("");
      }
    } catch (e) {
      console.log("❌ ERROR refillQueue:", e.message);
    } finally {
      loading = false;
      setTimeout(refillQueue, 2000); // refresh list tiap 2 detik
    }
  }

  refillQueue();

  // Worker paralel tanpa henti
  async function worker() {
    while (true) {
      const url = queue.shift();

      if (!url) {
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }

      await hitUrl(url);
    }
  }

  // Jalankan worker sebanyak WORKERS
  for (let i = 0; i < WORKERS; i++) {
    worker();
  }
}

// ────────────── HTTP STATUS ──────────────
const app = express();
app.get("/", (req, res) => res.send("URL Runner Active"));
app.listen(process.env.PORT || 3000, () =>
  console.log("🌐 Web server OK")
);

// Mulai mesin
mainLoop();
