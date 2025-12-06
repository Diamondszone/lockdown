// web.js
import express from "express";
import axios from "axios";

// ======================== CONFIG ===========================
const SOURCE_URL =
  process.env.SOURCE_URL ||
  "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";

const CORS_PROXY =
  process.env.CORS_PROXY ||
  "https://cors-anywhere-railway-production.up.railway.app";

// ======================== LOG MEMORY ===========================
let LOGS = [];
const clients = [];

function pushLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);

  LOGS.unshift(line);
  if (LOGS.length > 5000) LOGS = LOGS.slice(0, 5000);

  // broadcast realtime ke dashboard
  for (const client of clients) {
    client.res.write(`data: ${line}\n\n`);
  }
}

// ======================== PARSER ===========================
function parseList(txt) {
  return (txt || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isJson(body) {
  if (!body) return false;
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}

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

const fetchText = async (url) => {
  try {
    const resp = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 20000,
      validateStatus: () => true,
      responseType: "text",
    });

    return {
      ok: true,
      text:
        typeof resp.data === "string"
          ? resp.data
          : JSON.stringify(resp.data),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};

const buildProxyUrl = (u) => `${CORS_PROXY}/${u}`;

// ======================== HIT URL (Realtime Log) ===========================
async function hitUrl(url) {
  const direct = await fetchText(url);
  const directOk = direct.ok && !isCaptcha(direct.text) && isJson(direct.text);

  if (directOk) {
    pushLog(`🔗 URL: ${url} | ✅ Direct OK | JSON`);
    return;
  }

  const proxied = await fetchText(buildProxyUrl(url));
  const proxyOk =
    proxied.ok && !isCaptcha(proxied.text) && isJson(proxied.text);

  if (proxyOk) {
    pushLog(`🔗 URL: ${url} | ✅ Proxy OK | JSON`);
  } else {
    pushLog(`🔗 URL: ${url} | ❌ Direct & Proxy | BUKAN JSON`);
  }
}

// ======================== WORKER NON-BLOCKING ===========================
async function mainLoop() {
  const WORKERS = 20;
  const MAX_PARALLEL = 4; // tiap worker menjalankan 4 URL bersamaan

  while (true) {
    try {
      // Ambil list
      const listResp = await fetchText(SOURCE_URL);
      const urls = listResp.ok ? parseList(listResp.text) : [];

      if (urls.length === 0) {
        pushLog("❌ SOURCE kosong → ulangi loop...");
        continue;
      }

      pushLog(`📌 Memuat ${urls.length} URL…`);

      let current = 0;

      async function worker() {
        while (true) {
          const batch = [];

          for (let i = 0; i < MAX_PARALLEL; i++) {
            let u = urls[current++];
            if (!u) break;
            batch.push(hitUrl(u)); // TIDAK menunggu → realtime log
          }

          if (batch.length === 0) break;

          // Menunggu salah satu selesai (bukan semuanya)
          await Promise.race(batch);

          // delay mikro agar CPU tidak 100%
          await new Promise((r) => setTimeout(r, 5));
        }
      }

      // jalankan worker
      const pool = [];
      for (let i = 0; i < WORKERS; i++) pool.push(worker());

      await Promise.all(pool);
    } catch (err) {
      pushLog("❌ ERROR LOOP: " + err.message);
    }
  }
}

// ======================== DASHBOARD WEB ===========================
const app = express();

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Realtime JSON Checker Dashboard</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">

  <style>
    body {
      margin:0;
      background:#0d0d0f;
      font-family: 'Segoe UI', sans-serif;
      color:#e5e5e5;
    }

    /* HEADER */
    .header {
      background: linear-gradient(135deg, #111, #1a1a1d, #111);
      padding:20px 30px;
      box-shadow: 0 0 25px rgba(0,255,170,0.15);
      border-bottom:1px solid #222;
      position:sticky;
      top:0;
      z-index:20;
    }

    .title {
      font-size:28px;
      font-weight:700;
      color:#56f7c4;
      text-shadow: 0 0 10px rgba(86,247,196,0.4);
    }

    .sub {
      font-size:14px;
      margin-top:4px;
      color:#999;
    }

    /* INFO BAR */
    .stats {
      display:flex;
      gap:25px;
      margin-top:15px;
    }

    .stat-box {
      padding:12px 18px;
      background:#141416;
      border:1px solid #222;
      border-radius:10px;
      box-shadow:0 0 10px rgba(0,255,170,0.05);
    }
    .stat-num {
      font-size:20px;
      color:#56f7c4;
      font-weight:700;
    }

    /* CLEAR BUTTON */
    .clear-btn {
      margin-left:auto;
      padding:10px 20px;
      background:#222;
      border:1px solid #333;
      border-radius:8px;
      color:#eee;
      cursor:pointer;
      font-size:14px;
      transition:0.2s;
    }
    .clear-btn:hover {
      background:#333;
    }

    /* LOG AREA */
    .log-box {
      height: calc(100vh - 160px);
      margin:20px;
      background:#000;
      border:1px solid #202020;
      border-radius:12px;
      padding:20px;
      font-family: monospace;
      font-size:14px;
      overflow-y:scroll;
      box-shadow: inset 0 0 25px rgba(0,255,170,0.05);
      line-height:1.5;
    }

    .log-line {
      margin-bottom:4px;
      padding-bottom:4px;
      border-bottom:1px dashed #151515;
    }

    .green { color:#4dfaad; }
    .yellow { color:#ffe77a; }
    .red { color:#ff6a6a; }
  </style>
</head>

<body>

  <div class="header">
    <div class="title">🔍 JSON Checker — Realtime Dashboard</div>
    <div class="sub">Monitoring & Diagnostik Realtime</div>

    <div class="stats">
      <div class="stat-box">
        Success: <span class="stat-num" id="s-success">0</span>
      </div>
      <div class="stat-box">
        Failed: <span class="stat-num" id="s-fail">0</span>
      </div>
      <div class="stat-box">
        Total Hit: <span class="stat-num" id="s-total">0</span>
      </div>

      <button class="clear-btn" onclick="clearLog()">Clear Log</button>
    </div>
  </div>

  <div class="log-box" id="log"></div>

  <script>
    const logBox = document.getElementById("log");
    const evt = new EventSource("/stream");

    let success = 0;
    let fail = 0;
    let total = 0;

    evt.onmessage = (e) => {
      const text = e.data;

      // Hit Counter
      total++;
      document.getElementById("s-total").innerText = total;

      if (text.includes("Direct OK") || text.includes("Proxy OK"))
        success++;
      if (text.includes("BUKAN JSON"))
        fail++;

      document.getElementById("s-success").innerText = success;
      document.getElementById("s-fail").innerText = fail;

      // warna log
      let cls = "yellow";
      if (text.includes("OK")) cls = "green";
      if (text.includes("BUKAN")) cls = "red";

      const div = document.createElement("div");
      div.className = "log-line " + cls;
      div.textContent = text;

      logBox.appendChild(div);

      // auto scroll bottom
      logBox.scrollTop = logBox.scrollHeight;
    };

    function clearLog() {
      logBox.innerHTML = "";
      success = fail = total = 0;
      document.getElementById("s-success").innerText = 0;
      document.getElementById("s-fail").innerText = 0;
      document.getElementById("s-total").innerText = 0;
    }
  </script>

</body>
</html>
  `);
});


// ======================== SSE STREAM ===========================
app.get("/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  res.flushHeaders();
  res.write(": connected\n\n");

  const client = { res };
  clients.push(client);

  req.on("close", () => {
    clients.splice(clients.indexOf(client), 1);
  });
});

// ======================== START ===========================
app.listen(process.env.PORT || 3000, () =>
  pushLog("🌐 Dashboard SSE aktif di port 3000")
);

mainLoop();

