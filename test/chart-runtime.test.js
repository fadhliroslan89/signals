'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const CODE=fs.readFileSync(path.join(__dirname,'../public/chart-workspace.js'),'utf8');
function makeEnv(store=new Map(),search='?symbol=SOL-USDT&tf=5m'){
 const elements=new Map(),toolEls=['pan','select','hline','trend','zone','note','rr'].map(t=>({dataset:{tool:t},classList:{toggle(){}},setAttribute(){},listeners:{},addEventListener(k,fn){this.listeners[k]=fn}}));
 const elem=id=>{if(elements.has(id))return elements.get(id);const e={id,value:'',textContent:'',dataset:{},style:{},checked:true,listeners:{},clientWidth:1120,clientHeight:630,addEventListener(k,fn){this.listeners[k]=fn},setPointerCapture(){},hasPointerCapture(){return true},releasePointerCapture(){},getBoundingClientRect(){return {x:0,y:0,left:0,top:0,width:1120,height:630}},classList:{toggle(){}}};elements.set(id,e);return e};
 const ctx=new Proxy({canvas:{},measureText:()=>({width:96})},{get(o,k){return k in o?o[k]:(()=>{})},set(o,k,v){o[k]=v;return true}});
 elem('priceCanvas').getContext=()=>ctx;
 const storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>{store.set(k,v)},removeItem:k=>store.delete(k)};
 const bars=Array.from({length:110},(_,i)=>({time:1794400000000+i*300000,open:150+i*.03,close:150.03+i*.03,high:150.1+i*.03,low:149.9+i*.03,volume:100+i}));
 const logs=[];let monitor=0;
 const sandbox={
   window:{devicePixelRatio:1,prompt:()=> 'Rintangan H1',dispatchEvent:()=>{},addEventListener:()=>{}},
   document:{hidden:false,querySelectorAll:q=>q==='[data-tool]'?toolEls:[],getElementById:elem,addEventListener(){}},
   location:{search,href:''},localStorage:storage,ResizeObserver:class{observe(){}},
   CustomEvent:class{constructor(t,opts){this.type=t;this.detail=opts?.detail}},
   fetch:async()=>({ok:true,json:async()=>({candles:bars,lastPrice:bars.at(-1).close,lastPriceUpdatedAt:Date.now(),mock:true,ageSeconds:1})}),
   AbortController, setTimeout,clearTimeout,setInterval:()=>++monitor,clearInterval:()=>{},Date,Map,Set,Array,Math,JSON,Number,console,
   confirm:()=>true,alert:()=>{},Blob,URL,URLSearchParams,alertQueue:logs,
 };
 vm.runInNewContext(CODE,sandbox,{filename:'chart-workspace.js'});
 return {sandbox,elements,toolEls,store,api:sandbox.window.KuCoinChartWorkspace,elem,logs};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('Canvas chart runs in isolated UI, draws hline + trend + zone, persists time and price',async()=>{
 const env=makeEnv();await sleep(20);const {elem,toolEls,api,store}=env;
 assert.match(elem('candleCount').textContent,/candle/);
 const stage=elem('chartStage');const dispatch=(k,x,y)=>stage.listeners[k]({button:0,pointerId:1,clientX:x,clientY:y});
 toolEls.find(x=>x.dataset.tool==='hline').listeners.click();dispatch('pointerdown',280,270);dispatch('pointerup',280,270);
 toolEls.find(x=>x.dataset.tool==='trend').listeners.click();dispatch('pointerdown',320,260);dispatch('pointerup',320,260);dispatch('pointerdown',410,230);dispatch('pointerup',410,230);
 toolEls.find(x=>x.dataset.tool==='zone').listeners.click();dispatch('pointerdown',365,240);dispatch('pointerup',365,240);dispatch('pointerdown',480,285);dispatch('pointerup',480,285);
 assert.equal(api.getDrawings().length,3);
 const parsed=JSON.parse(store.get('kucoin-chart-v2:SOL-USDT:5m'));
 assert.equal(parsed.length,3);assert.ok(parsed.every(d=>d.anchors.every(a=>a.t>1e9&&a.price>0)));
 const again=makeEnv(store);await sleep(15);assert.equal(again.api.getDrawings().length,3);
 again.elem('timeframe').value='1m';again.elem('timeframe').listeners.change();await sleep(15);
 assert.equal(again.api.getDrawings().length,0);
 again.elem('timeframe').value='5m';again.elem('timeframe').listeners.change();await sleep(15);
 assert.equal(again.api.getDrawings().length,3);
});

