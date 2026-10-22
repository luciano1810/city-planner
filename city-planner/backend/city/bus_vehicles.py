"""Operating bus services use the same lane paths, queues and signals as cars.

Visual traffic is a bounded time sample, as with the existing road simulation.
Passenger assignment and fares remain authoritative in the city transit graph.
"""
from shapely.geometry import Point
from . import transit_management


LENGTH = 10.8
WIDTH = 2.5


def add_services(live):
    if live.mode != 'observed':
        return
    city = live.city
    edges = {e['id']: e for e in city.network['edges']}
    links = {(edge,link['direction']): link for link in live.links.values() for edge in link['edges']}
    for line in city.s['lines']:
        if line['mode'] != 'bus' or not line.get('valid'):
            continue
        for direction in range(1 if line.get('oneway') else 2):
            segments = sorted((s for s in city.line_segments.values() if s['key'].startswith(line['id']+':') and s['direction']==direction),
                              key=lambda s:int(s['key'].rsplit(':',1)[1]))
            route, calls = [], []
            for segment in segments:
                for edge in segment['path']:
                    ref = edge.get('ref')
                    if ref not in edges:
                        continue
                    sign = 1 if edge['origin']==edges[ref]['a'] else -1
                    link = links[(ref,sign)]
                    if not route or route[-1] != link['id']:
                        route.append(link['id'])
                    if not calls:
                        anchor = city.network['stops'][segment['a']]['point']
                        calls.append(dict(stop=segment['a'],segment=0,position=link['shape'].project(Point(anchor))))
                if route:
                    link = live.links[route[-1]]
                    anchor = city.network['stops'][segment['b']]['point']
                    calls.append(dict(stop=segment['b'],segment=len(route)-1,position=link['shape'].project(Point(anchor))))
            if len(calls) < 2:
                continue
            key = f"bus:{line['id']}:{direction}"
            plan = dict(route=route, start=calls[0]['position'], end=calls[-1]['position'],
                        source=calls[0]['stop'], target=calls[-1]['stop'], mode='bus', line=line['id'],
                        lineName=line['name'], color=line['color'], calls=calls,
                        dwell=line.get('dwell',.6)*60, speedLimit=line['speed']/3.6,
                        length=transit_management.vehicle(line)['length'], width=transit_management.vehicle(line)['width'],
                        fleet=line.get('assignedFleet'), startHour=line['startHour'], hours=line['hours'])
            live.sources.append((key,60/transit_management.headway(line)))
            live.journeys[key] = [plan]
            live.destinations[key] = [route]
            live.balances[key] = .5 if direction and line.get('assignedFleet')==1 else 0.


def in_service(city, plan):
    hour = city.s['simulation']['monthSeconds'] % 86400 / 3600
    return (hour-plan['startHour']) % 24 < plan['hours']


def can_dispatch(live, plan):
    return in_service(live.city,plan) and (not plan.get('fleet') or
        sum(car.get('line')==plan['line'] for car in live.cars)<plan['fleet'])


def call_at(car, segment):
    calls = car.get('calls', [])
    index = car.get('callIndex', 0)
    return calls[index] if index < len(calls) and calls[index]['segment']==segment else None


def gap(a, b):
    # Legacy cars retain the existing 8 m following distance.
    return (a.get('length',4.6)+b.get('length',4.6))/2+3.4


def validate(car, live, finite):
    if car.get('mode') != 'bus':
        return
    lines = {line['id'] for line in live.city.s['lines'] if line['mode']=='bus'}
    calls = car.get('calls')
    if car.get('line') not in lines or not isinstance(calls,list) or not 2<=len(calls)<=80:
        raise ValueError('无效的公交车辆线路')
    if type(car.get('callIndex')) is not int or not 0<=car['callIndex']<=len(calls):
        raise ValueError('无效的公交停站进度')
    model=transit_management.vehicle(next(line for line in live.city.s['lines'] if line['id']==car['line']))
    for key,low,high in [('dwell',6,600),('stopElapsed',0,600),('speedLimit',1,50),('length',model['length'],model['length']),('width',model['width'],model['width'])]:
        if not finite(car.get(key,0),low,high):
            raise ValueError('无效的公交车辆参数')
    previous = (-1,-1)
    stops = {s['id'] for s in live.city.s['stops']}
    for call in calls:
        segment = call.get('segment')
        if type(segment) is not int or not 0<=segment<len(car['route']) or call.get('stop') not in stops:
            raise ValueError('无效的公交停靠站')
        position=call.get('position')
        if not finite(position,0,live.links[car['route'][segment]]['length']) or (segment,position)<previous:
            raise ValueError('无效的公交停靠位置')
        previous=(segment,position)
