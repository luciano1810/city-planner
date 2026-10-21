/* Shared textured outfits and distance-driven gait for 3D and Canvas walkers. */
(function(root){
  'use strict';
  const colors=['#ddd7c5','#273e5c','#b84d4c','#717b80','#78846a','#bb9040','#7194aa','#d6d9d0','#753e4a','#c2ae8b','#39727a','#363c41','#293e56','#667f94','#84796b','#654b39'];
  const skins=['#e4b995','#bf8f6d','#8c6049','#d6a57e','#aa7759'];
  const hairs=['#322c28','#604633','#91806a','#252a2b','#9c7956'];
  const tiles=new Map();let atlas=null;
  if(typeof Image!=='undefined'){
    const image=new Image();image.onload=()=>{atlas=image;tiles.clear();root.CityScene3D?.invalidate();root.MapWorkspace?.draw();};image.src='assets/pedestrian-clothing.png';
  }
  function outfit(person){
    const n=((person.variant??person.id)%16+16)%16;
    return {top:n%12,trousers:12+n%3,skin:skins[n%skins.length],hair:hairs[n%hairs.length],
      shoes:n%4===0?'#deddd2':'#303238',bag:n%5===0,hat:n%7===0,longSleeves:n%3!==2};
  }
  function gait(person){
    const moving=person.speed>.05,phase=(person.stride||0)*Math.PI*2/1.45;
    return {swing:moving?Math.sin(phase)*.23:0,lift:moving?Math.abs(Math.sin(phase))*.025:0};
  }
  function texture(index){
    index=((index%16)+16)%16;if(tiles.has(index))return tiles.get(index);
    const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d');
    if(atlas){const q=atlas.width/4;ctx.drawImage(atlas,index%4*q+2,Math.floor(index/4)*q+2,q-4,q-4,0,0,128,128);}
    else {ctx.fillStyle=colors[index];ctx.fillRect(0,0,128,128);}
    tiles.set(index,c);return c;
  }
  function build3D(batch,person,{solid,cloth}){
    const o=outfit(person),g=gait(person),height=(person.height||1.72)/1.72,co=Math.cos(person.heading),si=Math.sin(person.heading);
    const world=([x,y,z])=>[person.point[0]+(x*co-y*si)*height,-person.point[1]-(x*si+y*co)*height,(z+g.lift)*height+.05];
    const normal=([x,y,z])=>[x*co-y*si,-x*si-y*co,z];
    const top=cloth(o.top),pants=cloth(o.trousers),skin=solid(o.skin),hair=solid(o.hair),shoes=solid(o.shoes);
    function oval(center,radii,mat,rows=4,columns=8){
      const vertex=(i,j)=>{const a=i/rows*Math.PI,b=j/columns*Math.PI*2,n=[Math.sin(a)*Math.cos(b),Math.sin(a)*Math.sin(b),Math.cos(a)];
        const nn=n.map((v,k)=>v/radii[k]),length=Math.hypot(...nn);
        return {p:world(center.map((v,k)=>v+n[k]*radii[k])),n:normal(nn.map(v=>v/length)),uv:[j/columns,i/rows]};};
      for(let i=0;i<rows;i++)for(let j=0;j<columns;j++){
        const a=vertex(i,j),b=vertex(i+1,j),c=vertex(i+1,j+1),d=vertex(i,j+1);
        for(const tri of [[a,c,b],[a,d,c]])batch.triangle(mat,tri.map(v=>v.p),tri.map(v=>v.uv),tri.map(v=>v.n));
      }
    }
    function limb(a,b,r,mat){
      const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],length=Math.hypot(dx,dy,dz),u=[dz/length,0,-dx/length];
      const ul=Math.hypot(...u);for(let k=0;k<3;k++)u[k]/=ul||1;
      const v=[dy*u[2]-dz*u[1],dz*u[0]-dx*u[2],dx*u[1]-dy*u[0]].map(n=>n/length);
      const vertex=(center,j)=>{const angle=j/6*Math.PI*2,n=u.map((value,k)=>value*Math.cos(angle)+v[k]*Math.sin(angle));return {p:world(center.map((value,k)=>value+n[k]*r)),n:normal(n)};};
      for(let j=0;j<6;j++){const aa=vertex(a,j),bb=vertex(b,j),cc=vertex(b,j+1),dd=vertex(a,j+1);for(const tri of [[aa,bb,cc],[aa,cc,dd]])batch.triangle(mat,tri.map(p=>p.p),[[0,0],[1,1],[1,0]],tri.map(p=>p.n));}
    }
    oval([0,0,1.16],[.14,.225,.29],top);
    oval([0,0,.9],[.13,.185,.13],pants,3,6);
    for(const side of [-1,1]){
      const step=g.swing*side,ankle=[step,side*.105,.16],knee=[step*.43+.04,side*.105,.52];
      limb([0,side*.11,.88],knee,.083,pants);limb(knee,ankle,.064,pants);
      oval([step+.065,side*.105,.09],[.15,.075,.075],shoes,3,6);
      const elbow=[-step*.45,side*.275,1.08],hand=[-step,side*.27,.92];
      limb([0,side*.225,1.34],elbow,.067,top);limb(elbow,hand,.051,o.longSleeves?top:skin);
      oval(hand,[.055,.047,.065],skin,3,6);
    }
    oval([0,0,1.47],[.07,.075,.1],skin,3,6);
    oval([.025,0,1.61],[.13,.135,.155],skin);
    oval([-.016,0,1.695],[.128,.14,.095],hair);
    if(o.bag)oval([-.19,0,1.16],[.095,.16,.21],cloth(15),3,8);
    if(o.hat){oval([.01,0,1.73],[.145,.153,.068],cloth(9),3,8);oval([.15,0,1.705],[.1,.125,.02],cloth(9),3,6);}
  }
  function paint(ctx,people,{scale,visible=()=>true}){
    if(scale<.5)return;
    for(const p of people||[]){
      if(!visible(p.point))continue;
      const o=outfit(p),g=gait(p),h=(p.height||1.72)/1.72;
      const sun=root.CityScene?.lightingAt(root.CityScene.time),shadow=root.CityScene?.shadowOffset(p.height||1.72,sun)||[.5,.5];
      if(sun?.elevation>0){ctx.save();ctx.translate(p.point[0]+shadow[0]*.5,p.point[1]+shadow[1]*.5);ctx.rotate(Math.atan2(shadow[1],shadow[0]));ctx.beginPath();ctx.ellipse(0,0,Math.max(.3,Math.hypot(...shadow)/2),.2,0,0,Math.PI*2);ctx.fillStyle='#27322b30';ctx.fill();ctx.restore();}
      ctx.save();ctx.translate(p.point[0],p.point[1]-.27*h);ctx.rotate(p.heading);ctx.scale(h,h);
      const oval=(x,y,rx,ry,color)=>{ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();};
      for(const side of [-1,1]){oval(g.swing*side,side*.105,.18,.078,o.shoes);oval(-g.swing*side,side*.27,.09,.06,o.skin);}
      ctx.save();ctx.beginPath();ctx.ellipse(0,0,.18,.25,0,0,Math.PI*2);ctx.clip();ctx.drawImage(texture(o.top),-.18,-.25,.36,.5);ctx.restore();
      if(o.bag)oval(-.19,0,.1,.17,'#6e5441');
      oval(.09,0,.14,.13,o.skin);oval(.045,0,.135,.125,o.hat?'#b5a88b':o.hair);ctx.restore();
    }
  }
  const api={outfit,gait,texture,build3D,paint,get ready(){return !!atlas;}};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CityPedestrians=api;
})(typeof window==='undefined'?{}:window);
