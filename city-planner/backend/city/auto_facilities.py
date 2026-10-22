"""Seeded monthly development of district-sensitive civic and utility sites.

Probabilities are game calibration, conditional on demand and a legal site.
Every site reserves real land; utility capacity is not a simulated supply network.
"""
import math
import random
from collections import Counter

from shapely.geometry import Point, Polygon, LineString
from shapely.strtree import STRtree
from shapely.ops import unary_union, polygonize, nearest_points
from . import facility_architecture
from .geometry import stable_id
from .parameters import ROAD_TYPES


def rule(name, size, population, per, probability, separation, profile, cost, height, **kw):
    return dict(name=name, width=size[0], depth=size[1], minPopulation=population, perPopulation=per,
                probability=probability, separation=separation, profile=profile, costPerArea=cost,
                height=height, manual=False, automatic=True, **kw)


CATALOG = {
    'sports_arena': rule('体育馆', (110, 85), 1800, 14000, .16, 1100, 'leisure', 1700, 25),
    'university': rule('大学校园', (180, 145), 4000, 30000, .10, 1800, 'campus', 1300, 22),
    'hospital': rule('医院', (90, 72), 900, 6500, .35, 650, 'service', 2400, 36, service='health'),
    'city_hall': rule('市政厅', (85, 68), 1500, 100000, .16, 2200, 'civic', 1800, 23, maxCount=1),
    'fire_station': rule('消防局', (48, 40), 350, 4500, .42, 550, 'emergency', 950, 14),
    'police_station': rule('警察局', (45, 38), 350, 4500, .40, 550, 'service', 1100, 17),
    'hotel': rule('酒店', (52, 44), 700, 4500, .30, 360, 'hotel', 2600, 48),
    'gas_station': rule('加油站', (52, 42), 300, 4000, .35, 650, 'fuel', 650, 7),
    'charging_station': rule('充电站', (42, 32), 200, 2500, .48, 350, 'charging', 520, 5),
    'museum': rule('博物馆', (78, 62), 2200, 20000, .13, 1300, 'culture', 1900, 19, service='culture'),
    'theater': rule('剧院', (75, 62), 1800, 14000, .17, 900, 'culture', 2000, 24, service='culture'),
    'cinema': rule('电影院', (50, 42), 650, 5000, .32, 450, 'commercial', 1200, 15, service='culture'),
    'convention_center': rule('会展中心', (145, 100), 3500, 25000, .12, 1800, 'convention', 1600, 22),
    'industrial_plant': rule('工业厂区', (115, 85), 600, 10000, .25, 650, 'industry', 1000, 20, polluting=True),
    'power_plant': rule('发电厂', (120, 95), 1800, 24000, .18, 1600, 'utility', 2100, 42, polluting=True),
    'substation': rule('变电站', (44, 36), 300, 6000, .35, 600, 'infrastructure', 1050, 11),
    'water_plant': rule('自来水厂', (90, 70), 900, 15000, .25, 1000, 'water', 1250, 12),
    'sewage_plant': rule('污水处理厂', (110, 85), 1200, 16000, .23, 1200, 'utility', 1200, 14, polluting=True),
    'recycling_center': rule('垃圾回收处理中心', (85, 65), 600, 10000, .30, 850, 'utility', 900, 16, polluting=True),
    'logistics_hub': rule('物流中心', (110, 80), 700, 9000, .28, 700, 'industry', 950, 15),
}
POLLUTING = {k for k, v in CATALOG.items() if v.get('polluting')}
SENSITIVE = {'school', 'clinic', 'hospital', 'university'}
REASONS = dict(service='优先住宅服务空白，避开污染设施', emergency='面向居住与工业片区，接入普通路或主干道', campus='城市边缘完整校园用地，避开密集楼群和污染设施', leisure='居住与商业片区周边，优先交通便利的大块空地', civic='城市中心活动区，全城最多一处', culture='商业与居住活动区，优先公共交通附近', commercial='成熟商业与办公片区', hotel='商务活动区或机场、车站等交通节点附近', convention='成熟商务片区的大块空地', fuel='普通路或主干道沿线，远离学校和医院', charging='建成区道路沿线，避开污染设施', industry='工业仓储集聚区，优先货运节点', utility='工业边缘，远离住宅、学校与医院', infrastructure='建成区或工业区周边', water='较低密度城市边缘，避开工业与污染设施')
PUBLIC = {'service', 'emergency', 'campus', 'leisure', 'civic', 'culture'}
CORE_BUFFER = 350
REASONS['utility'] = '工业片区边缘，避开各商业中心、密集街区及现有或规划住宅、学校、医院'
REASONS['industry'] = '工业仓储占主导的片区；污染厂区避开中心与密集街区，优先货运节点'


