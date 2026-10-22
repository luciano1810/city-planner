"""User-sited transport buildings and deterministic, parcel-safe city landmarks."""
import math
import random

from shapely.affinity import rotate, translate
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union
from shapely.strtree import STRtree

from .parameters import ROAD_TYPES, USES
from .auto_facilities import CATALOG as AUTO_CATALOG
from .geometry import stable_id, building_footprint


CATALOG = {
    'airport': dict(name='机场', width=1000, depth=360, cost=18000000, manual=True),
    'port': dict(name='港口', width=320, depth=240, cost=6500000, manual=True),
    'train_station': dict(name='火车站', width=180, depth=80, cost=1200000, manual=True),
    'parking_lot': dict(name='露天停车场', manual=False),
    'parking_garage': dict(name='停车楼', manual=False),
}
CATALOG.update(AUTO_CATALOG)
PARKING = ('parking_lot', 'parking_garage')


def local_point(origin, angle, x, y):
    a = math.radians(angle)
    return [origin[0] + x*math.cos(a) - y*math.sin(a), origin[1] + x*math.sin(a) + y*math.cos(a)]


def rectangle(origin, angle, bounds):
    return translate(rotate(box(*bounds), angle, origin=(0, 0)), *origin)


def points(shape):
    return [list(q) for q in shape.exterior.coords]


def special(f):
    return f.get('kind') in CATALOG


def check_roads(city, occupied, kind, level, road_id=None):
    """Do not permit later road edits to cut through a reserved transport site."""
    if level < 0:
        return
    for f in city.s['facilities']:
        if not special(f):
            continue
        site = Polygon(f['points'])
        hit = occupied.intersection(site)
        if hit.area <= .1:
            continue
        if f['kind'] == 'train_station' and kind in ('train','metro') and level == 0:
            if Polygon(f['railCorridor']).buffer(.2).covers(hit):
                continue
        raise ValueError('路线与' + CATALOG[f['kind']]['name'] + '预留用地冲突')


