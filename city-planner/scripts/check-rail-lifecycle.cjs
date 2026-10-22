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
const fixture=JSON.parse(setup.stdout);fs.writeFileSync(path.join(temp,'fixture.json'),JSON.stringify(fixture.snapshot));
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
 const initial=await route();assert.equal(initial.route,null);report.initial={population:60,commute:initial.route};
 for(const [x,name] of [[650,'就业中心站'],[3250,'住宅新城站']]){
  await menu();await click('[data-transit-action="metro_station"]');await page.locator('#rail-name').fill(name);await page.locator('#rail-count').fill('2');await hide();await point([x,1140]);await wait();await page.waitForFunction(n=>CityApp.state.stops.some(s=>s.name===n),name);
 }
 const stations=await page.evaluate(()=>CityApp.state.stops.filter(s=>s.railStation));assert.equal(stations.length,2);pass('真实界面建设两座地下地铁站，每站两个独立站台');
 await menu();await click('[data-transit-action="train_track"]');await page.locator('#rail-city-level').selectOption('-1');await page.locator('#rail-city-shape').selectOption('polyline');await hide();
 await point(stations[0].platforms[0].ports[1]);await point(stations[1].platforms[0].ports[0]);await page.keyboard.press('Enter');await wait();
 for(const s of stations){await menu();await click('[data-transit-action="rail_turnback"]');await page.locator('#rail-facility-platform').selectOption(s.platforms[0].id);await click('#rail-facility-build');await page.waitForFunction(()=>document.getElementById('rail-hint').textContent.includes('再次点击'));await click('#rail-facility-build');await wait();}
 pass('按具体站台接轨，预览并建设两端折返设施');
 const ids=[];
 for(const [name,color] of [['A线 · 两城地铁','#d12b4b'],['B线 · 共线服务','#267ec7']]){
  await menu();await click('[data-transit-action="rail_line"]');await page.locator('#rail-name').fill(name);
  for(const s of stations){await page.locator('#rail-select-station').selectOption(s.id);await page.locator('#rail-select-platform').selectOption(s.platforms[0].id);await click('#rail-add-stop');}
  await page.waitForFunction(()=>document.getElementById('rail-hint').textContent.includes('完整运行周期'));await hide();await page.locator('#map').focus();await page.keyboard.press('Enter');await wait();await page.waitForFunction(n=>CityApp.state.lines.some(l=>l.name===n),name);
  const id=await page.evaluate(n=>CityApp.state.lines.find(l=>l.name===n).id,name);ids.push(id);await manage(id);await page.locator('#rm-form [name="color"]').fill(color);await page.locator('#rm-form [name="headway"]').fill('6');await save();await click('#rm-close');
 }
 pass('两条线路通过真实选择器和 Enter 创建并统一编辑');
 const access=await route();assert(access.route&&access.route.minutes<30);report.connectedCommute=access.route.minutes;
 await click('#workspace-observe');const overlay=page.locator('#city-show-transit-lines');assert(await overlay.isVisible());assert.match(await overlay.locator('..').textContent(),/地铁.*火车/);assert.equal(await overlay.isChecked(),false);
 await page.evaluate(()=>MapWorkspace.focus([1950,1200],1));
 async function strokes(){return page.evaluate(()=>{const canvas=document.createElement('canvas'),g=MapWorkspace.geometry;canvas.width=g.width;canvas.height=g.height;const ctx=canvas.getContext('2d'),stroke=ctx.stroke.bind(ctx);let count=0;ctx.stroke=(...args)=>{if(['#d12b4b','#267ec7'].includes(ctx.strokeStyle))count++;return stroke(...args);};CityApp.paint(ctx,g);return count;});}
 const cityBefore=await page.evaluate(()=>JSON.stringify(CityApp.state));assert.equal(await strokes(),0);await shot('01-routes-hidden');
 for(const quality of ['map','high']){await page.locator('#city-render-quality').selectOption(quality);await overlay.check();assert(await strokes()>0);await shot('02-routes-'+quality);await overlay.uncheck();assert.equal(await strokes(),0);}
 await overlay.check();assert.equal(await page.evaluate(()=>JSON.stringify(CityApp.state)),cityBefore);await page.locator('#city-render-quality').selectOption('map');await click('#workspace-observe');await shot('03-shared-lines-map');
 pass('观察菜单开关控制公交地铁火车；地图和精细视图真实绘制，不改变运营状态');
 await manage(ids[1]);await page.locator('#rm-form [name="enabled"]').uncheck();await save();await click('#rm-close');
 await manage(ids[0]);await page.locator('#rm-form [name="enabled"]').uncheck();await save();await click('#rm-close');
 assert.equal((await route()).route,null);
 const baseline=await page.evaluate(()=>CityApp.railApi('export'));const context={...fixture.ids,line:ids[0],stations:stations.map(s=>s.id)};
 fs.writeFileSync(path.join(out,'ui-built-baseline.json'),JSON.stringify(baseline));fs.writeFileSync(path.join(out,'ids.json'),JSON.stringify(context));
 await manage(ids[0]);await page.locator('#rm-form [name="enabled"]').check();await save();await click('#rm-close');assert((await route()).route.minutes<30);
 const start=await page.evaluate(()=>CityApp.state.simulation.monthSeconds);
 await page.locator('#city-speed').focus();await page.keyboard.press('Home');for(let i=0;i<9;i++)await page.keyboard.press('ArrowRight');await click('#city-play');
 await page.waitForFunction(start=>CityApp.state.simulation.monthSeconds>=start+86400,start,{timeout:180000});await click('#city-play');await wait();
 const snapshot=await page.evaluate(()=>CityApp.railApi('export'));fs.writeFileSync(path.join(out,'ui-after-operation.json'),JSON.stringify(snapshot));
 const runtime=snapshot.state.railRuntime,counts=runtime.totals.network;assert(counts.board>0);assert(counts.exit>0);
 const remaining=runtime.passengers.filter(p=>p.entered).reduce((n,p)=>n+p.people,0);assert.equal(counts.entry-counts.exit,remaining);
 report.operation={counts,remaining,simulation:snapshot.state.simulation,treasury:snapshot.state.treasury};pass('使用播放和速度控件推进超过一天，产生实际客流，乘客守恒且跨日结算');
 await manage(ids[0]);await page.locator('#rm-content>details').filter({has:page.locator('summary', {hasText:'运营数据'})}).first().locator('summary').first().click();
 await page.locator('.rail-actual-history>summary').click();await page.waitForSelector('[data-history-content] .rail-hours');await shot('04-actual-ridership');await click('#rm-close');
 await click('#workspace-observe');await page.setViewportSize({width:430,height:900});assert(await overlay.isVisible());await overlay.uncheck();await overlay.check();await shot('05-narrow-observe');pass('实际小时客流可查询，窄屏观察菜单开关可操作');
 assert.deepEqual(errors,[]);report.passed=true;
 }catch(error){report.error=error.stack;if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}
 finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser?.close();server?.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
