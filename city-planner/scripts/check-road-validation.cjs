// Exercise road validation against the real engine and map UI.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,spawnSync}=require('node:child_process');
const app=path.resolve(__dirname,'..');
const output=path.join(app,'output/road-validation');fs.mkdirSync(output,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'shanhai-road-validation-'));
const python=process.env.TERRAIN_PYTHON||path.join(app,'.venv/bin/python');
const fixture=spawnSync(python,['-c',`import json
from tests.test_special_buildings import coast_world
from city.engine import City
c=City(coast_world())
c.s['settings']['autoGrow']=False
print(json.dumps(c.snapshot()))`],{cwd:app,encoding:'utf8'});
assert.equal(fixture.status,0,fixture.stderr);
fs.writeFileSync(path.join(temp,'coast.json'),fixture.stdout);
(async()=>{
 let browser,page;
 const server=spawn(python,['backend/server.py','--preview','--port','0'],{cwd:app,env:{...process.env,SHANHAI_DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
 let serverLog='';server.stderr.on('data',s=>serverLog+=s);
 try{
  const ready=await new Promise((resolve,reject)=>{require('node:readline').createInterface({input:server.stdout}).once('line',s=>resolve(JSON.parse(s)));server.once('error',reject);server.once('exit',code=>reject(new Error(`Server ${code}: ${serverLog}`)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const click=s=>page.locator(s).click();
  const popup=page.locator('#road-validation');
  const advanced=async open=>{if(await page.locator('#build-advanced-panel').isVisible()!==open)await click('#build-advanced-toggle');};
  const wait=()=>page.waitForFunction(()=>CityApp.active&&!CityApp.working);
  const addPoint=async(x,y)=>{
   await advanced(true);
   await page.locator('#city-coordinate-x').fill(String(x));await page.locator('#city-coordinate-y').fill(String(y));await click('#city-coordinate-apply');
  };
  let routeY=1200;
  const drawInvalid=async()=>{await addPoint(1400,routeY);await addPoint(2600,routeY);await popup.waitFor({state:'visible'});};
  await page.goto(`http://127.0.0.1:${ready.port}`,{waitUntil:'networkidle'});
  await page.locator('#city-import-file').setInputFiles(path.join(temp,'coast.json'));await wait();
  await click('#workspace-build');await page.locator('#city-shape').selectOption('polyline');await page.locator('#city-auto-route').uncheck();
  await advanced(true);
  await page.evaluate(()=>MapWorkspace.focus([2000,1200],3));
  await drawInvalid();
  assert.match(await popup.innerText(),/此处无法建造[\s\S]*水面[\s\S]*高架桥或隧道/);
  assert(await page.locator('#city-draft-info').evaluate(n=>n.classList.contains('error')));
  await click('#city-finish');await wait();assert.equal(await page.evaluate(()=>CityApp.state.roads.length),0);assert(await popup.isVisible());
  await advanced(false);
  for(const [width,height] of [[1440,900],[1024,768],[375,812]]){
   await page.setViewportSize({width,height});
   await page.evaluate(()=>MapWorkspace.draw());
   const box=await popup.boundingBox(),menu=await page.locator('#workspace-build-menu').boundingBox();
   assert(box&&box.x>=0&&box.y>=0&&box.x+box.width<=width&&box.y+box.height<=height,JSON.stringify(box));
   assert(box.x+box.width<=menu.x||box.x>=menu.x+menu.width||box.y+box.height<=menu.y||box.y>=menu.y+menu.height,'Reason must not overlap the construction palette');
   const rail=await page.locator('.workspace-rail').boundingBox();assert(box.x>=rail.x+rail.width,'Reason must not hide behind the tool rail');
   await page.screenshot({path:path.join(output,`water-${width}.png`)});
  }
  await page.setViewportSize({width:1440,height:900});
  // Changing the layer revalidates the same draft; a bridge can cross water.
  await page.locator('#city-level').selectOption('1');
  await popup.waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.getElementById('city-draft-info').textContent.includes('预计'));
  assert.equal(await page.locator('#city-draft-info').evaluate(n=>n.classList.contains('error')),false);
  await click('#city-finish');await page.waitForFunction(()=>CityApp.state.roads.length===1&&!CityApp.working);
  assert.equal(await popup.isVisible(),false);
  routeY=1700;
  await page.locator('#city-level').selectOption('0');
  await advanced(true);
  await drawInvalid();await click('#city-cancel');assert.equal(await popup.isVisible(),false);
  // Errors without a conflict coordinate still appear beside the draft endpoint.
  await page.route('**/api/city/preview',async route=>{
   const response=await route.fetch(),body=await response.json();delete body.point;
   await route.fulfill({response,json:body});
  });
  await drawInvalid();assert.match(await popup.innerText(),/水面/);
  await click('.workspace-dock [data-tool="pan"]');assert.equal(await popup.isVisible(),false);
  // An in-flight validation cannot resurrect the error after canceling.
  await page.unroute('**/api/city/preview');
  await click('#workspace-build');await popup.waitFor({state:'visible'});await click('#city-cancel');await advanced(true);
  let release,started;
  const pending=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
  await page.route('**/api/city/preview',async route=>{const response=await route.fetch();started();await gate;await route.fulfill({response});});
  await advanced(true);await addPoint(1400,routeY);await addPoint(2600,routeY);await pending;
  await click('#city-cancel');release();await page.unrouteAll({behavior:'wait'});
  assert.equal(await popup.isVisible(),false);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:['water reason','failed commit preserves draft','responsive popup','bridge revalidation and commit','cancel','missing conflict point','tool switch','stale response'],errors}));
 }catch(error){if(page)await page.screenshot({path:path.join(output,'failure.png')});throw error;}
 finally{await browser?.close();server.kill();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
