const test=require('node:test');
const assert=require('node:assert/strict');
const {create,createPanCache}=require('../renderer/frame-scheduler.js');
const roads=require('../renderer/road-renderer.js');
const raster=require('../renderer/raster-cache.js');

test('detail view defaults to texture sprites without opting into WebGL',()=>{
  const scene=require('../renderer/scene-renderer.js');
  assert.equal(scene.settings.renderer,'textures');
  scene.configure({quality:'map'});scene.configure({quality:'high'});
  assert.equal(scene.settings.renderer,'textures');
});
test('raster cache evicts least-used images and releases replaced images within its memory budget',()=>{
  const disposed=[],cache=raster.create({budget:100,limit:3,dispose:v=>disposed.push(v)});
  cache.set('a','A',40);cache.set('b','B',40);assert.equal(cache.get('a'),'A');
  cache.set('c','C',40);assert.equal(cache.get('b'),null);assert.deepEqual(disposed,['B']);
  cache.set('a','A2',20);assert.equal(cache.get('a'),'A2');assert.equal(cache.stats.bytes,60);
  assert.deepEqual(disposed,['B','A']);cache.set('huge','H',101);assert.equal(cache.get('huge'),null);
  cache.clear();assert.equal(cache.stats.bytes,0);assert.equal(cache.stats.entries,0);
});

function clock(){
  let id=0;const callbacks=new Map();
  return {callbacks,schedule:fn=>{callbacks.set(id,fn);return id++;},cancel:id=>callbacks.delete(id),
    frame(){const batch=[...callbacks.values()];callbacks.clear();for(const fn of batch)fn();}};
}
test('input bursts paint once with the latest state, and later frames still paint',()=>{
  const c=clock(),painted=[];let state=0;
  const draw=create(()=>painted.push(state),c.schedule,c.cancel);
  for(let i=0;i<100;i++){state=i;draw.request();}
  assert.equal(c.callbacks.size,1);assert.deepEqual(painted,[]);
  c.frame();assert.deepEqual(painted,[99]);
  state=100;draw.request();c.frame();assert.deepEqual(painted,[99,100]);
});
test('synchronous painting cancels queued work and painting can request another frame',()=>{
  const c=clock();let count=0;
  const draw=create(()=>{count++;if(count===2)draw.request();},c.schedule,c.cancel);
  draw.request();draw.flush();c.frame();assert.equal(count,1);
  draw.request();c.frame();assert.equal(count,2);assert.equal(c.callbacks.size,1);
  c.frame();assert.equal(count,3);
});

test('panning reuses a full-resolution gutter and rejects uncovered or stale views',()=>{
  const painted=[],images=[],drawn=[];
  const cache=createPanCache((ctx,g)=>painted.push(g),{padding:40,budget:1024*1024,createCanvas:()=>{
    const canvas={width:0,height:0,getContext:()=>({setTransform(){},clearRect(){}})};images.push(canvas);return canvas;
  }});
  const g={width:200,height:100,scale:2,left:-80,top:-30},ctx={drawImage:(...args)=>drawn.push(args)};
  assert.equal(cache.draw(ctx,g,2),false);assert.equal(cache.prepare(g,2),true);
  assert.deepEqual(painted[0],{width:280,height:180,scale:2,left:-40,top:10});
  assert.equal(images[0].width,560);assert.equal(images[0].height,360);
  for(const delta of [-40,0,40])assert.equal(cache.draw(ctx,{...g,left:g.left+delta},2),true);
  assert.equal(painted.length,1);assert.deepEqual(drawn.at(-1).slice(1),[0,-40,280,180]);
  for(const changed of [{left:g.left+41},{top:g.top-41},{scale:3},{width:201}])assert.equal(cache.draw(ctx,{...g,...changed},2),false);
  assert.equal(cache.draw(ctx,g,1),false);
  cache.invalidate();assert.equal(cache.draw(ctx,g,2),false);
  cache.prepare({...g,left:-200},2);assert.equal(images.length,1);assert.equal(cache.stats.builds,2);
  assert.equal(cache.prepare({...g,width:4000,height:3000},2),false);
  assert(cache.stats.bytes<=cache.stats.budget);assert.equal(cache.draw(ctx,g,2),false);
});

