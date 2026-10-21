const test=require('node:test');
const assert=require('node:assert/strict');
const {Driver}=require('../renderer/simulation-driver.js');
function setup(request=async p=>p){
  let time=0,id=0;const timers=new Map(),applied=[],errors=[];
  const driver=new Driver({request,apply:v=>applied.push(v),onError:e=>errors.push(e.message),now:()=>time,
    schedule:f=>{timers.set(++id,f);return id;},cancel:i=>timers.delete(i)});
  return {driver,timers,applied,errors,setTime:t=>time=t};
}
test('there is one scheduled loop and speed changes retain elapsed time at the previous rate',async()=>{
  const x=setup();x.driver.start();x.driver.start();assert.equal(x.timers.size,1);
  x.setTime(1000);await x.driver.setSpeed(60,{persist:false});x.setTime(2000);
  await x.driver.tick();assert.equal(x.applied[0].seconds,61);assert.equal(x.applied[0].speed,60);
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
  x.driver.start();const tick=x.driver.tick();await Promise.resolve();x.driver.invalidate();finish();await tick;
  assert.equal(x.applied.length,0);assert.equal(x.timers.size,0);
});
test('resume never counts paused wall time and settings updates do not advance time',async()=>{
  const x=setup();x.driver.start();x.setTime(1000);await x.driver.tick();await x.driver.pause();
  x.setTime(100000);await x.driver.setSpeed(86400);assert.equal(x.applied.at(-1).seconds,0);
  x.driver.start();await x.driver.tick();assert.equal(x.applied.at(-1).seconds,0);
  x.setTime(100500);await x.driver.tick();assert.equal(x.applied.at(-1).seconds,43200);
  x.driver.pause();
});
test('a failed update stops the driver and reports the failure',async()=>{
  const x=setup(async()=>{throw new Error('offline');});x.driver.start();await x.driver.tick();
  assert.equal(x.driver.running,false);assert.equal(x.timers.size,0);assert.deepEqual(x.errors,['offline']);
});
