'use strict';
const {test}=require('node:test'); const assert=require('node:assert/strict');
const h=require('../public/hitrun');
const row=(symbol='ABC-USDT',extra={})=>({symbol,price:1.8,change24h:14.5,volume:17_000_000,spread:.04,m1:.25,m5:.7,m15:1.5,m30:2.1,...extra});
test('10% 24h high volume + tight spread required',()=>{
 const ret=h.choose([row(),row('LOW-USDT',{change24h:9.99}),row('THIN-USDT',{volume:5000000}),row('WIDE-USDT',{spread:.31})]);
 assert.equal(ret.eligible,1);assert.equal(ret.results[0].symbol,'ABC-USDT');
});
test('stablecoins leveraged and malformed pairs excluded',()=>{
 for(const x of ['USDC-USDT','FDUSD-USDT','USD1-USDT','BTC3L-USDT','BTC2S-USDT','BTCUP-USDT','BTCBULL-USDT','BAD/USDT']) assert.equal(h.isExcluded(x),true,x);
 assert.equal(h.isExcluded('BTC-USDT'),false);
});
test('fast rising coin is marked MEMECUT but not BUY',()=>{const a=h.choose([row()]).results[0];assert.equal(a.hitrun.status,'MEMECUT');assert.ok(!JSON.stringify(a).includes('"status":"BUY"'));});
test('pullback and chasing flagged without trading trigger',()=>{
 assert.equal(h.recent(row('X-USDT',{m5:-.2})).status,'PULLBACK');
 assert.equal(h.recent(row('X-USDT',{m1:1.4})).status,'TERLALU PANAS');
 assert.equal(h.recent(row('X-USDT',{m5:4.1})).status,'TERLALU PANAS');
});
test('incomplete candle histories labelled DATA but shown on 24h list',()=>{
 const a=h.choose([row('X-USDT',{m1:null,m5:null,m15:null})]);
 assert.equal(a.results[0].hitrun.status,'DATA');assert.equal(a.eligible,1);
});
test('ranking prioritizes acceleration then score, alternative volume/gain sorting',()=>{
 const a=row('A-USDT',{volume:13e6});
 const b=row('B-USDT',{m1:-.2,m5:-.1,volume:90e6,change24h:16});
 assert.deepEqual(h.choose([a,b]).results.map(x=>x.symbol),['A-USDT','B-USDT']);
 assert.deepEqual(h.choose([a,b],{sort:'volume'}).results.map(x=>x.symbol),['B-USDT','A-USDT']);
 assert.deepEqual(h.choose([a,b],{sort:'gain'}).results.map(x=>x.symbol),['B-USDT','A-USDT']);
});
test('parameters configurable and results capped to 25',()=>{
 let many=Array.from({length:40},(_,i)=>row('X'+i+'-USDT',{volume:11e6+i*1e6}));
 assert.equal(h.choose(many,{limit:60}).results.length,25);
 assert.equal(h.choose(many,{volume:60e6}).eligible,0);
 assert.equal(h.choose(many,{gain:20}).eligible,0);
});
test('NaN, missing spread and missing price excluded',()=>{
 assert.equal(h.choose([row('A-USDT',{change24h:NaN}),row('B-USDT',{spread:null}),row('C-USDT',{price:null})]).eligible,0);
});
