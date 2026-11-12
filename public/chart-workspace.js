/* KuCoin Radar v2.0 — native Canvas candlestick workspace, no external chart dependency.
 * All annotations anchor to UTC candle time + market price, not screen pixels.
 * Chart is for analysis only; no order submission is possible here.
 */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const TF=['1m','5m','15m','30m','1h','4h'], SECONDS={'1m':60,'5m':300,'15m':900,'30m':1800,'1h':3600,'4h':14400};
const PREFIX='kucoin-chart-v2:', MAX_DRAWINGS=220, COLORS={up:'#2bd5ae',down:'#ff637c',grid:'#19344b',muted:'#87a6b8',yellow:'#e8c16e',blue:'#69b5fd'};
const stage=$('chartStage'),canvas=$('priceCanvas'),ctx=canvas.getContext('2d'),info=$('chartInfo'), status=$('chartStatus');
let symbol='SOL-USDT',tf='5m',bars=[],tool='pan',draft=null,selected=-1,hover=null,drag=null;
let visibleCount=85,endIndex=0,drawings=[],noteTimer=null,refreshTimer=null,fetchBusy=false,requestSeq=0,view=null,lastTime=0,localRevision=0;
let ema9=[],ema21=[];
function notify(msg,kind='info'){status.textContent=msg;status.dataset.kind=kind;}
function validSymbol(s){return /^(?:[A-Z0-9]{1,20})-USDT$/.test(s)}
function normalizeSymbol(s){s=String(s||'').trim().toUpperCase().replace(/\s+/g,'');if(s.endsWith('/USDT'))s=s.slice(0,-5)+'-USDT';if(s.endsWith('USDT')&&!s.endsWith('-USDT'))s=s.slice(0,-4)+'-USDT';if(/^[A-Z0-9]{1,20}$/.test(s))s+='-USDT';return validSymbol(s)?s:null}
function key(){return PREFIX+symbol+':'+tf}
function priceFmt(n){if(!Number.isFinite(n))return '—';if(n>=1000)return n.toLocaleString('en-US',{maximumFractionDigits:2});if(n>=1)return Number(n.toFixed(5)).toString();if(n>=.00001)return Number(n.toFixed(8)).toString();return Number(n.toPrecision(7)).toString()}
function num(n){return Number.isFinite(+n)?+n:NaN}
function validDrawings(a){return Array.isArray(a)&&a.length<=MAX_DRAWINGS&&a.every(d=>d&&['hline','trend','zone','note'].includes(d.type)&&Array.isArray(d.anchors)&&d.anchors.length===(d.type==='hline'||d.type==='note'?1:2)&&d.anchors.every(p=>Number.isFinite(p?.t)&&p.t>1000000000&&p.t<9999999999&&Number.isFinite(p?.price)&&p.price>0)&&(!d.text||(typeof d.text==='string'&&d.text.length<=200)))}
function copyDrawings(x){return x.map(d=>({type:d.type,anchors:d.anchors.map(p=>({t:p.t,price:p.price})),...(d.text?{text:d.text}:{}),...(d.color?{color:d.color}:{})}))}
function local(){try{const a=JSON.parse(localStorage.getItem(key())||'[]');return validDrawings(a)?copyDrawings(a):[]}catch{return []}}
function load(){drawings=local();selected=-1;draft=null;$('drawingCount').textContent=drawings.length+' lukisan';notify('Auto-save lokal aktif untuk '+symbol+' '+tf+'.','ok');render();window.dispatchEvent(new CustomEvent('chart-workspace-change',{detail:{key:key(),switch:true}}));}
function save(){try{localStorage.setItem(key(),JSON.stringify(drawings));localRevision++;$('saveInfo').textContent='Disimpan • '+new Date().toLocaleTimeString('ms-MY',{hour:'2-digit',minute:'2-digit'});$('drawingCount').textContent=drawings.length+' lukisan';window.dispatchEvent(new CustomEvent('chart-workspace-change',{detail:{key:key(),revision:localRevision}}));}catch{notify('Penyimpanan browser gagal. Eksport backup JSON sekarang.','warn')}}
function commit(){if(drawings.length>MAX_DRAWINGS){notify('Had 220 lukisan untuk satu pair/timeframe.','warn');return false}save();render();return true}
function setDrawingsFromExternal(a){if(!validDrawings(a))throw Error('Format drawing tidak sah.');drawings=copyDrawings(a);selected=-1;draft=null;commit()}
function timeLabel(ms){return new Date(ms).toLocaleString('ms-MY',{timeZone:'Asia/Kuala_Lumpur',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})}
function calcEma(data,period){let sum=0,e=null;const out=[];data.forEach((b,i)=>{if(i<period){sum+=b.close;if(i===period-1)e=sum/period;}else e=(b.close-e)*(2/(period+1))+e;out.push(e);});return out}
function plot(){
 const w=stage.clientWidth,h=stage.clientHeight;const left=15,right=w-90,top=26,priceBottom=h-156,volTop=h-133,volBottom=h-47;
 const end=Math.max(0,Math.min(bars.length-1,Math.round(endIndex)));
 const start=Math.max(0,end-Math.min(visibleCount,bars.length)+1);
 const count=Math.max(1,end-start+1);const step=Math.max(1,(right-left)/count);
 const current=bars.slice(start,end+1), min=Math.min(...current.map(b=>b.low)),max=Math.max(...current.map(b=>b.high));
 const pad=(max-min||max*.004||.1)*.12,lo=Math.max(0,min-pad),hi=max+pad;
 return {w,h,left,right,top,priceBottom,volTop,volBottom,start,end,count,step,current,lo,hi,
  x:i=>left+(i-start+.5)*step, y:p=>priceBottom-(p-lo)/(hi-lo)*(priceBottom-top),
  py:y=>lo+(priceBottom-y)/(priceBottom-top)*(hi-lo)};
}
function clearAndSize(){const dpr=Math.min(window.devicePixelRatio||1,2),w=Math.max(stage.clientWidth,320),h=Math.max(stage.clientHeight,360);if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);canvas.style.width=w+'px';canvas.style.height=h+'px'}ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);ctx.fillStyle='#091b2b';ctx.fillRect(0,0,w,h)}
function roundedRect(x,y,w,h,r=5){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
function timeToX(t,p){
 // Drawings are pinned to candle timestamps, even after zoom/pan; no pixel-based saving.
 const sec=t*1000;const first=bars[0]?.time,last=bars.at(-1)?.time;
 if(!first||!last)return -999;
 let low=0,hi=bars.length-1;
 while(low<hi){const m=(low+hi)>>1;if(bars[m].time<sec)low=m+1;else hi=m}
 let idx=low;
 if(idx>0&&Math.abs(bars[idx-1].time-sec)<Math.abs(bars[idx].time-sec))idx--;
 return p.x(idx);
}
function pointerAnchor(pt,p){let idx=Math.floor((pt.x-p.left)/p.step+p.start);idx=Math.max(0,Math.min(bars.length-1,idx));return {t:Math.floor(bars[idx].time/1000),price:Math.max(1e-12,p.py(Math.max(p.top,Math.min(p.priceBottom,pt.y))))}}
function paintBackground(p){
 ctx.save();ctx.strokeStyle=COLORS.grid;ctx.lineWidth=1;ctx.font='11px system-ui';ctx.fillStyle=COLORS.muted;
 for(let i=0;i<=5;i++){const y=p.top+(p.priceBottom-p.top)*i/5;ctx.beginPath();ctx.moveTo(p.left,y);ctx.lineTo(p.right,y);ctx.stroke();const pr=p.hi+(p.lo-p.hi)*i/5;ctx.fillText(priceFmt(pr),p.right+9,y+3)}
 const interval=Math.max(1,Math.ceil(p.count/8));for(let i=p.start;i<=p.end;i+=interval){const x=p.x(i);ctx.beginPath();ctx.moveTo(x,p.top);ctx.lineTo(x,p.volBottom);ctx.stroke();ctx.fillText(new Date(bars[i].time).toLocaleString('en-GB',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit',hour12:false}),x-15,p.h-23)}
 ctx.restore();
}
function paintCandles(p){
 const maxVol=Math.max(...p.current.map(b=>b.volume),1);ctx.save();
 for(let i=p.start;i<=p.end;i++){const b=bars[i],x=p.x(i),up=b.close>=b.open,color=up?COLORS.up:COLORS.down;
  ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=1.2;
  const yh=p.y(b.high),yl=p.y(b.low),yo=p.y(b.open),yc=p.y(b.close);
  ctx.beginPath();ctx.moveTo(x,yh);ctx.lineTo(x,yl);ctx.stroke();
  ctx.fillRect(x-Math.min(p.step*.35,8),Math.min(yo,yc),Math.max(1,Math.min(p.step*.7,16)),Math.max(1,Math.abs(yc-yo)));
  ctx.globalAlpha=.48;ctx.fillRect(x-Math.min(p.step*.35,8),p.volBottom-(b.volume/maxVol)*(p.volBottom-p.volTop),Math.max(1,Math.min(p.step*.7,16)),(b.volume/maxVol)*(p.volBottom-p.volTop));ctx.globalAlpha=1;
 }
 ctx.restore();
}
function paintEma(p){
 if(!$('showEMA').checked)return;
 for(const [arr,color] of [[ema9,COLORS.yellow],[ema21,COLORS.blue]]){
  ctx.save();ctx.lineWidth=1.6;ctx.strokeStyle=color;ctx.beginPath();let moved=false;
  for(let i=p.start;i<=p.end;i++){if(arr[i]==null)continue;const x=p.x(i),y=p.y(arr[i]);if(!moved){ctx.moveTo(x,y);moved=true}else ctx.lineTo(x,y)}if(moved)ctx.stroke();ctx.restore();
 }
}
function distance(a,b,p){const dx=a.x-b.x,dy=a.y-b.y;return Math.sqrt(dx*dx+dy*dy)}
function geometry(d,p){const a=d.anchors[0],b=d.anchors[1],p1={x:timeToX(a.t,p),y:p.y(a.price)},p2=b?{x:timeToX(b.t,p),y:p.y(b.price)}:null;return {p1,p2}}
function paintDrawings(p){
 drawings.forEach((d,i)=>drawItem(d,p,i===selected));if(draft)drawItem(draft,p,true,true);
}
function drawItem(d,p,isSelected=false,isDraft=false){
 const {p1,p2}=geometry(d,p),color=d.color||(d.type==='zone'?COLORS.blue:COLORS.yellow);ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=isSelected?2.6:1.8;ctx.setLineDash(isDraft?[5,4]:[]);
 if(d.type==='hline'){ctx.beginPath();ctx.moveTo(p.left,p1.y);ctx.lineTo(p.right,p1.y);ctx.stroke();ctx.font='bold 11px system-ui';ctx.fillText(priceFmt(d.anchors[0].price),p.left+6,p1.y-7)}
 if(d.type==='trend'&&p2){ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.stroke()}
 if(d.type==='zone'&&p2){const x=Math.min(p1.x,p2.x),y=Math.min(p1.y,p2.y),w=Math.abs(p2.x-p1.x),h=Math.abs(p2.y-p1.y);ctx.globalAlpha=.15;ctx.fillRect(x,y,w,h);ctx.globalAlpha=1;ctx.strokeRect(x,y,w,h)}
 if(d.type==='note'){const text=d.text||'Nota';ctx.font='bold 12px system-ui';roundedRect(p1.x-5,p1.y-23,Math.min(ctx.measureText(text).width+14,250),23,6);ctx.fillStyle='#163b45';ctx.fill();ctx.stroke();ctx.fillStyle='#ddf7f1';ctx.fillText(text.slice(0,36),p1.x+2,p1.y-7)}
 if(isSelected&&d.type!=='hline'&&d.type!=='note'){ctx.setLineDash([]);for(const pt of [p1,p2]){if(!pt)continue;ctx.fillStyle='#e9f9ff';ctx.beginPath();ctx.arc(pt.x,pt.y,4,0,Math.PI*2);ctx.fill()}}
 ctx.restore();
}
function drawCrosshair(p){if(!hover||tool!=='pan')return;const {x,y}=hover;if(x<p.left||x>p.right||y<p.top||y>p.priceBottom)return;ctx.save();ctx.strokeStyle='#7699ae';ctx.lineWidth=1;ctx.setLineDash([4,5]);ctx.beginPath();ctx.moveTo(x,p.top);ctx.lineTo(x,p.volBottom);ctx.moveTo(p.left,y);ctx.lineTo(p.right,y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#164159';roundedRect(p.right+2,y-10,86,21,4);ctx.fill();ctx.fillStyle='#e6fcff';ctx.font='11px system-ui';ctx.fillText(priceFmt(p.py(y)),p.right+7,y+4);ctx.restore();}
function render(){clearAndSize();if(bars.length===0){ctx.font='15px system-ui';ctx.fillStyle=COLORS.muted;ctx.fillText('Menunggu data candlestick…',24,80);return}view=plot();paintBackground(view);paintCandles(view);paintEma(view);paintDrawings(view);drawCrosshair(view);$('candleCount').textContent=bars.length+' candle';}
function hitTest(pt,p){for(let i=drawings.length-1;i>=0;i--){const d=drawings[i],{p1,p2}=geometry(d,p);if(d.type==='hline'&&Math.abs(pt.y-p1.y)<9)return i;if(d.type==='note'&&Math.abs(pt.x-p1.x)<90&&Math.abs(pt.y-p1.y)<29)return i;if(d.type==='trend'&&p2){const dx=p2.x-p1.x,dy=p2.y-p1.y,t=Math.max(0,Math.min(1,((pt.x-p1.x)*dx+(pt.y-p1.y)*dy)/(dx*dx+dy*dy||1))),hit={x:p1.x+t*dx,y:p1.y+t*dy};if(distance(pt,hit,p)<10)return i}if(d.type==='zone'&&p2){const minx=Math.min(p1.x,p2.x),maxx=Math.max(p1.x,p2.x),miny=Math.min(p1.y,p2.y),maxy=Math.max(p1.y,p2.y);if(pt.x>=minx-7&&pt.x<=maxx+7&&pt.y>=miny-7&&pt.y<=maxy+7)return i}}return -1}
function xy(ev){const r=canvas.getBoundingClientRect();return {x:ev.clientX-r.left,y:ev.clientY-r.top}}
function chooseTool(t){tool=t;draft=null;drag=null;document.querySelectorAll('[data-tool]').forEach(b=>{b.classList.toggle('active',b.dataset.tool===t);b.setAttribute('aria-pressed',String(b.dataset.tool===t))});stage.dataset.tool=t;notify(t==='pan'?'Gerak: drag untuk pan, scroll untuk zoom. Pilih lukisan untuk edit/buang.':t==='hline'?'Klik/tap harga untuk horizontal line.':t==='note'?'Klik/tap lokasi nota.':'Klik/tap dua titik pada chart untuk '+(t==='trend'?'trendline.':'zone.'));render()}
function noteInput(current=''){const v=window.prompt('Nota chart (maksimum 120 aksara):',current);return v===null?null:v.trim().slice(0,120)}
function down(ev){if(!bars.length||!view||ev.button>0)return;const p=xy(ev);hover=p;stage.setPointerCapture(ev.pointerId);
 if(tool==='pan'){drag={mode:'pan',startX:p.x,initialEnd:endIndex};return}
 if(tool==='select'){selected=hitTest(p,view);drag=selected>=0?{mode:'shape',x:p.x,y:p.y,index:selected,original:copyDrawings([drawings[selected]])[0]}:null;render();return}
 if(p.x<view.left||p.x>view.right||p.y<view.top||p.y>view.priceBottom)return;
 const anchor=pointerAnchor(p,view);
 if(tool==='hline'){if(drawings.length>=MAX_DRAWINGS)return notify('Had maksimum lukisan.','warn');drawings.push({type:'hline',anchors:[anchor]});commit();return}
 if(tool==='note'){const txt=noteInput();if(txt){drawings.push({type:'note',anchors:[anchor],text:txt});commit()}return}
 if(tool==='trend'||tool==='zone'){
  if(!draft){draft={type:tool,anchors:[anchor,anchor]};notify('Pilih titik kedua…');render()}
  else{draft.anchors[1]=anchor;if(drawings.length<MAX_DRAWINGS){drawings.push(draft);commit()}draft=null;render()}
 }
}
function move(ev){if(!bars.length||!view)return;const p=xy(ev);hover=p;
 if(drag?.mode==='pan'){const moved=Math.round((drag.startX-p.x)/view.step);endIndex=Math.max(visibleCount-1,Math.min(bars.length-1,drag.initialEnd+moved))}
 if(drag?.mode==='shape'){const original=drag.original,idx=drag.index,dt=Math.round((p.x-drag.x)/view.step),priceDiff=view.py(p.y)-view.py(drag.y);
  drawings[idx]={...original,anchors:original.anchors.map(a=>{const at=bars.findIndex(b=>b.time===a.t*1000);const next=at<0?0:Math.max(0,Math.min(bars.length-1,at+dt));return {t:Math.floor(bars[next].time/1000),price:Math.max(1e-12,a.price+priceDiff)}})};
 }
 if(draft&&view){draft.anchors[1]=pointerAnchor(p,view)}render()
}
function up(ev){if(drag?.mode==='shape')commit();drag=null;if(stage.hasPointerCapture(ev.pointerId))stage.releasePointerCapture(ev.pointerId)}
function wheel(ev){if(!bars.length)return;ev.preventDefault();const count=visibleCount,ratio=ev.deltaY>0?1.14:.88;visibleCount=Math.min(Math.min(bars.length,320),Math.max(20,Math.round(count*ratio)));endIndex=Math.max(visibleCount-1,endIndex);render()}
function removeSelected(){if(selected<0)return notify('Pilih garisan atau zone dahulu.','warn');drawings.splice(selected,1);selected=-1;commit()}
function clearAll(){if(!drawings.length)return;if(confirm('Padam semua '+drawings.length+' lukisan bagi '+symbol+' '+tf+'? Tindakan ini tidak boleh diundur.')){drawings=[];selected=-1;commit()}}
function exportJson(){const blob=new Blob([JSON.stringify({kind:'kucoin-chart-workspace',version:2,symbol,timeframe:tf,drawings,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='KuCoin-Chart-'+symbol+'-'+tf+'-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1200)}
async function importJson(file){if(!file)return;if(file.size>200000)throw Error('Fail terlalu besar.');const data=JSON.parse(await file.text());if(data?.kind!=='kucoin-chart-workspace'||data?.version!==2||!validDrawings(data.drawings))throw Error('Fail drawing bukan backup yang sah.');if(!confirm('Import '+data.drawings.length+' lukisan ke '+symbol+' '+tf+'? Lukisan sedia ada untuk pair/timeframe ini akan diganti.'))return;const backup=JSON.stringify(drawings);try{localStorage.setItem('kucoin-chart-before-import-'+Date.now(),backup)}catch{}setDrawingsFromExternal(data.drawings);notify('Backup JSON berjaya diimport.','ok')}
async function refresh(){if(fetchBusy||document.hidden)return;const seq=++requestSeq;fetchBusy=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),17000);
 try{info.textContent='Mengambil OHLCV '+symbol+' '+tf+' daripada KuCoin…';const res=await fetch('/api/chart?symbol='+encodeURIComponent(symbol)+'&tf='+tf+'&limit=320',{cache:'no-store',signal:controller.signal});const j=await res.json().catch(()=>({}));if(!res.ok)throw Error(j.error||'HTTP '+res.status);if(seq!==requestSeq)return;const next=j.candles||[];
  if(!Array.isArray(next)||!next.length)throw Error('Tiada candle');const parsed=next.map(x=>({time:+x.time,open:+x.open,high:+x.high,low:+x.low,close:+x.close,volume:+x.volume})).filter(x=>Number.isFinite(x.time)&&x.high>=x.low&&x.close>0).sort((a,b)=>a.time-b.time);
  if(!parsed.length)throw Error('Tiada candle sah');const oldLast=bars.at(-1)?.time,atEnd=endIndex>=bars.length-3;bars=parsed;ema9=calcEma(bars,9);ema21=calcEma(bars,21);
  if(!oldLast||atEnd)endIndex=bars.length-1;else{const idx=bars.findIndex(b=>b.time===oldLast);endIndex=idx>=0?idx:bars.length-1}
  visibleCount=Math.min(visibleCount,bars.length);lastTime=Date.now();$('lastPrice').textContent=priceFmt(j.lastPrice||bars.at(-1).close)+' USDT';
  $('freshness').textContent=(j.mock?'DEMO':'KuCoin LIVE')+' • '+timeLabel(j.lastPriceUpdatedAt||Date.now());$('freshness').dataset.live=String(!j.mock&&j.ageSeconds<90);
  info.textContent='Candlestick KuCoin '+tf+' • '+bars.length+' candle • candle terkini mungkin belum tutup. Kemas kini setiap 20s.';render();notify('Chart berjaya dikemas kini. Lukisan tempatan tidak terjejas.','ok');
 }catch(e){info.textContent='Chart tidak dapat dikemas kini: '+(e.name==='AbortError'?'masa sambungan tamat':e.message)+'. Lukisan masih tersimpan dalam browser.';notify('Data chart belum LIVE. Jangan gunakan harga lama untuk entry.','warn');$('freshness').textContent='OFFLINE / DATA LAMA';$('freshness').dataset.live='false';render()}finally{clearTimeout(timer);fetchBusy=false}}
function switchChart(sym,frame){const newSymbol=normalizeSymbol(sym),newTf=TF.includes(frame)?frame:tf;if(!newSymbol)return notify('Pair tidak sah. Contoh: SOL atau SOL-USDT.','warn');if(newSymbol===symbol&&newTf===tf)return;symbol=newSymbol;tf=newTf;$('pairInput').value=symbol.replace(/-USDT$/,'');$('timeframe').value=tf;bars=[];visibleCount=85;endIndex=0;requestSeq++;fetchBusy=false;load();refresh()}
function init(){const qs=new URLSearchParams(location.search),initial=normalizeSymbol(qs.get('symbol')||qs.get('pair'))||symbol;symbol=initial;tf=TF.includes(qs.get('tf'))?qs.get('tf'):tf;$('pairInput').value=symbol.replace(/-USDT$/,'');$('timeframe').value=tf;
  $('pairForm').addEventListener('submit',e=>{e.preventDefault();switchChart($('pairInput').value,$('timeframe').value)});
  $('timeframe').addEventListener('change',()=>switchChart($('pairInput').value,$('timeframe').value));
  $('refreshChart').addEventListener('click',()=>refresh());$('showEMA').addEventListener('change',render);
  document.querySelectorAll('[data-tool]').forEach(btn=>btn.addEventListener('click',()=>chooseTool(btn.dataset.tool)));
  $('zoomIn').addEventListener('click',()=>{if(bars.length){visibleCount=Math.max(20,Math.round(visibleCount*.82));render()}});
  $('zoomOut').addEventListener('click',()=>{if(bars.length){visibleCount=Math.min(Math.min(320,bars.length),Math.round(visibleCount*1.2));endIndex=Math.max(endIndex,visibleCount-1);render()}});
  $('resetView').addEventListener('click',()=>{if(bars.length){endIndex=bars.length-1;visibleCount=Math.min(85,bars.length);render()}});
  $('deleteDrawing').addEventListener('click',removeSelected);$('clearDrawings').addEventListener('click',clearAll);$('exportDrawing').addEventListener('click',exportJson);
  $('importDrawing').addEventListener('change',async e=>{try{await importJson(e.target.files?.[0])}catch(err){notify('Import gagal: '+err.message,'warn')}e.target.value='' });
  $('openPaperlab').addEventListener('click',()=>{location.href='/paperlab/?symbol='+encodeURIComponent(symbol)});
  stage.addEventListener('pointerdown',down);stage.addEventListener('pointermove',move);stage.addEventListener('pointerup',up);stage.addEventListener('pointercancel',up);stage.addEventListener('pointerleave',()=>{hover=null;render()});stage.addEventListener('wheel',wheel,{passive:false});
  stage.addEventListener('dblclick',()=>{if(tool==='select'&&selected>=0&&drawings[selected].type==='note'){const text=noteInput(drawings[selected].text);if(text!==null){drawings[selected].text=text;commit()}}});
  document.addEventListener('keydown',e=>{if(e.target.matches('input,textarea,select'))return;if(e.key==='Escape'){draft=null;chooseTool('pan')}if((e.key==='Delete'||e.key==='Backspace')&&selected>=0){e.preventDefault();removeSelected()}});
  new ResizeObserver(render).observe(stage);load();chooseTool('pan');refresh();refreshTimer=setInterval(()=>{if(document.visibilityState==='visible')refresh()},20000);
}
window.KuCoinChartWorkspace={key,getDrawings:()=>copyDrawings(drawings),setDrawings:setDrawingsFromExternal,local,validDrawings,notify,current:()=>({symbol,tf}),revision:()=>localRevision};
init();
})();
