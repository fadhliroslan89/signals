/* Optional cloud drawings; reuse PaperLab's own Supabase session and PUBLIC publishable key.
 * No service-role key. Requires public.chart_workspaces + RLS, see SQL setup file.
 * Optimistic revision check stops concurrent cross-device writes instead of overwriting.
 */
(()=>{'use strict';
const chart=window.KuCoinChartWorkspace,$=id=>document.getElementById(id);
if(!chart)return;
const config=window.PAPERLAB_CLOUD||{},BASE=String(config.url||'').replace(/\/$/,''),KEY=String(config.publishableKey||'');
const configured=/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(BASE)&&KEY.startsWith('sb_publishable_');
const SESSION='paperlab-cloud-session-v1';let session=null,user=null,active=false,synced=false,remote=null,revision=null,lastSynced='',busy=false,shouldCheck=0,tokenBusy=null,timer=null,operation=0;
const info=(message,kind='')=>{const el=$('cloudMessage');el.textContent=message;el.dataset.kind=kind;};
function ui(){
 $('cloudEnable').textContent=active?'Cloud ON':'Sambung Cloud';$('cloudFlag').textContent=synced?'SYNC AKTIF':active?'PERLU SEMAK':'LOKAL';$('cloudFlag').dataset.active=String(synced);
 $('cloudEnable').disabled=busy;$('cloudLoad').disabled=!active||!remote||busy;$('cloudPush').disabled=!active||busy;
}
function loadSession(){try{session=JSON.parse(localStorage.getItem(SESSION)||'null')}catch{session=null}}
async function api(path,{method='GET',body,authorization=true,prefer}={}){
 if(!configured)throw Error('Cloud config PaperLab tidak tersedia.');
 if(authorization)await token();
 const headers={apikey:KEY,Accept:'application/json'};
 if(authorization)headers.Authorization='Bearer '+session.access_token;
 if(body!==undefined)headers['Content-Type']='application/json';if(prefer)headers.Prefer=prefer;
 const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),12000);
 try{const res=await fetch(BASE+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:ctrl.signal,cache:'no-store'});
  const data=await res.json().catch(()=>null);
  if(!res.ok)throw Error(String(data?.message||data?.error_description||data?.error||('HTTP '+res.status)).slice(0,190));return data;
 }finally{clearTimeout(timeout)}
}
async function token(){
 if(!session?.access_token)throw Error('Login dahulu di PaperLab → Cloud Journal.');
 if(session.expiresAt>Date.now()+60000)return;
 if(tokenBusy)return tokenBusy;
 tokenBusy=(async()=>{if(!session.refresh_token)throw Error('Sesi tamat. Login semula di PaperLab.');const j=await api('/auth/v1/token?grant_type=refresh_token',{authorization:false,method:'POST',body:{refresh_token:session.refresh_token}});session={access_token:j.access_token,refresh_token:j.refresh_token||session.refresh_token,expiresAt:Date.now()+Number(j.expires_in||3600)*1000};localStorage.setItem(SESSION,JSON.stringify(session))})();
 try{await tokenBusy}finally{tokenBusy=null}
}
function current(){const {symbol,tf}=chart.current();return {symbol,timeframe:tf}}
function snapshot(){return JSON.stringify(chart.getDrawings())}
async function getRemote(){const c=current();const q='/rest/v1/chart_workspaces?select=drawings,revision,updated_at&user_id=eq.'+encodeURIComponent(user.id)+'&symbol=eq.'+encodeURIComponent(c.symbol)+'&timeframe=eq.'+encodeURIComponent(c.timeframe);const rows=await api(q);if(!Array.isArray(rows))throw Error('Cloud mengembalikan data tidak sah.');return rows[0]||null}
async function checkCurrent(){
 if(!active||busy)return;const id=++operation;busy=true;ui();synced=false;
 try{remote=await getRemote();if(id!==operation)return;
  revision=remote?Number(remote.revision):null;const local=snapshot();
  if(remote&&!chart.validDrawings(remote.drawings))throw Error('Rekod drawing cloud rosak; tidak ditukar.');
  if(!remote){await push(false);info('Cloud kosong untuk '+current().symbol+' '+current().timeframe+'. Lukisan lokal telah disimpan.','ok');return}
  if(local===JSON.stringify(remote.drawings)){synced=true;lastSynced=local;info('Cloud sync aktif — lukisan lokal sama dengan cloud.','ok');return}
  if(chart.getDrawings().length===0){chart.setDrawings(remote.drawings);lastSynced=snapshot();synced=true;info('Lukisan cloud dipulihkan untuk '+current().symbol+' '+current().timeframe+'.','ok');return}
  info('Ada lukisan berbeza di cloud dan browser ini. Pilih “Muat daripada Cloud” atau “Simpan ke Cloud”. Tiada data ditimpa automatik.','warn');
 }catch(e){synced=false;info('Cloud belum boleh digunakan: '+e.message+' — lukisan lokal kekal.','warn')}
 finally{busy=false;ui()}
}
async function push(ask=true){
 if(!active)return;
 if(ask&&remote&&!confirm('Ini akan menggantikan versi cloud untuk '+current().symbol+' '+current().timeframe+'. Pastikan lukisan browser ini betul. Teruskan?'))return;
 const c=current(),value=chart.getDrawings();if(!chart.validDrawings(value))throw Error('Lukisan tidak sah.');
 let rows;
 if(remote){rows=await api('/rest/v1/chart_workspaces?user_id=eq.'+encodeURIComponent(user.id)+'&symbol=eq.'+encodeURIComponent(c.symbol)+'&timeframe=eq.'+encodeURIComponent(c.timeframe)+'&revision=eq.'+revision+'&select=revision,updated_at',{method:'PATCH',prefer:'return=representation',body:{drawings:value,revision:revision+1,updated_at:new Date().toISOString()}});
   if(!Array.isArray(rows)||rows.length!==1)throw Error('KONFLIK: Device lain sudah mengubah chart. Muat versi cloud dahulu.');
 }else{rows=await api('/rest/v1/chart_workspaces?select=revision,updated_at',{method:'POST',prefer:'return=representation',body:{user_id:user.id,...c,drawings:value,revision:1}});if(!Array.isArray(rows)||rows.length!==1)throw Error('Gagal cipta rekod cloud.')}
 revision=Number(rows[0].revision);remote={drawings:value,revision};lastSynced=JSON.stringify(value);synced=true;shouldCheck=Date.now()+12000;
}
async function start(){if(!configured){info('Konfigurasi cloud PaperLab tidak ditemui. Auto-save lokal masih berfungsi.','warn');return}loadSession();if(!session?.access_token){info('Login akaun Cloud Journal melalui PaperLab dahulu, kemudian kembali ke Full Chart.','warn');return}
 busy=true;ui();try{const j=await api('/auth/v1/user');if(!j?.id)throw Error('Akaun belum disahkan.');user={id:j.id,email:j.email||''};active=true;info('Akaun '+user.email+' disambung. Memeriksa rekod drawing…');}catch(e){info('Login cloud gagal: '+e.message,'warn')}finally{busy=false;ui()}if(active)await checkCurrent()
}
async function manualLoad(){if(!active||busy||!remote)return;busy=true;ui();try{if(chart.getDrawings().length&&!confirm('Ini akan menggantikan lukisan lokal untuk pair/timeframe sekarang. Salinan recovery akan disimpan dahulu. Teruskan?'))return;try{localStorage.setItem('kucoin-chart-recovery-'+Date.now(),snapshot())}catch{}chart.setDrawings(remote.drawings);synced=true;lastSynced=snapshot();info('✓ Lukisan dimuat daripada cloud. Auto sync aktif.','ok')}catch(e){info('Gagal muat cloud: '+e.message,'warn')}finally{busy=false;ui()}}
async function manualPush(){if(!active||busy)return;busy=true;ui();try{await push(true);if(synced)info('✓ Lukisan tersimpan dalam cloud. Auto sync aktif.','ok')}catch(e){synced=false;info('Gagal simpan cloud: '+e.message,'warn')}finally{busy=false;ui()}}
async function syncTick(){if(!synced||!active||busy||document.hidden)return;const currentValue=snapshot();if(currentValue!==lastSynced){busy=true;try{await push(false);info('✓ Auto sync cloud berjaya pada '+new Date().toLocaleTimeString('ms-MY'), 'ok')}catch(e){synced=false;info('Sync dihentikan: '+e.message+'. Lukisan lokal kekal.','warn')}finally{busy=false;ui()}return}
 if(Date.now()<shouldCheck)return;shouldCheck=Date.now()+15000;busy=true;try{const latest=await getRemote();if(!latest){synced=false;info('Rekod cloud telah dipadam. Sync dihentikan.','warn');return}if(Number(latest.revision)>revision){if(snapshot()!==lastSynced){synced=false;info('KONFLIK cloud: rekod berbeza, sync dihentikan.','warn')}else{remote=latest;revision=Number(latest.revision);chart.setDrawings(latest.drawings);lastSynced=snapshot();info('✓ Perubahan dari peranti lain dimuatkan.','ok')}}}catch(e){info('Semakan cloud gagal: '+e.message,'warn')}finally{busy=false;ui()}}
$('cloudEnable').addEventListener('click',()=>active?checkCurrent():start());$('cloudLoad').addEventListener('click',manualLoad);$('cloudPush').addEventListener('click',manualPush);
window.addEventListener('chart-workspace-change',e=>{if(e.detail?.switch&&active){synced=false;remote=null;revision=null;shouldCheck=0;checkCurrent()}});
window.addEventListener('storage',e=>{if(e.key===SESSION){active=false;synced=false;user=null;info('Sesi cloud berubah. Sambung semula selepas login PaperLab.','warn');ui()}});
setInterval(syncTick,3500);ui();info(configured?'Simpan lokal aktif. Sambungkan cloud selepas login PaperLab dan setup SQL.':'Simpan lokal aktif. Cloud config belum dipasang.');
})();
