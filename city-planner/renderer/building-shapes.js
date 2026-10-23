/* Display-only footprints. Outlines follow the legal footprint or a fitted
 * rectangle; no saved parcel geometry, capacity or routing is changed. */
(function(root){
  'use strict';
  // Conventional rectangular architecture remains the majority. Curved
  // forms are rare and reserved for spacious office/commercial plots.
  const mixes={residential:true,office:true,commercial:true,industrial:true,warehouse:true};
  const names=['ellipse','rounded','chamfered','plot-following','plot-bevel','plot-setback'];
  function hash(s){let n=2166136261;for(const c of String(s)){n^=c.charCodeAt(0);n=Math.imul(n,16777619);}return n>>>0;}
  const area=p=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2;
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  function contains(p,ring){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[j],b=ring[i],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
    if(Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)<1e-7)return true;
    if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;
  }return hit;}
  function fits(rect,ring,margin=0){
    const r=[rect[0]-margin,rect[1]-margin,rect[2]+margin,rect[3]+margin];
    if(![[r[0],r[1]],[r[2],r[1]],[r[2],r[3]],[r[0],r[3]]].every(p=>contains(p,ring)))return false;
    // A concave notch can cross the box while all four corners remain inside.
    for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length];let lo=0,hi=1;
      for(let k=0;k<2;k++){const d=b[k]-a[k],min=r[k]+1e-7,max=r[k+2]-1e-7;
        if(Math.abs(d)<1e-10){if(a[k]<min||a[k]>max){hi=-1;break;}}
        else{const t0=(min-a[k])/d,t1=(max-a[k])/d;lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));}}
      if(lo<hi-1e-8)return false;
    }return true;
  }
  function triangulate(ring){
    const ps=ring.slice();if(ps.length>1&&Math.hypot(ps[0][0]-ps.at(-1)[0],ps[0][1]-ps.at(-1)[1])<1e-8)ps.pop();
    if(area(ps)<0)ps.reverse();const result=[],ids=ps.map((_,i)=>i);
    while(ids.length>3){let found=false;
      for(let j=0;j<ids.length;j++){
        const ia=ids[(j+ids.length-1)%ids.length],ib=ids[j],ic=ids[(j+1)%ids.length],a=ps[ia],b=ps[ib],c=ps[ic];
        if(cross(a,b,c)<=1e-9)continue;
        if(ids.some(i=>i!==ia&&i!==ib&&i!==ic&&cross(a,b,ps[i])>=-1e-9&&cross(b,c,ps[i])>=-1e-9&&cross(c,a,ps[i])>=-1e-9))continue;
        result.push([a,b,c]);ids.splice(j,1);found=true;break;
      }if(!found)return [];
    }if(ids.length===3)result.push(ids.map(i=>ps[i]));return result;
  }
  function outline(name){
    const circle=(n,phase=0)=>Array.from({length:n},(_,i)=>[Math.cos(phase+i*2*Math.PI/n),Math.sin(phase+i*2*Math.PI/n)]);
    if(name==='ellipse')return circle(32);
    if(name==='chamfered')return [[-.65,-1],[.65,-1],[1,-.65],[1,.65],[.65,1],[-.65,1],[-1,.65],[-1,-.65]];
    const ps=[],r=.42;for(const [cx,cy,start] of [[1-r,1-r,0],[-1+r,1-r,Math.PI/2],[-1+r,-1+r,Math.PI],[1-r,-1+r,Math.PI*1.5]])for(let i=0;i<=6;i++){const t=start+i*Math.PI/12;ps.push([cx+r*Math.cos(t),cy+r*Math.sin(t)]);}return ps;
  }
  function massing(parcel,layout){
    const b=parcel.building;if(parcel.id==null||b.landmark||!mixes[b.use]||b.visualShape==='standard')return null;
    const v=layout.volumes[0],r=v?.rect;if(!r)return null;
    const [x0,y0,x1,y1]=r,w=x1-x0,d=y1-y0,seed=hash(parcel.id+':shape-v1');
    if(Math.min(w,d)<10||Math.max(w/d,d/w)>5)return null;
    const c=Math.cos(v.angle),s=Math.sin(v.angle);
    const footprint=b.footprint.map(([x,y])=>[(x-v.origin[0])*c+(y-v.origin[1])*s,-(x-v.origin[0])*s+(y-v.origin[1])*c]);
    const bounds=[Math.min(...footprint.map(p=>p[0])),Math.min(...footprint.map(p=>p[1])),Math.max(...footprint.map(p=>p[0])),Math.max(...footprint.map(p=>p[1]))];
    const irregular=Math.abs(area(footprint))<(bounds[2]-bounds[0])*(bounds[3]-bounds[1])*.985;
    const roll=seed%100;
    let selected=b.visualShape;
    if(!selected){
      if(irregular)selected=roll<52?'standard':roll<72?'plot-following':roll<90?'plot-bevel':'plot-setback';
      else selected=roll<76?'standard':roll<89?'chamfered':roll<97?'rounded':(['office','commercial'].includes(b.use)&&Math.min(w,d)>28?'ellipse':'standard');
    }
    if(!names.includes(selected))return null;
    if(layout.podium&&!selected.startsWith('plot-'))return null;
    const cx=(x0+x1)/2,cy=(y0+y1)/2,h=b.height||b.floors*3.3;
    function part(name,rx,ry,x,y,base,height){
      const ring=outline(name).map(([a,b])=>[x+a*rx,y+b*ry]);if(area(ring)<0)ring.reverse();
      const points=ring.map(([a,b])=>[v.origin[0]+a*c-b*s,v.origin[1]+a*s+b*c]);points.push(points[0].slice());
      return {...v,points,rect:[x-rx,y-ry,x+rx,y+ry],outline:ring,shape:selected,smooth:['ellipse','rounded'].includes(selected),base,height};
    }
    if(selected.startsWith('plot-')){
      let ring=footprint;
      if(Math.hypot(ring[0][0]-ring.at(-1)[0],ring[0][1]-ring.at(-1)[1])<1e-7)ring.pop();
      if(area(ring)<0)ring.reverse();
      if(selected==='plot-bevel')ring=ring.flatMap((p,i)=>{
        const a=ring[(i+ring.length-1)%ring.length],z=ring[(i+1)%ring.length];
        if(cross(a,p,z)<=1e-6)return [p];
        const da=Math.hypot(a[0]-p[0],a[1]-p[1]),dz=Math.hypot(z[0]-p[0],z[1]-p[1]),cut=Math.min(.7+(seed>>>8)%16/10,da*.16,dz*.16);
        const aa=[p[0]+(a[0]-p[0])*cut/da,p[1]+(a[1]-p[1])*cut/da],zz=[p[0]+(z[0]-p[0])*cut/dz,p[1]+(z[1]-p[1])*cut/dz];
        // Check the replacement chord against the original concave footprint.
        return [0,.25,.5,.75,1].every(t=>contains([aa[0]+(zz[0]-aa[0])*t,aa[1]+(zz[1]-aa[1])*t],ring))?[aa,zz]:[p];
      });
      if(!triangulate(ring).length)return null;
      const points=ring.map(([a,b])=>[v.origin[0]+a*c-b*s,v.origin[1]+a*s+b*c]);points.push(points[0].slice());
      const rect=[Math.min(...ring.map(p=>p[0])),Math.min(...ring.map(p=>p[1])),Math.max(...ring.map(p=>p[0])),Math.max(...ring.map(p=>p[1]))];
      const baseHeight=selected==='plot-setback'?Math.min(h*.4,9.9):h;
      const base={...v,rect,points,outline:ring,shape:selected,smooth:false,base:0,height:baseHeight};
      const upper=selected==='plot-setback'?layout.volumes.filter(q=>q.rect&&q.height>baseHeight+.1).map(q=>({...q,base:baseHeight})):[];
      return {...layout,podium:null,shape:selected,volumes:[base,...upper]};
    }
    const rx=w*.49,ry=d*.49;
    const volumes=[part(selected,rx,ry,cx,cy,0,h)];
    return {...layout,shape:selected,volumes};
  }
  const api={massing,contains,fits,triangulate,area,names};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CityBuildingShapes=api;
})(typeof window==='undefined'?{}:window);
