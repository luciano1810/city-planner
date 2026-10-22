"""Finite, chronological taxi dispatch for the representative working day.

Vehicles wait at legal frontage accesses, drive to pickups on the directed road
graph and remain at their last drop-off. Quotes never reserve a vehicle. The
fleet is privately operated; fares are household costs, not municipal revenue.
"""
import math
from collections import Counter, OrderedDict, defaultdict

from .routing import reconstruct, shortest_paths


DEFAULTS = dict(enabled=False, fleetSize=24, baseFare=12., includedKm=3.,
                perKm=2.4, perMinute=.4, maxWaitMinutes=12., startHour=6, hours=18)
LIMITS = dict(fleetSize=(0,500,True), baseFare=(0,100,False), includedKm=(0,20,False),
              perKm=(0,20,False), perMinute=(0,10,False), maxWaitMinutes=(1,60,False),
              startHour=(0,23,True), hours=(1,24,True))
DISPATCH_MINUTES = 1.
BOARDING_MINUTES = .5
ALIGHTING_MINUTES = .5


def settings(values, current=None):
    from .engine import number
    if not isinstance(values, dict):
        raise ValueError('出租车设置必须为对象')
    result = {**DEFAULTS, **(current or {})}
    for key, value in values.items():
        if key == 'enabled':
            if type(value) is not bool:
                raise ValueError('出租车运营开关必须为布尔值')
            result[key] = value
        elif key in LIMITS:
            low, high, integer = LIMITS[key]
            result[key] = number(value, low, high, '出租车 '+key, integer)
        else:
            raise ValueError('未知出租车设置')
    return result


def enabled(city):
    cfg = city.s['taxi']
    return cfg['enabled'] and cfg['fleetSize'] > 0


def service_time(city, departure):
    start = city.s['taxi']['startHour']*60
    return start+(departure-start) % 1440


