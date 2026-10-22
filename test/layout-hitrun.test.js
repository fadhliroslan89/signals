'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=path.join(__dirname,'..','public');
test('Hit & Run is immediately under Journal and before Market Radar',()=>{
 const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
 const a=html.indexOf('id="journalSection"');
 const b=html.indexOf('id="hitrunSection"');
 const c=html.indexOf('REAL-TIME OPPORTUNITIES');
 assert.ok(a>0&&b>a&&c>b);
 assert.ok(/<\/section>\s*<!-- v1\.7 Intraday Hit & Run/.test(html));
 assert.ok(html.includes('src="/hitrun.js?v=1.7"'));
});
test('Hit & Run uses existing journal hook and never posts orders',()=>{
 const src=fs.readFileSync(path.join(base,'app.js'),'utf8');
 assert.match(src,/trackTrade\(track\.dataset\.hitrunTrack,'INTRADAY HIT & RUN'\)/);
 assert.match(src,/renderLeaders\(\);renderHunter\(\);renderHitRun\(\);renderRows\(\)/);
});
