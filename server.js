// server.js
import express from "express";
import axios from "axios";

/* =========================
 * Konfigurasi
 * ========================= */
const SOURCE_URL = process.env.SOURCE_URL || "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";
const CORS_PROXY = process.env.CORS_PROXY || "https://cors-anywhere-railway-production.up.railway.app";

/* =========================
 * Helpers
 * ========================= */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function parseList(txt) {
  return (txt || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

function isJson(body) {
  if (!body) return false;
  try {
    JSON.parse(body);
    return true;
  } catch (e) {
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

function buildProxyUrl(url) {
  return `${CORS_PROXY}/${url}`;
}

async function fetchText(url) {
  try {
    const resp = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 30000,
      responseType: "text",
      validateStatus: () => true
    });
    return { ok: true, text: typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* =========================
 * Core Logic
 * ========================= */
async function hitUrl(url) {
  console.log(`\n🔗 URL: ${url}`);
  
  // Direct request
  const direct = await fetchText(url);

  if (!direct.ok) {
    console.log(`❌ Direct request failed: ${direct.error}`);
  } else if (isCaptcha(direct.text)) {
    console.log("🛑 Direct CAPTCHA detected → pakai proxy");
  } else if (isJson(direct.text)) {
    console.log("✅ Direct OK | JSON");
    return;
  } else {
    console.log("❌ Direct bukan JSON");
  }

  // Proxy request
  const proxyUrl = buildProxyUrl(url);
  const proxied = await fetchText(proxyUrl);

  if (!proxied.ok) {
    console.log(`❌ Proxy request failed: ${proxied.error}`);
  } else if (isCaptcha(proxied.text)) {
    console.log("❌ PROXY CAPTCHA juga terdeteksi");
  } else if (isJson(proxied.text)) {
    console.log("✅ PROXY OK | JSON");
  } else {
    console.log("❌ PROXY bukan JSON");
  }
}

async function mainLoop() {
  while (true) {
    try {
      const listResp = await fetchText(SOURCE_URL);
      if (!listResp.ok) {
        console.log(`❌ Gagal ambil node.txt: ${listResp.error}`);
        await sleep(5000);
        continue;
      }
      const urls = parseList(listResp.text);
      if (!urls.length) {
        console.log("ℹ️ node.txt kosong");
        await sleep(5000);
        continue;
      }

      for (const u of urls) {
        await hitUrl(u);
      }

    } catch (e) {
      console.log(`❌ Loop error: ${e.message}`);
    }
  }
}

/* =========================
 * HTTP Health Check
 * ========================= */
const app = express();
app.get("/", (req, res) => res.send("✅ URL Runner Active"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Web service port ${PORT}`));

mainLoop();
