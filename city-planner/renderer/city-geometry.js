/* Identical chord-scaled interpolation to backend city.geometry.curve_points. */
(function(root){
  const appearance=typeof module!=='undefined'&&module.exports?require('./building-appearance.js'):root.CityBuildingAppearance;
  function eventLocation(state,event){
    const point=event?.point;
    if(!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite))return null;
    // Existing saves identify construction events by their parcel center.
    const parcel=state.parcels.find(p=>p.center&&Math.hypot(p.center[0]-point[0],p.center[1]-point[1])<.01)
      ||state.parcels.find(p=>p.points?.length&&containsPoint(point,p.points));
    const points=parcel?.building?.footprint?.length?parcel.building.footprint:parcel?.points;
    if(!points?.length)return {point,id:null,size:[150,150]};
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
    return {point:[(left+right)/2,(top+bottom)/2],id:parcel.id,
      size:[Math.max(30,right-left),Math.max(30,bottom-top+(parcel.building?.height||0))]};
  }
  function facilityForParcel(state,parcel){
    return parcel&&!parcel.building&&parcel.openSpace?state.facilities.find(f=>f.id===parcel.openSpace):null;
  }
  function inspectionId(state,id){
    return facilityForParcel(state,state.parcels.find(p=>p.id===id))?.id||id;
  }
  const junctionHitAreas=new WeakMap();
  function junctionHitArea(junction){
    if(junctionHitAreas.has(junction))return junctionHitAreas.get(junction);
    const arms=junction.approaches.filter(a=>a.width>0&&a.tangent?.length===2),points=[];
    for(const arm of arms){
      const [ux,uy]=arm.tangent,half=arm.width/2;
      // Match the road renderer's intersection clearance and stop-line offset.
      // A polygon through the full-width entries includes the corners that a
      // center-radius test misses, especially on wide or oblique intersections.
      let clearance=half+2;
      for(const other of arms){
        if(other===arm)continue;
        const cross=Math.abs(ux*other.tangent[1]-uy*other.tangent[0]);
        const dot=ux*other.tangent[0]+uy*other.tangent[1];
        if(cross>.05)clearance=Math.max(clearance,(other.width/2+half*dot)/cross+2);
      }
      for(const along of [0,clearance+7])for(const side of [-1,1]){
        points.push([junction.point[0]+ux*along-uy*half*side,junction.point[1]+uy*along+ux*half*side]);
      }
    }
    points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const chain=items=>{const result=[];for(const p of items){while(result.length>1&&cross(result.at(-2),result.at(-1),p)<=0)result.pop();result.push(p);}return result;};
    const polygon=points.length<3?[]:[...chain(points).slice(0,-1),...chain(points.slice().reverse()).slice(0,-1)];
    junctionHitAreas.set(junction,polygon);return polygon;
  }
  function junctionAt(junctions,point,scaleX,scaleY,radius=20){
    let nearest=null,distance=radius;
    for(const junction of junctions){
      // Endpoints and shape vertices are not inspectable intersections.
      if(junction.approaches.length<3&&new Set(junction.approaches.map(a=>a.road)).size<2)continue;
      const dx=junction.point[0]-point[0],dy=junction.point[1]-point[1];
      const d=Math.hypot(dx*scaleX,dy*scaleY),polygon=junctionHitArea(junction);
      const inArea=polygon.length>=3&&polygon.every((a,i)=>{const b=polygon[(i+1)%polygon.length];return (b[0]-a[0])*(point[1]-a[1])-(b[1]-a[1])*(point[0]-a[0])>=-1e-7;});
      const halfWidth=polygon.length?0:Math.max(0,...junction.approaches.map(a=>(a.width||0)/2));
      const fallback=Math.hypot(dx*scaleX/Math.max(radius,halfWidth*scaleX),dy*scaleY/Math.max(radius,halfWidth*scaleY))<=1;
      if(!fallback&&!inArea)continue;
      if(!nearest||d<distance){nearest=junction;distance=d;}
    }
    return nearest;
  }
  // A pointer is only a guide to the next click. It must never bend the
  // committed alignment or inherit a validation result for different points.
  function roadDraftPlan(controls,hover,curved=true,preview=null){
    const points=preview?.valid?preview.road.points:curvePoints(controls,curved);
    const last=points.at(-1);
    const guide=last&&hover&&Math.hypot(last[0]-hover[0],last[1]-hover[1])>1e-6?[last,hover]:[];
    return {points,guide,invalid:preview?.valid===false,reason:preview?.valid===false?preview.reason:null};
  }
  function roadControlAt(controls,point,scaleX,scaleY,radius=10){
    let best=-1,distance=radius;
    controls.forEach((p,i)=>{
      const d=Math.hypot((p[0]-point[0])*scaleX,(p[1]-point[1])*scaleY);
      if(d<=distance){best=i;distance=d;}
    });
    return best;
  }
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
  const buildingLayouts=new WeakMap();
  function polygonArea(points){return Math.abs(points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a[0]*b[1]-b[0]*a[1];},0))/2;}
  function containsPoint([x,y],points){
    let hit=false;
    for(let i=0,j=points.length-1;i<points.length;j=i++){
      const a=points[j],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],len=dx*dx+dy*dy;
      const t=len?Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/len)):0;
      if(Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)<1e-6)return true;
      if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;
    }return hit;
  }
  function rectangleInside(rect,points){
    const [x0,y0,x1,y1]=rect;
    if(![[x0,y0],[x1,y0],[x1,y1],[x0,y1]].every(p=>containsPoint(p,points)))return false;
    // Corner tests alone bridge narrow courtyards. Reject any polygon edge
    // entering the rectangle's open interior, even with both endpoints outside.
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i];let lo=0,hi=1;
      for(let k=0;k<2;k++){
        const min=rect[k]+1e-6,max=rect[k+2]-1e-6,d=b[k]-a[k];
        if(Math.abs(d)<1e-10){if(a[k]<min||a[k]>max){hi=-1;break;}}
        else {const t0=(min-a[k])/d,t1=(max-a[k])/d;lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));}
      }
      if(lo<hi-1e-9)return false;
    }return true;
  }
  function fitBuildingMasses(points,minWidth=6){
    const x0=Math.min(...points.map(p=>p[0])),y0=Math.min(...points.map(p=>p[1])),x1=Math.max(...points.map(p=>p[0])),y1=Math.max(...points.map(p=>p[1]));
    const envelope=[x0,y0,x1,y1],width=x1-x0,depth=y1-y0;
    if(Math.min(width,depth)<minWidth)return [];
    if(rectangleInside(envelope,points)&&Math.max(width/depth,depth/width)<=5)return [envelope];
    const cols=32,rows=24,dx=width/cols,dy=depth/rows;
    const xs=Array.from({length:cols+1},(_,i)=>x0+dx*i),ys=Array.from({length:rows+1},(_,i)=>y0+dy*i);
    const cells=Array.from({length:rows},(_,j)=>Array.from({length:cols},(_,i)=>rectangleInside([xs[i],ys[j],xs[i+1],ys[j+1]],points)));
    const masses=[];
    for(let pass=0;pass<3;pass++){
      let best=null,bestArea=0;const heights=Array(cols).fill(0);
      for(let row=0;row<rows;row++){
        for(let c=0;c<cols;c++)heights[c]=cells[row][c]?heights[c]+1:0;
        const stack=[];
        for(let right=0;right<=cols;right++){
          const h=right<cols?heights[right]:0;let left=right;
          while(stack.length&&stack.at(-1)[1]>h){
            const [start,tall]=stack.pop();left=start;
            let a=xs[start],b=ys[row+1-tall],c=xs[right],d=ys[row+1];
            // Long slab wings stay buildable; thin cadastral slivers remain a
            // low terrace instead of turning into a blade-shaped upper storey.
            if(c-a>(d-b)*5){const trim=((c-a)-(d-b)*5)/2;a+=trim;c-=trim;}
            if(d-b>(c-a)*5){const trim=((d-b)-(c-a)*5)/2;b+=trim;d-=trim;}
            const area=(c-a)*(d-b);
            const joined=!masses.length||masses.some(q=>
              Math.min(Math.abs(a-q[2]),Math.abs(c-q[0]))<dx+.01&&Math.min(d,q[3])-Math.max(b,q[1])>=minWidth*.7||
              Math.min(Math.abs(b-q[3]),Math.abs(d-q[1]))<dy+.01&&Math.min(c,q[2])-Math.max(a,q[0])>=minWidth*.7);
            if(joined&&Math.min(c-a,d-b)>=minWidth&&area>bestArea){best=[a,b,c,d];bestArea=area;}
          }
          if(h&&(!stack.length||stack.at(-1)[1]<h))stack.push([left,h]);
        }
      }
      if(!best||bestArea<Math.max(36,masses.length?(masses[0][2]-masses[0][0])*(masses[0][3]-masses[0][1])*.15:0))break;
      masses.push(best);
      for(let j=0;j<rows;j++)for(let i=0;i<cols;i++)if(xs[i]<best[2]-1e-7&&xs[i+1]>best[0]+1e-7&&ys[j]<best[3]-1e-7&&ys[j+1]>best[1]+1e-7)cells[j][i]=false;
    }
    return masses;
  }
  function buildingMassing(parcel){
    const b=parcel.building;if(buildingLayouts.has(b))return buildingLayouts.get(b);
    const points=b.footprint,origin=b.center||parcel.center,angle=footprintAxis(points)*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
    const local=points.map(([x,y])=>[(x-origin[0])*cos+(y-origin[1])*sin,-(x-origin[0])*sin+(y-origin[1])*cos]);
    const world=([x,y])=>[origin[0]+x*cos-y*sin,origin[1]+x*sin+y*cos];
    const height=b.height||b.floors*3.3||6,industrial=['industrial','warehouse'].includes(b.use);
    let rects=fitBuildingMasses(local,industrial?6:5.5);
    const type=industrial?'hall':b.use==='residential'&&b.floors<=3?'house':b.use==='office'&&b.floors>=7?'tower':b.use==='residential'?'apartment':b.use;
    const area=polygonArea(local),covered=rects.reduce((sum,r)=>sum+(r[2]-r[0])*(r[3]-r[1]),0);
    // Legacy saves keep their legal footprint and capacity. Irregular edges
    // become a low podium/terrace with regular upper masses contained inside it.
    const podium=rects.length>0&&covered<area*.985?{points,height:Math.min(3.3,height*.3),type:'terrace',base:0}:null;
    const volumes=rects.map((rect,i)=>({rect,points:[[rect[0],rect[1]],[rect[2],rect[1]],[rect[2],rect[3]],[rect[0],rect[3]],[rect[0],rect[1]]].map(world),
      origin,angle,height:i?Math.max(podium?.height||0,height*(industrial?.78:.68)):height,base:podium?.height||0,type}));
    if(b.landmark==='cbd_skyscraper'&&height>100&&volumes.length){
      const primary=volumes[0],r=primary.rect,cx=(r[0]+r[2])/2,cy=(r[1]+r[3])/2;
      const steps=(b.towerVariant||0)%3===0?[[1,.09],[.82,.72],[.64,.94],[.38,1]]:(b.towerVariant||0)%3===1?[[1,.08],[.77,.88],[.57,1]]:[[1,.1],[.88,.55],[.7,.84],[.52,1]];
      let base=0;const tower=steps.map(([ratio,top],i)=>{
        const w=(r[2]-r[0])*ratio,d=(r[3]-r[1])*ratio,rect=[cx-w/2,cy-d/2,cx+w/2,cy+d/2];
        const volume={...primary,rect,base,height:height*top,type:i?'tower':'terrace',points:[[rect[0],rect[1]],[rect[2],rect[1]],[rect[2],rect[3]],[rect[0],rect[3]],[rect[0],rect[1]]].map(world)};
        base=height*top;return volume;
      });
      volumes.splice(0,1,...tower);
      for(const v of volumes.slice(tower.length))v.height=Math.min(v.height,12);
    }
    if(!volumes.length)volumes.push({points,height,base:0,type:'flat'});
    if(type==='tower'&&volumes.length===1&&b.landmark!=='cbd_skyscraper'){
      const part=volumes[0],r=part.rect,step=Math.min((r[2]-r[0])*.1,(r[3]-r[1])*.1,2.8);
      if(step>.8){
        const rect=[r[0]+step,r[1]+step,r[2]-step,r[3]-step],base=Math.min(height*.24,9.9);
        volumes[0]={...part,height:base,type:'terrace'};
        volumes.push({...part,rect,base,height,points:[[rect[0],rect[1]],[rect[2],rect[1]],[rect[2],rect[3]],[rect[0],rect[3]],[rect[0],rect[1]]].map(world)});
      }
    }
    // Modest setbacks use the same volumes in Canvas, WebGL and roof planning.
    let facadeSeed=2166136261;for(const ch of String(parcel.id)){facadeSeed^=ch.charCodeAt(0);facadeSeed=Math.imul(facadeSeed,16777619);}facadeSeed>>>=0;
    if(volumes.length===1&&volumes[0].rect&&b.floors>=3&&b.floors<=6&&['office','commercial','residential'].includes(b.use)&&facadeSeed%4!==0){
      const v=volumes[0],[x0,y0,x1,y1]=v.rect;
      if(x1-x0>18&&y1-y0>18){const rect=[x0+2.2,y0+2.2,x1-2.2,y1-(facadeSeed%2?7:3.6)],base=v.height-3.3;
        volumes.splice(0,1,{...v,height:base,type:'terrace'},{...v,rect,base,points:[[rect[0],rect[1]],[rect[2],rect[1]],[rect[2],rect[3]],[rect[0],rect[3]],[rect[0],rect[1]]].map(world)});
      }
    }
    const original={podium,volumes,type},result=appearance?appearance.massing(parcel,original):original;buildingLayouts.set(b,result);return result;
  }
  // Distances and projection are measured in CSS pixels, including tilted maps.
  function roadSnap(point,roads,junctions,{kind='street',level=0,sx=1,sy=sx,radius=14,exclude=null}={}){
    if(!point||!(sx>0&&sy>0))return null;
    const family=k=>['lane','street','avenue','highway','motorway','path'].includes(k)?'road':['train','metro'].includes(k)?'rail':k;
    const eligible=roads.filter(r=>r.id!==exclude&&family(r.kind)===family(kind));
    const ids=new Set(eligible.map(r=>r.id));let best=null;
    function offer(p,type,priority,road){
      const distance=Math.hypot((p[0]-point[0])*sx,(p[1]-point[1])*sy);
      if(distance>radius)return;
      if(!best||priority<best.priority||priority===best.priority&&distance<best.distance)
        best={point:[...p],type,priority,distance,road};
    }
    for(const j of junctions||[])if(j.approaches.length&&j.approaches.every(a=>a.level===level&&ids.has(a.road)))offer(j.point,'交叉口',0,null);
    for(const r of eligible){
      offer(r.points[0],'道路端点',1,r.id);offer(r.points.at(-1),'道路端点',1,r.id);
      // A bridge endpoint may land on a ground road; a ground endpoint
      // cannot jump into the middle of an elevated span.
      if(r.level!==level&&!(level!==0&&r.level===0))continue;
      for(let i=1;i<r.points.length;i++){
        const a=r.points[i-1],b=r.points[i],dx=(b[0]-a[0])*sx,dy=(b[1]-a[1])*sy;
        const t=Math.max(0,Math.min(1,((point[0]-a[0])*sx*dx+(point[1]-a[1])*sy*dy)/(dx*dx+dy*dy||1)));
        offer([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])],'道路中段',2,r.id);
      }
    }
    return best;
  }
  const api={eventLocation,facilityForParcel,inspectionId,junctionAt,roadSnap,curvePoints,roadDraftPlan,roadControlAt,footprintAxis,polygonArea,containsPoint,rectangleInside,fitBuildingMasses,buildingMassing};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.CityGeometry=api;
})(typeof window==='undefined'?{}:window);
