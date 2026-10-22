/* Distinct metric architecture for automatically sited civic buildings. */
(function(root){
  'use strict';
  const names={sports_arena:'体育馆',university:'大学校园',hospital:'医院',city_hall:'市政厅',fire_station:'消防局',police_station:'警察局',hotel:'酒店',gas_station:'加油站',charging_station:'充电站',museum:'博物馆',theater:'剧院',cinema:'电影院',convention_center:'会展中心',industrial_plant:'工业厂区',power_plant:'发电厂',substation:'变电站',water_plant:'自来水厂',sewage_plant:'污水处理厂',recycling_center:'垃圾回收处理中心',logistics_hub:'物流中心'};
  const detailing=typeof module!=='undefined'&&module.exports?require('./civic-details.js'):root.CityCivicDetails;
  function populate(f,out,api){
    const {surface,box,line,label,lamp,hull}=api,w=f.width,d=f.depth,h=f.height,v=f.variant||0;
    const X=x=>x*w,Y=y=>y*d;
    const pad=(x,y,a,b,mat='paving',color=null,z=0)=>surface(X(x),Y(y),X(a),Y(b),mat,color,z);
    const block=(x,y,z,a,b,height,mat='facade',color=null,top='roof')=>box(X(x),Y(y),z,X(a),Y(b),height,mat,top,color);
    const stroke=(pts,width=.25,color='#e9e4ce')=>line(pts.map(([x,y])=>[X(x),Y(y)]),width,color);
    const disc=(x,y,rx,ry,z,height,color)=>hull(X(x),Y(y),z,height,Array.from({length:24},(_,i)=>[Math.cos(i*Math.PI/12)*X(rx),Math.sin(i*Math.PI/12)*Y(ry)]),color);
    const facade=(x,y,a,b,height,color='#bec7c3',floors=3)=>{
      block(x,y,0,a,b,height,'facade',color);
      out.boxes.at(-1).architecture={floors,color};
    };
    const trees=(xs,y)=>{for(const x of xs)out.trees.push({x:X(x),y:Y(y),radius:Math.min(2.4,w*.023),height:5.5,variant:[9,10,18][v%3]});};
    const yard=()=>{pad(0,0,1,1,'paving');pad(0,-.43,.94,.09,'asphalt');for(const x of [-.43,.43])lamp(X(x),Y(-.39));};
    yard();
    if(f.kind==='sports_arena'){
      pad(0,0,.9,.8,'grass');
      // Separate convex ring panels form an oval bowl with a visible court.
      for(let i=0;i<32;i++){
        const a=i*Math.PI/16,b=(i+1)*Math.PI/16;
        for(let tier=0;tier<3;tier++){
          const outer=.45-tier*.065,inner=outer-.06;
          hull(0,0,tier*3+3,4,[[Math.cos(a)*w*outer,Math.sin(a)*d*outer],[Math.cos(b)*w*outer,Math.sin(b)*d*outer],[Math.cos(b)*w*inner,Math.sin(b)*d*inner],[Math.cos(a)*w*inner,Math.sin(a)*d*inner]],['#a6b5bd','#6c8e9e','#d0c7b5'][tier]);
        }
        if(i%2===0)block(Math.cos(a)*.425,Math.sin(a)*.425,0,.008,.008,h*.7,'metal');
      }
      pad(0,0,.39,.39,'paving','#b18b63');stroke([[-.195,-.195],[.195,-.195],[.195,.195],[-.195,.195],[-.195,-.195]],.35);stroke([[0,-.195],[0,.195]],.3);
      block(0,-.33,h*.55,.6,.16,1.4,'metal','#d0d8d8');block(0,.33,h*.55,.6,.16,1.4,'metal','#d0d8d8');
      facade(0,-.37,.28,.12,7,'#b8beb8',1);
      disc(0,0,.345,.345,h*.58,2.4,'#b9c7cc');disc(0,0,.28,.28,h*.58+2.4,1.8,'#c6d0d0');disc(0,0,.20,.20,h*.58+4.2,1.3,'#7695a0');
    }else if(f.kind==='university'){
      pad(0,0,1,1,'grass');pad(0,-.1,.10,.8);pad(0,-.4,.88,.08);
      if(v===0)for(const x of [-.3,.3])for(const y of [-.18,.12])facade(x,y,.28,.14,14,'#b8ac91',3);
      else if(v===1)for(const x of [-.30,.30])facade(x,-.03,.22,.46,18,'#b8ac91',4);
      else{for(const x of [-.30,.30])facade(x,-.02,.22,.40,12,'#b8ac91',3);facade(0,-.18,.42,.13,12,'#b8ac91',3);}
      facade(0,.28,.24,.2,h,'#c7ccc4',4);block(0,.28,h,.28,.24,1,'metal');
      pad(-.29,.34,.24,.19,'paving','#b77962');pad(-.29,.34,.17,.13,'grass','#668b68');stroke([[-.375,.275],[-.205,.275],[-.205,.405],[-.375,.405],[-.375,.275]],.3);
      trees([-.42,-.17,.17,.42],-.34);trees([-.12,.12],.05);
      block(-.08,-.43,0,.015,.015,7,'facade');block(.08,-.43,0,.015,.015,7,'facade');block(0,-.43,6,.18,.02,1,'metal');
    }else if(f.kind==='hospital'){
      if(v===0){facade(0,.08,.64,.35,h,'#d6ded9',8);facade(-.30,-.08,.18,.43,h*.55,'#cbd3cc',4);facade(.30,-.08,.18,.43,h*.55,'#cbd3cc',4);}
      else if(v===1){facade(0,.08,.70,.38,h*.42,'#d6ded9',3);facade(-.24,.08,.20,.30,h,'#cbd3cc',8);facade(.24,.08,.20,.30,h,'#cbd3cc',8);}
      else{facade(0,.08,.68,.35,h,'#d6ded9',8);facade(-.26,-.11,.22,.44,h*.55,'#cbd3cc',4);}
      block(0,-.2,0,.5,.17,7,'glass');block(0,-.25,7,.56,.2,.8,'metal','#cfdddd');
      block(v===1?-.24:0,.08,h,.13,.04,.2,'paving','#d83232');block(v===1?-.24:0,.08,h,.04,.13,.2,'paving','#d83232');
      label('急诊',X(.29),Y(-.32),3.5,'#9f5548');pad(.28,-.36,.22,.07,'asphalt');
      for(const x of [.23,.32]){box(X(x),Y(-.35),0,2.5,5,2.3,'carPaint','carPaint','#e1e5dc');box(X(x),Y(-.35),2.3,1.8,.4,.15,'carPaint','carPaint','#b55348');}
      trees([-.42,.42],.34);
    }else if(f.kind==='city_hall'){
      facade(0,.12,.65,.4,17,'#c8c2ac',3);
      if(v===0)facade(0,.12,.22,.25,h,'#d8d1ba',4);
      else if(v===1){facade(-.24,.12,.15,.27,h,'#d8d1ba',4);facade(.24,.12,.15,.27,h,'#d8d1ba',4);}
      else{facade(0,.12,.40,.25,h*.78,'#d8d1ba',3);disc(0,.12,.10,.13,h*.78,h*.22,'#74978e');}
      for(let i=-3;i<=3;i++)block(i*.075,-.12,0,.022,.025,12,'facade','#e3dfcf');
      block(0,-.13,12,.6,.12,1.8,'paving','#c6c4b7');
      for(let i=0;i<4;i++)block(0,-.22-i*.025,0,.61+i*.025,.025,1.5-i*.3,'paving');
      disc(.32,.35,.06,.07,0,.8,'#849a9b');disc(.32,.35,.05,.06,.8,.1,'#5b919f');trees([-.4,-.2,.2,.4],-.35);
    }else if(f.kind==='fire_station'||f.kind==='police_station'){
      const fire=f.kind==='fire_station',color=fire?'#b27c63':'#bbc8ce';
      facade(-.22,.08,v===1?.24:.32,.5,v===2?h*.72:h,color,3);facade(.19,.18,.43,.3,v===1?11:7,color,v===1?2:1);
      if(v===2)facade(.20,.32,.40,.16,h*.85,color,3);
      for(let i=0;i<3;i++){
        block(.04+i*.15,.025,0,.105,.01,4.8,'metal',fire?'#9b5446':'#587786');
        box(X(.04+i*.15),Y(-.12),.2,fire?2.6:2,fire?6:4.6,fire?2.5:1.5,'carPaint','carPaint',fire?'#a44335':'#e0e5df');
        box(X(.04+i*.15),Y(-.12),fire?2.7:1.7,1.5,.35,.2,'carPaint','carPaint','#466e94');
      }
      if(fire)facade(-.37,.3,.12,.13,h,'#af9e8c',5);
    }else if(f.kind==='hotel'){
      facade(0,.1,.6,.48,8,'#c7bdad',1);if(v===1){facade(-.20,.12,.20,.28,h,'#9eafb7',11);facade(.20,.12,.20,.28,h*.82,'#9eafb7',9);}
      else{facade(0,.12,v===2?.58:.42,.28,h,'#9eafb7',11);if(v===2)facade(-.24,.02,.16,.38,h*.7,'#9eafb7',7);}
      block(0,-.2,5,.55,.15,1,'metal','#bdb49d');
      for(const x of [-.24,.24])block(x,-.23,0,.015,.015,5,'metal');
      pad(.31,.28,.16,.22,'paving','#729ea8');trees([-.36,.36],-.32);
    }else if(f.kind==='gas_station'||f.kind==='charging_station'){
      const fuel=f.kind==='gas_station';facade(v===2?-.12:0,.33,v===1?.42:.64,.2,v===1?7:4.5,'#c1c7bd',v===1?2:1);
      if(fuel){
        block(0,-.02,5.4,.78,.42,1.1,'metal','#c4cbbf');block(0,-.23,5.4,.78,.015,.65,'carPaint','#aa6652');
        for(const x of [-.25,0,.25]){block(x,-.02,0,.012,.20,.25,'paving');for(const y of [-.12,.08]){block(x,y,0,.018,.018,5.4,'metal');block(x,y,.2,.045,.045,1.6,'metal','#b4bdb5');}}
      }else{
        for(const y of [-.21,.12])for(let i=0;i<Math.floor(w*.8/3)+1;i++){
          const x=-w*.4+i*3;box(x,Y(y),0,.7,.5,1.65,'metal','metal','#d0d7d0');box(x,Y(y)-.3,1.1,.4,.05,.4,'glass','glass');
          line([[x-1.2,Y(y)-1],[x-1.2,Y(y)-6],[x+1.2,Y(y)-6]],.12,'#a4c3ae');
        }
        block(0,.12,3.6,.86,.22,.3,'metal','#42637a');for(const x of [-.35,.35])block(x,.12,0,.014,.014,3.6,'metal');
      }
      block(-.43,-.33,0,.025,.025,6,'metal');block(-.43,-.33,4,.09,.025,2,'carPaint',fuel?'#af7351':'#4d8d7b');
    }else if(f.kind==='museum'){
      facade(-.22,.1,v===1?.25:.35,.5,h*.7,'#cfbca0',2);facade(.23,.12,.33,.37,h,'#aeb7b4',2);
      if(v===1)facade(-.22,.29,.45,.14,h*.9,'#cfbca0',3);
      if(v===2)disc(-.22,.1,.13,.20,h*.7,h*.2,'#799c96');
      block(0,-.04,0,.18,.25,h*.65,'glass');
      for(let i=0;i<6;i++)block(-.35+i*.055,.1,h*.7,.018,.49,1.8,'metal','#c5b390');
      disc(.12,-.28,.045,.05,0,2,'#979b94');disc(.12,-.28,.02,.025,2,5,'#537b81');trees([-.36,.35],-.29);
    }else if(f.kind==='theater'){
      // Convex stepped roof segments make the performance hall legible.
      for(let i=0;i<5;i++){
        const x=(-.32+i*.16)*w,hh=h*(.65+.35*Math.sin((i+1)*Math.PI/6));
        hull(x,0,0,hh,[[-w*.09,-d*.25],[w*.09,-d*.2],[w*.09,d*.3],[-w*.09,d*.25]],['#b8c6c9','#bdc7bf','#c9bfae'][v]);
      }
      facade(0,-.25,.74,.15,8,'#708d98',1);block(0,-.32,8,.84,.15,.7,'metal');
      trees([-.42,.42],-.25);
    }else if(f.kind==='cinema'){
      facade(0,.1,.8,.6,h,'#8b8e8d',2);
      if(v===1)facade(-.20,.13,.32,.42,h*1.18,'#8b8e8d',3);
      if(v===2){facade(-.24,.13,.22,.38,h*1.15,'#8b8e8d',3);facade(.24,.13,.22,.38,h*1.15,'#8b8e8d',3);}block(0,-.24,4.5,.85,.13,.7,'metal','#b19066');
      for(let i=-2;i<=2;i++)block(i*.14,-.205,6,.095,.01,4,'carPaint',['#a97253','#566f89','#b1a17e'][(i+5+v)%3]);
      facade(0,-.22,.5,.08,4.5,'#77929b',1);
    }else if(f.kind==='convention_center'){
      for(const x of [-.28,0,.28]){
        facade(x,.1,.25,.6,15,'#b5c3c4',2);
        for(let i=0;i<5;i++)block(x+(i-2)*.048,.1,15,.05,.62,Math.sin((i+1)*Math.PI/6)*(h-15),'metal','#cbd2cb');
      }
      facade(0,-.26,.88,.14,9,'#799aa5',1);pad(0,-.36,.9,.08);
      for(const x of [-.42,-.2,.2,.42])lamp(X(x),Y(-.33));
    }else if(f.kind==='industrial_plant'||f.kind==='logistics_hub'||f.kind==='recycling_center'){
      const industrial=f.kind==='industrial_plant',recycling=f.kind==='recycling_center';
      facade(-.08,.1,.66,.5,h*.7,'#aeb7b2',2);
      if(v===1)facade(-.08,.25,.66,.16,h*.95,'#aeb7b2',3);
      if(v===2)for(const x of [-.28,.12])facade(x,.1,.19,.48,h*.9,'#aeb7b2',3);facade(.34,.23,.15,.25,9,'#bbbeaf',2);
      for(let i=0;i<7;i++){block(-.35+i*.085,.1,h*.7,.025,.5,1.2,'metal','#d1d3c6');block(-.34+i*.085,-.16,0,.05,.015,4,'metal','#6e7a7d');}
      for(let i=0;i<4;i++){box(X(-.3+i*.17),Y(-.25),.4,2.8,10,3.3,'metal','metal',['#a47753','#6b8c91','#9c9c80'][i%3]);}
      if(industrial){for(const x of [.28,.39])disc(x,-.06,.034,.045,0,h,'#aab3b1');}
      if(recycling){for(const x of [-.3,-.12,.06,.24])block(x,.41,0,.13,.1,3,'metal',['#708d72','#a8a16f','#8c9e9e'][v]);}
    }else if(f.kind==='power_plant'){
      facade(-.23,.08,.32,.54,18,'#a8b0a6',3);if(v>0)facade(-.23,.08,v===1?.20:.28,v===1?.48:.23,24+v*3,'#a8b0a6',4);
      for(const y of [-.14,.22]){
        disc(.19,y,.12,.15,0,8,'#b5b8aa');disc(.19,y,.105,.13,8,13,'#c1c3b7');disc(.19,y,.08,.10,21,10,'#b3b9b0');disc(.19,y,.09,.11,31,1,'#84928d');
      }
      for(const x of [-.35,-.15]){disc(x,.34,.024,.03,0,h,'#b2ada0');disc(x,.34,.025,.031,h-5,2,'#aa7862');}
    }else if(f.kind==='substation'){
      facade(-.31,.24,.22,.26,v===1?10:6,'#adb5a9',v===1?2:1);if(v===2)facade(-.31,-.05,.22,.22,6,'#adb5a9',1);
      for(const x of [-.1,.15,.35])for(const y of [-.18,.17]){
        block(x,y,0,.12,.14,3,'metal','#8f9c9b');for(const dx of [-.035,.035])disc(x+dx,y,.012,.016,3,2,'#9c8065');
      }
      for(const y of [-.28,.32]){for(const x of [-.2,.12,.4])block(x,y,0,.012,.012,h,'metal');block(.10,y,h-.4,.62,.015,.4,'metal');}
    }else if(f.kind==='water_plant'||f.kind==='sewage_plant'){
      const sewage=f.kind==='sewage_plant';facade(-.3,.1,.25,.6,v===1?16:10,'#b6bdaf',v===1?3:2);if(v===2)facade(-.3,.26,.32,.25,16,'#b6bdaf',3);
      for(const x of [0,.29])for(const y of [-.14,.22]){
        disc(x,y,.115,.145,0,2.4,'#b8beb2');disc(x,y,.10,.128,2.4,.1,sewage?'#6e8d81':'#739aa8');
        block(x,y,2.5,.22,.012,.4,'metal','#b8c3be');disc(x,y,.01,.014,2.5,.7,'#a9b7b5');
      }
      if(!sewage){block(-.32,.12,10,.035,.035,h-10,'metal');}
    }
    for(const x of [-.44,.44])lamp(X(x),Y(.38));
    detailing.refine(f,out);
  }
  const api={names,populate};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CityCivicBuildings=api;
})(typeof window==='undefined'?{}:window);
