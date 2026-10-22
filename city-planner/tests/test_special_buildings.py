"""Transport placement, occupied land, station lifecycle and automatic landmarks."""
import copy
import base64
import unittest

import numpy as np
from shapely.geometry import Point, Polygon, box

from tests.test_city import City, flat_world, road
from tests.test_city_v3 import complete
from height_format import encode_heights
from city import special_buildings as special
from city.urban import clustered_districts


def coast_world():
    world = flat_world()
    heights = np.full((80, 80), 5, dtype=np.float32)
    heights[:, 40:] = -5
    world['elevation'] = encode_heights(heights)
    world['waterBodies']['ocean'] = base64.b64encode(np.packbits(heights<0)).decode()
    world['stats']['landPercent'] = 50
    return world


def developed_city():
    c = City(flat_world())
    c.s['settings']['autoGrow'] = False
    road(c, [[500, 1000], [3500, 1000]])
    for p in c.s['parcels'][::4]:
        complete(c, p, 'office', 30)
    c.rebuild()
    return c


class SpecialBuildingTests(unittest.TestCase):
    def place(self, c, kind, point, **args):
        c.command(dict(type='special_building', kind=kind, point=point, **args))
        return c.s['facilities'][-1]

    def test_airport_placement_rotation_preview_restore_and_undo(self):
        c = City(flat_world())
        before = c.snapshot()
        cmd = dict(kind='airport', point=[1400, 1200], rotation=30, size='compact')
        result = special.preview(c, cmd)
        self.assertTrue(result['valid'])
        self.assertEqual(c.snapshot(), before)
        f = self.place(c, **cmd)
        self.assertEqual(f['rotation'], 30)
        self.assertEqual(f['width'], 700)
        self.assertEqual(c.s['capitalAccounts']['交通建筑'], f['cost'])
        restored = City.restore(c.snapshot())
        self.assertEqual(restored.s['facilities'], c.s['facilities'])
        c.command(dict(type='undo'))
        self.assertEqual(c.s['facilities'], [])
        c.command(dict(type='redo'))
        self.assertEqual(c.s['facilities'][0]['id'], f['id'])

    def test_bad_placement_is_atomic_and_roads_cannot_cut_reserved_site(self):
        c = City(flat_world())
        f = self.place(c, 'airport', [1400, 1200])
        before = c.snapshot()
        for cmd in [dict(type='special_building', kind='airport', point=[1400,1200]),
                    dict(type='special_building', kind='airport', point=[100,100]),
                    dict(type='special_building', kind='airport', point=[2800,2800], rotation=float('nan')),
                    dict(type='road', kind='street', level=1, points=[[700,1200],[2100,1200]])]:
            with self.assertRaises(ValueError):
                c.command(cmd)
            self.assertEqual(c.snapshot(), before)
        with self.assertRaises(ValueError):c.add_road(dict(kind='street',points=[[700,1200],[2100,1200]]))
        road(c, [[700,1200],[2100,1200]])
        self.assertNotIn(f['id'],[f['id'] for f in c.s['facilities']])
        self.assertEqual(c.s['lastRoadClearance']['facilities'],1)

    def test_port_requires_land_and_water_with_correct_orientation(self):
        c = City(coast_world())
        self.assertFalse(special.preview(c, dict(kind='port', point=[1000,1000]))['valid'])
        self.assertFalse(special.preview(c, dict(kind='port', point=[2000,2000], rotation=90))['valid'])
        f = self.place(c, 'port', [2000,2000], rotation=270)
        self.assertTrue(all(not c.terrain.sample(p)['water'] for p in f['landPoints']))
        self.assertFalse(special.preview(c, dict(kind='airport', point=[2200,1000]))['valid'])
        self.assertEqual(City.restore(c.snapshot()).s['facilities'][0]['kind'], 'port')

    def test_station_creates_real_stop_and_deletion_updates_line(self):
        c = City(flat_world())
        with self.assertRaisesRegex(ValueError, '铁路'):
            self.place(c, 'train_station', [1000,1000])
        road(c, [[500,1000],[3300,1000]], 'train')
        road(c, [[500,1120],[3300,1120]])
        a = self.place(c, 'train_station', [1000,1020], name='西站')
        b = self.place(c, 'train_station', [2400,1020], name='东站')
        self.assertEqual(a['rotation'], 0)
        self.assertTrue(a['railConnected'])
        self.assertEqual(c.s['stops'][0]['facility'], a['id'])
        c.command(dict(type='line', mode='train', name='城际线', stops=[a['stop'],b['stop']], headway=10, capacity=650, hours=16))
        self.assertTrue(c.s['lines'][0]['valid'])
        restored = City.restore(c.snapshot())
        self.assertTrue(restored.s['lines'][0]['valid'])
        with self.assertRaisesRegex(ValueError, '火车站建筑'):
            c.command(dict(type='delete', id=a['stop']))
        c.command(dict(type='delete', id=a['id']))
        self.assertNotIn(a['stop'], [s['id'] for s in c.s['stops']])
        self.assertFalse(c.s['lines'][0]['valid'])

    def test_station_reuses_existing_stop_without_deleting_it(self):
        c = City(flat_world())
        road(c, [[500,1000],[3300,1000]], 'train')
        c.command(dict(type='stop', mode='train', point=[1500,1000], name='既有站'))
        stop = c.s['stops'][0]['id']
        f = self.place(c, 'train_station', [1500,1020])
        self.assertEqual(f['stop'], stop)
        self.assertFalse(f['ownsStop'])
        self.assertEqual(len(c.s['stops']), 1)
        c.command(dict(type='delete', id=f['id']))
        self.assertEqual(c.s['stops'][0]['id'], stop)
        self.assertNotIn('facility', c.s['stops'][0])

    def test_new_parcels_stay_reserved_after_rebuild_and_delete_releases_them(self):
        c = City(flat_world())
        f = self.place(c, 'airport', [1500,1500])
        # Legal road outside the site creates frontage plots extending inside it.
        road(c, [[900,1700],[2100,1700]])
        overlap = [p for p in c.s['parcels'] if Polygon(p['points']).intersection(Polygon(f['points'])).area > .1]
        self.assertTrue(overlap)
        self.assertTrue(all(p.get('openSpace') == f['id'] for p in overlap))
        c.s['settings']['externalJobs'] = 8000
        c.develop()
        self.assertTrue(all(not p.get('building') for p in overlap))
        c.command(dict(type='delete', id=f['id']))
        self.assertTrue(all(p.get('openSpace') != f['id'] for p in c.s['parcels']))

    def test_random_parking_is_reproducible_bounded_and_has_both_forms(self):
        base = developed_city()
        base.s['settings']['autoGrow'] = True
        forms = set()
        for month in range(1,13):
            c = City.restore(base.snapshot())
            c.s['month'] = month
            clone = City.restore(c.snapshot())
            self.assertTrue(special.grow_parking(c))
            self.assertTrue(special.grow_parking(clone))
            self.assertEqual(c.s['facilities'], clone.s['facilities'])
            f = c.s['facilities'][-1]
            forms.add(f['kind'])
            self.assertGreater(f['parkingSpaces'], 0)
            self.assertTrue(Polygon(c.parcelmap[f['parcel']]['points']).covers(Polygon(f['points'])))
            for _ in range(8):special.grow_parking(c)
            self.assertLessEqual(sum(f['kind'] in special.PARKING for f in c.s['facilities']), 4)
        self.assertEqual(forms, set(special.PARKING))
        base.s['settings']['growth'] = 0
        self.assertFalse(special.grow_parking(base))

    def test_cbd_tower_only_appears_inside_cbd_and_delivers_after_construction(self):
        c = developed_city()
        self.assertFalse(special.grow_cbd(c))
        boundary = box(1000,900,1800,1100)
        c.s['districts'] = [dict(id='cbd-test', kind='CBD', polygons=[special.points(boundary)], jobs=2000, buildings=12)]
        c.s['settings']['externalJobs'] = 6000
        self.assertTrue(special.grow_cbd(c))
        p = next(p for p in c.s['parcels'] if p.get('building', {}) and p['building'].get('landmark'))
        b = p['building']
        self.assertTrue(boundary.covers(Point(p['center'])))
        self.assertGreaterEqual(b['floors'], 36)
        self.assertGreater(b['height'], 120)
        self.assertEqual(b['status'], 'construction')
        self.assertEqual(b['positions'], 0)
        self.assertFalse(special.grow_cbd(c))
        c.s['month'] = b['ready']
        c.complete_projects()
        self.assertEqual(b['status'], 'active')
        self.assertEqual(City.restore(c.snapshot()).parcelmap[p['id']]['building']['landmark'], 'cbd_skyscraper')
        c.s['settings']['growth'] = 0
        self.assertFalse(special.grow_cbd(c))

    def test_station_and_airport_budget_errors_and_corrupt_save(self):
        c = City(flat_world())
        c.s['settings']['budget'] = True
        c.s['treasury'] = 10
        before = c.snapshot()
        with self.assertRaisesRegex(ValueError, '预算'):
            self.place(c, 'airport', [1500,1500])
        self.assertEqual(c.snapshot(), before)
        c.s['settings']['budget'] = False
        self.place(c, 'airport', [1500,1500])
        data = c.snapshot()
        data['state']['facilities'][0]['width'] = -2
        with self.assertRaises(ValueError):City.restore(data)

    def test_month_step_generates_parking_and_existing_cbd_office_can_grow(self):
        c = developed_city()
        c.s['settings'].update(autoGrow=True, maxProjects=0)
        c.step(1)
        self.assertTrue(any(f['kind'] in special.PARKING for f in c.s['facilities']))
        c.s['settings'].update(autoGrow=False, maxProjects=12, externalJobs=6000)
        p = next(p for p in c.s['parcels'] if p.get('building') and p['building']['use']=='office')
        boundary = Polygon(p['points'])
        c.s['districts'] = [dict(id='test-dense-cbd', kind='CBD', polygons=[special.points(boundary)], jobs=3000, buildings=6)]
        before = p['building']['capacity']
        self.assertTrue(special.grow_cbd(c))
        self.assertEqual(p['building']['capacity'], before)
        self.assertGreater(p['building']['extensionFloors'], 0)
        c.s['month'] = p['building']['extensionReady']
        c.develop()
        self.assertGreater(p['building']['capacity'], before)
        self.assertGreater(p['building']['height'], 120)


if __name__ == '__main__':unittest.main()
