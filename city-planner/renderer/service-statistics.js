/* Public-service inventory from saved facilities; never infer utility supply or occupancy. */
(function(root){
  'use strict';
  const groups=[
    ['taxi','出租车',[],'M3 11l2-6h14l2 6M3 11h18v8H3ZM6 19v2m12-2v2M7 14h1m8 0h1M10 5V3h4v2','典型工作日出租车服务；接客等待、载客与空驶均来自实际交通分配。'],
    ['water','供水',['water_plant'],'M12 2C9 7 5 11 5 15a7 7 0 0 0 14 0c0-4-4-8-7-13Z','供水量、用水需求与管网覆盖尚未模拟。'],
    ['power','供电',['power_plant','substation'],'m13 2-9 12h7l-1 8 10-13h-8Z','发电量、用电需求与电网覆盖尚未模拟。'],
    ['sanitation','污水与环卫',['sewage_plant','recycling_center'],'M4 7h16M9 3h6l2 4M6 7l1 14h10l1-14M10 11v6m4-6v6','污水流量、垃圾产量及处理负荷尚未模拟。'],
    ['parking','停车',['parking_lot','parking_garage'],'M5 3h14v18H5ZM10 17V7h3a3 3 0 0 1 0 6h-3','车位数来自设施规划；实际占用率尚未模拟。'],
    ['fuel','加油',['gas_station'],'M3 21V4h10v17M3 11h10M1 21h14M13 9h3v8a2 2 0 0 0 4 0V8l-4-4','燃油供应量与加油负荷尚未模拟。'],
    ['charging','充电',['charging_station'],'M5 3h14v18H5Zm8 3-4 7h4l-2 5','充电车位数来自设施规划；充电功率和占用率尚未模拟。'],
    ['police','警务',['police_station'],'m12 3 8 3v6c0 4-4 7-8 10-4-3-8-6-8-10V6Zm0 4v8m-4-4h8','警务覆盖率、案件与响应时间尚未模拟。'],
    ['fire','消防',['fire_station'],'M12 2c2 6 7 7 7 13a7 7 0 0 1-14 0c0-3 2-5 3-7 0 4 2 4 2 2Z','消防覆盖率、火警与响应时间尚未模拟。'],
    ['health','医疗',['clinic','hospital'],'M8 3h8v5h5v8h-5v5H8v-5H3V8h5Z','服务容量为模型中的服务名额；使用人数为典型日出行分配结果，并非床位占用率。'],
    ['education','教育',['school','university'],'m2 8 10-5 10 5-10 5Zm4 2v7l6 4 6-4v-7M22 8v9','容量与使用人数来自模型；未计算真实招生与班级规模。'],
    ['green','公园与广场',['park','plaza'],'M12 3 5 13h4l-5 5h16l-5-5h4ZM12 18v4','包含街区共享绿地与庭院；使用人数为典型日出行分配结果。'],
    ['culture','文化与会展',['museum','theater','cinema','convention_center'],'m2 7 10-5 10 5ZM4 21h16M6 9v9m6-9v9m6-9v9','容量与使用人数仅在设施具有对应模型数据时显示。'],
    ['sports','体育',['sports_arena'],'M4 6c4-4 12-4 16 0v12c-4 4-12 4-16 0Zm0 0c4 4 12 4 16 0M8 10v9m8-9v9','赛事、观众负荷及体育服务覆盖尚未模拟。'],
    ['civic','市政',['city_hall'],'M3 21h18M5 21V8h14v13M3 8l9-6 9 6M9 12v5m6-5v5','显示市政设施和维护费用；行政办理量尚未模拟。'],
    ['transport','交通枢纽',['airport','port','train_station'],'M5 3h14v15H5ZM5 11h14M8 18l-3 4m11-4 3 4M8 14h1m6 0h1','统计机场、港口和火车站；公交与地铁站点可在交通菜单查看。'],
    ['commerce','住宿与物流',['hotel','logistics_hub','industrial_plant'],'M3 21V9h8V3h10v18ZM6 13h2m-2 4h2m7-10h3m-3 5h3m-3 5h3','补充展示城市自动生成的住宿、物流和工业配套设施。'],
    ['other','其他设施',[],'M4 4h6v6H4Zm10 0h6v6h-6ZM4 14h6v6H4Zm10 0h6v6h-6Z','未归类的设施也会计入，避免遗漏存档中的新增类型。']
  ].map(([key,title,kinds,path,note])=>({key,title,kinds,path,note}));
  const known=new Set(groups.flatMap(g=>g.kinds));
  const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=value=>valid(value)?value.toLocaleString('zh-CN',{maximumFractionDigits:1}):'—';
  const icon=g=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${g.path}"/></svg>`;
  function summary(state,key){
    const group=groups.find(g=>g.key===key);
    if(key==='taxi')return {group,facilities:[],count:state?.taxi?.fleetSize||0,taxi:state?.taxi||{enabled:false,fleetSize:0},report:state?.taxiReport||{}};
    const facilities=(state?.facilities||[]).filter(f=>group.key==='other'?!known.has(f.kind):group.kinds.includes(f.kind));
    const total=field=>{const values=facilities.map(f=>f[field]).filter(valid);return values.length?values.reduce((a,b)=>a+b,0):facilities.length?null:0;};
    return {group,facilities,count:facilities.length,connected:facilities.filter(f=>f.connected===true).length,unknownConnection:facilities.filter(f=>typeof f.connected!=='boolean').length,capacity:total('capacity'),visits:total('visits'),parkingSpaces:total('parkingSpaces'),chargingSpaces:total('chargingSpaces'),rooms:total('rooms'),maintenance:total('maintenance'),cost:total('cost'),missingMaintenance:facilities.filter(f=>!valid(f.maintenance)).length};
  }
  function subtitle(s){
    if(s.group.key==='taxi')return s.taxi.enabled?`${fmt(s.count)} 辆 · 等待 ${fmt(s.report.meanWait)} 分钟`:'尚未运营 · 点击配置服务';
    if(s.group.key==='parking')return `${fmt(s.parkingSpaces)} 个规划车位`;
    if(s.group.key==='charging')return `${fmt(s.chargingSpaces)} 个充电车位`;
    if(['health','education'].includes(s.group.key)&&s.capacity>0)return `${fmt(s.capacity)} 个服务名额`;
    return `${s.connected} 处已接入道路`;
  }
  function detail(s,names={}){
    if(s.group.key==='taxi')return '<div class="metric-body taxi-metric-body"></div>';
    const rows=[['设施总数',s.count+' 处'],['已接入道路',s.connected+' 处'],['待连接道路',(s.count-s.connected-s.unknownConnection)+' 处'],...(s.unknownConnection?[['接入状态未记录',s.unknownConnection+' 处']]:[]),['月维护费',fmt(s.maintenance)+' 元'],['现有设施建设费用',fmt(s.cost)+' 元']];
    if(s.group.key==='parking')rows.push(['规划车位',fmt(s.parkingSpaces)+' 个'],['实际占用率','未模拟']);
    if(s.group.key==='charging')rows.push(['充电车位',fmt(s.chargingSpaces)+' 个'],['实际占用率','未模拟']);
    if(s.rooms>0)rows.push(['客房数',fmt(s.rooms)+' 间']);
    if(s.capacity>0)rows.push(['服务容量',fmt(s.capacity)+' 名额'],['典型日使用人数',s.visits===null?'尚无记录':fmt(s.visits)+' 人']);
    const kinds=s.group.key==='other'?[...new Set(s.facilities.map(f=>f.kind))]:s.group.kinds;
    return `<div class="metric-body"><div class="metric-value"><strong>${s.count}</strong><span>处设施</span></div><p class="metric-note">${esc(s.group.note)}</p><dl class="metric-details">${rows.map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>${s.missingMaintenance?'<p class="metric-note">部分设施未记录维护费，金额仅汇总已有数据。</p>':''}<h3>设施类型</h3><div class="service-type-counts">${kinds.map(k=>`<span>${esc(names[k]||k)}<b>${s.facilities.filter(f=>f.kind===k).length}</b></span>`).join('')}</div><h3>设施明细 · 点击定位</h3>${s.count?`<div class="service-facility-list">${s.facilities.map(f=>`<button class="service-facility" data-service-facility="${esc(f.id)}"><strong>${esc(f.name||names[f.kind]||f.kind)}</strong><small>${esc(names[f.kind]||f.kind)} · ${f.connected===true?'已接入道路':f.connected===false?'待连接道路':'接入状态未记录'}${valid(f.parkingSpaces)?' · '+fmt(f.parkingSpaces)+' 个车位':valid(f.chargingSpaces)?' · '+fmt(f.chargingSpaces)+' 个充电位':f.capacity>0?' · '+fmt(f.capacity)+' 名额':''}</small></button>`).join('')}</div>`:'<p class="metric-empty">暂无此类设施。开启自动生长后，城市会按需求与选址条件建设配套；交通枢纽可在建造菜单规划。</p>'}</div>`;
  }
  const value=s=>s.group.key==='taxi'?(s.taxi.enabled?`${fmt(s.report.completed??0)} 人次`:'未运营'):`${s.count} 处`;
  const api={groups,summary,subtitle,detail,icon,value};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CityServiceStatistics=api;
})(typeof window!=='undefined'?window:globalThis);
