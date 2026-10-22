"""One passenger service graph for metro, train and through-running services."""
import copy
import math
import re
from collections import defaultdict, Counter
from . import rail_infrastructure as infra
from .routing import shortest_paths, reconstruct
from . import construction

RULES_SPEED = infra.RULES['walkingSpeed']

VEHICLES = {
    'urban': dict(name='通用市域列车',carCapacity=150,carLength=20.,speed=100.,vehicleCost=6500,kmCost=18),
    'regional': dict(name='通用城际列车',carCapacity=110,carLength=24.,speed=140.,vehicleCost=8500,kmCost=22),
}


def configure(line,command):
    from .engine import number, text
    line['railService']=True
    for key in ('name','color','vehicleType','formation','assignedFleet','headway','hours','startHour','dwell','speed','enabled','servicePattern','platforms','stopPattern','via'):
        if key in command: line[key]=copy.deepcopy(command[key])
    line.setdefault('vehicleType','urban');line.setdefault('formation',4)
    line.setdefault('servicePattern','oneway' if line.get('oneway') else 'shuttle')
    line.setdefault('platforms',{});line.setdefault('stopPattern',{});line.setdefault('via',{})
    line['name']=text(line['name'])
    if not re.fullmatch(r'#[\da-fA-F]{6}',str(line.get('color','#397e76'))):raise ValueError('线路颜色格式错误')
    if line['vehicleType'] not in VEHICLES: raise ValueError('请选择有效铁路车型')
    line['formation']=number(line['formation'],1,12,'编组节数',True)
    if line.get('assignedFleet') is not None: line['assignedFleet']=number(line['assignedFleet'],1,100,'列车数量',True)
    for key,lo,hi in [('headway',1,120),('hours',.25,24),('startHour',0,23+59/60),('dwell',.1,10),('speed',5,180)]:
        line[key]=number(line[key],lo,hi,key)
    if line['servicePattern'] not in ('shuttle','loop','loop_reverse','loop_both','oneway'):raise ValueError('请选择往返、环线或有回送的单向服务')
    for field in ('platforms','stopPattern','via'):
        if not isinstance(line[field],dict) or any(k not in line['stops'] for k in line[field]):raise ValueError('站台、停站或途经设置引用了线路外站点')
    if any(type(v) is not bool for v in line['stopPattern'].values()):raise ValueError('停站状态必须为布尔值')
    line['capacity']=VEHICLES[line['vehicleType']]['carCapacity']*line['formation']
    line['trainLength']=VEHICLES[line['vehicleType']]['carLength']*line['formation']
    line['oneway']=line['servicePattern'] in ('loop','loop_reverse','oneway')


