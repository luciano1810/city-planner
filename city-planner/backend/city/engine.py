"""Authoritative monthly land-use/transport simulation in metric coordinates.

Households have one worker each; trips represent typical working-day morning and
evening periods. Capacity is assigned per direction and segment, never inferred
from decorative vehicle animations. This is a game model, not a calibrated forecast.
"""
import copy
import hashlib
import math
import random
from collections import Counter, defaultdict

import numpy as np
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import nearest_points

from .geometry import ROAD_TYPES, TRANSIT_TYPES, Terrain, RoadConflict, make_network, parcels_for, building_footprint, curve_points, group, stable_id, road_contacts
from .routing import shortest_paths, reconstruct
from .development import update_location_context, select_projects, opportunity_fields, desired_floors, development_targets, planned_supply
from .urban import POLICY, grow_lanes, grow_public_spaces, building_style, update_entrances, update_firms, spatial_summary, clustered_districts, detailed_metrics, observe_changes, aggregate_flows, accessibility_by_group
from .reporting import metric_definitions
from .parameters import definitions as parameter_definitions, catalog as calibration_catalog
from .planning import plan_streets
from .regional import rebuild_regional, assign_regional_passengers, assign_freight
from .blocks import prepare_blocks, grow_block_commons

from . import renewal
from . import signals
from . import simulation
from . import special_buildings, auto_facilities

MODEL_VERSION = 'shanhai-city-10'
from .parameters import USES,ROAD_KINDS,DRIVABLE_ROADS,FRONTAGE_ROADS


def number(v, low, high, name, integer=False):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not low <= v <= high:
        raise ValueError(f'{name}必须在 {low}–{high} 之间')
    if integer and int(v) != v:
        raise ValueError(f'{name}必须是整数')
    return int(v) if integer else float(v)


def text(v, limit=60):
    if not isinstance(v, str) or not v.strip() or len(v) > limit:
        raise ValueError('名称为空或过长')
    return v.strip()


def tuples(value):
    return tuple(tuples(v) for v in value) if isinstance(value, list) else value