test('gesture zoom preserves the world anchor and restores exact density after settling',()=>{
  let paints=0;const drawn=[],cache=createPanCache(()=>paints++,{padding:40,createCanvas:()=>({width:0,height:0,getContext:()=>({setTransform(){},clearRect(){}})})});
  const g={width:200,height:100,scale:2,left:-80,top:-30},ctx={drawImage:(...args)=>drawn.push(args)};
  const zoom=(ratio,x=100,y=50)=>({...g,scale:g.scale*ratio,left:x+(g.left-x)*ratio,top:y+(g.top-y)*ratio});
  cache.prepare(g,2);
  for(const ratio of [.85,1.25,1.6]){
    const next=zoom(ratio);assert.equal(cache.draw(ctx,next,2,true),true);
    const [,x,y,width,height]=drawn.at(-1);
    assert(x<=0&&y<=0&&x+width>=g.width&&y+height>=g.height);
    const world=[47,24];
    assert(Math.abs(x+(g.left+40+world[0]*g.scale)*ratio-(next.left+world[0]*next.scale))<1e-9);
    assert(Math.abs(y+(g.top+40+world[1]*g.scale)*ratio-(next.top+world[1]*next.scale))<1e-9);
  }
  assert.equal(paints,1,'gesture frames reuse the existing bitmap');
  assert.equal(cache.draw(ctx,zoom(1.25),2),false,'settled frames need exact density');
  cache.prepare(zoom(1.25),2);assert.equal(cache.draw(ctx,zoom(1.25),2),true);assert.equal(paints,2);
});

test('snapshot composition uses the zoom-copy sampler without changing later layer settings',()=>{
  const cache=createPanCache(()=>{}, {padding:40,createCanvas:()=>({width:0,height:0,getContext:()=>({setTransform(){},clearRect(){}})})});
  const g={width:200,height:100,scale:2,left:-80,top:-30},samples=[];
  const ctx={imageSmoothingEnabled:false,imageSmoothingQuality:'medium',drawImage(){samples.push([this.imageSmoothingEnabled,this.imageSmoothingQuality]);}};
  cache.prepare(g,2);
  assert.equal(cache.draw(ctx,g,2),true);
  const ratio=1.25,zoomed={...g,scale:g.scale*ratio,left:100+(g.left-100)*ratio,top:50+(g.top-50)*ratio};
  assert.equal(cache.draw(ctx,zoomed,2,true),true);
  assert.deepEqual(samples,[[true,'high'],[true,'high']]);
  assert.equal(ctx.imageSmoothingEnabled,false);assert.equal(ctx.imageSmoothingQuality,'medium');
  ctx.drawImage=()=>{throw new Error('context lost');};
  assert.throws(()=>cache.draw(ctx,g,2),/context lost/);
  assert.equal(ctx.imageSmoothingEnabled,false);assert.equal(ctx.imageSmoothingQuality,'medium','an interrupted copy also restores overlay sampling');
});

