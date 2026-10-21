const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluate}=require('../public/entry-quality.js');
const now=Date.UTC(2026,9,21,8,0,20);
const strong={symbol:'AAA-USDT',price:102,volume:20e6,spread:.04,m1:.22,m5:.88,m10:1.10,m15:2.0,m30:2.6,breakout:{coverage:'READY',one:true,rvol1:2.4,at1:now-20000,level1:101.6}};
test('quality BUY only with fresh 1m breakout + acceleration',()=>{assert.equal(evaluate(strong,{},now).status,'BUY');});
test('ticker momentum alone cannot trigger BUY',()=>{assert.equal(evaluate({...strong,breakout:{coverage:'NOT_MONITORED'}},{},now).status,'WATCH');});
test('low relative volume or no closed breakout cannot trigger BUY',()=>{
 assert.equal(evaluate({...strong,breakout:{...strong.breakout,rvol1:1.2}},{},now).status,'WATCH');
 assert.equal(evaluate({...strong,breakout:{...strong.breakout,one:false}},{},now).status,'WATCH');
});
test('fading momentum cannot trigger BUY',()=>{
 assert.equal(evaluate({...strong,m1:-.2},{},now).status,'WATCH');
 assert.equal(evaluate({...strong,m10:2.5},{},now).status,'WATCH');
});
test('high spread, thin liquidity and stale data rejected',()=>{
 assert.equal(evaluate({...strong,spread:.4},{},now).status,'AVOID');
 assert.equal(evaluate({...strong,volume:1e6},{},now).status,'AVOID');
 assert.equal(evaluate({...strong,breakout:{...strong.breakout,at1:now-300000}},{},now).status,'WATCH');
});
test('no chasing beyond breakout',()=>{assert.equal(evaluate({...strong,price:103},{},now).status,'WATCH');});
test('warmup no false buy',()=>{assert.equal(evaluate({...strong,m10:null},{},now).status,'DATA');});
