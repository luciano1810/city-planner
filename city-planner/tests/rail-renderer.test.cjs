const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../renderer/rail-renderer.js'),G=require('../renderer/city-geometry.js'),Road=require('../renderer/road-renderer.js');
test('both track types use a common gauge and track centers along curves',()=>{
 const points=G.curvePoints([[0,0],[80,20],[180,90]],true),p=R.layout(points);
 assert.equal(p.paths.length,4);
 for(let i=0;i<points.length;i++)for(const j of [0,2])assert(Math.abs(Math.hypot(p.paths[j][i][0]-p.paths[j+1][i][0],p.paths[j][i][1]-p.paths[j+1][i][1])-1.435)<1e-8);
 assert(Math.abs(p.at(p.total).point[0]-180)<1e-8);
});
test('magnetic snapping accepts either heavy rail system but excludes tram',()=>{
 const roads=[{id:'r',kind:'train',level:0,points:[[0,0],[100,0]]}];
 assert.equal(G.roadSnap([50,4],roads,[],{kind:'metro'}).road,'r');
 assert.equal(G.roadSnap([50,4],roads,[],{kind:'tram'}),null);
});
test('confirmed metro tunnel mouth aligns with the surface rail at zero height',()=>{
 const roads=[{id:'a',kind:'train',level:0,points:[[0,0],[100,0]]},{id:'b',kind:'metro',level:-1,points:[[100,0],[300,0]]}];
 const network={nodes:{join:[100,0]},edges:[{road:'a',kind:'train',a:'start',b:'join',startDistance:0,endDistance:100},{road:'b',kind:'metro',a:'join',b:'end',startDistance:0,endDistance:200}]};
 const plan=Road.connections(roads,network,{train:{width:12},metro:{width:10}});
 assert(Math.abs(Road.roadHeight(roads[1],0,plan))<1e-9);assert.equal(Road.roadHeight(roads[1],100,plan),-6);
 assert.deepEqual(Road.surfaceRoad(roads[1],plan).points[0],[100,0]);
});
test('mixed rail joins ease both approaches and match every rail head in either drawing direction',()=>{
 for(const reversed of [false,true]){
  const a={id:'a',kind:'train',level:0,points:[[0,0],[100,0]]};
  const b={id:'b',kind:'metro',level:0,points:reversed?[[200,30],[100,0]]:[[100,0],[200,30]]};
  const [left,right]=R.prepare([a,b]),lp=R.layout(left.points),rp=R.layout(right.points);
  assert.deepEqual(left.points.at(-1),[100,0]);
  assert.deepEqual(right.points[reversed?right.points.length-1:0],[100,0]);
  const rightHeads=rp.paths.map(p=>p[reversed?p.length-1:0]);
  for(const p of lp.paths)assert(rightHeads.some(q=>Math.hypot(q[0]-p.at(-1)[0],q[1]-p.at(-1)[1])<1e-8));
  const heading=p=>Math.atan2(p[1][1]-p[0][1],p[1][0]-p[0][0]);
  const la=heading(left.points.slice(-2)),ra=heading(reversed?right.points.slice(-2).reverse():right.points.slice(0,2));
  assert(Math.abs(la-ra)<.04,'shared tangent must not form a kink');
  assert.equal(R.bedMix(left,lp.total,lp.total),.5);
  assert.equal(R.bedMix(right,reversed?rp.total:0,rp.total),.5);
  assert.equal(R.bedMix(left,0,lp.total),0);
  assert.equal(R.bedMix(right,reversed?0:rp.total,rp.total),1);
 }
});
test('an isolated endpoint or a sharp junction is not treated as a continuous rail join',()=>{
 const roads=[{id:'a',kind:'train',points:[[0,0],[100,0]]},{id:'b',kind:'metro',points:[[100,0],[100,100]]}];
 const p=R.prepare(roads);assert(p.every(r=>r.contacts.every(c=>c===null)));
});
test('join appearance is independent of viewport filtering',()=>{
 const roads=[{id:'a',kind:'train',points:[[0,0],[100,0]]},{id:'b',kind:'metro',points:[[100,0],[200,30]]}];
 const all=R.prepare(roads),visible=R.prepare([roads[1]],roads);
 assert.deepEqual(visible[0].points,all[1].points);assert.deepEqual(visible[0].contacts,all[1].contacts);
});
