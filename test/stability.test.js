'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname,'..');
async function freePort(){const srv=net.createServer(); await new Promise(resolve=>srv.listen(0,'127.0.0.1',resolve)); const port=srv.address().port; await new Promise(resolve=>srv.close(resolve));return port;}
async function launch(mock) {
 const port=await freePort();
 const args=mock ? ['server.js'] : ['-r',path.join(__dirname,'offline-fetch-preload.cjs'),'server.js'];
 const child=spawn(process.execPath,args,{cwd:root, env:{...process.env,PORT:String(port),HOST:'127.0.0.1',MOCK_KUCOIN:mock?'1':'0',TELEGRAM_BOT_TOKEN:'',TELEGRAM_CHAT_ID:''},stdio:['ignore','pipe','pipe']});
 const base='http://127.0.0.1:'+port;
 for(let i=0;i<60;i++){
  if(child.exitCode!==null)throw new Error('server stopped before test');
  try {const r=await fetch(base+'/api/health',{signal:AbortSignal.timeout(350)});if(r.ok)return {child,base};}catch{}
  await new Promise(r=>setTimeout(r,60));
 }
 child.kill('SIGTERM');throw new Error('server not ready');
}
for(const mock of [true,false]){
 test(`HTTP UI and diagnostics while KuCoin ${mock?'available (demo)':'unavailable'}`, async t=>{
  const {child,base}=await launch(mock);t.after(()=>child.kill('SIGTERM'));
  const [html,sw,health,diag,status] = await Promise.all([
    fetch(base+'/'),fetch(base+'/sw.js'),fetch(base+'/api/health'),fetch(base+'/api/diagnostics'),fetch(base+'/api/status',{headers:{'accept-encoding':'gzip'}})
  ]);
  for(const r of [html,sw,health,diag,status])assert.equal(r.status,200);
  assert.match(await html.text(),/KuCoin Scalping Radar v2\.0/);
  assert.match(await sw.text(),/never cache price\/status/i);
  const h=await health.json(); assert.equal(h.processAlive,true);
  const d=await diag.json(); assert.equal(d.processAlive,true);assert.ok(d.memoryMB.rss>0);
  const s=await status.json();assert.equal(s.strategyVersion,'2.3.0-safety');
  assert.equal(s.marketRisk.allowBuys,false);
  assert.equal(s.rows.some(r=>r.status==='BUY'),false);
  assert.equal(s.mock,mock);
  if(!mock){
    await new Promise(r=>setTimeout(r,150));
    const d2=await (await fetch(base+'/api/diagnostics')).json();
    assert.equal(d2.marketFresh,false);
    assert.match(d2.marketError||'',/simulated KuCoin connection failure/);
  } else {
    assert.ok(s.rows.length>=1);
  }
 });
}
test('journal key and Telegram token access remain untouched',()=>{
 const txt=fs.readFileSync(path.join(root,'public/journal-core.js'),'utf8');
 const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
 assert.match(txt,/kucoin-radar-trading-journal-v15/);
 assert.match(server,/process\.env\.TELEGRAM_BOT_TOKEN/);
 assert.match(server,/process\.env\.TELEGRAM_CHAT_ID/);
});
