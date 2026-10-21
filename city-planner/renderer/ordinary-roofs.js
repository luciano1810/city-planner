/* Seeded roof structures shared by the ordinary-building Canvas and WebGL paths. */
(function(root){
  'use strict';
  const G=typeof module!=='undefined'&&module.exports?require('./city-geometry.js'):root.CityGeometry,cache=new WeakMap();
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
      const shape=entry.shape=choices[seed%choices.length],rise=Math.min(v.type==='hall'?5:3.8,d*.24),mid=(y0+y1)/2;
      const skin=shape==='flat'?(seed%3===0?'gravel':'roof'):v.type==='house'?'roofTiles':'metal';
      const colors=skin==='roofTiles'?['#b27a56','#a4937b','#75878a','#af9476']:skin==='metal'?['#9caeac','#91a5b0','#b1b5a5','#879c9e']:['#b8b6a4','#a5b0a9','#c4bfae','#899c9b'];
      const roofColor=colors[(seed>>>4)%4],uvScale=5+random()*6,phase=[random()*20,random()*20],turn=(seed>>>8)%4*Math.PI/2;
      function tri(points,material,color,roof=false){const ps=points.map(world);meshes.push({points:ps,material,color,variant:(seed>>>12)%4,roof,uv:points.map(([x,y])=>[(x*Math.cos(turn)-y*Math.sin(turn))/uvScale+phase[0],(x*Math.sin(turn)+y*Math.cos(turn))/uvScale+phase[1]])});}
      function quad(ps,material,color,roof=false){tri([ps[0],ps[1],ps[2]],material,color,roof);tri([ps[0],ps[2],ps[3]],material,color,roof);}
      function box(x,y,z,ww,dd,hh,color,material='metal'){
        const p=[[x-ww/2,y-dd/2],[x+ww/2,y-dd/2],[x+ww/2,y+dd/2],[x-ww/2,y+dd/2]];
        quad(p.map(q=>[...q,z+hh]),material,color);
        for(let i=0;i<4;i++){const a=p[i],b=p[(i+1)%4];quad([[...a,z],[...b,z],[...b,z+hh],[...a,z+hh]],material,color);}
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
      if(shape==='sawtooth'){
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
        if(r[0]<x0+.8||r[1]<y0+.8||r[2]>x1-.8||r[3]>y1-.8)return false;
        if(units.some(u=>r[0]<u.x+u.w/2+.65&&r[2]>u.x-u.w/2-.65&&r[1]<u.y+u.d/2+.65&&r[3]>u.y-u.d/2-.65))return false;
        return !masses.some(q=>q!==v&&q.rect&&q.height>h+.1&&q.base<=h+.1&&r[0]<q.rect[2]+.5&&r[2]>q.rect[0]-.5&&r[1]<q.rect[3]+.5&&r[3]>q.rect[1]-.5);
      }
      // Crown treatments are reserved for tall office roofs, with finite setbacks.
      if(shape==='flat'&&v.type==='tower'&&h>35&&seed%3!==0&&w>9&&d>9){
        const x=(x0+x1)/2,y=(y0+y1)/2,ww=Math.min(5,w*.3),dd=Math.min(5,d*.3);
        if(fits(x,y,ww,dd)){units.push({type:'crown',x,y,w:ww,d:dd});box(x,y,h+.12,ww,dd,2.4,'#8aa6aa','glass');box(x,y,h+2.52,ww*.7,dd*.7,1.1,'#abbdb8');box(x,y,h+3.62,.16,.16,3.4,'#bec9c6');}
      }
      const programs=b.use==='residential'?['garden','solar','pergola','access','solar','terrace']:b.use==='commercial'?['chiller','skylight','garden','access','solar','duct']:b.use==='office'?['access','chiller','solar','garden','skylight','duct']:['duct','chiller','solar','skylight','access'];
      const candidates=[];const step=shape==='flat'?5.6:7;
      for(let y=y0+3;y<y1-2;y+=step)for(let x=x0+3;x<x1-2;x+=step)candidates.push([x,y]);
      for(let i=candidates.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
      const max=Math.min(10,Math.max(1,Math.floor(w*d/(shape==='flat'?75:130))));
      for(const [x,y] of candidates){
        if(units.length>=max||shape==='sawtooth')break;
        const ww=Math.min(4.1,w*.26),dd=Math.min(3.6,d*.25);
        if(!fits(x,y,ww,dd))continue;
        const type=shape==='flat'?programs[Math.floor(random()*programs.length)]:(units.length===0&&v.type==='house'&&seed%2===0?'chimney':seed%3===0?'solar':'skylight');
        units.push({type,x,y,w:ww,d:dd});const z=roofZ(x,y)+.08;
        if(type==='solar'||type==='skylight'){
          const rows=type==='solar'?2:1;
          for(let row=0;row<rows;row++){
            const ya=y-dd/2+dd*row/rows,yb=ya+dd/rows*.83,xa=x-ww/2,xb=x+ww/2;
            const zz=(xx,yy)=>roofZ(xx,yy)+.16+(type==='solar'?(yy-ya)*.2:.25);
            quad([[xa,ya,zz(xa,ya)],[xb,ya,zz(xb,ya)],[xb,yb,zz(xb,yb)],[xa,yb,zz(xa,yb)]],'glass',type==='solar'?'#315d80':'#8cc2cb');
            for(let n=0;n<=4;n++){const xx=xa+ww*n/4;quad([[xx-.035,ya,zz(xx,ya)+.03],[xx+.035,ya,zz(xx,ya)+.03],[xx+.035,yb,zz(xx,yb)+.03],[xx-.035,yb,zz(xx,yb)+.03]],'metal','#c6d4d1');}
          }
        }else if(type==='chimney'){
          box(x,y,z,1,1,1.5,'#b49880','facade');box(x,y,z+1.5,1.25,1.25,.15,'#586b70');
        }else if(type==='access'){
          box(x,y,z,ww*.86,dd*.82,1.9,'#c4c4b4','facade');box(x,y,z+1.9,ww*.94,dd*.9,.16,'#6b8286');box(x,y-dd*.42,z+.1,.8,.08,1.65,'#526d73');
        }else if(type==='chiller'){
          box(x,y,z,ww,dd*.7,1,'#b8c6c5');for(const dx of [-ww*.25,ww*.25]){disc(x+dx,y,z+1.03,Math.min(.65,ww*.2),'#344e59');box(x+dx,y,z+1.05,.08,1,.025,'#a3b8bc');}
          for(let n=0;n<5;n++)box(x-ww*.51,y-dd*.28+n*dd*.12,z+.15,.06,.12,.65,'#506b76');
        }else if(type==='duct'){
          box(x,y,z,ww,.8,.65,'#a5b2ad');box(x-ww*.32,y,z,.8,dd,.65,'#a5b2ad');box(x+ww*.3,y,z+.65,.6,.6,1.1,'#798e90');
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
    const e=layout(parcel).find(e=>e.volume===volume);if(!e)return;
    const meshes=e.meshes.slice().sort((a,b)=>(Number(b.roof)-Number(a.roof))||a.points.reduce((s,p)=>s+p[1]+p[2]*.3,0)-b.points.reduce((s,p)=>s+p[1]+p[2]*.3,0));
    for(const m of meshes){ctx.beginPath();m.points.forEach((p,i)=>{const q=[p[0],p[1]-Math.min(85,p[2]*.26)];i?ctx.lineTo(...q):ctx.moveTo(...q);});ctx.closePath();ctx.fillStyle=m.color;ctx.fill();
      if(m.roof){const [a,b,c]=m.points,u=b.map((n,i)=>n-a[i]),v=c.map((n,i)=>n-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...n)||1,angle=scene.lightingAt(scene.time).azimuth*Math.PI/180;ctx.save();ctx.globalAlpha=Math.min(.30,Math.max(0,(n[0]*Math.cos(angle)+n[1]*Math.sin(angle))/len)*.38);ctx.fillStyle='#22383e';ctx.fill();ctx.restore();}
      if(m.roof){ctx.save();ctx.clip();ctx.globalAlpha=.20;ctx.fillStyle=scene.material(ctx,m.material,m.variant);const xs=m.points.map(p=>p[0]),ys=m.points.map(p=>p[1]-Math.min(85,p[2]*.26));ctx.fillRect(Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys));ctx.restore();}
    }
  }
  const api={layout,draw3D,drawCanvas};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CityOrdinaryRoofs=api;
})(typeof window==='undefined'?{}:window);
