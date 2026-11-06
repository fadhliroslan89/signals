/* KuCoin PaperLab v1.5 — Supabase Auth + Cloud Journal sync (no third-party JS dependency).
   Browser-side, user JWT + RLS. Optimistic revision prevents accidental cross-device overwrites.
   Legacy localStorage journal is never deleted; importing it requires an explicit choice. */
(()=>{'use strict';
const cfg=window.PAPERLAB_CLOUD||{}, BASE=String(cfg.url||'').replace(/\/$/,''), KEY=String(cfg.publishableKey||'');
const STORAGE='kucoin-paperlab-v1', SESSION='paperlab-cloud-session-v1';
const $=id=>document.getElementById(id);
const status=(message,kind='')=>{const e=$('cloudStatus');if(!e)return;e.textContent=message;e.dataset.kind=kind;};
let session=null, user=null, latest=null, revision=null, synced=false, lastSynced='', pending=false, syncing=false, lastCheck=0, tokenBusy=null, requestLock=false;
const configured=/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(BASE)&&KEY.startsWith('sb_publishable_');
function validState(x){return !!x&&x.version===1&&Array.isArray(x.trades)&&Number.isFinite(x.cash)&&Number.isFinite(x.initialBalance)}
function local(){try{const s=JSON.parse(localStorage.getItem(STORAGE)||'null');return validState(s)?s:null}catch{return null}}
const serialized=()=>JSON.stringify(local()||{version:1,initialBalance:1000,cash:1000,trades:[]});
function ui(){
  $('cloudLoggedOut').hidden=!!user;
  $('cloudLoggedIn').hidden=!user;
  $('cloudEmailName').textContent=user?.email||'';
  $('cloudSyncBtn').disabled=!user||pending;
  $('cloudDownloadBtn').disabled=!user||pending;
  $('cloudUploadBtn').disabled=!user||pending;
  $('cloudMode').textContent=synced?'AUTO SYNC ON':'BELUM SYNC';
  $('cloudMode').style.color=synced?'var(--green)':'var(--orange)';
}
function persistSession(){try{if(session)localStorage.setItem(SESSION,JSON.stringify(session));else localStorage.removeItem(SESSION)}catch{}}
async function call(url,{method='GET',body,auth=false,prefer}={}){
  if(!configured)throw Error('Publishable key belum diisi dalam cloud-config.js.');
  if(auth)await token();
  const headers={'apikey':KEY,'accept':'application/json'};
  if(body!==undefined)headers['content-type']='application/json';
  if(auth&&session)headers['authorization']='Bearer '+session.access_token;
  if(prefer)headers['Prefer']=prefer;
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);
  try{
    const r=await fetch(BASE+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:ctrl.signal,cache:'no-store'});
    const data=await r.json().catch(()=>null);
    if(!r.ok)throw Error(String(data?.msg||data?.message||data?.error_description||data?.error||('Supabase HTTP '+r.status)).slice(0,220));
    return data;
  }finally{clearTimeout(timer)}
}
async function token(){
  if(!session?.access_token)throw Error('Sila login dahulu.');
  if(session.expiresAt>Date.now()+60000)return;
  if(tokenBusy)return tokenBusy;
  tokenBusy=(async()=>{
    if(!session?.refresh_token)throw Error('Sesi tamat. Sila login semula.');
    const j=await call('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}});
    session={access_token:j.access_token,refresh_token:j.refresh_token||session.refresh_token,expiresAt:Date.now()+Number(j.expires_in||3600)*1000};persistSession();
  })();
  try{await tokenBusy}catch(e){session=null;user=null;synced=false;persistSession();ui();throw e}finally{tokenBusy=null}
}
async function identify(){const j=await call('/auth/v1/user',{auth:true});if(!j?.id)throw Error('Pengguna tidak sah.');user={id:j.id,email:j.email||''};ui()}
function applyCloud(data){
  if(!validState(data))throw Error('Data Cloud Journal tidak sah. Tiada rekod ditukar.');
  // Pause a running local Auto Monitor before replacing journal data with an external snapshot.
  const m=$('monitorToggle');if(m?.textContent.includes('Hentikan'))m.click();
  const value=JSON.stringify(data);localStorage.setItem(STORAGE,value);
  window.dispatchEvent(new StorageEvent('storage',{key:STORAGE,newValue:value,storageArea:localStorage,url:location.href}));
  lastSynced=value;
}
async function readCloud(){
  const rows=await call('/rest/v1/paperlab_journals?select=data,revision,updated_at&user_id=eq.'+encodeURIComponent(user.id),{auth:true});
  latest=Array.isArray(rows)&&rows.length?rows[0]:null;
  if(latest&&(!validState(latest.data)||!Number.isSafeInteger(Number(latest.revision))))throw Error('Format journal cloud tidak dijangka.');
  revision=latest?Number(latest.revision):null;
  lastCheck=Date.now();return latest;
}
async function initialize(){
  synced=false;latest=null;revision=null;ui();status('Membaca rekod cloud…');
  const row=await readCloud();const mine=local();
  if(row){
    const cloudJson=JSON.stringify(row.data);
    if(!mine?.trades.length||serialized()===cloudJson){applyCloud(row.data);synced=true;status('✓ Journal dari cloud dimuatkan. Auto sync aktif.','ok')}
    else{status('Cloud sudah mempunyai rekod. Pilih “Muat cloud” untuk gunakan cloud, atau “Hantar lokal” untuk gantikan cloud. Tiada data ditukar secara automatik.','warn')}
  } else {
    status('Cloud masih kosong. Journal dalam browser ini selamat. Klik “Hantar lokal ke cloud” untuk mula sync dan memindahkan rekod.','warn');
  }
  ui();
}
async function upload(initial=false){
  if(!user)return;
  if(pending)return;
  pending=true;ui();
  try{
    const snapshot=serialized(),state=JSON.parse(snapshot);
    if(!validState(state))throw Error('Journal tempatan tidak sah.');
    if(latest){
      if(!initial&&!confirm('Ini akan GANTI rekod cloud dengan journal dalam browser ini. Pastikan kau memilih device dengan rekod paling terkini. Teruskan?'))return;
      const r=await call('/rest/v1/paperlab_journals?user_id=eq.'+encodeURIComponent(user.id)+'&revision=eq.'+revision+'&select=revision,updated_at',{method:'PATCH',auth:true,prefer:'return=representation',body:{data:state,revision:revision+1,updated_at:new Date().toISOString()}});
      if(!Array.isArray(r)||r.length!==1)throw Error('CONFLICT: Cloud telah berubah pada device lain. Muat cloud dan semak sebelum upload semula.');
      revision=Number(r[0].revision);
    } else {
      const r=await call('/rest/v1/paperlab_journals?select=revision,updated_at',{method:'POST',auth:true,prefer:'return=representation',body:{user_id:user.id,data:state,revision:1}});
      if(!Array.isArray(r)||r.length!==1)throw Error('Gagal mewujudkan journal cloud.');
      revision=Number(r[0].revision);
    }
    latest={data:state,revision};lastSynced=snapshot;synced=true;
    status('✓ '+state.trades.length+' trade tersimpan dalam cloud · revision '+revision+'. Auto sync aktif.','ok');
  }catch(e){synced=false;status('⚠ '+e.message,'warn')}
  finally{pending=false;ui()}
}
async function download(){
  if(!user||pending)return;
  pending=true;ui();
  try{
    const row=await readCloud();if(!row){status('Belum ada journal di cloud.','warn');return}
    if(local()?.trades.length&&serialized()!==JSON.stringify(row.data)&&!confirm('Memuat cloud akan menggantikan journal yang dipaparkan dalam browser ini. Satu salinan tempatan disimpan untuk pemulihan. Teruskan?'))return;
    try{localStorage.setItem('kucoin-paperlab-backup-before-cloud-'+Date.now(),serialized())}catch{}
    applyCloud(row.data);synced=true;
    status('✓ Journal cloud dimuatkan: '+row.data.trades.length+' trade · revision '+revision+'.','ok');
  }catch(e){status('⚠ '+e.message,'warn')}
  finally{pending=false;ui()}
}
async function saveChanges(){
  if(!user||!synced||pending||syncing||requestLock)return;
  const snapshot=serialized();if(snapshot===lastSynced)return;
  syncing=true;
  try{
    const row=await call('/rest/v1/paperlab_journals?user_id=eq.'+encodeURIComponent(user.id)+'&revision=eq.'+revision+'&select=revision,updated_at',{method:'PATCH',auth:true,prefer:'return=representation',body:{data:JSON.parse(snapshot),revision:revision+1,updated_at:new Date().toISOString()}});
    if(!Array.isArray(row)||row.length!==1)throw Error('CONFLICT: Device lain sudah mengubah journal. Auto sync dihentikan untuk elakkan rekod tertimpa.');
    revision=Number(row[0].revision);lastSynced=snapshot;latest={data:JSON.parse(snapshot),revision};
    status('✓ Auto sync berjaya · '+new Date().toLocaleTimeString('ms-MY')+' · revision '+revision,'ok');
  }catch(e){synced=false;status('⚠ '+e.message+' Rekod tempatan masih ada.','warn')}
  finally{syncing=false;ui()}
}
async function remoteTick(){
  if(!synced||!user||pending||syncing||requestLock||document.visibilityState!=='visible')return;
  if(Date.now()-lastCheck<12000)return;
  if(serialized()!==lastSynced){await saveChanges();return}
  requestLock=true;const known=revision;
  try{
    const row=await readCloud();
    if(!row){synced=false;status('⚠ Journal cloud tiada. Sync dihentikan.','warn');return}
    if(revision>known){
      if(serialized()!==lastSynced){synced=false;status('⚠ Konflik data antara device. Pilih Muat cloud atau Hantar lokal.','warn')}
      else{applyCloud(row.data);status('✓ Perubahan daripada device lain dimuatkan · revision '+revision,'ok')}
    }
  }catch(e){status('⚠ Sambungan cloud: '+e.message,'warn')}finally{requestLock=false;ui()}
}
async function authSubmit(signup){
  if(pending)return;
  const email=$('cloudEmail').value.trim().toLowerCase(),password=$('cloudPassword').value;
  if(!email.includes('@')||password.length<6){status('Isi email dan password yang sah.','warn');return}
  pending=true;ui();status(signup?'Mendaftar akaun…':'Sedang login…');
  try{
    const route=signup?'/auth/v1/signup?redirect_to='+encodeURIComponent(location.origin+'/paperlab/'):'/auth/v1/token?grant_type=password';
    const j=await call(route,{method:'POST',body:{email,password}});
    $('cloudPassword').value='';
    if(signup&&!j.access_token){status('✓ Pendaftaran dihantar. Semak email untuk pengesahan, kemudian login di sini.','ok');return}
    if(!j.access_token)throw Error('Tiada token login diterima.');
    session={access_token:j.access_token,refresh_token:j.refresh_token,expiresAt:Date.now()+Number(j.expires_in||3600)*1000};persistSession();await identify();await initialize();
  }catch(e){status('⚠ '+e.message,'warn')}
  finally{pending=false;ui()}
}
async function bootstrap(){
  ui();
  if(!configured){status('⚠ Isi Publishable key dalam fail cloud-config.js di GitHub dahulu. Cloud Sync belum aktif; journal lokal masih boleh digunakan.','warn');$('cloudLoggedOut').hidden=true;return}
  try{
    const hash=new URLSearchParams(location.hash.replace(/^#/,''));
    if(hash.has('access_token')&&hash.has('refresh_token')){
      session={access_token:hash.get('access_token'),refresh_token:hash.get('refresh_token'),expiresAt:Date.now()+Number(hash.get('expires_in')||3600)*1000};persistSession();history.replaceState(null,'',location.pathname+location.search);
    }else{try{session=JSON.parse(localStorage.getItem(SESSION)||'null')}catch{session=null}}
    if(session?.access_token){await identify();await initialize()}
    else status('Cloud disediakan. Daftar / login untuk sync journal antara device.','ok');
  }catch(e){session=null;user=null;synced=false;persistSession();status('⚠ Sila login semula: '+e.message,'warn')}
  finally{ui()}
}
$('cloudSignupBtn').onclick=()=>authSubmit(true);
$('cloudLoginBtn').onclick=()=>authSubmit(false);
$('cloudLogoutBtn').onclick=()=>{session=null;user=null;synced=false;latest=null;revision=null;persistSession();$('cloudPassword').value='';ui();status('Sudah logout. Journal lokal kekal dalam browser ini; untuk privacy pada peranti kongsi, padam data browser selepas backup.','warn')};
$('cloudUploadBtn').onclick=()=>upload(false);
$('cloudDownloadBtn').onclick=()=>download();
$('cloudSyncBtn').onclick=async()=>{if(!synced){await download()}else{await saveChanges();await remoteTick()}};
setInterval(()=>{if(synced&&document.visibilityState==='visible')saveChanges()},2000);
setInterval(()=>remoteTick(),13000);
window.addEventListener('online',()=>{if(synced)saveChanges()});
window.addEventListener('storage',e=>{if(e.key===SESSION){session=null;user=null;synced=false;status('Akaun cloud berubah pada tab lain; refresh dan login semula.','warn');ui()}});
bootstrap();
})();
