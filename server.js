// server.js — USING NODE.JS NATIVE HTTP CLIENT
import express from "express";
import https from "https";
import { URL } from "url";

const SOURCE_URL = process.env.SOURCE_URL || "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";
const PORT = process.env.PORT || 10000;

const app = express();
app.listen(PORT, () => {
  console.log(`🌐 Service running on ${PORT}`);
  startNativeFlow();
});

// Fetch URLs menggunakan axios (masih bisa dipakai)
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

// HIT URL USING NATIVE NODE.JS HTTPS (100% compatible)
function hitWithNativeHTTP(url) {
  return new Promise((resolve) => {
    const proxiedUrl = `https://cors-anywhere-vercel-dzone.vercel.app/https:/${url.replace(/^https?:\/\//, "")}`;
    const parsedUrl = new URL(proxiedUrl);
    
    console.log(`🎯 Native HTTP: ${url.split('?')[0]}`);
    
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
      console.log(`📊 Native Response: ${res.statusCode}`);
      
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
      console.log(`💥 Native Error: ${error.message}`);
      resolve(false);
    });

    req.on('timeout', () => {
      console.log('💥 Native Timeout');
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

async function startNativeFlow() {
  console.log("🚀 Starting NATIVE HTTP flow...");
  
  while (true) {
    const urls = await fetchURLs();
    
    for (const url of urls) {
      const success = await hitWithNativeHTTP(url);
      
      // Random delay 8-15 detik
      const delay = 8000 + Math.random() * 7000;
      console.log(`💤 Waiting ${Math.round(delay/1000)}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
    
    console.log("💤 Batch complete, waiting 90s...");
    await new Promise(r => setTimeout(r, 90000));
  }
}
