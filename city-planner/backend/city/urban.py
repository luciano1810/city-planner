"""Terrain-aware neighbourhood growth, economic groups and spatial reporting."""
import math
import random
from collections import Counter, defaultdict

import numpy as np
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import nearest_points, unary_union
from shapely.strtree import STRtree

from .geometry import ROAD_TYPES, stable_id, curve_points, building_footprint
from .planning import plan_streets, grow_block_streets, occupancy_index, street_extension_ready

from .parameters import POLICY
from .auto_facilities import sensitive_site_safe
from .blocks import block_walkways


def grow_lanes(city):
    """Grow short connected local streets through reserved frontage gaps.

    Each candidate follows the least costly of a bounded set of local headings.
    Water/grade/building collisions reject it; the resulting street uses the same
    authoritative network as user roads, including demolition and traffic.
    """
    if not city.s['settings'].get('autoGrow', True) or city.s['settings']['growth'] <= 0:
        return False
    if plan_streets(city):
        return grow_block_streets(city)
    if city.s.get('plannedBlocks',0): return False
    attempted=city.s.setdefault('growthAttempts',[])
    tried=set(attempted)
    primary=[r for r in city.s['roads'] if r['level']==0 and r['kind'] in ('street','avenue') and not r.get('generated')]
    footprints=[Polygon(p['building']['footprint']).buffer(5) for p in city.s['parcels'] if p.get('building')]
    protected=[Polygon(p['points']) for p in city.s['parcels'] if p['use']=='protected' or p.get('openSpace')]
    obstacles=unary_union(footprints+protected)
    made=0;index_data=occupancy_index(city)
    for road in primary:
        shape=LineString(road['points'])
        for index in range(3,max(4,int((shape.length-35)/52)),6):
            d=35+index*52
            if d>shape.length-50:
                continue
            start=shape.interpolate(d)
            a,b=shape.interpolate(d-2),shape.interpolate(d+2)
            angle=math.atan2(b.y-a.y,b.x-a.x)
            for side in (-1,1):
                ident=stable_id('lane-',(road['id'],index,side))
                if ident in tried:
                    continue
                if made>=city.s['policy']['autoLanesPerMonth']:
                    return made>0
                if not street_extension_ready(city,start,index_data):continue
                attempted.append(ident);tried.add(ident)
                seed=random.Random(ident)
                points=[list(start.coords[0])]
                heading=angle+side*math.pi/2
                length=seed.uniform(min(130,city.s['policy']['laneMaximumLength']),city.s['policy']['laneMaximumLength'])
                for hop in range(math.ceil(length/30)):
                    choices=[]
                    previous=points[-1]
                    for turn in (0,-.22,.22,-.45,.45):
                        theta=heading+turn
                        q=[previous[0]+math.cos(theta)*30,previous[1]+math.sin(theta)*30]
                        segment=LineString([previous,q])
                        try:
                            city.terrain.valid_link(segment,'lane',0)
                        except ValueError:
                            continue
                        if segment.buffer(ROAD_TYPES['lane']['width']/2+1).intersects(obstacles):
                            continue
                        f=city.terrain.features(segment)
                        choices.append((f['costFactor']+abs(turn)*.6+f['lowland'],theta,q))
                    if not choices:
                        break
                    _,heading,q=min(choices,key=lambda v:v[0])
                    points.append(q)
                if len(points)<4:
                    continue
                # Join an encountered road instead of leaving a false visual crossing.
                candidate=LineString(curve_points(points))
                others=[r for r in city.s['roads'] if r['id']!=road['id'] and r['level']==0 and r['kind'] in ('street','avenue','lane')]
                crossing=[]
                for other in others:
                    inter=candidate.intersection(LineString(other['points']))
                    for p in list(inter.geoms) if hasattr(inter,'geoms') else [inter]:
                        if p.geom_type=='Point' and candidate.project(p)>35:
                            crossing.append((candidate.project(p),p))
                if crossing:
                    distance,p=min(crossing,key=lambda v:v[0])
                    points=[list(candidate.interpolate(x).coords[0]) for x in np.arange(0,distance,12)]+[list(p.coords[0])]
                try:
                    city.add_road(dict(points=points,kind='lane',level=0,shape='curve',name='自动社区支路'))
                    created=city.s['roads'][-1]
                    created.update(generated=True,parent=road['id'],growthKey=ident)
                    made+=1
                except ValueError:
                    continue
    return made>0


