"""Competing development sites, network centrality and local agglomeration."""
import math,random
from collections import Counter,defaultdict
from shapely.geometry import LineString,Point,Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree
from .geometry import stable_id,building_footprint
from .routing import shortest_paths
from .auto_facilities import sensitive_site_safe
from .housing import HousingMarket
from .centers import evolve_centers
from .business import BusinessMarket, demand_parts


def opportunity_fields(city,employers,homes,facilities):
    """Destination-based accessibility, exact on the current directed graphs.

    A thousand vacant lots share a few hundred opportunity destinations. Reverse
    shortest paths compute the same directed times without a search per lot.
    """
    from collections import defaultdict
    reverse={mode:defaultdict(list) for mode in ('public','car')}
    for mode in reverse:
        for source,edges in city.graphs[mode].items():
            for edge in edges:reverse[mode][edge['to']].append(dict(to=source,time=edge['time']))
    fields={p['id']:dict(jobs30=0,jobs45=0,jobs60=0,publicJobs=0,vacantJobs=0,accessWorkers=0,accessServices=0,amenity=0,freightTime=None) for p in city.s['parcels']}
    budget=city.s['settings']['accessBudget'];parking=city.s['policy']['parkingMinutes']
    for p in employers:
        public,_=shortest_paths(reverse['public'],p['id']);car,_=shortest_paths(reverse['car'],p['id'])
        jobs=p['building'].get('positions',0);vacancy=max(0,jobs-p['building'].get('employees',0))
        for pid,f in fields.items():
            t=min(public.get(pid,math.inf),car.get(pid,math.inf)+parking)
            for minutes in (30,45,60):
                if t<=minutes:f['jobs'+str(minutes)]+=jobs
            if public.get(pid,math.inf)<=30:f['publicJobs']+=jobs
            if t<=budget:f['vacantJobs']+=vacancy
    for pid,count in homes.items():
        public,_=shortest_paths(reverse['public'],pid);car,_=shortest_paths(reverse['car'],pid)
        for source,f in fields.items():
            if min(public.get(source,math.inf),car.get(source,math.inf)+parking)<=budget:f['accessWorkers']+=count
    for facility in facilities:
        if facility.get('capacity',0)<=0:continue
        public,_=shortest_paths(reverse['public'],facility['id'])
        for pid,f in fields.items():
            t=public.get(pid,math.inf)
            if t<=budget:f['accessServices']+=facility.get('capacity',0)
            if facility.get('connected'):f['amenity']+=math.exp(-t/12)
    if city.gateway_node:
        car,_=shortest_paths(reverse['car'],city.gateway_node)
        for pid,f in fields.items():f['freightTime']=car.get(pid)
    return fields


def junction_seed(city, parcels):
    """Find a usable, hand-drawn ground intersection with four distinct arms."""
    manual={r['id'] for r in city.s['roads'] if not r.get('generated')
            and r['level']==0 and r['kind'] in ('street','avenue','lane')}
    radius=city.s['policy']['junctionSeedRadius']
    choices=[]
    for junction in city.network.get('junctions',[]):
        arms=[]
        for arm in junction['approaches']:
            if arm['road'] not in manual:continue
            tangent=arm['tangent']
            if all(sum(a*b for a,b in zip(tangent,other))<math.cos(math.pi/6) for other in arms):
                arms.append(tangent)
        if len(arms)<4:continue
        distances=city.distances(junction['id'],'walk')[0]
        nearby=[]
        for p in parcels:
            meters=distances.get(p['id'],math.inf)*city.s['policy']['walkingMetersPerMinute']
            if meters>radius or p.get('blockCommon') or p['use'] in ('industrial','warehouse'):continue
            if p['terrain'].get('maxSlope',p['terrain']['slope'])>.45:continue
            if not any(building_footprint(p,use) is not None for use in ('office','commercial','residential')
                       if p['use'] in ('auto',use)):continue
            nearby.append((meters,p))
        if not nearby:continue
        # Prefer several viable frontages; ties are stable across reloads.
        score=sum(math.exp(-meters/radius) for meters,p in nearby)
        seed=min(nearby,key=lambda row:(row[0],row[1]['id']))[1]
        choices.append((score,junction['id'],junction,seed))
    if not choices:return None
    _,_,junction,seed=max(choices,key=lambda row:(row[0],row[1]))
    return dict(point=junction['point'][:],parcel=seed['id'],junction=junction['id'],
                source='manual-junction',formed=city.s['month'],startupPeakBuildings=0)


