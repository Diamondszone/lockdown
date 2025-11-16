// server.js
import fs from "fs/promises";
import fetch from "node-fetch";

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
    const res = await fetch(finalURL, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "*/*"
      }
    });

    const text = await res.text();

    return {
      ok: true,
      text,
      json: isJsonString(text),
      captcha: isCaptcha(text)
    };

  } catch (err) {
    return {
      ok: false,
      text: null,
      json: false,
      captcha: false
    };
  }
}

async function processUrl(url) {
  console.log(`URL: ${url}`);

  // Direct request
  const direct = await fetchURL(url, false);
  if (direct.ok && direct.json && !direct.captcha) {
    console.log("[Direct] JSON OK\n");
    return;
  } else {
    console.log("[Direct] JSON FAIL / CAPTCHA");
  }

  // Proxy fallback
  const proxy = await fetchURL(url, true);
  if (proxy.ok && proxy.json && !proxy.captcha) {
    console.log("[Proxy ] JSON OK\n");
    return;
  } else {
    console.log("[Proxy ] JSON FAIL / CAPTCHA\n");
  }
}

async function loopForever() {
  while (true) {
    try {
      const content = await fs.readFile("node.txt", "utf8");
      const urls = content.split("\n").map(x => x.trim()).filter(Boolean);

      for (const url of urls) {
        await processUrl(url);
      }

    } catch (e) {
      console.log("Gagal membaca node.txt:", e.message);
    }
  }
}

// Mulai loop nonstop
loopForever();
