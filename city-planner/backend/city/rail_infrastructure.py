"""Passenger rail infrastructure. Coordinates and platform identities are authoritative.

A platform is an island with two directional faces. Its centre-line track is a
pair of running tracks, matching the existing rail renderer. Ordinary track
crossings are isolated; a junction asset is required for branches/crossings.
"""
import copy
import math
from collections import Counter, defaultdict
from shapely.geometry import LineString, Point, Polygon
from .parameters import ROAD_TYPES
from .routing import shortest_paths, reconstruct

RULES = dict(platformSpacing=14., platformLength=120., maxPlatforms=8,
             transferMeters=300., entranceRadius=140., walkingSpeed=80.,
             verticalMetersPerMinute=24., levelHeight=8., safeSeconds=30.,
             turnbackSeconds=90., maxGrade=.06, minimumRadius=30.)
LEVELS = {-1: '地下', 0: '地面', 1: '高架'}


def rail_stop(stop):
    return stop.get('mode') in ('train', 'metro') and stop.get('role', 'passenger') == 'passenger'


def ensure(city):
    city.s.setdefault('railInfrastructure', dict(version=1, facilities=[], transfers=[], groups=[]))
    city.s.setdefault('railRules', copy.deepcopy(RULES))


def platforms(city):
    return {p['id']: (s, p) for s in city.s['stops'] for p in s.get('platforms', [])}


def rectangle(center, length, width, rotation):
    a = math.radians(rotation); u = (math.cos(a), math.sin(a)); v = (-u[1], u[0])
    return [[center[0]+x*u[0]+y*v[0], center[1]+x*u[1]+y*v[1]]
            for x, y in [(-length/2,-width/2),(length/2,-width/2),(length/2,width/2),(-length/2,width/2)]]


def layout(point, count, length, rotation, identity='draft'):
    a = math.radians(rotation); u = (math.cos(a),math.sin(a)); v = (-u[1],u[0])
    result = []
    for i in range(count):
        center = [point[j]+v[j]*i*RULES['platformSpacing'] for j in range(2)]
        result.append(dict(id=f'{identity}:p{i+1}', number=i+1, length=length, point=center,
                           ports=[[center[j]+sign*u[j]*length/2 for j in range(2)] for sign in (-1,1)]))
    center = [point[j]+v[j]*(count-1)*RULES['platformSpacing']/2 for j in range(2)]
    return result, rectangle(center, length+12, count*RULES['platformSpacing'], rotation)


def obstacles(city, exclude=None):
    result = []
    for p in city.s['parcels']:
        if p.get('building'):
            result.append((p['id'], Polygon(p['building']['footprint'])))
    for f in city.s['facilities']:
        if f.get('points'): result.append((f['id'], Polygon(f['points'])))
    for s in city.s['stops']:
        if s['id'] == exclude: continue
        if s.get('railStation') and s['level'] != -1:
            result.append((s['id'], Polygon(s['footprint'])))
        for e in s.get('entrances', []):
            if e['kind'] == 'outdoor': result.append((e['id'], Polygon(e['footprint'])))
    return result


