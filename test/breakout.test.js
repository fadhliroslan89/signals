'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const {candlesFromKucoin,bucket5,analyze}=require('../lib/breakout');
const NOW=Date.UTC(2026,9,21,9,40,15);
const configs={minVolume:5e6,maxSpread:.3}; const row={price:106,volume:10e6,spread:.08,m1:.2};
function sample({break1=false,spike1=false,break5=false,lowVolume=false,gap=false}={}){
  const map=new Map(); const final=NOW-15_000;
  for(let i=0;i<50;i++){
    const at=final-(49-i)*60_000;
    let close=100+Math.floor(i/5)*.12,high=close+.15,volume=100;
    if(i===49){close=break1?106:close;high=Math.max(close,high);volume=spike1?300:100;}
    if(break5 && i>=45){close=104+(i-45)*.5;high=close+.03;volume=300;}
    if(gap && i===43)continue;
    map.set(at,{at,open:close-.02,close,high,low:close-.1,volume:lowVolume?0:volume});
  }
  return map;
}
test('KuCoin parsing excludes unclosed candle and preserves exact high/low/volume',()=>{
 const now=NOW; const ts=Math.floor((now-120000)/60000)*60;
 const bars=candlesFromKucoin([[String(ts),'100','101','102','99','50','5000'],[String(Math.floor(now/60000)*60),'99','100','101','98','30','3000']],now);
 assert.equal(bars.length,1);assert.equal(bars[0].high,102);assert.equal(bars[0].volume,50);
});
test('No breakout on price-only move without relative volume',()=>{
  const result=analyze(sample({break1:true}),NOW,configs,row);assert.equal(result.coverage,'READY');assert.equal(result.one,false);
});
test('1-minute close plus 1.8x relative volume confirms breakout',()=>{
  const result=analyze(sample({break1:true,spike1:true}),NOW,configs,row);
  assert.equal(result.one,true);assert.ok(result.signal.startsWith('BREAKOUT 1M'));assert.ok(result.rvol1>1.8);
});
test('Liquidity and spread prevent user-facing signal',()=>{
  assert.equal(analyze(sample({break1:true,spike1:true}),NOW,configs,{...row,volume:200}).signal,'NONE');
  assert.equal(analyze(sample({break1:true,spike1:true}),NOW,configs,{...row,spread:1}).signal,'NONE');
});
test('Stale and gapped candles never create a breakout',()=>{
  assert.equal(analyze(sample({break1:true,spike1:true}),NOW+180_000,configs,row).signal,'NONE');
  assert.equal(analyze(sample({break1:true,spike1:true,gap:true}),NOW,configs,row).signal,'NONE');
});
test('Only complete 5m groups aggregated without partial candles',()=>{
 const map=sample(); const five=bucket5([...map.values()]);
 assert.equal(five.length,10);assert.ok(five.every(x=>x.at%(5*60_000)===0));
});
test('low or absent baseline volume yields no misleading volume spike',()=>{
 const r=analyze(sample({break1:true,spike1:true,lowVolume:true}),NOW,configs,row);
 assert.equal(r.one,false);
});

test('5m close above prior six 5m highs with 1.4x RVOL is independent of 1m spike',()=>{
 const map=sample({break1:true});
 const lastFive=[...map.values()].slice(-5);
 for(const b of lastFive){b.volume=200;map.set(b.at,b);}
 const r=analyze(map,NOW,configs,row);
 assert.equal(r.one,false);assert.equal(r.five,true);assert.equal(r.signal,'BREAKOUT 5M');assert.ok(r.rvol5>=1.4);
});
test('Setup requires liquidity, near-high and volume confirmation',()=>{
 const map=sample({});
 const latest=[...map.values()].at(-1);
 latest.volume=125;
 // Set live ticker within 0.45% of resistance while candle itself has not broken out.
 const r=analyze(map,NOW,configs,{...row,price:latest.high*0.997,m1:0.02});
 assert.equal(r.signal,'SETUP');assert.equal(r.near,true);
});
