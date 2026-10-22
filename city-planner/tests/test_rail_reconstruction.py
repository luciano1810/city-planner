"""Rail construction transactions, physical platforms, service and event conservation."""
import copy
import json
import unittest
from tests.test_city import City, flat_world, road
from city import rail_infrastructure as infrastructure, rail_runtime, rail_services, simulation


def rail_city(count=2,third=False):
    city=City(flat_world(),'铁路验收场景')
    city.s['settings'].update(autoGrow=False,autoRenew=False,growth=0,migration=0)
    road(city,[(200,1000),(3800,1000)])
    stations=[]
    for i,x in enumerate((500,2000,3500) if third else (500,3500)):
        city.command(dict(type='rail_station',mode='metro' if i==0 else 'train',name=['海西站','中央站','海东站'][i],point=[x,950],level=-1,platformCount=count))
        stations.append(city.s['stops'][-1])
    tracks=[]
    for a,b in zip(stations,stations[1:]):
        p,q=a['platforms'][0],b['platforms'][0]
        city.command(dict(type='road',kind='train',level=-1,points=[p['ports'][1],q['ports'][0]],snap=False,railManaged=True))
        tracks.append(city.s['roads'][-1]['id'])
    for s in (stations[0],stations[-1]):
        city.command(dict(type='rail_facility',kind='turnback',platform=s['platforms'][0]['id'],point=s['point']))
    return city,stations,tracks


def line(city,stations,**options):
    city.command(dict(type='line',mode='metro',name='市域直通线',stops=[s['id'] for s in stations],
                      platforms={s['id']:s['platforms'][0]['id'] for s in stations},**options))
    return city.s['lines'][-1]


def clock(city,minute):
    city.s['simulation']['monthSeconds']=minute*60
    city.s.pop('railRuntime',None);rail_runtime.ensure(city)


def intent(city,l,stations,minute=481,n=1,direction=0):
    order=stations if not direction else stations[::-1]
    city.trips=[dict(source='home',target='work',purpose='work',people=n,completed=True,mode='public',fee=2,
        transitCalls=[dict(line=l['id'],stop=order[0]['id'],kind='board',minute=minute,direction=direction),
                      dict(line=l['id'],stop=order[-1]['id'],kind='alight',minute=minute+8,direction=direction)])]


