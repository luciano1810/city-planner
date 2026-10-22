"""Recursive, connected block streets and local geometry invalidation.

Future streets reserve space before development. They are built over time, and
only then confer access; a reserved corridor is never a routing edge.
"""
import math
from shapely.geometry import LineString,Point,Polygon
from shapely.ops import polygonize,unary_union,split
from shapely.strtree import STRtree
from .geometry import stable_id


def plan_streets(city):
    roads=[r for r in city.s['roads'] if not r.get('generated') and r['level']==0 and r['kind'] in ('street','avenue','lane')]
    signature=(bool(city.s['settings'].get('autoGrow',True)),city.s['policy']['blockTargetArea'],tuple((r['id'],tuple(map(tuple,r['points']))) for r in roads),tuple((f['id'],tuple(map(tuple,f.get('points',[])))) for f in city.s['facilities']))
    source=stable_id('',signature)
    if city.s.get('streetPlanSource')==source and city.s.get('streetPlans'):
        city._street_signature=signature
        return city.s['streetPlans']
    if signature==getattr(city,'_street_signature',None):return city.s.get('streetPlans',[])
    city._street_signature=signature
    if not city.s['settings'].get('autoGrow',True):
        city.s['streetPlans']=[];return []
    lines=[LineString(r['points']) for r in roads]
    blocks=list(polygonize(unary_union(lines)))
    plans=[]
    obstacles=unary_union([Polygon(p['building']['footprint']).buffer(7) for p in city.s['parcels'] if p.get('building')]+
        [Polygon(p['points']) for p in city.s['parcels'] if p.get('openSpace') or p['use']=='protected']+
        [Polygon(f['points']) for f in city.s['facilities'] if f.get('points')])
    limit=city.s['policy']['blockTargetArea']
    def subdivide(poly,parent=None,depth=0):
        if poly.area<=limit or depth>=6:return
        coords=list(poly.minimum_rotated_rectangle.exterior.coords)
        edges=[(math.dist(a,b),a,b) for a,b in zip(coords,coords[1:])]
        length,a,b=max(edges)
        width=min(e[0] for e in edges)
        if width<90 or length<170:return
        ux,uy=(b[0]-a[0])/length,(b[1]-a[1])/length
        center=poly.centroid
        choices=[]
        for fraction in (0,-.08,.08):
            origin=[center.x+ux*length*fraction,center.y+uy*length*fraction]
            for turn in (0,-.08,.08):
                angle=math.atan2(uy,ux)+math.pi/2+turn
                dx,dy=math.cos(angle)*length*2,math.sin(angle)*length*2
                raw=LineString([(origin[0]-dx,origin[1]-dy),(origin[0]+dx,origin[1]+dy)])
                cut=poly.intersection(raw)
                if cut.geom_type!='LineString' or cut.length<70:continue
                if cut.buffer(6).intersects(obstacles):continue
                try:city.terrain.valid_link(cut,'lane',0)
                except ValueError:continue
                parts=[p for p in split(poly,raw).geoms if p.geom_type=='Polygon']
                if len(parts)!=2 or min(p.area for p in parts)<limit*.22:continue
                imbalance=abs(parts[0].area-parts[1].area)/poly.area
                score=city.terrain.profile(cut,'lane')['costFactor']+imbalance*.7+abs(turn)*.6
                choices.append((score,cut,parts))
        if not choices:return
        _,cut,parts=min(choices,key=lambda item:item[0])
        points=[list(p) for p in cut.coords]
        ident=stable_id('plan-',[[round(x,3),round(y,3)] for x,y in points])
        plans.append(dict(id=ident,points=points,parent=parent,depth=depth,area=round(poly.area),block=[list(p) for p in poly.exterior.coords]))
        for part in sorted(parts,key=lambda p:p.centroid.coords[0]):subdivide(part,ident,depth+1)
    for block in sorted(blocks,key=lambda p:p.centroid.coords[0]):subdivide(block)
    city.s['streetPlans']=plans
    city.s['streetPlanSource']=source
    city.s['plannedBlocks']=len(blocks)
    return plans


