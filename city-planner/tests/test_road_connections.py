"""Connectivity regressions for snapped curves, levels and junction furniture."""
import json
import unittest

from shapely.geometry import LineString, Point

from tests.test_city import flat_world, road
from city.engine import City
from city.geometry import Terrain, make_network
from city.routing import shortest_paths


def link(key, points, level=0, kind='street', oneway=False):
    return dict(id=key, points=points, level=level, kind=kind, oneway=oneway)


class RoadConnectionTests(unittest.TestCase):
    def setUp(self):
        self.terrain = Terrain(flat_world())

    def shared(self, network, first, second):
        def nodes(rid):
            return {e[k] for e in network['edges'] if e['road'] == rid for k in ('a', 'b')}
        return nodes(first) & nodes(second)

    def test_snapped_curved_t_junction_connects_in_preview_and_drive_graph(self):
        city = City(flat_world())
        city.command(dict(type='road', points=[[500,700],[1000,1100],[1700,900]], shape='curve'))
        cmd = dict(type='road', points=[[755,1800],[913.5,1078.65]])
        before = city.snapshot()
        preview = city.preview_road(cmd)
        self.assertTrue(preview['valid'])
        self.assertEqual(preview['connections'], 1)
        self.assertEqual(before, city.snapshot())
        city.command(cmd)
        first, second = city.s['roads']
        # The stored endpoint is an interpolated coordinate, not an integer grid point.
        self.assertLess(LineString(first['points']).distance(Point(second['points'][-1])), 1e-8)
        self.assertEqual(len(self.shared(city.network, first['id'], second['id'])), 1)
        start = next(e['a'] for e in city.network['edges'] if e['road'] == second['id'])
        target = next(e['a'] for e in city.network['edges'] if e['road'] == first['id'])
        self.assertIn(target, shortest_paths(city.graphs['car'], start)[0])
        restored = City.restore(json.loads(json.dumps(city.snapshot())))
        self.assertEqual(city.network['junctions'], restored.network['junctions'])

    def test_endpoint_tolerance_repairs_old_contacts_but_not_nearby_roads(self):
        base = link('a', [[500,1000],[1500,1000]])
        for gap, connected in ((.000000001, True), (.03, True), (.08, False), (4, False)):
            with self.subTest(gap=gap):
                branch = link('b', [[1000,1500],[1000,1000+gap]])
                network = make_network([base, branch], [], self.terrain)
                self.assertEqual(bool(self.shared(network, 'a', 'b')), connected)
                for e in network['edges']:
                    self.assertEqual(e['points'][0], network['nodes'][e['a']])
                    self.assertEqual(e['points'][-1], network['nodes'][e['b']])
        parallel = link('c', [[700,1000.08],[1300,1000.08]])
        self.assertFalse(self.shared(make_network([base, parallel], [], self.terrain), 'a', 'c'))

    def test_crossings_are_order_independent_and_layers_remain_separate(self):
        a = link('a', [[500,1000],[1500,1000]])
        b = link('b', [[1000,500],[1000,1500]])
        for roads in ([a,b], [b,a]):
            network = make_network(roads, [], self.terrain)
            self.assertEqual(len(self.shared(network, 'a', 'b')), 1)
            self.assertEqual(len(network['junctions']), 1)
            self.assertEqual(len(network['junctions'][0]['approaches']), 4)
            self.assertEqual(network['junctions'][0]['control'], 'signals')
        bridge = dict(b, level=1)
        network = make_network([a, bridge], [], self.terrain)
        self.assertFalse(self.shared(network, 'a', 'b'))
        self.assertEqual(network['junctions'], [])
        ramp = dict(bridge, points=[[1000,1000],[1000,1500]])
        network = make_network([a, ramp], [], self.terrain)
        self.assertTrue(self.shared(network, 'a', 'b'))
        self.assertFalse(network['junctions'][0]['crossings'])
        self.assertEqual(network['junctions'][0]['control'], 'priority')

    def test_frontages_are_not_junctions_and_oneway_approaches_remain_directed(self):
        a = link('a', [[500,1000],[1500,1000]], oneway=True)
        parcels = [dict(road='a', frontage=[x,1000]) for x in (600,800,1100)]
        self.assertEqual(make_network([a], [], self.terrain, parcels)['junctions'], [])
        b = link('b', [[1000,500],[1000,1500]])
        junction = make_network([a,b], [], self.terrain, parcels)['junctions'][0]
        west, east = sorted([arm for arm in junction['approaches'] if arm['road']=='a'], key=lambda arm:arm['direction'])
        self.assertTrue(west['incoming']); self.assertFalse(west['outgoing'])
        self.assertFalse(east['incoming']); self.assertTrue(east['outgoing'])
        highway = dict(a, kind='highway')
        self.assertFalse(make_network([highway,b], [], self.terrain)['junctions'][0]['crossings'])

    def test_frontage_centimetres_from_crossing_does_not_sever_the_road(self):
        roads = [link('a', [[500,1000],[1500,1000]]), link('b', [[1000,500],[1000,1500]])]
        network = make_network(roads, [], self.terrain, [dict(road='a', frontage=[999.97,1000])])
        graph = {}
        for edge in network['edges']:
            for a,b in ((edge['a'],edge['b']), (edge['b'],edge['a'])):
                graph.setdefault(a, []).append(dict(to=b, time=edge['time']))
        reachable = shortest_paths(graph, 'road:0:500.0:1000.0')[0]
        self.assertIn('road:0:1500.0:1000.0', reachable)
        self.assertIn('road:0:1000.0:500.0', reachable)
        self.assertEqual(len(network['junctions']), 1)

    def test_edit_delete_and_undo_rebuild_junctions(self):
        city = City(flat_world())
        road(city, [[500,1000],[1500,1000]])
        rid = road(city, [[1000,500],[1000,1500]])
        self.assertEqual(len(city.network['junctions']), 1)
        city.command(dict(type='road_edit', id=rid, points=[[1800,500],[1800,1500]]))
        self.assertEqual(city.network['junctions'], [])
        city.command(dict(type='undo'))
        self.assertEqual(len(city.network['junctions']), 1)
        city.command(dict(type='delete', id=rid))
        self.assertEqual(city.network['junctions'], [])

    def test_new_main_road_completes_nearby_lane_entrance_and_preview_matches(self):
        city = City(flat_world())
        lane = road(city, [[1000, 1200], [1000, 1013]], kind='lane')
        before = city.snapshot()
        cmd = dict(type='road', points=[[700, 1000], [1300, 1000]])
        preview = city.preview_road(cmd)
        self.assertTrue(preview['valid'])
        self.assertEqual(preview['connections'], 1)
        self.assertEqual(city.snapshot(), before)
        city.command(cmd)
        self.assertEqual(city.s['roads'][0]['points'][-1], [1000, 1000])
        self.assertAlmostEqual(city.s['roads'][0]['length'], 200)
        self.assertTrue(self.shared(city.network, lane, city.s['roads'][-1]['id']))
        self.assertEqual(len(city.network['junctions'][0]['approaches']), 3)
        city.command(dict(type='undo'))
        self.assertEqual(city.s['roads'][0]['points'][-1], [1000, 1013])

    def test_lane_entrance_repair_is_bounded_directional_and_ground_only(self):
        from city.lane_connections import connect_lane_entrances
        from unittest.mock import patch
        for end, level, blocked in (([1000,1018.1],0,False), ([1000,1013],1,False),
                                    ([1010,1100],0,False), ([1000,1013],0,True)):
            with self.subTest(end=end, level=level, blocked=blocked):
                city = City(flat_world())
                lane = link('lane', [[1000,1200],end], kind='lane')
                # The third case is parallel to the nearby main road.
                points = [[1000,900],[1000,1300]] if end==[1010,1100] else [[700,1000],[1300,1000]]
                city.s['roads'] = [lane, link('main', points, level=level)]
                before = json.loads(json.dumps(lane))
                with patch.object(city.terrain, 'valid_link', side_effect=ValueError('blocked') if blocked else None):
                    self.assertFalse(connect_lane_entrances(city))
                self.assertEqual(lane, before)

    def test_existing_save_lane_gap_repairs_once_and_preserves_buildings(self):
        from city.lane_connections import connect_lane_entrances
        city = City(flat_world())
        city.s['roads'] = [link('lane', [[1000,1200],[1000,1013]], kind='lane'),
                           link('main', [[700,1000],[1300,1000]])]
        footprint = [[997,1003],[1003,1003],[1003,1009],[997,1009]]
        city.s['parcels'] = [dict(use='residential',building=dict(footprint=footprint))]
        self.assertFalse(connect_lane_entrances(city))
        city.s['parcels'] = []
        self.assertTrue(connect_lane_entrances(city))
        self.assertFalse(connect_lane_entrances(city))


if __name__ == '__main__':
    unittest.main()
