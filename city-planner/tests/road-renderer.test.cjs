const test=require('node:test');
const assert=require('node:assert/strict');
const {sample,turnsFor,buildPlan,roadSurfaceDetails,arrowPolygons,signalState,signalDimensions,signalFaces,signalProjection}=require('../renderer/road-renderer.js');

const roadTypes={street:{width:14,walk:true},avenue:{width:24,walk:true},highway:{width:30,walk:false},path:{width:4,walk:true}};
function crossing(kinds=['avenue','street']){
  const roads=[{id:'east-west',points:[[-200,0],[200,0]],kind:kinds[0],level:0,oneway:false},
    {id:'north-south',points:[[0,-200],[0,200]],kind:kinds[1],level:0,oneway:false}];
  const approaches=roads.flatMap(r=>[-1,1].map(direction=>({road:r.id,kind:r.kind,width:roadTypes[r.kind].width,
    level:0,distance:200,direction,tangent:r.id==='east-west'?[direction,0]:[0,direction],incoming:true,outgoing:true})));
  return {roads,network:{junctions:[{id:'crossing',point:[0,0],approaches,control:'signals',crossings:true}]}};
}

test('T junction arrows offer real turns and exclude a missing straight exit',()=>{
  const arms=[{tangent:[0,1],incoming:true,outgoing:true,kind:'street'},
    {tangent:[-1,0],incoming:true,outgoing:true,kind:'street'},
    {tangent:[1,0],incoming:true,outgoing:true,kind:'street'}];
  assert.deepEqual(turnsFor(arms[0],arms),['left','right']);
  arms[1].outgoing=false;
  assert.deepEqual(turnsFor(arms[0],arms),['right']);
  arms[2].kind='path';
  assert.deepEqual(turnsFor(arms[0],arms),[]);
});

test('a real crossroad generates crossings, stop lines, signals and inbound lane arrows',()=>{
  const {roads,network}=crossing(),plan=buildPlan(roads,network,roadTypes);
  assert.equal(plan.crosswalks.length,4);assert.equal(plan.signals.length,4);assert.equal(plan.stopLines.length,4);
  const west=plan.arrows.filter(a=>a.road==='east-west'&&a.point[0]<0&&a.turns.length>1);
  assert.equal(west.length,2);
  assert.deepEqual(west.map(a=>a.turns),[['left','straight'],['straight','right']]);
  assert(west.every(a=>a.travel[0]>0&&a.point[1]>0));
  for(const line of plan.centerlines)assert(line.points.every(([x,y])=>Math.abs(x)>18||Math.abs(y)>18));
});

test('one-way approaches do not draw inbound arrows or lights on their departure side',()=>{
  const {roads,network}=crossing();roads[0].oneway=true;
  for(const arm of network.junctions[0].approaches.filter(a=>a.road===roads[0].id)){
    arm.incoming=arm.direction===-1;arm.outgoing=arm.direction===1;
  }
  const plan=buildPlan(roads,network,roadTypes);
  assert(plan.arrows.filter(a=>a.road===roads[0].id).every(a=>a.travel[0]>0));
  assert.equal(plan.signals.filter(s=>s.road===roads[0].id).length,1);
  const north=network.junctions[0].approaches.find(a=>a.tangent[1]===-1);
  assert.deepEqual(turnsFor(north,network.junctions[0].approaches),['left','straight']);
});

test('slightly bent through roads retain markings and furniture at T and four-way junctions',()=>{
  for(const branches of [1,2])for(const rotation of [0,Math.PI/4]){
    const bend=.077,angles=[Math.PI,bend,-Math.PI/2,...(branches===2?[Math.PI/2]:[])];
    const roads=angles.map((angle,i)=>({id:`arm-${i}`,kind:'street',level:0,oneway:false,
      points:[[0,0],[165*Math.cos(angle+rotation),165*Math.sin(angle+rotation)]]}));
    const approaches=roads.map(r=>({road:r.id,kind:r.kind,width:14,level:0,distance:0,direction:1,
      tangent:r.points[1].map(v=>v/165),incoming:true,outgoing:true}));
    const network={junctions:[{id:'bent-crossing',point:[0,0],approaches,control:'signals',crossings:true}]};
    const plan=buildPlan(roads,network,roadTypes);
    assert.equal(plan.crosswalks.length,roads.length);
    assert.equal(plan.stopLines.length,roads.length);
    assert.equal(plan.signals.length,roads.length);
    for(const road of roads){
      const lines=plan.centerlines.filter(l=>l.road===road.id);
      assert(lines.length>0,'a slight bend must not erase an entire road centreline');
      assert(Math.hypot(...lines[0].points[0])<20,'markings resume just beyond the junction');
      assert(plan.arrows.some(a=>a.road===road.id&&a.turns.length>1&&Math.hypot(...a.point)<40),
        'each incoming approach retains its nearby turn arrow');
    }
  }
});

test('genuine acute forks still reserve the overlapping pavement before markings',()=>{
  const angle=Math.PI/6;
  const roads=[0,angle,Math.PI].map((a,i)=>({id:`fork-${i}`,kind:'street',level:0,oneway:false,
    points:[[0,0],[200*Math.cos(a),200*Math.sin(a)]]}));
  const approaches=roads.map(r=>({road:r.id,kind:r.kind,width:14,level:0,distance:0,direction:1,
    tangent:r.points[1].map(v=>v/200),incoming:true,outgoing:true}));
  const plan=buildPlan(roads,{junctions:[{id:'fork',point:[0,0],approaches,crossings:true}]},roadTypes);
  for(const road of roads.slice(0,2)){
    const line=plan.centerlines.find(l=>l.road===road.id);
    assert(Math.hypot(...line.points[0])>30,'acute branches still need a longer clearance');
  }
});