test('wide high-DPR views shrink their gutter while pan, zoom and tile refinement retain the same world origin',()=>{
  const images=[],coarse=[],fine=[],drawn=[],budget=64*1024*1024;
  const createCanvas=()=>{
    const image={width:0,height:0};
    image.getContext=()=>({canvas:image,setTransform(){},clearRect(){},save(){},restore(){},translate(){},beginPath(){},rect(){},clip(){},drawImage(){}});
    images.push(image);return image;
  };
  const cache=createPanCache((ctx,g)=>fine.push(g),{createCanvas,incremental:true,budget,previewPaint:(ctx,g)=>coarse.push(g)});
  const g={width:2560,height:1440,scale:2,left:-900,top:-500},dpr=2,screen={drawImage:(...args)=>drawn.push(args)};
  assert((g.width+384)*(g.height+384)*dpr*dpr*4>budget,'the former fixed gutter exceeds this display budget');
  assert.equal(cache.prepare(g,dpr,true),true);
  const pad=coarse[0].left-g.left;
  assert(pad>0&&pad<192,'reserve as much gutter as fits instead of disabling the cache');
  assert.equal(pad*dpr,Math.floor(pad*dpr),'reduced padding stays on device pixels');
  assert.equal(images[0].width,(g.width+pad*2)*dpr);assert.equal(images[0].height,(g.height+pad*2)*dpr);
  assert.equal(cache.draw(screen,g,dpr),true);assert.deepEqual(drawn.at(-1).slice(1,3),[-pad,-pad]);
  const delta=Math.ceil(pad)+12,shifted={...g,left:g.left+delta};
  assert.equal(cache.draw(screen,shifted,dpr),false,'crossing the smaller gutter exposes a strip');
  assert.equal(cache.prepare(shifted,dpr,true),true);assert.equal(cache.stats.scrolls,1);
  assert.equal(coarse[1].left,shifted.left+pad);assert.equal(coarse[1].width,delta);
  cache.refine(0);
  const part=fine[0],x=shifted.left+pad+4-part.left,y=shifted.top+pad+4-part.top;
  assert.equal(x%192,0);assert.equal(y%192,0,'tile origins include the actual gutter and device-pixel halo');
  assert(x>=0&&y>=0&&x+part.width-8<=images[0].width/dpr&&y+part.height-8<=images[0].height/dpr);
  assert.equal(cache.draw(screen,shifted,dpr),true);assert.deepEqual(drawn.at(-1).slice(1,3),[-pad,-pad]);
  const ratio=1.2,zoomed={...shifted,scale:shifted.scale*ratio,left:1280+(shifted.left-1280)*ratio,top:720+(shifted.top-720)*ratio};
  assert.equal(cache.draw(screen,zoomed,dpr,true),true);
  assert.equal(drawn.at(-1)[1],zoomed.left-ratio*(shifted.left+pad));
  assert.equal(drawn.at(-1)[2],zoomed.top-ratio*(shifted.top+pad));
  assert(cache.stats.bytes<=budget,'the viewport plus the allocated refinement scratch obey the shared limit');
  assert.equal(cache.prepare({...g,width:3840,height:2160},dpr,true),false,'a viewport exceeding the budget even without a gutter still falls back');
  assert.equal(cache.pending,0);assert.equal(cache.draw(screen,shifted,dpr),false);
  assert(cache.stats.bytes<=budget);
});

test('adaptive gutters still reserve refinement memory when the viewport alone fills the budget',()=>{
  let paints=0;
  const cache=createPanCache(()=>paints++, {incremental:true,previewPaint(){},createCanvas:()=>({width:0,height:0,getContext:()=>({setTransform(){},clearRect(){}})})});
  const g={width:2048,height:2048,scale:2,left:0,top:0};
  assert.equal(cache.prepare(g,2,true),false,'a 64 MiB viewport leaves no room for refinement scratch');
  assert.equal(cache.prepare(g,2,false),false,'a direct first paint also reserves the scratch needed by later material updates');
  const direct=createPanCache(()=>paints++, {incremental:true,createCanvas:()=>({width:0,height:0,getContext:()=>({setTransform(){},clearRect(){}})})});
  assert.equal(direct.prepare(g,2),true,'a cache without progressive painting can still use the exact budget with zero gutter');
  assert.equal(direct.stats.bytes,direct.stats.budget);assert.equal(direct.refresh(),false);
  const moved={...g,left:.25};
  assert.equal(direct.prepare(moved,2),true);assert.equal(paints,2);
  assert.equal(direct.draw({drawImage(){}},moved,2),true,'zero gutter cannot accept a rounded scroll that exposes a fractional edge');
});

