"""Automatic streets preserve direction, wait for infill and close real gaps."""
import math
import unittest
from types import SimpleNamespace

from shapely.geometry import LineString, Point, box

from tests.test_city import City, flat_world, road, block_city
from tests.test_city_v3 import complete
from tests.test_contiguous_growth import lane_city, fill, suppress_other_parents
from city.lane_growth import lane_alignment, forward_contacts
from city.lane_connections import connect_lane_entrances
from city.planning import lane_growth_budget, grow_block_streets
from city.urban import grow_lanes
from city.routing import shortest_paths


def shared_nodes(city,a,b):
    def nodes(rid):
        return {e[k] for e in city.network['edges'] if e['road']==rid for k in ('a','b')}
    return nodes(a)&nodes(b)


class LaneAlignmentTests(unittest.TestCase):
    def setUp(self):
        self.city=City(flat_world())

    def test_flat_routes_follow_parent_normal_at_any_rotation(self):
        for heading in (0,math.pi/6,math.pi/2,-math.pi/3):
            with self.subTest(heading=heading):
                points=lane_alignment(self.city,Point(1000,1000),heading,173,box(0,0,1,1),[])
                self.assertIsNotNone(points)
                self.assertAlmostEqual(LineString(points).length,173)
                self.assertLess(max(abs((x-1000)*math.sin(heading)-(y-1000)*math.cos(heading)) for x,y in points),1e-7)

    def test_small_terrain_saving_does_not_accumulate_diagonal_turns(self):
        def features(line):
            a,b=line.coords[0],line.coords[-1]
            return dict(costFactor=1 if b[1]<a[1]-.1 else 1.2,lowland=0)
        city=SimpleNamespace(terrain=SimpleNamespace(valid_link=lambda *args:None,features=features))
        points=lane_alignment(city,Point(1000,1000),0,210,box(0,0,1,1),[])
        self.assertTrue(all(abs(y-1000)<1e-7 for x,y in points))

    def test_route_recovers_original_heading_after_necessary_detour(self):
        def valid(line,*args):
            a,b=line.coords[0],line.coords[-1]
            if 1029<a[0]<1031 and abs(b[1]-a[1])<1:raise ValueError('local grade')
        city=SimpleNamespace(terrain=SimpleNamespace(valid_link=valid,features=lambda line:dict(costFactor=1,lowland=0)))
        points=lane_alignment(city,Point(1000,1000),0,210,box(0,0,1,1),[])
        self.assertLess(abs(points[-1][1]-1000),15)
        self.assertAlmostEqual(points[-1][1],points[-2][1])

    def test_short_crossing_is_trimmed_before_obstacles_beyond_road(self):
        target=dict(points=[[1080,900],[1080,1100]])
        points=lane_alignment(self.city,Point(1000,1000),0,150,box(1088,980,1120,1020),[target])
        self.assertIsNotNone(points)
        self.assertAlmostEqual(points[-1][0],1080)
        self.assertAlmostEqual(LineString(points).length,80)

    def test_nearby_lane_connects_to_both_ends_in_drive_graph(self):
        self.city.s['settings']['autoGrow']=False
        parent=road(self.city,[[1000,800],[1000,1200]])
        target=road(self.city,[[1180,900],[1180,1100]],kind='lane')
        other=self.city.s['roads'][-1]
        points=lane_alignment(self.city,Point(1000,1000),0,150,box(0,0,1,1),[other])
        self.city.add_road(dict(points=points,kind='lane',shape='polyline',snap=False))
        child=self.city.s['roads'][-1]['id'];self.city.rebuild(regenerate=True)
        a=shared_nodes(self.city,parent,child);b=shared_nodes(self.city,target,child)
        self.assertEqual(len(a),1);self.assertEqual(len(b),1)
        self.assertIn(next(iter(b)),shortest_paths(self.city.graphs['car'],next(iter(a)))[0])

    def test_gap_extension_respects_obstacles_and_tangent(self):
        target=dict(points=[[1180,900],[1180,1100]])
        points=lane_alignment(self.city,Point(1000,1000),0,150,box(1160,990,1170,1010),[target])
        self.assertAlmostEqual(points[-1][0],1150)
        self.assertEqual(forward_contacts([[1000,1000],[1150,1000]],[LineString([[1000,1020],[1300,1020]])]),[])
        # A slanted target should not pull the endpoint sideways when the
        # current tangent can reach the exact centerline.
        choices=forward_contacts([[1000,1000],[1150,1000]],[LineString([[1160,900],[1200,1100]])])
        self.assertEqual(choices[0][2],[1180.,1000.])


