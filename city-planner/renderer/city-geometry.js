/* Identical chord-scaled interpolation to backend city.geometry.curve_points. */
(function(root){
  function curvePoints(controls,curved=true,spacing=8){
    const points=controls.map(p=>p.slice());
    if(!curved||points.length<3)return points;
    const result=[points[0]];
    for(let i=0;i<points.length-1;i++){
      const a=points[i],b=points[i+1],before=points[Math.max(0,i-1)],after=points[Math.min(points.length-1,i+2)];
      const chord=Math.hypot(a[0]-b[0],a[1]-b[1]);
      const tangent=(p,q)=>q.map((v,k)=>(v-p[k])*chord/Math.max(chord,Math.hypot(q[0]-p[0],q[1]-p[1]),1));
      const ta=tangent(before,b),tb=tangent(a,after),n=Math.max(2,Math.min(512,Math.ceil(chord/spacing)));
      for(let j=1;j<=n;j++){const t=j/n,t2=t*t,t3=t2*t;result.push(a.map((v,k)=>(2*t3-3*t2+1)*v+(t3-2*t2+t)*ta[k]+(-2*t3+3*t2)*b[k]+(t3-t2)*tb[k]));}
    }return result;
  }
  const roofAxes=new WeakMap();
  function footprintAxis(points){
    // An assembled site's old entrance no longer identifies its roof axis.
    // Use the long side of the footprint's minimum-area enclosing rectangle.
    // Snapshot coordinate arrays are immutable between renders.
    if(roofAxes.has(points))return roofAxes.get(points);
    const sorted=points.filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1])).map(p=>p.slice()).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const unique=sorted.filter((p,i)=>!i||p[0]!==sorted[i-1][0]||p[1]!==sorted[i-1][1]);
    if(unique.length<2){roofAxes.set(points,0);return 0;}
    const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const half=values=>{const out=[];for(const p of values){while(out.length>1&&cross(out.at(-2),out.at(-1),p)<=0)out.pop();out.push(p);}return out;};
    const hull=half(unique).slice(0,-1).concat(half(unique.slice().reverse()).slice(0,-1));
    let bestArea=Infinity,bestAngle=0;
    for(let i=0;i<hull.length;i++){
      const a=hull[i],b=hull[(i+1)%hull.length],angle=Math.atan2(b[1]-a[1],b[0]-a[0]);
      const cos=Math.cos(angle),sin=Math.sin(angle);
      const x=hull.map(p=>(p[0]-a[0])*cos+(p[1]-a[1])*sin),y=hull.map(p=>-(p[0]-a[0])*sin+(p[1]-a[1])*cos);
      const width=Math.max(...x)-Math.min(...x),height=Math.max(...y)-Math.min(...y),area=width*height;
      let axis=((angle+(height>width?Math.PI/2:0))*180/Math.PI%180+180)%180;
      if(Math.abs(axis-180)<1e-8||Math.abs(axis)<1e-8)axis=0;
      if(area<bestArea-1e-7||Math.abs(area-bestArea)<1e-7&&axis<bestAngle){bestArea=area;bestAngle=axis;}
    }
    roofAxes.set(points,bestAngle);return bestAngle;
  }
  const api={curvePoints,footprintAxis};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.CityGeometry=api;
})(typeof window==='undefined'?{}:window);
