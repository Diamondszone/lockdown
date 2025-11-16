import fetch from "node:fetch";

const NODE_TXT_URL = "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";
const CORS_PROXY = "https://cors-anywhere-railway-production.up.railway.app/";

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

function isJsonString(str) {
  if (!str) return false;
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

async function fetchURL(url, useProxy = false) {
  const finalURL = useProxy ? CORS_PROXY + url : url;
  try {
    const res = await fetch(finalURL, { headers: { "User-Agent": "Mozilla/5.0" } });
    const text = await res.text();
    return {
      ok: true,
      text,
      json: isJsonString(text),
      captcha: isCaptcha(text),
    };
  } catch (err) {
    return { ok: false, text: null, json: false, captcha: false };
  }
}

async function processUrl(url) {
  console.log(`🔗 URL: ${url}`);

  // Direct request
  const direct = await fetchURL(url, false);
  if (direct.ok && direct.json && !direct.captcha) {
    console.log("✅ Direct JSON OK");
    console.log(JSON.stringify(JSON.parse(direct.text), null, 2), "\n");
    return;
  } else if (direct.captcha) {
    console.log("🛑 Direct CAPTCHA, coba proxy...");
  } else {
    console.log("⚠️ Direct bukan JSON, coba proxy...");
  }

  // Proxy fallback
  const proxy = await fetchURL(url, true);
  if (proxy.ok && proxy.json && !proxy.captcha) {
    console.log("✅ Proxy JSON OK");
    console.log(JSON.stringify(JSON.parse(proxy.text), null, 2), "\n");
  } else if (proxy.captcha) {
    console.log("🛑 Proxy CAPTCHA juga\n");
  } else {
    console.log("⚠️ Proxy bukan JSON\n");
  }
}

async function loopForever() {
  while (true) {
    try {
      const res = await fetch(NODE_TXT_URL);
      const txt = await res.text();
      const urls = txt.split("\n").map(x => x.trim()).filter(Boolean);

      for (const url of urls) {
        await processUrl(url);
      }
    } catch (e) {
      console.log("❌ Gagal ambil daftar URL:", e.message);
    }
  }
}

loopForever();
