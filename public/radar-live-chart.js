/* KuCoin Radar — Live OHLCV Detail Chart v2.1 — Entry Decision Assistant.
   Non-trading chart extension; reads only same-origin /api/chart.
   Existing scanner and PaperLab state are not mutated. */
(() => {
  'use strict';
  const BACKDROP_ID = 'detailBackdrop';
  const POLL_MS = 20_000;
  const TIMEFRAMES = ['1m','5m','15m','30m','1h','4h'];
  const TF_SECONDS = Object.freeze({'1m':60,'5m':300,'15m':900,'30m':1800,'1h':3600,'4h':14400});
  const GREEN = '#23d7ae';
  const RED = '#f36b80';
  const MA_COLORS = ['#eeb943','#57a7ff','#b679ff'];
  let root = null, chart = null, activeSymbol = '', timeframe = '30m';
  let lastPayload = null, pollTimer = null, currentFetch = null, requestId = 0;
  let hoverIndex = -1, lastCanvasWidth = 0, renderedBars = [], lastPlot = null, refreshTimer = null;

  const el = (tag,cls,txt) => {
    const n = document.createElement(tag);
    if(cls) n.className=cls;
    if(txt != null) n.textContent=txt;
    return n;
  };
  const setText=(selector,text)=>{const n=chart?.querySelector(selector);if(n)n.textContent=String(text);};
  const validSymbol=s=>/^[A-Z0-9]{1,20}-USDT$/.test(s||'');
  const fmtPrice=(v)=>{
    if(!Number.isFinite(v))return '—';
    if(v>=1000)return v.toLocaleString('en-US',{maximumFractionDigits:2});
    if(v>=1)return v.toLocaleString('en-US',{maximumFractionDigits:5});
    if(v>=.01)return v.toFixed(6).replace(/0+$/,'').replace(/\.$/,'');
    if(v>=.00001)return v.toFixed(8).replace(/0+$/,'').replace(/\.$/,'');
    return v.toPrecision(6);
  };
  const fmtCount=v=>!Number.isFinite(v)?'—':v>=1e9?(v/1e9).toFixed(2)+'B':v>=1e6?(v/1e6).toFixed(2)+'M':v>=1e3?(v/1e3).toFixed(1)+'K':v.toFixed(2);
  const fmtTime=t=>new Date(t).toLocaleString('ms-MY',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'short',hour12:false});
  function isPopupVisible() {
    const b=document.getElementById(BACKDROP_ID);
    if(!b||document.hidden)return false;
    const s=getComputedStyle(b),r=b.getBoundingClientRect();
    return s.display!=='none' && s.visibility!=='hidden' && r.width>0 && r.height>0 && b.getAttribute('aria-hidden')!=='true';
  }
  function currentSymbol() {
    try { if(typeof state!=='undefined'&&state?.modalSymbol && validSymbol(state.modalSymbol))return state.modalSymbol; } catch(_){/* ignore */}
    const b=document.getElementById(BACKDROP_ID);
    const title=b?.querySelector('h1,h2,h3,.modal-title');
    const match=title?.textContent?.match(/\b([A-Z0-9]{1,20}-USDT)\b/);
    return match?.[1]||'';
  }
  function calcMA(all,index,n){
    if(index+1<n)return null;
    let total=0;for(let j=index+1-n;j<=index;j++)total+=all[j].close;
    return total/n;
  }
  function findOldChartSection(backdrop){
    // Find the original sparkline by its own caption, never hide an entire dialog.
    const caption=Array.from(backdrop.querySelectorAll('small,p,span,div')).find(x=>
      x.children.length===0 && /data harga\s*\(/i.test(x.textContent||''));
    if(!caption)return null;
    let node=caption.parentElement;
    for(let n=0;n<3&&node&&node!==backdrop;n++,node=node.parentElement){
      const text=(node.textContent||'').trim();
      const svg=node.querySelector('svg,canvas');
      if(svg && text.length<230 && !node.querySelector('button,input,textarea'))return node;
    }
    return null;
  }
  function insertChart(backdrop,host){
    // Preferred: replace existing short 1m snapshot line, not the entire detail screen.
    const old=findOldChartSection(backdrop);
    if(old&&old.parentElement){
      old.insertAdjacentElement('beforebegin',host);
      old.dataset.ohlcvReplaced='true';
      old.hidden=true;
      return;
    }
    // Fallback when the scanner layout differs: immediately after modal title.
    const h=Array.from(backdrop.querySelectorAll('h1,h2,h3')).find(x=>/USDT/.test(x.textContent||''));
    if(h?.parentElement&&h.parentElement!==backdrop){h.parentElement.insertAdjacentElement('afterend',host);return;}
    const actions=backdrop.querySelector('.modal-actions');
    if(actions){actions.insertAdjacentElement('beforebegin',host);return;}
    backdrop.append(host);
  }
  function makeChart(backdrop){
    const section=el('section','kchart');section.id='radarCandleChart';
    const head=el('div','kchart-head');
    const left=el('div','kchart-title');
    left.append(el('strong','', 'CARTA LIVE • KUCOIN SPOT'),el('span','kchart-desc','Candlestick sebenar • default 30m setiap candle'));
    const fresh=el('span','kchart-fresh','Menghubung…');
    head.append(left,fresh);
    const priceRow=el('div','kchart-price-row');
    const price=el('div','kchart-price','—');price.dataset.role='price';
    const move=el('div','kchart-change','—');move.dataset.role='move';
    const highLow=el('div','kchart-24h','High / Low 24j: —');highLow.dataset.role='range';
    priceRow.append(price,move,highLow);
    const controls=el('div','kchart-controls');
    TIMEFRAMES.forEach(tf=>{const b=el('button','kchart-tf'+(tf==='30m'?' active':''),tf);b.type='button';b.dataset.tf=tf;b.title=`Satu candle = ${tf}`;controls.append(b);});
    const refresh=el('button','kchart-refresh','↻ Refresh');refresh.type='button';refresh.dataset.action='refresh';controls.append(refresh);
    const legend=el('div','kchart-legend');legend.innerHTML='<span class="kchart-ma5">MA(5) <b data-ma="5">—</b></span><span class="kchart-ma10">MA(10) <b data-ma="10">—</b></span><span class="kchart-ma20">MA(20) <b data-ma="20">—</b></span>';
    const canvasWrap=el('div','kchart-canvas-wrap');
    const cvs=el('canvas','kchart-canvas');cvs.setAttribute('role','img');cvs.setAttribute('aria-label','Candlestick price chart with moving averages and trading volume');
    const floating=el('div','kchart-tooltip');floating.hidden=true;
    canvasWrap.append(cvs,floating);
    const footer=el('div','kchart-foot');
    footer.append(el('span','kchart-status','Menyediakan chart…'),el('span','kchart-volume','VOL  —'));
    const decision=el('div','kchart-decision');
    decision.innerHTML=`<div class="kchart-decision-head"><div><strong>ENTRY DECISION ASSISTANT</strong><span data-decision-sub>Semakan berdasarkan candle yang sudah tutup</span></div><b class="kchart-decision-badge" data-decision-badge>TUNGGU DATA</b></div>
      <div class="kchart-decision-grid">
        <div class="kchart-decision-metric"><small>Trend MA</small><b data-decision-trend>—</b><span data-decision-trend-note>—</span></div>
        <div class="kchart-decision-metric"><small>Volume candle siap</small><b data-decision-vol>—</b><span data-decision-vol-note>—</span></div>
        <div class="kchart-decision-metric"><small>Breakout scanner</small><b data-decision-break>—</b><span data-decision-break-note>—</span></div>
        <div class="kchart-decision-metric"><small>Status scanner</small><b data-decision-scanner>—</b><span data-decision-scanner-note>—</span></div>
      </div>
      <p class="kchart-decision-reason" data-decision-reason>Menunggu data carta yang mencukupi…</p>
      <div class="kchart-decision-action"><button type="button" data-action="paperlab">🧮 Kira Entry di PaperLab</button><span>Kalkulator sahaja · tiada pembelian automatik</span></div>
      <p class="kchart-decision-disclaimer">Penunjuk sokongan, bukan arahan trade. Trend &amp; volume adalah daripada timeframe carta; breakout ialah penapis scanner 1m/5m. Volume belum tutup tidak digunakan.</p>`;
    const notice=el('div','kchart-notice','Candle terakhir masih terbentuk. Refresh ±20 saat ketika popup aktif; bukan tick-by-tick. Status AVOID/WATCH bukan arahan beli.');
    section.append(head,priceRow,controls,legend,canvasWrap,footer,decision,notice);
    section.addEventListener('click',e=>{
      const b=e.target.closest('button');if(!b)return;
      if(b.dataset.tf){
        if(timeframe===b.dataset.tf)return;
        timeframe=b.dataset.tf;
        section.querySelectorAll('.kchart-tf').forEach(n=>n.classList.toggle('active',n.dataset.tf===timeframe));
        hoverIndex=-1;updateHeader();loadChart(true);
      }
      if(b.dataset.action==='refresh')loadChart(true);
      if(b.dataset.action==='paperlab')openPaperLabFromChart();
    });
    cvs.addEventListener('pointermove',e=>{
      if(!lastPlot||!renderedBars.length)return;
      const rect=cvs.getBoundingClientRect();const x=e.clientX-rect.left;
      const i=Math.round((x-lastPlot.left)/lastPlot.step-.5);
      hoverIndex=Math.max(0,Math.min(renderedBars.length-1,i));
      showHover(e.clientX-rect.left,e.clientY-rect.top);paint();
    });
    cvs.addEventListener('pointerleave',()=>{hoverIndex=-1;floating.hidden=true;paint();});
    insertChart(backdrop,section);
    chart=section;
    const resizer=new ResizeObserver(()=>{if(chart===section&&lastPayload)paint();});
    resizer.observe(canvasWrap);
    section._cleanup=()=>resizer.disconnect();
    return section;
  }
  function showHover(x,y){
    const a=renderedBars[hoverIndex];const tip=chart?.querySelector('.kchart-tooltip');
    if(!a||!tip)return;
    tip.hidden=false;
    tip.innerHTML='';
    const lines=[fmtTime(a.time),`O ${fmtPrice(a.open)}  H ${fmtPrice(a.high)}`,`L ${fmtPrice(a.low)}  C ${fmtPrice(a.close)}`,`VOL ${fmtCount(a.volume)}`];
    lines.forEach(line=>tip.append(el('div','',line)));
    const W=chart.querySelector('.kchart-canvas').clientWidth;
    tip.style.left=(x>W*.55?Math.max(8,x-176):Math.min(W-176,x+8))+'px';
    tip.style.top=Math.max(6,Math.min(y-108,180))+'px';
  }
  function paint(){
    const cvs=chart?.querySelector('canvas');
    if(!cvs||!lastPayload)return;
    const all=lastPayload.candles;
    const w=Math.max(260,Math.floor(cvs.getBoundingClientRect().width));
    const h=Math.max(300,Math.floor(cvs.getBoundingClientRect().height));
    const dpr=Math.min(window.devicePixelRatio||1,2);
    if(cvs.width!==Math.round(w*dpr)||cvs.height!==Math.round(h*dpr)){
      cvs.width=Math.round(w*dpr);cvs.height=Math.round(h*dpr);
    }
    const ctx=cvs.getContext('2d');if(!ctx)return;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    const left=11,right=w-76,top=14,priceBottom=Math.floor(h*.73),volTop=Math.floor(h*.81),volBottom=h-27;
    if(right-left<60)return;
    const count=Math.min(74,all.length),offset=all.length-count;
    const candles=all.slice(offset);
    renderedBars=candles;
    const arr=[];candles.forEach((c,i)=>{arr.push(c.high,c.low);for(const n of [5,10,20]){const ma=calcMA(all,offset+i,n);if(ma)arr.push(ma);}});
    let hi=Math.max(...arr),lo=Math.min(...arr);const gap=Math.max((hi-lo)*.10,hi*.00045);hi+=gap;lo-=gap;
    if(!(hi>lo))return;
    const py=v=>top+(hi-v)/(hi-lo)*(priceBottom-top);
    const step=(right-left)/count;lastPlot={left,step,right,top,priceBottom};
    ctx.font='11px system-ui,sans-serif';ctx.textBaseline='middle';
    for(let i=0;i<=4;i++){
      const yy=top+(priceBottom-top)*i/4;
      ctx.strokeStyle='rgba(113,148,177,.18)';ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(right,yy);ctx.stroke();
      ctx.fillStyle='#8fa8be';ctx.textAlign='left';ctx.fillText(fmtPrice(hi-(hi-lo)*i/4),right+7,yy);
    }
    const maxVol=Math.max(1,...candles.map(d=>d.volume));
    const barWidth=Math.max(1.2,Math.min(13,step*.60));
    ctx.textAlign='center';
    candles.forEach((c,i)=>{
      const x=left+step*(i+.5),yO=py(c.open),yC=py(c.close);
      const color=c.close>=c.open?GREEN:RED;
      ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=Math.max(1,step*.11);
      ctx.beginPath();ctx.moveTo(x,py(c.high));ctx.lineTo(x,py(c.low));ctx.stroke();
      ctx.fillRect(x-barWidth/2,Math.min(yO,yC),barWidth,Math.max(1.3,Math.abs(yO-yC)));
      const vH=(volBottom-volTop)*c.volume/maxVol;
      ctx.globalAlpha=.8;ctx.fillRect(x-barWidth/2,volBottom-vH,barWidth,vH);ctx.globalAlpha=1;
    });
    [5,10,20].forEach((n,k)=>{
      ctx.beginPath();let began=false;
      ctx.strokeStyle=MA_COLORS[k];ctx.lineWidth=1.5;
      candles.forEach((_,i)=>{const ma=calcMA(all,offset+i,n);if(!ma)return;const x=left+step*(i+.5),y=py(ma);if(!began){ctx.moveTo(x,y);began=true;}else ctx.lineTo(x,y);});
      if(began)ctx.stroke();
    });
    // Price marker from the scanner ticker (may be slightly ahead of OHLCV snapshot).
    if(lastPayload.lastPrice>lo&&lastPayload.lastPrice<hi){
      const yy=py(lastPayload.lastPrice);
      ctx.strokeStyle='#a9cdf1';ctx.setLineDash([4,4]);ctx.lineWidth=.9;
      ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(right,yy);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle='#1c364a';ctx.fillRect(right+3,yy-11,w-right-3,22);
      ctx.fillStyle='#e9f2ff';ctx.font='bold 11px system-ui,sans-serif';ctx.textAlign='left';ctx.fillText(fmtPrice(lastPayload.lastPrice),right+6,yy);
    }
    // Timestamp markers: based on actual candle open timestamps (MYT).
    ctx.textAlign='center';ctx.fillStyle='#8fa8be';ctx.font='10px system-ui,sans-serif';
    for(let i=0;i<count;i+=Math.max(1,Math.ceil(count/5))){
      const x=left+step*(i+.5);
      const d=new Date(candles[i].time);
      const label=d.toLocaleString('en-GB',{timeZone:'Asia/Kuala_Lumpur',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
      ctx.fillText(label,x,h-10);
    }
    ctx.textAlign='left';ctx.font='bold 10px system-ui,sans-serif';ctx.fillStyle='#7ba0b8';ctx.fillText('VOL',left,volTop-12);
    if(hoverIndex>=0&&hoverIndex<count){
      const candle=candles[hoverIndex],x=left+step*(hoverIndex+.5),y=py(candle.close);
      ctx.strokeStyle='rgba(219,241,255,.58)';ctx.setLineDash([2,5]);ctx.lineWidth=.75;
      ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,volBottom);ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.setLineDash([]);
    }
    lastCanvasWidth=w;
  }
  function updateHeader(){
    if(!chart)return;
    setText('.kchart-desc',`${activeSymbol} • setiap candle = ${timeframe} • KuCoin Spot`);
    if(!lastPayload){setText('[data-role="price"]','—');setText('[data-role="move"]','—');setText('[data-role="range"]','24j High / Low: —');}
  }
  function updateData(payload){
    if(!chart)return;
    lastPayload=payload;
    const bars=payload.candles||[];
    if(bars.length<2){setText('.kchart-status','Data candle tidak cukup untuk dipaparkan.');updateDecision(payload);return;}
    const change=(bars[bars.length-1].close/bars[0].open-1)*100;
    const number=Number.isFinite(payload.lastPrice)&&payload.lastPrice>0?payload.lastPrice:bars.at(-1).close;
    setText('[data-role="price"]',fmtPrice(number));
    const changeEl=chart.querySelector('[data-role="move"]');
    changeEl.textContent=`${change>=0?'+':''}${change.toFixed(2)}% · julat ${bars.length} candle`;
    changeEl.classList.toggle('up',change>=0);changeEl.classList.toggle('down',change<0);
    const last24=bars.filter(x=>x.time>=Date.now()-24*3600_000);
    setText('[data-role="range"]',last24.length?`24j High ${fmtPrice(Math.max(...last24.map(x=>x.high)))}  ·  Low ${fmtPrice(Math.min(...last24.map(x=>x.low)))}`:'Julat 24j tidak cukup data');
    for(const n of [5,10,20])setText(`[data-ma="${n}"]`,fmtPrice(calcMA(bars,bars.length-1,n)));
    setText('.kchart-volume',`VOL ${fmtCount(bars.at(-1).volume)} ${activeSymbol.split('-')[0]}`);
    setText('.kchart-fresh',payload.mock?'DATA DEMO':`LIVE • harga ${payload.ageSeconds}s lalu • chart ${payload.chartAgeSeconds}s lalu`);
    const status=payload.latestStatus||'DATA';
    const statusEl=chart.querySelector('.kchart-status');
    statusEl.textContent=`Penapis scanner: ${status}${status==='BUY'?' (semak butiran risiko dahulu)':' — bukan BUY disahkan'}`;
    statusEl.dataset.status=status;
    setText('.kchart-notice',payload.mock?'DATA SIMULASI — bukan harga pasaran sebenar.': 'Candle terbaru masih bergerak. Auto refresh ±20s ketika popup terbuka. Data awam bukan tick-by-tick atau harga order yang dijamin.');
    updateDecision(payload);
    paint();
  }
  function scannerRow(symbol) {
    try {
      if (typeof state !== 'undefined' && Array.isArray(state?.rows))
        return state.rows.find(r => r.symbol === symbol) || null;
    } catch (_) { /* Scanner may expose state only within its own scope. */ }
    return null;
  }
  function putDecision(field, text, tone) {
    const node=chart?.querySelector(`[data-decision-${field}]`);
    if (!node) return;
    node.textContent=String(text);
    node.dataset.tone=tone || 'neutral';
  }
  function lastCompletedIndex(bars) {
    if (!bars.length) return -1;
    const last=bars.length-1, interval=(TF_SECONDS[timeframe]||1800)*1000;
    // KuCoin candle 'time' is the candle OPEN, not its close.
    return bars[last].time + interval > Date.now() ? last-1 : last;
  }
  function updateDecision(payload) {
    const bars=payload.candles||[];
    const idx=lastCompletedIndex(bars);
    const status=String(payload.latestStatus||'DATA').toUpperCase();
    const row=scannerRow(activeSymbol);
    const breakout=String(row?.breakout?.signal||'').toUpperCase();
    const mock=!!payload.mock;
    const sufficient=idx>=20 && bars.length>=21;
    let trend='TIDAK CUKUP DATA', trendTone='neutral', trendNote='Perlu 20 candle siap';
    let isUp=false, volRatio=null, volumeStrong=false;
    if(sufficient) {
      const current=bars[idx];
      const ma5=calcMA(bars,idx,5),ma10=calcMA(bars,idx,10),ma20=calcMA(bars,idx,20);
      isUp=current.close>ma5 && ma5>ma10 && ma10>ma20;
      const down=current.close<ma5 && ma5<ma10 && ma10<ma20;
      trend=isUp?'BULLISH':down?'BEARISH':'BERCAMPUR';
      trendTone=isUp?'good':down?'bad':'warn';
      trendNote=`Candle siap: ${fmtPrice(current.close)} · MA5/10/20`;
      const previous=bars.slice(idx-10,idx).filter(x=>Number.isFinite(x.volume)&&x.volume>=0);
      if(previous.length===10) {
        const avg=previous.reduce((t,c)=>t+c.volume,0)/previous.length;
        if(avg>0 && Number.isFinite(current.volume)) {
          volRatio=current.volume/avg;
          volumeStrong=volRatio>=1.5;
        }
      }
    }
    putDecision('trend',trend,trendTone);
    putDecision('trend-note',trendNote);
    putDecision('vol',volRatio===null?'DATA TAK CUKUP':`${volRatio.toFixed(2)}× purata`,volRatio===null?'neutral':volumeStrong?'good':'warn');
    putDecision('vol-note',`${timeframe} · candle terakhir siap vs 10 sebelumnya · kuat ≥1.5×`);
    const breakoutKnown=!!breakout;
    const breakoutConfirmed=breakout==='BREAKOUT';
    const breakoutText=breakoutKnown?breakout:'RUJUK SCANNER';
    putDecision('break',breakoutText,breakoutConfirmed?'good':breakoutKnown?'warn':'neutral');
    putDecision('break-note',breakoutKnown?'Penapis 1m/5m · tidak sama dengan candle 30m':'Status breakout terperinci tidak tersedia');
    putDecision('scanner',status,status==='BUY'?'good':status==='AVOID'?'bad':'warn');
    putDecision('scanner-note',status==='BUY'?'BUY lulus penapis asal':status==='AVOID'?'Risiko / penapis scanner tidak lulus':'Belum ada BUY disahkan');
    let decision='TUNGGU', tone='warn', reason='Tunggu pengesahan penuh pada scanner sebelum mempertimbangkan entry.';
    if(mock){decision='DATA DEMO';tone='neutral';reason='Ini ialah data simulasi, bukan isyarat pasaran sebenar.';}
    else if(status==='AVOID'){
      decision='AVOID';tone='bad';reason='Scanner asal menandakan AVOID. Carta bullish tidak membatalkan penapis kecairan, spread dan risiko.';
    } else if(!sufficient){
      decision='DATA TAK CUKUP';tone='neutral';reason='Perlu sekurang-kurangnya 20 candle yang telah tutup untuk semak MA/volume.';
    } else if(status==='BUY' && isUp && volumeStrong && breakoutConfirmed){
      decision='SEMAK ENTRY';tone='good';reason='Scanner BUY disahkan, trend MA sehala, volume candle siap menyokong dan breakout terpantau. Semak spread, slippage dan risiko dahulu.';
    } else if(status==='BUY') {
      decision='BUY SCANNER · SEMAK';tone='warn';reason='Scanner menunjukkan BUY, tetapi sekurang-kurangnya satu daripada trend MA, volume atau pengesahan breakout carta belum menyokong.';
    } else if(isUp && volumeStrong) {
      decision='WATCH';tone='warn';reason='Trend/volume carta menyokong, tetapi scanner belum mengesahkan BUY. Elak entry berdasarkan candle semata-mata.';
    }
    const badge=chart?.querySelector('[data-decision-badge]');
    if(badge){badge.textContent=decision;badge.dataset.tone=tone;}
    putDecision('reason',reason);
    putDecision('sub',`${activeSymbol} · timeframe ${timeframe} · candle siap sahaja`);
  }
  function openPaperLabFromChart() {
    if(!validSymbol(activeSymbol))return;
    // Reuse the original PaperLab detail integration to preserve source, score,
    // manually set entry, TP/SL and fees when available.
    const original=document.getElementById('detailPaperLab');
    if(original && isPopupVisible()) { original.click(); return; }
    // Fallback when PaperLab integration was not installed on this scanner.
    const entry=Number(lastPayload?.ask)>0?Number(lastPayload.ask):Number(lastPayload?.lastPrice);
    if(!(entry>0)){alert('Harga belum tersedia. Refresh carta dahulu.');return;}
    const url=new URL('/paperlab/',location.origin);
    url.searchParams.set('symbol',activeSymbol);
    url.searchParams.set('entry',String(entry));
    url.searchParams.set('source','RADAR CHART');
    url.searchParams.set('signal',String(lastPayload?.latestStatus||'WATCH')==='BUY'?'BUY':'WATCH');
    url.searchParams.set('at',String(Date.now()));
    location.assign(url.href);
  }

  function clearPolling(){if(pollTimer){clearInterval(pollTimer);pollTimer=null;} if(currentFetch){currentFetch.abort();currentFetch=null;}}
  function beginPolling(){if(pollTimer)clearInterval(pollTimer);pollTimer=setInterval(()=>{if(isPopupVisible())loadChart(false);else clearPolling();},POLL_MS);}
  async function loadChart(manual){
    if(!chart||!activeSymbol||!isPopupVisible())return;
    if(currentFetch)currentFetch.abort();
    const seq=++requestId,controller=new AbortController();currentFetch=controller;
    const btn=chart.querySelector('[data-action="refresh"]');if(btn)btn.disabled=true;
    setText('.kchart-fresh',manual?'Memuat candle…':'Mengemas kini…');
    try {
      const url=new URL('/api/chart',location.origin);
      url.searchParams.set('symbol',activeSymbol);url.searchParams.set('tf',timeframe);
      const response=await fetch(url.href,{cache:'no-store',signal:controller.signal});
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);
      if(seq!==requestId||!chart||currentSymbol()!==activeSymbol)return;
      if(!Array.isArray(result.candles)||!result.candles.length)throw new Error('Tiada data candle.');
      updateData(result);
    } catch(err){
      if(err.name==='AbortError'||seq!==requestId)return;
      setText('.kchart-fresh','GAGAL LOAD');
      setText('.kchart-status','Carta tidak tersedia: '+String(err.message||err).slice(0,135));
      if(!lastPayload){const tip=chart.querySelector('.kchart-notice');if(tip)tip.textContent='Semak sambungan internet dan endpoint /api/chart. Data carta tidak direka atau dianggarkan.';}
    } finally {if(seq===requestId){currentFetch=null;if(btn)btn.disabled=false;}}
  }
  function destroyChart(){
    clearPolling();requestId++;activeSymbol='';lastPayload=null;hoverIndex=-1;renderedBars=[];lastPlot=null;
    if(chart){chart._cleanup?.();chart.remove();chart=null;}
    root=null;
    const backdrop=document.getElementById(BACKDROP_ID);
    backdrop?.querySelectorAll('[data-ohlcv-replaced="true"]').forEach(x=>{x.hidden=false;delete x.dataset.ohlcvReplaced;});
  }
  function watchPopup(){
    if(!isPopupVisible()){
      if(chart)destroyChart();
      return;
    }
    const backdrop=document.getElementById(BACKDROP_ID);const symbol=currentSymbol();
    if(!backdrop||!validSymbol(symbol))return;
    if(chart&&activeSymbol===symbol)return;
    if(chart)destroyChart();
    root=backdrop;activeSymbol=symbol;timeframe='30m';hoverIndex=-1;lastPayload=null;
    makeChart(backdrop);updateHeader();loadChart(true);beginPolling();
  }
  function install(){
    const backdrop=document.getElementById(BACKDROP_ID);
    if(backdrop){
      new MutationObserver(()=>{
        if(refreshTimer)clearTimeout(refreshTimer);
        refreshTimer=setTimeout(watchPopup,70);
      }).observe(backdrop,{attributes:true,attributeFilter:['class','style','aria-hidden','hidden'],childList:true,subtree:false});
    }
    document.addEventListener('click',()=>setTimeout(watchPopup,90),true);
    document.addEventListener('keydown',e=>{if(e.key==='Escape')setTimeout(watchPopup,80);});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){clearPolling();}else if(chart){loadChart(true);beginPolling();}});
    // Defensive check if original scanner switches modal elements without class mutations.
    setInterval(watchPopup,1600);
    watchPopup();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
