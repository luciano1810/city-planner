"""Facility jobs use real destinations, shared vacancies and normal commutes."""
import copy
import unittest
from collections import Counter

from tests.test_city import City, flat_world, road
from tests.test_city_v3 import complete
from city import auto_facilities, special_buildings, employment, housing
from city.development import opportunity_fields
from city.urban import spatial_summary


def fixture():
    city = City(flat_world())
    city.s['settings'].update(autoGrow=False, autoRenew=False, migration=0)
    road(city, [[300, 1000], [3000, 1000]])
    home = min(city.s['parcels'], key=lambda p: (p['center'][0]-1100)**2+(p['center'][1]-940)**2)
    complete(city, home, 'residential', 100)
    home['rent'] = 1
    for _ in range(3):
        city.s['households'].append(dict(id=city.uid('h'), home=home['id'], job=None, size=2, income=10000, car=True))
    shape = special_buildings.rectangle([1500, 1080], 0, (-45, -36, 45, 36))
    facility = dict(id=city.uid('f'), kind='hospital', name='医院', point=[1500, 1080], origin=[1500, 1080],
                    points=special_buildings.points(shape), width=90, depth=72, rotation=0, height=36,
                    accessPoint=[1500, 1044], capacity=100, service='health', generated=True,
                    cost=100000, maintenance=200, created=0)
    auto_facilities.facility_architecture.ensure(facility)
    city.s['facilities'].append(facility)
    city.rebuild()
    return city, home, facility


class FacilityEmploymentTests(unittest.TestCase):
    def test_staffing_scales_separately_from_service_capacity(self):
        for kind, cfg in special_buildings.CATALOG.items():
            if kind in special_buildings.PARKING:
                continue
            shape = special_buildings.rectangle([1000, 1000], 0, (0, 0, cfg['width'], cfg['depth']))
            f = dict(kind=kind, points=special_buildings.points(shape), capacity=99999)
            self.assertGreater(employment.facility_capacity(f), 0, kind)
            smaller = special_buildings.rectangle([1000, 1000], 0, (0, 0, cfg['width']/2, cfg['depth']/2))
            f['points'] = special_buildings.points(smaller)
            self.assertLess(employment.facility_capacity(f), employment.FACILITY_STAFF[kind], kind)

    def test_jobs_commutes_accessibility_and_housing_share_facility_destination(self):
        c, home, f = fixture()
        c.match_jobs(); c.assign_traffic(); c.summarize()
        self.assertEqual(f['capacity'], 100)
        self.assertEqual(f['positions'], 240)
        self.assertEqual(f['employees'], 3)
        self.assertTrue(all(h['job'] == f['id'] for h in c.s['households']))
        trips = [t for t in c.trips if t['purpose'] == 'work']
        self.assertEqual(len(trips), 6)
        self.assertTrue(all(t['completed'] and f['id'] in (t['source'], t['target']) for t in trips))
        self.assertEqual(c.s['stats']['jobs'], 240)
        self.assertEqual(c.s['stats']['facilityJobs'], 240)
        self.assertEqual(c.s['stats']['employed'], 3)
        fields = opportunity_fields(c, employment.workplaces(c), Counter({home['id']: 3}), c.s['facilities'])
        self.assertEqual(fields[home['id']]['jobs30'], 240)
        self.assertEqual(housing.vacancies(c)[f['id']], 237)
        match = housing.HomeJobMatcher(c).choose(10000, True)
        self.assertEqual(match[1], f['id'])
        c.s['pendingHousing'] = 10
        market = housing.HousingMarket(c)
        self.assertEqual(market.summary()['waitingForJobs'], 0)
        self.assertTrue(all(row['job'] == f['id'] for row in market.summary()['regions']))
        summary = spatial_summary(c, c.s['parcels'])
        self.assertEqual(summary['jobs'], 240)
        self.assertEqual(summary['outgoing'], 0)
        self.assertEqual(c.query(dict(kind='area', bounds=[[1490, 1070], [1510, 1090]]))['stats']['jobs'], 240)
        self.assertEqual(c.query(dict(kind='area', bounds=[[1511, 1070], [1520, 1090]]))['stats']['jobs'], 0)
        c.update_market()
        self.assertEqual(home['accessJobs'], 240)
        restored = City.restore(c.snapshot())
        self.assertEqual(restored.s['facilities'], c.s['facilities'])
        self.assertEqual(restored.s['households'], c.s['households'])

    def test_disconnect_delete_undo_and_old_save_upgrade(self):
        c, home, f = fixture(); c.match_jobs()
        f['accessPoint'] = [3500, 3500]
        c.rebuild(); c.match_jobs(); c.summarize()
        self.assertEqual(f['positions'], 0)
        self.assertEqual(f['employees'], 0)
        self.assertTrue(all(h['job'] is None for h in c.s['households']))
        self.assertNotIn(f['id'], housing.vacancies(c))
        f['accessPoint'] = [1500, 1044]
        c.rebuild(); c.match_jobs(); c.summarize()
        c.command(dict(type='delete', id=f['id']))
        self.assertEqual(c.s['stats']['jobs'], 0)
        self.assertTrue(all(h['job'] is None for h in c.s['households']))
        c.command(dict(type='undo'))
        self.assertEqual(c.s['facilities'][0]['employees'], 3)
        self.assertTrue(all(h['job'] == f['id'] for h in c.s['households']))
        old = c.snapshot()
        for key in ('jobCapacity', 'positions', 'employees'):
            old['state']['facilities'][0].pop(key)
        old['state']['stats'].pop('facilityJobs')
        old['state']['stats']['jobs'] = 0
        for h in old['state']['households']: h['job'] = None
        restored = City.restore(old)
        self.assertEqual(restored.s['facilities'][0]['positions'], 240)
        self.assertEqual(restored.s['stats']['jobs'], 240)

    def test_capacity_and_saved_worker_references_are_enforced(self):
        c, home, f = fixture()
        f['kind'] = 'charging_station'
        c.rebuild()
        capacity = f['positions']
        for _ in range(capacity):
            c.s['households'].append(dict(id=c.uid('h'), home=home['id'], job=None, size=2, income=10000, car=True))
        c.match_jobs()
        self.assertEqual(sum(h['job'] == f['id'] for h in c.s['households']), capacity)
        self.assertEqual(f['employees'], capacity)
        bad = copy.deepcopy(c.snapshot())
        next(h for h in bad['state']['households'] if not h['job'])['job'] = f['id']
        with self.assertRaisesRegex(ValueError, '岗位'):
            City.restore(bad)


if __name__ == '__main__':
    unittest.main()
