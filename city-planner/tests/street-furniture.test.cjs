const test=require('node:test');
const assert=require('node:assert/strict');
const furniture=require('../renderer/street-furniture.js');

const types={street:{width:14,walk:true},avenue:{width:24,walk:true},lane:{width:7,walk:true},highway:{width:30,walk:false}};
const rectangle=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const road=(id='main',length=1600,kind='street',y=0)=>({id,kind,level:0,points:[[0,y],[length,y]]});
function state(roads=[road()]){return {roads,network:{junctions:[],edges:[],nodes:{}},meta:{roadTypes:types},parcels:[],facilities:[],streetside:{sites:[]}};}
const sorted=items=>items.slice().sort((a,b)=>a.id.localeCompare(b.id));

test('metre-anchored furniture survives viewport order and leaves the sidewalk walking band open',()=>{
  const source=state([road(),road('avenue',1600,'avenue',100),road('lane',1600,'lane',200),{...road('bridge',1600,'avenue',300),level:1}]),before=JSON.stringify(source);
  const a=furniture.createPlanner(source),b=furniture.createPlanner(source),view=[0,-30,1600,340],all=a.items(view);
  assert(all.length>30,'long streets contain varied furniture without filling every interval');
  assert(all.some(i=>furniture.definitions[i.cell].kind==='bench'));assert(all.some(i=>furniture.definitions[i.cell].kind!=='bench'));
  assert(all.every(i=>['main','avenue'].includes(i.road)),'lanes and bridges never acquire furniture');
  for(const section of b.visibleSections(view).reverse())b.section(section.road,section.index);
  assert.deepEqual(sorted(b.items(view)),sorted(all),'warming sections in reverse order preserves IDs, placement, type and orientation');
  const positions=new Set(all.map(i=>i.id));assert.equal(positions.size,all.length,'adjacent 64 m sections have a single owner for each candidate');
  for(const item of all){
    const avenue=item.road==='avenue',y=avenue?100:0,half=avenue?12:7,walk=avenue?4.5:3;
    const corners=furniture.footprint(item),outer=Math.max(...corners.map(p=>Math.abs(p[1]-y)));
    assert(corners.every(p=>Math.abs(p[1]-y)>half+.56),'the complete physical footprint clears the curb');
    assert(half+walk-outer>=1.5,'at least 1.5 m of continuous walking space stays behind the furniture');
    assert(Math.cos(item.heading)*item.side<0,'the seat front faces the roadway');
    for(let d=25;d<1600-15;d+=12)for(const side of [-1,1]){
      const root=[d,y+side*(half+(avenue?3.3:2.35))],def=furniture.definitions[item.cell],clear=Math.hypot(def.width,def.depth)/2+1.3;
      assert(Math.hypot(item.point[0]-root[0],item.point[1]-root[1])>=clear-1e-8,'furniture clears established street-tree trunks and tree pits');
    }
  }
  assert(new Set(all.filter(i=>i.road==='main').map(i=>Math.round(i.distance%24))).size>5,'seeded metre positions retain natural jitter');
  assert.equal(JSON.stringify(source),before,'all geometry and saved objects remain unchanged');
});

test('local buildings, driveways, real tree roots and crossing mouths exclude furniture without changing other seeds',()=>{
  const source=state(),baseline=furniture.createPlanner(source).items([0,-35,1600,35]);
  const selected=[];
  for(const item of baseline)if(item.distance>80&&item.distance<1450&&selected.every(other=>Math.abs(item.distance-other.distance)>100)){selected.push(item);if(selected.length===4)break;}
  assert.equal(selected.length,4);
  const [building,driveway,tree,crossing]=selected;
  source.parcels.push({id:'obstacle-building',building:{footprint:rectangle(building.point[0]-2,building.point[1]-2,4,4)}});
  source.streetside.sites.push({id:'access',accessPath:[[driveway.point[0],-25],[driveway.point[0],25]],accessWidth:4,trees:[{point:tree.point,radius:4}]});
  source.network.junctions.push({id:'crossing',point:[crossing.distance,0],approaches:[{road:'main',distance:crossing.distance,width:24}]});
  const original=JSON.stringify(source),actual=furniture.createPlanner(source).items([0,-35,1600,35]),ids=new Set(actual.map(i=>i.id));
  for(const removed of selected)assert(!ids.has(removed.id),'new local obstacles remove their conflicting candidate');
  for(const item of actual){
    assert(Math.abs(item.distance-crossing.distance)>=26,'crosswalk approaches remain empty');
    assert(Math.abs(item.point[0]-driveway.point[0])>2.5,'driveway and its walking clearance stay open');
    assert(Math.hypot(item.point[0]-tree.point[0],item.point[1]-tree.point[1])>1.7,'authoritative court trees are also avoided');
    assert.deepEqual(item,baseline.find(previous=>previous.id===item.id),'obstacle filtering never consumes or shifts downstream random seeds');
  }
  assert.equal(JSON.stringify(source),original);
});

