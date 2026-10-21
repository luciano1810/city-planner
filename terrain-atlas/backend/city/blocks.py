"""Small blocks are land partitions, not a ring of shallow frontage strips.

Unoccupied blocks use variable frontage subdivisions, off-centre courtyards,
bent mews and edge gardens. Occupied geometry is never moved.
"""
import math
import random
import heapq
from shapely import affinity
from shapely.geometry import Point, Polygon, LineString, box
from shapely.ops import polygonize, unary_union, nearest_points, substring
from .geometry import ROAD_TYPES, FRONTAGE_ROADS, stable_id


def _polygons(shape):
    if shape.is_empty:return []
    if shape.geom_type=='Polygon':return [shape]
    if not hasattr(shape,'geoms'):return []
    return [p for g in shape.geoms for p in _polygons(g)]


def _merge_fragments(result):
    """Absorb unusable corner remnants into an adjacent legal building site."""
    result=list(result)
    while len(result)>1:
        small=next((p for p in result if p.area<190 or p.buffer(-2).area<90),None)
        if small is None:break
        others=[p for p in result if p is not small]
        neighbour=max(others,key=lambda p:p.boundary.intersection(small.boundary).length)
        merged=neighbour.union(small)
        if merged.geom_type!='Polygon' or merged.interiors:break
        result=[p for p in others if p is not neighbour]+[merged]
    return result


def _strips(shape,axis,width,rng):
    """Unequal frontage widths, with no leftover sliver at the end."""
    if shape.is_empty:return []
    x0,y0,x1,y1=shape.bounds
    start,end=(x0,x1) if axis==0 else (y0,y1)
    count=max(1,min(6,round((end-start)/width)))
    weights=[rng.uniform(.65,1.45) for _ in range(count)]
    cuts=[start-1]+[start+(end-start)*sum(weights[:i])/sum(weights) for i in range(1,count)]+[end+1]
    result=[]
    for a,b in zip(cuts,cuts[1:]):
        slab=box(a,y0-1,b,y1+1) if axis==0 else box(x0-1,a,x1+1,b)
        result.extend(_polygons(shape.intersection(slab)))
    return _merge_fragments(result)


