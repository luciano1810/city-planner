const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const materials=require('../renderer/material-catalog.js');

function parcel(id='garden',x=0,y=0){
  const ring=(a,b,c,d)=>[[a+x,b+y],[c+x,b+y],[c+x,d+y],[a+x,d+y],[a+x,b+y]];
  return {id,points:ring(0,0,80,80),center:[x+40,y+40],building:{use:'residential',status:'active',footprint:ring(28,28,52,52)}};
}

function harness({facilities=[],sites=[]}={}){
  const calls={canvases:0,reads:0,gradients:0,courtyards:0,gardenPlans:0};
  function context(canvas={width:4096,height:4096},matrix={a:1,b:0,c:0,d:1,e:0,f:0}){
    let transform={...matrix};const stack=[];
    const ctx={canvas,draws:[],globalAlpha:1,
      getTransform:()=>({...transform}),setTransform(a,b,c,d,e,f){transform={a,b,c,d,e,f};},
      save(){stack.push({transform:{...transform},alpha:this.globalAlpha});},
      restore(){const s=stack.pop();transform=s.transform;this.globalAlpha=s.alpha;},
      drawImage(...args){this.draws.push(args);},
      createRadialGradient(){calls.gradients++;return {addColorStop(){}};},
      createLinearGradient(){calls.gradients++;return {addColorStop(){}};},
      getImageData(_x,_y,w,h){calls.reads++;return {data:new Uint8ClampedArray(w*h*4)};},
      createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},
      createPattern(){return {};},putImageData(){},beginPath(){},closePath(){},moveTo(){},lineTo(){},stroke(){},fill(){},
      fillRect(){},strokeRect(){},clearRect(){},arc(){},ellipse(){},clip(){},translate(){},rotate(){},scale(){}};
    return ctx;
  }
  const document={createElement(){calls.canvases++;const image={width:0,height:0};image.ctx=context(image);image.getContext=()=>image.ctx;return image;}};
  class Image {set src(value){this.url=value;this.width=this.height=1024;this.onload?.();}}
  const state={facilities,streetside:{sites}};
  const window={SceneMaterials:materials,SceneRasterCache:require('../renderer/raster-cache.js'),SceneMaterialPreparation:require('../renderer/material-preparation.js'),
    // The recorder verifies scheduling, cache bounds and real sprite dispatch;
    // pixels are intentionally empty so it does not reproduce the image tests.
    SurfaceVariation:{vehicleAtlases:{},isolateSprite(){}},CityApp:{state},CityScene3D:{parkingFor:()=>null},
    CityLandscape:{
      plan(){calls.gardenPlans++;return null;},
      courtyard(_p,trees){calls.courtyards++;return {beds:[],trees:trees.map(t=>({...t,street:false})),shrubs:trees.length?[{point:trees[0].point,radius:.7,height:.6,variant:1,shrub:true}]:[]};}
    }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../renderer/scene-renderer.js'),'utf8'),{window,document,Image});
  return {scene:window.CityScene,calls,context,state};
}

test('overview roots are deterministic and do not build near courtyard contours, including temporary near-scale previews',()=>{
  const {scene,calls,context}=harness(),p=parcel(),before=JSON.stringify(p),ctx=context();
  scene.vegetation(ctx,[p],.7,()=>true);
  const roots=scene.treesFor(p,false),cold=ctx.draws.map(d=>d.slice(1));
  assert(roots.length>10);assert.equal(ctx.draws.length,roots.length,'every root still contributes its textured canopy');
  assert.equal(calls.courtyards,0);assert.equal(calls.gardenPlans,0,'ordinary parcels never ask for a park plan');
  const detailed=scene.treesFor(p);
  const geometry=trees=>JSON.stringify(trees.map(({point,radius,height,variant})=>({point,radius,height,variant})));
  assert.equal(geometry(detailed),geometry(roots),'near refinement cannot move or replace the saved deterministic roots');
  assert.equal(calls.courtyards,1);
  ctx.draws.length=0;scene.vegetation(ctx,[p],.7,()=>true);
  assert.deepEqual(ctx.draws.map(d=>d.slice(1)),cold,'distant appearance does not depend on whether a courtyard was visited first');
  const q=parcel('new-near-preview',100,0);
  scene.withPreview(()=>scene.vegetation(ctx,[q],13.5,()=>true));
  assert.equal(calls.courtyards,1,'the shared preview flag also bypasses expensive near planting contours');
  ctx.draws.length=0;scene.vegetation(ctx,[q],13.5,()=>true);
  assert.equal(calls.courtyards,2);assert(ctx.draws.length>scene.treesFor(q).length*2,'the complete canopy, contact shadow and cast shadow return in the final near view');
  assert.equal(JSON.stringify(p),before);
});

