"""Road naming and junction edits persist and affect actual signal/lane use."""
import copy
import json
import unittest
from tests.test_city import road
from tests.test_signals import cross_city
from city.engine import City
from city.signals import LiveTraffic, approach_key
from city.vehicle_paths import lane_for


class JunctionSettingsTests(unittest.TestCase):
    def test_road_name_is_custom_persistent_and_undoable_without_cost(self):
        city=cross_city();rid=city.s['roads'][0]['id'];old=city.view()['roads'][0]['name']
        cost=city.s['constructionCost'];points=copy.deepcopy(city.s['roads'][0]['points'])
        city.command(dict(type='road_rename',id=rid,name='  山海大道  '))
        self.assertEqual(city.view()['roads'][0]['name'],'山海大道')
        self.assertEqual(city.s['roads'][0]['nameSource'],'custom')
        self.assertEqual(city.s['constructionCost'],cost)
        self.assertEqual(city.s['roads'][0]['points'],points)
        restored=City.restore(json.loads(json.dumps(city.snapshot())))
        self.assertEqual(restored.view()['roads'][0]['name'],'山海大道')
        city.command(dict(type='undo'));self.assertEqual(city.view()['roads'][0]['name'],old)
        city.command(dict(type='redo'));self.assertEqual(city.view()['roads'][0]['name'],'山海大道')
        for name in ['', '   ', '路'*61, None]:
            with self.assertRaises(ValueError):city.command(dict(type='road_rename',id=rid,name=name))
        self.assertEqual(city.view()['roads'][0]['name'],'山海大道')

    def test_timing_only_changes_selected_junction_and_survives_rebuild_restore_undo(self):
        city=cross_city();road(city,[[1100,800],[1100,1200]])
        junction=city.network['junctions'][0];jid=junction['id'];policy=copy.deepcopy(city.s['policy'])
        original={j['id']:j['signal']['cycle'] for j in city.network['junctions']}
        city.command(dict(type='junction_update',id=jid,timing=dict(signalGreenSeconds=27,signalYellowSeconds=4,signalClearanceSeconds=6)))
        self.assertEqual(city.s['policy'],policy)
        for j in city.network['junctions']:
            if j['id']==jid:self.assertTrue(all(s['green']==27 for s in j['signal']['stages']))
            else:self.assertEqual(j['signal']['cycle'],original[j['id']])
        restored=City.restore(json.loads(json.dumps(city.snapshot())))
        self.assertEqual(restored.s['junctionSettings'],city.s['junctionSettings'])
        restored.rebuild()
        self.assertEqual(next(j for j in restored.network['junctions'] if j['id']==jid)['timing']['signalGreenSeconds'],27)
        city.command(dict(type='undo'))
        self.assertEqual(next(j for j in city.network['junctions'] if j['id']==jid)['signal']['cycle'],original[jid])
        city.command(dict(type='redo'))
        city.command(dict(type='junction_update',id=jid,reset=True))
        self.assertEqual(next(j for j in city.network['junctions'] if j['id']==jid)['signal']['cycle'],original[jid])

    def test_arrows_change_live_vehicle_lane_and_persist(self):
        city=cross_city();j=city.network['junctions'][0]
        arm=next(a for a in j['approaches'] if a['kind']=='avenue' and a['direction']==-1)
        rows=[['right'],['left','straight'],['straight']]
        city.command(dict(type='junction_update',id=j['id'],laneTurns={approach_key(arm):rows}))
        live=LiveTraffic(city,'test');j=city.network['junctions'][0]
        incoming=next(link for link in live.links.values() if link['b']==j['id'] and link['road']==arm['road'] and link['direction']==1)
        straight=next(link for link in live.links.values() if link['a']==j['id'] and link['road']==arm['road'] and link['direction']==1)
        route=[incoming['id'],straight['id']]
        self.assertEqual(lane_for(live.links,route,0,live.all_junctions),1)
        self.assertEqual(live.path({'route':route}).lanes[0],1)
        restored=City.restore(json.loads(json.dumps(city.snapshot())))
        saved=next(a for a in restored.network['junctions'][0]['approaches'] if approach_key(a)==approach_key(arm))
        self.assertEqual(saved['laneTurns'],rows)
        city.command(dict(type='junction_update',id=j['id'],reset=True))
        self.assertEqual(next(a for a in city.network['junctions'][0]['approaches'] if approach_key(a)==approach_key(arm))['laneTurns'],[['left'],['straight'],['straight','right']])

    def test_invalid_settings_are_atomic_and_stale_layout_uses_new_geometry(self):
        city=cross_city();j=city.network['junctions'][0];arm=next(a for a in j['approaches'] if a['kind']=='avenue')
        before=copy.deepcopy(city.s)
        for values in [dict(timing={'signalGreenSeconds':1}),dict(timing={'signalGreenSeconds':True}),dict(timing={'bad':12}),dict(laneTurns={'missing':[['straight']]}),dict(laneTurns={approach_key(arm):[['left'],[]]}),dict(laneTurns={approach_key(arm):[['left'],['straight']]})]:
            with self.assertRaises(ValueError):city.command(dict(type='junction_update',id=j['id'],**values))
            self.assertEqual(city.s,before)
        city.command(dict(type='junction_update',id=j['id'],laneTurns={approach_key(arm):[['right'],['left','straight'],['straight']]}))
        # A narrower street keeps only the two lanes that physically fit.
        city.s['roads'][0]['kind']='street';city.rebuild()
        edited=next(a for a in city.network['junctions'][0]['approaches'] if approach_key(a)==approach_key(arm))
        self.assertEqual(edited['laneTurns'],[['left'],['straight','right']])

    def test_one_way_and_t_junctions_only_offer_reachable_exits(self):
        city=cross_city();city.s['roads'][0]['oneway']=True;city.rebuild()
        j=city.network['junctions'][0]
        for a in j['approaches']:
            if a['road']==city.s['roads'][0]['id'] and a['direction']==1:self.assertNotIn('laneTurns',a)
            if a['road']==city.s['roads'][0]['id'] and a['direction']==-1:self.assertEqual(len(a['laneTurns']),5)
        city.s['roads'][1]['points']=[[1000,1000],[1000,1200]];city.rebuild()
        j=city.network['junctions'][0]
        arm=next(a for a in j['approaches'] if a['road']==city.s['roads'][1]['id'])
        self.assertNotIn('straight',arm['availableTurns'])

    def test_multilane_assignments_remain_independent_after_save_restore(self):
        for kind, oneway, count in [('avenue',False,3),('avenue',True,5),('motorway',False,3),('motorway',True,6)]:
            with self.subTest(kind=kind,oneway=oneway):
                city=cross_city();city.s['roads'][0].update(kind=kind,oneway=oneway);city.rebuild()
                junction=city.network['junctions'][0]
                arm=next(a for a in junction['approaches'] if a['road']==city.s['roads'][0]['id'] and a['incoming'])
                self.assertEqual(len(arm['laneTurns']),count)
                rows=[['left']]+[['straight'] for _ in range(count-2)]+[['straight','right']]
                others={approach_key(a):copy.deepcopy(a['laneTurns']) for a in junction['approaches'] if 'laneTurns' in a and a is not arm}
                city.command(dict(type='junction_update',id=junction['id'],laneTurns={approach_key(arm):rows}))
                restored=City.restore(json.loads(json.dumps(city.snapshot())))
                saved=restored.network['junctions'][0]
                for approach in saved['approaches']:
                    if 'laneTurns' not in approach:continue
                    expected=rows if approach_key(approach)==approach_key(arm) else others[approach_key(approach)]
                    self.assertEqual(approach['laneTurns'],expected)
                live=LiveTraffic(restored,'test')
                inbound=next(link for link in live.links.values() if link['b']==saved['id'] and link['road']==arm['road'])
                outbound=next(link for link in live.links.values() if link['a']==saved['id'] and link['road']==arm['road'] and link['direction']==inbound['direction'])
                self.assertIn(lane_for(live.links,[inbound['id'],outbound['id']],0,live.all_junctions),range(1,count))
