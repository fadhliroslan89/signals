'use strict';

const DEFAULTS = Object.freeze({
  minVolume: 5_000_000, // USDT, trailing 24 hours
  maxSpread: 0.30,     // percent
  buy15: 1.1,         // percent price return
  buy30: 1.8,
  buy5: 0.2,
  watch15: 0.45,
  watch30: 0.7,
  target: 3.5,
  stop: 1.2,
  cooldownMinutes: 15,
});
function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function percent(from, to) {
  return from > 0 && to > 0 ? (to / from - 1) * 100 : null;
}
function spreadPercent(buy, sell) {
  const b = number(buy), s = number(sell);
  if (!(b > 0 && s > 0)) return null;
  return 200 * Math.abs(s - b) / (s + b);
}
function lookupPast(history, targetMs, allowedLagMs = 180_000) {
  if (!history) return null;
  let found = null, best = Infinity;
  for (const [at, price] of history) {
    const lag = targetMs - at;
    if (lag >= 0 && lag < best && lag <= allowedLagMs && price > 0) {
      found = price; best = lag;
    }
  }
  return found;
}
function scoreOf(row, cfg = DEFAULTS) {
  if (row.m15 === null || row.m30 === null || row.m5 === null || row.spread === null) return 0;
  const cap = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const momentum = cap(row.m15 / 3.2, 0, 1) * 32 + cap(row.m30 / 5, 0, 1) * 20;
  const immediacy = cap(row.m5 / 0.9, 0, 1) * 18;
  const liquid = cap((Math.log10(Math.max(1, row.volume)) - 5) / 3, 0, 1) * 15;
  const lowSpread = cap(1 - row.spread / Math.max(0.01, cfg.maxSpread * 2), 0, 1) * 15;
  const accel = row.m15 > ((row.m30 - row.m15) + 0.05) ? 4 : 0;
  // v1.3: downweight fading 1m/5m momentum; never change BUY/ WATCH thresholds.
  let shortTerm = 0;
  if ([row.m1, row.m5, row.m10].every(v => typeof v === 'number' && Number.isFinite(v)) && row.m5 > -100) {
    const previous5 = ((1 + row.m10 / 100) / (1 + row.m5 / 100) - 1) * 100;
    const delta = row.m5 - previous5;
    shortTerm = Math.max(-12, Math.min(8, delta * 12)) + (row.m1 < 0 ? -5 : row.m1 >= 0.10 ? 2 : 0);
  }
  return Math.round(Math.max(0, Math.min(100, momentum + immediacy + liquid + lowSpread + accel + shortTerm)));
}
function assess(row, cfg = DEFAULTS) {
  if (row.m15 === null || row.m30 === null || row.m5 === null || row.spread === null) return 'DATA';
  if (row.volume < cfg.minVolume || row.spread > cfg.maxSpread) return 'AVOID';
  // Require momentum and acceleration; not a recommendation or profit probability.
  const accelerating = row.m15 > (row.m30 - row.m15) + 0.05;
  if (row.m15 >= cfg.buy15 && row.m30 >= cfg.buy30 && row.m5 >= cfg.buy5 && accelerating) return 'BUY';
  if (row.m15 >= cfg.watch15 && row.m30 >= cfg.watch30 && row.m5 > -0.2) return 'WATCH';
  return 'AVOID';
}
function rowFromTicker(ticker, history, now, cfg = DEFAULTS) {
  const price = number(ticker.last);
  if (!(price > 0)) return null;
  const volume = number(ticker.volValue) || 0;
  const row = {
    symbol: ticker.symbol,
    price,
    bid: Math.min(number(ticker.buy) || 0, number(ticker.sell) || 0) || null,
    ask: Math.max(number(ticker.buy) || 0, number(ticker.sell) || 0) || null,
    volume,
    change24h: number(ticker.changeRate) === null ? null : number(ticker.changeRate) * 100,
    spread: spreadPercent(ticker.buy, ticker.sell),
    m1: percent(lookupPast(history, now - 1 * 60_000, 90_000), price),
    m5: percent(lookupPast(history, now - 5 * 60_000), price),
    m10: percent(lookupPast(history, now - 10 * 60_000), price),
    m15: percent(lookupPast(history, now - 15 * 60_000), price),
    m30: percent(lookupPast(history, now - 30 * 60_000), price),
  };
  row.score = scoreOf(row, cfg);
  row.status = assess(row, cfg);
  return row;
}
module.exports = { DEFAULTS, number, percent, spreadPercent, lookupPast, scoreOf, assess, rowFromTicker };