def prepare_line(city,line,graph):
    stops={s['id']:s for s in city.s['stops']}; chosen={};nodes={}
    line.update(valid=False,reason='',paths=[],fleet=0,operatingCost=0,length=0,cycle=0,breakPoints=[],shared=[],serviceHeadway=line['headway'])
    ids=line['stops']
    if len(ids)<2 or len(ids)!=len(set(ids)):raise ValueError('需要至少两个不同车站')
    for sid in ids:
        s=stops.get(sid)
        if not s or not infra.rail_stop(s) or not s.get('enabled',True): raise ValueError(f'车站 {sid} 已删除、关闭或不是客运站')
        if s.get('railStation'):
            pid=line['platforms'].get(sid)
            p=next((p for p in s['platforms'] if p['id']==pid),None) if pid else next((p for p in s['platforms'] if p['connected']),s['platforms'][0])
            if not p:raise ValueError(f"{s['name']}：所选站台不存在")
            line['platforms'][sid]=p['id'];chosen[sid]=p
            if not p['connected']:raise ValueError(f"{s['name']} {p['number']} 号站台待接轨")
            if line['stopPattern'].get(sid,True) and p['length']<line['trainLength']:raise ValueError(f"{s['name']} {p['number']} 号站台长 {p['length']:g} m，短于列车 {line['trainLength']:g} m")
            att=city.network['stops'].get(p['id'])
        else:
            # Legacy point stations explicitly retain their historical turnback.
            chosen[sid]=dict(id=sid,turnback=True,length=360)
            att=city.network['stops'].get(sid)
        if not att:raise ValueError(f"{s['name']}：轨道连接缺失")
        nodes[sid]=att['node']
    pattern=line['servicePattern'];loop=pattern.startswith('loop')
    if not loop:
        if any(line['stopPattern'].get(s,True) is False for s in (ids[0],ids[-1])):raise ValueError('开放式线路两端必须停靠')
        for sid in (ids[0],ids[-1]):
            if not chosen[sid].get('turnback'):raise ValueError(f"{stops[sid]['name']} {chosen[sid].get('number','')} 号站台缺少折返设施")
    if not line['stopPattern'].get(ids[0],True):raise ValueError('首站必须停靠，以便投入列车')
    if sum(line['stopPattern'].get(s,True) for s in ids)<2:raise ValueError('线路至少需要两个实际停靠站')
    if loop:
        orders=[ids+[ids[0]]]
        if pattern=='loop_reverse': orders=[[ids[0]]+list(reversed(ids[1:]))+[ids[0]]]
        if pattern=='loop_both':orders.append([ids[0]]+list(reversed(ids[1:]))+[ids[0]])
    else: orders=[ids,list(reversed(ids))]
    plans=[];roads={r['id']:r for r in city.s['roads']}
    for direction,order in enumerate(orders):
        segments=[]; all_edges=[]
        calls_at=[i for i,sid in enumerate(order) if line['stopPattern'].get(sid,True)]
        for index,(first,last) in enumerate(zip(calls_at,calls_at[1:])):
            a,b=order[first],order[last]
            path=[];source=nodes[a]
            via=line.get('via',{}).get(a,[]) if direction==0 else []
            if not isinstance(via,list) or len(via)>20:raise ValueError('途经节点最多 20 个')
            waypoints=[];bypass_platforms=set()
            for sid in order[first+1:last]:
                bypass=next((r for r in roads.values() if r.get('bypassFor')==chosen[sid]['id']),None)
                if bypass:
                    bypass_platforms.add(chosen[sid]['id'])
                    edges=[e for e in city.network['edges'] if e['road']==bypass['id']]
                    if edges:
                        # Visit the centre of a real bypass edge; direction is
                        # chosen by the directed rail graph, never a drawn chord.
                        waypoints.extend([edges[0]['a'],edges[-1]['b']] if direction==0 else [edges[-1]['b'],edges[0]['a']])
                else:waypoints.append(nodes[sid])
            for target in [*via,*waypoints,nodes[b]]:
                if target==source:continue
                if target not in city.network['nodes']:raise ValueError(f"{stops[a]['name']}：途经节点不存在")
                def weight(e,_):
                    r=roads[city.edge_map[e['ref']]['road']]
                    if loop and (e['ref'] in all_edges or r.get('platform') in {chosen[sid]['id'] for sid in ids if sid not in order[first:last+1]}):return None
                    if line['trainLength']>r.get('maxTrainLength',360) or r.get('platform') in bypass_platforms:return None
                    return e['time']
                d,prev=shortest_paths(graph,source,target,weight)
                part=reconstruct(prev,source,target) if target in d else None
                if not part:raise ValueError(('环线缺少不重复的闭合进路；' if loop else '')+f"{stops[a]['name']} → {stops[b]['name']}：断轨、道岔缺失、方向或列车限界不兼容")
                path.extend(part);source=target
            distance=sum(e['length'] for e in path)
            run=sum(max(e['time'],e['length']/1000/min(line['speed'],VEHICLES[line['vehicleType']]['speed'])*60) for e in path)
            calls=line['stopPattern'].get(b,True) and not(pattern=='oneway' and direction==1)
            key=f"{line['id']}:{direction}:{index}"
            segment=dict(key=key,a=a,b=b,direction=direction,time=run+(line['dwell'] if calls else 0),runMinutes=run,
                         path=path,length=distance,capacity=1,load=0.,mode=line['mode'],calls=calls,
                         platformA=chosen[a]['id'],platformB=chosen[b]['id'],deadhead=pattern=='oneway' and direction==1)
            segment.update(turnbackA=not loop and a in (ids[0],ids[-1]),turnbackB=not loop and b in (ids[0],ids[-1]))
            annotate_platforms(city,segment)
            segments.append(segment);all_edges.extend(e['ref'] for e in path)
        if loop and len(set(all_edges))!=len(all_edges):raise ValueError('环线必须沿真实闭合轨道运行，不能原路往返伪装闭环')
        plans.append(segments)
    segments=[seg for plan in plans for seg in plan]
    line['cycle']=sum(s['time'] for s in segments)+(0 if loop else 2*infra.RULES['turnbackSeconds']/60)
    line['length']=sum(s['length'] for s in plans[0])
    line['fleet']=line.get('assignedFleet') or max(len(plans) if loop else 1,math.ceil(line['cycle']/line['headway']))
    if pattern=='loop_both' and line['fleet']<2:raise ValueError('双向环线至少需要两列车')
    line['requestedHeadway']=max(.5,line['cycle']/line['fleet']) if line.get('assignedFleet') else line['headway']
    line['serviceHeadway']=line['requestedHeadway']
    line['serviceType']='through' if len({stops[s]['mode'] for s in ids})>1 else stops[ids[0]]['mode']
    line['routePlans']=plans
    line['valid']=True
    if not line['enabled']:line['valid']=False;line['reason']='已停运'
    return segments


