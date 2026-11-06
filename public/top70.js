/* Homepage selection of every score >=70; a score is not a win probability. */
(function(root){
 'use strict';
 const MIN=70;
 const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=MIN&&n<=100;
 const marketHigh=r=>!!r&&valid(r.score);
 const breakoutHigh=r=>!!r&&r.breakout?.coverage==='READY'&&valid(r.breakout?.rank);
 const isHigh=r=>marketHigh(r)||breakoutHigh(r);
 const verifiedBuy=r=>!!r&&r.status==='BUY'&&marketHigh(r)&&r.breakout?.coverage==='READY'&&r.breakout?.one===true&&String(r.breakout?.signal||'').startsWith('BREAKOUT');
 const bestScore=r=>Math.max(marketHigh(r)?r.score:-1,breakoutHigh(r)?r.breakout.rank:-1);
 function select(rows,{filter='ALL',query='',sort='best'}={}){
   const input=Array.isArray(rows)?rows:[];
   // Keep one card per symbol. A coin can have qualifying scores in BOTH models.
   const seen=new Set();
   const eligible=[];
   for(const r of input){
     if(!r||typeof r.symbol!=='string'||seen.has(r.symbol)||!isHigh(r))continue;
     seen.add(r.symbol);eligible.push(r);
   }
   const buys=eligible.filter(verifiedBuy).length;
   const stats={total:eligible.length,buys,observations:eligible.length-buys};
   const q=String(query||'').trim().toUpperCase();
   const filtered=eligible.filter(r=>(filter==='BUY'?verifiedBuy(r):filter==='OBS'?!verifiedBuy(r):true)&&(!q||r.symbol.toUpperCase().includes(q)));
   const normalized=['best','score','market','breakout'].includes(sort)?sort:'best';
   filtered.sort((a,b)=>{
     if(normalized==='best'&&verifiedBuy(a)!==verifiedBuy(b))return verifiedBuy(a)?-1:1;
     const aV=normalized==='market'?(valid(a.score)?a.score:-1):normalized==='breakout'?(breakoutHigh(a)?a.breakout.rank:-1):bestScore(a);
     const bV=normalized==='market'?(valid(b.score)?b.score:-1):normalized==='breakout'?(breakoutHigh(b)?b.breakout.rank:-1):bestScore(b);
     return bV-aV||Number(b.volume||0)-Number(a.volume||0)||a.symbol.localeCompare(b.symbol);
   });
   return {...stats,rows:filtered}; // NO slice: user requested ALL 70+ signals.
 }
 const api={MIN,marketHigh,breakoutHigh,isHigh,verifiedBuy,bestScore,select};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root)root.RadarTop70=api;
})(typeof window!=='undefined'?window:null);
