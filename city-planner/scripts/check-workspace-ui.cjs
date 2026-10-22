// Focused integration and visual check for the shared terrain / city workspace.
// Uses Playwright when available; all writes go to an isolated temporary store.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const app=path.resolve(__dirname,'..');
const output=path.join(app,'output/playwright');fs.mkdirSync(output,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'shanhai-ui-'));
const python=process.env.TERRAIN_PYTHON||path.join(app,'.venv/bin/python');
const browserOptions={headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']};
if(process.env.CHROMIUM_EXECUTABLE)browserOptions.executablePath=process.env.CHROMIUM_EXECUTABLE;
(async()=>{
 let browser;
 const server=spawn(python,['backend/server.py','--preview','--port','0'],{cwd:app,env:{...process.env,SHANHAI_DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
 let serverLog='';server.stderr.on('data',s=>serverLog+=s);
 try{
  const ready=await new Promise((resolve,reject)=>{require('node:readline').createInterface({input:server.stdout}).once('line',s=>resolve(JSON.parse(s)));server.once('error',reject);server.once('exit',code=>reject(new Error(`Server ${code}: ${serverLog}`)));});
  browser=await chromium.launch(browserOptions);
  const page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(20000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const evidence={terrainCategories:[],cityCategories:[],sizes:[],errors};
  await page.goto(`http://127.0.0.1:${ready.port}`,{waitUntil:'networkidle'});
  const visible=async selector=>{await page.locator(selector).waitFor({state:'visible'});assert(await page.locator(selector).isVisible(),`${selector} must be visible`);};
  const click=async selector=>page.locator(selector).click();
  const openCategory=async category=>{
    const dock={roads:'build',buildings:'blocks',data:'observe'}[category];
    if(dock){
      const menu=dock==='blocks'?'block':dock;
      if(!await page.locator(`#workspace-${menu}-menu`).isVisible())await click(`#workspace-${dock}`);
      if(category==='roads')await click('#build-tab-roads');
    }else await click(`button[data-category="${category}"]`);
  };
  await click('#menu-new');
  await visible('#terrain-overview');
  assert.equal(await page.locator('.topbar>.brand').isVisible(),false,'Workspace must use statistics, not branding');
  for(const [category,ids] of Object.entries({biome:['.preset-grid'],shape:['#elevation','#flatness','#sea','#roughness','#moisture','#reset'],water:['#riverDensity','#riverWidth','#lakeCount','#lakeSize','#delta'],world:['#widthKm','#heightKm','#seed','#resolution']})){
    await click(`[data-terrain-category="${category}"]`);
    for(const id of ids)await visible(id);
    evidence.terrainCategories.push(category);
  }
  await page.locator('#widthKm').fill('8');await page.locator('#heightKm').fill('8');await page.locator('#resolution').selectOption('768');
  await click('[data-terrain-category="biome"]');await click('[data-preset="hills"]');
  await click('#generate');await page.waitForFunction(()=>MapWorkspace.canConfirm&&!MapWorkspace.busy);
  assert.notEqual(await page.locator('#stat-size').innerText(),'—');
  await click('#terrain-overview');await visible('[data-terrain-section="summary"]');
  assert((await page.locator('[data-terrain-section="summary"]').innerText()).includes('世界种子'));
  await click('[data-terrain-category="shape"]');
  assert(await page.evaluate(()=>{
    const bar=document.querySelector('.workspace-bottom').getBoundingClientRect();
    return ['.map-bottom','.city-entry'].every(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return r.top>=bar.top&&r.bottom<=bar.bottom;});
  }),'Terrain legend and confirmation must fit the shared bottom bar');
  await page.screenshot({animations:'disabled',path:path.join(output,'terrain-final.png')});
  await click('#city-start');await page.waitForFunction(()=>CityApp.active&&!CityApp.working);
  await visible('#city-dashboard');assert.equal(await page.locator('#terrain-overview').isVisible(),false);
  assert.deepEqual(await page.locator('.city-rail button').evaluateAll(buttons=>buttons.map(b=>b.dataset.category)),['transit']);
  assert.equal(await page.locator('[data-tool="park"],[data-tool="plaza"],[data-tool="school"],[data-tool="clinic"]').count(),0);
  assert.equal(await page.locator('.overview-button').count(),0,'No upper-left statistics button');
  assert.equal(await page.locator('.workspace-status-tray #city-dashboard').count(),1,'City overview belongs in the lower-left card');
  await click('.city-kpi:nth-child(1)');await visible('.workspace-metric-panel');
  assert((await page.locator('.metric-note').innerText()).includes('当前数据点'));
  await page.keyboard.press('Escape');
  await click('.city-kpi:nth-child(5)');await visible('.metric-empty');await click('.metric-close');
  // Import a deterministic developed city through the existing file workflow.
  await page.locator('#city-import-file').setInputFiles(path.join(app,'tests/fixtures/lighting-materials-city.json'));
  await page.waitForFunction(()=>CityApp.state?.stats.population>100&&!CityApp.working&&CityScene.assetsReady);
  for(const [index,title] of ['人口与迁移','财政收支','就业与岗位','土地价格','通勤与出行'].entries()){
    await click(`.city-kpi:nth-child(${index+1})`);await visible('.workspace-metric-panel');
    assert.equal(await page.locator('.metric-heading h2').innerText(),title);
    assert(await page.locator('.metric-chart svg circle').count()>1,'Chart must use historical points');
    await click('[data-months="36"]');assert.equal(await page.locator('.metric-history tbody tr').count(),36);
    await click('[data-months="0"]');
    const expected=await page.evaluate(()=>new Set([...CityApp.state.history.map(r=>r.month),CityApp.state.month]).size);
    assert.equal(await page.locator('.metric-history tbody tr').count(),expected);
    await page.keyboard.press('Escape');assert.equal(await page.locator('.workspace-metric-panel').isVisible(),false);
  }
  await click('.city-kpi:first-child');await click('.metric-heading h2');await visible('.workspace-metric-panel');
  await page.locator('#map-frame').click({position:{x:600,y:400}});assert.equal(await page.locator('.workspace-metric-panel').isVisible(),false);
  await click('.city-kpi:first-child');await click('.city-kpi:nth-child(2)');assert.equal(await page.locator('.metric-heading h2').innerText(),'财政收支');await click('.metric-close');
  await page.locator('.city-kpi').first().focus();await page.keyboard.press('Enter');await visible('.workspace-metric-panel');
  await page.keyboard.press('Escape');await page.keyboard.press('Space');await visible('.workspace-metric-panel');await click('.city-kpi:first-child');
  for(const [category,ids] of Object.entries({roads:['#city-shape','#city-level','#city-oneway','#city-finish'],buildings:['#city-auto-renew','#city-auto-grow','#city-grid-demo'],transit:['#signal-demand','#city-mode','#city-create-line','#city-line-list'],data:['#city-render-quality','#city-time-of-day','[data-observe-layer="use"]']})){
    await openCategory(category);
    if(category==='buildings')await click('#block-advanced-toggle');
    for(const id of ids)await visible(id);
    evidence.cityCategories.push(category);
  }
  await click('[data-observe-group="nature"]');await click('[data-observe-layer="pollution"]');
  assert.equal(await page.locator('#city-layer').inputValue(),'pollution');
  await click('[data-observe-group="city"]');await click('[data-observe-layer="use"]');
  await click('#workspace-build');await click('#build-tab-buildings');await click('[data-tool="airport"]');await visible('#city-special-controls');
  await openCategory('roads');await click('.workspace-dock [data-tool="select"]');
  // Object selection, all inspector data, and contextual road editing.
  await openCategory('roads');await click('#build-advanced-toggle');
  const road=await page.evaluate(()=>CityApp.state.roads.find(r=>r.kind==='street')||CityApp.state.roads[0]);
  await page.locator('#city-object-picker').selectOption(road.id);
  await visible('#city-inspector');assert((await page.locator('#city-inspector').innerText()).includes('工程成本'));
  await click('#road-edit-shape');await visible('#city-shape');assert.equal(await page.locator('#city-inspector').isVisible(),false);
  await click('#city-cancel');await click('.workspace-dock [data-tool="select"]');
  await click('#city-dashboard');
  for(const [key,label] of [['housing','住房空置率'],['finance','城市账目'],['population','人口变化'],['growth','地形与自动生长'],['economy','完整统计与分布'],['events','城市记事']]){
    await click(`[data-overview-card="${key}"]`);
    assert((await page.locator('.city-overview-detail').innerText()).includes(label),`Missing original information: ${label}`);
    await click('.overview-back');
  }
  await click('#city-close-inspector');
  // Simulation, signals and file dialog remain attached to the original controls.
  await click('#city-play');await page.waitForFunction(()=>document.getElementById('city-play').textContent==='暂停模拟');
  await page.waitForFunction(()=>CityApp.traffic);await click('#city-play');
  await click('button[data-category="transit"]');await visible('#signal-demand');assert.equal(await page.locator('#signal-hud').count(),0);await openCategory('roads');
  await click('#city-files');await visible('#workspace-settings');
  for(const id of ['#city-undo','#city-redo','#city-save','.workspace-file-menu>summary'])await visible(id);
  assert.equal(await page.locator('.workspace-bottom #city-hint,.workspace-bottom .workspace-files').count(),0);
  await page.screenshot({animations:'disabled',path:path.join(output,'city-settings.png')});
  await click('#city-save');await visible('#city-save-form');await page.locator('[name="save-mode"][value="new"]').check();await page.locator('#city-save-name').fill('UI 回归存档');
  await click('#file-save');await page.waitForFunction(()=>!document.getElementById('city-dialog').open&&!CityApp.working);
  await page.evaluate(()=>MapWorkspace.focus([2260,2395],18));
  // Minimap must contain an actual terrain image and change the camera.
  await page.waitForFunction(()=>{const c=document.getElementById('overview-map'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;const colors=new Set();for(let i=0;i<p.length;i+=64)colors.add(p[i]+','+p[i+1]+','+p[i+2]);return colors.size>10;});
  const before=await page.evaluate(()=>MapWorkspace.geometry.left);
  const miniBounds=await page.locator('#overview-map').boundingBox();
  await page.locator('#overview-map').click({position:{x:miniBounds.width*.75,y:miniBounds.height*.3}});
  const after=await page.evaluate(()=>MapWorkspace.geometry.left);assert.notEqual(before,after,'Minimap should move the viewport');
  await page.evaluate(()=>MapWorkspace.focus([2260,2395],18));
  await click('button[data-category="transit"]');
  // Every structural region must fit the viewport; major floating regions may not overlap.
  for(const [width,height] of [[1600,1000],[1440,900],[1024,768],[375,812]]){
    await page.setViewportSize({width,height});
    await page.evaluate(()=>{MapWorkspace.draw();document.getElementById('city-build-panel').scrollTop=0;});
    const geometry=await page.evaluate(()=>{
      const rect=selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect();return {selector,x:r.x,y:r.y,w:r.width,h:r.height};};
      return {overflow:document.documentElement.scrollWidth>innerWidth,regions:['.city-kpis','.city-controlbar','.city-sidebar','.workspace-rail','.workspace-bottom'].map(rect),mapTools:rect('.map-tools'),mapLabel:rect('.map-label')};
    });
    assert.equal(geometry.overflow,false,`Horizontal overflow at ${width}`);
    for(const r of geometry.regions)assert(r.x>=0&&r.y>=0&&r.x+r.w<=width+1&&r.y+r.h<=height+1,`Out of bounds at ${width}: ${JSON.stringify(r)}`);
    const overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
    for(let i=0;i<geometry.regions.length;i++)for(let j=i+1;j<geometry.regions.length;j++)assert(!overlap(geometry.regions[i],geometry.regions[j]),`Overlapping chrome at ${width}: ${geometry.regions[i].selector} / ${geometry.regions[j].selector}`);
    if(width>700){const kpi=geometry.regions[0];assert(!overlap(kpi,geometry.mapTools));assert(!overlap(kpi,geometry.mapLabel));}
    const heights=await page.locator('.city-kpi:visible,.city-controlbar').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height));
    assert(Math.max(...heights)-Math.min(...heights)<1,`Top cards must share one height at ${width}: ${heights}`);
    evidence.sizes.push({width,height,...geometry});
    assert.equal(await page.evaluate(()=>['.map-label','.map-view-switch','#signal-hud','.map-tools','.compass','.map-scale','.zoom-control','#city-hint','#city-legend'].some(s=>document.querySelector(s)?.closest('#map-frame'))),false,'Permanent controls must stay in the perimeter containers');
    await page.screenshot({animations:'disabled',path:path.join(output,`city-final-${width}.png`)});
    await page.locator('.city-kpi').nth(1).scrollIntoViewIfNeeded();await page.locator('.city-kpi').nth(1).click();
    const anchor=await page.locator('.city-kpi').nth(1).boundingBox();
    const panel=await page.locator('.workspace-metric-panel').boundingBox();assert(Math.abs(panel.y-anchor.y-anchor.height-8)<1,'Details must open below the clicked card');
    assert(await page.locator('.city-sidebar').isVisible(),'Metric expansion must preserve the tool panel');assert(panel.x>=0&&panel.y>=0&&panel.x+panel.width<=width+1&&panel.y+panel.height<=height+1);
    if(width===1440)await page.screenshot({animations:'disabled',path:path.join(output,'city-metric-expanded.png')});
    await click('.metric-close');
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  await click('.city-brand-caption .panel-dismiss');await visible('#overview-map');
  await click('button[data-category="transit"]');await visible('#city-transit-panel');
  await page.setViewportSize({width:1600,height:1000});await click('button[data-category="transit"]');
  await click('#workspace-observe');await visible('#city-render-quality');await visible('#city-legend');
  assert.equal(await page.locator('.workspace-view-panel').isVisible(),false);
  await click('#workspace-observe');
  await click('#fullscreen');await page.waitForFunction(()=>document.fullscreenElement);await visible('#measure');await click('#fullscreen');await page.waitForFunction(()=>!document.fullscreenElement);
  // Return home, open terrain again, and check the same small-screen layout.
  await click('#city-files');await click('.workspace-file-menu>summary');await click('#back-home');await click('#file-discard');await page.waitForFunction(()=>document.body.dataset.screen==='home');await click('#menu-new');
  await page.setViewportSize({width:375,height:812});await click('[data-terrain-category="water"]');await visible('#riverWidth');
  await page.screenshot({animations:'disabled',path:path.join(output,'terrain-final-mobile.png')});
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'workspace-ui-evidence.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({passed:true,terrainCategories:evidence.terrainCategories,cityCategories:evidence.cityCategories,viewports:evidence.sizes.map(s=>[s.width,s.height]),checks:['single perimeter without interior chrome','generate and confirm','all categories and original inspector information','special building controls','road editing','simulation and live traffic','save','minimap pixels and navigation','fullscreen','reduced motion','home navigation'],errors}));
 }finally{await browser?.close();server.kill();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
