const test=require('node:test'),assert=require('node:assert/strict');
const scene=require('../renderer/scene-renderer.js');
const roadRenderer=require('../renderer/road-renderer.js'),materials=require('../renderer/material-catalog.js');
const rectangle=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const box=points=>[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
const inBox=(tree,b)=>tree.point[0]>=b[0]&&tree.point[0]<=b[2]&&tree.point[1]>=b[1]&&tree.point[1]<=b[3];

// Frozen eager behavior, using direct geometry rather than the lazy/grid path.
// Rejected candidates consume only radius RNG calls, so even a single changed
// exclusion or per-tile seed would shift every later tree on the same road.
function eagerReference(state){
  const joins=roadRenderer.connections(state.roads,state.network,state.meta.roadTypes).joins,trees=[];
  const occupied=[...state.parcels.filter(p=>p.building).map(p=>p.building.footprint),...state.facilities.filter(f=>!['park','plaza'].includes(f.kind)&&f.points?.length).map(f=>f.points)];
  const courts=state.streetside?.sites||[],driveways=[...state.facilities.filter(f=>f.connected&&f.accessPath?.length),...courts].filter(f=>f.accessPath?.length);
  for(const road of state.roads){
    if(road.level!==0||!['street','avenue'].includes(road.kind))continue;
    const cfg=state.meta.roadTypes[road.kind],length=road.points.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-road.points[i][0],p[1]-road.points[i][1]),0),rng=scene.random(road.id+':avenue-trees');
    const mix=materials.treeMixes.street,species=mix[scene.seed(road.id+':species')%mix.length],type=materials.tree(species),junctions=[];
    for(const junction of state.network.junctions)for(const approach of junction.approaches)if(approach.road===road.id)junctions.push({distance:approach.distance,clear:Math.max(...junction.approaches.map(a=>a.width))/2+16});
    for(let d=25;d<length-15;d+=12){
      if(junctions.some(j=>Math.abs(d-j.distance)<j.clear))continue;
      const at=roadRenderer.sample(road.points,d);
      for(const side of [-1,1]){
        const radius=Math.min(road.kind==='avenue'?4.8:3.8,type.radius[0]+rng()*.8),offset=side*(cfg.width/2+(road.kind==='avenue'?3.3:2.35)),point=[at.point[0]-at.tangent[1]*offset,at.point[1]+at.tangent[0]*offset];
        if(joins.some(j=>Math.hypot(point[0]-j.point[0],point[1]-j.point[1])<j.extent+radius))continue;
        if(occupied.some(points=>scene.inside(point,points)||scene.edgeDistance(point,points)<radius*.7+1))continue;
        if(driveways.some(f=>scene.edgeDistance(point,f.accessPath)<(f.accessWidth||5)/2+radius))continue;
        if(courts.some(c=>scene.onSurface(point,c.surfaces)))continue;
        trees.push({point,radius,species:type.id,variant:species+Math.floor(rng()*4)*materials.treeSpecies.length,height:type.height[0]*.7+rng()*3,street:true});
      }
    }
  }
  trees.push(...courts.flatMap(c=>c.trees).filter(t=>!occupied.some(points=>scene.inside(t.point,points)||scene.edgeDistance(t.point,points)<t.radius*.7+1)));
  return trees;
}
function lazyFixture(){
  return {roads:[
    {id:'west-curve',kind:'avenue',level:0,points:[[-180,0],[300,0],[440,80]]},
    {id:'north-street',kind:'street',level:0,points:[[80,-180],[80,240]]},
    {id:'distant-street',kind:'street',level:0,points:[[1800,1700],[2120,1700]]},
    {id:'overpass',kind:'street',level:1,points:[[40,-100],[40,100]]}
  ],network:{junctions:[{approaches:[{road:'west-curve',distance:260,width:24},{road:'north-street',distance:180,width:12}]}]},
  meta:{roadTypes:{avenue:{width:24},street:{width:12}}},parcels:[{building:{footprint:rectangle(-130,10,30,20)}}],
  facilities:[{id:'lot',kind:'parking_lot',connected:true,points:rectangle(150,-32,50,23),accessPath:[[175,0],[175,-32]],accessWidth:4}],
  streetside:{sites:[{surfaces:[{points:rectangle(-80,10,80,30),holes:[rectangle(-58,12,27,14)]}],accessPath:[[-20,0],[-20,40]],accessWidth:4,
    trees:[{point:[-140,23],radius:2,height:5,variant:0,street:true},{point:[175,-19],radius:2,height:5,variant:1,street:true},{point:[1910,1720],radius:2,height:5,variant:2,street:true}]}]}};
}

