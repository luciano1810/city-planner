"""Curbside bus drafts share directed road routing with committed services."""
import math
import heapq
from collections import defaultdict
from shapely.geometry import LineString, Point
from .parameters import DRIVABLE_ROADS, ROAD_TYPES
from .routing import shortest_paths


def resolve_stops(city, entries):
    if not isinstance(entries, list) or not 2 <= len(entries) <= 80:
        raise ValueError('请按行驶顺序选择 2–80 个公交站点')
    roads = {r['id']: r for r in city.s['roads']}
    existing = {s['id']: s for s in city.s['stops']}
    stops = []
    for i, entry in enumerate(entries):
        if isinstance(entry, str):
            stop = existing.get(entry)
            if not stop or stop['mode'] != 'bus' or not stop.get('enabled', True):
                raise ValueError('请选择可用的公交车站')
            stop = dict(stop)
        else:
            if not isinstance(entry, dict):
                raise ValueError('公交站点格式错误')
            road = roads.get(entry.get('road'))
            if not road or road['kind'] not in DRIVABLE_ROADS:
                raise ValueError('请在已有的机动车道路边选择站点')
            point = city.point(entry.get('anchor', entry.get('point')))
            shape = LineString(road['points'])
            if shape.distance(Point(point)) > ROAD_TYPES[road['kind']]['width']/2 + 3:
                raise ValueError('站点已偏离道路，请重新选择')
            side = entry.get('side', 1)
            if isinstance(side, bool) or side not in (-1, 1):
                raise ValueError('站点必须位于道路的一侧')
            d = shape.project(Point(point)); anchor = shape.interpolate(d)
            a, b = shape.interpolate(max(0, d-.1)), shape.interpolate(min(shape.length, d+.1))
            dx, dy = b.x-a.x, b.y-a.y
            offset = (ROAD_TYPES[road['kind']]['width']/2 + .8)*side/max(math.hypot(dx, dy), .001)
            curb = [anchor.x-dy*offset, anchor.y+dx*offset]
            city.point(curb)
            stop = dict(id=f'bus-draft-{i}', mode='bus', name=f'第 {i+1} 站', point=curb,
                        anchor=list(anchor.coords[0]), road=road['id'], side=side, curb=True,
                        role='passenger', external=False, enabled=True)
            # Reuse a real stop only on the same road and the same curb.
            match = next((s for s in existing.values() if s.get('curb') and s.get('enabled', True)
                          and s.get('road') == road['id'] and s.get('side') == side
                          and math.dist(s['anchor'], stop['anchor']) < 3), None)
            if match:
                stop = dict(match)
        if any(s['id'] == stop['id'] or (s.get('road') == stop.get('road') and s.get('side') == stop.get('side')
               and math.dist(s['point'], stop['point']) < 3) for s in stops):
            raise ValueError('请勿重复选择同一站点；相邻站点至少相距 3 米')
        stops.append(stop)
    return stops


def road_graph(network):
    graph = defaultdict(list)
    for edge in network['edges']:
        if edge['kind'] not in DRIVABLE_ROADS:
            continue
        for a, b, sign in [(edge['a'], edge['b'], 1)] + ([] if edge['oneway'] else [(edge['b'], edge['a'], -1)]):
            graph[a].append(dict(origin=a, to=b, time=edge['time']+edge.get('signalDelayForward' if sign == 1 else 'signalDelayReverse', 0),
                                 kind='car', ref=edge['id'], road=edge['road'], sign=sign, length=edge['length']))
    return graph


def display_path(network, path, start, end, direction=0):
    """Draw each directed service beside its curb, keeping routing on the road.

    Offset whole road runs rather than each split edge so frontage/stop nodes
    cannot introduce spikes. Different roads join within their shared junction.
    """
    edges = {edge['id']:edge for edge in network['edges']}
    runs = []
    for item in path:
        edge = edges[item['ref']]
        forward = item['origin']==edge['a']
        points = edge['points'] if forward else edge['points'][::-1]
        key = (edge['road'],forward)
        if runs and runs[-1][0]==key:
            runs[-1][1].extend(points[1:])
        else:
            runs.append((key,list(points),max(.5,ROAD_TYPES[edge['kind']]['width']/2-1)))
    points = []
    for _,coords,offset in runs:
        shape = LineString(coords).offset_curve(offset,quad_segs=6,join_style=1)
        if shape.is_empty:
            # Very tight self-overlapping bends can erase an offset curve.
            # Preserve the selected side with local normals in that case.
            shape = LineString(coords)
            sampled=[]
            for i,p in enumerate(coords):
                a,b=coords[max(0,i-1)],coords[min(len(coords)-1,i+1)]
                dx,dy=b[0]-a[0],b[1]-a[1];length=max(.001,math.hypot(dx,dy))
                sampled.append([p[0]-dy*offset/length,p[1]+dx*offset/length])
        else:
            pieces=list(shape.geoms) if hasattr(shape,'geoms') else [shape]
            sampled=[list(p) for piece in pieces for p in piece.coords]
        points.extend(sampled)
    def curb(stop):
        if direction and stop.get('curb'):
            return [2*a-p for a,p in zip(stop['anchor'],stop['point'])]
        return list(stop['point'])
    return [curb(start),*points,curb(end)] if points else []


