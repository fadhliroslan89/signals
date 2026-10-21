'use strict';
/** Breakout Hunter v1.4. Only completed, contiguous 1m OHLCV candles. No order execution. */
const MINUTE = 60_000;
const FIVE = 5 * MINUTE;
const LIMITS = Object.freeze({oneLookback:12, oneVolumeLookback:20, fiveLookback:6, oneSpike:1.8, fiveSpike:1.4, freshOne:150_000, freshFive:210_000, nearPercent:0.45});
const finite = v => typeof v === 'number' && Number.isFinite(v);
function candlesFromKucoin(raw, now = Date.now()) {
  if (!Array.isArray(raw)) return [];
  return raw.map(c => {
    if (!Array.isArray(c) || c.length < 6) return null;
    const at = Number(c[0])*1000 + MINUTE;
    const [open,close,high,low,volume] = [c[1],c[2],c[3],c[4],c[5]].map(Number);
    if (![at,open,close,high,low,volume].every(Number.isFinite) || open<=0 || close<=0 || low<=0 || high<Math.max(open,close,low) || low>Math.min(open,close) || volume<0 || at>now || at<now-55*MINUTE) return null;
    return {at,open,close,high,low,volume};
  }).filter(Boolean);
}
function contiguous(bars, step=MINUTE) {
  return bars.every((b,i) => i===0 || b.at-bars[i-1].at===step);
}
function bucket5(bars){
  const groups=new Map();
  for(const b of bars){
    const start=Math.floor((b.at-1)/FIVE)*FIVE;
    if(!groups.has(start)) groups.set(start,[]);
    groups.get(start).push(b);
  }
  return [...groups].sort((a,b)=>a[0]-b[0]).map(([start,items])=>{
    items.sort((a,b)=>a.at-b.at);
    if(items.length!==5 || items[0].at!==start+MINUTE || items[4].at!==start+FIVE || !contiguous(items))return null;
    return {at:start+FIVE,open:items[0].open,close:items[4].close,high:Math.max(...items.map(x=>x.high)),low:Math.min(...items.map(x=>x.low)),volume:items.reduce((s,x)=>s+x.volume,0)};
  }).filter(Boolean);
}
function ratio(bars,last,period) {
  if(!last || bars.length<period+1) return null;
  const previous=bars.slice(-period-1,-1);
  if(previous.length!==period || !contiguous([...previous,last]))return null;
  const avg=previous.reduce((s,b)=>s+b.volume,0)/period;
  return avg>0 ? last.volume/avg : null;
}
function analyze(candleMap, now=Date.now(), config={minVolume:5_000_000,maxSpread:0.3}, row={}){
  const empty={coverage:'DATA',one:false,five:false,near:false,level1:null,level5:null,rvol1:null,rvol5:null,distance1:null,distance5:null,at1:null,at5:null,signal:'NONE',rank:0};
  if(!candleMap || typeof candleMap.values!=='function')return empty;
  const bars=[...candleMap.values()].filter(b=>b && finite(b.at)&&finite(b.high)&&finite(b.low)&&finite(b.close)&&finite(b.volume)).sort((a,b)=>a.at-b.at);
  if(bars.length<21) return empty;
  const last=bars.at(-1);
  const recent=now-last.at;
  if(recent<0 || recent>LIMITS.freshOne)return {...empty,coverage:'STALE',at1:last.at};
  const one=bars.slice(-21);
  if(!contiguous(one))return {...empty,coverage:'GAP',at1:last.at};
  const level1=Math.max(...one.slice(-13,-1).map(b=>b.high));
  const rvol1=ratio(one,last,20);
  const result={...empty,coverage:'READY',level1,rvol1,at1:last.at};
  const fiveBars=bucket5(bars);
  const f=fiveBars.at(-1);
  if(f && now-f.at>=0 && now-f.at<=LIMITS.freshFive){
    const five=fiveBars.slice(-7);
    if(five.length===7 && contiguous(five,FIVE)){
      result.at5=f.at;
      result.level5=Math.max(...five.slice(0,-1).map(b=>b.high));
      const prev=five.slice(0,-1);
      const avg=prev.reduce((sum,b)=>sum+b.volume,0)/prev.length;
      result.rvol5=avg>0?f.volume/avg:null;
      result.five=f.close>result.level5 && result.rvol5!==null && result.rvol5>=LIMITS.fiveSpike;
    }
  }
  result.one=last.close>level1 && rvol1!==null && rvol1>=LIMITS.oneSpike;
  const currentPrice=finite(row.price) && row.price>0 ? row.price:last.close;
  result.distance1=100*(level1/currentPrice-1);
  result.distance5=result.level5===null?null:100*(result.level5/currentPrice-1);
  const liquid=finite(row.volume) && row.volume>=config.minVolume && finite(row.spread) && row.spread>=0 && row.spread<=config.maxSpread;
  if(!liquid){result.signal='NONE';return result;}
  if(result.one || result.five){
    result.signal=result.one && result.five?'BREAKOUT 1M+5M':result.five?'BREAKOUT 5M':'BREAKOUT 1M';
  } else if(result.distance1 >= -0.10 && result.distance1<=LIMITS.nearPercent && rvol1!==null && rvol1>=1.15 && finite(row.m1) && row.m1>=-0.10){
    result.near=true;result.signal='SETUP';
  }
  const velocity=Math.max(0,Math.min(24,(finite(row.m1)?row.m1:0)*40));
  result.rank=Math.round(Math.min(100,(result.one?42:0)+(result.five?36:0)+(result.near?20:0)+Math.min(20,Math.max(0,(rvol1||0)-1)*14)+Math.min(14,Math.max(0,(result.rvol5||0)-1)*10)+velocity));
  return result;
}
module.exports={LIMITS,candlesFromKucoin,contiguous,bucket5,analyze};
