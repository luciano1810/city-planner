"""Protected signal stages, routing delays and deterministic live road traffic."""
import copy
import math
from collections import defaultdict

from shapely.geometry import LineString

from .parameters import ROAD_TYPES, DRIVABLE_ROADS
from .routing import shortest_paths, reconstruct

LANES = dict(lane=2, street=2, avenue=4, highway=4, motorway=6)
TIMING_LIMITS = dict(signalGreenSeconds=(5,90),signalYellowSeconds=(2,6),signalClearanceSeconds=(2,15))


def approach_key(arm):
    return f"{arm['road']}:{arm['direction']}"


def clearance(arm, approaches):
    distance = arm['width']/2+2
    for other in approaches:
        if other is arm:
            continue
        ax, ay = arm['tangent']; bx, by = other['tangent']
        cross = abs(ax*by-ay*bx)
        if cross > .05:
            distance = max(distance, (other['width']/2+arm['width']/2*abs(ax*bx+ay*by))/cross+2)
    return distance


def configure(network, policy):
    for key,(low,high) in TIMING_LIMITS.items():
        if type(policy[key]) is not int or not low<=policy[key]<=high:
            raise ValueError('信号配时超出范围：'+key)
    delays = {}
    for junction in network.get('junctions', []):
        if junction['control'] != 'signals':
            continue
        arms = sorted((a for a in junction['approaches'] if a['incoming'] and a['kind'] in DRIVABLE_ROADS),
                      key=lambda a: math.atan2(a['tangent'][1], a['tangent'][0]))
        # One protected incoming arm at a time: opposing left turns never get
        # simultaneous green. Pedestrians have an exclusive vehicle-red stage.
        stages = [dict(approach=approach_key(a), green=policy['signalGreenSeconds'],
                       yellow=policy['signalYellowSeconds'], clearance=policy['signalClearanceSeconds']) for a in arms]
        pedestrian = math.ceil(max((a['width'] for a in arms), default=14)/1.2)+2
        cycle = sum(s['green']+s['yellow']+s['clearance'] for s in stages)+pedestrian+3
        junction['signal'] = dict(stages=stages, pedestrian=pedestrian, cycle=cycle)
        junction['signal']['initial'] = phase(junction,0)
        for arm in arms:
            green = policy['signalGreenSeconds']
            delays[(junction['id'], arm['road'], arm['direction'])] = ((cycle-green)**2/(2*cycle)/60, green/cycle)
            arm['stopDistance'] = clearance(arm, junction['approaches'])+7
    for edge in network['edges']:
        forward = delays.get((edge['b'], edge['road'], -1), (0, 1))
        reverse = delays.get((edge['a'], edge['road'], 1), (0, 1))
        edge.update(signalDelayForward=forward[0], signalDelayReverse=reverse[0],
                    signalCapacityFactor=min(forward[1], reverse[1]))


def phase(junction, seconds):
    timing = junction['signal']; t = round(seconds % timing['cycle'],9)
    lamps = {stage['approach']: 'red' for stage in timing['stages']}
    for index, stage in enumerate(timing['stages']):
        for color, duration in (('green', stage['green']), ('yellow', stage['yellow']), ('clearance', stage['clearance'])):
            if t < duration:
                if color != 'clearance':
                    lamps[stage['approach']] = color
                return dict(id=junction['id'], lamps=lamps, phase=color, stage=index,
                            remaining=round(duration-t, 1), pedestrian='red', point=junction['point'])
            t -= duration
    walking = t < timing['pedestrian']
    return dict(id=junction['id'], lamps=lamps, phase='pedestrian' if walking else 'clearance',
                stage=len(timing['stages']), remaining=round((timing['pedestrian'] if walking else timing['pedestrian']+3)-t, 1),
                pedestrian='green' if walking else 'red', point=junction['point'])


