// Isolated visual review: existing atlases, six building families, four styles.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'building-appearance-'));
const output=path.join(root,'output/playwright/building-appearance');fs.mkdirSync(output,{recursive:true});
(async()=>{
 let browser;const server=spawn(path.join(root,'.venv/bin/python'),['backend/server.py','--preview','--port','0'],{cwd:root,env:{...process.env,SHANHAI_DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
 let log='';server.stderr.on('data',d=>log+=d);
 try{
  const ready=await new Promise((resolve,reject)=>{require('node:readline').createInterface({input:server.stdout}).once('line',l=>resolve(JSON.parse(l)));server.once('error',reject);server.once('exit',c=>reject(Error(c+': '+log)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:1980}});page.setDefaultTimeout(60000);
  const errors=[],failed=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)failed.push(r.url());});
  await page.goto(`http://127.0.0.1:${ready.port}`,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>CityScene.assetsReady&&CityOrdinaryRoofs.ready&&CityBuildingAppearance.ready);
  await page.evaluate(()=>{
   CityScene.configure({quality:'high',renderer:'textures'});CityScene.setTime(9*3600);
   const canvas=window.appearanceCanvas=document.createElement('canvas');canvas.width=1440;canvas.height=1980;
   canvas.style='position:fixed;inset:0;z-index:99999;width:1440px;height:1980px';document.body.append(canvas);
   const families=[['住宅 · 低层','residential',2],['住宅 · 公寓','residential',9],['商业 · 店面','commercial',4],['办公 · 写字楼','office',12],['工业 · 厂房','industrial',2],['仓储 · 配送','warehouse',1]];
   window.appearanceCases=[];
   for(const [row,[label,use,floors]] of families.entries()){
    const seen=new Set();let col=0;
    for(let n=0;col<4&&n<100;n++){
     const points=[[0,0],[32,0],[32,25],[0,25],[0,0]],p={id:'appearance-'+n,center:[16,12.5],points,building:{use,status:'active',floors,height:floors*3.3,footprint:points}};
     const style=CityBuildingAppearance.profile(p);if(seen.has(style.name)&&seen.size<(use==='industrial'||use==='warehouse'?3:4))continue;
     seen.add(style.name);appearanceCases.push({row,col:col++,label,p,style});
    }
   }
   window.paintAppearanceSheet=()=>{
    CityScene.commitMaterials();const g=canvas.getContext('2d');g.setTransform(1,0,0,1,0,0);g.fillStyle='#e9e9df';g.fillRect(0,0,1440,1980);
    g.fillStyle='#2c4447';g.font='600 29px sans-serif';g.fillText('建成建筑 · 体量与立面变体',25,43);
    g.font='15px sans-serif';g.fillStyle='#60736d';g.fillText('同一地块尺寸 · 固定种子 · 复用现有屋面与立面材质',25,70);
    for(const {row,col,label,p,style} of appearanceCases){
     const x=col*355+18,y=row*310+110;
     g.setTransform(1,0,0,1,0,0);g.fillStyle='#f5f4ec';g.fillRect(x,y,341,294);
     g.font='600 17px sans-serif';g.fillStyle='#405c59';g.fillText(label,x+13,y+25);
     g.font='12px sans-serif';g.fillStyle='#7b8981';g.fillText(style.name,x+13,y+45);
     g.setTransform(6.5,0,0,6.5,x+64,y+124);CityScene.building(g,p,6.5);
    }
   };paintAppearanceSheet();
  });
  for(let i=0;i<8;i++){await page.waitForFunction(()=>!CityScene.stats.materialPreparation.pending);await page.evaluate(()=>paintAppearanceSheet());}
  await page.locator('canvas').last().screenshot({path:path.join(output,'architecture-day.png')});
  const report=await page.evaluate(()=>{
   const previous=CityScene.stats.buildingCache;paintAppearanceSheet();const current=CityScene.stats.buildingCache;
   return {newMisses:current.misses-previous.misses,cache:current,textureCount:CityBuildingAppearance.textureCount,materials:CityScene.stats.materialPreparation,
    styles:appearanceCases.map(({label,p,style})=>({use:label,style:style.name,volumes:CityGeometry.buildingMassing(p).volumes.length}))};
  });
  assert.equal(report.newMisses,0);assert(report.cache.bytes<=report.cache.budget);assert.equal(report.materials.errors,0);assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);assert(report.textureCount<=100);
  await page.evaluate(()=>{CityScene.setTime(17*3600);paintAppearanceSheet();});
  await page.locator('canvas').last().screenshot({path:path.join(output,'architecture-evening.png')});
  await page.evaluate(()=>{
   CityScene.setTime(9*3600);const canvas=appearanceCanvas;canvas.height=1100;canvas.style.height='1100px';const g=canvas.getContext('2d');
   g.setTransform(1,0,0,1,0,0);g.fillStyle='#e9e9df';g.fillRect(0,0,1440,1100);
   g.font='600 27px sans-serif';g.fillStyle='#304949';g.fillText('近景 · 庭院住宅 / 双塔办公 / 商业中庭 / 工业设备',25,42);
   for(const [i,index] of [4,13,10,16].entries()){
    const original=appearanceCases[index],p=JSON.parse(JSON.stringify(original.p)),angle=.32,c=Math.cos(angle),s=Math.sin(angle);
    p.points=p.points.map(([x,y])=>[x*c-y*s,x*s+y*c]);p.building.footprint=p.points;p.center=[16*c-12.5*s,16*s+12.5*c];
    const x=i%2*710+18,y=Math.floor(i/2)*510+70;
    g.setTransform(1,0,0,1,0,0);g.fillStyle='#f5f4ec';g.fillRect(x,y,690,490);
    g.font='600 20px sans-serif';g.fillStyle='#405c59';g.fillText(original.label,x+20,y+30);
    g.setTransform(10,0,0,10,x+195,y+145);CityScene.building(g,p,10);
   }
  });
  await page.locator('canvas').last().screenshot({path:path.join(output,'architecture-closeup.png')});
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
  fs.writeFileSync(path.join(output,'acceptance.json'),JSON.stringify({...report,errors,failed},null,2));console.log(JSON.stringify(report));
 }finally{await browser?.close();server.kill();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
