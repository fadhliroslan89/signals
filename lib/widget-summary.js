'use strict';
/** A public, read-only, small response for Android widget and Live screen.
 * Never exposes auth tokens, account values, journal, or recommends execution.
 */
function finite(n){return typeof n==='number' && Number.isFinite(n);}
function cleanSymbol(s){return typeof s==='string' && /^[A-Z0-9]{1,20}-USDT$/.test(s);}
// Same 70+ meaning as the full dashboard: either a MARKET score or a READY breakout score.
function eligibleScore(row){
  const market=finite(row?.score)&&row.score>=70&&row.score<=100?row.score:-1;
  const bo=row?.breakout;
  const breakout=bo?.coverage==='READY'&&finite(bo?.rank)&&bo.rank>=70&&bo.rank<=100?bo.rank:-1;
  return Math.max(market,breakout);
} 
function makeWidgetSummary(state,{now=Date.now(),mock=false}={}) {
  const update = finite(state?.lastUpdate)?state.lastUpdate:0;
  const age = update ? now-update : Infinity;
  const fresh = age>=0 && age<=90000 && !state?.error;
  const gate = state?.marketRisk || {};
  const gateBlocked = !fresh || gate.allowBuys!==true;
  const status = gateBlocked?'NO_TRADE':'RESEARCH_ONLY';
  const reason = !fresh?'Harga KuCoin belum tersedia atau lebih 90s; tiada signal sah':String(gate.reason || 'Penilaian pasaran untuk pemerhatian sahaja').slice(0,160);
  const rows = fresh && Array.isArray(state?.rows)?state.rows:[];
  // Match the website's 'Semua Skor 70+' selection: Market >=70 OR READY Breakout >=70.
  // Low liquidity / wide spread / AVOID are still observations, not BUY recommendations.
  const seen = new Set();
  const top = rows.filter(r=> {
    if (!cleanSymbol(r?.symbol) || seen.has(r.symbol) || eligibleScore(r)<70) return false;
    seen.add(r.symbol);
    return true;
  }).sort((a,b)=>eligibleScore(b)-eligibleScore(a)||Number(b.volume||0)-Number(a.volume||0)||a.symbol.localeCompare(b.symbol)).slice(0,5).map(r=>({
    symbol:r.symbol, score:Math.round(eligibleScore(r)),
    status:['BUY','WATCH','AVOID','DATA'].includes(r.status)?r.status:'RADAR',
    m15:finite(r.m15) ? Math.round(r.m15*100)/100 : null,
    price:finite(r.price) ? r.price : null,
  }));
  return {
    version:'2.5.0-widget-70-detail', source:mock?'DEMO':'KUCOIN_PUBLIC',
    generatedAt:now, updatedAt:update||null,
    marketFresh:fresh, ageSeconds:Number.isFinite(age)?Math.floor(age/1000):null,
    risk:{status, code:!fresh?'STALE_DATA':String(gate.code||'AUDIT_PAUSE').slice(0,50),reason, buyAllowed:!gateBlocked},
    pairs:Number(state?.allowed?.size||0), top,
    disclaimer:'Ringkasan untuk pemerhatian sahaja. Skor bukan kadar kemenangan dan tiada auto-order.'
  };
}
module.exports={makeWidgetSummary,eligibleScore};
