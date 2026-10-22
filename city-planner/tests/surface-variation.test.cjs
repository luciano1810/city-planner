const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const surfaces=require('../renderer/surface-variation.js');

function source(){const a=new Uint8ClampedArray(256*256*4);for(let y=0;y<256;y++)for(let x=0;x<256;x++){const i=(y*256+x)*4;a[i]=100+30*Math.sin(x*Math.PI/32)+12*Math.cos(y*Math.PI/64);a[i+1]=a[i]+10;a[i+2]=a[i]+15;a[i+3]=255;}return a;}

test('precomputed material sampling preserves the original bytes across field modes and source periods',()=>{
  // Captured from the original scalar sampler before moving rotations, blend
  // weights and paving coordinates out of its million-pixel loop.
  const cases=[
    ['asphalt',0,328,5,256,'dd8b683f0361595ac4a2d9ed17de36a658dbe226e83144b3e6ea3dee1949d96a'],
    ['roof',7,-2147483648,6,256,'de7ce853ddc9ca8b379cc62a79fa9c624b57acc1e033c187917d44182735bb0b'],
    ['grass',3,4294967295,3.5,256,'793dcced25fd83017c4febf7d431e0e4a6b7dd95d057dc234d45e3838c35a01f'],
    ['facade',11,-113,2.4,256,'f31370cc74a7d92d53bda49a07d384c4376aa1fd3293547b4428ee6c0e06ad4e'],
    ['metal',2,0,4,127,'39413055f4f9cb812aa3ec210aeb8c3802860f920ac3ce45fb22e593a43f6a8b'],
    ['paving',1,-9001,4.8,256,'5036c9bef640b345f5ca761eca58a5404766f656d8812bed418beb01ff423200'],
    ['pavingWarm',7,42,4.8,73,'95dd3f9ad38d08f65714663cc0257ed209df622027c6754391552aeb275dbed0'],
    ['gravel',2,991,3,64,'5321a9e629b3319a8fe7982ee9953e928870cf2a5b2c948a21e17091df2c73c8'],
    ['carPaint',5,-42,3,17,'9a41a9eb4dd0095144dbe3e15129bd7423cbac333776c3cd70254512e1c230af']
  ];
  const digest=pixels=>createHash('sha256').update(pixels).digest('hex');
  for(const [name,variant,seed,meters,size,expected] of cases){
    const input=new Uint8ClampedArray(size*size*4);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const i=(y*size+x)*4;
      input[i]=(x*17+y*31+x*y%97)&255;input[i+1]=(x*5^y*23)&255;
      input[i+2]=(x*x+3*y*y+11*x*y)&255;input[i+3]=(x+y*3)&255;
    }
    const before=digest(input),actual=surfaces.synthesize(input,size,name,variant,seed,meters);
    assert.equal(digest(actual),expected,`${name}, variant ${variant}, seed ${seed}, source ${size}`);
    assert.equal(digest(input),before,'the source atlas is immutable');
    assert.notStrictEqual(actual,input,'even the unexpanded material returns an independent image');
  }
});

test('atlas sampling discards detached neighbours but preserves the main crown and translucent edge',()=>{
  const pixels=new Uint8ClampedArray(12*12*4),put=(x,y,alpha)=>pixels.set([30,120,50,alpha],(y*12+x)*4);
  for(let y=4;y<8;y++)for(let x=4;x<8;x++)put(x,y,255);
  put(3,5,18);put(1,1,255);put(1,2,255);put(10,8,12);
  surfaces.isolateSprite(pixels,12,12);
  assert.equal(pixels[(5*12+3)*4+3],18);
  assert.deepEqual([...pixels.slice((5*12+5)*4,(5*12+5)*4+4)],[30,120,50,255]);
  for(const [x,y] of [[1,1],[1,2],[10,8]])assert.equal(pixels[(y*12+x)*4+3],0);
  const empty=new Uint8ClampedArray(16);assert.deepEqual(surfaces.isolateSprite(empty,2,2),empty);
});

