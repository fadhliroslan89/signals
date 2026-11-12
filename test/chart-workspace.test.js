'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {spawn}=require('node:child_process');
const root=path.join(__dirname,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');
test('Full Chart has native candlestick and each drawing tool, without exchange orders',()=>{
 const h=read('public/chart/index.html'),js=read('public/chart-workspace.js');
 for(const t of ['pan','select','hline','trend','zone','note'])assert.match(h,new RegExp('data-tool="'+t+'"'));
 for(const tf of ['1m','5m','15m','30m','1h','4h'])assert.match(h,new RegExp('value="'+tf+'"'));
 assert.match(js,/canvas\.getContext\('2d'\)/);assert.match(js,/priceToX|timeToX/);
 assert.match(js,/localStorage\.setItem\(key\(\),JSON\.stringify\(drawings\)\)/);
 assert.match(js,/t:Math\.floor\(bars\[idx\]\.time\/1000\),price:/);
 assert.doesNotMatch(js,/\/api\/v1\/orders|placeOrder|buyMarket|sellMarket/);
});
test('Chart drawing import validation blocks malformed and huge payloads',()=>{
 const code=read('public/chart-workspace.js');
 assert.match(code,/validDrawings/);assert.match(code,/a\.length<=MAX_DRAWINGS/);assert.match(code,/file\.size>200000/);
 assert.match(code,/confirm\('Import /);assert.match(code,/kucoin-chart-before-import-/);
});
test('Cloud sync reuses existing PaperLab authentication and refuses stale revision overwrite',()=>{
 const code=read('public/chart-cloud.js');
 assert.match(code,/paperlab-cloud-session-v1/);assert.match(code,/PAPERLAB_CLOUD/);
 assert.match(code,/&revision=eq\.'\+revision/);assert.match(code,/KONFLIK/);assert.match(code,/chart\.setDrawings/);
 assert.match(code,/Cloud Journal/);assert.doesNotMatch(code,/service_role|SUPABASE_SERVICE_ROLE_KEY/);
 const sql=read('setup/SUPABASE_CHART_WORKSPACES.sql');assert.match(sql,/ENABLE ROW LEVEL SECURITY/);assert.match(sql,/auth\.uid\(\)/);assert.match(sql,/PRIMARY KEY \(user_id, symbol, timeframe\)/);
});
test('Full Chart linked from scanner navigation, coin details and PaperLab',()=>{
 const scanner=read('public/index.html'),paper=read('public/paperlab/index.html');
 assert.match(scanner,/href="\/chart\/"/);assert.match(scanner,/id="openFullChart"/);
 assert.match(paper,/id="openChartWorkspace"/);assert.match(paper,/id="symbol"/);
 assert.match(read('public/chart-link.js'),/detailTitle/);
});
test('Live market endpoints and Journal keys are preserved; service worker never caches API',()=>{
 const server=read('server.js'),sw=read('public/sw.js');
 for(const route of ['/api/status','/api/chart','/api/price','/api/health','/api/diagnostics'])assert.ok(server.includes(route),route);
 assert.match(server,/url\.searchParams\.get\('limit'\) === '320'/);assert.match(sw,/url\.pathname\.startsWith\('\/api\/'\)/);
 assert.match(read('public/journal-core.js'),/kucoin-radar-trades|journal/i);
 assert.match(read('public/paperlab/index.html'),/kucoin-paperlab-v1/);
});
test('HTTP chart routes, asset CSP and candle endpoint work in demo without external calls',async()=>{
 const port=38277;
 const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,MOCK_KUCOIN:'1',PORT:String(port)},stdio:'ignore'});
 const base='http://127.0.0.1:'+port;
 try{
  let ready=false;
  for(let i=0;i<55;i++){
   await new Promise(r=>setTimeout(r,70));
   try{const r=await fetch(base+'/api/health',{signal:AbortSignal.timeout(400)});if(r.ok){ready=true;break}}catch{}
  }
  assert.ok(ready,'demo service must become ready');
  const chart=await fetch(base+'/chart/');assert.equal(chart.status,200);assert.match(await chart.text(),/Full Chart/);
  assert.match(chart.headers.get('content-security-policy'),/connect-src 'self' https:\/\/ldwfgsupmyykicdmfgjp\.supabase\.co/);
  const js=await fetch(base+'/chart-workspace.js');assert.equal(js.status,200);
  const candle=await fetch(base+'/api/chart?symbol=SOL-USDT&tf=5m&limit=320');assert.equal(candle.status,200);const data=await candle.json();assert.ok(Array.isArray(data.candles)&&data.candles.length>70);assert.equal(data.symbol,'SOL-USDT');
  const bad=await fetch(base+'/api/chart?symbol=NOT!GOOD&tf=5m');assert.equal(bad.status,400);
  const index=await fetch(base+'/');assert.match(await index.text(),/Full Chart/);
  const paper=await fetch(base+'/paperlab/');assert.match(await paper.text(),/openChartWorkspace/);
 }finally{child.kill()}
});

test('v2.2 default 30m and adjustable R:R tool are included without impacting journal routes',()=>{
 const h=read('public/chart/index.html'),js=read('public/chart-workspace.js');
 assert.match(h,/data-tool="rr"/);assert.match(h,/value="30m" selected/);
 for(const id of ['rrSide','rrEntry','rrTP','rrSL','rrCapital','rrFee','rrSend'])assert.match(h,new RegExp('id="'+id+'"'));
 assert.match(js,/savedCoin\(\)/);assert.match(js,/rrRect/);assert.match(js,/function sendRR/);assert.match(js,/source:'CHART_RR'/);
 assert.match(js,/PaperLab hanya Spot Long/);
});
