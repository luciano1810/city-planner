/* Geographic transit overlay: shared corridors, white casings and station rings.
   Display offsets are screen-sized; authoritative routes are never modified. */
(function(root){
  'use strict';
  const rail=l=>l.mode==='metro'||l.mode==='train';
  const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  const key=p=>p.map(n=>Math.round(n*1000)).join(',');
  const edgeKey=(a,b)=>[key(a),key(b)].sort().join('|');
  const color=l=>/^#[\da-f]{6}$/i.test(l.color)?l.color:'#337fce';
  let cached=null;
  function layout(state,scale){
    if(cached?.lines===state.lines&&cached.stops===state.stops&&cached.scale===scale)return cached.result;
    const lines=state.lines.filter(l=>l.valid),corridors=new Map(),routes=[];
    for(const line of lines)for(const p of line.paths||[]){
      if(p.direction!==0&&!line.curbRouting)continue;
      if(p.points?.length<2)continue;
      const source=rail(line)?p.points.filter((q,i)=>!i||distance(q,p.points[i-1])>.001):p.points;
      if(source.length<2)continue;
      const route={line,source,points:source};routes.push(route);
      if(!rail(line))continue;
      for(let i=1;i<source.length;i++){
        const k=edgeKey(source[i-1],source[i]);if(!corridors.has(k))corridors.set(k,new Set());corridors.get(k).add(line.id);
      }
    }
    for(const r of routes){
      if(!rail(r.line))continue;
      const offsets=[];
      for(let i=1;i<r.source.length;i++){
        const a=r.source[i-1],b=r.source[i],ids=[...corridors.get(edgeKey(a,b))].sort(),slot=ids.indexOf(r.line.id)-(ids.length-1)/2;
        const sign=(a[0]<b[0]||a[0]===b[0]&&a[1]<b[1])?1:-1,len=Math.max(.001,distance(a,b)),shift=slot*6.5/scale*sign;
        offsets.push([-(b[1]-a[1])/len*shift,(b[0]-a[0])/len*shift]);
      }
      r.points=r.source.map((p,i)=>{const a=offsets[Math.max(0,i-1)],b=offsets[Math.min(i,offsets.length-1)];return[p[0]+(a[0]+b[0])/2,p[1]+(a[1]+b[1])/2];});
    }
    const stations=[];
    for(const stop of state.stops){
      const services=lines.filter(l=>l.stops.includes(stop.id)&&l.stopPattern?.[stop.id]!==false);if(!services.length)continue;
      const marks=[];
      for(const l of services){
        const platform=stop.platforms?.find(p=>p.id===l.platforms?.[stop.id]),p=platform?.point||stop.point;
        let closest=null,best=Infinity;
        for(const r of routes.filter(r=>r.line.id===l.id))for(let i=0;i<r.source.length;i++){const d=distance(p,r.source[i]);if(d<best){best=d;closest=r.points[i];}}
        marks.push({point:closest&&best<20?closest:p,color:color(l),line:l.id});
      }
      stations.push({stop,marks,terminal:services.some(l=>!l.servicePattern?.startsWith('loop')&&(l.stops[0]===stop.id||l.stops.at(-1)===stop.id))});
    }
    const result={routes,stations};cached={lines:state.lines,stops:state.stops,scale,result};return result;
  }
  function trace(ctx,points){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));}
  function badge(ctx,point,text,fill,scale){
    ctx.save();ctx.translate(...point);ctx.scale(1/scale,1/scale);ctx.font='600 11px -apple-system, BlinkMacSystemFont, sans-serif';
    const w=ctx.measureText(text).width+14;ctx.beginPath();ctx.roundRect(-w/2,-10,w,20,5);ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle='#ffffff';ctx.lineWidth=2;ctx.stroke();
    const rgb=fill.slice(1).match(/../g).map(n=>parseInt(n,16));ctx.fillStyle=(rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722)>165?'#172c39':'#fff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,0,.5);ctx.restore();
  }
  function paint(ctx,state,{scale,selected,visible=()=>true,inView=()=>true,label=()=>{},lineColor=color}={}){
    const plan=layout(state,scale),ids=new Set(),labels=[];ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.setLineDash([]);
    // All casings first, then all colored strokes; shared services stay legible.
    for(const casing of [true,false])for(const r of plan.routes){
      if(!inView(r.points))continue;trace(ctx,r.points);ctx.globalAlpha=1;ctx.strokeStyle=casing?'#ffffff':lineColor(r.line);
      ctx.lineWidth=((rail(r.line)?5:3)+(r.line.id===selected?1.5:0)+(casing?3:0))/scale;ctx.stroke();
    }
    const shown=new Set();for(const r of plan.routes){
      if(shown.has(r.line.id)||scale<.12)continue;
      const segments=[];for(let i=1;i<r.points.length;i++)segments.push({a:r.points[i-1],b:r.points[i],length:distance(r.points[i-1],r.points[i])});
      let at=null;
      for(const seg of segments.sort((a,b)=>b.length-a.length)){
        if(seg.length*scale<110)continue;
        const inset=Math.min(.5,120/(seg.length*scale));
        for(const fraction of [.5,.33,.67,.2,.8,inset,Math.min(.5,inset*2),1-inset]){
          const q=seg.a.map((v,k)=>v+(seg.b[k]-v)*fraction);
          const nearStation=plan.stations.some(s=>s.marks.some(m=>distance(m.point,q)*scale<110));
          if(visible(q)&&!nearStation&&!labels.some(p=>distance(p,q)*scale<100)){at=q;break;}
        }
        if(at)break;
      }
      if(at){
        const short=r.line.name.split(/[·|]/)[0].trim(),name=short.length<=8?short:r.line.name.length>8?r.line.name.slice(0,7)+'…':r.line.name;
        badge(ctx,at,name,color(r.line),scale);labels.push(at);shown.add(r.line.id);
      }
    }
    for(const {stop,marks,terminal} of plan.stations){
      if(!visible(stop.point))continue;ids.add(stop.id);
      if(marks.length>1){trace(ctx,marks.map(m=>m.point));ctx.strokeStyle='#3e4b53';ctx.lineWidth=11/scale;ctx.stroke();ctx.strokeStyle='#fff';ctx.lineWidth=8/scale;ctx.stroke();}
      const unique=new Map(marks.map(m=>[key(m.point),m]));
      for(const mark of unique.values()){ctx.beginPath();ctx.arc(...mark.point,(terminal?4.2:3.4)/scale,0,2*Math.PI);ctx.fillStyle='#fff';ctx.fill();ctx.strokeStyle=marks.length>1?'#3e4b53':mark.color;ctx.lineWidth=2/scale;ctx.stroke();}
      if(scale>.16||terminal||selected===stop.id)label(stop.name,[marks[0].point[0]+9/scale,marks[0].point[1]-10/scale],12,'#253c48',terminal?80:50,'left',{id:stop.id});
    }
    for(const transfer of state.railInfrastructure?.transfers||[]){
      if(!transfer.valid||!transfer.points?.length||!inView(transfer.points))continue;
      trace(ctx,transfer.points);ctx.lineWidth=2/scale;ctx.strokeStyle='#60717b';ctx.setLineDash([2/scale,4/scale]);ctx.stroke();ctx.setLineDash([]);
    }
    ctx.restore();return ids;
  }
  const api={layout,paint};root.CityTransitOverlay=api;if(typeof module==='object')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
