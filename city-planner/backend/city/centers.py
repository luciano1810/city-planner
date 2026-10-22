"""Continuous activity field; center labels summarize it and never gate demand."""
import math
from collections import Counter
from .geometry import stable_id


def activity_groups(mass, field, kernel):
    """Group strong travel links relative to the network's own background.

    Isolated activity retains its own weight. Nearby homes and workplaces can
    share a center without treating every building entrance as a density peak.
    This partition is only for reporting; the continuous field is unchanged.
    """
    nodes=sorted(mass);weights={pid:{} for pid in nodes};nearest=Counter()
    for i,pid in enumerate(nodes):
        for q in nodes[i+1:]:
            affinity=math.sqrt(kernel(pid,q)*kernel(q,pid))
            nearest[pid]=max(nearest[pid],affinity);nearest[q]=max(nearest[q],affinity)
            if affinity:
                weights[pid][q]=weights[q][pid]=math.sqrt(mass[pid]*mass[q])*affinity
    degree={pid:sum(weights[pid].values())+mass[pid]*(1-nearest[pid]) for pid in nodes}
    total=sum(degree.values());labels={pid:pid for pid in nodes};sizes=dict(degree)
    if total:
        changed=True
        while changed:
            changed=False
            for pid in nodes:
                old=labels[pid];sizes[old]-=degree[pid]
                links=Counter()
                for q,weight in weights[pid].items():links[labels[q]]+=weight
                def score(label):return links[label]-degree[pid]*sizes.get(label,0)/total
                best=max(set(links)|{old},key=lambda label:(score(label),label))
                if score(best)>score(old)+1e-12:
                    labels[pid]=best;changed=True
                sizes[labels[pid]]=sizes.get(labels[pid],0)+degree[pid]
    groups={}
    for pid in nodes:groups.setdefault(labels[pid],[]).append(pid)
    return {max(members,key=lambda pid:(field[pid],pid)):members for members in groups.values()}


def evolve_centers(city, eligible, built):
    policy=city.s['policy'];month=city.s['month'];old=city.s['growthCenters']
    residents=Counter();workers=Counter()
    ready={p['id']:p for p in built if p.get('connected') and p['building']['status']=='active'}
    for h in city.s['households']:
        if h['home'] in ready:residents[h['home']]+=h['size']
        if h.get('job') in ready:workers[h['job']]+=1
    activity={pid:workers[pid]+residents[pid]*.3 for pid in sorted(ready) if workers[pid]+residents[pid]>0}
    paths={pid:city.distances(pid,'walk')[0] for pid in activity}
    speed=policy['walkingMetersPerMinute'];scale=policy['growthCenterActivityScale']
    # Network Gaussian kernels have no on/off radius. A compact built area
    # widens its field gradually; all actual activity contributes from day one.
    base=policy['businessCoreRadius'];maximum=max(base,policy['businessCoreMaximumRadius'])
    radii={}
    for pid in activity:
        area=sum(p['area']*math.exp(-.5*(paths[pid].get(p['id'],math.inf)*speed/maximum)**2)
                 for p in ready.values() if p['building']['use'] in ('residential','commercial','office'))
        radii[pid]=min(maximum,math.sqrt(base**2+area*policy['businessCoreGrowthFactor']/math.pi))
    def kernel(pid,target):return math.exp(-.5*(paths[pid].get(target,math.inf)*speed/radii[pid])**2)
    field={p['id']:sum(value*kernel(pid,p['id']) for pid,value in activity.items()) for p in city.s['parcels']}
    for p in city.s['parcels']:
        value=field[p['id']]
        p['activityCore']=value/(value+scale)
    seed=next((c for c in old if c['source']!='local-activity'),None)
    seed_parcel=next((p for p in eligible if seed and p['id']==seed['parcel']),None)
    if seed and not seed_parcel and eligible:
        seed_parcel=min(eligible,key=lambda p:(math.dist(p['center'],seed['point']),p['id']))
    nodes=dict(activity)
    if seed_parcel:
        pid=seed_parcel['id'];nodes.setdefault(pid,min(activity.values(),default=1.))
        paths.setdefault(pid,city.distances(pid,'walk')[0]);radii.setdefault(pid,base)
    groups=activity_groups(nodes,field,kernel)
    centers=[];origins={};owners={};claimed=set()
    for peak,members in sorted(groups.items()):
        anchored=seed_parcel and seed_parcel['id'] in members
        history=seed if anchored else max((c for c in old if c['source']=='local-activity' and c.get('id') not in claimed),
            key=lambda c:len(set(c.get('parcels',[c['parcel']])).intersection(members)),default=None)
        if history and not anchored and not set(history.get('parcels',[history['parcel']])).intersection(members):history=None
        if not sum(activity.get(pid,0) for pid in members) and not anchored:continue
        point=city.parcelmap[peak]['center']
        c=dict(history) if history else dict(point=point[:],parcel=peak,source='local-activity',formed=month)
        if not anchored:c.update(point=point[:],parcel=peak)
        c.setdefault('id',stable_id('center-',(c['parcel'],c['formed'])))
        claimed.add(c['id'])
        c.update(parcels=sorted(members),population=sum(residents[pid] for pid in members),
                 employment=sum(workers[pid] for pid in members),activeBuildings=sum(pid in ready for pid in members))
        c['activity']=c['employment']+c['population']*.3
        c['strength']=c['activity']/(c['activity']+scale)
        if anchored:
            c['startupPeakBuildings']=max(c.get('startupPeakBuildings',0),len(built))
        centers.append(c);origins[c['id']]=paths[seed_parcel['id'] if anchored else peak]
        for pid in members:owners[pid]=c['id']
    # No formation timer, delayed promotion, or incumbent bonus in ranking.
    ordered=sorted(centers,key=lambda c:(-c['activity'],c['id']))
    for rank,c in enumerate(ordered,1):c['rank']=rank
    if ordered:city.s['primaryGrowthCenter']=ordered[0]['id']
    else:city.s.pop('primaryGrowthCenter',None)
    # Preserve original seed ordering for startup history and older clients.
    centers.sort(key=lambda c:(c['source']=='local-activity',c['id']))
    old[:]=centers
    city.s.pop('growthCenterCandidates',None);city.s.pop('growthCenterLeadership',None)
    for p in city.s['parcels']:
        p['growthCenter']=owners.get(p['id'])
    return origins
