const test=require('node:test');const assert=require('node:assert/strict');
const {curvePoints,footprintAxis}=require('../renderer/city-geometry.js');
test('curves retain endpoints, interpolate handles and add true curvature',()=>{
 const controls=[[0,0],[100,100],[200,0]],points=curvePoints(controls);
 assert.deepEqual(points[0],controls[0]);assert.deepEqual(points.at(-1),controls.at(-1));
 assert(points.some(p=>p[0]===100&&p[1]===100));assert(points.length>20);
 assert(points.some(p=>p[0]>0&&p[0]<100&&Math.abs(p[0]-p[1])>1));
 assert.deepEqual(curvePoints(controls,false),controls);
 assert.deepEqual(curvePoints([[0,0],[100,0]]),[[0,0],[100,0]]);
});
test('industrial roof axis follows a stepped footprint, independent of its old entrance',()=>{
 const warehouse=[[0,0],[130,0],[130,35],[95,35],[95,30],[35,30],[35,33],[0,33],[0,0]];
 assert.equal(footprintAxis(warehouse),0);
 assert.equal(footprintAxis(warehouse),0); // Cached renders retain the same axis.
 for(const degrees of [5,31,90,166]){
  const angle=degrees*Math.PI/180;
  const moved=warehouse.map(([x,y])=>[2400+x*Math.cos(angle)-y*Math.sin(angle),2600+x*Math.sin(angle)+y*Math.cos(angle)]);
  assert(Math.abs(footprintAxis(moved)-degrees)<1e-7);
  assert(Math.abs(footprintAxis(moved.slice().reverse())-degrees)<1e-7);
 }
});
test('roof orientation handles short and repeated footprint coordinates',()=>{
 assert.equal(footprintAxis([]),0);
 assert.equal(footprintAxis([[2,3],[2,3]]),0);
 assert.equal(footprintAxis([[2,3],[2,20],[2,3]]),90);
});