test('v2.1 horizontal lines drag vertically while Horizontal tool stays active; do not create duplicates; preserve timestamps and auto-save',async()=>{
 const env=makeEnv();await sleep(20);
 const {elem,toolEls,api,store}=env;
 const stage=elem('chartStage');
 const event=(k,x,y,id=1)=>stage.listeners[k]({type:k,button:0,pointerId:id,clientX:x,clientY:y});
 toolEls.find(x=>x.dataset.tool==='hline').listeners.click();
 event('pointerdown',280,270);event('pointerup',280,270);
 let d=api.getDrawings();assert.equal(d.length,1);assert.equal(d[0].type,'hline');
 const before=d[0].anchors[0];
 // Existing horizontal line can be grabbed in Horizontal mode and dragged up or down.
 event('pointerdown',460,270);event('pointermove',460,320);event('pointerup',460,320);
 d=api.getDrawings();assert.equal(d.length,1,'editing must not create a second line');
 assert.equal(d[0].anchors[0].t,before.t,'horizontal line timestamp must stay fixed');
 assert.notEqual(d[0].anchors[0].price,before.price,'vertical drag changes price');
 const after=d[0].anchors[0].price;
 assert.equal(JSON.parse(store.get('kucoin-chart-v2:SOL-USDT:5m'))[0].anchors[0].price,after,'price is auto-saved');
 const reopened=makeEnv(store);await sleep(20);
 assert.equal(reopened.api.getDrawings()[0].anchors[0].price,after,'price persists after reloading');
 // Unrelated timeframe keeps its own drawings.
 reopened.elem('timeframe').value='15m';reopened.elem('timeframe').listeners.change();await sleep(15);
 assert.equal(reopened.api.getDrawings().length,0);
});

test('v2.1 Select/Edit drags horizontal line vertically while keeping candle time',async()=>{
 const env=makeEnv();await sleep(20);const {elem,toolEls,api}=env,stage=elem('chartStage');
 const event=(k,x,y)=>stage.listeners[k]({type:k,button:0,pointerId:1,clientX:x,clientY:y});
 toolEls.find(x=>x.dataset.tool==='hline').listeners.click();event('pointerdown',250,260);event('pointerup',250,260);
 const initial=api.getDrawings()[0].anchors[0];
 toolEls.find(x=>x.dataset.tool==='select').listeners.click();
 event('pointerdown',300,260);event('pointermove',300,240);event('pointerup',300,240);
 const moved=api.getDrawings()[0].anchors[0];
 assert.equal(moved.t,initial.t);assert.ok(moved.price>initial.price,'drag up raises line price');
 assert.equal(api.getDrawings().length,1);
});

test('v2.1 double-click on an existing horizontal line sets exact price and persists it',async()=>{
 const env=makeEnv();await sleep(20);
 const {elem,toolEls,api,store}=env,stage=elem('chartStage');
 const event=(k,x,y)=>stage.listeners[k]({type:k,button:0,pointerId:1,clientX:x,clientY:y});
 toolEls.find(x=>x.dataset.tool==='hline').listeners.click();event('pointerdown',300,270);event('pointerup',300,270);
 env.sandbox.window.prompt=()=> '154.2386';
 stage.listeners.dblclick({button:0,clientX:300,clientY:270});
 const result=api.getDrawings();
 assert.equal(result.length,1);assert.equal(result[0].anchors[0].price,154.2386);
 assert.equal(JSON.parse(store.get('kucoin-chart-v2:SOL-USDT:5m'))[0].anchors[0].price,154.2386);
});

