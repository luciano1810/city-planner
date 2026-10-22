"""Period assignment units and persistence must agree with the peak model."""
import copy
import json
import unittest
from unittest.mock import patch

from tests.test_city import City, flat_world, road
from city.geometry import ROAD_TYPES


class TrafficMetricsTests(unittest.TestCase):
    def test_view_aggregates_all_households_without_mutating_saved_parcels(self):
        city=City(flat_world())
        road(city,[(500,1000),(1500,1000)])
        home,empty=city.s['parcels'][:2]
        city.s['households']=[dict(home=home['id'],size=1,commute=20) for _ in range(100)]
        city.s['households'] += [dict(home=home['id'],size=1,commute=60),dict(home=home['id'],size=1,commute=None,commuteFailed=True)]
        view=city.view()
        result=next(p for p in view['parcels'] if p['id']==home['id'])['commuteStats']
        self.assertEqual(result,dict(mean=2060/101,count=101,failed=1))
        self.assertEqual(next(p for p in view['parcels'] if p['id']==empty['id'])['commuteStats'],dict(mean=None,count=0,failed=0))
        self.assertNotIn('commuteStats',home)
        self.assertNotIn('households',view)

    def test_period_units_peak_and_save_restore(self):
        city=City(flat_world())
        road(city,[(500,1000),(1500,1000)])
        def demand(c):
            for edge in c.network['edges']:
                for period,count in [('am',120),('off',500),('pm',180)]:
                    c.road_load[(period,edge['id'])]+=count
            return 0,0,[]
        with patch('city.engine.assign_freight',side_effect=demand):
            city.assign_traffic()
        for edge in city.network['edges']:
            periods=edge['trafficPeriods']
            capacity=max(1,ROAD_TYPES[edge['kind']]['capacity']*edge.get('terrainCapacity',1)*edge.get('signalCapacityFactor',1))
            self.assertEqual(periods['am']['hourly'],60)
            self.assertEqual(periods['pm']['hourly'],90)
            self.assertEqual(periods['off'],dict(vehicles=500,hourly=None,ratio=None))
            self.assertEqual(edge['traffic'],90)
            self.assertEqual(periods['pm']['ratio'],edge['ratio'])
            self.assertAlmostEqual(periods['am']['ratio'],60/capacity)
        snapshot=json.loads(json.dumps(city.snapshot()))
        restored=City.restore(snapshot)
        self.assertEqual(restored.runtime()['edges'],city.runtime()['edges'])
        # Historic peak values survive old saves; absent period detail stays absent.
        old=copy.deepcopy(snapshot)
        for edge in old['runtime']['edges'].values():
            edge.pop('trafficPeriods')
        legacy=City.restore(old)
        self.assertTrue(all('trafficPeriods' not in e for e in legacy.network['edges']))
        legacy.assign_traffic()
        self.assertTrue(all(e['trafficPeriods']['am']['vehicles']==0 for e in legacy.network['edges']))


if __name__=='__main__':
    unittest.main()
