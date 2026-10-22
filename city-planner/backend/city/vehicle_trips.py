"""Road journeys start and finish at frontage accesses, not at junctions."""
from collections import Counter

from shapely.geometry import Point

from .routing import shortest_paths, reconstruct
from .transit_management import headway


def build_demand(live, terminals):
    _road_demand(live, terminals)
    from .bus_vehicles import add_services
    add_services(live)


def _road_demand(live, terminals):
    city, links = live.city, live.links
    live.sources, live.destinations, live.balances, live.journeys = [], {}, {}, {}
    edge_links = {}
    # Bus road volume is already represented by scheduled line vehicles.
    bus_volume = Counter()
    if live.mode == 'observed':
        line_by_id = {line['id']:line for line in city.s['lines']}
        for segment in city.line_segments.values():
            if segment['mode']=='bus':
                line=line_by_id[segment['key'].split(':')[0]]
                for edge in segment['path']:
                    bus_volume[edge.get('ref')]+=60/headway(line)
    for link in links.values():
        for edge in link['edges']:
            edge_links.setdefault(edge, []).append(link)
    objects = {o['id']: o for o in city.s['parcels']+city.s['facilities']}
    searches = {}

    def search(node):
        if node not in searches:
            searches[node] = shortest_paths(live.graph, node)
        return searches[node]

    def access(oid):
        obj = objects.get(oid, {}); attachment = obj.get('access') or {}
        if obj.get('parcel') in objects:
            return access(obj['parcel'])
        point = obj.get('frontage') or attachment.get('point') or obj.get('point')
        if not point:
            return []
        candidates = edge_links.get(attachment.get('edge'), [])
        if not candidates:
            candidates = [link for link in links.values() if link['road'] == obj.get('road')]
        facility = not candidates and obj.get('connected')
        if facility:
            references = {e.get('ref') for e in city.graphs.get('car',{}).get(oid,[]) if e.get('ref')}
            candidates = [link for link in links.values() if references.intersection(link['edges'])]
            point = (obj.get('accessPath') or [obj.get('accessPoint',point)])[0]
        p = Point(point)
        # Only the assigned access road is eligible. Never jump to an unrelated
        # neighbouring road or a different elevation to manufacture a journey.
        return [(link, link['shape'].project(p)) for link in candidates if facility or link['shape'].distance(p) < 3]

    def add(key, plans, rate):
        if not plans or rate <= 0:
            return
        live.sources.append((key, min(900, rate)))
        live.journeys[key] = plans
        live.destinations[key] = [plan['route'] for plan in plans]
        live.balances[key] = 0.

    if live.mode == 'observed':
        demand = Counter((t['source'],t['target'],t['mode'],'occupied' if t['mode']=='taxi' else '')
                         for t in getattr(city, 'trips', []) if t.get('completed') and t.get('mode') in ('car','taxi'))
        demand.update((t['source'],t['target'],'taxi','pickup')
                      for t in city.s.get('taxiReport',{}).get('emptyJourneys',[]))
        for (source, target, mode, taxi_state), count in sorted(demand.items()):
            choices = []
            for first, start in access(source):
                arm = live.arms.get((first['b'],first['road'],first['direction']))
                if arm and start > live.stop_position(first,arm):
                    continue
                for last, end in access(target):
                    if first['id'] == last['id'] and end-start > 8:
                        route = [first['id']]; cost = (end-start)/first['speed']
                    else:
                        distances, prev = search(first['b'])
                        if last['a'] not in distances:
                            continue
                        middle = [e['ref'] for e in reconstruct(prev, first['b'], last['a'])]
                        route = [first['id']]+middle+[last['id']]
                        if any(links[a]['road']==links[b]['road'] and links[a]['direction']!=links[b]['direction'] for a,b in zip(route,route[1:])):
                            continue
                        cost = (first['length']-start)/first['speed']+distances[last['a']]*60+end/last['speed']
                    if first['length']-start < 6 or end < 6:
                        continue
                    choices.append((cost, dict(route=route, start=start, end=end, source=source, target=target)))
            if choices:
                plan=min(choices, key=lambda q:q[0])[1]
                plan.update(kind=mode,taxiState=taxi_state)
                key=f'od:{source}>{target}' if mode=='car' else f'taxi:{taxi_state}:{source}>{target}'
                add(key, [plan], count)
        # A city assignment is authoritative, including an assignment with no
        # car journeys. Edge volume is not a second source of synthetic trips.
        if getattr(city, 'trips', []):
            return

    for link in links.values():
        if terminals and link['a'] not in terminals:
            continue
        volume = 360 if live.mode == 'test' else max(0,link['volume']-max((bus_volume[e] for e in link['edges']),default=0))
        if volume <= 0:
            continue
        distances, prev = search(link['b'])
        choices = sorted(n for n in (terminals or set(live.graph)) if n != link['a'] and n in distances)
        plans = []
        for target in choices:
            route = [link['id']]+[e['ref'] for e in reconstruct(prev,link['b'],target)]
            if any(links[a]['road']==links[b]['road'] and links[a]['direction']!=links[b]['direction'] for a,b in zip(route,route[1:])):
                continue
            # Closed test networks have explicit mid-block access locations.
            start = 0. if terminals else link['length']*.25
            end = links[route[-1]]['length'] * (1. if terminals else .75)
            if len(route)==1 and end-start < 10:
                continue
            plans.append(dict(route=route,start=start,end=end,source=link['a'],target=target))
        add(link['id'], plans, volume)
