"""Waiting households, construction credit and actionable development diagnostics."""
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from tests.test_city import City, flat_world, block_city
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
        self.assertEqual(development_targets(city)['residential'],40+240+24)

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
        with patch('city.development.development_targets',return_value={u:0 for u in ('residential','commercial','office','industrial','warehouse')}):city.develop()
        self.assertTrue(all('需求未达' in p['developmentReason'] for p in city.s['parcels']))
        self.assertFalse(any('名额已用尽' in p['developmentReason'] for p in city.s['parcels']))

    def test_full_pipeline_can_pause_building_despite_discounted_shortfall(self):
        city=block_city()
        for p in city.s['parcels']:p['use']='residential'
        uses=('residential','commercial','office','industrial','warehouse')
        def supply(_city,*,housing_credit=1.):
            return {u:(200*housing_credit if u=='residential' else 0) for u in uses}
        with patch('city.development.planned_supply',side_effect=supply), patch('city.development.development_targets',return_value={u:(140 if u=='residential' else 0) for u in uses}):
            city.develop()
        self.assertEqual(city.s['housingDemand']['started'],0)
        self.assertTrue(all('未来两个月' in p['developmentReason'] for p in city.s['parcels']))
