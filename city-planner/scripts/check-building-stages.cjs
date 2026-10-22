// Real Canvas rendering, texture worker and cache checks on an isolated server.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'building-stages-'));
const output=path.join(root,'output/playwright/building-stages');fs.mkdirSync(output,{recursive:true});
(async()=>{
  let browser;
  const server=spawn(path.join(root,'.venv/bin/python'),['backend/server.py','--preview','--port','0'],{cwd:root,env:{...process.env,SHANHAI_DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
  let log='';server.stderr.on('data',d=>log+=d);
  try{
    const ready=await new Promise((resolve,reject)=>{require('node:readline').createInterface({input:server.stdout}).once('line',l=>resolve(JSON.parse(l)));server.once('error',reject);server.once('exit',c=>reject(Error(c+': '+log)));});
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
    const page=await browser.newPage({viewport:{width:1500,height:1426},deviceScaleFactor:1});page.setDefaultTimeout(60000);
    const errors=[],failed=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)failed.push(r.url());});
    await page.goto(`http://127.0.0.1:${ready.port}`,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>CityScene.assetsReady&&CityOrdinaryRoofs.ready).catch(error=>{throw new Error(error.message+' '+JSON.stringify({errors,failed}));});
    await page.evaluate(()=>{
      CityScene.configure({quality:'high',renderer:'textures'});CityScene.setTime(9*3600);
      const canvas=window.stageCanvas=document.createElement('canvas');canvas.width=1500;canvas.height=1426;
      canvas.style='position:fixed;inset:0;z-index:99999;width:1500px;height:1426px';document.body.append(canvas);
      const stages=[['已选址','planned',0],['基坑与基础','construction',.1],['主体施工','construction',.5],['外墙收尾','construction',.88],['建成','active',1]];
      window.stageCases=[];
      window.stageFamilies=[['庭院住宅','residential',2,20,23],['公寓','residential',10,30,24],['办公楼','office',14,26,26],['厂房','industrial',2,33,23]];
      window.stageColumns=5;
      for(const [row,[family,use,floors,w,d]] of stageFamilies.entries())for(const [col,[label,status,progress]] of stages.entries()){
        const points=[[0,0],[w,0],[w,d],[0,d],[0,0]],center=[w/2,d/2];
        const p={id:'stage-'+family,center,points,building:{center,use,status,constructionProgress:progress,floors,height:floors*3.3,footprint:points}};
        stageCases.push({p,row,col,label:family+' · '+label,w,d});
      }
      window.paintStageSheet=()=>{
        CityScene.commitMaterials();const g=canvas.getContext('2d');g.setTransform(1,0,0,1,0,0);g.fillStyle='#e8e9de';g.fillRect(0,0,1500,1426);
        g.fillStyle='#263e43';g.font='600 28px sans-serif';g.fillText('建筑生命周期 · 精细贴图',32,48);
        g.fillStyle='#64746e';g.font='15px sans-serif';g.fillText('分类型施工结构 · 住宅分间 / 公寓楼板 / 办公核心筒 / 厂房钢屋架',32,77);
        for(const {p,row,col,label,w,d} of stageCases){
          const step=1480/stageColumns,x=col*step+25,y=row*326+150;
          g.setTransform(1,0,0,1,0,0);g.fillStyle='#f4f3ea';g.fillRect(x-9,y-44,step-13,309);
          g.fillStyle='#415b58';g.font='600 17px sans-serif';g.fillText(label,x+10,y-17);
          const scale=Math.min((step-55)/w,210/(d+p.building.height*.26));
          g.setTransform(scale,0,0,scale,x+(step-13-w*scale)/2,y+32+p.building.height*.26*scale);CityScene.building(g,p,scale);
        }
      };paintStageSheet();
    });
    // Draws request materials; publication is explicit just as in the map frame.
    for(let i=0;i<8;i++){
      await page.waitForFunction(()=>!CityScene.stats.materialPreparation.pending);
      await page.evaluate(()=>paintStageSheet());
    }
    await page.locator('canvas').last().screenshot({path:path.join(output,'stages-day.png')});
    const report=await page.evaluate(()=>{
      const before=CityScene.stats.buildingCache;paintStageSheet();const after=CityScene.stats.buildingCache;
      const allocations=after.misses-before.misses;
      const p=stageCases[0].p,geometry=JSON.stringify(p.building.footprint),g=stageCanvas.getContext('2d');
      p.building.status='construction';p.building.constructionProgress=.4;g.setTransform(8,0,0,8,45,193);CityScene.building(g,p,8);
      const changed=CityScene.stats.buildingCache;
      return {allocations,geometryStable:geometry===JSON.stringify(p.building.footprint),cache:changed,materials:CityScene.stats.materialPreparation};
    });
    assert.equal(report.allocations,0,'stable stage sheet reuses all building rasters');
    assert(report.geometryStable);assert.equal(report.materials.errors,0);assert.equal(report.materials.pending,0);
    assert(report.cache.bytes<=report.cache.budget);assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
    await page.evaluate(()=>{stageCases[0].p.building.status='planned';stageCases[0].p.building.constructionProgress=0;CityScene.setTime(17*3600);paintStageSheet();});
    await page.locator('canvas').last().screenshot({path:path.join(output,'stages-evening.png')});
    await page.evaluate(()=>{
      CityScene.setTime(9*3600);stageColumns=4;stageCases=[];
      for(const [row,[family,use,floors,w,d]] of stageFamilies.entries())for(let col=0;col<4;col++){
        const points=[[0,0],[w,0],[w,d],[0,d],[0,0]],center=[w/2,d/2];
        const p={id:'',center,points,building:{center,use,status:'construction',constructionProgress:.64,floors,height:floors*3.3,footprint:points}};
        for(let i=0;i<200;i++){p.id='variant-'+family+'-'+i;if(CityBuildingStages.recipe(p).variant===col)break;}
        stageCases.push({p,row,col,label:family+' · 施工布局 '+(col+1),w,d});
      }paintStageSheet();
    });
    for(let i=0;i<6;i++){await page.waitForFunction(()=>!CityScene.stats.materialPreparation.pending);await page.evaluate(()=>paintStageSheet());}
    await page.locator('canvas').last().screenshot({path:path.join(output,'construction-variants.png')});
    fs.writeFileSync(path.join(output,'acceptance.json'),JSON.stringify({...report,errors,failed},null,2));console.log(JSON.stringify(report));
  }finally{await browser?.close();server.kill();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