test('separate bridge crossings and ordinary frontage cuts create no junction furniture',()=>{
  const {roads}=crossing();roads[1].level=1;
  const plan=buildPlan(roads,{junctions:[],nodes:{frontage:[20,0]}},roadTypes);
  assert.equal(plan.signals.length,0);assert.equal(plan.crosswalks.length,0);assert.equal(plan.stopLines.length,0);
  assert(plan.arrows.length>0);
});

test('short approaches suppress furniture that would overlap the neighbouring junction',()=>{
  const {roads,network}=crossing();
  roads.forEach(r=>{r.points=r.points.map(p=>p.map(v=>v/20));});
  network.junctions[0].approaches.forEach(a=>a.distance=10);
  const plan=buildPlan(roads,network,roadTypes);
  assert.equal(plan.arrows.length,0);assert.equal(plan.crosswalks.length,0);assert.equal(plan.signals.length,0);
});

test('arc-length sampling follows polyline bends and tolerates repeated terminal points',()=>{
  const points=[[0,0],[30,0],[30,40],[30,40]];
  assert.deepEqual(sample(points,50),{point:[30,20],tangent:[0,1]});
  assert.deepEqual(sample(points,100),{point:[30,40],tangent:[0,1]});
});

test('road wear stays anchored in metres across cache pieces and preserves the carriageway',()=>{
  const road={road:'surface-variation',source:[[0,0],[1024,0]],width:14,laneWidth:7},run={start:0,end:1024},before=JSON.stringify(road);
  const normalize=items=>items.map(({points,color,width,closed})=>JSON.stringify({points,color,width,closed})).sort();
  for(const side of [-1,1]){
    const whole=roadSurfaceDetails(road,run,0,1024,side),pieces=Array.from({length:32},(_,i)=>roadSurfaceDetails(road,run,i*32,(i+1)*32,side));
    for(const kind of ['wear','patches','seals']){
      assert.deepEqual(normalize(pieces.flatMap(p=>p[kind])),normalize(whole[kind]),'32 m cache boundaries must not duplicate or crop fixed world details');
      for(const shape of whole[kind])for(const [x,y] of shape.points){
        assert(x>=1.4&&x<=1024-1.4,'keep the junction/end clearance');
        assert(y*side>0&&y*side<7,'surface detail remains inside its own road edge');
        if(kind==='patches')assert(y*side<6.5,'repair patches keep clear of the white edge marking');
      }
    }
    assert(whole.wear.length>10&&whole.patches.length>0&&whole.seals.length>0);
    const shifted=roadSurfaceDetails(road,{start:5,end:1019},96,128,side);
    for(const kind of ['wear','patches','seals'])assert.deepEqual(normalize(shifted[kind]),normalize(pieces[3][kind]),'a different junction run split must not move nearby marks');
    let comparisons=0;
    for(let i=1;i<pieces.length;i++)if(pieces[i-1].wear.length&&pieces[i].wear.length){
      const relative=(part,start)=>normalize(part.wear.map(shape=>({...shape,points:shape.points.map(([x,y])=>[x-start,y])})));
      assert.notDeepEqual(relative(pieces[i-1],(i-1)*32),relative(pieces[i],i*32),'neighbouring pieces must not repeat a translated pattern');comparisons++;
    }
    assert(comparisons>4);
    assert.notDeepEqual(normalize(whole.wear),normalize(roadSurfaceDetails({...road,road:'another-road'},run,0,1024,side).wear),'each road gets its own pattern');
  }
  assert.equal(JSON.stringify(road),before,'decorative variation does not mutate road geometry');
});

test('each zebra has two independent pedestrian heads, clear of vehicle heads at rotated crossroads',()=>{
  for(const degrees of [0,27,45,90,135]){
    const {roads,network}=crossing(),angle=degrees*Math.PI/180;
    const rotate=([x,y])=>[x*Math.cos(angle)-y*Math.sin(angle),x*Math.sin(angle)+y*Math.cos(angle)];
    for(const r of roads)r.points=r.points.map(rotate);
    for(const a of network.junctions[0].approaches)a.tangent=rotate(a.tangent);
    const plan=buildPlan(roads,network,roadTypes);
    assert.equal(plan.pedestrianSignals.length,8);
    for(const zebra of plan.crosswalks){
      const pair=plan.pedestrianSignals.filter(s=>s.approach===zebra.approach);
      assert.deepEqual(pair.map(s=>s.side),[-1,1]);
      for(const s of pair){
        const d=s.point.map((v,i)=>v-zebra.point[i]),lateral=-d[0]*zebra.tangent[1]+d[1]*zebra.tangent[0];
        assert(Math.abs(lateral)>zebra.width/2);assert.equal(Math.sign(lateral),s.side);
      }
    }
    const heads=[...plan.signals,...plan.pedestrianSignals];
    for(const scale of [1.5,2.5,5])for(let i=0;i<heads.length;i++)for(let j=i+1;j<heads.length;j++){
      const a=heads[i],b=heads[j],sa=signalDimensions(a.kind,scale),sb=signalDimensions(b.kind,scale);
      assert(Math.abs(a.point[0]-b.point[0])>(sa.width+sb.width)/2||Math.abs(a.point[1]-b.point[1])>(sa.height+sb.height)/2,`overlapping heads at ${degrees} degrees, scale ${scale}`);
    }
  }
});

