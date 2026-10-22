"""Bus operating choices and demand observations from assigned passenger journeys.

Profiles are representative-day boardings, not live vehicle occupancy or unique
people. History records the actual simulation date, independent of settlement
cadence. Reassigning on the same date replaces that date's observation.
"""
import copy
import math
from collections import Counter

from . import construction


VEHICLES = {
    'minibus': dict(name='社区小巴', capacity=30, length=7.2, width=2.3, vehicleCost=1200, kmCost=5),
    'standard': dict(name='标准公交车', capacity=70, length=10.8, width=2.5, vehicleCost=2000, kmCost=8),
    'articulated': dict(name='铰接公交车', capacity=140, length=18., width=2.5, vehicleCost=3200, kmCost=11),
}


def vehicle(line):
    return VEHICLES.get(line.get('vehicleType'), VEHICLES['standard'])


def headway(line):
    return line.get('serviceHeadway', line['headway'])


def configure(line, command):
    if line['mode'] != 'bus':
        if 'vehicleType' in command or 'assignedFleet' in command:
            raise ValueError('车辆管理目前仅支持公交车')
        return
    if 'vehicleType' in command:
        key = command['vehicleType']
        if not isinstance(key, str) or key not in VEHICLES:
            raise ValueError('请选择有效的公交车型')
        line.update(vehicleType=key, capacity=VEHICLES[key]['capacity'])
    elif 'capacity' in command and line.get('vehicleType') in VEHICLES:
        if command['capacity'] != vehicle(line)['capacity']:
            line.pop('vehicleType', None)  # Preserve legacy custom-capacity lines.
    if 'assignedFleet' in command:
        count = command['assignedFleet']
        if count is not None and (type(count) is not int or not 1 <= count <= 100):
            raise ValueError('车辆数量必须为 1–100 的整数')
        line['assignedFleet'] = count


def validate(line):
    if 'vehicleType' in line and line['vehicleType'] not in VEHICLES:
        raise ValueError('存档公交车型无效')
    fleet = line.get('assignedFleet')
    if fleet is not None and (type(fleet) is not int or not 1 <= fleet <= 100):
        raise ValueError('存档公交车辆数量无效')


def service(line, segments, directions, default):
    """Apply fleet-based frequency to capacity, waits, traffic and expenses alike."""
    assigned = line.get('assignedFleet') if line['mode'] == 'bus' else None
    line['fleet'] = assigned or max(1, math.ceil(line['cycle'] / line['headway']))
    line['serviceHeadway'] = max(.5, line['cycle'] / assigned) if assigned else line['headway']
    cfg = vehicle(line) if line['mode'] == 'bus' and line.get('vehicleType') else default
    daily_km = line['length'] * directions / 1000 * 60 / headway(line) * line['hours']
    line['operatingCost'] = line['fleet'] * cfg['vehicleCost'] + daily_km * cfg['kmCost'] * 30
    for segment in segments:
        segment['capacity'] = line['capacity'] * 120 / headway(line)


def calls(city, route, departure):
    """Retain only transit call information, including transfer walks and waits."""
    lines = {line['id']: line for line in city.s['lines']}
    elapsed = departure
    result = []
    for edge in route['path']:
        if edge['kind'] == 'board':
            line = lines[edge['ref']]
            interval = headway(line)
            if interval >= city.s['policy']['lowFrequencyHeadway']:
                start = line.get('startHour', 6) * 60
                elapsed += (interval - (elapsed - start) % interval) % interval - interval / 2
        elapsed += edge['time']
        if edge['kind'] in ('board', 'alight'):
            result.append(dict(line=edge['ref'], stop=edge['origin'] if edge['kind']=='board' else edge['to'],
                               kind=edge['kind'], minute=elapsed % 1440))
    return result


def profile(stops):
    return dict(hourly=[0]*24, stops={sid: dict(boardings=0, alightings=0, purposes={}) for sid in stops})


def record(city, trips):
    profiles = {line['id']: profile(line['stops']) for line in city.s['lines'] if line['mode']=='bus'}
    for trip in trips:
        for call in trip.get('transitCalls', []):
            data = profiles.get(call['line'])
            if data is None or call['stop'] not in data['stops']:
                continue
            stop = data['stops'][call['stop']]
            count = trip.get('people', 1)
            if call['kind'] == 'board':
                data['hourly'][int(call['minute']//60) % 24] += count
                stop['boardings'] += count
            else:
                stop['alightings'] += count
            purpose = trip['purpose']
            stop['purposes'][purpose] = stop['purposes'].get(purpose, 0) + count
    date = construction.date_string(construction.day(city))
    for line in city.s['lines']:
        if line['id'] not in profiles:
            continue
        line['demandProfile'] = profiles[line['id']]
        line['demandDate'] = date
        observation = dict(date=date, boardings=line.get('boardings', 0), load=line.get('load', 0),
                           fleet=line.get('fleet', 0), headway=headway(line))
        history = [row for row in line.get('demandHistory', []) if row['date'] < date]
        line['demandHistory'] = (history + [observation])[-366:]


def details(city, identity):
    line = next((line for line in city.s['lines'] if line['id']==identity and line['mode']=='bus'), None)
    if line is None:
        raise ValueError('公交线路不存在')
    data = line.get('demandProfile')
    stops = {stop['id']: stop for stop in city.s['stops']}
    population = Counter()
    for household in city.s['households']:
        population[household['home']] += household['size']
    rows = []
    for sid in line['stops']:
        if sid not in stops:
            rows.append(dict(id=sid, name='站点已删除', missing=True, boardings=0, alightings=0, purposes={}, residents=0, jobs=0))
            continue
        reachable = city.distances(sid, 'walk')[0]
        residents = sum(count for pid, count in population.items() if reachable.get(pid, math.inf)<=5)
        jobs = sum(p['building'].get('positions', 0) for p in city.s['parcels']
                   if reachable.get(p['id'], math.inf)<=5 and p.get('building')
                   and p['building']['status']=='active' and p['building'].get('businessActive', True))
        jobs += sum(f.get('positions', 0) for f in city.s['facilities'] if reachable.get(f['id'], math.inf)<=5)
        demand = (data or profile([]))['stops'].get(sid, dict(boardings=0, alightings=0, purposes={}))
        rows.append(dict(id=sid, name=stops[sid]['name'], residents=residents, jobs=jobs,
                         allBoardings=stops[sid].get('boardings', 0), allAlightings=stops[sid].get('alightings', 0), **demand))
    return copy.deepcopy(dict(line=line, stops=rows, vehicles=VEHICLES, hourly=data['hourly'] if data else None,
        history=line.get('demandHistory', []), date=line.get('demandDate'),
        rule='客流为最近一次交通分配的典型日上车人次，换乘与往返分别计次；日内按预计上车时刻归入小时。站点需求为本线已承接的上下车人次，尚未乘车的潜在需求以步行 5 分钟可达人口和岗位单列。历史每个模拟日期保留最后一次分配结果，非实时车内人数。'))
