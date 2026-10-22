/* Road surfaces and furniture share the backend's connected junctions. */
(function(root){
  'use strict';
  const motorKinds=new Set(['lane','street','avenue','highway','motorway']);
  const laneCounts={lane:2,street:2,avenue:4,highway:4,motorway:6};
  const surfaces={path:'#d9d1bb',lane:'#a9b2a6',street:'#98a49b',avenue:'#8b9b92',highway:'#98a291',motorway:'#8d9b8a'};
  const measurements=new WeakMap(),plans=new WeakMap();

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
    return points.map((p,i)=>{
      const before=points[Math.max(0,i-1)],after=points[Math.min(points.length-1,i+1)];
      const dx=after[0]-before[0],dy=after[1]-before[1],length=Math.hypot(dx,dy)||1;
      return [p[0]-dy/length*offset,p[1]+dx/length*offset];
    });
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
    return [point[0],point[1]-.28*roadHeight(road,nearestDistance(road.points,point),layout)];
  }
  function projectPath(points,road,layout){
    if(road.level===0)return points;
    const length=measure(points).length,distances=new Set(measure(points).distances);
    for(let d=0;d<length;d+=3)distances.add(d);
    return [...distances].sort((a,b)=>a-b).map(d=>projectPoint(sample(points,d).point,road,layout));
  }
  function surfaceRoad(road,layout){
    if(road.level===0)return road;
    if(layout.surfaces.has(road.id))return layout.surfaces.get(road.id);
    const length=measure(road.points).length,distances=new Set(measure(road.points).distances);
    for(let d=0;d<length;d+=3)distances.add(d);
    const samples=[...distances].sort((a,b)=>a-b).map(d=>{const p=sample(road.points,d).point;return {point:p,height:roadHeight(road,d,layout)};});
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
    const result={...road,points:samples.map(s=>[s.point[0],s.point[1]-.28*s.height]),elevationSamples:samples,
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
  function paintConnections(ctx,state,scale,layout,joins){
    for(const j of joins){
      ctx.save();clipJoin(ctx,j);
      const ids=new Set(j.approaches.map(a=>a.road));
      const local=state.roads.filter(r=>ids.has(r.id)).map(r=>surfaceRoad(r,layout));
      // One outline pass and one pavement pass across both levels removes
      // terminal caps and cuts openings through the receiving road's curb.
      root.CityScene.roadSurfaces(ctx,local,state.roadTypes,scale,0,{shadows:false});
      paintCorners(ctx,{junctions:[{...j,approaches:j.approaches.map(a=>({...a,level:0}))}]});
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
    let distance=arm.width/2+2;
    for(const other of approaches){
      if(other===arm)continue;
      const cross=Math.abs(arm.tangent[0]*other.tangent[1]-arm.tangent[1]*other.tangent[0]);
      const dot=Math.abs(arm.tangent[0]*other.tangent[0]+arm.tangent[1]*other.tangent[1]);
      if(cross>.05)distance=Math.max(distance,(other.width/2+arm.width/2*dot)/cross+2);
    }
    return distance;
  }
  function buildPlan(roads,network,roadTypes){
    if(plans.has(network))return plans.get(network);
    const roadMap=new Map(roads.map(r=>[r.id,r])),arrows=[],crosswalks=[],stopLines=[],signals=[],pedestrianSignals=[];
    const gaps=new Map(roads.map(r=>[r.id,[]]));
    const junctions=network.junctions||[];
    const roadJunctions=new Map();
    for(const junction of junctions)for(const arm of junction.approaches){
      if(!roadJunctions.has(arm.road))roadJunctions.set(arm.road,new Set());
      roadJunctions.get(arm.road).add(arm.distance);
    }
    const addArrow=(road,distance,direction,offset,turns)=>{
      const at=sample(road.points,distance),travel=at.tangent.map(v=>v*direction);
      arrows.push({road:road.id,level:road.level,point:[at.point[0]-travel[1]*offset,at.point[1]+travel[0]*offset],travel,turns,laneWidth:roadTypes[road.kind].width/laneCounts[road.kind]});
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
        const end=arm.distance+arm.direction*Math.min(available,clearance+6);
        gaps.get(road.id).push([Math.min(arm.distance,end),Math.max(arm.distance,end)]);
        if(room<clearance+14)continue;
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
            const lateral=side*(arm.width/2+1.35);
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
            const count=road.oneway?laneCounts[road.kind]:laneCounts[road.kind]/2,laneWidth=arm.width/laneCounts[road.kind];
            const heads=Array.from({length:count},(_,lane)=>{
              const lateral=road.oneway?-arm.width/2+(lane+.5)*laneWidth:(lane+.5)*laneWidth;
              const d=lateral*Math.min(1,span/arm.width);
              return [center[0]+mountTangent[1]*d,center[1]-mountTangent[0]*d];
            });
            const support=[center[0]+mountTangent[1]*(span/2+1.8),center[1]-mountTangent[0]*(span/2+1.8)];
            signals.push({...stopFurniture,kind:'vehicle',point:heads[0],heads,support,height:5.8,faceDirection:t,
              stopPoint:stop.point,placement,center,mountTangent});
          }
          const turns=turnsFor(arm,junction.approaches),count=road.oneway?laneCounts[road.kind]:laneCounts[road.kind]/2;
          const laneWidth=arm.width/laneCounts[road.kind];
          for(let lane=0;lane<count;lane++){
            const allowed=turns.filter(turn=>turn==='straight'||count===1||turn==='left'&&lane===0||turn==='right'&&lane===count-1);
            if(!allowed.length)continue;
            const offset=road.oneway?-arm.width/2+(lane+.5)*laneWidth:(lane+.5)*laneWidth;
            addArrow(road,arm.distance+arm.direction*(clearance+18),-arm.direction,offset,allowed);
          }
        }
      }
    }
    const centerlines=[],medians=[];
    for(const road of roads){
      if(!motorKinds.has(road.kind))continue;
      const length=measure(road.points).length,width=roadTypes[road.kind].width;
      const ranges=gaps.get(road.id).slice().sort((a,b)=>a[0]-b[0]);
      const free=[];let cursor=0;
      for(const [a,b] of ranges){if(a>cursor)free.push([cursor,a]);cursor=Math.max(cursor,b);}
      if(cursor<length)free.push([cursor,length]);
      for(const [a,b] of free){
        if(b-a>5&&road.kind==='avenue'&&!road.oneway&&road.level===0)medians.push({road:road.id,points:slice(road.points,a>0?a+2:a,b<length?b-2:b)});
        const count=laneCounts[road.kind],laneWidth=width/count;
        if(road.kind!=='lane')for(let lane=1;lane<count;lane++){
          if(!road.oneway&&lane===count/2&&b-a<10)continue;
          const offset=-width/2+lane*laneWidth;
          centerlines.push({road:road.id,level:road.level,median:!road.oneway&&lane===count/2,
            points:offsetPath(slice(road.points,a,b),offset)});
        }
        for(let d=a+35;d<b-24;d+=95){
          for(const direction of road.oneway?[1]:[1,-1])for(let lane=0;lane<(road.oneway?count:count/2);lane++){
            const offset=road.oneway?-width/2+(lane+.5)*laneWidth:(lane+.5)*laneWidth;
            addArrow(road,d,direction,offset,['straight']);
          }
        }
      }
    }
    const guides=[];
    for(const j of junctions){
      const visited=new Set();
      for(const arm of j.approaches){
        if(visited.has(arm.road)||arm.level!==0||!motorKinds.has(arm.kind))continue;
        const opposite=j.approaches.find(a=>a.road===arm.road&&a.direction!==arm.direction);
        if(!opposite)continue;visited.add(arm.road);
        const road=roadMap.get(arm.road),extent=Math.max(...j.approaches.map(a=>a.width))/2-.6,count=laneCounts[road.kind],width=roadTypes[road.kind].width;
        const points=slice(road.points,Math.max(0,arm.distance-extent),Math.min(measure(road.points).length,arm.distance+extent));
        for(let lane=1;lane<count;lane++)if(lane!==count/2||road.oneway)guides.push({points:offsetPath(points,-width/2+lane*width/count)});
      }
    }
    const result={arrows,crosswalks,stopLines,signals,pedestrianSignals,centerlines,medians,guides};plans.set(network,result);return result;
  }

  function junctionCorners(network){
    const result=[];
    for(const j of network.junctions||[]){
      const arms=j.approaches.filter(a=>a.level===0&&motorKinds.has(a.kind)).slice().sort((a,b)=>Math.atan2(a.tangent[1],a.tangent[0])-Math.atan2(b.tangent[1],b.tangent[0]));
      for(let i=0;i<arms.length;i++){
        const a=arms[i],b=arms[(i+1)%arms.length],u=a.tangent,v=b.tangent,cross=u[0]*v[1]-u[1]*v[0],dot=u[0]*v[0]+u[1]*v[1];
        if(cross<.25||dot<-.93)continue;
        const p=[j.point[0]-u[1]*a.width/2,j.point[1]+u[0]*a.width/2],q=[j.point[0]+v[1]*b.width/2,j.point[1]-v[0]*b.width/2];
        const t=((q[0]-p[0])*v[1]-(q[1]-p[1])*v[0])/cross,corner=[p[0]+u[0]*t,p[1]+u[1]*t],radius=Math.min(6,Math.min(a.width,b.width)*.35);
        if(Math.hypot(corner[0]-j.point[0],corner[1]-j.point[1])>65)continue;
        result.push({corner,radius,from:[corner[0]+u[0]*radius,corner[1]+u[1]*radius],to:[corner[0]+v[0]*radius,corner[1]+v[1]*radius],road:a.road});
      }
    }return result;
  }
  function paintCorners(ctx,network){
    for(const {corner,from,to,road} of junctionCorners(network)){
      ctx.beginPath();ctx.moveTo(...corner);ctx.lineTo(...from);ctx.quadraticCurveTo(...corner,...to);ctx.closePath();
      ctx.fillStyle=ctx.strokeStyle=root.CityScene.material(ctx,'asphalt',root.CityScene.seed(road));ctx.lineWidth=1.05;ctx.fill();ctx.stroke();
      ctx.beginPath();ctx.moveTo(...from);ctx.quadraticCurveTo(...corner,...to);ctx.strokeStyle=root.CityScene.material(ctx,'curb',0);ctx.lineWidth=.38;ctx.stroke();
    }
  }
  function arrowPolygons(turns,laneWidth=7){
    // Long painted stem, solid heads and forward-swept branches. The common
    // stem is drawn once, so a shared lane never becomes a four-way diamond.
    const lateral=Math.min(1,(laneWidth/2-.45)/2.5),parts=[];
    parts.push([[-5.6,-.25],[.3,-.25],[.3,.25],[-5.6,.25]]);
    if(turns.includes('straight'))parts.push([[.1,-.25],[3,-.25],[3,-.85],[5.4,0],[3,.85],[3,.25],[.1,.25]]);
    for(const turn of turns)if(turn!=='straight'){
      const side=turn==='left'?-1:1,outer=[],inner=[];
      // A quarter-circle elbow gives turn markings the familiar hooked shape.
      for(let i=0;i<=8;i++){const a=Math.PI/2-i*Math.PI/16;outer.push([-.1+1.3*Math.cos(a),1.1-1.3*Math.sin(a)]);inner.push([-.1+.9*Math.cos(a),1.1-.9*Math.sin(a)]);}
      parts.push([[-1.8,-.2],...outer,[1.2,1.6],[.8,1.6],...inner.reverse(),[-1.8,.2]].map(([x,y])=>[x,y*side]));
      parts.push([[.25,1.4],[1,3],[1.75,1.4]].map(([x,y])=>[x,y*side]));
    }
    return parts.map(poly=>poly.map(([x,y])=>[x*.72,y*.82*Math.max(.35,lateral)]));
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
    const unit=Math.max(pedestrian?.22:.24,(pedestrian?3.4:4)/scale);
    return {unit,compact,width:compact?5.5/scale:(pedestrian?2.2:2)*unit,height:compact?5.5/scale:(pedestrian?4.6:5.6)*unit};
  }
  function signalFaces(item,scale=Infinity){
    const heads=item.heads||[item.point];
    // One state marker per approach at city scale; lane heads return together
    // when their full three-lens housings fit between neighbouring lanes.
    return scale<4.5&&heads.length>1?[heads.reduce((p,q)=>p.map((v,i)=>v+q[i]/heads.length),[0,0])]:heads;
  }
  function signalProjection(point,height){return [point[0],point[1]-height*.28];}
  function paintSignals(ctx,plan,{scale,visible=()=>true,traffic=null,level=null,night=0,solid=false}){
    if(scale<.45)return;
    const live=new Map((traffic?.signals||[]).map(s=>[s.id,s]));
    for(const item of [...plan.signals,...plan.pedestrianSignals]){
      if(level!==null&&item.level!==level||!visible(item.point))continue;
      const pedestrian=item.kind==='pedestrian',lit=signalState(item,live);
      const {unit,width,height,compact}=signalDimensions(item.kind,scale);
      if(compact&&pedestrian)continue;
      const mount=item.height||(pedestrian?2.3:5.8),faces=signalFaces(item,scale),support=item.support||item.point;
      if(!night&&!solid){
        const top=signalProjection(support,mount),end=signalProjection(faces[0],mount);
        ctx.strokeStyle='#687471';ctx.lineWidth=Math.max(.13,.65/scale);ctx.beginPath();ctx.moveTo(...support);ctx.lineTo(...top);ctx.lineTo(...end);ctx.stroke();
      }
      for(const face of faces){
      if(compact){
        const point=signalProjection(face,mount),radius=width/2;
        ctx.save();ctx.translate(...point);
        if(night){const glow=ctx.createRadialGradient(0,0,radius*.4,0,0,radius*2);glow.addColorStop(0,lampColors[lit]+'70');glow.addColorStop(1,lampColors[lit]+'00');ctx.globalAlpha=night;ctx.fillStyle=glow;ctx.fillRect(-radius*2,-radius*2,radius*4,radius*4);}
        else {ctx.beginPath();ctx.arc(0,0,radius,0,Math.PI*2);ctx.fillStyle='#172426';ctx.fill();ctx.strokeStyle='#c3c9b9';ctx.lineWidth=.6/scale;ctx.stroke();ctx.beginPath();ctx.arc(0,0,radius*.65,0,Math.PI*2);ctx.fillStyle=lampColors[lit];ctx.fill();}
        ctx.restore();continue;
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
    const projected=(points,id)=>{const r=layout.roadMap.get(id);return r&&r.level!==0?(points.length===1?[projectPoint(points[0],r,layout)]:projectPath(points,r,layout)):points;};
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
      if(level===0&&stage!=='details'&&root.CityScene)paintCorners(ctx,network);
      if((level===1||level===0)&&root.CityScene&&stage!=='details'){
        const joins=layout.joins.filter(j=>j.approaches.some(a=>a.level===(level===1?1:-1))&&inView([[j.point[0]-j.extent,j.point[1]-j.extent],[j.point[0]+j.extent,j.point[1]+j.extent]]));
        paintConnections(ctx,state,scale,layout,joins);
        for(const j of level===1?joins:[]){ctx.save();clipJoin(ctx,j);paint(ctx,state,{scale,selected:null,inView,visible,traffic:null,stage:'details',vehicles:false,signals:false,levels:[0]});ctx.restore();}
      }
      if(stage!=='surface'&&root.RailRenderer)root.RailRenderer.paint(ctx,visibleRoads.map(r=>surfaceRoad(r,layout)),scale,{visible,contextRoads:roads.filter(r=>root.RailRenderer.isRail(r)).map(r=>surfaceRoad(r,layout))});
      if(stage==='surface')continue;
      if(scale>=.2){
        ctx.lineWidth=Math.max(.35,.55/scale);ctx.setLineDash([4,6]);
        for(const line of plan.centerlines)if(line.level===level&&inView(line.points)){
          ctx.strokeStyle=root.CityScene?.material(ctx,line.median?'markingYellow':'marking',root.CityScene.seed(line.road))||(line.median?'#e6bf56':'#ecede3');
          if(line.median){
            ctx.setLineDash([]);ctx.lineWidth=Math.max(.18,.4/scale);
            for(const offset of [-.3,.3]){path(projected(offsetPath(line.points,offset),line.road));ctx.stroke();}
            ctx.lineWidth=Math.max(.35,.55/scale);ctx.setLineDash([4,6]);
          }else{path(projected(line.points,line.road));ctx.stroke();}
        }
        ctx.setLineDash([]);
      }
      if(level===0&&scale>=.65){
        ctx.strokeStyle='#e2e1d49c';ctx.lineWidth=.14;ctx.setLineDash([1.7,2.2]);
        for(const line of plan.guides)if(inView(line.points)){path(projected(line.points,line.road));ctx.stroke();}
        ctx.setLineDash([]);
      }
      if(scale>=.45){
        for(const item of plan.crosswalks)if(item.level===level&&visible(item.point))local(item,()=>{
          ctx.fillStyle=root.CityScene?.material(ctx,'marking',root.CityScene.seed(item.road))||'#fffdf0';for(let y=-item.width/2+.7;y<item.width/2-.6;y+=1.35)ctx.fillRect(-2,y,4,.7);
        });
        for(const item of plan.stopLines)if(item.level===level&&visible(item.point))local(item,()=>{
          ctx.fillStyle=root.CityScene?.material(ctx,'marking',root.CityScene.seed(item.road))||'#fffdf0';const a=-item.width/2+.5,b=item.oneway?item.width/2-.5:-.4;ctx.fillRect(-.4,a,.8,b-a);
        });
        for(const item of plan.arrows)if(item.level===level&&visible(item.point))arrow(item);
        if(signals)paintSignals(ctx,plan,{scale,visible,traffic,level});
      }
      for(const car of vehicles?traffic?.vehicles||[]:[])if((car.level===level||level===1&&upperVehicle(car,layout))&&visible(car.point)){
        if(root.CityScene){root.CityScene.vehicle(ctx,{...car,point:[car.point[0],car.point[1]-.28*vehicleHeight(car,layout)]},scale);continue;}
        ctx.save();ctx.translate(...car.point);ctx.rotate(car.heading);
        ctx.fillStyle='#203c3240';ctx.fillRect(-2.25+.6,-.95+.6,4.5,1.9);
        ctx.fillStyle=['#f4cf80','#81bcc7','#e8e7df','#d79e81'][car.id%4];ctx.fillRect(-2.25,-.95,4.5,1.9);
        ctx.fillStyle='#405d63';ctx.fillRect(.35,-.7,.8,1.4);
        ctx.fillStyle=car.speed<.2?'#f7604d':'#b66d51';ctx.fillRect(-2.3,-.8,.35,.45);ctx.fillRect(-2.3,.35,.35,.45);ctx.restore();
      }
      for(const road of visibleRoads)if(road.id===selected){path(surfaceRoad(road,layout).points);ctx.strokeStyle='#d78b39';ctx.lineWidth=2/scale;ctx.stroke();}
    }
    ctx.restore();
  }
  const api={connections,nearestDistance,roadHeight,projectPoint,projectPath,surfaceRoad,upperVehicle,vehicleHeight,slice,clipJoin,sample,turnsFor,buildPlan,junctionCorners,arrowPolygons,signalState,signalDimensions,signalFaces,signalProjection,paintSignals,paint};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.RoadRenderer=api;
})(typeof window==='undefined'?{}:window);
