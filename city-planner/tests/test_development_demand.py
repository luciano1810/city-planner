"""HUD demand follows the actual markets, including commitments and edits."""
import unittest

from tests.test_housing_demand import two_regions, set_queue
from tests.test_city_v3 import complete
from tests.test_city import City, flat_world
from city.development import demand_summary


class DevelopmentDemandTests(unittest.TestCase):
    def test_committed_homes_cover_demand_before_they_are_visible_as_solids(self):
        city, near, _ = two_regions()
        complete(city, near[0], 'office', 40)
        set_queue(city, 40)
        self.assertEqual(demand_summary(city)['uses']['residential']['shortage'], 40)
        complete(city, near[1], 'residential', 40)
        near[1]['rent'] = 1
        for status in ('planned', 'construction', 'active'):
            near[1]['building']['status'] = status
            city.summarize()
            self.assertEqual(city.view()['developmentDemand']['uses']['residential']['shortage'], 0)
        near[1]['building'] = None
        city.summarize()
        self.assertEqual(city.view()['developmentDemand']['uses']['residential']['shortage'], 40)

    def test_all_five_uses_refresh_after_settings_and_legacy_load(self):
        city = City(flat_world())
        initial = city.view()['developmentDemand']
        self.assertEqual(set(initial['uses']), {'residential','commercial','office','industrial','warehouse'})
        self.assertEqual(initial['uses']['residential']['shortage'], 0)
        self.assertEqual(initial['uses']['office']['shortage'], 45)
        city.command(dict(type='settings', values=dict(externalJobs=180)))
        self.assertEqual(city.view()['developmentDemand']['uses']['office']['shortage'], 90)
        snapshot = city.snapshot()
        snapshot['state'].pop('developmentDemand')
        restored = City.restore(snapshot).view()['developmentDemand']
        self.assertEqual(restored['uses']['office']['shortage'], 90)
        for row in restored['uses'].values():
            self.assertGreaterEqual(row['shortage'], 0)
            self.assertTrue(0 <= row['ratio'] <= 1)


if __name__ == '__main__':
    unittest.main()
