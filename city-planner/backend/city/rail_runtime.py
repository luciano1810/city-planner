"""Deterministic event-driven trains and passenger cohorts, never a visual sample.

Demand is a dated replay of assigned representative journeys. Once an intent
arrives its passengers are real conserved state, including after midnight,
service changes and reload. No animation-derived counts are used.
"""
import copy
import hashlib
import math
from . import construction
from .rail_infrastructure import RULES

EPS=1e-7


def now(city):
    return construction.day(city)*86400


def ensure(city):
    return city.s.setdefault('railRuntime',dict(version=2,clock=now(city),serial=0,trains=[],passengers=[],
        reservations={},departures={},generated={},totals={},days={},history=[],events=[],pendingFare=0.))


def validate_restore(city,candidate):
    """Undo/redo must honor the same live physical occupancy as direct edits."""
    runtime=city.s.get('railRuntime',{})
    def objects(state):
        roads={r['id']:{k:r.get(k) for k in ('points','level','oneway','connections','railJunctions','railManaged')} for r in state['roads']}
        platforms={p['id']:{k:p.get(k) for k in ('point','ports','length','track')} for s in state['stops'] for p in s.get('platforms',[])}
        facilities=state.get('railInfrastructure',{}).get('facilities',[])
        switches={f['id']:f for f in facilities if f['kind']=='switch'}
        turns={f['platform']:f for f in facilities if f['kind']=='turnback'}
        return dict(block=roads,platform=platforms,switch=switches,turnback=turns)
    current,previous=objects(city.s),objects(candidate)
    for key,reservation in runtime.get('reservations',{}).items():
        if reservation['until']<=runtime.get('clock',0)+EPS:continue
        kind,identity=key.split(':',1)
        if kind in ('block','platform'):identity=identity.rsplit(':',1)[0]
        if kind in current and current[kind].get(identity)!=previous[kind].get(identity):
            raise ValueError('撤销或重做会改变列车正在占用的轨道、站台或设施，请待列车离开后重试')


