const test=require('node:test');
const assert=require('node:assert/strict');
const scene=require('../renderer/scene-renderer.js');

test('bridge structures taper into the ground and follow the road height in every heading',()=>{
  for(const angle of [0,Math.PI/4,Math.PI/2,Math.PI]){
    const samples=Array.from({length:31},(_,i)=>({point:[Math.cos(angle)*i*3,Math.sin(angle)*i*3],height:6*(i/30)**2*(3-2*i/30)}));
    const road={level:1,openStart:true,openEnd:true,elevationSamples:samples};
    const original=JSON.stringify(road),details=scene.bridgeStructure(road,15);
    assert(details.walls.length>0);assert(details.rails.length>0);assert(details.piers.length>0);
    const start=[-Math.sin(angle)*7.5,Math.cos(angle)*7.5];
    const first=details.walls[0];
    assert(Math.hypot(first[0][0]-start[0],first[0][1]-start[1])<1e-10);
    assert.deepEqual(first[0],first[3],'retaining wall tapers to zero at ground');
    assert.deepEqual(details.rails[0][0],first[0],'guardrail tapers to zero at ground');
    for(const post of details.posts)assert(post[1][1]<post[0][1]);
    for(const pier of details.piers){assert(pier.height>2.8);assert(Math.abs(pier.foot[1]-pier.top[1]-.28*pier.height)<1e-10);}
    for(const face of [...details.walls,...details.rails,...details.posts])for(const point of face)assert(point.every(Number.isFinite));
    assert.equal(JSON.stringify(road),original);assert.equal(scene.bridgeStructure(road,15),details);
  }
});

test('bridge structures leave flat landings open and cap only unconnected ends',()=>{
  const samples=Array.from({length:21},(_,i)=>({point:[i*3,0],height:0}));
  const flat={level:1,elevationSamples:samples};
  assert.deepEqual(scene.bridgeStructure(flat,15),{width:15,walls:[],rails:[],posts:[],piers:[]});
  const raised=samples.map(s=>({...s,height:6}));
  const open={level:1,elevationSamples:raised,openStart:true,openEnd:true};
  const a=scene.bridgeStructure(open,15),b=scene.bridgeStructure({...open,openEnd:false},15);
  assert.equal(b.walls.length-a.walls.length,16,'only the closed endpoint gains a curved fascia');
  assert.equal(b.rails.length-a.rails.length,16);
  assert.equal(scene.bridgeStructure({...open,level:0},15).walls.length,0);
  assert.equal(scene.bridgeStructure({...open,level:-1},15).walls.length,0);
});

test('sun rises in the east, sets in the west, and casts no solar shadows at night',()=>{
  const morning=scene.lightingAt(8*3600),noon=scene.lightingAt(12*3600),evening=scene.lightingAt(16*3600),night=scene.lightingAt(23*3600);
  assert(scene.shadowOffset(20,morning)[0]<0);
  assert(scene.shadowOffset(20,evening)[0]>0);
  assert(Math.hypot(...scene.shadowOffset(20,noon))<Math.hypot(...scene.shadowOffset(20,morning)));
  assert.deepEqual(scene.shadowOffset(20,night),[0,0]);
  assert.equal(night.night,1);assert.equal(noon.night,0);
});

test('twilight changes smoothly and repeated days have identical lighting',()=>{
  for(const hour of [5.5,6,12,18,18.5,23.999]){
    const t=hour*3600,a=scene.lightingAt(t),b=scene.lightingAt(t+1);
    assert(Math.abs(a.daylight-b.daylight)<.01);
    assert(Math.abs(a.night-b.night)<.01);
    const nextDay=scene.lightingAt(t+86400);
    assert(Math.abs(a.daylight-nextDay.daylight)<1e-12);
  }
  assert(scene.lightingAt(18.25*3600).night>0);
  assert(scene.lightingAt(18.25*3600).night<1);
});

test('tree trunks stay inside their planting sites and crowns stay clear of buildings',()=>{
  const p={id:'garden',points:[[0,0],[60,0],[60,60],[0,60],[0,0]],building:{use:'residential',footprint:[[18,18],[42,18],[42,42],[18,42],[18,18]]}};
  const trees=scene.treesFor(p);assert(trees.length>3);
  for(const tree of trees){
    assert(scene.inside(tree.point,p.points));
    assert(!scene.inside(tree.point,p.building.footprint));
    assert(scene.edgeDistance(tree.point,p.building.footprint)>=tree.radius+1);
    assert(scene.edgeDistance(tree.point,p.points)>=1.6);
  }
  assert.deepEqual(trees,scene.treesFor(JSON.parse(JSON.stringify(p))));
});

