"""Observable journey, physical stopping and continuous trajectory regressions."""
import json
import math
import unittest

from tests.test_city import City, flat_world, road
from tests.test_signals import cross_city
from city.signals import LiveTraffic, approach_key, phase
from city.simulation import advance, DAY, month_days
from city.vehicle_paths import FRONT_CLEARANCE


class VehicleMotionTests(unittest.TestCase):
    def test_single_road_has_complete_trips_without_requiring_a_turn(self):
        city=City(flat_world());road(city,[[700,1000],[1300,1000]])
        live=LiveTraffic(city,'test')
        self.assertTrue(live.cars)
        self.assertTrue(all(len(c['route'])==1 for c in live.cars))
        live.sources=[]
        for _ in range(12):live.advance(10)
        self.assertGreater(live.arrived,0)
        self.assertFalse(live.cars)

    def test_observed_trips_use_real_frontages_and_finish_at_the_destination(self):
        city=City(flat_world());road(city,[[700,1000],[1300,1000]])
        parcels=sorted(city.s['parcels'],key=lambda p:p['frontage'][0])
        a,b=parcels[4],parcels[-5]
        city.trips=[dict(source=a['id'],target=b['id'],mode='car',completed=True)]
        live=LiveTraffic(city,'observed');self.assertEqual(len(live.cars),1)
        car=live.cars[0];identity=car['id'];live.sources=[]
        self.assertEqual((car['source'],car['target']),(a['id'],b['id']))
        self.assertGreater(car['position'],10)
        self.assertLess(car['end'],live.links[car['route'][-1]]['length']-10)
        self.assertAlmostEqual(live.vehicle(car)['point'][0],a['frontage'][0],delta=.1)
        arrived=None
        for _ in range(120):
            live.advance(1)
            if live._departed:
                arrived=live._departed[0];break
        self.assertIsNotNone(arrived)
        self.assertEqual(arrived['id'],identity)
        self.assertEqual(arrived['target'],b['id'])
        self.assertAlmostEqual(arrived['point'][0],b['frontage'][0],delta=.1)
        self.assertEqual(arrived['state'],'arrived')
        self.assertEqual(live.animation()['tracks'][str(identity)][-1][-1],1.)

    def test_turns_have_tangent_continuity_and_stay_on_the_junction_surface(self):
        from shapely.geometry import LineString, Point
        from shapely.ops import unary_union
        from city.parameters import ROAD_TYPES
        live=LiveTraffic(cross_city(),'test')
        surface=unary_union([LineString(r['points']).buffer(ROAD_TYPES[r['kind']]['width']/2) for r in live.city.s['roads']])
        turns=0
        for car in live.cars:
            path=live.path(car)
            for low,high,_ in path.turns:
                turns+=1
                poses=[path.sample(low+(high-low)*i/200) for i in range(201)]
                headings=[p[1] for p in poses]
                changes=[abs(math.atan2(math.sin(b-a),math.cos(b-a))) for a,b in zip(headings,headings[1:])]
                self.assertLess(max(changes),.09)
                self.assertGreater(sum(changes),.5)
                for p,_,_ in poses:self.assertTrue(surface.covers(Point(p)))
                for boundary in [low,high,path.starts[1]]:
                    a=path.sample(boundary-.001);b=path.sample(boundary+.001)
                    self.assertLess(math.dist(a[0],b[0]),.01)
                    self.assertLess(abs(math.atan2(math.sin(b[1]-a[1]),math.cos(b[1]-a[1]))),.09)
        self.assertGreater(turns,0)

    def test_red_light_stops_the_vehicle_front_before_the_painted_line(self):
        live=LiveTraffic(cross_city(),'test');live.sources=[]
        live.advance(10)
        stopped=0
        for car in live.cars:
            link=live.links[car['route'][car['segment']]]
            arm=live.arms.get((link['b'],link['road'],link['direction']))
            if arm and car['reason']=='red':
                stopped+=1
                self.assertLessEqual(car['position']+FRONT_CLEARANCE,link['length']-arm['stopDistance']+1e-7)
        self.assertGreater(stopped,0)

    def test_braking_is_gradual(self):
        live=LiveTraffic(cross_city(),'test');live.sources=[]
        car=next(c for c in live.cars if phase(live.junctions[live.links[c['route'][0]]['b']],0)['lamps'][approach_key(live.arms[(live.links[c['route'][0]]['b'],live.links[c['route'][0]]['road'],live.links[c['route'][0]]['direction'])])]=='red')
        live.cars=[car];link=live.links[car['route'][0]];arm=live.arms[(link['b'],link['road'],link['direction'])]
        car['position']=live.stop_position(link,arm)-35;car['speed']=10
        for _ in range(160):
            before=car['speed'];live.advance(.05)
            self.assertLessEqual(before-car['speed'],3.6*.05+1e-5)
        self.assertLess(car['speed'],.05)
        self.assertAlmostEqual(car['position'],live.stop_position(link,arm),delta=.05)

    def test_response_includes_substep_turn_poses_and_arrival_poses(self):
        live=LiveTraffic(cross_city(),'test');live.advance(10)
        motion=live.animation()
        self.assertAlmostEqual(motion['end']-motion['start'],10)
        self.assertGreater(max(len(points) for points in motion['tracks'].values()),150)
        for points in motion['tracks'].values():
            for a,b in zip(points,points[1:]):
                self.assertLessEqual(math.dist(a[1:3],b[1:3]),.65)
        restored=City.restore(json.loads(json.dumps(live.city.snapshot())))
        self.assertIsNotNone(restored)

    def test_fast_forward_keeps_signal_and_vehicle_time_continuous(self):
        city=cross_city();advance(city,1,1,'test')
        live=city.live_traffic;start=live.signal_clock;ids={c['id'] for c in live.cars}
        for _ in range(5):advance(city,DAY*.1,DAY,'test')
        self.assertIs(city.live_traffic,live)
        self.assertAlmostEqual(live.signal_clock-start,2.5)
        self.assertTrue(ids.intersection(c['id'] for c in live.cars))
        self.assertEqual(live.view()['seconds'],DAY*.5+1)
        self.assertTrue(all(e['color']=='green' for e in live.events))

    def test_month_settlement_preserves_inflight_vehicles_when_roads_stay_the_same(self):
        city=cross_city();city.s['settings'].update(growth=0,autoGrow=False,autoRenew=False)
        advance(city,1,1,'test');live=city.live_traffic
        before={c['id']:live.vehicle(c)['point'] for c in live.cars}
        city.s['simulation']['monthSeconds']=month_days(city.s['month'])*DAY-.1
        result=advance(city,.2,1,'test')
        self.assertIs(city.live_traffic,live)
        self.assertFalse(result['trafficReset'])
        for car in live.cars:
            if car['id'] in before:self.assertLess(math.dist(before[car['id']],live.vehicle(car)['point']),3)
        clone=City.restore(json.loads(json.dumps(city.snapshot())))
        self.assertEqual(live.advance(2),clone.live_traffic.advance(2))


if __name__=='__main__':unittest.main()