class Context:
    def __init__(self, city):
        self.city = city
        self.population = sum(h['size'] for h in city.s['households'])
        self.built = [p for p in city.s['parcels'] if p.get('building') and p['building']['status'] != 'construction']
        self.tree = STRtree([Point(p['center']) for p in self.built])
        self.roads = {r['id']: r for r in city.s['roads'] if r['level'] == 0 and r['kind'] in ('street', 'avenue', 'lane')}
        self.road_shapes = {k: LineString(r['points']) for k, r in self.roads.items()}
        self.blocks = list(polygonize(unary_union([LineString(r['points']) for r in city.s['roads'] if r['level']==0 and r['kind'] in ('street','avenue','lane')])))
        self.block_tree = STRtree(self.blocks)
        self.road_tree = STRtree([LineString(r['points']).buffer(ROAD_TYPES[r['kind']]['width']/2+2)
                                 for r in city.s['roads'] if r['level'] >= 0])
        from .renewal import locked
        self.obstacles = [Polygon(p['points']) for p in city.s['parcels']
                          if p.get('building') or p.get('openSpace') or p.get('blockCommon') or p['use'] == 'protected' or locked(city, p)]
        self.obstacles += [Polygon(f['points']) if f.get('points') else Point(f['point']).buffer(18)
                           for f in city.s['facilities']]
        self.obstacle_tree = STRtree(self.obstacles)
        self.empty = [p for p in city.s['parcels'] if not p.get('building') and not p.get('openSpace')
                      and not p.get('blockCommon') and not locked(city, p) and p['use'] != 'protected'
                      and p.get('connected') and p.get('road') in self.roads]
        self.zoned = [p for p in self.empty if p['use'] != 'auto']
        self.zoned_tree = STRtree([Polygon(p['points']) for p in self.zoned])
        self.sensitive = [Polygon(p['points']) for p in city.s['parcels'] if p.get('building') and p['building']['use'] == 'residential']
        # Reserve the same protection for planned housing, before residents arrive.
        self.sensitive += [Polygon(p['points']) for p in city.s['parcels'] if p['use'] == 'residential' and not p.get('building')]
        self.sensitive += [Polygon(f['points']) if f.get('points') else Point(f['point']).buffer(18)
                           for f in city.s['facilities'] if f['kind'] in SENSITIVE]
        self.sensitive_tree = STRtree(self.sensitive)
        self.polluters = [Polygon(f['points']) for f in city.s['facilities'] if f['kind'] in POLLUTING]
        self.pollution_tree = STRtree(self.polluters)
        self.transport = [Point(f['point']) for f in city.s['facilities'] if f['kind'] in ('airport', 'port', 'train_station')]
        self.transport += [Point(s['point']) for s in city.s['stops'] if s.get('connected')]
        self.transport_tree = STRtree(self.transport)
        self.core_tree = STRtree([Polygon(points) for district in city.s['districts']
                                  if district['kind'] in ('CBD', '办公集聚区', '商业区')
                                  for points in district.get('polygons', [])])

    def peripheral(self, point, shape):
        """Exclude every local center, including centers not yet labelled CBD."""
        if len(self.core_tree.query(shape, predicate='dwithin', distance=CORE_BUFFER)):
            return False
        for center in self.city.s.get('growthCenters', []):
            if shape.distance(Point(center['point'])) >= CORE_BUFFER:
                continue
            uses = Counter(p['building']['use'] for p in self.nearby(center['point'], 450))
            if uses['residential'] + uses['office'] + uses['commercial'] > uses['industrial'] + uses['warehouse']:
                return False
        inner = self.nearby(point, 350)
        if sum(p['building']['use'] in ('office', 'commercial') for p in inner) >= 3:
            return False
        # A hole surrounded by developed blocks is not an urban edge. Work in
        # local angular sectors, rather than distance from the map's midpoint.
        sectors = {int((math.atan2(p['center'][1]-point[1], p['center'][0]-point[0])+math.pi)/(math.pi/4)) % 8
                   for p in self.nearby(point, 450)}
        return len(sectors) < 6

    def nearby(self, point, radius=600):
        return [self.built[int(i)] for i in self.tree.query(Point(point), predicate='dwithin', distance=radius)]


