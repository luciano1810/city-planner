const {test}=require('node:test');
const assert=require('node:assert/strict');
const {snap}=require('../renderer/bus-geometry.js');
const types={street:{width:14},avenue:{width:24},path:{width:4}};
const road={id:'main',kind:'street',points:[[0,0],[1000,0]]};
test('arbitrary longitudinal placement and both curbs',()=>{
 const right=snap([325.123,10],[road],types),left=snap([325.123,-10],[road],types);
 assert(Math.abs(right.anchor[0]-325.123)<1e-8);assert.equal(right.side,1);assert.equal(left.side,-1);
 assert.equal(right.point[1],7.8);assert.equal(left.point[1],-7.8);assert.equal(right.road,'main');
});
test('curved road segments, road widths and pixel-aware hit radius',()=>{
 const curve={id:'curve',kind:'avenue',points:[[0,0],[100,0],[180,80]]};
 const p=snap([130,55],[curve],types);assert(p);assert.equal(p.road,'curve');assert(p.anchor[0]>100);assert(p.heading>0);
 assert.equal(snap([400,35],[road],types,{sx:2}),null);
 assert.equal(snap([400,200],[road],types,{sx:.01}),null);
});
test('no snapping to pedestrian or rail networks and no input mutations',()=>{
 const original=JSON.stringify(road);assert.equal(snap([100,1],[{...road,kind:'path'},{...road,kind:'train'}],types),null);
 snap([200,10],[road],types);assert.equal(JSON.stringify(road),original);
});
test('road endpoints and nearest curb stay inside source polyline bounds',()=>{
 const p=snap([-2,9],[road],types);assert.deepEqual(p.anchor,[0,0]);assert.equal(p.side,1);
 assert.equal(snap(null,[road],types),null);
});