class LiveTraffic:
    """Subsecond car following on real directed road links, with signal gates.

    Test demand is explicit. Observed demand uses the monthly assignment's
    road volumes; neither mode creates residents or changes monthly accounts.
    """
    def __init__(self, city, mode='observed'):
        if mode not in ('observed', 'test'):
            raise ValueError('未知车流来源')
        self.city, self.mode, self.clock, self.serial = city, mode, 0., 0
        self.cars, self.events, self.owners = [], [], {}
        self.completed, self.total_wait = 0, 0.
        self.junctions = {j['id']: j for j in city.network['junctions'] if j.get('signal')}
        self.arms = {(j['id'], a['road'], -a['direction']): a for j in self.junctions.values()
                     for a in j['approaches'] if a['incoming'] and a['kind'] in DRIVABLE_ROADS}
        self.links, self.graph = {}, defaultdict(list)
        incidence = defaultdict(list); by_road = defaultdict(list)
        for edge in city.network['edges']:
            if edge['kind'] in DRIVABLE_ROADS:
                by_road[edge['road']].append(edge)
                incidence[edge['a']].append(edge); incidence[edge['b']].append(edge)
        breaks = {node for node, edges in incidence.items() if len(edges) != 2 or len({e['road'] for e in edges}) != 1}
        for rid, edges in by_road.items():
            chain = []
            for index, edge in enumerate(edges):
                chain.append(edge)
                if edge['b'] in breaks or index == len(edges)-1:
                    points = [chain[0]['points'][0]]+[p for e in chain for p in e['points'][1:]]
                    for direction in ([1] if edge['oneway'] else [1, -1]):
                        key = f'{rid}:{index}:{direction}'
                        coords = points if direction == 1 else points[::-1]
                        shape = LineString(coords)
                        a, b = (chain[0]['a'], chain[-1]['b']) if direction == 1 else (chain[-1]['b'], chain[0]['a'])
                        speed = min(ROAD_TYPES[edge['kind']]['speed']/3.6, 12.)
                        self.links[key] = dict(id=key, road=rid, kind=edge['kind'], level=edge['level'],
                                               a=a, b=b, direction=direction, shape=shape, length=shape.length,
                                               speed=speed, oneway=edge['oneway'], volume=max(e['traffic'] for e in chain))
                        self.graph[a].append(dict(to=b, time=shape.length/speed/60, ref=key))
                    chain = []
        terminals = {node for node, edges in incidence.items() if len(edges) == 1}
        self.sources, self.destinations, self.balances = [], {}, {}
        for link in self.links.values():
            if mode == 'test' and link['a'] not in terminals:
                continue
            volume = 360 if mode == 'test' else link['volume']
            if volume <= 0:
                continue
            distances, prev = shortest_paths(self.graph, link['b'])
            choices = sorted(n for n in (terminals or set(self.graph)) if n not in (link['a'], link['b']) and n in distances)
            routes = [[link['id']]+[e['ref'] for e in reconstruct(prev, link['b'], target)] for target in choices]
            routes = [r for r in routes if len(r)>1 and self.links[r[1]]['road'] != link['road']]
            if routes:
                self.sources.append((link['id'], min(900, volume)))
                self.destinations[link['id']] = routes
                self.balances[link['id']] = 0.
        if mode == 'test':
            for key, _ in self.sources:
                for index in range(4):
                    self.spawn(key, max(0, self.links[key]['length']-60-index*12))
        from .pedestrians import Walkers
        self.walkers = Walkers(city, mode)

    def lane(self, car):
        link = self.links[car['route'][car['segment']]]
        count = LANES[link['kind']] if link['oneway'] else LANES[link['kind']]//2
        if car['segment']+1 < len(car['route']):
            target = self.links[car['route'][car['segment']+1]]
            a = link['shape'].interpolate(max(0, link['length']-2)); b = link['shape'].interpolate(link['length'])
            c = target['shape'].interpolate(min(2, target['length']))
            cross = (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x)
            if cross > .1:
                return count-1
        return 0

    def spawn(self, key, position=0):
        if len(self.cars) >= 400:
            return
        routes = self.destinations[key]
        link=self.links[key];arm=self.arms.get((link['b'],link['road'],link['direction']))
        if arm:position=min(position,max(0,link['length']-arm['stopDistance']-1))
        car = dict(id=self.serial, route=routes[self.serial % len(routes)], segment=0, position=position,
                   speed=0., waiting=0., reason='', reservation=None)
        lane = self.lane(car)
        if any(c['route'][c['segment']]==key and self.lane(c)==lane and abs(c['position']-position)<8 for c in self.cars):
            return
        self.serial += 1
        self.cars.append(car)

    @staticmethod
    def _held(car):
        return ([car['reservation']] if car.get('reservation') else [])+car.get('trailingReservations',[])

    def _release(self, car, reservation=None):
        for held in [reservation] if reservation else self._held(car):
            owner = self.owners.get(held['junction'])
            if owner:
                owner['cars'].discard(car['id'])
                if not owner['cars']:
                    self.owners.pop(held['junction'])
            self.completed += 1
            if car.get('reservation')==held:
                car['reservation'] = None
            else:
                car['trailingReservations'].remove(held)

    def advance(self, seconds):
        if isinstance(seconds, bool) or not isinstance(seconds, (int,float)) or not math.isfinite(seconds) or not 0 <= seconds <= 10:
            raise ValueError('实景推进时间须为 0–10 秒')
        remaining = float(seconds)
        while remaining > 1e-9:
            dt = min(.1, remaining); remaining -= dt; self.clock += dt
            lamps = {key:phase(junction, self.clock) for key,junction in self.junctions.items()}
            walking = {self.walkers.links[p['edge']]['junction'] for p in self.walkers.people
                       if self.walkers.links[p['edge']]['kind']=='crossing'}
            for key, volume in self.sources:
                self.balances[key] += dt*volume/3600
                if self.balances[key] >= 1:
                    self.spawn(key); self.balances[key] -= 1
            done = []
            groups = defaultdict(list)
            for car in self.cars:
                groups[(car['route'][car['segment']], self.lane(car))].append(car)
            for (key, _), cars in groups.items():
                link = self.links[key]; leader = math.inf
                for car in sorted(cars, key=lambda c:c['position'], reverse=True):
                    limit = min(link['length']+.001, leader-7)
                    reason = 'queue' if limit < link['length'] else ''
                    arm = self.arms.get((link['b'], link['road'], link['direction']))
                    reserved = any(h['junction']==link['b'] for h in self._held(car))
                    enter_allowed = False
                    if arm and not reserved:
                        stop = max(0, link['length']-arm['stopDistance'])
                        owner = self.owners.get(link['b'])
                        allowed = lamps[link['b']]['lamps'][approach_key(arm)] == 'green'
                        blocked = link['b'] in walking or owner is not None and owner['approach'] != approach_key(arm)
                        enter_allowed = allowed and not blocked
                        if not allowed or blocked:
                            if stop < limit:
                                limit, reason = stop, 'red' if not allowed else 'clearance'
                    speed = min(link['speed'], car['speed']+2.5*dt)
                    position = min(car['position']+speed*dt, max(car['position'], limit))
                    if arm and not reserved and enter_allowed and position > max(0,link['length']-arm['stopDistance'])+1e-6:
                        owner = self.owners.setdefault(link['b'], dict(approach=approach_key(arm), cars=set()))
                        owner['cars'].add(car['id'])
                        # A short link can lie in two junction clearance areas.
                        # Keep the upstream reservation while checking the next
                        # signal independently; never let it bypass a red light.
                        if car.get('reservation'):
                            car.setdefault('trailingReservations',[]).append(car['reservation'])
                        car['reservation'] = dict(junction=link['b'], entrySegment=car['segment'],
                                                  release=arm['stopDistance'])
                        self.events.append(dict(time=round(self.clock,3), junction=link['b'], approach=approach_key(arm),
                                                car=car['id'], color=lamps[link['b']]['lamps'][approach_key(arm)]))
                        self.events = self.events[-1000:]
                    car['speed'] = max(0, (position-car['position'])/dt)
                    car['position'] = position; car['reason'] = reason if car['speed'] < .2 else ''
                    if car['reason']:
                        car['waiting'] += dt; self.total_wait += dt
                    leader = position
                    for held in self._held(car):
                        if car['segment'] > held['entrySegment']:
                            travelled=position+sum(self.links[car['route'][s]]['length']
                                for s in range(held['entrySegment']+1,car['segment']))
                            if travelled>=held['release']+5:
                                self._release(car,held)
                    if position >= link['length']:
                        if car['segment']+1 == len(car['route']):
                            self._release(car); done.append(car); continue
                        next_key = car['route'][car['segment']+1]
                        # Do not enter an occupied downstream link.
                        if any(c is not car and c['route'][c['segment']]==next_key and c['position']<8 for c in self.cars):
                            car['position']=link['length']-.01;car['speed']=0;car['reason']='queue'
                        else:
                            car['segment'] += 1; car['position'] = max(0,position-link['length'])
            for car in done:
                self.cars.remove(car)
            self.walkers.advance(dt, self.clock, lamps, self.owners)
        return self.view()

    def view(self):
        cars = []
        for car in self.cars:
            link = self.links[car['route'][car['segment']]]; shape=link['shape']; d=car['position']
            point=shape.interpolate(d);a=shape.interpolate(max(0,d-.5));b=shape.interpolate(min(link['length'],d+.5))
            angle=math.atan2(b.y-a.y,b.x-a.x);width=ROAD_TYPES[link['kind']]['width'];lane_width=width/LANES[link['kind']]
            offset=(-width/2 if link['oneway'] else 0)+(self.lane(car)+.5)*lane_width
            cars.append(dict(id=car['id'],point=[point.x-math.sin(angle)*offset,point.y+math.cos(angle)*offset],
                             heading=angle,speed=round(car['speed'],2),waiting=round(car['waiting'],1),
                             state=car['reason'] or 'moving',road=link['road'],level=link['level']))
        return dict(seconds=round(self.clock,3),sceneTimeSeconds=self.city.s.get('sceneTimeSeconds',9*3600.),mode=self.mode,vehicles=cars,
                    signals=[phase(j,self.clock) for j in self.junctions.values()],
                    waiting=sum(c['speed']<.2 and bool(c['reason']) for c in self.cars),
                    passed=self.completed,totalWait=round(self.total_wait,2),events=self.events[-100:],
                    pedestrians=self.walkers.view(),pedestrianWaiting=sum(p['state']=='waiting' for p in self.walkers.people),
                    pedestrianPassed=self.walkers.completed,pedestrianEvents=self.walkers.events[-100:])

    def snapshot(self):
        return copy.deepcopy(dict(seconds=self.clock,mode=self.mode,serial=self.serial,cars=self.cars,
                                  balances=self.balances,completed=self.completed,totalWait=self.total_wait,events=self.events,
                                  pedestrians=self.walkers.snapshot()))

    def restore(self, data):
        def finite(value, low, high):
            return not isinstance(value,bool) and isinstance(value,(int,float)) and math.isfinite(value) and low<=value<=high
        if not isinstance(data,dict) or not finite(data.get('seconds'),0,1e12) or not isinstance(data.get('cars'),list) or len(data['cars'])>400:
            raise ValueError('无效的路口实景存档')
        if type(data.get('serial')) is not int or not 0<=data['serial']<=1e12 or type(data.get('completed')) is not int or not 0<=data['completed']<=1e12 or not finite(data.get('totalWait'),0,1e15):
            raise ValueError('无效的实景计数')
        if not isinstance(data.get('balances'),dict) or any(not finite(value,0,1) for value in data['balances'].values()):
            raise ValueError('无效的实景车流状态')
        cars=copy.deepcopy(data['cars']);ids=set()
        for car in cars:
            route=car.get('route');segment=car.get('segment')
            if not isinstance(route,list) or not route or any(key not in self.links for key in route) or not isinstance(segment,int) or not 0<=segment<len(route):
                raise ValueError('实景车辆路线无效')
            if car['id'] in ids or not isinstance(car['id'],int) or not finite(car['position'],0,self.links[route[segment]]['length']+.01) or not finite(car['speed'],0,100) or not finite(car['waiting'],0,1e12):
                raise ValueError('实景车辆状态无效')
            ids.add(car['id'])
            for a,b in zip(route,route[1:]):
                if self.links[a]['b']!=self.links[b]['a']:
                    raise ValueError('实景车辆路线断连')
        self.clock=data['seconds'];self.cars=cars;self.serial=max(data.get('serial',0),max(ids,default=-1)+1)
        self.completed=data.get('completed',0);self.total_wait=data.get('totalWait',0);self.events=copy.deepcopy(data.get('events',[]))[-1000:]
        self.balances={key:float(data.get('balances',{}).get(key,0))%1 for key in self.balances};self.owners={}
        for car in self.cars:
            if not isinstance(car.get('trailingReservations',[]),list) or len(car.get('trailingReservations',[]))>len(car['route']):
                raise ValueError('无效的连续路口占用状态')
            for held in self._held(car):
                if not isinstance(held,dict):
                    raise ValueError('无效的实景路口占用状态')
                if held['junction'] not in self.junctions or not finite(held.get('release'),0,10000) or not isinstance(held.get('entrySegment'),int) or not 0<=held['entrySegment']<=car['segment']:
                    raise ValueError('实景路口占用状态无效')
                entry=self.links[car['route'][held['entrySegment']]]
                arm=self.arms.get((entry['b'],entry['road'],entry['direction']))
                if not arm or entry['b']!=held['junction']:
                    raise ValueError('实景路口入口无效')
                owner=self.owners.setdefault(held['junction'],dict(approach=approach_key(arm),cars=set()))
                if owner['approach']!=approach_key(arm):
                    raise ValueError('实景路口存在冲突占用')
                owner['cars'].add(car['id'])
        if 'pedestrians' in data:
            self.walkers.restore(data['pedestrians'])