test('wide high-DPR distant detail reserves room for later in-place material refresh',()=>{
  const images=[],fine=[];let previews=0;
  const createCanvas=()=>{
    const image={width:0,height:0},ctx={setTransform(){},clearRect(){},save(){},restore(){},beginPath(){},rect(){},clip(){},drawImage(){}};
    image.getContext=()=>ctx;images.push(image);return image;
  };
  const cache=createPanCache((ctx,g)=>fine.push(g),{createCanvas,incremental:true,previewPaint:()=>previews++});
  const g={width:2560,height:1440,scale:.7,left:-900,top:-500};
  assert.equal(cache.prepare(g,2,false),true,'distant detail begins with a direct cached paint');
  assert.equal(fine.length,1);assert.equal(previews,0);
  const pad=fine[0].left-g.left;
  assert(pad>0&&pad<192);assert.equal(images.length,1,'scratch memory is reserved without allocating another viewport');
  assert.equal(cache.refresh(),true,'a paused material arrival can queue tiles instead of forcing a full repaint');
  assert(cache.pending>0);cache.refine(0);
  assert.equal(images.length,2);assert.equal(fine.length,2);assert.equal(previews,0);
  assert.equal(cache.stats.fullPaints,1);assert.equal(cache.stats.builds,1);
  assert(cache.stats.bytes<=cache.stats.budget,'the existing image and newly allocated scratch share the 64 MiB budget');
});

test('zoom beyond snapshot reuse copies existing detail and previews only four exposed strips',()=>{
  const images=[],fine=[],coarse=[],copies=[];
  const createCanvas=()=>{
    const image={width:0,height:0},ctx={canvas:image,setTransform(){},clearRect(){},save(){},restore(){},translate(){},beginPath(){},rect(){},clip(){},drawImage:(...args)=>copies.push({args,operation:ctx.globalCompositeOperation})};
    image.getContext=()=>ctx;images.push(image);return image;
  };
  const cache=createPanCache((ctx,g)=>fine.push(g),{createCanvas,incremental:true,padding:40,tileSize:100,previewPaint:(ctx,g)=>coarse.push(g)});
  const g={width:200,height:100,scale:2,left:-80,top:-30},screen={drawImage(){}};
  cache.prepare(g,2);assert.equal(fine.length,1);assert.equal(cache.stats.fullPaints,1);
  const ratio=.6,next={...g,scale:g.scale*ratio,left:100+(g.left-100)*ratio,top:50+(g.top-50)*ratio};
  assert.equal(cache.draw(screen,next,2,true),false,'this zoom exceeds the old reuse ratio');
  assert.equal(cache.prepare(next,2,true),true);
  assert.equal(images.length,1,'zoom preserves detail in the existing canvas');
  assert.equal(fine.length,1);assert.equal(coarse.length,4);
  assert.equal(cache.stats.fullPaints,1);assert.equal(cache.stats.zoomCopies,1);assert.equal(cache.stats.scrolls,0);
  const copy=copies[0];assert.strictEqual(copy.args[0],images[0]);assert.equal(copy.operation,'copy');
  assert.deepEqual(copy.args.slice(1),[112,72,336,216]);
  const regions=coarse.map(part=>({x:next.left+40-part.left,y:next.top+40-part.top,w:part.width,h:part.height}));
  assert.deepEqual(regions,[{x:0,y:0,w:56,h:180},{x:224,y:0,w:56,h:180},{x:56,y:0,w:168,h:36},{x:56,y:144,w:168,h:36}]);
  assert.equal(regions.reduce((sum,r)=>sum+r.w*r.h,0)+168*108,280*180,'only pixels outside the retained image are painted');
  assert.equal(cache.draw(screen,next,2),true);
  // Zooming back in covers the complete bitmap: no coarse repaint is needed.
  const zoomed={...next,scale:next.scale*2,left:100+(next.left-100)*2,top:50+(next.top-50)*2};
  assert.equal(cache.prepare(zoomed,2,true),true);assert.equal(coarse.length,4);
  assert.equal(cache.stats.fullPaints,1);assert.equal(cache.stats.zoomCopies,2);assert.equal(cache.stats.builds,3);
  assert.equal(images.length,1);assert.equal(cache.pending,6,'stale scale tiles are replaced, not appended');
  cache.refine(0);
  assert.equal(images.length,2,'only the bounded refinement scratch is allocated after zoom');
  assert.equal(fine.at(-1).scale,zoomed.scale);assert.equal(cache.pending,5);
  assert(cache.stats.bytes<=cache.stats.budget);
});

