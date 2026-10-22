/* Orthographic 3D architecture on the existing metre-based map.
 * Ground coordinates, selection and traffic remain owned by the city engine.
 * Three.js r180 is bundled locally. */
(function(root){
  'use strict';
  const T=root.THREE,S=root.CityScene,C=root.SceneMaterials;
  const TILT=.28,materials=new Map(),textures=new Map();
  let renderer=null,scene=null,camera=null,sun=null,ambient=null,ground=null,staticGroup=null,carsGroup=null,ao=null;
  let carAtlas=null;const carImage=new Image();carImage.onload=()=>{carAtlas=carImage;lastNetwork=null;root.MapWorkspace?.draw();};carImage.src="assets/vehicles.png";
  let failure=null,lastNetwork=null,lastParcels=null,lastRegion='',windows=[],stats={};
  let ambientOcclusionCanvas=null,ambientOcclusionKey='';
  let sceneryTarget=null,sceneryScene=null,sceneryCamera=null,sceneryKey='';
  const projection=(p,z=0)=>[p[0],p[1]-z*TILT];
  function start(){
    if(renderer)return true;if(failure||!T)return false;
    try{
      renderer=new T.WebGLRenderer({alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
      renderer.setClearColor(0x000000,0);renderer.outputColorSpace=T.SRGBColorSpace;
      renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;
      renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
      scene=new T.Scene();camera=new T.OrthographicCamera(-100,100,100,-100,.1,5000);camera.up.set(0,0,1);
      ambient=new T.HemisphereLight(0xdde8ed,0x69725c,2.15);ambient.position.set(0,0,500);scene.add(ambient);
      sun=new T.DirectionalLight(0xfff1d7,2.9);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-.00015;sun.shadow.normalBias=.08;sun.shadow.radius=2.2;scene.add(sun,sun.target);
      ground=new T.Mesh(new T.PlaneGeometry(100000,100000),new T.ShadowMaterial({color:0x182735,opacity:.38}));ground.receiveShadow=true;ground.position.z=.025;scene.add(ground);
      staticGroup=new T.Group();carsGroup=new T.Group();scene.add(staticGroup,carsGroup);
      sceneryTarget=new T.WebGLRenderTarget(1,1,{depthBuffer:true});
      sceneryTarget.depthTexture=new T.DepthTexture(1,1,T.UnsignedIntType);
      sceneryScene=new T.Scene();sceneryCamera=new T.OrthographicCamera(-1,1,1,-1,0,1);
      const sceneryMaterial=new T.ShaderMaterial({
        uniforms:{colorTexture:{value:sceneryTarget.texture},depthTexture:{value:sceneryTarget.depthTexture}},
        vertexShader:'varying vec2 screenUV;void main(){screenUV=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
        fragmentShader:`uniform sampler2D colorTexture;uniform sampler2D depthTexture;varying vec2 screenUV;
          void main(){gl_FragColor=texture2D(colorTexture,screenUV);gl_FragDepth=texture2D(depthTexture,screenUV).r;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          }`,depthTest:true,depthWrite:true});
      sceneryScene.add(new T.Mesh(new T.PlaneGeometry(2,2),sceneryMaterial));
      ao=new T.SSAOPass(scene,camera,256,256,16);ao.output=T.SSAOPass.OUTPUT.Blur;ao.renderToScreen=true;ao.kernelRadius=3.2;ao.minDistance=.00008;ao.maxDistance=.004;ao.ssaoMaterial.defines.PERSPECTIVE_CAMERA=0;
      renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();failure='WebGL context lost';renderer=null;root.MapWorkspace?.draw();});
      return true;
    }catch(error){failure=error.message;renderer=null;return false;}
  }
  function tex(name,variant=0){
    const cfg=C.pick(name,variant),key=`${name}:${cfg.index}`;
    if(!textures.has(key)){
      const map=new T.CanvasTexture(S.texture(name,cfg.index));map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());textures.set(key,map);
    }return textures.get(key);
  }
  function material(name,variant=0){
    const cfg=C.pick(name,variant),key=`${name}:${cfg.index}`;
    if(!materials.has(key)){
      const glass=name==='glass',metal=name==='metal';
      const mat=new T.MeshStandardMaterial({map:tex(name,cfg.index),color:glass?0x829aa7:name==='roof'?0xd6d8d0:name==='water'?0x7c9db2:0xffffff,roughness:glass?.32:metal?.64:.92,metalness:glass?.18:metal?.22:0});
      if(['roof','facade','metal','paving'].includes(name)){mat.bumpMap=tex(name,cfg.index);mat.bumpScale=name==='roof'?.04:.025;}
      mat.userData.meters=S.materialMeters(name);mat.userData.surface=name!=='carPaint';materials.set(key,mat);
    }return materials.get(key);
  }
  function solid(color,roughness=.75,metalness=0){
    const key=`solid:${color}:${roughness}:${metalness}`;if(!materials.has(key))materials.set(key,new T.MeshStandardMaterial({color,roughness,metalness}));return materials.get(key);
  }
  function tinted(name,color,variant=0){
    const key='tint:'+name+':'+color+':'+(variant%4);
    if(!materials.has(key)){const m=material(name,variant%4).clone();m.color.set(color);materials.set(key,m);}return materials.get(key);
  }
  function foliage(variant){
    const key='foliage:'+variant;if(!materials.has(key)){
      const map=new T.CanvasTexture(S.treeSprite(variant,false));map.colorSpace=T.SRGBColorSpace;map.anisotropy=4;
      const m=new T.MeshStandardMaterial({map,alphaTest:.36,side:T.DoubleSide,roughness:1,color:0xe4e7d1,vertexColors:true});m.shadowSide=T.DoubleSide;m.userData.foliage=true;materials.set(key,m);
    }return materials.get(key);
  }
  function cloth(index){
    const key='clothing:'+index+':'+root.CityPedestrians.ready;
    if(!materials.has(key)){
      const map=new T.CanvasTexture(root.CityPedestrians.texture(index));map.colorSpace=T.SRGBColorSpace;map.anisotropy=4;
      materials.set(key,new T.MeshStandardMaterial({map,roughness:.94,side:T.DoubleSide}));
    }return materials.get(key);
  }
  class Batch{
    constructor(){this.groups=new Map();}
    triangle(mat,points,uv,normals,color){
      if(!this.groups.has(mat))this.groups.set(mat,{p:[],n:[],uv:[],color:[]});const b=this.groups.get(mat);
      const a=new T.Vector3(...points[0]),n=new T.Vector3(...points[1]).sub(a).cross(new T.Vector3(...points[2]).sub(a)).normalize();
      for(let i=0;i<3;i++){b.p.push(...points[i]);b.n.push(...(normals?.[i]||n.toArray()));b.uv.push(...uv[i]);if(mat.vertexColors)b.color.push(...(color||[1,1,1]));}
    }
    quad(mat,points,w=1,h=1,normal=null){
      let ps=points;const a=new T.Vector3(...ps[0]),cross=new T.Vector3(...ps[1]).sub(a).cross(new T.Vector3(...ps[2]).sub(a));
      if(normal&&cross.dot(new T.Vector3(...normal))<0)ps=ps.slice().reverse();
      const m=mat.userData.meters||1,u=w/m,v=h/m,phase=mat.userData.surface?[(ps[0][0]*.754877+ps[0][1]*.56984)/m,(ps[0][1]*.618034+ps[0][2]*.41421)/m]:[0,0];
      const uv=[[0,0],[u,0],[u,v],[0,v]].map(([a,b])=>[a+phase[0],b+phase[1]]);
      for(const ids of [[0,1,2],[0,2,3]])this.triangle(mat,ids.map(i=>ps[i]),ids.map(i=>uv[i]));
    }
    box(x,y,z,w,d,h,angle,side,top=side){
      if(w<=0||d<=0||h<=0)return;
      const co=Math.cos(angle),si=Math.sin(angle);
      const v=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([a,b])=>[x+a*co-b*si,-y-a*si-b*co]);
      this.quad(top,v.map(q=>[...q,z+h]),w,d,[0,0,1]);
      for(let i=0;i<4;i++){const a=v[i],b=v[(i+1)%4],n=[a[1]-b[1],b[0]-a[0],0];this.quad(side,[[...a,z],[...b,z],[...b,z+h],[...a,z+h]],i%2?d:w,h,n);}
    }
    polygon(points,z,height,side,top=side){
      const clean=points.slice();if(clean.length>1&&Math.hypot(clean[0][0]-clean.at(-1)[0],clean[0][1]-clean.at(-1)[1])<1e-5)clean.pop();
      const contour=clean.map(p=>new T.Vector2(p[0],-p[1])),m=top.userData.meters||4;
      for(const ids of T.ShapeUtils.triangulateShape(contour,[])){
        let ps=ids.map(i=>[clean[i][0],-clean[i][1],z+height]);
        if((ps[1][0]-ps[0][0])*(ps[2][1]-ps[0][1])-(ps[1][1]-ps[0][1])*(ps[2][0]-ps[0][0])<0)ps.reverse();
        this.triangle(top,ps,ps.map(q=>[q[0]/m,q[1]/m]));
      }
      const area=contour.reduce((a,p,i)=>a+p.x*contour[(i+1)%contour.length].y-contour[(i+1)%contour.length].x*p.y,0);
      for(let i=0;i<clean.length;i++){const a=contour[i],b=contour[(i+1)%clean.length],normal=area>0?[b.y-a.y,a.x-b.x,0]:[a.y-b.y,b.x-a.x,0];this.quad(side,[[a.x,a.y,z],[b.x,b.y,z],[b.x,b.y,z+height],[a.x,a.y,z+height]],a.distanceTo(b),height,normal);}
    }
    flush(group){
      for(const [mat,data] of this.groups){
        const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(data.p,3));g.setAttribute('normal',new T.Float32BufferAttribute(data.n,3));g.setAttribute('uv',new T.Float32BufferAttribute(data.uv,2));if(mat.vertexColors)g.setAttribute('color',new T.Float32BufferAttribute(data.color,3));g.computeBoundingSphere();
        const mesh=new T.Mesh(g,mat);mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.foliage=!!mat.userData.foliage;group.add(mesh);
      }
    }
  }
  function clear(group){for(const child of [...group.children]){child.geometry?.dispose();group.remove(child);}}
  function local(origin,angle,x,y){return [origin[0]+x*Math.cos(angle)-y*Math.sin(angle),origin[1]+x*Math.sin(angle)+y*Math.cos(angle)];}
  function building(batch,p){
    const b=p.building;if(b.status==='construction'){batch.polygon(b.footprint,.02,.08,material('soil',S.seed(p.id)));return;}
    const layout=root.CityGeometry.buildingMassing(p),rng=S.random(p.id+':architecture'),pick=S.seed(p.id);
    const sides=b.landmark==='cbd_skyscraper'?solid(0x607b8b,.32,.3):material('facade',[0,1,2,3,8,11,2,3,4][pick%9]),roof=material('roof',[0,1,2,3,4,7,0,1,2,3][pick%10]);
    const frame=solid(0xd3d3c6),trim=solid(0xdedccc),glass=material('glass',pick),dark=solid(0x4b5f67,.4,.2);
    let volumes=layout.volumes;
    if(layout.podium)batch.polygon(layout.podium.points,0,.22,material('curb',0),material('paving',1));
    for(const v of volumes){
      if(!v.rect){batch.polygon(v.points,v.base||0,v.height-(v.base||0),sides,roof);continue;}
      const [x0,y0,x1,y1]=v.rect,w=x1-x0,d=y1-y0,h=v.height,angle=v.angle,origin=v.origin;
      const pt=(x,y,z)=>{const a=local(origin,angle,x,y);return [a[0],-a[1],z];};
      const at=local(origin,angle,(x0+x1)/2,(y0+y1)/2),base=layout.podium&&v.base===layout.podium.height?0:v.base||0;
      batch.box(...at,base,w,d,h-base,angle,sides,roof);
      batch.box(...at,.08,w+.16,d+.16,.28,angle,solid(0x8b938d),solid(0xbcbfb2));
      const parapet=v.type==='house'?.18:.58;
      for(const y of [y0+.18,y1-.18]){const q=local(origin,angle,(x0+x1)/2,y);batch.box(...q,h,w,.34,parapet,angle,trim);}
      for(const x of [x0+.18,x1-.18]){const q=local(origin,angle,x,(y0+y1)/2);batch.box(...q,h,.34,d,parapet,angle,trim);}
      const floors=Math.max(1,Math.round((h-base)/3.3));
      for(let side=0;side<4;side++){
        const along=side%2?d:w,columns=Math.max(1,Math.floor(along/3.1)),bay=along/columns;
        for(let f=0;f<floors;f++)for(let col=0;col<columns;col++){
          const a=(col+.18)*bay,c=(col+.82)*bay,z0=base+f*(h-base)/floors+.85,z1=Math.min(h-.45,z0+1.55);
          if(z1<=z0)continue;
          let corners;
          if(side===0)corners=[[x0+a,y0-.022,z0],[x0+c,y0-.022,z0],[x0+c,y0-.022,z1],[x0+a,y0-.022,z1]];
          if(side===1)corners=[[x1+.022,y0+a,z0],[x1+.022,y0+c,z0],[x1+.022,y0+c,z1],[x1+.022,y0+a,z1]];
          if(side===2)corners=[[x0+a,y1+.022,z0],[x0+c,y1+.022,z0],[x0+c,y1+.022,z1],[x0+a,y1+.022,z1]];
          if(side===3)corners=[[x0-.022,y0+a,z0],[x0-.022,y0+c,z0],[x0-.022,y0+c,z1],[x0-.022,y0+a,z1]];
          const normal=[Math.sin(angle)*(side===0?1:side===2?-1:0)+Math.cos(angle)*(side===1?1:side===3?-1:0),Math.cos(angle)*(side===0?1:side===2?-1:0)-Math.sin(angle)*(side===1?1:side===3?-1:0),0];
          batch.quad(glass,corners.map(q=>pt(...q)),c-a,z1-z0,normal);
          const sill=corners.map(q=>[q[0],q[1],q[2]]);sill[0][2]=sill[1][2]=z0-.09;sill[2][2]=sill[3][2]=z0;
          batch.quad(frame,sill.map(q=>pt(...q)),c-a,.09,normal);
          if(normal[1]<-.02&&rng()<.48)windows.push({points:corners.map(q=>{const a=local(origin,angle,q[0],q[1]);return projection(a,q[2]);}),warm:rng()>.2});
        }
      }

    }
    root.CityOrdinaryRoofs.draw3D(batch,p,{tinted});
  }
  function disc(batch,point,z,r,mat,segments=24){
    for(let i=0;i<segments;i++){const a=i*2*Math.PI/segments,b=(i+1)*2*Math.PI/segments;batch.triangle(mat,[[point[0],-point[1],z],[point[0]+Math.cos(a)*r,-point[1]+Math.sin(a)*r,z],[point[0]+Math.cos(b)*r,-point[1]+Math.sin(b)*r,z]],[[.5,.5],[.5+Math.cos(a)/2,.5+Math.sin(a)/2],[.5+Math.cos(b)/2,.5+Math.sin(b)/2]]);}
  }
  function tree(batch,t){
    const [x,y]=t.point,r=t.radius,type=C.tree(t.variant),h=t.height,mat=foliage(t.variant),conifer=['fir','blue-spruce','cypress'].includes(type.id);
    const form=S.seed(x.toFixed(2)+':'+y.toFixed(2)),turn=(form%6283)/1000,sx=.93+(form>>>7)%15/100,sy=.93+(form>>>12)%15/100;
    const color=[.88+(form>>>16)%12/100,.91+(form>>>20)%9/100,.84+(form>>>24)%16/100];
    const rise=conifer?r*1.65:r*.85,base=Math.max(.5,h-rise),rings=t.radius<1.6?3:6,segments=t.radius<1.6?12:18;
    batch.box(x,y,0,.24,.24,Math.max(.8,base+.4),0,solid(0x76654d));
    function vertex(i,j){const theta=i/rings*Math.PI/2,a=j/segments*Math.PI*2,rr=Math.sin(theta)*r;
      const z=base+Math.cos(theta)*rise;return {p:[x+Math.cos(a)*rr*sx,-y+Math.sin(a)*rr*sy,z],uv:[.5+Math.cos(a+turn)*rr/(2*r),.5+Math.sin(a+turn)*rr/(2*r)],n:new T.Vector3(Math.cos(a)*Math.sin(theta)/r,Math.sin(a)*Math.sin(theta)/r,Math.cos(theta)/rise).normalize().toArray()};}
    for(let i=0;i<rings;i++)for(let j=0;j<segments;j++){
      const a=vertex(i,j),b=vertex(i+1,j),c=vertex(i+1,j+1),d=vertex(i,j+1);
      for(const tri of [[a,b,c],[a,c,d]])batch.triangle(mat,tri.map(v=>v.p),tri.map(v=>v.uv),tri.map(v=>v.n),color);
    }
  }
  function carMaterial(id){
    const cell=root.SurfaceVariation.vehicle(id).cell,key='vehicle:'+cell;if(materials.has(key))return materials.get(key);
    const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d'),q=carAtlas.width/4;
    g.imageSmoothingQuality='high';g.drawImage(carAtlas,cell%4*q+1,Math.floor(cell/4)*q+1,q-2,q-2,0,0,256,256);
    const map=new T.CanvasTexture(c);map.colorSpace=T.SRGBColorSpace;map.anisotropy=8;
    const m=new T.MeshStandardMaterial({map,alphaTest:.4,side:T.DoubleSide,roughness:.5,metalness:.05,color:0xd9dfdd});materials.set(key,m);return m;
  }
  function car(batch,vehicle){
    const [x,y]=vehicle.point,a=vehicle.heading||0,id=Number(vehicle.id)||0,z=vehicle.z??(vehicle.level>0?6:0);
    const style=root.SurfaceVariation.vehicle(id),paint=tinted('carPaint',style.color,0),rubber=solid(0x192022),bodyLength=style.length*style.scale,bodyWidth=style.width*style.scale;
    batch.box(x,y,z+.26,bodyLength*.92,bodyWidth*.9,.34,a,paint);
    for(const dx of [-bodyLength*.32,bodyLength*.29])for(const dy of [-bodyWidth*.48,bodyWidth*.48]){const q=local([x,y],a,dx,dy);batch.box(...q,z+.17,.7,.14,.43,a,rubber);}
    if(carAtlas){
      const mat=carMaterial(id),length=bodyLength*1.13,width=bodyWidth*1.92,rows=16,cols=10;
      function vertex(i,j){const xx=(i/rows-.5)*length,yy=(j/cols-.5)*width,q=local([x,y],a,xx,yy),height=.69+.6*Math.exp(-Math.pow((xx+.2)/1.35,4))-.08*yy*yy;return {p:[q[0],-q[1],z+height],uv:[j/cols,i/rows]};}
      for(let i=0;i<rows;i++)for(let j=0;j<cols;j++){
        const v=[vertex(i,j),vertex(i+1,j),vertex(i+1,j+1),vertex(i,j+1)];
        for(const ids of [[0,2,1],[0,3,2]])batch.triangle(mat,ids.map(k=>v[k].p),ids.map(k=>v[k].uv),ids.map(()=>[0,0,1]));
      }
    }else{const cabin=local([x,y],a,-.15,0);batch.box(...cabin,z+.91,2.1,1.52,.62,a,solid(0x293e49,.23,.28),paint);}
  }
  const parkingCache=new WeakMap();
  function parkingFor(p){
    if(parkingCache.has(p))return parkingCache.get(p);
    let result=null;const b=p.building;
    if(b&&['commercial','office','industrial','warehouse'].includes(b.use)){
      const angle=root.CityGeometry.footprintAxis(b.footprint)*Math.PI/180,co=Math.cos(angle),si=Math.sin(angle),o=b.center||p.center;
      const convert=ps=>ps.map(q=>[(q[0]-o[0])*co+(q[1]-o[1])*si,-(q[0]-o[0])*si+(q[1]-o[1])*co]);
      const lot=convert(p.points),foot=convert(b.footprint),bounds=ps=>[Math.min(...ps.map(q=>q[0])),Math.min(...ps.map(q=>q[1])),Math.max(...ps.map(q=>q[0])),Math.max(...ps.map(q=>q[1]))];
      const l=bounds(lot),f=bounds(foot),bands=[[l[0]+1,l[1]+1,l[2]-1,f[1]-1],[l[0]+1,f[3]+1,l[2]-1,l[3]-1],[l[0]+1,l[1]+1,f[0]-1,l[3]-1],[f[2]+1,l[1]+1,l[2]-1,l[3]-1]];
      for(const band of bands){
        const w=band[2]-band[0],d=band[3]-band[1];if(Math.max(w,d)<13||Math.min(w,d)<11)continue;
        const turn=d>w,width=Math.min(32,Math.max(w,d)),depth=10.8,cx=(band[0]+band[2])/2,cy=(band[1]+band[3])/2;
        const rect=[cx-(turn?depth:width)/2,cy-(turn?width:depth)/2,cx+(turn?depth:width)/2,cy+(turn?width:depth)/2];
        if(!root.CityGeometry.rectangleInside(rect,lot))continue;
        result={point:local(o,angle,cx,cy),width,depth,angle:angle+(turn?Math.PI/2:0),id:p.id};break;
      }
    }
    parkingCache.set(p,result);return result;
  }
  function parking(batch,p){
    const lot=parkingFor(p);if(!lot)return;
    const {point,width,depth,angle}=lot,rng=S.random(p.id+':parking'),white=solid(0xdddcd0),asphalt=material('asphalt',S.seed(p.id));
    batch.box(...point,.025,width,depth,.045,angle,asphalt);
    const count=Math.floor((width-1.2)/2.65),start=-count*2.65/2;
    for(let i=0;i<=count;i++){const q=local(point,angle,start+i*2.65,-depth/2+2.7);batch.box(...q,.079,.11,5.15,.012,angle,white);}
    const back=local(point,angle,0,-depth/2+.1);batch.box(...back,.08,width-.6,.12,.01,angle,white);
    for(let i=0;i<count;i++)if(rng()>.24){const q=local(point,angle,start+(i+.5)*2.65,-depth/2+2.75);car(batch,{point:q,heading:angle-Math.PI/2,id:S.seed(p.id+i),speed:0});}
  }
  function fountain(batch,f){
    if(f.kind!=='plaza'||f.blockCommon||!f.points)return;
    const xs=f.points.map(p=>p[0]),ys=f.points.map(p=>p[1]),r=Math.min(6,(Math.max(...xs)-Math.min(...xs))/5,(Math.max(...ys)-Math.min(...ys))/5),[x,y]=f.point;
    const stone=material('curb',0),edge=solid(0xd4d4c4),water=material('water',3);
    const segments=64;
    for(let i=0;i<segments;i++){
      const a=i*2*Math.PI/segments,b=(i+1)*2*Math.PI/segments,pt=(q,rr,z)=>[x+Math.cos(q)*rr,-y+Math.sin(q)*rr,z];
      batch.quad(stone,[pt(a,r+1,0),pt(b,r+1,0),pt(b,r+1,.55),pt(a,r+1,.55)],.6,.55);
      batch.quad(edge,[pt(a,r,.55),pt(b,r,.55),pt(b,r+1,.55),pt(a,r+1,.55)],.6,1,[0,0,1]);
      batch.quad(stone,[pt(a,r,.15),pt(a,r,.55),pt(b,r,.55),pt(b,r,.15)],.6,.4);
    }
    disc(batch,f.point,.22,r,water,64);disc(batch,f.point,.7,.9,edge,24);
    for(let i=0;i<8;i++){
      const a=i*Math.PI/4,px=x+Math.cos(a)*.65,py=y+Math.sin(a)*.65;
      batch.box(px,py,.7,.08,.08,1.1,0,solid(0xd2ecea,.2));
      for(let j=0;j<9;j++){const t=j/8,d=1.8*t,q=[x+Math.cos(a)*d,y+Math.sin(a)*d];batch.box(...q,.7+1.7*Math.sin(t*Math.PI),.085,.085,.14,0,solid(0xc9e4e1,.2));}
    }
  }
  function streetscape(batch,state,near){
    const curb=material('curb',2),grass=material('grass',0),roads=state.roads.filter(r=>r.level===0&&['street','avenue','lane'].includes(r.kind));
    const layout=root.RoadRenderer.connections(state.roads,state.network,state.meta.roadTypes);
    const corners=root.RoadRenderer.junctionCorners({junctions:[...state.network.junctions.filter(j=>!layout.joins.some(c=>c.id===j.id)),...layout.joins.map(j=>({...j,approaches:j.approaches.map(a=>({...a,level:0}))}))]});
    for(const c of corners)if(near(c.corner)){
      const at=t=>c.from.map((v,i)=>(1-t)*(1-t)*v+2*t*(1-t)*c.corner[i]+t*t*c.to[i]);
      for(let i=0;i<12;i++){const a=at(i/12),b=at((i+1)/12),d=Math.hypot(b[0]-a[0],b[1]-a[1]);batch.box((a[0]+b[0])/2,(a[1]+b[1])/2,.01,d+.02,.3,.18,Math.atan2(b[1]-a[1],b[0]-a[0]),curb);}
    }
    for(const r of roads){
      const width=state.meta.roadTypes[r.kind].width,length=r.points.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-r.points[i][0],p[1]-r.points[i][1]),0);
      for(let d=1.6;d<length-1.6;d+=3.2){
        const at=root.RoadRenderer.sample(r.points,d);if(!near(at.point))continue;const angle=Math.atan2(at.tangent[1],at.tangent[0]);
        for(const side of [-1,1]){
          const q=[at.point[0]-at.tangent[1]*(width/2+.22)*side,at.point[1]+at.tangent[0]*(width/2+.22)*side];
          if(corners.some(c=>Math.hypot(q[0]-c.corner[0],q[1]-c.corner[1])<c.radius+1.6))continue;
          if(layout.joins.some(j=>Math.hypot(q[0]-j.point[0],q[1]-j.point[1])<j.extent))continue;
          if(roads.some(other=>other!==r&&S.edgeDistance(q,other.points)<state.meta.roadTypes[other.kind].width/2+.7))continue;
          batch.box(...q,.01,3.12,.32,.18,angle,curb);
        }
      }
    }
  }

  function gardenBeds(batch,p){
    if(!p.building||!['commercial','office','residential'].includes(p.building.use))return;
    const angle=root.CityGeometry.footprintAxis(p.building.footprint)*Math.PI/180,origin=p.building.center||p.center,co=Math.cos(angle),si=Math.sin(angle),convert=ps=>ps.map(q=>[(q[0]-origin[0])*co+(q[1]-origin[1])*si,-(q[0]-origin[0])*si+(q[1]-origin[1])*co]);
    const foot=convert(p.building.footprint),lot=convert(p.points),xs=foot.map(q=>q[0]),ys=foot.map(q=>q[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys),parking=parkingFor(p);
    for(const rect of [[x0-8,y0+.5,x0-2,y1+.5],[x1+2,y0+.5,x1+8,y1+.5],[x0+2,y1+2,x1-2,y1+8]]){
      if(!root.CityGeometry.rectangleInside(rect,lot))continue;
      const q=local(origin,angle,(rect[0]+rect[2])/2,(rect[1]+rect[3])/2),w=rect[2]-rect[0],d=rect[3]-rect[1];
      if(parking){const corners=convert([[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>local(parking.point,parking.angle,a*parking.width/2,b*parking.depth/2))),xx=corners.map(q=>q[0]),yy=corners.map(q=>q[1]);if(rect[0]<Math.max(...xx)&&rect[2]>Math.min(...xx)&&rect[1]<Math.max(...yy)&&rect[3]>Math.min(...yy))continue;}
      batch.box(...q,.035,w,d,.12,angle,material('curb',0),material('grass',0));
    }
  }
  function landscapedSpace(batch,f){
    if(!['park','plaza'].includes(f.kind)||!f.points)return;
    const xs=f.points.map(p=>p[0]),ys=f.points.map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys),rng=S.random(f.id+':beds');
    const beds=[];
    if(f.kind==='plaza'){
      const w=Math.min(11,(x1-x0)*.21),d=Math.min(8,(y1-y0)*.23);
      for(const x of [x0+3+w/2,x1-3-w/2])for(const y of [y0+3+d/2,y1-3-d/2])if(root.CityGeometry.rectangleInside([x-w/2,y-d/2,x+w/2,y+d/2],f.points))beds.push({point:[x,y],w,d});
    }
    for(const {point,w,d} of beds){
      batch.box(...point,.02,w,d,.21,0,material('curb',0),material('grass',0));
      for(const yy of [-d/2,d/2])batch.box(point[0],point[1]+yy,.2,w+.2,.22,.09,0,material('curb',0));
      for(const xx of [-w/2,w/2])batch.box(point[0]+xx,point[1],.2,.22,d,.09,0,material('curb',0));
      for(const dx of [-w*.24,w*.24])tree(batch,{point:[point[0]+dx,point[1]+(rng()-.5)*2],radius:3.1+rng(),height:7+rng()*3,variant:[0,4,6,7][Math.floor(rng()*4)]});
      for(let k=0;k<6;k++)tree(batch,{point:[point[0]+(rng()-.5)*(w-1),point[1]+(rng()-.5)*(d-1)],radius:.7+rng()*.6,height:.7+rng()*.6,variant:3+20*Math.floor(rng()*4)});
      const seat=[point[0],point[1]+d/2+1.1];batch.box(...seat,.5,2.6,.55,.12,0,material('facade',5));
      for(const dx of [-1,1])batch.box(seat[0]+dx,seat[1],.05,.12,.45,.45,0,solid(0x48534c));
    }
    if(f.kind==='park'){
      const plants=S.treesFor(f);
      for(const t of plants){
        const n=3+Math.floor(rng()*3);
        for(let i=0;i<n;i++){const a=rng()*Math.PI*2,d=1.7+rng()*2.4,q=[t.point[0]+Math.cos(a)*d,t.point[1]+Math.sin(a)*d];if(S.inside(q,f.points)&&S.edgeDistance(q,f.points)>1)tree(batch,{point:q,radius:.7+rng()*.65,height:.7+rng()*.8,variant:3+i%3*20});}
      }
    }
  }
  function medianTrees(state,batch){
    const plan=root.RoadRenderer.buildPlan(state.roads,state.network,state.meta.roadTypes);
    for(const line of plan.medians||[]){
      const pts=line.points,length=pts.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-pts[i][0],p[1]-pts[i][1]),0);if(length<5)continue;
      function ribbon(radius){
        const left=[],right=[];for(let d=0;d<=length;d+=Math.min(1.5,length/Math.ceil(length/1.5))){const at=root.RoadRenderer.sample(pts,d),n=[-at.tangent[1]*radius,at.tangent[0]*radius];left.push([at.point[0]+n[0],at.point[1]+n[1]]);right.push([at.point[0]-n[0],at.point[1]-n[1]]);}
        const end=root.RoadRenderer.sample(pts,length),start=root.RoadRenderer.sample(pts,0),cap=(at,sign)=>{const a=Math.atan2(at.tangent[1],at.tangent[0]);return Array.from({length:11},(_,i)=>[at.point[0]+Math.cos(a+sign*Math.PI/2-i*Math.PI/10)*radius,at.point[1]+Math.sin(a+sign*Math.PI/2-i*Math.PI/10)*radius]);};
        return left.concat(cap(end,1),right.reverse(),cap(start,-1));
      }
      batch.polygon(ribbon(1.45),.02,.2,material('curb',0),material('curb',0));batch.polygon(ribbon(1.2),.22,.015,material('grass',0));
      for(let d=5;d<length-3;d+=11){const at=root.RoadRenderer.sample(pts,d);tree(batch,{point:at.point,radius:2.25,height:5.7,variant:3});}
      for(let d=2;d<length-1;d+=2.8){const at=root.RoadRenderer.sample(pts,d);tree(batch,{point:at.point,radius:.65,height:.8,variant:3});}
    }
  }
  function rebuild(state,region){
    clear(staticGroup);windows=[];const batch=new Batch();
    const near=p=>p[0]>=region[0]-120&&p[0]<=region[2]+120&&p[1]>=region[1]-120&&p[1]<=region[3]+120;
    for(const p of state.parcels)if(p.building&&near(p.center)){building(batch,p);parking(batch,p);gardenBeds(batch,p);}
    for(const f of state.facilities)if(near(f.point)){fountain(batch,f);landscapedSpace(batch,f);}
    streetscape(batch,state,near);
    for(const f of state.facilities)if(root.CitySpecialBuildings?.names[f.kind]){
      const xs=f.points.map(p=>p[0]),ys=f.points.map(p=>p[1]);
      if(Math.max(...xs)>=region[0]&&Math.min(...xs)<=region[2]&&Math.max(...ys)>=region[1]-150&&Math.min(...ys)<=region[3]+150)root.CitySpecialBuildings.build3D(batch,f,{material,solid,tinted,car,tree});
    }
    const plants=state.parcels.filter(p=>(p.building||p.use==='protected')&&near(p.center)).concat(state.facilities.filter(f=>['park','plaza'].includes(f.kind)&&near(f.point)));
    for(const p of plants)for(const t of p.kind==='plaza'?[]:S.treesFor(p)){
      const lot=p.building?parkingFor(p):null;if(lot){const dx=t.point[0]-lot.point[0],dy=t.point[1]-lot.point[1],u=dx*Math.cos(lot.angle)+dy*Math.sin(lot.angle),v=-dx*Math.sin(lot.angle)+dy*Math.cos(lot.angle);if(Math.abs(u)<lot.width/2+t.radius&&Math.abs(v)<lot.depth/2+t.radius)continue;}
      if(p.building&&['commercial','office'].includes(p.building.use)){batch.box(...t.point,.03,1.6,1.6,.02,0,material('soil',3));}
      tree(batch,t);
    }
    for(const t of S.streetTreesFor(state))if(near(t.point))tree(batch,t);
    medianTrees(state,batch);
    const signals=root.RoadRenderer.buildPlan(state.roads,state.network,state.meta.roadTypes);
    for(const signal of [...signals.signals,...signals.pedestrianSignals])if(near(signal.point)){
      const support=signal.support||signal.point,h=signal.height||2.3,steel=solid(0x596761,.48,.45);
      batch.box(...support,.02,.18,.18,h,0,steel);
      if(signal.heads){
        const end=signal.heads[0],dx=end[0]-support[0],dy=end[1]-support[1];
        batch.box((end[0]+support[0])/2,(end[1]+support[1])/2,h-.09,Math.hypot(dx,dy)+.3,.16,.18,Math.atan2(dy,dx),steel);
      }
    }
    for(const lamp of S.lampsFor(state))if(near(lamp.point)){
      const [x,y]=lamp.point,[dx,dy]=lamp.arm,h=lamp.height||5.2,z=lamp.base||0;
      batch.box(x,y,z,.14,.14,h,0,solid(0x5c6562,.5,.4));batch.box(x+dx/2,y+dy/2,z+h-.08,Math.hypot(dx,dy)+.3,.12,.12,Math.atan2(dy,dx),solid(0x77837d,.5,.4));batch.box(x+dx,y+dy,z+h-.15,lamp.height?.35:.8,.34,.16,Math.atan2(dy,dx),solid(0xc8cfc5));
    }
    batch.flush(staticGroup);lastNetwork=state.network;lastParcels=state.parcels;
  }
  function render(ctx,state,{traffic}){
    if(!start()||!S.assetsReady)return false;
    const m=ctx.getTransform(),width=ctx.canvas.width,height=ctx.canvas.height,sx=m.a,sy=m.d,cx=(width/2-m.e)/sx,cy=(height/2-m.f)/sy;
    if(sx<.4||sy<.4)return false;
    if(renderer.domElement.width!==width||renderer.domElement.height!==height){renderer.setSize(width,height,false);sceneryTarget.setSize(width,height);sceneryKey='';ao.setSize(Math.ceil(width*.65),Math.ceil(height*.65));}
    const cos=1/Math.sqrt(1+TILT*TILT);camera.left=-width/(2*sx);camera.right=width/(2*sx);camera.top=height/(2*sy)*cos;camera.bottom=-camera.top;
    camera.position.set(cx,-cy-1000*TILT,1000);camera.lookAt(cx,-cy,0);camera.updateProjectionMatrix();
    const region=[cx-width/(2*sx),cy-height/(2*sy),cx+width/(2*sx),cy+height/(2*sy)],regionKey=region.map(n=>Math.floor(n/80)).join(':');
    if(state.network!==lastNetwork||state.parcels!==lastParcels||regionKey!==lastRegion){rebuild(state,region);lastRegion=regionKey;ambientOcclusionKey='';sceneryKey='';}
    const light=S.lightingAt(S.time),a=light.azimuth*Math.PI/180,elevation=Math.max(12,light.elevation)*Math.PI/180;
    sun.position.set(cx+Math.cos(a)*400,-cy-Math.sin(a)*400,Math.tan(elevation)*400);sun.target.position.set(cx,-cy,0);sun.target.updateMatrixWorld();
    sun.color.set(0xfff1dd).lerp(new T.Color(0xffc785),Math.min(1,light.warmth/.18));sun.intensity=2.8;ambient.intensity=1.5;
    sun.castShadow=light.elevation>0;ground.material.opacity=light.elevation>0?.43:0;
    const radius=Math.min(1800,Math.max(width/sx,height/sy)*.75+100);Object.assign(sun.shadow.camera,{left:-radius,right:radius,top:radius,bottom:-radius,near:1,far:2500});sun.shadow.camera.updateProjectionMatrix();
    clear(carsGroup);const batch=new Batch(),near=p=>p[0]>region[0]-20&&p[0]<region[2]+20&&p[1]>region[1]-20&&p[1]<region[3]+20;
    const layout=root.RoadRenderer.connections(state.roads,state.network,state.meta.roadTypes);
    for(const v of traffic?.vehicles||[])if(!root.RoadRenderer.upperVehicle(v,layout)&&near(v.point))car(batch,{...v,z:root.RoadRenderer.vehicleHeight(v,layout)});
    let pedestrians=0;for(const p of traffic?.pedestrians||[])if(near(p.point)){root.CityPedestrians.build3D(batch,p,{solid,cloth});pedestrians++;}
    batch.flush(carsGroup);
    // Keep stationary color AND depth. Restoring depth before dynamic drawing
    // preserves building/vehicle occlusion without redrawing every facade,
    // tree and shadow map at the animation frame rate.
    const viewKey=[width,height,sx,sy,m.e,m.f,Math.floor(S.time/15)].join(':');
    if(viewKey!==sceneryKey){
      carsGroup.visible=false;renderer.shadowMap.autoUpdate=true;
      renderer.setRenderTarget(sceneryTarget);renderer.render(scene,camera);renderer.setRenderTarget(null);
      carsGroup.visible=true;sceneryKey=viewKey;
    }
    renderer.render(sceneryScene,sceneryCamera);
    renderer.autoClear=false;renderer.shadowMap.autoUpdate=false;
    staticGroup.visible=false;ground.visible=false;renderer.render(scene,camera);
    staticGroup.visible=true;ground.visible=true;renderer.autoClear=true;
    const beautyCalls=renderer.info.render.calls,beautyTriangles=renderer.info.render.triangles;
    ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(renderer.domElement,0,0);ctx.restore();
    if(sx>1){
      // Occlusion belongs to stationary architecture. Reuse it between vehicle
      // frames instead of running three full-screen SSAO passes every repaint.
      const key=[width,height,sx,sy,m.e,m.f].join(':');
      if(key!==ambientOcclusionKey){
        const hidden=staticGroup.children.filter(m=>m.userData.foliage);for(const mesh of hidden)mesh.visible=false;
        carsGroup.visible=false;
        ao.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(camera.projectionMatrix);ao.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);
        renderer.shadowMap.autoUpdate=false;ao.render(renderer,null,null);renderer.shadowMap.autoUpdate=true;
        carsGroup.visible=true;for(const mesh of hidden)mesh.visible=true;
        ambientOcclusionCanvas??=document.createElement('canvas');ambientOcclusionCanvas.width=width;ambientOcclusionCanvas.height=height;
        ambientOcclusionCanvas.getContext('2d').drawImage(renderer.domElement,0,0);ambientOcclusionKey=key;
      }
      ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalCompositeOperation='multiply';ctx.globalAlpha=.58;ctx.drawImage(ambientOcclusionCanvas,0,0);ctx.restore();
    }
    stats={engine:'WebGL / Three.js r180',ambientOcclusion:sx>1,vehicleAtlas:!!carAtlas,pedestrianAtlas:root.CityPedestrians.ready,pedestrians,calls:beautyCalls,triangles:beautyTriangles,meshes:staticGroup.children.length,windows:windows.length};return true;
  }
  function renderUpperTraffic(ctx,state,traffic){
    if(!renderer)return;
    const layout=root.RoadRenderer.connections(state.roads,state.network,state.meta.roadTypes),batch=new Batch();
    const upper=(traffic?.vehicles||[]).filter(v=>root.RoadRenderer.upperVehicle(v,layout));
    if(!upper.length)return;
    clear(carsGroup);
    for(const v of upper)car(batch,{...v,z:root.RoadRenderer.vehicleHeight(v,layout)});
    batch.flush(carsGroup);
    const staticVisible=staticGroup.visible,groundVisible=ground.visible;
    staticGroup.visible=false;ground.visible=false;
    renderer.shadowMap.autoUpdate=false;renderer.render(scene,camera);
    ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(renderer.domElement,0,0);ctx.restore();
    staticGroup.visible=staticVisible;ground.visible=groundVisible;
  }
  function nightWindows(ctx,night){
    for(const win of windows){ctx.beginPath();win.points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.fillStyle=win.warm?`rgba(255,218,144,${.76*night})`:`rgba(183,216,232,${.55*night})`;ctx.fill();}
  }
  root.CityScene3D={render,renderUpperTraffic,nightWindows,projection,parkingFor,get available(){return start();},get stats(){return {...stats,failure};},get tilt(){return TILT;},invalidate(){lastNetwork=null;lastRegion='';}};
})(window);
