/* Geometry uses source-pixel coordinates; distances use the configured extent.
 * No display pixels or device-pixel ratio enter the metric calculations.
 */
(function (root) {
  'use strict';
  function niceFloor(value) {
    if (!(value > 0)) return 0;
    const power = 10 ** Math.floor(Math.log10(value)), n = value / power;
    return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * power;
  }
  function formatDistance(meters) {
    const value = meters >= 1000 ? meters / 1000 : meters;
    return `${Number(value.toFixed(value < 10 ? 2 : value < 100 ? 1 : 0))} ${meters >= 1000 ? 'km' : 'm'}`;
  }
  function scaleBar(metersPerPixel, maxPixels = 140) {
    if (!(metersPerPixel > 0) || !(maxPixels > 0)) return { meters: 0, pixels: 0 };
    const meters = niceFloor(metersPerPixel * maxPixels);
    return { meters, pixels: meters / metersPerPixel };
  }
  function distance(a, b, widthMeters, heightMeters) {
    return Math.hypot((b[0] - a[0]) * widthMeters, (b[1] - a[1]) * heightMeters);
  }
  function screenToMap(x, y, geometry, width, height) {
    const u = (x - geometry.left) / (width * geometry.scale);
    const v = (y - geometry.top) / (height * geometry.scale);
    return u < 0 || v < 0 || u > 1 || v > 1 ? null : [u, v];
  }
  function unpackMask(bytes, length) {
    const mask = new Uint8Array(length);
    for (let i = 0; i < length; i++) mask[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
    return mask;
  }
  // RDP removes grid stair steps before a shoreline becomes a Bezier path.
  function simplifyLine(points, tolerance = .6) {
    const keep = new Uint8Array(points.length); keep[0] = keep[points.length-1] = 1;
    const stack = [[0,points.length-1]];
    while (stack.length) {
      const [first,last] = stack.pop(), a = points[first], b = points[last];
      const dx = b[0]-a[0], dy = b[1]-a[1], length = dx*dx+dy*dy;
      let best = tolerance*tolerance, index = -1;
      for (let i = first+1; i < last; i++) {
        const p = points[i], t = length ? Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)) : 0;
        const d = (p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2;
        if (d > best) { best = d; index = i; }
      }
      if (index >= 0) { keep[index] = 1; stack.push([first,index],[index,last]); }
    }
    return points.filter((_,i) => keep[i]);
  }
  // Split a closed ring at its furthest vertex so its closure is preserved.
  function simplifyRing(ring, tolerance = .6) {
    if (ring.length < 8) return ring;
    let split = 1, farthest = 0;
    for (let i = 1; i < ring.length; i++) {
      const d = (ring[i][0]-ring[0][0])**2+(ring[i][1]-ring[0][1])**2;
      if (d > farthest) { farthest = d; split = i; }
    }
    const result = [...simplifyLine(ring.slice(0,split+1),tolerance).slice(0,-1),
      ...simplifyLine([...ring.slice(split),ring[0]],tolerance).slice(0,-1)];
    return result.length >= 3 ? result : ring;
  }

  // Fill rings close along the map frame; strokes contain only real contours.
  // Break smoothing at frame contacts so long boundary edges cannot bend inward.
  function traceContours(rings, width, height, fill, stroke) {
    const onFrame = ([x,y]) => x === 0 || y === 0 || x === width || y === height;
    const frameEdge = (a,b) => (a[0] === b[0] && (a[0] === 0 || a[0] === width)) ||
      (a[1] === b[1] && (a[1] === 0 || a[1] === height));
    for (const raw of rings) {
      const start = raw.findIndex(onFrame);
      if (start < 0) {
        const ring = simplifyRing(raw), first = ring[0], last = ring[ring.length-1];
        for (const path of [fill,stroke]) {
          path.moveTo((last[0]+first[0])/2,(last[1]+first[1])/2);
          for (let i = 0; i < ring.length; i++) {
            const p = ring[i], q = ring[(i+1)%ring.length];
            path.quadraticCurveTo(...p,(p[0]+q[0])/2,(p[1]+q[1])/2);
          }
          path.closePath();
        }
        continue;
      }
      const ring = [...raw.slice(start),...raw.slice(0,start),raw[start]];
      fill.moveTo(...ring[0]);
      let from = 0;
      while (from < ring.length-1) {
        if (frameEdge(ring[from],ring[from+1])) {
          fill.lineTo(...ring[++from]);
          continue;
        }
        let to = from+1;
        while (to < ring.length-1 && !onFrame(ring[to])) to++;
        const points = simplifyLine(ring.slice(from,to+1));
        stroke.moveTo(...points[0]);
        for (const path of [fill,stroke]) {
          for (let i = 1; i < points.length-1; i++) {
            const p = points[i], q = points[i+1];
            path.quadraticCurveTo(...p,(p[0]+q[0])/2,(p[1]+q[1])/2);
          }
          path.lineTo(...points[points.length-1]);
        }
        from = to;
      }
      fill.closePath();
    }
  }
  function riverBanks(channel, width, height) {
    const points = channel.points.map(([x,y]) => [x*(width-1)+.5,y*(height-1)+.5]);
    const left = [], right = [], radii = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[Math.max(0,i-1)], q = points[Math.min(points.length-1,i+1)];
      const dx = q[0]-p[0], dy = q[1]-p[1], length = Math.hypot(dx,dy) || 1;
      const radius = Math.max(.05,channel.widths[i]/2);
      const nx = -dy/length*radius, ny = dx/length*radius;
      left.push([points[i][0]+nx,points[i][1]+ny]); right.push([points[i][0]-nx,points[i][1]-ny]); radii.push(radius);
    }
    return { left, right, points, radii };
  }

  // Marching squares with interpolated crossings and an asymptotic saddle
  // decision. A dry padded border closes coastlines and preserves island holes.
  // Padding crossings lie exactly on the frame, independent of scalar magnitude.
  function contours(values, width, height, level = 0, step = 1) {
    const xs = [], ys = [];
    for (let x = 0; x < width - 1; x += step) xs.push(x);
    for (let y = 0; y < height - 1; y += step) ys.push(y);
    xs.push(width - 1); ys.push(height - 1);
    // Extend the outer samples to the frame before adding dry padding. This
    // keeps real contour crossings at their interpolated position at every edge.
    const sampleXs = [xs[0],...xs,xs[xs.length-1]];
    const sampleYs = [ys[0],...ys,ys[ys.length-1]];
    const nx = sampleXs.length + 2, ny = sampleYs.length + 2;
    const field = new Float32Array(nx * ny).fill(-1);
    const px = [-.5, 0, ...xs.map(x => x + .5), width, width + .5];
    const py = [-.5, 0, ...ys.map(y => y + .5), height, height + .5];
    for (let y = 0; y < sampleYs.length; y++)
      for (let x = 0; x < sampleXs.length; x++)
        field[(y + 1) * nx + x + 1] = values[sampleYs[y] * width + sampleXs[x]] - level;
    const nodes = new Map();
    const cases = [[],[3,0],[0,1],[3,1],[1,2],null,[0,2],[3,2],
      [2,3],[0,2],null,[1,2],[1,3],[0,1],[3,0],[]];
    for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
      const i = y * nx + x;
      const a = field[i], b = field[i+1], c = field[i+nx+1], d = field[i+nx];
      const mask = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0);
      if (mask === 0 || mask === 15) continue;
      let pairs = cases[mask];
      if (mask === 5 || mask === 10)
        pairs = a*c - b*d >= 0 ? [0,1,2,3] : [3,0,1,2];
      const ids = [i*2, (i+1)*2+1, (i+nx)*2, i*2+1];
      const corners = [[x,y,a],[x+1,y,b],[x+1,y+1,c],[x,y+1,d]];
      for (let j = 0; j < pairs.length; j += 2) {
        const keys = pairs.slice(j,j+2).map(edge => {
          const key = ids[edge];
          if (!nodes.has(key)) {
            const p = corners[edge], q = corners[(edge+1)%4], t = p[2]/(p[2]-q[2]);
            nodes.set(key, { point: [
              p[0] !== q[0] && x === 0 ? 0 : p[0] !== q[0] && x === nx-2 ? width :
                Math.max(0,Math.min(width,px[p[0]] + t*(px[q[0]]-px[p[0]]))),
              p[1] !== q[1] && y === 0 ? 0 : p[1] !== q[1] && y === ny-2 ? height :
                Math.max(0,Math.min(height,py[p[1]] + t*(py[q[1]]-py[p[1]])))
            ], links: [] });
          }
          return key;
        });
        if ((x === 0 || x === nx-2) && (y === 0 || y === ny-2)) {
          // The padded corner cell represents a square frame corner, not a coast.
          const key = `corner:${x}:${y}`;
          nodes.set(key,{point:[x === 0 ? 0 : width,y === 0 ? 0 : height],links:keys});
          nodes.get(keys[0]).links.push(key); nodes.get(keys[1]).links.push(key);
        } else {
          nodes.get(keys[0]).links.push(keys[1]); nodes.get(keys[1]).links.push(keys[0]);
        }
      }
    }
    const rings = [], seen = new Set();
    for (const start of nodes.keys()) {
      if (seen.has(start)) continue;
      const ring = [];
      let current = start, previous = -1;
      while (!seen.has(current)) {
        seen.add(current);
        const node = nodes.get(current); ring.push(node.point);
        const next = node.links.find(key => key !== previous);
        previous = current; current = next;
        if (current === undefined) break;
      }
      if (ring.length >= 3) rings.push(ring);
    }
    return rings;
  }
  const api = { niceFloor, formatDistance, scaleBar, distance, screenToMap, contours, unpackMask, simplifyRing, traceContours, riverBanks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MapGeometry = api;
})(typeof window === 'undefined' ? {} : window);
