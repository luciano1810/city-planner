"""Recursive streets and connected infill retain demand and geometry gates."""
import copy
import math
import unittest
from shapely.geometry import LineString, Polygon
from tests.test_city import City, flat_world, road, block_city
from tests.test_city_v3 import complete
from city.geometry import branch_anchors, building_footprint, stable_id
from city.urban import grow_lanes, building_style
from city.development import update_location_context, center_radius, select_projects
from city.engine import USES


def lane_city():
    city=City(flat_world())
    city.s['settings'].update(autoGrow=True,autoRenew=False,externalJobs=900)
    city.s['policy']['autoLanesPerMonth']=1
    city.s['month']=12
    root=road(city,[[500,1500],[2000,1500]])
    child=road(city,[[1003,1500],[1003,1710]],kind='lane')
    city.s['roads'][-1].update(generated=True,parent=root,growthKey='fixture-child')
    return city,child


def fill(city,rid):
    for p in city.s['parcels']:
        if p['road']==rid and not p.get('building') and not p.get('openSpace') and p['use']!='protected':
            if building_footprint(p,'residential') is not None:complete(city,p,'residential')


def suppress_other_parents(city,rid):
    city.s['laneClearanceVersion']=2
    city.s['growthAttempts']=[stable_id('lane-',(r['id'],index,side)) for r in city.s['roads']
                             if r['id']!=rid for index,_ in branch_anchors(r) for side in (-1,1)]


class RecursiveStreetTests(unittest.TestCase):
    def test_short_generated_lane_branches_for_two_more_generations(self):
        city,parent=lane_city()
        for _ in range(2):
            fill(city,parent)
            suppress_other_parents(city,parent)
            before={p['id']:copy.deepcopy(p['building']['footprint']) for p in city.s['parcels'] if p.get('building')}
            old=len(city.s['roads'])
            self.assertTrue(grow_lanes(city))
            self.assertEqual(len(city.s['roads']),old+1)
            child=city.s['roads'][-1]
            self.assertEqual(child['parent'],parent)
            city.rebuild(regenerate=True)
            for pid,footprint in before.items():self.assertEqual(city.parcelmap[pid]['building']['footprint'],footprint)
            plots=[p for p in city.s['parcels'] if p['road']==child['id']]
            # A first branch may close the 80 m gap back to the main road.
            # The other side must still be able to extend on the next update.
            if not plots:
                self.assertTrue(city.network['blocks'])
                self.assertFalse(grow_lanes(city))
                city.s['month']+=city.s['policy']['laneGrowthIntervalMonths']
                self.assertTrue(grow_lanes(city))
                self.assertEqual(len(city.s['roads']),old+2)
                child=city.s['roads'][-1]
                self.assertEqual(child['parent'],parent)
                city.rebuild(regenerate=True)
                plots=[p for p in city.s['parcels'] if p['road']==child['id']]
            self.assertTrue(plots)
            self.assertTrue(all(p['connected'] for p in plots))
            surface=LineString(child['points']).buffer(4)
            self.assertTrue(all(surface.intersection(Polygon(fp)).area<.01 for fp in before.values()))
            parent=child['id']
            city.s['month']+=city.s['policy']['laneGrowthIntervalMonths']

    def test_empty_child_does_not_branch_even_beside_built_parent(self):
        city,child=lane_city()
        fill(city,city.s['roads'][0]['id'])
        suppress_other_parents(city,child)
        self.assertFalse(grow_lanes(city))

    def test_filled_child_requires_demand_and_respects_pause(self):
        city,child=lane_city()
        fill(city,child);suppress_other_parents(city,child)
        city.s['settings'].update(externalJobs=0,migration=0)
        city.s['policy'].update(commercialBaseDemand=0,warehouseBaseDemand=0)
        self.assertFalse(grow_lanes(city))
        city.s['settings'].update(externalJobs=900,growth=0)
        self.assertFalse(grow_lanes(city))
        city.s['settings'].update(growth=1,autoGrow=False)
        self.assertFalse(grow_lanes(city))

    def test_remote_closed_block_does_not_disable_open_lane_growth(self):
        city,child=lane_city()
        for points in ([[2500,2500],[3200,2500]],[[3200,2500],[3200,3200]],
                       [[3200,3200],[2500,3200]],[[2500,3200],[2500,2500]]):road(city,points)
        self.assertTrue(city.s['streetPlans'])
        fill(city,child);suppress_other_parents(city,child)
        self.assertTrue(grow_lanes(city))
        self.assertEqual(city.s['roads'][-1]['parent'],child)

    def test_recursive_growth_is_repeatable_after_save(self):
        city,child=lane_city()
        fill(city,child);suppress_other_parents(city,child)
        restored=City.restore(city.snapshot())
        for c in (city,restored):
            self.assertTrue(grow_lanes(c));c.rebuild(regenerate=True)
        self.assertEqual(city.s['roads'],restored.s['roads'])
        self.assertEqual(city.s['parcels'],restored.s['parcels'])


