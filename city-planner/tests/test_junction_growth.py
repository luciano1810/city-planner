"""New towns start at usable manual crossroads, without manufacturing demand."""
import copy
import math
import unittest
from tests.test_city import City, flat_world, road
from tests.test_city_v3 import complete
from city.development import update_location_context, select_projects
from city.engine import USES
from city.urban import building_style


def cross_city():
    city=City(flat_world())
    city.s['settings'].update(autoGrow=False,autoRenew=False)
    road(city,[(400,1800),(3400,1800)])
    road(city,[(1200,800),(1200,2800)])
    return city


class JunctionGrowthTests(unittest.TestCase):
    def test_second_road_replaces_provisional_seed_before_development(self):
        city=City(flat_world())
        road(city,[(400,1800),(3400,1800)])
        update_location_context(city)
        self.assertEqual(city.s['growthCenters'][0]['source'],'network-opportunity')
        road(city,[(1200,800),(1200,2800)])
        update_location_context(city)
        center=city.s['growthCenters'][0]
        self.assertEqual(center['source'],'manual-junction')
        self.assertEqual(center['point'],[1200.,1800.])
        near=min(city.s['parcels'],key=lambda p:math.dist(p['center'],center['point']))
        far=max(city.s['parcels'],key=lambda p:math.dist(p['center'],center['point']))
        self.assertGreater(near['junctionSeed'],.8)
        self.assertLess(far['junctionSeed'],.001)

    def test_initial_businesses_and_homes_cluster_at_crossroads(self):
        city=cross_city()
        city.step(6)
        urban=[p for p in city.s['parcels'] if p.get('building')
               and p['building']['use'] in ('office','commercial','residential')]
        self.assertTrue(any(p['building']['use']=='residential' for p in urban))
        self.assertTrue(any(p['building']['use']=='office' for p in urban))
        near=[p for p in urban if math.dist(p['center'],[1200,1800])<400]
        self.assertGreaterEqual(len(near)/len(urban),.75)
        self.assertGreater(len(city.s['households']),0)

    def test_t_junction_bridge_and_generated_arms_do_not_seed(self):
        for variant in ('t','bridge','generated'):
            with self.subTest(variant=variant):
                city=City(flat_world())
                road(city,[(400,1800),(3400,1800)])
                road(city,[(1200,1800 if variant=='t' else 800),(1200,2800)],
                     level=1 if variant=='bridge' else 0)
                if variant=='generated':city.s['roads'][-1]['generated']=True
                update_location_context(city)
                self.assertNotEqual(city.s['growthCenters'][0]['source'],'manual-junction')
                self.assertFalse(any(p['junctionSeed'] for p in city.s['parcels']))

    def test_four_separately_drawn_arms_form_a_crossroads(self):
        city=City(flat_world())
        for endpoint in ([400,1800],[2200,1800],[1200,800],[1200,2800]):
            road(city,[[1200,1800],endpoint])
        update_location_context(city)
        self.assertEqual(city.s['growthCenters'][0]['source'],'manual-junction')

    def test_protected_land_and_disconnected_frontages_do_not_benefit(self):
        city=cross_city()
        remote=road(city,[(1350,1900),(2150,1900)])
        update_location_context(city)
        isolated=[p for p in city.s['parcels'] if p['road']==remote]
        self.assertTrue(isolated)
        self.assertTrue(all(p['junctionSeed']==0 for p in isolated))
        for p in city.s['parcels']:
            if p['road']!=remote:p['use']='protected'
        update_location_context(city)
        self.assertNotEqual(city.s['growthCenters'][0]['source'],'manual-junction')

    def test_existing_town_keeps_its_center_when_crossroad_is_added(self):
        city=City(flat_world())
        road(city,[(400,1800),(3400,1800)])
        update_location_context(city)
        center=copy.deepcopy(city.s['growthCenters'])
        complete(city,city.s['parcels'][0],'office')
        road(city,[(1200,800),(1200,2800)])
        update_location_context(city)
        for field in ('point','parcel','source','formed'):
            self.assertEqual(city.s['growthCenters'][0][field],center[0][field])
        self.assertFalse(any(p['junctionSeed'] for p in city.s['parcels']))

    def test_bonus_expires_and_does_not_return_after_demolition(self):
        city=cross_city()
        update_location_context(city)
        for p in city.s['parcels'][:city.s['policy']['junctionSeedBuildings']]:
            complete(city,p,'office')
        update_location_context(city)
        self.assertFalse(any(p['junctionSeed'] for p in city.s['parcels']))
        for p in city.s['parcels']:p['building']=None
        update_location_context(city)
        self.assertFalse(any(p['junctionSeed'] for p in city.s['parcels']))

    def test_crossroads_do_not_create_housing_demand_or_override_pause(self):
        city=cross_city()
        for p in city.s['parcels']:p['use']='residential'
        update_location_context(city)
        select_projects(city,USES,building_style)
        self.assertFalse(any(p.get('building') for p in city.s['parcels']))
        for p in city.s['parcels']:p['use']='auto'
        city.s['settings']['growth']=0
        select_projects(city,USES,building_style)
        self.assertFalse(any(p.get('building') for p in city.s['parcels']))

    def test_multiple_crossroads_and_save_continuation_are_stable(self):
        city=cross_city()
        road(city,[(2600,800),(2600,2800)])
        update_location_context(city)
        centers=copy.deepcopy(city.s['growthCenters'])
        restored=City.restore(city.snapshot())
        update_location_context(restored)
        self.assertEqual(restored.s['growthCenters'],centers)
        city.step(2)
        restored.step(2)
        self.assertEqual(city.snapshot(),restored.snapshot())


if __name__=='__main__':unittest.main()