def annotate_platforms(city,seg):
    """A physical platform face is independent of a service's stop ordering."""
    for suffix,items in [('A',seg['path']),('B',reversed(seg['path']))]:
        pid=seg['platform'+suffix]
        for item in items:
            edge=city.edge_map.get(item['ref'])
            road=next((r for r in city.s['roads'] if edge and r['id']==edge['road']),None)
            if road and road.get('platform')==pid:
                seg['platformFace'+suffix]=0 if item['origin']==edge['a'] else 1
                break
        seg.setdefault('platformFace'+suffix,seg['direction'])


def resources(city,seg):
    """Physical blocks and every traversed platform, including skipped stops."""
    result={};platforms={};facilities=city.s['railInfrastructure']['facilities']
    road_map={r['id']:r for r in city.s['roads']}
    ratio=seg['runMinutes']/max(1e-9,sum(e['time'] for e in seg['path']))
    for item in seg['path']:
        edge=city.edge_map.get(item['ref'])
        if edge is None:continue
        sign=0 if item['origin']==edge['a'] else 1
        resource=f"block:{edge['road']}:{sign}"
        result[resource]=result.get(resource,0)+max(item['time']*ratio*60,1)
        pid=road_map[edge['road']].get('platform')
        if pid:platforms[f'platform:{pid}:{sign}']=infra.RULES['safeSeconds']
        for f in facilities:
            if f['kind']=='switch' and f['level']==edge['level'] and any(math.dist(f['point'],p)<.1 for p in (edge['points'][0],edge['points'][-1])):
                result['switch:'+f['id']]=infra.RULES['safeSeconds']
    for key in result:
        if key.startswith('block:'):result[key]+=infra.RULES['safeSeconds']
    result.update(platforms)
    result[f"platform:{seg['platformB']}:{seg.get('platformFaceB',seg['direction'])}"]=infra.RULES['safeSeconds']+(seg['time']-seg['runMinutes'])*60
    for suffix in ('A','B'):
        if seg.get('turnback'+suffix):result['turnback:'+seg['platform'+suffix]]=infra.RULES['turnbackSeconds']+infra.RULES['safeSeconds']
    return result


