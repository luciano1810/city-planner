"""Signal timing, red-light compliance, queues, routing and save continuation."""
import copy
import json
import tempfile
import unittest

from tests.test_city import flat_world, road
from city.engine import City
from city.service import CityService
from city.signals import LiveTraffic, phase, approach_key
from city.routing import shortest_paths


def cross_city():
    city=City(flat_world())
    road(city,[[800,1000],[1200,1000]],'avenue')
    road(city,[[1000,800],[1000,1200]])
    return city


class SignalTests(unittest.TestCase):
    def test_phases_have_exclusive_green_yellow_clearance_and_pedestrian_stage(self):
        junction=cross_city().network['junctions'][0]
        self.assertEqual(phase(junction,0)['phase'],'green')
        self.assertEqual(phase(junction,12)['phase'],'yellow')
        self.assertEqual(phase(junction,15)['phase'],'clearance')
        self.assertEqual(phase(junction,18)['stage'],1)
        for second in range(junction['signal']['cycle']):
            state=phase(junction,second)
            self.assertLessEqual(sum(c=='green' for c in state['lamps'].values()),1)
            if state['pedestrian']=='green':self.assertTrue(all(c=='red' for c in state['lamps'].values()))
        self.assertEqual(phase(junction,0),phase(junction,junction['signal']['cycle']))

    def test_red_cars_stop_before_the_line_then_release_on_green(self):
        city=cross_city();live=LiveTraffic(city,'test');junction=city.network['junctions'][0]
        live.advance(10)
        waiting=[]
        lamps=phase(junction,live.clock)['lamps']
        for car in live.cars:
            link=live.links[car['route'][car['segment']]]
            arm=live.arms.get((link['b'],link['road'],link['direction']))
            if arm and lamps[approach_key(arm)]=='red':
                self.assertLessEqual(car['position'],link['length']-arm['stopDistance']+1e-6)
                if car['reason']:waiting.append(car['id'])
        self.assertGreater(len(waiting),0)
        for _ in range(12):live.advance(10)
        self.assertGreater(live.completed,0)
        self.assertTrue(any(e['car'] in waiting for e in live.events))
        self.assertTrue(all(e['color']=='green' and phase(junction,e['time'])['lamps'][e['approach']]=='green' for e in live.events))

    def test_queues_respect_spacing_and_pausing_does_not_advance_clock(self):
        live=LiveTraffic(cross_city(),'test')
        for _ in range(10):
            live.advance(5)
            groups={}
            for car in live.cars:groups.setdefault((car['route'][car['segment']],live.lane(car)),[]).append(car['position'])
            for positions in groups.values():
                positions.sort()
                self.assertTrue(all(b-a>=6.99 for a,b in zip(positions,positions[1:])))
        state=live.view();self.assertEqual(state,live.advance(0));self.assertEqual(state,live.view())

    def test_waiting_cost_and_green_ratio_affect_directed_routing(self):
        city=cross_city();start='road:0:800.0:1000.0';end='road:0:1200.0:1000.0'
        before=shortest_paths(city.graphs['car'],start,end)[0][end]
        delay=sum(e.get('signalDelay',0) for edges in city.graphs['car'].values() for e in edges)
        self.assertGreater(delay,0)
        self.assertTrue(any(e['signalCapacityFactor']<1 for e in city.network['edges']))
        city.command(dict(type='signal_timing',values=dict(signalClearanceSeconds=10)))
        after=shortest_paths(city.graphs['car'],start,end)[0][end]
        self.assertGreater(after,before)

    def test_save_restores_clock_cars_queues_and_deterministic_continuation(self):
        city=cross_city();city.live_traffic=LiveTraffic(city,'test');city.live_traffic.advance(10)
        restored=City.restore(json.loads(json.dumps(city.snapshot())))
        self.assertEqual(city.live_traffic.view(),restored.live_traffic.view())
        self.assertEqual(city.live_traffic.advance(10),restored.live_traffic.advance(10))
        invalid=city.snapshot();invalid['runtime']['liveTraffic']['cars'][0]['route']=['missing-road']
        with self.assertRaises(ValueError):City.restore(invalid)

    def test_observed_mode_does_not_invent_demand_and_test_flow_preserves_economy(self):
        city=cross_city();before=copy.deepcopy(city.s)
        observed=LiveTraffic(city,'observed');self.assertEqual(observed.advance(10)['vehicles'],[])
        test=LiveTraffic(city,'test');self.assertGreater(len(test.advance(10)['vehicles']),0)
        self.assertEqual(city.s,before)

    def test_v9_save_migrates_with_default_signal_timing(self):
        city=cross_city();snapshot=city.snapshot();roads=copy.deepcopy(city.s['roads'])
        snapshot['model']=snapshot['state']['version']='shanhai-city-9'
        snapshot['state']['policy']['version']='urban-9'
        for key in ('signalGreenSeconds','signalYellowSeconds','signalClearanceSeconds'):
            snapshot['state']['policy'].pop(key)
        restored=City.restore(snapshot)
        self.assertEqual(restored.s['version'],'shanhai-city-10')
        self.assertEqual(restored.s['roads'],roads)
        self.assertEqual(restored.s['policy']['signalGreenSeconds'],12)
        self.assertIn('模型 10',restored.s['migrationNote'])

    def test_invalid_api_step_and_timing_are_atomic(self):
        with tempfile.TemporaryDirectory() as folder:
            service=CityService(folder);city=cross_city();service.cities['test']=city
            service.handle('traffic',dict(id='test',mode='test',seconds=3))
            before=city.live_traffic.view()
            for seconds in (-1,11,True,float('nan')):
                with self.assertRaises(ValueError):service.handle('traffic',dict(id='test',mode='test',seconds=seconds,reset=True))
                self.assertEqual(before,city.live_traffic.view())
            snapshot=city.snapshot()
            with self.assertRaises(ValueError):city.command(dict(type='signal_timing',values=dict(signalGreenSeconds=0)))
            self.assertEqual(snapshot,city.snapshot())


if __name__=='__main__':unittest.main()
