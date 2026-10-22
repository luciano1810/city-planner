// Real browser + local engine, isolated from the player's cities and saves.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,spawnSync}=require('node:child_process');
const app=path.resolve(__dirname,'..'),output=path.join(app,'output/playwright/transit-menu');fs.mkdirSync(output,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'shanhai-transit-'));
const python=process.env.TERRAIN_PYTHON||path.join(app,'.venv/bin/python');
const fixture=spawnSync(python,['-c',`import json
from tests.test_bus_transit import bus_city
c,r=bus_city(False)
print(json.dumps(c.snapshot()))`],{cwd:app,encoding:'utf8'});
assert.equal(fixture.status,0,fixture.stderr);fs.writeFileSync(path.join(temp,'bus.json'),fixture.stdout);
(async()=>{
 let browser,page;
 const server=spawn(python,['backend/server.py','--preview','--port','0'],{cwd:app,env:{...process.env,SHANHAI_DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
 let log='';server.stderr.on('data',s=>log+=s);
 try{
  const ready=await new Promise((resolve,reject)=>{require('node:readline').createInterface({input:server.stdout}).once('line',s=>resolve(JSON.parse(s)));server.once('error',reject);server.once('exit',code=>reject(new Error(`Server ${code}: ${log}`)));});
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(20000);await page.emulateMedia({reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});
  const click=s=>page.locator(s).click(),wait=()=>page.waitForFunction(()=>CityApp.active&&!CityApp.working);
  // Record the real compositor's strokes, matching full route geometry rather
  // than a checkbox value, so hidden lines cannot leak through another mode.
  async function routeStrokes(draft=false){
   return page.evaluate(draft=>{
    const paths=draft?CityApp.busDraft.preview.paths:CityApp.state.lines.flatMap(line=>line.paths);
    const expected=new Set(paths.map(route=>JSON.stringify(route.points)));
    const canvas=document.createElement('canvas'),g=MapWorkspace.geometry;
    canvas.width=g.width;canvas.height=g.height;
    const ctx=canvas.getContext('2d');let points=[],strokes=0;
    for(const name of ['beginPath','moveTo','lineTo','stroke']){
     const native=ctx[name].bind(ctx);
     ctx[name]=(...args)=>{
      if(name==='beginPath')points=[];
      else if(name==='moveTo'||name==='lineTo')points.push(args);
      else if(expected.has(JSON.stringify(points)))strokes++;
      return native(...args);
     };
    }
    CityApp.paint(ctx,g);return strokes;
   },draft);
  }
  async function point(p,{clickPoint=true}={}){
   await page.evaluate(p=>MapWorkspace.focus(p,12),p);
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const screen=await page.evaluate(p=>{const g=MapWorkspace.geometry,r=document.getElementById('map').getBoundingClientRect(),t=MapWorkspace.terrain;return {x:r.x+g.left+p[0]*t.width*g.scale/CityApp.state.meta.width,y:r.y+g.top+p[1]*t.height*g.scale/CityApp.state.meta.height};},p);
   assert.equal(await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.id,screen),'map');
   await page.mouse.move(screen.x,screen.y);if(clickPoint)await page.mouse.click(screen.x,screen.y);
  }
  await page.goto(`http://127.0.0.1:${ready.port}`,{waitUntil:'networkidle'});
  await page.locator('#city-import-file').setInputFiles(path.join(temp,'bus.json'));await wait();
  await click('#workspace-transit');assert(await page.locator('#workspace-transit-menu').isVisible());assert.equal(await page.locator('.city-sidebar').isVisible(),false);
  assert.equal(await page.locator('#transit-bus .build-card').count(),3);assert(await page.locator('[data-transit-action="line"]').isDisabled());
  await page.screenshot({path:path.join(output,'bus-before-depot.png')});
  await click('[data-transit-action="depot"]');assert.equal(await page.evaluate(()=>CityApp.tool),'bus_depot');
  await click('#workspace-transit');await point([700,920],{clickPoint:false});
  await page.waitForFunction(()=>document.getElementById('city-special-hint').textContent.includes('可放置'));
  await point([700,920]);await wait();assert.equal(await page.evaluate(()=>CityApp.state.facilities.filter(f=>f.kind==='bus_depot'&&f.connected).length),1);
  await click('#workspace-transit');await click('[data-transit-action="line"]');assert.equal(await page.evaluate(()=>CityApp.tool),'line');
  await page.locator('#city-line-name').fill('河岸公交');await click('#workspace-transit');
  await point([875.3,1010]);assert.equal(await page.evaluate(()=>CityApp.busDraft.stops.length),1);
  await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>CityApp.state.lines.length),0);
  await point([875.3,1010]);assert.equal(await page.evaluate(()=>CityApp.busDraft.stops.length),1);
  await point([1790,1450]);await page.waitForFunction(()=>CityApp.busDraft.preview?.valid);
  assert.equal(await page.locator('#city-show-transit-lines').isChecked(),false);
  assert(await routeStrokes(true)>0,'a new route remains visible while the overlay is off');
  assert.equal(await page.evaluate(()=>CityApp.busDraft.stops.length),2);
  await page.keyboard.press('Backspace');assert.equal(await page.evaluate(()=>CityApp.busDraft.stops.length),1);
  await point([1790,1450]);await page.waitForFunction(()=>CityApp.busDraft.preview?.valid);
  await click('#workspace-transit');await page.screenshot({path:path.join(output,'bus-route-draft.png')});await click('#workspace-transit');await page.locator('#map').focus();
  await page.keyboard.press('Enter');await wait();
  await page.waitForFunction(()=>CityApp.state.lines.length===1);assert.equal(await page.evaluate(()=>CityApp.state.stops.length),2);
  assert.equal(await page.evaluate(()=>CityApp.state.lines[0].valid),true);assert.equal(await page.evaluate(()=>CityApp.busDraft.stops.length),0);
  assert(await page.evaluate(()=>CityApp.state.lines[0].paths[0].points.some(p=>p[0]===1794&&p[1]===1006)));
  assert.equal(await routeStrokes(),0,'committing a route does not enable the overlay');
  await click('#workspace-transit');await click('[data-transit-action="manage"]');
  assert.equal(await routeStrokes(),0,'opening the transit menu does not reveal routes');
  await click('#city-line-list [data-line]');
  assert.equal(await routeStrokes(),0,'selecting a route does not reveal it');
  assert(await page.locator('#transit-management').isVisible());await click('#tm-more');
  assert.equal(await page.locator('#workspace-transit-menu').isVisible(),false);assert(await page.locator('#edit-headway').isVisible());
  await page.locator('#edit-headway').fill('6');await click('#line-update');await wait();assert.equal(await page.evaluate(()=>CityApp.state.lines[0].headway),6);
  await click('#line-toggle');await wait();assert.equal(await page.evaluate(()=>CityApp.state.lines[0].enabled),false);
  await click('#line-toggle');await wait();assert.equal(await page.evaluate(()=>CityApp.state.lines[0].valid),true);
  await click('#workspace-observe');
  const overlay=page.locator('#city-show-transit-lines');assert(await overlay.isVisible());
  const savedCity=await page.evaluate(()=>JSON.stringify(CityApp.state));
  for(const quality of ['map','high']){
   await page.locator('#city-render-quality').selectOption(quality);
   assert.equal(await routeStrokes(),0);
   await overlay.check();assert(await routeStrokes()>=2,'both curb directions are drawn');
   await page.screenshot({path:path.join(output,`routes-visible-${quality}.png`)});
   await overlay.uncheck();assert.equal(await routeStrokes(),0);
   await page.screenshot({path:path.join(output,`routes-hidden-${quality}.png`)});
  }
  await click('[data-observe-group="traffic"]');
  for(const layer of ['transit','transitLoad']){
   await click(`[data-observe-layer="${layer}"]`);
   assert.equal(await routeStrokes(),0,'changing the theme respects the overlay switch');
   await overlay.focus();await page.keyboard.press('Space');assert(await routeStrokes()>=2);
   await page.keyboard.press('Space');assert.equal(await routeStrokes(),0);
  }
  assert.equal(await page.evaluate(()=>JSON.stringify(CityApp.state)),savedCity,'display preferences do not change city operations');
  await click('[data-observe-group="city"]');await click('[data-observe-layer="use"]');
  await click('#workspace-transit');await click('[data-transit-action="line"]');await click('#workspace-transit');await point([1200,990]);
  assert.equal(await page.evaluate(()=>CityApp.busDraft.stops[0].side),-1);await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>CityApp.busDraft.stops.length),0);assert.equal(await page.evaluate(()=>CityApp.tool),'select');
  await click('#workspace-transit');await click('#transit-tab-tram');assert.equal(await page.locator('#transit-tram .build-card').count(),3);assert.equal(await page.locator('#transit-tram .build-card:disabled').count(),3);
  await click('#transit-tab-rail');assert.equal(await page.locator('#transit-rail .build-card').count(),8);assert.equal(await page.locator('#transit-rail .build-card:disabled').count(),0);
  for(const [width,height] of [[1600,1000],[1024,768],[375,812]]){
   await page.setViewportSize({width,height});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   for(const tab of ['bus','tram','rail']){
    await click('#transit-tab-'+tab);
    const b=await page.locator('#workspace-transit-menu').boundingBox(),d=await page.locator('.workspace-dock').boundingBox();
    assert(b.x>=0&&b.y>=0&&b.x+b.width<=width&&b.y+b.height<d.y,JSON.stringify(b));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(output,`${tab}-${width}.png`)});
   }
   await click('#transit-advanced-toggle');const a=await page.locator('#transit-advanced').boundingBox();assert(a.x>=0&&a.y>=0&&a.x+a.width<=width&&a.y+a.height<=height,JSON.stringify(a));await page.keyboard.press('Escape');assert(await page.locator('#workspace-transit-menu').isVisible());
  }
  await page.setViewportSize({width:1600,height:1000});await click('#workspace-build');assert.equal(await page.locator('#workspace-transit-menu').isVisible(),false);assert(await page.locator('#workspace-build-menu').isVisible());
  await click('#build-tab-buildings');await click('[data-build-kind="airport"]');assert(await page.locator('#workspace-build-menu #city-special-controls').isVisible());
  await click('#workspace-transit');await click('#transit-tab-bus');await click('[data-transit-action="depot"]');assert(await page.locator('#transit-depot-settings #city-special-controls').isVisible());
  await click('#workspace-observe');
  for(const [width,height] of [[1600,1000],[1024,768],[375,812]]){
   await page.setViewportSize({width,height});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const b=await page.locator('#workspace-observe-menu').boundingBox(),d=await page.locator('.workspace-dock').boundingBox();
   assert(b.x>=0&&b.y>=0&&b.x+b.width<=width&&b.y+b.height<d.y,JSON.stringify(b));
   await overlay.check();await overlay.uncheck();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:path.join(output,`observe-routes-${width}.png`)});
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:['depot prerequisite and placement','curb snapping and road preview','duplicate rejection','Enter with two stops','Backspace and Escape','real route and operations','unified rail construction cards','responsive menus','shared construction controls','routes hidden by default, including menu and selection','observe toggle in map, detail and transit themes','draft visible independently','keyboard and responsive overlay control','display leaves operations unchanged'],screenshots:output}));
 }catch(error){if(page){await page.screenshot({path:path.join(output,'failure.png')});console.error(await page.locator('#city-status').innerText());}throw error;}
 finally{await browser?.close();server.kill();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