def occupancy_index(city):
    parcels=[p for p in city.s['parcels'] if p.get('connected') and p['use']!='protected']
    return parcels,STRtree([Point(p['center']) for p in parcels])


def settled_building(parcel):
    return bool(parcel.get('building') and parcel['building'].get('status') not in ('planned','construction'))


def lane_growth_budget(city):
    """Share a persistent construction cadence between both street builders."""
    month=city.s['month']
    dates=[r['growthMonth'] for r in city.s['roads'] if r.get('generated') and 'growthMonth' in r]
    interval=city.s['policy']['laneGrowthIntervalMonths']
    if any(0<month-date<interval for date in dates):return 0
    return max(0,int(city.s['policy']['autoLanesPerMonth'])-dates.count(month))


def street_extension_ready(city,line,index=None,block=None):
    """Extend local streets after nearby serviceable land has actually filled.

    One initial connector can start a new city. Later empty roads are not
    demand: only developed plots and real public facilities count as occupied.
    """
    if city.s['month']<=city.s['policy']['streetSeedMonths'] and not any(r.get('generated') for r in city.s['roads']):return True
    parcels,tree=index if index is not None else occupancy_index(city)
    region=Polygon(block) if block else None
    nearby=[parcels[int(i)] for i in tree.query(line.buffer(120),predicate='intersects')]
    if region:nearby=[p for p in nearby if region.covers(Point(p['center']))]
    used=[p for p in nearby if settled_building(p) or p.get('openSpace')]
    if sum(settled_building(p) for p in used)<city.s['policy']['streetGrowthMinimumBuildings']:return False
    # Interior subdivision unlocks an existing neighbourhood; it is different
    # from extending an open road outwards. Keep the stricter frontier gate.
    threshold=city.s['policy']['blockInfillThreshold'] if block else city.s['policy']['streetFillThreshold']
    return sum(p['area'] for p in used)/max(1,sum(p['area'] for p in nearby))>=threshold


def block_street_candidates(city, priorities, index=None):
    plans=plan_streets(city)
    built={r.get('growthKey') for r in city.s['roads']}
    index=index if index is not None else occupancy_index(city)
    candidates=[]
    for plan in plans:
        if plan['id'] in built or city.s['month']-plan.get('failed',-100)<=6:continue
        if plan['parent'] is not None and plan['parent'] not in built:continue
        line=LineString(plan['points'])
        if not street_extension_ready(city,line,index,plan.get('block')):continue
        priority=priorities.evaluate(line,priorities.nearby(line,block=plan.get('block')))
        if priority is None:continue
        candidates.append(dict(id=plan['id'],parent=plan['parent'],plan=plan,priority=priority,
            command=dict(kind='lane',level=0,points=plan['points'],name='社区街 '+str(len(built)+1))))
    return candidates


def construct_streets(city, candidates, budget):
    """One merit order for reserved block streets and open-road branches."""
    made=0
    for candidate in sorted(candidates,key=lambda c:(-c['priority']['score'],c['id'])):
        if made>=budget:break
        try:
            city.add_road(candidate['command'])
            city.s['roads'][-1].update(generated=True,growthKey=candidate['id'],parent=candidate['parent'],
                growthMonth=city.s['month'],growthPriority=candidate['priority'],exactPlacement=False)
            if 'plan' not in candidate:city.s.setdefault('growthAttempts',[]).append(candidate['id'])
            made+=1
        except ValueError:
            # A valuable but blocked/unaffordable route does not consume the
            # construction slot; continue with the next feasible proposal.
            if 'plan' in candidate:candidate['plan']['failed']=city.s['month']
    return made>0


def grow_block_streets(city):
    budget=lane_growth_budget(city)
    if not budget or not city.s['settings'].get('autoGrow',True) or city.s['settings']['growth']<=0:return False
    from .street_priority import StreetPriorities
    priorities=StreetPriorities(city)
    return construct_streets(city,block_street_candidates(city,priorities),budget)
