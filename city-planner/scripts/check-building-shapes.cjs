// Isolated visual review of seeded building variations on six plot outlines.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'building-shapes-'));
const output=path.join(root,'output/playwright/building-shapes');fs.mkdirSync(output,{recursive:true});
(async()=>{
 let browser;const server=spawn(path.join(root,'.venv/bin/python'),['backend/server.py','--preview','--port','0'],{cwd:root,env:{...process.env,SHANHAI_DATA_DIR:temp},stdio:['ignore','pipe','pipe']});
 let log='';server.stderr.on('data',d=>log+=d);
 try{
  const ready=await new Promise((resolve,reject)=>{require('node:readline').createInterface({input:server.stdout}).once('line',l=>resolve(JSON.parse(l)));server.once('error',reject);server.once('exit',c=>reject(Error(c+': '+log)));});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:1120}});page.setDefaultTimeout(60000);
  const errors=[],failed=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)failed.push(r.url());});
  await page.goto(`http://127.0.0.1:${ready.port}`,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>CityScene.assetsReady&&CityOrdinaryRoofs.ready&&CityBuildingAppearance.ready);
  await page.evaluate(()=>{
   CityScene.configure({quality:'high',renderer:'textures'});CityScene.setTime(9*3600);
   const canvas=window.shapeCanvas=document.createElement('canvas');canvas.width=1440;canvas.height=1120;
   canvas.style='position:fixed;inset:0;z-index:99999;width:1440px;height:1120px';document.body.append(canvas);
   const rect=[[0,0],[48,0],[48,34],[0,34],[0,0]],taper=[[0,0],[52,0],[39,36],[0,36],[0,0]],ell=[[0,0],[52,0],[52,18],[25,18],[25,36],[0,36],[0,0]],court=[[0,0],[52,0],[52,36],[35,36],[35,18],[17,18],[17,36],[0,36],[0,0]];
   const fixtures=[['Rectangular plot',rect,null],['Corner cuts',rect,'chamfered'],['Tapered plot',taper,'plot-following'],['L-shaped plot',ell,'plot-following'],['Courtyard plot',court,'plot-bevel'],['Setback on irregular plot',taper,'plot-setback']];
   window.shapeCases=fixtures.map(([label,outline,target],i)=>{
    const angle=.16,c=Math.cos(angle),s=Math.sin(angle),points=outline.map(([x,y])=>[x*c-y*s,x*s+y*c]);
    for(let n=0;n<1000;n++){
     const p={id:'plot-review-'+n,points,center:[20,16],building:{use:i===3?'residential':'office',floors:5,height:16.5,status:'active',footprint:points}};
     const layout=CityGeometry.buildingMassing(p);if((layout.shape||null)===target)return {label,p,shape:layout.shape||'rectangular composition'};
    }throw Error('no seeded variant '+target);
   });
   window.paintShapes=()=>{
    CityScene.commitMaterials();const g=canvas.getContext('2d');g.setTransform(1,0,0,1,0,0);g.fillStyle='#e9e9df';g.fillRect(0,0,1440,1120);
    g.fillStyle='#2c4447';g.font='600 30px sans-serif';g.fillText('Architecture follows the plot',28,44);
    g.font='16px sans-serif';g.fillStyle='#60736d';g.fillText('Seeded variations / rectangular forms remain the majority / existing facade materials',28,76);
    shapeCases.forEach(({label,p,shape},i)=>{
     const x=i%3*470+20,y=Math.floor(i/3)*500+110;
     g.setTransform(1,0,0,1,0,0);g.fillStyle='#f5f4ec';g.fillRect(x,y,455,480);
     g.fillStyle='#405c59';g.font='600 21px sans-serif';g.fillText(label,x+18,y+32);
     g.fillStyle='#7b8981';g.font='13px sans-serif';g.fillText(shape,x+18,y+57);
     g.setTransform(6.7,0,0,6.7,x+70,y+155);
     g.beginPath();p.points.forEach(([a,b],j)=>j?g.lineTo(a,b):g.moveTo(a,b));g.closePath();g.fillStyle='#d8dfcb';g.fill();
     g.strokeStyle='#96aa8e';g.lineWidth=.4;g.setLineDash([.8,.6]);g.stroke();g.setLineDash([]);
     CityScene.building(g,p,6.7);
    });
   };paintShapes();
  });
  for(let i=0;i<8;i++){await page.waitForFunction(()=>!CityScene.stats.materialPreparation.pending);await page.evaluate(()=>paintShapes());}
  await page.locator('canvas').last().screenshot({path:path.join(output,'plot-architecture.png')});
  const report=await page.evaluate(()=>({cases:shapeCases.map(({label,shape})=>({label,shape})),materials:CityScene.stats.materialPreparation}));
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);assert.equal(report.materials.errors,0);
  fs.writeFileSync(path.join(output,'acceptance.json'),JSON.stringify({...report,errors,failed},null,2));console.log(JSON.stringify(report));
 }finally{await browser?.close();server.kill();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
