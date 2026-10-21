"""Road incidence must survive layer contacts, loops and repeated crossings."""
import itertools
import unittest

from tests.test_city import flat_world
from tests.test_road_connections import link
from city.geometry import Terrain, make_network
from city.parameters import ROAD_KINDS


class NetworkIntersectionTests(unittest.TestCase):
    def shared(self, network, first, second):
        def nodes(rid):
            return {e[k] for e in network['edges'] if e['road'] == rid for k in ('a', 'b')}
        return nodes(first) & nodes(second)

    def setUp(self):
        self.terrain = Terrain(flat_world())

    def test_explicit_magnetic_coordinates_are_not_resnapped(self):
        from city.engine import City
        for kind in ('street','lane'):
            with self.subTest(kind=kind):
                city = City(flat_world())
                city.command(dict(type='road', points=[[500,1000],[1500,1000]]))
                cmd = dict(type='road', kind=kind, points=[[1000,1500],[1000,1010]], snap=False)
                preview = city.preview_road(cmd)
                self.assertTrue(preview['valid'])
                self.assertEqual(preview['road']['points'], cmd['points'])
                city.command(cmd)
                self.assertEqual(city.s['roads'][-1]['points'], cmd['points'])

    def test_new_cross_layer_endpoints_require_explicit_magnetic_target(self):
        ground = dict(link('g', [[500,1000],[1500,1000]]), connections=[])
        bridge = dict(link('b', [[1000,1000],[1000,1500]], level=1), connections=[])
        for roads in ([ground,bridge], [bridge,ground]):
            self.assertFalse(self.shared(make_network(roads,[],self.terrain),'g','b'))
        bridge['connections'] = [dict(road='g',point=[1000,1000])]
        for roads in ([ground,bridge], [bridge,ground]):
            self.assertTrue(self.shared(make_network(roads,[],self.terrain),'g','b'))
        bridge['points'] = [[1000,900],[1000,1500]]
        self.assertFalse(self.shared(make_network([ground,bridge],[],self.terrain),'g','b'))

    def test_magnetic_bridge_connection_survives_save_and_edit(self):
        import json
        from city.engine import City
        city = City(flat_world())
        city.command(dict(type='road',points=[[500,1000],[1500,1000]],snap=False))
        ground=city.s['roads'][0]['id']
        cmd=dict(type='road',level=1,points=[[1000,1000],[1000,1500]],snap=False,
                 connections=[dict(road=ground,point=[1000,1000])])
        self.assertEqual(city.preview_road(cmd)['connections'],1)
        city.command(cmd)
        bridge=city.s['roads'][-1]['id']
        restored=City.restore(json.loads(json.dumps(city.snapshot())))
        self.assertTrue(self.shared(restored.network,ground,bridge))
        restored.command(dict(type='road_edit',id=bridge,points=[[1100,1000],[1100,1500]],snap=False,connections=[]))
        self.assertFalse(self.shared(restored.network,ground,bridge))

    def test_every_road_kind_crosses_every_other_kind(self):
        for a, b, level in itertools.product(sorted(ROAD_KINDS), sorted(ROAD_KINDS), (-1,0,1)):
            with self.subTest(a=a, b=b, level=level):
                network = make_network([link('a', [[500,1000],[1500,1000]], kind=a, level=level),
                                        link('b', [[1000,500],[1000,1500]], kind=b, level=level)], [], self.terrain)
                self.assertEqual(len(self.shared(network, 'a', 'b')), 1)
                self.assertEqual(len(network['edges']), 4)

    def test_tolerant_ramp_contact_uses_one_node_in_both_orders(self):
        a = link('a', [[500,1000],[1500,1000]])
        b = link('b', [[1000,1000.03],[1000,1500]], level=1)
        for roads in ([a,b], [b,a]):
            network = make_network(roads, [], self.terrain)
            self.assertEqual(len(self.shared(network, 'a', 'b')), 1)
            self.assertEqual(len(network['junctions']), 1)

    def test_different_elevated_layers_join_at_endpoint(self):
        a = link('a', [[500,1000],[1500,1000]], level=1)
        b = link('b', [[1000,1000],[1000,1500]], level=-1)
        network = make_network([a,b], [], self.terrain)
        self.assertEqual(len(self.shared(network, 'a', 'b')), 1)

    def test_closed_road_keeps_length_and_both_junction_arms(self):
        loop = link('a', [[1000,1000],[1400,1000],[1400,1400],[1000,1400],[1000,1000]])
        branch = link('b', [[500,1000],[1000,1000]])
        for level in (-1,0,1):
            with self.subTest(level=level):
                network = make_network([dict(loop, level=level),dict(branch, level=level)], [], self.terrain)
                self.assertAlmostEqual(sum(e['length'] for e in network['edges'] if e['road']=='a'), 1600)
                self.assertEqual(len(network['junctions']), 1)
                self.assertEqual(len(network['junctions'][0]['approaches']), 3)

    def test_multiple_crossings_and_multiway_node(self):
        roads = [link('a', [[500,1000],[1500,1000]]),
                 link('b', [[700,500],[700,1500],[1300,1500],[1300,500]]),
                 link('c', [[500,800],[900,1200]])]
        for order in itertools.permutations(roads):
            network = make_network(list(order), [], self.terrain)
            self.assertEqual(len(self.shared(network, 'a', 'b')), 2)
            self.assertTrue(self.shared(network, 'a', 'b') & self.shared(network, 'a', 'c'))


if __name__ == '__main__':
    unittest.main()
