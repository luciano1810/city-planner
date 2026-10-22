// Dated construction acceptance: real saved states, both scene renderers and HUD.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'city-construction-'));
const output=path.join(root,'output/playwright/construction-dates');fs.mkdirSync(output,{recursive:true});
const fixture=spawnSync(path.join(root,'.venv/bin/python'),['-c',`
import json,sys
from pathlib import Path
from tests.test_weekly_calendar import WeeklyCalendarTests
from city.simulation import advance_calendar,DAY
from city.construction import day
case=WeeklyCalendarTests();city=case.city()
for i,p in enumerate(city.s['parcels'][:3]):
 b=case.building(city,p,2+i,12+i);b.update(floors=6,height=19.8,floorArea=1200)
city.rebuild()
center=city.s['parcels'][1]['center']
for name,target in [('planned',0),('foundation',2),('structure',7),('complete',16)]:
 if target>day(city):advance_calendar(city,(target-day(city))*DAY)
 city.summarize()
 Path(sys.argv[1],name+'.json').write_text(json.dumps(city.snapshot()))
print(json.dumps(center))
`,temp],{cwd:root,env:{...process.env,PYTHONPATH:'backend'},encoding:'utf8'});
assert.equal(fixture.status,0,fixture.stderr);const center=JSON.parse(fixture.stdout);
(async()=>{
 let browser;const server=spawn(path.join(root,'.venv/bin/python'),['backend/server.py','--preview','--port','0'],{cwd:root,env:{...process.env,SHANHAI_DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
 let log='';server.stderr.on('data',d=>log+=d);
 try{
  const ready=await new Promise((resolve,reject)=>{require('node:readline').createInterface({input:server.stdout}).once('line',l=>resolve(JSON.parse(l)));server.once('error',reject);server.once('exit',c=>reject(Error(c+': '+log)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({bypassCSP:true,viewport:{width:1400,height:1000}});page.setDefaultTimeout(60000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${ready.port}`,{waitUntil:'networkidle'});
  const results=[];
  for(const stage of ['planned','foundation','structure','complete']){
   await page.locator('#city-import-file').setInputFiles(path.join(temp,stage+'.json'));
   await page.waitForFunction(()=>CityApp.active&&!CityApp.working&&CityScene.assetsReady);
   const state=await page.evaluate(()=>({buildings:CityApp.state.parcels.filter(p=>p.building).map(p=>({status:p.building.status,progress:p.building.constructionProgress})),weeks:CityApp.state.weeklyHistory.length}));
   if(stage==='planned')assert(state.buildings.every(b=>b.status==='planned'));
   if(stage==='structure')assert(state.buildings.every(b=>b.status==='construction'&&b.progress>0&&b.progress<1));
   if(stage==='complete')assert(state.buildings.every(b=>b.status==='active'&&b.progress===1));
   for(const renderer of ['textures','webgl']){
    await page.evaluate(({center,renderer})=>{
     CityScene.configure({quality:'high',renderer});
     const t=MapWorkspace.terrain,c=document.getElementById('map'),fit=Math.max(c.clientWidth/t.width,c.clientHeight/t.height),world=fit*Math.min(t.width/t.grid.widthMeters,t.height/t.grid.heightMeters);
     MapWorkspace.focus(center,Math.max(CityScene.detailZoom,5/world));MapWorkspace.draw();
    },{center,renderer});
    await page.screenshot({path:path.join(output,`${stage}-${renderer}.png`)});
   }
   results.push({stage,...state});
  }
  await page.locator('#city-history').evaluate(el=>el.click());
  assert((await page.locator('#city-dialog').textContent()).includes('每周结算'));
  await page.locator('#city-dialog-close').click();
  const csvReady=page.waitForEvent('download');await page.locator('#city-csv').evaluate(el=>el.click());
  const csv=fs.readFileSync(await (await csvReady).path(),'utf8');
  assert(csv.includes('周结算日期'));assert(csv.includes('2026-01-08'));assert(csv.includes('2026-01-15'));
  const summaryReady=page.waitForEvent('download');await page.locator('#city-summary').evaluate(el=>el.click());
  const summary=JSON.parse(fs.readFileSync(await (await summaryReady).path(),'utf8'));
  assert.equal(summary.weeklyHistory.length,2);assert.equal(summary.date,'2026-01-17');
  assert.deepEqual(errors,[]);
  const labels=await page.locator('#ck-treasury-sub').textContent();assert(labels.includes('周收入'));
  const report={results,errors};fs.writeFileSync(path.join(output,'acceptance.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser?.close();server.kill();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
