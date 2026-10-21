"""User choices at cross-level magnetic points control actual ramp topology."""
import copy
import json
import math
import unittest
from shapely.geometry import LineString
from city.engine import City
from tests.test_city import flat_world


class ParallelRampTests(unittest.TestCase):
    def city(self):
        c = City(flat_world())
        c.command(dict(type='road', points=[[1500,2000],[2600,2000]], snap=False))
        return c

    def shared(self, city):
        roads = city.s['roads']
        nodes = lambda rid: {e[k] for e in city.network['edges'] if e['road']==rid for k in ('a','b')}
        return nodes(roads[0]['id']) & nodes(roads[1]['id'])

    def test_high_and_underground_parallel_choices_keep_layers_independent(self):
        for level in (-1,1):
            c=self.city()
            c.command(dict(type='road',level=level,points=[[1800,2000],[2300,2000]],snap=False,connections=[]))
            self.assertFalse(self.shared(c))
            self.assertEqual(c.s['roads'][-1]['points'],[[1800,2000],[2300,2000]])

    def test_branch_preview_and_build_preserve_ground_and_have_tangent_forks(self):
        for level in (-1,1):
            for reverse in (False,True):
                for offset in (0,35,-35):
                    with self.subTest(level=level,reverse=reverse,offset=offset):
                        c=self.city();ground=copy.deepcopy(c.s['roads'][0])
                        points=[[1800,2000+offset],[2300,2000]]
                        if reverse:points.reverse()
                        cmd=dict(type='road',level=level,points=points,snap=False,connections=[dict(road=ground['id'],point=[2300,2000],junction='branch')])
                        preview=c.preview_road(cmd)
                        self.assertTrue(preview['valid'],preview)
                        self.assertEqual(preview['connections'],1)
                        c.command(cmd);r=c.s['roads'][-1]
                        self.assertEqual(c.s['roads'][0],ground)
                        self.assertEqual(preview['road']['points'],r['points'])
                        self.assertGreater(len(r['points']),12)
                        self.assertTrue(LineString(r['points']).is_simple)
                        route=list(reversed(r['points'])) if reverse else r['points']
                        self.assertEqual(route[-1],[2300,2000])
                        dx,dy=route[-1][0]-route[-2][0],route[-1][1]-route[-2][1]
                        self.assertLess(abs(math.atan2(dy,dx)),.08)
                        self.assertGreater(max(abs(p[1]-2000) for p in route),10)
                        self.assertTrue(self.shared(c))
                        restored=City.restore(json.loads(json.dumps(c.snapshot())))
                        self.assertEqual(restored.s['roads'][-1]['connections'],r['connections'])
                        self.assertTrue(self.shared(restored))

    def test_perpendicular_and_terminal_connections_do_not_detour(self):
        for points,point in (([[2100,2200],[2100,2000]],[2100,2000]),([[2600,2000],[2800,2000]],[2600,2000])):
            c=self.city();preview=c.preview_road(dict(type='road',level=1,points=points,snap=False,connections=[dict(road=c.s['roads'][0]['id'],point=point,junction='branch')]))
            self.assertTrue(preview['valid']);self.assertEqual(preview['road']['points'],points)

    def test_short_parallel_entry_is_rejected_without_changing_state(self):
        c=self.city();before=c.snapshot()
        p=c.preview_road(dict(type='road',level=-1,points=[[2100,2005],[2140,2000]],snap=False,connections=[dict(road=c.s['roads'][0]['id'],point=[2140,2000],junction='branch')]))
        self.assertFalse(p['valid']);self.assertIn('60 米',p['reason']);self.assertEqual(c.snapshot(),before)
