const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const geometry=require('../renderer/city-geometry.js');

class RecordedPath {
  constructor(){this.rings=[];}
  moveTo(x,y){this.rings.push([[x,y]]);}
  lineTo(x,y){this.rings.at(-1).push([x,y]);}
  closePath(){}
}

function containsOrTouches(ring,point){
  if(geometry.containsPoint(point,ring))return true;
  return ring.some((a,i)=>{
    const b=ring[(i+1)%ring.length],dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
    const t=length?((point[0]-a[0])*dx+(point[1]-a[1])*dy)/length:0;
    return t>=-1e-8&&t<=1+1e-8&&Math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dy)<1e-7;
  });
}

function fixture(id='p-9'){
  return {id,center:[14,13],frontage:[14,-9],entrance:[14,0],
    points:[[-10,-10],[40,-10],[40,38],[-10,38],[-10,-10]],
    building:{use:'office',status:'active',floors:4,height:13.2,
      footprint:[[0,0],[28,0],[28,26],[0,26],[0,0]]}};
}

function harness({lot=null}={}){
  const calls={canvases:0,gradients:0,filters:[],roofVolumes:[],gardenPlans:0},events=[];
  const bed={points:[[-8,1],[-2,1],[-2,12],[-8,12],[-8,1]],bounds:[-8,1,-2,12]};
  function context(canvas={width:512,height:512},scale=1){
    let current=[],matrix={a:scale,b:0,c:0,d:scale,e:60,f:60};const stack=[];
    const ctx={canvas,fillStyle:null,strokeStyle:null,globalAlpha:1,lineWidth:1,
      getTransform:()=>({...matrix}),
      setTransform(a,b,c,d,e,f){matrix=typeof a==='object'?{...a}:{a,b,c,d,e,f};},
      save(){stack.push({matrix:{...matrix},fill:this.fillStyle,stroke:this.strokeStyle,alpha:this.globalAlpha,width:this.lineWidth});},
      restore(){const s=stack.pop();matrix=s.matrix;this.fillStyle=s.fill;this.strokeStyle=s.stroke;this.globalAlpha=s.alpha;this.lineWidth=s.width;},
      beginPath(){current=[];},moveTo(x,y){current.push([x,y]);},lineTo(x,y){current.push([x,y]);},closePath(){},
      fill(shape){events.push({kind:'fill',canvas,points:current.map(p=>p.slice()),shape:shape instanceof RecordedPath?shape:null,style:this.fillStyle,alpha:this.globalAlpha});},
      stroke(){events.push({kind:'stroke',canvas,points:current.map(p=>p.slice())});},
      fillRect(...rect){events.push({kind:'rect',canvas,rect});},
      drawImage(...args){events.push({kind:'image',canvas,args});},
      createLinearGradient(){calls.gradients++;return {addColorStop(){}};},
      clip(){},translate(){},rotate(){},transform(){},clearRect(){}};
    Object.defineProperty(ctx,'filter',{set(value){calls.filters.push(value);},get(){return 'none';}});
    return ctx;
  }
  const document={createElement(){calls.canvases++;const canvas={width:0,height:0};const ctx=context(canvas);canvas.getContext=()=>ctx;return canvas;}};
  const window={SceneMaterials:require('../renderer/material-catalog.js'),SurfaceVariation:require('../renderer/surface-variation.js'),
    SceneRasterCache:require('../renderer/raster-cache.js'),SceneMaterialPreparation:require('../renderer/material-preparation.js'),CityGeometry:geometry,
    CityScene3D:{parkingFor:()=>lot},
    CityOrdinaryRoofs:{drawCanvas(_ctx,_p,volume){calls.roofVolumes.push(volume);}},
    CityLandscape:{courtyard(_p,trees){calls.gardenPlans++;return {beds:[bed],trees};}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../renderer/scene-renderer.js'),'utf8'),{window,document,Path2D:RecordedPath});
  // Colour-only materials keep this a drawing-path regression. Object raster,
  // geometry, shadows and detailed roof dispatch still use production code.
  window.CityScene.configure({quality:'map'});
  return {scene:window.CityScene,calls,events,context,bed};
}

test('distant buildings preserve real setbacks without allocating per-building rasters or detailed roofs',()=>{
  const {scene,calls,events,context}=harness(),p=fixture(),before=JSON.stringify(p);
  const masses=geometry.buildingMassing(p),[lower,upper]=masses.volumes;
  assert.equal(masses.volumes.length,2,'fixture contains an occupied lower terrace and an upper storey');
  assert.equal(upper.base,lower.height);
  for(const scale of [.42,.7,1.199]){
    events.length=0;scene.building(context(undefined,scale),p,scale);
    const roofs=events.filter(e=>e.kind==='fill'&&e.points.length===5).map(e=>e.points);
    const expected=[lower,upper].map(v=>v.points.map(([x,y])=>[x,y-Math.min(85,v.height*.26)]));
    assert.deepEqual(roofs,expected,'the upper roof is painted after its true supporting terrace');
    assert(events.some(e=>e.kind==='fill'&&e.points.length===4),'facades still convey building height');
  }
  assert.equal(calls.canvases,0,'a cached overview must not create one canvas per building');
  assert.equal(calls.roofVolumes.length,0,'distant roofs do not build equipment or window detail');
  assert.equal(calls.gradients,0,'distant facades use broad surfaces');
  assert.equal(scene.stats.buildingCache.entries,0);
  assert.equal(JSON.stringify(p),before,'LOD must not rewrite saved geometry');
});

test('a distant parcel has the same appearance before and after its courtyard layout is warmed',()=>{
  const {scene,calls,events,context,bed}=harness(),p=fixture(),ctx=context();
  const drawing=()=>events.map(e=>({kind:e.kind,points:e.points,rect:e.rect}));
  scene.parcel(ctx,p,.7);const cold=drawing();
  assert.equal(calls.gardenPlans,0,'overview paving does not force a planting plan');
  assert.equal(calls.canvases,0);
  scene.treesFor(p);assert.equal(calls.gardenPlans,1);
  events.length=0;scene.parcel(ctx,p,.7);
  assert.deepEqual(drawing(),cold,'cache history cannot add or remove distant flower beds');
  assert.equal(calls.canvases,0);
  events.length=0;scene.withPreview(()=>scene.parcel(ctx,p,2.1));
  assert.deepEqual(drawing(),cold,'a high-scale preview uses the same lightweight parcel without a new bed bitmap');
  scene.parcel(ctx,p,2.1);
  assert.equal(calls.canvases,1,'nearby courtyard beds still use their detailed cache');
  assert(events.some(e=>e.kind==='fill'&&JSON.stringify(e.points)===JSON.stringify(bed.points)));
});

test('refinement tiles only prepare courtyard layouts for parcels intersecting their actual affine canvas bounds',()=>{
  const {scene,calls,context}=harness(),canvas={width:160,height:48};
  const views=[
    {name:'below a wide, short tile',matrix:[2,0,0,.5,60,60],visible:false},
    {name:'right of an anisotropic tile',matrix:[.5,0,0,2,171,10],visible:false},
    {name:'visible under unequal x/y scales',matrix:[2,0,0,.5,60,10],visible:true},
    {name:'only a one-pixel corner is visible',matrix:[2,0,0,.5,-79,-18],visible:true},
    {name:'a rotated parcel crosses the tile edge',matrix:[0,1,-1,0,17,10],visible:true}
  ];
  for(const view of views){
    const ctx=context(canvas),before=calls.gardenPlans;ctx.setTransform(...view.matrix);
    scene.parcel(ctx,fixture(view.name),2.1);
    assert.equal(calls.gardenPlans-before,view.visible?1:0,view.name);
  }
});

test('each distant building shares one world-sun silhouette and skips construction and night without a screen bitmap',()=>{
  const {scene,calls,events,context}=harness(),p=fixture(),ctx=context();
  scene.configure({quality:'high'});
  const construction=fixture('construction');construction.building.status='construction';
  construction.building.footprint=construction.building.footprint.map(([x,y])=>[x+1000,y+1000]);
  const m=geometry.buildingMassing(p);
  for(const hour of [9,16]){
    scene.setTime(hour*3600);events.length=0;scene.buildingShadows(ctx,[p,construction],.7);
    const fills=events.filter(e=>e.kind==='fill');assert.equal(fills.length,1,'one building merges its own overlapping masses');
    const rings=fills[0].shape.rings;
    for(const [index,volume] of m.volumes.entries()){
      const v=scene.shadowOffset(volume.height),expected=[...volume.points,...volume.points.map(([x,y])=>[x+v[0],y+v[1]])];
      const ring=rings[index];
      assert(expected.every(point=>containsOrTouches(ring,point)),'each real mass and its sun projection stay inside their exact shadow silhouette');
      const [x0,y0,x1,y1]=volume.rect,area=(x1-x0)*(y1-y0)+Math.abs(v[0])*(y1-y0)+Math.abs(v[1])*(x1-x0);
      assert(Math.abs(geometry.polygonArea(ring)-area)<1e-7,'simplifying the projection must not inflate it into a bounding box');
    }
    assert.equal(rings.length,m.volumes.length,'each rectangular volume uses one exterior contour instead of overlapping faces');
    assert(rings.every(r=>r.length<=8),'a rectangular prism stays a small convex projection');
    assert(rings.every(r=>r.every(([x,y])=>x<1000&&y<1000)),'construction contributes no solar silhouette');
  }
  scene.setTime(23*3600);events.length=0;scene.buildingShadows(ctx,[p],.7);assert.equal(events.length,0);
  assert.equal(calls.canvases,0);assert.equal(calls.gradients,0);assert.equal(calls.filters.length,0);
});

test('distant shadow geometry is reused across zoom levels and refreshed with the sampled world sun',()=>{
  const {scene,events,context}=harness(),p=fixture(),ctx=context();scene.configure({quality:'high'});
  scene.setTime(9*3600);scene.buildingShadows(ctx,[p],.7);const original=events.at(-1).shape;
  for(const scale of [.42,.86,1.19]){
    events.length=0;scene.setTime(9*3600+30);scene.buildingShadows(ctx,[p],scale);
    assert.equal(events.at(-1).shape,original,'zoom changes cannot force a fresh extrusion within the base lighting sample');
  }
  scene.setTime(9*3600+60);events.length=0;scene.buildingShadows(ctx,[p],.7);
  assert.notEqual(events.at(-1).shape,original,'the next base light sample updates solar direction');
  assert.notDeepEqual(events.at(-1).shape.rings,original.rings);
});

test('more distant buildings increase shadow batches rather than the complexity of a single Canvas path',()=>{
  const {scene,calls,events,context}=harness(),ctx=context();scene.configure({quality:'high'});
  const parcels=Array.from({length:64},(_,i)=>{
    const p=fixture(),dx=i%8*80,dy=Math.floor(i/8)*80;
    p.center=p.center.map((v,ch)=>v+(ch?dy:dx));
    p.building.footprint=p.building.footprint.map(([x,y])=>[x+dx,y+dy]);return p;
  });
  scene.buildingShadows(ctx,[parcels[0]],.7);
  const one=events.find(e=>e.kind==='fill'),maxRings=one.shape.rings.length;
  assert(maxRings>1,'fixture includes the roof and extruded sides of its actual masses');
  for(const count of [8,64]){
    events.length=0;scene.buildingShadows(ctx,parcels.slice(0,count),.7);
    const fills=events.filter(e=>e.kind==='fill');
    assert.equal(fills.length,count,'each building is submitted as a bounded rasterization batch');
    assert.equal(new Set(fills.map(e=>e.shape)).size,count,'a previous batch cannot keep accumulating later buildings');
    assert(fills.every(e=>e.shape.rings.length<=maxRings),'path complexity is independent of the number of buildings');
    assert(fills.every(e=>e.style===one.style&&e.alpha===one.alpha),'separate batches share the same solar opacity');
  }
  assert.equal(calls.canvases,0);assert.equal(calls.gradients,0);assert.equal(calls.filters.length,0);
});

test('switching out of the distant band restores detailed roof and facade caches at the existing near scales',()=>{
  for(const scale of [1.2,2.1,13.5]){
    const {scene,calls,context}=harness(),p=fixture();scene.building(context(undefined,.7),p,.7);
    scene.building(context(undefined,scale),p,scale);
    assert.deepEqual(calls.roofVolumes,geometry.buildingMassing(p).volumes,'all detailed roofs resume above the LOD boundary');
    assert.equal(calls.canvases,1,'the detailed building keeps its existing raster cache');
    assert(calls.gradients>0,'near walls retain their glass and shading');
    const allocations=calls.canvases,roofCalls=calls.roofVolumes.length;
    scene.building(context(undefined,scale),p,scale);
    assert.equal(calls.canvases,allocations);assert.equal(calls.roofVolumes.length,roofCalls,'a repeat near view uses its cached building');
  }
});

test('temporary previews restore nested and exceptional state without changing quality or freezing near detail',()=>{
  const {scene,calls,context}=harness(),p=fixture(),ctx=context();
  scene.configure({quality:'high',labels:true});scene.resolveQuality(2.1);
  const settings=scene.settings,quality=scene.effectiveQuality,marker={done:true};
  const result=scene.withPreview(()=>{
    scene.building(ctx,p,2.1);scene.buildingShadows(ctx,[p],2.1);
    assert.throws(()=>scene.withPreview(()=>{throw new Error('nested preview failed');}),/nested preview failed/);
    scene.building(ctx,p,2.1);
    assert.deepEqual(scene.settings,settings);assert.equal(scene.effectiveQuality,quality);
    return marker;
  });
  assert.equal(result,marker);assert.equal(calls.canvases,0);assert.equal(calls.roofVolumes.length,0);
  assert.throws(()=>scene.withPreview(()=>{throw new Error('outer preview failed');}),/outer preview failed/);
  assert.deepEqual(scene.settings,settings);assert.equal(scene.effectiveQuality,quality);
  scene.configure({quality:'map'}); // Avoid colour-texture generation in the recording context.
  scene.building(ctx,p,2.1);
  assert.deepEqual(calls.roofVolumes,geometry.buildingMassing(p).volumes,'normal rendering resumes the full near path after any preview exit');
  assert.equal(calls.canvases,1);
});

test('distant parking retains its ground without warming vehicle sprites',()=>{
  const lot={point:[14,-5],width:26,depth:10.8,angle:.7};
  const {scene,calls,events,context}=harness({lot});scene.building(context(),fixture(),.7);
  assert.deepEqual(events.filter(e=>e.kind==='rect').map(e=>e.rect),[[-13,-5.4,26,10.8]]);
  assert.equal(scene.stats.vehicleSprites,0);assert.equal(scene.stats.vehicleLighting.entries,0);assert.equal(calls.canvases,0);
});
