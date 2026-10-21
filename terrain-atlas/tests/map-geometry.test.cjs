const { test } = require('node:test');
const assert = require('node:assert/strict');
const { contours, scaleBar, distance, screenToMap, formatDistance, riverBanks, simplifyRing, unpackMask } = require('../renderer/map-geometry.js');

function contains(rings, x, y) {
  let inside = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])
      inside = !inside;
  }
  return inside;
}

test('water polygons preserve islands, lakes and map boundary coverage', () => {
  const n = 15, values = new Float32Array(n*n).fill(10);
  for (let y = 3; y < 12; y++) for (let x = 3; x < 12; x++) values[y*n+x] = -10;
  for (let y = 6; y < 9; y++) for (let x = 6; x < 9; x++) values[y*n+x] = 10;
  const rings = contours(values,n,n);
  assert.equal(rings.length,3);
  assert.equal(contains(rings,.01,7),true); // Sea touching the map edge.
  assert.equal(contains(rings,4.5,7),false); // Island.
  assert.equal(contains(rings,7.5,7),true); // Lake inside the island.
  for (const ring of rings) for (const [x,y] of ring) {
    assert.ok(Number.isFinite(x) && Number.isFinite(y));
    assert.ok(x >= 0 && y >= 0 && x <= n && y <= n);
  }
});

test('saddle topology follows scalar values instead of joining diagonal water arbitrarily', () => {
  const connected = contours(new Float32Array([4,-1,-1,4]),2,2);
  const separate = contours(new Float32Array([1,-4,-4,1]),2,2);
  assert.equal(connected.length,1);
  assert.equal(separate.length,2);
  assert.equal(contains(connected,1,1),true);
  assert.equal(contains(separate,1,1),false);
});

test('one pixel channel remains connected and dry terrain has no water geometry', () => {
  const data = new Float32Array(15*10).fill(-5);
  for (let x = 0; x < 15; x++) data[5*15+x] = 5;
  const rings = contours(data,15,10);
  assert.equal(rings.length,1);
  for (let x = 1; x < 15; x++) assert.equal(contains(rings,x,5.5),true);
  assert.deepEqual(contours(new Float32Array(16).fill(-2),4,4),[]);
});

test('subsampled contour positions retain original pixel coordinates', () => {
  const data = Float32Array.from({length:35},(_,i) => i%7-2.25);
  const rings = contours(data,7,5,0,3);
  assert.equal(contains(rings,2,2),false);
  assert.equal(contains(rings,3,2),true);
  assert.ok(rings.flat().some(([x]) => Math.abs(x-2.75)<1e-6));
});

test('metric scale uses 1/2/5 steps and shrinks the distance when zooming', () => {
  let previous = Infinity;
  for (const zoom of [1,2,4,8,16,32]) {
    const mpp = 80000/(800*zoom), bar = scaleBar(mpp);
    assert.ok(bar.pixels <= 140 && bar.pixels >= 40);
    assert.equal(bar.pixels*mpp,bar.meters);
    assert.ok(bar.meters < previous); previous = bar.meters;
    assert.ok([1,2,5].includes(bar.meters/10**Math.floor(Math.log10(bar.meters))));
  }
  assert.equal(formatDistance(250),'250 m');
  assert.equal(formatDistance(2500),'2.5 km');
});

test('measurement is unchanged by zoom/pan and handles a non-square extent', () => {
  const expected = distance([.2,.3],[.8,.7],80000,20000);
  for (const scale of [.5,1,12]) {
    const g = {left:-130,top:17,scale}, points = [[.2,.3],[.8,.7]];
    const decoded = points.map(([x,y]) => screenToMap(g.left+x*1000*scale,g.top+y*250*scale,g,1000,250));
    assert.ok(Math.abs(distance(...decoded,80000,20000)-expected)<1e-8);
  }
  assert.equal(screenToMap(0,0,{left:10,top:10,scale:1},100,100),null);
});

test('continuous river banks keep subpixel positions, width variation and shared endpoints', () => {
  const channel = {points:[[.1,.25],[.4,.25],[.8,.25]],widths:[1.2,2.6,4.8]};
  const banks = riverBanks(channel,101,81);
  assert.deepEqual(banks.points,[[10.5,20.5],[40.5,20.5],[80.5,20.5]]);
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(Math.hypot(banks.left[i][0]-banks.right[i][0],banks.left[i][1]-banks.right[i][1])-channel.widths[i])<1e-10);
    assert.ok(Math.abs((banks.left[i][1]+banks.right[i][1])/2-banks.points[i][1])<1e-10);
  }
  const tributary = riverBanks({points:[[.4,.1],[.4,.25]],widths:[1,2]},101,81);
  assert.deepEqual(tributary.points.at(-1),banks.points[1]);
});

test('shoreline simplification removes staircase vertices without removing islands', () => {
  const ring = [];
  for (let x=0;x<30;x++) ring.push([x,x%2*.3]);
  ring.push([29,20],[0,20]);
  const simplified = simplifyRing(ring,.6);
  assert.ok(simplified.length <= 6);
  assert.equal(contains([simplified],15,10),true);
  assert.deepEqual(Array.from(unpackMask(new Uint8Array([0b10100110,0b10000000]),9)),[1,0,1,0,0,1,1,0,1]);
});
