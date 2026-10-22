"""Taxi service must improve access without inventing vehicles or free trips."""
import copy
import json
import unittest
from collections import defaultdict

from tests.test_city import City, flat_world, road
from tests.test_city_v3 import complete
from city import taxis
from city.signals import LiveTraffic


def taxi_city(households=12):
    city=City(flat_world())
    city.s['settings']['autoGrow']=False
    road(city,[(200,1000),(3800,1000)],kind='avenue')
    parcels=sorted(city.s['parcels'],key=lambda p:p['frontage'][0])
    home,job=parcels[2],parcels[-3]
    complete(city,home,'residential',max(20,households))
    complete(city,job,'office',max(20,households))
    city.s['households']=[dict(id=f'h-{i}',home=home['id'],job=job['id'],income=10000,car=False,
                               size=1,stress=0,unemployedMonths=0,burden=.1)
                          for i in range(households)]
    city.s['policy']['walkMaximumMinutes']=10
    city.rebuild()
    return city,home['id'],job['id']


class TaxiTests(unittest.TestCase):
    def enable(self,city,**values):
        city.s['taxi']=taxis.settings(dict(enabled=True,**values),city.s['taxi'])
        city._taxi_preview=None

    def test_quotes_are_nonmutating_and_use_fares_wait_and_income(self):
        city,a,b=taxi_city()
        self.assertIsNone(city.route(a,b,False))
        self.enable(city)
        quote=city.route(a,b,False,income=10000)
        self.assertEqual(quote['mode'],'taxi')
        self.assertTrue(quote['taxiRescued'])
        self.assertGreaterEqual(quote['wait'],1)
        self.assertGreater(quote['fee'],city.s['taxi']['baseFare'])
        self.assertEqual(city._taxi_preview.completed,0)
        self.assertEqual(city.route(a,b,False,income=10000),quote)
        self.assertIsNone(city.route(a,b,False,income=100))
        self.assertIsNone(city.route(a,b,False,required_mode='train'))

    def test_same_vehicle_cannot_accept_overlapping_trips_and_stays_at_dropoff(self):
        city,a,b=taxi_city();self.enable(city,fleetSize=1,maxWaitMinutes=2)
        dispatch=taxis.Dispatch(city);city._taxi_dispatch=dispatch
        city.road_load=defaultdict(float);city.segment_load=defaultdict(float)
        first=city.route(a,b,False,income=10000,allocate=True,departure=480)
        self.assertIsNotNone(first)
        self.assertIsNone(city.route(a,b,False,income=10000,allocate=True,departure=480))
        self.assertEqual(dispatch.vehicles[0]['location'],b)
        finish=dispatch.vehicles[0]['available']
        back=city.route(b,a,False,income=10000,allocate=True,departure=finish+1)
        self.assertIsNotNone(back)
        self.assertEqual(back['taxiVehicle'],first['taxiVehicle'])
        self.assertEqual(back['emptyDistance'],0)
        self.assertEqual(dispatch.completed,2)
        self.assertEqual(sum(dispatch.failures.values()),1)

    def test_pickup_paths_are_counted_as_traffic_and_are_not_passenger_trips(self):
        city,a,b=taxi_city();self.enable(city,fleetSize=1,maxWaitMinutes=30)
        dispatch=taxis.Dispatch(city);city._taxi_dispatch=dispatch
        city.road_load=defaultdict(float);city.segment_load=defaultdict(float)
        dispatch.vehicles[0]['location']=b
        journey=city.route(a,b,False,income=10000,allocate=True,departure=480)
        self.assertGreater(journey['emptyDistance'],3000)
        report=dispatch.report()
        self.assertEqual(report['completed'],1)
        self.assertEqual(len(report['emptyJourneys']),1)
        self.assertAlmostEqual(report['emptyKm'],journey['emptyDistance']/1000)
        expected=defaultdict(float)
        for path in (dispatch.path(b,a)[2],dispatch.path(a,b)[2]):
            for edge in path:
                if edge.get('ref'):expected[('am',edge['ref'])]+=1
        self.assertEqual(dict(city.road_load),dict(expected))

    def test_disconnected_roads_oneway_and_service_hours_are_respected(self):
        city,a,b=taxi_city();self.enable(city,startHour=22,hours=8,maxWaitMinutes=30)
        self.assertIsNone(city.route(a,b,False,departure=720))
        self.assertEqual(city.route(a,b,False,departure=60)['mode'],'taxi')
        self.assertIsNone(city.route(a,b,False,departure=359))
        road(city,[(200,3000),(1800,3000)])
        far=next(p['id'] for p in city.s['parcels'] if p['center'][1]>2500)
        self.assertIsNone(city.route(a,far,False,departure=60))
        city.s['roads'][0]['oneway']=True;city.rebuild()
        self.assertIsNone(city.route(b,a,False,departure=60))
        self.assertEqual(city.route(a,b,False,departure=60)['mode'],'taxi')

    def test_daily_assignment_reduces_failures_and_conserves_fleet_and_metrics(self):
        city,a,b=taxi_city(40)
        city.assign_traffic();baseline=sum(not t['completed'] for t in city.trips)
        self.assertEqual(baseline,80)
        self.enable(city,fleetSize=2)
        city.assign_traffic();city.summarize()
        report=city.s['taxiReport'];stats=city.s['stats']
        self.assertLess(stats['failedTrips'],baseline)
        self.assertGreater(report['rescued'],0)
        self.assertEqual(stats['taxiTrips'],sum(t.get('mode')=='taxi' for t in city.trips))
        self.assertEqual(len(city.trips),baseline)
        self.assertGreater(report['emptyKm'],0)
        self.assertAlmostEqual(stats['vehicleKm'],report['occupiedKm']+report['emptyKm'])
        self.assertAlmostEqual(sum(stats['modeShare'].values()),100)
        self.assertLessEqual(report['active'],2)
        self.assertLessEqual(report['utilization'],1)
        schedules=defaultdict(list)
        for booking in report['bookings']:schedules[booking['vehicle']].append(booking)
        for bookings in schedules.values():
            for first,second in zip(bookings,bookings[1:]):
                self.assertGreaterEqual(second['dispatch'],first['finish'])
                self.assertEqual(second['origin'],first['target'])
        self.assertAlmostEqual(sum(h['transportCost'] for h in city.s['households']),
                               report['revenue']*city.s['policy']['workingDaysPerMonth'])
        city.finance()
        self.assertEqual(city.s['operatingAccounts']['fares'],0)
        self.assertNotIn('bookings',city.view()['taxiReport'])

    def test_bus_remains_an_option_and_taxis_do_not_consume_bus_capacity(self):
        from tests.test_city import TransitTests
        city,stops,a,b=TransitTests().transit_city()
        city.command(dict(type='line',name='公交',mode='bus',stops=stops,headway=2))
        self.enable(city,baseFare=100,perKm=20)
        city.segment_load=defaultdict(float);city.road_load=defaultdict(float)
        journey=city.route(a,b,False,income=3500,allocate=True)
        self.assertEqual(journey['mode'],'public')
        self.assertGreater(sum(city.segment_load.values()),0)
        self.enable(city,baseFare=0,perKm=0,perMinute=0,fleetSize=500)
        city._taxi_dispatch=taxis.Dispatch(city)
        city.segment_load=defaultdict(float);city.road_load=defaultdict(float)
        journey=city.route(a,b,False,income=10000,allocate=True)
        self.assertEqual(journey['mode'],'taxi')
        self.assertEqual(sum(city.segment_load.values()),0)
        self.assertGreater(sum(city.road_load.values()),0)

    def test_settings_validation_undo_and_legacy_restore(self):
        city=City(flat_world());before=city.snapshot()
        for values in [dict(fleetSize=-1),dict(fleetSize=1.5),dict(fleetSize=501),dict(baseFare=float('nan')),
                       dict(enabled='true'),dict(startHour=24),dict(hours=0),dict(unknown=3)]:
            with self.assertRaises(ValueError):city.command(dict(type='taxi_settings',values=values))
            self.assertEqual(city.snapshot(),before)
        city.command(dict(type='taxi_settings',values=dict(enabled=True,fleetSize=10)))
        self.assertTrue(city.s['taxi']['enabled'])
        city.command(dict(type='undo'));self.assertFalse(city.s['taxi']['enabled'])
        city.command(dict(type='redo'));self.assertEqual(city.s['taxi']['fleetSize'],10)
        legacy=copy.deepcopy(before);legacy['state'].pop('taxi');legacy['state'].pop('taxiReport')
        restored=City.restore(legacy)
        self.assertEqual(restored.s['taxi'],taxis.DEFAULTS)
        self.assertEqual(City.restore(city.snapshot()).s['taxi'],city.s['taxi'])

    def test_save_restore_live_taxis_and_deterministic_next_assignment(self):
        city,a,b=taxi_city();self.enable(city,fleetSize=2)
        city.assign_traffic();city.summarize()
        live=city.live_traffic=LiveTraffic(city,'observed')
        self.assertTrue(any(car['kind']=='taxi' for car in live.view()['vehicles']))
        self.assertTrue(any(plan.get('taxiState')=='pickup' for plans in live.journeys.values() for plan in plans))
        live.advance(2)
        restored=City.restore(json.loads(json.dumps(city.snapshot())))
        self.assertEqual(restored.s['taxiReport'],city.s['taxiReport'])
        self.assertEqual(restored.live_traffic.view(),live.view())
        city.assign_traffic();restored.assign_traffic()
        self.assertEqual(city.s['taxiReport'],restored.s['taxiReport'])
        self.assertEqual(city.trips,restored.trips)


if __name__=='__main__':
    unittest.main()