def build(city,public,graph):
    all_segments={};uses=defaultdict(dict);line_map={}
    for line in city.s['lines']:
        if line['mode'] not in ('metro','train'): continue
        try:
            configure(line,{})
            segments=prepare_line(city,line,graph)
            if not line['valid']:continue
        except (ValueError,KeyError) as error:
            line.update(valid=False,reason=str(error),paths=[],fleet=0,operatingCost=0,routePlans=[])
            continue
        line_map[line['id']]=line
        for seg in segments:
            all_segments[seg['key']]=seg
            for key,seconds in resources(city,seg).items():
                uses[key][line['id']]=uses[key].get(line['id'],0)+seconds
    # Proportional, deterministic fair sharing. Reservations below enforce the
    # same resources on individual trains, independently of render sampling.
    for key,demand in uses.items():
        ratio=sum(seconds/(line_map[lid]['requestedHeadway']*60) for lid,seconds in demand.items())
        for lid,seconds in demand.items():
            line=line_map[lid]
            line['serviceHeadway']=max(line['serviceHeadway'],line['requestedHeadway']*max(1,ratio))
            if len(demand)>1 or ratio>1:
                line['shared'].append(dict(resource=key,lines=sorted(demand),utilization=ratio,reason='共享区间 / 道岔 / 站台安全间隔' if ratio>1 else '共同占用'))
    for lid,line in line_map.items():
        cfg=VEHICLES[line['vehicleType']]
        line['plannedTrainsPerHour']=60/line['requestedHeadway'];line['actualTrainsPerHour']=60/line['serviceHeadway']
        line['operatingCost']=line['fleet']*cfg['vehicleCost']*line['formation']+sum(s['length'] for s in all_segments.values() if s['key'].startswith(lid+':'))/1000*60/line['serviceHeadway']*line['hours']*cfg['kmCost']*30
        for seg in (s for s in all_segments.values() if s['key'].startswith(lid+':')):
            seg['capacity']=line['capacity']*120/line['serviceHeadway']
            seg['resources']=resources(city,seg)
            city.line_segments[seg['key']]=seg
            points=city.path_points(seg['path']);seg['points']=points
            line['paths'].append(dict(key=seg['key'],points=points,direction=seg['direction'],deadhead=seg['deadhead']))
            if seg['deadhead']:continue
            a=f"{lid}:{seg['direction']}:{seg['a']}";b=f"{lid}:{seg['direction']}:{seg['b']}"
            city.add(public,a,b,seg['time'],'ride',lid,segment=seg['key'],mode=line['mode'],length=seg['length'])
        for direction in range(len(line['routePlans'])):
            if line['servicePattern']=='oneway' and direction==1:continue
            for sid in line['stops']:
                if not line['stopPattern'].get(sid,True):continue
                node=f'{lid}:{direction}:{sid}'
                station=next(s for s in city.s['stops'] if s['id']==sid)
                platform=next((p for p in station.get('platforms',[]) if p['id']==line['platforms'].get(sid)),None)
                hall=math.dist(station['point'],platform['point'])/RULES_SPEED if platform else 0
                city.add(public,sid,node,line['serviceHeadway']/2+city.s['policy']['boardingMinutes']+hall,'board',lid,mode=line['mode'],direction=direction)
                city.add(public,node,sid,city.s['policy']['alightingMinutes']+hall,'alight',lid,mode=line['mode'],direction=direction)


def preview(city,cmd):
    from .engine import text
    # Rebuild only a temporary line, never the live service or treasury.
    line=dict(id=cmd.get('id','draft'),name=cmd.get('name') or '新铁路线路',mode=cmd.get('mode','metro'),stops=cmd.get('stops',[]),
              headway=10,hours=16,startHour=6,dwell=.6,speed=100,enabled=True,color='#397e76')
    existing=next((l for l in city.s['lines'] if l['id']==cmd.get('id')),None)
    if existing: line=copy.deepcopy(existing);line.update(stops=cmd.get('stops',line['stops']))
    try:
        configure(line,cmd)
        segments=prepare_line(city,line,city.rail_graph)
        return dict(valid=True,line=line,paths=[dict(points=city.path_points(s['path']),direction=s['direction']) for s in segments],minutes=line['cycle'],platforms=line['platforms'])
    except (ValueError,KeyError,TypeError) as error:return dict(valid=False,reason=str(error),paths=[])


