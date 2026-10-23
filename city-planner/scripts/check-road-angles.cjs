// Real backend -> renderer audit. No saved cities are modified.
// Geometry overlap warnings require visual review; structural failures exit 1. see output/playwright/road-angles/report.json.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const api=require('../renderer/road-renderer.js');
const app=path.resolve(__dirname,'..'),out=path.join(app,'output/playwright/road-angles');
fs.mkdirSync(out,{recursive:true});
const generated=spawnSync(path.join(app,'.venv/bin/python'),['scripts/road-angle-fixtures.py'],{cwd:app,encoding:'utf8',maxBuffer:160*1024*1024});
if(generated.status!==0)throw Error(generated.stderr);
fs.writeFileSync(path.join(out,'fixtures.jsonl'),generated.stdout);
fs.copyFileSync(path.join(__dirname,'road-angle-gallery.html'),path.join(out,'matrix.html'));
const cases=generated.stdout.trim().split('\n').map(JSON.parse), failures=[], counts={}, gallery=[];
function fail(c,check,detail){failures.push({id:c.id,check,detail});counts[check]=(counts[check]||0)+1;}
function finite(value){return typeof value==='number'?Number.isFinite(value):!value||typeof value!=='object'||Object.values(value).every(finite);}
function insideRoad(p,r,width){const at=api.sample(r.points,api.nearestDistance(r.points,p));return Math.hypot(p[0]-at.point[0],p[1]-at.point[1])<width/2-.1;}
for(const c of cases){
 const {roads,network,roadTypes}=c,plan=api.buildPlan(roads,network,roadTypes),corners=api.junctionCorners(network,roads);
 if(!finite(plan)||!finite(corners))fail(c,'non-finite geometry','NaN or Infinity');
 const expected=c.shape==='separate'?2:c.shape==='X'?4:c.shape==='T'?3:roads.length;
 if(network.edges.length!==expected)fail(c,'topology',`edges ${network.edges.length}, expected ${expected}`);
 if(c.shape==='separate'&&(network.junctions.length||plan.crosswalks.length||plan.signals.length))fail(c,'grade separation','unexpected junction/furniture');
 if(c.level!==0&&(plan.crosswalks.length||plan.signals.length||corners.length))fail(c,'layer furniture','ground-only detail on elevated/tunnel road');
 for(const name of ['crosswalks','stopLines'])for(const item of plan[name]){
   // Match the actual rectangles painted in road-renderer.js, including stripe depth
   // and the incoming half of a two-way stop line. Sample their interiors.
   const rectangles=[];
   if(name==='crosswalks')for(let y=-item.width/2+.7;y<item.width/2-.6;y+=1.35)rectangles.push([-2,y,4,.7]);
   else {const a=-item.width/2+.5,b=item.oneway?item.width/2-.5:-.4;rectangles.push([-.2,a,.4,b-a]);}
   const points=rectangles.flatMap(([x,y,w,h])=>[.05,.5,.95].flatMap(u=>[.05,.5,.95].map(v=>{
     const along=x+w*u,side=y+h*v;
     return [item.point[0]+item.tangent[0]*along-item.tangent[1]*side,item.point[1]+item.tangent[1]*along+item.tangent[0]*side];
   })));
   const other=roads.find(r=>r.id!==item.road&&r.level===item.level&&r.kind!=='path'&&points.some(p=>insideRoad(p,r,roadTypes[r.kind].width)));
   if(other){fail(c,`${name} overlap`,`${item.approach} intersects ${other.id}`);break;}
 }
 if(c.level===0&&c.kinds?.every(k=>k==='street')&&c.shape==='X')gallery.push({...c,cornerCount:corners.length});
 if(c.level===0&&c.shape==='T'&&c.angle===30&&['lane','avenue','path'].includes(c.kinds?.[1])&&c.kinds[0]==='motorway')gallery.push({...c,cornerCount:corners.length});
 if(c.level===0&&c.shape==='T'&&c.kinds?.[0]==='street'&&c.kinds[1]==='avenue'&&[45,60,90].includes(c.angle))gallery.push({...c,cornerCount:corners.length});
 if(c.shape==='multi')gallery.push({...c,cornerCount:corners.length});
}
const structural=failures.filter(f=>!f.check.endsWith(' overlap')),warnings=failures.filter(f=>f.check.endsWith(' overlap'));
const report={cases:cases.length,failedCases:new Set(structural.map(f=>f.id)).size,reviewCases:new Set(warnings.map(f=>f.id)).size,checks:counts,failures:structural,warnings};
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const scripts=['material-catalog','surface-variation','material-preparation','raster-cache','building-stages','scene-renderer','road-renderer'].map(s=>`<script src="${s}.js"></script>`).join('');
fs.writeFileSync(path.join(out,'gallery.html'),`<!doctype html><meta charset="utf-8"><title>Road angle audit</title><base href="../../../renderer/"><link rel="icon" href="data:,"><style>body{background:#eef1e8;font:15px sans-serif;margin:20px}main{display:grid;grid-template-columns:repeat(4,360px);gap:16px}figure{margin:0}canvas{background:#b6c7a4}figcaption{padding:8px}</style><h1>道路交汇角度检查 · 实际渲染器</h1><p>360 × 360 px / 每格；极小夹角仅展示路口中心，完整诊断见 report.json。</p><main></main>${scripts}<script>const cases=${JSON.stringify(gallery)};for(const c of cases){const f=document.createElement('figure'),v=document.createElement('canvas');v.width=v.height=360;f.append(v);const label=document.createElement('figcaption');label.textContent=c.id+' · corners '+c.cornerCount;f.append(label);document.querySelector('main').append(f);const ctx=v.getContext('2d');ctx.translate(180,180);ctx.scale(2.5,2.5);ctx.translate(-2000,-2000);RoadRenderer.paint(ctx,c,{scale:2.5,vehicles:false});}</script>`);
console.log(JSON.stringify({...report,warnings:warnings.slice(0,6)},null,2));
process.exitCode=failures.some(f=>!f.check.endsWith(' overlap'))?1:0;