class LaneCadenceTests(unittest.TestCase):
    def test_budget_and_wait_survive_save_and_repeated_evaluation(self):
        city,child=lane_city();fill(city,child);suppress_other_parents(city,child)
        city.s['policy']['laneGrowthIntervalMonths']=3
        self.assertTrue(grow_lanes(city));city.rebuild(regenerate=True)
        restored=City.restore(city.snapshot())
        for c in (city,restored):
            self.assertFalse(grow_lanes(c));self.assertFalse(grow_block_streets(c))
            c.s['month']+=2
            self.assertEqual(lane_growth_budget(c),0)
            c.s['month']+=1
            self.assertEqual(lane_growth_budget(c),1)

    def test_construction_does_not_trigger_another_generation(self):
        city,child=lane_city();fill(city,child);suppress_other_parents(city,child)
        for p in city.s['parcels']:
            if p.get('building'):p['building']['status']='construction'
        self.assertFalse(grow_lanes(city))

    def test_block_and_open_builders_share_cadence(self):
        city=block_city();city.s['settings']['autoGrow']=True;city.s['month']=12
        city.rebuild(regenerate=True)
        for p in city.s['parcels']:complete(city,p,'residential')
        self.assertTrue(grow_block_streets(city))
        self.assertEqual(sum(r.get('generated',False) for r in city.s['roads']),1)
        self.assertFalse(grow_lanes(city));self.assertFalse(grow_block_streets(city))
        self.assertEqual(lane_growth_budget(City.restore(city.snapshot())),0)

    def test_failed_candidates_do_not_consume_budget(self):
        city,child=lane_city();suppress_other_parents(city,child)
        self.assertFalse(grow_lanes(city));self.assertEqual(lane_growth_budget(city),1)
        fill(city,child)
        self.assertTrue(grow_lanes(city))

    def test_legacy_default_migrates_but_custom_cap_is_preserved(self):
        city=City(flat_world())
        for old,expected in ((3,1),(2,2)):
            snapshot=city.snapshot();snapshot['state']['policy'].pop('laneGrowthIntervalMonths')
            snapshot['state']['policy']['autoLanesPerMonth']=old
            restored=City.restore(snapshot)
            self.assertEqual(restored.s['policy']['autoLanesPerMonth'],expected)
            self.assertEqual(restored.s['policy']['laneGrowthIntervalMonths'],1)

    def test_default_allows_one_street_in_each_successive_month(self):
        city,child=lane_city();fill(city,child);suppress_other_parents(city,child)
        self.assertEqual(city.s['policy']['laneGrowthIntervalMonths'],1)
        self.assertTrue(grow_lanes(city));city.rebuild(regenerate=True)
        self.assertFalse(grow_lanes(city))
        city.s['month']+=1
        self.assertEqual(lane_growth_budget(city),1)
        self.assertTrue(grow_lanes(city))
        self.assertFalse(grow_lanes(city))

    def test_previous_default_upgrades_once_and_preserves_later_custom_wait(self):
        city=City(flat_world());snapshot=city.snapshot()
        snapshot['state'].pop('laneCadenceVersion')
        snapshot['state']['policy'].update(autoLanesPerMonth=1,laneGrowthIntervalMonths=3)
        restored=City.restore(snapshot)
        self.assertEqual(restored.s['policy']['laneGrowthIntervalMonths'],1)
        restored.s['policy']['laneGrowthIntervalMonths']=3
        self.assertEqual(City.restore(restored.snapshot()).s['policy']['laneGrowthIntervalMonths'],3)
        snapshot['state']['policy'].update(autoLanesPerMonth=2,laneGrowthIntervalMonths=4)
        custom=City.restore(snapshot)
        self.assertEqual(custom.s['policy']['autoLanesPerMonth'],2)
        self.assertEqual(custom.s['policy']['laneGrowthIntervalMonths'],4)


class LegacyLaneGapTests(unittest.TestCase):
    def fixture(self,kind='lane',level=0):
        city=City(flat_world());city.s['settings']['autoGrow']=False
        lane=road(city,[[1000,1200],[1000,1040]],kind='lane')
        target=road(city,[[800,1000],[1200,1000]],kind=kind,level=level)
        city.s['roads'][0]['generated']=True
        return city,lane,target

    def test_restore_repairs_40m_lane_gap_with_real_graph_contact(self):
        city,lane,target=self.fixture()
        restored=City.restore(city.snapshot())
        self.assertEqual(restored.s['roads'][0]['points'][-1],[1000.,1000.])
        self.assertTrue(shared_nodes(restored,lane,target))
        self.assertFalse(connect_lane_entrances(restored))

    def test_repair_respects_protected_land_levels_and_explicit_placement(self):
        for variant in ('protected','elevated','exact','manual','building','water'):
            with self.subTest(variant=variant):
                city,lane,target=self.fixture(level=1 if variant=='elevated' else 0)
                original=list(city.s['roads'][0]['points'])
                if variant in ('protected','building'):
                    footprint=[list(p) for p in box(990,1015,1010,1025).exterior.coords]
                    city.s['parcels'].append(dict(use='protected' if variant=='protected' else 'auto',
                        points=footprint,building=dict(footprint=footprint) if variant=='building' else None))
                elif variant=='exact':city.s['roads'][0]['exactPlacement']=True
                elif variant=='manual':city.s['roads'][0]['generated']=False
                elif variant=='water':
                    def blocked(*args):raise ValueError('water')
                    city.terrain.valid_link=blocked
                self.assertFalse(connect_lane_entrances(city))
                self.assertEqual(city.s['roads'][0]['points'],original)


if __name__=='__main__':unittest.main()
