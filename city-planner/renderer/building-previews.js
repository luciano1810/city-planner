/* Isolated, daylight model portraits. Facility layouts, ordinary building
 * massing and roof meshes come from the same models used by the city. */
(() => {
  'use strict';
  const models=new Map(),pictures=new Map(),pending=new Set();
  const colors={grass:'#9aaa83',paving:'#c9c5b7',asphalt:'#737b79',water:'#83adba',facade:'#c5bfaf',roof:'#c7cac1',roofTiles:'#a78b6e',metal:'#aab8b8',glass:'#668b99',marking:'#f4eedb',soil:'#b4a185'};
  const angle=-Math.PI/7,ca=Math.cos(angle),sa=Math.sin(angle),pitch=.59,lift=Math.sqrt(1-pitch*pitch);
  const project=([x,y,z=0])=>[x*ca-y*sa,(x*sa+y*ca)*pitch-z*lift];
  const depth=([x,y,z=0])=>(x*sa+y*ca)*lift+z*pitch;
  const quad=(x,y,w,d,z=0)=>[[x-w/2,y-d/2,z],[x+w/2,y-d/2,z],[x+w/2,y+d/2,z],[x-w/2,y+d/2,z]];
  function normal(points){const [a,b,c]=points,u=b.map((v,i)=>v-a[i]),v=c.map((q,i)=>q-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...n)||1;return n.map(q=>q/length);}
  function tint(color,factor){const n=parseInt(color.slice(1),16);return `rgb(${[16,8,0].map(s=>Math.round(Math.min(255,(n>>s&255)*factor))).join(',')})`;}
  function scene(){
    const m={faces:[],ground:[],lines:[],trees:[],shadows:[],frame:null};
    m.face=(points,material='facade',color=null,details=[])=>{const face={points,material,color:color||colors[material]||colors.facade,details};m.faces.push(face);return face;};
    m.surface=(x,y,w,d,material='paving',color=null,z=0)=>m.ground.push({points:quad(x,y,w,d,z),material,color:color||colors[material]});
    m.line=(points,width=.2,color='#eee9d9',dash=[])=>m.lines.push({points,width,color,dash});
    m.box=(x,y,z,w,d,h,material='facade',color=null,top='roof',windows=false)=>{
      const bottom=quad(x,y,w,d,z),roof=quad(x,y,w,d,z+h);
      m.shadows.push({points:bottom,height:z+h});
      for(let side=0;side<4;side++){
        const a=bottom[side],b=bottom[(side+1)%4],face=m.face([a,b,roof[(side+1)%4],roof[side]],material,color);
        if(windows&&h>2){
          const length=Math.hypot(b[0]-a[0],b[1]-a[1]),cols=Math.max(1,Math.floor(length/3.1)),rows=Math.max(1,Math.round(h/3.3));
          const at=(t,zz)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,zz];
          for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
            const lo=z+row*h/rows+.7,hi=Math.min(z+h-.35,lo+1.7),l=(col+.17)/cols,r=(col+.83)/cols;
            if(hi>lo)face.details.push({points:[at(l,lo),at(r,lo),at(r,hi),at(l,hi)],color:(col+row)%5===0?'#8da4a7':'#456572',glass:true});
          }
        }
      }
      m.face(roof,top,top===material?color:null);return m;
    };
    return m;
  }
  function facility(kind){
    const m=scene(),sizes={airport:[1000,360],port:[320,240],train_station:[180,80]},[width,depth]=sizes[kind];
    const f={id:'portrait-'+kind,kind,width,depth,height:32,point:[0,0],origin:[0,0],rotation:0};
    const plan=CitySpecialBuildings.layout(f);
    if(kind==='port')m.surface(0,0,410,335,'water');
    else m.surface(0,0,width*1.14,depth*1.5,'grass');
    for(const s of plan.surfaces)m.surface(s.x,s.y,s.w,s.d,s.material,s.color,s.z||0);
    for(const b of plan.boxes)m.box(b.x,b.y,b.z,b.w,b.d,b.h,b.material,b.color,b.top,b.material==='glass');
    for(const h of plan.hulls){
      const base=h.points.map(([x,y])=>[x,y,h.z]),top=h.points.map(([x,y])=>[x,y,h.z+h.h]);
      m.face(top,'metal',h.color);for(let i=0;i<base.length;i++)m.face([base[i],base[(i+1)%base.length],top[(i+1)%base.length],top[i]],'metal',h.color);
    }
    for(const line of plan.lines)m.line(line.points.map(([x,y])=>[x,y,line.z||.04]),line.width,line.color,line.dash);
    if(kind==='airport')m.frame=[-230,-16,250,166,32];
    if(kind==='port')m.frame=[-155,-105,155,125,35];
    if(kind==='train_station'){
      m.frame=[-79,-20,79,65,16];
      // A stopped train makes the shared platform and station layout readable.
      for(let x=-61;x<65;x+=21){m.box(x,0,.6,19,3.3,3.1,'metal','#dce4de','metal');m.box(x,0,1.6,17.5,3.36,1.1,'glass','#45798a','glass');}
      for(const x of [-78,78])m.trees.push({point:[x,60,0],radius:6,variant:3});
    }
    return m;
  }
  function parcel(m,id,use,x,y,w,d,floors){
    const p={id,center:[x,y],building:{use,floors,height:floors*3.3,center:[x,y],status:'active',footprint:quad(x,y,w,d).map(p=>p.slice(0,2))}};
    p.building.footprint.push(p.building.footprint[0]);
    const massing=CityGeometry.buildingMassing(p);
    const wall=use==='office'?'#a9b9bc':use==='residential'?'#cec3aa':use==='industrial'?'#b6b9b2':'#c3c5b9';
    for(const v of massing.volumes){
      if(!v.rect)continue;
      const [x0,y0,x1,y1]=v.rect;
      const faceStart=m.faces.length,shadowStart=m.shadows.length,c=Math.cos(v.angle),s=Math.sin(v.angle);
      const world=([xx,yy,zz])=>[v.origin[0]+xx*c-yy*s,v.origin[1]+xx*s+yy*c,zz];
      m.box((x0+x1)/2,(y0+y1)/2,v.base,x1-x0,y1-y0,v.height-v.base,'facade',wall,'roof',true);
      for(const face of m.faces.slice(faceStart)){face.points=face.points.map(world);for(const detail of face.details)detail.points=detail.points.map(world);}
      for(const shadow of m.shadows.slice(shadowStart))shadow.points=shadow.points.map(world);
    }
    for(const roof of CityOrdinaryRoofs.layout(p))for(const mesh of roof.meshes)m.face(mesh.points,mesh.material,mesh.color);
    return p;
  }
  function neighborhood(kind){
    const m=scene();
    m.surface(0,0,600,600,'grass');m.surface(0,2,88,69,'paving');m.surface(0,42,600,10,'asphalt');
    m.line([[-65,42,.02],[65,42,.02]],.25,'#e5e0c8',[3,3]);
    if(kind==='residential'){
      parcel(m,'portrait-residential-0','residential',-22,-13,24,17,2);parcel(m,'portrait-residential-5','residential',21,9,23,17,2);
      m.surface(-23,13,22,22,'grass');m.surface(19,-16,28,16,'grass');m.line([[-20,33,.05],[-20,0,.05]],2.2,'#ddd5c2');
    }else if(kind==='office'){
      parcel(m,'portrait-office-a','office',-22,-5,26,25,11);parcel(m,'portrait-office-b','office',21,7,25,26,7);
    }else if(kind==='commercial'){
      parcel(m,'portrait-shops','commercial',-8,-2,57,37,3);
      for(let x=-29;x<=16;x+=9){m.box(x,18,0,7,.5,3,'glass','#4d7986','metal');m.box(x,20,3,8,5,.25,'metal','#ae795c','metal');}
    }else if(kind==='industrial'){
      parcel(m,'portrait-industrial-1','industrial',-4,2,64,42,3);
      for(const x of [-28,-15]){m.box(x,-21,0,3.6,3.6,24,'facade','#9e8e7c','metal');m.box(x,-21,22,3.8,3.8,2,'metal','#a6b4b4','metal');}
    }else if(kind==='warehouse'){
      parcel(m,'portrait-warehouse-0','warehouse',-1,-6,66,36,2);
      for(let x=-24;x<30;x+=12){m.box(x,12.1,0,7,.4,4.5,'metal','#788b8e','metal');m.box(x,24,1,6,14,4,'metal','#e0ddcb','metal');m.box(x,33,1,5.8,4,3,'metal','#5d8999','metal');}
    }else if(kind==='mixed'){
      parcel(m,'portrait-mixed-house','residential',-25,-5,20,22,4);parcel(m,'portrait-mixed-office','office',14,-12,23,23,8);parcel(m,'portrait-mixed-shops','commercial',17,19,27,17,2);
    }else{
      parcel(m,'portrait-maintenance','residential',0,0,38,30,5);
      if(kind==='renovate'){
        for(let z=3;z<19;z+=3)m.box(0,18,z,45,4,.3,'metal','#b69c70','metal');
        for(const x of [-22,-11,0,11,22])m.box(x,20,0,.35,.35,20,'metal','#718588','metal');
      }else{
        m.faces=[];m.shadows=[];
        m.surface(0,0,42,34,'paving','#b4b2a4');
        for(let z=0;z<14;z+=3.3){
          for(const y of [-13,13])m.box(0,y,z,35,.9,.55,'facade','#b7b6a7','facade');
          for(const x of [-17,0,17]){m.box(x,0,z,.9,27,.55,'facade','#b7b6a7','facade');for(const y of [-13,13])m.box(x,y,z,.9,.9,3.3,'facade','#b8b8ab','facade');}
        }
        m.box(33,-12,0,2.2,2.2,39,'metal','#bd9a43','metal');m.box(12,-12,36,69,1.4,1.8,'metal','#d3ac4e','metal');
        m.line([[-21,-12,36],[-21,-12,17]],.3,'#525e60');
      }
    }
    for(const [x,y,r] of [[-42,-26,5],[40,-23,5],[-40,29,4],[40,30,4]])m.trees.push({point:[x,y,0],radius:r,variant:3});
    return m;
  }
  function metro(){
    // Metro stops are points in the city model: depict their street entrance.
    const m=scene();m.frame=[-11,-7,15,7,7];m.surface(0,0,100,100,'paving');m.surface(0,14,100,7,'asphalt');m.line([[-50,14,.03],[50,14,.03]],.12,'#eee8cc',[2,2]);
    m.surface(-1,0,15,7,'asphalt','#3e535b',.08);
    for(let i=0;i<12;i++)m.surface(-7+i*.95,0,.95,6.3,'paving',tint('#bfc6bd',.53+i*.035),.12);
    for(const y of [-3.7,3.7]){m.box(-1,y,0,17,.5,.65,'facade','#afbab8','metal');m.line([[-9,y,1.3],[7,y,1.3]],.11,'#b6c6c5');for(const x of [-8,0,7])m.box(x,y,0,.15,.15,3.3,'metal','#647f84','metal');}
    m.box(-4,0,3.3,12,9,.15,'glass','#89b8bf','glass');
    for(let x=-10;x<3;x+=3)m.line([[x,-4.5,3.48],[x,4.5,3.48]],.12,'#c9dcdb');
    m.box(12,-2,0,.2,.2,6,'metal','#657b80','metal');m.box(12,-2,4.5,3,.35,2,'metal','#367e9b','metal');
    // The station marker is model geometry, so it remains legible in projection.
    m.line([[11,-1.8,4.8],[11,-1.8,6],[12,-1.8,5.3],[13,-1.8,6],[13,-1.8,4.8]],.17,'#f4faf4');
    m.lines.at(-1).overlay=true;
    m.trees.push({point:[-13,-8,0],radius:3.5,variant:3});return m;
  }
  function render(kind){
    let m=models.get(kind);if(!m){m=kind==='metro_station'?metro():['airport','port','train_station'].includes(kind)?facility(kind):neighborhood(kind);models.set(kind,m);}
    const canvas=document.createElement('canvas');canvas.width=600;canvas.height=360;const ctx=CityScene.useThumbnailMaterials(canvas.getContext('2d'));
    let frame;
    if(m.frame){const [x0,y0,x1,y1,z]=m.frame;frame=quad((x0+x1)/2,(y0+y1)/2,x1-x0,y1-y0).concat([[x0,y0,z],[x1,y0,z]]).map(project);}
    else frame=m.faces.flatMap(face=>face.points).map(project);
    const xs=frame.map(p=>p[0]),ys=frame.map(p=>p[1]),left=Math.min(...xs),top=Math.min(...ys),w=Math.max(...xs)-left,h=Math.max(...ys)-top,scale=Math.min(570/w,330/h);
    const sky=ctx.createLinearGradient(0,0,0,360);sky.addColorStop(0,'#e4ece8');sky.addColorStop(1,'#f5f1e7');ctx.fillStyle=sky;ctx.fillRect(0,0,600,360);
    ctx.translate((600-w*scale)/2-left*scale,(360-h*scale)/2-top*scale);ctx.scale(scale,scale);
    const trace=points=>{ctx.beginPath();points.map(project).forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();};
    function fill(face,shade=1){
      trace(face.points);ctx.fillStyle=tint(face.color,shade);ctx.fill();
      if(['grass','paving','asphalt','roof','roofTiles','metal','soil'].includes(face.material)){
        ctx.save();ctx.clip();ctx.globalAlpha=face.material==='grass'?.4:.22;ctx.fillStyle=CityScene.material(ctx,face.material,0);ctx.fillRect(left-100,top-100,w+200,h+200);ctx.restore();
      }
    }
    for(const face of m.ground)fill(face);
    for(const shadow of m.shadows){trace(shadow.points.map(([x,y])=>[x+shadow.height*.42,y+shadow.height*.32,.02]));ctx.fillStyle='#33484c1c';ctx.fill();}
    const items=m.faces.map(face=>({face,depth:face.points.reduce((s,p)=>s+depth(p),0)/face.points.length}));
    for(const tree of m.trees)items.push({tree,depth:depth(tree.point)+tree.radius});
    for(const line of m.lines)items.push({line,depth:line.overlay?Infinity:line.points.every(p=>p[2]<.1)?-Infinity:line.points.reduce((s,p)=>s+depth(p),0)/line.points.length+.01});
    for(const item of items.sort((a,b)=>a.depth-b.depth)){
      if(item.tree){const t=item.tree,[x,y]=project(t.point),r=t.radius;ctx.save();ctx.fillStyle='#304c4226';ctx.beginPath();ctx.ellipse(x+r*.4,y+r*.25,r,r*.45,0,0,Math.PI*2);ctx.fill();ctx.drawImage(CityScene.treeSprite(t.variant),x-r,y-r*2,r*2,r*2.3);ctx.restore();continue;}
      if(item.line){const l=item.line;ctx.beginPath();l.points.map(project).forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.lineWidth=l.width;ctx.setLineDash(l.dash);ctx.strokeStyle=l.color;ctx.stroke();ctx.setLineDash([]);continue;}
      const face=item.face,n=normal(face.points),visible=n[0]*sa*lift+n[1]*ca*lift+n[2]*pitch;if(visible<=.0001)continue;
      const light=Math.max(0,-n[0]*.4-n[1]*.35+n[2]*.85),shade=.73+light*.3;fill(face,shade);
      for(const detail of face.details){trace(detail.points);ctx.fillStyle=detail.color;ctx.fill();const ps=detail.points.map(project);ctx.beginPath();ctx.moveTo(...ps[3]);ctx.lineTo(...ps[2]);ctx.strokeStyle='#d4e3df';ctx.lineWidth=.09;ctx.stroke();}
    }
    return canvas;
  }
  let timer=null,attempts=0;
  function paint(canvas,kind){
    const ready=CityScene.assetsReady&&CityOrdinaryRoofs.ready,key=kind+':'+ready;
    if(canvas.dataset.preview!==key){if(!pictures.has(key))pictures.set(key,render(kind));canvas.width=600;canvas.height=360;canvas.getContext('2d').drawImage(pictures.get(key),0,0);canvas.dataset.preview=key;}
    if(!ready){pending.add(canvas);if(!timer&&attempts<80)timer=setTimeout(()=>{timer=null;attempts++;for(const c of [...pending]){pending.delete(c);if(c.isConnected)paint(c,c.dataset.buildingPreview);}},150);}
  }
  function attach(canvas,kind){canvas.dataset.buildingPreview=kind;paint(canvas,kind);}
  window.CityBuildingPreviews={attach,paint};
})();
