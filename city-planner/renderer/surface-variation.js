/* Deterministic, seamless material fields. Randomness belongs to world texture
 * space, so it neither swims with the camera nor changes when a save is loaded. */
(function(root){
  'use strict';
  function hash(n){n=Math.imul(n^(n>>>16),0x45d9f3b);n=Math.imul(n^(n>>>16),0x45d9f3b);return (n^(n>>>16))>>>0;}
  // Atlas cells sometimes contain a detached leaf from the next plant. Keep
  // the main connected silhouette plus its antialias fringe when sampling it.
  // This runs once per cached sprite, never in the frame's drawing loop.
  function isolateSprite(pixels,width,height){
    const count=width*height,labels=new Uint32Array(count),queue=new Int32Array(count);let label=0,largest=0,area=0;
    for(let start=0;start<count;start++){
      if(labels[start]||pixels[start*4+3]<24)continue;
      label++;let head=0,tail=1;queue[0]=start;labels[start]=label;
      while(head<tail){const pos=queue[head++],x=pos%width,y=Math.floor(pos/width);
        for(let yy=Math.max(0,y-1);yy<=Math.min(height-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(width-1,x+1);xx++){
          const next=yy*width+xx;if(!labels[next]&&pixels[next*4+3]>=24){labels[next]=label;queue[tail++]=next;}
        }
      }
      if(tail>area){area=tail;largest=label;}
    }
    if(!largest)return pixels;
    for(let pos=0;pos<count;pos++){
      if(labels[pos]===largest||!pixels[pos*4+3])continue;
      const x=pos%width,y=Math.floor(pos/width);let fringe=false;
      if(pixels[pos*4+3]<24)for(let yy=Math.max(0,y-1);yy<=Math.min(height-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(width-1,x+1);xx++)if(labels[yy*width+xx]===largest)fringe=true;
      if(!fringe)pixels[pos*4+3]=0;
    }
    return pixels;
  }
  function profile(name){
    const organic=['asphalt','grass','gravel','soil','roof','water'].includes(name);
    const pavers=name==='paving'||name==='pavingWarm',factor=name==='carPaint'?1:organic||pavers?8:4;
    return {factor,size:factor===1?256:factor*128,mode:pavers?'pavers':organic?'organic':'structured'};
  }
  function synthesize(source,sourceSize,name,variant,seed,meters){
    const {factor,size,mode}=profile(name);if(factor===1)return source.slice();
    const out=new Uint8ClampedArray(size*size*4),patch=128,n=size/patch,period=sourceSize;
    const mean=[0,0,0];for(let i=0;i<source.length;i+=4)for(let k=0;k<3;k++)mean[k]+=source[i+k]/(source.length/4);
    const shadeRange=name==='asphalt'?1.4:name==='grass'?3:5;
    const nodes=Array.from({length:n*n},(_,i)=>{const h=hash(seed+Math.imul(i+1,2654435761));return {x:h%period,y:(h>>>9)%period,r:(h>>>18)%4,shade:(((h>>>20)%256)/255-.5)*shadeRange};});
    const weight=Array.from({length:patch},(_,i)=>{const t=i/patch;return t*t*(3-2*t);});
    const cw=[1.6,.8,1.2,1.2,.6,.6,.9,1.2][variant%8],ch=[1.2,1.2,.6,.6,.6,.9,.9,.6][variant%8];
    const cols=Math.max(2,Math.round(meters*factor/cw)),rows=Math.max(2,Math.round(meters*factor/ch/2)*2),pw=size/cols,ph=size/rows;
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const ix=x>>7,iy=y>>7,fx=weight[x%patch],fy=weight[y%patch],ws=[(1-fx)*(1-fy),fx*(1-fy),(1-fx)*fy,fx*fy];
      const indices=[iy*n+ix,iy*n+(ix+1)%n,((iy+1)%n)*n+ix,((iy+1)%n)*n+(ix+1)%n];
      const rgb=[0,0,0],normal=mode==='structured'?1:1/Math.sqrt(ws.reduce((a,v)=>a+v*v,0));let shade=0;
      for(let j=0;j<4;j++){
        const node=nodes[indices[j]];let u=x*2,v=y*2;
        if(mode!=='structured'){
          if(node.r===1){const q=u;u=-v;v=q;}else if(node.r===2){u=-u;v=-v;}else if(node.r===3){const q=u;u=v;v=-q;}
          u+=node.x;v+=node.y;
        }
        u=((u%period)+period)%period;v=((v%period)+period)%period;const pos=(v*period+u)*4;
        for(let k=0;k<3;k++)rgb[k]+=(source[pos+k]-mean[k])*ws[j];
        shade+=node.shade*ws[j];
      }
      let joint=0,paverTone=0,bevel=0;
      if(mode==='pavers'){
        const row=Math.floor(y/ph),xx=x+(variant%2&&row%2?pw/2:0),col=Math.floor(xx/pw)%cols;
        const dx=Math.min(xx%pw,pw-xx%pw),dy=Math.min(y%ph,ph-y%ph);
        joint=Math.max(0,1-Math.min(dx,dy)/.5);
        bevel=Math.max(0,1-Math.abs(Math.min(xx%pw,y%ph)-.8)/.55);
        paverTone=(hash(seed+row*cols+col)%1000/999-.5)*8;
      }
      const dest=(y*size+x)*4;
      for(let k=0;k<3;k++)out[dest+k]=mean[k]+rgb[k]*normal*(mode==='pavers'?.46:1)+shade+paverTone-joint*15+bevel*4;
      out[dest+3]=255;
    }
    return out;
  }
  // De-correlate neighbouring vehicle IDs without changing a vehicle on reload.
  const fleet=[0,0,1,2,2,3,4,4,5,5,6,7,8,9,10,11,11,12,13,14,15,15];
  const vehicleColors=['#e7e9e2','#a64036','#314b64','#b9a15b','#afb9bc','#424b51','#e2e5de','#42738d','#4b6756','#773f45','#c8bda0','#30383f','#d9ded9','#aab5b6','#e0e3d9','#436277'];
  // Dimensions are visual scene proportions, not a vehicle specification table.
  const realVehicles=[
    ['xpeng-p7-silver','小鹏 P7 · 银',4.9,1.9,'#bec8cc'],['xiaomi-su7-blue','小米 SU7 · 蓝',5,1.96,'#37a8b5'],
    ['xpeng-p7-green','小鹏 P7 · 绿',4.9,1.9,'#285f4e'],['xiaomi-su7-purple','小米 SU7 · 紫',5,1.96,'#7964a4'],
    ['tesla-model-3','Model 3',4.7,1.85,'#eef0eb'],['byd-han','比亚迪 汉',5,1.91,'#303736'],
    ['nio-et5','蔚来 ET5',4.8,1.96,'#e1e5df'],['zeekr-007','极氪 007',4.9,1.9,'#9eb8ca'],
    ['toyota-camry','凯美瑞',4.9,1.85,'#c0c6cb'],['honda-accord','雅阁',5,1.86,'#737b84'],
    ['bmw-3','宝马 3 系',4.8,1.83,'#285888'],['mercedes-c','奔驰 C 级',4.8,1.82,'#252d34'],
    ['audi-a4','奥迪 A4',4.8,1.85,'#343c43'],['vw-passat','帕萨特',4.9,1.84,'#eaeeeb'],
    ['porsche-taycan','Taycan',5,1.96,'#a6bfaa'],['mini-cooper','MINI Cooper',3.9,1.75,'#b8342f']
  ].map(([id,name,length,width,color],cell)=>({id,name,length,width,color,cell}));
  const sportVehicles=[
    ['bmw-z4-red','宝马 Z4 · 红',4.32,1.98,'#b5232d'],['bmw-z4-blue','宝马 Z4 · 蓝',4.32,1.98,'#1752b0'],
    ['dodge-challenger-orange','道奇挑战者 · 橙',5.03,2.02,'#dd641f'],['dodge-challenger-purple','道奇挑战者 · 紫',5.03,2.02,'#70328e']
  ].map(([id,name,length,width,color],cell)=>({id,name,length,width,color,cell}));
  const vehicleAtlases={vehicles:{columns:4,rows:4},'vehicles-real':{columns:4,rows:4},'vehicles-sport':{columns:2,rows:2}};
  function vehicle(id){
    const n=hash((Number(id)||0)+873),cell=fleet[n%fleet.length],sportSeed=hash(n^0x6f2d391b);
    const sport=sportSeed%10===0?sportVehicles[(sportSeed>>>8)%sportVehicles.length]:null;
    // Adding an occasional sports car does not reshuffle the existing atlas
    // choices for the rest of the fleet or affect traffic simulation geometry.
    const real=(n>>>31)===0?realVehicles[(n>>>8)%realVehicles.length]:null,model=sport||real;
    return {cell,color:model?.color||vehicleColors[cell],length:model?.length||(cell>=12?5.2:cell===6||cell===7?4.8:4.4+(cell%3)*.15),width:model?.width||(cell>=12?1.92:1.74+(cell%3)*.055),scale:.97+(n>>>12)%7*.01,spriteAtlas:sport?'vehicles-sport':real?'vehicles-real':'vehicles',spriteCell:model?.cell??cell,model:model?.id||'generic-'+cell};
  }
  function vehiclePaint(style){
    const hex=(style.color||'#808080').slice(1),rgb=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16));
    const mean=(rgb[0]+rgb[1]+rgb[2])/3,hue=rgb.map(v=>v-mean),chroma=Math.max(...rgb)-Math.min(...rgb);
    return {hue,hueLength:Math.hypot(...hue),white:mean>165&&chroma<48,roadster:style.model?.startsWith('bmw-z4')};
  }
  function paintWeight(r,g,b,x,y,paint){
    const light=.2126*r+.7152*g+.0722*b,chroma=Math.max(r,g,b)-Math.min(r,g,b),side=Math.abs(x*2-1);
    if(light<22)return 0; // Tyres, grilles, and deep interior retain their detail.
    if((y<.15||y>.9)&&side>.55&&(light>165||r>g*1.65&&r>b*1.65))return .03; // Lamps.
    if(side<.68&&((y>.23&&y<.39)||(y>.69&&y<.85)))return .08; // Glass, not body paint.
    if(paint.roadster&&side<.72&&y>.34&&y<.77)return .04;
    const mean=(r+g+b)/3,hue=[r-mean,g-mean,b-mean],hueLength=Math.hypot(...hue);
    const match=paint.hueLength>25&&hueLength>18?(hue[0]*paint.hue[0]+hue[1]*paint.hue[1]+hue[2]*paint.hue[2])/(hueLength*paint.hueLength):0;
    if(match>.72&&chroma>25)return Math.min(1,.55+(match-.72)*2);
    if(side>.63||y<.23||y>.85)return .82;
    // White/silver roofs remain paint; a panoramic roof stays dark glass.
    return light>150&&chroma<65?.8:light>95&&chroma<40?.36:.08;
  }
  // Remove narrow studio-light peaks, not the car's colour or broad shading.
  // Alpha and dark glass are preserved. An alpha-weighted neighbourhood keeps
  // transparent atlas padding out of the exposure estimate. Once per sprite.
  function vehicleDiffuse(source,width,height,style){
    const output=source.slice(),stride=width+1,count=stride*(height+1),sums=Array.from({length:4},()=>new Float64Array(count));
    const paint=vehiclePaint(style),radius=Math.max(3,Math.round(width*.065));
    for(let y=0;y<height;y++){
      const row=[0,0,0,0];
      for(let x=0;x<width;x++){
        const p=(y*width+x)*4,a=source[p+3]/255,q=(y+1)*stride+x+1;
        row[3]+=a;for(let k=0;k<3;k++)row[k]+=source[p+k]*a;
        for(let k=0;k<4;k++)sums[k][q]=sums[k][q-stride]+row[k];
      }
    }
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const p=(y*width+x)*4;if(source[p+3]<24)continue;
      const r=source[p],g=source[p+1],b=source[p+2],light=.2126*r+.7152*g+.0722*b;
      if(light<130)continue;
      const x0=Math.max(0,x-radius),x1=Math.min(width,x+radius+1),y0=Math.max(0,y-radius),y1=Math.min(height,y+radius+1);
      const a=y0*stride+x0,bottom=y1*stride+x0,c=y0*stride+x1,d=y1*stride+x1,mean=[];
      const weight=sums[3][d]-sums[3][bottom]-sums[3][c]+sums[3][a];
      if(weight<1)continue;
      for(let k=0;k<3;k++)mean[k]=(sums[k][d]-sums[k][bottom]-sums[k][c]+sums[k][a])/weight;
      const peak=light-(.2126*mean[0]+.7152*mean[1]+.0722*mean[2]);
      // Compress only a locally narrow, neutral-white spike. Coloured shoulder
      // reflections and smooth curved-panel gradients carry the body's volume.
      const neutralExcess=Math.min(r,g,b)-Math.min(...mean),spike=Math.max(0,Math.min(1,(neutralExcess-20)/80));
      const amount=Math.min(.56,Math.max(0,(peak-24)/100))*spike*paintWeight(r,g,b,x/(width-1),y/(height-1),paint)*(paint.white?.18:.8);
      for(let k=0;k<3;k++)output[p+k]=source[p+k]+(mean[k]-source[p+k])*amount;
    }
    return output;
  }
  // Four translucent light fields, not four copies of the car. They only
  // affect opaque paint, so blending cannot thicken an antialiased silhouette
  // or expose the road through two partially transparent vehicle images.
  function vehicleLightFields(source,width,height,style){
    const out=new Uint8ClampedArray(width*height*16),paint=vehiclePaint(style),stride=width*2;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const p=(y*width+x)*4,a=Math.max(0,(source[p+3]-240)/15);if(!a)continue;
      const px=x/(width-1),py=y/(height-1),nx=px*2-1,ny=py*2-1;
      const weight=paintWeight(source[p],source[p+1],source[p+2],px,py,paint)*a;
      // Crown the shoulders inside the silhouette instead of shading hardest
      // at its outer edge, which produced a dark cutout border at map scale.
      const normals=[Math.sign(nx)*Math.sin(Math.abs(nx)*Math.PI*.82)*.86,Math.sign(ny)*Math.sin(Math.abs(ny)*Math.PI*.7)*.46];
      for(let cell=0;cell<4;cell++){
        const dot=normals[cell>>1]*(cell%2?-1:1),q=((y+(cell>>1)*height)*stride+x+(cell%2)*width)*4;
        const rgb=dot>0?[245,242,226]:[20,31,38];
        out[q]=rgb[0];out[q+1]=rgb[1];out[q+2]=rgb[2];out[q+3]=Math.abs(dot)*weight*.18*255;
      }
    }
    return out;
  }
  function vehicleLightWeights(heading,light){
    const angle=light.azimuth*Math.PI/180-heading-Math.PI/2;
    const direct=Math.max(0,Math.min(1,light.strength/.28))*Math.cos(Math.max(0,light.elevation)*Math.PI/180);
    return [Math.cos(angle)*direct,Math.sin(angle)*direct];
  }
  const api={hash,isolateSprite,profile,synthesize,vehicle,vehicleDiffuse,vehicleLightFields,vehicleLightWeights,realVehicles,sportVehicles,vehicleAtlases};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SurfaceVariation=api;
})(typeof window==='undefined'?{}:window);
