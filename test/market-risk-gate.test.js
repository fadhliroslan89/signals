'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assessMarket,assessCandidate,guardRows}=require('../lib/market-risk-gate');
const NOW=Date.UTC(2026,10,13,0,0,0);
function sample({btc1=.1,btc5=.3,btc15=.7,negative=0,volume=2_000_000,n=40}={}) {
  return [{symbol:'BTC-USDT',m1:btc1,m5:btc5,m15:btc15,volume:60e9},...Array.from({length:n},(_,i)=>({symbol:`COIN${i}-USDT`,m1:.2,m5:.5,m15:i<negative?-.8:.7,volume}))];
}
const check=(rows,other={})=>assessMarket({rows,now:NOW,updatedAt:NOW-20_000,liveBuyAlertsEnabled:true,...other});
test('gate OFF by default even in a clean market',()=>{
  const r=assessMarket({rows:sample(),now:NOW,updatedAt:NOW-20_000});
  assert.equal(r.allowBuys,false);assert.equal(r.code,'AUDIT_PAUSE');
});
test('BTC crash blocks the market despite bullish altcoins',()=>{
  const r=check(sample({btc1:-.5,btc5:-2,btc15:-3}));
  assert.equal(r.code,'BTC_SELL_PRESSURE');assert.equal(r.status,'NO_TRADE');
});
test('negative breadth blocks even when BTC is green',()=>{
  const r=check(sample({negative:28}));assert.equal(r.code,'MARKET_BREADTH_BEARISH');assert.ok(r.negative15mFraction>=.6);
});
test('stale price data fails closed',()=>{
  const r=check(sample(),{updatedAt:NOW-120_000});assert.equal(r.code,'STALE_DATA');
});
test('uninitialized BTC history fails closed',()=>{
  const r=check(sample().filter(x=>x.symbol!=='BTC-USDT'));assert.equal(r.code,'BTC_NOT_READY');
});
test('insufficient liquid breadth fails closed',()=>{
  const r=check(sample({n:12}));assert.equal(r.code,'BREADTH_NOT_READY');
});
test('reported daily loss halts market, but no account loss is inferred',()=>{
  const r=check(sample(),{riskLedger:{dailyDrawdownPct:3,consecutiveLosses:0}});assert.equal(r.code,'CIRCUIT_BREAKER');
  const missing=check(sample());assert.equal(missing.code,'MARKET_FILTERS_PASSED');
});
test('stablecoins and leveraged tokens cannot be aggressive BUY',()=>{
  assert.equal(assessCandidate({symbol:'USDC-USDT',m1:1}).code,'STABLECOIN');
  assert.equal(assessCandidate({symbol:'BTC3L-USDT',m1:1}).code,'LEVERAGED_TOKEN');
});
test('unknown listing age and under-seven-day listing both block',()=>{
  assert.equal(assessCandidate({symbol:'INIT-USDT',m1:3},{now:NOW}).code,'AGE_UNVERIFIED');
  assert.equal(assessCandidate({symbol:'MTX-USDT',m1:2},{now:NOW,listingAt:NOW-2*86_400_000}).code,'NEW_LISTING');
});
test('BUY converted to AVOID and reason preserved when risk gate blocks',()=>{
  const rows=guardRows([{symbol:'SOL-USDT',status:'BUY',entryQuality:{status:'BUY',reason:'breakout'},m1:.5}],{marketRisk:{allowBuys:false,reason:'Pasaran bearish'},now:NOW});
  assert.equal(rows[0].status,'AVOID');assert.equal(rows[0].entryQuality.status,'AVOID');assert.match(rows[0].entryQuality.reason,/NO TRADE/);
});
test('unverified listing age blocks even if market otherwise passes',()=>{
  const rows=guardRows([{symbol:'SOL-USDT',status:'BUY',entryQuality:{status:'BUY'},m1:.5}],{marketRisk:{allowBuys:true,reason:'market passed'},now:NOW});
  assert.equal(rows[0].status,'AVOID');assert.equal(rows[0].riskCandidate.code,'AGE_UNVERIFIED');
});
test('existing non-BUY classifications are unchanged and record fields survive',()=>{
  const existing={symbol:'BTC-USDT',status:'WATCH',price:33,breakout:{signal:'SETUP'},entryQuality:{reason:'setup'}};
  assert.equal(guardRows([existing],{marketRisk:{allowBuys:false}})[0],existing);
});
