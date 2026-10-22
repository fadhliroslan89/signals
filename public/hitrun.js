'use strict';
/* Intraday high-volume gainers; a watchlist, NEVER a buy recommendation. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RadarHitRun = factory();
})(typeof window !== 'undefined' ? window : globalThis, function() {
  const stable = new Set(['USDC','USDT','DAI','FDUSD','TUSD','BUSD','USDD','USDE','USDP','PYUSD','EURC','USD1','USDY','USDG','RLUSD','USTC','SUSD','DUSD','USDX','GUSD','LUSD','FRAX','CUSD','EURI','AEUR','EURR','USDS','USDB','USDD']);
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  const defaults = Object.freeze({gain:10, volume:10_000_000, spread:0.30, limit:12,sort:'active'});
  function baseOf(symbol) { return typeof symbol === 'string' && /^[A-Z0-9]+-USDT$/.test(symbol) ? symbol.slice(0,-5) : null; }
  function isExcluded(symbol){
    const base=baseOf(symbol);
    if(!base || stable.has(base))return true;
    // Margin/leveraged tokens, index and inverse products are unsuitable here.
    return /(?:2L|2S|3L|3S|5L|5S|BULL|BEAR|UP|DOWN)$/.test(base);
  }
  function recent(row){
    const m1=finite(row.m1)?row.m1:null, m5=finite(row.m5)?row.m5:null, m15=finite(row.m15)?row.m15:null;
    if(m1===null || m5===null || m15===null)return {status:'DATA',reason:'Sejarah 1/5/15m belum lengkap',rank:0};
    if(m1>=1.2 || m5>=4)return {status:'TERLALU PANAS',reason:'Pergerakan singkat terlalu laju; risiko kejar harga',rank:0};
    if(m1< -0.10 || m5<0 || m15<0)return {status:'PULLBACK',reason:'Momentum intraday sedang melemah / pullback',rank:1};
    // Is the last minute driving at least one fifth of the 5-minute move?
    if(m1>=0.08 && m5>=0.30 && m15>=0.50 && m1 >= m5/5) return {status:'MEMECUT',reason:'1m/5m positif dan kadar 1m menyokong pecutan',rank:3};
    return {status:'PANTAU',reason:'Kenaikan 24j kuat, pengesahan entry belum cukup',rank:2};
  }
  function score(row){
    const r=recent(row);
    const vol=Math.min(28,Math.max(0,Math.log10(Math.max(1,row.volume)/1e6)*13));
    const gain=Math.min(22,Math.max(0,(row.change24h-10)*1.3+8));
    const short=(finite(row.m5)?Math.max(-8,Math.min(18,row.m5*11)):0)+(finite(row.m1)?Math.max(-7,Math.min(10,row.m1*18)):0);
    const liquid=Math.max(0,12-Math.min(12,row.spread*45));
    return Math.max(0,Math.min(100,Math.round(vol+gain+short+liquid+(r.status==='MEMECUT'?10:r.status==='PULLBACK'?-8:r.status==='TERLALU PANAS'?-9:0))));
  }
  function choose(rows, options={}) {
    const cfg={...defaults,...options};
    const minGain=finite(cfg.gain)&&cfg.gain>=0?cfg.gain:defaults.gain;
    const minVolume=finite(cfg.volume)&&cfg.volume>=0?cfg.volume:defaults.volume;
    const maxSpread=finite(cfg.spread)&&cfg.spread>=0?cfg.spread:defaults.spread;
    const chosen=(Array.isArray(rows)?rows:[])
      .filter(row=>row && !isExcluded(row.symbol) && finite(row.change24h) && row.change24h>=minGain
        && finite(row.volume) && row.volume>=minVolume && finite(row.spread) && row.spread>=0 && row.spread<=maxSpread && finite(row.price) && row.price>0)
      .map(row=>({...row,hitrun:recent(row),hitrunScore:score(row)}));
    const modes={
      active:(a,b)=>b.hitrun.rank-a.hitrun.rank || b.hitrunScore-a.hitrunScore || b.volume-a.volume,
      volume:(a,b)=>b.volume-a.volume || b.hitrunScore-a.hitrunScore,
      gain:(a,b)=>b.change24h-a.change24h || b.volume-a.volume,
    };
    const compare=modes[cfg.sort]||modes.active;
    chosen.sort((a,b)=>compare(a,b)||a.symbol.localeCompare(b.symbol));
    return {eligible:chosen.length, results:chosen.slice(0, Math.max(1,Math.min(25,Math.floor(cfg.limit)||defaults.limit))), accelerating:chosen.filter(x=>x.hitrun.status==='MEMECUT').length};
  }
  // Stage-by-stage diagnostics only from 24h ticker data; candle history is NOT required.
  // Counts are a funnel: valid universe -> gain -> gain+volume -> gain+volume+spread.
  function diagnose(rows, options={}) {
    const cfg={...defaults,...options};
    const tradable=(Array.isArray(rows)?rows:[]).filter(r=>r && !isExcluded(r.symbol) &&
      finite(r.price) && r.price>0 && finite(r.change24h) &&
      finite(r.volume) && r.volume>=0);
    const gain=tradable.filter(r=>r.change24h>=cfg.gain);
    const liquid=gain.filter(r=>r.volume>=cfg.volume);
    const qualified=liquid.filter(r=>finite(r.spread) && r.spread>=0 && r.spread<=cfg.spread);
    const top=tradable.filter(r=>r.change24h>0)
      .sort((a,b)=>b.change24h-a.change24h || b.volume-a.volume || a.symbol.localeCompare(b.symbol)).slice(0,8)
      .map(r=>{
        let reason='LULUS PENAPIS';
        if(r.change24h<cfg.gain)reason='KENAIKAN RENDAH';
        else if(r.volume<cfg.volume)reason='VOLUME RENDAH';
        else if(!finite(r.spread))reason='SPREAD TIADA DATA';
        else if(r.spread>cfg.spread)reason='SPREAD TINGGI';
        return {...r,diagnosticReason:reason};
      });
    return {universe:tradable.length,gain:gain.length,liquid:liquid.length,
      qualified:qualified.length,spreadMissing:liquid.filter(r=>!finite(r.spread)).length,
      top};
  }
  // v1.9: separate liquidity tiers. Both remain watchlists, not BUY signals.
  const DUAL = Object.freeze({highMin:5_000_000,aggressiveMin:1_000_000,highSpread:.15,aggressiveSpread:.25,highMax:null,limit:10});
  function signalContext(row) {
    const b=row.hitrunOhlcv;
    const ready=b?.coverage==='READY';
    const rvol1=ready&&finite(b.rvol1)?b.rvol1:null;
    const rvol5=ready&&finite(b.rvol5)?b.rvol5:null;
    const spike1=rvol1!==null&&rvol1>=1.8;
    const spike5=rvol5!==null&&rvol5>=1.4;
    const breakout=ready&&((b.one===true&&spike1)||(b.five===true&&spike5));
    const momentum=recent(row);
    let label='PANTAU',order=1,description='Belum cukup pengesahan entry; bukan signal BUY.';
    if(momentum.status==='DATA'){label='DATA';order=0;description='Data harga intraday belum lengkap.';}
    else if(momentum.status==='TERLALU PANAS'){label='TERLALU PANAS';order=0;description='Harga bergerak terlalu laju; elakkan kejar candle.';}
    else if(momentum.status==='PULLBACK'){label='PULLBACK';order=0;description='Momentum harga sedang lemah.';}
    else if(breakout){label='BREAKOUT SAH';order=5;description='Breakout candle tutup + volume spike; semak chart sebelum keputusan.';}
    else if(spike1||spike5){label='VOLUME SPIKE';order=4;description='RVOL meningkat tetapi breakout belum disahkan.';}
    else if(momentum.status==='MEMECUT'){label='MEMECUT';order=3;description='Momentum meningkat; menunggu breakout dan volume.';}
    else if(!ready){label='OHLCV MENUNGGU';order=1;description='Candle/volume terkini belum tersedia; bukan pengesahan.';}
    return {label,order,description,rvol1,rvol5,spike1,spike5,breakout,coverage:b?.coverage||'DATA',at1:ready?b.at1:null};
  }
  function dual(rows, options={}) {
    const cfg={...DUAL,...options};
    const gain=finite(cfg.gain)&&cfg.gain>=0?cfg.gain:10;
    const limit=Number.isInteger(cfg.limit)?Math.min(25,Math.max(1,cfg.limit)):10;
    const candidates=(Array.isArray(rows)?rows:[])
      .filter(r=>r&&!isExcluded(r.symbol)&&finite(r.change24h)&&r.change24h>=gain
        && finite(r.volume)&&finite(r.spread)&&r.spread>=0&&finite(r.price)&&r.price>0)
      .map(r=>{
        const insight=signalContext(r);
        // A screening score, never a predicted probability of success.
        const rating=Math.max(0,Math.min(100,Math.round(score(r)*.65 + insight.order*8 + (insight.spike1?5:0) + (insight.spike5?4:0))));
        return {...r,hitrun:recent(r),insight,hitrunScore:rating};
      });
    const high=candidates.filter(r=>r.volume>=cfg.highMin&&r.spread<=cfg.highSpread);
    const aggressive=candidates.filter(r=>r.volume>=cfg.aggressiveMin&&r.volume<cfg.highMin&&r.spread<=cfg.aggressiveSpread);
    function pick(items){
      const compare=cfg.sort==='volume'?(a,b)=>b.volume-a.volume:
        cfg.sort==='gain'?(a,b)=>b.change24h-a.change24h:
        cfg.sort==='breakout'?(a,b)=>Number(b.insight.breakout)-Number(a.insight.breakout)||b.insight.order-a.insight.order:
        (a,b)=>b.insight.order-a.insight.order||b.hitrunScore-a.hitrunScore;
      items.sort((a,b)=>compare(a,b)||b.hitrunScore-a.hitrunScore||b.volume-a.volume||a.symbol.localeCompare(b.symbol));
      return {eligible:items.length,results:items.slice(0,limit),breakouts:items.filter(r=>r.insight.breakout).length,spikes:items.filter(r=>r.insight.spike1||r.insight.spike5).length};
    }
    return {high:pick(high),aggressive:pick(aggressive),
      diagnostics:{gain:candidates.length,high:high.length,aggressive:aggressive.length,
        under1m:candidates.filter(r=>r.volume<cfg.aggressiveMin).length,
        spreadExcluded:candidates.filter(r=>r.volume>=cfg.aggressiveMin &&
          (r.volume>=cfg.highMin ? r.spread>cfg.highSpread : r.spread>cfg.aggressiveSpread)).length},
      thresholds:{gain,highMin:cfg.highMin,aggressiveMin:cfg.aggressiveMin,highSpread:cfg.highSpread,aggressiveSpread:cfg.aggressiveSpread}};
  }
  return {choose,score,recent,isExcluded,diagnose,dual,signalContext,defaults,DUAL};
});
