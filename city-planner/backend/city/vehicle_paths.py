"""Continuous lane paths, parameterised by directed road distance.

Road distance remains the simulation coordinate, so saved trips and signal gates
share the road network's geometry. Junction spans are replaced with tangent
Bezier curves and sampled by arc length, including through road-ID boundaries.
"""
import bisect
import math

from .parameters import ROAD_TYPES

LANES = dict(lane=2, street=2, avenue=4, highway=4, motorway=6)
FRONT_CLEARANCE = 3.5  # longest rendered vehicle half-length plus a safety gap
FOLLOW_GAP = 8.


def lane_for(links, route, segment, junctions=None):
    link = links[route[segment]]
    count = LANES[link['kind']] // (1 if link['oneway'] else 2)
    if segment + 1 < len(route):
        target = links[route[segment + 1]]
        _, incoming = lane_point(link, link['length'], 0)
        _, outgoing = lane_point(target, 0, 0)
        dot = sum(a*b for a,b in zip(incoming,outgoing))
        cross = incoming[0]*outgoing[1]-incoming[1]*outgoing[0]
        turn = 'straight' if dot > .82 else ('right' if cross > 0 else 'left')
        arm = next((a for a in (junctions or {}).get(link['b'],{}).get('approaches',[])
                    if a['road']==link['road'] and a['direction']==-link['direction']), None)
        allowed = [i for i,row in enumerate(arm.get('laneTurns',[])) if turn in row] if arm else []
        if allowed:
            return allowed[-1] if turn=='right' else allowed[0]
        if incoming[0]*outgoing[1] - incoming[1]*outgoing[0] > .08:
            return count - 1
    return 0


def lane_point(link, distance, lane, approach=None):
    shape = link['shape']; d = min(link['length'], max(0., distance))
    p = shape.interpolate(d)
    a = shape.interpolate(max(0., d-.25)); b = shape.interpolate(min(link['length'], d+.25))
    length = max(1e-9, a.distance(b))
    tangent = [(b.x-a.x)/length, (b.y-a.y)/length]
    width = ROAD_TYPES[link['kind']]['width']
    base = LANES[link['kind']] // (1 if link['oneway'] else 2)
    offset = (min(lane, base-1)+.5)*width/LANES[link['kind']]
    if approach and approach.get('autoLanes'):
        remaining = link['length']-d
        blend = max(0., min(1., (approach['laneTaperDistance']-remaining)/
                               (approach['laneTaperDistance']-approach['laneFullDistance'])))
        blend = blend*blend*(3-2*blend)
        offset += ((lane+.5)*approach['laneWidth']-offset)*blend
    offset += -width/2 if link['oneway'] else 0
    return [p.x-tangent[1]*offset, p.y+tangent[0]*offset], tangent


