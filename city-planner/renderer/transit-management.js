/* Operating settings and observed demand for every bus service. */
(() => {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=(v,d=0)=>Number(v||0).toLocaleString('zh-CN',{maximumFractionDigits:d});
  const time=v=>{const m=Math.round(v*60)%1440;return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;};
  const hour=v=>{const [h,m]=v.split(':').map(Number);return h+m/60;};
  const purposes={work:'通勤',shopping:'购物',school:'就学',leisure:'休闲',health:'就医',culture:'文化',regional:'城际换乘'};
  let dialog,identity,data,tab='settings',ticket=0,busy=false,returnFocus;
  const drafts=new Map();
  const $=id=>dialog.querySelector('#'+id);
  function shell(){
    if(dialog)return;
    dialog=document.createElement('dialog');dialog.id='transit-management';dialog.setAttribute('aria-labelledby','tm-title');
    dialog.innerHTML=`<header class="tm-header"><div><span class="tm-eyebrow">公共交通 · 公交车</span><h2 id="tm-title">线路管理</h2></div><button type="button" class="icon-btn" id="tm-close" aria-label="关闭线路管理">×</button></header><div class="tm-layout"><nav id="tm-lines" aria-label="全部公交线路"></nav><div class="tm-main"><div id="tm-content"></div><p id="tm-message" role="status" aria-live="polite"></p></div></div>`;
    document.body.append(dialog);
    $('tm-close').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{ticket++;drafts.clear();identity=null;returnFocus?.focus();});
    dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
    dialog.addEventListener('keydown',e=>e.stopPropagation());
    dialog.addEventListener('pointerdown',e=>e.stopPropagation());
    $('tm-lines').onclick=e=>{const row=e.target.closest('[data-tm-line]');if(row&&!busy)load(row.dataset.tmLine);};
  }
  function list(){
    $('tm-lines').innerHTML=`<p class="tm-list-caption">全部线路 · ${CityApp.state.lines.filter(l=>l.mode==='bus').length}</p>`+CityApp.state.lines.filter(l=>l.mode==='bus').map(l=>`<button type="button" data-tm-line="${esc(l.id)}" aria-current="${l.id===identity?'true':'false'}"><span class="tm-route-dot" data-tm-color="${esc(l.color)}"></span><span><strong>${esc(l.name)}</strong><small>${fmt(l.boardings)} 上车人次 / 典型日</small><small>${l.valid?`${fmt(l.fleet)} 辆 · ${time(l.startHour)}–${time(l.startHour+l.hours)}${l.hours===24?'（全天）':''}`:esc(l.reason||'停运')}</small></span></button>`).join('');
  }
  function swatches(){
    dialog.querySelectorAll('[data-tm-color]').forEach(node=>node.style.backgroundColor=/^#[\da-f]{6}$/i.test(node.dataset.tmColor)?node.dataset.tmColor:'#397e76');
  }
  function remember(){
    if(data&&$('tm-form'))drafts.set(data.line.id,Object.fromEntries(new FormData($('tm-form'))));
  }
  async function load(id,{keep=true}={}){
    if(keep)remember();
    identity=id;const request=++ticket;list();swatches();$('tm-message').textContent='正在读取线路需求…';$('tm-content').setAttribute('aria-busy','true');$('tm-content').inert=true;
    try{
      const result=await CityApp.transitDetails(id);
      if(request!==ticket||!dialog.open)return;
      data=result;render();$('tm-message').textContent='';
    }catch(error){if(request===ticket){$('tm-content').innerHTML='';$('tm-message').textContent=error.message;}}
    finally{if(request===ticket){$('tm-content').removeAttribute('aria-busy');$('tm-content').inert=false;}}
  }
  function render(){
    const l=data.line,known=l.vehicleType||Object.keys(data.vehicles).find(k=>data.vehicles[k].capacity===l.capacity),d=drafts.get(l.id)||{};
    $('tm-content').innerHTML=`<div class="tm-line-heading"><div><h3>${esc(l.name)}</h3><p>${l.valid?'已开通':esc(l.reason)} · ${l.stops.length} 站 · ${l.oneway?'单向':'往返'}运营</p></div><button type="button" class="city-btn" id="tm-refresh">刷新数据</button></div><div class="tm-metrics"><div><strong>${fmt(l.boardings)}</strong><span>上车人次 / 典型日</span></div><div><strong>${fmt(l.fleet)}</strong><span>运营车辆</span></div><div><strong>${l.valid?fmt(l.serviceHeadway??l.headway,1):'—'}</strong><span>运营班距 / 分钟</span></div><div><strong>${fmt(l.load*100,1)}%</strong><span>峰值运力利用率</span></div></div><div class="tm-tabs" role="tablist" aria-label="线路详情"><button type="button" role="tab" id="tm-tab-settings" aria-controls="tm-settings">运营设置</button><button type="button" role="tab" id="tm-tab-stops" aria-controls="tm-stops">站点需求</button><button type="button" role="tab" id="tm-tab-trend" aria-controls="tm-trend">需求变化</button></div><section role="tabpanel" id="tm-settings" aria-labelledby="tm-tab-settings"><form id="tm-form"><div class="tm-fields"><label>线路名称<input id="tm-name" name="name" maxlength="60" required value="${esc(d.name??l.name)}"></label><label>线路颜色<input id="tm-color" name="color" type="color" value="${esc(d.color??l.color)}"></label><label>运营车型<select id="tm-vehicle" name="vehicleType">${!known?`<option value="custom">现有车辆 · ${fmt(l.capacity)} 人 / 辆</option>`:''}${Object.entries(data.vehicles).map(([k,v])=>`<option value="${k}" ${(d.vehicleType??known)===k?'selected':''}>${v.name} · ${v.capacity} 人 / 辆</option>`).join('')}</select></label><label>配车方式<select id="tm-fleet-mode" name="fleetMode"><option value="auto">按班距自动配车</option><option value="manual" ${(d.fleetMode??(l.assignedFleet?'manual':'auto'))==='manual'?'selected':''}>指定车辆数量</option></select></label><label id="tm-count-label">车辆数量<input id="tm-count" name="assignedFleet" type="number" min="1" max="100" step="1" required value="${esc(d.assignedFleet??l.assignedFleet??Math.max(1,l.fleet))}"></label><label id="tm-headway-label">目标班距（分钟）<input id="tm-headway" name="headway" type="number" min="2" max="120" step="0.5" required value="${esc(d.headway??l.headway)}"></label><label>首班发车<input id="tm-start" name="start" type="time" required value="${esc(d.start??time(l.startHour))}"></label><label>末班截止<input id="tm-end" name="end" type="time" required value="${esc(d.end??time(l.startHour+l.hours))}"></label></div><label class="tm-check"><input type="checkbox" id="tm-all-day" name="allDay" ${(d.allDay??(!drafts.has(l.id)&&l.hours===24))?'checked':''}>全天 24 小时运营</label><p id="tm-service-preview" class="tm-note"></p><p class="tm-note">末班早于首班表示跨午夜运营。截止时刻停止新发车，已发车辆继续完成行程。</p><div class="tm-form-footer"><label class="tm-check"><input type="checkbox" id="tm-enabled" name="enabled" ${(drafts.has(l.id)?d.enabled:l.enabled)?'checked':''}>开通运营</label><button type="submit" class="city-btn primary" id="tm-save">保存线路设置</button></div></form><button type="button" class="city-btn tm-more" id="tm-more">编辑停站顺序与更多操作</button></section><section role="tabpanel" id="tm-stops" aria-labelledby="tm-tab-stops" hidden>${stationTable()}</section><section role="tabpanel" id="tm-trend" aria-labelledby="tm-tab-trend" hidden><div class="tm-chart-heading"><h4>日内上车需求</h4><span>按小时 · 人次</span></div>${hourlyChart()}<div class="tm-chart-heading"><h4>历史需求变化</h4><span>按模拟日期 · 人次 / 典型日</span></div>${historyChart()}</section><p class="tm-data-note">${data.date?'数据日期：'+esc(data.date)+'。':'尚未采集需求数据。'}${esc(data.rule)}</p>`;
    $('tm-form').onsubmit=save;
    $('tm-form').oninput=()=>{preview();$('tm-message').textContent='设置尚未保存';};
    $('tm-refresh').onclick=()=>load(identity);
    $('tm-more').onclick=()=>{const id=identity;dialog.close();CityApp.inspect(id);};
    ['settings','stops','trend'].forEach((key,i,all)=>{
      const button=$('tm-tab-'+key);button.onclick=()=>showTab(key);
      button.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=all[e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3];showTab(next);$('tm-tab-'+next).focus();}};
    });
    dialog.querySelectorAll('[data-bar-height]').forEach(node=>{node.style.height=node.dataset.barHeight+'%';node.style.minHeight=node.dataset.barMin+'px';});
    showTab(tab);preview();
  }
  function showTab(next){
    tab=next;
    for(const key of ['settings','stops','trend']){const active=key===tab;$('tm-'+key).hidden=!active;$('tm-tab-'+key).setAttribute('aria-selected',String(active));$('tm-tab-'+key).tabIndex=active?0:-1;}
  }
  function preview(){
    const manual=$('tm-fleet-mode').value==='manual',allDay=$('tm-all-day').checked;
    $('tm-count-label').hidden=!manual;$('tm-count').disabled=!manual;
    $('tm-headway-label').hidden=manual;$('tm-headway').disabled=manual;
    $('tm-start').disabled=allDay;$('tm-end').disabled=allDay;
    const duration=allDay?24:(hour($('tm-end').value)-hour($('tm-start').value)+24)%24;
    const interval=manual?Math.max(.5,data.line.cycle/Number($('tm-count').value)):Number($('tm-headway').value);
    const selected=data.vehicles[$('tm-vehicle').value],capacity=selected?.capacity??data.line.capacity;
    $('tm-service-preview').textContent=`${fmt(capacity)} 人 / 辆 · ${data.line.valid?'预计班距 '+fmt(interval,1)+' 分钟 · ':''}每日运营 ${fmt(duration,2)} 小时${!allDay&&hour($('tm-end').value)<hour($('tm-start').value)?'（跨午夜）':''}。配车数量会改变班距、运力和运营费用。`;
  }
  async function save(event){
    event.preventDefault();if(busy)return;
    const allDay=$('tm-all-day').checked,start=allDay?0:hour($('tm-start').value),end=hour($('tm-end').value);
    const duration=allDay?24:(end-start+24)%24;
    if(!Number.isFinite(duration)||duration<.25){$('tm-message').textContent='运营时间至少为 15 分钟；全天运营请勾选“全天 24 小时运营”。';return;}
    const changes={id:identity,name:$('tm-name').value.trim(),color:$('tm-color').value,startHour:start,hours:duration,enabled:$('tm-enabled').checked,assignedFleet:$('tm-fleet-mode').value==='manual'?Number($('tm-count').value):null};
    if(changes.assignedFleet===null)changes.headway=Number($('tm-headway').value);
    if($('tm-vehicle').value!=='custom')changes.vehicleType=$('tm-vehicle').value;
    remember();busy=true;const id=identity;$('tm-message').textContent='正在更新运力与客流…';
    dialog.querySelectorAll('button,input,select').forEach(node=>node.disabled=true);
    try{
      const saved=await CityApp.updateTransit(changes);
      if(saved){drafts.delete(id);await load(id,{keep:false});$('tm-message').textContent='线路设置已保存，运力与需求已更新。';}
      else $('tm-message').textContent=document.getElementById('city-status').textContent||'保存失败，请检查线路设置。';
    }finally{busy=false;dialog.querySelectorAll('button,input,select').forEach(node=>node.disabled=false);if($('tm-form'))preview();}
  }
  function stationTable(){
    return `<p class="tm-note">按线路停站顺序排列。综合需求 = 本线上车 + 下车人次；步行覆盖按真实道路连接计算，覆盖人口与岗位不相加为客流。</p><div class="tm-table-wrap"><table><thead><tr><th>站点</th><th>综合需求</th><th>上车 / 下车</th><th>需求构成</th><th>5 分钟步行覆盖</th></tr></thead><tbody>${data.stops.map((s,i)=>`<tr><th><span class="tm-stop-number">${i+1}</span>${esc(s.name)}<small>${s.missing?'站点缺失':`全站 ${fmt(s.allBoardings)} 上车 / ${fmt(s.allAlightings)} 下车`}</small></th><td>${data.hourly?fmt(s.boardings+s.alightings):'—'}</td><td>${data.hourly?`${fmt(s.boardings)} / ${fmt(s.alightings)}`:'—'}</td><td>${Object.entries(s.purposes).map(([k,v])=>`${esc(purposes[k]||k)} ${fmt(v)}`).join(' · ')||'暂无已承接需求'}</td><td>${fmt(s.residents)} 人<br>${fmt(s.jobs)} 个岗位</td></tr>`).join('')}</tbody></table></div>`;
  }
  function hourlyChart(){
    if(!data.hourly)return '<p class="tm-empty">尚未采集小时需求，下一次交通分配后显示。</p>';
    const max=Math.max(1,...data.hourly);
    return `<div class="tm-hourly" aria-label="24 小时上车需求">${data.hourly.map((count,h)=>`<div class="tm-hour" tabindex="0" aria-label="${h}:00–${h+1}:00，${count} 人次" title="${h}:00–${h+1}:00 · ${count} 人次"><span>${fmt(count)}</span><i data-bar-height="${count/max*100}" data-bar-min="${count?3:1}"></i><small>${String(h).padStart(2,'0')}</small></div>`).join('')}</div>`;
  }
  function historyChart(){
    const history=data.history;
    if(!history.length)return '<p class="tm-empty">暂无历史记录。每个模拟日期保留最近一次交通分配结果。</p>';
    const recent=history.slice(-30),max=Math.max(1,...recent.map(r=>r.boardings)),x=i=>24+i*592/Math.max(1,recent.length-1),y=r=>130-r.boardings/max*100;
    return `<svg class="tm-history" viewBox="0 0 640 160" role="img" aria-label="最近 ${recent.length} 个记录日的公交需求"><path d="M24 20V130H616" fill="none" stroke="#dce5e4"/><polyline points="${recent.map((r,i)=>`${x(i)},${y(r)}`).join(' ')}" fill="none" stroke="#397e76" stroke-width="3"/>${recent.map((r,i)=>`<circle cx="${x(i)}" cy="${y(r)}" r="4" fill="#397e76"><title>${r.date}：${fmt(r.boardings)} 人次</title></circle>`).join('')}<text x="24" y="152">${recent[0].date}</text><text x="616" y="152" text-anchor="end">${recent.at(-1).date}</text><text x="24" y="14">${fmt(max)} 人次</text></svg>${history.length===1?'<p class="tm-note">目前只有一个记录日，继续推进模拟时间后可比较需求变化。</p>':''}<details class="tm-history-details"><summary>查看历史记录（${history.length} 条）</summary><div class="tm-table-wrap"><table><thead><tr><th>模拟日期</th><th>上车人次</th><th>峰值利用率</th><th>车辆</th><th>班距 / 分钟</th></tr></thead><tbody>${[...history].reverse().map(r=>`<tr><td>${esc(r.date)}</td><td>${fmt(r.boardings)}</td><td>${fmt(r.load*100,1)}%</td><td>${fmt(r.fleet)}</td><td>${fmt(r.headway,1)}</td></tr>`).join('')}</tbody></table></div></details>`;
  }
  async function open(id){
    shell();if(CityApp.working)return;
    returnFocus=document.activeElement;tab='settings';drafts.clear();$('tm-content').innerHTML='';dialog.showModal();await load(id,{keep:false});
  }
  window.CityTransitManagement={open};
})();