test('ten thousand distant plants reuse a bounded V4 bitmap set with one blit each and no warm pixel or gradient work',()=>{
  const {scene,calls,context}=harness(),ctx=context(),styles=[];
  for(let variant=0;variant<20;variant++){
    const type=materials.tree(variant),lo=type.height[0]*.65/type.radius[1],hi=type.height[1]/type.radius[0];
    for(let i=0;i<5;i++)styles.push({radius:3,height:3*(lo+(hi-lo)*i/4),variant:variant+60});
  }
  for(let variant=0;variant<8;variant++)for(let i=0;i<5;i++)styles.push({radius:1.2,height:1.2*(.45+1.05*i/4),variant,shrub:true});
  const plants=Array.from({length:10000},(_,i)=>({...styles[i%styles.length],point:[20+i%100*12,20+Math.floor(i/100)*12]}));
  scene.vegetation(ctx,[],.7,()=>true,plants);
  assert.equal(ctx.draws.length,plants.length);assert.equal(scene.vegetationStats.overviewEntries,140);
  assert(ctx.draws.every(d=>d.length===5&&d[0].width<=129&&d[0].height<=129),'distant trees use a bounded raster, not a radial-gradient circle');
  const warm={canvases:calls.canvases,reads:calls.reads,gradients:calls.gradients,builds:scene.vegetationStats.overviewBuilds};
  for(const scale of [.323,.699,1.199,2.1]){
    ctx.draws.length=0;
    const paint=()=>scene.vegetation(ctx,[],scale,()=>true,plants);
    if(scale>=1.2)scene.withPreview(paint);else paint();
    assert.equal(ctx.draws.length,plants.length,'LOD must not hide trees to lower the draw count');
  }
  assert.deepEqual({canvases:calls.canvases,reads:calls.reads,gradients:calls.gradients,builds:scene.vegetationStats.overviewBuilds},warm);
  assert(scene.vegetationStats.overviewBytes<10*1024*1024);assert.equal(scene.vegetationStats.baseLayouts,0);
});

test('pending base time and live overlay time share two bounded light states instead of repeatedly rebaking the same hours',()=>{
  const {scene,calls,context}=harness(),ctx=context(),tree={point:[100,100],radius:4,height:12,variant:0};
  function paint(hour){
    scene.setTime(hour*3600);ctx.draws.length=0;scene.vegetation(ctx,[],.7,()=>true,[tree]);
    scene.treeSprite(77);return ctx.draws[0][0];
  }
  const morning=paint(9),afternoon=paint(16);
  for(const [hour,image] of [[9,morning],[16,afternoon]]){
    const cast=image.ctx.draws.find(d=>d[0].width===128&&d.length===5),offset=scene.shadowOffset(1,scene.lightingAt(hour*3600));
    assert(cast,'the cached plant contains its cast-shadow silhouette');
    assert.equal(Math.sign(cast[1]+cast[3]/2),Math.sign(offset[0]));
    assert.equal(Math.sign(cast[2]+cast[4]/2),Math.sign(offset[1]),'shadow direction is a world-sun vector, independent of tree variant');
  }
  const warm={canvases:calls.canvases,reads:calls.reads,gradients:calls.gradients};
  for(let i=0;i<5;i++){assert.equal(paint(9),morning);assert.equal(paint(16),afternoon);}
  assert.deepEqual({canvases:calls.canvases,reads:calls.reads,gradients:calls.gradients},warm);
  paint(11);
  assert.equal(scene.vegetationStats.overviewStates,2);assert.equal(scene.vegetationStats.sourceHours.length,2);
  assert.equal(scene.vegetationStats.sourceSprites,4,'evicted hours also release their full-resolution source sprites');
  assert.equal(scene.vegetationStats.sourceShadows,2);assert.equal(scene.vegetationStats.sourceMips,4);
  assert.equal(morning.width,1,'the oldest composite is disposed when a third lighting state arrives');
  assert(scene.vegetationStats.overviewBytes<=scene.vegetationStats.overviewBudget);
});

