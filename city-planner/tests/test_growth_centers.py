"""Remote towns form real competing centers without multiplying demand."""
import copy
import unittest
from tests.test_city import City, flat_world, road
from tests.test_city_v3 import complete
from city.development import update_location_context, select_projects, development_targets
from city.urban import building_style
from city.engine import USES


def towns():
    city=City(flat_world());city.s['settings'].update(autoGrow=False,autoRenew=False,migration=0)
    a=road(city,[[400,700],[1400,700]])
    b=road(city,[[2500,3000],[3500,3000]])
    groups=[]
    for rid in (a,b):
        ps=sorted([p for p in city.s['parcels'] if p['road']==rid],key=lambda p:(p['center'][0],p['id']))
        ps=ps[6:]
        complete(city,ps[0],'office',500)
        for p in ps[1:4]:complete(city,p,'residential',500);p['rent']=1
        groups.append(ps)
    city.s['growthCenters']=[dict(point=groups[0][0]['center'][:],parcel=groups[0][0]['id'],source='existing-employment',formed=0)]
    city.rebuild()
    return city,*groups


def settle(city,sites,count):
    for i in range(count):
        city.s['households'].append(dict(id=city.uid('h'),home=sites[1+i%3]['id'],job=sites[0]['id'],
            size=3,income=6000,car=False,stress=0,unemployedMonths=0,burden=.1,commute=None,commuteFailed=False))


def months(city,count):
    for _ in range(count):city.s['month']+=1;update_location_context(city)


class GrowthCenterTests(unittest.TestCase):
    def test_first_household_contributes_without_building_population_or_month_gate(self):
        city,a,b=towns();settle(city,b,1)
        # Only one inhabited building, no actual employment.
        city.s['households'][0]['job']=None
        update_location_context(city)
        self.assertGreater(city.parcelmap[b[4]['id']]['activityCore'],0)
        self.assertEqual(sum(c['population'] for c in city.s['growthCenters']),3)
        self.assertEqual(sum(c['employment'] for c in city.s['growthCenters']),0)
        self.assertTrue(any(c['source']=='local-activity' for c in city.s['growthCenters']))

    def test_empty_capacity_or_unfinished_buildings_do_not_create_activity(self):
        city,a,b=towns();months(city,4)
        self.assertEqual(len(city.s['growthCenters']),1)
        settle(city,b,30)
        for p in b[:4]:p['building']['status']='construction'
        months(city,4)
        self.assertEqual(len(city.s['growthCenters']),1)
        self.assertEqual(b[4]['activityCore'],0)

    def test_new_town_can_overtake_and_win_actual_office_development(self):
        city,a,b=towns();settle(city,a,10);settle(city,b,160)
        before=development_targets(city)
        months(city,1)
        leader=next(c for c in city.s['growthCenters'] if c['rank']==1)
        self.assertEqual(leader['source'],'local-activity')
        self.assertGreater(b[4]['activityCore'],a[4]['activityCore'])
        self.assertEqual(development_targets(city),before)
        for p in city.s['parcels']:
            if not p.get('building'):p['use']='protected'
        candidates=[]
        for sites in (a,b):
            p=max((p for p in sites if not p.get('building')),key=lambda p:p['businessCore'])
            p.update(use='office',centrality=0,useAffinity={},transitReach=0,urbanity=0,
                     frontageFill=0,infillGap=False,neighbourhoodInfill=0,junctionSeed=0,landValue=80)
            candidates.append(p)
        city.s['settings'].update(externalJobs=4000,maxProjects=1)
        select_projects(city,USES,building_style)
        self.assertIsNone(candidates[0].get('building'))
        self.assertEqual(candidates[1]['building']['use'],'office')

    def test_repeated_evaluation_does_not_accumulate_activity_or_timers(self):
        city,a,b=towns();settle(city,a,10);settle(city,b,20)
        months(city,1)
        first=copy.deepcopy(city.s['growthCenters'])
        for _ in range(5):update_location_context(city)
        self.assertEqual(city.s['growthCenters'],first)
        self.assertNotIn('growthCenterCandidates',city.s)
        self.assertNotIn('growthCenterLeadership',city.s)

    def test_center_activity_accounting_does_not_duplicate_population_or_jobs(self):
        city,a,b=towns();settle(city,a,50);settle(city,b,30)
        months(city,1)
        self.assertEqual(len(city.s['growthCenters']),2)
        self.assertEqual(sum(c['population'] for c in city.s['growthCenters']),240)
        self.assertEqual(sum(c['employment'] for c in city.s['growthCenters']),80)
        self.assertEqual(len({c['id'] for c in city.s['growthCenters']}),len(city.s['growthCenters']))
        self.assertTrue(all(p.get('growthCenter') for p in a[:4]+b[:4]))

    def test_long_road_connection_does_not_erase_remote_activity(self):
        city,a,b=towns();settle(city,a,10);settle(city,b,30)
        road(city,[[1400,700],[2500,3000]])
        months(city,1)
        self.assertTrue(any(c['source']=='local-activity' for c in city.s['growthCenters']))
        self.assertGreater(city.parcelmap[b[4]['id']]['activityCore'],0)

    def test_no_jump_when_population_crosses_previous_forty_person_threshold(self):
        city,a,b=towns();settle(city,b,13);update_location_context(city)
        before=b[4]['activityCore']
        city.s['households'][0]['size']+=1;update_location_context(city)
        self.assertGreater(b[4]['activityCore'],before)
        self.assertLess(b[4]['activityCore']-before,.01)

    def test_save_preserves_activity_and_old_thresholds_have_no_effect(self):
        city,a,b=towns();settle(city,a,10);settle(city,b,50);months(city,2)
        restored=City.restore(city.snapshot())
        restored.s['policy'].update(growthCenterMinimumBuildings=999,growthCenterMinimumResidents=99999,
                                   growthCenterFormationMonths=999,growthCenterSeparation=99999)
        for c in (city,restored):months(c,2)
        for key in ('growthCenters','primaryGrowthCenter'):
            self.assertEqual(city.s[key],restored.s[key])
        self.assertEqual([p['businessCore'] for p in city.s['parcels']],
                         [p['businessCore'] for p in restored.s['parcels']])


if __name__=='__main__':unittest.main()
