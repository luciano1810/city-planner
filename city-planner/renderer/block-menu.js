/* Block planning uses the existing renewal selection, preview and project flow. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const targets=[
    ['residential','住宅社区','住宅与社区商业'],
    ['commercial','商业中心','商业与办公'],
    ['office','办公园区','办公与配套商业'],
    ['industrial','产业园区','工业与仓储'],
    ['warehouse','仓储园区','仓储与工业'],
    ['mixed','混合街区','住宅、商业与办公']
  ];
  const maintenance=[['renovate','建筑翻新','保留用途、轮廓与容量'],['onsite','原址重建','保留地块与建筑轮廓']];
  function create({button,dock,onOpen}){
    const menu=document.createElement('section');menu.id='workspace-block-menu';menu.className='build-menu block-menu';menu.hidden=true;menu.setAttribute('aria-label','区块菜单');
    menu.innerHTML=`<header class="build-menu-header"><div class="build-tabs" role="tablist" aria-label="区块操作">${[['redevelop','改造'],['maintain','维护'],['projects','项目']].map(([key,label],i)=>`<button id="block-tab-${key}" role="tab" aria-controls="block-${key}" aria-selected="${i===0}" tabindex="${i===0?0:-1}">${label}</button>`).join('')}</div><span class="build-menu-caption" id="block-caption">选择目标用途，再选择地图上的区块</span><button class="city-btn block-advanced-toggle" id="block-advanced-toggle" aria-haspopup="dialog" aria-controls="block-advanced-panel" aria-expanded="false">高级 <span aria-hidden="true">⌄</span></button><div class="build-card-paging"><button aria-label="向前浏览区块卡片">‹</button><button aria-label="向后浏览区块卡片">›</button></div><button class="build-menu-close icon-btn" aria-label="收起区块菜单"><svg><use href="#ui-close"/></svg></button></header><section id="block-redevelop" role="tabpanel" aria-labelledby="block-tab-redevelop"><div class="build-cards"></div></section><section id="block-maintain" role="tabpanel" aria-labelledby="block-tab-maintain" hidden><div class="build-cards"></div></section><section id="block-projects" role="tabpanel" aria-labelledby="block-tab-projects" hidden></section><div class="block-actions"></div>`;
    const advanced=document.createElement('section');advanced.id='block-advanced-panel';advanced.className='build-menu build-advanced block-advanced';advanced.hidden=true;advanced.setAttribute('role','dialog');advanced.setAttribute('aria-label','区块高级设置');
    advanced.innerHTML='<header class="build-advanced-header"><strong>区块设置</strong><button class="icon-btn" aria-label="收起区块高级菜单"><svg><use href="#ui-close"/></svg></button></header><div class="block-growth-settings"></div><div class="block-planning-tools"><strong>规划辅助</strong></div>';
    document.querySelector('.app-layout').append(menu,advanced);
    button.setAttribute('aria-controls',menu.id);button.setAttribute('aria-expanded','false');
    const selection=document.querySelector('[data-tool="renewal"]'),preview=$('city-renewal-preview'),clear=$('city-renewal-clear');
    const groups=new Set([selection,$('city-auto-grow'),$('city-grid-demo')].map(node=>node.closest('.workspace-group')));
    menu.querySelector('.block-actions').append(selection,clear,preview,$('city-renewal-selection'));
    $('block-projects').append($('city-renewal-list'));
    advanced.querySelector('.block-growth-settings').append($('city-auto-renew').closest('label'),$('city-auto-grow').closest('label'));
    advanced.querySelector('.block-planning-tools').append($('city-grid-demo'),document.querySelector('[data-tool="gateway"]'));
    for(const group of groups)group.remove();
    const cards=new Map(),paging=menu.querySelector('.build-card-paging'),pageButtons=[...paging.children];
    let opened=false,tab='redevelop',target='residential',mode='renovate',previousRail=null;
    for(const [key,items] of [['redevelop',targets],['maintain',maintenance]]){
      const row=$('block-'+key).querySelector('.build-cards');
      for(const [kind,label,note] of items){
        const card=document.createElement('button');card.className='build-card';card.dataset.blockKind=kind;
        card.innerHTML=`<span class="build-thumbnail"><canvas width="600" height="360" aria-hidden="true"></canvas></span><span class="build-card-label">${label}</span><span class="build-card-note">${note}</span>`;
        card.onclick=()=>{if(CityApp.working)return;if(key==='redevelop')target=kind;else mode=kind;selection.click();sync();};
        row.append(card);cards.set(kind,card);
        CityBuildingPreviews.attach(card.querySelector('canvas'),kind);
      }
      row.addEventListener('scroll',syncPaging,{passive:true});
    }
    const currentRow=()=>tab==='projects'?$('city-renewal-list'):$('block-'+tab).querySelector('.build-cards');
    function syncPaging(){
      const row=currentRow();paging.hidden=row.scrollWidth<=row.clientWidth+1;
      pageButtons[0].disabled=row.scrollLeft<1;pageButtons[1].disabled=row.scrollLeft+row.clientWidth>=row.scrollWidth-1;
    }
    pageButtons.forEach((node,i)=>node.onclick=()=>currentRow().scrollBy({left:(i?1:-1)*currentRow().clientWidth*.7,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));
    preview.onclick=()=>CityApp.previewRenewal({mode:tab==='maintain'?mode:'rebuild',target});
    function sync(){
      const ids=CityApp.renewalSelection,state=CityApp.state;
      const maintain=tab==='maintain',hasBuilding=ids.length===1&&state?.parcels.find(p=>p.id===ids[0])?.building;
      preview.disabled=CityApp.working||!ids.length||(maintain&&!hasBuilding);
      preview.textContent=maintain?(mode==='renovate'?'预览翻新方案':'预览重建方案'):'预览改造方案';
      selection.textContent=maintain?'选择建筑':'选择区块';
      for(const [kind,card] of cards){const active=kind===(tab==='maintain'?mode:target);card.classList.toggle('active',active);card.setAttribute('aria-pressed',String(active));}
      $('block-caption').textContent=tab==='projects'?'查看分期、进度与安置情况':maintain?'选择一栋已有建筑，再预览维护方案':'选择目标用途，再选择地图上的区块';
      if(maintain)$('city-renewal-selection').textContent=ids.length?(hasBuilding?'已选 1 栋建筑':'维护需要选择 1 栋已有建筑'):'点击地图上的建筑选择';
      else $('city-renewal-selection').textContent=ids.length?`已选 ${ids.length} 块土地${ids.length===1?' · 改造时使用所在街区':''}`:'点击区块选择，再次点击取消';
      button.classList.toggle('active',opened);
      if(opened)document.querySelectorAll('.workspace-rail [data-category]').forEach(node=>{const active=node.dataset.category==='buildings';node.classList.toggle('active',active);node.setAttribute('aria-pressed',String(active));});
      position();
    }
    function showTab(next){
      tab=next;toggleAdvanced(false);
      for(const key of ['redevelop','maintain','projects']){const active=key===tab,node=$('block-tab-'+key);node.setAttribute('aria-selected',String(active));node.tabIndex=active?0:-1;$('block-'+key).hidden=!active;}
      menu.querySelector('.block-actions').hidden=tab==='projects';
      if(tab!=='projects'&&CityApp.tool!=='renewal')selection.click();
      sync();
    }
    function position(){
      if(!opened)return;
      const rect=dock.getBoundingClientRect(),margin=12,width=Math.min(950,innerWidth-margin*2);
      menu.style.width=width+'px';menu.style.left=Math.max(margin,Math.min(innerWidth-width-margin,rect.x+rect.width/2-width/2))+'px';
      menu.style.bottom=(innerHeight-rect.top+16)+'px';
      menu.style.maxHeight=Math.max(150,rect.top-document.querySelector('.city-kpis').getBoundingClientRect().bottom-28)+'px';
      syncPaging();positionAdvanced();
    }
    function positionAdvanced(){
      if(advanced.hidden)return;
      const anchor=$('block-advanced-toggle').getBoundingClientRect(),margin=12,gap=8,width=Math.min(340,innerWidth-margin*2);
      advanced.style.width=width+'px';advanced.style.maxHeight=(innerHeight-margin*2)+'px';
      const height=advanced.offsetHeight,above=anchor.top-gap-margin,below=innerHeight-anchor.bottom-gap-margin,downward=below>=height||below>=above;
      advanced.style.maxHeight=Math.max(60,downward?below:above)+'px';advanced.style.left=Math.max(margin,Math.min(innerWidth-width-margin,anchor.right-width))+'px';
      advanced.style.top=(downward?anchor.bottom+gap:Math.max(margin,anchor.top-gap-advanced.offsetHeight))+'px';
    }
    function toggleAdvanced(expanded,{focus=false}={}){
      advanced.hidden=!expanded;$('block-advanced-toggle').setAttribute('aria-expanded',String(expanded));
      if(expanded){positionAdvanced();$('city-auto-renew').focus({preventScroll:true});}else if(focus)$('block-advanced-toggle').focus({preventScroll:true});
    }
    function open(){
      if(!CityApp.active)return;
      if(!opened)previousRail=document.querySelector('.workspace-rail [data-category].active')?.dataset.category;
      onOpen();opened=true;menu.hidden=false;document.body.classList.add('block-menu-open');document.body.classList.remove('show-inspector');button.setAttribute('aria-expanded','true');showTab(tab);
    }
    function close({focus=false}={}){
      toggleAdvanced(false);opened=false;menu.hidden=true;document.body.classList.remove('block-menu-open');button.classList.remove('active');button.setAttribute('aria-expanded','false');
      if(previousRail)document.querySelectorAll('.workspace-rail [data-category]').forEach(node=>{const active=node.dataset.category===previousRail;node.classList.toggle('active',active);node.setAttribute('aria-pressed',String(active));});
      previousRail=null;if(focus)button.focus();
    }
    const tabs=['redevelop','maintain','projects'];
    for(const key of tabs){const node=$('block-tab-'+key);node.onclick=()=>showTab(key);node.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?tabs[0]:event.key==='End'?tabs[2]:tabs[(tabs.indexOf(key)+(event.key==='ArrowRight'?1:2))%3];showTab(next);$('block-tab-'+next).focus();}});}
    $('block-advanced-toggle').onclick=()=>toggleAdvanced(advanced.hidden);
    advanced.querySelector('.icon-btn').onclick=()=>toggleAdvanced(false,{focus:true});
    advanced.querySelector('[data-tool="gateway"]').addEventListener('click',()=>close());
    menu.querySelector('.build-menu-close').onclick=()=>close({focus:true});
    dock.addEventListener('click',event=>{const target=event.target.closest('button');if(target&&target!==button)close();});
    document.addEventListener('pointerdown',event=>{if(!advanced.hidden&&!advanced.contains(event.target)&&!$('block-advanced-toggle').contains(event.target))toggleAdvanced(false);},true);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!advanced.hidden){event.preventDefault();event.stopImmediatePropagation();toggleAdvanced(false,{focus:true});}},true);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&opened&&!document.querySelector('dialog[open]'))close({focus:true});});
    [menu,advanced].forEach(node=>node.addEventListener('pointerdown',event=>event.stopPropagation()));
    menu.addEventListener('scroll',positionAdvanced,{passive:true});
    window.addEventListener('city-renewal-change',sync);window.addEventListener('city-tool-change',sync);window.addEventListener('resize',position);new ResizeObserver(position).observe(dock);
    sync();return {open,close,toggle:()=>opened?close():open()};
  }
  window.CityBlockMenu={create};
})();
