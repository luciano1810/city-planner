const test=require('node:test');
const assert=require('node:assert/strict');
const people=require('../renderer/pedestrian-renderer.js');

test('walking gait advances with distance and stands still when waiting',()=>{
  const p={id:3,speed:1.4,stride:0};
  assert.notDeepEqual(people.gait(p),people.gait({...p,stride:.3}));
  assert.deepEqual(people.gait({...p,speed:0,stride:42}),{swing:0,lift:0});
  assert.deepEqual(people.gait(p),people.gait({...p}));
  assert.equal(new Set(Array.from({length:16},(_,id)=>JSON.stringify(people.outfit({id})))).size,16);
});

test('textured pedestrian geometry stays at human scale and faces outward',()=>{
  for(const heading of [0,Math.PI/2,2.4]){
    let triangles=0;
    people.build3D({triangle(mat,points,uv,normals){
      triangles++;assert.equal(uv.length,3);
      for(const p of points){assert(p.every(Number.isFinite));assert(Math.abs(p[0]-100)<.6);assert(Math.abs(p[1]+100)<.6);assert(p[2]>=0&&p[2]<2);}
      const a=points[1].map((v,k)=>v-points[0][k]),b=points[2].map((v,k)=>v-points[0][k]);
      const n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
      const dot=n.reduce((s,v,k)=>s+v*normals[0][k],0);assert(dot>=-1e-9,'outward face winding');
    }},{id:0,point:[100,100],heading,height:1.72,speed:1.4,stride:.2},{solid:c=>c,cloth:i=>i});
    assert(triangles>100&&triangles<1500);
  }
});

test('Canvas walkers reuse bounded sprites and release evicted backing stores',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),canvases=[];
  const context=()=>new Proxy({createLinearGradient:()=>({addColorStop(){}})},{get:(target,key)=>target[key]||(()=>{}),set:(target,key,value)=>(target[key]=value,true)});
  const root={},document={createElement(){const canvas={width:0,height:0,getContext:context};canvases.push(canvas);return canvas;}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../renderer/pedestrian-renderer.js'),'utf8'),{window:root,document});
  const api=root.CityPedestrians,walkers=Array.from({length:224},(_,id)=>({id,point:[100,100],heading:Math.floor(id/16)*Math.PI/8,height:1.72,speed:0,stride:0})),ctx=context();
  api.paint(ctx,walkers,{scale:14});
  assert.equal(api.stats.sprites,api.stats.limit);assert(api.stats.bytes<8*1024*1024);
  assert(canvases.some(canvas=>canvas.width===1&&canvas.height===1),'evicted sprite storage must be released');
  const generated=canvases.length,hits=api.stats.hits;
  api.paint(ctx,walkers.slice(-32),{scale:14});
  assert.equal(canvases.length,generated,'unchanged poses should only draw existing textures');assert.equal(api.stats.hits-hits,32);
  api.paint(ctx,walkers,{scale:14,visible:()=>false});assert.equal(canvases.length,generated,'offscreen walkers should not allocate textures');
});
