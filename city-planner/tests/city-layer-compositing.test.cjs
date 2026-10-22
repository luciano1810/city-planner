const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../renderer/city.js'),'utf8');
// Execute the production compositor without mounting the editor's unrelated
// forms or starting its backend session. Its renderers are recording doubles.
function section(start,end){
  const from=source.indexOf(start),to=source.indexOf(end,from);
  assert(from>=0&&to>from,'production function boundaries must remain explicit');
  return source.slice(from,to);
}
const compositor=section('  function canCacheBase(){','  function dialog(');

function fixture({labels=false}={}){
  const events=[],texts=[],frames=[],trafficCalls=[],canvas={};
  const parcel=(id,x)=>({id,center:[x,10],points:[[x-10,0],[x+10,0],[x+10,20],[x-10,20]],connected:true,
    building:{use:'office',status:'active',floors:4,name:id,center:[x,10]}});
  const state={meta:{width:1000,height:1000,roadTypes:{}},parcels:[parcel('near',10),parcel('far',410)],
    roads:[],network:{edges:[]},localPaths:[],lines:[],stops:[],districts:[],flows:[],
    facilities:[{id:'hospital',kind:'hospital',name:'Hospital',point:[50,50],depth:20,points:[[40,40],[60,40],[60,60],[40,60]]}]};
  const record=name=>()=>events.push(name);
  const scene={effectiveQuality:'high',settings:{quality:'high',renderer:'textures',labels},time:9*3600,
    streetsideGround:record('base:streetside'),parcel:(_ctx,p)=>events.push('base:parcel:'+p.id),
    facilityGround:record('base:facility-paving'),streetsideParking:record('base:parking'),
    buildingShadows:record('base:building-shadows'),building:(_ctx,p)=>events.push('base:building:'+p.id),
    vegetation:record('base:vegetation'),streetTreesFor:()=>[],medians:record('medians'),material:()=> '#eee',
    atmosphere(_ctx,_state,{traffic}){events.push('atmosphere:'+traffic.frameId);trafficCalls.push({kind:'atmosphere',traffic});}};
  const window={CityScene:scene,CityStreetFurniture:{paint:record('base:furniture')},
    CitySpecialBuildings:{names:{hospital:'Hospital'},ground:record('base:facility-ground'),access:record('base:access'),
      paint2D:record('facility'),night:record('facility-night')},
    RoadRenderer:{paint(_ctx,_state,{stage,levels,traffic}){
      if(stage==='surface'){events.push('base:road-surface');return;}
      const upper=levels.includes(1),kind=upper?'upper':'ground';
      if(upper)events.push('upper-surface');else events.push('ground-signals:'+traffic.frameId);
      const car=traffic.vehicles.find(car=>car.level===(upper?1:0));
      events.push(kind+'-car:'+traffic.frameId);trafficCalls.push({kind,traffic,point:car.point});
    }},
    CityPedestrians:{paint(_ctx,people){events.push('pedestrians:'+people[0].frameId);trafficCalls.push({kind:'pedestrians',people});}}};
  const env={updateRoadValidation(){},trafficMetrics:require('../renderer/traffic-metrics.js'),trafficPeriod:'peak',active:true,state,window,workspace:{terrain:{width:1000,height:1000}},canvas,
    trafficPlayback:{frame(){
      const id=frames.length+1,frame={frameId:id,vehicles:[{level:0,point:[10+id,10]},{level:1,point:[20+id,20]}],
        pedestrians:[{frameId:id,point:[30+id,30]}],signals:[{phase:id%2?'green':'red'}]};
      frames.push(frame);return frame;
    }},
    pointerPosition:null,shapeBounds:new WeakMap(),tool:'select',layer:'use',selected:null,sourceParcel:null,
    colors:{office:'#789'},specialTools:[],panel:'build',lineStops:[],mapHitLabels:[],simulation:{running:true},
    inspectedRoute:null,queryResult:null,renewalSelection:[],renewalPreview:null,draft:[],snapTarget:null,
    hover:null,space:false,editingRoad:null,dragControl:null,specialPreview:null,preview:null};
  vm.runInNewContext(compositor,env);
  function context(onScreen=true){
    let depth=0;
    const ctx={canvas:onScreen?canvas:{},globalAlpha:1,
      save(){depth++;},restore(){depth--;assert(depth>=0,'rendering must balance its canvas state');},
      measureText:text=>({width:text.length*2}),fillText:text=>texts.push(text),get depth(){return depth;}};
    return new Proxy(ctx,{get:(target,key)=>key in target?target[key]:()=>{}});
  }
  return {env,state,events,texts,frames,trafficCalls,context,paint:env.paint,canCacheBase:env.canCacheBase,
    g:{width:100,height:100,scale:1,left:0,top:0}};
}

