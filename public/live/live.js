"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const nowMY = ms=>new Intl.DateTimeFormat('ms-MY',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(ms));
  const rounded = n=>typeof n==='number'&&Number.isFinite(n)?`${n>=0?'+':''}${n.toFixed(2)}%`:'—';
  let wakeLock=null,stayAwake=false;
  function setText(id,s){$(id).textContent=String(s);}
  function stale(message){$('server').className='server offline';setText('server','OFFLINE / DATA LAPUK');$('risk').className='risk risk-off';setText('riskTitle','NO TRADE — DATA TIDAK SAH');setText('riskReason',message);setText('coins','');const d=document.createElement('div');d.className='empty';d.textContent='Tiada coin ditunjukkan apabila data lapuk atau sambungan terputus.';$('coins').replaceChildren(d);setText('count',0);setText('updated','—');}
  async function update(){
    try{
      const res=await fetch('/api/widget/summary',{cache:'no-store',signal:AbortSignal.timeout(12000)});
      if(!res.ok)throw Error('Server tidak menjawab ('+res.status+')');
      const d=await res.json();
      if(!d || d.marketFresh!==true || !d.updatedAt || Date.now()-d.updatedAt>90000){stale('Data pasaran tidak segar. Tiada signal sah semasa offline.');return;}
      const gate=d.risk||{};
      $('server').className='server online';setText('server',d.source==='DEMO'?'DEMO — BUKAN LIVE':'KUCOIN LIVE');
      const blocked=gate.buyAllowed!==true || d.source==='DEMO';
      $('risk').className='risk '+(blocked?'risk-off':'risk-readonly');
      setText('riskTitle',blocked?'NO TRADE — BUY DITAHAN':'RESEARCH ONLY — PENAPIS LULUS');
      setText('riskReason',gate.reason||'Penilaian pasaran untuk pemerhatian sahaja');
      setText('pairs',d.pairs||0);setText('updated',nowMY(d.updatedAt));setText('updatedAt','Data KuCoin: '+nowMY(d.updatedAt)+' MYT · kemas kini halaman ~20 saat');
      const cards=(Array.isArray(d.top)?d.top:[]).slice(0,3).map((c,i)=>{
        const el=document.createElement('article');el.className='coin';
        const head=document.createElement('div');head.className='coin-head';
        const symbol=document.createElement('span');symbol.className='symbol';symbol.textContent=`#${i+1} ${String(c.symbol).replace('-USDT','')}`;
        const tag=document.createElement('span');tag.className='tag';tag.textContent=blocked?'PANTAU':String(c.status||'RADAR');
        head.append(symbol,tag);el.append(head);
        const nums=document.createElement('div');nums.className='coin-numbers';
        for(const [label,val,color] of [['MOMENTUM 15M',rounded(c.m15),c.m15<0?'down':'up'],['SKOR PENAPIS',String(c.score)+'/100','']]) {
          const box=document.createElement('div');const small=document.createElement('small');small.textContent=label;const strong=document.createElement('strong');strong.className=color;strong.textContent=val;box.append(small,strong);nums.append(box);
        }el.append(nums);return el;
      });
      if(cards.length===0){const empty=document.createElement('div');empty.className='empty';empty.textContent='Tiada coin memenuhi saringan volume dan spread ketika ini.';cards.push(empty);}
      $('coins').replaceChildren(...cards);setText('count',(d.top||[]).length);
      setText('warning',d.source==='DEMO'?'DATA DEMO — jangan gunakan untuk trading.':'Pemerhatian sahaja. Tiada auto-order. Skor bukan kebarangkalian untung. NO TRADE sentiasa diutamakan.');
    }catch(err){stale('Sambungan gagal: '+String(err.message).slice(0,100));}
  }
  async function holdScreen(){
    try{if(!('wakeLock' in navigator)){throw Error('Wake Lock tidak disokong oleh browser ini');}wakeLock=await navigator.wakeLock.request('screen');stayAwake=true;$('wakeBtn').classList.add('active');$('wakeBtn').setAttribute('aria-pressed','true');$('wakeBtn').textContent='☀ Skrin ON ✓';wakeLock.addEventListener('release',()=>{wakeLock=null;});}catch(err){stayAwake=false;$('wakeBtn').textContent='Skrin ON tidak tersedia';}
  }
  $('wakeBtn').addEventListener('click',async()=>{if(stayAwake){stayAwake=false;try{await wakeLock?.release();}catch(_){}wakeLock=null;$('wakeBtn').classList.remove('active');$('wakeBtn').setAttribute('aria-pressed','false');$('wakeBtn').textContent='☀ Skrin ON';}else await holdScreen();});
  $('fullScreenBtn').addEventListener('click',async()=>{try{if(document.fullscreenElement){await document.exitFullscreen();}else await document.documentElement.requestFullscreen();}catch(_){} });
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){update();if(stayAwake&&!wakeLock)holdScreen();}});
  setText('clock',nowMY(Date.now())+' MYT');setInterval(()=>setText('clock',nowMY(Date.now())+' MYT'),1000);
  update();setInterval(()=>{if(document.visibilityState==='visible')update();},20000);
  if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(()=>{});
})();