def varied_partition(land,kind,seed):
    """Frontage fabric, off-centre courts, bent mews and edge gardens.

    These are land subdivision rules, not fixed building-count stamps. Every
    resulting site is clipped to the actual block and can develop independently.
    """
    if kind in ('single','pair','cluster'):return block_partition(land,kind,seed)
    coords=list(land.minimum_rotated_rectangle.exterior.coords)
    _,a,b=max((math.dist(a,b),a,b) for a,b in zip(coords,coords[1:]))
    angle=math.degrees(math.atan2(b[1]-a[1],b[0]-a[0]))
    origin=land.centroid;local=affinity.rotate(land,-angle,origin=origin)
    x0,y0,x1,y1=local.bounds;w=x1-x0;h=y1-y0
    rng=random.Random(seed);common=None;sites=[]
    if kind=='frontage':
        # Two back-to-back rows form continuous street edges, without an
        # obligatory public plaza in every block.
        cut=y0+h*rng.uniform(.38,.62)
        rows=[local] if h<35 else [local.intersection(box(x0-1,y0-1,x1+1,cut)),local.intersection(box(x0-1,cut,x1+1,y1+1))]
        for row in rows:sites.extend(_strips(row,0,rng.uniform(18,30),rng))
    elif kind=='court':
        left=x0+w*rng.uniform(.22,.33);right=x1-w*rng.uniform(.20,.32)
        top=y0+h*rng.uniform(.25,.38);bottom=y1-h*rng.uniform(.23,.36)
        gate=left+(right-left)*rng.uniform(.12,.86);half=rng.uniform(1.8,2.8)
        common=local.intersection(box(left,top,right,bottom).union(box(gate-half,y0-1,gate+half,top+1)))
        # Corresponding outer/inner edges fan the corner lots towards the
        # court. Rectangular edge strips would strand the corner buildings
        # behind their neighbours with no reserved inward entrance.
        bands=[((x0,y0),(x1,y0),(left,top),(right,top)),
               ((x1,y0),(x1,y1),(right,top),(right,bottom)),
               ((x1,y1),(x0,y1),(right,bottom),(left,bottom)),
               ((x0,y1),(x0,y0),(left,bottom),(left,top))]
        for a,b,c,d in bands:
            count=max(1,min(5,round((math.dist(a,b)+math.dist(c,d))/2/rng.uniform(24,38))))
            weights=[rng.uniform(.7,1.4) for _ in range(count)]
            cuts=[0]+[sum(weights[:i])/sum(weights) for i in range(1,count)]+[1]
            lerp=lambda a,b,t:tuple(a[k]+(b[k]-a[k])*t for k in (0,1))
            for t,u in zip(cuts,cuts[1:]):
                band=Polygon([lerp(a,b,t),lerp(a,b,u),lerp(c,d,u),lerp(c,d,t)])
                sites.extend(_polygons(local.intersection(band).difference(common)))
    elif kind=='mews':
        # A dogleg through-passage, with a small widening away from the centre.
        a=y0+h*rng.uniform(.30,.44);b=y0+h*rng.uniform(.56,.70)
        bend=x0+w*rng.uniform(.35,.65);half=rng.uniform(1.7,2.5)
        line=LineString([(x0-1,a),(bend-w*.08,a),(bend+w*.08,b),(x1+1,b)])
        shared=line.buffer(half,cap_style=2,join_style=2)
        if h>55:shared=shared.union(box(bend-w*.08,a-4,bend+w*.04,a+5))
        common=local.intersection(shared)
        for piece in _polygons(local.difference(common)):
            sites.extend(_strips(piece,0,rng.uniform(26,43),rng))
    elif kind=='garden':
        # Landscape along an edge, rather than a symmetrical central cross.
        top=y0+h*rng.uniform(.17,.27);side=x0+w*rng.uniform(.08,.15)
        common=local.intersection(box(x0-1,y0-1,x1+1,top).union(box(x0-1,top,side,y1+1)))
        sites=_strips(local.difference(common),0,rng.uniform(26,42),rng)
    else:raise ValueError('Unknown block layout: '+kind)
    sites=_merge_fragments(sites)
    if common is not None and (common.geom_type!='Polygon' or common.interiors):return [],None
    if not sites or any(p.geom_type!='Polygon' or not p.is_valid or p.interiors or p.area<180 or p.buffer(-2).area<85 for p in sites):return [],None
    # Affine round-off can fold sub-nanometre vertices at curved boundaries.
    # Zero-width cleaning changes no meaningful land area, unlike snapping lots
    # to a coarse grid, and validity is checked again in world coordinates.
    rotate=lambda p:affinity.rotate(p,angle,origin=origin).buffer(0)
    output=[q for p in sorted(sites,key=lambda p:p.centroid.coords[0]) for q in _polygons(rotate(p))]
    shared=rotate(common) if common is not None else None
    if any(p.area<180 or p.buffer(-2).area<85 for p in output):return [],None
    if any(p.geom_type!='Polygon' or not p.is_valid or p.interiors for p in output+([shared] if shared is not None else [])):return [],None
    return output,shared


def inside_route(start,end,allowed):
    """Shortest visibility path in a polygon, including concave passages."""
    start=tuple(start);end=tuple(end);safe=allowed.buffer(.015,join_style=2)
    direct=LineString([start,end])
    if safe.covers(direct):return [list(start),list(end)]
    points=[start,end]
    for poly in _polygons(allowed):
        points.extend(list(poly.exterior.coords)[:-1])
        for ring in poly.interiors:points.extend(list(ring.coords)[:-1])
    graph=[[] for _ in points]
    for i,a in enumerate(points):
        for j in range(i+1,len(points)):
            b=points[j];distance=math.dist(a,b)
            if distance>1e-8 and safe.covers(LineString([a,b])):
                graph[i].append((j,distance));graph[j].append((i,distance))
    queue=[(0,0)];distance={0:0};previous={}
    while queue:
        cost,i=heapq.heappop(queue)
        if cost!=distance.get(i):continue
        if i==1:
            route=[1]
            while route[-1]!=0:route.append(previous[route[-1]])
            return [list(points[j]) for j in reversed(route)]
        for j,step in graph[i]:
            new=cost+step
            if new<distance.get(j,math.inf):distance[j]=new;previous[j]=i;heapq.heappush(queue,(new,j))
    return None


