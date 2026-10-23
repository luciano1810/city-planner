"""Road construction uses longitudinal grade, including local uphill legs."""
import unittest
import math

import numpy as np
from shapely.geometry import LineString, Point, box

from tests.test_city import flat_world
from height_format import encode_heights
from city.engine import City
from city.geometry import Terrain, RoadConflict, curve_points
from city.road_alignment import route_around_grade


def hillside(x_grade=1.2, y_grade=0):
    world = flat_world()
    x = np.linspace(0, 4000, world['width'])
    y = np.linspace(0, 4000, world['height'])
    world['elevation'] = encode_heights(100 + x[None, :]*x_grade + y[:, None]*y_grade)
    return world


class RoadGradeTests(unittest.TestCase):
    def test_steep_roads_preserve_clicked_alignment_without_detours(self):
        for grade in (.538,.55,math.tan(math.radians(30))):
            for kind in ('street','lane','avenue','highway','motorway','path'):
                with self.subTest(grade=grade,kind=kind):
                    city = City(hillside(grade))
                    cmd = dict(type='road',kind=kind,points=[[500,1000],[800,1000]],autoRoute=True)
                    preview = city.preview_road(cmd)
                    self.assertTrue(preview['valid'],preview)
                    self.assertFalse(preview['road']['terrainAdjusted'])
                    self.assertEqual(preview['road']['points'],cmd['points'])
                    city.command(cmd)
                    self.assertEqual(city.s['roads'][0]['points'],cmd['points'])
                    self.assertGreater(city.s['roads'][0]['profile']['costFactor'],1)

    def test_track_limits_and_just_over_road_limit_remain_enforced(self):
        line = LineString([(500,1000),(800,1000)])
        for kind,grade,limit in (('street',math.tan(math.radians(30.1)),'57.7%'),('train',.17,'16.0%'),('tram',.43,'42.0%'),('metro',.43,'42.0%')):
            with self.subTest(kind=kind), self.assertRaisesRegex(RoadConflict,'上限 '+limit):
                Terrain(hillside(grade)).valid_link(line,kind,0)

    def test_auto_route_finds_valid_switchback_and_matches_built_preview(self):
        city = City(hillside())
        cmd = dict(type='road',kind='street',points=[[500,1000],[800,1000]],autoRoute=True)
        before = city.snapshot()
        preview = city.preview_road(cmd)
        self.assertTrue(preview['valid'],preview)
        self.assertTrue(preview['road']['terrainAdjusted'])
        points = preview['road']['points']
        self.assertEqual(points[0],cmd['points'][0])
        self.assertEqual(points[-1],cmd['points'][-1])
        self.assertGreater(len(points),2)
        self.assertLessEqual(len(points),5)  # Avoid a sawtooth at every grid cell.
        city.terrain.valid_link(LineString(points),'street',0)
        self.assertEqual(before,city.snapshot())
        city.command(cmd)
        self.assertEqual(city.s['roads'][0]['points'],points)
        self.assertEqual(city.s['roads'][0]['constructionCost'],preview['road']['constructionCost'])
        self.assertEqual(city.s['roads'][0]['shape'],'polyline')

    def test_auto_route_retains_intermediate_controls_and_avoids_obstacles(self):
        terrain = Terrain(hillside())
        controls = [[500,1000],[800,1000],[800,1500]]
        obstacle = box(620,770,680,850)
        route = route_around_grade(terrain,controls,'street',obstacle)
        self.assertIsNotNone(route)
        for point in controls:
            self.assertIn(point,route)
        self.assertFalse(LineString(route).intersects(obstacle))
        terrain.valid_link(LineString(route),'street',0)

    def test_auto_route_keeps_valid_roads_and_uses_bridges_for_water(self):
        city = City(hillside())
        cmd = dict(type='road',points=[[500,1000],[500,1500]],autoRoute=True)
        preview = city.preview_road(cmd)
        self.assertTrue(preview['valid'])
        self.assertFalse(preview['road']['terrainAdjusted'])
        self.assertEqual(preview['road']['points'],cmd['points'])
        water = City(flat_world(water=True))
        result = water.preview_road(dict(type='road',points=[[1000,1000],[3000,1000]],autoRoute=True))
        self.assertTrue(result['valid'])
        self.assertTrue(result['road']['autoBridge'])
        self.assertEqual([r['level'] for r in result['roads']], [0,1,0])
        self.assertIsNone(route_around_grade(city.terrain,[[500,1000],[800,1000]],'street',max_visits=0))

    def test_contour_and_oblique_roads_on_steep_hillside(self):
        terrain = Terrain(hillside())
        self.assertGreater(terrain.sample((1000, 1000))['slope'], .42)
        for kind in ('street', 'lane', 'path', 'train'):
            terrain.valid_link(LineString([(1000, 500), (1000, 1800)]), kind, 0)
        terrain.valid_link(LineString([(1000, 500), (1300, 1800)]), 'street', 0)
        diagonal = Terrain(hillside(.5, .5))
        diagonal.valid_link(LineString([(500, 1500), (1500, 500)]), 'street', 0)

    def test_actual_uphill_grade_and_train_limit(self):
        line = LineString([(500, 1000), (1500, 1000)])
        for points in (list(line.coords), list(reversed(line.coords))):
            with self.assertRaisesRegex(RoadConflict, '道路纵坡过大.*120.0%') as caught:
                Terrain(hillside()).valid_link(LineString(points), 'street', 0)
            self.assertLess(line.distance(Point(caught.exception.point)), 1e-8)
        terrain = Terrain(hillside(.2))
        terrain.valid_link(line, 'street', 0)
        with self.assertRaisesRegex(RoadConflict, '上限 16.0%'):
            terrain.valid_link(line, 'train', 0)
        for level in (-1, 1):
            Terrain(hillside()).valid_link(line, 'street', level)
        with self.assertRaisesRegex(RoadConflict, '地图范围'):
            terrain.valid_link(LineString([(-10, 100), (100, 100)]), 'street', 1)

    def test_short_uphill_leg_is_not_averaged_with_long_contour(self):
        terrain = Terrain(hillside())
        line = LineString([(1000, 500), (1000, 1000), (1002, 1000), (1002, 1500)])
        with self.assertRaisesRegex(RoadConflict, '纵坡'):
            terrain.valid_link(line, 'street', 0)

    def test_crest_with_equal_endpoint_heights_is_rejected(self):
        world = hillside()
        x = np.linspace(0, 4000, world['width'])
        world['elevation'] = encode_heights(np.tile(100 + 1.2*(2000-abs(x-2000)), (world['height'], 1)))
        with self.assertRaisesRegex(RoadConflict, '纵坡'):
            Terrain(world).valid_link(LineString([(500, 1000), (3500, 1000)]), 'street', 0)

    def test_curved_alignment_and_duplicate_vertices(self):
        terrain = Terrain(hillside())
        points = curve_points([(1000, 500), (1050, 1000), (1000, 1500)])
        terrain.valid_link(LineString(points), 'street', 0)
        terrain.valid_link(LineString([(1000, 500), (1000, 500), (1000, 1500)]), 'street', 0)

    def test_water_on_narrow_raster_axis_is_not_skipped(self):
        world = flat_world()
        world['grid']['heightMeters'] = 80
        values = np.full((80, 80), -np.inf)
        values[10, :] = 900
        world['water'] = encode_heights(values, water=True)
        with self.assertRaisesRegex(RoadConflict, '水面'):
            Terrain(world).valid_link(LineString([(500, 0), (500, 80)]), 'street', 0)

    def test_preview_build_and_edit_share_grade_validation(self):
        city = City(hillside())
        cmd = dict(type='road', points=[[1000, 500], [1000, 1500]], kind='street')
        before = city.snapshot()
        preview = city.preview_road(cmd)
        self.assertTrue(preview['valid'], preview)
        self.assertEqual(before, city.snapshot())
        city.command(cmd)
        self.assertEqual(city.s['roads'][0]['points'], preview['road']['points'])
        self.assertEqual(city.s['roads'][0]['profile']['grade'], 0)
        rid = city.s['roads'][0]['id']
        edit = dict(type='road_edit', id=rid, points=[[1000, 500], [1500, 500]])
        before = city.snapshot()
        rejected = city.preview_road(edit)
        self.assertFalse(rejected['valid'])
        self.assertIsNotNone(rejected['point'])
        with self.assertRaisesRegex(RoadConflict, '纵坡'):
            city.command(edit)
        self.assertEqual(before, city.snapshot())


if __name__ == '__main__':
    unittest.main()
