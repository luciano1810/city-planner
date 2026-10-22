"""Complete short, forward-facing lane entrances when a main road is added."""
import math

from shapely.geometry import LineString, Point, Polygon
from shapely.strtree import STRtree

from .geometry import ROAD_TYPES
from .lane_growth import forward_contacts, first_contact
from . import renewal, special_buildings


def connect_lane_entrances(city):
    # Manual entrances retain the drawing tolerance. Automatic dead ends may
    # complete one short missing link, including lane-to-lane links in old saves.
    roads = [r for r in city.s['roads'] if r['level'] == 0 and
             r['kind'] in ('lane', 'street', 'avenue', 'highway', 'motorway')]
    if not any(r['kind'] == 'lane' for r in roads):
        return False
    shapes = [LineString(r['points']) for r in roads]
    index = STRtree(shapes)
    changed = False
    for lane in roads:
        if lane['kind'] != 'lane' or lane.get('exactPlacement'):
            continue
        for end in (0, -1):
            points = lane['points']
            p = Point(points[end])
            reach=45 if lane.get('generated') else 18
            nearby = [int(i) for i in index.query(p.buffer(reach)) if roads[int(i)] is not lane]
            # Never relocate an entrance that already belongs to a junction.
            if any(shapes[i].distance(p) < .05 for i in nearby):
                continue
            inner = next((q for q in (points[1:] if end == 0 else reversed(points[:-1]))
                          if math.dist(q, points[end]) > .01), None)
            if inner is None:
                continue
            direction = [points[end][k]-inner[k] for k in (0, 1)]
            length = math.hypot(*direction)
            candidates = []
            if lane.get('generated'):
                targets=[i for i in nearby if roads[i]['kind'] in ('street','avenue','lane')]
                approach=list(reversed(points)) if end==0 else points
                candidates=[(score,roads[targets[i]]['id'],target)
                            for score,i,target in forward_contacts(approach,[shapes[i] for i in targets],reach)]
            for i in nearby:
                if lane.get('generated'):break
                if roads[i]['kind'] not in ('street', 'avenue'):
                    continue
                shape = shapes[i]
                distance = shape.project(p)
                if not .05 < distance < shape.length-.05:
                    continue
                q = shape.interpolate(distance)
                gap = p.distance(q)
                if not .05 < gap < 18:
                    continue
                forward = sum(direction[k]*(q.coords[0][k]-points[end][k]) for k in (0, 1))/length/gap
                if forward < .75:
                    continue
                candidates.append((gap, roads[i]['id'], list(q.coords[0])))
            for _, _, target in sorted(candidates):
                extension = LineString([points[end], target])
                hit=first_contact(extension,[shapes[i] for i in nearby])
                if hit:
                    target=list(hit[1].coords[0]);extension=LineString([points[end],target])
                updated = [target]+points if end == 0 else points+[target]
                shape = LineString(updated)
                if not shape.is_simple:
                    continue
                occupied = extension.buffer(ROAD_TYPES['lane']['width']/2+2)
                try:
                    city.terrain.valid_link(extension, 'lane', 0)
                    special_buildings.check_roads(city, occupied, 'lane', 0, lane['id'])
                    blocked = any(
                        (p.get('building') and occupied.intersection(Polygon(p['building']['footprint'])).area > 1) or
                        ((p.get('openSpace') or p['use'] == 'protected' or renewal.locked(city, p)) and
                         occupied.intersection(Polygon(p['points'])).area > 1)
                        for p in city.s['parcels'])
                    if blocked:
                        continue
                    profile = city.terrain.profile(shape, 'lane', 0)
                except ValueError:
                    continue
                controls = lane.get('controls', points)
                lane.update(points=updated, controls=[target]+controls if end == 0 else controls+[target],
                            length=shape.length, profile=profile)
                shapes[roads.index(lane)]=shape
                index=STRtree(shapes)
                changed = True
                break
    return changed