def propose(city, cmd):
    kind = cmd.get('kind')
    if kind not in CATALOG or not CATALOG[kind]['manual']:
        raise ValueError('请选择机场、港口或火车站')
    origin = city.point(cmd.get('point'))
    angle = cmd.get('rotation', 0)
    if isinstance(angle, bool) or not isinstance(angle, (float, int)) or not math.isfinite(angle) or not 0 <= angle < 360:
        raise ValueError('建筑朝向必须在 0–359 度之间')
    size = cmd.get('size', 'standard')
    if size not in ('compact', 'standard', 'large'):
        raise ValueError('未知建筑规模')
    scale = {'compact': .7, 'standard': 1, 'large': 1.3}[size]
    cfg = CATALOG[kind]
    w, d = cfg['width']*scale, cfg['depth']*scale
    name = cmd.get('name') or cfg['name']
    if not isinstance(name, str) or not name.strip() or len(name) > 60:
        raise ValueError('建筑名称需要 1–60 个字符')
    result = dict(kind=kind, name=name.strip(), point=origin, origin=origin, rotation=angle,
                  width=w, depth=d, size=size, generated=False, capacity=0,
                  maintenance=round(cfg['cost']*scale*scale*.003), cost=round(cfg['cost']*scale*scale),
                  height={'airport': 32, 'port': 28, 'train_station': 16}[kind]*scale)
    bounds = (-w/2, -d/2, w/2, d/2)
    if kind == 'train_station':
        rails = [r for r in city.s['roads'] if r['kind'] in ('train','metro') and r['level'] == 0]
        if not rails:
            raise ValueError('请先铺设地面铁路，再在铁路旁放置火车站')
        rail = min(rails, key=lambda r: LineString(r['points']).distance(Point(origin)))
        line = LineString(rail['points'])
        if line.distance(Point(origin)) > 90:
            raise ValueError('火车站应放在地面铁路 90 米内')
        along = line.project(Point(origin))
        if along < w/2 or line.length-along < w/2:
            raise ValueError('铁路长度不足以容纳完整站台，请延长铁路或选择更靠中间的位置')
        anchor = line.interpolate(along)
        a, b = line.interpolate(along-1), line.interpolate(along+1)
        angle = math.degrees(math.atan2(b.y-a.y, b.x-a.x)) % 360
        if (origin[0]-anchor.x)*-(b.y-a.y)+(origin[1]-anchor.y)*(b.x-a.x) < 0:
            angle = (angle+180) % 360
        origin = list(anchor.coords[0])
        bounds = (-w/2, -d*.225, w/2, d*.775)
        corridor = rectangle(origin, angle, (-w/2-1, -8.2, w/2+1, 8.2))
        # Platforms must follow a sufficiently straight portion of the railway.
        for offset in (-w*.45, -w*.2, 0, w*.2, w*.45):
            if line.distance(Point(local_point(origin, angle, offset, 0))) > 2:
                raise ValueError('站台需要较直的铁路区段，请换一处位置')
        result.update(origin=origin, rotation=angle, rail=rail['id'], railCorridor=points(corridor), stopPoint=origin)
    shape = rectangle(origin, angle, bounds)
    result['points'] = points(shape)
    result['point'] = list(shape.centroid.coords[0])
    result['accessPoint'] = local_point(origin, angle, 0, bounds[3] if kind != 'port' else bounds[1])
    if not city.terrain.bounds.covers(shape):
        raise ValueError('建筑占地超出地图范围')
    if kind == 'port':
        yard = rectangle(origin, angle, (-w/2, -d/2, w/2, -d*.12))
        if not city.terrain.buildable(yard, .24):
            raise ValueError('港口陆侧堆场需要平缓陆地，请将预览中的海侧朝向水面')
        water = [city.terrain.sample(local_point(origin, angle, x*w, y*d))['water']
                 for x in (-.44, -.22, 0, .22, .44) for y in (.16, .28, .4, .48)]
        if sum(water)/len(water) < .85:
            raise ValueError('港口海侧需要足够水面，请沿岸线调整位置与朝向')
        result['landPoints'] = points(yard)
    elif not city.terrain.buildable(shape, .08 if kind == 'airport' else .18):
        raise ValueError('机场需要完整平坦陆地' if kind == 'airport' else '火车站需要平缓陆地')
    for road in city.s['roads']:
        if road['level'] < 0:
            continue
        hit = shape.intersection(LineString(road['points']).buffer(ROAD_TYPES[road['kind']]['width']/2+1))
        if hit.area <= .1:
            continue
        if kind == 'train_station' and road['kind'] in ('train','metro') and road['level'] == 0 and Polygon(result['railCorridor']).covers(hit):
            continue
        raise ValueError('建筑与已有道路或轨道冲突')
    for f in city.s['facilities']:
        existing = Polygon(f['points']) if f.get('points') else Point(f['point']).buffer(15)
        if shape.intersection(existing).area > .1:
            raise ValueError('建筑与已有设施冲突')
    from .renewal import locked
    for p in city.s['parcels']:
        if not shape.intersects(Polygon(p['points'])):
            continue
        if p.get('building') and shape.intersection(Polygon(p['building']['footprint'])).area > .1:
            raise ValueError('建筑与现有建筑冲突，请选择空地')
        if p.get('building') or p.get('openSpace') or p['use'] == 'protected' or locked(city, p):
            raise ValueError('建筑与已使用、保护或更新中的地块冲突')
    if city.s['settings']['budget'] and result['cost'] > city.s['treasury']:
        raise ValueError('建设预算不足')
    return result


def preview(city, cmd):
    try:
        return dict(valid=True, facility=propose(city, cmd))
    except (ValueError, TypeError) as error:
        return dict(valid=False, reason=str(error))


def reserve(city):
    """Keep newly created frontage parcels off independently placed facilities."""
    sites = [(f['id'], Polygon(f['points'])) for f in city.s['facilities'] if special(f)]
    if not sites:
        return
    tree = STRtree([shape for _, shape in sites])
    for p in city.s['parcels']:
        if p.get('building') or p.get('openSpace'):
            continue
        shape = Polygon(p['points'])
        for index in sorted(tree.query(shape)):
            fid, site = sites[int(index)]
            if shape.intersection(site).area > .1:
                p['openSpace'] = fid
                break


