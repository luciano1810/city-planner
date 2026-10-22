const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createHash}=require('node:crypto');
const preparation=require('../renderer/material-preparation.js');
const catalog=require('../renderer/material-catalog.js');
const variation=require('../renderer/surface-variation.js');
const renderer=path.join(__dirname,'../renderer');
const digest=pixels=>createHash('sha256').update(pixels).digest('hex');

// A small pixel transport double. It intentionally does not implement Canvas
// antialiasing/blur: source bytes, atlas calibration and synthesis are checked
// here; native Canvas/OffscreenCanvas raster equivalence is a browser check.
class PixelCanvas{
  constructor(width,height=width){this._width=width;this._height=height;this.data=new Uint8ClampedArray(width*height*4);this.calls=[];this.context=null;}
  get width(){return this._width;}
  set width(value){this._width=value;this.data=new Uint8ClampedArray(this._width*this._height*4);}
  get height(){return this._height;}
  set height(value){this._height=value;this.data=new Uint8ClampedArray(this._width*this._height*4);}
  sample(x,y){const at=(y*this.width+x)*4;return this.data.subarray(at,at+4);}
  getContext(type,options){
    assert.equal(type,'2d');
    if(this.context)return this.context;
    this.contextOptions=options;
    const canvas=this,calls=this.calls;
    const context={canvas,globalAlpha:1,filter:'none',fillStyle:'#000000',strokeStyle:'#000000',lineWidth:1,
      createImageData(w,h){return {width:w,height:h,data:new Uint8ClampedArray(w*h*4)};},
      getImageData(x,y,w,h){assert.deepEqual([x,y,w,h],[0,0,canvas.width,canvas.height]);return {width:w,height:h,data:canvas.data.slice()};},
      putImageData(image,x,y){assert.deepEqual([x,y],[0,0]);assert.equal(image.data.length,canvas.data.length);canvas.data.set(image.data);},
      drawImage(image,...args){
        calls.push(['drawImage',image,...args,this.filter,this.imageSmoothingQuality]);
        const [sx,sy,sw,sh,dx,dy,dw,dh]=args;assert.deepEqual([dx,dy],[0,0]);assert(dw<=canvas.width&&dh<=canvas.height);
        for(let y=0;y<dh;y++)for(let x=0;x<dw;x++)canvas.data.set(image.sample(Math.floor(sx+(x+.5)*sw/dw),Math.floor(sy+(y+.5)*sh/dh)),(y*canvas.width+x)*4);
      },
      fillRect(x,y,w,h){
        calls.push(['fillRect',x,y,w,h,this.fillStyle,this.globalAlpha]);
        if(typeof this.fillStyle!=='string')return;
        let rgb,alpha=1;
        if(this.fillStyle.startsWith('rgba(')){const values=this.fillStyle.slice(5,-1).split(',').map(Number);rgb=values.slice(0,3);alpha=values[3];}
        else if(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(this.fillStyle)){rgb=[1,3,5].map(start=>parseInt(this.fillStyle.slice(start,start+2),16));if(this.fillStyle.length===9)alpha=parseInt(this.fillStyle.slice(7,9),16)/255;}
        else throw new Error('Unhandled test colour '+this.fillStyle);
        alpha*=this.globalAlpha;
        for(let yy=Math.max(0,Math.floor(y));yy<Math.min(canvas.height,Math.ceil(y+h));yy++)for(let xx=Math.max(0,Math.floor(x));xx<Math.min(canvas.width,Math.ceil(x+w));xx++){
          const at=(yy*canvas.width+xx)*4;for(let ch=0;ch<3;ch++)canvas.data[at+ch]=canvas.data[at+ch]*(1-alpha)+rgb[ch]*alpha;canvas.data[at+3]=255;
        }
      },
      beginPath(){calls.push(['beginPath']);},closePath(){calls.push(['closePath']);},
      moveTo(...p){calls.push(['moveTo',...p]);},lineTo(...p){calls.push(['lineTo',...p]);},ellipse(...p){calls.push(['ellipse',...p]);},
      stroke(){calls.push(['stroke',this.strokeStyle,this.lineWidth]);},
      createRadialGradient(...args){const gradient={stops:[],addColorStop(...stop){this.stops.push(stop);}};calls.push(['gradient',...args,gradient]);return gradient;}
    };
    return this.context=context;
  }
  transferToImageBitmap(){return {width:this.width,height:this.height,data:this.data.slice(),closed:false,close(){this.closed=true;}};}
}
function canvasFactory(){const created=[];return {created,canvas:size=>{const c=new PixelCanvas(size);created.push(c);return c;}};}
function atlas(offset=0){return {width:1024,height:1024,sample(x,y){return [(x*7+y*3+offset)&255,(x*5+y*11+offset*2)&255,(x*13+y*17+offset*3)&255,255];},close(){this.closed=true;}};}

