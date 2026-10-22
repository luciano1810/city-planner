/* Road surfaces and furniture share the backend's connected junctions. */
(function(root){
  'use strict';
  const motorKinds=new Set(['lane','street','avenue','highway','motorway']);
  const laneCounts={lane:2,street:2,avenue:4,highway:4,motorway:6};
  const streetSection=Object.freeze({sidewalk:3,promenade:2.3,innerWalk:1.15,curb:.55,gutter:.11,surface:0});
  const avenueSection=Object.freeze({...streetSection,sidewalk:4.5,promenade:3.6,innerWalk:1.6});
  function roadCrossSection(kind){return kind==='avenue'?avenueSection:streetSection;}
  const surfaces={path:'#d9d1bb',lane:'#a9b2a6',street:'#98a49b',avenue:'#8b9b92',highway:'#98a291',motorway:'#8d9b8a'};
  const measurements=new WeakMap(),plans=new WeakMap();
  const offsets=new WeakMap(),projections=new WeakMap(),cornerPlans=new WeakMap(),joinCornerNetworks=new WeakMap();
  const signalSprites=new Map();
  const curbDetails=new Map(),cornerDetails=new Map(),curbDetailLimit=512,cornerDetailLimit=256;
  let detailSerial=0,curbDetailBuilds=0,cornerDetailBuilds=0,surfaceDetailBuilds=0;
  function bounds(points,pad=0){
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(const p of points){x0=Math.min(x0,p[0]);y0=Math.min(y0,p[1]);x1=Math.max(x1,p[0]);y1=Math.max(y1,p[1]);}
    return [x0-pad,y0-pad,x1+pad,y1+pad];
  }
  function intersects(a,b,pad=0){return a[0]-pad<=b[2]&&a[2]+pad>=b[0]&&a[1]-pad<=b[3]&&a[3]+pad>=b[1];}
  function viewport(ctx){
    const m=ctx.getTransform?.(),c=ctx.canvas;if(!m||!c||![m.a,m.b,m.c,m.d,m.e,m.f,c.width,c.height].every(Number.isFinite))return null;
    const det=m.a*m.d-m.b*m.c;if(Math.abs(det)<1e-12)return null;
    return bounds([[0,0],[c.width,0],[c.width,c.height],[0,c.height]].map(([x,y])=>[(m.d*(x-m.e)-m.c*(y-m.f))/det,(-m.b*(x-m.e)+m.a*(y-m.f))/det]));
  }
  function cachedDetail(cache,key,limit,build){
    if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return value;}
    const value=build();cache.set(key,value);while(cache.size>limit)cache.delete(cache.keys().next().value);return value;
  }
  function detailRandom(key){
    let state=2166136261;for(const char of String(key)){state^=char.charCodeAt(0);state=Math.imul(state,16777619);}
    return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  }

  function measure(points){
    if(measurements.has(points))return measurements.get(points);
    const distances=[0];
    for(let i=1;i<points.length;i++)distances.push(distances.at(-1)+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
    const result={distances,length:distances.at(-1)||0};measurements.set(points,result);return result;
  }
  function sample(points,distance){
    const {distances,length}=measure(points),d=Math.max(0,Math.min(length,distance));
    let lo=1,hi=points.length-1;
    while(lo<hi){const mid=(lo+hi)>>1;if(distances[mid]<d)lo=mid+1;else hi=mid;}
    let i=lo;
    while(i<points.length-1&&distances[i]-distances[i-1]<1e-9)i++;
    while(i>1&&distances[i]-distances[i-1]<1e-9)i--;
    const a=points[i-1],b=points[i],span=Math.max(1e-9,distances[i]-distances[i-1]),t=(d-distances[i-1])/span;
    return {point:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],tangent:[(b[0]-a[0])/span,(b[1]-a[1])/span]};
  }
  function slice(points,start,end){
    const {distances}=measure(points),result=[sample(points,start).point];
    for(let i=1;i<points.length-1;i++)if(distances[i]>start&&distances[i]<end)result.push(points[i]);
    result.push(sample(points,end).point);return result;
  }
  function offsetPath(points,offset){
    let cached=offsets.get(points);
    if(!cached){cached=new Map();offsets.set(points,cached);}
    if(cached.has(offset))return cached.get(offset);
    const result=points.map((p,i)=>{
      const before=points[Math.max(0,i-1)],after=points[Math.min(points.length-1,i+1)];
      const dx=after[0]-before[0],dy=after[1]-before[1],length=Math.hypot(dx,dy)||1;
      return [p[0]-dy/length*offset,p[1]+dx/length*offset];
    });
    cached.set(offset,result);return result;
  }
  // Shared graph nodes, including degree-two joins, own the visual opening.
  // Coordinate coincidence alone must never turn an overpass into a ramp.
  const connectionPlans=new WeakMap();
  function connections(roads,network,types){
    if(connectionPlans.has(network))return connectionPlans.get(network);
    const roadMap=new Map(roads.map(r=>[r.id,r])),incident=new Map();
    for(const e of network.edges||[])for(const [node,direction] of [[e.a,1],[e.b,-1]]){
      const road=roadMap.get(e.road);if(!road||!(motorKinds.has(road.kind)||road.kind==='path'))continue;
      if(!incident.has(node))incident.set(node,[]);
      const distance=direction===1?e.startDistance:e.endDistance;
      if(!Number.isFinite(distance))continue;
      const at=sample(road.points,distance);
      incident.get(node).push({road:road.id,kind:road.kind,level:road.level,width:types[road.kind].width,
        distance,direction,tangent:at.tangent.map(v=>v*direction),incoming:direction===-1||!road.oneway,outgoing:direction===1||!road.oneway});
    }
    const joins=[];
    for(const [id,arms] of incident){
      if(!arms.some(a=>a.level===0)||!arms.some(a=>a.level!==0))continue;
      const point=network.nodes[id],extent=Math.min(60,Math.max(...arms.map(a=>clearDistance(a,arms)))+12);
      joins.push({id,point,approaches:arms,extent,level:0});
    }
    const ramps=new Map();
    for(const j of joins)for(const a of j.approaches)if(a.level!==0){
      const r=roadMap.get(a.road),length=measure(r.points).length;
      if(a.distance>.1&&a.distance<length-.1)continue;
      if(!ramps.has(r.id))ramps.set(r.id,[]);
      ramps.get(r.id).push({distance:a.distance,flat:j.extent+2});
    }
    // Rail ramps follow confirmed graph contacts, never a visual crossing.
    const railNodes=new Map();
    for(const e of network.edges||[])if(['train','metro'].includes(e.kind))for(const node of [e.a,e.b]){
      if(!railNodes.has(node))railNodes.set(node,new Set());railNodes.get(node).add(e.road);
    }
    for(const r of roads)if(['train','metro'].includes(r.kind)&&r.level!==0){
      const length=measure(r.points).length;
      for(const e of network.edges||[])if(e.road===r.id)for(const [node,d] of [[e.a,e.startDistance],[e.b,e.endDistance]]){
        if(d>.1&&d<length-.1)continue;
        if([...railNodes.get(node)||[]].some(id=>roadMap.get(id)?.level===0)){
          if(!ramps.has(r.id))ramps.set(r.id,[]);
          ramps.get(r.id).push({distance:d,flat:0});
        }
      }
    }
    const result={joins,ramps,roadMap,surfaces:new Map()};connectionPlans.set(network,result);return result;
  }
  function nearestDistance(points,p){
    const {distances}=measure(points);let best=Infinity,distance=0;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],len=dx*dx+dy*dy;
      const t=len?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/len)):0;
      const error=(p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2;
      if(error<best){best=error;distance=distances[i-1]+Math.sqrt(len)*t;}
    }return distance;
  }
  function roadHeight(road,distance,layout){
    if(road.level===0)return 0;
    let height=6;
    for(const ramp of layout.ramps.get(road.id)||[]){
      const t=Math.max(0,Math.min(1,(Math.abs(distance-ramp.distance)-ramp.flat)/90));
      height=Math.min(height,6*t*t*(3-2*t));
    }return height*road.level;
  }
  function projectPoint(point,road,layout){
    const distance=nearestDistance(road.points,point);
    if(road.level===0){
      const profile=surfaceRoad(road,layout).surfaceProfile;if(!profile)return point;
      const end=profile.findIndex(s=>s.distance>=distance),b=profile[end<0?profile.length-1:end],a=profile[Math.max(0,end-1)];
      const t=b.distance>a.distance?(distance-a.distance)/(b.distance-a.distance):0;
      const center=a.point.map((v,k)=>v+(b.point[k]-v)*t),direction=a.tangent.map((v,k)=>v+(b.tangent[k]-v)*t),size=Math.hypot(...direction)||1;
      const original=sample(road.points,distance),offset=(point[0]-original.point[0])*-original.tangent[1]+(point[1]-original.point[1])*original.tangent[0];
      return [center[0]-direction[1]/size*offset,center[1]+direction[0]/size*offset];
    }
    return [point[0],point[1]-.28*roadHeight(road,distance,layout)];
  }
  function projectPath(points,road,layout){
    if(points===road.points)return surfaceRoad(road,layout).points;
    if(road.level===0&&!surfaceRoad(road,layout).surfaceProfile)return points;
    // Snapshots are replaced on edits/load; weak keys release obsolete geometry.
    let byRoad=projections.get(layout);
    if(!byRoad){byRoad=new WeakMap();projections.set(layout,byRoad);}
    let cached=byRoad.get(road);
    if(!cached){cached=new WeakMap();byRoad.set(road,cached);}
    if(cached.has(points))return cached.get(points);
    const length=measure(points).length,distances=new Set(measure(points).distances);
    for(let d=0;d<length;d+=3)distances.add(d);
    const result=[...distances].sort((a,b)=>a-b).map(d=>projectPoint(sample(points,d).point,road,layout));
    cached.set(points,result);return result;
  }
  function landingProfile(road,layout){
    const length=measure(road.points).length,transitions=[];
    if(road.level!==0||!motorKinds.has(road.kind)||length<1)return null;
    for(const j of layout.joins){
      if(j.approaches.length!==2)continue;
      const arm=j.approaches.find(a=>a.road===road.id),other=j.approaches.find(a=>a.road!==road.id);
      if(!arm||other?.level!==1||arm.distance>.1&&arm.distance<length-.1)continue;
      if(arm.tangent[0]*other.tangent[0]+arm.tangent[1]*other.tangent[1]>-.5)continue;
      const span=Math.min(8,length*.2),direction=arm.direction;
      const start=sample(road.points,arm.distance).point,end=sample(road.points,arm.distance+direction*span);
      const tangent=other.tangent.map(v=>-v),finish=end.tangent.map(v=>v*direction);
      transitions.push({distance:arm.distance,direction,span,start,end:end.point,tangent,finish});
    }
    if(!transitions.length)return null;
    const distances=new Set(measure(road.points).distances);
    for(const t of transitions)for(let i=0;i<=32;i++)distances.add(t.distance+t.direction*t.span*i/32);
    return [...distances].sort((a,b)=>a-b).map(distance=>{
      const original=sample(road.points,distance),t=transitions.find(t=>Math.abs(distance-t.distance)<=t.span+1e-7);
      if(!t)return {...original,distance,mix:1};
      const u=Math.min(1,Math.abs(distance-t.distance)/t.span),s=1-u,mix=u*u*(3-2*u);
      const c1=t.start.map((v,k)=>v+t.tangent[k]*t.span/3),c2=t.end.map((v,k)=>v-t.finish[k]*t.span/3);
      const point=t.start.map((v,k)=>s*s*s*v+3*s*s*u*c1[k]+3*s*u*u*c2[k]+u*u*u*t.end[k]);
      const derivative=t.start.map((v,k)=>3*s*s*(c1[k]-v)+6*s*u*(c2[k]-c1[k])+3*u*u*(t.end[k]-c2[k]));
      const size=Math.hypot(...derivative)||1;
      return {point,tangent:derivative.map(v=>v/size*t.direction),distance,mix:1,landingMix:mix};
    });
  }
  function surfaceRoad(road,layout){
    if(layout.surfaces.has(road.id))return layout.surfaces.get(road.id);
    if(road.level===0){
      const length=measure(road.points).length;
      const contacts=layout.joins.flatMap(j=>j.approaches.filter(a=>a.road===road.id));
      const openStart=contacts.some(a=>a.distance<.1),openEnd=contacts.some(a=>a.distance>length-.1);
      // The ground half of a ramp is connected too: its sidewalk must end
      // flush at the landing instead of retaining a rounded cul-de-sac cap.
      const profile=landingProfile(road,layout);
      const result=openStart||openEnd?{...road,openStart,openEnd,...(profile?{surfaceProfile:profile,points:profile.map(s=>s.point)}:{})}:road;
      layout.surfaces.set(road.id,result);return result;
    }
    const length=measure(road.points).length,distances=new Set(measure(road.points).distances);
    for(let d=0;d<length;d+=3)distances.add(d);
    const ramps=layout.ramps.get(road.id)||[],mouthClips=[];
    for(const j of layout.joins){
      const arm=j.approaches.find(a=>a.road===road.id);if(!arm)continue;
      const ground=j.approaches.find(a=>a.level===0&&j.approaches.some(b=>b!==a&&b.road===a.road&&b.direction!==a.direction));
      if(!ground)continue;
      const tangent=ground.tangent,n=[-tangent[1],tangent[0]];
      if(n[0]*arm.tangent[0]+n[1]*arm.tangent[1]<0){n[0]*=-1;n[1]*=-1;}
      const at=(along,across)=>j.point.map((v,i)=>v+tangent[i]*along+n[i]*across);
      mouthClips.push([at(-j.extent,-ground.width/2),at(j.extent,-ground.width/2),at(j.extent,-j.extent),at(-j.extent,-j.extent)]);
    }
    // Expand walking bands on the flat bridge approach, before the ground
    // endpoint. A short receiving street must keep its junction's full width.
    const landings=layout.joins.filter(j=>j.approaches.length===2).flatMap(j=>{
      const arm=j.approaches.find(a=>a.road===road.id),ground=j.approaches.find(a=>a.level===0);
      if(!arm||!ground||arm.tangent[0]*ground.tangent[0]+arm.tangent[1]*ground.tangent[1]>-.5)return [];
      if(arm.distance>.1&&arm.distance<length-.1)return [];
      return [{distance:arm.distance,ownWidth:arm.width,width:ground.width,section:roadCrossSection(ground.kind),span:Math.min(16,length*.4)}];
    });
    for(const landing of landings)for(let i=0;i<=32;i++)distances.add(landing.distance+(landing.distance<.1?1:-1)*landing.span*i/32);
    const ordered=[...distances].sort((a,b)=>a-b),samples=ordered.map(d=>({point:sample(road.points,d).point,height:roadHeight(road,d,layout)}));
    const profile=road.level===1&&landings.length?samples.map((s,i)=>{
      const d=ordered[i],landing=landings.reduce((a,b)=>Math.abs(d-a.distance)<Math.abs(d-b.distance)?a:b);
      const t=Math.max(0,1-Math.abs(d-landing.distance)/landing.span),mix=t*t*(3-2*t),section=roadCrossSection(road.kind);
      const own=landing.ownWidth;
      return {point:[s.point[0],s.point[1]-.28*s.height],tangent:sample(road.points,d).tangent,distance:d,mix,
        halfWidth:(own+(landing.width-own)*mix)/2,bands:Object.fromEntries(['sidewalk','promenade','innerWalk','curb','gutter','surface'].map(band=>[band,
          (['sidewalk','promenade','innerWalk','curb'].includes(band)?section.curb:0)*(1-mix)+landing.section[band]*mix]))};
    }):null;
    const result={...road,points:samples.map(s=>[s.point[0],s.point[1]-.28*s.height]),elevationSamples:samples,...(profile?{surfaceProfile:profile,landingWalk:true}:{}),
      openStart:ramps.some(r=>r.distance<.1),openEnd:ramps.some(r=>r.distance>length-.1),mouthClips};
    layout.surfaces.set(road.id,result);return result;
  }
  function upperVehicle(vehicle,layout){
    return vehicle.level===1||layout.joins.some(j=>(!vehicle.road||j.approaches.some(a=>a.road===vehicle.road))&&Math.hypot(vehicle.point[0]-j.point[0],vehicle.point[1]-j.point[1])<j.extent+8);
  }
  function vehicleHeight(vehicle,layout){
    if(vehicle.level===0)return 0;
    // Traffic road IDs are absent on older saves; choose the closest bridge.
    let road=layout.roadMap.get(vehicle.road),best=Infinity;
    if(!road||road.level!==vehicle.level)for(const r of layout.roadMap.values())if(r.level===vehicle.level){
      const d=nearestDistance(r.points,vehicle.point),p=sample(r.points,d).point,error=Math.hypot(p[0]-vehicle.point[0],p[1]-vehicle.point[1]);
      if(error<best){best=error;road=r;}
    }
    return road?roadHeight(road,nearestDistance(road.points,vehicle.point),layout):6*vehicle.level;
  }
  function clipJoin(ctx,j){ctx.beginPath();ctx.arc(...j.point,j.extent,0,Math.PI*2);ctx.clip();}
  function landingSeam(join,band='surface'){
    if(join.approaches.length!==2)return [];
    // The two butt caps can have different normals. Fill their convex envelope
    // so an angled landing cannot expose a triangular strip of terrain.
    return join.approaches.flatMap(a=>[-1,1].map(sign=>{
      const width=a.width/2+roadCrossSection(a.kind)[band];
      return [join.point[0]-a.tangent[1]*width*sign,join.point[1]+a.tangent[0]*width*sign];
    })).sort((a,b)=>Math.atan2(a[1]-join.point[1],a[0]-join.point[0])-Math.atan2(b[1]-join.point[1],b[0]-join.point[0]));
  }
  function paintLandingSeam(ctx,j,band){
    const points=landingSeam(j,band);if(!points.length)return;
    ctx.beginPath();ctx.moveTo(...points[0]);for(const p of points.slice(1))ctx.lineTo(...p);ctx.closePath();
    ctx.fillStyle=root.CityScene.material?.(ctx,band==='surface'?'asphalt':'curb',0)||(band==='surface'?'#616b70':'#dadccf');ctx.fill();
  }
  function paintConnections(ctx,state,scale,layout,joins){
    for(const j of joins){
      ctx.save();clipJoin(ctx,j);
      const region=[j.point[0]-j.extent,j.point[1]-j.extent,j.point[0]+j.extent,j.point[1]+j.extent];
      if(!joinCornerNetworks.has(j)){
        const ids=new Set(j.approaches.map(a=>a.road));
        // A short receiving road may reach another junction inside this clip.
        // Recompose every ground surface there, otherwise its terminal cap and
        // curb are painted back across the neighbouring road's open pavement.
        const local=state.roads.filter(r=>ids.has(r.id)||r.level===0&&intersects(bounds(r.points,state.roadTypes[r.kind].width/2+5),region))
          .map(r=>surfaceRoad(r,layout));
        joinCornerNetworks.set(j,{roads:local,junctions:[
          ...(state.network.junctions||[]).filter(other=>other.id!==j.id&&intersects(bounds([other.point],80),region)),
          {...j,approaches:j.approaches.map(a=>({...a,level:0}))}
        ]});
      }
      const scene=joinCornerNetworks.get(j);
      // One outline pass and one pavement pass across both levels removes
      // terminal caps and cuts openings through the receiving road's curb.
      const smooth=scene.roads.some(r=>r.level===0&&r.surfaceProfile?.some(s=>s.landingMix===0&&Math.hypot(s.point[0]-j.point[0],s.point[1]-j.point[1])<.1));
      if(!smooth)paintLandingSeam(ctx,j,'curb');
      root.CityScene.roadSurfaces(ctx,scene.roads,state.roadTypes,scale,0,{shadows:false});
      if(!smooth)paintLandingSeam(ctx,j,'surface');
      paintCorners(ctx,scene,{scale,roads:state.roads,inView:points=>intersects(bounds(points),region)});
      ctx.restore();
    }
  }
  function turnsFor(approach,approaches){
    const incoming=approach.tangent.map(v=>-v),turns=new Set();
    for(const other of approaches){
      if(other===approach||!other.outgoing||!motorKinds.has(other.kind))continue;
      const dot=incoming[0]*other.tangent[0]+incoming[1]*other.tangent[1];
      const cross=incoming[0]*other.tangent[1]-incoming[1]*other.tangent[0];
      if(dot>.82)turns.add('straight');
      else if(dot>-.82)turns.add(cross>0?'right':'left');
    }
    return ['left','straight','right'].filter(turn=>turns.has(turn));
  }
  function clearDistance(arm,approaches){
    if(Number.isFinite(arm.crossingDistance))return arm.crossingDistance-3;
    let distance=arm.width/2+2;
    for(const other of approaches){
      if(other===arm)continue;
      const cross=Math.abs(arm.tangent[0]*other.tangent[1]-arm.tangent[1]*other.tangent[0]);
      // Tangents point out of the junction. Preserve their signed angle:
      // opposite arms continue the road and must not become an acute fork
      // with a clearance extending hundreds of metres down both approaches.
      const dot=arm.tangent[0]*other.tangent[0]+arm.tangent[1]*other.tangent[1];
      if(cross>.05)distance=Math.max(distance,(other.width/2+arm.width/2*dot)/cross+2);
    }
    return distance;
  }
  function insidePolygon(point,points){
    let inside=false;
    for(let i=0,j=points.length-1;i<points.length;j=i++){
      const a=points[i],b=points[j];
      if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    }
    return inside;
  }
  // Three nearby junctions can enclose a sliver narrower than a sidewalk.
  // Only absorb short, straight, connected ground-road loops; larger blocks,
  // curved streets and grade-separated crossings retain their own surfaces.
  function junctionPockets(roads,network,roadTypes){
    const byRoad=new Map(),links=new Map(),roadMap=new Map(roads.map(r=>[r.id,r]));
    for(const j of network.junctions||[])for(const arm of j.approaches){
      if(arm.level!==0||!motorKinds.has(arm.kind))continue;
      if(!byRoad.has(arm.road))byRoad.set(arm.road,new Map());
      byRoad.get(arm.road).set(j.id,{j,distance:arm.distance});
    }
    for(const [id,nodes] of byRoad){
      const road=roadMap.get(id);if(!road)continue;
      const ordered=[...nodes.values()].sort((a,b)=>a.distance-b.distance);
      for(let i=1;i<ordered.length;i++){
        const a=ordered[i-1],b=ordered[i],length=b.distance-a.distance;
        if(length<1||length>80)continue;
        const chord=[a.j.point,b.j.point],points=slice(road.points,a.distance,b.distance);
        if(points.some(p=>{const q=sample(chord,nearestDistance(chord,p)).point;return Math.hypot(p[0]-q[0],p[1]-q[1])>.5;}))continue;
        for(const [from,to] of [[a,b],[b,a]]){
          if(!links.has(from.j.id))links.set(from.j.id,new Map());
          links.get(from.j.id).set(to.j.id,{node:to.j,width:roadTypes[road.kind].width});
        }
      }
    }
    const pockets=[];
    for(const [id,neighbors] of links)for(const [bid,ab] of neighbors){
      if(bid<=id)continue;
      for(const [cid,bc] of links.get(bid)||[]){
        const ac=neighbors.get(cid);if(cid<=bid||!ac)continue;
        const points=[links.get(bid).get(id).node.point,ab.node.point,bc.node.point];
        const lengths=points.map((p,i)=>Math.hypot(p[0]-points[(i+1)%3][0],p[1]-points[(i+1)%3][1]));
        const [a,b,c]=points,area2=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]));
        const radius=(area2-lengths[0]*ab.width/2-lengths[1]*bc.width/2-lengths[2]*ac.width/2)/lengths.reduce((a,b)=>a+b);
        if(radius<=3)pockets.push({points,bounds:bounds(points),radius});
      }
    }
    return pockets;
  }
  function buildPlan(roads,network,roadTypes){
    if(plans.has(network))return plans.get(network);
    const roadMap=new Map(roads.map(r=>[r.id,r])),arrows=[],crosswalks=[],stopLines=[],signals=[],pedestrianSignals=[],laneBays=[],bayGaps=new Map();
    const gaps=new Map(roads.map(r=>[r.id,[]]));
    const junctions=network.junctions||[];
    const pockets=junctionPockets(roads,network,roadTypes);
    const groundRoads=roads.filter(r=>r.level===0&&motorKinds.has(r.kind)).map(r=>({road:r,bounds:bounds(r.points,roadTypes[r.kind].width/2+1)}));
    const cornerSurfaces=junctionCorners(network,roads).map(c=>({points:[c.junction,c.from,...cornerBoundary(c,'surface'),c.to],bounds:bounds([c.junction,c.from,c.to])}));
    const supportBlocked=(point,level)=>level===0&&(pockets.some(p=>insidePolygon(point,p.points))||cornerSurfaces.some(c=>intersects(c.bounds,bounds([point]))&&insidePolygon(point,c.points))||groundRoads.some(({road,bounds:box})=>{
      if(!intersects(box,bounds([point])))return false;
      const at=sample(road.points,nearestDistance(road.points,point));
      return Math.hypot(point[0]-at.point[0],point[1]-at.point[1])<roadTypes[road.kind].width/2+.6;
    }));
    const roadJunctions=new Map();
    for(const junction of junctions)for(const arm of junction.approaches){
      if(!roadJunctions.has(arm.road))roadJunctions.set(arm.road,new Set());
      roadJunctions.get(arm.road).add(arm.distance);
    }
    const addArrow=(road,distance,direction,offset,turns,laneWidth=roadTypes[road.kind].width/laneCounts[road.kind])=>{
      const at=sample(road.points,distance),travel=at.tangent.map(v=>v*direction);
      arrows.push({road:road.id,level:road.level,point:[at.point[0]-travel[1]*offset,at.point[1]+travel[0]*offset],travel,turns,laneWidth});
    };
    for(const junction of junctions){
      for(const arm of junction.approaches){
        const road=roadMap.get(arm.road);if(!road)continue;
        const length=measure(road.points).length,clearance=clearDistance(arm,junction.approaches);
        const available=arm.direction>0?length-arm.distance:arm.distance;
        // Neighbouring junctions bound the approach; frontage nodes do not.
        let room=available;
        for(const distance of roadJunctions.get(arm.road)){
          const delta=(distance-arm.distance)*arm.direction;
          if(delta>.1)room=Math.min(room,delta/2);
        }
        const end=arm.distance+arm.direction*Math.min(available,clearance+(Number.isFinite(arm.crossingDistance)?10:6));
        gaps.get(road.id).push([Math.min(arm.distance,end),Math.max(arm.distance,end)]);
        // Advancing a stop line must not expose another set of crossings and
        // poles on short internal links of an already overlapping junction.
        if(room<clearance+(Number.isFinite(arm.crossingDistance)?18:14))continue;
        const at=sample(road.points,arm.distance+arm.direction*(clearance+3));
        const tangent=at.tangent.map(v=>v*arm.direction);
        const furniture={road:road.id,level:road.level,point:at.point,tangent,width:arm.width,oneway:road.oneway,
          junction:junction.id,approach:`${arm.road}:${arm.direction}`,initial:junction.signal?.initial};
        if(junction.crossings&&motorKinds.has(road.kind)&&roadTypes[road.kind].walk){
          crosswalks.push(furniture);
          // A pedestrian head belongs to an end of a crossing, not to a vehicle
          // approach. Both ends face across the road beside the zebra, with
          // room for the far-side vehicle mast and perpendicular crossing.
          if(junction.control==='signals')for(const side of [-1,1]){
            // Use the back of the waiting area, still inside the narrowest
            // 3 m sidewalk. At the first full-detail zoom, readable housings
            // plus the two pole heights otherwise overlap on diagonal roads.
            const lateral=side*(arm.width/2+2.4);
            pedestrianSignals.push({...furniture,kind:'pedestrian',side,
              height:2.3,point:[at.point[0]+tangent[0]*.5-tangent[1]*lateral,at.point[1]+tangent[1]*.5+tangent[0]*lateral]});
          }
        }
        if(arm.incoming&&motorKinds.has(road.kind)){
          const stop=sample(road.points,arm.distance+arm.direction*(clearance+7));
          const stopFurniture={...furniture,point:stop.point,tangent:stop.tangent.map(v=>v*arm.direction)};
          if(junction.control==='signals'||junction.crossings)stopLines.push(stopFurniture);
          if(junction.control==='signals'){
            const t=stopFurniture.tangent;
            // The face looks towards this incoming arm. Prefer the far side of
            // the junction; T junctions use a mast just ahead of the stop line.
            const opposite=junction.approaches.filter(a=>a!==arm&&a.outgoing&&motorKinds.has(a.kind)&&
              a.tangent[0]*t[0]+a.tangent[1]*t[1]<-.88).sort((a,b)=>
                (a.tangent[0]-b.tangent[0])*t[0]+(a.tangent[1]-b.tangent[1])*t[1])[0];
            const near=sample(road.points,arm.distance+arm.direction*(clearance+5.8));
            let center=near.point,mountTangent=near.tangent.map(v=>v*arm.direction),span=arm.width,placement='near';
            if(opposite){
              const farRoad=roadMap.get(opposite.road),distance=clearDistance(opposite,junction.approaches)+6.8;
              const farRoom=opposite.direction>0?measure(farRoad.points).length-opposite.distance:opposite.distance;
              const next=Array.from(roadJunctions.get(opposite.road)).map(d=>(d-opposite.distance)*opposite.direction).filter(d=>d>.1);
              if(Math.min(farRoom,...next.map(d=>d/2))>distance+2){
                const far=sample(farRoad.points,opposite.distance+opposite.direction*distance);
                center=far.point;mountTangent=far.tangent.map(v=>-v*opposite.direction);span=opposite.width;placement='far';
              }
            }
            // A far-side sidewalk may belong to another nearby intersection.
            // Fall back to this approach instead of planting a mast in traffic.
            const supportAt=()=>[center[0]+mountTangent[1]*(span/2+1.8),center[1]-mountTangent[0]*(span/2+1.8)];
            if(placement==='far'&&supportBlocked(supportAt(),road.level)){
              center=near.point;mountTangent=near.tangent.map(v=>v*arm.direction);span=arm.width;placement='near';
            }
            const count=arm.laneCount||(road.oneway?laneCounts[road.kind]:laneCounts[road.kind]/2),laneWidth=arm.laneWidth||arm.width/laneCounts[road.kind];
            const heads=Array.from({length:count},(_,lane)=>{
              const lateral=road.oneway?-arm.width/2+(lane+.5)*laneWidth:(lane+.5)*laneWidth;
              const d=lateral*Math.min(1,span/arm.width);
              return [center[0]+mountTangent[1]*d,center[1]-mountTangent[0]*d];
            });
            let support=supportAt();
            if(supportBlocked(support,road.level)){
              const other=[center[0]-mountTangent[1]*(span/2+1.8),center[1]+mountTangent[0]*(span/2+1.8)];
              if(!supportBlocked(other,road.level))support=other;
            }
            signals.push({...stopFurniture,kind:'vehicle',point:heads[0],heads,support,height:5.8,faceDirection:t,
              stopPoint:stop.point,placement,center,mountTangent});
          }
          const turns=turnsFor(arm,junction.approaches),count=arm.laneCount||(road.oneway?laneCounts[road.kind]:laneCounts[road.kind]/2);
          const laneWidth=arm.laneWidth||arm.width/laneCounts[road.kind];
          for(let lane=0;lane<count;lane++){
            const allowed=arm.laneTurns?.[lane]||turns.filter(turn=>turn==='straight'||count===1||turn==='left'&&lane===0||turn==='right'&&lane===count-1);
            if(!allowed.length)continue;
            const offset=road.oneway?-arm.width/2+(lane+.5)*laneWidth:(lane+.5)*laneWidth;
            addArrow(road,arm.distance+arm.direction*(clearance+18),-arm.direction,offset,allowed,laneWidth);
          }
          if(arm.autoLanes){
            const start=arm.stopDistance,end=arm.laneTaperDistance,full=arm.laneFullDistance;
            if(!bayGaps.has(road.id))bayGaps.set(road.id,[]);
            const limits=[arm.distance+arm.direction*start,arm.distance+arm.direction*end].sort((a,b)=>a-b);
            bayGaps.get(road.id).push({limits,direction:arm.direction,oneway:road.oneway});
            for(let lane=1;lane<count;lane++){
              const points=[];
              for(let d=start;d<end+1;d=Math.min(end,d+2)){
                const blend=Math.max(0,Math.min(1,(end-d)/(end-full))),mix=blend*blend*(3-2*blend);
                const original=Math.min(lane,arm.baseLaneCount)*arm.width/laneCounts[road.kind];
                const offset=(road.oneway?-arm.width/2:0)+original+(lane*laneWidth-original)*mix;
                const at=sample(road.points,arm.distance+arm.direction*d),t=at.tangent.map(v=>v*arm.direction);
                points.push([at.point[0]+t[1]*offset,at.point[1]-t[0]*offset]);
                if(d===end)break;
              }
              laneBays.push({road:road.id,level:road.level,points});
            }
          }
        }
      }
    }
    const centerlines=[],medians=[],edgeLines=[],curbRoads=[];
    for(const road of roads){
      if(!motorKinds.has(road.kind))continue;
      const length=measure(road.points).length,width=roadTypes[road.kind].width;
      const ranges=gaps.get(road.id).slice().sort((a,b)=>a[0]-b[0]);
      const free=[];let cursor=0;
      for(const [a,b] of ranges){if(a>cursor)free.push([cursor,a]);cursor=Math.max(cursor,b);}
      if(cursor<length)free.push([cursor,length]);
      const curbRoad=road.level===0&&roadTypes[road.kind].walk?{road:road.id,source:road.points,width,laneWidth:width/laneCounts[road.kind],bounds:bounds(road.points,width/2+.7),runs:[]}:null;
      if(curbRoad)curbRoads.push(curbRoad);
      for(const [a,b] of free){
        if(road.kind!=='lane'&&b-a>3)for(const side of [-1,1])edgeLines.push({road:road.id,level:road.level,points:offsetPath(slice(road.points,a,b),side*(width/2-.45))});
        if(b-a>5&&road.kind==='avenue'&&!road.oneway&&road.level===0)medians.push({road:road.id,points:slice(road.points,a>0?a+2:a,b<length?b-2:b)});
        const count=laneCounts[road.kind],laneWidth=width/count;
        if(road.kind!=='lane')for(let lane=1;lane<count;lane++){
          if(!road.oneway&&lane===count/2&&b-a<10)continue;
          const offset=-width/2+lane*laneWidth;
          const median=!road.oneway&&lane===count/2;
          // The final approach is a no-change lane section. This keeps the
          // physical lane allocation intact while giving each stop line a
          // legible approach instead of another enormous floating dash.
          const approach=Math.min(12,(b-a)*.24),first=median?a:Math.min(b,a+(a>0?approach:0)),last=median?b:Math.max(first,b-(b<length?approach:0));
          for(const [start,end,solid] of [[a,first,true],[first,last,false],[last,b,true]]){
            let pieces=[[start,end]];
            if(!median)for(const bay of bayGaps.get(road.id)||[])if(bay.oneway||offset*bay.direction<0){
              const [lo,hi]=bay.limits;
              pieces=pieces.flatMap(([s,e])=>e<=lo||s>=hi?[[s,e]]:[[s,Math.min(e,lo)],[Math.max(s,hi),e]].filter(([s,e])=>e>s));
            }
            for(const [s,e] of pieces)if(e-s>.05)centerlines.push({road:road.id,level:road.level,median,solid,points:offsetPath(slice(road.points,s,e),offset)});
          }
        }
        // Keep only continuous ranges here. Fine joints and grates are created
        // for visible 32 m pieces at street zoom, never for a whole city load.
        if(curbRoad){const points=slice(road.points,a,b);curbRoad.runs.push({id:++detailSerial,start:a,end:b,points,bounds:bounds(points,width/2+.7)});}
        for(let d=a+35;d<b-24;d+=95){
          for(const direction of road.oneway?[1]:[1,-1])for(let lane=0;lane<(road.oneway?count:count/2);lane++){
            if((bayGaps.get(road.id)||[]).some(b=>b.direction===-direction&&d>=b.limits[0]&&d<=b.limits[1]))continue;
            const offset=road.oneway?-width/2+(lane+.5)*laneWidth:(lane+.5)*laneWidth;
            addArrow(road,d,direction,offset,['straight']);
          }
        }
      }
    }
    const guides=[];
    for(const j of junctions){
      const candidates=j.approaches.filter(arm=>roadMap.has(arm.road)&&arm.level===0&&motorKinds.has(arm.kind)&&j.approaches.some(a=>a.road===arm.road&&a.direction!==arm.direction));
      // One continuous corridor owns the through-lane guide. Crossing two
      // complete sets produces a dotted grid rather than usable lane guidance.
      // Width and road continuity choose it deterministically, without adding
      // lanes or modifying any routing/signal state.
      const arm=candidates.sort((a,b)=>b.width-a.width||measure(roadMap.get(b.road).points).length-measure(roadMap.get(a.road).points).length||String(a.road).localeCompare(String(b.road)))[0];
      if(!arm)continue;
      const road=roadMap.get(arm.road),extent=Math.max(...j.approaches.map(a=>a.width))/2-.6,count=laneCounts[road.kind],width=roadTypes[road.kind].width;
      const start=Math.max(0,arm.distance-extent),points=slice(road.points,start,Math.min(measure(road.points).length,arm.distance+extent));
      for(let lane=1;lane<count;lane++)if(lane!==count/2||road.oneway)guides.push({road:road.id,phase:start%5.7,points:offsetPath(points,-width/2+lane*width/count)});
    }
    const result={arrows,crosswalks,stopLines,signals,pedestrianSignals,centerlines,medians,edgeLines,guides,curbRoads,pockets,laneBays};plans.set(network,result);return result;
  }

  function cornerAnchor(road,arm,point,nominal,side){
    if(!road||road.points.length<2)return null;
    const {distances,length}=measure(road.points),direction=arm.direction===-1?-1:1;
    let distance=Number.isFinite(arm.distance)?arm.distance+direction*((nominal[0]-point[0])*arm.tangent[0]+(nominal[1]-point[1])*arm.tangent[1]):nearestDistance(road.points,nominal);
    distance=Math.max(0,Math.min(length,distance));
    let lo=1,hi=road.points.length-1;
    while(lo<hi){const mid=(lo+hi)>>1;if(distances[mid]<distance)lo=mid+1;else hi=mid;}
    let i=lo;
    while(i<road.points.length-1&&distances[i]-distances[i-1]<1e-9)i++;
    while(i>1&&distances[i]-distances[i-1]<1e-9)i--;
    const start=distances[i-1],end=distances[i],margin=Math.min(.9,(end-start)*.2);
    // Join within a real source segment, not at its Canvas round join. Both
    // the normal and the short overlap then agree with the road stroke.
    distance=Math.max(start+margin,Math.min(end-margin,distance));
    const at=sample(road.points,distance),tangent=at.tangent.map(v=>v*direction),normal=[-tangent[1]*side,tangent[0]*side];
    return {distance,center:at.point,tangent,point:at.point.map((v,k)=>v+normal[k]*arm.width/2),extension:Math.min(.65,(direction>0?end-distance:distance-start)*.75)};
  }
  function junctionCorners(network,roads=[]){
    const result=[],roadMap=new Map(roads.map(r=>[r.id,r]));
    for(const j of network.junctions||[]){
      const arms=j.approaches.filter(a=>a.level===0&&motorKinds.has(a.kind)).slice().sort((a,b)=>Math.atan2(a.tangent[1],a.tangent[0])-Math.atan2(b.tangent[1],b.tangent[0]));
      for(let i=0;i<arms.length;i++){
        const a=arms[i],b=arms[(i+1)%arms.length],u=a.tangent,v=b.tangent,cross=u[0]*v[1]-u[1]*v[0],dot=u[0]*v[0]+u[1]*v[1];
        if(cross<.25||dot<-.93)continue;
        const p=[j.point[0]-u[1]*a.width/2,j.point[1]+u[0]*a.width/2],q=[j.point[0]+v[1]*b.width/2,j.point[1]-v[0]*b.width/2];
        const t=((q[0]-p[0])*v[1]-(q[1]-p[1])*v[0])/cross,corner=[p[0]+u[0]*t,p[1]+u[1]*t],radius=Math.min(6,Math.min(a.width,b.width)*.35);
        if(Math.hypot(corner[0]-j.point[0],corner[1]-j.point[1])>65)continue;
        const angle=Math.acos(Math.max(-1,Math.min(1,dot))),leg=radius/Math.tan(angle/2);
        const c={corner,radius,from:corner.map((v,k)=>v+u[k]*leg),to:corner.map((n,k)=>n+v[k]*leg),u,v,
          road:a.road,nextRoad:b.road,kind:a.kind,nextKind:b.kind,widths:[a.width,b.width],junction:j.point,extensions:[.65,.65]};
        const from=cornerAnchor(roadMap.get(a.road),a,j.point,c.from,1),to=cornerAnchor(roadMap.get(b.road),b,j.point,c.to,-1);
        if(from&&to){
          const cu=from.tangent,cv=to.tangent,den=cu[0]*cv[1]-cu[1]*cv[0],delta=from.point.map((n,k)=>n-to.point[k]);
          if(den<.15)continue;
          const first=(delta[0]*cv[1]-delta[1]*cv[0])/den,last=(delta[0]*cu[1]-delta[1]*cu[0])/den;
          if(first<=.1||last<=.1||Math.max(first,last)>80)continue;
          c.from=from.point;c.to=to.point;c.u=cu;c.v=cv;c.corner=c.from.map((n,k)=>n-cu[k]*first);
          c.anchors=[from,to];c.extensions=[from.extension,to.extension];
        }
        const theta=Math.acos(Math.max(-1,Math.min(1,c.u[0]*c.v[0]+c.u[1]*c.v[1]))),ratio=4/3*Math.tan((Math.PI-theta)/4)*Math.tan(theta/2);
        const first=Math.hypot(c.from[0]-c.corner[0],c.from[1]-c.corner[1]),last=Math.hypot(c.to[0]-c.corner[0],c.to[1]-c.corner[1]);
        // A circular fillet keeps the inward sidewalk offsets regular. The
        // former quadratic had a tighter middle radius than its nominal 6 m.
        c.controls=[c.from.map((n,k)=>n-c.u[k]*first*ratio),c.to.map((n,k)=>n-c.v[k]*last*ratio)];
        result.push(c);
      }
    }return result;
  }
  function cornerOffset(c,distance,steps=32){
    const points=[];
    for(let i=0;i<=steps;i++){
      const t=i/steps,s=1-t,p=c.controls?c.from.map((v,k)=>s*s*s*v+3*t*s*s*c.controls[0][k]+3*t*t*s*c.controls[1][k]+t*t*t*c.to[k]):c.from.map((v,k)=>s*s*v+2*t*s*c.corner[k]+t*t*c.to[k]);
      const tangent=c.controls?c.from.map((v,k)=>3*s*s*(c.controls[0][k]-v)+6*s*t*(c.controls[1][k]-c.controls[0][k])+3*t*t*(c.to[k]-c.controls[1][k])):c.from.map((v,k)=>2*s*(c.corner[k]-v)+2*t*(c.to[k]-c.corner[k]));
      const length=Math.hypot(...tangent)||1;
      let normal=[-tangent[1]/length,tangent[0]/length];if(normal[0]*(c.u[0]+c.v[0])+normal[1]*(c.u[1]+c.v[1])<0)normal=normal.map(v=>-v);
      const d=typeof distance==='function'?distance(t):distance;points.push(p.map((v,k)=>v+normal[k]*d));
    }
    return points;
  }
  function cornerBoundary(c,band,steps=32){
    const a=roadCrossSection(c.kind)[band],b=roadCrossSection(c.nextKind)[band];
    // Zero endpoint derivatives preserve the incoming road tangents even
    // where an avenue's wide promenade becomes a street's narrow one.
    const points=cornerOffset(c,t=>a+(b-a)*t*t*(3-2*t),steps),extensions=c.extensions||[.65,.65];
    return [points[0].map((n,k)=>n+c.u[k]*extensions[0]),...points,points.at(-1).map((n,k)=>n+c.v[k]*extensions[1])];
  }
  function cornerDecoration(c){
    return cachedDetail(cornerDetails,c.id,cornerDetailLimit,()=>{
      cornerDetailBuilds++;
      const from=c.from.map((n,k)=>n+c.u[k]*c.extensions[0]-[-c.u[1],c.u[0]][k]*c.widths[0]/2);
      const to=c.to.map((n,k)=>n+c.v[k]*c.extensions[1]-[c.v[1],-c.v[0]][k]*c.widths[1]/2);
      const bands=['sidewalk','promenade','innerWalk','curb','gutter','surface'].map(band=>{
        const points=[from,...cornerBoundary(c,band),to,c.junction];let path=null;
        if(typeof Path2D!=='undefined'){path=new Path2D();points.forEach((p,i)=>i?path.lineTo(...p):path.moveTo(...p));path.closePath();}
        return {band,points,path};
      });
      return {bands};
    });
  }
  function visibleCorners(network,roads,view,inView){
    if(!cornerPlans.has(network)||cornerPlans.get(network).roads!==roads){
      const items=junctionCorners(network,roads).map(c=>({...c,id:++detailSerial,bounds:bounds([c.corner,c.from,c.to],5.5)})),grid=new Map();
      for(const c of items){const key=Math.floor(c.corner[0]/128)+':'+Math.floor(c.corner[1]/128);if(!grid.has(key))grid.set(key,[]);grid.get(key).push(c);}
      const reach=items.reduce((n,c)=>Math.max(n,c.corner[0]-c.bounds[0],c.bounds[2]-c.corner[0],c.corner[1]-c.bounds[1],c.bounds[3]-c.corner[1]),16);
      cornerPlans.set(network,{items,grid,roads,reach});
    }
    const {items,grid,reach}=cornerPlans.get(network);if(!items.length)return [];
    if(!view)return items.filter(c=>inView([[c.bounds[0],c.bounds[1]],[c.bounds[2],c.bounds[3]]]));
    const x0=Math.floor((view[0]-reach)/128),x1=Math.floor((view[2]+reach)/128),y0=Math.floor((view[1]-reach)/128),y1=Math.floor((view[3]+reach)/128);
    if((x1-x0+1)*(y1-y0+1)>4096)return items.filter(c=>intersects(c.bounds,view));
    const visible=[];for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)for(const c of grid.get(x+':'+y)||[])if(intersects(c.bounds,view))visible.push(c);return visible;
  }
  function paintCorners(ctx,network,{scale=1,inView=()=>true,roads=[]}={}){
    if(scale<.65)return;
    ctx.save();ctx.lineCap='butt';ctx.lineJoin='round';
    const line=points=>{ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));};
    for(const c of visibleCorners(network,roads,viewport(ctx),inView)){
      const detail=cornerDecoration(c);
      // These are the same nested boundaries as roadSurfaces, including the
      // gutter and both sides of the coping. No translated/erasing strokes.
      for(const shape of detail.bands){
        const name=shape.band==='promenade'?'pavingWarm':shape.band==='curb'?'curb':shape.band==='surface'?'asphalt':'paving';
        ctx.fillStyle=shape.band==='gutter'?'#47504f':root.CityScene.material(ctx,name,0);
        if(shape.path)ctx.fill(shape.path);else{line(shape.points);ctx.closePath();ctx.fill();}
      }
      if(scale>=3.5){
        if(!detail.joints){const count=Math.max(4,Math.round(c.radius*1.35)),inner=cornerOffset(c,roadCrossSection(c.kind).gutter,count),outer=cornerOffset(c,roadCrossSection(c.kind).curb,count);detail.joints=inner.slice(1,-1).map((p,i)=>[p,outer[i+1]]);}
        ctx.beginPath();for(const joint of detail.joints){ctx.moveTo(...joint[0]);ctx.lineTo(...joint[1]);}ctx.strokeStyle='#7b81795e';ctx.lineWidth=.045;ctx.stroke();
      }
    }
    ctx.restore();
  }
  function clippedSegment(a,b,box){
    const dx=b[0]-a[0],dy=b[1]-a[1];let lo=0,hi=1;
    for(const [p,q] of [[-dx,a[0]-box[0]],[dx,box[2]-a[0]],[-dy,a[1]-box[1]],[dy,box[3]-a[1]]]){
      if(Math.abs(p)<1e-12){if(q<0)return null;continue;}
      const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return null;
    }return [lo,hi];
  }
  function visibleCurbPieces(run,road,view,inView){
    const count=Math.ceil((run.end-run.start)/32),indices=new Set();
    if(view){
      const pad=road.width/2+.7,box=[view[0]-pad,view[1]-pad,view[2]+pad,view[3]+pad],distances=measure(run.points).distances;
      for(let i=1;i<run.points.length;i++){
        const clip=clippedSegment(run.points[i-1],run.points[i],box);if(!clip)continue;
        const length=distances[i]-distances[i-1],first=Math.max(0,Math.floor((distances[i-1]+clip[0]*length)/32)),last=Math.min(count-1,Math.floor((distances[i-1]+clip[1]*length)/32));
        for(let piece=first;piece<=last;piece++)indices.add(piece);
      }
    }else for(let piece=0;piece<count;piece++){
      const points=slice(road.source,run.start+piece*32,Math.min(run.end,run.start+(piece+1)*32));if(inView(points))indices.add(piece);
    }
    return indices;
  }
  function curbPiece(road,run,piece,side){
    return cachedDetail(curbDetails,run.id+':'+piece+':'+side,curbDetailLimit,()=>{
      curbDetailBuilds++;
      const start=run.start+piece*32,end=Math.min(run.end,start+32),joints=[],drains=[],width=road.width;
      const curbPoint=(d,across)=>{const at=sample(road.source,d);return [at.point[0]-at.tangent[1]*side*across,at.point[1]+at.tangent[0]*side*across];};
      const phase=detailRandom(road.road+':curb-phase:'+side)()*1.45;
      for(let cell=Math.floor((start-phase)/1.45);cell<=Math.ceil((end-phase)/1.45);cell++){
        const random=detailRandom(road.road+':curb:'+side+':'+cell),d=phase+cell*1.45+(random()-.5)*.16;
        if(d>start+.06&&d<end-.06)joints.push([curbPoint(d,width/2+.045+random()*.025),curbPoint(d,width/2+.47+random()*.04)]);
      }
      for(let d=Math.ceil((start+3)/29)*29;d<end-3;d+=29){const at=sample(road.source,d);drains.push({point:curbPoint(d,width/2-.25),tangent:at.tangent,side});}
      return {start,end,joints,drains};
    });
  }
  function roadSurfaceDetails(road,run,start,end,side){
    const wear=[],patches=[],seals=[],half=road.width/2,laneWidth=road.laneWidth||road.width/2;
    const at=(distance,across)=>{const p=sample(road.source,distance);return [p.point[0]-p.tangent[1]*side*across,p.point[1]+p.tangent[0]*side*across];};
    const safe=(distance,radius)=>distance-radius>=run.start+1.4&&distance+radius<=run.end-1.4;
    const shape=(points,color,closed=true,width=0)=>{
      let path=null;if(typeof Path2D!=='undefined'){path=new Path2D();points.forEach((p,i)=>i?path.lineTo(...p):path.moveTo(...p));if(closed)path.closePath();}
      return {points,path,color,closed,width};
    };
    const cells=(spacing,tag,build)=>{
      for(let cell=Math.floor(start/spacing);cell<=Math.floor(end/spacing);cell++){
        const random=detailRandom(road.road+':surface:'+side+':'+tag+':'+cell),distance=(cell+.18+random()*.64)*spacing;
        // The event belongs to exactly one visible piece. Its metre-based
        // position survives cache eviction and a different junction run split.
        if(distance>=start&&distance<end)build(distance,random);
      }
    };
    cells(8.3,'edge',(distance,random)=>{
      if(random()<.23)return;
      const length=2.3+random()*4.2,depth=.065+random()*.115;if(!safe(distance,length/2))return;
      const outside=[],inside=[];
      for(let i=0;i<=6;i++){
        const t=i/6,d=distance+(t-.5)*length,taper=Math.sin(t*Math.PI),edge=.025+random()*.018;
        outside.push(at(d,half-edge));inside.push(at(d,half-edge-depth*taper*(.55+random()*.45)));
      }
      wear.push(shape([...outside,...inside.reverse()],random()<.42?'#c2b9a629':'#33444725'));
    });
    cells(47,'patch',(distance,random)=>{
      if(random()<.55)return;
      const length=1.1+random()*1.55,depth=Math.min(.36+random()*.34,laneWidth*.16);if(!safe(distance,length))return;
      const setback=Math.min(1.25+random()*1.15,laneWidth*.64),across=half-setback,points=[];
      for(let i=0;i<9;i++){
        const angle=i*Math.PI*2/9,radius=.76+random()*.24;
        points.push(at(distance+Math.cos(angle)*length*radius,across+Math.sin(angle)*depth*radius));
      }
      patches.push(shape(points,random()<.56?'#33474c1a':'#bdb7a71a'));
      if(random()<.22)seals.push(shape(points,'#3d4b4c28',true,.035));
    });
    cells(59,'seal',(distance,random)=>{
      if(random()<.58||!safe(distance,1.6))return;
      const across=half-Math.min(1.05+random()*1.7,laneWidth*.67),span=.9+random()*1.3,points=[];
      for(let i=0;i<5;i++)points.push(at(distance+(i/4-.5)*span,across+(random()-.5)*.36));
      seals.push(shape(points,'#35474b40',false,.035+random()*.02));
    });
    return {wear,patches,seals};
  }
  function paintSurfaceDetails(ctx,detail){
    const path=shape=>{
      if(shape.path)return shape.path;
      ctx.beginPath();shape.points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));if(shape.closed)ctx.closePath();return null;
    };
    for(const shapes of [detail.wear,detail.patches])for(const shape of shapes){const p=path(shape);ctx.fillStyle=shape.color;if(p)ctx.fill(p);else ctx.fill();}
    ctx.lineCap='round';for(const shape of detail.seals){const p=path(shape);ctx.strokeStyle=shape.color;ctx.lineWidth=shape.width;if(p)ctx.stroke(p);else ctx.stroke();}ctx.lineCap='butt';
  }
  function paintCurbs(ctx,plan,{scale,inView,layout}){
    if(scale<3.5||root.CityScene?.effectiveQuality!=='high')return;
    const view=viewport(ctx),near=box=>view?intersects(box,view):inView([[box[0],box[1]],[box[2],box[3]]]);
    ctx.save();ctx.lineCap='butt';ctx.lineJoin='round';
    for(const road of plan.curbRoads)if(near(road.bounds))for(const run of road.runs)if(near(run.bounds))for(const piece of visibleCurbPieces(run,road,view,inView))for(const side of [-1,1]){
      const section=curbPiece(road,run,piece,side);
      const source=layout?.roadMap.get(road.road),profile=source&&surfaceRoad(source,layout).surfaceProfile;
      if(profile?.some(s=>s.landingMix<1&&s.distance>=section.start&&s.distance<=section.end))continue;
      if(scale>=4.5){
        if(!section.surface){section.surface=roadSurfaceDetails(road,run,section.start,section.end,side);surfaceDetailBuilds++;}
        paintSurfaceDetails(ctx,section.surface);
      }
      ctx.beginPath();for(const pair of section.joints){ctx.moveTo(...pair[0]);ctx.lineTo(...pair[1]);}ctx.strokeStyle='#727d7359';ctx.lineWidth=Math.max(.035,.42/scale);ctx.stroke();
      for(const drain of section.drains){
        ctx.save();ctx.translate(...drain.point);ctx.rotate(Math.atan2(drain.tangent[1],drain.tangent[0]));
        ctx.fillStyle='#c3c5b1';ctx.fillRect(-.59,-.25,1.18,.5);
        ctx.fillStyle='#303b3b';ctx.fillRect(-.53,-.19,1.06,.38);
        ctx.strokeStyle='#818d87';ctx.lineWidth=.045;ctx.beginPath();for(let x=-.42;x<.5;x+=.14){ctx.moveTo(x,-.17);ctx.lineTo(x,.17);}ctx.stroke();
        ctx.fillStyle='#d8d7be8c';ctx.fillRect(-.59,-.25,1.18,.045);ctx.restore();
      }
    }
    ctx.restore();
  }
  function arrowPolygons(turns,laneWidth=7){
    // Long painted stem, solid heads and forward-swept branches. The common
    // stem is drawn once, so a shared lane never becomes a four-way diamond.
    const lateral=Math.min(1,(laneWidth/2-.45)/2.5),parts=[],straight=turns.includes('straight'),tail=straight?-4.7:-5.7,end=straight?.3:-1;
    parts.push([[tail,-.17],[end,-.17],[end,.17],[tail,.17]]);
    if(straight)parts.push([[.1,-.17],[.25,-.17],[.25,-.78],[1.9,0],[.25,.78],[.25,.17],[.1,.17]]);
    for(const turn of turns)if(turn!=='straight'){
      const side=turn==='left'?-1:1,outer=[],inner=[];
      // A quarter-circle elbow gives turn markings the familiar hooked shape.
      for(let i=0;i<=8;i++){const a=Math.PI/2-i*Math.PI/16;outer.push([-.1+1.3*Math.cos(a),1.1-1.3*Math.sin(a)]);inner.push([-.1+.9*Math.cos(a),1.1-.9*Math.sin(a)]);}
      parts.push([[-1.8,-.17],...outer,[1.2,1.6],[.8,1.6],...inner.reverse(),[-1.8,.17]].map(([x,y])=>[x-1,y*side]));
      parts.push([[.25,1.4],[1,3],[1.75,1.4]].map(([x,y])=>[x-1,y*side]));
    }
    return parts.map(poly=>poly.map(([x,y])=>[x*.72,y*.76*Math.max(.35,lateral)]));
  }
  const lampColors={red:'#ff5947',yellow:'#ffd35a',green:'#57e39a'};
  function signalState(item,traffic){
    const signal=(traffic instanceof Map?traffic.get(item.junction):(traffic?.signals||[]).find(s=>s.id===item.junction))||item.initial;
    return item.kind==='pedestrian'?(signal?.pedestrian==='green'?'green':'red'):(signal?.lamps?.[item.approach]||'red');
  }
  function signalDimensions(kind,scale){
    const pedestrian=kind==='pedestrian',compact=scale<4.5;
    // Readability is measured in screen pixels. At street scale a lit lens
    // must remain visible against road markings, even before zooming in.
    const unit=Math.max(pedestrian?.22:.25,(pedestrian?3.4:4.4)/scale);
    return {unit,compact,width:compact?5.5/scale:(pedestrian?2.2:2.35)*unit,height:compact?5.5/scale:(pedestrian?4.6:5.6)*unit};
  }
  function signalFaces(item,scale=Infinity){
    const heads=item.heads||[item.point];
    // One state marker per approach at city scale; lane heads return together
    // when their full three-lens housings fit between neighbouring lanes.
    return scale<4.5&&heads.length>1?[heads.reduce((p,q)=>p.map((v,i)=>v+q[i]/heads.length),[0,0])]:heads;
  }
  function signalProjection(point,height){return [point[0],point[1]-height*.28];}
  function signalSprite(kind,lit){
    if(typeof document==='undefined')return null;
    const key=kind+':'+lit;if(signalSprites.has(key))return signalSprites.get(key);
    const pedestrian=kind==='pedestrian',width=pedestrian?2.2:2.35,height=pedestrian?4.6:5.6,pad=.3,pixels=40;
    const canvas=document.createElement('canvas');canvas.width=Math.ceil((width+pad*2)*pixels);canvas.height=Math.ceil((height+pad*2)*pixels);
    const g=canvas.getContext('2d');g.scale(pixels,pixels);g.translate(width/2+pad,height/2+pad);
    g.fillStyle='#0d192b57';g.beginPath();g.roundRect(-width/2+.13,-height/2+.15,width,height,.24);g.fill();
    const casing=g.createLinearGradient(-width/2,0,width/2,0);casing.addColorStop(0,'#b5b8a1');casing.addColorStop(.12,'#485450');casing.addColorStop(.35,'#263431');casing.addColorStop(1,'#0c161c');
    g.fillStyle=casing;g.beginPath();g.roundRect(-width/2,-height/2,width,height,.24);g.fill();g.strokeStyle='#cbd0b8';g.lineWidth=.07;g.stroke();
    g.fillStyle='#172227';g.beginPath();g.roundRect(-width/2+.17,-height/2+.13,width-.34,height-.26,.16);g.fill();
    const colors=pedestrian?['red','green']:['red','yellow','green'];
    for(const [i,color] of colors.entries()){
      const active=color===lit,y=pedestrian?(i-.5)*2.15:(i-1)*1.7;
      g.save();g.translate(0,y);
      g.fillStyle='#050c12';g.beginPath();g.ellipse(.02,.02,pedestrian?.85:.87,pedestrian?.96:.81,0,0,Math.PI*2);g.fill();
      if(pedestrian){
        g.fillStyle='#101b22';g.fillRect(-.76,-.87,1.52,1.74);
        g.fillStyle=g.strokeStyle=active?lampColors[color]:'#38484a';g.lineWidth=.26;g.lineCap='round';g.lineJoin='round';
        g.beginPath();g.arc(0,-.59,.18,0,Math.PI*2);g.fill();
        const strokes=color==='green'?[[[0,-.29],[-.12,.16],[-.5,.65]],[[-.12,.16],[.38,.68]],[[-.49,.03],[0,-.22],[.44,.12]]]:[[[0,-.29],[0,.19]],[[-.08,.19],[-.22,.69]],[[.08,.19],[.22,.69]],[[-.39,.24],[-.28,-.2],[.28,-.2],[.39,.24]]];
        for(const points of strokes){g.beginPath();points.forEach((p,j)=>j?g.lineTo(...p):g.moveTo(...p));g.stroke();}
      }else{
        const dark={red:['#695053','#472c30','#271a20'],yellow:['#656248','#433e2a','#25251e'],green:['#466c58','#284d3e','#182c26']}[color];
        const lens=g.createRadialGradient(-.2,-.24,.02,0,0,.78);lens.addColorStop(0,active?'#fff5cc':dark[0]);lens.addColorStop(.28,active?lampColors[color]:dark[1]);lens.addColorStop(1,active?({red:'#cd291b',yellow:'#e99d24',green:'#12aa6a'}[color]):dark[2]);
        g.fillStyle=lens;g.beginPath();g.arc(0,0,.77,0,Math.PI*2);g.fill();
        // A raised sun visor casts a tiny contact crescent above every lens.
        g.strokeStyle='#02070b';g.lineWidth=.17;g.beginPath();g.arc(0,0,.86,Math.PI*1.04,Math.PI*1.96);g.stroke();
        g.strokeStyle='#8b999459';g.lineWidth=.045;g.beginPath();g.arc(0,0,.86,.13,Math.PI-.13);g.stroke();
        if(active){g.fillStyle='#fffce2d6';g.beginPath();g.ellipse(-.19,-.24,.19,.12,-.5,0,Math.PI*2);g.fill();}
      }
      g.restore();
    }
    const result={canvas,x:-width/2-pad,y:-height/2-pad,width:width+pad*2,height:height+pad*2};signalSprites.set(key,result);return result;
  }
  function paintSignalMast(ctx,item,faces,mount,scale){
    const support=item.support||item.point,top=signalProjection(support,mount),end=signalProjection(faces[0],mount),pedestrian=item.kind==='pedestrian';
    const shadow=root.CityScene?.shadowOffset?.(mount)||[0,0];
    if(scale>1.5&&Math.hypot(...shadow)>.01){
      const point=p=>p.map((v,i)=>v+shadow[i]);ctx.strokeStyle='#1d293a35';ctx.lineWidth=pedestrian?.17:.24;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(...support);ctx.lineTo(...point(support));ctx.lineTo(...point(faces[0]));ctx.stroke();
      const sh=point(faces[0]);ctx.fillStyle='#1b29352b';ctx.fillRect(sh[0]-.24,sh[1]-.4,.48,.8);
    }
    if(scale>=4.5){
      ctx.fillStyle='#4c56545c';ctx.beginPath();ctx.ellipse(support[0]+.12,support[1]+.13,.4,.29,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#b7b6a6';ctx.fillRect(support[0]-.23,support[1]-.2,.46,.4);ctx.fillStyle='#f1e7cc';ctx.fillRect(support[0]-.23,support[1]-.2,.46,.065);
    }
    const path=()=>{ctx.beginPath();ctx.moveTo(...support);ctx.lineTo(...top);ctx.lineTo(...end);};
    ctx.lineCap='round';ctx.lineJoin='round';path();ctx.strokeStyle='#394648';ctx.lineWidth=Math.max(pedestrian?.16:.23,.7/scale);ctx.stroke();
    ctx.save();ctx.translate(-.045,-.045);path();ctx.strokeStyle='#ced0ba';ctx.lineWidth=Math.max(.055,.28/scale);ctx.stroke();ctx.restore();
  }
  function paintSignals(ctx,plan,{scale,visible=()=>true,traffic=null,level=null,night=0,solid=false}){
    if(scale<.45)return;
    const live=new Map((traffic?.signals||[]).map(s=>[s.id,s]));
    for(const item of [...plan.signals,...plan.pedestrianSignals]){
      if(level!==null&&item.level!==level||!visible(item.point))continue;
      const pedestrian=item.kind==='pedestrian',lit=signalState(item,live);
      const {unit,width,height,compact}=signalDimensions(item.kind,scale);
      if(compact&&pedestrian)continue;
      const mount=item.height||(pedestrian?2.3:5.8),faces=signalFaces(item,scale);
      if(!night&&!solid){
        paintSignalMast(ctx,item,faces,mount,scale);
      }
      for(const face of faces){
      if(compact){
        const point=signalProjection(face,mount),radius=width/2;
        ctx.save();ctx.translate(...point);
        if(night){const glow=ctx.createRadialGradient(0,0,radius*.4,0,0,radius*2);glow.addColorStop(0,lampColors[lit]+'70');glow.addColorStop(1,lampColors[lit]+'00');ctx.globalAlpha=night;ctx.fillStyle=glow;ctx.fillRect(-radius*2,-radius*2,radius*4,radius*4);}
        else {ctx.beginPath();ctx.arc(0,0,radius,0,Math.PI*2);ctx.fillStyle='#172426';ctx.fill();ctx.strokeStyle='#c3c9b9';ctx.lineWidth=.6/scale;ctx.stroke();ctx.beginPath();ctx.arc(0,0,radius*.65,0,Math.PI*2);ctx.fillStyle=lampColors[lit];ctx.fill();}
        ctx.restore();continue;
      }
      if(!night){
        const sprite=signalSprite(item.kind,lit);
        if(sprite){const point=signalProjection(face,mount);ctx.drawImage(sprite.canvas,point[0]+sprite.x*unit,point[1]+sprite.y*unit,sprite.width*unit,sprite.height*unit);continue;}
      }
      ctx.save();ctx.translate(...signalProjection(face,mount));ctx.scale(unit,unit);
      // Keep the lens faces upright in the map. Post positions follow the road;
      // rotating the faces themselves made an east-west signal look like a bar.
      if(!night){
        ctx.fillStyle='#172126';ctx.strokeStyle=pedestrian?'#c0c8bd':'#c8c5a9';ctx.lineWidth=.15;
        ctx.beginPath();ctx.roundRect(-width/(2*unit),-height/(2*unit),width/unit,height/unit,.3);ctx.fill();ctx.stroke();
      }
      const colors=pedestrian?['red','green']:['red','yellow','green'];
      for(const [i,color] of colors.entries()){
        const active=lit===color,y=pedestrian?(i-.5)*2.15:(i-1)*1.7;
        if(night&&!active)continue;
        ctx.save();ctx.translate(0,y);
        if(night){
          const glow=ctx.createRadialGradient(0,0,.25,0,0,2.1);glow.addColorStop(0,lampColors[color]+'70');glow.addColorStop(1,lampColors[color]+'00');
          ctx.globalAlpha=night;ctx.fillStyle=glow;ctx.fillRect(-2.1,-2.1,4.2,4.2);
        }
        if(pedestrian){
          if(!night){ctx.fillStyle='#0b1419';ctx.fillRect(-.84,-.94,1.68,1.88);}
          ctx.strokeStyle=ctx.fillStyle=active?lampColors[color]:'#344347';ctx.lineWidth=.28;ctx.lineCap='round';ctx.lineJoin='round';
          ctx.beginPath();ctx.arc(0,-.59,.19,0,Math.PI*2);ctx.fill();
          const strokes=color==='green'?[[[0,-.29],[-.12,.16],[-.5,.65]],[[-.12,.16],[.38,.68]],[[-.49,.03],[0,-.22],[.44,.12]]]:
            [[[0,-.29],[0,.19]],[[-.08,.19],[-.22,.69]],[[.08,.19],[.22,.69]],[[-.39,.24],[-.28,-.2],[.28,-.2],[.39,.24]]];
          for(const points of strokes){ctx.beginPath();points.forEach((p,j)=>j?ctx.lineTo(...p):ctx.moveTo(...p));ctx.stroke();}
        }else{
          if(!night){ctx.beginPath();ctx.arc(0,0,.79,0,Math.PI*2);ctx.fillStyle='#071113';ctx.fill();}
          ctx.beginPath();ctx.arc(0,0,.65,0,Math.PI*2);ctx.fillStyle=active?lampColors[color]:'#344044';ctx.fill();
          if(active&&!night){ctx.beginPath();ctx.arc(-.15,-.17,.2,0,Math.PI*2);ctx.fillStyle='#fff6d9b0';ctx.fill();}
        }
        ctx.restore();
      }
      ctx.restore();
      }
    }
  }

  function paint(ctx,state,{scale,selected,inView=()=>true,visible=()=>true,traffic=null,stage='all',vehicles=true,signals=true,levels=[-1,0,1]}){
    const {roads,network,roadTypes}=state,plan=buildPlan(roads,network,roadTypes),layout=connections(roads,network,roadTypes);
    const projected=(points,id)=>{const r=layout.roadMap.get(id);return r&&(r.level!==0||surfaceRoad(r,layout).surfaceProfile)?(points.length===1?[projectPoint(points[0],r,layout)]:projectPath(points,r,layout)):points;};
    const path=points=>{ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));};
    const local=(item,draw)=>{ctx.save();ctx.translate(...projected([item.point],item.road)[0]);ctx.rotate(Math.atan2(item.tangent[1],item.tangent[0]));draw();ctx.restore();};
    const arrow=item=>{
      ctx.save();ctx.translate(...projected([item.point],item.road)[0]);ctx.rotate(Math.atan2(item.travel[1],item.travel[0]));
      ctx.fillStyle=root.CityScene?.material(ctx,'marking',root.CityScene.seed(item.road))||'#f5f1dc';
      for(const polygon of arrowPolygons(item.turns,item.laneWidth)){path(polygon);ctx.closePath();ctx.fill();}ctx.restore();
    };
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
    for(const level of levels){
      const visibleRoads=roads.filter(r=>r.level===level&&inView(r.points));
      // Outline every road first, then fill the connected surface. A later
      // road's casing must never draw a barrier across an at-grade junction.
      if(root.CityScene&&(stage!=='details'||level>0))root.CityScene.roadSurfaces(ctx,visibleRoads.map(r=>surfaceRoad(r,layout)),roadTypes,scale,level);
      else if(!root.CityScene&&stage!=='details')for(const pass of ['outline','surface'])for(const road of visibleRoads){
        const cfg=roadTypes[road.kind],rail=!motorKinds.has(road.kind)&&road.kind!=='path';
        path(road.points);ctx.setLineDash(level<0?[6/scale,4/scale]:[]);
        ctx.lineWidth=pass==='outline'?Math.max(cfg.width+3,rail?3/scale:2/scale):Math.max(cfg.width,rail?1.5/scale:1/scale);
        ctx.strokeStyle=pass==='outline'?(rail?'#747c78':'#788779'):(rail?'#eef1e8':surfaces[road.kind]);ctx.stroke();
      }
      ctx.setLineDash([]);
      if(level===0&&stage!=='details'&&root.CityScene){
        paintCorners(ctx,network,{scale,inView,roads});paintCurbs(ctx,plan,{scale,inView,layout});
        for(const pocket of plan.pockets)if(inView(pocket.points)){
          ctx.fillStyle=root.CityScene.material(ctx,'asphalt',0);path(pocket.points);ctx.closePath();ctx.fill();
        }
      }
      if((level===1||level===0)&&root.CityScene&&stage!=='details'){
        const joins=layout.joins.filter(j=>j.approaches.some(a=>a.level===(level===1?1:-1))&&inView([[j.point[0]-j.extent,j.point[1]-j.extent],[j.point[0]+j.extent,j.point[1]+j.extent]]));
        paintConnections(ctx,state,scale,layout,joins);
        for(const j of level===1?joins:[]){ctx.save();clipJoin(ctx,j);paint(ctx,state,{scale,selected:null,inView,visible,traffic:null,stage:'details',vehicles:false,signals:false,levels:[0]});ctx.restore();}
      }
      if(stage!=='surface'&&root.RailRenderer)root.RailRenderer.paint(ctx,visibleRoads.map(r=>surfaceRoad(r,layout)),scale,{visible,contextRoads:roads.filter(r=>root.RailRenderer.isRail(r)).map(r=>surfaceRoad(r,layout))});
      if(stage==='surface')continue;
      if(scale>=.2){
        ctx.lineCap='butt';
        if(root.CityScene?.effectiveQuality==='high'&&scale>=.65){
          ctx.setLineDash([]);ctx.lineWidth=.14;ctx.strokeStyle=root.CityScene.material(ctx,'marking',0);
          for(const line of plan.edgeLines)if(line.level===level&&inView(line.points)){path(projected(line.points,line.road));ctx.stroke();}
        }
        ctx.lineWidth=Math.max(.15,.55/scale);ctx.setLineDash([2.6,5.6]);
        for(const line of plan.centerlines)if(line.level===level&&inView(line.points)){
          ctx.strokeStyle=root.CityScene?.material(ctx,line.median?'markingYellow':'marking',root.CityScene.seed(line.road))||(line.median?'#e6bf56':'#ecede3');
          if(line.median){
            ctx.setLineDash([]);ctx.lineWidth=Math.max(.14,.4/scale);
            for(const offset of [-.2,.2]){path(projected(offsetPath(line.points,offset),line.road));ctx.stroke();}
            ctx.lineWidth=Math.max(.15,.55/scale);
          }else{ctx.setLineDash(line.solid?[]:[2.6,5.6]);path(projected(line.points,line.road));ctx.stroke();}
        }
        ctx.setLineDash([]);
      }
      if(level===0&&scale>=.65){
        ctx.strokeStyle='#f4f2e0b8';ctx.lineWidth=.13;ctx.setLineDash([2,3.7]);
        for(const line of plan.guides)if(inView(line.points)){ctx.lineDashOffset=-line.phase;path(projected(line.points,line.road));ctx.stroke();}
        ctx.setLineDash([]);ctx.lineDashOffset=0;
      }
      if(scale>=.45){
        ctx.strokeStyle=root.CityScene?.material(ctx,'marking',0)||'#fffdf0';ctx.lineWidth=.16;ctx.setLineDash([]);
        for(const bay of plan.laneBays)if(bay.level===level&&inView(bay.points)){path(bay.points);ctx.stroke();}
        for(const item of plan.crosswalks)if(item.level===level&&visible(item.point))local(item,()=>{
          ctx.fillStyle=root.CityScene?.material(ctx,'marking',root.CityScene.seed(item.road))||'#fffdf0';for(let y=-item.width/2+.7;y<item.width/2-.6;y+=1.35)ctx.fillRect(-2,y,4,.7);
        });
        for(const item of plan.stopLines)if(item.level===level&&visible(item.point))local(item,()=>{
          ctx.fillStyle=root.CityScene?.material(ctx,'marking',root.CityScene.seed(item.road))||'#fffdf0';const a=-item.width/2+.5,b=item.oneway?item.width/2-.5:-.4;ctx.fillRect(-.2,a,.4,b-a);
        });
        for(const item of plan.arrows)if(item.level===level&&visible(item.point))arrow(item);
        if(signals)paintSignals(ctx,plan,{scale,visible,traffic,level});
      }
      for(const car of vehicles?traffic?.vehicles||[]:[])if((car.level===level||level===1&&upperVehicle(car,layout))&&visible(car.point)){
        if(root.CityScene){root.CityScene.vehicle(ctx,{...car,point:[car.point[0],car.point[1]-.28*vehicleHeight(car,layout)]},scale);continue;}
        ctx.save();ctx.translate(...car.point);ctx.rotate(car.heading);
        ctx.fillStyle='#203c3240';ctx.fillRect(-2.25+.6,-.95+.6,4.5,1.9);
        ctx.fillStyle=car.kind==='taxi'?'#edbe42':['#f4cf80','#81bcc7','#e8e7df','#d79e81'][car.id%4];ctx.fillRect(-2.25,-.95,4.5,1.9);
        ctx.fillStyle='#405d63';ctx.fillRect(.35,-.7,.8,1.4);
        if(car.kind==='taxi'){ctx.fillStyle=car.taxiState==='pickup'?'#5ee0aa':'#fff0ad';ctx.fillRect(-.6,-.45,.4,.9);}
        ctx.fillStyle=car.speed<.2?'#f7604d':'#b66d51';ctx.fillRect(-2.3,-.8,.35,.45);ctx.fillRect(-2.3,.35,.35,.45);ctx.restore();
      }
      for(const road of visibleRoads)if(road.id===selected){path(surfaceRoad(road,layout).points);ctx.strokeStyle='#d78b39';ctx.lineWidth=2/scale;ctx.stroke();}
    }
    ctx.restore();
  }
  const api={landingSeam,connections,nearestDistance,roadHeight,projectPoint,projectPath,surfaceRoad,upperVehicle,vehicleHeight,slice,clipJoin,sample,turnsFor,buildPlan,roadCrossSection,junctionCorners,cornerOffset,cornerBoundary,roadSurfaceDetails,arrowPolygons,signalState,signalDimensions,signalFaces,signalProjection,paintSignals,paint,get detailStats(){return {curbSections:curbDetails.size,curbSectionLimit:curbDetailLimit,curbBuilds:curbDetailBuilds,surfaceSections:[...curbDetails.values()].filter(s=>s.surface).length,surfaceBuilds:surfaceDetailBuilds,cornerDetails:cornerDetails.size,cornerDetailLimit,cornerBuilds:cornerDetailBuilds};}};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.RoadRenderer=api;
})(typeof window==='undefined'?{}:window);
