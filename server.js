// server.js — USING CURL DIRECTLY
import express from "express";
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const SOURCE_URL = process.env.SOURCE_URL || "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";
const PORT = process.env.PORT || 10000;

const app = express();
app.listen(PORT, () => {
  console.log(`🌐 Service running on ${PORT}`);
  startCurlFlow();
});

// Fetch URLs menggunakan axios biasa
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

// HIT URL USING CURL (100% sama seperti browser)
async function hitWithCurl(url) {
  const proxiedUrl = `https://cors-anywhere-vercel-dzone.vercel.app/https:/${url.replace(/^https?:\/\//, "")}`;
  
  console.log(`🎯 Curling: ${url.split('?')[0]}`);
  
  const curlCommand = `curl -s -o /dev/null -w "%{http_code}" -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" -H "Accept-Language: en-US,en;q=0.5" --compressed -L --max-time 30 "${proxiedUrl}"`;
  
  try {
    const { stdout, stderr } = await execAsync(curlCommand, { timeout: 35000 });
    const statusCode = stdout.trim();
    
    console.log(`📊 Curl Response: ${statusCode}`);
    return statusCode === '200';
    
  } catch (error) {
    console.log(`💥 Curl Error: ${error.message}`);
    return false;
  }
}

async function startCurlFlow() {
  console.log("🚀 Starting CURL-based flow...");
  
  while (true) {
    const urls = await fetchURLs();
    
    for (const url of urls) {
      const success = await hitWithCurl(url);
      console.log(success ? '✅ SUCCESS' : '❌ FAILED');
      
      // Delay 5-10 detik
      await new Promise(r => setTimeout(r, 5000 + Math.random() * 5000));
    }
    
    console.log("💤 Batch complete, waiting 60s...");
    await new Promise(r => setTimeout(r, 60000));
  }
}
