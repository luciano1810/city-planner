/* Display-only construction stages. All dimensions are world metres; no saved
 * geometry is changed. The scene caches this painter at the normal building LOD. */
(function(root){
  'use strict';
  const atlases=[];let version=0;
  const sprites=new Map();
  if(typeof Image!=='undefined')['construction-equipment','construction-supplies'].forEach((name,index)=>{
    const img=new Image();img.onload=()=>{atlases[index]=img;version++;sprites.clear();root.MapWorkspace?.requestDraw();};img.src=`assets/${name}.png`;
  });
  function sprite(cell){
    const atlas=atlases[Math.floor(cell/4)],slot=cell%4;
    if(!atlas)return null;if(sprites.has(cell))return sprites.get(cell);
    const tile=document.createElement('canvas');tile.width=tile.height=512;
    const g=tile.getContext('2d',{willReadFrequently:true}),q=atlas.width/2;
    g.drawImage(atlas,slot%2*q+2,Math.floor(slot/2)*q+2,q-4,q-4,0,0,512,512);
    const pixels=g.getImageData(0,0,512,512);root.SurfaceVariation?.isolateSprite(pixels.data,512,512);g.putImageData(pixels,0,0);
    const b=[512,512,0,0];for(let y=0;y<512;y++)for(let x=0;x<512;x++)if(pixels.data[(y*512+x)*4+3]>32){b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x+1);b[3]=Math.max(b[3],y+1);}
    if(b[2]<=b[0])return null;
    const image=document.createElement('canvas');image.width=b[2]-b[0];image.height=b[3]-b[1];image.getContext('2d').drawImage(tile,b[0],b[1],image.width,image.height,0,0,image.width,image.height);
    const shadow=document.createElement('canvas');shadow.width=image.width;shadow.height=image.height;
    const mask=shadow.getContext('2d');mask.drawImage(image,0,0);mask.globalCompositeOperation='source-in';mask.fillStyle='#293b36';mask.fillRect(0,0,shadow.width,shadow.height);
    tile.width=tile.height=1;const result={image,shadow};sprites.set(cell,result);return result;
  }
  function phase(building){
    if(building.status==='planned')return {name:'planned',progress:0,height:0};
    if(building.status!=='construction')return {name:'complete',progress:1,height:building.height||building.floors*3.3||3.3};
    const progress=Math.max(0,Math.min(1,Number(building.constructionProgress)||0));
    return {name:progress<.18?'excavation':progress<.76?'structure':'finishing',progress,
      height:Math.max(0,(progress-.12)/.88)*(building.height||building.floors*3.3||3.3)};
  }
  function recipe(parcel){
    let seed=2166136261;for(const c of String(parcel.id)+':site-layout'){seed^=c.charCodeAt(0);seed=Math.imul(seed,16777619);}seed>>>=0;
    const b=parcel.building,type=['industrial','warehouse'].includes(b.use)?'hall':b.use==='residential'?(b.floors<=3?'house':'apartment'):b.use==='office'?'office':'retail';
    return {seed,type,variant:seed%4,bay:4.2+(seed>>>4)%4*.6,flip:!!(seed&16),
      pour:.17+(seed>>>6)%4*.065,coreX:[.27,.55,.63,.36][seed%4],coreY:[.44,.58,.35,.63][seed%4],
      fence:['#829b91','#899eaa','#9aa494','#8d9b91'][seed%4],mesh:['#418777','#537e87','#67917e','#547e76'][seed%4]};
  }
  function path(ctx,points,close=true){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));if(close)ctx.closePath();}
  function line(ctx,points,color,width){path(ctx,points,false);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
  function ring(points){return points.length>1&&points[0][0]===points.at(-1)[0]&&points[0][1]===points.at(-1)[1]?points.slice(0,-1):points;}
  function paint(ctx,p,scale,scene,geometry){
    const b=p.building,stage=phase(b),design=recipe(p),points=ring(b.footprint);
    if(points.length<3||stage.name==='complete')return;
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    const x0=Math.min(...xs),y0=Math.min(...ys),w=Math.max(...xs)-x0,d=Math.max(...ys)-y0;
    const center=points.reduce((a,p)=>[a[0]+p[0]/points.length,a[1]+p[1]/points.length],[0,0]);
    const inset=f=>points.map(([x,y])=>[center[0]+(x-center[0])*f,center[1]+(y-center[1])*f]);
    const lift=h=>Math.min(85,h*.26),variant=scene.seed(p.id),light=scene.lightingAt(scene.time);
    function surface(poly,name,v=0){path(ctx,poly);ctx.fillStyle=scene.material(ctx,name,v);ctx.fill();}
    const near=scale>=1.2;
    ctx.save();
    if(!near){
      path(ctx,points);ctx.fillStyle=stage.name==='planned'?'#bfc7ab':stage.name==='excavation'?'#947854':'#aaa897';ctx.fill();
      line(ctx,[...points,points[0]],stage.name==='planned'?'#5c958f':'#b89a62',.4);
      ctx.restore();return;
    }
    surface(points,'siteGround',variant);
    if(stage.name==='planned'){
      // Survey lines stay on the actual footprint, including rotated lots.
      ctx.save();path(ctx,points);ctx.clip();ctx.globalAlpha=.5;
      line(ctx,[[center[0],y0],[center[0],y0+d]],'#ede9d3',.08);
      line(ctx,[[x0,center[1]],[x0+w,center[1]]],'#ede9d3',.08);
      ctx.restore();ctx.setLineDash([1.6,.85]);line(ctx,[...inset(.91),inset(.91)[0]],'#c9f0df',.28);ctx.setLineDash([]);
      for(const [x,y] of inset(.94)){
        line(ctx,[[x-.65,y],[x+.65,y]],'#f6f0d6',.16);line(ctx,[[x,y-.65],[x,y+.65]],'#f6f0d6',.16);
        ctx.fillStyle='#7a6550';ctx.fillRect(x-.14,y-.32,.28,.5);ctx.fillStyle='#db8460';ctx.fillRect(x-.17,y-.48,.34,.2);
      }
      // A small survey board is recognisable without tiny illegible text.
      ctx.save();path(ctx,points);ctx.clip();ctx.fillStyle='#ecebd8';ctx.fillRect(x0+w*.35,y0+d*.75,Math.min(3,w*.2),.8);
      ctx.fillStyle='#47877f';ctx.fillRect(x0+w*.35+.12,y0+d*.75+.12,Math.min(3,w*.2)-.24,.2);ctx.restore();
      ctx.restore();return;
    }
    const layout=geometry.buildingMassing(p),main=layout.volumes.find(v=>v.rect);
    let frameAngle=0;
    function localFrame(v,height,draw){
      if(!v?.rect)return;
      ctx.save();path(ctx,v.points.map(([x,y])=>[x,y-lift(height)]));ctx.clip();
      const previousAngle=frameAngle;frameAngle=v.angle;
      ctx.translate(v.origin[0],v.origin[1]-lift(height));ctx.rotate(v.angle);draw(v.rect);ctx.restore();frameAngle=previousAngle;
    }
    function prop(cell,x,y,width,angle=0){
      const asset=sprite(cell);if(!asset)return;const {image,shadow}=asset;
      const depth=width*image.height/image.width;
      ctx.save();ctx.translate(x,y);ctx.rotate(angle);
      if(cell!==1&&light.elevation>0){
        const offset=scene.shadowOffset(cell===0?1.8:.55,light),turn=frameAngle+angle;
        const dx=offset[0]*Math.cos(turn)+offset[1]*Math.sin(turn),dy=-offset[0]*Math.sin(turn)+offset[1]*Math.cos(turn);
        ctx.globalAlpha=light.strength*.7;ctx.drawImage(shadow,-width/2+dx,-depth/2+dy,width,depth);ctx.globalAlpha=1;
      }
      ctx.drawImage(image,-width/2,-depth/2,width,depth);ctx.restore();
    }
    function hoarding(front){
      for(let i=0;i<points.length;i++){
        const a=points[i],z=points[(i+1)%points.length];if(((a[1]+z[1])/2>=center[1])!==front)continue;
        const dx=z[0]-a[0],dy=z[1]-a[1],length=Math.hypot(dx,dy),n=Math.max(1,Math.ceil(length/2.5));
        for(let j=0;j<n;j++){
          if(i===0&&Math.abs((j+.5)/n-.5)<.15)continue;
          const lo=j/n,hi=(j+1)/n,ax=a[0]+dx*lo,ay=a[1]+dy*lo,bx=a[0]+dx*hi,by=a[1]+dy*hi;
          path(ctx,[[ax,ay],[bx,by],[bx,by-.55],[ax,ay-.55]]);ctx.fillStyle=design.fence;ctx.fill();
          line(ctx,[[ax,ay-.55],[bx,by-.55]],'#d1d5bd',.12);line(ctx,[[ax,ay],[ax,ay-.65]],'#e5d7ac',.12);
        }
      }
    }
    hoarding(false);
    const pit=inset(.87);
    ctx.save();path(ctx,points);ctx.clip();
    surface(pit,'excavation',variant);line(ctx,[...pit,pit[0]],'#5c5144',.48);
    line(ctx,[...inset(.82),inset(.82)[0]],'#443e3440',.65);
    if(stage.progress>.07){
      surface(inset(.73),'rawConcrete');
      localFrame(main,0,([a,c,b,d])=>{
        const w=b-a,h=d-c;ctx.fillStyle=scene.material(ctx,'reinforcement');ctx.fillRect(a+w*.16,c+h*.16,w*.28,h*.66);
        ctx.strokeStyle='#d8d2bf';ctx.lineWidth=.45;
        for(let x=a+w*.18;x<b-w*.14;x+=5)line(ctx,[[x,c+h*.16],[x,d-h*.16]],'#dad5c3',.45);
        for(let y=c+h*.18;y<d-h*.14;y+=5)line(ctx,[[a+w*.16,y],[b-w*.16,y]],'#dad5c3',.45);
      });
    }
    ctx.restore();
    if(stage.name==='excavation')localFrame(main,0,([a,c,b,d])=>{
      const w=b-a,h=d-c;
      prop(0,a+w*(design.flip?.32:.68),c+h*.36,Math.min(design.type==='house'?6:9,w*.35),design.flip?Math.PI/2:0);
      prop(design.type==='house'?4:2,a+w*.72,c+h*.75,Math.min(3.1,w*.16));
      prop(design.variant%2?5:3,a+w*.5,c+h*.76,Math.min(2.5,w*.12));
    });
    if(stage.name!=='excavation'){
      const volumes=[...(layout.podium?[layout.podium]:[]),...layout.volumes].sort((a,b)=>(a.base||0)-(b.base||0));
      for(const v of volumes){
        const base=v.base||0,height=Math.min(v.height,stage.height);if(height<=base)continue;
        const bottom=lift(base),top=lift(height),finished=stage.name==='finishing';
        for(const face of scene.facadeFaces(v)){
          const {a,z,dx,dy,length}=face;
          const wall=[[a[0],a[1]-bottom],[z[0],z[1]-bottom],[z[0],z[1]-top],[a[0],a[1]-top]];
          path(ctx,wall);ctx.fillStyle='#596763';ctx.fill();
          ctx.save();ctx.clip();ctx.transform(dx/length,dy/length,0,-.26,a[0],a[1]);
          const options=b.use==='office'?[2,8,9,10,11]:b.use==='residential'?[0,1,2,4,5,6]:[0,2,3,7,8,10];
          const facade=root.CityBuildingAppearance?.profile(p)?.facade??options[scene.seed(p.id+':facade')%options.length];
          ctx.globalAlpha=finished?.92:.48;ctx.fillStyle=scene.material(ctx,finished?'facade':'rawConcrete',finished?facade:0);
          ctx.fillRect(0,base,length,height-base);ctx.restore();
          path(ctx,wall);ctx.fillStyle=`rgba(31,47,45,${.18-.10*Math.max(0,face.nx*Math.cos(light.azimuth*Math.PI/180)+face.ny*Math.sin(light.azimuth*Math.PI/180))})`;ctx.fill();
          // Exposed frame: separate columns and slabs retain readable depth.
          const bays=Math.max(1,Math.ceil(length/design.bay));
          for(let j=0;j<=bays;j++){
            const t=j/bays,x=a[0]+dx*t,y=a[1]+dy*t;
            line(ctx,[[x,y-bottom],[x,y-top]],'#d1cdbb',.24);
          }
          for(let h=base;h<height;h+=design.type==='hall'?height-base:3.3){
            line(ctx,[[a[0],a[1]-lift(h)],[z[0],z[1]-lift(h)]],'#545e574d',.56);
            line(ctx,[[a[0],a[1]-lift(h)-.08],[z[0],z[1]-lift(h)-.08]],'#d4d1c3',.22);
          }
          if(finished){
            ctx.save();path(ctx,wall);ctx.clip();
            for(const win of scene.facadeWindows({...v,height},b.floors||1,b.height||height)){
              path(ctx,win);ctx.fillStyle='#587d88';ctx.fill();line(ctx,[win[0],win[1]],'#c9d4cf',.09);
            }ctx.restore();
          }
          // Safety mesh covers the frame, then retreats to the upper work deck.
          const meshBottom=finished?Math.max(bottom,top-1.2):bottom;
          const mesh=[[a[0],a[1]-meshBottom],[z[0],z[1]-meshBottom],[z[0],z[1]-top],[a[0],a[1]-top]];
          ctx.save();path(ctx,mesh);ctx.clip();ctx.globalAlpha=design.type==='hall'?.18:design.type==='house'?.25:.48;
          ctx.transform(dx/length,dy/length,0,-.26,a[0],a[1]);ctx.fillStyle=scene.material(ctx,'safetyNet');ctx.fillRect(0,base,length,height-base);ctx.restore();
          for(let j=0;j<=bays;j++){
            const t=j/bays,x=a[0]+dx*t,y=a[1]+dy*t;
            line(ctx,[[x,y-meshBottom],[x,y-top-.35]],'#a7b5a1',.10);
            if(j<bays&&j%2===0){const t2=(j+1)/bays;line(ctx,[[x,y-meshBottom],[a[0]+dx*t2,a[1]+dy*t2-top]],'#d4c8a778',.075);}
          }
          line(ctx,[[a[0],a[1]-top-.25],[z[0],z[1]-top-.25]],'#d4c7a1',.12);
        }
        const roof=v.points.map(([x,y])=>[x,y-top]);
        surface(roof,finished&&stage.progress>.92?'roof':'rawConcrete',variant);
        localFrame(v,height,([a,c,z,d])=>{
          const w=z-a,h=d-c,type=design.type,house=type==='house',hall=type==='hall';
          const co=Math.cos(v.angle),si=Math.sin(v.angle);
          const pt=(x,y,rise=0)=>{const dz=lift(height+rise)-lift(height);return [x-si*dz,y-co*dz];};
          function beam(x0,y0,x1,y1,rise,width,color){
            const aa=pt(x0,y0,rise),bb=pt(x1,y1,rise);
            line(ctx,[[aa[0]+.10,aa[1]+.16],[bb[0]+.10,bb[1]+.16]],'#293d3540',width+.12);
            line(ctx,[aa,bb],color,width);line(ctx,[aa,bb],'#e9e1c05c',width*.24);
          }
          function box(x,y,ww,dd,rise,material='rawConcrete',variant=0){
            const base=[[x,y],[x+ww,y],[x+ww,y+dd],[x,y+dd]],top=base.map(([x,y])=>pt(x,y,rise));
            const offset=scene.shadowOffset(rise,light),dx=offset[0]*co+offset[1]*si,dy=-offset[0]*si+offset[1]*co;
            path(ctx,[...base,...base.slice().reverse().map(([x,y])=>[x+dx,y+dy])]);ctx.fillStyle='#2c3c3425';ctx.fill();
            for(let i=0;i<4;i++){
              const j=(i+1)%4;path(ctx,[base[i],base[j],top[j],top[i]]);ctx.fillStyle=i%2?'#858a7a':'#aaa990';ctx.fill();
            }
            path(ctx,top);ctx.fillStyle=scene.material(ctx,material,variant);ctx.fill();
            line(ctx,[top[3],top[2]],'#efead18c',.07);
          }
          // Stable per-site pouring direction and work zones.
          if(!hall&&!finished){
            const xx=design.flip?z-w*design.pour:a;
            ctx.fillStyle=scene.material(ctx,'reinforcement');ctx.fillRect(xx,c,w*design.pour,h);
            ctx.fillStyle=scene.material(ctx,'formwork');ctx.fillRect(design.flip?xx:xx+w*design.pour,c,.28,h);
          }
          if(hall){
            // A steel hall exposes its long-span trusses and floor below.
            ctx.fillStyle='#65716b';ctx.fillRect(a,c,w,h);
            ctx.globalAlpha=.34;ctx.fillStyle=scene.material(ctx,'rawConcrete');ctx.fillRect(a,c,w,h);ctx.globalAlpha=1;
            const pitch=Math.max(3.6,h/12),coverage=finished?.58:.12+(design.variant*.055),coverW=w*coverage;
            const roofStart=design.flip?z-coverW:a;
            ctx.fillStyle=scene.material(ctx,'metal',design.variant);ctx.fillRect(roofStart,c,coverW,h);
            for(let y=c+.5;y<d;y+=pitch){
              beam(a+.3,y,z-.3,y,1,.19,'#b2bab2');
              for(let x=a+.3;x<z-.5;x+=w/6){
                beam(x,y,Math.min(z-.3,x+w/12),y+.6,1,.10,'#879c99');
                beam(Math.min(z-.3,x+w/12),y+.6,Math.min(z-.3,x+w/6),y,1,.10,'#879c99');
              }
              for(const x of [a+.4,z-.6])box(x,y-.16,.26,.32,1.9,'metal',design.variant);
            }
            for(const x of [a+.3,a+w*.33,a+w*.66,z-.3])beam(x,c+.3,x,d-.3,1.2,.12,'#c0c7b9');
            prop(7,a+w*.58,c+h*.69,Math.min(2.7,w*.12),Math.PI/2);
            prop(5,a+w*.8,c+h*.85,Math.min(3,w*.13));
            return;
          }
          for(let x=a+design.bay;x<z-.3;x+=design.bay)line(ctx,[[x,c],[x,d]],'#72807724',.045);
          for(let y=c+design.bay;y<d-.3;y+=design.bay)line(ctx,[[a,y],[z,y]],'#72807724',.045);
          if(house||type==='apartment'){
            // Brick room divisions and a central corridor make housing read
            // differently from an office floor plate, even before cladding.
            const corridor=c+h*(design.variant%2?.43:.56),wall=house?.24:.20,rise=house?1.65:1.1;
            const masonry=house?'facade':'rawConcrete',tone=house?[4,5,6,2][design.variant]:0;
            box(a+.6,corridor,w-1.2,wall,rise,masonry,tone);
            if(!house)box(a+.6,corridor+1.5,w-1.2,wall,rise,masonry,tone);
            for(let x=a+design.bay;x<z-1;x+=design.bay){
              box(x,c+.6,wall,Math.max(.4,corridor-c-1.25),rise,masonry,tone);
              box(x,corridor+(house?1:2.2),wall,Math.max(.4,d-corridor-(house?1.6:2.8)),rise,masonry,tone);
            }
            for(const y of [c+.5,d-.7])box(a+.5,y,w-1,.2,rise*.7,masonry,tone);
            prop(4,a+w*.22,c+h*.77,Math.min(2.2,w*.15));
            prop(2,a+w*.77,c+h*.22,Math.min(2.6,w*.15));
            if(house&&finished){
              // Match the completed roof family; a flat roof stays a slab.
              const shape=root.CityOrdinaryRoofs?.layout(p).find(e=>e.volume===v)?.shape;
              if(shape&&shape!=='flat'){
                const mid=(c+d)/2,ridge=2.5,cover=.28+design.variant*.1;
                for(let x=a+.5;x<z-.3;x+=1.15){
                  line(ctx,[pt(x,c+.4,.2),pt(x,mid,ridge),pt(x,d-.4,.2)],'#604d343d',.29);
                  line(ctx,[pt(x,c+.4,.2),pt(x,mid,ridge),pt(x,d-.4,.2)],'#b69c70',.15);
                }
                beam(a+.4,mid,z-.4,mid,ridge,.2,'#d7bd86');
                const end=a+w*cover;
                path(ctx,[pt(a,c,.2),pt(end,c,.2),pt(end,mid,ridge),pt(a,mid,ridge)]);ctx.fillStyle=scene.material(ctx,'roofTiles',design.variant);ctx.fill();
              }
            }
          }
          if(w>8&&h>9&&!house){
            const cw=Math.min(type==='office'?4.2:2.5,w*.2),ch=Math.min(type==='office'?5:3.3,h*.23);
            const x=Math.min(z-cw-.6,a+w*design.coreX),y=Math.min(d-ch-.6,c+h*design.coreY),rise=type==='office'?2.4:1.35;
            box(x-.2,y-.2,cw+.4,.25,rise);
            box(x-.2,y,.25,ch,rise);box(x+cw-.05,y,.25,ch,rise);
            box(x-.2,y+ch-.1,cw+.4,.25,rise);
            const inner=[[x+.1,y+.1],[x+cw-.1,y+.1],[x+cw-.1,y+ch-.2],[x+.1,y+ch-.2]].map(([x,y])=>pt(x,y,rise));
            path(ctx,inner);ctx.fillStyle='#45554c';ctx.fill();
            for(let i=0;i<8;i++)line(ctx,[pt(x+.18,y+.3+i*(ch-.7)/8,rise),pt(x+cw*.48,y+.3+i*(ch-.7)/8,rise)],'#a3ab96',.12);
            if(type==='office'){
              beam(x+cw*.55,y+.1,x+cw*.55,y+ch-.2,rise,.17,'#d1d2bf');
              prop(5,a+w*.19,c+h*.74,Math.min(3.3,w*.18));
              if(finished){ctx.fillStyle=scene.material(ctx,'glass',design.variant);ctx.fillRect(z-w*.15,c+.5,w*.12,h*.62);}
            }
          }
          if(type!=='house'&&type!=='apartment'){
            prop(2,a+w*.81,c+h*.81,Math.min(3.1,w*.13));
            if(!finished)prop(3,a+w*.83,c+h*.52,Math.min(2.7,w*.12));
          }
          if(!finished)for(let x=a+2;x<z-1;x+=design.bay)for(const y of [c+1.1,d-1.6]){
            box(x,y,.34,.34,.85);
            for(const dx of [.08,.26])line(ctx,[pt(x+dx,y+.1,.7),pt(x+dx,y+.1,1.45)],'#79684e',.055);
          }
        });
        // Formwork borders the current slab; the mesh itself remains metre-scaled.
        ctx.save();path(ctx,roof);ctx.clip();ctx.strokeStyle=scene.material(ctx,'formwork');ctx.lineWidth=.55;ctx.stroke();ctx.restore();
        line(ctx,roof,'#d7c9ab',.22);
        // Column starter bars on the active slab, inset from its edges.
        if(!finished)for(const [x,y] of ring(v.points))line(ctx,[[x,y-top],[x,y-top-.6]],'#80684d',.14);
      }
      // The crane jib is a detailed overhead sprite; its mast is projected
      // independently so the camera direction does not rotate with the image.
      if(main?.rect&&['office','apartment','retail'].includes(design.type)&&b.height>=12&&stage.progress<.94){
        const [a,c,z,d]=main.rect,w=z-a,h=d-c,jib=Math.min(30,w*.87),cx=(a+z)/2,cy=c+h*(design.variant%2?.24:.72);
        const co=Math.cos(main.angle),si=Math.sin(main.angle),world=(x,y)=>[main.origin[0]+x*co-y*si,main.origin[1]+x*si+y*co];
        const anchor=world(cx-jib*.16,cy),height=stage.height+6,base=lift(stage.height),top=lift(height);
        line(ctx,[[anchor[0]-.25,anchor[1]-base],[anchor[0]-.25,anchor[1]-top]],'#a77e32',.19);
        line(ctx,[[anchor[0]+.25,anchor[1]-base],[anchor[0]+.25,anchor[1]-top]],'#e0b655',.19);
        for(let y=anchor[1]-top;y<anchor[1]-base;y+=.5)line(ctx,[[anchor[0]-.25,y],[anchor[0]+.25,Math.min(y+.5,anchor[1]-base)]],'#c99f44',.12);
        const at=world(cx,cy);prop(1,at[0],at[1]-top,jib,main.angle);
      }
    }
    // Perimeter hoarding with an entrance gap, stable as progress advances.
    hoarding(true);
    ctx.restore();
  }
  const api={phase,recipe,paint,get assetVersion(){return version;},get ready(){return atlases.filter(Boolean).length===2;}};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CityBuildingStages=api;
})(typeof window==='undefined'?{}:window);
