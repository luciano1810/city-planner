const test=require('node:test');
const assert=require('node:assert/strict');
const surfaces=require('../renderer/surface-variation.js');

function source(){const a=new Uint8ClampedArray(256*256*4);for(let y=0;y<256;y++)for(let x=0;x<256;x++){const i=(y*256+x)*4;a[i]=100+30*Math.sin(x*Math.PI/32)+12*Math.cos(y*Math.PI/64);a[i+1]=a[i]+10;a[i+2]=a[i]+15;a[i+3]=255;}return a;}

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
