/* World-space materials and a shared sun for the existing orthographic map.
 * All decoration is deterministic and display-only. No network assets needed. */
(function(root){
  'use strict';
  const settings={quality:'high',labels:false,renderer:'textures'};
  let effectiveQuality='map';
  let clockSeconds=9*3600;
  const tiles=new Map(),patterns=new WeakMap(),sprites=new Map(),layouts=new WeakMap(),boundsCache=new WeakMap(),lampCache=new WeakMap(),streetTreeCache=new WeakMap(),treeShadows=new Map();
  const materialCatalog=typeof module!=='undefined'&&module.exports?require('./material-catalog.js'):root.SceneMaterials;
  const variation=typeof module!=='undefined'&&module.exports?require('./surface-variation.js'):root.SurfaceVariation;
  const raster=typeof module!=='undefined'&&module.exports?require('./raster-cache.js'):root.SceneRasterCache;
  const objectRasters=raster.create({dispose:item=>{item.image.width=item.image.height=1;}}),vehicleSprites=new Map(),vehicleShadows=new Map(),vehicleAtlases={};
  const vehicleLighting=raster.create({limit:96,budget:12*1024*1024,dispose:item=>{item.image.width=item.image.height=1;}});
  const atlases={};let assetVersion=0;
  let fountainAtlas=null,fountainTile=null;
  const canopyAtlases={},canopyCells=new WeakMap(),spriteLods=new Map();let shadowLayer=null,spriteHour=-1,contactSprite=null;
  const canopySources={
    classic:{file:'tree-canopies.png',columns:2,light:225},species:{file:'tree-species.png',columns:4,light:225},
    garden:{file:'garden-canopies.png',columns:4,light:225},volume:{file:'tree-volumes-v4.png',columns:2,light:225},
    volumeSpecies:{file:'tree-species-volumes-v4.png',columns:2,light:225},shrubVolume:{file:'shrub-volumes-v3.png',columns:2,light:225}
  };
  // The saved 20-species indices stay intact; these display-only cells give
  // common street trees different branch structures instead of one round crown.
  const canopyVolumes={0:['volume',0],1:['volume',1],2:['volume',2],3:['volume',3],4:['volume',2],5:['volume',0],6:['volumeSpecies',0],7:['volume',3],8:['volumeSpecies',1],11:['volumeSpecies',2],18:['volumeSpecies',3]};
  if(typeof Image!=='undefined'){
    const fountainImage=new Image();fountainImage.onload=()=>{fountainAtlas=fountainImage;fountainTile=null;assetVersion++;root.MapWorkspace?.draw();};fountainImage.src='assets/fountain-daylight.png';
    for(const name of Object.keys(variation.vehicleAtlases)){
      const image=new Image();image.onload=()=>{vehicleAtlases[name]=image;assetVersion++;vehicleSprites.clear();vehicleShadows.clear();vehicleLighting.clear();root.MapWorkspace?.draw();};image.src=`assets/${name}-daylight-v2.png`;
    }
    for(const [name,{file}] of Object.entries(canopySources)){
      const atlas=new Image();atlas.onload=()=>{canopyAtlases[name]=atlas;assetVersion++;sprites.clear();spriteLods.clear();treeShadows.clear();root.MapWorkspace?.draw();};atlas.src=`assets/${file}`;
    }
    for(const name of ['roof','ground','facade','landscape']){
      const img=new Image();img.onload=()=>{atlases[name]=img;assetVersion++;tiles.clear();root.MapWorkspace?.draw();};img.src=`assets/${name}-atlas.png`;
    }
  }
  const motorKinds=new Set(['lane','street','avenue','highway','motorway']);
  function seed(value){let n=2166136261;for(const c of String(value)){n^=c.charCodeAt(0);n=Math.imul(n,16777619);}return n>>>0;}
  function random(value){let n=seed(value);return ()=>{n+=0x6d2b79f5;let t=Math.imul(n^n>>>15,1|n);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296;};}
  function configure(next={}){
    // WebGL remains an explicit diagnostic opt-in, never the default detail path.
    if(['textures','webgl'].includes(next.renderer))settings.renderer=next.renderer;
    if(['high','balanced','map'].includes(next.quality))settings.quality=next.quality==='map'?'map':'high';
    if(typeof next.labels==='boolean')settings.labels=next.labels;
    return {...settings};
  }
  // Use the displayed zoom ratio so every map enters detail at 7200%.
  const detailZoom = 72;
  function resolveQuality(zoom){
    effectiveQuality=settings.quality==='map'||!(zoom>=detailZoom)?'map':'high';
    return effectiveQuality;
  }
  function smooth(a,b,x){const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);}
  function lightingAt(seconds){
    const hour=((seconds%86400)+86400)%86400/3600;
    // A consistent game-world solar day: east at 06:00, south at noon, west at 18:00.
    const elevation=60*Math.sin((hour-6)*Math.PI/12),daylight=smooth(-7,12,elevation);
    return {hour,azimuth:(hour-6)*15,elevation,daylight,night:1-smooth(-8,4,elevation),
      strength:.28*smooth(0,13,elevation),warmth:.18*Math.exp(-Math.pow((elevation-6)/12,2))};
  }
  function setTime(seconds){if(Number.isFinite(seconds)&&seconds>=0)clockSeconds=seconds;return lightingAt(clockSeconds);}
  function sun(){return lightingAt(clockSeconds);}
  function shadowOffset(height,light=sun()){
    if(light.elevation<=0)return [0,0];
    const angle=(light.azimuth+180)*Math.PI/180;
    const distance=Math.min(95,Math.max(0,height)/Math.tan(light.elevation*Math.PI/180));
    return [Math.cos(angle)*distance,Math.sin(angle)*distance];
  }
  function path(ctx,points,close=true){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));if(close)ctx.closePath();}
  function bounds(points){
    if(boundsCache.has(points))return boundsCache.get(points);
    const b=[Infinity,Infinity,-Infinity,-Infinity];for(const [x,y] of points){b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x);b[3]=Math.max(b[3],y);}boundsCache.set(points,b);return b;
  }
  function inside([x,y],points){let hit=false;for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;
  }return hit;}
  function edgeDistance(p,points){let best=Infinity;for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
    best=Math.min(best,Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy));
  }return best;}
  function canvas(size){const c=document.createElement('canvas');c.width=c.height=size;return c;}
  function baseTexture(name,variant=0){
    const cfg=materialCatalog.pick(name,variant),key=name+':'+cfg.index+':source';
    if(tiles.has(key))return tiles.get(key);
    const c=canvas(256),ctx=c.getContext('2d'),rng=random(key),im=ctx.createImageData(256,256);
    const atlas=atlases[cfg.atlas],paver=name==='paving'||name==='pavingWarm';
    // Road and lawn read as broad continuous surfaces at street scale. The
    // photographic atlas grain was amplified by resampling into a noisy field.
    // Build their diffuse colour from smooth world-scale variation instead.
    if(atlas&&!['asphalt','grass'].includes(name)&&!paver){
      const size=atlas.width/4;ctx.imageSmoothingQuality='high';ctx.drawImage(atlas,(cfg.cell%4)*size+1,Math.floor(cfg.cell/4)*size+1,size-2,size-2,0,0,256,256);
      // Restrain source contrast at city scale; the atlas supplies surface
      // detail while the shared lighting supplies changing sun and shade.
      const pixels=ctx.getImageData(0,0,256,256),mean=[0,0,0],data=pixels.data;
      for(let i=0;i<data.length;i+=4)for(let ch=0;ch<3;ch++)mean[ch]+=data[i+ch]/65536;
      const contrast=name==='asphalt'?.32:name==='roof'?.44:name==='grass'?.62:.65;
      // Calibrate the atlas to a daylight palette without removing the grain
      // or the individual stone / roof variants. Done once per cached tile.
      const calibration={paving:.78,roof:.78,facade:.45,grass:.72,curb:.88,water:.55}[name]||0;
      for(let i=0;i<data.length;i+=4)for(let ch=0;ch<3;ch++){
        const target=name==='asphalt'?cfg.rgb[ch]+[0,1.5,-1,1][cfg.index]:mean[ch]*(1-calibration)+cfg.rgb[ch]*calibration;
        data[i+ch]=target+(data[i+ch]-mean[ch])*contrast;
      }
      ctx.putImageData(pixels,0,0);
      ctx.fillStyle=`rgba(${cfg.rgb.join(',')},${name==='grass'?.24:.08})`;ctx.fillRect(0,0,256,256);
      tiles.set(key,c);return c;
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
      // Let real aggregate supply the small-scale material response while the
      // calibrated field controls tone. Prefilter once, before making mipmaps,
      // so bright stones cannot become screen-space speckle while zooming.
      const cell=atlas.width/4;ctx.filter='blur(.65px)';ctx.drawImage(atlas,cfg.cell%4*cell+2,Math.floor(cfg.cell/4)*cell+2,cell-4,cell-4,0,0,256,256);ctx.filter='none';
      const source=ctx.getImageData(0,0,256,256).data;let mean=0;
      for(let i=0;i<source.length;i+=4)mean+=(source[i]*.2126+source[i+1]*.7152+source[i+2]*.0722)/65536;
      for(let i=0;i<source.length;i+=4){const grain=Math.max(-12,Math.min(12,(source[i]*.2126+source[i+1]*.7152+source[i+2]*.0722-mean)*.22));for(let ch=0;ch<3;ch++)im.data[i+ch]+=grain;}
    }
    ctx.putImageData(im,0,0);
    // Paving joints are authored once, in world metres, by synthesize().
    // Repeating a photographed joint grid underneath produced crossed seams.
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
    tiles.set(key,c);return c;
  }
  function materialMeters(name){return materialCatalog.pick(name).meters*variation.profile(name).factor;}
  function texture(name,variant=0){
    const cfg=materialCatalog.pick(name,variant),key=name+':'+cfg.index+':field';if(tiles.has(key))return tiles.get(key);
    const base=baseTexture(name,cfg.index),profile=variation.profile(name);if(profile.factor===1)return base;
    const c=canvas(profile.size),ctx=c.getContext('2d'),data=base.getContext('2d').getImageData(0,0,256,256);
    const pixels=ctx.createImageData(profile.size,profile.size);pixels.data.set(variation.synthesize(data.data,256,name,cfg.index,seed(key),cfg.meters));ctx.putImageData(pixels,0,0);tiles.set(key,c);return c;
  }
  function material(ctx,name,variant=0){
    const cfg=materialCatalog.pick(name,variant);
    if(settings.quality==='map')return `rgb(${cfg.rgb.join(',')})`;
    let cache=patterns.get(ctx);if(!cache){cache=new Map();patterns.set(ctx,cache);}
    // Prefilter before repeating. CanvasPattern's per-pixel interpolation alone
    // aliases a 256 px source into an 8 px roof tile at overview zoom.
    const meters=materialMeters(name),maxSize=variation.profile(name).size,t=ctx.getTransform(),pixels=meters*Math.min(Math.hypot(t.a,t.b),Math.hypot(t.c,t.d));
    const size=2**Math.max(2,Math.min(Math.log2(maxSize),Math.ceil(Math.log2(Math.max(1,pixels))))),key=`${name}:${cfg.index}:${assetVersion}:${size}`;
    if(!cache.has(key)){
      let tile=texture(name,cfg.index);
      for(let s=tile.width/2;s>=size;s/=2){
        const lodKey=`${name}:${cfg.index}:mip:${s}`;
        if(!tiles.has(lodKey)){const c=canvas(s),g=c.getContext('2d');g.imageSmoothingQuality='high';g.drawImage(tile,0,0,s,s);tiles.set(lodKey,c);}
        tile=tiles.get(lodKey);
      }
      const p=ctx.createPattern(tile,'repeat');p.setTransform(new DOMMatrix().scale(meters/size));cache.set(key,p);
    }
    return cache.get(key);
  }
  function polygonMaterial(ctx,points,name,variant=0){path(ctx,points);ctx.fillStyle=material(ctx,name,variant);ctx.fill();}
  function ground(ctx,g,terrain,vectorLayers){
    if(!root.CityApp?.active||effectiveQuality==='map')return;
    const worldPerPixel=terrain.grid.widthMeters/terrain.width,worldPerPixelY=terrain.grid.heightMeters/terrain.height;
    ctx.save();ctx.clip(vectorLayers.land,'evenodd');ctx.scale(1/worldPerPixel,1/worldPerPixelY);
    ctx.globalAlpha=.8;ctx.fillStyle=material(ctx,'grass');ctx.fillRect(0,0,terrain.grid.widthMeters,terrain.grid.heightMeters);ctx.restore();
  }
  function water(ctx,terrain,vectorLayers){
    if(!root.CityApp?.active||effectiveQuality==='map')return;
    const rivers=new Path2D();for(const river of vectorLayers.rivers)rivers.addPath(river);
    for(const [shape,variant] of [[vectorLayers.ocean,2],[vectorLayers.lakes,0],[rivers,1]]){
      ctx.save();if(shape===rivers)ctx.clip(vectorLayers.riverClip,'evenodd');ctx.clip(shape,'evenodd');
      ctx.scale(terrain.width/terrain.grid.widthMeters,terrain.height/terrain.grid.heightMeters);
      ctx.fillStyle=material(ctx,'water',variant);ctx.fillRect(0,0,terrain.grid.widthMeters,terrain.grid.heightMeters);ctx.restore();
    }
  }
  function onSurface(point,surfaces){
    return (surfaces||[]).some(s=>inside(point,s.points)&&!(s.holes||[]).some(h=>inside(point,h)));
  }
  function streetsideGround(ctx,state,inView=()=>true){
    ctx.save();ctx.fillStyle=material(ctx,'paving',0);
    for(const s of state.streetside?.surfaces||[]){
      if(!inView(s.points))continue;
      ctx.beginPath();for(const ring of [s.points,...(s.holes||[])]){ring.forEach((q,i)=>i?ctx.lineTo(...q):ctx.moveTo(...q));ctx.closePath();}ctx.fill('evenodd');
    }
    ctx.restore();
  }
  function streetsideParking(ctx,state,scale,inView=()=>true){
    for(const site of state.streetside?.sites||[])for(const [i,lot] of site.parking.entries()){
      const radius=Math.hypot(lot.width,lot.depth)/2;
      if(inView([[lot.point[0]-radius,lot.point[1]-radius],[lot.point[0]+radius,lot.point[1]+radius]]))paintParking(ctx,lot,site.id+':front:'+i,scale);
    }
  }
  function parcel(ctx,p,scale){
    const b=p.building;if(!b&&!p.blockCommon&&p.use!=='protected')return;
    // One world-aligned paving material removes the checkerboard of lot grass.
    polygonMaterial(ctx,p.points,b?'paving':'grass',b?0:seed(p.block||p.id));
    if(b&&scale>.28){
      treesFor(p);
      for(const bed of layouts.get(p)?.courtyard?.beds||[])rasterObject(ctx,bed,'courtyard-ground',bed.bounds,scale,g=>{
        path(g,bed.points);g.strokeStyle='#314b3638';g.lineWidth=.85;g.stroke();
        g.fillStyle=material(g,'grass',0);g.fill();g.strokeStyle='#dedac2';g.lineWidth=.35;g.stroke();
        g.save();path(g,bed.points);g.clip();g.strokeStyle='#304d3329';g.lineWidth=.9;g.stroke();g.restore();
      });
      // Access paths are clipped to the lot so decoration never cuts roads.
      ctx.save();path(ctx,p.points);ctx.clip();ctx.strokeStyle=material(ctx,'pavingWarm',0);ctx.lineWidth=2.6;
      path(ctx,[p.frontage||p.center,p.entrance||b.center||p.center],false);ctx.stroke();ctx.restore();
    }
  }
  function castVolumes(ctx,volumes,scale){
    const light=sun();
    if(settings.quality==='map'||scale<.16||light.elevation<=0)return;
    const shape=new Path2D(),box=[Infinity,Infinity,-Infinity,-Infinity];let reach=[0,0];
    function add(ps){let area=0;ps.forEach((a,i)=>{const b=ps[(i+1)%ps.length];area+=a[0]*b[1]-b[0]*a[1];});if(area<0)ps=ps.slice().reverse();ps.forEach((p,i)=>i?shape.lineTo(...p):shape.moveTo(...p));shape.closePath();}
    for(const volume of volumes){
      const v=shadowOffset(volume.height,light),vertices=volume.points.slice();
      if(vertices.length>2&&vertices[0][0]===vertices.at(-1)[0]&&vertices[0][1]===vertices.at(-1)[1])vertices.pop();
      for(const [x,y] of vertices){box[0]=Math.min(box[0],x);box[1]=Math.min(box[1],y);box[2]=Math.max(box[2],x);box[3]=Math.max(box[3],y);}
      if(Math.hypot(...v)>Math.hypot(...reach))reach=v;
      add(vertices);add(vertices.map(p=>[p[0]+v[0],p[1]+v[1]]));
      vertices.forEach((a,i)=>{const b=vertices[(i+1)%vertices.length];add([a,b,[b[0]+v[0],b[1]+v[1]],[a[0]+v[0],a[1]+v[1]]]);});
    }
    if(!Number.isFinite(box[0]))return;
    // A darker root and a softer outer cast anchor the building to the street.
    // The same world sun controls the entire silhouette, including setbacks.
    const cx=(box[0]+box[2])/2,cy=(box[1]+box[3])/2,shade=ctx.createLinearGradient(cx,cy,cx+reach[0],cy+reach[1]);
    shade.addColorStop(0,`rgba(21,34,48,${light.strength*1.42})`);
    shade.addColorStop(.45,`rgba(23,36,51,${light.strength*1.28})`);
    shade.addColorStop(1,`rgba(29,42,57,${light.strength*1.04})`);
    ctx.save();ctx.fillStyle=shade;ctx.fill(shape);ctx.restore();
  }
  function castShadow(ctx,points,height,scale){castVolumes(ctx,[{points,height}],scale);}
  function buildingShadow(ctx,p,scale){
    const m=root.CityGeometry.buildingMassing(p);castVolumes(ctx,[...(m.podium?[m.podium]:[]),...m.volumes],scale);
  }
  function buildingShadows(ctx,parcels,scale){
    if(sun().elevation<=0||scale<.16)return;
    if(!shadowLayer)shadowLayer=canvas(1);
    if(shadowLayer.width!==ctx.canvas.width||shadowLayer.height!==ctx.canvas.height){shadowLayer.width=ctx.canvas.width;shadowLayer.height=ctx.canvas.height;}
    const layer=shadowLayer.getContext('2d');layer.setTransform(1,0,0,1,0,0);layer.clearRect(0,0,shadowLayer.width,shadowLayer.height);layer.setTransform(ctx.getTransform());
    for(const p of parcels)if(p.building.status!=='construction')buildingShadow(layer,p,scale);
    ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.filter=`blur(${Math.min(2.2,Math.max(.4,scale*.12))}px)`;ctx.drawImage(shadowLayer,0,0);ctx.restore();
  }
  function roofLift(height){return Math.min(85,height*.26);}
  function facadeFaces(volume){
    const points=volume.points,area=points.reduce((n,a,i)=>{const z=points[(i+1)%points.length];return n+a[0]*z[1]-z[0]*a[1];},0),faces=[];
    for(let i=0;i<points.length;i++){
      const a=points[i],z=points[(i+1)%points.length],dx=z[0]-a[0],dy=z[1]-a[1],length=Math.hypot(dx,dy);
      const normal=(area>0?-1:1)*dx;
      if(length>.5&&normal>.05)faces.push({a,z,dx,dy,length,nx:(area>0?1:-1)*dy/length,ny:normal/length});
    }return faces;
  }
  function facadeWindows(volume,floors,totalHeight=volume.height){
    const result=[],top=roofLift(volume.height),bottom=roofLift(volume.base||0),rows=Math.max(1,Math.min(12,Math.round(floors*(volume.height-(volume.base||0))/totalHeight)));
    if(top-bottom<1)return result;
    const residential=['house','apartment'].includes(volume.type),office=['office','tower'].includes(volume.type),pitch=volume.type==='hall'?5.5:residential?3.2:3.5;
    for(const face of facadeFaces(volume)){
      const {a,dx,dy,length}=face,cols=Math.max(1,Math.min(36,Math.floor((length-1.1)/pitch))),margin=Math.min(.7,length*.12),bay=(length-margin*2)/cols;
      const width=Math.min(bay*.66,office?2.3:volume.type==='hall'?2.7:residential?1.55:1.9);
      for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
        const center=margin+(col+.5)*bay,ta=(center-width/2)/length,tb=(center+width/2)/length;
        const lo=bottom+(row+.18)*(top-bottom)/rows,hi=bottom+(row+.79)*(top-bottom)/rows;
        result.push([[a[0]+dx*ta,a[1]+dy*ta-lo],[a[0]+dx*tb,a[1]+dy*tb-lo],[a[0]+dx*tb,a[1]+dy*tb-hi],[a[0]+dx*ta,a[1]+dy*ta-hi]]);
      }
    }return result;
  }
  function drawBuildingVolume(ctx,p,volume,scale){
    const b=p.building,points=volume.points,lift=roofLift(volume.height),baseLift=roofLift(volume.base||0),roof=points.map(([x,y])=>[x,y-lift]);
    const palette=b.use==='residential'?['#c9b795','#b3b19c','#b5a28a','#a2b0a7']:b.use==='office'?['#b7c1c0','#c0c6bf','#aabbbd','#c5c8bd']:['#bcb59f','#b5beb5','#c3b799','#abb9b5'];
    const tint=palette[(b.roof||0)%4],light=sun(),angle=light.azimuth*Math.PI/180;
    const foundation=points.map(([x,y])=>[x,y-baseLift]);
    path(ctx,foundation);ctx.strokeStyle='#263c4a20';ctx.lineWidth=.9;ctx.stroke();
    path(ctx,foundation);ctx.strokeStyle='#23374450';ctx.lineWidth=.3;ctx.stroke();
    for(const face of facadeFaces(volume)){
      const {a,z,dx,dy,length,nx,ny}=face,exposure=Math.max(0,nx*Math.cos(angle)+ny*Math.sin(angle));
      const wall=[[a[0],a[1]-baseLift],[z[0],z[1]-baseLift],[z[0],z[1]-lift],[a[0],a[1]-lift]];
      path(ctx,wall);ctx.fillStyle=tint;ctx.fill();
      const options=b.use==='office'?[2,8,9,10,11]:b.use==='residential'?[0,1,2,4,5,6]:[0,2,3,7,8,10],variant=options[seed(p.id+':facade')%options.length];
      ctx.save();ctx.clip();ctx.globalAlpha=.17;ctx.transform(dx/length,dy/length,0,-.26,a[0],a[1]);ctx.fillStyle=material(ctx,b.landmark==='cbd_skyscraper'?'glass':'facade',variant);ctx.fillRect(0,volume.base||0,length,volume.height-(volume.base||0));ctx.restore();
      const wallShade=ctx.createLinearGradient(0,Math.min(a[1],z[1])-lift,0,Math.max(a[1],z[1])-baseLift);
      wallShade.addColorStop(0,`rgba(41,51,53,${.18-exposure*.10})`);wallShade.addColorStop(.72,`rgba(36,48,51,${.26-exposure*.13})`);wallShade.addColorStop(1,'#2e40465c');
      path(ctx,wall);ctx.fillStyle=wallShade;ctx.fill();
      if(scale>.8){
        // A shallow soffit and a base course explain the wall's thickness;
        // tracing every storey edge gave short facades a ruled-paper texture.
        const beam=Math.min(.13,(lift-baseLift)*.10),baseCourse=Math.min(.16,(lift-baseLift)*.12);
        path(ctx,[[a[0],a[1]-lift],[z[0],z[1]-lift],[z[0],z[1]-lift+beam],[a[0],a[1]-lift+beam]]);ctx.fillStyle='#64787375';ctx.fill();
        path(ctx,[[a[0],a[1]-baseLift],[z[0],z[1]-baseLift],[z[0],z[1]-baseLift-baseCourse],[a[0],a[1]-baseLift-baseCourse]]);ctx.fillStyle='#70827c66';ctx.fill();
        path(ctx,[[a[0],a[1]-baseLift-baseCourse],[z[0],z[1]-baseLift-baseCourse]],false);ctx.strokeStyle='#e1e4d359';ctx.lineWidth=.045;ctx.stroke();
      }
    }
    if(scale>.8&&lift-baseLift>.5){
      const windows=facadeWindows(volume,b.floors||1,b.height||volume.height),rng=random(p.id+':reflections');
      for(const window of windows){
        const [a,z,q,t]=window,reflection=rng(),top=Math.min(...window.map(p=>p[1])),bottom=Math.max(...window.map(p=>p[1]));
        const glass=ctx.createLinearGradient(a[0],top,z[0],bottom);
        glass.addColorStop(0,reflection>.75?'#94a7a7':'#718b91');glass.addColorStop(.4,reflection>.75?'#607a7e':'#4b686e');glass.addColorStop(1,'#344e60');
        path(ctx,window);ctx.fillStyle=glass;ctx.fill();
        // Some rooms have a partial blind, while most carry a broad, quiet
        // sky reflection. Repeated diagonal slashes read as identical decals.
        if(reflection<.19){
          const fraction=.24+reflection*.8,lowA=[t[0]+(a[0]-t[0])*fraction,t[1]+(a[1]-t[1])*fraction],lowB=[q[0]+(z[0]-q[0])*fraction,q[1]+(z[1]-q[1])*fraction];
          path(ctx,[t,q,lowB,lowA]);ctx.fillStyle='#bbc1adbf';ctx.fill();
        }
        path(ctx,[t,q],false);ctx.strokeStyle='#273e4699';ctx.lineWidth=.07;ctx.stroke();
        path(ctx,[a,z],false);ctx.strokeStyle='#d5ddcfb3';ctx.lineWidth=.065;ctx.stroke();
        const width=Math.hypot(z[0]-a[0],z[1]-a[1]);
        if(width>1.8&&b.use!=='residential'){
          path(ctx,[[(a[0]+z[0])/2,(a[1]+z[1])/2],[(t[0]+q[0])/2,(t[1]+q[1])/2]],false);ctx.strokeStyle='#adbdb78c';ctx.lineWidth=.04;ctx.stroke();
        }
      }
    }
    const roofChoices=[0,1,2,3,4,7,0,1,2,3,4,7,5,6];
    polygonMaterial(ctx,roof,volume.type==='terrace'?'paving':'roof',volume.type==='terrace'?seed(p.block||p.id):roofChoices[seed(p.id+':roof')%roofChoices.length]);
    ctx.save();path(ctx,roof);ctx.clip();
    const [x0,y0,x1,y1]=bounds(roof);ctx.globalAlpha=volume.type==='terrace'?.1:.12;ctx.fillStyle=b.use==='residential'?'#e1d9c8':'#dce0d9';ctx.fillRect(x0,y0,x1-x0,y1-y0);ctx.globalAlpha=1;
    if(light.warmth>.005){ctx.fillStyle='#f0b75d';ctx.globalAlpha=light.warmth;ctx.fillRect(x0,y0,x1-x0,y1-y0);ctx.globalAlpha=1;}
    ctx.restore();
    root.CityOrdinaryRoofs?.drawCanvas(ctx,p,volume,api);
    if(!volume.rect){
      path(ctx,roof);ctx.strokeStyle='#60788780';ctx.lineWidth=.20;ctx.stroke();
      ctx.save();path(ctx,roof);ctx.clip();ctx.strokeStyle='#eeeade';ctx.lineWidth=.55;ctx.stroke();ctx.restore();
    }
  }
  function rasterObject(ctx,object,stamp,box,scale,paint){
    const m=ctx.getTransform(),pixels=Math.max(Math.hypot(m.a,m.b),Math.hypot(m.c,m.d)),w=box[2]-box[0],h=box[3]-box[1];
    // Cull the projected roof/facade, rather than warming large sprites for
    // every parcel in the wider shadow/vegetation query margin.
    const corners=[[box[0],box[1]],[box[2],box[1]],[box[2],box[3]],[box[0],box[3]]].map(([x,y])=>[m.a*x+m.c*y+m.e,m.b*x+m.d*y+m.f]);
    if(Math.max(...corners.map(p=>p[0]))<0||Math.min(...corners.map(p=>p[0]))>ctx.canvas.width||Math.max(...corners.map(p=>p[1]))<0||Math.min(...corners.map(p=>p[1]))>ctx.canvas.height)return;
    // Half-octave buckets stay above display resolution without allocating
    // almost four times the necessary pixels immediately above a zoom boundary.
    const density=Math.min(16,2**(Math.ceil(Math.log2(Math.max(.25,pixels))*2)/2),1536/Math.max(w,h));
    const key=`${assetVersion}:${Math.floor(sun().hour)}:${density}:${scale>.8}:${stamp}`;
    let entry=objectRasters.get(object);
    if(!entry||entry.key!==key){
      const image=document.createElement('canvas');image.width=Math.ceil(w*density);image.height=Math.ceil(h*density);
      const g=image.getContext('2d');g.setTransform(density,0,0,density,-box[0]*density,-box[1]*density);paint(g);
      entry=objectRasters.set(object,{key,image,box},image.width*image.height*4);
    }
    ctx.drawImage(entry.image,box[0],box[1],w,h);
  }
  function building(ctx,p,scale){
    parking(ctx,p,scale);
    if(p.building.status==='construction'){paintBuilding(ctx,p,scale);return;}
    const m=root.CityGeometry.buildingMassing(p),volumes=[...(m.podium?[m.podium]:[]),...m.volumes],box=[Infinity,Infinity,-Infinity,-Infinity];
    for(const volume of volumes){const b=bounds(volume.points);box[0]=Math.min(box[0],b[0]-3);box[1]=Math.min(box[1],b[1]-roofLift(volume.height)-4);box[2]=Math.max(box[2],b[2]+3);box[3]=Math.max(box[3],b[3]+3);}
    if(!volumes.length)return;
    rasterObject(ctx,p,'building:'+(root.CityOrdinaryRoofs?.assetVersion||0),box,scale,g=>paintBuilding(g,p,scale));
  }
  function parking(ctx,p,scale){
    const lot=root.CityScene3D?.parkingFor(p);if(lot)paintParking(ctx,lot,p.id,scale);
  }
  function paintParking(ctx,lot,id,scale){
    const {point,width,depth,angle}=lot,rng=random(id+':parking'),count=Math.floor((width-1.2)/2.65),start=-count*2.65/2;
    ctx.save();ctx.translate(...point);ctx.rotate(angle);ctx.fillStyle=material(ctx,'asphalt',seed(id));ctx.fillRect(-width/2,-depth/2,width,depth);
    ctx.strokeStyle='#e7e5d6';ctx.lineWidth=.11;ctx.beginPath();ctx.moveTo(-width/2+.3,-depth/2+.1);ctx.lineTo(width/2-.3,-depth/2+.1);
    for(let i=0;i<=count;i++){const x=start+i*2.65;ctx.moveTo(x,-depth/2+.12);ctx.lineTo(x,-depth/2+5.2);}ctx.stroke();
    ctx.restore();
    // Cars use world coordinates so rotating a parking bay cannot rotate the
    // sun or its cast shadow along with the paving underneath it.
    const c=Math.cos(angle),s=Math.sin(angle);
    for(let i=0;i<count;i++)if(rng()>.24){
      const x=start+(i+.5)*2.65,y=-depth/2+2.75;
      vehicle(ctx,{point:[point[0]+x*c-y*s,point[1]+x*s+y*c],heading:angle-Math.PI/2,id:seed(id+i),speed:0,parked:true},scale);
    }
  }
  function paintBuilding(ctx,p,scale){
    const b=p.building,points=b.footprint;
    if(b.status==='construction'){
      polygonMaterial(ctx,points,'soil',seed(p.id));ctx.save();path(ctx,points);ctx.clip();const [x,y,x1,y1]=bounds(points);
      ctx.strokeStyle='#b9a16b';ctx.lineWidth=.5;for(let i=x;i<x1;i+=5){path(ctx,[[i,y],[i,y1]],false);ctx.stroke();}for(let j=y;j<y1;j+=5){path(ctx,[[x,j],[x1,j]],false);ctx.stroke();}ctx.restore();return;
    }
    const m=root.CityGeometry.buildingMassing(p);
    if(m.podium)drawBuildingVolume(ctx,p,m.podium,scale);
    // A setback roof is below the tower standing on it, even though its south
    // edge is closer to the camera. Depth-only sorting hid entire upper roofs.
    const ordered=m.volumes.slice().sort((a,b)=>(a.base||0)-(b.base||0)||bounds(a.points)[3]-bounds(b.points)[3]||a.height-b.height);
    for(const volume of ordered){
      if(volume.base>0&&sun().elevation>0){
        const lower=[...(m.podium?[m.podium]:[]),...ordered].filter(v=>v!==volume&&Math.abs(v.height-volume.base)<.1);
        if(lower.length){
          ctx.save();ctx.beginPath();for(const support of lower){support.points.forEach(([x,y],i)=>i?ctx.lineTo(x,y-roofLift(support.height)):ctx.moveTo(x,y-roofLift(support.height)));ctx.closePath();}ctx.clip();
          const offset=shadowOffset(volume.height-volume.base),base=volume.points.map(([x,y])=>[x,y-roofLift(volume.base)]);
          ctx.fillStyle=`rgba(34,49,49,${sun().strength*.55})`;
          for(let i=1;i<base.length;i++){const a=base[i-1],b=base[i];path(ctx,[a,b,[b[0]+offset[0],b[1]+offset[1]],[a[0]+offset[0],a[1]+offset[1]]]);ctx.fill();}
          ctx.restore();
        }
      }
      drawBuildingVolume(ctx,p,volume,scale);
    }
  }
  function treesFor(p){
    const facilities=root.CityApp?.state?.facilities,streetside=root.CityApp?.state?.streetside,cached=layouts.get(p);
    if(cached&&cached.facilities===facilities&&cached.streetside===streetside)return cached.trees;
    const result=[],b=p.building,points=p.points;if(!points)return result;
    const occupied=(facilities||[]).filter(f=>!['park','plaza'].includes(f.kind)&&f.points?.length);
    const parking=b&&root.CityScene3D?.parkingFor(p),parkingPoints=parking?[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>{
      const u=x*parking.width/2,v=y*parking.depth/2;return [parking.point[0]+u*Math.cos(parking.angle)-v*Math.sin(parking.angle),parking.point[1]+u*Math.sin(parking.angle)+v*Math.cos(parking.angle)];
    }):null;
    if(parkingPoints)parkingPoints.push(parkingPoints[0]);
    const court=streetside?.sites?.find(c=>c.id===p.id),accessPaths=[...(p.accessPath?.length?[{points:p.accessPath,width:p.accessWidth||3}]:[]),...(court?.accessPath?.length?[{points:court.accessPath,width:court.accessWidth||3}]:[])];
    const entrance=p.entrance||b?.entrance||b?.center||p.center;
    if(b&&p.frontage&&entrance)accessPaths.push({points:[p.frontage,entrance],width:3});
    const [x0,y0,x1,y1]=bounds(points),rng=random(p.id||points[0].join(','));
    const park=p.kind==='park'||p.use==='protected',plaza=p.kind==='plaza',industrial=b&&['industrial','warehouse'].includes(b.use);
    const mix=materialCatalog.treeMixes[plaza?'plaza':park?'park':industrial?'industrial':'garden'];
    const dominant=mix[seed((p.id||'')+':trees')%Math.min(8,mix.length)],step=park?6.8:plaza?8.5:industrial?12:8;
    const stride=Math.max(step,Math.sqrt((x1-x0)*(y1-y0)/220));
    const nx=Math.max(1,Math.floor((x1-x0)/stride)),ny=Math.max(1,Math.floor((y1-y0)/stride));
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
      const species=rng()<.8?dominant:mix[Math.floor(rng()*mix.length)],type=materialCatalog.tree(species);
      const point=[x0+(i+.5)*(x1-x0)/nx+(rng()-.5)*stride*.58,y0+(j+.5)*(y1-y0)/ny+(rng()-.5)*stride*.58];
      const radius=type.radius[0]+rng()*(type.radius[1]-type.radius[0]);
      if(!inside(point,points)||edgeDistance(point,points)<Math.min(2.2,radius*.52))continue;
      if(b&&onSurface(point,p.forecourt))continue;
      if(b&&(inside(point,b.footprint)||edgeDistance(point,b.footprint)<radius+1))continue;
      if(parkingPoints&&(inside(point,parkingPoints)||edgeDistance(point,parkingPoints)<radius*.65+.7))continue;
      if(accessPaths.some(path=>edgeDistance(point,path.points)<path.width/2+radius*.6))continue;
      if(occupied.some(f=>inside(point,f.points)||edgeDistance(point,f.points)<radius*.65+1||f.accessPath?.length&&edgeDistance(point,f.accessPath)<(f.accessWidth||5)/2+radius))continue;
      if(park&&p.point&&edgeDistance(point,[[x0,p.point[1]],p.point,[x1,y1]])<1.6)continue;
      if(plaza&&(edgeDistance(point,points)>6||p.point&&Math.hypot(point[0]-p.point[0],point[1]-p.point[1])<radius+10))continue;
      if(result.some(t=>Math.hypot(point[0]-t.point[0],point[1]-t.point[1])<(radius+t.radius)*.64))continue;
      if(industrial&&rng()<.35)continue;
      result.push({point,radius,species:type.id,variant:species+Math.floor(rng()*4)*materialCatalog.treeSpecies.length,height:type.height[0]+rng()*(type.height[1]-type.height[0]),street:Boolean(b)});
    }
    const landscaping=root.CityLandscape||(typeof module!=='undefined'&&module.exports?require('./landscape-layout.js'):null);
    const courtyard=b&&landscaping?.courtyard?.(p,result,{polygons:[...occupied.map(f=>f.points),...(parkingPoints?[parkingPoints]:[])],paths:[...accessPaths,...occupied.filter(f=>f.accessPath?.length).map(f=>({points:f.accessPath,width:f.accessWidth||5}))]});
    const trees=courtyard?.trees||result;
    layouts.set(p,{trees,courtyard,facilities,streetside});return trees;
  }
  function canopyCell(atlas,columns,tile){
    let cells=canopyCells.get(atlas);if(!cells){cells=new Map();canopyCells.set(atlas,cells);}
    if(!cells.has(tile)){
      const source=canvas(256),g=source.getContext('2d'),size=atlas.width/columns;g.imageSmoothingQuality='high';
      g.drawImage(atlas,tile%columns*size+1,Math.floor(tile/columns)*size+1,size-2,size-2,0,0,256,256);
      const pixels=g.getImageData(0,0,256,256);variation.isolateSprite(pixels.data,256,256);g.putImageData(pixels,0,0);
      // Normalize the live alpha silhouette, not its atlas padding. A sparse
      // source cell must not shrink a mature crown into a tiny leaf speck.
      let x0=256,y0=256,x1=-1,y1=-1;
      for(let y=0;y<256;y++)for(let x=0;x<256;x++)if(pixels.data[(y*256+x)*4+3]>48){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
      const c=canvas(256),ctx=c.getContext('2d');ctx.imageSmoothingQuality='high';
      if(x1>=x0){
        const cx=(x0+x1)/2,cy=(y0+y1)/2;let radius=1;
        for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(pixels.data[(y*256+x)*4+3]>48)radius=Math.max(radius,Math.hypot(x-cx,y-cy));
        const factor=112/radius;ctx.drawImage(source,128-cx*factor,128-cy*factor,256*factor,256*factor);
      }
      cells.set(tile,c);
    }return cells.get(tile);
  }
  function plantLightingHour(){
    const hour=Math.floor(sun().hour);
    if(hour!==spriteHour){sprites.clear();spriteLods.clear();treeShadows.clear();spriteHour=hour;}
    return hour;
  }
  function treeSprite(variant,lit=true,shrub=false){
    const hour=plantLightingHour(),key=hour+':'+variant+':'+lit+':'+shrub;if(sprites.has(key))return sprites.get(key);
    const c=canvas(256),ctx=c.getContext('2d'),rng=random(variant),angle=sun().azimuth*Math.PI/180,lx=Math.cos(angle),ly=Math.sin(angle);
    const species=materialCatalog.tree(variant),index=variant%materialCatalog.treeSpecies.length;
    const profile=shrub?(variant<4?['shrubVolume',variant%4]:null):canopyVolumes[index],volume=profile&&canopyAtlases[profile[0]];
    const premium=Boolean(volume||canopyAtlases.garden&&(shrub||index<8)),source=volume?profile[0]:premium?'garden':species.atlas,atlas=canopyAtlases[source];
    if(atlas){
      const metadata=canopySources[source],columns=metadata.columns,tile=volume?profile[1]:premium?(shrub?8+variant%8:index):species.cell;
      ctx.imageSmoothingQuality='high';ctx.save();ctx.translate(128,128);
      // Every atlas shares an explicit baked light direction. Individual trees
      // vary by proportion and pigment, never by rotating the sun with a seed.
      ctx.rotate(angle-metadata.light*Math.PI/180);
      if(volume){const shape=seed(variant+':crown-shape');ctx.scale(.94+(shape%257)/256*.1,.94+((shape>>>9)%257)/256*.1);}
      if(shrub)ctx.filter=volume?'blur(.65px)':'blur(.8px)';
      else if(!volume)ctx.filter='blur(.45px)';
      ctx.drawImage(canopyCell(atlas,columns,tile),-128,-128,256,256);ctx.restore();
      // This bounded, first-use bake keeps dark branch pockets while rolling
      // off yellow tips; no pixel processing is added to the vegetation loop.
      const pixels=ctx.getImageData(0,0,256,256),data=pixels.data,tint=seed(variant+':crown-tone')%4;
      const tone=[[-2,0,2],[0,1,1],[1,0,-1],[-1,-1,2]][tint],exposure=[.98,1,.96,1.015][tint];
      for(let i=0;i<data.length;i+=4){
        if(!data[i+3])continue;
        const luma=data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722;
        const contrastLuma=volume?108+(luma-108)*1.07:luma;
        for(let ch=0;ch<3;ch++)data[i+ch]=contrastLuma+(data[i+ch]-luma)*(volume?.96:premium?.98:1.02);
        if(volume){
          const highlight=smooth(118,195,luma);
          for(let ch=0;ch<3;ch++)data[i+ch]=data[i+ch]*(1-.035*highlight)*exposure+tone[ch];
          data[i]-=highlight*(shrub?9:8);data[i+1]-=highlight*(shrub?6:5);data[i+2]+=highlight*1.5;
        }
      }
      ctx.putImageData(pixels,0,0);
      if(lit){ctx.globalCompositeOperation='source-atop';
      const light=ctx.createLinearGradient(128-lx*112,128-ly*112,128+lx*112,128+ly*112);light.addColorStop(0,volume?'#173b3020':'#173b3036');light.addColorStop(.5,'#78966b00');light.addColorStop(1,volume?'#dbe7c70a':'#dbe7c722');ctx.fillStyle=light;ctx.fillRect(0,0,256,256);
      ctx.globalCompositeOperation='source-over';}sprites.set(key,c);return c;
    }
    ctx.scale(1.6,1.6);const hue=77+variant%8*3,saturation=27+variant%3*5;
    for(let i=0;i<65;i++){
      const a=rng()*Math.PI*2,r=Math.sqrt(rng())*45,x=80+Math.cos(a)*r,y=80+Math.sin(a)*r,size=12+rng()*15;
      const grad=ctx.createRadialGradient(x+lx*size*.5,y+ly*size*.5,1,x,y,size);
      grad.addColorStop(0,`hsl(${hue} ${saturation}% ${49+rng()*9}%)`);grad.addColorStop(.55,`hsl(${hue+6} ${saturation+2}% 35%)`);grad.addColorStop(1,`hsla(${hue+12} 26% 20% / .9)`);
      ctx.fillStyle=grad;ctx.beginPath();ctx.arc(x,y,size,0,Math.PI*2);ctx.fill();
    }
    for(let i=0;i<550;i++){
      const a=rng()*Math.PI*2,r=Math.sqrt(rng())*56,x=80+Math.cos(a)*r,y=80+Math.sin(a)*r;
      ctx.fillStyle=i%3?`hsla(${hue} 32% 66% / .22)`:'#102b1b26';ctx.beginPath();ctx.ellipse(x,y,1+rng()*2,.8+rng(),a,0,Math.PI*2);ctx.fill();
    }
    sprites.set(key,c);return c;
  }
  // The index contains only lightweight bounds and source references. Exact
  // geometry is touched for nearby candidates, never for every city parcel.
  function plantingIndex(items,boxFor,cellSize=64){
    const cells=new Map(),large=[];let serial=0,entries=0,checks=0;
    for(const item of items){
      const box=boxFor(item);if(!box||!box.every(Number.isFinite))continue;
      const entry={item,box,seen:0};entries++;
      const x0=Math.floor(box[0]/cellSize),y0=Math.floor(box[1]/cellSize),x1=Math.floor(box[2]/cellSize),y1=Math.floor(box[3]/cellSize);
      // A very large site must not allocate thousands of grid buckets.
      if((x1-x0+1)*(y1-y0+1)>256){large.push(entry);continue;}
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        const key=x+':'+y;let bucket=cells.get(key);if(!bucket){bucket=[];cells.set(key,bucket);}bucket.push(entry);
      }
    }
    return {
      some(point,padding,predicate){
        const query=++serial,x0=point[0]-padding,y0=point[1]-padding,x1=point[0]+padding,y1=point[1]+padding;
        const visit=entry=>{
          if(entry.seen===query)return false;entry.seen=query;const b=entry.box;
          if(b[0]>x1||b[2]<x0||b[1]>y1||b[3]<y0)return false;
          checks++;return predicate(entry.item);
        };
        for(const entry of large)if(visit(entry))return true;
        for(let y=Math.floor(y0/cellSize);y<=Math.floor(y1/cellSize);y++)for(let x=Math.floor(x0/cellSize);x<=Math.floor(x1/cellSize);x++){
          const bucket=cells.get(x+':'+y);if(bucket)for(const entry of bucket)if(visit(entry))return true;
        }
        return false;
      },
      get stats(){return {entries,cells:cells.size,large:large.length,queries:serial,exactChecks:checks};}
    };
  }
  function streetTreesFor(state){
    const cached=streetTreeCache.get(state.network);
    if(cached&&cached.roads===state.roads&&cached.types===state.meta.roadTypes&&cached.facilities===state.facilities&&cached.parcels===state.parcels&&cached.streetside===state.streetside)return cached.trees;
    const roadRenderer=root.RoadRenderer||(typeof module!=='undefined'&&module.exports?require('./road-renderer.js'):null);
    const joins=roadRenderer.connections(state.roads,state.network,state.meta.roadTypes).joins;
    const trees=[],occupied=[...state.parcels.filter(p=>p.building).map(p=>p.building.footprint),...state.facilities.filter(f=>!['park','plaza'].includes(f.kind)&&f.points?.length).map(f=>f.points)];
    const courts=state.streetside?.sites||[];
    const driveways=[...state.facilities.filter(f=>f.connected&&f.accessPath?.length),...courts].filter(f=>f.accessPath?.length);
    const occupiedIndex=plantingIndex(occupied,bounds),joinIndex=plantingIndex(joins,j=>[j.point[0]-j.extent,j.point[1]-j.extent,j.point[0]+j.extent,j.point[1]+j.extent]);
    const drivewayIndex=plantingIndex(driveways,f=>{const b=bounds(f.accessPath),pad=(f.accessWidth||5)/2;return [b[0]-pad,b[1]-pad,b[2]+pad,b[3]+pad];});
    const surfaceIndex=plantingIndex(courts.flatMap(c=>c.surfaces||[]),s=>bounds(s.points)),junctionsByRoad=new Map();
    for(const j of state.network.junctions){
      const clear=Math.max(...j.approaches.map(q=>q.width))/2+16;
      for(const a of j.approaches){let list=junctionsByRoad.get(a.road);if(!list){list=[];junctionsByRoad.set(a.road,list);}list.push({distance:a.distance,clear});}
    }
    for(const r of state.roads){
      if(r.level!==0||!['street','avenue'].includes(r.kind))continue;
      const cfg=state.meta.roadTypes[r.kind],length=r.points.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-r.points[i][0],p[1]-r.points[i][1]),0),rng=random(r.id+':avenue-trees');
      const mix=materialCatalog.treeMixes.street,species=mix[seed(r.id+':species')%mix.length],type=materialCatalog.tree(species);
      const junctions=junctionsByRoad.get(r.id)||[];
      for(let d=25;d<length-15;d+=12){
        if(junctions.some(j=>Math.abs(d-j.distance)<j.clear))continue;
        const at=roadRenderer.sample(r.points,d);
        for(const side of [-1,1]){
          const radius=Math.min(r.kind==='avenue'?4.8:3.8,type.radius[0]+rng()*.8),offset=side*(cfg.width/2+(r.kind==='avenue'?3.3:2.35)),point=[at.point[0]-at.tangent[1]*offset,at.point[1]+at.tangent[0]*offset];
          if(joinIndex.some(point,radius,j=>Math.hypot(point[0]-j.point[0],point[1]-j.point[1])<j.extent+radius))continue;
          if(occupiedIndex.some(point,radius*.7+1,points=>inside(point,points)||edgeDistance(point,points)<radius*.7+1))continue;
          if(drivewayIndex.some(point,radius,f=>edgeDistance(point,f.accessPath)<(f.accessWidth||5)/2+radius))continue;
          if(surfaceIndex.some(point,0,s=>onSurface(point,[s])))continue;
          trees.push({point,radius,species:type.id,variant:species+Math.floor(rng()*4)*materialCatalog.treeSpecies.length,height:type.height[0]*.7+rng()*3,street:true});
        }
      }
    }
    trees.push(...courts.flatMap(c=>c.trees).filter(t=>!occupiedIndex.some(t.point,t.radius*.7+1,points=>inside(t.point,points)||edgeDistance(t.point,points)<t.radius*.7+1)));
    streetTreeCache.set(state.network,{trees,roads:state.roads,types:state.meta.roadTypes,facilities:state.facilities,parcels:state.parcels,streetside:state.streetside});return trees;
  }
  function treeShadow(variant,shrub=false){
    const key=plantLightingHour()+':'+variant+':'+shrub;if(treeShadows.has(key))return treeShadows.get(key);
    const c=canvas(128),ctx=c.getContext('2d');ctx.filter=shrub?'blur(1.6px)':'blur(3px)';ctx.drawImage(treeSprite(variant,true,shrub),0,0,128,128);ctx.filter='none';ctx.globalCompositeOperation='source-in';ctx.fillStyle='#20302d';ctx.fillRect(0,0,128,128);treeShadows.set(key,c);return c;
  }
  function contactShadow(ctx,x,y,r,alpha){
    if(!contactSprite){contactSprite=canvas(96);const g=contactSprite.getContext('2d'),shade=g.createRadialGradient(48,48,3,48,48,47);shade.addColorStop(0,'#17271fe0');shade.addColorStop(.4,'#17271f90');shade.addColorStop(1,'#17271f00');g.fillStyle=shade;g.fillRect(0,0,96,96);}
    ctx.save();ctx.globalAlpha=alpha;ctx.drawImage(contactSprite,x-r,y-r,r*2,r*2);ctx.restore();
  }
  function plantSprite(variant,shrub,pixels){
    let image=treeSprite(variant,true,shrub);
    const target=2**Math.max(3,Math.min(8,Math.ceil(Math.log2(Math.max(1,pixels)))));
    for(let size=128;size>=target;size/=2){const key=`${spriteHour}:${variant}:${Boolean(shrub)}:${size}`;
      if(!spriteLods.has(key)){const tile=canvas(size),g=tile.getContext('2d');g.imageSmoothingQuality='high';g.drawImage(image,0,0,size,size);spriteLods.set(key,tile);}
      image=spriteLods.get(key);
    }return image;
  }
  function vegetation(ctx,objects,scale,visible,streetTrees=[]){
    if(scale<.32)return;
    const transform=ctx.getTransform(),density=Math.max(Math.hypot(transform.a,transform.b),Math.hypot(transform.c,transform.d)),light=sun();
    const all=[],append=plants=>{for(const tree of plants||[])if(visible(tree.point))all.push(tree);};
    append(streetTrees);
    for(const obj of objects){
      const garden=['park','plaza'].includes(obj.kind)&&root.CityLandscape?.plan?.(obj);
      if(garden){append(garden.trees);append(garden.shrubs);}
      else{append(treesFor(obj));append(layouts.get(obj)?.courtyard?.shrubs);}
    }
    if(!all.length)return;
    for(const t of all){
      if(settings.quality==='map')continue;
      contactShadow(ctx,...t.point,t.radius*(t.shrub?1.05:.5),t.shrub?.3:.44);
      if(light.elevation<=0)continue;
      const v=shadowOffset(t.height,light),r=t.radius*1.2;ctx.save();ctx.globalAlpha=light.strength*(t.shrub?.86:1.12);
      if(!t.shrub){ctx.strokeStyle='#20302d';ctx.lineCap='round';ctx.lineWidth=Math.max(.18,t.radius*.1);path(ctx,[t.point,[t.point[0]+v[0]*.56,t.point[1]+v[1]*.56]],false);ctx.stroke();}
      ctx.drawImage(treeShadow(t.variant,t.shrub),t.point[0]+v[0]*.56-r,t.point[1]+v[1]*.56-r,r*2,r*2);ctx.restore();
    }
    for(const t of all.sort((a,b)=>a.point[1]-b.point[1])){
      const [x,y]=t.point,r=t.radius,cy=y-t.height*(t.shrub?.16:.25);
      if(t.street){ctx.fillStyle=material(ctx,'soil',3);ctx.strokeStyle='#d6d4bd';ctx.lineWidth=.2;ctx.fillRect(x-1,y-1,2,2);ctx.strokeRect(x-1,y-1,2,2);}
      if(!t.shrub){ctx.strokeStyle='#665b44';ctx.lineWidth=.32;path(ctx,[[x,y],[x,cy]],false);ctx.stroke();}
      if(settings.quality==='map'||scale<.7){const gr=ctx.createRadialGradient(x-r*.3,y-r*.3,.1,x,y,r);gr.addColorStop(0,'#96aa60');gr.addColorStop(1,'#3b6040');ctx.fillStyle=gr;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();}
      else ctx.drawImage(plantSprite(t.variant,t.shrub,r*2.3*density),x-r*1.15,cy-r*1.15,r*2.3,r*2.3);
    }
  }
  const medianCache=new WeakMap();
  function medians(ctx,state,scale,visible,inView=points=>points.some(visible)){
    if(scale<.65)return;
    let list=medianCache.get(state.network);
    if(!list){
      list=root.RoadRenderer.buildPlan(state.roads,state.network,state.meta.roadTypes).medians.map(item=>{
        const points=item.points,length=points.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-points[i][0],p[1]-points[i][1]),0),trees=[],rng=random(item.road+':median');
        for(let d=4.6;d<length-3;d+=10.8)trees.push({point:root.RoadRenderer.sample(points,d).point,radius:1.05+rng()*.18,height:3.7+rng()*.6,variant:3});
        for(let base=1.2;base<length-1;base+=7.1)for(let j=0;j<3;j++){
          const d=base+j*.94;if(d>length-1)continue;
          const at=root.RoadRenderer.sample(points,d),side=(rng()-.5)*.35;
          if(trees.some(t=>!t.shrub&&Math.hypot(at.point[0]-t.point[0],at.point[1]-t.point[1])<1.35))continue;
          trees.push({point:[at.point[0]-at.tangent[1]*side,at.point[1]+at.tangent[0]*side],radius:.74+rng()*.12,height:.65+rng()*.2,variant:Math.floor(base/7)%2?1:3,shrub:true});
        }
        return {points,trees};
      });medianCache.set(state.network,list);
    }
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
    for(const item of list){if(!inView(item.points))continue;path(ctx,item.points,false);ctx.strokeStyle='#26342c40';ctx.lineWidth=3.2;ctx.stroke();ctx.strokeStyle='#f1e8d3';ctx.lineWidth=2.9;ctx.stroke();ctx.strokeStyle=material(ctx,'grass',0);ctx.lineWidth=2.35;ctx.stroke();vegetation(ctx,[],scale,visible,item.trees);}
    ctx.restore();
  }
  function facilityGround(ctx,f,scale){
    if(!f.points)return;
    const b=bounds(f.points),box=[b[0]-2,b[1]-2,b[2]+2,b[3]+2];
    rasterObject(ctx,f,'landscape-ground:'+(scale>.5),box,scale,g=>paintFacilityGround(g,f,scale));
  }
  function fountain(ctx,r){
    const light=sun(),a=light.azimuth*Math.PI/180,lx=Math.cos(a),ly=Math.sin(a),circle=(x,y,radius)=>{ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);};
    const offset=shadowOffset(.65,light);contactShadow(ctx,offset[0],offset[1],r+1.15,.42);
    if(fountainAtlas){
      if(!fountainTile){
        // Crop the isolated sprite once. The complete fountain is then baked
        // into the existing facility raster, with no per-frame pixel access.
        const source=canvas(512),g=source.getContext('2d');g.drawImage(fountainAtlas,0,0,512,512);
        const pixels=g.getImageData(0,0,512,512);variation.isolateSprite(pixels.data,512,512);g.putImageData(pixels,0,0);
        const box=[512,512,0,0];for(let y=0;y<512;y++)for(let x=0;x<512;x++)if(pixels.data[(y*512+x)*4+3]>48){box[0]=Math.min(box[0],x);box[1]=Math.min(box[1],y);box[2]=Math.max(box[2],x+1);box[3]=Math.max(box[3],y+1);}
        fountainTile={image:source,box};
      }
      const {image,box}=fountainTile,outer=r+.85;
      ctx.save();ctx.imageSmoothingQuality='high';ctx.drawImage(image,box[0],box[1],box[2]-box[0],box[3]-box[1],-outer,-outer-.15,outer*2,outer*2);
      ctx.restore();return;
    }
    // The basin's outside wall, coping and recessed water are separate layers
    // in the cached ground image, so a pool reads as a raised object.
    circle(0,.22,r+.86);ctx.fillStyle='#6e7d7d';ctx.fill();
    const stone=ctx.createLinearGradient(-lx*r,-ly*r,lx*r,ly*r);stone.addColorStop(0,'#aab2aa');stone.addColorStop(.48,'#e5dfd0');stone.addColorStop(1,'#fff4dc');
    circle(0,-.15,r+.85);ctx.fillStyle=stone;ctx.fill();ctx.strokeStyle='#faf4df';ctx.lineWidth=.11;ctx.stroke();
    ctx.save();circle(0,-.15,r+.84);ctx.clip();ctx.strokeStyle='#7d89824a';ctx.lineWidth=.045;
    for(let i=0;i<24;i++){const b=i*Math.PI/12;path(ctx,[[Math.cos(b)*r,Math.sin(b)*r-.15],[Math.cos(b)*(r+.85),Math.sin(b)*(r+.85)-.15]],false);ctx.stroke();}ctx.restore();
    circle(0,-.15,r+.08);ctx.fillStyle='#426674';ctx.fill();circle(0,-.15,r-.07);ctx.fillStyle=material(ctx,'water',3);ctx.fill();
    ctx.save();ctx.clip();const water=ctx.createRadialGradient(lx*r*.22,ly*r*.22,0,0,0,r);water.addColorStop(0,'#6cbdd34d');water.addColorStop(.68,'#186d9430');water.addColorStop(1,'#133e63be');ctx.fillStyle=water;ctx.fillRect(-r,-r-.2,r*2,r*2+.4);
    const rng=random('fountain-spray');
    for(let i=0;i<52;i++){
      const b=rng()*Math.PI*2,rr=Math.sqrt(rng())*(r-.3),x=Math.cos(b)*rr,y=Math.sin(b)*rr-.15;
      ctx.strokeStyle=i%3?'#c0eef057':'#f0fff697';ctx.lineWidth=.045;ctx.beginPath();ctx.ellipse(x,y,.12+rng()*.2,.04+rng()*.05,b-.3,0,Math.PI);ctx.stroke();
    }
    ctx.strokeStyle='#acd4e34d';ctx.lineWidth=.055;
    for(const radius of [.9,1.5,2.1]){ctx.beginPath();ctx.ellipse(0,-.2,radius,radius*.92,0,.6,5.8);ctx.stroke();}
    circle(0,-.15,.72);ctx.fillStyle='#24576e99';ctx.fill();circle(0,-.26,.51);ctx.fillStyle='#cdd8d2';ctx.fill();
    for(let i=0;i<6;i++){
      const b=i*Math.PI/3,to=[Math.cos(b)*2.2,Math.sin(b)*2.2-.15];
      ctx.beginPath();ctx.moveTo(0,-.5);ctx.quadraticCurveTo(to[0]*.56,to[1]*.5-.8,...to);ctx.strokeStyle='#e1f7f2ad';ctx.lineWidth=.09;ctx.stroke();
      const mist=ctx.createRadialGradient(...to,0,...to,.5);mist.addColorStop(0,'#f3fff9bb');mist.addColorStop(1,'#bceff000');ctx.fillStyle=mist;ctx.fillRect(to[0]-.5,to[1]-.5,1,1);
    }
    circle(0,-.55,.23);ctx.fillStyle='#f5fff8';ctx.fill();ctx.restore();
  }
  function paintFacilityGround(ctx,f,scale){
    const garden=root.CityLandscape?.plan(f);
    polygonMaterial(ctx,f.points,f.kind==='park'?(garden?'pavingWarm':'grass'):'paving',0);
    ctx.strokeStyle='#b5aa9255';ctx.lineWidth=.14;path(ctx,f.points);ctx.stroke();
    if(f.kind==='plaza'&&!f.blockCommon&&scale>.5){
      const b=bounds(f.points),r=Math.min(6,(b[2]-b[0])/5,(b[3]-b[1])/5);
      ctx.save();path(ctx,f.points);ctx.clip();ctx.beginPath();ctx.arc(...f.point,r+5.1,0,Math.PI*2);ctx.strokeStyle=material(ctx,'pavingWarm',0);ctx.lineWidth=3.6;ctx.stroke();ctx.restore();
    }
    if(garden){
      for(const bed of garden.beds){
        ctx.save();ctx.translate(.16,.23);path(ctx,bed);ctx.strokeStyle='#34452d42';ctx.lineWidth=.55;ctx.stroke();ctx.restore();
        polygonMaterial(ctx,bed,'grass',0);
        // A narrow dark soil margin and lit stone coping anchor the planted bed.
        ctx.save();path(ctx,bed);ctx.clip();ctx.strokeStyle='#394b2b38';ctx.lineWidth=.95;ctx.stroke();ctx.restore();
        path(ctx,bed);ctx.strokeStyle='#f2ead7';ctx.lineWidth=.28;ctx.stroke();
      }
      for(const rock of garden.stones){contactShadow(ctx,...rock.point,rock.radius*1.35,.35);const [x,y]=rock.point,gr=ctx.createLinearGradient(x-rock.radius,y-rock.radius,x+rock.radius,y+rock.radius);gr.addColorStop(0,'#ddd4b7');gr.addColorStop(.5,'#bcb99f');gr.addColorStop(1,'#858a75');ctx.fillStyle=gr;ctx.beginPath();ctx.ellipse(x,y,rock.radius,rock.radius*.7,rock.turn,0,Math.PI*2);ctx.fill();}
      for(const [x,y] of garden.benches){ctx.fillStyle='#283b3645';ctx.fillRect(x-1.35,y-.1,2.9,.75);ctx.fillStyle='#454b43';for(const dx of [-.95,.95])ctx.fillRect(x+dx-.08,y-.4,.16,.85);ctx.fillStyle='#b99360';for(let row=0;row<3;row++)ctx.fillRect(x-1.4,y-.3+row*.22,2.8,.17);ctx.fillStyle='#d2af78';ctx.fillRect(x-1.4,y-.51,2.8,.13);}
    }
    if(f.kind==='park'&&!garden&&scale>.4){
      ctx.save();path(ctx,f.points);ctx.clip();const [x0,y0,x1,y1]=bounds(f.points);ctx.strokeStyle=material(ctx,'paving');ctx.lineWidth=2;
      path(ctx,[[x0,f.point[1]],[f.point[0],f.point[1]],[x1,y1]],false);ctx.stroke();ctx.restore();
    }
    if(f.kind==='plaza'&&!f.blockCommon&&scale>.5){
      ctx.save();path(ctx,f.points);ctx.clip();ctx.translate(...f.point);const box=bounds(f.points),r=Math.min(6,(box[2]-box[0])/5,(box[3]-box[1])/5);
      ctx.strokeStyle='#777c7338';ctx.lineWidth=.11;for(const q of [r+3,r+6,r+9]){ctx.beginPath();ctx.arc(0,0,q,0,Math.PI*2);ctx.stroke();}for(let i=0;i<20;i++){const a=i*Math.PI/10;path(ctx,[[Math.cos(a)*(r+1),Math.sin(a)*(r+1)],[Math.cos(a)*(r+9),Math.sin(a)*(r+9)]],false);ctx.stroke();}
      fountain(ctx,r);ctx.restore();
    }
  }
  const bridgeStructures=new WeakMap();
  function bridgeStructure(road,width){
    const cached=bridgeStructures.get(road);if(cached?.width===width)return cached;
    const result={width,walls:[],rails:[],posts:[],piers:[]},samples=road.elevationSamples;
    if(road.level<=0||!samples?.length)return result;
    // Use the same height samples and projection as the asphalt and vehicles.
    // Low approaches have battered retaining walls; taller spans have a thin
    // deck fascia and spaced supports, leaving the space underneath open.
    const project=(p,h)=>[p[0],p[1]-.28*h];
    const frames=samples.map((s,i)=>{
      const a=samples[Math.max(0,i-1)].point,b=samples[Math.min(samples.length-1,i+1)].point;
      const length=Math.hypot(b[0]-a[0],b[1]-a[1])||1;
      return {...s,normal:[-(b[1]-a[1])/length,(b[0]-a[0])/length]};
    });
    const edge=(s,n)=>{
      const h=Math.max(0,s.height),t=Math.max(0,Math.min(1,(h-2.8)/1.8)),span=t*t*(3-2*t);
      const p=s.point.map((v,i)=>v+n[i]*width/2),batter=h*.6*(1-span);
      const bottom=p.map((v,i)=>v+n[i]*batter),base=span*Math.max(0,h-.75);
      const railHeight=.95*Math.min(1,h/.6);
      return {height:h,top:project(p,h),bottom:project(bottom,base),rail:project(p,h+railHeight)};
    };
    const contours=[frames.map(s=>edge(s,s.normal)),frames.map(s=>edge(s,s.normal.map(v=>-v)))];
    for(const [index,open,sign] of [[0,road.openStart,-1],[frames.length-1,road.openEnd,1]])if(!open){
      const s=frames[index],n=s.normal,tangent=[n[1],-n[0]],cap=[];
      for(let i=0;i<=16;i++){const angle=Math.PI*i/16;cap.push(edge(s,n.map((v,j)=>v*Math.cos(angle)+sign*tangent[j]*Math.sin(angle))));}
      contours.push(cap);
    }
    for(const contour of contours){
      for(let i=1;i<contour.length;i++){
        const a=contour[i-1],b=contour[i];if(Math.max(a.height,b.height)<=0)continue;
        result.walls.push([a.top,b.top,b.bottom,a.bottom]);
        result.rails.push([a.rail,b.rail]);
      }
    }
    let distance=0,nextPost=0,nextPier=12;
    for(let i=0;i<frames.length;i++){
      const s=frames[i];if(i)distance+=Math.hypot(s.point[0]-frames[i-1].point[0],s.point[1]-frames[i-1].point[1]);
      if(distance>=nextPost){
        nextPost=distance+5;
        if(s.height>.15)for(const sign of [-1,1]){const e=edge(s,s.normal.map(v=>v*sign));result.posts.push([e.top,e.rail]);}
      }
      if(distance>=nextPier){
        nextPier=distance+24;
        if(s.height>3.6&&i>0&&i<frames.length-1)for(const sign of [-1,1]){
          const p=s.point.map((v,j)=>v+s.normal[j]*sign*(width/2-.45));
          result.piers.push({foot:p,top:project(p,s.height-.75),height:s.height-.75});
        }
      }
    }
    bridgeStructures.set(road,result);return result;
  }
  function bridgeDetails(ctx,road,width,scale,railings=false){
    const structure=bridgeStructure(road,width);
    ctx.save();ctx.lineJoin='round';ctx.lineCap='round';
    if(railings){
      if(scale>.5)for(const post of structure.posts){path(ctx,post,false);ctx.strokeStyle='#566364';ctx.lineWidth=.18;ctx.stroke();}
      for(const rail of structure.rails){
        path(ctx,rail,false);ctx.strokeStyle='#556263';ctx.lineWidth=.48;ctx.stroke();
        ctx.save();ctx.translate(0,-.055);path(ctx,rail,false);ctx.strokeStyle='#e2e3d6';ctx.lineWidth=.24;ctx.stroke();ctx.restore();
      }
    }else{
      for(const pier of structure.piers){
        ctx.fillStyle='#858b80';ctx.fillRect(pier.foot[0]-1.2,pier.foot[1]-.6,2.4,1.2);
        path(ctx,[pier.foot,pier.top],false);ctx.strokeStyle='#747d77';ctx.lineWidth=1.4;ctx.stroke();
        ctx.strokeStyle='#babeb0';ctx.lineWidth=.7;ctx.stroke();
      }
      for(const wall of structure.walls){
        const outward=wall[3][0]-wall[0][0];
        path(ctx,wall);ctx.fillStyle=outward<0?'#b4b9aa':'#879287';ctx.fill();
        path(ctx,[wall[3],wall[2]],false);ctx.strokeStyle='#394b3d55';ctx.lineWidth=.28;ctx.stroke();
        if(scale>.6){path(ctx,[wall[0],wall[3]],false);ctx.strokeStyle='#65726455';ctx.lineWidth=.08;ctx.stroke();}
      }
    }
    ctx.restore();
  }
  function roadBandBoundary(road,width,section,band){
    if(!road.surfaceProfile)return null;
    const sides=[-1,1].map(sign=>road.surfaceProfile.map(s=>{
      // All walking bands converge onto the bridge coping, with zero width
      // derivative at both ends. The asphalt follows the same curved spine.
      const offset=(s.halfWidth??width/2)+(s.bands?.[band]??section[band]);
      return [s.point[0]-s.tangent[1]*offset*sign,s.point[1]+s.tangent[0]*offset*sign];
    }));
    return [...sides[0],...sides[1].reverse()];
  }
  function roadSurfaces(ctx,roads,types,scale,level,{shadows=true}={}){
    const sectionFor=root.RoadRenderer?.roadCrossSection||(typeof module!=='undefined'&&module.exports?require('./road-renderer.js').roadCrossSection:null);
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
    if(shadows&&level>0&&settings.quality!=='map'&&sun().elevation>0)for(const r of roads){
      const points=r.elevationSamples?r.elevationSamples.map(s=>{const offset=shadowOffset(s.height);return s.point.map((v,i)=>v+offset[i]);}):r.points.map(p=>p.map((v,i)=>v+shadowOffset(6)[i]));
      path(ctx,points,false);ctx.lineWidth=types[r.kind].width;ctx.strokeStyle=`rgba(36,51,69,${sun().strength})`;ctx.stroke();
    }
    if(level>0)for(const r of roads)if(motorKinds.has(r.kind))bridgeDetails(ctx,r,types[r.kind].width+sectionFor(r.kind).curb*2,scale);
    for(const pass of ['sidewalk','promenade','innerWalk','curb','gutter','surface'])for(const r of roads){
      const cfg=types[r.kind],motor=motorKinds.has(r.kind),rail=!motor&&r.kind!=='path',walk=cfg.walk&&(r.level===0||r.landingWalk)&&motor,section=sectionFor(r.kind);
      if(root.RailRenderer?.isRail(r))continue;
      if(['sidewalk','promenade','innerWalk'].includes(pass)&&!walk)continue;
      if(pass==='gutter'&&(!motor||level!==0))continue;
      ctx.save();
      for(const cut of r.mouthClips||[]){
        ctx.beginPath();ctx.rect(-100000,-100000,200000,200000);ctx.moveTo(...cut[0]);for(const p of cut.slice(1))ctx.lineTo(...p);ctx.closePath();ctx.clip('evenodd');
      }
      ctx.lineCap=r.openStart||r.openEnd?'butt':'round';
      path(ctx,r.points,false);ctx.setLineDash(level<0?[7/scale,4/scale]:[]);
      if(pass==='sidewalk'){
        ctx.lineWidth=cfg.width+section.sidewalk*2;ctx.strokeStyle=material(ctx,'paving',0);
      }else if(pass==='promenade'){
        ctx.lineWidth=cfg.width+section.promenade*2;ctx.strokeStyle=material(ctx,'pavingWarm',0);
      }else if(pass==='innerWalk'){
        ctx.lineWidth=cfg.width+section.innerWalk*2;ctx.strokeStyle=material(ctx,'paving',0);
      }else if(pass==='curb'){
        ctx.lineWidth=Math.max(cfg.width+section.curb*2,2/scale);ctx.strokeStyle=material(ctx,rail?'gravel':'curb',motor&&level===0?0:seed(r.id));
      }else if(pass==='gutter'){
        ctx.lineWidth=cfg.width+section.gutter*2;ctx.strokeStyle='#47504f';
      }else{
        ctx.lineWidth=Math.max(cfg.width,rail?1.5/scale:1/scale);ctx.strokeStyle=material(ctx,motor?'asphalt':rail?'gravel':'paving',motor&&level===0?0:seed(r.id));
      }
      const boundary=roadBandBoundary(r,cfg.width,section,pass);
      if(boundary){path(ctx,boundary);ctx.fillStyle=ctx.strokeStyle;ctx.fill();}else ctx.stroke();
      if(r.openStart||r.openEnd)for(const [index,open] of [[0,r.openStart],[r.points.length-1,r.openEnd]])if(!open){
        const p=r.points[index],radius=boundary?Math.hypot(boundary[index][0]-p[0],boundary[index][1]-p[1]):ctx.lineWidth/2;
        ctx.beginPath();ctx.arc(...p,radius,0,Math.PI*2);ctx.fillStyle=ctx.strokeStyle;ctx.fill();
      }
      ctx.restore();
    }
    ctx.setLineDash([]);
    if(level>0)for(const r of roads)if(motorKinds.has(r.kind))bridgeDetails(ctx,r,types[r.kind].width+sectionFor(r.kind).curb*2,scale,true);
    ctx.restore();
  }
  function vehicle(ctx,car,scale){
    let modelId=car.id,style=variation.vehicle(modelId);
    // Passenger-car bays must not be populated with the road fleet's buses.
    if(car.parked)for(let tries=0;tries<32&&style.length*style.scale>5.4;tries++)style=variation.vehicle(++modelId);
    const sprite=vehicleSprite(style);
    if(sprite){
      const length=style.length*style.scale,width=style.width*style.scale,light=sun(),rotation=(car.heading||0)+Math.PI/2;
      ctx.save();ctx.translate(...car.point);
      const key=style.spriteAtlas+':'+style.spriteCell;
      if(!vehicleShadows.has(key)){
        // Padding keeps the soft falloff inside the cached bitmap. The old
        // crop cut the blur into a dark, hard outline around every car.
        const pad=10,c=document.createElement('canvas');c.width=sprite.width+pad*2;c.height=sprite.height+pad*2;
        const g=c.getContext('2d');g.filter='blur(3px)';g.drawImage(sprite,pad,pad);g.filter='none';
        g.globalCompositeOperation='source-in';g.fillStyle='#26343c';g.fillRect(0,0,c.width,c.height);vehicleShadows.set(key,{image:c,pad});
      }
      const shadow=vehicleShadows.get(key);
      const sx=1+shadow.pad*2/sprite.width,sy=1+shadow.pad*2/sprite.height;
      ctx.save();ctx.rotate(rotation);ctx.globalAlpha*=.17;
      ctx.drawImage(shadow.image,-width*.46*sx,-length*.455*sy,width*.92*sx,length*.91*sy);ctx.restore();
      if(light.elevation>0){
        const v=shadowOffset(.65,light);ctx.save();ctx.translate(...v);ctx.rotate(rotation);ctx.globalAlpha*=light.strength*.72;
        ctx.drawImage(shadow.image,-width*.49*sx,-length*.49*sy,width*.98*sx,length*.98*sy);ctx.restore();
      }
      ctx.rotate(rotation);ctx.drawImage(sprite,-width/2,-length/2,width,length);
      const fields=vehicleLightSprite(style,sprite),weights=variation.vehicleLightWeights(car.heading||0,light),alpha=ctx.globalAlpha;
      // These are paint-only illumination fields over one fully opaque sprite,
      // not translucent copies of the body. The sun remains in world space.
      for(let axis=0;axis<2;axis++)if(Math.abs(weights[axis])>.001){
        const cell=axis*2+(weights[axis]<0?1:0);ctx.globalAlpha=alpha*Math.abs(weights[axis]);
        ctx.drawImage(fields.image,cell%2*fields.width,axis*fields.height,fields.width,fields.height,-width/2,-length/2,width,length);
      }
      ctx.restore();return;
    }
    ctx.save();ctx.translate(...car.point);
    const v=shadowOffset(1.5);ctx.save();ctx.translate(...v);ctx.rotate(car.heading);ctx.fillStyle='#1c29394d';ctx.fillRect(-2.4,-1.1,4.8,2.2);ctx.restore();
    ctx.rotate(car.heading);
    ctx.scale(style.length*style.scale/4.5,style.width*style.scale/1.96);
    const body=ctx.createLinearGradient(0,-1,0,1);body.addColorStop(0,'#d5d8d1');body.addColorStop(.2,style.color);body.addColorStop(.8,style.color);body.addColorStop(1,'#303d4666');
    ctx.fillStyle='#263139';ctx.fillRect(-1.7,-1.08,.85,2.16);ctx.fillRect(.9,-1.08,.85,2.16);
    ctx.fillStyle=style.color;ctx.beginPath();ctx.roundRect(-2.25,-.98,4.5,1.96,.42);ctx.fill();ctx.globalAlpha=.45;ctx.fillStyle=body;ctx.fill();ctx.globalAlpha=1;
    ctx.fillStyle=material(ctx,'glass',car.id);path(ctx,[[.1,-.76],[.85,-.65],[1,.65],[.1,.76]]);ctx.fill();ctx.fillRect(-1.2,-.68,.5,1.36);
    ctx.fillStyle='#fff5cc';ctx.fillRect(1.95,-.78,.3,.42);ctx.fillRect(1.95,.36,.3,.42);
    ctx.fillStyle=car.speed<.2?'#ff5243':'#9a342c';ctx.fillRect(-2.25,-.8,.25,.45);ctx.fillRect(-2.25,.35,.25,.45);ctx.restore();
  }
  function vehicleSprite(style){
    const atlas=vehicleAtlases[style.spriteAtlas];if(!atlas)return null;
    const key=style.spriteAtlas+':'+style.spriteCell;if(vehicleSprites.has(key))return vehicleSprites.get(key);
    const tile=canvas(256),g=tile.getContext('2d'),layout=variation.vehicleAtlases[style.spriteAtlas],cell=style.spriteCell;
    const width=atlas.width/layout.columns,height=atlas.height/layout.rows;
    g.imageSmoothingQuality='high';g.drawImage(atlas,cell%layout.columns*width+2,Math.floor(cell/layout.columns)*height+2,width-4,height-4,0,0,256,256);
    const pixels=g.getImageData(0,0,256,256),data=pixels.data,box=[256,256,0,0];
    variation.isolateSprite(data,256,256);g.putImageData(pixels,0,0);
    for(let y=0;y<256;y++)for(let x=0;x<256;x++)if(data[(y*256+x)*4+3]>64){box[0]=Math.min(box[0],x);box[1]=Math.min(box[1],y);box[2]=Math.max(box[2],x+1);box[3]=Math.max(box[3],y+1);}
    if(box[2]<=box[0])return null;
    const image=document.createElement('canvas');image.width=box[2]-box[0];image.height=box[3]-box[1];
    const paint=image.getContext('2d');paint.drawImage(tile,...box.slice(0,2),image.width,image.height,0,0,image.width,image.height);
    const diffuse=paint.getImageData(0,0,image.width,image.height);diffuse.data.set(variation.vehicleDiffuse(diffuse.data,image.width,image.height,style));paint.putImageData(diffuse,0,0);
    vehicleSprites.set(key,image);return image;
  }
  function vehicleLightSprite(style,sprite){
    const key=style.spriteAtlas+':'+style.spriteCell,cached=vehicleLighting.get(key);if(cached)return cached;
    // Smooth lighting needs much less resolution than paint details. Its four
    // fixed axes cover all headings/times without creating a bitmap on turns.
    const ratio=Math.min(1,144/sprite.height),width=Math.max(2,Math.round(sprite.width*ratio)),height=Math.max(2,Math.round(sprite.height*ratio));
    const image=document.createElement('canvas');image.width=width;image.height=height;
    const g=image.getContext('2d');g.imageSmoothingQuality='high';g.drawImage(sprite,0,0,width,height);
    const source=g.getImageData(0,0,width,height),fields=variation.vehicleLightFields(source.data,width,height,style);
    image.width=width*2;image.height=height*2;const pixels=g.createImageData(image.width,image.height);pixels.data.set(fields);g.putImageData(pixels,0,0);
    return vehicleLighting.set(key,{image,width,height},image.width*image.height*4);
  }
  function lampsFor(state){
    if(lampCache.has(state.network))return lampCache.get(state.network);
    const lamps=[];
    for(const road of state.roads){
      if(!motorKinds.has(road.kind)||road.level<0)continue;
      const cfg=state.meta.roadTypes[road.kind],length=road.points.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-road.points[i][0],p[1]-road.points[i][1]),0);
      const junctions=state.network.junctions.flatMap(j=>j.approaches.filter(a=>a.road===road.id).map(a=>a.distance));
      for(let d=16;d<length-8;d+=32){
        if(junctions.some(j=>Math.abs(d-j)<cfg.width+10))continue;
        const at=root.RoadRenderer.sample(road.points,d),n=[-at.tangent[1],at.tangent[0]];
        for(const side of [-1,1])lamps.push({base:root.RoadRenderer.roadHeight(road,d,root.RoadRenderer.connections(state.roads,state.network,state.meta.roadTypes)),point:[at.point[0]+n[0]*(cfg.width/2+1.8)*side,at.point[1]+n[1]*(cfg.width/2+1.8)*side],arm:[-n[0]*1.5*side,-n[1]*1.5*side]});
      }
    }
    for(const f of state.facilities||[])if(f.kind==='plaza'&&f.points&&!f.blockCommon){
      const [x0,y0,x1,y1]=bounds(f.points);
      for(const x of [x0+2,x1-2])for(const y of [y0+2,y1-2])if(inside([x,y],f.points))lamps.push({point:[x,y],arm:[0,0],height:1.05,radius:7});
    }
    lampCache.set(state.network,lamps);return lamps;
  }
  let headlightTexture=null;
  function headlight(){
    if(headlightTexture)return headlightTexture;
    const c=document.createElement('canvas');c.width=128;c.height=64;const g=c.getContext('2d'),pixels=g.createImageData(128,64);
    for(let x=0;x<128;x++)for(let y=0;y<64;y++){
      const t=x/127,d=(y-31.5)/(3+t*22),i=(y*128+x)*4;
      pixels.data[i]=255;pixels.data[i+1]=244;pixels.data[i+2]=213;pixels.data[i+3]=72*Math.exp(-d*d*2)*Math.pow(1-t,1.5);
    }
    g.putImageData(pixels,0,0);headlightTexture=c;return c;
  }
  function glow(ctx,x,y,r,color,alpha){
    const g=ctx.createRadialGradient(x,y,.1,x,y,r);g.addColorStop(0,`rgba(${color},${alpha})`);g.addColorStop(.25,`rgba(${color},${alpha*.48})`);g.addColorStop(1,`rgba(${color},0)`);ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2);
  }
  function atmosphere(ctx,state,{scale,visible,traffic,solid=false}){
    const light=sun(),lamps=scale>.45?lampsFor(state).filter(l=>visible(l.point)):[];
    // Fixtures are part of the daytime scene as well as the night light pass.
    for(const lamp of solid?[]:lamps){
      const [x,y]=lamp.point,[dx,dy]=lamp.arm;ctx.strokeStyle='#626966';ctx.lineWidth=.25;path(ctx,[[x,y],[x+dx,y+dy]],false);ctx.stroke();
      ctx.fillStyle='#e0e2d4';ctx.beginPath();ctx.ellipse(x+dx,y+dy,.5,.3,Math.atan2(dy,dx),0,Math.PI*2);ctx.fill();
    }
    const d=light.daylight;
    if(d<.999||light.warmth>.005){
      ctx.save();ctx.globalCompositeOperation='multiply';
      ctx.fillStyle=`rgb(${Math.round(53+202*d)},${Math.round(70+185*d-light.warmth*55)},${Math.round(108+147*d-light.warmth*110)})`;
      ctx.fillRect(0,0,state.meta.width,state.meta.height);ctx.restore();
    }
    const night=light.night;if(night<.01)return;
    ctx.save();ctx.globalCompositeOperation='screen';
    for(const lamp of lamps){
      const [x,y]=lamp.point,[dx,dy]=lamp.arm;
      glow(ctx,x+dx,y+dy,lamp.radius||13,'255,209,132',.3*night);
      const lampY=y+dy-.28*((lamp.base||0)+(solid?(lamp.height||5.1):0));
      glow(ctx,x+dx,lampY,2.2,'255,231,174',.9*night);
      ctx.fillStyle=`rgba(255,240,195,${night})`;ctx.beginPath();ctx.arc(x+dx,lampY,.4,0,Math.PI*2);ctx.fill();
    }
    for(const f of state.facilities||[])if(f.kind==='plaza'&&f.points&&!f.blockCommon&&visible(f.point)){
      const b=bounds(f.points),r=Math.min(6,(b[2]-b[0])/5,(b[3]-b[1])/5);
      glow(ctx,...f.point,r+1,'102,176,214',.3*night);
      for(let i=0;i<4;i++){const a=i*Math.PI/2;glow(ctx,f.point[0]+Math.cos(a)*r*.8,f.point[1]+Math.sin(a)*r*.8,1.3,'169,213,229',.4*night);}
    }
    if(solid)root.CityScene3D.nightWindows(ctx,night);
    if(!solid&&scale>.5)for(const p of state.parcels){
      const b=p.building;if(!b||b.status!=='active'||!visible(p.center))continue;
      const rng=random(p.id+':windows'),m=root.CityGeometry.buildingMassing(p);
      for(const volume of m.volumes){
        if(volume.type==='terrace')continue;
        for(const window of facadeWindows(volume,b.floors||1)){
          const occupied=rng();if(occupied>.58)continue;
          ctx.fillStyle=`rgba(255,${Math.round(186+occupied*62)},139,${night*(.46+occupied*.6)})`;path(ctx,window);ctx.fill();
        }
      }
    }
    for(const car of traffic?.vehicles||[])if(visible(car.point)){
      ctx.save();const z=root.RoadRenderer.vehicleHeight(car,root.RoadRenderer.connections(state.roads,state.network,state.meta.roadTypes));ctx.translate(car.point[0],car.point[1]-.28*z);ctx.rotate(car.heading);
      const style=variation.vehicle(car.id),front=style.length*style.scale*.46,side=style.width*style.scale*.34;
      for(const y of [-side,side]){
        ctx.save();ctx.globalAlpha=night;ctx.drawImage(headlight(),front,y-2.2,10,4.4);ctx.restore();
        glow(ctx,front,y,.85,'255,250,221',night*.9);
        glow(ctx,-front,y,1.1,'255,42,24',night*(car.speed<.2?.85:.4));
      }
      ctx.restore();
    }
    // Day and night share the exact same head positions and separate lens sets.
    root.RoadRenderer.paintSignals(ctx,root.RoadRenderer.buildPlan(state.roads,state.network,state.meta.roadTypes),{scale,visible,traffic,night});
    ctx.restore();
  }
  const api={onSurface,streetsideGround,streetsideParking,rasterObject,medians,get stats(){return {engine:'Canvas / texture sprites',vehicleAtlases:Object.keys(vehicleAtlases),vehicleSprites:vehicleSprites.size,vehicleShadows:vehicleShadows.size,vehicleLighting:{...vehicleLighting.stats,limit:96,fieldsPerSprite:4},buildingCache:objectRasters.stats,models:0};},materialMeters,configure,resolveQuality,detailZoom,get effectiveQuality(){return effectiveQuality;},get settings(){return {...settings};},get time(){return clockSeconds;},get assetsReady(){return Object.keys(canopyAtlases).length===Object.keys(canopySources).length&&Object.keys(atlases).length===4&&Boolean(fountainAtlas);},get materialInventory(){return Object.fromEntries(Object.keys(materialCatalog.catalog).map(n=>[n,materialCatalog.count(n)]));},get treeSpecies(){return materialCatalog.treeSpecies;},lightingAt,setTime,shadowOffset,seed,random,inside,edgeDistance,treesFor,streetTreesFor,plantingIndex,material,texture,treeSprite,lampsFor,ground,water,parcel,castShadow,buildingShadow,buildingShadows,facadeFaces,facadeWindows,building,vegetation,facilityGround,bridgeStructure,roadBandBoundary,roadSurfaces,vehicle,atmosphere};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CityScene=api;
})(typeof window==='undefined'?{}:window);
