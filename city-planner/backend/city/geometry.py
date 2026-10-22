"""Metric terrain queries, planar network noding and persistent frontage parcels."""
import hashlib
import math
import random
from collections import defaultdict

import numpy as np
from height_format import decode_heights
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import polygonize, unary_union, substring
from shapely.strtree import STRtree
from shapely import affinity, union_all, box as vector_box, covers
from .parameters import ROAD_TYPES,TRANSIT_TYPES,ROAD_KINDS,FRONTAGE_ROADS,DRIVABLE_ROADS


class RoadConflict(ValueError):
    def __init__(self,message,point,code=None):
        super().__init__(message)
        self.point=list(point)
        self.code=code
def stable_id(prefix, text):
    return prefix + hashlib.sha256(str(text).encode()).hexdigest()[:14]


def group(road):
    return 'road' if road['kind'] in ROAD_KINDS else 'rail' if road['kind'] in ('train', 'metro') else road['kind']


def curve_points(controls, curved=True, spacing=8):
    """Chord-scaled cubic Hermite interpolation shared with the drawing preview."""
    points = [list(map(float, p)) for p in controls]
    if not curved or len(points) < 3:
        return points
    result = [points[0]]
    for i in range(len(points)-1):
        a, b = points[i], points[i+1]
        before, after = points[max(0,i-1)], points[min(len(points)-1,i+2)]
        chord = math.dist(a,b)
        def tangent(p,q):
            length = math.dist(p,q)
            return [(q[k]-p[k])*chord/max(chord,length,1) for k in (0,1)]
        ta, tb = tangent(before,b), tangent(a,after)
        n = max(2,min(512,math.ceil(chord/spacing)))
        for j in range(1,n+1):
            t=j/n; t2=t*t; t3=t2*t
            result.append([(2*t3-3*t2+1)*a[k]+(t3-2*t2+t)*ta[k]+(-2*t3+3*t2)*b[k]+(t3-t2)*tb[k] for k in (0,1)])
    return result


