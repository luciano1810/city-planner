"""Derived paving and planting between developed sites and their street.

These are site finishes, not extra roads or independently employable buildings.
Recompute from current geometry so old saves and demolitions behave identically.
"""
import math

from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import nearest_points, unary_union, substring
from shapely.strtree import STRtree

from .parameters import ROAD_TYPES


def polygons(shape):
    if shape.geom_type == 'Polygon':
        return [shape] if shape.area > .1 else []
    return [p for part in getattr(shape, 'geoms', []) for p in polygons(part)]


def contours(shape):
    return [dict(points=[list(q) for q in p.exterior.coords],
                 holes=[[list(q) for q in ring.coords] for ring in p.interiors]) for p in polygons(shape)]


def frontage(site, line):
    """Sweep only street-facing edges to the actual (possibly curved) street."""
    strips = []
    coords = list(orient(site).exterior.coords)
    for a, b in zip(coords, coords[1:]):
        mid = Point((a[0]+b[0])/2, (a[1]+b[1])/2)
        nearest = line.interpolate(line.project(mid))
        dx, dy = b[0]-a[0], b[1]-a[1]
        if dy*(nearest.x-mid.x)-dx*(nearest.y-mid.y) <= .01 or mid.distance(nearest) > 200:
            continue
        start, end = line.project(Point(b)), line.project(Point(a))
        edge = substring(line, start, end)
        strip = Polygon([a, b, *edge.coords, a]).buffer(0)
        if not strip.is_empty:
            strips.append(strip)
    return unary_union(strips).difference(site)


def furnishings(shape, anchor, entry, width):
    distance = math.dist(anchor, entry)
    if distance < 1:
        return [], []
    ny = [(entry[i]-anchor[i])/distance for i in range(2)]
    nx = [ny[1], -ny[0]]
    def local(x, y):
        return [anchor[i]+nx[i]*x+ny[i]*y for i in range(2)]
    def rectangle(x0, y0, x1, y1):
        return Polygon([local(x0,y0),local(x1,y0),local(x1,y1),local(x0,y1)])
    coords = [q for p in polygons(shape) for q in p.exterior.coords]
    if not coords:
        return [], []
    xs = [sum((q[i]-anchor[i])*nx[i] for i in range(2)) for q in coords]
    ys = [sum((q[i]-anchor[i])*ny[i] for i in range(2)) for q in coords]
    xmin, xmax, ymin, ymax = min(xs), max(xs), min(ys), max(ys)
    driveway = LineString([anchor,entry]).buffer(width/2+1)
    parking, occupied = [], []
    # A 5.2 m stall plus 5.6 m aisle, with the central entrance left clear.
    for lo, hi in [(xmin+3, -width/2-2), (width/2+2, xmax-3)]:
        w = min(32, hi-lo)
        if w < 13 or ymax-ymin < 16:
            continue
        cx = (lo+hi)/2
        for y in (ymin+8, (ymin+ymax)/2, ymax-7):
            rect = rectangle(cx-w/2,y-5.4,cx+w/2,y+5.4)
            if shape.covers(rect.buffer(.7)) and not rect.intersects(driveway):
                parking.append(dict(point=local(cx,y),width=w,depth=10.8,angle=math.atan2(nx[1],nx[0])))
                occupied.append(rect.buffer(2.8))
                break
    trees = []
    # Rows at the outer sides frame the approach, instead of random trees in it.
    for x in (xmin+3.2, xmax-3.2):
        for j in range(max(0, math.floor((ymax-ymin-5)/9)+1)):
            q = Point(local(x,ymin+3.2+j*9))
            if not shape.covers(q.buffer(2.3)) or q.distance(driveway)<2.3 or any(p.intersects(q) for p in occupied):
                continue
            if any(math.dist(t['point'],q.coords[0])<6 for t in trees):
                continue
            trees.append(dict(point=list(q.coords[0]),radius=2.2,height=5.4,variant=3,street=True))
    return parking, trees


def update(city):
    parcels, facilities, roads = city.s['parcels'], city.s['facilities'], city.s['roads']
    # This also runs after entrance updates; unchanged traffic graphs need no
    # repeated geometry work. The signature deliberately ignores derived fields.
    key = repr(([(p['id'],p['points'],(p.get('building') or {}).get('footprint'),(p.get('building') or {}).get('status'),p.get('road'),p.get('entrance'),p.get('connected'),p.get('openSpace'),p.get('use')) for p in parcels],
                [(f['id'],f.get('points'),f.get('accessPath'),f.get('accessRoad'),f.get('accessWidth'),f.get('connected')) for f in facilities],
                [(r['id'],r['kind'],r['level'],r['points']) for r in roads]))
    if key == getattr(city, '_streetside_key', None):
        return
    city._streetside_key = key
    roadmap = {r['id']:r for r in roads}
    road_shapes = [LineString(r['points']).buffer(ROAD_TYPES[r['kind']]['width']/2) for r in roads if r['level']==0]
    protected = [Polygon(p['points']) for p in parcels if p['use']=='protected']
    exclusions = unary_union(road_shapes+protected+[city.terrain.river_geometry])
    sites = [(p['id'], Polygon(p['points']), p) for p in parcels if p.get('building')]
    sites += [(f['id'], Polygon(f['points']), f) for f in facilities if f.get('points')]
    tree = STRtree([s[1] for s in sites])
    developed = [s[1] for s in sites if s[2].get('building') or s[2].get('accessPath')]
    # Close only narrow seams (up to 6 m) between occupied sites. Larger empty
    # plots remain undeveloped; parks and road surfaces are explicitly excluded.
    joined = unary_union(developed)
    seams = joined.buffer(3.05,join_style=2).buffer(-3.05,join_style=2).difference(unary_union([s[1] for s in sites])).difference(exclusions)
    paved = [p for p in polygons(seams) if city.terrain.buildable(p,.25)]
    plans = []
    for obj in parcels+facilities:
        obj.pop('forecourt',None)
        b = obj.get('building')
        if b:
            if b.get('status')=='construction' or not obj.get('connected'):
                continue
            site = Polygon(b['footprint']); entry = obj.get('entrance',b.get('center',obj['center']))
            road = roadmap.get(obj.get('road')); width = 3
        elif obj.get('connected') and obj.get('accessPath'):
            site = Polygon(obj['points']); entry = obj['accessPath'][-1]
            road = roadmap.get(obj.get('accessRoad')); width = obj.get('accessWidth',5)
        else:
            continue
        if not road or road['level']!=0 or road['kind'] not in ('street','avenue','lane'):
            continue
        line = LineString(road['points']); anchor = list(nearest_points(line,Point(entry))[0].coords[0])
        area = frontage(site,line)
        if b:
            area = area.union(frontage(Polygon(obj['points']),line))
        area = area.difference(exclusions)
        blockers = [sites[int(i)][1] for i in tree.query(area,predicate='intersects') if sites[int(i)][0]!=obj['id']]
        if blockers:
            area = area.difference(unary_union(blockers))
        valid = [p for p in polygons(area) if city.terrain.buildable(p,.25)]
        area = unary_union(valid)
        if area.is_empty:
            continue
        parking, trees = furnishings(area,anchor,entry,width)
        obj['forecourt'] = contours(area)
        paved.extend(valid)
        plans.append(dict(id=obj['id'],surfaces=obj['forecourt'],parking=parking,trees=trees,
                          accessPath=[anchor,entry],accessWidth=width))
    city.s['streetside'] = dict(surfaces=contours(unary_union(paved)),sites=plans)
