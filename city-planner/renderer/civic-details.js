/* Meter-scale architectural assemblies. One deterministic layout serves both renderers. */
(function(root){
  'use strict';
  function seed(s){let n=2166136261;for(const c of String(s)){n^=c.charCodeAt(0);n=Math.imul(n,16777619);}return n>>>0;}
  function paletteFor(k){
    const palettes={
      sports_arena:['#e6ddd0','#397e94','#d39a45','#91b7be','#609cae'],
      university:['#d2a079','#e8dbc0','#8b4e3e','#917765','#7399a5'],
      hospital:['#e7eee4','#67a9ab','#287e91','#839ba5','#75b6c6'],
      city_hall:['#e5d2ad','#b39d78','#537d78','#79928c','#73979a'],
      fire_station:['#d7ab8b','#aa493a','#e7bd63','#706d6d','#6796a4'],
      police_station:['#dce5e5','#456d91','#254664','#8495a5','#6298b1'],
      hotel:['#e1c6a5','#a97652','#426f80','#776d68','#5993ae'],
      gas_station:['#e5dfd0','#b34536','#e3b54f','#a4b5b2','#739ea8'],
      charging_station:['#e0eadd','#458d79','#8cb84d','#557c91','#73b7b7'],
      museum:['#dfbb8f','#ac7050','#4a8a87','#8aa6a1','#65999c'],
      theater:['#e1d4be','#af7753','#5c8e94','#a8beb9','#6394a8'],
      cinema:['#677c8e','#b36558','#d8aa58','#667786','#719caf'],
      convention_center:['#e1e6df','#4e9ca9','#cd9150','#90b0b9','#71b1c4'],
      industrial_plant:['#c2c9bc','#578694','#ce9e47','#859b9f','#6294a4'],
      power_plant:['#c9c4af','#9a6a50','#b96643','#8b9a99','#72959e'],
      substation:['#d5c8aa','#728f83','#c7a052','#8b9b91','#71999e'],
      water_plant:['#d5e1d6','#4997a5','#5c83a0','#8aacae','#77b8be'],
      sewage_plant:['#c4cbbb','#678c7b','#aa955e','#80938b','#75a2a2'],
      recycling_center:['#d5d7bd','#599276','#c6a147','#829d89','#75a4a7'],
      logistics_hub:['#d5ddd6','#527a9b','#d09a48','#879fae','#6c9fac']
    };
    return palettes[k]||palettes.city_hall;
  }
  function refine(f,o){
    const w=f.width,d=f.depth,h=f.height,k=f.kind,id=seed(f.id),v=f.variant||0;
    const X=n=>n*w,Y=n=>n*d;
    // Purpose-specific palettes: masonry, secondary cladding, accent, roof and glazing.
    const palette=paletteFor(k);
    o.colorPalette=palette.slice();

    const box=(x,y,z,ww,dd,hh,material='metal',color=null,top=material)=>{const b={x,y,z,w:ww,d:dd,h:hh,material,top,color,detail:true};o.boxes.push(b);return b;};
    const mesh=(pts,material='metal',color=null)=>{const a=pts[1].map((v,i)=>v-pts[0][i]),b=pts[2].map((v,i)=>v-pts[0][i]);if(Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])>1e-8)o.meshes.push({points:pts,material,color});};
    const quad=(a,b,c,e,mat='metal',color=null)=>{mesh([a,b,c],mat,color);mesh([a,c,e],mat,color);};
    const line=(pts,z=.12,width=.14,color='#e7e3d3')=>o.lines.push({points:pts,z,width,color,dash:[]});
    const label=(text,x,y,z,size=2.4,color='#f0eed9')=>o.labels.push({text,x,y,z,size,color,angle:0});
    function tube(a,b,r=.08,color='#aebdbd',n=6){
      const delta=b.map((q,i)=>q-a[i]),len=Math.hypot(...delta);if(len<.001)return;
      const t=delta.map(q=>q/len),axis=Math.abs(t[2])>.9?[1,0,0]:[0,0,1];
      const u=[t[1]*axis[2]-t[2]*axis[1],t[2]*axis[0]-t[0]*axis[2],t[0]*axis[1]-t[1]*axis[0]],ul=Math.hypot(...u);for(let i=0;i<3;i++)u[i]/=ul;
      const vv=[t[1]*u[2]-t[2]*u[1],t[2]*u[0]-t[0]*u[2],t[0]*u[1]-t[1]*u[0]];
      const p=(center,j)=>center.map((q,i)=>{const value=q+r*(u[i]*Math.cos(j/n*Math.PI*2)+vv[i]*Math.sin(j/n*Math.PI*2));return i===2?Math.max(0,value):value;});
      for(let j=0;j<n;j++)quad(p(a,j),p(b,j),p(b,j+1),p(a,j+1),'metal',color);
    }
    function ring(cx,cy,rx,ry,z,thickness=.1,color='#bdc8c5',n=48){
      for(let j=0;j<n;j++){const a=j/n*Math.PI*2,b=(j+1)/n*Math.PI*2;tube([cx+rx*Math.cos(a),cy+ry*Math.sin(a),z],[cx+rx*Math.cos(b),cy+ry*Math.sin(b),z],thickness,color,4);}
    }
    function cylinder(cx,cy,r,z,hh,color='#b1b9b3',n=20){
      const pts=Array.from({length:n},(_,i)=>[cx+r*Math.cos(i/n*Math.PI*2),cy+r*Math.sin(i/n*Math.PI*2)]);
      o.hulls.push({points:pts,z,h:hh,color,detail:true});
    }
    const arch=o.boxes.filter(b=>b.architecture),original=o.boxes.slice(),originalHulls=o.hulls.slice();
    function blocked(x,y,r=0,z=0,except=null){
      return original.some(b=>b!==except&&b.z+b.h>z+.25&&b.z<z+2&&Math.abs(x-b.x)<b.w/2+r&&Math.abs(y-b.y)<b.d/2+r);
    }
    function freeGround(x,y,r){
      return Math.abs(x)+r<w/2-.5&&Math.abs(y)+r<d/2-.5&&!blocked(x,y,r)&&!originalHulls.some(b=>{
        const xs=b.points.map(p=>p[0]),ys=b.points.map(p=>p[1]);return x+r>Math.min(...xs)&&x-r<Math.max(...xs)&&y+r>Math.min(...ys)&&y-r<Math.max(...ys);
      });
    }
    // Window bays, reveals, sill courses, roof drains and maintained equipment.
    for(const b of arch){
      const z=b.z+b.h,x0=b.x-b.w/2,x1=b.x+b.w/2,y0=b.y-b.d/2,y1=b.y+b.d/2;
      const floors=Math.max(1,b.architecture.floors),pitch=b.h/floors;
      b.tint=true;b.roofTextured=true;b.variant=v%2;
      b.color=palette[arch.indexOf(b)%3===1?1:0];b.roofColor=palette[3];
      // Broad cladding zones remain legible at normal city zoom.
      for(let side=0;side<4;side++){
        const span=side%2?b.d:b.w;
        const xx=side%2?(side===1?x1+.025:x0-.025):b.x;
        const yy=side%2?b.y:(side===0?y0-.025:y1+.025);
        for(const [zz,hh,color] of [[.42,Math.min(1.0,pitch*.25),palette[1]],[z-.62,.44,palette[2]]]){
          if(!blocked(xx,yy,0,zz,b)){const band=box(xx,yy,zz,side%2?.06:span,side%2?span:.06,hh,'facade',color);band.tint=true;}
        }
      }
      box(b.x,b.y,.08,b.w+.12,b.d+.12,.35,'curb',null,'paving');
      for(const yy of [y0+.18,y1-.18])box(b.x,yy,z,b.w,.32,.52,'curb');
      for(const xx of [x0+.18,x1-.18])box(xx,b.y,z,.32,b.d,.52,'curb');
      for(let side=0;side<4;side++){
        const along=side%2?b.d:b.w,cols=Math.max(1,Math.floor(along/3.4)),bay=along/cols;
        for(let floor=0;floor<floors;floor++)for(let col=0;col<cols;col++){
          const ww=bay*.64,hh=Math.min(2,pitch*.52),zz=b.z+floor*pitch+Math.min(.9,pitch*.25);
          const xx=side===0||side===2?x0+(col+.5)*bay:side===1?x1+.045:x0-.045;
          const yy=side===1||side===3?y0+(col+.5)*bay:side===0?y0-.045:y1+.045;
          if(blocked(xx,yy,0,zz,b))continue;
          box(xx,yy,zz-.09,side%2?.11:ww+.18,side%2?ww+.18:.11,hh+.18,'curb','#b7bdb5');
          box(xx+(side===1?.065:side===3?-.065:0),yy+(side===2?.065:side===0?-.065:0),zz,side%2?.08:ww,side%2?ww:.08,hh,'glass',((col+floor*3+side+id)%4===0)?palette[4]:'#b1d2d6');o.boxes.at(-1).tint=true;
          if(floor>0&&(col+side+v)%3===0){
            const panel=box(xx,yy,zz-Math.min(.65,pitch*.2),side%2?.07:ww,side%2?ww:.07,Math.min(.48,pitch*.16),'metal',palette[1]);panel.tint=true;
          }
          if(ww>1.8)box(xx+(side===1?.12:side===3?-.12:0),yy+(side===2?.12:side===0?-.12:0),zz,side%2?.1:.055,side%2?.055:.1,hh,'metal','#c1c9c5');
          if((col*7+floor*11+side+id)%5<2){
            const n=side===0?[0,-1]:side===1?[1,0]:side===2?[0,1]:[-1,0];
            o.windows.push({x:xx,y:yy,z:zz,w:ww,h:hh,side,normal:n,warm:(col+floor+id)%4!==0});
          }
        }
        for(let col=1;col<cols;col+=3){const xx=side%2?(side===1?x1:x0):x0+col*bay,yy=side%2?y0+col*bay:(side===0?y0:y1);if(!blocked(xx,yy,.05,b.h*.5,b))box(xx,yy,.4,side%2?.16:.20,side%2?.20:.16,b.h-.4,'curb');}
      }
      // Membrane seams and servicing pads make roof surfaces readable at close range.
      for(let xx=x0+2;xx<x1-1;xx+=3.5){if(!blocked(xx,b.y,0,z,b))line([[xx,y0+.5],[xx,y1-.5]],z+.035,.045,'#697b7b55');}
      const roofClear=(x,y,r)=>!blocked(x,y,r,z,b)&&Math.abs(x-b.x)+r<b.w/2-.7&&Math.abs(y-b.y)+r<b.d/2-.7;
      for(let i=0;i<Math.min(4,Math.floor(b.w/7));i++){
        const xx=x0+3.3+i*4.2,yy=y1-3.0;if(!roofClear(xx,yy,1.5))continue;
        box(xx,yy,z+.03,2.9,2.4,.16,'paving');box(xx,yy,z+.19,2.3,1.8,1.1,'metal','#b6bebb');
        for(const dx of [-.55,.55]){cylinder(xx+dx,yy,.43,z+1.3,.055,'#4c6268',16);ring(xx+dx,yy,.38,.38,z+1.38,.025,'#bac6c5',16);}
        for(let j=0;j<5;j++)box(xx-1.16,yy-.65+j*.32,z+.35,.03,.14,.65,'metal','#63777b');
      }
      const ax=x1-3.2,ay=y0+3.2;
      if(roofClear(ax,ay,2.1)){box(ax,ay,z,3.2,3.0,1.9,'facade',null,'metal');box(ax,ay-1.52,z+.15,1.0,.08,1.6,'metal','#7b8b8b');}
      for(const [xx,yy] of [[x0+.8,y0+.8],[x1-.8,y1-.8]])if(roofClear(xx,yy,.25)){box(xx,yy,z+.03,.48,.48,.04,'metal','#526c6e');tube([xx,yy,z],[xx,yy,.2],.07,'#9caaa6');}
      // Individual entry assemblies replace a featureless wall.
      const ey=y0-.16;if(!blocked(b.x,ey,0,2,b)){
        box(b.x,ey,.15,Math.min(3.6,b.w*.45),.12,2.8,'glass');box(b.x,ey-.5,2.95,Math.min(5.2,b.w*.62),1.3,.14,'metal','#bac6c3');
      }
    }
    // Low landscape edging, benches, planting beds and species-based tree crowns.
    const industrial=['industrial_plant','power_plant','substation','water_plant','sewage_plant','recycling_center','logistics_hub'].includes(k);
    const margin=industrial?1.4:2.2;
    for(const sign of [-1,1]){
      box(sign*(w/2-.3),0,.02,.22,d-.6,.16,'curb');box(0,d/2-.3,.02,w-.6,.22,.16,'curb');
      box(sign*(w*.25+2),-d/2+.3,.02,Math.max(1,w*.5-5),.22,.16,'curb');
      for(let yy=-d*.24;yy<d*.43;yy+=industrial?12:9){
        const xx=sign*(w/2-margin-1.0);
        if(!freeGround(xx,yy,margin))continue;
        box(xx,yy,.06,margin*2,3.2,.2,'curb');box(xx,yy,.26,margin*2-.25,2.95,.06,'soil');
        o.trees.push({x:xx,y:yy,radius:industrial?1.1:1.8,height:industrial?3.1:5.2,variant:industrial?15:[8,9,10,18][(Math.round(yy)+id+10000)%4]});
        if(!industrial&&freeGround(xx-sign*2.6,yy,1.1)){box(xx-sign*2.6,yy,.45,.55,2,.14,'roofTiles');for(const dy of [-.72,.72])box(xx-sign*2.6,yy+dy,.03,.34,.16,.42,'metal','#74847e');}
      }
    }
    // Permeable joints and tactile paving near the front entry.
    for(let xx=-w*.4;xx<w*.41;xx+=1.1)box(xx,-d*.485,.025,.7,.5,.025,'paving','#cfbc80');
    for(const x of [-3.8,3.8])if(freeGround(x,-d*.39,.2))box(x,-d*.39,0,.19,.19,.85,'metal','#8b9a96');

    if(k==='sports_arena'){
      // Smooth oval standing-seam roof, open central skylight and perimeter fascia.
      o.hulls=o.hulls.filter(b=>b.detail||b.z<12); // remove stepped solid disc roof
      const rx=w*(v===1?.42:.385),ry=d*(v===1?.33:.385),rings=12,segs=64;
      const at=(r,a)=>[rx*r*Math.cos(a),ry*r*Math.sin(a),h*.62+h*(v===2?.12:.28)*(1-r*r)];
      for(let j=0;j<segs;j++)for(let i=0;i<rings;i++){
        const r0=i/rings,r1=(i+1)/rings,a=j/segs*Math.PI*2,b=(j+1)/segs*Math.PI*2;
        const mat=r1<=.34?'glass':'metal';quad(at(r0,a),at(r1,a),at(r1,b),at(r0,b),mat);
      }
      ring(0,0,rx,ry,h*.62,.24,'#d3dbd8',64);
      ring(0,0,rx*.34,ry*.34,h*.62+h*.28*(1-.34**2),.18,'#c1d0cd',64);
      for(let j=0;j<32;j++){const a=j/32*Math.PI*2;for(let i=4;i<12;i++){const p=at(i/12,a),q=at((i+1)/12,a);p[2]+=.05;q[2]+=.05;tube(p,q,.075,'#d1dbd9',4);}}
      for(let j=0;j<48;j++){const a=j/48*Math.PI*2,b=(j+1)/48*Math.PI*2;quad([rx*Math.cos(a),ry*Math.sin(a),6],[rx*Math.cos(b),ry*Math.sin(b),6],[rx*Math.cos(b),ry*Math.sin(b),h*.6],[rx*Math.cos(a),ry*Math.sin(a),h*.6],'glass');}
      label('ARENA',0,-d*.333,h*.55+1.5,4,'#496b77');
    }
    if(k==='university'){
      // Campus courtyards and sport markings stay between the separate buildings.
      for(const yy of [-.18,.12])o.surfaces.push({x:0,y:Y(yy),w:w*.8,d:1.6,material:'paving',z:0});
      const fx=X(-.29),fy=Y(.34),fw=w*.17,fd=d*.13;
      line([[fx,fy-fd/2],[fx,fy+fd/2]],.13,.16);ring(fx,fy,fw*.12,fw*.12,.16,.055,'#eee9d6',24);
      for(const sign of [-1,1]){const yy=fy+sign*fd*.5;tube([fx-2,yy,.1],[fx-2,yy,2],.07,'#e9e5d2');tube([fx+2,yy,.1],[fx+2,yy,2],.07,'#e9e5d2');tube([fx-2,yy,2],[fx+2,yy,2],.07,'#e9e5d2');}
      for(const x of [-.3,.3])for(const y of [-.18,.12]){const z=14+v*2+.7;for(let i=0;i<5;i++)box(X(x)-w*.10+i*w*.045,Y(y),z,w*.035,Math.max(2,d*.05),.25,'glass');}
      label('LIBRARY',0,Y(.28),h+1.1,2.6,'#5c6e72');
    }
    if(k==='hospital'){
      // Red medical crosses on a white entrance sign and both exposed upper walls.
      const cross=(x,y,z,size)=>{box(x,y,z,size,.16,size,'paving','#f3f2e9');box(x,y-.10,z+size*.36,size*.78,.08,size*.26,'carPaint','#d83232');box(x,y-.11,z+size*.10,size*.26,.08,size*.78,'carPaint','#d83232');};
      cross(0,Y(-.345),4,Math.min(3,w*.055));
      for(const b of arch.filter(b=>b.h===h))cross(b.x,b.y-b.d/2-.18,h-4,3.2);
      const z=(v===1?h*.42:h)+.08;ring(X(v===1?0:.15),Y(.08),Math.min(5,w*.065),Math.min(5,w*.065),z,.11,'#cdd8cd',36);
      label('H',X(v===1?0:.15),Y(.08),z+.05,5,'#b9d0cd');label('急诊',0,Y(-.24),7.85,3.3,'#975847');
      for(const x of [.23,.32]){const xx=X(x),yy=Y(-.35);box(xx,yy-1.7,1.0,2.1,.8,.9,'glass');for(const dx of [-1.25,1.25])for(const dy of [-1.5,1.5])box(xx+dx,yy+dy,.25,.25,.7,.65,'carPaint','#394d54');}
    }
    if(k==='hotel'){
      const tower=arch.find(b=>b.h===h);if(tower){
        for(let floor=1;floor<10;floor++)for(const sign of [-1,1]){
          const zz=floor*h/11,xx=tower.x+sign*(tower.w/2+.8);if(Math.abs(xx)+.8>w/2-.5)continue;
          box(xx,tower.y,zz,1.6,tower.d*.85,.16,'paving');tube([xx+sign*.7,tower.y-tower.d*.425,zz+.9],[xx+sign*.7,tower.y+tower.d*.425,zz+.9],.05,'#c2d1ce');
        }
        label('HOTEL',tower.x,tower.y,h+.6,3,'#566d76');
      }
      const px=X(.31),py=Y(.28);for(const sign of [-1,1])box(px+sign*w*.085,py,.1,.3,d*.24,.3,'curb');
      for(let i=0;i<3;i++)box(px-w*.13,py-d*.08+i*2.3,.45,1.0,1.8,.18,'paving','#d8d2bd');
    }
    if(k==='gas_station'||k==='charging_station'){
      const fuel=k==='gas_station';
      if(fuel){
        const z=6.55;for(let xx=-w*.35;xx<w*.36;xx+=2.8)line([[xx,-d*.20],[xx,d*.16]],z,.06,'#8ea2a4');
        for(const x of [-.25,0,.25])for(const y of [-.12,.08]){
          box(X(x),Y(y)-d*.024,1.0,1,.08,.52,'glass');
          tube([X(x)+.6,Y(y),1.5],[X(x)+.9,Y(y)+.4,.4],.065,'#344b51');
        }
        label('FUEL',0,Y(-.03),6.57,3.2,'#6e8c92');
      }else{
        for(let xx=-w*.39;xx<w*.4;xx+=2.8)for(const yy of [d*.07,d*.17]){
          box(xx,yy,3.93,2.4,d*.085,.06,'glass');box(xx,yy,4.0,.04,d*.085,.025,'metal','#a6bbb8');
        }
        for(const y of [-.21,.12])for(let i=0;i<Math.floor(w*.8/3)+1;i++){
          const xx=-w*.4+i*3,yy=Y(y);tube([xx+.4,yy,1.4],[xx+.65,yy-.4,.4],.035,'#2d4148');
          if((i+id)%3===0)o.vehicles.push({x:xx,y:yy-3.5,z:0,id:(i+id)%12});
        }
        label('EV',0,Y(-.29),.14,2.5,'#a7c2aa');
      }
    }
    if(k==='city_hall'){
      for(const xx of [-w*.26,0,w*.26]){tube([xx,-d*.30,.2],[xx,-d*.30,8],.065,'#c6ceca');quad([xx,-d*.30,7.8],[xx+1.6,-d*.30,7.5],[xx+1.6,-d*.30,6.6],[xx,-d*.30,6.8],'metal','#8faaa0');}
      for(let i=-3;i<=3;i++)for(const yy of [-d*.12-.6,-d*.12+.6])cylinder(i*w*.075,yy,.44,0,.3,'#d5d4c7');
      ring(X(.32),Y(.35),w*.045,d*.055,1.0,.08,'#c1cfc8');
    }
    if(k==='fire_station'||k==='police_station'){
      const fire=k==='fire_station';
      for(let i=0;i<3;i++){
        const xx=X(.04+i*.15),yy=Y(-.12),zz=fire?2.7:1.7;
        box(xx,yy-(fire?2:1.6),1.1,fire?2.3:1.7,.9,.7,'glass');
        for(const dx of [-1.2,1.2])for(const dy of [-1.5,1.5])box(xx+dx,yy+dy,.25,.22,.75,.6,'carPaint','#34444a');
        if(fire){for(const dx of [-.5,.5])tube([xx+dx,yy-2,zz+.1],[xx+dx,yy+2,zz+.1],.06,'#d4d6c8');for(let y=-2;y<=2;y+=.4)tube([xx-.5,yy+y,zz+.1],[xx+.5,yy+y,zz+.1],.04,'#d4d6c8');}
        for(let y=0;y<6;y++)box(xx,Y(.025)-.12,.5+y*.65,w*.10,.03,.045,'metal','#bac3b9');
      }
      label(fire?'FIRE':'POLICE',X(-.22),Y(.08),h+.6,2.2,'#6c7775');
    }
    if(k==='museum'){
      for(let i=0;i<5;i++){const xx=X(.14)+i*w*.044;box(xx,Y(.12),h+.16,w*.035,d*.22,.35,'glass');}
      for(const yy of [-.3,-.22])for(const xx of [-.31,-.18]){box(X(xx),Y(yy),0,2.6,2.6,.45,'paving');tube([X(xx)-.6,Y(yy),.45],[X(xx)+.4,Y(yy),3.5],.18,'#8b9b95');}
    }
    if(k==='theater'){
      o.hulls=o.hulls.filter(b=>b.detail); // replace five extruded blocks with genuinely curved roof shells
      for(let i=0;i<(v===1?3:v===2?4:5);i++){
        const count=v===1?3:v===2?4:5,cx=X(-.4+(.8/count)*(i+.5)),rx=w*(.44/count),ry=d*.28,peak=h*(.7+.3*Math.sin((i+1)*Math.PI/6));
        const at=(t,u)=>[cx+rx*t,Y(.025)+ry*u,8+(peak-8)*Math.sqrt(Math.max(0,1-t*t))*(.88+.12*Math.cos(u*Math.PI/2))];
        for(let a=0;a<14;a++)for(let b=0;b<10;b++)quad(at(a/7-1,b/5-1),at((a+1)/7-1,b/5-1),at((a+1)/7-1,(b+1)/5-1),at(a/7-1,(b+1)/5-1),'metal');
        for(let a=1;a<14;a+=2)for(let b=0;b<10;b++){const p=at(a/7-1,b/5-1),q=at(a/7-1,(b+1)/5-1);p[2]+=.05;q[2]+=.05;tube(p,q,.055,'#cad5d4',4);}
        for(const u of [-1,1])for(let a=0;a<14;a++){const p=at(a/7-1,u),q=at((a+1)/7-1,u);quad([p[0],p[1],0],[q[0],q[1],0],q,p,'glass');}
      }
    }
    if(k==='cinema'){
      for(let i=-2;i<=2;i++){const xx=X(i*.14);box(xx,Y(-.205)-.12,6.2,w*.08,.03,3.5,'carPaint',['#a67858','#597b8b','#b1a486'][(i+5+v)%3]);}
      label('CINEMA',0,Y(-.24),5.25,3,'#dec69a');
      for(let xx=-w*.37;xx<w*.38;xx+=1.3)box(xx,Y(-.27),5.23,.15,.15,.1,'marking','#ead8a0');
    }
    if(k==='convention_center'){
      for(const x of [-.28,0,.28])for(let j=0;j<9;j++){
        const yy=Y(-.16)+j*d*.065;box(X(x),yy,h-1.2,w*.10,d*.035,.3,'glass');
      }
      for(const xx of [-.39,-.13,.13,.39]){tube([X(xx),Y(-.32),.1],[X(xx),Y(-.32),6],.055,'#a4b3b0');quad([X(xx),Y(-.32),5.8],[X(xx)+1.2,Y(-.32),5.8],[X(xx)+1.2,Y(-.32),3.0],[X(xx),Y(-.32),3.0],'metal','#7797a0');}
    }
    if(['industrial_plant','logistics_hub','recycling_center'].includes(k)){
      const z=h*.7;
      for(let i=0;i<5;i++){const xx=X(-.31+i*.12);box(xx,Y(.08),z+1.3,w*.065,d*.25,.38,'glass');}
      for(let i=0;i<7;i++){
        const xx=X(-.34+i*.085);box(xx,Y(-.17),.1,w*.06,1.5,.55,'paving');
        for(const dx of [-w*.027,w*.027])box(xx+dx,Y(-.185),.05,.18,.18,1.0,'markingYellow');
      }
      for(let i=0;i<4;i++){const xx=X(-.3+i*.17),yy=Y(-.25);box(xx,yy-4.5,.4,2.7,1.4,2.5,'carPaint','#b9c3bc');box(xx,yy-5.15,1.6,2.3,.08,.8,'glass');for(let q=-3;q<4;q++)box(xx,yy+q,3.75,2.65,.04,.04,'metal','#798c8d');}
      if(k==='recycling_center'){for(const x of [-.3,-.12,.06,.24]){box(X(x),Y(.41),3.05,w*.12,d*.09,.14,'metal','#9baea4');label('↻',X(x),Y(.41),3.25,2.5);}}
      if(k==='industrial_plant'){tube([X(.28),Y(-.06),h*.6],[X(.1),Y(-.06),h*.6],.35,'#bac4bc');tube([X(.39),Y(-.06),h*.4],[X(.1),Y(-.06),h*.4],.28,'#b4c0b9');}
    }
    if(k==='power_plant'){
      o.hulls=o.hulls.filter(b=>b.detail||Math.max(...b.points.map(p=>p[0]))<0);
      for(const yy of [-.14,.22]){
        const cx=X(.19),cy=Y(yy),rx=w*.12,ry=d*.15,top=h*.76;
        const profile=[[0,1],[.12,.91],[.35,.68],[.58,.61],[.8,.65],[1,.75]];
        for(let a=0;a<64;a++)for(let j=0;j<profile.length-1;j++){
          const p=profile[j],q=profile[j+1],t=a/64*Math.PI*2,u=(a+1)/64*Math.PI*2;
          quad([cx+rx*p[1]*Math.cos(t),cy+ry*p[1]*Math.sin(t),top*p[0]],[cx+rx*p[1]*Math.cos(u),cy+ry*p[1]*Math.sin(u),top*p[0]],[cx+rx*q[1]*Math.cos(u),cy+ry*q[1]*Math.sin(u),top*q[0]],[cx+rx*q[1]*Math.cos(t),cy+ry*q[1]*Math.sin(t),top*q[0]],'facade');
        }
        ring(cx,cy,rx*.75,ry*.75,top,.38,'#b7c4bc',64);
        // Dark recessed throat and inner lining: cooling towers are hollow.
        const inner=Array.from({length:48},(_,j)=>[cx+rx*.66*Math.cos(j/24*Math.PI),cy+ry*.66*Math.sin(j/24*Math.PI)]);
        o.hulls.push({points:inner,z:top-7,h:.08,color:'#334d50',detail:true});
        for(let j=0;j<48;j++){const a=j/24*Math.PI,b=(j+1)/24*Math.PI;quad([cx+rx*.73*Math.cos(a),cy+ry*.73*Math.sin(a),top],[cx+rx*.73*Math.cos(b),cy+ry*.73*Math.sin(b),top],[cx+rx*.65*Math.cos(b),cy+ry*.65*Math.sin(b),top-7],[cx+rx*.65*Math.cos(a),cy+ry*.65*Math.sin(a),top-7],'metal','#7d9691');}
        for(let j=0;j<20;j++){const a=j/10*Math.PI;tube([cx+rx*Math.cos(a),cy+ry*Math.sin(a),0],[cx+rx*.9*Math.cos(a),cy+ry*.9*Math.sin(a),4],.18,'#aabbb2');}
      }
    }
    if(k==='water_plant'||k==='sewage_plant'){
      for(const x of [0,.29])for(const y of [-.14,.22]){
        const cx=X(x),cy=Y(y),rx=w*.113,ry=d*.143;
        ring(cx,cy,rx,ry,3.5,.055,'#c5d1c8',40);ring(cx,cy,rx,ry,3.0,.04,'#a4b9b1',40);
        for(let j=0;j<16;j++){const a=j/8*Math.PI;tube([cx+rx*Math.cos(a),cy+ry*Math.sin(a),2.4],[cx+rx*Math.cos(a),cy+ry*Math.sin(a),3.55],.04,'#c3cec6');}
        box(cx,cy,2.7,rx*1.85,.85,.08,'metal');for(const sign of [-1,1])tube([cx-rx*.92,cy+sign*.5,3.6],[cx+rx*.92,cy+sign*.5,3.6],.045,'#b7c8bf');
        cylinder(cx,cy,.55,2.8,.65,'#b3c2bb');ring(cx,cy,rx*.64,ry*.64,2.52,.025,k==='sewage_plant'?'#8aa79a':'#a8c6cd',40);
        tube([cx-rx,cy,1.5],[cx-rx-2,cy,1.5],.25,'#72939b');
      }
      for(const yy of [-.14,.22])tube([X(-.14),Y(yy),1.5],[X(-.14),Y(yy)-d*.10,1.5],.22,'#8ba5a7');
    }
    if(k==='substation'){
      for(const x of [-.1,.15,.35])for(const y of [-.18,.17]){
        const cx=X(x),cy=Y(y);
        for(let j=0;j<6;j++)for(const sign of [-1,1])box(cx+sign*w*.065,cy-d*.055+j*d*.023,.5,.16,.12,2.3,'metal','#849d9a');
        for(const dx of [-.035,.035])for(let j=0;j<6;j++)cylinder(X(x+dx),cy,.22,3+j*.3,.12,'#927e66',10);
      }
      for(const yy of [-.28,.32])for(let i=0;i<2;i++){
        const a=X(-.2+i*.3),b=X(.12+i*.28);for(let q=0;q<10;q++)tube([a+(b-a)*q/10,Y(yy),h-1.4*Math.sin(q/10*Math.PI)],[a+(b-a)*(q+1)/10,Y(yy),h-1.4*Math.sin((q+1)/10*Math.PI)],.025,'#52666c');
      }
    }
    if(k==='convention_center'&&v>0){
      for(const b of o.boxes)if(b.z>=15){const lift=v===1?(Math.abs(b.x)<w*.14?4:0):(b.x<0?3:b.x>w*.14?6:0);b.z+=lift;}
      for(const b of arch){if(b.h===15){const lift=v===1?(Math.abs(b.x)<w*.14?4:0):(b.x<0?3:b.x>w*.14?6:0);b.h+=lift;}}
    }
    // Keep related materials coherent, with explicit roof, glass and forecourt tones.
    for(const b of o.boxes){
      if(b.material==='glass'&&!b.color){b.color=palette[4];b.tint=true;}
      if(b.material==='metal'&&!b.color){b.color=palette[3];b.tint=true;}
    }
    for(const m of o.meshes){
      if(!m.color){m.color=m.material==='glass'?palette[4]:palette[3];m.tint=true;}
    }
    for(const s of o.surfaces)if(s.material==='paving'&&!s.color)s.color='#c9bca2';
    o.colorVersion=1;
    // Ground-level equipment and fine geometry use the same small material pool.
    o.detailVersion=2;
  }
  const api={refine,paletteFor};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CityCivicDetails=api;
})(typeof window==='undefined'?{}:window);
