/* Unified rail construction, platform selection and operation. All validation is server-owned. */
(() => {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=(v,d=0)=>v==null?'—':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:d});
  const levels={'-1':'地下','0':'地面','1':'高架'},patterns={shuttle:'开放式往返',loop:'顺向环线',loop_reverse:'逆向环线',loop_both:'双向环线',oneway:'单向载客 · 空车回送'};
  const state=()=>CityApp.state, redraw=()=>MapWorkspace.requestDraw(),command=c=>CityApp.railCommand(c),api=(action,data)=>CityApp.railApi(action,data);
  let host,action=null,position=null,preview=null,ticket=0,timer,route=[],editing=null,outdoor=null,entryMode=false,entryEdit=null,selectedBuildings=null;
  let dialog,data,identity=null,filter='all',statusFilter='all',returnFocus;
  const drafts=new Map();let loading=0;
  const $=id=>document.getElementById(id);
  function hint(message,error=false){if($('rail-hint')){$('rail-hint').textContent=message;$('rail-hint').classList.toggle('error',error);}}
  function fields(){return {name:$('rail-name')?.value||'',mode:action==='train_station'?'train':'metro',level:Number($('rail-level')?.value??-1),platformCount:Number($('rail-count')?.value||2),platformLength:Number($('rail-length')?.value||120),rotation:Number($('rail-rotation')?.value||0)};}
  function stationCommand(){return {type:'rail_station',...fields(),point:position,...(outdoor?{outdoorPoint:outdoor}:{}),...(selectedBuildings?{buildings:selectedBuildings}:{})};}
  function lineCommand(){return {type:editing?'line_update':'line',id:editing,mode:'metro',name:$('rail-name')?.value||'新铁路线路',stops:route.map(r=>r.station),platforms:Object.fromEntries(route.map(r=>[r.station,r.platform])),headway:Number($('rail-headway')?.value||10),formation:Number($('rail-formation')?.value||4),vehicleType:$('rail-vehicle')?.value||'urban',servicePattern:$('rail-pattern')?.value||'shuttle',...(!editing?{hours:16,startHour:6}:{})};}
  async function refresh(){
    clearTimeout(timer);const seq=++ticket;preview=null;
    const station=['metro_station','train_station'].includes(action);
    if(station&&!position)return;if(action==='rail_line'&&route.length<2){renderRoute();return;}
    if(!station&&action!=='rail_line')return;
    hint('正在校验连接、空间与费用…');
    const cmd=station?stationCommand():lineCommand();
    timer=setTimeout(async()=>{try{
      const result=await api('rail_preview',{command:cmd});if(seq!==ticket)return;preview=result;
      hint(result.valid?(station?`总建设费 ${fmt(result.cost)} 元 · ${result.station.platforms.length} 个站台 · 点击建造 / Enter 确认`:`${route.length} 站 · 完整运行周期 ${fmt(result.minutes,1)} 分钟 · Enter 创建`):result.reason,!result.valid);
      if(station){
        for(const option of $('rail-level').options){option.disabled=!result.allowedLevels?.includes(Number(option.value));option.title=option.disabled?'已有建筑处仅允许地下建设':'';}
        if(result.buildings){$('rail-buildings').innerHTML=result.buildings.length?'<legend>建筑内部入口 · 仅关联勾选建筑</legend>'+result.buildings.map(b=>`<label><input type="checkbox" data-rail-building="${esc(b.id)}" ${(selectedBuildings||result.station.entrances.filter(e=>e.kind==='building').map(e=>e.building)).includes(b.id)?'checked':''}>${esc(b.name)}</label>`).join(''):'';
          $('rail-buildings').querySelectorAll('input').forEach(n=>n.onchange=()=>{selectedBuildings=[...$('rail-buildings').querySelectorAll('input:checked')].map(n=>n.dataset.railBuilding);refresh();});}
      }
      redraw();
    }catch(e){if(seq===ticket)hint(e.message,true);}},140);
    renderRoute();redraw();
  }
  function renderRoute(){
    if(!$('rail-route'))return;
    $('rail-route').innerHTML=route.map((r,i)=>{const s=state().stops.find(s=>s.id===r.station),p=s?.platforms?.find(p=>p.id===r.platform);return `<li>${i+1}. ${esc(s?.name||'已删除')} · ${p?`${p.number} 号站台`: '旧站台'} <button type="button" class="city-btn" data-rail-remove="${i}" aria-label="移除第 ${i+1} 站">×</button></li>`;}).join('');
    $('rail-route').querySelectorAll('button').forEach(b=>b.onclick=()=>{route.splice(Number(b.dataset.railRemove),1);refresh();});
  }
  function mount(target,next){
    host=target;action=next;position=null;preview=null;outdoor=null;selectedBuildings=null;entryMode=false;entryEdit=null;ticket++;clearTimeout(timer);
    const station=['metro_station','train_station'].includes(action);
    if(action==='rail_manage'){CityApp.setTool('select');openManager();host.innerHTML='';return;}
    if(action==='train_track'){
      CityApp.setTool('train');host.innerHTML='<p>兼容地铁与火车 · 接近站台端口自动吸附 · 同层分支需另建道岔。不同层接入口需要明确选择接入，坡道不小于 134 米。</p><div id="rail-track-options" class="rail-fields"></div><label><input id="rail-underground" type="checkbox" checked>地下剖切视图</label>';
      const options=$('rail-track-options');for(const id of ['city-level','city-shape']){const src=$(id);const label=document.createElement('label');label.textContent=id==='city-level'?'轨道层级':'轨道形状';const select=src.cloneNode(true);select.id='rail-'+id;select.value=src.value;select.onchange=()=>{src.value=select.value;src.dispatchEvent(new Event('change'));};label.append(select);options.append(label);}
      $('rail-underground').onchange=redraw;return;
    }
    CityApp.setTool(station?'rail_station':action==='rail_line'?'rail_line':'rail_facility');
    if(station){
      host.innerHTML=`<div class="rail-fields"><label>站名<input id="rail-name" maxlength="60" placeholder="自动命名"></label><label>车站层级<select id="rail-level"><option value="1">高架</option><option value="-1" selected>地下</option><option value="0">地面</option></select></label><label>站台数量<input id="rail-count" type="number" min="1" max="8" value="2"></label></div><details class="rail-build-advanced"><summary>尺寸与朝向</summary><div class="rail-fields"><label>站台长度 / m<select id="rail-length">${[60,120,180,240,360].map(n=>`<option ${n===120?'selected':''}>${n}</option>`).join('')}</select></label><label>朝向 / °<input id="rail-rotation" type="number" min="0" max="359" step="15" value="0"></label><button class="city-btn" id="rail-rotate">旋转 · R</button></div></details><fieldset id="rail-buildings"></fieldset><div class="rail-actions"><button id="rail-entry-position" class="city-btn">调整室外入口</button><button id="rail-build" class="city-btn primary">确认建设 · Enter</button><label><input id="rail-underground" type="checkbox" checked>地下剖切视图</label></div><p id="rail-hint" role="status" aria-live="polite">移动鼠标预览占地、站台端口与入口。每个编号站台包含双向股道。</p>`;
      $('rail-rotate').onclick=()=>{$('rail-rotation').value=(Number($('rail-rotation').value)+15)%360;refresh();};
      $('rail-entry-position').onclick=()=>{entryMode=true;hint('点击地图设置室外入口；车站主体位置保留');};
      $('rail-build').onclick=commit;
    }else if(action==='rail_line'){
      route=[];editing=null;
      host.innerHTML=`<div class="rail-fields"><label>线路名称<input id="rail-name" maxlength="60" placeholder="新铁路线路"></label></div><details class="rail-build-advanced"><summary>车辆与运行方式</summary><div class="rail-fields"><label>运行方式<select id="rail-pattern">${Object.entries(patterns).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><label>车型<select id="rail-vehicle"><option value="urban">通用市域列车</option><option value="regional">通用城际列车</option></select></label><label>编组 / 节<input id="rail-formation" type="number" min="1" max="12" value="4"></label><label>班距 / 分<input id="rail-headway" type="number" min="1" max="120" value="10"></label></div></details><div class="rail-fields"><label>选择车站<select id="rail-select-station">${state().stops.filter(s=>['train','metro'].includes(s.mode)&&s.role!=='freight').map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label><label>具体站台<select id="rail-select-platform"></select></label><button id="rail-add-stop" class="city-btn">加入停站顺序</button></div><ol id="rail-route" class="rail-route"></ol><div class="rail-actions"><button class="city-btn primary" id="rail-build">创建线路 · Enter</button><button class="city-btn" id="rail-undo-stop">撤回 · Backspace</button><label><input id="rail-underground" type="checkbox" checked>地下剖切视图</label></div><p id="rail-hint" role="status" aria-live="polite">点击具体站台或使用选择器，至少选择两座不同车站。终点须有折返设施。</p>`;
      $('rail-select-station').onchange=platformOptions;platformOptions();$('rail-add-stop').onclick=()=>addStop($('rail-select-station').value,$('rail-select-platform').value);
      $('rail-build').onclick=commit;$('rail-undo-stop').onclick=()=>{route.pop();refresh();};
    }else{
      host.innerHTML=`<div class="rail-fields"><label>层级<select id="rail-facility-level"><option value="-1">地下</option><option value="0" selected>地面</option><option value="1">高架</option></select></label><label>站台<select id="rail-facility-platform">${state().stops.flatMap(s=>(s.platforms||[]).map(p=>`<option value="${esc(p.id)}">${esc(s.name)} · ${p.number} 号站台${p.turnback?' · 已有折返':''}</option>`)).join('')}</select></label><button id="rail-facility-build" class="city-btn primary">${action==='rail_turnback'?'建设折返设施':action==='rail_passing'?'建设真实越行轨道':'点击同层轨道接点建道岔'}</button><label><input id="rail-underground" type="checkbox" checked>地下剖切视图</label></div><p id="rail-hint" role="status">${action==='rail_switch'?'道岔必须放在同层轨道的真实相交点。':'选择站台后建设；也可以点击地图上的站台。'}</p>`;
      $('rail-facility-build').onclick=()=>facility(position);
    }
    host.querySelectorAll('input,select').forEach(node=>{if(node.id==='rail-underground')node.onchange=redraw;else if(!node.onchange)node.onchange=refresh;});
  }
  function platformOptions(){const s=state().stops.find(s=>s.id===$('rail-select-station').value);$('rail-select-platform').innerHTML=(s?.platforms||[{id:s?.id,number:1,connected:s?.connected}]).map(p=>`<option value="${esc(p.id)}">${p.number} 号站台 · ${p.connected?'已接轨':'待连接'} · ${state().lines.filter(l=>l.platforms?.[s.id]===p.id).length} 条线</option>`).join('');}
  function addStop(sid,pid){if(!sid)return;const existing=route.find(r=>r.station===sid);if(existing)existing.platform=pid;else route.push({station:sid,platform:pid});refresh();}
  function nearest(point,ports=false){let result=null,d=Infinity;for(const s of state().stops)for(const p of s.platforms||[]){for(const q of ports?p.ports:[p.point]){const n=Math.hypot(q[0]-point[0],q[1]-point[1]);if(n<d){d=n;result={station:s,platform:p,point:q,distance:n};}}}return d<45?result:null;}
  async function facility(point){
    const kind={rail_switch:'switch',rail_turnback:'turnback',rail_passing:'passing'}[action];if(!kind)return;
    let platform=$('rail-facility-platform')?.value,level=Number($('rail-facility-level')?.value||0);
    if(kind!=='switch'){const pair=state().stops.flatMap(s=>(s.platforms||[]).map(p=>({s,p}))).find(x=>x.p.id===platform);if(!pair){hint('请先建设车站',true);return;}point=pair.p.point;level=pair.s.level;}
    if(!point){hint('请点击地图上的同层轨道接点',true);return;}
    const cmd={type:'rail_facility',kind,point,level,platform},signature=JSON.stringify(cmd);
    if(preview?.facilityCommand!==signature||preview.revision!==state().revision){
      const result=await api('rail_preview',{command:cmd});preview={...result,facilityCommand:signature,revision:state().revision};
      hint(result.valid?`建设费用 ${fmt(result.cost)} 元 · 再次点击确认建设`:result.reason,!result.valid);
      if(result.valid)$('rail-facility-build').textContent=`确认建设 · ${fmt(result.cost)} 元`;redraw();return;
    }
    if(!preview.valid)return;
    const ok=await command(cmd);preview=null;hint(ok?'设施已建成；相关线路连接已更新':$('city-status').textContent,!ok);redraw();
  }
  async function commit(){
    if(CityApp.working)return;
    const station=['metro_station','train_station'].includes(action),cmd=station?stationCommand():lineCommand();
    if(station&&!position){hint('请先在地图上选择位置',true);return;}
    const result=await api('rail_preview',{command:cmd});preview=result;
    if(!result.valid){hint(result.reason,true);redraw();return;}
    const ok=await command(cmd);
    if(ok){hint(station?'车站已建成。连接各站台端口后建设折返设施、创建线路。':'线路已创建，可在统一管理页调整运营。');route=[];renderRoute();preview=null;position=null;}
    else hint($('city-status').textContent,true);
    redraw();
  }
  function move(point){
    if(CityApp.tool==='rail_station'&&point&&!entryMode){position=point;refresh();redraw();}
  }
  function point(point){
    if(CityApp.tool==='rail_entry'){
      if(entryEdit){const info=entryEdit;command({type:'rail_entry',station:info.station,id:info.id,action:info.id?'move':'add',point,rotation:info.rotation}).then(ok=>{if(ok){entryEdit=null;CityApp.setTool('select');openStation(info.station);}});return true;}return false;
    }
    if(CityApp.tool==='rail_station'){
      if(entryMode){outdoor=point;entryMode=false;refresh();}else{position=point;commit();}return true;
    }
    if(CityApp.tool==='rail_line'){
      const found=nearest(point);if(found){$('rail-select-station').value=found.station.id;platformOptions();$('rail-select-platform').value=found.platform.id;addStop(found.station.id,found.platform.id);}else hint('请选择已建车站的具体站台',true);return true;
    }
    if(CityApp.tool==='rail_facility'){
      position=point;const found=nearest(point);if(found&&action!=='rail_switch')$('rail-facility-platform').value=found.platform.id;facility(point);return true;
    }
    return false;
  }
  function key(event){
    if(!['rail_station','rail_line','rail_facility','rail_entry'].includes(CityApp.tool))return false;
    if(event.key==='Escape'){entryEdit=null;action=null;preview=null;route=[];ticket++;clearTimeout(timer);CityApp.setTool('select');redraw();}
    else if(event.key==='Enter'){if(CityApp.tool==='rail_facility')facility(position);else commit();}
    else if(event.key==='Backspace'&&CityApp.tool==='rail_line'){route.pop();refresh();}
    else if(event.key.toLowerCase()==='r'&&$('rail-rotate'))$('rail-rotate').click();else return false;
    event.preventDefault();return true;
  }
  function draw(ctx,scale){
    if(!state())return;const guides=['rail_station','rail_line','rail_facility','rail_entry','train','metro'].includes(CityApp.tool),slice=guides&&($('rail-underground')?.checked||CityApp.tool==='rail_station');
    ctx.save();
    const path=(points,closed=false)=>{if(!points?.length)return;ctx.beginPath();ctx.moveTo(...points[0]);points.slice(1).forEach(p=>ctx.lineTo(...p));if(closed)ctx.closePath();};
    if(slice){ctx.strokeStyle='#5079a7';ctx.lineWidth=2/scale;ctx.setLineDash([7/scale,4/scale]);for(const r of state().roads)if(['train','metro'].includes(r.kind)&&r.level<0){path(r.points);ctx.stroke();}ctx.setLineDash([]);}
    const drawStation=(s,draft=false)=>{
      if(s.level<0&&!slice&&!draft)return;
      path(s.footprint,true);ctx.fillStyle=draft?(preview?.valid===false?'#a84c3933':'#2e8b7844'):'#7599a52b';ctx.fill();ctx.strokeStyle=draft?'#bd813b':'#657f8c';ctx.lineWidth=1/scale;ctx.stroke();
      for(const p of s.platforms||[]){path(p.ports);ctx.strokeStyle=route.some(r=>r.platform===p.id)?'#d38c31':'#427e84';ctx.lineWidth=4/scale;ctx.stroke();for(const q of p.ports){ctx.beginPath();ctx.arc(...q,4/scale,0,Math.PI*2);ctx.fillStyle=p.connected?'#448f7f':'#d19349';ctx.fill();}ctx.fillStyle='#1d404b';ctx.font=`${11/scale}px sans-serif`;ctx.textAlign='center';ctx.fillText(`${p.number} 号站台`,p.point[0],p.point[1]-7/scale);}
      for(const e of s.entrances||[]){path(e.path);ctx.strokeStyle=e.enabled===false?'#9d9d9d':e.kind==='building'?'#9d6b99':'#568a6a';ctx.lineWidth=1.5/scale;ctx.stroke();ctx.fillStyle=ctx.strokeStyle;ctx.fillRect(e.point[0]-3/scale,e.point[1]-3/scale,6/scale,6/scale);}
    };
    for(const s of state().stops)if(s.railStation&&(guides||s.id===CityApp.selected))drawStation(s);
    if(preview?.station)drawStation(preview.station,true);
    if(preview?.facility?.footprint){path(preview.facility.footprint,true);ctx.fillStyle='#b2783544';ctx.fill();ctx.strokeStyle='#b27835';ctx.lineWidth=2/scale;ctx.stroke();}
    ctx.strokeStyle='#b27835';ctx.lineWidth=3/scale;for(const p of preview?.paths||[]){path(p.points);ctx.stroke();}
    if(slice)for(const p of state().railInfrastructure?.passages||[]){path(p.points);ctx.strokeStyle=p.valid?'#4d988d':'#a78369';ctx.lineWidth=3/scale;ctx.stroke();}
    for(const f of state().railInfrastructure?.facilities||[]){if(!guides||f.level<0&&!slice)continue;ctx.fillStyle=f.kind==='switch'?'#a87343':'#488985';ctx.font=`${12/scale}px sans-serif`;ctx.fillText({switch:'⑂',turnback:'↶',passing:'⇄'}[f.kind],f.point[0],f.point[1]);}
    for(const t of state().railRuntime?.trains||[]){if(!t.point)continue;ctx.save();ctx.translate(...t.point);ctx.rotate(t.angle);ctx.translate(0,2.4);ctx.fillStyle=/^#[\da-f]{6}$/i.test(t.color)?t.color:'#3d827a';ctx.strokeStyle='#fff';ctx.lineWidth=.7/scale;const length=t.length;ctx.fillRect(-length/2,-1.5,length,3);ctx.strokeRect(-length/2,-1.5,length,3);ctx.restore();}
    ctx.restore();
  }
  function shell(){
    if(dialog)return;
    dialog=document.createElement('dialog');dialog.id='rail-management';dialog.setAttribute('aria-labelledby','rm-title');dialog.innerHTML='<header class="rm-header"><div><small>公共交通 · 地铁 / 火车 / 直通</small><h2 id="rm-title">铁路管理</h2></div><button class="icon-btn" id="rm-close" aria-label="关闭铁路管理">×</button></header><div id="rm-body"></div><p id="rm-message" role="status" aria-live="polite"></p>';document.body.append(dialog);
    $('rm-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{remember();loading++;returnFocus?.focus();});dialog.addEventListener('keydown',e=>e.stopPropagation());dialog.addEventListener('pointerdown',e=>e.stopPropagation());
  }
  function remember(){
    const form=$('rm-form');if(!form||!identity)return;
    const d={};for(const n of form.querySelectorAll('[name]'))d[n.name]=n.type==='checkbox'?n.checked:n.value;
    for(const n of form.querySelectorAll('details[id]'))d[n.id]=n.open;
    drafts.set(identity,d);
  }
  const clockText=h=>{const m=Math.round(Number(h)*60)%1440;return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;};
  const clockHours=text=>{const [h,m]=text.split(':').map(Number);return h+m/60;};
  function syncServiceFields(){
    const f=$('rm-form'),manual=f.elements.fleetMode.value==='manual',allDay=f.elements.allDay.checked;
    for(const [key,show] of [['headway',!manual],['assignedFleet',manual]]){const n=f.elements[key];n.disabled=!show;n.closest('label').hidden=!show;}
    for(const key of ['startTime','endTime'])f.elements[key].disabled=allDay;
    const start=clockHours(f.elements.startTime.value),end=clockHours(f.elements.endTime.value),duration=(end-start+24)%24;
    f.elements.endTime.setCustomValidity(!allDay&&duration<.25?'运营时段至少 15 分钟；全天运营请勾选「全天」。':'');
    $('rm-time-note').textContent=allDay?'全天运营':`${end<=start?'次日结束 · ':''}运营 ${fmt(duration,2)} 小时`;
    $('rm-fleet-note').textContent=manual?'班距根据列车数量与运行周期计算。':'按目标班距自动安排所需列车。';
  }
  async function openManager(id){
    shell();remember();returnFocus=document.activeElement;identity=id||identity;const seq=++loading;if(!dialog.open)dialog.showModal();$('rm-body').inert=true;dialog.setAttribute('aria-busy','true');$('rm-message').textContent='正在读取铁路网络…';
    try{const result=await api('query',{kind:'rail',line:identity});if(seq!==loading)return;data=result;renderManager();$('rm-message').textContent='';}catch(e){$('rm-message').textContent=e.message;}finally{if(seq===loading){$('rm-body').inert=false;dialog.removeAttribute('aria-busy');}}
  }
  function renderManager(){
    const selected=data.lines.find(l=>l.id===identity);data.line=selected;
    $('rm-body').innerHTML=`<div class="rm-filters"><label>类型<select id="rm-filter"><option value="all">全部线路</option><option value="metro">地铁</option><option value="train">火车</option><option value="through">直通</option></select></label><label>状态<select id="rm-status-filter"><option value="all">全部状态</option><option value="active">运营</option><option value="paused">停运</option><option value="fault">故障 / 待连接</option></select></label><button class="city-btn" id="rm-refresh">刷新数据</button><button class="city-btn" id="rm-stations">车站与换乘</button></div><div class="rm-layout"><nav id="rm-lines" aria-label="全部铁路线路">${data.lines.filter(l=>(filter==='all'||l.serviceType===filter)&&(statusFilter==='all'||(statusFilter==='active'?l.valid:statusFilter==='paused'?!l.enabled:l.enabled&&!l.valid))).map(l=>`<button data-rm-line="${esc(l.id)}" aria-current="${l.id===identity}"><strong>${esc(l.name)}</strong><small>${({through:'直通',train:'火车',metro:'地铁'})[l.serviceType]||'铁路'} · ${l.stops.length} 站 · ${l.fleet} 列</small><small>${esc(l.valid?'运营':l.reason)} · 班距 ${fmt(l.serviceHeadway,1)} 分</small><small>${fmt(data.runtime.totals['line:'+l.id]?.board)} 累计上车 · ${fmt(l.boardings)} 典型日估算</small></button>`).join('')||'<p>暂无匹配线路。请先接轨、建设折返设施，再创建线路。</p>'}</nav><main id="rm-content">${selected?lineForm(selected):stationList()}</main></div>`;
    $('rm-filter').value=filter;$('rm-status-filter').value=statusFilter;
    $('rm-filter').onchange=()=>{remember();filter=$('rm-filter').value;renderManager();};$('rm-status-filter').onchange=()=>{remember();statusFilter=$('rm-status-filter').value;renderManager();};
    $('rm-refresh').onclick=()=>openManager(identity);$('rm-stations').onclick=()=>{remember();identity=null;renderManager();};
    $('rm-lines').querySelectorAll('button').forEach(b=>b.onclick=()=>openManager(b.dataset.rmLine));
    $('rm-content').querySelectorAll('[data-rm-station]').forEach(b=>b.onclick=()=>openStation(b.dataset.rmStation));
    $('rm-content').querySelectorAll('[data-passage-a]').forEach(b=>b.onclick=async()=>{const cmd={type:'rail_passage',a:b.dataset.passageA,b:b.dataset.passageB};const result=await api('rail_preview',{command:cmd});$('rm-message').textContent=result.valid?`建设通道 ${fmt(result.passage.length)} m，${fmt(result.cost)} 元；再次点击确认建设。`:result.reason;if(result.valid){b.textContent='确认建造 · '+fmt(result.cost)+' 元';b.onclick=async()=>{if(await command(cmd))openManager();else $('rm-message').textContent=$('city-status').textContent;};}});
    $('rm-content').querySelectorAll('[data-passage-toggle]').forEach(b=>b.onclick=async()=>{if(await command({type:'rail_passage',id:b.dataset.passageToggle}))openManager();});
    if(selected){$('rm-form').onsubmit=saveLine;syncServiceFields();$('rm-form').oninput=()=>{syncServiceFields();$('rm-message').textContent='设置尚未保存';};$('rm-delete').onclick=async()=>{if(await command({type:'delete',id:identity})){drafts.delete(identity);identity=null;await openManager();}};
      $('rm-reorder').onclick=()=>{const l=selected;dialog.close();mount(host,'rail_line');editing=l.id;route=l.stops.map(s=>({station:s,platform:l.platforms?.[s]||s}));$('rail-name').value=l.name;$('rail-pattern').value=l.servicePattern;$('rail-vehicle').value=l.vehicleType;$('rail-formation').value=l.formation;$('rail-headway').value=l.headway;refresh();};}
    swatches();bindHistory();
    if($('rm-transfer-save'))$('rm-transfer-save').onclick=async()=>{if(await command({type:'rail_rules',transferMeters:Number($('rm-transfer-distance').value)}))openManager();else $('rm-message').textContent=$('city-status').textContent;};
  }
  function swatches(){dialog.querySelectorAll('[data-height]').forEach(n=>n.style.height=n.dataset.height+'%');}
  function lineForm(l){
    const d=drafts.get(l.id)||{},v=(key,fallback=l[key])=>d[key]??fallback,stops=state().stops;
    const input=(label,key,type='number',extra='')=>`<label>${label}<input name="${key}" type="${type}" value="${esc(v(key))}" ${extra}></label>`;
    const stats=data.runtime.totals['line:'+l.id],open=id=>d[id]?'open':'';
    const fleetMode=v('fleetMode',l.assignedFleet?'manual':'auto');
    return `<div class="rm-heading"><h3>${esc(l.name)}</h3><span class="rm-status">${esc(l.reason||'运营中')}</span></div><p class="rail-note">${fmt(l.length/1000,2)} km · ${l.fleet} 列车 · 班距 ${fmt(l.serviceHeadway,1)} 分 · 约 ${fmt(l.operatingCost/30)} 元 / 日</p>
    <form id="rm-form"><div class="rm-settings">
      <div class="rm-name-row">${input('线路名称','name','text','maxlength="60" required')}${input('颜色','color','color')}</div>
      <div class="rm-field-pair"><label>车型<select name="vehicleType">${Object.entries(data.vehicles).map(([k,vv])=>`<option value="${k}" ${v('vehicleType')===k?'selected':''}>${vv.name}</option>`).join('')}</select></label>${input('编组（节）','formation','number','min="1" max="12" required')}</div>
      <div class="rm-field-pair"><label>配车方式<select name="fleetMode"><option value="auto" ${fleetMode==='auto'?'selected':''}>按班距自动配车</option><option value="manual" ${fleetMode==='manual'?'selected':''}>指定列车数量</option></select></label>${input('目标班距（分钟）','headway','number','min="1" max="120" step="0.5" required')}<label>列车数量<input name="assignedFleet" type="number" min="1" max="100" required value="${esc(v('assignedFleet',l.assignedFleet||l.fleet||1))}"></label></div><p id="rm-fleet-note" class="rail-note"></p>
      <div class="rm-section-label"><span>运营时段</span><label class="rm-check"><input name="allDay" type="checkbox" ${v('allDay',l.hours===24)?'checked':''}>全天</label></div>
      <div class="rm-field-pair"><label>首班时间<input name="startTime" type="time" required value="${esc(v('startTime',clockText(l.startHour)))}"></label><label>末班截止<input name="endTime" type="time" required value="${esc(v('endTime',clockText(l.startHour+l.hours)))}"></label></div><p id="rm-time-note" class="rail-note"></p>
    </div>
    <details id="rm-stop-settings" ${open('rm-stop-settings')}><summary>停站与站台 <span>${l.stops.length} 站</span></summary><div class="rm-table-wrap"><table><thead><tr><th>停站顺序</th><th>站台</th><th>停靠</th></tr></thead><tbody>${l.stops.map((sid,i)=>{const s=stops.find(s=>s.id===sid);return `<tr><th>${i+1}. ${esc(s?.name||sid)}</th><td><select aria-label="${esc(s?.name)}站台" name="platform:${esc(sid)}">${(s?.platforms||[{id:sid,number:1}]).map(p=>`<option value="${esc(p.id)}" ${v('platform:'+sid,l.platforms?.[sid]||sid)===p.id?'selected':''}>${p.number} 号 · ${p.length||'旧'} m${p.connected===false?' · 待连接':''}</option>`).join('')}</select></td><td><input aria-label="${esc(s?.name)}停靠" name="call:${esc(sid)}" type="checkbox" ${v('call:'+sid,l.stopPattern?.[sid]!==false)?'checked':''}></td></tr>`;}).join('')}</tbody></table></div><button class="city-btn" id="rm-reorder" type="button">调整停站顺序</button></details>
    <details id="rm-advanced" ${open('rm-advanced')}><summary>高级设置 <span>运行方式、速度、途经接点</span></summary><div class="rail-fields"><label>运行方式<select name="servicePattern">${Object.entries(patterns).map(([k,n])=>`<option value="${k}" ${v('servicePattern')===k?'selected':''}>${n}</option>`).join('')}</select></label>${input('停站（分钟）','dwell','number','min="0.1" max="10" step="0.1" required')}${input('限速（km/h）','speed','number','min="5" max="180" required')}</div><div class="rail-fields rm-via">${l.stops.map(sid=>{const s=stops.find(s=>s.id===sid);return `<label>${esc(s?.name||sid)}之后<select name="via:${esc(sid)}"><option value="">自动寻路</option>${state().roads.filter(r=>['metro','train'].includes(r.kind)&&!r.platform).map(r=>{const edge=state().network.edges.find(e=>e.road===r.id);return edge?`<option value="${esc(edge.b)}" ${v('via:'+sid,(l.via?.[sid]||[]).join(','))===edge.b?'selected':''}>经 ${esc(r.name)} · ${levels[r.level]}</option>`:'';}).join('')}</select></label>`;}).join('')}</div></details>
    <div class="rail-actions rm-save-row"><label class="rm-check"><input type="checkbox" name="enabled" ${v('enabled')?'checked':''}>开通运营</label><button class="city-btn primary" type="submit" id="rm-save">保存设置</button></div></form>
    <details><summary>运营数据 <span>客流、成本与列车</span></summary><div class="rm-metrics"><span><b>${fmt(stats?.board)}</b>累计上车</span><span><b>${fmt(data.runtime.trains.filter(t=>t.line===l.id).reduce((n,t)=>n+t.onboard,0))}</b>当前乘车</span><span><b>${fmt(l.boardings)}</b>典型日估算</span><span><b>${fmt(l.plannedTrainsPerHour,1)} / ${fmt(l.actualTrainsPerHour,1)}</b>计划 / 可提供班次每小时</span></div><p class="rail-note">累计实际发车 ${fmt(stats?.departure)} 班；各日期、各方向的实际承接与未满足需求见下方。</p>${historyPanel('line:'+l.id)}${demand(l)}<h4>列车状态</h4>${data.runtime.trains.filter(t=>t.line===l.id).map(t=>`<p>${esc(t.id)} · ${esc(({running:'运行',dwelling:'停站',waiting:'等待进路',dispatch:'等待发车',fault:'故障'})[t.status]||t.status)} · ${t.onboard} 人 · 延误 ${fmt(t.delay/60,1)} 分 ${esc(t.blockReason)}</p>`).join('')||'<p>当前没有在途列车。</p>'}</details>
    <details><summary>共线与限制 <span>${l.shared?.length||0} 项</span></summary>${(l.shared||[]).slice(0,30).map(r=>`<p class="rail-note">${r.lines.map(id=>esc(data.lines.find(l=>l.id===id)?.name||id)).join(' / ')} · ${esc(r.reason)}</p>`).join('')||'<p>没有共享瓶颈。</p>'}</details>
    <details class="rm-danger"><summary>移除线路</summary><p class="rail-note">停止新增发车，在途列车完成行程。</p><button class="city-btn danger" id="rm-delete" type="button">删除线路</button></details>`;
  }
  function historyRows(key){
    return [...data.runtime.history,...Object.entries(data.runtime.days).map(([date,row])=>({date,...row}))].filter(r=>r.totals[key]).sort((a,b)=>a.date.localeCompare(b.date));
  }
  function historyPanel(key){
    const rows=historyRows(key);
    return `<details class="rail-actual-history" data-series="${esc(key)}"><summary>实际客流 · 小时与日期</summary>${rows.length?`<label class="rail-note">模拟日期 <select data-history-date>${rows.map((r,i)=>`<option ${i===rows.length-1?'selected':''}>${esc(r.date)}</option>`).join('')}</select></label><div data-history-content></div>`:'<p class="rail-note">尚未采集实际事件；不补造过去的日期。</p>'}</details>`;
  }
  function bindHistory(){
    dialog.querySelectorAll('[data-series]').forEach(panel=>{
      const select=panel.querySelector('[data-history-date]');if(!select)return;
      const render=()=>{const row=historyRows(panel.dataset.series).find(r=>r.date===select.value)?.totals[panel.dataset.series];if(!row)return;
        const values=row.hours?.map(h=>h.board||0),max=Math.max(1,...(values||[]));
        panel.querySelector('[data-history-content]').innerHTML=`<p class="rail-note">当日累计：进站 ${fmt(row.entry)} · 出站 ${fmt(row.exit)} · 上车 ${fmt(row.board)} · 下车 ${fmt(row.alight)} · 换乘 ${fmt(row.transfer)} · 满载未上车 ${fmt(row.denied)} · 未完成 ${fmt(row.unmet)} 人次；实际发车 ${fmt(row.departure)} 班。</p>${values?`<div class="rail-hours" role="img" aria-label="${esc(select.value)} 实际各小时上车人次">${values.map((n,h)=>`<div title="${h}:00 · ${n} 人次"><i data-height="${n/max*100}"></i><small>${h}</small></div>`).join('')}</div><details><summary>逐时数值</summary><div class="rm-table-wrap"><table><thead><tr><th>小时</th><th>上车</th><th>下车</th><th>未满足</th></tr></thead><tbody>${row.hours.map((h,i)=>`<tr><td>${i}:00</td><td>${h.board||0}</td><td>${h.alight||0}</td><td>${h.unmet||0}</td></tr>`).join('')}</tbody></table></div></details>`:'<p>此旧记录没有逐小时数据。</p>'}<p class="rail-note">${Object.entries(row.directions||{}).map(([d,n])=>`方向 ${Number(d)+1}：上车 ${fmt(n.board)}，下车 ${fmt(n.alight)}，未完成 ${fmt(n.unmet)}`).join('；')||'此记录未采集方向明细'}</p>`;swatches();};select.onchange=render;render();
    });
  }
  function demand(l){
    const hourly=l.demandProfile?.hourly,max=Math.max(1,...(hourly||[]));
    return `<details><summary>站点需求与小时 / 历史趋势</summary><p class="rail-note">典型日估算 ${esc(l.demandDate||'尚未采集')}；实际事件历史另列，无记录不填零。</p>${hourly?`<div class="rail-hours">${hourly.map((n,h)=>`<div title="${h} 时 ${n} 人次"><i data-height="${n/max*100}"></i><small>${h}</small></div>`).join('')}</div>`:'尚未采集小时数据'}<div class="rm-table-wrap"><table><thead><tr><th>站点</th><th>典型日上车 / 下车</th><th>当前候车</th><th>累计实际上车 / 下车</th></tr></thead><tbody>${l.stops.map(sid=>{const s=data.stops.find(s=>s.id===sid),p=l.demandProfile?.stops?.[sid];return `<tr><td><button class="city-btn" data-rm-station="${esc(sid)}">${esc(s?.name||sid)}</button></td><td>${fmt(p?.boardings)} / ${fmt(p?.alightings)}</td><td>${fmt(s?.waiting)}</td><td>${fmt(s?.actual?.board)} / ${fmt(s?.actual?.alight)}</td></tr>`;}).join('')}</tbody></table></div><p>实际分方向：${Object.entries(data.runtime.totals['line:'+l.id]?.directions||{}).map(([d,v])=>`方向 ${Number(d)+1} · 上车 ${fmt(v.board)} / 下车 ${fmt(v.alight)} / 未满足 ${fmt(v.unmet)}`).join('；')||'尚未采集'}</p><p>典型日历史：${(l.demandHistory||[]).map(r=>`${esc(r.date)}：${fmt(r.boardings)} 人次`).join('；')||'尚未采集'}</p><p>实际历史：${data.runtime.history.map(r=>`${esc(r.date)}：${fmt(r.totals['line:'+l.id]?.board)} 上车人次`).join('；')||'尚未采集'}</p></details>`;
  }
  function stationList(){return `<h3>车站与自动换乘</h3>${state().stops.filter(s=>s.railStation).map(s=>`<button class="city-btn" data-rm-station="${esc(s.id)}">${esc(s.name)} · ${levels[s.level]} · ${s.platforms.length} 站台 · ${esc(s.status)}</button>`).join('')}<h4>换乘站组</h4>${data.infrastructure.groups.map(g=>`<details><summary>${g.stations.map(id=>esc(state().stops.find(s=>s.id===id)?.name)).join(' ↔ ')}</summary><p class="rail-note">${g.sampled?`外部进 / 出站 ${fmt(g.actual.entry)} / ${fmt(g.actual.exit)}；内部换乘 ${fmt(g.actual.transfer)}；各线登乘 ${fmt(g.actual.board)} 人次`:'尚未采集实际客流'} · 当前候车 ${fmt(g.waiting)} 人</p></details>`).join('')||'<p>尚无连通站组。</p>'}${data.infrastructure.transfers.map(t=>`<p>${esc(state().stops.find(s=>s.id===t.a)?.name)} ↔ ${esc(state().stops.find(s=>s.id===t.b)?.name)} · ${t.valid?`${fmt(t.distance)} m · ${fmt(t.minutes,1)} 分`:esc(t.reason)} ${!t.valid?`<button class="city-btn" data-passage-a="${esc(t.a)}" data-passage-b="${esc(t.b)}">预览连接通道</button>`:''}</p>`).join('')}${(data.infrastructure.passages||[]).map(p=>`<p>已建站内通道 · ${fmt(p.length)} m · ${fmt(p.minutes,1)} 分 <button class="city-btn" data-passage-toggle="${esc(p.id)}">${p.enabled?'关闭':'开放'}</button></p>`).join('')}<details><summary>换乘规则</summary><div class="rail-fields"><label>最大实际步行距离（米）<input id="rm-transfer-distance" type="number" min="1" max="2000" value="${state().railRules.transferMeters}"></label><button id="rm-transfer-save" class="city-btn">保存规则</button></div><p class="rail-note">站组仍沿真实通道行走，不会新增零时间路径。</p></details>`;}
  async function saveLine(event){
    event.preventDefault();remember();const d=drafts.get(identity),l=data.line;
    const changes={type:'line_update',id:identity,name:d.name,color:d.color,vehicleType:d.vehicleType,servicePattern:d.servicePattern,enabled:d.enabled,assignedFleet:d.fleetMode==='manual'?Number(d.assignedFleet):null,platforms:{},stopPattern:{},via:{}};
    for(const key of ['formation','headway','dwell','speed'])changes[key]=Number(d[key]);
    changes.startHour=clockHours(d.startTime);changes.hours=d.allDay?24:(clockHours(d.endTime)-changes.startHour+24)%24;
    for(const sid of l.stops){changes.platforms[sid]=d['platform:'+sid];changes.stopPattern[sid]=d['call:'+sid];changes.via[sid]=(d['via:'+sid]||'').split(',').map(s=>s.trim()).filter(Boolean);}
    $('rm-save').disabled=true;const ok=await command(changes);$('rm-save').disabled=false;
    if(ok){drafts.delete(identity);$('rm-form').remove();await openManager(identity);$('rm-message').textContent='设置已保存，运力与客流已重新计算。';}else $('rm-message').textContent=$('city-status').textContent;
  }
  async function openStation(id){
    shell();remember();returnFocus=document.activeElement;identity=null;const seq=++loading;if(!dialog.open)dialog.showModal();
    $('rm-body').inert=true;dialog.setAttribute('aria-busy','true');
    let result;try{result=await api('query',{kind:'rail'});}catch(error){$('rm-message').textContent=error.message;return;}finally{if(seq===loading){$('rm-body').inert=false;dialog.removeAttribute('aria-busy');}}
    if(seq!==loading)return;data=result;const s=result.stops.find(s=>s.id===id);if(!s)return;
    $('rm-body').innerHTML=`<div class="rm-heading"><h3>${esc(s.name)}</h3><span class="rm-status">${levels[s.level]||'旧站台'} · ${esc(s.status||'')}</span></div>
    <form id="rs-form"><div class="rail-fields"><label>站名<input id="rs-name" value="${esc(s.name)}" maxlength="60" required></label><label>站台数量<input id="rs-count" type="number" min="1" max="8" value="${s.platforms?.length||1}" required></label><button id="rs-preview" class="city-btn" type="button">预览费用</button><button class="city-btn primary" id="rs-save" type="submit">保存车站</button></div></form>
    <div class="rs-platforms">${(s.platforms||[]).map(p=>`<div class="rs-platform"><div class="rm-heading"><strong>${p.number} 号站台</strong><span class="rail-note">${p.length} m · ${p.connected?'已接轨':'待连接'}${p.turnback?' · 可折返':''}</span></div><p class="rail-note">${data.lines.filter(l=>l.platforms?.[id]===p.id).map(l=>esc(l.name)).join('、')||'暂无线路'} · ${data.runtime.trains.filter(t=>t.platform===p.id).length} 列占用</p><details><summary>接口坐标</summary><p class="rail-note">${p.ports.map((q,i)=>`${i?'B':'A'}：${q.map(n=>fmt(n,1)).join(', ')}`).join('<br>')}</p></details></div>`).join('')}</div>
    <h4>出入口</h4>${(s.entrances||[]).map(e=>`<div class="rs-entry"><div><strong>${e.kind==='building'?'建筑内部 · '+esc(state().parcels.find(p=>p.id===e.building)?.building?.name||e.building):'室外入口'}</strong><p class="rail-note">${e.enabled?'开放':'已关闭'} · ${fmt(e.length)} m · ${fmt(e.minutes,2)} 分${e.reason?' · '+esc(e.reason):''}</p></div><div class="rail-actions"><button class="city-btn" data-entry-toggle="${esc(e.id)}">${e.enabled?'关闭':'开放'}</button>${e.kind==='outdoor'?`<button class="city-btn" data-entry-move="${esc(e.id)}">移动</button>`:''}<details class="rs-entry-more"><summary>更多</summary>${e.kind==='outdoor'?`<label>移动时朝向（°）<input type="number" min="0" max="359" step="15" data-entry-rotation="${esc(e.id)}" value="${e.rotation||0}"></label>`:''}<button class="city-btn danger" data-entry-delete="${esc(e.id)}">删除入口</button></details></div></div>`).join('')}
    <div class="rail-actions"><button id="rs-add-entry" class="city-btn">增加室外入口</button></div>${s.candidateBuildings?.length?`<details><summary>连接建筑内部入口</summary><div class="rail-fields"><label>建筑<select id="rs-building">${s.candidateBuildings.map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select></label><button id="rs-add-building" class="city-btn">连接建筑</button></div></details>`:''}
    <details><summary>客流与覆盖 <span>候车 ${fmt(s.waiting)} 人</span></summary><div class="rm-metrics"><span><b>${fmt(s.waiting)}</b>当前候车</span><span><b>${fmt(s.waitingMinutes,1)}</b>最长候车 / 分</span><span><b>${fmt(s.actual?.entry)} / ${fmt(s.actual?.exit)}</b>累计进 / 出站</span><span><b>${fmt(s.actual?.transfer)}</b>累计换乘</span></div><p class="rail-note">真实步行覆盖 ${fmt(s.residents)} 人、${fmt(s.jobs)} 岗位。站内总人数未模拟。累计满载未上车 ${fmt(s.actual?.denied)} 人次，未完成出行 ${fmt(s.actual?.unmet)} 人次。</p><p class="rail-note">典型日主要目的地：${(s.destinations||[]).map(d=>`${esc(d.name)} ${fmt(d.people)} 人次`).join('；')||'尚未分配出行'}</p>${historyPanel('station:'+s.id)}</details>
    <div class="rail-actions"><button id="rs-lines" class="city-btn">返回线路管理</button><button id="rs-locate" class="city-btn">定位车站</button></div>`;
    const group=data.infrastructure.groups.find(g=>g.stations.includes(id));
    if(group){const section=document.createElement('details');section.innerHTML=`<summary>所属换乘站组</summary><p>${group.stations.map(sid=>`<button class="city-btn" data-group-station="${esc(sid)}">${esc(data.stops.find(st=>st.id===sid)?.name||sid)}</button>`).join(' ↔ ')}</p><p class="rail-note">${group.sampled?`累计外部进 / 出站 ${fmt(group.actual.entry)} / ${fmt(group.actual.exit)}，内部换乘 ${fmt(group.actual.transfer)} 人次`:'尚未采集实际事件'}；当前候车 ${fmt(group.waiting)} 人。</p>`;$('rm-body').append(section);section.querySelectorAll('button').forEach(b=>b.onclick=()=>openStation(b.dataset.groupStation));}
    const cmd=()=>({type:'rail_station',id,name:$('rs-name').value,platformCount:Number($('rs-count').value)});
    $('rs-preview').onclick=async()=>{const p=await api('rail_preview',{command:cmd()});$('rm-message').textContent=p.valid?`扩建费用 ${fmt(p.cost)} 元；保留既有站台身份。`:p.reason;};
    $('rs-form').onsubmit=async e=>{e.preventDefault();const ok=await command(cmd());if(ok){await openStation(id);$('rm-message').textContent='车站已更新';}else $('rm-message').textContent=$('city-status').textContent;};
    for(const [attr,act] of [['toggle','toggle'],['delete','delete']])dialog.querySelectorAll(`[data-entry-${attr}]`).forEach(b=>b.onclick=async()=>{if(await command({type:'rail_entry',station:id,id:b.dataset['entry'+attr[0].toUpperCase()+attr.slice(1)],action:act}))openStation(id);else $('rm-message').textContent=$('city-status').textContent;});
    if($('rs-add-building'))$('rs-add-building').onclick=async()=>{if(await command({type:'rail_entry',station:id,action:'add',building:$('rs-building').value}))openStation(id);else $('rm-message').textContent=$('city-status').textContent;};
    function place(entry){entryEdit={station:id,id:entry,rotation:Number(dialog.querySelector(`[data-entry-rotation="${entry}"]`)?.value||0)};dialog.close();CityApp.setTool('rail_entry');}
    dialog.querySelectorAll('[data-entry-move]').forEach(b=>b.onclick=()=>place(b.dataset.entryMove));$('rs-add-entry').onclick=()=>place(null);$('rs-lines').onclick=()=>openManager();$('rs-locate').onclick=()=>{MapWorkspace.focus(s.point,5);dialog.close();redraw();};$('rm-message').textContent='';bindHistory();
  }
  window.CityRail={mount,move,point,key,draw,openManager,openStation,nearest,get active(){return action;},get slice(){return !!$('rail-underground')?.checked;}};
})();