def place(city, cmd):
    f = propose(city, cmd)
    f.update(id=city.uid('f'), created=city.s['month'])
    from .naming import name_object
    name_object(city,'facilities',f)
    if f['kind'] == 'train_station':
        # Reuse an existing passenger stop instead of duplicating service calls.
        stop = next((s for s in city.s['stops'] if s['mode'] == 'train' and s.get('role', 'passenger') == 'passenger'
                     and not s.get('facility') and math.dist(s['point'], f['stopPoint']) < 20), None)
        f['ownsStop'] = stop is None
        if stop is None:
            stop = dict(id=city.uid('s'), name=f['name'], nameSource='generated', mode='train', point=f['stopPoint'], enabled=True,
                        role='passenger', external=False, constructionCost=0)
            city.s['stops'].append(stop)
        f['stop'] = stop['id']
        stop['facility'] = f['id']
    city.spend(f['cost'], '交通建筑')
    city.s['facilities'].append(f)
    reserve(city)
    city.event('建设', f['name']+'建成', f['point'])
    return f


def remove(city, identifier):
    f = next((f for f in city.s['facilities'] if f['id'] == identifier and special(f)), None)
    if f and f.get('stop'):
        if f.get('ownsStop'):
            city.s['stops'] = [s for s in city.s['stops'] if s['id'] != f['stop']]
        else:
            for s in city.s['stops']:
                if s['id'] == f['stop']:
                    s.pop('facility', None)
    for station in city.s['facilities']:
        if station.get('stop') == identifier:
            raise ValueError('请拆除对应火车站建筑，站点会同步移除')


def validate(city):
    stops = {s['id']: s for s in city.s['stops']}
    for f in city.s['facilities']:
        if not special(f):
            continue
        shape = Polygon(f.get('points', []))
        if shape.is_empty or not shape.is_valid or not city.terrain.bounds.covers(shape):
            raise ValueError('存档特殊建筑占地无效')
        for k in ('width', 'depth'):
            if not isinstance(f.get(k), (int, float)) or not 0 < f[k] <= 10000:
                raise ValueError('存档特殊建筑尺寸无效')
        if not isinstance(f.get('rotation'), (int, float)) or not 0 <= f['rotation'] < 360:
            raise ValueError('存档特殊建筑朝向无效')
        if f['kind'] == 'train_station':
            stop = stops.get(f.get('stop'))
            if not stop or stop['mode'] != 'train' or stop.get('facility') != f['id']:
                raise ValueError('存档火车站缺少关联铁路站点')


def cbd_area(district):
    return unary_union([Polygon(p) for p in district.get('polygons', [])])


