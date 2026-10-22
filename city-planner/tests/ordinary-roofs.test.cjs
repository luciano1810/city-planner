const test=require('node:test'),assert=require('node:assert/strict'),R=require('../renderer/ordinary-roofs.js');
const G=require('../renderer/city-geometry.js');
function parcel(use,floors,seed,points=[[0,0],[44,0],[44,32],[0,32],[0,0]]){return {id:'roof-'+seed,center:[22,16],building:{use,floors,height:floors*3.3,footprint:points,capacity:100}};}
test('ordinary roofs are stable and diverse, and fittings avoid upper volumes and each other',()=>{
 const shapes=new Set(),types=new Set();
 for(const [use,floors] of [['residential',2],['residential',6],['office',18],['commercial',4],['industrial',2],['warehouse',1]])for(let seed=0;seed<30;seed++){
  const p=parcel(use,floors,seed),before=JSON.stringify(p),entries=R.layout(p);assert.equal(JSON.stringify(p),before);assert.deepEqual(entries,R.layout(JSON.parse(before)));
  for(const e of entries){shapes.add(e.shape);assert(e.meshes.length<1800);for(const mesh of e.meshes){assert(mesh.points.flat().every(Number.isFinite));assert(mesh.uv.flat().every(Number.isFinite));}
   const v=e.volume,r=v.rect;
   for(let i=0;i<e.units.length;i++){const u=e.units[i];types.add(u.type);const a=[u.x-u.w/2,u.y-u.d/2,u.x+u.w/2,u.y+u.d/2];assert(a[0]>=r[0]&&a[1]>=r[1]&&a[2]<=r[2]&&a[3]<=r[3]);
    const overlaps=q=>a[0]<q[2]-1e-6&&a[2]>q[0]+1e-6&&a[1]<q[3]-1e-6&&a[3]>q[1]+1e-6;
    for(const other of entries)if(other!==e&&other.volume.rect&&other.volume.height>v.height+.1&&other.volume.base<=v.height+.1)assert(!overlaps(other.volume.rect));
    for(const u2 of e.units.slice(0,i))assert(!overlaps([u2.x-u2.w/2,u2.y-u2.d/2,u2.x+u2.w/2,u2.y+u2.d/2]));
   }
  }
 }
 assert.deepEqual([...shapes].sort(),['barrel','flat','gable','hip','mono','sawtooth']);
 for(const type of ['solar','skylight','chimney','garden','pergola','chiller','access','duct','terrace','crown'])assert(types.has(type),type);
});
test('roofs remain within rotated concave blocks and preserve saved capacities',()=>{
 const outline=[[0,0],[70,0],[65,20],[24,20],[24,55],[0,55],[0,0]];
 for(const angle of [0,.4,1.3]){
  const points=outline.map(([x,y])=>[1000+x*Math.cos(angle)-y*Math.sin(angle),1000+x*Math.sin(angle)+y*Math.cos(angle)]),p=parcel('residential',5,angle,points);p.center=[1020,1020];
  for(const e of R.layout(p))for(const mesh of e.meshes)for(const [x,y] of mesh.points)assert(G.containsPoint([x,y],points));
  assert.equal(p.building.capacity,100);
 }
});

test('flat roofs keep service counts bounded and distinguish plant, access and glazing scales',()=>{
 const areas={access:[],chiller:[],skylight:[]};
 for(let seed=0;seed<20;seed++)for(const e of R.layout(parcel('commercial',4,seed))){
  assert(e.units.length<=8,'a large roof should not fill with arbitrarily many fittings');
  assert(e.units.filter(u=>u.type==='access').length<=1,'each roof has one access core');
  for(const u of e.units){
   if(areas[u.type])areas[u.type].push(u.w*u.d);
   if(['access','chiller','duct','skylight'].includes(u.type)){
    assert(u.plinth>0&&u.plinth<.3,'plant sits on a low, finite support');
    assert(Math.abs(u.z-u.deckZ-u.plinth)<1e-9);
    assert(u.deckZ>=e.volume.height,'the support is above its own roof deck');
   }
  }
 }
 const average=type=>{assert(areas[type].length>0,type);return areas[type].reduce((a,b)=>a+b,0)/areas[type].length;};
 assert(average('access')>average('chiller')*1.2);
 assert(average('chiller')>average('skylight')*1.5,'small skylights must not inherit the area of a mechanical unit');
});

test('equipment lid elevation stays in world Y when a roof rotates and its atlas is reused',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 let allocations=0;
 function context(canvas,record){
  let at=[0,0];const stack=[];
  return new Proxy({canvas,save(){stack.push(at.slice());},restore(){at=stack.pop()||[0,0];},translate(x,y){at=[at[0]+x,at[1]+y];},
   createLinearGradient(){return {addColorStop(){}};},
   getImageData(){const data=new Uint8ClampedArray(256*256*4);for(let i=3;i<data.length;i+=4)data[i]=255;return {data};},
   drawImage(source,...args){
    if(source.atlas)canvas.cell=(args[0]>256?1:0)+(args[1]>256?2:0);else if(source.cell!==undefined)canvas.cell=source.cell;
    if(record&&source.cell!==undefined)record.push({cell:source.cell,at:at.slice(),args});
   }},{get(target,key){return key in target?target[key]:()=>{};}});
 }
 const document={createElement(){allocations++;const canvas={width:0,height:0};canvas.getContext=()=>context(canvas);return canvas;}};
 class Image {constructor(){this.width=this.height=1024;this.atlas=true;}set src(_value){this.onload();}}
 const window={CityGeometry:G};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../renderer/ordinary-roofs.js'),'utf8'),{window,document,Image});
 const api=window.CityOrdinaryRoofs,scene={time:9*3600,lightingAt(){return {azimuth:45,elevation:45,strength:.28};},shadowOffset:h=>[-h,-h],material:()=> '#ddd'};
 for(const angle of [0,.7]){
  const outline=[[0,0],[44,0],[44,32],[0,32],[0,0]].map(([x,y])=>[x*Math.cos(angle)-y*Math.sin(angle),x*Math.sin(angle)+y*Math.cos(angle)]),p=parcel('commercial',4,'projected-'+angle,outline);
  p.center=[22*Math.cos(angle)-16*Math.sin(angle),22*Math.sin(angle)+16*Math.cos(angle)];
  const entry=api.layout(p).find(e=>e.units.some(u=>u.type==='access'));assert(entry);
  const unit=entry.units.find(u=>u.type==='access'),calls=[],ctx=context({},calls);api.drawCanvas(ctx,p,entry.volume,scene);
  const lid=calls.find(call=>call.cell===2&&call.args.length===8);assert(lid,'access texture supplies a horizontal lid');
  const v=entry.volume,x=v.origin[0]+unit.x*Math.cos(v.angle)-unit.y*Math.sin(v.angle),y=v.origin[1]+unit.x*Math.sin(v.angle)+unit.y*Math.cos(v.angle);
  assert(Math.abs(lid.at[0]-x)<1e-8,'raising a lid must not shift its world X');
  assert(Math.abs(lid.at[1]-(y-(unit.z+2.06)*.26))<1e-8,'the lid projects the actual equipment height');
  const before=allocations;api.drawCanvas(ctx,p,entry.volume,scene);assert.equal(allocations,before,'rebaking a building must reuse the four equipment sprites');
 }
 assert(allocations<=8,'the equipment atlas has a fixed, small extraction cache');
});
