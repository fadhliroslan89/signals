'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {makeWidgetSummary}=require('../lib/widget-summary');
const now=Date.UTC(2026,10,27,8);
const row=(symbol,score,overrides={})=>({symbol,score,status:'AVOID',price:1,m15:0.2,volume:0,spread:2,...overrides});
const state=(rows)=>({lastUpdate:now-3000,marketRisk:{allowBuys:false,code:'AUDIT_PAUSE'},rows});
test('widget matches website 70+ even for AVOID, thin volume and wide spread',()=>{
 const x=makeWidgetSummary(state([row('ABC-USDT',95),row('DEF-USDT',70),row('LOW-USDT',69)]),{now});
 assert.deepEqual(x.top.map(r=>r.symbol),['ABC-USDT','DEF-USDT']);
 assert.equal(x.top[0].status,'AVOID');
 assert.equal(x.risk.buyAllowed,false);
});
test('breakout READY or market score qualifies; exact ordering and Top 5',()=>{
 const rows=[row('AAA-USDT',60,{breakout:{coverage:'READY',rank:99}}),row('BBB-USDT',98),row('CCC-USDT',97),row('DDD-USDT',96),row('EEE-USDT',95),row('FFF-USDT',94),row('GGG-USDT',69,{breakout:{coverage:'DATA',rank:100}})];
 const x=makeWidgetSummary(state(rows),{now});
 assert.deepEqual(x.top.map(r=>r.symbol),['AAA-USDT','BBB-USDT','CCC-USDT','DDD-USDT','EEE-USDT']);
});
test('no duplicates, no stale data, no private fields',()=>{
 const s=state([row('AAA-USDT',99),row('AAA-USDT',91)]);
 s.TELEGRAM_BOT_TOKEN='secret';s.journal={account:'private'};
 assert.equal(makeWidgetSummary(s,{now}).top.length,1);
 assert.doesNotMatch(JSON.stringify(makeWidgetSummary(s,{now})),/secret|private/);
 s.lastUpdate=now-200000;
 assert.equal(makeWidgetSummary(s,{now}).top.length,0);
});
