"""Explicit, phased block renewal. Preview is pure; investment is municipal.

One project owns several single-use buildings, not a fictitious mixed-use tower.
Existing roads, protected land and public spaces never enter the demolition set.
"""
import copy
import hashlib
import json
import math
from collections import Counter

from shapely import union_all
from shapely.geometry import Polygon, Point, LineString
from shapely.ops import polygonize, unary_union
from .geometry import FRONTAGE_ROADS, ROAD_TYPES, building_footprint, stable_id
from .blocks import _polygons, _access, block_partition
from .parameters import USES
from .urban import building_style


TERMINAL = ('complete', 'cancelled')
TARGETS = {
    'commercial': ('商业中心', ('commercial', 'office')),
    'residential': ('住宅社区', ('residential', 'commercial')),
    'office': ('办公园区', ('office', 'commercial')),
    'industrial': ('产业园区', ('industrial', 'warehouse')),
    'warehouse': ('仓储园区', ('warehouse', 'industrial')),
    'mixed': ('混合街区', ('residential', 'commercial', 'office')),
}


def locked(city, parcel):
    return any(p['id'] == parcel.get('renewalProject') and p['status'] not in TERMINAL
               for p in city.s.get('renewals', []))


def displacing(city, parcel):
    return any(project['status'] not in TERMINAL and project['options']['mode']!='renovate'
               and any(phase['status'] in ('planned','waiting','demolition') and parcel['id'] in phase['sourceIds'] for phase in project['phases'])
               for project in city.s.get('renewals', []))


