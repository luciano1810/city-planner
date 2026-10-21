/* World-space materials and a shared sun for the existing orthographic map.
 * All decoration is deterministic and display-only. No network assets needed. */
(function(root){
  'use strict';
  const settings={quality:'high',labels:false};
  let effectiveQuality='map';
  let clockSeconds=9*3600;
  const tiles=new Map(),patterns=new WeakMap(),sprites=new Map(),layouts=new WeakMap(),boundsCache=new WeakMap(),lampCache=new WeakMap(),streetTreeCache=new WeakMap(),treeShadows=new Map();
  const materialCatalog=typeof module!=='undefined'&&module.exports?require('./material-catalog.js'):root.SceneMaterials;
  const variation=typeof module!=='undefined'&&module.exports?require('./surface-variation.js'):root.SurfaceVariation;
  const atlases={};let assetVersion=0;
  const canopyAtlases={};let shadowLayer=null,spriteHour=-1;
  if(typeof Image!=='undefined'){
    for(const [name,file] of [['classic','tree-canopies.png'],['species','tree-species.png']]){
      const atlas=new Image();atlas.onload=()=>{canopyAtlases[name]=atlas;sprites.clear();treeShadows.clear();root.MapWorkspace?.draw();};atlas.src=`assets/${file}`;
    }
    for(const name of ['roof','ground','facade','landscape']){
      const img=new Image();img.onload=()=>{atlases[name]=img;assetVersion++;tiles.clear();root.MapWorkspace?.draw();};img.src=`assets/${name}-atlas.png`;
    }
  }
  const motorKinds=new Set(['lane','street','avenue','highway','motorway']);
  function seed(value){let n=2166136261;for(const c of String(value)){n^=c.charCodeAt(0);n=Math.imul(n,16777619);}return n>>>0;}
  function random(value){let n=seed(value);return ()=>{n+=0x6d2b79f5;let t=Math.imul(n^n>>>15,1|n);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296;};}
  function configure(next={}){
    if(['high','balanced','map'].includes(next.quality))settings.quality=next.quality==='map'?'map':'high';
    if(typeof next.labels==='boolean')settings.labels=next.labels;
    return {...settings};
  }
  // CSS pixels per metre, independent of raster resolution and display density.
  // Separate entry/exit thresholds prevent flickering near the boundary.
  function resolveQuality(scale){
    if(settings.quality==='map')effectiveQuality='map';
    else if(scale<.42)effectiveQuality='map';
    else if(scale>=.58)effectiveQuality='high';
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
    const atlas=atlases[cfg.atlas];
    if(atlas){
      const size=atlas.width/4;ctx.imageSmoothingQuality='high';ctx.drawImage(atlas,(cfg.cell%4)*size+1,Math.floor(cfg.cell/4)*size+1,size-2,size-2,0,0,256,256);
      // Restrain source contrast at city scale; the atlas supplies surface
      // detail while the shared lighting supplies changing sun and shade.
      const pixels=ctx.getImageData(0,0,256,256),mean=[0,0,0],data=pixels.data;
      for(let i=0;i<data.length;i+=4)for(let ch=0;ch<3;ch++)mean[ch]+=data[i+ch]/65536;
      const contrast=name==='asphalt'?.42:name==='roof'?.55:name==='grass'?.78:.75;
      for(let i=0;i<data.length;i+=4)for(let ch=0;ch<3;ch++){
        const target=name==='asphalt'?cfg.rgb[ch]+[0,1.5,-1,1][cfg.index]:mean[ch];
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
      const broad=cloud(x,y,fields[0])*(name==='grass'?30:14)+cloud(x,y,fields[1])*9+cloud(x,y,fields[2])*4;
      const noise=(rng()-.5)*cfg.grain+broad;
      for(let ch=0;ch<3;ch++)im.data[i+ch]=cfg.rgb[ch]+noise;im.data[i+3]=255;
    }
    ctx.putImageData(im,0,0);
    if(name==='paving'){
      for(let y=0;y<256;y+=32)for(let x=0;x<256;x+=32){ctx.fillStyle=rng()>.5?'#eee8d51c':'#59666312';ctx.fillRect(x+1,y+1,30,30);}
      // Continuous joint grid; the tile repeats exactly at its boundary.
      ctx.lineWidth=1.5;ctx.strokeStyle='#817f7466';
      for(let i=0;i<=256;i+=32){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,256);ctx.moveTo(0,i);ctx.lineTo(256,i);ctx.stroke();}
      ctx.strokeStyle='#f4f0dd66';ctx.lineWidth=.75;
      for(let i=0;i<256;i+=32){ctx.beginPath();ctx.moveTo(i+2,0);ctx.lineTo(i+2,256);ctx.moveTo(0,i+2);ctx.lineTo(256,i+2);ctx.stroke();}
    }
    if(name==='grass')for(let i=0;i<7500;i++){
      const x=rng()*256,y=rng()*256;ctx.strokeStyle=i%3?'#d4cf8b32':'#354e3030';ctx.lineWidth=.5+rng();ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+rng()*2-1,y-1-rng()*3);ctx.stroke();
    }
    if(name==='asphalt'||name==='gravel')for(let i=0;i<1800;i++){
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
  function parcel(ctx,p,scale){
    const b=p.building;if(!b&&!p.blockCommon&&p.use!=='protected')return;
    const hard=b&&['commercial','office','industrial','warehouse'].includes(b.use);
    polygonMaterial(ctx,p.points,hard?'paving':'grass',seed(p.block||p.id));
    if(b&&scale>.28){
      // Access paths are clipped to the lot so decoration never cuts roads.
      ctx.save();path(ctx,p.points);ctx.clip();ctx.strokeStyle=material(ctx,'paving',seed(p.id));ctx.lineWidth=2.1;
      path(ctx,[p.frontage||p.center,b.center||p.center],false);ctx.stroke();ctx.restore();
    }
  }
  function castVolumes(ctx,volumes,scale){
    if(settings.quality==='map'||scale<.16||sun().elevation<=0)return;
    const shape=new Path2D();
    function add(ps){let area=0;ps.forEach((a,i)=>{const b=ps[(i+1)%ps.length];area+=a[0]*b[1]-b[0]*a[1];});if(area<0)ps=ps.slice().reverse();ps.forEach((p,i)=>i?shape.lineTo(...p):shape.moveTo(...p));shape.closePath();}
    for(const volume of volumes){
      const v=shadowOffset(volume.height),vertices=volume.points.slice();
      if(vertices.length>2&&vertices[0][0]===vertices.at(-1)[0]&&vertices[0][1]===vertices.at(-1)[1])vertices.pop();
      add(vertices);add(vertices.map(p=>[p[0]+v[0],p[1]+v[1]]));
      vertices.forEach((a,i)=>{const b=vertices[(i+1)%vertices.length];add([a,b,[b[0]+v[0],b[1]+v[1]],[a[0]+v[0],a[1]+v[1]]]);});
    }
    ctx.save();ctx.fillStyle=`rgba(30,40,52,${sun().strength})`;ctx.fill(shape);ctx.restore();
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
    ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.filter=`blur(${Math.min(2.5,Math.max(.6,scale*.35))}px)`;ctx.drawImage(shadowLayer,0,0);ctx.restore();
  }
  function roofLift(height){return Math.min(85,height*.26);}
  function facadeFaces(volume){
    const points=volume.points,area=points.reduce((n,a,i)=>{const z=points[(i+1)%points.length];return n+a[0]*z[1]-z[0]*a[1];},0),faces=[];
    for(let i=1;i<points.length;i++){
      const a=points[i-1],z=points[i],dx=z[0]-a[0],dy=z[1]-a[1],length=Math.hypot(dx,dy);
      const normal=(area>0?-1:1)*dx;
      if(length>.5&&normal>.05)faces.push({a,z,dx,dy,length});
    }return faces;
  }
  function facadeWindows(volume,floors){
    const result=[],top=roofLift(volume.height),bottom=roofLift(volume.base||0),rows=Math.max(1,Math.min(12,Math.round(floors*(volume.height-(volume.base||0))/volume.height)));
    if(top-bottom<1)return result;
    for(const face of facadeFaces(volume)){
      const {a,dx,dy,length}=face,cols=Math.max(1,Math.floor(length/3.8));
      for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
        const ta=(col+.24)/cols,tb=(col+.73)/cols,lo=bottom+(row+.23)*(top-bottom)/rows,hi=bottom+(row+.73)*(top-bottom)/rows;
        result.push([[a[0]+dx*ta,a[1]+dy*ta-lo],[a[0]+dx*tb,a[1]+dy*tb-lo],[a[0]+dx*tb,a[1]+dy*tb-hi],[a[0]+dx*ta,a[1]+dy*ta-hi]]);
      }
    }return result;
  }
  function drawBuildingVolume(ctx,p,volume,scale){
    const b=p.building,points=volume.points,lift=roofLift(volume.height),baseLift=roofLift(volume.base||0),roof=points.map(([x,y])=>[x,y-lift]);
    const palette=b.use==='residential'?['#d7c8ae','#c5c1ac','#c6b59d','#b8c1bb']:b.use==='office'?['#b4c1c5','#c6cecc','#a4b3b8','#d1d1c5']:['#c7c3b2','#b9c0bc','#d1c6ae','#b1bab9'];
    const tint=palette[(b.roof||0)%4];
    for(const face of facadeFaces(volume)){
      const {a,z,dx,dy,length}=face,angle=sun().azimuth*Math.PI/180,lightness=45+12*(dy*Math.cos(angle)-dx*Math.sin(angle))/length;
      path(ctx,[[a[0],a[1]-baseLift],[z[0],z[1]-baseLift],[z[0],z[1]-lift],[a[0],a[1]-lift]]);
      const options=b.use==='office'?[2,8,9,10,11]:b.use==='residential'?[0,1,2,4,5,6]:[0,2,3,7,8,10],variant=options[seed(p.id+':facade')%options.length];
      ctx.save();ctx.clip();ctx.transform(dx/length,dy/length,0,-.26,a[0],a[1]);ctx.fillStyle=material(ctx,b.landmark==='cbd_skyscraper'?'glass':'facade',variant);ctx.fillRect(0,volume.base||0,length,volume.height-(volume.base||0));ctx.restore();
      ctx.fillStyle=`rgba(23,38,44,${.14+(62-lightness)/100})`;ctx.fill();
      if(scale>.9){ctx.strokeStyle='#283d4140';ctx.lineWidth=.16;ctx.stroke();}
    }
    if(scale>.8&&volume.type!=='terrace'){
      ctx.fillStyle=material(ctx,'glass',seed(p.id));
      for(const window of facadeWindows(volume,b.floors||1)){path(ctx,window);ctx.fill();}
    }
    const roofChoices=[0,1,2,3,4,7,0,1,2,3,4,7,5,6];
    polygonMaterial(ctx,roof,volume.type==='terrace'?'paving':'roof',volume.type==='terrace'?seed(p.block||p.id):roofChoices[seed(p.id+':roof')%roofChoices.length]);
    ctx.save();path(ctx,roof);ctx.clip();
    const [x0,y0,x1,y1]=bounds(roof);ctx.globalAlpha=volume.type==='terrace'?.1:.12;ctx.fillStyle=tint;ctx.fillRect(x0,y0,x1-x0,y1-y0);ctx.globalAlpha=1;

    if(sun().warmth>.005){ctx.fillStyle='#f0b75d';ctx.globalAlpha=sun().warmth;ctx.fillRect(x0,y0,x1-x0,y1-y0);ctx.globalAlpha=1;}
    ctx.restore();
    root.CityOrdinaryRoofs?.drawCanvas(ctx,p,volume,api);
    path(ctx,roof);ctx.strokeStyle=volume.type==='terrace'?'#92998c':'#5a68633d';ctx.lineWidth=.25;ctx.stroke();
    if(volume.type!=='house'&&volume.type!=='hall'){
      ctx.save();path(ctx,roof);ctx.clip();ctx.strokeStyle='#eeeee2';ctx.lineWidth=.55;ctx.stroke();ctx.restore();
    }
  }
  function building(ctx,p,scale){
    const b=p.building,points=b.footprint;
    if(b.status==='construction'){
      polygonMaterial(ctx,points,'soil',seed(p.id));ctx.save();path(ctx,points);ctx.clip();const [x,y,x1,y1]=bounds(points);
      ctx.strokeStyle='#b9a16b';ctx.lineWidth=.5;for(let i=x;i<x1;i+=5){path(ctx,[[i,y],[i,y1]],false);ctx.stroke();}for(let j=y;j<y1;j+=5){path(ctx,[[x,j],[x1,j]],false);ctx.stroke();}ctx.restore();return;
    }
    const m=root.CityGeometry.buildingMassing(p);
    if(m.podium)drawBuildingVolume(ctx,p,m.podium,scale);
    for(const volume of m.volumes.slice().sort((a,b)=>bounds(a.points)[3]-bounds(b.points)[3]||a.height-b.height))drawBuildingVolume(ctx,p,volume,scale);
  }
  function treesFor(p){
    if(layouts.has(p))return layouts.get(p);
    const result=[],b=p.building,points=p.points;if(!points)return result;
    const [x0,y0,x1,y1]=bounds(points),rng=random(p.id||points[0].join(','));
    const park=p.kind==='park'||p.use==='protected',plaza=p.kind==='plaza',industrial=b&&['industrial','warehouse'].includes(b.use);
    const mix=materialCatalog.treeMixes[plaza?'plaza':park?'park':industrial?'industrial':'garden'];
    const dominant=mix[seed((p.id||'')+':trees')%Math.min(8,mix.length)],step=park?6.8:plaza?8.5:industrial?12:8;
    const stride=Math.max(step,Math.sqrt((x1-x0)*(y1-y0)/220));
    const nx=Math.max(1,Math.floor((x1-x0)/stride)),ny=Math.max(1,Math.floor((y1-y0)/stride));
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
      const species=rng()<.8?dominant:mix[Math.floor(rng()*mix.length)],type=materialCatalog.tree(species);
      const point=[x0+(i+.5)*(x1-x0)/nx+(rng()-.5)*2,y0+(j+.5)*(y1-y0)/ny+(rng()-.5)*2];
      const radius=type.radius[0]+rng()*(type.radius[1]-type.radius[0]);
      if(!inside(point,points)||edgeDistance(point,points)<Math.min(2.2,radius*.52))continue;
      if(b&&(inside(point,b.footprint)||edgeDistance(point,b.footprint)<radius+1))continue;
      if(park&&p.point&&edgeDistance(point,[[x0,p.point[1]],p.point,[x1,y1]])<1.6)continue;
      if(plaza&&(edgeDistance(point,points)>6||p.point&&Math.hypot(point[0]-p.point[0],point[1]-p.point[1])<radius+10))continue;
      if(result.some(t=>Math.hypot(point[0]-t.point[0],point[1]-t.point[1])<(radius+t.radius)*.64))continue;
      if(industrial&&rng()<.35)continue;
      result.push({point,radius,species:type.id,variant:species+Math.floor(rng()*4)*materialCatalog.treeSpecies.length,height:type.height[0]+rng()*(type.height[1]-type.height[0])});
    }
    layouts.set(p,result);return result;
  }
  function treeSprite(variant,lit=true){
    const hour=Math.floor(sun().hour);if(hour!==spriteHour){sprites.clear();spriteHour=hour;}
    const key=variant+':'+lit;if(sprites.has(key))return sprites.get(key);
    const c=canvas(160),ctx=c.getContext('2d'),rng=random(variant),angle=sun().azimuth*Math.PI/180,lx=Math.cos(angle),ly=Math.sin(angle);
    const species=materialCatalog.tree(variant),atlas=canopyAtlases[species.atlas];
    if(atlas){
      const tile=species.cell,size=atlas.width/species.columns;
      ctx.imageSmoothingQuality='high';ctx.save();ctx.translate(80,80);ctx.rotate(Math.floor(variant/materialCatalog.treeSpecies.length)*1.57);ctx.drawImage(atlas,tile%species.columns*size,Math.floor(tile/species.columns)*size,size,size,-72,-72,144,144);ctx.restore();
      if(lit){ctx.globalCompositeOperation='source-atop';
      const light=ctx.createLinearGradient(80-lx*70,80-ly*70,80+lx*70,80+ly*70);light.addColorStop(0,'#142d262b');light.addColorStop(.5,'#85934a00');light.addColorStop(1,'#e6d28638');ctx.fillStyle=light;ctx.fillRect(0,0,160,160);
      ctx.globalCompositeOperation='source-over';}sprites.set(key,c);return c;
    }
    const hue=77+variant%8*3,saturation=27+variant%3*5;
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
  function streetTreesFor(state){
    if(streetTreeCache.has(state.network))return streetTreeCache.get(state.network);
    const trees=[],occupied=state.parcels.filter(p=>p.building).map(p=>p.building.footprint);
    for(const r of state.roads){
      if(r.level!==0||!['street','avenue'].includes(r.kind))continue;
      const cfg=state.meta.roadTypes[r.kind],length=r.points.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-r.points[i][0],p[1]-r.points[i][1]),0),rng=random(r.id+':avenue-trees');
      const mix=materialCatalog.treeMixes.street,species=mix[seed(r.id+':species')%mix.length],type=materialCatalog.tree(species);
      const junctions=state.network.junctions.flatMap(j=>j.approaches.filter(a=>a.road===r.id).map(a=>({distance:a.distance,clear:Math.max(...j.approaches.map(q=>q.width))/2+16})));
      for(let d=25;d<length-15;d+=12){
        if(junctions.some(j=>Math.abs(d-j.distance)<j.clear))continue;
        const at=root.RoadRenderer.sample(r.points,d);
        for(const side of [-1,1]){
          const radius=Math.min(r.kind==='avenue'?4.8:3.8,type.radius[0]+rng()*.8),offset=side*(cfg.width/2+(r.kind==='avenue'?3.3:2.35)),point=[at.point[0]-at.tangent[1]*offset,at.point[1]+at.tangent[0]*offset];
          if(occupied.some(points=>inside(point,points)||edgeDistance(point,points)<radius*.7+1))continue;
          trees.push({point,radius,species:type.id,variant:species+Math.floor(rng()*4)*materialCatalog.treeSpecies.length,height:type.height[0]*.7+rng()*3,street:true});
        }
      }
    }
    streetTreeCache.set(state.network,trees);return trees;
  }
  function treeShadow(variant){
    if(treeShadows.has(variant))return treeShadows.get(variant);
    const c=canvas(160),ctx=c.getContext('2d');ctx.filter='blur(1.2px)';ctx.drawImage(treeSprite(variant),0,0);ctx.filter='none';ctx.globalCompositeOperation='source-in';ctx.fillStyle='#132725';ctx.fillRect(0,0,160,160);treeShadows.set(variant,c);return c;
  }
  function vegetation(ctx,objects,scale,visible,streetTrees=[]){
    if(scale<.32)return;
    const all=streetTrees.filter(t=>visible(t.point));
    for(const obj of objects)for(const tree of treesFor(obj))if(visible(tree.point))all.push(tree);
    for(const t of all){
      if(settings.quality==='map'||sun().elevation<=0)continue;
      const v=shadowOffset(t.height),r=t.radius*1.3;ctx.save();ctx.globalAlpha=sun().strength*.7;
      for(const f of [.45,.85])ctx.drawImage(treeShadow(t.variant),t.point[0]+v[0]*f-r,t.point[1]+v[1]*f-r,r*2,r*2);ctx.restore();
    }
    for(const t of all.sort((a,b)=>a.point[1]-b.point[1])){
      const [x,y]=t.point,r=t.radius,cy=y-t.height*.16;
      if(t.street){ctx.fillStyle=material(ctx,'soil',3);ctx.strokeStyle='#d6d4bd';ctx.lineWidth=.2;ctx.fillRect(x-1,y-1,2,2);ctx.strokeRect(x-1,y-1,2,2);}
      ctx.strokeStyle='#665b44';ctx.lineWidth=.32;path(ctx,[[x,y],[x,cy]],false);ctx.stroke();
      if(settings.quality==='map'||scale<.7){const gr=ctx.createRadialGradient(x-r*.3,y-r*.3,.1,x,y,r);gr.addColorStop(0,'#96aa60');gr.addColorStop(1,'#3b6040');ctx.fillStyle=gr;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();}
      else ctx.drawImage(treeSprite(t.variant),x-r*1.15,cy-r*1.15,r*2.3,r*2.3);
    }
  }
  function facilityGround(ctx,f,scale){
    if(!f.points)return;
    polygonMaterial(ctx,f.points,f.kind==='park'?'grass':'paving',f.kind==='plaza'?0:seed(f.id));
    ctx.strokeStyle='#c5c4ae';ctx.lineWidth=.28;path(ctx,f.points);ctx.stroke();
    if(f.kind==='park'&&scale>.4){
      ctx.save();path(ctx,f.points);ctx.clip();const [x0,y0,x1,y1]=bounds(f.points);ctx.strokeStyle=material(ctx,'paving');ctx.lineWidth=2;
      path(ctx,[[x0,f.point[1]],[f.point[0],f.point[1]],[x1,y1]],false);ctx.stroke();ctx.restore();
    }
    if(f.kind==='plaza'&&!f.blockCommon&&scale>.5){
      ctx.save();path(ctx,f.points);ctx.clip();ctx.translate(...f.point);const box=bounds(f.points),r=Math.min(6,(box[2]-box[0])/5,(box[3]-box[1])/5);
      ctx.strokeStyle='#777c7338';ctx.lineWidth=.11;for(const q of [r+3,r+6,r+9]){ctx.beginPath();ctx.arc(0,0,q,0,Math.PI*2);ctx.stroke();}for(let i=0;i<20;i++){const a=i*Math.PI/10;path(ctx,[[Math.cos(a)*(r+1),Math.sin(a)*(r+1)],[Math.cos(a)*(r+9),Math.sin(a)*(r+9)]],false);ctx.stroke();}
      ctx.fillStyle='#303e414f';ctx.beginPath();ctx.arc(1,1,r+1,0,Math.PI*2);ctx.fill();ctx.fillStyle='#d6d3c6';ctx.beginPath();ctx.arc(0,0,r+1,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=material(ctx,'water',3);ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#e6eeee90';ctx.lineWidth=.22;
      for(let i=1;i<4;i++){ctx.beginPath();ctx.arc(0,0,r*i/4,0,Math.PI*2);ctx.stroke();}ctx.fillStyle='#f4f8ef';ctx.beginPath();ctx.arc(-.25,-.25,.65,0,Math.PI*2);ctx.fill();ctx.restore();
    }
  }
  function roadSurfaces(ctx,roads,types,scale,level){
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
    if(level>0&&settings.quality!=='map'&&sun().elevation>0)for(const r of roads){ctx.save();ctx.translate(...shadowOffset(6));path(ctx,r.points,false);ctx.lineWidth=types[r.kind].width+4;ctx.strokeStyle=`rgba(36,51,69,${sun().strength})`;ctx.stroke();ctx.restore();}
    for(const pass of ['sidewalk','curb','surface'])for(const r of roads){
      const cfg=types[r.kind],motor=motorKinds.has(r.kind),rail=!motor&&r.kind!=='path',walk=cfg.walk&&level===0&&motor;
      path(ctx,r.points,false);ctx.setLineDash(level<0?[7/scale,4/scale]:[]);
      if(pass==='sidewalk'){
        if(!walk)continue;ctx.lineWidth=cfg.width+(r.kind==='avenue'?9:6);ctx.strokeStyle=material(ctx,'paving',seed(r.id));
      }else if(pass==='curb'){
        ctx.lineWidth=Math.max(cfg.width+1.1,2/scale);ctx.strokeStyle=material(ctx,rail?'gravel':'curb',seed(r.id));
      }else{
        ctx.lineWidth=Math.max(cfg.width,rail?1.5/scale:1/scale);ctx.strokeStyle=material(ctx,motor?'asphalt':rail?'gravel':'paving',seed(r.id));
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);ctx.restore();
  }
  function vehicle(ctx,car,scale){
    const style=variation.vehicle(car.id);
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
        for(const side of [-1,1])lamps.push({point:[at.point[0]+n[0]*(cfg.width/2+1.8)*side,at.point[1]+n[1]*(cfg.width/2+1.8)*side],arm:[-n[0]*1.5*side,-n[1]*1.5*side]});
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
      const lampY=y+dy-(solid?(lamp.height||5.1)*root.CityScene3D.tilt:0);
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
      ctx.save();ctx.translate(...car.point);ctx.rotate(car.heading);
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
  const api={materialMeters,configure,resolveQuality,get effectiveQuality(){return effectiveQuality;},get settings(){return {...settings};},get time(){return clockSeconds;},get assetsReady(){return Object.keys(canopyAtlases).length===2&&Object.keys(atlases).length===4;},get materialInventory(){return Object.fromEntries(Object.keys(materialCatalog.catalog).map(n=>[n,materialCatalog.count(n)]));},get treeSpecies(){return materialCatalog.treeSpecies;},lightingAt,setTime,shadowOffset,seed,random,inside,edgeDistance,treesFor,streetTreesFor,material,texture,treeSprite,lampsFor,ground,water,parcel,castShadow,buildingShadow,buildingShadows,facadeFaces,facadeWindows,building,vegetation,facilityGround,roadSurfaces,vehicle,atmosphere};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CityScene=api;
})(typeof window==='undefined'?{}:window);
