"""Shared workplace access and industry demand, including facility employment."""
from collections import Counter

from shapely.geometry import Polygon


# Game calibration at standard site area, separate from service capacity.
FACILITY_STAFF = dict(sports_arena=60, university=320, hospital=240, city_hall=100,
                     fire_station=32, police_station=40, hotel=70, gas_station=8,
                     charging_station=3, museum=45, theater=50, cinema=25,
                     convention_center=100, industrial_plant=180, power_plant=80,
                     substation=4, water_plant=40, sewage_plant=45, recycling_center=55,
                     logistics_hub=120, airport=400, port=220, train_station=75)


def facility_capacity(facility):
    from .special_buildings import CATALOG, PARKING
    kind = facility['kind']
    if kind in PARKING:
        return max(1, round(facility.get('parkingSpaces', 0)/80))
    if kind not in FACILITY_STAFF:
        return 0
    cfg = CATALOG[kind]
    area = Polygon(facility['points']).area
    return max(1, round(FACILITY_STAFF[kind]*area/(cfg['width']*cfg['depth'])))


def sync_facilities(city):
    """Refresh derived staffing after connections change, also upgrading saves."""
    employed = Counter(h.get('job') for h in city.s['households'])
    for f in city.s['facilities']:
        capacity = facility_capacity(f)
        if not capacity:
            continue
        f['jobCapacity'] = capacity
        f['positions'] = capacity if f.get('connected') else 0
        f['employees'] = min(f['positions'], employed[f['id']])


def facility_workplaces(city):
    # Transient adapters share staffing records; no synthetic parcels are saved.
    # Trips continue to use the real facility ID and its road entrance.
    return [dict(id=f['id'], center=f['point'], building=f) for f in city.s['facilities']
            if f.get('connected') and f.get('positions', 0) > 0]


def workplaces(city):
    return [p for p in city.s['parcels'] if p.get('connected') and p.get('building')
            and p['building']['use'] != 'residential' and p['building']['status'] == 'active'
            and p['building'].get('businessActive', True)] + facility_workplaces(city)


def sector_targets(city):
    from .business import demand_parts
    population = sum(h['size'] for h in city.s['households'])
    local,regional=demand_parts(city,'jobs')
    return {u:regional[u]+population*rate for u,rate in local.items()}