def _number(value, lo, hi, label, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not lo <= value <= hi or integer and int(value) != value:
        raise ValueError(f'{label}必须在 {lo}–{hi} 之间' + ('，且为整数' if integer else ''))
    return int(value) if integer else float(value)


def _options(cmd):
    mode = cmd.get('mode', 'rebuild')
    if mode not in ('rebuild', 'onsite', 'renovate'): raise ValueError('未知更新类型')
    target=cmd.get('target','commercial')
    if target not in TARGETS:raise ValueError('未知目标用途组合')
    for key in ('allowExit', 'waitForDemand'):
        if key in cmd and not isinstance(cmd[key], bool): raise ValueError('更新选项必须为布尔值')
    return dict(mode=mode,target=target, phases=_number(cmd.get('phases', 3), 1, 4, '分期数', True),
                commercialFloors=_number(cmd.get('commercialFloors', 3), 1, 8, '商业楼层', True),
                officeFloors=_number(cmd.get('officeFloors', 8), 1, 28, '办公楼层', True),
                primaryShare=_number(cmd.get('primaryShare',cmd.get('commercialShare',70)),0,100,'主用途用地目标比例'),
                residentialFloors=_number(cmd.get('residentialFloors',6),1,28,'住宅楼层',True),
                industrialFloors=_number(cmd.get('industrialFloors',2),1,4,'工业楼层',True),
                warehouseFloors=_number(cmd.get('warehouseFloors',1),1,4,'仓储楼层',True),
                coverage=_number(cmd.get('coverage', .65), .3, .85, '建筑覆盖率上限'),
                floorRatio=_number(cmd.get('floorRatio', 4), .5, 12, '容积率上限'),
                allowExit=cmd.get('allowExit', False), waitForDemand=cmd.get('waitForDemand', False))


def _scope(city, cmd):
    seed = city.parcelmap.get(cmd.get('id'))
    if not seed: raise ValueError('请选择地块作为更新起点')
    if cmd.get('mode') in ('renovate','onsite'):
        if not seed.get('building'): raise ValueError('翻新或原址重建需要现有建筑')
        return [seed], Polygon(seed['points']), []
    roads = [LineString(r['points']) for r in city.s['roads'] if r['level'] == 0 and r['kind'] in FRONTAGE_ROADS]
    faces = [p for p in polygonize(unary_union(roads)) if p.covers(Point(seed['center']))]
    if not faces: raise ValueError('请选择闭合街区内的地块；先用普通路、小路或主干道围合街区')
    face = min(faces, key=lambda p: p.area)
    within = [p for p in city.s['parcels'] if face.buffer(.01).covers(Polygon(p['points']))]
    protected = [p for p in within if p['use'] == 'protected' or p.get('openSpace') or p.get('blockCommon')]
    eligible = [p for p in within if p not in protected]
    ids = cmd.get('parcelIds')
    if ids is not None:
        if not isinstance(ids, list) or not ids or any(not isinstance(i, str) for i in ids) or len(ids) != len(set(ids)):
            raise ValueError('更新地块列表无效')
        if not set(ids) <= {p['id'] for p in eligible}: raise ValueError('更新范围跨越街区或包含公共空间、保护用地')
        eligible = [p for p in eligible if p['id'] in ids]
    if not 2 <= len(eligible) <= 100: raise ValueError('街区更新需要 2–100 块可开发地块，可缩小选择范围')
    if sum(p['area'] for p in eligible) > 250000: raise ValueError('单个更新项目不得超过 25 公顷')
    return eligible, face, protected


def _site(city, shape, land, sources, ident, common=False):
    roads = [r for r in city.s['roads'] if r['id'] in {p['road'] for p in sources} and r['kind'] in FRONTAGE_ROADS and r['level'] == 0]
    links = []
    for road in roads:
        line = LineString(road['points'])
        link = _access(shape, land, road, line, common)
        if link:
            center, front, path = link
            links.append((LineString(path).length, road, center, front, path))
    if not links: return None
    length, road, center, front, path = min(links, key=lambda l: (l[0], l[1]['id']))
    line = LineString(road['points']); d = line.project(front)
    a, b = line.interpolate(max(0, d-1)), line.interpolate(min(line.length, d+1))
    return dict(id=ident, points=[list(q) for q in shape.exterior.coords], center=list(center.coords[0]),
                road=road['id'], frontage=list(front.coords[0]), area=round(shape.area, 2), buildableArea=round(shape.area, 2),
                terrain=city.terrain.features(shape), landValue=round(sum(p['landValue']*p['area'] for p in sources)/sum(p['area'] for p in sources), 2),
                rent=10., use='auto', age=0, building=None, connected=True, source='renewal',
                streetAngle=math.degrees(math.atan2(b.y-a.y, b.x-a.x)), blockCommon=common,
                blockLayout='pair' if common else 'single', layoutVersion=9, accessPath=path, accessLength=length)


def preview(city, cmd):
    """Return a deterministic, reviewable plan without touching state or RNG."""
    opts = _options(cmd)
    sources, face, preserved = _scope(city, dict(cmd, mode=opts['mode']))
    for p in sources:
        if p['use'] == 'protected' or p.get('openSpace') or locked(city, p): raise ValueError('选区包含保护用地、公共空间或正在更新的地块')
        if not p.get('connected'): raise ValueError('更新地块需要有效的道路接入')
        b = p.get('building')
        if b and (b['status'] == 'construction' or b.get('extensionReady')): raise ValueError('请等待现有施工或加层完成后再更新')
    base = stable_id('renewal-plan-', (city.s['serial'], city.s['month'], sorted(p['id'] for p in sources), opts))
    # Stable spatial bands keep untouched phases usable while earlier phases build.
    x0,y0,x1,y1=face.bounds;axis=0 if x1-x0 >= y1-y0 else 1
    ordered=sorted(sources, key=lambda p:(p['center'][axis], p['center'][1-axis], p['id']))
    count=1 if opts['mode']=='renovate' else min(opts['phases'], len(ordered))
    groups=[ordered[i*len(ordered)//count:(i+1)*len(ordered)//count] for i in range(count)]
    all_ids={p['id'] for p in sources}
    obstacles=unary_union([Polygon(p['points']) for p in city.s['parcels'] if p['id'] not in all_ids] +
                          [LineString(r['points']).buffer(ROAD_TYPES[r['kind']]['width']/2+2) for r in city.s['roads'] if r['level']==0] +
                          [LineString(p['points']).buffer(6) for p in city.s.get('streetPlans', [])])
    phases=[];planned=[];assigned=Counter()
    target_uses=TARGETS[opts['target']][1];share=opts['primaryShare']/100
    weights={u:share if i==0 else (1-share)/(len(target_uses)-1) for i,u in enumerate(target_uses)}
    for i, group in enumerate(groups):
        phase=dict(index=i+1, sourceIds=[p['id'] for p in group], sourcePoints=[p['points'] for p in group],
                   status='planned', sites=[], cost=0, demolitionMonths=2, constructionMonths=0)
        old_area=sum(p['building']['floorArea'] for p in group if p.get('building'))
        people=sum(h['size'] for h in city.s['households'] if h['home'] in phase['sourceIds'])
        if opts['mode']=='renovate':
            phase.update(cost=round(old_area*USES[group[0]['building']['use']]['cost']*.15), demolitionMonths=0, constructionMonths=3)
        elif opts['mode']=='onsite':
            old=group[0];previous=old['building'];use=TARGETS[opts['target']][1][0]
            p=copy.deepcopy(old);p.pop('renewalProject',None);p.update(building=None,use=use,blockCommon=False)
            footprint=Polygon(previous['footprint']);floors=min(opts[use+'Floors'],p['terrain']['maxFloors'])
            if footprint.area*floors>opts['floorRatio']*p['area']+.01:
                raise ValueError('原址重建保留占地轮廓，请降低楼层或提高容积率上限')
            area=round(footprint.area*floors,1);space=city.s['policy']['householdSpace'] if use=='residential' else USES[use]['space']
            cost=round(area*USES[use]['cost']*p['terrain']['costFactor'])
            style=building_style(p,use,floors)
            p['targetBuilding']=dict(use=use,floors=floors,floorArea=area,footprintArea=round(footprint.area,1),
                footprint=copy.deepcopy(previous['footprint']),center=list(footprint.centroid.coords[0]),capacity=max(1,int(area/space)),
                cost=cost,usableArea=round(area*style['usableRatio'],1),useAreas={use:area},**style)
            p['rent']=USES[use]['rent'];phase['sites']=[p]
            phase.update(cost=cost+round(old_area*90+people*20000),constructionMonths=4+floors//2)
        else:
            raw=union_all([Polygon(p['points']) for p in group], grid_size=1e-7)
            # Only bridge sub-metre frontage gaps, never roads or retained plots.
            merged=raw.buffer(.4,join_style=2).buffer(-.4,join_style=2)
            other_phases=unary_union([Polygon(p['points']) for p in sources if p['id'] not in phase['sourceIds']])
            if merged.difference(face).area>.01 or merged.intersection(obstacles).area>.01 or merged.intersection(other_phases).area>.01:
                merged=raw
            for j, land in enumerate(_polygons(merged)):
                if land.interiors: raise ValueError('更新用地含封闭孔洞，请缩小选择范围')
                local=[p for p in group if Polygon(p['points']).intersection(land).area>1]
                if not local: continue
                shapes,common=block_partition(land,'pair',base+str(i)+str(j)) if land.area>2000 else ([land],None)
                if not shapes: shapes,common=[land],None
                candidates=[]
                for k, shape in enumerate(shapes+([common] if common is not None else [])):
                    p=_site(city,shape,land,local,f'{base}-{i}-{j}-{k}',k==len(shapes))
                    if p is None: break
                    candidates.append(p)
                if len(candidates)!=len(shapes)+(common is not None):
                    p=_site(city,land,land,local,f'{base}-{i}-{j}-0')
                    if p is None: raise ValueError('合并用地缺少合法沿街入口，请减少每期范围')
                    candidates=[p]
                block=f'{base}-block-{i}-{j}'
                for p in candidates:
                    p.update(block=block, blockBuildings=sum(not q['blockCommon'] for q in candidates), assembledFrom=[q['id'] for q in local])
                    if p['blockCommon']:
                        p['commonKind']='plaza';phase['cost']+=round(p['area']*75*p['terrain']['costFactor'])
                    else:
                        # Low discrepancy allocation expresses a land-use preference;
                        # actual floor-area shares are reported instead of promised.
                        use=max(target_uses,key=lambda u:(sum(assigned.values())+p['area'])*weights[u]-assigned[u])
                        assigned[use]+=p['area']
                        footprint=building_footprint(p,use)
                        if footprint is None: raise ValueError('地块过窄，无法放置更新建筑')
                        target=p['area']*opts['coverage']
                        lo,hi=0.,max(footprint.bounds[2]-footprint.bounds[0],footprint.bounds[3]-footprint.bounds[1])
                        if footprint.area>target:
                            original=footprint
                            for _ in range(35):
                                mid=(lo+hi)/2;parts=_polygons(original.buffer(-mid))
                                candidate=max(parts,key=lambda q:q.area) if parts else Polygon()
                                if candidate.area>target:lo=mid
                                else:hi=mid
                            parts=_polygons(original.buffer(-hi));footprint=max(parts,key=lambda q:q.area) if parts else Polygon()
                        if footprint.area<100 or footprint.interiors: raise ValueError('覆盖率限制下无法形成有效建筑，请提高覆盖率或调整范围')
                        floors=min(opts[use+'Floors'],p['terrain']['maxFloors'],int(opts['floorRatio']*p['area']/footprint.area))
                        if floors<1: raise ValueError('容积率不足以建设一层建筑')
                        area=round(footprint.area*floors,1);capacity=max(1,int(area/(city.s['policy']['householdSpace'] if use=='residential' else USES[use]['space'])))
                        cost=round(area*USES[use]['cost']*p['terrain']['costFactor'])
                        p['targetBuilding']=dict(use=use,floors=floors,floorArea=area,footprintArea=round(footprint.area,1),
                            footprint=[list(q) for q in footprint.exterior.coords],center=list(footprint.centroid.coords[0]),
                            capacity=capacity,cost=cost,usableArea=round(area*(.82 if use in ('residential','office') else .9),1),useAreas={use:area},**building_style(p,use,floors))
                        p['use']=use;p['rent']=USES[use]['rent']
                        phase['cost']+=cost;phase['constructionMonths']=max(phase['constructionMonths'],4+floors//2)
                    phase['sites'].append(p)
            phase['cost']+=round(old_area*90+people*20000)
            if not phase['sites']: raise ValueError('更新方案没有有效建筑用地')
        planned.extend(phase['sites']);phases.append(phase)
    buildings=[p['targetBuilding'] for p in planned if 'targetBuilding' in p]
    uses={u:round(sum(b['floorArea'] for b in buildings if b['use']==u),1) for u in USES}
    households=[h for h in city.s['households'] if h['home'] in all_ids]
    homes=Counter(h['home'] for h in city.s['households'])
    spare=sum(max(0,p['building']['capacity']-homes[p['id']]) for p in city.available_homes() if p['id'] not in all_ids and not displacing(city,p))
    result=dict(revision=city.s['revision'],options=opts,sourceIds=sorted(all_ids),boundary=[list(q) for q in face.exterior.coords],
                preservedIds=[p['id'] for p in preserved],phases=phases,area=round(sum(p['area'] for p in sources)),
                oldBuildings=sum(bool(p.get('building')) for p in sources),households=len(households),people=sum(h['size'] for h in households),
                firms=sum(f['status']=='active' and f['parcel'] in all_ids for f in city.s['firms']),availableHomes=spare,
                cost=sum(p['cost'] for p in phases),minimumMonths=sum(p['demolitionMonths']+p['constructionMonths'] for p in phases)+len(phases),
                buildings=len(buildings),capacity=sum(b['capacity'] for b in buildings),useAreas=uses,
                housingCapacity=sum(b['capacity'] for b in buildings if b['use']=='residential'),
                jobCapacity=sum(b['capacity'] for b in buildings if b['use']!='residential'),
                newPublicArea=round(sum(p['area'] for p in planned if p['blockCommon'])),
                oldFloorArea=round(sum(p['building']['floorArea'] for p in sources if p.get('building'))),
                floorArea=round(sum(b['floorArea'] for b in buildings)),warnings=[])
    if opts['mode']!='renovate':
        if len(households)>spare:result['warnings'].append('当前城内空余住房少于待安置家庭；实际安置还需满足租金负担条件')
        result['warnings'].append('住房和岗位容量分别计算，竣工不自动产生人口、企业或就业；投资由市政分期承担')
        if opts['waitForDemand']:result['warnings'].append('每期等待至少 20% 的新增容量需求，工期可能延后')
    result['token']=hashlib.sha256(json.dumps(result,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return result


def start(city, cmd):
    if len(city.s['renewals'])>=1000:raise ValueError('已达到 1000 个更新项目上限')
    plan=preview(city,cmd)
    if cmd.get('token')!=plan['token']:raise ValueError('更新方案已变化，请重新预览后提交')
    name=cmd.get('name',TARGETS[plan['options']['target']][0] if plan['options']['mode']!='renovate' else '建筑翻新')
    if not isinstance(name,str) or not name.strip() or len(name)>60:raise ValueError('项目名称需为 1–60 个字符')
    project=dict(plan,id=city.uid('renewal'),name=name.strip(),status='planned',created=city.s['month'],
                 spent=0,relocated=0,movedOut=0,firmsRelocated=0,firmsClosed=0,reason='等待下一月启动首期')
    city.s['renewals'].append(project)
    for pid in plan['sourceIds']:city.parcelmap[pid]['renewalProject']=project['id']
    city.event('更新',f'{name}已立项，共 {len(plan["phases"])} 期',city.parcelmap[plan['sourceIds'][0]]['center'])


def cancel(city, ident):
    project=next((p for p in city.s['renewals'] if p['id']==ident),None)
    if not project or project['status'] in TERMINAL:raise ValueError('项目已结束或不存在')
    if any(p['status'] in ('demolition','construction') for p in project['phases']):raise ValueError('请等待本期交付后再取消后续阶段')
    for phase in project['phases']:
        if phase['status']!='complete':
            phase['status']='cancelled'
            for pid in phase['sourceIds']:
                p=city.parcelmap.get(pid)
                if p:p.pop('renewalProject',None)
    project.update(status='cancelled',reason='未开工阶段已取消；已交付建筑继续运营',ended=city.s['month'])
    city.event('更新',project['name']+'取消剩余阶段')


def _relocations(city, project, phase):
    source=set(phase['sourceIds']);reserved=set(project['sourceIds']);occupancy=Counter(h['home'] for h in city.s['households'])
    assignments=[]
    for h in sorted(city.s['households'],key=lambda h:(h['income'],h['id'])):
        if h['home'] not in source:continue
        homes=[p for p in city.available_homes() if p['id'] not in reserved and not displacing(city,p)
               and occupancy[p['id']]<p['building']['capacity'] and p['rent']*city.s['policy']['householdSpace']<=h['income']*.4]
        target=min(homes,key=lambda p:(math.dist(p['center'],city.parcelmap[h['home']]['center']),p['id'])) if homes else None
        if target is None and not project['options']['allowExit']:return None
        if target:occupancy[target['id']]+=1
        assignments.append((h,target))
    return assignments


def _move(city, project, phase, assignments):
    departed=set()
    for h, target in assignments:
        origin=city.parcelmap[h['home']]['center'];people=h['size']
        if target:
            h.update(home=target['id'],stress=0,commute=None,commuteFailed=False)
            project['relocated']+=people;city.s['relocated']+=people
            endpoint=target['center'];kind='relocation'
        else:
            departed.add(h['id']);project['movedOut']+=people;city.s['movedOut']+=people
            endpoint=city.s['gateway'] or [0,0];kind='out'
        city.s['migrationFlows'].append(dict(source=origin,target=endpoint,kind=kind,people=people))
    city.s['households']=[h for h in city.s['households'] if h['id'] not in departed]
    occupied={f['parcel'] for f in city.s['firms'] if f['status']=='active'}
    for firm in city.s['firms']:
        if firm['status']!='active' or firm['parcel'] not in phase['sourceIds']:continue
        alternatives=[p for p in city.s['parcels'] if not displacing(city,p) and p.get('connected') and p['id'] not in occupied and p.get('building')
                      and p['building']['status'] in ('active','vacant') and p['building']['use']==firm['industry']
                      and p['building']['capacity']>=firm.get('employees',0)]
        if alternatives:
            new=min(alternatives,key=lambda p:(p['rent'],p['id']))
            old=firm['parcel'];firm.update(parcel=new['id'],relocations=firm.get('relocations',0)+1,lossMonths=0)
            new['building'].update(status='active',businessActive=True);occupied.add(new['id']);project['firmsRelocated']+=1
            for h in city.s['households']:
                if h.get('job')==old:h['job']=new['id']
        else:
            firm.update(status='closed',closed=city.s['month']);project['firmsClosed']+=1
    for h in city.s['households']:
        if h.get('job') in phase['sourceIds']:h['job']=None


def advance(city):
    """Advance one stage per project per month, before population and employment."""
    changed=False
    for project in city.s['renewals']:
        if project['status'] in TERMINAL:continue
        phase=next(p for p in project['phases'] if p['status']!='complete')
        mode=project['options']['mode'];now=city.s['month']
        if phase['status'] in ('planned','waiting'):
            project['status']='waiting';phase['status']='waiting'
            source=[city.parcelmap[pid] for pid in phase['sourceIds']]
            if not all(p.get('connected') for p in source):project['reason']='等待道路接入恢复';continue
            if mode!='renovate' and project['options']['waitForDemand']:
                from .development import development_targets, planned_supply
                targets=development_targets(city);supply=planned_supply(city)
                own=Counter()
                for future in project['phases']:
                    if future['status'] in ('planned','waiting'):
                        for p in future['sites']:
                            b=p.get('targetBuilding')
                            if b:own[b['use']]+=b['capacity']
                needed=Counter()
                for p in phase['sites']:
                    b=p.get('targetBuilding')
                    if b:needed[b['use']]+=b['capacity']
                if any(targets[u]-supply[u]+own[u]<units*.2 for u,units in needed.items()):project['reason']='等待目标用途需求（本期容量的 20%）';continue
            assignments=_relocations(city,project,phase) if mode!='renovate' else []
            if assignments is None:project['reason']='等待足够且可负担的城内住房，尚未搬迁或拆除';continue
            if city.s['settings']['budget'] and city.s['treasury']<phase['cost']:project['reason']='等待本期市政预算';continue
            city.spend(phase['cost'],'建筑翻新' if mode=='renovate' else '街区更新');project['spent']+=phase['cost']
            phase['started']=now;project['status']='active'
            if mode=='renovate':
                phase.update(status='construction',ready=now+phase['constructionMonths'])
                project['reason']='翻新施工中，原有空间继续使用'
            else:
                _move(city,project,phase,assignments)
                for p in source:p['building']=None
                phase.update(status='demolition',ready=now+phase['demolitionMonths'])
                project['reason']=f'第 {phase["index"]} 期拆除与场地准备'
            city.event('更新',f'{project["name"]}第 {phase["index"]} 期开工');changed=True
        elif phase['status']=='demolition' and now>=phase['ready']:
            old=set(phase['sourceIds']);city.s['parcels']=[p for p in city.s['parcels'] if p['id'] not in old]
            for template in phase['sites']:
                p=copy.deepcopy(template);b=p.pop('targetBuilding',None);p['renewalProject']=project['id']
                if b:
                    b.update(id=city.uid('b'),status='construction',ready=now+phase['constructionMonths'],age=0,condition=100.,occupied=0,positions=0,employees=0,vacantMonths=0)
                    p['building']=b
                city.s['parcels'].append(p)
            phase.update(status='construction',ready=now+phase['constructionMonths']);changed=True
            project['reason']=f'第 {phase["index"]} 期主体施工'
        elif phase['status']=='construction' and now>=phase['ready']:
            if mode=='renovate':
                b=city.parcelmap[phase['sourceIds'][0]]['building'];b.update(condition=100.,lastRenovated=now)
                b['cost']=b.get('cost',0)+phase['cost']
            else:
                for template in phase['sites']:
                    p=city.parcelmap[template['id']]
                    if p['blockCommon']:
                        fid=city.uid('f');cost=round(p['area']*75*p['terrain']['costFactor']);p['openSpace']=fid
                        city.s['facilities'].append(dict(id=fid,kind='plaza',point=p['center'][:],points=p['points'],parcel=p['id'],blockCommon=True,generated=False,
                                                        capacity=max(30,int(p['area']/4)),cost=cost,maintenance=round(cost*.004),created=now))
            phase.update(status='complete',completed=now);changed=True
            if all(p['status']=='complete' for p in project['phases']):project.update(status='complete',ended=now,reason='全部交付，入住、企业入驻与就业由城市需求决定')
            else:project.update(status='planned',reason='本期已交付，下一月评估后续阶段；可取消未开工阶段')
            city.event('更新',f'{project["name"]}第 {phase["index"]} 期交付')
    if changed:city.rebuild()


def validate(city):
    """Reject dangling project references and malformed future geometry on load."""
    projects=city.s['renewals']
    if not isinstance(projects,list) or len(projects)>1000:raise ValueError('更新项目存档无效')
    ids=[p['id'] for p in projects]
    if len(ids)!=len(set(ids)):raise ValueError('更新项目编号重复')
    for project in projects:
        _options(project['options'])
        if project['status'] not in ('planned','waiting','active',*TERMINAL):raise ValueError('更新项目状态无效')
        _number(project['spent'],0,1e15,'更新支出')
        if not 1<=len(project['phases'])<=4:raise ValueError('更新分期无效')
        if project['status']=='complete' and any(p['status']!='complete' for p in project['phases']):raise ValueError('更新项目交付状态不一致')
        for phase in project['phases']:
            _number(phase['constructionMonths'],1,36,'施工月份',True)
            _number(phase['demolitionMonths'],0,12,'拆除月份',True)
            if len(phase['sourceIds'])!=len(set(phase['sourceIds'])):raise ValueError('更新源地块重复')
            if phase['status'] not in ('planned','waiting','demolition','construction','complete','cancelled'):raise ValueError('更新阶段无效')
            _number(phase['cost'],0,1e15,'分期费用')
            if phase['status'] in ('demolition','construction'):_number(phase['ready'],0,1e9,'交付月份',True)
            if project['status'] not in TERMINAL:
                required=phase['sourceIds'] if phase['status'] in ('planned','waiting','demolition') or project['options']['mode']=='renovate' else [p['id'] for p in phase['sites']]
                if any(pid not in city.parcelmap or city.parcelmap[pid].get('renewalProject')!=project['id'] for pid in required):raise ValueError('更新项目缺少关联地块')
            source_shapes=[Polygon(q) for q in phase['sourcePoints']]
            if any(not q.is_valid or q.is_empty for q in source_shapes):raise ValueError('更新源地块几何无效')
            allowed=unary_union(source_shapes).buffer(.41)
            future_shapes=[]
            for p in phase['sites']:
                shape=Polygon(p['points'])
                if not shape.is_valid or shape.is_empty or shape.interiors:raise ValueError('更新方案用地无效')
                if not allowed.covers(shape) or any(shape.intersection(q).area>.01 for q in future_shapes):raise ValueError('更新方案越界或重叠')
                future_shapes.append(shape)
                for q in p['points']:city.point(q)
                b=p.get('targetBuilding')
                if b:
                    footprint=Polygon(b['footprint'])
                    if not footprint.is_valid or not shape.buffer(.01).covers(footprint):raise ValueError('更新建筑超出用地')
                    if b['use'] not in USES:raise ValueError('更新用途无效')
                    _number(b['floors'],1,28,'更新楼层',True)
                    _number(b['capacity'],1,100000,'更新容量',True)
                    if abs(footprint.area*b['floors']-b['floorArea'])>.11:raise ValueError('更新建筑面积不一致')
    for p in city.s['parcels']:
        if p.get('renewalProject') and p['renewalProject'] not in ids:raise ValueError('地块缺少更新项目')


def automatic(city):
    """Bounded periodic investment decisions; never force households out.

    Compare incremental rental return to retaining current buildings. The
    numbers are game estimates, not property valuations or financial forecasts.
    """
    from .development import development_targets, planned_supply
    settings=city.s['settings'];policy=city.s['policy'];now=city.s['month']
    if not settings.get('autoRenew',True) or settings['growth']<=0 or now%int(policy['renewalReviewMonths']):return
    if sum(p['status'] not in TERMINAL for p in city.s['renewals'])>=int(policy['renewalActiveLimit']):return
    if len(city.s['renewals'])>=1000:return
    budget=max(0,city.s['treasury'])*min(1,policy['renewalBudgetShare'])
    targets=development_targets(city);supply=planned_supply(city)
    gaps={u:max(0,targets[u]-supply[u]) for u in USES}
    def eligible(p):
        b=p.get('building')
        if not b or b['status']=='construction' or b.get('extensionReady') or not p.get('connected') or p['use']=='protected' or p.get('openSpace') or locked(city,p):return False
        previous=next((q for q in city.s['renewals'] if q['id']==p.get('renewalProject')),None)
        if previous and now-previous.get('ended',previous['created'])<policy['renewalCooldownMonths']:return False
        return b.get('vacantMonths',0)>=policy['redevelopVacancyMonths'] or b['age']>=policy['renewalMinimumAge']
    candidates=sorted((p for p in city.s['parcels'] if eligible(p)),key=lambda p:(-p['building'].get('vacantMonths',0),p['building'].get('condition',100),p['id']))[:8]
    choices=[];seen_blocks=set()
    def consider(args, reason, renovation=False):
        try:plan=preview(city,args)
        except ValueError:return
        if plan['cost']>budget:return
        sources=[city.parcelmap[pid] for pid in plan['sourceIds']]
        if any(not eligible(p) for p in sources if p.get('building')):return
        if any(_relocations(city,dict(sourceIds=plan['sourceIds'],options=plan['options']),phase) is None for phase in plan['phases']) and not renovation:return
        if renovation:
            p=sources[0];b=p['building'];annual=p['rent']*b['floorArea']*12*.75
            # Maintenance restores a degraded, occupied asset rather than adding
            # supply; require its continuing income to cover the work in 3 years.
            if annual*3<plan['cost']:return
            score=plan['cost']*(100-b.get('condition',100))/100
            evidence=f'建筑状况 {b.get("condition",100):.0f}/100，使用率 {b.get("occupied",0)/max(1,b["capacity"])*100:.0f}%，现有用途可维持'
        else:
            replaced=Counter();retained=0
            for p in sources:
                b=p.get('building')
                if b:
                    replaced[b['use']]+=b['capacity']
                    retained+=p['rent']*b['floorArea']*12*.75*min(1,b.get('occupied',0)/max(1,b['capacity']))
            capacities=Counter();revenue=0
            for phase in plan['phases']:
                for p in phase['sites']:
                    b=p.get('targetBuilding')
                    if not b:continue
                    capacities[b['use']]+=b['capacity']
                    local=next((q for q in sources if q['id'] in p.get('assembledFrom',[])),sources[0])
                    rent=USES[b['use']]['rent']*(1+local.get('centrality',0)*.35+local.get('cluster',0)*.35)
                    revenue+=rent*b['floorArea']*12*.75*.85
            if any(cap>max(0,gaps[u]+replaced[u])*1.25 for u,cap in capacities.items()):return
            # Same-use replacements must improve condition or add useful space.
            if len(capacities)==1 and all(p.get('building',{}).get('use') in capacities for p in sources):
                if sum(capacities.values())<=sum(replaced.values())*1.15 and all(p['building'].get('condition',100)>60 for p in sources if p.get('building')):return
            increment=revenue-retained;score=increment*policy['renewalReturnYears']-plan['cost']
            if increment<=0 or score<plan['cost']*.15:return
            evidence=f'持续空置或楼龄达到阈值，目标用途需求可消化规划容量；预计增量租金回收期 {plan["cost"]/increment:.1f} 年'
        choices.append((score,plan,args,reason+'；'+evidence))
    for p in candidates:
        b=p['building'];condition=b.get('condition',100);occupancy=b.get('occupied',0)/max(1,b['capacity'])
        if condition<=policy['renewalConditionThreshold'] and occupancy>=.5:
            consider(dict(id=p['id'],mode='renovate'),'自动选择翻新：保留现有建筑及使用者',True)
        alternatives=sorted(USES,key=lambda u:(-gaps[u],u))[:3]
        if b['use'] not in alternatives:alternatives.append(b['use'])
        for use in alternatives:
            if use in ('industrial','warehouse') and p.get('freightTime') is None:continue
            available=gaps[use]+(b['capacity'] if b['use']==use else 0)
            if available<policy['minimumProjectUnits']:continue
            space=policy['householdSpace'] if use=='residential' else USES[use]['space']
            floors=min({'residential':12,'commercial':6,'office':20,'industrial':3,'warehouse':2}[use],int(available*space/max(1,b['footprintArea'])))
            if floors<1:continue
            consider(dict(id=p['id'],mode='onsite',target=use,primaryShare=100,**{use+'Floors':floors},floorRatio=12),f'自动选择原址重建为{USES[use]["name"]}')
        # Whole-block restructuring needs persistent widespread vacancy, not a
        # single weak building. Assess each block once with the strongest need.
        try:scope,face,_=_scope(city,dict(id=p['id'],mode='rebuild'))
        except ValueError:continue
        key=face.normalize().wkb
        if key in seen_blocks:continue
        seen_blocks.add(key)
        built=[q for q in scope if q.get('building')]
        vacant=sum(q['area'] for q in built if q['building'].get('vacantMonths',0)>=policy['redevelopVacancyMonths'])
        if len(built)<3 or vacant/max(1,sum(q['area'] for q in built))<policy['renewalBlockVacancyShare']:continue
        for use in sorted(USES,key=lambda u:(-gaps[u],u))[:2]:
            if gaps[use]<policy['minimumProjectUnits'] or use in ('industrial','warehouse') and p.get('freightTime') is None:continue
            consider(dict(id=p['id'],mode='rebuild',target=use,primaryShare=85,phases=2,coverage=.55,
                          residentialFloors=3,commercialFloors=2,officeFloors=4),f'自动选择片区拆除重建为{TARGETS[use][0]}：街区持续空置面积占比 {vacant/max(1,sum(q["area"] for q in built))*100:.0f}%')
    if choices:
        _,plan,args,reason=max(choices,key=lambda row:(row[0],row[1]['token']))
        name='自动'+('翻新' if args['mode']=='renovate' else '原址重建' if args['mode']=='onsite' else '片区更新')+' · '+TARGETS[args.get('target','commercial')][0]
        start(city,dict(args,token=plan['token'],name=name))
        project=city.s['renewals'][-1];project.update(origin='automatic',decision=reason,assessedMonth=now)
        city.event('自动更新',reason,city.parcelmap[plan['sourceIds'][0]]['center'])