test('vehicle and pedestrian lenses read their own authoritative state including the initial frame',()=>{
  const {roads,network}=crossing();network.junctions[0].signal={initial:{lamps:{'east-west:-1':'yellow'},pedestrian:'red'}};
  const plan=buildPlan(roads,network,roadTypes),vehicle=plan.signals.find(s=>s.approach==='east-west:-1'),pedestrian=plan.pedestrianSignals[0];
  assert.equal(signalState(vehicle,null),'yellow');assert.equal(signalState(pedestrian,null),'red');
  const traffic={signals:[{id:'crossing',lamps:Object.fromEntries(plan.signals.map(s=>[s.approach,'red'])),pedestrian:'green'}]};
  assert(plan.signals.every(s=>signalState(s,traffic)==='red'));
  assert(plan.pedestrianSignals.every(s=>signalState(s,traffic)==='green'));
  const uncontrolled=crossing();uncontrolled.network.junctions[0].control='priority';
  assert.equal(buildPlan(uncontrolled.roads,uncontrolled.network,roadTypes).pedestrianSignals.length,0);
});

test('filled direction markings have a long shared stem, mirrored turns, and stay in narrow lanes',()=>{
  const left=arrowPolygons(['left']),right=arrowPolygons(['right']);
  assert.deepEqual(left[1].map(([x,y])=>[x,-y]),right[1]);
  for(const turns of [['straight'],['left'],['right'],['left','right'],['left','straight','right']])for(const width of [4,6,7]){
    const points=arrowPolygons(turns,width).flat(),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    assert(Math.max(...ys)-Math.min(...ys)<width-.5);
    assert(Math.max(...xs)-Math.min(...xs)>4.5);
    assert(points.every(p=>p.every(Number.isFinite)));
  }
});


test('rounded junction corners follow the two road edges without reaching bridge levels',()=>{
  const {network}=crossing();
  const {junctionCorners}=require('../renderer/road-renderer.js'),corners=junctionCorners(network);
  assert.equal(corners.length,4);
  for(const c of corners){
    assert(c.radius>0&&c.radius<=6);
    assert(Math.abs(c.corner[0])===7&&Math.abs(c.corner[1])===12);
    assert.equal(Math.round(Math.hypot(c.from[0]-c.corner[0],c.from[1]-c.corner[1])*100),Math.round(c.radius*100));
  }
  network.junctions[0].approaches.forEach(a=>a.level=1);
  assert.equal(junctionCorners(network).length,0);
});

test('curved junction bands meet actual road edges and keep the local approach tangents',()=>{
  const api=require('../renderer/road-renderer.js'),{roads,network}=crossing(),before=JSON.stringify(roads);
  roads[0].points=[[-200,8],[-30,3],[-8,.3],[0,0],[8,.3],[30,4],[200,50]];
  roads[1].points=[[-9,-200],[-.3,-8],[0,0],[.3,8],[30,200]];
  for(const road of roads){
    const distance=api.nearestDistance(road.points,[0,0]);
    for(const arm of network.junctions[0].approaches.filter(a=>a.road===road.id)){
      arm.distance=distance;arm.tangent=sample(road.points,distance+arm.direction*.001).tangent.map(v=>v*arm.direction);
    }
  }
  const geometry=JSON.stringify(roads),corners=api.junctionCorners(network,roads),old=api.junctionCorners(network);
  assert.equal(corners.length,4);
  assert(corners.some((c,i)=>Math.hypot(c.from[0]-old[i].from[0],c.from[1]-old[i].from[1])>.05),'fixture must expose the old tangent extrapolation error');
  const cross=(a,b)=>a[0]*b[1]-a[1]*b[0],dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
  for(const c of corners){
    for(const [index,roadId,edge,tangent,control,side,kind] of [[0,c.road,c.from,c.u,c.controls[0],1,c.kind],[1,c.nextRoad,c.to,c.v,c.controls[1],-1,c.nextKind]]){
      const road=roads.find(r=>r.id===roadId),anchor=c.anchors[index],source=sample(road.points,anchor.distance),direction=dot(source.tangent,tangent)>0?1:-1;
      const out=source.tangent.map(n=>n*direction),normal=[-out[1]*side,out[0]*side],half=roadTypes[kind].width/2;
      assert(Math.abs(dot(edge.map((n,k)=>n-source.point[k]),normal)-half)<1e-9,'asphalt endpoint lies on the real source stroke edge');
      assert(Math.abs(cross(control.map((n,k)=>n-edge[k]),out))<1e-9,'curve control retains the source segment tangent');
      assert(dot(control.map((n,k)=>n-edge[k]),out)<0);
      for(const band of ['sidewalk','promenade','innerWalk','curb','gutter','surface']){
        const boundary=api.cornerBoundary(c,band),at=boundary[index===0?1:boundary.length-2],extended=index===0?boundary[0]:boundary.at(-1),offset=half+api.roadCrossSection(kind)[band];
        const expected=source.point.map((n,k)=>n+normal[k]*offset);
        assert(Math.hypot(at[0]-expected[0],at[1]-expected[1])<1e-9,band+' must share the road cross section');
        const extendedExpected=expected.map((n,k)=>n+out[k]*c.extensions[index]);
        assert(Math.hypot(extended[0]-extendedExpected[0],extended[1]-extendedExpected[1])<1e-9,'overlap follows the actual segment, without pixel padding');
      }
    }
  }
  assert.equal(JSON.stringify(roads),geometry,'the corner correction remains display-only');assert.notEqual(geometry,before);
});

