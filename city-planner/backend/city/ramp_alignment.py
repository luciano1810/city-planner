"""Tangent branch geometry for explicit parallel road connections."""
import math
from shapely.geometry import LineString, Point
from shapely.ops import substring
from .geometry import ROAD_TYPES, RoadConflict


def branch_alignment(points, target, point, kind):
    """Keep the drawn alignment except its parallel approach to a ground road.

    The ground road is never moved. A short cubic branch replaces the approach,
    meeting its receiving lane tangentially. Reversing the controls is symmetric.
    """
    reverse = math.dist(points[0], point) < .05
    if not reverse and math.dist(points[-1], point) > .05:
        raise ValueError('接入口必须位于所绘道路的端点')
    route = list(reversed(points)) if reverse else points
    line, ground = LineString(route), LineString(target['points'])
    q = list(point)
    distance = ground.project(Point(q))
    if ground.distance(Point(q)) > .05:
        raise ValueError('吸附目标已移动，请重新吸附')
    # An end-to-end continuation has no receiving through road to fork.
    if min(distance, ground.length-distance) < ROAD_TYPES[target['kind']]['width']:
        return points
    a, b = ground.interpolate(max(0, distance-1)), ground.interpolate(min(ground.length, distance+1))
    norm = math.hypot(b.x-a.x, b.y-a.y)
    tangent = [(b.x-a.x)/norm, (b.y-a.y)/norm]
    before = line.interpolate(max(0, line.length-12))
    travel = [q[0]-before.x, q[1]-before.y]
    length = math.hypot(*travel)
    dot = sum(travel[i]*tangent[i] for i in (0, 1))/max(length, .001)
    if abs(dot) < .85:
        return points
    if dot < 0:
        tangent = [-v for v in tangent]
    if line.length < 60:
        raise RoadConflict('平行接入至少需要 60 米过渡空间，请将接入点移远', q)
    normal = [-tangent[1], tangent[0]]
    width = (ROAD_TYPES[kind]['width']+ROAD_TYPES[target['kind']]['width'])/2+4
    span = min(line.length, max(110, width*5))
    start = line.length-span
    p = list(line.interpolate(start).coords[0])
    prefix = list(substring(line, 0, start).coords) if start > .01 else [p]
    after = line.interpolate(min(line.length, start+1))
    initial = [after.x-p[0], after.y-p[1]]
    size = math.hypot(*initial)
    initial = [v/max(size, .001) for v in initial]
    lateral = sum((p[i]-q[i])*normal[i] for i in (0, 1))

    def cubic(a, b, ta, tb):
        reach = math.dist(a, b)*.4
        c = [a[i]+ta[i]*reach for i in (0, 1)]
        d = [b[i]-tb[i]*reach for i in (0, 1)]
        count = max(12, math.ceil(math.dist(a, b)/4))
        return [[(1-t)**3*a[i]+3*(1-t)**2*t*c[i]+3*(1-t)*t*t*d[i]+t**3*b[i]
                 for i in (0, 1)] for t in (j/count for j in range(1, count+1))]

    if abs(lateral) < width:
        # Coincident alignments still need a visible fork, not a stacked seam.
        side = -1 if lateral < -.01 else 1
        middle = [q[i]-tangent[i]*span*.52+normal[i]*width*side for i in (0, 1)]
        result = prefix+cubic(p, middle, initial, tangent)+cubic(middle, q, tangent, tangent)
    else:
        result = prefix+cubic(p, q, initial, tangent)
    result[-1] = q
    return list(reversed(result)) if reverse else result
