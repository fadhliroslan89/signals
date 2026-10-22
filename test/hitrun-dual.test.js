"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const h=require('../public/hitrun');
const base=(symbol,override={})=>({symbol,price:1.2,change24h:16,volume:2.8e6,spread:.10,m1:.21,m5:.8,m15:1.5,m30:2,hitrunOhlcv:{coverage:'NOT_MONITORED'},...override});
test('dual mode separates high liquidity and aggressive tiers with no overlap',()=>{
 const rows=[base('HIGH-USDT',{volume:10e6,spread:.1}),base('AGGR-USDT',{volume:2.8e6,spread:.19}),base('HEDGE-USDT',{volume:5e6,spread:.14}),base('EDGE-USDT',{volume:5e6,spread:.20}),base('SKIP-USDT',{volume:999999,spread:.01})];
 const r=h.dual(rows);assert.deepEqual(r.high.results.map(x=>x.symbol),['HIGH-USDT','HEDGE-USDT']);
 assert.deepEqual(r.aggressive.results.map(x=>x.symbol),['AGGR-USDT']);
 assert.equal(r.high.eligible+r.aggressive.eligible,3);assert.equal(r.diagnostics.spreadExcluded,1);
});
test('screenshot-like IRYS and VAYLA enter aggressive, not high',()=>{
 const data=[base('IRYS-USDT',{change24h:49.23,volume:2.81e6,spread:.103}),base('VAYLA-USDT',{change24h:25.44,volume:3.29e6,spread:.231}),base('BILL-USDT',{change24h:29.02,volume:731700,spread:.137})];
 const r=h.dual(data);assert.equal(r.high.eligible,0);assert.equal(r.aggressive.eligible,2);assert.equal(r.diagnostics.under1m,1);
});
test('excludes stablecoin, leverage, and gain below required 10pct',()=>{
 const r=h.dual([base('USDC-USDT',{volume:30e6}),base('BTC3L-USDT',{volume:30e6}),base('LOW-USDT',{volume:2e6,change24h:9.9})]);
 assert.equal(r.high.eligible+r.aggressive.eligible,0);
});
test('never claims spike when OHLCV missing or stale',()=>{
 for(const coverage of ['DATA','STALE','NOT_MONITORED','GAP']){
  const info=h.signalContext(base('SAFE-USDT',{hitrunOhlcv:{coverage,rvol1:20,rvol5:20,one:true,five:true}}));
  assert.equal(info.spike1,false);assert.equal(info.breakout,false);assert.equal(info.rvol1,null);
 }
});
test('volume spike is not labelled BUY without close breakout',()=>{
 const info=h.signalContext(base('SAFE-USDT',{hitrunOhlcv:{coverage:'READY',rvol1:2.4,rvol5:.9,one:false,five:false,at1:Date.now()}}));
 assert.equal(info.label,'VOLUME SPIKE');assert.equal(info.breakout,false);
});
test('confirmed breakout requires closed candle flags and RVOL',()=>{
 const pass=h.signalContext(base('ABC-USDT',{hitrunOhlcv:{coverage:'READY',rvol1:2,rvol5:1.0,one:true,five:false,at1:Date.now()}}));
 const fail=h.signalContext(base('BCD-USDT',{hitrunOhlcv:{coverage:'READY',rvol1:1.1,rvol5:1.0,one:true,five:false,at1:Date.now()}}));
 assert.equal(pass.label,'BREAKOUT SAH');assert.equal(pass.breakout,true);assert.equal(fail.breakout,false);
});
test('breakout-first sorting prioritizes confirmed OHLCV over unconfirmed higher gain',()=>{
 const yes=base('YES-USDT',{volume:5.2e6,hitrunOhlcv:{coverage:'READY',one:true,five:false,rvol1:2.2,rvol5:.6}});
 const no=base('NO-USDT',{volume:5.2e6,change24h:80,hitrunOhlcv:{coverage:'DATA'}});
 const result=h.dual([yes,no],{sort:'breakout'}).high.results;
 assert.equal(result[0].symbol,'YES-USDT');
});
test('user-facing v1.9 UI preserves journal and both action hooks',()=>{
 const fs=require('node:fs'); const path=require('node:path'); const root=path.join(__dirname,'../public');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
 assert.ok(html.indexOf('id="journalSection"') < html.indexOf('id="hitrunSection"'));
 assert.ok(html.indexOf('id="hitrunSection"') < html.indexOf('REAL-TIME OPPORTUNITIES'));
 for(const id of ['hitrunHighCards','hitrunAggCards'])assert.ok(html.includes(`id="${id}"`));
 assert.match(app,/trackTrade\(track\.dataset\.hitrunTrack/);
 assert.doesNotMatch(app,/fetch\([^\n]+kucoin\.com\/trade/);
});
