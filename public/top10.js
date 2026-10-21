/* Top 10 shortlist helper. Pure calculations; no buy orders or price prediction. */
(function (root) {
  'use strict';
  function valid(v) { return typeof v === 'number' && Number.isFinite(v); }
  function eligible(row, filters) {
    if (!row || !filters) return false;
    if (![row.m5, row.m15, row.m30, row.volume, row.spread, row.score].every(valid)) return false;
    if (row.volume < filters.minVolume || row.spread > filters.maxSpread || row.spread < 0) return false;
    // Exclude falling 15/30m markets and sharp immediate retracements.
    if (row.m15 <= 0 || row.m30 <= 0 || row.m5 < -0.30) return false;
    return true;
  }
  function choose(rows, filters, limit = 10) {
    if (!Array.isArray(rows)) return { total: 0, leaders: [] };
    const qualified = rows.filter(row => eligible(row, filters));
    qualified.sort((a,b) => b.score - a.score || b.m15 - a.m15 || b.volume - a.volume || a.symbol.localeCompare(b.symbol));
    return { total: qualified.length, leaders: qualified.slice(0, Math.max(0, Math.min(10, limit))) };
  }
  const api = { eligible, choose };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.RadarTop10 = api;
})(typeof window !== 'undefined' ? window : null);
