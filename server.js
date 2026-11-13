'use strict';
/**
 * KuCoin Scalping Radar — public spot market data only, no trade execution.
 * Node 20+ zero-dependency server. API secrets (optional Telegram) remain server-side.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { URL } = require('node:url');
const { DEFAULTS, rowFromTicker, number } = require('./lib/scanner');
const { evaluate: evaluateQuality } = require('./public/entry-quality');
const { gate: gateQuality70, MIN: MIN_SIGNAL_SCORE } = require('./public/quality70');
const { candlesFromKucoin, analyze: breakoutAnalyze } = require('./lib/breakout');
const { isExcluded: isHitrunExcluded } = require('./public/hitrun');
const { prioritizedSymbols } = require('./lib/priority');
const { createTelegramEngine, safeMode } = require('./lib/telegram-alerts');
const { assessMarket, guardRows } = require('./lib/market-risk-gate');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MOCK = process.env.MOCK_KUCOIN === '1';
const BASE = 'https://api.kucoin.com';
const POLL_MS = 20_000;
const HISTORY_MINUTES = 48;
const BOOTSTRAP_SPACING_MS = 650; // ~2.8 candle requests/sec; do not hammer the public API.
const publicDir = path.join(__dirname, 'public');
const HUNTER_LIMIT = 30;
const HUNTER_REFRESH_MS = 75_000;
const HUNTER_BOOTSTRAP_BATCH = 12; // Keep KuCoin requests modest while bulk history loads.
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT = process.env.TELEGRAM_CHAT_ID || '';
const telegramEnabled = !!(TELEGRAM_TOKEN && TELEGRAM_CHAT) && !MOCK;
const TELEGRAM_MODE = safeMode(process.env.TELEGRAM_ALERT_MODE || 'both');
const TELEGRAM_STARTUP_TEST = process.env.TELEGRAM_STARTUP_TEST === '1';
// Default OFF. Do NOT enable for real-money trading without out-of-sample validation.
const LIVE_BUY_ALERTS_ENABLED = process.env.RADAR_ENABLE_BUY_ALERTS === '1';
let telegramStartupTestSent = false;
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
  hunterCursor: 0,
  rows: [],
  marketRisk:{status:'NO_TRADE',allowBuys:false,code:'STARTING',reason:'Server sedang bermula; signal BUY dihentikan'},
  lastUpdate: 0,
  symbolsUpdated: 0,
  bootstrap: { done: 0, total: 0, failures: 0, active: false },
  error: null,
  syncing: false,
  startedAt: Date.now(),
  lastPollStarted: 0,
  lastPollFinished: 0,
  pollFailures: 0,
  lastPollDurationMs: 0,
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
  state.allowed = allowed;
  state.symbolsUpdated = Date.now();
  // Start the history load after the first ticker poll, so liquid pairs load first.
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
  const liquid=state.rows.filter(r=>r.volume>=cfg.minVolume && r.spread!==null && r.spread<=cfg.maxSpread && r.m15!==null);
  const priority=r=>r.score+Math.min(30,Math.max(0,r.m5||0)*28)+Math.min(16,Math.max(0,r.m1||0)*32);
  // v1.9: reserve 12 of the existing 30 OHLCV monitoring slots for fast 24h gainers.
  // No extra requests/second: only changes which pairs get refreshed.
  const gainers=state.rows.filter(r=>r.change24h>=10&&!isHitrunExcluded(r.symbol)
    && r.volume>=1_000_000 && r.spread!==null && r.spread<=.25 && r.m15!==null
    && (r.volume>=5_000_000 ? r.spread<=.15 : r.volume<5_000_000));
  gainers.sort((a,b)=>priority(b)-priority(a) || b.volume-a.volume);
  liquid.sort((a,b)=>priority(b)-priority(a) || b.volume-a.volume);
  const chosen=[...gainers.slice(0,12),...liquid];
  return [...new Set(chosen.map(r=>r.symbol))].slice(0,HUNTER_LIMIT);
}
function promoteBootstrapHunter() {
  // The bootstrap already fetched real OHLCV. Make it available to Breakout Hunter
  // immediately, without issuing more candle requests or waiting for 787 pairs.
  if (state.hunterSyncing) return;
  const chosen = hunterCandidates();
  const previous = [...state.hunterWatched];
  if (chosen.length !== previous.length || chosen.some((s, i) => s !== previous[i])) {
    state.hunterWatched = new Set(chosen);
    computeRows();
  }
}
async function refreshHunter(){
  if(state.hunterSyncing || !state.allowed.size)return;
  state.hunterSyncing=true;
  try{
    const chosen=hunterCandidates();
    state.hunterWatched=new Set(chosen);
    computeRows();
    // Bootstrap works through every market pair. Rotate through a small priority batch
    // concurrently instead of waiting for the entire bootstrap to finish.
    const count=state.bootstrap.active ? Math.min(HUNTER_BOOTSTRAP_BATCH,chosen.length) : chosen.length;
    const start=chosen.length ? state.hunterCursor % chosen.length : 0;
    const refreshSymbols=Array.from({length:count},(_,i)=>chosen[(start+i)%chosen.length]);
    state.hunterCursor=chosen.length ? (start+count)%chosen.length : 0;
    for(let i=0;i<refreshSymbols.length;i++){
      const symbol=refreshSymbols[i];
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
  const symbols = prioritizedSymbols(state.allowed, state.tickers);
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
    if (i % 10 === 0 || i === symbols.length - 1) {
      computeRows();
      promoteBootstrapHunter();
    }
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
      if(r){
        r.breakout=state.hunterWatched.has(r.symbol)?breakoutAnalyze(state.candles.get(r.symbol),now,cfg,r):{signal:'NONE',coverage:'NOT_MONITORED'};
        // v1.9 reuse completed OHLCV when available for dual-tier volume spike checks.
        // Unmonitored candles expire; never infer RVOL from a stale snapshot.
        r.hitrunOhlcv=(r.change24h>=9.5 && r.volume>=900_000)
          ?breakoutAnalyze(state.candles.get(r.symbol),now,{minVolume:0,maxSpread:100},r)
          :{coverage:'NOT_APPLICABLE'};
        r.entryQuality=gateQuality70(evaluateQuality(r,cfg,now),r.score);
        r.status=r.entryQuality.status;
      }
      return r;
    }).filter(Boolean)
    .sort((a,b) => b.score - a.score || b.volume - a.volume);
  state.marketRisk = assessMarket({rows:state.rows,updatedAt:state.lastUpdate,now,liveBuyAlertsEnabled:LIVE_BUY_ALERTS_ENABLED});
  state.rows = guardRows(state.rows,{marketRisk:state.marketRisk,now,requireVerifiedAge:true});
}
async function telegram(message) {
  if (!telegramEnabled) throw new Error('Telegram not configured');
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type':'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text: message, link_preview_options:{is_disabled:true} }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error(`Telegram HTTP ${response.status}: ${String(body?.description || 'sendMessage rejected').slice(0,120)}`);
  return body.result;
}
// Preserve the existing recent BUY activity list in the web dashboard even
// when Telegram credentials are not configured. Sending to Telegram is separate.
function recordBuyActivity() {
  if (!state.marketRisk.allowBuys) return;
  const now = Date.now();
  for (const r of state.rows) {
    if (r.status !== 'BUY' || r.score < MIN_SIGNAL_SCORE) continue;
    const last = state.alertState.get(r.symbol) || 0;
    if (now - last < cfg.cooldownMinutes * 60_000) continue;
    state.alertState.set(r.symbol, now);
    state.alertLog.unshift({ at:now, symbol:r.symbol, price:r.price, m15:r.m15, m30:r.m30, score:r.score });
    state.alertLog.length = Math.min(50, state.alertLog.length);
  }
}
const telegramEngine = createTelegramEngine({ send: telegram, mode: TELEGRAM_MODE });
async function processTelegram() {
  // Even a correctly configured Telegram token MUST NOT bypass the market gate.
  if (!telegramEnabled || !state.lastUpdate || state.error || !state.marketRisk.allowBuys) return;
  if (TELEGRAM_STARTUP_TEST && !telegramStartupTestSent) {
    telegramStartupTestSent = true; // Send once per process start; never loop on bad token.
    try {
      await telegram(`✅ KuCoin Radar — Telegram berjaya disambungkan.\nMod: ${TELEGRAM_MODE === 'both' ? 'BUY disahkan + RADAR 70+ (pemerhatian)' : 'BUY disahkan sahaja'}\nServer aktif pada ${new Date().toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur'})} MYT.\nIni mesej UJIAN, bukan signal trading.`);
      telegramEngine.recordTest();
    } catch (err) { telegramEngine.recordTestFailure(err); console.warn('Telegram startup test gagal:', err.message); }
  }
  // After 90 candles have been prepared, create observation baseline; newly
  // crossing 70+ may alert. Confirmed BUY does not wait for the bootstrap.
  const ready = !!state.bootstrap.total && state.bootstrap.done >= Math.min(90, state.bootstrap.total);
  const result = await telegramEngine.tick(state.rows, { ready });
  if (result?.error) console.warn('Telegram alert:', result.error);
}
async function poll() {
  if (state.syncing) return;
  state.syncing = true;
  state.lastPollStarted = Date.now();
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
    state.pollFailures = 0;
    computeRows();
    if (state.bootstrap.total === 0 && state.allowed.size) {
      // Do not await: ticker polling remains responsive while candles load.
      queueBootstrap().catch(err => {
        state.bootstrap.active = false;
        console.error('Bootstrap failed:', err.message);
      });
    }
    if (!MOCK) {
      recordBuyActivity();
      if (telegramEnabled) processTelegram().catch(err => console.warn('Telegram:', err.message));
    }
  } catch (err) {
    state.error = err.message;
    state.pollFailures += 1;
    console.error('KuCoin fetch:', err.message);
  } finally {
    state.lastPollFinished = Date.now();
    state.lastPollDurationMs = state.lastPollFinished - state.lastPollStarted;
    state.syncing = false;
  }
}
function json(res, obj, status = 200) {
  res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff'});
  res.end(JSON.stringify(obj));
}
// Compress the large market snapshot off the Node.js event loop on mobile connections.
// This improves transfer size but keeps all market data and journal semantics unchanged.
function sendStatus(req, res, data) {
  const body = JSON.stringify(data);
  const headers = {'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff', 'vary':'Accept-Encoding'};
  if (body.length < 4000 || !/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
    res.writeHead(200, headers); res.end(body); return;
  }
  zlib.gzip(body, {level:3}, (err, compressed) => {
    if(res.destroyed || res.writableEnded) return;
    if(err) {res.writeHead(200, headers); res.end(body); return;}
    res.writeHead(200, {...headers, 'content-encoding':'gzip'});
    res.end(compressed);
  });
}
function diagnostics() {
  const now=Date.now(), memory=process.memoryUsage();
  return {
    processAlive:true, marketFresh:state.lastUpdate>0 && now-state.lastUpdate<90_000,
    strategyVersion:'2.3.0-safety', now, marketRisk:state.marketRisk,
    uptimeSeconds:Math.round(process.uptime()),
    lastMarketUpdate:state.lastUpdate, marketAgeSeconds:state.lastUpdate?Math.round((now-state.lastUpdate)/1000):null,
    lastPollStarted:state.lastPollStarted, lastPollFinished:state.lastPollFinished,
    pollInProgress:state.syncing, lastPollDurationMs:state.lastPollDurationMs,
    consecutivePollFailures:state.pollFailures,
    activePairs:state.allowed.size, tickerCount:state.tickers.size,
    bootstrap:{done:state.bootstrap.done,total:state.bootstrap.total,active:state.bootstrap.active,failures:state.bootstrap.failures},
    hunter:{monitored:state.hunterWatched.size, failures:state.hunterFailures},
    memoryMB:{rss:Math.round(memory.rss/1048576), heapUsed:Math.round(memory.heapUsed/1048576)},
    marketError:state.error, demo:MOCK
  };
}
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
function serveFile(res, pathname) {
  const name = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!/^[a-zA-Z0-9._/-]+$/.test(name)) return json(res,{error:'Not found'},404);
  const resolved = path.resolve(publicDir, name);
  if (!resolved.startsWith(publicDir + path.sep)) return json(res,{error:'Not found'},404);
  fs.readFile(resolved, (err, contents) => {
    if (err) return json(res,{error:'Not found'},404);
    // PaperLab v1.1 uses an inline script/style and the public KuCoin price API.
    // Allow these only for the PaperLab HTML; scanner scripts stay restricted to self.
    // The scanner injects a local <style> for the PaperLab navigation button.
    const isPaperLabPage = pathname === '/paperlab/index.html';
    const isChartPage = pathname === '/chart/index.html';
    const isScannerPage = pathname === '/' || pathname === '/index.html';
    const csp = [
      "default-src 'self'",
      `script-src 'self'${isPaperLabPage ? " 'unsafe-inline'" : ''}`,
      `style-src 'self'${(isPaperLabPage || isScannerPage) ? " 'unsafe-inline'" : ''}`,
      "img-src 'self' data:",
      `connect-src 'self'${isPaperLabPage ? ' https://api.kucoin.com https://ldwfgsupmyykicdmfgjp.supabase.co' : ''}${isChartPage ? ' https://ldwfgsupmyykicdmfgjp.supabase.co' : ''}`,
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'"
    ].join('; ');
    const cacheControl = path.extname(resolved)==='.html' || name === 'sw.js' || name === 'startup.js' ? 'no-cache, must-revalidate' : 'public, max-age=300';
    res.writeHead(200, {'content-type':types[path.extname(resolved)] || 'application/octet-stream','cache-control':cacheControl,'x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':csp });
    res.end(contents);
  });
}
// === KuCoin Radar live OHLCV chart: public spot candles, no exchange orders ===
const chartIntervals = Object.freeze({ '1m':['1min',60], '5m':['5min',300], '15m':['15min',900], '30m':['30min',1800], '1h':['1hour',3600], '4h':['4hour',14400] });
const chartCache = new Map();
const chartInflight = new Map();
const CHART_CACHE_MS = 15_000;
function normalizeChartCandles(raw, limit = 115) {
  if (!Array.isArray(raw)) return [];
  return raw.map(x => {
    if (!Array.isArray(x) || x.length < 6) return null;
    const [t,o,c,h,l,v] = x.map(Number);
    if (![t,o,c,h,l,v].every(Number.isFinite) || t <= 0 || o <= 0 || c <= 0 || l <= 0 || h <= 0 || v < 0 || h < Math.max(o,c,l) || l > Math.min(o,c,h)) return null;
    return {time:t*1000,open:o,high:h,low:l,close:c,volume:v};
  }).filter(Boolean).sort((a,b)=>a.time-b.time).slice(-limit);
}
function fakeChartCandles(symbol,seconds) {
  const n=105, at=Math.floor(Date.now()/(1000*seconds))*(1000*seconds);
  const last=number(state.tickers.get(symbol)?.last)||10;
  const seed=symbol.split('').reduce((a,ch)=>a+ch.charCodeAt(0),0);
  const out=[];
  for(let i=0;i<n;i++){
    const ratio=1+0.015*Math.sin((i+seed)/11)+0.004*Math.sin((i+seed)/3);
    const previous=1+0.015*Math.sin((i+seed-1)/11)+0.004*Math.sin((i+seed-1)/3);
    const close=last*ratio, open=last*previous;
    out.push({time:at-(n-1-i)*seconds*1000,open,close,high:Math.max(open,close)*1.002,low:Math.min(open,close)*0.998,volume:100+((seed+i*37)%220)});
  }
  return out;
}
async function serveChart(res,url) {
  const limit = url.searchParams.get('limit') === '320' ? 320 : 115;
  const symbol=String(url.searchParams.get('symbol')||'').trim().toUpperCase();
  const timeframe=String(url.searchParams.get('tf')||'30m').trim();
  if(!/^[A-Z0-9]{1,20}-USDT$/.test(symbol) || !Object.prototype.hasOwnProperty.call(chartIntervals,timeframe))
    return json(res,{error:'Pair atau timeframe tidak sah.'},400);
  if(!state.allowed.has(symbol)) return json(res,{error:'Pair tidak aktif / belum tersedia.'},404);
  const ticker=state.tickers.get(symbol);
  const lastPrice=number(ticker?.last);
  const ageMs=Date.now()-state.lastUpdate;
  if(!(lastPrice>0) || !state.lastUpdate || ageMs>90_000)
    return json(res,{error:'Data pasaran belum sedia atau terlalu lama.'},503);
  const cacheKey=symbol+':'+timeframe+':'+limit, now=Date.now();
  let hit=chartCache.get(cacheKey);
  if(!hit || now-hit.fetchedAt>=CHART_CACHE_MS) {
    try {
      let task=chartInflight.get(cacheKey);
      if(!task) {
        task=(async()=>{
          const [type,seconds]=chartIntervals[timeframe];
          let candles;
          if(MOCK) candles=fakeChartCandles(symbol,seconds).slice(-limit);
          else {
            const endAt=Math.floor(Date.now()/1000);
            const startAt=endAt-seconds*(limit+10);
            const raw=await getKucoin(`/api/v1/market/candles?type=${type}&symbol=${encodeURIComponent(symbol)}&startAt=${startAt}&endAt=${endAt}`);
            candles=normalizeChartCandles(raw,limit);
          }
          if(!candles.length) throw new Error('Tiada candle untuk pair atau timeframe ini.');
          const fresh={candles,fetchedAt:Date.now()};
          chartCache.set(cacheKey,fresh);
          if(chartCache.size>240){ const first=chartCache.keys().next().value; chartCache.delete(first); }
          return fresh;
        })();
        chartInflight.set(cacheKey,task);
        task.finally(()=>chartInflight.delete(cacheKey)).catch(()=>{});
      }
      hit=await task;
    } catch (err) {
      if(!hit || Date.now()-hit.fetchedAt>120_000) return json(res,{error:'Gagal mengambil candle KuCoin: '+String(err.message||'').slice(0,100)},503);
    }
  }
  return json(res,{
    symbol,timeframe,candles:hit.candles,
    lastPrice,ask:number(ticker?.sell)||null,
    latestStatus:state.rows.find(r=>r.symbol===symbol)?.status||'DATA',
    lastPriceUpdatedAt:state.lastUpdate,ageSeconds:Math.floor(ageMs/1000),
    chartFetchedAt:hit.fetchedAt,chartAgeSeconds:Math.floor((Date.now()-hit.fetchedAt)/1000),
    mock:MOCK,source:MOCK?'DEMO':'KuCoin Spot public OHLCV',
    note:'Candle terkini masih terbentuk. Kemas kini sekitar 20s; bukan tick-by-tick atau harga eksekusi.'
  });
}
// === End chart module ===

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res,{error:'Method not allowed'},405);
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname === '/api/status') return sendStatus(req,res,{
    strategyVersion:'2.3.0-safety', marketRisk:state.marketRisk, buyAlertsEnabled:LIVE_BUY_ALERTS_ENABLED, updatedAt:state.lastUpdate, now:Date.now(), pairs:state.allowed.size, fetched:state.rows.length,
    bootstrap:state.bootstrap, error:state.error, mock:MOCK, telegramEnabled, telegram: { configured: telegramEnabled, ...telegramEngine.status() }, defaults:cfg,
    hunter:{monitored:state.hunterWatched.size,ready:state.rows.filter(r => r.breakout?.coverage === 'READY').length,limit:HUNTER_LIMIT,lastRefreshed:state.hunterLastRefresh,failures:state.hunterFailures},
    alerts:state.alertLog.slice(0,12), rows:state.rows,
  });
  // PaperLab live quote: reuse the latest ticker already fetched by KuCoin Radar.
  // This avoids browser-side CORS errors, extra upstream requests and API secrets.
  if (url.pathname === '/api/price') {
    const symbol = String(url.searchParams.get('symbol') || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{2,20}-USDT$/.test(symbol)) {
      return json(res, {error:'Format pair tidak sah. Gunakan COIN-USDT.'}, 400);
    }
    if (!state.allowed.has(symbol)) {
      return json(res, {error:'Pair ini tidak aktif / tidak ditemui dalam KuCoin Radar.'}, 404);
    }
    const ticker = state.tickers.get(symbol);
    const lastPrice = number(ticker?.last);
    const ageMs = Date.now() - state.lastUpdate;
    if (!(lastPrice > 0) || !state.lastUpdate || ageMs > 90_000) {
      return json(res, {error:'Harga belum tersedia atau terlalu lama. Cuba semula apabila scanner selesai mengemas kini.'}, 503);
    }
    const bestAsk = number(ticker.sell);
    return json(res, {
      symbol, price:lastPrice, ask:bestAsk>0?bestAsk:null,
      updatedAt:state.lastUpdate, ageSeconds:Math.max(0,Math.floor(ageMs/1000)),
      source:MOCK?'DEMO':'KuCoin public market ticker', mock:MOCK,
      note:'Last traded price, bukan harga execution yang dijamin.'
    });
  }
  if (url.pathname === '/api/chart') { void serveChart(res,url); return; }
  if (url.pathname === '/api/history') {
    const symbol = url.searchParams.get('symbol') || '';
    if (!state.allowed.has(symbol)) return json(res,{error:'Symbol not found'},404);
    const records = [...(state.histories.get(symbol) || [])].sort((a,b)=>a[0]-b[0]).map(([time,price])=>({time,price}));
    return json(res,{symbol,points:records});
  }
  // Health is a light-weight HTTP probe independent of KuCoin history bootstrap.
  // Status HTTP 200 means Node responds; ok/marketFresh indicate market readiness.
  if (url.pathname === '/api/health') return json(res, {
    ok:!!state.lastUpdate && Date.now()-state.lastUpdate<90_000,
    processAlive:true, marketFresh:!!state.lastUpdate && Date.now()-state.lastUpdate<90_000,
    lastUpdate:state.lastUpdate, error:state.error, uptimeSeconds:Math.round(process.uptime()),
    pollInProgress:state.syncing, bootstrapDone:state.bootstrap.done, bootstrapTotal:state.bootstrap.total, marketRisk:state.marketRisk
  });
  if (url.pathname === '/api/diagnostics') return json(res, diagnostics());
  // Resolve the folder URL to PaperLab's HTML entry point.
  if (url.pathname === '/chart' || url.pathname === '/chart/') return serveFile(res, '/chart/index.html');
  if (url.pathname === '/paperlab' || url.pathname === '/paperlab/') {
    return serveFile(res, '/paperlab/index.html');
  }
  return serveFile(res, url.pathname);
});
server.listen(PORT, HOST, () => {
  console.log(`KuCoin Radar v2.0 chart workspace: http://localhost:${PORT}${MOCK?' [DEMO DATA]':''}`);
  poll();
  setInterval(poll, POLL_MS).unref();
  setInterval(()=>refreshHunter().catch(e=>console.error('Hunter refresh:',e.message)),HUNTER_REFRESH_MS).unref();
  // Render Free may spin down; heartbeat distinguishes a sleeping instance from a live
  // instance whose KuCoin API is failing. No private keys/tokens are logged.
  setInterval(()=>{
    const d=diagnostics();
    console.log(`[heartbeat] uptime=${d.uptimeSeconds}s marketFresh=${d.marketFresh} pairs=${d.activePairs} bootstrap=${d.bootstrap.done}/${d.bootstrap.total} rss=${d.memoryMB.rss}MB pollFailures=${d.consecutivePollFailures} ${d.marketError ? 'marketError='+String(d.marketError).slice(0,80) : ''}`);
  },60_000).unref();
});
module.exports = { server, state, poll, computeRows };