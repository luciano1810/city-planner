// Desktop acceptance: real Electron IPC, pointer/keyboard operations and disk saves.
// The seeded households make transit useful; all player cities remain untouched.
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const app=path.resolve(__dirname,'..');
const output=path.resolve(process.env.BUS_TEST_OUTPUT||path.join(app,'output/playwright/bus-lifecycle'));
fs.mkdirSync(output,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'shanhai-bus-lifecycle-'));
const report={passed:false,checks:[],metrics:{},screenshots:output};
const python=process.env.TERRAIN_PYTHON||path.join(app,'.venv/bin/python');
const fixture=spawnSync(python,['-c',`import json,math
from tests.test_city import City,flat_world,road
from tests.test_city_v3 import complete
from tests.test_growth_scenarios import family
c=City(flat_world(),'公交实测城市')
c.s['settings'].update(autoGrow=False,autoRenew=False,migration=0,growth=0)
a=road(c,[[300,1200],[900,1200]])
road(c,[[900,1200],[2900,1200]],kind='highway')
b=road(c,[[2900,1200],[3700,1200]])
for p in c.s['parcels']:p['use']='residential' if p['road']==a else 'office'
home=min((p for p in c.s['parcels'] if p['road']==a),key=lambda p:math.dist(p['center'],[650,1250]))
job=min((p for p in c.s['parcels'] if p['road']==b),key=lambda p:math.dist(p['center'],[3250,1250]))
complete(c,home,'residential',40);complete(c,job,'office',100)
c.s['households']=[family(c,home['id'],job['id']) for _ in range(20)]
c.rebuild();c.assign_traffic();c.summarize()
print(json.dumps(c.snapshot()))`],{cwd:app,encoding:'utf8'});
assert.equal(fixture.status,0,fixture.stderr);fs.writeFileSync(path.join(temp,'fixture.json'),fixture.stdout);
let desktop,page;
const errors=[];
async function launch(){
 const env={...process.env,SHANHAI_DATA_DIR:path.join(temp,'saves')};delete env.ELECTRON_RUN_AS_NODE;
 desktop=await _electron.launch({executablePath:require('electron'),args:[app,'--user-data-dir='+path.join(temp,'profile')],cwd:app,env,timeout:60000});
 page=await desktop.firstWindow();page.setDefaultTimeout(25000);
 page.on('pageerror',e=>errors.push(e.stack));
 await page.waitForFunction(()=>window.CityApp&&window.terrainAPI);
 await page.context().tracing.start({screenshots:true,snapshots:true});
}
const click=s=>page.locator(s).click();
const ready=()=>page.waitForFunction(()=>CityApp.active&&!CityApp.working);
const state=()=>page.evaluate(()=>CityApp.state);
const check=(name,metrics)=>{report.checks.push(name);if(metrics)Object.assign(report.metrics,metrics);console.log('PASS '+name);};
async function point(p,{clickPoint=true}={}){
 await page.evaluate(p=>MapWorkspace.focus(p,12),p);
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const screen=await page.evaluate(p=>{const g=MapWorkspace.geometry,r=document.getElementById('map').getBoundingClientRect(),t=MapWorkspace.terrain;return {x:r.x+g.left+p[0]*t.width*g.scale/CityApp.state.meta.width,y:r.y+g.top+p[1]*t.height*g.scale/CityApp.state.meta.height};},p);
 assert.equal(await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.id,screen),'map');
 await page.mouse.move(screen.x,screen.y);if(clickPoint)await page.mouse.click(screen.x,screen.y);
}
async function menu(open=true){if(await page.locator('#workspace-transit-menu').isVisible()!==open)await click('#workspace-transit');}
async function manage(){await menu();await click('[data-transit-action="manage"]');await click('#city-line-list [data-line]');await click('#tm-more');}
async function snap(){await page.screenshot({path:path.join(output,`${String(report.checks.length).padStart(2,'0')}.png`)});}
async function shortcut(key){await page.locator('#map').focus();await page.keyboard.press((process.platform==='darwin'?'Meta+':'Control+')+key);await ready();}
async function stopSimulation(){if(await page.locator('#city-play').innerText()==='暂停模拟')await click('#city-play');await page.waitForTimeout(350);await ready();}
(async()=>{
 try{
  await launch();await page.locator('#city-import-file').setInputFiles(path.join(temp,'fixture.json'));await ready();
  let s=await state();assert.equal(s.householdSample.length,20);assert.equal(s.stats.modeShare.public,0);
  const baseMoney=s.treasury;
  await menu();assert(await page.locator('[data-transit-action="line"]').isDisabled());
  check('新城市有 20 户通勤需求，未建总站时禁止创建线路');await snap();

  await click('[data-transit-action="depot"]');await menu(false);
  await point([420,1200],{clickPoint:false});
  await page.waitForFunction(()=>document.getElementById('city-special-hint').textContent.includes('冲突'));
  await point([420,1200]);await ready();s=await state();assert.equal(s.facilities.length,0);assert.equal(s.treasury,baseMoney);
  await point([420,1100],{clickPoint:false});await page.waitForFunction(()=>document.getElementById('city-special-hint').textContent.includes('可放置'));
  await point([420,1100]);await ready();s=await state();assert.equal(s.facilities.filter(f=>f.kind==='bus_depot'&&f.connected).length,1);
  const depot=s.facilities.find(f=>f.kind==='bus_depot');assert.equal(baseMoney-s.treasury,s.meta.specialBuildings.bus_depot.cost);
  check('道路上无法放置总站且不扣款；合法位置建造并接通道路',{depotCost:baseMoney-s.treasury});await snap();

  await menu();await click('[data-transit-action="line"]');await page.locator('#city-line-name').fill('通勤 1 路');await page.locator('#city-headway').fill('6');await menu(false);
  const routeMoney=(await state()).treasury;
  await point([650,1500]);assert.equal(await page.evaluate(()=>CityApp.busDraft.stops.length),0);
  await point([650.3,1208]);await page.keyboard.press('Enter');assert.equal((await state()).lines.length,0);
  await point([650.3,1208]);assert.equal(await page.evaluate(()=>CityApp.busDraft.stops.length),1);
  await point([840,1208]);await point([3250,1208]);await page.waitForFunction(()=>CityApp.busDraft.preview?.valid);
  assert.equal((await state()).stops.length,0);assert.equal((await state()).treasury,routeMoney);
  await page.keyboard.press('Backspace');assert.equal(await page.evaluate(()=>CityApp.busDraft.stops.length),2);
  await point([3250,1208]);await page.waitForFunction(()=>CityApp.busDraft.preview?.valid);
  check('任意路边位置吸附、远离道路拒绝、重复站拒绝、单站不能提交、Backspace 撤回、预览无扣费');await snap();
  await page.keyboard.press('Enter');await ready();await page.waitForFunction(()=>CityApp.state.lines.length===1);
  s=await state();assert.equal(s.stops.length,3);let line=s.lines[0];assert(line.valid);assert.equal(line.name,'通勤 1 路');assert.equal(line.headway,6);assert.equal(line.paths.length,4);
  assert.equal(routeMoney-s.treasury,3*25000);assert(line.boardings>0);assert(s.stats.modeShare.public>0);assert(s.householdSample.every(h=>!h.commuteFailed));
  assert(line.paths.filter(p=>p.direction===0).every(p=>p.points.every(q=>q[1]>1200)));
  assert(line.paths.filter(p=>p.direction===1).every(p=>p.points.every(q=>q[1]<1200)));
  check('Enter 原子创建三站线路，按点击顺序沿道路连接；居民实际采用公交通勤',{boardings:line.boardings,publicShare:s.stats.modeShare.public,commute:s.stats.commute,length:line.length,fleet:line.fleet,operatingCost:line.operatingCost});await snap();

  await manage();await page.locator('#edit-line-name').fill('两城通勤快线');await page.locator('#edit-headway').fill('4');await page.locator('#edit-capacity').fill('90');await page.locator('#edit-line-start').fill('5');await page.locator('#edit-line-hours').fill('19');await page.locator('#edit-line-speed').fill('40');await page.locator('#edit-line-dwell').fill('0.5');await click('#line-update');await ready();
  s=await state();line=s.lines[0];assert.equal(line.name,'两城通勤快线');assert.equal(line.headway,4);assert.equal(line.capacity,90);assert.equal(line.startHour,5);assert.equal(line.hours,19);assert.equal(line.speed,40);assert.equal(line.dwell,.5);
  await click('#line-toggle');await ready();s=await state();assert.equal(s.lines[0].enabled,false);assert.equal(s.lines[0].boardings,0);assert.equal(s.stats.modeShare.public,0);
  await click('#line-toggle');await ready();s=await state();assert(s.lines[0].valid);assert(s.lines[0].boardings>0);
  check('管理线路修改名称/班次/容量/时间/限速/停站；暂停后客流归零，恢复后重新通勤');await snap();

  const stopCount=s.stops.length,money=s.treasury,oldStops=s.lines[0].stops;
  await click('#line-reorder');await menu(false);
  await point([650.3,1208]);await point([3250,1208]);await page.waitForFunction(()=>CityApp.busDraft.preview?.valid);await page.keyboard.press('Enter');await ready();
  s=await state();assert.deepEqual(s.lines[0].stops,[oldStops[0],oldStops[2]]);assert.equal(s.lines.length,1);assert.equal(s.stops.length,stopCount);assert.equal(s.treasury,money);assert.equal(s.lines[0].headway,4);assert.equal(s.lines[0].startHour,5);assert.equal(s.lines[0].dwell,.5);
  check('重新选择停站顺序复用原站，保持线路身份与运营参数，不重复收费');

  await menu();await click('[data-transit-action="line"]');await menu(false);await point([720,1192]);assert.equal(await page.evaluate(()=>CityApp.busDraft.stops[0].side),-1);await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>CityApp.tool),'select');assert.equal((await state()).stops.length,stopCount);
  check('另一侧路边吸附方向正确；Escape 撤销草稿且不新增站点');
  await page.locator('#city-speed').evaluate(el=>{el.value='5';el.dispatchEvent(new Event('input',{bubbles:true}));});
  const elapsed=(await state()).simulation.elapsedSeconds;
  await click('#city-play');await page.waitForFunction(before=>CityApp.state.simulation.elapsedSeconds>before+180,elapsed);
  await page.waitForFunction(()=>CityApp.traffic?.vehicles.some(v=>v.mode==='bus'&&v.speed>2&&v.stopsServed>=1));await stopSimulation();
  s=await state();const traffic=await page.evaluate(()=>CityApp.traffic);
  assert(s.simulation.elapsedSeconds>elapsed+180);assert(s.lines[0].valid);assert(s.lines[0].boardings>0);
  report.metrics.liveTraffic={elapsed:s.simulation.elapsedSeconds,vehicles:traffic?.vehicles?.length||0,buses:traffic?.vehicles?.filter(v=>v.mode==='bus').length||0};
  assert(traffic.vehicles.some(v=>v.mode==='bus'&&v.line===s.lines[0].id&&v.speed>2));
  const pauseClock=s.simulation.elapsedSeconds;await page.waitForTimeout(500);assert.equal((await state()).simulation.elapsedSeconds,pauseClock);
  check('启动模拟后真实线路公交完成首站停靠并行驶；暂停后时间保持不动');
  await page.locator('#city-render-quality').evaluate(el=>{el.value='high';el.dispatchEvent(new Event('change',{bubbles:true}));});
  const bus=traffic.vehicles.find(v=>v.mode==='bus'&&v.speed>2);await point(bus.point,{clickPoint:false});await snap();

  // The merged calendar closes each operating day at midnight.
  await page.locator('#city-speed').evaluate(el=>{el.value='9';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await click('#city-play');await page.waitForFunction(()=>CityApp.state.operatingAccounts?.fares>0&&CityApp.state.operatingAccounts?.transitOperation>0,null,{timeout:60000});await stopSimulation();
  s=await state();assert(s.operatingAccounts.fares>0);assert(s.operatingAccounts.transitOperation>0);
  assert.equal(s.calendar.nextSettlementDay-s.calendar.lastSettlementDay,1);
  assert(s.dailyHistory.length>0);assert.equal(s.dailyHistory[0].day,1);
  assert(s.dailyHistory.every(row=>row.periodDays===1));
  assert.equal(new Set(s.dailyHistory.map(row=>row.day)).size,s.dailyHistory.length);
  check('每日午夜结算产生车票收入和运营费用，每天只有一条日结记录',{accounts:s.operatingAccounts,calendar:s.calendar,dailySettlement:{count:s.dailyHistory.length,first:s.dailyHistory[0].date,last:s.dailyHistory.at(-1).date}});
  const saved={lines:s.lines,stops:s.stops,facilities:s.facilities,elapsed:s.simulation.elapsedSeconds,treasury:s.treasury};
  await shortcut('s');await page.locator('#city-save-name').fill('公交全流程验收');await click('#file-save');await ready();await page.waitForFunction(()=>!document.getElementById('city-dialog').open);
  await page.context().tracing.stop({path:path.join(output,'before-restart.zip')});await desktop.close();desktop=null;
  await launch();await click('#menu-load');await page.locator('[data-save-index]').filter({hasText:'公交全流程验收'}).click();await ready();
  s=await state();assert.deepEqual(s.lines,saved.lines);assert.deepEqual(s.stops,saved.stops);assert.deepEqual(s.facilities,saved.facilities);assert.equal(s.simulation.elapsedSeconds,saved.elapsed);assert.equal(s.treasury,saved.treasury);
  check('保存后完全退出并重启 Electron，从磁盘恢复总站、站点、线路、参数、模拟进度和资金');await snap();

  await point(depot.point);await page.waitForFunction(id=>CityApp.selected===id,depot.id);await click('#city-delete-selected');await ready();s=await state();assert(!s.lines[0].valid);assert.match(s.lines[0].reason,/总站/);
  await shortcut('z');s=await state();assert(s.lines[0].valid);assert(s.facilities.some(f=>f.id===depot.id));
  check('拆除总站使线路停止服务；撤销恢复总站与线路');
  await manage();await click('#city-delete-selected');await ready();assert.equal((await state()).lines.length,0);assert.equal((await state()).stats.modeShare.public,0);
  await shortcut('z');assert((await state()).lines[0].valid);await shortcut('Shift+z');assert.equal((await state()).lines.length,0);await shortcut('z');assert((await state()).lines[0].valid);
  check('删除线路后服务与客流消失；撤销、重做和再次撤销都正确');
  await menu();await click('#transit-tab-tram');assert.equal(await page.locator('#transit-tram .build-card:disabled').count(),3);await click('#transit-tab-rail');assert.equal(await page.locator('#transit-rail .build-card:disabled').count(),4);
  check('有轨电车、地铁/火车菜单缩略图齐全且占位操作不触发建造');await snap();
  assert.deepEqual(errors,[]);check('全程无渲染脚本异常');report.passed=true;fs.rmSync(path.join(output,'failure.png'),{force:true});
 }catch(error){report.error=error.stack;report.consoleErrors=errors;if(page&&!page.isClosed()){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});report.status=await page.locator('#city-status').innerText().catch(()=>'');report.hint=await page.locator('#city-special-hint').innerText().catch(()=>'');report.simulation=await page.evaluate(()=>({clock:CityApp.state?.simulation,settlement:CityApp.state?.settlement})).catch(()=>null);}throw error;}
 finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));if(desktop){await page.context().tracing.stop({path:path.join(output,'trace.zip')}).catch(()=>{});await desktop.close();}fs.rmSync(temp,{recursive:true,force:true});}
 console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