class StationConstructionTests(unittest.TestCase):
    def test_three_levels_platform_count_ports_and_pending(self):
        city=City(flat_world());road(city,[(200,1000),(3800,1000)])
        for level,x in [(-1,500),(0,1600),(1,2700)]:
            cmd=dict(type='rail_station',mode='metro',level=level,point=[x,950],platformCount=2)
            before=city.snapshot();preview=infrastructure.station_preview(city,cmd)
            self.assertTrue(preview['valid'],preview);self.assertEqual(before,city.snapshot())
            city.command(cmd);s=city.s['stops'][-1]
            self.assertEqual(s['status'],'待连接');self.assertEqual(len(s['platforms']),2)
            self.assertEqual(len({p['id'] for p in s['platforms']}),2)
            self.assertTrue(all(len(p['ports'])==2 for p in s['platforms']))
            self.assertEqual(len(s['entrances']),1)

    def test_invalid_entrance_is_atomic_and_budget_safe(self):
        city=City(flat_world());before=city.snapshot()
        with self.assertRaisesRegex(ValueError,'室外入口'):
            city.command(dict(type='rail_station',mode='metro',point=[500,500],level=-1,platformCount=3))
        self.assertEqual(city.snapshot(),before)

    def test_platform_edit_keeps_ids_blocks_referenced_reduction(self):
        city,stations,_=rail_city();s=stations[0];ids=[p['id'] for p in s['platforms']]
        city.command(dict(type='rail_station',id=s['id'],platformCount=3))
        self.assertEqual([p['id'] for p in s['platforms'][:2]],ids)
        city.command(dict(type='rail_station',id=s['id'],platformCount=2))
        self.assertEqual([p['id'] for p in s['platforms']],ids)
        l=line(city,stations);before=city.snapshot()
        # A disconnected last platform is legal to remove; the selected first
        # platform cannot be removed by deleting its owned track.
        with self.assertRaisesRegex(ValueError,'站台轨道'):
            city.command(dict(type='delete',id=s['platforms'][0]['track']))
        self.assertEqual(before,city.snapshot())
        city.command(dict(type='rail_station',id=s['id'],platformCount=1))
        self.assertEqual(s['platforms'][0]['id'],ids[0])
        self.assertTrue(city.s['lines'][0]['valid'])

    def test_building_overlap_preserves_building_and_direct_entry(self):
        from tests.test_growth_scenarios import separated_towns
        city,ids=separated_towns();p=city.parcelmap[ids['home']];old=copy.deepcopy(p['building']);people=copy.deepcopy(city.s['households'])
        point=p['center'];cmd=dict(type='rail_station',mode='metro',point=point,level=0,platformCount=1)
        self.assertFalse(infrastructure.station_preview(city,cmd)['valid'])
        cmd['level']=-1;result=infrastructure.station_preview(city,cmd)
        self.assertTrue(result['valid'],result);city.command(cmd)
        s=city.s['stops'][-1]
        self.assertEqual(p['building']['id'],old['id']);self.assertEqual(p['building']['footprint'],old['footprint'])
        self.assertEqual([h['id'] for h in people],[h['id'] for h in city.s['households']])
        entries=[e for e in s['entrances'] if e['kind']=='building'];self.assertEqual(len(entries),1)
        self.assertEqual(entries[0]['building'],p['id'])
        self.assertTrue(any(e.get('ref')==entries[0]['id'] and e['to']==s['id'] for e in city.graphs['walk'][p['id']]))
        city.command(dict(type='delete',id=p['id']))
        self.assertFalse(entries[0]['valid']);self.assertTrue(s['accessible'])

    def test_entrance_disable_undo_and_save(self):
        city,stations,_=rail_city();s=stations[0];entry=s['entrances'][0]['id']
        city.command(dict(type='rail_entry',station=s['id'],id=entry,action='toggle'))
        self.assertFalse(s['accessible']);self.assertNotIn(s['id'],city.graphs['walk'])
        city.command(dict(type='undo'))
        restored=City.restore(json.loads(json.dumps(city.snapshot())))
        rs=next(s for s in restored.s['stops'] if s['id']==stations[0]['id'])
        self.assertTrue(rs['accessible']);self.assertEqual(rs['entrances'][0]['id'],entry)


