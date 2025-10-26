// server.js — BROWSER-LIKE requests
import express from "express";
import axios from "axios";
import https from "https";

const SOURCE_URL = process.env.SOURCE_URL || "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";
const CORS_PROXY = "https://cors-anywhere-vercel-dzone.vercel.app/";
const PORT = process.env.PORT || 10000;

const app = express();
app.listen(PORT, () => {
  console.log(`🌐 Service running on ${PORT}`);
  startFlow();
});

// AXIOS INSTANCE dengan setting seperti browser
const axiosClient = axios.create({
  timeout: 30000,
  validateStatus: () => true,
  httpsAgent: new https.Agent({
    // Setting TLS seperti browser modern
    secureProtocol: 'TLSv1_2_method',
    rejectUnauthorized: false
  }),
  maxRedirects: 5,
  decompress: true
});

class URLQueue {
  constructor() {
    this.urls = [];
    this.currentIndex = 0;
  }

  async refreshList() {
    try {
      console.log("🔄 Fetching fresh URL list...");
      const r = await axiosClient.get(SOURCE_URL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      const newUrls = String(r.data).split('\n')
        .map(s => s.trim())
        .filter(s => s && s.startsWith('http'));
      
      this.urls = newUrls;
      this.currentIndex = 0;
      console.log(`✅ Loaded ${this.urls.length} URLs`);
      return this.urls.length > 0;
    } catch (e) {
      console.log("❌ Failed to fetch URL list:", e.message);
      return false;
    }
  }

  getNextUrl() {
    if (this.currentIndex >= this.urls.length) return null;
    return this.urls[this.currentIndex++];
  }

  hasMoreUrls() {
    return this.currentIndex < this.urls.length;
  }
}

const urlQueue = new URLQueue();

function makeProxiedUrl(targetUrl) {
  const randomParam = `__r=${Math.random().toString(36).slice(2)}`;
  const separator = targetUrl.includes('?') ? '&' : '?';
  return `${CORS_PROXY.replace(/\/+$/, "")}/https:/${targetUrl.replace(/^https?:\/\//, "")}${separator}${randomParam}`;
}

// HEADERS PERSIS SEPERTI BROWSER
function getBrowserLikeHeaders() {
  return {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };
}

async function hitSingleUrl(url) {
  const proxiedUrl = makeProxiedUrl(url);
  
  console.log(`🎯 [${new Date().toLocaleTimeString()}] Hitting: ${url.substring(0, 60)}...`);
  
  try {
    const res = await axiosClient.get(proxiedUrl, {
      headers: getBrowserLikeHeaders(),
      // Tambahkan setting seperti browser
      withCredentials: true, // SEND COOKIES
      maxRedirects: 5,
      timeout: 30000
    });

    console.log(`📊 Response: ${res.status} | Size: ${JSON.stringify(res.data)?.length || 0} bytes`);
    
    if (res.status === 200) {
      console.log(`✅ SUCCESS!`);
      return true;
    } else {
      console.log(`❌ Failed: Status ${res.status}`);
      return false;
    }
    
  } catch (error) {
    console.log(`💥 Error: ${error.message}`);
    if (error.response) {
      console.log(`   Response: ${error.response.status} ${error.response.statusText}`);
    }
    return false;
  }
}

async function startFlow() {
  console.log("🚀 Starting BROWSER-LIKE flow...");
  
  while (true) {
    await urlQueue.refreshList();
    
    while (urlQueue.hasMoreUrls()) {
      const url = urlQueue.getNextUrl();
      await hitSingleUrl(url);
      
      // Delay seperti manusia browsing
      await new Promise(r => setTimeout(r, 3000 + Math.random() * 4000));
    }
    
    console.log("💤 Finished batch, waiting 10s...");
    await new Promise(r => setTimeout(r, 10000));
  }
}
