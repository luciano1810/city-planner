"""Persistent place names, independent of the economic simulation's RNG."""
import hashlib
import random
import re

from . import place_regions

NAME_VERSION = 3
COMPACT_NAME_VERSION = 4
COMPACT_CATEGORIES = {'districts', 'blockLayouts'}

REGIONAL_CATEGORIES = {'roads', 'buildings', 'facilities', 'stops', 'blockLayouts', 'districts'}

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
    'bus_depot': ('公交总站',), 'train_station': ('火车站',), 'parking_lot': ('停车场',), 'parking_garage': ('停车楼',),
}
# Distinctive names sit between the optional local reference and type suffix.
# Avoid directional/geographical claims that have not been measured.
LOCAL_WORDS = {
    'residential': tuple('栖云 听雨 望舒 知春 映月 晴岚 云栖 竹语 棠悦 兰庭 和颂 书香 鹿鸣 澄心 静安 春晓'.split()),
    'commercial': tuple('悦汇 万象 嘉集 星悦 乐购 熙街 丰茂 尚品 汇景 瑞坊 华彩 盛集 新悦 锦集 百盛 云集'.split()),
    'office': tuple('启明 远景 致远 卓诚 智汇 博创 天成 凌云 经纬 汇智 朗成 启航 华章 嘉业 科融 观澜'.split()),
    'industrial': tuple('宏业 精工 联创 恒达 博远 华兴 鼎新 智造 荣丰 同力 新源 嘉成'.split()),
    'warehouse': tuple('通达 汇通 捷运 联运 恒通 安达 顺丰 远航 丰储 盛运 嘉运 瑞通'.split()),
    'roads': tuple('文华 书院 长乐 景明 明德 安和 朝晖 春晖 锦绣 青松 翠竹 芳华 望舒 澄明 嘉禾 榆荫'.split()),
    'places': tuple('和鸣 知新 明远 嘉禾 长宁 文澜 春和 景行 星河 芳林 晴和 锦溪 青禾 思源 望春 瑞景'.split()),
}


def distinct_stem(rng, category, obj, root, attempt):
    words = LOCAL_WORDS.get(obj.get('use') if category == 'buildings' else category,
                            LOCAL_WORDS['places'])
    # Mix curated words with a much wider character pool. Do not walk a short
    # list of almost identical region+suffix names before trying other stems.
    word = rng.choice(words) if attempt < 24 and rng.random() < .5 else rng.choice(FIRST) + rng.choice(SECOND)
    if root:
        style = rng.randrange(4)
        if style == 0:
            word = root + word
        elif style == 1:
            word = rng.choice(root) + word
    if attempt >= 32:
        word += rng.choice(SECOND)
    if attempt >= 128:
        # An alphabetic expansion keeps even very large cities free of numeric
        # duplicate labels. Its length grows with the collision count.
        alphabet = tuple(dict.fromkeys(SECOND))
        index = attempt - 128
        while True:
            word += alphabet[index % len(alphabet)]
            index = index // len(alphabet) - 1
            if index < 0:
                break
    return word


GENERIC = set('公园 广场 学校 诊所 体育馆 大学校园 医院 市政厅 消防局 警察局 酒店 加油站 充电站 博物馆 剧院 电影院 会展中心 工业厂区 发电厂 变电站 自来水厂 污水处理厂 垃圾回收处理中心 物流中心 机场 港口 火车站 露天停车场 停车楼 新站 车站 区域货运 公共设施 建筑 地块 居住区 商业区 办公集聚区 工业仓储区 混合城区 CBD 待开发地块 普通路 街道 街区纵街 街区横街 主干道 快速路 高速公路 社区支路 自动社区支路 小路 步道 铁路 地铁 有轨电车 巴士线 地铁线 电车线 铁路线 有轨电车线 火车线'.split())
GENERATED_PATTERN = re.compile(r'^(?:社区(?:街|支路)\s*\d+|弯曲[纵横]街\d+|河谷\d+号路|城市\s*\d+\s*号线|城市副中心\s*\d+|CBD\s*·\s*城市主中心)$')


def generic(obj):
    name = obj.get('name', '')
    if obj.get('nameSource') in ('custom', 'generated') and name:
        return False
    return not name or name in GENERIC or bool(GENERATED_PATTERN.fullmatch(name))


