/* Stable, display-only architecture. No saved footprints, floor counts or
 * capacities are changed. Near detail is baked into the scene's building LRU. */
(function(root){
  'use strict';
  let atlas=null,roofAtlas=null,assetVersion=0;
  const facadeTiles=new Map(),roofTiles=new Map();
  if(typeof Image!=='undefined'){
    const image=new Image();image.onload=()=>{atlas=image;assetVersion++;facadeTiles.clear();root.MapWorkspace?.requestDraw();};
    image.src='assets/architecture-facades-atlas.png';
    const roofImage=new Image();roofImage.onload=()=>{roofAtlas=roofImage;assetVersion++;roofTiles.clear();root.MapWorkspace?.requestDraw();};
    roofImage.src='assets/architecture-roof-zones.png';
  }
  function hash(value){let n=2166136261;for(const c of String(value)){n^=c.charCodeAt(0);n=Math.imul(n,16777619);}return n>>>0;}
  const styles={
    residential:[
      ['courtyard-brick','#c2aa91',4,'#e4d9bf','#775e4c',3.4,1.55],
      ['ivory-balconies','#d7d1bc',0,'#e8e8d9','#6a827d',3.6,1.8],
      ['stone-frames','#c6c1ab',2,'#e3dcc6','#85816a',3.1,1.5],
      ['sage-panels','#afbbb0',8,'#dedfcf','#66837c',3.8,2],
      ['warm-brick','#bea28d',5,'#d9cbb4','#805e4a',3.3,1.6],
      ['cream-loggias','#d4c9b0',1,'#e8dfc8','#8c987f',4,2.1]
    ],
    office:[
      ['glass-fins','#a3b5b7',11,'#d2dedb','#526f78',2.8,2.25],
      ['limestone-bays','#c9c7b4',2,'#e4e1ce','#718c8a',3.7,2.1],
      ['silver-ribbon','#b9c6c2',10,'#dce4df','#5c7a83',3.2,2.7],
      ['charcoal-frame','#9fadaa',9,'#c0cec7','#496776',3.6,2.7]
    ],
    commercial:[
      ['brick-shops','#c4ae94',4,'#e4d4b7','#8b6958',3.5,2],
      ['stone-arcade','#cfc6ac',2,'#e8e1c9','#638e88',4,2.4],
      ['modern-retail','#bfc6b8',8,'#e1e6d6','#547987',3.2,2.2],
      ['terracotta-retail','#c0a08b',5,'#e4d1ba','#9b7657',3.7,2.1]
    ],
    industrial:[['sawtooth-works','#b2bcb6',10,'#d4d9ca','#647f80',5.5,2.7],['brick-works','#b49b87',4,'#d8c8ae','#786552',5,2.3],['panel-works','#aab8b4',11,'#d6dfd3','#648a8e',6,3]],
    warehouse:[['steel-depot','#adbcb9',10,'#d7ded1','#637f89',6,2.3],['warm-depot','#c2b9a1',6,'#dedac5','#917852',5.5,2.2],['slate-depot','#9daeb2',11,'#ccd9d5','#526e7f',6,2.6]]
  };
  function profile(parcel){
    const b=parcel.building||{},seed=hash(parcel.id+':architecture-v1'),choices=styles[b.use]||styles.commercial,index=seed%choices.length;
    const [name,tint,facade,trim,accent,pitch,windowWidth]=choices[index];
    const cell=({residential:[0,1,2,3,4,5],office:[8,9,10,11],commercial:[7,6,10,4],industrial:[13,12,14],warehouse:[15,13,14]}[b.use]||[6,7,10,4])[index];
    return {seed,index,name,tint,facade,cell,trim,accent,pitch,windowWidth,
      windowRatio:b.use==='office'&&index%2===0?.78:.61,
      balconies:b.use==='residential'&&[1,3,5].includes(index),
      fins:b.use==='office'&&index===0,
      roofProgram:seed>>>7&3,wear:.025+(seed>>>12&3)*.012};
  }
  function facadeTile(cell,size){
    const key=cell+':'+size;if(facadeTiles.has(key))return facadeTiles.get(key);
    const tile=document.createElement('canvas');tile.width=tile.height=size;
    const g=tile.getContext('2d'),q=atlas.width/4;g.imageSmoothingQuality='high';
    if(size<256)g.drawImage(facadeTile(cell,size*2),0,0,size,size);
    else g.drawImage(atlas,cell%4*q+1,Math.floor(cell/4)*q+1,q-2,q-2,0,0,size,size);
    facadeTiles.set(key,tile);return tile;
  }
  function drawWall(ctx,p,v,face){
    if(!atlas)return false;
    const a=profile(p),base=v.base||0,top=Math.min(85,v.height*.26),bottom=Math.min(85,base*.26),height=top-bottom;
    if(height<=0)return false;
    const floorCount=Math.max(1,Math.round((v.height-base)/(p.building.height/p.building.floors||3.3))),floorHeight=height/floorCount;
    const cols=Math.max(1,Math.round(face.length/a.pitch)),bay=face.length/cols,transform=ctx.getTransform();
    const pixels=Math.max(Math.hypot(transform.a,transform.b),Math.hypot(transform.c,transform.d));
    const size=2**Math.max(3,Math.min(8,Math.ceil(Math.log2(Math.max(1,bay*2*pixels))))),tile=facadeTile(a.cell,size);
    ctx.save();path(ctx,[face.a,face.z,[face.z[0],face.z[1]-top],[face.a[0],face.a[1]-top]]);ctx.clip();
    ctx.transform(face.dx/face.length,face.dy/face.length,0,1,face.a[0],face.a[1]-top);
    const pattern=ctx.createPattern(tile,'repeat');pattern.setTransform(new DOMMatrix().scale(bay*2/size,floorHeight*2/size));
    ctx.fillStyle=pattern;ctx.fillRect(0,0,face.length,height);ctx.restore();return true;
  }
  function windowPanes(p,v,faces){
    const a=profile(p),top=Math.min(85,v.height*.26),bottom=Math.min(85,(v.base||0)*.26),height=top-bottom;
    const rows=Math.max(1,Math.round((v.height-(v.base||0))/(p.building.height/p.building.floors||3.3))),result=[];
    if(height<=0)return result;
    for(const f of faces){
      const cols=Math.max(1,Math.round(f.length/a.pitch)),bay=f.length/cols,ratio=a.cell>=8&&a.cell<=11?.75:.50;
      for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
        const left=(col+.5-ratio/2)/cols,right=(col+.5+ratio/2)/cols,lo=top-(row+.79)*height/rows,hi=top-(row+.22)*height/rows;
        result.push([[f.a[0]+f.dx*left,f.a[1]+f.dy*left-lo],[f.a[0]+f.dx*right,f.a[1]+f.dy*right-lo],[f.a[0]+f.dx*right,f.a[1]+f.dy*right-hi],[f.a[0]+f.dx*left,f.a[1]+f.dy*left-hi]]);
      }
    }return result;
  }
  function roofPrograms(parcel,volume,fallback){
    const {roofProgram}=profile(parcel),use=parcel.building.use;
    if(use==='residential'){
      if(volume.type==='terrace'||roofProgram===2)return ['access','pergola','garden','terrace','garden','solar'];
      if(roofProgram===1)return ['access','solar','solar','skylight','garden','solar'];
    }
    if(use==='office'&&roofProgram===1)return ['access','solar','solar','chiller','skylight','duct'];
    if(use==='commercial'&&roofProgram===2)return ['access','skylight','terrace','garden','chiller','solar'];
    if(use==='warehouse'&&roofProgram===3)return ['access','skylight','skylight','solar','duct','solar'];
    return fallback;
  }
  function roofZones(parcel,v,masses,shape,units=[]){
    if(shape!=='flat'||!v.rect)return [];
    const a=profile(parcel),[x0,y0,x1,y1]=v.rect,w=x1-x0,d=y1-y0,result=[];
    if(w<7||d<6)return result;
    const use=parcel.building.use,choices=use==='residential'?[0,3]:use==='commercial'?[1,0]:use==='office'?[a.index%2?1:2,3]:[2,3];
    const width=Math.min(9,w*.62),depth=Math.min(7,d*.58),count=w*d>380?2:1;
    const obstacles=masses.filter(q=>q!==v&&q.rect&&q.height>v.height+.1&&q.base<=v.height+.1).map(q=>q.rect)
      .concat(units.map(u=>[u.x-u.w/2,u.y-u.d/2,u.x+u.w/2,u.y+u.d/2]));
    for(let slot=0;slot<count;slot++){
      const candidates=[];
      for(let yy=0;yy<=5;yy++)for(let xx=0;xx<=5;xx++){
        const x=x0+1+width/2+(w-width-2)*xx/5,y=y0+1+depth/2+(d-depth-2)*yy/5;
        const r=[x-width/2,y-depth/2,x+width/2,y+depth/2];
        if(r[0]<x0+.8||r[1]<y0+.8||r[2]>x1-.8||r[3]>y1-.8)continue;
        if(obstacles.some(q=>r[0]<q[2]+.65&&r[2]>q[0]-.65&&r[1]<q[3]+.65&&r[3]>q[1]-.65))continue;
        const targetX=x0+w*(slot?.72:.38),targetY=y0+d*(slot?.28:.62);
        candidates.push({x,y,r,score:(x-targetX)**2+(y-targetY)**2});
      }
      candidates.sort((a,b)=>a.score-b.score);const best=candidates[0];if(!best)continue;
      result.push({x:best.x,y:best.y,w:width,d:depth,cell:choices[slot],z:v.height+.12});obstacles.push(best.r);
    }return result;
  }
  function roofTile(cell){
    if(roofTiles.has(cell))return roofTiles.get(cell);
    const q=roofAtlas.width/2,c=document.createElement('canvas');c.width=c.height=512;
    const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(roofAtlas,cell%2*q+2,Math.floor(cell/2)*q+2,q-4,q-4,0,0,512,512);
    const pixels=g.getImageData(0,0,512,512);root.SurfaceVariation?.isolateSprite(pixels.data,512,512);g.putImageData(pixels,0,0);
    const b=[512,512,0,0];for(let y=0;y<512;y++)for(let x=0;x<512;x++)if(pixels.data[(y*512+x)*4+3]>40){b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x+1);b[3]=Math.max(b[3],y+1);}
    const result={image:c,bounds:b};roofTiles.set(cell,result);return result;
  }
  function drawRoofZones(ctx,p,v,scene,zones){
    if(!roofAtlas||!zones?.length)return;
    const c=Math.cos(v.angle),s=Math.sin(v.angle),world=(x,y,z)=>[v.origin[0]+x*c-y*s,v.origin[1]+x*s+y*c-Math.min(85,z*.26)];
    ctx.save();path(ctx,v.points.map(([x,y])=>[x,y-Math.min(85,v.height*.26)]));ctx.clip();
    for(const zone of zones){
      const {image,bounds:b}=roofTile(zone.cell),at=world(zone.x,zone.y,zone.z),light=scene.lightingAt(scene.time),offset=scene.shadowOffset(.65,light);
      if(light.elevation>0){
        const ps=[[zone.x-zone.w/2,zone.y-zone.d/2],[zone.x+zone.w/2,zone.y-zone.d/2],[zone.x+zone.w/2,zone.y+zone.d/2],[zone.x-zone.w/2,zone.y+zone.d/2]].map(([x,y])=>world(x,y,zone.z));
        path(ctx,ps.map(([x,y])=>[x+offset[0],y+offset[1]]));ctx.fillStyle='#233c352c';ctx.fill();
      }
      ctx.save();ctx.translate(...at);ctx.rotate(v.angle);ctx.drawImage(image,...[b[0],b[1],b[2]-b[0],b[3]-b[1]],-zone.w/2,-zone.d/2,zone.w,zone.d);ctx.restore();
    }ctx.restore();
  }
  function massing(parcel,layout){
    const b=parcel.building,style=profile(parcel);
    if(!b.landmark&&!layout.podium&&layout.volumes.length<=2&&parcel.id!=null&&((b.use==='office'&&b.floors>=7)||(b.use==='commercial'&&b.floors>=3))){
      const v=layout.volumes[0];if(!v.rect)return layout;
      const [x0,y0,x1,y1]=v.rect,w=x1-x0,d=y1-y0,h=b.height||b.floors*3.3;
      if(w<22||d<20||style.index===3)return layout;
      const base=Math.min(6.6,h*.24),c=Math.cos(v.angle),s=Math.sin(v.angle);
      const part=(rect,z,height,type=v.type)=>({...v,rect,base:z,height,type,points:[[rect[0],rect[1]],[rect[2],rect[1]],[rect[2],rect[3]],[rect[0],rect[3]],[rect[0],rect[1]]].map(([x,y])=>[v.origin[0]+x*c-y*s,v.origin[1]+x*s+y*c])});
      const floor={...v,base:0,height:base,type:'terrace'};let volumes;
      if(b.use==='office'){
        if(style.index===0)volumes=[floor,part([x0+w*.08,y0+d*.08,x0+w*.48,y1-d*.08],base,h,'tower'),part([x0+w*.60,y0+d*.12,x1-w*.08,y1-d*.22],base,h*.73,'tower')];
        else if(style.index===1)volumes=[floor,part([x0+1,y0+1,x1-1,y1-1],base,h*.48,'office'),part([x0+w*.15,y0+d*.10,x1-w*.10,y1-d*.25],h*.48,h*.80,'office'),part([x0+w*.30,y0+d*.16,x1-w*.16,y1-d*.42],h*.80,h,'tower')];
        else volumes=[floor,part([x0+w*.10,y0+d*.10,x1-w*.10,y0+d*.42],base,h,'tower'),part([x0+w*.10,y0+d*.42,x0+w*.40,y1-d*.08],base,h*.82,'tower')];
      }else{
        if(style.index===0)volumes=[floor,part([x0,y0,x1,y0+d*.40],base,h,'commercial'),part([x0,y0+d*.40,x0+w*.40,y1],base,h*.82,'commercial')];
        else if(style.index===1)volumes=[floor,part([x0,y0,x1,y0+d*.34],base,h,'commercial'),part([x0,y0+d*.34,x0+w*.25,y1],base,h*.82,'commercial'),part([x1-w*.25,y0+d*.34,x1,y1],base,h*.82,'commercial')];
        else volumes=[floor,part([x0+w*.12,y0+d*.12,x1-w*.12,y1-d*.12],base,h*.65,'commercial'),part([x0+w*.35,y0+d*.24,x1-w*.18,y1-d*.25],h*.65,h,'commercial')];
      }
      return {...layout,volumes};
    }
    if(b.landmark||layout.podium||layout.volumes.length!==1||b.use!=='residential')return layout;
    const v=layout.volumes[0];if(!v.rect)return layout;
    const [x0,y0,x1,y1]=v.rect,w=x1-x0,d=y1-y0;
    if(w<18||d<17||style.index%3===0)return layout;
    // A continuous lower floor retains the occupied footprint. Upper wings
    // form an L, U or stepped pair without adding floor area outside the lot.
    const low=b.floors<=3,high=b.floors>=7;
    if(!low&&!high)return layout;
    const base=low?v.height*.57:Math.min(v.height*.22,6.6),c=Math.cos(v.angle),s=Math.sin(v.angle);
    const part=(rect,height,type=v.type)=>({...v,rect,base,height,type,points:[[rect[0],rect[1]],[rect[2],rect[1]],[rect[2],rect[3]],[rect[0],rect[3]],[rect[0],rect[1]]].map(([x,y])=>[v.origin[0]+x*c-y*s,v.origin[1]+x*s+y*c])});
    let wings;
    if(low){
      const split=x0+w*.64;
      wings=[part([x0,y0,split,y1],v.height),part([split,y0,x1,y0+d*.62],Math.max(base+.8,v.height*.8))];
    }else if(style.index%2){
      const back=y0+d*.34,left=x0+w*.28,right=x1-w*.28;
      wings=[part([x0,y0,x1,back],v.height),part([x0,back,left,y1],v.height*.88),part([right,back,x1,y1],v.height*.76)];
    }else{
      const split=x0+w*.42;
      wings=[part([x0,y0,split,y1],v.height),part([split,y0,x1,y0+d*.55],v.height*.78)];
    }
    return {...layout,volumes:[{...v,height:base,type:'terrace'},...wings]};
  }
  function path(ctx,ps){ctx.beginPath();ps.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();}
  function drawFacade(ctx,p,v,scene){
    const b=p.building;if(['planned','construction'].includes(b.status)||b.landmark)return;
    const a=profile(p),base=v.base||0,height=v.height-base,top=Math.min(85,v.height*.26),bottom=Math.min(85,base*.26);
    if(top-bottom<.6)return;
    for(const face of scene.facadeFaces(v)){
      const {a:start,z:end,dx,dy,length}=face,ux=dx/length,uy=dy/length;
      const pt=(x,h,out=0)=>[start[0]+ux*x+face.nx*out,start[1]+uy*x+face.ny*out-Math.min(85,h*.26)];
      const wall=[pt(0,base),pt(length,base),pt(length,v.height),pt(0,v.height)];
      function panel(x,y,w,h,color){path(ctx,[pt(x,y),pt(x+w,y),pt(x+w,y+h),pt(x,y+h)]);ctx.fillStyle=color;ctx.fill();}
      function stroke(ps,color,width){ctx.beginPath();ps.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
      ctx.save();path(ctx,wall);ctx.clip();
      // Narrow corner piers and sparse rain streaks give material depth.
      for(const x of [0,length-.25])panel(x,base,.25,height,a.trim);
      const streaks=Math.min(10,Math.floor(length/4));
      for(let i=0;i<streaks;i++){
        const n=hash(a.seed+':'+i),x=.6+(n%1000)/1000*Math.max(0,length-1.2);
        ctx.globalAlpha=a.wear;panel(x,v.height-1.3-(n%23)/10,.12+(n%7)*.04,1.3+(n%23)/10,'#4f5144');
      }ctx.globalAlpha=1;
      if(a.fins){
        const n=Math.min(30,Math.max(1,Math.floor(length/a.pitch)));
        for(let i=1;i<n;i++)panel(i*length/n-.09,base,.18,height,a.trim);
      }
      if(base<.1&&length>5){
        const industrial=['industrial','warehouse'].includes(b.use),retail=b.use==='commercial';
        const frontage=p.entrance||p.frontage||b.center||p.center;
        const entry=Math.max(1.2,Math.min(length-1.2,frontage?(frontage[0]-start[0])*ux+(frontage[1]-start[1])*uy:length*.5));
        if(industrial){
          const count=Math.min(4,Math.max(1,Math.floor(length/9))),door=Math.min(3.3,length/(count+1)*.7),h=Math.min(3.6,height*.7);
          for(let i=0;i<count;i++){
            const x=(i+1)*length/(count+1)-door/2;
            panel(x-.12,0,door+.24,h+.2,a.trim);panel(x,0,door,h,'#647574');
            for(let j=1;j<7;j++)stroke([pt(x,h*j/7),pt(x+door,h*j/7)],'#a6b1a3',.045);
            panel(x-.22,0,.14,.85,'#bfa34e');panel(x+door+.08,0,.14,.85,'#bfa34e');
          }
        }else if(retail){
          const n=Math.min(12,Math.max(1,Math.floor(length/4.5))),bay=length/n,h=Math.min(2.7,height*.65);
          for(let i=0;i<n;i++){
            const x=i*bay+.38,w=bay-.76;panel(x-.10,0,w+.2,h+.15,a.trim);panel(x,.12,w,h-.12,'#446c77');
            stroke([pt(x+w*.65,.12),pt(x+w*.65,h)],a.trim,.08);
            panel(x,h+.2,w,.42,a.accent);
          }
        }else{
          const w=Math.min(2.1,length*.2),h=Math.min(2.7,height*.72);
          panel(entry-w/2-.16,0,w+.32,h+.2,a.trim);panel(entry-w/2,.08,w,h,'#43646d');
          stroke([pt(entry,.08),pt(entry,h)],'#c5d0c8',.07);
          // Thin canopy with a top face and fascia; fixed local dimensions.
          path(ctx,[pt(entry-w/2-.3,h+.28),pt(entry+w/2+.3,h+.28),pt(entry+w/2+.3,h+.28,.65),pt(entry-w/2-.3,h+.28,.65)]);ctx.fillStyle=a.accent;ctx.fill();
        }
      }
      ctx.restore();
      if(a.balconies&&a.cell!==5&&height>5){
        const floors=Math.min(10,Math.max(1,Math.round((top-bottom)/.858))),cols=Math.min(12,Math.max(1,Math.floor((length-1.1)/a.pitch))),margin=Math.min(.7,length*.12),bay=(length-margin*2)/cols;
        // Recessed balcony bays stay within the wall; no encroachment on roads.
        ctx.save();path(ctx,wall);ctx.clip();
        for(let row=1;row<floors;row++)for(let col=0;col<cols;col++){
          if((col+a.index)%3===0)continue;
          const x=margin+(col+.5)*bay,w=Math.min(bay*.76,2.5),y=base+(row+.10)*height/floors;
          panel(x-w/2,y,w,.22,a.trim);panel(x-w/2,y+.22,w,.75,'#78958c80');
          stroke([pt(x-w/2,y+.97),pt(x+w/2,y+.97)],a.trim,.075);
          for(const off of [-w/2,0,w/2])stroke([pt(x+off,y+.22),pt(x+off,y+.97)],a.trim,.045);
          if((row+col+a.index)%5===0){panel(x-w*.32,y+.25,w*.3,.3,'#9e8c68');panel(x-w*.32,y+.55,w*.3,.3,'#657e52');}
        }ctx.restore();
      }
    }
  }
  const api={profile,massing,roofPrograms,roofZones,drawRoofZones,drawFacade,drawWall,windowPanes,get ready(){return Boolean(atlas&&roofAtlas);},get facadeReady(){return Boolean(atlas);},get assetVersion(){return assetVersion;},get textureCount(){return facadeTiles.size+roofTiles.size;}};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CityBuildingAppearance=api;
})(typeof window==='undefined'?{}:window);
