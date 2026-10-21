"""Explicit external rail passenger terminals and capacity-limited freight."""
import math
from collections import Counter
from .routing import shortest_paths,reconstruct


def rebuild_regional(city,rails,drive):
    stops={s['id']:s for s in city.s['stops']}
    for service in city.s['regionalServices']:
        service.update(valid=False,reason='',paths=[],operatingCost=0)
        service.setdefault('tonnes',0)
        a=stops.get(service['start']);b=stops.get(service['end'])
        if not a or not b or a.get('role')!='freight' or b.get('role')!='freight' or not b.get('external'):
            service['reason']='需要本地货场和区域边界货场';continue
        aa=city.network['stops'].get(a['id']);bb=city.network['stops'].get(b['id'])
        if not aa or not bb or not aa.get('access') or not a.get('enabled',True) or not b.get('enabled',True) or not service['enabled']:
            service['reason']='货场关闭、未接路或缺少轨道';continue
        distances,prev=shortest_paths(rails['train'],aa['node'])
        if bb['node'] not in distances:
            service['reason']='货运铁路中断';continue
        path=reconstruct(prev,aa['node'],bb['node']);length=sum(e.get('length',0) for e in path)
        service.update(valid=True,minutes=distances[bb['node']]+city.s['policy']['freightHandlingMinutes'],length=length,
            dailyCapacity=service['trainsPerDay']*service['tonnesPerTrain'],paths=city.path_points(path),
            operatingCost=round(service['trainsPerDay']*(length/1000*55+1200)*30),access=aa['access']['node'])


def assign_regional_passengers(city,trips,boardings,stop_board,stop_alight):
    terminals=[s for s in city.s['stops'] if s.get('external') and s.get('role','passenger')=='passenger' and s.get('enabled',True)]
    flows=[]
    if not terminals:return flows
    for index,h in enumerate(city.s['households']):
        if index%city.s['policy']['regionalPassengerHouseholds']!=0:continue
        home=city.parcelmap[h['home']]
        for terminal in terminals:
            for source,target,period,departure in [(h['home'],terminal['id'],'off',660),(terminal['id'],h['home'],'off',1020)]:
                route=city.route(source,target,False,h['income'],True,period,departure,required_mode='train')
                if not route or route['mode']!='public' or not any(e.get('mode')=='train' for e in route['path'] if e['kind']=='ride'):continue
                item=dict(source=source,target=target,purpose='regional',period=period,people=1,completed=True,**{k:v for k,v in route.items() if k!='path'})
                trips.append(item)
                for e in route['path']:
                    if e['kind']=='board':boardings[e['ref']]+=1;stop_board[e['origin']]+=1
                    if e['kind']=='alight':stop_alight[e['to']]+=1
                flows.append(dict(kind='passenger',source=home['center'] if source==h['home'] else terminal['point'],target=terminal['point'] if target==terminal['id'] else home['center'],people=1))
                h['transportCost']+=route['fee']*city.s['policy']['workingDaysPerMonth']
            break
    return flows


def assign_freight(city):
    trips=0;vehicle_km=0.;rail_tonnes=0.;unserved=0.;flows=[];used=Counter()
    for p in city.s['parcels']:
        b=p.get('building')
        if not b or b['use'] not in ('industrial','warehouse') or b['status']!='active':continue
        tonnes=max(1,b.get('employees',0)*city.s['policy']['freightTonnesPerWorker'])
        distances,prev=city.distances(p['id'],'car');options=[]
        if city.gateway_node in distances:options.append((distances[city.gateway_node]+city.s['policy']['externalRoadMinutes'],None,city.gateway_node))
        for service in city.s['regionalServices']:
            if service.get('valid') and service['access'] in distances and used[service['id']]<service['dailyCapacity']:
                options.append((distances[service['access']]+service['minutes'],service,service['access']))
        if not options:unserved+=tonnes;continue
        options.sort(key=lambda row:(row[0],row[1]['id'] if row[1] else ''))
        remaining=tonnes
        for _,service,target in options:
            count=min(remaining,service['dailyCapacity']-used[service['id']]) if service else remaining
            if count<=0:continue
            if service:used[service['id']]+=count;rail_tonnes+=count
            truck_count=max(1,math.ceil(count/city.s['policy']['truckTonnes']))
            path=reconstruct(prev,p['id'],target)
            trips+=truck_count*2;vehicle_km+=sum(e.get('length',0) for e in path)*truck_count*2/1000
            for source,destination,period in [(p['id'],target,'am'),(target,p['id'],'pm')]:
                dist,back=city.distances(source,'car')
                if destination not in dist:continue
                for edge in reconstruct(back,source,destination):
                    if edge.get('ref'):city.road_load[(period,edge['ref'])]+=truck_count*2
            flows.append(dict(kind='freight',source=p['center'],target=city.network['nodes'][target],tonnes=round(count,2),mode='train' if service else 'road',service=service['id'] if service else None))
            remaining-=count
            if remaining<=0:break
        unserved+=remaining
    for service in city.s['regionalServices']:service['tonnes']=round(used[service['id']],2)
    city.s['regionalFreight']=dict(tonnes=round(rail_tonnes,2),unserved=round(unserved,2))
    return trips,vehicle_km,flows
