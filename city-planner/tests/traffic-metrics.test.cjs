const test=require('node:test');
const assert=require('node:assert/strict');
const metrics=require('../renderer/traffic-metrics.js');

test('missing periods are unknown, while explicit zero is free flowing',()=>{
  const edge={traffic:30,ratio:.5};
  assert.deepEqual(metrics.metric(edge),{hourly:30,ratio:.5,vehicles:null});
  assert.equal(metrics.summarize([edge],'am').hourly,null);
  assert.equal(metrics.color(metrics.metric(edge,'am')),'#a2aaa9');
  const empty={trafficPeriods:{am:{hourly:0,ratio:0,vehicles:0}}};
  assert.equal(metrics.status(metrics.metric(empty,'am').ratio),'畅通');
  assert.equal(metrics.summarize([empty],'am').hourly,0);
});
test('road summaries use segment maxima rather than double counting vehicles',()=>{
  const edges=[20,60].map(hourly=>({trafficPeriods:{am:{hourly,ratio:hourly/50,vehicles:hourly*2}}}));
  assert.deepEqual(metrics.summarize(edges,'am'),{hourly:60,ratio:1.2,vehicles:120});
  assert.equal(metrics.status(1),'接近容量');
  assert.equal(metrics.status(1.01),'超载');
  assert.equal(metrics.status(.6),'畅通');
});
test('off-peak remains a count without an invented hourly rate or congestion ratio',()=>{
  const edge={trafficPeriods:{off:{vehicles:48,hourly:null,ratio:null}}};
  assert.deepEqual(metrics.summarize([edge],'off'),{vehicles:48,hourly:null,ratio:null});
  assert.notEqual(metrics.color(metrics.metric(edge,'off'),'off',48),metrics.color({vehicles:0},'off',48));
});
test('performance uses terrain-adjusted free time, congestion and the slow direction signal delay',()=>{
  const cfg={speed:60,capacity:1000};
  const edge={length:1000,freeTime:2,time:3.2,terrainCapacity:.8,signalCapacityFactor:.5,
    signalDelayForward:.5,signalDelayReverse:1,trafficPeriods:{am:{hourly:200,ratio:.5}}};
  const peak=metrics.performance(edge,cfg);
  assert.equal(peak.capacity,400);
  assert.equal(peak.minutes,4.2);
  assert.equal(peak.speed,60/4.2);
  assert.ok(Math.abs(peak.delay-132)<1e-8);
  const am=metrics.performance(edge,cfg,'am');
  assert.equal(am.minutes,3.3);
  assert.equal(metrics.roadValue(edge,cfg,'congestion','am'),50);
  assert.equal(metrics.performance({...edge,oneway:true},cfg).minutes,3.7);
  assert.equal(metrics.performance(edge,cfg,'off').speed,null);
  assert.equal(metrics.performance({...edge,trafficPeriods:undefined},cfg,'am').delay,null);
});
test('commute views exclude missing values and expose failed households separately',()=>{
  const state={parcels:[{id:'a',commuteStats:{count:2,failed:1,mean:30}},{id:'b',commuteStats:{count:0,failed:0,mean:null}}]};
  assert.deepEqual(metrics.commutes(state).get('a'),{count:2,failed:1,mean:30});
  assert.equal(metrics.parcelValue({id:'b'},state,'commute'),null);
  assert.equal(metrics.parcelValue({connected:false},state,'connectivity'),0);
  assert.equal(metrics.parcelValue({},state,'connectivity'),null);
  assert.equal(metrics.parcelValue({publicJobs:0},state,'publicAccess'),0);
  assert.equal(metrics.parcelValue({},state,'publicAccess'),null);
});
test('station activity keeps zero and missing distinct, and legends agree with thresholds',()=>{
  assert.equal(metrics.stopActivity({boardings:0,alightings:0}),0);
  assert.equal(metrics.stopActivity({boardings:50,alightings:30}),80);
  assert.equal(metrics.stopActivity({boardings:50}),null);
  assert.equal(metrics.viewColor('speed',14),'#b75b47');
  assert.equal(metrics.viewColor('speed',30),'#6e956c');
  assert.equal(metrics.viewColor('delay',61),'#b75b47');
  assert.equal(metrics.viewColor('commute',60),'#c8934d');
  assert.equal(metrics.viewColor('transitLoad',101),'#b75b47');
  assert.match(metrics.availability({lines:[]},'transitLoad'),/尚无/);
});
