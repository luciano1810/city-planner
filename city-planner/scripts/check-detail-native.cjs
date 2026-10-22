// Verify the actual Electron file:// worker path using isolated city data.
const {_electron}=require('playwright'),path=require('node:path'),fs=require('node:fs'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output/playwright/interaction-final-native');fs.mkdirSync(out,{recursive:true});
(async()=>{let app;const temp=fs.mkdtempSync(path.join(os.tmpdir(),'city-native-detail-'));
 try{
  app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'electron/main.cjs')],env:{...process.env,SHANHAI_DATA_DIR:temp},timeout:60000});
  const page=await app.firstWindow();page.setDefaultTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>window.CityApp&&window.MapWorkspace);
  await page.locator('#city-import-file').setInputFiles(path.join(root,'tests/fixtures/lighting-materials-city.json'));
  await page.waitForFunction(()=>CityApp.active&&!CityApp.working&&CityScene.assetsReady);
  if((await page.locator('#city-play').textContent()).includes('暂停'))await page.locator('#city-play').click();
  await page.evaluate(()=>{CityScene.configure({quality:'high',renderer:'textures'});MapWorkspace.focus([2260,2395],72);});
  await page.waitForFunction(()=>!MapWorkspace.panCacheStats.pending&&!CityScene.stats.materialPreparation.pending&&CityScene.stats.materialPreparation.completed>0&&!baseNeedsRefresh());
  await page.evaluate(()=>new Promise(resolve=>{let stable=0;function frame(){const p=CityScene.stats.materialPreparation;if(!MapWorkspace.panCacheStats.pending&&!p.pending&&!p.active&&!baseNeedsRefresh())stable++;else stable=0;if(stable>=3)resolve();else requestAnimationFrame(frame);}requestAnimationFrame(frame);}));
  const result=await page.evaluate(()=>({url:location.href,quality:CityScene.effectiveQuality,materials:CityScene.stats.materialPreparation,pan:MapWorkspace.panCacheStats}));
  assert(result.url.startsWith('file:'));assert.equal(result.quality,'high');assert.equal(result.materials.errors,0);assert(result.materials.completed>0);assert(result.materials.bytes<=result.materials.budget);assert.equal(result.pan.pending,0);assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(out,'native-detail.png')});fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({...result,errors},null,2));console.log(JSON.stringify({...result,errors}));
 }finally{await app?.close();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
