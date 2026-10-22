"""Distance-sensitive, conserved economic demand and actual development."""
import copy
import math
import unittest
from types import SimpleNamespace
from tests.test_growth_centers import towns, settle
from city.business import BusinessMarket, workplace_supply
from city.parameters import POLICY
from city.development import select_projects, update_location_context
from city.urban import building_style, update_firms
from city.engine import USES


def catchment(minutes=30, car=False):
    home=dict(id='home',center=[0,0],connected=True,building=dict(use='residential',status='active',capacity=100))
    far=dict(id='far',center=[1000,0],connected=True,building=dict(use='commercial',status='active',capacity=10000))
    near=dict(id='near',center=[50,0],connected=True,building=None)
    walk={'home':[dict(to='near',time=1,kind='walk')]}
    if math.isfinite(minutes):walk['home'].append(dict(to='far',time=minutes,kind='walk'))
    city=SimpleNamespace(s=dict(policy=dict(POLICY,commercialBaseDemand=0,warehouseBaseDemand=0),
        settings=dict(externalJobs=0),month=0,renewals=[],parcels=[home,far,near],
        households=[dict(home='home',car=car,size=100)]),graphs=dict(walk=walk,public=copy.deepcopy(walk),car={}),
        parcelmap={p['id']:p for p in (home,far,near)})
    return city,home,far,near