// The pre-extraction procedural source, independently expressed from the
// shared module. Preserve RNG advancement and floating-point grouping so a
// moved draw call or changed seed cannot silently change the saved-city look.
function sourceReference(name,variant){
  const cfg=catalog.pick(name,variant),key=`${name}:${cfg.index}:source`;
  let state=2166136261;for(const character of key){state^=character.charCodeAt(0);state=Math.imul(state,16777619);}state>>>=0;
  const next=()=>{state+=0x6d2b79f5;let value=Math.imul(state^state>>>15,1|state);value^=value+Math.imul(value^value>>>7,61|value);return ((value^value>>>14)>>>0)/4294967296;};
  const fields=[4,8,16].map(size=>({size,samples:Array.from({length:size*size},()=>next()-.5)}));
  const sample=(field,x,y)=>{
    const {size,samples}=field,gx=x/256*size,gy=y/256*size,ix=Math.floor(gx),iy=Math.floor(gy);
    const fx=(1-Math.cos((gx-ix)*Math.PI))/2,fy=(1-Math.cos((gy-iy)*Math.PI))/2;
    const at=(a,b)=>samples[(b%size)*size+a%size];
    return (at(ix,iy)*(1-fx)+at(ix+1,iy)*fx)*(1-fy)+(at(ix,iy+1)*(1-fx)+at(ix+1,iy+1)*fx)*fy;
  };
  const paver=name==='paving'||name==='pavingWarm',result=new Uint8ClampedArray(256*256*4);
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){
    const broad=sample(fields[0],x,y)*(name==='grass'?6:name==='asphalt'?4.8:paver?3:14)+sample(fields[1],x,y)*(name==='asphalt'?1.3:name==='grass'?2:paver?1.5:9)+sample(fields[2],x,y)*(name==='asphalt'?.5:name==='grass'||paver?.8:4);
    const noise=(next()-.5)*(name==='asphalt'?4.2:name==='grass'||paver?3:cfg.grain)+broad,at=(y*256+x)*4;
    for(let ch=0;ch<3;ch++)result[at+ch]=cfg.rgb[ch]+noise;result[at+3]=255;
  }
  return result;
}
function fieldSeed(key){let result=2166136261;for(const character of key){result^=character.charCodeAt(0);result=Math.imul(result,16777619);}return result>>>0;}

test('procedural sources preserve seed, palette and byte rounding without retaining outputs',()=>{
  const factory=canvasFactory(),prepare=preparation.create(factory);
  for(const [name,variant] of [['asphalt',-1],['paving',9.8],['pavingWarm',3],['carPaint',17]]){
    const first=prepare.baseTexture(name,variant),second=prepare.baseTexture(name,variant);
    assert.notStrictEqual(first,second,'source ownership stays with each caller');
    assert.equal(digest(first.data),digest(sourceReference(name,variant)),name);
    assert.equal(digest(first.data),digest(second.data),name+' is deterministic');
    assert.equal(first.contextOptions.willReadFrequently,true);
  }
  const prior=factory.created[0],priorDigest=digest(prior.data);prepare.dispose();prepare.dispose();
  assert.equal(digest(prior.data),priorDigest,'dispose does not invalidate a scene-owned result');
  assert.throws(()=>prepare.texture('asphalt'),/disposed/);
  assert.throws(()=>prepare.baseTexture('asphalt'),/disposed/);
});

