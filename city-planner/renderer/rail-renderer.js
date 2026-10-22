/* Metric, deterministic track furniture. Both systems share gauge and spacing. */
(function(root){
  'use strict';
  const GAUGE=1.435, CENTERS=[-2,2], cache=new WeakMap();
  const isRail=r=>r.kind==='train'||r.kind==='metro';
  function layout(points){
    if(cache.has(points))return cache.get(points);
    const lengths=[0];
    for(let i=1;i<points.length;i++)lengths.push(lengths.at(-1)+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
    const total=lengths.at(-1),at=d=>{
      d=Math.max(0,Math.min(total,d));let lo=1,hi=points.length-1;
      while(lo<hi){const mid=(lo+hi)>>1;if(lengths[mid]<d)lo=mid+1;else hi=mid;}
      const i=lo,a=points[i-1],b=points[i],span=lengths[i]-lengths[i-1]||1,t=(d-lengths[i-1])/span;
      return {point:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],angle:Math.atan2(b[1]-a[1],b[0]-a[0])};
    };
    const offsets=CENTERS.flatMap(c=>[-GAUGE/2,GAUGE/2].map(g=>c+g));
    const paths=offsets.map(offset=>points.map((p,i)=>{
      const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],dx=b[0]-a[0],dy=b[1]-a[1],n=Math.hypot(dx,dy)||1;
      return [p[0]-dy/n*offset,p[1]+dx/n*offset];
    }));
    const result={total,at,paths};cache.set(points,result);return result;
  }
  const preparedCache=new WeakMap();
  const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
  const endpointKey=p=>p.map(v=>v.toFixed(3)).join(':');
  function prepare(roads,context=roads){
    const ends=new Map();
    for(const r of context.filter(isRail)){
      const plan=layout(r.points);
      for(const end of [0,1]){
        const at=plan.at(end?plan.total:0),key=endpointKey(at.point);
        if(!ends.has(key))ends.set(key,[]);
        ends.get(key).push({road:r,end,angle:at.angle,out:at.angle+(end?Math.PI:0)});
      }
    }
    return roads.filter(isRail).map(r=>{
      const base=layout(r.points),contacts=[0,1].map(end=>{
        const a=base.at(end?base.total:0),entries=ends.get(endpointKey(a.point))||[];
        if(entries.length!==2)return null;
        const own=entries.find(e=>e.road.id===r.id&&e.end===end),other=entries.find(e=>e!==own);
        if(!own||!other||Math.cos(own.out-other.out)>-.5)return null;
        let angle=Math.atan2(Math.sin(2*own.angle)+Math.sin(2*other.angle),Math.cos(2*own.angle)+Math.cos(2*other.angle))/2;
        if(Math.cos(angle-own.angle)<0)angle+=Math.PI;
        return {angle,mixed:r.kind!==other.road.kind};
      });
      const signature=JSON.stringify(contacts),cached=preparedCache.get(r.points);
      if(cached?.signature===signature)return {...r,...cached.value};
      // Ease the centreline over a short approach, keeping the shared node fixed.
      // Bed edges, rail heads and sleepers all use this same eased alignment.
      const span=Math.min(18,base.total*.24),ds=new Set([0,base.total]);
      for(let d=0;d<base.total;d+=1)ds.add(d);
      for(const d of [span,base.total-span])ds.add(d);
      function hermite(a,b,ta,tb,t,length){const t2=t*t,t3=t2*t;return a.map((v,k)=>(2*t3-3*t2+1)*v+(t3-2*t2+t)*length*ta[k]+(-2*t3+3*t2)*b[k]+(t3-t2)*length*tb[k]);}
      const tangent=a=>[Math.cos(a),Math.sin(a)];
      const points=[...ds].sort((a,b)=>a-b).map(d=>{
        if(contacts[0]&&d<span){const a=base.at(0),b=base.at(span);return hermite(a.point,b.point,tangent(contacts[0].angle),tangent(b.angle),d/span,span);}
        if(contacts[1]&&d>base.total-span){const a=base.at(base.total-span),b=base.at(base.total);return hermite(a.point,b.point,tangent(a.angle),tangent(contacts[1].angle),(d-base.total+span)/span,span);}
        return base.at(d).point;
      });
      const plan=layout(points);
      // Exact endpoint normals remove even subpixel gaps at the common rail heads.
      for(const end of [0,1])if(contacts[end]){
        const i=end?points.length-1:0,a=contacts[end].angle;
        plan.paths.forEach((path,j)=>{const offset=CENTERS[Math.floor(j/2)]+(j%2?1:-1)*GAUGE/2;path[i]=[points[i][0]-Math.sin(a)*offset,points[i][1]+Math.cos(a)*offset];});
      }
      const value={points,contacts};preparedCache.set(r.points,{signature,value});return {...r,...value};
    });
  }
  function bedMix(road,d,total){
    const own=road.kind==='metro'?1:0;
    let weight=0;
    if(road.contacts?.[0]?.mixed)weight=Math.max(weight,1-smooth(d/16));
    if(road.contacts?.[1]?.mixed)weight=Math.max(weight,1-smooth((total-d)/16));
    return own+(0.5-own)*weight;
  }
  function blend(a,b,t){return 'rgb('+a.map((v,i)=>Math.round(v+(b[i]-v)*t)).join(',')+')';}
  function band(ctx,plan,road,width,color,visible){
    // Shared cross-sections form a tapered shoulder instead of two square caps.
    const sections=[];
    for(let d=0;d<plan.total;d+=1)sections.push(d);sections.push(plan.total);
    for(let i=1;i<sections.length;i++){
      const a=plan.at(sections[i-1]),b=plan.at(sections[i]);
      if(!visible(a.point)&&!visible(b.point))continue;
      const ta=bedMix(road,sections[i-1],plan.total),tb=bedMix(road,sections[i],plan.total);
      if(i===1&&road.contacts[0])a.angle=road.contacts[0].angle;
      if(i===sections.length-1&&road.contacts[1])b.angle=road.contacts[1].angle;
      const edge=(p,w,side)=>[p.point[0]-Math.sin(p.angle)*w*side/2,p.point[1]+Math.cos(p.angle)*w*side/2];
      const points=[edge(a,width(ta),1),edge(b,width(tb),1),edge(b,width(tb),-1),edge(a,width(ta),-1)];
      ctx.beginPath();points.forEach((p,j)=>j?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.fillStyle=color((ta+tb)/2);ctx.fill();
      // Subpixel antialias seams between adjacent quads are covered in the same colour.
      ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=.16;ctx.stroke();
    }
  }
  function stroke(ctx,points,color,width){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
  function hash(s){let n=2166136261;for(const c of String(s))n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;}
  function noise(n){n=Math.imul(n^(n>>>16),2246822507);n=Math.imul(n^(n>>>13),3266489909);return ((n^(n>>>16))>>>0)/4294967296;}
  function local(ctx,at,fn){ctx.save();ctx.translate(...at.point);ctx.rotate(at.angle);fn();ctx.restore();}
  function paint(ctx,roads,scale,{visible=()=>true,contextRoads=roads}={}){
    ctx.save();ctx.setLineDash([]);ctx.lineCap='butt';ctx.lineJoin='round';
    const rails=prepare(roads,contextRoads);
    // All beds precede all rails: a second bed cannot erase a connected track.
    for(const r of rails){
      const metro=r.kind==='metro',plan=layout(r.points);
      band(ctx,plan,r,t=>13.2-2*t,t=>blend([115,111,101],[120,130,130],t),visible);
      band(ctx,plan,r,t=>12-2*t,t=>blend([150,144,133],[181,184,178],t),visible);
      band(ctx,plan,r,()=>6.8,t=>blend([121,117,110],[147,157,155],t),visible);
      if(r.level!==0){
        for(const side of [-1,1]){
          const edge=r.points.map((p,i)=>{const a=r.points[Math.max(0,i-1)],b=r.points[Math.min(r.points.length-1,i+1)],d=Math.hypot(b[0]-a[0],b[1]-a[1])||1;return[p[0]-(b[1]-a[1])/d*side*4.5,p[1]+(b[0]-a[0])/d*side*4.5];});
          stroke(ctx,edge,r.level<0?'#d2c8a5':'#d5d8d1',.4);
        }
      }
      if(scale>=1){
        const seed=hash(r.id),step=Math.max(.4,1.3/scale);
        for(let d=.25,i=0;d<plan.total;d+=step,i++){
          const a=plan.at(d),mix=bedMix(r,d,plan.total);if(!visible(a.point)||mix>=.999)continue;
          local(ctx,a,()=>{for(let j=0;j<18;j++){const n=seed+i*29+j*7;if(noise(n+17)<mix)continue;const y=(noise(n)-.5)*(11.9-2*mix),w=.12+noise(n+2)*.22;ctx.fillStyle=['#b3aa96','#655f56','#c7bca5','#827e76'][Math.floor(noise(n+1)*4)];ctx.fillRect(noise(n+3)*.5,y,w,w*.6);}});
        }
      }
      if(metro&&scale>=.6)for(let d=0;d<plan.total;d+=6){const a=plan.at(d);if(visible(a.point))local(ctx,a,()=>{ctx.fillStyle='#737e7c';ctx.fillRect(-.045,-4.1,.09,8.2);});}
      // Sleepers keep metric spacing; distant views skip subpixel detail.
      const step=scale>=1.5?.65:scale>=.7?1.3:2.6;
      const phase=r.contacts[1]&&!r.contacts[0]?((plan.total-step/2)%step+step)%step:step/2;
      for(let d=phase,i=0;d<plan.total;d+=step,i++){
        const a=plan.at(d);if(!visible(a.point))continue;
        local(ctx,a,()=>{for(const center of CENTERS){
          ctx.fillStyle='#343f4059';ctx.fillRect(-.09,center-1.36,.34,2.85);
          ctx.fillStyle=blend(i%7===0?[170,167,154]:[192,187,174],[208,209,199],bedMix(r,d,plan.total));ctx.fillRect(-.13,center-1.3,.26,2.6);
          if(scale>=2)for(const side of [-1,1]){const y=center+side*GAUGE/2;ctx.fillStyle='#465252';ctx.fillRect(-.16,y-.19,.32,.38);ctx.fillStyle='#b8a17b';ctx.fillRect(-.07,y-.18,.14,.1);ctx.fillRect(-.07,y+.08,.14,.1);}
        }});
      }
      // Maintenance walk and cable trough, kept outside the running gauge.
      if(metro)stroke(ctx,plan.paths[0].map((p,i)=>{const a=plan.at(Math.min(plan.total,i*plan.total/Math.max(1,r.points.length-1)));return[p[0]-Math.sin(a.angle)*.9,p[1]+Math.cos(a.angle)*.9];}),'#cbd1c7',.22);
    }
    for(const r of rails){const plan=layout(r.points);for(const p of plan.paths){stroke(ctx,p,'#574d43',.29);stroke(ctx,p,'#444e51',.17);stroke(ctx,p,'#d9e1dd',Math.max(.065,.24/scale));}
      if(scale>=1.3)for(let d=25;d<plan.total-8;d+=50){const a=plan.at(d);if(!visible(a.point))continue;local(ctx,a,()=>{
        ctx.fillStyle='#38454a';ctx.fillRect(-.35,4.4,.7,.8);ctx.fillStyle=r.kind==='metro'?'#6eb6ab':'#e4d5ad';ctx.fillRect(-.24,4.55,.48,.45);
      });}
    }
    ctx.restore();
  }
  const api={GAUGE,CENTERS,isRail,layout,prepare,bedMix,paint};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RailRenderer=api;
})(typeof window==='undefined'?{}:window);
