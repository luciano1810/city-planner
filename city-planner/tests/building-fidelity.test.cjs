const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const geometry=require('../renderer/city-geometry.js');

function canvasContext(onColor=()=>{}){
  const gradient={addColorStop(_at,color){onColor(color);}};
  return new Proxy({canvas:{width:64,height:64},getTransform:()=>({a:1,b:0,c:0,d:1,e:0,f:0}),createLinearGradient:()=>gradient},
    {get(target,key){return key in target?target[key]:()=>{};}});
}

test('cached Canvas rendering gives the occupied setback walls windows and paints their roof before the upper storey',()=>{
  const parcel={id:'p-9',center:[14,13],building:{use:'office',status:'active',floors:4,height:13.2,
    footprint:[[0,0],[28,0],[28,26],[0,26],[0,0]]}};
  const before=JSON.stringify(parcel),massing=geometry.buildingMassing(parcel),painted=[],windowCounts=[];let glassPanes=0;
  assert.equal(massing.volumes.length,2,'fixture has a lower terrace and an upper storey');
  const [terrace,upper]=massing.volumes;
  assert.equal(upper.base,terrace.height);
  assert(Math.max(...terrace.points.map(p=>p[1]))>Math.max(...upper.points.map(p=>p[1])),
    'depth-only sorting would wrongly repaint the lower roof over the upper one');
  const window={CityGeometry:geometry,SceneMaterials:require('../renderer/material-catalog.js'),
    SurfaceVariation:require('../renderer/surface-variation.js'),SceneRasterCache:require('../renderer/raster-cache.js'),
    CityOrdinaryRoofs:{drawCanvas(_ctx,_parcel,volume){painted.push(volume);windowCounts.push(glassPanes);}}};
  const document={createElement(){return {width:0,height:0,getContext:()=>canvasContext(color=>{if(color==='#344e60')glassPanes++;})};}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../renderer/scene-renderer.js'),'utf8'),{window,document});
  window.CityScene.configure({quality:'map'});
  window.CityScene.building(canvasContext(),parcel,3);
  assert.deepEqual(painted,[terrace,upper]);
  assert(windowCounts[0]>0,'a multi-storey setback has inhabited walls, not blank terrace bands');
  assert.equal(JSON.stringify(parcel),before,'rendering preserves saved building geometry');
});
