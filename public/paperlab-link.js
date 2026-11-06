/* KuCoin Radar v1.9.5 -> PaperLab v1.1. UI-only extension: NO trades or exchange private API. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const DEFAULT_TARGET_PCT=3.5,DEFAULT_STOP_PCT=1.2;
const CONTAINERS=['top70Cards','qualityBuyCards','leaderCards','hunterCards','radarRows','hitrunHighCards','hitrunAggCards'];
const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const getRows=()=>typeof state!=='undefined'&&Array.isArray(state?.rows)?state.rows:[];
const findRow=symbol=>getRows().find(r=>r.symbol===symbol);
const isLive=()=>{
  const d=typeof state!=='undefined'?state?.latest:null;
  return !!(d&&!d.error&&!d.mock&&Number.isFinite(d.updatedAt)&&Date.now()-d.updatedAt<90000);
};
const isBuy=row=>!!(row&&row.status==='BUY' &&
  (typeof window.RadarQuality70?.qualifiedBuy==='function'?window.RadarQuality70.qualifiedBuy(row):true));
function buyButton(symbol,source,small=false){
  const btn=document.createElement('button');btn.type='button';btn.className='paperlab-btn'+(small?' paperlab-btn-small':'');
  btn.dataset.paperlabSymbol=symbol;btn.dataset.paperlabSource=source;
  btn.textContent='🧮 PaperLab';btn.title='Hantar snapshot BUY ke kalkulator; bukan pembelian sebenar.';return btn;
}
function attachAfter(parent,anchor,symbol,source,small=false){
  if(!parent||parent.querySelector(':scope > .paperlab-btn'))return;
  const btn=buyButton(symbol,source,small);
  if(anchor)anchor.insertAdjacentElement('afterend',btn);else parent.append(btn);
}
function updateCards(){
  if(!isLive())return;
  const top=$('top70Cards');
  if(top)for(const box of top.querySelectorAll('.top70-card.is-buy')){
    const tr=box.querySelector('[data-top70-track]');const symbol=tr?.dataset.top70Track;
    if(symbol&&isBuy(findRow(symbol)))attachAfter(box.querySelector('.top70-card-actions'),tr,symbol,'TOP70 BUY');
  }
  const quality=$('qualityBuyCards');
  if(quality)for(const tile of quality.querySelectorAll('.tracking-tile')){
    const tr=tile.querySelector('[data-quality-track]');const symbol=tr?.dataset.qualityTrack;
    if(symbol&&isBuy(findRow(symbol)))attachAfter(tile,tr,symbol,'QUALITY BUY');
  }
  for(const [id,source] of [['leaderCards','MOMENTUM BUY'],['hunterCards','BREAKOUT BUY']]){
    const root=$(id);if(!root)continue;
    for(const tile of root.querySelectorAll('.tracking-tile')){
      const tr=tile.querySelector('[data-track]');const symbol=tr?.dataset.track;
      if(symbol&&isBuy(findRow(symbol)))attachAfter(tile,tr,symbol,source);
    }
  }
  for(const [id,source] of [['hitrunHighCards','HITRUN BUY'],['hitrunAggCards','HITRUN BUY']]){
    const root=$(id);if(!root)continue;
    for(const tile of root.querySelectorAll('.tracking-tile')){
      const tr=tile.querySelector('[data-hitrun-track]');const symbol=tr?.dataset.hitrunTrack;
      if(symbol&&isBuy(findRow(symbol)))attachAfter(tile,tr,symbol,source);
    }
  }
  const table=$('radarRows');
  if(table)for(const tr of table.querySelectorAll('tr')){
    const btn=tr.querySelector('[data-detail]');const symbol=btn?.dataset.detail;
    if(symbol&&isBuy(findRow(symbol)))attachAfter(btn.parentElement,btn,symbol,'MARKET BUY',true);
  }
}
function addHeader(){
  const slot=document.querySelector('.topbar .top-actions');
  if(!slot||$('paperlabHeader'))return;
  const a=document.createElement('a');a.id='paperlabHeader';a.className='paperlab-nav';a.href='/paperlab/';a.textContent='🧮 PaperLab';a.title='Buka kalkulator dan paper trading journal';
  slot.prepend(a);
}
function addDetail(){
  const slot=document.querySelector('#detailBackdrop .modal-actions');
  if(!slot||$('detailPaperLab'))return;
  const btn=document.createElement('button');btn.type='button';btn.id='detailPaperLab';btn.className='paperlab-btn';btn.textContent='🧮 Kira di PaperLab';
  btn.title='Buka kalkulator untuk coin yang sedang diperiksa; bukan BUY automatik';slot.prepend(btn);
  btn.addEventListener('click',()=>{
    const symbol=typeof state!=='undefined'?state?.modalSymbol:null;
    if(symbol)navigate(symbol,'DETAIL '+(findRow(symbol)?.status||'SEMakan'),true);
  });
}
function navigate(symbol,source,fromDetail=false){
  const row=findRow(symbol);
  if(!row||!isLive()){alert('Data scanner belum LIVE atau terlalu lama. Sila refresh untuk harga terkini.');return}
  if(!fromDetail&&!isBuy(row)){alert('Status BUY tidak lagi aktif. Semak semula coin sebelum paper trade.');return}
  const entry=(valid(row.ask)?row.ask:row.price);
  if(!valid(entry)){alert('Harga ASK/entry tidak sah.');return}
  let tpPercent=DEFAULT_TARGET_PCT,slPercent=DEFAULT_STOP_PCT;
  let capital=null,fee=null;
  if(fromDetail&&typeof state!=='undefined'&&state.modalSymbol===symbol){
    const pct=Number($('calcTarget')?.value),sl=Number($('calcStop')?.value);
    const budget=Number($('calcBudget')?.value),f=Number($('calcFee')?.value);
    if(pct>0&&pct<=100)tpPercent=pct;
    if(sl>0&&sl<100)slPercent=sl;
    if(budget>0&&budget<=100000000)capital=budget;
    if(Number.isFinite(f)&&f>=0&&f<5)fee=f;
    const manualEntry=Number($('calcEntry')?.value);
    // Reflect user's manually edited detail entry, not the last ticker price.
    if(valid(manualEntry))return openPage(row,symbol,source,manualEntry,tpPercent,slPercent,capital,fee,false);
  }
  openPage(row,symbol,source,entry,tpPercent,slPercent,capital,fee,true);
}
function openPage(row,symbol,source,entry,tpPercent,slPercent,capital,fee,isDefault){
  const url=new URL('/paperlab/',location.origin);
  url.searchParams.set('symbol',symbol);
  url.searchParams.set('entry',String(entry));
  url.searchParams.set('tp',String(Number((entry*(1+tpPercent/100)).toPrecision(14))));
  url.searchParams.set('sl',String(Number((entry*(1-slPercent/100)).toPrecision(14))));
  url.searchParams.set('score',String(row.score??''));
  url.searchParams.set('signal',isBuy(row)?'BUY':'WATCH');
  url.searchParams.set('source',source);
  if(isDefault)url.searchParams.set('ref','scanner-default');
  if(capital!==null)url.searchParams.set('capital',String(capital));
  if(fee!==null)url.searchParams.set('fee',String(fee));
  url.searchParams.set('at',String(Date.now()));
  location.assign(url.href); // Same tab: reliable on Safari/Android in-app browsers.
}
function install(){
  const style=document.createElement('style');
  style.textContent=`.paperlab-btn,.paperlab-nav{display:inline-flex;align-items:center;justify-content:center;gap:5px;cursor:pointer;text-decoration:none;border:1px solid #3dcbb1;background:#123b37;color:#80f6d9;border-radius:10px;padding:10px 12px;font:700 12px system-ui,sans-serif;white-space:nowrap}.paperlab-btn:hover,.paperlab-nav:hover{background:#1b554c;color:#d1fff3}.paperlab-btn-small{padding:7px 9px;margin-left:7px}.paperlab-nav{background:linear-gradient(135deg,#0d735e,#145a55);color:#fff;border-color:#299e87}.top70-card-actions{flex-wrap:wrap}.tracking-tile>.paperlab-btn{margin:4px 7px 7px}.modal-actions>.paperlab-btn{flex:0 1 auto}#radarRows td .paperlab-btn{margin-top:5px}@media(max-width:600px){.paperlab-nav{padding:8px;font-size:11px}.paperlab-btn-small{margin-left:0}}`;
  document.head.append(style);
  addHeader();addDetail();updateCards();
  document.addEventListener('click',event=>{
    const btn=event.target.closest('button[data-paperlab-symbol]');if(!btn)return;
    event.preventDefault();event.stopPropagation();
    navigate(btn.dataset.paperlabSymbol,btn.dataset.paperlabSource,false);
  },true);
  for(const id of CONTAINERS){
    const target=$(id);if(!target)continue;
    new MutationObserver(updateCards).observe(target,{childList:true,subtree:true});
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
else install();
})();
