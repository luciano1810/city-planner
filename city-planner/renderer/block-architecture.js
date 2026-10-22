/* Polygonal architecture follows the reserved Block rather than a rectangle. */
(function(root){
  'use strict';
  const detail=typeof module!=='undefined'&&module.exports?require('./civic-details.js'):root.CityCivicDetails;
  function populate(f,o){
    const a=f.architecture,pal=detail.paletteFor(f.kind),seed=a.seed;
    o.colorPalette=pal.slice();o.detailVersion=3;o.architectureStyle=a.style;
    const mesh=(points,material,color,ground=false)=>{const m={points,material,color,tint:true,ground};o.meshes.push(m);return m;};
    const quad=(p,q,r,s,mat,color)=>{mesh([p,q,r],mat,color);mesh([p,r,s],mat,color);};
    const box=(x,y,z,w,d,h,material,color)=>{o.boxes.push({x,y,z,w,d,h,material,top:material,color,tint:true,detail:true});};
    const label=(text,x,y,z,size,color)=>o.labels.push({text,x,y,z,size,color,angle:0});
    const inside=(p,ring)=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
    const inMass=(p,m)=>inside(p,m.rings[0])&&!m.rings.slice(1).some(r=>inside(p,r));
    const inSite=p=>inside(p,a.site[0])&&!a.site.slice(1).some(r=>inside(p,r));
    function strip(p,q,z,h,mat,color){quad([p[0],p[1],z],[q[0],q[1],z],[q[0],q[1],z+h],[p[0],p[1],z+h],mat,color);}
    for(const t of a.ground)mesh(t.map(p=>[...p,.025]),'paving','#ccbea4',true);
    for(const [mi,m] of a.masses.entries()){
      const pts=m.rings[0],xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys),w=x1-x0,d=y1-y0,top=m.base+m.height;
      const roofZ=(x,y)=>{
        if(m.roof==='flat')return top;
        const xx=(x-(x0+x1)/2)/Math.max(1,w/2),yy=(y-(y0+y1)/2)/Math.max(1,d/2);
        if(m.roof==='hip'){
          let distance=Infinity;
          for(const ring of m.rings)for(let i=0;i<ring.length-1;i++){const p=ring[i],q=ring[i+1],dx=q[0]-p[0],dy=q[1]-p[1],t=Math.max(0,Math.min(1,((x-p[0])*dx+(y-p[1])*dy)/(dx*dx+dy*dy||1)));distance=Math.min(distance,Math.hypot(x-p[0]-t*dx,y-p[1]-t*dy));}
          return top+Math.min(6,distance*.48);
        }
        if(m.roof==='dome')return top+Math.min(w,d)*.17*Math.sqrt(Math.max(0,1-xx*xx-yy*yy));
        if(m.roof==='vault')return top+Math.min(w,d)*.18*Math.sqrt(Math.max(0,1-xx*xx));
        const t=(x-x0)/Math.max(2,w/4);return top+Math.min(3,w*.06)*(1-Math.abs((t%1)*2-1));
      };
      function roofTriangle(t,n,finish=m.roofPlan?.finish,tone=0){
        if(n){const mid=(p,q)=>[(p[0]+q[0])/2,(p[1]+q[1])/2],ab=mid(t[0],t[1]),bc=mid(t[1],t[2]),ca=mid(t[2],t[0]);for(const child of [[t[0],ab,ca],[ab,t[1],bc],[ca,bc,t[2]],[ab,bc,ca]])roofTriangle(child,n-1,finish,tone);return;}
        const rp=m.roofPlan,colors=finish==='roofTiles'?['#af8e6a','#bc9d79','#a78566']:finish==='gravel'?['#c4c1a9','#b6b5a3','#cfccb7']:finish==='metal'?['#8fa5a9','#9dafb1','#839c9f']:['#b7bdb1','#aab6ad','#c0c5b7'];
        const surface=mesh(t.map(p=>[...p,roofZ(...p)]),finish||(m.roof==='flat'?'roof':'metal'),rp?colors[tone%3]:pal[3]);
        if(rp){surface.variant=rp.variant;surface.roofSkin=true;const c=Math.cos(rp.uvAngle),s=Math.sin(rp.uvAngle);surface.uv=t.map(([x,y])=>[(x*c-y*s)/rp.uvScale+rp.uvOffset[0],(x*s+y*c)/rp.uvScale+rp.uvOffset[1]]);}
      }
      if(m.roofPlan?.zones.length){for(const zone of m.roofPlan.zones)for(const t of zone.triangles)roofTriangle(t,m.roof==='flat'?0:3,zone.finish,zone.tone);}
      else for(const t of m.triangles)roofTriangle(t,m.roof==='flat'?0:3);
      for(const [ri,ring] of m.rings.entries()){
        const area=ring.slice(0,-1).reduce((s,p,i)=>s+p[0]*ring[i+1][1]-ring[i+1][0]*p[1],0),sign=(area>0?1:-1)*(ri? -1:1);
        for(let i=0;i<ring.length-1;i++){
          const p=ring[i],q=ring[i+1],dx=q[0]-p[0],dy=q[1]-p[1],len=Math.hypot(dx,dy);if(len<.15)continue;
          const n=[dy/len*sign,-dx/len*sign],at=(t,z,off=.025)=>[p[0]+dx*t+n[0]*off,p[1]+dy*t+n[1]*off,z];
          // Subdividing wall tops keeps them joined to the curved roof.
          const segments=m.roof==='flat'?1:Math.max(8,Math.ceil(len/2));
          for(let j=0;j<segments;j++){const p0=at(j/segments,m.base,0),p1=at((j+1)/segments,m.base,0);quad(p0,p1,[p1[0],p1[1],roofZ(p1[0],p1[1])],[p0[0],p0[1],roofZ(p0[0],p0[1])],'facade',pal[m.tone===1?1:0]);}
          strip(at(0,m.base),at(1,m.base),m.base,.45,'facade',pal[1]);
          const floors=Math.max(1,Math.floor(m.height/3.4)),pitch=m.height/floors,cols=Math.max(1,Math.floor(len/3.3));
          for(let floor=0;floor<floors;floor++){
            const z=m.base+floor*pitch+.85;
            for(let col=0;col<cols;col++){
              const l=(col+.19)/cols,r=(col+.81)/cols,hh=Math.min(1.9,pitch*.55);
              const pp=[at(l,z),at(r,z),at(r,z+hh),at(l,z+hh)];
              // Adjacent wings must not leave windows embedded in another volume.
              if(a.masses.some(other=>other!==m&&other.base<=z&&other.base+other.height>z&&inMass([at((l+r)/2,z,.12)[0],at((l+r)/2,z,.12)[1]],other)))continue;
              quad(...pp,'glass',(col+floor+seed)%4===0?pal[4]:'#9ac9d0');
              const sill0=at(l-.025/cols,z-.10,.06),sill1=at(r+.025/cols,z-.10,.06);strip(sill0,sill1,z-.10,.10,'metal','#d9d9ca');
              if((col+floor*3+seed)%5<2)o.windows.push({points:pp,normal:n,warm:(col+seed)%4!==0});
              if(floor>0&&(col+mi)%3===0)quad(at(l,z-.55),at(r,z-.55),at(r,z-.18),at(l,z-.18),'metal',pal[2]);
            }
          }
          // Roof edge capping follows every straight or angled boundary segment.
          for(let j=0;j<segments;j++){const pp=at(j/segments,0),qq=at((j+1)/segments,0);pp[2]=roofZ(pp[0],pp[1])+.04;qq[2]=roofZ(qq[0],qq[1])+.04;quad(pp,qq,[qq[0],qq[1],qq[2]+.25],[pp[0],pp[1],pp[2]+.25],'metal','#cbd3cd');}
        }
      }
      roofProgram(m,roofZ);
    }
    function cylinder(x,y,r,z,h,color,n=24){
      for(let i=0;i<n;i++){const p=[x+r*Math.cos(i*2*Math.PI/n),y+r*Math.sin(i*2*Math.PI/n)],q=[x+r*Math.cos((i+1)*2*Math.PI/n),y+r*Math.sin((i+1)*2*Math.PI/n)];quad([...p,z],[...q,z],[...q,z+h],[...p,z+h],'metal',color);mesh([[x,y,z+h],[...p,z+h],[...q,z+h]],'metal',color);}
    }
    function roofProgram(m,roofZ){
      const plan=m.roofPlan;if(!plan)return;
      const z=m.base+m.height;
      const slab=(u,color='#c0b8a2')=>box(u.x,u.y,z+.04,u.w,u.d,.12,'paving',color);
      for(const u of plan.units){
        const {x,y,w,d,type}=u;
        if(type==='rooflight'){
          // Segments follow the roof rather than float horizontally above it.
          const nx=4,ny=8,lift=m.roof==='hip'?.65:.10;
          for(let i=0;i<nx;i++)for(let j=0;j<ny;j++){
            const x0=x-w/2+w*i/nx,x1=x-w/2+w*(i+1)/nx,y0=y-d/2+d*j/ny,y1=y-d/2+d*(j+1)/ny;
            quad([x0,y0,roofZ(x0,y0)+lift],[x1,y0,roofZ(x1,y0)+lift],[x1,y1,roofZ(x1,y1)+lift],[x0,y1,roofZ(x0,y1)+lift],'glass','#87becb');
          }
          for(let i=0;i<=nx;i++){const xx=x-w/2+w*i/nx;for(let j=0;j<ny;j++){const ya=y-d/2+d*j/ny,yb=y-d/2+d*(j+1)/ny;quad([xx-.045,ya,roofZ(xx,ya)+lift+.07],[xx+.045,ya,roofZ(xx,ya)+lift+.07],[xx+.045,yb,roofZ(xx,yb)+lift+.07],[xx-.045,yb,roofZ(xx,yb)+lift+.07],'metal','#dbe1d7');}}
          if(m.roof==='hip'){
            const corners=[[x-w/2,y-d/2],[x+w/2,y-d/2],[x+w/2,y+d/2],[x-w/2,y+d/2]];
            for(let i=0;i<4;i++){const p=corners[i],q=corners[(i+1)%4];quad([...p,roofZ(...p)+.04],[...q,roofZ(...q)+.04],[...q,roofZ(...q)+lift],[...p,roofZ(...p)+lift],'metal','#bdc8bf');}
          }
          continue;
        }
        slab(u);
        if(type==='helipad'){
          cylinder(x,y,6.7,z+.18,.08,'#477f7a',48);
          for(let i=0;i<48;i++){const p=i*Math.PI/24,q=(i+1)*Math.PI/24,pt=(r,t)=>[x+r*Math.cos(t),y+r*Math.sin(t),z+.29];quad(pt(5.9,p),pt(6.08,p),pt(6.08,q),pt(5.9,q),'marking','#f0e9c6');}
          for(const dx of [-1.3,1.3])box(x+dx,y,z+.30,.48,4.5,.035,'marking','#f3eee1');box(x,y,z+.30,3.1,.48,.035,'marking','#f3eee1');
          for(const dx of [-5.5,5.5])for(const dy of [-5.5,5.5])box(x+dx,y+dy,z+.2,.18,.18,.18,'marking','#e3bd5f');
        }else if(type==='plantroom'){
          box(x,y,z+.17,w*.77,d*.72,2.25,'facade','#c6c8b9');box(x,y,z+2.42,w*.82,d*.77,.15,'metal','#6e858b');
          box(x,y-d*.37,z+.3,1.0,.08,1.85,'metal','#526b72');
          for(let i=0;i<5;i++)box(x+w*.39,y-d*.25+i*d*.12,z+.65,.08,.16,1.1,'metal','#577079');
          box(x+w*.15,y,z+2.6,.6,.6,.8,'metal','#a8b6af');
        }else if(type==='chiller'){
          box(x,y,z+.18,w*.82,d*.72,1.25,'metal','#c4d0ca');
          for(const dx of [-w*.22,w*.22]){cylinder(x+dx,y,.68,z+1.44,.10,'#384f57',20);for(let i=0;i<6;i++){const t=i*Math.PI/3;quad([x+dx,y,z+1.57],[x+dx+.57*Math.cos(t),y+.57*Math.sin(t),z+1.57],[x+dx+.45*Math.cos(t+.35),y+.45*Math.sin(t+.35),z+1.57],[x+dx+.1,y,z+1.57],'metal','#8da7ab');}}
          for(let j=0;j<7;j++)box(x-w*.42,y-d*.27+j*d*.085,z+.4,.04,.1,.8,'metal','#5f777d');
          box(x,y+d*.4,z+.55,w*.75,.20,.20,'metal','#9caa9e');
        }else if(type==='duct'){
          box(x-w*.22,y,z+.2,1.2,d*.78,.65,'metal','#a7b5af');box(x,y+d*.25,z+.2,w*.65,1.2,.65,'metal','#a7b5af');
          for(let i=0;i<5;i++)box(x-w*.22,y-d*.35+i*d*.15,z+.87,1.24,.07,.03,'metal','#6f8587');
          for(const dx of [-w*.26,w*.26]){cylinder(x+dx,y-d*.23,.38,z+.3,1.8,'#b4c0b5',16);cylinder(x+dx,y-d*.23,.55,z+2.1,.14,'#6f898c',16);}
        }else if(type==='solar'){
          for(let j=0;j<2;j++)for(let i=0;i<3;i++){
            const xx=x-w*.33+i*w*.33,yy=y-d*.24+j*d*.48,ww=w*.28,dd=d*.38;
            for(const sign of [-1,1])box(xx+sign*ww*.4,yy,z+.18,.08,dd,.35,'metal','#a6b7b3');
            quad([xx-ww/2,yy-dd/2,z+.5],[xx+ww/2,yy-dd/2,z+.5],[xx+ww/2,yy+dd/2,z+.9],[xx-ww/2,yy+dd/2,z+.9],'glass','#315d83');
            for(let q=1;q<4;q++){const xp=xx-ww/2+q*ww/4;quad([xp-.012,yy-dd/2,z+.51],[xp+.012,yy-dd/2,z+.51],[xp+.012,yy+dd/2,z+.91],[xp-.012,yy+dd/2,z+.91],'metal','#a7c7ce');}
          }
        }else if(type==='skylight'){
          const ww=w*.72,dd=d*.65;box(x,y,z+.18,ww+.25,dd+.25,.3,'metal','#b8c6c2');
          quad([x-ww/2,y-dd/2,z+.5],[x,y-dd/2,z+1.25],[x,y+dd/2,z+1.25],[x-ww/2,y+dd/2,z+.5],'glass','#85b9c4');
          quad([x,y-dd/2,z+1.25],[x+ww/2,y-dd/2,z+.5],[x+ww/2,y+dd/2,z+.5],[x,y+dd/2,z+1.25],'glass','#689db2');
          for(let j=0;j<=4;j++)box(x,y-dd/2+j*dd/4,z+1.27,.08,.06,.06,'metal','#d6dfd4');
        }else if(type==='garden'){
          box(x,y,z+.18,w*.92,d*.89,.12,'grass','#7e9959');
          for(const dx of [-w*.30,w*.30]){box(x+dx,y,z+.3,w*.24,d*.68,.45,'paving','#bfb69d');box(x+dx,y,z+.76,w*.21,d*.63,.12,'grass','#557d4f');for(const dy of [-d*.19,d*.19])cylinder(x+dx,y+dy,Math.min(.65,w*.10),z+.9,.5,'#638e58',12);}
          box(x,y,z+.31,w*.19,d*.83,.06,'paving','#d8c9a4');
        }else if(type==='pergola'){
          slab(u,'#b79a74');for(const dx of [-w*.4,w*.4])for(const dy of [-d*.4,d*.4])box(x+dx,y+dy,z+.2,.15,.15,2.3,'roofTiles','#9e7854');
          for(let j=0;j<7;j++)box(x,y-d*.42+j*d*.14,z+2.5,w*.92,.15,.17,'roofTiles','#b39167');box(x,y,z+.2,w*.45,.55,.45,'roofTiles','#bb976d');
        }else if(type==='terrace'){
          slab(u,'#c2a57d');for(const dy of [-d*.3,d*.3]){box(x,y+dy,z+.2,w*.7,.48,.44,'roofTiles','#af815c');box(x,y+dy,z+.65,w*.7,.52,.1,'roofTiles','#c8a577');}
          cylinder(x,y,.72,z+.2,.75,'#d1c6aa',12);
        }
        // Service slabs, rather than a global repeating roof image, divide the roof into legible uses.
      }
      if(plan.marker){const [x,y]=plan.marker;box(x,y,z+.12,5.2,1.55,.11,'carPaint','#df3030');box(x,y,z+.12,1.55,5.2,.12,'carPaint','#df3030');}
    }
    for(const e of a.features){
      const {x,y,radius:r}=e;
      if(['water_tank','settling_tank'].includes(e.kind)){
        cylinder(x,y,r,0,2.4,'#c3ccc4');cylinder(x,y,r*.90,2.41,.06,e.kind==='water_tank'?'#559aaf':'#6b9b86');box(x,y,2.5,r*1.85,.28,.20,'metal','#d7dcca');cylinder(x,y,.35,2.5,.8,'#b9c7bd');
      }else if(e.kind==='cooling_tower'){
        const height=Math.min(e.height,r*3.8),profile=Array.from({length:13},(_,i)=>[r*(.60+.35*Math.pow((i/12-.68)/.68,2)),height*i/12]);
        for(let j=0;j<12;j++)for(let i=0;i<32;i++){
          const pt=(t,layer,inner=0)=>[x+(profile[layer][0]-inner)*Math.cos(t*2*Math.PI/32),y+(profile[layer][0]-inner)*Math.sin(t*2*Math.PI/32),profile[layer][1]];
          quad(pt(i,j),pt(i+1,j),pt(i+1,j+1),pt(i,j+1),'facade','#bdc7b7');if(j>8)quad(pt(i,j,.3),pt(i,j+1,.3),pt(i+1,j+1,.3),pt(i+1,j,.3),'facade','#758985');
        }
        cylinder(x,y,r*.6,height*.74,.05,'#334f55');
      }else if(e.kind==='silo'){cylinder(x,y,r*.75,0,Math.min(e.height,r*3),'#aebfc0');}
      else if(e.kind==='transformer'){
        box(x,y,0,r*1.3,r*1.3,2.6,'metal','#77978e');for(const dx of [-r*.35,r*.35]){cylinder(x+dx,y,.32,2.6,1.7,'#9d7353');for(let i=0;i<5;i++)cylinder(x+dx,y,.5,2.8+i*.28,.1,'#cebe98');}
      }else if(e.kind==='fuel_canopy'||e.kind==='solar_canopy'){
        box(x,y,4.6,r*1.6,r*1.4,.28,'metal',e.kind==='fuel_canopy'?'#c84432':'#397397');
        for(const dx of [-r*.58,r*.58]){box(x+dx,y,0,.2,.2,4.6,'metal','#c5d0c5');box(x+dx*.5,y,0,.75,.65,1.6,'metal',e.kind==='fuel_canopy'?'#dfd6bb':'#67a18a');}
        if(e.kind==='solar_canopy')for(let i=-2;i<=2;i++)box(x+i*r*.28,y,4.9,r*.24,r*1.2,.05,'glass','#659cbb');
      }else if(['ambulance','fire_truck','patrol_car'].includes(e.kind)){
        const fire=e.kind==='fire_truck';box(x,y,.3,2.1,fire?5.8:4.6,fire?2.2:1.8,'carPaint',fire?'#c83c2e':'#e2e7dd');box(x,y-1.4,1.4,1.8,.9,.6,'glass','#4f819a');box(x,y,fire?2.6:2.15,1.6,.35,.18,'carPaint','#d33232');
        for(const dx of [-1.04,1.04])for(const dy of [-1.5,1.5])box(x+dx,y+dy,.2,.25,.8,.65,'carPaint','#34474b');
      }else if(e.kind==='pool'||e.kind==='sports_court'){
        box(x,y,.02,r*1.5,r*1.2,.05,'paving','#d2b48c');box(x,y,.08,r*1.35,r*1.06,.05,e.kind==='pool'?'glass':'grass',e.kind==='pool'?'#559fb9':'#6d9863');
        for(const sign of [-1,1])box(x+sign*r*.65,y,.14,.08,r*1.04,.02,'marking','#eee9d6');
      }else if(e.kind==='fountain'){cylinder(x,y,r*.7,0,.65,'#c9c4ae');cylinder(x,y,r*.6,.66,.05,'#78b5c1');cylinder(x,y,.5,.7,1.0,'#c3d5c8');
      }else if(e.kind==='sculpture'){cylinder(x,y,1.3,0,.55,'#d3c8ad');box(x,y,.55,.65,.65,3.2,'metal','#629b9a');box(x+.6,y,2.2,1.7,.65,.6,'metal','#bd8c58');
      }else if(e.kind==='billboard'){for(const sign of [-1,1])box(x+sign*1.2,y,0,.15,.15,3,'metal','#8faaa5');box(x,y,2,3,.20,1.7,'metal',pal[2]);
      }else{
        for(let i=-1;i<=1;i++)box(x+i*r*.5,y,0,r*.43,r*1.25,2.6,'metal',['#b56f4a','#568c97','#9aa666'][(i+e.seed+4)%3]);
      }
    }
    o.trees.push(...a.trees);
    // Visible function markers remain attached to a real roof, including irregular ones.
    const main=a.masses.reduce((best,m)=>m.height+m.base>best.height+best.base?m:best,a.masses[0]);
    if(main){
      const [x,y]=main.center,z=main.base+main.height+.1;
      if(f.kind==='hospital'&&!main.roofPlan){
        // Find a roof triangle with room for the cross so courtyards stay open.
        const candidates=main.triangles.map(t=>[(t[0][0]+t[1][0]+t[2][0])/3,(t[0][1]+t[1][1]+t[2][1])/3]);
        const c=[[x,y],...candidates].find(c=>[[-2,-2],[2,-2],[2,2],[-2,2]].every(p=>inMass([c[0]+p[0],c[1]+p[1]],main)));
        if(c){box(c[0],c[1],z,4.0,1.25,.10,'carPaint','#df3030');box(c[0],c[1],z,1.25,4.0,.11,'carPaint','#df3030');}
      }else if(!main.roofPlan&&['hotel','cinema','fire_station','police_station','university'].includes(f.kind))label({hotel:'HOTEL',cinema:'CINEMA',fire_station:'FIRE',police_station:'POLICE',university:'大学'}[f.kind],x,y,z+.1,2.5,pal[2]);
    }
    const entry=f.accessPoint||f.point,origin=f.origin||f.point,angle=-f.rotation*Math.PI/180,ex=(entry[0]-origin[0])*Math.cos(angle)-(entry[1]-origin[1])*Math.sin(angle),ey=(entry[0]-origin[0])*Math.sin(angle)+(entry[1]-origin[1])*Math.cos(angle);
    for(const dx of [-2,2])if(inSite([ex+dx,ey+1]))o.lights.push([ex+dx,ey+1]);
  }
  const api={populate};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CityBlockArchitecture=api;
})(typeof window==='undefined'?{}:window);