def court_route(door,common,allowed):
    """Join an edge walk, then share its route to the common access node.

    A courtyard is not a star of one straight diagonal per building. Routes
    follow the inner edge and short doorway links; their complete lengths are
    retained in the walking graph.
    """
    center=common['center'];shape=Polygon(common['points'])
    inner=_polygons(shape.buffer(-1.8,join_style=2))
    if common.get('blockLayout')!='court' or not inner:return inside_route(door,center,allowed)
    ring=LineString(max(inner,key=lambda p:p.area).exterior.coords)
    entry=ring.project(Point(door));hub=ring.project(Point(center))
    first=inside_route(door,ring.interpolate(entry).coords[0],allowed)
    last=inside_route(ring.interpolate(hub).coords[0],center,shape)
    if first is None or last is None:return inside_route(door,center,allowed)
    def forward(a,b):
        if b>=a:return list(substring(ring,a,b).coords)
        return list(substring(ring,a,ring.length).coords)+list(substring(ring,0,b).coords)[1:]
    routes=[forward(entry,hub),forward(hub,entry)[::-1]]
    middle=min(routes,key=lambda pts:sum(math.dist(a,b) for a,b in zip(pts,pts[1:])))
    points=first+list(map(list,middle))[1:]+last[1:]
    return [p for i,p in enumerate(points) if i==0 or math.dist(p,points[i-1])>1e-8]


def _access(shape,land,road,line,common):
    if shape.distance(line)>ROAD_TYPES[road['kind']]['width']/2+4:return None
    center=shape.centroid if shape.covers(shape.centroid) else shape.representative_point()
    anchors=[center]
    if common:anchors += [nearest_points(shape,line)[0]]+[Point(q) for q in list(shape.exterior.coords)[:-1]]
    for anchor in anchors:
        front=line.interpolate(line.project(anchor));connector=LineString([anchor,front])
        if shape.distance(front)>ROAD_TYPES[road['kind']]['width']/2+4:continue
        if not shape.buffer(.02).covers(connector.intersection(land)):continue
        points=inside_route(center.coords[0],anchor.coords[0],shape) if common else [list(center.coords[0])]
        if points is not None:
            points.append(list(front.coords[0]));return center,front,points
    return None


def choose_layout(land,seed,terrain,main_street):
    rng=random.Random(seed);roll=rng.random()
    x,y=land.centroid.coords[0]
    grain=(math.sin(x/260)+math.cos(y/310)+2)/4
    if land.area<2800 or land.area<6500 and roll<.17:return 'single'
    if land.area<4000 and roll<.60:return 'pair'
    if terrain['slope']>.07 or terrain.get('scenic',0)>.65 and roll<.55:return 'garden'
    if main_street and roll<.65 or grain>.65 and roll<.55:return 'frontage'
    return rng.choices(['frontage','court','mews','garden'],[3,4,2,1])[0]


def block_partition(land, kind, seed):
    """Return disjoint building sites plus one connected shared-space polygon."""
    if kind == 'single':
        return [land], None
    coords=list(land.minimum_rotated_rectangle.exterior.coords)
    _,a,b=max((math.dist(a,b),a,b) for a,b in zip(coords,coords[1:]))
    angle=math.degrees(math.atan2(b[1]-a[1],b[0]-a[0]))
    origin=land.centroid
    local=affinity.rotate(land,-angle,origin=origin)
    x0,y0,x1,y1=local.bounds
    rng=random.Random(seed);cx=x0+(x1-x0)*rng.uniform(.32,.68);cy=y0+(y1-y0)*rng.uniform(.22,.78)
    # A continuous public passage with a wider central court; the two sides
    # remain separate developable lots, each with its own street frontage.
    half=rng.uniform(1.8,2.6)
    shared=box(cx-half,y0-1,cx+half,y1+1).union(box(cx-6,cy-6,cx+9,cy+6))
    if kind == 'cluster':
        shared=shared.union(box(x0-1,cy-half,x1+1,cy+half))
    common=local.intersection(shared)
    pieces=local.difference(common)
    sites=list(pieces.geoms) if pieces.geom_type=='MultiPolygon' else [pieces]
    if common.geom_type!='Polygon' or common.interiors or len(sites)!=(2 if kind=='pair' else 4):
        return [],None
    if any(p.geom_type!='Polygon' or p.interiors or p.area<250 or p.buffer(-3).is_empty for p in sites):
        return [],None
    return [affinity.rotate(p,angle,origin=origin).buffer(0) for p in sorted(sites,key=lambda p:p.centroid.coords[0])],affinity.rotate(common,angle,origin=origin).buffer(0)


