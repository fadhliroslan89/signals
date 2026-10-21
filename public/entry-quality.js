/* Shared, conservative BUY gate. Pure JavaScript; no trading account access. */
(function(root){
'use strict';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
function evaluate(r,cfg={},now=Date.now()){
 const minVolume=finite(cfg.minVolume)?cfg.minVolume:5_000_000;
 const maxSpread=finite(cfg.maxSpread)?cfg.maxSpread:0.30;
 const buy15=finite(cfg.buy15)?cfg.buy15:1.10;
 const base={status:'DATA',reason:'Sejarah momentum belum lengkap',accel5:null};
 if(!r || ![r.m1,r.m5,r.m10,r.m15,r.m30,r.spread,r.volume,r.price].every(finite))return base;
 if(r.volume<minVolume||r.spread>maxSpread||r.spread<0)return {...base,status:'AVOID',reason:'Penapis liquidity/spread tidak lulus'};
 const watch=r.m15>=.45&&r.m30>=.70&&r.m5>-.20;
 if(!watch)return {...base,status:'AVOID',reason:'Momentum belum memenuhi syarat pantauan'};
 const previous5=((1+r.m10/100)/(1+r.m5/100)-1)*100;
 const accel5=r.m5-previous5;
 const wait=(why)=>({status:'WATCH',reason:why,accel5});
 if(r.volume<10_000_000||r.spread>0.12)return wait('Perlu turnover ≥10M USDT dan spread ≤0.12% untuk BUY');
 if(r.m1<0.10||r.m5<0.40||r.m15<Math.max(buy15,1.20)||r.m30<1.80||accel5<0.10||r.m15<=(r.m30-r.m15)+0.05)return wait('Momentum/pecutan 1m–30m belum cukup kuat');
 const b=r.breakout;
 if(!b||b.coverage!=='READY'||!b.one||!finite(b.rvol1)||b.rvol1<1.8||!finite(b.level1)||b.level1<=0)return wait('Belum ada breakout candle 1m dengan lonjakan volume disahkan');
 if(!finite(b.at1)||now-b.at1<0||now-b.at1>100_000)return wait('Breakout sudah lewat / data OHLCV belum segar');
 const chase=(r.price/b.level1-1)*100;
 if(chase<0||chase>0.65)return wait('Harga sudah kembali bawah breakout atau terlalu jauh selepas breakout');
 return {status:'BUY',reason:'Breakout 1m disahkan + volume spike + momentum segar (tetap bukan jaminan)',accel5};
}
const api={evaluate};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(root)root.RadarEntryQuality=api;
})(typeof window!=='undefined'?window:null);
