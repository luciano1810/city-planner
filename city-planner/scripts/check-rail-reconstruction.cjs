// Real Chromium + the local Python engine; no player saves or sessions are touched.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output/playwright/rail-reconstruction');fs.mkdirSync(out,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'shanhai-rail-')),python=path.join(root,'.venv/bin/python');
const fixture=spawnSync(python,['-c',`import json
from tests.test_city import City,flat_world,road
c=City(flat_world(),'铁路界面验收')
c.s['settings'].update(autoGrow=False,autoRenew=False,growth=0,migration=0)
road(c,[(200,1000),(3800,1000)])
print(json.dumps(c.snapshot()))`],{cwd:root,encoding:'utf8'});
assert.equal(fixture.status,0,fixture.stderr);fs.writeFileSync(path.join(temp,'fixture.json'),fixture.stdout);
const report={passed:false,checks:[],screenshots:[],conditions:'4 km 平坦地图，既有人行道路；隔离会话。由真实菜单、表单、地图鼠标与键盘操作建设。'},errors=[];
let browser,page,server;
(async()=>{try{
 server=spawn(python,['backend/server.py','--preview','--port','0'],{cwd:root,env:{...process.env,SHANHAI_DATA_DIR:temp},stdio:['ignore','pipe','pipe']});let stderr='';server.stderr.on('data',s=>stderr+=s);
 const ready=await new Promise((resolve,reject)=>{require('node:readline').createInterface({input:server.stdout}).once('line',s=>resolve(JSON.parse(s)));server.once('error',reject);server.once('exit',code=>reject(new Error(stderr||String(code))));});
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.stack));
 await page.goto(`http://127.0.0.1:${ready.port}`,{waitUntil:'networkidle'});
 await page.locator('#city-import-file').setInputFiles(path.join(temp,'fixture.json'));
 const wait=()=>page.waitForFunction(()=>window.CityApp?.active&&!CityApp.working),click=s=>page.locator(s).click();await wait();
 async function menu(){if(!await page.locator('#workspace-transit-menu').isVisible())await click('#workspace-transit');await click('#transit-tab-rail');}
 async function hide(){if(await page.locator('#workspace-transit-menu').isVisible())await click('#workspace-transit');}
 async function point(p,doClick=true){await page.evaluate(p=>MapWorkspace.focus(p,12),p);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const q=await page.evaluate(p=>{const g=MapWorkspace.geometry,r=document.getElementById('map').getBoundingClientRect(),t=MapWorkspace.terrain;return{x:r.x+g.left+p[0]*t.width*g.scale/CityApp.state.meta.width,y:r.y+g.top+p[1]*t.height*g.scale/CityApp.state.meta.height};},p);assert.equal(await page.evaluate(q=>document.elementFromPoint(q.x,q.y)?.id,q),'map');await page.mouse.move(q.x,q.y);if(doClick)await page.mouse.click(q.x,q.y);}
 async function shot(name){await page.screenshot({path:path.join(out,name+'.png')});report.screenshots.push(name+'.png');}
 const pass=name=>{report.checks.push(name);console.log('PASS '+name);};
 await menu();assert.equal(await page.locator('#transit-rail .build-card:disabled').count(),0);assert.equal(await page.locator('#transit-bus .build-card').count(),3);await shot('01-unified-menu');pass('统一铁路菜单与三个公交分类');
 for(const [i,x,level,kind] of [[0,500,-1,'metro_station'],[1,3500,-1,'train_station'],[2,1500,0,'metro_station'],[3,2500,1,'metro_station']]){
   await menu();await click(`[data-transit-action="${kind}"]`);await page.locator('#rail-name').fill(['海西地铁站','海东火车站','地面站','高架站'][i]);await page.locator('#rail-level').selectOption(String(level));await page.locator('#rail-count').fill('2');await hide();await point([x,950],false);
   await page.waitForFunction(()=>document.getElementById('rail-hint').textContent.includes('总建设费'));await shot(`02-station-preview-${i}`);await point([x,950]);await wait();await page.waitForFunction(n=>CityApp.state.stops.length===n,i+1);
 }
 let stations=await page.evaluate(()=>CityApp.state.stops);assert(stations.every(s=>s.platforms.length===2&&s.status==='待连接'));pass('地铁三层车站、火车站、站台数量与未接轨状态');
 await menu();await click('[data-transit-action="train_track"]');await page.locator('#rail-city-level').selectOption('-1');await page.locator('#rail-city-shape').selectOption('polyline');await hide();
 for(const p of [stations[0].platforms[0].ports[1],stations[1].platforms[0].ports[0]])await point(p);
 await page.keyboard.press('Enter');await wait();await page.waitForFunction(()=>CityApp.state.stops[0].platforms[0].connected);pass('轨道吸附具体站台端口，其他站台保持待连接');
 for(const s of stations.slice(0,2)){await menu();await click('[data-transit-action="rail_turnback"]');await page.locator('#rail-facility-platform').selectOption(s.platforms[0].id);await click('#rail-facility-build');await page.waitForFunction(()=>document.getElementById('rail-hint').textContent.includes('再次点击'));await click('#rail-facility-build');await wait();}
 await menu();await click('[data-transit-action="rail_line"]');await page.locator('#rail-name').fill('海西—海东直通线');
 for(const s of stations.slice(0,2)){await page.locator('#rail-select-station').selectOption(s.id);await page.locator('#rail-select-platform').selectOption(s.platforms[0].id);await click('#rail-add-stop');}
 await page.waitForFunction(()=>document.getElementById('rail-hint').textContent.includes('完整运行周期'));await shot('03-line-platform-draft');await hide();await page.locator('#map').focus();await page.keyboard.press('Backspace');assert.equal(await page.locator('#rail-route li').count(),1);
 await point(stations[1].platforms[0].point);await page.keyboard.press('Enter');await wait();await page.waitForFunction(()=>CityApp.state.lines.length===1);assert.equal(await page.evaluate(()=>CityApp.state.lines[0].serviceType),'through');pass('站台选点、Backspace 撤回、Enter 创建地铁火车直通线');
 await menu();await click('[data-transit-action="rail_manage"]');await page.locator('#rm-lines button').first().click();await page.waitForSelector('#rm-form');
 await page.locator('#rm-form [name="name"]').fill('未保存草稿');await click('#rm-refresh');await page.waitForFunction(()=>document.getElementById('rail-management').getAttribute('aria-busy')!=='true');await page.waitForSelector('#rm-form');assert.equal(await page.locator('#rm-form [name="name"]').inputValue(),'未保存草稿');
 await page.locator('#rm-form [name="formation"]').fill('8');await click('#rm-save');await wait();await page.waitForFunction(()=>document.getElementById('rm-message').textContent.includes('短于列车'));assert.equal(await page.locator('#rm-form [name="formation"]').inputValue(),'8');assert.equal(await page.evaluate(()=>CityApp.state.lines[0].formation),4);pass('刷新保留草稿；站台过短时拒绝配置且不部分保存');
 await page.locator('#rm-form [name="name"]').fill('午夜直通线');await page.locator('#rm-form [name="formation"]').fill('5');await page.locator('#rm-form [name="startTime"]').fill('23:30');await page.locator('#rm-form [name="endTime"]').fill('01:30');assert.match(await page.locator('#rm-time-note').textContent(),/次日结束/);await page.locator('#rm-form [name="fleetMode"]').selectOption('manual');assert.equal(await page.locator('#rm-form [name="headway"]').isVisible(),false);await page.locator('#rm-form [name="assignedFleet"]').fill('2');await click('#rm-save');await wait();await page.waitForFunction(()=>document.getElementById('rm-message').textContent.includes('设置已保存'));await shot('04-unified-management');assert.deepEqual(await page.evaluate(()=>{const l=CityApp.state.lines[0];return [l.startHour,l.hours,l.assignedFleet];}),[23.5,2,2]);pass('简洁设置：手动配车、时间选择器及跨午夜时段正确保存');
 assert.equal(await page.locator('#rm-advanced').getAttribute('open'),null);await page.locator('#rm-form [name="fleetMode"]').selectOption('auto');assert.equal(await page.locator('#rm-form [name="assignedFleet"]').isVisible(),false);await page.locator('#rm-form [name="headway"]').fill('12');await page.locator('#rm-form [name="allDay"]').check();assert(await page.locator('#rm-form [name="startTime"]').isDisabled());await click('#rm-save');await wait();await page.waitForFunction(()=>document.getElementById('rm-message').textContent.includes('设置已保存'));assert.deepEqual(await page.evaluate(()=>{const l=CityApp.state.lines[0];return [l.headway,l.hours,l.assignedFleet];}),[12,24,null]);
 await page.locator('#rm-form [name="allDay"]').uncheck();await page.locator('#rm-form [name="startTime"]').fill('23:30');await page.locator('#rm-form [name="endTime"]').fill('01:30');await page.locator('#rm-form [name="fleetMode"]').selectOption('manual');await page.locator('#rm-form [name="assignedFleet"]').fill('2');await click('#rm-save');await wait();await page.waitForFunction(()=>document.getElementById('rm-message').textContent.includes('设置已保存'));pass('自动配车与全天运营切换，隐藏输入不干扰保存');
 await page.setViewportSize({width:430,height:900});await shot('04b-narrow-management');assert(await page.evaluate(()=>document.getElementById('rail-management').scrollWidth<=document.getElementById('rail-management').clientWidth));await page.setViewportSize({width:1600,height:1000});
 await click('#rm-stations');await page.locator(`[data-rm-station="${stations[0].id}"]`).click();await page.waitForSelector('#rs-form');await page.locator('#rs-count').fill('3');await click('#rs-preview');await page.waitForFunction(()=>document.getElementById('rm-message').textContent.includes('扩建费用'));await click('#rs-save');await wait();await page.waitForFunction(()=>CityApp.state.stops[0].platforms.length===3);assert.equal(await page.evaluate(()=>CityApp.state.stops[0].platforms[0].id),stations[0].platforms[0].id);await shot('05-platform-expansion');pass('建后编辑站台数量，保留既有站台身份和线路');
 await page.locator('[data-entry-toggle]').first().click();await wait();await page.waitForFunction(()=>CityApp.state.stops[0].accessible===false);await page.waitForSelector('#rs-form');await page.locator('[data-entry-toggle]').first().click();await wait();await page.waitForFunction(()=>CityApp.state.stops[0].accessible===true);pass('关闭及恢复入口，接入状态实时更新');
 await page.setViewportSize({width:430,height:900});await shot('06-narrow-station-editor');assert(await page.locator('#rs-save').isVisible());assert(await page.evaluate(()=>document.getElementById('rail-management').getBoundingClientRect().width<=innerWidth));await click('#rm-close');await menu();await shot('07-narrow-menu');pass('430 像素窄屏菜单和车站编辑可用');
 assert.deepEqual(errors,[]);report.passed=true;
 }catch(error){report.error=error.stack;if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}
 finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));if(browser)await browser.close();if(server)server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
