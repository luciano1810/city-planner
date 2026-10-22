const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../renderer/building-appearance.js'),G=require('../renderer/city-geometry.js'),S=require('../renderer/scene-renderer.js');
function parcel(use,floors,id,angle=0){
  const points=[[0,0],[34,0],[34,28],[0,28],[0,0]].map(([x,y])=>[500+x*Math.cos(angle)-y*Math.sin(angle),500+x*Math.sin(angle)+y*Math.cos(angle)]);
  return {id:'appearance-'+id,center:[500+17*Math.cos(angle)-14*Math.sin(angle),500+17*Math.sin(angle)+14*Math.cos(angle)],points,building:{use,status:'active',floors,height:floors*3.3,footprint:points,capacity:128}};
}
test('every building use has stable distinct architecture, independent of occupancy and construction status',()=>{
  for(const [use,minimum] of [['residential',6],['office',4],['commercial',4],['industrial',3],['warehouse',3]]){
    const styles=new Set();
    for(let i=0;i<60;i++){
      const p=parcel(use,6,i),before=JSON.stringify(p),profile=A.profile(p);styles.add(profile.name);
      assert.deepEqual(A.profile(JSON.parse(before)),profile);assert.equal(JSON.stringify(p),before);
      p.building.status='construction';p.building.constructionProgress=.5;assert.deepEqual(A.profile(p),profile);
    }assert.equal(styles.size,minimum,use);
  }
});
test('L and U wings are bounded, non-overlapping, stable after reload, and preserve simulation data',()=>{
  const forms=new Set();
  for(const floors of [2,9])for(const angle of [0,.3,1.2])for(let id=0;id<18;id++){
    const p=parcel('residential',floors,id,angle),before=JSON.stringify(p),layout=G.buildingMassing(p);forms.add(layout.volumes.length);
    assert.deepEqual(G.buildingMassing(JSON.parse(before)),layout);assert.equal(JSON.stringify(p),before);
    assert(layout.volumes.length<=4);assert.equal(Math.max(...layout.volumes.map(v=>v.height)),p.building.height);
    for(const v of layout.volumes){assert(v.height>(v.base||0));for(const point of v.points)assert(G.containsPoint(point,p.points));}
    const wings=layout.volumes.filter(v=>v.base>0);
    for(let i=0;i<wings.length;i++)for(const other of wings.slice(i+1)){
      const a=wings[i].rect,b=other.rect;assert(!(a[0]<b[2]-1e-7&&a[2]>b[0]+1e-7&&a[1]<b[3]-1e-7&&a[3]>b[1]+1e-7));
    }
  }
  assert(forms.has(1)&&forms.has(3)&&forms.has(4));
});
test('facade decoration balances canvas state and retains finite coordinates in rotated uses and stages',()=>{
  let depth=0,commands=0;
  const coords=(...values)=>{assert(values.every(Number.isFinite));commands++;};
  const ctx=new Proxy({save(){depth++;},restore(){depth--;assert(depth>=0);},moveTo:coords,lineTo:coords}, {get(t,k){return k in t?t[k]:()=>{};}});
  for(const use of ['residential','office','commercial','industrial','warehouse'])for(let i=0;i<18;i++){
    const p=parcel(use,use==='industrial'?2:9,i,.6),before=JSON.stringify(p);
    for(const v of G.buildingMassing(p).volumes)A.drawFacade(ctx,p,v,S);
    assert.equal(depth,0);assert.equal(JSON.stringify(p),before);
    for(const status of ['planned','construction']){p.building.status=status;const count=commands;A.drawFacade(ctx,p,G.buildingMassing(p).volumes[0],S);assert.equal(commands,count);}
  }assert(commands>1000);
});
test('office and retail silhouettes vary while every roof zone clears upper floors and equipment',()=>{
  const R=require('../renderer/ordinary-roofs.js'),forms=new Set(),cells=new Set();
  for(const use of ['residential','office','commercial','industrial','warehouse'])for(let i=0;i<24;i++){
    const p=parcel(use,use==='office'?12:use==='residential'?9:4,i,.4),before=JSON.stringify(p),layout=G.buildingMassing(p);
    if(use==='office'||use==='commercial')forms.add(layout.volumes.length);
    const overlap=(a,b,gap=0)=>a[0]<b[2]+gap&&a[2]>b[0]-gap&&a[1]<b[3]+gap&&a[3]>b[1]-gap;
    for(const e of R.layout(p)){
      const zones=e.zones||[];assert(zones.length<=2);
      for(const [j,z] of zones.entries()){
        cells.add(z.cell);const r=[z.x-z.w/2,z.y-z.d/2,z.x+z.w/2,z.y+z.d/2],v=e.volume;
        assert(r[0]>=v.rect[0]+.8&&r[1]>=v.rect[1]+.8&&r[2]<=v.rect[2]-.8&&r[3]<=v.rect[3]-.8);
        for(const upper of layout.volumes)if(upper!==v&&upper.rect&&upper.height>v.height+.1&&upper.base<=v.height+.1)assert(!overlap(r,upper.rect));
        for(const u of [...e.units,...zones.slice(0,j)])assert(!overlap(r,[u.x-u.w/2,u.y-u.d/2,u.x+u.w/2,u.y+u.d/2],.6));
      }
    }assert.equal(JSON.stringify(p),before);
  }
  assert(forms.has(2)&&forms.has(3)&&forms.has(4));assert.deepEqual([...cells].sort(),[0,1,2,3]);
});
test('textured night windows stay inside their own visible facade floors',()=>{
  for(const use of ['residential','office','commercial']){
    const p=parcel(use,9,'night',.4);
    for(const v of G.buildingMassing(p).volumes){
      const faces=S.facadeFaces(v),panes=A.windowPanes(p,v,faces);assert(panes.length>0);
      for(const pane of panes){assert(pane.flat().every(Number.isFinite));assert(pane[0][1]>pane[3][1]);}
    }
  }
});
