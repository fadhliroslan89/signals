/* Local-first, manual trade journal. All order execution stays on KuCoin. */
(function(root){
'use strict';
const core=root.RadarJournalCore;
const $=id=>document.getElementById(id);
const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=String(txt);return n;};
const money=v=>Number.isFinite(v)?(v<0?'−':'')+'$'+Math.abs(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
const px=v=>Number.isFinite(v)?v.toLocaleString('en-US',{maximumSignificantDigits:10}):'—';
const signed=v=>Number.isFinite(v)?`${v>=0?'+':''}${v.toFixed(2)}%`:'—';
const timestamp=s=>s?new Date(s).toLocaleString('ms-MY',{dateStyle:'short',timeStyle:'short'}):'—';
const valid=x=>Number.isFinite(x)&&x>0;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
let trades=[],mode='REAL',market=new Map(),lastAt=0,isMock=false,isError=false;
let currentSymbol=null,currentSource='MANUAL',closeId=null,editId=null,visibility='ALL';
function notice(message,error=false){const o=$('journalMessage');o.textContent=message;o.classList.toggle('error',error);o.classList.remove('hidden');setTimeout(()=>{if(o.textContent===message)o.classList.add('hidden');},6500);}
function load(){try{const parsed=JSON.parse(localStorage.getItem(core.KEY)||'[]');trades=Array.isArray(parsed)?parsed.map(core.normalize).filter(Boolean):[];}catch{trades=[];}}
function save(){try{localStorage.setItem(core.KEY,JSON.stringify(trades));return true;}catch{notice('Gagal simpan data journal di browser. Eksport backup dan semak storan browser.',true);return false;}}
function isFresh(){return lastAt>0&&Date.now()-lastAt<90000&&!isError;}
function quote(symbol){if(isMock)return null;const row=market.get(symbol);return isFresh()&&row&&valid(row.bid||row.price)?(row.bid||row.price):null;}
function freshAsk(symbol){const row=market.get(symbol);return isFresh()&&row&&valid(row.ask||row.price)?(row.ask||row.price):null;}
function modeshown(t){return t.mode===mode;}
function onTab(m){mode=m;for(const btn of document.querySelectorAll('[data-journal-mode]')){const selected=btn.dataset.journalMode===m;btn.classList.toggle('active',selected);btn.setAttribute('aria-pressed',String(selected));}render();}
function statsPanel(){const st=core.stats(trades,mode);
  for(const [id,val] of [['journalOpen',st.open],['journalClosed',st.closed],['journalWins',st.wins],['journalLosses',st.losses],['journalBE',st.even]])$(id).textContent=String(val);
  $('journalWinRate').textContent=st.winRate===null?'—':st.winRate.toFixed(1)+'%';
  $('journalNet').textContent=money(st.net);$('journalNet').className='journal-value '+(st.net<0?'move-down':'move-up');
  $('journalModeLabel').textContent=mode==='REAL'?'Trade sebenar (rekod manual)':'Paper trading';
  $('journalStatInfo').textContent=`${st.overdue} posisi OPEN >30m (perlu semak manual) • TP ≤30m: ${st.tp30}/${st.closed} (${st.tp30Pct===null?'—':st.tp30Pct.toFixed(1)+'%'}) • Win rate hanya trade ditutup; tidak termasuk posisi tersangkut.`;
}
function detailRow(t){
  const card=el('article','journal-position');
  const head=el('div','journal-position-head');const name=el('strong','',t.symbol);const side=el('span','journal-side '+(t.status==='CLOSED'?'closed':'open'),t.status==='CLOSED'?'CLOSED':'OPEN');
  head.append(name,side);card.append(head);
  const src=el('div','journal-position-source',`${t.source} • ${timestamp(t.openedAt)} • ${t.mode==='REAL'?'REAL':'PAPER'}${t.status==='CLOSED'?` • Exit: ${t.reason} • ${timestamp(t.closedAt)}`:''}`);card.append(src);
  const mark=t.status==='CLOSED'?t.exit:quote(t.symbol);
  const outcome=mark===null?null:core.pnl(t,mark);
  const estimate=t.status==='OPEN'?'Anggaran jual pada BID (termasuk fee)':'P&L direkod selepas fee anggaran';
  const grid=el('div','journal-position-metrics');
  for(const [label,val] of [['Entry',`${px(t.entry)} USDT`],['Harga '+(t.status==='CLOSED'?'Exit':'BID'),mark===null?'Tiada harga segar':`${px(mark)} USDT`],['Jumlah',`${px(t.quantity)} coin`],['Modal',money(t.cost)],['TP / SL',`${px(t.tp)} / ${px(t.sl)}`],['P&L',outcome?`${money(outcome.pnl)} (${signed(outcome.pct)})`:'—']]){
    const d=el('div','');d.append(el('small','',label),el('strong',label==='P&L'&&outcome?outcome.pnl<0?'move-down':'move-up':'',val));grid.append(d);
  }
  card.append(grid,el('p','journal-position-foot',estimate));
  if(t.status==='OPEN'){
    const held=Math.max(0,Math.floor((Date.now()-Date.parse(t.openedAt))/60000));
    card.append(el('div','journal-hold-duration',`Tempoh pegangan: ${held} minit / sasaran 30 minit`));
    if(held>=30) card.append(el('div','journal-flag danger',`MASA MELEBIHI 30 MINIT (${held}m). Semak posisi dan rekod exit mengikut pelan risiko. Tiada auto-close atau order KuCoin.`));
  }

  if(t.status==='OPEN'&&mark!==null){
    if(isMock)card.append(el('div','journal-caution','DATA DEMO — bukan harga pasaran sebenar'));
    else if(mark>=t.tp)card.append(el('div','journal-flag profit','Harga rujukan ≥ TP — semak order sebenar di KuCoin'));
    else if(mark<=t.sl)card.append(el('div','journal-flag danger','Harga rujukan ≤ SL — semak order sebenar di KuCoin'));
  }
  if(t.note)card.append(el('p','journal-notes',t.note));
  const actions=el('div','journal-actions');
  if(t.status==='OPEN'){
    const close=el('button','journal-small primary','Tutup / Rekod Exit');close.type='button';close.dataset.journalClose=t.id;actions.append(close);
  }
  const edit=el('button','journal-small','Edit Nota');edit.type='button';edit.dataset.journalEdit=t.id;actions.append(edit);
  const remove=el('button','journal-small danger','Padam');remove.type='button';remove.dataset.journalDelete=t.id;actions.append(remove);card.append(actions);return card;
}
function render(){statsPanel();const shown=trades.filter(modeshown).filter(t=>visibility==='ALL'||t.status===visibility).sort((a,b)=>Date.parse(b.openedAt)-Date.parse(a.openedAt));
  $('journalRecordCount').textContent=`${shown.length} rekod`;
  const list=$('journalPositions');
  if(!shown.length){list.replaceChildren(el('div','leaders-empty',`Belum ada ${visibility==='ALL'?'rekod':visibility.toLowerCase()} untuk ${mode==='REAL'?'trade sebenar':'paper trade'}. Tekan “+ Pantau Trade” pada coin Momentum/Breakout untuk mula.`));return;}
  list.replaceChildren(...shown.map(detailRow));
}
function datestring(){const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
function dateToISOString(value){if(!value)return null;const d=new Date(value);return Number.isFinite(d.getTime())?d.toISOString():null;}
function showModal(id){const m=$(id);m.classList.remove('hidden');document.body.style.overflow='hidden';}
function hideModal(id){$(id).classList.add('hidden');if($('detailBackdrop').classList.contains('hidden'))document.body.style.overflow='';}
function openTrade(row,source='MANUAL'){
  const symbol=typeof row==='string'?row:row?.symbol;
  if(!symbol || !/^[A-Z0-9]{2,25}-USDT$/.test(symbol)){notice('Pair tidak sah.',true);return;}
  const data=market.get(symbol)||row||{};
  currentSymbol=symbol;currentSource=source;
  $('journalEntrySymbol').textContent=symbol;
  $('journalEntrySource').textContent=`Dari panel ${source} • ini hanya catatan, BUKAN order KuCoin.`;
  $('journalEntryMode').value='PAPER';
  const ask=freshAsk(symbol)||data.ask||data.price;
  $('journalEntryPrice').value=valid(ask)?String(Number(ask.toPrecision(10))):'';
  $('journalEntryBudget').value='100';$('journalEntryQuantity').value='';$('journalEntryFee').value='0.1';$('journalEntryTP').value='3.5';$('journalEntrySL').value='1.2';$('journalEntryAt').value=datestring();$('journalEntryNote').value='';
  $('journalEntryError').textContent='';showModal('journalEntryBackdrop');$('journalEntryPrice').focus();
}
function doEntry(e){e.preventDefault();
  if(isMock&&$('journalEntryMode').value==='REAL'){$('journalEntryError').textContent='MOD DEMO: catatan REAL ditutup untuk mengelakkan harga simulasi dianggap harga KuCoin.';return;}
  const entry=Number($('journalEntryPrice').value),budget=Number($('journalEntryBudget').value),qtyValue=$('journalEntryQuantity').value.trim(),quantity=qtyValue?Number(qtyValue):null;
  if(qtyValue&&!valid(quantity)){$('journalEntryError').textContent='Unit coin mesti positif atau biarkan kosong untuk kira automatik.';return;}
  const openedAt=dateToISOString($('journalEntryAt').value);
  if(!openedAt||Date.parse(openedAt)>Date.now()+60000){$('journalEntryError').textContent='Masa entry tidak sah atau berada di masa hadapan.';return;}
  const id='j'+Date.now().toString(36)+Math.random().toString(36).slice(2,10);
  const rec=core.create({symbol:currentSymbol,mode:$('journalEntryMode').value,entry,budget,quantity,feePct:Number($('journalEntryFee').value),tpPct:Number($('journalEntryTP').value),slPct:Number($('journalEntrySL').value),openedAt,source:currentSource,note:$('journalEntryNote').value},id);
  if(!rec){$('journalEntryError').textContent='Semak entry, modal, unit, fee dan TP/SL. Nilai mesti sah.';return;}
  trades.unshift(rec);
  if(!save()){trades.shift();return;}
  hideModal('journalEntryBackdrop');onTab(rec.mode);visibility='ALL';$('journalVisibility').value='ALL';render();notice(`Posisi ${rec.symbol} disimpan dalam journal ${rec.mode}. Tiada order dihantar ke KuCoin.`);
  $('journalSection').scrollIntoView({behavior:'smooth',block:'start'});
}
function openExit(id){const t=trades.find(t=>t.id===id&&t.status==='OPEN');if(!t)return;
  closeId=id;$('journalCloseSymbol').textContent=t.symbol;
  const bid=quote(t.symbol);$('journalExitPrice').value=bid!==null?String(Number(bid.toPrecision(10))):'';
  $('journalExitReason').value='MANUAL';$('journalExitAt').value=datestring();$('journalExitError').textContent='';showModal('journalExitBackdrop');
}
function doExit(e){e.preventDefault();const idx=trades.findIndex(t=>t.id===closeId);if(idx<0)return;
  const exited=dateToISOString($('journalExitAt').value),t=trades[idx];
  if(!exited || Date.parse(exited)<Date.parse(t.openedAt)||Date.parse(exited)>Date.now()+60000){$('journalExitError').textContent='Masa keluar mesti selepas entry dan tidak boleh pada masa hadapan.';return;}
  const closed=core.close(t,Number($('journalExitPrice').value),$('journalExitReason').value,exited);
  if(!closed){$('journalExitError').textContent='Harga exit mesti positif dan alasan exit sah.';return;}
  trades[idx]=closed;
  if(!save()){trades[idx]=t;return;}
  hideModal('journalExitBackdrop');render();notice(`Posisi ${closed.symbol} telah direkod TUTUP dalam journal. Tiada order dihantar ke KuCoin.`);
}
function openEdit(id){const t=trades.find(x=>x.id===id);if(!t)return;editId=id;$('journalEditSymbol').textContent=t.symbol;$('journalEditNote').value=t.note;showModal('journalEditBackdrop');}
function saveEdit(e){e.preventDefault();const t=trades.find(x=>x.id===editId);if(!t)return;const old=t.note;t.note=$('journalEditNote').value.slice(0,2000);if(!save()){t.note=old;return;}hideModal('journalEditBackdrop');render();notice('Nota journal dikemas kini.');}
function remove(id){const idx=trades.findIndex(t=>t.id===id);if(idx<0)return;
  if(!window.confirm(`Padam rekod ${trades[idx].symbol}? Tindakan ini tidak boleh dipulihkan tanpa backup.`))return;
  const removed=trades.splice(idx,1)[0];if(!save()){trades.splice(idx,0,removed);return;}render();notice('Rekod dipadam.');
}
function download(name,text,mime){const url=URL.createObjectURL(new Blob([text],{type:mime}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
function exportJson(){download('kucoin-journal-'+new Date().toISOString().slice(0,10)+'.json',core.encode(trades),'application/json;charset=utf-8');notice('Backup JSON dieksport. Simpan di lokasi selamat.');}
function exportCsv(){download('kucoin-journal-'+new Date().toISOString().slice(0,10)+'.csv',core.csv(trades),'text/csv;charset=utf-8');notice('CSV dieksport untuk Excel/Sheets.');}
async function importJson(evt){const file=evt.target.files?.[0];evt.target.value='';if(!file)return;
  if(file.size>8_000_000){notice('Fail import terlalu besar (maksimum 8MB).',true);return;}
  let imported;try{imported=core.parseBackup(await file.text());}catch{imported=null;}
  if(!imported){notice('Format backup JSON tidak sah. Import dibatalkan.',true);return;}
  if(!window.confirm(`Import ${imported.length} rekod? ID sedia ada yang sama akan dikemas kini. Tiada pesanan KuCoin dibuat.`))return;
  const previous=trades;trades=core.merge(trades,imported);
  if(!save()){trades=previous;return;}
  render();notice(`${imported.length} rekod dibaca. Journal sekarang mempunyai ${trades.length} rekod.`);
}
function updateMarket(rows,info={}){market=new Map((rows||[]).map(r=>[r.symbol,r]));lastAt=info.updatedAt||0;isMock=!!info.mock;isError=!!info.error;render();}
function init(){load();
  for(const btn of document.querySelectorAll('[data-journal-mode]'))btn.addEventListener('click',()=>onTab(btn.dataset.journalMode));
  $('journalVisibility').addEventListener('change',e=>{visibility=e.target.value;render();});
  $('journalPositions').addEventListener('click',e=>{
    const close=e.target.closest('[data-journal-close]');if(close){openExit(close.dataset.journalClose);return;}
    const edit=e.target.closest('[data-journal-edit]');if(edit){openEdit(edit.dataset.journalEdit);return;}
    const del=e.target.closest('[data-journal-delete]');if(del)remove(del.dataset.journalDelete);
  });
  $('journalEntryForm').addEventListener('submit',doEntry);$('journalExitForm').addEventListener('submit',doExit);$('journalEditForm').addEventListener('submit',saveEdit);
  for(const [button,modal] of [['journalEntryCancel','journalEntryBackdrop'],['journalEntryBack','journalEntryBackdrop'],['journalExitCancel','journalExitBackdrop'],['journalExitBack','journalExitBackdrop'],['journalEditCancel','journalEditBackdrop']])$(button).addEventListener('click',()=>hideModal(modal));
  for(const id of ['journalEntryBackdrop','journalExitBackdrop','journalEditBackdrop'])$(id).addEventListener('click',e=>{if(e.target===$(id))hideModal(id);});
  window.addEventListener('keydown',e=>{if(e.key==='Escape'){hideModal('journalEntryBackdrop');hideModal('journalExitBackdrop');hideModal('journalEditBackdrop');}});
  $('journalExportJson').addEventListener('click',exportJson);$('journalExportCsv').addEventListener('click',exportCsv);$('journalImportButton').addEventListener('click',()=>$('journalImportFile').click());$('journalImportFile').addEventListener('change',importJson);
  setInterval(()=>{if(trades.some(t=>t.status==='OPEN'))render();},30000);
  onTab('REAL');
}
root.RadarJournalUI={init,openTrade,updateMarket};
})(window);
