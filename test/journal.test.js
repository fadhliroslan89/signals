'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const J=require('../public/journal-core.js');
const sample={symbol:'SOL-USDT',mode:'REAL',entry:100,budget:101,feePct:0.1,tpPct:3.5,slPct:1.2,openedAt:'2026-10-20T03:00:00.000Z',source:'BREAKOUT',note:'first trade'};
const id='jtrade1234';
test('create REAL open spot with buy fee included in budget',()=>{const t=J.create(sample,id);assert.equal(t.quantity,101/(100*1.001));assert.equal(t.cost,101);assert.equal(t.status,'OPEN');assert.ok(Math.abs(t.tp-103.5)<1e-8);assert.ok(Math.abs(t.sl-98.8)<1e-8);});
test('quantity override records actual quantity and cost',()=>{const t=J.create({...sample,quantity:1.25},id);assert.equal(t.quantity,1.25);assert.ok(Math.abs(t.cost-125.125)<1e-8);});
test('realized P&L counts both fees and winning rates',()=>{const t=J.create(sample,id);const w=J.close(t,103.5,'TP','2026-10-20T03:16:00.000Z');const l=J.close(J.create({...sample,mode:'PAPER'},'jpaper1234'),98,'SL','2026-10-20T03:15:00.000Z');const res=J.pnl(w,w.exit);assert.ok(res.pnl>0);assert.ok(res.pnl<3.5);assert.deepEqual([J.stats([w,l],'REAL').wins,J.stats([w,l],'REAL').closed],[1,1]);assert.equal(J.stats([w,l],'PAPER').losses,1);});
test('open positions never count in win rate',()=>{const s=J.stats([J.create(sample,id)],'REAL');assert.equal(s.winRate,null);assert.equal(s.open,1);assert.equal(s.closed,0);});
test('breakeven counted in denominator but not wins',()=>{const t=J.create({...sample,feePct:0},id);const a=J.close(t,100,'MANUAL','2026-10-20T03:20:00.000Z');const s=J.stats([a],'REAL');assert.equal(s.even,1);assert.equal(s.winRate,0);});
test('closed trade cannot be closed twice',()=>{const t=J.create(sample,id);const c=J.close(t,104,'TP');assert.equal(J.close(c,105,'TP'),null);});
test('reject malformed backup and keep existing records',()=>{const t=J.create(sample,id);assert.equal(J.parseBackup('{bad'),null);assert.equal(J.parseBackup(JSON.stringify({format:'kucoin-radar-journal',version:1,trades:[{symbol:'evil'}]})),null);const parsed=J.parseBackup(J.encode([t]));assert.equal(parsed[0].id,t.id);});
test('JSON merge deduplicates by ID',()=>{const t=J.create(sample,id);const merged=J.merge([t],[{...t,note:'changed'}]);assert.equal(merged.length,1);assert.equal(merged[0].note,'changed');});
test('CSV has expected columns and formula injection escaped in notes',()=>{const t=J.create({...sample,note:'=HYPERLINK("http://bad")'},id);const csv=J.csv([t]);assert.match(csv,/pnlUSDT/);assert.match(csv,/\'=HYPERLINK/);});
test('input validation rejects spot short/invalid/missing info',()=>{assert.equal(J.create({...sample,entry:-2},id),null);assert.equal(J.create({...sample,feePct:99},id),null);assert.equal(J.create({...sample,mode:'SHORT'},id),null);});
test('TP within 30 minutes tracked separately from ordinary win rate',()=>{
 const t=J.create(sample,'jtrade30a');
 const quick=J.close(t,103.5,'TP','2026-10-20T03:25:00.000Z');
 const slow=J.close(J.create(sample,'jtrade30b'),103.5,'TP','2026-10-20T04:00:00.000Z');
 const stats=J.stats([quick,slow],'REAL');
 assert.equal(stats.wins,2);
 assert.equal(stats.tp30,1);
 assert.equal(stats.tp30Pct,50);
});
test('expired OPEN paper trades are flagged but not auto-closed or counted as losses',()=>{
 const old=J.create({...sample,mode:'PAPER'},'jtrade30c');
 const s=J.stats([old],'PAPER');
 assert.equal(s.open,1);assert.equal(s.overdue,1);assert.equal(s.closed,0);assert.equal(s.winRate,null);
});
