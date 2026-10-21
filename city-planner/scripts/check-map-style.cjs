// Optional browser regression: requires Playwright and the Python requirements.
// Run from the app root: node scripts/check-map-style.cjs
const {chromium}=require('playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const path=require('node:path');
const repo=path.resolve(__dirname,'../..'),app=path.join(repo,'city-planner');
const capturePrefix=process.env.MAP_CAPTURE_PREFIX||'map-style';
const python=process.env.MAP_PYTHON||(fs.existsSync(path.join(app,'.venv/bin/python'))?path.join(app,'.venv/bin/python'):'python3');
(async()=>{
 const {spawn}=require('node:child_process'),readline=require('node:readline');
 const backend=spawn(python,['backend/server.py','--preview','--port','0'],{cwd:repo+'/city-planner',env:{...process.env,SHANHAI_DATA_DIR:fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'map-style-'))},stdio:['ignore','pipe','pipe']});
 backend.stderr.on('data',()=>{});
 backend.once('error',error=>{throw error;});
 const ready=await new Promise((resolve,reject)=>{readline.createInterface({input:backend.stdout}).once('line',line=>resolve(JSON.parse(line)));backend.once('exit',code=>reject(new Error('Backend '+code)));});
 let browser;
 try{
 browser=await chromium.launch({headless:true,...(process.env.MAP_CHROMIUM?{executablePath:process.env.MAP_CHROMIUM}:{}),
   args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});page.setDefaultTimeout(45000);
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+ready.port,{waitUntil:'networkidle'});
  const snapshot=JSON.parse(fs.readFileSync(process.env.MAP_FIXTURE||repo+'/docs/experiments/lighting-materials-city.json'));
  Object.assign(snapshot.state.settings,{growth:0,autoGrow:false,autoRenew:false});
  const loaded=page.waitForResponse(r=>r.url().endsWith('/api/city/import'));
  await page.locator('#city-import-file').setInputFiles({name:'view-test.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(snapshot))});
  const initial=(await(await loaded).json()).city;
  for(const o of [...initial.roads,...initial.facilities,...initial.districts,...initial.parcels.filter(p=>p.building).map(p=>p.building)])assert(o.name?.length,'Every visible place has a persisted name');
  await page.waitForFunction(()=>CityApp.active&&!CityApp.working&&CityScene.assetsReady);
  await page.getByRole('button',{name:'观察',exact:true}).click();
  await page.evaluate(()=>document.body.classList.remove('show-inspector'));
  await page.locator('.map-view-switch [data-view="map"]').click();
  await page.locator('#fullscreen').click();
  await page.waitForFunction(()=>document.fullscreenElement);
  if(process.env.MAP_FIXTURE)await page.evaluate(()=>window.styleCenter=[2800,2700]);
  const evidence=[];
  await page.evaluate(()=>{const original=CityMapRenderer.paintLabels;CityMapRenderer.paintLabels=function(...args){const result=original(...args);window.mapLabelEvidence=result;return result;};});
  for(const [name,value] of (process.env.MAP_FIXTURE? [['city',.4],['city-close',.75]]:[['neighborhood',1.8],['overview',.95],['detail',2.5]])){
    await page.evaluate(value=>{const t=MapWorkspace.terrain,c=document.getElementById('map');MapWorkspace.focus(window.styleCenter||[2260,2395],value/(Math.min(c.clientWidth/t.width,c.clientHeight/t.height)*t.width/t.grid.widthMeters));},value);
  await page.screenshot({path:repo+'/docs/images/'+capturePrefix+'-'+name+'.png'});
    const labels=await page.evaluate(()=>window.mapLabelEvidence);
    for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){const a=labels[i].box,b=labels[j].box;assert(!(a[0]<b[2]&&a[2]>b[0]&&a[1]<b[3]&&a[3]>b[1]),'Label collision');}
    evidence.push({name,labels});
  }
  const icon=await page.evaluate(()=>window.mapLabelEvidence.find(l=>l.kind==='building')||window.mapLabelEvidence.find(l=>l.kind==='poi'));
  if(icon){const p=await page.evaluate(box=>{const g=MapWorkspace.geometry;return [g.left+(box[0]+box[2])/2,g.top+(box[1]+box[3])/2];},icon.box);await page.mouse.click(...p);await page.waitForFunction(()=>document.body.classList.contains('show-inspector'));assert((await page.locator('#city-inspector h2').textContent()).includes(icon.text));}
  const center=()=>page.evaluate(()=>{const g=MapWorkspace.geometry;return MapWorkspace.toWorld(g.width/2,g.height/2);});
  const beforeResize=await center();
  await page.evaluate(()=>document.exitFullscreen());
  await page.setViewportSize({width:1024,height:768});
  await page.waitForFunction(()=>MapWorkspace.geometry.width<1024);
  await page.evaluate(()=>MapWorkspace.draw());
  const afterResize=await center();assert(Math.hypot(afterResize[0]-beforeResize[0],afterResize[1]-beforeResize[1])<1,'Resize must retain the map centre');
  assert((await page.evaluate(()=>window.mapLabelEvidence)).length>0,'Resized map must retain content');
  await page.screenshot({path:repo+'/docs/images/'+capturePrefix+'-'+(process.env.MAP_FIXTURE?'city-':'')+'compact.png'});
  fs.writeFileSync(repo+'/docs/experiments/'+capturePrefix+'-'+(process.env.MAP_FIXTURE?'city-':'')+'evidence.json',JSON.stringify({errors,resizePreservesCenter:true,poiSelection:true,evidence},null,2));
  assert.deepEqual(errors,[]);console.log(JSON.stringify(evidence.map(x=>({name:x.name,labels:x.labels.length,roads:x.labels.filter(l=>l.kind==='road').length,pois:x.labels.filter(l=>l.kind==='poi').length}))));
 }finally{await browser?.close();backend.kill();}
})().catch(e=>{console.error(e);process.exit(1)});
