const {chromium}=require('playwright'),fs=require('fs'),assert=require('assert/strict');
const path=require('path'),os=require('os'),cp=require('child_process');
const app=path.resolve(__dirname,'..'),python=process.env.PYTHON||'python3',temp=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-qa-'));
const env={...process.env,PYTHONPATH:[path.join(app,'backend'),process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),SHANHAI_DATA_DIR:path.join(temp,'saves')};
fs.mkdirSync(path.join(app,'../images'),{recursive:true});fs.mkdirSync(path.join(app,'../experiments'),{recursive:true});
const fixtureCode=`import json,sys
from city.engine import City
from tests.test_city import flat_world
for name in ('bridge-to-ground','ground-to-bridge','both-ends','overpass'):
 c=City(flat_world())
 level=1 if name=='ground-to-bridge' else 0
 c.command(dict(type='road',kind='street',level=level,points=[[1900,2000],[2100 if level else 2300,2000]],snap=False))
 if name=='both-ends':c.command(dict(type='road',points=[[1900,2200],[2300,2200]],snap=False))
 if name=='overpass':
  c.command(dict(type='road',level=1,points=[[2100,1850],[2100,2200]],snap=False,connections=[]))
  c.command(dict(type='road',level=0,points=[[2300,2000],[2400,2050]],snap=False))
  c.command(dict(type='road',level=1,points=[[2100,2200],[2200,2250]],snap=False))
 with open(sys.argv[1]+'/'+name+'.json','w') as f:json.dump(c.snapshot(),f)
`;
cp.execFileSync(python,['-c',fixtureCode,temp],{cwd:app,env});
(async()=>{
 const server=require('child_process').spawn(python,['backend/server.py','--preview','--port','0'],{cwd:app,env,stdio:['ignore','pipe','pipe']});
 let browser;
 try{
 const ready=await new Promise((resolve,reject)=>{require('readline').createInterface({input:server.stdout}).once('line',s=>resolve(JSON.parse(s)));server.once('exit',reject)});
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--disable-gpu-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],env:process.env});
 const evidence=[];
 for(const scenario of [{name:'straight-t',fixture:'bridge-to-ground',level:'1',points:[[2100,2200]]},{name:'straight-end',fixture:'ground-to-bridge',level:'0',points:[[2300,2000]]},{name:'curve-bridge',fixture:'bridge-to-ground',level:'1',points:[[2170,2030],[2180,2160]]},{name:'curve-ground',fixture:'ground-to-bridge',level:'0',points:[[2170,2030],[2180,2160]]},{name:'wide-curve',fixture:'bridge-to-ground',kind:'avenue',level:'1',points:[[2170,2030],[2180,2160]]},{name:'both-ends',fixture:'both-ends',level:'1',points:[[2170,2100],[2100,2200]],contacts:2},{name:'overpass',fixture:'overpass',prebuilt:true}]){
 if(process.env.BRIDGE_SCENARIOS&&!process.env.BRIDGE_SCENARIOS.split(',').includes(scenario.name))continue;
 const page=await browser.newPage({viewport:{width:1500,height:950}});page.setDefaultTimeout(30000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+ready.port,{waitUntil:'networkidle'});
 const imported=page.waitForResponse(r=>r.url().endsWith('/api/city/import'));
 await page.locator('#city-import-file').setInputFiles(path.join(temp,scenario.fixture+'.json'));
 await page.waitForFunction(()=>CityApp.active&&!CityApp.working&&CityScene.assetsReady);
 let result;
 if(!scenario.prebuilt){
 await page.locator('[data-tool="'+(scenario.kind||'street')+'"]').click();await page.locator('#city-shape').selectOption(scenario.points.length>1?'curve':'polyline');await page.locator('#city-level').selectOption(scenario.level);
 await page.evaluate(()=>MapWorkspace.focus([2100,2050],10));
 async function screen(p){return page.evaluate(p=>{const g=MapWorkspace.geometry,t=MapWorkspace.terrain,r=document.getElementById('map').getBoundingClientRect();return [r.left+g.left+p[0]*t.width*g.scale/t.grid.widthMeters,r.top+g.top+p[1]*t.height*g.scale/t.grid.heightMeters]},p)}
 const start=await screen([2100,2000]);await page.mouse.move(start[0],start[1]+8);await page.mouse.click(start[0],start[1]+8);await page.locator('#road-connect-level').click();
 const previewWait=page.waitForResponse(r=>r.url().endsWith('/api/city/preview')&&r.request().postDataJSON()?.command?.points?.length===scenario.points.length+1);
 for(const p of scenario.points){await page.mouse.click(...await screen(p));if(await page.locator('#road-connect-level').isVisible())await page.locator('#road-connect-level').click();}
 const preview=await(await previewWait).json();assert.equal(preview.valid,true);assert.equal(preview.connections,scenario.contacts||1);
 const commit=page.waitForResponse(r=>r.url().endsWith('/api/city/command'));await page.locator('#city-finish').click();result=await(await commit).json();
 assert.equal(result.roads.length,scenario.contacts===2?3:2);assert.equal(result.roads.at(-1).connections.length,scenario.contacts||1);
 const nodes=id=>new Set(result.network.edges.filter(e=>e.road===id).flatMap(e=>[e.a,e.b]));const first=nodes(result.roads[0].id),last=nodes(result.roads.at(-1).id);
 assert([...first].some(n=>last.has(n)));
 for(const contact of result.roads.at(-1).connections)assert([...nodes(contact.road)].some(n=>last.has(n)));
 }else{
   result=(await(await imported).json()).city;
   assert.equal(result.roads.length,4);
   const lower=new Set(result.network.edges.filter(e=>e.level===0).flatMap(e=>[e.a,e.b]));
   assert(result.network.edges.filter(e=>e.level===1).every(e=>!lower.has(e.a)&&!lower.has(e.b)));
 }

 await page.locator('[data-tool="select"]').click();await page.locator('[data-panel="transit"]').click();await page.locator('#signal-demand').selectOption('test');
 await page.locator('#city-speed').focus();await page.locator('#city-speed').press('Home');for(let i=0;i<5;i++)await page.locator('#city-speed').press('ArrowRight');
 await page.evaluate(()=>{window.crossings=[];const last=new Map();window.traceTimer=setInterval(()=>{for(const v of CityApp.traffic?.vehicles||[]){if(last.has(v.id)&&last.get(v.id)!==v.level)crossings.push({id:v.id,from:last.get(v.id),to:v.level});last.set(v.id,v.level)}},30)});
 await page.locator('#city-play').click();
 if(scenario.prebuilt)await page.waitForFunction(()=>CityApp.traffic.seconds>20);
 else await page.waitForFunction(()=>crossings.some(c=>c.from===0&&c.to===1)&&crossings.some(c=>c.from===1&&c.to===0),null,{timeout:45000});
 await page.locator('#city-play').click();await page.waitForFunction(()=>!CityApp.working);
 const runtime=await page.evaluate(()=>({crossings,webgl:CityScene3D.available,stats:CityScene3D.stats,vehicles:CityApp.traffic.vehicles.length}));
 if(scenario.prebuilt)assert.equal(runtime.crossings.length,0);
 assert(runtime.vehicles>0);
 assert(runtime.webgl);assert.equal(runtime.stats.failure,null);assert.deepEqual(errors,[]);
 await page.evaluate(()=>{const el=document.getElementById('signal-hud');if(el)el.style.display='none'});
 await page.evaluate(()=>MapWorkspace.focus([2110,2025],24));await page.locator('#map').screenshot({path:app+'/../images/junction-fixed-'+scenario.name+'.png'});

 const layout=await page.evaluate(s=>{const p=RoadRenderer.connections(s.roads,s.network,s.meta.roadTypes);return {joins:p.joins.length,ramps:p.ramps.size};},result);
 assert.equal(layout.joins,scenario.prebuilt?0:scenario.contacts||1);
 await page.locator('.map-view-switch [data-view="map"]').click();await page.locator('#map').screenshot({path:app+'/../images/junction-fixed-'+scenario.name+'-map.png'});
 if(scenario.name==='straight-t'){
   await page.locator('.map-view-switch [data-view="high"]').click();
   await page.evaluate(()=>{const el=document.getElementById('city-time-of-day');el.value=1260;el.dispatchEvent(new Event('input'));});
   await page.locator('#map').screenshot({path:app+'/../images/junction-fixed-night.png'});
 }
 evidence.push({layout,scenario:scenario.name,connections:result.roads.at(-1).connections,points:result.roads.at(-1).points,junctions:result.network.junctions,...runtime,errors});await page.close();
 console.log('passed: '+scenario.name);
 fs.writeFileSync(app+'/../experiments/junction-fixed-playwright.json',JSON.stringify(evidence,null,2));
 }
 fs.writeFileSync(app+'/../experiments/junction-fixed-playwright.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence.map(e=>({scenario:e.scenario,joins:e.layout.joins,crossings:e.crossings.length,webgl:e.webgl,errors:e.errors}))));
 }finally{if(browser)await browser.close();server.kill();fs.rmSync(temp,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