def objects(city):
    for collection in ('roads', 'facilities', 'stops', 'lines', 'regionalServices', 'blockLayouts', 'districts', 'namingRegions'):
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
    if category == 'namingRegions':
        return ('片区',)
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
        self.parcels = {p['id']: p for p in city.s.get('parcels', [])}
        self.regions_ready = False
        self.owners = {}
        self.shared = {}
        for facility in city.s.get('facilities', []):
            if facility.get('ownsStop') and facility.get('stop'):
                a, b = 'facilities:' + facility['id'], 'stops:' + facility['stop']
                self.shared[a] = b; self.shared[b] = a
        for category, identifier, obj in objects(city):
            if not generic(obj):
                self.owners.setdefault(obj['name'], set()).add(category + ':' + identifier)
        self.used = set(self.registry.values())
        self.used.update(obj['name'] for _, _, obj in objects(city) if not generic(obj))

    def regional_root(self, category, identifier, obj):
        if category not in REGIONAL_CATEGORIES:
            return None
        location = self.parcels.get(identifier, {}) if category == 'buildings' else obj
        point = place_regions.anchor(category, location, self.parcels)
        region = place_regions.region_at(self.city, point)
        if region is None:
            return None
        # Name all regions in terrain order before naming any child. Even the
        # first road is therefore independent of construction/enumeration order.
        if not self.regions_ready:
            for area in self.city.s['namingRegions']:
                if generic(area):
                    self.assign('namingRegions', area['id'], area)
            self.regions_ready = True
        obj['nameRegion'] = region['id']
        return region['name'][:-2]  # region suffix is always 片区

    def assign(self, category, identifier, obj):
        key = category + ':' + identifier
        root = self.regional_root(category, identifier, obj)
        # Keep region/district identity, but upgrade the former repetitive
        # child names once. Custom names always take precedence.
        generated = obj.get('nameSource') == 'generated'
        duplicate = (generated and bool(self.owners.get(obj.get('name'), set()) -
                     {key, self.shared.get(key)}))
        target_version = COMPACT_NAME_VERSION if category in COMPACT_CATEGORIES else NAME_VERSION
        endings = suffixes(category, obj)
        old_name = obj.get('name', '') or self.registry.get(key, '')
        ending = next((e for e in sorted(endings, key=len, reverse=True) if old_name.endswith(e)), '')
        old_stem = old_name[:-len(ending)] if ending else old_name
        compact_upgrade = (category in COMPACT_CATEGORIES and len(old_stem) > 3
                           and (generated or generic(obj) and key in self.registry)
                           and obj.get('nameVersion', 0) < COMPACT_NAME_VERSION)
        if compact_upgrade:
            # Remove the accidentally appended word while retaining the old
            # district's identity, even if its centre has since moved regions.
            root = old_stem[:2]
        upgrade = compact_upgrade or (category in REGIONAL_CATEGORIES - {'districts'}
                   and (generated or generic(obj) and key in self.registry)
                   and (obj.get('nameVersion', 0) < NAME_VERSION or duplicate))
        if upgrade:
            self.owners.get(obj.get('name'), set()).discard(key)
            obj['name'] = ''
            self.registry.pop(key, None)
        if not generic(obj):
            name = obj['name']
            obj.setdefault('nameSource', 'custom')
        elif key in self.registry:
            name = self.registry[key]
            obj['nameSource'] = 'generated'
        else:
            seed = str(self.city.terrain.data['config']['seed']) + ':places-v1:' + key
            rng = random.Random(hashlib.sha256(seed.encode()).digest())
            attempt = 0
            offset = rng.randrange(len(endings)) if category in COMPACT_CATEGORIES else 0
            while True:
                if category in COMPACT_CATEGORIES:
                    # Try the short local name with each legal suffix first.
                    # Several districts in one region can then borrow one local
                    # character, instead of appending another two-character word.
                    if root and attempt < len(endings):
                        stem = root[:3]
                    else:
                        first = root[0] if root and attempt < 32 else rng.choice(FIRST)
                        stem = first + rng.choice(SECOND)
                        if attempt >= 64:
                            stem += rng.choice(SECOND)
                    ending = endings[(offset + attempt) % len(endings)]
                elif category == 'namingRegions':
                    # Preserve the established seed-to-region naming scheme.
                    stem = rng.choice(FIRST) + rng.choice(SECOND)
                    if attempt >= 32:
                        stem += rng.choice(SECOND)
                    ending = rng.choice(endings)
                else:
                    stem = distinct_stem(rng, category, obj, root, attempt)
                    ending = rng.choice(endings)
                name = stem + ending
                if name not in self.used:
                    break
                attempt += 1
            obj['nameSource'] = 'generated'
        if obj.get('nameSource') == 'generated':
            obj['nameVersion'] = target_version
        obj['name'] = name
        self.registry[key] = name
        self.used.add(name)
        self.owners.setdefault(name, set()).add(key)
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
    # Migrate ancestors before overlap matching, so split/merge inheritance
    # claims the compact name rather than the obsolete four-character stem.
    for old in sorted(previous, key=lambda d: d['id']):
        if not generic(old):
            book.assign('districts', old['id'], old)
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
