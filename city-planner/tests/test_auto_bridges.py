import json
import unittest
from shapely.geometry import LineString
from tests.test_city import flat_world
from city.engine import City
from city.auto_bridges import segments
from city.routing import shortest_paths


class AutoBridgeTests(unittest.TestCase):
    def test_preview_build_restore_and_connected_route(self):
        city = City(flat_world(water=True))
        cmd = dict(type='road', points=[[1200,1000],[2800,1000]])
        before = city.snapshot()
        preview = city.preview_road(cmd)
        self.assertTrue(preview['valid'], preview)
        self.assertEqual(before, city.snapshot())
        self.assertEqual([r['level'] for r in preview['roads']], [0,1,0])
        city.command(cmd)
        roads = city.s['roads']
        self.assertEqual([r['points'] for r in roads], [r['points'] for r in preview['roads']])
        self.assertEqual(len({r['name'] for r in roads}), 1)
        self.assertEqual(sum(r['constructionCost'] for r in roads), preview['road']['constructionCost'])
        edges = city.network['edges']
        first = next(e['a'] for e in edges if e['road'] == roads[0]['id'])
        last = next(e['b'] for e in edges if e['road'] == roads[-1]['id'])
        self.assertIn(last, shortest_paths(city.graphs['car'], first)[0])
        restored = City.restore(json.loads(json.dumps(city.snapshot())))
        self.assertEqual([r['name'] for r in restored.s['roads']], [r['name'] for r in roads])
        self.assertEqual([r['level'] for r in restored.s['roads']], [0,1,0])

    def test_multiple_narrow_rivers_and_dry_road(self):
        city = City(flat_world())
        line = LineString([[500,1000],[3500,1000]])
        self.assertEqual([level for level, _ in segments(city.terrain, line)], [0])
        world = flat_world()
        world['channels'] = [dict(points=[[x,0],[x,1]], widths=[1]) for x in (.3,.7)]
        city = City(world)
        city.add_road(dict(points=list(map(list,line.coords))))
        self.assertEqual([r['level'] for r in city.s['roads']], [0,1,0,1,0])
        self.assertEqual(len({r['name'] for r in city.s['roads']}), 1)

    def test_explicit_tunnel_and_bridge_keep_level(self):
        for level in (-1,1):
            city = City(flat_world(water=True))
            city.add_road(dict(points=[[1200,1000],[2800,1000]], level=level))
            self.assertEqual([r['level'] for r in city.s['roads']], [level])