class SpatialDemandTests(unittest.TestCase):
    def test_distance_increases_local_gap_continuously_without_center_threshold(self):
        gaps=[]
        for t in (1,5,10,20,30,60):
            city,home,far,near=catchment(t);market=BusinessMarket(city)
            gaps.append(market.gap(near,'commercial'))
            self.assertLessEqual(market.shortage('commercial'),market.totals['commercial'])
        self.assertEqual(gaps,sorted(gaps));self.assertGreater(gaps[-1],14)
        city,_,_,near=catchment(15);left=BusinessMarket(city).gap(near,'commercial')
        city,_,_,near=catchment(15.001);right=BusinessMarket(city).gap(near,'commercial')
        self.assertGreater(right,left);self.assertLess(right-left,.01)

    def test_unlimited_remote_floor_area_cannot_erase_local_need(self):
        city,_,far,near=catchment(60)
        first=BusinessMarket(city).gap(near,'commercial')
        far['building']['capacity']=10**9
        self.assertEqual(BusinessMarket(city).gap(near,'commercial'),first)

    def test_transit_and_car_access_reduce_gap_but_road_does_not_help_carless_households(self):
        city,_,_,near=catchment(60)
        before=BusinessMarket(city).gap(near,'commercial')
        city.graphs=dict(city.graphs,car={'home':[dict(to='far',time=1)]})
        self.assertEqual(BusinessMarket(city).gap(near,'commercial'),before)
        city.s['households'][0]['car']=True
        self.assertLess(BusinessMarket(city).gap(near,'commercial'),before/5)
        city.s['households'][0]['car']=False
        city.graphs=dict(city.graphs,public={'home':[dict(to='far',time=3,kind='ride'),dict(to='near',time=1,kind='walk')]})
        self.assertLess(BusinessMarket(city).gap(near,'commercial'),before/10)

    def test_disconnected_supply_cannot_cover_local_demand(self):
        city,_,_,near=catchment(math.inf)
        market=BusinessMarket(city)
        self.assertAlmostEqual(market.gap(near,'commercial'),15*math.exp(-.5/225))

    def test_overlapping_candidates_and_reservations_share_one_budget(self):
        city,home,far,near=catchment(60);market=BusinessMarket(city)
        union=market.demand_for([near,home],'commercial')
        self.assertLess(union,market.gap(near,'commercial')+market.gap(home,'commercial'))
        gap=market.gap(near,'commercial');market.reserve(near,'commercial',gap+1)
        self.assertAlmostEqual(market.gap(near,'commercial'),0)
        after=sum(market.allocations['commercial'].values())
        market.reserve(near,'commercial',10000)
        self.assertAlmostEqual(sum(market.allocations['commercial'].values()),after)
        self.assertLessEqual(after,market.totals['commercial'])

    def test_construction_extension_and_renewal_supply_reserved_once(self):
        city,home,far,near=catchment(60)
        near['building']=dict(use='commercial',status='construction',capacity=5)
        unfinished=BusinessMarket(city).gap(near,'commercial')
        near['building']['status']='active'
        self.assertEqual(BusinessMarket(city).gap(near,'commercial'),unfinished)
        near['building'].update(extensionReady=8,extensionFloors=1,footprintArea=5*USES['commercial']['space'])
        self.assertAlmostEqual(BusinessMarket(city).gap(near,'commercial'),unfinished-5)
        city.s['renewals']=[dict(id='r',status='waiting',options=dict(mode='onsite'),phases=[dict(status='waiting',sourceIds=['near'],
            sites=[dict(center=near['center'],targetBuilding=dict(use='commercial',capacity=8))])])]
        rows=workplace_supply(city)
        self.assertEqual(sum(r['capacity'] for r in rows if r['parcel']['id']=='near'),8)
        self.assertAlmostEqual(BusinessMarket(city).gap(near,'commercial'),unfinished-3)

    def test_external_demand_and_integer_positions_are_not_multiplied_by_building_count(self):
        city,home,far,near=catchment();city.s['households']=[];city.s['settings']['externalJobs']=90
        for p in (far,near):p['building']=dict(use='office',capacity=100,status='active')
        market=BusinessMarket(city,kind='jobs',supply=workplace_supply(city,planned=False))
        self.assertEqual(sum(market.positions().values()),36)
        self.assertAlmostEqual(sum(market.external_allocations['office'].values()),36)
        city.s['settings']['externalJobs']=1
        self.assertEqual(sum(BusinessMarket(city,kind='jobs',supply=workplace_supply(city,planned=False)).positions().values()),0)

    def test_builds_in_remote_neighbourhood_despite_citywide_oversupply(self):
        city,a,b=towns();settle(city,a,10);settle(city,b,80)
        city.s['settings'].update(externalJobs=0,maxProjects=1)
        a[0]['building'].update(use='commercial',capacity=10000)
        update_location_context(city)
        for p in city.s['parcels']:
            if not p.get('building'):p['use']='protected'
        for p in (a[4],b[4]):p.update(use='commercial',landValue=20)
        market=BusinessMarket(city)
        self.assertGreater(market.gap(b[4],'commercial'),30)
        self.assertGreater(sum(p['building']['capacity'] for p in a if p.get('building')),market.totals['commercial'])
        select_projects(city,USES,building_style)
        self.assertEqual(b[4]['building']['use'],'commercial')
        self.assertIsNone(a[4].get('building'))

    def test_jobs_and_firm_local_revenue_follow_customers_not_global_building_count(self):
        city,a,b=towns();settle(city,b,80)
        city.s['settings']['externalJobs']=0
        for p in (a[0],b[0]):p['building'].update(use='commercial',capacity=500)
        city.match_jobs();update_firms(city)
        self.assertGreater(b[0]['building']['positions'],0)
        self.assertGreater(b[0]['building']['positions'],a[0]['building']['positions'])
        firms={f['parcel']:f for f in city.s['firms']}
        self.assertGreater(firms[b[0]['id']]['localDemand'],firms[a[0]['id']]['localDemand'])

    def test_center_labels_do_not_change_demand_or_job_allocations(self):
        city,a,b=towns();settle(city,b,30)
        before=BusinessMarket(city)
        jobs=BusinessMarket(city,kind='jobs',supply=workplace_supply(city,planned=False)).positions()
        city.s['growthCenters']=[dict(point=[0,0],strength=1000,rank=1)]*20
        after=BusinessMarket(city)
        self.assertEqual(before.totals,after.totals)
        self.assertEqual(before.gap(b[4],'commercial'),after.gap(b[4],'commercial'))
        self.assertEqual(BusinessMarket(city,kind='jobs',supply=workplace_supply(city,planned=False)).positions(),jobs)


if __name__=='__main__':unittest.main()
