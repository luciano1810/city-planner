const {test}=require('node:test'),assert=require('node:assert/strict');
const {roadSnap}=require('../renderer/city-geometry.js');
const road=(id,points,level=0,kind='street')=>({id,points,level,kind});
const base=road('a',[[0,0],[100,0]]);
test('screen radius is constant at multiple zooms and projection respects anisotropic scale',()=>{
 for(const sx of [.1,1,10]){
  const r=road('long',[[-10000,0],[10000,0]]);
  assert.deepEqual(roadSnap([0,12/sx],[r],[],{sx}).point,[0,0]);
  assert.equal(roadSnap([0,15/sx],[r],[],{sx}),null);
 }
 const hit=roadSnap([50,40],[road('d',[[0,0],[100,100]])],[],{sx:2,sy:1});
 assert.deepEqual(hit.point,[48,48]);
});
test('endpoints and intersections win over nearby segment projections',()=>{
 assert.equal(roadSnap([6,2],[base],[]).type,'道路端点');
 const b=road('b',[[50,-100],[50,100]]),j={point:[50,0],approaches:[{road:'a',level:0},{road:'b',level:0}]};
 assert.deepEqual(roadSnap([55,2],[base,b],[j]).point,[50,0]);
});
test('layers and transport modes exclude incompatible interiors; bridge endpoints remain available',()=>{
 const bridge={...base,level:1};
 assert.equal(roadSnap([50,2],[bridge],[],{level:0}),null);
 assert.equal(roadSnap([50,2],[base],[],{level:1}).road,'a');
 assert.equal(roadSnap([2,2],[bridge],[],{level:0}).type,'道路端点');
 assert.equal(roadSnap([50,2],[base],[],{kind:'train'}),null);
 assert.equal(roadSnap([50,2],[base],[],{kind:'path'}).type,'道路中段');
 assert.equal(roadSnap([50,2],[base],[],{exclude:'a'}),null);
});
test('underground roads offer the same explicit ground-midspan choice as bridges',()=>{
 assert.equal(roadSnap([50,2],[base],[],{level:-1}).road,'a');
 assert.equal(roadSnap([50,2],[{...base,level:-1}],[],{level:0}),null);
});