def outdoor(city, point, station, rotation=0):
    """Validate the plaza and a real, obstacle-free connection to a sidewalk."""
    shape = Polygon(rectangle(point, 6, 6, rotation))
    if not city.terrain.buildable(shape, .32):
        raise ValueError('室外入口需要平坦、无水的合法空地')
    if any(shape.intersection(o).area > .01 for _,o in obstacles(city, station.get('id'))):
        raise ValueError('室外入口与现有建筑或设施重叠')
    choices=[]
    for r in city.s['roads']:
        if r['level'] != 0: continue
        road_shape=LineString(r['points']); width=ROAD_TYPES[r['kind']]['width']/2
        if shape.intersection(road_shape.buffer(width)).area > .01:
            raise ValueError('室外入口不能占用道路或轨道')
        if not ROAD_TYPES[r['kind']]['walk']: continue
        d=road_shape.project(Point(point)); q=list(road_shape.interpolate(d).coords[0])
        connector=LineString([point,q])
        if connector.length > 60: continue
        # The last part enters the public sidewalk; other roads may not be crossed.
        if any(connector.intersects(o.buffer(.15)) for _,o in obstacles(city,station.get('id'))): continue
        if connector.length > 1 and not city.terrain.buildable(connector.buffer(.1),1): continue
        blocked=any(other['id']!=r['id'] and other['level']==0 and not ROAD_TYPES[other['kind']]['walk']
                    and connector.crosses(LineString(other['points'])) for other in city.s['roads'])
        if blocked: continue
        choices.append((connector.length,r['id'],d,q))
    if not choices: raise ValueError('入口附近没有合法人行道连接，请移动入口或建设步道')
    _,rid,d,q=min(choices)
    distance=math.dist(point,station['point'])
    if distance>RULES['entranceRadius']: raise ValueError('入口距离站厅过远')
    # Underground tunnels may pass below buildings, but may not intersect
    # another station at the same depth. Surface approaches cannot do so.
    tunnel=LineString([point,station['point']])
    if station['level']==-1 and any(other.get('railStation') and other['id']!=station.get('id') and other['level']==-1 and tunnel.intersects(Polygon(other['footprint'])) for other in city.s['stops']):
        raise ValueError('入口通道与另一地下站主体冲突，请调整入口位置')
    if station['level']==0 and any(tunnel.crosses(o) for _,o in obstacles(city,station.get('id'))):
        raise ValueError('入口至站厅的通道被建筑阻挡')
    return dict(kind='outdoor',point=point,rotation=rotation,footprint=list(shape.exterior.coords)[:-1],
                road=rid,roadDistance=d,accessPoint=q,path=[point,station['point']],
                length=distance,minutes=distance/RULES['walkingSpeed']+abs(station['level'])*RULES['levelHeight']/RULES['verticalMetersPerMinute'],
                enabled=True,valid=True)


def find_outdoor(city, station, rotation=0):
    candidates=[]
    p=Point(station['point'])
    for r in city.s['roads']:
        if r['level']!=0 or not ROAD_TYPES[r['kind']]['walk']: continue
        shape=LineString(r['points']); d=shape.project(p)
        for delta in (0,-20,20,-40,40,-70,70,-100,100):
            at=max(.1,min(shape.length-.1,d+delta)); q=shape.interpolate(at)
            a,b=shape.interpolate(max(0,at-.1)),shape.interpolate(min(shape.length,at+.1))
            dx,dy=b.x-a.x,b.y-a.y; n=max(.001,math.hypot(dx,dy))
            for sign in (-1,1):
                offset=(ROAD_TYPES[r['kind']]['width']/2+5)*sign
                point=[q.x-dy/n*offset,q.y+dx/n*offset]
                if math.dist(point,station['point'])<=RULES['entranceRadius']:
                    candidates.append(point)
    for point in sorted(candidates,key=lambda q:math.dist(q,station['point'])):
        try:
            city.point(point)
            return outdoor(city,point,station,rotation)
        except ValueError: pass
    raise ValueError('附近没有合法室外入口空地，请调整站位、入口位置或先建设人行道；草稿已保留')


