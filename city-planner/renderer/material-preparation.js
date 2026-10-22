/* The same material pixels for the visible canvas and the preparation worker.
 * Output ownership belongs to the caller; this module keeps no texture cache. */
(function(root){
  'use strict';
  const materialCatalog=typeof module!=='undefined'&&module.exports?require('./material-catalog.js'):root.SceneMaterials;
  const variation=typeof module!=='undefined'&&module.exports?require('./surface-variation.js'):root.SurfaceVariation;
  function seed(value){let n=2166136261;for(const c of String(value)){n^=c.charCodeAt(0);n=Math.imul(n,16777619);}return n>>>0;}
  function random(value){let n=seed(value);return ()=>{n+=0x6d2b79f5;let t=Math.imul(n^n>>>15,1|n);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296;};}
  function path(ctx,points,close=true){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));if(close)ctx.closePath();}
  function create(options={}){
    let makeCanvas=options.canvas,atlases=options.atlases||{},disposed=false;
    if(typeof makeCanvas!=='function')throw new TypeError('Material preparation requires a canvas(size) factory');
    if(!materialCatalog||!variation)throw new Error('Material preparation requires SceneMaterials and SurfaceVariation');
    function alive(){if(disposed)throw new Error('Material preparation has been disposed');}
    function atlasSample(ctx,atlas,x,y,size){
      // HTMLImageElement and ImageBitmap can take different high-quality
      // resampling paths, especially for the 1254 px atlas's half-pixel cells.
      // First copy native pixels without scaling, then sample a canvas in both
      // environments. Two guard pixels preserve the original filter footprint.
      const left=Math.max(0,Math.floor(x)-2),top=Math.max(0,Math.floor(y)-2);
      const width=Math.min(atlas.width,Math.ceil(x+size)+2)-left,height=Math.min(atlas.height,Math.ceil(y+size)+2)-top;
      const source=makeCanvas(Math.max(width,height)),g=source.getContext('2d',{willReadFrequently:true});
      try{
        g.drawImage(atlas,left,top,width,height,0,0,width,height);
        ctx.imageSmoothingQuality='high';ctx.drawImage(source,x-left,y-top,size,size,0,0,256,256);
      }finally{source.width=source.height=1;}
    }
    function baseTexture(name,variant=0){
      alive();
      const cfg=materialCatalog.pick(name,variant),key=name+':'+cfg.index+':source';
      // These canvases are pixel-processing surfaces, not the displayed map.
      const c=makeCanvas(256),ctx=c.getContext('2d',{willReadFrequently:true}),rng=random(key),im=ctx.createImageData(256,256);
      const atlas=atlases[cfg.atlas],paver=name==='paving'||name==='pavingWarm';
      if(atlas&&!['asphalt','grass'].includes(name)&&!paver){
        const size=atlas.width/4;atlasSample(ctx,atlas,(cfg.cell%4)*size+1,Math.floor(cfg.cell/4)*size+1,size-2);
        const pixels=ctx.getImageData(0,0,256,256),mean=[0,0,0],data=pixels.data;
        for(let i=0;i<data.length;i+=4)for(let ch=0;ch<3;ch++)mean[ch]+=data[i+ch]/65536;
        const contrast=name==='asphalt'?.32:name==='roof'?.44:name==='grass'?.62:.65;
        const calibration={paving:.78,roof:.78,facade:.45,grass:.72,curb:.88,water:.55}[name]||0;
        for(let i=0;i<data.length;i+=4)for(let ch=0;ch<3;ch++){
          const target=name==='asphalt'?cfg.rgb[ch]+[0,1.5,-1,1][cfg.index]:mean[ch]*(1-calibration)+cfg.rgb[ch]*calibration;
          data[i+ch]=target+(data[i+ch]-mean[ch])*contrast;
        }
        ctx.putImageData(pixels,0,0);
        ctx.fillStyle=`rgba(${cfg.rgb.join(',')},${name==='grass'?.24:.08})`;ctx.fillRect(0,0,256,256);
        return c;
      }
      const fields=[4,8,16].map(size=>({size,values:Array.from({length:size*size},()=>rng()-.5)}));
      function cloud(x,y,field){const {size,values}=field,gx=x/256*size,gy=y/256*size,ix=Math.floor(gx),iy=Math.floor(gy),fx=(1-Math.cos((gx-ix)*Math.PI))/2,fy=(1-Math.cos((gy-iy)*Math.PI))/2,at=(a,b)=>values[(b%size)*size+a%size];return (at(ix,iy)*(1-fx)+at(ix+1,iy)*fx)*(1-fy)+(at(ix,iy+1)*(1-fx)+at(ix+1,iy+1)*fx)*fy;}
      for(let y=0;y<256;y++)for(let x=0;x<256;x++){
        const i=(y*256+x)*4;
        const broad=cloud(x,y,fields[0])*(name==='grass'?6:name==='asphalt'?4.8:paver?3:14)+cloud(x,y,fields[1])*(name==='asphalt'?1.3:name==='grass'?2:paver?1.5:9)+cloud(x,y,fields[2])*(name==='asphalt'?.5:name==='grass'||paver?.8:4);
        const noise=(rng()-.5)*(name==='asphalt'?4.2:name==='grass'||paver?3:cfg.grain)+broad;
        for(let ch=0;ch<3;ch++)im.data[i+ch]=cfg.rgb[ch]+noise;im.data[i+3]=255;
      }
      if(name==='asphalt'&&atlas){
        const cell=atlas.width/4;ctx.filter='blur(.65px)';ctx.drawImage(atlas,cfg.cell%4*cell+2,Math.floor(cfg.cell/4)*cell+2,cell-4,cell-4,0,0,256,256);ctx.filter='none';
        const source=ctx.getImageData(0,0,256,256).data;let mean=0;
        for(let i=0;i<source.length;i+=4)mean+=(source[i]*.2126+source[i+1]*.7152+source[i+2]*.0722)/65536;
        for(let i=0;i<source.length;i+=4){const grain=Math.max(-12,Math.min(12,(source[i]*.2126+source[i+1]*.7152+source[i+2]*.0722-mean)*.22));for(let ch=0;ch<3;ch++)im.data[i+ch]+=grain;}
      }
      ctx.putImageData(im,0,0);
      // Keep the original random-call and Canvas drawing order, including the
      // fallback when an atlas is unavailable on the synchronous path.
      if(name==='grass')for(let i=0;i<2200;i++){
        const x=rng()*256,y=rng()*256;ctx.strokeStyle=i%3?'#d4cf8b14':'#354e3012';ctx.lineWidth=.5+rng();ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+rng()*2-1,y-1-rng()*3);ctx.stroke();
      }
      if(name==='gravel')for(let i=0;i<1800;i++){
        const r=.2+rng()*.8;ctx.fillStyle=i%2?'#d5d7d21c':'#17232c25';ctx.fillRect(rng()*256,rng()*256,r,r);
      }
      if(name==='roof'){
        for(let i=0;i<90;i++){const x=rng()*256,y=rng()*256,r=2+rng()*14,g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,'#5d63571b');g.addColorStop(1,'#5d635700');ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2);}
        ctx.lineWidth=.35;ctx.strokeStyle='#6d736315';for(let i=0;i<10;i++){const x=rng()*256,y=rng()*256;path(ctx,[[x,y],[x+3,y+4],[x+8,y+5]],false);ctx.stroke();}
      }
      if(name==='water'){
        ctx.lineWidth=.7;ctx.strokeStyle='#dcebd936';
        for(let i=0;i<75;i++){const x=rng()*256,y=rng()*256;ctx.beginPath();ctx.ellipse(x,y,2+rng()*12,.5+rng()*2,-.25,0,Math.PI);ctx.stroke();}
      }
      if(name==='marking'||name==='markingYellow'){
        ctx.fillStyle='#69726b';ctx.globalAlpha=.08+cfg.index*.025;
        for(let i=0;i<120+cfg.index*40;i++)ctx.fillRect(rng()*256,rng()*256,.8+rng()*2,.6+rng()*2);
        ctx.globalAlpha=1;
      }
      return c;
    }
    function texture(name,variant=0){
      alive();
      const cfg=materialCatalog.pick(name,variant),key=name+':'+cfg.index+':field';
      const base=baseTexture(name,cfg.index),profile=variation.profile(name);if(profile.factor===1)return base;
      try{
        const c=makeCanvas(profile.size),ctx=c.getContext('2d'),data=base.getContext('2d').getImageData(0,0,256,256);
        const pixels=ctx.createImageData(profile.size,profile.size);pixels.data.set(variation.synthesize(data.data,256,name,cfg.index,seed(key),cfg.meters));ctx.putImageData(pixels,0,0);return c;
      }finally{
        // No caller can hold this private source. Release its backing store
        // promptly instead of accumulating 256 px canvases between jobs.
        base.width=base.height=1;
      }
    }
    function dispose(){disposed=true;makeCanvas=null;atlases=null;}
    return {baseTexture,texture,dispose};
  }
  const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SceneMaterialPreparation=api;
})(typeof window!=='undefined'?window:typeof self!=='undefined'?self:typeof globalThis!=='undefined'?globalThis:{});
