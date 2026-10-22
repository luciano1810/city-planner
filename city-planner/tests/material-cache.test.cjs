const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const raster=require('../renderer/raster-cache.js');

const source=fs.readFileSync(require.resolve('../renderer/scene-renderer.js'),'utf8');
const MiB=1024*1024;

function harness(){
  const calls={requests:[],animations:0,synchronous:0,thumbnailSources:0},canvases=[];
  let jobs;
  function context(image={width:2048,height:2048,draws:[]},scale=64){
    let matrix={a:scale,b:0,c:0,d:scale,e:0,f:0};
    return {canvas:image,
      getTransform:()=>({...matrix}),
      setTransform(a,b,c,d,e,f){matrix={a,b,c,d,e,f};},
      drawImage(source,...args){image.draws.push({source,args});},
      createPattern(image,repeat){return {image,repeat,setTransform(matrix){this.matrix=matrix;}};}
    };
  }
  const document={createElement(tag){
    assert.equal(tag,'canvas');
    const image={width:0,height:0,draws:[]},ctx=context(image,1);
    image.getContext=()=>ctx;canvases.push(image);return image;
  }};
  class Matrix {
    constructor(){this.a=this.d=1;}
    scale(value){this.a*=value;this.d*=value;return this;}
  }
  const window={
    SceneMaterials:{pick:(_name,index=0)=>({index,meters:12,rgb:[120,130,140]})},
    SurfaceVariation:{profile:()=>({factor:2,size:1024})},
    SceneRasterCache:raster,
    SceneMaterialPreparation:{create:()=>({baseTexture(){
      calls.thumbnailSources++;const image=document.createElement('canvas');image.width=image.height=256;return image;
    },texture(){
      calls.synchronous++;throw new Error('Async material lookup must not synthesize on the rendering thread');
    }})},
    SceneMaterialJobs:{create(options){jobs=options;return {
      request(key){calls.requests.push(key);return true;},reset(){},stats:{}
    };}},
    MapWorkspace:{requestAnimation(){calls.animations++;}}
  };
  // Only worker delivery and Canvas bookkeeping are mocked: use the actual
  // scene material lifecycle and bounded LRU, without pixel buffers or a GPU.
  vm.runInNewContext(source,{window,document,DOMMatrix:Matrix,
    Worker:class {},OffscreenCanvas:class {},createImageBitmap:async image=>image});
  function ready(index){
    const image={id:index,width:1024,height:1024,closed:false,close(){this.closed=true;}};
    jobs.onReady(`roof:${index}:field`,image);return image;
  }
  return {scene:window.CityScene,context,ready,calls,canvases};
}

function originalSource(image){
  while(image.draws?.length)image=image.draws.at(-1).source;
  return image;
}

test('thumbnail materials stay textured without requesting or publishing world fields',()=>{
  const {scene,context,ready,calls}=harness(),ctx=scene.useThumbnailMaterials(context());
  const thumbnail=scene.material(ctx,'roof',0);
  assert.equal(thumbnail.image.width,256);assert.equal(thumbnail.image.width*thumbnail.matrix.a,12);
  assert.equal(calls.thumbnailSources,1);
  assert.deepEqual(calls.requests,[]);assert.equal(scene.materialRevision,0);assert.equal(calls.animations,0);
  assert.equal(scene.materialPreparation.entries,0);assert.equal(scene.materialFallbacks.entries,0);
  assert.strictEqual(scene.material(ctx,'roof',0),thumbnail,'reopening a card reuses its pattern');
  const small=scene.material(scene.useThumbnailMaterials(context(undefined,2)),'roof',0);
  assert.equal(small.image.width,32);assert.equal(small.image.width*small.matrix.a,12);
  assert.equal(calls.thumbnailSources,1,'different cards share a small source tile');

  const map=context();scene.material(map,'roof',0);
  assert.deepEqual(calls.requests,['roof:0:field'],'normal map contexts still prepare detailed fields');
  ready(0);scene.commitMaterials();
  assert.equal(scene.material(map,'roof',0).image.width,1024);
  assert.strictEqual(scene.material(ctx,'roof',0),thumbnail,'world publication cannot replace menu patterns');
  assert.equal(calls.synchronous,0,'cards never synthesize expanded fields on the rendering thread');
});

test('thumbnail sources are bounded independently of the map material cache',()=>{
  const {scene,context,calls}=harness(),ctx=scene.useThumbnailMaterials(context());
  const oldest=scene.material(ctx,'roof',0).image;
  for(let i=1;i<=32;i++)scene.material(ctx,'roof',i);
  assert.equal(oldest.width,1,'the 8 MiB thumbnail source cache releases its oldest bitmap');
  assert.equal(calls.thumbnailSources,33);assert.deepEqual(calls.requests,[]);
  assert.equal(scene.materialPreparation.entries,0);assert.equal(scene.materialRevision,0);
});

