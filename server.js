import axios from "axios";

const NODE_LIST_URL = "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";
const CORS_PROXY = "https://cors-anywhere-railway-production.up.railway.app/";

const client = axios.create({
  timeout: 30000,
  maxContentLength: Infinity,
  maxBodyLength: Infinity
});

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function isCaptcha(body) {
  if (!body) return false;
  const t = body.toLowerCase();
  return (
    t.includes("captcha") ||
    t.includes("verify you are human") ||
    t.includes("verification") ||
    t.includes("robot") ||
    t.includes("cloudflare") ||
    t.includes("are you human")
  );
}

function isJsonString(str) {
  if (!str) return false;
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

async function fetchNodeList() {
  try {
    const res = await client.get(NODE_LIST_URL, { responseType: "text" });
    return res.data.split("\n").map(x => x.trim()).filter(Boolean);
  } catch (e) {
    console.log("❌ Gagal mengambil node.txt:", e.message);
    return [];
  }
}

async function requestDirect(url) {
  try {
    const res = await client.get(url, {
      responseType: "text",
      headers: {
        "Accept": "*/*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    });

    const body = res.data;

    return {
      ok: true,
      captcha: isCaptcha(body),
      json: isJsonString(body),
      body
    };
  } catch (e) {
    return { ok: false, captcha: false, json: false, error: e.message };
  }
}

async function requestProxy(url) {
  const proxyUrl = CORS_PROXY + url;

  try {
    const res = await client.get(proxyUrl, {
      responseType: "text",
      headers: {
        "Accept": "*/*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    });

    const body = res.data;

    return {
      ok: true,
      captcha: isCaptcha(body),
      json: isJsonString(body),
      body,
      proxy: true
    };
  } catch (e) {
    return { ok: false, captcha: false, json: false, error: e.message, proxy: true };
  }
}

async function processUrl(url) {
  console.log(`\n=============================`);
  console.log(`🔗 URL: ${url}`);

  // STEP 1 — DIRECT
  console.log(`➡️ Direct request...`);
  const direct = await requestDirect(url);

  if (direct.ok && !direct.captcha) {
    console.log(`✅ Direct OK | JSON: ${direct.json}`);
    return direct.body;
  }

  if (direct.ok && direct.captcha) {
    console.log(`🛑 Direct CAPTCHA | JSON: ${direct.json}`);
  } else {
    console.log(`❌ Direct Error: ${direct.error}`);
  }

  console.log(`🔄 Mencoba via PROXY...`);

  // STEP 2 — PROXY
  const proxy = await requestProxy(url);

  if (proxy.ok && !proxy.captcha) {
    console.log(`✅ PROXY OK | JSON: ${proxy.json}`);
    return proxy.body;
  }

  if (proxy.ok && proxy.captcha) {
    console.log(`🛑 PROXY CAPTCHA | JSON: ${proxy.json}`);
  } else {
    console.log(`❌ PROXY Error: ${proxy.error}`);
  }

  console.log(`🚨 GAGAL TOTAL: CAPTCHA / ERROR pada kedua metode.`);
  return null;
}

async function main() {
  console.log(`📥 Mengambil daftar URL dari: ${NODE_LIST_URL}`);

  const list = await fetchNodeList();

  console.log(`📄 Dapat ${list.length} URL`);

  for (const u of list) {
    await processUrl(u);
  }
}

main();