def station_preview(city, cmd):
    from .engine import number, text
    ensure(city)
    try:
        old=next((s for s in city.s['stops'] if s['id']==cmd.get('id') and s.get('railStation')),None)
        if cmd.get('id') and not old: raise ValueError('车站不存在')
        base=old or {}
        point=city.point(cmd.get('point',base.get('point')))
        level=number(cmd.get('level',base.get('level',-1)),-1,1,'车站层级',True)
        count=number(cmd.get('platformCount',len(base.get('platforms',[])) or 2),1,RULES['maxPlatforms'],'站台数量',True)
        length=number(cmd.get('platformLength',base.get('platformLength',120)),60,360,'站台长度')
        rotation=number(cmd.get('rotation',base.get('rotation',0)),0,359,'朝向')
        if old and (point!=old['point'] or level!=old['level'] or length!=old['platformLength'] or rotation!=old['rotation']):
            raise ValueError('已建车站可增减站台；位置、层级、朝向及长度须保持不变')
        mode=cmd.get('mode',base.get('mode','metro'))
        if mode not in ('metro','train'): raise ValueError('请选择地铁站或火车站')
        ps,footprint=layout(point,count,length,rotation,base.get('id','draft'))
        station=dict(id=base.get('id','draft'),mode=mode,name=text(cmd.get('name') or base.get('name') or ('地铁站' if mode=='metro' else '火车站')),
                     point=point,level=level,platforms=ps,platformLength=length,rotation=rotation,footprint=footprint,
                     enabled=True,role='passenger',external=False,railStation=True)
        shape=Polygon(footprint)
        for q in footprint: city.point(q)
        if not city.terrain.buildable(shape,.32 if level==0 else 1): raise ValueError('车站范围存在水域或地形障碍')
        buildings=[p for p in city.s['parcels'] if p.get('building') and shape.intersection(Polygon(p['building']['footprint'])).area>.01]
        if level!=-1 and buildings: raise ValueError('当前位置覆盖建筑，仅可建设地下站；地面与高架已禁用')
        for s in city.s['stops']:
            if s.get('railStation') and s['id']!=base.get('id') and s['level']==level and shape.intersection(Polygon(s['footprint'])).area>.01:
                raise ValueError('车站与同层车站或地下设施冲突')
        for passage in city.s['railInfrastructure'].get('passages',[]):
            if passage['level']==level and base.get('id') not in (passage['a'],passage['b']) and shape.intersects(LineString(passage['points']).buffer(2)):
                raise ValueError('车站占地与既有站内通道冲突')
        for f in city.s['facilities']:
            if level!=-1 and f.get('points') and shape.intersection(Polygon(f['points'])).area>.01:
                raise ValueError('车站与地面设施冲突')
        for r in city.s['roads']:
            if r.get('station')==base.get('id'): continue
            if r['level']==level and r['kind'] not in ('train','metro') and shape.intersection(LineString(r['points']).buffer(ROAD_TYPES[r['kind']]['width']/2)).area>.01:
                raise ValueError('车站与同层道路冲突')
        if old and count<len(old['platforms']):
            for p in old['platforms'][count:]:
                users=[l['name'] for l in city.s['lines'] if p['id'] in l.get('platforms',{}).values()]
                if users: raise ValueError(f"{p['number']} 号站台被线路 {'、'.join(users)} 引用，请先编辑线路")
                track=next(r for r in city.s['roads'] if r['id']==p['track'])
                from .geometry import road_contacts
                if any(next(road_contacts(track,r),None) for r in city.s['roads'] if r['id']!=track['id']):
                    raise ValueError(f"{p['number']} 号站台仍连接区间轨道，请先断开")
                if any(p['id'] in t.get('platforms',[]) for t in city.s.get('railRuntime',{}).get('trains',[])):
                    raise ValueError(f"{p['number']} 号站台仍被在途列车占用")
        if old:
            station['entrances']=copy.deepcopy(old['entrances'])
            for i,p in enumerate(ps[:len(old['platforms'])]): p.update(old['platforms'][i])
        else:
            entry=outdoor(city,city.point(cmd['outdoorPoint']),station,rotation) if cmd.get('outdoorPoint') else find_outdoor(city,station,rotation)
            entry['id']='draft:e1';station['entrances']=[entry]
            defaults=[min(buildings,key=lambda p:math.dist(p['center'],point))['id']] if buildings and level==-1 else []
            selected=cmd.get('buildings',defaults)
            if not isinstance(selected,list) or len(selected)!=len(set(selected)): raise ValueError('关联建筑格式无效')
            for pid in selected:
                p=next((p for p in buildings if p['id']==pid),None)
                if level!=-1 or p is None: raise ValueError('只能关联地下站覆盖的具体建筑')
                origin=list(p['center']); distance=math.dist(origin,point)
                station['entrances'].append(dict(id=f'draft:e{len(station["entrances"])+1}',kind='building',building=pid,
                    point=origin,path=[origin,point],length=distance,minutes=distance/RULES['walkingSpeed']+RULES['levelHeight']/RULES['verticalMetersPerMinute'],enabled=True,valid=True))
        cost=(500000+count*length*1800)*(1.6 if level==-1 else 1.3 if level==1 else 1)
        cost+=sum(45000+e['length']*900 for e in station['entrances'])
        old_cost=base.get('constructionCost',0)
        delta=max(0,(count-len(old['platforms']))*length*1800*(1.6 if level==-1 else 1.3 if level==1 else 1)) if old else cost
        station['constructionCost']=old_cost+round(delta)
        return dict(valid=True,station=station,cost=round(delta),buildings=[dict(id=p['id'],name=p['building'].get('name',p.get('name',p['id'])),point=p['center']) for p in buildings],
                    allowedLevels=[-1] if buildings else [-1,0,1],rule='每个编号站台为双向岛式站台，包含两条方向股道；接口与线路按站台分别选择')
    except (ValueError,TypeError,KeyError) as error:
        return dict(valid=False,reason=str(error),allowedLevels=[-1] if '仅可建设地下' in str(error) else [-1,0,1])


