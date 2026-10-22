/* Public transport palette, sharing the construction and block menu shell. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),tabs=[['bus','公交车'],['tram','有轨电车'],['rail','地铁 / 火车']];
  const cards={bus:[['line','新建公交车线路','沿道路两侧吸附选站','bus_line'],['manage','管理线路','班距、车辆与运营状态','bus_manage'],['depot','建造公交车总站','停车、检修与车辆调度','bus_depot']],tram:[['tram_line','创建线路','有轨电车运营线路','tram_line'],['tram_station','新建有轨电车站','站台与候车设施','tram_station'],['tram_track','新建有轨电车轨道','电车专用轨道','tram_track']],rail:[['rail_line','新建线路','按具体站台选择停站顺序','rail_line'],['rail_manage','管理线路','地铁、火车与直通统一运营','rail_line'],['metro_station','新建地铁站','三层配置 · 站台数量可编辑','metro_station'],['train_station','新建火车站','三层配置 · 独立站台接口','train_station'],['train_track','兼容铁路轨道','连接具体站台端口','train_track'],['rail_switch','道岔','同层分支与汇合','rail_switch'],['rail_turnback','折返设施','终点换向与发车进路','rail_turnback'],['rail_passing','越行线','建设真实并行绕行轨道','rail_passing']]};
  function create({button,dock,onOpen}){
    const menu=document.createElement('section');menu.id='workspace-transit-menu';menu.className='build-menu transit-menu';menu.hidden=true;menu.setAttribute('aria-label','公交菜单');
    menu.innerHTML=`<header class="build-menu-header"><div class="build-tabs" role="tablist" aria-label="公共交通分类">${tabs.map(([k,label],i)=>`<button id="transit-tab-${k}" role="tab" aria-controls="transit-${k}" aria-selected="${i===0}" tabindex="${i===0?0:-1}">${label}</button>`).join('')}</div><span class="build-menu-caption">选择交通工具，连接城市生活</span><button class="city-btn" id="transit-advanced-toggle" aria-expanded="false" aria-controls="transit-advanced">高级 <span aria-hidden="true">⌄</span></button><button class="build-menu-close icon-btn" aria-label="收起公交菜单"><svg><use href="#ui-close"/></svg></button></header>${tabs.map(([k])=>`<section id="transit-${k}" role="tabpanel" aria-labelledby="transit-tab-${k}" ${k==='bus'?'':'hidden'}><div class="build-cards">${cards[k].map(([action,label,note,preview])=>`<button class="build-card" data-transit-action="${action}" ${k!=='tram'?'aria-pressed="false"':'disabled'}><span class="build-thumbnail"><canvas width="600" height="360" data-transit-preview="${preview}" aria-hidden="true"></canvas></span><span class="build-card-label">${label}</span><span class="build-card-note">${note}</span>${k!=='tram'?'':'<span class="transit-coming">规划中</span>'}</button>`).join('')}</div>${k==='tram'?'<p class="transit-placeholder">有轨电车保留建设规划菜单。</p>':''}</section>`).join('')}<section id="transit-line-settings" class="transit-details" hidden><div class="transit-line-fields"></div><div class="transit-route-options"><label class="build-check"><input type="checkbox" id="transit-oneway">单向运营</label><span>默认往返运营，返程在对侧停靠</span></div><p id="transit-preview-status" role="status" aria-live="polite"></p><div class="transit-actions"></div></section><section id="transit-depot-settings" class="transit-details" hidden></section><section id="transit-manage" class="transit-details" aria-label="公交线路管理" hidden></section><section id="transit-rail-controls" hidden></section><footer class="transit-footer" id="transit-guidance" role="status"></footer>`;
    const advanced=document.createElement('section');advanced.id='transit-advanced';advanced.className='build-menu build-advanced transit-advanced';advanced.hidden=true;advanced.setAttribute('role','dialog');advanced.setAttribute('aria-label','交通实景设置');advanced.innerHTML='<header class="build-advanced-header"><strong>交通实景设置</strong><button class="icon-btn" aria-label="收起交通高级设置"><svg><use href="#ui-close"/></svg></button></header>';
    document.querySelector('.app-layout').append(menu,advanced);
    advanced.append(document.querySelector('.signal-panel'));
    const fields=menu.querySelector('.transit-line-fields');fields.append($('city-line-name').closest('label'),$('city-headway').closest('.paired'),$('city-hours').closest('label'));
    menu.querySelector('.transit-actions').append($('city-create-line'),$('city-clear-line'),$('city-stop-order'));
    $('city-create-line').textContent='创建线路 · Enter';$('city-clear-line').textContent='清空站点';
    $('transit-manage').append($('city-line-list'));
    for(const canvas of menu.querySelectorAll('[data-transit-preview]'))CityBuildingPreviews.attach(canvas,canvas.dataset.transitPreview);
    button.setAttribute('aria-controls',menu.id);button.setAttribute('aria-expanded','false');
    let opened=false,tab='bus',action=null;
    function selectAction(next){
      if(CityApp.working)return;
      action=next;
      if(tab==='rail'){CityRail.mount($('transit-rail-controls'),next);sync();return;}
      if(next==='line'){
        if($('city-mode').value!=='bus'){$('city-mode').value='bus';$('city-mode').dispatchEvent(new Event('change'));}
        CityApp.setTool('line');
      }else if(next==='depot'){
        $('transit-depot-settings').append($('city-special-controls'));CityApp.setTool('bus_depot');
      }else CityApp.setTool('select');
      sync();
    }
    function showTab(next){
      if(CityApp.working)return;
      tab=next;
      for(const [k] of tabs){const active=k===tab,node=$('transit-tab-'+k);node.setAttribute('aria-selected',String(active));node.tabIndex=active?0:-1;$('transit-'+k).hidden=!active;}
      if(next!=='bus'){action=null;CityApp.setTool('select');}
      sync();
    }
    function sync(){
      if(!CityApp.state)return;
      if(!opened)return;
      if(tab!=='bus'&&(CityApp.tool==='bus_depot'||CityApp.tool==='line'&&$('city-mode').value==='bus')){showTab('bus');return;}
      if(CityApp.tool==='bus_depot')action='depot';else if(CityApp.tool==='line'&&$('city-mode').value==='bus')action='line';
      const depots=CityApp.state.facilities.filter(f=>f.kind==='bus_depot'),ready=depots.some(f=>f.connected),busy=CityApp.working;
      for(const card of menu.querySelectorAll('#transit-bus .build-card')){
        const key=card.dataset.transitAction,selected=key===action;card.classList.toggle('active',selected);card.setAttribute('aria-pressed',String(selected));card.disabled=busy||(key==='line'&&!ready);
        if(key==='line')card.querySelector('.build-card-note').textContent=ready?'沿道路两侧吸附选站':depots.length?'请先连接总站与道路':'请先建造公交车总站';
        if(key==='manage')card.querySelector('.build-card-note').textContent=CityApp.state.lines.filter(l=>l.mode==='bus').length+' 条线路 · 查看运营状态';
      }
      for(const key of ['line','depot','manage'])$('transit-'+(key==='manage'?key:key+'-settings')).hidden=tab!=='bus'||action!==key;
      if(opened&&tab==='bus'&&action==='depot')$('transit-depot-settings').append($('city-special-controls'));
      $('transit-rail-controls').hidden=tab!=='rail'||!action;
      for(const card of menu.querySelectorAll('#transit-rail .build-card')){card.disabled=busy;card.classList.toggle('active',card.dataset.transitAction===action);card.setAttribute('aria-pressed',String(card.dataset.transitAction===action));}
      const draft=CityApp.busDraft;
      $('transit-preview-status').textContent=draft.preview?.valid===false?draft.preview.reason:draft.stops.length>=2?(draft.preview?'道路已连接 · '+draft.stops.length+' 站 · 可按 Enter 创建':'正在检查道路连接…'):'点击路边添加站点，箭头表示行驶方向';
      $('transit-preview-status').classList.toggle('error',draft.preview?.valid===false);
      $('city-create-line').textContent=draft.editing?'保存线路 · Enter':'创建线路 · Enter';
      $('city-create-line').disabled=busy||draft.stops.length<2||!ready;
      $('city-clear-line').disabled=busy||!draft.stops.length;
      for(const row of $('city-line-list').querySelectorAll('[data-line]'))row.hidden=CityApp.state.lines.find(l=>l.id===row.dataset.line)?.mode!=='bus';
      let empty=$('transit-empty');
      if(!empty){empty=document.createElement('p');empty.id='transit-empty';empty.className='city-note';empty.textContent='暂无公交车线路。建好总站后，选择「新建公交车线路」。';$('transit-manage').append(empty);}
      empty.hidden=CityApp.state.lines.some(l=>l.mode==='bus');
      $('city-line-list').hidden=empty.hidden===false;
      $('transit-guidance').textContent=tab==='rail'?'建站 → 连接站台端口 → 补建折返 / 道岔 → 按站台建线 → 管理运营':tab==='tram'?'有轨电车菜单与缩略图已保留':action==='manage'?'点击线路查看需求、调配车辆，设置运营时间、名称与颜色。':!ready?(depots.length?'总站尚未连接道路，请在附近铺设道路。':'先在道路旁建造公交车总站，再规划第一条线路。'):action==='line'?'路边自动吸附 · Enter 完成 · Backspace 撤回 · Esc 取消':action==='depot'?'在空地上预览总站 · R 旋转 · 点击建造 · 建成后连接附近道路':`${depots.length} 座总站 · 选择一项操作开始规划公交`;
      button.classList.toggle('active',opened);position();
    }
    function position(){
      if(!opened)return;
      const rect=dock.getBoundingClientRect(),margin=12,width=Math.min(950,innerWidth-margin*2);
      menu.style.width=width+'px';menu.style.left=Math.max(margin,Math.min(innerWidth-width-margin,rect.x+rect.width/2-width/2))+'px';menu.style.bottom=(innerHeight-rect.top+16)+'px';menu.style.maxHeight=Math.max(150,rect.top-document.querySelector('.city-kpis').getBoundingClientRect().bottom-28)+'px';
      if(!advanced.hidden){const a=$('transit-advanced-toggle').getBoundingClientRect(),w=Math.min(340,innerWidth-24);advanced.style.width=w+'px';advanced.style.maxHeight=(innerHeight-24)+'px';advanced.style.left=Math.max(12,Math.min(innerWidth-w-12,a.right-w))+'px';advanced.style.top=Math.max(12,Math.min(innerHeight-advanced.offsetHeight-12,a.top-advanced.offsetHeight-8))+'px';}
    }
    function toggleAdvanced(show){advanced.hidden=!show;$('transit-advanced-toggle').setAttribute('aria-expanded',String(show));position();}
    function open(){if(!CityApp.active)return;onOpen();opened=true;menu.hidden=false;document.body.classList.add('transit-menu-open');document.body.classList.remove('show-inspector');button.setAttribute('aria-expanded','true');sync();}
    function close({focus=false}={}){opened=false;menu.hidden=true;toggleAdvanced(false);document.body.classList.remove('transit-menu-open');button.classList.remove('active');button.setAttribute('aria-expanded','false');if(focus)button.focus();}
    for(const [i,[key]] of tabs.entries()){
      const node=$('transit-tab-'+key);node.onclick=()=>showTab(key);node.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=tabs[e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3][0];showTab(next);$('transit-tab-'+next).focus();}};
    }
    menu.querySelectorAll('#transit-bus [data-transit-action], #transit-rail [data-transit-action]').forEach(card=>card.onclick=()=>selectAction(card.dataset.transitAction));
    $('city-line-list').addEventListener('click',event=>{if(event.target.closest('[data-line]'))close();});
    $('transit-oneway').onchange=()=>CityApp.refreshBusPreview();
    $('transit-advanced-toggle').onclick=()=>toggleAdvanced(advanced.hidden);advanced.querySelector('.icon-btn').onclick=()=>toggleAdvanced(false);
    menu.querySelector('.build-menu-close').onclick=()=>close({focus:true});
    dock.addEventListener('click',event=>{const target=event.target.closest('button');if(target&&target!==button)close();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!advanced.hidden){event.preventDefault();event.stopImmediatePropagation();toggleAdvanced(false);$('transit-advanced-toggle').focus();}},true);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&opened&&!document.querySelector('dialog[open]'))close({focus:true});});
    document.addEventListener('pointerdown',event=>{if(!advanced.hidden&&!advanced.contains(event.target)&&!$('transit-advanced-toggle').contains(event.target))toggleAdvanced(false);},true);
    [menu,advanced].forEach(node=>node.addEventListener('pointerdown',e=>e.stopPropagation()));
    window.addEventListener('city-tool-change',sync);window.addEventListener('city-renewal-change',sync);window.addEventListener('resize',position);new ResizeObserver(position).observe(dock);
    return {open,close,toggle:()=>opened?close():open()};
  }
  window.CityTransitMenu={create};
})();