class RailTopologyTests(unittest.TestCase):
    def test_strict_crossing_requires_switch_and_different_levels_isolate(self):
        city=City(flat_world())
        def rail(points,level=0):
            city.command(dict(type='road',kind='train',level=level,points=points,snap=False,railManaged=True))
            return city.s['roads'][-1]['id']
        a=rail([[500,1000],[1500,1000]]);b=rail([[1000,500],[1000,1500]])
        def nodes(rid):return {e[k] for e in city.network['edges'] if e['road']==rid for k in ('a','b')}
        self.assertFalse(nodes(a)&nodes(b))
        city.command(dict(type='rail_facility',kind='switch',point=[1000,1000],level=0))
        self.assertTrue(nodes(a)&nodes(b))
        c=rail([[1000,500],[1000,1500]],-1)
        self.assertFalse(nodes(a)&nodes(c))

    def test_specific_platform_and_turnback_validation(self):
        city,stations,_=rail_city();cmd=dict(mode='metro',stops=[s['id'] for s in stations],platforms={s['id']:s['platforms'][1]['id'] for s in stations})
        result=rail_services.preview(city,cmd);self.assertFalse(result['valid']);self.assertIn('2 号站台待接轨',result['reason'])
        p=stations[0]['platforms'][0];p['turnback']=False
        result=rail_services.preview(city,dict(cmd,platforms={s['id']:s['platforms'][0]['id'] for s in stations}))
        self.assertFalse(result['valid']);self.assertIn('折返',result['reason'])

    def test_platform_length_failure_is_atomic(self):
        city,stations,_=rail_city();l=line(city,stations);before=city.snapshot()
        with self.assertRaisesRegex(ValueError,'短于列车'):
            city.command(dict(type='line_update',id=l['id'],formation=8))
        self.assertEqual(city.snapshot(),before)

    def test_through_running_one_boarding_no_transfer(self):
        city,stations,_=rail_city(third=True);l=line(city,stations)
        self.assertEqual(l['serviceType'],'through')
        result=city.route(stations[0]['id'],stations[-1]['id'],False)
        self.assertEqual(result['transfers'],0);self.assertEqual(result['fee'],2)
        self.assertEqual(sum(e['kind']=='board' for e in result['path']),1)
        self.assertEqual(sum(e['kind']=='ride' for e in result['path']),2)

    def test_shared_capacity_and_deleting_track_recover(self):
        city,stations,tracks=rail_city();a=line(city,stations,headway=2)
        initial=a['serviceHeadway'];b=line(city,stations,headway=2)
        self.assertGreater(a['serviceHeadway'],initial);self.assertTrue(a['shared'])
        self.assertAlmostEqual(a['serviceHeadway'],b['serviceHeadway'])
        city.command(dict(type='delete',id=tracks[0]))
        self.assertTrue(all(not l['valid'] for l in city.s['lines']))
        city.command(dict(type='undo'));self.assertTrue(all(l['valid'] for l in city.s['lines']))

    def test_loop_not_fake_out_and_back(self):
        city,stations,_=rail_city()
        with self.assertRaisesRegex(ValueError,'闭合'):
            line(city,stations,servicePattern='loop')
        self.assertFalse(city.s['lines'])

    def test_passing_track_is_real_and_express_never_boards_skipped_station(self):
        city,stations,_=rail_city(third=True)
        slow=line(city,stations)
        fast=line(city,stations,stopPattern={stations[1]['id']:False})
        before=copy.deepcopy(fast['paths'])
        self.assertFalse(any(e['kind']=='board' and e['ref']==fast['id'] for e in city.graphs['public'].get(stations[1]['id'],[])))
        p=stations[1]['platforms'][0]
        city.command(dict(type='rail_facility',kind='passing',point=p['point'],platform=p['id'],level=-1))
        bypass=next(r for r in city.s['roads'] if r.get('bypassFor')==p['id'])
        self.assertNotEqual(before,fast['paths'])
        self.assertTrue(any(e['ref'].startswith(bypass['id']+':') for plan in fast['routePlans'] for seg in plan for e in seg['path']))

    def test_auto_transfer_uses_walking_paths_and_retains_group_edges(self):
        city=City(flat_world());road(city,[(200,1000),(1800,1000)])
        for x in (500,700,900):city.command(dict(type='rail_station',point=[x,950],mode='metro',level=-1,platformCount=1))
        links=city.s['railInfrastructure']['transfers'];self.assertTrue(all(t['valid'] for t in links))
        self.assertEqual(len(links),2);self.assertEqual(len(city.s['railInfrastructure']['groups'][0]['stations']),3)
        a,_,b=city.s['stops'];minutes=city.distances(a['id'],'walk')[0][b['id']]
        self.assertGreater(minutes,400/80)
        city.command(dict(type='rail_rules',transferMeters=100))
        self.assertFalse(city.s['railInfrastructure']['groups'])


