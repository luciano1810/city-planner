const test=require('node:test'),assert=require('node:assert/strict');
const scene=require('../renderer/scene-renderer.js');
const rectangle=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const box=points=>[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];

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
