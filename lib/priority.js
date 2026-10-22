'use strict';
/** Load the most useful KuCoin candles first. This is a data-fetch priority, not a BUY score. */
const { number, spreadPercent } = require('./scanner');
const { isExcluded } = require('../public/hitrun');
function prioritizedSymbols(symbols, tickers) {
  return [...symbols].sort((a, b) => {
    const aa = metrics(a, tickers), bb = metrics(b, tickers);
    return aa.group - bb.group || bb.volume - aa.volume || bb.gain - aa.gain || a.localeCompare(b);
  });
}
function metrics(symbol, tickers) {
  const t = tickers.get(symbol);
  if (!t) return {group: 4, volume: 0, gain: 0};
  const volume = number(t.volValue) || 0;
  const gain = (number(t.changeRate) || 0) * 100;
  const spread = spreadPercent(t.buy, t.sell);
  const reliableSpread = spread !== null;
  const hitrun = !isExcluded(symbol) && gain >= 10 && volume >= 1_000_000 && reliableSpread && spread <= 0.25;
  const liquid = volume >= 5_000_000 && reliableSpread && spread <= 0.30;
  return {group: hitrun ? 0 : liquid ? 1 : volume >= 1_000_000 ? 2 : 3, volume, gain};
}
module.exports = { prioritizedSymbols };
