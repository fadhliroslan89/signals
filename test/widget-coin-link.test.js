'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const base=path.join(__dirname,'../public');
test('deep link is limited to valid USDT symbols and only opens populated detail',()=>{
 const src=fs.readFileSync(path.join(base,'app.js'),'utf8');
 assert.match(src,/URLSearchParams\(window\.location\.search\)\.get\('coin'\)/);
 assert.match(src,/\^\[A-Z0-9\]\{1,20\}-USDT\$/);
 assert.match(src,/state\.rows\.some\(r=>r\.symbol===symbol\)/);
 assert.match(src,/openDetail\(symbol\)/);
});
test('cache version bumped to activate updated JS',()=>{
 const html=fs.readFileSync(path.join(base,'index.html'),'utf8');const sw=fs.readFileSync(path.join(base,'sw.js'),'utf8');
 assert.match(html,/\/app\.js\?v=2\.5/);
 assert.match(sw,/shell-v2\.5-widget-70-detail/);
});