class RailRuntimeTests(unittest.TestCase):
    def test_actual_events_conserve_people_and_through_ticket_once(self):
        city,stations,_=rail_city(third=True);l=line(city,stations,headway=4)
        clock(city,475);intent(city,l,stations,minute=482,n=3)
        rail_runtime.advance(city,45*60)
        runtime=city.s['railRuntime'];totals=runtime['totals']['network']
        self.assertEqual(totals['entry'],3);self.assertEqual(totals['board'],3)
        self.assertEqual(totals['alight'],3);self.assertEqual(totals['exit'],3)
        self.assertNotIn('transfer',totals);self.assertEqual(runtime['pendingFare'],6)
        self.assertFalse(runtime['passengers'])

    def test_step_size_and_reload_do_not_change_authoritative_trains_or_events(self):
        city,stations,_=rail_city();l=line(city,stations,headway=3)
        clock(city,475);intent(city,l,stations,minute=482,n=2)
        other=City.restore(json.loads(json.dumps(city.snapshot())))
        rail_runtime.advance(city,1800)
        for _ in range(180):rail_runtime.advance(other,10)
        self.assertEqual(city.s['railRuntime'],other.s['railRuntime'])
        restored=City.restore(json.loads(json.dumps(city.snapshot())))
        rail_runtime.advance(city,120);rail_runtime.advance(restored,120)
        self.assertEqual(city.s['railRuntime'],restored.s['railRuntime'])

    def test_inflight_riders_survive_pause_and_fleet_edit(self):
        city,stations,_=rail_city();l=line(city,stations,headway=2)
        clock(city,475);intent(city,l,stations,minute=482,n=2)
        for _ in range(60):
            rail_runtime.advance(city,30)
            if rail_runtime.view(city)['onboard']:break
        self.assertEqual(rail_runtime.view(city)['onboard'],2)
        original=copy.deepcopy(city.s['railRuntime']['passengers'])
        city.command(dict(type='line_update',id=l['id'],enabled=False))
        self.assertEqual(original,city.s['railRuntime']['passengers'])
        rail_runtime.advance(city,1800)
        self.assertEqual(city.s['railRuntime']['totals']['network']['exit'],2)

    def test_midnight_continues_service_and_does_not_double_settle(self):
        city,stations,_=rail_city();l=line(city,stations,headway=5,startHour=23.5,hours=2)
        clock(city,23*60+55)
        city.s['settings'].update(migration=0,maxProjects=0,externalJobs=0)
        before=city.s['treasury'];simulation.advance_calendar(city,10*60)
        self.assertEqual(city.s['calendar']['lastSettlementDay'],1)
        self.assertTrue(rail_runtime.operating(city.s['lines'][0],86400+5*60))
        self.assertTrue(city.s['railRuntime']['trains']);self.assertLess(city.s['treasury'],before)
        after=city.s['treasury'];city.command(dict(type='line_update',id=l['id'],color='#335577'))
        self.assertEqual(city.s['treasury'],after)
        simulation.advance_calendar(city,100*60)
        self.assertFalse(rail_runtime.operating(city.s['lines'][0],86400+105*60))
        self.assertEqual(city.s['calendar']['lastSettlementDay'],1)

    def test_no_fabricated_history_for_legacy_saves(self):
        city,stations,_=rail_city();saved=city.snapshot();saved['state'].pop('railRuntime')
        restored=City.restore(saved)
        self.assertEqual(restored.s['railRuntime']['totals'],{});self.assertEqual(restored.s['railRuntime']['history'],[])
        self.assertIsNone(rail_services.details(restored)['stops'][0]['actual'])


