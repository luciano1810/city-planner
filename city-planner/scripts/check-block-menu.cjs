// Exercise the block palette against the real renewal engine in an isolated city.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,spawnSync}=require('node:child_process');
const app=path.resolve(__dirname,'..'),output=path.join(app,'output/block-menu');fs.mkdirSync(output,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'shanhai-block-menu-'));
const python=process.env.TERRAIN_PYTHON||path.join(app,'.venv/bin/python');
const fixture=spawnSync(python,['-c',`import json
from tests.test_renewal import neighborhood
c,plots=neighborhood()
print(json.dumps(c.snapshot()))`],{cwd:app,encoding:'utf8'});
assert.equal(fixture.status,0,fixture.stderr);fs.writeFileSync(path.join(temp,'blocks.json'),fixture.stdout);
(async()=>{
 let browser,page;
 const server=spawn(python,['backend/server.py','--preview','--port','0'],{cwd:app,env:{...process.env,SHANHAI_DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
 let serverLog='';server.stderr.on('data',s=>serverLog+=s);
 try{
  const ready=await new Promise((resolve,reject)=>{require('node:readline').createInterface({input:server.stdout}).once('line',s=>resolve(JSON.parse(s)));server.once('error',reject);server.once('exit',code=>reject(new Error(`Server ${code}: ${serverLog}`)));});
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(15000);await page.emulateMedia({reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});
  const click=s=>page.locator(s).click(),wait=()=>page.waitForFunction(()=>CityApp.active&&!CityApp.working);
  const choose=k=>click(`[data-block-kind="${k}"]`);
  const select=async id=>{
   const point=await page.evaluate(id=>{const p=CityApp.state.parcels.find(p=>p.id===id);return p.center;},id);
   await page.evaluate(p=>MapWorkspace.focus(p,18),point);
   const screen=await page.evaluate(p=>{const g=MapWorkspace.geometry,r=document.getElementById('map').getBoundingClientRect(),t=MapWorkspace.terrain;return {x:r.x+g.left+p[0]*t.width*g.scale/CityApp.state.meta.width,y:r.y+g.top+p[1]*t.height*g.scale/CityApp.state.meta.height};},point);
   const blocked=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.id!=='map',screen);
   if(blocked)await click('#workspace-blocks');
   await page.mouse.click(screen.x,screen.y);
   if(blocked)await click('#workspace-blocks');
  };
  await page.goto(`http://127.0.0.1:${ready.port}`,{waitUntil:'networkidle'});
  await page.locator('#city-import-file').setInputFiles(path.join(temp,'blocks.json'));await wait();
  const plots=await page.evaluate(()=>CityApp.state.parcels.filter(p=>p.block&&!p.blockCommon&&p.building).map(p=>p.id));assert(plots.length>1);
  assert.equal(await page.locator('#workspace-blocks').innerText(),'区块');
  await click('#workspace-blocks');assert(await page.locator('#workspace-block-menu').isVisible());assert.equal(await page.locator('.city-sidebar').isVisible(),false);
  assert.equal(await page.locator('#block-redevelop .build-card').count(),6);assert(await page.locator('#city-renewal-preview').isDisabled());
  await select(plots[0]);assert.deepEqual(await page.evaluate(()=>CityApp.renewalSelection),[plots[0]]);
  for(const target of ['residential','commercial','office','industrial','warehouse','mixed']){
   await choose(target);await click('#city-renewal-preview');assert.equal(await page.locator('#renewal-target').inputValue(),target);await click('#city-dialog-close');
  }
  await choose('residential');const before=await page.evaluate(()=>CityApp.state.revision);
  await click('#city-renewal-preview');await click('#renewal-preview-btn');await wait();assert(await page.locator('#renewal-commit').isEnabled());assert.equal(await page.evaluate(()=>CityApp.state.revision),before);await click('#city-dialog-close');
  await click('#block-tab-maintain');await choose('onsite');await click('#city-renewal-preview');assert.equal(await page.locator('#city-dialog-body h2').innerText(),'原址重建');assert(await page.locator('#renewal-phases').isDisabled());await click('#city-dialog-close');
  await select(plots[1]);assert(await page.locator('#city-renewal-preview').isDisabled());await click('#city-renewal-clear');await select(plots[0]);
  await choose('renovate');await click('#city-renewal-preview');assert.equal(await page.locator('#city-dialog-body h2').innerText(),'建筑翻新');await click('#renewal-preview-btn');await wait();await click('#renewal-commit');await wait();
  assert.equal(await page.evaluate(()=>CityApp.state.renewals.length),1);assert.equal(await page.evaluate(()=>CityApp.state.renewals[0].options.mode),'renovate');await click('#city-dialog-close');
  await click('#block-tab-projects');assert.equal(await page.locator('#block-projects [data-renewal]').count(),1);await click('#block-projects [data-renewal]');assert((await page.locator('#city-dialog-body').innerText()).includes('交付进度'));await click('#city-dialog-close');
  await click('#block-advanced-toggle');await page.locator('#city-auto-renew').uncheck();await wait();assert.equal(await page.evaluate(()=>CityApp.state.settings.autoRenew),false);
  await page.locator('#city-auto-grow').check();await wait();assert.equal(await page.evaluate(()=>CityApp.state.settings.autoGrow),true);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#block-advanced-panel').isVisible(),false);assert(await page.locator('#workspace-block-menu').isVisible());
  await click('#workspace-build');assert(await page.locator('#workspace-build-menu').isVisible());assert.equal(await page.locator('#workspace-block-menu').isVisible(),false);
  await click('#workspace-blocks');assert.equal(await page.locator('#workspace-build-menu').isVisible(),false);assert(await page.locator('#block-projects').isVisible());
  for(const [width,height] of [[1600,1000],[1440,900],[1024,768],[375,812]]){
   await page.setViewportSize({width,height});
   for(const tab of ['redevelop','maintain','projects']){
    await click('#block-tab-'+tab);
    const b=await page.locator('#workspace-block-menu').boundingBox(),d=await page.locator('.workspace-dock').boundingBox();
    assert(b.x>=0&&b.y>=0&&b.x+b.width<=width&&b.y+b.height<d.y,JSON.stringify(b));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(output,`${tab}-${width}.png`)});
   }
   await click('#block-advanced-toggle');const sub=await page.locator('#block-advanced-panel').boundingBox();assert(sub.x>=0&&sub.y>=0&&sub.x+sub.width<=width&&sub.y+sub.height<=height,JSON.stringify(sub));
   await page.screenshot({path:path.join(output,`advanced-${width}.png`)});await page.keyboard.press('Escape');
  }
  await page.keyboard.press('Escape');assert.equal(await page.locator('#workspace-block-menu').isVisible(),false);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:['six target presets','pure preview','single building maintenance','real renovation project','project details','advanced settings','mutual exclusion','four viewport sizes'],errors}));
 }catch(error){if(page){await page.screenshot({path:path.join(output,'failure.png')});console.error(await page.locator('#city-status').innerText());}throw error;}
 finally{await browser?.close();server.kill();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
