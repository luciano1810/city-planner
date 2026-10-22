/* One requested material at a time. Only original atlas bitmaps persist;
 * expanded textures are transferred to the scene and never cached here. */
(function(scope){
  'use strict';
  let startupError=null,preparation=null,busy=false;
  const atlases=Object.create(null),atlasLoads=new Map(),atlasNames=new Set(['roof','ground','facade','landscape','building-stages']);
  try{
    scope.importScripts('material-catalog.js','surface-variation.js','material-preparation.js');
    if(typeof scope.OffscreenCanvas!=='function'||typeof scope.createImageBitmap!=='function')throw new Error('OffscreenCanvas and createImageBitmap are required');
    preparation=scope.SceneMaterialPreparation.create({canvas:size=>new scope.OffscreenCanvas(size,size),atlases});
  }catch(error){startupError=error;}
  function closeBitmap(bitmap){if(typeof bitmap?.close==='function')bitmap.close();}
  async function loadAtlas(name){
    if(!name)return;
    if(!atlasNames.has(name))throw new Error(`Unknown material atlas: ${name}`);
    if(atlases[name])return atlases[name];
    if(atlasLoads.has(name))return atlasLoads.get(name);
    const pending=(async()=>{
      const response=await scope.fetch(`assets/${name}-atlas.png`);
      if(!response.ok)throw new Error(`Cannot load ${name} atlas: HTTP ${response.status}`);
      const bitmap=await scope.createImageBitmap(await response.blob());
      atlases[name]=bitmap;return bitmap;
    })();
    atlasLoads.set(name,pending);
    try{return await pending;}finally{atlasLoads.delete(name);}
  }
  scope.onmessage=async event=>{
    const job=event.data||{},reply={id:job.id,version:job.version,name:job.name,variant:job.variant};
    if(busy){closeBitmap(job.atlas);scope.postMessage({...reply,error:'Material worker is busy; send only one task at a time'});return;}
    busy=true;let output=null,bitmap=null,incoming=job.atlas;
    try{
      if(startupError)throw startupError;
      if(typeof job.name!=='string'||!Object.prototype.hasOwnProperty.call(scope.SceneMaterials.catalog,job.name))throw new Error(`Unknown material: ${String(job.name)}`);
      if(job.variant!==undefined&&(typeof job.variant!=='number'||!Number.isFinite(job.variant)))throw new Error('Material variant must be a finite number');
      const cfg=scope.SceneMaterials.pick(job.name,job.variant);
      if(job.atlasName!==undefined||incoming!==undefined){
        if(!atlasNames.has(job.atlasName)||job.atlasName!==cfg.atlas)throw new Error(`Atlas ${String(job.atlasName)} does not match material ${job.name}`);
        if(!incoming||typeof incoming.close!=='function'||!(incoming.width>0&&incoming.height>0))throw new Error('Transferred atlas must be an open ImageBitmap');
        // Electron loadFile cannot fetch file:// resources in a worker. The
        // main thread can transfer its already-decoded atlas once per name.
        const previous=atlases[job.atlasName];atlases[job.atlasName]=incoming;incoming=null;
        if(previous!==atlases[job.atlasName])closeBitmap(previous);
      }
      await loadAtlas(cfg.atlas);
      output=preparation.texture(job.name,job.variant);
      bitmap=output.transferToImageBitmap();
      scope.postMessage({...reply,bitmap},[bitmap]);bitmap=null;
    }catch(error){
      closeBitmap(bitmap);
      scope.postMessage({...reply,error:`Material preparation failed: ${error?.message||String(error)}`});
    }finally{
      closeBitmap(incoming);
      if(output)output.width=output.height=1;
      busy=false;
    }
  };
})(self);