def construct(city,cmd):
    result=station_preview(city,cmd)
    if not result['valid']: raise ValueError(result['reason'])
    station=result['station']; old=next((s for s in city.s['stops'] if s['id']==cmd.get('id')),None)
    if not old:
        identity=city.uid('s'); station['id']=identity
        for i,p in enumerate(station['platforms']): p['id']=f'{identity}:p{i+1}'
        for e in station['entrances']: e['id']=city.uid('entry')
    keep={p.get('track') for p in station['platforms']}
    city.s['roads']=[r for r in city.s['roads'] if r.get('station')!=station['id'] or r['id'] in keep]
    for p in station['platforms']:
        if p.get('track'): continue
        p['track']=city.uid('r'); p['turnback']=False
        city.s['roads'].append(dict(id=p['track'],kind='train',level=station['level'],points=p['ports'],
            controls=p['ports'],shape='polyline',name=f"{station['name']} {p['number']} 号站台",length=p['length'],
            oneway=False,connections=[],constructionCost=0,station=station['id'],platform=p['id'],railManaged=True))
    city.spend(result['cost'],'车站建设')
    if old:
        old.update(station)
    else:
        from . import naming
        naming.name_object(city,'stops',station);city.s['stops'].append(station)
    city.rebuild()


def edit_entry(city,cmd):
    from .engine import text
    s=next((s for s in city.s['stops'] if s['id']==cmd.get('station') and s.get('railStation')),None)
    if s is None: raise ValueError('车站不存在')
    entry=next((e for e in s['entrances'] if e['id']==cmd.get('id')),None)
    action=cmd.get('action','add')
    if action!='add' and entry is None: raise ValueError('入口不存在')
    if action=='delete': s['entrances'].remove(entry)
    elif action=='toggle': entry['enabled']=not entry.get('enabled',True)
    elif action=='add' and cmd.get('building'):
        pid=cmd['building'];p=city.parcelmap.get(pid)
        if s['level']!=-1 or not p or not p.get('building') or not Polygon(s['footprint']).intersects(Polygon(p['building']['footprint'])):
            raise ValueError('请选择地下站覆盖的建筑')
        if any(e.get('building')==pid for e in s['entrances']):raise ValueError('此建筑已有入口，可直接重新开放')
        point=p['center'];length=math.dist(point,s['point'])
        s['entrances'].append(dict(id=city.uid('entry'),kind='building',building=pid,point=point,path=[point,s['point']],length=length,
            minutes=length/RULES['walkingSpeed']+RULES['levelHeight']/RULES['verticalMetersPerMinute'],enabled=True,valid=True))
        city.spend(45000+length*900,'车站通道');s['constructionCost']+=45000+length*900
    elif action in ('add','move'):
        if entry and entry['kind']=='building': raise ValueError('建筑入口不能平移；请关闭或删除后重新关联')
        new=outdoor(city,city.point(cmd['point']),s,cmd.get('rotation',0))
        if entry: entry.update(new)
        else: new['id']=city.uid('entry');s['entrances'].append(new)
        city.spend(45000+new['length']*900,'车站通道');s['constructionCost']+=45000+new['length']*900
    else: raise ValueError('未知入口操作')
    city.rebuild()


