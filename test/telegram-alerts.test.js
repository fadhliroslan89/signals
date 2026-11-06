'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, messageFor, createTelegramEngine, safeMode } = require('../lib/telegram-alerts');
function row(symbol='SOL-USDT', status='AVOID', score=80, breakoutRank=0) {
  const breakout = { coverage:'READY', signal:'BREAKOUT 1M', one:true, at1:1_500_000, rank:breakoutRank };
  return { symbol,status,score,price:150.55,volume:12_000_000,spread:.02,m5:1.15,m15:2.8,m30:4.1,breakout };
}
const t0 = 1_700_000;
test('only complete BUY qualifies, high-score AVOID remains observation', () => {
  assert.equal(classify(row('X-USDT','AVOID',100,100)),'OBS');
  assert.equal(classify(row('Y-USDT','WATCH',85,100)),'OBS');
  assert.equal(classify(row('Z-USDT','BUY',70,0)),'BUY');
  assert.equal(classify(row('A-USDT','BUY',69,0)),null);
  assert.equal(classify(row('B-USDT','AVOID',20,75)),'OBS');
  const x=row('X-USDT','BUY',70,90);x.breakout.one=false;
  assert.equal(classify(x),'OBS');
});
test('message explicitly distinguishes observation from verified BUY', () => {
  const observe=messageFor(row('X-USDT','AVOID',100,100),'OBS',t0);
  assert.match(observe,/BUKAN SIGNAL BUY/);
  assert.match(observe,/Status scanner: AVOID/);
  assert.match(observe,/Market: 100\/100/);
  assert.match(observe,/Breakout: 100\/100/);
  const buy=messageFor(row('SOL-USDT','BUY',80,90),'BUY',t0);
  assert.match(buy,/BUY DISAHKAN/);
  assert.match(buy,/SOL-USDT/);
});
test('first batch of high scores is baseline; new observation sends once', async () => {
  const out=[];const engine=createTelegramEngine({send:async msg=>out.push(msg),mode:'both'});
  await engine.tick([row('X-USDT')],{ready:true,now:t0});
  assert.equal(out.length,0);
  await engine.tick([row('X-USDT'),row('Y-USDT')],{ready:true,now:t0+20000});
  assert.equal(out.length,1);
  await engine.tick([row('X-USDT'),row('Y-USDT')],{ready:true,now:t0+40000});
  assert.equal(out.length,1);
  assert.match(out[0],/Y-USDT/);
});
test('buy notifications fire immediately even before full candle bootstrap', async () => {
  const out=[];const engine=createTelegramEngine({send:async msg=>out.push(msg),mode:'buy'});
  await engine.tick([row('SOL-USDT','BUY',75,90),row('X-USDT')],{ready:false,now:t0});
  assert.equal(out.length,1);
  await engine.tick([row('SOL-USDT','BUY',75,90)],{ready:false,now:t0+20000});
  assert.equal(out.length,1);
});
test('same event never double sends after cooldown; changed event allowed later', async () => {
  const out=[];const engine=createTelegramEngine({send:async msg=>out.push(msg),mode:'buy'});
  const a=row('SOL-USDT','BUY',85,95);
  await engine.tick([a],{now:t0});
  await engine.tick([a],{now:t0+22*60_000});
  assert.equal(out.length,1);
  const b=row('SOL-USDT','BUY',87,95);b.breakout.at1+=60_000;
  await engine.tick([b],{now:t0+23*60_000});
  assert.equal(out.length,2);
});
test('bad Telegram request is retryable and marked as error; no false success', async () => {
  let attempts=0;
  const engine=createTelegramEngine({send:async()=>{attempts++;if(attempts===1)throw Error('Telegram HTTP 400');},mode:'buy'});
  const a=row('SOL-USDT','BUY',80,90);
  await engine.tick([a],{now:t0});
  assert.match(engine.status().lastError,/Telegram HTTP 400/);
  assert.equal(engine.status().sentCount,0);
  await engine.tick([a],{now:t0+10_000});
  assert.equal(attempts,1);
  await engine.tick([a],{now:t0+65_000});
  assert.equal(attempts,2);
  assert.equal(engine.status().sentCount,1);
  assert.equal(engine.status().lastError,null);
});
test('max 3 alerts per tick, with BUY ahead of OBS', async () => {
  const out=[];const engine=createTelegramEngine({send:async msg=>out.push(msg),mode:'both'});
  await engine.tick([],{ready:true,now:t0});
  const observations=Array.from({length:6},(_,i)=>row(`O${i}-USDT`,'AVOID',80+i));
  const buy=row('SOL-USDT','BUY',75,98);
  await engine.tick([...observations,buy],{ready:true,now:t0+20_000});
  assert.equal(out.length,3);
  assert.match(out[0],/BUY DISAHKAN/);
  await engine.tick([...observations,buy],{ready:true,now:t0+40_000});
  assert.equal(out.length,6);
});
test('buy-only mode excludes observations', async () => {
  const out=[];const engine=createTelegramEngine({send:async msg=>out.push(msg),mode:'buy'});
  await engine.tick([row('X-USDT','AVOID',100,100)],{ready:true,now:t0});
  assert.equal(out.length,0);
  assert.equal(safeMode('wrong'),'buy');
});
test('Telegram configuration values and bot token never appear in public files', () => {
  const fs=require('node:fs'),path=require('node:path');
  const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  const publicJS=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
  assert.match(server,/process\.env\.TELEGRAM_BOT_TOKEN/);
  assert.doesNotMatch(publicJS,/process\.env\.TELEGRAM_BOT_TOKEN/);
  assert.match(server,/telegramEngine\.tick/);
});
