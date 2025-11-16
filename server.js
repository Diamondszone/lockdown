// server.js
import express from "express";
import axios from "axios";

const SOURCE_URL = process.env.SOURCE_URL || "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";
const CORS_PROXY = process.env.CORS_PROXY || "https://cors-anywhere-railway-production.up.railway.app";

function parseList(txt) {
  return (txt || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

function isJson(body) {
  if (!body) return false;
  try { JSON.parse(body); return true; } 
  catch { return false; }
}

function isCaptcha(body) {
  if (!body) return false;
  const t = body.toLowerCase();
  return t.includes("captcha") || t.includes("verify you are human") || t.includes("verification") || t.includes("robot") || t.includes("cloudflare");
}

function buildProxyUrl(url) { return `${CORS_PROXY}/${url}`; }

async function fetchText(url) {
  try {
    const resp = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 30000, responseType: "text", validateStatus: () => true });
    return { ok: true, text: typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data) };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function hitUrl(url) {
  const direct = await fetchText(url);
  const directJson = direct.ok && !isCaptcha(direct.text) && isJson(direct.text);

  if (directJson) {
    console.log(`🔗 URL: ${url} | ✅ Direct OK | JSON`);
    return;
  }

  const proxied = await fetchText(buildProxyUrl(url));
  const proxyJson = proxied.ok && !isCaptcha(proxied.text) && isJson(proxied.text);

  if (proxyJson) {
    console.log(`🔗 URL: ${url} | ✅ Proxy OK | JSON`);
  } else {
    console.log(`🔗 URL: ${url} | ❌ Direct & Proxy | BUKAN JSON`);
  }
}

async function mainLoop() {
  while (true) {
    try {
      const listResp = await fetchText(SOURCE_URL);
      const urls = listResp.ok ? parseList(listResp.text) : [];
      for (const u of urls) {
        await hitUrl(u);
      }
    } catch (e) {
      console.log(`❌ Loop error: ${e.message}`);
    }
  }
}

// HTTP Health Check
const app = express();
app.get("/", (req, res) => res.send("✅ URL Runner Active"));
app.listen(process.env.PORT || 3000, () => console.log("🌐 Web service running"));

mainLoop();
