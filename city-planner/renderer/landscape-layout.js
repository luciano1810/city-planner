/* Display-only planting plans, shared by Canvas and WebGL. All contours and
 * roots stay within the original editable facility polygon. */
(function(root){
  'use strict';
  const cache=new WeakMap(),courtyardCache=new WeakMap();
  const C=typeof module!=='undefined'&&module.exports?require('./material-catalog.js'):root.SceneMaterials;
  function hash(s){let n=2166136261;for(const c of String(s)){n^=c.charCodeAt(0);n=Math.imul(n,16777619);}return n>>>0;}
  function random(s){let n=hash(s);return()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};}
  function inside(p,ps){let yes=false;for(let i=0,j=ps.length-1;i<ps.length;j=i++)if((ps[i][1]>p[1])!==(ps[j][1]>p[1])&&p[0]<(ps[j][0]-ps[i][0])*(p[1]-ps[i][1])/(ps[j][1]-ps[i][1])+ps[i][0])yes=!yes;return yes;}
  function distance(p,ps){let d=Infinity;for(let i=0;i<ps.length;i++){const a=ps[i],b=ps[(i+1)%ps.length],x=b[0]-a[0],y=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*y)/(x*x+y*y||1)));d=Math.min(d,Math.hypot(p[0]-a[0]-x*t,p[1]-a[1]-y*t));}return d;}
  function rounded(ps,radius=3){
    const clean=ps.slice();if(Math.hypot(clean[0][0]-clean.at(-1)[0],clean[0][1]-clean.at(-1)[1])<1e-6)clean.pop();
    const result=[];
    for(let i=0;i<clean.length;i++){
      const a=clean[(i+clean.length-1)%clean.length],b=clean[i],c=clean[(i+1)%clean.length],l=Math.hypot(a[0]-b[0],a[1]-b[1]),m=Math.hypot(c[0]-b[0],c[1]-b[1]),r=Math.min(radius,l*.42,m*.42);
      const from=b.map((v,k)=>v+(a[k]-v)*r/l),to=b.map((v,k)=>v+(c[k]-v)*r/m);
      for(let j=0;j<9;j++){const t=j/8;result.push(b.map((v,k)=>(1-t)**2*from[k]+2*t*(1-t)*v+t*t*to[k]));}
    }return result;
  }
  function lineDistance(p,ps){let d=Infinity;for(let i=1;i<ps.length;i++){
    const a=ps[i-1],b=ps[i],x=b[0]-a[0],y=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*y)/(x*x+y*y||1)));
    d=Math.min(d,Math.hypot(p[0]-a[0]-x*t,p[1]-a[1]-y*t));
  }return d;}
  function hull(points){
    const ps=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]),cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),lower=[],upper=[];
    for(const p of ps){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
    for(const p of ps.slice().reverse()){while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
    return lower.slice(0,-1).concat(upper.slice(0,-1));
  }
  // Group existing courtyard roots into small shared beds. No tree root or
  // saved polygon moves. All expensive contour/clearance work is cached here.
  function courtyard(site,source,context){
    const prior=courtyardCache.get(site);
    if(prior&&(prior.source===source||prior.plan?.trees===source)&&(!context||prior.context===context))return prior.plan;
    const remember=plan=>{courtyardCache.set(site,{source,context,plan});return plan;};
    if(!site.building||site.building.status==='construction'||!site.points?.length||source.length<2)return remember(null);
    const extent=ps=>[Math.min(...ps.map(p=>p[0])),Math.min(...ps.map(p=>p[1])),Math.max(...ps.map(p=>p[0])),Math.max(...ps.map(p=>p[1]))],siteBounds=extent(site.points);
    const near=ps=>{const b=extent(ps);return b[0]-.8<siteBounds[2]&&b[2]+.8>siteBounds[0]&&b[1]-.8<siteBounds[3]&&b[3]+.8>siteBounds[1];};
    const rng=random(site.id+':courtyard'),polygons=[site.building.footprint,...(context?.polygons||[])].filter(p=>p?.length>2&&near(p)),surfaces=[...(site.forecourt||[]),...(context?.surfaces||[])].filter(s=>near(s.points));
    const paths=(context?.paths||[]).filter(p=>p.points?.length>1&&near(p.points)).map(p=>({...p,width:p.width||3}));
    if(site.accessPath?.length>1)paths.push({points:site.accessPath,width:site.accessWidth||3});
    const entrance=site.entrance||site.building.entrance||site.building.center||site.center;
    if(site.frontage&&entrance)paths.push({points:[site.frontage,entrance],width:3});
    const clear=p=>inside(p,site.points)&&distance(p,site.points)>.45
      &&!polygons.some(ps=>inside(p,ps)||distance(p,ps)<.65)
      &&!surfaces.some(s=>inside(p,s.points)&&!(s.holes||[]).some(h=>inside(p,h))||[s.points,...(s.holes||[])].some(r=>distance(p,r)<.45))
      &&!paths.some(path=>lineDistance(p,path.points)<path.width/2+.55);
    const blockers=[...polygons,...surfaces.map(s=>s.points)],used=new Set(),beds=[],shrubs=[];
    const overlap=(a,b)=>a[0]-.65<b[2]&&a[2]+.65>b[0]&&a[1]-.65<b[3]&&a[3]+.65>b[1];
    const contourFor=indices=>{
      const ring=hull(indices.flatMap(index=>{
        const t=source[index],r=Math.min(2.4,Math.max(1.55,t.radius*.58)),phase=hash(site.id+':'+index)%100/100*Math.PI*2;
        return Array.from({length:14},(_,j)=>{const a=j*Math.PI*2/14,rr=r*(1+Math.sin(a*3+phase)*.09);return [t.point[0]+Math.cos(a)*rr,t.point[1]+Math.sin(a)*rr];});
      }));
      const points=rounded(ring,.65),box=extent(points);
      if(box[2]-box[0]>17||box[3]-box[1]>17||beds.some(b=>overlap(box,b.rawBounds)))return null;
      for(let i=0;i<points.length;i++){
        const a=points[i],b=points[(i+1)%points.length],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.45));
        for(let j=0;j<=n;j++)if(!clear(a.map((v,k)=>v+(b[k]-v)*j/n)))return null;
      }
      // A compact obstacle may be fully enclosed without crossing the edge.
      if(blockers.some(ps=>ps.some(p=>inside(p,points))))return null;
      for(const path of paths)for(const p of path.points)if(inside(p,points))return null;
      return {points,rawBounds:box,bounds:[box[0]-.8,box[1]-.8,box[2]+.8,box[3]+.8],members:indices.slice()};
    };
    for(let index=0;index<source.length&&beds.length<12;index++){
      if(used.has(index)||source[index].shrub||!clear(source[index].point))continue;
      const neighbours=source.map((t,i)=>({i,d:Math.hypot(t.point[0]-source[index].point[0],t.point[1]-source[index].point[1])}))
        .filter(n=>n.i!==index&&!used.has(n.i)&&!source[n.i].shrub&&n.d<10.5).sort((a,b)=>a.d-b.d);
      let bed=null;
      for(const candidate of neighbours){bed=contourFor([index,candidate.i]);if(bed)break;}
      if(!bed)continue;
      if(beds.length%3!==1)for(const candidate of neighbours){
        if(bed.members.includes(candidate.i))continue;
        const expanded=contourFor([...bed.members,candidate.i]);if(expanded){bed=expanded;break;}
      }
      const bedIndex=beds.length;beds.push(bed);for(const i of bed.members)used.add(i);
      // A handful of low plants around the roots gives a second canopy layer;
      // the centre remains grass instead of filling every gap with shrubs.
      for(const member of bed.members){
        const t=source[member],phase=rng()*Math.PI*2;
        for(let j=0;j<2;j++){
          const a=phase+j*2.3,r=1.05+rng()*.7,p=[t.point[0]+Math.cos(a)*r,t.point[1]+Math.sin(a)*r],radius=.62+rng()*.25;
          if(!inside(p,bed.points)||distance(p,bed.points)<radius*.9||!clear(p)||source.some(tree=>Math.hypot(tree.point[0]-p[0],tree.point[1]-p[1])<.9))continue;
          shrubs.push({point:p,radius,height:.55+rng()*.3,variant:(bedIndex+j)%4,shrub:true,bed:bedIndex});
        }
      }
    }
    if(!beds.length)return remember(null);
    const trees=source.map((t,i)=>used.has(i)?{...t,street:false,courtyard:beds.findIndex(b=>b.members.includes(i))}:t);
    return remember({beds,trees,shrubs});
  }
  function plan(site){
    if(cache.has(site))return cache.get(site);
    const empty=()=>{cache.set(site,null);return null;};
    if(!['park','plaza'].includes(site.kind)||!site.points)return empty();
    const points=site.points,xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys),w=x1-x0,h=y1-y0;
    if(Math.min(w,h)<7)return empty();
    const rng=random(site.id+':landscape'),beds=[],trees=[],shrubs=[],stones=[],benches=[];
    const add=ps=>{
      const contour=rounded(ps,Math.min(7,Math.min(w,h)*.28));
      // Sample entire edges as well as corners; concave sites must never get
      // a decorative bed across a road, notch, or neighbouring building.
      const safe=contour.every((p,i)=>{
        const q=contour[(i+1)%contour.length],steps=Math.max(1,Math.ceil(Math.hypot(q[0]-p[0],q[1]-p[1])/.75));
        for(let j=0;j<=steps;j++)if(!inside(p.map((v,k)=>v+(q[k]-v)*j/steps),points))return false;
        return true;
      });
      if(safe)beds.push(contour);return safe;
    };
    if(site.kind==='plaza'){
      const bw=Math.min(18,w*.32),bh=Math.min(16,h*.32);
      for(const sx of [-1,1])for(const sy of [-1,1]){
        const ox=sx<0?x0+1.8:x1-1.8,oy=sy<0?y0+1.8:y1-1.8;
        // The chamfer faces the fountain, leaving a generous diagonal walk.
        add([[0,0],[bw,0],[bw,bh*.48],[bw*.48,bh],[0,bh]].map(([x,y])=>[ox-sx*x,oy-sy*y]));
      }
    }else{
      const vertical=h>w,long=vertical?h:w,count=Math.max(1,Math.min(4,Math.floor(long/23))),step=(long-3)/count;
      for(let i=0;i<count;i++){
        const a=(vertical?y0:x0)+1.5+i*step,b=a+step-2.4;
        const lo=(vertical?x0:y0)+1.5,hi=(vertical?x1:y1)-1.5;
        const shape=(left,right)=>[[left,a],[right,a+.8],[right,b-1.2],[left+(right-left)*.65,b],[left,b-.7]].map(p=>vertical?p:[p[1],p[0]]);
        if(!add(shape(lo,hi))&&hi-lo>15){
          const pieces=Math.ceil((hi-lo)/15),width=(hi-lo)/pieces;
          for(let j=0;j<pieces;j++)add(shape(lo+j*width+.6,lo+(j+1)*width-.6));
        }
      }
    }
    // Irregular sites keep their existing appearance when a safe plan cannot fit.
    if(!beds.length)return empty();
    for(let index=0;index<beds.length;index++){
      const bed=beds[index],bx=bed.map(p=>p[0]),by=bed.map(p=>p[1]),lo=[Math.min(...bx),Math.min(...by)],hi=[Math.max(...bx),Math.max(...by)];
      const area=(hi[0]-lo[0])*(hi[1]-lo[1]),target=Math.max(3,Math.min(16,Math.floor(area/47)));
      const anchors=[[.29,.27],[.51,.48],[.34,.75],[.73,.53],[.71,.22],[.69,.79],[.23,.51]],short=Math.min(hi[0]-lo[0],hi[1]-lo[1]);
      for(let i=0;i<target*35&&trees.length<80;i++){
        if(trees.filter(t=>t.bed===index).length>=target)break;
        const number=trees.filter(t=>t.bed===index).length,anchor=anchors[number%anchors.length];
        // A specimen tree, two smaller companions, then another small group.
        // Overlapping crowns and the open middle read as planted composition,
        // instead of a grid of equal discs scattered over every metre of lawn.
        const p=lo.map((v,k)=>v+Math.max(.08,Math.min(.92,anchor[k]+(rng()-.5)*(i<target*8?.23:.65)))*(hi[k]-v));
        const radius=Math.min(short*.34,number%3===0?3.35+rng()*.8:2.45+rng()*.85);
        if(!inside(p,bed)||distance(p,bed)<radius*.8||trees.some(t=>Math.hypot(t.point[0]-p[0],t.point[1]-p[1])<(radius+t.radius)*.58))continue;
        const variant=[0,1,2,3,6,7][(number+index*2)%6]+Math.floor(rng()*4)*C.treeSpecies.length,type=C.tree(variant);
        trees.push({point:p,radius,height:radius*1.45+1.1+rng()*.9,variant,species:type.id,bed:index});
      }
      // Deliberate broad shrub drifts leave parts of the edging bare. Their
      // overlapping 2–3 metre masses are legible at street scale, unlike a
      // continuous chain of tiny round plants tracing the entire perimeter.
      const dominant=index%4,segments=[];let perimeter=0;
      for(let i=0;i<bed.length;i++){
        const a=bed[i],b=bed[(i+1)%bed.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
        segments.push({a,b,length,start:perimeter});perimeter+=length;
      }
      const driftCount=Math.max(3,Math.min(6,Math.ceil(area/110))),phase=.08+rng()*.1;
      for(let drift=0;drift<driftCount;drift++){
        const at=((phase+drift/driftCount)%1)*perimeter,segment=segments.find(s=>at<=s.start+s.length)||segments.at(-1),t=(at-segment.start)/(segment.length||1);
        const edge=segment.a.map((v,k)=>v+(segment.b[k]-v)*t),center=lo.map((v,k)=>(v+hi[k])/2),toward=Math.hypot(center[0]-edge[0],center[1]-edge[1])||1;
        const inward=center.map((v,k)=>(v-edge[k])/toward),tangent=[-inward[1],inward[0]],count=5+drift%3;
        for(let j=0;j<count;j++){
          const along=(j-(count-1)/2)*1.35,depth=1.7+Math.sin(j*.9+drift)*.5+(j%3===1?1.4:0),p=edge.map((v,k)=>v+inward[k]*depth+tangent[k]*along),radius=1.15+rng()*.43;
          if(!inside(p,bed)||distance(p,bed)<radius*.65||shrubs.some(s=>Math.hypot(p[0]-s.point[0],p[1]-s.point[1])<.75))continue;
          const flower=drift===1&&j===Math.floor(count/2)&&index%3===0;
          shrubs.push({point:p,radius,height:.8+rng()*.55,variant:flower?4+index%4:(dominant+drift%2)%4,flower,shrub:true});
        }
      }
      for(let i=0;i<3;i++){
        const p=lo.map((v,k)=>v+rng()*(hi[k]-v));
        if(inside(p,bed)&&distance(p,bed)>.8&&!trees.some(t=>Math.hypot(t.point[0]-p[0],t.point[1]-p[1])<1.3))stones.push({point:p,radius:.35+rng()*.35,turn:rng()*Math.PI});
      }
      const at=[(lo[0]+hi[0])/2,hi[1]+.9];
      if([[-1.5,-.45],[1.5,-.45],[1.5,.45],[-1.5,.45]].every(([x,y])=>inside([at[0]+x,at[1]+y],points))&&!beds.some(b=>inside(at,b)))benches.push(at);
    }
    const result={beds,trees,shrubs,stones,benches};cache.set(site,result);return result;
  }
  const api={plan,courtyard,rounded,inside,distance};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CityLandscape=api;
})(typeof window==='undefined'?{}:window);
