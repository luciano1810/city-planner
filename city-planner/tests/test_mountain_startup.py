"""Mountain bootstrap keeps room for housing without admitting cliff sites."""
import unittest
import numpy as np
from shapely.geometry import Polygon
from tests.test_city import flat_world, road
from height_format import encode_heights
from city.engine import City
from city.urban import grow_public_spaces


def mountain(slope):
    world=flat_world()
    world['elevation']=encode_heights(np.tile(np.linspace(100,100+4000*slope,80),(80,1)))
    city=City(world)
    city.s['settings']['autoGrow']=False
    road(city,[(1800,600),(1800,1800)])
    return city


class MountainStartupTests(unittest.TestCase):
    def test_moderate_hillside_starts_small_low_rise_housing(self):
        city=mountain(.38)
        self.assertGreater(len(city.s['parcels']),0)
        city.step(1)
        buildings=[p['building'] for p in city.s['parcels'] if p.get('building')]
        self.assertTrue(any(b['use']=='residential' for b in buildings))
        self.assertTrue(all(b['floors']<=3 and b['footprintArea']<=240.1 for b in buildings))

    def test_cliffs_have_no_new_parcels_and_legacy_sites_are_blocked(self):
        city=mountain(.60)
        self.assertEqual(city.s['parcels'],[])
        old=mountain(.38)
        p=old.s['parcels'][0]
        p['terrain']['maxSlope']=.60
        old.step(1)
        self.assertIsNone(p.get('building'))
        self.assertIn('45%',p['developmentReason'])

    def test_thin_rotated_cliff_polygon_cannot_skip_terrain_sampling(self):
        city=mountain(.60)
        shape=Polygon([(1000,1000),(1100,1100),(1100.1,1099.9),(1000.1,999.9)])
        self.assertFalse(city.terrain.buildable(shape,.45))

    def test_public_spaces_wait_for_people_and_reserve_three_housing_sites(self):
        city=mountain(.25)
        city.s['settings']['autoGrow']=True
        city.s['parcels']=city.s['parcels'][:3]
        self.assertFalse(grow_public_spaces(city))
        city.s['households']=[dict(home=city.s['parcels'][0]['id'],size=50)]
        self.assertFalse(grow_public_spaces(city))
        self.assertFalse(any(p.get('openSpace') for p in city.s['parcels']))

    def test_disabled_growth_has_explicit_reason(self):
        city=mountain(.25)
        city.s['settings']['growth']=0
        city.step(1)
        self.assertTrue(all('停止新开发' in p['developmentReason'] for p in city.s['parcels']))