test('planting broad phase preserves exact nearby geometry across grid edges, negative cells and oversized sites',()=>{
  const polygons=[rectangle(-130,-70,19,8),rectangle(63,63,4,4),rectangle(-2,-2,4,4),
    [[10,10],[40,10],[40,15],[15,15],[15,40],[10,40],[10,10]],rectangle(-20000,-20000,40000,40000)];
  const index=scene.plantingIndex(polygons,box),random=scene.random('planting-index-regression');
  const queries=[[[64,64],0],[[0,0],0],[[-112,-65],3],[[30,30],.5],[[65,70],4]];
  for(let i=0;i<160;i++)queries.push([[random()*400-200,random()*400-200],random()*8]);
  for(const [point,padding] of queries){
    const exact=points=>scene.inside(point,points)||scene.edgeDistance(point,points)<padding;
    const expected=polygons.filter(exact),actual=[],visited=new Set();
    index.some(point,padding,points=>{assert(!visited.has(points),'a multi-cell item is examined once');visited.add(points);if(exact(points))actual.push(points);return false;});
    assert.deepEqual(new Set(actual),new Set(expected));
  }
  assert.equal(index.stats.large,1);assert(index.stats.cells<40,'oversized bounds never fill the world grid');
});

test('10,000 remote buildings and forecourts add one bounds pass instead of city-wide exact scans per street-tree candidate',t=>{
  const road={id:'dense-reference',kind:'avenue',level:0,points:[[0,0],[1100,0],[1400,100]]};
  const court={id:'near-court',surfaces:[{points:rectangle(0,10,100,25),holes:[rectangle(30,12,30,11)]}],accessPath:[[73,0],[73,45]],accessWidth:3,
    trees:[{point:[310,-16],radius:3,height:6,variant:0,street:true}]};
  const state={roads:[road],network:{junctions:[{approaches:[{road:road.id,distance:420,width:24}]}]},
    meta:{roadTypes:{avenue:{width:24}}},parcels:[],facilities:[{id:'parking',kind:'parking_lot',points:rectangle(280,-30,60,19)}],streetside:{sites:[court]}};
  const original=JSON.stringify(state),baseline=scene.streetTreesFor(state);assert(baseline.length>100);
  assert(baseline.some(t=>Math.abs(t.point[0]-37)<1e-9&&t.point[1]>0),'frontcourt holes remain plantable');
  assert(!baseline.some(t=>Math.abs(t.point[0]-73)<1e-9&&t.point[1]>0),'driveway exclusion remains intact');
  assert(!baseline.some(t=>scene.inside(t.point,state.facilities[0].points)),'parking facilities exclude generated and authoritative court trees');
  assert.equal(JSON.stringify(state),original);
  let reads=0,canvases=0;
  const counted=points=>points.map(point=>new Proxy(point,{get(target,key,receiver){if(key==='0'||key==='1')reads++;return Reflect.get(target,key,receiver);}}));
  const parcels=[],courts=[court];
  for(let i=0;i<10000;i++){
    const x=10000+i%100*20,y=10000+Math.floor(i/100)*20;
    parcels.push({building:{footprint:counted(rectangle(x,y,8,9))}});
    courts.push({surfaces:[{points:counted(rectangle(x,y+10,8,6))}],accessPath:counted([[x,y],[x+4,y+12]]),accessWidth:3,trees:[]});
  }
  const dense={...state,parcels,streetside:{sites:courts}},oldDocument=global.document;
  global.document={createElement(){canvases++;throw new Error('street planting layout must not rasterize remote details');}};
  try{
    const actual=scene.streetTreesFor(dense);assert.deepEqual(actual,baseline,'adding distant city geometry preserves every accepted tree and its seeded appearance');
    assert(reads<300000,`Expected one linear bounds read, received ${reads} remote coordinate reads`);
    const warmed=reads;assert.strictEqual(scene.streetTreesFor(dense),actual);assert.equal(reads,warmed,'unchanged frames reuse the completed layout');
    assert.equal(canvases,0);t.diagnostic(`Remote geometry coordinate reads: ${reads}; cached repeat: 0; accepted local trees: ${actual.length}`);
  }finally{if(oldDocument===undefined)delete global.document;else global.document=oldDocument;}
});

test('query order preserves the eager tree positions, RNG stream, painter order and complete legacy array',()=>{
  const state=lazyFixture(),saved=JSON.stringify(state),expected=eagerReference(state);
  const regions=[[1850,1680,1990,1730],[-165,-30,15,45],[60,-160,100,220],[200,-20,450,110]];
  for(const query of regions){
    const result=scene.streetTreesFor(state,{rootBounds:query});assert.deepEqual(result,expected.filter(t=>inBox(t,query)));
    assert.strictEqual(scene.streetTreesFor(state,query),result,'the latest complete viewport result is reused');
  }
  const complete=scene.streetTreesFor(state);assert.deepEqual(complete,expected);assert.strictEqual(scene.streetTreesFor(state),complete);
  for(const query of regions)assert.deepEqual(scene.streetTreesFor(state,query),expected.filter(t=>inBox(t,query)));
  assert.equal(JSON.stringify(state),saved,'no saved road, court tree or obstacle geometry changes');
  const replacements=[{roads:state.roads.slice()},{meta:{roadTypes:{...state.meta.roadTypes}}},{facilities:state.facilities.slice()},
    {parcels:state.parcels.slice()},{streetside:{...state.streetside}},{network:{...state.network}}];
  for(const replacement of replacements){
    const next={...state,...replacement},actual=scene.streetTreesFor(next);assert.notStrictEqual(actual,complete);assert.deepEqual(actual,expected,'each original cache dependency invalidates shared indices and road results');
    assert.strictEqual(scene.streetTreesFor(next),actual);
  }
});

