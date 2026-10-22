/* Metric curb snapping; roads keep their identity even at crossings. */
(function(root){
  'use strict';
  const drivable=['lane','street','avenue','highway','motorway'];
  function snap(point,roads,types,{sx=1,sy=sx,radius=22}={}){
    if(!point)return null;
    let best=null;
    for(const road of roads){
      if(!drivable.includes(road.kind))continue;
      const offset=(types[road.kind]?.width||14)/2+.8;
      for(let i=1;i<road.points.length;i++){
        const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len<.001)continue;
        for(const side of [1,-1]){
          const ox=-dy/len*offset*side,oy=dx/len*offset*side;
          const t=Math.max(0,Math.min(1,((point[0]-a[0]-ox)*dx*sx*sx+(point[1]-a[1]-oy)*dy*sy*sy)/(dx*dx*sx*sx+dy*dy*sy*sy)));
          const anchor=[a[0]+dx*t,a[1]+dy*t],curb=[anchor[0]+ox,anchor[1]+oy];
          const distance=Math.hypot((curb[0]-point[0])*sx,(curb[1]-point[1])*sy);
          if(distance<=radius&&Math.hypot(curb[0]-point[0],curb[1]-point[1])<=50&&(!best||distance<best.distance))best={point:curb,anchor,road:road.id,side,distance,heading:Math.atan2(dy,dx)+(side<0?Math.PI:0)};
        }
      }
    }
    return best;
  }
  function paint(ctx,{stops=[],paths=[],hover,scale=1,valid=true}){
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
    for(const route of paths){
      ctx.beginPath();route.points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));
      ctx.strokeStyle='#ffffffd9';ctx.lineWidth=7/scale;ctx.stroke();ctx.strokeStyle='#39877e';ctx.lineWidth=4/scale;ctx.stroke();
    }
    function marker(stop,index,ghost=false){
      const p=stop.point;if(!p)return;
      if(stop.anchor){ctx.beginPath();ctx.moveTo(...stop.anchor);ctx.lineTo(...p);ctx.lineWidth=1.5/scale;ctx.strokeStyle='#39877e';ctx.stroke();}
      ctx.beginPath();ctx.arc(...p,(ghost?8:10)/scale,0,Math.PI*2);ctx.fillStyle=ghost?'#e7f7f0':valid?'#39877e':'#b76448';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2/scale;ctx.stroke();
      ctx.fillStyle=ghost?'#28695f':'#fff';ctx.font=`600 ${11/scale}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(ghost?'+':String(index+1),...p);
      if(ghost&&Number.isFinite(stop.heading)){
        const u=[Math.cos(stop.heading),Math.sin(stop.heading)],n=[-u[1],u[0]],d=22/scale,q=[p[0]+u[0]*d,p[1]+u[1]*d];
        ctx.beginPath();ctx.moveTo(p[0]+u[0]*12/scale,p[1]+u[1]*12/scale);ctx.lineTo(...q);ctx.lineTo(q[0]-u[0]*5/scale+n[0]*4/scale,q[1]-u[1]*5/scale+n[1]*4/scale);ctx.moveTo(...q);ctx.lineTo(q[0]-u[0]*5/scale-n[0]*4/scale,q[1]-u[1]*5/scale-n[1]*4/scale);ctx.strokeStyle='#28695f';ctx.lineWidth=2/scale;ctx.stroke();
      }
    }
    stops.forEach((s,i)=>marker(s,i));if(hover)marker(hover,stops.length,true);ctx.restore();
  }
  const api={snap,paint};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CityBusGeometry=api;
})(typeof window==='undefined'?{}:window);
