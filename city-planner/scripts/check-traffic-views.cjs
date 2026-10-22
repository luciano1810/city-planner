// Focused browser coverage with populated households and an operating bus line.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,spawnSync}=require('node:child_process');
const app=path.resolve(__dirname,'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'shanhai-traffic-views-'));
const output=path.join(app,'output/traffic-views');fs.mkdirSync(output,{recursive:true});
const python=process.env.TERRAIN_PYTHON||path.join(app,'.venv/bin/python');
const fixture=spawnSync(python,['-c',`import json
from tests.test_city import TransitTests
c,stops,_,_=TransitTests().transit_city()
c.command(dict(type='line',name='测试公交线',mode='bus',stops=stops,headway=10))
c.assign_traffic();c.summarize()
print(json.dumps(c.snapshot()))`],{cwd:app,encoding:'utf8'});
assert.equal(fixture.status,0,fixture.stderr);fs.writeFileSync(path.join(temp,'transit.json'),fixture.stdout);
(async()=>{
 let browser,page;
 const server=spawn(python,['backend/server.py','--preview','--port','0'],{cwd:app,env:{...process.env,SHANHAI_DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
 let log='';server.stderr.on('data',chunk=>log+=chunk);
 try{
  const ready=await new Promise((resolve,reject)=>{require('node:readline').createInterface({input:server.stdout}).once('line',line=>resolve(JSON.parse(line)));server.once('exit',code=>reject(new Error(`Server ${code}: ${log}`)));server.once('error',reject);});
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(15000);await page.emulateMedia({reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const click=selector=>page.locator(selector).click();
  const imported=async file=>{await page.locator('#city-import-file').setInputFiles(file);await page.waitForFunction(()=>CityApp.active&&!CityApp.working);if(!await page.locator('#workspace-observe-menu').isVisible())await click('#workspace-observe');await click('[data-observe-group="traffic"]');};
  await page.goto(`http://127.0.0.1:${ready.port}`,{waitUntil:'networkidle'});
  await imported(path.join(app,'tests/fixtures/lighting-materials-city.json'));
  const keys=Object.keys(require('../renderer/traffic-metrics.js').views);
  assert.equal(keys.length,9);
  for(const mode of ['map','high']){
   await page.locator('#city-render-quality').selectOption(mode);
   for(const key of keys){
    await click(`[data-observe-layer="${key}"]`);
    assert.equal(await page.locator('#city-layer').inputValue(),key);
    assert(await page.locator('#city-traffic-note').isVisible());
    if(['congestion','speed','delay'].includes(key)){
     assert(await page.locator('#city-traffic-period option[value="off"]').evaluate(node=>node.disabled),`${key}: off must be disabled`);
     await page.locator('#city-traffic-period').selectOption('am');
    }else assert.equal(await page.locator('#city-traffic-period').isVisible(),false);
   }
  }
  await page.locator('#city-render-quality').selectOption('map');
  await click('[data-observe-layer="commute"]');
  assert(!(await page.locator('#city-traffic-note').innerText()).includes('尚无已完成'));
  await page.screenshot({path:path.join(output,'commute.png')});
  await imported(path.join(temp,'transit.json'));
  for(const key of ['transitLoad','stationActivity']){
   await click(`[data-observe-layer="${key}"]`);
   assert(!(await page.locator('#city-traffic-note').innerText()).includes('尚无'));
   await page.screenshot({path:path.join(output,`${key}.png`)});
  }
  await click('[data-observe-layer="traffic"]');await page.locator('#city-traffic-period').selectOption('off');await click('[data-observe-layer="speed"]');
  assert.equal(await page.locator('#city-traffic-period').inputValue(),'peak');
  await page.setViewportSize({width:375,height:812});
  await page.waitForFunction(()=>{
   const card=document.querySelector('[data-observe-layer="speed"]').getBoundingClientRect();
   const row=document.querySelector('#observe-layers .build-cards').getBoundingClientRect();
   return card.left>=row.left-1&&card.right<=row.right+1;
  });
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(output,'mobile.png')});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,views:keys,errors}));
 }catch(error){if(page)await page.screenshot({path:path.join(output,'failure.png')});throw error;}
 finally{await browser?.close();server.kill();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
