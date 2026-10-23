"""Naming geography and activity centers, separate from economic land use."""
import math
from collections import Counter
from . import place_regions

PUBLIC_FACILITIES = {'park', 'plaza', 'school', 'clinic', 'sports_arena', 'university',
    'hospital', 'city_hall', 'fire_station', 'police_station', 'museum', 'theater',
    'power_plant', 'substation', 'water_plant', 'sewage_plant', 'recycling_center',
    'bus_depot', 'train_station', 'airport', 'port'}


def stem(name, ending):
    return name[:-len(ending)] if name.endswith(ending) else name


class Context:
    def __init__(self, city):
        self.city = city
        place_regions.ensure_hierarchy(city)
        self.districts = {d['id']: d for d in city.s.get('namingDistricts', [])}
        self.peaks = {}
        residents = Counter()
        for h in city.s.get('households', []):
            residents[h['home']] += h.get('size', 1)
        # Activity is actual residents and employees, never vacant capacity.
        for p in sorted(city.s.get('parcels', []), key=lambda p: p['id']):
            b = p.get('building') or {}
            if b.get('status') != 'active' or not p.get('center'):
                continue
            activity = residents[p['id']] * .3 + b.get('employees', 0)
            self.add(p['center'], activity, p['id'])
        for f in sorted(city.s.get('facilities', []), key=lambda f: f['id']):
            if f.get('point'):
                self.add(f['point'], f.get('employees', 0), f['id'])

    def add(self, point, activity, identifier):
        if activity <= 0:
            return
        area = place_regions.region_at(self.city, point)
        if not area:
            return
        for key in ('city', area.get('district'), area['id']):
            if key and (key not in self.peaks or activity > self.peaks[key][0]):
                self.peaks[key] = (activity, point, identifier)

    def roots(self, area, point):
        district = self.districts.get(area.get('district'))
        def proximity(key, radius):
            peak = self.peaks.get(key)
            return math.exp(-.5*(math.dist(point, peak[1])/radius)**2) if peak else 0.
        city_near = proximity('city', 900)
        district_near = proximity(area.get('district'), 500)
        region_near = proximity(area['id'], 250)
        city_name = self.city.s.get('name', '')
        # Digit-bearing save titles remain valid, but never introduce numeric
        # disambiguators into generated object names.
        city_name = ''.join(c for c in city_name if not c.isdigit()).strip()[:40]
        return [(city_name, .15+10*city_near, 'city'),
                (stem(district['name'], '城区') if district else '',
                 .5+8*district_near*(1-city_near), 'district'),
                (stem(area['name'], '片区'),
                 1+6*region_near*(1-city_near)*(1-district_near), 'region')]

    def choose(self, rng, category, obj, area, point):
        chance = .92 if category == 'facilities' and obj.get('kind') in PUBLIC_FACILITIES else .7 if category in ('roads', 'stops') else .48
        if rng.random() >= chance:
            return None, 'independent'
        roots = [(name, weight, level) for name, weight, level in self.roots(area, point) if name]
        total = sum(row[1] for row in roots)
        pick = rng.random()*total
        for name, weight, level in roots:
            pick -= weight
            if pick <= 0:
                return name, level
        return None, 'independent'
