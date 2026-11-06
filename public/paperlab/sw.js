// v1.5 app cache, scoped to /paperlab/ only. Do not cache auth/data API requests.
const CACHE='paperlab-v1.5';
const ASSETS=['./','./index.html','./cloud-config.js','./cloud-sync.js','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('paperlab-')&&k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',e=>{
 const req=e.request,u=new URL(req.url);
 if(req.method!=='GET'||u.origin!==location.origin||!u.pathname.startsWith('/paperlab/'))return;
 if(req.mode==='navigate'){e.respondWith(fetch(req).catch(()=>caches.match('./index.html')));return}
 e.respondWith(fetch(req).catch(()=>caches.match(req)));
});
