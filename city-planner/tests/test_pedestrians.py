"""Protected walking, geometry, shared clock, and save continuation."""
import copy
import json
import unittest

from shapely.geometry import Point

from tests.test_signals import cross_city
from tests.test_city import road
from city.engine import City
from city.signals import LiveTraffic, phase


class PedestrianTests(unittest.TestCase):
    def test_wait_for_green_finish_before_red_and_never_share_vehicle_reservation(self):
        city=cross_city();live=LiveTraffic(city,'test');junction=city.network['junctions'][0]
        self.assertGreater(len(live.walkers.people),0)
        for _ in range(7):
            view=live.advance(10)
            self.assertFalse(view['pedestrianEvents'])
        self.assertGreater(view['pedestrianWaiting'],0)
        for _ in range(180):
            view=live.advance(.5)
            for p in view['pedestrians']:
                if p['kind']=='crossing':
                    self.assertTrue(all(c=='red' for c in phase(junction,live.clock)['lamps'].values()))
                    self.assertNotIn(p['junction'],live.owners)
        self.assertGreater(view['pedestrianPassed'],0)
        for event in view['pedestrianEvents']:
            self.assertEqual(phase(junction,event['time'])['pedestrian'],'green')
            self.assertGreater(event['remaining'],event['duration'])

    def test_people_stay_outside_carriageways_except_at_marked_crossings(self):
        city=cross_city();road(city,[[1100,1000],[1150,1120]])
        live=LiveTraffic(city,'test')
        for _ in range(15):
            for person in live.advance(10)['pedestrians']:
                if person['kind']!='crossing':
                    self.assertFalse(live.walkers.road_area.contains(Point(person['point'])),person)
        for link in live.walkers.links.values():
            if link['kind']=='crossing':
                self.assertIn(link['junction'],live.junctions)
                self.assertTrue(live.junctions[link['junction']]['crossings'])

    def test_walkers_move_and_pause_preserves_position_and_stride(self):
        live=LiveTraffic(cross_city(),'test')
        before=live.view();after=live.advance(2)
        self.assertNotEqual(before['pedestrians'],after['pedestrians'])
        self.assertTrue(any(p['stride']>0 for p in after['pedestrians']))
        self.assertEqual(after,live.advance(0))
        self.assertEqual(after,live.view())

    def test_save_restores_people_and_backward_compatible_legacy_saves(self):
        city=cross_city();city.live_traffic=LiveTraffic(city,'test')
        for _ in range(8):city.live_traffic.advance(10)
        saved=json.loads(json.dumps(city.snapshot()));restored=City.restore(saved)
        self.assertEqual(city.live_traffic.view(),restored.live_traffic.view())
        self.assertEqual(city.live_traffic.advance(10),restored.live_traffic.advance(10))
        legacy=copy.deepcopy(saved);legacy['runtime']['liveTraffic'].pop('pedestrians')
        self.assertGreater(len(City.restore(legacy).live_traffic.view()['pedestrians']),0)
        invalid=copy.deepcopy(saved);invalid['runtime']['liveTraffic']['pedestrians']['people'][0]['edge']='missing'
        with self.assertRaises(ValueError):City.restore(invalid)
        invalid=copy.deepcopy(saved);invalid['runtime']['liveTraffic']['pedestrians']['people'][0]['position']=float('nan')
        with self.assertRaises(ValueError):City.restore(invalid)

    def test_observed_empty_city_stays_empty_and_test_walkers_do_not_change_population(self):
        city=cross_city();before=copy.deepcopy(city.s)
        self.assertEqual(LiveTraffic(city,'observed').advance(10)['pedestrians'],[])
        self.assertGreater(len(LiveTraffic(city,'test').advance(10)['pedestrians']),0)
        self.assertEqual(before,city.s)

    def test_vehicle_interlock_waits_for_a_walker_still_in_the_crossing(self):
        live=LiveTraffic(cross_city(),'test')
        crossing=next(e for e in live.walkers.links.values() if e['kind']=='crossing')
        walker=live.walkers.people[0];walker.update(edge=crossing['id'],position=crossing['length']/2)
        # Artificially resume a crossing at the vehicle-green boundary. The
        # junction interlock must still stop every new vehicle entry.
        for car in live.cars:
            link=live.links[car['route'][car['segment']]]
            arm=live.arms.get((link['b'],link['road'],link['direction']))
            if arm:car['position']=link['length']-arm['stopDistance']
        live.advance(.1)
        self.assertEqual(live.events,[])

    def test_close_junctions_do_not_reuse_upstream_permission_or_conflict_with_walkers(self):
        from city.visual_case import build_visual_case
        city=build_visual_case();live=city.live_traffic
        for _ in range(240):
            view=live.advance(.5)
            for person in view['pedestrians']:
                if person['kind']=='crossing':
                    self.assertNotIn(person['junction'],live.owners)
        self.assertGreater(view['pedestrianPassed'],10)
        self.assertTrue(all(e['color']=='green' for e in live.events))
        restored=City.restore(json.loads(json.dumps(city.snapshot())))
        self.assertEqual(live.advance(10),restored.live_traffic.advance(10))


if __name__=='__main__':unittest.main()