def suitability(ctx, kind, point, road, shape):
    """Hard siting exclusions followed by a weighted preference, never an override."""
    cfg = CATALOG[kind]; profile = cfg['profile']
    nearby = ctx.nearby(point)
    if len(nearby) < 2:
        return 0
    uses = Counter(p['building']['use'] for p in nearby)
    industry = uses['industrial'] + uses['warehouse']
    urban = uses['residential'] + uses['office'] + uses['commercial']
    business = uses['office'] + uses['commercial']
    transport = bool(len(ctx.transport_tree.query(Point(point), predicate='dwithin', distance=550)))
    if cfg.get('polluting') and len(ctx.sensitive_tree.query(shape, predicate='dwithin', distance=250)):
        return 0
    if profile in PUBLIC | {'hotel', 'commercial', 'charging', 'water'} and len(ctx.pollution_tree.query(shape, predicate='dwithin', distance=250)):
        return 0
    if kind in SENSITIVE and any(f['kind'] == 'gas_station' and shape.distance(Polygon(f['points'])) < 120 for f in ctx.city.s['facilities']):
        return 0
    if profile == 'fuel':
        if road['kind'] == 'lane' or any(shape.distance(Polygon(f['points']) if f.get('points') else Point(f['point'])) < 120
                                      for f in ctx.city.s['facilities'] if f['kind'] in SENSITIVE):
            return 0
        return 1 + industry*.3 + (2 if road['kind'] == 'avenue' else 0)
    if profile in ('industry', 'utility'):
        areas = Counter()
        for p in nearby:
            areas[p['building']['use']] += p['building']['floorArea']
        industrial_area = areas['industrial'] + areas['warehouse']
        urban_area = areas['residential'] + areas['office'] + areas['commercial']
        if road['kind'] == 'lane' or industry < 2 or industry < urban or industrial_area < urban_area:
            return 0
        if (cfg.get('polluting') or profile == 'utility') and not ctx.peripheral(point, shape):
            return 0
        lowland = ctx.city.terrain.features(shape).get('lowland', 0) if kind == 'sewage_plant' else 0
        return (2 + industry*.5 + transport*2 + lowland*3)/(1+urban*.5)
    if profile == 'water':
        return 0 if industry > 2 or urban > 16 else 2 + ctx.city.terrain.sample(point).get('lowland', 0)
    if profile == 'infrastructure':
        return 1 + industry*.2 + urban*.1
    if profile == 'emergency':
        return 0 if road['kind'] == 'lane' else 2 + urban*.25 + industry*.3
    if industry > max(2, urban*.5):
        return 0
    if profile in ('hotel', 'commercial', 'convention'):
        if business < (3 if profile == 'convention' else 2) and not (profile == 'hotel' and transport):
            return 0
        return 1 + business*.6 + transport*3
    if profile == 'campus':
        return 0 if urban < 3 or urban > 24 else 3 + uses['residential']*.15 + transport
    if profile == 'service':
        return 0 if uses['residential'] < 2 else 2 + uses['residential']*.5
    if profile in ('civic', 'culture', 'leisure'):
        return 0 if urban < 4 else 2 + business*.4 + uses['residential']*.2 + transport*2
    return 1 + urban*.25 + transport


def propose_site(ctx, kind, parcel, scale=1):
    from .special_buildings import rectangle, local_point, points
    cfg = CATALOG[kind]; road = ctx.roads[parcel['road']]; line = ctx.road_shapes[road['id']]
    w, d = cfg['width']*scale, cfg['depth']*scale
    along = line.project(Point(parcel['center']))
    if along < w/2+5 or line.length-along < w/2+5:
        return None
    q = line.interpolate(along); a = line.interpolate(max(0, along-1)); b = line.interpolate(min(line.length, along+1))
    angle = math.degrees(math.atan2(b.y-a.y, b.x-a.x))
    if (parcel['center'][0]-q.x)*-(b.y-a.y)+(parcel['center'][1]-q.y)*(b.x-a.x) < 0:
        angle += 180
    angle %= 360
    origin = local_point(list(q.coords[0]), angle, 0, ROAD_TYPES[road['kind']]['width']/2+d/2+7)
    shape = rectangle(origin, angle, (-w/2, -d/2, w/2, d/2))
    # The real Block boundary determines the site, including diagonal and concave edges.
    blocks=[ctx.blocks[int(i)] for i in ctx.block_tree.query(Point(origin),predicate='intersects')]
    block=min(blocks,key=lambda g:g.area) if blocks else None
    if block is not None:
        if w*d*.6 <= block.area <= w*d*1.8:shape=block
        else:shape=shape.intersection(block)
    hits=ctx.road_tree.query(shape,predicate='intersects')
    if len(hits):shape=shape.difference(unary_union([ctx.road_tree.geometries[int(i)].buffer(.15) for i in hits]))
    pieces=[p for p in facility_architecture.parts(shape) if not p.interiors and p.area>=w*d*.5]
    if not pieces:return None
    shape=min(pieces,key=lambda p:p.distance(Point(origin))).simplify(.03,preserve_topology=True)
    if len(ctx.obstacle_tree.query(shape, predicate='intersects')):
        return None
    uses = ('auto', 'industrial', 'warehouse') if cfg['profile'] in ('industry', 'utility', 'infrastructure') else ('auto', 'commercial', 'office') if cfg['profile'] in ('hotel', 'commercial', 'convention') else ('auto',)
    if any(ctx.zoned[int(i)]['use'] not in uses for i in ctx.zoned_tree.query(shape, predicate='intersects')):
        return None
    if not ctx.city.terrain.bounds.covers(shape) or not ctx.city.terrain.buildable(shape, .09):
        return None
    score = suitability(ctx, kind, origin, road, shape)
    if score <= 0:
        return None
    existing = [f for f in ctx.city.s['facilities'] if f['kind'] == kind]
    if any(math.dist(origin, f['point']) < cfg['separation'] for f in existing):
        return None
    entrance = list(nearest_points(shape.boundary,q)[0].coords[0])
    access = LineString([q, Point(entrance)])
    if len(ctx.obstacle_tree.query(access.buffer(2), predicate='intersects')) or not ctx.city.terrain.buildable(access.buffer(2), .18):
        return None
    # Weight service gaps so different catchments are filled before clustering.
    if existing:
        score *= min(2, min(math.dist(origin, f['point']) for f in existing)/cfg['separation'])
    return dict(kind=kind, name=cfg['name'], point=origin, origin=origin, rotation=angle, width=w, depth=d,
                points=points(shape), blockPoints=points(block) if block is not None else None, siteMode='block' if block is not None else 'road', accessPoint=entrance, accessRoad=road['id'], height=cfg['height'],
                cost=round(shape.area*cfg['costPerArea']), score=score)