class Terrain:
    def __init__(self, data):
        self.data = data
        self.w, self.h = data['width'], data['height']
        self.width = float(data['grid']['widthMeters'])
        self.height = float(data['grid']['heightMeters'])
        self.elevation, water, self.sea, tolerance = decode_heights(data)
        self.wet = (self.elevation < self.sea) | (water > self.elevation + tolerance)
        self.rivers = []
        for channel in data.get('channels', []):
            if len(channel['points']) > 1:
                pts = [(x * self.width, y * self.height) for x, y in channel['points']]
                radius = max(channel.get('widths', [1])) * self.width / self.w / 2
                self.rivers.append(LineString(pts).buffer(max(1, radius)))
        self.river_geometry = unary_union(self.rivers) if self.rivers else Polygon()
        self.bounds = box(0, 0, self.width, self.height)
        # Coarse coastline index is an environmental proxy, never a flood probability.
        stride=max(1,math.ceil(max(self.w,self.h)/128))
        iy,ix=np.nonzero(self.wet[::stride,::stride])
        self.water_points=[Point(float(x*stride*self.width/self.w),float(y*stride*self.height/self.h)) for x,y in zip(ix,iy)]
        self.water_tree=STRtree(self.water_points) if self.water_points else None
        self.feature_cache={}

    def sample(self, p):
        x, y = p
        if not (0 <= x <= self.width and 0 <= y <= self.height):
            return {'water': True, 'height': 0, 'slope': 1}
        ix = min(self.w - 1, max(0, round(x / self.width * (self.w - 1))))
        iy = min(self.h - 1, max(0, round(y / self.height * (self.h - 1))))
        x0, x1 = max(0, ix - 1), min(self.w - 1, ix + 1)
        y0, y1 = max(0, iy - 1), min(self.h - 1, iy + 1)
        dx = (self.elevation[iy, x1] - self.elevation[iy, x0]) / max(1, (x1 - x0) * self.width / self.w)
        dy = (self.elevation[y1, ix] - self.elevation[y0, ix]) / max(1, (y1 - y0) * self.height / self.h)
        fx=x/self.width*(self.w-1);fy=y/self.height*(self.h-1)
        bx,by=int(fx),int(fy);tx,ty=fx-bx,fy-by
        bx1,by1=min(self.w-1,bx+1),min(self.h-1,by+1)
        height=(self.elevation[by,bx]*(1-tx)*(1-ty)+self.elevation[by,bx1]*tx*(1-ty)+self.elevation[by1,bx]*(1-tx)*ty+self.elevation[by1,bx1]*tx*ty)
        return {'water': bool(self.wet[iy, ix]),
                'height': float(height - self.sea),
                'slope': math.hypot(dx, dy)}

    def buildable(self, shape, max_slope=.32):
        if not self.bounds.covers(shape) or self.river_geometry.intersects(shape):
            return False
        # Thin/rotated parcels can contain no bounding-grid sample at all.
        probes=[shape.representative_point().coords[0]]
        if shape.geom_type=='Polygon':probes.extend(shape.exterior.coords)
        for point in probes:
            value=self.sample(point)
            if value['water'] or value['slope']>max_slope:return False
        minx, miny, maxx, maxy = shape.bounds
        # Sample every underlying terrain cell in a parcel, including its boundary.
        step = max(4, min(20, self.width / self.w, self.height / self.h))
        for x in np.linspace(minx, maxx, max(2, math.ceil((maxx - minx) / step) + 1)):
            for y in np.linspace(miny, maxy, max(2, math.ceil((maxy - miny) / step) + 1)):
                if shape.covers(Point(x, y)):
                    value = self.sample((x, y))
                    if value['water'] or value['slope'] > max_slope:
                        return False
        return True

    def features(self, shape):
        key=shape.wkb
        if key in self.feature_cache:
            return dict(self.feature_cache[key])
        center=shape.centroid
        points=[center.coords[0]]
        if shape.geom_type=='Polygon':
            points+=list(shape.exterior.coords)[::max(1,len(shape.exterior.coords)//12)]
        else:
            points+=list(shape.coords)[::max(1,len(shape.coords)//12)]
        samples=[self.sample(p) for p in points]
        water_distance=min(self.width,self.height)
        if self.water_tree is not None:
            water_distance=center.distance(self.water_points[int(self.water_tree.nearest(center))])
        if not self.river_geometry.is_empty:
            water_distance=min(water_distance,center.distance(self.river_geometry))
        elevation=sum(s['height'] for s in samples)/len(samples)
        slope=sum(s['slope'] for s in samples)/len(samples)
        relief=max(s['height'] for s in samples)-min(s['height'] for s in samples)
        lowland=max(0,1-max(0,elevation)/20)*math.exp(-water_distance/180)
        scenic=math.exp(-water_distance/350)*.8+min(.25,max(0,elevation)/3000)
        cost=1+slope*3+min(.6,relief/45)+lowland*.45
        value=dict(elevation=round(elevation,2),slope=round(slope,4),maxSlope=round(max(s['slope'] for s in samples),4),
                   relief=round(relief,2),waterDistance=round(water_distance,1),lowland=round(lowland,3),
                   scenic=round(scenic,3),costFactor=round(cost,3),suitability=round(max(0,1-slope*2-lowland*.35),3),
                   maxFloors=max(2,int(28/(1+slope*15+lowland*3))))
        self.feature_cache[key]=value
        return dict(value)

    def profile(self,line,kind,level=0):
        n=max(2,math.ceil(line.length/25)+1)
        values=[self.sample(line.interpolate(i/(n-1),normalized=True).coords[0])['height'] for i in range(n)]
        ascent=sum(max(0,b-a) for a,b in zip(values,values[1:]))
        descent=sum(max(0,a-b) for a,b in zip(values,values[1:]))
        grade=(ascent+descent)/max(1,line.length) if not level else abs(values[-1]-values[0])/max(1,line.length)*.25
        free=line.length/1000/ROAD_TYPES[kind]['speed']*60
        return dict(ascent=round(ascent,2),descent=round(descent,2),grade=round(grade,4),
                    freeTime=free*(1+min(2,grade*3)),walkTime=line.length/80*(1+min(3,grade*5)),
                    costFactor=round(1+min(2,grade*4)+(2 if level else 0),3),
                    terrainCapacity=max(.55,1-grade*1.5))

    def valid_link(self, line, kind, level):
        if not self.bounds.covers(line):
            raise RoadConflict('道路超出地图范围',next(p for p in line.coords if not self.bounds.covers(Point(p))))
        if level != 0:
            return
        if self.river_geometry.intersects(line):
            raise RoadConflict('路线穿过河流，请选择高架桥或隧道',self.river_geometry.intersection(line).representative_point().coords[0])
        # Road grade is rise/run along the alignment, not the terrain's
        # steepest gradient: a contour road can cross a steep hillside level.
        # Sample each segment separately so switchbacks and short uphill legs
        # cannot cancel one another. Respect both raster axes on narrow maps.
        step = min(20, self.width / max(1, self.w-1) / 2,
                   self.height / max(1, self.h-1) / 2)
        samples = [tuple(line.coords[0])]
        for a, b in zip(line.coords, list(line.coords)[1:]):
            count = max(1, math.ceil(math.dist(a, b) / step))
            samples.extend(tuple(a[k]+(b[k]-a[k])*i/count for k in (0,1))
                           for i in range(1, count+1))
        limit = ROAD_TYPES[kind]['maxGrade']
        heights = []
        for point in samples:
            value = self.sample(point)
            if value['water']:
                raise RoadConflict('路线穿过水面，请选择高架桥或隧道',point)
            heights.append(value['height'])
        # Water takes precedence over the steep riverbank leading into it.
        for a, b, ha, hb in zip(samples, samples[1:], heights, heights[1:]):
            distance = math.dist(a, b)
            grade = abs(hb-ha) / distance if distance > 1e-8 else 0
            # Float32 height storage slightly perturbs an exact-limit incline.
            if grade > limit + 1e-5:
                midpoint = [(x+y)/2 for x,y in zip(a,b)]
                raise RoadConflict(f'道路纵坡过大（{grade:.1%}，上限 {limit:.1%} / {math.degrees(math.atan(limit)):.1f}°），请沿等高线绕行、增加折返点或使用隧道',midpoint,code='grade')


def road_contacts(road, other, shape=None, other_shape=None, tolerance=.05):
    """Shared topology for graph construction and previews, in world metres.

    Projected endpoints can miss a curve by floating-point roundoff. Only
    endpoints get a distance tolerance; close parallel interiors never connect.
    """
    if group(road) != group(other):
        return
    shape = shape if shape is not None else LineString(road['points'])
    other_shape = other_shape if other_shape is not None else LineString(other['points'])

    def compatible(a, b, point):
        if road['level'] == other['level']:
            if group(road)=='rail' and (road.get('railManaged') or other.get('railManaged')):
                if any(Point(p).distance(point)<=tolerance for p in road.get('railJunctions',[])+other.get('railJunctions',[])):return True
                # Simple endpoint continuation is legal without a branch switch.
                return min(a,shape.length-a)<tolerance and min(b,other_shape.length-b)<tolerance
            return True
        # Old saves retain their endpoint links. New roads must name the
        # magnetic target explicitly; a geometric crossing is not a ramp.
        if 'connections' not in road and 'connections' not in other:
            return min(a, shape.length-a, b, other_shape.length-b) < tolerance
        for source, target, distance, length in ((road, other, a, shape.length),
                                                  (other, road, b, other_shape.length)):
            if min(distance, length-distance) > tolerance:
                continue
            if any(c['road'] == target['id'] and Point(c['point']).distance(point) <= tolerance
                   for c in source.get('connections', [])):
                return True
        return False

    def points(geometry):
        if geometry.is_empty:
            return
        if geometry.geom_type == 'Point':
            yield geometry
        elif geometry.geom_type == 'LineString':
            yield Point(geometry.coords[0])
            yield Point(geometry.coords[-1])
        elif hasattr(geometry, 'geoms'):
            for part in geometry.geoms:
                yield from points(part)

    for point in points(shape.intersection(other_shape)):
        a, b = shape.project(point), other_shape.project(point)
        if compatible(a, b, point):
            yield a, b, point
    for source, target, reverse in ((shape, other_shape, False), (other_shape, shape, True)):
        for distance in (0., source.length):
            endpoint = source.interpolate(distance)
            projected = target.project(endpoint)
            point = target.interpolate(projected)
            if endpoint.distance(point) <= tolerance:
                a, b = (projected, distance) if reverse else (distance, projected)
                if compatible(a, b, point):
                    yield a, b, point


def road_junctions(roads, shapes, nodes, edges):
    """Derive road furniture from actual graph incidence, not frontage cuts."""
    road_map = {r['id']: r for r in roads}
    incident = defaultdict(list)
    for edge in edges:
        if edge['kind'] in ROAD_KINDS:
            incident[edge['a']].append((edge, 1))
            incident[edge['b']].append((edge, -1))
    junctions = []
    for node, entries in incident.items():
        if len(entries) < 3:
            continue
        point = nodes[node]
        approaches = []
        for edge, direction in entries:
            road = road_map[edge['road']]
            distance = edge['startDistance'] if direction == 1 else edge['endDistance']
            # Use this edge's endpoint, not project(), which picks the first
            # occurrence of a closed road's shared start/end coordinate.
            segment = LineString(edge['points'])
            sample = segment.interpolate(min(8, segment.length/2) if direction == 1
                                         else max(segment.length/2, segment.length-8))
            dx, dy = sample.x-point[0], sample.y-point[1]
            length = math.hypot(dx, dy)
            if length < .01:
                continue
            approaches.append(dict(road=road['id'], kind=road['kind'], level=road['level'],
                                   width=ROAD_TYPES[road['kind']]['width'], distance=distance,
                                   direction=direction, tangent=[dx/length, dy/length],
                                   incoming=direction == -1 or not road['oneway'],
                                   outgoing=direction == 1 or not road['oneway']))
        drive = [a for a in approaches if a['kind'] in DRIVABLE_ROADS]
        ground = all(a['level'] == 0 for a in approaches)
        local = ground and all(a['kind'] not in ('motorway', 'highway') for a in approaches)
        if len(approaches) >= 3 and drive:
            signals = local and len(drive) >= 3 and any(a['kind'] in ('street', 'avenue') for a in drive)
            levels = {a['level'] for a in approaches}
            junctions.append(dict(id=node, point=point, level=next(iter(levels)) if len(levels) == 1 else 0,
                                  approaches=approaches, control='signals' if signals else 'priority',
                                  crossings=local))
    return junctions


def make_network(roads, stops, terrain, parcels=(), rail_stations=()):
    """Split same-layer crossings; bridge/tunnel endpoints are explicit ramps."""
    shapes = {r['id']: LineString(r['points']) for r in roads}
    road_map = {r['id']: r for r in roads}
    cuts = {r['id']: {0., shapes[r['id']].length} for r in roads}
    for rid, shape in shapes.items():
        if shape.is_ring:
            # A ring needs two graph edges; equal endpoint IDs do not mean
            # the entire road has zero length.
            cuts[rid].add(shape.length/2)
    # All incident roads share one coordinate, including multi-way contacts.
    anchors, parents, anchor_points = {}, [], []

    def root(index):
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def connect(rid, distance, other_id, other_distance, point):
        keys = []
        for road_id, d in ((rid, distance), (other_id, other_distance)):
            closest = min(cuts[road_id], key=lambda value: abs(value-d))
            if abs(closest-d) < 1e-6:
                d = closest
            cuts[road_id].add(d)
            keys.append((road_id, d))
        existing = [root(anchors[k]) for k in keys if k in anchors]
        if existing:
            index = min(existing)
            for previous in existing:
                parents[previous] = index
        else:
            index = len(parents)
            parents.append(index)
            anchor_points.append((round(point.x, 2), round(point.y, 2)))
        for key in keys:
            anchors[key] = index
    for rid, shape in shapes.items():
        if shape.is_ring:
            connect(rid, 0., rid, shape.length, Point(shape.coords[0]))
    for parcel in parcels:
        shape=shapes.get(parcel['road'])
        if shape is not None and shape.distance(Point(parcel['frontage']))<3:
            cuts[parcel['road']].add(shape.project(Point(parcel['frontage'])))
    tree_shapes = list(shapes.values())
    tree = STRtree(tree_shapes)
    for i, road in enumerate(roads):
        shape = tree_shapes[i]
        for j in tree.query(shape.buffer(.05)):
            j = int(j)
            if j <= i:
                continue
            other = roads[j]
            for a, b, point in road_contacts(road, other, shape, tree_shapes[j]):
                connect(road['id'], a, other['id'], b, point)
    for station in rail_stations:
        for entry in station.get('entrances',[]):
            rid=entry.get('road')
            if rid in shapes:
                cuts[rid].add(shapes[rid].project(Point(entry.get('accessPoint',entry['point']))))
    stop_projection = {}
    for stop in stops:
        compatible = [r for r in roads if r['kind'] in FRONTAGE_ROADS] if stop['mode']=='bus' else [r for r in roads if group(r)==group({'kind':stop['mode']})]
        if stop.get('railPlatform'):
            compatible=[r for r in compatible if r['id']==stop['track'] and r['level']==stop['level']]
        if stop.get('curb'):
            compatible = [r for r in roads if r['id'] == stop.get('road') and r['kind'] in DRIVABLE_ROADS]
        if not compatible:
            stop_projection[stop['id']] = None
            continue
        r = min(compatible, key=lambda r: (shapes[r['id']].distance(Point(stop['point'])), r['id']))
        shape = shapes[r['id']]
        if shape.distance(Point(stop['point'])) > 90:
            stop_projection[stop['id']] = None
            continue
        d = shape.project(Point(stop.get('anchor', stop['point'])))
        cuts[r['id']].add(d)
        p = list(shape.interpolate(d).coords[0])
        access = None
        ground = [r2 for r2 in roads if r2['level'] == 0 and ROAD_TYPES[r2['kind']]['walk'] and group(r2) == 'road']
        if ground:
            rr = min(ground, key=lambda r2: (shapes[r2['id']].distance(Point(p)), r2['id']))
            gg = shapes[rr['id']]
            dd = gg.project(Point(p))
            q = list(gg.interpolate(dd).coords[0])
            link = LineString([p, q])
            if link.length <= 250 and (link.length < 1 or terrain.buildable(link.buffer(.1), 1)):
                cuts[rr['id']].add(dd)
                access = (rr['id'], dd, q)
        stop_projection[stop['id']] = (r['id'], d, p, access)
    # A confirmed contact must have one layer ID even when its snapped
    # coordinate differs from the original ramp endpoint by centimetres.
    contact_levels = defaultdict(set)
    for (rid, _), anchor in anchors.items():
        contact_levels[root(anchor)].add(road_map[rid]['level'])
    nodes, edges, positions = {}, [], {}
    for road in roads:
        shape = shapes[road['id']]
        distances = sorted(cuts[road['id']])
        ids = []
        for d in distances:
            p = shape.interpolate(d)
            anchor = anchors.get((road['id'], d))
            xy = anchor_points[root(anchor)] if anchor is not None else (round(p.x, 2), round(p.y, 2))
            level = road['level']
            if anchor is not None:
                levels = contact_levels[root(anchor)]
                level = next(iter(levels)) if len(levels) == 1 else 0
            suffix=(':'+road['id']) if road.get('railManaged') and anchor is None else ''
            nid = f'{group(road)}:{level}:{xy[0]}:{xy[1]}{suffix}'
            nodes[nid] = list(xy)
            positions[(road['id'], round(d, 3))] = nid
            ids.append(nid)
        for i, (a, b) in enumerate(zip(distances, distances[1:])):
            # A frontage or stop may lie centimetres from a junction. Dropping
            # that short edge severs the entire road on one side of the cut.
            if b - a <= 1e-7 or ids[i] == ids[i+1]:
                continue
            edge_shape = substring(shape, a, b)
            edge_points = [list(p) for p in edge_shape.coords]
            edge_points[0], edge_points[-1] = nodes[ids[i]], nodes[ids[i+1]]
            profile=terrain.profile(edge_shape,road['kind'],road['level'])
            edges.append(dict(id=f"{road['id']}:{i}", road=road['id'], a=ids[i], b=ids[i+1],
                              length=b-a, points=edge_points, startDistance=a, endDistance=b,
                              kind=road['kind'], level=road['level'], oneway=road['oneway'],
                              traffic=0., ratio=0., time=profile['freeTime'], **profile))
    attachments = {}
    stopmap = {s['id']: s for s in stops}
    for sid, result in stop_projection.items():
        if result is None:
            attachments[sid] = None
            continue
        rid, d, p, access = result
        attachments[sid] = dict(node=positions[(rid, round(d, 3))], point=p, access=None)
        stop = stopmap[sid]
        if stop.get('curb'):
            shape = shapes[rid]
            a, b = shape.interpolate(max(0, d-.1)), shape.interpolate(min(shape.length, d+.1))
            dx, dy = b.x-a.x, b.y-a.y
            offset = (ROAD_TYPES[road_map[rid]['kind']]['width']/2+.8)*stop['side']/max(math.hypot(dx,dy),.001)
            attachments[sid]['curbPoint'] = [p[0]-dy*offset,p[1]+dx*offset]
        if access:
            ar, ad, ap = access
            attachments[sid]['access'] = dict(node=positions[(ar, round(ad, 3))], point=ap,
                                             minutes=math.dist(p, ap)/80 + 1)
    ground_lines = [shapes[r['id']] for r in roads if r['level'] == 0 and group(r) == 'road']
    blocks = []
    for p in polygonize(unary_union(ground_lines)):
        blocks.append(dict(id=stable_id('block-', p.wkt), points=[list(q) for q in p.exterior.coords], area=p.area))
    return dict(nodes=nodes, edges=edges, stops=attachments, blocks=blocks,
                junctions=road_junctions(roads, shapes, nodes, edges))


def _industrial_footprint(parcel, use, intensity=0, maximum=math.inf):
    """Fit a coherent hall inside the site, rather than copying its jagged edge.

    A bounded grid search finds a large street-aligned inscribed rectangle.
    Every cell must be fully covered by the setback envelope (including holes),
    so neither the search nor the final sizing can bridge a notch or cross land.
    The result is approximate, not a globally maximal inscribed rectangle.
    """
    envelope=Polygon(parcel['points']).buffer(-2,join_style=2)
    if envelope.is_empty:return None
    angle=parcel.get('streetAngle')
    if angle is None:
        # Legacy vacant parcels may lack a tangent. Use the site's long axis,
        # never the diagonal from a stale entrance to an assembled centroid.
        corners=list(envelope.minimum_rotated_rectangle.exterior.coords)
        a,b=max(zip(corners,corners[1:]),key=lambda pair:math.dist(*pair))
        angle=math.degrees(math.atan2(b[1]-a[1],b[0]-a[0]))
    origin=parcel['frontage']
    local=affinity.rotate(envelope,-angle,origin=origin)
    if local.centroid.y<origin[1]:
        angle+=180;local=affinity.rotate(envelope,-angle,origin=origin)
    x0,y0,x1,y1=local.bounds
    xs=np.linspace(x0+1e-5,x1-1e-5,49)
    ys=np.linspace(y0+1e-5,y1-1e-5,33)
    cells=vector_box(xs[:-1][None,:],ys[:-1,None],xs[1:][None,:],ys[1:,None])
    inside=covers(local,cells)
    heights=[0]*48;best=None;best_score=(-1,-math.inf)
    # Largest rectangle in a histogram: O(rows * columns) after exact coverage.
    for row,covered in enumerate(inside):
        heights=[h+1 if ok else 0 for h,ok in zip(heights,covered)]
        stack=[]
        for right in range(49):
            height=heights[right] if right<48 else 0;left=right
            while stack and stack[-1][1]>height:
                start,tall=stack.pop();left=start
                bounds=(xs[start],ys[row+1-tall],xs[right],ys[row+1])
                width=bounds[2]-bounds[0];depth=bounds[3]-bounds[1]
                score=(width*depth,-bounds[1])
                if min(width,depth)>=6 and score>best_score:
                    best=bounds;best_score=score
            if height and (not stack or stack[-1][1]<height):stack.append((left,height))
    if best is None:return None
    rng=random.Random(stable_id('hall-',(parcel['id'],use)))
    coverage=rng.uniform(.64,.82) if use=='industrial' else rng.uniform(.70,.88)
    target=min(maximum,envelope.area*min(.92,coverage+max(0,min(1,intensity))*.05),best_score[0])
    if target<100:return None
    a,b,c,d=best
    # Vary width/depth without cutting walls to match individual lot seams.
    factor=target/best_score[0]
    sx=factor**rng.uniform(.25,.45);sy=factor/sx
    inset=(c-a)*(1-sx)/2
    hall=box(a+inset,b,c-inset,b+(d-b)*sy)
    footprint=affinity.rotate(hall,angle,origin=origin)
    return footprint if envelope.buffer(1e-6).covers(footprint) else None


def building_footprint(parcel,use,intensity=0,maximum=math.inf):
    """Front-facing urban buildings, with open land behind rather than all around.

    Floorplate limits shorten depth, never shrink a building into the middle of
    an oversized plot. Workshops and warehouses retain their service setbacks.
    """
    if use in ('industrial','warehouse') and not parcel.get('block'):
        return _industrial_footprint(parcel,use,intensity,maximum)
    rng=random.Random(stable_id('streetwall-',(parcel['id'],use)))
    setback=(1 if use in ('commercial','office') else 1.4)+rng.random()*.6
    varied=parcel.get('layoutVersion',0)>=7
    if varied:
        setback=rng.uniform(.45,1.1) if parcel['blockLayout'] in ('frontage','court','mews') else rng.uniform(1.2,2.7)
    envelope=Polygon(parcel['points']).buffer(-setback)
    if envelope.is_empty or envelope.geom_type!='Polygon':return None
    origin=parcel['frontage']
    angle=math.degrees(math.atan2(parcel['center'][1]-origin[1],parcel['center'][0]-origin[0]))-90
    if parcel.get('streetAngle') is not None:
        angle=parcel['streetAngle']
        if affinity.rotate(envelope.centroid,-angle,origin=origin).y<origin[1]:angle+=180
    local=affinity.rotate(envelope,-angle,origin=origin)
    x0,y0,x1,y1=local.bounds
    # Small side variation keeps facades individual without creating detached
    # objects. Every candidate still intersects the same valid land envelope.
    inset=(x1-x0)*rng.uniform(0,.025)
    x0+=inset;x1-=inset
    coverage=rng.uniform(.69,.83) if use=='residential' else rng.uniform(.78,.91)
    if parcel.get('block'):
        maximum=math.inf
        coverage=rng.uniform(.88,.95) if parcel.get('blockLayout')=='single' else rng.uniform(.78,.89)
    if varied and parcel['blockLayout']!='single':
        coverage=rng.uniform(.60,.82) if use=='residential' else rng.uniform(.72,.92)
        if parcel['blockLayout']=='garden' and use in ('residential','office'):coverage=rng.uniform(.46,.66)
        # Slender offices can rise with the market rather than consuming the
        # entire site's demand in a single enormous floorplate.
        if use=='office' and local.area>950:maximum=rng.uniform(420,780)
    if parcel.get('terrain',{}).get('slope',0)>.20:maximum=min(maximum,240.)
    target=min(maximum,local.area*min(.95,coverage+intensity*.06))
    lo,hi=y0,y1
    for _ in range(18):
        mid=(lo+hi)/2
        if local.intersection(box(x0,y0-.1,x1,mid)).area>target:hi=mid
        else:lo=mid
    footprint=local.intersection(box(x0,y0-.1,x1,lo))
    if footprint.geom_type!='Polygon' or footprint.area<100:return None
    if (not parcel.get('block') or varied and parcel['blockLayout']!='single') and use in ('residential','commercial','office') and footprint.area>300 and rng.random()<(.55 if varied else .28):
        # Courtyards open to the rear; the street facade remains continuous.
        a,b,c,d=footprint.bounds
        if varied and rng.random()<.6:
            notch=box(a+(c-a)*rng.uniform(.48,.70),b+(d-b)*rng.uniform(.38,.65),c+1,d+1)
        else:notch=box(a+(c-a)*.34,b+(d-b)*.5,a+(c-a)*.68,d+1)
        cut=footprint.difference(notch)
        if cut.geom_type=='Polygon' and cut.area>=100:footprint=cut
    return affinity.rotate(footprint,angle,origin=origin)


def frontage_lots(road):
    """Continuous variable-width lots; stable per road and independent of time."""
    rng=random.Random(stable_id('lots-',road['id']))
    length=LineString(road['points']).length
    d=16.;index=0
    while d<length-20:
        width=rng.uniform(14,23) if road['kind']=='lane' else rng.uniform(18,30)
        width=min(width,length-12-d)
        if width<12:break
        yield index,d+width/2,width
        d+=width+.6;index+=1


def branch_anchors(road):
    """Shared access reservations and growth anchors, including short lanes."""
    length=LineString(road['points']).length
    if road['kind']=='lane':
        return [(f'short-{d}',d) for d in range(80,int(length-35),156)]
    return [(index,35+index*52) for index in range(3,max(4,int((length-35)/52)),6)
            if 35+index*52<=length-50]


def parcels_for(roads, old, terrain, reserves=(), affected=None):
    """Recompute only affected road frontages; retain occupied and remote geometry."""
    shapes={r['id']:LineString(r['points']) for r in roads}
    land_roads=[r for r in roads if r['level']==0 and r['kind'] in FRONTAGE_ROADS]
    road_areas=[shapes[r['id']].buffer(ROAD_TYPES[r['kind']]['width']/2+2) for r in roads if r['level']==0]
    reserved=[LineString(p['points']).buffer(6) for p in reserves]
    planned_blocks=unary_union([Polygon(p['block']) for p in reserves if p.get('block')])
    blockers=road_areas+reserved
    blocker_tree=STRtree(blockers)
    oldmap={p['id']:p for p in old}
    result=[];occupied=[];occupied_ids=[]
    # Retain developed/explicitly reserved land even when its access disappears.
    # This is also the fast path for remote parcels after a local road edit.
    for p in old:
        if p.get('renewalProject') or p.get('block') or p.get('building') or p.get('openSpace') or p['use']=='protected' or (affected is not None and p['road'] not in affected and p['road'] in shapes):
            result.append(p);occupied.append(Polygon(p['points']));occupied_ids.append(p['id'])
    present=set(occupied_ids);tree=STRtree(occupied);indexed=len(occupied)
    for r in land_roads:
        if affected is not None and r['id'] not in affected:continue
        shape=shapes[r['id']];half=ROAD_TYPES[r['kind']]['width']/2
        anchors=branch_anchors(r)
        for index,d,width in frontage_lots(r):
            point=shape.interpolate(d)
            a,b=shape.interpolate(max(0,d-1)),shape.interpolate(min(shape.length,d+1))
            norm=a.distance(b)
            if norm<.001:continue
            tx,ty=(b.x-a.x)/norm,(b.y-a.y)/norm
            for side in (-1,1):
                pid=stable_id('p-',(r['id'],index,side))
                if pid in present:continue
                existing=oldmap.get(pid)
                if existing and shape.distance(Point(existing['frontage']))>3:existing=None
                rng=random.Random(pid);nx,ny=-ty*side,tx*side
                depth=rng.uniform(30,46) if r['kind']=='lane' else rng.uniform(36,54)
                corners=[(point.x+tx*u+nx*v,point.y+ty*u+ny*v) for u,v in [(-width/2,half+2.5),(width/2,half+2.5),(width/2,half+depth),(-width/2,half+depth)]]
                candidate=Polygon(existing['points']) if existing else Polygon(corners)
                near=[blockers[int(j)] for j in blocker_tree.query(candidate)]
                # Reserve future perpendicular access on otherwise open roads.
                for _,dist in anchors:
                    clearance=12 if r['kind']=='lane' else 6
                    if abs(d-dist)<width/2+clearance:
                        anchor=shape.interpolate(dist)
                        # A distant block plan must not remove this open
                        # frontage's future branch corridor. Only the side
                        # inside a planned block uses its internal reservations.
                        if not r.get('generated') and planned_blocks.covers(Point(anchor.x+nx*30,anchor.y+ny*30)):continue
                        near.append(LineString([(anchor.x,anchor.y),(anchor.x+nx*100,anchor.y+ny*100)]).buffer(clearance))
                if near and candidate.intersection(unary_union(near)).area>1e-7:candidate=candidate.difference(unary_union(near))
                nearby=[occupied[int(j)] for j in tree.query(candidate)]+[q for q in occupied[indexed:] if q.intersects(candidate)]
                if nearby:
                    # Almost-coincident curved parcel edges can make a floating
                    # union lose an interior face even when each polygon is
                    # valid. Node the reservation mask at sub-millimetre
                    # precision before subtracting it from new frontage land.
                    reserved_land=union_all(nearby,grid_size=1e-7)
                    candidate=candidate.difference(reserved_land)
                parts=list(candidate.geoms) if candidate.geom_type=='MultiPolygon' else [candidate]
                parts=[q for q in parts if q.geom_type=='Polygon' and q.is_valid and not q.interiors and q.area>=220 and q.buffer(-2).area>=130 and q.distance(point)<=half+8]
                if not parts:continue
                candidate=max(parts,key=lambda q:q.area)
                if not terrain.buildable(candidate, .45):continue
                center=candidate.centroid
                value=dict(existing) if existing else dict(id=pid,building=None,landValue=80.,rent=9.,use='auto',age=0)
                value.update(road=r['id'],points=[list(q) for q in candidate.exterior.coords],center=[center.x,center.y],area=round(candidate.area,2),frontage=[point.x,point.y],streetAngle=math.degrees(math.atan2(ty,tx)),connected=True)
                if existing:value['frontage']=existing['frontage']
                value['terrain']=terrain.features(candidate);value['buildableArea']=round(candidate.area,2)
                value['source']='automatic' if r.get('generated') else 'frontage'
                result.append(value);occupied.append(candidate);occupied_ids.append(pid);present.add(pid)
                if len(occupied)-indexed>=64:tree=STRtree(occupied);indexed=len(occupied)
    return result
