"""Requirement audit: physical faces, real overtaking, loops and dated feedback."""
import copy
import unittest
from unittest.mock import patch
from tests.test_rail_reconstruction import rail_city, line, clock, intent
from city import rail_runtime, rail_services, rail_infrastructure


class RailAuditTests(unittest.TestCase):
    def test_reversed_service_orders_share_physical_platform_faces(self):
        c,stops,_=rail_city(third=True);a=line(c,stops);b=line(c,stops[::-1])
        east=a['routePlans'][0][0];also_east=b['routePlans'][1][0]
        self.assertNotEqual(east['direction'],also_east['direction'])
        self.assertEqual(east['platformB'],also_east['platformB'])
        self.assertEqual(east['platformFaceB'],also_east['platformFaceB'])
        self.assertEqual({k for k in east['resources'] if k.startswith('platform:')},{k for k in also_east['resources'] if k.startswith('platform:')})

    def test_skipped_station_remains_occupied_without_bypass(self):
        c,stops,_=rail_city(third=True);fast=line(c,stops,stopPattern={stops[1]['id']:False})
        pid=stops[1]['platforms'][0]['id']
        self.assertIn('platform:'+pid+':0',fast['routePlans'][0][0]['resources'])
        c.command(dict(type='rail_facility',kind='passing',platform=pid,point=stops[1]['point']))
        fast=c.s['lines'][0]
        self.assertNotIn('platform:'+pid+':0',fast['routePlans'][0][0]['resources'])
        before=c.snapshot()
        with self.assertRaisesRegex(ValueError,'已有越行'):c.command(dict(type='rail_facility',kind='passing',platform=pid,point=stops[1]['point']))
        self.assertEqual(before,c.snapshot())

    def test_actual_overtaking_requires_bypass_and_regular_service_finishes(self):
        def run(bypass):
            c,stops,_=rail_city(third=True)
            if bypass:c.command(dict(type='rail_facility',kind='passing',platform=stops[1]['platforms'][0]['id'],point=stops[1]['point']))
            slow=line(c,stops,headway=60,dwell=8,startHour=8,hours=1,assignedFleet=1)
            fast=line(c,stops,headway=60,dwell=.2,startHour=8,hours=1,assignedFleet=1,stopPattern={stops[1]['id']:False})
            clock(c,470);intent(c,slow,stops,minute=480+slow['serviceHeadway']/2+c.s['policy']['boardingMinutes']);a=copy.deepcopy(c.trips)
            intent(c,fast,stops,minute=480+fast['serviceHeadway']/2+c.s['policy']['boardingMinutes']);c.trips=a+[dict(t,source='fast-home') for t in c.trips]
            rail_runtime.advance(c,4*3600)
            events=c.s['railRuntime']['events']
            departures={lid:next(e['time'] for e in events if e['line']==lid and e['kind']=='departure') for lid in (slow['id'],fast['id'])}
            exits={lid:next(e['time'] for e in events if e['line']==lid and e['kind']=='exit') for lid in (slow['id'],fast['id'])}
            self.assertGreater(departures[fast['id']],departures[slow['id']]);self.assertFalse(c.s['railRuntime']['trains'])
            return exits[fast['id']]<exits[slow['id']]
        self.assertFalse(run(False));self.assertTrue(run(True))

    def test_closed_loop_both_directions_complete_without_deadlock(self):
        c,stops,_=rail_city(third=True)
        a,b=stops[-1]['platforms'][0]['ports'][1],stops[0]['platforms'][0]['ports'][0]
        c.command(dict(type='road',kind='train',level=-1,snap=False,railManaged=True,points=[a,[3700,950],[3700,1800],[300,1800],[300,950],b]))
        l=line(c,stops,servicePattern='loop_both',assignedFleet=5,headway=2,startHour=8,hours=1)
        clock(c,475);intent(c,l,stops,minute=486,direction=0);first=copy.deepcopy(c.trips)
        intent(c,l,stops,minute=486,direction=1);c.trips=first+[dict(t,source='reverse-home') for t in c.trips]
        rail_runtime.advance(c,4*3600)
        counts=c.s['railRuntime']['totals']['network']
        self.assertEqual(counts['entry'],2);self.assertEqual(counts['exit'],2);self.assertEqual(counts['board'],2)
        self.assertGreater(counts['directions']['0']['departure'],0);self.assertGreater(counts['directions']['1']['departure'],0)
        self.assertFalse(c.s['railRuntime']['trains']);self.assertFalse(c.s['railRuntime']['passengers'])

    def test_capacity_splits_large_party_without_losing_people(self):
        c,stops,_=rail_city();l=line(c,stops,formation=1,headway=20)
        clock(c,475);intent(c,l,stops,minute=492,n=200);rail_runtime.advance(c,35*60)
        counts=c.s['railRuntime']['totals']['network'];v=rail_runtime.view(c)
        self.assertEqual(counts['board'],150);self.assertEqual(v['waiting'],50)
        self.assertEqual(counts['entry'],counts.get('exit',0)+v['waiting']+v['onboard'])

    def test_actual_hourly_and_directional_statistics_reconcile(self):
        c,stops,_=rail_city();l=line(c,stops,headway=4)
        clock(c,475);intent(c,l,stops,minute=482,n=5);rail_runtime.advance(c,3600)
        day=next(iter(c.s['railRuntime']['days'].values()));row=day['totals']['line:'+l['id']]
        self.assertEqual(sum(h.get('board',0) for h in row['hours']),row['board'])
        self.assertEqual(row['directions']['0']['board'],5)
        self.assertEqual(row['directions']['0']['alight'],5)
        self.assertGreater(row['directions']['1']['departure'],0)
        self.assertEqual(sum(v.get('departure',0) for v in row['directions'].values()),row['departure'])

    def test_route_shortening_prunes_old_platform_and_via_keys(self):
        c,stops,_=rail_city(third=True);l=line(c,stops,stopPattern={stops[1]['id']:False},via={stops[1]['id']:[]})
        c.command(dict(type='line_update',id=l['id'],stops=[stops[0]['id'],stops[-1]['id']]))
        self.assertTrue(l['valid']);self.assertNotIn(stops[1]['id'],l['stopPattern']);self.assertNotIn(stops[1]['id'],l['via'])

    def test_fleet_and_schedule_edit_recomputes_next_departure(self):
        c,stops,_=rail_city();l=line(c,stops,headway=60,startHour=10,hours=1)
        clock(c,475);rail_runtime.advance(c,60)
        c.command(dict(type='line_update',id=l['id'],startHour=8,headway=4))
        rail_runtime.advance(c,20*60)
        self.assertGreater(c.s['railRuntime']['totals']['line:'+l['id']]['departure'],0)

    def test_undo_after_time_advance_preserves_live_counts_and_clock(self):
        c,stops,_=rail_city();l=line(c,stops,headway=4);clock(c,475)
        c.command(dict(type='line_update',id=l['id'],name='临时名字'))
        intent(c,l,stops,minute=482,n=3)
        from city import simulation
        simulation.advance_calendar(c,3600)
        before=copy.deepcopy(c.s['railRuntime']);c.command(dict(type='undo'))
        self.assertEqual(before,c.s['railRuntime']);self.assertNotEqual(c.s['lines'][0]['name'],'临时名字')

    def test_unchanged_service_edit_reuses_physical_topology(self):
        c,stops,_=rail_city();l=line(c,stops)
        with patch('city.engine.make_network',side_effect=AssertionError('unexpected physical rebuild')):
            c.command(dict(type='line_update',id=l['id'],name='新名称'))
        self.assertEqual(c.s['lines'][0]['name'],'新名称')

    def test_facility_preview_is_atomic_and_matches_actual_cost(self):
        c,stops,_=rail_city(third=True);cmd=dict(type='rail_facility',kind='turnback',platform=stops[1]['platforms'][0]['id'],point=stops[1]['point'])
        before=c.snapshot();p=rail_infrastructure.facility_preview(c,cmd)
        self.assertTrue(p['valid'],p);self.assertEqual(before,c.snapshot());self.assertTrue(p['facility']['footprint'])
        cash=c.s['treasury'];c.command(cmd);self.assertEqual(cash-c.s['treasury'],p['cost'])

    def test_undo_cannot_remove_an_occupied_track_and_is_atomic(self):
        c,stops,_=rail_city();l=line(c,stops,headway=4);clock(c,475)
        # An undo target from before this connector existed must not bypass occupancy.
        candidate=copy.deepcopy(c.s);road=next(r for r in c.s['roads'] if r.get('railManaged') and not r.get('platform'))
        candidate['roads']=[r for r in candidate['roads'] if r['id']!=road['id']]
        candidate['simulation']['monthSeconds']-=60
        c.undo.append((candidate,c.rng.getstate(),c.runtime()))
        c.s['railRuntime']['reservations']['block:'+road['id']+':0']={'train':'test','until':1e12}
        before=c.snapshot();undo=len(c.undo);redo=len(c.redo)
        with self.assertRaisesRegex(ValueError,'正在占用'):c.command(dict(type='undo'))
        self.assertEqual(before,c.snapshot());self.assertEqual(undo,len(c.undo));self.assertEqual(redo,len(c.redo))
