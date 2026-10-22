// Browser integration: construction controls must produce real engine commands.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,spawnSync}=require('node:child_process');
const app=path.resolve(__dirname,'..');
const output=path.join(app,'output/build-menu');fs.mkdirSync(output,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'shanhai-build-menu-'));
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
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(15000);
  await page.emulateMedia({reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Page error:',e.stack);});
  const click=selector=>page.locator(selector).click();
  const openRoads=async()=>{
    if(!await page.locator('#workspace-build-menu').isVisible())await click('#workspace-build');
    await click('#build-tab-roads');
  };
  const wait=()=>page.waitForFunction(()=>CityApp.active&&!CityApp.working);
  const choose=kind=>click(`[data-build-kind="${kind}"]`);
  const advanced=async open=>{if(await page.locator('#build-advanced-panel').isVisible()!==open)await click('#build-advanced-toggle');};
  const place=async point=>{
    await advanced(true);
    await page.locator('#city-coordinate-x').fill(String(point[0]));
    await page.locator('#city-coordinate-y').fill(String(point[1]));
    await click('#city-coordinate-apply');await wait();
    await advanced(false);
  };
  await page.goto(`http://127.0.0.1:${ready.port}`,{waitUntil:'networkidle'});
  await page.locator('#city-import-file').setInputFiles(path.join(temp,'coast.json'));await wait();
  const sceneBefore=await page.evaluate(()=>({settings:CityScene.settings,time:CityScene.time,quality:CityScene.effectiveQuality}));
  await click('#workspace-build');assert(await page.locator('#workspace-build-menu').isVisible());
  assert.deepEqual(await page.evaluate(()=>({settings:CityScene.settings,time:CityScene.time,quality:CityScene.effectiveQuality})),sceneBefore,'Preview must not change the live city lighting or renderer');
  assert.equal(await page.locator('.city-sidebar').isVisible(),false);
  assert.equal(await page.locator('#build-roads .build-thumbnail canvas').count(),9);
  const pixels=await page.locator('#build-roads canvas').evaluateAll(nodes=>nodes.map(c=>c.toDataURL()));
  assert.equal(new Set(pixels).size,9,'Every road type must have its own rendered appearance');
  await click('[aria-label="向后浏览建造卡片"]');
  assert(await page.locator('#build-roads .build-cards').evaluate(node=>node.scrollLeft>0));
  await click('[aria-label="向前浏览建造卡片"]');
  assert.equal(await page.locator('#build-roads .build-cards').evaluate(node=>node.scrollLeft),0);
  assert.equal(await page.evaluate(()=>CityApp.tool),'street');
  assert.equal(await page.locator('#city-oneway').isChecked(),false);
  const streetBefore=await page.locator('[data-build-kind="street"] canvas').evaluate(c=>c.toDataURL());
  await choose('street');assert(await page.locator('#city-oneway').isChecked());
  assert.notEqual(await page.locator('[data-build-kind="street"] canvas').evaluate(c=>c.toDataURL()),streetBefore,'Direction toggle must repaint actual lane markings');
  await choose('avenue');assert.equal(await page.locator('#city-oneway').isChecked(),false);
  await choose('street');assert(await page.locator('#city-oneway').isChecked(),'Direction must survive tool changes');
  // Buttons retain native keyboard activation instead of triggering map shortcuts.
  await page.locator('[data-build-kind="street"]').focus();await page.keyboard.press('Space');
  assert.equal(await page.locator('#city-oneway').isChecked(),false);
  await page.keyboard.press('Enter');assert(await page.locator('#city-oneway').isChecked());
  await page.locator('#city-shape').selectOption('polyline');await page.locator('#city-level').selectOption('1');await page.locator('#city-auto-route').uncheck();
  const paletteBefore=await page.locator('#workspace-build-menu').boundingBox();
  await advanced(true);
  assert.deepEqual(await page.locator('#workspace-build-menu').boundingBox(),paletteBefore,'Submenu must not resize the main palette');
  for(const [x,y] of [[400,700],[1500,700]]){
    await page.locator('#city-coordinate-x').fill(String(x));await page.locator('#city-coordinate-y').fill(String(y));await click('#city-coordinate-apply');
  }
  await page.waitForFunction(()=>document.getElementById('city-draft-info').textContent.includes('预计'));
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#build-advanced-panel').isVisible(),false);
  assert(await page.locator('#workspace-build-menu').isVisible());
  await choose('avenue');await choose('street');
  assert((await page.locator('#city-draft-info').innerText()).includes('2 个控制点'),'Draft must survive switching cards');
  assert.equal(await page.locator('#city-level').inputValue(),'1');
  await click('#city-finish');await page.waitForFunction(()=>CityApp.state.roads.length===1&&!CityApp.working);
  const road=await page.evaluate(()=>CityApp.state.roads.at(-1));
  assert.equal(road.kind,'street');assert.equal(road.level,1);assert.equal(road.oneway,true);assert.equal(road.shape,'polyline');
  // Build a real railway for both types of station.
  await choose('train');await page.locator('#city-level').selectOption('0');await advanced(true);
  for(const [x,y] of [[300,1000],[1700,1000]]){
    await page.locator('#city-coordinate-x').fill(String(x));await page.locator('#city-coordinate-y').fill(String(y));await click('#city-coordinate-apply');
  }
  await page.waitForFunction(()=>document.getElementById('city-draft-info').textContent.includes('预计'));
  await click('#city-finish');await page.waitForFunction(()=>CityApp.state.roads.length===2&&!CityApp.working);
  assert.equal(await page.evaluate(()=>CityApp.state.roads.at(-1).kind),'train');
  await advanced(false);
  await click('#build-tab-buildings');assert.equal(await page.locator('#build-buildings .build-thumbnail canvas').count(),4);
  const buildingPixels=await page.locator('#build-buildings canvas').evaluateAll(nodes=>nodes.map(c=>c.toDataURL()));
  assert.equal(new Set(buildingPixels).size,4,'Each transport building needs a distinct model portrait');
  await page.locator('#city-special-size').selectOption('compact');await page.locator('#city-special-name').fill('菜单测试机场');
  await place([900,2700]);
  assert(await page.evaluate(()=>CityApp.state.facilities.some(f=>f.kind==='airport'&&f.name==='菜单测试机场')));
  await choose('port');await page.locator('#city-special-name').fill('菜单测试港口');await page.locator('#city-special-size').selectOption('standard');await page.locator('#city-special-rotation').fill('270');
  await place([2000,2000]);
  assert(await page.evaluate(()=>CityApp.state.facilities.some(f=>f.kind==='port'&&f.name==='菜单测试港口')));
  await choose('train_station');assert(await page.locator('#city-special-rotation').isDisabled());
  await page.locator('#city-special-name').fill('菜单测试火车站');await place([750,1020]);
  assert(await page.evaluate(()=>CityApp.state.facilities.some(f=>f.kind==='train_station'&&f.name==='菜单测试火车站')));
  await choose('metro_station');assert(await page.locator('#build-metro-settings').isVisible());
  await page.locator('#build-metro-name').fill('菜单测试地铁站');await place([1350,1000]);
  assert(await page.evaluate(()=>CityApp.state.stops.some(s=>s.mode==='metro'&&s.name==='菜单测试地铁站')));
  await click('#workspace-build');assert.equal(await page.locator('#workspace-build-menu').isVisible(),false);
  await click('#workspace-build');assert(await page.locator('#build-buildings').isVisible(),'Reopening preserves the category');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#workspace-build-menu').isVisible(),false);
  await openRoads();assert(await page.locator('#build-roads').isVisible());
  await click('.workspace-dock [data-tool="pan"]');assert.equal(await page.locator('#workspace-build-menu').isVisible(),false);
  // Existing inspector entry into road editing also opens the palette.
  await click('#workspace-build');await advanced(true);
  await page.locator('#city-object-picker').selectOption(road.id);
  await click('#road-edit-shape');assert(await page.locator('#build-roads').isVisible());
  assert.equal(await page.locator('#city-level').inputValue(),'1');assert(await page.locator('#city-oneway').isChecked());
  await click('#city-cancel');await advanced(false);
  // Visual checks on a developed fixture, with independent viewport geometry checks.
  await page.locator('#city-import-file').setInputFiles(path.join(app,'tests/fixtures/lighting-materials-city.json'));await wait();
  await page.evaluate(()=>MapWorkspace.focus([2260,2395],18));
  const sizes=[];
  for(const [width,height] of [[1600,1000],[1440,900],[1024,768],[375,812]]){
    await page.setViewportSize({width,height});await openRoads();
    for(const category of ['roads','buildings']){
      await click('#build-tab-'+category);
      const g=await page.evaluate(()=>{const p=document.getElementById('workspace-build-menu').getBoundingClientRect(),d=document.querySelector('.workspace-dock').getBoundingClientRect();return {x:p.x,y:p.y,right:p.right,bottom:p.bottom,dockTop:d.top,overflow:document.documentElement.scrollWidth>innerWidth};});
      assert(g.x>=0&&g.y>=0&&g.right<=width&&g.bottom<g.dockTop,JSON.stringify(g));assert.equal(g.overflow,false);
      await page.screenshot({path:path.join(output,`${category}-${width}.png`),animations:'disabled'});sizes.push({width,height,category,...g});
      await advanced(true);
      const sub=await page.locator('#build-advanced-panel').boundingBox();
      assert(sub.x>=0&&sub.y>=0&&sub.x+sub.width<=width&&sub.y+sub.height<=height,JSON.stringify(sub));
      assert.equal((await page.locator('#workspace-build-menu').boundingBox()).height,g.bottom-g.y);
      await page.screenshot({path:path.join(output,`advanced-${category}-${width}.png`),animations:'disabled'});
      await click('#build-tab-'+category);
      assert.equal(await page.locator('#build-advanced-panel').isVisible(),false,'Outside click closes only the submenu');
    }
    await click('#workspace-build-menu .build-menu-close');
  }
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify({passed:true,sizes,errors},null,2));
  console.log(JSON.stringify({passed:true,checks:['road direction and keyboard toggles','draft and settings preservation','real road creation','advanced coordinate placement for airports and ports','railway and metro station placement','inspector editing','submenu dismissal and preserved drafts','menu lifecycle','four viewport sizes'],errors}));
 }catch(error){
  if(page){await page.screenshot({path:path.join(output,'failure.png')});console.error(await page.locator('#city-status').innerText());}
  throw error;
 }finally{await browser?.close();server.kill();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