test('zoom cache rejects exposed borders, excessive magnification and content invalidation',()=>{
  const cache=createPanCache(()=>{}, {padding:40,createCanvas:()=>({width:0,height:0,getContext:()=>({setTransform(){},clearRect(){}})})});
  const g={width:200,height:100,scale:2,left:-80,top:-30},ctx={drawImage(){}};cache.prepare(g,2);
  assert.equal(cache.draw(ctx,{...g,scale:1.5,left:190+(g.left-190)*.75,top:g.top*.75},2,true),false,'far-edge anchor exposes left border');
  assert.equal(cache.draw(ctx,{...g,scale:3.3},2,true),false,'do not enlarge a stale density indefinitely');
  assert.equal(cache.draw(ctx,{...g,width:201},2,true),false,'resize requires a new bitmap');
  cache.invalidate();assert.equal(cache.draw(ctx,g,2,true),false,'content changes invalidate even during a gesture');
});

test('a long static pan copies existing pixels and paints only uncovered strips',()=>{
  const painted=[],copies=[];
  const context={setTransform(){},clearRect(){},save(){},restore(){},translate(){},beginPath(){},rect(){},clip(){},drawImage:(...args)=>copies.push(args)};
  const cache=createPanCache((ctx,g)=>painted.push(g),{padding:40,incremental:true,createCanvas:()=>({width:0,height:0,getContext:()=>context})});
  const g={width:200,height:100,scale:2,left:-80,top:-30};cache.prepare(g,2);
  const next={...g,left:g.left-54.125,top:g.top+45.125};
  assert.equal(cache.draw(context,next,2),false);cache.prepare(next,2);
  assert.equal(copies.length,1);assert.deepEqual(copies[0].slice(1),[-108,90],'scroll to device-pixel boundaries');
  assert.equal(painted.length,3);assert.equal(cache.stats.scrolls,1);
  const [vertical,horizontal]=painted.slice(1);
  assert.deepEqual([vertical.width,vertical.height],[54,180]);
  assert.deepEqual([horizontal.width,horizontal.height],[226,45]);
  assert.equal(vertical.left+226,g.left-54+40,'strip geometry keeps its world origin');
  assert.equal(horizontal.top,g.top+45+40);
  assert.equal(cache.draw(context,next,2),true,'fractional input is compensated at composition time');
  assert(vertical.width*vertical.height+horizontal.width*horizontal.height<280*180/2);
  cache.invalidate();cache.prepare(next,2);
  assert.equal(painted.length,4);assert.equal(painted.at(-1).width,280,'edited content repaints the whole cache');
});

test('a cold zoom refines bounded tiles at the original world coordinates within one bitmap budget',()=>{
  const images=[],coarse=[],fine=[],copies=[];let elapsed=0;
  const createCanvas=()=>{
    const image={width:0,height:0};
    image.getContext=()=>({canvas:image,setTransform(){},clearRect(){},save(){},restore(){},beginPath(){},rect(){},clip(){},drawImage:(...args)=>copies.push(args)});
    images.push(image);return image;
  };
  const cache=createPanCache((ctx,g)=>{fine.push({g,canvas:ctx.canvas});elapsed+=5;},{createCanvas,padding:40,tileSize:100,budget:1024*1024,previewPaint:(ctx,g)=>coarse.push(g),now:()=>elapsed});
  const g={width:200,height:100,scale:2,left:-80,top:-30};
  cache.prepare(g,2,true);assert.equal(coarse.length,1);assert.equal(fine.length,0);assert.equal(cache.pending,6);
  assert.equal(cache.refine(4),true);assert.equal(fine.length,1,'one completed tile may exhaust the frame budget');
  assert.equal(cache.pending,5);
  while(cache.pending)cache.refine(4);
  assert.equal(images.length,2,'one viewport and one small scratch image, no per-frame canvases');
  assert.equal(cache.stats.refinements,6);assert.equal(cache.stats.bytes,(560*360+216*216)*4);
  assert(cache.stats.bytes<=cache.stats.budget);
  let area=0;const regions=[];
  for(const {g:part,canvas} of fine){
    assert.strictEqual(canvas,images[1],'detail raster visibility is bounded by the small tile canvas');
    assert.equal(part.scale,g.scale);
    const x=g.left+40+4-part.left,y=g.top+40+4-part.top,w=part.width-8,h=part.height-8;
    assert(x>=0&&y>=0&&x+w<=280&&y+h<=180);
    assert(copies.some(args=>args[0]===images[1]&&args[1]===8&&args[2]===8&&args[5]===x&&args[6]===y&&args[7]===w&&args[8]===h),'copy only the world-aligned core, leaving an eight-device-pixel blur halo');
    regions.push({x,y,w,h});area+=w*h;
  }
  assert.equal(area,280*180,'every preview pixel is eventually replaced');
  for(let i=0;i<regions.length;i++)for(let j=i+1;j<regions.length;j++){
    const a=regions[i],b=regions[j];assert(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,'refinement tiles never overlap');
  }
  assert.equal(cache.refine(),false);
  assert.equal(cache.refresh(),true);assert.equal(cache.pending,6);
  assert.equal(cache.refresh(),false,'another clock tick cannot restart an unfinished light refresh');
  assert.equal(coarse.length,1,'a light-only refresh keeps the precise bitmap instead of painting preview again');
});

