"""Waiting households, construction credit and actionable development diagnostics."""
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from tests.test_city import City, flat_world, block_city, road
from tests.test_city_v3 import complete
from city.housing import HousingMarket, HomeJobMatcher, migration_rate
from collections import Counter
import copy
from city.development import planned_supply, development_targets
from city.geometry import building_footprint

class HousingDemandTests(unittest.TestCase):
    def test_queue_accumulates_freezes_and_survives_save(self):
        city=City(flat_world())
        for _ in range(3):city.populate()
        self.assertEqual(city.s['pendingHousing'],72)
        restored=City.restore(city.snapshot())
        restored.populate();self.assertEqual(restored.s['pendingHousing'],96)
        restored.s['settings']['growth']=0
        restored.populate();self.assertEqual(restored.s['pendingHousing'],96)
        self.assertEqual(restored.s['households'],[])

    def test_admission_drains_queue_without_discarding_remaining_households(self):
        city=block_city();city.step(6)
        city.s['pendingHousing']=80
        city.s['settings']['migration']=0
        for p in city.s['parcels']:
            b=p.get('building')
            if b and b['use']=='residential':b['status']='active';b['capacity']=500;p['rent']=1
        before=len(city.s['households'])
        city.populate()
        admitted=len(city.s['households'])-before
        self.assertGreater(admitted,0)
        self.assertEqual(city.s['pendingHousing'],80-admitted)

    def test_only_unfinished_housing_gets_partial_credit(self):
        city=SimpleNamespace(s=dict(renewals=[],policy={'householdSpace':75},parcels=[
            {'id':'a','building':{'use':'residential','status':'active','capacity':100,'extensionReady':4,'footprintArea':750,'extensionFloors':1}},
            {'id':'b','building':{'use':'residential','status':'construction','capacity':80}},
            {'id':'c','building':{'use':'office','status':'construction','capacity':20}}]))
        self.assertEqual(planned_supply(city)['residential'],190)
        effective=planned_supply(city,housing_credit=.5)
        self.assertEqual(effective['residential'],145)
        self.assertEqual(effective['office'],20)

    def test_accumulated_backlog_is_not_multiplied_indefinitely(self):
        city=City(flat_world());city.s['pendingHousing']=240
        self.assertEqual(development_targets(city)['residential'],0)
        self.assertEqual(HousingMarket(city).summary()['waitingForJobs'],240)

    def test_rejected_proposal_does_not_spend_construction_slot(self):
        city=block_city();city.s['settings']['maxProjects']=1
        count=0
        def reject_first(*args,**kwargs):
            nonlocal count
            count+=1
            return None if count==1 else building_footprint(*args,**kwargs)
        with patch('city.development.building_footprint',side_effect=reject_first):city.develop()
        self.assertEqual(city.s['housingDemand']['started'],1)
        reasons=[p.get('developmentReason','') for p in city.s['parcels'] if not p.get('building')]
        self.assertTrue(any('面积不足' in r for r in reasons))
        self.assertTrue(any('名额已用尽' in r for r in reasons))

    def test_oversupply_and_freight_blockers_are_not_reported_as_quota(self):
        city=block_city()
        for p in city.s['parcels']:p['use']='warehouse';p['freightTime']=None
        city.develop()
        self.assertTrue(all('货运门户' in p['developmentReason'] for p in city.s['parcels']))
        for p in city.s['parcels']:p['use']='commercial'
        complete(city,city.s['parcels'][0],'commercial',10000)
        city.develop()
        empty=[p for p in city.s['parcels'] if not p.get('building')]
        self.assertTrue(empty)
        self.assertTrue(all('需求未达' in p['developmentReason'] for p in empty))
        self.assertFalse(any('名额已用尽' in p['developmentReason'] for p in empty))

    def test_full_pipeline_covers_local_demand_without_discount(self):
        city, near, far = two_regions()
        complete(city, near[0], 'office', 40)
        complete(city, near[1], 'residential', 40)
        near[1]['building']['status']='construction'
        set_queue(city,40)
        market=HousingMarket(city)
        self.assertEqual(market.summary()['committedCoverage'],40)
        self.assertEqual(market.gap(near[2]),0)
        for p in city.s['parcels']:
            if not p.get('building'):p['use']='residential'
        city.develop()
        self.assertEqual(city.s['housingDemand']['started'],0)
        self.assertTrue(all('本地通勤' in p['developmentReason'] for p in city.s['parcels'] if not p.get('building')))