def build_facility(city,cmd):
    from .engine import number
    ensure(city)
    kind=cmd.get('kind');point=city.point(cmd['point']);level=number(cmd.get('level',0),-1,1,'层级',True)
    if kind not in ('switch','turnback','passing'): raise ValueError('未知铁路设施')
    pair=platforms(city).get(cmd.get('platform'))
    if kind=='turnback':
        if pair is None: raise ValueError('请先选择需要折返的站台')
        s,p=pair;point=p['ports'][-1];level=s['level']
        if p.get('turnback'): raise ValueError('该站台已有折返设施')
        p['turnback']=True
    else:
        tracks=[r for r in city.s['roads'] if r['kind'] in ('metro','train') and r['level']==level and LineString(r['points']).distance(Point(point))<.1]
        if kind=='switch' and len(tracks)<2: raise ValueError('道岔需要位于同层两条轨道的接点')
        if kind=='passing':
            if pair is None: raise ValueError('请在车站选择站台建设越行轨道')
            s,p=pair
            if any(r.get('bypassFor')==p['id'] for r in city.s['roads']):raise ValueError('该站台已有越行轨道')
            level=s['level'];a,b=p['ports'];ux=(b[0]-a[0])/p['length'];uy=(b[1]-a[1])/p['length']
            # A real parallel bypass, with two physical switch assets.
            pts=[a,[a[0]+ux*30+uy*14,a[1]+uy*30-ux*14],[b[0]-ux*30+uy*14,b[1]-uy*30-ux*14],b]
            city.add_road(dict(kind='train',level=level,points=pts,railManaged=True,snap=False))
            bypass=city.s['roads'][-1];bypass['bypassFor']=p['id']
            for port in (a,b): city.s['railInfrastructure']['facilities'].append(dict(id=city.uid('rf'),kind='switch',point=port,level=level,constructionCost=25000))
            point=p['point']
    cost={'turnback':80000,'switch':25000,'passing':100000}[kind]
    city.spend(cost,'铁路调度设施')
    city.s['railInfrastructure']['facilities'].append(dict(id=city.uid('rf'),kind=kind,point=point,level=level,platform=cmd.get('platform'),constructionCost=cost-50000 if kind=='passing' else cost))
    asset=city.s['railInfrastructure']['facilities'][-1]
    if kind=='turnback':asset['footprint']=rectangle([point[j]+(p['point'][j]-point[j])*24/p['length'] for j in (0,1)],24,12,s['rotation'])
    elif kind=='switch':asset['footprint']=rectangle(point,12,12,0)
    city.rebuild()


def facility_preview(city,cmd):
    # Execute identical validation on a detached checkpoint, including cost.
    try:
        shadow=copy.copy(city);shadow.__dict__=city.checkpoint();shadow.undo=[];shadow.redo=[]
        before=shadow.s['treasury'];build_facility(shadow,cmd)
        asset=shadow.s['railInfrastructure']['facilities'][-1]
        roads=[r for r in shadow.s['roads'] if not any(old['id']==r['id'] for old in city.s['roads'])]
        return dict(valid=True,cost=round(before-shadow.s['treasury']),facility=asset,paths=[dict(points=r['points']) for r in roads])
    except (ValueError,KeyError,TypeError) as error:return dict(valid=False,reason=str(error))


def prepare_network(city):
    ensure(city)
    switches=city.s['railInfrastructure']['facilities']
    for r in city.s['roads']:
        if r['kind'] in ('train','metro'):
            r['railJunctions']=[f['point'] for f in switches if f['kind']=='switch' and f['level']==r['level']]
    entries=[]
    for s in city.s['stops']:
        if not s.get('railStation'): entries.append(s);continue
        for p in s['platforms']:
            entries.append(dict(id=p['id'],mode=s['mode'],point=p['point'],level=s['level'],railPlatform=True,track=p['track']))
        # Station identity remains an access/transfer node, never a track snap.
    return entries


