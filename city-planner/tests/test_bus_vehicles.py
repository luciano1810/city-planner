"""Bus dispatch, dwell, signals and exact saved motion use real road physics."""
import copy
import unittest

from tests.test_bus_transit import bus_city, stop
from tests.test_signals import cross_city
from city.engine import City
from city.signals import LiveTraffic


def service():
    city,rid=bus_city()
    city.command(dict(type='bus_line',stops=[stop(rid,[800,1000]),stop(rid,[1000,1000]),stop(rid,[1300,1000])],
                      headway=2,dwell=.1,speed=30))
    return city


class BusVehicleTests(unittest.TestCase):
    def test_departures_call_at_every_stop_and_complete_real_journeys(self):
        city=service();live=LiveTraffic(city)
        self.assertEqual(len(live.cars),2)
        self.assertTrue(all(c.get('mode')=='bus' for c in live.cars))
        bus=live.cars[0];identity=bus['id'];origin=live.vehicle(bus)['point']
        for _ in range(5):live.advance(1)
        self.assertEqual(live.vehicle(bus)['point'],origin)
        self.assertEqual(bus['reason'],'boarding')
        self.assertEqual(bus['callIndex'],0)
        seen=set();moving=False;arrived=None
        for _ in range(115):
            live.advance(1)
            for vehicle in live.view()['vehicles']:
                if vehicle['id']==identity:
                    moving |= vehicle['speed']>2
                    if vehicle['state']=='boarding':seen.add(vehicle['stop'])
            arrived=next((v for v in live._departed if v['id']==identity),arrived)
        self.assertTrue(moving)
        self.assertEqual(seen,set(city.s['lines'][0]['stops']))
        self.assertIsNotNone(arrived)
        self.assertEqual(arrived['stopsServed'],3)
        self.assertEqual(arrived['progress'],1)
        live.advance(1)
        self.assertGreaterEqual(live.serial,4,'next departure follows the two-minute headway')
        self.assertTrue(all(car.get('mode')=='bus' for car in live.cars),'bus volume must not also spawn cars')

    def test_buses_obey_protected_signals_and_stop_before_red(self):
        city=cross_city();rid=city.s['roads'][0]['id']
        city.command(dict(type='special_building',kind='bus_depot',point=[850,900]))
        city.command(dict(type='bus_line',stops=[stop(rid,[850,1000]),stop(rid,[1150,1000])],dwell=.1,headway=2))
        live=LiveTraffic(city);red=False
        for _ in range(170):
            live.advance(1)
            for car in live.cars:
                if car['reason']=='red':
                    link=live.links[car['route'][car['segment']]]
                    arm=live.arms[(link['b'],link['road'],link['direction'])]
                    self.assertLessEqual(car['position'],live.stop_position(link,arm,car['length'])+.02)
                    red=True
        self.assertTrue(red)
        self.assertGreater(live.arrived,0)
        self.assertTrue(live.events)
        self.assertTrue(all(event['color']=='green' for event in live.events))

    def test_saving_mid_dwell_resumes_the_same_vehicle_and_stop_timer(self):
        city=service();city.live_traffic=LiveTraffic(city);city.live_traffic.advance(3)
        restored=City.restore(city.snapshot())
        self.assertEqual(city.live_traffic.snapshot(),restored.live_traffic.snapshot())
        for _ in range(15):
            self.assertEqual(city.live_traffic.advance(1),restored.live_traffic.advance(1))
        data=copy.deepcopy(city.live_traffic.snapshot());data['cars'][0]['calls'][0]['position']=-1
        with self.assertRaisesRegex(ValueError,'停靠位置'):
            LiveTraffic(city).restore(data)

    def test_dispatch_respects_operating_hours_one_way_and_disabled_lines(self):
        city=service();line=city.s['lines'][0]
        city.command(dict(type='line_update',id=line['id'],startHour=22,hours=4,oneway=True))
        self.assertFalse(LiveTraffic(city).cars)
        city.s['simulation']['monthSeconds']=23*3600
        live=LiveTraffic(city);self.assertEqual(len(live.cars),1)
        city.s['simulation']['monthSeconds']=1*3600
        self.assertEqual(len(LiveTraffic(city).cars),1)
        city.s['simulation']['monthSeconds']=2*3600
        self.assertFalse(LiveTraffic(city).cars)
        city.command(dict(type='line_update',id=line['id'],enabled=False))
        self.assertFalse(LiveTraffic(city).cars)


if __name__=='__main__':
    unittest.main()