test('atlas crops, calibration, asphalt grain and changed atlas references match the original pipeline',()=>{
  const sources={roof:atlas(17),ground:atlas(23)},prepare=preparation.create({...canvasFactory(),atlases:sources});
  const result=prepare.baseTexture('roof',6),draw=result.calls.find(c=>c[0]==='drawImage');
  assert.deepEqual(draw.slice(2),[2,2,254,254,0,0,256,256,'none','high']);
  const staging=draw[1];assert(staging instanceof PixelCanvas);assert.equal(staging.contextOptions.willReadFrequently,true);
  assert.deepEqual(staging.calls.find(c=>c[0]==='drawImage').slice(2),[511,255,258,258,0,0,258,258,'none',undefined]);
  assert.deepEqual([staging.width,staging.height],[1,1],'native-pixel staging does not become a second atlas cache');
  const raw=new PixelCanvas(256);raw.getContext('2d').drawImage(sources.roof,513,257,254,254,0,0,256,256);
  const expected=raw.data.slice(),mean=[0,0,0],rgb=catalog.pick('roof',6).rgb;
  for(let i=0;i<expected.length;i+=4)for(let ch=0;ch<3;ch++)mean[ch]+=expected[i+ch]/65536;
  for(let i=0;i<expected.length;i+=4)for(let ch=0;ch<3;ch++)expected[i+ch]=mean[ch]*(1-.78)+rgb[ch]*.78+(expected[i+ch]-mean[ch])*.44;
  for(let i=0;i<expected.length;i+=4)for(let ch=0;ch<3;ch++)expected[i+ch]=expected[i+ch]*(1-.08)+rgb[ch]*.08;
  assert.equal(digest(result.data),digest(expected));
  const road=prepare.baseTexture('asphalt',2),roadDraw=road.calls.find(c=>c[0]==='drawImage');
  assert.deepEqual(roadDraw.slice(2),[514,2,252,252,0,0,256,256,'blur(.65px)',undefined]);
  assert.equal(road.context.filter,'none');
  const aggregate=new PixelCanvas(256);aggregate.getContext('2d').drawImage(sources.ground,514,2,252,252,0,0,256,256);
  const roadExpected=sourceReference('asphalt',2);let luminance=0;
  for(let i=0;i<aggregate.data.length;i+=4)luminance+=(aggregate.data[i]*.2126+aggregate.data[i+1]*.7152+aggregate.data[i+2]*.0722)/65536;
  for(let i=0;i<aggregate.data.length;i+=4){const grain=Math.max(-12,Math.min(12,(aggregate.data[i]*.2126+aggregate.data[i+1]*.7152+aggregate.data[i+2]*.0722-luminance)*.22));for(let ch=0;ch<3;ch++)roadExpected[i+ch]+=grain;}
  assert.equal(digest(road.data),digest(roadExpected));
  sources.roof=atlas(91);assert.notEqual(digest(prepare.baseTexture('roof',6).data),digest(result.data),'an atlas replacement cannot reuse hidden stale source pixels');
  sources.roof.width=sources.roof.height=1254;
  const fractional=prepare.baseTexture('roof',1).calls.find(c=>c[0]==='drawImage');
  assert.deepEqual(fractional.slice(2),[2.5,1,311.5,311.5,0,0,256,256,'none','high'],'half-pixel cell coordinates survive native-pixel staging');
  assert.deepEqual(fractional[1].calls.find(c=>c[0]==='drawImage').slice(2),[312,0,316,315,0,0,316,315,'none',undefined],'only the needed integer pixel rectangle and filter guard are copied');
});

test('expanded fields use the shared sampler and promptly release only their private source',()=>{
  const factory=canvasFactory(),prepare=preparation.create({...factory,atlases:{facade:atlas(7)}});
  for(const [name,variant] of [['asphalt',2],['pavingWarm',5],['facade',13],['carPaint',-1]]){
    const cfg=catalog.pick(name,variant),base=prepare.baseTexture(name,variant),before=digest(base.data),start=factory.created.length;
    const field=prepare.texture(name,variant),profile=variation.profile(name);
    assert.equal(field.width,profile.size);assert.equal(field.height,profile.size);
    const expected=profile.factor===1?base.data:variation.synthesize(base.data,256,name,cfg.index,fieldSeed(`${name}:${cfg.index}:field`),cfg.meters);
    assert.equal(digest(field.data),digest(expected),name);
    assert.equal(digest(base.data),before,'an earlier caller-owned source remains intact');
    const staged=Boolean(catalog.pick(name,variant).atlas&&name==='facade');
    assert.equal(factory.created.length-start,profile.factor===1?1:staged?3:2);
    if(profile.factor!==1)assert.deepEqual([factory.created[start].width,factory.created[start].height],[1,1]);
  }
});

