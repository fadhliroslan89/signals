'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function testEnv(){
 const handlers={}, saved=new Map(), origin='https://radar.test';
 const cache={
  async put(k,v){saved.set(new URL(k,origin).pathname,v.clone());},
  async match(k){return saved.get(new URL(k,origin).pathname)?.clone();},
 };
 let offline=false;
 const ctx={
  URL,AbortSignal,Response,console,
  self:{location:{origin},addEventListener(n,cb){handlers[n]=cb;},skipWaiting:async()=>{},clients:{claim:async()=>{}}},
  caches:{open:async()=>cache,keys:async()=>['kucoin-radar-shell-v1.9.6'],delete:async()=>true,match:async(k)=>cache.match(k)},
  fetch:async(req)=>{
   if(offline)throw Error('offline');
   const key=typeof req==='string'?req:req.url;
   return new Response('content:'+new URL(key,origin).pathname,{status:200,headers:{'content-type':'text/html'}});
  }
 };
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/sw.js'),'utf8'),ctx);
 return {handlers,saved,goOffline:()=>{offline=true}};
}
test('PWA caches only shell; no stale API status or trading signals',async()=>{
 const {handlers,saved,goOffline}=testEnv();
 let installing;handlers.install({waitUntil(p){installing=p;}});await installing;
 assert.ok(saved.has('/index.html'));assert.ok(saved.has('/app.js'));
 assert.equal(saved.has('/api/status'),false);
 goOffline();
 let response;
 handlers.fetch({request:{method:'GET',url:'https://radar.test/api/status',mode:'cors'},respondWith(p){response=p;},waitUntil(){}});
 assert.equal(response,undefined,'API fetch must bypass service worker entirely');
 let navigate;
 handlers.fetch({request:{method:'GET',url:'https://radar.test/',mode:'navigate'},respondWith(p){navigate=p;},waitUntil(){}});
 const page=await navigate;
 assert.equal(page.status,200);
 assert.match(await page.text(),/content:\//);
});