test('one cached base supports successive live traffic overlays without repeating the heavy scene',()=>{
  const f=fixture(),base=f.context(false),screen=f.context(),saved=JSON.stringify(f.state);
  f.paint(base,f.g,'base');
  assert.equal(f.frames.length,0,'snapshot preparation must not advance traffic interpolation');
  assert.equal(f.events.at(-1),'base:vegetation');
  const baseEvents=f.events.slice();
  f.paint(screen,f.g,'overlay');f.paint(screen,f.g,'overlay');
  assert.deepEqual(f.events.filter(event=>event.startsWith('base:')),baseEvents);
  assert.equal(f.frames.length,2,'each live overlay obtains one shared interpolation frame');
  assert.deepEqual(f.trafficCalls.filter(call=>call.kind==='ground').map(call=>call.point),[[11,10],[12,10]]);
  for(const frame of f.frames){
    for(const kind of ['ground','upper','atmosphere'])assert(f.trafficCalls.some(call=>call.kind===kind&&call.traffic===frame));
    assert(f.trafficCalls.some(call=>call.kind==='pedestrians'&&call.people===frame.pedestrians));
  }
  assert.equal(base.depth,0);assert.equal(screen.depth,0);
  assert.equal(JSON.stringify(f.state),saved,'compositing does not change saved city geometry');
});

test('split and complete compositions retain ground traffic, facilities, walkers, bridges, and light order',()=>{
  const complete=fixture(),split=fixture();
  complete.paint(complete.context(),complete.g);
  split.paint(split.context(false),split.g,'base');split.paint(split.context(),split.g,'overlay');
  assert.deepEqual(split.events,complete.events,'phase boundaries must not move an existing paint pass');
  const ordered=['ground-signals:1','ground-car:1','medians','facility','pedestrians:1','upper-surface','upper-car:1','atmosphere:1','facility-night'];
  for(let i=1;i<ordered.length;i++)assert(split.events.indexOf(ordered[i-1])<split.events.indexOf(ordered[i]),ordered[i]+' keeps its original occlusion order');
});

test('overlay building labels follow the current viewport and scale instead of the cached base',()=>{
  const f=fixture({labels:true}),screen=f.context();
  f.paint(f.context(false),f.g,'base');assert.deepEqual(f.texts,[]);
  f.paint(screen,f.g,'overlay');
  assert(f.texts.includes('near · 4F'));assert(!f.texts.includes('far · 4F'));
  f.texts.length=0;f.paint(screen,{...f.g,left:-400},'overlay');
  assert(f.texts.includes('far · 4F'));assert(!f.texts.includes('near · 4F'));
  f.texts.length=0;f.paint(screen,{...f.g,scale:.6,left:-240},'overlay');
  assert(!f.texts.some(text=>text.endsWith(' · 4F')),'building labels still respect their zoom threshold');
});