def two_regions():
    city=City(flat_world())
    city.s['settings'].update(autoGrow=False,autoRenew=False,migration=0)
    a=road(city,[(400,700),(1400,700)])
    b=road(city,[(2500,3000),(3500,3000)])
    return city,[p for p in city.s['parcels'] if p['road']==a],[p for p in city.s['parcels'] if p['road']==b]


def set_queue(city,count,income=5000,car=False):
    city.s['pendingHousing']=count
    city.s['migrationQueue']=[dict(income=income,car=car,count=count)] if count else []


class LocalHousingTests(unittest.TestCase):
    def test_dynamic_interest_responds_to_jobs_and_honors_zero(self):
        city,near,_=two_regions()
        city.s['settings']['migration']=24
        self.assertEqual(migration_rate(city),24)
        complete(city,near[0],'office',100)
        self.assertEqual(migration_rate(city),49)
        city.s['settings']['growth']=2
        self.assertEqual(migration_rate(city),98)
        city.s['settings']['growth']=0
        self.assertEqual(migration_rate(city),0)
        city.s['settings'].update(growth=1,migration=0)
        self.assertEqual(migration_rate(city),0)

    def test_job_and_home_are_assigned_together_with_no_car(self):
        city,near,far=two_regions()
        complete(city,near[0],'office',5)
        complete(city,near[1],'residential',10)
        complete(city,far[0],'residential',100)
        near[1]['rent']=2;far[0]['rent']=1
        set_queue(city,12)
        city.populate()
        self.assertEqual(len(city.s['households']),5)
        self.assertEqual(city.s['pendingHousing'],7)
        self.assertTrue(all(h['home']==near[1]['id'] and h['job']==near[0]['id'] and not h['car'] for h in city.s['households']))
        self.assertEqual(city.s['migrationDemand']['potential'],0)
        self.assertEqual(city.s['migrationDemand']['admitted'],5)
        city.populate()
        self.assertEqual(len(city.s['households']),5)

    def test_remote_vacancies_do_not_cancel_local_housing_need(self):
        city,near,far=two_regions()
        complete(city,near[0],'office',20)
        complete(city,far[0],'residential',200)
        set_queue(city,20)
        market=HousingMarket(city)
        self.assertEqual(market.gap(near[1]),20)
        self.assertEqual(market.gap(far[1]),0)
        city.s['settings']['maxProjects']=1
        for p in city.s['parcels']:
            if not p.get('building'):p['use']='residential'
        city.develop()
        homes=[p for p in near if p.get('building') and p['building']['use']=='residential']
        self.assertEqual(len(homes),1)
        self.assertGreater(homes[0]['building']['capacity'],0)
        self.assertLessEqual(homes[0]['building']['capacity'],25)
        self.assertEqual(sum(p.get('building') is not None for p in far),1)

    def test_one_home_capacity_cannot_cover_two_workplaces_twice(self):
        city,near,_=two_regions()
        complete(city,near[0],'office',20)
        complete(city,near[1],'commercial',20)
        complete(city,near[2],'residential',25)
        set_queue(city,40)
        market=HousingMarket(city)
        self.assertEqual(market.total,40)
        self.assertEqual(market.summary()['availableCoverage'],25)
        self.assertEqual(market.gap(near[3]),15)
        self.assertEqual(market.reserve(near[3],10),10)
        self.assertEqual(market.gap(near[4]),5)
        self.assertEqual(market.reserve(near[4],100),5)
        self.assertEqual(market.gap(near[5]),0)

    def test_unaffordable_homes_do_not_cover_low_income_demand(self):
        city,near,_=two_regions()
        complete(city,near[0],'office',10)
        complete(city,near[1],'residential',100)
        near[1]['rent']=50
        set_queue(city,10,income=3500)
        market=HousingMarket(city)
        self.assertEqual(market.gap(near[2]),10)
        city.populate()
        self.assertEqual(city.s['households'],[])
        self.assertEqual(city.s['pendingHousing'],10)

    def test_long_walk_cannot_masquerade_as_transit(self):
        city=City(flat_world());city.s['settings'].update(autoGrow=False,migration=0)
        road(city,[(200,1800),(3800,1800)])
        sites=sorted(city.s['parcels'],key=lambda p:p['center'][0])
        complete(city,sites[-1],'office',10)
        complete(city,sites[0],'residential',10)
        set_queue(city,10)
        self.assertIsNone(HomeJobMatcher(city).choose(5000,False))
        self.assertIsNotNone(HomeJobMatcher(city).choose(5000,True))
        self.assertGreater(HousingMarket(city).gap(sites[-3]),0)

    def test_unemployed_resident_moves_to_a_real_job_before_migrants(self):
        city,near,far=two_regions()
        complete(city,near[0],'office',1)
        complete(city,near[1],'residential',5)
        complete(city,far[0],'residential',5)
        city.s['households']=[dict(id='test-h',home=far[0]['id'],size=2,income=5000,car=False,job=None,stress=8,unemployedMonths=10)]
        set_queue(city,1)
        city.populate()
        h=city.s['households'][0]
        self.assertEqual(h['home'],near[1]['id'])
        self.assertEqual(h['job'],near[0]['id'])
        self.assertEqual(city.s['pendingHousing'],1)
        self.assertEqual(city.s['movedIn'],0)
        self.assertEqual(city.s['relocated'],2)

    def test_jobs_without_usable_home_are_not_admitted(self):
        city,near,far=two_regions()
        complete(city,near[0],'office',20)
        complete(city,far[0],'residential',100)
        set_queue(city,20)
        city.populate()
        self.assertEqual(city.s['households'],[])
        self.assertEqual(city.s['pendingHousing'],20)
        self.assertEqual(HousingMarket(city).summary()['shortage'],20)

    def test_future_jobs_can_support_homes_but_not_actual_migration(self):
        city,near,_=two_regions()
        complete(city,near[0],'office',20)
        near[0]['building']['status']='construction'
        set_queue(city,20)
        self.assertEqual(HousingMarket(city).gap(near[1]),20)
        complete(city,near[1],'residential',20)
        city.populate()
        self.assertEqual(city.s['households'],[])
        self.assertEqual(HousingMarket(city).gap(near[2]),0)

    def test_paused_queue_and_profiles_survive_restore(self):
        city,near,_=two_regions()
        complete(city,near[0],'office',5)
        complete(city,near[1],'residential',5)
        set_queue(city,8,car=False)
        city.s['settings']['growth']=0
        saved=city.snapshot()
        restored=City.restore(copy.deepcopy(saved))
        restored.populate()
        self.assertEqual(restored.s['migrationQueue'],saved['state']['migrationQueue'])
        self.assertEqual(restored.s['households'],[])
        restored.s['settings']['growth']=1
        restored.populate()
        self.assertEqual(len(restored.s['households']),5)
        self.assertTrue(all(not h['car'] for h in restored.s['households']))

    def test_legacy_queue_upgrade_is_deterministic_and_preserves_total(self):
        city=City(flat_world());city.s['pendingHousing']=99
        saved=city.snapshot()
        for key in ('migrationQueue','migrationDemand','housingMarketVersion'):saved['state'].pop(key,None)
        a=City.restore(copy.deepcopy(saved));b=City.restore(copy.deepcopy(saved))
        self.assertEqual(sum(r['count'] for r in a.s['migrationQueue']),99)
        self.assertEqual(a.snapshot(),b.snapshot())
        bad=a.snapshot();bad['state']['migrationQueue'][0]['count']+=1
        with self.assertRaises(ValueError):City.restore(bad)

    def test_replacement_and_extension_supply_are_counted_once(self):
        city,near,_=two_regions()
        complete(city,near[0],'office',30)
        complete(city,near[1],'residential',100)
        set_queue(city,30)
        city.s['renewals']=[dict(id='renew-test',status='planned',options={'mode':'onsite'},phases=[
            dict(status='planned',sourceIds=[near[1]['id']],sites=[dict(center=near[1]['center'],
                 targetBuilding={'use':'residential','capacity':12})])])]
        market=HousingMarket(city)
        self.assertEqual(market.summary()['committedCoverage'],12)
        self.assertEqual(market.gap(near[2]),18)
        city.s['renewals']=[]
        near[1]['building'].update(capacity=10,footprintArea=750,extensionReady=6,extensionFloors=1)
        market=HousingMarket(city)
        self.assertEqual(market.summary()['availableCoverage'],10)
        self.assertEqual(market.summary()['committedCoverage'],10)
        self.assertEqual(market.gap(near[2]),10)

    def test_transport_graph_requires_a_real_ride(self):
        from city.housing import Commutes
        city=SimpleNamespace(s={'policy':{'walkMaximumMinutes':35,'parkingMinutes':4}},graphs={
            'walk':{'home':[dict(to='job',time=45)]},'car':{},
            'public':{'home':[dict(to='job',time=45,kind='walk')]}})
        self.assertEqual(Commutes(city).minutes('home','job',False),float('inf'))
        city.graphs['public']['home'].append(dict(to='stop',time=5,kind='walk'))
        city.graphs['public']['stop']=[dict(to='job',time=10,kind='ride')]
        self.assertEqual(Commutes(city).minutes('home','job',False),15)
