/* Shared map-first chrome. Existing controls are moved, never copied or replaced,
 * so their values, IDs, event handlers and engine ownership remain intact. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const one = selector => document.querySelector(selector);
  const all = selector => [...document.querySelectorAll(selector)];
  const icon = name => `<svg aria-hidden="true"><use href="#ui-${name}"/></svg>`;
  one('.icon-library defs').insertAdjacentHTML('beforeend', `
    <symbol id="ui-road" viewBox="0 0 24 24"><path d="M7 3 3 21M17 3l4 18M12 3v4m0 4v3m0 4v3"/></symbol>
    <symbol id="ui-building" viewBox="0 0 24 24"><path d="M4 21V9h7v12M11 21V3h9v18M2 21h20M7 12v1m0 3v1m8-10h1m-1 4h1m-1 4h1m-1 4h1"/></symbol>
    <symbol id="ui-bus" viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="17" rx="3"/><path d="M5 12h14M9 3v9M7 20v2m10-2v2M8 16h1m6 0h1"/></symbol>
    <symbol id="ui-leaf" viewBox="0 0 24 24"><path d="M20 3C7 2 2 8 5 16c8 5 16-2 15-13ZM3 21 15 9"/></symbol>
    <symbol id="ui-service" viewBox="0 0 24 24"><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3ZM16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v2"/></symbol>
    <symbol id="ui-chart" viewBox="0 0 24 24"><path d="M3 21h18M5 17V9h3v8m3 0V3h3v14m3 0v-6h3v6"/></symbol>
    <symbol id="ui-select" viewBox="0 0 24 24"><path d="m5 3 15 10-7 1-4 7Z"/></symbol>
    <symbol id="ui-pan" viewBox="0 0 24 24"><path d="M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4m12-8 4 4-4 4"/></symbol>
    <symbol id="ui-renew" viewBox="0 0 24 24"><path d="M5 8a8 8 0 0 1 14 0M5 3v5h5m9 8a8 8 0 0 1-14 0m14 5v-5h-5"/></symbol>
    <symbol id="ui-mountain" viewBox="0 0 24 24"><path d="m2 20 7-14 5 9 3-6 5 11ZM6 12l3 2 2-3"/></symbol>
    <symbol id="ui-water" viewBox="0 0 24 24"><path d="M12 2C9 7 5 11 5 15a7 7 0 0 0 14 0c0-4-4-8-7-13ZM8 15a4 4 0 0 0 4 4"/></symbol>
    <symbol id="ui-sliders" viewBox="0 0 24 24"><path d="M4 3v8m0 4v6M12 3v3m0 4v11M20 3v11m0 4v3M1 11h6m2-5h6m2 8h6"/></symbol>
    <symbol id="ui-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></symbol>
    <symbol id="ui-check" viewBox="0 0 24 24"><path d="m5 12 5 5L20 7"/></symbol>
    <symbol id="ui-close" viewBox="0 0 24 24"><path d="m6 6 12 12M6 18 18 6"/></symbol>
  `);
  const cityCategories = [
    ['roads','道路','road','道路与轨道'], ['buildings','区块','grid','区块规划'],
    ['transit','交通','bus','交通运营'],
    ['data','观察','chart','城市观察']
  ];
  const terrainCategories = [
    ['biome','地貌','mountain','地貌预设'], ['shape','地形','sliders','塑造地形'],
    ['water','水系','water','河流与湖泊'], ['world','设置','grid','世界设置']
  ];
  const rail = document.createElement('nav');
  rail.className='workspace-rail'; rail.setAttribute('aria-label','工作台分类');
  const railCategories=[];
  rail.innerHTML=`<div class="city-rail">${railCategories.map(([key,label,image])=>`<button data-category="${key}" aria-pressed="false" title="${label}">${icon(image)}<span>${label}</span></button>`).join('')}</div>
    <div class="terrain-rail">${terrainCategories.map(([key,label,image])=>`<button data-terrain-category="${key}" aria-pressed="false">${icon(image)}<span>${label}</span></button>`).join('')}</div>`;
  one('.app-layout').append(rail);

  // Split at existing section headings; every original child stays in the UI.
  const buildPanel=$('city-build-panel');
  let group;
  for(const child of [...buildPanel.children]) {
    if(child.tagName==='H3') {
      group=document.createElement('section'); group.className='workspace-group';
      const name=child.textContent;
      group.dataset.category=name==='地图工具'?'tools':name==='道路与轨道'?'roads':'buildings';
      buildPanel.insertBefore(group,child);
    }
    group.append(child);
  }

  const caption=one('.city-brand-caption');
  caption.querySelector('small').textContent='城市规划';
  caption.querySelector('p').textContent='选择工具，在地图上开始规划';
  caption.insertAdjacentHTML('afterbegin',`<span class="panel-symbol">${icon('road')}</span>`);
  caption.insertAdjacentHTML('beforeend',`<button class="panel-dismiss icon-btn" aria-label="收起工具面板">${icon('close')}</button><div class="panel-section-title" id="city-section-title">道路与轨道</div>`);
  caption.querySelector('small').remove();caption.querySelector('p').remove();
  caption.insertBefore($('city-section-title'),$('city-name'));
  const togglePanel=()=>document.body.classList.toggle('panel-collapsed');
  caption.querySelector('.panel-dismiss').onclick=togglePanel;
  let category='roads';
  let buildMenu=null,blockMenu=null,observeMenu=null,transitMenu=null;
  function showCategory(next,{fromEngine=false}={}) {
    closeMetric();category=next;
    if(next==='roads'&&buildMenu){buildMenu.open('roads');return;}
    if(next==='buildings'&&blockMenu&&CityApp.active){blockMenu.open();return;}
    if(next==='data'&&observeMenu&&CityApp.active){observeMenu.open();return;}
    if(next==='transit'&&transitMenu&&CityApp.active){transitMenu.open();return;}
    buildMenu?.close();blockMenu?.close();observeMenu?.close();transitMenu?.close();
    document.body.classList.remove('show-inspector','panel-collapsed');
    const parent=next==='transit'?'transit':next==='data'?'data':'build';
    if(!fromEngine)one(`.city-nav [data-panel="${parent}"]`).click();
    for(const key of ['build','transit','data']){const panel=$(`city-${key}-panel`);panel.hidden=key!==parent;if(key===parent)panel.scrollTop=0;}
    all('#city-build-panel > .workspace-group').forEach(s=>s.hidden=s.dataset.category!==next);
    all('.workspace-rail [data-category]').forEach(b=>{const active=b.dataset.category===next;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
    const entry=cityCategories.find(c=>c[0]===next);
    $('city-section-title').textContent=entry[3];caption.querySelector('.panel-symbol').innerHTML=icon(entry[2]);
  }
  // Existing inspector actions can still open their appropriate tool panel.
  let routing=false;
  rail.addEventListener('click',event=>{const button=event.target.closest('[data-category]');if(button){routing=true;showCategory(button.dataset.category);routing=false;}});
  window.addEventListener('city-panel-change',event=>{if(!routing)showCategory(event.detail==='build'?'roads':event.detail,{fromEngine:true});});

  // The dock holds the original select / pan buttons plus category shortcuts.
  const dock=document.createElement('nav');dock.className='workspace-dock';dock.setAttribute('aria-label','地图快捷工具');
  const tools=one('[data-category="tools"].workspace-group');
  for(const [tool,image] of [['select','select'],['pan','pan']]) {
    const button=tools.querySelector(`[data-tool="${tool}"]`);button.querySelector('svg')?.remove();button.insertAdjacentHTML('afterbegin',icon(image));dock.append(button);
  }
  tools.remove();
  for(const [key,label,image,tool] of [['roads','建造','road','street'],['buildings','区块','grid','renewal'],['transit','公交','bus',null],['data','观察','chart',null]]) {
    const button=document.createElement('button');button.className='dock-action';button.innerHTML=icon(image)+`<span>${label}</span>`;
    if(key==='roads')button.id='workspace-build';
    if(key==='buildings')button.id='workspace-blocks';
    if(key==='data')button.id='workspace-observe';
    if(key==='transit')button.id='workspace-transit';
    button.onclick=()=>{if(key==='roads'){buildMenu.toggle();return;}if(key==='buildings'){blockMenu.toggle();return;}if(key==='data'){observeMenu.toggle();return;}if(key==='transit'){transitMenu.toggle();return;}routing=true;showCategory(key);routing=false;if(tool){one(`[data-tool="${tool}"]`).click();one(`[data-tool="${tool}"]`).scrollIntoView({block:'nearest'});}};
    dock.append(button);
  }
  one('.app-layout').append(dock);
  buildMenu=window.CityBuildMenu.create({button:$('workspace-build'),dock,onOpen:()=>{closeMetric();blockMenu?.close();observeMenu?.close();transitMenu?.close();}});
  blockMenu=window.CityBlockMenu.create({button:$('workspace-blocks'),dock,onOpen:()=>{closeMetric();buildMenu.close();observeMenu?.close();transitMenu?.close();}});
  observeMenu=window.CityObserveMenu.create({button:$('workspace-observe'),dock,onOpen:()=>{closeMetric();buildMenu.close();blockMenu.close();transitMenu?.close();}});
  transitMenu=window.CityTransitMenu.create({button:$('workspace-transit'),dock,onOpen:()=>{closeMetric();buildMenu.close();blockMenu.close();observeMenu.close();}});
  // Existing listeners toggle active state on the original tool buttons.
  one('.city-kpi').insertAdjacentHTML('afterend','<div class="city-kpi"><span>可用财政 / 元</span><strong id="ck-treasury">—</strong><small id="ck-treasury-sub">日收入 — 元</small></div>');
  const kpiIcons=['service','grid','building','grid','bus'];
  all('.city-kpi').forEach((card,i)=>card.insertAdjacentHTML('afterbegin',`<span class="kpi-symbol">${icon(kpiIcons[i])}</span>`));
  const overview=$('city-dashboard');overview.className='city-overview-button';
  overview.innerHTML=`<span class="overview-symbol">${icon('chart')}</span><span class="overview-copy"><small>城市概况</small><strong id="overview-city-name">我的城市</strong></span><span class="overview-arrow" aria-hidden="true">↗</span><span id="overview-city-meta" class="overview-meta">查看城市统计与发展记录</span>`;
  const openCityOverview=overview.onclick;
  overview.onclick=()=>{activeOverview=null;closeMetric();buildMenu.close();blockMenu.close();observeMenu.close();transitMenu?.close();document.body.classList.remove('panel-collapsed');openCityOverview();};
  one('.city-sidebar-foot').classList.add('workspace-files');
  one('.app-layout').append(one('.city-sidebar-foot'));
  $('city-simulation-note').hidden=true;
  $('city-files').innerHTML=icon('sliders');$('city-files').setAttribute('aria-label','设置');$('city-files').title='设置';
  const selection=document.createElement('button');selection.className='selection-card';
  selection.innerHTML=`<span class="selection-symbol">${icon('check')}</span><span><strong id="selection-title">自由探索城市</strong><small id="selection-subtitle">选择对象查看详情</small></span><span aria-hidden="true">›</span>`;
  selection.onclick=()=>{closeMetric();document.body.classList.add('show-inspector');};one('.app-layout').append(selection);
  const statusTray=document.createElement('section');statusTray.className='workspace-status-tray';statusTray.setAttribute('aria-label','选择与操作状态');
  const demandPanel=document.createElement('section');demandPanel.className='city-demand-panel';demandPanel.setAttribute('aria-label','建筑实时需求');
  const demandUses=[['residential','住宅','#57966e'],['commercial','商业','#c99546'],['office','办公','#528fab'],['industrial','工业','#a080a5'],['warehouse','仓储','#9a9169']];
  demandPanel.innerHTML='<header><strong>实时需求</strong><small>未满足缺口</small></header><div class="city-demand-grid">'+demandUses.map(([use,name])=>`<div class="city-demand-item" data-demand-use="${use}"><span>${name}</span><strong>—</strong><div class="city-demand-track" role="meter" aria-label="${name}未满足需求占比" aria-valuemin="0" aria-valuemax="100"><i></i></div></div>`).join('')+'</div><p>住宅按户 · 其他按岗位容量</p>';
  for(const [use,,color] of demandUses)demandPanel.querySelector(`[data-demand-use="${use}"]`).style.setProperty('--demand-color',color);
  demandPanel.title='显示可达就业对应的住房缺口与各类经营空间缺口；已扣除现有及待开工、在建供应。需求随城市结算与建设编辑更新，不代表可立即开工的建筑栋数。';
  function refreshDemand(){
    const demand=window.CityApp.state?.developmentDemand;
    for(const item of demandPanel.querySelectorAll('[data-demand-use]')){
      const row=demand?.uses?.[item.dataset.demandUse],valid=Number.isFinite(row?.shortage),ratio=valid?Math.max(0,Math.min(1,row.ratio||0)):0;
      item.querySelector('strong').textContent=valid?row.shortage.toLocaleString('zh-CN',{maximumFractionDigits:1}):'—';
      const meter=item.querySelector('[role="meter"]');meter.querySelector('i').style.width=`${ratio*100}%`;
      if(valid){meter.setAttribute('aria-valuenow',String(Math.round(ratio*100)));meter.setAttribute('aria-valuetext',`${row.shortage} ${row.unit}，未满足 ${Math.round(ratio*100)}%`);}
      else{meter.removeAttribute('aria-valuenow');meter.setAttribute('aria-valuetext','等待需求数据');}
      item.title=valid?`${demand.date} · ${item.firstElementChild.textContent}缺口 ${row.shortage} ${row.unit}，已扣除现有与已规划供应`:'等待需求数据';
    }
  }
  statusTray.append(overview,demandPanel,selection,$('city-status'),one('.workspace-files'));one('.app-layout').append(statusTray);
  const inspector=$('city-inspector');
  let activeOverview=null;
  function positionCityOverview(){
    if(!inspector.classList.contains('city-overview'))return;
    const anchor=statusTray.getBoundingClientRect();
    const top=Math.max(12,one('.city-kpis').getBoundingClientRect().bottom+12);
    inspector.style.setProperty('--overview-left',`${anchor.left}px`);
    inspector.style.setProperty('--overview-bottom',`${innerHeight-anchor.top+12}px`);
    inspector.style.setProperty('--overview-max-height',`${Math.max(0,anchor.top-12-top)}px`);
  }
  const overviewAnchorObserver=new ResizeObserver(positionCityOverview);
  overviewAnchorObserver.observe(statusTray);
  overviewAnchorObserver.observe(one('.city-kpis'));
  function arrangeOverview(state){
    if(inspector.querySelector('.city-overview-cards'))return;
    const previousScroll=inspector.scrollTop;
    const s=state.stats,number=value=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('zh-CN',{maximumFractionDigits:1}):'—';
    const groups=[
      {key:'housing',title:'建筑与住房',icon:'building',value:number(s.buildings)+' 栋',note:`在建 ${number(s.construction)} · 空置率 ${number(s.vacancy)}%`},
      {key:'population',title:'人口与迁移',icon:'service',value:number(s.population)+' 人',note:`今日迁入 ${number(s.movedIn)} · 迁出 ${number(s.movedOut)}`},
      {key:'travel',title:'出行与可达性',icon:'bus',value:number(s.commute)+' 分钟',note:`平均通勤 · 完成 ${number(s.completedTrips)} 次旅程`},
      {key:'liveTraffic',title:'实时交通',icon:'road',value:CityApp.traffic?`${number(CityApp.traffic.vehicles?.length)} 辆车 · ${number(CityApp.traffic.pedestrians?.length)} 位行人`:'暂无样本',note:CityApp.traffic?`${state.simulation?.sampled?'高速抽样':'精细人车'} · ${CityApp.traffic.mode==='test'?'验证人车流':'城市交通分配'}`:'等待交通样本'},
      {key:'finance',title:'财政与账目',icon:'grid',value:number(s.treasury)+' 元',note:`日收入 ${number(s.revenue)} · 分项收支`},
      {key:'growth',title:'地形与生长',icon:'mountain',value:number(s.autoRoadKm)+' km',note:`自动支路 · 公共空间 ${number(s.publicSpaceArea)} m²`},
      {key:'economy',title:'产业与分布',icon:'chart',value:number(s.firms)+' 个企业群组',note:`空缺岗位 ${number(s.vacantJobs)} · 建筑与交通分布`},
      {key:'districts',title:'城区与中心',icon:'grid',value:state.districts.length+' 个城区',note:`${(state.growthCenters||[]).filter(c=>c.rank).length} 处发展中心 · 点击城区定位`},
      {key:'events',title:'城市记事',icon:'check',value:state.events.length+' 条记录',note:'发展事件 · 查看时间与地图位置'},
      {key:'comparison',title:'基线对照',icon:'sliders',value:'变化对比',note:'人口、岗位、通勤与土地价格'}
    ];
    const sections=new Map(groups.map(g=>{const section=document.createElement('section');section.dataset.overviewSection=g.key;section.hidden=true;section.setAttribute('aria-label',g.title);return [g.key,section];}));
    const headingGroups={'实时交通':'liveTraffic','人口变化':'population','出行方式 · 已完成旅程':'travel','城市账目':'finance','与基线比较':'comparison','地形与自动生长':'growth','城区':'districts','城市记事':'events','分项账目':'finance'};
    let current='housing';
    for(const node of [...inspector.children]){
      if(node.tagName==='H2')continue;
      if(node.classList.contains('inspector-index')){node.remove();continue;}
      if(node.tagName==='H3'){current=headingGroups[node.textContent.trim()]||current;if(current==='liveTraffic'){node.remove();continue;}}
      const summary=node.tagName==='DETAILS'?node.querySelector('summary')?.textContent:'';
      let target=current;
      if(summary?.startsWith('发展中心')){target='districts';node.open=true;}
      if(summary==='完整统计与分布'){target='economy';node.open=true;}
      if(summary==='收入组与时段可达性'){target='travel';current='travel';}
      if(node.id==='city-events-all')target='events';
      sections.get(target).append(node);
    }
    const cards=document.createElement('div');cards.className='city-overview-cards';cards.setAttribute('aria-label','城市观察分类');
    const detail=document.createElement('div');detail.className='city-overview-detail';detail.hidden=true;
    const back=document.createElement('button');back.className='overview-back';back.textContent='‹ 返回全部统计';
    const detailTitle=document.createElement('h3');detailTitle.className='overview-detail-title';
    const content=document.createElement('div');content.className='overview-detail-content';
    detail.append(back,detailTitle,content);
    const enabled=groups.filter(g=>g.key!=='comparison'||sections.get(g.key).children.length);
    for(const g of enabled){
      const button=document.createElement('button');button.className='overview-stat-card';button.dataset.overviewCard=g.key;
      button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','overview-section-'+g.key);
      button.innerHTML=`<span class="overview-card-label">${icon(g.icon)}<span></span><i aria-hidden="true">›</i></span><strong></strong><small></small>`;
      button.querySelector('.overview-card-label span').textContent=g.title;button.querySelector('strong').textContent=g.value;button.querySelector('small').textContent=g.note;
      button.onclick=()=>show(g.key,{focus:true});cards.append(button);
      const section=sections.get(g.key);section.id='overview-section-'+g.key;
      if(!section.children.length){const empty=document.createElement('p');empty.className='metric-empty';empty.textContent='暂无记录，城市发展后将显示相关数据。';section.append(empty);}
      content.append(section);
    }
    function show(key,{focus=false}={}){
      activeOverview=key;cards.hidden=!!key;detail.hidden=!key;
      for(const g of enabled){sections.get(g.key).hidden=g.key!==key;cards.querySelector(`[data-overview-card="${g.key}"]`).setAttribute('aria-expanded',String(g.key===key));}
      detailTitle.textContent=enabled.find(g=>g.key===key)?.title||'';inspector.scrollTop=0;
      if(key==='population')CityApp.refreshOverviewChart();
      if(focus){if(key)back.focus();else cards.querySelector('button')?.focus();}
    }
    back.onclick=()=>{const previous=activeOverview;show(null);cards.querySelector(`[data-overview-card="${previous}"]`)?.focus();};
    inspector.append(cards,detail);
    show(enabled.some(g=>g.key===activeOverview)?activeOverview:null);
    if(activeOverview)inspector.scrollTop=previousScroll;
  }
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||!document.body.classList.contains('show-inspector')||!inspector.classList.contains('city-overview'))return;
    event.preventDefault();
    if(activeOverview)inspector.querySelector('.overview-back').click();
    else{$('city-close-inspector')?.click();overview.focus();}
  });
  window.addEventListener('resize',()=>{positionCityOverview();if(inspector.classList.contains('city-overview')&&activeOverview==='population')CityApp.refreshOverviewChart();});
  let lastSelected=null;
  function updateSelection(){
    const heading=inspector.querySelector('h2');
    const title=heading?[...heading.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('').trim():'';
    const state=window.CityApp.state;
    refreshDemand();
    selection.hidden=!window.CityApp.selected;
    $('overview-city-name').textContent=state?.name||'我的城市';$('overview-city-name').title=state?.name||'';
    $('overview-city-meta').textContent=state?`${Number(state.stats.buildings||0).toLocaleString('zh-CN')} 栋建筑${state.stats.plannedBuildings?` · ${state.stats.plannedBuildings} 栋待开工`:''} · ${state.districts.length} 个城区`:'查看城市统计与发展记录';
    if(window.CityApp.selected&&window.CityApp.selected!==lastSelected)closeMetric();
    lastSelected=window.CityApp.selected;
    $('selection-title').textContent='已选择 1 个对象';
    $('selection-subtitle').textContent=title||'人口、交通、财政与城市动态';
    const cityOverview=!window.CityApp.selected&&title==='城市观察';
    inspector.classList.toggle('city-overview',cityOverview);
    if(cityOverview){positionCityOverview();arrangeOverview(state);return;}
    activeOverview=null;
    // Keep section shortcuts for selected roads, buildings and other objects.
    inspector.querySelector('.inspector-index')?.remove();
    const headings=inspector.classList.contains('city-junction')?[]:[...inspector.querySelectorAll('h3')];
    if(headings.length){
      const index=document.createElement('nav');index.className='inspector-index';index.setAttribute('aria-label','详情章节');
      headings.forEach(h=>{const b=document.createElement('button');b.textContent=h.textContent;b.onclick=()=>inspector.scrollTo({top:inspector.scrollTop+h.getBoundingClientRect().top-inspector.getBoundingClientRect().top-70,behavior:'instant'});index.append(b);});
      heading.after(index);
    }
  }
  const inspectorObserver=new MutationObserver(()=>{inspectorObserver.disconnect();updateSelection();inspectorObserver.observe(inspector,{childList:true});});
  inspectorObserver.observe(inspector,{childList:true});

  // Terrain categories share the same right-hand parameter panel.
  const scroll=one('.sidebar-scroll');
  let terrainGroup,terrainKey='world';
  const sections={};
  for(const child of [...scroll.children]) {
    if(child.classList.contains('section-heading')){
      const label=child.textContent;
      terrainKey=label.includes('地貌预设')?'biome':label.includes('塑造地形')?'shape':label.includes('河流与湖泊')?'water':'world';
    }
    if(child.classList.contains('seed-section'))terrainKey='world';
    if(!sections[terrainKey]){terrainGroup=document.createElement('section');terrainGroup.dataset.terrainSection=terrainKey;sections[terrainKey]=terrainGroup;scroll.insertBefore(terrainGroup,child);}
    sections[terrainKey].append(child);
  }
  const heading=one('.workspace-heading');one('.sidebar').prepend(heading);
  heading.querySelector('.eyebrow').textContent='01 / 地形准备';heading.querySelector('h1').textContent='塑造你的世界';
  heading.querySelector('p').textContent='调整参数并预览，确认后保存并进入城市规划。';
  const terrainViews=heading.querySelector('.view-tabs');terrainViews.classList.add('terrain-view-switch');$('map-frame').append(terrainViews);
  heading.insertAdjacentHTML('beforeend',`<button class="panel-dismiss icon-btn" aria-label="收起地形参数">${icon('close')}</button><div class="panel-section-title" id="terrain-section-title">地貌预设</div>`);
  $('terrain-section-title').remove();heading.querySelector('h1').id='terrain-section-title';
  heading.append($('reset'));
  heading.querySelector('.panel-dismiss').onclick=togglePanel;
  const entry=one('.city-entry');one('.app-layout').append(entry);
  function showTerrainCategory(key){
    document.body.classList.remove('panel-collapsed');
    Object.entries(sections).forEach(([name,section])=>section.hidden=name!==key);
    all('[data-terrain-category]').forEach(b=>{const active=b.dataset.terrainCategory===key;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
    $('terrain-section-title').textContent=terrainCategories.find(c=>c[0]===key)[3];scroll.scrollTop=0;
    $('reset').hidden=key!=='shape';
  }
  all('[data-terrain-category]').forEach(b=>b.onclick=()=>showTerrainCategory(b.dataset.terrainCategory));
  $('terrain-empty').querySelector('span').textContent='从右侧选择地貌，点击「生成地形」预览地图。';
  const terrainOverview=document.createElement('button');terrainOverview.id='terrain-overview';terrainOverview.className='terrain-overview';terrainOverview.dataset.terrainCategory='summary';terrainOverview.innerHTML=icon('chart')+'<span>统计</span>';one('.terrain-rail').append(terrainOverview);
  const summary=document.createElement('section');summary.dataset.terrainSection='summary';summary.hidden=true;sections.summary=summary;scroll.append(summary);
  function renderTerrainSummary(){
    summary.replaceChildren();const rows=document.createElement('dl');rows.className='city-details';
    for(const [label,id] of [['地理范围','stat-size'],['最高海拔','stat-altitude'],['陆地占比','stat-land'],['生成耗时','stat-time'],['河流与湖泊','hydrology-stats'],['世界种子','seed'],['地图精度','resolution']]){
      const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=id==='seed'?$(id).value:id==='resolution'?$(id).selectedOptions[0].textContent:$(id).textContent;rows.append(dt,dd);
    }
    summary.append(rows);const button=document.createElement('button');button.className='city-btn';button.textContent='编辑范围、种子与精度';button.onclick=()=>showTerrainCategory('world');summary.append(button);
  }
  terrainCategories.push(['summary','统计','chart','地形统计']);
  terrainOverview.onclick=()=>{renderTerrainSummary();showTerrainCategory('summary');};
  window.addEventListener('terrain-state',()=>requestAnimationFrame(renderTerrainSummary));

  // A real world overview, cached per terrain / city revision. The blue box is
  // the actual camera footprint; clicking or using arrows moves the main map.
  const mini=document.createElement('section');mini.className='workspace-minimap';mini.setAttribute('aria-label','小地图');
  mini.innerHTML=`<div class="minimap-heading"><span>${icon('grid')}小地图</span><button id="minimap-fit" class="icon-btn" aria-label="查看完整地图" title="查看完整地图"><svg><use href="#i-expand"/></svg></button></div><div class="minimap-viewport"><canvas id="overview-map" width="560" height="240" tabindex="0" aria-label="小地图，点击定位，方向键移动，Enter 查看全图"></canvas></div><span class="minimap-empty">生成地形后显示全图</span>`;
  one('.app-layout').append(mini);
  $('minimap-fit').onclick=()=>MapWorkspace.fit();
  const miniCanvas=$('overview-map'),ctx=miniCanvas.getContext('2d'),cache=document.createElement('canvas');const miniViewport=miniCanvas.parentElement;cache.width=miniCanvas.width;cache.height=miniCanvas.height;
  let cachedTerrain=null,cachedRevision=null,miniBounds=null;
  function paintMinimap(){
    if(document.body.classList.contains('menu-mode')||!MapWorkspace.visible)return;
    const t=MapWorkspace.terrain,s=CityApp.active?CityApp.state:null;
    mini.classList.toggle('is-empty',!t);if(!t){miniBounds=null;ctx.clearRect(0,0,miniCanvas.width,miniCanvas.height);return;}
    miniViewport.style.aspectRatio=`${t.width} / ${t.height}`;
    // Fit the canvas itself to the terrain, so CSS cannot stretch the overview.
    const cssScale=Math.min(miniViewport.clientWidth/t.width,miniViewport.clientHeight/t.height);
    if(cssScale<=0)return;
    miniCanvas.style.width=`${t.width*cssScale}px`;miniCanvas.style.height=`${t.height*cssScale}px`;
    const dpr=window.devicePixelRatio||1;
    const width=Math.max(1,Math.round(t.width*cssScale*dpr)),height=Math.max(1,Math.round(t.height*cssScale*dpr));
    const resized=miniCanvas.width!==width||miniCanvas.height!==height;
    if(resized){miniCanvas.width=cache.width=width;miniCanvas.height=cache.height=height;}
    const factor=Math.min(width/t.width,height/t.height),w=t.width*factor,h=t.height*factor,x=(width-w)/2,y=(height-h)/2;
    miniBounds={x,y,w,h};
    if(resized||cachedTerrain!==t||cachedRevision!==(s?.revision??null)){
      cachedTerrain=t;cachedRevision=s?.revision??null;const c=cache.getContext('2d');c.clearRect(0,0,width,height);MapWorkspace.paintOverview(c,{left:x,top:y,scale:factor});
      if(s){c.save();c.translate(x,y);c.scale(w/s.meta.width,h/s.meta.height);c.strokeStyle='#fdfefe';c.lineWidth=2*s.meta.width/w;for(const road of s.roads){c.beginPath();road.points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.stroke();}c.restore();}
    }
    ctx.clearRect(0,0,width,height);ctx.drawImage(cache,0,0);
    const g=MapWorkspace.geometry,left=Math.max(0,-g.left/(t.width*g.scale)),top=Math.max(0,-g.top/(t.height*g.scale));
    const right=Math.min(1,(g.width-g.left)/(t.width*g.scale)),bottom=Math.min(1,(g.height-g.top)/(t.height*g.scale));
    ctx.fillStyle='#087bff26';ctx.strokeStyle='#087bff';ctx.lineWidth=3;ctx.fillRect(x+left*w,y+top*h,(right-left)*w,(bottom-top)*h);ctx.strokeRect(x+left*w,y+top*h,(right-left)*w,(bottom-top)*h);
    ctx.beginPath();ctx.arc(x+(left+right)*w/2,y+(top+bottom)*h/2,5,0,Math.PI*2);ctx.fillStyle='#087bff';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
  }
  function miniFocus(nx,ny){const t=MapWorkspace.terrain;if(!t)return;const g=MapWorkspace.geometry;MapWorkspace.focus([Math.max(0,Math.min(1,nx))*t.grid.widthMeters,Math.max(0,Math.min(1,ny))*t.grid.heightMeters],g.scale/Math.max(g.width/t.width,g.height/t.height));paintMinimap();}
  miniCanvas.onclick=event=>{if(!miniBounds)return;const r=miniCanvas.getBoundingClientRect(),b=miniBounds;miniFocus(((event.clientX-r.left)*miniCanvas.width/r.width-b.x)/b.w,((event.clientY-r.top)*miniCanvas.height/r.height-b.y)/b.h);};
  miniCanvas.onkeydown=event=>{const t=MapWorkspace.terrain;if(!t)return;if(event.key==='Enter'){event.preventDefault();MapWorkspace.fit();paintMinimap();return;}const directions={ArrowLeft:[-.08,0],ArrowRight:[.08,0],ArrowUp:[0,-.08],ArrowDown:[0,.08]};const d=directions[event.key];if(!d)return;event.preventDefault();const g=MapWorkspace.geometry;miniFocus((g.width/2-g.left)/(t.width*g.scale)+d[0],(g.height/2-g.top)/(t.height*g.scale)+d[1]);};
  setInterval(paintMinimap,350);

  // One perimeter only: no permanent controls floating inside the map area.
  const layout=one('.app-layout'),mapFrame=$('map-frame');
  const viewPanel=document.createElement('details');viewPanel.className='workspace-view-panel';
  viewPanel.innerHTML='<summary>视图与图例</summary>';
  viewPanel.append(one('.map-view-switch'));
  caption.after(viewPanel);
  const terrainContext=document.createElement('div');terrainContext.className='terrain-context';layout.append(terrainContext);
  const mapLabel=one('.map-label');
  const bottom=document.createElement('section');bottom.className='workspace-bottom';bottom.setAttribute('aria-label','工作台操作栏');
  const toolTray=document.createElement('div');toolTray.className='workspace-tool-tray';
  toolTray.append(dock);
  bottom.append(statusTray,toolTray,entry,one('.map-bottom'));layout.append(bottom);
  sections.world.append(one('.workspace>footer'));
  const fileMenu=document.createElement('details');fileMenu.className='workspace-file-menu';fileMenu.innerHTML='<summary>文件</summary>';
  fileMenu.append(one('.top-actions'));one('.workspace-files').append(fileMenu);
  const settings=document.createElement('section');settings.id='workspace-settings';settings.className='workspace-settings';settings.hidden=true;
  settings.setAttribute('aria-label','设置');
  const settingsTabs=['general','scenario','calibration'];
  settings.innerHTML=`<header class="workspace-settings-header"><h3>设置</h3><button class="icon-btn" id="workspace-settings-close" aria-label="关闭设置">${icon('close')}</button></header><div class="build-tabs" role="tablist" aria-label="设置分类">${[['general','常规'],['scenario','情景'],['calibration','校准']].map(([key,label],i)=>`<button id="settings-tab-${key}" role="tab" aria-selected="${i===0}" aria-controls="settings-${key}" tabindex="${i===0?0:-1}">${label}</button>`).join('')}</div>${settingsTabs.map((key,i)=>`<section id="settings-${key}" role="tabpanel" aria-labelledby="settings-tab-${key}" ${i?'hidden':''}></section>`).join('')}`;
  const settingsAnchor=document.createElement('div');settingsAnchor.className='workspace-settings-anchor';
  settingsAnchor.append($('city-files'),settings);layout.append(settingsAnchor);
  statusTray.prepend(one('.city-controlbar'));
  $('settings-general').append(one('.workspace-files'));
  $('settings-general').insertAdjacentHTML('beforeend','<details class="workspace-help"><summary>操作说明</summary></details>');
  settings.querySelector('.workspace-help').append($('city-hint'));
  for(const key of ['scenario','calibration'])$('settings-'+key).append(observeMenu.settingsContent[key]);
  const settingsButton=$('city-files');settingsButton.setAttribute('aria-controls',settings.id);settingsButton.setAttribute('aria-expanded','false');
  function setSettings(open){settings.hidden=!open;settingsButton.setAttribute('aria-expanded',String(open));if(!open)fileMenu.open=false;}
  function selectSettingsTab(key){
    for(const name of settingsTabs){const active=name===key,node=$('settings-tab-'+name);node.setAttribute('aria-selected',String(active));node.tabIndex=active?0:-1;$('settings-'+name).hidden=!active;}
  }
  for(const key of settingsTabs){
    const node=$('settings-tab-'+key);
    node.onclick=()=>selectSettingsTab(key);
    node.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      const next=event.key==='Home'?settingsTabs[0]:event.key==='End'?settingsTabs.at(-1):settingsTabs[(settingsTabs.indexOf(key)+(event.key==='ArrowRight'?1:settingsTabs.length-1))%settingsTabs.length];
      selectSettingsTab(next);$('settings-tab-'+next).focus();
    });
  }
  settingsButton.onclick=()=>setSettings(settings.hidden);
  $('workspace-settings-close').onclick=()=>{setSettings(false);settingsButton.focus();};
  document.addEventListener('pointerdown',event=>{if(!settings.hidden&&!settings.contains(event.target)&&!settingsButton.contains(event.target))setSettings(false);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!settings.hidden&&!document.querySelector('dialog[open]')){event.preventDefault();event.stopImmediatePropagation();setSettings(false);settingsButton.focus();}},true);
  settings.addEventListener('click',event=>{if(event.target.closest('#settings-general button, #city-calibration'))setSettings(false);});
  settings.addEventListener('pointerdown',event=>event.stopPropagation());

  const miniFooter=document.createElement('div');miniFooter.className='minimap-footer';
  miniFooter.append(one('.zoom-control'));mini.append(miniFooter,$('measure-hint'));
  const navigation=document.createElement('div');navigation.className='workspace-navigation';
  navigation.append(one('.map-scale'),mini);layout.append(navigation);
  $('minimap-fit').remove();
  one('.minimap-heading').append(one('.map-tools'),one('.compass'));
  const compact=matchMedia('(max-width:700px)');
  function placeChrome(){
    const city=document.body.dataset.screen==='city',terrain=document.body.dataset.screen==='terrain';
    if(city){
      one('.city-controlbar').prepend(mapLabel);
      caption.after(viewPanel);one('.workspace-files').append(fileMenu);
    }else if(terrain){
      (compact.matches?heading:terrainContext).append(mapLabel);
      heading.after(viewPanel);one('.map-bottom').append(fileMenu);
    }
    // Native fullscreen only contains the map frame. Keep the corner controls
    // with it, including the existing fullscreen button for leaving that mode.
    if(!document.fullscreenElement)layout.append(navigation);
  }
  compact.addEventListener('change',placeChrome);
  document.addEventListener('fullscreenchange',()=>{
    if(document.fullscreenElement===mapFrame)mapFrame.append(navigation);
    else layout.append(navigation);
  });
  // Expand a KPI directly below its card, keeping the tool panel available.
  const metricConfigs=[
    {key:'population',title:'人口与迁移',unit:'人',icon:'service',series:[['population','常住人口','#087bff']],rows:[['households','家庭数量','户'],['movedIn','今日迁入','人'],['movedOut','今日迁出','人'],['pendingHousing','等待迁入','户'],['vacancy','住房空置率','%']]},
    {key:'treasury',title:'财政收支',unit:'元',icon:'grid',series:[['treasury','可用资金','#e89423']],rows:[['revenue','日收入','元'],['maintenance','日维护与运营','元'],['constructionCost','累计建设费用','元']]},
    {key:'jobs',title:'就业与岗位',unit:'个 / 人',icon:'building',series:[['jobs','岗位','#087bff'],['employed','就业人数','#21a27b']],rows:[['employed','就业人数','人'],['jobs','岗位数量','个'],['vacantJobs','空缺岗位','个'],['unemployment','失业率','%'],['accessJobs','可达岗位均值','个']]},
    {key:'landValue',title:'土地价格',unit:'元 / m²',icon:'grid',series:[['landValue','中位数','#8c69df'],['landP10','P10','#a9b4c7'],['landP90','P90','#e89423']],rows:[['landValue','土地估值中位数','元/m²'],['landP10','土地估值 P10','元/m²'],['landP90','土地估值 P90','元/m²'],['rent','住宅租金中位数','元/m²/月'],['floorRatio','容积率','']]},
    {key:'commute',title:'通勤与出行',unit:'分钟',icon:'bus',series:[['commute','平均通勤','#21a27b'],['commuteP90','90% 通勤用时','#e89423']],rows:[['commute','平均通勤','分钟'],['commuteP90','90% 通勤不超过','分钟'],['completedTrips','已完成旅程','次'],['failedTrips','出行失败（典型工作日）','次'],['meanWait','平均候车','分钟']]}
  ];
  const serviceStats=window.CityServiceStatistics,metricStrip=one('.city-kpis');
  const taxiControls=$('city-taxi-panel'),serviceControls=$('city-service-controls');
  const cityMetricCount=metricConfigs.length;
  for(const group of serviceStats.groups){
    metricConfigs.push({key:group.key,title:group.title,service:true});
    const card=document.createElement('div');card.className='city-kpi service-kpi';card.dataset.service=group.key;card.hidden=true;
    card.innerHTML=`<span class="kpi-symbol">${serviceStats.icon(group)}</span><span>${group.title}</span><strong>0 处</strong><small>暂无设施</small>`;
    metricStrip.append(card);
  }
  const metricToolbar=document.createElement('nav');metricToolbar.className='metric-toolbar';metricToolbar.setAttribute('aria-label','统计卡片分类');
  metricToolbar.innerHTML='<div role="group" aria-label="统计类别"><button data-metric-group="city" aria-pressed="true">城市概况</button><button data-metric-group="services" aria-pressed="false">公共服务</button></div><div class="metric-browse"><button aria-label="向前浏览统计卡片">‹</button><button aria-label="向后浏览统计卡片">›</button></div>';
  layout.append(metricToolbar);
  const metricPanel=document.createElement('aside');metricPanel.className='workspace-metric-panel';metricPanel.id='workspace-metric-panel';metricPanel.hidden=true;metricPanel.setAttribute('aria-label','指标趋势与详细数据');layout.append(metricPanel);
  let activeMetric=null,metricRange=12,metricStamp='';
  const metricCards=all('.city-kpi');
  const serviceNames={...window.CitySpecialBuildings.names,school:'学校',clinic:'诊所',park:'公园',plaza:'广场'};
  let serviceState=null,serviceRevision=null;
  function refreshServices(){
    const state=CityApp.state;if(!state||(serviceState===state&&serviceRevision===state.revision))return;
    serviceState=state;serviceRevision=state.revision;
    metricCards.slice(cityMetricCount).forEach(card=>{const s=serviceStats.summary(state,card.dataset.service);card.querySelector('strong').textContent=serviceStats.value(s);card.querySelector('small').textContent=serviceStats.subtitle(s);});
  }
  function positionMetricToolbar(){
    const r=metricStrip.getBoundingClientRect();metricToolbar.style.left=r.left+'px';metricToolbar.style.top=(r.top-26)+'px';metricToolbar.style.width=r.width+'px';
    const buttons=metricToolbar.querySelectorAll('.metric-browse button');buttons[0].disabled=metricStrip.scrollLeft<1;buttons[1].disabled=metricStrip.scrollLeft+metricStrip.clientWidth>=metricStrip.scrollWidth-1;
  }
  metricToolbar.querySelectorAll('[data-metric-group]').forEach(button=>button.onclick=()=>{
    closeMetric();const services=button.dataset.metricGroup==='services';metricStrip.classList.toggle('show-services',services);
    metricCards.forEach((card,i)=>card.hidden=services?i<cityMetricCount:i>=cityMetricCount);
    metricToolbar.querySelectorAll('[data-metric-group]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    metricStrip.scrollLeft=0;refreshServices();positionMetricToolbar();
  });
  metricToolbar.querySelectorAll('.metric-browse button').forEach((button,i)=>button.onclick=()=>metricStrip.scrollBy({left:(i?1:-1)*metricStrip.clientWidth*.8,behavior:'smooth'}));
  metricStrip.addEventListener('scroll',positionMetricToolbar,{passive:true});window.addEventListener('resize',positionMetricToolbar);
  new ResizeObserver(positionMetricToolbar).observe(metricStrip);
  refreshServices();

  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const metricNumber=value=>finite(value)?value.toLocaleString('zh-CN',{maximumFractionDigits:2}):'—';
  const metricDate=month=>`${2026+Math.floor(month/12)}.${String(month%12+1).padStart(2,'0')}`;
  const axisNumber=value=>Math.abs(value)>=1e8?`${(value/1e8).toLocaleString('zh-CN',{maximumFractionDigits:1,useGrouping:false})}亿`:Math.abs(value)>=1e4?`${Math.round(value/1e4)}万`:value.toLocaleString('zh-CN',{maximumFractionDigits:1,useGrouping:false});
  function closeMetric({focus=false}={}){
    if(activeMetric===null)return;
    const previous=activeMetric;activeMetric=null;metricPanel.hidden=true;document.body.classList.remove('metric-open');
    serviceControls.append(taxiControls);
    metricCards.forEach(card=>card.setAttribute('aria-expanded','false'));
    if(focus)metricCards[previous].focus();
  }
  function positionMetric(){
    if(activeMetric===null)return;
    const card=metricCards[activeMetric].getBoundingClientRect();
    if(card.right<=0||card.left>=innerWidth){closeMetric();return;}
    const margin=innerWidth<=700?10:18,width=Math.min(380,innerWidth-margin*2),top=card.bottom+8;
    metricPanel.style.left=`${Math.max(margin,Math.min(card.left,innerWidth-width-margin))}px`;
    metricPanel.style.top=`${top}px`;metricPanel.style.width=`${width}px`;
    metricPanel.style.maxHeight=`${Math.max(0,Math.min(560,innerHeight-top-margin))}px`;
  }
  window.addEventListener('resize',positionMetric);
  one('.city-kpis').addEventListener('scroll',positionMetric,{passive:true});
  function metricHistory(state){
    const now=Date.UTC(2026+Math.floor(state.month/12),state.month%12+1,1)/86400000-Date.UTC(2026,0,1)/86400000+(state.simulation?.monthSeconds||0)/86400;
    const days=new Map((state.dailyHistory||[]).map(row=>[row.day,{...row,month:row.day/30.436875,date:row.date}]));
    days.set(now,{...days.get(now),...state.stats,month:now/30.436875,date:new Date(Date.UTC(2026,0,1)+now*86400000).toISOString().slice(0,10)});
    return [...days.values()].sort((a,b)=>a.month-b.month).filter(row=>!metricRange||row.month>now/30.436875-metricRange);
  }
  function metricChart(rows,config){
    const values=rows.flatMap(row=>config.series.map(([key])=>row[key])).filter(finite);
    if(!values.length)return '<div class="metric-empty">暂无有效数据，产生出行或推进模拟后再查看。</div>';
    const lo=Math.min(0,...values),hi=Math.max(...values),span=Math.max(1,hi-lo),max=Math.max(1,hi+span*.12),min=lo<0?lo-span*.08:0;
    const x=month=>48+(month-rows[0].month)/Math.max(1,rows.at(-1).month-rows[0].month)*248;
    const y=value=>158-(value-min)/(max-min)*134;
    let svg=`<svg viewBox="0 0 312 192" role="img" aria-label="${config.title}日度趋势，单位${config.unit}">`;
    for(let i=0;i<4;i++){const value=min+(max-min)*i/3,py=y(value);svg+=`<line x1="48" x2="296" y1="${py}" y2="${py}" stroke="#e8eef6"/><text x="41" y="${py+3}" text-anchor="end">${axisNumber(value)}</text>`;}
    for(const [key,label,color] of config.series){
      let path='',connected=false;
      for(const row of rows){if(!finite(row[key])){connected=false;continue;}path+=`${connected?'L':'M'}${x(row.month).toFixed(2)},${y(row[key]).toFixed(2)} `;connected=true;}
      svg+=`<path d="${path}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
      for(const row of rows)if(finite(row[key]))svg+=`<circle cx="${x(row.month)}" cy="${y(row[key])}" r="${rows.length===1?4:2.5}" fill="${color}"><title>${row.date||metricDate(row.month)} · ${label} ${metricNumber(row[key])} ${config.unit}</title></circle>`;
    }
    svg+=`<text x="48" y="181">${rows[0].date||metricDate(rows[0].month)}</text>`;
    if(rows.length>1)svg+=`<text x="296" y="181" text-anchor="end">${rows.at(-1).date||metricDate(rows.at(-1).month)}</text>`;
    return svg+'</svg>';
  }
  function renderMetric(){
    const state=CityApp.state;if(activeMetric===null||!state)return;
    const config=metricConfigs[activeMetric];
    if(config.service){
      serviceControls.append(taxiControls);
      const summary=serviceStats.summary(state,config.key);metricStamp=`${state.revision}/${state.month}/${state.history?.length}`;
      metricPanel.innerHTML=`<header class="metric-heading"><span>${serviceStats.icon(summary.group)}</span><div><small>公共服务</small><h2>${config.title}</h2></div><button class="icon-btn metric-close" aria-label="收起指标详情">${icon('close')}</button></header>${serviceStats.detail(summary,serviceNames)}`;
      metricPanel.querySelector('.metric-close').onclick=()=>closeMetric({focus:true});
      if(config.key==='taxi')metricPanel.querySelector('.taxi-metric-body').append(taxiControls);
      metricPanel.querySelectorAll('[data-service-facility]').forEach(button=>button.onclick=()=>{
        const picker=$('city-object-picker');if(![...picker.options].some(o=>o.value===button.dataset.serviceFacility))return;
        picker.value=button.dataset.serviceFacility;closeMetric();buildMenu.close();blockMenu.close();observeMenu.close();transitMenu.close();picker.dispatchEvent(new Event('change'));
      });return;
    }
    const rows=metricHistory(state),s=state.stats;
    metricStamp=`${state.revision}/${state.month}/${state.history?.length}`;
    const previous=rows.slice(0,-1).filter(row=>finite(row[config.key])).at(-1);
    const delta=previous&&finite(s[config.key])?s[config.key]-previous[config.key]:null;
    metricPanel.innerHTML=`<header class="metric-heading"><span>${icon(config.icon)}</span><div><small>城市指标</small><h2>${config.title}</h2></div><button class="icon-btn metric-close" aria-label="收起指标详情">${icon('close')}</button></header>
      <div class="metric-body"><div class="metric-value"><strong>${metricNumber(s[config.key])}</strong><span>${config.unit}</span></div><p class="metric-change">${delta===null?'暂无可比较的历史记录':`较 ${previous.date||metricDate(previous.month)} ${delta>0?'+':''}${metricNumber(delta)} ${config.unit}`}</p>
      <div class="metric-ranges" aria-label="趋势时间范围">${[[12,'12 个月'],[36,'36 个月'],[0,'全部']].map(([n,label])=>`<button data-months="${n}" aria-pressed="${n===metricRange}">${label}</button>`).join('')}</div>
      <div class="metric-chart">${metricChart(rows,config)}</div><div class="metric-legend">${config.series.map(([,label])=>`<span><i></i>${label}</span>`).join('')}</div>
      <p class="metric-note">${rows.length<2?'目前只有当前数据点，推进一天后形成趋势。':'历史数据取每日结算记录，最后一点为当前状态。'}</p>
      <h3>当前明细</h3><dl class="metric-details">${config.rows.map(([key,label,unit])=>`<dt>${label}</dt><dd>${metricNumber(s[key])}${finite(s[key])&&unit?' '+unit:''}</dd>`).join('')}</dl>
      ${config.key==='commute'?`<section class="metric-explanation" aria-label="通勤指标说明"><h3>这些数字怎么看</h3><p><strong>平均通勤</strong>仅统计已完成的上班通勤，单位为单程分钟。</p><p><strong>90% 通勤用时（P90）</strong>表示已完成通勤中，约 90% 的单程用时不超过该数值，用于观察较慢的通勤情况。</p><p><strong>出行失败次数</strong>统计典型工作日里因道路不连通、运力或可接受时间受限等原因未能完成的出行，涵盖所有出行目的。0 次表示没有失败，不是正在路上的人数。</p></section>`:''}
      <details class="metric-history"><summary>查看所选时段的逐日数据</summary><div class="city-table-wrap"><table class="city-table"><thead><tr><th>结算日期</th>${config.series.map(([,label])=>`<th>${label}</th>`).join('')}</tr></thead><tbody>${rows.slice().reverse().map(row=>`<tr><td>${row.periodDays>1?row.periodStartDate+' 至 '+row.date:row.date||metricDate(row.month)}</td>${config.series.map(([key])=>`<td>${metricNumber(row[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>
      <button class="metric-overview city-btn">查看完整城市统计 ↗</button></div>`;
    // Assign dynamic colors through CSSOM; CSP blocks HTML style attributes.
    metricPanel.querySelectorAll('.metric-legend i').forEach((swatch,index)=>{swatch.style.backgroundColor=config.series[index][2];});
    metricPanel.querySelector('.metric-close').onclick=()=>closeMetric({focus:true});
    metricPanel.querySelector('.metric-overview').onclick=()=>overview.click();
    metricPanel.querySelectorAll('[data-months]').forEach(button=>button.onclick=()=>{metricRange=Number(button.dataset.months);renderMetric();metricPanel.querySelector(`[data-months="${metricRange}"]`).focus();});
  }
  function refreshMetric(){refreshServices();refreshDemand();const state=CityApp.state;if(activeMetric!==null&&state&&metricStamp!==`${state.revision}/${state.month}/${state.history?.length}`)renderMetric();}
  metricCards.forEach((card,index)=>{
    card.setAttribute('role','button');card.tabIndex=0;card.setAttribute('aria-controls',metricPanel.id);card.setAttribute('aria-expanded','false');card.setAttribute('aria-label',`查看${metricConfigs[index].title}${metricConfigs[index].key==='taxi'?'运营与出行统计':metricConfigs[index].service?'设施统计':'趋势与详细数据'}`);
    const open=()=>{if(activeMetric===index){closeMetric();return;}activeMetric=index;metricPanel.hidden=false;document.body.classList.add('metric-open');metricCards.forEach((node,i)=>node.setAttribute('aria-expanded',String(i===index)));renderMetric();metricPanel.scrollTop=0;positionMetric();};
    card.addEventListener('click',open);card.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}});
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&activeMetric!==null){event.preventDefault();closeMetric({focus:true});}});
  document.addEventListener('pointerdown',event=>{if(activeMetric!==null&&!metricPanel.contains(event.target)&&!event.target.closest('.city-kpi'))closeMetric();});
  new MutationObserver(refreshMetric).observe(one('.city-kpis'),{subtree:true,childList:true,characterData:true});

  placeChrome();
  showCategory('buildings',{fromEngine:true});showTerrainCategory('biome');
  // Clear temporary drawer state when moving between home, terrain and city.
  new MutationObserver(records=>{if(records.some(r=>r.attributeName==='data-screen')){buildMenu.close();blockMenu.close();observeMenu.close();transitMenu?.close();document.body.classList.remove('panel-collapsed','show-inspector');setSettings(false);closeMetric();viewPanel.open=false;refreshServices();positionMetricToolbar();placeChrome();cachedTerrain=null;paintMinimap();}}).observe(document.body,{attributes:true,attributeFilter:['data-screen']});
})();