def segment(network, graph, a, b, direction=0):
    """First and last road edges must approach the chosen curb in driving order.

    A two-way service uses the opposite curb on its return journey. Existing
    centerline stops retain their historical undirected stop semantics.
    """
    source, target = network['stops'][a['id']]['node'], network['stops'][b['id']]['node']
    sign = -1 if direction else 1
    def compatible(edge, stop):
        return not stop.get('curb') or (edge['road'] == stop['road'] and edge['sign'] == stop['side']*sign)
    # Arrival direction is part of the state: splitting a road at a frontage
    # or stop must not accidentally permit an immediate mid-block U-turn.
    queue, distances, previous = [], {}, {}
    for edge in graph.get(source, []):
        if compatible(edge, a):
            key = (edge['to'], edge['road'], edge['sign'])
            if edge['time'] < distances.get(key, math.inf):
                distances[key] = edge['time']; previous[key] = (None, edge)
                heapq.heappush(queue, (edge['time'], key))
    while queue:
        cost, key = heapq.heappop(queue)
        if cost != distances[key]:
            continue
        node, road, arrival = key
        if node == target and compatible(previous[key][1], b):
            path = []
            while key is not None:
                key, edge = previous[key]; path.append(edge)
            return path[::-1]
        outgoing = graph.get(node, [])
        terminal = len({e['to'] for e in outgoing}) == 1
        for edge in outgoing:
            if edge['road'] == road and edge['sign'] != arrival and not terminal:
                continue
            next_key = (edge['to'], edge['road'], edge['sign'])
            total = cost + edge['time']
            if total < distances.get(next_key, math.inf)-1e-9:
                distances[next_key] = total; previous[next_key] = (key, edge)
                heapq.heappush(queue, (total, next_key))
    return None



def depot_for(city, network, graph, stops, preferred=None):
    depots = [f for f in city.s['facilities'] if f['kind'] == 'bus_depot' and f.get('connected')
              and (preferred is None or f['id'] == preferred)]
    if not depots:
        raise ValueError('请先建造并连接公交车总站，再创建公交车线路')
    node = network['stops'].get(stops[0]['id'])
    if not node:
        raise ValueError('首站没有连接道路')
    reachable = shortest_paths(graph, node['node'])[0]
    for depot in depots:
        edges = [e for e in network['edges'] if e['road'] == depot.get('accessRoad')]
        if any(n in reachable and node['node'] in shortest_paths(graph, n)[0] for e in edges for n in (e['a'], e['b'])):
            return depot
    raise ValueError('总站与线路之间没有可往返的道路，请连接路网')


def preview(city, cmd):
    from .geometry import make_network
    try:
        stops = resolve_stops(city, cmd.get('stops'))
        # Include existing stations, but never create objects or charge a preview.
        ids = {s['id'] for s in stops}
        network = make_network(city.s['roads'], [s for s in city.s['stops'] if s['id'] not in ids] + stops, city.terrain)
        from .signals import configure
        configure(network, city.s['policy'])
        graph = road_graph(network)
        depot = depot_for(city, network, graph, stops)
        paths = []
        orders = [stops] if cmd.get('oneway') else [stops, stops[::-1]]
        for direction, order in enumerate(orders):
            for a, b in zip(order, order[1:]):
                path = segment(network, graph, a, b, direction)
                if not path:
                    raise ValueError('站点之间无法按所选路侧通行，请检查单向道路、断路或调整站点顺序')
                paths.append(dict(points=display_path(network,path,a,b,direction), direction=direction))
        return dict(valid=True, stops=stops, paths=paths, depot=depot['id'])
    except (ValueError, TypeError, KeyError) as error:
        return dict(valid=False, reason=str(error), paths=[])


def create(city, cmd):
    result = preview(city, cmd)
    if not result['valid']:
        raise ValueError(result['reason'])
    existing = {s['id'] for s in city.s['stops']}
    ids = []
    for stop in result['stops']:
        if stop['id'] not in existing:
            stop.update(id=city.uid('s'), name='公交站', constructionCost=25000)
            from .naming import name_object
            name_object(city, 'stops', stop)
            city.s['stops'].append(stop)
            city.spend(stop['constructionCost'], '车站建设')
        ids.append(stop['id'])
    if cmd.get('id'):
        line = next((l for l in city.s['lines'] if l['id'] == cmd['id'] and l['mode'] == 'bus'), None)
        if not line:
            raise ValueError('公交线路不存在')
        from .engine import number, text
        line.update(stops=ids, depot=result['depot'], curbRouting=True, oneway=bool(cmd.get('oneway', line.get('oneway', False))))
        for key, low, high in [('headway', 2, 120), ('capacity', 10, 2000), ('hours', .25, 24)]:
            if key in cmd:
                line[key] = number(cmd[key], low, high, key)
        if cmd.get('name'):
            line.update(name=text(cmd['name']), nameSource='custom')
        from .transit_management import configure
        configure(line,cmd)
        city.rebuild()
        if line['enabled'] and not line['valid']:
            raise ValueError(line['reason'])
    else:
        city.add_line(dict(cmd, mode='bus', stops=ids, depot=result['depot'], curbRouting=True))
