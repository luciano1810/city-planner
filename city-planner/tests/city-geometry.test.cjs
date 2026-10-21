const test=require('node:test');const assert=require('node:assert/strict');
const {curvePoints,footprintAxis}=require('../renderer/city-geometry.js');
const {buildingMassing,fitBuildingMasses,rectangleInside,polygonArea,containsPoint}=require('../renderer/city-geometry.js');
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

test('regular upper masses stay within tapered and concave footprints and never bridge a courtyard',()=>{
 const footprints=[[[0,0],[65,0],[40,27],[0,27],[0,0]],[[0,0],[60,0],[60,48],[43,48],[43,16],[18,16],[18,48],[0,48],[0,0]],
  [[0,0],[70,0],[70,42],[37,42],[37,11],[35,11],[35,42],[0,42],[0,0]]];
 for(const points of footprints){
  const rects=fitBuildingMasses(points);assert(rects.length>0&&rects.length<=3);
  for(const r of rects){assert(rectangleInside(r,points));assert(Math.min(r[2]-r[0],r[3]-r[1])>=6);assert(Math.max((r[2]-r[0])/(r[3]-r[1]),(r[3]-r[1])/(r[2]-r[0]))<=5.000001);}
  for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
   const a=rects[i],b=rects[j];assert(Math.min(a[2],b[2])-Math.max(a[0],b[0])<1e-6||Math.min(a[3],b[3])-Math.max(a[1],b[1])<1e-6);
  }
 }
 assert(!rectangleInside([5,5,65,35],footprints[2]));
});

test('massing is stable through rotation and reload and does not modify saved geometry or capacity',()=>{
 const outline=[[0,0],[55,0],[48,38],[32,38],[32,19],[18,19],[18,36],[0,36],[0,0]];
 for(const degrees of [0,31,90,166]){
  const radians=degrees*Math.PI/180,points=outline.map(([x,y])=>[2000+x*Math.cos(radians)-y*Math.sin(radians),2300+x*Math.sin(radians)+y*Math.cos(radians)]);
  const p={id:'occupied-court',center:points[0],building:{footprint:points,center:points[0],use:'residential',floors:6,height:19.8,capacity:80,floorArea:6000}};
  const before=JSON.stringify(p),layout=buildingMassing(p);
  assert.equal(JSON.stringify(p),before);assert.deepEqual(layout,buildingMassing(JSON.parse(before)));
  assert(layout.podium);assert(layout.podium.height<layout.volumes[0].height);
  for(const volume of layout.volumes){assert(volume.points.every(pt=>containsPoint(pt,points)));assert(polygonArea(volume.points)>50);}
 }
});

test('low-rise homes, halls and tower setbacks have distinct volumes',()=>{
 const make=(use,floors)=>({center:[20,15],building:{use,floors,height:floors*3.3,footprint:[[0,0],[40,0],[40,30],[0,30],[0,0]],center:[20,15]}});
 assert.equal(buildingMassing(make('residential',2)).type,'house');
 assert.equal(buildingMassing(make('industrial',1)).type,'hall');
 const tower=buildingMassing(make('office',12));assert.equal(tower.type,'tower');assert.equal(tower.volumes.length,2);
 assert(polygonArea(tower.volumes[1].points)<polygonArea(tower.volumes[0].points));
 assert.equal(tower.volumes[1].base,tower.volumes[0].height);
});