function yForRR(d){
 // Synthetic candles are rising by 0.03; current 85 bars are 25..109.
 const candleMin=149.9+25*.03,candleMax=150.1+109*.03;
 const min=Math.min(candleMin,d.tp,d.sl),max=Math.max(candleMax,d.tp,d.sl),pad=(max-min)*.12;
 return price=>474-(price-Math.max(0,min-pad))/(max+pad-Math.max(0,min-pad))*448;
}
test('v2.2 last coin is restored at default 30m; explicit tf links still respected',async()=>{
 const env=makeEnv(new Map([['kucoin-chart-v2-last-coin','AVAX-USDT']]),'');await sleep(18);
 assert.equal(env.api.current().symbol,'AVAX-USDT');assert.equal(env.api.current().tf,'30m');
 assert.equal(env.elem('timeframe').value,'30m');
 const explicit=makeEnv(new Map([['kucoin-chart-v2-last-coin','BTC-USDT']]),'?symbol=ETH-USDT&tf=1m');await sleep(18);
 assert.equal(explicit.api.current().symbol,'ETH-USDT');assert.equal(explicit.api.current().tf,'1m');
 explicit.elem('pairInput').value='DOGE';explicit.elem('timeframe').value='15m';explicit.elem('pairForm').listeners.submit({preventDefault(){}});await sleep(18);
 assert.equal(explicit.store.get('kucoin-chart-v2-last-coin'),'DOGE-USDT');
});
test('v2.2 adjustable Long R:R creation, TP/SL drag, width resize and auto-save',async()=>{
 const env=makeEnv(),{api,toolEls,store,elem}=env;await sleep(25);
 const stage=elem('chartStage'),fire=(type,x,y)=>stage.listeners[type]({type,button:0,pointerId:1,clientX:x,clientY:y});
 toolEls.find(t=>t.dataset.tool==='rr').listeners.click();fire('pointerdown',310,270);fire('pointerup',310,270);
 let a=api.getDrawings();assert.equal(a.length,1);assert.equal(a[0].type,'rr');assert.equal(a[0].side,'long');assert.ok(a[0].tp>a[0].anchors[0].price&&a[0].sl<a[0].anchors[0].price);assert.equal(elem('rrEditor').hidden,false);
 const oldTP=a[0].tp,oldSL=a[0].sl,y=yForRR(a[0]);
 fire('pointerdown',370,y(oldTP));fire('pointermove',370,y(oldTP)-23);fire('pointerup',370,y(oldTP)-23);
 a=api.getDrawings();assert.ok(a[0].tp>oldTP,'dragging TP upwards raises price');assert.equal(a.length,1);
 const y2=yForRR(a[0]);fire('pointerdown',370,y2(oldSL));fire('pointermove',370,y2(oldSL)+28);fire('pointerup',370,y2(oldSL)+28);
 a=api.getDrawings();assert.ok(a[0].sl<oldSL,'dragging SL down decreases price');
 const oldEnd=a[0].anchors[1].t;const y3=yForRR(a[0]);
 // 18 bars at 1120px / 85 shown bars, starting x310 => x525 approx.
 fire('pointerdown',525,y3(a[0].anchors[0].price));fire('pointermove',595,y3(a[0].anchors[0].price));fire('pointerup',595,y3(a[0].anchors[0].price));
 a=api.getDrawings();assert.ok(a[0].anchors[1].t>oldEnd,'right boundary drag should extend width');
 const persisted=JSON.parse(store.get('kucoin-chart-v2:SOL-USDT:5m'))[0];assert.equal(persisted.tp,a[0].tp);assert.equal(persisted.sl,a[0].sl);
 const reopened=makeEnv(store);await sleep(20);assert.equal(reopened.api.getDrawings()[0].tp,a[0].tp);
 assert.ok(reopened.api.getDrawings()[0].anchors[1].t>=oldEnd);
});
test('v2.2 R:R manual editing applies numeric prices, exports valid long to PaperLab, blocks short',async()=>{
 const env=makeEnv(),{api,toolEls,elem,sandbox}=env;await sleep(20);
 const stage=elem('chartStage'),fire=(type,x,y)=>stage.listeners[type]({type,button:0,pointerId:1,clientX:x,clientY:y});
 toolEls.find(t=>t.dataset.tool==='rr').listeners.click();fire('pointerdown',300,250);fire('pointerup',300,250);
 const old=api.getDrawings()[0],entry=old.anchors[0].price;
 elem('rrEntry').value=String(entry);elem('rrTP').value=String(entry*1.035);elem('rrSL').value=String(entry*.985);elem('rrCapital').value='300';elem('rrFee').value='0.1';elem('rrSide').value='long';elem('rrApply').listeners.click();
 let d=api.getDrawings()[0];assert.equal(d.capital,300);assert.ok(Math.abs(d.tp-entry*1.035)<1e-6);
 elem('rrSend').listeners.click();assert.match(sandbox.location.href,/\/paperlab\/\?/);assert.match(sandbox.location.href,/source=CHART_RR/);assert.match(sandbox.location.href,/capital=300/);
 // Reject a malformed direction instead of losing old saved setup.
 elem('rrTP').value=String(entry*.97);elem('rrApply').listeners.click();assert.equal(api.getDrawings()[0].tp,d.tp);
 const short=makeEnv();await sleep(20);short.elem('rrNewSide').value='short';
 const sstage=short.elem('chartStage'),sfire=(type,x,y)=>sstage.listeners[type]({type,button:0,pointerId:1,clientX:x,clientY:y});
 short.toolEls.find(t=>t.dataset.tool==='rr').listeners.click();sfire('pointerdown',300,250);sfire('pointerup',300,250);
 d=short.api.getDrawings()[0];assert.ok(d.tp<d.anchors[0].price&&d.sl>d.anchors[0].price);assert.equal(short.elem('rrSend').disabled,true);
 short.elem('rrSend').listeners.click();assert.equal(short.sandbox.location.href,'');
});