def neighbourhood_infill(city, built):
    """Local walking catchments, including neighbours across different roads."""
    radius=city.s['policy']['neighbourhoodInfillRadius']
    limit=radius/city.s['policy']['walkingMetersPerMinute']
    weights=Counter();sectors=defaultdict(set)
    def local_cost(edge,cost):
        return edge['time'] if cost+edge['time']<=limit else None
    for q in built:
        if not q.get('connected') or q['building']['use'] not in ('residential','commercial','office'):continue
        paths,_=shortest_paths(city.graphs['walk'],q['id'],weight=local_cost)
        strength=.4 if q['building']['status'] in ('planned','construction') else 1
        for pid,minutes in paths.items():
            if pid==q['id'] or pid not in city.parcelmap:continue
            p=city.parcelmap[pid]
            weights[pid]+=strength*math.exp(-minutes/limit)
            dx=q['center'][0]-p['center'][0];dy=q['center'][1]-p['center'][1]
            sectors[pid].add(int((math.atan2(dy,dx)+math.pi)*4/math.pi)%8)
    result={}
    for pid,weight in weights.items():
        directions=sectors[pid]
        enclosed=len(directions)>=3 and any(min((a-b)%8,(b-a)%8)>=3 for a in directions for b in directions)
        result[pid]=min(1,weight/4)*(.5+.5*enclosed)
    return result


def center_radius(city, center, built, distances):
    """Expand with completed, reachable urban land near this particular core."""
    policy=city.s['policy'];base=policy['businessCoreRadius']
    maximum=max(base,policy['businessCoreMaximumRadius'])
    area=sum(p['area'] for p in built if p['building']['status'] not in ('planned','construction')
             and p['building']['use'] in ('residential','commercial','office')
             and math.dist(p['center'],center['point'])<=maximum
             and distances.get(p['id'],math.inf)*policy['walkingMetersPerMinute']<=maximum*2)
    return min(maximum,math.sqrt(base**2+area*policy['businessCoreGrowthFactor']/math.pi))


