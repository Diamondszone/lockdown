import express from "express";
import axios from "axios";
import http from "http";
import https from "https";
import { URL } from "url";

const SOURCE_URL = process.env.SOURCE_URL || "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";
const LOOP_DELAY_MINUTES = Number(process.env.LOOP_DELAY || 3);
const REQUEST_TIMEOUT = Number(process.env.REQUEST_TIMEOUT || 60000);
const PER_URL_DELAY_MS = Number(process.env.PER_URL_DELAY_MS || 2000); // jeda antar URL

// ====== HTTP agents (keep-alive) ======
const httpAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 10000, maxSockets: 50 });
const httpsAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 10000, maxSockets: 50 });

// ====== Random UA & IP helpers ======
const USER_AGENTS = [
  // Chrome desktop modern
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  // Mobile
  "Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
];
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomIP = () => `${rand(1, 223)}.${rand(0, 255)}.${rand(0, 255)}.${rand(1, 254)}`;

function buildHeaders(targetUrl) {
  const u = new URL(targetUrl);
  return {
    "User-Agent": USER_AGENTS[rand(0, USER_AGENTS.length - 1)],
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Connection": "keep-alive",
    "Referer": `${u.protocol}//${u.host}/`,
    "X-Forwarded-For": randomIP(),
    "X-Requested-With": "XMLHttpRequest" // opsional; bisa dihapus kalau tidak perlu
  };
}

// Axios instance default
const axiosClient = axios.create({
  timeout: REQUEST_TIMEOUT,
  maxRedirects: 5,
  httpAgent,
  httpsAgent,
  validateStatus: s => s >= 200 && s < 400 // anggap 3xx juga oke (biar terlihat di log)
});

// ====== Express (Web Service mode agar Render tetap “online”) ======
const app = express();
const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => res.send("✅ URL Rotator aktif 24/7 (web-service)."));

app.listen(PORT, () => {
  console.log(`🌐 Web Service aktif di port ${PORT}`);
  startLoop();
});

// ====== Utils ======
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchList() {
  try {
    const res = await axiosClient.get(SOURCE_URL, {
      headers: buildHeaders(SOURCE_URL)
    });
    const urls = String(res.data)
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(s => s && s.startsWith("http"));
    console.log(`✅ Ditemukan ${urls.length} URL dari sumber`);
    return urls;
  } catch (e) {
    console.error(`❌ Gagal baca daftar URL: ${e.message}`);
    return [];
  }
}

async function getOnce(url) {
  // cache-buster
  const u = new URL(url);
  u.searchParams.set("t", Date.now().toString());

  const headers = buildHeaders(u.toString());
  const start = Date.now();
  try {
    const res = await axiosClient.get(u.toString(), { headers });
    const ms = Date.now() - start;
    console.log(`  ✅ ${res.status} ${res.statusText} | ${ms}ms`);
    return true;
  } catch (e) {
    const ms = Date.now() - start;
    console.log(`  ❌ ${e.message} | ${ms}ms`);
    return false;
  }
}

async function hitWithRetry(url) {
  console.log(`[${new Date().toLocaleString()}] 🔁 GET ${url}`);
  const ok = await getOnce(url);
  if (ok) return;
  // retry 1x dengan backoff pendek
  await sleep(1500);
  console.log(`  ↻ Retry: ${url}`);
  await getOnce(url);
}

async function processAll(urls) {
  for (const url of urls) {
    await hitWithRetry(url);
    await sleep(PER_URL_DELAY_MS);
  }
}

async function startLoop() {
  console.log(`🚀 Loop dimulai. SOURCE_URL: ${SOURCE_URL}`);
  while (true) {
    const list = await fetchList();
    if (list.length) {
      await processAll(list);
    }
    console.log(`🕒 Menunggu ${LOOP_DELAY_MINUTES} menit sebelum loop berikutnya...\n`);
    await sleep(LOOP_DELAY_MINUTES * 60 * 1000);
  }
}
