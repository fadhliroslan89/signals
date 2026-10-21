/* Spot reference-only calculator. No orders. Fees/slippage estimates are illustrative. */
(function(root){
 'use strict';
 const valid=v=>typeof v==='number'&&Number.isFinite(v);
 function calculate(p){
   if(!p)return null;
   const {entry,budget,fee,slippage,target,stop}=p;
   if(![entry,budget,fee,slippage,target,stop].every(valid) || entry<=0||budget<=0||fee<0||fee>5||slippage<0||slippage>5||target<=0||target>100||stop<=0||stop>=100)return null;
   const f=fee/100,s=slippage/100;
   const effectiveEntry=entry*(1+s);
   const quantity=budget/(effectiveEntry*(1+f)); // budget includes estimated buy fee
   const tp=entry*(1+target/100);
   const sl=entry*(1-stop/100);
   function exit(level){const gross=quantity*level*(1-s);return gross*(1-f)-budget;}
   const netTP=exit(tp),netSL=exit(sl);
   const breakEven=budget/(quantity*(1-f)*(1-s));
   return {effectiveEntry,quantity,tp,sl,netTP,netSL,netTPPercent:netTP/budget*100,netSLPercent:netSL/budget*100,breakEven,rr:netSL<0?Math.max(netTP,0)/-netSL:null};
 }
 const api={calculate};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root)root.RadarPlanner=api;
})(typeof window!=='undefined'?window:null);