test('viewport edits cancel stale refinement and reserve scratch memory inside the cache budget',()=>{
  const fine=[],createCanvas=()=>({width:0,height:0,getContext:()=>({setTransform(){},clearRect(){},save(){},restore(){},beginPath(){},rect(){},clip(){},drawImage(){}})});
  const cache=createPanCache((ctx,g)=>fine.push(g),{createCanvas,padding:0,tileSize:100,budget:100000,previewPaint(){}});
  const g={width:100,height:100,scale:2,left:-80,top:-30};
  assert.equal(cache.prepare(g,1,true),true);assert.equal(cache.pending,1);
  cache.invalidate();assert.equal(cache.refine(),false);assert.equal(fine.length,0);
  cache.prepare(g,1,true);
  const next={...g,scale:3,left:-180};cache.prepare(next,1,true);cache.refine();
  assert.equal(fine.length,1);assert.equal(fine[0].scale,3);assert.equal(fine[0].left,-172,'world origin includes the blur halo');
  assert.equal(cache.prepare({...g,width:150},1,true),false,'the scratch image counts toward the same budget');
  assert.equal(cache.pending,0);assert(cache.stats.bytes<=cache.stats.budget);
  assert.equal(cache.prepare({...g,width:150},1,false),true,'a precise bake does not need scratch memory');
  assert(cache.stats.bytes<=cache.stats.budget);
});

test('newly exposed pan strips defer cold detail and cancel stale tile locations before refinement',()=>{
  const fine=[],coarse=[],ctx={setTransform(){},clearRect(){},save(){},restore(){},translate(){},beginPath(){},rect(){},clip(){},drawImage(){}};
  const cache=createPanCache((ctx,g)=>fine.push(g),{incremental:true,padding:40,tileSize:100,previewPaint:(ctx,g)=>coarse.push(g),createCanvas:()=>({width:0,height:0,getContext:()=>ctx})});
  const g={width:200,height:100,scale:2,left:-80,top:-30};cache.prepare(g,2);
  const shifted={...g,left:-140,top:-45};cache.prepare(shifted,2,true);
  assert.equal(fine.length,1,'crossing the gutter cannot synchronously rasterize cold roofs');
  assert.equal(coarse.length,2);assert.equal(cache.stats.scrolls,1);assert.equal(cache.pending,6);
  const next={...shifted,left:-200};cache.prepare(next,2,true);
  assert.equal(cache.pending,6,'another pan replaces old tile positions instead of growing a queue');
  while(cache.pending)cache.refine();
  const coreOrigins=fine.slice(1).map(part=>next.left+40+4-part.left);
  assert(coreOrigins.every(x=>[0,100,200].includes(x)),'all refined tiles belong to the latest pan, including its blur halo');
});