def grow_public_spaces(city):
    if not city.s['settings'].get('autoGrow',True) or city.s['settings']['growth']<=0 or not city.s['roads']:
        return False
    policy=city.s['policy'];population=sum(h['size'] for h in city.s['households'])
    jobs=sum(p['building'].get('positions',0) for p in city.s['parcels'] if p.get('building'))
    targets={'park':max(1,math.ceil(population/policy['parkResidents'])),
             'plaza':max(1,math.ceil(jobs/policy['plazaJobs']))}
    if population>400:targets.update(school=math.ceil(population/policy['schoolResidents']),clinic=math.ceil(population/policy['clinicResidents']))
    residents=Counter()
    for h in city.s['households']:residents[h['home']]+=h['size']
    homes=[p for p in city.s['parcels'] if residents[p['id']]]
    made=False
    for kind,target in targets.items():
        existing=[f for f in city.s['facilities'] if f['kind']==kind and not f.get('blockCommon')]
        if len(existing)>=target:continue
        # Bootstrap housing and employment before consuming scarce land.
        if kind=='park' and population<40:continue
        if kind=='plaza' and jobs<20:continue
        available=[p for p in city.s['parcels'] if p['connected'] and not p.get('building')
                   and not p.get('openSpace') and not p.get('blockCommon')
                   and not p.get('renewalProject') and p['use'] in ('auto','residential')
                   and p['terrain'].get('maxSlope',p['terrain']['slope'])<=.45]
        reserved={p['id'] for p in sorted(available,key=lambda p:(p['terrain']['slope'],p['id']))[:3]}
        if population>=100:reserved=set()
        separation=policy[kind+'Separation']
        coverage=[city.distances(f['id'],'walk')[0] for f in existing if f.get('connected')]
        budget=8 if kind in ('park','plaza') else 15
        underserved={p['id']:residents[p['id']]*(1 if not any(d.get(p['id'],math.inf)<budget for d in coverage) else .12) for p in homes}
        choices=[p for p in city.s['parcels'] if p['id'] not in reserved and p['terrain'].get('maxSlope',p['terrain']['slope'])<=.45 and p['connected'] and not p.get('renewalProject') and not p.get('building') and not p.get('openSpace') and p['use']!='protected'
            and not p.get('blockCommon') and (not p.get('block') or p.get('blockLayout')=='single')
            and all(math.dist(p['center'],f['point'])>=separation for f in existing)
            and (kind=='plaza' or p.get('businessCore',0)<.72)
            and (kind not in ('school','clinic') or sensitive_site_safe(city,Polygon(p['points'])))]
        if not choices:continue
        def score(p):
            f=p['terrain']
            people=sum(underserved[q['id']]*math.exp(-math.dist(p['center'],q['center'])/300) for q in homes)
            amenity=f.get('scenic',0) if kind=='park' else p.get('businessCore',0) if kind=='plaza' else 0
            # Distinct catchments matter more than repeatedly occupying the
            # single best-connected street corner.
            return people/120+amenity*.5-f['slope']*5+(min(1,p['area']/1800)*.5 if kind=='school' else 0)+(1.5 if p.get('blockLayout')=='single' and kind in ('park','plaza') else 0)
        parcel=max(choices,key=lambda p:(score(p),p['id']))
        outline=Polygon(parcel['points']).buffer(-3)
        if outline.is_empty or outline.geom_type!='Polygon':continue
        cost=outline.area*(30 if kind=='park' else 75 if kind=='plaza' else 1200 if kind=='school' else 600)*parcel['terrain']['costFactor']
        if city.s['settings']['budget'] and city.s['treasury']<cost:continue
        city.spend(cost,'公共设施');fid=city.uid('f');parcel['openSpace']=fid
        parcel['reason']='自动配套：'+{'park':'社区公园','plaza':'街角广场','school':'社区学校','clinic':'社区诊所'}[kind]
        capacity=max(30,int(outline.area*(.65*3/2.5 if kind=='school' else 1/8 if kind=='clinic' else 1/4)))
        city.s['facilities'].append(dict(id=fid,kind=kind,point=list(parcel['center']),parcel=parcel['id'],
            points=[list(p) for p in outline.exterior.coords],generated=True,capacity=capacity,
            cost=round(cost),maintenance=round(cost*.004),created=city.s['month']))
        city.event('配套',parcel['reason'],parcel['center']);made=True
    return made