class Dispatch:
    def __init__(self, city):
        self.city, self.cfg = city, city.s['taxi']
        self.start = self.cfg['startHour']*60
        self.end = self.start+self.cfg['hours']*60
        # Deterministic staging across actual frontage accesses. Occupied homes
        # take priority; a city without residents can still quote future trips.
        homes = Counter(h['home'] for h in city.s['households'])
        parcels = [p for p in city.s['parcels'] if p.get('connected') and p.get('access')
                   and p['id'] in city.graphs['car']]
        occupied = [p for p in parcels if homes[p['id']]]
        sites = sorted(occupied or parcels, key=lambda p: p['id'])
        self.stopping_locations = {p['id'] for p in parcels} | {
            f['id'] for f in city.s['facilities'] if f.get('connected')}
        self.vehicles = [dict(id=f'taxi-{i+1}', location=sites[i*len(sites)//self.cfg['fleetSize']]['id'],
                              available=self.start, busy=0., trips=0)
                         for i in range(self.cfg['fleetSize'])] if sites and enabled(city) else []
        self.paths = OrderedDict()
        self.reverse = defaultdict(list)
        if self.vehicles:
            for origin, edges in city.graphs['car'].items():
                for edge in edges:
                    self.reverse[edge['to']].append(dict(to=origin,time=edge['time']))
        self.pickup_fields = OrderedDict()
        self.completed = self.rescued = 0
        self.waits, self.empty_journeys, self.bookings = [], [], []
        self.failures = Counter()
        self.occupied_km = self.empty_km = self.revenue = 0.

    def path(self, source, target):
        key = source, target
        if key not in self.paths:
            distances, previous = self.city.distances(source, 'car')
            minutes = distances.get(target, math.inf)
            path = reconstruct(previous, source, target) if math.isfinite(minutes) else []
            self.paths[key] = (minutes, sum(e.get('length',0) for e in path), path)
            if len(self.paths) > 1024:
                self.paths.popitem(last=False)
        else:
            self.paths.move_to_end(key)
        return self.paths[key]

    def quote(self, source, target, departure):
        departure = service_time(self.city, departure)
        if departure >= self.end:
            return None, '非运营时段'
        if source not in self.stopping_locations or target not in self.stopping_locations:
            return None, '缺少合法上下客接入'
        minutes, distance, path = self.path(source, target)
        if not math.isfinite(minutes) or source == target:
            return None, '道路不连通'
        if not self.vehicles:
            return None, '无可达空车'
        if source not in self.pickup_fields:
            distances = shortest_paths(self.reverse,source)[0]
            # Retain only eligible stopping locations, not every graph node.
            self.pickup_fields[source] = {key:value for key,value in distances.items()
                                         if key in self.stopping_locations}
            if len(self.pickup_fields)>128:
                self.pickup_fields.popitem(last=False)
        else:
            self.pickup_fields.move_to_end(source)
        best = None
        for index, vehicle in enumerate(self.vehicles):
            ready = max(departure+DISPATCH_MINUTES, vehicle['available'])
            pickup_minutes = self.pickup_fields[source].get(vehicle['location'], math.inf)
            pickup = ready+pickup_minutes
            if best is None or (pickup, vehicle['id']) < (best[0], best[2]):
                best = pickup, index, vehicle['id'], ready
        if best is None or not math.isfinite(best[0]):
            return None, '无可达空车'
        pickup, index, vehicle_id, ready = best
        wait = pickup-departure
        if wait > self.cfg['maxWaitMinutes']:
            return None, '接客等待超限'
        finish = pickup+BOARDING_MINUTES+minutes+ALIGHTING_MINUTES
        if finish > self.end:
            return None, '无法在收车前完成'
        if finish-departure > self.city.s['policy']['journeyMaximumMinutes']:
            return None, '旅程时间超限'
        vehicle = self.vehicles[index]
        _, empty_distance, empty_path = self.path(vehicle['location'], source)
        fee = self.cfg['baseFare']+max(0,distance/1000-self.cfg['includedKm'])*self.cfg['perKm']+minutes*self.cfg['perMinute']
        return dict(mode='taxi', mainMode='taxi', minutes=round(finish-departure,2),
                    path=path, distance=distance, fee=round(fee,2), wait=round(wait,2), transfers=0,
                    signalWait=round(sum(e.get('signalDelay',0) for e in path),3),
                    taxiVehicle=vehicle_id, pickupMinutes=round(pickup-ready,2), emptyDistance=empty_distance,
                    _vehicle=index, _emptyPath=empty_path, _source=source, _target=target,
                    _ready=ready, _pickup=pickup, _finish=finish, _departure=departure), None

    def commit(self, journey, period, rescued):
        vehicle = self.vehicles[journey['_vehicle']]
        source, target = journey['_source'], journey['_target']
        for path in (journey['_emptyPath'], journey['path']):
            for edge in path:
                if edge.get('ref'):
                    self.city.road_load[(period,edge['ref'])] += 1
        if journey['emptyDistance'] > 0:
            self.empty_journeys.append(dict(source=vehicle['location'], target=source,
                                           vehicle=vehicle['id'], period=period))
        self.bookings.append(dict(vehicle=vehicle['id'], origin=vehicle['location'], source=source, target=target,
                                  request=journey['_departure'], dispatch=journey['_ready'],
                                  pickup=journey['_pickup'], finish=journey['_finish']))
        vehicle.update(location=target, available=journey['_finish'],
                       busy=vehicle['busy']+journey['_finish']-journey['_ready'], trips=vehicle['trips']+1)
        self.completed += 1
        self.rescued += rescued
        self.waits.append(journey['wait'])
        self.occupied_km += journey['distance']/1000
        self.empty_km += journey['emptyDistance']/1000
        self.revenue += journey['fee']

    def report(self):
        return dict(fleetSize=self.cfg['fleetSize'], staged=len(self.vehicles),
                    active=sum(v['trips']>0 for v in self.vehicles), completed=self.completed,
                    rescued=self.rescued, unserved=sum(self.failures.values()), failures=dict(self.failures),
                    meanWait=sum(self.waits)/len(self.waits) if self.waits else None,
                    occupiedKm=self.occupied_km, emptyKm=self.empty_km, revenue=round(self.revenue,2),
                    utilization=sum(v['busy'] for v in self.vehicles)/max(1,len(self.vehicles)*(self.end-self.start)),
                    emptyJourneys=self.empty_journeys, bookings=self.bookings)


def route(city, source, target, car, income, allocate, period, departure):
    base = city._route_without_taxi(source,target,car,income,allocate,period,departure,commit=False)
    dispatch = getattr(city, '_taxi_dispatch', None) if allocate else None
    if dispatch is None:
        if getattr(city, '_taxi_preview', None) is None:
            city._taxi_preview = Dispatch(city)
        dispatch = city._taxi_preview
    candidate, reason = dispatch.quote(source, target, departure)
    # Two daily taxi rides may consume at most 30% of a worker's monthly
    # income. This is a game affordability rule, separate from time valuation.
    if candidate and candidate['fee'] > income/max(1,city.s['policy']['workingDaysPerMonth'])*.15:
        candidate, reason = None, '车费超出收入预算'
    value_of_time = max(.15,income/10000)
    def cost(journey):
        return journey['minutes']+journey['fee']/value_of_time+journey.get('transfers',0)*city.s['policy']['transferPenaltyMinutes']
    if candidate and (base is None or cost(candidate) < cost(base)):
        candidate['taxiRescued'] = base is None
        if allocate:
            dispatch.commit(candidate, period, base is None)
        return {key:value for key,value in candidate.items() if not key.startswith('_')}
    if allocate and base:
        for edge in base['path']:
            if edge['kind']=='ride':
                city.segment_load[(period,edge['segment'])] += 1
            elif edge['kind']=='car' and edge.get('ref'):
                city.road_load[(period,edge['ref'])] += 1
    elif allocate and not base:
        dispatch.failures[reason or '无可用服务'] += 1
    return base
