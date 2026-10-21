/* Deterministic, seamless material fields. Randomness belongs to world texture
 * space, so it neither swims with the camera nor changes when a save is loaded. */
(function(root){
  'use strict';
  function hash(n){n=Math.imul(n^(n>>>16),0x45d9f3b);n=Math.imul(n^(n>>>16),0x45d9f3b);return (n^(n>>>16))>>>0;}
  function profile(name){
    const organic=['asphalt','grass','gravel','soil','roof','water'].includes(name);
    const factor=name==='carPaint'?1:organic||name==='paving'?8:4;
    return {factor,size:factor===1?256:factor*128,mode:name==='paving'?'pavers':organic?'organic':'structured'};
  }
  function synthesize(source,sourceSize,name,variant,seed,meters){
    const {factor,size,mode}=profile(name);if(factor===1)return source.slice();
    const out=new Uint8ClampedArray(size*size*4),patch=128,n=size/patch,period=sourceSize;
    const mean=[0,0,0];for(let i=0;i<source.length;i+=4)for(let k=0;k<3;k++)mean[k]+=source[i+k]/(source.length/4);
    const nodes=Array.from({length:n*n},(_,i)=>{const h=hash(seed+Math.imul(i+1,2654435761));return {x:h%period,y:(h>>>9)%period,r:(h>>>18)%4,shade:((h>>>20)%256)/255*5-2.5};});
    const weight=Array.from({length:patch},(_,i)=>{const t=i/patch;return t*t*(3-2*t);});
    const cw=[.8,.8,.6,1.2,.4,.3,.9,1.2][variant%8],ch=[.8,1.2,.6,.6,.4,.6,.9,.6][variant%8];
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
      let joint=0,paverTone=0;
      if(mode==='pavers'){
        const row=Math.floor(y/ph),xx=x+(variant%2&&row%2?pw/2:0),col=Math.floor(xx/pw)%cols;
        const dx=Math.min(xx%pw,pw-xx%pw),dy=Math.min(y%ph,ph-y%ph);
        joint=Math.max(0,1-Math.min(dx,dy)/.85);
        paverTone=(hash(seed+row*cols+col)%1000/999-.5)*11;
      }
      const dest=(y*size+x)*4;
      for(let k=0;k<3;k++)out[dest+k]=mean[k]+rgb[k]*normal*(mode==='pavers'?.46:1)+shade+paverTone-joint*19;
      out[dest+3]=255;
    }
    return out;
  }
  // De-correlate neighbouring vehicle IDs without changing a vehicle on reload.
  const fleet=[0,0,1,2,2,3,4,4,5,5,6,7,8,9,10,11,11,12,13,14,15,15];
  const vehicleColors=['#e7e9e2','#a64036','#314b64','#b9a15b','#afb9bc','#424b51','#e2e5de','#42738d','#4b6756','#773f45','#c8bda0','#30383f','#d9ded9','#aab5b6','#e0e3d9','#436277'];
  function vehicle(id){const n=hash((Number(id)||0)+873),cell=fleet[n%fleet.length];return {cell,color:vehicleColors[cell],length:cell>=12?5.2:cell===6||cell===7?4.8:4.4+(cell%3)*.15,width:cell>=12?1.92:1.74+(cell%3)*.055,scale:.97+(n>>>12)%7*.01};}
  const api={hash,profile,synthesize,vehicle};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SurfaceVariation=api;
})(typeof window==='undefined'?{}:window);