def building_style(parcel,use,floors):
    rng=random.Random(stable_id('',(parcel['id'],use,'style')))
    if use=='residential':
        form='tower' if floors>=9 else 'slab' if floors>=4 else 'villa'
    elif use=='office':
        form='tower' if floors>=7 else 'office'
    else:
        form={'commercial':'retail','industrial':'factory','warehouse':'warehouse'}[use]
    return dict(form=form,height=round(floors*({'industrial':6,'warehouse':7,'commercial':4}.get(use,3.3)),1),
                roof=int(rng.random()*4),orientation=math.degrees(math.atan2(parcel['center'][1]-parcel['frontage'][1],parcel['center'][0]-parcel['frontage'][0])),
                usableRatio=.82 if use in ('office','residential') else .9)


def update_entrances(city):
    paths=[]
    for p in city.s['parcels']:
        b=p.get('building')
        if not b:
            p.pop('entrance',None)
            continue
        shape=Polygon(b['footprint'])
        entry=nearest_points(shape.boundary,Point(p['frontage']))[0]
        p['entrance']=list(entry.coords[0])
        b['entrance']=list(entry.coords[0])
        paths.append(dict(id='entry-'+p['id'],parcel=p['id'],points=[p['frontage'],p['entrance']],width=2.2,kind='entrance'))
        # Courtyard paths are real reserved walking surfaces, outside the building.
        if p.get('terrain',{}).get('slope',0)<.18 and b['use']=='residential':
            ring=shape.buffer(2.2).exterior
            if Polygon(p['points']).covers(ring):
                paths.append(dict(id='court-'+p['id'],parcel=p['id'],points=[list(q) for q in ring.coords],width=1.5,kind='courtyard'))
    # Connect neighbouring entrances only through dry, unobstructed courtyards.
    # Reject road crossings here: at-grade crossings belong to the road graph.
    built=[p for p in city.s['parcels'] if p.get('building') and p.get('connected') and p['building']['status']!='construction']
    if built:
        entrances=[Point(p['entrance']) for p in built]
        road_by_id={r['id']:r for r in city.s['roads']}
        def frontage_walk_point(p):
            frontage=p['frontage'];entry=p['entrance'];distance=math.dist(frontage,entry)
            road=road_by_id.get(p['road']);edge=ROAD_TYPES[road['kind']]['width']/2 if road else 0
            # Stay outside the vehicle carriageway when facades sit close to
            # the street. The old halfway point could fall inside the road.
            offset=min(distance,max(edge+1.2,distance-2))
            return [a+(b-a)*offset/max(.001,distance) for a,b in zip(frontage,entry)]
        tree=STRtree(entrances)
        obstacles=unary_union([Polygon(p['building']['footprint']).buffer(-.3) for p in city.s['parcels'] if p.get('building')]+
            [LineString(r['points']).buffer(ROAD_TYPES[r['kind']]['width']/2) for r in city.s['roads'] if r['level']==0])
        degrees=Counter()
        for i,p in enumerate(built):
            for j in sorted(map(int,tree.query(entrances[i].buffer(110)))):
                if j<=i or degrees[p['id']]>=2 or degrees[built[j]['id']]>=2:
                    continue
                q=built[j]
                points=[p['entrance'],frontage_walk_point(p),frontage_walk_point(q),q['entrance']]
                line=LineString(points)
                if line.length<5 or line.length>150 or line.intersects(obstacles) or not city.terrain.buildable(line.buffer(.8),.25):
                    continue
                paths.append(dict(id=stable_id('walk-',(p['id'],q['id'])),parcel=p['id'],target=q['id'],
                    points=points,width=1.6,kind='neighbourhood',
                    length=line.length,minutes=city.terrain.profile(line,'path')['walkTime']))
                degrees[p['id']]+=1;degrees[q['id']]+=1
    city.s['localPaths']=paths+block_walkways(city)