def record(city,trips):
    profiles={l['id']:dict(hourly=[0]*24,stops={s:dict(boardings=0,alightings=0,purposes={},directions={},destinations={}) for s in l['stops']}) for l in city.s['lines'] if l['mode'] in ('train','metro')}
    for t in trips:
        for call in t.get('transitCalls',[]):
            data=profiles.get(call['line'])
            if not data or call['stop'] not in data['stops']:continue
            s=data['stops'][call['stop']];n=t.get('people',1);kind='boardings' if call['kind']=='board' else 'alightings'
            s[kind]+=n;s['purposes'][t['purpose']]=s['purposes'].get(t['purpose'],0)+n
            direction=s['directions'].setdefault(str(call.get('direction',0)),dict(boardings=0,alightings=0));direction[kind]+=n
            if kind=='boardings':
                data['hourly'][int(call['minute']//60)%24]+=n
                target=t.get('target');s['destinations'][target]=s['destinations'].get(target,0)+n
    date=construction.date_string(construction.day(city))
    for line in city.s['lines']:
        if line['id'] not in profiles:continue
        line['demandProfile']=profiles[line['id']];line['demandDate']=date
        row=dict(date=date,boardings=line.get('boardings',0),load=line.get('load',0),fleet=line.get('fleet',0),headway=line['serviceHeadway'])
        line['demandHistory']=([r for r in line.get('demandHistory',[]) if r['date']<date]+[row])[-366:]


def details(city,identity=None):
    from . import rail_runtime
    runtime=rail_runtime.ensure(city)
    line=next((l for l in city.s['lines'] if l['id']==identity and l['mode'] in ('metro','train')),None)
    stops={s['id']:s for s in city.s['stops']};population=Counter()
    for h in city.s['households']:population[h['home']]+=h['size']
    rows=[]
    for sid in line['stops'] if line else [s['id'] for s in city.s['stops'] if infra.rail_stop(s)]:
        if sid not in stops:continue
        s=copy.deepcopy(stops[sid]);dist=city.distances(sid,'walk')[0]
        s['residents']=sum(n for pid,n in population.items() if dist.get(pid,math.inf)<=5)
        s['jobs']=sum(p['building'].get('positions',0) for p in city.s['parcels'] if p.get('building') and p['building']['status']=='active' and dist.get(p['id'],math.inf)<=5)
        s['waiting']=sum(p['people'] for p in runtime['passengers'] if p['state']=='waiting' and p['legs'][p['leg']]['from']==sid)
        s['waitingMinutes']=max((max(0,runtime['clock']-p['ready'])/60 for p in runtime['passengers'] if p['state']=='waiting' and p['legs'][p['leg']]['from']==sid),default=0)
        s['actual']=copy.deepcopy(runtime['totals'].get('station:'+sid))
        s['lines']=[l['id'] for l in city.s['lines'] if sid in l['stops']]
        destinations=Counter()
        for l in city.s['lines']:destinations.update(l.get('demandProfile',{}).get('stops',{}).get(sid,{}).get('destinations',{}))
        s['destinations']=[dict(id=pid,name=city.parcelmap.get(pid,{}).get('building',{}).get('name',city.parcelmap.get(pid,{}).get('name',pid)),people=n) for pid,n in destinations.most_common(5)]
        if s.get('railStation') and s['level']==-1:
            from shapely.geometry import Polygon
            footprint=Polygon(s['footprint'])
            s['candidateBuildings']=[dict(id=p['id'],name=p['building'].get('name',p['id'])) for p in city.s['parcels'] if p.get('building') and footprint.intersects(Polygon(p['building']['footprint'])) and not any(e.get('building')==p['id'] for e in s['entrances'])]
        s['potentialRule']='真实步行路径 5 分钟覆盖；不可直接相加为客流'
        rows.append(s)
    infrastructure=copy.deepcopy(city.s['railInfrastructure'])
    for group in infrastructure['groups']:
        group['actual']={kind:sum(runtime['totals'].get('station:'+sid,{}).get(kind,0) for sid in group['stations']) for kind in ('entry','exit','transfer','board','alight','unmet')}
        group['sampled']=any('station:'+sid in runtime['totals'] for sid in group['stations'])
        group['waiting']=sum(p['people'] for p in runtime['passengers'] if p['state']=='waiting' and p['legs'][p['leg']]['from'] in group['stations'])
    return copy.deepcopy(dict(line=line,lines=[l for l in city.s['lines'] if l['mode'] in ('train','metro')],stops=rows,vehicles=VEHICLES,rules=infra.RULES,
        infrastructure=infrastructure,runtime=rail_runtime.view(city),
        rule='实际人数与累计人次来自确定性列车和乘客事件；典型日估算单独保存。未模拟站内总人数。每个编号站台含双向股道；区间采用保守闭塞。'))


def operating_signature(line):
    return (tuple(line.get(k) for k in ('vehicleType','formation','assignedFleet','headway','hours','startHour','dwell','speed','servicePattern')),
            tuple((s,line.get('platforms',{}).get(s,s),line.get('stopPattern',{}).get(s,True),tuple(line.get('via',{}).get(s,[]))) for s in line['stops']))
