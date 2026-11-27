const test=require('node:test');
const assert=require('node:assert/strict');
const {makeWidgetSummary}=require('../lib/widget-summary');
const now=Date.UTC(2026,10,27,4);
const mk=(symbol,score)=>({symbol,score,status:'WATCH',volume:12000000,spread:.01,price:1.23,m15:1.3});
function sample(){return {lastUpdate:now-5000,rows:[mk('SOL-USDT',91),mk('ETH-USDT',90),mk('BTC-USDT',89),mk('ADA-USDT',88),mk('DOT-USDT',87),mk('LINK-USDT',86)],marketRisk:{allowBuys:false,reason:'audit belum selesai'},allowed:new Set(['SOL-USDT'])};}
test('top 5 and deterministic score order',()=>{const r=makeWidgetSummary(sample(),{now});assert.equal(r.top.length,5);assert.deepEqual(r.top.map(x=>x.symbol),['SOL-USDT','ETH-USDT','BTC-USDT','ADA-USDT','DOT-USDT']);});
test('server risk gate stays NO TRADE',()=>{const r=makeWidgetSummary(sample(),{now});assert.equal(r.risk.buyAllowed,false);assert.equal(r.risk.status,'NO_TRADE');});
test('stale removes all coins',()=>{const s=sample();s.lastUpdate=now-120000;const r=makeWidgetSummary(s,{now});assert.equal(r.top.length,0);assert.equal(r.risk.buyAllowed,false);});
test('fewer than five valid entries remains fewer than five',()=>{const s=sample();s.rows=s.rows.slice(0,2);const r=makeWidgetSummary(s,{now});assert.equal(r.top.length,2);});
test('sensitive app secrets never appear in public feed',()=>{const s=sample();s.TELEGRAM_BOT_TOKEN='not-for-public';s.journal={private:'hidden'};assert.doesNotMatch(JSON.stringify(makeWidgetSummary(s,{now})),/not-for-public|hidden/);});
