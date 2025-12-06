// web.js - REALTIME URL DASHBOARD + FLASH NEW LOG
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

// ────────────── HELPERS ──────────────
function parseList(txt){return (txt||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);}
function isJson(body){try{JSON.parse(body); return true;}catch{return false;}}
function isCaptcha(body){if(!body) return false; const t=body.toLowerCase(); return t.includes("captcha")||t.includes("verify you are human")||t.includes("verification")||t.includes("robot")||t.includes("cloudflare");}
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const fetchText = async url => {try{const resp=await axios.get(url,{headers:{"User-Agent":"Mozilla/5.0"},timeout:20000,validateStatus:()=>true,responseType:"text"});return {ok:true,text:typeof resp.data==="string"?resp.data:JSON.stringify(resp.data)}}catch(e){return {ok:false,error:e.message}}};
const buildProxyUrl = u => `${CORS_PROXY}/${u}`;
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
  }catch(err){console.log("❌ ERROR refillQueue:",err.message);}
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
      const data = {url,status:`ERROR: ${e.message}`,time:ts};
      logError.push(data);
      broadcast("log",{type:"error",item:data,queue_length:queue.length,processing:Array.from(processing)});
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
  res.write(`event: connected\ndata: ${JSON.stringify({ts:new Date().toISOString()})}\n\n`);

  const listener=({event,payload})=>{
    try{
      const id=Date.now();
      res.write(`id:${id}\n`);
      res.write(`event:${event}\n`);
      res.write(`data:${JSON.stringify(payload)}\n\n`);
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
  res.setHeader("Content-disposition",`attachment; filename=${filename}`);
  res.setHeader("Content-Type","text/plain;charset=utf-8");
  res.send(txt);
});

// Dashboard HTML - realtime with flash
app.get("/dashboard",(req,res)=>{
  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Realtime URL Dashboard</title>
  <style>
    body{margin:0;font-family:Arial,sans-serif;background:#0d0d14;color:#e0e0e0;}
    h1{text-align:center;color:#00eaff;margin:12px 0;}
    .container{display:grid;grid-template-columns:1fr;gap:16px;padding:16px;}
    .card{background:#1a1a2e;border-radius:12px;padding:16px;}
    .badge{padding:4px 10px;border-radius:8px;font-size:13px;font-weight:700;margin-right:6px;}
    .ok{background:#00c853;color:#000;} 
    .err{background:#ff3d00;color:#fff;} 
    .processing{background:#ffa000;color:#000;} 
    .queue{background:#2979ff;color:#fff;}
    .flash-ok { animation: flashGreen 1.5s; }
    .flash-err { animation: flashRed 1.5s; }
    @keyframes flashGreen {0%{background-color:#00c853;color:#000;}50%{background-color:#b9f6ca;color:#000;}100%{background-color:#00c853;color:#000;}}
    @keyframes flashRed {0%{background-color:#ff3d00;color:#fff;}50%{background-color:#ff8a65;color:#000;}100%{background-color:#ff3d00;color:#fff;}}
    table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;}
    th,td{border:1px solid #333;padding:4px;}
    #queueList div{padding:6px;margin:3px;border-radius:6px;overflow-wrap:anywhere;}
    .filterBtn{padding:4px 10px;margin:2px;border-radius:6px;background:#2b2b3d;color:#fff;cursor:pointer;}
    .filterBtn.active{background:#00eaff;color:#000;font-weight:700;}
  </style></head><body>
  <h1>🔥 Realtime URL Runner 24/7</h1>
  <div class="container">
    <div class="card">
      <h2>Queue Status</h2>
      <div>
        <span class="badge processing">Processing: <span id="processingCount">0</span></span>
        <span class="badge ok">OK: <span id="okCount">0</span></span>
        <span class="badge err">Error: <span id="errCount">0</span></span>
        <span class="badge queue">Queue: <span id="queueCount">0</span></span>
      </div>
      <div>
        <button class="filterBtn active" data-filter="all">All</button>
        <button class="filterBtn" data-filter="processing">Processing</button>
        <button class="filterBtn" data-filter="ok">OK</button>
        <button class="filterBtn" data-filter="error">Error</button>
      </div>
      <div id="queueList" style="max-height:500px;overflow-y:auto;"></div>
      <div style="margin-top:8px;">
        <a href="/download-logs?type=ok" target="_blank">Download OK</a> |
        <a href="/download-logs?type=error" target="_blank">Download Error</a> |
        <a href="/download-logs?type=all" target="_blank">Download All</a>
      </div>
    </div>
  </div>
  <script>
    let currentFilter='all';
    let lastSnapshot={ok:[],error:[],processing:[],queue_length:0};
    document.querySelectorAll('.filterBtn').forEach(btn=>{
      btn.onclick=()=>{currentFilter=btn.dataset.filter;document.querySelectorAll('.filterBtn').forEach(b=>b.classList.remove('active'));btn.classList.add('active'); renderTables(lastSnapshot);}
    });
    function renderTables(snapshot){
      lastSnapshot=snapshot;
      const ok=snapshot.ok||[], err=snapshot.error||[], processing=snapshot.processing||[], queueLength=snapshot.queue_length||0;
      document.getElementById('processingCount').innerText=processing.length;
      document.getElementById('okCount').innerText=ok.length;
      document.getElementById('errCount').innerText=err.length;
      document.getElementById('queueCount').innerText=queueLength;

      let list=[];
      if(currentFilter==='all'||currentFilter==='processing') list.push(...processing.map(u=>({text:u,type:'processing'})));
      if(currentFilter==='all'||currentFilter==='ok') list.push(...ok.map(r=>({text:r.url,type:'ok',flash:true})));
      if(currentFilter==='all'||currentFilter==='error') list.push(...err.map(r=>({text:r.url,type:'err',flash:true})));

      const queueList=document.getElementById('queueList');
      queueList.innerHTML=list.map(item=>{
        const flashClass = item.flash ? (item.type==='ok' ? 'flash-ok' : item.type==='err' ? 'flash-err':'') : '';
       return `<div class="${item.type} ${flashClass}">[NEW] ${item.text}</div>`;
      }).join('');
      queueList.scrollTop = queueList.scrollHeight;
    }

    const es=new EventSource('/events');
    es.addEventListener('log',e=>{fetch('/status-log').then(r=>r.json()).then(renderTables);});
    es.addEventListener('status',e=>{const payload=JSON.parse(e.data); renderTables({ok:lastSnapshot.ok,error:lastSnapshot.error,processing:payload.processing,queue_length:payload.queue_length});});
    fetch('/status-log').then(r=>r.json()).then(renderTables);
  </script>
  </body></html>`);
});

// Status-log endpoint
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


