const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../renderer/material-jobs.js');
function fixture(){
  const sent=[],ready=[],errors=[],worker={postMessage:m=>sent.push(m),terminate(){this.terminated=true;}};
  const jobs=create({workerFactory:()=>worker,onReady:(key,bitmap)=>ready.push({key,bitmap}),onError:error=>errors.push(error)});
  const bitmap=()=>({closed:false,close(){this.closed=true;}});
  const reply=(message=sent.at(-1),image=bitmap())=>{worker.onmessage({data:{...message,bitmap:image}});return image;};
  return {worker,sent,ready,errors,jobs,bitmap,reply};
}
test('material jobs deduplicate repeated frame requests and transfer one result at a time',()=>{
  const f=fixture();for(let i=0;i<20;i++){f.jobs.request('road',{name:'asphalt',variant:0});f.jobs.request('roof',{name:'roof',variant:3});}
  assert.equal(f.sent.length,1);assert.equal(f.jobs.stats.pending,2);
  f.reply();assert.equal(f.sent.length,2);assert.equal(f.ready[0].key,'road');
  f.reply();assert.equal(f.jobs.stats.pending,0);assert.equal(f.jobs.stats.completed,2);
});
test('an atlas change disposes stale transfers without publishing an old texture',()=>{
  const f=fixture();f.jobs.request('road',{name:'asphalt'});const stale=f.sent[0];
  f.jobs.reset();f.jobs.request('road',{name:'asphalt'});const image=f.reply(stale);
  assert(image.closed);assert.equal(f.ready.length,0);assert.equal(f.sent.length,2);
  f.reply();assert.equal(f.ready.length,1);assert.equal(f.jobs.stats.pending,0);
  const late=f.bitmap();f.worker.onmessage({data:{...stale,bitmap:late}});assert(late.closed);
});
test('a failed material can use the synchronous fallback without re-enqueueing forever',()=>{
  const f=fixture();f.jobs.request('bad',{name:'roof'});f.jobs.request('good',{name:'asphalt'});
  f.worker.onmessage({data:{...f.sent[0],error:'decode failed'}});
  assert.equal(f.jobs.request('bad',{name:'roof'}),false);assert.equal(f.sent.length,2);
  f.reply();assert.equal(f.jobs.stats.errors,1);assert.equal(f.ready[0].key,'good');
  f.worker.onerror({message:'worker stopped'});assert(f.worker.terminated);
  assert.equal(f.jobs.request('new',{name:'grass'}),false);assert.equal(f.jobs.stats.pending,0);
});

test('decoded atlas transfers wait outside painting and are closed if the scene is disposed',async()=>{
  const sent=[],worker={postMessage:(...args)=>sent.push(args),terminate(){}},bitmap={closed:false,close(){this.closed=true;}};
  let resolve;
  const jobs=create({workerFactory:()=>worker,prepareJob:()=>new Promise(done=>{resolve=done;})});
  jobs.request('road',{name:'asphalt'});await Promise.resolve();
  assert.equal(sent.length,0);assert.equal(jobs.stats.pending,1);
  resolve({data:{atlasName:'ground',atlas:bitmap},transfer:[bitmap]});await new Promise(setImmediate);
  assert.equal(sent.length,1);assert.strictEqual(sent[0][0].atlas,bitmap);assert.deepEqual(sent[0][1],[bitmap]);
  worker.onmessage({data:{...sent[0][0],bitmap:{close(){}}}});
  jobs.request('roof',{name:'roof'});await Promise.resolve();jobs.dispose();
  resolve({data:{atlasName:'roof',atlas:bitmap},transfer:[bitmap]});await new Promise(setImmediate);
  assert(bitmap.closed);assert.equal(sent.length,1,'a disposed scene must not transfer another atlas');
});
