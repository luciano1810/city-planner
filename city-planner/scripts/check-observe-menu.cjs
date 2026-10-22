// Observation cards must preserve real map, query, settings and export behavior.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,spawnSync}=require('node:child_process');
const app=path.resolve(__dirname,'..'),output=path.join(app,'output/observe-menu');fs.mkdirSync(output,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'shanhai-observe-menu-'));
const python=process.env.TERRAIN_PYTHON||path.join(app,'.venv/bin/python');
const fixture=spawnSync(python,['-c',`import json,sys
from pathlib import Path
from tests.test_city import TransitTests
from tests.test_renewal import neighborhood
from city.service import CityService
t,stops,_,_=TransitTests().transit_city()
t.command(dict(type='line',name='公交测试线',mode='bus',stops=stops,headway=10))
t.assign_traffic();t.summarize()
(Path(sys.argv[1])/'transit.json').write_text(json.dumps(t.snapshot()))
c,_=neighborhood()
CityService(sys.argv[1]).save(c,'观察对照',mode='new')
print(json.dumps(c.snapshot()))`,temp],{cwd:app,encoding:'utf8'});
assert.equal(fixture.status,0,fixture.stderr);fs.writeFileSync(path.join(temp,'observe.json'),fixture.stdout);
(async()=>{
 let browser,page;
 const server=spawn(python,['backend/server.py','--preview','--port','0'],{cwd:app,env:{...process.env,SHANHAI_DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
 let serverLog='';server.stderr.on('data',s=>serverLog+=s);
 try{
  const ready=await new Promise((resolve,reject)=>{require('node:readline').createInterface({input:server.stdout}).once('line',s=>resolve(JSON.parse(s)));server.once('error',reject);server.once('exit',code=>reject(new Error(`Server ${code}: ${serverLog}`)));});
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1600,height:1000}});
  page=await context.newPage();page.setDefaultTimeout(15000);await page.emulateMedia({reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});
  const click=s=>page.locator(s).click(),wait=()=>page.waitForFunction(()=>CityApp.active&&!CityApp.working);
  const point=async p=>{
   await page.evaluate(p=>MapWorkspace.focus(p,18),p);
   const screen=await page.evaluate(p=>{const g=MapWorkspace.geometry,r=document.getElementById('map').getBoundingClientRect(),t=MapWorkspace.terrain;return {x:r.x+g.left+p[0]*t.width*g.scale/CityApp.state.meta.width,y:r.y+g.top+p[1]*t.height*g.scale/CityApp.state.meta.height};},p);
   const blocked=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.id!=='map',screen);
   if(blocked)await click('#workspace-observe');
   await page.mouse.click(screen.x,screen.y);await wait();
   if(blocked)await click('#workspace-observe');
  };
  await page.goto(`http://127.0.0.1:${ready.port}`,{waitUntil:'networkidle'});
  await page.locator('#city-import-file').setInputFiles(path.join(temp,'observe.json'));await wait();
  await click('#workspace-build');await click('#workspace-observe');
  assert(await page.locator('#workspace-observe-menu').isVisible());assert.equal(await page.locator('#workspace-build-menu').isVisible(),false);assert.equal(await page.evaluate(()=>CityApp.tool),'select');
  assert.equal(await page.locator('[data-observe-layer]').count(),29);
  const analytics=['congestion','speed','delay','roadCapacity','transitLoad','stationActivity','commute','publicAccess','connectivity'];
  const groups={city:['use','population','jobs','districts','height','development'],economy:['land','rent','vacancy','change','comparison'],traffic:['access','traffic','transit','flows',...analytics],nature:['pollution','slope','cost','landscape','risk']};
  for(const [group,kinds] of Object.entries(groups)){
   await click(`[data-observe-group="${group}"]`);
   for(const kind of kinds){await click(`[data-observe-layer="${kind}"]`);assert.equal(await page.locator('#city-layer').inputValue(),kind);assert.equal(await page.locator(`[data-observe-layer="${kind}"]`).getAttribute('aria-pressed'),'true');}
  }
  assert.equal(await page.locator('[data-category="environment"],[data-category="services"],[data-tool="park"],[data-tool="plaza"],[data-tool="school"],[data-tool="clinic"]').count(),0);
  await click('[data-observe-layer="pollution"]');await click('#workspace-observe');await click('#workspace-observe');assert.equal(await page.locator('[data-observe-group="nature"]').getAttribute('aria-pressed'),'true');
  const quality=page.locator('#city-render-quality');
  assert.deepEqual(await quality.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value)),['auto','high','map']);
  const center=await page.evaluate(()=>[CityApp.state.meta.width/2,CityApp.state.meta.height/2]);
  const zoomTo=zoom=>page.evaluate(({center,zoom})=>MapWorkspace.focus(center,zoom),{center,zoom});
  const checkView=async(mode,effective)=>{
    await page.waitForFunction(expected=>document.body.dataset.mapView===expected,effective);
    assert.equal(await quality.inputValue(),mode);
    assert.equal(await page.evaluate(()=>CityScene.settings.quality),mode);
    assert(await page.locator(`[data-view="${mode}"]`).evaluateAll(nodes=>nodes.length>0&&nodes.every(n=>n.getAttribute('aria-pressed')==='true')));
  };
  await quality.selectOption('auto');await zoomTo(3);await checkView('auto','map');
  await zoomTo(80);await checkView('auto','high');await zoomTo(3);await checkView('auto','map');
  await page.locator('#city-render-labels').check();await checkView('auto','map');
  const viewBefore=await page.evaluate(()=>MapWorkspace.geometry);
  await quality.selectOption('high');await checkView('high','high');
  assert.deepEqual(await page.evaluate(()=>MapWorkspace.geometry),viewBefore,'Changing style must preserve framing');
  await zoomTo(80);await checkView('high','high');await zoomTo(3);await checkView('high','high');
  await quality.selectOption('map');await zoomTo(80);await checkView('map','map');
  await zoomTo(3);await checkView('map','map');await quality.selectOption('auto');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('shanhai-scene-v1')).quality),'auto');
  const reopened=await page.context().newPage();
  try{
    await reopened.goto(`http://127.0.0.1:${ready.port}`,{waitUntil:'networkidle'});
    assert.equal(await reopened.locator('#city-render-quality').inputValue(),'auto');
    assert.equal(await reopened.evaluate(()=>CityScene.settings.quality),'auto');
  }finally{await reopened.close();}
  await quality.selectOption('map');
  await page.locator('#city-render-labels').check();assert.equal(await page.evaluate(()=>CityScene.settings.labels),true);
  const clock=await page.evaluate(()=>({month:CityApp.state.month,revision:CityApp.state.revision}));
  await page.locator('#city-time-of-day').fill('720');await page.locator('#city-time-of-day').dispatchEvent('change');await wait();
  assert.equal(await page.evaluate(()=>CityApp.state.month),clock.month);assert.equal(await page.locator('#city-time-of-day').inputValue(),'720');
  await click('#observe-tab-queries');assert.equal(await page.evaluate(()=>CityApp.tool),'area');
  await point([580,580]);await point([800,720]);assert.equal(await page.locator('#city-dialog-body h2').innerText(),'范围统计');await click('#city-dialog-close');
  const plots=await page.evaluate(()=>CityApp.state.parcels.filter(p=>p.block&&!p.blockCommon&&p.building).map(p=>p.center));
  await click('[data-observe-query="isochrone"]');await page.locator('#city-access-budget').selectOption('45');await page.locator('#city-access-mode').selectOption('walk');
  const queryResponse=page.waitForResponse(r=>r.url().endsWith('/api/city/query'));
  await point(plots[0]);const query=await queryResponse;assert.equal(query.request().postDataJSON().minutes,45);assert.equal(query.request().postDataJSON().mode,'walk');assert.equal(await page.locator('#city-dialog-body h2').innerText(),'网络可达范围');await click('#city-dialog-close');await click('#city-query-clear');
  await click('[data-observe-query="route"]');await point(plots[0]);const routeResponse=page.waitForResponse(r=>r.url().endsWith('/api/city/route'));await point(plots[1]);assert.equal((await routeResponse).status(),200);
  await click('#observe-tab-reports');assert.equal(await page.evaluate(()=>CityApp.tool),'select');assert(await page.locator('#workspace-observe-menu').isVisible(),'Changing tabs must not dismiss the palette');
  await click('#city-history');assert((await page.locator('#city-dialog-body h2').innerText()).includes('城市历史'));await click('#city-dialog-close');
  await click('#city-baseline');assert((await page.locator('#city-status').innerText()).includes('已记录基线'));
  for(const [id,name] of [['city-csv','statistics.csv'],['city-summary','summary.json']]){
   const downloaded=page.waitForEvent('download');await click('#'+id);const download=await downloaded;await download.saveAs(path.join(output,name));await wait();assert(fs.statSync(path.join(output,name)).size>20);
  }
  await click('#city-compare');await wait();await click('[data-compare="0"]');await wait();assert.equal(await page.locator('#city-dialog-body h2').innerText(),'方案比较');await click('#city-dialog-close');
  await click('#observe-tab-layers');assert.equal(await page.locator('[data-observe-layer="comparison"]').getAttribute('aria-pressed'),'true');assert(await page.locator('[data-observe-layer="comparison"]').isVisible());
  await click('#observe-advanced-toggle');await page.locator('#city-migration').fill('35');await page.locator('#city-growth').selectOption('0.5');await page.locator('#city-fare').fill('3');await click('#city-settings');await wait();assert.equal(await page.evaluate(()=>CityApp.state.settings.migration),35);assert.equal(await page.evaluate(()=>CityApp.state.settings.fare),3);
  await click('#observe-advanced-calibration');await click('#city-calibration');assert((await page.locator('#city-dialog-body h2').innerText()).includes('模型校准'));await click('#city-dialog-close');await click('#observe-advanced-toggle');await page.keyboard.press('Escape');assert.equal(await page.locator('#observe-advanced-panel').isVisible(),false);assert(await page.locator('#workspace-observe-menu').isVisible());
  await click('#workspace-blocks');assert.equal(await page.locator('#workspace-observe-menu').isVisible(),false);await click('#workspace-observe');assert.equal(await page.locator('#workspace-block-menu').isVisible(),false);
  await click('#observe-tab-reports');await click('#city-branch');await wait();assert((await page.locator('#city-status').innerText()).includes('独立分支'));
  if(!await page.locator('#workspace-observe-menu').isVisible())await click('#workspace-observe');
  for(const [width,height] of [[1600,1000],[1440,900],[1024,768],[375,812]]){
   await page.setViewportSize({width,height});
   for(const tab of ['layers','queries','reports']){
    await click('#observe-tab-'+tab);
    if(tab==='layers')await click('[data-observe-group="city"]');
    const b=await page.locator('#workspace-observe-menu').boundingBox(),d=await page.locator('.workspace-dock').boundingBox();assert(b.x>=0&&b.y>=0&&b.x+b.width<=width&&b.y+b.height<d.y,JSON.stringify(b));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(output,`${tab}-${width}.png`)});
   }
   await click('#observe-advanced-toggle');await click('#observe-advanced-scenario');const b=await page.locator('#observe-advanced-panel').boundingBox();assert(b.x>=0&&b.y>=0&&b.x+b.width<=width&&b.y+b.height<=height,JSON.stringify(b));await page.screenshot({path:path.join(output,`advanced-${width}.png`)});await page.keyboard.press('Escape');
  }
  await page.setViewportSize({width:1600,height:1000});
  await click('#observe-tab-layers');await click('[data-observe-group="traffic"]');await click('[data-observe-layer="traffic"]');
  assert(await page.locator('#city-traffic-controls').isVisible());
  for(const [period,label] of [['peak','高峰最大值'],['am','早高峰'],['off','平峰'],['pm','晚高峰']]){
   await page.locator('#city-traffic-period').selectOption(period);
   assert((await page.locator('#city-traffic-note').innerText()).includes(label));
  }
  await page.evaluate(()=>{const picker=document.getElementById('city-object-picker');picker.value=CityApp.state.roads.find(r=>r.kind==='street').id;picker.dispatchEvent(new Event('change'));});
  assert.equal(await page.locator('.traffic-period-table tbody tr').count(),3);
  assert((await page.locator('#city-inspector').innerText()).includes('高峰饱和度'));
  assert((await page.locator('.traffic-period-table tbody tr').nth(1).innerText()).includes('活动抽样'));
  await click('.inspector-index button');
  await page.screenshot({path:path.join(output,'traffic-detail-1600.png')});
  await page.setViewportSize({width:375,height:812});
  await click('#workspace-observe');
  await click('.inspector-index button');
  await page.screenshot({path:path.join(output,'traffic-detail-375.png')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await click('#city-close-inspector');await click('#workspace-observe');await click('[data-observe-layer="access"]');
  assert.equal(await page.locator('#city-traffic-controls').isVisible(),false);
  await page.setViewportSize({width:1600,height:1000});
  await page.locator('#city-import-file').setInputFiles(path.join(app,'tests/fixtures/lighting-materials-city.json'));await wait();
  if(!await page.locator('#workspace-observe-menu').isVisible())await click('#workspace-observe');
  await click('[data-observe-group="traffic"]');
  for(const mode of ['map','high']){
   await quality.selectOption(mode);
   for(const key of analytics){
    await click(`[data-observe-layer="${key}"]`);
    assert(await page.locator('#city-traffic-controls').isVisible());
    assert((await page.locator('#city-traffic-note').innerText()).includes(await page.locator(`[data-observe-layer="${key}"] .build-card-label`).innerText()));
    if(['congestion','speed','delay'].includes(key)){
     assert(await page.locator('#city-traffic-period').isVisible());
     assert(await page.locator('#city-traffic-period option[value="off"]').evaluate(node=>node.disabled));
     await page.locator('#city-traffic-period').selectOption('am');
    }else assert.equal(await page.locator('#city-traffic-period').isVisible(),false);
   }
  }
  await click('[data-observe-layer="commute"]');
  assert(!(await page.locator('#city-traffic-note').innerText()).includes('尚无已完成'));
  await page.screenshot({path:path.join(output,'commute-view.png')});
  await page.locator('#city-import-file').setInputFiles(path.join(temp,'transit.json'));await wait();
  if(!await page.locator('#workspace-observe-menu').isVisible())await click('#workspace-observe');
  await quality.selectOption('map');await click('[data-observe-group="traffic"]');
  for(const key of ['transitLoad','stationActivity']){
   await click(`[data-observe-layer="${key}"]`);
   assert(!(await page.locator('#city-traffic-note').innerText()).includes('尚无'));
   await page.screenshot({path:path.join(output,`${key}-view.png`)});
  }
  await click('[data-observe-layer="traffic"]');await page.locator('#city-traffic-period').selectOption('off');
  await click('[data-observe-layer="speed"]');assert.equal(await page.locator('#city-traffic-period').inputValue(),'peak');
  await page.setViewportSize({width:375,height:812});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(output,'analytics-mobile.png')});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:['29 map layers','external layer sync','auto and fixed view modes','view preference persistence','lighting and display','area query','isochrone query','journey query','history and exports','scenario comparison and branch','advanced settings','mutual exclusion','four viewport sizes','traffic period switch and road detail','nine analytical views in map and high detail','populated commute and operating transit'],errors}));
 }catch(error){if(page){await page.screenshot({path:path.join(output,'failure.png')});console.error(await page.locator('#city-status').innerText());}throw error;}
 finally{await browser?.close();server.kill();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
