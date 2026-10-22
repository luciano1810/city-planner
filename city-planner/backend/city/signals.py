"""Protected signal stages, routing delays and deterministic live road traffic."""
import copy
import math
from collections import defaultdict

from shapely.geometry import LineString

from .parameters import ROAD_TYPES, DRIVABLE_ROADS
from .vehicle_paths import FRONT_CLEARANCE, FOLLOW_GAP, RoutePath
from .vehicle_trips import build_demand

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
        self.arrived, self.motion_time = 0, 0.
        self.signal_clock = 0.
        self._paths, self._traces, self._departed = {}, {}, []
        self.all_junctions = {j['id']: j for j in city.network['junctions']}
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
                                               speed=speed, oneway=edge['oneway'], volume=max(e['traffic'] for e in chain),
                                               edges=[e['id'] for e in chain])
                        self.graph[a].append(dict(to=b, time=shape.length/speed/60, ref=key))
                    chain = []
        terminals = {node for node, edges in incidence.items() if len(edges) == 1}
        self.terminals = terminals
        build_demand(self, terminals)
        if mode == 'test':
            for key, _ in self.sources:
                for index in range(4):
                    self.spawn(key, max(0, self.links[key]['length']-60-index*12))
        elif self.sources:
            # Warm the representative sample at actual journey origins.
            count = min(80, max(1, math.ceil(sum(rate for _,rate in self.sources)/60)))
            for key,_ in self.sources[:count]:
                self.spawn(key)
        from .pedestrians import Walkers
        self.walkers = Walkers(city, mode)

    def lane(self, car):
        return self.path(car).lanes[car['segment']]

    def path(self, car):
        key = tuple(car['route'])
        if key not in self._paths:
            self._paths[key] = RoutePath(self.links, key, self.all_junctions)
        return self._paths[key]

    def stop_position(self, link, arm):
        return max(0., link['length']-arm['stopDistance']-FRONT_CLEARANCE)

    def spawn(self, key, position=None):
        if len(self.cars) >= 400:
            return
        plans = self.journeys[key]; plan = plans[self.serial % len(plans)]
        route = plan['route']; link = self.links[route[0]]
        position = plan['start'] if position is None else position
        arm=self.arms.get((link['b'],link['road'],link['direction']))
        if arm and position > self.stop_position(link, arm):
            return  # An access inside a junction cannot inject a car past red.
        car = dict(id=self.serial, route=route, segment=0, position=position,
                   speed=0., waiting=0., reason='', reservation=None, source=plan['source'],
                   target=plan['target'], start=plan['start'], end=plan['end'], born=self.motion_time,
                   kind=plan.get('kind','car'), taxiState=plan.get('taxiState',''))
        lane = self.lane(car)
        if any(c['route'][c['segment']]==route[0] and self.lane(c)==lane and abs(c['position']-position)<FOLLOW_GAP for c in self.cars):
            return
        self.serial += 1
        self.cars.append(car)
        self.record(car)

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

    def vehicle(self, car):
        link = self.links[car['route'][car['segment']]]
        path = self.path(car)
        distance = path.starts[car['segment']]+car['position']
        point, heading, _ = path.sample(distance)
        start = car.get('start', 0.)
        end = path.starts[-2]+car.get('end', self.links[car['route'][-1]]['length'])
        return dict(id=car['id'], point=point, heading=heading, speed=round(car['speed'],3),
                    kind=car.get('kind','car'), taxiState=car.get('taxiState',''),
                    waiting=round(car['waiting'],1), state=car['reason'] or 'moving',
                    road=link['road'], level=link['level'], source=car.get('source',self.links[car['route'][0]]['a']),
                    target=car.get('target',self.links[car['route'][-1]]['b']),
                    progress=max(0.,min(1.,(distance-start)/max(1.,end-start))))

    def record(self, car):
        v = self.vehicle(car)
        # All poses use the same path, including intermediate points inside a
        # junction and the final arrival. Clients never join two road endpoints
        # with a straight chord, predict through a red, or lose a removed car.
        sample = [round(self.motion_time,5), *v['point'], v['heading'], v['speed'],
                  v['road'], v['level'], v['state'], v['progress']]
        trace = self._traces.setdefault(car['id'], [])
        if trace and trace[-1][0] == sample[0]:
            trace[-1] = sample
        else:
            trace.append(sample)

    def advance(self, seconds):
        if isinstance(seconds, bool) or not isinstance(seconds, (int,float)) or not math.isfinite(seconds) or not 0 <= seconds <= 10:
            raise ValueError('实景推进时间须为 0–10 秒')
        self._traces, self._departed = {}, []
        self.motion_start = self.motion_time
        self._signal_frames = [[round(self.motion_time,5), [phase(j,self.signal_clock) for j in self.junctions.values()]]]
        for car in self.cars:
            self.record(car)
        remaining = float(seconds)
        while remaining > 1e-9:
            dt = min(.05, remaining); remaining -= dt
            self.clock += dt; self.motion_time += dt; self.signal_clock += dt
            lamps = {key:phase(junction, self.signal_clock) for key,junction in self.junctions.items()}
            states = list(lamps.values())
            if [(s['stage'],s['phase']) for s in states] != [(s['stage'],s['phase']) for s in self._signal_frames[-1][1]]:
                self._signal_frames.append([round(self.motion_time,5),states])
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
            # Snapshot occupancy makes update order independent across links.
            occupancy = {key:sorted(c['position'] for c in cars) for key,cars in groups.items()}
            for (key, lane), cars in groups.items():
                link = self.links[key]; leader = math.inf
                for car in sorted(cars, key=lambda c:c['position'], reverse=True):
                    path = self.path(car); segment = car['segment']
                    last = segment+1 == len(car['route'])
                    end = car.get('end',link['length']) if last else math.inf
                    gap_position = leader-FOLLOW_GAP
                    if math.isfinite(leader):
                        gap_position = min(gap_position,path.retreat(path.starts[segment]+leader,FOLLOW_GAP)-path.starts[segment])
                    limit = min(end, gap_position)
                    reason = 'queue' if limit < end else 'arrival' if last else ''
                    if not last:
                        next_key = car['route'][segment+1]
                        next_lane = path.lanes[segment+1]
                        downstream = occupancy.get((next_key,next_lane), [])
                        if downstream:
                            distance = path.starts[segment+1]+downstream[0]
                            rear = min(link['length']+downstream[0]-FOLLOW_GAP,
                                       path.retreat(distance,FOLLOW_GAP)-path.starts[segment])
                            if rear < limit:
                                limit, reason = rear, 'queue'
                    arm = self.arms.get((link['b'], link['road'], link['direction']))
                    reserved = any(h['junction']==link['b'] for h in self._held(car))
                    enter_allowed = False
                    stop = self.stop_position(link,arm) if arm else math.inf
                    if arm and not reserved:
                        owner = self.owners.get(link['b'])
                        allowed = lamps[link['b']]['lamps'][approach_key(arm)] == 'green'
                        if allowed:
                            travel = max(0.,stop-car['position'])
                            arrival = (math.sqrt(car['speed']**2+5*travel)-car['speed'])/2.5
                            allowed = arrival < lamps[link['b']]['remaining']-.1
                        blocked = link['b'] in walking or owner is not None and owner['approach'] != approach_key(arm)
                        # Do not block the box if the departure lane cannot hold
                        # a complete vehicle beyond its crossing.
                        if not last and downstream:
                            target_link = self.links[next_key]
                            exit_room = min(target_link['length']*.42, arm['stopDistance'])+FOLLOW_GAP
                            blocked = blocked or downstream[0] < exit_room
                        enter_allowed = allowed and not blocked
                        if not enter_allowed and stop < limit:
                            limit, reason = stop, 'red' if not allowed else 'clearance'
                    absolute = path.starts[segment]+car['position']
                    _, _, ratio = path.sample(absolute)
                    cruise = path.speed_limit(absolute, link['speed'])
                    gap = max(0.,limit-car['position'])*ratio
                    # A bounded braking envelope avoids both full-speed stops
                    # and the asymptotic creep of a proportional controller.
                    brake = 3.5
                    safe = max(0., math.sqrt((brake*dt)**2+2*brake*gap)-brake*dt)
                    desired = min(cruise, safe)
                    speed = min(desired,car['speed']+2.5*dt)
                    position = car['position']+min(speed*dt/ratio,max(0.,limit-car['position']))
                    if arm and not reserved and enter_allowed and position > stop+1e-6:
                        owner = self.owners.setdefault(link['b'], dict(approach=approach_key(arm), cars=set()))
                        owner['cars'].add(car['id'])
                        if car.get('reservation'):
                            car.setdefault('trailingReservations',[]).append(car['reservation'])
                        car['reservation'] = dict(junction=link['b'],entrySegment=segment,release=arm['stopDistance'])
                        self.events.append(dict(time=round(self.signal_clock,3),junction=link['b'],approach=approach_key(arm),
                                                car=car['id'],color=lamps[link['b']]['lamps'][approach_key(arm)]))
                        self.events = self.events[-1000:]
                    car['speed'] = max(0.,(position-car['position'])*ratio/dt)
                    car['position'] = position; car['reason'] = reason if car['speed'] < .2 else ''
                    if car['reason'] and car['reason'] != 'arrival':
                        car['waiting'] += dt; self.total_wait += dt
                    leader = position
                    for held in list(self._held(car)):
                        if segment > held['entrySegment']:
                            travelled=position+sum(self.links[car['route'][i]]['length'] for i in range(held['entrySegment']+1,segment))
                            if travelled >= held['release']+FRONT_CLEARANCE:
                                self._release(car,held)
                    if last and position >= end-.02:
                        car['position']=end; car['speed']=0.; car['reason']='arrived'
                        car['parked'] = car.get('parked',0.)+dt
                        self.record(car)
                        if car['parked'] >= 1.2:
                            self._departed.append(self.vehicle(car))
                            self.arrived += 1; self._release(car); done.append(car)
                        continue
                    if position >= link['length'] and not last:
                        # Carry the exact residual distance through the join.
                        car['segment'] += 1; car['position'] = position-link['length']
                    self.record(car)
            for car in done:
                self.cars.remove(car)
            self.walkers.advance(dt, self.signal_clock, lamps, self.owners)
        return self.view()

    def view(self):
        cars = [self.vehicle(car) for car in self.cars]
        return dict(seconds=round(self.clock,3),sceneTimeSeconds=self.city.s.get('sceneTimeSeconds',9*3600.),mode=self.mode,vehicles=cars,
                    motionTime=round(self.motion_time,5),signalSeconds=round(self.signal_clock,5),arrived=self.arrived,
                    signals=[phase(j,self.signal_clock) for j in self.junctions.values()],
                    waiting=sum(c['speed']<.2 and bool(c['reason']) for c in self.cars),
                    passed=self.completed,totalWait=round(self.total_wait,2),events=self.events[-100:],
                    pedestrians=self.walkers.view(),pedestrianWaiting=sum(p['state']=='waiting' for p in self.walkers.people),
                    pedestrianPassed=self.walkers.completed,pedestrianEvents=self.walkers.events[-100:])

    def animation(self):
        return dict(start=round(getattr(self,'motion_start',self.motion_time),5),end=round(self.motion_time,5),
                    tracks={str(key):points for key,points in self._traces.items()},departed=self._departed,
                    signals=getattr(self,'_signal_frames',[])+[[round(self.motion_time,5),self.view()['signals']]])

    def snapshot(self):
        return copy.deepcopy(dict(seconds=self.clock,mode=self.mode,serial=self.serial,cars=self.cars,
                                  balances=self.balances,completed=self.completed,totalWait=self.total_wait,events=self.events,
                                  pedestrians=self.walkers.snapshot(), motionTime=self.motion_time, signalSeconds=self.signal_clock, arrived=self.arrived))

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
        self.clock=data['seconds'];self.motion_time=data.get('motionTime',self.clock);self.arrived=data.get('arrived',0);self.cars=cars;self.serial=max(data.get('serial',0),max(ids,default=-1)+1)
        self.signal_clock=data.get('signalSeconds',self.clock)
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
        if not finite(self.motion_time,0,1e12) or not finite(self.signal_clock,0,1e12) or type(self.arrived) is not int or self.arrived < 0:
            raise ValueError('无效的车辆旅程时钟')
        for car in self.cars:
            if not finite(car.get('start',0),0,self.links[car['route'][0]]['length']) or not finite(car.get('end',self.links[car['route'][-1]]['length']),0,self.links[car['route'][-1]]['length']):
                raise ValueError('无效的车辆出行端点')
            if not finite(car.get('parked',0),0,10) or not finite(car.get('born',0),0,1e12):
                raise ValueError('无效的车辆停车状态')
            if len(car['route'])==1 and car.get('end',self.links[car['route'][0]]['length'])<car.get('start',0):
                raise ValueError('无效的车辆出行方向')
        if 'pedestrians' in data:
            self.walkers.restore(data['pedestrians'])