test('refinement edges stay on device pixels at fractional display density',()=>{
  const parts=[],dpr=4/3;
  const cache=createPanCache((ctx,g)=>parts.push(g),{padding:17,tileSize:100,previewPaint(){},createCanvas:()=>({width:0,height:0,getContext:()=>({setTransform(){},clearRect(){},save(){},restore(){},beginPath(){},rect(){},clip(){},drawImage(){}})})});
  const g={width:233,height:151,scale:2,left:-19.7,top:-6.3};cache.prepare(g,dpr,true);
  while(cache.pending)cache.refine();
  const integral=n=>Math.abs(n-Math.round(n))<1e-8;
  for(const part of parts){
    assert(integral((g.left+17-part.left)*dpr)&&integral((g.top+17-part.top)*dpr));
    assert(integral(part.width*dpr)&&integral(part.height*dpr));
  }
  assert.equal(Math.round(parts.reduce((area,part)=>area+(part.width*dpr-16)*(part.height*dpr-16),0)),Math.ceil((233+34)*dpr)*Math.ceil((151+34)*dpr));
});

test('offscreen building sprites never evict visible sprites and zoom buckets do not overallocate',()=>{
  const scene=require('../renderer/scene-renderer.js'),oldDocument=global.document,images=[];
  global.document={createElement:()=>{const image={width:0,height:0,getContext:()=>({setTransform(){}})};images.push(image);return image;}};
  try{
    let paints=0,blits=0;const matrix={a:4.2,b:0,c:0,d:4.2,e:0,f:0};
    const ctx={canvas:{width:300,height:300},getTransform:()=>matrix,drawImage:()=>blits++};
    const object={},paint=()=>paints++;
    scene.rasterObject(ctx,object,'regression',[0,0,20,20],2.1,paint);
    assert.equal(paints,1);const density=images[0].width/20;
    assert(density>=4.2);assert(density<=4.2*Math.SQRT2);
    matrix.e=-60;scene.rasterObject(ctx,object,'regression',[0,0,20,20],2.1,paint);
    assert.equal(paints,1);assert.equal(blits,2);
    matrix.e=301;scene.rasterObject(ctx,{},'regression',[0,0,20,20],2.1,paint);
    matrix.e=-85;scene.rasterObject(ctx,{},'regression',[0,0,20,20],2.1,paint);
    assert.equal(paints,1);assert.equal(blits,2);
    matrix.e=0;scene.rasterObject(ctx,{},'regression',[0,0,20,20],2.1,paint);
    assert.equal(paints,2);
  }finally{if(oldDocument===undefined)delete global.document;else global.document=oldDocument;}
});
test('bridge and tunnel projection retains exact geometry and isolates snapshot caches',()=>{
  for(const level of [-1,1]){
    const road={id:'r',level,points:[[0,0],[30,10],[100,20]]};
    const layout={ramps:new Map([['r',[{distance:0,flat:5}]]]),surfaces:new Map(),joins:[]};
    const points=[[0,1],[30,11],[100,21]],length=points.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-points[i][0],p[1]-points[i][1]),0);
    const distances=[0,Math.hypot(30,10),length];for(let d=0;d<length;d+=3)distances.push(d);
    const expected=[...new Set(distances)].sort((a,b)=>a-b).map(d=>roads.projectPoint(roads.sample(points,d).point,road,layout));
    const actual=roads.projectPath(points,road,layout);
    assert.deepEqual(actual,expected);assert.strictEqual(roads.projectPath(points,road,layout),actual);
    const next={ramps:new Map(),surfaces:new Map(),joins:[]};
    assert.notDeepEqual(roads.projectPath(points,road,next),actual);
    assert.notStrictEqual(roads.projectPath(points,{...road},layout),actual);
    assert.notStrictEqual(roads.projectPath(points.map(p=>p.slice()),road,layout),actual);
    assert.strictEqual(roads.projectPath(points,{...road,level:0},layout),points);
  }
});

