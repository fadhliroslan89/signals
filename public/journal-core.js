/* KuCoin Radar — local, manual-only spot journal. No order placement. */
(function(root){
  'use strict';
  const KEY='kucoin-radar-trading-journal-v15';
  const MODES=['REAL','PAPER'];
  const REASONS=['TP','SL','MANUAL','TIME','OTHER'];
  const valid=n=>typeof n==='number'&&Number.isFinite(n);
  function finitePositive(n){return valid(n)&&n>0;}
  const isTime=t=>typeof t==='string'&&Number.isFinite(Date.parse(t));
  function normalize(obj){
    if(!obj||typeof obj!=='object'||Array.isArray(obj))return null;
    const t={...obj};
    if(typeof t.id!=='string'||t.id.length<5||t.id.length>100 || !/^[A-Za-z0-9_-]+$/.test(t.id))return null;
    if(typeof t.symbol!=='string'|| !/^[A-Z0-9]{1,25}-USDT$/.test(t.symbol))return null;
    if(!MODES.includes(t.mode)||!['OPEN','CLOSED'].includes(t.status))return null;
    if(!finitePositive(t.entry)||!finitePositive(t.quantity)||!finitePositive(t.cost))return null;
    if(!valid(t.feePct)||t.feePct<0||t.feePct>5)return null;
    if(!finitePositive(t.tp)||!finitePositive(t.sl)||t.tp<=t.entry||t.sl>=t.entry)return null;
    if(!isTime(t.openedAt))return null;
    if(t.status==='CLOSED'&&(!finitePositive(t.exit)||!isTime(t.closedAt)||!REASONS.includes(t.reason)))return null;
    return {
      id:t.id,symbol:t.symbol,mode:t.mode,status:t.status,entry:t.entry,quantity:t.quantity,cost:t.cost,feePct:t.feePct,
      tp:t.tp,sl:t.sl,openedAt:t.openedAt,closedAt:t.status==='CLOSED'?t.closedAt:null,
      exit:t.status==='CLOSED'?t.exit:null,reason:t.status==='CLOSED'?t.reason:null,
      source:String(t.source||'MANUAL').slice(0,30),note:String(t.note||'').slice(0,2000),
    };
  }
  function create(p,id){
    if(!p||!finitePositive(p.entry)||!finitePositive(p.budget)||!valid(p.feePct)||p.feePct<0||p.feePct>5||!valid(p.tpPct)||p.tpPct<=0||p.tpPct>100||!valid(p.slPct)||p.slPct<=0||p.slPct>=100)return null;
    const withQty=finitePositive(p.quantity);
    const quantity=withQty?p.quantity:p.budget/(p.entry*(1+p.feePct/100));
    const cost=withQty?quantity*p.entry*(1+p.feePct/100):p.budget;
    return normalize({id,symbol:p.symbol,mode:p.mode,status:'OPEN',entry:p.entry,quantity,cost,feePct:p.feePct,tp:p.entry*(1+p.tpPct/100),sl:p.entry*(1-p.slPct/100),openedAt:p.openedAt||new Date().toISOString(),source:p.source||'MANUAL',note:p.note||''});
  }
  function pnl(trade,exitPrice){
    if(!trade||!finitePositive(exitPrice))return null;
    const proceeds=trade.quantity*exitPrice*(1-trade.feePct/100);
    return {proceeds,pnl:proceeds-trade.cost,pct:(proceeds-trade.cost)/trade.cost*100};
  }
  function close(trade,exitPrice,reason,closedAt=new Date().toISOString()){
    if(!trade||trade.status!=='OPEN'||!REASONS.includes(reason)||!finitePositive(exitPrice)||!isTime(closedAt))return null;
    return normalize({...trade,status:'CLOSED',exit:exitPrice,reason,closedAt});
  }
  function stats(trades,mode){
    const list=trades.filter(t=>t.mode===mode),done=list.filter(t=>t.status==='CLOSED');
    const net=done.reduce((total,t)=>total+pnl(t,t.exit).pnl,0);
    const wins=done.filter(t=>pnl(t,t.exit).pnl>0.00000001).length;
    const losses=done.filter(t=>pnl(t,t.exit).pnl< -0.00000001).length;
    const even=done.length-wins-losses;
    return {open:list.length-done.length,closed:done.length,wins,losses,even,winRate:done.length?wins/done.length*100:null,net};
  }
  function safeCsvCell(v){
    let val=String(v??'');
    if(/^[\s]*[=+@\-\t\r]/.test(val) && !/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(val.trim()))val="'"+val;
    return '"'+val.replaceAll('"','""')+'"';
  }
  function csv(trades){
    const cols=['id','mode','symbol','status','source','openedAt','entry','quantity','cost','feePct','tp','sl','closedAt','exit','reason','pnlUSDT','pnlPct','note'];
    return '\uFEFF'+[cols.map(safeCsvCell).join(','),...trades.map(t=>cols.map(c=>safeCsvCell(c==='pnlUSDT'?t.status==='CLOSED'?pnl(t,t.exit).pnl:'':c==='pnlPct'?t.status==='CLOSED'?pnl(t,t.exit).pct:'':t[c])).join(','))].join('\r\n');
  }
  function encode(trades){return JSON.stringify({format:'kucoin-radar-journal',version:1,exportedAt:new Date().toISOString(),trades},null,2);}
  function parseBackup(text){
    let data;try{data=JSON.parse(text);}catch{return null;}
    if(data?.format!=='kucoin-radar-journal'||data.version!==1||!Array.isArray(data.trades)||data.trades.length>50000)return null;
    // Reject corrupt/incomplete backups instead of silently discarding rows.
    const trades=data.trades.map(normalize);if(trades.some(t=>!t))return null;
    return trades;
  }
  function merge(existing,imported){const byId=new Map(existing.map(t=>[t.id,t]));for(const t of imported)byId.set(t.id,t);return [...byId.values()].sort((a,b)=>Date.parse(b.openedAt)-Date.parse(a.openedAt));}
  const api={KEY,create,close,pnl,stats,normalize,csv,encode,parseBackup,merge};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.RadarJournalCore=api;
})(typeof window!=='undefined'?window:null);
