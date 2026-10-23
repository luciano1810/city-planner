"""Stable naming regions: terrain barriers first, distance on open plains second."""
import heapq
import math
from collections import deque

from shapely.geometry import LineString, Point, Polygon

VERSION = 1
REACH_METERS = 1200


def anchor(category, obj, parcels):
    if category == 'buildings':
        return obj.get('center')
    if obj.get('parcel') in parcels:
        return parcels[obj['parcel']].get('center')
    if obj.get('point') is not None:
        return obj['point']
    if obj.get('center') is not None:
        return obj['center']
    points = obj.get('points', [])
    if len(points) >= 2:
        if category == 'roads':
            return list(LineString(points).interpolate(.5, normalized=True).coords[0])
        if len(points) >= 3:
            return list(Polygon(points).representative_point().coords[0])
    return None


def build(terrain, reach=REACH_METERS):
    # Bound the work for large maps. Edges also sample the original heightmap,
    # so a river narrower than this analysis grid still blocks connectivity.
    cols = max(1, min(96, math.ceil(terrain.width / 100)))
    rows = max(1, min(96, math.ceil(terrain.height / 100)))
    dx, dy = terrain.width / cols, terrain.height / rows
    points = [((x + .5) * dx, (y + .5) * dy) for y in range(rows) for x in range(cols)]
    samples = [terrain.sample(p) for p in points]
    land = [not s['water'] and s['slope'] <= .25 and
            not terrain.river_geometry.covers(Point(p)) for p, s in zip(points, samples)]
    graph = [[] for _ in points]
    step = min(dx, dy, terrain.width / max(1, terrain.w - 1),
               terrain.height / max(1, terrain.h - 1)) / 2
    for i, p in enumerate(points):
        if not land[i]:
            continue
        x, y = i % cols, i // cols
        for j in ([i + 1] if x + 1 < cols else []) + ([i + cols] if y + 1 < rows else []):
            if not land[j]:
                continue
            q = points[j]
            edge = LineString([p, q])
            if terrain.river_geometry.intersects(edge):
                continue
            count = max(1, math.ceil(edge.length / step))
            probes = [samples[i]] + [terrain.sample((p[0] + (q[0]-p[0])*k/count,
                                                    p[1] + (q[1]-p[1])*k/count)) for k in range(1, count)] + [samples[j]]
            grade = max(abs(a['height'] - b['height']) / (edge.length/count)
                        for a, b in zip(probes, probes[1:]))
            if any(s['water'] or s['slope'] > .25 for s in probes) or grade > .25:
                continue
            cost = edge.length * (1 + grade * 8)
            graph[i].append((j, cost)); graph[j].append((i, cost))

    # Each disconnected landmass starts separately. Within open land, farthest
    # point seeds bound travel distance; slope costs pull boundaries to ridges.
    distances = [math.inf] * len(points)
    labels = [-1] * len(points)
    regions = []
    while True:
        unclaimed = [i for i, ok in enumerate(land) if ok and math.isinf(distances[i])]
        if unclaimed:
            seed = min(unclaimed, key=lambda i: (samples[i]['height'],
                       math.dist(points[i], (terrain.width/2, terrain.height/2)), i))
        else:
            seed = max(range(len(points)), key=lambda i: distances[i] if land[i] else -1)
            if not land[seed] or distances[seed] <= reach:
                break
        label = len(regions)
        regions.append(dict(id=f'place-region-{seed}', center=list(points[seed]),
                            terrainRule='water-slope-distance'))
        distances[seed] = 0
        labels[seed] = label
        queue = [(0, seed)]
        while queue:
            distance, i = heapq.heappop(queue)
            if distance != distances[i]:
                continue
            for j, cost in graph[i]:
                new = distance + cost
                if new < distances[j]:
                    distances[j] = new; labels[j] = label
                    heapq.heappush(queue, (new, j))

    # Only used to locate bridges, tunnels or mountainside objects whose anchor
    # is on a barrier. This does not join land across that barrier.
    nearest = labels[:]
    queue = deque(i for i, label in enumerate(labels) if label >= 0)
    while queue:
        i = queue.popleft(); x, y = i % cols, i // cols
        for j in ([i-1] if x else []) + ([i+1] if x+1 < cols else []) + ([i-cols] if y else []) + ([i+cols] if y+1 < rows else []):
            if nearest[j] < 0:
                nearest[j] = nearest[i]; queue.append(j)
    return dict(version=VERSION, columns=cols, rows=rows, width=terrain.width,
                height=terrain.height, labels=labels, nearest=nearest), regions


def region_at(city, point):
    if point is None or not hasattr(city.terrain, 'sample'):
        return None
    if 'namingGeography' not in city.s:
        city.s['namingGeography'], city.s['namingRegions'] = build(city.terrain)
    plan = city.s['namingGeography']
    x = min(plan['columns'] - 1, max(0, int(point[0] / plan['width'] * plan['columns'])))
    y = min(plan['rows'] - 1, max(0, int(point[1] / plan['height'] * plan['rows'])))
    label = plan['nearest'][y * plan['columns'] + x]
    return city.s['namingRegions'][label] if label >= 0 else None


def ensure_hierarchy(city):
    """Stable parent districts; functional clusters never change these identities."""
    if not hasattr(city.terrain, 'sample'):
        return
    if 'namingGeography' not in city.s:
        city.s['namingGeography'], city.s['namingRegions'] = build(city.terrain)
    if 'namingDistricts' in city.s:
        return
    coarse, districts = build(city.terrain, reach=4800)
    for district in districts:
        district['id'] = district['id'].replace('place-region-', 'place-district-')
        district['regions'] = []
    for region in city.s['namingRegions']:
        x, y = region['center']
        col = min(coarse['columns']-1, max(0, int(x/coarse['width']*coarse['columns'])))
        row = min(coarse['rows']-1, max(0, int(y/coarse['height']*coarse['rows'])))
        label = coarse['nearest'][row*coarse['columns']+col]
        if label >= 0:
            parent = districts[label]
            region['district'] = parent['id']
            parent['regions'].append(region['id'])
    city.s['namingDistricts'] = [d for d in districts if d['regions']]