def update_location_context(city):
    parcels=city.s['parcels']
    if not parcels:return
    # Network integration, sampled at geographically spread real junctions.
    # Cache until geometry changes; changes in employment enter gravity below.
    signature=(tuple((r['id'],r['kind'],r['level'],r.get('oneway'),tuple(map(tuple,r['points']))) for r in city.s['roads']),
               tuple((p['id'],p['road'],tuple(p['frontage']),p.get('connected')) for p in parcels),
               city.s['policy']['centralitySources'],city.s['policy']['centralityMinutes'])
    if signature!=getattr(city,'_integration_signature',None):
        city._integration_signature=signature
        junctions=Counter()
        for e in city.network['edges']:
            if e['kind'] in ('street','avenue','lane'):
                junctions[e['a']]+=1;junctions[e['b']]+=1
        sources=sorted(n for n,v in junctions.items() if v>=3)
        if not sources:sources=sorted(junctions)
        sources=sources[::max(1,math.ceil(len(sources)/city.s['policy']['centralitySources']))]
        sums=Counter()
        static={}
        for source,edges in city.graphs['car'].items():
            static[source]=[]
            for edge in edges:
                road=city.edge_map.get(edge.get('ref'))
                minutes=(edge.get('length',0)*road['freeTime']/max(.001,road['length'])+(.5 if source in city.parcelmap or edge['to'] in city.parcelmap else 0)) if road else edge['time']
                static[source].append(dict(to=edge['to'],time=max(0,minutes)))
        for source in sources:
            distances,_=shortest_paths(static,source)
            for p in parcels:sums[p['id']]+=math.exp(-distances.get(p['id'],math.inf)/city.s['policy']['centralityMinutes'])
        values=list(sums.values());low=min(values,default=0);high=max(values,default=1)
        city._integration={pid:(v-low)/max(.01,high-low) for pid,v in sums.items()}
    residents=Counter()
    for h in city.s['households']:residents[h['home']]+=h['size']
    built=[p for p in parcels if p.get('building')]
    infill=neighbourhood_infill(city,built)
    points=[Point(p['center']) for p in built];tree=STRtree(points)
    roads={r['id']:LineString(r['points']) for r in city.s['roads']}
    street_faces=defaultdict(list);addresses={}
    for p in parcels:
        road=roads.get(p['road'])
        if road is None:continue
        d=road.project(Point(p['frontage']));a=road.interpolate(max(0,d-1));b=road.interpolate(min(road.length,d+1))
        side=1 if (b.x-a.x)*(p['center'][1]-a.y)-(b.y-a.y)*(p['center'][0]-a.x)>=0 else -1
        key=(p['road'],side);addresses[p['id']]=(key,d)
        if p.get('building') or p.get('openSpace'):street_faces[key].append(d)
    for p in parcels:
        point=Point(p['center']);neighbours=[built[int(i)] for i in tree.query(point.buffer(500))]
        p['centrality']=round(city._integration.get(p['id'],0),4)
        p['urbanity']=min(1,sum(math.exp(-math.dist(p['center'],q['center'])/city.s['policy']['siteInfillRadius']) for q in neighbours)/10)
        p['neighbourhoodInfill']=infill.get(p['id'],0)
        p['localResidents']=sum(residents[q['id']]*math.exp(-math.dist(p['center'],q['center'])/220) for q in neighbours)
        p['industryCluster']=min(1,sum(math.exp(-math.dist(p['center'],q['center'])/180) for q in neighbours if q['building']['use'] in ('industrial','warehouse'))/4)
        p['transitReach']=max((math.exp(-math.dist(p['center'],s['point'])/320)*min(1,10/l['headway']) for l in city.s['lines'] if l.get('valid') for s in city.s['stops'] if s['id'] in l['stops'] and s.get('connected')),default=0)
        weights=Counter()
        for q in neighbours:
            if q['id']==p['id']:continue
            b=q['building'];weight=math.exp(-math.dist(p['center'],q['center'])/city.s['policy']['neighbourhoodAffinityRadius'])
            weights[b['use']]+=weight*(.4 if b['status'] in ('planned','construction') else 1)*min(1,b.get('footprintArea',500)/500)
        p['useAffinity']={use:1-math.exp(-value/3) for use,value in weights.items()}
        key,d=addresses.get(p['id'],(None,0))
        distances=[q-d for q in street_faces[key] if abs(q-d)>.1]
        left=min((-v for v in distances if v<0),default=math.inf)
        right=min((v for v in distances if v>0),default=math.inf)
        radius=city.s['policy']['frontageInfillMeters']
        p['frontageFill']=math.exp(-min(left,right)/radius)
        p['infillGap']=left<radius and right<radius
    # An economic nucleus is selected from network opportunities, not a painted
    # zone. It is persistent history, confers no capacity, and still needs demand.
    centers=city.s.setdefault('growthCenters',[])
    eligible=[p for p in parcels if p['connected'] and p['use']!='protected' and not p.get('openSpace')]
    # Drawing a second road may turn a provisional straight-road seed into a
    # crossroads. Once construction starts, retain the established history.
    if not built and not city.s['households'] and all(c['source'] in ('network-opportunity','manual-junction')
            and not c.get('startupPeakBuildings',0) for c in centers):
        seed=junction_seed(city,eligible)
        centers[:]=[seed] if seed else []
    if not centers and eligible:
        offices=[p for p in eligible if p.get('building',{} ) and p['building']['use']=='office']
        seed=max(offices or eligible,key=lambda p:(p.get('useAffinity',{}).get('office',0)*3+p['centrality']**3*2+p['transitReach'],p['id']))
        centers.append(dict(point=seed['center'][:],parcel=seed['id'],source='existing-employment' if offices else 'network-opportunity',formed=city.s['month']))
    origins=evolve_centers(city,eligible,built)
    center_paths=[]
    junction_paths=[]
    for center in centers:
        if center['source']=='manual-junction':
            center['startupPeakBuildings']=max(center.get('startupPeakBuildings',0),len(built))
            fade=max(0,1-center['startupPeakBuildings']/city.s['policy']['junctionSeedBuildings'])
            if fade and center.get('junction') in city.network['nodes']:
                junction_paths.append((fade,city.distances(center['junction'],'walk')[0]))
        if eligible:
            distances=origins.get(center['id'],{})
            center_paths.append((center,distances,center_radius(city,center,built,distances)))
    for p in parcels:
        p['junctionSeed']=max((fade*math.exp(-.5*(distances.get(p['id'],math.inf)
            *city.s['policy']['walkingMetersPerMinute']/city.s['policy']['junctionSeedRadius'])**2)
            for fade,distances in junction_paths),default=0)
        startup=max((max(0,1-c.get('startupPeakBuildings',0)/city.s['policy']['junctionSeedBuildings'])
            *math.exp(-.5*(distances.get(p['id'],math.inf)*city.s['policy']['walkingMetersPerMinute']/radius)**2)
            for c,distances,radius in center_paths if c['source']!='local-activity'),default=0)
        p['businessCore']=max(p.get('activityCore',0),startup)