class City:
    def __init__(self, terrain, name='新城'):
        self.terrain = Terrain(terrain)
        self.rng = random.Random(terrain['config']['seed'] + ':city')
        self.s = dict(version=MODEL_VERSION, name=text(name), month=0, revision=0, serial=0,
                      roads=[], stops=[], lines=[], parcels=[], households=[], facilities=[],
                      events=[], history=[], commands=[], districts=[],
                      settings=dict(migration=24, externalJobs=90, growth=1, fare=2,
                                    budget=False, taxRate=.06, maxProjects=12, autoGrow=True, autoRenew=True, accessBudget=30),
                      treasury=100000000., constructionCost=0., maintenance=0., revenue=0.,
                      pendingHousing=0, movedIn=0, movedOut=0, relocated=0, stats={})
        self.s['gateway']=None
        self.s['sceneTimeSeconds']=9*3600.
        self.s['simulation']=simulation.initial_state()
        self.s.update(firms=[], localPaths=[], growthAttempts=[], districtCells={}, policy=dict(POLICY), annual=[],migrationFlows=[],capitalAccounts={})
        self.s.update(streetPlans=[],plannedBlocks=0,regionalServices=[],regionalFlows=[],growthCenters=[],blockLayouts=[],renewals=[])
        self.undo, self.redo = [], []
        self.network = make_network([], [], self.terrain)
        self.paths, self.line_segments, self.graphs = [], {}, {}
        self.live_traffic = None
        self.rebuild()
        self.summarize()

    def uid(self, prefix):
        self.s['serial'] += 1
        return f"{prefix}-{self.s['serial']}"

    def point(self, p):
        if not isinstance(p, (list, tuple)) or len(p) != 2:
            raise ValueError('需要平面坐标 [x, y]')
        return [number(p[0], 0, self.terrain.width, '横坐标'),
                number(p[1], 0, self.terrain.height, '纵坐标')]

    def event(self, category, message, point=None):
        self.s['events'].append(dict(month=self.s['month'], category=category, message=message,point=point))
        self.s['events'] = self.s['events'][-250:]

    def snapshot(self):
        return dict(format=1, model=MODEL_VERSION, terrain=self.terrain.data, calibration=calibration_catalog(self.s['policy']),
                    state=copy.deepcopy(self.s), random=copy.deepcopy(self.rng.getstate()),
                    runtime=self.runtime())

    def runtime(self):
        return copy.deepcopy(dict(edges={e['id']: {k:e[k] for k in ('time','traffic','ratio')} for e in self.network['edges']},
                                  trips=getattr(self,'trips',[]), paths=self.paths,
                                  liveTraffic=self.live_traffic.snapshot() if self.live_traffic else None))

    def restore_runtime(self, runtime):
        for edge in self.network['edges']:
            if edge['id'] in runtime.get('edges',{}):
                edge.update(runtime['edges'][edge['id']])
        self.build_graphs()
        self.trips=copy.deepcopy(runtime.get('trips',[]))
        self.paths=copy.deepcopy(runtime.get('paths',[]))
        if runtime.get('liveTraffic'):
            if not isinstance(runtime['liveTraffic'],dict):raise ValueError('无效的路口实景存档')
            self.live_traffic=signals.LiveTraffic(self,runtime['liveTraffic'].get('mode','observed'))
            self.live_traffic.restore(runtime['liveTraffic'])

    @classmethod
    def restore(cls, data):
        if not isinstance(data, dict) or data.get('format') != 1 or data.get('model') not in (MODEL_VERSION, 'shanhai-city-1','shanhai-city-2','shanhai-city-3','shanhai-city-4','shanhai-city-5','shanhai-city-6','shanhai-city-7','shanhai-city-8','shanhai-city-9'):
            raise ValueError('存档格式或模型版本不受支持')
        city = cls(data['terrain'], data['state']['name'])
        s = copy.deepcopy(data['state'])
        s['sceneTimeSeconds']=number(s.get('sceneTimeSeconds',9*3600.),0,1e12,'城市时钟')
        s.setdefault('simulation',simulation.initial_state(s['sceneTimeSeconds'],
            (data.get('runtime',{}).get('liveTraffic') or {}).get('seconds',0.)))
        simulation.validate(s['simulation'],s['month'])
        old_model=s.get('version')
        for key in ('firms','localPaths','growthAttempts','districtCells','policy','annual','accessibilityGroups','migrationFlows','streetPlans','plannedBlocks','regionalServices','regionalFlows','growthCenters','blockLayouts','renewals'):
            s.setdefault(key,copy.deepcopy(city.s[key]))
        for key in ('autoGrow','autoRenew','accessBudget'):
            s['settings'].setdefault(key,city.s['settings'][key])
        s['policy']={**POLICY,**s['policy']}
        for key,default in POLICY.items():
            if isinstance(default,(int,float)):
                number(s['policy'][key],.00001,100000,key,isinstance(default,int))
        number(s['policy']['trafficIterations'],1,6,'交通分配轮次',True)
        accounts=s.setdefault('capitalAccounts',{})
        for value in accounts.values(): number(value,0,1e15,'累计建设支出')
        unclassified=s['constructionCost']-sum(accounts.values())
        if unclassified<-.01: raise ValueError('建设分项支出超过累计支出')
        if unclassified>.01: accounts['历史建设（未分项）']=accounts.get('历史建设（未分项）',0)+unclassified
        if old_model in ('shanhai-city-1','shanhai-city-2','shanhai-city-3','shanhai-city-4','shanhai-city-5','shanhai-city-6','shanhai-city-7','shanhai-city-8','shanhai-city-9'):
            s['version']=MODEL_VERSION
            s['policy']['version']=POLICY['version']
            s['migrationNote']='已迁移到模型 10；保留既有建筑、街区与校准值，新增信号等待、路口配时与实景交通'
            s['policy']['version']=POLICY['version']
        required = set(city.s)
        if not required <= set(s) or s['version'] != MODEL_VERSION:
            raise ValueError('存档缺少必要字段')
        if any(not isinstance(s[k], list) for k in ['roads','stops','lines','parcels','households','facilities','events','history']):
            raise ValueError('存档集合格式无效')
        if len(s['roads']) > 2000 or len(s['parcels']) > 30000 or len(s['households']) > 100000:
            raise ValueError('存档超过本版本支持规模')
        for road in s['roads']:
            if road['kind'] not in ROAD_TYPES:
                raise ValueError('存档道路类型无效')
            for point in road['points']:
                city.point(point)
        # Reject NaN, negative capacities and dangling residents before committing.
        import json
        json.dumps(data, allow_nan=False)
        ids = [p['id'] for p in s['parcels']]
        if len(ids) != len(set(ids)):
            raise ValueError('存档地块编号重复')
        pm = {p['id']: p for p in s['parcels']}
        for h in s['households']:
            if h['home'] not in pm or not pm[h['home']].get('building'):
                raise ValueError('存档居民缺少住所')
            number(h['size'], 1, 10, '家庭人数', True)
        for p in s['parcels']:
            city.point(p['center'])
            if not Polygon(p['points']).is_valid:
                raise ValueError('存档包含无效地块')
            if p.get('building'):
                number(p['building']['capacity'], 0, 100000, '建筑容量', True)
        for collection in ('roads','stops','lines','households','facilities','regionalServices'):
            object_ids=[o['id'] for o in s[collection]]
            if len(object_ids)!=len(set(object_ids)):
                raise ValueError('存档对象编号重复')
        for stop in s['stops']:
            if stop.get('role','passenger') not in ('passenger','freight') or stop.get('role')=='freight' and stop['mode']!='train':raise ValueError('存档车站设施角色无效')
        for service in s['regionalServices']:
            number(service['trainsPerDay'],1,48,'每日货列',True)
            number(service['tonnesPerTrain'],10,5000,'货列吨数')
        homes=Counter();workers=Counter()
        for h in s['households']:
            number(h['income'],1,100000000,'家庭月收入')
            homes[h['home']]+=1
            b=pm[h['home']]['building']
            if b['use']!='residential' or b['status']=='construction' or homes[h['home']]>b['capacity']:
                raise ValueError('存档住房占用无效')
            if h.get('job'):
                q=pm.get(h['job']);job=q.get('building') if q else None
                workers[h['job']]+=1
                if not job or job['use']=='residential' or workers[h['job']]>job.get('positions',0):
                    raise ValueError('存档岗位引用或占用无效')
        for p in s['parcels']:
            if p.get('building') and not Polygon(p['points']).buffer(.01).covers(Polygon(p['building']['footprint'])):
                raise ValueError('存档建筑超出地块')
        city.s = s
        city.parcelmap = pm
        renewal.validate(city)
        special_buildings.validate(city)
        for facility in s['facilities']:
            if facility['kind'] in auto_facilities.CATALOG:
                auto_facilities.facility_architecture.ensure(facility)
        from .visual_case import upgrade_visual_layout
        upgrade_visual_layout(city)
        city.rng.setstate(tuples(data['random']))
        city.rebuild(regenerate=False)
        city.restore_runtime(data.get('runtime',{}))
        return city

    def rebuild(self, regenerate=False):
        from .lane_connections import connect_lane_entrances
        if connect_lane_entrances(self):
            regenerate = True
        if regenerate:
            previous=getattr(self,'_parcel_roads',{})
            current={r['id']:(r['kind'],r['level'],tuple(map(tuple,r['points']))) for r in self.s['roads']}
            changed={rid for rid in previous.keys()|current.keys() if previous.get(rid)!=current.get(rid)}
            affected=set(current) if not previous else set(changed)
            from shapely.ops import unary_union
            zones=[LineString(info[2]).buffer(180) for rid in changed for info in (previous.get(rid),current.get(rid)) if info]
            area=unary_union(zones)
            if previous:
                affected.update(rid for rid,info in current.items() if LineString(info[2]).intersects(area))
            old_plans=self.s.get('streetPlans',[])
            plans=plan_streets(self)
            if old_plans!=plans: affected=set(current)
            affected.update(prepare_blocks(self))
            self.s['parcels'] = parcels_for(self.s['roads'], self.s['parcels'], self.terrain,plans,affected)
            self._parcel_roads=current
            self.s['geometryUpdate']=dict(changedRoads=len(changed),recomputedRoads=len(affected),totalRoads=len(current))
        special_buildings.reserve(self)
        self.network = make_network(self.s['roads'], self.s['stops'], self.terrain,self.s['parcels'])
        signals.configure(self.network,self.s['policy'])
        self.live_traffic = None
        for stop in self.s['stops']:
            attachment = self.network['stops'].get(stop['id'])
            stop['connected'] = bool(attachment and attachment['access'])
            if attachment:
                stop['point'] = attachment['point']
        for f in self.s['facilities']:
            if f.get('stop'):
                f['railConnected'] = bool(self.network['stops'].get(f['stop']))
        self.parcelmap = {p['id']: p for p in self.s['parcels']}
        for p in self.s['parcels']:
            p.setdefault('terrain',self.terrain.features(Polygon(p['points'])))
        update_entrances(self)
        self.attach_parcels()
        self.build_graphs()
        self._parcel_roads={r['id']:(r['kind'],r['level'],tuple(map(tuple,r['points']))) for r in self.s['roads']}

    def attach_parcels(self):
        edges_by_road = defaultdict(list)
        for e in self.network['edges']:
            edges_by_road[e['road']].append(e)
        for p in self.s['parcels']:
            choices = [e for e in edges_by_road[p['road']] if e['kind'] in FRONTAGE_ROADS and e['level']==0]
            if not choices:
                p['connected'], p['access'] = False, None
                continue
            e = min(choices, key=lambda e: LineString(e['points']).distance(Point(p['frontage'])))
            line = LineString(e['points'])
            if line.distance(Point(p['frontage'])) > 3:
                p['connected'], p['access'] = False, None
                continue
            d = line.project(Point(p['frontage']))
            p['connected'] = True
            p['access'] = dict(a=e['a'], b=e['b'], da=max(0,d), db=max(0,e['length']-d), edge=e['id'],
                               road=e['road'], kind=e['kind'], oneway=e['oneway'])

    @staticmethod
    def add(graph, a, b, minutes, kind, ref='', **extra):
        graph[a].append(dict(to=b, time=max(0., minutes), kind=kind, ref=ref, **extra))

    def build_graphs(self):
        walk, drive = defaultdict(list), defaultdict(list)
        rails = {k: defaultdict(list) for k in ('metro','train','tram')}
        self.edge_map = {e['id']: e for e in self.network['edges']}
        for e in self.network['edges']:
            cfg = ROAD_TYPES[e['kind']]
            if cfg['walk']:
                for a,b in [(e['a'],e['b']), (e['b'],e['a'])]:
                    self.add(walk,a,b,e.get('walkTime',e['length']/80)*80/self.s['policy']['walkingMetersPerMinute'],'walk',e['id'],length=e['length'])
            if e['kind'] in DRIVABLE_ROADS:
                delay=e.get('signalDelayForward',0)
                self.add(drive,e['a'],e['b'],e['time']+delay,'car',e['id'],length=e['length'],signalDelay=delay)
                if not e['oneway']:
                    delay=e.get('signalDelayReverse',0)
                    self.add(drive,e['b'],e['a'],e['time']+delay,'car',e['id'],length=e['length'],signalDelay=delay)
            if e['kind'] in rails:
                for a,b in [(e['a'],e['b']), (e['b'],e['a'])]:
                    self.add(rails[e['kind']],a,b,e['time'],e['kind'],e['id'],length=e['length'])
        for p in self.s['parcels']:
            a = p.get('access')
            if not a:
                continue
            for node, distance in [(a['a'],a['da']),(a['b'],a['db'])]:
                for source,target in [(p['id'],node),(node,p['id'])]:
                    self.add(walk,source,target,distance/max(1,self.edge_map[a['edge']]['length'])*self.edge_map[a['edge']].get('walkTime',distance/80)*80/self.s['policy']['walkingMetersPerMinute']+p.get('accessLength',math.dist(p.get('entrance',p['center']),p['frontage']))/self.s['policy']['walkingMetersPerMinute']*(1+p['terrain']['slope']*5),'walk',length=distance+p.get('accessLength',math.dist(p.get('entrance',p['center']),p['frontage'])))
            speed = ROAD_TYPES[a['kind']]['speed']/max(1,self.edge_map[a['edge']]['time']/max(.0001,self.edge_map[a['edge']]['length']/1000/ROAD_TYPES[a['kind']]['speed']*60))
            delay=self.edge_map[a['edge']].get('signalDelayForward',0)
            self.add(drive,p['id'],a['b'],a['db']/1000/speed*60+.5+delay,'car',a['edge'],length=a['db'],signalDelay=delay)
            self.add(drive,a['a'],p['id'],a['da']/1000/speed*60+.5,'car',a['edge'],length=a['da'])
            if not a['oneway']:
                delay=self.edge_map[a['edge']].get('signalDelayReverse',0)
                self.add(drive,p['id'],a['a'],a['da']/1000/speed*60+.5+delay,'car',a['edge'],length=a['da'],signalDelay=delay)
                self.add(drive,a['b'],p['id'],a['db']/1000/speed*60+.5,'car',a['edge'],length=a['db'])
        for path in self.s.get('localPaths',[]):
            if path['kind']=='neighbourhood':
                for a,b in [(path['parcel'],path['target']),(path['target'],path['parcel'])]:
                    self.add(walk,a,b,path['minutes']*80/self.s['policy']['walkingMetersPerMinute'],'walk',path['id'],length=path['length'])
        for facility in self.s['facilities']:
            facility.pop('accessPath',None)
            # Parcel-based facilities use their actual reserved entrance. A
            # nearest-road shortcut can otherwise pass through another site.
            parcel=self.parcelmap.get(facility.get('parcel'))
            if parcel:
                facility['connected']=bool(parcel.get('connected'))
                if facility['connected']:
                    for a,b in [(facility['id'],parcel['id']),(parcel['id'],facility['id'])]:
                        self.add(walk,a,b,0,'walk',length=0)
                        self.add(drive,a,b,0,'car',length=0)
                continue
            candidates=[e for e in self.network['edges'] if e['level']==0 and ROAD_TYPES[e['kind']]['walk']]
            facility['connected']=False
            if not candidates:
                continue
            access_point=facility.get('accessPoint',facility['point'])
            e=min(candidates,key=lambda e:(LineString(e['points']).distance(Point(access_point)),e['id']))
            shape=LineString(e['points'])
            d=shape.project(Point(access_point))
            q=list(shape.interpolate(d).coords[0])
            connector=LineString([q,access_point])
            if connector.length>200 or (connector.length>1 and not self.terrain.buildable(connector.buffer(.1),1)):
                continue
            facility['connected']=True
            if special_buildings.special(facility):facility['accessPath']=[q,access_point]
            for node,distance in [(e['a'],d),(e['b'],e['length']-d)]:
                for a,b in [(facility['id'],node),(node,facility['id'])]:
                    self.add(walk,a,b,(distance+connector.length)/self.s['policy']['walkingMetersPerMinute'],'walk',length=distance+connector.length)
            # Drive to the road-side access, with parking included by route().
            if e['kind']!='path':
                speed=ROAD_TYPES[e['kind']]['speed']
                delay=e.get('signalDelayForward',0)
                self.add(drive,facility['id'],e['b'],(e['length']-d)/1000/speed*60+.5+delay,'car',e['id'],length=e['length']-d,signalDelay=delay)
                self.add(drive,e['a'],facility['id'],d/1000/speed*60+.5,'car',e['id'],length=d)
                if not e['oneway']:
                    delay=e.get('signalDelayReverse',0)
                    self.add(drive,facility['id'],e['a'],d/1000/speed*60+.5+delay,'car',e['id'],length=d,signalDelay=delay)
                    self.add(drive,e['b'],facility['id'],(e['length']-d)/1000/speed*60+.5,'car',e['id'],length=e['length']-d)
        ground_nodes={nid:point for nid,point in self.network['nodes'].items() if nid.startswith('road:0:')}
        if self.s['gateway'] is None and ground_nodes:
            self.s['gateway']=list(next(iter(ground_nodes.values())))
        self.gateway_node=None
        if self.s['gateway'] and ground_nodes:
            candidate=min(ground_nodes,key=lambda n:math.dist(ground_nodes[n],self.s['gateway']))
            if math.dist(ground_nodes[candidate],self.s['gateway'])<20:
                self.gateway_node=candidate
        public = copy.deepcopy(walk)
        for stop in self.s['stops']:
            att = self.network['stops'].get(stop['id'])
            if att and att['access'] and stop.get('role','passenger')=='passenger':
                for a,b in [(stop['id'],att['access']['node']),(att['access']['node'],stop['id'])]:
                    self.add(public,a,b,(att['access']['minutes']-1)*80/self.s['policy']['walkingMetersPerMinute']+1,'walk')
                    self.add(walk,a,b,(att['access']['minutes']-1)*80/self.s['policy']['walkingMetersPerMinute']+1,'walk')
        self.line_segments = {}
        stopmap = {s['id']: s for s in self.s['stops']}
        for line in self.s['lines']:
            line.update(valid=False, reason='', paths=[], fleet=0, operatingCost=0, length=0, cycle=0,breakPoints=[])
            if not line['enabled']:
                line['reason'] = '已停运'
                continue
            if any(s not in stopmap or not self.network['stops'].get(s) or not stopmap[s].get('enabled',True) for s in line['stops']):
                line['reason'] = '站点或基础设施缺失'
                line['breakPoints']=[stopmap[s]['point'] for s in line['stops'] if s in stopmap and (not self.network['stops'].get(s) or not stopmap[s].get('enabled',True))]
                continue
            if any((stopmap[s]['mode'] != line['mode'] or stopmap[s].get('role','passenger')!='passenger') for s in line['stops']):
                line['reason'] = '站点方式不兼容'
                continue
            graph = drive if line['mode'] == 'bus' else rails[line['mode']]
            segments, failure = [], False
            orders=[line['stops']] if line.get('oneway') else [line['stops'],list(reversed(line['stops']))]
            for direction, order in enumerate(orders):
                for index, (a,b) in enumerate(zip(order, order[1:])):
                    source = self.network['stops'][a]['node']
                    target = self.network['stops'][b]['node']
                    distances, prev = shortest_paths(graph, source)
                    if target not in distances:
                        failure = True
                        line['breakPoints']=[stopmap[a]['point'],stopmap[b]['point']]
                        break
                    path = reconstruct(prev, source, target)
                    length = sum(e.get('length',0) for e in path)
                    running = max(distances[target],length/1000/line.get('speed',TRANSIT_TYPES[line['mode']]['speed'])*60) + line.get('dwell',.6)
                    # Tram mixed running inherits nearby road congestion.
                    if line['mode'] == 'tram' and line.get('mixed'):
                        running *= 1 + .3 * self.s.get('stats',{}).get('congestion',0)
                    key = f"{line['id']}:{direction}:{index}"
                    capacity = line['capacity'] * 120 / line['headway']
                    segments.append(dict(key=key, a=a,b=b,direction=direction,time=running,
                                         path=path,length=length,capacity=capacity,load=0., mode=line['mode']))
                if failure:
                    break
            if failure:
                line['reason'] = '停站顺序无法沿网络往返，请检查单向或断路'
                continue
            line['valid'] = True
            line['cycle'] = sum(e['time'] for e in segments) + 8
            line['length'] = sum(e['length'] for e in segments)/len(orders)
            line['fleet'] = max(1, math.ceil(line['cycle']/line['headway']))
            cfg = TRANSIT_TYPES[line['mode']]
            daily_km = line['length']*2/1000*60/line['headway']*line['hours']
            line['operatingCost'] = line['fleet']*cfg['vehicleCost'] + daily_km*cfg['kmCost']*30
            for seg in segments:
                self.line_segments[seg['key']] = seg
                line['paths'].append(dict(key=seg['key'],points=self.path_points(seg['path']),direction=seg['direction']))
                a = f"{line['id']}:{seg['direction']}:{seg['a']}"
                b = f"{line['id']}:{seg['direction']}:{seg['b']}"
                self.add(public,a,b,seg['time'],'ride',line['id'],segment=seg['key'],mode=line['mode'],length=seg['length'])
            for direction in range(len(orders)):
                for sid in line['stops']:
                    onboard=f"{line['id']}:{direction}:{sid}"
                    # Initial wait is headway-based; transfers pay it again, riding through does not.
                    self.add(public,sid,onboard,line['headway']/2+self.s['policy']['boardingMinutes'],'board',line['id'],mode=line['mode'])
                    self.add(public,onboard,sid,self.s['policy']['alightingMinutes'],'alight',line['id'],mode=line['mode'])
        rebuild_regional(self,rails,drive)
        self.graphs = dict(walk=walk, car=drive, public=public)
        self.route_cache = {}
        self.route_solutions = {}

    def path_points(self, path):
        points=[]
        for item in path:
            if item.get('kind')=='ride' and item.get('segment') in self.line_segments:
                points.extend(self.path_points(self.line_segments[item['segment']]['path']))
                continue
            edge=self.edge_map.get(item.get('ref'))
            if not edge:
                edge=next((dict(p,a=p['parcel']) for p in self.s['localPaths'] if p['id']==item.get('ref')),None)
            if edge:
                coords=edge['points'] if item['origin']==edge['a'] else edge['points'][::-1]
                points.extend(coords)
        return points

    def distances(self, source, mode):
        key=(source,mode)
        if key not in self.route_cache:
            if len(self.route_cache)>=256: self.route_cache.pop(next(iter(self.route_cache)))
            self.route_cache[key]=shortest_paths(self.graphs[mode],source)
        return self.route_cache[key]

    def route(self, source, target, car=True, income=6000, allocate=False, period='am', departure=480, required_mode=None):
        key=(source,target,bool(car),income,period,departure,required_mode)
        cached=self.route_solutions.get(key)
        if cached is not None:
            rides=[e for e in cached['path'] if e['kind']=='ride']
            if not allocate or all(self.segment_load[(period,e['segment'])]+1<=self.line_segments[e['segment']]['capacity'] for e in rides):
                if allocate:
                    for e in cached['path']:
                        if e['kind']=='ride':self.segment_load[(period,e['segment'])]+=1
                        elif e['kind']=='car' and e.get('ref'):self.road_load[(period,e['ref'])]+=1
                return cached
        options=[]
        def operating(line,minute):
            return (minute-line.get('startHour',6)*60)%1440 < line['hours']*60
        for mode in ('walk','car','public'):
            if required_mode and mode!='public':
                continue
            if mode=='car' and not car:
                continue
            distances,prev=self.distances(source,mode)
            if target not in distances:
                continue
            path=reconstruct(prev,source,target)
            if mode=='public' and allocate:
                lines={l['id']:l for l in self.s['lines']}
                def available_weight(e,elapsed):
                    if e['kind']=='ride':
                        seg=self.line_segments[e['segment']]
                        used=self.segment_load[(period,e['segment'])]
                        if used+1>seg['capacity']: return None
                        return e['time']*(1+.25*(used/max(1,seg['capacity']))**2)
                    if e['kind']=='board':
                        l=lines[e['ref']];start=l.get('startHour',6)*60
                        if not operating(l,departure+elapsed): return None
                    return e['time']
                if any(e['kind']=='ride' and self.segment_load[(period,e['segment'])]+1>self.line_segments[e['segment']]['capacity'] for e in path) or any(e['kind']=='board' and not operating(lines[e['ref']],departure) for e in path):
                    distances,prev=shortest_paths(self.graphs['public'],source,target,available_weight)
                    if target not in distances: continue
                    path=reconstruct(prev,source,target)
            rides=[e for e in path if e['kind']=='ride']
            if required_mode and not any(e.get('mode')==required_mode for e in rides):
                continue
            if mode=='public' and not rides:
                continue
            minutes=distances[target]
            if mode=='walk' and minutes>self.s['policy']['walkMaximumMinutes']:
                continue
            if mode=='car':
                minutes+=self.s['policy']['parkingMinutes']  # parking and access, counted once per complete journey
            elif mode=='public':
                # Low-frequency rail uses scheduled departures from 06:00.
                elapsed=departure
                unavailable=False
                line_map={l['id']:l for l in self.s['lines']}
                extra_wait=0.
                for e in path:
                    if e['kind']=='board':
                        line=line_map[e['ref']]
                        start=line.get('startHour',6)*60
                        if not operating(line,elapsed):
                            unavailable=True
                            break
                        if line['headway']>=self.s['policy']['lowFrequencyHeadway']:
                            scheduled=(line['headway']-(elapsed-start)%line['headway'])%line['headway']
                            adjustment=scheduled-line['headway']/2
                            extra_wait+=adjustment
                            elapsed+=adjustment
                    elapsed+=e['time']
                if unavailable:
                    continue
                minutes+=extra_wait
                if allocate and any(self.segment_load[(period,e['segment'])]+1>self.line_segments[e['segment']]['capacity'] for e in rides):
                    continue
            if minutes>self.s['policy']['journeyMaximumMinutes']:
                continue
            fee=0 if mode=='walk' else (self.s['settings']['fare'] if mode=='public' else sum(e.get('length',0) for e in path)/1000*self.s['policy']['carCostPerKm']+self.s['policy']['carParkingFee'])
            transfers=max(0,sum(e['kind']=='board' for e in path)-1)
            cost=minutes + fee/max(.15,income/10000) + transfers*self.s['policy']['transferPenaltyMinutes']
            options.append((cost,mode,minutes,path,fee,extra_wait if mode=='public' else 0))
        if not options:
            return None
        _,mode,minutes,path,fee,extra_wait=min(options,key=lambda row:(row[0],row[1]))
        if allocate:
            for e in path:
                if e['kind']=='ride':
                    self.segment_load[(period,e['segment'])]+=1
                elif e['kind']=='car' and e.get('ref'):
                    self.road_load[(period,e['ref'])]+=1
        ride_distance=Counter()
        for edge in path:
            if edge['kind']=='ride': ride_distance[edge.get('mode','bus')]+=edge.get('length',0)
        main_mode=max(ride_distance,key=ride_distance.get) if ride_distance else mode
        result=dict(mode=mode,mainMode=main_mode, minutes=round(minutes,2), path=path, fee=fee,
                    distance=sum(e.get('length',0) for e in path), transfers=max(0,sum(e['kind']=='board' for e in path)-1),
                    wait=max(0,sum(e['time'] for e in path if e['kind']=='board')+extra_wait),
                    signalWait=round(sum(e.get('signalDelay',0) for e in path),3))
        if len(self.route_solutions)<24000:self.route_solutions[key]=result
        return result

    def command(self, cmd):
        if not isinstance(cmd,dict):
            raise ValueError('命令必须为对象')
        expected=cmd.get('revision')
        if expected is not None and expected!=self.s['revision']:
            raise ValueError('城市已更新，请刷新后重试')
        op=cmd.get('type')
        if op in ('undo','redo'):
            source,target=(self.undo,self.redo) if op=='undo' else (self.redo,self.undo)
            if not source:
                raise ValueError('没有可撤销的操作')
            target.append((copy.deepcopy(self.s),self.rng.getstate(),self.runtime()))
            revision=self.s['revision']+1
            clock=copy.deepcopy(self.s['simulation'])
            daylight=self.s['sceneTimeSeconds']
            self.s,random_state,runtime=source.pop()
            clock_changed=self.s['simulation']!=clock or self.s['sceneTimeSeconds']!=daylight
            self.s['simulation']=clock
            self.s['sceneTimeSeconds']=daylight
            if clock_changed:
                runtime=copy.deepcopy(runtime)
                runtime['liveTraffic']=None
            self.rng.setstate(random_state)
            self.s['revision']=revision
            self.rebuild()
            self.restore_runtime(runtime)
            return self.view()
        before=(copy.deepcopy(self.s),self.rng.getstate(),self.runtime())
        try:
            if op in ('delete','zone','road_edit','road_update'):
                if any(project['status'] not in renewal.TERMINAL and any(p['id'] in project['preservedIds'] and cmd.get('id') in (p['id'],p.get('openSpace')) for p in self.s['parcels']) for project in self.s['renewals']):
                    raise ValueError('此用地是更新项目保留的公共空间或保护地，请等待项目结束')
                affected=self.parcelmap.get(cmd.get('id'))
                if affected and renewal.locked(self,affected):
                    raise ValueError('此地块正在更新，请先取消未开工阶段或等待交付')
                if any(renewal.locked(self,p) and p['road']==cmd.get('id') for p in self.s['parcels']):
                    raise ValueError('此道路服务正在更新的地块，请等待项目结束')
            if op=='renewal_start':
                renewal.start(self,cmd)
            elif op=='renewal_cancel':
                renewal.cancel(self,cmd.get('id'))
            elif op=='road':
                self.add_road(cmd)
                self.rebuild(regenerate=True)
            elif op=='road_edit':
                road=next((r for r in self.s['roads'] if r['id']==cmd.get('id')),None)
                if not road:
                    raise ValueError('道路不存在')
                self.s['roads'].remove(road)
                self.add_road(dict(cmd,kind=road['kind'],level=road['level'],oneway=road['oneway'],name=road['name']))
                new=self.s['roads'][-1]
                new['id']=road['id']
                for key in ('generated','parent','growthKey'):
                    if key in road: new[key]=road[key]
                self.rebuild(regenerate=True)
            elif op=='stop':
                mode=cmd.get('mode','bus')
                if mode not in TRANSIT_TYPES:
                    raise ValueError('未知交通方式')
                point=self.point(cmd['point']);role=cmd.get('role','passenger');external=bool(cmd.get('external',False))
                if role not in ('passenger','freight') or (role=='freight' or external) and mode!='train':raise ValueError('区域门户和货场必须设在铁路上')
                if external and min(point[0],point[1],self.terrain.width-point[0],self.terrain.height-point[1])>self.s['policy']['regionalBoundaryMeters']:raise ValueError('区域门户必须位于地图边界附近')
                self.s['stops'].append(dict(id=self.uid('s'),name=text(cmd.get('name','新站')),mode=mode,point=point,enabled=True,role=role,external=external))
                self.rebuild()
                stop=self.s['stops'][-1]
                if not self.network['stops'].get(stop['id']):
                    raise ValueError('附近没有兼容的道路或轨道，请在设施上设置站点')
                stop['constructionCost']=25000 if mode=='bus' else 500000
                self.spend(stop['constructionCost'],'车站建设')
            elif op=='freight_service':
                start=cmd.get('start');end=cmd.get('end')
                if start==end:raise ValueError('货运起终点不能相同')
                self.s['regionalServices'].append(dict(id=self.uid('freight'),name=text(cmd.get('name','区域货运')),start=start,end=end,enabled=True,trainsPerDay=number(cmd.get('trainsPerDay',4),1,48,'每日货列',True),tonnesPerTrain=number(cmd.get('tonnesPerTrain',500),10,5000,'每列吨数')))
                self.rebuild()
                if not self.s['regionalServices'][-1]['valid']:raise ValueError(self.s['regionalServices'][-1]['reason'])
            elif op=='freight_update':
                service=next((s for s in self.s['regionalServices'] if s['id']==cmd.get('id')),None)
                if not service:raise ValueError('货运服务不存在')
                if 'enabled' in cmd:service['enabled']=bool(cmd['enabled'])
                if 'trainsPerDay' in cmd:service['trainsPerDay']=number(cmd['trainsPerDay'],1,48,'每日货列',True)
                if 'tonnesPerTrain' in cmd:service['tonnesPerTrain']=number(cmd['tonnesPerTrain'],10,5000,'每列吨数')
                self.rebuild()
            elif op=='line':
                self.add_line(cmd)
            elif op=='line_update':
                line=next((l for l in self.s['lines'] if l['id']==cmd.get('id')),None)
                if line is None:
                    raise ValueError('线路不存在')
                for k,lo,hi in [('headway',2,120),('capacity',10,2000),('hours',4,24)]:
                    if k in cmd:
                        line[k]=number(cmd[k],lo,hi,k)
                if 'enabled' in cmd:
                    line['enabled']=bool(cmd['enabled'])
                if 'name' in cmd: line['name']=text(cmd['name'])
                if 'color' in cmd:
                    import re
                    if not re.fullmatch(r'#[0-9a-fA-F]{6}',str(cmd['color'])): raise ValueError('线路颜色格式错误')
                    line['color']=cmd['color']
                if 'stops' in cmd:
                    ids=cmd['stops']
                    if not isinstance(ids,list) or len(ids)<2 or len(ids)!=len(set(ids)):
                        raise ValueError('停站顺序需要至少两个不重复站点')
                    line['stops']=ids
                for key,lo,hi in [('dwell',.1,10),('speed',5,180),('startHour',0,23)]:
                    if key in cmd: line[key]=number(cmd[key],lo,hi,key)
                if 'oneway' in cmd: line['oneway']=bool(cmd['oneway'])
                self.rebuild()
                if line['enabled'] and not line['valid']: raise ValueError(line['reason'])
            elif op=='stop_update':
                stop=next((s for s in self.s['stops'] if s['id']==cmd.get('id')),None)
                if not stop: raise ValueError('站点不存在')
                if 'name' in cmd: stop['name']=text(cmd['name'])
                if 'enabled' in cmd: stop['enabled']=bool(cmd['enabled'])
                self.rebuild()
            elif op=='delete':
                special_buildings.remove(self,cmd.get('id'))
                found=False
                for parcel in self.s['parcels']:
                    if parcel.get('openSpace')==cmd.get('id'):
                        parcel.pop('openSpace',None)
                for key in ('roads','stops','lines','facilities','regionalServices'):
                    n=len(self.s[key])
                    self.s[key]=[o for o in self.s[key] if o['id']!=cmd.get('id')]
                    found|=n!=len(self.s[key])
                if cmd.get('id') in self.parcelmap:
                    p=self.parcelmap[cmd['id']]
                    if p.get('building'):
                        displaced=[h for h in self.s['households'] if h['home']==p['id']]
                        self.s['households']=[h for h in self.s['households'] if h['home']!=p['id']]
                        self.s['movedOut']+=sum(h['size'] for h in displaced)
                        if displaced: self.s['migrationFlows'].append(dict(source=p['center'],target=self.s['gateway'] or [0,0],kind='out',people=sum(h['size'] for h in displaced)))
                        p['building']=None
                        self.event('拆迁',f"拆除建筑，{sum(h['size'] for h in displaced)} 人迁出")
                        found=True
                if not found:
                    raise ValueError('对象不存在')
                self.rebuild(regenerate=True)
            elif op=='zone':
                p=self.parcelmap.get(cmd.get('id'))
                if not p or cmd.get('use') not in (*USES,'auto','protected'):
                    raise ValueError('地块或用途无效')
                if p.get('blockCommon') and cmd['use'] not in ('auto','protected'):
                    raise ValueError('街区共享通道与公共空间不能改成建筑用地')
                p['use']=cmd['use']
            elif op=='special_building':
                special_buildings.place(self,cmd)
                self.rebuild()
            elif op=='facility':
                kind=cmd.get('kind')
                if kind not in ('school','clinic','park','plaza'):
                    raise ValueError('未知公共设施')
                point=self.point(cmd['point'])
                shape=Point(point).buffer(15)
                if not self.terrain.buildable(shape):
                    raise ValueError('公共设施需建在平缓陆地')
                if any(shape.intersection(Polygon(f['points'])).area>.1 for f in self.s['facilities'] if f.get('points')):
                    raise ValueError('公共设施与已有设施用地冲突')
                if any(shape.intersects(Polygon(p['building']['footprint'])) for p in self.s['parcels'] if p.get('building')) or any(shape.intersects(LineString(r['points']).buffer(ROAD_TYPES[r['kind']]['width']/2)) for r in self.s['roads'] if r['level']==0):
                    raise ValueError('公共设施与建筑或道路冲突')
                fid=self.uid('f')
                for p in self.s['parcels']:
                    if shape.intersects(Polygon(p['points'])):
                        if renewal.locked(self,p): raise ValueError('公共设施与更新项目用地冲突')
                        if p.get('openSpace') or p['use']=='protected': raise ValueError('此处已有公共设施或保护用地')
                        p['openSpace']=fid
                cost=200000*self.terrain.features(shape)['costFactor']
                self.s['facilities'].append(dict(id=fid,kind=kind,point=point,points=[list(q) for q in shape.exterior.coords],capacity=500,cost=cost,maintenance=12000,generated=False))
                self.rebuild()
                self.spend(cost,'公共设施')
            elif op=='policy':
                for key,value in cmd.get('values',{}).items():
                    if key not in POLICY or not isinstance(POLICY[key],(int,float)):raise ValueError('未知校准参数')
                    self.s['policy'][key]=number(value,.00001,100000,key,isinstance(POLICY[key],int))
                number(self.s['policy']['trafficIterations'],1,6,'交通分配轮次',True)
                self._integration_signature=None
                self.rebuild()
            elif op=='settings':
                limits=dict(migration=(0,500),externalJobs=(0,10000),growth=(0,3),fare=(0,20),taxRate=(0,.3),maxProjects=(0,50),accessBudget=(10,90))
                for k,v in cmd.get('values',{}).items():
                    if k in ('budget','autoGrow','autoRenew'):
                        self.s['settings'][k]=bool(v)
                    elif k in limits:
                        self.s['settings'][k]=number(v,*limits[k],k)
                    else:
                        raise ValueError('未知情景参数')
            elif op=='signal_timing':
                limits=dict(signalGreenSeconds=(5,90),signalYellowSeconds=(2,6),signalClearanceSeconds=(2,15))
                for key,value in cmd.get('values',{}).items():
                    if key not in limits:raise ValueError('未知配时参数')
                    self.s['policy'][key]=number(value,*limits[key],key,True)
                self.rebuild()
            elif op=='road_update':
                road=next((r for r in self.s['roads'] if r['id']==cmd.get('id')),None)
                kind=cmd.get('kind')
                if not road or kind not in ROAD_KINDS or group(road)!='road':
                    raise ValueError('只能升级道路网络中的设施')
                shape=LineString(road['points'])
                special_buildings.check_roads(self,shape.buffer(ROAD_TYPES[kind]['width']/2+2),kind,road['level'],road['id'])
                self.terrain.valid_link(shape,kind,road['level'])
                if road['level']==0 and any(shape.buffer(ROAD_TYPES[kind]['width']/2+2).intersection(Polygon(p['building']['footprint'])).area>1 for p in self.s['parcels'] if p.get('building')):
                    raise ValueError('升级后的道路侵入建筑，请先处理冲突')
                if road['level']==0 and any(shape.buffer(ROAD_TYPES[kind]['width']/2+2).intersection(Polygon(p['points'])).area>1 for p in self.s['parcels'] if p.get('openSpace') or p['use']=='protected'):
                    raise ValueError('升级后的道路侵入公共空间或保护用地，请先处理冲突')
                profile=self.terrain.profile(shape,kind,road['level'])
                cost=road['length']*ROAD_TYPES[kind]['cost']*profile['costFactor']
                self.spend(max(0,cost-road.get('constructionCost',0)),'道路改造')
                old_kind=road['kind']
                if road['name'] in (ROAD_TYPES[old_kind]['name'],{'street':'街道','lane':'社区支路'}.get(old_kind)):
                    road['name']=ROAD_TYPES[kind]['name']
                road['kind']=kind; road['oneway']=bool(cmd.get('oneway',False))
                road.update(profile=profile,constructionCost=round(cost))
                self.rebuild(regenerate=True)
            elif op=='gateway':
                point=self.point(cmd['point'])
                nodes={k:v for k,v in self.network['nodes'].items() if k.startswith('road:0:')}
                if not nodes:
                    raise ValueError('请先绘制地面道路')
                node=min(nodes,key=lambda n:math.dist(point,nodes[n]))
                self.s['gateway']=list(nodes[node])
                self.rebuild()
            elif op=='demo':
                self.demo()
            else:
                raise ValueError('未知建设命令')
            self.s['revision']+=1
            self.s['commands'].append(dict(month=self.s['month'],command=copy.deepcopy(cmd)))
            self.s['commands']=self.s['commands'][-1000:]
            if op not in ('zone','settings') and self.s['households']:
                self.match_jobs()
                self.assign_traffic()
            self.summarize()
        except Exception:
            self.s,state,runtime=before
            self.rng.setstate(state)
            self.rebuild()
            self.restore_runtime(runtime)
            raise
        self.undo.append(before)
        self.undo=self.undo[-20:]
        self.redo=[]
        return self.view()

    def spend(self, amount, category='其他工程'):
        if self.s['settings']['budget'] and self.s['treasury']<amount:
            raise ValueError('建设预算不足')
        self.s['treasury']-=amount
        self.s['constructionCost']+=amount
        accounts=self.s.setdefault('capitalAccounts',{})
        accounts[category]=accounts.get(category,0)+amount

    def add_road(self, cmd):
        kind=cmd.get('kind','street')
        if kind not in ROAD_TYPES:
            raise ValueError('未知道路类型')
        raw=cmd.get('points')
        if not isinstance(raw,list) or not 2<=len(raw)<=100:
            raise ValueError('路线需要 2–100 个控制点')
        level=number(cmd.get('level',0),-1,1,'层级',True)
        pts=[self.point(p) for p in raw]
        shape_mode=cmd.get('shape','polyline')
        if shape_mode not in ('polyline','curve'):
            raise ValueError('未知路线形状')
        # Snap within a metric tolerance; precision is independent of zoom.
        for i in (0,len(pts)-1):
            candidates=[]
            for road in self.s['roads']:
                if group(road)!=('road' if kind in ROAD_KINDS else kind):
                    continue
                line=LineString(road['points'])
                if road['level']==level:
                    q=line.interpolate(line.project(Point(pts[i])))
                    candidates.append((q.distance(Point(pts[i])),list(q.coords[0])))
                for p in (road['points'][0],road['points'][-1]):
                    candidates.append((math.dist(p,pts[i]),p))
            if candidates:
                distance,point=min(candidates,key=lambda t:t[0])
                if distance<18:
                    pts[i]=list(point)
        controls=copy.deepcopy(pts)
        pts=curve_points(controls,shape_mode=='curve')
        shape=LineString(pts)
        if not shape.is_simple or shape.length<20:
            raise ValueError('路线过短或自相交')
        adjusted = False
        try:
            self.terrain.valid_link(shape,kind,level)
        except RoadConflict as error:
            if error.code!='grade' or not cmd.get('autoRoute') or level!=0:
                raise
            from .road_alignment import route_around_grade
            from shapely.ops import unary_union
            clearance = ROAD_TYPES[kind]['width']/2+2
            obstacles = []
            for parcel in self.s['parcels']:
                if parcel.get('building'):
                    obstacles.append(Polygon(parcel['building']['footprint']).buffer(clearance))
                if parcel.get('openSpace') or parcel['use']=='protected' or renewal.locked(self,parcel):
                    obstacles.append(Polygon(parcel['points']).buffer(clearance))
            routed = route_around_grade(self.terrain,controls,kind,unary_union(obstacles))
            if routed is None:
                raise RoadConflict('附近未找到可行的绕坡路线，请移动终点、增加中间控制点或使用隧道',error.point,code='grade')
            pts=controls=routed
            shape=LineString(pts);shape_mode='polyline';adjusted=True
        for road in self.s['roads']:
            if road['level']==level and group(road)==('road' if kind in ROAD_KINDS else kind):
                if shape.intersection(LineString(road['points'])).length>2:
                    raise RoadConflict('路线与已有设施重叠',shape.intersection(LineString(road['points'])).representative_point().coords[0])
        special_buildings.check_roads(self,shape.buffer(ROAD_TYPES[kind]['width']/2+2),kind,level)
        if level==0:
            occupied=shape.buffer(ROAD_TYPES[kind]['width']/2+2)
            for parcel in self.s['parcels']:
                if renewal.locked(self,parcel) and occupied.intersection(Polygon(parcel['points'])).area>1:
                    raise ValueError('道路与更新项目预留用地冲突')
                if parcel.get('building') and occupied.intersection(Polygon(parcel['building']['footprint'])).area>1:
                    raise RoadConflict('道路与现有建筑冲突，请移动控制点或先拆除建筑',occupied.intersection(Polygon(parcel['building']['footprint'])).representative_point().coords[0])
                if (parcel.get('openSpace') or parcel['use']=='protected') and occupied.intersection(Polygon(parcel['points'])).area>1:
                    raise RoadConflict('道路与公共空间或保护用地冲突',occupied.intersection(Polygon(parcel['points'])).representative_point().coords[0])
        if len(self.s['roads'])>=2000:
            raise ValueError('已达到本版本 2000 条道路上限')
        profile=self.terrain.profile(shape,kind,level)
        cost=shape.length*ROAD_TYPES[kind]['cost']*profile['costFactor']
        self.spend(cost,'轨道工程' if kind in ('metro','train','tram') else '道路工程')
        self.s['roads'].append(dict(id=self.uid('r'),kind=kind,level=level,points=pts,
                                   controls=controls,shape=shape_mode,terrainAdjusted=adjusted,profile=profile,constructionCost=round(cost),
                                   oneway=bool(cmd.get('oneway',False)),name=text(cmd.get('name',ROAD_TYPES[kind]['name'])),
                                   length=shape.length))

    def preview_road(self,cmd):
        state=self.s
        try:
            self.s=copy.deepcopy(state)
            if cmd.get('id'):
                self.s['roads']=[r for r in self.s['roads'] if r['id']!=cmd['id']]
            self.add_road(cmd)
            from .lane_connections import connect_lane_entrances
            connect_lane_entrances(self)
            road=self.s['roads'][-1]
            return dict(valid=True,road=road,connections=sum(next(road_contacts(road,r),None) is not None for r in self.s['roads'] if r['id']!=road['id']))
        except ValueError as error:
            return dict(valid=False,reason=str(error),point=getattr(error,'point',None))
        finally:
            self.s=state

    def query(self,params):
        kind=params.get('kind','area')
        if kind=='area':
            a,b=[self.point(p) for p in params['bounds']]
            parcels=[p for p in self.s['parcels'] if min(a[0],b[0])<=p['center'][0]<=max(a[0],b[0]) and min(a[1],b[1])<=p['center'][1]<=max(a[1],b[1])]
        elif kind=='isochrone':
            source=params.get('source');mode=params.get('mode','public')
            if source not in self.parcelmap and source not in {s['id'] for s in self.s['stops']} or mode not in self.graphs: raise ValueError('请选择有效起点与交通方式')
            budget=number(params.get('minutes',30),1,120,'可达时间')
            distances=self.distances(source,mode)[0]
            parcels=[p for p in self.s['parcels'] if distances.get(p['id'],math.inf)<=budget]
        elif kind=='district':
            district=next((d for d in self.s['districts'] if d['id']==params.get('id')),None)
            if not district: raise ValueError('城区不存在')
            parcels=[self.parcelmap[pid] for pid in district['parcels']]
        else:
            raise ValueError('未知查询类型')
        return dict(kind=kind,month=self.s['month'],model=MODEL_VERSION,selection=params,stats=spatial_summary(self,parcels),rule='地块中心落入范围；按同一月末状态汇总')

    def add_line(self, cmd):
        mode=cmd.get('mode','bus')
        stops=cmd.get('stops',[])
        if mode not in TRANSIT_TYPES or not isinstance(stops,list) or not 2<=len(stops)<=80 or len(stops)!=len(set(stops)):
            raise ValueError('线路需要至少两个不重复的兼容站点')
        line=dict(id=self.uid('l'),name=text(cmd.get('name',TRANSIT_TYPES[mode]['name']+'线')),mode=mode,
                  stops=stops,headway=number(cmd.get('headway',10),2,120,'发车间隔'),
                  capacity=number(cmd.get('capacity',TRANSIT_TYPES[mode]['capacity']),10,2000,'容量'),
                  hours=number(cmd.get('hours',16),4,24,'运营小时'),enabled=True,mixed=bool(cmd.get('mixed',False)),
                  startHour=number(cmd.get('startHour',6),0,23,'首班小时'),dwell=number(cmd.get('dwell',.6),.1,10,'停站分钟'),
                  speed=number(cmd.get('speed',TRANSIT_TYPES[mode]['speed']),5,180,'车辆限速'),oneway=bool(cmd.get('oneway',False)),
                  boardings=0,load=0, color=['#387e8c','#b67848','#7869a2','#b75b67'][len(self.s['lines'])%4])
        self.s['lines'].append(line)
        self.rebuild()
        if not line['valid']:
            raise ValueError(line['reason'])
        self.event('交通',f"{line['name']}开通，共 {len(stops)} 站，每 {line['headway']:g} 分钟一班")

    def demo(self):
        if self.s['roads']:
            raise ValueError('示范路网仅适用于空白城市，已有城市可另建存档')
        # Search actual terrain for a dry, relatively flat neighbourhood.
        size=min(1300,self.terrain.width*.22,self.terrain.height*.22)
        best=None
        for y in np.linspace(size,self.terrain.height-size,9):
            for x in np.linspace(size,self.terrain.width-size,9):
                routes=[]
                for orientation in (0,1):
                    for shift in (-.5,0,.5):
                        pts=([[x-size/2,y+shift*size],[x+size/2,y+shift*size]] if orientation==0
                             else [[x+shift*size,y-size/2],[x+shift*size,y+size/2]])
                        kind='avenue' if shift==0 else 'street'
                        try:
                            self.terrain.valid_link(LineString(pts),kind,0)
                            routes.append(dict(points=pts,kind=kind,level=0))
                        except ValueError:
                            pass
                score=len(routes)
                if best is None or score>best[0]:
                    best=(score,routes)
                if score==6:
                    break
            if best[0]==6:
                break
        if best[0]<2:
            raise ValueError('此地形缺少足够平地，建议降低起伏或提高平整度')
        for route in best[1]:
            self.add_road(route)
        self.rebuild(regenerate=True)
        self.event('规划','示范街区已建立，开始推进月份以观察真实开发')

    def step(self, months=1, *, advance_clock=True):
        months=number(months,1,24,'推进月份',True)
        before=(copy.deepcopy(self.s),self.rng.getstate(),self.runtime())
        try:
            for _ in range(months):
                if advance_clock:simulation.shift_month(self,self.s['month'])
                self.s['month']+=1
                self.s['movedIn']=self.s['movedOut']=self.s['relocated']=0
                self.s['migrationFlows']=[]
                if grow_lanes(self):
                    self.rebuild(regenerate=True)
                if grow_public_spaces(self):
                    self.rebuild()
                renewal.advance(self)
                self.complete_projects()
                update_entrances(self)
                self.build_graphs()
                update_firms(self)
                self.populate()
                self.match_jobs()
                self.assign_traffic()
                self.update_market()
                renewal.automatic(self)
                self.redevelop()
                if auto_facilities.grow(self):self.rebuild()
                if special_buildings.grow_parking(self):self.rebuild()
                self.develop()
                if grow_block_commons(self):self.rebuild()
                update_entrances(self)
                clustered_districts(self)
                if special_buildings.grow_cbd(self):update_entrances(self)
                self.finance()
                self.s['revision']+=1
                self.summarize()
                observe_changes(self)
                self.s['history'].append(dict(copy.deepcopy(self.s['stats']),model=MODEL_VERSION))
                if self.s['month'] % 12 == 0:
                    stats=self.s['stats']
                    self.s['annual'].append(dict(year=self.s['month']//12,month=self.s['month'],population=stats['population'],jobs=stats['jobs'],movedIn=sum(r['movedIn'] for r in self.s['history'][-12:]),movedOut=sum(r['movedOut'] for r in self.s['history'][-12:]),revenue=sum(r['revenue'] for r in self.s['history'][-12:]),maintenance=sum(r['maintenance'] for r in self.s['history'][-12:])))
                    self.event('年报',f"城市发展第 {self.s['month']//12} 年：人口 {stats['population']}，"
                               f"就业 {stats['employed']}，建筑 {stats['buildings']} 栋，"
                               f"土地估值中位数 {stats['landValue'] or 0:.0f} 币/m²")
            # Editing undo never silently rolls economic time backward.
            self.undo=[]
            self.redo=[]
        except Exception:
            self.s,state,runtime=before
            self.rng.setstate(state)
            self.rebuild()
            self.restore_runtime(runtime)
            raise
        return self.view()

    def complete_projects(self):
        for p in self.s['parcels']:
            b=p.get('building')
            if b:
                b['age']+=1
                if b['status']!='construction' and b.get('lastRenovated')!=self.s['month']:
                    b['condition']=round(max(20,b.get('condition',100)-.08),2)
                if b['status']=='construction' and self.s['month']>=b['ready']:
                    b['status']='active'
                    self.event('竣工',f"{USES[b['use']]['name']}竣工，可用{'住宅' if b['use']=='residential' else '岗位空间'} {b['capacity']}",p['center'])

    def available_homes(self):
        occupied=Counter(h['home'] for h in self.s['households'])
        return [p for p in self.s['parcels'] if p['connected'] and p.get('building')
                and p['building']['use']=='residential' and p['building']['status']=='active'
                and not renewal.displacing(self,p) and occupied[p['id']]<p['building']['capacity']]

    def populate(self):
        occupied=Counter(h['home'] for h in self.s['households'])
        surviving=[]
        for h in self.s['households']:
            p=self.parcelmap[h['home']]
            burden=p['rent']*self.s['policy']['householdSpace']/h['income']
            h['burden']=burden
            h['unemployedMonths']=h.get('unemployedMonths',0)+1 if not h.get('job') else 0
            h['stress']=h.get('stress',0)+1 if burden>self.s['policy']['housingBurdenThreshold'] or not p['connected'] or h.get('commuteFailed',False) or h['unemployedMonths']>=self.s['policy']['unemploymentStressMonths'] else max(0,h.get('stress',0)-1)
            if h['stress']>=self.s['policy']['relocationStressMonths']:
                homes=[q for q in self.available_homes() if q['id']!=p['id'] and q['rent']*self.s['policy']['householdSpace']<h['income']*.4]
                if homes:
                    new=min(homes,key=lambda q:q['rent']*self.s['policy']['householdSpace']-q.get('accessJobs',0)*2)
                    h['home']=new['id']; h['stress']=0
                    self.s['relocated']+=h['size']
                    self.s['migrationFlows'].append(dict(source=p['center'],target=new['center'],kind='relocation',people=h['size']))
                    occupied[p['id']]-=1; occupied[new['id']]+=1
                elif h['stress']>=self.s['policy']['exitStressMonths']:
                    self.s['movedOut']+=h['size']
                    self.s['migrationFlows'].append(dict(source=p['center'],target=self.s['gateway'] or [0,0],kind='out',people=h['size']))
                    occupied[p['id']]-=1
                    continue
            surviving.append(h)
        self.s['households']=surviving
        arrivals=int(self.s['settings']['migration']*self.s['settings']['growth'])
        demand=self.s['pendingHousing']+arrivals
        jobs=sum(p['building'].get('positions',0) for p in self.s['parcels'] if p.get('building') and p['building']['status']=='active')
        incoming=min(demand,max(3,jobs-len(surviving)+8)) if self.s['settings']['growth']>0 else 0
        admitted=0
        for _ in range(incoming):
            homes=[p for p in self.available_homes() if occupied[p['id']]<p['building']['capacity']]
            if not homes:
                break
            income=self.rng.choice([3500,5000,7000,10000,16000])
            affordable=[p for p in homes if p['rent']*self.s['policy']['householdSpace']<income*.45]
            if not affordable:
                continue
            home=max(affordable,key=lambda p:(p.get('accessJobs',0)*.8 + p.get('amenity',0)*20-p['rent']*3 + self.rng.random()*5))
            size=self.rng.choice([1,2,2,3,3,4])
            h=dict(id=self.uid('h'),home=home['id'],size=size,income=income,car=self.rng.random()<min(.9,income/14000),
                   job=None,stress=0,burden=home['rent']*self.s['policy']['householdSpace']/income,commute=None,commuteFailed=False)
            self.s['households'].append(h)
            occupied[home['id']]+=1
            admitted+=1; self.s['movedIn']+=size
            self.s['migrationFlows'].append(dict(source=self.s['gateway'] or [0,0],target=home['center'],kind='in',people=size))
        self.s['pendingHousing']=max(0,demand-admitted)

    def match_jobs(self):
        employed=Counter()
        employers=[p for p in self.s['parcels'] if p['connected'] and p.get('building') and p['building']['status']=='active' and p['building']['use']!='residential' and p['building'].get('businessActive',True)]
        for p in self.s['parcels']:
            if p.get('building') and p['building']['use']!='residential':
                p['building']['positions']=0
                p['building']['employees']=0
        jobs={p['id']:p for p in employers}
        population=sum(h['size'] for h in self.s['households'])
        sector_need={'office':self.s['settings']['externalJobs']*self.s['policy']['jobOfficeExternal']+population*self.s['policy']['jobOfficePopulation'],
                     'commercial':12+population*self.s['policy']['jobCommercialPopulation'],'industrial':self.s['settings']['externalJobs']*self.s['policy']['jobIndustrialExternal']+population*self.s['policy']['jobIndustrialPopulation'],
                     'warehouse':self.s['settings']['externalJobs']*self.s['policy']['jobWarehouseExternal']+population*self.s['policy']['jobWarehousePopulation']}
        capacities=Counter()
        for p in employers:
            capacities[p['building']['use']]+=p['building']['capacity']
        for p in employers:
            b=p['building']
            b['positions']=min(b['capacity'],max(1,round(sector_need[b['use']]*b['capacity']/max(1,capacities[b['use']]))))
        for h in self.s['households']:
            job=h.get('job')
            if job in jobs and employed[job]<jobs[job]['building']['positions']:
                employed[job]+=1
            else:
                h['job']=None
        for h in self.s['households']:
            if h['job']:
                continue
            candidates=[]
            for p in employers:
                if employed[p['id']]>=p['building']['positions']:
                    continue
                trip=self.route(h['home'],p['id'],h['car'],h['income'])
                if trip and trip['minutes']<self.s['policy']['workMaximumMinutes']:
                    candidates.append((trip['minutes'],p['id']))
            if candidates:
                h['job']=min(candidates)[1]
                employed[h['job']]+=1
        for p in employers:
            p['building']['employees']=employed[p['id']]
        for firm in self.s['firms']:
            p=self.parcelmap.get(firm['parcel'])
            b=p.get('building') if p else None
            firm['jobs']=b.get('positions',0) if b and firm['status']=='active' else 0
            firm['employees']=b.get('employees',0) if b and firm['status']=='active' else 0

    def assign_traffic(self):
        # Two bounded assignments: first estimates congestion, second reports actual journeys.
        self.route_cache={}
        cohorts=defaultdict(list)
        for h in self.s['households']:
            p=self.parcelmap[h['home']];cell=tuple(int(v//400) for v in p['center'])
            cohorts[(cell,h['home'],h['income'],h['car'])].append(h)
        households=[h for key in sorted(cohorts) for h in cohorts[key]]
        self.s['trafficAggregation']=dict(spatialCells=len({key[0] for key in cohorts}),cohorts=len(cohorts),households=len(households),precision='同楼栋、收入与汽车群组共享最短路；逐户检查容量并保留实际旅程')
        shops=[p for p in self.s['parcels'] if p.get('building') and p['building']['use']=='commercial'
               and p['building']['status']=='active' and p['connected']]
        for iteration in range(self.s['policy']['trafficIterations']):
            self.segment_load=defaultdict(float); self.road_load=defaultdict(float)
            self.paths=[]; trips=[]; boardings=Counter(); stop_board=Counter(); stop_alight=Counter()
            facility_load=Counter()
            facilities={f['id']:f for f in self.s['facilities']}
            freight_km=0.; freight_trips=0
            for line in self.s['lines']:
                if line.get('valid') and line['mode']=='bus':
                    for segment in self.line_segments.values():
                        if segment['key'].startswith(line['id']+':'):
                            for edge in segment['path']:
                                if edge.get('ref'):
                                    for period in ('am','pm'):
                                        self.road_load[(period,edge['ref'])]+=120/line['headway']
            for h in households:
                h['commute']=None; h['commuteFailed']=False
                h['transportCost']=0
                targets=[]
                if h.get('job') in self.parcelmap:
                    targets.extend([(h['home'],h['job'],'work','am',480),(h['job'],h['home'],'work','pm',1080)])
                # A representative household shopping trip; destination uses actual open shops.
                if shops and int(hashlib.sha256(h['id'].encode()).hexdigest()[:4],16)%3==0:
                    # Choose by actual door-to-door travel rather than Euclidean proximity.
                    options=[(self.route(h['home'],p['id'],h['car'],h['income']),p) for p in shops]
                    reachable=[(r['minutes'],p) for r,p in options if r]
                    if reachable:
                        shop=min(reachable,key=lambda pair:(pair[0],pair[1]['id']))[1]
                        targets.extend([(h['home'],shop['id'],'shopping','off',840),(shop['id'],h['home'],'shopping','off',900)])
                # Children and non-commute activities use the same connected network.
                choice_hash=int(hashlib.sha256(h['id'].encode()).hexdigest()[:6],16)
                for kind,purpose,eligible,departure in [('school','school',h['size']>=3,450),
                                                        ('park','leisure',choice_hash%4==0,1140),
                                                        ('plaza','leisure',choice_hash%5==0,1020),
                                                        ('clinic','health',choice_hash%20==0,660),
                                                        ('culture','culture',choice_hash%12==0,1080)]:
                    candidates=[f for f in facilities.values() if (f['kind']==kind or f.get('service')==purpose) and f.get('connected') and facility_load[f['id']]<f['capacity']]
                    if not eligible or not candidates:
                        continue
                    possibilities=[(self.route(h['home'],f['id'],False,h['income'],departure=departure),f) for f in candidates]
                    reachable=[(r['minutes'],f) for r,f in possibilities if r]
                    if reachable:
                        f=min(reachable,key=lambda pair:(pair[0],pair[1]['id']))[1]
                        facility_load[f['id']]+=1
                        targets.extend([(h['home'],f['id'],purpose,'am' if kind=='school' else 'off',departure),
                                        (f['id'],h['home'],purpose,'off',departure+120 if kind!='school' else 960)])
                for source,target,purpose,period,depart in targets:
                    route=self.route(source,target,h['car'],h['income'],True,period,depart)
                    item=dict(source=source,target=target,purpose=purpose,period=period,people=1,completed=route is not None)
                    if route:
                        h['transportCost']+=route['fee']*self.s['policy']['workingDaysPerMonth']
                        item.update({k:v for k,v in route.items() if k!='path'})
                        boards=[e for e in route['path'] if e['kind']=='board']
                        for edge in boards:
                            boardings[edge['ref']]+=1; stop_board[edge['origin']]+=1
                        for edge in route['path']:
                            if edge['kind']=='alight': stop_alight[edge['to']]+=1
                        if purpose=='work' and period=='am': h['commute']=route['minutes']
                        if len(self.paths)<250:
                            sp=self.parcelmap[source]['center'] if source in self.parcelmap else facilities[source]['point']
                            tp=self.parcelmap[target]['center'] if target in self.parcelmap else facilities[target]['point']
                            self.paths.append(dict(source=sp,target=tp,
                                                   mode=route['mode'],purpose=purpose,points=self.path_points(route['path']),minutes=route['minutes']))
                    else:
                        connected=target in self.distances(source,'public')[0] or (h['car'] and target in self.distances(source,'car')[0])
                        item['failureReason']='班次、运力或可接受时间受限' if connected else '起终点无合法网络连接'
                        if purpose=='work': h['commuteFailed']=True
                    trips.append(item)
            regional=assign_regional_passengers(self,trips,boardings,stop_board,stop_alight)
            freight_trips,freight_km,freight_flows=assign_freight(self)
            self.s['regionalFlows']=regional+freight_flows
            changes=[]
            for e in self.network['edges']:
                cfg=ROAD_TYPES[e['kind']]
                load=max(self.road_load[('am',e['id'])],self.road_load[('pm',e['id'])])/2
                e['traffic']=load
                e['ratio']=load/max(1,cfg['capacity']*e.get('terrainCapacity',1)*e.get('signalCapacityFactor',1)) if cfg['capacity'] else 0
                before_time=e['time']
                e['time']=e.get('freeTime',e['length']/1000/cfg['speed']*60)*(1+.6*min(5,e['ratio'])**2)
                changes.append(abs(e['time']-before_time)/max(.001,before_time))
            if iteration<self.s['policy']['trafficIterations']-1:
                self.build_graphs()
        self.s['trafficSolve']=dict(iterations=self.s['policy']['trafficIterations'],maxRelativeChange=max(changes,default=0),converged=max(changes,default=0)<.01,
                                   rule='有界分配；超过 1% 变化时保留最后一轮并标记近似结果')
        self.build_graphs()
        self.trips=trips
        self.s['tripFailures']=dict(Counter(t['failureReason'] for t in trips if not t['completed']))
        self.s['freightTrips']=freight_trips
        self.s['freightKm']=freight_km
        for line in self.s['lines']:
            line['boardings']=boardings[line['id']]
            segments=[(key,seg) for key,seg in self.line_segments.items() if key.startswith(line['id']+':')]
            line['load']=max((max(self.segment_load[(period,key)] for period in ('am','pm','off'))/seg['capacity'] for key,seg in segments),default=0)
            line['passengerKm']=sum(self.segment_load[(period,key)]*seg['length']/1000 for key,seg in segments for period in ('am','pm','off'))
        for stop in self.s['stops']:
            stop['boardings']=stop_board[stop['id']]
            stop['alightings']=stop_alight[stop['id']]
        for f in self.s['facilities']:
            f['visits']=facility_load[f['id']]
        self.live_traffic=None

    def update_market(self):
        update_location_context(self)
        occupied=Counter(h['home'] for h in self.s['households'])
        population=sum(h['size'] for h in self.s['households'])
        employers=[p for p in self.s['parcels'] if p.get('building') and p['building']['status']=='active' and p['building']['use']!='residential' and p['building'].get('businessActive',True)]
        facilities=self.s['facilities']
        homes=Counter(h['home'] for h in self.s['households'])
        scarcity=sum(bool(q.get('building')) for q in self.s['parcels'])/max(1,len(self.s['parcels']))
        fields=opportunity_fields(self,employers,homes,facilities)
        for p in self.s['parcels']:
            field=fields[p['id']]
            jobs=field['jobs30'];public_jobs=field['publicJobs']
            p['accessBudgets']={str(minutes):field['jobs'+str(minutes)] for minutes in (30,45,60)}
            for key in ('vacantJobs','accessWorkers','accessServices','freightTime'):p[key]=field[key]
            p['accessJobs']=jobs;p['publicJobs']=public_jobs
            near_industrial=sum(q['building'].get('floorArea',0)/5000 for q in employers if q['building']['use']=='industrial' and math.dist(q['center'],p['center'])<450)
            noise=sum(r['length']/1000*(1.35 if r['kind']=='motorway' else 1) for r in self.s['roads'] if r['kind'] in ('highway','motorway') and LineString(r['points']).distance(Point(p['center']))<200)
            amenity=field['amenity']
            p['pollution']=min(1,near_industrial*.15); p['noise']=min(1,noise*.3)
            p['amenity']=min(2,amenity)
            near_office=sum(q['building'].get('employees',0)*math.exp(-math.dist(p['center'],q['center'])/self.s['policy']['officeClusterRadius']) for q in employers if q['building']['use']=='office' and math.dist(p['center'],q['center'])<800)
            p['cluster']=min(1,near_office/self.s['policy']['officeClusterWorkers'])
            accessibility=min(1,math.log1p(jobs)/7)
            terrain=p['terrain']
            drivers=dict(base=65,accessibility=accessibility*280,cluster=p['cluster']*180,
                         demand=min(population,10000)*.012,services=amenity*25,
                         landscape=terrain['scenic']*70,terrainCost=-(terrain['costFactor']-1)*85,
                         lowland=-terrain['lowland']*70,pollution=-p['pollution']*70,noise=-noise*20,scarcity=scarcity*45)
            target=sum(drivers.values())
            p['priceDrivers']={k:round(v,2) for k,v in drivers.items()}
            if not p['connected']: target=35
            previous_price=p['landValue']
            limit=p['landValue']*self.s['policy']['priceMonthlyLimit']
            p['landValue']=round(max(15,p['landValue']+max(-limit,min(limit,(target-p['landValue'])*self.s['policy']['priceSmoothing']))),2)
            p['landChange']=round((p['landValue']/max(1,previous_price)-1)*100,2)
            b=p.get('building')
            if b:
                b['occupied']=occupied[p['id']] if b['use']=='residential' else b.get('employees',0)
                vacancy=1-b['occupied']/max(1,b['capacity'])
                base=USES[b['use']]['rent']
                pressure=(self.s['pendingHousing']/30 if b['use']=='residential' else (1-vacancy))
                base*=.85+.0015*b.get('condition',100)
                rent_target=base*(.65+accessibility*.5+p['cluster']*.2+min(1,pressure)*.35-vacancy*.2+terrain['scenic']*.12-terrain['lowland']*.12)
                p['rent']=round(max(2,p['rent']+(rent_target-p['rent'])*self.s['policy']['rentSmoothing']),2)
                b['vacantMonths']=b.get('vacantMonths',0)+1 if b['status'] in ('active','vacant') and b['occupied']==0 else 0
                b['propertyValue']=round(p['rent']*b['floorArea']*12*.75/.06)
                b['status']='vacant' if b.get('vacantMonths',0)>=12 else b['status']
                if b['status']=='vacant' and p['connected'] and self.rng.random()<.15:
                    b['status']='active'
            else:
                p['rent']=round(10*(.7+accessibility*.6),2)
            p.setdefault('history',[]).append(dict(month=self.s['month'],land=p['landValue'],rent=p['rent'],jobs=jobs))
            p['history']=p['history'][-240:]
            p['reason']='道路未接入' if not p['connected'] else '保护用地' if p['use']=='protected' else f"30 分钟内可达 {jobs} 个岗位；坡度 {terrain['slope']*100:.1f}%；工程成本 ×{terrain['costFactor']:.2f}；土地估值 {p['landValue']:.0f} 币/m²"

    def redevelop(self):
        if self.s['settings'].get('autoRenew',True):return
        # Legacy fallback when explicit automatic project assessment is disabled.
        # A vacant building can be replaced without erasing residents or employees.
        for p in self.s['parcels']:
            b=p.get('building')
            if b and not renewal.locked(self,p) and b['status']=='vacant' and b.get('vacantMonths',0)>=self.s['policy']['redevelopVacancyMonths'] and not b.get('occupied'):
                p['building']=None
                self.event('更新',f"{USES[b['use']]['name']}持续空置，进入重新开发")

    def develop(self):
        # Finish already committed additions, keeping existing occupied floors.
        for p in self.s['parcels']:
            b=p.get('building')
            if b and b.get('extensionReady') and self.s['month']>=b['extensionReady']:
                extra=b.pop('extensionFloors',1)
                b['floorArea']=round(b['floorArea']/b['floors']*(b['floors']+extra),1)
                b['floors']+=extra
                b.update(building_style(p,b['use'],b['floors']))
                if b.get('landmark')=='cbd_skyscraper':b['height']=round(b['floors']*3.9,1)
                b['usableArea']=round(b['floorArea']*b['usableRatio'],1)
                b['useAreas']={b['use']:b['floorArea']}
                b['capacity']=max(1,int(b['floorArea']/(self.s['policy']['householdSpace'] if b['use']=='residential' else USES[b['use']]['space'])))
                b.pop('extensionReady',None)
        # Infill and vertical growth compete BEFORE greenfield proposals. Their
        # reserved capacity enters expected supply, so new projects cannot take
        # all demand first or double-book the same future residents/jobs.
        targets=development_targets(self);supply=planned_supply(self)
        if self.s['settings']['growth']>0:
            for p in sorted(self.s['parcels'],key=lambda p:-p.get('businessCore',0)):
                b=p.get('building')
                if renewal.locked(self,p) or not b or b['status']!='active' or b['age']<=36 or b.get('extensionReady') or b['use'] not in ('office','residential','commercial'):continue
                use=b['use'];gap=max(0,targets[use]-supply[use])
                space=self.s['policy']['householdSpace'] if use=='residential' else USES[use]['space']
                floor_capacity=b['footprintArea']/space
                extra=min(2,desired_floors(self,p,use)-b['floors'],int(gap*.6/max(1,floor_capacity)))
                if extra<1 or b.get('occupied',0)/max(1,b['capacity'])<=.7:continue
                b['extensionFloors']=extra;b['extensionReady']=self.s['month']+6
                b['extensionCost']=round(b['footprintArea']*extra*USES[use]['cost']*p['terrain']['costFactor'])
                b['cost']+=b['extensionCost'];supply[use]+=floor_capacity*extra
        select_projects(self,USES,building_style)

    def identify_districts(self):
        clustered_districts(self)

    def finance(self):
        maintenance=sum(r.get('constructionCost',r['length']*ROAD_TYPES[r['kind']]['cost'])*.0006 for r in self.s['roads'])
        station_maintenance=sum(s.get('constructionCost',25000 if s['mode']=='bus' else 500000)*.004 for s in self.s['stops'])
        operation=sum(l.get('operatingCost',0) for l in self.s['lines']+self.s['regionalServices'])
        fare=sum(t.get('fee',0) for t in getattr(self,'trips',[]) if t.get('mode')=='public')*self.s['policy']['workingDaysPerMonth']
        tax=sum(h['income'] for h in self.s['households'])*self.s['settings']['taxRate']
        facility_maintenance=sum(f.get('maintenance',12000) for f in self.s['facilities'])
        self.s['maintenance']=round(maintenance+station_maintenance+operation+facility_maintenance)
        self.s['operatingAccounts']=dict(roadMaintenance=round(maintenance),stationMaintenance=round(station_maintenance),facilityMaintenance=round(facility_maintenance),vehicleLease=round(sum(l.get('fleet',0)*TRANSIT_TYPES[l['mode']]['vehicleCost'] for l in self.s['lines'])),transitOperation=round(operation),tax=round(tax),fares=round(fare))
        self.s['revenue']=round(fare+tax)
        self.s['treasury']+=self.s['revenue']-self.s['maintenance']

    def summarize(self):
        pop=sum(h['size'] for h in self.s['households'])
        buildings=[p for p in self.s['parcels'] if p.get('building')]
        ready=[p for p in buildings if p['building']['status']!='construction']
        units=sum(p['building']['capacity'] for p in ready if p['building']['use']=='residential')
        positions=sum(p['building'].get('positions',0) for p in ready if p['building']['use']!='residential')
        employed=sum(bool(h.get('job')) for h in self.s['households'])
        trips=getattr(self,'trips',[])
        completed=[t for t in trips if t['completed']]
        commutes=[t['minutes'] for t in completed if t['purpose']=='work']
        modes=Counter(t['mode'] for t in completed)
        values=[p['landValue'] for p in self.s['parcels']]
        rents=[p['rent'] for p in ready if p['building']['use']=='residential']
        avg=lambda v:sum(v)/len(v) if v else None
        self.s['stats']=dict(month=self.s['month'],population=pop,households=len(self.s['households']),
            jobs=positions,employed=employed,unemployment=(1-employed/len(self.s['households']))*100 if self.s['households'] else None,
            housing=units,vacancy=(1-len(self.s['households'])/units)*100 if units else None,
            buildings=len(buildings),construction=sum(p['building']['status']=='construction' for p in buildings),
            roadKm=sum(r['length'] for r in self.s['roads'] if group(r)=='road')/1000,
            railKm=sum(r['length'] for r in self.s['roads'] if group(r)!='road')/1000,
            landValue=float(np.median(values)) if values else None,rent=float(np.median(rents)) if rents else None,
            trips=len(trips),completedTrips=len(completed),failedTrips=len(trips)-len(completed),
            commute=avg(commutes),commuteP90=float(np.percentile(commutes,90)) if commutes else None,
            modeShare={k:modes[k]/len(completed)*100 if completed else 0 for k in ('walk','car','public')},
            boardings=sum(l.get('boardings',0) for l in self.s['lines']),
            accessJobs=avg([self.parcelmap[h['home']].get('accessJobs' if h['car'] else 'publicJobs',0) for h in self.s['households']]),
            publicJobs=avg([self.parcelmap[h['home']].get('publicJobs',0) for h in self.s['households']]),
            burden=avg([h.get('burden',0)*100 for h in self.s['households']]),
            combinedBurden=avg([(self.parcelmap[h['home']]['rent']*self.s['policy']['householdSpace']+h.get('transportCost',0))/h['income']*100 for h in self.s['households']]),
            congestion=max((e['ratio'] for e in self.network['edges']),default=0),
            treasury=round(self.s['treasury']),maintenance=self.s['maintenance'],revenue=self.s['revenue'],
            movedIn=self.s['movedIn'],movedOut=self.s['movedOut'],relocated=self.s['relocated'],
            pendingHousing=self.s['pendingHousing'],
            developedArea=sum(p['area'] for p in ready),floorArea=sum(p['building']['floorArea'] for p in ready),
            estimatedCO2=round(sum(t.get('distance',0)/1000*self.s['policy']['carCO2KgPerKm'] for t in completed if t['mode']=='car'),2),
            freightTrips=self.s.get('freightTrips',0),freightKm=self.s.get('freightKm',0),
            uses={use:sum(p['building']['floorArea'] for p in ready if p['building']['use']==use) for use in USES})
        self.s['stats']['density']=pop/(self.terrain.width*self.terrain.height/1e6)
        self.s['stats'].update(detailed_metrics(self))
        self.s['stats'].update(renewalProjects=sum(p['status'] not in renewal.TERMINAL for p in self.s['renewals']),
            renewalCompleted=sum(p['status']=='complete' for p in self.s['renewals']),
            renewalSpending=sum(p['spent'] for p in self.s['renewals']),
            renewalRelocated=sum(p['relocated'] for p in self.s['renewals']),
            renewalMovedOut=sum(p['movedOut'] for p in self.s['renewals']))
        self.s['accessibilityGroups']=accessibility_by_group(self)

    def view(self):
        # Household details remain authoritative server state; maps receive aggregates.
        residents=Counter()
        for h in self.s['households']:
            residents[h['home']]+=h['size']
        parcels=copy.deepcopy(self.s['parcels'])
        for p in parcels:
            p['population']=residents[p['id']]
            b=p.get('building')
            if b and 'footprintArea' not in b:
                b['footprintArea']=round(Polygon(b['footprint']).area,1)
        state={k:v for k,v in self.s.items() if k not in ('households','commands')}
        state['parcels']=parcels
        migration=Counter()
        for flow in self.s['migrationFlows']:
            migration[(tuple(flow['source']),tuple(flow['target']),flow['kind'])]+=flow['people']
        state['migrationFlows']=[dict(source=list(a),target=list(b),kind=kind,people=count) for (a,b,kind),count in migration.items()]
        return copy.deepcopy(dict(**state,network=self.network,flows=self.paths,
                                  liveTraffic=self.live_traffic.view() if self.live_traffic else None,
                                  aggregateFlows=aggregate_flows(self),canUndo=bool(self.undo),
                                  canRedo=bool(self.redo),householdSample=self.s['households'][:100],
                                  meta=dict(model=MODEL_VERSION,width=self.terrain.width,height=self.terrain.height,
                                            uses=USES,roadTypes=ROAD_TYPES,transitTypes=TRANSIT_TYPES,specialBuildings=special_buildings.CATALOG,
                                            policy=self.s['policy'],parameters=parameter_definitions(self.s['policy']),metrics=metric_definitions(self.s['stats'],MODEL_VERSION),trafficPeriod='典型工作日 · 早晚高峰各 2 小时，平峰活动抽样')))

    def inspect(self, object_id):
        p=self.parcelmap.get(object_id)
        if p:
            residents=[h for h in self.s['households'] if h['home']==object_id]
            return dict(type='parcel',object=p,residents=residents[:40],population=sum(h['size'] for h in residents))
        for key in ('roads','stops','lines','facilities','districts'):
            obj=next((o for o in self.s[key] if o['id']==object_id),None)
            if obj:
                return dict(type=key,object=obj)
        raise ValueError('对象不存在')