def transfer_points(city,path):
    stations={s['id']:s for s in city.s['stops']}
    entries={e['id']:(s,e) for s in city.s['stops'] for e in s.get('entrances',[])}
    passages={p['id']:p for p in city.s['railInfrastructure'].get('passages',[])}
    points=[]
    def coordinate(node):
        return city.network['nodes'].get(node) or stations.get(node,{}).get('point') or city.parcelmap.get(node,{}).get('center')
    for edge in path:
        rid=edge.get('ref');part=city.path_points([edge])
        if rid in entries:
            station,entry=entries[rid]
            part=[station['point'],entry['point']]
            if entry['kind']=='outdoor':part.append(entry['accessPoint'])
            if edge['origin']!=station['id']:part.reverse()
            if coordinate(edge['origin']):part.insert(0,coordinate(edge['origin']))
            if coordinate(edge['to']):part.append(coordinate(edge['to']))
        elif rid in passages:
            passage=passages[rid];part=passage['points'] if edge['origin']==passage['a'] else passage['points'][::-1]
        if not part:part=[coordinate(edge['origin']),coordinate(edge['to'])]
        for point in part:
            if point and (not points or point!=points[-1]):points.append(point)
    return points


def attach(city,walk):
    """Add only legal access edges. No Euclidean station-to-station shortcuts."""
    ensure(city)
    for s in city.s['stops']:
        if not s.get('railStation'): continue
        connected=False
        for p in s['platforms']:
            att=city.network['stops'].get(p['id']);p['connected']=bool(att)
            if att:
                own=p['track'];nodes={e[k] for e in city.network['edges'] if e['road']==own for k in ('a','b')}
                p['connected']=any(e['road']!=own and e['kind'] in ('train','metro') and (e['a'] in nodes or e['b'] in nodes) for e in city.network['edges'])
            connected |= p['connected']
        for entry in s['entrances']:
            entry['valid']=False; entry['reason']='已关闭'
            if not entry.get('enabled',True): continue
            if entry['kind']=='building':
                parcel=city.parcelmap.get(entry['building'])
                if not parcel or not parcel.get('building') or parcel['building']['status'] not in ('active','vacant'):
                    entry['reason']='关联建筑已拆除或尚未开放';continue
                for a,b in ((parcel['id'],s['id']),(s['id'],parcel['id'])):
                    city.add(walk,a,b,entry['minutes'],'walk',entry['id'],length=entry['length'],railAccess=s['id'])
                entry['valid']=True
            else:
                road=next((r for r in city.s['roads'] if r['id']==entry['road']),None)
                if not road: entry['reason']='人行道已断开';continue
                try: checked=outdoor(city,entry['point'],s,entry.get('rotation',0))
                except ValueError as error: entry['reason']=str(error);continue
                entry.update(checked)
                d=entry['roadDistance']
                edge=next((e for e in city.network['edges'] if e['road']==entry['road'] and e['startDistance']-1e-6<=d<=e['endDistance']+1e-6),None)
                if edge is None: entry['reason']='人行道节点缺失';continue
                connector=math.dist(entry['point'],entry['accessPoint'])
                for node,dist in ((edge['a'],d-edge['startDistance']),(edge['b'],edge['endDistance']-d)):
                    for a,b in ((s['id'],node),(node,s['id'])):
                        city.add(walk,a,b,entry['minutes']+(max(0,dist)+connector)/RULES['walkingSpeed'],'walk',entry['id'],
                            length=entry['length']+max(0,dist)+connector,railAccess=s['id'])
                entry['valid']=True
            if entry['valid']:entry['reason']='可通行'
        s['connected']=connected
        s['accessible']=any(e['valid'] for e in s['entrances'])
        s['status']='待连接' if not connected else '可运营' if s['accessible'] else '仅通过 / 站内换乘'
    existing={s['id'] for s in city.s['stops']}
    for p in city.s['railInfrastructure'].get('passages',[]):
        p['valid']=p['enabled'] and p['a'] in existing and p['b'] in existing
        if p['valid']:
            for a,b in ((p['a'],p['b']),(p['b'],p['a'])):
                city.add(walk,a,b,p['minutes'],'walk',p['id'],length=p['length']+p['verticalMeters'],railPassage=True)
    # Exact entrance projections are cuts in geometry.make_network, so paths
    # use actual sidewalk distance even for entrances on one road segment.
    stations=[s for s in city.s['stops'] if rail_stop(s)]
    signature=(city.s['railRules']['transferMeters'],tuple((s['id'],tuple(s['point'])) for s in stations),
        tuple((a,tuple((e['to'],e['time'],e.get('length')) for e in edges)) for a,edges in walk.items()))
    cached=getattr(city,'_rail_transfer_cache',None)
    if cached and cached[0]==signature:
        city.s['railInfrastructure'].update(transfers=copy.deepcopy(cached[1]),groups=copy.deepcopy(cached[2]))
        return
    transfers=[];links=defaultdict(set)
    for i,a in enumerate(stations):
        candidates=[b for b in stations[i+1:] if math.dist(a['point'],b['point'])<=city.s['railRules']['transferMeters']]
        if not candidates: continue
        distances,previous=shortest_paths(walk,a['id'],weight=lambda e,_:e.get('length',e['time']*RULES['walkingSpeed']))
        for b in candidates:
            distance=distances.get(b['id']);path=reconstruct(previous,a['id'],b['id']) if distance is not None else []
            valid=distance is not None and distance<=city.s['railRules']['transferMeters']
            transfers.append(dict(id=f"{a['id']}:{b['id']}",a=a['id'],b=b['id'],valid=valid,
                distance=distance,minutes=sum(e['time'] for e in path) if path else None,path=path,points=transfer_points(city,path),
                reason='' if valid else '邻近但尚未连通：缺少合法步行连接或实际路径超过换乘阈值'))
            if valid: links[a['id']].add(b['id']);links[b['id']].add(a['id'])
    groups=[];seen=set()
    for sid in sorted(links):
        if sid in seen:continue
        todo=[sid];members=[]
        while todo:
            cur=todo.pop()
            if cur in seen:continue
            seen.add(cur);members.append(cur);todo.extend(sorted(links[cur]-seen))
        groups.append(dict(id='group:'+min(members),stations=sorted(members)))
    city.s['railInfrastructure'].update(transfers=transfers,groups=groups)
    city._rail_transfer_cache=(signature,copy.deepcopy(transfers),copy.deepcopy(groups))


