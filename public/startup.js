/* Lightweight boot checker: preserves all journal data, never caches market API data. */
'use strict';
(() => {
  let pageReady = false;
  function warning(message) {
    const el = document.getElementById('runtimeWarning');
    if (!el) return;
    el.classList.remove('hidden');
    el.textContent = message;
  }
  window.addEventListener('radar:ready',()=>{ pageReady=true; });
  // A missing script is different from an offline KuCoin API.
  window.addEventListener('error',event=>{
    if (event.target?.tagName === 'SCRIPT') {
      warning('Gagal memuatkan fail dashboard. Periksa sambungan internet, kemudian cuba refresh. Trading Journal tidak dipadam.');
    }
  },true);
  setTimeout(()=>{
    if(!pageReady && !window.__RADAR_INIT_OK) {
      warning('Dashboard tidak dapat dimulakan. Cuba refresh halaman melalui Chrome. Jika masih gagal, semak /api/diagnostics di Render; jangan padam storan aplikasi kerana Trading Journal disimpan di sini.');
    }
  },15000);
  if ('serviceWorker' in navigator && location.protocol==='https:') {
    window.addEventListener('load',()=>{
      navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(()=>{});
    });
  }
})();
