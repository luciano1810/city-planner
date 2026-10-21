const test=require('node:test');
const assert=require('node:assert/strict');
const scene=require('../renderer/scene-renderer.js');
const map=require('../renderer/map-renderer.js');

test('overview switches automatically with hysteresis and explicit map choice persists',()=>{
  scene.configure({quality:'high'});
  assert.equal(scene.resolveQuality(.8),'high');
  assert.equal(scene.resolveQuality(.4),'map');
  for(const scale of [.43,.55,.46,.57])assert.equal(scene.resolveQuality(scale),'map');
  assert.equal(scene.resolveQuality(.6),'high');
  assert.equal(scene.resolveQuality(.5),'high');
  scene.configure({quality:'map'});assert.equal(scene.resolveQuality(8),'map');
  scene.configure({quality:'balanced'});assert.equal(scene.settings.quality,'high');
  assert.equal(scene.resolveQuality(.8),'high');
});

test('map roads remain readable at overview scale and suppress small paths and underground links',()=>{
  const road=(kind,level=0)=>({kind,level});
  assert.equal(map.roadStyle(road('lane'),.03,{}).visible,false);
  assert.equal(map.roadStyle(road('path'),.1,{}).visible,false);
  assert.equal(map.roadStyle(road('metro',-1),1,{}).visible,false);
  assert(map.roadStyle(road('avenue'),.01,{}).width>map.roadStyle(road('street'),.01,{}).width);
  assert.equal(map.roadStyle(road('street',1),.01,{}).visible,true);
});

test('flat map renders identical geometry at noon and midnight without texture or image drawing',()=>{
  const points=[[0,0],[0,50],[50,50],[50,0],[0,0]],trace=[];
  const ctx=new Proxy({},{set(o,k,v){trace.push([k,v]);o[k]=v;return true;},get(o,k){return k in o?o[k]:(...args)=>{
    assert(!['drawImage','createPattern','createLinearGradient'].includes(k));trace.push([k,...args]);
  };}});
  const state={parcels:[{id:'p',points,building:{footprint:points,use:'office',status:'active'}}],facilities:[],
    roads:[{id:'r',points:[[0,0],[100,0]],kind:'street',level:0,length:100}],meta:{roadTypes:{street:{width:12}}}};
  const options={scale:.3,inView:()=>true,visible:()=>true,label:()=>{}};
  scene.setTime(12*3600);map.paint(ctx,state,options);const day=trace.slice();trace.length=0;
  scene.setTime(0);map.paint(ctx,state,options);assert.deepEqual(trace,day);
});

test('road label positions use arc length, stay upright and respect non-square projection',()=>{
  const sparse=map.roadCandidates([[0,0],[2,0],[1000,0]],1,1,100);
  assert.deepEqual(sparse[0].point,[500,0]);
  const reversed=map.roadCandidates([[1000,0],[0,0]],1,1,100);
  assert.equal(reversed[0].angle,0);
  const diagonal=map.roadCandidates([[0,0],[1000,1000]],1,2,100);
  assert(Math.abs(diagonal[0].angle-Math.atan2(2,1))<1e-10);
  assert.equal(map.roadCandidates([[0,0],[30,0]],1,1,100).length,0);
  assert.equal(map.roadCandidates([[0,0],[60,0],[60,60]],1,1,98).length,0);
  assert(map.roadCandidates([[0,0],[10000,0]],1,1,80,[100,-50,500,50]).length>0);
});

function labelContext(){return new Proxy({measureText(text){return {width:text.length*12};}},{get(o,k){return k in o?o[k]:()=>{};}});}

test('rotated road names, districts and POIs share collision space and remain within the viewport',()=>{
  const label=(id,x,y,kind,priority)=>({id,text:id,point:[x,y],size:12,color:'#555',align:'center',kind,priority});
  const labels=[label('district',150,150,'district',75),label('park',150,150,'poi',65),label('school',240,240,'poi',55),
    {...label('road',100,150,'road',40),points:[[0,0],[300,300]]},label('outside',-50,20,'poi',55)];
  const placed=map.paintLabels(labelContext(),labels,{scale:1,bounds:[0,0,300,300]});
  assert(placed.some(l=>l.id==='district'));assert(placed.some(l=>l.id==='school'));
  assert(!placed.some(l=>l.id==='park'||l.id==='outside'));
  for(let i=0;i<placed.length;i++)for(let j=i+1;j<placed.length;j++)assert(!map.overlaps(placed[i].box,placed[j].box));
  assert.deepEqual(placed,map.paintLabels(labelContext(),labels.toReversed(),{scale:1,bounds:[0,0,300,300]}));
});

test('POIs can move their names left when the right edge has insufficient space',()=>{
  const placed=map.paintLabels(labelContext(),[{id:'p',text:'park',kind:'poi',point:[270,150],size:13,priority:50}],{scale:1,bounds:[0,0,300,300]});
  assert.equal(placed.length,1);assert(placed[0].box[2]<300);
});

test('every facility category uses a vendored filled icon and arteries are neutral gray',()=>{
  const icons=require('../renderer/map-icons.js');
  for(const kind of ['park','school','hospital','museum','airport','train','police_station','gas_station','unknown'])assert(icons[map.category(kind)[0]].length);
  assert.equal(map.roadStyle({kind:'avenue',level:0},.2,{}).fill,'#d1d2d3');
});

test('map controls reserve label space without changing saved geography',()=>{
  const label={id:'poi',text:'park',point:[80,80],size:13,priority:50,kind:'poi'};
  const before=JSON.stringify(label),obstacle=[0,0,160,160];
  assert.equal(map.paintLabels(labelContext(),[label],{scale:1,bounds:[0,0,300,300],obstacles:[obstacle]}).length,0);
  assert.equal(JSON.stringify(label),before);
  assert.equal(map.paintLabels(labelContext(),[label],{scale:1,bounds:[0,0,300,300]}).length,1);
});

test('long destination names wrap into at most two readable lines',()=>{
  const measure=text=>Array.from(text).length*10;
  assert.deepEqual(map.wrapText('Central University',measure,110),['Central','University']);
  assert.deepEqual(map.wrapText('山海城市公共文化艺术中心',measure,80),['山海城市公共文化','艺术中心']);
  const long=map.wrapText('A'.repeat(50),measure,100);assert.equal(long.length,2);assert(long[1].endsWith('…'));assert(long.every(s=>measure(s)<=100));
});
