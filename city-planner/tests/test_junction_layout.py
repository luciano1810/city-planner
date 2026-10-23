import math
import unittest

from tests.test_signals import cross_city
from tests.test_city import road
from city.signals import LiveTraffic
from city.vehicle_paths import lane_point
from city.junction_layout import clearance


class JunctionLayoutTests(unittest.TestCase):
    def test_extra_lanes_fit_existing_half_width_and_stop_lines_advance(self):
        city = cross_city()
        for arm in city.network['junctions'][0]['approaches']:
            self.assertTrue(arm['autoLanes'])
            self.assertGreaterEqual(arm['laneWidth'], 3.25)
            self.assertAlmostEqual(arm['laneCount']*arm['laneWidth'], arm['width']/2)
            self.assertEqual(arm['stopDistance']-arm['crossingDistance'], 4)
            self.assertAlmostEqual(arm['stopDistance'], clearance(arm, city.network['junctions'][0]['approaches'])+5)
            self.assertEqual(arm['laneTaperDistance']-arm['laneFullDistance'], 24)

    def test_short_approaches_do_not_add_lanes_that_cannot_taper(self):
        city = cross_city()
        road(city, [[1040, 800], [1040, 1200]])
        junction = min(city.network['junctions'], key=lambda j:j['point'][0])
        east = next(a for a in junction['approaches'] if a['kind']=='avenue' and a['direction']==1)
        west = next(a for a in junction['approaches'] if a['kind']=='avenue' and a['direction']==-1)
        self.assertFalse(east['autoLanes'])
        self.assertEqual(east['laneCount'], 2)
        self.assertTrue(west['autoLanes'])

    def test_vehicle_paths_split_smoothly_and_queue_conservatively(self):
        city = cross_city(); live = LiveTraffic(city, 'test')
        j = city.network['junctions'][0]
        arm = next(a for a in j['approaches'] if a['kind']=='street' and a['direction']==-1)
        link = next(l for l in live.links.values() if l['b']==j['id'] and l['road']==arm['road'] and l['direction']==1)
        outer = link['length']-arm['laneTaperDistance']
        self.assertEqual(lane_point(link, outer, 0, arm), lane_point(link, outer, 1, arm))
        inner = link['length']-arm['stopDistance']
        p, _ = lane_point(link, inner, 0, arm); q, _ = lane_point(link, inner, 1, arm)
        self.assertAlmostEqual(math.dist(p, q), 3.5)
        self.assertEqual(live.queue_lane(link['id'], 0), live.queue_lane(link['id'], 1))
        for lane in [0, 1]:
            points = [lane_point(link, outer+i*.5, lane, arm)[0] for i in range(49)]
            self.assertTrue(all(math.dist(a,b)<.55 for a,b in zip(points,points[1:])))

    def test_almost_opposing_arms_do_not_push_stop_line_far_upstream(self):
        arms = [dict(width=14, tangent=[-1,0]), dict(width=14, tangent=[.997, .077]), dict(width=14, tangent=[0,1])]
        self.assertLess(clearance(arms[0], arms), 10)

    def test_near_parallel_crossing_keeps_stop_lines_outside_shared_surface(self):
        angle = math.radians(2)
        arms = [dict(width=14, tangent=[1, 0]),
                dict(width=14, tangent=[math.cos(angle), math.sin(angle)])]
        self.assertGreater(clearance(arms[0], arms), 390)
