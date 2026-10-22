// Uses an isolated save directory and a deterministic city, never player saves.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,spawnSync}=require('node:child_process');
const app=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'shanhai-taxis-'));
const output=path.join(app,'output/taxis');fs.mkdirSync(output,{recursive:true});
const python=process.env.TERRAIN_PYTHON||path.join(app,'.venv/bin/python');
const fixture=spawnSync(python,['-c',`import json
from tests.test_taxis import taxi_city
c,_,_=taxi_city(40)
c.assign_traffic();c.summarize()
print(json.dumps(c.snapshot()))`],{cwd:app,encoding:'utf8'});
assert.equal(fixture.status,0,fixture.stderr);fs.writeFileSync(path.join(temp,'city.json'),fixture.stdout);
(async()=>{
 let browser,page;
 const server=spawn(python,['backend/server.py','--preview','--port','0'],{cwd:app,env:{...process.env,SHANHAI_DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
 let log='';server.stderr.on('data',chunk=>log+=chunk);
 try{
  const ready=await new Promise((resolve,reject)=>{require('node:readline').createInterface({input:server.stdout}).once('line',line=>resolve(JSON.parse(line)));server.once('exit',code=>reject(new Error(`Server ${code}: ${log}`)));server.once('error',reject);});
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(20000);
  await page.emulateMedia({reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});
  await page.goto(`http://127.0.0.1:${ready.port}`,{waitUntil:'networkidle'});
  await page.locator('#city-import-file').setInputFiles(path.join(temp,'city.json'));
  await page.waitForFunction(()=>CityApp.active&&!CityApp.working);
  const baseline=await page.evaluate(()=>CityApp.state.stats.failedTrips);
  await page.locator('[data-metric-group="services"]').click();
  const card=page.locator('[data-service="taxi"]');await card.click();
  assert(await page.locator('#city-taxi-panel').isVisible());
  assert.equal(await page.locator('.metric-heading h2').innerText(),'出租车');
  assert.equal(await page.locator('#city-transit-panel #city-taxi-panel').count(),0);
  assert.equal(await card.locator('strong').innerText(),'未运营');
  await page.locator('#taxi-settings > summary').click();
  assert.equal(await page.locator('#taxi-enabled').isChecked(),false);
  await page.locator('#taxi-enabled').check();await page.locator('#taxi-fleetSize').fill('2');
  await page.locator('#taxi-apply').click();
  await page.waitForFunction(()=>!CityApp.working&&CityApp.state.taxi.enabled&&CityApp.state.taxi.fleetSize===2);
  const report=await page.evaluate(()=>({report:CityApp.state.taxiReport,stats:CityApp.state.stats}));
  assert(report.report.completed>0);assert(report.report.rescued>0);assert(report.report.emptyKm>0);
  assert(report.stats.failedTrips<baseline);assert(report.report.active<=2);
  assert((await page.locator('#taxi-summary').innerText()).includes('平均接客等待'));
  await page.screenshot({path:path.join(output,'statistics.png')});
  await page.locator('#taxi-title').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,'service.png')});
  // Invalid fleet sizes are rejected by the actual form before issuing a write.
  const revision=await page.evaluate(()=>CityApp.state.revision);
  await page.locator('#taxi-fleetSize').fill('501');await page.locator('#taxi-apply').click();
  assert.equal(await page.evaluate(()=>CityApp.state.revision),revision);
  assert.equal(await page.locator('#taxi-fleetSize').evaluate(node=>node.validity.rangeOverflow),true);
  await page.locator('#taxi-fleetSize').fill('2');
  await page.keyboard.press('Escape');
  await page.locator('.workspace-rail [data-category="transit"]').click();
  await page.locator('#signal-reset').click();
  await page.waitForFunction(()=>!CityApp.working&&CityApp.traffic?.vehicles.some(v=>v.kind==='taxi'));
  const kinds=await page.evaluate(()=>[...new Set(CityApp.traffic.vehicles.filter(v=>v.kind==='taxi').map(v=>v.taxiState))]);
  assert(kinds.length>0);
  // Both rendering paths must handle the taxi body and roof light.
  await page.locator('#workspace-observe').click();
  for(const mode of ['map','high']){
   await page.locator('#city-render-quality').selectOption(mode);
   await page.evaluate(()=>{MapWorkspace.focus(CityApp.traffic.vehicles.find(v=>v.kind==='taxi').point,30);MapWorkspace.draw();});
   await page.screenshot({path:path.join(output,`vehicles-${mode}.png`)});
  }
  await page.locator('#workspace-observe-menu .build-menu-close').click();
  await page.setViewportSize({width:390,height:844});
  await card.scrollIntoViewIfNeeded();await card.click();
  const bounds=await page.locator('#workspace-metric-panel').boundingBox();
  assert(bounds.x>=0&&bounds.x+bounds.width<=391);
  await page.locator('#taxi-title').scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(output,'mobile.png')});
  await page.locator('#taxi-enabled').scrollIntoViewIfNeeded();
  await page.locator('#taxi-enabled').uncheck();await page.locator('#taxi-apply').click();
  await page.waitForFunction(()=>!CityApp.working&&!CityApp.state.taxi.enabled);
  assert.equal(await page.evaluate(()=>CityApp.state.stats.taxiTrips),0);
  assert((await page.locator('#taxi-summary').innerText()).includes('运营关闭'));
  await page.waitForFunction(()=>document.querySelector('[data-service="taxi"] strong').textContent==='未运营');
  await page.keyboard.press('Escape');await card.click();
  assert.equal(await page.locator('#taxi-enabled').isChecked(),false);
  assert.equal(await page.locator('#taxi-fleetSize').inputValue(),'2');
  assert.deepEqual(errors,[]);
  const evidence={passed:true,baselineFailed:baseline,...report,liveTaxiStates:kinds,errors};
  fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({passed:true,baselineFailed:baseline,afterFailed:report.stats.failedTrips,taxiTrips:report.report.completed,errors}));
 }catch(error){if(page)await page.screenshot({path:path.join(output,'failure.png')});throw error;}
 finally{await browser?.close();server.kill();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