def prepare_blocks(city):
    """Reserve complete small-block partitions before ordinary frontage lots."""
    roads=[r for r in city.s['roads'] if r['level']==0 and r['kind'] in FRONTAGE_ROADS]
    lines={r['id']:LineString(r['points']) for r in roads}
    blocks=list(polygonize(unary_union(list(lines.values()))))
    old=city.s['parcels'];oldmap={p['id']:p for p in old}
    layouts={l['id']:l for l in city.s.get('blockLayouts',[])}
    obstacles=unary_union([LineString(r['points']).buffer(ROAD_TYPES[r['kind']]['width']/2+2.5) for r in city.s['roads'] if r['level']==0])
    occupied=[p for p in old if p.get('blockCommon') or p.get('renewalProject') or p.get('building') or p.get('openSpace') or p['use']!='auto']
    occupied_ids={p['id'] for p in occupied}
    output=[];records=[];retained=set();new_land=[]
    for block in sorted(blocks,key=lambda p:p.centroid.coords[0]):
        if not 1600<=block.area<=min(city.s['policy']['smallBlockMaximumArea'],city.s['policy']['blockTargetArea']):continue
        land=block.difference(obstacles)
        if land.geom_type!='Polygon' or land.interiors or land.area<900 or not city.terrain.buildable(land):continue
        ident=stable_id('block-layout-',land.normalize().wkb.hex())
        previous=layouts.get(ident)
        if previous and all(pid in oldmap for pid in previous['parcels']):
            records.append(previous);output.extend(oldmap[pid] for pid in previous['parcels']);retained.update(previous['parcels']);continue
        if any(land.intersection(Polygon(p['points'])).area>1 for p in occupied):continue
        rng=random.Random(ident)
        main_street=any(r['kind']=='avenue' and lines[r['id']].distance(land)<20 for r in roads)
        kind=choose_layout(land,ident,city.terrain.features(land),main_street)
        sites,common=varied_partition(land,kind,ident)
        if not sites:
            kind='frontage';sites,common=varied_partition(land,kind,ident)
        if not sites:continue
        shapes=sites+([common] if common is not None else [])
        candidates=[]
        for i,shape in enumerate(shapes):
            shared=i==len(sites)
            # Only attach across this parcel and the verge, never a neighbouring
            # building site. This also rejects awkward concave block layouts.
            links=[]
            for road in roads:
                access=_access(shape,land,road,lines[road['id']],shared)
                if access:
                    center,front,path=access
                    links.append((LineString(path).length,road,front,center,path))
            if not links:break
            length,road,front,center,path=min(links,key=lambda q:(q[0],q[1]['id']))
            line=lines[road['id']];d=line.project(front);a=line.interpolate(max(0,d-1));b=line.interpolate(min(line.length,d+1))
            pid=stable_id('block-site-',(ident,i));p=dict(oldmap.get(pid,{}))
            p.update(id=pid,road=road['id'],points=[list(q) for q in shape.exterior.coords],center=list(center.coords[0]),
                frontage=list(front.coords[0]),area=round(shape.area,2),buildableArea=round(shape.area,2),terrain=city.terrain.features(shape),
                connected=True,source='block',block=ident,blockLayout=kind,blockBuildings=len(sites),blockCommon=shared,
                layoutVersion=7,streetAngle=math.degrees(math.atan2(b.y-a.y,b.x-a.x)))
            for key,value in dict(building=None,landValue=80.,rent=9.,use='auto',age=0).items():p.setdefault(key,value)
            if shared:
                p.update(commonKind='park' if kind=='garden' or kind=='court' and rng.random()<.45 else 'plaza',accessPath=path,accessLength=length)
            candidates.append(p)
        if len(candidates)!=len(shapes):continue
        output.extend(candidates);retained.update(p['id'] for p in candidates)
        new_land.append(land)
        records.append(dict(id=ident,kind=kind,layoutVersion=7,points=[list(q) for q in land.exterior.coords],area=round(land.area,2),
                            parcels=[p['id'] for p in candidates],buildingSites=len(sites),commonArea=round(common.area,2) if common is not None else 0))
    # Removed/edited boundary roads invalidate vacant plans, while buildings,
    # public spaces and protected land keep their original identity and shape.
    replacement=unary_union(new_land)
    removed={p['id'] for p in old if p['id'] not in occupied_ids and not p.get('block') and replacement.intersection(Polygon(p['points'])).area>1}
    city.s['parcels']=[p for p in old if p['id'] not in retained|removed and (not p.get('block') or p['id'] in occupied_ids)]+output
    city.s['blockLayouts']=records
    return {p['road'] for p in old if p['id'] in removed}


