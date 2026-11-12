/* v2.0 chart link extension. Never mutates scanner BUY or PaperLab state. */
(()=>{'use strict';
const target=document.getElementById('openFullChart'),title=document.getElementById('detailTitle');
const valid=s=>/^[A-Z0-9]{1,20}-USDT$/.test(s||'');
const url=s=>'/chart/?symbol='+encodeURIComponent(s);
function detail(){if(!target||!title)return;const m=(title.textContent||'').toUpperCase().match(/([A-Z0-9]{1,20}-USDT)/);target.href=m&&valid(m[1])?url(m[1]):'/chart/'}
if(target&&title){new MutationObserver(detail).observe(title,{childList:true,characterData:true,subtree:true});detail()}
const areas=['top70Cards','qualityBuyCards','leaderCards','hunterCards','hitrunHighCards','hitrunAggCards'];
function attach(){
 for(const id of areas){const root=document.getElementById(id);if(!root)continue;
  for(const btn of root.querySelectorAll('[data-top70-track],[data-quality-track],[data-track],[data-hitrun-track]')){
   const coin=btn.dataset.top70Track||btn.dataset.qualityTrack||btn.dataset.track||btn.dataset.hitrunTrack;
   if(!valid(coin)||btn.parentElement?.querySelector('.direct-full-chart'))continue;
   const a=document.createElement('a');a.className='direct-full-chart';a.href=url(coin);a.textContent='▥ Full Chart';a.title='Buka chart '+coin+' dan lukisan tersimpan';btn.insertAdjacentElement('afterend',a);
  }
 }
}
let scheduled=false;const schedule=()=>{if(scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;attach()},300)};
new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});attach();
})();
