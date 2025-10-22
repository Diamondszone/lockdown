import express from "express";
import axios from "axios";

const SOURCE_URL = process.env.SOURCE_URL || "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";
const LOOP_DELAY_MINUTES = process.env.LOOP_DELAY || 3;
const REQUEST_TIMEOUT = 60000;

const app = express();
const PORT = process.env.PORT || 10000; // Render akan menetapkan PORT otomatis

// Endpoint dummy (Render butuh ini agar dianggap aktif)
app.get("/", (req, res) => {
  res.send("✅ URL Rotator aktif berjalan di background!");
});

// Jalankan HTTP server
app.listen(PORT, () => {
  console.log(`🌐 Web Service aktif di port ${PORT}`);
  startLoop(); // mulai proses utama setelah web aktif
});

// Fungsi delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getUrlList() {
  try {
    const res = await axios.get(SOURCE_URL, { timeout: 10000 });
    const urls = res.data
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && line.startsWith("http"));
    console.log(`✅ Ditemukan ${urls.length} URL dari sumber`);
    return urls;
  } catch (err) {
    console.error(`❌ Gagal baca daftar URL: ${err.message}`);
    return [];
  }
}

async function hitUrls(urls) {
  for (const url of urls) {
    const time = new Date().toLocaleString();
    console.log(`[${time}] 🔁 GET ${url}`);
    try {
      const res = await axios.get(url, { timeout: REQUEST_TIMEOUT });
      console.log(`  ✅ ${res.status} ${res.statusText}`);
    } catch (err) {
      console.log(`  ❌ Error: ${err.message}`);
    }
    await sleep(1000); // jeda 1 detik antar URL
  }
}

async function startLoop() {
  console.log(`🚀 Loop dimulai. Membaca URL dari: ${SOURCE_URL}`);
  while (true) {
    const urls = await getUrlList();
    if (urls.length > 0) await hitUrls(urls);
    console.log(`🕒 Menunggu ${LOOP_DELAY_MINUTES} menit sebelum loop berikutnya...\n`);
    await sleep(LOOP_DELAY_MINUTES * 60 * 1000);
  }
}