test('10,000 remote buildings receive one bounds pass; visible layout is lazy, cached and LRU bounded',t=>{
  let reads=0,canvases=0;
  const counted=points=>points.map(p=>new Proxy(p,{get(target,key,receiver){if(key==='0'||key==='1')reads++;return Reflect.get(target,key,receiver);}}));
  const source=state([road('long-main',100000)]);
  for(let i=0;i<10000;i++){
    const x=10000+i%100*20,y=10000+Math.floor(i/100)*20;
    source.parcels.push({building:{footprint:counted(rectangle(x,y,8,9))}});
    source.streetside.sites.push({accessPath:counted([[x,y],[x+3,y+10]]),accessWidth:3,trees:[]});
  }
  const oldDocument=global.document;global.document={createElement(){canvases++;throw new Error('layout must not allocate a canvas');}};
  try{
    const planner=furniture.createPlanner(source,{limit:12}),initialReads=reads;
    assert(initialReads<=160000,`one bounds pass expected, saw ${initialReads} coordinate reads`);
    assert.equal(planner.stats.builds,0,'indexing a city does not create any furniture sections');
    const view=[40,-30,420,30],first=planner.items(view),stats=planner.stats;
    assert(first.length>5);assert(stats.builds<12,'a 100 km source road only builds visible sections');
    assert.equal(reads,initialReads,'visible collision queries never examine remote polygon or driveway vertices');
    assert.strictEqual(planner.items(view),first);assert.deepEqual(planner.stats,stats,'stationary frames reuse layout and do no geometry queries');
    for(let i=0;i<30;i++)planner.items([2000+i*700,-30,2400+i*700,30]);
    assert(planner.stats.sections<=12,'panning does not accumulate detail beyond the LRU limit');
    assert.deepEqual(planner.items(view),first,'evicted sections reconstruct the same seeded placement');
    assert.equal(reads,initialReads);assert.equal(canvases,0);
    t.diagnostic(`Remote coordinate reads: ${initialReads}; subsequent local layouts: 0; initial visible sections: ${stats.builds}; cache limit: 12`);
  }finally{if(oldDocument===undefined)delete global.document;else global.document=oldDocument;}
});

test('rotating furniture never rotates its world-space solar displacement',()=>{
  const base={point:[40,80],cell:0,heading:0},turned={...base,heading:Math.PI/2},light={azimuth:45,elevation:42};
  const a=furniture.shadowPlacement(base,light),b=furniture.shadowPlacement(turned,light);
  assert.deepEqual(a.point,b.point);assert.notEqual(a.heading,b.heading);
  assert(a.point[0]<base.point[0]&&a.point[1]<base.point[1]);
  assert.deepEqual(furniture.shadowPlacement(base,{azimuth:100,elevation:-1}).point,base.point);
  assert.deepEqual(furniture.shadowPlacement(turned,light,[-2,3]).point,[38.7,81.95],'the renderer can pass its shared solar vector directly');
});

test('furniture bounds and source queries include rotated bodies and their long solar copies',()=>{
  for(const azimuth of [0,90,225]){
    const light={azimuth,elevation:2},offsets=furniture.definitions.map((_,cell)=>furniture.shadowPlacement({point:[0,0],cell,heading:0},light).point);
    for(let cell=0;cell<furniture.definitions.length;cell++)for(const heading of [0,Math.PI/3,Math.PI/2]){
      const item={point:[80,40],cell,heading},shadow=furniture.shadowPlacement(item,light),box=furniture.visualBounds(item,offsets[cell]);
      for(const p of [...furniture.footprint(item),...furniture.footprint({...item,point:shadow.point})])assert(p[0]>=box[0]&&p[0]<=box[2]&&p[1]>=box[1]&&p[1]<=box[3]);
      const view=[shadow.point[0]-.4,shadow.point[1]-.4,shadow.point[0]+.4,shadow.point[1]+.4],query=furniture.shadowQueryBounds(view,offsets);
      assert(item.point[0]>=query[0]&&item.point[0]<=query[2]&&item.point[1]>=query[1]&&item.point[1]<=query[3],'query the source on the opposite side of the world-space displacement');
      assert(Math.hypot(...offsets[cell])>10,'fixture requires an off-tile source beyond the old fixed margin');
    }
  }
});

