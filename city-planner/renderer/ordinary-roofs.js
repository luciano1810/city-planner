/* Seeded roof structures shared by the ordinary-building Canvas and WebGL paths. */
(function(root){
  'use strict';
  const G=typeof module!=='undefined'&&module.exports?require('./city-geometry.js'):root.CityGeometry,cache=new WeakMap();
  const appearance=typeof module!=='undefined'&&module.exports?require('./building-appearance.js'):root.CityBuildingAppearance;
  const shapes=typeof module!=='undefined'&&module.exports?require('./building-shapes.js'):root.CityBuildingShapes;
  const equipmentCells=new Map(),equipmentTypes={chiller:0,duct:1,access:2,skylight:3};
  const equipmentHeights={crown:4,access:2.06,chiller:1.05,duct:1.25,chimney:1.65,solar:.55,skylight:.45,garden:1.05,pergola:2.24,terrace:.85};
  // The source atlas includes a front face. Use its lid for horizontal units;
  // their walls are projected separately so turning a building cannot turn
  // the apparent camera direction with it.
  const equipmentLids={chiller:.73,access:.65,skylight:.94};
  let equipmentAtlas=null,equipmentVersion=0;
  if(typeof Image!=='undefined'){
    const image=new Image();image.onload=()=>{equipmentAtlas=image;equipmentVersion++;equipmentCells.clear();root.MapWorkspace?.draw();};image.src='assets/roof-equipment.png';
  }
  function equipmentSprite(type){
    if(!equipmentAtlas||equipmentTypes[type]===undefined)return null;
    if(equipmentCells.has(type))return equipmentCells.get(type);
    const tile=document.createElement('canvas');tile.width=tile.height=256;const g=tile.getContext('2d',{willReadFrequently:true}),cell=equipmentTypes[type],q=equipmentAtlas.width/2;
    g.drawImage(equipmentAtlas,cell%2*q+2,Math.floor(cell/2)*q+2,q-4,q-4,0,0,256,256);
    const pixels=g.getImageData(0,0,256,256);root.SurfaceVariation?.isolateSprite(pixels.data,256,256);g.putImageData(pixels,0,0);
    const b=[256,256,0,0];for(let y=0;y<256;y++)for(let x=0;x<256;x++)if(pixels.data[(y*256+x)*4+3]>48){b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x+1);b[3]=Math.max(b[3],y+1);}
    if(b[2]<=b[0])return null;
    const image=document.createElement('canvas');image.width=b[2]-b[0];image.height=b[3]-b[1];image.getContext('2d').drawImage(tile,b[0],b[1],image.width,image.height,0,0,image.width,image.height);
    equipmentCells.set(type,image);return image;
  }
  function equipmentSize(unit){return [unit.w*(unit.type==='access'?.94:1),unit.d*(unit.type==='chiller'?.78:unit.type==='access'?.9:1)];}
  function hash(s){let n=2166136261;for(const c of String(s)){n^=c.charCodeAt(0);n=Math.imul(n,16777619);}return n>>>0;}
  function layout(parcel){
    const b=parcel.building;if(cache.has(b))return cache.get(b);
    const masses=G.buildingMassing(parcel).volumes,result=[];
    masses.forEach((v,index)=>{
      const seed=hash(parcel.id+':roof-v2:'+index);let state=seed;
      const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
      const meshes=[],units=[],entry={volume:v,meshes,units,shape:'flat',seed};result.push(entry);
      if(!v.rect)return;
      const [x0,y0,x1,y1]=v.rect,w=x1-x0,d=y1-y0,h=v.height,angle=v.angle,c=Math.cos(angle),s=Math.sin(angle);
      const world=([x,y,z])=>[v.origin[0]+x*c-y*s,v.origin[1]+x*s+y*c,z];
      const choices=v.type==='house'?['hip','gable','gable','mono','flat']:v.type==='hall'?['sawtooth','barrel','gable','sawtooth','flat']:['flat'];
      const shape=entry.shape=v.outline?'flat':choices[seed%choices.length],rise=Math.min(v.type==='hall'?5:3.8,d*.24),mid=(y0+y1)/2;
      const skin=shape==='flat'?(v.type==='terrace'?'paving':seed%3===0?'gravel':'roof'):v.type==='house'?'roofTiles':'metal';
      const colors=skin==='roofTiles'?['#b27a56','#a4937b','#75878a','#af9476']:skin==='metal'?['#aebbb7','#a7b8be','#c4c6b8','#a5b5b5']:skin==='paving'?['#d9d4c5','#d2d3c7','#dcd6c7','#cfd3c9']:['#e6e3d9','#dfe3dc','#e8e3d7','#dce1dd'];
      const flatColors={residential:['#bab5a5','#b4bcb0','#b9b7ad','#9baba3'],office:['#929c9c','#bbbdb2','#c6c4b8','#9fa9a5'],commercial:['#beb8a5','#a2aaa2','#c1c2b6','#adb4ad'],industrial:['#9da7a5','#b3b6ad','#bdbaa8','#8d9d9f'],warehouse:['#a6afb0','#c1bdac','#a5b1aa','#909da0']};
      const finish=appearance?.profile(parcel),roofColor=shape==='flat'&&v.type!=='terrace'?(flatColors[b.use]||flatColors.commercial)[finish?.roofTone??((seed>>>4)%4)]:colors[(seed>>>4)%4],uvScale=5+random()*6,phase=[random()*20,random()*20],turn=(seed>>>8)%4*Math.PI/2;
      let unitType=null;
      function tri(points,material,color,roof=false){const ps=points.map(world);meshes.push({points:ps,material,color,variant:(seed>>>12)%4,roof,unitType,uv:points.map(([x,y])=>[(x*Math.cos(turn)-y*Math.sin(turn))/uvScale+phase[0],(x*Math.sin(turn)+y*Math.cos(turn))/uvScale+phase[1]])});}
      function quad(ps,material,color,roof=false){tri([ps[0],ps[1],ps[2]],material,color,roof);tri([ps[0],ps[2],ps[3]],material,color,roof);}
      function box(x,y,z,ww,dd,hh,color,material='metal'){
        const p=[[x-ww/2,y-dd/2],[x+ww/2,y-dd/2],[x+ww/2,y+dd/2],[x-ww/2,y+dd/2]];
        const bevel=Math.min(.075,ww*.08,dd*.08,hh*.2),top=p.map(([a,b])=>[a+Math.sign(x-a)*bevel,b+Math.sign(y-b)*bevel]);
        quad(top.map(q=>[...q,z+hh]),material,color);
        for(let i=0;i<4;i++){
          const j=(i+1)%4,a=p[i],b=p[j];
          quad([[...a,z],[...b,z],[...b,z+hh-bevel],[...a,z+hh-bevel]],material,color);
          quad([[...a,z+hh-bevel],[...b,z+hh-bevel],[...top[j],z+hh],[...top[i],z+hh]],material,color);
        }
      }
      function disc(x,y,z,r,color){for(let i=0;i<12;i++){const a=i*Math.PI/6,b=(i+1)*Math.PI/6;tri([[x,y,z],[x+r*Math.cos(a),y+r*Math.sin(a),z],[x+r*Math.cos(b),y+r*Math.sin(b),z]],'metal',color);}}
      function roofZ(x,y){
        if(shape==='hip')return h+.08+rise*Math.max(0,Math.min(1,(x-x0)/Math.min(w*.22,d*.5),(x1-x)/Math.min(w*.22,d*.5),(y-y0)/(d/2),(y1-y)/(d/2)));
        if(shape==='gable')return h+.08+rise*(1-Math.abs(y-mid)/(d/2));
        if(shape==='mono')return h+.08+rise*(y-y0)/d;
        if(shape==='barrel')return h+.08+rise*Math.sqrt(Math.max(0,1-((y-mid)/(d/2))**2));
        if(shape==='sawtooth'){const pitch=d/Math.max(2,Math.round(d/7)),t=(y-y0)/pitch;return h+.08+Math.min(2.5,rise)*(t-Math.floor(t));}
        return h+.08;
      }
      // Roof facets have real height; raised edges are closed by matching fascia.
      if(v.outline){
        for(const t of shapes.triangulate(v.outline))tri(t.map(p=>[...p,h+.08]),skin,roofColor,true);
      }else if(shape==='sawtooth'){
        const count=Math.max(2,Math.round(d/7)),pitch=d/count,rr=Math.min(2.5,rise);
        for(let i=0;i<count;i++){const ya=y0+i*pitch,yb=ya+pitch;
          quad([[x0,ya,h+.08],[x1,ya,h+.08],[x1,yb,h+rr],[x0,yb,h+rr]],skin,roofColor,true);
          quad([[x0,yb,h+rr],[x1,yb,h+rr],[x1,yb,h+.08],[x0,yb,h+.08]],'glass','#8bb5bd');
          for(const x of [x0,x1]){const ps=[[x,ya,h+.08],[x,yb,h+.08],[x,yb,h+rr]];tri(x===x0?ps.slice().reverse():ps,'metal',roofColor);}
        }
      }else{
        const nx=shape==='hip'?8:1,ny=shape==='barrel'?12:shape==='hip'?8:2;
        for(let i=0;i<nx;i++)for(let j=0;j<ny;j++){
          const xa=x0+w*i/nx,xb=x0+w*(i+1)/nx,ya=y0+d*j/ny,yb=y0+d*(j+1)/ny;
          quad([[xa,ya,roofZ(xa,ya)],[xb,ya,roofZ(xb,ya)],[xb,yb,roofZ(xb,yb)],[xa,yb,roofZ(xa,yb)]],skin,roofColor,true);
        }
        const ring=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
        for(let e=0;e<4;e++)for(let j=0;j<12;j++){const a=ring[e],b=ring[(e+1)%4],p=[a[0]+(b[0]-a[0])*j/12,a[1]+(b[1]-a[1])*j/12],q=[a[0]+(b[0]-a[0])*(j+1)/12,a[1]+(b[1]-a[1])*(j+1)/12];quad([[...p,h],[...q,h],[...q,roofZ(...q)],[...p,roofZ(...p)]],'metal',roofColor);}
      }
      if(shape==='gable'||shape==='hip'){const hip=shape==='hip'?Math.min(w*.22,d*.5):.15;box((x0+x1)/2,mid,h+.08+rise,w-hip*2,.18,.14,'#ccb99e','metal');}
      function fits(x,y,ww,dd){
        const r=[x-ww/2,y-dd/2,x+ww/2,y+dd/2];
        if(v.outline&&!shapes.fits(r,v.outline,.65))return false;
        if(r[0]<x0+.8||r[1]<y0+.8||r[2]>x1-.8||r[3]>y1-.8)return false;
        if(entry.zones?.some(u=>r[0]<u.x+u.w/2+.65&&r[2]>u.x-u.w/2-.65&&r[1]<u.y+u.d/2+.65&&r[3]>u.y-u.d/2-.65))return false;
        if(units.some(u=>r[0]<u.x+u.w/2+.65&&r[2]>u.x-u.w/2-.65&&r[1]<u.y+u.d/2+.65&&r[3]>u.y-u.d/2-.65))return false;
        return !masses.some(q=>q!==v&&q.rect&&q.height>h+.1&&q.base<=h+.1&&r[0]<q.rect[2]+.5&&r[2]>q.rect[0]-.5&&r[1]<q.rect[3]+.5&&r[3]>q.rect[1]-.5);
      }
      // Crown treatments are reserved for tall office roofs, with finite setbacks.
      if(shape==='flat'&&v.type==='tower'&&h>35&&Math.abs(h-(b.height||b.floors*3.3))<.1&&seed%3!==0&&w>9&&d>9){
        const x=(x0+x1)/2,y=(y0+y1)/2,ww=Math.min(12,w*.54),dd=Math.min(10,d*.48);
        if(fits(x,y,ww,dd)){
          units.push({type:'crown',x,y,w:ww,d:dd,z:h+.12});
          const variant=(seed>>>5)%3;box(x,y,h+.12,ww,dd,2.4,variant===1?'#697d83':'#8aa6aa',variant===1?'metal':'glass');
          if(variant===0){box(x,y,h+2.52,ww*.7,dd*.7,1.1,'#abbdb8');box(x,y,h+3.62,.16,.16,3.4,'#bec9c6');}
          else if(variant===1){for(let level=0;level<4;level++)box(x,y,h+.4+level*.55,ww+.1,dd+.1,.12,'#c7d1c9');}
          else for(const side of [-1,1])box(x+side*ww*.42,y,h+2.52,.2,dd,1.35,'#c6d5d0');
        }
      }
      entry.zones=appearance?.roofZones(parcel,v,masses,shape,units)||[];
      const residentialDeck=b.use==='residential'&&(seed%3===0||v.type==='terrace');
      const defaultPrograms=residentialDeck?['access','pergola','garden','terrace','garden','solar']:b.use==='residential'?['access','solar','solar','garden','skylight','chiller']:b.use==='commercial'?['access','chiller','skylight','chiller','duct','skylight']:b.use==='office'?['access','chiller','chiller','duct','skylight','solar']:['access','duct','chiller','skylight','solar','chiller'];
      const programs=appearance?.roofPrograms(parcel,v,defaultPrograms)||defaultPrograms;
      const dimensions={access:[3.15,2.6],chiller:[2.7,2.2],duct:[2.7,2.15],skylight:[1.75,1.65],solar:[3.7,2.5],chimney:[1.3,1.3],garden:[3.4,2.5],pergola:[4.1,3.1],terrace:[3.8,3.1]};
      const max=Math.min(8,Math.max(1,Math.floor(w*d/(shape==='flat'?105:150)))),longX=w>=d,flip=(seed>>>8)%2;
      const typeCounts={};
      for(let slot=0;slot<max&&units.length<max&&shape!=='sawtooth';slot++){
        const type=shape==='flat'?programs[slot%programs.length]:(slot===0&&v.type==='house'&&seed%2===0?'chimney':seed%3===0?'solar':'skylight');
        if(type==='access'&&typeCounts.access)continue;
        const size=dimensions[type],variation=.94+((seed>>>(slot*3%24))&3)*.04,ww=Math.min(size[0]*variation,w*.36),dd=Math.min(size[1]*variation,d*.36),ordinal=typeCounts[type]||0;
        // Service units share a modest roof-edge zone. Glazing, solar and
        // occupied terraces have their own bays, rather than a random mix of
        // identically sized appliances over the entire deck.
        const targets={access:[.2,.18],chiller:[.43+ordinal*.22,.2],duct:[.8,.23],skylight:[.28+ordinal*.35,.66],solar:[.38+ordinal*.28,.69],garden:[.55+ordinal*.2,.72],pergola:[.22,.72],terrace:[.8,.78],chimney:[.23,.25]};
        let [u,t]=targets[type];if(flip)t=1-t;
        const target=longX?[x0+w*u,y0+d*t]:[x0+w*t,y0+d*u],inset=.95;
        const xa=x0+inset+ww/2,xb=x1-inset-ww/2,ya=y0+inset+dd/2,yb=y1-inset-dd/2;
        if(xa>xb||ya>yb)continue;
        const nx=Math.min(8,Math.max(1,Math.ceil((xb-xa)/3.4))),ny=Math.min(8,Math.max(1,Math.ceil((yb-ya)/3.4))),candidates=[];
        for(let iy=0;iy<=ny;iy++)for(let ix=0;ix<=nx;ix++){
          const x=xa+(xb-xa)*ix/nx,y=ya+(yb-ya)*iy/ny;
          candidates.push({x,y,score:(x-target[0])**2+(y-target[1])**2});
        }
        candidates.sort((a,b)=>a.score-b.score);const position=candidates.find(p=>fits(p.x,p.y,ww,dd));if(!position)continue;
        const {x,y}=position,plinth=['access','chiller','duct','skylight'].includes(type)?.14:0,deckZ=roofZ(x,y)+.08,z=deckZ+plinth;
        units.push({type,x,y,w:ww,d:dd,z,deckZ,plinth});typeCounts[type]=ordinal+1;unitType=type;
        if(plinth)box(x,y,deckZ,ww,dd,plinth,'#bbbeb3','paving');
        if(type==='solar'||type==='skylight'){
          const rows=type==='solar'?2:1;
          if(type==='skylight')box(x,y,z,ww+.12,dd+.12,.25,'#c4cbc4');
          for(let row=0;row<rows;row++){
            const ya=y-dd/2+dd*row/rows,yb=ya+dd/rows*.83,xa=x-ww/2,xb=x+ww/2;
            const zz=(xx,yy)=>roofZ(xx,yy)+.16+plinth+(type==='solar'?(yy-ya)*.2:.25);
            quad([[xa,ya,zz(xa,ya)],[xb,ya,zz(xb,ya)],[xb,yb,zz(xb,yb)],[xa,yb,zz(xa,yb)]],'glass',type==='solar'?'#315d80':'#8cc2cb');
            for(let n=0;n<=4;n++){const xx=xa+ww*n/4;quad([[xx-.035,ya,zz(xx,ya)+.03],[xx+.035,ya,zz(xx,ya)+.03],[xx+.035,yb,zz(xx,yb)+.03],[xx-.035,yb,zz(xx,yb)+.03]],'metal','#c6d4d1');}
          }
        }else if(type==='chimney'){
          box(x,y,z,1,1,1.5,'#b49880','facade');box(x,y,z+1.5,1.25,1.25,.15,'#586b70');
        }else if(type==='access'){
          box(x,y,z,ww*.86,dd*.82,1.9,'#c4c4b4','facade');box(x,y,z+1.9,ww*.94,dd*.9,.16,'#6b8286');box(x,y-dd*.42,z+.1,.8,.08,1.65,'#526d73');
        }else if(type==='chiller'){
          box(x,y,z,ww,dd*.7,1,'#c0cdcc');
          for(const dx of [-ww*.25,ww*.25]){
            const r=Math.min(.65,ww*.2);disc(x+dx,y,z+1.02,r+.09,'#d9dfd9');disc(x+dx,y,z+1.035,r,'#344e59');
            for(let i=0;i<6;i++){
              const a=i*Math.PI/3,b=a+.62;
              quad([[x+dx+Math.cos(a)*r*.2,y+Math.sin(a)*r*.2,z+1.045],[x+dx+Math.cos(a+.2)*r*.85,y+Math.sin(a+.2)*r*.85,z+1.045],[x+dx+Math.cos(b)*r*.8,y+Math.sin(b)*r*.8,z+1.045],[x+dx+Math.cos(b)*r*.2,y+Math.sin(b)*r*.2,z+1.045]],'metal','#8d9e9f');
            }
            disc(x+dx,y,z+1.055,r*.18,'#cbd3cd');
          }
          for(let n=0;n<5;n++)box(x-ww*.51,y-dd*.28+n*dd*.12,z+.15,.06,.12,.65,'#506b76');
        }else if(type==='duct'){
          box(x,y,z,ww,.8,.65,'#a5b2ad');box(x-ww*.32,y,z,.8,dd,.65,'#a5b2ad');box(x+ww*.3,y,z+.65,.6,.6,.6,'#798e90');
        }else if(type==='garden'){
          box(x,y,z,ww,dd,.28,'#c3b8a1','paving');
          for(const dx of [-ww*.3,ww*.3]){box(x+dx,y,z+.28,ww*.25,dd*.8,.25,'#a4ad89');for(const dy of [-dd*.2,dd*.2])box(x+dx,y+dy,z+.53,ww*.21,dd*.3,.45,'#638052','grass');}
        }else if(type==='pergola'){
          box(x,y,z,ww,dd,.12,'#b8a381','paving');for(const dx of [-ww*.43,ww*.43])for(const dy of [-dd*.4,dd*.4])box(x+dx,y+dy,z,.13,.13,2.1,'#b2a385');
          for(let i=0;i<6;i++)box(x-ww*.45+i*ww*.18,y,z+2.1,.16,dd,.14,'#c7b593');
        }else{
          box(x,y,z,ww,dd,.1,'#b8ad94','paving');for(const dy of [-dd*.32,dd*.32])box(x,y+dy,z+.15,ww*.8,.45,.45,'#bd9d72');box(x,y,z+.12,.8,.8,.7,'#c6bba1');
        }
      }
    });cache.set(b,result);return result;
  }
  function draw3D(batch,parcel,api){
    for(const e of layout(parcel))for(const m of e.meshes){const ids=[2,1,0];batch.triangle(api.tinted(m.material,m.color,m.variant),ids.map(i=>{const p=m.points[i];return [p[0],-p[1],p[2]];}),ids.map(i=>m.uv[i]));}
  }
  function drawCanvas(ctx,parcel,volume,scene){
    const e=layout(parcel).find(e=>e.volume===volume);if(!e||!volume.rect)return;
    const light=scene.lightingAt(scene.time),angle=light.azimuth*Math.PI/180,elevation=Math.max(0,light.elevation)*Math.PI/180;
    const sun=[Math.cos(angle)*Math.cos(elevation),Math.sin(angle)*Math.cos(elevation),Math.sin(elevation)];
    const project=p=>[p[0],p[1]-Math.min(85,p[2]*.26)];
    const trace=points=>{ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();};
    const normal=m=>{const [a,b,c]=m.points,u=b.map((n,i)=>n-a[i]),v=c.map((n,i)=>n-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...n)||1;return n.map(x=>x/length);};
    const shade=(color,factor)=>{const value=parseInt(color.slice(1),16);return `rgb(${[16,8,0].map(shift=>Math.round(Math.min(255,((value>>shift)&255)*factor))).join(',')})`;};
    const [x0,y0,x1,y1]=volume.rect,c=Math.cos(volume.angle),s=Math.sin(volume.angle),w=x1-x0,d=y1-y0,cx=(x0+x1)/2,cy=(y0+y1)/2,roofZ=volume.height+.08;
    const local=(x,y,z)=>project([volume.origin[0]+x*c-y*s,volume.origin[1]+x*s+y*c,z]);
    const rect=(x,y,width,depth,z)=>[[x-width/2,y-depth/2],[x+width/2,y-depth/2],[x+width/2,y+depth/2],[x-width/2,y+depth/2]].map(([a,b])=>local(a,b,z));
    const roof=volume.points.map(([x,y])=>project([x,y,roofZ]));
    const rim=Math.min(.46,w*.055,d*.055),parapetHeight=volume.type==='terrace'?.65:.78;
    const outer=rect(cx,cy,w-.12,d-.12,roofZ+parapetHeight),inner=rect(cx,cy,w-.12-rim*2,d-.12-rim*2,roofZ+parapetHeight),innerFoot=rect(cx,cy,w-.12-rim*2,d-.12-rim*2,roofZ);
    // Join each original coplanar roof quad before Canvas rasterization.
    // Separate antialiased triangles expose diagonal seams in pale roof skins.
    const surfaces=[];
    for(let i=0;i<e.meshes.length;i++){
      const a=e.meshes[i],b=e.meshes[i+1];
      if(a.roof&&b?.roof&&a.material===b.material&&a.color===b.color&&a.points[0].every((n,j)=>n===b.points[0][j])&&a.points[2].every((n,j)=>n===b.points[1][j])){
        surfaces.push({...a,points:[...a.points,b.points[2]]});i++;
      }else surfaces.push(a);
    }
    const depth=m=>m.points.reduce((s,p)=>s+p[1]*.26+p[2],0)/m.points.length;
    const meshes=surfaces.sort((a,b)=>depth(a)-depth(b));
    function paint(m){
      const n=normal(m);
      // Hidden faces must not repaint an equipment lid after it was drawn.
      if(n[2]+n[1]*.26<=.00001)return;
      const diffuse=Math.max(0,n.reduce((sum,x,i)=>sum+x*sun[i],0));
      trace(m.points.map(project));ctx.fillStyle=shade(m.color,n[2]>.65?.93+diffuse*.10:.56+diffuse*.30);ctx.fill();
      if(m.roof){
        ctx.save();ctx.clip();ctx.globalAlpha=.40;ctx.fillStyle=scene.material(ctx,m.material,m.variant);
        const points=m.points.map(project),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);ctx.fillRect(Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys));ctx.restore();
      }
    }
    function castOnRoof(base,offset,alpha){
      if(light.elevation<=0)return;
      ctx.beginPath();
      const add=points=>{const area=points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a[0]*b[1]-b[0]*a[1];},0);if(area<0)points=points.slice().reverse();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();};
      for(let i=0;i<base.length;i++){const a=base[i],b=base[(i+1)%base.length];add([a,b,[b[0]+offset[0],b[1]+offset[1]],[a[0]+offset[0],a[1]+offset[1]]]);}
      add(base.map(([x,y])=>[x+offset[0],y+offset[1]]));ctx.fillStyle=`rgba(37,47,47,${alpha})`;ctx.fill();
    }
    for(const m of meshes)if(m.roof)paint(m);
    appearance?.drawRoofZones(ctx,parcel,volume,scene,e.zones);
    ctx.save();trace(roof);ctx.clip();
    if(e.shape==='flat'&&!volume.outline){
      // Broad membrane panels and two drain sumps are sufficient to explain
      // the roof surface. Fine texture already comes from the cached material.
      const panelX=Math.max(9,w/48),panelY=Math.max(9,d/48);
      ctx.beginPath();ctx.strokeStyle='#65716620';ctx.lineWidth=.035;
      for(let x=x0+panelX;x<x1-.6;x+=panelX){ctx.moveTo(...local(x,y0,roofZ+.01));ctx.lineTo(...local(x,y1,roofZ+.01));}
      for(let y=y0+panelY;y<y1-.6;y+=panelY){ctx.moveTo(...local(x0,y,roofZ+.01));ctx.lineTo(...local(x1,y,roofZ+.01));}ctx.stroke();
      for(const [x,y] of [[x0+.78,y0+.78],[x1-.78,y1-.78]]){
        trace(rect(x,y,.38,.38,roofZ+.015));ctx.fillStyle='#adb4a877';ctx.fill();
        trace(rect(x,y,.18,.18,roofZ+.02));ctx.fillStyle='#65716b';ctx.fill();
      }
      // Only the inward part of the parapet shadow falls on this deck. A
      // connected sweep avoids the former dark outline around all four edges.
      const offset=scene.shadowOffset(parapetHeight,light);
      ctx.save();trace(innerFoot);ctx.clip();ctx.beginPath();
      for(let i=0;i<4;i++){
        const a=innerFoot[i],b=innerFoot[(i+1)%4];
        ctx.moveTo(...a);ctx.lineTo(...b);ctx.lineTo(b[0]+offset[0],b[1]+offset[1]);ctx.lineTo(a[0]+offset[0],a[1]+offset[1]);ctx.closePath();
      }
      ctx.fillStyle=`rgba(42,53,49,${light.strength*.68})`;ctx.fill();ctx.restore();
    }
    if(volume.outline){
      trace(roof);ctx.strokeStyle='#697c7380';ctx.lineWidth=.65;ctx.stroke();
      trace(roof);ctx.strokeStyle='#e2e4d5';ctx.lineWidth=.24;ctx.stroke();
    }
    // Contact patches and connected short cast shadows belong to the baked
    // building image, so no live geometry, canvas or blur is added per frame.
    for(const u of e.units){
      const deck=u.deckZ??u.z,[width,depth]=equipmentSize(u),base=rect(u.x,u.y,width,depth,deck);
      trace(rect(u.x,u.y,width+.26,depth+.26,deck));ctx.fillStyle='#26352e12';ctx.fill();
      trace(rect(u.x,u.y,width+.10,depth+.10,deck));ctx.fillStyle='#26352e29';ctx.fill();
      castOnRoof(base,scene.shadowOffset((equipmentHeights[u.type]||1)+(u.plinth||0),light),light.strength*.72);
    }
    ctx.restore();
    for(const m of meshes)if(!m.roof&&!(equipmentAtlas&&equipmentTypes[m.unitType]!==undefined))paint(m);
    if(e.shape==='flat'&&!volume.outline){
      // Four small solid walls replace nested perimeter strokes. Their inner
      // faces, outer faces and cap share the building's height projection.
      const bottom=rect(cx,cy,w-.12,d-.12,roofZ);
      for(let i=0;i<4;i++){
        const j=(i+1)%4,dx=outer[j][0]-outer[i][0],dy=outer[j][1]-outer[i][1],len=Math.hypot(dx,dy)||1;
        const exposure=(dy/len)*sun[0]-(dx/len)*sun[1];
        if(dx<-.0001){trace([bottom[i],bottom[j],outer[j],outer[i]]);ctx.fillStyle=shade('#acb3ac',.76+Math.max(0,exposure)*.23);ctx.fill();}
        else if(dx>.0001){
          trace([innerFoot[i],innerFoot[j],inner[j],inner[i]]);ctx.fillStyle=shade('#bdc2b7',.76+Math.max(0,-exposure)*.23);ctx.fill();
          ctx.beginPath();ctx.moveTo(...innerFoot[i]);ctx.lineTo(...innerFoot[j]);ctx.strokeStyle='#42524765';ctx.lineWidth=.08;ctx.stroke();
        }
        trace([outer[i],outer[j],inner[j],inner[i]]);ctx.fillStyle='#eeede1';ctx.fill();
        if(exposure>0){ctx.beginPath();ctx.moveTo(...outer[i]);ctx.lineTo(...outer[j]);ctx.strokeStyle='#fff9e7bd';ctx.lineWidth=.055;ctx.stroke();}
        // Cap stones have transverse joins, without another concentric line.
        const count=Math.min(24,Math.floor(len/3.6));ctx.beginPath();
        for(let n=1;n<count;n++){const t=n/count;ctx.moveTo(outer[i][0]+(outer[j][0]-outer[i][0])*t,outer[i][1]+(outer[j][1]-outer[i][1])*t);ctx.lineTo(inner[i][0]+(inner[j][0]-inner[i][0])*t,inner[i][1]+(inner[j][1]-inner[i][1])*t);}
        ctx.strokeStyle='#6f7a6b36';ctx.lineWidth=.028;ctx.stroke();
      }
    }
    for(const unit of e.units){
      if(unit.plinth&&equipmentAtlas&&equipmentTypes[unit.type]!==undefined){
        const foot=rect(unit.x,unit.y,unit.w,unit.d,unit.deckZ),top=rect(unit.x,unit.y,unit.w,unit.d,unit.z);
        for(let i=0;i<4;i++){const j=(i+1)%4;if(top[j][0]>=top[i][0])continue;trace([foot[i],foot[j],top[j],top[i]]);ctx.fillStyle='#929e94';ctx.fill();}
        trace(top);ctx.fillStyle='#c9ccbf';ctx.fill();
      }
      if(unit.type==='garden'&&scene.treeSprite){
        const sprite=scene.treeSprite(e.seed%4,true,true),radius=Math.min(unit.w*.19,unit.d*.28);
        for(const dx of [-unit.w*.3,unit.w*.3])for(const dy of [-unit.d*.2,unit.d*.2]){
          const p=local(unit.x+dx,unit.y+dy,unit.z+.75);ctx.drawImage(sprite,p[0]-radius,p[1]-radius,radius*2,radius*2);
        }
        continue;
      }
      if(unit.type==='solar'){
        const elevated=local(unit.x,unit.y,unit.z+.25);ctx.save();ctx.translate(...elevated);ctx.rotate(volume.angle);
        for(let row=0;row<2;row++){
          const y=-unit.d/2+row*unit.d/2,h=unit.d*.415;
          ctx.fillStyle='#c6cfc8';ctx.fillRect(-unit.w/2-.035,y-.035,unit.w+.07,h+.07);
          const glass=ctx.createLinearGradient(0,y,unit.w/2,y+h);glass.addColorStop(0,'#2f4a55');glass.addColorStop(.47,'#385f6e');glass.addColorStop(.52,'#507383');glass.addColorStop(1,'#304c59');ctx.fillStyle=glass;ctx.fillRect(-unit.w/2,y,unit.w,h);
          ctx.strokeStyle='#adc6c47c';ctx.lineWidth=.018;ctx.beginPath();
          for(let col=1;col<8;col++){const x=-unit.w/2+col*unit.w/8;ctx.moveTo(x,y);ctx.lineTo(x,y+h);}
          for(let line=1;line<4;line++){const yy=y+line*h/4;ctx.moveTo(-unit.w/2,yy);ctx.lineTo(unit.w/2,yy);}ctx.stroke();
        }
        ctx.restore();continue;
      }
      const sprite=equipmentSprite(unit.type);if(!sprite)continue;
      const [width,depth]=equipmentSize(unit),height=equipmentHeights[unit.type]||1,lid=equipmentLids[unit.type];
      if(!lid){
        // The L-shaped duct uses its silhouette rather than a solid box.
        const top=local(unit.x,unit.y,unit.z+height*.38);ctx.save();ctx.translate(...top);ctx.rotate(volume.angle);ctx.drawImage(sprite,-width/2,-depth/2,width,depth);ctx.restore();continue;
      }
      const base=rect(unit.x,unit.y,width,depth,unit.z),top=rect(unit.x,unit.y,width,depth,unit.z+height);
      for(let i=0;i<4;i++){
        const j=(i+1)%4,dx=base[j][0]-base[i][0],dy=base[j][1]-base[i][1];if(dx>=-.0001)continue;
        const length=Math.hypot(dx,dy),exposure=Math.max(0,dy/length*sun[0]-dx/length*sun[1]);
        trace([base[i],base[j],top[j],top[i]]);ctx.fillStyle=shade(unit.type==='access'?'#c9c8b9':'#abb6af',.73+exposure*.22);ctx.fill();
        const panel=(ta,tb,lo,hi)=>[[ta,lo],[tb,lo],[tb,hi],[ta,hi]].map(([t,h])=>[base[i][0]+dx*t,base[i][1]+dy*t-h*(base[i][1]-top[i][1])]);
        if(unit.type==='chiller'){
          trace(panel(.12,.88,.17,.78));ctx.fillStyle='#586560';ctx.fill();
          ctx.beginPath();for(let row=0;row<4;row++){const ps=panel(.12,.88,.25+row*.13,.25+row*.13);ctx.moveTo(...ps[0]);ctx.lineTo(...ps[1]);}ctx.strokeStyle='#abb4a785';ctx.lineWidth=.025;ctx.stroke();
        }else if(unit.type==='access'){
          trace(panel(.17,.46,.05,.79));ctx.fillStyle='#808b82';ctx.fill();
          trace(panel(.20,.43,.13,.69));ctx.fillStyle='#a4aca1';ctx.fill();
        }
      }
      const at=local(unit.x,unit.y,unit.z+height);ctx.save();ctx.translate(...at);ctx.rotate(volume.angle);
      ctx.fillStyle='#d7dbcf';ctx.fillRect(-width/2,-depth/2,width,depth);
      ctx.drawImage(sprite,0,0,sprite.width,sprite.height*lid,-width/2,-depth/2,width,depth);ctx.restore();
      trace(top);ctx.strokeStyle='#e7e9dd9c';ctx.lineWidth=.04;ctx.stroke();
    }
  }

  const api={layout,draw3D,drawCanvas,get assetVersion(){return equipmentVersion;},get ready(){return typeof Image==='undefined'||Boolean(equipmentAtlas);}};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CityOrdinaryRoofs=api;
})(typeof window==='undefined'?{}:window);