def desired_floors(city,p,use):
    """A density gradient, with tall offices contingent on market scale."""
    rng=random.Random(stable_id('',(p['id'],use,'height-4')))
    core=p.get('businessCore',0);urban=p.get('urbanity',0)
    market=city.s['settings']['externalJobs']+sum(h['size'] for h in city.s['households'])*.3
    if use=='office':
        maturity=min(1,market/3200)
        floors=round(3+core**.6*(5+19*maturity)+p.get('useAffinity',{}).get('office',0)*3+rng.uniform(-2,2))
    elif use=='residential':
        floors=round(2+urban*3+core*2+rng.uniform(-1,1))
    elif use=='commercial':floors=round(1+core*2+rng.random())
    else:floors=1
    return max(1,min(floors,p['terrain']['maxFloors']))


def development_targets(city, housing_market=None):
    population=sum(h['size'] for h in city.s['households'])
    housing_market = housing_market if housing_market is not None else HousingMarket(city)
    local,regional=demand_parts(city)
    return dict(residential=len(city.s['households'])+housing_market.total,
                **{u:regional[u]+population*rate for u,rate in local.items()})


def demand_summary(city):
    """Current net demand, including all committed supply, for the live HUD."""
    from .construction import day, date_string
    housing = HousingMarket(city)
    business = BusinessMarket(city)
    def row(shortage, target, unit):
        shortage = max(0., shortage)
        return dict(shortage=round(shortage, 1), target=round(target, 1),
                    ratio=min(1., shortage / max(1., target)), unit=unit)
    return dict(date=date_string(day(city)),
                uses=dict(residential=row(sum(n['count'] for n in housing.needs), housing.total, '户'),
                          **{u: row(business.shortage(u), business.totals[u], '岗位容量') for u in business.needs}))