def update_firms(city):
    """One explicitly labelled industry group per occupied business building."""
    firms=city.s.setdefault('firms',[])
    by_place={f['parcel']:f for f in firms if f['status']=='active'}
    population=sum(h['size'] for h in city.s['households'])
    external=city.s['settings']['externalJobs']
    for p in city.s['parcels']:
        b=p.get('building')
        if not b or b['use']=='residential' or b['status']!='active' or not p['connected']:
            continue
        firm=by_place.get(p['id'])
        if not firm and b.get('firmCooldown',0)<=city.s['month']:
            firm=dict(id=city.uid('firm'),parcel=p['id'],industry=b['use'],status='active',opened=city.s['month'],lossMonths=0,relocations=0)
            firms.append(firm)
        if not firm:
            b['businessActive']=False
            continue
        occupied=b.get('employees',0)
        rent=p['rent']*b['floorArea']
        freight=(p.get('freightTime') if p.get('freightTime') is not None else 120)
        freight_cost=freight*max(1,occupied)*8 if b['use'] in ('industrial','warehouse') else 0
        industry_base={'commercial':.10,'office':.18,'industrial':.14,'warehouse':.06}[b['use']]
        local=population*industry_base
        regional=external*({'commercial':.04,'office':.4,'industrial':.4,'warehouse':.16}[b['use']])
        same=max(1,sum(1 for q in city.s['parcels'] if q.get('building') and q['building']['use']==b['use'] and q['building']['status']=='active'))
        sales=(local+regional)/same*9000*(.65+min(1,p.get('accessWorkers',0)/200)*.35)
        cost=rent+occupied*4200+freight_cost
        firm.update(space=b['floorArea'],capacity=b['capacity'],jobs=b.get('positions',0),employees=occupied,
                    revenue=round(sales),cost=round(cost),profit=round(sales-cost),externalDemand=round(regional/same,1),localDemand=round(local/same,1),freightCost=round(freight_cost))
        firm['lossMonths']=firm['lossMonths']+1 if sales<cost*.6 else max(0,firm['lossMonths']-1)
        b['businessActive']=True
        if firm['lossMonths']>=9:
            alternatives=[q for q in city.s['parcels'] if q.get('building') and q['id']!=p['id'] and q['building']['use']==b['use'] and q['building']['status'] in ('active','vacant') and q['connected'] and q['id'] not in by_place and q['rent']<p['rent']*.85]
            if alternatives:
                new=min(alternatives,key=lambda q:q['rent']*q['building']['floorArea'])
                firm.update(parcel=new['id'],lossMonths=0,relocations=firm['relocations']+1)
                new['building'].update(status='active',businessActive=True)
                by_place[new['id']]=firm
                city.event('产业','经营群组迁往成本较低的空间',new['center'])
            else:
                firm['status']='closed';firm['closed']=city.s['month']
                city.event('产业','经营群组持续亏损关闭，岗位进入重新匹配',p['center'])
            b['businessActive']=False;b['firmCooldown']=city.s['month']+6
            b['positions']=0;b['employees']=0
    places={p['id'] for p in city.s['parcels'] if p.get('building') and p['connected']}
    for firm in firms:
        if firm['status']=='active' and firm['parcel'] not in places:
            firm.update(status='closed',closed=city.s['month'])


