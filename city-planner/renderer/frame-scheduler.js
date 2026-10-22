/* Coalesce painting only: input state and simulation updates remain immediate. */
(function(root){
  'use strict';
  function create(paint,schedule=callback=>requestAnimationFrame(callback),cancel=id=>cancelAnimationFrame(id)){
    let pending=null;
    function request(){
      if(pending!==null)return;
      pending=schedule(()=>{pending=null;paint();});
    }
    function flush(){
      if(pending!==null){cancel(pending);pending=null;}
      paint();
    }
    return {request,flush};
  }
  // One device-resolution image with a gutter, never a history of viewports.
  // The caller invalidates it whenever scene content or display settings change.
  function createPanCache(paint,{createCanvas=()=>document.createElement('canvas'),budget=64*1024*1024,padding=192,incremental=false,previewPaint=null,tileSize=192,tileHalo=8,now=()=>performance.now()}={}){
    let canvas=null,tile=null,snapshot=null,pending=[],builds=0,hits=0,scrolls=0,refinements=0,fullPaints=0,zoomCopies=0;
    function invalidate(){snapshot=null;pending=[];}
    function queueTiles(width,height,dpr){
      pending=[];const step=Math.ceil(tileSize*dpr);
      // Integer device-pixel boundaries also avoid seams at fractional DPR.
      for(let y=0;y<height;y+=step)for(let x=0;x<width;x+=step)pending.push({x:x/dpr,y:y/dpr,width:Math.min(step,width-x)/dpr,height:Math.min(step,height-y)/dpr});
      // Complete the visible centre before the cached gutter. A single small
      // scratch canvas keeps rasterObject's own culling local to each tile.
      pending.sort((a,b)=>Math.hypot(a.x+a.width/2-width/dpr/2,a.y+a.height/2-height/dpr/2)-Math.hypot(b.x+b.width/2-width/dpr/2,b.y+b.height/2-height/dpr/2));
    }
    function prepare(g,dpr,preview=false){
      const usePreview=preview&&typeof previewPaint==='function',tilePixels=Math.ceil(tileSize*dpr)+tileHalo*2;
      const sameViewport=incremental&&snapshot&&snapshot.dpr===dpr&&snapshot.width===g.width&&snapshot.height===g.height;
      const scrollCandidate=sameViewport&&snapshot.scale===g.scale,zoomCandidate=sameViewport&&snapshot.scale!==g.scale&&snapshot.scale>0&&g.scale>0;
      // Distant detail starts with a direct paint, but later material/light
      // updates still refine in place. Reserve their scratch from the first
      // snapshot instead of filling the budget with a gutter we must discard.
      const reserveTile=Boolean(incremental&&typeof previewPaint==='function')||usePreview||Boolean(sameViewport&&pending.length)||Boolean(zoomCandidate);
      // A previous high-DPR scratch image must not silently consume the room
      // reserved for a new viewport. It can be recreated at the current size.
      if(tile&&(!reserveTile||tile.width!==tilePixels)){tile.width=tile.height=1;tile=null;}
      const pixelBudget=Math.floor(budget/4)-(reserveTile?tilePixels*tilePixels:0);
      const coreWidth=Math.ceil(g.width*dpr),coreHeight=Math.ceil(g.height*dpr);
      if(coreWidth*coreHeight>pixelBudget||g.width<=0||g.height<=0){invalidate();return false;}
      let actualPadding=padding,width=Math.ceil((g.width+padding*2)*dpr),height=Math.ceil((g.height+padding*2)*dpr);
      if(width*height>pixelBudget){
        // Keep full viewport resolution on wide high-DPR displays. Only the
        // gutter shrinks, in whole device pixels, with scratch space reserved.
        const padPixels=Math.max(0,Math.floor((Math.sqrt((coreWidth-coreHeight)**2+4*pixelBudget)-coreWidth-coreHeight)/4));
        actualPadding=Math.min(padding,padPixels/dpr);
        width=coreWidth+padPixels*2;height=coreHeight+padPixels*2;
      }
      // Static layers can scroll their existing pixels and paint only newly
      // exposed strips. Repainting the full gutter on a long drag can evict all
      // building rasters and turn a boundary crossing into a large CPU spike.
      if(scrollCandidate&&snapshot.padding===actualPadding){
        const dx=Math.round((g.left-snapshot.left)*dpr),dy=Math.round((g.top-snapshot.top)*dpr);
        const next={...g,left:snapshot.left+dx/dpr,top:snapshot.top+dy/dpr};
        const offsetX=g.left-next.left-actualPadding,offsetY=g.top-next.top-actualPadding;
        // With no gutter, device-pixel snapping may itself expose an edge.
        // Rebuild at the exact origin instead of accepting an unusable scroll.
        if(Math.abs(dx)<width&&Math.abs(dy)<height&&offsetX<=1e-6&&offsetY<=1e-6&&offsetX+width/dpr>=g.width-1e-6&&offsetY+height/dpr>=g.height-1e-6){
          const ctx=canvas.getContext('2d');
          ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalCompositeOperation='copy';ctx.drawImage(canvas,dx,dy);ctx.restore();
          ctx.setTransform(dpr,0,0,dpr,0,0);
          const w=width/dpr,h=height/dpr,sx=dx/dpr,sy=dy/dpr;
          const progressive=pending.length>0||usePreview;
          function strip(x,y,sw,sh){
            if(sw<=0||sh<=0)return;
            ctx.save();ctx.translate(x,y);ctx.beginPath();ctx.rect(0,0,sw,sh);ctx.clip();ctx.clearRect(0,0,sw,sh);
            (progressive&&previewPaint?previewPaint:paint)(ctx,{...next,width:sw,height:sh,left:next.left+actualPadding-x,top:next.top+actualPadding-y});ctx.restore();
          }
          if(sx)strip(sx>0?0:w+sx,0,Math.abs(sx),h);
          if(sy)strip(Math.max(0,sx),sy>0?0:h+sy,w-Math.abs(sx),Math.abs(sy));
          snapshot={...next,dpr,padding:actualPadding};if(progressive)queueTiles(width,height,dpr);builds++;scrolls++;return true;
        }
      }
      if(zoomCandidate&&snapshot.padding===actualPadding){
        const ratio=g.scale/snapshot.scale,ctx=canvas.getContext('2d');
        const dx=(g.left+actualPadding-ratio*(snapshot.left+actualPadding))*dpr,dy=(g.top+actualPadding-ratio*(snapshot.top+actualPadding))*dpr;
        // Canvas specifies that an overlapping self-draw reads the original
        // source before writing. Keep the detailed image through a zoom reset
        // without retaining another viewport-sized canvas.
        ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalCompositeOperation='copy';ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(canvas,dx,dy,width*ratio,height*ratio);ctx.restore();
        ctx.setTransform(dpr,0,0,dpr,0,0);
        // Round the retained rectangle inward so fractional edge pixels are
        // filled too. The four exposed strips never overlap each other.
        const left=Math.min(width,Math.max(0,Math.ceil(dx))),top=Math.min(height,Math.max(0,Math.ceil(dy)));
        const right=Math.min(width,Math.max(0,Math.floor(dx+width*ratio))),bottom=Math.min(height,Math.max(0,Math.floor(dy+height*ratio)));
        function strip(x,y,sw,sh){
          if(sw<=0||sh<=0)return;
          x/=dpr;y/=dpr;sw/=dpr;sh/=dpr;
          ctx.save();ctx.translate(x,y);ctx.beginPath();ctx.rect(0,0,sw,sh);ctx.clip();ctx.clearRect(0,0,sw,sh);
          (previewPaint||paint)(ctx,{...g,width:sw,height:sh,left:g.left+actualPadding-x,top:g.top+actualPadding-y});ctx.restore();
        }
        if(right<=left||bottom<=top){strip(0,0,width,height);fullPaints++;}
        else{strip(0,0,left,height);strip(right,0,width-right,height);strip(left,0,right-left,top);strip(left,bottom,right-left,height-bottom);}
        snapshot={...g,dpr,padding:actualPadding};queueTiles(width,height,dpr);builds++;zoomCopies++;return true;
      }
      invalidate();
      if(!canvas)canvas=createCanvas();
      if(canvas.width!==width)canvas.width=width;
      if(canvas.height!==height)canvas.height=height;
      const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width/dpr,height/dpr);
      (usePreview?previewPaint:paint)(ctx,{...g,width:g.width+actualPadding*2,height:g.height+actualPadding*2,left:g.left+actualPadding,top:g.top+actualPadding});
      snapshot={...g,dpr,padding:actualPadding};if(usePreview)queueTiles(width,height,dpr);builds++;fullPaints++;return true;
    }
    function refine(budgetMs=6){
      if(!snapshot||!pending.length)return false;
      const start=now(),g=snapshot,dpr=g.dpr,side=Math.ceil(tileSize*dpr)+tileHalo*2,halo=tileHalo/dpr;
      if(!tile)tile=createCanvas();
      if(tile.width!==side)tile.width=side;
      if(tile.height!==side)tile.height=side;
      const source=tile.getContext('2d'),target=canvas.getContext('2d');
      do{
        const part=pending.shift(),{x,y,width,height}=part;
        source.setTransform(dpr,0,0,dpr,0,0);source.clearRect(0,0,side/dpr,side/dpr);
        // The shadow pass blurs its canvas. Paint beyond the core so adjacent
        // tiles see the same neighbourhood instead of fading toward a seam.
        source.save();source.beginPath();source.rect(0,0,width+halo*2,height+halo*2);source.clip();
        paint(source,{...g,width:width+halo*2,height:height+halo*2,left:g.left+g.padding-x+halo,top:g.top+g.padding-y+halo});source.restore();
        target.save();target.setTransform(dpr,0,0,dpr,0,0);target.clearRect(x,y,width,height);
        target.drawImage(tile,tileHalo,tileHalo,width*dpr,height*dpr,x,y,width,height);target.restore();refinements++;
      }while(pending.length&&now()-start<budgetMs);
      return true;
    }
    function refresh(){
      if(!snapshot||pending.length)return false;
      const side=Math.ceil(tileSize*snapshot.dpr)+tileHalo*2;
      if((canvas.width*canvas.height+side*side)*4>budget)return false;
      // A light-only update can retain the already detailed image while its
      // tiles receive the new sun sample; it need not flash back to preview.
      queueTiles(canvas.width,canvas.height,snapshot.dpr);return true;
    }
    function draw(ctx,g,dpr,rescale=false){
      if(!snapshot||snapshot.dpr!==dpr||snapshot.width!==g.width||snapshot.height!==g.height)return false;
      const ratio=g.scale/snapshot.scale;
      // Only gestures may briefly resample a nearby density. At rest, require
      // the exact scale again so fine paint, roofs and paving finish sharp.
      if(ratio!==1&&(!rescale||ratio<.75||ratio>1.6))return false;
      const x=g.left-ratio*(snapshot.left+snapshot.padding),y=g.top-ratio*(snapshot.top+snapshot.padding);
      const width=canvas.width/dpr*ratio,height=canvas.height/dpr*ratio;
      // A zoom-out or off-centre anchor must not expose an unpainted strip.
      if(x>1e-6||y>1e-6||x+width<g.width-1e-6||y+height<g.height-1e-6)return false;
      // Use the same sampler as an in-place zoom copy. Otherwise crossing a
      // reuse boundary can change texture sharpness during the same gesture.
      const smoothing=ctx.imageSmoothingEnabled,quality=ctx.imageSmoothingQuality;
      ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
      try{ctx.drawImage(canvas,x,y,width,height);}finally{ctx.imageSmoothingEnabled=smoothing;ctx.imageSmoothingQuality=quality;}
      hits++;return true;
    }
    return {invalidate,prepare,draw,refine,refresh,get pending(){return pending.length;},get stats(){return {builds,hits,scrolls,refinements,fullPaints,zoomCopies,pending:pending.length,bytes:(canvas?canvas.width*canvas.height*4:0)+(tile?tile.width*tile.height*4:0),budget};}};
  }
  const api={create,createPanCache};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.FrameScheduler=api;
})(typeof window==='undefined'?{}:window);