def grow(city):
    if not city.s['settings'].get('autoGrow', True) or city.s['settings']['growth'] <= 0 or city.s['settings']['maxProjects'] <= 0:
        return False
    month = city.s['month']
    # Repeated calls in one month cannot reroll the lottery or exceed its cap.
    if city.s.get('autoFacilitiesMonth') == month:
        return False
    city.s['autoFacilitiesMonth'] = month
    ctx = Context(city)
    if len(ctx.built) < 6 or not ctx.empty:
        return False
    rng = random.Random(stable_id('', (city.terrain.data['config']['seed'], month, 'civic-1')))
    kinds = list(CATALOG); rng.shuffle(kinds)
    made = 0
    for kind in kinds:
        cfg = CATALOG[kind]
        if ctx.population < cfg['minPopulation']:
            continue
        count = sum(f['kind'] == kind for f in city.s['facilities'])
        target = min(cfg.get('maxCount', 50), max(1, math.ceil(ctx.population/cfg['perPopulation'])))
        if count >= target or rng.random() >= min(.85, cfg['probability']*min(2, city.s['settings']['growth'])*(1+.2*(target-count-1))):
            continue
        candidates = ctx.empty[:]; rng.shuffle(candidates)
        options = []
        for p in candidates[:100]:
            site = propose_site(ctx, kind, p, rng.choice((.78, .9, 1, 1.12, 1.25)))
            if site and (not city.s['settings']['budget'] or site['cost'] <= city.s['treasury']):
                # Weighted random sampling retains variation among suitable sites.
                options.append((-math.log(max(rng.random(), 1e-12))/site.pop('score'), site))
        if not options:
            continue
        _, f = min(options, key=lambda item: item[0])
        fid = city.uid('f')
        f.update(id=fid, generated=True, automaticCategory=cfg['profile'], created=month,
                 variant=0, architectureSeed=rng.getrandbits(31), maintenance=round(f['cost']*.002), capacity=0,
                 generationReason=REASONS[cfg['profile']])
        if cfg.get('service'):
            f['service'] = cfg['service']
            f['capacity'] = max(40, round(f['width']*f['depth']/(12 if kind == 'hospital' else 6)))
        if kind == 'hotel':
            f['rooms'] = max(30, int(f['width']*f['depth']*.4*10/40))
        if kind == 'charging_station':
            f['chargingSpaces'] = (int(f['width']*.8/3)+1)*2
        facility_architecture.ensure(f)
        city.spend(f['cost'], '自动城市设施')
        from .naming import name_object
        name_object(city,'facilities',f)
        city.s['facilities'].append(f)
        from .special_buildings import reserve
        reserve(city)
        city.event('配套', f['name']+'自动建成', f['point'])
        made += 1
        if made >= min(3, city.s['settings']['maxProjects']):
            break
        ctx = Context(city)
    return made > 0


def sensitive_site_safe(city, shape):
    """Keep new homes and existing school/clinic growth outside utility buffers."""
    return all(shape.distance(Polygon(f['points'])) >= (250 if f['kind'] in POLLUTING else 120)
               for f in city.s['facilities'] if f['kind'] in POLLUTING | {'gas_station'})