def event(city,kind,people,station=None,line=None,direction=None,**extra):
    state=ensure(city);stamp=state['clock'];date=construction.date_string(stamp/86400)
    row=dict(time=round(stamp,4),date=date,kind=kind,people=people,station=station,line=line,direction=direction,**extra)
    state['events'].append(row);state['events']=state['events'][-1000:]
    day=state['days'].setdefault(date,dict(totals={},hourly=[0]*24))
    for key in ['network']+(['station:'+station] if station else [])+(['line:'+line] if line else []):
        total=state['totals'].setdefault(key,{})
        total[kind]=total.get(kind,0)+people
        data=day['totals'].setdefault(key,{})
        data[kind]=data.get(kind,0)+people
        hours=data.setdefault('hours',[{} for _ in range(24)]);hour=hours[int(stamp%86400//3600)];hour[kind]=hour.get(kind,0)+people
        if direction is not None:
            by_direction=data.setdefault('directions',{}).setdefault(str(direction),{})
            by_direction[kind]=by_direction.get(kind,0)+people
        if direction is not None:
            directional=total.setdefault('directions',{}).setdefault(str(direction),{})
            directional[kind]=directional.get(kind,0)+people
    if kind=='board':day['hourly'][int(stamp%86400//3600)]+=people


def intents(city,start,end):
    state=ensure(city);lines={l['id']:l for l in city.s['lines'] if l['mode'] in ('metro','train')}
    # Only materialize events inside the advanced interval, retaining dedupe
    # keys through midnight and same-day demand recalculations.
    generated=state['generated'];result=[]
    for day in range(int(start//86400),int(end//86400)+1):
        keys=generated.setdefault(str(day),[]);known=set(keys)
        for index,trip in enumerate(getattr(city,'trips',[])):
            calls=trip.get('railIntentCalls',trip.get('transitCalls',[]));legs=[];board=None
            for call in calls:
                if call['line'] not in lines:continue
                if call['kind']=='board':board=call
                elif board and board['line']==call['line']:
                    line=lines[call['line']]
                    arrive=(board['minute']-line.get('serviceHeadway',line['headway'])/2-city.s['policy']['boardingMinutes'])%1440
                    legs.append(dict(line=call['line'],from_=board['stop'],to=call['stop'],direction=board.get('direction',0),
                                     minute=arrive,boardMinute=board['minute'],expectedWait=line.get('serviceHeadway',line['headway'])/2+city.s['policy']['boardingMinutes'],alightMinute=call['minute']))
                    board=None
            if not legs:continue
            first=legs[0];stamp=day*86400+first['minute']*60
            key=hashlib.sha256(f"{index}:{trip['source']}:{trip['target']}:{trip['purpose']}".encode()).hexdigest()[:20]
            if key in known or stamp<start-EPS or stamp>end+EPS:continue
            keys.append(key);known.add(key)
            for i,leg in enumerate(legs):
                leg['from']=leg.pop('from_')
                if i:
                    gap=leg['boardMinute']-legs[i-1]['alightMinute']
                    if gap < -720:gap+=1440
                    leg['walkSeconds']=max(1,(gap-leg['expectedWait'])*60)
            state['serial']+=1
            result.append(dict(id=f"rp-{state['serial']}",people=trip.get('people',1),state='pending',ready=stamp,
                               legs=legs,leg=0,train=None,paid=False,entered=False,source=trip['source']))
    # Completed dedupe keys from old dates have no future intent timestamps.
    state['generated']={d:keys for d,keys in generated.items() if int(d)>=int(end//86400)-1}
    return result


def operating(line,time):
    return line.get('enabled',True) and line.get('valid',False) and (time/60-line['startHour']*60)%1440<line['hours']*60-EPS


def next_departure(line,time):
    start=line['startHour']*3600;interval=line['serviceHeadway']*60
    day=math.floor((time-start)/86400);base=day*86400+start
    slot=max(0,math.ceil((time-base-EPS)/interval));candidate=base+slot*interval
    if candidate>=base+line['hours']*3600-EPS and line['hours']<24:candidate=base+86400
    return candidate


def load(train,state):
    return sum(p['people'] for p in state['passengers'] if p['state']=='onboard' and p['train']==train['id'])


def complete_passenger(city,p,station,line,direction):
    event(city,'alight',p['people'],station,line,direction)
    p['train']=None
    if p['leg']+1<len(p['legs']):
        p['leg']+=1;p['state']='walking';p['ready']=ensure(city)['clock']+p['legs'][p['leg']]['walkSeconds']
        event(city,'transfer',p['people'],station,line,direction)
    else:
        p['state']='complete';event(city,'exit',p['people'],station,line,direction)


def alight(city,train,station,final=False):
    state=ensure(city)
    for p in state['passengers']:
        if p['state']!='onboard' or p['train']!=train['id']:continue
        if p['legs'][p['leg']]['to']==station:
            complete_passenger(city,p,station,train['line'],train['direction'])
        elif final:
            # Infrastructure failures strand nobody inside a deleted vehicle.
            p['state']='failed';p['train']=None
            event(city,'alight',p['people'],station,train['line'],train['direction'])
            event(city,'unmet',p['people'],station,train['line'],train['direction'],reason='在途线路中断，已在最近停靠站疏散')
            event(city,'exit',p['people'],station,train['line'],train['direction'])


def board(city,train,segment):
    if segment['deadhead'] or train.get('draining'):return
    state=ensure(city);remaining=train['capacity']-load(train,state)
    # The immutable onboard plan ensures configuration edits cannot delete
    # riders or put them on a train which no longer reaches their destination.
    reachable=[s['b'] for s in train['route'][train['index']:]] if not train['loop'] else [s['b'] for s in train['route']]
    waiting=sorted((p for p in state['passengers'] if p['state']=='waiting' and p['ready']<=state['clock']+EPS),key=lambda p:(p['ready'],p['id']))
    for p in waiting:
        leg=p['legs'][p['leg']]
        if leg['line']!=train['line'] or leg['direction']!=train['direction'] or leg['from']!=segment['a'] or leg['to'] not in reachable:continue
        if p['people']>remaining:
            excess=p['people']-remaining
            if p.get('deniedTrain')!=train['id']:
                event(city,'denied',excess,segment['a'],train['line'],train['direction'],reason='列车满载，继续候车');p['deniedTrain']=train['id']
            if remaining<=0:continue
            remainder=copy.deepcopy(p);state['serial']+=1;remainder.update(id=f"rp-{state['serial']}",people=excess)
            state['passengers'].append(remainder);p['people']=remaining
        remaining-=p['people'];p['state']='onboard';p['train']=train['id']
        event(city,'board',p['people'],segment['a'],train['line'],train['direction'])
        if not p['paid']:
            state['pendingFare']+=city.s['settings']['fare']*p['people'];p['paid']=True


def migrate_resources(city):
    state=ensure(city)
    if state.get('version',1)>=2:return
    from . import rail_services
    remap={}
    for train in state['trains']:
        for seg in train['route']:
            old=f"platform:{seg['platformB']}:{seg['direction']}"
            rail_services.annotate_platforms(city,seg);seg['resources']=rail_services.resources(city,seg)
            remap.setdefault(old,set()).add(f"platform:{seg['platformB']}:{seg['platformFaceB']}")
        if train.get('heldPlatform'):
            previous=train['route'][max(0,train['index']-1)]
            train['heldPlatform']=f"platform:{previous['platformB']}:{previous['platformFaceB']}"
            train['heldResources']=[train['heldPlatform']]
    reservations={}
    for key,value in state['reservations'].items():
        for target in remap.get(key,{key}):reservations[target]=copy.deepcopy(value)
    state['reservations']=reservations;state['version']=2


def advance(city,seconds):
    state=ensure(city);start=state['clock'];end=start+seconds
    if seconds<=0:return
    state['passengers'].extend(intents(city,start,end))
    from . import rail_services
    migrate_resources(city)
    lines={l['id']:l for l in city.s['lines'] if l['mode'] in ('metro','train') and l.get('routePlans')}
    signatures=state.setdefault('serviceSignatures',{})
    for lid,line in lines.items():
        if not line.get('valid') or not line['enabled']:continue
        signature=repr(rail_services.operating_signature(line))
        if signatures.get(lid)!=signature:
            state['departures'][lid]=next_departure(line,start);signatures[lid]=signature
        state['departures'].setdefault(lid,next_departure(line,start))
        if state['departures'][lid]<start-EPS:state['departures'][lid]=next_departure(line,start)
    roads={r['id'] for r in city.s['roads']}
    clock=start
    while clock<=end+EPS:
        state['clock']=clock
        state['reservations']={key:r for key,r in state['reservations'].items() if r['until']>clock+EPS}
        for p in state['passengers']:
            if p['state'] in ('pending','walking') and p['ready']<=clock+EPS:
                leg=p['legs'][p['leg']]
                p['state']='waiting'
                if not p['entered']:
                    p['entered']=True;event(city,'entry',p['people'],leg['from'],leg['line'],leg['direction'])
            if p['state']=='waiting' and clock-p['ready']>=7200-EPS:
                leg=p['legs'][p['leg']];p['state']='failed'
                event(city,'unmet',p['people'],leg['from'],leg['line'],leg['direction'],reason='超过 120 分钟仍未完成登乘')
                event(city,'exit',p['people'],leg['from'],leg['line'],leg['direction'])
        # Arrival before dispatch releases passengers/platform paths in order.
        for train in state['trains']:
            if train['status']!='running' or train['until']>clock+EPS:continue
            seg=train['route'][train['index']];train['station']=seg['b'];train['index']+=1
            if seg['calls']:
                alight(city,train,seg['b'])
                train['heldPlatform']=f"platform:{seg['platformB']}:{seg.get('platformFaceB',seg['direction'])}"
                train['heldResources']=[train['heldPlatform']]+(['turnback:'+seg['platformB']] if seg.get('turnbackB') else [])
                for resource in train['heldResources']:state['reservations'][resource]=dict(train=train['id'],until=1e12)
            if train['index']>=len(train['route']) and train['loop'] and load(train,state)>0 and not train.get('draining'):
                train['route'].extend(copy.deepcopy(train['route']));train['draining']=True
            if train['index']>=len(train['route']):
                alight(city,train,seg['b'],final=True);train['status']='finished'
                for resource in train.get('heldResources',[]):
                    if resource in state['reservations']:state['reservations'][resource]['until']=clock+train['dwell']*60+RULES['safeSeconds']
                continue
            next_seg=train['route'][train['index']]
            train.update(status='dwelling',direction=next_seg['direction'],until=clock+(RULES['turnbackSeconds'] if next_seg['direction']!=seg['direction'] else (train['dwell']*60 if seg['calls'] else 0)))
        state['trains']=[t for t in state['trains'] if t['status']!='finished']
        for lid,line in sorted(lines.items()):
            scheduled=state['departures'].get(lid)
            if not line.get('valid') or not line['enabled'] or scheduled is None or scheduled>clock+EPS:continue
            if operating(line,clock):
                active=sum(t['line']==lid for t in state['trains'])
                plans=line['routePlans']
                routes=plans if line['servicePattern'].startswith('loop') else [[s for plan in plans for s in plan]]
                turn=state.setdefault('dispatchTurns',{}).get(lid,0)%len(routes)
                for route in routes[turn:]+routes[:turn]:
                    if active>=line['fleet']:break
                    if line['servicePattern'].startswith('loop'):
                        pids={(s['platformB'],s.get('platformFaceB',s['direction'])) for s in route}
                        circulating=sum(t['loop'] and any((s['platformB'],s.get('platformFaceB',s['direction'])) in pids for s in t['route']) for t in state['trains'])
                        if circulating>=max(1,len(pids)-1):continue
                    state['serial']+=1;active+=1;state['dispatchTurns'][lid]=(routes.index(route)+1)%len(routes)
                    state['trains'].append(dict(id=f"rt-{state['serial']}",line=lid,color=line['color'],capacity=line['capacity'],length=line['trainLength'],
                        platforms=list(line.get('platforms',{}).values()),route=copy.deepcopy(route),index=0,direction=route[0]['direction'],station=route[0]['a'],
                        status='dispatch',configSignature=signatures[lid],until=clock,scheduled=clock,delay=0.,dwell=line['dwell'],loop=line['servicePattern'].startswith('loop'),blockReason=''))
            state['departures'][lid]=next_departure(line,clock+line['serviceHeadway']*60)
        # FIFO across services avoids starvation. A complete next-leg reservation
        # avoids holding one block while waiting for another (no lock cycles).
        for train in sorted(state['trains'],key=lambda t:(t.get('waitSince',t['scheduled']),t['id'])):
            if train['status']=='running' or train['until']>clock+EPS:continue
            if train['status']=='dispatch':
                current=lines.get(train['line'])
                if not current or not operating(current,clock) or train['capacity']!=current['capacity'] or train['length']!=current['trainLength'] or train.get('configSignature',signatures.get(train['line']))!=signatures.get(train['line']):
                    train['status']='finished';continue
            seg=train['route'][train['index']]
            def path_valid(segment):
                return all(any(edge.get('ref')==e['ref'] and edge['to']==e['to'] for edge in city.rail_graph.get(e['origin'],[])) for e in segment['path'])
            missing=not path_valid(seg)
            if missing:
                current=lines.get(train['line'])
                plans=current.get('routePlans',[]) if current and current.get('valid') else []
                route=[s for plan in plans for s in plan]
                at=next((i for i,s in enumerate(route) if s['a']==train['station'] and s['direction']==train['direction']),None)
                if at is not None:
                    train['route']=copy.deepcopy(route[at:]);train['index']=0;seg=train['route'][0];missing=not path_valid(seg)
            if missing:
                train.update(status='fault',blockReason='前方轨道、方向或道岔已改变；恢复合法连接后继续',until=clock+60)
                # Preserve the train and its riders for repair; no deletion.
                continue
            resources=seg.get('resources',{})
            blockers=[(key,r) for key,r in state['reservations'].items() if key in resources and r['train']!=train['id']]
            if blockers:
                train.setdefault('waitSince',clock)
                train.update(status='waiting' if train.get('heldPlatform') else 'dispatch',until=min(clock+60,min(r['until'] for _,r in blockers)),blockReason='等待 '+blockers[0][0])
                continue
            if train.get('waitSince') is not None:train['delay']+=clock-train.pop('waitSince')
            held=train.pop('heldPlatform',None)
            for resource in train.pop('heldResources',[held]):
                if resource in state['reservations']:state['reservations'][resource]['until']=clock+RULES['safeSeconds']
            board(city,train,seg)
            starts_service=train['index']==0 or train['route'][train['index']-1]['direction']!=seg['direction']
            if starts_service and not seg['deadhead']:event(city,'departure',1,seg['a'],train['line'],train['direction'])
            run=max(1,seg['runMinutes']*60)
            for key in resources:
                hold=train['dwell']*60 if key==f"platform:{seg['platformB']}:{seg.get('platformFaceB',seg['direction'])}" and seg['calls'] else 0
                state['reservations'][key]=dict(train=train['id'],until=clock+run+hold+RULES['safeSeconds'])
            train.update(status='running',departed=clock,until=clock+run,blockReason='')
        state['trains']=[t for t in state['trains'] if t['status']!='finished']
        if clock>=end-EPS:break
        future=[end]
        future.extend(t['until'] for t in state['trains'] if t['until']>clock+EPS)
        future.extend(t for lid,t in state['departures'].items() if lid in lines and lines[lid].get('valid') and lines[lid]['enabled'] and t>clock+EPS)
        future.extend(p['ready'] for p in state['passengers'] if p['state'] in ('pending','walking') and p['ready']>clock+EPS)
        future.extend(p['ready']+7200 for p in state['passengers'] if p['state']=='waiting' and p['ready']+7200>clock+EPS)
        clock=min(future)
    state['clock']=end
    state['passengers']=[p for p in state['passengers'] if p['state'] not in ('complete','failed')]
    # Archive only sampled dates; do not manufacture zero-filled history.
    date=construction.date_string(end/86400)
    for old in sorted(list(state['days'])):
        if old<date:
            state['history']=([r for r in state['history'] if r['date']!=old]+[dict(date=old,**state['days'].pop(old))])[-366:]


def view(city):
    state=ensure(city);trains=[]
    colors={l['id']:l['color'] for l in city.s['lines']}
    for t in state['trains']:
        seg=t['route'][min(t['index'],len(t['route'])-1)];points=seg.get('points',[])
        if t['status']=='dispatch':points=[]
        progress=max(0,min(1,(state['clock']-t.get('departed',state['clock']))/max(1,t['until']-t.get('departed',state['clock'])))) if t['status']=='running' else 0
        lengths=[math.dist(a,b) for a,b in zip(points,points[1:])];d=sum(lengths)*progress;position=points[0] if points else None
        angle=0
        for i,length in enumerate(lengths):
            if d<=length or i==len(lengths)-1:
                a,b=points[i:i+2];k=min(1,d/max(.001,length));position=[a[j]+(b[j]-a[j])*k for j in range(2)];angle=math.atan2(b[1]-a[1],b[0]-a[0]);break
            d-=length
        trains.append({k:copy.deepcopy(t[k]) for k in ('id','line','color','length','status','station','capacity','delay','blockReason','direction')}|dict(point=position,angle=angle,onboard=load(t,state),platform=t.get('heldPlatform','').removeprefix('platform:').rsplit(':',1)[0] or None,color=colors.get(t['line'],t['color'])))
    return dict(clock=state['clock'],trains=trains,waiting=sum(p['people'] for p in state['passengers'] if p['state']=='waiting'),
                onboard=sum(p['people'] for p in state['passengers'] if p['state']=='onboard'),totals=state['totals'],days=state['days'],history=state['history'],events=state['events'][-80:],
                demandRule='按典型日旅程生成带日期的出行意图；生成后由实际候车、列车容量和到达事件计数。站内总人数未模拟。')


def validate(city):
    from .engine import number
    state=ensure(city)
    number(state['clock'],0,1e12,'铁路运行时钟')
    for key in ('trains','passengers','history','events'):
        if not isinstance(state[key],list):raise ValueError('铁路运行存档集合无效')
    if len(state['trains'])>10000 or len(state['passengers'])>200000:raise ValueError('铁路运行状态超过支持规模')
    identities=set()
    for train in state['trains']:
        if train['id'] in identities:raise ValueError('列车编号重复')
        identities.add(train['id']);number(train['capacity'],1,10000,'列车容量')
        number(train['index'],0,len(train['route'])-1,'列车进路',True)
    for p in state['passengers']:
        number(p['people'],1,100000,'乘客数量',True)
        number(p['leg'],0,len(p['legs'])-1,'乘客旅程',True)
        if p['state']=='onboard' and p['train'] not in identities:raise ValueError('乘客引用的列车不存在')