test('different sidewalk widths blend with tangent continuity and non-reversing inner edges',()=>{
  const api=require('../renderer/road-renderer.js'),{network,roads}=crossing(),corners=api.junctionCorners(network,roads);
  for(const c of corners)for(const band of ['sidewalk','promenade','innerWalk','curb','gutter','surface']){
    const points=api.cornerBoundary(c,band,2048).slice(1,-1),first=points[1].map((n,k)=>n-points[0][k]),last=points.at(-1).map((n,k)=>n-points.at(-2)[k]);
    const alignment=(v,t)=>Math.abs(v[0]*t[1]-v[1]*t[0])/Math.hypot(...v);
    assert(alignment(first,c.u)<.004,band+' starts tangent to the first road');assert(alignment(last,c.v)<.004,band+' finishes tangent to the second road');
    for(let i=1;i<points.length;i++){
      const movement=points[i].map((n,k)=>n-points[i-1][k]),forward=[-c.u[0]+c.v[0],-c.u[1]+c.v[1]];
      assert(movement[0]*forward[0]+movement[1]*forward[1]>0,'an offset boundary must not curl back into itself');
    }
  }
});

test('straight surface passes use the same cross section as corner bands',()=>{
  const scene=require('../renderer/scene-renderer.js'),api=require('../renderer/road-renderer.js'),previous=scene.settings;
  scene.configure({quality:'map'});
  try{
    for(const kind of ['street','avenue']){
      const widths=[],ctx=new Proxy({stroke(){widths.push(this.lineWidth);}},{get:(target,key)=>target[key]||(()=>{}),set:(target,key,value)=>(target[key]=value,true)});
      scene.roadSurfaces(ctx,[{id:'section-'+kind,kind,level:0,points:[[0,0],[100,0]]}],roadTypes,38,0,{shadows:false});
      assert.deepEqual(widths,['sidewalk','promenade','innerWalk','curb','gutter','surface'].map(band=>roadTypes[kind].width+api.roadCrossSection(kind)[band]*2));
    }
  }finally{scene.configure(previous);}
});

test('floating point residue at a terminal junction cannot create a planted island inside it',()=>{
  const {roads,network}=crossing();const r=roads[0];r.points=[[-200,0],[0,0]];
  network.junctions[0].approaches=network.junctions[0].approaches.filter(a=>a.road!==r.id||a.direction===-1);
  network.junctions[0].approaches.find(a=>a.road===r.id).distance=200-1e-12;
  const medians=buildPlan(roads,network,roadTypes).medians.filter(m=>m.road===r.id);
  assert.equal(medians.length,1);
  assert(medians[0].points.every(p=>p[0]<-15));
});

test('vehicle mast heads are ahead of the stop line, facing each incoming lane from the far side',()=>{
  for(const degrees of [0,27,90,135]){
    const {roads,network}=crossing(),angle=degrees*Math.PI/180,rotate=([x,y])=>[x*Math.cos(angle)-y*Math.sin(angle),x*Math.sin(angle)+y*Math.cos(angle)];
    for(const r of roads)r.points=r.points.map(rotate);
    for(const a of network.junctions[0].approaches)a.tangent=rotate(a.tangent);
    const plan=buildPlan(roads,network,roadTypes);
    for(const s of plan.signals){
      assert.equal(s.placement,'far');assert.equal(s.height,5.8);
      const forward=s.tangent.map(v=>-v),delta=s.center.map((v,i)=>v-s.stopPoint[i]);
      assert(delta[0]*forward[0]+delta[1]*forward[1]>20);
      assert(s.faceDirection[0]*forward[0]+s.faceDirection[1]*forward[1]<-.999);
      const support=s.support.map((v,i)=>v-s.center[i]);
      assert(-support[0]*s.tangent[1]+support[1]*s.tangent[0]<-s.width/2);
      assert.equal(s.heads.length,s.road==='east-west'?2:1);
      for(const head of s.heads){
        const d=head.map((v,i)=>v-s.center[i]),lane=-d[0]*s.tangent[1]+d[1]*s.tangent[0];
        assert(lane<0&&Math.abs(lane)<s.width/2);
      }
    }
  }
});

test('T junction fallback stays ahead of the driver and does not put a far-side mast into a building lot',()=>{
  const {roads,network}=crossing();roads[1].points=[[0,-200],[0,0]];
  network.junctions[0].approaches=network.junctions[0].approaches.filter(a=>a.road!=='north-south'||a.direction===-1);
  const signal=buildPlan(roads,network,roadTypes).signals.find(s=>s.road==='north-south');
  assert.equal(signal.placement,'near');assert(signal.center[1]>signal.stopPoint[1]);assert(signal.center[1]<0);
  const {signalProjection,signalFaces}=require('../renderer/road-renderer.js');
  const face=signalFaces(signal)[0],screen=signalProjection(face,signal.height);
  assert.equal(screen[0],face[0]);assert(Math.abs(screen[1]-face[1]+5.8*.28)<1e-9);
  assert(signalDimensions('vehicle',20).height<1.5);
});

