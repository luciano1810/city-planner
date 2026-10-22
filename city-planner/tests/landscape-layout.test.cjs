const test=require('node:test'),assert=require('node:assert/strict');
const L=require('../renderer/landscape-layout.js');
const cases=[
 {id:'plaza',kind:'plaza',points:[[0,0],[60,0],[60,44],[0,44],[0,0]]},
 {id:'strip',kind:'park',points:[[0,0],[14,0],[14,65],[0,65],[0,0]]},
 {id:'notched',kind:'park',points:[[0,0],[50,0],[50,16],[17,16],[17,70],[0,70],[0,0]]}
];
test('display planting respects concave sites and reserves walking space without changing the saved geometry',()=>{
 for(const site of cases){
  const before=JSON.stringify(site),p=L.plan(site);assert(p);assert.equal(JSON.stringify(site),before);
  for(const bed of p.beds)for(let i=0;i<bed.length;i++){
   const a=bed[i],b=bed[(i+1)%bed.length];
   for(let j=0;j<=20;j++)assert(L.inside(a.map((v,k)=>v+(b[k]-v)*j/20),site.points));
  }
  for(const item of [...p.trees,...p.shrubs,...p.stones]){
   assert(L.inside(item.point,site.points));assert(p.beds.some(b=>L.inside(item.point,b)));
  }
  for(const point of p.benches)assert(!p.beds.some(b=>L.inside(point,b)));
  assert(p.trees.length>0);assert(p.shrubs.length>p.trees.length);
 }
 const plaza=L.plan(cases[0]);assert(!plaza.beds.some(b=>L.inside([30,22],b)),'Fountain and central plaza stay open');
});
test('planting is repeatable after loading, cached per site, and safely declines tiny or unsuitable sites',()=>{
 for(const site of cases){assert.strictEqual(L.plan(site),L.plan(site));assert.deepEqual(L.plan(site),L.plan(JSON.parse(JSON.stringify(site))));}
 assert.equal(L.plan({kind:'park',points:[[0,0],[3,0],[3,5],[0,5]]}),null);
 assert.equal(L.plan({kind:'school',points:[[0,0],[100,0],[100,100],[0,100]]}),null);
});
