const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

// Exercise the production coordination helpers without booting the DOM or
// simulation. Canvas geometry/budget behaviour has its own renderer tests.
const source=fs.readFileSync(require.resolve('../renderer/app.js'),'utf8');
function production(name){
  const start=source.indexOf(`function ${name}(`),body=source.indexOf('{',start);let depth=1,end=body+1;
  assert(start>=0);
  while(depth&&end<source.length){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++;}
  return source.slice(start,end);
}
function harness(extra={}){
  const scene={time:9*3600+25,setTime(value){this.time=value;},withPreview(paint){return paint();}};
  const calls={invalidations:0,refreshes:0};
  const context={window:{CityScene:scene},baseLightMinute:null,baseMaterialRevision:null,sceneRevision:0,baseSceneRevision:null,drag:null,zooming:false,
    frameDraw:{request(){}},
    panCache:{pending:0,invalidate(){this.pending=0;calls.invalidations++;},refresh(){this.pending=10;calls.refreshes++;return true;}},
    ...extra};
  vm.runInNewContext(['paintCachedBase','invalidatePan','sampleBaseLight','baseNeedsRefresh','requestSceneRefresh','rebaseViewportPan','setZoom'].map(production).join('\n'),context);
  return {context,scene,calls};
}

test('fast light ticks finish the current detail batch before accepting the latest sun sample',()=>{
  const {context:c,scene,calls}=harness();c.sampleBaseLight(true);
  assert.equal(c.baseLightMinute,540);assert.equal(calls.invalidations,1);
  c.panCache.pending=8;
  for(let i=1;i<=20;i++){scene.time+=60;c.sampleBaseLight(true);}
  assert.equal(c.baseLightMinute,540);assert.equal(c.panCache.pending,8);
  assert.equal(calls.invalidations,1,'a fast clock cannot continually discard unfinished outer tiles');
  c.panCache.pending=0;c.sampleBaseLight(true);
  assert.equal(c.baseLightMinute,560);assert.equal(calls.refreshes,1);
  assert.equal(calls.invalidations,1,'light refresh retains the last detailed image');
  c.invalidatePan();scene.time+=60;c.sampleBaseLight(true);
  assert.equal(c.baseLightMinute,561);assert.equal(calls.invalidations,3,'explicit content/settings edits cancel the batch immediately');
});

test('all tiles share one sampled light while live traffic keeps its clock, including after paint failure',()=>{
  let seen;const {context:c,scene}=harness({paintMap(ctx,g,phase){seen={time:c.window.CityScene.time,phase};return 42;}});
  c.baseLightMinute=540;
  scene.time=10*3600+17;
  assert.equal(c.paintCachedBase({},{}),42);assert.deepEqual(seen,{time:9*3600,phase:'base'});
  assert.equal(scene.time,10*3600+17);
  c.paintMap=()=>{assert.equal(scene.time,9*3600);throw Error('paint failed');};
  assert.throws(()=>c.paintCachedBase({},{},true),/paint failed/);
  assert.equal(scene.time,10*3600+17,'an interrupted tile must never rewind the simulation/overlay clock');
});

test('wheel zoom during a held drag preserves both the zoom anchor and the pointer displacement',()=>{
  const c=harness({terrain:{},zoom:2,panX:20,panY:40,map:{clientWidth:1000,clientHeight:700},drag:{panX:10,panY:15},zooming:false,zoomSettleTimer:null,
    clampPan(){},clearTimeout(){},setTimeout(){return 1;},requestDraw(){},requestAnimation(){}}).context;
  const anchor=[700,500],offset=[c.panX-c.drag.panX,c.panY-c.drag.panY];
  const world=[(anchor[0]-500-c.panX)/c.zoom,(anchor[1]-350-c.panY)/c.zoom];
  c.setZoom(4,...anchor);
  assert.equal(500+c.panX+world[0]*c.zoom,anchor[0]);assert.equal(350+c.panY+world[1]*c.zoom,anchor[1]);
  assert.equal(c.drag.panX+offset[0],c.panX);assert.equal(c.drag.panY+offset[1],c.panY,'the next pointer event keeps the zoomed pan instead of restoring the old origin');
});

test('completed worker materials and a paused clock finish the current batch before refreshing',()=>{
  const {context:c,scene,calls}=harness();scene.materialRevision=1;c.sampleBaseLight(true);
  c.panCache.pending=8;
  for(let i=2;i<=12;i++){scene.materialRevision=i;c.sampleBaseLight(true);}
  scene.time+=60;c.sampleBaseLight(true);
  assert.equal(c.panCache.pending,8);assert.equal(calls.refreshes,0);
  c.panCache.pending=0;
  assert(c.baseNeedsRefresh(),'the last tile must request a frame even if the simulation has paused');
  c.sampleBaseLight(true);assert.equal(calls.refreshes,1);
  assert.equal(c.baseMaterialRevision,12);assert.equal(c.baseLightMinute,541);
  assert.equal(c.baseNeedsRefresh(),false);
});

