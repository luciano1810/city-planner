const test=require('node:test'),assert=require('node:assert/strict');
const {laneLayout,invalidLane,html}=require('../renderer/junction-editor.js');
function fixture(oneway=false){
 const roads=[{id:'h',points:[[-200,0],[200,0]],kind:'avenue',oneway},{id:'v',points:[[0,-200],[0,200]],kind:'street',oneway:false}];
 const approaches=roads.flatMap(r=>[-1,1].map(d=>({road:r.id,direction:d,distance:200,tangent:r.id==='h'?[d,0]:[0,d],width:r.id==='h'?24:14,incoming:!r.oneway||d===-1,outgoing:!r.oneway||d===1,availableTurns:['left','straight','right'],laneTurns:r.id==='h'?Array.from({length:oneway?4:2},()=>['left','straight','right']):[['left','straight','right']]})));
 return {roads,junction:{point:[0,0],approaches}};
}
test('each incoming lane has a distinct clickable arrow on its side of the road',()=>{
 for(const oneway of [false,true]){
  const {junction,roads}=fixture(oneway),before=JSON.stringify(junction),layout=laneLayout(junction,roads);
  assert.equal(layout.targets.length,6);
  for(const t of layout.targets){assert(t.x>0&&t.x<800&&t.y>0&&t.y<720);assert(t.turns.length);}
  const west=layout.targets.filter(t=>junction.approaches.filter(a=>a.incoming)[t.index].road==='h'&&t.travel[0]>0);
  assert.equal(west.length,oneway?4:2);
  assert(west.every(t=>t.point[0]<0));
  for(let i=1;i<west.length;i++)assert(west[i].point[1]>west[i-1].point[1]);
  if(oneway)assert(west[0].point[1]<0&&west.at(-1).point[1]>0);
  else assert(west.every(t=>t.point[1]>0));
  assert.equal(JSON.stringify(junction),before);
 }
});
test('validation identifies the lane to reopen without dropping another lane draft',()=>{
 const {junction}=fixture(),arms=junction.approaches,rows=Object.fromEntries(arms.map(a=>[`${a.road}:${a.direction}`,a.laneTurns.map(r=>[...r])]));
 assert.equal(invalidLane(arms,rows),null);
 rows['h:-1'][1]=[];assert.deepEqual(invalidLane(arms,rows),{index:0,lane:1,message:'每条车道至少保留一个通行方向。'});
 rows['h:-1']=[['left'],['right']];assert.equal(invalidLane(arms,rows).index,0);
 rows['h:-1'][1]=['straight','right'];assert.equal(invalidLane(arms,rows),null);
});
test('editor offers one contextual set of direction controls instead of the old entrance list',()=>{
 const {junction,roads}=fixture(),markup=html(junction,roads);
 assert.equal((markup.match(/name="lane-turn"/g)||[]).length,3);
 assert(!markup.includes('<fieldset'));
 assert(markup.includes('junction-lane-targets'));
 assert(markup.includes('id="junction-lane-editor" hidden'));
});