test('base caching is limited to an active textured physical detail view',()=>{
  const f=fixture();assert.equal(f.canCacheBase(),true);
  f.env.layer='land';assert.equal(f.canCacheBase(),false);
  f.env.layer='transit';assert.equal(f.canCacheBase(),true);
  f.env.window.CityScene.settings.quality='map';assert.equal(f.canCacheBase(),false);
  f.env.window.CityScene.settings.quality='high';
  f.env.window.CityScene.settings.renderer='webgl';assert.equal(f.canCacheBase(),false);
  f.env.window.CityScene.settings.renderer='textures';f.env.window.CityScene.effectiveQuality='map';assert.equal(f.canCacheBase(),false);
  f.paint(f.context(),f.g,'base');f.paint(f.context(),f.g,'overlay');assert.equal(f.frames.length,0);
  f.env.window.CityScene.effectiveQuality='high';f.env.active=false;assert.equal(f.canCacheBase(),false);
  f.env.active=true;f.env.state=null;assert.equal(f.canCacheBase(),false);
});

test('a large off-tile building remains a shadow candidate at low sun',()=>{
  const f=fixture(),p={id:'long-shadow',center:[230,40],points:[[160,0],[300,0],[300,80],[160,80]],
    building:{use:'office',status:'active',floors:30,center:[230,40]}};
  f.state.parcels.push(p);let shadows=[];
  f.env.window.CityScene.buildingShadows=(_ctx,parcels)=>{shadows=parcels;};
  f.paint(f.context(false),f.g,'base');
  assert(shadows.includes(p),'a 95 metre shadow can enter the tile from a footprint 60 metres away');
});

test('traffic animation requests a composited frame instead of invalidating the base with a synchronous draw',()=>{
  const calls=[],env={active:true,simulation:{running:true},document:{hidden:false},trafficFrame:null,
    workspace:{requestAnimation:()=>calls.push('animation'),draw:()=>calls.push('full-draw')},
    requestAnimationFrame:()=>{calls.push('next-frame');return 7;}};
  vm.runInNewContext(section('  function animateTraffic(){','  function syncTrafficAnimation(){')+'\nanimateTraffic();',env);
  assert.deepEqual(calls,['animation','next-frame']);assert.equal(env.trafficFrame,7);
});

test('traffic replies refresh the clock and live overlay without forcing a new static snapshot',()=>{
  const calls=[],elements=new Map(),el=id=>{
    if(!elements.has(id))elements.set(id,{});return elements.get(id);
  };
  el('signal-demand').value='normal';
  const env={updateRoadValidation(){},trafficMetrics:require('../renderer/traffic-metrics.js'),trafficPeriod:'peak',active:true,state:{simulation:{sampled:false}},simulation:{running:true},el,
    trafficState:{mode:'normal',waiting:0,passed:2,signals:[{phase:'green',remaining:5}],vehicles:[],pedestrians:[]},
    updateSceneClock:()=>calls.push('clock'),updateSimulationControls:()=>calls.push('controls'),
    workspace:{requestAnimation:()=>calls.push('animation'),requestDraw:()=>calls.push('invalidate')}};
  vm.runInNewContext(section('  function updateTraffic() {','  function setTool(')+'\nupdateTraffic();',env);
  assert.deepEqual(calls,['clock','controls','animation']);
});

test('construction hover and pointer leave update overlays without discarding completed textures',()=>{
  const listeners=new Map(),calls=[],env={canvas:{addEventListener:(name,handler)=>listeners.set(name,handler)},
    active:true,pointerPosition:null,hover:null,snapTarget:null,tool:'street',specialTools:[],dragControl:null,
    draft:[],state:{meta:{roadTypes:{street:{}}}},eventPoint:e=>[e.clientX,e.clientY],magneticPoint:p=>p,
    workspace:{requestDraw:()=>calls.push('invalidate'),requestAnimation:()=>calls.push('overlay')}};
  vm.runInNewContext(section("  canvas.addEventListener('pointermove'","  canvas.addEventListener('pointerup'"),env);
  for(let i=0;i<10;i++)listeners.get('pointermove')({clientX:i,clientY:20});
  assert.deepEqual(env.hover,[9,20]);assert.equal(calls.length,10);
  listeners.get('pointerleave')();assert.equal(env.hover,null);
  assert(calls.every(call=>call==='overlay'),'moving a construction preview cannot rebuild the scene underneath it');
});