test('resizing while holding a drag preserves its current pointer displacement after clamping',()=>{
  const c=harness({panX:90,panY:-40,drag:{panX:70,panY:-35},clampPan(){}}).context;
  c.clampPan=()=>{c.panX=Math.min(c.panX,120);};
  const offset=[c.panX-c.drag.panX,c.panY-c.drag.panY];c.rebaseViewportPan(1.5);
  assert.equal(c.panX,120);assert.equal(c.panY,-60);
  assert.equal(c.drag.panX+offset[0],c.panX);assert.equal(c.drag.panY+offset[1],c.panY);
});


test('new material and sun generations wait until a held gesture finishes',()=>{
  const {context:c,scene,calls}=harness();let commits=0;scene.commitMaterials=()=>commits++;
  scene.materialRevision=1;c.sampleBaseLight(true);assert.equal(commits,1);
  for(const gesture of ['drag','zooming']){
    c[gesture]=true;scene.materialRevision++;scene.time+=60;c.sampleBaseLight(true);
    assert(c.baseNeedsRefresh());assert.equal(c.panCache.pending,0);
    c[gesture]=false;c.sampleBaseLight(true);assert.equal(c.baseNeedsRefresh(),false);
    c.panCache.pending=0;
  }
  assert.equal(commits,3);assert.equal(calls.refreshes,2);
});


test('distant detail keeps its existing texture through material refresh too',()=>{
  const {context:c,scene,calls}=harness();scene.materialRevision=1;c.sampleBaseLight(false);
  scene.materialRevision=2;c.sampleBaseLight(false);
  assert.equal(calls.invalidations,1);assert.equal(calls.refreshes,1);
});

test('daily settlements retain textures and coalesce updates without starving unfinished tiles',()=>{
  const {context:c,calls}=harness();c.sampleBaseLight(true);
  const initialInvalidations=calls.invalidations;
  c.requestSceneRefresh();assert(c.baseNeedsRefresh());c.sampleBaseLight(true);
  assert.equal(calls.refreshes,1);assert.equal(c.panCache.pending,10);
  for(let day=0;day<20;day++){
    c.panCache.pending=10-day%10;
    c.requestSceneRefresh();c.sampleBaseLight(true);
    assert.equal(c.panCache.pending,10-day%10,'a newer day cannot restart the active batch');
  }
  assert.equal(calls.invalidations,initialInvalidations,'settlements never discard finished textures');
  assert.equal(calls.refreshes,1);
  c.panCache.pending=0;assert(c.baseNeedsRefresh(),'the newest day still needs a frame after pausing');
  c.sampleBaseLight(true);
  assert.equal(calls.refreshes,2);assert.equal(c.baseSceneRevision,21);
  assert.equal(c.baseNeedsRefresh(),false);
  c.panCache.pending=0;c.sampleBaseLight(true);assert.equal(calls.refreshes,2);
});

test('a daily update waits for camera gestures but manual edits still invalidate immediately',()=>{
  const {context:c,calls}=harness();c.sampleBaseLight(true);
  c.drag={};c.requestSceneRefresh();c.sampleBaseLight(true);
  assert.equal(calls.refreshes,0);assert(c.baseNeedsRefresh());
  c.drag=null;c.sampleBaseLight(true);assert.equal(calls.refreshes,1);
  c.invalidatePan();assert.equal(c.panCache.pending,0);assert.equal(c.baseSceneRevision,null);
  c.sampleBaseLight(true);assert.equal(c.baseSceneRevision,c.sceneRevision);
});

test('real viewport cache paints the newest daily scene without returning to coarse previews',()=>{
  const {createPanCache}=require('../renderer/frame-scheduler.js');
  let day=0,time=0,previews=0;const painted=[];
  const createCanvas=()=>({width:0,height:0,getContext:()=>({setTransform(){},clearRect(){},save(){},restore(){},beginPath(){},rect(){},clip(){},drawImage(){}})});
  const cache=createPanCache(()=>painted.push(day),{createCanvas,incremental:true,padding:0,tileSize:100,
    previewPaint:()=>previews++,now:()=>time+=10});
  const {context:c}=harness({panCache:cache});
  c.sampleBaseLight(true);cache.prepare({width:300,height:200,scale:3,left:-100,top:-100},1,true);
  while(cache.pending)cache.refine();
  const fullPaints=cache.stats.fullPaints;
  for(day=1;day<=20;day++){
    c.requestSceneRefresh();c.sampleBaseLight(true);cache.refine();
    assert.equal(cache.stats.fullPaints,fullPaints);
  }
  day=20;
  while(cache.pending)cache.refine();
  if(c.baseNeedsRefresh())c.sampleBaseLight(true);
  while(cache.pending)cache.refine();
  assert.equal(previews,1,'only the initial cold viewport needs a preview');
  assert(painted.slice(-6).every(value=>value===20),'all six tiles eventually show the latest city after pausing');
  assert.equal(cache.stats.fullPaints,fullPaints);
  assert.equal(c.baseNeedsRefresh(),false);
  assert(cache.stats.bytes<=cache.stats.budget);
});
