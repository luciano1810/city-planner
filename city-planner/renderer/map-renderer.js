/* Standard cartography. All shapes come from the city; scale is CSS pixels/metre. */
(function(root){
  'use strict';
  const palette={land:'#f6f5ef',water:'#9ed9ed',shore:'#b5dce4',park:'#cce5ae',
    building:'#eeede7',buildingEdge:'#deded8',commercial:'#faf0d9',industrial:'#eeeaed',
    road:'#fdfcf9',roadEdge:'#c5c8ca',arterial:'#d1d2d3',arterialEdge:'#a8acae',text:'#50565a'};
  const font='-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, "Noto Sans CJK SC", sans-serif';
  const ranks={path:0,lane:1,street:2,avenue:3,highway:4,motorway:5,tram:6,train:7,metro:8};
  const roadsCache=new WeakMap(),iconsCache=new Map();
  const categories={
    park:['tree-fill','#63b743','#438e30'],plaza:['flag-fill','#a5a7a5','#747977'],
    school:['mortarboard-fill','#b58155','#926039'],university:['mortarboard-fill','#b58155','#926039'],
    hospital:['hospital-fill','#e5768c','#c55771'],clinic:['hospital-fill','#e5768c','#c55771'],
    museum:['bank2','#ec7bb1','#d85d97'],theater:['camera-reels-fill','#ec7bb1','#d85d97'],
    cinema:['camera-reels-fill','#ec7bb1','#d85d97'],stadium:['bicycle','#68b94a','#489334'],sports_arena:['bicycle','#68b94a','#489334'],
    convention_center:['bank2','#a5a7a5','#747977'],
    city_hall:['bank2','#9b82c9','#8066af'],hotel:['building-fill','#a487ca','#8264ad'],
    parking_lot:['p-circle','#75a4c9','#4f80a8'],parking_garage:['p-circle','#75a4c9','#4f80a8'],
    airport:['airplane-fill','#5699dc','#357fbc'],port:['flag-fill','#5699dc','#357fbc'],
    train_station:['train-front-fill','#5796dc','#3478bd'],bus:['bus-front-fill','#5796dc','#3478bd'],
    train:['train-front-fill','#5796dc','#3478bd'],metro:['train-front-fill','#5796dc','#3478bd'],tram:['train-front-fill','#5796dc','#3478bd'],
    police_station:['shield-fill','#749ad0','#5279b1'],fire_station:['fire','#e68d55','#be6733'],
    gas_station:['fuel-pump-fill','#75a4c9','#4f80a8'],charging_station:['lightning-charge-fill','#75a4c9','#4f80a8'],
    commercial:['bag-fill','#f4b62e','#c88a18'],office:['building-fill','#9a9d9e','#737879']
  };
  function category(kind){return categories[kind]||['building-fill','#9a9d9e','#737879'];}
  function path(ctx,points,closed=false){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));if(closed)ctx.closePath();}
  function roadStyle(road,scale,types={}){
    const major=['avenue','highway','motorway'].includes(road.kind),rail=['train','tram','metro'].includes(road.kind);
    const motorway=['highway','motorway'].includes(road.kind),foot=road.kind==='path';
    // Screen minimums retain hierarchy at city scale; physical widths take over nearby.
    const width=Math.max(foot?1:major?3.4:1.5,Math.min(major?24:16,(types[road.kind]?.width||6)*scale*.78));
    return {width,rail,major,fill:major?palette.arterial:palette.road,edge:motorway?palette.arterialEdge:palette.roadEdge,
      visible:(road.level||0)>=0&&(road.kind!=='lane'||scale>=.055)&&(!foot||scale>=.16)};
  }
  function sampleLine(points,distance){
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
      if(!length)continue;
      if(distance<=length)return {point:[a[0]+(b[0]-a[0])*distance/length,a[1]+(b[1]-a[1])*distance/length],angle:Math.atan2(b[1]-a[1],b[0]-a[0])};
      distance-=length;
    }
    return null;
  }
  function upright(angle){while(angle>Math.PI/2)angle-=Math.PI;while(angle< -Math.PI/2)angle+=Math.PI;return angle;}
  function roadCandidates(points,scale,sy,textWidth,bounds){
    const screen=points.map(p=>[p[0]*scale,p[1]*sy]);
    const total=screen.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-screen[i][0],p[1]-screen[i][1]),0),span=textWidth+22;
    if(total<span)return [];
    const result=[],distances=[total*.5,total*.3,total*.7];
    // Long roads can cross the viewport while all three default anchors are offscreen.
    for(let d=span/2;d<total;d+=Math.max(180,span))distances.push(d);
    for(const d of distances){
      if(d<span/2||d>total-span/2)continue;
      const a=sampleLine(screen,d-span/2),m=sampleLine(screen,d),b=sampleLine(screen,d+span/2);
      if(!a||!m||!b)continue;
      const angle=upright(Math.atan2(b.point[1]-a.point[1],b.point[0]-a.point[0]));
      const deviation=Math.abs((m.point[0]-a.point[0])*Math.sin(angle)-(m.point[1]-a.point[1])*Math.cos(angle));
      if(deviation>3||Math.abs(Math.sin(a.angle-b.angle))>.35)continue;
      if(bounds&&(m.point[0]<bounds[0]||m.point[0]>bounds[2]||m.point[1]<bounds[1]||m.point[1]>bounds[3]))continue;
      result.push({point:m.point,angle});
    }
    return result;
  }
  function wrapText(text,measure,maxWidth=132){
    const lines=[];let remaining=String(text);
    while(remaining&&lines.length<2){
      if(measure(remaining)<=maxWidth){lines.push(remaining);break;}
      const chars=Array.from(remaining);let count=1;
      while(count<chars.length&&measure(chars.slice(0,count+1).join(''))<=maxWidth)count++;
      let line=chars.slice(0,count).join('');
      if(lines.length===1){while(line&&measure(line+'…')>maxWidth)line=Array.from(line).slice(0,-1).join('');lines.push(line+'…');break;}
      const space=line.lastIndexOf(' ');if(space>0){line=line.slice(0,space);count=Array.from(line).length;}
      lines.push(line);remaining=chars.slice(count).join('').trimStart();
    }
    return lines.length?lines:[''];
  }
  function overlaps(a,b){return a[0]<b[2]&&a[2]>b[0]&&a[1]<b[3]&&a[3]>b[1];}
  function rotatedBox(x,y,w,h,angle,pad=4){const c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));return [x-(w*c+h*s)/2-pad,y-(w*s+h*c)/2-pad,x+(w*c+h*s)/2+pad,y+(w*s+h*c)/2+pad];}
  function poi(label,object,scale,selected){
    const [icon,badge,color]=category(object.kind),chosen=object.id===selected;
    label(object.name||root.CitySpecialBuildings?.names[object.kind]||{park:'公园',plaza:'广场',school:'学校',clinic:'诊所'}[object.kind]||'公共设施',object.point,chosen?16:14,color,chosen?110:object.kind==='park'?65:55,'left',
      {kind:'poi',id:object.id,icon,badge,weight:600,selected:chosen});
  }
  function paint(ctx,state,{scale,inView,visible,label,selected,sourceParcel}){
    const fill=(points,color)=>{if(!points?.length)return;path(ctx,points,true);ctx.fillStyle=color;ctx.fill();};
    for(const p of state.parcels){
      if(!inView(p.points))continue;
      const b=p.building;
      if(p.use==='protected'||p.openSpace==='park')fill(p.points,palette.park);
      else if(b&&['commercial','office'].includes(b.use))fill(p.points,palette.commercial);
      else if(b&&['industrial','warehouse'].includes(b.use))fill(p.points,palette.industrial);
      if(b&&scale>=.075){fill(b.footprint,palette.building);ctx.strokeStyle=palette.buildingEdge;ctx.lineWidth=.6/scale;ctx.stroke();}
      if(b?.name&&(scale>=.85||p.id===selected)&&visible(b.center||p.center))label(b.name,b.center||p.center,11,palette.text,p.id===selected?115:16,'center',{kind:'building',id:p.id});
    }
    for(const f of state.facilities){
      if(f.points?!inView(f.points):!visible(f.point))continue;
      const green=f.kind==='park',campus=f.kind==='university';
      if(f.points)fill(f.points,green?palette.park:campus?'#e5ebd4':f.kind==='plaza'?'#ebe9e1':f.kind==='hospital'?'#f4e5e6':'#eae9e4');
      // Actual facility building footprints, without shadows, roof textures or extrusions.
      if(scale>=.16&&root.CitySpecialBuildings?.names[f.kind]){
        const layout=root.CitySpecialBuildings.layout(f);
        for(const surface of layout.surfaces||[]){
          if(!['grass','asphalt','paving'].includes(surface.material)||surface.w*scale<3||surface.d*scale<3)continue;
          const points=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>root.CitySpecialBuildings.world(f,surface.x+x*surface.w/2,surface.y+y*surface.d/2));
          fill(points,surface.material==='grass'?palette.park:surface.material==='asphalt'?'#d8dadd':'#e7e7e2');
        }
        for(const box of layout.boxes||[]){
          if(box.vehicle||box.z>1||box.w*scale<2||box.d*scale<2)continue;
          const points=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>root.CitySpecialBuildings.world(f,box.x+x*box.w/2,box.y+y*box.d/2));
          fill(points,palette.building);ctx.strokeStyle=palette.buildingEdge;ctx.lineWidth=.65/scale;ctx.stroke();
        }
      }
      if(f.id===selected||scale>=(f.kind==='plaza'&&(!f.name||f.nameSource==='generated')?1.8:f.blockCommon?.8:['airport','university','hospital','park','train_station'].includes(f.kind)?.07:.16)){
        if(visible(f.point))poi(label,f,scale,selected);
      }
    }
    // Walkways use their real paths and remain subordinate to the street network.
    if(scale>=.22)for(const walk of state.localPaths||[]){if(!inView(walk.points))continue;path(ctx,walk.points);ctx.strokeStyle='#ffffff';ctx.lineWidth=Math.max(1,Math.min(2.5,(walk.width||2)*scale))/scale;ctx.stroke();}
    let sorted=roadsCache.get(state.roads);
    if(!sorted){sorted=state.roads.slice().sort((a,b)=>(a.level||0)-(b.level||0)||(ranks[a.kind]||0)-(ranks[b.kind]||0));roadsCache.set(state.roads,sorted);}
    const roads=sorted.filter(r=>inView(r.points)).map(road=>({road,...roadStyle(road,scale,state.meta.roadTypes)})).filter(r=>r.visible);
    ctx.save();ctx.lineJoin='round';ctx.lineCap='round';
    for(const level of [...new Set(roads.map(r=>r.road.level||0))]){
      const group=roads.filter(r=>(r.road.level||0)===level&&!r.rail);
      for(const item of group){path(ctx,item.road.points);ctx.lineWidth=(item.width+(level>0?2.3:1.1))/scale;ctx.strokeStyle=item.edge;ctx.stroke();}
      for(const item of group){path(ctx,item.road.points);ctx.lineWidth=item.width/scale;ctx.strokeStyle=item.fill;ctx.stroke();}
      for(const item of roads.filter(r=>(r.road.level||0)===level&&r.rail)){
        path(ctx,item.road.points);ctx.lineWidth=2/scale;ctx.strokeStyle='#aeb6bb';ctx.stroke();
        ctx.setLineDash([3/scale,4/scale]);ctx.strokeStyle='#fafaf7';ctx.lineWidth=1/scale;ctx.stroke();ctx.setLineDash([]);
      }
    }
    if(root.RoadRenderer?.connections)for(const j of root.RoadRenderer.connections(state.roads,state.network,state.meta.roadTypes).joins){
      const ids=new Set(j.approaches.map(a=>a.road)),joined=roads.filter(r=>ids.has(r.road.id)&&!r.rail);
      ctx.save();ctx.beginPath();ctx.arc(...j.point,Math.max(j.extent,8/scale),0,Math.PI*2);ctx.clip();
      for(const item of joined){path(ctx,item.road.points);ctx.lineWidth=(item.width+1.1)/scale;ctx.strokeStyle=item.edge;ctx.stroke();}
      for(const item of joined){path(ctx,item.road.points);ctx.lineWidth=item.width/scale;ctx.strokeStyle=item.fill;ctx.stroke();}
      ctx.restore();
    }
    for(const {road,width,major,rail} of roads){
      if(road.id===selected){path(ctx,road.points);ctx.strokeStyle='#438de4';ctx.lineWidth=(width+2)/scale;ctx.stroke();}
      if(rail||scale<(major?.055:.16)||!road.name||road.name===state.meta.roadTypes[road.kind]?.name)continue;
      label(road.name,road.points[0],major?14:13,palette.text,major?48:34,'center',{kind:'road',points:road.points,id:road.id,weight:500});
    }
    ctx.restore();
    for(const p of state.parcels)if((p.id===selected||p.id===sourceParcel)&&inView(p.points)){
      path(ctx,p.points,true);ctx.fillStyle='#2189f018';ctx.fill();ctx.strokeStyle='#438de4';ctx.lineWidth=2/scale;ctx.stroke();
    }
    for(const f of state.facilities)if(f.id===selected&&f.points){path(ctx,f.points,true);ctx.strokeStyle='#438de4';ctx.lineWidth=2/scale;ctx.stroke();}
  }
  function paintLabels(ctx,labels,{scale,sy=scale,bounds,obstacles=[]}){
    const boxes=obstacles.slice(),placed=[],used=new Set();
    ctx.save();ctx.scale(1/scale,1/sy);ctx.textBaseline='middle';ctx.lineJoin='round';
    const screenBounds=bounds?.map((v,i)=>v*(i%2?sy:scale));
    for(const item of labels.slice().sort((a,b)=>b.priority-a.priority||String(a.id||a.text).localeCompare(String(b.id||b.text)))){
      ctx.font=`${item.weight||500} ${item.size}px ${font}`;
      const lines=['poi','building'].includes(item.kind)?wrapText(item.text,text=>ctx.measureText(text).width):[item.text];
      const width=Math.max(...lines.map(text=>ctx.measureText(text).width)),lineHeight=item.size+2,height=lineHeight*lines.length,x=item.point[0]*scale,y=item.point[1]*sy;
      let candidates;
      if(item.kind==='road'){
        if(used.has(item.text))continue;
        candidates=roadCandidates(item.points,scale,sy,width,screenBounds).map(c=>({...c,box:rotatedBox(...c.point,width,height,c.angle)}));
      }else if(item.kind==='poi'){
        candidates=[{dx:15,dy:0,align:'left'},{dx:-15,dy:0,align:'right'},{dx:0,dy:16+height/2,align:'center'},{dx:0,dy:-16-height/2,align:'center'}].map(c=>{
          const tx=x+c.dx,ty=y+c.dy,left=tx-(c.align==='center'?width/2:c.align==='right'?width:0);
          return {...c,point:[x,y],angle:0,box:[Math.min(x-12,left)-3,Math.min(y-12,ty-height/2)-3,Math.max(x+12,left+width)+3,Math.max(y+12,ty+height/2)+3]};
        });
      }else{
        const center=x+(item.align==='center'?0:width/2);candidates=[{point:[center,y],angle:0,box:rotatedBox(center,y,width,height,0,6)}];
      }
      const candidate=candidates.find(c=>(!screenBounds||c.box[0]>=screenBounds[0]+4&&c.box[1]>=screenBounds[1]+4&&c.box[2]<=screenBounds[2]-4&&c.box[3]<=screenBounds[3]-4)&&!boxes.some(b=>overlaps(c.box,b)));
      if(!candidate)continue;
      boxes.push(candidate.box);placed.push({id:item.id,kind:item.kind,text:item.text,box:candidate.box,angle:candidate.angle});
      if(item.kind==='road')used.add(item.text);
      ctx.save();ctx.translate(...candidate.point);ctx.rotate(candidate.angle);
      let tx=0,ty=0;ctx.textAlign='center';
      if(item.kind==='poi'){
        const radius=item.selected?12:10;
        ctx.beginPath();ctx.arc(0,0,radius,0,Math.PI*2);ctx.fillStyle=item.badge;ctx.fill();ctx.strokeStyle='#ffffff';ctx.lineWidth=1.5;ctx.stroke();
        let glyphs=iconsCache.get(item.icon);
        if(!glyphs&&root.CityMapIcons?.[item.icon]){glyphs=root.CityMapIcons[item.icon].map(d=>new Path2D(d));iconsCache.set(item.icon,glyphs);}
        if(glyphs){ctx.save();ctx.translate(-6,-6);ctx.scale(.75,.75);ctx.fillStyle='#ffffff';for(const glyph of glyphs)ctx.fill(glyph);ctx.restore();}
        tx=candidate.dx;ty=candidate.dy;ctx.textAlign=candidate.align;
      }
      ctx.strokeStyle='#fffffff2';ctx.lineWidth=item.kind==='poi'?3.5:3;ctx.fillStyle=item.color;
      lines.forEach((text,i)=>{const y=ty+(i-(lines.length-1)/2)*lineHeight;ctx.strokeText(text,tx,y);ctx.fillText(text,tx,y);});ctx.restore();
    }
    ctx.restore();return placed;
  }
  const api={palette,roadStyle,paint,paintLabels,poi,category,wrapText,sampleLine,roadCandidates,upright,rotatedBox,overlaps};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CityMapRenderer=api;
})(typeof window==='undefined'?{}:window);
