const test=require('node:test'),assert=require('node:assert/strict');
const overlay=require('../renderer/transit-overlay.js');
const line=(id,points,mode='metro')=>({id,name:id,mode,valid:true,color:id==='A'?'#d12b4b':'#257bc1',stops:['s1','s2'],platforms:{},paths:[{points,direction:0}]});
test('shared rail corridors are separated consistently even with reversed stop orders',()=>{
 const state={lines:[line('A',[[0,0],[50,0],[50,0],[100,0]]),line('B',[[100,0],[50,0],[0,0]])],stops:[]};
 const before=JSON.stringify(state),p=overlay.layout(state,1);
 assert.notEqual(p.routes[0].points[1][1],p.routes[1].points[1][1]);
 assert.equal(p.routes[0].points[1][0],50);assert.equal(p.routes[1].points[1][0],50);
 assert.equal(JSON.stringify(state),before,'display never mutates operational routes');
 const zoom=overlay.layout(state,2);assert.equal(Math.abs(zoom.routes[0].points[1][1])*2,Math.abs(p.routes[0].points[1][1]));
});
test('bus curb geometry and both travel directions stay intact',()=>{
 const a=line('A',[[0,6],[100,6]],'bus');a.curbRouting=true;a.paths.push({points:[[100,-6],[0,-6]],direction:1});
 const plan=overlay.layout({lines:[a],stops:[]},1);assert.deepEqual(plan.routes.map(r=>r.points),a.paths.map(p=>p.points));
});
test('skipped stations have no passenger stop marker and invalid services are absent',()=>{
 const a=line('A',[[0,0],[50,0],[100,0]]);a.stops=['s1','s2','s3'];a.stopPattern={s2:false};const b=line('B',[[0,5],[100,5]]);b.valid=false;
 const plan=overlay.layout({lines:[a,b],stops:[{id:'s1',point:[0,0]},{id:'s2',point:[50,0]},{id:'s3',point:[100,0]}]},1);
 assert.equal(plan.routes.length,1);assert.deepEqual(plan.stations.map(s=>s.stop.id),['s1','s3']);
});
