'use strict';
/**
 * KuCoin Scalping Radar — public spot market data only, no trade execution.
 * Node 20+ zero-dependency server. API secrets (optional Telegram) remain server-side.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { DEFAULTS, rowFromTicker, number } = require('./lib/scanner');
const { candlesFromKucoin, analyze: breakoutAnalyze } = require('./lib/breakout');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MOCK = process.env.MOCK_KUCOIN === '1';
const BASE = 'https://api.kucoin.com';
const POLL_MS = 20_000;
const HISTORY_MINUTES = 48;
const BOOTSTRAP_SPACING_MS = 360; // ~2.8 candle requests/sec; do not hammer the public API.
const publicDir = path.join(__dirname, 'public');
const HUNTER_LIMIT = 30;
const HUNTER_REFRESH_MS = 75_000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT = process.env.TELEGRAM_CHAT_ID || '';
const telegramEnabled = !!(TELEGRAM_TOKEN && TELEGRAM_CHAT) && !MOCK;
const cfg = { ...DEFAULTS };
const state = {
  allowed: new Set(),
  tickers: new Map(),
  histories: new Map(),
  candles: new Map(),
  hunterWatched: new Set(),
  hunterLastRefresh: 0,
  hunterFailures: 0,
  hunterSyncing: false,
  rows: [],
  lastUpdate: 0,
  symbolsUpdated: 0,
  bootstrap: { done: 0, total: 0, failures: 0, active: false },
  error: null,
  syncing: false,
  startedAt: Date.now(),
  alertState: new Map(),
  alertLog: [],
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function getKucoin(endpoint) {
  const response = await fetch(`${BASE}${endpoint}`, { signal: AbortSignal.timeout(13_000), headers: { 'accept': 'application/json' } });
  if (!response.ok) throw new Error(`KuCoin HTTP ${response.status}${response.status === 429 ? ' (rate limited)' : ''}`);
  const payload = await response.json();
  if (payload.code !== '200000') throw new Error(`KuCoin API ${payload.code || 'unknown'}`);
  return payload.data;
}
const mockSymbols = ['BTC', 'ETH', 'SOL', 'DOGE', 'SUI', 'AVAX', 'LINK', 'XRP', 'ADA', 'PEPE', 'DOT', 'NEAR', 'TRX', 'ATOM'].map(base => ({symbol: `${base}-USDT`, quoteCurrency:'USDT', enableTrading:true}));
function mockTicker(t, index, now) {
  const bases = [68600, 3420, 165, .21, 2.2, 31, 17, 2.6, .7, .0000102, 3.9, 7, .28, 6.5];
  const price = bases[index] * (1 + .003 * Math.sin(now / 250000 + index));
  const sp = .0005 + index * .000025;
  return {symbol:t.symbol, last:String(price), buy:String(price * (1-sp/2)), sell:String(price*(1+sp/2)),volValue:String(index < 8 ? 9_000_000+index*800_000:2_000_000),changeRate:String(.006*(index-3))};
}
function mockHistory(index, now) {
  // Synthetic history only for offline UI testing. Explicitly labeled DEMO on dashboard.
  const records = new Map();
  const ticker = mockTicker(mockSymbols[index],index,now);
  const live = Number(ticker.last);
  const profile = index === 2 ? [0.50,1.65,2.40] : index === 4 ? [0.12,0.77,1.22] : index === 5 ? [0.33,1.20,1.72] : [0.02,0.10,0.16];
  const end = Math.floor(now / 60_000) * 60_000;
  for (let i = 55; i >= 1; i--) {
    // Piecewise interpolation: the newest 5m and 15m trend can accelerate.
    const m = i <= 5 ? profile[0]*i/5
      : i <= 15 ? profile[0]+(profile[1]-profile[0])*(i-5)/10
      : i <= 30 ? profile[1]+(profile[2]-profile[1])*(i-15)/15
      : profile[2]+(i-30)*0.025;
    records.set(end - i*60_000 + 60_000, live/(1+m/100));
  }
  return records;
}
async function symbolsRefresh() {
  const listed = MOCK ? mockSymbols : await getKucoin('/api/v2/symbols');
  const allowed = new Set(listed.filter(s => s.quoteCurrency === 'USDT' && s.enableTrading === true && s.symbol.endsWith('-USDT') && !s.st && !s.callauctionIsEnabled).map(s => s.symbol));
  if (!allowed.size) throw new Error('Tiada simbol KuCoin USDT aktif dalam respons.');
  const wasEmpty = state.allowed.size === 0;
  state.allowed = allowed;
  state.symbolsUpdated = Date.now();
  if (wasEmpty) queueBootstrap();
}
function appendPrice(symbol, time, price) {
  if (!(price > 0)) return;
  let history = state.histories.get(symbol);
  if (!history) { history = new Map(); state.histories.set(symbol, history); }
  history.set(time, price);
  const oldest = Date.now() - HISTORY_MINUTES * 60_000;
  for (const at of history.keys()) if (at < oldest) history.delete(at);
}
function recordCandles(symbol, raw) {
  const now=Date.now();
  const parsed=candlesFromKucoin(raw,now);
  let map=state.candles.get(symbol);
  if(!map){map=new Map();state.candles.set(symbol,map);}
  for(const bar of parsed){
    appendPrice(symbol,bar.at,bar.close);
    map.set(bar.at,bar);
  }
  for(const at of map.keys()) if(at < now-HISTORY_MINUTES*60_000)map.delete(at);
}
function mockCandles(symbol,index,now){
  const hist=mockHistory(index,now);
  const closes=[...hist].sort((a,b)=>a[0]-b[0]);
  const map=new Map();let prev=null;
  for(const [at,close] of closes){
    const open=prev||close;
    map.set(at,{at,open,close,high:Math.max(open,close)*1.0002,low:Math.min(open,close)*0.9998,volume:120+(index%5)*12+(Math.floor(at/60_000)%7)*8});
    prev=close;
  }
  state.candles.set(symbol,map);
}
function hunterCandidates(){
  return [...state.rows]
    .filter(r=>r.volume>=cfg.minVolume && r.spread!==null && r.spread<=cfg.maxSpread && r.m15!==null)
    .sort((a,b)=>{
      const priority=r=>r.score+Math.min(30,Math.max(0,r.m5||0)*28)+Math.min(16,Math.max(0,r.m1||0)*32);
      return priority(b)-priority(a)||b.volume-a.volume;
    })
    .slice(0,HUNTER_LIMIT).map(r=>r.symbol);
}
async function refreshHunter(){
  if(state.hunterSyncing || state.bootstrap.active || !state.allowed.size)return;
  state.hunterSyncing=true;
  try{
    const chosen=hunterCandidates();
    state.hunterWatched=new Set(chosen);
    computeRows();
    for(let i=0;i<chosen.length;i++){
      const symbol=chosen[i];
      try{
        if(MOCK){const index=mockSymbols.findIndex(s=>s.symbol===symbol); if(index>=0)mockCandles(symbol,index,Date.now());}
        else {
          const endAt=Math.floor(Date.now()/1000);
          const candles=await getKucoin(`/api/v1/market/candles?type=1min&symbol=${encodeURIComponent(symbol)}&startAt=${endAt-(HISTORY_MINUTES+2)*60}&endAt=${endAt}`);
          recordCandles(symbol,candles);
        }
      }catch(err){state.hunterFailures++;if(state.hunterFailures<5) console.warn('Hunter candle:',symbol,err.message);if(String(err.message).includes('429'))await pause(5_000);}
      if(i%5===4)computeRows();
      await pause(MOCK?1:850);
    }
    state.hunterLastRefresh=Date.now();
    computeRows();
  } finally {state.hunterSyncing=false;}
}
async function queueBootstrap() {
  if (state.bootstrap.active) return;
  state.bootstrap.active = true;
  const symbols = [...state.allowed];
  state.bootstrap.total = symbols.length;
  state.bootstrap.done = 0;
  state.bootstrap.failures = 0;
  // Spread one request per pair over a few minutes. All symbols eventually get 1m history.
  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    try {
      if (MOCK) {
        state.histories.set(symbol, mockHistory(i, Date.now()));
        mockCandles(symbol,i,Date.now());
      } else {
        const endAt = Math.floor(Date.now()/1000);
        const startAt = endAt - (HISTORY_MINUTES + 2)*60;
        const candles = await getKucoin(`/api/v1/market/candles?type=1min&symbol=${encodeURIComponent(symbol)}&startAt=${startAt}&endAt=${endAt}`);
        recordCandles(symbol, candles);
      }
    } catch (err) {
      state.bootstrap.failures++;
      if (state.bootstrap.failures <= 3) console.warn('Kline:', symbol, err.message);
      if (String(err.message).includes('429')) await pause(9_000);
    }
    state.bootstrap.done++;
    if (i % 20 === 0) computeRows();
    await pause(MOCK ? 2 : BOOTSTRAP_SPACING_MS);
  }
  state.bootstrap.active = false;
  computeRows();
  refreshHunter().catch(e=>console.error('Hunter refresh:',e.message));
}
function computeRows() {
  const now = Date.now();
  state.rows = [...state.tickers.values()].filter(t => state.allowed.has(t.symbol))
    .map(t => {
      const r=rowFromTicker(t,state.histories.get(t.symbol),now,cfg);
      if(r)r.breakout=state.hunterWatched.has(r.symbol)?breakoutAnalyze(state.candles.get(r.symbol),now,cfg,r):{signal:'NONE',coverage:'NOT_MONITORED'};
      return r;
    }).filter(Boolean)
    .sort((a,b) => b.score - a.score || b.volume - a.volume);
}
async function telegram(message) {
  if (!telegramEnabled) return;
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: {'content-type':'application/json'},
    body: JSON.stringify({chat_id: TELEGRAM_CHAT, text:message, disable_web_page_preview:true}),
    signal: AbortSignal.timeout(9000)
  });
  if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`);
}
function processAlerts() {
  const now = Date.now();
  let sent = 0;
  for (const r of state.rows) {
    if (r.status !== 'BUY') continue;
    if (sent >= 4) break;
    const last = state.alertState.get(r.symbol) || 0;
    if (now - last < cfg.cooldownMinutes*60_000) continue;
    state.alertState.set(r.symbol, now);
    const alert = {at: now, symbol:r.symbol, price:r.price, m15:r.m15, m30:r.m30, score:r.score};
    state.alertLog.unshift(alert);
    state.alertLog.length = Math.min(50, state.alertLog.length);
    sent++;
    if (telegramEnabled) {
      const message = `🔔 KUCOIN SCALPING RADAR (signal kajian, bukan nasihat beli)\n${r.symbol} • BUY\nHarga: ${r.price}\n15m: ${r.m15.toFixed(2)}% | 30m: ${r.m30.toFixed(2)}%\nSpread: ${r.spread.toFixed(3)}%\nSasaran ilustrasi: +${cfg.target}% | SL: -${cfg.stop}%\nSemak sebelum entry: https://www.kucoin.com/trade/${r.symbol}`;
      telegram(message).catch(e => console.error('Telegram gagal:', e.message));
    }
  }
}
async function poll() {
  if (state.syncing) return;
  state.syncing = true;
  try {
    if (state.allowed.size === 0 || Date.now() - state.symbolsUpdated > 60*60_000) await symbolsRefresh();
    const now = Date.now();
    const tickerList = MOCK ? mockSymbols.map((s,i)=>mockTicker(s,i,now)) : (await getKucoin('/api/v1/market/allTickers')).ticker;
    for (const ticker of tickerList) {
      if (!state.allowed.has(ticker.symbol)) continue;
      if (!(number(ticker.last) > 0)) continue;
      state.tickers.set(ticker.symbol, ticker);
      appendPrice(ticker.symbol, now, Number(ticker.last));
    }
    state.lastUpdate = now;
    state.error = null;
    computeRows();
    if (!MOCK) processAlerts();
  } catch (err) {
    state.error = err.message;
    console.error('KuCoin fetch:', err.message);
  } finally { state.syncing = false; }
}
function json(res, obj, status = 200) {
  res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff'});
  res.end(JSON.stringify(obj));
}
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
function serveFile(res, pathname) {
  const name = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!/^[a-zA-Z0-9._/-]+$/.test(name)) return json(res,{error:'Not found'},404);
  const resolved = path.resolve(publicDir, name);
  if (!resolved.startsWith(publicDir + path.sep)) return json(res,{error:'Not found'},404);
  fs.readFile(resolved, (err, contents) => {
    if (err) return json(res,{error:'Not found'},404);
    res.writeHead(200, {'content-type':types[path.extname(resolved)] || 'application/octet-stream','cache-control':'public, max-age=300','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" });
    res.end(contents);
  });
}
const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res,{error:'Method not allowed'},405);
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname === '/api/status') return json(res,{
    updatedAt:state.lastUpdate, now:Date.now(), pairs:state.allowed.size, fetched:state.rows.length,
    bootstrap:state.bootstrap, error:state.error, mock:MOCK, telegramEnabled, defaults:cfg,
    hunter:{monitored:state.hunterWatched.size,limit:HUNTER_LIMIT,lastRefreshed:state.hunterLastRefresh,failures:state.hunterFailures},
    alerts:state.alertLog.slice(0,12), rows:state.rows,
  });
  if (url.pathname === '/api/history') {
    const symbol = url.searchParams.get('symbol') || '';
    if (!state.allowed.has(symbol)) return json(res,{error:'Symbol not found'},404);
    const records = [...(state.histories.get(symbol) || [])].sort((a,b)=>a[0]-b[0]).map(([time,price])=>({time,price}));
    return json(res,{symbol,points:records});
  }
  if (url.pathname === '/api/health') return json(res, {ok:!!state.lastUpdate && Date.now()-state.lastUpdate<90_000, lastUpdate:state.lastUpdate, error:state.error});
  return serveFile(res, url.pathname);
});
server.listen(PORT, HOST, () => {
  console.log(`KuCoin Radar: http://localhost:${PORT}${MOCK?' [DEMO DATA]':''}`);
  poll();
  setInterval(poll, POLL_MS).unref();
  setInterval(()=>refreshHunter().catch(e=>console.error('Hunter refresh:',e.message)),HUNTER_REFRESH_MS).unref();
});
module.exports = { server, state, poll, computeRows };
