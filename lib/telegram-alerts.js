'use strict';
/**
 * Server-side Telegram notifications for KuCoin Radar.
 * Only VERIFIED BUY is called BUY. A 70+ observation is ALWAYS marked NOT BUY.
 * Observations baseline when early candle coverage is available to avoid
 * blasting a full watchlist on every Render cold start.
 * All state is process-local; Render Free does not guarantee 24/7 delivery.
 */
const { isHigh, verifiedBuy, marketHigh, breakoutHigh, bestScore } = require('../public/top70');

const LIMIT_PER_TICK = 3;
const LIMIT_PER_HOUR = 18;
const BUY_COOLDOWN_MS = 20 * 60_000;
const OBS_COOLDOWN_MS = 60 * 60_000;
const RETRY_COOLDOWN_MS = 60_000;
const cap = value => Number.isFinite(value) ? Number(value).toFixed(2) : '—';
const money = value => Number.isFinite(value) ? Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—';
const percent = value => Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}%` : '—';
const stamp = time => new Date(time).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const isMode = mode => ['buy', 'both'].includes(mode);
const safeMode = mode => isMode(mode) ? mode : 'buy';
const breakoutKey = row => row.breakout && Number.isFinite(row.breakout.at1) ? `:${row.breakout.at1}` : '';
const urlFor = symbol => `https://www.kucoin.com/trade/${encodeURIComponent(symbol)}`;
function classify(row) {
  if (!row || !isHigh(row)) return null;
  if (verifiedBuy(row)) return 'BUY';
  return 'OBS';
}
function messageFor(row, type, at) {
  const market = marketHigh(row) ? `${Math.round(row.score)}/100` : '—';
  const breakout = breakoutHigh(row) ? `${Math.round(row.breakout.rank)}/100` : '—';
  const info = [
    type === 'BUY' ? '🟢 KUCOIN — BUY DISAHKAN (SKOR ≥70)' : '👀 KUCOIN RADAR 70+ — BUKAN SIGNAL BUY',
    `${row.symbol} • Harga ${money(row.price)} USDT`,
    `Skor Market: ${market} | Breakout: ${breakout}`,
    `Status scanner: ${row.status}`,
    `5m ${percent(row.m5)} • 15m ${percent(row.m15)} • 30m ${percent(row.m30)}`,
    `Volume 24j: ${money(row.volume)} USDT • Spread ${cap(row.spread)}%`,
    type === 'BUY'
      ? 'Syarat entry terpilih telah lulus pada data scanner. Semak carta, slippage dan risiko sebelum keputusan sendiri.'
      : `Pemerhatian sahaja (${row.status}). Skor tinggi tidak bermaksud coin selamat dibeli.`,
    `Masa data: ${stamp(at)} (MYT)`,
    urlFor(row.symbol),
  ];
  return info.join('\n');
}
function createTelegramEngine({ send, mode = 'buy', clock = Date.now } = {}) {
  if (typeof send !== 'function') throw new TypeError('send function required');
  mode = safeMode(mode);
  let baselineReady = false;
  let previousObservations = new Set();
  let pending = new Map();
  let handledBuy = new Set();
  let sentAt = new Map();
  let sentTimes = [];
  let busy = false;
  let lastError = null;
  let lastSentAt = null;
  let sentCount = 0;
  let failureUntil = 0;
  async function tick(rows, { ready = false, now = clock() } = {}) {
    if (busy) return { skipped: 'busy' };
    const list = Array.isArray(rows) ? rows : [];
    const obs = list.filter(r => classify(r) === 'OBS');
    const active = new Set(obs.map(r => r.symbol));
    // Do not send dozens of old high scores when the service wakes up.
    if (mode === 'both' && ready && !baselineReady) {
      baselineReady = true;
      previousObservations = active;
    } else if (mode === 'both' && baselineReady) {
      for (const r of obs) {
        if (!previousObservations.has(r.symbol) && !pending.has(`OBS:${r.symbol}`)) {
          pending.set(`OBS:${r.symbol}`, { row: r, type: 'OBS', event: `OBS:${r.symbol}`, createdAt:now });
        }
      }
      previousObservations = active;
    }
    // An observation that fell below 70 must not be delivered afterwards.
    for (const [id, item] of pending) if (item.type === 'OBS' && !active.has(item.row.symbol)) pending.delete(id);
    // Confirmed BUY are prioritized. Require the full entry gate, not just score.
    for (const r of list) {
      if (classify(r) !== 'BUY') continue;
      const event = `BUY:${r.symbol}${breakoutKey(r)}`;
      if (!handledBuy.has(event) && !pending.has(event)) pending.set(event, { row: r, type: 'BUY', event, createdAt:now });
    }
    const currentBuy = new Set(list.filter(r => classify(r) === 'BUY').map(r => `BUY:${r.symbol}${breakoutKey(r)}`));
    for (const [id, item] of pending) if (item.type === 'BUY' && !currentBuy.has(id)) pending.delete(id);
    // A backlogged signal must never arrive hours after it was actionable.
    for (const [id, item] of pending) {
      if (now - item.createdAt > (item.type === 'BUY' ? 90_000 : 120_000)) pending.delete(id);
    }
    if (now < failureUntil) return { skipped: 'retry-cooldown' };
    busy = true;
    let count = 0;
    try {
      sentTimes = sentTimes.filter(t => now - t < 60 * 60_000);
      const ordered = [...pending.entries()].sort((a,b) => (a[1].type === 'BUY' ? -1 : 1) - (b[1].type === 'BUY' ? -1 : 1) || bestScore(b[1].row) - bestScore(a[1].row));
      for (const [key, item] of ordered) {
        if (count >= LIMIT_PER_TICK || sentTimes.length >= LIMIT_PER_HOUR) break;
        const previous = sentAt.get(`${item.type}:${item.row.symbol}`);
        const cooldown = item.type === 'BUY' ? BUY_COOLDOWN_MS : OBS_COOLDOWN_MS;
        if (previous !== undefined && now - previous < cooldown) { pending.delete(key); continue; }
        try {
          await send(messageFor(item.row, item.type, now));
          pending.delete(key);
          sentAt.set(`${item.type}:${item.row.symbol}`, now);
          if (item.type === 'BUY') handledBuy.add(item.event);
          sentTimes.push(now);
          count++; sentCount++; lastSentAt = now; lastError = null;
        } catch (err) {
          lastError = String(err.message || err).slice(0, 180);
          failureUntil = now + RETRY_COOLDOWN_MS;
          break; // avoid burst retries if Telegram is unavailable / rate-limits
        }
      }
      // Prevent unlimited memory growth on long-running services.
      if (handledBuy.size > 2000) handledBuy = new Set([...handledBuy].slice(-1000));
      if (sentAt.size > 2000) sentAt = new Map([...sentAt].slice(-1000));
      return { sent: count, pending: pending.size, error: lastError };
    } finally { busy = false; }
  }
  return {
    tick,
    status() { return { mode, sentCount, lastSentAt, lastError, pending: pending.size, observationsReady: baselineReady, hourly: sentTimes.length }; },
    recordTest(at = clock()) { sentCount++; lastSentAt = at; lastError = null; },
    recordTestFailure(err) { lastError = String(err.message || err).slice(0, 180); },
  };
}
module.exports = { classify, messageFor, createTelegramEngine, safeMode };