def remove(city,identity):
    """Keep failed services editable; only remove the affected physical assets."""
    ensure(city)
    station=next((s for s in city.s['stops'] if s['id']==identity and s.get('railStation')),None)
    if station:
        pids={p['id'] for p in station['platforms']}
        for train in city.s.get('railRuntime',{}).get('trains',[]):
            seg=train['route'][train['index']]
            if train['status']!='dispatch' and (seg['platformA'] in pids or seg['platformB'] in pids):
                raise ValueError('车站正在被列车占用，请待列车离开后拆除')
        city.s['roads']=[r for r in city.s['roads'] if r.get('station')!=identity]
        pids={p['id'] for p in station['platforms']}
        city.s['railInfrastructure']['facilities']=[f for f in city.s['railInfrastructure']['facilities'] if f.get('platform') not in pids]
    if any(p.get('track')==identity for _,p in platforms(city).values()):
        raise ValueError('站台轨道属于车站，请通过编辑站台数量调整')
    facility=next((f for f in city.s['railInfrastructure']['facilities'] if f['id']==identity),None)
    if facility:
        key=('turnback:'+facility.get('platform','')) if facility['kind']=='turnback' else 'switch:'+identity
        reservation=city.s.get('railRuntime',{}).get('reservations',{}).get(key)
        if reservation and reservation['until']>city.s['railRuntime']['clock']:
            raise ValueError('设施正在被列车占用，请待进路释放后拆除')
        if facility['kind']=='turnback':
            pair=platforms(city).get(facility.get('platform'))
            if pair:pair[1]['turnback']=False
        city.s['railInfrastructure']['facilities'].remove(facility)
        return True
    return False