class RoutePath:
    def __init__(self, links, route, junctions):
        self.starts = [0.]
        self.lanes = [lane_for(links, route, i, junctions) for i in range(len(route))]
        approaches = [next((a for a in junctions.get(links[key]['b'], {}).get('approaches', [])
                            if a['road'] == links[key]['road'] and a['direction'] == -links[key]['direction']), None)
                      for key in route]
        for key in route:
            self.starts.append(self.starts[-1]+links[key]['length'])
        self.distances, self.points, self.turns = [], [], []
        trims = [[0., 0.] for _ in route]
        for i in range(len(route)-1):
            incoming, outgoing = links[route[i]], links[route[i+1]]
            arms = junctions.get(incoming['b'], {}).get('approaches', [])
            radius = max([ROAD_TYPES[incoming['kind']]['width']/2+4,
                          ROAD_TYPES[outgoing['kind']]['width']/2+4] +
                         [a['width']/2+4 for a in arms])
            # Adjacent junction curves cannot overlap on a short link.
            trims[i][1] = min(radius, incoming['length']*.42)
            trims[i+1][0] = min(radius, outgoing['length']*.42)
        for i, key in enumerate(route):
            link = links[key]; start, end = trims[i][0], link['length']-trims[i][1]
            count = max(1, math.ceil((end-start)/2))
            for n in range(count+1):
                d = start+(end-start)*n/count
                self._append(self.starts[i]+d, lane_point(link, d, self.lanes[i], approaches[i])[0])
            if i+1 == len(route):
                continue
            target = links[route[i+1]]
            p, u = lane_point(link, end, self.lanes[i], approaches[i])
            q, v = lane_point(target, trims[i+1][0], self.lanes[i+1], approaches[i+1])
            chord = math.dist(p, q)
            dot = max(-1., min(1., sum(a*b for a,b in zip(u,v))))
            handle = chord * (.5523 / math.sqrt(2) if dot < .5 else 1/3)
            c1 = [p[k]+u[k]*handle for k in (0,1)]
            c2 = [q[k]-v[k]*handle for k in (0,1)]
            count = max(16, math.ceil(chord*2))
            points = []
            for n in range(count+1):
                t = n/count; s = 1-t
                points.append([s*s*s*p[k]+3*s*s*t*c1[k]+3*s*t*t*c2[k]+t*t*t*q[k] for k in (0,1)])
            arc = [0.]
            for a,b in zip(points,points[1:]):
                arc.append(arc[-1]+math.dist(a,b))
            low, high = self.starts[i]+end, self.starts[i+1]+trims[i+1][0]
            for d, point in zip(arc[1:], points[1:]):
                self._append(low+(high-low)*d/max(arc[-1],1e-9), point)
            angle = math.acos(dot)
            if angle > .15:
                radius = arc[-1]/angle
                self.turns.append((low, high, min(link['speed'], target['speed'], math.sqrt(max(2., radius)*2.2))))
        self.headings = []
        self.arc = [0.]
        for a,b in zip(self.points,self.points[1:]):
            self.arc.append(self.arc[-1]+math.dist(a,b))
        for i, point in enumerate(self.points):
            before, after = self.points[max(0,i-1)], self.points[min(len(self.points)-1,i+1)]
            u = [point[k]-before[k] for k in (0,1)]; v = [after[k]-point[k] for k in (0,1)]
            a, b = max(1e-9,math.hypot(*u)), max(1e-9,math.hypot(*v))
            self.headings.append(math.atan2(u[1]/a+v[1]/b,u[0]/a+v[0]/b))

    def _append(self, distance, point):
        if self.distances and distance <= self.distances[-1]+1e-8:
            return
        self.distances.append(distance); self.points.append(point)

    def sample(self, distance):
        i = max(0, min(len(self.points)-2, bisect.bisect_right(self.distances, distance)-1))
        a,b = self.points[i:i+2]; low,high = self.distances[i:i+2]
        t = max(0., min(1., (distance-low)/max(1e-9, high-low)))
        point = [a[k]+(b[k]-a[k])*t for k in (0,1)]
        ha,hb = self.headings[i:i+2]
        heading = ha+math.atan2(math.sin(hb-ha),math.cos(hb-ha))*t
        ratio = max(.15, math.dist(a,b)/max(1e-9, high-low))
        return point, heading, ratio

    def speed_limit(self, distance, cruise):
        for low, high, speed in self.turns:
            if distance <= high and low-distance < 40:
                cruise = min(cruise, math.sqrt(speed*speed+2*3.*max(0.,low-distance)))
        return cruise

    def retreat(self, distance, meters):
        """Reserve a real bumper gap even when a corner shortens road distance."""
        i = max(0,min(len(self.distances)-2,bisect.bisect_right(self.distances,distance)-1))
        t = (distance-self.distances[i])/max(1e-9,self.distances[i+1]-self.distances[i])
        arc = self.arc[i]+(self.arc[i+1]-self.arc[i])*t-meters
        i = max(0,min(len(self.arc)-2,bisect.bisect_right(self.arc,arc)-1))
        t = (arc-self.arc[i])/max(1e-9,self.arc[i+1]-self.arc[i])
        return self.distances[i]+(self.distances[i+1]-self.distances[i])*t
