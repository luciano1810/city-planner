const test=require('node:test'),assert=require('node:assert/strict');
const {Playback}=require('../renderer/traffic-playback.js');
const car=(x=0,y=0,h=0)=>({id:7,point:[x,y],heading:h,speed:10,road:'a',level:0,state:'moving',progress:x/100});
const traffic=(cars,time)=>({vehicles:cars,mode:'test',motionTime:time,signals:[{phase:'green'}],pedestrians:[]});
const point=(t,x,y=0,h=0,speed=10)=>[t,x,y,h,speed,'a',0,'moving',x/100];
test('renders between response samples and preserves every curved substep',()=>{
  const p=new Playback({now:()=>0,delay:100});p.reset(traffic([car()],0),0);
  p.push(traffic([car(1,1,Math.PI/2)],.1),{start:0,end:.1,tracks:{7:[point(0,0),point(.05,.8,.2,Math.PI/4),point(.1,1,1,Math.PI/2)]}},{now:100});
  const frame=p.frame(165).vehicles[0];
  assert(Math.abs(frame.point[0]-.8)<.001);assert(Math.abs(frame.point[1]-.2)<.001);
  assert(Math.abs(frame.heading-Math.PI/4)<.001);
  const next=p.frame(175).vehicles[0];assert(next.point[0]>.8&&next.point[0]<1);
});
test('never extrapolates beyond a stopped position when requests are delayed',()=>{
  const p=new Playback({now:()=>0});p.reset(traffic([car()],0),0);
  p.push(traffic([{...car(1),speed:0,state:'red'}],.1),{start:0,end:.1,tracks:{7:[point(0,0),point(.1,1,0,0,0)]}},{now:100});
  assert.equal(p.frame(5000).vehicles[0].point[0],1);
  assert.equal(p.frame(6000).vehicles[0].speed,0);
});
test('arrival is played before the vehicle is removed',()=>{
  const p=new Playback({now:()=>0,delay:100});p.reset(traffic([car()],0),0);
  p.push(traffic([],.1),{start:0,end:.1,tracks:{7:[point(0,0),point(.1,1)]},departed:[car(1)]},{now:100});
  assert.equal(p.frame(165).vehicles.length,1);
  assert.equal(p.frame(300).vehicles.length,0);
});
test('phase changes use the same delayed timeline as vehicle trajectories',()=>{
  const p=new Playback({now:()=>0,delay:100});p.reset(traffic([car()],0),0);
  p.push(traffic([car(1)],.1),{start:0,end:.1,tracks:{7:[point(0,0),point(.1,1)]},signals:[[0,[{phase:'green'}]],[.08,[{phase:'yellow'}]]]},{now:100});
  assert.equal(p.frame(165).signals[0].phase,'green');assert.equal(p.frame(205).signals[0].phase,'yellow');
});
test('wraps heading through pi without spinning and freezes exactly on pause',()=>{
  const p=new Playback({now:()=>0,delay:100});p.reset(traffic([car(0,0,3.13)],0),0);
  p.push(traffic([car(1,0,-3.13)],.1),{start:0,end:.1,tracks:{7:[point(0,0,0,3.13),point(.1,1,0,-3.13)]}},{now:100});
  const frame=p.frame(165);assert(Math.abs(frame.vehicles[0].heading-Math.PI)<.01);
  p.setPaused(true);assert.deepEqual(p.frame(10000).vehicles,frame.vehicles);
});
test('reset discards reused IDs and arrival history',()=>{
  const p=new Playback({now:()=>0});p.reset(traffic([car()],1),0);
  p.push(traffic([car(80)],0),null,{reset:true,now:100});assert.equal(p.frame(400).vehicles[0].point[0],80);
});
test('request timestamps keep variable server latency from compressing motion',()=>{
  let now=0;const p=new Playback({now:()=>now,delay:100});p.reset(traffic([car()],0),0);
  p.push(traffic([car(1)],.1),{start:0,end:.1,tracks:{7:[point(0,0),point(.1,1)]}},{time:100,now:1100});
  p.frame(1100);
  p.push(traffic([car(12)],1.2),{start:.1,end:1.2,tracks:{7:[point(.1,1),point(1.2,12)]}},{time:1200,now:1250});
  const first=p.frame(1500).vehicles[0],second=p.frame(1550).vehicles[0];
  assert(second.point[0]-first.point[0]<=.51);
});
test('resume shifts buffered motion without counting the paused wall time',()=>{
  let now=0;const p=new Playback({now:()=>now,delay:100});p.reset(traffic([car()],0),0);
  p.push(traffic([car(1)],.1),{start:0,end:.1,tracks:{7:[point(0,0),point(.1,1)]}},{time:100,now:100});
  now=165;const before=p.frame().vehicles[0];p.setPaused(true);
  now=10000;p.setPaused(false);assert(Math.hypot(...p.frame().vehicles[0].point.map((v,k)=>v-before.point[k]))<1e-10);
});
