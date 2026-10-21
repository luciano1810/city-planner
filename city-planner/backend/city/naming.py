"""Persistent place names, independent of the economic simulation's RNG."""
import hashlib
import random
import re

FIRST = tuple('清云松竹兰桂柳枫榆梧槐杏桃梅荷莲锦瑞嘉景文书明星月晨春秋晴碧翠青白银金安宁和远长新永承启望栖听映澄朗润泽')
SECOND = tuple('川溪泉湾湖江河洲汀浦岸桥津渡岭峰岚谷林森园庭苑轩台亭榭庐里坊城华宁安和丰盛瑞锦光晖阳辰月星风云雨露雪霁琴书墨诗雅韵')
ROAD_SUFFIXES = {
    'path': ('步道', '小径'), 'lane': ('巷', '里巷', '街'),
    'street': ('路', '街', '街', '路'), 'avenue': ('大道', '大街', '路'),
    'highway': ('快速路', '公路'), 'motorway': ('高速公路',),
    'train': ('铁路',), 'metro': ('地铁线',), 'tram': ('电车线',),
}
BUILDING_SUFFIXES = {
    'residential': ('雅苑', '公馆', '花园', '华庭', '府邸', '小筑', '居', '里'),
    'commercial': ('商厦', '购物中心', '商业广场', '百货', '商场'),
    'office': ('大厦', '中心', '商务楼', '国际中心', '科创大厦'),
    'industrial': ('工厂', '制造中心', '产业楼', '工业厂房'),
    'warehouse': ('仓储中心', '物流仓', '货运仓库'),
}
FACILITY_SUFFIXES = {
    'park': ('公园', '绿园', '花园'), 'plaza': ('广场', '市民广场', '文化广场'),
    'school': ('学校', '学堂'), 'clinic': ('诊所', '社区卫生中心'),
    'sports_arena': ('体育馆', '体育中心'), 'university': ('大学', '学院'),
    'hospital': ('医院', '医疗中心'), 'city_hall': ('市政厅',),
    'fire_station': ('消防站',), 'police_station': ('警察局',),
    'hotel': ('酒店', '大酒店', '宾馆'), 'gas_station': ('加油站',),
    'charging_station': ('充电站',), 'museum': ('博物馆',),
    'theater': ('剧院', '大剧院'), 'cinema': ('影院', '影城'),
    'convention_center': ('会展中心',), 'industrial_plant': ('工业园', '工业厂区'),
    'power_plant': ('发电厂',), 'substation': ('变电站',), 'water_plant': ('自来水厂',),
    'sewage_plant': ('污水处理厂',), 'recycling_center': ('资源回收中心',),
    'logistics_hub': ('物流中心',), 'airport': ('机场',), 'port': ('港', '港口'),
    'train_station': ('火车站',), 'parking_lot': ('停车场',), 'parking_garage': ('停车楼',),
}
GENERIC = set('公园 广场 学校 诊所 体育馆 大学校园 医院 市政厅 消防局 警察局 酒店 加油站 充电站 博物馆 剧院 电影院 会展中心 工业厂区 发电厂 变电站 自来水厂 污水处理厂 垃圾回收处理中心 物流中心 机场 港口 火车站 露天停车场 停车楼 新站 车站 区域货运 公共设施 建筑 地块 居住区 商业区 办公集聚区 工业仓储区 混合城区 CBD 待开发地块 普通路 街道 街区纵街 街区横街 主干道 快速路 高速公路 社区支路 自动社区支路 小路 步道 铁路 地铁 有轨电车 巴士线 地铁线 电车线 铁路线 有轨电车线 火车线'.split())
GENERATED_PATTERN = re.compile(r'^(?:社区(?:街|支路)\s*\d+|弯曲[纵横]街\d+|河谷\d+号路|城市\s*\d+\s*号线|城市副中心\s*\d+|CBD\s*·\s*城市主中心)$')


def generic(obj):
    name = obj.get('name', '')
    if obj.get('nameSource') in ('custom', 'generated') and name:
        return False
    return not name or name in GENERIC or bool(GENERATED_PATTERN.fullmatch(name))


def objects(city):
    for collection in ('roads', 'facilities', 'stops', 'lines', 'regionalServices', 'blockLayouts', 'districts'):
        for obj in city.s.get(collection, []):
            yield collection, obj['id'], obj
    for parcel in city.s.get('parcels', []):
        if parcel.get('building'):
            yield 'buildings', parcel['id'], parcel['building']


