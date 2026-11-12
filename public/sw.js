/* KuCoin Radar v1.9.6: offline shell ONLY, never cache price/status/Telegram APIs. */
'use strict';
const CACHE = 'kucoin-radar-shell-v2.2';
const SHELL = [
  '/', '/index.html', '/styles.css', '/app.js', '/startup.js', '/icon.svg',
  '/manifest.webmanifest', '/radar-live-chart.css', '/radar-live-chart.js',
  '/paperlab-link.js', '/top10.js', '/acceleration.js', '/planner.js',
  '/journal-core.js', '/journal-ui.js', '/chart/', '/chart/index.html', '/chart-workspace.css', '/chart-workspace.js', '/chart-cloud.js', '/chart-link.js', '/entry-quality.js', '/quality70.js',
  '/hitrun.js', '/top70.js'
];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // A single unavailable asset must not prevent all other files from caching.
    await Promise.all(SHELL.map(async url => {
      try {
        const response = await fetch(url,{cache:'no-store'});
        if(response.ok) await cache.put(url, response);
      } catch (_) { /* retry once when online */ }
    }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('kucoin-radar-shell-') && key!==CACHE).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method!=='GET') return;
  const url = new URL(req.url);
  if(url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/paperlab/')) return;
  if(req.mode==='navigate') {
    // A cached page can load and display an honest OFFLINE message even while
    // Render wakes from sleep. Never show cached market prices as current.
    event.respondWith((async()=>{
      try {
        const response=await fetch(req,{signal:AbortSignal.timeout(8000)});
        if(response.ok) {
          const cache=await caches.open(CACHE);
          await cache.put('/', response.clone());
        }
        if(response.ok) return response;
      } catch (_) {}
      const cached = await caches.match('/') || await caches.match('/index.html');
      return cached || new Response('<!doctype html><html lang="ms"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;padding:2rem;background:#071322;color:white"><h2>KuCoin Radar belum dapat dihubungi</h2><p>Server Render mungkin sedang bangun atau tidak memberi respons. Cuba buka semula dalam beberapa saat. Tiada signal trading sah ketika offline.</p><button onclick="location.reload()">Cuba lagi</button></body></html>',{status:503,headers:{'Content-Type':'text/html;charset=utf-8'}});
    })());return;
  }
  const pathname=url.pathname;
  if(!SHELL.includes(pathname)) return;
  event.respondWith((async()=>{
    const cached=await caches.match(pathname);
    if(cached) {
      event.waitUntil(fetch(req).then(async response=>{
        if(response.ok){const cache=await caches.open(CACHE);await cache.put(pathname,response.clone());}
      }).catch(()=>{}));
      return cached;
    }
    return fetch(req);
  })());
});