test('far-side poles remain outside the curb when the receiving road bends',()=>{
  const {roads,network}=crossing();roads[0].points=[[-200,0],[0,0],[8,0],[50,20],[200,20]];
  const signal=buildPlan(roads,network,roadTypes).signals.find(s=>s.approach==='east-west:-1');
  assert.equal(signal.placement,'far');
  const direction=[42/Math.hypot(42,20),20/Math.hypot(42,20)],offset=signal.support.map((v,i)=>v-signal.center[i]);
  assert(Math.abs(direction[0]*offset[0]+direction[1]*offset[1])<1e-8);
  assert(Math.abs(Math.hypot(...offset)-(roadTypes.avenue.width/2+1.8))<1e-8);
  for(const head of signal.heads){const d=head.map((v,i)=>v-signal.center[i]);assert(Math.abs(d[0]*direction[0]+d[1]*direction[1])<1e-8);assert(Math.hypot(...d)<roadTypes.avenue.width/2);}
});

test('street-scale lenses stay readable while city-scale lights use one marker per approach',()=>{
  const {roads,network}=crossing(),plan=buildPlan(roads,network,roadTypes);
  for(const scale of [4.5,7,12,20]){
    const vehicle=signalDimensions('vehicle',scale),person=signalDimensions('pedestrian',scale);
    assert(!vehicle.compact);assert(vehicle.width*scale>=7.9);assert(vehicle.unit*1.3*scale>=5);
    assert(person.width*scale>=7);assert(person.height<vehicle.height);
    assert.equal(signalFaces(plan.signals[0],scale).length,2);
  }
  for(const scale of [.5,1.5,2.5,4]){
    const size=signalDimensions('vehicle',scale);assert(size.compact);
    assert(size.width*scale>=5&&size.width*scale<=6);
    assert(plan.signals.every(s=>signalFaces(s,scale).length===1));
  }
});

test('enlarged vehicle and pedestrian housings stay separate after pole-height projection',()=>{
  for(const kinds of [['avenue','street'],['avenue','avenue'],['street','street']])for(let degrees=0;degrees<180;degrees+=9){
    const {roads,network}=crossing(kinds),angle=degrees*Math.PI/180;
    const rotate=([x,y])=>[x*Math.cos(angle)-y*Math.sin(angle),x*Math.sin(angle)+y*Math.cos(angle)];
    for(const r of roads)r.points=r.points.map(rotate);
    for(const a of network.junctions[0].approaches)a.tangent=rotate(a.tangent);
    const plan=buildPlan(roads,network,roadTypes);
    for(const scale of [4.5,7,16,20]){
      const heads=[...plan.signals,...plan.pedestrianSignals].flatMap(s=>signalFaces(s,scale).map(p=>({point:signalProjection(p,s.height),...signalDimensions(s.kind,scale)})));
      for(let i=0;i<heads.length;i++)for(let j=i+1;j<heads.length;j++){
        const a=heads[i],b=heads[j];
        assert(Math.abs(a.point[0]-b.point[0])>(a.width+b.width)/2||Math.abs(a.point[1]-b.point[1])>(a.height+b.height)/2,`overlap at ${degrees} degrees, scale ${scale}, heads ${i}/${j}`);
      }
    }
  }
});

test('upper-layer pass paints bridge surface and traffic after the ground composite',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),events=[];
 const root={CityScene:{roadSurfaces(ctx,roads,types,scale,level){events.push('surface:'+level);},vehicle(ctx,v){events.push('vehicle:'+v.level);}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../renderer/road-renderer.js'),'utf8'),{window:root});
 const ctx=new Proxy({}, {get:(target,key)=>target[key]||(()=>{}),set:(target,key,value)=>(target[key]=value,true)});
 const roads=[{id:'ground',points:[[-100,0],[100,0]],kind:'street',level:0},
              {id:'bridge',points:[[0,-100],[0,100]],kind:'street',level:1}];
 const state={roads,network:{junctions:[]},roadTypes},traffic={vehicles:[{point:[0,0],level:0},{point:[0,0],level:1}]};
 root.RoadRenderer.paint(ctx,state,{scale:.1,traffic,levels:[-1,0]});
 events.push('3d-composite');
 root.RoadRenderer.paint(ctx,state,{scale:.1,traffic,levels:[1]});
 assert.deepEqual(events.slice(-3),['3d-composite','surface:1','vehicle:1']);
 assert(events.indexOf('vehicle:0')<events.indexOf('surface:1'));
});

