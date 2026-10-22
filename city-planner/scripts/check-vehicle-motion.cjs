/* Real-browser trajectory replay. Output stays in ignored test-results/. */
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert/strict');
const app=path.resolve(__dirname,'..'),temp=fs.mkdtempSync('/tmp/vehicle-motion-');
const output=process.env.OUTPUT_DIR||path.join(app,'test-results','vehicle-motion');fs.mkdirSync(output,{recursive:true});
const env={...process.env,PYTHONPATH:path.join(app,'backend'),SHANHAI_DATA_DIR:temp};
cp.execFileSync('python',['-c',`import json,sys
from city.visual_case import build_visual_case
c=build_visual_case()
c.s['settings'].update(autoGrow=False,autoRenew=False,growth=0)
json.dump(c.snapshot(),open(sys.argv[1],'w'))`,temp+'/city.json'],{cwd:app,env});
(async()=>{let browser;const server=cp.spawn('python',['backend/server.py','--preview','--port','0'],{cwd:app,env,stdio:['ignore','pipe','pipe']});try{
 const ready=await new Promise((res,rej)=>{require('readline').createInterface({input:server.stdout}).once('line',s=>res(JSON.parse(s)));server.once('exit',rej)});
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--disable-gpu-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1400,height:950}}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().includes('/city/simulate'))requests.push(Date.now())});
 await page.goto('http://127.0.0.1:'+ready.port,{waitUntil:'networkidle'});
 await page.locator('#city-import-file').setInputFiles(temp+'/city.json');
 await page.waitForFunction(()=>CityApp.active&&!CityApp.working&&CityScene.assetsReady);
 await page.evaluate(()=>{
   MapWorkspace.focus([505,600],12);CityScene.setTime(43200);MapWorkspace.draw();
   window.trafficFrames=[];window.lastTrafficPaint=0;window.lastTrafficObject=null;
   const paint=RoadRenderer.paint;
   RoadRenderer.paint=function(ctx,state,options){
     if(options.traffic&&options.traffic!==lastTrafficObject){
       lastTrafficObject=options.traffic;
       lastTrafficPaint=performance.now();trafficFrames.push({time:lastTrafficPaint,vehicles:options.traffic.vehicles.map(v=>({id:v.id,point:v.point,heading:v.heading,speed:v.speed,state:v.state,road:v.road})),seconds:options.traffic.motionTime});
     }
     return paint.call(this,ctx,state,options);
   };
   document.getElementById('city-speed').value='3';document.getElementById('city-speed').dispatchEvent(new Event('input'));
 });
 await page.locator('#city-play').click();
 await page.waitForTimeout(14000);
 await page.screenshot({path:path.join(output,'traffic-running.png')});
 await page.locator('#city-play').click();
 await page.waitForTimeout(350);
 const evidence=await page.evaluate(()=>({frames:trafficFrames,traffic:CityApp.traffic,engine:CityScene3D.stats,paused:document.getElementById('city-play').textContent}));
 assert.equal(evidence.paused,'开始模拟');assert(evidence.frames.length>20,'Animation must paint independently of server responses');
 const points=new Map();let movement=0,intermediate=0,turning=0,maxJump=0,positiveFrames=0;let speedViolations=0;
 for(const frame of evidence.frames){
   let positive=false;
   for(const v of frame.vehicles){
     const prev=points.get(v.id);if(prev){
       const d=Math.hypot(v.point[0]-prev.v.point[0],v.point[1]-prev.v.point[1]);maxJump=Math.max(maxJump,d);
       if(d>60*(frame.time-prev.time)/1000+2)speedViolations++;
       if(d>.002){movement++;positive=true;if(frame.seconds===prev.seconds)intermediate++;}
       if(d>.002&&Math.abs(Math.atan2(Math.sin(v.heading-prev.v.heading),Math.cos(v.heading-prev.v.heading)))>.002)turning++;
     }points.set(v.id,{v,time:frame.time,seconds:frame.seconds});
   }
   if(positive)positiveFrames++;
 }
 assert.equal(speedViolations,0,'Jitter must not compress a journey into a teleport');assert(movement>20,'Cars must move');assert(intermediate>5,'Cars must move between API snapshots');assert(turning>5,'Curved turns must animate');
 const framesBefore=await page.evaluate(()=>trafficFrames.length);await page.waitForTimeout(350);assert.equal(await page.evaluate(()=>trafficFrames.length),framesBefore,'Pause must stop repaint scheduling');
 assert.deepEqual(errors,[]);
 const result={errors,frames:evidence.frames.length,movement,intermediate,turning,positiveFrames,maxJump,speedViolations,vehicles:evidence.traffic.vehicles.length,passed:evidence.traffic.passed,engine:evidence.engine};
 fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(result,null,2));fs.writeFileSync(path.join(output,'frames.json'),JSON.stringify(evidence.frames));console.log(JSON.stringify(result));
 }finally{await browser?.close();server.kill();}})().catch(e=>{console.error(e);process.exitCode=1});
