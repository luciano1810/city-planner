"""Direction-preserving local street alignment and exact ground-road contacts."""
import math

from shapely.geometry import LineString, Point
from shapely.ops import substring

from .geometry import ROAD_TYPES, curve_points


def first_contact(line, shapes):
    contacts=[]
    for shape in shapes:
        hit=line.intersection(shape)
        for part in hit.geoms if hasattr(hit,'geoms') else [hit]:
            points=[part] if part.geom_type=='Point' else [Point(p) for p in part.coords] if part.geom_type=='LineString' else []
            contacts.extend((line.project(p),p) for p in points if line.project(p)>.05)
    return min(contacts,key=lambda row:row[0]) if contacts else None


def forward_contacts(points, shapes, reach=45):
    """Prefer the existing tangent; accept only small forward endpoint corrections."""
    end=Point(points[-1]);inner=next((p for p in reversed(points[:-1]) if end.distance(Point(p))>.01),None)
    if inner is None:return []
    dx,dy=end.x-inner[0],end.y-inner[1]
    length=math.hypot(dx,dy);dx/=length;dy/=length
    ray=LineString([end,(end.x+dx*reach,end.y+dy*reach)])
    choices=[]
    for index,shape in enumerate(shapes):
        hit=first_contact(ray,[shape])
        q=hit[1] if hit else shape.interpolate(shape.project(end))
        gap=end.distance(q)
        if not .05<gap<=reach:continue
        forward=(dx*(q.x-end.x)+dy*(q.y-end.y))/gap
        if forward<.9:continue
        choices.append((gap+20*(1-forward),index,list(q.coords[0])))
    return sorted(choices)


def lane_alignment(city,start,heading,length,obstacles,others):
    """Keep the parent normal as a reference instead of accumulating turns."""
    points=[list(start.coords[0])];base=heading
    shapes=[LineString(r['points']) for r in others]
    clearance=ROAD_TYPES['lane']['width']/2+2
    travelled=0.;joined=False
    while travelled<length-.01:
        previous=points[-1];step=min(30,length-travelled)
        choices=[]
        # Leave the reserved frontage corridor perpendicularly. After that,
        # terrain can bend the route, but never redefine its preferred axis.
        headings=[base] if len(points)==1 else [base,heading,heading-.22,heading+.22,heading-.45,heading+.45]
        for theta in dict.fromkeys(headings):
            deviation=abs(math.atan2(math.sin(theta-base),math.cos(theta-base)))
            if deviation>math.pi/4:continue
            q=[previous[0]+math.cos(theta)*step,previous[1]+math.sin(theta)*step]
            segment=LineString([previous,q])
            contact=first_contact(segment,shapes)
            if contact:
                q=list(contact[1].coords[0]);segment=LineString([previous,q])
            try:city.terrain.valid_link(segment,'lane',0)
            except ValueError:continue
            if segment.buffer(clearance).intersects(obstacles):continue
            f=city.terrain.features(segment)
            lateral=abs((q[0]-start.x)*math.sin(base)-(q[1]-start.y)*math.cos(base))
            score=f['costFactor']+f['lowland']+abs(theta-heading)*.6+deviation*2+lateral/120
            choices.append((score,theta,q,bool(contact)))
        if not choices:break
        _,heading,q,joined=min(choices,key=lambda row:row[0])
        travelled+=math.dist(previous,q);points.append(q)
        if joined:break
    if travelled<(20 if joined else 90):return None
    # Smooth once, then trim that exact geometry. Re-smoothing a truncated
    # route can change its approach and lose the road contact we just found.
    candidate=LineString(curve_points(points))
    contact=first_contact(candidate,shapes)
    if contact:
        candidate=substring(candidate,0,contact[0])
        return [list(p) for p in candidate.coords] if candidate.length>=20 else None
    points=[list(p) for p in candidate.coords]
    for _,_,target in forward_contacts(points,shapes):
        extension=LineString([points[-1],target])
        try:city.terrain.valid_link(extension,'lane',0)
        except ValueError:continue
        if extension.buffer(clearance).intersects(obstacles):continue
        # Use the first road encountered, including one before the target.
        hit=first_contact(extension,shapes)
        points.append(list(hit[1].coords[0]) if hit else target)
        break
    return points
