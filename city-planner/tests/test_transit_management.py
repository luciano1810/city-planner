"""Operating edits change assigned journeys and survive save/undo boundaries."""
import copy
import unittest

from tests.test_city import City
from tests.test_growth_scenarios import separated_towns
from tests.test_bus_vehicles import service
from city import transit_management
from city.signals import LiveTraffic


def management_city():
    city, ids = separated_towns()
    city.command(dict(type='line_update', id=ids['line'], enabled=True))
    return city, ids


class TransitManagementTests(unittest.TestCase):
    def test_real_journey_counts_hourly_demand_and_connected_catchment(self):
        city, ids = management_city()
        before = city.snapshot()
        result = city.query(dict(kind='transit', line=ids['line']))
        self.assertEqual(city.snapshot(), before, 'reading the panel cannot run a settlement')
        self.assertGreater(result['line']['boardings'], 0)
        self.assertEqual(sum(result['hourly']), result['line']['boardings'])
        self.assertEqual(sum(s['boardings'] for s in result['stops']), result['line']['boardings'])
        self.assertEqual(sum(s['alightings'] for s in result['stops']), result['line']['boardings'])
        self.assertGreater(result['hourly'][8], 0)
        self.assertGreater(result['hourly'][18], 0)
        self.assertTrue(any(s['purposes'].get('work', 0)>0 for s in result['stops']))
        self.assertEqual(sorted(s['residents'] for s in result['stops']), [0, 60])
        self.assertGreater(result['stops'][0]['jobs'], 0)
        self.assertEqual(result['stops'][1]['jobs'], 0, 'the highway is not a walking connection')

    def test_vehicle_and_fleet_change_capacity_frequency_cost_and_live_dimensions(self):
        city = service(); identity = city.s['lines'][0]['id']
        city.command(dict(type='line_update', id=identity, vehicleType='minibus', assignedFleet=2))
        line=city.s['lines'][0]
        slow = line['serviceHeadway']; cost=line['operatingCost']
        self.assertEqual(line['capacity'], 30)
        self.assertEqual(line['fleet'], 2)
        self.assertAlmostEqual(slow, line['cycle']/2)
        self.assertTrue(all(abs(s['capacity']-30*120/slow)<1e-8 for s in city.line_segments.values()))
        live=LiveTraffic(city)
        self.assertTrue(live.cars)
        self.assertTrue(all(car['length']==7.2 for car in live.cars))
        self.assertTrue(all(abs(rate-60/slow)<1e-8 for key,rate in live.sources if key.startswith('bus:')))
        city.command(dict(type='line_update', id=identity, vehicleType='articulated', assignedFleet=4))
        line=city.s['lines'][0]
        self.assertEqual(line['fleet'], 4);self.assertEqual(line['capacity'], 140)
        self.assertAlmostEqual(line['serviceHeadway'], slow/2)
        self.assertGreater(line['operatingCost'], cost)
        city.live_traffic=LiveTraffic(city);city.live_traffic.advance(3)
        restored=City.restore(city.snapshot())
        self.assertEqual(restored.live_traffic.snapshot(), city.live_traffic.snapshot())
        self.assertEqual(restored.live_traffic.advance(1), city.live_traffic.advance(1))
        self.assertTrue(all(car['length']==18 for car in restored.live_traffic.cars))
        city.command(dict(type='line_update', id=identity, assignedFleet=None, headway=6))
        self.assertEqual(city.s['lines'][0]['serviceHeadway'], 6)

    def test_single_vehicle_is_bounded_and_serves_both_directions(self):
        city=service();identity=city.s['lines'][0]['id']
        city.command(dict(type='line_update', id=identity, assignedFleet=1))
        live=LiveTraffic(city);sources=set()
        for _ in range(1000):
            live.advance(1)
            self.assertLessEqual(len(live.cars), 1)
            sources.update(car['source'] for car in live.cars)
        self.assertEqual(sources, {city.s['lines'][0]['stops'][0], city.s['lines'][0]['stops'][-1]})

    def test_midnight_schedule_controls_dispatch_and_passenger_assignment(self):
        city, ids=management_city();identity=ids['line']
        city.command(dict(type='line_update', id=identity, startHour=23.5, hours=2))
        line=city.s['lines'][0]
        self.assertEqual(line['boardings'], 0)
        for minute,available in [(23*60+29,False),(23*60+30,True),(60+29,True),(60+30,False)]:
            city.s['simulation']['monthSeconds']=minute*60
            self.assertEqual(bool(LiveTraffic(city).cars),available)
        city.command(dict(type='line_update', id=identity, startHour=0, hours=24))
        self.assertGreater(city.s['lines'][0]['boardings'], 0)
        city.command(dict(type='line_update', id=identity, enabled=False))
        result=city.query(dict(kind='transit',line=identity))
        self.assertEqual(result['line']['boardings'], 0)
        self.assertEqual(sum(result['hourly']), 0)

    def test_history_dates_rename_color_undo_and_save(self):
        city, ids=management_city();identity=ids['line']
        first=copy.deepcopy(city.s['lines'][0])
        city.command(dict(type='line_update', id=identity, name='夜间联络线', color='#ae35b8', vehicleType='standard'))
        line=city.s['lines'][0]
        self.assertEqual(len(line['demandHistory']), 1, 'same-date edits replace, not manufacture history')
        city.command(dict(type='undo'))
        self.assertEqual(city.s['lines'][0]['name'], first['name'])
        city.command(dict(type='redo'))
        city.s['simulation']['monthSeconds']+=86400
        city.assign_traffic()
        result=city.query(dict(kind='transit',line=identity))
        self.assertEqual([r['date'] for r in result['history']], ['2026-01-01','2026-01-02'])
        restored=City.restore(city.snapshot())
        self.assertEqual(restored.query(dict(kind='transit',line=identity)), result)
        self.assertEqual(result['line']['name'], '夜间联络线')
        self.assertEqual(result['line']['color'], '#ae35b8')

    def test_invalid_edits_are_atomic_and_legacy_custom_capacity_survives(self):
        city=service();identity=city.s['lines'][0]['id']
        for changes in [dict(assignedFleet=0),dict(assignedFleet=True),dict(assignedFleet=2.5),dict(assignedFleet=101),dict(vehicleType='unknown'),dict(startHour=24),dict(hours=0),dict(color='red')]:
            before=city.snapshot()
            with self.assertRaises(ValueError):city.command(dict(type='line_update',id=identity,**changes))
            self.assertEqual(city.snapshot(),before)
        city.command(dict(type='line_update',id=identity,vehicleType='minibus'))
        city.command(dict(type='line_update',id=identity,capacity=95))
        self.assertEqual(city.s['lines'][0]['capacity'],95)
        self.assertNotIn('vehicleType',city.s['lines'][0])
        old=city.snapshot()
        for key in ('demandProfile','demandHistory','demandDate','assignedFleet','serviceHeadway'):
            old['state']['lines'][0].pop(key,None)
        result=City.restore(old).query(dict(kind='transit',line=identity))
        self.assertIsNone(result['hourly'])
        self.assertEqual(result['history'],[])


if __name__=='__main__':
    unittest.main()
