// Real pointer/wheel diagnostics in an isolated save directory. No synthetic
// focus calls inside timed gestures, no forced redraw loop, no user save writes.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'shanhai-gestures-'));
const output=path.join(root,'output/playwright',process.env.INTERACTION_OUTPUT||'detail-interaction');
const center=JSON.parse(process.env.INTERACTION_CENTER||'[2260,2395]');
const pixelRatio=Number(process.env.INTERACTION_DPR)||2;
const followTraffic=process.env.INTERACTION_FOLLOW_TRAFFIC==='1';
const targets={inputRafP95Ms:33.4,settleLongTaskMs:100};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,ms)));
const timingSummary=values=>{const a=values.slice().sort((a,b)=>a-b),round=n=>Math.round(n*100)/100;return {count:a.length,meanMs:round(a.length?a.reduce((sum,n)=>sum+n,0)/a.length:0),medianMs:round(a[Math.floor(a.length*.5)]||0),p95Ms:round(a[Math.min(a.length-1,Math.floor(a.length*.95))]||0),maxMs:round(a.at(-1)||0)};};
const metricDefinitions={
 inputToRaf:'DOM event.timeStamp to a diagnostic RAF registered after app listeners (after app painting when queued); includes browser/automation event routing, queueing and app work. The 33.4 ms P95 target remains on this total. This does not measure display scan-out.',
 eventToDispatch:'Event timestamp to an early window capture listener installed before app scripts. Includes pre-dispatch browser/automation delay; it cannot by itself attribute that delay solely to Playwright.',
 dispatchToHandler:'Early capture to the canvas listener registered after app listeners; includes event propagation and synchronous app handlers.',
 handlerToRaf:'After-app canvas listener to diagnostic RAF; excludes prior event queueing and synchronous handlers. Diagnostic only, not a replacement acceptance target.',
 dispatchToRaf:'Early capture to diagnostic RAF; includes app event handling and subsequent frame work.',
 pipeline:'The three stage means sum to inputToRaf.meanMs within rounding; stage medians/P95 values must not be added or subtracted to infer a stage cost.',
 frames:'Intervals between RAF callbacks; smooth cadence does not prove low input latency.',
 driverCommand:'Node-side awaited mouse.move/wheel completion time; includes automation protocol and browser acknowledgement/backpressure, not just app work.',
 fullPaints:'Whole-base paint count, including initial entry or invalidation; zoomCopies counts retained-image resampling with only exposed strips filled.'
};
fs.mkdirSync(output,{recursive:true});
(async()=>{
 let browser;
 const server=spawn(path.join(root,'.venv/bin/python'),['backend/server.py','--preview','--port','0'],{cwd:root,env:{...process.env,SHANHAI_DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
 let log='';server.stderr.on('data',data=>log+=data);
 try{
  const ready=await new Promise((resolve,reject)=>{require('node:readline').createInterface({input:server.stdout}).once('line',line=>resolve(JSON.parse(line)));server.once('error',reject);server.once('exit',code=>reject(Error(`${code}: ${log}`)));});
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:pixelRatio});page.setDefaultTimeout(120000);
  const cpu=process.env.INTERACTION_CPU_PROFILE==='1'?await page.context().newCDPSession(page):null;
  if(cpu)await cpu.send('Profiler.enable');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.interactionCanvasAllocations=0;window.interactionWebglContexts=0;
   const dispatchTimes=new WeakMap();window.interactionDispatchAt=event=>dispatchTimes.get(event);
   for(const type of ['pointermove','wheel'])window.addEventListener(type,event=>dispatchTimes.set(event,performance.now()),{capture:true,passive:true});
   const create=document.createElement.bind(document);document.createElement=function(tag,...args){if(tag==='canvas')window.interactionCanvasAllocations++;return create(tag,...args);};
   const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(['webgl','webgl2'].includes(type))window.interactionWebglContexts++;return get.call(this,type,...args);};
  });
  await page.goto(`http://127.0.0.1:${ready.port}`,{waitUntil:'networkidle'});
  console.log('Loaded renderer scripts');
  let file=process.env.INTERACTION_FIXTURE||path.join(root,'tests/fixtures/lighting-materials-city.json');
  if(file.endsWith('.gz')){const unpacked=path.join(temp,'city.json');fs.writeFileSync(unpacked,zlib.gunzipSync(fs.readFileSync(file)));file=unpacked;}
  const importing=page.waitForResponse(r=>r.url().endsWith('/api/city/import'));
  await page.locator('#city-import-file').setInputFiles(file);
  const imported=await importing;if(!imported.ok())throw Error(await imported.text());
  await page.waitForFunction(()=>CityApp.active&&!CityApp.working&&CityScene.assetsReady&&CityScene.stats.vehicleAtlases.length===3&&CityOrdinaryRoofs.ready&&CityStreetFurniture.assetsReady);
  await page.locator('[data-tool="pan"]').first().click();
  const city=await page.evaluate(()=>({buildings:CityApp.state.parcels.filter(p=>p.building).length,roads:CityApp.state.roads.length,webglContexts:window.interactionWebglContexts,initialQuality:CityScene.effectiveQuality}));
  console.log('Ready '+JSON.stringify(city));
  const viewPolicy=await page.evaluate(()=>{
   const t=MapWorkspace.terrain,c=document.getElementById('map');
   const fit=Math.max(c.clientWidth/t.width,c.clientHeight/t.height)*Math.min(t.width/t.grid.widthMeters,t.height/t.grid.heightMeters);
   const displayedDetailZoom=CityScene.detailZoom||72;
   return {policy:'actual',detailBoundary:fit*displayedDetailZoom,displayedDetailZoom};
  });
  await page.evaluate(profile=>{
   let detailPaints=0;
   const stats=()=>{const scene=CityScene.stats;return {scene:{quality:CityScene.effectiveQuality,canCache:CityApp.canCacheBase,baseNeedsRefresh:CityScene.effectiveQuality==='high'&&typeof baseNeedsRefresh==='function'&&baseNeedsRefresh(),vegetation:CityScene.vegetationStats,detailPaints,materialPreparation:scene.materialPreparation?structuredClone(scene.materialPreparation):null},pan:MapWorkspace.panCacheStats,building:scene.buildingCache,furniture:CityStreetFurniture.stats,road:RoadRenderer.detailStats,canvasAllocations:window.interactionCanvasAllocations,geometry:{...MapWorkspace.geometry}};};
   const summary=values=>{const a=values.slice().sort((a,b)=>a-b),round=n=>Math.round(n*100)/100;return {count:a.length,meanMs:round(a.length?a.reduce((sum,n)=>sum+n,0)/a.length:0),medianMs:round(a[Math.floor(a.length*.5)]||0),p95Ms:round(a[Math.min(a.length-1,Math.floor(a.length*.95))]||0),maxMs:round(a.at(-1)||0),over33ms:a.filter(n=>n>33.4).length,over50ms:a.filter(n=>n>50).length,over100ms:a.filter(n=>n>100).length};};
   let active=null;const tasks=[];
   new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
   let phase='all',costs=null;
   if(profile)for(const [prefix,object,keys] of [['scene',CityScene,['streetsideGround','parcel','facilityGround','streetsideParking','buildingShadows','building','vegetation','medians','atmosphere']],['roads',RoadRenderer,['paint']],['furniture',CityStreetFurniture,['paint']],['roofs',CityOrdinaryRoofs,['drawCanvas']],['surface',SurfaceVariation,['synthesize']]])for(const key of keys){
    const original=object[key];object[key]=function(...args){const start=performance.now();try{return original.apply(this,args);}finally{if(costs)costs[prefix+'.'+key]=(costs[prefix+'.'+key]||0)+performance.now()-start;}};
   }
   const original=CityApp.paint;CityApp.paint=function(...args){const start=performance.now();if(CityScene.effectiveQuality==='high')detailPaints++;phase=args[2]||'all';costs=profile?{}:null;try{return original.apply(this,args);}finally{if(active)active.paints.push({at:start,ms:performance.now()-start,phase,costs});phase='all';costs=null;}};
   const vehicle=CityScene.vehicle;CityScene.vehicle=function(ctx,car,...args){if(active&&phase==='overlay'&&car.point){const m=ctx.getTransform(),[wx,wy]=car.point,x=m.a*wx+m.c*wy+m.e,y=m.b*wx+m.d*wy+m.f;if(x>=0&&y>=0&&x<=ctx.canvas.width&&y<=ctx.canvas.height){const key=String(car.id),point=car.point.join(',');if(active.vehicles.has(key)&&active.vehicles.get(key)!==point)active.vehicleMoves++;active.vehicles.set(key,point);}}return vehicle.call(this,ctx,car,...args);};
   const canvas=document.getElementById('map');
   for(const type of ['pointermove','wheel'])canvas.addEventListener(type,event=>{
    if(!active||(type==='pointermove'&&!event.buttons))return;
    const phase=active,handled=performance.now(),dispatched=window.interactionDispatchAt(event)??handled;
    const validTimestamp=Number.isFinite(event.timeStamp)&&event.timeStamp>0&&event.timeStamp<=dispatched,start=validTimestamp?event.timeStamp:dispatched;phase.inputs++;
    if(!validTimestamp)phase.timestampFallbacks++;
    if(phase.previousDispatch!==null)phase.dispatchIntervals.push(dispatched-phase.previousDispatch);phase.previousDispatch=dispatched;
    if(type==='wheel')phase.wheelDeltaY+=event.deltaY;
    // Registered after the app's input listeners so its paint RAF goes first.
    // Include queueing and the app's handler using the real event timestamp.
    // The endpoint is a diagnostic RAF after any queued app paint, not scan-out.
    requestAnimationFrame(()=>{if(phase===active){
     const painted=performance.now();phase.latency.push(painted-start);
     phase.eventToDispatch.push(dispatched-start);phase.dispatchToHandler.push(handled-dispatched);
     phase.handlerToRaf.push(painted-handled);phase.dispatchToRaf.push(painted-dispatched);
    }});
   },{passive:true});
   function sample(now){if(active){if(active.previous!==null)active.frames.push({at:now,ms:now-active.previous});active.previous=now;}requestAnimationFrame(sample);}requestAnimationFrame(sample);
   window.interactionMeasure={
    begin(){active={start:performance.now(),before:stats(),previous:null,previousDispatch:null,frames:[],paints:[],latency:[],eventToDispatch:[],dispatchToHandler:[],handlerToRaf:[],dispatchToRaf:[],dispatchIntervals:[],timestampFallbacks:0,inputs:0,wheelDeltaY:0,vehicles:new Map(),vehicleMoves:0};},
    release(){active.end=performance.now();active.atRelease=stats();active.vehicleMovesDuringInput=active.vehicleMoves;},
    end(){const p=active;active=null;const after=stats();return {durationMs:Math.round(p.end-p.start),inputs:p.inputs,frames:summary(p.frames.filter(f=>f.at<=p.end).map(f=>f.ms)),settleFrames:summary(p.frames.filter(f=>f.at>p.end).map(f=>f.ms)),inputToRaf:summary(p.latency),paint:summary(p.paints.filter(f=>f.at<=p.end).map(f=>f.ms)),basePaint:summary(p.paints.filter(f=>f.at<=p.end&&f.phase==='base').map(f=>f.ms)),overlayPaint:summary(p.paints.filter(f=>f.at<=p.end&&f.phase==='overlay').map(f=>f.ms)),settlePaint:summary(p.paints.filter(f=>f.at>p.end).map(f=>f.ms)),vehicleMoves:p.vehicleMoves,visibleVehicles:p.vehicles.size,longTasks:tasks.filter(t=>t.start>=p.start&&t.start<=p.end).map(t=>({atMs:Math.round(t.start-p.start),durationMs:Math.round(t.duration)})),before:p.before,atRelease:p.atRelease,after,cacheDelta:{builds:after.pan.builds-p.before.pan.builds,hits:after.pan.hits-p.before.pan.hits,scrolls:(after.pan.scrolls||0)-(p.before.pan.scrolls||0),canvasAllocations:after.canvasAllocations-p.before.canvasAllocations}};}
   };
   const finish=window.interactionMeasure.end;window.interactionMeasure.end=function(){
    const p=active,result=finish(),now=performance.now(),counters=['builds','refinements','fullPaints','zoomCopies'];
    const difference=(from,to)=>Object.fromEntries(counters.map(key=>[key,Number.isFinite(to[key])&&Number.isFinite(from[key])?to[key]-from[key]:null]));
    Object.assign(result.cacheDelta,difference(p.before.pan,result.after.pan));
    return {...result,eventToDispatch:summary(p.eventToDispatch),dispatchToHandler:summary(p.dispatchToHandler),handlerToRaf:summary(p.handlerToRaf),dispatchToRaf:summary(p.dispatchToRaf),inputDispatchIntervals:summary(p.dispatchIntervals),eventTimestampFallbacks:p.timestampFallbacks,
     cacheDuringInput:difference(p.before.pan,p.atRelease.pan),cacheDuringSettle:difference(p.atRelease.pan,result.after.pan),
     settleObservedMs:Math.round(now-p.end),settleLongTasks:tasks.filter(t=>t.start>p.end&&t.start<=now).map(t=>({atMs:Math.round(t.start-p.end),durationMs:Math.round(t.duration)})),observedWheelDeltaY:p.wheelDeltaY,vehicleMovesDuringInput:p.vehicleMovesDuringInput,...(profile?{slowPaints:p.paints.filter(p=>p.ms>25)}:{})};
   };
  },process.env.INTERACTION_PROFILE==='1');
  const waitReady=async()=>{
   const ready=()=>{const preparation=CityScene.stats.materialPreparation;return !MapWorkspace.panCacheStats?.pending&&(!preparation||!preparation.pending&&!preparation.active)&&(CityScene.effectiveQuality!=='high'||typeof baseNeedsRefresh!=='function'||!baseNeedsRefresh());};
   await page.waitForFunction(ready);
   // Allow queued paint/observer callbacks to run before confirming quiescence.
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   await page.waitForFunction(ready);
  };
  const focus=async scale=>{
   const selected=await page.evaluate(({scale,center,follow})=>{
    const t=MapWorkspace.terrain,c=document.getElementById('map'),car=follow?CityApp.traffic?.vehicles.filter(v=>v.speed>.5&&v.point&&!v.parked).sort((a,b)=>a.speed-b.speed)[0]:null,point=car?car.point:center;
    if(follow&&!car)throw Error('Follow-traffic diagnostic requires a moving vehicle before preparing the view');
    const fit=Math.max(c.clientWidth/t.width,c.clientHeight/t.height),worldScale=fit*Math.min(t.width/t.grid.widthMeters,t.height/t.grid.heightMeters);
    CityScene.configure({quality:'high',renderer:'textures'});MapWorkspace.focus(point,scale/worldScale);
    const g=MapWorkspace.geometry;
    return {center:point,car:car?.id??null,...(follow?{carSpeed:car.speed,pausedDuringPreparation:!document.getElementById('city-play').textContent.includes('暂停')}:{}),requestedScale:scale,scale:Math.min(t.width*g.scale/t.grid.widthMeters,t.height*g.scale/t.grid.heightMeters),zoom:g.scale/fit};
   },{scale,center,follow:followTraffic});
   await waitReady();await delay(200);await waitReady();return selected;
  };
  const results=[],boundary=viewPolicy.detailBoundary,closeScale=Math.max(13.5,boundary*1.5),neighborhoodScale=Math.max(2.1,boundary*1.05);
  const wheelOutScale=Math.max(13.5,boundary*3);
  const plans=[
   {name:'quality-in',scale:boundary*.5,kind:'wheel',delta:-26,steps:60},
   {name:'short-pan-close',scale:closeScale,kind:'pan',distance:120,steps:45},
   {name:'long-pan-close',scale:closeScale,kind:'pan',distance:660,steps:60},
   {name:'long-pan-neighborhood',scale:neighborhoodScale,kind:'pan',distance:660,steps:60},
   {name:'wheel-in',scale:Math.max(4.8,neighborhoodScale),kind:'wheel',delta:-15,steps:60},
   {name:'wheel-out',scale:wheelOutScale,kind:'wheel',delta:Math.log(wheelOutScale/neighborhoodScale)/.072,steps:60},
   {name:'quality-out',scale:boundary*1.2,kind:'wheel',delta:26,steps:60},
  ];
  // When selected, cold quality-in runs first, before any detail view can warm
  // the material caches. Subsequent modes intentionally measure warm revisits.
  const selectedPlans=(process.env.INTERACTION_CASES?process.env.INTERACTION_CASES.split(',').map(name=>{
   const plan=plans.find(p=>p.name===name);assert(plan,`unknown interaction case: ${name}`);return plan;
  }):plans).sort((a,b)=>Number(b.name==='quality-in')-Number(a.name==='quality-in'));
  const preparationErrors=p=>Array.isArray(p?.errors)?p.errors.length:Number(p?.errors)||0;
  const acceptance=()=>{
   const cold=results.find(r=>r.coldQualityIn);
   const inputFailures=results.filter(r=>!r.acceptance.inputRafP95).map(r=>({mode:r.mode,name:r.name,p95Ms:r.inputToRaf.p95Ms}));
   const settleFailures=results.filter(r=>!r.acceptance.settleLongTasks).map(r=>({mode:r.mode,name:r.name,tasks:r.settleLongTasks.filter(t=>t.durationMs>targets.settleLongTaskMs)}));
   const ready=results.every(r=>r.acceptance.ready&&r.acceptance.materialErrors===0);
   return {targets,inputRafP95:{passed:inputFailures.length===0,failures:inputFailures},coldQualityIn:{measured:Boolean(cold),...(cold?{mode:cold.mode,inputRafP95Ms:cold.inputToRaf.p95Ms,settleObservedMs:cold.settleObservedMs,materialPreparation:cold.after.scene.materialPreparation}:{})},settleLongTasks:{passed:settleFailures.length===0,failures:settleFailures},ready,passed:results.length>0&&Boolean(cold)&&!inputFailures.length&&!settleFailures.length&&ready};
  };
  const report=extra=>({viewport:[1600,1000],pixelRatio,center,city,viewPolicy,metricDefinitions,results,acceptance:acceptance(),...extra,errors});
  const modes=(process.env.INTERACTION_MODES||'paused,running').split(',');
  for(const mode of modes){
   const running=await page.locator('#city-play').textContent();
   if((mode==='running')!==running.includes('暂停'))await page.locator('#city-play').click();
   for(const plan of selectedPlans){
    if(followTraffic&&mode==='running'){
     // At 7200% a small city shows only a few metres. Freeze the car while
     // materials/tiles warm; otherwise it leaves the view before input begins.
     await page.waitForFunction(()=>CityApp.traffic?.vehicles.some(v=>v.speed>.5&&v.point&&!v.parked));
     await page.evaluate(()=>{const button=document.getElementById('city-play');if(button.textContent.includes('暂停'))button.click();});
     await waitReady();
    }
    const view=await focus(plan.scale);
    const box=await page.locator('#map').boundingBox(),x=box.x+box.width*.66,y=box.y+box.height*.54;
    assert(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.id==='map',{x,y}),'gesture starts on exposed map canvas');
    await page.mouse.move(x,y);await delay(100);
    if(cpu)await cpu.send('Profiler.start');
    await page.evaluate(resume=>{
     // Setup uses the real play control without moving the prepared pointer.
     if(resume){const button=document.getElementById('city-play');if(!button.textContent.includes('暂停'))button.click();}
     interactionMeasure.begin();
    },followTraffic&&mode==='running');
    if(plan.kind==='pan')await page.mouse.down();
    const start=performance.now(),commandDurations=[],commandIntervals=[];let previousCommand=null;
    for(let i=1;i<=plan.steps;i++){
     const dispatched=performance.now();if(previousCommand!==null)commandIntervals.push(dispatched-previousCommand);previousCommand=dispatched;
     if(plan.kind==='pan')await page.mouse.move(x-plan.distance*i/plan.steps,y-90*i/plan.steps);
     else await page.mouse.wheel(0,plan.delta*pixelRatio);
     commandDurations.push(performance.now()-dispatched);
     await delay(start+i*16.67-performance.now());
    }
    if(plan.kind==='pan')await page.mouse.up();
    await page.evaluate(()=>interactionMeasure.release());await delay(500);
    await waitReady();
    const result={mode,...plan,view,...await page.evaluate(()=>interactionMeasure.end())};
    result.inputDriver={requestedIntervalMs:16.67,commandCompletion:timingSummary(commandDurations),commandIntervals:timingSummary(commandIntervals)};
    result.coldQualityIn=plan.name==='quality-in'&&results.length===0&&city.initialQuality==='map'&&result.before.scene.quality==='map'&&result.before.scene.detailPaints===0;
    const preparation=result.after.scene.materialPreparation;
    result.acceptance={inputRafP95:result.inputToRaf.count>0&&result.eventTimestampFallbacks===0&&result.inputToRaf.p95Ms<=targets.inputRafP95Ms,settleLongTasks:result.settleLongTasks.every(t=>t.durationMs<=targets.settleLongTaskMs),ready:!result.after.pan.pending&&!result.after.scene.baseNeedsRefresh&&(!preparation||!preparation.pending&&!preparation.active),materialErrors:preparationErrors(preparation)};
    results.push(result);
    if(cpu){const {profile}=await cpu.send('Profiler.stop');fs.writeFileSync(path.join(output,`${mode}-${plan.name}.cpuprofile`),JSON.stringify(profile));}
    result.metricScaleAtRelease=view.scale*result.atRelease.geometry.scale/result.before.geometry.scale;
    console.log(JSON.stringify({mode,name:plan.name,coldQualityIn:result.coldQualityIn,frames:result.frames,input:result.inputToRaf,eventToDispatch:result.eventToDispatch,dispatchToHandler:result.dispatchToHandler,handlerToRaf:result.handlerToRaf,inputDriver:result.inputDriver,paint:result.paint,settlePaint:result.settlePaint,cache:result.cacheDelta,cacheDuringInput:result.cacheDuringInput,cacheDuringSettle:result.cacheDuringSettle,longTasks:result.longTasks,settleLongTasks:result.settleLongTasks,acceptance:result.acceptance}));
    if(process.env.INTERACTION_SCREENSHOTS==='1')await page.screenshot({path:path.join(output,`${mode}-${plan.name}.png`)});
    fs.writeFileSync(path.join(output,'performance.json'),JSON.stringify(report(),null,2));
    // Timing targets are reported, rather than failing on a single host stall.
    assert(result.acceptance.ready,'both material preparation and viewport refinement must finish');
    assert.equal(result.acceptance.materialErrors,0,'material preparation must not silently fail');
    if(results.length===1&&plan.name==='quality-in')assert(result.coldQualityIn,'first quality-in must enter a scene with no previous detailed paints');
    if(plan.name!=='quality-in')assert(result.before.scene.canCache,'timed detail gesture must start in the actual texture renderer');
    assert(result.overlayPaint.count>0,'real detail overlay frames must be rendered during the gesture');
    if(followTraffic)assert(result.vehicleMovesDuringInput>0,'on-canvas traffic must actually move during the input phase');
    assert(result.inputs>=plan.steps*.9,'real input events must reach the map');
    assert(plan.kind==='pan'?result.atRelease.geometry.left!==result.before.geometry.left:result.atRelease.geometry.scale!==result.before.geometry.scale,'gesture must change the actual viewport');
    assert(result.after.pan.bytes<=result.after.pan.budget,'viewport bitmap stays within its memory budget');
    if(plan.name==='quality-in')assert(result.metricScaleAtRelease>Math.max(1.5,boundary)&&result.after.scene.canCache,'zoom must reach the actual detailed renderer');
   }
  }
  const imageChecks=[],gestureChecks=[],materialChecks=[],materialAtlases=[];
  // Read pixels only AFTER every timing sample. Canvas readback can change
  // Chrome's acceleration path and must not contaminate later gestures.
  if(process.env.INTERACTION_VERIFY==='1'){
   if((await page.locator('#city-play').textContent()).includes('暂停'))await page.locator('#city-play').click();
   await delay(500);
   await focus(closeScale);
   await page.locator('.workspace-rail [data-category="roads"]').click();
   await page.locator('[data-tool="street"]').click();
   await page.waitForFunction(()=>CityApp.tool==='street');await waitReady();
   const hoverBox=await page.locator('#map').boundingBox(),leaveBox=await page.locator('[data-tool="street"]').boundingBox();
   const hoverPoints=[[.60,.46],[.63,.48],[.66,.50],[.69,.47],[.72,.51]].map(([x,y])=>({x:hoverBox.x+hoverBox.width*x,y:hoverBox.y+hoverBox.height*y}));
   assert(await page.evaluate(points=>points.every(({x,y})=>document.elementFromPoint(x,y)?.id==='map'),hoverPoints),'construction hover uses exposed map pixels');
   await page.evaluate(()=>{
    const canvas=document.getElementById('map'),events={moves:0,leaves:0,pressedMoves:0};
    const move=e=>{events.moves++;if(e.buttons)events.pressedMoves++;},leave=()=>events.leaves++;
    canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerleave',leave);
    window.finishConstructionHover=()=>{canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerleave',leave);delete window.finishConstructionHover;return events;};
    interactionMeasure.begin();
   });
   for(const point of hoverPoints){await page.mouse.move(point.x,point.y);await delay(35);}
   await page.mouse.move(leaveBox.x+leaveBox.width/2,leaveBox.y+leaveBox.height/2);
   await page.evaluate(()=>interactionMeasure.release());await delay(250);await waitReady();
   const hoverCheck=await page.evaluate(()=>{
    const events=finishConstructionHover(),result=interactionMeasure.end();
    return {name:'construction-hover-keeps-detail',...events,builds:result.cacheDelta.builds,refinements:result.cacheDelta.refinements,overlayPaints:result.overlayPaint.count,before:result.before.pan,after:result.after.pan};
   });
   gestureChecks.push(hoverCheck);
   await page.locator('[data-tool="pan"]').first().click();await waitReady();
   fs.writeFileSync(path.join(output,'performance.json'),JSON.stringify(report({imageChecks,gestureChecks,materialChecks,materialAtlases}),null,2));
   assert(hoverCheck.moves>=hoverPoints.length&&hoverCheck.leaves>0,'real construction pointer moves and leave must be observed');
   assert.equal(hoverCheck.pressedMoves,0,'hover validation must not press a mouse button');
   assert.equal(hoverCheck.builds,0,'construction hover must not rebuild the detailed base');
   assert.equal(hoverCheck.refinements,0,'construction hover must not restart tile refinement');
   assert(hoverCheck.overlayPaints>0,'construction hover must still repaint its overlay');
   const checkBox=await page.locator('#map').boundingBox(),checkX=checkBox.x+checkBox.width*.66,checkY=checkBox.y+checkBox.height*.54;
   await page.mouse.move(checkX,checkY);await page.mouse.down();await page.mouse.move(checkX-80,checkY);
   await page.mouse.wheel(0,-26*pixelRatio);await delay(70);
   const anchored=await page.evaluate(()=>({...MapWorkspace.geometry}));
   await page.mouse.move(checkX-79,checkY+1);await delay(40);
   const moved=await page.evaluate(()=>({...MapWorkspace.geometry}));await page.mouse.up();
   const compound={name:'wheel-during-held-pan',deltaX:moved.left-anchored.left,deltaY:moved.top-anchored.top};gestureChecks.push(compound);
   assert(Math.abs(compound.deltaX-1)<.01&&Math.abs(compound.deltaY-1)<.01,'a pointer move after wheel zoom must not jump back to the old pan origin');
   await delay(200);await waitReady();
   for(const scale of [closeScale,neighborhoodScale]){
    await focus(scale);const box=await page.locator('#map').boundingBox(),x=box.x+box.width*.66,y=box.y+box.height*.54;
    await page.mouse.move(x,y);await page.mouse.down();
    for(let i=1;i<=3;i++){await page.mouse.move(x-220*i,y-30*i);await delay(30);}
    await page.mouse.up();await delay(200);await waitReady();
    const parity=await page.evaluate(()=>{
     const canvas=document.getElementById('map'),ctx=canvas.getContext('2d'),before=ctx.getImageData(0,0,canvas.width,canvas.height).data;
     const descriptor=Object.getOwnPropertyDescriptor(CityApp,'canCacheBase');
     Object.defineProperty(CityApp,'canCacheBase',{configurable:true,get:()=>false});MapWorkspace.draw();
     const reference=ctx.getImageData(0,0,canvas.width,canvas.height).data;
     Object.defineProperty(CityApp,'canCacheBase',descriptor);MapWorkspace.draw();
     let sum=0,changed=0;for(let i=0;i<before.length;i+=4){let delta=0;for(let c=0;c<3;c++)delta+=Math.abs(before[i+c]-reference[i+c]);sum+=delta;if(delta>60)changed++;}
     return {meanChannelDelta:sum/(before.length/4*3),changedPixelRatio:changed/(before.length/4)};
    });await waitReady();imageChecks.push({scale,...parity});
    assert(parity.meanChannelDelta<2.5,'cached composition must match original layer order, allowing subpixel raster edges');
   }
   await waitReady();
   const nativeMaterials=await page.evaluate(async()=>{
    if(!window.SceneMaterialPreparation)throw Error('Native material verification requires material-preparation.js');
    const names=['roof','ground','facade','landscape'],atlases=Object.fromEntries(await Promise.all(names.map(async name=>{
     const image=new Image();image.src=`assets/${name}-atlas.png`;await image.decode();
     if(!image.naturalWidth||!image.naturalHeight)throw Error(`Empty material atlas: ${name}`);
     return [name,image];
    })));
    const created=new Set(),canvas=size=>{const c=document.createElement('canvas');c.width=c.height=size;created.add(c);return c;};
    const preparation=SceneMaterialPreparation.create({canvas,atlases}),worker=new Worker('material-worker.js');
    let sequence=0;
    const prepare=(name,variant)=>new Promise((resolve,reject)=>{
     const id=++sequence,version=1;
     const cleanup=()=>{clearTimeout(timer);worker.removeEventListener('message',message);worker.removeEventListener('error',error);};
     const message=event=>{
      const data=event.data||{};if(data.id!==id)return;
      cleanup();
      if(data.error){data.bitmap?.close();reject(Error(`${name}:${variant}: ${data.error}`));return;}
      if(data.version!==version||data.name!==name||data.variant!==variant||!data.bitmap){data.bitmap?.close();reject(Error(`Unexpected worker reply for ${name}:${variant}`));return;}
      resolve(data.bitmap);
     };
     const error=event=>{cleanup();reject(Error(`Material worker: ${event.message}`));};
     const timer=setTimeout(()=>{cleanup();reject(Error(`Material worker timed out for ${name}:${variant}`));},30000);
     worker.addEventListener('message',message);worker.addEventListener('error',error);
     worker.postMessage({id,version,name,variant});
    });
    const checks=[];
    try{
     for(const [name,variant] of [['asphalt',0],['roof',1],['facade',2],['pavingWarm',1],['grass',0],['water',0],['marking',0]]){
      let bitmap=null;
      try{
       bitmap=await prepare(name,variant);
       const main=preparation.texture(name,variant),sameSize=main.width===bitmap.width&&main.height===bitmap.height;
       const result={name,variant,width:main.width,height:main.height,workerWidth:bitmap.width,workerHeight:bitmap.height,sameSize};
       if(sameSize){
        const workerCanvas=canvas(bitmap.width),ctx=workerCanvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);
        const a=main.getContext('2d').getImageData(0,0,main.width,main.height).data,b=ctx.getImageData(0,0,workerCanvas.width,workerCanvas.height).data;
        let total=0,max=0,changedPixels=0,changedChannels=0;
        for(let i=0;i<a.length;i+=4){let changed=false;for(let channel=0;channel<4;channel++){const delta=Math.abs(a[i+channel]-b[i+channel]);total+=delta;max=Math.max(max,delta);if(delta){changed=true;changedChannels++;}}if(changed)changedPixels++;}
        Object.assign(result,{meanRgbaDelta:total/a.length,maxRgbaDelta:max,changedPixels,changedChannels});
       }
       checks.push(result);
      }finally{
       bitmap?.close();for(const c of created)c.width=c.height=1;created.clear();
      }
     }
     return {atlases:names.map(name=>({name,url:atlases[name].src,width:atlases[name].naturalWidth,height:atlases[name].naturalHeight})),checks};
    }finally{worker.terminate();preparation.dispose();for(const c of created)c.width=c.height=1;}
   });
   materialChecks.push(...nativeMaterials.checks);materialAtlases.push(...nativeMaterials.atlases);
   console.log(JSON.stringify({materialChecks}));
   // Save every channel delta before enforcing exact native parity, so any
   // platform antialiasing difference remains reviewable rather than hidden.
   fs.writeFileSync(path.join(output,'performance.json'),JSON.stringify(report({imageChecks,gestureChecks,materialChecks,materialAtlases}),null,2));
   for(const material of materialChecks){
    assert(material.sameSize,`${material.name}:${material.variant} worker dimensions must match HTMLCanvas`);
    assert.equal(material.maxRgbaDelta,0,`${material.name}:${material.variant} Worker RGBA must exactly match HTMLCanvas (mean ${material.meanRgbaDelta})`);
   }
  }
  fs.writeFileSync(path.join(output,'performance.json'),JSON.stringify(report({imageChecks,gestureChecks,materialChecks,materialAtlases}),null,2));
  assert.deepEqual(errors,[]);assert.equal(city.webglContexts,0);
 }finally{await browser?.close();server.kill();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