def spatial_summary(city,parcels):
    ids={p['id'] for p in parcels}
    families=[h for h in city.s['households'] if h['home'] in ids]
    jobs=sum(p['building'].get('positions',0) for p in parcels if p.get('building'))
    residents=sum(h['size'] for h in families)
    outgoing=sum(1 for h in families if h.get('job') and h['job'] not in ids)
    incoming=sum(1 for h in city.s['households'] if h['home'] not in ids and h.get('job') in ids)
    buildings=[p for p in parcels if p.get('building')]
    area=sum(p['area'] for p in parcels)
    floor_area=sum(p['building']['floorArea'] for p in buildings)
    values=[p['landValue'] for p in parcels]
    trips=[t for t in getattr(city,'trips',[]) if t['source'] in ids and t['completed']]
    modes=Counter(t.get('mainMode',t['mode']) for t in trips)
    ages=[p['building']['age'] for p in buildings]
    return dict(population=residents,dayPopulation=residents-outgoing+incoming,jobs=jobs,buildings=len(buildings),area=round(area),floorArea=round(floor_area),
                floorRatio=round(floor_area/max(1,area),2),landValue=round(float(np.median(values)),1) if values else None,
                landP10=round(float(np.percentile(values,10)),1) if values else None,landP90=round(float(np.percentile(values,90)),1) if values else None,
                rent=round(float(np.median([p['rent'] for p in parcels])),2) if parcels else None,
                incoming=incoming,outgoing=outgoing,parcels=sorted(ids),
                stage='形成中' if not ages or sum(ages)/len(ages)<24 else '成长中' if sum(ages)/len(ages)<60 else '成熟',
                modeShare={mode:modes[mode]/len(trips)*100 if trips else None for mode in ('walk','car','bus','metro','tram','train')},
                reason=f'基于 {len(buildings)} 栋建筑用途与实际通勤：流入 {incoming} 人、流出 {outgoing} 人',
                slope=round(sum(p.get('terrain',{}).get('slope',0) for p in parcels)/max(1,len(parcels)),3),
                uses=dict(Counter({u:sum(p['building']['floorArea'] for p in buildings if p['building']['use']==u) for u in ('residential','commercial','office','industrial','warehouse')})))


