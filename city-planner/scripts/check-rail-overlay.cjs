/* Full UI construction on a populated city; export that exact baseline for paired development. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output/playwright/rail-lifecycle'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'rail-lifecycle-'));
fs.mkdirSync(out,{recursive:true});const python=path.join(root,'.venv/bin/python');
const setup=spawnSync(python,['-c',`import json
from tests.test_growth_scenarios import separated_towns
c,ids=separated_towns()
print(json.dumps(dict(snapshot=c.snapshot(),ids=ids)))`],{cwd:root,encoding:'utf8'});assert.equal(setup.status,0,setup.stderr);
const fixture=JSON.parse(setup.stdout);fixture.snapshot=JSON.parse(fs.readFileSync(path.join(out,'ui-built-baseline.json'),'utf8'));fs.writeFileSync(path.join(temp,'fixture.json'),JSON.stringify(fixture.snapshot));
const report={passed:false,checks:[],screenshots:[],reference:'https://www.apple.com/maps/'};let server,browser,page;
(async()=>{try{
 server=spawn(python,['backend/server.py','--preview','--port','0'],{cwd:root,env:{...process.env,SHANHAI_DATA_DIR:temp},stdio:['ignore','pipe','pipe']});let stderr='';server.stderr.on('data',s=>stderr+=s);
 const ready=await new Promise((resolve,reject)=>{require('node:readline').createInterface({input:server.stdout}).once('line',s=>resolve(JSON.parse(s)));server.once('error',reject);server.once('exit',code=>reject(new Error(stderr||String(code))));});
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${ready.port}`,{waitUntil:'networkidle'});await page.locator('#city-import-file').setInputFiles(path.join(temp,'fixture.json'));
 const wait=()=>page.waitForFunction(()=>window.CityApp?.active&&!CityApp.working),click=s=>page.locator(s).click();await wait();
 const pass=s=>{report.checks.push(s);console.log('PASS '+s);};
 async function shot(name){await page.screenshot({path:path.join(out,name+'.png')});report.screenshots.push(name+'.png');}
 async function menu(){if(!await page.locator('#workspace-transit-menu').isVisible())await click('#workspace-transit');await click('#transit-tab-rail');}
 async function hide(){if(await page.locator('#workspace-transit-menu').isVisible())await click('#workspace-transit');}
 async function point(p){await page.evaluate(p=>MapWorkspace.focus(p,12),p);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const q=await page.evaluate(p=>{const g=MapWorkspace.geometry,r=document.getElementById('map').getBoundingClientRect(),t=MapWorkspace.terrain;return{x:r.x+g.left+p[0]*t.width*g.scale/CityApp.state.meta.width,y:r.y+g.top+p[1]*t.height*g.scale/CityApp.state.meta.height};},p);assert.equal(await page.evaluate(q=>document.elementFromPoint(q.x,q.y)?.id,q),'map');await page.mouse.click(q.x,q.y);}
 async function manage(id){await menu();await click('[data-transit-action="rail_manage"]');await page.locator(`[data-rm-line="${id}"]`).click();await page.waitForFunction(()=>!document.getElementById('rail-management').hasAttribute('aria-busy'));await page.waitForSelector('#rm-form');}
 async function save(){await click('#rm-save');await wait();await page.waitForFunction(()=>document.getElementById('rm-message').textContent.includes('设置已保存'));}
 async function route(){return page.evaluate(ids=>CityApp.railApi('route',{source:ids.home,target:ids.work,car:false}),fixture.ids);}

 const ids=await page.evaluate(()=>CityApp.state.lines.filter(l=>l.mode==='metro').map(l=>l.id));
 for(const id of ids){await manage(id);await page.locator('#rm-form [name="enabled"]').check();await save();await click('#rm-close');}
 await hide();await click('#workspace-observe');await page.locator('#city-render-quality').selectOption('map');await page.locator('#city-show-transit-lines').check();await click('#workspace-observe');
 await page.evaluate(()=>MapWorkspace.focus([1950,1200],1));
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 report.geometry=await page.evaluate(()=>{const s=CityApp.state,g=MapWorkspace.geometry,k=MapWorkspace.terrain.width*g.scale/s.meta.width;return {scale:k,lines:s.lines.map(l=>({name:l.name,color:l.color,valid:l.valid})),routes:CityTransitOverlay.layout(s,k).routes.map(r=>({name:r.line.name,source:r.source,points:r.points}))};});
 await shot('06-network-overview');await page.evaluate(()=>MapWorkspace.focus([650,1140],5));await shot('07-station-detail');
 assert(report.geometry.routes.some(r=>r.name.startsWith('A'))&&report.geometry.routes.some(r=>r.name.startsWith('B')));
 assert.deepEqual(errors,[]);report.passed=true;
 }catch(error){report.error=error.stack;throw error;}
 finally{fs.writeFileSync(path.join(out,'overlay-report.json'),JSON.stringify(report,null,2));await browser?.close();server?.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