test('bridge landing bands taper smoothly and match endpoint tangents in either drawing direction',()=>{
 const api=require('../renderer/road-renderer.js'),scene=require('../renderer/scene-renderer.js');
 for(const reverse of [false,true])for(const angle of [0,.8,2.1]){
  const rotate=([x,y])=>[x*Math.cos(angle)-y*Math.sin(angle),x*Math.sin(angle)+y*Math.cos(angle)];
  const points=[[0,0],[32,4]].map(rotate);if(reverse)points.reverse();
  const ground={id:'g',level:0,kind:'street',points},bridge={id:'b',level:1,kind:'street',points:[[-100,0],[0,0]].map(rotate)};
  const length=Math.hypot(32,4),original=JSON.stringify(ground),network={nodes:{far:rotate([-100,0]),join:rotate([0,0]),end:rotate([32,4])},junctions:[],edges:[
   {road:'b',a:'far',b:'join',startDistance:0,endDistance:100},
   {road:'g',a:reverse?'end':'join',b:reverse?'join':'end',startDistance:0,endDistance:length}]};
  const layout=api.connections([ground,bridge],network,roadTypes),surface=api.surfaceRoad(ground,layout),profile=surface.surfaceProfile;
  assert(profile?.length>30);const start=reverse?profile.at(-1):profile[0],end=reverse?profile[0]:profile.at(-1);
  assert.equal(start.landingMix,0);assert.equal(end.mix,1);
  const expected=rotate([reverse?-1:1,0]);assert(Math.hypot(start.tangent[0]-expected[0],start.tangent[1]-expected[1])<1e-9);
  assert.deepEqual(end.point,ground.points[reverse?0:1]);assert.equal(JSON.stringify(ground),original);
  const section=api.roadCrossSection('street');
  for(const band of ['sidewalk','promenade','innerWalk','curb','gutter','surface']){
   const polygon=scene.roadBandBoundary(surface,14,section,band),index=reverse?profile.length-1:0,p=polygon[index];
   const width=7+section[band];
   assert(Math.abs(Math.hypot(p[0]-start.point[0],p[1]-start.point[1])-width)<1e-9,band+' retains full ground width');
   assert(polygon.flat().every(Number.isFinite));
  }
  for(const sample of profile){
   const raw=api.sample(ground.points,sample.distance),projected=api.projectPoint(raw.point,ground,layout);
   assert(Math.hypot(projected[0]-sample.point[0],projected[1]-sample.point[1])<1e-8,'markings follow the same spine');
  }
  const near=reverse?profile.at(-2):profile[1];assert(near.landingMix<.004,'the tangent transition begins smoothly');
  const upper=api.surfaceRoad(bridge,layout),up=upper.surfaceProfile;assert(up?.length>30);
  assert.equal(up.at(-1).mix,1);assert.equal(up[0].mix,0);
  for(const band of ['sidewalk','promenade','innerWalk','curb','surface']){
   const shape=scene.roadBandBoundary(upper,14,section,band),endIndex=up.length-1;
   assert(Math.abs(Math.hypot(shape[endIndex][0]-up[endIndex].point[0],shape[endIndex][1]-up[endIndex].point[1])-(7+section[band]))<1e-9);
   assert(Math.abs(up[0].bands[band]-(band==='surface'?0:section.curb))<1e-9);
  }
 }
});

test('angled bridge landing seams cover both butt caps without a rounded bulb',()=>{
 const {landingSeam}=require('../renderer/road-renderer.js');
 for(const rotation of [0,.6,1.7,Math.PI]){
  const approaches=[rotation,rotation+Math.PI+.13].map(angle=>({width:14,kind:'street',tangent:[Math.cos(angle),Math.sin(angle)]}));
  const join={point:[10,20],approaches},surface=landingSeam(join),curb=landingSeam(join,'curb');
  const area=points=>Math.abs(points.reduce((v,p,i)=>{const q=points[(i+1)%points.length];return v+p[0]*q[1]-p[1]*q[0];},0)/2);
  assert(area(surface)>10,'the small wedge has pavement');assert(area(curb)>area(surface));
  for(const a of approaches)for(const sign of [-1,1])assert(surface.some(p=>Math.hypot(p[0]-(10-a.tangent[1]*7*sign),p[1]-(20+a.tangent[0]*7*sign))<1e-10));
  assert(surface.every(p=>Math.abs(Math.hypot(p[0]-10,p[1]-20)-7)<1e-10));
 }
 assert.deepEqual(landingSeam({point:[0,0],approaches:[]}),[]);
});

test('a bridge landing preserves the nearby intersection of a short receiving road',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),passes=[];
 const root={CityScene:{roadSurfaces(ctx,roads,types,scale,level){passes.push({level,ids:roads.map(r=>r.id)});}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../renderer/road-renderer.js'),'utf8'),{window:root});
 const ctx=new Proxy({}, {get:(target,key)=>target[key]||(()=>{}),set:(target,key,value)=>(target[key]=value,true)});
 for(const length of [12,32]){
  passes.length=0;
  const roads=[{id:'bridge',points:[[0,-100],[0,0]],kind:'street',level:1},
   {id:'landing',points:[[0,0],[0,length]],kind:'street',level:0},
   {id:'crossing',points:[[-80,length],[80,length]],kind:'street',level:0},
   {id:'overpass',points:[[-80,5],[80,5]],kind:'street',level:1},
   {id:'distant',points:[[-80,200],[80,200]],kind:'street',level:0}];
  const network={nodes:{top:[0,-100],join:[0,0],end:[0,length]},junctions:[],edges:[
   {road:'bridge',a:'top',b:'join',startDistance:0,endDistance:100},
   {road:'landing',a:'join',b:'end',startDistance:0,endDistance:length}]};
  // Cover both a crossing inside the patch and its sidewalk at the boundary.
  root.RoadRenderer.paint(ctx,{roads,network,roadTypes},{scale:.1,levels:[1],vehicles:false});
  const patch=passes.find(p=>p.level===0);
  assert(patch.ids.includes('crossing'),'the ground intersection must be painted with the landing, so its curb cannot close the crossing');
  assert(!patch.ids.includes('overpass'),'an unrelated elevated crossing must not be flattened into the landing');
  assert(!patch.ids.includes('distant'),'distant ground roads do not belong to the local repaint');
 }
});

