// Real Electron, isolated saves: native visibility must not control simulation.
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'shanhai-background-'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  let app;
  try{
    const env={...process.env,SHANHAI_DATA_DIR:temp};delete env.ELECTRON_RUN_AS_NODE;
    app=await _electron.launch({executablePath:require('electron'),args:['--no-sandbox',root],env,timeout:60000});
    const page=await app.firstWindow();page.setDefaultTimeout(60000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>window.CityApp);
    await page.locator('#city-import-file').setInputFiles(path.join(root,'tests/fixtures/lighting-materials-city.json'));
    await page.waitForFunction(()=>CityApp.active&&!CityApp.working);
    await page.evaluate(()=>MapWorkspace.setDisplayMode('map',{focus:false}));
    const throttled=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.backgroundThrottling);
    assert.equal(throttled,false);
    await page.evaluate(()=>{
      window.backgroundPaints=0;
      const clear=CanvasRenderingContext2D.prototype.clearRect;
      CanvasRenderingContext2D.prototype.clearRect=function(...args){
        if(['map','overview-map'].includes(this.canvas.id)&&!MapWorkspace.visible)window.backgroundPaints++;
        return clear.apply(this,args);
      };
      document.getElementById('city-play').click();
    });
    const elapsed=()=>page.evaluate(()=>CityApp.state.simulation.elapsedSeconds);
    const initial=await elapsed();
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    await page.waitForFunction(t=>CityApp.state.simulation.elapsedSeconds>t+.5,initial,{polling:100});
    const beforeHide=await elapsed();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());
    await page.waitForFunction(()=>!MapWorkspace.visible,null,{polling:100});
    await page.waitForFunction(t=>CityApp.state.simulation.elapsedSeconds>t+2,beforeHide,{polling:100});
    const hidden=await elapsed();
    assert.equal(await page.evaluate(()=>window.backgroundPaints),0);
    // Verify a complete daily settlement is committed while the window is hidden.
    const days=await page.evaluate(()=>CityApp.state.dailyHistory?.length||0);
    await page.evaluate(()=>{const speed=document.getElementById('city-speed');speed.value='9';speed.dispatchEvent(new Event('input'));});
    await page.waitForFunction(days=>(CityApp.state.dailyHistory?.length||0)>days,days,{polling:100});
    await page.evaluate(()=>document.getElementById('city-play').click());
    await delay(1200);const paused=await elapsed();await delay(600);
    assert.equal(await elapsed(),paused);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
    await page.waitForFunction(()=>MapWorkspace.visible&&document.getElementById('city-play').textContent==='开始模拟');
    assert((await page.locator('#city-date').textContent()).includes('已暂停'));
    assert.equal(await page.evaluate(()=>window.backgroundPaints),0);
    // Foreground DOM catches up to the latest daily city snapshot.
    assert.equal(await page.locator('#ck-pop').textContent(),await page.evaluate(()=>Number(CityApp.state.stats.population).toLocaleString('zh-CN',{maximumFractionDigits:0})));
    await page.evaluate(()=>{const speed=document.getElementById('city-speed');speed.value='0';speed.dispatchEvent(new Event('input'));});
    await page.evaluate(()=>document.getElementById('city-play').click());
    await page.waitForFunction(t=>CityApp.state.simulation.elapsedSeconds>t+.5,paused,{polling:100});
    // Browser previews use Page Visibility rather than the native IPC signal.
    const beforeTabHide=await elapsed();
    await page.evaluate(()=>{
      Object.defineProperty(document,'hidden',{configurable:true,value:true});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(t=>CityApp.state.simulation.elapsedSeconds>t+.5,beforeTabHide,{polling:100});
    assert.equal(await page.evaluate(()=>window.backgroundPaints),0);
    await page.evaluate(()=>{
      delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.locator('#city-play').textContent(),'暂停模拟');
    await page.evaluate(()=>document.getElementById('city-play').click());
    await delay(500);const resumed=await elapsed();
    assert(resumed-paused<10,'paused wall time must not be replayed');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({initial,beforeHide,hidden,paused,resumed,backgroundPaints:0,errors}));
  }finally{
    await app?.close();fs.rmSync(temp,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
