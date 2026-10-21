const test=require('node:test');
const assert=require('node:assert/strict');
const scene=require('../renderer/scene-renderer.js');

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