def planned_supply(city, *, housing_credit=1.):
    supply=Counter()
    replaced=set()
    for project in city.s.get('renewals',[]):
        if project['status'] in ('complete','cancelled') or project['options']['mode']=='renovate':continue
        for phase in project['phases']:
            if phase['status'] not in ('planned','waiting','demolition'):continue
            replaced.update(phase['sourceIds'])
            for site in phase['sites']:
                b=site.get('targetBuilding')
                if b:supply[b['use']]+=b['capacity']*(housing_credit if b['use']=='residential' else 1)
    for p in city.s['parcels']:
        if p['id'] in replaced:continue
        b=p.get('building')
        if not b:continue
        supply[b['use']]+=b['capacity']*(housing_credit if b['use']=='residential' and b['status'] in ('planned','construction') else 1)
        if b.get('extensionReady'):
            from .parameters import USES
            space=city.s['policy']['householdSpace'] if b['use']=='residential' else USES[b['use']]['space']
            supply[b['use']]+=b['footprintArea']*b.get('extensionFloors',1)/space*(housing_credit if b['use']=='residential' else 1)
    return supply


def select_projects(city,uses,style,housing_market=None,business_market=None):
    from .renewal import locked
    geometry_changed=False
    housing_market=housing_market if housing_market is not None else HousingMarket(city)
    business_market=business_market if business_market is not None else BusinessMarket(city)
    policy=city.s['policy'];supply=planned_supply(city,housing_credit=1.);targets=development_targets(city,housing_market)
    full_supply=planned_supply(city)
    def needed(use, parcel=None):
        if use=='residential':return parcel is not None and housing_market.needed(parcel)
        return parcel is not None and business_market.needed(parcel,use)
    demand={k:business_market.shortage(k)/max(1,targets[k]) for k in uses if k!='residential'}
    demand['residential']=sum(n['count'] for n in housing_market.needs)/max(1,housing_market.total)
    city.s['demand']=demand
    candidates=[]
    facility_names={f['id']: f.get('name') or '公共配套' for f in city.s['facilities']}
    for p in city.s['parcels']:
        p.pop('developmentReason',None)
        if p.get('building'):continue
        reason=('已建成设施：'+facility_names[p['openSpace']] if p.get('openSpace') in facility_names else
                '公共配套占地' if p.get('openSpace') or p.get('blockCommon') else
                '保护用地，不允许开发' if p['use']=='protected' else
                '道路未接入' if not p['connected'] else
                '更新项目已预留此地块' if locked(city,p) else
                '坡度超过 45%，保留为不可开发陡坡' if p['terrain'].get('maxSlope',p['terrain']['slope'])>.45 else
                '发展速度为零，已停止新开发' if city.s['settings']['growth']<=0 else
                '新项目名额为零' if city.s['settings']['maxProjects']<=0 else None)
        p['developmentReason']=reason or '等待今日开发评估'
        if not reason:candidates.append(p)
    startup=sum(h['size'] for h in city.s['households'])<100

    ranked={u:[] for u in uses}
    eligible={p['id']:set() for p in candidates}
    exclusions={p['id']:set() for p in candidates}
    served_yards={s['start'] for s in city.s['regionalServices'] if s.get('valid')}
    # The best feasible site for each use competes for limited construction
    # capacity. Infill favours existing fabric; heavy uses prefer the edge.
    for p in candidates:
        central=p.get('centrality',0);cluster=p.get('cluster',0);urban=p.get('urbanity',0)
        transit=p.get('transitReach',0);terrain=p['terrain'];access=min(1,p.get('accessJobs',0)/400)
        freight=p.get('freightTime');freight=freight if freight is not None else 120
        hub=max((math.exp(-math.dist(p['center'],s['point'])/500) for s in city.s['stops'] if s['id'] in served_yards and s.get('connected')),default=0)
        same=p.get('useAffinity',{});core=p.get('businessCore',0)
        heavy=same.get('industrial',0)+same.get('warehouse',0)
        scores=dict(
            residential=(.25+urban*.8+same.get('residential',0)*3+access*.4+transit*.25+terrain['scenic']*.4)*(1-core*.78)*(1-p.get('pollution',0)*.7)/(1+terrain['slope']*5+heavy*2),
            commercial=(.15+same.get('commercial',0)*2+min(1,p.get('localResidents',0)/160)*1.5+core*2+urban*.4+transit*.4)/terrain['costFactor'],
            office=(.03+core**2*9+same.get('office',0)*4+central**3*.5+transit*.3)/(1+terrain['slope']*9+heavy*3),
            industrial=(.25+(1-central)**2*2+p.get('industryCluster',0)*1.5+hub)/(1+freight/35+terrain['slope']*15+p['landValue']/1200),
            warehouse=(.2+(1-central)**2*1.8+p.get('industryCluster',0)+hub*2)/(1+freight/25+terrain['slope']*18+p['landValue']/1000))
        for use,score in scores.items():
            if p['use'] in uses and p['use']!=use:continue
            if use=='residential' and not sensitive_site_safe(city,Polygon(p['points'])):
                exclusions[p['id']].add('住宅选址受周边污染或安全间距限制');continue
            if use in ('industrial','warehouse') and freight>=120:
                exclusions[p['id']].add('工业与仓储缺少可达货运门户');continue
            rng=random.Random(stable_id('',(p['id'],use,'site')))
            # Persistent micro-site variation breaks identical rows without
            # re-rolling the entire city every month.
            score*=rng.uniform(.95,1.05)
            if use in ('residential','commercial','office'):
                score*=1+policy['junctionSeedBonus']*p.get('junctionSeed',0)
                score*=1+policy['neighbourhoodInfillBonus']*p.get('neighbourhoodInfill',0)
                score*=1+policy['frontageInfillBonus']*(p.get('frontageFill',0)+int(p.get('infillGap',False)))
                if p.get('block'):score*=1.4
            if use=='residential':score*=housing_market.pressure(p)
            ranked[use].append((score,p));eligible[p['id']].add(use)
    for rows in ranked.values():rows.sort(key=lambda row:(-row[0],row[1]['id']))
    used=set();max_projects=int(city.s['settings']['maxProjects']*city.s['settings']['growth']);started=0
    if hasattr(city,'_period_factor'):
        credit=city.s['calendar']['projectCredit']+max_projects*city._period_factor
        max_projects=int(credit+1e-9);city.s['calendar']['projectCredit']=max(0.,credit-max_projects)
    # Rejected proposals do not consume construction slots. Each parcel is tried once.
    for attempt in range(len(candidates)):
        if started>=max_projects:break
        choices=[]
        for use,rows in ranked.items():
            while rows and rows[0][1]['id'] in used:rows.pop(0)
            if use=='residential':
                candidate=next(((score,p) for score,p in rows if p['id'] not in used and needed(use,p)),None)
                if candidate:choices.append((candidate[0],use,candidate[1]))
            else:
                candidate=max(((score*business_market.pressure(p,use),p) for score,p in rows
                    if p['id'] not in used and needed(use,p)),key=lambda row:(row[0],row[1]['id']),default=None)
                if candidate:choices.append((candidate[0],use,candidate[1]))
        if not choices:break
        # Give the first homes a foothold before employment uses fill the queue.
        housing=[row for row in choices if row[1]=='residential' and row[2]['terrain']['slope']>.20]
        if startup and started<3 and housing:choices=housing
        _,use,p=max(choices,key=lambda row:(row[0],row[1],row[2]['id']));used.add(p['id'])
        if use in ('industrial','warehouse') and not p.get('block'):
            # Heavy uses assemble adjacent vacant frontage lots into a larger
            # site. Keep the primary identity/frontage; never swallow a street,
            # resident, facility, protected lot or future reserved connection.
            base=Polygon(p['points']);parts=[p]
            for q in sorted(candidates,key=lambda q:math.dist(q['center'],p['center'])):
                if len(parts)>=5:break
                if q['id'] in used or q.get('block') or q.get('building') or q['road']!=p['road'] or q['use'] not in ('auto',use):continue
                shape=Polygon(q['points'])
                if base.distance(shape)>2.5:continue
                merged=unary_union([base,shape]).buffer(1.3,join_style=2).buffer(-1.3,join_style=2)
                if merged.geom_type!='Polygon' or not city.terrain.buildable(merged):continue
                base=merged;parts.append(q)
            if len(parts)>1:
                geometry_changed=True
                removed={q['id'] for q in parts[1:]};used.update(removed)
                city.s['parcels']=[q for q in city.s['parcels'] if q['id'] not in removed]
                for pid in removed:city.parcelmap.pop(pid,None)
                p.update(points=[list(q) for q in base.exterior.coords],center=list(base.centroid.coords[0]),area=round(base.area,2),buildableArea=round(base.area,2),terrain=city.terrain.features(base),assembledFrom=[q['id'] for q in parts])
            # Use the road tangent beside the assembled site, not the original
            # end-lot entrance's diagonal to its new center.
            road=next(r for r in city.s['roads'] if r['id']==p['road'])
            line=LineString(road['points']);distance=line.project(Point(p['center']))
            a=line.interpolate(max(0,distance-1));b=line.interpolate(min(line.length,distance+1))
            p['streetAngle']=math.degrees(math.atan2(b.y-a.y,b.x-a.x))
        terrain=p['terrain'];central=p.get('centrality',0);cluster=p.get('cluster',0);urban=p.get('urbanity',0)
        intensity=max(0,min(1,p.get('businessCore',0)*.7+urban*.3))
        floors=desired_floors(city,p,use)
        hillside=terrain['slope']>.20
        if hillside:floors=min(floors,3)
        maximum=policy['officeFootprintMaximum'] if use=='office' else policy['residentialFootprintMaximum'] if use=='residential' else math.inf
        sizing=random.Random(stable_id('',(p['id'],use,'floorplate')))
        maximum*=sizing.uniform(.55,1) if use=='office' else sizing.uniform(.75,1)
        if hillside:maximum=min(maximum,240.)
        local_gap=housing_market.gap(p) if use=='residential' else business_market.gap(p,use)
        if use=='residential':maximum=min(maximum,max(100,local_gap*policy['householdSpace']*1.25))
        else:maximum=min(maximum,max(100,local_gap*uses[use]['space']*1.25))
        footprint=building_footprint(p,use,intensity,maximum)
        if footprint is None:
            p['developmentReason']='地块形状或退界后面积不足，无法布置建筑';continue
        if not city.terrain.buildable(footprint,.45):
            p['developmentReason']='建筑范围含水面或超过 45% 的陡坡';continue
        if p.get('block'):
            space=policy['householdSpace'] if use=='residential' else uses[use]['space']
            gap=local_gap
            # Large floorplates need real demand; start low and add floors as
            # needed rather than forcing a huge vacant complex into a village.
            if footprint.area/space>gap*1.25:
                p['developmentReason']=p['reason']='整街区项目等待足够的住房或经营空间需求';continue
            floors=min(floors,max(1,int(gap*space/footprint.area)))
        if use=='residential':
            floors=min(floors,max(1,int(local_gap*1.25*policy['householdSpace']/footprint.area)))
        else:
            floors=min(floors,max(1,int(local_gap*1.25*uses[use]['space']/footprint.area)))
        if use=='office':
            # A single early tower must not consume the next decade's demand.
            project_jobs=max(45,targets[use]*policy['officeProjectShare'])
            floors=min(floors,max(2,int(project_jobs*uses[use]['space']/footprint.area)))
        floor_area=footprint.area*floors;cap=max(1,int(floor_area/(policy['householdSpace'] if use=='residential' else uses[use]['space'])))
        projected_rent=uses[use]['rent']*(1+central*.35+cluster*.35)
        engineering=terrain['costFactor']
        # Small low-rise homes need local stepped foundations, not full-lot grading.
        if hillside and use=='residential' and footprint.area<=240.1:
            engineering=1+(engineering-1)*.5
        cost=floor_area*uses[use]['cost']*engineering+p['landValue']*p['area']
        payback=policy['developmentPaybackYears']
        # Early low-rise hillside housing accepts a longer investment horizon.
        if startup and hillside and use=='residential':payback*=1.5
        if floor_area*projected_rent*12*.8*payback<cost:
            p['developmentReason']=p['reason']=f"候选{uses[use]['name']}项目预计租金收益不足以覆盖土地与建设成本";continue
        p.pop('developmentReason',None)
        p['rent']=round(projected_rent,2)
        p['building']=dict(id=city.uid('b'),use=use,floors=floors,floorArea=round(floor_area,1),footprintArea=round(footprint.area,1),
            footprint=[list(q) for q in footprint.exterior.coords],center=list(footprint.centroid.coords[0]),capacity=cap,status='construction',ready=city.s['month']+policy['constructionBaseMonths']+floors//2,
            age=0,occupied=0,positions=0,employees=0,cost=round(cost),vacantMonths=0,**style(p,use,floors))
        b=p['building']
        from .construction import schedule, day
        schedule(city,b,start=int(day(city))+1+started%3)
        if len(footprint.exterior.coords)>7 and use in ('residential','commercial'):b['form']='courtyard'
        b['usableArea']=round(floor_area*b['usableRatio'],1);b['useAreas']={use:round(floor_area,1)}
        started+=1
        full_supply[use]+=cap;supply[use]+=cap
        if use=='residential':
            housing_market.reserve(p,cap,projected_rent)
            demand[use]=sum(n['count'] for n in housing_market.needs)/max(1,housing_market.total)
        else:
            business_market.reserve(p,use,cap)
            demand[use]=business_market.shortage(use)/max(1,targets[use])
        p['reason']='用途竞争选址：交通中心性、既有街区、有效需求与开发收益满足条件'
    for p in candidates:
        if p.get('building') or p['id'] in used:continue
        options=eligible[p['id']]
        if not options:
            p['developmentReason']='；'.join(sorted(exclusions[p['id']])) or '规划用途没有可行的开发方案'
        elif any(needed(use,p) for use in options):
            p['developmentReason']=f'今日新建名额已用尽（{started}/{max_projects}），等待明日选址'
        elif options=={'residential'}:
            p['developmentReason']=f"本地通勤范围内住房缺口 {housing_market.gap(p):.0f} 户；可负担空房与已承诺住房已按就业地点抵扣，等待局部需求"
        else:
            rows=[(f"本地住宅缺口 {housing_market.gap(p):.0f} 户" if u=='residential' else f"本地{uses[u]['name']}缺口 {business_market.gap(p,u):.1f}") for u in sorted(options)]
            p['developmentReason']=f"需求未达开工门槛（缺口至少 {policy['minimumProjectUnits']} 或占目标 {policy['minimumDevelopmentDemand']:.0%}）；"+'；'.join(rows)
            if exclusions[p['id']]:p['developmentReason']+='；'+'；'.join(sorted(exclusions[p['id']]))
    city.s['housingDemand']=dict(waiting=city.s['pendingHousing'],target=round(targets['residential'],1),
        completed=sum(p['building']['capacity'] for p in city.s['parcels'] if p.get('building') and p['building']['use']=='residential' and p['building']['status'] not in ('planned','construction')),
        planned=round(full_supply['residential'],1),effective=round(supply['residential'],1),
        constructionCredit=1.,month=city.s['month'],started=started,projectLimit=max_projects,**housing_market.summary())
    for p in city.s['parcels']:
        p['localHousingDemand']=housing_market.gap(p)
        p['localBusinessDemand']={u:round(business_market.gap(p,u),2) for u in business_market.needs}
    if geometry_changed:
        # Assembled lots remove frontage cuts from the network. Rebuild now,
        # not only on restore, so live and reloaded routing use identical edges.
        city.rebuild()
    return demand