class NeighbourhoodGrowthTests(unittest.TestCase):
    def test_connected_cross_street_gap_beats_remote_frontage(self):
        city=City(flat_world());city.s['settings']['autoGrow']=False
        a=road(city,[[500,1500],[2200,1500]])
        b=road(city,[[1000,1380],[2000,1380]])
        road(city,[[1000,1380],[1000,1500]])
        isolated=road(city,[[1250,1600],[2150,1600]])
        sites=sorted([p for p in city.s['parcels'] if p['road']==a and p['center'][1]<1500],
                     key=lambda p:abs(p['center'][0]-1100))
        for p in sites[:5]:complete(city,p,'residential')
        update_location_context(city)
        near=max((p for p in city.s['parcels'] if p['road']==b),key=lambda p:p['neighbourhoodInfill'])
        self.assertGreater(near['neighbourhoodInfill'],0)
        self.assertEqual(near['frontageFill'],0)
        self.assertTrue(all(p['neighbourhoodInfill']==0 for p in city.s['parcels'] if p['road']==isolated))
        far=max((p for p in city.s['parcels'] if p['road']==b),key=lambda p:p['center'][0])
        self.assertGreater(near['neighbourhoodInfill'],far['neighbourhoodInfill'])
        # Give two commercial candidates equal other attributes; infill should
        # win the actual project competition, not merely a displayed field.
        for p in city.s['parcels']:
            if not p.get('building'):p['use']='protected'
        for p in (near,far):
            p.update(use='commercial',centrality=0,businessCore=0,localResidents=0,urbanity=0,
                     transitReach=0,useAffinity={},frontageFill=0,infillGap=False,junctionSeed=0,landValue=80)
        city.s['settings']['maxProjects']=1
        select_projects(city,USES,building_style)
        self.assertIsNotNone(near.get('building'))
        self.assertIsNone(far.get('building'))

    def test_infill_does_not_invent_housing_demand(self):
        city=block_city()
        for p in city.s['parcels'][:8]:complete(city,p,'residential')
        for p in city.s['parcels']:p['use']='residential'
        update_location_context(city)
        before=sum(bool(p.get('building')) for p in city.s['parcels'])
        select_projects(city,USES,building_style)
        self.assertEqual(sum(bool(p.get('building')) for p in city.s['parcels']),before)

    def test_core_expands_only_with_local_completed_connected_land_and_is_capped(self):
        city=City(flat_world())
        road(city,[[500,1500],[2500,1500]])
        origin=min(city.s['parcels'],key=lambda p:math.dist(p['center'],[1500,1500]))
        center=dict(point=origin['center'])
        distances=city.distances(origin['id'],'walk')[0]
        sites=sorted(city.s['parcels'],key=lambda p:math.dist(p['center'],center['point']))[:24]
        base=city.s['policy']['businessCoreRadius']
        self.assertEqual(center_radius(city,center,[],distances),base)
        for p in sites:complete(city,p,'residential')
        radius=center_radius(city,center,sites,distances)
        self.assertGreater(radius,base)
        self.assertEqual(center_radius(city,center,sites,{}),base)
        for p in sites:p['building']['status']='construction'
        self.assertEqual(center_radius(city,center,sites,distances),base)
        for p in sites:p['building']['status']='active'
        city.s['policy']['businessCoreMaximumRadius']=base+10
        self.assertEqual(center_radius(city,center,sites,distances),base+10)


if __name__=='__main__':unittest.main()
