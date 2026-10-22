const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const variation=require('../renderer/surface-variation.js');

function pixels(width,height,rgb,alpha=255){
  const result=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<result.length;i+=4)result.set([...rgb,alpha],i);
  return result;
}

test('vehicle exposure removes a narrow paint highlight without changing alpha, dark glass, or a white roof',()=>{
  const size=32,source=pixels(size,size,[140,25,30]);
  for(let y=8;y<25;y++)for(let x=9;x<23;x++)source.set([34,45,56,255],(y*size+x)*4);
  for(let y=12;y<22;y++)source.set([250,241,238,255],(y*size+27)*4);
  source.set([255,255,255,0],0);
  const before=source.slice(),out=variation.vehicleDiffuse(source,size,size,{model:'bmw-z4-red',color:'#b5232d'});
  assert(out[(16*size+27)*4]<225,'a sharp studio reflection is compressed into the surrounding paint');
  assert.deepEqual(Array.from(out.slice((12*size+16)*4,(12*size+16)*4+4)),[34,45,56,255]);
  for(let p=3;p<source.length;p+=4)assert.equal(out[p],source[p],'the original silhouette is unchanged');
  assert.deepEqual(source,before,'preprocessing does not mutate the source atlas');
  const white=pixels(size,size,[239,240,236]);
  assert.deepEqual(variation.vehicleDiffuse(white,size,size,{model:'white-sedan',color:'#eef0eb'}),white,
    'broad white paint is not interpreted as an overexposed highlight');
});

test('directional illumination fields leave translucent edges untouched and reverse their light with the sun',()=>{
  const size=32,source=pixels(size,size,[185,34,40]);
  for(let y=0;y<size;y++)source[(y*size+31)*4+3]=128;
  source[3]=0;
  const fields=variation.vehicleLightFields(source,size,size,{model:'red-sedan',color:'#b5232d'});
  const at=(cell,x,y)=>((y+(cell>>1)*size)*size*2+x+(cell%2)*size)*4;
  for(let cell=0;cell<4;cell++){
    assert.equal(fields[at(cell,0,0)+3],0);
    for(let y=0;y<size;y++)assert.equal(fields[at(cell,31,y)+3],0,'lighting cannot build a halo on the antialias fringe');
  }
  const positive=at(0,27,16),negative=at(1,27,16);
  assert(fields[positive]>fields[negative]);
  assert(fields[positive+3]>0&&fields[negative+3]>0);
  const sun={azimuth:30,elevation:40,strength:.28},a=variation.vehicleLightWeights(0,sun),b=variation.vehicleLightWeights(Math.PI,sun);
  assert(Math.abs(a[0]+b[0])<1e-12&&Math.abs(a[1]+b[1])<1e-12,'turning reverses local lighting while the world sun stays fixed');
  assert.deepEqual(variation.vehicleLightWeights(0,{azimuth:0,elevation:-12,strength:0}).map(Math.abs),[0,0]);
});

test('turning a loaded vehicle and changing the sun reuse all paint, illumination, and shadow bitmaps',()=>{
  const images=[],counts={canvases:0,reads:0,filters:0};
  function context(canvas={width:1,height:1}){
    const stack=[],ctx={canvas,globalAlpha:1,drawImage(){},translate(){},rotate(){},fillRect(){},
      save(){stack.push(this.globalAlpha);},restore(){this.globalAlpha=stack.pop();},
      createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},
      getImageData(_x,_y,w,h){counts.reads++;return {data:pixels(w,h,[180,39,42])};},putImageData(){}};
    Object.defineProperty(ctx,'filter',{set(){counts.filters++;}});return ctx;
  }
  const document={createElement(){counts.canvases++;const c={width:0,height:0};const ctx=context(c);c.getContext=()=>ctx;return c;}};
  class Image {constructor(){this.width=this.height=1254;images.push(this);}}
  const window={SceneMaterials:require('../renderer/material-catalog.js'),SurfaceVariation:variation,
    SceneRasterCache:require('../renderer/raster-cache.js')};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../renderer/scene-renderer.js'),'utf8'),{window,document,Image});
  for(const image of images)if(image.src.startsWith('assets/vehicles'))image.onload();
  const ctx=context(),car={id:21,point:[10,10],heading:0,speed:4};
  window.CityScene.vehicle(ctx,car,12);
  const warm={...counts};
  for(const hour of [8,12,18,23])for(const heading of [0,Math.PI/2,Math.PI,-Math.PI/2,.17]){
    window.CityScene.setTime(hour*3600);window.CityScene.vehicle(ctx,{...car,heading},12);
  }
  assert.deepEqual(counts,warm,'heading and time changes must not create a canvas, read pixels, or run a filter');
  const stats=window.CityScene.stats;
  assert.equal(stats.vehicleSprites,1);assert.equal(stats.vehicleShadows,1);assert.equal(stats.vehicleLighting.entries,1);
  assert.equal(stats.vehicleLighting.limit,96);assert(stats.vehicleLighting.bytes<=stats.vehicleLighting.budget);
  assert.equal(ctx.globalAlpha,1,'vehicle lighting restores the caller opacity');
});

