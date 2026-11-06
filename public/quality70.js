/* High-score observations; score is NOT a win-rate prediction. */
(function(root){
 'use strict';
 const MIN=70;
 const good=n=>typeof n==='number'&&Number.isFinite(n)&&n>=MIN&&n<=100;
 function qualifiedBuy(r){
   return !!r && r.status==='BUY' && good(r.score) && r.breakout?.coverage==='READY' && r.breakout.one===true && r.breakout.signal?.startsWith('BREAKOUT');
 }
 function breakoutWatch(r){
   return !!r && !qualifiedBuy(r) && r.breakout?.coverage==='READY' && r.breakout.signal?.startsWith('BREAKOUT') && good(r.breakout.rank);
 }
 function choose(rows,limit=6){
   const sample=Array.isArray(rows)?rows:[];
   const buys=sample.filter(qualifiedBuy).sort((a,b)=>b.score-a.score||b.breakout.rank-a.breakout.rank||b.volume-a.volume);
   const watch=sample.filter(breakoutWatch).sort((a,b)=>b.breakout.rank-a.breakout.rank||b.score-a.score||b.volume-a.volume);
   const max=Math.max(0,Math.min(20,limit));
   return {buyCount:buys.length,watchCount:watch.length,buys:buys.slice(0,max),watch:watch.slice(0,max)};
 }
 function gate(entry,score){
   if(entry?.status!=='BUY')return entry;
   if(good(score))return entry;
   return {...entry,status:'WATCH',reason:`Skor pasaran ${Number.isFinite(score)?Math.round(score):'—'}/100, bawah minimum ${MIN} untuk BUY terpilih`};
 }
 const api={MIN,qualifiedBuy,breakoutWatch,choose,gate};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root)root.RadarQuality70=api;
})(typeof window!=='undefined'?window:null);
