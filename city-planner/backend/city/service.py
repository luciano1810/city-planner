"""Serialized local sessions, atomic gzip saves and independent scenario branches."""
import copy
import gzip
import json
import math
import os
import re
import tempfile
import threading
import uuid
import hashlib
from pathlib import Path

from .engine import City, MODEL_VERSION, number
from height_format import MAX_SAVE_BYTES
from .urban import aggregate_flows
from .reporting import metric_definitions
from .simulation import month_days


class CityService:
    def __init__(self, directory=None):
        self.lock = threading.RLock()
        self.worlds, self.cities = {}, {}
        self.preparation = None
        self.directory = Path(directory or os.environ.get('SHANHAI_DATA_DIR', Path.home() / '.shanhai' / 'saves'))

    def close(self):
        if self.preparation is not None:
            self.preparation.cancel()
            self.preparation=None

    def register(self, terrain):
        with self.lock:
            key = uuid.uuid4().hex
            self.worlds[key] = terrain
            while len(self.worlds) > 2:
                self.worlds.pop(next(iter(self.worlds)))
            return key

    @staticmethod
    def key(name):
        if not isinstance(name, str) or not name.strip() or not re.fullmatch(r'[\w\u4e00-\u9fff -]{1,60}', name):
            raise ValueError('存档名仅支持文字、数字、空格和短横线，最长 60 字')
        return name.strip()

    def save(self, city, name, mode='replace', kind='manual'):
        name = self.key(name)
        if mode not in ('new', 'overwrite', 'replace'):
            raise ValueError('请选择新建存档或覆盖存档')
        self.directory.mkdir(parents=True, exist_ok=True)
        target = self.directory / (name + '.json.gz')
        if mode == 'new' and target.exists():
            raise ValueError('同名存档已存在，请更换名称或选择覆盖存档')
        if mode == 'overwrite' and not target.exists():
            raise ValueError('要覆盖的存档不存在，请重新选择或新建存档')
        snapshot = city.snapshot()
        snapshot['saveInfo'] = dict(name=name, kind=kind)
        if kind == 'manual':
            snapshot['state']['name'] = name
        payload = json.dumps(snapshot, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode()
        fd, temporary = tempfile.mkstemp(prefix='.saving-', dir=self.directory)
        try:
            with os.fdopen(fd, 'wb') as handle:
                # Autosaves sit on the simulation response path. A fast,
                # lossless gzip level avoids blocking the next tick on size
                # optimization; manual saves retain the compact encoding.
                handle.write(gzip.compress(payload,compresslevel=1 if kind=='automatic' else 9))
                handle.flush()
                os.fsync(handle.fileno())
            if mode == 'new':
                # Exclusive publication also protects against another app instance.
                try:
                    os.link(temporary, target)
                except FileExistsError:
                    raise ValueError('同名存档已存在，请更换名称或选择覆盖存档')
            else:
                os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        if kind == 'manual':
            city.s['name'] = name
        return dict(name=name, path=str(target), bytes=target.stat().st_size)

    def autosave(self, city, label='自动保存'):
        group = city.s.setdefault('saveGroup', uuid.uuid4().hex)
        return self.save(city, f'{label} {group}', kind='automatic')

    def handle(self, action, payload):
        if not isinstance(payload, dict):
            raise ValueError('参数必须为对象')
        with self.lock:
            if action in ('scenario','create','load','import','command','step'):
                self.close()
            if action == 'scenario':
                from .scenario import valley_world,build_valley,build_small_blocks
                small=payload.get('variant')=='blocks'
                if payload.get('variant') == 'architectural':
                    from .visual_case import build_visual_case
                    city = build_visual_case()
                elif payload.get('mature'):
                    root=Path(__file__).resolve().parents[3]/'examples'
                    path=root/('blocks-v8-final.json.gz' if small else 'valley-v5-final.json.gz')
                    if not small and not path.exists():path=root/'valley-v4-final.json.gz'
                    if not small and not path.exists():path=root/'valley-final.json.gz'
                    if not path.exists():raise ValueError('复杂案例存档尚未生成，可先创建空白路网')
                    with gzip.open(path,'rt') as handle:city=City.restore(json.load(handle))
                else:
                    city=City(valley_world(),'街区自然生长案例' if small else '双岸河谷复杂测试城市')
                    city=build_small_blocks(city,irregular=True) if small else build_valley(city)
                key=uuid.uuid4().hex;self.cities[key]=city
                terrain=dict(city.terrain.data);terrain['worldId']=self.register(city.terrain.data)
                return dict(id=key,city=city.view(),terrain=terrain)
            if action == 'create':
                terrain = self.worlds.get(payload.get('worldId'))
                if not terrain:
                    raise ValueError('地形已失效，请重新生成后开始建设')
                city = City(terrain, payload.get('name', '山海新城'))
                key = uuid.uuid4().hex
                # Confirmation succeeds only once the initial map is durable.
                initial = self.autosave(city, '地形起点') if payload.get('saveTerrain') else None
                self.cities[key] = city
                return dict(id=key, city=city.view(), initialSave=initial)
            if action == 'saves':
                return dict(saves=[dict(name=p.name[:-8], modified=p.stat().st_mtime, bytes=p.stat().st_size)
                                   for p in sorted(self.directory.glob('*.json.gz'), key=lambda p: p.stat().st_mtime, reverse=True)])
            if action in ('load', 'import'):
                if action == 'load':
                    path = self.directory / (self.key(payload.get('name')) + '.json.gz')
                    if not path.exists():
                        raise ValueError('存档不存在')
                    with gzip.open(path, 'rb') as handle:
                        raw = handle.read(MAX_SAVE_BYTES + 1)
                    if len(raw) > MAX_SAVE_BYTES:
                        raise ValueError('存档解压后过大')
                    snapshot = json.loads(raw)
                else:
                    snapshot = payload.get('snapshot')
                city = City.restore(snapshot)
                key = uuid.uuid4().hex
                self.cities[key] = city
                terrain = dict(city.terrain.data)
                terrain['worldId'] = self.register(city.terrain.data)
                manual = action == 'load' and snapshot.get('saveInfo', {}).get('kind', 'manual') == 'manual'
                return dict(id=key, city=city.view(), terrain=terrain,
                            saveName=payload['name'] if manual else None)
            city = self.cities.get(payload.get('id'))
            if city is None:
                raise ValueError('城市会话不存在，请从存档恢复')
            if action == 'state':
                return city.view()
            if action == 'clock':
                minute=number(payload.get('minute'),0,1439,'模拟时刻',True)
                city.s['sceneTimeSeconds']=math.floor(city.s['sceneTimeSeconds']/86400)*86400+minute*60.
                clock=city.s['simulation']
                # Scrubbing the sun changes presentation, never economic time.
                return dict(sceneTimeSeconds=city.s['sceneTimeSeconds'],simulation=copy.deepcopy(clock))
            if action == 'simulate':
                from .simulation import advance
                if type(payload.get('incremental',False)) is not bool:raise ValueError('无效的增量计算设置')
                if payload.get('incremental'):
                    from .monthly import advance_incremental
                    result=advance_incremental(self,city,payload)
                else:
                    self.close()
                    result=advance(city,payload.get('seconds',0),payload.get('speed'),
                                   payload.get('mode','observed'),payload.get('reset',False),payload.get('daylightSeconds'))
                if result['monthsAdvanced'] or result.get('settlementsAdvanced'):
                    try:self.autosave(city)
                    except OSError as exc:result['saveWarning']='自动保存失败，请检查磁盘空间：'+str(exc)
                return result
            if action == 'traffic':
                from .signals import LiveTraffic
                mode=payload.get('mode','observed')
                if mode not in ('observed','test'):raise ValueError('未知车流来源')
                seconds=number(payload.get('seconds',0),0,10,'实景秒数')
                if not isinstance(payload.get('reset',False),bool):raise ValueError('无效的重置参数')
                if city.live_traffic is None or payload.get('reset') or city.live_traffic.mode!=mode:
                    city.live_traffic=LiveTraffic(city,mode)
                result=city.live_traffic.advance(seconds)
                city.s['sceneTimeSeconds']+=seconds
                # Compatibility endpoint for existing clients. New clients use
                # simulate, which also settles crossed calendar months.
                city.s['simulation']['elapsedSeconds']=city.live_traffic.clock
                duration=month_days(city.s['month'])*86400
                city.s['simulation']['monthSeconds']=(city.s['simulation']['monthSeconds']+seconds)%duration
                result['sceneTimeSeconds']=city.s['sceneTimeSeconds']
                return result
            if action == 'command':
                command=payload.get('command',{})
                checkpoint=command.get('type') in ('delete','road_edit','road_update','renewal_start','renewal_cancel')
                if command.get('type')=='road' and (city.s['facilities'] or city.s['renewals'] or any(p.get('building') for p in city.s['parcels'])):
                    impact=city.preview_road(command).get('clearance',{})
                    checkpoint=bool(impact.get('buildings') or impact.get('facilities') or impact.get('cancelledProjects'))
                if checkpoint:
                    self.autosave(city, '编辑前检查点')
                return city.command(payload.get('command'))
            if action == 'step':
                result = city.step(payload.get('months', 1))
                try:
                    self.autosave(city)
                except OSError as exc:
                    result['saveWarning'] = '自动保存失败，请检查磁盘空间：' + str(exc)
                return result
            if action == 'save':
                mode = payload.get('mode', 'new')
                if mode not in ('new', 'overwrite'):
                    raise ValueError('请选择新建存档或覆盖存档')
                return self.save(city, payload.get('name'), mode=mode)
            if action == 'checkpoint':
                return self.autosave(city)
            if action == 'export':
                return city.snapshot()
            if action == 'inspect':
                return city.inspect(payload.get('objectId'))
            if action == 'route':
                if payload.get('source') not in city.parcelmap or payload.get('target') not in city.parcelmap:
                    raise ValueError('请选择两个地块')
                result = city.route(payload['source'], payload['target'], bool(payload.get('car', True)))
                return dict(route=result, points=city.path_points(result['path']) if result else [])
            if action == 'renewal_preview':
                from .renewal import preview
                return preview(city, payload.get('command',{}))
            if action == 'preview':
                return city.preview_road(payload.get('command',{}))
            if action == 'special_preview':
                from .special_buildings import preview
                return preview(city,payload.get('command',{}))
            if action == 'bus_preview':
                from .bus_transit import preview
                return preview(city,payload.get('command',{}))
            if action == 'query':
                return city.query(payload)
            if action == 'summary':
                from .construction import day,date_string
                return dict(model=MODEL_VERSION,name=city.s['name'],month=city.s['month'],settings=city.s['settings'],policy=city.s['policy'],
                            stats=city.s['stats'],districts=city.s['districts'],annual=city.s['annual'],
                            date=date_string(day(city)),dailyHistory=city.s['dailyHistory'],
                            units=dict(land='模拟币/m² 土地',rent='模拟币/m² 建筑/月',traffic='典型工作日',time='分钟'),
                            terrain=city.terrain.data['grid'],origin=city.s.get('origin'),events=city.s['events'],
                            metrics=metric_definitions(city.s['stats'],MODEL_VERSION),accessibilityGroups=city.s.get('accessibilityGroups',[]),
                            aggregateFlows=aggregate_flows(city),capitalAccounts=city.s.get('capitalAccounts',{}),operatingAccounts=city.s.get('operatingAccounts',{}))
            if action == 'compare':
                path=self.directory/(self.key(payload.get('name'))+'.json.gz')
                if not path.exists(): raise ValueError('对照存档不存在')
                with gzip.open(path,'rb') as handle: raw=handle.read(MAX_SAVE_BYTES + 1)
                if len(raw)>MAX_SAVE_BYTES: raise ValueError('对照存档过大')
                snapshot=json.loads(raw)
                other=City.restore(snapshot)
                warnings=[]
                if city.s.get('origin',{}).get('id')!=other.s.get('origin',{}).get('id') or not city.s.get('origin'):
                    warnings.append('未确认共同检查点；仅展示观察差异，不作为单一建设的因果结果')
                if city.s['month']!=other.s['month']: warnings.append('模拟期限不同')
                if city.s['settings']!=other.s['settings']: warnings.append('区域情景参数不同')
                if snapshot['model']!=MODEL_VERSION or bool(city.s.get('migrationNote'))!=bool(other.s.get('migrationNote')): warnings.append('模型迁移历史不同，旧指标不保证可直接比较')
                if city.s['policy']!=other.s['policy']: warnings.append('模拟校准参数不同')
                keys=['population','housing','jobs','employed','commute','commuteP90','accessJobs','boardings','landValue','rent','vacancy','treasury','maintenance','constructionCost']
                deltas={key:(city.s['stats'].get(key)-other.s['stats'].get(key)) if isinstance(city.s['stats'].get(key),(int,float)) and isinstance(other.s['stats'].get(key),(int,float)) else None for key in keys}
                previous={p['id']:p for p in other.s['parcels']}
                parcels=[dict(id=p['id'],land=p['landValue']-previous[p['id']]['landValue'],jobs=p.get('accessJobs',0)-previous[p['id']].get('accessJobs',0)) for p in city.s['parcels'] if p['id'] in previous]
                return dict(current=dict(name=city.s['name'],month=city.s['month'],model=MODEL_VERSION,settings=city.s['settings'],origin=city.s.get('origin')),
                            reference=dict(name=other.s['name'],month=other.s['month'],model=MODEL_VERSION,settings=other.s['settings'],origin=other.s.get('origin')),
                            warnings=warnings,deltas=deltas,parcels=parcels)
            if action == 'branch':
                if not city.s.get('origin') or city.s['origin']['month']!=city.s['month']:
                    digest=hashlib.sha256(json.dumps(city.s,sort_keys=True,ensure_ascii=False).encode()).hexdigest()[:20]
                    city.s['origin']=dict(id=digest,month=city.s['month'],model=MODEL_VERSION,settings=copy.deepcopy(city.s['settings']))
                self.autosave(city, '方案检查点')
                branch = City.restore(city.snapshot())
                branch.s['name'] = str(payload.get('name', city.s['name'] + '方案'))[:60]
                branch.s['saveGroup'] = uuid.uuid4().hex
                key = uuid.uuid4().hex
                self.cities[key] = branch
                return dict(id=key, city=branch.view(), baseline=copy.deepcopy(city.s['stats']))
            if action == 'close':
                self.cities.pop(payload['id'])
                return dict(closed=True)
            raise ValueError('未知城市接口')
