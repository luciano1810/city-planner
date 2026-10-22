// Real Electron acceptance for multi-line settings and assigned passenger demand.
// Test cities, application profile and saves are isolated from the player's data.
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const app=path.resolve(__dirname,'..'),output=path.join(app,'output/playwright/transit-management');
fs.mkdirSync(output,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'shanhai-transit-management-'));
const python=process.env.TERRAIN_PYTHON||path.join(app,'.venv/bin/python');
const fixture=spawnSync(python,['-c',`import json
from tests.test_transit_management import management_city
c,ids=management_city()
c.s['settings'].update(autoGrow=False,autoRenew=False,growth=0,migration=0)
c.s['pendingHousing']=0;c.s['migrationQueue']=[]
c.command(dict(type='line',name='夜班备用线',mode='bus',stops=c.s['lines'][0]['stops'],headway=12,capacity=70))
c.command(dict(type='line_update',id=c.s['lines'][1]['id'],enabled=False,vehicleType='standard'))
print(json.dumps(c.snapshot()))`],{cwd:app,encoding:'utf8'});
assert.equal(fixture.status,0,fixture.stderr);fs.writeFileSync(path.join(temp,'fixture.json'),fixture.stdout);
const report={passed:false,checks:[],metrics:{},screenshots:output},errors=[];
let desktop,page,first,second;
const click=s=>page.locator(s).click();
const ready=()=>page.waitForFunction(()=>CityApp.active&&!CityApp.working);
const lines=()=>page.evaluate(()=>CityApp.state.lines);
const current=async()=> (await lines()).find(l=>l.id===first);
const check=(name,metrics)=>{report.checks.push(name);if(metrics)Object.assign(report.metrics,metrics);console.log('PASS '+name);};
async function launch(){
 const env={...process.env,SHANHAI_DATA_DIR:path.join(temp,'saves')};delete env.ELECTRON_RUN_AS_NODE;
 desktop=await _electron.launch({executablePath:require('electron'),args:[app,'--user-data-dir='+path.join(temp,'profile')],cwd:app,env,timeout:60000});
 page=await desktop.firstWindow();page.setDefaultTimeout(20000);
 page.on('pageerror',e=>errors.push(e.stack));
 await page.waitForFunction(()=>window.CityApp&&window.terrainAPI);
 await page.evaluate(()=>{window.managementCsp=[];document.addEventListener('securitypolicyviolation',e=>managementCsp.push(e.violatedDirective+':'+e.blockedURI));});
 await page.context().tracing.start({screenshots:true,snapshots:true});
}
async function loaded(id=first){
 await page.waitForFunction(id=>document.querySelector(`#tm-lines [data-tm-line="${id}"]`)?.getAttribute('aria-current')==='true'&&document.getElementById('tm-content')?.getAttribute('aria-busy')!=='true'&&document.getElementById('tm-form'),id);
}
async function open(){
 await click('#workspace-transit');await click('[data-transit-action="manage"]');
 const expected=await lines();assert.equal(await page.locator('#city-line-list [data-line]:visible').count(),expected.length);
 for(const line of expected)assert((await page.locator(`[data-line="${line.id}"]`).innerText()).includes(`${line.boardings} 上车人次 / 典型日`));
 await click(`[data-line="${first}"]`);await loaded();
}
async function save(){
 await click('#tm-save');await page.waitForFunction(()=>document.getElementById('tm-message')?.textContent.includes('线路设置已保存'));await ready();await loaded();
}
async function switchLine(id){await click(`[data-tm-line="${id}"]`);await loaded(id);}
async function stop(){if(await page.locator('#city-play').innerText()==='暂停模拟')await click('#city-play');await page.waitForTimeout(350);await ready();}
async function liveLength(expected){
 await click('#tm-close');
 await page.locator('#city-speed').evaluate(el=>{el.value='5';el.dispatchEvent(new Event('input',{bubbles:true}));});
 await click('#city-play');
 await page.waitForFunction(({id,length})=>CityApp.traffic?.vehicles.some(v=>v.line===id&&v.length===length),{id:first,length:expected});
 await stop();
 const buses=await page.evaluate(id=>CityApp.traffic.vehicles.filter(v=>v.line===id),first);
 assert(buses.every(v=>v.length===expected));assert(buses.length<=(await current()).assignedFleet);
 await open();return buses.length;
}
async function screenshot(name){await page.screenshot({path:path.join(output,name+'.png')});}
(async()=>{
 try{
  await launch();await page.locator('#city-import-file').setInputFiles(path.join(temp,'fixture.json'));await ready();
  assert.deepEqual(await page.locator('.city-demand-item').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).getPropertyValue('--demand-color').trim())),['#57966e','#c99546','#528fab','#a080a5','#9a9169']);
  [first,second]=(await lines()).map(l=>l.id);assert((await current()).boardings>0);
  await open();assert.equal(await page.locator('#tm-lines [data-tm-line]').count(),2);
  const beforeRead=await page.evaluate(()=>JSON.stringify(CityApp.state));
  const initial=await current();
  assert.equal(Number(await page.locator('.tm-metrics strong').first().innerText()),initial.boardings);
  check('全部线路及各线典型日上车人次可见，包括停运的零客流线路',{initialBoardings:initial.boardings});

  await click('#tm-tab-stops');
  const details=await page.evaluate(id=>CityApp.transitDetails(id),first);
  assert.equal(await page.locator('#tm-stops tbody tr').count(),initial.stops.length);
  for(const [i,stop] of details.stops.entries()){
   const row=page.locator('#tm-stops tbody tr').nth(i),cells=row.locator('td');
   assert((await row.innerText()).includes(stop.name));
   assert.equal(await cells.nth(0).innerText(),String(stop.boardings+stop.alightings));
   assert.equal(await cells.nth(1).innerText(),`${stop.boardings} / ${stop.alightings}`);
   assert((await cells.nth(2).innerText()).includes('通勤'));
   assert((await cells.nth(3).innerText()).includes(`${stop.residents} 人`));
   assert((await cells.nth(3).innerText()).includes(`${stop.jobs} 个岗位`));
  }
  assert.equal(details.stops.reduce((n,s)=>n+s.boardings,0),initial.boardings);
  assert.equal(details.stops.reduce((n,s)=>n+s.alightings,0),initial.boardings);
  assert.deepEqual(details.stops.map(s=>s.residents).sort((a,b)=>a-b),[0,60]);
  await screenshot('station-demand');check('逐站上下车、综合需求、需求构成和真实步行覆盖数值一致');
  await click('#tm-tab-trend');assert.equal(await page.locator('.tm-hour').count(),24);
  const hourly=(await page.locator('.tm-hour span').allTextContents()).map(Number);
  assert.deepEqual(hourly,details.hourly);assert.equal(hourly.reduce((a,b)=>a+b,0),initial.boardings);
  assert(hourly[8]>0&&hourly[18]>0);
  assert(await page.locator('.tm-hour i').evaluateAll(nodes=>nodes.some(n=>n.getBoundingClientRect().height>50)));
  assert.equal(await page.locator('.tm-history circle').count(),1);
  await click('#tm-refresh');await loaded();
  assert.equal(await page.evaluate(()=>JSON.stringify(CityApp.state)),beforeRead);
  check('24 小时需求、早晚高峰和历史图正常；查看与刷新不改动城市');await screenshot('hourly-demand');

  await click('#tm-tab-settings');await page.locator('#tm-name').fill('待保存快线');
  await page.locator('#tm-vehicle').selectOption('minibus');await page.locator('#tm-fleet-mode').selectOption('manual');await page.locator('#tm-count').fill('2');
  await page.locator('#tm-start').fill('05:30');await page.locator('#tm-end').fill('23:15');
  await switchLine(second);assert.equal(await page.locator('#tm-name').inputValue(),'夜班备用线');
  await page.locator('#tm-name').fill('备用线未保存草稿');await switchLine(first);
  for(const [id,value] of [['tm-name','待保存快线'],['tm-vehicle','minibus'],['tm-fleet-mode','manual'],['tm-count','2'],['tm-start','05:30'],['tm-end','23:15']])assert.equal(await page.locator('#'+id).inputValue(),value);
  assert.equal((await current()).name,initial.name);assert.equal((await lines())[1].name,'夜班备用线');
  check('切换线路保留各自未保存草稿，不串线也不提前提交');
  await save();let small=await current();
  assert.equal(small.vehicleType,'minibus');assert.equal(small.capacity,30);assert.equal(small.assignedFleet,2);assert.equal(small.fleet,2);
  assert(Math.abs(small.serviceHeadway-small.cycle/2)<1e-8);assert.equal(small.startHour,5.5);assert.equal(small.hours,17.75);
  const smallVisible=await liveLength(7.2);
  await page.locator('#tm-vehicle').selectOption('articulated');await page.locator('#tm-count').fill('4');await save();
  let large=await current();assert.equal(large.capacity,140);assert.equal(large.fleet,4);assert.equal(large.assignedFleet,4);
  assert(Math.abs(large.serviceHeadway-small.serviceHeadway/2)<1e-8);assert(large.operatingCost>small.operatingCost);
  const largeVisible=await liveLength(18);
  check('更换小巴与铰接车、2 辆改 4 辆后，容量、班距、费用及实景车长实际改变',{fleetChanges:{small:{capacity:small.capacity,fleet:small.fleet,headway:small.serviceHeadway,cost:small.operatingCost,visible:smallVisible},large:{capacity:large.capacity,fleet:large.fleet,headway:large.serviceHeadway,cost:large.operatingCost,visible:largeVisible}}});

  await page.locator('#tm-fleet-mode').selectOption('auto');await page.locator('#tm-headway').fill('6');await save();
  let automatic=await current();assert.equal(automatic.assignedFleet,null);assert.equal(automatic.serviceHeadway,6);assert.equal(automatic.fleet,Math.ceil(automatic.cycle/6));
  await page.locator('#tm-headway').fill('12');await save();assert.equal((await current()).serviceHeadway,12);assert((await current()).fleet<=automatic.fleet);
  check('切回自动配车后按目标班距计算车辆数，手动数量不残留');

  await page.locator('#tm-start').fill('23:30');await page.locator('#tm-end').fill('01:30');await save();
  let night=await current();assert.equal(night.startHour,23.5);assert.equal(night.hours,2);assert.equal(night.boardings,0);
  await click('#tm-tab-trend');assert((await page.locator('.tm-hour span').allTextContents()).every(n=>n==='0'));
  await click('#tm-tab-settings');
  const beforeInvalid=await page.evaluate(()=>JSON.stringify(CityApp.state));
  await page.locator('#tm-start').fill('08:00');await page.locator('#tm-end').fill('08:00');await click('#tm-save');
  assert((await page.locator('#tm-message').innerText()).includes('至少为 15 分钟'));
  assert.equal(await page.evaluate(()=>JSON.stringify(CityApp.state)),beforeInvalid);
  await page.locator('#tm-end').fill('08:10');await click('#tm-save');assert.equal(await page.evaluate(()=>JSON.stringify(CityApp.state)),beforeInvalid);
  await page.locator('#tm-all-day').check();await save();assert.equal((await current()).hours,24);assert.equal((await current()).startHour,0);assert((await current()).boardings>0);
  await page.locator('#tm-enabled').uncheck();await save();assert.equal((await current()).boardings,0);
  await page.locator('#tm-enabled').check();await save();assert((await current()).boardings>0);
  await page.locator('#tm-fleet-mode').selectOption('manual');await page.locator('#tm-count').fill('0');
  assert.equal(await page.locator('#tm-count').evaluate(el=>el.checkValidity()),false);
  const beforeCount=await page.evaluate(()=>JSON.stringify(CityApp.state));await click('#tm-save');assert.equal(await page.evaluate(()=>JSON.stringify(CityApp.state)),beforeCount);
  await page.locator('#tm-count').fill('4');await save();assert.equal((await current()).demandHistory.length,1);
  check('跨午夜、全天、暂停与恢复均生效；相同首末班、短于 15 分钟及零车辆被拒绝，同日编辑不制造历史日期');

  await click('#tm-close');const firstDate=(await current()).demandDate;
  await page.locator('#city-speed').evaluate(el=>{el.value='9';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await click('#city-play');await page.waitForFunction(date=>CityApp.state.lines[0].demandDate!==date,firstDate,{timeout:60000});await stop();
  await open();const nextDay=await current();assert(nextDay.demandHistory.length>=2);
  const expectedDates=nextDay.demandHistory.map(r=>r.date);assert.equal(new Set(expectedDates).size,expectedDates.length);assert.deepEqual([...expectedDates].sort(),expectedDates);
  await page.locator('#tm-all-day').uncheck();await page.locator('#tm-start').fill('22:15');await page.locator('#tm-end').fill('04:45');await save();
  const final=await current();assert.equal(final.startHour,22.25);assert.equal(final.hours,6.5);assert.equal(final.vehicleType,'articulated');assert.equal(final.assignedFleet,4);
  assert.equal(final.demandHistory.length,nextDay.demandHistory.length);assert(final.demandHistory.some(r=>r.boardings>0));assert.equal(final.demandHistory.at(-1).boardings,0);
  await click('#tm-tab-trend');assert.equal(await page.locator('.tm-history circle').count(),final.demandHistory.length);
  await page.locator('.tm-history-details summary').click();
  const dates=await page.locator('.tm-history-details tbody tr td:first-child').allTextContents();assert.deepEqual(dates,expectedDates.toReversed());
  await screenshot('daily-history');
  check('跨每日 0 点产生新日期需求，日内修改更新当日记录，历史图表与明细保持一致',{history:final.demandHistory});

  const savedLines=await lines();await click('#tm-close');await page.locator('#map').focus();await page.keyboard.press((process.platform==='darwin'?'Meta+':'Control+')+'s');
  await page.locator('#city-save-name').fill('线路管理验收');await click('#file-save');await ready();await page.waitForFunction(()=>!document.getElementById('city-dialog').open);
  assert.deepEqual(await page.evaluate(()=>managementCsp),[]);
  await page.context().tracing.stop({path:path.join(output,'before-restart.zip')});await desktop.close();desktop=null;
  await launch();await click('#menu-load');await page.locator('[data-save-index]').filter({hasText:'线路管理验收'}).click();await ready();
  assert.deepEqual(await lines(),savedLines);await open();
  for(const [id,value] of [['tm-vehicle','articulated'],['tm-fleet-mode','manual'],['tm-count','4'],['tm-start','22:15'],['tm-end','04:45']])assert.equal(await page.locator('#'+id).inputValue(),value);
  check('保存并重启后，全部线路、车型、车辆数、跨午夜时段和需求历史完整恢复');

  for(const [width,height] of [[1600,1000],[1024,768],[375,812]]){
   await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   for(const tab of ['settings','stops','trend']){
    await click('#tm-tab-'+tab);const bounds=await page.locator('#transit-management').boundingBox();
    assert(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width&&bounds.y+bounds.height<=height,JSON.stringify(bounds));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await screenshot(`${tab}-${width}`);
   }
   await switchLine(second);await switchLine(first);
  }
  await click('#tm-tab-settings');await page.locator('#tm-tab-settings').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#tm-tab-stops').getAttribute('aria-selected'),'true');
  await page.keyboard.press('End');assert.equal(await page.locator('#tm-tab-trend').getAttribute('aria-selected'),'true');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#transit-management').isVisible(),false);
  assert.deepEqual(await page.evaluate(()=>managementCsp),[]);assert.deepEqual(errors,[]);
  check('桌面、平板、窄屏的全部页签与线路切换可用，键盘操作及内容安全策略无异常');
  report.passed=true;fs.rmSync(path.join(output,'failure.png'),{force:true});
 }catch(error){report.error=error.stack;report.consoleErrors=errors;if(page&&!page.isClosed()){await screenshot('failure').catch(()=>{});report.message=await page.locator('#tm-message').innerText().catch(()=>'');}throw error;}
 finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));if(desktop){await page.context().tracing.stop({path:path.join(output,'trace.zip')}).catch(()=>{});await desktop.close();}fs.rmSync(temp,{recursive:true,force:true});}
 console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