test('large road plans allocate curb detail only in the viewport and cap the cache while panning',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),root={CityScene:{effectiveQuality:'high',roadSurfaces(){},material(){return '#ddd';}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../renderer/road-renderer.js'),'utf8'),{window:root});
  const api=root.RoadRenderer,roads=Array.from({length:111},(_,i)=>({id:'long-'+i,kind:'street',level:0,points:[[0,i*50],[6000,i*50]]})),network={junctions:[],edges:[]},roadTypes={street:{width:14,walk:true}},state={roads,network,roadTypes};
  const plan=api.buildPlan(roads,network,roadTypes);
  assert.equal(plan.curbRoads.length,111);assert.equal(api.detailStats.curbSections,0);
  assert(plan.curbRoads.every(road=>road.runs.length===1&&!road.runs[0].joints),'continuous plans must not preallocate sub-metre joints');
  const matrix={a:.4,b:0,c:0,d:.4,e:0,f:0},ctx=new Proxy({canvas:{width:1600,height:1200},getTransform:()=>matrix},{get:(target,key)=>target[key]||(()=>{}),set:(target,key,value)=>(target[key]=value,true)});
  const paint=scale=>api.paint(ctx,state,{scale,stage:'surface',levels:[0],inView:()=>true});
  paint(.2);assert.equal(api.detailStats.curbBuilds,0,'map zoom must not build invisible fine detail');assert.equal(api.detailStats.surfaceBuilds,0);
  matrix.a=matrix.d=27;matrix.e=800-3000*27;matrix.f=600-2750*27;
  paint(4);assert.equal(api.detailStats.surfaceBuilds,0,'small asphalt shapes wait for street closeups');
  paint(13.5);assert(api.detailStats.surfaceSections>0);
  assert(api.detailStats.curbSections>0&&api.detailStats.curbSections<=8,'a close viewport should only materialize its few 32 m pieces');
  const builds=api.detailStats.curbBuilds,surfaceBuilds=api.detailStats.surfaceBuilds;paint(13.5);assert.equal(api.detailStats.curbBuilds,builds,'an unchanged view must reuse its geometry');assert.equal(api.detailStats.surfaceBuilds,surfaceBuilds,'an unchanged view must reuse its asphalt paths');
  for(let i=0;i<120;i++){matrix.e=800-(100+i%30*190)*27;matrix.f=600-(30+Math.floor(i/30))*50*27;paint(13.5);}
  assert(api.detailStats.curbBuilds>api.detailStats.curbSectionLimit,'panning must exercise eviction');
  assert(api.detailStats.curbSections<=api.detailStats.curbSectionLimit);
  assert(api.detailStats.surfaceSections<=api.detailStats.curbSections,'asphalt shapes share the existing bounded curb cache');
  const gridRoads=Array.from({length:12},(_,i)=>[
    {id:'h'+i,kind:'street',level:0,points:[[0,(i+1)*100],[1400,(i+1)*100]]},
    {id:'v'+i,kind:'street',level:0,points:[[(i+1)*100,0],[(i+1)*100,1400]]}]).flat(),junctions=[];
  for(let y=1;y<=12;y++)for(let x=1;x<=12;x++)junctions.push({id:x+':'+y,point:[x*100,y*100],approaches:[['h'+(y-1),x*100,[1,0]],['v'+(x-1),y*100,[0,1]]].flatMap(([road,distance,tangent])=>[-1,1].map(direction=>({road,distance,direction,tangent:tangent.map(v=>v*direction),kind:'street',level:0,width:14,incoming:true,outgoing:true}))),control:'priority',crossings:false});
  const gridState={roads:gridRoads,network:{junctions,edges:[]},roadTypes},paintGrid=scale=>api.paint(ctx,gridState,{scale,stage:'surface',levels:[0],inView:()=>true});
  matrix.a=matrix.d=.4;matrix.e=matrix.f=0;paintGrid(.2);assert.equal(api.detailStats.cornerBuilds,0,'map zoom must not precompute every corner decoration');
  matrix.a=matrix.d=27;matrix.e=800-600*27;matrix.f=600-600*27;paintGrid(13.5);
  assert(api.detailStats.cornerDetails>0&&api.detailStats.cornerDetails<=4,'corner detail must use the viewport too');
  for(const j of junctions){matrix.e=800-j.point[0]*27;matrix.f=600-j.point[1]*27;paintGrid(13.5);}
  assert(api.detailStats.cornerBuilds>api.detailStats.cornerDetailLimit);assert(api.detailStats.cornerDetails<=api.detailStats.cornerDetailLimit);
});
