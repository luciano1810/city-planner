const test=require('node:test'),assert=require('node:assert/strict');
const L=require('../renderer/landscape-layout.js');
const tree=point=>({point,radius:3.2,height:7,variant:0,species:'oak',street:true});

test('shared courtyard beds preserve the save and existing roots while clearing buildings, forecourts and entrances',()=>{
  const site={id:'courtyard-clearances',points:[[0,0],[64,0],[64,60],[44,60],[44,47],[0,47],[0,0]],frontage:[32,0],entrance:[32,18],
    forecourt:[{points:[[0,0],[64,0],[64,8],[0,8],[0,0]],holes:[[[4,2],[18,2],[18,6],[4,6],[4,2]]]}],
    building:{use:'office',status:'active',footprint:[[24,18],[40,18],[40,38],[24,38],[24,18]]}};
  const trees=[[10,13],[17,13],[10,21],[17,22],[49,13],[56,13],[49,22],[49,44],[56,44],[10,40],[17,40]].map(tree);
  const context={polygons:[[[51,18],[61,18],[61,29],[51,29],[51,18]]],paths:[{points:[[44,40],[64,40]],width:4}]};
  const saved=JSON.stringify({site,trees,context}),plan=L.courtyard(site,trees,context);assert(plan&&plan.beds.length>=2);
  assert.equal(JSON.stringify({site,trees,context}),saved);
  assert.strictEqual(L.courtyard(site,trees,context),plan);
  assert.strictEqual(L.courtyard(site,plan.trees),plan);
  const cloned=JSON.parse(saved);assert.deepEqual(L.courtyard(cloned.site,cloned.trees,cloned.context),plan);
  assert.deepEqual(plan.trees.map(t=>t.point),trees.map(t=>t.point),'existing tree roots never move');
  const allowed=([x,y])=>{
    assert(L.inside([x,y],site.points));assert(!L.inside([x,y],site.building.footprint));
    assert(!L.inside([x,y],context.polygons[0]));
    assert(!(y>=0&&y<=18&&Math.abs(x-32)<1.5),'entrance corridor stays open');
    assert(!(x>=44&&x<=64&&Math.abs(y-40)<2),'driveway stays open');
    for(const surface of site.forecourt)assert(!(L.inside([x,y],surface.points)&&!surface.holes.some(h=>L.inside([x,y],h))));
  };
  for(const bed of plan.beds){
    assert(bed.members.length>=2&&bed.members.length<=3);
    for(let i=0;i<bed.points.length;i++){
      const a=bed.points[i],b=bed.points[(i+1)%bed.points.length];
      for(let j=0;j<=4;j++)allowed(a.map((v,k)=>v+(b[k]-v)*j/4));
    }
    for(let x=bed.rawBounds[0];x<bed.rawBounds[2];x+=.8)for(let y=bed.rawBounds[1];y<bed.rawBounds[3];y+=.8)if(L.inside([x,y],bed.points))allowed([x,y]);
    for(const index of bed.members){assert.equal(plan.trees[index].street,false);assert(L.inside(trees[index].point,bed.points));}
  }
  for(const shrub of plan.shrubs){allowed(shrub.point);assert(L.inside(shrub.point,plan.beds[shrub.bed].points));}
});

test('a shared bed cannot enclose a compact reserved area between two roots',()=>{
  const site={id:'courtyard-obstacle',points:[[0,0],[40,0],[40,40],[0,40],[0,0]],building:{footprint:[[25,25],[35,25],[35,35],[25,35],[25,25]]}};
  const trees=[[8,10],[16,10]].map(tree),context={polygons:[[[11,9],[13,9],[13,11],[11,11],[11,9]]]};
  assert.equal(L.courtyard(site,trees,context),null);
});
