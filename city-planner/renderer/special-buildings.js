/* One metric layout for Canvas, WebGL and the placement preview. */
(function(root){
  'use strict';
  const civic=typeof module!=='undefined'&&module.exports?require('./civic-buildings.js'):root.CityCivicBuildings;
  const names={...civic.names,airport:'机场',port:'港口',train_station:'火车站',parking_lot:'露天停车场',parking_garage:'停车楼'};
  const adaptive=typeof module!=='undefined'&&module.exports?require('./block-architecture.js'):root.CityBlockArchitecture;
  const cache=new WeakMap();
  function hash(id){let n=2166136261;for(const c of String(id)){n^=c.charCodeAt(0);n=Math.imul(n,16777619);}return n>>>0;}
  function world(f,x,y,z=0,tilt=0){const a=f.rotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a),p=f.origin||f.point;return [p[0]+x*c-y*s,p[1]+x*s+y*c-z*tilt];}
  function layout(f){
    if(cache.has(f))return cache.get(f);
    const out={surfaces:[],boxes:[],hulls:[],lines:[],labels:[],lights:[],vehicles:[],meshes:[],trees:[],windows:[]},w=f.width,d=f.depth,s=f.kind==='airport'?w/1000:f.kind==='port'?w/320:f.kind==='train_station'?w/180:1;
    const surface=(x,y,width,depth,material='paving',color=null,z=0)=>out.surfaces.push({x,y,w:width,d:depth,material,color,z});
    const box=(x,y,z,width,depth,h,material='facade',top='roof',color=null)=>out.boxes.push({x,y,z,w:width,d:depth,h,material,top,color});
    const line=(pts,width=.3,color='#f2efd9',dash=[])=>out.lines.push({points:pts,width,color,dash});
    const label=(text,x,y,size=5,color='#f3f0db',angle=0)=>out.labels.push({text,x,y,size,color,angle});
    const lamp=(x,y)=>out.lights.push([x,y]);
    const hull=(x,y,z,h,pts,color)=>out.hulls.push({points:pts.map(([a,b])=>[x+a*s,y+b*s]),z:z*s,h:h*s,color});
    const car=(x,y,i)=>{box(x,y,.25,1.8,4.2,1.3,'carPaint','carPaint',['#d2d7d3','#607f93','#944d40','#c3b393','#394a54'][i%5]);box(x,y-.25,1.55,1.45,2,.12,'glass','glass');out.boxes.at(-1).vehicle=true;out.boxes.at(-2).vehicle=true;out.vehicles.push({x,y,id:i,z:f.kind==='parking_garage'?f.height:0});};
    const bays=(x0,x1,y,side=1)=>{
      for(let x=x0;x<x1-2.7;x+=2.7){line([[x,y],[x,y+side*5]],.12);line([[x,y+side*5],[x+2.7,y+side*5]],.12);if(hash(f.id+':'+x+':'+y)%5<3)car(x+1.35,y+side*2.55,hash(x+':'+y));}
    };
    if(f.kind==='airport'){
      surface(0,0,w,d,'grass');surface(0,-d*.18,w*.91,36*s,'asphalt');surface(0,d*.04,w*.85,15*s,'asphalt');
      surface(0,d*.26,w*.5,d*.26,'paving');
      line([[-w*.42,d*.04],[w*.42,d*.04]],.35*s,'#e8bf55');
      for(const x of [-w*.39,w*.39]){surface(x,-d*.065,14*s,d*.23,'asphalt');line([[x,-d*.18],[x,d*.04]],.35*s,'#e8bf55');}
      line([[-w*.43,-d*.18],[w*.43,-d*.18]],.85*s,'#f2f1e3',[18*s,17*s]);
      for(const y of [-d*.18-16*s,-d*.18+16*s])line([[-w*.45,y],[w*.45,y]],.7*s);
      for(const sign of [-1,1]){
        for(let i=-4;i<=4;i++)if(i)surface(sign*w*.425,-d*.18+i*2.5*s,15*s,1.3*s,'marking','#f4f0e1');
        label(sign<0?'09':'27',sign*w*.39,-d*.18,11*s,'#faf7e8',sign<0?Math.PI/2:-Math.PI/2);
        for(let x=-w*.44;x<w*.45;x+=22*s)lamp(x,-d*.18+sign*19*s);
      }
      box(0,d*.39,0,w*.3,34*s,17*s,'glass','metal','#7d9297');
      for(let x=-w*.14;x<w*.15;x+=16*s)box(x,d*.438,0,1.1*s,1.1*s,17*s,'facade','facade','#d0d5cd');
      box(0,d*.34,17*s,w*.27,14*s,1.2*s,'metal','metal');
      box(-w*.19,d*.38,0,12*s,12*s,24*s,'facade','roof');box(-w*.19,d*.38,24*s,20*s,17*s,8*s,'glass','metal');
      box(w*.33,d*.3,0,110*s,54*s,16*s,'metal','metal');
      for(let i=-2;i<=2;i++){
        const x=i*68*s;box(x,d*.28,4*s,5*s,35*s,3*s,'metal','roof');
        line([[x,d*.24],[x,d*.13]],.4*s,'#e8bf55');
        // Parked aircraft have a fuselage, swept wing, tailplane and engines.
        hull(x,d*.14,1.4,3.2,[[0,-19],[1.6,-15],[1.9,9],[.8,17],[-.8,17],[-1.9,9],[-1.6,-15]],'#e4e7de');
        hull(x,d*.14,2.7,.6,[[-1,-5],[-18,8],[-18,10],[-1,3]],'#d2d9d7');
        hull(x,d*.14,2.7,.6,[[1,-5],[18,8],[18,10],[1,3]],'#d2d9d7');
        hull(x,d*.14,3.2,.5,[[-1,9],[-7,16],[-7,18],[-.5,14]],'#bccad0');
        hull(x,d*.14,3.2,.5,[[1,9],[7,16],[7,18],[.5,14]],'#bccad0');
        box(x,d*.182,4*s,1.1*s,5*s,5*s,'carPaint','carPaint','#3a7d9a');
        for(const dx of [-7,7])box(x+dx*s,d*.16,1.3*s,2.5*s,5.5*s,2*s,'metal','metal');
      }
      surface(0,d*.485,w*.4,5*s,'asphalt');label('航站楼',0,d*.43,7*s,'#273f45');
    }else if(f.kind==='port'){
      surface(0,-d*.25,w,d*.5,'paving');surface(0,-8*s,w,16*s,'asphalt');
      for(let x=-w*.48;x<w*.48;x+=12*s)line([[x,-2*s],[x+5*s,-2*s]],1.2*s,'#e1b748');
      box(-w*.32,-d*.3,0,76*s,60*s,13*s,'metal','metal');
      for(let col=0;col<8;col++)for(let row=0;row<4;row++){
        const x=-w*.02+col*17*s,y=-d*.43+row*19*s,h=(hash(f.id+':'+col+':'+row)%3+1)*2.6*s;
        box(x,y,0,12*s,5*s,h,'metal','metal',['#4d8287','#a35c43','#c99b4c','#637a8b','#aab1a3'][(row+col)%5]);
      }
      for(const x of [-w*.32,w*.31]){
        surface(x,d*.17,23*s,d*.34,'paving',null,.7*s);
        for(const dx of [-9,9])for(const y of [10,34])box(x+dx*s,y*s,0,1.6*s,1.6*s,28*s,'metal','metal','#d6ad55');
        box(x,22*s,26*s,22*s,4*s,3*s,'metal','metal','#d6ad55');
        box(x,37*s,29*s,3*s,66*s,3*s,'metal','metal','#d6ad55');
        box(x,64*s,8*s,.24*s,.24*s,21*s,'metal','metal','#4e5553');
        box(x,64*s,7*s,10*s,3*s,1*s,'metal','metal','#d6ad55');
      }
      // Berthing ship stays entirely on the water side of the quay.
      hull(0,d*.29,.4,5,[[0,-48],[18,-34],[22,-20],[22,40],[-22,40],[-22,-20],[-18,-34]],'#3c505e');
      box(0,d*.41,5.4*s,32*s,13*s,10*s,'facade','roof','#e4e3d5');
      for(let i=-1;i<=1;i++)for(let j=0;j<3;j++)box(i*12*s,d*.18+j*15*s,5.4*s,10*s,12*s,5*s,'metal','metal',['#a85c45','#b5a258','#50818c'][j]);
      for(const x of [-w*.45,0,w*.45])lamp(x,-d*.4);
      label('集装箱码头',0,-d*.07,6*s,'#e8debd');
    }else if(f.kind==='train_station'){
      surface(0,d*.275,w,d,'paving');
      for(let x=-w/2;x<w/2;x+=1.25*s)box(x,0,.05,.25*s,2.7*s,.16,'metal','metal','#766e5b');
      for(const y of [-.72,.72])box(0,y*s,.21,w,.13*s,.18,'metal','metal','#9ca9aa');
      for(const y of [-12*s,12*s]){
        surface(0,y,w*.96,7*s,'paving');line([[-w*.47,y+(y>0?-2.7:2.7)*s],[w*.47,y+(y>0?-2.7:2.7)*s]],.35*s,'#e5ba4a');
        for(let x=-w*.4;x<w*.45;x+=22*s)box(x,y,0,.5*s,.5*s,5.2*s,'metal','metal');
        box(0,y,5.2*s,w*.9,9*s,.65*s,'metal','metal');
      }
      box(0,35*s,0,w*.68,31*s,13*s,'glass','metal');box(0,35*s,13*s,w*.72,34*s,2*s,'metal','metal');
      for(let x=-w*.3;x<w*.35;x+=14*s)box(x,51*s,0,1*s,1*s,13*s,'facade','facade');
      surface(0,57*s,w*.82,9*s,'paving');label('火车站',0,57*s,6*s,'#344d52');
      lamp(-w*.43,57*s);lamp(w*.43,57*s);
    }else if(f.kind==='parking_lot'||f.kind==='parking_garage'){
      surface(0,0,w,d,'asphalt');
      const garage=f.kind==='parking_garage',h=garage?f.height:0;
      if(garage){
        box(0,0,0,w,d,h,'facade','asphalt','#bcbdb3');
        for(let floor=0;floor<f.floors;floor++){
          for(const y of [-d/2-.02,d/2+.02])box(0,y,floor*3.2+.8,w-.8,.1,1.65,'glass','glass');
          for(const x of [-w/2-.02,w/2+.02])box(x,0,floor*3.2+.8,.1,d-.8,1.65,'glass','glass');
          box(0,0,floor*3.2,w+.35,d+.35,.32,'paving','paving');
        }
        for(let x=-w/2+2;x<w/2;x+=6)for(const y of [-d/2-.12,d/2+.12])box(x,y,0,.7,.5,h,'facade','facade','#d5d3c6');
        box(w*.32,0,h,Math.min(5,w*.2),Math.min(9,d*.5),2.8,'facade','roof');
      }
      const before=out.boxes.length;
      if(d>=20){bays(-w/2+2,w/2-2,-d/2+1,1);bays(-w/2+2,w/2-2,d/2-1,-1);}
      else bays(-w/2+2,w/2-2,-d/2+1,1);
      if(garage){for(const b of out.boxes.slice(before))b.z+=h+.05;for(const l of out.lines)l.z=h+.08;}
      label('P',-w*.33,0,Math.min(6,d*.33),'#c7dce0');out.labels.at(-1).z=h+.1;
      line([[-w*.15,0],[w*.3,0]],.2,'#e5ce7e',[2,2]);out.lines.at(-1).z=h+.08;
      box(0,d/2,0,1,.6,2.1,'metal','metal','#437b8a');
      lamp(-w/2+1,-d/2+1);lamp(w/2-1,d/2-1);
    }
    if(civic.names[f.kind]){if(f.architecture?.version===1)adaptive.populate(f,out);else civic.populate(f,out,{surface,box,line,label,lamp,hull});}
    cache.set(f,out);return out;
  }
  function path(ctx,points){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();}
  function mat(ctx,name,id){return root.CityScene?.material(ctx,name,hash(id))||({grass:'#758966',asphalt:'#666d6c',paving:'#b9b6a9',metal:'#a9b5b5',glass:'#527b8c',roof:'#b3b8af',marking:'#f5f3df',carPaint:'#b2b9b6'}[name]||'#b9bdb5');}
  function corners(f,b,z=0,tilt=0){return [[b.x-b.w/2,b.y-b.d/2],[b.x+b.w/2,b.y-b.d/2],[b.x+b.w/2,b.y+b.d/2],[b.x-b.w/2,b.y+b.d/2]].map(([x,y])=>world(f,x,y,z,tilt));}
  function ground(ctx,f,scale){
    if(!names[f.kind])return false;
    const plan=layout(f);ctx.save();
    if(f.accessPath?.length){ctx.beginPath();f.accessPath.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.strokeStyle=mat(ctx,'asphalt',f.id);ctx.lineWidth=f.kind==='airport'?8:5;ctx.stroke();}
    for(const m of plan.meshes.filter(m=>m.ground)){path(ctx,m.points.map(([x,y])=>world(f,x,y)));ctx.fillStyle=m.color||mat(ctx,m.material,f.id);ctx.fill();}
    for(const b of plan.surfaces){path(ctx,corners(f,b));ctx.fillStyle=b.color||mat(ctx,b.material,f.id);ctx.fill();}
    details(ctx,f,scale,false,0);ctx.restore();return true;
  }
  function details(ctx,f,scale,roof=false,tilt=.42){
    const plan=layout(f);
    for(const l of plan.lines){if(Boolean(l.z>1)!==roof)continue;ctx.beginPath();l.points.forEach(([x,y],i)=>{const p=world(f,x,y,l.z||0,tilt);i?ctx.lineTo(...p):ctx.moveTo(...p);});ctx.strokeStyle=l.color;ctx.lineWidth=Math.max(l.width,.3/scale);ctx.setLineDash(l.dash);ctx.stroke();ctx.setLineDash([]);}
    if(scale>.14)for(const t of plan.labels){if(Boolean(t.z>1)!==roof)continue;const p=world(f,t.x,t.y,t.z||0,tilt);ctx.save();ctx.translate(...p);ctx.rotate(f.rotation*Math.PI/180+(t.angle||0));ctx.font=`600 ${t.size}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=t.color;ctx.fillText(t.text,0,0);ctx.restore();}
  }
  function paint2D(ctx,f,scale){
    if(!names[f.kind])return;
    ctx.save();const tilt=.42,plan=layout(f),faces=[];
    const face=(pts,material,color,shade=0)=>faces.push({pts,material,color,shade,depth:pts.reduce((v,p)=>v+p[1]*tilt+p[2],0)/pts.length});
    const vertex=(x,y,z)=>{const p=world(f,x,y);return [p[0],p[1],z];};
    for(const b of plan.boxes){
      if(b.detail&&scale<.8&&Math.min(b.w,b.d)<.3)continue;
      const base=corners(f,b).map(p=>[...p,b.z]),top=base.map(p=>[p[0],p[1],b.z+b.h]);
      for(let i=0;i<4;i++)face([base[i],base[(i+1)%4],top[(i+1)%4],top[i]],b.material,b.color,i===1?.22:.10);
      face(top,b.top,b.roofColor||(b.roofTextured?null:b.color));
    }
    for(const h of plan.hulls){
      const base=h.points.map(([x,y])=>vertex(x,y,h.z)),top=h.points.map(([x,y])=>vertex(x,y,h.z+h.h));
      face(top,'metal',h.color);
      for(let i=0;i<base.length;i++)face([base[i],base[(i+1)%base.length],top[(i+1)%base.length],top[i]],'metal',h.color,.17);
    }
    for(const m of plan.meshes){
      if(m.ground)continue;
      const ps=m.points.map(p=>vertex(...p)),u=ps[1].map((v,i)=>v-ps[0][i]),v=ps[2].map((q,i)=>q-ps[0][i]);
      const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...n)||1;
      face(ps,m.material,m.color,Math.max(0,.18-(n[2]-n[0]*.4+n[1]*.3)/len*.18));
    }
    for(const fce of faces.sort((a,b)=>a.depth-b.depth)){
      path(ctx,fce.pts.map(p=>[p[0],p[1]-p[2]*tilt]));ctx.fillStyle=fce.color||mat(ctx,fce.material,f.id);ctx.fill();
      if(fce.shade){ctx.globalAlpha=fce.shade;ctx.fillStyle='#172e3a';ctx.fill();ctx.globalAlpha=1;}
    }
    for(const t of plan.trees){const p=world(f,t.x,t.y,t.height,tilt),sprite=root.CityScene?.treeSprite(t.variant,false);if(sprite)ctx.drawImage(sprite,p[0]-t.radius,p[1]-t.radius,t.radius*2,t.radius*2);}
    for(const v of plan.vehicles){const b={x:v.x,y:v.y,w:1.8,d:4.2};path(ctx,corners(f,b,v.z+1.3,tilt));ctx.fillStyle=['#d8dfda','#627e8b','#9e6256'][v.id%3];ctx.fill();}
    details(ctx,f,scale,true,tilt);ctx.restore();
  }
  function build3D(batch,f,api){
    if(!names[f.kind])return;
    const a=f.rotation*Math.PI/180;
    for(const v of layout(f).vehicles||[])if(api.car)api.car(batch,{point:world(f,v.x,v.y),heading:a-Math.PI/2,id:v.id,z:v.z});
    for(const b of layout(f).boxes){
      if(b.vehicle&&api.car)continue;
      const p=world(f,b.x,b.y),side=b.tint&&api.tinted?api.tinted(b.material,b.color,b.variant||0):b.color?api.solid(b.color):api.material(b.material,hash(f.id)),top=b.roofColor&&api.tinted?api.tinted(b.top,b.roofColor,b.variant||0):b.roofTextured?api.material(b.top,(hash(f.id)+(b.variant||0))%4):b.color?api.solid(b.color):api.material(b.top,hash(f.id));
      batch.box(...p,b.z,b.w,b.d,b.h,a,side,top);
    }
    for(const m of layout(f).meshes){
      const ps=m.points.map(([x,y,z])=>{const p=world(f,x,y);return [p[0],-p[1],z];}),material=m.tint&&api.tinted?api.tinted(m.material,m.color,m.variant||0):m.color?api.solid(m.color):api.material(m.material,hash(f.id));
      // Roof and structural panels are two-sided, with paired outward normals.
      const uv=m.uv||m.points.map(p=>[p[0]/4,p[1]/4]);batch.triangle(material,ps,uv);batch.triangle(material,ps.slice().reverse(),uv.slice().reverse());
    }
    for(const t of layout(f).trees)if(api.tree)api.tree(batch,{...t,point:world(f,t.x,t.y)});
    for(const h of layout(f).hulls){
      const mat=api.solid(h.color),ps=h.points.map(([x,y])=>{const p=world(f,x,y);return [p[0],-p[1]];}),z=h.z+h.h;
      if(ps.reduce((sum,p,i)=>{const q=ps[(i+1)%ps.length];return sum+p[0]*q[1]-q[0]*p[1];},0)>0)ps.reverse();
      // All hulls are convex, allowing a stable triangle fan and true sidewalls.
      for(let i=1;i<ps.length-1;i++){
        const pts=[ps[0],ps[i],ps[i+1]].map(p=>[...p,z]);
        const cross=(pts[1][0]-pts[0][0])*(pts[2][1]-pts[0][1])-(pts[1][1]-pts[0][1])*(pts[2][0]-pts[0][0]);
        if(cross<0)pts.reverse();batch.triangle(mat,pts,[[0,0],[1,0],[1,1]]);
      }
      for(let i=0;i<ps.length;i++){const p=ps[i],q=ps[(i+1)%ps.length];batch.quad(mat,[[...p,h.z],[...q,h.z],[...q,z],[...p,z]],Math.hypot(q[0]-p[0],q[1]-p[1]),h.h,[p[1]-q[1],q[0]-p[0],0]);}
    }
    for(const b of layout(f).surfaces.filter(b=>b.z>0)){const p=world(f,b.x,b.y);batch.box(...p,0,b.w,b.d,b.z,a,api.material(b.material,hash(f.id)));}
    for(const [x,y] of layout(f).lights){const p=world(f,x,y);batch.box(...p,0,.15,.15,f.kind==='airport'?.5:6,a,api.solid('#8f9b97'));}
  }
  function night(ctx,f,scale,seconds){
    const light=root.CityScene?.lightingAt(seconds);if(!light||light.night<.05||!names[f.kind])return;
    ctx.save();ctx.globalCompositeOperation='screen';
    const tilt=root.CityScene?.settings.quality==='balanced'?.42:(root.CityScene3D?.tilt||.42),angle=f.rotation*Math.PI/180;
    for(const win of layout(f).windows){
      if(win.normal[0]*Math.sin(angle)+win.normal[1]*Math.cos(angle)<.1)continue;
      const ps=win.points||(win.side%2?[[win.x,win.y-win.w/2,win.z],[win.x,win.y+win.w/2,win.z],[win.x,win.y+win.w/2,win.z+win.h],[win.x,win.y-win.w/2,win.z+win.h]]:[[win.x-win.w/2,win.y,win.z],[win.x+win.w/2,win.y,win.z],[win.x+win.w/2,win.y,win.z+win.h],[win.x-win.w/2,win.y,win.z+win.h]]);
      path(ctx,ps.map(([x,y,z])=>world(f,x,y,z,tilt)));ctx.fillStyle=win.warm?`rgba(255,220,157,${light.night*.72})`:`rgba(175,212,227,${light.night*.6})`;ctx.fill();
    }
    for(const [x,y] of layout(f).lights){const p=world(f,x,y);const r=f.kind==='airport'?2:10,g=ctx.createRadialGradient(...p,0,...p,r);g.addColorStop(0,`rgba(255,226,161,${light.night*.75})`);g.addColorStop(1,'rgba(255,220,150,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(...p,r,0,Math.PI*2);ctx.fill();}
    ctx.restore();
  }
  function preview(ctx,f,scale,valid=true){ctx.save();path(ctx,f.points);ctx.fillStyle=valid?'#49a2a52a':'#ce655334';ctx.fill();ctx.strokeStyle=valid?'#398e91':'#c45743';ctx.lineWidth=2/scale;ctx.setLineDash([7/scale,4/scale]);ctx.stroke();ctx.setLineDash([]);if(f.kind==='port'){const a=world(f,0,0),b=world(f,0,f.depth*.45);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();ctx.font=`${12/scale}px sans-serif`;ctx.fillStyle='#2f637b';ctx.fillText('海侧',b[0]+4/scale,b[1]);}ctx.restore();}
  const api={names,layout,world,ground,paint2D,build3D,details,night,preview};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CitySpecialBuildings=api;
})(typeof window==='undefined'?{}:window);
