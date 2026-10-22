"""Deterministic street-level walkers on sidewalks and protected crossings.

These are visual samples, like live cars, not additional simulated residents.
Geometry uses the same arm clearance and zebra centres as RoadRenderer.
"""
import copy
import math
from collections import defaultdict

from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union
from shapely.prepared import prep

from .parameters import ROAD_TYPES


def sample(line, distance):
    d = min(line.length, max(0, distance))
    p = line.interpolate(d)
    a, b = line.interpolate(max(0, d-.05)), line.interpolate(min(line.length, d+.05))
    length = max(1e-9, a.distance(b))
    return [p.x, p.y], [(b.x-a.x)/length, (b.y-a.y)/length]


class Walkers:
    LIMIT = 180

    def __init__(self, city, mode):
        self.nodes, self.links, self.graph = {}, {}, defaultdict(list)
        self.people, self.events, self.completed = [], [], 0
        self._build(city)
        sidewalks = [e for e in self.links.values() if e['kind'] in ('sidewalk', 'path') and e['length'] > 5]
        # Test mode explicitly supplies activity; an empty observed city stays empty.
        demand = self.LIMIT if mode == 'test' else min(self.LIMIT, math.ceil(len(city.s['households'])/3))
        total = sum(e['length'] for e in sidewalks)
        count = min(demand, int(total/22))
        for i in range(count):
            distance = (i+.5)*total/count
            for edge in sidewalks:
                if distance <= edge['length']:
                    break
                distance -= edge['length']
            self.people.append(dict(id=i, edge=edge['id'], position=distance, speed=0.,
                pace=1.25+(i*17 % 31)/100, travelled=0., steps=0, waiting=0., state='walking', next=None))

    def _node(self, point):
        key = ':'.join(f'{v:.4f}' for v in point)
        self.nodes.setdefault(key, list(point))
        return key

    def _edge(self, points, kind, junction=None, road=None):
        shape = LineString(points)
        if shape.length < .2:
            return
        a, b = self._node(points[0]), self._node(points[-1])
        if a == b:
            return
        key = f'{a}>{b}'
        for source, target, coords in [(a,b,points),(b,a,list(reversed(points)))]:
            eid = f'{source}>{target}'
            if eid in self.links:
                continue
            line = LineString(coords)
            self.links[eid] = dict(id=eid, a=source, b=target, shape=line, length=line.length,
                                   kind=kind, junction=junction, road=road, pair=key)
            self.graph[source].append(eid)

    def _build(self, city):
        from .signals import clearance
        roads = {r['id']:r for r in city.s['roads'] if r['level']==0 and ROAD_TYPES[r['kind']]['walk']}
        lines = {rid:LineString(r['points']) for rid,r in roads.items()}
        motor_area = unary_union([LineString(r['points']).buffer(ROAD_TYPES[r['kind']]['width']/2+.2)
            for r in city.s['roads'] if r['level']==0 and r['kind']!='path'])
        blocked = prep(motor_area)
        buildings = prep(unary_union([Polygon(p['building']['footprint']).buffer(.35)
            for p in city.s['parcels'] if p.get('building')]))
        self.road_area = motor_area
        cuts, ports, distances = defaultdict(list), defaultdict(list), defaultdict(set)
        for junction in city.network['junctions']:
            for arm in junction['approaches']:
                distances[arm['road']].add(arm['distance'])
        for junction in city.network['junctions']:
            for arm in junction['approaches']:
                rid = arm['road']
                if rid not in roads or roads[rid]['kind']=='path':
                    continue
                line, direction = lines[rid], arm['direction']
                available = line.length-arm['distance'] if direction>0 else arm['distance']
                room = available
                for d in distances[rid]:
                    delta = (d-arm['distance'])*direction
                    if delta>.1:
                        room=min(room,delta/2)
                clear = arm.get('crossingDistance', clearance(arm,junction['approaches'])+3)-3
                trim = min(available, room, clear+3)
                d = arm['distance']+direction*trim
                cuts[rid].append(sorted([arm['distance'],d]))
                if room<clear+(18 if 'crossingDistance' in arm else 14):
                    continue
                point,t = sample(line,d)
                t = [v*direction for v in t]
                offset = arm['width']/2+1.1
                ends = [[point[0]-t[1]*offset*side,point[1]+t[0]*offset*side] for side in (-1,1)]
                ports[junction['id']].append(dict(arm=arm, tangent=t, ends=ends, offset=offset))
                if junction.get('crossings') and junction.get('signal'):
                    self._edge(ends,'crossing',junction['id'],rid)
        for rid,r in roads.items():
            line=lines[rid]
            if r['kind']=='path':
                if not blocked.intersects(line) and not buildings.intersects(line):
                    self._edge(list(line.coords),'path',road=rid)
                continue
            free=[];cursor=0.
            for a,b in sorted(cuts[rid]):
                if a>cursor+.2:
                    free.append((cursor,a))
                cursor=max(cursor,b)
            if cursor<line.length-.2:
                free.append((cursor,line.length))
            for start,end in free:
                # Subdivide curves before offsetting; preserve exact zebra endpoints.
                positions=[start+(end-start)*i/max(1,math.ceil((end-start)/3))
                           for i in range(max(1,math.ceil((end-start)/3))+1)]
                for side in (-1,1):
                    offset=side*(ROAD_TYPES[r['kind']]['width']/2+1.1)
                    points=[]
                    for d in positions:
                        p,t=sample(line,d);points.append([p[0]-t[1]*offset,p[1]+t[0]*offset])
                    shape=LineString(points)
                    if not blocked.intersects(shape) and not buildings.intersects(shape):
                        self._edge(points,'sidewalk',road=rid)
        for junction in city.network['junctions']:
            arms=sorted(ports[junction['id']],key=lambda p:math.atan2(*p['tangent'][::-1]))
            if len(arms)<2:
                continue
            for index,a in enumerate(arms):
                b=arms[(index+1)%len(arms)]
                p,q=a['ends'][1],b['ends'][0];u,v=a['tangent'],b['tangent']
                cross=u[0]*v[1]-u[1]*v[0]
                points=[p,q]
                if abs(cross)>.05:
                    distance=((q[0]-p[0])*v[1]-(q[1]-p[1])*v[0])/cross
                    corner=[p[0]+distance*u[0],p[1]+distance*u[1]]
                    if math.dist(corner,junction['point'])>150:
                        continue
                    points=[p,corner,q]
                line=LineString(points)
                if not blocked.intersects(line) and not buildings.intersects(line):
                    self._edge(points,'corner',road=a['arm']['road'])
        # Ground-level local paths only connect when their whole link is walkable.
        for path in city.s.get('localPaths',[]):
            points=path.get('points',[])
            if len(points)<2:
                continue
            line=LineString(points)
            if not blocked.intersects(line) and not buildings.intersects(line):
                self._edge(points,'path')

    def _next(self, person, edge):
        choices=[self.links[key] for key in self.graph[edge['b']]]
        forward=[e for e in choices if e['b']!=edge['a']]
        choices=forward or choices
        if not choices:
            return None
        # Distribute walking trips across corners and zebra crossings reproducibly.
        choices.sort(key=lambda e:e['id'])
        return choices[(person['id']*7+person['steps']*13)%len(choices)]['id']

    def advance(self, dt, clock, signals, owners):
        groups=defaultdict(list)
        for person in self.people:
            groups[person['edge']].append(person)
        for key,people in groups.items():
            edge=self.links[key];leader=math.inf
            for person in sorted(people,key=lambda p:p['position'],reverse=True):
                old=person['position']
                position=min(edge['length'],old+person['pace']*dt,max(old,leader-.85))
                person['travelled']+=position-old
                person['speed']=(position-old)/dt
                person['position']=position
                person['state']='crossing' if edge['kind']=='crossing' else 'walking'
                if person['speed']<.05 and edge['kind']!='crossing':
                    person['state']='queue'
                leader=position
                if position>=edge['length']-1e-8:
                    target=person['next'] or self._next(person,edge)
                    person['next']=target
                    if not target:
                        continue
                    next_edge=self.links[target];signal=signals.get(next_edge['junction'])
                    enough=signal and signal['pedestrian']=='green' and signal['remaining']>=next_edge['length']/person['pace']+.4
                    blocked=next_edge['kind']=='crossing' and (not enough or next_edge['junction'] in owners)
                    queue=any(p is not person and p['edge']==target and p['position']<.85 for p in self.people)
                    if blocked or queue:
                        person['speed']=0.;person['state']='waiting' if blocked else 'queue';person['waiting']+=dt
                    else:
                        if next_edge['kind']=='crossing':
                            self.events.append(dict(id=person['id'],time=round(clock,3),junction=next_edge['junction'],
                                color='green',remaining=signal['remaining'],duration=next_edge['length']/person['pace']))
                            self.events=self.events[-200:]
                        if edge['kind']=='crossing':
                            self.completed+=1
                        person.update(edge=target,position=0.,next=None,steps=person['steps']+1)

    def view(self):
        result=[]
        for person in self.people:
            edge=self.links[person['edge']];p,t=sample(edge['shape'],person['position'])
            # Two narrow opposing walking streams fit inside the same sidewalk.
            lane=.2
            p=[p[0]-t[1]*lane,p[1]+t[0]*lane]
            result.append(dict(id=person['id'],point=p,heading=math.atan2(t[1],t[0]),speed=round(person['speed'],3),
                stride=round(person['travelled'],4),variant=person['id']%16,height=1.6+(person['id']*7%24)/100,
                state=person['state'],kind=edge['kind'],junction=edge['junction'],level=0))
        return result

    def snapshot(self):
        return copy.deepcopy(dict(people=self.people,events=self.events,completed=self.completed))

    def restore(self,data):
        def finite(value,low,high):
            return type(value) in (int,float) and math.isfinite(value) and low<=value<=high
        if not isinstance(data,dict) or not isinstance(data.get('people'),list) or len(data['people'])>self.LIMIT:
            raise ValueError('无效的行人实景存档')
        people=copy.deepcopy(data['people']);ids=set()
        for p in people:
            if not isinstance(p,dict) or type(p.get('id')) is not int or not 0<=p['id']<self.LIMIT or p['id'] in ids or p.get('edge') not in self.links:
                raise ValueError('无效的行人路线')
            edge=self.links[p['edge']]
            if not all(finite(p.get(k),lo,hi) for k,lo,hi in [('position',0,edge['length']),('pace',1.25,1.6),('speed',0,1.6),('travelled',0,1e15),('waiting',0,1e12)]):
                raise ValueError('无效的行人状态')
            if type(p.get('steps')) is not int or not 0<=p['steps']<=1e12 or p.get('state') not in ('walking','waiting','queue','crossing'):
                raise ValueError('无效的行人步态')
            if p.get('next') is not None and p['next'] not in self.graph[edge['b']]:
                raise ValueError('行人路线断连')
            ids.add(p['id'])
        if type(data.get('completed')) is not int or not 0<=data['completed']<=1e12 or not isinstance(data.get('events'),list):
            raise ValueError('无效的行人计数')
        self.people=people;self.completed=data['completed'];self.events=copy.deepcopy(data['events'])[-200:]
