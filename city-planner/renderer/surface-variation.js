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
    const organic=['asphalt','grass','gravel','soil','roof','water','siteGround','excavation'].includes(name);
    const pavers=name==='paving'||name==='pavingWarm',factor=name==='carPaint'?1:organic||pavers?8:4;
    return {factor,size:factor===1?256:factor*128,mode:pavers?'pavers':organic?'organic':'structured'};
  }
  let synthesisWeights=null;
  function blendWeights(){
    if(synthesisWeights)return synthesisWeights;
    // Every field repeats the same 128-square interpolation phase. Float64
    // keeps the original arithmetic, including its final byte-rounding ties.
    const phase=new Float64Array(128),table=new Float64Array(128*128*5);
    for(let i=0;i<128;i++){const t=i/128;phase[i]=t*t*(3-2*t);}
    for(let y=0;y<128;y++)for(let x=0;x<128;x++){
      const fx=phase[x],fy=phase[y],i=(y*128+x)*5;
      const a=(1-fx)*(1-fy),b=fx*(1-fy),c=(1-fx)*fy,d=fx*fy;
      let sum=0;sum+=a*a;sum+=b*b;sum+=c*c;sum+=d*d;
      table[i]=a;table[i+1]=b;table[i+2]=c;table[i+3]=d;table[i+4]=1/Math.sqrt(sum);
    }
    synthesisWeights=table;return table;
  }
  function synthesize(source,sourceSize,name,variant,seed,meters){
    const {factor,size,mode}=profile(name);if(factor===1)return source.slice();
    const out=new Uint8ClampedArray(size*size*4),patch=128,n=size/patch,period=sourceSize,weights=blendWeights();
    const structured=mode==='structured',pavers=mode==='pavers',gain=pavers?.46:1,pixels=source.length/4;
    let meanR=0,meanG=0,meanB=0;
    for(let i=0;i<source.length;i+=4){meanR+=source[i]/pixels;meanG+=source[i+1]/pixels;meanB+=source[i+2]/pixels;}
    const shadeRange=name==='asphalt'?1.4:name==='grass'?3:5;
    const nodes=Array.from({length:n*n},(_,i)=>{const h=hash(seed+Math.imul(i+1,2654435761));return {x:h%period,y:(h>>>9)%period,r:(h>>>18)%4,shade:(((h>>>20)%256)/255-.5)*shadeRange};});
    // A rotated sample address is separable into one X and one Y lookup. This
    // handles arbitrary source sizes and removes four rotations and sixteen
    // remainder operations from every output pixel.
    for(let i=0;i<nodes.length;i++){
      const node=nodes[i];
      if(structured&&i){node.xs=nodes[0].xs;node.ys=nodes[0].ys;continue;}
      const swap=!structured&&(node.r===1||node.r===3),xs=node.xs=new Uint32Array(size),ys=node.ys=new Uint32Array(size);
      const xSign=!structured&&(node.r===2||node.r===3)?-1:1,ySign=!structured&&(node.r===1||node.r===2)?-1:1;
      const xOffset=structured?0:swap?node.y:node.x,yOffset=structured?0:swap?node.x:node.y;
      const xStride=swap?period*4:4,yStride=swap?4:period*4;
      for(let at=0;at<size;at++){
        const x=xSign*at*2+xOffset,y=ySign*at*2+yOffset;
        xs[at]=((x%period)+period)%period*xStride;ys[at]=((y%period)+period)%period*yStride;
      }
    }
    let cols=0,even=null,odd=null,rowIds=null,yRemainders=null,yDistances=null,tones=null;
    if(pavers){
      const cw=[1.6,.8,1.2,1.2,.6,.6,.9,1.2][variant%8],ch=[1.2,1.2,.6,.6,.6,.9,.9,.6][variant%8];
      cols=Math.max(2,Math.round(meters*factor/cw));const rows=Math.max(2,Math.round(meters*factor/ch/2)*2),pw=size/cols,ph=size/rows;
      const columns=shift=>{
        const ids=new Uint32Array(size),remainders=new Float64Array(size),distances=new Float64Array(size);
        for(let x=0;x<size;x++){const xx=x+shift,r=xx%pw;ids[x]=Math.floor(xx/pw)%cols;remainders[x]=r;distances[x]=Math.min(r,pw-r);}
        return {ids,remainders,distances};
      };
      even=columns(0);odd=variant%2?columns(pw/2):even;
      rowIds=new Uint32Array(size);yRemainders=new Float64Array(size);yDistances=new Float64Array(size);
      for(let y=0;y<size;y++){const r=y%ph;rowIds[y]=Math.floor(y/ph);yRemainders[y]=r;yDistances[y]=Math.min(r,ph-r);}
      tones=new Float64Array(rows*cols);
      for(let row=0;row<rows;row++)for(let col=0;col<cols;col++)tones[row*cols+col]=(hash(seed+row*cols+col)%1000/999-.5)*8;
    }
    for(let iy=0;iy<n;iy++)for(let ix=0;ix<n;ix++){
      const nextX=(ix+1)%n,nextY=(iy+1)%n,a=nodes[iy*n+ix],b=nodes[iy*n+nextX],c=nodes[nextY*n+ix],d=nodes[nextY*n+nextX];
      const x0=ix*patch,x1=x0+patch;
      for(let localY=0;localY<patch;localY++){
        const y=iy*patch+localY,ay=a.ys[y],by=b.ys[y],cy=c.ys[y],dy=d.ys[y];
        const row=pavers?rowIds[y]:0,columns=pavers&&(variant%2&&row%2)?odd:even;
        const rowOffset=row*cols,yRemainder=pavers?yRemainders[y]:0,yDistance=pavers?yDistances[y]:0;
        let wi=localY*patch*5,dest=(y*size+x0)*4;
        for(let x=x0;x<x1;x++,wi+=5,dest+=4){
          const w0=weights[wi],w1=weights[wi+1],w2=weights[wi+2],w3=weights[wi+3],normal=structured?1:weights[wi+4];
          const p0=a.xs[x]+ay,p1=b.xs[x]+by,p2=c.xs[x]+cy,p3=d.xs[x]+dy;
          // Preserve the four-sample addition order: regrouping these terms
          // can change a clamped byte at a half-integer rounding boundary.
          let r=0,g=0,blue=0,shade=0;
          r+=(source[p0]-meanR)*w0;g+=(source[p0+1]-meanG)*w0;blue+=(source[p0+2]-meanB)*w0;shade+=a.shade*w0;
          r+=(source[p1]-meanR)*w1;g+=(source[p1+1]-meanG)*w1;blue+=(source[p1+2]-meanB)*w1;shade+=b.shade*w1;
          r+=(source[p2]-meanR)*w2;g+=(source[p2+1]-meanG)*w2;blue+=(source[p2+2]-meanB)*w2;shade+=c.shade*w2;
          r+=(source[p3]-meanR)*w3;g+=(source[p3+1]-meanG)*w3;blue+=(source[p3+2]-meanB)*w3;shade+=d.shade*w3;
          let joint=0,paverTone=0,bevel=0;
          if(pavers){
            joint=Math.max(0,1-Math.min(columns.distances[x],yDistance)/.5);
            bevel=Math.max(0,1-Math.abs(Math.min(columns.remainders[x],yRemainder)-.8)/.55);
            paverTone=tones[rowOffset+columns.ids[x]];
          }
          out[dest]=meanR+r*normal*gain+shade+paverTone-joint*15+bevel*4;
          out[dest+1]=meanG+g*normal*gain+shade+paverTone-joint*15+bevel*4;
          out[dest+2]=meanB+blue*normal*gain+shade+paverTone-joint*15+bevel*4;
          out[dest+3]=255;
        }
      }
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
  function vehicle(id,kind){
    if(kind==='taxi')return {cell:0,color:'#edbe42',length:4.6,width:1.85,scale:1,spriteAtlas:null,spriteCell:0,model:'taxi'};
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
})(typeof window==='undefined'?(typeof self==='undefined'?{}:self):window);