test('facade windows occupy only visible walls and keep their floor rows inside the elevation',()=>{
  const volume={points:[[0,0],[30,0],[30,20],[0,20],[0,0]],height:19.8,base:3.3};
  const faces=scene.facadeFaces(volume),windows=scene.facadeWindows(volume,6);
  assert.equal(faces.length,1);assert.equal(faces[0].a[1],20);
  assert(windows.length>20);
  for(const points of windows)for(const [x,y] of points){assert(x>0&&x<30);assert(y>20-19.8*.26&&y<20-3.3*.26);}
  assert.deepEqual(windows,scene.facadeWindows(volume,6));
  const reversed={...volume,points:volume.points.slice().reverse()};
  assert.equal(scene.facadeFaces(reversed).length,1);assert.equal(scene.facadeFaces(reversed)[0].a[1],20);
});

test('every scene surface has at least four stable material variants with valid atlas cells',()=>{
  const materials=require('../renderer/material-catalog.js');
  for(const name of ['asphalt','paving','roof','roofTiles','metal','facade','glass','grass','gravel','water','soil','curb','marking','markingYellow','carPaint']){
    const n=materials.count(name);assert(n>=4,name);
    const choices=Array.from({length:n},(_,i)=>materials.pick(name,i));
    assert.equal(new Set(choices.map(c=>c.index)).size,n);
    for(const c of choices){if(c.atlas)assert(c.cell>=0&&c.cell<16);assert(c.meters>0);assert(c.rgb.every(v=>v>=0&&v<=255));}
    assert.deepEqual(materials.pick(name,scene.seed('occupied-building')),materials.pick(name,scene.seed('occupied-building')));
    assert.equal(materials.pick(name,-1).index,n-1);
  }
});

test('tree species remain stable and trunks leave walking paths and fountains clear',()=>{
  const materials=require('../renderer/material-catalog.js');
  assert.equal(new Set(materials.treeSpecies.map(t=>t.id)).size,20);
  const points=[[0,0],[100,0],[100,100],[0,100],[0,0]];
  for(const kind of ['park','plaza']){
    const p={id:'landscape-'+kind,kind,points,point:[50,50]},trees=scene.treesFor(p);
    assert(trees.length>3);assert(new Set(trees.map(t=>t.species)).size>2);
    assert.deepEqual(trees,scene.treesFor(JSON.parse(JSON.stringify(p))));
    for(const tree of trees){
      const type=materials.tree(tree.variant);
      assert.equal(tree.species,type.id);
      assert(tree.radius>=type.radius[0]&&tree.radius<=type.radius[1]);
      assert(tree.height>=type.height[0]&&tree.height<=type.height[1]);
      if(kind==='park')assert(scene.edgeDistance(tree.point,[[0,50],[50,50],[100,100]])>=1.6);
      else assert(Math.hypot(tree.point[0]-50,tree.point[1]-50)>=tree.radius+9);
    }
  }
});

test('paved forecourts respect holes and distinguish shared courtyard beds from individual tree pits',()=>{
  const surface={points:[[0,0],[40,0],[40,20],[0,20],[0,0]],holes:[[[2,2],[6,2],[6,6],[2,6],[2,2]]]};
  assert(scene.onSurface([20,10],[surface]));assert(!scene.onSurface([4,4],[surface]));assert(!scene.onSurface([20,25],[surface]));
  const parcel={id:'front-yard',points:[[0,0],[40,0],[40,60],[0,60],[0,0]],forecourt:[surface],building:{use:'residential',footprint:[[12,25],[28,25],[28,40],[12,40],[12,25]]}};
  const trees=scene.treesFor(parcel);assert(trees.length);
  const courtyard=require('../renderer/landscape-layout.js').courtyard(parcel,trees);
  for(const t of trees){
    assert(!scene.onSurface(t.point,[surface]));
    if(t.street)assert.equal(t.courtyard,undefined,'individual trees retain their own pit');
    else assert(courtyard&&scene.inside(t.point,courtyard.beds[t.courtyard].points),'grouped trees share a planted bed');
  }
});