test('a shadow-only tile queries and paints its offscreen furniture source without per-frame sprites',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),source=state(),all=furniture.createPlanner(source).items([0,-30,1600,30]);
  const item=all.find(p=>p.distance>200&&p.distance<1400);assert(item);
  let light={azimuth:0,elevation:2,strength:.28},allocations=0;
  const solar=furniture.shadowPlacement(item,light).point,view=[solar[0]-2,solar[1]-2,solar[0]+2,solar[1]+2],stamps=[];
  const root={CityScene:{time:0,lightingAt:()=>light,shadowOffset:(height,l)=>{
    const length=l.elevation>0?Math.min(95,height/Math.tan(l.elevation*Math.PI/180)):0,angle=(l.azimuth+180)*Math.PI/180;
    return [Math.cos(angle)*length,Math.sin(angle)*length];
  }}};
  class Atlas{constructor(){this.width=this.height=256;}set src(_){this.onload();}}
  const document={createElement(){allocations++;const image={width:0,height:0};image.getContext=()=>({drawImage(){},fillRect(){},putImageData(){},getImageData:()=>({data:new Uint8ClampedArray(128*128*4).fill(255)})});return image;}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../renderer/street-furniture.js'),'utf8'),{window:root,document,Image:Atlas});
  const density=20,stack=[];let position=[0,0];
  const ctx={canvas:{width:(view[2]-view[0])*density,height:(view[3]-view[1])*density},getTransform:()=>({a:density,b:0,c:0,d:density,e:-view[0]*density,f:-view[1]*density}),
    save(){stack.push(position.slice());},restore(){position=stack.pop();},translate(x,y){position=[position[0]+x,position[1]+y];},rotate(){},drawImage(){stamps.push(position.slice());}};
  const api=root.CityStreetFurniture,near=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<1e-8;
  assert(item.point[0]>view[2]+6,'body lies beyond both old 3 m culling margins');
  api.paint(ctx,source,{scale:10,visible:()=>false});
  assert(stamps.some(p=>near(p,solar)),'the visible solar sprite must be painted even when its body is outside the tile');
  const order=stamps.map(p=>p.slice()),builds=api.stats.builds,initialAllocations=allocations;stamps.length=0;
  api.paint(ctx,source,{scale:10,visible:()=>false});
  assert.deepEqual(stamps,order,'same viewport keeps the original stable furniture draw order');
  assert.equal(allocations,initialAllocations);assert.equal(api.stats.builds,builds,'repainting reuses both bounded layouts and sprite cells');
  light={...light,elevation:-1};stamps.length=0;api.paint(ctx,source,{scale:10,visible:()=>false});
  assert(!stamps.some(p=>near(p,solar)),'night removes the solar copy');
  assert(!stamps.some(p=>near(p,item.point)),'an offscreen body is not kept by the previous daylight query');
  assert(api.stats.sections<=api.stats.limit);
});

test('twin-bin isolation preserves off-centre bodies and rejects noise whether their frame is connected or detached',()=>{
  const {isolateSprite}=require('../renderer/surface-variation.js'),width=48,height=30;
  for(const connected of [false,true]){
    const pixels=new Uint8ClampedArray(width*height*4);
    const fill=(x,y,w,h,rgb)=>{for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)pixels.set([...rgb,255],(yy*width+xx)*4);};
    // The blue bin crosses the atlas centre at x=24; splitting in half would
    // discard its right edge when the larger green bin wins that half.
    fill(10,8,18,16,[54,83,113]);fill(31,8,13,16,[41,91,75]);
    if(connected)fill(28,15,3,1,[32,43,42]);
    fill(2,2,3,3,[190,210,180]);
    const original=pixels.slice();assert.strictEqual(furniture.isolatePair(pixels,width,height,isolateSprite),pixels);
    for(let y=8;y<24;y++)for(const [x0,x1] of [[10,28],[31,44]])for(let x=x0;x<x1;x++){
      const i=(y*width+x)*4;assert.deepEqual(pixels.slice(i,i+4),original.slice(i,i+4),'both complete bin bodies keep their original RGBA');
    }
    for(let y=2;y<5;y++)for(let x=2;x<5;x++)assert.equal(pixels[(y*width+x)*4+3],0,'small disconnected noise is not promoted to a second bin');
    if(connected)for(let x=28;x<31;x++)assert.equal(pixels[(15*width+x)*4+3],255,'the original connecting frame is retained');
  }
});
