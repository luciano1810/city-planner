// Real dock clicks in a detailed, paused city. A menu must never replace the
// finished viewport with the coarse base used for structural edits.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'shanhai-dock-textures-'));
const output=path.join(root,'output/playwright/dock-texture-stability');
fs.mkdirSync(output,{recursive:true});

(async()=>{
  let browser,page;
  const server=spawn(process.env.TERRAIN_PYTHON||path.join(root,'.venv/bin/python'),
    ['backend/server.py','--preview','--port','0'],
    {cwd:root,env:{...process.env,SHANHAI_DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
  let log='';server.stderr.on('data',data=>log+=data);
  try{
    const ready=await new Promise((resolve,reject)=>{
      require('node:readline').createInterface({input:server.stdout}).once('line',line=>resolve(JSON.parse(line)));
      server.once('error',reject);server.once('exit',code=>reject(Error(`Server ${code}: ${log}`)));
    });
    browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
    page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:2});
    page.setDefaultTimeout(120000);
    const errors=[],results=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${ready.port}`,{waitUntil:'networkidle'});
    await page.locator('#city-import-file').setInputFiles(path.join(root,'tests/fixtures/lighting-materials-city.json'));
    await page.waitForFunction(()=>CityApp.active&&!CityApp.working&&CityScene.assetsReady&&CityOrdinaryRoofs.ready&&CityStreetFurniture.assetsReady);
    const pan='.workspace-dock [data-tool="pan"]',select='.workspace-dock [data-tool="select"]';
    await page.locator(pan).click();
    await page.evaluate(()=>{CityScene.configure({quality:'high',renderer:'textures'});MapWorkspace.focus([2260,2395],72);});
    const frames=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const settle=async()=>{
      const ready=()=>{
        const materials=CityScene.stats.materialPreparation;
        return !MapWorkspace.panCacheStats.pending&&(!materials||!materials.pending&&!materials.active)&&!baseNeedsRefresh();
      };
      await page.waitForFunction(ready);await frames();await page.waitForFunction(ready);
    };
    await settle();
    assert(await page.evaluate(()=>CityApp.canCacheBase),'test must enter the actual texture renderer');
    // Record every paint, including intermediate frames before the menu settles.
    await page.evaluate(()=>{
      window.dockBasePaints=0;
      const paint=CityApp.paint;
      CityApp.paint=function(...args){if(args[2]!=='overlay')dockBasePaints++;return paint.apply(this,args);};
    });
    const stats=()=>page.evaluate(()=>({pan:{...MapWorkspace.panCacheStats},geometry:{...MapWorkspace.geometry},basePaints:dockBasePaints,tool:CityApp.tool}));
    const action=async(name,run,expectedTool)=>{
      const before=await stats();await run();await frames();await settle();const after=await stats();
      const delta=Object.fromEntries(['builds','fullPaints','refinements','zoomCopies'].map(key=>[key,after.pan[key]-before.pan[key]]));
      results.push({name,tool:after.tool,delta,basePaints:after.basePaints-before.basePaints});
      fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({results,errors},null,2));
      assert.equal(delta.fullPaints,0,`${name}: finished textures must not be replaced with a coarse base`);
      assert.equal(delta.builds,0,`${name}: a menu change must reuse the same viewport`);
      assert.equal(after.basePaints-before.basePaints,0,`${name}: menu thumbnails must not refresh the scene's materials`);
      assert.deepEqual(after.geometry,before.geometry,`${name}: menu changes must preserve the viewport`);
      if(expectedTool)assert.equal(after.tool,expectedTool,name);
    };
    const click=(name,selector,tool)=>action(name,()=>page.locator(selector).click(),tool);
    await page.screenshot({path:path.join(output,'before.png')});
    // First opening also exercises thumbnail initialization; a second circuit
    // covers restoration of the previous tools and their menu state.
    for(let round=1;round<=2;round++){
      await click(`select ${round}`,select,'select');
      await click(`pan ${round}`,pan,'pan');
      await click(`build ${round}`,'#workspace-build','street');
      assert(await page.locator('#workspace-build-menu').isVisible());
      await click(`blocks ${round}`,'#workspace-blocks','renewal');
      assert(await page.locator('#workspace-block-menu').isVisible());
      await click(`transit ${round}`,'.workspace-dock button:has-text("公交")');
      assert(await page.locator('#city-transit-panel').isVisible());
      await click(`observe ${round}`,'#workspace-observe','select');
      assert(await page.locator('#workspace-observe-menu').isVisible());
      await click(`close observe ${round}`,'#workspace-observe','select');
    }
    await click('open build','#workspace-build','street');
    await click('road card','#build-roads [data-build-kind="avenue"]','avenue');
    const direction=await page.locator('#city-oneway').isChecked();
    await click('toggle direction','#build-roads [data-build-kind="avenue"]','avenue');
    assert.notEqual(await page.locator('#city-oneway').isChecked(),direction);
    await action('road shape',()=>page.locator('#city-shape').selectOption('curve'));
    await action('road level',()=>page.locator('#city-level').selectOption('1'));
    await click('building tab','#build-tab-buildings','airport');
    await click('road tab','#build-tab-roads','avenue');
    await action('escape build',()=>page.keyboard.press('Escape'));
    assert(!await page.locator('#workspace-build-menu').isVisible());
    await click('open queries','#workspace-observe','select');
    await click('query tab','#observe-tab-queries');
    await click('query to pan',pan,'pan');
    await click('final select',select,'select');
    await page.screenshot({path:path.join(output,'after.png')});
    assert.deepEqual(errors,[],'menu switching must not cause renderer errors');
    console.log(JSON.stringify({actions:results.length,fullPaints:results.reduce((n,r)=>n+r.delta.fullPaints,0),
      builds:results.reduce((n,r)=>n+r.delta.builds,0),basePaints:results.reduce((n,r)=>n+r.basePaints,0),errors,output}));
  }catch(error){
    if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
    throw error;
  }finally{
    if(browser)await browser.close();server.kill();fs.rmSync(temp,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
