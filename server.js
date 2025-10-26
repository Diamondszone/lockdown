// server.js — ULTRA FAST CONTINUOUS
import express from "express";
import https from "https";
import { URL } from "url";

const SOURCE_URL = process.env.SOURCE_URL || "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";
const PORT = process.env.PORT || 10000;

const app = express();
app.listen(PORT, () => {
  console.log(`🌐 Service running on ${PORT}`);
  startUltraFastFlow();
});

import axios from "axios";

class UltraFastProcessor {
  constructor() {
    this.urls = [];
    this.currentIndex = 0;
  }

  async refreshURLs() {
    try {
      const r = await axios.get(SOURCE_URL);
      this.urls = String(r.data).split('\n')
        .map(s => s.trim())
        .filter(s => s && s.startsWith('http'));
      this.currentIndex = 0;
      console.log(`✅ Loaded ${this.urls.length} URLs`);
      return this.urls.length > 0;
    } catch (e) {
      console.log("❌ Failed to fetch URLs:", e.message);
      return false;
    }
  }

  getNextURL() {
    if (this.currentIndex >= this.urls.length) return null;
    return this.urls[this.currentIndex++];
  }

  hitURL(url) {
    return new Promise((resolve) => {
      const proxiedUrl = `https://cors-anywhere-vercel-dzone.vercel.app/https:/${url.replace(/^https?:\/\//, "")}`;
      const parsedUrl = new URL(proxiedUrl);
      
      const req = https.request({
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*'
        },
        timeout: 30000
      }, (res) => {
        console.log(`🎯 ${url.split('?')[0]} → ${res.statusCode}`);
        resolve(res.statusCode === 200);
      });

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });

      req.end();
    });
  }
}

const processor = new UltraFastProcessor();

async function startUltraFastFlow() {
  console.log("🚀 Starting ULTRA FAST continuous flow...");
  
  await processor.refreshURLs();
  
  while (true) {
    const url = processor.getNextURL();
    
    if (!url) {
      // Immediately refresh when list is exhausted
      await processor.refreshURLs();
      continue;
    }

    // Process URL without any delay
    await processor.hitURL(url);
    
    // Continue immediately to next URL
  }
}