class RailAdditionalAcceptanceTests(unittest.TestCase):
    def test_explicit_passage_connects_isolated_halls_and_closure_updates_group(self):
        city=City(flat_world())
        road(city,[(350,1000),(570,1000)]);road(city,[(680,1000),(900,1000)])
        for x in (500,750):city.command(dict(type='rail_station',point=[x,950],level=-1,mode='metro',platformCount=1))
        a,b=city.s['stops'];self.assertFalse(city.s['railInfrastructure']['transfers'][0]['valid'])
        cmd=dict(type='rail_passage',a=a['id'],b=b['id']);before=city.snapshot();result=infrastructure.passage_preview(city,cmd)
        self.assertTrue(result['valid'],result);self.assertEqual(city.snapshot(),before)
        city.command(cmd);self.assertTrue(city.s['railInfrastructure']['transfers'][0]['valid'])
        passage=city.s['railInfrastructure']['passages'][0]
        self.assertGreater(passage['minutes'],0);self.assertEqual(len(city.s['railInfrastructure']['groups']),1)
        city.command(dict(type='rail_passage',id=passage['id'],enabled=False))
        self.assertFalse(city.s['railInfrastructure']['groups'])
        city.command(dict(type='undo'));self.assertTrue(city.s['railInfrastructure']['groups'])

    def test_actual_transfer_counts_boardings_separately_and_one_external_journey(self):
        city,stations,_=rail_city(third=True)
        middle=stations[1];city.command(dict(type='rail_facility',kind='turnback',platform=middle['platforms'][0]['id'],point=middle['point']))
        a=line(city,stations[:2],headway=4);b=line(city,stations[1:],headway=4)
        clock(city,475)
        city.trips=[dict(source='home',target='work',purpose='work',people=4,completed=True,transitCalls=[
            dict(line=a['id'],stop=stations[0]['id'],kind='board',minute=482,direction=0),
            dict(line=a['id'],stop=stations[1]['id'],kind='alight',minute=486,direction=0),
            dict(line=b['id'],stop=stations[1]['id'],kind='board',minute=490,direction=0),
            dict(line=b['id'],stop=stations[2]['id'],kind='alight',minute=494,direction=0)])]
        rail_runtime.advance(city,3600);totals=city.s['railRuntime']['totals']['network']
        self.assertEqual({k:totals[k] for k in ('entry','exit','board','alight','transfer')},dict(entry=4,exit=4,board=8,alight=8,transfer=4))
        self.assertEqual(city.s['railRuntime']['pendingFare'],8)

    def test_capacity_denial_is_actual_waiting_and_conserved(self):
        city,stations,_=rail_city();l=line(city,stations,formation=1,headway=20)
        clock(city,475);intent(city,l,stations,minute=492)
        template=city.trips[0];city.trips=[dict(copy.deepcopy(template),source=f'home-{i}') for i in range(200)]
        rail_runtime.advance(city,35*60)
        state=city.s['railRuntime'];counts=state['totals']['network'];view=rail_runtime.view(city)
        self.assertEqual(counts['entry'],200);self.assertEqual(counts['board'],150);self.assertEqual(view['waiting'],50)
        self.assertEqual(counts['entry'],counts.get('exit',0)+view['waiting']+view['onboard'])
        self.assertGreaterEqual(counts['denied'],50)

    def test_shared_running_trains_never_hold_same_block_and_edit_checks_occupancy(self):
        city,stations,tracks=rail_city(third=True);line(city,stations,headway=1,dwell=3);line(city,stations,headway=1,dwell=.2)
        clock(city,475)
        occupied=False
        for _ in range(120):
            rail_runtime.advance(city,10)
            state=city.s['railRuntime'];seen={}
            for train in state['trains']:
                if train['status']!='running':continue
                for resource in train['route'][train['index']]['resources']:
                    self.assertNotIn(resource,seen,f"{resource}: {train['id']} conflicts with {seen.get(resource)}")
                    seen[resource]=train['id']
            if not occupied and any(t['status']=='running' and any(e['ref'].startswith(tracks[0]+':') for e in t['route'][t['index']]['path']) for t in state['trains']):
                before=city.snapshot()
                with self.assertRaisesRegex(ValueError,'列车占用'):city.command(dict(type='delete',id=tracks[0]))
                self.assertEqual(city.snapshot(),before);occupied=True
        self.assertTrue(occupied)

    def test_background_midnight_matches_synchronous_rail_state(self):
        import time
        from city.monthly import Preparation
        city,stations,_=rail_city();l=line(city,stations,startHour=23.5,hours=2,headway=4)
        clock(city,23*60+59);intent(city,l,stations,minute=3,n=2)
        expected=City.restore(city.snapshot());simulation.advance_calendar(expected,60)
        job=Preparation(city)
        try:
            end=time.monotonic()+20
            while job.result is None and job.error is None and time.monotonic()<end:time.sleep(.01)
            self.assertIsNone(job.error);self.assertIsNotNone(job.result)
            for _ in range(6):simulation.advance_calendar(city,10,settlement=job.commit)
            self.assertEqual(city.s['railRuntime'],expected.s['railRuntime'])
            self.assertEqual(city.s['treasury'],expected.s['treasury'])
        finally:job.cancel()


class BrokenServiceEditingTests(unittest.TestCase):
    def test_failed_service_can_be_renamed_without_reopening_or_settlement(self):
        city,stations,tracks=rail_city();l=line(city,stations)
        city.command(dict(type='delete',id=tracks[0]));cash=city.s['treasury']
        city.command(dict(type='line_update',id=l['id'],name='待修复直通线',color='#334455'))
        self.assertFalse(city.s['lines'][0]['valid']);self.assertEqual(city.s['lines'][0]['name'],'待修复直通线')
        self.assertEqual(city.s['treasury'],cash)