test('fallback drawing preserves grass, gravel, roof, water and marking detail commands',()=>{
  const prepare=preparation.create(canvasFactory());
  const grass=prepare.baseTexture('grass',1);assert.equal(grass.calls.filter(c=>c[0]==='stroke').length,2200);
  const gravel=prepare.baseTexture('gravel');assert.equal(gravel.calls.filter(c=>c[0]==='fillRect').length,1800);
  const roof=prepare.baseTexture('roof');assert.equal(roof.calls.filter(c=>c[0]==='gradient').length,90);assert.equal(roof.calls.filter(c=>c[0]==='stroke').length,10);assert.equal(roof.calls.filter(c=>c[0]==='closePath').length,0);
  const water=prepare.baseTexture('water');assert.equal(water.calls.filter(c=>c[0]==='ellipse').length,75);
  const marking=prepare.baseTexture('markingYellow',-1),marks=marking.calls.filter(c=>c[0]==='fillRect');assert.equal(marks.length,240);assert.equal(marks[0].at(-1),.08+3*.025);assert.equal(marking.context.globalAlpha,1);
  assert.deepEqual(prepare.baseTexture('grass',1).calls,grass.calls,'procedural details consume the same deterministic random sequence');
});

function workerHarness(overrides={}){
  const messages=[],fetches=[],created=[],bitmaps=[];
  const context=vm.createContext({Uint8ClampedArray,Map,Set,console,...overrides});
  context.self=context;
  context.OffscreenCanvas=class extends PixelCanvas{constructor(w,h){super(w,h);created.push(this);}};
  context.fetch=overrides.fetch||(async url=>{fetches.push(url);return {ok:true,blob:async()=>({url})};});
  context.createImageBitmap=overrides.createImageBitmap||(async()=>{const image=atlas(13);bitmaps.push(image);return image;});
  context.postMessage=overrides.postMessage||((message,transfers=[])=>messages.push({message,transfers}));
  context.importScripts=(...files)=>{for(const file of files)vm.runInContext(fs.readFileSync(path.join(renderer,file),'utf8'),context,{filename:file});};
  vm.runInContext(fs.readFileSync(path.join(renderer,'material-worker.js'),'utf8'),context,{filename:'material-worker.js'});
  return {context,messages,fetches,created,bitmaps,send:job=>context.onmessage({data:job})};
}

test('worker shares the browser algorithm, lazily reuses only atlases, and transfers each output',async()=>{
  const worker=workerHarness(),main=preparation.create({...canvasFactory(),atlases:{ground:atlas(13)}});
  const job={id:19,version:8,name:'asphalt',variant:2};
  await worker.send(job);
  const first=worker.messages[0];assert.equal(first.message.error,undefined);
  for(const key of Object.keys(job))assert.equal(first.message[key],job[key]);
  assert.equal(first.transfers.length,1);assert.strictEqual(first.transfers[0],first.message.bitmap);
  assert.equal(digest(first.message.bitmap.data),digest(main.texture('asphalt',2).data));
  assert.deepEqual(worker.fetches,['assets/ground-atlas.png']);assert.equal(worker.bitmaps.length,1);
  assert(worker.created.every(c=>c.width===1&&c.height===1),'neither private sources nor transferred fields retain a backing store');
  const firstHash=digest(first.message.bitmap.data),count=worker.created.length;
  await worker.send({...job,id:20});
  assert.equal(worker.fetches.length,1);assert.equal(worker.created.length-count,2,'repeated jobs never reuse a hidden expanded-texture cache');
  assert.notStrictEqual(worker.messages[1].message.bitmap,first.message.bitmap);assert.equal(digest(first.message.bitmap.data),firstHash);
  await worker.send({id:21,version:8,name:'carPaint',variant:4});assert.equal(worker.fetches.length,1,'materials without an atlas perform no network work');
});