test('a refinement tile does not generate off-canvas gardens but retains trees whose shadows cross the tile edge',()=>{
  const {scene,calls,context}=harness(),ctx=context({width:192,height:192});
  const parcels=[parcel(),...Array.from({length:100},(_,i)=>parcel('outside-'+i,1000+i*100,1000))];
  scene.vegetation(ctx,parcels,2.1,()=>true);
  assert.equal(scene.vegetationStats.baseLayouts,1);assert.equal(calls.courtyards,1,'broad parent visibility cannot warm every surrounding garden');
  ctx.draws.length=0;
  scene.vegetation(ctx,[],.7,()=>true,[{point:[198,110],radius:3,height:18,variant:0},{point:[240,110],radius:3,height:18,variant:0}]);
  assert.equal(ctx.draws.length,1,'a root outside the tile still contributes the part of its crown or world shadow inside it');
  const affine=context({width:192,height:192},{a:2,b:.15,c:.1,d:1.5,e:-2000,f:-1500});
  scene.vegetation(affine,parcels,.7,()=>true);
  assert(scene.vegetationStats.baseLayouts<=4,'non-uniform affine transforms still cull distant source parcels before layout');
});

test('cold parcel layouts index remote facilities and court ids once and keep exact access avoidance after invalidation',()=>{
  let reads=0,ids=0;
  const tracked=(x,y)=>new Proxy([x,y],{get(target,key,receiver){if(key==='0'||key==='1')reads++;return Reflect.get(target,key,receiver);}});
  const facilities=Array.from({length:10000},(_,i)=>({kind:'school',points:[[0,0],[10,0],[10,10],[0,10],[0,0]].map(([x,y])=>tracked(100000+i*20+x,100000+y))}));
  const roadAccess={kind:'parking_lot',points:[[1000,1000],[1020,1000],[1020,1020],[1000,1020],[1000,1000]],accessPath:[[0,15],[80,15]],accessWidth:6};
  facilities.push(roadAccess);
  const sites=Array.from({length:10000},(_,i)=>({get id(){ids++;return 'remote-'+i;}}));
  sites.push({id:'garden',accessPath:[[15,0],[15,80]],accessWidth:3});
  const {scene,state}=harness({facilities,sites}),p=parcel(),before=JSON.stringify(p),roots=scene.treesFor(p,false);
  assert(roots.length>0);assert(reads>0&&reads<=10000*12,'one lightweight bounds pass covers the remote city');
  const warmed={reads,ids};
  for(let i=0;i<60;i++)scene.treesFor(parcel('cold-'+i),false);
  assert.deepEqual({reads,ids},warmed,'new nearby parcels do not rescan remote polygons or linearly find court ids');
  assert(scene.vegetationStats.facilityIndex.exactChecks<=61,'only the nearby access geometry reaches the exact checks');
  for(const root of roots){
    assert(scene.edgeDistance(root.point,roadAccess.accessPath)>=3+root.radius);
    assert(scene.edgeDistance(root.point,sites.at(-1).accessPath)>=1.5+root.radius*.6);
  }
  state.facilities=[...facilities,{kind:'school',points:p.points}];
  assert.equal(scene.treesFor(p,false).length,0,'a changed source array invalidates both obstacle lookup and root layout');
  assert.equal(JSON.stringify(p),before);
});