test('ready material batches publish patterns and object rasters together, without synchronous synthesis',()=>{
  const {scene,context,ready,calls}=harness(),ctx=context(),object={};
  let paints=0;
  const draw=()=>scene.rasterObject(ctx,object,'fixture',[0,0,4,4],2.1,()=>paints++);
  assert.equal(scene.material(ctx,'roof',0),'rgb(120,130,140)');
  assert.deepEqual(calls.requests,['roof:0:field']);
  draw();assert.equal(paints,1);
  const first=ready(0),second=ready(1);
  assert.equal(scene.materialRevision,2);assert.equal(calls.animations,2);
  const unpublished=scene.material(ctx,'roof',0);
  assert.equal(unpublished.image.width,256,'a ready, unpublished field supplies its small texture');
  assert.strictEqual(originalSource(unpublished.image),first);
  draw();assert.equal(paints,1,'individual worker arrivals cannot invalidate the current raster generation');

  scene.commitMaterials();
  const published=scene.material(ctx,'roof',0);
  assert.notStrictEqual(published,unpublished,'publication invalidates existing CanvasPatterns');
  assert.strictEqual(published.image,first);
  assert.strictEqual(scene.material(ctx,'roof',1).image,second,'one commit publishes every ready field in the batch');
  draw();draw();assert.equal(paints,2,'the batch creates only one new object raster generation');
  scene.commitMaterials();draw();
  assert.equal(paints,2,'a commit with no new results leaves cached object rasters intact');
  assert.strictEqual(scene.material(ctx,'roof',0),published);

  ready(2);draw();assert.equal(paints,2);
  assert.strictEqual(scene.material(ctx,'roof',0),published,'a later arrival keeps the active pattern stable');
  scene.commitMaterials();draw();assert.equal(paints,3);
  assert.notStrictEqual(scene.material(ctx,'roof',0),published);
  assert.equal(calls.synchronous,0);
});

test('publication replaces fallback mips with full-field mips at the same world period',()=>{
  const {scene,context,ready,calls}=harness(),ctx=context(undefined,4),image=ready(0);
  const fallback=scene.material(ctx,'roof',0);
  assert.equal(fallback.image.width,128);
  assert.equal(fallback.image.draws[0].source.width,256,'the unpublished mip is sampled from the bounded fallback');
  assert.equal(fallback.image.width*fallback.matrix.a,24);
  scene.commitMaterials();
  const full=scene.material(ctx,'roof',0);
  assert.notStrictEqual(full.image,fallback.image,'publishing a field must discard its old fallback-derived mip');
  assert.equal(full.image.width,128);
  assert.equal(full.image.draws[0].source.width,256);
  assert.equal(full.image.draws[0].source.draws[0].source.width,512,'the replacement uses the full-field mip chain');
  assert.strictEqual(originalSource(full.image),image);
  assert.equal(full.image.width*full.matrix.a,24,'publication cannot change the material scale in metres');
  assert.equal(calls.synchronous,0);
});

test('evicting a full material retains a textured fallback with the correct world scale',()=>{
  const {scene,context,ready,calls}=harness(),ctx=context(),first=ready(0);
  scene.commitMaterials();
  const original=scene.material(ctx,'roof',0);
  assert.strictEqual(original.image,first);assert.equal(original.matrix.a,24/1024);
  for(let i=1;i<=24;i++)ready(i);
  scene.commitMaterials();
  assert.equal(first.closed,true,'the original 4 MiB field really left the 96 MiB LRU');
  assert.equal(scene.materialPreparation.entries,24);
  assert.equal(scene.materialPreparation.bytes,96*MiB);
  const fallback=scene.material(ctx,'roof',0);
  assert.equal(typeof fallback,'object','a revisit must not paint a solid colour while the field is being regenerated');
  assert.equal(fallback.image.width,256);
  assert.strictEqual(originalSource(fallback.image),first,'the retained image contains the previous material, not a placeholder');
  assert.equal(fallback.matrix.a,24/256,'a small retained tile still covers the same world distance');
  assert.equal(fallback.image.width*fallback.matrix.a,original.image.width*original.matrix.a);
  assert.equal(calls.requests.at(-1),'roof:0:field','detail can regenerate without removing the retained texture');
  assert.equal(scene.materialFallbacks.entries,25);
  assert.equal(scene.materialFallbacks.bytes,25*256*256*4);
  assert.equal(calls.synchronous,0);
});

