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
  return {choose,score,recent,isExcluded,diagnose,defaults};
});
