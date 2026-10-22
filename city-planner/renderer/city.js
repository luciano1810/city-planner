/* City editor. All economic and transport state is owned by the Python engine. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const workspace = window.MapWorkspace;
  const canvas = el('map');
  const fmt = (value, digits=0) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('zh-CN',{maximumFractionDigits:digits});
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const saveLabel = save => {
    const automatic = /^(地形起点|自动保存|编辑前检查点|方案检查点) [0-9a-f]{32}$/.exec(save.name);
    return automatic ? `${automatic[1]} · ${new Date(save.modified*1000).toLocaleString('zh-CN')}` : save.name;
  };
  const date = month => `${2026+Math.floor(month/12)} 年 ${month%12+1} 月`;
  const useNames = {residential:'住宅',commercial:'商业',office:'办公',industrial:'工业',warehouse:'仓储'};
  const colors = {residential:'#91aa75',commercial:'#d0a66a',office:'#7799a5',industrial:'#aa94b6',warehouse:'#aa9c85'};
  const modeNames = {walk:'步行',car:'汽车',taxi:'出租车',public:'公共交通',bus:'巴士',metro:'地铁',tram:'有轨电车',train:'火车'};
  const statusNames = {planned:'待开工',construction:'施工中',active:'使用中',vacant:'长期空置'};
  const roadKinds = ['motorway','highway','avenue','street','lane','path'];
  const trafficMetrics=window.CityTrafficMetrics;
  let trafficPeriod='peak';
  const specialTools=['airport','port','train_station','bus_depot'];
  const facilityNames={school:'学校',clinic:'诊所',park:'公园',plaza:'广场',...window.CitySpecialBuildings.names};
  let state=null, session=null, active=false, working=false;
  let currentSave=null;
  let trafficState=null,scenePreviewMinute=null;
  const trafficPlayback=new window.CityTrafficPlayback.Playback();
  let trafficFrame=null;
  function animateTraffic(){
    trafficFrame=null;
    if(!active||!simulation.running||document.hidden)return;
    workspace.requestAnimation();
    trafficFrame=requestAnimationFrame(animateTraffic);
  }
  function syncTrafficAnimation(){
    trafficPlayback.setPaused(!simulation.running);
    if(!simulation.running){cancelAnimationFrame(trafficFrame);trafficFrame=null;}
    else if(trafficFrame===null)trafficFrame=requestAnimationFrame(animateTraffic);
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncTrafficAnimation();});
  let mapHitLabels=[];
  let snapTarget=null, pointerPosition=null;
  const snappedPoints=new WeakMap();
  function cloneDraftPoint(p){const q=p.slice();if(snappedPoints.has(p))snappedPoints.set(q,snappedPoints.get(p));return q;}
  function roadConnections(){return [draft[0],draft.at(-1)].filter(Boolean).flatMap(p=>{const r=snappedPoints.get(p);return r?[{road:r.road,point:p.slice(),...(r.junction?{junction:r.junction}:{})}]:[];});}
  let tool='select', layer='use', selected=null, hover=null, draft=[], lineStops=[], panel='build';
  let editingLine=null,editingRoad=null,dragControl=null,preview=null,previewTimer=null,previewTicket=0,queryResult=null,comparison=null;
  let baseline=null, sourceParcel=null, inspectedRoute=null, space=false;
  let renewalSelection=[],renewalPreview=null;
  let specialPreview=null,specialTimer=null,specialTicket=0;
  let busPreview=null,busTimer=null,busTicket=0,busSnap=null;
  const busDraft=()=>tool==='line'&&el('city-mode').value==='bus';
  const busReady=()=>state?.facilities.some(f=>f.kind==='bus_depot'&&f.connected);
  function clearBusPreview(){clearTimeout(busTimer);busTicket++;busPreview=null;busSnap=null;}
  function scheduleBusPreview(){
    clearBusPreview();
    if(!busDraft()||lineStops.length<2)return;
    const ticket=busTicket,revision=state.revision;
    const command={stops:structuredClone(lineStops),oneway:!!el('transit-oneway')?.checked};
    busTimer=setTimeout(async()=>{try{const result=await api('bus_preview',{command});if(ticket===busTicket&&revision===state.revision){busPreview=result;updateHint();workspace.requestDraw();}}catch(error){if(ticket===busTicket){busPreview={valid:false,reason:error.message};updateHint();}}},140);
  }
  function busSnapAt(point){const g=workspace.geometry,t=workspace.terrain;return window.CityBusGeometry.snap(point,state.roads,state.meta.roadTypes,{sx:t.width*g.scale/state.meta.width,sy:t.height*g.scale/state.meta.height});}
  const toolDrafts=new Map();
  const shapeBounds=new WeakMap();

  document.querySelector('.app-name').textContent='地形与城市工作台';
  document.querySelector('.workspace-heading>div').insertAdjacentHTML('beforeend', `
    <div class="city-entry">
      <button class="city-btn primary" id="city-start" disabled>确认地形并开始规划</button>
      <button class="city-btn" id="city-demo">体验示范城市</button>
      <button class="city-btn" id="city-open-world">打开城市存档</button><button class="city-btn" id="city-valley">城市案例</button>
    </div>`);
  document.querySelector('.app-layout').insertAdjacentHTML('afterbegin', `
    <aside class="city-sidebar" hidden>
      <div class="city-brand-caption"><small>SHANHAI CITY LAB</small><h2 id="city-name">山海新城</h2><p>你画马路，城市顺着地形生长。</p></div>
      <nav class="city-nav" aria-label="城市工具"><button data-panel="build" class="active">建设</button><button data-panel="transit">交通</button><button data-panel="data">观察</button></nav>
      <div class="city-panel" id="city-build-panel">
        <h3>地图工具</h3><div class="city-tool-grid">
          <button class="city-tool active" data-tool="select"><svg><use href="#i-pin"/></svg><span>选择</span></button>
          <button class="city-tool" data-tool="pan"><svg><use href="#i-expand"/></svg><span>平移</span></button>
        </div>
        <h3>道路与轨道</h3><div class="city-tool-grid">
          <button class="city-tool" data-tool="motorway"><span>高速公路</span></button>
          <button class="city-tool" data-tool="highway"><span>快速路</span></button>
          <button class="city-tool" data-tool="street"><span>普通路</span></button>
          <button class="city-tool" data-tool="lane"><span>小路</span></button>
          <button class="city-tool" data-tool="avenue"><span>主干道</span></button>
          <button class="city-tool" data-tool="path"><span>步道</span></button>
          <button class="city-tool" data-tool="metro"><span>地铁轨道</span></button>
          <button class="city-tool" data-tool="train"><span>铁路</span></button>
          <button class="city-tool" data-tool="tram"><span>电车轨道</span></button>
          <button class="city-tool" data-tool="delete"><span>拆除</span></button>
        </div>
        <div class="city-fields"><label>路线形状<select class="city-field" id="city-shape"><option value="curve">平滑曲线</option><option value="polyline">直线 / 折线</option></select></label><label>建设层级<select class="city-field" id="city-level"><option value="0">地面</option><option value="1">高架 / 桥梁</option><option value="-1">地下 / 隧道</option></select></label>
        <label><span><input type="checkbox" id="city-oneway"> 单向道路</span></label></div>
        <label class="city-note"><input type="checkbox" id="city-auto-route" checked> 自动绕坡</label>
        <p class="city-note">遇到陡坡时，尝试在控制点之间寻找缓坡路线。橙线为实际建设路线，灰线仅指向鼠标。</p>
        <div class="city-row"><button class="city-btn primary" id="city-finish">完成绘制</button><button class="city-btn" id="city-cancel">取消</button></div>
        <p class="city-note" id="city-draft-info">靠近道路自动吸附，逐点绘制，Enter 完成，Esc 取消。按住空格或使用平移工具拖动地图。</p>
        <div id="city-coordinate-controls"><div class="city-fields"><label>选择对象<select class="city-field" id="city-object-picker"><option value="">选择城市对象</option></select></label><div class="paired"><label>横坐标 / m<input class="city-field" type="number" id="city-coordinate-x" min="0" value="1000"></label><label>纵坐标 / m<input class="city-field" type="number" id="city-coordinate-y" min="0" value="1000"></label></div><label>替换第几个控制点（0 为新增）<input class="city-field" id="city-coordinate-index" type="number" min="0" value="0"></label></div><button class="city-btn" id="city-coordinate-apply">按当前工具操作坐标</button></div>
        <h3>交通建筑</h3><div class="city-tool-grid"><button class="city-tool" data-tool="airport"><span>机场</span></button><button class="city-tool" data-tool="port"><span>港口</span></button><button class="city-tool" data-tool="train_station"><span>火车站</span></button></div>
        <div class="city-fields" id="city-special-controls" hidden>
          <label>建筑名称<input class="city-field" id="city-special-name" maxlength="60" placeholder="留空随机命名"></label>
          <label>占地规模<select class="city-field" id="city-special-size"><option value="compact">紧凑</option><option value="standard" selected>标准</option><option value="large">大型</option></select></label>
          <label>朝向 / 度<input class="city-field" id="city-special-rotation" type="number" min="0" max="359" step="15" value="0"></label>
          <button class="city-btn" id="city-special-rotate">旋转 15° · R</button>
          <p class="city-note" id="city-special-hint" aria-live="polite">移动到地图上预览，点击放置。</p>
        </div>
        <h3>街区更新</h3><label class="city-note"><input id="city-auto-renew" type="checkbox" checked> 随模拟自动评估翻新与重建</label><p class="city-note">每 6 个月评估状况、空置、需求及收益；自动项目不强制居民迁出。详细阈值可在模型校准中调整。</p><div class="city-row"><button class="city-tool" data-tool="renewal">选择更新地块</button><button class="city-btn" id="city-renewal-clear">清空</button></div>
        <p class="city-note" id="city-renewal-selection">点击地块选择；再次点击取消。</p><button class="city-btn primary" id="city-renewal-preview">预览片区更新方案</button><div id="city-renewal-list"></div>
        <h3>自动生长</h3><div class="city-fields"><label><span><input type="checkbox" id="city-auto-grow" checked> 自动补充支路、小径与公共配套</span></label></div><p class="city-note">社区会按人口、用途和道路条件随机补充医院、校园、文体场馆、酒店、能源与市政设施，并保留公园、广场和停车配套。成熟 CBD 会自动开发摩天楼。</p><h3>规划辅助</h3><button class="city-btn" id="city-grid-demo">生成示范街区</button>
        <button class="city-tool" data-tool="gateway">设置区域货运门户</button>
        <p class="city-note">仅为空白城市铺设少量道路，建筑和居民由模拟产生。</p>
      </div>
      <div class="city-panel" id="city-transit-panel" hidden>
        <section class="signal-panel" aria-labelledby="signal-title">
          <h3 id="signal-title">交通模拟设置</h3>
          <div class="city-fields"><label>交通来源<select class="city-field" id="signal-demand"><option value="observed">城市交通分配</option><option value="test">验证人车流</option></select></label></div>
          <button class="city-btn" id="signal-reset">重新生成交通样本</button>
          <details><summary>信号配时</summary><div class="city-fields"><label>绿灯 / 秒<input class="city-field" id="signal-green" type="number" min="5" max="90" value="12"></label><label>黄灯 / 秒<input class="city-field" id="signal-yellow" type="number" min="2" max="6" value="3"></label><label>全红清空 / 秒<input class="city-field" id="signal-clearance" type="number" min="2" max="15" value="3"></label></div><button class="city-btn" id="signal-apply">应用配时</button></details>
        </section>
        <h3>站点与服务</h3>
        <div class="city-fields">
          <label>交通方式<select class="city-field" id="city-mode"><option value="bus">巴士</option><option value="metro">地铁</option><option value="tram">有轨电车</option><option value="train">火车</option></select></label>
          <label>铁路设施<select class="city-field" id="city-station-role"><option value="passenger">客运站</option><option value="freight">铁路货场</option></select></label><label><span><input id="city-station-external" type="checkbox"> 区域外联系门户（边界 650 m 内）</span></label><label>站点名称<input class="city-field" id="city-stop-name" maxlength="60" placeholder="留空随机命名"></label>
        </div>
        <button class="city-tool" data-tool="stop">在地图上设置站点</button>
        <div class="city-divider"></div>
        <h3>创建运营线路</h3>
        <div class="city-fields">
          <label>线路名称<input class="city-field" id="city-line-name" maxlength="60" placeholder="留空随机命名"></label>
          <div class="paired"><label>间隔 / 分钟<input class="city-field" id="city-headway" type="number" min="2" max="120" value="10"></label><label>每车载客<input class="city-field" id="city-capacity" type="number" min="10" max="2000" value="70"></label></div>
          <label>每日运营 / 小时<input class="city-field" id="city-hours" type="number" min="4" max="24" value="16"></label>
          <label><span><input type="checkbox" id="city-mixed"> 有轨电车与道路混行</span></label>
        </div>
        <button class="city-tool" data-tool="line">按顺序选择地图站点</button>
        <p class="city-note" id="city-stop-order">尚未选择站点</p>
        <div class="city-row"><button class="city-btn primary" id="city-create-line">开通线路</button><button class="city-btn" id="city-clear-line">清空</button></div>
        <p class="city-note">铁路与地铁轨道可互相吸附连接，火车与地铁线路可共用两种轨道及客运站。跨层需在吸附点选择接入。</p><h3>运营线路</h3><div class="city-list" id="city-line-list"></div><details><summary>铁路货运服务</summary><p class="city-note">先在铁路上建立本地货场与边界货场。客运站不能装卸货物。</p><div class="city-fields"><label>本地货场<select class="city-field" id="city-freight-start"></select></label><label>区域货场<select class="city-field" id="city-freight-end"></select></label><label>每日货列<input class="city-field" id="city-freight-trains" type="number" min="1" max="48" value="4"></label><label>每列载重 / 吨<input class="city-field" id="city-freight-tonnes" type="number" min="10" max="5000" value="500"></label></div><button class="city-btn" id="city-create-freight">开通货运服务</button><div id="city-freight-list"></div></details>
      </div>
      <div class="city-panel" id="city-data-panel" hidden>
        <h3>光照与材质</h3><div class="city-fields">
          <label>显示模式<select class="city-field" id="city-render-quality"><option value="auto">自动切换</option><option value="high">精细视图</option><option value="map">地图视图</option></select></label>
          <label for="city-time-of-day">光照时刻 <output id="city-time-value">09:00 · 白天</output></label>
          <input id="city-time-of-day" type="range" min="0" max="1439" step="1" value="540" aria-label="光照时刻">
          <div class="signal-speed-labels"><span>00:00</span><span>12:00</span><span>24:00</span></div>
          <p class="city-note">模拟速度最高为 3 天/秒；低于 1 天/秒时光照跟随模拟速度，达到 1 天/秒后光照按实时速度变化。拖动滑块可暂停模拟并调整光照，城市日期保持不变。</p>
          <label><span><input type="checkbox" id="city-render-labels"> 显示建筑名称、楼层与城区名称</span></label>
          <label><span><input type="checkbox" id="city-show-transit-lines"> 显示公交线路</span></label>
        </div>
        <h3>专题地图</h3><div class="city-fields">
          <label>显示内容<select class="city-field" id="city-layer">
            <option value="use">城市地图 / 建筑用途</option><option value="population">居住人口</option><option value="jobs">岗位密度</option>
            <option value="land">土地单价</option><option value="rent">空间租金</option><option value="vacancy">建筑空置</option>
            <option value="access">30 分钟岗位可达</option><option value="traffic">道路流量</option><option value="transit">公交服务</option>
            ${Object.entries(trafficMetrics.views).map(([key,view])=>`<option value="${key}">${view.label}</option>`).join('')}
            <option value="flows">人员流向</option><option value="districts">功能城区</option><option value="pollution">环境压力指数</option><option value="slope">地块坡度</option><option value="cost">地形建设成本</option><option value="landscape">景观品质</option><option value="risk">低地邻水指数</option><option value="height">建筑高度</option><option value="change">土地涨跌幅</option><option value="development">开发状态</option><option value="comparison">方案地价差异</option>
          </select></label></div>
        <button class="city-tool" data-tool="route">选择起终点查看旅程</button>
        <div id="city-traffic-controls" hidden><label>交通时段<select class="city-field" id="city-traffic-period">${Object.entries(trafficMetrics.periods).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><p class="city-note" id="city-traffic-note"></p></div>
        <h3>空间查询</h3><button class="city-tool" data-tool="area">框选范围统计</button><div class="city-fields"><label>可达时间 / 分钟<select class="city-field" id="city-access-budget"><option value="30">30</option><option value="45">45</option><option value="60">60</option></select></label><label>查询交通方式<select class="city-field" id="city-access-mode"><option value="public">步行与公共交通</option><option value="walk">步行</option><option value="car">汽车</option></select></label></div><button class="city-tool" data-tool="isochrone">选择起点查看等时范围</button><button class="city-btn" id="city-query-clear">清除范围</button><h3>城市情景</h3>
        <div class="city-fields">
          <label>迁入意愿基准（户/月）<input class="city-field" type="number" id="city-migration" min="0" max="500" value="24"></label>
          <label>外部基础岗位需求<input class="city-field" type="number" id="city-external" min="0" max="10000" value="90"></label>
          <label>发展速度<select class="city-field" id="city-growth"><option value="0">停止新开发与迁入</option><option value="0.5">缓慢</option><option value="1" selected>正常</option><option value="2">快速</option><option value="3">高速</option></select></label>
          <label>公交单次旅程票价<input class="city-field" type="number" id="city-fare" min="0" max="20" value="2"></label>
          <label><span><input type="checkbox" id="city-budget"> 启用建设预算限制</span></label>
        </div>
        <button class="city-btn" id="city-settings">应用情景参数</button>
        <details><summary>模型校准与性能</summary><p class="city-note">校准参数随存档保存，改变参数后方案比较会显示差异。</p><button class="city-btn" id="city-calibration">查看与编辑校准</button><button class="city-btn" id="city-performance">测量地图性能（10 秒）</button><p id="city-performance-result" class="city-note" role="status"></p></details><h3>数据与方案</h3><div class="city-row"><button class="city-btn" id="city-compare">比较另一存档</button><button class="city-btn" id="city-summary">导出情景摘要</button></div><div class="city-row"><button class="city-btn" id="city-csv">导出统计 CSV</button><button class="city-btn" id="city-history">历史明细</button></div>
        <div class="city-row"><button class="city-btn" id="city-baseline">记录对照基线</button><button class="city-btn" id="city-branch">创建独立方案</button></div>
        <p class="city-note">同一模型、同一初态和相同时长的方案才可直接比较。指标均为简化模拟值。</p>
      </div>
      <div class="city-sidebar-foot"><button class="city-btn" id="city-undo">撤销</button><button class="city-btn" id="city-redo">重做</button><button class="city-btn" id="city-save">存档</button></div>
    </aside>`);
  document.querySelector('.workspace').insertAdjacentHTML('afterbegin', `
    <div class="city-controlbar" hidden><div class="city-date" id="city-date">2026 年 1 月 1 日<small>09:00 · 已暂停</small></div>
      <div class="city-play"><button class="city-btn primary" id="city-play">开始模拟</button>
      <div class="city-simulation-speed"><label for="city-speed">模拟速度 <output id="city-speed-value">1× · 实时</output></label>
      <input type="range" id="city-speed" min="0" max="${window.CitySimulation.speeds.length-1}" step="1" value="0" aria-label="统一模拟速度" aria-valuetext="1 倍，实时">
      <div class="signal-speed-labels"><span>实时</span><span>分钟</span><span>3 天/秒</span></div></div>
      <button class="city-btn" id="city-dashboard">城市概况</button><button class="city-btn" id="city-files">文件</button></div>
      <p id="city-simulation-note" class="city-simulation-note">光照跟随模拟倍速；达到 1 天/秒后改为实时光照。</p></div>
    <div class="city-kpis" hidden>
      <div class="city-kpi"><span>常住人口</span><strong id="ck-pop">0</strong><small id="ck-pop-sub">等待城市生长</small></div>
      <div class="city-kpi"><span>就业人数 / 岗位</span><strong id="ck-jobs">0 / 0</strong><small id="ck-jobs-sub">—</small></div>
      <div class="city-kpi"><span>土地估值中位数</span><strong id="ck-land">—</strong><small>模拟币 / m² 土地</small></div>
      <div class="city-kpi"><span>平均通勤</span><strong id="ck-time">—</strong><small id="ck-time-sub">单程平均 · 查看详情</small></div>
    </div>`);
  document.querySelector('.workspace').insertAdjacentHTML('beforeend', `
    <div class="city-legend" id="city-legend" hidden></div><div class="city-status" id="city-status" role="status" hidden></div>`);
  document.querySelector('.app-layout').insertAdjacentHTML('beforeend', '<aside class="city-inspector" id="city-inspector" hidden aria-label="城市详情"></aside>');
  el('map-frame').insertAdjacentHTML('beforeend','<div class="city-hint" id="city-hint" hidden>选择工具开始建设</div><div class="city-busy" role="status">城市引擎正在计算…</div>');
  el('map-frame').insertAdjacentHTML('beforeend', `<div class="road-validation" id="road-validation" role="status" aria-live="polite" aria-atomic="true" hidden>
    <span class="road-validation-icon" aria-hidden="true">!</span><div><strong>此处无法建造</strong><p id="road-validation-reason"></p><small>拖动控制点调整路线 · Backspace 撤回</small></div>
  </div>`);
  document.body.insertAdjacentHTML('beforeend','<dialog class="city-dialog" id="city-dialog"><div class="city-dialog-progress" role="status">正在加载或计算城市，请稍候…</div><div id="city-dialog-body"></div><div class="city-dialog-actions"><button class="city-btn" id="city-dialog-close">关闭</button></div></dialog><input type="file" id="city-import-file" accept=".json" hidden>');
  document.body.insertAdjacentHTML('beforeend','<div id="city-service-controls" hidden><section id="city-taxi-panel" aria-labelledby="taxi-title"></section></div>');
  const taxiPanel=window.CityTaxis.mount(el('city-taxi-panel'),values=>command({type:'taxi_settings',values}));
  const owned = ['.city-sidebar','.city-controlbar','.city-kpis','.city-inspector','#city-legend','#city-status','#city-hint'];

  async function api(action, payload={}) {
    const body={id:session,...payload};
    if (window.terrainAPI?.city) {
      try { return await window.terrainAPI.city(action,body); }
      catch(error) {
        throw new Error(String(error.message||error).replace(/^Error invoking remote method ['"]city:request['"]:\s*(?:Error:\s*)?/,''));
      }
    }
    const response=await fetch('/api/city/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();
    if (!response.ok) throw new Error(result.error||'城市引擎未响应');
    return result;
  }
  function status(message,error=false) {
    el('city-status').textContent=message; el('city-status').classList.toggle('error',error);
    if(error) workspace.toast(message);
  }
  async function task(work) {
    if(working) return;
    working=true; document.body.classList.add('city-working');
    document.querySelector('.sidebar').inert=true;
    document.querySelector('.city-entry').inert=true;
    document.querySelector('.home-menu').inert=true;
    el('city-dialog-close').disabled=true;
    if(el('city-dialog-error'))el('city-dialog-error').hidden=true;
    for(const id of ['city-play','city-speed','city-start','city-demo','city-save','city-finish','city-create-line']) el(id).disabled=true;
    try { await simulation.settle();return await work(); }
    catch(error){
      pause(); status(error.message,true);
      if(el('city-dialog-error')){el('city-dialog-error').textContent=error.message;el('city-dialog-error').hidden=false;}
    }
    finally{
      working=false; document.body.classList.remove('city-working');
      document.querySelector('.sidebar').inert=false;
      document.querySelector('.city-entry').inert=false;
      document.querySelector('.home-menu').inert=false;
      if(document.body.dataset.screen==='home'&&!el('city-dialog').open)el('menu-new').focus();
      el('city-dialog-close').disabled=false;
      for(const id of ['city-play','city-speed','city-demo','city-save','city-finish','city-create-line']) el(id).disabled=false;
      el('city-start').disabled=!workspace.canConfirm;
      window.dispatchEvent(new Event('city-renewal-change'));updateHint();
    }
  }
  function activate(result) {
    simulation.invalidate();scenePreviewMinute=null; trafficState=result.city.liveTraffic||null;if(trafficState)el('signal-demand').value=trafficState.mode; currentSave=result.saveName||null;
    if(session&&session!==result.id)api('close',{id:session}).catch(()=>{});
    clearTimeout(previewTimer);previewTicket++;
    renewalSelection=[];renewalPreview=null;active=true; session=result.id; state=result.city;simulation.setSpeed(state.simulation?.speed||1,{persist:false});queryResult=null;editingRoad=null;editingLine=null;preview=null;toolDrafts.clear();
    window.CityScene.setTime(state.sceneTimeSeconds??9*3600);
    if(state.migrationNote)workspace.toast(state.migrationNote);
    if(result.terrain) workspace.installTerrain(result.terrain);
    document.body.classList.add('city-mode');
    window.AppNavigation?.show('city');
    owned.forEach(selector=>document.querySelector(selector).hidden=false);
    el('city-inspector').hidden=false;
    selected=null; draft=[]; lineStops=[]; clearBusPreview();inspectedRoute=null;tool='select';space=false;
    canvas.classList.remove('city-drawing');
    document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool==='select'));
    el('city-migration').value=state.settings.migration; el('city-external').value=state.settings.externalJobs;
    if(![...el('city-growth').options].some(o=>Number(o.value)===state.settings.growth))el('city-growth').add(new Option('当前速度 '+state.settings.growth+'×',String(state.settings.growth)));
    el('city-growth').value=state.settings.growth; el('city-fare').value=state.settings.fare;
    el('city-auto-renew').checked=state.settings.autoRenew!==false;el('city-budget').checked=state.settings.budget;el('city-auto-grow').checked=state.settings.autoGrow!==false;el('city-access-budget').value=String(state.settings.accessBudget||30);
    render(); updateTraffic(); workspace.fit();
    if(!state.roads.length&&workspace.terrain.startupArea){
      const site=workspace.terrain.startupArea;
      workspace.focus(site.center,Math.min(512,Math.max(1.5,Math.max(state.meta.width,state.meta.height)/(site.sizeMeters*3))));
      status('已定位启动空地 · 在附近铺设街道后，开始模拟等待按期开工');
    }
    if(state.roads.length) {
      const points=state.roads.flatMap(r=>r.points);
      workspace.focus([points.reduce((s,p)=>s+p[0],0)/points.length,points.reduce((s,p)=>s+p[1],0)/points.length],3);
    }
  }
  async function command(cmd) {
    pause();
    return task(async()=>{state=await api('command',{command:{...cmd,revision:state.revision}});render();status('');return true;});
  }
  const simulation=new window.CitySimulation.Driver({
    request:payload=>api('simulate',{...payload,incremental:true,mode:el('signal-demand').value}),
    apply:(result,timing)=>{
      if(result.city)state=result.city;
      state.simulation=result.simulation;state.month=result.month;state.sceneTimeSeconds=result.sceneTimeSeconds;
      state.settlement=result.settlement;
      trafficState=result.traffic;state.liveTraffic=trafficState;
      trafficPlayback.push(trafficState,result.trafficAnimation,{reset:result.trafficReset,time:timing?.sentAt});
      syncTrafficAnimation();
      if(result.city)render();else updateTraffic();
      if(result.saveWarning)status(result.saveWarning,true);
    },
    onState:()=>{syncTrafficAnimation();if(state)updateSimulationControls();},
    onError:error=>status(error.message,true)
  });
  function pause(){return simulation.pause();}
  function updateSimulationControls(){
    const index=window.CitySimulation.speeds.indexOf(simulation.speed),label=window.CitySimulation.labels[index];
    el('city-play').textContent=simulation.running?'暂停模拟':'开始模拟';
    el('city-speed').value=index;el('city-speed').setAttribute('aria-valuetext',label);el('city-speed-value').textContent=label;
    const seconds=state?.simulation?.monthSeconds??32400,day=Math.floor(seconds/86400)+1;
    const minute=Math.floor(seconds%86400/60),time=String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
    const settlement=state?.settlement;
    el('city-date').innerHTML=`${date(state.month)} ${day} 日<small>${time} · ${simulation.waiting?'计算中':simulation.running?(settlement?.pending?'日结算准备中':'运行中'):'已暂停'}</small>`;
    el('city-simulation-note').textContent=simulation.waiting
      ?(simulation.running?'正在计算模拟进度，完成后自动继续。':'正在完成本次计算，完成后保持暂停。')
      :simulation.running&&settlement?.pending
      ?`${settlement.stage} · ${Math.floor(settlement.progress*100)}% · 后台准备本日结算，仍可暂停和建设。`
      :'模拟速度最高 3 天/秒；达到 1 天/秒后改为实时光照。';
  }
  function updateTraffic() {
    updateSceneClock();updateSimulationControls();
    updateTrafficDetails();
    // Traffic replies update the live overlay. The workspace samples static
    // sunlight by minute; explicit clock edits and structural render() updates
    // still use requestDraw() to invalidate the base immediately.
    workspace.requestAnimation();
  }
  function liveTrafficValues(){
    const t=trafficState,count=value=>Number.isFinite(value)?fmt(value):'—';
    return {vehicles:count(t?.vehicles?.length),buses:count(t?.vehicles?.filter(v=>v.mode==='bus').length),pedestrians:count(t?.pedestrians?.length),waiting:count(t?.waiting),
      passed:count(t?.passed),pedestrianWaiting:count(t?.pedestrianWaiting),
      sampling:t?(state.simulation?.sampled?'高速抽样':'精细人车'):'暂无样本',
      source:t?(t.mode==='test'?'验证人车流':'城市交通分配'):'—'};
  }
  function liveTrafficSummary(){
    const values=liveTrafficValues();
    const counts=[['vehicles','样本车辆','辆'],['pedestrians','样本行人','人'],['waiting','等待车辆','辆'],['pedestrianWaiting','等灯行人','人'],['passed','样本通过','辆次']];
    return `<div class="live-traffic-summary"><dl class="live-traffic-counts">${counts.map(([key,label,unit])=>`<div><dt>${label}</dt><dd><strong data-live-traffic="${key}">${values[key]}</strong><small>${unit}</small></dd></div>`).join('')}</dl><p class="live-traffic-source">模拟精度：<span data-live-traffic="sampling">${values.sampling}</span><span>交通来源：<span data-live-traffic="source">${values.source}</span></span></p><p class="live-traffic-note">当前人车样本含公交 <span data-live-traffic="buses">${values.buses}</span> 辆；通过数为累计过路口辆次，重新生成样本后清零。</p></div>`;
  }

  function updateTrafficDetails(){
    const values=liveTrafficValues();
    document.querySelectorAll('[data-live-traffic]').forEach(node=>{const value=values[node.dataset.liveTraffic];if(node.textContent!==value)node.textContent=value;});
    const card=document.querySelector('[data-overview-card="liveTraffic"]');
    if(card){card.querySelector('strong').textContent=trafficState?`${values.vehicles} 辆车 · ${values.pedestrians} 位行人`:'暂无样本';card.querySelector('small').textContent=`${values.sampling} · ${values.source}`;}
    const phaseNode=el('junction-phase');if(!phaseNode)return;
    const junction=state.network.junctions.find(j=>j.id===selected);
    const signal=trafficState?.signals?.find(s=>s.id===selected);
    const names={green:'绿灯放行',yellow:'黄灯过渡',clearance:'全红清空',pedestrian:'行人放行'};
    phaseNode.textContent=signal?(names[signal.phase]||'未知相位'):junction?.signal?'暂无信号样本':'无信号灯控制';
    el('junction-countdown').textContent=Number.isFinite(signal?.remaining)?`${Math.ceil(signal.remaining)} 秒后切换`:'—';
    el('junction-signal-dot').className='signal-dot '+(signal?.phase||'unknown');
  }
  function setTool(next) {
    if(working)return;
    if(next==='line'&&el('city-mode').value==='bus'&&!busReady()){status('请先建造并连接公交车总站',true);return;}
    clearBusPreview();
    clearTimeout(specialTimer);specialTicket++;specialPreview=null;
    pause();toolDrafts.set(tool,{draft:draft.map(cloneDraftPoint),lineStops:[...lineStops],editingRoad,editingLine,shape:el('city-shape').value,level:el('city-level').value,oneway:el('city-oneway').checked});
    tool=next;const saved=toolDrafts.get(next);draft=saved?.draft.map(cloneDraftPoint)||[];lineStops=saved?.lineStops.slice()||[];editingRoad=saved?.editingRoad||null;editingLine=saved?.editingLine||null;sourceParcel=null;inspectedRoute=null;preview=null;dragControl=null;
    if(saved){el('city-shape').value=saved.shape;el('city-level').value=saved.level;el('city-oneway').checked=saved.oneway;}
    document.querySelectorAll('[data-tool]').forEach(b=>{b.classList.toggle('active',b.dataset.tool===tool);b.setAttribute('aria-pressed',String(b.dataset.tool===tool));});
    canvas.classList.toggle('city-drawing',tool!=='pan'&&tool!=='select');
    el('city-special-controls').hidden=!specialTools.includes(tool);
    el('city-special-rotation').disabled=el('city-special-rotate').disabled=tool==='train_station';
    if(el('measure').getAttribute('aria-pressed')==='true') el('measure').click();
    // Tools and their drafts only affect the live overlay. Invalidating the
    // static base here briefly replaces finished textures with preview tiles.
    schedulePreview();scheduleBusPreview();if(specialTools.includes(tool)&&hover)scheduleSpecialPreview();updateHint();workspace.requestAnimation();
  }
  function updateHint() {
    const names=state?.meta.roadTypes;
    let hint='点击建筑、道路或站点查看详情 · 空格拖动平移';
    if(names?.[tool])hint=`绘制${names[tool].name} · 点击加点，拖动圆点调整 · 双击 / Enter 完成 · Backspace 撤回一点`;
    if(tool==='stop')hint='点击兼容的道路或轨道放置站点';
    if(tool==='line')hint=busDraft()?'沿道路两侧吸附选站 · 按点击顺序连接 · 至少两站后 Enter 创建 · Backspace 撤回':'按行驶顺序点击站点，然后开通线路';
    if(busDraft()&&busPreview?.valid===false)hint=busPreview.reason+' · Backspace 撤回站点';
    if(tool==='delete')hint='点击对象拆除 · 可在推进模拟前撤销';
    if(tool==='route')hint=sourceParcel?'选择目的地块':'选择起点地块，查看实际可行旅程';
    if(['park','plaza','school','clinic'].includes(tool))hint='点击陆地放置公共服务设施';
    if(tool==='renewal')hint='点击地块切换选中；选一块预览整个街区，选多块只更新选区';
    if(tool==='area')hint='依次点击统计范围的两个对角点';
    if(tool==='isochrone')hint='点击建筑、地块或站点，查看实际网络可达范围';
    if(tool==='pan')hint='拖动地图平移 · 滚轮缩放';
    if(tool==='gateway')hint='点击道路节点设置对外货运门户';
    if(specialTools.includes(tool))hint=`放置${facilityNames[tool]} · 点击建造${tool==='train_station'?' · 自动沿铁路对齐':' · R 旋转'} · Esc 退出`;
    const roadError=names?.[tool]&&draft.length>=2&&preview?.valid===false;
    updateRoadValidation();
    if(roadError)hint=`无法建造：${preview.reason} · 拖动圆点调整，或 Backspace 撤回一点`;
    else if(names?.[tool]&&preview?.road?.terrainAdjusted)hint='已自动绕坡 · 橙线为实际建设路线 · Enter 确认，拖动圆点调整';
    el('city-hint').textContent=hint;
    el('city-hint').classList.toggle('error',!!roadError);
    const geometry=preview?.valid?preview.road.points:window.CityGeometry.curvePoints(draft,el('city-shape').value==='curve');
    const distance=geometry.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-geometry[i][0],p[1]-geometry[i][1]),0);
    el('city-draft-info').textContent=draft.length?`${draft.length} 个控制点 · ${fmt(distance)} m${preview?(preview.valid?` · ${preview.road.terrainAdjusted?'已自动绕坡 · ':''}预计 ${fmt(preview.road.constructionCost+(preview.clearance?.cost||0))} 币 · ${preview.connections} 处连接${preview.clearance&&(preview.clearance.buildings||preview.clearance.facilities)?` · 自动拆除 ${preview.clearance.buildings} 栋建筑 / ${preview.clearance.facilities} 处设施，安置 ${preview.clearance.households} 户`:''}`:` · ${preview.reason}`):draft.length<2?' · 请点击终点':' · 正在检查地形与连接'}${editingRoad?' · 拖动控制点调整':''}`:'靠近道路自动吸附，逐点绘制，Enter 完成，Esc 取消。按住空格拖动地图。';
    el('city-draft-info').classList.toggle('error',!!roadError);
    el('city-stop-order').textContent=lineStops.length?lineStops.map((id,i)=>typeof id==='string'?state.stops.find(s=>s.id===id)?.name||id:`第 ${i+1} 站`).join(' → '):'尚未选择站点';
    el('city-create-line').disabled=working||lineStops.length<2;
    window.dispatchEvent(new Event('city-tool-change'));
  }
  function updateRoadValidation(g=workspace.geometry) {
    const popup=el('road-validation');
    popup.hidden=!(active&&state?.meta.roadTypes[tool]&&draft.length>=2&&preview?.valid===false);
    if(popup.hidden)return;
    const reason=preview.reason||'当前位置不满足建造条件，请调整路线后重试。';
    if(el('road-validation-reason').textContent!==reason)el('road-validation-reason').textContent=reason;
    const rect=canvas.getBoundingClientRect(),t=workspace.terrain,point=preview.point||draft.at(-1);
    const x=rect.left+g.left+point[0]*t.width*g.scale/state.meta.width;
    const y=rect.top+g.top+point[1]*t.height*g.scale/state.meta.height;
    const pad=12,rail=document.querySelector('.workspace-rail');
    const leftEdge=rail?.getClientRects().length?Math.max(rect.left+pad,rail.getBoundingClientRect().right+pad):rect.left+pad;
    popup.style.width=`${Math.min(310,Math.max(1,rect.right-pad-leftEdge))}px`;
    const width=popup.offsetWidth,height=popup.offsetHeight;
    const left=Math.max(leftEdge,Math.min(x+22,rect.right-width-pad));
    let topEdge=rect.top+pad,bottomEdge=rect.bottom-pad;
    // Keep the reason above the construction palette and below map controls.
    for(const selector of ['.city-controlbar','#workspace-build-menu','.workspace-dock']){
      const node=document.querySelector(selector);
      if(!node||!node.getClientRects().length)continue;
      const box=node.getBoundingClientRect();
      if(left+width<=box.left||left>=box.right)continue;
      if(selector==='.city-controlbar'&&!node.closest('.workspace-status-tray'))topEdge=Math.max(topEdge,box.bottom+pad);
      else bottomEdge=Math.min(bottomEdge,box.top-pad);
    }
    const top=Math.max(topEdge,Math.min(y-height-18,bottomEdge-height));
    popup.style.left=`${left}px`;popup.style.top=`${top}px`;
  }
  function showPanel(next) {
    panel=next;
    ['build','transit','data'].forEach(p=>el(`city-${p}-panel`).hidden=p!==next);
    document.querySelectorAll('[data-panel]').forEach(b=>b.classList.toggle('active',b.dataset.panel===next));
    window.dispatchEvent(new CustomEvent('city-panel-change',{detail:next}));
    workspace.requestAnimation();
  }
  function render() {
    if(!state)return;
    const s=state.stats;
    taxiPanel.render(state);
    trafficState=state.liveTraffic||null;
    if(trafficPlayback.latest!==trafficState){trafficPlayback.reset(trafficState);trafficPlayback.setPaused(!simulation.running);}
    el('signal-green').value=state.policy.signalGreenSeconds;el('signal-yellow').value=state.policy.signalYellowSeconds;el('signal-clearance').value=state.policy.signalClearanceSeconds;
    updateTraffic();
    el('city-name').textContent=state.name;
    updateSimulationControls();
    el('ck-pop').textContent=fmt(s.population);
    el('ck-pop-sub').textContent=`今日迁入 ${fmt(s.movedIn)} · 迁出 ${fmt(s.movedOut)}`;
    if(el('ck-treasury')){
      el('ck-treasury').textContent=fmt(s.treasury);
      el('ck-treasury-sub').textContent=`日收入 ${fmt(s.revenue)} 币`;
    }
    el('ck-jobs').textContent=`${fmt(s.employed)} / ${fmt(s.jobs)}`;
    el('ck-jobs-sub').textContent=`失业率 ${fmt(s.unemployment,1)}%`;
    el('ck-land').textContent=fmt(s.landValue);
    el('ck-time').textContent=s.commute==null?'—':`${fmt(s.commute,1)} min`;
    el('ck-time-sub').textContent='单程平均 · 查看详情';
    el('city-undo').disabled=!state.canUndo;el('city-redo').disabled=!state.canRedo;
    el('city-object-picker').innerHTML='<option value="">选择城市对象</option>'+[...state.roads,...state.stops,...state.lines,...state.facilities,...state.parcels,...state.districts].map(o=>`<option value="${escape(o.id)}">${escape(o.building?.name||o.name||useNames[o.building?.use]||o.kind||'地块')} · ${escape(o.id)}</option>`).join('');
    el('map-name').textContent=state.name;el('map-number').textContent=`${date(state.month)}`;
    el('city-line-list').innerHTML=state.lines.length?state.lines.map(l=>`<button class="city-list-item" data-line="${escape(l.id)}"><b><span class="tm-list-swatch" data-line-color="${escape(l.color)}"></span>${escape(l.name)} · ${modeNames[l.mode]}</b><small>${fmt(l.boardings)} 上车人次 / 典型日<br>${l.valid?`每 ${fmt(l.serviceHeadway??l.headway,1)} 分钟 · ${fmt(l.fleet)} 辆车`:`${escape(l.reason)}`}</small></button>`).join(''):'<p class="city-note">先设置至少两个站点，再创建运营线路。</p>';
    el('city-line-list').querySelectorAll('[data-line-color]').forEach(node=>node.style.backgroundColor=/^#[\da-f]{6}$/i.test(node.dataset.lineColor)?node.dataset.lineColor:'#397e76');
    el('city-line-list').querySelectorAll('[data-line]').forEach(b=>b.onclick=()=>state.lines.find(l=>l.id===b.dataset.line)?.mode==='bus'&&window.CityTransitManagement?CityTransitManagement.open(b.dataset.line):inspect(b.dataset.line));
    for(const [id,external] of [['city-freight-start',false],['city-freight-end',true]])el(id).innerHTML=state.stops.filter(s=>s.role==='freight'&&!!s.external===external).map(s=>`<option value="${escape(s.id)}">${escape(saveLabel(s))}</option>`).join('');
    el('city-freight-list').innerHTML=(state.regionalServices||[]).map(f=>`<div class="city-note"><b>${escape(f.name)}</b> · ${f.valid?fmt(f.tonnes)+' / '+fmt(f.dailyCapacity)+' 吨/日':escape(f.reason)}<br>${fmt(f.operatingCost)} 币/月 <button class="city-btn" data-freight-toggle="${escape(f.id)}">${f.enabled?'停运':'恢复'}</button><button class="city-btn" data-freight-delete="${escape(f.id)}">删除</button></div>`).join('');
    el('city-freight-list').querySelectorAll('[data-freight-toggle]').forEach(b=>b.onclick=()=>command({type:'freight_update',id:b.dataset.freightToggle,enabled:!state.regionalServices.find(f=>f.id===b.dataset.freightToggle).enabled}));
    el('city-freight-list').querySelectorAll('[data-freight-delete]').forEach(b=>b.onclick=()=>command({type:'delete',id:b.dataset.freightDelete}));
    if(busDraft())scheduleBusPreview();
    el('city-auto-renew').checked=state.settings.autoRenew!==false;renderRenewals();renderLegend(); renderInspector(); updateHint(); workspace.requestDraw();
  }
  function renderLegend() {
    let html=Object.entries(colors).map(([k,color])=>`<span><i data-swatch="${color}"></i>${useNames[k]}</span>`).join('');
    if(layer==='use'&&window.CityScene.effectiveQuality==='map')html=[['#eeede7','建筑'],['#faf0d9','商业用地'],['#cce5ae','公园绿地'],['#d1d2d3','主干道'],['#9ed9ed','水域']].map(([color,name])=>`<span><i data-swatch="${color}"></i>${name}</span>`).join('');
    if(layer==='land')html='<span>土地估值 · 模拟币 / m²</span><span>浅色低价 → 深色高价</span>';
    if(layer==='rent')html='<span>空间租金 · 币 / m² / 月</span><span>浅色低 → 深色高</span>';
    if(layer==='access')html='<span>30 分钟可达岗位 · 网络时间</span><span>浅色少 → 深色多</span>';
    if(layer==='traffic')html=`<span>典型工作日 · ${trafficMetrics.periods[trafficPeriod]} · ${trafficPeriod==='off'?'辆/抽样时段':'辆/小时'}</span><span>${trafficPeriod==='off'?'浅蓝 → 深蓝：相对车流量；不计算饱和度':'绿 ≤60% · 橙 60%–100% · 红 >100%（流量/有效容量）'}</span>`;
    if(layer==='flows')html='<span>典型工作日旅程抽样 · 最多显示 250 条</span><span>蓝色公交 · 金色驾车 · 绿色步行</span>';
    if(layer==='vacancy')html='<span>建筑空间使用率</span><span>浅色空置 → 深色使用</span>';
    if(layer==='population')html='<span>家庭入住人数 · 浅色少 → 深色多</span>';
    if(layer==='jobs')html='<span>实际设立岗位 · 浅色少 → 深色多</span>';
    if(layer==='pollution')html='<span>环境压力指数 0–1 · 非物理浓度</span>';
    if(layer==='districts')html='<span>功能城区 · 连通空间聚类 · 标签含三个月惯性</span>';
    if(layer==='flows')html='<span>远景汇总通勤 · 近景抽样轨迹 · 虚线为当月迁移（外部采用抽象门户）</span>';
    const legends={slope:'地块平均坡度 · %',cost:'地形工程成本倍数 · 1–3',landscape:'景观品质指数 · 0–1',risk:'低海拔邻水指数 · 非洪水概率',height:'建筑高度 · m',change:'土地月涨跌幅 · %',development:'浅色未开发 · 金色施工 · 绿色使用 · 灰色空置',comparison:'当前方案减对照 · 土地币/m² · 蓝色降低 / 金色升高'};
    if(legends[layer])html='<span>'+legends[layer]+'</span>';
    if(['use','development','districts','height'].includes(layer))html+='<span>绿色半透明虚线 · 待开工住宅</span>';
    if(layer==='transit')html='<span>运营线路 · 实线有效 · 虚线未运营轨道</span><span>圆点为站点</span>';
    const trafficView=trafficMetrics.views[layer];
    if(trafficView)html=`<span>${trafficView.label}${trafficView.unit?' · '+trafficView.unit:''}</span><span>${trafficView.legend}</span>`;
    el('city-legend').innerHTML=html;
    el('city-traffic-controls').hidden=layer!=='traffic'&&!trafficView;
    const periodControl=el('city-traffic-period');
    periodControl.closest('label').hidden=layer!=='traffic'&&!trafficView?.period;
    periodControl.querySelector('[value="off"]').disabled=!!trafficView?.period;
    if(trafficView?.period&&trafficPeriod==='off'){trafficPeriod='peak';periodControl.value=trafficPeriod;}
    el('city-traffic-note').textContent=trafficView?`${trafficView.label}${trafficView.period?' · '+trafficMetrics.periods[trafficPeriod]:''}。${trafficView.legend}灰色表示暂无数据。${trafficMetrics.availability(state,layer)}点选对象查看明细。`:`典型工作日 · ${trafficMetrics.periods[trafficPeriod]}。${trafficPeriod==='off'?'车辆数为活动抽样；浅蓝到深蓝表示相对车流，不计算饱和度。':'地图数字为辆/小时；绿 ≤60%、橙 60%–100%、红 >100% 为流量/有效容量。'}灰色表示暂无数据。点选道路查看分时明细。`;
    el('city-legend').querySelectorAll('[data-swatch]').forEach(node=>node.style.setProperty('--swatch',node.dataset.swatch));
  }
  function details(rows) { return `<dl class="city-details">${rows.map(([a,b])=>`<dt>${escape(a)}</dt><dd>${escape(b)}</dd>`).join('')}</dl>`; }
  function roadTrafficDetails(edges,cfg){
    if(!cfg.capacity)return '<p class="city-note">此设施不承载机动车流量。</p>';
    const peak=trafficMetrics.summarize(edges,'peak');
    const performance=edges.map(e=>trafficMetrics.performance(e,cfg));
    const range=(key,min=false)=>{const values=performance.map(p=>p[key]).filter(v=>v!=null);return values.length?(min?Math.min(...values):Math.max(...values)):null;};
    const performanceDetails=details([['最慢路段预计速度',fmt(range('speed',true),1)+' km/h'],['最大路段延误',fmt(range('delay'),1)+' 秒'],['最小路段有效容量',fmt(range('capacity',true),1)+' 辆/h']]);
    const rows=['am','off','pm'].map(period=>{
      const value=trafficMetrics.summarize(edges,period);
      const condition=period==='off'?'活动抽样':trafficMetrics.status(value.ratio);
      return `<tr><th scope="row">${trafficMetrics.periods[period]}</th><td>${fmt(value.vehicles,1)}</td><td>${fmt(value.hourly,1)}</td><td>${value.ratio==null?'—':fmt(value.ratio*100,1)+'%'}</td><td>${condition}</td></tr>`;
    }).join('');
    return `<h3>车流与拥挤度</h3>${performanceDetails}${details([['高峰饱和度',peak.ratio==null?'—':fmt(peak.ratio*100,1)+'% · '+trafficMetrics.status(peak.ratio)]])}<div class="city-table-wrap traffic-period-table"><table class="city-table"><thead><tr><th>时段</th><th>车辆数</th><th>辆/h</th><th>饱和度</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table></div><p class="city-note">典型工作日的最近一次交通分配，随日结算或重新分配更新。每列取此道路各路段的最大值，不将沿线路段重复相加。饱和度 = 小时车流 / 有效容量，容量考虑地形和信号。平峰仅记录活动抽样，未折算小时流量；“—”表示暂无数据。旧存档在重新分配后补齐时段明细。</p>`;
  }
  function renderInspector() {
    const box=el('city-inspector'), s=state.stats;
    const close='<button class="city-btn" id="city-close-inspector" aria-label="关闭详情">×</button>';
    if(selected) {
      selected=window.CityGeometry.inspectionId(state,selected);
      const p=state.parcels.find(p=>p.id===selected);
      const line=state.lines.find(l=>l.id===selected);
      const stop=state.stops.find(s=>s.id===selected);
      const road=state.roads.find(r=>r.id===selected);
      const facility=state.facilities.find(f=>f.id===selected);
      const district=state.districts.find(d=>d.id===selected);
      const junction=state.network.junctions.find(j=>j.id===selected);
      if(junction){
        const roads=[...new Set(junction.approaches.map(a=>a.road))].map(id=>state.roads.find(r=>r.id===id)?.name||id);
        box.innerHTML=`<h2>路口详情${close}</h2><p>${escape(roads.join(' × '))}</p><div class="junction-signal-heading"><span id="junction-signal-dot" class="signal-dot unknown" aria-hidden="true"></span><div><strong id="junction-phase"></strong><p id="junction-countdown"></p></div></div><p class="city-note">显示此路口当前相位；绿灯仅对应当前放行方向。</p>`;
        updateTrafficDetails();
      } else if(p) {
        const b=p.building;
        box.innerHTML=`<h2>${escape(b?.name||(b?b.landmark==='cbd_skyscraper'?'CBD 摩天楼':useNames[b.use]:p.openSpace?'公共配套用地':'待开发地块'))}${close}</h2>
        ${!b&&!p.openSpace?'<h3>最近日度评估 · 未开发原因</h3>':''}<p>${escape(!b?(p.developmentReason||p.reason||'等待下次日结算评估开发条件'):(p.reason||'等待城市发展'))}</p>${!b&&!p.openSpace?'<p>每日评估新项目，按计划日期逐栋开工；中等坡地优先建设小体量低层建筑，超过 45% 的陡坡不开发。</p>':''}${details([
          ['地块面积',`${fmt(p.area)} m²`],['地形高程',`${fmt(p.terrain?.elevation,1)} m`],['平均坡度',`${fmt((p.terrain?.slope||0)*100,1)}%`],['基础工程成本',`×${fmt(p.terrain?.costFactor,2)}`],['距水体',`${fmt(p.terrain?.waterDistance)} m`],['景观品质指数',fmt(p.terrain?.scenic,2)],['低地邻水指数',fmt(p.terrain?.lowland,2)],['可达空缺岗位',fmt(p.vacantJobs)],['土地单价',`${fmt(p.landValue)} 币/m²`],
          ['租金',`${fmt(p.rent,1)} 币/m²/月`],['网络接入',p.connected?'已接入':'失去接入'],
          ...(p.localBusinessDemand?Object.entries(p.localBusinessDemand).map(([use,gap])=>['本地'+useNames[use]+'空间缺口',fmt(gap,1)+' 岗位容量']):[]),
          ...(p.block?[
            ['街区名称',p.blockName],
            ['街区布局',({single:'整街区用地',pair:'双建筑院落',cluster:'多建筑院落',frontage:'连续沿街地块',court:'围合庭院',mews:'巷道街区',garden:'侧园组团'})[p.blockLayout]||p.blockLayout],
            ['此处用途',p.blockCommon?'共享小路与'+(p.commonKind==='park'?'口袋公园':'院落广场'):'建筑或配套用地'],
            ['街区已建 / 建筑用地',`${state.parcels.filter(q=>q.block===p.block&&q.building).length} / ${p.blockBuildings}`]
          ]:[]),
          ['30 分钟可达岗位',fmt(p.accessJobs)],['公交可达岗位',fmt(p.publicJobs)],['货运门户时间',p.freightTime==null?'不可达':`${fmt(p.freightTime,1)} min`],
          ...(b?[['状态',statusNames[b.status]],...(b.startDate?[['开工日期',b.startDate],['预计竣工',b.completionDate],['施工进度',fmt((b.constructionProgress||0)*100,1)+'%']]:[]),...(b.extensionCompletionDay!=null?[['加层进度',fmt((b.extensionProgress||0)*100,1)+'%'],['加层竣工日',new Date(Date.UTC(2026,0,1+b.extensionCompletionDay)).toISOString().slice(0,10)]]:[]),['形态',({villa:'低层住宅',slab:'多层住宅',tower:'高层建筑',office:'办公楼',retail:'商铺',factory:'厂房',warehouse:'仓库'})[b.form]||useNames[b.use]],['楼层',fmt(b.floors)],['高度',`${fmt(b.height||b.floors*3.3,1)} m`],['建筑占地',`${fmt(b.footprintArea??b.floorArea/b.floors)} m²`],['总建筑面积',`${fmt(b.floorArea)} m²`],
            [b.use==='residential'?'入住家庭 / 容量':'就业 / 空间容量',`${fmt(b.occupied)} / ${fmt(b.capacity)}`],
            ['建筑年龄',`${fmt(b.age)} 个月`],['建筑状况',`${fmt(b.condition??100,1)} / 100`],['物业估值',`${fmt(b.propertyValue)} 币`]]:[])])}
        <h3>通勤记录</h3>${details([['已完成通勤平均时间',fmt(trafficMetrics.commutes(state).get(p.id)?.mean,1)+' 分钟'],['有通勤记录的家庭',fmt(trafficMetrics.commutes(state).get(p.id)?.count||0)],['通勤失败家庭',fmt(trafficMetrics.commutes(state).get(p.id)?.failed||0)]])}<p class="city-note">最近典型工作日的家庭通勤记录；无记录时显示 —，不将失败旅程计为 0 分钟。</p>
        <h3>规划用途偏好</h3><select class="city-field" id="city-zone"><option value="auto">自动选择</option>${p.blockCommon?'':Object.entries(useNames).map(([k,n])=>`<option value="${k}">${n}</option>`).join('')}<option value="protected">保护，不开发</option></select>
        <div class="city-row"><button class="city-btn" id="city-zone-apply">应用偏好</button><button class="city-btn" id="city-route-from">从这里出发</button></div>
        ${b?'<button class="city-btn" id="city-renovate-building">翻新建筑</button>':''}${b?'<button class="city-btn" id="city-rebuild-onsite">原址重建</button>':''}<button class="city-btn" id="city-renew-block">街区拆除重建</button>${p.renewalProject?'<button class="city-btn" id="city-inspect-renewal">查看更新项目</button>':''}
        ${b?'<button class="city-btn danger" id="city-delete-selected">拆除建筑</button>':''}
        <p>用途偏好影响后续开发，不会立即替换现有建筑。</p>
        <details><summary>地价驱动贡献 · 模拟币/m²</summary>${details(Object.entries(p.priceDrivers||{}).map(([k,v])=>[({base:'基准',accessibility:'交通可达',cluster:'集聚',demand:'需求',services:'服务',landscape:'景观',terrainCost:'地形工程',lowland:'低地约束',pollution:'污染',noise:'噪声',scarcity:'供给稀缺'})[k]||k,fmt(v,1)]))}</details><h3>地价与租金历史</h3><div class="city-table-wrap"><table class="city-table"><thead><tr><th>结算日期</th><th>地价</th><th>租金</th></tr></thead><tbody>${(p.history||[]).slice(-12).reverse().map(v=>`<tr><td>${v.date||date(v.month)}</td><td>${fmt(v.land)}</td><td>${fmt(v.rent,1)}</td></tr>`).join('')}</tbody></table></div>`;
        el('city-renew-block').onclick=()=>openRenewal(p.id);
        if(el('city-rebuild-onsite'))el('city-rebuild-onsite').onclick=()=>openRenewal(p.id,'onsite');
        if(el('city-renovate-building'))el('city-renovate-building').onclick=()=>openRenewal(p.id,'renovate');
        if(el('city-inspect-renewal'))el('city-inspect-renewal').onclick=()=>showRenewal(p.renewalProject);
        el('city-zone').value=p.use;
        el('city-zone-apply').onclick=()=>command({type:'zone',id:p.id,use:el('city-zone').value});
        el('city-route-from').onclick=()=>{setTool('route');sourceParcel=p.id;updateHint();};
      } else if(line) {
        box.innerHTML=`<h2>${escape(line.name)}${close}</h2><p>${line.valid?'线路正在服务城市':escape(line.reason)}</p>${details([
          ['方式',modeNames[line.mode]],['单程长度',`${fmt(line.length/1000,2)} km`],['往返周期',`${fmt(line.cycle,1)} min`],
          ['所需车队',`${fmt(line.fleet)} 辆`],['典型日上车人次',fmt(line.boardings)],['峰值载客率',`${fmt(line.load*100,1)}%`],
          ['客运周转量',`${fmt(line.passengerKm,1)} 人·km`],['月运营成本',`${fmt(line.operatingCost)} 币`]])}<h3>停站顺序</h3><p>${line.stops.map(id=>escape(state.stops.find(s=>s.id===id)?.name||'已删除站点')).join(' → ')}</p>${line.depot?`<p>所属总站：${escape(state.facilities.find(f=>f.id===line.depot)?.name||'总站已拆除')}</p>`:''}
          <div class="city-fields"><label>发车间隔 / 分钟<input class="city-field" id="edit-headway" type="number" min="2" max="120" value="${line.headway}"></label>
          <label>每车容量<input class="city-field" id="edit-capacity" type="number" min="10" max="2000" value="${line.capacity}"></label>
          <label>名称<input class="city-field" id="edit-line-name" value="${escape(line.name)}"></label><label>颜色<input class="city-field" id="edit-line-color" type="color" value="${line.color}"></label>
          <label>首班 / 小时<input class="city-field" id="edit-line-start" type="number" min="0" max="23" value="${line.startHour??6}"></label><label>运营小时<input class="city-field" id="edit-line-hours" type="number" min="4" max="24" value="${line.hours}"></label>
          <label>车辆限速 / km/h<input class="city-field" id="edit-line-speed" type="number" min="5" max="180" value="${line.speed||state.meta.transitTypes[line.mode].speed}"></label><label>停站 / 分钟<input class="city-field" id="edit-line-dwell" type="number" min="0.1" max="10" step="0.1" value="${line.dwell??0.6}"></label>
          <label><span><input id="edit-line-oneway" type="checkbox" ${line.oneway?'checked':''}> 单方向运营</span></label></div><button class="city-btn" id="line-reorder">重新选择停站顺序</button>
          <div class="city-row"><button class="city-btn" id="line-update">更新运营</button><button class="city-btn" id="line-toggle">${line.enabled?'暂停运营':'恢复运营'}</button></div>${line.breakPoints?.length?'<button class="city-btn" id="line-breakpoint">定位中断区间</button>':''}<button class="city-btn danger" id="city-delete-selected">删除线路</button>`;
        if(el('line-breakpoint'))el('line-breakpoint').onclick=()=>{workspace.focus(line.breakPoints[0],5);workspace.requestDraw();};
        el('line-update').onclick=()=>command({type:'line_update',id:line.id,headway:Number(el('edit-headway').value),capacity:Number(el('edit-capacity').value),name:el('edit-line-name').value,color:el('edit-line-color').value,startHour:Number(el('edit-line-start').value),hours:Number(el('edit-line-hours').value),speed:Number(el('edit-line-speed').value),dwell:Number(el('edit-line-dwell').value),oneway:el('edit-line-oneway').checked});
        el('line-reorder').onclick=()=>{el('city-mode').value=line.mode;showPanel('transit');setTool('line');editingLine=line.id;lineStops=[];el('city-line-name').value=line.name;el('city-headway').value=line.headway;el('city-capacity').value=line.capacity;el('city-hours').value=line.hours;el('city-mixed').checked=line.mixed;if(el('transit-oneway'))el('transit-oneway').checked=!!line.oneway;scheduleBusPreview();updateHint();status('重新点击站点，再按开通线路保存新顺序');};
        el('line-toggle').onclick=()=>command({type:'line_update',id:line.id,enabled:!line.enabled});
      } else if(stop) {
        box.innerHTML=`<h2>${escape(stop.name)}${close}</h2>${details([['交通方式',modeNames[stop.mode]],['设施角色',stop.role==='freight'?'铁路货场':'客运站'],['对外联系',stop.external?'区域边界门户':'城市内部'],['步行接入',stop.connected?'可步行到达':'缺少步行接入'],['上车人次',fmt(stop.boardings)],['下车人次',fmt(stop.alightings)]])}<p>运营服务和出入口连接共同决定此站的可达性。</p><button class="city-btn" id="stop-toggle">${stop.enabled===false?'开放站点':'关闭站点'}</button><button class="city-btn danger" id="city-delete-selected">删除站点</button>`;
        el('stop-toggle').onclick=()=>command({type:'stop_update',id:stop.id,enabled:stop.enabled===false});
      } else if(road) {
        const edges=state.network.edges.filter(e=>e.road===road.id),cfg=state.meta.roadTypes[road.kind];
        box.innerHTML=`<h2>${escape(road.name)}${close}</h2>${details([['长度',`${fmt(road.length)} m`],['形状',road.shape==='curve'?'曲线':'折线'],['来源',road.generated?'城市自动生成':'手动建设'],['累计爬升',`${fmt(road.profile?.ascent,1)} m`],['工程成本',`${fmt(road.constructionCost)} 币`],['层级',road.level<0?'地下':road.level>0?'高架 / 桥梁':'地面'],['方向',road.oneway?'单向':'双向'],['限速',`${state.meta.roadTypes[road.kind].speed} km/h`],['高峰车流',`${fmt(Math.max(0,...edges.map(e=>e.traffic)))} 辆/h`]])}
        ${roadTrafficDetails(edges,cfg)}
        ${roadKinds.includes(road.kind)?`${details([['道路等级',cfg.name],['道路宽度',cfg.width+' m'],['基准容量',cfg.capacity?fmt(cfg.capacity)+' 辆/h':'仅步行'],['沿街开发',['street','avenue','lane'].includes(road.kind)?'允许':'不直接开发']])}<div class="city-fields"><label>道路等级<select class="city-field" id="road-kind">${roadKinds.map(k=>`<option value="${k}">${state.meta.roadTypes[k].name}</option>`).join('')}</select></label><label><span><input type="checkbox" id="road-oneway"> 单向</span></label></div><button class="city-btn" id="road-update">更新道路</button><p>升级会自动拆除占路建筑并尝试安置住户与企业；没有合适住房的家庭迁出并登记等待迁回。改为快速路或高速公路会取消原有临街直接接入。高架交叉不会自动形成路口，需绘制连接路。</p>`:''}
        <button class="city-btn" id="road-edit-shape">调整道路控制点</button><p>拆除可能使建筑失去接入，或中断运营线路。</p><button class="city-btn danger" id="city-delete-selected">拆除设施</button>`;
        el('road-edit-shape').onclick=()=>{showPanel('build');setTool(road.kind);editingRoad=road.id;draft=(road.controls||road.points).map(p=>p.slice());for(const p of [draft[0],draft.at(-1)]){const c=road.connections?.find(c=>Math.hypot(c.point[0]-p[0],c.point[1]-p[1])<.05);if(c)snappedPoints.set(p,{road:c.road,junction:c.junction});}el('city-shape').value=road.shape||'polyline';el('city-level').value=road.level;el('city-oneway').checked=road.oneway;document.body.classList.remove('show-inspector');schedulePreview();updateHint();workspace.requestDraw();};
        if(el('road-kind')){el('road-kind').value=road.kind;el('road-oneway').checked=road.oneway;el('road-update').onclick=()=>command({type:'road_update',id:road.id,kind:el('road-kind').value,oneway:el('road-oneway').checked});}
      } else if(facility) {
        const transport=window.CitySpecialBuildings.names[facility.kind];
        const rows=[['类型',facilityNames[facility.kind]],['状态','已建成'],['来源',facility.blockCommon?'街区共享公共空间':facility.generated?'城市自动配套':'手动建设'],['道路接入',facility.connected?'已接入':'待连接道路']];
        if(facility.jobCapacity)rows.push(['岗位上限',fmt(facility.jobCapacity)],['开放岗位',fmt(facility.positions||0)],['已就业人数',fmt(facility.employees||0)],['空缺岗位',fmt(Math.max(0,(facility.positions||0)-(facility.employees||0)))]);
        if(transport){rows.push(['占地',`${fmt(facility.width)} × ${fmt(facility.depth)} m`],['建筑高度',`${fmt(facility.height,1)} m`],['建设费用',fmt(facility.cost)+' 币']);if(facility.parkingSpaces)rows.push(['停车位',fmt(facility.parkingSpaces)],['层数',fmt(facility.floors)]);if(facility.stop)rows.push(['铁路接入',facility.railConnected?'已接入':'待连接铁路'],['运营站点',state.stops.find(s=>s.id===facility.stop)?.name||'—']);}
        else rows.push(['服务容量',fmt(facility.capacity)],['典型日使用人数',fmt(facility.visits)]);
        if(facility.automaticCategory){rows.push(['选址依据',facility.generationReason],['月维护费',fmt(facility.maintenance)+' 币']);if(facility.capacity)rows.push(['服务容量',fmt(facility.capacity)],['典型日使用人数',fmt(facility.visits)]);if(facility.rooms)rows.push(['客房数',fmt(facility.rooms)]);if(facility.chargingSpaces)rows.push(['充电车位',fmt(facility.chargingSpaces)]);}
        const note=facility.automaticCategory?'自动选址并预留完整场地，数量随人口发展控制。':facility.kind==='train_station'?'已建立铁路客运站点，可在交通面板中加入运营线路。':facility.parkingSpaces?'随城市发展随机生成的停车设施。':transport?'位置与占地已保留，接入周边道路后可继续规划交通。':'公共服务改善可达居民的生活品质，计入城市维护成本。';
        box.innerHTML=`<h2>${escape(facility.name||facilityNames[facility.kind])}${close}</h2>${details(rows)}<p>${note}</p><button class="city-btn danger" id="city-delete-selected">拆除设施</button>`;
      } else if(district){box.innerHTML=`<h2>${escape(district.name||district.kind)}${close}</h2><p>连通建筑的用途与活动聚类；标签具有历史惯性。</p>${details([['区域类型',district.kind],['夜间人口',fmt(district.population)],['日间人口',fmt(district.dayPopulation)],['岗位',fmt(district.jobs)],['建筑',fmt(district.buildings)],['地价 P10 / 中位 / P90',`${fmt(district.landP10)} / ${fmt(district.landValue)} / ${fmt(district.landP90)}`],['外出 / 流入劳动者',`${fmt(district.outgoing)} / ${fmt(district.incoming)}`],['平均坡度',`${fmt(district.slope*100,1)}%`],['容积率',fmt(district.floorRatio,2)],['发展阶段',district.stage]])}<p>${escape(district.reason)}</p><p>出行主方式：${Object.entries(district.modeShare||{}).map(([k,v])=>modeNames[k]+' '+fmt(v,1)+'%').join('；')}</p>`;} else selected=null;
      if(selected){
        if(el('city-close-inspector'))el('city-close-inspector').onclick=()=>{selected=null;document.body.classList.remove('show-inspector');renderInspector();workspace.requestDraw();};
        if(el('city-delete-selected'))el('city-delete-selected').onclick=()=>command({type:'delete',id:selected});
        return;
      }
    }
    box.innerHTML=`<h2>城市观察${close}</h2>
      ${!s.buildings?`<p>尚无建筑：${!state.roads.length?'先铺设地面街道。':!state.parcels.length?'道路周边尚未形成可用地块，请在更平缓、远离水面的区域铺路。':'点击地块查看未开发原因；建筑项目每日评估、按具体日期开工。'}</p>`:''}
      ${details([['建筑 / 在建',`${fmt(s.buildings)} / ${fmt(s.construction)}`],['住房空置率',`${fmt(s.vacancy,1)}%`],['住宅租金中位数',`${fmt(s.rent,1)} 币/m²/月`],['住房收入比',`${fmt(s.burden,1)}%`],['住房与交通收入比',`${fmt(s.combinedBurden,1)}%`],['可达岗位均值',fmt(s.accessJobs)],['公交可达岗位',fmt(s.publicJobs)],['累计等待迁入',fmt(s.pendingHousing)+' 户'],...(state.housingDemand?[['今日潜在 / 实际迁入',fmt(state.migrationDemand?.potential)+' / '+fmt(state.migrationDemand?.admitted)+' 户'],['等待就业机会',fmt(state.housingDemand.waitingForJobs)+' 户'],['就业关联住房需求',fmt(state.housingDemand.linkedDemand)+' 户'],['空房 / 已承诺住房覆盖',fmt(state.housingDemand.availableCoverage)+' / '+fmt(state.housingDemand.committedCoverage)+' 户'],['区域未满足住房需求',fmt(state.housingDemand.shortage)+' 户'],['住房通勤范围',fmt(state.housingDemand.commuteMinutes)+' 分钟'],['今日计划 / 名额',fmt(state.housingDemand.started)+' / '+fmt(state.housingDemand.projectLimit)]]:[])])}
      ${(state.growthCenters||[]).some(c=>c.rank)?`<details><summary>发展中心 · ${state.growthCenters.length} 处</summary><p>人口与就业形成各处活力，交通联系影响跨区服务，主次随实际发展变化。</p>${state.growthCenters.slice().sort((a,b)=>a.rank-b.rank).map(c=>`<p><b>${c.rank===1?'主发展中心':'发展中心 '+c.rank}</b> · ${fmt(c.population)} 位居民 · ${fmt(c.employment)} 个就业家庭<br>位置 ${fmt(c.point[0])}，${fmt(c.point[1])}</p>`).join('')}</details>`:''}
      <h3>实时交通</h3>${liveTrafficSummary()}
      <h3>人口变化</h3><canvas id="city-pop-chart" class="city-chart" aria-label="日度常住人口趋势"></canvas><div class="city-chart-labels"><span>${state.dailyHistory?.[0]?.date||date(state.month)}</span><span>${date(state.month)}</span></div>
      <h3>出行方式 · 已完成旅程</h3><div class="city-bars">${['walk','car','taxi','public'].map(k=>`<div><div class="city-bar-label"><span>${modeNames[k]}</span><span>${s.completedTrips?fmt(s.modeShare[k],1)+'%':'—'}</span></div><div class="city-bar"><i data-percent="${s.modeShare[k]}"></i></div></div>`).join('')}</div>
      <p>${fmt(s.completedTrips)} 次完成 · ${fmt(s.failedTrips)} 次未完成<br>换乘按完整旅程归类，上车共 ${fmt(s.boardings)} 人次。</p>
      <h3>城市账目</h3>${details([['可用资金',`${fmt(s.treasury)} 币`],['日收入',`${fmt(s.revenue)} 币`],['日维护及运营',`${fmt(s.maintenance)} 币`],['道路 / 轨道',`${fmt(s.roadKm,1)} / ${fmt(s.railKm,1)} km`],['汽车排放估算',`${fmt(s.estimatedCO2,1)} kg/代表日`]])}
      ${baseline?`<h3>与基线比较</h3><p>基线 ${date(baseline.month)}；当前 ${date(state.month)}${baseline.month!==state.month?' · 时间不同，仅供观察变化':''}</p>${details([['人口变化',fmt(s.population-baseline.population)],['岗位变化',fmt(s.jobs-baseline.jobs)],['通勤变化',s.commute==null||baseline.commute==null?'—':`${fmt(s.commute-baseline.commute,1)} min`],['土地单价变化',s.landValue==null||baseline.landValue==null?'—':`${fmt(s.landValue-baseline.landValue,1)} 币/m²`]])}`:''}
      <h3>地形与自动生长</h3>${details([['自动支路',fmt(s.autoRoadKm,2)+' km'],['入口与院内小径',fmt(s.pathKm,2)+' km'],['公园 / 广场',fmt(s.parks)+' / '+fmt(s.plazas)],['公共开放空间',fmt(s.publicSpaceArea)+' m²'],['平均开发坡度',fmt(s.meanSlope,1)+'%'],['地形工程增量',fmt(s.terrainEngineeringCost)+' 币']])}<details><summary>完整统计与分布</summary>${details([['企业群组',fmt(s.firms)],['今日新增 / 关闭',fmt(s.firmOpened)+' / '+fmt(s.firmClosed)],['企业利润估算',fmt(s.firmProfit)+' 币/月'],['空缺岗位',fmt(s.vacantJobs)],['地价 P10 / P90',fmt(s.landP10)+' / '+fmt(s.landP90)],['建成区密度',fmt(s.builtDensity)+' 人/km²'],['容积率',fmt(s.floorRatio,2)],['通勤中位数',fmt(s.commuteMedian,1)+' min'],['公交完整旅程',fmt(s.publicJourneys)],['换乘次数',fmt(s.transfers)],['平均候车',fmt(s.meanWait,1)+' min'],['车辆行驶',fmt(s.vehicleKm,1)+' km/代表日'],['累计建设',fmt(s.constructionCost)+' 币'],['区域铁路客运',fmt(s.regionalPassengers)+' 人次/日'],['铁路货运',fmt(s.railFreightTonnes,1)+' 吨/日'],['未完成货运',fmt(s.unservedFreightTonnes,1)+' 吨/日']])}<p>楼层分布：${Object.entries(s.floorDistribution||{}).map(([k,v])=>k+' 层 '+v+' 栋').join('；')}</p><p>主方式：${Object.entries(s.mainModeShare||{}).map(([k,v])=>modeNames[k]+' '+fmt(v,1)+'%').join('；')}</p></details><h3>城区</h3>${state.districts.map(d=>`<button class="city-list-item" data-district="${escape(d.id)}"><b>${escape(d.name||d.kind)}</b><small>${fmt(d.population)} 人 · ${fmt(d.jobs)} 岗位</small></button>`).join('')}<h3>城市记事</h3>${state.events.length?state.events.slice(-7).reverse().map(e=>`<button class="city-list-item" data-event="${state.events.indexOf(e)}"><time>${e.date||date(e.month)} · ${escape(e.category)}</time><br>${escape(e.message)}</button>`).join(''):`<div class="city-onboard"><div><b>01 建立连接</b>绘制几条相连的街道，或生成示范街区。</div><div><b>02 让城市生长</b>推进月份，等待施工、入住与就业。</div><div><b>03 改善出行</b>设置站点并运营线路，观察需求和土地市场。</div></div>`}`;
    box.insertAdjacentHTML('beforeend',`<h3>分项账目</h3>${details(Object.entries(state.capitalAccounts||{}).map(([k,v])=>[k,fmt(v)+' 币（累计）']))}${details(Object.entries(state.operatingAccounts||{}).map(([k,v])=>[({roadMaintenance:'道路维护',stationMaintenance:'站点维护',facilityMaintenance:'设施维护',vehicleLease:'车辆租赁（含于运营）',transitOperation:'公交运营合计',tax:'税收',fares:'票款'})[k],fmt(v)+' 币/月']))}<details><summary>收入组与时段可达性</summary><p>代表日条件，按家庭等权汇总；机会数不保证空缺或有余量。车辆租赁已计入运营，不再次相加。</p>${(state.accessibilityGroups||[]).map(a=>`<p>${a.group} · ${{am:'早高峰',off:'平峰',pm:'晚高峰'}[a.period]} · ${a.minutes} 分钟：岗位 ${fmt(a.jobs)}，空缺 ${fmt(a.vacancies)}，服务容量 ${fmt(a.services)}</p>`).join('')}</details><p>交通分配：${state.trafficSolve?.converged?'末轮时间变化低于 1%':'有界轮次近似结果'}。${Object.entries(state.tripFailures||{}).map(([k,v])=>escape(k)+' '+fmt(v)+' 次').join('；')}</p><button class="city-btn" id="city-events-all">全部城市记事</button>`);
    box.querySelectorAll('[data-event]').forEach(button=>button.onclick=()=>locateEvent(Number(button.dataset.event)));
    el('city-events-all').onclick=()=>{dialog('<h2>城市记事</h2>'+state.events.slice().reverse().map(e=>`<button class="city-list-item" data-event="${state.events.indexOf(e)}"><b>${e.date||date(e.month)} · ${escape(e.category)}</b><br>${escape(e.message)}</button>`).join(''));el('city-dialog-body').querySelectorAll('[data-event]').forEach(button=>button.onclick=()=>{el('city-dialog').close();locateEvent(Number(button.dataset.event));});};
    el('city-close-inspector').onclick=()=>document.body.classList.remove('show-inspector');
    box.querySelectorAll('[data-percent]').forEach(node=>node.style.width=node.dataset.percent+'%');
    box.querySelectorAll('[data-district]').forEach(button=>button.onclick=()=>inspect(button.dataset.district));
    drawChart();
  }
  function drawChart() {
    const chart=el('city-pop-chart');if(!chart)return;
    const w=chart.clientWidth||230,h=100,dpr=window.devicePixelRatio||1;
    chart.width=w*dpr;chart.height=h*dpr;const c=chart.getContext('2d');c.scale(dpr,dpr);
    const values=(state.dailyHistory||[]).slice(-60).map(s=>s.population);if(!values.length)values.push(state.stats.population||0);
    const max=Math.max(10,...values);
    c.strokeStyle='#dfe7d9';c.lineWidth=1;
    for(let i=1;i<4;i++){c.beginPath();c.moveTo(12,15+i*18);c.lineTo(w-10,15+i*18);c.stroke();}
    c.beginPath();values.forEach((v,i)=>{const x=12+i/Math.max(1,values.length-1)*(w-24),y=82-v/max*65;i?c.lineTo(x,y):c.moveTo(x,y);});
    c.strokeStyle='#527b52';c.lineWidth=2;c.stroke();
    c.fillStyle='#466746';c.font='11px sans-serif';c.fillText(fmt(max)+' 人',12,13);
  }
  function locateEvent(index){const event=state.events[index];if(event?.point){workspace.focus(event.point,5);document.body.classList.remove('show-inspector');}status(event?.message||'城市事件');}
  function inspect(id) {
    selected=id;document.body.classList.add('show-inspector');renderInspector();workspace.requestDraw();
  }
  function inside(point, polygon) {
    let result=false;
    for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
      const a=polygon[i],b=polygon[j];
      if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])result=!result;
    }return result;
  }
  function distanceLine(point,points) {
    let best=Infinity;
    for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy||1)));best=Math.min(best,Math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dy));}
    return best;
  }
  function pick(point,only=null) {
    const g=workspace.geometry, tolerance=12/(workspace.terrain.width*g.scale/state.meta.width);
    if(!only&&tool==='select'){
      const junction=window.CityGeometry.junctionAt(state.network.junctions,point,workspace.terrain.width*g.scale/state.meta.width,workspace.terrain.height*g.scale/state.meta.height);
      if(junction)return junction;
    }
    if(!only&&tool==='select'&&window.CityScene.effectiveQuality==='map'){
      const sx=workspace.terrain.width*g.scale/state.meta.width,sy=workspace.terrain.height*g.scale/state.meta.height;
      const hit=mapHitLabels.find(l=>['poi','building'].includes(l.kind)&&point[0]*sx>=l.box[0]&&point[0]*sx<=l.box[2]&&point[1]*sy>=l.box[1]&&point[1]*sy<=l.box[3]);
      if(hit){const object=[...state.facilities,...state.stops,...state.parcels].find(o=>o.id===hit.id);if(object)return object;}
    }
    if(!only||only==='stop'){
      const s=state.stops.map(s=>[Math.hypot(s.point[0]-point[0],s.point[1]-point[1]),s]).sort((a,b)=>a[0]-b[0])[0];
      if(s&&s[0]<tolerance)return s[1];
    }
    if(!only){const facility=state.facilities.find(f=>f.points?inside(point,f.points):Math.hypot(f.point[0]-point[0],f.point[1]-point[1])<20);if(facility)return facility;
      if(layer==='districts'){const district=state.districts.find(d=>(d.polygons||[]).some(poly=>inside(point,poly)));if(district)return district;}}
    if(!only||only==='parcel'){
      const p=state.parcels.find(p=>inside(point,p.points));if(p)return only?p:window.CityGeometry.facilityForParcel(state,p)||p;
    }
    if(!only){
      const f=state.facilities.find(f=>Math.hypot(f.point[0]-point[0],f.point[1]-point[1])<Math.max(20,tolerance));if(f)return f;
      const r=state.roads.map(r=>[distanceLine(point,r.points),r]).sort((a,b)=>a[0]-b[0])[0];
      if(r&&r[0]<tolerance)return r[1];
    }return null;
  }
  function eventPoint(event) {
    const rect=canvas.getBoundingClientRect();
    return workspace.toWorld(event.clientX-rect.left,event.clientY-rect.top);
  }
  function magneticPoint(point){
    snapTarget=null;
    if(busDraft()&&!space){busSnap=point?busSnapAt(point):null;return point;}
    if(!point||!state?.meta.roadTypes[tool]||space)return point;
    const g=workspace.geometry,t=workspace.terrain;
    snapTarget=window.CityGeometry.roadSnap(point,state.roads,state.network.junctions,{kind:tool,
      level:Number(el('city-level').value),exclude:editingRoad,
      sx:t.width*g.scale/state.meta.width,sy:t.height*g.scale/state.meta.height});
    if(snapTarget?.road){
      const target=state.roads.find(r=>r.id===snapTarget.road);
      if(target&&target.level!==Number(el('city-level').value)){
        snapTarget.type='跨层 · 点击选择接入或平行';snappedPoints.set(snapTarget.point,{road:target.id,junction:'branch'});
      }
    }
    return snapTarget?.point||point;
  }
  function schedulePreview(){
    clearTimeout(previewTimer);preview=null;const ticket=++previewTicket;
    if(draft.length<2||!state.meta.roadTypes[tool])return;
    const command={points:draft.map(p=>p.slice()),id:editingRoad,shape:el('city-shape').value,snap:false,connections:roadConnections(),kind:tool,level:Number(el('city-level').value),oneway:el('city-oneway').checked,autoRoute:el('city-auto-route').checked};
    previewTimer=setTimeout(async()=>{try{const result=await api('preview',{command});if(ticket===previewTicket){preview=result;updateHint();workspace.requestAnimation();}}catch(error){if(ticket===previewTicket)status(error.message,true);}},180);
  }
  function specialCommand(point){return {type:'special_building',kind:tool,point,name:el('city-special-name').value,size:el('city-special-size').value,rotation:Number(el('city-special-rotation').value)};}
  function specialFootprint(point){
    const cfg=state.meta.specialBuildings?.[tool];if(!cfg||!point)return null;
    const m={compact:.7,standard:1,large:1.3}[el('city-special-size').value],w=cfg.width*m,d=cfg.depth*m;
    const f={kind:tool,origin:point,point,rotation:Number(el('city-special-rotation').value)||0,width:w,depth:d};
    f.points=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([x,y])=>window.CitySpecialBuildings.world(f,x,y));return f;
  }
  function scheduleSpecialPreview(){
    clearTimeout(specialTimer);const ticket=++specialTicket;specialPreview=null;
    if(!hover||!specialTools.includes(tool))return;
    const cmd=specialCommand(hover.slice());
    el('city-special-hint').textContent=tool==='port'?'陆侧堆场留在岸上，海侧朝向水面。正在检查位置…':tool==='train_station'?'站台自动对齐铁路。正在检查位置…':'正在检查占地与地形…';
    specialTimer=setTimeout(async()=>{try{const result=await api('special_preview',{command:cmd});if(ticket!==specialTicket)return;specialPreview=result;el('city-special-hint').textContent=result.valid?`可放置 · ${fmt(result.facility.width)} × ${fmt(result.facility.depth)} m · ${fmt(result.facility.cost)} 币`:result.reason;workspace.requestAnimation();}catch(error){if(ticket===specialTicket)el('city-special-hint').textContent=error.message;}},160);
  }
  async function runQuery(params){
    pause();await task(async()=>{queryResult=await api('query',params);workspace.requestDraw();
      const s=queryResult.stats;dialog(`<h2>${params.kind==='area'?'范围统计':'网络可达范围'}</h2><p>${escape(queryResult.rule)} · ${date(queryResult.month)}</p>${details([['常住人口',fmt(s.population)],['日间人口',fmt(s.dayPopulation)],['岗位',fmt(s.jobs)],['建筑',fmt(s.buildings)],['土地面积',fmt(s.area)+' m²'],['总建筑面积',fmt(s.floorArea)+' m²'],['容积率',fmt(s.floorRatio,2)],['地价中位数',fmt(s.landValue)+' 币/m²'],['地价 P10 / P90',fmt(s.landP10)+' / '+fmt(s.landP90)]])}<p>蓝色轮廓显示纳入统计的地块。等时范围使用实际网络、候车与接驳时间，不跨越无连接水体。</p>`);
    });
  }
  async function compareSaves(){
    pause();await task(async()=>{const data=await api('saves');dialog(`<h2>选择对照存档</h2><p>保持当前城市，读取另一方案的同一时点指标。</p>${data.saves.map((s,i)=>`<button class="city-list-item" data-compare="${i}"><b>${escape(saveLabel(s))}</b></button>`).join('')||'<p>先保存另一方案。</p>'}`);
      el('city-dialog-body').querySelectorAll('[data-compare]').forEach(button=>button.onclick=()=>task(async()=>{
        comparison=await api('compare',{name:data.saves[Number(button.dataset.compare)].name});
        const labels={population:'人口',housing:'住房容量',jobs:'岗位',employed:'就业',commute:'平均通勤 / 分钟',commuteP90:'通勤 P90',accessJobs:'可达岗位',boardings:'公交上车人次',landValue:'地价 / 币/m²',rent:'租金 / 币/m²/月',vacancy:'空置率 / %',treasury:'资金 / 币',maintenance:'日维护运营 / 币',constructionCost:'累计建设成本 / 币'};
        dialog(`<h2>方案比较</h2><p>${escape(comparison.current.name)}（${date(comparison.current.month)}）减去 ${escape(comparison.reference.name)}（${date(comparison.reference.month)}）</p><p>${comparison.warnings.map(escape).join('；')||'共同检查点、模型与期限一致'}</p>${details(Object.entries(comparison.deltas).map(([k,v])=>[labels[k]||k,fmt(v,2)]))}<p>切换“方案地价差异”图层，可定位共同地块的变化。正值表示当前方案更高，不代表一定更好。</p>`);layer='comparison';el('city-layer').value=layer;renderLegend();workspace.requestDraw();
      }));
    });
  }

  async function finish() {
    if(working)return;
    if(draft.length<2){status('请至少添加两个控制点');return;}
    const points=draft.map(p=>[...p]);
    const cmd={type:editingRoad?'road_edit':'road',id:editingRoad,points,shape:el('city-shape').value,snap:false,connections:roadConnections(),kind:tool,level:Number(el('city-level').value),oneway:el('city-oneway').checked,autoRoute:el('city-auto-route').checked};
    clearTimeout(previewTimer);const ticket=++previewTicket;
    try {
      const result=preview||await api('preview',{command:cmd});
      if(ticket!==previewTicket)return;
      preview=result;updateHint();workspace.requestDraw();
      if(!result.valid){status(result.reason,true);return;}
    } catch(error){if(ticket===previewTicket)status(error.message,true);return;}
    const ok=await command(cmd);
    if(ok){clearTimeout(previewTimer);previewTicket++;draft=[];editingRoad=null;preview=null;toolDrafts.delete(tool);}
    updateHint();workspace.requestDraw();
  }
  function handlePoint(point,event=null){
    if(specialTools.includes(tool)){const cmd=specialCommand(point);command(cmd).then(ok=>{if(ok){specialPreview=null;scheduleSpecialPreview();}});return;}
    if(tool==='renewal'){const p=pick(point,'parcel');if(p){renewalSelection=renewalSelection.includes(p.id)?renewalSelection.filter(id=>id!==p.id):[...renewalSelection,p.id];renewalPreview=null;renderRenewals();workspace.requestDraw();}return;}
    if(tool==='gateway'){command({type:'gateway',point});return;}
    if(state.meta.roadTypes[tool]){
      if(event){
        const g=workspace.geometry,t=workspace.terrain;
        const index=window.CityGeometry.roadControlAt(draft,point,t.width*g.scale/state.meta.width,t.height*g.scale/state.meta.height);
        if(index>=0){dragControl=index;canvas.setPointerCapture(event.pointerId);return;}
      }
      point=magneticPoint(point);hover=point;
      const replace=event?0:Number(el('city-coordinate-index').value);
      const accept=p=>{if(replace>0&&replace<=draft.length)draft[replace-1]=p;else draft.push(p);schedulePreview();updateHint();workspace.requestDraw();};
      if(snappedPoints.has(point)){
        const selectedPoint=point,contact=snappedPoints.get(point),target=state.roads.find(r=>r.id===contact.road);
        dialog(`<h2>选择跨层道路关系</h2><p>与${escape(target?.name||'目标道路')}平行修建，或在此接入。平行方向接入会生成平滑分叉，橙色预览显示实际路线。</p><div class="city-row"><button class="city-btn" id="road-keep-parallel">平行修建</button><button class="city-btn primary" id="road-connect-level">接入普通路</button></div>`);
        el('road-keep-parallel').onclick=()=>{snappedPoints.delete(selectedPoint);el('city-dialog').close();accept(selectedPoint);status('保持分层独立，不建立接入口');};
        el('road-connect-level').onclick=()=>{el('city-dialog').close();accept(selectedPoint);};
      }else accept(point);
      return;
    }
    if(tool==='stop'){command({type:'stop',mode:el('city-mode').value,name:el('city-stop-name').value,point,role:el('city-mode').value==='train'?el('city-station-role').value:'passenger',external:el('city-mode').value==='train'&&el('city-station-external').checked});return;}
    if(['school','park','plaza','clinic'].includes(tool)){command({type:'facility',kind:tool,point});return;}
    if(tool==='line'){
      if(busDraft()){
        if(!busReady()){status('请先建造并连接公交车总站',true);return;}
        const snap=busSnapAt(point);if(!snap){status('请靠近已有机动车道路的路边选择站点');return;}
        const existing=state.stops.find(s=>s.mode==='bus'&&s.enabled!==false&&s.road===snap.road&&s.side===snap.side&&Math.hypot(s.point[0]-snap.point[0],s.point[1]-snap.point[1])<3);
        const candidate=existing?.id||snap;
        if(lineStops.length>=80){status('一条线路最多设置 80 个站点');return;}
        if(lineStops.some(s=>{const old=typeof s==='string'?state.stops.find(q=>q.id===s):s;return s===candidate||old&&old.road===snap.road&&old.side===snap.side&&Math.hypot(old.point[0]-snap.point[0],old.point[1]-snap.point[1])<3;})){status('此站点已在线路中，请继续选择下一站');return;}
        lineStops.push(candidate);scheduleBusPreview();updateHint();workspace.requestDraw();return;
      }
      const stop=pick(point,'stop');
      if(stop&&(stop.mode===el('city-mode').value||['train','metro'].includes(stop.mode)&&['train','metro'].includes(el('city-mode').value))&&!lineStops.includes(stop.id)){lineStops.push(stop.id);updateHint();workspace.requestDraw();}
      else status('请选择兼容且未重复的站点');
      return;
    }
    if(tool==='isochrone'){const p=pick(point,'stop')||pick(point,'parcel');if(p)runQuery({kind:'isochrone',source:p.id,minutes:Number(el('city-access-budget').value),mode:el('city-access-mode').value});return;}
    if(tool==='area'){draft.push(point);if(draft.length===2){runQuery({kind:'area',bounds:draft.map(p=>p.slice())});draft=[];}workspace.requestDraw();return;}
    if(tool==='route'){
      const p=pick(point,'parcel');if(!p)return;
      if(!sourceParcel){sourceParcel=p.id;updateHint();return;}
      task(async()=>{
        const result=await api('route',{source:sourceParcel,target:p.id});
        inspectedRoute=result.route?{...result,from:state.parcels.find(q=>q.id===sourceParcel).center,to:p.center}:null;
        status(result.route?`${modeNames[result.route.mode]} · ${fmt(result.route.minutes,1)} 分钟 · ${fmt(result.route.distance)} m · ${fmt(result.route.transfers)} 次换乘`:'这两个地块之间没有可接受的出行路线');
        sourceParcel=null;updateHint();workspace.requestDraw();
      });return;
    }
    const object=pick(point);
    if(tool==='delete'&&object){command({type:'delete',id:object.id});return;}
    selected=object?.id||null;document.body.classList.toggle('show-inspector',!!selected);renderInspector();workspace.requestDraw();
  }
  canvas.addEventListener('pointerdown',event=>{
    if(!active||tool==='pan'||space||event.button!==0)return;
    event.stopImmediatePropagation();event.preventDefault();canvas.focus();
    if(working)return;
    const point=eventPoint(event);if(!point)return;
    handlePoint(point,event);
  },true);
  canvas.addEventListener('pointermove',event=>{
    if(!active)return;pointerPosition={clientX:event.clientX,clientY:event.clientY};hover=magneticPoint(eventPoint(event));
    if(specialTools.includes(tool)){scheduleSpecialPreview();workspace.requestAnimation();}
    if(dragControl!==null&&hover){draft[dragControl]=hover;schedulePreview();updateHint();}
    if(draft.length||state.meta.roadTypes[tool]||busDraft())workspace.requestAnimation();
  });
  canvas.addEventListener('pointerleave',()=>{pointerPosition=null;snapTarget=null;busSnap=null;hover=null;workspace.requestAnimation();});
  canvas.addEventListener('pointerup',()=>{dragControl=null;});
  canvas.addEventListener('pointercancel',()=>{dragControl=null;});
  canvas.addEventListener('dblclick',event=>{
    if(active&&state?.meta.roadTypes[tool]){event.preventDefault();finish();}
  });
  document.addEventListener('keydown',event=>{
    if(!active||document.querySelector('dialog[open]')||['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName))return;
    if(event.target.closest('button,summary')&&[' ','Enter'].includes(event.key))return;
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'){event.preventDefault();files();return;}
    if(event.code==='Space'){event.preventDefault();space=true;}
    if(working)return;
    if(event.key==='Backspace'&&tool==='line'&&lineStops.length){event.preventDefault();lineStops.pop();scheduleBusPreview();updateHint();workspace.requestDraw();}
    if(event.key==='Enter'&&tool==='line'&&lineStops.length>=2){event.preventDefault();el('city-create-line').click();return;}
    if(event.key==='Backspace'&&draft.length){event.preventDefault();draft.pop();schedulePreview();updateHint();workspace.requestDraw();}
    if(event.key.toLowerCase()==='r'&&specialTools.includes(tool)&&tool!=='train_station'){event.preventDefault();el('city-special-rotate').click();}
    if(event.key==='Escape'){const wasBus=busDraft();editingRoad=null;editingLine=null;preview=null;draft=[];lineStops=[];clearBusPreview();toolDrafts.delete(tool);sourceParcel=null;inspectedRoute=null;clearTimeout(previewTimer);previewTicket++;if(specialTools.includes(tool)||wasBus)setTool('select');updateHint();workspace.requestAnimation();}
    if(event.key==='Enter'&&draft.length){event.preventDefault();finish();}
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){event.preventDefault();command({type:event.shiftKey?'redo':'undo'});}
  });
  document.addEventListener('keyup',event=>{if(event.code==='Space')space=false;});
  window.addEventListener('blur',()=>{space=false;pause();});

  function canCacheBase(){
    return Boolean(active&&state&&['use','districts','transit','flows','traffic'].includes(layer)
      &&window.CityScene.effectiveQuality==='high'&&window.CityScene.settings.quality!=='map'&&window.CityScene.settings.renderer==='textures');
  }
  function paint(ctx,g,phase='all') {
    if(!active||!state)return;
    if(ctx.canvas===canvas)updateRoadValidation(g);
    const baseOnly=phase==='base',overlayOnly=phase==='overlay';
    if((baseOnly||overlayOnly)&&!canCacheBase())return;
    // A cached base contains no live traffic. One interpolation sample is
    // shared by cars, pedestrians, signals, and headlights in each overlay.
    const trafficState=baseOnly?null:trafficPlayback.frame();
    if(pointerPosition&&state.meta.roadTypes[tool])hover=magneticPoint(eventPoint(pointerPosition));
    const t=workspace.terrain, scale=t.width*g.scale/state.meta.width, sy=t.height*g.scale/state.meta.height;
    ctx.save();ctx.translate(g.left,g.top);ctx.scale(scale,sy);
    const minX=-g.left/scale,minY=-g.top/sy,maxX=(g.width-g.left)/scale,maxY=(g.height-g.top)/sy;
    ctx.beginPath();ctx.rect(0,0,state.meta.width,state.meta.height);ctx.clip();
    const visible=p=>p[0]>minX-100&&p[0]<maxX+100&&p[1]>minY-100&&p[1]<maxY+100;
    function inView(points,padding=50){let b=shapeBounds.get(points);if(!b){b=[Infinity,Infinity,-Infinity,-Infinity];for(const p of points){b[0]=Math.min(b[0],p[0]);b[1]=Math.min(b[1],p[1]);b[2]=Math.max(b[2],p[0]);b[3]=Math.max(b[3],p[1]);}shapeBounds.set(points,b);}return b[2]>minX-padding&&b[0]<maxX+padding&&b[3]>minY-padding&&b[1]<maxY+padding;}
    function path(points,close=false){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));if(close)ctx.closePath();}
    function heat(value,max){const ratio=Math.min(1,Math.max(0,value/max));return `hsl(${44+ratio*110} ${25+ratio*12}% ${87-ratio*48}%)`;}
    const physical=trafficMetrics.physicalLayers.includes(layer);
    const analyticView=trafficMetrics.views[layer];
    const parcelMaximum=analyticView?.scope==='parcel'?Math.max(0,...state.parcels.map(p=>trafficMetrics.parcelValue(p,state,layer)??0)):0;
    const mapView=window.CityScene.effectiveQuality==='map';
    const cartographic=physical&&mapView;
    const rich=physical&&!mapView;
    const sceneBuildings=[],sceneVegetation=[];let solid=false;
    const roadState={roads:state.roads,network:state.network,roadTypes:state.meta.roadTypes};
    const mapLabels=[];
    function label(text,point,size=11,color='#385856',priority=20,align='left',options={}){
      mapLabels.push({text,point,size,color,priority,align,...options});
    }
    if(!overlayOnly){
    if(cartographic)window.CityMapRenderer.paint(ctx,state,{scale,inView,visible,label,selected,sourceParcel});
    if(!cartographic)window.CityScene.streetsideGround(ctx,state,inView);
    for(const p of cartographic?[]:state.parcels) {
      // Low sun projects up to 95 metres from a building into a nearby tile.
      if(!visible(p.center)&&!inView(p.points,rich&&p.building?100:50))continue;
      const b=p.building?.status==='planned'?null:p.building;
      if(p.building?.status==='planned'&&(physical||layer==='development')&&window.CityMapRenderer.plannedResidential(ctx,p,scale)&&window.CityScene.settings.labels&&scale>.7)
        label('规划住宅',p.building.center||p.center,9,'#397e5b',16,'center');
      let color=b?colors[b.use]:'#eef1df';
      if(layer==='land')color=heat(p.landValue,500);
      if(layer==='rent')color=heat(p.rent,35);
      if(layer==='access')color=heat(p.accessJobs||0,600);
      if(layer==='population')color=heat(p.population||0,100);
      if(layer==='jobs')color=heat(b?.positions||0,100);
      if(layer==='vacancy')color=heat(b?(b.occupied||0)/Math.max(1,b.capacity):0,1);
      if(layer==='pollution')color=heat(p.pollution||0,1);
      if(layer==='slope')color=heat((p.terrain?.slope||0)*100,30);
      if(layer==='cost')color=heat((p.terrain?.costFactor||1)-1,2);
      if(layer==='landscape')color=heat(p.terrain?.scenic||0,1);
      if(layer==='risk')color=heat(p.terrain?.lowland||0,1);
      if(layer==='height')color=heat(b?.height||b?.floors*3.3||0,90);
      if(analyticView?.scope==='parcel')color=trafficMetrics.viewColor(layer,trafficMetrics.parcelValue(p,state,layer),parcelMaximum);
      if(layer==='change')color=p.landChange>0?'#bd9d61':'#6c9db1';
      if(layer==='development')color=b?(b.status==='construction'?'#cda561':b.status==='vacant'?'#999c94':'#7eac85'):p.openSpace?'#7eac85':'#edf0e6';
      if(layer==='comparison'){const diff=comparison?.parcels.find(q=>q.id===p.id)?.land; color=diff==null?'#e7ebdf':diff>0?'#c69e63':'#719daf';}
      if(physical&&b){
        const roofs={residential:['#97a47d','#8a9c77','#a4ad8c','#879a83'],commercial:['#c6a777','#d0b78c','#bda17c','#c6b292'],office:['#7f9ca8','#8da5ac','#72909e','#95a9b0'],industrial:['#aa9aa8','#9e96a7','#b0a2b0','#a59eac'],warehouse:['#aaa48f','#b7ac97','#9f9e91','#b6b09d']};
        color=(roofs[b.use]||[color])[b.roof%4||0];
      }
      if(rich){window.CityScene.parcel(ctx,p,scale);if(b&&!['planned','construction'].includes(b.status)||p.use==='protected')sceneVegetation.push(p);}
      else if(physical&&p.blockCommon&&!p.openSpace){path(p.points,true);ctx.fillStyle='#d8d6be77';ctx.fill();}
      if(!rich&&(!physical||b||p.use==='protected')){path(p.points,true);ctx.fillStyle=p.use==='protected'?'#80997555':physical?'#eee9da':color;ctx.globalAlpha=physical?.42:.72;ctx.fill();ctx.globalAlpha=1;}
      if(!physical&&scale>.25){ctx.lineWidth=.4/scale;ctx.strokeStyle='#75846830';ctx.stroke();}
      if(b) {
        if(rich){sceneBuildings.push(p);if(window.CityScene.settings.labels&&(scale>.7||b.floors>=10&&scale>.32))label((b.name?b.name+' · ':'')+b.floors+'F',b.center||p.center,9,'#35404a',b.floors>=10?25:1,'center');}
        else {
        const points=b.footprint;
        const buildingCenter=b.center||points.slice(0,-1).reduce((a,pt)=>[a[0]+pt[0]/(points.length-1),a[1]+pt[1]/(points.length-1)],[0,0]);
        if(physical) {
          if(b.status!=='construction'&&scale>.15){
            ctx.save();ctx.translate(Math.min(45,2+(b.height||b.floors*3.3)*.45),Math.min(34,1+(b.height||b.floors*3.3)*.34));path(points,true);ctx.fillStyle='#31473d2b';ctx.fill();ctx.restore();
          }
          path(points,true);ctx.fillStyle=color;ctx.fill();ctx.strokeStyle=b.status==='construction'?'#997f55':'#536a5960';
          ctx.lineWidth=.7/scale;ctx.setLineDash(b.status==='construction'?[3/scale,3/scale]:[]);ctx.stroke();ctx.setLineDash([]);
          if(scale>.2&&b.status!=='construction'){
            // Industrial halls read as one continuous roof. Decorative stripes
            // were mistaken for separate buildings or floors at map scale.
            if(b.form!=='factory'&&b.form!=='warehouse'){
              ctx.save();path(points,true);ctx.clip();ctx.strokeStyle='#ffffffaa';ctx.lineWidth=.8/scale;
              const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
              const roofAngle=p.streetAngle??((b.orientation||90)-90);
              ctx.translate(...buildingCenter);ctx.rotate(roofAngle*Math.PI/180);
              const radius=Math.hypot(x1-x0,y1-y0),roof=b.roof||0;
              if(b.form==='villa'||b.use==='residential'&&roof<2){
                path([[-radius,0],[radius,0]]);ctx.stroke();
                if(roof===1){path([[0,-radius],[0,radius]]);ctx.stroke();}
              }else{
                // Small roof equipment stays clipped to the real footprint;
                // a roof treatment never represents an extra building/floor.
                ctx.fillStyle='#f4f2e475';ctx.fillRect(-5,-3,5+roof*2,4);
                if(roof%2){ctx.fillStyle='#566c6d65';ctx.fillRect(3,4,7,4);}
              }
              ctx.restore();
            }
            if(b.floors>=8){
              const roofCenter=points.reduce((a,pt)=>[a[0]+pt[0]/points.length,a[1]+pt[1]/points.length],[0,0]);
              path(points.map(pt=>[roofCenter[0]+(pt[0]-roofCenter[0])*.66,roofCenter[1]+(pt[1]-roofCenter[1])*.66]),true);
              ctx.fillStyle=b.use==='office'?'#496a80':'#6e8267';ctx.fill();ctx.strokeStyle='#eff3ed';ctx.lineWidth=.8/scale;ctx.stroke();
            }
            if(scale>.7||b.floors>=10&&scale>.32)label((b.name?b.name+' · ':'')+b.floors+'F',buildingCenter,9,'#243e4c',b.floors>=10?25:1,'center');
          }
        }
      }
      }
      if(!p.connected){path(p.points,true);ctx.strokeStyle='#b75848';ctx.lineWidth=1.3/scale;ctx.setLineDash([4/scale,3/scale]);ctx.stroke();ctx.setLineDash([]);}
      // Detailed parcel highlights are painted after the cached base below;
      // baking them here would leave stale outlines after changing tools.
      if(!rich&&(p.id===selected||p.id===sourceParcel)){path(p.points,true);ctx.strokeStyle='#e3933f';ctx.lineWidth=2.5/scale;ctx.stroke();}
    }
    for(const walkway of cartographic?[]:state.localPaths||[]){if(scale<.22||!walkway.points.some(visible))continue;path(walkway.points);ctx.strokeStyle=rich?window.CityScene.material(ctx,'paving',0):walkway.kind==='neighbourhood'?'#bdad8d':'#d7cdb8';ctx.lineWidth=Math.max(walkway.width,1/scale);ctx.stroke();}
    for(const f of cartographic?[]:state.facilities)if(window.CitySpecialBuildings.names[f.kind]&&inView(f.points))window.CitySpecialBuildings.ground(ctx,f,scale);
    }else if(window.CityScene.settings.labels){
      // Labels use this frame's viewport and scale, not the cached gutter's
      // visibility or screen-space collision boxes.
      for(const p of state.parcels){
        const b=p.building;if(!b||(!visible(p.center)&&!inView(p.points)))continue;
        if(scale>.7||b.floors>=10&&scale>.32)label((b.name?b.name+' · ':'')+b.floors+'F',b.center||p.center,9,'#35404a',b.floors>=10?25:1,'center');
      }
    }
    if(rich){
      if(!overlayOnly){
      for(const f of state.facilities){if(!visible(f.point)||window.CitySpecialBuildings.names[f.kind])continue;window.CityScene.facilityGround(ctx,f,scale);if(f.kind==='park'||f.kind==='plaza')sceneVegetation.push(f);}
      window.RoadRenderer.paint(ctx,roadState,{scale,selected,inView,visible,stage:'surface',levels:[-1,0]});
      for(const f of state.facilities)if(inView(f.points||[f.point]))window.CitySpecialBuildings.access(ctx,f);
      if(window.CityScene.settings.renderer==='webgl'&&window.CityScene.settings.quality==='high'&&scale>.4&&window.CityScene.assetsReady&&window.CityScene3D?.available){
        window.RoadRenderer.paint(ctx,roadState,{scale,selected,inView,visible,traffic:trafficState,stage:'details',levels:[-1,0],vehicles:false,signals:false});
        solid=window.CityScene3D.render(ctx,state,{traffic:trafficState});
      }
      }
      if(solid){window.RoadRenderer.paintSignals(ctx,window.RoadRenderer.buildPlan(state.roads,state.network,state.meta.roadTypes),{scale,visible,traffic:trafficState,solid:true});}
      else{
        if(!overlayOnly){
        window.CityScene.streetsideParking(ctx,state,scale,inView);
        window.CityStreetFurniture?.paint(ctx,state,{scale,inView,visible,preview:window.CityScene.preview});
        window.CityScene.buildingShadows(ctx,sceneBuildings,scale);
        for(const p of sceneBuildings.sort((a,b)=>a.center[1]-b.center[1]))window.CityScene.building(ctx,p,scale);
        window.CityScene.vegetation(ctx,sceneVegetation,scale,visible,window.CityScene.streetTreesFor(state,ctx));
        }
        // Keep every layer after ground traffic in its original position:
        // medians and facilities, walkers, bridges, lighting, then overlays.
        if(baseOnly){ctx.restore();return;}
        window.RoadRenderer.paint(ctx,roadState,{scale,selected,inView,visible,traffic:trafficState,stage:'details',levels:[-1,0]});
        window.CityScene.medians(ctx,state,scale,visible,inView);
      }
      for(const p of state.parcels)if(p.id===selected||p.id===sourceParcel){path(p.points,true);ctx.strokeStyle='#e3933f';ctx.lineWidth=2.5/scale;ctx.stroke();}
    }else if(!cartographic){window.RoadRenderer.paint(ctx,roadState,{scale,selected,inView,visible,traffic:mapView?null:trafficState});for(const f of state.facilities)if(inView(f.points||[f.point]))window.CitySpecialBuildings.access(ctx,f);}
    if(trafficMetrics.roadLayers.includes(layer)){
      const edges=state.network.edges.filter(e=>state.meta.roadTypes[e.kind]?.capacity);
      const values=edges.map(e=>trafficMetrics.roadValue(e,state.meta.roadTypes[e.kind],layer,trafficPeriod));
      const maximum=Math.max(0,...values.map(v=>v??0));
      edges.forEach((e,i)=>{
        if(!inView(e.points))return;
        path(e.points);ctx.lineWidth=Math.max(2/scale,5);ctx.strokeStyle=layer==='traffic'?trafficMetrics.color(trafficMetrics.metric(e,trafficPeriod),trafficPeriod,maximum):trafficMetrics.viewColor(layer,values[i],maximum);ctx.stroke();
        if(scale>.25)label(fmt(values[i],1),e.points[Math.floor(e.points.length/2)],10,'#334a3c',48,'center',{id:e.id});
      });
    }
    for(const line of state.lines){
      if(!line.valid||!el('city-show-transit-lines').checked)continue;
      ctx.strokeStyle=layer==='transitLoad'?trafficMetrics.viewColor(layer,line.load==null?null:line.load*100):line.color;ctx.lineWidth=(line.id===selected?5:layer==='transitLoad'?4:2)/scale;ctx.globalAlpha=['transit','transitLoad'].includes(layer)||panel==='transit'?1:.65;
      for(const p of line.paths||[]){if((p.direction===0||line.curbRouting)&&p.points.length){path(p.points);ctx.stroke();if(p.direction===0&&layer==='transitLoad'&&scale>.15)label(`${line.name} · ${fmt(line.load==null?null:line.load*100,1)}%`,p.points[Math.floor(p.points.length/2)],11,'#334a3c',55,'center',{id:line.id});}}
      ctx.globalAlpha=1;
    }
    const stationMaximum=layer==='stationActivity'?Math.max(0,...state.stops.map(s=>trafficMetrics.stopActivity(s)??0)):0;
    for(const stop of state.stops){
      if(!visible(stop.point))continue;
      const chosen=lineStops.includes(stop.id)||selected===stop.id;
      if(layer==='stationActivity'){
        const value=trafficMetrics.stopActivity(stop),radius=(5+14*Math.sqrt(stationMaximum>0?(value||0)/stationMaximum:0))/scale;
        ctx.beginPath();ctx.arc(...stop.point,radius,0,Math.PI*2);ctx.fillStyle=trafficMetrics.viewColor(layer,value,stationMaximum);ctx.fill();ctx.strokeStyle=chosen?'#df8d35':'#fff';ctx.lineWidth=2/scale;ctx.stroke();
        label(`${stop.name} · ${fmt(value)} 人次`,[stop.point[0],stop.point[1]-radius-5/scale],11,'#334a3c',55,'center',{id:stop.id});continue;
      }
      if(cartographic){if(scale>.15||chosen)window.CityMapRenderer.poi(label,{...stop,kind:stop.mode},scale,chosen?stop.id:null);continue;}
      ctx.beginPath();ctx.arc(...stop.point,(chosen?6:4)/scale,0,Math.PI*2);ctx.fillStyle=stop.connected?'#fcfdf6':'#e9b5a1';ctx.fill();
      ctx.lineWidth=(chosen?2.5:1.5)/scale;ctx.strokeStyle=chosen?'#df8d35':'#3d6f72';ctx.stroke();
      if(scale>.2||chosen)label(stop.name,[stop.point[0]+8/scale,stop.point[1]-7/scale],11,'#385856',chosen?100:30);
    }
    for(const f of cartographic?[]:state.facilities){
      if(window.CitySpecialBuildings.names[f.kind]){
        if(!inView(f.points))continue;
        if(!solid)window.CitySpecialBuildings.paint2D(ctx,f,scale);else window.CitySpecialBuildings.details(ctx,f,scale,true,window.CityScene3D.tilt);
        if(f.id===selected){path(f.points,true);ctx.strokeStyle='#e3933f';ctx.lineWidth=2.5/scale;ctx.stroke();}
        if(scale>.15&&(specialTools.includes(f.kind)||window.CityScene?.settings.labels))label(f.name||facilityNames[f.kind],[f.point[0],f.point[1]+f.depth*.54],11,'#294e5c',40,'center');
        continue;
      }
      if(!visible(f.point))continue;
      if(rich&&f.points){if(window.CityScene.settings.labels&&scale>(f.blockCommon?1.4:.3))label(f.name||{park:'公园',plaza:'广场',school:'学校',clinic:'诊所'}[f.kind],[f.point[0]+8,f.point[1]],10,'#3c5646',f.blockCommon?3:10);continue;}
      const color={park:'#76a16f',plaza:'#d7c4a0',school:'#d4a465',clinic:'#b57d78'}[f.kind];
      ctx.fillStyle=color;
      if(f.points){path(f.points,true);ctx.fill();ctx.strokeStyle='#f2efdc';ctx.lineWidth=1/scale;ctx.stroke();
        if(f.kind==='park'){ctx.save();path(f.points,true);ctx.clip();const xs=f.points.map(q=>q[0]),ys=f.points.map(q=>q[1]),x0=Math.min(...xs),y0=Math.min(...ys),w=Math.max(...xs)-x0,h=Math.max(...ys)-y0;for(let i=0;i<Math.min(180,Math.max(9,w*h/150));i++){const x=x0+(i*.61803398875%1)*w,y=y0+(i*.41421356237%1)*h;ctx.beginPath();ctx.arc(x,y,3+i%3,0,Math.PI*2);ctx.fillStyle=i%2?'#557e53':'#a0bd86';ctx.fill();}ctx.restore();}
        if(f.kind==='plaza'&&!f.blockCommon){ctx.save();path(f.points,true);ctx.clip();ctx.strokeStyle='#eee5cd';ctx.lineWidth=1;for(let x=-24;x<=24;x+=8){path([[f.point[0]+x,f.point[1]-24],[f.point[0]+x,f.point[1]+24]]);ctx.stroke();}ctx.beginPath();ctx.arc(...f.point,4,0,Math.PI*2);ctx.fillStyle='#8bb2b5';ctx.fill();ctx.restore();}
      }else ctx.fillRect(f.point[0]-12,f.point[1]-12,24,24);
      if(scale>(f.blockCommon?1.4:.3))label(f.name||(f.blockCommon?(f.kind==='park'?'绿地':'庭院'):{park:'公园',plaza:'广场',school:'学校',clinic:'诊所'}[f.kind]),[f.point[0]+8,f.point[1]],10,'#3c5646',f.blockCommon?3:10);
    }
    for(const walkway of rich||cartographic?[]:state.localPaths||[]){if(!walkway.block||scale<.22||!walkway.points.some(visible))continue;path(walkway.points);ctx.strokeStyle='#eee6d1';ctx.lineWidth=Math.max(walkway.width,1/scale);ctx.stroke();}
    if(!mapView&&!solid)window.CityPedestrians?.paint(ctx,trafficState?.pedestrians,{scale,visible});
    if(rich)window.RoadRenderer.paint(ctx,roadState,{scale,selected,inView,visible,traffic:trafficState,levels:[1],vehicles:!solid});
    if(rich&&solid)window.CityScene3D.renderUpperTraffic(ctx,state,trafficState);
    if(rich)window.CityScene.atmosphere(ctx,state,{scale,visible,traffic:trafficState,solid});
    if(rich)for(const f of state.facilities)if(window.CitySpecialBuildings.names[f.kind]&&inView(f.points))window.CitySpecialBuildings.night(ctx,f,scale,window.CityScene.time);
    if(state.gateway){ctx.strokeStyle='#9d763f';ctx.lineWidth=2/scale;ctx.strokeRect(state.gateway[0]-6/scale,state.gateway[1]-6/scale,12/scale,12/scale);label('区域门户',[state.gateway[0]+10/scale,state.gateway[1]+4/scale],11,'#785b33',35);}
    if(layer==='districts'||layer==='use')for(const d of state.districts){
      if(layer==='use'){if(rich&&!window.CityScene.settings.labels||d.buildings<5||scale<(mapView ? .035 : .17)||!visible(d.center))continue;label(d.name||d.kind,d.center,mapView?17:11,mapView?'#646968':'#485d50',mapView?75:40,'center',mapView?{kind:'district',weight:600,id:d.id}:{});continue;}
      for(const polygon of d.polygons||[]){path(polygon,true);ctx.fillStyle='#f7faf040';ctx.fill();ctx.strokeStyle='#658569b0';ctx.lineWidth=1.5/scale;ctx.stroke();}
      label(d.name||d.kind,d.center,12,'#325542',40,'center');
    }
    // Place labels after the physical map, with consistent priority and a small
    // screen-space gutter. Object selection still exposes every hidden name.
    const labelBoxes=[];
    const onScreen=ctx.canvas===canvas;
    if(onScreen)mapHitLabels=[];
    if(cartographic){
      const canvasRect=canvas.getBoundingClientRect();
      const obstacles=onScreen?[...el('map-frame').querySelectorAll('.map-label,.map-tools,.map-view-switch,.compass,.map-scale,.zoom-control,.city-hint')].filter(node=>node.offsetWidth&&node.offsetHeight).map(node=>{const r=node.getBoundingClientRect();return [r.left-canvasRect.left-g.left-5,r.top-canvasRect.top-g.top-5,r.right-canvasRect.left-g.left+5,r.bottom-canvasRect.top-g.top+5];}):[];
      const placed=window.CityMapRenderer.paintLabels(ctx,mapLabels,{scale,sy,obstacles,bounds:[Math.max(0,minX),Math.max(0,minY),Math.min(state.meta.width,maxX),Math.min(state.meta.height,maxY)]});
      if(onScreen)mapHitLabels=placed;
    }
    for(const item of cartographic?[]:mapLabels.sort((a,b)=>b.priority-a.priority)){
      ctx.font=`${item.size/scale}px sans-serif`;
      const width=ctx.measureText(item.text).width,x=item.point[0]-(item.align==='center'?width/2:0),y=item.point[1],pad=3/scale;
      const box=[x-pad,y-(item.size+2)/scale-pad,x+width+pad,y+pad];
      if(labelBoxes.some(b=>box[0]<b[2]&&box[2]>b[0]&&box[1]<b[3]&&box[3]>b[1]))continue;
      labelBoxes.push(box);ctx.textAlign=item.align;ctx.strokeStyle=mapView?'#fffffff0':'#fcfbefd9';ctx.lineWidth=2.5/scale;
      ctx.strokeText(item.text,...item.point);ctx.fillStyle=item.color;ctx.fillText(item.text,...item.point);
    }
    ctx.textAlign='left';
    if(layer==='flows'&&scale<.6){for(const flow of state.aggregateFlows||[]){if(!flow.completed||flow.purpose!=='work'||flow.period!=='am')continue;const a=flow.source,b=flow.target;if(a[0]===b[0]&&a[1]===b[1])continue;path([a,b]);ctx.strokeStyle=flow.mode==='taxi'?'#c49a2288':flow.mode==='car'?'#ad844e88':'#397f8b88';ctx.lineWidth=Math.min(7,1+Math.log1p(flow.people))/scale;ctx.stroke();const angle=Math.atan2(b[1]-a[1],b[0]-a[0]);ctx.save();ctx.translate(...b);ctx.rotate(angle);path([[-9/scale,-4/scale],[0,0],[-9/scale,4/scale]]);ctx.stroke();ctx.restore();ctx.font=`${10/scale}px sans-serif`;ctx.fillStyle='#2f5e62';ctx.fillText(flow.people+' 人次',(a[0]+b[0])/2,(a[1]+b[1])/2);}}
    if(layer==='flows')for(const flow of state.migrationFlows||[]){path([flow.source,flow.target]);ctx.strokeStyle=flow.kind==='out'?'#af6d4788':'#657cad88';ctx.lineWidth=1.5/scale;ctx.setLineDash([4/scale,4/scale]);ctx.stroke();ctx.setLineDash([]);ctx.font=`${10/scale}px sans-serif`;ctx.fillStyle='#53637b';ctx.fillText(`${{in:'迁入',out:'迁出',relocation:'搬迁'}[flow.kind]} ${flow.people} 人`,flow.target[0]+4/scale,flow.target[1]-4/scale);}
    if(layer==='flows'){
      const now=(state.simulation?.elapsedSeconds||0)/9;
      for(const [i,flow] of state.flows.entries()){
        const pts=[flow.source,...flow.points,flow.target];if(pts.length<2)continue;
        if(layer==='flows'&&scale>=.6){path(pts);ctx.strokeStyle=flow.mode==='taxi'?'#c49a2266':flow.mode==='public'?'#357f9a55':flow.mode==='car'?'#b28a4c40':'#507e5340';ctx.lineWidth=1/scale;ctx.stroke();}
        if(simulation.running&&!['car','taxi'].includes(flow.mode)&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
          const position=((now+i*.123)%1)*(pts.length-1),j=Math.floor(position),fraction=position-j;
          const a=pts[j],b=pts[Math.min(j+1,pts.length-1)];
          ctx.fillStyle=flow.mode==='public'?'#297b98':flow.mode==='car'?'#ac7535':'#477750';ctx.beginPath();ctx.arc(a[0]+(b[0]-a[0])*fraction,a[1]+(b[1]-a[1])*fraction,1.8/scale,0,Math.PI*2);ctx.fill();
        }
      }
    }
    const selectedJunction=state.network.junctions.find(j=>j.id===selected);
    if(selectedJunction){ctx.beginPath();ctx.arc(...selectedJunction.point,12/scale,0,Math.PI*2);ctx.strokeStyle='#087bff';ctx.lineWidth=2/scale;ctx.stroke();}
    if(inspectedRoute){path([inspectedRoute.from,...inspectedRoute.points,inspectedRoute.to]);ctx.strokeStyle='#cf8035';ctx.lineWidth=3/scale;ctx.stroke();}
    if(queryResult)for(const p of state.parcels){if(queryResult.stats.parcels.includes(p.id)){path(p.points,true);ctx.strokeStyle='#367baf';ctx.lineWidth=2/scale;ctx.stroke();}}
    for(const p of state.parcels){if(renewalSelection.includes(p.id)){path(p.points,true);ctx.fillStyle='#885ca52b';ctx.fill();ctx.strokeStyle='#80529e';ctx.lineWidth=2/scale;ctx.stroke();}}
    if(renewalPreview)for(const phase of renewalPreview.phases){for(const site of phase.sites){path(site.targetBuilding?.footprint||site.points,true);ctx.fillStyle=site.blockCommon?'#71916466':'#b97e4b66';ctx.fill();ctx.strokeStyle='#9a693c';ctx.lineWidth=1/scale;ctx.stroke();}}
    if(busDraft())window.CityBusGeometry.paint(ctx,{stops:lineStops.map(s=>typeof s==='string'?state.stops.find(q=>q.id===s):s).filter(Boolean),paths:busPreview?.paths||[],hover:busSnap,scale,valid:busPreview?.valid!==false});
    if(draft.length){
      const pointer=hover&&dragControl===null&&!editingRoad?hover:null;
      const plan=window.CityGeometry.roadDraftPlan(draft,pointer,el('city-shape').value==='curve',preview);
      if(tool==='area'){
        const a=draft[0],b=pointer||draft.at(-1);path([a,[b[0],a[1]],b,[a[0],b[1]],a]);
      }else path(plan.points);
      ctx.strokeStyle=plan.invalid?'#b65b44':'#d89342';ctx.lineWidth=3/scale;ctx.setLineDash([6/scale,4/scale]);ctx.stroke();
      if(tool!=='area'&&plan.guide.length){path(plan.guide);ctx.strokeStyle='#728477';ctx.lineWidth=1.5/scale;ctx.setLineDash([3/scale,5/scale]);ctx.stroke();}
      ctx.setLineDash([]);
      for(const p of draft){ctx.beginPath();ctx.arc(...p,4/scale,0,Math.PI*2);ctx.fillStyle='#fff8e5';ctx.fill();ctx.strokeStyle='#c18439';ctx.lineWidth=1.5/scale;ctx.stroke();}
    }
    if(snapTarget&&hover&&state.meta.roadTypes[tool]&&!space){
      ctx.save();ctx.translate(...snapTarget.point);ctx.scale(1/scale,1/sy);
      ctx.beginPath();ctx.arc(0,0,9,0,Math.PI*2);ctx.fillStyle='#ffffffdd';ctx.fill();ctx.strokeStyle='#1685eb';ctx.lineWidth=2;ctx.stroke();
      ctx.beginPath();ctx.moveTo(-13,0);ctx.lineTo(-5,0);ctx.moveTo(5,0);ctx.lineTo(13,0);ctx.moveTo(0,-13);ctx.lineTo(0,-5);ctx.moveTo(0,5);ctx.lineTo(0,13);ctx.stroke();
      ctx.font='12px sans-serif';ctx.textAlign='left';ctx.lineWidth=4;ctx.strokeStyle='#fff';ctx.strokeText('吸附 · '+snapTarget.type,16,-13);ctx.fillStyle='#1268ab';ctx.fillText('吸附 · '+snapTarget.type,16,-13);ctx.restore();
    }
    if(specialTools.includes(tool)&&hover){const f=specialPreview?.facility||specialFootprint(hover);if(f)window.CitySpecialBuildings.preview(ctx,f,scale,specialPreview?.valid!==false);}
    if(preview&&!preview.valid&&preview.point){const p=preview.point;ctx.strokeStyle='#b54435';ctx.lineWidth=2/scale;ctx.beginPath();ctx.arc(...p,10/scale,0,Math.PI*2);ctx.stroke();path([[p[0]-6/scale,p[1]-6/scale],[p[0]+6/scale,p[1]+6/scale]]);ctx.stroke();}
    const broken=state.lines.find(l=>l.id===selected);if(broken?.breakPoints?.length&&el('city-show-transit-lines').checked){path(broken.breakPoints);ctx.strokeStyle='#b54435';ctx.lineWidth=3/scale;ctx.setLineDash([6/scale,4/scale]);ctx.stroke();ctx.setLineDash([]);}
    ctx.restore();
  }
  function dialog(html) { el('city-dialog-body').innerHTML=html+'<p id="city-dialog-error" class="save-error" role="alert" hidden></p>';if(!el('city-dialog').open)el('city-dialog').showModal(); }
  const renewalStatus={planned:'待启动',waiting:'等待条件',active:'进行中',demolition:'拆除准备',construction:'施工中',complete:'已交付',cancelled:'已取消'};
  function renderRenewals() {
    const host=el('city-renewal-list');
    host.innerHTML=(state.renewals||[]).slice().reverse().map(p=>`<button class="city-list-item" data-renewal="${escape(p.id)}"><b>${escape(p.name)}</b><small>${p.origin==='automatic'?'自动 · ':''}${renewalStatus[p.status]} · ${p.phases.filter(s=>s.status==='complete').length}/${p.phases.length} 期交付<br>${escape(p.reason)}</small></button>`).join('')||'<p class="city-note">暂无区块项目，预览方案并立项后会显示在这里。</p>';
    host.querySelectorAll('[data-renewal]').forEach(b=>b.onclick=()=>showRenewal(b.dataset.renewal));
    renewalSelection=renewalSelection.filter(id=>state.parcels.some(p=>p.id===id));
    el('city-renewal-selection').textContent=renewalSelection.length?`已选 ${renewalSelection.length} 块土地${renewalSelection.length===1?'，预览时扩展为所在街区':''}`:'点击地块选择；再次点击取消。';
    window.dispatchEvent(new Event('city-renewal-change'));
  }
  function renewalSVG(plan) {
    const points=plan.boundary,xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    const x=Math.min(...xs)-8,y=Math.min(...ys)-8,w=Math.max(...xs)-x+8,h=Math.max(...ys)-y+8;
    const polygon=(pts,attributes)=>`<polygon points="${pts.map(p=>p.join(',')).join(' ')}" ${attributes}/>`;
    const palette=['#b88248','#668f9b','#8f7ba4','#759066'];
    const retained=state.parcels.filter(p=>plan.preservedIds.includes(p.id)).map(p=>polygon(p.points,'fill="#d0dcc2" stroke="#73906b" stroke-width="1"')).join('');
    const phases=plan.phases.map((p,i)=>p.sourcePoints.map(pts=>polygon(pts,`fill="${palette[i]}" fill-opacity=".12" stroke="${palette[i]}" stroke-width=".8"`)).join('')+p.sites.map(s=>polygon(s.targetBuilding?.footprint||s.points,`fill="${s.blockCommon?'#d0dcc2':palette[i]}" fill-opacity=".85" stroke="#fff" stroke-width=".7"`)).join('')).join('');
    return `<svg class="renewal-plan-map" viewBox="${x} ${y} ${w} ${h}" role="img" aria-label="更新布局预览，不同颜色表示施工分期，绿色表示保留或新增公共空间">${polygon(points,'fill="#f6f3e9" stroke="#8b9388" stroke-width="2"')}${retained}${phases}</svg><div class="renewal-key">${plan.phases.map((p,i)=>`<span class="renewal-phase-${i}">● 第 ${i+1} 期</span>`).join('')}<span>绿色：公共空间 / 保留用地</span></div>`;
  }
  function previewSelectedRenewal({mode='rebuild',target='commercial'}={}) {
    if(!state||working)return;
    if(!['rebuild','renovate','onsite'].includes(mode))return;
    if(!renewalSelection.length){status('请先在地图上选择区块或建筑',true);return;}
    if(mode!=='rebuild'&&(renewalSelection.length!==1||!state.parcels.find(p=>p.id===renewalSelection[0])?.building)){
      status('请选择一栋已有建筑，再预览维护方案',true);return;
    }
    openRenewal(renewalSelection[0],mode,mode==='rebuild'&&renewalSelection.length>1?[...renewalSelection]:null,target);
  }
  function openRenewal(id,mode='rebuild',parcelIds=null,target=null) {
    if(!state||working)return;
    pause();renewalPreview=null;
    const origin=state.parcels.find(p=>p.id===id);if(!origin)return;
    const name=mode==='renovate'?'建筑翻新':mode==='onsite'?'原址重建':'街区拆除重建';
    dialog(`<h2>${name}</h2><p>${mode==='renovate'?'保留用途、建筑轮廓和原有容量。翻新历时 3 个月，完成后状况恢复至 100；建筑年龄继续保留。':mode==='onsite'?'保留原地块、建筑位置和占地轮廓。拆除旧楼后按选定用途及楼层重建，施工期间原容量退出。容积率上限仍须满足。':'整合闭合街区内的可开发地块，按目标用途分期建设建筑及共享广场；现有商业中心也可改为住宅或其他用途。道路、公共空间和保护用地保留。'}</p>
      <div class="city-fields"><label>项目名称<input class="city-field" id="renewal-name" maxlength="60" value="${name}"></label>
      ${mode!=='renovate'?`<label>${mode==='onsite'?'目标用途（使用所选组合的主用途）':'目标用途组合'}<select class="city-field" id="renewal-target"><option value="commercial">商业中心 · 商业＋办公</option><option value="residential">住宅社区 · 住宅＋商业</option><option value="office">办公园区 · 办公＋商业</option><option value="industrial">产业园区 · 工业＋仓储</option><option value="warehouse">仓储园区 · 仓储＋工业</option><option value="mixed">混合街区 · 住宅＋商业＋办公</option></select></label><div class="paired"><label>分期数<input class="city-field" id="renewal-phases" type="number" min="1" max="4" value="3"></label><label>主用途用地目标 / %<input class="city-field" id="renewal-share" type="number" min="0" max="100" value="70"></label></div>
      <div class="paired"><label>商业最高楼层<input class="city-field" id="renewal-commercial" type="number" min="1" max="8" value="3"></label><label>办公最高楼层<input class="city-field" id="renewal-office" type="number" min="1" max="28" value="8"></label></div>
      <div class="paired"><label>住宅最高楼层<input class="city-field" id="renewal-residential" type="number" min="1" max="28" value="6"></label><label>工业最高楼层<input class="city-field" id="renewal-industrial" type="number" min="1" max="4" value="2"></label></div><label>仓储最高楼层<input class="city-field" id="renewal-warehouse" type="number" min="1" max="4" value="1"></label>
      <div class="paired"><label>建筑覆盖率上限 / %<input class="city-field" id="renewal-coverage" type="number" min="30" max="85" value="65"></label><label>容积率上限<input class="city-field" id="renewal-far" type="number" min="0.5" max="12" step="0.1" value="4"></label></div>
      <label><span><input id="renewal-demand" type="checkbox"> 每期等待至少 20% 的空间需求再开工</span></label>
      <label><span><input id="renewal-exit" type="checkbox"> 安置房源不足时允许剩余住户迁出城市</span></label><p class="city-note">默认等待城内可负担住房。企业优先迁至同用途空置建筑，无合适空间时关闭并重新匹配就业。市政在每期开工时支付费用。</p>`:''}</div>
      <button class="city-btn" id="renewal-preview-btn">生成方案预览</button><div id="renewal-preview-result" aria-live="polite"></div>
      <button class="city-btn primary" id="renewal-commit" disabled>按预览方案立项</button>`);
    if(mode==='rebuild'&&['commercial','residential','office','industrial','warehouse','mixed'].includes(target))el('renewal-target').value=target;
    if(mode==='onsite'){
      el('renewal-target').value=origin.building.use;el('renewal-share').value='100';
      el('renewal-phases').value='1';el('renewal-phases').disabled=true;el('renewal-share').disabled=true;el('renewal-coverage').disabled=true;
      el('renewal-'+origin.building.use).value=String(origin.building.floors);
      el('renewal-far').value=String(Math.max(4,Math.ceil(origin.building.floorArea/origin.area*10)/10));
    }
    let accepted=null,options=null,formVersion=0;
    const invalidate=()=>{formVersion++;accepted=null;renewalPreview=null;el('renewal-commit').disabled=true;el('renewal-preview-result').innerHTML='<p class="city-note">参数已变更，请重新生成预览。</p>';workspace.requestDraw();};
    el('city-dialog-body').querySelectorAll('input:not(#renewal-name),select').forEach(input=>input.oninput=invalidate);
    el('renewal-preview-btn').onclick=()=>task(async()=>{
      const ticket=++formVersion,resultBox=el('renewal-preview-result');
      accepted=null;renewalPreview=null;el('renewal-commit').disabled=true;
      options={id,mode,...(parcelIds?{parcelIds}:{}),...(mode!=='renovate'?{phases:Number(el('renewal-phases').value),target:el('renewal-target').value,primaryShare:Number(el('renewal-share').value),residentialFloors:Number(el('renewal-residential').value),industrialFloors:Number(el('renewal-industrial').value),warehouseFloors:Number(el('renewal-warehouse').value),commercialFloors:Number(el('renewal-commercial').value),officeFloors:Number(el('renewal-office').value),coverage:Number(el('renewal-coverage').value)/100,floorRatio:Number(el('renewal-far').value),allowExit:el('renewal-exit').checked,waitForDemand:el('renewal-demand').checked}:{})};
      el('renewal-preview-result').textContent='正在计算用地、布局和安置需求…';
      try {
        const plan=await api('renewal_preview',{command:options});
        if(!resultBox.isConnected||!el('city-dialog').open||ticket!==formVersion)return;
        accepted=plan;renewalPreview=plan;
        el('renewal-preview-result').innerHTML=renewalSVG(plan)+details([
          ['更新面积',fmt(plan.area)+' m²'],['现有建筑',fmt(plan.oldBuildings)+' 栋'],['保留地块',fmt(plan.preservedIds.length)+' 块'],
          ['市政总投资',fmt(plan.cost)+' 币'],['最短交付时间',fmt(plan.minimumMonths)+' 个月（等待另计）'],
          ...(mode!=='renovate'?[['安置家庭 / 人数',fmt(plan.households)+' 户 / '+fmt(plan.people)+' 人'],['城内空余住房',fmt(plan.availableHomes)+' 户容量（未筛选负担能力）'],['受影响企业',fmt(plan.firms)+' 个群组'],['规划建筑',fmt(plan.buildings)+' 栋'],['旧 / 新总建筑面积',fmt(plan.oldFloorArea)+' / '+fmt(plan.floorArea)+' m²'],...Object.entries(plan.useAreas).filter(([,v])=>v>0).map(([u,v])=>[useNames[u]+'面积',fmt(v)+' m²']),['规划住房 / 岗位空间',fmt(plan.housingCapacity)+' 户 / '+fmt(plan.jobCapacity)+' 岗位空间'],['新增共享广场',fmt(plan.newPublicArea)+' m²']]:[])
        ])+plan.warnings.map(s=>`<p class="renewal-notice">${escape(s)}</p>`).join('')+`<div class="city-table-wrap"><table class="city-table"><thead><tr><th>分期</th><th>原地块</th><th>最低工期</th><th>投资 / 币</th></tr></thead><tbody>${plan.phases.map(p=>`<tr><td>第 ${p.index} 期</td><td>${p.sourceIds.length}</td><td>${p.demolitionMonths+p.constructionMonths} 月</td><td>${fmt(p.cost)}</td></tr>`).join('')}</tbody></table></div>`;
        el('renewal-commit').disabled=false;workspace.requestDraw();
      } catch(error){if(resultBox.isConnected&&ticket===formVersion)resultBox.textContent=error.message;throw error;}
    });
    el('renewal-commit').onclick=async()=>{
      if(!accepted)return;
      const ok=await command({...options,type:'renewal_start',token:accepted.token,name:el('renewal-name').value});
      if(ok){renewalPreview=null;renewalSelection=[];el('city-dialog').close();renderRenewals();workspace.requestDraw();showRenewal(state.renewals.at(-1).id);}
    };
  }
  function showRenewal(id) {
    pause();const p=(state.renewals||[]).find(p=>p.id===id);if(!p)return;
    const built=state.parcels.filter(q=>q.renewalProject===id&&q.building);
    const delivered=built.filter(q=>q.building.status!=='construction');
    dialog(`<h2>${escape(p.name)}</h2><p><b>${renewalStatus[p.status]}</b> · ${escape(p.reason)}</p>${p.origin==='automatic'?`<p class="renewal-notice">${escape(p.decision)}</p>`:''}${details([
      ['发起方式',p.origin==='automatic'?'系统自动评估':'手动立项'],['交付进度',`${p.phases.filter(s=>s.status==='complete').length} / ${p.phases.length} 期`],['已投入 / 总预算',`${fmt(p.spent)} / ${fmt(p.cost)} 币`],
      ['累计城内安置 / 迁出',`${fmt(p.relocated)} / ${fmt(p.movedOut)} 人`],['企业迁移 / 关闭',`${fmt(p.firmsRelocated)} / ${fmt(p.firmsClosed)} 个群组`],
      ['当前可使用建筑',`${fmt(delivered.length)} 栋`],['已入住人口 / 住房容量',`${fmt(delivered.reduce((n,q)=>n+(q.population||0),0))} 人 / ${fmt(delivered.filter(q=>q.building.use==='residential').reduce((n,q)=>n+q.building.capacity,0))} 户`],
      ['实际就业 / 经营空间容量',`${fmt(delivered.reduce((n,q)=>n+(q.building.employees||0),0))} / ${fmt(delivered.filter(q=>q.building.use!=='residential').reduce((n,q)=>n+q.building.capacity,0))}`]
    ])}<ol class="renewal-stages">${p.phases.map(s=>`<li><b>第 ${s.index} 期 · ${renewalStatus[s.status]}</b><small>${fmt(s.cost)} 币${s.ready&&['construction','demolition'].includes(s.status)?' · 本阶段预计 '+(s.completionDay!=null?new Date(Date.UTC(2026,0,1+s.completionDay)).toISOString().slice(0,10):date(s.ready))+' 完成':''}</small></li>`).join('')}</ol>
    <p class="city-note">运营数据来自城市模拟。最短工期不含安置、需求及预算等待；每次交付后可取消未开工阶段，已交付部分继续使用。</p>
    <div class="city-row"><button class="city-btn" id="renewal-locate">定位项目</button>${!['complete','cancelled'].includes(p.status)?`<button class="city-btn danger" id="renewal-cancel" ${p.phases.some(s=>['demolition','construction'].includes(s.status))?'disabled':''}>取消未开工阶段</button>`:''}</div>`);
    el('renewal-locate').onclick=()=>{renewalPreview=p;el('city-dialog').close();renewalSelection=state.parcels.filter(q=>q.renewalProject===id).map(q=>q.id);workspace.focus(p.boundary[0],5);renderRenewals();workspace.requestDraw();};
    if(el('renewal-cancel'))el('renewal-cancel').onclick=async()=>{if(await command({type:'renewal_cancel',id}))showRenewal(id);};
  }

  async function leaveCity() {
    await api('close');
    pause();active=false;session=null;state=null;currentSave=null;
    updateRoadValidation();
    clearTimeout(previewTimer);previewTicket++;draft=[];lineStops=[];clearBusPreview();toolDrafts.clear();
    document.body.classList.remove('city-mode','show-inspector');
    owned.forEach(selector=>document.querySelector(selector).hidden=true);
    el('city-dialog').close();workspace.cancelGeneration();window.AppNavigation.show('home');
  }
  async function files({returnHome=false}={}) {
    if(!active)return;
    pause();await task(async()=>{
      const data=await api('saves');
      const hasCurrent=data.saves.some(save=>save.name===currentSave);
      dialog(`<h2>${returnHome?'保存并返回主菜单':'保存城市'}</h2>
        <p>保存完整地形与当前城市规划，之后可从主菜单「加载地图」继续。</p>
        <p class="save-context">${currentSave?'当前存档：'+escape(currentSave):'首次保存城市规划，请为新存档命名。'}${draft.length||lineStops.length?'<br>尚未完成的绘制草稿不会写入存档，请先完成绘制。':''}</p>
        <form id="city-save-form">
          <div class="save-options" role="group" aria-label="保存方式">
            <label><input type="radio" name="save-mode" value="new" ${hasCurrent?'':'checked'}>新建存档</label>
            <label><input type="radio" name="save-mode" value="overwrite" ${hasCurrent?'checked':''} ${!currentSave||!data.saves.length?'disabled':''}>覆盖已有存档</label>
          </div>
          <div class="city-fields" id="save-new-fields"><label>新存档名称<input class="city-field" id="city-save-name" maxlength="60" placeholder="例如：临海新城" autocomplete="off"></label><small>最多 60 字，支持文字、数字、空格、下划线和短横线。同名存档不会被替换。</small></div>
          <div class="city-fields" id="save-overwrite-fields"><label>选择要覆盖的存档<select class="city-field" id="city-save-target">${data.saves.map((save,i)=>`<option value="${i}" ${save.name===currentSave?'selected':''}>${escape(saveLabel(save))}</option>`).join('')}</select></label><small>所选存档将被当前城市内容替换。</small></div>
          <button class="city-btn primary" id="file-save" type="submit">保存</button>
        </form>
        <div class="city-divider"></div><div class="city-row"><button class="city-btn" id="file-json">导出 JSON</button><button class="city-btn" id="file-open">加载其他地图</button><button class="city-btn" id="file-import">导入 JSON</button></div>
        ${returnHome?'<p class="city-note">返回主菜单前可保存进度，也可以放弃本次未保存的修改。</p><button class="city-btn danger" id="file-discard">不保存本次修改，返回主菜单</button>':'<div class="city-divider"></div><button class="city-btn" id="file-world">返回主菜单…</button>'}`);
      const mode=()=>el('city-save-form').querySelector('[name="save-mode"]:checked').value;
      const update=()=>{
        const isNew=mode()==='new';
        el('save-new-fields').hidden=!isNew;el('save-overwrite-fields').hidden=isNew;
        el('city-save-name').required=isNew;el('city-save-name').disabled=!isNew;
        el('file-save').textContent=(isNew?'新建存档':'覆盖所选存档')+(returnHome?'并返回主菜单':'');
      };
      el('city-save-form').querySelectorAll('[name="save-mode"]').forEach(input=>input.onchange=update);update();
      el('city-save-form').onsubmit=event=>{
        event.preventDefault();
        task(async()=>{
          const saveMode=mode(),name=saveMode==='new'?el('city-save-name').value.trim():data.saves[Number(el('city-save-target').value)]?.name;
          if(!name)throw new Error('请填写存档名称');
          const result=await api('save',{name,mode:saveMode});
          currentSave=result.name;state.name=result.name;render();
          workspace.toast('已保存：'+result.name);
          if(returnHome)await leaveCity();else el('city-dialog').close();
        });
      };
      el('file-json').onclick=()=>task(async()=>download(`${state.name}.json`,JSON.stringify(await api('export')),'json'));
      el('file-open').onclick=openSaves;
      el('file-import').onclick=()=>el('city-import-file').click();
      if(returnHome)el('file-discard').onclick=()=>task(leaveCity);
      else el('file-world').onclick=()=>files({returnHome:true});
    });
  }
  async function openSaves() {
    pause();await task(async()=>{
      const data=await api('saves');
      dialog(`<h2>加载地图</h2><p>选择地形起点、城市存档或自动保存，继续城市规划。${active?'切换前会自动保留当前城市检查点。':''}</p><div class="city-list">${data.saves.map((s,i)=>`<button class="city-list-item" data-save-index="${i}"><b>${escape(saveLabel(s))}</b><small>${new Date(s.modified*1000).toLocaleString('zh-CN')} · ${fmt(s.bytes/1024)} KB</small></button>`).join('')||'<p class="city-note">还没有存档。返回主菜单选择「新建地图」，确认地形后会自动保存。</p>'}</div><div class="city-divider"></div><div class="city-row"><button class="city-btn" id="open-import">导入 JSON 文件</button><button class="city-btn" id="open-cases">城市案例</button></div>`);
      el('open-import').onclick=()=>el('city-import-file').click();el('open-cases').onclick=()=>el('city-valley').click();
      el('city-dialog-body').querySelectorAll('[data-save-index]').forEach(b=>b.onclick=()=>task(async()=>{
        if(active)await api('checkpoint');
        const result=await api('load',{name:data.saves[Number(b.dataset.saveIndex)].name});
        activate(result);el('city-dialog').close();status('地图与城市规划已恢复');
      }));
    });
  }
  async function download(name,contents,type) {
    if(window.terrainAPI?.saveFile) {
      const result=await window.terrainAPI.saveFile({filename:name,text:contents,type});
      if(!result.canceled)workspace.toast('文件已导出');
    }else{
      const url=URL.createObjectURL(new Blob([contents],{type:type==='csv'?'text/csv;charset=utf-8':'application/json'}));
      const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      workspace.toast('文件已导出');
    }
  }
  function historyDialog() {
    const columns=[['date','结算日期'],['population','人口'],['jobs','岗位'],['commute','通勤 min'],['landValue','地价 币/m²'],['vacancy','空置率 %']];
    dialog(`<h2>城市历史与年鉴</h2><p>每日结算时的状态；交通为典型日结果。</p>${state.annual?.length?'<h3>年度汇总</h3>'+state.annual.map(a=>'<p>第 '+a.year+' 年：人口 '+fmt(a.population)+'，岗位 '+fmt(a.jobs)+'，迁入 '+fmt(a.movedIn)+'，迁出 '+fmt(a.movedOut)+'，收入 '+fmt(a.revenue)+' 币，维护运营 '+fmt(a.maintenance)+' 币</p>').join(''):''}<div class="city-table-wrap"><table class="city-table"><thead><tr>${columns.map(c=>`<th>${c[1]}</th>`).join('')}</tr></thead><tbody>${(state.dailyHistory||[]).slice().reverse().map(s=>`<tr>${columns.map(([k])=>`<td>${k==='date'?(s.periodDays>1?s.periodStartDate+' 至 '+s.date:s.date):fmt(s[k],1)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
  }
  document.querySelectorAll('[data-panel]').forEach(b=>b.onclick=()=>showPanel(b.dataset.panel));
  document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
  el('city-renewal-clear').onclick=()=>{renewalSelection=[];renewalPreview=null;renderRenewals();workspace.requestDraw();};
  el('city-renewal-preview').onclick=()=>previewSelectedRenewal();
  el('city-dialog').addEventListener('cancel',event=>{if(working)event.preventDefault();});
  el('city-dialog').addEventListener('close',()=>{renewalPreview=null;workspace.requestDraw();});
  el('city-start').onclick=()=>task(async()=>{if(!workspace.canConfirm)return;const result=await api('create',{worldId:workspace.terrain.worldId,saveTerrain:true});activate(result);workspace.toast('地形已自动保存，开始城市规划');status('地形起点已保存 · 绘制第一条街道，或生成示范街区。');});
  el('city-demo').onclick=()=>task(async()=>{
    if(workspace.busy)return;
    await workspace.demoTerrain();
    activate(await api('create',{worldId:workspace.terrain.worldId,name:'青野新城'}));
    state=await api('command',{command:{type:'demo'}});
    state=await api('step',{months:12});
    render();const pts=state.roads.flatMap(r=>r.points);
    if(pts.length)workspace.focus([pts.reduce((s,p)=>s+p[0],0)/pts.length,pts.reduce((s,p)=>s+p[1],0)/pts.length],4);
    status('示范城市已模拟一年。继续建设道路、设置公交，观察城市变化。');
  });
  el('city-open-world').onclick=openSaves;
  el('city-valley').onclick=()=>{
    dialog('<h2>城市案例</h2><h3>林荫大道 · 实景街区</h3><p>曲线大道、喷泉广场和低层建筑组成的可编辑街区。观察日照、夜景、材质与交通信号，继续绘制和改造道路。</p><div class="city-row"><button class="city-btn primary" id="architectural-scene">打开实景街区</button></div><h3>城市自然生长案例</h3><p>双岸河谷：河流、山地、桥梁、曲线主路与四类公共交通。</p><div class="city-row"><button class="city-btn" id="valley-empty">从空路网开始</button><button class="city-btn primary" id="valley-grown">打开已生长案例</button></div><h3>小街区布局</h3><p>曲线街道围合不同形状的街区，观察连续街墙、围合庭院、折转小巷、侧边绿地及少量整块项目。全部由道路和需求自动生长。</p><div class="city-row"><button class="city-btn" id="blocks-empty">从小街区路网开始</button><button class="city-btn primary" id="blocks-grown">查看小街区布局案例</button></div>');
    el('architectural-scene').onclick=()=>task(async()=>{if(active)await api('checkpoint');activate(await api('scenario',{variant:'architectural'}));el('city-dialog').close();workspace.focus([490,605],7);showPanel('data');status('实景街区已打开 · 拖动时间查看日照与夜景');});
    for(const [id,mature,variant] of [['valley-empty',false,'valley'],['valley-grown',true,'valley'],['blocks-empty',false,'blocks'],['blocks-grown',true,'blocks']])el(id).onclick=()=>task(async()=>{activate(await api('scenario',{mature,variant}));el('city-dialog').close();if(variant==='blocks')workspace.focus([2265,2390],8);status(mature?'已打开城市自然生长结果':'路网已就绪，可以推进月份观察城市生长');});
  };
  el('city-grid-demo').onclick=()=>command({type:'demo'}).then(()=>{if(state.roads.length)workspace.focus(state.roads[Math.floor(state.roads.length/2)].points[0],3);});
  el('city-finish').onclick=finish;el('city-cancel').onclick=()=>{draft=[];editingRoad=null;preview=null;toolDrafts.delete(tool);clearTimeout(previewTimer);previewTicket++;updateHint();workspace.requestAnimation();};
  el('city-special-rotate').onclick=()=>{el('city-special-rotation').value=(Number(el('city-special-rotation').value)+15)%360;scheduleSpecialPreview();workspace.requestAnimation();};
  for(const id of ['city-special-size','city-special-rotation','city-special-name'])el(id).oninput=()=>{scheduleSpecialPreview();workspace.requestAnimation();};
  el('city-undo').onclick=()=>command({type:'undo'});el('city-redo').onclick=()=>command({type:'redo'});
  el('city-play').onclick=()=>{if(simulation.running)pause();else simulation.start();};
  el('city-speed').oninput=()=>simulation.setSpeed(window.CitySimulation.speeds[Number(el('city-speed').value)]).catch(()=>{});
  el('signal-reset').onclick=()=>simulation.reset().catch(()=>{});
  el('signal-demand').onchange=()=>simulation.reset().catch(()=>{});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
  el('signal-apply').onclick=()=>command({type:'signal_timing',values:{signalGreenSeconds:Number(el('signal-green').value),signalYellowSeconds:Number(el('signal-yellow').value),signalClearanceSeconds:Number(el('signal-clearance').value)}});
  el('city-mode').onchange=()=>{if(state)el('city-capacity').value=state.meta.transitTypes[el('city-mode').value].capacity;lineStops=[];editingLine=null;toolDrafts.delete('line');clearBusPreview();updateHint();workspace.requestDraw();};
  el('city-create-line').onclick=()=>command({type:el('city-mode').value==='bus'?'bus_line':editingLine?'line_update':'line',id:editingLine,name:el('city-line-name').value,mode:el('city-mode').value,stops:[...lineStops],
    headway:Number(el('city-headway').value),capacity:Number(el('city-capacity').value),hours:Number(el('city-hours').value),mixed:el('city-mixed').checked,oneway:!!el('transit-oneway')?.checked}).then(ok=>{if(ok){lineStops=[];editingLine=null;clearBusPreview();toolDrafts.delete('line');status('线路已保存 · 开始模拟后按班距运营');}updateHint();workspace.requestDraw();});
  el('city-clear-line').onclick=()=>{if(working)return;lineStops=[];clearBusPreview();updateHint();workspace.requestDraw();};
  el('city-coordinate-apply').onclick=()=>{const point=[Number(el('city-coordinate-x').value),Number(el('city-coordinate-y').value)];if(point.some(v=>!Number.isFinite(v))||point[0]<0||point[1]<0||point[0]>state.meta.width||point[1]>state.meta.height){status('坐标超出世界范围',true);return;}handlePoint(point);};
  el('city-object-picker').onchange=()=>{const id=el('city-object-picker').value;if(!id)return;const object=[...state.parcels,...state.roads,...state.stops,...state.lines,...state.facilities,...state.districts].find(o=>o.id===id);const point=object.center||object.point||object.points?.[0]||state.stops.find(s=>s.id===object.stops?.[0])?.point;if(point){workspace.focus(point,5);el('city-coordinate-x').value=Math.round(point[0]);el('city-coordinate-y').value=Math.round(point[1]);}inspect(id);};
  el('city-shape').onchange=()=>{schedulePreview();updateHint();workspace.requestAnimation();};
  el('city-level').onchange=el('city-oneway').onchange=el('city-auto-route').onchange=()=>{schedulePreview();updateHint();workspace.requestAnimation();};
  el('city-auto-renew').onchange=()=>command({type:'settings',values:{autoRenew:el('city-auto-renew').checked}});
  el('city-auto-grow').onchange=()=>command({type:'settings',values:{autoGrow:el('city-auto-grow').checked}});
  el('city-query-clear').onclick=()=>{queryResult=null;workspace.requestDraw();};
  el('city-layer').onchange=()=>{layer=el('city-layer').value;renderLegend();workspace.requestDraw();};
  el('city-traffic-period').onchange=()=>{trafficPeriod=el('city-traffic-period').value;renderLegend();workspace.requestDraw();};
  function updateAppearance(){
    const preferences=window.CityScene.configure({quality:el('city-render-quality').value,labels:el('city-render-labels').checked});
    try{localStorage.setItem('shanhai-scene-v1',JSON.stringify(preferences));}catch{}
    workspace.setDisplayMode(preferences.quality);
  }
  el('city-render-quality').onchange=updateAppearance;
  el('city-render-labels').onchange=()=>{window.CityScene.configure({labels:el('city-render-labels').checked});try{localStorage.setItem('shanhai-scene-v1',JSON.stringify(window.CityScene.settings));}catch{}workspace.requestDraw();};
  el('city-show-transit-lines').onchange=()=>workspace.requestDraw();
  function updateSceneClock(previewSeconds){
    const seconds=previewSeconds??(scenePreviewMinute!==null?scenePreviewMinute*60:state?.sceneTimeSeconds??9*3600),lighting=window.CityScene.setTime(seconds);
    const minute=Math.floor(((seconds%86400)+86400)%86400/60),text=String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
    const phase=lighting.night>.8?'夜晚':lighting.elevation<12?(lighting.hour<12?'清晨':'黄昏'):'白天';
    el('city-time-value').textContent=text+' · '+phase;el('city-time-of-day').value=minute;el('city-time-of-day').setAttribute('aria-valuetext',text+' '+phase);
    const display=el('city-day-clock');if(display)display.textContent='光照 '+text+' · '+phase;
  }
  document.querySelector('.map-label').insertAdjacentHTML('beforeend','<span class="map-label-divider"></span><span id="city-day-clock">09:00 · 白天</span>');
  el('city-time-of-day').oninput=()=>{scenePreviewMinute=Number(el('city-time-of-day').value);pause();updateSceneClock();workspace.requestDraw();};
  el('city-time-of-day').onchange=()=>{
    const minute=scenePreviewMinute??Number(el('city-time-of-day').value);
    return task(async()=>{
      try{const result=await api('clock',{minute});state.sceneTimeSeconds=result.sceneTimeSeconds;state.simulation=result.simulation;}
      finally{scenePreviewMinute=null;updateSceneClock();updateSimulationControls();workspace.requestDraw();}
    });
  };
  try{
    const saved=JSON.parse(localStorage.getItem('shanhai-scene-v1')||'null');
    if(saved&&typeof saved==='object'){
      const preferences=window.CityScene.configure(saved);el('city-render-quality').value=preferences.quality;el('city-render-labels').checked=preferences.labels;
    }
  }catch{}
  el('city-dashboard').onclick=()=>{selected=null;document.body.classList.add('show-inspector');renderInspector();};
  el('city-save').onclick=files;el('city-files').onclick=files;el('city-dialog-close').onclick=()=>el('city-dialog').close();
  el('city-settings').onclick=()=>command({type:'settings',values:{migration:Number(el('city-migration').value),externalJobs:Number(el('city-external').value),growth:Number(el('city-growth').value),fare:Number(el('city-fare').value),budget:el('city-budget').checked,autoGrow:el('city-auto-grow').checked,accessBudget:Number(el('city-access-budget').value)}});
  el('city-history').onclick=historyDialog;el('city-compare').onclick=compareSaves;el('city-summary').onclick=()=>task(async()=>download(state.name+'-情景摘要.json',JSON.stringify(await api('summary'),null,2),'json'));
  el('city-csv').onclick=()=>task(async()=>{
    const keys=Object.keys(state.stats).filter(k=>!state.stats[k]||typeof state.stats[k]!=='object');
    const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';
    const content='\uFEFF'+['模型版本','空间范围','日结算日期','计费起始日期','结算覆盖天数',...keys.map(k=>{const m=state.meta.metrics[k];return `${m.label} [${m.unit}; ${m.period}; ${m.estimated?'估算':'模拟状态'}]`;})].map(quote).join(',')+'\r\n'
      +(state.dailyHistory||[]).map(s=>[s.model||state.meta.model,'全市',s.date,s.periodStartDate,s.periodDays,...keys.map(k=>s[k]??'')].map(quote).join(',')).join('\r\n');
    await download(state.name+'-统计.csv',content,'csv');
  });
  el('city-baseline').onclick=()=>{baseline=structuredClone(state.stats);renderInspector();status('已记录基线，未改变当前城市');};
  el('city-branch').onclick=()=>task(async()=>{pause();const result=await api('branch',{name:state.name+'方案'});baseline=result.baseline;activate(result);status('已保存原方案并创建独立分支');});
  el('city-import-file').onchange=()=>task(async()=>{
    const file=el('city-import-file').files[0];if(!file)return;
    if(file.size>350000000)throw new Error('存档文件过大');
    if(active)await api('checkpoint');
    const result=await api('import',{snapshot:JSON.parse(await file.text())});activate(result);el('city-dialog').close();el('city-import-file').value='';
  });
  window.addEventListener('terrain-state',()=>{el('city-start').disabled=working||!workspace.canConfirm;});

  el('city-create-freight').onclick=()=>command({type:'freight_service',start:el('city-freight-start').value,end:el('city-freight-end').value,trainsPerDay:Number(el('city-freight-trains').value),tonnesPerTrain:Number(el('city-freight-tonnes').value)});
  el('city-calibration').onclick=()=>{
    dialog(`<h2>模型校准 · ${escape(state.policy.version)}</h2><p>数值为游戏模型参数。改动会保存在当前城市中。</p><div class="city-fields">${Object.entries(state.meta.parameters||{}).map(([k,p])=>`<label>${escape(p.label||k)} · ${escape(p.unit)}<input class="city-field" data-policy="${escape(k)}" type="number" step="any" min="0.00001" value="${p.value}"></label>`).join('')}</div><button class="city-btn" id="city-policy-apply">保存校准参数</button>`);
    el('city-policy-apply').onclick=()=>{const values=Object.fromEntries([...document.querySelectorAll('[data-policy]')].map(e=>[e.dataset.policy,Number(e.value)]));command({type:'policy',values});};
  };
  el('city-performance').onclick=()=>{
    if(!active)return;pause();el('city-performance').disabled=true;
    const durations=[],feedback=[];let previous=performance.now(),started=previous;
    const input=event=>{const at=event.timeStamp;requestAnimationFrame(()=>feedback.push(performance.now()-at));};
    canvas.addEventListener('pointermove',input);canvas.addEventListener('wheel',input);
    el('city-performance-result').textContent='测量中：请持续平移或缩放地图。';
    function frame(now){durations.push(now-previous);previous=now;workspace.requestAnimation();
      if(now-started<10000){requestAnimationFrame(frame);return;}
      canvas.removeEventListener('pointermove',input);canvas.removeEventListener('wheel',input);
      const sorted=durations.slice(2).sort((a,b)=>a-b),inputs=feedback.sort((a,b)=>a-b);
      const result={sample:'当前可见城市与缩放',buildings:state.stats.buildings,roads:state.roads.length,frames:sorted.length,fps:Number((1000/(sorted.reduce((a,b)=>a+b,0)/sorted.length)).toFixed(1)),frameP95:Number(sorted[Math.floor(sorted.length*.95)].toFixed(1)),inputSamples:inputs.length,inputP95:inputs.length?Number(inputs[Math.floor(inputs.length*.95)].toFixed(1)):null,viewport:[canvas.clientWidth,canvas.clientHeight],pixelRatio:devicePixelRatio};
      el('city-performance-result').textContent=JSON.stringify(result);el('city-performance').disabled=false;
    }requestAnimationFrame(frame);
  };

  window.CityApp={setTool,inspect,transitDetails:id=>api('query',{kind:'transit',line:id}),updateTransit:changes=>command({type:'line_update',...changes}),refreshBusPreview:()=>{scheduleBusPreview();updateHint();workspace.requestDraw();},get busDraft(){return {stops:[...lineStops],preview:busPreview,editing:editingLine};},refreshOverviewChart:drawChart,previewRenewal:previewSelectedRenewal,get renewalSelection(){return [...renewalSelection];},get traffic(){return trafficState;},get active(){return active;},get working(){return working;},get state(){return state;},get selected(){return selected;},get tool(){return tool;},get canCacheBase(){return canCacheBase();},paint,refreshLegend:renderLegend,openSaves,returnHome:()=>files({returnHome:true})};
  el('city-start').disabled=!workspace.canConfirm;
})();
