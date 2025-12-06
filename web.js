// web.js - REALTIME URL DASHBOARD + FLASH NEW LOG SAFE NODE
import express from "express";
import axios from "axios";
import { EventEmitter } from "events";

const SOURCE_URL = process.env.SOURCE_URL || "https://ampnyapunyaku.top/api/render-cyber-lockdown-image/node.txt";
const CORS_PROXY = process.env.CORS_PROXY || "https://cors-anywhere-railway-production.up.railway.app";
const WORKERS = Number(process.env.WORKERS) || 20;

let queue = [];
let seen = new Set();
let processing = new Set();
let logOK = [];
let logError = [];
let loading = false;
const eventBus = new EventEmitter();

// ------------------
// RUNTIME LOG CAPTURE
// ------------------
let runtimeLogs = [];
const MAX_RUNTIME_LOGS = 1000;

function pushRuntimeLog(level, message) {
  try {
    const item = { level, message: String(message), time: new Date().toISOString() };
    runtimeLogs.push(item);
    if (runtimeLogs.length > MAX_RUNTIME_LOGS) runtimeLogs.shift();
    // broadcast via existing eventBus so clients get realtime
    eventBus.emit("broadcast", { event: "railway-log", payload: item });
  } catch (e) {
    // avoid infinite loop if pushRuntimeLog itself errors
  }
}

// keep originals
const _console_log = console.log.bind(console);
const _console_err = console.error.bind(console);