function bridgeFixture({curve=false,width='street',length=300,unconnected=false,bothEnds=false,reverse=false}={}){
  const bridge={id:'b',kind:width,level:1,points:curve?[[0,0],[50,15],[100,100],[100,200]]:[[0,0],[length,0]]};
  if(reverse)bridge.points.reverse();
  const ground={id:'g',kind:'street',level:0,points:[[-200,0],[0,0]]};
  const roads=[ground,bridge],end=bridge.points.at(-1),start=bridge.points[0];
  const total=bridge.points.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-bridge.points[i][0],p[1]-bridge.points[i][1]),0);
  const join=reverse?'b-end':'b-start';
  const network={junctions:[],nodes:{'g-start':[-200,0],'g-end':[0,0],'b-start':start,'b-end':end},edges:[
    {road:'g',a:'g-start',b:unconnected?'g-end':join,startDistance:0,endDistance:200},
    {road:'b',a:'b-start',b:'b-end',startDistance:0,endDistance:total}]};
  if(bothEnds){const g2={id:'g2',kind:'street',level:0,points:[end,[end[0]+200,end[1]]]};roads.push(g2);network.nodes['g2-end']=g2.points[1];network.edges.push({road:'g2',a:'b-end',b:'g2-end',startDistance:0,endDistance:200});}
  const api=require('../renderer/road-renderer.js'),layout=api.connections(roads,network,roadTypes);
  return {api,roads,network,bridge,layout,total};
}

test('degree-two bridge joins are open at either endpoint and survive reversed drawing order',()=>{
  for(const reverse of [false,true])for(const width of ['street','avenue','highway']){
    const {api,roads,bridge,layout,total}=bridgeFixture({reverse,width});
    assert.equal(layout.joins.length,1);assert.equal(layout.joins[0].approaches.length,2);
    assert.equal(api.roadHeight(bridge,reverse?total:0,layout),0);
    assert.equal(api.roadHeight(bridge,reverse?0:total,layout),6);
    const points=api.surfaceRoad(bridge,layout).points;
    const endpoint=reverse?points.at(-1):points[0];assert.deepEqual(endpoint,[0,0]);
    const ground=api.surfaceRoad(roads.find(r=>r.id==='g'),layout);
    assert(ground.openEnd,'the receiving ground sidewalk must not end in a round cap at the bridge');
    assert(!ground.openStart,'the unconnected ground endpoint keeps its round cap');
  }
});

test('bridge curves use arc length for pavement, markings, shadows and vehicle elevation',()=>{
  const {api,bridge,layout,total}=bridgeFixture({curve:true});
  const surface=api.surfaceRoad(bridge,layout);assert(surface.points.length>bridge.points.length);
  assert.deepEqual(surface.points[0],bridge.points[0]);
  for(let d=0;d<=total;d+=2){
    const point=api.sample(bridge.points,d).point,z=api.roadHeight(bridge,d,layout);
    assert(z>=0&&z<=6);assert(Math.abs(api.vehicleHeight({road:'b',level:1,point},layout)-z)<1e-9);
    assert(Math.abs(api.projectPoint(point,bridge,layout)[1]-(point[1]-.28*z))<1e-9);
  }
  assert.equal(api.surfaceRoad(bridge,layout),surface);
});

test('short and double-ended bridges never jump in height or dip below the ground',()=>{
  for(const length of [30,100,300]){
    const {api,bridge,layout}=bridgeFixture({length,bothEnds:true});
    assert.equal(layout.joins.length,2);assert.equal(api.roadHeight(bridge,0,layout),0);assert.equal(api.roadHeight(bridge,length,layout),0);
    let last=0;for(let d=0;d<=length;d+=.25){const z=api.roadHeight(bridge,d,layout);assert(z>=0&&z<=6);assert(Math.abs(z-last)<.026);last=z;}
  }
});

test('unsnapped overlapping endpoints keep their full height and do not open a junction',()=>{
  const {api,roads,bridge,layout}=bridgeFixture({unconnected:true});
  assert.equal(layout.joins.length,0);assert.equal(layout.ramps.size,0);
  assert.equal(api.roadHeight(bridge,0,layout),6);
  assert(!api.upperVehicle({road:'g',level:0,point:[0,0]},layout));
  assert(!api.surfaceRoad(roads.find(r=>r.id==='g'),layout).openEnd);
});

test('deferred traffic includes receiving roads but never unrelated roads near a ramp',()=>{
  const {api,layout}=bridgeFixture();
  assert(api.upperVehicle({road:'g',level:0,point:[-3,0]},layout));
  assert(api.upperVehicle({road:'b',level:1,point:[150,0]},layout));
  assert(!api.upperVehicle({road:'other',level:0,point:[0,0]},layout));
  assert(!api.upperVehicle({road:'g',level:0,point:[-150,0]},layout));
});

test('markings sample the same curved height profile as the pavement, including long straight segments',()=>{
 const {api,bridge,layout}=bridgeFixture();
 const line=api.projectPath(bridge.points,bridge,layout),surface=api.surfaceRoad(bridge,layout);
 assert.equal(line.length,surface.points.length);assert(line.every((p,i)=>Math.hypot(p[0]-surface.points[i][0],p[1]-surface.points[i][1])<1e-9));assert(line.length>50);
 assert.equal(line.find(p=>p[0]===15)[1],0);
 assert(Math.abs(line.find(p=>p[0]===150)[1]+1.68)<1e-9);
});

test('a wide bridge mouth stops at the opposite edge of its narrow receiving road',()=>{
 const api=require('../renderer/road-renderer.js');
 const roads=[{id:'g',kind:'street',level:0,points:[[-200,0],[200,0]]},{id:'b',kind:'avenue',level:1,points:[[0,0],[100,30],[120,200]]}];
 const network={nodes:{w:[-200,0],j:[0,0],e:[200,0],n:[120,200]},junctions:[],edges:[
  {road:'g',a:'w',b:'j',startDistance:0,endDistance:200},{road:'g',a:'j',b:'e',startDistance:200,endDistance:400},
  {road:'b',a:'j',b:'n',startDistance:0,endDistance:Math.hypot(100,30)+Math.hypot(20,170)}]};
 const layout=api.connections(roads,network,roadTypes),surface=api.surfaceRoad(roads[1],layout);
 assert(surface.openStart);assert(!surface.openEnd);assert.equal(surface.mouthClips.length,1);
 assert(surface.mouthClips[0].every(p=>p[1]<=-7));assert.equal(surface.mouthClips[0][0][1],-7);
});