test('stochastic fields remain deterministic, opaque and break the original repeat period',()=>{
  const input=source(),a=surfaces.synthesize(input,256,'asphalt',0,328,5),b=surfaces.synthesize(input,256,'asphalt',0,328,5);
  assert.deepEqual(a,b);assert.equal(a.length,1024*1024*4);
  let shifted=0,adjacent=0,seam=0;
  for(let y=0;y<1024;y+=13){
    seam+=Math.abs(a[y*1024*4]-a[(y*1024+1023)*4]);
    for(let x=0;x<800;x+=19){const i=(y*1024+x)*4;shifted+=Math.abs(a[i]-a[i+128*4]);adjacent+=Math.abs(a[i]-a[i+4]);assert.equal(a[i+3],255);}
  }
  assert(shifted>adjacent*3,'a former tile step must expose a different surface');
  assert(seam/79<7,'texture field must wrap without a hard boundary');
});

test('paving preserves regular joints while each slab varies, and surface scale matches the new atlas',()=>{
  const input=new Uint8ClampedArray(256*256*4).fill(160),p=surfaces.synthesize(input,256,'paving',0,42,4.8);
  const at=(x,y)=>p[(y*1024+x)*4];assert(at(0,20)<at(10,20));
  assert(new Set(Array.from({length:10},(_,i)=>at(10+i*21,10))).size>3);
  const scene=require('../renderer/scene-renderer.js');assert.equal(scene.materialMeters('asphalt'),40);assert.equal(scene.materialMeters('paving'),38.4);
});

test('neighbouring car IDs do not cycle through the same atlas row and restore the same appearance',()=>{
  const styles=Array.from({length:200},(_,id)=>surfaces.vehicle(id));
  assert.equal(new Set(styles.map(s=>s.cell)).size,16);
  assert(styles.filter((s,i)=>i<184&&s.cell!==styles[i+16].cell).length>160);
  for(let id=0;id<200;id++){assert.deepEqual(styles[id],surfaces.vehicle(id));assert(styles[id].length*styles[id].scale<5.5);assert(styles[id].width*styles[id].scale<2.2);}
});
test('expanded fleet reaches every real-car sprite while preserving legacy vehicles and stable selection',()=>{
  const styles=Array.from({length:3000},(_,id)=>surfaces.vehicle(id));
  assert.equal(new Set(styles.filter(s=>s.spriteAtlas==='vehicles-real').map(s=>s.spriteCell)).size,16);
  assert.equal(new Set(styles.filter(s=>s.spriteAtlas==='vehicles').map(s=>s.spriteCell)).size,16);
  assert.equal(new Set(styles.filter(s=>s.spriteAtlas==='vehicles-sport').map(s=>s.spriteCell)).size,4);
  for(const name of ['xpeng-p7-silver','xpeng-p7-green','xiaomi-su7-blue','xiaomi-su7-purple'])assert(styles.some(s=>s.model===name));
  for(const model of [...surfaces.realVehicles,...surfaces.sportVehicles])assert(styles.some(s=>s.model===model.id),model.name);
  for(const s of styles){const layout=surfaces.vehicleAtlases[s.spriteAtlas];assert(layout);assert(s.spriteCell>=0&&s.spriteCell<layout.columns*layout.rows);assert(s.length/s.width>2);}
});
test('Z4 and Challenger use their own 2 by 2 atlas with shorter roadster proportions',()=>{
  assert.deepEqual(surfaces.vehicleAtlases['vehicles-sport'],{columns:2,rows:2});
  assert.deepEqual(surfaces.sportVehicles.map(v=>v.id),['bmw-z4-red','bmw-z4-blue','dodge-challenger-orange','dodge-challenger-purple']);
  const [z4,,challenger]=surfaces.sportVehicles;
  assert(z4.length<challenger.length-.5);assert(z4.width<challenger.width);
  assert.equal(surfaces.realVehicles.length,16,'the earlier P7, SU7 and sedan atlas remains intact');
});
