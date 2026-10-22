/* Junction detail editor: the preview and the map share road arrow geometry. */
(function(root){
  const turnNames={left:'左转',straight:'直行',right:'右转'},turnSymbols={left:'↰',straight:'↑',right:'↱'};
  const renderer=typeof module!=='undefined'&&module.exports?require('./road-renderer.js'):root.RoadRenderer;
  const key=arm=>`${arm.road}:${arm.direction}`;
  function incoming(junction){return junction.approaches.filter(a=>a.incoming&&a.laneTurns?.length&&a.availableTurns?.length);}
  function direction(arm){
    const angle=Math.atan2(arm.tangent[1],arm.tangent[0]);
    return ['东','东南','南','西南','西','西北','北','东北'][(Math.round(angle/(Math.PI/4))+8)%8]+'侧入口';
  }
  function html(junction,roads){
    const timing=junction.timing||{},signal=junction.signal;
    return `<form id="junction-form">
      <p class="junction-map-hint" id="junction-map-hint">点击图中的车道箭头，编辑通行方向</p>
      <div class="junction-preview-wrap"><canvas id="junction-preview" width="800" height="720" aria-label="路口放大图：点击车道箭头编辑" aria-describedby="junction-map-hint"></canvas><div class="junction-lane-targets" role="group" aria-label="路口图中的车道"></div><span class="junction-north">北 ↑</span>
        <div class="junction-lane-editor" id="junction-lane-editor" hidden aria-label="选中车道的通行方向">
          <div class="junction-editor-heading"><strong id="junction-lane-title"></strong><button class="city-btn" type="button" id="junction-lane-close" aria-label="关闭车道编辑">×</button></div>
          <div class="junction-turns">${Object.keys(turnNames).map(turn=>`<label><input type="checkbox" name="lane-turn" value="${turn}"><span>${turnSymbols[turn]} ${turnNames[turn]}</span></label>`).join('')}</div>
          <p class="junction-lane-note">面向路口，从左到右编号</p>
        </div>
      </div>
      <button class="city-btn" type="button" id="junction-zoom">在地图中放大路口</button>
      <h3>此路口的信号配时</h3>${signal?`
      <div class="city-fields junction-timing">${[['signalGreenSeconds','每个入口绿灯',5,90],['signalYellowSeconds','黄灯',2,6],['signalClearanceSeconds','全红清空',2,15]].map(([id,label,min,max])=>`<label>${label} / 秒<input class="city-field" name="${id}" type="number" min="${min}" max="${max}" step="1" required value="${timing[id]}"></label>`).join('')}</div>
      <p class="city-note" id="junction-cycle"></p><p class="city-note">各入口轮流放行，红灯时长由其他入口与行人阶段自动计算。仅修改此路口。</p>`:'<p class="city-note">此路口采用无信号控制。</p>'}
      <p class="junction-error" id="junction-error" role="alert" hidden></p>
      <div class="city-row"><button class="city-btn primary" type="submit">应用路口设置</button><button class="city-btn" type="button" id="junction-reset">恢复默认</button></div></form>`;
  }
  function laneLayout(junction,roads,width=800,height=720){
    const arms=incoming(junction),targets=[];
    for(const [index,arm] of arms.entries()){
      const road=roads.find(r=>r.id===arm.road);if(!road)continue;
      let clearance=arm.width/2+2;
      for(const other of junction.approaches){
        if(other===arm)continue;
        const cross=Math.abs(arm.tangent[0]*other.tangent[1]-arm.tangent[1]*other.tangent[0]);
        const dot=arm.tangent[0]*other.tangent[0]+arm.tangent[1]*other.tangent[1];
        if(cross>.05)clearance=Math.max(clearance,(other.width/2+arm.width/2*dot)/cross+2);
      }
      if(Number.isFinite(arm.crossingDistance))clearance=arm.crossingDistance-3;
      const at=renderer.sample(road.points,arm.distance+arm.direction*(clearance+20));
      const travel=at.tangent.map(v=>-v*arm.direction),laneWidth=arm.width/(arm.laneTurns.length*(road.oneway?1:2));
      arm.laneTurns.forEach((turns,lane)=>{
        const offset=(road.oneway?-arm.width/2:0)+(lane+.5)*laneWidth;
        targets.push({index,lane,turns,laneWidth,travel,point:[at.point[0]-travel[1]*offset,at.point[1]+travel[0]*offset]});
      });
    }
    const radius=Math.max(42,...junction.approaches.map(a=>a.width*1.7),...targets.map(t=>Math.hypot(t.point[0]-junction.point[0],t.point[1]-junction.point[1])+14));
    const scale=Math.min(width,height)/(radius*2);
    return {radius,scale,targets:targets.map(t=>({...t,x:width/2+(t.point[0]-junction.point[0])*scale,y:height/2+(t.point[1]-junction.point[1])*scale}))};
  }
  function invalidLane(arms,laneTurns){
    for(const [index,arm] of arms.entries()){
      const rows=laneTurns[key(arm)],empty=rows.findIndex(row=>!row.length);
      if(empty>=0)return {index,lane:empty,message:'每条车道至少保留一个通行方向。'};
      if(arm.availableTurns.some(t=>!rows.some(row=>row.includes(t))))return {index,lane:0,message:'每个可达方向至少保留一条车道。'};
    }
    return null;
  }
  function draw(canvas,junction,state,lamps){
    if(!canvas)return;
    const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
    const {radius,scale}=laneLayout(junction,state.roads,w,h);
    ctx.clearRect(0,0,w,h);ctx.fillStyle='#edf3f8';ctx.fillRect(0,0,w,h);
    ctx.save();ctx.translate(w/2,h/2);ctx.scale(scale,scale);ctx.translate(-junction.point[0],-junction.point[1]);
    const ids=new Set(junction.approaches.map(a=>a.road)),roads=state.roads.filter(r=>ids.has(r.id));
    const path=points=>{ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));};
    for(const r of roads){path(r.points);ctx.strokeStyle='#c5d0dc';ctx.lineWidth=state.meta.roadTypes[r.kind].width+3;ctx.stroke();}
    for(const r of roads){path(r.points);ctx.strokeStyle='#65778a';ctx.lineWidth=state.meta.roadTypes[r.kind].width;ctx.stroke();}
    const plan=renderer.buildPlan(state.roads,{junctions:[junction]},state.meta.roadTypes);
    for(const arm of junction.approaches){
      const r=roads.find(r=>r.id===arm.road);if(!r||!arm.laneTurns?.length)continue;
      if(arm.autoLanes)continue;
      const laneWidth=arm.width/(arm.laneTurns.length*(r.oneway?1:2));
      const t=arm.tangent,n=[t[1],-t[0]],start=arm.width;
      ctx.strokeStyle='#e5ebf2';ctx.lineWidth=.35;ctx.setLineDash([3,3]);
      for(let lane=1;lane<arm.laneTurns.length;lane++){
        const offset=(r.oneway?-arm.width/2:0)+lane*laneWidth;
        path([start,radius*1.5].map(d=>[junction.point[0]+t[0]*d+n[0]*offset,junction.point[1]+t[1]*d+n[1]*offset]));ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    ctx.strokeStyle='#e5ebf2';ctx.lineWidth=.35;ctx.setLineDash([]);
    for(const bay of plan.laneBays){path(bay.points);ctx.stroke();}
    ctx.fillStyle='#fff';ctx.strokeStyle='#fff';
    for(const stop of plan.stopLines){const n=[stop.tangent[1],-stop.tangent[0]];path([stop.oneway?-stop.width/2:0,stop.width/2].map(d=>[stop.point[0]+n[0]*d,stop.point[1]+n[1]*d]));ctx.lineWidth=.8;ctx.stroke();}
    ctx.restore();
    incoming(junction).forEach((arm,index)=>{
      const offset=arm.width/2+5;
      const x=w/2+(arm.tangent[0]*radius*.8-arm.tangent[1]*offset)*scale,y=h/2+(arm.tangent[1]*radius*.8+arm.tangent[0]*offset)*scale;
      ctx.beginPath();ctx.arc(x,y,20,0,Math.PI*2);ctx.fillStyle='#087bff';ctx.fill();ctx.fillStyle='#fff';ctx.font='bold 22px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(index+1),x,y);
      if(junction.signal){ctx.beginPath();ctx.arc(x+22,y-20,7,0,Math.PI*2);ctx.fillStyle=({green:'#20aa6c',yellow:'#ffbf32',red:'#e65454'})[lamps?.[key(arm)]]||'#8d9aa8';ctx.fill();}
    });
  }
  function bind(container,junction,state,{apply,zoom}){
    const form=container.querySelector('#junction-form'),arms=incoming(junction),preview=container.querySelector('#junction-preview');
    const editor=container.querySelector('#junction-lane-editor'),targetsBox=container.querySelector('.junction-lane-targets'),error=container.querySelector('#junction-error');
    const laneTurns=Object.fromEntries(arms.map(arm=>[key(arm),arm.laneTurns.map(turns=>[...turns])]));
    const layout=laneLayout(junction,state.roads),buttons=[];
    let draft=junction,lamps,selected=null;
    const choose=(index,lane,focus=false)=>{
      selected={index,lane};editor.hidden=false;
      const arm=arms[index],name=state.roads.find(r=>r.id===arm.road)?.name||'道路';
      container.querySelector('#junction-lane-title').textContent=`${index+1} · ${name} · ${direction(arm)} · ${lane+1} 车道`;
      for(const input of editor.querySelectorAll('input')){
        input.checked=laneTurns[key(arm)][lane].includes(input.value);input.disabled=!arm.availableTurns.includes(input.value);
        input.setAttribute('aria-label',`入口 ${index+1} 第 ${lane+1} 车道${turnNames[input.value]}`);
      }
      editor.classList.toggle('above',layout.targets.find(t=>t.index===index&&t.lane===lane).y>preview.height/2);
      refreshTargets();
      if(focus)editor.querySelector('input:not(:disabled)')?.focus();
    };
    const close=()=>{
      editor.hidden=true;const previous=selected;selected=null;refreshTargets();
      buttons.find(b=>Number(b.dataset.arm)===previous?.index&&Number(b.dataset.lane)===previous?.lane)?.focus();
    };
    for(const target of layout.targets){
      const button=document.createElement('button');button.type='button';button.className='junction-lane-target';
      button.dataset.arm=target.index;button.dataset.lane=target.lane;
      button.style.left=`${target.x/preview.width*100}%`;button.style.top=`${target.y/preview.height*100}%`;
      button.style.width=`${52/preview.width*100}%`;button.style.height=`${Math.max(24,target.laneWidth*layout.scale*.9)/preview.height*100}%`;
      button.style.transform=`translate(-50%,-50%) rotate(${Math.atan2(target.travel[1],target.travel[0])}rad)`;
      button.setAttribute('aria-controls','junction-lane-editor');
      button.onclick=()=>choose(target.index,target.lane,true);targetsBox.append(button);buttons.push(button);
    }
    function refreshTargets(){
      for(const [i,button] of buttons.entries()){
        const target=layout.targets[i],turns=laneTurns[key(arms[target.index])][target.lane];
        const active=selected?.index===target.index&&selected?.lane===target.lane;
        button.classList.toggle('active',active);button.setAttribute('aria-expanded',String(active));
        const label=`入口 ${target.index+1} 第 ${target.lane+1} 车道：${turns.map(t=>turnNames[t]).join('、')||'未选择方向'}，点击编辑`;
        button.setAttribute('aria-label',label);button.title=label;
        button.innerHTML=`<svg viewBox="-5 -3 8 6" aria-hidden="true">${turns.length?renderer.arrowPolygons(turns,target.laneWidth).map(poly=>`<polygon points="${poly.map(p=>p.join(',')).join(' ')}"/>`).join(''):'<text x="-1" y="1" text-anchor="middle" font-size="4">?</text>'}</svg>`;
      }
    }
    function refresh(){
      draft={...junction,approaches:junction.approaches.map(arm=>({...arm,laneTurns:laneTurns[key(arm)]||arm.laneTurns}))};
      draw(preview,draft,state,lamps);refreshTargets();
      if(junction.signal){
        const [green,yellow,clearance]=['signalGreenSeconds','signalYellowSeconds','signalClearanceSeconds'].map(k=>Number(form.elements.namedItem(k).value));
        const cycle=(green+yellow+clearance)*junction.signal.stages.length+junction.signal.pedestrian+3;
        container.querySelector('#junction-cycle').textContent=`周期 ${cycle} 秒 · 每个入口红灯 ${cycle-green-yellow} 秒 · 行人放行 ${junction.signal.pedestrian} 秒`;
      }
    }
    form.oninput=event=>{
      error.hidden=true;
      if(event.target.name==='lane-turn'&&selected){
        laneTurns[key(arms[selected.index])][selected.lane]=[...editor.querySelectorAll('input:checked')].map(input=>input.value);
      }
      refresh();
    };
    container.querySelector('#junction-lane-close').onclick=close;
    editor.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}};
    form.onsubmit=async event=>{
      event.preventDefault();if(!form.reportValidity())return;
      const invalid=invalidLane(arms,laneTurns);
      if(invalid){choose(invalid.index,invalid.lane,true);error.textContent=invalid.message;error.hidden=false;return;}
      const timing=junction.signal?Object.fromEntries(['signalGreenSeconds','signalYellowSeconds','signalClearanceSeconds'].map(k=>[k,Number(form.elements.namedItem(k).value)])):{};
      await apply({type:'junction_update',id:junction.id,timing,laneTurns});
    };
    container.querySelector('#junction-reset').onclick=()=>apply({type:'junction_update',id:junction.id,reset:true});
    container.querySelector('#junction-zoom').onclick=zoom;
    refresh();
    return signal=>{lamps=signal?.lamps;draw(preview,draft,state,lamps);};
  }
  const api={html,bind,draw,direction,incoming,laneLayout,invalidLane};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.JunctionEditor=api;
})(typeof window==='undefined'?{}:window);
