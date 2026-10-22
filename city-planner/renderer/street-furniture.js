/* Display-only street furniture: metre-anchored placement, local queries and
 * bounded visible-section details. This module never changes city geometry. */
(function(root){
  'use strict';
  const cellSize=64,sectionLength=64,sectionLimit=512,spacing=24;
  const definitions=[
    {kind:'bench',width:1.8,depth:.65,height:.85},
    {kind:'bin',width:.6,depth:.6,height:.95},
    {kind:'bins',width:1.1,depth:.65,height:1.05},
    {kind:'bench',width:1.8,depth:.65,height:.85}
  ];
  const motorKinds=new Set(['lane','street','avenue','highway','motorway']);
  const cells=new Map();let atlas=null,active=null,indexBuilds=0,painted=0;
  if(typeof Image!=='undefined'){
    const image=new Image();image.onload=()=>{atlas=image;cells.clear();root.MapWorkspace?.draw();};image.src='assets/street-furniture.png';
  }
  function seed(value){let n=2166136261;for(const c of String(value)){n^=c.charCodeAt(0);n=Math.imul(n,16777619);}return n>>>0;}
  function random(value){let n=seed(value);return ()=>{n+=0x6d2b79f5;let t=Math.imul(n^n>>>15,1|n);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296;};}
  function bounds(points,pad=0){
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(const p of points||[]){const x=p[0],y=p[1];x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
    return [x0-pad,y0-pad,x1+pad,y1+pad];
  }
  function intersects(a,b){return a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];}
  function spatialIndex(entries){
    const buckets=new Map(),large=[];let queries=0,visits=0;
    for(const entry of entries){
      const b=entry.bounds;if(!b.every(Number.isFinite))continue;
      const x0=Math.floor(b[0]/cellSize),y0=Math.floor(b[1]/cellSize),x1=Math.floor(b[2]/cellSize),y1=Math.floor(b[3]/cellSize);
      if((x1-x0+1)*(y1-y0+1)>256){large.push(entry);continue;}
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        const key=x+':'+y;let list=buckets.get(key);if(!list){list=[];buckets.set(key,list);}list.push(entry);
      }
    }
    return {
      query(box){
        const stamp=++queries,result=[];
        const visit=entry=>{if(entry.seen===stamp)return;entry.seen=stamp;if(intersects(entry.bounds,box)){visits++;result.push(entry);}};
        for(const entry of large)visit(entry);
        for(let y=Math.floor(box[1]/cellSize);y<=Math.floor(box[3]/cellSize);y++)for(let x=Math.floor(box[0]/cellSize);x<=Math.floor(box[2]/cellSize);x++)for(const entry of buckets.get(x+':'+y)||[])visit(entry);
        return result;
      },
      get stats(){return {entries:entries.length,cells:buckets.size,large:large.length,queries,visits};}
    };
  }
  function inside([x,y],points){let hit=false;for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;
  }return hit;}
  function projection(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy,t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(length||1)));return {t,distance:Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dy*t)};}
  function distance(p,points,closed=false){let best=Infinity;for(let i=1;i<points.length;i++)best=Math.min(best,projection(p,points[i-1],points[i]).distance);if(closed&&points.length>2)best=Math.min(best,projection(p,points.at(-1),points[0]).distance);return best;}
  function footprint(item){const {width,depth}=definitions[item.cell],c=Math.cos(item.heading),s=Math.sin(item.heading);return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>{
    const x=a*width/2,y=b*depth/2;return [item.point[0]+x*c-y*s,item.point[1]+x*s+y*c];
  });}
  function sample(road,d){
    const segments=road.segments;let lo=0,hi=segments.length-1;
    while(lo<hi){const mid=(lo+hi)>>1;if(segments[mid].end<d)lo=mid+1;else hi=mid;}
    const seg=segments[lo],t=Math.max(0,Math.min(1,(d-seg.start)/seg.length));
    return {point:[seg.a[0]+(seg.b[0]-seg.a[0])*t,seg.a[1]+(seg.b[1]-seg.a[1])*t],tangent:seg.tangent};
  }
  function clippedSegment(a,b,box){
    const dx=b[0]-a[0],dy=b[1]-a[1];let lo=0,hi=1;
    for(const [p,q] of [[-dx,a[0]-box[0]],[dx,box[2]-a[0]],[-dy,a[1]-box[1]],[dy,box[3]-a[1]]]){
      if(Math.abs(p)<1e-12){if(q<0)return null;continue;}
      const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return null;
    }return [lo,hi];
  }
  function createPlanner(state,{limit=sectionLimit}={}){
    const types=state.meta?.roadTypes||state.roadTypes||{},roadMap=new Map(),segments=[],obstacles=[],cache=new Map();
    let builds=0,hits=0,exactChecks=0,lastBox=null,lastItems=null;
    const polygon=points=>{if(points?.length>2)obstacles.push({kind:'polygon',points,bounds:bounds(points)});};
    const path=(points,width=3)=>{if(points?.length>1)obstacles.push({kind:'path',points,pad:width/2,bounds:bounds(points,width/2)});};
    const circle=(point,radius)=>{if(point)obstacles.push({kind:'circle',point,radius,bounds:[point[0]-radius,point[1]-radius,point[0]+radius,point[1]+radius]});};
    for(const source of state.roads||[]){
      if(source.level!==0||!motorKinds.has(source.kind)||!source.points||source.points.length<2)continue;
      const cfg=types[source.kind]||{},road={id:source.id,kind:source.kind,source:source.points,width:cfg.width||14,walk:source.kind==='avenue'?4.5:3,
        eligible:['street','avenue'].includes(source.kind)&&cfg.walk!==false,segments:[],length:0,cuts:[]};
      const points=source.points.map(p=>[p[0],p[1]]);
      for(let i=1;i<points.length;i++){
        const a=points[i-1],b=points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<1e-6)continue;
        const seg={road,a,b,length,start:road.length,end:road.length+length,tangent:[(b[0]-a[0])/length,(b[1]-a[1])/length],bounds:bounds([a,b],road.width/2+road.walk+2)};
        road.length+=length;road.segments.push(seg);segments.push(seg);
      }
      if(road.segments.length)roadMap.set(road.id,road);
    }
    for(const j of state.network?.junctions||[]){
      const arms=j.approaches||[],clear=Math.max(0,...arms.map(a=>a.width||roadMap.get(a.road)?.width||0))/2+14;
      for(const arm of arms){const road=roadMap.get(arm.road);if(road&&Number.isFinite(arm.distance))road.cuts.push([arm.distance-clear,arm.distance+clear]);}
      circle(j.point,clear);
    }
    // Mixed-height graph contacts own the ramp mouth. Overpasses without a
    // shared graph node never erase ordinary ground-level furniture.
    const sources=new Map((state.roads||[]).map(r=>[r.id,r])),contacts=new Map();
    for(const e of state.network?.edges||[]){const road=sources.get(e.road);if(!road||!motorKinds.has(road.kind))continue;
      for(const node of [e.a,e.b]){let c=contacts.get(node);if(!c){c={mask:0,width:0};contacts.set(node,c);}c.mask|=road.level===0?1:2;c.width=Math.max(c.width,types[road.kind]?.width||14);}
    }
    for(const [node,c] of contacts)if(c.mask===3)circle(state.network.nodes?.[node],c.width/2+14);
    for(const road of roadMap.values()){
      road.cuts.sort((a,b)=>a[0]-b[0]);const merged=[];
      for(const cut of road.cuts){const last=merged.at(-1);if(last&&cut[0]<=last[1])last[1]=Math.max(last[1],cut[1]);else merged.push(cut.slice());}road.cuts=merged;
    }
    for(const p of state.parcels||[]){
      polygon(p.building?.footprint);path(p.accessPath,p.accessWidth||3);
      const entrance=p.entrance||p.building?.entrance||p.building?.center||p.center;
      if(p.building&&p.frontage&&entrance)path([p.frontage,entrance],3);
    }
    for(const f of state.facilities||[]){if(!['park','plaza'].includes(f.kind))polygon(f.points);if(f.connected!==false)path(f.accessPath,f.accessWidth||5);}
    for(const court of state.streetside?.sites||[]){path(court.accessPath,court.accessWidth||3);for(const tree of court.trees||[])circle(tree.point,1);}
    const roadIndex=spatialIndex(segments),obstacleIndex=spatialIndex(obstacles);
    function nearCut(road,d){let lo=0,hi=road.cuts.length;while(lo<hi){const mid=(lo+hi)>>1;if(road.cuts[mid][1]<d)lo=mid+1;else hi=mid;}return lo<road.cuts.length&&road.cuts[lo][0]<=d;}
    function blocked(item){
      const def=definitions[item.cell],radius=Math.hypot(def.width,def.depth)/2+.3,p=item.point,box=[p[0]-radius-.65,p[1]-radius-.65,p[0]+radius+.65,p[1]+radius+.65];
      for(const o of obstacleIndex.query(box)){
        exactChecks++;
        if(o.kind==='circle'?Math.hypot(p[0]-o.point[0],p[1]-o.point[1])<o.radius+radius:
          o.kind==='path'?distance(p,o.points)<o.pad+radius+.5:inside(p,o.points)||distance(p,o.points,true)<radius+.4)return true;
      }
      const corners=footprint(item);
      for(const seg of roadIndex.query(box)){
        exactChecks++;
        if(corners.some(p=>projection(p,seg.a,seg.b).distance<seg.road.width/2+.56))return true;
        if(!seg.road.eligible)continue;
        // Reserve established metre-based street-tree root positions, even if
        // an obstacle later suppresses a tree. This conservative check never
        // constructs thousands of off-screen tree sprites or layouts.
        const d=seg.start+projection(p,seg.a,seg.b).t*seg.length,k=Math.round((d-25)/12);
        for(let n=k-1;n<=k+1;n++){
          const td=25+n*12;if(td<25||td>=seg.road.length-15)continue;
          const at=sample(seg.road,td),offset=seg.road.width/2+(seg.road.kind==='avenue'?3.3:2.35);
          for(const side of [-1,1])if(Math.hypot(p[0]-at.point[0]+at.tangent[1]*offset*side,p[1]-at.point[1]-at.tangent[0]*offset*side)<radius+1)return true;
        }
      }
      return false;
    }
    function section(roadId,index){
      const key=roadId+':'+index;
      if(cache.has(key)){const items=cache.get(key);cache.delete(key);cache.set(key,items);hits++;return items;}
      const road=roadMap.get(roadId),items=[];builds++;
      if(road?.eligible){
        const start=index*sectionLength,end=Math.min(road.length,start+sectionLength);
        for(let slot=Math.max(0,Math.ceil((start-spacing/2)/spacing));slot*spacing+spacing/2<end;slot++)for(const side of [-1,1]){
          const rng=random(road.id+':furniture:'+slot+':'+side),density=.34+(seed(road.id+':density:'+Math.floor(slot/4)+':'+side)%1000)/1000*.43;
          if(rng()>density)continue;
          const d=slot*spacing+spacing/2+(rng()-.5)*14.4,choice=rng(),cell=choice<.42?(rng()<.5?0:3):rng()<.78?1:2;
          const append=(distance,cell,suffix)=>{
            if(distance<18||distance>road.length-18||nearCut(road,distance))return;
            const at=sample(road,distance),offset=side*(road.width/2+(road.kind==='avenue'?1.08:.98)),item={id:road.id+':'+slot+':'+side+suffix,road:road.id,distance,side,cell,
              point:[at.point[0]-at.tangent[1]*offset,at.point[1]+at.tangent[0]*offset],heading:Math.atan2(at.tangent[1],at.tangent[0])+(side===1?Math.PI:0)};
            if(!blocked(item))items.push(item);
          };
          append(d,cell,'');
          // Occasional bench/bin pairs form small useful groups; most cells
          // stay independent, and the jitter never permits adjacent overlaps.
          if(definitions[cell].kind==='bench'&&rng()<.28)append(d+3.1,1,':bin');
        }
      }
      cache.set(key,items);while(cache.size>limit)cache.delete(cache.keys().next().value);return items;
    }
    function visibleSections(view,inView=()=>true){
      const found=new Map(),near=view?roadIndex.query(view):segments.filter(seg=>seg.road.eligible&&inView([seg.a,seg.b]));
      for(const seg of near){
        const road=seg.road;if(!road.eligible)continue;
        const pad=road.width/2+road.walk+3,box=view?[view[0]-pad,view[1]-pad,view[2]+pad,view[3]+pad]:null,clip=box?clippedSegment(seg.a,seg.b,box):[0,1];if(!clip)continue;
        const first=Math.max(0,Math.floor((seg.start+clip[0]*seg.length-8)/sectionLength)),last=Math.min(Math.ceil(road.length/sectionLength)-1,Math.floor((seg.start+clip[1]*seg.length+8)/sectionLength));
        for(let index=first;index<=last;index++)found.set(road.id+':'+index,{road:road.id,index});
      }
      return [...found.values()].sort((a,b)=>String(a.road).localeCompare(String(b.road))||a.index-b.index);
    }
    return {
      section,visibleSections,
      items(view,inView){
        if(view&&lastBox&&view.every((n,i)=>n===lastBox[i]))return lastItems;
        const result=[];for(const item of visibleSections(view,inView))result.push(...section(item.road,item.index));
        lastBox=view?.slice()||null;lastItems=result;return result;
      },
      get stats(){return {sections:cache.size,limit,builds,hits,exactChecks,roads:roadMap.size,roadIndex:roadIndex.stats,obstacleIndex:obstacleIndex.stats};}
    };
  }
  function plannerFor(state){
    const refs=[state.network,state.roads,state.meta?.roadTypes||state.roadTypes,state.parcels,state.facilities,state.streetside];
    if(!active||refs.some((value,i)=>value!==active.refs[i])){active={refs,planner:createPlanner(state)};indexBuilds++;}return active.planner;
  }
  function viewport(ctx){
    const m=ctx.getTransform?.(),c=ctx.canvas;if(!m||!c)return null;
    const det=m.a*m.d-m.b*m.c;if(!Number.isFinite(det)||Math.abs(det)<1e-12)return null;
    return bounds([[0,0],[c.width,0],[c.width,c.height],[0,c.height]].map(([x,y])=>[(m.d*(x-m.e)-m.c*(y-m.f))/det,(-m.b*(x-m.e)+m.a*(y-m.f))/det]),3);
  }
  function isolatePair(pixels,width,height,isolate=root.SurfaceVariation?.isolateSprite){
    if(!isolate)return pixels;
    const primary=pixels.slice(),secondary=pixels.slice();isolate(primary,width,height);let firstArea=0,secondArea=0;
    for(let i=3;i<pixels.length;i+=4){if(primary[i]>=24)firstArea++;if(primary[i])secondary[i]=0;}
    isolate(secondary,width,height);for(let i=3;i<pixels.length;i+=4)if(secondary[i]>=24)secondArea++;
    // Two bins may be separate or connected by a narrow frame. A substantial
    // second component is retained wherever it lies; detached noise is not.
    const keepSecond=firstArea>0&&secondArea>=Math.max(4,firstArea*.15);
    for(let i=3;i<pixels.length;i+=4)pixels[i]=primary[i]||(keepSecond?secondary[i]:0);
    return pixels;
  }
  function texture(index){
    if(!atlas)return null;if(cells.has(index))return cells.get(index);
    const image=document.createElement('canvas');image.width=image.height=128;const g=image.getContext('2d'),size=atlas.width/2;
    g.drawImage(atlas,index%2*size+2,Math.floor(index/2)*size+2,size-4,size-4,0,0,128,128);
    const data=g.getImageData(0,0,128,128);
    if(index===2)isolatePair(data.data,128,128);
    else root.SurfaceVariation?.isolateSprite(data.data,128,128);
    g.putImageData(data,0,0);
    let x0=128,y0=128,x1=-1,y1=-1;
    for(let y=0;y<128;y++)for(let x=0;x<128;x++)if(data.data[(y*128+x)*4+3]>24){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
    const shadow=document.createElement('canvas');shadow.width=shadow.height=128;const s=shadow.getContext('2d');s.filter='blur(1.1px)';s.drawImage(image,0,0);s.globalCompositeOperation='source-in';s.fillStyle='#26332e';s.fillRect(0,0,128,128);
    const cell={image,shadow,crop:x1>=x0?[Math.max(0,x0-1),Math.max(0,y0-1),Math.min(128,x1+2)-Math.max(0,x0-1),Math.min(128,y1+2)-Math.max(0,y0-1)]:[0,0,128,128]};cells.set(index,cell);return cell;
  }
  function shadowPlacement(item,light,worldOffset){
    const def=definitions[item.cell],angle=((light?.azimuth??45)+180)*Math.PI/180,length=light?.elevation>0?Math.min(95,def.height/Math.tan(light.elevation*Math.PI/180)):0;
    const offset=worldOffset||[Math.cos(angle)*length,Math.sin(angle)*length];
    // Translation is computed before any furniture rotation, in world axes.
    return {point:[item.point[0]+offset[0]*.65,item.point[1]+offset[1]*.65],heading:item.heading};
  }
  function visualBounds(item,shadowOffset=[0,0]){
    const def=definitions[item.cell],c=Math.abs(Math.cos(item.heading)),s=Math.abs(Math.sin(item.heading));
    const rx=(c*def.width+s*def.depth)/2+.08,ry=(s*def.width+c*def.depth)/2+.08,[x,y]=item.point;
    // The cropped sprite and its cached soft contact shadow share this world
    // footprint. Include the solar copy without rotating the sun vector.
    return [x+Math.min(0,shadowOffset[0])-rx,y+Math.min(0,shadowOffset[1])-ry,x+Math.max(0,shadowOffset[0])+rx,y+Math.max(0,shadowOffset[1])+ry];
  }
  function shadowQueryBounds(view,offsets){
    const radius=Math.max(...definitions.map(def=>Math.hypot(def.width,def.depth)/2))+.08;
    let minX=0,minY=0,maxX=0,maxY=0;
    for(const [x,y] of offsets){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
    // Query the possible source positions of visible shadows, not only the
    // bodies inside this tile. The same local section LRU still owns layouts.
    return [view[0]-radius-maxX,view[1]-radius-maxY,view[2]+radius-minX,view[3]+radius-minY];
  }
  function paint(ctx,state,{scale=1,inView=()=>true,visible=()=>true}={}){
    painted=0;if(scale<1.1)return;
    const planner=plannerFor(state),view=viewport(ctx),scene=root.CityScene,light=scene?.lightingAt(scene.time)||{elevation:42,azimuth:45,strength:.28};
    const offsets=definitions.map((def,cell)=>light.elevation>0?shadowPlacement({cell,point:[0,0],heading:0},light,scene?.shadowOffset(def.height,light)).point:[0,0]);
    const items=planner.items(view?shadowQueryBounds(view,offsets):null,inView);
    for(const item of items){
      const offset=offsets[item.cell],solar=item.point.map((n,i)=>n+offset[i]);
      if(view?!intersects(visualBounds(item,offset),view):!visible(item.point)&&!visible(solar))continue;
      const def=definitions[item.cell],cell=texture(item.cell);painted++;
      const stamp=(image,point,alpha)=>{ctx.save();ctx.translate(...point);ctx.rotate(item.heading);ctx.globalAlpha=alpha;ctx.drawImage(image,...cell.crop,-def.width/2,-def.depth/2,def.width,def.depth);ctx.restore();};
      if(cell){
        stamp(cell.shadow,item.point,.28);
        if(light.elevation>0)stamp(cell.shadow,solar,Math.min(.4,light.strength*1.1));
        stamp(cell.image,item.point,1);
      }else{
        ctx.save();ctx.translate(...item.point);ctx.rotate(item.heading);ctx.fillStyle='#293a3240';ctx.fillRect(-def.width/2-.05,-def.depth/2-.02,def.width+.1,def.depth+.1);
        ctx.fillStyle=def.kind==='bench'?'#927252':'#35564c';ctx.fillRect(-def.width/2,-def.depth/2,def.width,def.depth);
        ctx.fillStyle=def.kind==='bench'?'#c1a17b':'#6c8177';ctx.fillRect(-def.width/2,-def.depth/2,def.width,.08);ctx.restore();
      }
    }
  }
  const api={paint,createPlanner,footprint,shadowPlacement,visualBounds,shadowQueryBounds,isolatePair,definitions,get assetsReady(){return Boolean(atlas);},get stats(){return {indexBuilds,painted,spriteCells:cells.size,spriteLimit:4,...active?.planner.stats};}};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CityStreetFurniture=api;
})(typeof window==='undefined'?{}:window);
