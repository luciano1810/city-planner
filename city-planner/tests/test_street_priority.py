"""Demand and marginal land benefit choose the street, not iteration order."""
import copy
import unittest

from shapely.geometry import LineString, Polygon

from tests.test_city import City, flat_world, road, block_city
from tests.test_contiguous_growth import fill
from city.street_priority import StreetPriorities
from city.planning import construct_streets
from city.urban import grow_lanes


def two_towns():
    city=City(flat_world());city.s['settings'].update(autoGrow=True,autoRenew=False)
    city.s['month']=12
    crowded=road(city,[[500,800],[2100,800]])
    small=road(city,[[500,2600],[1300,2600]])
    for rid in (crowded,small):fill(city,rid)
    return city,crowded,small


def residents(city,rid,count):
    homes=[p for p in city.s['parcels'] if p['road']==rid and p.get('building')]
    for i in range(count):
        city.s['households'].append(dict(id=city.uid('h'),home=homes[i%len(homes)]['id'],
            size=3,income=6000,car=False,job=None))


class StreetPriorityTests(unittest.TestCase):
    def test_more_local_unmet_demand_beats_more_buildings(self):
        city,crowded,small=two_towns()
        city.s['settings'].update(externalJobs=0,migration=0)
        city.s['policy'].update(commercialBaseDemand=0,warehouseBaseDemand=0)
        residents(city,crowded,2);residents(city,small,24)
        counts=[sum(bool(p.get('building')) for p in city.s['parcels'] if p['road']==r) for r in (crowded,small)]
        self.assertGreater(counts[0],counts[1])
        self.assertTrue(grow_lanes(city))
        self.assertEqual(city.s['roads'][-1]['parent'],small)
        self.assertGreater(city.s['roads'][-1]['growthPriority']['demandFloorArea'],0)

    def test_high_value_wins_equal_demand_independent_of_road_order(self):
        city,crowded,small=two_towns()
        for p in city.s['parcels']:p['landValue']=800 if p['road']==small else 80
        restored=City.restore(city.snapshot());restored.s['roads'].reverse()
        for c in (city,restored):
            self.assertTrue(grow_lanes(c))
            self.assertEqual(c.s['roads'][-1]['parent'],small)
        self.assertEqual(city.s['roads'][-1]['growthKey'],restored.s['roads'][-1]['growthKey'])

    def test_high_value_without_demand_does_not_build(self):
        city,_,_=two_towns()
        city.s['settings'].update(externalJobs=0,migration=0)
        city.s['policy'].update(commercialBaseDemand=0,warehouseBaseDemand=0)
        for p in city.s['parcels']:p['landValue']=100000
        self.assertFalse(grow_lanes(city))

    def test_open_high_value_area_competes_with_reserved_blocks(self):
        city=block_city();city.s['settings']['autoGrow']=True;city.s['month']=12
        remote=road(city,[[500,3000],[1300,3000]])
        corridor=LineString([[691,3000],[691,3100]]).buffer(6)
        self.assertLess(sum(Polygon(p['points']).intersection(corridor).area
                            for p in city.s['parcels'] if p['road']==remote),.01)
        for r in city.s['roads']:fill(city,r['id'])
        for p in city.s['parcels']:p['landValue']=8000 if p['road']==remote else 40
        self.assertTrue(city.s['streetPlans'])
        self.assertTrue(grow_lanes(city))
        self.assertEqual(city.s['roads'][-1]['parent'],remote)

    def test_available_land_and_engineering_cost_reduce_priority(self):
        city,_,small=two_towns();priorities=StreetPriorities(city)
        line=LineString([[691,2600],[691,2780]])
        parcels=[p for p in city.s['parcels'] if p['road']==small]
        base=priorities.evaluate(line,parcels)
        # Keep demand fixed: existing homes have no occupants/jobs, so this
        # measures the choice between serviced vacant land and a new road.
        empty=copy.deepcopy(parcels)
        for p in empty:p['building']=None
        infill=priorities.evaluate(line,empty)
        self.assertEqual(base['demandFloorArea'],infill['demandFloorArea'])
        self.assertLess(infill['score'],base['score'])
        profile=city.terrain.profile
        city.terrain.profile=lambda *a,**k:dict(profile(*a,**k),costFactor=4)
        expensive=priorities.evaluate(line,parcels)
        self.assertAlmostEqual(expensive['score'],base['score']/4)

    def test_same_catchment_does_not_multiply_demand_by_parcel_count(self):
        city,_,small=two_towns();priorities=StreetPriorities(city)
        line=LineString([[691,2600],[691,2780]])
        parcels=[p for p in city.s['parcels'] if p['road']==small]
        once=priorities.evaluate(line,parcels)
        twice=priorities.evaluate(line,parcels+parcels)
        self.assertEqual(once['demandFloorArea'],twice['demandFloorArea'])
        self.assertAlmostEqual(once['score'],twice['score'])

    def test_unbuildable_highest_candidate_falls_back_without_spending_slot(self):
        city=City(flat_world());road(city,[[500,1000],[1500,1000]])
        candidates=[dict(id='blocked',parent=city.s['roads'][0]['id'],priority=dict(score=2),
                         command=dict(kind='lane',points=[[600,1000],[1000,1000]])),
                    dict(id='feasible',parent=city.s['roads'][0]['id'],priority=dict(score=1),
                         command=dict(kind='lane',points=[[1000,1000],[1000,1200]]))]
        self.assertTrue(construct_streets(city,candidates,1))
        self.assertEqual(city.s['roads'][-1]['growthKey'],'feasible')
        self.assertEqual(city.s['growthAttempts'],['feasible'])


if __name__=='__main__':unittest.main()
