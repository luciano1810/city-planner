"""Transactional clearance for manually built roads, followed by resettlement."""
import math
from collections import Counter
from shapely.geometry import Polygon
from . import special_buildings, renewal, housing


def clear(city, occupied, kind, level):
    result=dict(parcels=[],facilities=[],households=[],origins={},cost=0,projects=[])
    if level!=0:return result
    facilities=[]
    for f in city.s['facilities']:
        if not f.get('points') or f['kind'] in ('park','plaza','parking_lot'):continue
        hit=occupied.intersection(Polygon(f['points']))
        if hit.area<=.1:continue
        if f['kind']=='train_station' and kind in ('train','metro') and Polygon(f['railCorridor']).buffer(.2).covers(hit):continue
        facilities.append(f)
    facility_ids={f['id'] for f in facilities}
    projects=set();sources=[]
    for p in city.s['parcels']:
        if occupied.intersection(Polygon(p['points'])).area<=1:continue
        if p['use']=='protected' or (p.get('openSpace') and p['openSpace'] not in facility_ids):
            raise ValueError('道路与公共开放空间或保护用地冲突')
        if renewal.locked(city,p):projects.add(p['renewalProject'])
        if p.get('building') and occupied.intersection(Polygon(p['building']['footprint'])).area>1:sources.append(p)
    ids={p['id'] for p in sources}
    result.update(parcels=sorted(ids),facilities=sorted(facility_ids),
                  households=[h for h in city.s['households'] if h['home'] in ids],
                  origins={p['id']:p['center'][:] for p in sources},projects=sorted(projects))
    result['cost']=round((sum(p['building'].get('cost',0) for p in sources)+sum(f.get('cost',0) for f in facilities))*city.s['policy']['roadDemolitionCostShare'])
    if result['cost']:city.spend(result['cost'],'道路拆迁')
    # Roadworks supersede affected renewal reservations. Existing buildings in
    # unaffected phases stay, and already erected construction can still finish.
    for project in city.s['renewals']:
        if project['id'] not in projects:continue
        project.update(status='cancelled',ended=city.s['month'],reason='手动道路工程取消后续更新与用地预留')
        for phase in project['phases']:
            if phase['status']!='complete':phase['status']='cancelled'
        for p in city.s['parcels']:
            if p.get('renewalProject')==project['id']:p.pop('renewalProject',None)
    for f in facilities:special_buildings.remove(city,f['id'])
    city.s['facilities']=[f for f in city.s['facilities'] if f['id'] not in facility_ids]
    for p in city.s['parcels']:
        if p.get('openSpace') in facility_ids:p.pop('openSpace',None)
    city.s['households']=[h for h in city.s['households'] if h['home'] not in ids]
    # Remove the old parcel too, so block land and explicit zoning cannot
    # preserve a demolished footprint across the new road during regeneration.
    city.s['parcels']=[p for p in city.s['parcels'] if p['id'] not in ids]
    return result


def summary(result):
    return dict(buildings=len(result['parcels']),facilities=len(result['facilities']),
                households=len(result['households']),people=sum(h['size'] for h in result['households']),
                cost=result['cost'],cancelledProjects=len(result['projects']))


def resettle(city, result):
    """Use the rebuilt network and exclude every demolished site as a target."""
    if not result['parcels'] and not result['facilities'] and not result['projects']:return
    ids=set(result['parcels']);families=city.s['households']+result['households']
    occupied={f['parcel'] for f in city.s['firms'] if f['status']=='active' and f['parcel'] not in ids}
    workers=Counter(h.get('job') for h in families)
    moved_firms=closed_firms=0
    for firm in city.s['firms']:
        if firm['status']!='active' or firm['parcel'] not in ids:continue
        old=firm['parcel']
        choices=[p for p in city.s['parcels'] if p.get('connected') and p['id'] not in occupied
                 and not workers[p['id']] and not renewal.locked(city,p) and p.get('building')
                 and p['building']['status'] in ('active','vacant') and p['building']['use']==firm['industry']
                 and p['building']['capacity']>=workers[old]]
        if choices:
            target=min(choices,key=lambda p:(math.dist(p['center'],result['origins'][old]),p['rent'],p['id']))
            firm.update(parcel=target['id'],relocations=firm.get('relocations',0)+1,lossMonths=0)
            target['building'].update(status='active',businessActive=True,positions=max(target['building'].get('positions',0),workers[old]))
            occupied.add(target['id']);moved_firms+=1
            for h in families:
                if h.get('job')==old:h['job']=target['id']
        else:firm.update(status='closed',closed=city.s['month']);closed_firms+=1
    for h in families:
        if h.get('job') in ids:h.update(job=None,commute=None,commuteFailed=False)
    homes=city.available_homes();occupancy=Counter(h['home'] for h in city.s['households'])
    travel=housing.commutes(city);relocated=departed=0
    queue=housing.ensure_queue(city)
    for h in sorted(result['households'],key=lambda h:(h['income'],h['id'])):
        origin=result['origins'][h['home']]
        choices=[p for p in homes if occupancy[p['id']]<p['building']['capacity']
                 and not renewal.locked(city,p) and housing.affordable(city,p['rent'],h['income'])
                 and (not h.get('job') or travel.minutes(p['id'],h['job'],h['car'])<=min(city.s['policy']['housingCommuteMinutes'],city.s['policy']['workMaximumMinutes']))]
        if choices:
            target=min(choices,key=lambda p:(math.dist(p['center'],origin),p['rent'],p['id']))
            occupancy[target['id']]+=1;target['building']['status']='active'
            h.update(home=target['id'],stress=0,commute=None,commuteFailed=False,
                     burden=target['rent']*city.s['policy']['householdSpace']/h['income'])
            city.s['households'].append(h);city.s['relocated']+=h['size'];relocated+=h['size']
            endpoint=target['center'];flow='relocation'
        else:
            city.s['movedOut']+=h['size'];departed+=h['size'];flow='out';endpoint=city.s['gateway'] or [0,0]
            queue.append(dict(income=h['income'],car=h['car'],count=1));city.s['pendingHousing']+=1
        city.s['migrationFlows'].append(dict(source=origin,target=endpoint,kind=flow,people=h['size']))
    homes_now=Counter(h['home'] for h in city.s['households'])
    jobs_now=Counter(h.get('job') for h in city.s['households'])
    for p in city.s['parcels']:
        b=p.get('building')
        if b:
            b['occupied']=homes_now[p['id']] if b['use']=='residential' else jobs_now[p['id']]
            if b['use']!='residential':b['employees']=jobs_now[p['id']]
    if ids or result['facilities'] or result['projects']:
        report=dict(summary(result),relocated=relocated,movedOut=departed,firmsRelocated=moved_firms,firmsClosed=closed_firms)
        city.s['lastRoadClearance']=report
        city.event('拆迁',f"道路工程拆除 {len(ids)} 栋建筑及 {len(result['facilities'])} 处设施；{relocated} 人城内搬迁、{departed} 人迁出并登记等待迁回；企业搬迁 {moved_firms} 家、关闭 {closed_firms} 家")
