'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const list=require('../public/top70.js');
function sample(i,market=0,breakout=0,status='AVOID',coverage='READY'){
 return {symbol:`COIN${i}-USDT`,score:market,status,price:1,volume:20000000,spread:.05,m5:1,m15:2,m30:3,breakout:{coverage,rank:breakout,one:true,signal:'BREAKOUT 1M'}};
}
test('every qualifying coin is shown without limit and exactly once',()=>{
 const rows=Array.from({length:45},(_,i)=>sample(i,70+i%30,70+i%30));
 rows.push({...rows[0]});
 rows.push(sample('low',69,69));
 const out=list.select(rows);
 assert.equal(out.total,45);assert.equal(out.rows.length,45);
 assert.equal(new Set(out.rows.map(r=>r.symbol)).size,45);
});
test('both Market >=70 or Breakout >=70 independently qualify',()=>{
 const out=list.select([sample(1,70,0),sample(2,20,75),sample(3,69,69),sample(4,85,NaN,'AVOID','STALE')]);
 assert.deepEqual(new Set(out.rows.map(r=>r.symbol)),new Set(['COIN1-USDT','COIN2-USDT','COIN4-USDT']));
 assert.equal(list.breakoutHigh(sample(5,10,100,'AVOID','STALE')),false);
});
test('breakout 100 AVOID never becomes BUY even with Market 85',()=>{
 const r=sample(1,85,100,'AVOID');const out=list.select([r]);
 assert.equal(out.buys,0);assert.equal(out.observations,1);
 assert.equal(list.verifiedBuy(r),false);
});
test('filters, search, rank and BUY first are correct',()=>{
 const a=sample('buy',71,75,'BUY');
 const b=sample('watch',10,99,'WATCH');
 const c=sample('avoid',99,100,'AVOID');
 const rows=[c,b,a];
 assert.equal(list.select(rows,{filter:'BUY'}).rows.length,1);
 assert.equal(list.select(rows,{filter:'OBS'}).rows.length,2);
 assert.equal(list.select(rows,{filter:'ALL',query:'WATCH'}).rows[0].symbol,b.symbol);
 assert.equal(list.select(rows).rows[0].symbol,a.symbol); // Confirmed BUY first
 assert.equal(list.select(rows,{sort:'score'}).rows[0].symbol,c.symbol);
});
test('first-tab navigation above whole dashboard and the existing panels remain',()=>{
 const html=fs.readFileSync('public/index.html','utf8');
 assert.ok(html.indexOf('id="tabTop70"')<html.indexOf('<main>'));
 assert.ok(html.indexOf('id="top70View"')<html.indexOf('id="dashboardView"'));
 for(const id of ['tabTop70','tabFullDashboard','top70Cards','top70Search','top70Sort','qualityBuyCards','qualityWatchCards','leaderCards','hunterCards','journalSection','hitrunSection','radarRows'])assert.ok(html.includes(`id="${id}"`));
 assert.ok(html.includes('/top70.js?v=1.9.3'));
});
