const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../renderer/building-shapes.js'),G=require('../renderer/city-geometry.js'),R=require('../renderer/ordinary-roofs.js');
const outlines=[[[0,0],[55,0],[42,38],[0,38],[0,0]],[[0,0],[55,0],[55,18],[24,18],[24,38],[0,38],[0,0]],[[0,0],[55,0],[55,38],[36,38],[36,19],[18,19],[18,38],[0,38],[0,0]]];
function parcel(points,id='shape-case',shape){return {id,center:points[0],building:{use:'office',floors:8,height:26.4,capacity:120,footprint:points,visualShape:shape}};}
test('plot variants preserve concave outlines, roof area, equipment containment and saved data across rotations',()=>{
 for(const points of outlines)for(const shape of ['plot-following','plot-bevel','plot-setback'])for(const angle of [0,.54,1.57]){
  const ring=points.map(([x,y])=>[100+x*Math.cos(angle)-y*Math.sin(angle),200+x*Math.sin(angle)+y*Math.cos(angle)]),p=parcel(ring,'shape-case',shape),before=JSON.stringify(p),layout=G.buildingMassing(p);
  assert.equal(layout.shape,shape);assert.deepEqual(layout,G.buildingMassing(JSON.parse(before)));
  for(const v of layout.volumes){
   for(let i=0;i<v.points.length-1;i++)for(const t of [0,.25,.5,.75,1])assert(S.contains(v.points[i].map((n,k)=>n+(v.points[i+1][k]-n)*t),ring));
   if(v.outline){const triangles=S.triangulate(v.outline);assert(Math.abs(triangles.reduce((n,t)=>n+Math.abs(S.area(t)),0)-Math.abs(S.area(v.outline)))<1e-5);}
  }
  for(const roof of R.layout(p))if(roof.volume.outline)for(const u of roof.units)assert(S.fits([u.x-u.w/2,u.y-u.d/2,u.x+u.w/2,u.y+u.d/2],roof.volume.outline));
  assert.equal(JSON.stringify(p),before);
 }
});
test('seeded defaults keep rectangles dominant and reserve curves for a small minority',()=>{
 let regular=0,curved=0,adapted=0;
 for(let i=0;i<500;i++){
  const a=G.buildingMassing(parcel([[0,0],[40,0],[40,35],[0,35],[0,0]],'random-'+i));
  if(!a.shape)regular++;if(['ellipse','rounded'].includes(a.shape))curved++;
  if(G.buildingMassing(parcel(outlines[1],'random-'+i)).shape?.startsWith('plot-'))adapted++;
 }
 assert(regular>350);assert(curved<75);assert(adapted>150&&adapted<300);
});
test('roof fittings cannot bridge a narrow concave notch even if their corners fit',()=>{
 const ring=[[0,0],[10,0],[10,10],[5.1,10],[5.1,3],[4.9,3],[4.9,10],[0,10]];
 assert(!S.fits([2,2,8,8],ring));assert(S.fits([1,1,3,8],ring));
});
