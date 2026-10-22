// Visual smoke check using an isolated save directory and the existing city fixture.
// NODE_PATH may point to the local Playwright installation; CHROMIUM_EXECUTABLE
// can select an installed Chrome instead of Playwright's bundled browser.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib');
const {spawn}=require('node:child_process');
const app=path.resolve(__dirname,'..'),output=path.join(app,'output/playwright',process.env.DETAIL_OUTPUT||'detail-style');
const center=JSON.parse(process.env.DETAIL_CENTER||'[2260,2395]');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'shanhai-detail-'));
fs.mkdirSync(output,{recursive:true});
(async()=>{
 let browser;
 const server=spawn(process.env.TERRAIN_PYTHON||path.join(app,'.venv/bin/python'),['backend/server.py','--preview','--port','0'],{cwd:app,env:{...process.env,SHANHAI_DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
 let log='';server.stderr.on('data',data=>log+=data);
 try{
  const ready=await new Promise((resolve,reject)=>{require('node:readline').createInterface({input:server.stdout}).once('line',line=>resolve(JSON.parse(line)));server.once('error',reject);server.once('exit',code=>reject(new Error(`Server ${code}: ${log}`)));});
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox',...(process.env.DETAIL_GPU==='native'?[]:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])]});
  const pixelRatio=Number(process.env.DETAIL_DPR)||1;
  const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:pixelRatio});page.setDefaultTimeout(60000);
  await page.addInitScript(()=>{window.webglContexts=0;const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){if(['webgl','webgl2','experimental-webgl'].includes(kind))window.webglContexts++;return get.call(this,kind,...args);};});
  const errors=[],failedResources=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400)failedResources.push({url:r.url(),status:r.status()});});
  await page.goto(`http://127.0.0.1:${ready.port}`,{waitUntil:'networkidle'});
  if(process.env.DETAIL_PROFILE){
   const profiler=await page.context().newCDPSession(page);
   await profiler.send('Profiler.enable');await profiler.send('Profiler.start');
   let sample=0;
   const capture=async()=>{try{
    const {profile}=await profiler.send('Profiler.stop');fs.writeFileSync(path.join(output,`load-${++sample}.cpuprofile`),JSON.stringify(profile));console.log('Saved import CPU profile '+sample);
    if(sample<6){await profiler.send('Profiler.start');setTimeout(capture,15000).unref();}
   }catch(error){console.error('Profile:',error.message);}};
   setTimeout(capture,15000).unref();
  }
  const loadStart=performance.now(),timings={};
  const importResponse=page.waitForResponse(r=>r.url().endsWith('/api/city/import'));
  let fixture=process.env.DETAIL_FIXTURE||path.join(app,'tests/fixtures/lighting-materials-city.json');
  if(fixture.endsWith('.gz')){const unpacked=path.join(temp,'city.json');fs.writeFileSync(unpacked,zlib.gunzipSync(fs.readFileSync(fixture)));fixture=unpacked;}
  await page.locator('#city-import-file').setInputFiles(fixture);
  const imported=await importResponse;
  timings.importResponseMs=Math.round(performance.now()-loadStart);
  // Large cities exceed Chrome's response-body inspector cache. A successful
  // import needs only its status; do not retrieve its entire JSON a second time.
  if(!imported.ok())throw new Error(`Fixture import ${imported.status()}: ${await imported.text().catch(()=>'<response body unavailable>')}\n${log}`);
  await page.waitForFunction(()=>CityApp.active&&!CityApp.working&&CityScene.assetsReady).catch(async error=>{
   const state=await page.evaluate(()=>({active:window.CityApp?.active,working:window.CityApp?.working,assetsReady:window.CityScene?.assetsReady,stats:window.CityScene?.stats}));
   throw new Error(`${error.message}\n${JSON.stringify({state,errors,failedResources,serverLog:log})}`);
  });
  await page.waitForFunction(()=>CityScene.stats.vehicleAtlases.length===3&&CityOrdinaryRoofs.ready&&CityStreetFurniture.assetsReady);
  timings.sceneReadyMs=Math.round(performance.now()-loadStart);
  const focus=async (scale,at=center)=>page.evaluate(({scale,center})=>{
   const terrain=MapWorkspace.terrain,canvas=document.getElementById('map');
   const fitScale=Math.max(canvas.clientWidth/terrain.width,canvas.clientHeight/terrain.height);
   const worldScale=fitScale*Math.min(terrain.width/terrain.grid.widthMeters,terrain.height/terrain.grid.heightMeters);
   CityScene.configure({quality:'high',renderer:window.detailRenderer||'textures'});
   // Detail captures obey the same minimum displayed zoom as the product.
   MapWorkspace.focus(center,Math.max(CityScene.detailZoom,scale/worldScale));
   const geometry=MapWorkspace.geometry;
   return {requestedScale:scale,scale:Math.min(terrain.width*geometry.scale/terrain.grid.widthMeters,terrain.height*geometry.scale/terrain.grid.heightMeters),zoom:geometry.scale/fitScale,detailZoom:CityScene.detailZoom};
  },{scale,center:at});
  await page.evaluate(renderer=>{window.detailRenderer=renderer;},process.env.DETAIL_RENDERER||'textures');
  await focus(2.1);
  await page.waitForFunction(()=>document.body.dataset.mapView==='high');
  await page.screenshot({path:path.join(output,'day-neighborhood.png'),animations:'disabled'});
  await focus(Number(process.env.DETAIL_SCALE)||4.8);
  await page.screenshot({path:path.join(output,'day-closeup.png'),animations:'disabled'});
  fs.writeFileSync(path.join(output,'scene.png'),Buffer.from(await page.evaluate(()=>document.getElementById('map').toDataURL().split(',')[1]),'base64'));
  for(const view of JSON.parse(process.env.DETAIL_VIEWS||'[]')){
   assert(/^[a-z0-9-]+$/.test(view.name),'View name must be a simple filename');
   await focus(view.scale,view.center);
   fs.writeFileSync(path.join(output,view.name+'.png'),Buffer.from(await page.evaluate(()=>document.getElementById('map').toDataURL().split(',')[1]),'base64'));
  }
  if(process.env.DETAIL_FURNITURE_VIEW){
   const furniture=await page.evaluate(center=>{
    const box=[center[0]-120,center[1]-120,center[0]+120,center[1]+120];
    return CityStreetFurniture.createPlanner(CityApp.state).items(box)
     .sort((a,b)=>Math.hypot(a.point[0]-center[0],a.point[1]-center[1])-Math.hypot(b.point[0]-center[0],b.point[1]-center[1]));
   },center);
   assert(furniture.length,'the reference streetscape has visible street furniture');
   fs.writeFileSync(path.join(output,'street-furniture.json'),JSON.stringify(furniture,null,2));
   const bench=furniture.find(item=>item.cell===0||item.cell===3);
   await focus(30,(bench||furniture[0]).point);
   fs.writeFileSync(path.join(output,'street-furniture.png'),Buffer.from(await page.evaluate(()=>document.getElementById('map').toDataURL().split(',')[1]),'base64'));
  }
  await focus(Number(process.env.DETAIL_SCALE)||4.8);
  if(process.env.DETAIL_BENCHMARK){
   if(process.env.DETAIL_COSTS)await page.evaluate(()=>{
    window.detailCosts={};
    for(const [name,object,keys] of [['scene',CityScene,['ground','water','streetsideGround','streetsideParking','buildingShadows','building','vegetation','medians','atmosphere']],['map',CityMapRenderer,['paint','paintLabels']],['roads',RoadRenderer,['paint']],['furniture',CityStreetFurniture,['paint']]])for(const key of keys){
     const original=object[key];object[key]=function(...args){const start=performance.now();try{return original.apply(this,args);}finally{const id=name+'.'+key;window.detailCosts[id]=(window.detailCosts[id]||0)+performance.now()-start;}};
    }
   });
   const samples=[];
   for(const scale of [2.1,Number(process.env.DETAIL_SCALE)||4.8]){
    const framing=await focus(scale);
    const result=await page.evaluate(async()=>{
     const elapsed=[],intervals=[];let previous,warmMisses=0,warmFurniture=0,warmRoads=0;
     for(let i=0;i<18;i++){
      await new Promise(requestAnimationFrame);const start=performance.now();
      MapWorkspace.draw();const end=performance.now();
      if(i===2){warmMisses=CityScene.stats.buildingCache.misses;warmFurniture=CityStreetFurniture.stats.builds||0;warmRoads=RoadRenderer.detailStats.surfaceBuilds;if(window.detailCosts)window.detailCosts={};}
      if(i>=3){elapsed.push(end-start);if(previous)intervals.push(start-previous);}previous=start;
     }
     const summarize=values=>{const a=values.slice().sort((a,b)=>a-b);return {medianMs:+a[Math.floor(a.length*.5)].toFixed(1),p95Ms:+a[Math.floor(a.length*.95)].toFixed(1)};};
     return {paint:summarize(elapsed),frame:summarize(intervals),stationaryCacheMisses:CityScene.stats.buildingCache.misses-warmMisses,stationaryFurnitureBuilds:(CityStreetFurniture.stats.builds||0)-warmFurniture,stationaryRoadDetailBuilds:RoadRenderer.detailStats.surfaceBuilds-warmRoads,scene:CityScene3D.stats,textures:CityScene.stats||null,roadDetails:RoadRenderer.detailStats,furniture:CityStreetFurniture.stats,pedestrians:CityPedestrians.stats||null,...(window.detailCosts?{costs:Object.fromEntries(Object.entries(window.detailCosts).map(([key,ms])=>[key,+(ms/15).toFixed(2)]))}:{})};
    });samples.push({...framing,...result});
   }
   const city=await page.evaluate(()=>({buildings:CityApp.state.parcels.filter(p=>p.building).length,roads:CityApp.state.roads.length,webglContexts:window.webglContexts}));
   const benchmark={renderer:process.env.DETAIL_RENDERER||'textures',gpuMode:process.env.DETAIL_GPU||'software',viewport:[1600,1000],pixelRatio,center,city,timings,samples};
   fs.writeFileSync(path.join(output,'performance.json'),JSON.stringify(benchmark,null,2));console.log(JSON.stringify(benchmark));
   assert.deepEqual(errors,[]);if(process.env.DETAIL_RENDERER!=='webgl')assert.equal(city.webglContexts,0);
   for(const sample of samples){assert.equal(sample.stationaryFurnitureBuilds,0);assert.equal(sample.stationaryRoadDetailBuilds,0);assert(sample.furniture.sections<=sample.furniture.limit);assert(sample.roadDetails.curbSections<=sample.roadDetails.curbSectionLimit);}
   if(process.env.DETAIL_BENCHMARK!=='verify')return;
  }
  const gallery=await page.evaluate(()=>{
   const models=[...SurfaceVariation.realVehicles,...SurfaceVariation.sportVehicles];
   const c=document.createElement('canvas');c.width=800;c.height=Math.ceil(models.length/4)*180;const g=c.getContext('2d');g.fillStyle='#e5e8e6';g.fillRect(0,0,c.width,c.height);
   for(const [i,model] of models.entries()){
    let id=0;while(SurfaceVariation.vehicle(id).model!==model.id&&id<10000)id++;
    const x=i%4*200+100,y=Math.floor(i/4)*180+79;
    g.save();g.translate(x,y);g.scale(22,22);CityScene.vehicle(g,{id,point:[0,0],heading:-Math.PI/2,speed:1},22);g.restore();
    g.fillStyle='#27383c';g.textAlign='center';g.font='14px sans-serif';g.fillText(model.name,x,y+77);
   }return c.toDataURL().split(',')[1];
  });fs.writeFileSync(path.join(output,'vehicle-gallery.png'),Buffer.from(gallery,'base64'));
  const vehicleLighting=await page.evaluate(()=>{
   const ids=['xpeng-p7-silver','xiaomi-su7-blue','bmw-z4-red','dodge-challenger-orange'],headings=[-Math.PI/2,0,Math.PI/2,Math.PI];
   const models=[...SurfaceVariation.realVehicles,...SurfaceVariation.sportVehicles];
   const c=document.createElement('canvas');c.width=800;c.height=760;const g=c.getContext('2d');g.fillStyle='#676c70';g.fillRect(0,0,c.width,c.height);
   ids.forEach((model,column)=>{
    let id=0;while(SurfaceVariation.vehicle(id).model!==model&&id<10000)id++;
    const x=column*200+100;
    g.fillStyle='#f3f2e9';g.textAlign='center';g.font='14px sans-serif';g.fillText(models.find(m=>m.id===model).name,x,29);
    headings.forEach((heading,row)=>{g.save();g.translate(x,120+row*180);g.scale(25,25);CityScene.vehicle(g,{id,point:[0,0],heading,speed:1},25);g.restore();});
   });return c.toDataURL().split(',')[1];
  });fs.writeFileSync(path.join(output,'vehicle-lighting.png'),Buffer.from(vehicleLighting,'base64'));
  if(process.env.DETAIL_CAPTURE_ONLY){console.log('Scene capture: '+output);return;}
  const webgl=await page.evaluate(()=>CityScene3D.stats);assert.equal(webgl.failure,null);
  const textures=await page.evaluate(()=>({settings:CityScene.settings,stats:CityScene.stats,webglContexts:window.webglContexts}));
  const pedestrians=await page.evaluate(()=>CityPedestrians.stats);assert(pedestrians.sprites<=pedestrians.limit);
  const furniture=await page.evaluate(()=>CityStreetFurniture.stats);
  assert(furniture.sections<=furniture.limit);assert(furniture.spriteCells<=furniture.spriteLimit);
  if(process.env.DETAIL_RENDERER!=='webgl'){assert.equal(textures.webglContexts,0);assert(textures.stats.vehicleSprites>0);assert(textures.stats.buildingCache.hits>0);assert(textures.stats.buildingCache.bytes<=textures.stats.buildingCache.budget);assert(textures.stats.vehicleLighting.bytes<=textures.stats.vehicleLighting.budget);assert(textures.stats.vehicleLighting.entries<=textures.stats.vehicleLighting.limit);}
  // Exercise actual view and clock controls, including night lights.
  await page.locator('button[data-category="data"]').click();
  await page.locator('#city-time-of-day').fill('1260');await page.locator('#city-time-of-day').dispatchEvent('input');
  await page.waitForFunction(()=>CityScene.time===21*3600);
  await page.screenshot({path:path.join(output,'night.png'),animations:'disabled'});
  await page.locator('#city-time-of-day').fill('540');await page.locator('#city-time-of-day').dispatchEvent('input');
  await page.locator('#city-render-quality').selectOption('map');
  await page.waitForFunction(()=>document.body.dataset.mapView==='map');
  await page.screenshot({path:path.join(output,'map.png'),animations:'disabled'});
  await page.locator('#city-render-quality').selectOption('high');
  await page.waitForFunction(()=>document.body.dataset.mapView==='high');
  // The Canvas fallback must use the same calibrated textures without WebGL.
  await page.evaluate(()=>{window.detailRender=CityScene3D.render;CityScene3D.render=()=>false;MapWorkspace.draw();});
  await page.screenshot({path:path.join(output,'canvas-fallback.png'),animations:'disabled'});
  await page.evaluate(()=>{CityScene3D.render=window.detailRender;MapWorkspace.draw();});
  await page.locator('button[data-category="roads"]').click();
  const layouts=[];
  for(const [width,height] of [[1024,768],[375,812]]){
   await page.setViewportSize({width,height});await focus(2.1);
   const layout=await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth}));
   assert.equal(layout.overflow,false);layouts.push(layout);
   await page.screenshot({path:path.join(output,`compact-${width}.png`),animations:'disabled'});
  }
  assert.deepEqual(errors,[]);
  const evidence={passed:true,webgl,textures,pedestrians,furniture,layouts,errors,checks:['texture daylight closeup','no default WebGL context','bounded building, vehicle lighting, pedestrian, and street furniture caches','complete real-model sprite gallery','night lighting','map/detail switch','Canvas fallback','compact layouts']};
  fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
 }finally{await browser?.close();server.kill();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
