const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../renderer/road-renderer.js');
const types={lane:{width:7,walk:true},street:{width:14,walk:true},avenue:{width:24,walk:true},highway:{width:30,walk:false},motorway:{width:36,walk:false},path:{width:4,walk:true}};
function fixture(a='street',b='street',angle=30,shape='X',rotation=0,level=0){
 const point=degrees=>[500*Math.cos((degrees+rotation)*Math.PI/180),500*Math.sin((degrees+rotation)*Math.PI/180)];
 const roads=[{id:'a',kind:a,points:[point(180),point(0)],level,oneway:false},{id:'b',kind:b,points:[shape==='T'?[0,0]:point(angle+180),point(angle)],level,oneway:false}];
 const approaches=roads.flatMap(r=>(r.id==='b'&&shape==='T'?[1]:[-1,1]).map(direction=>({road:r.id,kind:r.kind,width:types[r.kind].width,level,direction,distance:r.id==='b'&&shape==='T'?0:500,tangent:point(r.id==='a'?(direction>0?0:180):angle+(direction>0?0:180)).map(v=>v/500),incoming:true,outgoing:true})));
 return {roads,network:{junctions:[{id:'j',point:[0,0],approaches,control:'signals',crossings:level===0&&!['highway','motorway'].includes(a)&&!['highway','motorway'].includes(b)}]},roadTypes:types};
}
test('street and larger crossings have finite guides at acute, right and obtuse angles and rotations',()=>{
 for(const a of ['street','avenue','highway','motorway'])for(const b of ['street','avenue','highway','motorway'])for(const angle of [15,30,60,90,120,150,165])for(const rotation of [0,27,90])for(const level of [-1,0,1]){
  const c=fixture(a,b,angle,'X',rotation,level),plan=api.buildPlan(c.roads,c.network,types);
  assert(plan.guides.length>=2&&plan.guides.length<=4,`${a}/${b}/${angle}: a bounded number of readable through guides`);
  for(const g of plan.guides){assert.equal(g.level,level);assert(g.points.flat().every(Number.isFinite));}
 }
});
test('T branch gets curved guides only to allowed exits; one-way departure cannot receive inbound markings',()=>{
 const c=fixture('avenue','street',90,'T'),arm=c.network.junctions[0].approaches.find(a=>a.road==='b');
 arm.laneTurns=[['right']];
 const plan=api.buildPlan(c.roads,c.network,types),branch=plan.guides.filter(g=>g.road==='b');
 assert.equal(branch.length,1);assert.equal(branch[0].turn,'right');assert(branch[0].points.length>2);
 const d=fixture('street','street',90,'T');d.network.junctions[0].approaches.find(a=>a.road==='b').incoming=false;
 assert(!api.buildPlan(d.roads,d.network,types).guides.some(g=>g.road==='b'));
});
test('acute broad corners widen locally while a right-angle corner keeps its original radius',()=>{
 for(const angle of [15,30,45]){
  const c=fixture('street','street',angle),before=JSON.stringify(c.roads),corners=api.junctionCorners(c.network,c.roads);
  assert(corners.some(c=>c.radius>10));
  for(const corner of corners)assert(api.cornerBoundary(corner,'sidewalk').flat().every(Number.isFinite));
  assert.equal(JSON.stringify(c.roads),before);
 }
 const c=fixture('street','street',90);assert(api.junctionCorners(c.network,c.roads).every(c=>c.radius<=6));
});
test('wide T branch clips its far cap and leaves an unconnected endpoint rounded',()=>{
 for(const angle of [30,60,90,150]){
  const c=fixture('lane','motorway',angle,'T'),layout=api.connections(c.roads,c.network,types),surface=api.surfaceRoad(c.roads[1],layout);
  assert(surface.openStart);assert(!surface.openEnd);assert.equal(surface.mouthClips.length,1);
  assert(surface.mouthClips[0].every(p=>p[1]<=-types.lane.width/2+1e-8));
 }
 const c=fixture(),layout=api.connections(c.roads,{junctions:[]},types);assert.equal(api.surfaceRoad(c.roads[0],layout),c.roads[0]);
});
test('pedestrian junction has one aligned zebra, a clipped path, and nearby stop lines',()=>{
 for(const a of ['lane','street','avenue'])for(const angle of [30,60,90,150]){
  const c=fixture(a,'path',angle,'T'),plan=api.buildPlan(c.roads,c.network,types),layout=api.connections(c.roads,c.network,types),path=api.surfaceRoad(c.roads[1],layout);
  assert.equal(plan.crosswalks.length,1);assert(Math.hypot(...plan.crosswalks[0].point)<1e-8);
  assert(plan.stopLines.every(l=>Math.hypot(...l.point)<8));assert.equal(path.mouthClips.length,1);
  const atEdge=path.points.find(p=>p[1]>=types[a].width/2&&p[1]<types[a].width/2+2);
  assert(atEdge&&Math.abs(atEdge[0])<.5,'path turns perpendicular at the zebra');
  assert(path.points.at(-1).every((v,i)=>v===c.roads[1].points.at(-1)[i]));
 }
});
test('near-parallel roads keep markings beyond their long shared pavement',()=>{
 const c=fixture('street','street',2),plan=api.buildPlan(c.roads,c.network,types);
 assert(plan.crosswalks.every(x=>Math.hypot(...x.point)>390));
});