def suffixes(category, obj):
    if category == 'roads':
        return ROAD_SUFFIXES.get(obj.get('kind'), ('路',))
    if category == 'facilities':
        return FACILITY_SUFFIXES.get(obj.get('kind'), ('中心',))
    if category == 'buildings':
        if obj.get('landmark') == 'cbd_skyscraper':
            return ('环球中心', '国际大厦', '金融中心', '摩天大厦')
        return BUILDING_SUFFIXES.get(obj.get('use'), ('大楼',))
    if category == 'blockLayouts':
        return ('街坊', '街区', '坊', '里')
    if category == 'districts':
        return ('片区', '城区', '街区')
    if category == 'stops':
        return ('货运站',) if obj.get('role') == 'freight' else ('站',)
    if category == 'regionalServices':
        return ('货运线',)
    return ({'bus': '公交线', 'metro': '地铁线', 'train': '铁路专线', 'tram': '电车线'}.get(obj.get('mode'), '线'),)


class NameBook:
    def __init__(self, city):
        self.city = city
        self.registry = city.s.setdefault('placeNames', {})
        self.used = set(self.registry.values())
        self.used.update(obj['name'] for _, _, obj in objects(city) if not generic(obj))

    def assign(self, category, identifier, obj):
        key = category + ':' + identifier
        if not generic(obj):
            name = obj['name']
            obj.setdefault('nameSource', 'custom')
        elif key in self.registry:
            name = self.registry[key]
            obj['nameSource'] = 'generated'
        else:
            seed = str(self.city.terrain.data['config']['seed']) + ':places-v1:' + key
            rng = random.Random(hashlib.sha256(seed.encode()).digest())
            endings = suffixes(category, obj)
            # Additional characters extend the pool for large cities, rather
            # than falling back to internal IDs or changing existing names.
            attempt = 0
            while True:
                root = rng.choice(FIRST) + rng.choice(SECOND)
                if attempt >= 32:
                    root += rng.choice(SECOND)
                if attempt >= 128:
                    root += str(attempt - 127)
                name = root + rng.choice(endings)
                if name not in self.used:
                    break
                attempt += 1
            obj['nameSource'] = 'generated'
        obj['name'] = name
        self.registry[key] = name
        self.used.add(name)
        return name


def name_object(city, category, obj):
    return NameBook(city).assign(category, obj['id'], obj)


def ensure_names(city):
    book = NameBook(city)
    for category, identifier, obj in sorted(objects(city), key=lambda item: (item[0], item[1])):
        book.assign(category, identifier, obj)
    # A manually placed station and the passenger stop it creates share a name.
    stops = {s['id']: s for s in city.s.get('stops', [])}
    for facility in city.s.get('facilities', []):
        stop = stops.get(facility.get('stop'))
        if facility.get('ownsStop') and stop and stop.get('nameSource') != 'custom':
            stop['name'] = facility['name']
            book.registry['stops:' + stop['id']] = stop['name']
    blocks = {b['id']: b['name'] for b in city.s.get('blockLayouts', [])}
    for parcel in city.s.get('parcels', []):
        if parcel.get('block') in blocks:
            parcel['blockName'] = blocks[parcel['block']]


def name_districts(city, previous):
    """The largest surviving child inherits a district name after a split."""
    book = NameBook(city)
    remaining = {d['id']: d for d in previous if not generic(d)}
    districts = sorted(city.s['districts'], key=lambda d: (-len(d.get('parcels', [])), d['id']))
    claimed = set()
    for district in districts:
        key = 'districts:' + district['id']
        if key in book.registry and book.registry[key] not in claimed:
            district.update(name=book.registry[key], nameSource=remaining.get(district['id'],{}).get('nameSource','generated'))
        else:
            members = set(district.get('parcels', []))
            candidates = [(len(members.intersection(old.get('parcels', []))), identifier, old)
                          for identifier, old in remaining.items() if old['name'] not in claimed]
            candidates.sort(key=lambda item: (-item[0], item[1]))
            if candidates and candidates[0][0] > 0:
                _, identifier, old = candidates[0]
                district.update(name=old['name'], nameSource=old.get('nameSource', 'custom'))
                remaining.pop(identifier)
            elif key in book.registry:
                # A former boundary can reappear after a split, but one active
                # name must never be inherited by both children.
                book.registry.pop(key)
        book.assign('districts', district['id'], district)
        claimed.add(district['name'])
