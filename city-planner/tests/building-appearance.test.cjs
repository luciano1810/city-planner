const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../renderer/building-appearance.js'),G=require('../renderer/city-geometry.js'),S=require('../renderer/scene-renderer.js');
function parcel(use,floors,id,angle=0){
  const points=[[0,0],[34,0],[34,28],[0,28],[0,0]].map(([x,y])=>[500+x*Math.cos(angle)-y*Math.sin(angle),500+x*Math.sin(angle)+y*Math.cos(angle)]);
  return {id:'appearance-'+id,center:[500+17*Math.cos(angle)-14*Math.sin(angle),500+17*Math.sin(angle)+14*Math.cos(angle)],points,building:{use,status:'active',floors,height:floors*3.3,footprint:points,capacity:128}};
}
test('every building use has stable distinct architecture, independent of occupancy and construction status',()=>{
  for(const [use,minimum] of Object.entries(A.styleCounts)){
    const styles=new Set();
    for(let i=0;i<200;i++){
      const p=parcel(use,6,i),before=JSON.stringify(p),profile=A.profile(p);styles.add(profile.name);
      assert.deepEqual(A.profile(JSON.parse(before)),profile);assert.equal(JSON.stringify(p),before);
      p.building.status='construction';p.building.constructionProgress=.5;assert.deepEqual(A.profile(p),profile);
    }assert.equal(styles.size,minimum,use);
  }
});
test('L and U wings are bounded, non-overlapping, stable after reload, and preserve simulation data',()=>{
  const forms=new Set();
  for(const floors of [2,9])for(const angle of [0,.3,1.2])for(let id=0;id<18;id++){
    const p=parcel('residential',floors,id,angle);p.building.visualShape='standard';const before=JSON.stringify(p),layout=G.buildingMassing(p);forms.add(layout.volumes.length);
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
  for(const use of ['residential','office','commercial','industrial','warehouse'])for(const floors of [9,24,52])for(let i=0;i<18;i++){
    const p=parcel(use,use==='industrial'?2:floors,i,.6),before=JSON.stringify(p);
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

test('material families cover both atlases without changing the established massing choice',()=>{
  const cells=new Set(),originalCounts={residential:6,office:4,commercial:4,industrial:3,warehouse:3};
  for(const use of Object.keys(originalCounts))for(let id=0;id<400;id++){
    const p=parcel(use,9,id),a=A.profile(p);cells.add(a.cell);
    assert(Number.isInteger(a.cell)&&a.cell>=0&&a.cell<32);
    assert.equal(a.index,a.seed%originalCounts[use]);
    assert(a.tone>=0&&a.tone<3);assert(a.pitch>0&&a.windowRatio>0&&a.windowRatio<1);
    p.building.occupants=90;p.building.status='vacant';p.building.roof=999;
    assert.deepEqual(A.profile(p),a,'simulation changes must not reshuffle materials');
  }
  assert.equal(cells.size,32);assert.equal(Object.values(A.styleCounts).reduce((a,b)=>a+b,0),46);
});

test('independent atlas readiness and bounded mip cache survive many finishes and zooms',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),images=[],draws=[];let redraws=0,depth=0;
  const ctx={save(){depth++;},restore(){depth--;},beginPath(){},moveTo(){},lineTo(){},closePath(){},clip(){},transform(){},fillRect(){},
    getTransform:()=>({a:8,b:0,c:0,d:8}),createPattern:()=>({setTransform(){}}),drawImage(image,...args){draws.push({image,args});}};
  const window={MapWorkspace:{requestDraw(){redraws++;}}};
  const document={createElement:()=>({width:0,height:0,getContext:()=>ctx})};
  class Image{constructor(){this.width=2048;this.height=2048;images.push(this);}}
  class DOMMatrix{scale(){return this;}}
  vm.runInNewContext(fs.readFileSync(require.resolve('../renderer/building-appearance.js'),'utf8'),{window,document,Image,DOMMatrix});
  const a=window.CityBuildingAppearance,old=images.find(i=>i.src.includes('facades-atlas')),extra=images.find(i=>i.src.includes('materials-v2'));
  const cases=Array.from({length:400},(_,i)=>parcel('residential',9,i));
  const first=cases.find(p=>a.profile(p).cell<16),second=cases.find(p=>a.profile(p).cell>=16);
  old.onload();assert(a.facadeAvailable(first));assert(!a.facadeAvailable(second));assert(!a.ready);
  const v=G.buildingMassing(second).volumes[0],face=S.facadeFaces(v)[0];assert.equal(a.drawWall(ctx,second,v,face),false);
  extra.onload();assert(a.facadeAvailable(second));assert(a.facadeReady);assert(!a.ready,'facades must not depend on roof image readiness');
  const version=a.assetVersion;
  for(const zoom of [.2,1,3,8,16])for(const use of Object.keys(A.styleCounts))for(let id=0;id<60;id++){
    const p=parcel(use,9,id),v=G.buildingMassing(p).volumes[0];ctx.getTransform=()=>({a:zoom,b:0,c:0,d:zoom});
    for(const f of S.facadeFaces(v))assert(a.drawWall(ctx,p,v,f));
    assert(a.textureCount<=96);
  }
  assert.equal(depth,0);assert(draws.some(d=>d.image===extra));
  for(const {image,args} of draws)if(image===old||image===extra){const [x,y,w,h]=args;assert(x>=0&&y>=0&&x+w<=image.width&&y+h<=image.height);}
  extra.onload();assert.equal(a.textureCount,0);assert.equal(a.assetVersion,version+1);assert.equal(redraws,3);
});

test('high-rise night windows avoid service bands, the lobby fascia and crown',()=>{
  const p=parcel('office',40,12),v={base:0,height:132};
  assert(!A.highRiseWindowVisible(p.building,v,33.2,34.5));
  assert(!A.highRiseWindowVisible(p.building,v,4.8,6));
  assert(!A.highRiseWindowVisible(p.building,v,131,132));
  assert(A.highRiseWindowVisible(p.building,v,36,38));
  const R=require('../renderer/ordinary-roofs.js');let crowns=0;
  for(let i=0;i<30;i++){
    const p=parcel('office',42,i);p.building.landmark='cbd_skyscraper';p.building.towerVariant=i%3;p.building.height=163.8;
    for(const roof of R.layout(p))for(const unit of roof.units)if(unit.type==='crown'){
      crowns++;assert.equal(roof.volume.height,p.building.height);
    }
  }assert(crowns>0);
});
