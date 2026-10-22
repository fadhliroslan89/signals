'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {prioritizedSymbols}=require('../lib/priority');
const ticker=(symbol,vol,change,spread)=>{
  const p=100, delta=spread/200;
  return {symbol,volValue:String(vol),changeRate:String(change/100),buy:String(p*(1-delta)),sell:String(p*(1+delta))};
};
test('Bootstrap loads qualified fast 24h gainers and liquid pairs before illiquid pairs',()=>{
 const tickers=new Map([
   ['TINY-USDT',ticker('TINY-USDT',20_000,25,0.1)],
   ['SOL-USDT',ticker('SOL-USDT',40_000_000,0.2,0.02)],
   ['FAST-USDT',ticker('FAST-USDT',2_000_000,17,0.1)],
   ['WIDE-USDT',ticker('WIDE-USDT',2_000_000,19,1.0)],
 ]);
 const got=prioritizedSymbols(['TINY-USDT','WIDE-USDT','SOL-USDT','FAST-USDT'],tickers);
 assert.deepEqual(got,['FAST-USDT','SOL-USDT','WIDE-USDT','TINY-USDT']);
});
test('Excluded leveraged tokens not prioritized as fast gainers',()=>{
 const tickers=new Map([
   ['BTC3L-USDT',ticker('BTC3L-USDT',2_000_000,40,0.1)],
   ['IRYS-USDT',ticker('IRYS-USDT',1_500_000,12,0.1)],
 ]);
 assert.equal(prioritizedSymbols(['BTC3L-USDT','IRYS-USDT'],tickers)[0],'IRYS-USDT');
});
