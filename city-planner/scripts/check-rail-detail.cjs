const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert/strict');
const app=path.resolve(__dirname,'..'),temp=fs.mkdtempSync('/tmp/rail-detail-');
const env={...process.env,PYTHONPATH:path.join(app,'backend'),SHANHAI_DATA_DIR:temp};
cp.execFileSync('python',['-c',`import json,sys
from tests.test_city import flat_world
from city.engine import City
c=City(flat_world())
for kind,pts,level,extra in [
 ('train',[[1750,1920],[2050,1920]],0,{}),
 ('metro',[[2050,1920],[2150,1935],[2250,2000]],0,{'shape':'curve'}),
 ('train',[[1750,2000],[2050,2000]],0,{}),
 ('metro',[[2050,2000],[2150,2015],[2250,2080]],-1,{'shape':'curve','connections':[{'road':'r-3','point':[2050,2000]}]}),
 ('train',[[1750,2090],[2050,2090]],1,{}),
 ('metro',[[2050,2090],[2150,2105],[2250,2170]],1,{'shape':'curve'}),
 ('train',[[1750,1800],[2050,1800]],0,{}),
 ('metro',[[2250,1800],[2050,1800]],0,{})]:
 if level==-1:extra['connections'][0]['road']=c.s['roads'][-1]['id']
 c.command(dict(type='road',kind=kind,points=pts,level=level,snap=False,**extra))
json.dump(c.snapshot(),open(sys.argv[1],'w'))`,temp+'/city.json'],{cwd:app,env});
(async()=>{let browser;const server=cp.spawn('python',['backend/server.py','--preview','--port','0'],{cwd:app,env,stdio:['ignore','pipe','pipe']});try{
 const ready=await new Promise((res,rej)=>{require('readline').createInterface({input:server.stdout}).once('line',s=>res(JSON.parse(s)));server.once('exit',rej)});
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+ready.port,{waitUntil:'networkidle'});
 await page.locator('#city-import-file').setInputFiles(temp+'/city.json');
 await page.waitForFunction(()=>CityApp.active&&!CityApp.working&&CityScene.assetsReady&&window.RailRenderer);
 await page.evaluate(()=>{MapWorkspace.focus([2040,2010],22);CityScene.setTime(43200);MapWorkspace.draw()});
 await page.screenshot({path:app+'/../docs/images/rail-detail-overview.png'});
 await page.evaluate(()=>{MapWorkspace.focus([2050,1920],55);MapWorkspace.draw()});
 await page.locator('#map').screenshot({path:app+'/../docs/images/rail-detail-connection.png'});
 await page.evaluate(()=>{MapWorkspace.focus([2050,1800],55);MapWorkspace.draw()});
 await page.locator('#map').screenshot({path:app+'/../docs/images/rail-transition-straight.png'});
 assert(await page.evaluate(()=>typeof RailRenderer.paint==='function')); 
 assert.deepEqual(errors,[]);console.log(JSON.stringify({errors,screenshots:['rail-detail-overview.png','rail-detail-connection.png','rail-transition-straight.png']}));
 }finally{await browser?.close();server.kill();}})().catch(e=>{console.error(e);process.exitCode=1});
