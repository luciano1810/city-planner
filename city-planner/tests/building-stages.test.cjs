const test=require('node:test');
const assert=require('node:assert/strict');
const stages=require('../renderer/building-stages.js');
const scene=require('../renderer/scene-renderer.js');
const geometry=require('../renderer/city-geometry.js');
const materials=require('../renderer/material-catalog.js');

test('site layouts distinguish building types and restore diverse layouts from stable parcel IDs',()=>{
  for(const [use,floors,type] of [['residential',2,'house'],['residential',9,'apartment'],['office',12,'office'],['industrial',2,'hall'],['commercial',4,'retail']]){
    const variants=new Set(),layouts=new Set();
    for(let id=0;id<40;id++){
      const p={id:'layout-'+id,building:{use,floors,status:'construction',constructionProgress:.4}};
      const recipe=stages.recipe(p);assert.equal(recipe.type,type);variants.add(recipe.variant);layouts.add(JSON.stringify(recipe));
      assert.deepEqual(stages.recipe(JSON.parse(JSON.stringify(p))),recipe);
      p.building.constructionProgress=.9;assert.deepEqual(stages.recipe(p),recipe,'construction must not reshuffle the worksite');
    }
    assert.equal(variants.size,4);assert(layouts.size>=16);
  }
});

test('construction visuals follow saved progress without changing simulation state',()=>{
  const b={status:'construction',floors:6,height:19.8};let previous=-1;
  for(const [progress,name] of [[0,'excavation'],[.1,'excavation'],[.3,'structure'],[.7,'structure'],[.8,'finishing'],[1,'finishing']]){
    b.constructionProgress=progress;const before=JSON.stringify(b),result=stages.phase(b);
    assert.equal(result.name,name);assert(result.height>=previous&&result.height<=b.height);previous=result.height;
    assert.equal(JSON.stringify(b),before);
  }
  assert.equal(stages.phase({...b,status:'planned'}).height,0);
  assert.equal(stages.phase({...b,status:'active'}).name,'complete');
  assert.equal(stages.phase({...b,constructionProgress:-1}).progress,0);
  assert.equal(stages.phase({...b,constructionProgress:NaN}).progress,0);
  assert.equal(stages.phase({...b,constructionProgress:2}).progress,1);
});

test('rotated and irregular sites render each stage with registered materials and balanced canvas state',()=>{
  for(const footprint of [
    [[0,0],[26,9],[19,32],[-7,23],[0,0]],
    [[0,0],[30,0],[30,10],[12,10],[12,28],[0,28],[0,0]]
  ])for(const use of ['residential','office','industrial']){
    const p={id:'stage-'+use,center:[12,14],building:{footprint,use,floors:5,height:16.5}};
    const snapshots=[];
    for(const [status,progress] of [['planned',0],['construction',.1],['construction',.5],['construction',.9]]){
      p.building.status=status;p.building.constructionProgress=progress;
      let depth=0;const points=[],used=[];
      const ctx={save(){depth++;},restore(){depth--;assert(depth>=0);},beginPath(){},closePath(){},clip(){},fill(){},stroke(){},setLineDash(){},translate(){},rotate(){},
        moveTo(...p){points.push(p);},lineTo(...p){points.push(p);},fillRect(...p){points.push(p);},transform(...p){points.push(p);}};
      const api={...scene,material(_ctx,name,variant){assert(materials.count(name)>0,name);used.push([name,variant]);return '#aaa';}};
      const before=JSON.stringify(p);stages.paint(ctx,p,3,api,geometry);
      assert.equal(depth,0);assert(points.flat().every(Number.isFinite));assert.equal(JSON.stringify(p),before);
      snapshots.push(JSON.stringify([points,used]));
      if(status==='planned')assert(!used.some(([name])=>name==='reinforcement'));
      if(progress===.5)assert(used.some(([name])=>name==='safetyNet')&&used.some(([name])=>name==='formwork'));
      if(progress===.9)assert(used.some(([name])=>name==='facade'));
    }
    assert.equal(new Set(snapshots).size,4,'each stage has distinct geometry/materials');
  }
});
