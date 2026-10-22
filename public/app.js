'use strict';
/* Client dashboard. No access to any exchange account or order placement. */
const byId = id => document.getElementById(id);
const SETTINGS_KEY = 'kucoin-radar-settings-v1';
const FAVORITES_KEY = 'kucoin-radar-favorites-v1';
const EARLY_COOLDOWN_KEY = 'kucoin-radar-early-cooldown-v13';
const BREAKOUT_COOLDOWN_KEY = 'kucoin-radar-breakout-cooldown-v14';
const HITRUN_SETTINGS_KEY = 'kucoin-radar-hitrun-settings-v19';
let hitrunSettings = {gain:10,limit:10,sort:'active'};
try { const saved=JSON.parse(localStorage.getItem(HITRUN_SETTINGS_KEY)||'{}'); if(saved && typeof saved==='object') { if([10,15,20].includes(saved.gain))hitrunSettings.gain=saved.gain; if(['active','breakout','volume','gain'].includes(saved.sort))hitrunSettings.sort=saved.sort; }} catch {}
const SAFE = {minVolume:5_000_000,maxSpread:0.30,buy15:1.10,buy30:1.8,buy5:0.2,watch15:0.45,watch30:0.7};
let settings = {};
try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch {}
let favoriteList = [];
try { favoriteList = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); } catch {}
const favorites = new Set(Array.isArray(favoriteList) ? favoriteList : []);
const state = {rows:[],latest:null,filter:'ALL',search:'',sort:'rank',shown:50,initial:true, previous:new Map(),previousEarly:new Map(),lastEarly:new Map(),previousBreakout:new Map(),lastBreakout:new Map(), alertEnabled:false,earlyEnabled:false,breakoutEnabled:false,sound:false, localAlerts:[], audio:null,modalSymbol:null};
try { const old=JSON.parse(localStorage.getItem(EARLY_COOLDOWN_KEY)||'[]'); if(Array.isArray(old))state.lastEarly=new Map(old.filter(x=>Array.isArray(x)&&typeof x[0]==='string'&&Number.isFinite(x[1]))); } catch {}
try { const saved=JSON.parse(localStorage.getItem(BREAKOUT_COOLDOWN_KEY)||'[]');if(Array.isArray(saved))state.lastBreakout=new Map(saved.filter(x=>Array.isArray(x)&&typeof x[0]==='string'&&Number.isFinite(x[1]))); } catch {}
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
  const base=cap(r.m15/3.2)*32+cap(r.m30/5)*20+cap(r.m5/.9)*18+cap((Math.log10(Math.max(1,r.volume))-5)/3)*15+cap(1-r.spread/Math.max(.01,cfg.maxSpread*2))*15+(r.m15>(r.m30-r.m15)+.05?4:0);
  const m=window.RadarAcceleration?.metrics(r);
  const shortTerm=m?Math.max(-12,Math.min(8,m.delta*12))+(r.m1<0?-5:r.m1>=.10?2:0):0;
  return Math.round(Math.max(0,Math.min(100,base+shortTerm)));
}
function assess(r){
  return window.RadarEntryQuality.evaluate(r,cfg).status;
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
  toast(`BUY disahkan (bukan jaminan): ${r.symbol} • breakout + RVOL • ${price(r.price)} USDT`);
  if(state.sound)alertSound();
  if(state.alertEnabled&&'Notification' in window&&Notification.permission==='granted'){
    try { const note=new Notification(`KuCoin Radar • ${r.symbol} BUY`,{body:`15m ${percent(r.m15)} | 30m ${percent(r.m30)} | USDT ${price(r.price)}. Semak sebelum trade.`,icon:'/icon.svg',tag:`signal-${r.symbol}`});note.onclick=()=>{window.focus();openDetail(r.symbol);note.close();};}catch{}
  }
}
function earlyBrowserAlert(r){
  const m=window.RadarAcceleration?.metrics(r);
  state.localAlerts.unshift({symbol:r.symbol,at:Date.now(),price:r.price,m15:r.m15,m30:r.m30,type:'EARLY'});
  state.localAlerts=state.localAlerts.slice(0,20);
  toast(`EARLY WATCH (BUKAN BUY): ${r.symbol} • pecutan ${m?percent(m.delta):'—'} mata peratus`);
  if(state.sound)alertSound();
  if(state.alertEnabled && state.earlyEnabled && 'Notification' in window && Notification.permission==='granted'){
    try { const note=new Notification(`EARLY WATCH • ${r.symbol} (bukan BUY)`,{body:`Momentum mempercepat. Belum ada signal BUY. 15m ${percent(r.m15)}. Semak chart.`,icon:'/icon.svg',tag:`early-${r.symbol}`}); note.onclick=()=>{window.focus();openDetail(r.symbol);note.close();}; }catch{}
  }
}
function breakoutLabel(b){if(!b)return 'NONE';return b.signal||'NONE';}
function breakoutEventTime(b){return b?.five && b.at5>=b.at1?b.at5:(b?.at1||b?.at5||0);}
function breakoutBrowserAlert(r){
  const b=r.breakout;
  state.localAlerts.unshift({symbol:r.symbol,at:Date.now(),price:r.price,m15:r.m15,m30:r.m30,type:'BREAKOUT'});
  state.localAlerts=state.localAlerts.slice(0,20);
  toast(`BREAKOUT CANDLE (BUKAN BUY): ${r.symbol} • ${b.signal} • RVOL 1m ${b.rvol1?.toFixed(1)||'—'}×`);
  if(state.sound)alertSound();
  if(state.alertEnabled && state.breakoutEnabled && 'Notification' in window && Notification.permission==='granted'){
    try{const note=new Notification(`🚀 ${r.symbol} • ${b.signal} (bukan BUY)`,{body:`Breakout candle + volume. RVOL 1m ${b.rvol1?.toFixed(2)||'—'}×. Sahkan pada chart sebelum trading.`,icon:'/icon.svg',tag:`breakout-${r.symbol}`});note.onclick=()=>{window.focus();openDetail(r.symbol);note.close();};}catch{}
  }
}
function checkBreakoutAlerts(rows){
  const next=new Map();const now=Date.now();
  for(const r of rows){
    const b=r.breakout;
    if(!b || b.coverage!=='READY') continue;
    const tag=b.signal.startsWith('BREAKOUT')?`${b.signal}:${b.one?b.at1:''}:${b.five?b.at5:''}`:'SETUP';
    next.set(r.symbol,tag);
    const before=state.previousBreakout.get(r.symbol);
    if(!state.initial && state.breakoutEnabled && state.alertEnabled && !state.latest?.mock && b.signal.startsWith('BREAKOUT') && r.status!=='BUY' && before!==undefined && before!==tag){
      const eventAt=breakoutEventTime(b);
      const cool=state.lastBreakout.get(r.symbol)||0;
      if(eventAt>0 && now-eventAt<=130_000 && now-cool>15*60_000){
        breakoutBrowserAlert(r);state.lastBreakout.set(r.symbol,now);
      }
    }
  }
  state.previousBreakout=next;
  if(state.lastBreakout.size){
    const keep=[...state.lastBreakout].filter(([,at])=>now-at<24*60*60_000).slice(-500);
    state.lastBreakout=new Map(keep);localStorage.setItem(BREAKOUT_COOLDOWN_KEY,JSON.stringify(keep));
  }
}
function earlyCandidates(rows){
 const chosen=window.RadarTop10?.choose(rows,cfg)?.leaders || [];
 return chosen.filter(r=>window.RadarAcceleration?.nearBuy(r,cfg));
}
function handleSignals(rows){
  checkBreakoutAlerts(rows);
  const early=earlyCandidates(rows);
  const active=new Set(early.map(r=>r.symbol));
  if(state.initial){rows.forEach(r=>state.previous.set(r.symbol,r.status));for(const r of early)state.previousEarly.set(r.symbol,true);state.initial=false;return;}
  for(const r of rows){
    const old=state.previous.get(r.symbol);
    if(state.alertEnabled && !state.latest?.mock && r.status==='BUY' && old && old!=='BUY') browserAlert(r);
    state.previous.set(r.symbol,r.status);
  }
  if(state.alertEnabled && state.earlyEnabled && !state.latest?.mock){
    let emitted=0;
    for(const r of early){
      const last=state.lastEarly.get(r.symbol)||0;
      if(!state.previousEarly.has(r.symbol) && Date.now()-last>15*60_000 && emitted<2){
        earlyBrowserAlert(r);state.lastEarly.set(r.symbol,Date.now());emitted++;
      }
    }
    if(emitted){
      const keep=[...state.lastEarly].filter(([,at])=>Date.now()-at<24*60*60_000).slice(-500);
      state.lastEarly=new Map(keep);localStorage.setItem(EARLY_COOLDOWN_KEY,JSON.stringify(keep));
    }
  }
  state.previousEarly=new Map([...active].map(symbol=>[symbol,true]));
}
function persistSettings(){
  localStorage.setItem(SETTINGS_KEY,JSON.stringify({minVolume:cfg.minVolume,maxSpread:cfg.maxSpread,buy15:cfg.buy15,alertEnabled:state.alertEnabled,earlyEnabled:state.earlyEnabled,breakoutEnabled:state.breakoutEnabled,sound:state.sound}));
}
function initializeControls(){
  cfg.minVolume=Number(settings.minVolume)||SAFE.minVolume;
  cfg.maxSpread=Number(settings.maxSpread)||SAFE.maxSpread;
  cfg.buy15=Number(settings.buy15)||SAFE.buy15;
  for(const [id,key] of [['minVolume','minVolume'],['maxSpread','maxSpread'],['minMomentum','buy15']]){
    const select=byId(id); select.value=String(cfg[key]);
    select.addEventListener('change',()=>{cfg[key]=Number(select.value);persistSettings();recompute(false);state.previousEarly=new Map(earlyCandidates(state.rows).map(r=>[r.symbol,true]));});
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
    state.alertEnabled=e.target.checked;
    if(!state.alertEnabled){state.earlyEnabled=false;byId('earlySwitch').checked=false;state.breakoutEnabled=false;byId('breakoutSwitch').checked=false;}
    persistSettings();toast(state.alertEnabled?'Alert browser aktif (selagi laman terbuka).':'Alert browser dimatikan.');
  });
  byId('earlySwitch').addEventListener('change',e=>{
    if(e.target.checked&&!state.alertEnabled){e.target.checked=false;toast('Aktifkan Alert browser dahulu untuk Early WATCH.',true);return;}
    state.earlyEnabled=e.target.checked;
    // Baseline existing early conditions rather than triggering historical notifications.
    state.previousEarly=new Map(earlyCandidates(state.rows).map(r=>[r.symbol,true]));
    persistSettings();toast(state.earlyEnabled?'Early WATCH alert aktif — bukan signal BUY.':'Early WATCH alert dimatikan.');
  });
  byId('breakoutSwitch').addEventListener('change',e=>{
    if(e.target.checked&&!state.alertEnabled){e.target.checked=false;toast('Aktifkan Alert browser dahulu.',true);return;}
    state.breakoutEnabled=e.target.checked;
    // Baseline current breakouts: never notify on historical/past events when enabling.
    state.previousBreakout=new Map(state.rows.filter(r=>r.breakout?.coverage==='READY').map(r=>[r.symbol,r.breakout.signal.startsWith('BREAKOUT')?`${r.breakout.signal}:${r.breakout.one?r.breakout.at1:''}:${r.breakout.five?r.breakout.at5:''}`:'SETUP']));
    persistSettings();toast(state.breakoutEnabled?'Breakout candle alert aktif (bukan BUY).':'Breakout alert dimatikan.');
  });
  if(settings.sound===true){state.sound=true;byId('soundButton').textContent='♫ Bunyi ON';byId('soundButton').setAttribute('aria-pressed','true');}
  if(settings.alertEnabled&&'Notification' in window&&Notification.permission==='granted'&&window.isSecureContext){state.alertEnabled=true;byId('alertSwitch').checked=true;}
  if(state.alertEnabled && settings.breakoutEnabled===true){state.breakoutEnabled=true;byId('breakoutSwitch').checked=true;}
  if(state.alertEnabled && settings.earlyEnabled===true){state.earlyEnabled=true;byId('earlySwitch').checked=true;}
  for(const id of ['calcEntry','calcBudget','calcFee','calcSlippage','calcTarget','calcStop'])byId(id).addEventListener('input',recalculate);
  byId('resetEntry').addEventListener('click',()=>{const r=state.rows.find(x=>x.symbol===state.modalSymbol);if(!r)return;byId('calcEntry').value=String(Number((r.ask||r.price).toPrecision(10)));recalculate();});
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
  for (const [id,key,type] of [['hitrunMinGain','gain','number'],['hitrunSort','sort','text']]) {
    const input=byId(id);input.value=String(hitrunSettings[key]);
    input.addEventListener('change',()=>{
      hitrunSettings[key]=type==='number'?Number(input.value):input.value;
      try{localStorage.setItem(HITRUN_SETTINGS_KEY,JSON.stringify(hitrunSettings));}catch{}
      renderHitRun();
    });
  }
  byId('hitrunTopGainers').addEventListener('click',e=>{
    const detail=e.target.closest('button[data-hitrun-detail]');
    if(detail)openDetail(detail.dataset.hitrunDetail);
  });
  for(const id of ['hitrunHighCards','hitrunAggCards'])byId(id).addEventListener('click',e=>{
    const track=e.target.closest('button[data-hitrun-track]');
    if(track){trackTrade(track.dataset.hitrunTrack,id==='hitrunHighCards'?'HITRUN HIGH LIQUIDITY':'HITRUN AGGRESSIVE');return;}
    const detail=e.target.closest('button[data-hitrun-detail]');
    if(detail)openDetail(detail.dataset.hitrunDetail);
  });
  byId('hunterCards').addEventListener('click',e=>{const track=e.target.closest('button[data-track]');if(track){trackTrade(track.dataset.track,'BREAKOUT');return;}const detail=e.target.closest('button[data-detail]');if(detail)openDetail(detail.dataset.detail);});
  byId('leaderCards').addEventListener('click',e=>{const track=e.target.closest('button[data-track]');if(track){trackTrade(track.dataset.track,'MOMENTUM');return;}const detail=e.target.closest('button[data-detail]');if(detail)openDetail(detail.dataset.detail);});
  byId('radarRows').addEventListener('click',e=>{
    const fav=e.target.closest('button[data-favorite]');
    if(fav){const sym=fav.dataset.favorite;if(favorites.has(sym))favorites.delete(sym);else favorites.add(sym);localStorage.setItem(FAVORITES_KEY,JSON.stringify([...favorites]));render();return;}
    const detail=e.target.closest('button[data-detail]');if(detail)openDetail(detail.dataset.detail);
  });
  byId('detailTrackTrade').addEventListener('click',()=>{if(state.modalSymbol){const r=state.rows.find(x=>x.symbol===state.modalSymbol);closeDetail();window.RadarJournalUI?.openTrade(r,'DETAIL');}});
  window.RadarJournalUI?.init();
  byId('year').textContent=String(new Date().getFullYear());
  setInterval(()=>byId('clock').textContent=timeText(Date.now()),1000);
  byId('clock').textContent=timeText(Date.now());
}
function recompute(allowAlert=true){
  state.rows=(state.latest?.rows||[]).map(r=>({...r,status:assess(r),entryQuality:window.RadarEntryQuality.evaluate(r,cfg),score:scoreOf(r)}));
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
function leaderElement(row, position){
  const btn=node('button','leader-card'+(position<3?' featured':''));
  btn.type='button';btn.dataset.detail=row.symbol;
  btn.setAttribute('aria-label',`Lihat ${row.symbol}, skor ${row.score}, momentum 15 minit ${percent(row.m15)}. Bukan arahan beli.`);
  const top=node('div','leader-card-top');
  top.append(node('span','leader-position',`#${position+1}`));
  const type=row.status==='BUY'?'BUY':row.status==='WATCH'?'WATCH':'RADAR';
  top.append(node('span','pill leader-signal '+type.toLowerCase(),type));
  const name=node('div','leader-coin');
  name.append(node('span','leader-token',row.symbol.split('-')[0].slice(0,4)),node('span','leader-symbol',row.symbol.replace('-USDT','')));
  const heading=node('div','leader-main');
  heading.append(name,node('span','leader-price',price(row.price)+' USDT'));
  const momentum=node('div','leader-moments');
  for(const [label,v] of [['5m',row.m5],['15m',row.m15],['30m',row.m30]]){
    const el=node('div','leader-moment');el.append(node('small','',label),pCell(v));momentum.append(el);
  }
  const foot=node('div','leader-bottom');
  const facts=node('span','',`24j ${currency(row.volume)} · Spread ${row.spread.toFixed(3)}%`);
  const score=node('span','leader-score',`${row.score}/100`);
  foot.append(facts,score);
  const accel=window.RadarAcceleration?.metrics(row);
  const trend=node('div','leader-accel');
  trend.append(node('span','',`1m ${percent(row.m1)} · Pecutan 5m ${accel?(accel.delta>=0?'+':'')+accel.delta.toFixed(2)+' pp':'—'}`));
  if(window.RadarAcceleration?.nearBuy(row,cfg))trend.append(node('span','early-flag','⚡ EARLY WATCH'));
  btn.append(top,heading,momentum,trend,foot);
  const wrap=node('div','tracking-tile');const track=node('button','track-action','+ Pantau Trade');track.type='button';track.dataset.track=row.symbol;track.title='Rekod trade secara manual dalam browser; tiada order KuCoin';wrap.append(btn,track);
  return wrap;
}
function trackTrade(symbol,source){const row=state.rows.find(r=>r.symbol===symbol);if(row)window.RadarJournalUI?.openTrade(row,source);}
function renderLeaders(){
  const data=state.latest;
  const grid=byId('leaderCards');
  const updated=data?.updatedAt||0;
  const fresh=updated>0 && Date.now()-updated<90_000 && !data.error;
  const summary=byId('leadersEligible');
  byId('leadersCriteria').textContent=`Volume ≥ ${currency(cfg.minVolume)} • Spread ≤ ${cfg.maxSpread.toFixed(2)}% • Momentum 15m/30m positif`;
  byId('leadersFresh').textContent=data?.mock?'DEMO • BUKAN DATA SEBENAR':fresh?'● Data LIVE / dikemas kini setiap 20s':'● Menunggu data segar';
  const picked=window.RadarTop10?.choose(state.rows,cfg) || {leaders:[],total:0};
  byId('leadersCount').textContent=`${picked.leaders.length}/10`;
  summary.textContent=`${picked.total} pair layak · ${picked.leaders.filter(r=>window.RadarAcceleration?.nearBuy(r,cfg)).length} hampir BUY`; 
  // Never present stale snapshot as a live shortlist.
  if(!fresh){grid.replaceChildren(node('div','leaders-empty','Belum ada data segar. Tunggu API KuCoin atau refresh halaman.'));return;}
  if(!picked.leaders.length){
    const done=data.bootstrap?.done||0,total=data.bootstrap?.total||0;
    const msg=total && done<total
      ?`Sedang menyediakan sejarah coin (${done}/${total}). Belum ada coin lulus tapisan. Ranking muncul apabila data mencukupi.`
      :'Tiada coin memenuhi penapis volume, spread dan momentum sekarang. Cuba tunggu keadaan pasaran berubah atau ubah filter di Market Radar.';
    grid.replaceChildren(node('div','leaders-empty',msg));return;
  }
  grid.replaceChildren(...picked.leaders.map((row,index)=>leaderElement(row,index)));
}
function hunterCard(r){
  const b=r.breakout;
  const btn=node('button','hunter-card'+(b.signal.startsWith('BREAKOUT')?' fired':''));btn.type='button';btn.dataset.detail=r.symbol;
  const header=node('div','leader-card-top');header.append(node('strong','',r.symbol.replace('-USDT','')),node('span','hunter-flag '+(b.signal==='SETUP'?'setup':'fired'),b.signal));
  const meter=node('div','hunter-metrics');
  const stats=[['RVOL 1m',b.rvol1===null?'—':b.rvol1.toFixed(2)+'×'],['RVOL 5m',b.rvol5===null?'—':b.rvol5.toFixed(2)+'×'],['Jarak high 1m',b.distance1===null?'—':(b.distance1>=0?'+':'')+b.distance1.toFixed(2)+'%'],['Skor',b.rank+'/100']];
  for(const [label,val] of stats){const d=node('div');d.append(node('small','',label),node('b','',val));meter.append(d);}
  const foot=node('div','hunter-foot',`Harga ${price(r.price)} USDT · Spread ${r.spread.toFixed(3)}% · ${r.status}`);
  btn.append(header,meter,foot);const wrap=node('div','tracking-tile');const track=node('button','track-action','+ Pantau Trade');track.type='button';track.dataset.track=r.symbol;wrap.append(btn,track);return wrap;
}
function renderHunter(){
  const latest=state.latest||{},h=latest.hunter||{};
  const fresh=latest.updatedAt && Date.now()-latest.updatedAt<90_000 && !latest.error;
  const source=state.rows.filter(r=>r.breakout?.coverage==='READY' && r.volume>=cfg.minVolume && r.spread<=cfg.maxSpread);
  const signal=source.filter(r=>r.breakout.signal.startsWith('BREAKOUT'));
  const setup=source.filter(r=>r.breakout.signal==='SETUP');
  const rows=[...signal,...setup].sort((a,b)=>b.breakout.rank-a.breakout.rank || b.score-a.score).slice(0,8);
  byId('hunterCount').textContent=String(rows.length);
  byId('hunterLive').textContent=latest.mock?'● DEMO / bukan signal sebenar':fresh?'● Data KuCoin LIVE':'● Menunggu data segar';
  byId('hunterCoverage').textContent=`${h.monitored||0}/${latest.pairs||0} pair dipantau untuk OHLCV • update ±75s`;
  byId('hunterSignals').textContent=`${signal.length} breakout · ${setup.length} setup`;
  const el=byId('hunterCards');
  if(!fresh){el.replaceChildren(node('div','leaders-empty','Data pasaran terganggu atau lapuk. Tidak memaparkan breakout.'));return;}
  if(!rows.length){
    const warming=latest.bootstrap?.active || !(h.monitored>0);
    el.replaceChildren(node('div','leaders-empty',warming?'Sejarah 1-minit sedang dimuatkan. Breakout Hunter akan aktif apabila bootstrap selesai.':'Tiada breakout + volume spike atau SETUP yang disahkan sekarang. Scanner terus mengemas kini candle untuk pair aktif.'));
    return;
  }
  el.replaceChildren(...rows.map(hunterCard));
}
function renderHitRun(){
  const data=state.latest;
  const fresh=!!(data?.updatedAt&&Date.now()-data.updatedAt<90_000&&!data.error);
  const highBox=byId('hitrunHighCards'),agBox=byId('hitrunAggCards');
  const stages=byId('hitrunStages'),top=byId('hitrunTopGainers');
  const sel=window.RadarHitRun?.dual(state.rows,hitrunSettings);
  const high=sel?.high||{eligible:0,results:[],spikes:0,breakouts:0};
  const ag=sel?.aggressive||{eligible:0,results:[],spikes:0,breakouts:0};
  byId('hitrunCount').textContent=`${high.eligible+ag.eligible} layak`;
  byId('hitrunHighCount').textContent=`${high.results.length}/${high.eligible}`;
  byId('hitrunAggCount').textContent=`${ag.results.length}/${ag.eligible}`;
  byId('hitrunHighStats').textContent=`${high.spikes} spike · ${high.breakouts} breakout`;
  byId('hitrunAggStats').textContent=`${ag.spikes} spike · ${ag.breakouts} breakout`;
  byId('hitrunEligible').textContent=`${high.eligible} high liquidity · ${ag.eligible} aggressive`;
  byId('hitrunLive').textContent=data?.mock?'DEMO — bukan data sebenar':fresh?'● KuCoin LIVE · 20s':'● Menunggu data segar';
  if(!fresh){
    for(const el of [highBox,agBox])el.replaceChildren(node('div','leaders-empty','Data KuCoin belum segar. Senarai disembunyikan sehingga API tersedia.'));
    stages.replaceChildren(node('div','leaders-empty','Menunggu ticker terkini.'));
    top.replaceChildren(node('div','leaders-empty','Harga lapuk tidak dipaparkan.'));
    return;
  }
  const diag=window.RadarHitRun?.diagnose(state.rows,{gain:hitrunSettings.gain,volume:1_000_000,spread:.25});
  if(diag){
    const steps=[['Pair spot USDT sah',diag.universe],['Naik ≥'+hitrunSettings.gain+'% (24j)',diag.gain],['Volume ≥$1 juta',diag.liquid],['Lulus satu tier',high.eligible+ag.eligible]];
    stages.replaceChildren(...steps.map(([name,count],i)=>{
      const el=node('div','hitrun-stage');el.append(node('span','hitrun-stage-label',name),node('strong','',String(count)));
      if(i<3)el.append(node('span','hitrun-stage-arrow','→'));return el;
    }));
    const table=node('div','hitrun-gainers-list');
    if(!diag.top.length)table.append(node('p','hitrun-none','Tiada coin naik dalam data ticker.'));
    else for(const r of diag.top){
      const row=node('div','hitrun-gainer-row');
      const tier=r.volume>=5e6&&r.spread<=.15?'HIGH LIQUIDITY':r.volume>=1e6&&r.volume<5e6&&r.spread<=.25?'AGGRESSIVE':r.volume<1e6?'VOLUME RENDAH':'SPREAD / TIER TIDAK LULUS';
      row.append(node('strong','',r.symbol.replace('-USDT','')),node('span','hitrun-gain-value',percent(r.change24h)),node('span','',currency(r.volume)),node('span','',num(r.spread)===null?'Spread tiada':r.spread.toFixed(3)+'%'),node('span',tier.includes('LIQUIDITY')||tier==='AGGRESSIVE'?'hitrun-ok':'hitrun-reason',tier));
      const btn=node('button','hitrun-view-btn','Carta ↗');btn.type='button';btn.dataset.hitrunDetail=r.symbol;row.append(btn);table.append(row);
    }
    top.replaceChildren(table);
  }
  function card(r,i,tier){
    const insight=r.insight;
    const flag=insight.breakout?'fast':insight.label==='PULLBACK'?'pullback':insight.label==='TERLALU PANAS'?'hot':'';
    const wrap=node('article','hitrun-card-wrap '+flag);
    const body=node('div','hitrun-card-body');
    const head=node('div','hitrun-card-head');head.append(node('span','hitrun-rank','#'+(i+1)),node('span','hitrun-flag '+flag,insight.label));
    const title=node('div','hitrun-card-title');title.append(node('strong','hitrun-ticker',r.symbol.replace('-USDT','')),node('span','hitrun-usdt',price(r.price)+' USDT'));
    const major=node('div','hitrun-main');
    const change=node('div');change.append(node('small','','24 JAM'),node('strong','',percent(r.change24h)));
    const liq=node('div');liq.append(node('small','','VOLUME 24J'),node('b','',currency(r.volume)));major.append(change,liq);
    const momentum=node('div','hitrun-mini');
    for(const [label,v] of [['1m',r.m1],['5m',r.m5],['15m',r.m15]]){const item=node('div');item.append(node('small','',label),pCell(v));momentum.append(item);}
    const volume=node('div','hitrun-rvol');
    volume.append(node('span','',`RVOL 1m: ${insight.rvol1===null?'—':insight.rvol1.toFixed(2)+'×'}`),node('span','',`RVOL 5m: ${insight.rvol5===null?'—':insight.rvol5.toFixed(2)+'×'}`));
    const context=node('div','hitrun-why',insight.description);
    const foot=node('div','hitrun-card-foot');foot.append(node('span','',`Spread ${r.spread.toFixed(3)}%`),node('strong','',`Skor ${r.hitrunScore}/100`));
    body.append(head,title,major,momentum,volume,context,foot);
    const actions=node('div','hitrun-actions');
    const track=node('button','','+ Pantau Trade');track.type='button';track.dataset.hitrunTrack=r.symbol;track.title='Rekod REAL/PAPER secara manual sahaja; bukan order KuCoin';
    const detail=node('button','','Lihat carta ↗');detail.type='button';detail.dataset.hitrunDetail=r.symbol;
    actions.append(track,detail);wrap.append(body,actions);return wrap;
  }
  for(const [box,kind,result] of [[highBox,'high',high],[agBox,'aggressive',ag]]){
    if(!result.results.length){
      const message=kind==='high'?`Tiada coin naik ≥${hitrunSettings.gain}% dengan volume ≥$5 juta dan spread ≤0.15%.`:`Tiada coin naik ≥${hitrunSettings.gain}% dengan volume $1–5 juta dan spread ≤0.25%.`;
      box.replaceChildren(node('div','leaders-empty',message));
    }else box.replaceChildren(...result.results.map((r,i)=>card(r,i,kind)));
  }
}
function renderAlerts(){
  const server=state.latest?.alerts||[];
  const combined=[...state.localAlerts,...server].sort((a,b)=>b.at-a.at).filter((a,i,arr)=>arr.findIndex(x=>x.symbol===a.symbol&&Math.abs(x.at-a.at)<1000)===i).slice(0,7);
  const list=byId('recentAlerts');
  if(!combined.length){list.replaceChildren(node('div','no-alert','Belum ada signal BUY, EARLY WATCH atau breakout untuk dipaparkan.'));return;}
  const frag=document.createDocumentFragment();
  for(const item of combined){const entry=node('div','alert-item');const label=node('span');label.append(node('strong','',item.symbol+' • '+(item.type==='EARLY'?'EARLY WATCH':item.type==='BREAKOUT'?'BREAKOUT':'BUY')),node('span','',`  15m ${percent(item.m15)}`));entry.append(label,node('time','',timeText(item.at)));frag.append(entry);}
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
  renderLeaders();renderHunter();renderHitRun();renderRows();renderAlerts();
  window.RadarJournalUI?.updateMarket(state.rows,{updatedAt:data.updatedAt,mock:data.mock,error:data.error});
}
function recalculate(){
  const value=id=>Number(byId(id).value);
  const r=window.RadarPlanner?.calculate({entry:value('calcEntry'),budget:value('calcBudget'),fee:value('calcFee'),slippage:value('calcSlippage'),target:value('calcTarget'),stop:value('calcStop')});
  const entries=['detailTP','detailSL','calcQty','calcEffEntry','calcNetTP','calcNetSL','calcBreakEven','calcRR'];
  if(!r){for(const id of entries)byId(id).textContent='—';byId('calcMessage').textContent='Masukkan nombor positif yang sah. Fee/slippage 0–5%.';return;}
  byId('detailTP').textContent=price(r.tp)+' USDT';byId('detailSL').textContent=price(r.sl)+' USDT';
  byId('calcQty').textContent=r.quantity.toLocaleString('en-US',{maximumSignificantDigits:9});
  byId('calcEffEntry').textContent=price(r.effectiveEntry)+' USDT';
  byId('calcNetTP').textContent=`${currencyExact(r.netTP)} (${percent(r.netTPPercent)})`;
  byId('calcNetSL').textContent=`${currencyExact(r.netSL)} (${percent(r.netSLPercent)})`;
  byId('calcBreakEven').textContent=price(r.breakEven)+' USDT';
  byId('calcRR').textContent=r.rr===null?'—':`1 : ${r.rr.toFixed(2)}`;
  byId('calcMessage').textContent='Anggaran selepas fee/slippage dua hala, tanpa mengambil kira depth order book, spread masa keluar atau gap harga.';
}
function currencyExact(v){return (v<0?'−':'')+'$'+Math.abs(v).toLocaleString('en-US',{maximumFractionDigits:2,minimumFractionDigits:2});}
async function openDetail(symbol){
  const row=state.rows.find(r=>r.symbol===symbol);if(!row)return;
  state.modalSymbol=symbol;
  byId('detailBackdrop').classList.remove('hidden');document.body.style.overflow='hidden';
  byId('detailTitle').textContent=symbol;byId('detailPrice').textContent=price(row.price)+' USDT';
  byId('detailStatus').className='pill '+row.status.toLowerCase();byId('detailStatus').textContent=row.status;
  for(const [name,value] of [['detailM5',row.m5],['detailM15',row.m15],['detailM30',row.m30]]){
    const el=byId(name);el.textContent=percent(value);el.className=num(value)===null?'move-neutral':value>=0?'move-up':'move-down';
  }
  const accel=window.RadarAcceleration?.metrics(row);
  byId('detailM1').textContent=percent(row.m1);
  byId('detailAccel').textContent=accel?(accel.delta>=0?'+':'')+accel.delta.toFixed(2)+' pp':'—';
  const bo=row.breakout||{};
  byId('detailBreakout').textContent=bo.coverage==='READY'?`Breakout: ${bo.signal||'NONE'} • RVOL 1m ${bo.rvol1?.toFixed(2)||'—'}× • RVOL 5m ${bo.rvol5?.toFixed(2)||'—'}× • High 1m ${bo.level1===null?'—':price(bo.level1)}`:`Breakout: ${bo.coverage||'DATA'} — OHLCV belum lengkap / belum dipantau`;
  byId('detailEarly').textContent=(row.entryQuality?.reason||'Semak momentum & penapis sebelum entry')+(row.status==='BUY'?' • Had pemerhatian 30 minit':'');
  byId('detailSpread').textContent=num(row.spread)===null?'—':row.spread.toFixed(3)+'%';
  byId('calcEntry').value=String(Number((row.ask||row.price).toPrecision(10)));
  recalculate();
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
