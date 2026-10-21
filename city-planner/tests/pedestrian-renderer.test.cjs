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
