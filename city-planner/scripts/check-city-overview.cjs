const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const app=path.resolve(__dirname,'..'),output=path.join(app,'output/city-overview');fs.mkdirSync(output,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'city-overview-'));
(async()=>{
 let browser;
 const server=spawn(path.join(app,'.venv/bin/python'),['backend/server.py','--preview','--port','0'],{cwd:app,env:{...process.env,SHANHAI_DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
 try{
  const ready=await new Promise((resolve,reject)=>{require('node:readline').createInterface({input:server.stdout}).once('line',s=>resolve(JSON.parse(s)));server.once('error',reject);});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/google-chrome',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  await page.goto(`http://127.0.0.1:${ready.port}`);
  await page.locator('#city-import-file').setInputFiles(path.join(app,'tests/fixtures/lighting-materials-city.json'));
  await page.waitForFunction(()=>CityApp.active&&!CityApp.working);
  const before=await page.evaluate(()=>JSON.stringify(CityApp.state));
  assert(!await page.locator('.city-sidebar').isVisible(),'no empty legacy sidebar on load');
  for(const id of ['workspace-build','workspace-blocks','workspace-observe']){
   await page.locator('#'+id).click();await page.locator('#'+id).click();
   assert(!await page.locator('.city-sidebar').isVisible(),'no empty sidebar after closing '+id);
  }
  await page.locator('.workspace-rail [data-category="transit"]').click();
  assert(await page.locator('#city-transit-panel').isVisible(),'transit controls remain accessible');
  await page.locator('#workspace-build').click();await page.locator('#city-dashboard').click();
  assert(!await page.locator('#workspace-build-menu').isVisible());
  const cards=page.locator('.overview-stat-card');assert.equal(await cards.count(),9);
  assert.equal(await page.locator('#city-inspector .inspector-index').count(),0);
  const checks={housing:['住房空置率','住房收入比'],population:['人口变化'],travel:['出行方式','收入组与时段可达性'],liveTraffic:['样本车辆','等待车辆','样本通过','模拟精度','交通来源'],finance:['城市账目','分项账目'],growth:['地形与自动生长'],economy:['完整统计与分布'],districts:['城区'],events:['城市记事','全部城市记事']};
  for(const [key,texts] of Object.entries(checks)){
   await page.locator(`[data-overview-card="${key}"]`).click();assert.equal(await page.locator('[data-overview-section]:visible').count(),1);
   const detail=await page.locator('.city-overview-detail').innerText();for(const text of texts)assert(detail.includes(text),key+': '+text);
   if(key==='population')assert(await page.locator('#city-pop-chart').evaluate(c=>c.width>0&&c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0)));
   await page.locator('.overview-back').click();assert(await page.locator('.city-overview-cards').isVisible());
  }
  assert.equal(await page.evaluate(()=>JSON.stringify(CityApp.state)),before);
  await page.locator('[data-overview-card="housing"]').focus();await page.keyboard.press('Enter');await page.keyboard.press('Escape');assert(await page.locator('.city-overview-cards').isVisible());
  await page.keyboard.press('Escape');assert(!await page.locator('#city-inspector').isVisible());
  await page.locator('#city-dashboard').click();await page.locator('[data-overview-card="districts"]').click();
  const district=page.locator('[data-overview-section="districts"] [data-district]').first();const id=await district.getAttribute('data-district');await district.click();
  assert.equal(await page.evaluate(()=>CityApp.selected),id);assert(!await page.locator('#city-inspector').evaluate(n=>n.classList.contains('city-overview')));
  assert((await page.locator('#city-inspector').boundingBox()).x>800,'object inspector stays on the right');
  await page.locator('#city-dashboard').click();await page.locator('[data-overview-card="events"]').click();await page.locator('#city-events-all').click();assert(await page.locator('#city-dialog').isVisible());await page.locator('#city-dialog-close').click();
  for(const [width,height] of [[1600,1000],[1024,768],[375,812]]){
   await page.setViewportSize({width,height});
   const controls=await page.locator('.workspace-status-tray .city-controlbar').boundingBox();
   const settings=await page.locator('.workspace-settings-anchor #city-files').boundingBox();
   assert(controls.x<50&&controls.y>height/2,'simulation controls belong at lower left: '+JSON.stringify(controls));
   assert(settings.x>width-80&&settings.y<30,'settings stay independently at upper right');
   const widths=await page.locator('.city-kpi:not([hidden])').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().width));
   assert(widths.every(w=>Math.abs(w-180)<1),'all KPI cards share the compact width');
   await page.locator('#city-files').click();await page.locator('#settings-tab-scenario').click();
   const popover=await page.locator('#workspace-settings').boundingBox();
   assert(popover.x>=0&&popover.y>=0&&popover.x+popover.width<=width+1&&popover.y+popover.height<=height+1,'settings fit the viewport');
   await page.keyboard.press('Escape');
   await page.screenshot({path:path.join(output,`layout-${width}.png`)});
   await page.locator('#city-dashboard').click();
   const r=await page.locator('#city-inspector').boundingBox();assert(r.x>=0&&r.y>=0&&r.x+r.width<=width+1&&r.y+r.height<=height+1,JSON.stringify(r));
   const anchor=await page.locator('.workspace-status-tray').boundingBox();
   assert(Math.abs(r.x-anchor.x)<1&&Math.abs(r.y+r.height-anchor.y+12)<1,'overview anchored above lower-left summary');
   assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
   await page.screenshot({path:path.join(output,`overview-${width}.png`)});
   await page.locator('[data-overview-card="housing"]').click();
   const detail=await page.locator('#city-inspector').boundingBox();
   assert(Math.abs(detail.x-anchor.x)<1&&Math.abs(detail.y+detail.height-anchor.y+12)<1,'detail keeps the same anchor');
   await page.screenshot({path:path.join(output,`housing-${width}.png`)});
  }
  await page.locator('#workspace-observe').click();await page.locator('#observe-tab-reports').click();await page.locator('#city-baseline').click();
  await page.locator('#city-dashboard').click();assert.equal(await cards.count(),10);
  await page.locator('[data-overview-card="comparison"]').click();assert((await page.locator('.city-overview-detail').innerText()).includes('岗位变化'));
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:['empty legacy sidebar removed','transit controls accessible','lower-left overview and detail at three viewport sizes','nine category cards','all original sections reachable','population chart','no city mutation','keyboard and back navigation','district inspection stays on right','complete event dialog'],errors}));
 }finally{await browser?.close();server.kill();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
