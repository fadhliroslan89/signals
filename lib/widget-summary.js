'use strict';
/** A public, read-only, small response for Android widget and Live screen.
 * Never exposes auth tokens, account values, journal, or recommends execution.
 */
const STABLES = new Set(['USDT','USDC','DAI','FDUSD','TUSD','USDD','USDE','PYUSD','USD1','EURC','BUSD']);
function finite(n){return typeof n==='number' && Number.isFinite(n);}
function cleanSymbol(s){return typeof s==='string' && /^[A-Z0-9]{1,20}-USDT$/.test(s);}
function makeWidgetSummary(state,{now=Date.now(),mock=false}={}) {
  const update = finite(state?.lastUpdate)?state.lastUpdate:0;
  const age = update ? now-update : Infinity;
  const fresh = age>=0 && age<=90000 && !state?.error;
  const gate = state?.marketRisk || {};
  const gateBlocked = !fresh || gate.allowBuys!==true;
  const status = gateBlocked?'NO_TRADE':'RESEARCH_ONLY';
  const reason = !fresh?'Harga KuCoin belum tersedia atau lebih 90s; tiada signal sah':String(gate.reason || 'Penilaian pasaran untuk pemerhatian sahaja').slice(0,160);
  const rows = fresh && Array.isArray(state?.rows)?state.rows:[];
  const top = rows.filter(r=> {
    const base = String(r?.symbol||'').split('-')[0];
    return cleanSymbol(r?.symbol)&&!STABLES.has(base)&&!/(?:3L|3S|2L|2S|UP|DOWN)$/.test(base)
      && finite(r?.score)&&finite(r?.volume)&&r.volume>=5_000_000&&finite(r?.spread)&&r.spread<=0.3
      && finite(r?.m15)&&Math.abs(r.m15)<=20&&finite(r?.price)&&r.price>0;
  }).sort((a,b)=>b.score-a.score||b.volume-a.volume).slice(0,3).map(r=>({
    symbol:r.symbol, score:Math.max(0,Math.min(100,Math.round(r.score))),
    status:['BUY','WATCH','AVOID','DATA'].includes(r.status)?r.status:'RADAR',
    m15:Math.round(r.m15*100)/100,
    price:r.price,
  }));
  return {
    version:'2.4.0-widget', source:mock?'DEMO':'KUCOIN_PUBLIC',
    generatedAt:now, updatedAt:update||null,
    marketFresh:fresh, ageSeconds:Number.isFinite(age)?Math.floor(age/1000):null,
    risk:{status, code:!fresh?'STALE_DATA':String(gate.code||'AUDIT_PAUSE').slice(0,50),reason, buyAllowed:!gateBlocked},
    pairs:Number(state?.allowed?.size||0), top,
    disclaimer:'Ringkasan untuk pemerhatian sahaja. Skor bukan kadar kemenangan dan tiada auto-order.'
  };
}
module.exports={makeWidgetSummary};