def grow_block_commons(city):
    """Deliver shared outdoor space as the first building in its block appears."""
    if not city.s['settings'].get('autoGrow',True) or city.s['settings']['growth']<=0:return False
    active={p.get('block') for p in city.s['parcels'] if p.get('building')}
    made=False
    for p in city.s['parcels']:
        if p.get('renewalProject') or not p.get('blockCommon') or p.get('openSpace') or p['use']=='protected' or p.get('block') not in active or not p.get('connected'):continue
        kind=p['commonKind'];shape=Polygon(p['points'])
        cost=shape.area*(30 if kind=='park' else 75)*p['terrain']['costFactor']
        if city.s['settings']['budget'] and city.s['treasury']<cost:continue
        city.spend(cost,'街区公共空间');fid=city.uid('f');p['openSpace']=fid
        city.s['facilities'].append(dict(id=fid,kind=kind,point=p['center'][:],parcel=p['id'],points=p['points'],generated=True,
            blockCommon=True,capacity=max(30,int(shape.area/4)),cost=round(cost),maintenance=round(cost*.004),created=city.s['month']))
        city.event('街区','共享小路与'+('口袋公园' if kind=='park' else '院落广场')+'随建筑启用',p['center']);made=True
    return made


def block_walkways(city):
    """Real shared-space access and inward-facing building doors."""
    signature=tuple((p['id'],p.get('connected'),p.get('openSpace'),tuple(map(tuple,p.get('accessPath',[]))),
                     tuple(map(tuple,(p.get('building') or {}).get('footprint',[])))) for p in city.s['parcels'])
    if signature==getattr(city,'_block_walk_signature',None):return city._block_walk_cache
    paths=[]
    route_cache=getattr(city,'_block_route_cache',{});retained_routes={}
    solid=unary_union([Polygon(p['building']['footprint']) for p in city.s['parcels'] if p.get('building')])
    obstacles=solid.buffer(-.05)
    roads={r['id']:r for r in city.s['roads']}
    for common in city.s['parcels']:
        if not common.get('blockCommon') or not common.get('openSpace') or not common.get('connected'):continue
        if roads.get(common['road'],{}).get('kind') not in FRONTAGE_ROADS:continue
        link=LineString(common.get('accessPath',[common['center'],common['frontage']]))
        if not link.intersects(obstacles):
            paths.append(dict(id='common-entry-'+common['id'],parcel=common['id'],kind='block-entry',block=common['block'],
                points=[list(q) for q in link.coords],width=2.4,length=link.length,minutes=city.terrain.profile(link,'path')['walkTime']))
        for p in city.s['parcels']:
            if p.get('block')!=common['block'] or not p.get('building') or not p.get('connected'):continue
            shape=Polygon(p['building']['footprint']);door=nearest_points(shape,Polygon(common['points']))[0]
            key=(p['id'],common['id'],shape.wkb,tuple(common['center']))
            if key in route_cache:route=route_cache[key]
            else:
                allowed=unary_union([Polygon(p['points']),Polygon(common['points'])]).buffer(.05,join_style=2)
                # Other buildings cannot occupy either reserved parcel. Check
                # the final route against all buildings even when reusing it.
                route=court_route(door.coords[0],common,allowed.difference(shape))
            retained_routes[key]=route
            if route is None:continue
            line=LineString(route)
            if line.intersection(obstacles).length>.01 or not city.terrain.buildable(line.buffer(.3)):continue
            paths.append(dict(id=stable_id('common-walk-',(p['id'],common['id'])),parcel=p['id'],target=common['id'],kind='neighbourhood',block=common['block'],
                points=[list(q) for q in line.coords],width=2,length=line.length,minutes=city.terrain.profile(line,'path')['walkTime']))
    city._block_walk_signature=signature;city._block_walk_cache=paths;city._block_route_cache=retained_routes
    return paths
