const test=require('node:test');
const assert=require('node:assert/strict');
const special=require('../renderer/special-buildings.js');
const geometry=require('../renderer/city-geometry.js');

test('manual buildings and both parking forms produce finite shared metric layouts',()=>{
  for(const [kind,w,d] of [['airport',1000,360],['port',320,240],['train_station',180,80],['parking_lot',32,24],['parking_garage',32,24]]){
    const f={id:'test-'+kind,kind,width:w,depth:d,origin:[1500,1500],point:[1500,1500],rotation:37,floors:4,height:12.8};
    const l=special.layout(f);
    assert(l.boxes.length>3);assert(l.surfaces.length>0);
    let boxes=0;
    special.build3D({box(...args){boxes++;assert(args.slice(0,7).every(Number.isFinite));},triangle(mat,pts){assert(pts.flat().every(Number.isFinite));},quad(mat,pts){assert(pts.flat().every(Number.isFinite));}},f,{material:()=>({}),solid:()=>({})});
    assert(boxes>=l.boxes.length);
    assert.deepEqual(l,special.layout(structuredClone(f)));
  }
});

test('CBD towers have stepped, enclosed massing with the persisted total height',()=>{
  for(let variant=0;variant<3;variant++){
    const p={center:[0,0],building:{center:[0,0],footprint:[[-14,-12],[14,-12],[14,12],[-14,12],[-14,-12]],use:'office',height:160,floors:41,landmark:'cbd_skyscraper',towerVariant:variant}};
    const masses=geometry.buildingMassing(p).volumes;
    assert(masses.length>=3);
    assert.equal(Math.max(...masses.map(v=>v.height)),160);
    assert(masses.every(v=>v.points.every(q=>q[0]>=-14&&q[0]<=14&&q[1]>=-12&&q[1]<=12)));
    assert(masses.slice(1).every((v,i)=>v.height>masses[i].height));
  }
});

test('all twenty automatic facilities have distinct finite enclosed architecture',()=>{
  const civic=require('../renderer/civic-buildings.js');
  assert.equal(Object.keys(civic.names).length,20);
  const signatures=new Set();
  for(const kind of Object.keys(civic.names))for(let variant=0;variant<3;variant++){
    const f={id:kind,kind,variant,width:120,depth:100,height:30,rotation:73,point:[1500,1700]};
    const l=special.layout(f);
    assert(l.boxes.length+l.hulls.length>=3,kind);
    assert(l.surfaces.length&&l.labels.some(t=>t.text===civic.names[kind]),kind);
    assert(l.boxes.every(b=>[b.x,b.y,b.z,b.w,b.d,b.h].every(Number.isFinite)&&b.w>0&&b.d>0&&b.h>=0),kind);
    for(const b of l.boxes){assert(Math.abs(b.x)+b.w/2<=f.width/2+.1,kind);assert(Math.abs(b.y)+b.d/2<=f.depth/2+.1,kind);}
    for(const h of l.hulls){assert(h.points.every(([x,y])=>Math.abs(x)<=f.width/2+.1&&Math.abs(y)<=f.depth/2+.1),kind);}
    special.build3D({box(...args){assert(args.slice(0,7).every(Number.isFinite));},triangle(mat,pts){assert(pts.flat().every(Number.isFinite));},quad(mat,pts){assert(pts.flat().every(Number.isFinite));}},f,{material:()=>({}),solid:()=>({})});
    if(variant===0)signatures.add(JSON.stringify([l.boxes,l.hulls,l.surfaces]));
  }
  assert.equal(signatures.size,20);
});

test('refined facilities retain their saved footprint and use finite meshes and real window bays',()=>{
  const fs=require('node:fs');
  const city=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../../docs/experiments/auto-facilities-city.json')));
  const facilities=city.state.facilities.filter(f=>f.automaticCategory);
  for(const f of facilities){
    const before=structuredClone(f),l=special.layout(f);
    assert.equal(l.detailVersion,2);
    assert.deepEqual(f,before);
    assert.deepEqual(special.layout(structuredClone(f)),l);
    assert(l.boxes.some(b=>b.detail),f.kind);
    for(const m of l.meshes){
      assert.equal(m.points.length,3);
      assert(m.points.flat().every(Number.isFinite));
      for(const [x,y,z] of m.points){assert(Math.abs(x)<=f.width/2+.2,f.kind+' x');assert(Math.abs(y)<=f.depth/2+.2,f.kind+' y');assert(z>=0,f.kind+' z');}
    }
    for(const t of l.trees){assert(t.variant>=0&&t.variant<20);assert(Math.abs(t.x)+t.radius<f.width/2);assert(Math.abs(t.y)+t.radius<f.depth/2);}
    if(['hospital','university','hotel','police_station','fire_station'].includes(f.kind))assert(l.windows.length>10,f.kind);
    assert(l.meshes.length<12000,f.kind+' excessive detail');
  }
});

test('each civic type has three structural variants and hospitals retain red medical signs',()=>{
  const civic=require('../renderer/civic-buildings.js');
  for(const kind of Object.keys(civic.names)){
    const signatures=new Set();
    for(let variant=0;variant<3;variant++){
      const l=special.layout({id:kind,kind,variant,width:120,depth:100,height:30,rotation:0,point:[1000,1000]});
      signatures.add(JSON.stringify([l.boxes.map(b=>[b.x,b.y,b.z,b.w,b.d,b.h]),l.hulls.map(b=>[b.points,b.z,b.h]),l.meshes.map(m=>m.points)]));
      assert.equal(l.colorPalette.length,5);
      if(kind==='hospital')assert(l.boxes.filter(b=>b.color==='#d83232').length>=6);
    }
    assert.equal(signatures.size,3,kind+' needs different massing');
  }
});

test('adaptive Block meshes preserve concave sites, courtyards and slanted window planes',()=>{
  const cases=require('../../docs/experiments/block-architecture-cases.json');
  for(const f of cases){
    const l=special.layout(f);assert.equal(l.detailVersion,3);assert(l.meshes.length>0);
    assert.deepEqual(l,special.layout(structuredClone(f)));
    for(const m of l.meshes){assert.equal(m.points.length,3);assert(m.points.flat().every(Number.isFinite));assert(m.points.every(p=>p[2]>=0));}
    for(const win of l.windows){assert.equal(win.points.length,4);assert(win.points.flat().every(Number.isFinite));assert(Math.abs(Math.hypot(...win.normal)-1)<1e-6);}
    special.build3D({box(...args){assert(args.slice(0,7).every(Number.isFinite));},triangle(mat,pts){assert(pts.flat().every(Number.isFinite));},quad(mat,pts){assert(pts.flat().every(Number.isFinite));}},f,{material:()=>({}),solid:()=>({}),tinted:()=>({})});
  }
});
