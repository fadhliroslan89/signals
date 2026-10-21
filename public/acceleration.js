/* Browser + Node pure rules: accelerated momentum and near-entry watch. NOT a BUY signal. */
(function(root){
 'use strict';
 const valid=v=>typeof v==='number' && Number.isFinite(v);
 function metrics(r){
   if(!r || ![r.m1,r.m5,r.m10].every(valid) || r.m1 <= -100 || r.m5 <= -100 || r.m10 <= -100)return null;
   // Reconstruct return from T-10m to T-5m using compounded prices.
   const previous5=((1+r.m10/100)/(1+r.m5/100)-1)*100;
   const delta=r.m5-previous5; // percentage-point acceleration, not a forecast.
   return {m1:r.m1,last5:r.m5,previous5,delta,accelerating:delta>=0.10&&r.m1>=0};
 }
 function nearBuy(r,cfg){
   if(!r||!cfg||r.status==='BUY' || r.status==='DATA' || !metrics(r))return false;
   if(![r.spread,r.volume,r.m15,r.m30].every(valid))return false;
   const m=metrics(r);
   return r.volume>=cfg.minVolume && r.spread>=0 && r.spread<=cfg.maxSpread &&
       r.m15>=cfg.buy15*0.75 && r.m15<cfg.buy15*1.45 &&
       r.m30>=cfg.buy30*0.75 && r.m5>=Math.max(0.1,cfg.buy5*0.6) &&
       m.accelerating;
 }
 function shortlist(rows,cfg,limit=10){
   if(!Array.isArray(rows)||!root?.RadarTop10)return [];
   return root.RadarTop10.choose(rows,cfg,limit).leaders;
 }
 const api={metrics,nearBuy,shortlist};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root)root.RadarAcceleration=api;
})(typeof window!=='undefined'?window:null);
