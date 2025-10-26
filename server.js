// server.js — ONE-BY-NEXT strategy (no waiting)
import express from "express";
import axios from "axios";
import dns from "dns";

const SOURCE_URL = process.env.SOURCE_URL || "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";
const CORS_PROXY = "https://cors-anywhere-vercel-dzone.vercel.app/";
const PORT = process.env.PORT || 10000;

dns.setDefaultResultOrder?.("ipv4first");
const app = express();
app.listen(PORT, () => {
  console.log(`🌐 Service running on ${PORT}`);
  startContinuousFlow();
});

const axiosClient = axios.create({
  timeout: 30000,
  validateStatus: () => true
});

// SIMPLE URL QUEUE SYSTEM
class URLQueue {
  constructor() {
    this.urls = [];
    this.currentIndex = 0;
    this.lastFetchTime = 0;
  }

  async refreshList() {
    try {
      console.log("🔄 Fetching fresh URL list...");
      const r = await axiosClient.get(SOURCE_URL);
      const newUrls = String(r.data).split('\n')
        .map(s => s.trim())
        .filter(s => s && s.startsWith('http'));
      
      this.urls = newUrls;
      this.currentIndex = 0;
      this.lastFetchTime = Date.now();
      console.log(`✅ Loaded ${this.urls.length} URLs`);
      return this.urls.length > 0;
    } catch (e) {
      console.log("❌ Failed to fetch URL list:", e.message);
      return false;
    }
  }

  getNextUrl() {
    if (this.currentIndex >= this.urls.length) {
      return null; // No more URLs in current list
    }
    const url = this.urls[this.currentIndex];
    this.currentIndex++;
    return url;
  }

  shouldRefresh() {
    // Refresh every 5 minutes or if list exhausted
    return Date.now() - this.lastFetchTime > 300000 || this.currentIndex >= this.urls.length;
  }
}

const urlQueue = new URLQueue();

function makeProxiedUrl(targetUrl) {
  const randomParam = `__r=${Math.random().toString(36).slice(2)}`;
  const separator = targetUrl.includes('?') ? '&' : '?';
  return `${CORS_PROXY.replace(/\/+$/, "")}/https:/${targetUrl.replace(/^https?:\/\//, "")}${separator}${randomParam}`;
}

async function hitSingleUrl(url) {
  const proxiedUrl = makeProxiedUrl(url);
  
  console.log(`🎯 [${new Date().toLocaleTimeString()}] Targeting: ${url.substring(0, 80)}...`);
  
  try {
    const res = await axiosClient.get(proxiedUrl, {
      headers: {
        "Origin": "https://example.com",
        "Referer": "https://example.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json,text/plain,*/*",
        "Cache-Control": "no-cache"
      }
    });

    const success = res.status === 200;
    
    if (success) {
      console.log(`✅ SUCCESS! (${res.status} in ${res.duration}ms) → Immediately moving to next URL`);
      return true;
    } else {
      console.log(`⚠️  Failed (status ${res.status}) → Moving to next URL`);
      return false;
    }
    
  } catch (error) {
    console.log(`💥 Error: ${error.message} → Moving to next URL`);
    return false;
  }
}

async function startContinuousFlow() {
  console.log("🚀 Starting CONTINUOUS ONE-BY-ONE flow...");
  
  // Initial load
  await urlQueue.refreshList();
  
  while (true) {
    // Refresh list if needed
    if (urlQueue.shouldRefresh()) {
      const hasUrls = await urlQueue.refreshList();
      if (!hasUrls) {
        console.log("💤 No URLs available, waiting 30 seconds...");
        await new Promise(r => setTimeout(r, 30000));
        continue;
      }
    }

    // Get next URL
    const nextUrl = urlQueue.getNextUrl();
    if (!nextUrl) {
      console.log("📭 Queue empty, refreshing...");
      await urlQueue.refreshList();
      continue;
    }

    // Hit the URL (ONE AT A TIME)
    const success = await hitSingleUrl(nextUrl);
    
    // ✅ LANGSUNG LANJUT KE URL BERIKUTNYA TANPA TUNGGU
    // Tidak ada delay di sini - immediately continue to next URL
    
    // Small breath to prevent event loop blocking
    await new Promise(r => setImmediate(r));
  }
}