test('worker rejects concurrent work and reports an atlas failure once with the original job metadata',async()=>{
  let release,fetchCount=0;
  const waiting=new Promise(resolve=>{release=resolve;}),worker=workerHarness({fetch:async()=>{fetchCount++;await waiting;return {ok:false,status:503};}});
  const first={id:'first',version:12,name:'roof',variant:0},second={id:'second',version:13,name:'roof',variant:1};
  const rejectedAtlas=atlas(21),active=worker.send(first);await worker.send({...second,atlasName:'roof',atlas:rejectedAtlas});
  assert.equal(fetchCount,1);assert.equal(worker.messages.length,1);assert.equal(worker.messages[0].message.id,second.id);assert.match(worker.messages[0].message.error,/busy/);
  assert.equal(rejectedAtlas.closed,true,'a transferred atlas rejected while busy is released');
  release();await active;
  assert.equal(fetchCount,1,'a failed atlas fetch is not recursively retried');
  const failure=worker.messages[1].message;for(const key of Object.keys(first))assert.equal(failure[key],first[key]);assert.match(failure.error,/roof atlas: HTTP 503/);assert.equal(failure.bitmap,undefined);assert.equal(worker.created.length,0);
  await worker.send({id:25,version:14,name:'carPaint',variant:0});assert(worker.messages[2].message.bitmap,'one failed task does not leave the worker permanently busy');
  await worker.send({id:26,version:14,name:'../unexpected',variant:0});assert.match(worker.messages[3].message.error,/Unknown material/);assert.equal(fetchCount,1);
});

test('transferred atlases support file URLs without fetching and close the old bitmap on replacement',async()=>{
  let fetchCount=0;
  const worker=workerHarness({fetch:async()=>{fetchCount++;throw new Error('file URL fetch must not be used');}});
  const firstAtlas=atlas(17),job={id:31,version:4,name:'roof',variant:6};
  await worker.send({...job,atlasName:'roof',atlas:firstAtlas});
  const first=worker.messages[0].message;assert.equal(first.error,undefined);assert(first.bitmap);assert.equal(firstAtlas.closed,undefined);assert.equal(fetchCount,0);
  const expected=preparation.create({...canvasFactory(),atlases:{roof:atlas(17)}}).texture('roof',6);
  assert.equal(digest(first.bitmap.data),digest(expected.data));
  await worker.send({...job,id:32});assert.equal(worker.messages[1].message.error,undefined);assert.equal(fetchCount,0,'a following task reuses the transferred atlas');
  const replacement=atlas(91);await worker.send({...job,id:33,atlasName:'roof',atlas:replacement});
  assert.equal(worker.messages[2].message.error,undefined);assert.equal(firstAtlas.closed,true);assert.equal(replacement.closed,undefined);
  assert.notEqual(digest(worker.messages[2].message.bitmap.data),digest(first.bitmap.data));
  assert.equal(fetchCount,0);assert.equal(worker.bitmaps.length,0,'received image bitmaps are not decoded a second time');
  const wrong=atlas(4);await worker.send({...job,id:34,atlasName:'ground',atlas:wrong});
  assert.match(worker.messages[3].message.error,/does not match material roof/);assert.equal(wrong.closed,true);assert.equal(replacement.closed,undefined);
  const unlisted=atlas(5);await worker.send({...job,id:35,atlasName:'unexpected',atlas:unlisted});
  assert.match(worker.messages[4].message.error,/does not match material roof/);assert.equal(unlisted.closed,true);assert.equal(fetchCount,0);
});

test('worker closes a result when transfer fails instead of retaining its bitmap',async()=>{
  let abandoned=null;
  const messages=[],worker=workerHarness({postMessage(message){if(message.bitmap){abandoned=message.bitmap;throw new Error('transfer rejected');}messages.push(message);}});
  await worker.send({id:27,version:3,name:'carPaint',variant:0});
  assert.equal(abandoned.closed,true);assert.equal(messages[0].id,27);assert.match(messages[0].error,/transfer rejected/);assert(worker.created.every(c=>c.width===1&&c.height===1));
});

// Native verification for the consolidated browser pass: generate the same
// variant through HTMLCanvas and the Worker after all four atlases load, then
// compare full RGBA buffers for asphalt, roof, facade, pavingWarm, grass, water
// and marking. This catches Canvas/OffscreenCanvas filter, image decode or
// antialiasing differences that the intentionally small test double cannot.