def reserve(city):
    sites=[]
    for s in city.s['stops']:
        if not s.get('railStation'):continue
        if s['level']!=-1:sites.append((s['id'],Polygon(s['footprint'])))
        sites.extend((s['id'],Polygon(e['footprint'])) for e in s['entrances'] if e['kind']=='outdoor')
    for p in city.s['parcels']:
        if p.get('railReserved'):
            if p.get('openSpace')==p['railReserved']:p.pop('openSpace',None)
            p.pop('railReserved',None)
        if p.get('building') or p.get('openSpace'):continue
        shape=Polygon(p['points'])
        for sid,site in sites:
            if shape.intersection(site).area>.1:
                p.update(openSpace=sid,railReserved=sid,developmentReason='铁路车站或入口预留空间')
                break

def validate(city):
    from .engine import number
    ensure(city)
    if not isinstance(city.s['railInfrastructure'],dict) or not isinstance(city.s['railInfrastructure'].get('facilities'),list):raise ValueError('无效铁路设施存档')
    number(city.s['railRules'].get('transferMeters'),1,2000,'换乘步行阈值')
    identities=set()
    for s in city.s['stops']:
        if not s.get('railStation'):continue
        number(s['level'],-1,1,'车站层级',True)
        number(len(s['platforms']),1,RULES['maxPlatforms'],'站台数量',True)
        for p in s['platforms']:
            if p['id'] in identities:raise ValueError('站台身份重复')
            identities.add(p['id']);number(p['length'],60,360,'站台长度')
            for point in p['ports']:city.point(point)
        for e in s['entrances']:
            if e['id'] in identities:raise ValueError('入口身份重复')
            identities.add(e['id']);city.point(e['point'])
            if e['kind'] not in ('outdoor','building'):raise ValueError('无效入口类型')
            number(e['length'],0,10000,'通道长度')
            number(e['minutes'],0,1000,'通道时间')


def passage_preview(city,cmd):
    """Explicit civil work between halls; proximity alone never creates it."""
    try:
        a=next((s for s in city.s['stops'] if s['id']==cmd.get('a') and s.get('railStation')),None)
        b=next((s for s in city.s['stops'] if s['id']==cmd.get('b') and s.get('railStation')),None)
        if not a or not b or a==b:raise ValueError('请选择两座不同的已建车站')
        if any({p['a'],p['b']}=={a['id'],b['id']} for p in city.s['railInfrastructure'].get('passages',[])):raise ValueError('两站之间已有站内通道')
        points=[a['point'],*[city.point(p) for p in cmd.get('via',[])],b['point']]
        path=LineString(points);distance=path.length
        if not path.is_simple or distance>city.s['railRules']['transferMeters']:raise ValueError('通道路径无效或超过公开换乘距离阈值')
        if not city.terrain.buildable(path.buffer(2),1):raise ValueError('通道穿过水域或不可通行地形，请调整路径')
        depth=min(-1,a['level'],b['level']);vertical=(abs(a['level']-depth)+abs(b['level']-depth))*RULES['levelHeight']
        for s in city.s['stops']:
            if s['id'] not in (a['id'],b['id']) and s.get('railStation') and s['level']==depth and path.intersects(Polygon(s['footprint'])):
                raise ValueError('通道穿过第三座车站的地下空间，请选择分段连接')
        cost=round(80000+distance*1200+vertical*4500)
        return dict(valid=True,passage=dict(a=a['id'],b=b['id'],points=points,level=depth,length=distance,verticalMeters=vertical,
            minutes=distance/RULES['walkingSpeed']+vertical/RULES['verticalMetersPerMinute'],enabled=True,constructionCost=cost),cost=cost)
    except (ValueError,TypeError) as error:return dict(valid=False,reason=str(error))


def passage_command(city,cmd):
    ensure(city);passages=city.s['railInfrastructure'].setdefault('passages',[])
    if cmd.get('id'):
        p=next((p for p in passages if p['id']==cmd['id']),None)
        if not p:raise ValueError('换乘通道不存在')
        if cmd.get('delete'):passages.remove(p)
        else:p['enabled']=bool(cmd.get('enabled',not p['enabled']))
    else:
        result=passage_preview(city,cmd)
        if not result['valid']:raise ValueError(result['reason'])
        p=result['passage'];p['id']=city.uid('passage');city.spend(result['cost'],'铁路换乘通道');passages.append(p)
    city.rebuild()
