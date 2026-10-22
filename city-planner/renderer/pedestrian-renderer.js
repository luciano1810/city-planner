/* Shared textured outfits and distance-driven gait for 3D and Canvas walkers. */
(function(root){
  'use strict';
  const colors=['#ddd7c5','#273e5c','#b84d4c','#717b80','#78846a','#bb9040','#7194aa','#d6d9d0','#753e4a','#c2ae8b','#39727a','#363c41','#293e56','#667f94','#84796b','#654b39'];
  const skins=['#e4b995','#bf8f6d','#8c6049','#d6a57e','#aa7759'];
  const hairs=['#322c28','#604633','#91806a','#252a2b','#9c7956'];
  const tiles=new Map(),sprites=new Map(),spriteLimit=192,spritePixels=64,spriteWidth=88,spriteHeight=112;let atlas=null,spriteHits=0,spriteMisses=0;
  function clearSprites(){for(const sprite of sprites.values()){sprite.width=1;sprite.height=1;}sprites.clear();}
  if(typeof Image!=='undefined'){
    const image=new Image();image.onload=()=>{atlas=image;tiles.clear();clearSprites();root.CityScene3D?.invalidate();root.MapWorkspace?.draw();};image.src='assets/pedestrian-clothing.png';
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
  function walkerSprite(person,direction,pose){
    const variant=((person.variant??person.id)%16+16)%16,key=variant+':'+direction+':'+pose;
    if(sprites.has(key)){const sprite=sprites.get(key);sprites.delete(key);sprites.set(key,sprite);spriteHits++;return sprite;}
    spriteMisses++;
    const canvas=document.createElement('canvas');canvas.width=spriteWidth;canvas.height=spriteHeight;
    const ctx=canvas.getContext('2d'),o=outfit(person),angle=direction*Math.PI/8,co=Math.cos(angle),si=Math.sin(angle),swing=pose*.115,lift=Math.abs(pose)*.0125,tilt=.42;
    ctx.scale(spritePixels,spritePixels);ctx.translate(spriteWidth/(2*spritePixels),1.15);
    // Height always projects towards screen north. Rotating a finished upright
    // person would put heads sideways whenever a pedestrian turned a corner.
    const project=([x,y,z])=>[x*co-y*si,x*si+y*co-(z+lift)*tilt];
    function oval(center,radii,color,cloth=null){
      const [x,y]=project(center),[rx,ry,rz]=radii,a=rx*rx*co*co+ry*ry*si*si,b=(rx*rx-ry*ry)*co*si,d=rx*rx*si*si+ry*ry*co*co+rz*rz*tilt*tilt;
      const spread=Math.sqrt((a-d)*(a-d)+4*b*b),major=Math.sqrt(Math.max(.00001,(a+d+spread)/2)),minor=Math.sqrt(Math.max(.00001,(a+d-spread)/2)),rotation=.5*Math.atan2(2*b,a-d);
      ctx.save();ctx.beginPath();ctx.ellipse(x,y,major,minor,rotation,0,Math.PI*2);ctx.clip();
      const r=major+.02;
      if(cloth!==null)ctx.drawImage(texture(cloth),x-r,y-r,r*2,r*2);else {ctx.fillStyle=color;ctx.fillRect(x-r,y-r,r*2,r*2);}
      const shade=ctx.createLinearGradient(x-r,y-r,x+r,y+r);shade.addColorStop(0,'#fff7dd47');shade.addColorStop(.36,'#ffffff00');shade.addColorStop(1,'#172b3d86');ctx.fillStyle=shade;ctx.fillRect(x-r,y-r,r*2,r*2);ctx.restore();
    }
    function limb(a,b,r,color){
      const from=project(a),to=project(b);ctx.beginPath();ctx.moveTo(...from);ctx.lineTo(...to);ctx.strokeStyle=color;ctx.lineCap='round';ctx.lineWidth=r*2;ctx.stroke();
      ctx.beginPath();ctx.moveTo(from[0]+r*.3,from[1]+r*.3);ctx.lineTo(to[0]+r*.3,to[1]+r*.3);ctx.strokeStyle='#19293647';ctx.lineWidth=r*.6;ctx.stroke();
    }
    const order=(forward,lateral)=>[-1,1].sort((a,b)=>(a-b)*(forward*si+lateral*co)),legs=order(swing,.105),arms=order(-swing,.265),top=colors[o.top],pants=colors[o.trousers];
    for(const side of legs){
      const step=swing*side,knee=[step*.43+.04,side*.105,.52],ankle=[step,side*.105,.16];
      oval([step+.065,side*.105,.07],[.15,.075,.055],o.shoes);
      limb([0,side*.11,.88],knee,.078,pants);limb(knee,ankle,.059,pants);
      // The shoe's pale sole is a small contact edge, not a second foot.
      const toe=project([step+.16,side*.105,.045]);ctx.fillStyle=o.shoes==='#deddd2'?'#f0e8d4':'#76817e';ctx.beginPath();ctx.ellipse(...toe,.037,.028,angle,0,Math.PI*2);ctx.fill();
    }
    function arm(side){
      const step=swing*side,elbow=[-step*.45,side*.265,1.08],hand=[-step,side*.26,.92];
      limb([0,side*.205,1.33],elbow,.064,top);limb(elbow,hand,.047,o.longSleeves?top:o.skin);oval(hand,[.052,.045,.062],o.skin);
    }
    arm(arms[0]);
    if(o.bag&&-si<=0)oval([-.19,0,1.16],[.09,.155,.2],'#614d3d',15);
    oval([0,0,.9],[.13,.18,.12],pants, o.trousers);
    oval([0,0,1.16],[.145,.215,.29],top,o.top);
    // A shoulder seam and collar separate the upper body from the head even
    // when the figure only occupies a dozen screen pixels.
    limb([-.055,-.14,1.36],[-.055,.14,1.36],.014,'#e7e3d26b');
    if(o.bag&&-si>0)oval([-.19,0,1.16],[.09,.155,.2],'#614d3d',15);
    arm(arms[1]);
    oval([0,0,1.47],[.064,.068,.085],o.skin);
    oval([.025,0,1.61],[.125,.13,.15],o.skin);
    oval([.15,0,1.61],[.035,.045,.05],o.skin);
    oval([-.016,0,1.695],[.125,.135,.095],o.hair);
    if(o.hat){oval([.01,0,1.73],[.145,.15,.064],'#b5a88b',9);oval([.15,0,1.705],[.1,.122,.02],'#b5a88b',9);}
    sprites.set(key,canvas);
    while(sprites.size>spriteLimit){const oldest=sprites.keys().next().value,discard=sprites.get(oldest);sprites.delete(oldest);discard.width=1;discard.height=1;}
    return canvas;
  }
  function paint(ctx,people,{scale,visible=()=>true}){
    if(scale<.5)return;
    const sun=root.CityScene?.lightingAt(root.CityScene.time),shadow=root.CityScene?.shadowOffset(1.72,sun)||[.5,.5],shadowLength=Math.hypot(...shadow),shadowAngle=Math.atan2(shadow[1],shadow[0]);
    for(const p of people||[]){
      if(!visible(p.point))continue;
      const g=gait(p),h=(p.height||1.72)/1.72,heading=p.heading||0,directions=scale>=5?16:8,direction=(((Math.round(heading*directions/(Math.PI*2))%directions)+directions)%directions)*(16/directions),pose=scale>=5?Math.max(-2,Math.min(2,Math.round(g.swing/.115))):0;
      ctx.save();ctx.translate(...p.point);ctx.scale(h,h);
      // Stable contact shade anchors the feet; the elongated cast shade follows
      // the shared scene sun and needs no per-frame canvas or blur filter.
      ctx.beginPath();ctx.ellipse(.015,.035,.25,.115,heading,0,Math.PI*2);ctx.fillStyle='#1f2c3447';ctx.fill();
      if(sun?.elevation>0){
        ctx.save();ctx.translate(shadow[0]*.5,shadow[1]*.5);ctx.rotate(shadowAngle);ctx.beginPath();ctx.ellipse(0,0,Math.max(.23,shadowLength*.5),.16,0,0,Math.PI*2);ctx.fillStyle='#26334031';ctx.fill();ctx.restore();
        ctx.beginPath();ctx.ellipse(shadow[0]*.94,shadow[1]*.94,.13,.11,shadowAngle,0,Math.PI*2);ctx.fillStyle='#26334028';ctx.fill();
      }
      const sprite=walkerSprite(p,direction,pose);ctx.drawImage(sprite,-spriteWidth/(2*spritePixels),-1.15,spriteWidth/spritePixels,spriteHeight/spritePixels);ctx.restore();
    }
  }
  const api={outfit,gait,texture,build3D,paint,get ready(){return !!atlas;},get stats(){return {sprites:sprites.size,limit:spriteLimit,bytes:sprites.size*spriteWidth*spriteHeight*4,hits:spriteHits,misses:spriteMisses};}};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CityPedestrians=api;
})(typeof window==='undefined'?{}:window);
