const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const app=path.resolve(__dirname,'..'),output=path.join(app,'output/service-statistics');fs.mkdirSync(output,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'city-service-stats-'));
(async()=>{
 let browser;
 const server=spawn(path.join(app,'.venv/bin/python'),['backend/server.py','--preview','--port','0'],{cwd:app,env:{...process.env,SHANHAI_DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
 try{
  const ready=await new Promise((resolve,reject)=>{require('node:readline').createInterface({input:server.stdout}).once('line',s=>resolve(JSON.parse(s)));server.once('error',reject);});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/google-chrome',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  await page.goto(`http://127.0.0.1:${ready.port}`);
  await page.locator('#city-import-file').setInputFiles(path.join(app,'tests/fixtures/auto-facilities-city.json'));
  await page.waitForFunction(()=>CityApp.active&&!CityApp.working);
  const before=await page.evaluate(()=>JSON.stringify(CityApp.state));
  await page.locator('[data-metric-group="services"]').click();
  const groups=await page.evaluate(()=>CityServiceStatistics.groups.map(g=>g.key));
  for(const key of groups){
   const card=page.locator(`[data-service="${key}"]`);await card.scrollIntoViewIfNeeded();await card.click();
   const expected=await page.evaluate(key=>CityServiceStatistics.summary(CityApp.state,key).count,key);
   assert.equal(await card.locator('strong').innerText(),expected+' 处');
   assert.equal(await page.locator('.metric-value strong').innerText(),String(expected));
   assert.equal(await page.locator('.service-facility').count(),expected);
   await page.keyboard.press('Escape');assert(!await page.locator('#workspace-metric-panel').isVisible());
  }
  assert.equal(await page.evaluate(()=>JSON.stringify(CityApp.state)),before,'Viewing statistics must not mutate the city');
  const health=page.locator('[data-service="health"]');await health.scrollIntoViewIfNeeded();await health.focus();await page.keyboard.press('Enter');
  const selectedId=await page.locator('.service-facility').first().getAttribute('data-service-facility');await page.locator('.service-facility').first().click();
  assert.equal(await page.evaluate(()=>CityApp.selected),selectedId);assert(await page.locator('#city-inspector').isVisible());await page.locator('#city-close-inspector').click();
  for(const [width,height] of [[1600,1000],[1024,768],[375,812]]){
   await page.setViewportSize({width,height});await health.scrollIntoViewIfNeeded();await health.click();
   const geometry=await page.evaluate(()=>['.metric-toolbar','.city-kpis','#workspace-metric-panel'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {selector,left:r.left,top:r.top,right:r.right,bottom:r.bottom};}));
   for(const r of geometry)assert(r.left>=0&&r.top>=0&&r.right<=width+1&&r.bottom<=height+1,JSON.stringify({width,r}));
   assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
   await page.screenshot({path:path.join(output,`services-${width}.png`)});await page.keyboard.press('Escape');
  }
  await page.locator('[data-metric-group="city"]').click();assert.equal(await page.locator('.city-kpi:visible').count(),5);
  await page.locator('.city-kpi').first().click();assert.equal(await page.locator('.metric-heading h2').innerText(),'人口与迁移');await page.keyboard.press('Escape');
  await page.locator('#city-import-file').setInputFiles(path.join(app,'tests/fixtures/lighting-materials-city.json'));await page.waitForFunction(()=>CityApp.active&&!CityApp.working&&CityApp.state.facilities.some(f=>f.kind==='clinic'));
  await page.locator('[data-metric-group="services"]').click();await health.scrollIntoViewIfNeeded();await health.click();assert.equal(await health.locator('strong').innerText(),'1 处');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,categories:groups.length,viewports:3,checks:['live counts and all facility lists','no city mutation','keyboard dismissal','map selection','city metrics preserved','refresh after import'],errors}));
 }finally{await browser?.close();server.kill();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