def grow_cbd(city):
    """Finance one tower at a time per CBD, delivering capacity after construction."""
    if city.s['settings']['growth'] <= 0 or city.s['settings']['maxProjects'] <= 0:
        return False
    from .development import development_targets, planned_supply
    from .urban import building_style
    from .renewal import locked
    gap = development_targets(city)['office'] - planned_supply(city)['office']
    made = False
    for district in city.s['districts']:
        if district['kind'] != 'CBD':
            continue
        region = cbd_area(district)
        towers = [p for p in city.s['parcels'] if p.get('building', {}) and p['building'].get('landmark') == 'cbd_skyscraper'
                  and region.covers(Point(p['center']))]
        if any(p['building']['status'] == 'construction' or p['building'].get('extensionReady') for p in towers):
            continue
        if len(towers) >= max(1, district.get('buildings', 6)//18):
            continue
        choices = [p for p in city.s['parcels'] if p.get('connected') and p['use'] in ('auto', 'office')
                   and not p.get('openSpace') and not p.get('blockCommon') and not locked(city, p)
                   and region.covers(Point(p['center'])) and p['terrain']['slope'] < .06
                   and (not p.get('building') or p['building']['use'] == 'office' and p['building']['status'] == 'active'
                        and not p['building'].get('extensionReady') and not p['building'].get('landmark'))]
        choices.sort(key=lambda p: (bool(p.get('building')), -p.get('businessCore', 0), p['id']))
        for p in choices:
            rng = random.Random(stable_id('', (p['id'], 'cbd-tower')))
            floors = rng.randint(36, 52)
            old = p.get('building')
            footprint = Polygon(old['footprint']) if old else building_footprint(p, 'office', 1, 340)
            if footprint is None or footprint.area < 100:
                continue
            extra_capacity = int(footprint.area*floors/USES['office']['space']) - (old['capacity'] if old else 0)
            # A CBD can support a modest speculative landmark, but does not get
            # unlimited free towers or capacity from a label alone.
            allowance = max(180, district.get('jobs', 0)*.35)
            if extra_capacity > max(0, gap) + allowance or extra_capacity <= 0:
                continue
            if old:
                old.update(extensionFloors=floors-old['floors'], extensionReady=city.s['month']+12,
                           extensionCost=round(footprint.area*(floors-old['floors'])*USES['office']['cost']),
                           landmark='cbd_skyscraper', towerVariant=rng.randrange(3), targetFloors=floors)
                old['cost'] += old['extensionCost']
            else:
                area = round(footprint.area*floors, 1)
                b = dict(id=city.uid('b'), use='office', floors=floors, floorArea=area, footprintArea=round(footprint.area, 1),
                         footprint=points(footprint), center=list(footprint.centroid.coords[0]), capacity=int(area/USES['office']['space']),
                         status='construction', ready=city.s['month']+12+floors//6, age=0, occupied=0, positions=0, employees=0,
                         cost=round(area*USES['office']['cost']*p['terrain']['costFactor']), vacantMonths=0,
                         landmark='cbd_skyscraper', towerVariant=rng.randrange(3), **building_style(p, 'office', floors))
                b.update(height=round(floors*3.9, 1), usableArea=round(area*b['usableRatio'], 1), useAreas={'office': area})
                p['building'] = b
            p['reason'] = 'CBD 自动地标开发：商务楼群内生成摩天楼'
            city.event('建设', 'CBD 摩天楼开工，规划 '+str(floors)+' 层', p['center'])
            gap -= extra_capacity
            made = True
            break
    return made


def grow_parking(city):
    if not city.s['settings'].get('autoGrow', True) or city.s['settings']['growth'] <= 0:
        return False
    built = [p for p in city.s['parcels'] if p.get('building') and p['building']['status'] != 'construction']
    existing = [f for f in city.s['facilities'] if f['kind'] in PARKING]
    if len(built) < 6 or len(existing) >= max(1, math.ceil(len(built)/16)):
        return False
    from .renewal import locked
    built_tree = STRtree([Point(p['center']) for p in built])
    candidates = [p for p in city.s['parcels'] if p.get('connected') and p['use'] == 'auto' and not p.get('building')
                  and not p.get('openSpace') and not p.get('blockCommon') and not locked(city, p)
                  and p['area'] >= 230 and len(built_tree.query(Point(p['center']),predicate='dwithin',distance=220))
                  and all(math.dist(p['center'], f['point']) > 130 for f in existing)]
    # Local seeded randomness survives reloads and is independent of hover previews.
    rng = random.Random(stable_id('', (city.terrain.data['config']['seed'], city.s['month'], 'parking')))
    rng.shuffle(candidates)
    for p in candidates:
        footprint = building_footprint(p, 'warehouse', .7)
        if footprint is None or footprint.area < 160:
            continue
        rect = footprint.minimum_rotated_rectangle
        # Only use a rectangle covered by the legal parcel, never its exterior bbox.
        if not Polygon(p['points']).buffer(.01).covers(rect):
            continue
        coords = list(rect.exterior.coords)
        w, d = math.dist(coords[0], coords[1]), math.dist(coords[1], coords[2])
        if min(w, d) < 12:
            continue
        angle = math.degrees(math.atan2(coords[1][1]-coords[0][1], coords[1][0]-coords[0][0])) % 360
        dense = any(d['kind'] == 'CBD' and cbd_area(d).distance(Point(p['center'])) < 180 for d in city.s['districts'])
        garage = rng.random() < (.65 if dense else .3)
        kind = 'parking_garage' if garage else 'parking_lot'
        floors = rng.randint(3, 5) if garage else 1
        cost = round(rect.area*(900*floors if garage else 110))
        if city.s['settings']['budget'] and city.s['treasury'] < cost:
            continue
        fid = city.uid('f')
        f = dict(id=fid, kind=kind, name=CATALOG[kind]['name'], generated=True, parcel=p['id'], points=points(rect),
                 point=list(rect.centroid.coords[0]), origin=list(rect.centroid.coords[0]), rotation=angle, width=w, depth=d,
                 floors=floors, height=floors*3.2 if garage else 0, parkingSpaces=max(4, int(rect.area/32)*floors),
                 capacity=0, created=city.s['month'], cost=cost, maintenance=round(cost*.002))
        city.spend(cost, '停车设施')
        p['openSpace'] = fid
        from .naming import name_object
        name_object(city,'facilities',f)
        p['reason'] = '街区自动配套：'+f['name']
        city.s['facilities'].append(f)
        city.event('配套', f['name']+'建成，提供 '+str(f['parkingSpaces'])+' 个车位', f['point'])
        return True
    return False