console.log = (...args) => {
  _console_log(...args);
  try { pushRuntimeLog("info", args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")); } catch(e) {}
};

console.error = (...args) => {
  _console_err(...args);
  try { pushRuntimeLog("error", args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")); } catch(e) {}
};

// ────────────── HELPERS ──────────────
function parseList(txt){return (txt||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);}
function isJson(body){try{JSON.parse(body); return true;}catch{return false;}}
function isCaptcha(body){if(!body) return false; const t=body.toLowerCase(); return t.includes("captcha")||t.includes("verify you are human")||t.includes("verification")||t.includes("robot")||t.includes("cloudflare");}
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const fetchText = async url => {try{const resp=await axios.get(url,{headers:{"User-Agent":"Mozilla/5.0"},timeout:20000,validateStatus:()=>true,responseType:"text"});return {ok:true,text:typeof resp.data==="string"?resp.data:JSON.stringify(resp.data)}}catch(e){return {ok:false,error:e.message}}};
const buildProxyUrl = u => CORS_PROXY + "/" + u;
function broadcast(event,payload){eventBus.emit("broadcast",{event,payload});}

// ────────────── HIT URL ──────────────
async function hitUrl(url){
  const ts = new Date().toISOString();
  const direct = await fetchText(url);
  const directOk = direct.ok && !isCaptcha(direct.text) && isJson(direct.text);

  let data;
  if(directOk){
    data = {url,status:"Direct OK",time:ts};
    logOK.push(data);
    broadcast("log",{type:"ok",item:data,queue_length:queue.length,processing:Array.from(processing)});
    return;
  }

  const proxied = await fetchText(buildProxyUrl(url));
  const proxyOk = proxied.ok && !isCaptcha(proxied.text) && isJson(proxied.text);

  if(proxyOk){
    data = {url,status:"Proxy OK",time:ts};
    logOK.push(data);
    broadcast("log",{type:"ok",item:data,queue_length:queue.length,processing:Array.from(processing)});
  } else {
    data = {url,status:"BUKAN JSON",time:ts};
    logError.push(data);
    broadcast("log",{type:"error",item:data,queue_length:queue.length,processing:Array.from(processing)});
  }
}

// ────────────── REFILL QUEUE ──────────────
async function refillQueue(){
  if(loading) return; loading=true;
  try{
    const resp = await fetchText(SOURCE_URL);
    const urls = resp.ok ? parseList(resp.text) : [];
    let added=0;
    for(const u of urls){ if(!seen.has(u)){seen.add(u); queue.push(u); added++;} }
    if(added>0) broadcast("status",{queue_length:queue.length,processing:Array.from(processing)});
    console.log("refillQueue added:", added, "queue_length:", queue.length);
  }catch(err){console.error("❌ ERROR refillQueue:",err.message || err);}
  finally{loading=false; setTimeout(refillQueue,2000);}
}

// ────────────── WORKER ──────────────
async function worker(id){
  while(true){
    const url = queue.shift();
    if(!url){await sleep(100); continue;}

    processing.add(url);
    broadcast("status",{queue_length:queue.length,processing:Array.from(processing)});

    try{ await hitUrl(url); }
    catch(e){
      const ts = new Date().toISOString();
      const data = {url,status:"ERROR: "+e.message,time:ts};
      logError.push(data);
      broadcast("log",{type:"error",item:data,queue_length:queue.length,processing:Array.from(processing)});
      console.error("Worker", id, "error:", e.message || e);
    }

    processing.delete(url);
    broadcast("status",{queue_length:queue.length,processing:Array.from(processing)});
  }
}

// ────────────── MAIN LOOP ──────────────
async function mainLoop(){
  console.log("⚙ Worker start...");
  refillQueue();
  for(let i=0;i<WORKERS;i++) worker(i+1);
}

// ────────────── EXPRESS SERVER ──────────────
const app = express();
app.get("/",(req,res)=>res.send("URL Runner Active"));

// SSE events
app.get("/events",(req,res)=>{
  res.set({"Content-Type":"text/event-stream","Cache-Control":"no-cache",Connection:"keep-alive"});
  res.flushHeaders?.();
  // send initial connected event
  res.write("event: connected\n");
  res.write("data: "+JSON.stringify({ts:new Date().toISOString()})+"\n\n");

  const listener=({event,payload})=>{
    try{
      const id=Date.now();
      res.write("id:"+id+"\n");
      res.write("event:"+event+"\n");
      res.write("data:"+JSON.stringify(payload)+"\n\n");
    }catch(e){}
  };
  eventBus.on("broadcast",listener);
  req.on("close",()=>eventBus.off("broadcast",listener));
});

// Download logs TXT
app.get("/download-logs",(req,res)=>{
  const type = (req.query.type||"all").toLowerCase();
  let urls = [];
  if(type==="ok") urls = logOK.map(r=>r.url);
  else if(type==="error") urls = logError.map(r=>r.url);
  else urls = [...logOK.map(r=>r.url), ...logError.map(r=>r.url)];

  const txt = urls.join("\n");
  const filename = type==="ok"?"urls_ok.txt":type==="error"?"urls_error.txt":"urls_all.txt";
  res.setHeader("Content-disposition","attachment; filename="+filename);
  res.setHeader("Content-Type","text/plain;charset=utf-8");
  res.send(txt);
});

// New endpoint: return runtime logs
app.get("/railway-log",(req,res)=>{
  res.json(runtimeLogs);
});

// Dashboard HTML - modern, clean UI with runtime logs panel
app.get("/dashboard",(req,res)=>{
  res.send(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Realtime URL Dashboard</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root{
    --bg:#0b0d10;
    --panel:#0f1720;
    --muted:#9aa4b2;
    --accent:#00eaff;
    --ok:#00c853;
    --err:#ff4d4f;
    --glass: rgba(255,255,255,0.02);
  }
  html,body{height:100%;margin:0;background:linear-gradient(180deg,var(--bg),#07080a);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial;}
  .wrap{max-width:1200px;margin:20px auto;padding:18px;}
  header{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
  h1{color:#fff;font-size:20px;margin:0}
  .sub{color:var(--muted);font-size:13px}
  .grid{display:grid;grid-template-columns:380px 1fr;gap:16px}
  .card{background:linear-gradient(180deg,var(--panel),#0b1116);border-radius:12px;padding:14px;border:1px solid rgba(255,255,255,0.03);box-shadow:0 6px 18px rgba(2,6,23,0.6)}
  .status-row{display:flex;flex-direction:column;gap:10px}
  .stat{display:flex;align-items:center;justify-content:space-between;padding:10px;border-radius:8px;background:var(--glass);border:1px solid rgba(255,255,255,0.02)}
  .stat .label{color:var(--muted);font-size:13px}
  .stat .value{font-weight:700;color:#fff}
  .btn{background:transparent;border:1px solid rgba(255,255,255,0.04);padding:8px 10px;border-radius:8px;color:var(--muted);cursor:pointer}
  .btn.primary{border-color:rgba(0,234,255,0.15);color:var(--accent)}
  .filters{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
  .filter{padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.02);color:var(--muted);cursor:pointer;border:1px solid rgba(255,255,255,0.02)}
  .filter.active{background:rgba(0,234,255,0.06);color:var(--accent);border-color:rgba(0,234,255,0.08)}
  #queueList{max-height:520px;overflow:auto;padding:6px}
  .row-item{padding:8px;border-radius:8px;margin-bottom:8px;background:linear-gradient(90deg,rgba(255,255,255,0.01),transparent);font-size:13px;word-break:break-all;display:flex;align-items:center;gap:8px}
  .badge{padding:6px 8px;border-radius:8px;font-size:12px;font-weight:700}
  .badge.ok{background:var(--ok);color:#000}
  .badge.err{background:var(--err);color:#fff}
  .badge.proc{background:#ffb300;color:#000}

  /* RIGHT: logs area */
  .logs-top{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px}
  #railwayLogBox{height:520px;overflow:auto;padding:12px;border-radius:10px;background:#06070a;border:1px solid rgba(255,255,255,0.02);font-family:monospace;font-size:13px;color:#d7dbe0}
  .log-line{padding:6px;border-bottom:1px solid rgba(255,255,255,0.02);display:flex;gap:10px;align-items:flex-start}
  .log-time{color:var(--muted);min-width:170px}
  .log-level-info{color:var(--accent);font-weight:700}
  .log-level-error{color:var(--err);font-weight:700}
  .controls{display:flex;gap:8px;align-items:center}
  a.link{color:var(--muted);text-decoration:none;font-size:13px}
  .small{font-size:12px;color:var(--muted)}
  @media(max-width:980px){.grid{grid-template-columns:1fr;}.status-row{flex-direction:row;gap:8px;overflow:auto}}
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <div>
        <h1>🔥 Realtime URL Runner</h1>
        <div class="sub">Live feed dari queue + runtime logs (ditangkap otomatis dari console)</div>
      </div>
      <div class="controls">
        <button class="btn" onclick="location.href='/download-logs?type=ok'">Download OK</button>
        <button class="btn" onclick="location.href='/download-logs?type=error'">Download Error</button>
        <button class="btn primary" onclick="location.reload()">Refresh</button>
      </div>
    </header>

    <div class="grid">
      <div class="card">
        <div class="status-row">
          <div class="stat"><div class="label">Processing</div><div class="value" id="processingCount">0</div></div>
          <div class="stat"><div class="label">OK</div><div class="value" id="okCount">0</div></div>
          <div class="stat"><div class="label">Error</div><div class="value" id="errCount">0</div></div>
          <div class="stat"><div class="label">Queue</div><div class="value" id="queueCount">0</div></div>
        </div>

        <div style="margin-top:12px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="small">Recent events</div>
            <div>
              <button class="btn" onclick="clearQueueList()">Clear View</button>
            </div>
          </div>

          <div class="filters" style="margin-top:10px">
            <div class="filter active" data-filter="all" onclick="setFilter(event)">All</div>
            <div class="filter" data-filter="processing" onclick="setFilter(event)">Processing</div>
            <div class="filter" data-filter="ok" onclick="setFilter(event)">OK</div>
            <div class="filter" data-filter="error" onclick="setFilter(event)">Error</div>
          </div>

          <div id="queueList" style="margin-top:12px"></div>
        </div>
      </div>

      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-weight:700">Railway / Runtime Logs</div>
            <div class="small">Menangkap semua console.log / console.error dari proses ini</div>
          </div>
          <div>
            <button class="btn" onclick="clearRuntimeLogs()">Clear</button>
            <button class="btn" onclick="toggleAutoScroll()" id="autoscrollBtn">Autoscroll: ON</button>
          </div>
        </div>

        <div id="railwayLogBox"></div>
      </div>
    </div>
  </div>

<script>
  // state
  let currentFilter = "all";
  let lastSnapshot = {ok:[], error:[], processing:[], queue_length:0};
  let autoScroll = true;

  // UI helpers
  function setFilter(e){
    const el = e.currentTarget || e.target;
    document.querySelectorAll('.filter').forEach(f=>f.classList.remove('active'));
    el.classList.add('active');
    currentFilter = el.dataset.filter;
    renderTables(lastSnapshot);
  }

  function clearQueueList(){
    document.getElementById('queueList').innerHTML = '';
  }

  // render queue/status table
  function renderTables(snapshot){
    lastSnapshot = snapshot;
    const ok = snapshot.ok||[], err = snapshot.error||[], processing = snapshot.processing||[], queueLength = snapshot.queue_length||0;
    document.getElementById("processingCount").innerText = processing.length;
    document.getElementById("okCount").innerText = ok.length;
    document.getElementById("errCount").innerText = err.length;
    document.getElementById("queueCount").innerText = queueLength;

    let list = [];
    if(currentFilter==="all"||currentFilter==="processing") list.push(...processing.map(u=>({text: u, type:"processing"})));
    if(currentFilter==="all"||currentFilter==="ok") list.push(...ok.map(r=>({text: r.url, type:"ok"})));
    if(currentFilter==="all"||currentFilter==="error") list.push(...err.map(r=>({text: r.url, type:"err"})));

    const queueList = document.getElementById("queueList");
    queueList.innerHTML = list.map(item=>{
      const badge = item.type==="ok" ? '<span class="badge ok">OK</span>' : item.type==="err" ? '<span class="badge err">ERR</span>' : '<span class="badge proc">PROC</span>';
      return '<div class="row-item">'+ badge + '<div style="flex:1">'+ item.text +'</div></div>';
    }).join('');
    if(autoScroll) queueList.scrollTop = queueList.scrollHeight;
  }

  // RUNTIME LOG UI
  const railBox = document.getElementById('railwayLogBox');
  function appendRailLog(item){
    const div = document.createElement('div');
    div.className = 'log-line';
    const timeSpan = document.createElement('div');
    timeSpan.className = 'log-time';
    timeSpan.textContent = item.time;
    const levelSpan = document.createElement('div');
    levelSpan.className = item.level === 'error' ? 'log-level-error' : 'log-level-info';
    levelSpan.textContent = '[' + item.level.toUpperCase() + ']';
    const msgSpan = document.createElement('div');
    msgSpan.style.flex = '1';
    msgSpan.textContent = item.message;
    div.appendChild(timeSpan);
    div.appendChild(levelSpan);
    div.appendChild(msgSpan);
    railBox.appendChild(div);
    if(autoScroll) railBox.scrollTop = railBox.scrollHeight;
  }

  function clearRuntimeLogs(){
    railBox.innerHTML = '';
    // optionally clear server-side: not implemented (we keep history)
  }

  function toggleAutoScroll(){
    autoScroll = !autoScroll;
    document.getElementById('autoscrollBtn').textContent = 'Autoscroll: ' + (autoScroll ? 'ON' : 'OFF');
  }

  // SSE connection
  const es = new EventSource('/events');

  es.addEventListener('connected', e => {
    // initial connected
  });

  es.addEventListener('log', e => {
    // when server emits log events (ok/error), refresh the status-log snapshot
    fetch('/status-log').then(r=>r.json()).then(renderTables).catch(()=>{});
  });

  es.addEventListener('status', e => {
    try{
      const payload = JSON.parse(e.data);
      renderTables({ ok: lastSnapshot.ok || [], error: lastSnapshot.error || [], processing: payload.processing, queue_length: payload.queue_length });
    }catch(err){}
  });

  // our new runtime log event
  es.addEventListener('railway-log', e => {
    try{
      const payload = JSON.parse(e.data);
      appendRailLog(payload);
    }catch(err){}
  });

  // load initial snapshots
  fetch('/status-log').then(r=>r.json()).then(renderTables).catch(()=>{});
  fetch('/railway-log').then(r=>r.json()).then(list => {
    if(Array.isArray(list)) list.forEach(appendRailLog);
  }).catch(()=>{});

</script>
</body>
</html>`);
});

// Status-log endpoint (keberadaan tetap seperti semula)
app.get("/status-log",(req,res)=>{
  res.json({
    queue_length:queue.length,
    processing:Array.from(processing),
    ok:logOK,
    error:logError
  });
});

// ────────────── START SERVER & WORKERS ──────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log("🌐 Web server OK on port",PORT));
mainLoop();