def clustered_districts(city):
    size=city.s['policy']['districtCellMeters']
    cells=defaultdict(list)
    for p in city.s['parcels']:
        if p.get('building') and p['building']['status']!='construction':
            cells[(int(p['center'][0]//size),int(p['center'][1]//size))].append(p)
    previous=city.s.setdefault('districtCells',{})
    labels={}
    for key,parcels in sorted(cells.items()):
        s=spatial_summary(city,parcels);areas=s['uses'];total=sum(areas.values())
        dominant=max(areas,key=areas.get)
        office=areas['office']/max(1,total)
        activity=sum(p['building'].get('employees',0) for p in parcels if p['building']['use'] in ('office','commercial'))
        offices=[p for p in parcels if p['building']['use']=='office']
        near_offices=sum(any(q['id']!=p['id'] and math.dist(p['center'],q['center'])<city.s['policy']['cbdOfficeNeighbourMeters'] for q in offices) for p in offices)
        is_center=len(offices)>=city.s['policy']['cbdMinimumOffices'] and near_offices>=city.s['policy']['cbdMinimumOffices'] and s['buildings']>=city.s['policy']['cbdMinimumBuildings'] and s['jobs']>=city.s['policy']['cbdMinimumJobs'] and activity>=city.s['policy']['cbdMinimumEmployed'] and office>city.s['policy']['minimumOfficeShare'] and sum(p.get('accessJobs',0) for p in parcels)/len(parcels)>city.s['policy']['cbdAccessJobs']
        kind='CBD' if is_center else {'residential':'居住区','commercial':'商业区','office':'办公集聚区','industrial':'工业仓储区','warehouse':'工业仓储区'}[dominant]
        if max(areas.values())/max(1,total)<city.s['policy']['dominantUseShare'] and kind!='CBD':
            kind='混合城区'
        token=f'{key[0]}:{key[1]}';old=previous.get(token,{})
        streak=old.get('streak',0)+1 if old.get('pending')==kind else 1
        label=kind if streak>=city.s['policy']['districtPersistenceMonths'] else old.get('kind','办公集聚区' if kind=='CBD' else kind)
        previous[token]=dict(kind=label,pending=kind,streak=streak)
        labels[key]=label
    result=[];visited=set()
    old_districts=city.s['districts']
    for seed in sorted(cells):
        if seed in visited:
            continue
        stack=[seed];members=[]
        while stack:
            key=stack.pop()
            if key in visited:
                continue
            visited.add(key);members.append(key)
            for adjacent in ((key[0]+1,key[1]),(key[0]-1,key[1]),(key[0],key[1]+1),(key[0],key[1]-1)):
                if adjacent in cells and labels[adjacent]==labels[seed] and adjacent not in visited:
                    # Do not merge same-colour islands across an impassable barrier.
                    a=cells[key][0]['id'];b=cells[adjacent][0]['id']
                    nearby=min(math.dist(p['center'],q['center']) for p in cells[key] for q in cells[adjacent])<=city.s['policy']['districtJoinMeters']
                    if nearby and b in city.distances(a,'walk')[0]:
                        stack.append(adjacent)
        parcels=[p for key in members for p in cells[key]]
        s=spatial_summary(city,parcels)
        bounds=unary_union([Polygon(p['points']).buffer(35) for p in parcels]).buffer(25).buffer(-25)
        polygons=list(bounds.geoms) if bounds.geom_type=='MultiPolygon' else [bounds]
        ancestor=[d['id'] for d in old_districts if set(d['parcels'])&set(s['parcels'])]
        did=stable_id('district-',sorted(members))
        s.update(id=did,kind=labels[seed],center=list(bounds.centroid.coords[0]),
                 polygons=[[list(p) for p in shape.exterior.coords] for shape in polygons if shape.geom_type=='Polygon'],
                 parents=ancestor,formed=next((d.get('formed',city.s['month']) for d in old_districts if d['id']==did),city.s['month']))
        if s['kind']=='CBD' and not any(d['id'] in ancestor and d['kind']=='CBD' for d in old_districts):
            city.event('城市',f"办公和商业活动形成中心，提供 {s['jobs']} 个岗位",s['center'])
        result.append(s)
    for i,d in enumerate(sorted([d for d in result if d['kind']=='CBD'],key=lambda d:-d['jobs'])):
        d['centerRank']=i+1
    city.s['districts']=result
    from .naming import name_districts
    name_districts(city,old_districts)


def detailed_metrics(city):
    parcels=city.s['parcels'];households=city.s['households'];trips=getattr(city,'trips',[])
    buildings=[p['building'] for p in parcels if p.get('building')]
    completed=[t for t in trips if t['completed']]
    commute=[t for t in completed if t['purpose']=='work']
    avg=lambda values:sum(values)/len(values) if values else None
    developed=sum(p['area'] for p in parcels if p.get('building') and p['building']['status']!='construction')
    area=sum(p['area'] for p in parcels)
    population=sum(h['size'] for h in households)
    prices=[p['landValue'] for p in parcels]
    modes=Counter(t.get('mainMode',t['mode']) for t in completed)
    firms=city.s['firms'];active=[f for f in firms if f['status']=='active']
    traffic_km=sum(t.get('distance',0)/1000 for t in completed if t['mode']=='car')
    return dict(regionalPassengers=sum(t.get('purpose')=='regional' for t in trips),railFreightTonnes=city.s.get('regionalFreight',{}).get('tonnes',0),unservedFreightTonnes=city.s.get('regionalFreight',{}).get('unserved',0),laborForce=len(households),vacantJobs=max(0,city.s['stats']['jobs']-city.s['stats']['employed']),
        housingInConstruction=sum(b['capacity'] for b in buildings if b['use']=='residential' and b['status']=='construction'),
        floorDistribution=dict(Counter(str(b['floors']) for b in buildings)),meanBuildingAge=avg([b['age'] for b in buildings]),
        buildableArea=round(area),floorRatio=sum(b['floorArea'] for b in buildings)/max(1,area),
        builtDensity=population/max(.0001,developed/1e6),jobDensity=city.s['stats']['jobs']/max(.0001,developed/1e6),
        firms=len(active),firmOpened=sum(f['opened']==city.s['month'] for f in firms),firmClosed=sum(f.get('closed')==city.s['month'] for f in firms),
        firmRelocations=sum(f['relocations'] for f in firms),firmProfit=sum(f.get('profit',0) for f in active),
        externalDemand=sum(f.get('externalDemand',0) for f in active),localDemand=sum(f.get('localDemand',0) for f in active),
        landP10=float(np.percentile(prices,10)) if prices else None,landP90=float(np.percentile(prices,90)) if prices else None,
        rentByUse={use:avg([p['rent'] for p in parcels if p.get('building') and p['building']['use']==use]) for use in ('residential','office','commercial','industrial','warehouse')},
        propertyValue=sum(b.get('propertyValue',0) for b in buildings),overburdenedPeople=sum(h['size'] for h in households if h.get('burden',0)>.4),
        commuteMedian=float(np.median([t['minutes'] for t in commute])) if commute else None,
        commuteDistance=avg([t['distance'] for t in commute]),meanWait=avg([t.get('wait',0) for t in completed if t['mode']=='public']),
        transfers=sum(t.get('transfers',0) for t in completed),publicJourneys=sum(t['mode']=='public' for t in completed),
        mainModeShare={mode:modes[mode]/len(completed)*100 if completed else None for mode in ('walk','car','bus','tram','metro','train')},
        tripsByPurpose=dict(Counter(t['purpose'] for t in trips)),vehicleKm=traffic_km,personKm=sum(t.get('distance',0)/1000 for t in completed),
        constructionCost=round(city.s['constructionCost']),fareRevenue=round(sum(t.get('fee',0) for t in completed if t['mode']=='public')*city.s['policy']['workingDaysPerMonth']),
        operationCost=round(sum(l.get('operatingCost',0) for l in city.s['lines']+city.s['regionalServices'])),
        terrainEngineeringCost=round(sum(max(0,r.get('constructionCost',0)-r['length']*ROAD_TYPES[r['kind']]['cost']) for r in city.s['roads'])),
        meanSlope=avg([p['terrain']['slope']*100 for p in parcels]),landscape=avg([p['terrain']['scenic'] for p in parcels]),
        lowlandExposure=sum(h['size'] for h in households if city.parcelmap[h['home']]['terrain']['lowland']>.4),
        pollutionExposure=avg([city.parcelmap[h['home']].get('pollution',0) for h in households]),
        autoRoadKm=sum(r['length'] for r in city.s['roads'] if r.get('generated'))/1000,
        publicSpaceArea=sum(Polygon(f['points']).area for f in city.s['facilities'] if f.get('points') and f['kind'] in ('park','plaza')),
        parks=sum(f['kind']=='park' for f in city.s['facilities']),plazas=sum(f['kind']=='plaza' for f in city.s['facilities']),
        pathKm=sum(LineString(p['points']).length for p in city.s['localPaths'])/1000)


def aggregate_flows(city):
    groups=Counter();size=city.s['policy']['districtCellMeters']
    def location(identifier):
        if identifier in city.parcelmap: return city.parcelmap[identifier]['center']
        for stop in city.s['stops']:
            if stop['id']==identifier:return stop['point']
        return next((f['point'] for f in city.s['facilities'] if f['id']==identifier),None)
    for trip in getattr(city,'trips',[]):
        a,b=location(trip['source']),location(trip['target'])
        if not a or not b: continue
        source=tuple(int(v//size) for v in a);target=tuple(int(v//size) for v in b)
        groups[(source,target,trip['period'],trip['purpose'],trip.get('mainMode','failed'),trip['completed'])]+=trip['people']
    return [dict(source=[(v+.5)*size for v in a],target=[(v+.5)*size for v in b],period=period,purpose=purpose,mode=mode,completed=completed,people=count)
            for (a,b,period,purpose,mode,completed),count in sorted(groups.items())]


def accessibility_by_group(city):
    """Group actual households; representative times use the same journey rules."""
    employers=[p for p in city.s['parcels'] if p.get('building') and p['building'].get('positions',0)>0]
    households=Counter((h['home'],h['car'],'低收入' if h['income']<6000 else '中收入' if h['income']<9000 else '高收入') for h in city.s['households'])
    income={'低收入':4500,'中收入':7500,'高收入':11000};rows=[]
    for period,departure in [('am',480),('off',840),('pm',1080)]:
        totals=defaultdict(lambda:dict(households=0,jobs=0,vacancies=0,services=0))
        for (home,car,group),count in households.items():
            values=totals[group];values['households']+=count
            for p in employers:
                journey=city.route(home,p['id'],car,income[group],period=period,departure=departure)
                if journey and journey['minutes']<=city.s['settings']['accessBudget']:
                    values['jobs']+=p['building']['positions']*count
                    values['vacancies']+=max(0,p['building']['positions']-p['building'].get('employees',0))*count
            for f in city.s['facilities']:
                journey=city.route(home,f['id'],car,income[group],period=period,departure=departure)
                if journey and journey['minutes']<=city.s['settings']['accessBudget']: values['services']+=f['capacity']*count
        for group,values in totals.items():
            rows.append(dict(group=group,period=period,minutes=city.s['settings']['accessBudget'],households=values['households'],
                **{k:round(values[k]/values['households'],1) for k in ('jobs','vacancies','services')}))
    return rows


def observe_changes(city):
    """Report sustained observed changes, with a separate cooldown per signal."""
    stats=city.s['stats'];history=city.s['history'];signals=city.s.setdefault('signals',{})
    baseline=history[-3] if len(history)>=3 else None
    checks={
        '空置':(stats['vacancy'] is not None and stats['housing']>0 and stats['vacancy']>35,
              f"住房空置率连续偏高，目前 {stats['vacancy'] or 0:.1f}%，可暂停开发或改善岗位连接"),
        '拥堵':(stats['congestion']>1,f"道路高峰流量容量比连续超过 1，目前峰值 {stats['congestion']:.2f}"),
        '公交':(any(l.get('load',0)>.85 for l in city.s['lines']),
              '线路区段载客率持续超过 85%，可检查班距和换乘替代路径'),
        '通勤':(bool(baseline and baseline.get('commute') and stats['commute'] is not None and stats['commute']<baseline['commute']*.85),
              f"观察到通勤持续改善，目前平均 {stats['commute'] or 0:.1f} 分钟；此变化不单独归因于某项建设"),
    }
    for key,(condition,message) in checks.items():
        signal=signals.setdefault(key,dict(streak=0,last=-1000))
        signal['streak']=signal['streak']+1 if condition else 0
        if signal['streak']>=city.s['policy']['eventPersistenceMonths'] and city.s['month']-signal['last']>=city.s['policy']['eventCooldownMonths']:
            city.event(key,message);signal['last']=city.s['month']
