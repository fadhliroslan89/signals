'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const h=require('../public/hitrun.js');
const r=(symbol,change24h,volume,spread=.08)=>({symbol,change24h,volume,spread,price:1.2,m1:null,m5:null,m15:null});
test('diagnostics pinpoints each failing stage without relying on 1m history',()=>{
  const rows=[r('BTC-USDT',4,100e6),r('AAA-USDT',13,3e6),r('BBB-USDT',15,8e6,.8),r('CCC-USDT',18,12e6,.05),r('USDC-USDT',25,40e6)];
  const d=h.diagnose(rows,{gain:10,volume:5e6,spread:.3});
  assert.deepEqual([d.universe,d.gain,d.liquid,d.qualified],[4,3,2,1]);
  assert.deepEqual(d.top.map(x=>x.symbol),['CCC-USDT','BBB-USDT','AAA-USDT','BTC-USDT']);
  assert.equal(d.top[0].diagnosticReason,'LULUS PENAPIS');
  assert.equal(d.top[1].diagnosticReason,'SPREAD TINGGI');
  assert.equal(d.top[2].diagnosticReason,'VOLUME RENDAH');
  assert.equal(d.top[3].diagnosticReason,'KENAIKAN RENDAH');
});
test('not more than eight raw gainers; data missing spread is flagged',()=>{
  const rows=Array.from({length:11},(_,i)=>r('COIN'+i+'-USDT',11+i,3e6));
  rows[9]={...rows[9],volume:7e6,spread:null};
  const d=h.diagnose(rows,{gain:10,volume:5e6,spread:.3});
  assert.equal(d.top.length,8);assert.equal(d.spreadMissing,1);
  assert.equal(d.top.find(x=>x.symbol==='COIN9-USDT').diagnosticReason,'SPREAD TIADA DATA');
});
test('diagnostics exclude leveraged and stablecoin from turnover',()=>{
  const d=h.diagnose([r('USDC-USDT',30,50e6),r('BTC3L-USDT',50,20e6),r('BTC-USDT',-2,200e6)]);
  assert.equal(d.universe,1);assert.equal(d.top.length,0);
});
