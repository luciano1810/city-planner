const test=require('node:test');
const assert=require('node:assert/strict');
const {Driver}=require('../renderer/simulation-driver.js');
function setup(request=async p=>p){
  let time=0,id=0;const timers=new Map(),delays=new Map(),applied=[],errors=[];
  const driver=new Driver({request,apply:v=>applied.push(v),onError:e=>errors.push(e.message),now:()=>time,
    schedule:(f,delay)=>{timers.set(++id,f);delays.set(id,delay);return id;},cancel:i=>{timers.delete(i);delays.delete(i);}});
  return {driver,timers,applied,errors,setTime:t=>time=t,fire(delay){
    const id=[...delays].find(([,d])=>d===delay)?.[0];assert.notEqual(id,undefined);
    const callback=timers.get(id);timers.delete(id);delays.delete(id);return callback();
  }};
}
test('there is one scheduled loop and speed changes retain elapsed time at the previous rate',async()=>{
  const x=setup();x.driver.start();x.driver.start();assert.equal(x.timers.size,1);
  x.setTime(1000);await x.driver.setSpeed(60,{persist:false});x.setTime(2000);
  await x.driver.tick();assert.equal(x.applied[0].seconds,61);assert.equal(x.applied[0].speed,60);assert.equal(x.applied[0].daylightSeconds,61);
  assert.equal(x.timers.size,1);x.driver.pause();assert.equal(x.timers.size,0);
});
test('pause accepts an already committed response and schedules no additional step',async()=>{
  let finish;const x=setup(p=>new Promise(resolve=>finish=()=>resolve(p)));
  x.driver.start();x.setTime(1000);const tick=x.driver.tick();await Promise.resolve();
  const stopped=x.driver.settle();finish();await tick;await stopped;
  assert.equal(x.applied.length,1);assert.equal(x.applied[0].seconds,1);assert.equal(x.timers.size,0);
});
test('loading another city discards the previous city response',async()=>{
  let finish;const x=setup(p=>new Promise(resolve=>finish=()=>resolve(p)));
  x.driver.start();const tick=x.driver.tick();await Promise.resolve();x.driver.invalidate();
  x.fire(800);assert.equal(x.driver.waiting,false);finish();await tick;
  assert.equal(x.applied.length,0);assert.equal(x.timers.size,0);
});
test('resume never counts paused wall time and settings updates do not advance time',async()=>{
  const x=setup();x.driver.start();x.setTime(1000);await x.driver.tick();await x.driver.pause();
  x.setTime(100000);await x.driver.setSpeed(86400);assert.equal(x.applied.at(-1).seconds,0);
  x.driver.start();await x.driver.tick();assert.equal(x.applied.at(-1).seconds,0);
  x.setTime(100500);await x.driver.tick();assert.equal(x.applied.at(-1).seconds,43200);assert.equal(x.applied.at(-1).daylightSeconds,.5);
  x.driver.pause();
});
test('a failed update stops the driver and reports the failure',async()=>{
  const x=setup(async()=>{throw new Error('offline');});x.driver.start();await x.driver.tick();
  assert.equal(x.driver.running,false);assert.equal(x.timers.size,0);assert.deepEqual(x.errors,['offline']);
});

test('slow settlements show waiting without stopping or issuing duplicate ticks',async()=>{
  let finish,calls=0;const x=setup(p=>{calls++;return new Promise(resolve=>finish=()=>resolve(p));});
  const states=[];x.driver.onState=()=>states.push(x.driver.waiting);
  x.driver.start();x.setTime(1000);const tick=x.fire(0);await Promise.resolve();
  assert.equal(x.driver.waiting,false);x.fire(800);
  assert.equal(x.driver.waiting,true);assert.equal(x.driver.running,true);
  await x.driver.tick();assert.equal(calls,1);assert.equal(x.applied.length,0);
  finish();await tick;
  assert.equal(x.driver.waiting,false);assert.equal(x.driver.running,true);
  assert.deepEqual(states,[false,true,false]);assert.equal(x.timers.size,1);
  x.setTime(2000);const next=x.fire(100);await Promise.resolve();finish();await next;
  assert.equal(calls,2);assert.equal(x.applied.length,2);x.driver.pause();
});

for(const action of ['pause','invalidate','failure'])test(`slow settlement clears waiting after ${action}`,async()=>{
  let finish,fail;const x=setup(p=>new Promise((resolve,reject)=>{finish=()=>resolve(p);fail=reject;}));
  x.driver.start();const tick=x.fire(0);await Promise.resolve();x.fire(800);
  assert.equal(x.driver.waiting,true);
  if(action==='failure')fail(new Error('settlement failed'));
  else{x.driver[action]();finish();}
  await tick;
  assert.equal(x.driver.waiting,false);assert.equal(x.driver.running,false);assert.equal(x.timers.size,0);
  assert.equal(x.applied.length,action==='pause'?1:0);
  assert.deepEqual(x.errors,action==='failure'?['settlement failed']:[]);
});

test('daylight changes rate at one day per second without resetting accumulated time',async()=>{
  const {daylightRate}=require('../renderer/simulation-driver.js');
  for(const speed of [1,2,3,5,60,3600,21600])assert.equal(daylightRate(speed),speed);
  for(const speed of [86400,604800,2592000])assert.equal(daylightRate(speed),1);
  const x=setup();await x.driver.setSpeed(5,{persist:false});x.driver.start();
  x.setTime(1000);await x.driver.setSpeed(86400,{persist:false});x.setTime(2000);
  await x.driver.tick();assert.equal(x.applied[0].seconds,86405);assert.equal(x.applied[0].daylightSeconds,6);
  x.setTime(3000);await x.driver.setSpeed(3,{persist:false});x.setTime(4000);
  await x.driver.tick();assert.equal(x.applied[1].daylightSeconds,4);x.driver.pause();
});

test('partial daily ticks retain unaccepted calendar time without replaying daylight',async()=>{
  const x=setup(async p=>({...p,advancedSeconds:Math.min(p.seconds,86400)}));
  await x.driver.setSpeed(2592000,{persist:false});x.driver.start();x.setTime(10000);
  await x.driver.tick();assert.equal(x.driver.carry,2592000-86400);assert.equal(x.driver.daylightCarry,0);
  await x.driver.tick();assert.equal(x.applied.at(-1).seconds,2592000-86400);
  assert.equal(x.applied.at(-1).daylightSeconds,0);assert.equal(x.driver.carry,2592000-2*86400);
  x.driver.pause();assert.equal(x.driver.carry,0);
});

for(const action of ['pause','invalidate'])test(`partial response does not restore a discarded backlog after ${action}`,async()=>{
  let finish;const x=setup(p=>new Promise(resolve=>finish=()=>resolve({...p,advancedSeconds:0})));
  x.driver.start();x.setTime(1000);const tick=x.driver.tick();await Promise.resolve();
  x.driver[action]();finish();await tick;
  assert.equal(x.driver.carry,0);assert.equal(x.timers.size,0);
});