test('rotated building parking keeps the car in its bay while the cast shadow stays aligned with the world sun',()=>{
  const images=[];
  function context(draws=[]){
    let matrix=[1,0,0,1,0,0];const stack=[];
    const ctx={globalAlpha:1,beginPath(){},moveTo(){},lineTo(){},stroke(){},fillRect(){},
      save(){stack.push({matrix:matrix.slice(),alpha:this.globalAlpha});},
      restore(){const state=stack.pop();matrix=state.matrix;this.globalAlpha=state.alpha;},
      translate(x,y){matrix[4]+=matrix[0]*x+matrix[2]*y;matrix[5]+=matrix[1]*x+matrix[3]*y;},
      rotate(angle){const [a,b,c,d]=matrix,cos=Math.cos(angle),sin=Math.sin(angle);
        matrix[0]=a*cos+c*sin;matrix[1]=b*cos+d*sin;matrix[2]=c*cos-a*sin;matrix[3]=d*cos-b*sin;},
      drawImage(image,...args){
        const [x,y,w,h]=args.length===4?args:args.slice(4),cx=x+w/2,cy=y+h/2;
        draws.push({image,args:args.length,alpha:this.globalAlpha,width:w,length:h,
          center:[matrix[0]*cx+matrix[2]*cy+matrix[4],matrix[1]*cx+matrix[3]*cy+matrix[5]],
          front:[-matrix[2],-matrix[3]]});
      },
      createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},
      getImageData(_x,_y,w,h){return {data:pixels(w,h,[180,39,42])};},putImageData(){}};
    return ctx;
  }
  const document={createElement(){const c={width:0,height:0},ctx=context();c.getContext=()=>ctx;return c;}};
  class Image {constructor(){this.width=this.height=1254;images.push(this);}}
  const lot={point:[100,80],width:4,depth:8,angle:0}; // One bay, offset from the lot centre.
  const window={SceneMaterials:require('../renderer/material-catalog.js'),SurfaceVariation:variation,
    SceneRasterCache:require('../renderer/raster-cache.js'),CityScene3D:{parkingFor:()=>lot},
    CityGeometry:{buildingMassing:()=>({volumes:[]})}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../renderer/scene-renderer.js'),'utf8'),{window,document,Image});
  for(const image of images)if(image.src.startsWith('assets/vehicles'))image.onload();
  const scene=window.CityScene;scene.configure({quality:'map'});scene.setTime(9*3600);
  const id=Array.from({length:100},(_,i)=>'rotated-parking-'+i).find(id=>scene.random(id+':parking')()>.24);
  assert(id,'fixture supplies one occupied bay');
  const parcel={id,building:{status:'active'}},before=JSON.stringify(parcel),sun=scene.shadowOffset(1,scene.lightingAt(9*3600));
  const close=(actual,expected,label)=>assert(Math.abs(actual-expected)<1e-9,label);
  let firstBody,firstOffset;
  for(const angle of [0,Math.PI/2,Math.PI*.29]){
    lot.angle=angle;const draws=[];scene.building(context(draws),parcel,12);
    const bodies=draws.filter(d=>d.args===4&&d.alpha===1),shadows=draws.filter(d=>d.args===4&&d.alpha<1);
    assert.equal(bodies.length,1,'one loaded vehicle sprite occupies the single bay');
    assert.equal(shadows.length,2,'the car has contact and solar shadows');
    const body=bodies[0],bayY=-lot.depth/2+2.75;
    close(body.center[0],lot.point[0]-bayY*Math.sin(angle),'car x follows the rotated bay');
    close(body.center[1],lot.point[1]+bayY*Math.cos(angle),'car y follows the rotated bay');
    close(body.front[0],Math.sin(angle),'the car nose follows the bay heading');
    close(body.front[1],-Math.cos(angle),'the car nose follows the bay heading');
    const cast=shadows.find(d=>Math.hypot(d.center[0]-body.center[0],d.center[1]-body.center[1])>1e-6);
    assert(cast,'the solar shadow is offset from the contact shadow');
    const offset=cast.center.map((v,i)=>v-body.center[i]);
    close(offset[0]*sun[1]-offset[1]*sun[0],0,'solar shadow stays parallel to the world sun');
    assert(offset[0]*sun[0]+offset[1]*sun[1]>0,'solar shadow points away from the sun');
    if(firstBody){
      assert.equal(body.image,firstBody.image,'rotating the lot preserves the selected vehicle model');
      close(body.width,firstBody.width,'vehicle width is preserved');close(body.length,firstBody.length,'vehicle length is preserved');
      close(offset[0],firstOffset[0],'lot rotation does not rotate solar shadow x');
      close(offset[1],firstOffset[1],'lot rotation does not rotate solar shadow y');
    }else{firstBody=body;firstOffset=offset;}
  }
  assert.equal(JSON.stringify(parcel),before,'parking rendering does not modify saved building data');
});
