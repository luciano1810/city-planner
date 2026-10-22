"""Reserved facility land and physical driveway connections stay in sync."""
import unittest
from shapely.geometry import Point, LineString, Polygon, box
from tests.test_facility_employment import fixture
from city.engine import City


class FacilityAccessTests(unittest.TestCase):
    def test_reserved_land_inspects_the_built_facility_and_keeps_driveway(self):
        c, home, f = fixture()
        reserved = [p for p in c.s['parcels'] if p.get('openSpace') == f['id']]
        self.assertTrue(reserved)
        for p in reserved:
            self.assertEqual(c.inspect(p['id'])['object']['id'], f['id'])
            self.assertIn('已建成设施', p['developmentReason'])
        self.assertTrue(f['connected'])
        self.assertEqual(f['accessWidth'], 5)
        self.assertAlmostEqual(Polygon(f['points']).boundary.distance(Point(f['accessPath'][-1])), 0)
        road = next(r for r in c.s['roads'] if r['id'] == f['accessRoad'])
        self.assertAlmostEqual(LineString(road['points']).distance(Point(f['accessPath'][0])), 0)
        for mode in ('walk', 'car'):
            self.assertIn(f['id'], c.distances(home['id'], mode)[0])
        restored = City.restore(c.snapshot())
        self.assertEqual(restored.s['facilities'][0]['accessPath'], f['accessPath'])
        self.assertEqual(restored.inspect(reserved[0]['id'])['type'], 'facilities')

    def test_legacy_parcel_parking_gets_a_visible_driveway_and_real_route(self):
        c, home, f = fixture()
        parcel = next(p for p in c.s['parcels'] if p.get('openSpace') == f['id'])
        f.update(kind='parking_lot', parcel=parcel['id'], parkingSpaces=20)
        f.pop('accessPoint'); f.pop('accessPath'); f.pop('accessRoad')
        c.rebuild()
        self.assertTrue(f['connected'])
        self.assertEqual(len(f['accessPath']), 2)
        self.assertGreater(LineString(f['accessPath']).length, 0)
        self.assertIsNotNone(c.route(home['id'], f['id'], True, 10000))

    def test_driveway_cannot_cross_another_facility_or_survive_road_removal(self):
        c, _, f = fixture()
        blocker = dict(id='blocker', kind='plaza', point=[1500, 1025], capacity=0,
                       points=list(box(1490, 1010, 1510, 1040).exterior.coords), name='阻挡设施')
        c.s['facilities'].append(blocker)
        c.rebuild()
        self.assertFalse(f['connected'])
        self.assertNotIn('accessPath', f)
        self.assertEqual(f['positions'], 0)
        c.s['facilities'].remove(blocker); c.rebuild()
        self.assertTrue(f['connected'])
        c.s['roads'] = []; c.rebuild()
        self.assertFalse(f['connected'])
        self.assertNotIn('accessPath', f)


if __name__ == '__main__':
    unittest.main()
