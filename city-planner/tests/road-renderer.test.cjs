const test=require('node:test');
const assert=require('node:assert/strict');
const {sample,turnsFor,buildPlan,arrowPolygons,signalState,signalDimensions,signalFaces,signalProjection}=require('../renderer/road-renderer.js');

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