test('junction lane overrides are painted on the corresponding incoming lanes',()=>{
  const {roads,network}=crossing();
  const arm=network.junctions[0].approaches.find(a=>a.road==='east-west'&&a.direction===-1);
  arm.laneTurns=[['right'],['left','straight']];
  const arrows=buildPlan(roads,network,roadTypes).arrows.filter(a=>a.road==='east-west'&&a.point[0]<0&&a.point[0]>-60);
  assert.deepEqual(arrows.map(a=>a.turns),arm.laneTurns);
});

function compactJunctionCluster(factor=1){
  const nodes=[[0,0],[45.75,-13.44],[13.03,15]].map(p=>p.map(v=>v*factor));
  const types={...roadTypes,lane:{width:7,walk:true}};
  const roads=[1,2].map(i=>({id:`main-${i}`,kind:'street',level:0,oneway:false,
    points:[nodes[i].map(v=>v*-10),nodes[i].map(v=>v*10)]}));
  roads.push({id:'connector',kind:'lane',level:0,oneway:false,points:[nodes[2],nodes[1]]});
  const network={junctions:nodes.map((point,index)=>({id:`node-${index}`,point,control:'signals',crossings:true,
    approaches:roads.flatMap(r=>{
      if(index===0&&r.id==='connector'||index===1&&r.id==='main-2'||index===2&&r.id==='main-1')return [];
      const length=Math.hypot(r.points[1][0]-r.points[0][0],r.points[1][1]-r.points[0][1]);
      const distance=Math.hypot(point[0]-r.points[0][0],point[1]-r.points[0][1]);
      return (r.id==='connector'?[index===1?-1:1]:[-1,1]).map(direction=>({road:r.id,kind:r.kind,level:r.level,
        distance,direction,width:types[r.kind].width,incoming:true,outgoing:true,
        tangent:r.points[1].map((v,k)=>(v-r.points[0][k])/length*direction)}));
    })}))};
  return {roads,network,types};
}

test('compact connected junction loops absorb unusable paving slivers without altering roads',()=>{
  const {roads,network,types}=compactJunctionCluster(),before=JSON.stringify({roads,network});
  const plan=buildPlan(roads,network,types);
  assert.equal(plan.pockets.length,1);
  assert(plan.pockets[0].radius>2&&plan.pockets[0].radius<3);
  assert.equal(JSON.stringify({roads,network}),before);
  const large=compactJunctionCluster(1.7);
  assert.equal(buildPlan(large.roads,large.network,large.types).pockets.length,0,'retain usable central islands');
  const bridge=compactJunctionCluster();bridge.roads[2].level=1;
  for(const j of bridge.network.junctions)for(const arm of j.approaches)if(arm.road==='connector')arm.level=1;
  assert.equal(buildPlan(bridge.roads,bridge.network,bridge.types).pockets.length,0,'no visual merge across elevations');
  const curve=compactJunctionCluster();curve.roads[2].points.splice(1,0,[40,10]);
  assert.equal(buildPlan(curve.roads,curve.network,curve.types).pockets.length,0,'do not fill the chord of a curved street');
});

test('clustered junction lights move to an approach sidewalk instead of the central roadway',()=>{
  const {roads,network,types}=compactJunctionCluster(),plan=buildPlan(roads,network,types);
  const moved=plan.signals.find(s=>s.junction==='node-0'&&s.approach==='main-1:-1');
  assert.equal(moved.placement,'near');
  const api=require('../renderer/road-renderer.js');
  for(const signal of plan.signals)for(const road of roads){
    const q=sample(road.points,api.nearestDistance(road.points,signal.support)).point;
    assert(Math.hypot(q[0]-signal.support[0],q[1]-signal.support[1])>=types[road.kind].width/2+.6,
      'every pole base must stay outside neighboring carriageways');
  }
});

test('physical approach metadata advances markings and draws a tapered extra lane',()=>{
  const {roads,network}=crossing(['street','street']);
  for(const arm of network.junctions[0].approaches)Object.assign(arm,{crossingDistance:8,stopDistance:12,
    laneCount:2,baseLaneCount:1,laneWidth:3.5,laneFullDistance:24,laneTaperDistance:48,
    autoLanes:true,laneTurns:[['left'],['straight','right']]});
  const plan=buildPlan(roads,network,roadTypes);
  assert.equal(plan.laneBays.length,4);
  assert(plan.crosswalks.every(c=>Math.abs(Math.hypot(...c.point)-8)<1e-8));
  assert(plan.stopLines.every(c=>Math.abs(Math.hypot(...c.point)-12)<1e-8));
  const arrows=plan.arrows.filter(a=>a.road==='east-west'&&a.travel[0]===1&&a.point[0]<0&&a.point[0]>-40);
  assert.deepEqual(arrows.map(a=>a.point[1]),[1.75,5.25]);
  assert(arrows.every(a=>a.laneWidth===3.5));
  const west=plan.laneBays.find(b=>b.points[0][0]<0&&b.road==='east-west');
  assert.deepEqual(west.points[0],[-12,3.5]);
  assert.deepEqual(west.points.at(-1),[-48,7]);
});