test('retained material fallbacks remain bounded and release their oldest canvas',()=>{
  const {scene,context,ready,calls,canvases}=harness();
  for(let i=0;i<=96;i++)ready(i);
  scene.commitMaterials();
  assert.equal(scene.materialFallbacks.entries,96);
  assert.equal(scene.materialFallbacks.bytes,24*MiB);
  assert.equal(scene.materialFallbacks.budget,24*MiB);
  assert.equal(canvases[0].width,1);assert.equal(canvases[0].height,1,'evicted small textures release their pixel storage');
  assert.equal(scene.materialPreparation.entries,24);
  assert.equal(scene.materialPreparation.bytes,96*MiB);
  const retained=scene.material(context(),'roof',40);
  assert.equal(typeof retained,'object');assert.equal(retained.image.width,256);
  assert.equal(originalSource(retained.image).id,40);
  assert.equal(scene.material(context(),'roof',0),'rgb(120,130,140)','the fallback limit is enforced even after many unique materials');
  assert.equal(calls.synchronous,0);
});

test('an evicted field does not regenerate when its retained texture already meets display density',()=>{
  const {scene,context,ready,calls}=harness();
  for(let i=0;i<=24;i++)ready(i);
  scene.commitMaterials();
  const g={width:900,height:600,scale:.7,left:-100,top:-50};
  for(const left of [-100,-110]){
    scene.setMaterialView({...g,left},2);
    const pattern=scene.material(context(undefined,4),'roof',0);
    assert.equal(pattern.image.width,128);
    assert.equal(originalSource(pattern.image).id,0);
    assert.equal(pattern.matrix.a*pattern.image.width,24);
  }
  assert.deepEqual(calls.requests,[],'changing view cannot promote an already sufficient 256px fallback');
  assert.equal(calls.synchronous,0);
});

test('an over-budget material working set converges once per stable view instead of continually re-expanding',()=>{
  const {scene,context,ready,calls}=harness();
  const g={width:900,height:600,scale:8,left:-100,top:-50};
  scene.setMaterialView(g,2);
  for(let i=0;i<25;i++)scene.material(context(),'roof',i);
  for(let i=0;i<25;i++)ready(i);
  scene.commitMaterials();
  assert.equal(calls.requests.length,25);
  assert.equal(scene.materialPreparation.bytes,96*MiB,'the visible 100 MiB set cannot all fit in the expanded-field LRU');
  for(let pass=0;pass<3;pass++){
    scene.setMaterialView({...g},2);scene.setTime((10+pass)*3600);scene.commitMaterials();
    // Fresh contexts ensure CanvasPattern reuse cannot mask a new request.
    for(let i=0;i<25;i++)assert.equal(typeof scene.material(context(),'roof',i),'object');
  }
  assert.equal(calls.requests.length,25,'unchanged camera and light updates retain already attempted fallbacks');

  scene.setMaterialView({...g,left:g.left-10},2);
  let settled=false;
  for(let pass=0;pass<32;pass++){
    const start=calls.requests.length;
    for(let i=0;i<25;i++)assert.equal(typeof scene.material(context(),'roof',i),'object');
    const requests=calls.requests.slice(start);
    if(!requests.length){settled=true;break;}
    for(const key of requests)ready(Number(key.split(':')[1]));
    scene.commitMaterials();
  }
  assert.equal(settled,true,'even a capacity-sized chain of evictions must stop after each material gets one attempt');
  assert(calls.requests.length>25&&calls.requests.length<=50,'a changed view retries evicted detail within one attempt per needed field');
  for(let i=0;i<25;i++)assert(calls.requests.filter(key=>key===`roof:${i}:field`).length<=2);
  assert.equal(scene.materialPreparation.bytes,96*MiB);
  assert.equal(calls.synchronous,0);
});


test('the fallback budget covers the real catalog and exhausted fallbacks cannot restart a view loop',()=>{
  const {scene,context,ready,calls}=harness(),catalog=require('../renderer/material-catalog.js');
  const variants=Object.keys(catalog.catalog).reduce((count,name)=>count+catalog.count(name),0);
  const g={width:900,height:600,scale:8,left:0,top:0};scene.setMaterialView(g,2);
  for(let i=0;i<variants;i++){scene.material(context(),'roof',i);ready(i);}
  scene.commitMaterials();assert.equal(scene.materialFallbacks.entries,variants);
  assert(scene.materialFallbacks.bytes<=scene.materialFallbacks.budget);
  for(let i=0;i<variants;i++)assert.equal(typeof scene.material(context(),'roof',i),'object');
  assert.equal(calls.requests.length,variants);
  for(let i=variants;i<110;i++){scene.material(context(),'roof',i);ready(i);}
  scene.commitMaterials();const count=calls.requests.length;
  for(let i=0;i<110;i++)scene.material(context(),'roof',i);
  assert.equal(calls.requests.length,count,'even beyond the catalog, a stable view cannot continuously request evicted fields');
});
