import axios from "axios";

const SOURCE_URL = process.env.SOURCE_URL || "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";
const LOOP_DELAY_MINUTES = process.env.LOOP_DELAY || 5; // waktu antar loop (menit)
const REQUEST_TIMEOUT = 20000; // timeout tiap GET 15 detik

// fungsi delay sederhana
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getUrlList() {
  try {
    const res = await axios.get(SOURCE_URL, { timeout: 10000 });
    // pisahkan berdasarkan baris
    const urls = res.data
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && line.startsWith("http"));
    console.log(`✅ Ditemukan ${urls.length} URL dari sumber`);
    return urls;
  } catch (err) {
    console.error(`❌ Gagal membaca list dari ${SOURCE_URL}: ${err.message}`);
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
    await sleep(2000); // jeda 2 detik antar URL
  }
}

async function startLoop() {
  console.log(`🚀 Worker aktif. Membaca URL dari: ${SOURCE_URL}`);
  while (true) {
    const urls = await getUrlList();
    if (urls.length > 0) await hitUrls(urls);
    console.log(`🕒 Menunggu ${LOOP_DELAY_MINUTES} menit sebelum loop berikutnya...\n`);
    await sleep(LOOP_DELAY_MINUTES * 60 * 1000);
  }
}

startLoop();
