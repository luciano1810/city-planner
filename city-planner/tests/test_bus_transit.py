"""Atomic roadside route creation, road identity, depot and saved services."""
import unittest
from shapely.geometry import LineString, Point
from tests.test_city import City, flat_world, road
from city import bus_transit, special_buildings


def bus_city(depot=True):
    city=City(flat_world())
    city.s['settings'].update(autoGrow=False, growth=0)
    rid=road(city, [[500,1000],[1800,1000],[1800,1800]])
    if depot:
        city.command(dict(type='special_building',kind='bus_depot',point=[700,920]))
    return city,rid


def stop(rid, point, side=1):
    return dict(road=rid,anchor=point,side=side)


class BusTransitTests(unittest.TestCase):
    def test_requires_connected_and_reachable_depot(self):
        c,r=bus_city(False);entries=[stop(r,[800,1000]),stop(r,[1300,1000])]
        before=c.snapshot()
        with self.assertRaisesRegex(ValueError,'总站'):
            c.command(dict(type='bus_line',stops=entries))
        self.assertEqual(before,c.snapshot())
        c.command(dict(type='special_building',kind='bus_depot',point=[3000,3000]))
        self.assertFalse(c.s['facilities'][-1]['connected'])
        self.assertFalse(bus_transit.preview(c,dict(stops=entries))['valid'])
        road(c,[[2800,3080],[3400,3080]])
        self.assertTrue(c.s['facilities'][-1]['connected'])
        self.assertIn('往返',bus_transit.preview(c,dict(stops=entries))['reason'])

    def test_preview_order_curved_path_and_atomic_creation(self):
        c,r=bus_city();entries=[stop(r,[875.3,1000]),stop(r,[1560.2,1000]),stop(r,[1800,1570.4])]
        before=c.snapshot();result=bus_transit.preview(c,dict(stops=entries))
        self.assertTrue(result['valid'],result);self.assertEqual(before,c.snapshot())
        self.assertEqual(len(result['paths']),4)
        shape=LineString(c.s['roads'][0]['points'])
        self.assertTrue(all(5.9<=shape.distance(Point(p))<=7.9 for path in result['paths'] for p in path['points']))
        self.assertTrue(all(p[1]>1000 for p in result['paths'][0]['points']))
        self.assertTrue(all(p[1]<1000 for p in result['paths'][-1]['points']))
        self.assertEqual(result['paths'][0]['points'][0],result['stops'][0]['point'])
        self.assertGreater(result['stops'][0]['point'][1],1000)
        c.command(dict(type='bus_line',stops=entries,name='滨河公交',headway=8))
        line=c.s['lines'][0];self.assertTrue(line['valid']);self.assertTrue(line['depot']);self.assertGreater(line['fleet'],0);self.assertGreater(line['operatingCost'],0)
        self.assertEqual([p['points'] for p in line['paths']],[p['points'] for p in result['paths']])
        self.assertEqual(line['stops'],[s['id'] for s in c.s['stops']]);self.assertEqual(c.s['capitalAccounts']['车站建设'],75000)
        self.assertAlmostEqual(c.s['stops'][0]['anchor'][0],875.3)
        self.assertAlmostEqual(c.s['stops'][0]['point'][1],1007.8)
        c.command(dict(type='undo'));self.assertEqual(c.s['lines'],[]);self.assertEqual(c.s['stops'],[])
        c.command(dict(type='redo'));self.assertEqual(c.s['lines'][0]['stops'],line['stops'])
        restored=City.restore(c.snapshot());self.assertTrue(restored.s['lines'][0]['valid']);self.assertEqual(restored.s['stops'][0]['point'],c.s['stops'][0]['point'])

    def test_both_curbs_and_reuse_existing_stops(self):
        c,r=bus_city()
        c.command(dict(type='bus_line',stops=[stop(r,[1300,1000],-1),stop(r,[800,1000],-1)]))
        self.assertTrue(all(s['point'][1]<1000 for s in c.s['stops']))
        self.assertTrue(all(p[1]<1000 for p in c.s['lines'][0]['paths'][0]['points']))
        self.assertTrue(all(p[1]>1000 for p in c.s['lines'][0]['paths'][1]['points']))
        before=c.s['capitalAccounts']['车站建设']
        c.command(dict(type='bus_line',stops=[stop(r,[1300,1000],-1),stop(r,[800,1000],-1)]))
        self.assertEqual(len(c.s['stops']),2);self.assertEqual(c.s['capitalAccounts']['车站建设'],before)
        self.assertEqual(c.s['lines'][0]['stops'],c.s['lines'][1]['stops'])

    def test_failure_leaves_no_stops_no_cost_and_no_line(self):
        c,r=bus_city();other=road(c,[[2600,2600],[3500,2600]])
        before=c.snapshot()
        for entries in [[stop(r,[800,1000])],[stop(r,[800,1000])]*2,[stop(r,[800,1000]),stop(other,[3000,2600])],[stop(r,[800,1000]),stop(r,[1300,1300])]]:
            with self.assertRaises(ValueError):c.command(dict(type='bus_line',stops=entries))
            self.assertEqual(before,c.snapshot())
        c.s['settings']['budget']=True;c.s['treasury']=1000;before=c.snapshot()
        with self.assertRaisesRegex(ValueError,'预算|资金'):
            c.command(dict(type='bus_line',stops=[stop(r,[800,1000]),stop(r,[1300,1000])]))
        self.assertEqual(before,c.snapshot())

    def test_oneway_street_requires_return_network(self):
        c=City(flat_world());r=road(c,[[500,1000],[1800,1000]],oneway=True)
        c.command(dict(type='special_building',kind='bus_depot',point=[700,920]))
        # Complete an actual return loop so vehicles can reach their depot.
        road(c,[[1800,1000],[1800,1600],[500,1600],[500,1000]],oneway=True)
        entries=[stop(r,[800,1000]),stop(r,[1300,1000])]
        self.assertFalse(bus_transit.preview(c,dict(stops=entries))['valid'])
        c.command(dict(type='bus_line',stops=entries,oneway=True));self.assertTrue(c.s['lines'][0]['valid']);self.assertEqual(len(c.s['lines'][0]['paths']),1)
        self.assertFalse(bus_transit.preview(c,dict(stops=[stop(r,[1300,1000],-1),stop(r,[800,1000],-1)],oneway=True))['valid'])

    def test_stops_remain_on_selected_road_at_crossings_and_disconnect(self):
        c,r=bus_city();cross=road(c,[[1200,500],[1200,1500]],level=1)
        c.command(dict(type='bus_line',stops=[stop(r,[1200,1000]),stop(r,[1500,1000])]))
        self.assertTrue(all(s['road']==r for s in c.s['stops']))
        c.command(dict(type='delete',id=r));self.assertFalse(c.s['lines'][0]['valid']);self.assertTrue(all(not s['connected'] for s in c.s['stops']))
        self.assertEqual(c.s['roads'][0]['id'],cross)

    def test_depot_demolition_suspends_service_and_undo_restores(self):
        c,r=bus_city();c.command(dict(type='bus_line',stops=[stop(r,[800,1000]),stop(r,[1300,1000])]))
        c.command(dict(type='delete',id=c.s['facilities'][0]['id']));self.assertFalse(c.s['lines'][0]['valid']);self.assertIn('总站',c.s['lines'][0]['reason'])
        c.command(dict(type='undo'));self.assertTrue(c.s['lines'][0]['valid'])

    def test_management_reorder_pause_resume_and_legacy_lines(self):
        c,r=bus_city();c.command(dict(type='bus_line',stops=[stop(r,[800,1000]),stop(r,[1300,1000])]))
        line=c.s['lines'][0];lid=line['id']
        c.command(dict(type='line_update',id=lid,headway=5,capacity=90,name='社区公交',color='#367e73'))
        c.command(dict(type='bus_line',id=lid,name='新社区公交',headway=7,capacity=85,stops=[stop(r,[1000,1000]),stop(r,[1600,1000])]))
        self.assertEqual(c.s['lines'][0]['headway'],7);self.assertEqual(c.s['lines'][0]['name'],'新社区公交');self.assertEqual(c.s['lines'][0]['capacity'],85)
        self.assertAlmostEqual(c.s['stops'][-2]['anchor'][0],1000)
        c.command(dict(type='line_update',id=lid,enabled=False));self.assertEqual(c.s['lines'][0]['fleet'],0)
        c.command(dict(type='line_update',id=lid,enabled=True));self.assertTrue(c.s['lines'][0]['valid'])
        legacy,_=bus_city(False)
        for p in [[800,1000],[1300,1000]]:legacy.command(dict(type='stop',mode='bus',point=p))
        legacy.command(dict(type='line',mode='bus',stops=[s['id'] for s in legacy.s['stops']]))
        self.assertTrue(City.restore(legacy.snapshot()).s['lines'][0]['valid'])

    def test_depot_geometry_budget_collision_and_pure_preview(self):
        c,r=bus_city(False);cmd=dict(kind='bus_depot',point=[700,920],rotation=15,size='compact')
        before=c.snapshot();result=special_buildings.preview(c,cmd);self.assertTrue(result['valid'],result);self.assertEqual(before,c.snapshot())
        c.command(dict(type='special_building',**cmd));f=c.s['facilities'][0];self.assertTrue(f['connected']);self.assertGreater(f['maintenance'],0)
        self.assertFalse(special_buildings.preview(c,cmd)['valid']);self.assertFalse(special_buildings.preview(c,dict(kind='bus_depot',point=[700,1000]))['valid'])
        restored=City.restore(c.snapshot());self.assertEqual(restored.s['facilities'][0]['kind'],'bus_depot')
