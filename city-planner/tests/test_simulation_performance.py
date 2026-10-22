"""Avoid redundant monthly journeys while preserving accessibility results."""
import unittest
from collections import defaultdict
from unittest.mock import patch

from tests import test_city
from city.urban import accessibility_by_group


class MonthlyJourneyTests(unittest.TestCase):
    def fixture(self, transit=False):
        city,stops,home,job=test_city.TransitTests().transit_city()
        if transit:
            city.command(dict(type='line',mode='bus',stops=stops,headway=10,hours=4,startHour=6))
        city.parcelmap[job]['building']=dict(use='office',status='active',positions=20,employees=3)
        city.s['households']=[dict(home=home,car=car,income=income)
                              for car in (True,False) for income in (4500,7500,11000)]
        return city,home,job

    def test_without_transit_skips_public_search_and_preserves_driving_and_walking(self):
        city,home,job=self.fixture()
        # Force the former search through the walking-only public graph to
        # provide a reference, without adding any ride edges.
        with patch.object(city,'line_segments',{'reference':{}}):
            expected=[city.route(home,job,car) for car in (True,False)]
        city.route_solutions.clear()
        with patch.object(city,'distances',wraps=city.distances) as search:
            actual=[city.route(home,job,car) for car in (True,False)]
            self.assertNotIn('public',[call.args[1] for call in search.call_args_list])
            self.assertIsNone(city.route(home,job,False,required_mode='bus'))
        self.assertEqual(actual,expected)
        self.assertIsNotNone(actual[0])
        self.assertIsNone(actual[1])

    def test_accessibility_matches_individual_journeys_for_every_income_and_period(self):
        for transit in (False,True):
            with self.subTest(transit=transit):
                city,home,job=self.fixture(transit)
                expected=[]
                for period,departure in [('am',480),('off',840),('pm',1080)]:
                    for group,income in [('低收入',4500),('中收入',7500),('高收入',11000)]:
                        reached=0
                        for car in (True,False):
                            journey=city.route(home,job,car,income,period=period,departure=departure)
                            reached+=bool(journey and journey['minutes']<=city.s['settings']['accessBudget'])
                        expected.append(dict(group=group,period=period,minutes=city.s['settings']['accessBudget'],
                                             households=2,jobs=round(20*reached/2,1),
                                             vacancies=round(17*reached/2,1),services=0.))
                with patch.object(city,'route',wraps=city.route) as route:
                    actual=accessibility_by_group(city)
                    self.assertEqual(actual,expected)
                    self.assertEqual(route.call_count,18 if transit else 6)
                if transit:
                    self.assertTrue(city.line_segments)
                    morning=next(r['jobs'] for r in actual if r['period']=='am' and r['group']=='中收入')
                    evening=next(r['jobs'] for r in actual if r['period']=='pm' and r['group']=='中收入')
                    self.assertGreater(morning,evening)

    def test_surface_routes_match_full_router_and_allocate_each_departure(self):
        city,home,job=self.fixture()
        nearby=sorted(city.s['parcels'],key=lambda p:p['center'][0])[3]['id']
        requests=[(a,b,car,income,period,departure)
                  for a,b in [(home,nearby),(home,job),(job,home),(home,home),(home,'unreachable')]
                  for car in (False,True) for income in (3500,7500,16000)
                  for period,departure in [('am',480),('pm',1080)]]
        def run():
            city.road_load=defaultdict(float);city.segment_load=defaultdict(float)
            results=[city.route(a,b,car,income,True,period,departure)
                     for a,b,car,income,period,departure in requests]
            return results,dict(city.road_load)
        # The original multimodal search remains an independent reference.
        with patch.object(city,'line_segments',{'reference':{}}):expected=run()
        actual=run()
        self.assertEqual(actual,expected)
        self.assertTrue(actual[1])
        self.assertEqual({key[0] for key in actual[1]}, {'am','pm'})
        with patch('city.engine.reconstruct',side_effect=AssertionError('repeated path expansion')):
            self.assertEqual(run(),expected)

    def test_surface_cache_is_bounded_and_network_rebuild_invalidates_it(self):
        city,_,home,job=test_city.TransitTests().transit_city()
        before=city.route(home,job)
        for i in range(4200):self.assertIsNone(city.route(home,f'missing-{i}',False))
        self.assertLessEqual(len(city.surface_journeys),4096)
        self.assertLessEqual(city.surface_journey_edges,65536)
        city.s['policy']['parkingMinutes']+=10
        city.build_graphs()
        self.assertFalse(city.surface_journeys)
        self.assertEqual(city.surface_journey_edges,0)
        self.assertAlmostEqual(city.route(home,job)['minutes'],before['minutes']+10,places=2)

    def test_unwalkable_routes_do_not_expand_paths(self):
        city,home,job=self.fixture()
        with patch('city.engine.reconstruct',side_effect=AssertionError('unusable walking path')):
            self.assertIsNone(city.route(home,job,False))
            self.assertIsNone(city.route(home,job,False,income=16000,departure=1080))

    def test_interleaved_home_cohorts_preserve_group_order_and_exact_totals(self):
        city,home,job=self.fixture()
        city.s['households']=[dict(home=a,car=car,income=income)
            for income in (11000,4500,7500) for car in (False,True) for a in (home,job)]
        groups=[('高收入',11000),('低收入',4500),('中收入',7500)]
        expected=[]
        for period,departure in [('am',480),('off',840),('pm',1080)]:
            for group,income in groups:
                reached=sum(bool(r and r['minutes']<=city.s['settings']['accessBudget'])
                    for h in city.s['households'] if h['income']==income
                    for r in [city.route(h['home'],job,h['car'],income,period=period,departure=departure)])
                expected.append(dict(group=group,period=period,minutes=city.s['settings']['accessBudget'],
                    households=4,jobs=round(20*reached/4,1),vacancies=round(17*reached/4,1),services=0.))
        self.assertEqual(accessibility_by_group(city),expected)


class EconomicCacheTests(unittest.TestCase):
    def test_shared_weights_keep_market_state_independent_and_follow_network_and_policy(self):
        from tests.test_spatial_demand import catchment
        from city.business import BusinessMarket
        city,home,far,near=catchment(60)
        first=BusinessMarket(city)
        gap=first.gap(near,'commercial')
        second=BusinessMarket(city)
        self.assertEqual(second.gap(near,'commercial'),gap)
        second.reserve(near,'commercial',100)
        self.assertEqual(second.gap(near,'commercial'),BusinessMarket(city,supply=second.rows).gap(near,'commercial'))
        self.assertEqual(first.gap(near,'commercial'),gap)
        city.graphs=dict(city.graphs,walk={'home':[dict(to='near',time=1,kind='walk'),dict(to='far',time=1,kind='walk')]})
        self.assertLess(BusinessMarket(city).gap(near,'commercial'),gap)
        city.s['policy']['economicCatchmentMinutes']=.1
        self.assertNotEqual(BusinessMarket(city).gap(near,'commercial'),gap)
