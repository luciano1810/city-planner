const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../renderer/service-statistics.js');
const civic=require('../renderer/civic-buildings.js');
test('every current civic and transport kind belongs to exactly one category',()=>{
 const kinds=[...Object.keys(civic.names),'school','clinic','park','plaza','parking_lot','parking_garage','airport','port','train_station'];
 for(const kind of kinds)assert.equal(S.groups.filter(g=>g.kinds.includes(kind)).length,1,kind);
 const state={facilities:kinds.map((kind,i)=>({id:String(i),kind}))};
 assert.equal(S.groups.reduce((n,g)=>n+S.summary(state,g.key).count,0),kinds.length);
 assert.equal(S.summary({facilities:[{kind:'future_service'}]},'other').count,1);
});
test('capacity, parking and maintenance use actual records and preserve missing values',()=>{
 const state={facilities:[{kind:'parking_lot',parkingSpaces:20,maintenance:8,connected:true},{kind:'parking_garage',parkingSpaces:80,maintenance:12,connected:false},{kind:'hospital',capacity:120,visits:37},{kind:'water_plant'}]};
 const parking=S.summary(state,'parking');assert.equal(parking.parkingSpaces,100);assert.equal(parking.maintenance,20);assert.equal(parking.connected,1);
 assert.equal(S.summary(state,'health').visits,37);assert.equal(S.summary(state,'water').capacity,null);
 assert.equal(S.summary(state,'police').count,0);assert.equal(S.subtitle(S.summary({facilities:[{kind:'university',capacity:0,connected:true}]},'education')),'1 处已接入道路');assert.match(S.detail(parking),/实际占用率<\/dt><dd>未模拟/);
 assert.match(S.detail(S.summary(state,'water')),/供水量、用水需求与管网覆盖尚未模拟/);
});
test('facility names and IDs are escaped and a read does not mutate the saved state',()=>{
 const state={facilities:[{id:'" onmouseover="evil',name:'<img src=x>',kind:'school',capacity:40,visits:12}]},before=JSON.stringify(state);
 const html=S.detail(S.summary(state,'education'));assert(!html.includes('<img'));assert(html.includes('&lt;img'));assert.equal(JSON.stringify(state),before);
});
