(function(root){
  'use strict';
  const fields=[
    ['fleetSize','车队规模 / 辆',0,500,1],
    ['maxWaitMinutes','最长接客等待 / 分钟',1,60,1],
    ['baseFare','起步价 / 元',0,100,.5],
    ['perKm','超起步里程 / 元每 km',0,20,.1],
    ['includedKm','起步里程 / km',0,20,.5],
    ['perMinute','行车计时 / 元每分钟',0,10,.1],
    ['startHour','开始运营 / 时',0,23,1],
    ['hours','每日运营 / 小时',1,24,1],
  ];
  function mount(container,onApply){
    const input=([key,label,min,max,step])=>`<label>${label}<input class="city-field" id="taxi-${key}" type="number" min="${min}" max="${max}" step="${step}" required></label>`;
    container.innerHTML=`<h3 id="taxi-title">出租车服务</h3><p class="city-note">为无车出行和公交覆盖不足的地区提供补充。车辆接完一单后留在目的地，再沿道路接下一单。</p><div id="taxi-summary" aria-live="polite"></div><details id="taxi-settings"><summary>运营设置</summary><form id="taxi-form"><label class="city-note"><input id="taxi-enabled" type="checkbox"> 开放出租车运营</label><div class="city-fields">${fields.slice(0,4).map(input).join('')}</div><details><summary>计价与运营时间</summary><div class="city-fields">${fields.slice(4).map(input).join('')}</div></details><button class="city-btn primary" type="submit" id="taxi-apply">应用出租车设置</button></form></details><p class="city-note">私营车队，车费由乘客承担。单程费用不超过家庭日均收入的 15%。空驶与载客均计入车流，增派车辆也可能增加拥堵。</p><details><summary>统计口径与车辆标识</summary><p class="city-note">最近一次典型工作日分配；等待含派单、前单结束及接客行驶。“补足旅程”指同次选择中步行、私家车和公交均不可行的旅程。“仍未满足”仅计无其他可行方式且出租车也未能服务的需求。实景黄色出租车是旅程样本，绿色顶灯为接客、暖色顶灯为载客，不代表车队实时在线数量。</p></details>`;
    const form=container.querySelector('form'),get=key=>container.querySelector('#taxi-'+key);
    let signature='';
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(!form.reportValidity())return;
      const values={enabled:get('enabled').checked,...Object.fromEntries(fields.map(([key])=>[key,Number(get(key).value)]))};
      get('apply').disabled=true;
      try{await onApply(values);}finally{get('apply').disabled=false;}
    });
    return {render(state){
      const cfg=state.taxi;if(!cfg)return;
      const next=JSON.stringify(cfg);
      if(next!==signature){get('enabled').checked=cfg.enabled;for(const [key] of fields)get(key).value=cfg[key];signature=next;}
      const report=state.taxiReport||{},format=value=>value==null?'—':Number(value).toLocaleString('zh-CN',{maximumFractionDigits:1});
      const summary=get('summary');summary.replaceChildren();
      const status=document.createElement('p');status.className='city-note';
      status.textContent=!cfg.enabled?'运营关闭':cfg.fleetSize===0?'尚未配置车辆':`已配置 ${cfg.fleetSize} 辆 · 本次参与服务 ${report.active||0} 辆`;
      summary.append(status);
      if(!cfg.enabled||!Object.hasOwn(report,'completed'))return;
      for(const [label,value,unit] of [
        ['完成 / 补足旅程',`${format(report.completed)} / ${format(report.rescued)}`,'人次'],
        ['仍未满足',format(report.unserved),'人次'],['平均接客等待',format(report.meanWait),'分钟'],
        ['载客 / 空驶',`${format(report.occupiedKm)} / ${format(report.emptyKm)}`,'km'],
        ['车队忙碌率',format((report.utilization||0)*100),'%'],['乘客支付车费',format(report.revenue),'元'],
      ]){const row=document.createElement('p');row.className='city-note';row.textContent=`${label}：${value} ${unit}`;summary.append(row);}
      const failures=Object.entries(report.failures||{});
      if(failures.length){const row=document.createElement('p');row.className='city-note';row.textContent=failures.map(([reason,count])=>`${reason} ${count} 次`).join('；');summary.append(row);}
    }};
  }
  root.CityTaxis={mount};
})(window);
