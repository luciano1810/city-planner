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
