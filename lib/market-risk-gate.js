'use strict';
/**
 * Market-wide NO TRADE gate for spot research only. Fail closed. No order execution.
 * Inputs are public KuCoin ticker/candle samples, NOT verified account P&L or trade fills.
 * Thresholds are hypotheses pending out-of-sample validation, not risk guarantees.
 */
const DEFAULTS = Object.freeze({
  maxDataAgeMs:90_000,
  minBreadthSamples:25,
  minBreadthVolumeUSDT:1_000_000,
  maxNegative15mFraction:.60,
  minBtc1mPct:-.25,
  minBtc5mPct:-.40,
  minBtc15mPct:-.80,
  minListingAgeDays:7,
  maxCandidate1mDropPct:-.20,
  maxDailyDrawdownPct:2,
  maxConsecutiveLosses:2,
});
const num=n=>typeof n==='number'&&Number.isFinite(n);
const blocked=(code,reason,extra={})=>({status:'NO_TRADE',allowBuys:false,code,reason,...extra});
const STABLES=new Set(['USDT','USDC','DAI','FDUSD','TUSD','USDD','USDE','PYUSD','USD1','EURC','BUSD']);
function assessMarket({rows=[],updatedAt=0,now=Date.now(),config={},riskLedger=null,liveBuyAlertsEnabled=false}={}){
  const c={...DEFAULTS,...config};
  if(!num(updatedAt)||updatedAt<=0||updatedAt>now+5000||now-updatedAt>c.maxDataAgeMs)
    return blocked('STALE_DATA','Data KuCoin belum lengkap atau sudah lapuk');
  const btc=rows.find(r=>r.symbol==='BTC-USDT');
  if(!btc||![btc.m1,btc.m5,btc.m15].every(num))
    return blocked('BTC_NOT_READY','Sejarah 1m/5m/15m BTC belum lengkap');
  if(btc.m1<=c.minBtc1mPct||btc.m5<=c.minBtc5mPct||btc.m15<=c.minBtc15mPct)
    return blocked('BTC_SELL_PRESSURE',`BTC mengalami tekanan jual (1m ${btc.m1.toFixed(2)}%, 5m ${btc.m5.toFixed(2)}%, 15m ${btc.m15.toFixed(2)}%)`);
  const liquid=rows.filter(r=>num(r.volume)&&r.volume>=c.minBreadthVolumeUSDT&&num(r.m15));
  if(liquid.length<c.minBreadthSamples)
    return blocked('BREADTH_NOT_READY',`Data breadth belum cukup (${liquid.length}/${c.minBreadthSamples} coin cair)`);
  const negative15mFraction=liquid.filter(r=>r.m15<0).length/liquid.length;
  if(negative15mFraction>=c.maxNegative15mFraction)
    return blocked('MARKET_BREADTH_BEARISH',`${(negative15mFraction*100).toFixed(0)}% coin cair menunjukkan momentum 15m negatif`,{sampleCount:liquid.length,negative15mFraction});
  if(riskLedger){
    if(!num(riskLedger.dailyDrawdownPct)||!num(riskLedger.consecutiveLosses))
      return blocked('RISK_LEDGER_INCOMPLETE','Rekod kerugian akaun tidak lengkap');
    if(riskLedger.dailyDrawdownPct>=c.maxDailyDrawdownPct||riskLedger.consecutiveLosses>=c.maxConsecutiveLosses)
      return blocked('CIRCUIT_BREAKER','Had kerugian harian atau loss berturut-turut dicapai');
  }
  if(!liveBuyAlertsEnabled)
    return blocked('AUDIT_PAUSE','BUY dan Telegram BUY sengaja dihentikan semasa audit; penapis pasaran sahaja tidak membuktikan strategi menguntungkan',{sampleCount:liquid.length,negative15mFraction});
  return {status:'RESEARCH_ONLY',allowBuys:true,code:'MARKET_FILTERS_PASSED',reason:'Penapis pasaran lulus; bukan jaminan kemenangan',sampleCount:liquid.length,negative15mFraction};
}
function assessCandidate(row,{now=Date.now(),listingAt=null,requireVerifiedAge=true}={}){
  if(!row||!row.symbol)return blocked('MISSING_COIN','Data coin tidak lengkap');
  const base=String(row.symbol).split('-')[0].toUpperCase();
  if(STABLES.has(base))return blocked('STABLECOIN','Stablecoin dikecualikan');
  if(/(?:3L|3S|2L|2S|UP|DOWN)$/.test(base))return blocked('LEVERAGED_TOKEN','Token leveraged dikecualikan');
  // Coin listing age is not present in the current public symbols payload. Never invent it.
  if(requireVerifiedAge&&(!num(listingAt)||listingAt<=0))return blocked('AGE_UNVERIFIED','Umur listing coin tidak dapat disahkan daripada data yang tersedia');
  if(num(listingAt)&&(listingAt>now||now-listingAt<DEFAULTS.minListingAgeDays*86_400_000))
    return blocked('NEW_LISTING','Coin belum mempunyai 7 hari rekod dagangan yang disahkan');
  if(!num(row.m1)||row.m1<=DEFAULTS.maxCandidate1mDropPct)
    return blocked('SHORT_TERM_DUMP','Pergerakan 1 minit terlalu lemah');
  return {status:'RESEARCH_ONLY',allowBuys:true,code:'CANDIDATE_FILTERS_PASSED',reason:'Penapis coin lulus, bukan cadangan beli'};
}
function guardRows(rows,{marketRisk,now=Date.now(),listingAgeMap=null,requireVerifiedAge=true}={}){
  const list=Array.isArray(rows)?rows:[];
  return list.map(r=>{
    if(!r||r.status!=='BUY')return r;
    const listingAt=listingAgeMap instanceof Map?listingAgeMap.get(r.symbol):null;
    const coin=assessCandidate(r,{now,listingAt,requireVerifiedAge});
    if(marketRisk?.allowBuys&&coin.allowBuys)return {...r,riskCandidate:coin};
    const why=!marketRisk?.allowBuys ? (marketRisk?.reason||'Market Risk Gate tidak tersedia') : coin.reason;
    return {...r,status:'AVOID',riskCandidate:coin,entryQuality:{...r.entryQuality,status:'AVOID',reason:`NO TRADE: ${why}`}};
  });
}
module.exports={DEFAULTS,assessMarket,assessCandidate,guardRows};
