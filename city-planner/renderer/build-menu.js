/* Construction palette. Move the engine-owned controls to keep drafts and
 * previews attached to the same inputs and event handlers. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const carRoads = ['motorway','highway','avenue','street','lane'];
  const roadTypes = [...carRoads,'path','train','metro','tram'];
  const roadLabels = ['高速公路','快速路','主干道','普通路','小路','步道','铁路','地铁轨道','电车轨道'];
  const buildingTypes = ['airport','port','train_station','metro_station'];
  const buildingLabels = ['机场','港口','火车站','地铁站'];
  const buildingNotes = ['跑道与航站楼','码头与货运区','沿轨道自动对齐','连接轨道与城市'];
  // Render a fixed 80 × 48 m sample through the same material, marking,
  // curb, median and rail paths as the detailed city view.
  function paintRoadThumbnail(canvas,kind,oneway,level,types) {
    const scene=window.CityScene,previous={settings:scene.settings,time:scene.time,quality:scene.effectiveQuality};
    const ctx=canvas.getContext('2d'),scale=5;
    canvas.width=400;canvas.height=240;
    const road={id:'build-preview-'+kind,kind,oneway,level,points:[[0,0],[260,0]]};
    const state={roads:[road],network:{edges:[],nodes:{},junctions:[]},roadTypes:types,meta:{roadTypes:types}};
    try {
      scene.configure({quality:'high'});scene.resolveQuality(scene.detailZoom);scene.setTime(12*3600);
      ctx.translate(200,120);ctx.rotate(-Math.PI/6);ctx.scale(scale,scale);ctx.translate(-130,0);
      ctx.fillStyle=scene.material(ctx,'grass',0);ctx.fillRect(0,-150,260,300);
      window.RoadRenderer.paint(ctx,state,{scale,selected:null,vehicles:false,signals:false,levels:[level]});
      scene.medians(ctx,state,scale,()=>true);
    } finally {
      // Thumbnail lighting must never change the live city's clock or view.
      scene.configure(previous.settings);scene.setTime(previous.time);
      scene.resolveQuality(previous.quality==='high'?scene.detailZoom:0);
    }
  }
  function create({button,dock,onOpen}) {
    const menu=document.createElement('section');menu.id='workspace-build-menu';menu.className='build-menu';menu.hidden=true;
    menu.setAttribute('aria-label','建造菜单');
    menu.innerHTML=`<header class="build-menu-header"><div class="build-tabs" role="tablist" aria-label="建造类型"><button id="build-tab-roads" role="tab" aria-controls="build-roads" aria-selected="true">道路</button><button id="build-tab-buildings" role="tab" aria-controls="build-buildings" aria-selected="false" tabindex="-1">建筑</button></div><span class="build-menu-caption">选择道路，在地图上绘制</span><button class="city-btn" id="build-advanced-toggle" aria-controls="build-advanced-panel" aria-haspopup="dialog" aria-expanded="false">高级 <span aria-hidden="true">⌄</span></button><button class="build-menu-close icon-btn" aria-label="收起建造菜单"><svg><use href="#ui-close"/></svg></button></header><section id="build-roads" role="tabpanel" aria-labelledby="build-tab-roads"><div class="build-cards" aria-label="道路类型"></div><div class="build-road-settings" aria-label="道路建造设置"></div><div class="build-road-actions"></div></section><section id="build-buildings" role="tabpanel" aria-labelledby="build-tab-buildings" hidden><div class="build-cards" aria-label="交通建筑"></div><div class="build-building-settings"></div><div id="build-metro-settings" hidden><label>站点名称<input class="city-field" id="build-metro-name" maxlength="60" placeholder="留空随机命名"></label><p>点击铁路或地铁轨道放置站点，之后可在「公交」中配置线路。</p></div></section>`;
    const advanced=document.createElement('section');
    advanced.id='build-advanced-panel';advanced.className='build-menu build-advanced';advanced.hidden=true;
    advanced.setAttribute('role','dialog');advanced.setAttribute('aria-label','对象与坐标操作');
    advanced.innerHTML='<header class="build-advanced-header"><strong>对象与坐标</strong><button class="icon-btn" id="build-advanced-close" aria-label="收起高级菜单"><svg><use href="#ui-close"/></svg></button></header>';
    document.querySelector('.app-layout').append(menu,advanced);
    button.setAttribute('aria-controls',menu.id);button.setAttribute('aria-expanded','false');
    const roadGroup=document.querySelector('[data-tool="street"]').closest('.workspace-group');
    const buildingGroup=document.querySelector('[data-tool="airport"]').closest('.workspace-group');
    const roadCards=menu.querySelector('#build-roads .build-cards'),buildingCards=menu.querySelector('#build-buildings .build-cards');
    const directions=new Map(carRoads.map(kind=>[kind,false]));
    const levels=new Map(roadTypes.map(kind=>[kind,0]));
    let thumbnailRetry=0;
    const cardButtons=new Map();let tab='roads',lastRoad='street',lastBuilding='airport',opened=false,previousRail=null;
    const paging=document.createElement('div');paging.className='build-card-paging';
    paging.innerHTML='<button aria-label="向前浏览建造卡片">‹</button><button aria-label="向后浏览建造卡片">›</button>';
    menu.querySelector('.build-menu-close').before(paging);
    const pageButtons=[...paging.children];
    const currentCards=()=>tab==='roads'?roadCards:buildingCards;
    function syncPaging(){
      const row=currentCards();paging.hidden=row.scrollWidth<=row.clientWidth+1;
      pageButtons[0].disabled=row.scrollLeft<1;pageButtons[1].disabled=row.scrollLeft+row.clientWidth>=row.scrollWidth-1;
    }
    pageButtons.forEach((node,i)=>node.onclick=()=>currentCards().scrollBy({left:(i?1:-1)*currentCards().clientWidth*.7,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));
    [roadCards,buildingCards].forEach(row=>row.addEventListener('scroll',syncPaging,{passive:true}));
    function changeDirection(value){$('city-oneway').checked=value;$('city-oneway').dispatchEvent(new Event('change'));}
    roadTypes.forEach((kind,i)=>{
      const card=roadGroup.querySelector(`[data-tool="${kind}"]`),choose=card.onclick;
      card.classList.add('build-card');card.dataset.buildKind=kind;
      card.innerHTML=`<span class="build-thumbnail"><canvas width="400" height="240" aria-hidden="true"></canvas></span><span class="build-card-label">${roadLabels[i]}</span><span class="build-card-note"></span>`;
      card.onclick=()=>{
        if(CityApp.working)return;
        const repeat=CityApp.tool===kind,oneway=repeat?!$('city-oneway').checked:directions.get(kind)||false;
        if(!repeat)choose();
        if(carRoads.includes(kind))changeDirection(oneway);else changeDirection(false);
        lastRoad=kind;sync();
      };
      roadCards.append(card);cardButtons.set(kind,card);
    });
    const settings=menu.querySelector('.build-road-settings');
    settings.append($('city-auto-route').closest('label'),$('city-level').closest('label'),$('city-shape').closest('label'),$('city-oneway').closest('label'));
    $('city-auto-route').closest('label').classList.add('build-check');$('city-oneway').closest('label').classList.add('build-check');
    $('city-auto-route').closest('label').title='遇到陡坡时，自动寻找较缓的建设路线';
    const actions=menu.querySelector('.build-road-actions');actions.append($('city-finish'),$('city-cancel'),roadGroup.querySelector('[data-tool="delete"]'),$('city-draft-info'));
    advanced.append($('city-coordinate-controls'));
    roadGroup.remove();
    buildingTypes.forEach((kind,i)=>{
      const card=kind==='metro_station'?document.createElement('button'):buildingGroup.querySelector(`[data-tool="${kind}"]`),choose=card.onclick;
      card.classList.add('build-card');card.dataset.buildKind=kind;
      card.innerHTML=`<span class="build-thumbnail"><canvas width="600" height="360" aria-hidden="true"></canvas></span><span class="build-card-label">${buildingLabels[i]}</span><span class="build-card-note">${buildingNotes[i]}</span>`;
      card.onclick=()=>{
        if(CityApp.working)return;
        lastBuilding=kind;
        if(kind==='metro_station'){
          $('city-mode').value='metro';$('city-mode').dispatchEvent(new Event('change'));
          document.querySelector('[data-tool="stop"]').click();
        } else choose();
        sync();
      };
      buildingCards.append(card);cardButtons.set(kind,card);
      CityBuildingPreviews.attach(card.querySelector('canvas'),kind);
    });
    menu.querySelector('.build-building-settings').append($('city-special-controls'));buildingGroup.remove();
    $('build-metro-name').addEventListener('input',()=>{$('city-stop-name').value=$('build-metro-name').value;});
    $('city-stop-name').addEventListener('input',()=>{$('build-metro-name').value=$('city-stop-name').value;});
    function paintThumbnails(){
      if(!opened||tab!=='roads'||!CityApp.state)return;
      const types=CityApp.state.meta.roadTypes,ready=CityScene.assetsReady;
      for(const kind of roadTypes){
        const canvas=cardButtons.get(kind).querySelector('canvas'),oneway=directions.get(kind)||false,level=levels.get(kind);
        const key=JSON.stringify([kind,oneway,level,types[kind],ready]);
        if(canvas.dataset.preview!==key){paintRoadThumbnail(canvas,kind,oneway,level,types);canvas.dataset.preview=key;}
      }
      if(!ready&&!thumbnailRetry)thumbnailRetry=setTimeout(()=>{thumbnailRetry=0;paintThumbnails();},180);
    }
    function sync(){
      if(!window.CityApp)return;
      const tool=CityApp.tool,metro=tool==='stop'&&$('city-mode').value==='metro';
      if(carRoads.includes(tool))directions.set(tool,$('city-oneway').checked);
      if(roadTypes.includes(tool)){lastRoad=tool;levels.set(tool,Number($('city-level').value));}
      if(buildingTypes.includes(tool))lastBuilding=tool;else if(metro)lastBuilding='metro_station';
      for(const [kind,card] of cardButtons){
        const active=kind===tool||(kind==='metro_station'&&metro);
        card.classList.toggle('active',active);card.setAttribute('aria-pressed',String(active));
        if(carRoads.includes(kind)){
          const oneway=directions.get(kind);card.classList.toggle('is-oneway',oneway);
          card.querySelector('.build-card-note').textContent=oneway?'↑ 单向':'↑↓ 双向';
          card.setAttribute('aria-label',`${roadLabels[roadTypes.indexOf(kind)]}，${oneway?'单向':'双向'}${active?'，再次点击切换方向':''}`);
          card.title=active?'再次点击切换单向 / 双向':'选择道路类型';
        }else if(roadTypes.includes(kind))card.querySelector('.build-card-note').textContent=kind==='path'?'步行专用':'双线轨道';
      }
      $('city-oneway').closest('label').hidden=!carRoads.includes(tool);
      $('build-metro-settings').hidden=!metro;$('build-metro-name').value=$('city-stop-name').value;
      menu.querySelector('.build-menu-caption').textContent=tab==='roads'?'再次点击已选道路，切换单向 / 双向':'选择建筑，在地图上放置';
      button.classList.toggle('active',opened);
      if(opened)document.querySelectorAll('.workspace-rail [data-category]').forEach(node=>{
        const active=node.dataset.category==='roads';node.classList.toggle('active',active);node.setAttribute('aria-pressed',String(active));
      });
      position();
      paintThumbnails();
    }
    function showTab(next,{choose=true}={}){
      tab=next;
      for(const key of ['roads','buildings']){
        const active=key===next,node=$('build-tab-'+key);
        node.setAttribute('aria-selected',String(active));node.tabIndex=active?0:-1;$('build-'+key).hidden=!active;
      }
      if(choose&&CityApp.active){
        const current=next==='roads'?roadTypes.includes(CityApp.tool):buildingTypes.includes(CityApp.tool)||(CityApp.tool==='stop'&&$('city-mode').value==='metro');
        if(!current)cardButtons.get(next==='roads'?lastRoad:lastBuilding).click();
      }
      sync();
    }
    function position(){
      if(!opened)return;
      const dockRect=dock.getBoundingClientRect(),margin=12;
      const width=Math.min(950,innerWidth-margin*2);
      menu.style.width=width+'px';
      menu.style.left=Math.max(margin,Math.min(innerWidth-width-margin,dockRect.x+dockRect.width/2-width/2))+'px';
      menu.style.bottom=(innerHeight-dockRect.top+16)+'px';
      const top=document.querySelector('.city-kpis').getBoundingClientRect().bottom+12;
      menu.style.maxHeight=Math.max(150,dockRect.top-top-16)+'px';
      syncPaging();
      positionAdvanced();
    }
    function positionAdvanced(){
      if(advanced.hidden)return;
      const anchor=$('build-advanced-toggle').getBoundingClientRect(),margin=12,gap=8;
      const width=Math.min(340,innerWidth-margin*2);
      advanced.style.width=width+'px';
      advanced.style.maxHeight=(innerHeight-margin*2)+'px';
      const height=advanced.offsetHeight,above=anchor.top-gap-margin,below=innerHeight-anchor.bottom-gap-margin;
      const downward=below>=height||below>=above;
      advanced.style.maxHeight=Math.max(60,downward?below:above)+'px';
      advanced.style.left=Math.max(margin,Math.min(innerWidth-width-margin,anchor.right-width))+'px';
      advanced.style.top=(downward?anchor.bottom+gap:Math.max(margin,anchor.top-gap-advanced.offsetHeight))+'px';
    }
    function open(next=tab,{choose=true}={}){
      if(!CityApp.active)return;
      if(!opened)previousRail=document.querySelector('.workspace-rail [data-category].active')?.dataset.category;
      onOpen();opened=true;menu.hidden=false;
      document.body.classList.add('build-menu-open');document.body.classList.remove('show-inspector');
      button.setAttribute('aria-expanded','true');
      showTab(next,{choose});
    }
    function toggleAdvanced(expanded,{focus=false}={}){
      advanced.hidden=!expanded;
      $('build-advanced-toggle').setAttribute('aria-expanded',String(expanded));
      if(expanded){positionAdvanced();$('city-object-picker').focus({preventScroll:true});}
      else if(focus)$('build-advanced-toggle').focus({preventScroll:true});
    }
    $('build-advanced-toggle').onclick=()=>toggleAdvanced(advanced.hidden);
    $('build-advanced-close').onclick=()=>toggleAdvanced(false,{focus:true});
    document.addEventListener('pointerdown',event=>{
      if(!advanced.hidden&&!advanced.contains(event.target)&&!$('build-advanced-toggle').contains(event.target))toggleAdvanced(false);
    },true);
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&!advanced.hidden){
        event.preventDefault();event.stopImmediatePropagation();toggleAdvanced(false,{focus:true});
      }
    },true);
    advanced.addEventListener('pointerdown',event=>event.stopPropagation());
    menu.addEventListener('scroll',positionAdvanced,{passive:true});
    function close({focus=false}={}){
      clearTimeout(thumbnailRetry);thumbnailRetry=0;
      toggleAdvanced(false);
      opened=false;menu.hidden=true;document.body.classList.remove('build-menu-open');
      button.setAttribute('aria-expanded','false');button.classList.remove('active');
      if(previousRail)document.querySelectorAll('.workspace-rail [data-category]').forEach(node=>{
        const active=node.dataset.category===previousRail;node.classList.toggle('active',active);node.setAttribute('aria-pressed',String(active));
      });
      previousRail=null;
      if(focus)button.focus();
    }
    for(const key of ['roads','buildings']){
      const node=$('build-tab-'+key);node.onclick=()=>showTab(key);
      node.addEventListener('keydown',event=>{
        if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
          event.preventDefault();const next=event.key==='Home'?'roads':event.key==='End'?'buildings':key==='roads'?'buildings':'roads';
          showTab(next);$('build-tab-'+next).focus();
        }
      });
    }
    menu.querySelector('.build-menu-close').onclick=()=>close({focus:true});
    dock.addEventListener('click',event=>{const target=event.target.closest('button');if(target&&target!==button)close();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&opened&&!document.querySelector('dialog[open]'))close({focus:true});});
    window.addEventListener('city-tool-change',sync);
    $('city-mode').addEventListener('change',sync);
    window.addEventListener('resize',position);new ResizeObserver(position).observe(dock);
    new MutationObserver(position).observe(menu,{attributes:true,subtree:true,attributeFilter:['open']});
    menu.addEventListener('pointerdown',event=>event.stopPropagation());
    sync();
    return {open,close,toggle:()=>opened?close():open()};
  }
  window.CityBuildMenu={create};
})();
