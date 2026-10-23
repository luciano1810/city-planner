/* Orthographic 3D architecture on the existing metre-based map.
 * Ground coordinates, selection and traffic remain owned by the city engine.
 * Three.js r180 is bundled locally. */
(function(root){
  'use strict';
  const T=root.THREE,S=root.CityScene,C=root.SceneMaterials;
  const TILT=.28,materials=new Map(),textures=new Map();
  let renderer=null,scene=null,camera=null,sun=null,ambient=null,ground=null,staticGroup=null,carsGroup=null,ao=null,groundCanvas=null,groundTexture=null;
  let carAtlas=null;const carImage=new Image();carImage.onload=()=>{carAtlas=carImage;lastNetwork=null;root.MapWorkspace?.draw();};carImage.src="assets/vehicles.png";
  let failure=null,lastNetwork=null,lastParcels=null,lastRegion='',windows=[],stats={},detailLevel=0;
  let ambientOcclusionCanvas=null,ambientOcclusionKey='';
  let sceneryTarget=null,sceneryScene=null,sceneryCamera=null,sceneryKey='';
  const projection=(p,z=0)=>[p[0],p[1]-z*TILT];
  function start(){
    if(renderer)return true;if(failure||!T)return false;
    try{
      renderer=new T.WebGLRenderer({alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
      renderer.setClearColor(0x000000,0);renderer.outputColorSpace=T.SRGBColorSpace;
      renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.06;
      renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
      scene=new T.Scene();camera=new T.OrthographicCamera(-100,100,100,-100,.1,5000);camera.up.set(0,0,1);
      // A soft sky and horizon provide reflections on glass, paint and metal.
      // It is an environment light only; the map still owns the background.
      const sky=document.createElement('canvas');sky.width=512;sky.height=256;
      const skyCtx=sky.getContext('2d'),gradient=skyCtx.createLinearGradient(0,0,0,256);
      gradient.addColorStop(0,'#99b8d1');gradient.addColorStop(.42,'#e1ecf3');gradient.addColorStop(.5,'#fff9e9');gradient.addColorStop(.56,'#9caa9b');gradient.addColorStop(1,'#4e5944');
      skyCtx.fillStyle=gradient;skyCtx.fillRect(0,0,512,256);
      const skyMap=new T.CanvasTexture(sky);skyMap.mapping=T.EquirectangularReflectionMapping;skyMap.colorSpace=T.SRGBColorSpace;
      const pmrem=new T.PMREMGenerator(renderer);scene.environment=pmrem.fromEquirectangular(skyMap).texture;scene.environmentIntensity=.55;pmrem.dispose();skyMap.dispose();
      ambient=new T.HemisphereLight(0xe5f1ff,0x899374,1.15);ambient.position.set(0,0,500);scene.add(ambient);
      sun=new T.DirectionalLight(0xfff1d7,2.9);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-.00015;sun.shadow.normalBias=.08;sun.shadow.radius=2.2;scene.add(sun,sun.target);
      groundCanvas=document.createElement('canvas');groundTexture=new T.CanvasTexture(groundCanvas);groundTexture.colorSpace=T.SRGBColorSpace;
      groundTexture.generateMipmaps=false;groundTexture.minFilter=T.LinearFilter;
      ground=new T.Mesh(new T.PlaneGeometry(1,1),new T.MeshStandardMaterial({map:groundTexture,color:0xc2c2c2,roughness:.98,metalness:0,alphaTest:.01}));ground.receiveShadow=true;ground.position.z=.005;scene.add(ground);
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
      const mat=new T.MeshStandardMaterial({map:tex(name,cfg.index),color:glass?0x94b5c8:name==='roof'?0xf0f2ed:name==='water'?0x91c6df:0xffffff,roughness:glass?.25:metal?.54:.88,metalness:glass?.18:metal?.22:0});
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
      const m=new T.MeshStandardMaterial({map,alphaTest:.36,side:T.DoubleSide,roughness:.92,color:0xf3f8dc,vertexColors:true});m.shadowSide=T.DoubleSide;m.userData.foliage=true;m.userData.alphaFoliage=true;materials.set(key,m);
    }return materials.get(key);
  }
  function crownMaterial(species){
    const index=C.treeSpecies.findIndex(t=>t.id===species),key='crown:'+index;
    if(!materials.has(key)){
      // Leaf-scale grain is deliberately restrained. Branch-scale light and
      // shade come from the model, not a second set of baked atlas shadows.
      let map=textures.get('crown-grain');
      if(!map){
        const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d'),pixels=g.createImageData(64,64),rng=S.random('crown-grain');
        for(let i=0;i<pixels.data.length;i+=4){const n=230+rng()*25;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=n;pixels.data[i+3]=255;}
        g.putImageData(pixels,0,0);map=new T.CanvasTexture(c);map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;map.anisotropy=4;textures.set('crown-grain',map);
      }
      const colors=[0x487c24,0x729b2a,0x59852c,0x649331,0x537d2c,0x43752a,0x608831,0x7c9b34,0x9ca733,0x99533b,0xc7a398,0x8da749,0x426c3f,0x52776a,0x3f6935,0x365e2d,0x7e963d,0x628940,0x4e7835,0x8e9b55];
      const m=new T.MeshStandardMaterial({map,color:colors[index]||colors[0],roughness:.94,bumpMap:map,bumpScale:.025,vertexColors:true});
      m.userData.foliage=true;m.userData.faceted=.16;materials.set(key,m);
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
      for(let i=0;i<3;i++){
        const normal=normals?.[i]&&mat.userData.faceted?new T.Vector3(...normals[i]).lerp(n,mat.userData.faceted).normalize().toArray():normals?.[i]||n.toArray();
        b.p.push(...points[i]);b.n.push(...normal);b.uv.push(...uv[i]);if(mat.vertexColors)b.color.push(...(color||[1,1,1]));
      }
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
    bevelBox(x,y,z,w,d,h,angle,side,top=side,bevel=.08){
      if(w<=0||d<=0||h<=0)return;
      const b=Math.min(bevel,h/3,w/5,d/5),co=Math.cos(angle),si=Math.sin(angle);
      const ring=(inset,height)=>{
        const u=w/2-inset,v=d/2-inset,c=Math.min(.3,u*.22,v*.22);
        return [[-u+c,-v],[u-c,-v],[u,-v+c],[u,v-c],[u-c,v],[-u+c,v],[-u,v-c],[-u,-v+c]].map(([a,b])=>[x+a*co-b*si,-y-a*si-b*co,height]);
      };
      const rings=[ring(b,z),ring(0,z+b),ring(0,z+h-b),ring(b,z+h)];
      for(let k=0;k<3;k++)for(let i=0;i<8;i++){
        const j=(i+1)%8,a=rings[k][i],c=rings[k][j];
        this.quad(k===2?top:side,[a,c,rings[k+1][j],rings[k+1][i]],Math.hypot(a[0]-c[0],a[1]-c[1]),rings[k+1][i][2]-a[2],[a[1]-c[1],c[0]-a[0],0]);
      }
      const cap=rings[3],meters=top.userData.meters||1;
      for(let i=1;i<7;i++){const ps=[cap[0],cap[i+1],cap[i]];this.triangle(top,ps,ps.map(p=>[p[0]/meters,p[1]/meters]));}
    }
    ellipsoid(x,y,z,rx,ry,rz,mat,color=[1,1,1],segments=10,rings=6,shape=0){
      // Sculpt foliage lobes in three dimensions. Smooth normals follow the
      // deformed surface, so the silhouette and the lighting tell the same story.
      const pointAt=(t,a)=>{
        const wave=shape?1+Math.sin(t)*(.065*Math.sin(a*3+shape+t*2)+.035*Math.cos(a*5-shape+t*3)) : 1;
        return [Math.sin(t)*Math.cos(a)*rx*wave,Math.sin(t)*Math.sin(a)*ry*wave,Math.cos(t)*rz];
      };
      const vertex=(i,j)=>{
        const t=i/rings*Math.PI,a=j/segments*Math.PI*2,s=Math.sin(t),c=Math.cos(t);
        let normal=new T.Vector3(s*Math.cos(a)/rx,s*Math.sin(a)/ry,c/rz).normalize();
        if(shape&&i>0&&i<rings){
          const dt=new T.Vector3(...pointAt(t+.001,a)).sub(new T.Vector3(...pointAt(t-.001,a)));
          const da=new T.Vector3(...pointAt(t,a+.001)).sub(new T.Vector3(...pointAt(t,a-.001)));
          normal=dt.cross(da).normalize();
        }
        const p=pointAt(t,a);
        return {p:[x+p[0],-y+p[1],z+p[2]],n:normal.toArray(),uv:[j/segments*3,i/rings*2]};
      };
      const vertices=Array.from({length:rings+1},(_,i)=>Array.from({length:segments+1},(_,j)=>vertex(i,j)));
      for(let i=0;i<rings;i++)for(let j=0;j<segments;j++){
        const a=vertices[i][j],b=vertices[i+1][j],c=vertices[i+1][j+1],d=vertices[i][j+1];
        for(const tri of [...(i<rings-1?[[a,b,c]]:[]),...(i>0?[[a,c,d]]:[])])this.triangle(mat,tri.map(v=>v.p),tri.map(v=>v.uv),tri.map(v=>v.n),color);
      }
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
        const mesh=new T.Mesh(g,mat);mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.foliage=!!mat.userData.foliage;mesh.userData.alphaFoliage=!!mat.userData.alphaFoliage;group.add(mesh);
      }
    }
  }
  function clear(group){for(const child of [...group.children]){child.geometry?.dispose();group.remove(child);}}
  function local(origin,angle,x,y){return [origin[0]+x*Math.cos(angle)-y*Math.sin(angle),origin[1]+x*Math.sin(angle)+y*Math.cos(angle)];}
  function building(batch,p){
    const b=p.building;if(b.status==='planned')return;
    if(b.status==='construction'){
      batch.polygon(b.footprint,.02,.08,material('soil',S.seed(p.id)));
      const progress=b.constructionProgress||0,top=Math.max(0,(progress-.12)/.88)*(b.height||b.floors*3.3);
      if(top>.15){
        const layout=root.CityGeometry.buildingMassing(p),concrete=solid(0xa4a49a),slab=solid(0xc6c5b9);
        for(const v of [...(layout.podium?[layout.podium]:[]),...layout.volumes]){
          const base=v.base||0,height=Math.min(v.height,top)-base;
          if(height<=0)continue;
          batch.polygon(v.points,base,height,concrete,slab);
          for(let z=base+3.3;z<base+height;z+=3.3)batch.polygon(v.points,z,.16,slab,slab);
        }
      }
      return;
    }
    const layout=root.CityGeometry.buildingMassing(p),rng=S.random(p.id+':architecture'),pick=S.seed(p.id);
    if(b.extensionProgress>0){
      const top=layout.volumes.reduce((a,v)=>!a||v.height>a.height?v:a,null);
      if(top)batch.polygon(top.points,top.height,(b.height||b.floors*3.3)/b.floors*b.extensionFloors*b.extensionProgress,solid(0xa4a49a),solid(0xc6c5b9));
    }
    const sides=b.landmark==='cbd_skyscraper'?solid(0x607b8b,.32,.3):material('facade',[0,1,2,3,8,11,2,3,4][pick%9]),roof=material('roof',[0,1,2,3,4,7,0,1,2,3][pick%10]);
    const frame=solid(0xd3d3c6),trim=solid(0xdedccc),glass=material('glass',pick),dark=solid(0x4b5f67,.4,.2);
    let volumes=layout.volumes;
    if(layout.podium)batch.polygon(layout.podium.points,0,.22,material('curb',0),material('paving',1));
    for(const v of volumes){
      if(!v.rect||v.outline){
        const base=v.base||0,h=v.height;
        batch.polygon(v.points,base,h-base,sides,roof);
        if(v.outline&&detailLevel>0)for(let i=0;i<v.points.length-1;i++){
          const a=v.points[i],b=v.points[i+1],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
          if(len<.8)continue;
          const nx=dy/len,ny=-dx/len,columns=Math.max(1,Math.floor(len/3.1)),floors=Math.max(1,Math.round((h-base)/3.3));
          const pt=(t,z)=>[a[0]+dx*t+nx*.025,-a[1]-dy*t-ny*.025,z];
          for(let f=0;f<floors;f++)for(let col=0;col<columns;col++){
            const t0=(col+.18)/columns,t1=(col+.82)/columns,z0=base+f*(h-base)/floors+.85,z1=Math.min(h-.45,z0+1.55);
            if(z1<=z0)continue;
            batch.quad(glass,[pt(t0,z0),pt(t1,z0),pt(t1,z1),pt(t0,z1)],len*(t1-t0),z1-z0,[nx,-ny,0]);
            batch.quad(frame,[pt(t0,z0-.09),pt(t1,z0-.09),pt(t1,z0),pt(t0,z0)],len*(t1-t0),.09,[nx,-ny,0]);
          }
        }
        continue;
      }
      const [x0,y0,x1,y1]=v.rect,w=x1-x0,d=y1-y0,h=v.height,angle=v.angle,origin=v.origin;
      const pt=(x,y,z)=>{const a=local(origin,angle,x,y);return [a[0],-a[1],z];};
      const at=local(origin,angle,(x0+x1)/2,(y0+y1)/2),base=layout.podium&&v.base===layout.podium.height?0:v.base||0;
      if(detailLevel>0)batch.bevelBox(...at,base,w,d,h-base,angle,sides,roof,.12);
      else batch.box(...at,base,w,d,h-base,angle,sides,roof);
      batch.box(...at,.08,w+.16,d+.16,.28,angle,solid(0x8b938d),solid(0xbcbfb2));
      const parapet=v.type==='house'?.18:.58;
      for(const y of [y0+.18,y1-.18]){const q=local(origin,angle,(x0+x1)/2,y);batch.bevelBox(...q,h,w,.38,parapet,angle,trim,solid(0xf1eee2),.06);}
      for(const x of [x0+.18,x1-.18]){const q=local(origin,angle,x,(y0+y1)/2);batch.bevelBox(...q,h,.38,d,parapet,angle,trim,solid(0xf1eee2),.06);}
      if(detailLevel>0&&v.type!=='house'){
        // A projecting cornice and a shallow reveal stop the facade reading as
        // a single extruded box at the roof edge.
        for(const yy of [y0-.08,y1+.08]){const q=local(origin,angle,(x0+x1)/2,yy);batch.bevelBox(...q,h-.32,w+.3,.24,.16,angle,trim);}
        for(const xx of [x0-.08,x1+.08]){const q=local(origin,angle,xx,(y0+y1)/2);batch.bevelBox(...q,h-.32,.24,d+.3,.16,angle,trim);}
      }
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
          if(detailLevel>1){
            const mid=corners[0].map((v,i)=>(v+corners[1][i])/2),q=local(origin,angle,mid[0],mid[1]);
            batch.bevelBox(...q,z0-.13,side%2?.22:c-a+.15,side%2?c-a+.15:.22,.12,angle,frame,trim,.025);
            const divider=corners.map(q=>q.slice()),axis=side%2?1:0,center=(corners[0][axis]+corners[1][axis])/2;
            divider[0][axis]=divider[3][axis]=center-.04;divider[1][axis]=divider[2][axis]=center+.04;
            divider.forEach(q=>{if(side%2)q[0]+=(side===1?1:-1)*.008;else q[1]+=(side===2?1:-1)*.008;});
            batch.quad(frame,divider.map(q=>pt(...q)),.08,z1-z0,normal);
          }
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
    const [x,y]=t.point,r=t.radius,type=C.tree(t.variant),h=t.height,conifer=['fir','blue-spruce','cypress'].includes(type.id);
    if(type.id!=='palm'){
      const rng=S.random(`${x.toFixed(2)}:${y.toFixed(2)}:crown`),mat=crownMaterial(type.id),small=r<1.6;
      const segments=detailLevel>1?12:detailLevel>0?10:8,rings=detailLevel>1?8:detailLevel>0?6:4;
      const base=Math.max(.15,h-r*(conifer?2.4:1.45));
      batch.bevelBox(x,y,0,small?.12:.3,small?.12:.3,base+.5,0,solid(0x77634a));
      if(conifer){
        for(let i=0;i<4;i++){
          const rr=r*(1-i*.19),z=base+(h-base)*(i+.5)/4;
          batch.ellipsoid(x,y,z,rr,rr*.9,(h-base)*.29,mat,[.89+i*.03,.94+i*.02,.86+i*.03],segments,rings);
        }
      }else{
        const narrow=['birch','ginkgo','elm'].includes(type.id),spreading=['oak','english-oak','willow'].includes(type.id);
        const branches=small?3:4+Math.floor(rng()*3),turn=rng()*Math.PI*2,stretch=narrow?.7:spreading?1.08:.88+rng()*.22;
        // Broad, unequal lobes overlap around a solid core. They are arranged
        // up the crown rather than as a ring of identical balls.
        for(let i=0;i<branches;i++){
          const a=turn+i*2.39996,spread=r*(.19+rng()*.4),cx=x+Math.cos(a)*spread*stretch,cy=y+Math.sin(a)*spread;
          const z=Math.max(r*.5,h-r*(.42+rng()*.7)),rr=r*(.35+rng()*.17),tone=.74+rng()*.22;
          batch.ellipsoid(cx,cy,z,rr*stretch,rr*(.8+rng()*.3),rr*(narrow?1.55:1.05+rng()*.35),mat,[tone,tone,.94*tone],segments,rings,turn+i+1);
          if(!small&&detailLevel>0){
            const leaf=r*(.19+rng()*.13);
            batch.ellipsoid(cx+Math.cos(a)*rr*.55,cy+Math.sin(a)*rr*.45,z+rr*.56,leaf*stretch,leaf*.85,leaf*1.2,mat,[tone+.08,tone+.08,tone],8,5,turn+i+3);
          }
        }
        batch.ellipsoid(x-r*.08,y+r*.04,h-r*.24,r*.37*stretch,r*.32,r*(narrow?.6:.46),mat,[.96,.98,.89],segments,rings,turn+2);

      }
      return;
    }
    const mat=foliage(t.variant);
    const form=S.seed(x.toFixed(2)+':'+y.toFixed(2)),turn=(form%6283)/1000,sx=.93+(form>>>7)%15/100,sy=.93+(form>>>12)%15/100;
    const color=[.91+(form>>>16)%9/100,.95+(form>>>20)%5/100,.85+(form>>>24)%13/100];
    const rise=conifer?r*1.65:r*.85,base=Math.max(.5,h-rise),rings=t.radius<1.6?3:6,segments=t.radius<1.6?12:18;
    batch.box(x,y,0,.24,.24,Math.max(.8,base+.4),0,solid(0x76654d));
    function vertex(i,j){const theta=i/rings*Math.PI/2,a=j/segments*Math.PI*2;
      // Soft lobes break the perfect dome silhouette without adding geometry.
      const lobe=conifer?1:1+Math.sin(theta)*(.055*Math.sin(a*5+turn)+.035*Math.cos(a*3-turn));
      const rr=Math.sin(theta)*r*lobe;
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
    const m=new T.MeshPhysicalMaterial({map,alphaTest:.4,side:T.DoubleSide,roughness:.3,metalness:.08,clearcoat:.7,clearcoatRoughness:.2,color:0xf1f5f5});materials.set(key,m);return m;
  }
  function car(batch,vehicle){
    const [x,y]=vehicle.point,a=vehicle.heading||0,id=Number(vehicle.id)||0,z=vehicle.z??(vehicle.level>0?6:0);
    if(vehicle.mode==='bus'){
      const length=vehicle.length||10.8,width=vehicle.width||2.5,paint=solid(vehicle.color||'#438e89'),glass=solid(0x294e60),roof=solid(0xe3e9e1),rubber=solid(0x25373e);
      batch.bevelBox(x,y,z+.4,length,width,1.2,a,paint,paint,.15);
      batch.bevelBox(x,y,z+1.6,length*.94,width,1.25,a,glass,glass,.1);
      batch.bevelBox(x,y,z+2.85,length,width,.23,a,roof,roof,.1);
      for(const dx of [-length*.31,length*.31])for(const dy of [-width*.48,width*.48]){const q=local([x,y],a,dx,dy);batch.bevelBox(...q,z+.12,.95,.25,.85,a,rubber,rubber,.12);}
      const ac=local([x,y],a,-1.2,0);batch.box(...ac,z+3.08,2.1,1.4,.3,a,solid(0x9daead));
      return;
    }
    const style=root.SurfaceVariation.vehicle(id,vehicle.kind),paint=tinted('carPaint',style.color,0),rubber=solid(0x192022),bodyLength=style.length*style.scale,bodyWidth=style.width*style.scale;
    if(vehicle.kind==='taxi'||detailLevel>1&&!carAtlas){
      const body=solid(style.color,.21,.26),glass=solid(0x284456,.14,.3),chrome=solid(0xb9cad0,.25,.6),van=style.cell>=12;
      batch.bevelBox(x,y,z+.28,bodyLength,bodyWidth,.64,a,body,body,.18);
      const cabin=local([x,y],a,van?-.34:-.18,0),cw=bodyWidth*.82,cl=bodyLength*(van?.66:.48),ch=van?.82:.58;
      batch.bevelBox(...cabin,z+.88,cl,cw,ch,a,glass,glass,.16);
      // A small roof inset leaves a continuous glass belt and sloping screens.
      batch.bevelBox(...cabin,z+.88+ch-.025,cl*(van?.73:.53),cw*.86,.055,a,body,body,.025);
      for(const dx of [-bodyLength*.31,bodyLength*.3])for(const dy of [-bodyWidth*.48,bodyWidth*.48]){
        const q=local([x,y],a,dx,dy);batch.bevelBox(...q,z+.12,.73,.2,.51,a,rubber,rubber,.08);
      }
      for(const side of [-1,1]){
        const q=local([x,y],a,.45,side*bodyWidth*.56);batch.bevelBox(...q,z+.83,.32,.22,.15,a,body,chrome,.05);
        const front=local([x,y],a,bodyLength*.46,side*bodyWidth*.3),rear=local([x,y],a,-bodyLength*.47,side*bodyWidth*.32);
        batch.bevelBox(...front,z+.73,.17,bodyWidth*.24,.13,a,solid(0xf5f8e7),solid(0xffffff),.035);
        batch.bevelBox(...rear,z+.7,.13,bodyWidth*.2,.12,a,solid(vehicle.speed<.2?0xff3930:0xa51f22),solid(0xe63a32),.03);
      }
      const grille=local([x,y],a,bodyLength*.495,0);batch.box(...grille,z+.44,.04,bodyWidth*.4,.19,a,rubber);
      if(vehicle.kind==='taxi'){
        const roof=local([x,y],a,-.3,0);batch.box(...roof,z+1.5,.48,.85,.12,a,rubber);
        batch.box(...roof,z+1.62,.4,.76,.18,a,solid(vehicle.taxiState==='pickup'?0x5ee0aa:0xfff0ad));
      }
      return;
    }
    batch.bevelBox(x,y,z+.26,bodyLength*.92,bodyWidth*.9,.34,a,paint,paint,.1);
    for(const dx of [-bodyLength*.32,bodyLength*.29])for(const dy of [-bodyWidth*.48,bodyWidth*.48]){const q=local([x,y],a,dx,dy);batch.box(...q,z+.17,.7,.14,.43,a,rubber);}
    if(carAtlas){
      const mat=carMaterial(id),length=bodyLength*1.13,width=bodyWidth*1.92,rows=16,cols=10;
      function vertex(i,j){
        const xx=(i/rows-.5)*length,yy=(j/cols-.5)*width,q=local([x,y],a,xx,yy),u=(xx+.2)/1.35,e=Math.exp(-(u**4)),height=.69+.6*e-.08*yy*yy;
        const du=-2.4*u**3*e/1.35,dv=-.16*yy;
        const n=new T.Vector3(-du*Math.cos(a)+dv*Math.sin(a),du*Math.sin(a)+dv*Math.cos(a),1).normalize().toArray();
        return {p:[q[0],-q[1],z+height],uv:[j/cols,i/rows],n};
      }
      for(let i=0;i<rows;i++)for(let j=0;j<cols;j++){
        const v=[vertex(i,j),vertex(i+1,j),vertex(i+1,j+1),vertex(i,j+1)];
        for(const ids of [[0,2,1],[0,3,2]])batch.triangle(mat,ids.map(k=>v[k].p),ids.map(k=>v[k].uv),ids.map(k=>v[k].n));
      }
    }else{const cabin=local([x,y],a,-.15,0);batch.box(...cabin,z+.91,2.1,1.52,.62,a,solid(0x293e49,.23,.28),paint);}
  }
  const parkingCache=new WeakMap();
  function parkingFor(p){
    if(p.forecourt?.length)return null; // Authoritative frontcourt parking is shared with Canvas.
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
  function parking(batch,p,planned){
    const lot=planned||parkingFor(p);if(!lot)return;
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
    // A bevelled coping catches a thin highlight; the inner wall is visible
    // above the recessed water surface, giving the basin actual depth.
    for(let i=0;i<segments;i++){
      const a=i*2*Math.PI/segments,b=(i+1)*2*Math.PI/segments,pt=(q,rr,z)=>[x+Math.cos(q)*rr,-y+Math.sin(q)*rr,z];
      batch.quad(solid(0xece9db),[pt(a,r+.06,.62),pt(b,r+.06,.62),pt(b,r+.92,.62),pt(a,r+.92,.62)],.6,.86,[0,0,1]);
      batch.quad(edge,[pt(a,r+.92,.62),pt(b,r+.92,.62),pt(b,r+1,.55),pt(a,r+1,.55)],.6,.1);
      batch.quad(edge,[pt(a,r,.55),pt(b,r,.55),pt(b,r+.06,.62),pt(a,r+.06,.62)],.6,.1);
    }
    if(detailLevel>0)for(const radius of [r*.33,r*.62,r*.84])for(let i=0;i<48;i++){
      const a=i*2*Math.PI/48,b=(i+1)*2*Math.PI/48,pt=(q,rr)=>[x+Math.cos(q)*rr,-y+Math.sin(q)*rr,.24];
      batch.quad(solid(0x88cadb,.25),[pt(a,radius),pt(b,radius),pt(b,radius+.025),pt(a,radius+.025)],.6,.025,[0,0,1]);
    }
    for(let i=0;i<8;i++){
      const a=i*Math.PI/4,px=x+Math.cos(a)*.65,py=y+Math.sin(a)*.65;
      batch.box(px,py,.7,.08,.08,1.1,0,solid(0xd2ecea,.2));
      for(let j=0;j<9;j++){const t=j/8,d=1.8*t,q=[x+Math.cos(a)*d,y+Math.sin(a)*d];batch.box(...q,.7+1.7*Math.sin(t*Math.PI),.085,.085,.14,0,solid(0xc9e4e1,.2));}
    }
  }
  function streetscape(batch,state,near){
    const curb=material('curb',2),grass=material('grass',0),roads=state.roads.filter(r=>r.level===0&&['street','avenue','lane'].includes(r.kind));
    const slabs=[0xd6c4a9,0xe0ceb3,0xdac9b1,0xe5d4ba].map(color=>solid(color,.95)),gutter=solid(0xa9aca5),iron=solid(0x485453,.65,.3);
    const layout=root.RoadRenderer.connections(state.roads,state.network,state.meta.roadTypes);
    const driveways=[...state.facilities.filter(f=>f.connected&&f.accessPath?.length),...(state.streetside?.sites||[])];
    const corners=root.RoadRenderer.junctionCorners({junctions:[...state.network.junctions.filter(j=>!layout.joins.some(c=>c.id===j.id)),...layout.joins.map(j=>({...j,approaches:j.approaches.map(a=>({...a,level:0}))}))]});
    for(const c of corners)if(near(c.corner)){
      const at=t=>c.from.map((v,i)=>(1-t)*(1-t)*v+2*t*(1-t)*c.corner[i]+t*t*c.to[i]);
      for(let i=0;i<16;i++){const a=at(i/16),b=at((i+1)/16),d=Math.hypot(b[0]-a[0],b[1]-a[1]);batch.bevelBox((a[0]+b[0])/2,(a[1]+b[1])/2,.01,d+.025,.38,.23,Math.atan2(b[1]-a[1],b[0]-a[0]),curb,solid(0xeee6d6),.045);}
    }
    for(const r of roads){
      const width=state.meta.roadTypes[r.kind].width,length=r.points.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-r.points[i][0],p[1]-r.points[i][1]),0);
      for(let d=1.6;d<length-1.6;d+=3.2){
        const at=root.RoadRenderer.sample(r.points,d);if(!near(at.point))continue;const angle=Math.atan2(at.tangent[1],at.tangent[0]);
        for(const side of [-1,1]){
          const q=[at.point[0]-at.tangent[1]*(width/2+.22)*side,at.point[1]+at.tangent[0]*(width/2+.22)*side];
          if(driveways.some(f=>S.edgeDistance(q,f.accessPath)<(f.accessWidth||5)/2+1.6))continue;
          if(corners.some(c=>Math.hypot(q[0]-c.corner[0],q[1]-c.corner[1])<c.radius+1.6))continue;
          if(layout.joins.some(j=>Math.hypot(q[0]-j.point[0],q[1]-j.point[1])<j.extent))continue;
          if(roads.some(other=>other!==r&&S.edgeDistance(q,other.points)<state.meta.roadTypes[other.kind].width/2+.7))continue;
          const atOffset=(distance,offset)=>{const s=root.RoadRenderer.sample(r.points,distance);return [s.point[0]-s.tangent[1]*offset,s.point[1]+s.tangent[0]*offset];};
          const strip=(start,end,inner,outer)=>[atOffset(start,side*inner),atOffset(end,side*inner),atOffset(end,side*outer),atOffset(start,side*outer)];
          // Shared arc-length cross-sections keep slabs flush on curved roads.
          // Individually rotated rectangular tiles used to leave triangular gaps.
          batch.polygon(strip(d-1.58,d+1.58,width/2+.03,width/2+.41),.01,.22,curb,solid(0xeee6d6));
          if(detailLevel<1)continue;
          const roadPoint=local(q,angle,0,-side*.36);
          batch.box(...roadPoint,.03,3.18,.3,.025,angle,gutter);
          const count=r.kind==='avenue'?3:2,cell=(r.kind==='avenue'?4.05:2.55)/count;
          for(let along=0;along<2;along++)for(let across=0;across<count;across++){
            const tile=strip(d-1.6+along*1.6+.018,d+along*1.6-.018,width/2+.47+across*cell+.018,width/2+.47+(across+1)*cell-.018);
            if(roads.some(other=>other!==r&&tile.some(v=>S.edgeDistance(v,other.points)<state.meta.roadTypes[other.kind].width/2+.3)))continue;
            if(state.parcels.some(lot=>lot.building&&tile.some(v=>S.inside(v,lot.building.footprint))))continue;
            const color=slabs[S.seed(r.id+':'+Math.round(d)+':'+along+':'+across)%slabs.length];
            batch.polygon(tile,.035,.085,color);
          }
          // Recessed drainage grates at regular curb intervals, away from joins.
          if(detailLevel>1&&Math.floor(d/3.2)%9===0){
            const p=local(q,angle,0,-side*.38);batch.bevelBox(...p,.065,.95,.42,.025,angle,iron,iron,.01);
            for(let k=0;k<6;k++){const v=local(p,angle,(k-2.5)*.135,0);batch.box(...v,.09,.055,.39,.014,angle,gutter);}
          }
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
      if(p.forecourt?.some(s=>s.points.some(v=>{const [x,y]=convert([v])[0];return x>=rect[0]&&x<=rect[2]&&y>=rect[1]&&y<=rect[3];})||[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2],[0,0]].some(v=>S.onSurface(local(q,angle,...v),[s]))))continue;
      if(parking){const corners=convert([[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>local(parking.point,parking.angle,a*parking.width/2,b*parking.depth/2))),xx=corners.map(q=>q[0]),yy=corners.map(q=>q[1]);if(rect[0]<Math.max(...xx)&&rect[2]>Math.min(...xx)&&rect[1]<Math.max(...yy)&&rect[3]>Math.min(...yy))continue;}
      plantingBed(batch,root.CityLandscape.rounded([[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]],Math.min(3,w/3,d/3)).map(v=>local(q,angle,...v)));
    }
  }
  function plantingBed(batch,points){
    batch.polygon(points,.03,.2,solid(0x9b967c),material('grass',0));
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
      if(length<.015)continue;
      batch.bevelBox((a[0]+b[0])/2,(a[1]+b[1])/2,.18,length+.02,.2,.12,Math.atan2(b[1]-a[1],b[0]-a[0]),solid(0xb4ad97),solid(0xeee8d5),.035);
    }
  }
  function shrub(batch,p){
    const colors=[0x548127,0x6d912e,0x879c35,0x3b6f38],mat=solid(colors[p.variant%4],.91),r=p.radius,h=p.height;
    const rng=S.random(`${p.point}:shrub`);
    batch.ellipsoid(...p.point,.23+h*.42,r,r*.82,h*.53,mat,[1,1,1],8,4);
    if(detailLevel>0)for(let i=0;i<3;i++){
      const a=i*Math.PI*2/3+rng(),size=r*(.35+rng()*.18);
      batch.ellipsoid(p.point[0]+Math.cos(a)*r*.45,p.point[1]+Math.sin(a)*r*.38,.23+h*(.57+rng()*.2),size,size*.9,h*.34,mat,[1,1,1],7,3);
    }
    if(p.flower&&detailLevel>0)for(let i=0;i<5;i++){
      const a=i*Math.PI*.4;batch.ellipsoid(p.point[0]+Math.cos(a)*r*.5,p.point[1]+Math.sin(a)*r*.5,.23+h,.1,.1,.07,solid(i%2?0xf5d07e:0xeedcc2),[1,1,1],6,3);
    }
  }
  function landscapedSpace(batch,f){
    if(!['park','plaza'].includes(f.kind)||!f.points)return;
    const garden=root.CityLandscape.plan(f);
    if(garden){
      for(const bed of garden.beds)plantingBed(batch,bed);
      for(const t of garden.trees)tree(batch,t);
      for(const p of garden.shrubs)shrub(batch,p);
      for(const p of garden.stones)batch.ellipsoid(...p.point,.28+p.radius*.35,p.radius,p.radius*.7,p.radius*.6,solid(0xa7a79b),[1,1,1],7,4);
      for(const p of garden.benches){
        for(let i=0;i<4;i++)batch.bevelBox(p[0],p[1]+(i-1.5)*.14,.55,2.8,.11,.08,0,solid(0xac8656),solid(0xc5a171),.02);
        for(const dx of [-1.05,1.05])batch.bevelBox(p[0]+dx,p[1],.14,.12,.55,.42,0,solid(0x44544f));
        batch.bevelBox(p[0],p[1]+.3,.85,2.8,.1,.32,0,solid(0xac8656));
      }
      return;
    }
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
    for(const p of state.parcels)if(p.building&&p.building.status!=='planned'&&near(p.center)){building(batch,p);if(p.building.status!=='construction'){parking(batch,p);gardenBeds(batch,p);}}
    for(const f of state.facilities)if(near(f.point)){fountain(batch,f);landscapedSpace(batch,f);}
    for(const site of state.streetside?.sites||[])for(const [i,lot] of site.parking.entries())if(near(lot.point))parking(batch,{id:site.id+':front:'+i},lot);
    streetscape(batch,state,near);
    for(const f of state.facilities)if(root.CitySpecialBuildings?.names[f.kind]){
      const xs=f.points.map(p=>p[0]),ys=f.points.map(p=>p[1]);
      if(Math.max(...xs)>=region[0]&&Math.min(...xs)<=region[2]&&Math.max(...ys)>=region[1]-150&&Math.min(...ys)<=region[3]+150)root.CitySpecialBuildings.build3D(batch,f,{material,solid,tinted,car,tree});
    }
    const plants=state.parcels.filter(p=>((p.building&&!['planned','construction'].includes(p.building.status))||p.use==='protected')&&near(p.center)).concat(state.facilities.filter(f=>['park','plaza'].includes(f.kind)&&near(f.point)&&!root.CityLandscape.plan(f)));
    for(const p of plants)for(const t of p.kind==='plaza'?[]:S.treesFor(p)){
      const lot=p.building?parkingFor(p):null;if(lot){const dx=t.point[0]-lot.point[0],dy=t.point[1]-lot.point[1],u=dx*Math.cos(lot.angle)+dy*Math.sin(lot.angle),v=-dx*Math.sin(lot.angle)+dy*Math.cos(lot.angle);if(Math.abs(u)<lot.width/2+t.radius&&Math.abs(v)<lot.depth/2+t.radius)continue;}
      if(p.building){batch.box(...t.point,.03,1.6,1.6,.02,0,material('soil',3));}
      tree(batch,t);
    }
    for(const t of S.streetTreesFor(state))if(near(t.point)){
      if(detailLevel>0){
        batch.bevelBox(...t.point,.12,1.6,1.6,.07,0,solid(0xa9a38d),material('soil',3),.035);
        for(const dy of [-.68,.68])batch.box(t.point[0],t.point[1]+dy,.2,1.5,.12,.04,0,solid(0x59605a,.7,.2));
        for(const dx of [-.68,.68])batch.box(t.point[0]+dx,t.point[1],.2,.12,1.5,.04,0,solid(0x59605a,.7,.2));
      }
      tree(batch,t);
    }
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
    // The already-painted ground becomes one physical surface, so pavements,
    // asphalt and their markings receive the same light as buildings and trees.
    if(groundCanvas.width!==width||groundCanvas.height!==height){groundCanvas.width=width;groundCanvas.height=height;}
    const groundCtx=groundCanvas.getContext('2d');groundCtx.clearRect(0,0,width,height);groundCtx.drawImage(ctx.canvas,0,0);groundTexture.needsUpdate=true;
    ground.position.set(cx,-cy,.005);ground.scale.set(width/sx,height/sy,1);
    const cos=1/Math.sqrt(1+TILT*TILT);camera.left=-width/(2*sx);camera.right=width/(2*sx);camera.top=height/(2*sy)*cos;camera.bottom=-camera.top;
    camera.position.set(cx,-cy-1000*TILT,1000);camera.lookAt(cx,-cy,0);camera.updateProjectionMatrix();
    const cssScale=sx/(root.devicePixelRatio||1);detailLevel=cssScale>=4?2:cssScale>=1.2?1:0;
    const shadowSize=Math.min(renderer.capabilities.maxTextureSize,detailLevel>0?4096:2048);
    if(sun.shadow.mapSize.x!==shadowSize){sun.shadow.mapSize.set(shadowSize,shadowSize);sun.shadow.map?.dispose();sun.shadow.map=null;}
    const region=[cx-width/(2*sx),cy-height/(2*sy),cx+width/(2*sx),cy+height/(2*sy)],regionKey=region.map(n=>Math.floor(n/80)).join(':')+':'+detailLevel;
    if(state.network!==lastNetwork||state.parcels!==lastParcels||regionKey!==lastRegion){rebuild(state,region);lastRegion=regionKey;ambientOcclusionKey='';sceneryKey='';}
    const light=S.lightingAt(S.time),a=light.azimuth*Math.PI/180,elevation=Math.max(12,light.elevation)*Math.PI/180;
    sun.position.set(cx+Math.cos(a)*400,-cy-Math.sin(a)*400,Math.tan(elevation)*400);sun.target.position.set(cx,-cy,0);sun.target.updateMatrixWorld();
    sun.color.set(0xfff4e4).lerp(new T.Color(0xffc785),Math.min(1,light.warmth/.18));sun.intensity=3.6;ambient.intensity=1.15;
    sun.castShadow=light.elevation>0;
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
        const hidden=staticGroup.children.filter(m=>m.userData.alphaFoliage);for(const mesh of hidden)mesh.visible=false;
        carsGroup.visible=false;
        ao.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(camera.projectionMatrix);ao.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);
        renderer.shadowMap.autoUpdate=false;ao.render(renderer,null,null);renderer.shadowMap.autoUpdate=true;
        carsGroup.visible=true;for(const mesh of hidden)mesh.visible=true;
        ambientOcclusionCanvas??=document.createElement('canvas');ambientOcclusionCanvas.width=width;ambientOcclusionCanvas.height=height;
        ambientOcclusionCanvas.getContext('2d').drawImage(renderer.domElement,0,0);ambientOcclusionKey=key;
      }
      ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalCompositeOperation='multiply';ctx.globalAlpha=.36;ctx.drawImage(ambientOcclusionCanvas,0,0);ctx.restore();
    }
    stats={engine:'WebGL / Three.js r180',ambientOcclusion:sx>1,physicalGround:true,detailLevel,vehicleAtlas:!!carAtlas,pedestrianAtlas:root.CityPedestrians.ready,pedestrians,calls:beautyCalls,triangles:beautyTriangles,meshes:staticGroup.children.length,windows:windows.length};return true;
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
