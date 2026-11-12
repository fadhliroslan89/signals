'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const CODE=fs.readFileSync(path.join(__dirname,'../public/chart-workspace.js'),'utf8');
function makeEnv(store=new Map()){
 const elements=new Map(),toolEls=['pan','select','hline','trend','zone','note'].map(t=>({dataset:{tool:t},classList:{toggle(){}},setAttribute(){},listeners:{},addEventListener(k,fn){this.listeners[k]=fn}}));
 const elem=id=>{if(elements.has(id))return elements.get(id);const e={id,value:'',textContent:'',dataset:{},style:{},checked:true,listeners:{},clientWidth:1120,clientHeight:630,addEventListener(k,fn){this.listeners[k]=fn},setPointerCapture(){},hasPointerCapture(){return true},releasePointerCapture(){},getBoundingClientRect(){return {x:0,y:0,left:0,top:0,width:1120,height:630}},classList:{toggle(){}}};elements.set(id,e);return e};
 const ctx=new Proxy({canvas:{}},{get(o,k){return k in o?o[k]:(()=>{})},set(o,k,v){o[k]=v;return true}});
 elem('priceCanvas').getContext=()=>ctx;
 const storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>{store.set(k,v)},removeItem:k=>store.delete(k)};
 const bars=Array.from({length:110},(_,i)=>({time:1794400000000+i*300000,open:150+i*.03,close:150.03+i*.03,high:150.1+i*.03,low:149.9+i*.03,volume:100+i}));
 const logs=[];let monitor=0;
 const sandbox={
   window:{devicePixelRatio:1,prompt:()=> 'Rintangan H1',dispatchEvent:()=>{},addEventListener:()=>{}},
   document:{hidden:false,querySelectorAll:q=>q==='[data-tool]'?toolEls:[],getElementById:elem,addEventListener(){}},
   location:{search:'?symbol=SOL-USDT&tf=5m',href:''},localStorage:storage,ResizeObserver:class{observe(){}},
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