test('10,000 remote roads and court trees are indexed once but only queried roads consume a candidate RNG stream',t=>{
  const local={id:'local',kind:'street',level:0,points:[[0,0],[150,0]]},roads=[local],courts=[];let remoteRadiusReads=0,connections=0;
  courts.push({surfaces:[],trees:[{point:[50,20],radius:1,height:3,variant:0,street:true}]});
  for(let i=0;i<10000;i++){
    const x=10000+i%100*250,y=10000+Math.floor(i/100)*250;
    roads.push({id:'remote-'+i,kind:'street',level:0,points:[[x,y],[x+150,y]]});
    courts.push({surfaces:[],trees:[{point:[x+50,y+20],get radius(){remoteRadiusReads++;return 1;},height:3,variant:0,street:true}]});
  }
  const state={roads,network:{junctions:[]},meta:{roadTypes:{street:{width:12}}},parcels:[],facilities:[],streetside:{sites:courts}};
  const originalSample=roadRenderer.sample,originalConnections=roadRenderer.connections,oldDocument=global.document,sampled=new Map();
  roadRenderer.sample=(points,d)=>{sampled.set(points,(sampled.get(points)||0)+1);return originalSample(points,d);};
  roadRenderer.connections=(...args)=>{connections++;return originalConnections(...args);};
  global.document={createElement(){throw new Error('lazy street-tree queries cannot allocate canvases');}};
  try{
    const query=[-5,-25,100,25];
    assert.deepEqual(scene.withPreview(()=>scene.streetTreesFor(state,query)),[]);assert.equal(connections,0,'a cold preview does not construct shared geometry indices');
    const first=scene.streetTreesFor(state,query);assert.equal(first.length,15);assert.equal(sampled.size,1);assert(sampled.has(local.points));assert.equal(remoteRadiusReads,0);assert.equal(connections,1);
    const sampleCount=sampled.get(local.points);assert.strictEqual(scene.streetTreesFor(state,query),first);assert.equal(sampled.get(local.points),sampleCount);
    const remote=roads[4322],x=remote.points[0][0],y=remote.points[0][1],other=[x-5,y-25,x+100,y+25];
    assert.deepEqual(scene.withPreview(()=>scene.streetTreesFor(state,other)),[]);assert.equal(sampled.size,1);assert.equal(remoteRadiusReads,0,'preview does not run new court-tree avoidance tests');
    const second=scene.streetTreesFor(state,other);assert.equal(second.length,15);assert.equal(sampled.size,2);assert(sampled.has(remote.points));assert.equal(remoteRadiusReads,1);
    const returned=scene.streetTreesFor(state,query);assert.deepEqual(returned,first);for(let i=0;i<first.length;i++)assert.strictEqual(returned[i],first[i],'the road result survives changes of viewport');
    assert.equal(sampled.size,2);assert.equal(sampled.get(local.points),sampleCount);assert.equal(connections,1);assert.equal(remoteRadiusReads,1);
    t.diagnostic(`Road candidate streams generated: ${sampled.size} / ${roads.length}; remote court exact checks: ${remoteRadiusReads} / 10000`);
  }finally{roadRenderer.sample=originalSample;roadRenderer.connections=originalConnections;if(oldDocument===undefined)delete global.document;else global.document=oldDocument;}
});

test('canvas queries include outside roots whose current world-sun shadows can enter the tile',()=>{
  const state=lazyFixture(),expected=eagerReference(state),before=scene.time;
  const ctx={canvas:{width:120,height:90},getTransform:()=>({a:2,b:0,c:0,d:2,e:220,f:20})};
  // The inverse canvas covers [-110,-10,-50,35] world metres. Use the same
  // documented canopy/height envelope, including the shared world sun vector.
  const view=[-110,-10,-50,35];
  try{
    for(const hour of [7,9,15,19]){
      scene.setTime(hour*3600);const sun=scene.lightingAt(scene.time),v=scene.shadowOffset(30,sun);
      const roots=[view[0]-Math.max(7,v[0]*.56+7),view[1]-Math.max(7,v[1]*.56+7),view[2]-Math.min(-7,v[0]*.56-7),view[3]-Math.min(-15,v[1]*.56-7)];
      const actual=scene.streetTreesFor(state,ctx);assert.deepEqual(actual,expected.filter(t=>inBox(t,roots)));
      if(hour===7)assert(actual.some(t=>!inBox(t,view)),'a root outside the pixel viewport is kept for its crown or shadow');
    }
  }finally{scene.setTime(before);}
});
