"""New commitments round-trip before their first daily settlement."""
import unittest
from tests.test_city import block_city
from city.engine import City
from city import construction
from city.simulation import advance_calendar, DAY


class ConstructionPersistenceTests(unittest.TestCase):
    def test_new_plans_round_trip_before_first_day(self):
        city=block_city()
        city.s['settings'].update(autoGrow=False,autoRenew=False,migration=0)
        city.develop();city.rebuild()
        buildings=[p['building'] for p in city.s['parcels'] if p.get('building')]
        self.assertTrue(buildings)
        self.assertTrue(all(b['status']=='planned' for b in buildings))
        self.assertTrue(all(b['lastAgeDay']==int(construction.day(city)) for b in buildings))
        restored=City.restore(city.snapshot())
        self.assertEqual(city.s['parcels'],restored.s['parcels'])
        advance_calendar(city,2*DAY);advance_calendar(restored,2*DAY)
        self.assertEqual(city.snapshot(),restored.snapshot())
