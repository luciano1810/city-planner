"""Bounded terrain-aware detours for manually drawn ground roads."""
import heapq
import math

from shapely.geometry import LineString

from .geometry import RoadConflict


def route_around_grade(terrain, controls, kind, obstacles=None, max_visits=2400):
    """Keep clicked points, find local switchbacks, then validate every shortcut.

    Search only after the requested alignment fails. The visit/length bounds
    keep a preview finite even when the requested destination is inaccessible.
    No terrain, water, or construction rules are waived by this helper.
    """
    step = max(8., min(32., terrain.width/max(1,terrain.w-1)/2,
                       terrain.height/max(1,terrain.h-1)/2))
    moves = [(x,y) for x in (-1,0,1) for y in (-1,0,1) if x or y]
    moves += [(x,y) for x,y in ((1,2),(2,1),(-1,2),(-2,1),(1,-2),(2,-1),(-1,-2),(-2,-1))]
    visits = 0

    def valid(a,b):
        line = LineString([a,b])
        if obstacles is not None and not obstacles.is_empty and obstacles.intersects(line):
            return False
        try:
            terrain.valid_link(line,kind,0)
            return True
        except RoadConflict:
            return False

    result = [list(controls[0])]
    for start,end in zip(controls,controls[1:]):
        if valid(start,end):
            result.append(list(end))
            continue
        distance = math.dist(start,end)
        margin = max(160., min(800.,distance))
        minx,maxx = min(start[0],end[0])-margin,max(start[0],end[0])+margin
        miny,maxy = min(start[1],end[1])-margin,max(start[1],end[1])+margin
        limit = distance*4+step*4
        origin = (0,0)
        def point(key):
            return (start[0]+key[0]*step,start[1]+key[1]*step)
        queue = [(distance,0.,origin)]
        costs,parents,edges = {origin:0.},{},{}
        found = None
        while queue and visits < max_visits:
            _,cost,key = heapq.heappop(queue)
            if cost > costs[key]+1e-8:
                continue
            visits += 1
            p = point(key)
            remaining = math.dist(p,end)
            if remaining <= step*2.5 and valid(p,end):
                found = key
                break
            for dx,dy in moves:
                nxt = (key[0]+dx,key[1]+dy)
                q = point(nxt)
                if not (max(0,minx)<=q[0]<=min(terrain.width,maxx) and max(0,miny)<=q[1]<=min(terrain.height,maxy)):
                    continue
                turn = 0.
                if key in parents:
                    prev = parents[key]
                    ux,uy = key[0]-prev[0],key[1]-prev[1]
                    cosine = (ux*dx+uy*dy)/(math.hypot(ux,uy)*math.hypot(dx,dy))
                    turn = step*(1-cosine)
                new_cost = cost+step*math.hypot(dx,dy)+turn
                if new_cost >= costs.get(nxt,math.inf)-1e-8 or new_cost+math.dist(q,end)>limit:
                    continue
                edge = tuple(sorted((key,nxt)))
                if edge not in edges:
                    edges[edge] = valid(p,q)
                if not edges[edge]:
                    continue
                costs[nxt],parents[nxt] = new_cost,key
                heapq.heappush(queue,(new_cost+math.dist(q,end),new_cost,nxt))
        if found is None:
            return None
        path = [list(end)]
        while found != origin:
            path.append(list(point(found)))
            found = parents[found]
        path.append(list(start));path.reverse()
        # Greedy line-of-sight simplification cannot cut through a steep slope.
        index = 0
        while index < len(path)-1:
            target = len(path)-1
            while target > index+1 and not valid(path[index],path[target]):
                target -= 1
            result.append(path[target]);index=target
        if len(result)>100:
            return None
    shape = LineString(result)
    if not shape.is_simple:
        return None
    terrain.valid_link(shape,kind,0)
    return result
