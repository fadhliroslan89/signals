'use strict';
/* Client dashboard. No access to any exchange account or order placement. */
const byId = id => document.getElementById(id);
const SETTINGS_KEY = 'kucoin-radar-settings-v1';
const FAVORITES_KEY = 'kucoin-radar-favorites-v1';
const SAFE = {minVolume:5_000_000,maxSpread:0.30,buy15:1.10,buy30:1.8,buy5:0.2,watch15:0.45,watch30:0.7};
let settings = {};
try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch {}
let favoriteList = [];
try { favoriteList = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); } catch {}
const favorites = new Set(Array.isArray(favoriteList) ? favoriteList : []);
const state = {rows:[],latest:null,filter:'ALL',search:'',sort:'rank',shown:50,initial:true, previous:new Map(), alertEnabled:false, sound:false, localAlerts:[], audio:null,modalSymbol:null};
const STATUS_ORDER = {BUY:0,WATCH:1,AVOID:2,DATA:3};
let cfg = {...SAFE};
function num(v){return typeof v==='number' && Number.isFinite(v) ? v : null;}
function currency(value){
  const n=num(value);if(n===null)return '—';
  if(n>=1e9)return '$'+(n/1e9).toFixed(2)+'B';
  if(n>=1e6)return '$'+(n/1e6).toFixed(2)+'M';
  if(n>=1e3)return '$'+(n/1e3).toFixed(1)+'K';
  return '$'+n.toFixed(0);
}
function price(value){
  const n=num(value);if(n===null)return '—';
  const d=n>=100?2:n>=1?4:n>=.01?6:9;
  return n.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:d});
}
function percent(value, digits=2){const n=num(value);return n===null?'—':`${n>=0?'+':''}${n.toFixed(digits)}%`;}
function timeText(at){return at?new Date(at).toLocaleTimeString('ms-MY',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';}
function scoreOf(r){
  if([r.m5,r.m15,r.m30,r.spread].some(v=>num(v)===null))return 0;
  const cap=(v)=>Math.max(0,Math.min(1,v));
  return Math.round(Math.min(100,cap(r.m15/3.2)*32+cap(r.m30/5)*20+cap(r.m5/.9)*18+cap((Math.log10(Math.max(1,r.volume))-5)/3)*15+cap(1-r.spread/Math.max(.01,cfg.maxSpread*2))*15+(r.m15>(r.m30-r.m15)+.05?4:0)));
}
function assess(r){
  if([r.m5,r.m15,r.m30,r.spread].some(v=>num(v)===null))return 'DATA';
  if(r.volume<cfg.minVolume||r.spread>cfg.maxSpread)return 'AVOID';
  if(r.m15>=cfg.buy15&&r.m30>=cfg.buy30&&r.m5>=cfg.buy5&&r.m15>(r.m30-r.m15)+.05)return 'BUY';
  if(r.m15>=cfg.watch15&&r.m30>=cfg.watch30&&r.m5>-.2)return 'WATCH';
  return 'AVOID';
}
function toast(message,error=false){
  const el=document.createElement('div');el.className=`toast${error?' error':''}`;el.textContent=message;byId('toastArea').append(el);
  setTimeout(()=>el.remove(),5000);
}
function alertSound(){
  try {
    const Ctx=window.AudioContext||window.webkitAudioContext;
    if(!Ctx)return;
    state.audio=state.audio||new Ctx();
    if(state.audio.state==='suspended')state.audio.resume();
    const t=state.audio.currentTime;
    [0,0.16].forEach((delay,i)=>{
      const o=state.audio.createOscillator();const g=state.audio.createGain();
      o.type='sine';o.frequency.value=i?850:700;
      g.gain.setValueAtTime(0.0001,t+delay);g.gain.exponentialRampToValueAtTime(.09,t+delay+.014);g.gain.exponentialRampToValueAtTime(.0001,t+delay+.14);
      o.connect(g).connect(state.audio.destination);o.start(t+delay);o.stop(t+delay+.15);
    });
  } catch {}
}
function browserAlert(r){
  state.localAlerts.unshift({symbol:r.symbol,at:Date.now(),price:r.price,m15:r.m15,m30:r.m30});
  state.localAlerts=state.localAlerts.slice(0,20);
  toast(`BUY signal: ${r.symbol} • 15m ${percent(r.m15)} • ${price(r.price)} USDT`);
  if(state.sound)alertSound();
  if(state.alertEnabled&&'Notification' in window&&Notification.permission==='granted'){
    try { const note=new Notification(`KuCoin Radar • ${r.symbol} BUY`,{body:`15m ${percent(r.m15)} | 30m ${percent(r.m30)} | USDT ${price(r.price)}. Semak sebelum trade.`,icon:'/icon.svg',tag:`signal-${r.symbol}`});note.onclick=()=>{window.focus();openDetail(r.symbol);note.close();};}catch{}
  }
}
function handleSignals(rows){
  if(state.initial){rows.forEach(r=>state.previous.set(r.symbol,r.status));state.initial=false;return;}
  for(const r of rows){
    const old=state.previous.get(r.symbol);
    if(state.alertEnabled && !state.latest?.mock && r.status==='BUY' && old && old!=='BUY') browserAlert(r);
    state.previous.set(r.symbol,r.status);
  }
}
function persistSettings(){
  localStorage.setItem(SETTINGS_KEY,JSON.stringify({minVolume:cfg.minVolume,maxSpread:cfg.maxSpread,buy15:cfg.buy15,alertEnabled:state.alertEnabled,sound:state.sound}));
}
function initializeControls(){
  cfg.minVolume=Number(settings.minVolume)||SAFE.minVolume;
  cfg.maxSpread=Number(settings.maxSpread)||SAFE.maxSpread;
  cfg.buy15=Number(settings.buy15)||SAFE.buy15;
  for(const [id,key] of [['minVolume','minVolume'],['maxSpread','maxSpread'],['minMomentum','buy15']]){
    const select=byId(id); select.value=String(cfg[key]);
    select.addEventListener('change',()=>{cfg[key]=Number(select.value);persistSettings();recompute(false);});
  }
  byId('soundButton').addEventListener('click',()=>{state.sound=!state.sound;byId('soundButton').textContent=state.sound?'♫ Bunyi ON':'♫ Bunyi OFF';byId('soundButton').setAttribute('aria-pressed',String(state.sound));if(state.sound)alertSound();persistSettings();});
  byId('alertSwitch').addEventListener('change',async e=>{
    if(e.target.checked){
      if(!('Notification' in window)){e.target.checked=false;toast('Browser ini tidak menyokong notifikasi.',true);return;}
      if(!window.isSecureContext){e.target.checked=false;toast('Notifikasi browser memerlukan HTTPS atau localhost. Gunakan Telegram untuk alert 24/7.',true);return;}
      let permission=Notification.permission;
      if(permission!=='granted')permission=await Notification.requestPermission();
      if(permission!=='granted'){e.target.checked=false;toast('Kebenaran notifikasi tidak diberikan.',true);return;}
    }
    state.alertEnabled=e.target.checked;persistSettings();toast(state.alertEnabled?'Alert browser aktif (selagi laman terbuka).':'Alert browser dimatikan.');
  });
  if(settings.sound===true){state.sound=true;byId('soundButton').textContent='♫ Bunyi ON';byId('soundButton').setAttribute('aria-pressed','true');}
  if(settings.alertEnabled&&'Notification' in window&&Notification.permission==='granted'&&window.isSecureContext){state.alertEnabled=true;byId('alertSwitch').checked=true;}
  for(const btn of document.querySelectorAll('.tab'))btn.addEventListener('click',()=>{
    state.filter=btn.dataset.filter;state.shown=50;document.querySelectorAll('.tab').forEach(el=>el.classList.toggle('active',el===btn));render();
  });
  byId('search').addEventListener('input',e=>{state.search=e.target.value.trim().toUpperCase();state.shown=50;render();});
  byId('sortBy').addEventListener('change',e=>{state.sort=e.target.value;render();});
  byId('refresh').addEventListener('click',()=>fetchData(true));
  byId('loadMore').addEventListener('click',()=>{state.shown+=50;render();});
  byId('closeDetail').addEventListener('click',closeDetail);
  byId('detailBackdrop').addEventListener('click',e=>{if(e.target===byId('detailBackdrop'))closeDetail();});
  window.addEventListener('keydown',e=>{if(e.key==='Escape')closeDetail();});
  byId('radarRows').addEventListener('click',e=>{
    const fav=e.target.closest('button[data-favorite]');
    if(fav){const sym=fav.dataset.favorite;if(favorites.has(sym))favorites.delete(sym);else favorites.add(sym);localStorage.setItem(FAVORITES_KEY,JSON.stringify([...favorites]));render();return;}
    const detail=e.target.closest('button[data-detail]');if(detail)openDetail(detail.dataset.detail);
  });
  byId('year').textContent=String(new Date().getFullYear());
  setInterval(()=>byId('clock').textContent=timeText(Date.now()),1000);
  byId('clock').textContent=timeText(Date.now());
}
function recompute(allowAlert=true){
  state.rows=(state.latest?.rows||[]).map(r=>({...r,status:assess(r),score:scoreOf(r)}));
  if(allowAlert && state.latest?.updatedAt && Date.now()-state.latest.updatedAt<90000 && !state.latest?.error) handleSignals(state.rows);
  else for(const r of state.rows) state.previous.set(r.symbol,r.status);
  render();
}
async function fetchData(manual=false){
  try{
    const response=await fetch('/api/status',{cache:'no-store',signal:AbortSignal.timeout(16000)});
    if(!response.ok)throw new Error(`Server HTTP ${response.status}`);
    const data=await response.json();
    state.latest=data;
    recompute();
    if(manual)toast('Data dashboard dikemas kini.');
  } catch(err){
    const notice=byId('errorNotice');notice.textContent=`Tidak dapat menghubungi server scanner: ${err.message}. Pastikan server sedang berjalan.`;notice.classList.remove('hidden');
    byId('connection').classList.add('offline');byId('connection').querySelector('span').textContent='OFFLINE';
    if(manual)toast('Kemas kini gagal.',true);
  }
}
function node(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=String(text);return el;}
function pCell(value){return node('span',num(value)===null?'move-neutral':value>0?'move-up':value<0?'move-down':'move-neutral',percent(value));}
function td(value,cls){return node('td',cls||'',value);}
function renderRows(){
  const all=state.rows;
  let rows=all.filter(r=>(!state.search||r.symbol.includes(state.search)) && (state.filter==='ALL'||(state.filter==='FAV'?favorites.has(r.symbol):r.status===state.filter)));
  const metric=state.sort==='m15'?'m15':state.sort==='m30'?'m30':state.sort==='volume'?'volume':state.sort==='spread'?'spread':'score';
  rows.sort((a,b)=>{
    if(state.sort==='rank')return STATUS_ORDER[a.status]-STATUS_ORDER[b.status]||b.score-a.score||b.volume-a.volume;
    return metric==='spread'?(num(a.spread)??Infinity)-(num(b.spread)??Infinity):(num(b[metric])??-Infinity)-(num(a[metric])??-Infinity);
  });
  const showing=rows.slice(0,state.shown);
  const frag=document.createDocumentFragment();
  for(const r of showing){
    const tr=node('tr');
    const first=td();const cell=node('div','paircell');
    const star=node('button','star-btn'+(favorites.has(r.symbol)?' saved':''),favorites.has(r.symbol)?'★':'☆');star.type='button';star.title='Favorit';star.dataset.favorite=r.symbol;
    const coin=node('span','coin-icon',r.symbol.split('-')[0].slice(0,3));const names=node('div');names.append(node('div','coin-name',r.symbol),node('div','pair-sub','KUCOIN • SPOT'));
    cell.append(star,coin,names);first.append(cell);tr.append(first);
    tr.append(td(price(r.price),'price-cell'));
    for(const period of ['m5','m15','m30']){const c=td();c.append(pCell(r[period]));tr.append(c);}
    tr.append(td(currency(r.volume)));
    tr.append(td(num(r.spread)===null?'—':r.spread.toFixed(3)+'%'));
    const score=td();const meter=node('span','rank');const bar=node('span','rank-bar');const amount=node('i');amount.style.width=r.score+'%';bar.append(amount);meter.append(node('span','',r.score),bar);score.append(meter);tr.append(score);
    const status=td();status.append(node('span','pill '+r.status.toLowerCase(),r.status));tr.append(status);
    const act=td();const btn=node('button','detail-btn','Detail ↗');btn.dataset.detail=r.symbol;btn.type='button';act.append(btn);tr.append(act);
    frag.append(tr);
  }
  if(!showing.length){const tr=node('tr');const c=td('Tiada coin memenuhi penapis sekarang. Cuba tukar filter atau tunggu data terkini.','empty-table');c.colSpan=10;tr.append(c);frag.append(tr);}
  byId('radarRows').replaceChildren(frag);
  byId('resultNum').textContent=rows.length.toLocaleString('en-US');
  byId('shownCount').textContent=`Paparan ${showing.length}/${rows.length} coin`;
  byId('loadMoreWrap').classList.toggle('hidden',showing.length>=rows.length);
}
function renderAlerts(){
  const server=state.latest?.alerts||[];
  const combined=[...state.localAlerts,...server].sort((a,b)=>b.at-a.at).filter((a,i,arr)=>arr.findIndex(x=>x.symbol===a.symbol&&Math.abs(x.at-a.at)<1000)===i).slice(0,7);
  const list=byId('recentAlerts');
  if(!combined.length){list.replaceChildren(node('div','no-alert','Belum ada signal BUY untuk dipaparkan.'));return;}
  const frag=document.createDocumentFragment();
  for(const item of combined){const entry=node('div','alert-item');const label=node('span');label.append(node('strong','',item.symbol+' • BUY'),node('span','',`  15m ${percent(item.m15)}`));entry.append(label,node('time','',timeText(item.at)));frag.append(entry);}
  list.replaceChildren(frag);
}
function render(){
  const data=state.latest;
  if(!data)return;
  const age=data.updatedAt?Math.max(0,Math.round((Date.now()-data.updatedAt)/1000)):null;
  const live=data.updatedAt && age<=90 && !data.error;
  const conn=byId('connection');conn.classList.toggle('offline',!live);conn.querySelector('span').textContent=data.mock?'DEMO DATA':live?'LIVE KUCOIN':'DATA TERGANGGU';
  const notice=byId('errorNotice');notice.classList.toggle('hidden',!data.error);notice.textContent=data.error?`KuCoin gagal dikemas kini: ${data.error}. Data lama mungkin terpapar; jangan trade berdasarkan data lapuk.`:'';
  byId('pairCount').textContent=data.pairs?.toLocaleString('en-US')||'—';
  byId('loadedCount').textContent=`${data.fetched||0} pair dengan ticker`;
  const buy=state.rows.filter(r=>r.status==='BUY').length;const watch=state.rows.filter(r=>r.status==='WATCH').length;
  byId('buyCount').textContent=String(buy);byId('watchCount').textContent=String(watch);
  byId('tabBuy').textContent=String(buy);byId('tabWatch').textContent=String(watch);
  byId('lastUpdate').textContent=timeText(data.updatedAt);
  byId('warmupInfo').textContent=age===null?'Menunggu API':`${age}s lalu${age>90?' • LAPUK':''}`;
  const boot=data.bootstrap || {};const done=boot.done||0;const total=boot.total||0;
  const pending=total && done<total;
  const bootNote=byId('bootNotice');
  bootNote.classList.toggle('hidden',!pending&&!data.mock&&!!data.updatedAt);
  bootNote.textContent=data.mock?'MOD DEMO: Ini data ujian, BUKAN harga KuCoin semasa. Matikan MOCK_KUCOIN untuk live.':pending?`Sejarah 1-minit sedang disediakan: ${done}/${total} pair (${Math.round(done/total*100)}%). Pair belum selesai akan ditanda DATA. Kegagalan: ${boot.failures||0}.`:'Menunggu data pasaran KuCoin...';
  byId('tgChip').textContent=data.telegramEnabled?'TELEGRAM ON':'BROWSER';
  renderRows();renderAlerts();
}
async function openDetail(symbol){
  const row=state.rows.find(r=>r.symbol===symbol);if(!row)return;
  state.modalSymbol=symbol;
  byId('detailBackdrop').classList.remove('hidden');document.body.style.overflow='hidden';
  byId('detailTitle').textContent=symbol;byId('detailPrice').textContent=price(row.price)+' USDT';
  byId('detailStatus').className='pill '+row.status.toLowerCase();byId('detailStatus').textContent=row.status;
  for(const [name,value] of [['detailM5',row.m5],['detailM15',row.m15],['detailM30',row.m30]]){
    const el=byId(name);el.textContent=percent(value);el.className=num(value)===null?'move-neutral':value>=0?'move-up':'move-down';
  }
  byId('detailSpread').textContent=num(row.spread)===null?'—':row.spread.toFixed(3)+'%';
  byId('detailTP').textContent=price(row.price*1.035)+' USDT';byId('detailSL').textContent=price(row.price*.988)+' USDT';
  byId('openKucoin').href=`https://www.kucoin.com/trade/${encodeURIComponent(row.symbol)}`;
  byId('openTradingview').href=`https://www.tradingview.com/chart/?symbol=${encodeURIComponent('KUCOIN:'+row.symbol.replace('-',''))}`;
  byId('detailChart').replaceChildren();byId('chartInfo').textContent='Memuatkan sejarah harga...';
  try{
    const res=await fetch('/api/history?symbol='+encodeURIComponent(symbol),{cache:'no-store'});
    const data=await res.json();if(state.modalSymbol!==symbol)return;
    renderChart(data.points||[]);
  }catch{byId('chartInfo').textContent='Graf tidak tersedia.';}
}
function renderChart(points){
  const svg=byId('detailChart');svg.replaceChildren();
  const recent=points.slice(-100);
  if(recent.length<3){byId('chartInfo').textContent='Sejarah belum tersedia, tunggu bootstrap selesai.';return;}
  const width=580,height=128,pad=8;const vals=recent.map(p=>p.price);
  const min=Math.min(...vals),max=Math.max(...vals);const d=Math.max(.00000000001,max-min);
  const sx=i=>pad+(i/(recent.length-1))*(width-pad*2);
  const sy=v=>height-pad-((v-min)/d)*(height-pad*2);
  const svgNS='http://www.w3.org/2000/svg';
  for(let k=1;k<=3;k++){const l=document.createElementNS(svgNS,'line');l.setAttribute('x1',pad);l.setAttribute('x2',width-pad);l.setAttribute('y1',String(k*height/4));l.setAttribute('y2',String(k*height/4));l.setAttribute('stroke','#284a51');l.setAttribute('stroke-dasharray','3 5');svg.append(l);}
  const poly=document.createElementNS(svgNS,'polyline');poly.setAttribute('points',recent.map((p,i)=>sx(i)+','+sy(p.price)).join(' '));poly.setAttribute('fill','none');poly.setAttribute('stroke',vals.at(-1)>=vals[0]?'#1fe6ad':'#ff7890');poly.setAttribute('stroke-width','2.6');poly.setAttribute('stroke-linejoin','round');poly.setAttribute('stroke-linecap','round');svg.append(poly);
  byId('chartInfo').textContent=`${recent.length} data harga (1m candle + snapshot) • ${timeText(recent[0].time)}–${timeText(recent.at(-1).time)}`;
}
function closeDetail(){state.modalSymbol=null;byId('detailBackdrop').classList.add('hidden');document.body.style.overflow='';}
initializeControls();fetchData();setInterval(()=>fetchData(false),20_000);
