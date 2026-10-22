// Real renderer/HTTP smoke test with isolated saves and a disposable backend.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'shanhai-monthly-'));
const output=path.join(root,'output/playwright/incremental-simulation');fs.mkdirSync(output,{recursive:true});
(async()=>{
 let browser;const server=spawn(path.join(root,'.venv/bin/python'),['backend/server.py','--preview','--port','0'],
  {cwd:root,env:{...process.env,SHANHAI_DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
 let log='';server.stderr.on('data',data=>log+=data);
 try{
  const ready=await new Promise((resolve,reject)=>{
   require('node:readline').createInterface({input:server.stdout}).once('line',line=>resolve(JSON.parse(line)));
   server.once('error',reject);server.once('exit',code=>reject(Error(`${code}: ${log}`)));
  });
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
  const page=await browser.newPage({bypassCSP:true,viewport:{width:1440,height:1000}});page.setDefaultTimeout(120000);
  const errors=[],requests=new Map(),responses=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().endsWith('/api/city/simulate'))requests.set(r,Date.now());});
  page.on('requestfinished',r=>{if(requests.has(r))responses.push(Date.now()-requests.get(r));});
  await page.goto(`http://127.0.0.1:${ready.port}`,{waitUntil:'networkidle'});
  const fixture=process.env.SIMULATION_FIXTURE||path.join(root,'tests/fixtures/lighting-materials-city.json');
  const file=path.join(temp,'city.json');fs.writeFileSync(file,fixture.endsWith('.gz')?zlib.gunzipSync(fs.readFileSync(fixture)):fs.readFileSync(fixture));
  await page.locator('#city-import-file').setInputFiles(file);
  await page.waitForFunction(()=>CityApp.active&&!CityApp.working&&CityScene.assetsReady);
  await page.evaluate(()=>MapWorkspace.setDisplayMode('map',{focus:false}));
  const initial=await page.evaluate(()=>CityApp.state.month);
  await page.locator('#city-speed').evaluate(el=>{el.value='11';el.dispatchEvent(new Event('input'));});
  await page.locator('#city-play').click();
  await page.waitForFunction(()=>CityApp.state.settlement?.pending&&CityApp.state.settlement.progress>.03);
  const progress=await page.locator('#city-simulation-note').textContent();
  assert(progress.includes('本周'));
  const started=Date.now();await page.locator('#city-play').click();
  await page.waitForFunction(()=>document.getElementById('city-play').textContent==='开始模拟');
  const pauseMs=Date.now()-started;
  // Allow the one in-flight request to settle before comparing paused clocks.
  await page.waitForTimeout(1000);
  const paused=await page.evaluate(()=>CityApp.state.simulation.elapsedSeconds);
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>CityApp.state.simulation.elapsedSeconds),paused);
  await page.screenshot({path:path.join(output,'paused.png')});
  await page.locator('#city-play').click();
  await page.waitForFunction(month=>CityApp.state.month>month,initial);
  await page.locator('#city-play').click();
  assert.deepEqual(errors,[]);assert(responses.length>20);
  responses.sort((a,b)=>a-b);
  const report={initialMonth:initial,finalMonth:await page.evaluate(()=>CityApp.state.month),pauseMs,
   requests:responses.length,medianMs:responses[Math.floor(responses.length/2)],p95Ms:responses[Math.floor(responses.length*.95)],
   maximumMs:Math.max(...responses),progress,errors};
  fs.writeFileSync(path.join(output,'performance.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
 }finally{
  await browser?.close();server.kill();
  await new Promise(resolve=>{if(server.exitCode!==null)resolve();else server.once('exit',resolve);});
  fs.rmSync(temp,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
