"""Automatic facilities: demand, seeded distribution, exclusions and persistence."""
import copy
import math
import unittest
from unittest.mock import patch
from collections import Counter
from shapely.geometry import Polygon, Point
from tests.test_city import City, flat_world, road
from tests.test_city_v3 import complete
from city.geometry import building_footprint
from city import auto_facilities as auto, special_buildings as special


def fixture():
    c = City(flat_world(), '自动设施验证城市')
    c.s['settings'].update(autoGrow=False, autoRenew=False, externalJobs=5000)
    road(c, [[200, 900], [3800, 900]], 'avenue')
    road(c, [[200, 2800], [3800, 2800]], 'avenue')
    road(c, [[200, 900], [200, 2800]], 'street')
    for i, p in enumerate(c.s['parcels']):
        x, y = p['center']
        if 380 < x < 3650 and (800 < y < 900 or 2700 < y < 2800):
            use = ('residential', 'commercial', 'office')[i % 3] if y < 1500 else ('industrial', 'warehouse')[i % 2]
            if building_footprint(p, use) is None:continue
            complete(c, p, use, 100)
            if use == 'residential':
                for _ in range(70):
                    c.s['households'].append(dict(id=c.uid('h'), home=p['id'], job=None, size=5, income=16000, car=True))
    c.rebuild()
    c.s['settings']['autoGrow'] = True
    return c


class AutomaticFacilitiesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = fixture().snapshot()

    def city(self):
        return City.restore(copy.deepcopy(self.base))

    def test_all_types_have_legal_sites_in_suitable_districts(self):
        c = self.city(); ctx = auto.Context(c)
        for kind in auto.CATALOG:
            options = [auto.propose_site(ctx, kind, p) for p in ctx.empty]
            sites = [f for f in options if f]
            self.assertTrue(sites, kind)
            for f in sites:
                shape = Polygon(f['points'])
                self.assertFalse(len(ctx.obstacle_tree.query(shape, predicate='intersects')), kind)
                self.assertFalse(len(ctx.road_tree.query(shape, predicate='intersects')), kind)
                if auto.CATALOG[kind]['profile'] in ('industry', 'utility'):
                    self.assertGreater(f['point'][1], 2000, kind)
                if kind in auto.POLLUTING:
                    self.assertFalse(len(ctx.sensitive_tree.query(shape, predicate='dwithin', distance=250)), kind)

    def test_seeded_lottery_counts_spacing_and_reload(self):
        a = self.city(); b = self.city()
        for month in range(1, 37):
            a.s['month'] = b.s['month'] = month
            auto.grow(a); auto.grow(b)
            self.assertEqual(a.s['facilities'], b.s['facilities'])
            self.assertLessEqual(sum(f['created'] == month for f in a.s['facilities']), 3)
            before = copy.deepcopy(a.s['facilities']); self.assertFalse(auto.grow(a)); self.assertEqual(before, a.s['facilities'])
        counts = Counter(f['kind'] for f in a.s['facilities'])
        self.assertGreaterEqual(len(counts), 16, counts)
        population = sum(h['size'] for h in a.s['households'])
        for kind, count in counts.items():
            cfg = auto.CATALOG[kind]
            self.assertLessEqual(count, min(cfg.get('maxCount',50), math.ceil(population/cfg['perPopulation'])))
            sites = [f for f in a.s['facilities'] if f['kind'] == kind]
            for i, f in enumerate(sites):
                for g in sites[i+1:]:
                    self.assertGreaterEqual(math.dist(f['point'], g['point']), cfg['separation'])
        a.rebuild(); restored = City.restore(a.snapshot())
        self.assertEqual(restored.s['facilities'], a.s['facilities'])
        self.assertTrue(all(f['connected'] for f in a.s['facilities']))
        for p in a.s['parcels']:
            if p.get('openSpace') in {f['id'] for f in a.s['facilities']}:
                self.assertFalse(p.get('building'))

    def test_disabled_empty_and_budget_do_not_build(self):
        for setting, value in [('autoGrow', False), ('growth', 0), ('maxProjects', 0)]:
            c = self.city(); c.s['settings'][setting] = value
            self.assertFalse(auto.grow(c)); self.assertFalse(c.s['facilities'])
        c = self.city(); c.s['settings']['budget'] = True; c.s['treasury'] = 0
        for month in range(1, 8):
            c.s['month'] = month; self.assertFalse(auto.grow(c))
        self.assertEqual(c.s['treasury'], 0)
        c = self.city(); c.s['households'] = []
        self.assertFalse(auto.grow(c))

    def test_occupied_protected_terrain_and_pollution_exclusions(self):
        c = self.city(); ctx = auto.Context(c)
        p, f = next((p,f) for p in ctx.empty if (f:=auto.propose_site(ctx,'hospital',p)))
        c.s['facilities'].append(dict(f, id='test-occupied', capacity=0))
        self.assertIsNone(auto.propose_site(auto.Context(c), 'hospital', p))
        c.s['facilities'] = [dict(f, id='polluter', kind='power_plant', capacity=0)]
        self.assertEqual(auto.suitability(auto.Context(c),'hospital', f['point'], ctx.roads[p['road']], Polygon(f['points'])),0)
        self.assertFalse(auto.sensitive_site_safe(c, Polygon(f['points'])))
        self.assertTrue(auto.sensitive_site_safe(c, Point(3900,3900).buffer(5)))
        c.s['facilities'] = []
        with patch.object(c.terrain, 'buildable', return_value=False):
            self.assertIsNone(auto.propose_site(auto.Context(c),'hospital',p))
        p['use'] = 'protected'
        self.assertIsNone(auto.propose_site(auto.Context(c),'hospital',p))

    def test_hospital_and_cultural_facilities_receive_real_trips(self):
        import hashlib
        c = self.city()
        for kind, service in [('hospital', 'health'), ('cinema', 'culture')]:
            ctx = auto.Context(c)
            f = next(f for p in ctx.empty if (f := auto.propose_site(ctx, kind, p)))
            f.pop('score')
            f.update(id=c.uid('f'), service=service, capacity=100, generated=True)
            c.s['facilities'].append(f)
            special.reserve(c)
        home = min(c.s['households'], key=lambda h: math.dist(c.parcelmap[h['home']]['center'], c.s['facilities'][0]['point']))
        for i in range(10000):
            home['id'] = 'visitor-' + str(i)
            if int(hashlib.sha256(home['id'].encode()).hexdigest()[:6], 16) % 60 == 0:break
        c.s['households'] = [home]
        c.rebuild(); c.assign_traffic()
        for f in c.s['facilities']:
            self.assertTrue(any(t['target'] == f['id'] and t['purpose'] == f['service'] and t['completed'] for t in c.trips), f['kind'])

    def test_monthly_engine_hook_delete_and_undo(self):
        c = self.city()
        c.s['households'] = c.s['households'][:8]
        with patch.object(auto, 'grow', wraps=auto.grow) as grow:
            c.s['settings']['migration'] = 0
            c.step()
            self.assertEqual(grow.call_count, 1)
        c = self.city()
        for month in range(2, 15):
            c.s['month'] = month
            if auto.grow(c):break
        self.assertTrue(c.s['facilities'])
        c.rebuild()
        f = next(f for f in c.s['facilities'] if f['kind'] in auto.CATALOG)
        fid = f['id']
        self.assertTrue(any(p.get('openSpace') == fid for p in c.s['parcels']))
        c.command(dict(type='delete', id=fid))
        self.assertFalse(any(p.get('openSpace') == fid for p in c.s['parcels']))
        c.command(dict(type='undo'))
        self.assertTrue(any(g['id'] == fid for g in c.s['facilities']))


if __name__ == '__main__':
    unittest.main()
