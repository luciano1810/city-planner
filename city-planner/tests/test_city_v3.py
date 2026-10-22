"""Connected blocks, regional rail and controlled economic acceptance cases."""
import copy,json,unittest
from collections import Counter,defaultdict
from shapely.geometry import Polygon,LineString
from tests.test_city import City,flat_world,road,block_city
from city.planning import plan_streets,grow_block_streets
from city.regional import assign_freight
from city.geometry import building_footprint
from city.parameters import definitions
from city.development import select_projects,update_location_context,opportunity_fields
from city.urban import building_style
from city.engine import USES


def complete(city,p,use,capacity=20):
    shape=building_footprint(p,use)
    p['building']=dict(id=city.uid('b'),use=use,floors=2,floorArea=shape.area*2,footprintArea=shape.area,footprint=[list(q) for q in shape.exterior.coords],
        capacity=capacity,occupied=0,positions=capacity if use!='residential' else 0,employees=0,status='active',age=20,vacantMonths=0,cost=100000,**building_style(p,use,2))


class ConnectedGrowthTests(unittest.TestCase):
    def test_reserved_streets_make_loops_without_moving_existing_buildings(self):
        c=block_city();c.s['settings']['autoGrow']=True;c.rebuild(regenerate=True)
        plans=plan_streets(c);self.assertTrue(plans)
        c.step(5)
        # Street extension now waits for developed frontage rather than time
        # alone. Populate the reserved block without occupying its corridors.
        for p in c.s['parcels']:
            if not p.get('building') and not p.get('openSpace') and p['use']!='protected':complete(c,p,'residential')
        c.rebuild()
        before={p['id']:copy.deepcopy(p['building']['footprint']) for p in c.s['parcels'] if p.get('building')}
        original_blocks=len(c.network['blocks'])
        # Exercise subdivision explicitly: economic selection may now prefer
        # a higher-value outward street over a reserved internal connector.
        # The initial five months already cover the original market; a filled
        # block alone must not manufacture a reason to add another street.
        c.s['settings']['externalJobs']*=2
        c.s['month']+=c.s['policy']['laneGrowthIntervalMonths']
        self.assertTrue(grow_block_streets(c));c.rebuild(regenerate=True)
        self.assertGreater(len(c.network['blocks']),original_blocks)
        self.assertTrue(any(r.get('generated') for r in c.s['roads']))
        for p in c.s['parcels']:
            if p['id'] in before:self.assertEqual(before[p['id']],p['building']['footprint'])
        self.assertLess(c.s['geometryUpdate']['recomputedRoads'],c.s['geometryUpdate']['totalRoads'])
        a=City.restore(c.snapshot());b=City.restore(json.loads(json.dumps(c.snapshot())))
        a.step();b.step();self.assertEqual(a.snapshot(),b.snapshot())

    def test_local_edit_preserves_remote_parcel_identity_and_price(self):
        c=City(flat_world());road(c,[[400,800],[1600,800]]);road(c,[[2500,2800],[3600,2800]])
        remote={p['id']:copy.deepcopy(p) for p in c.s['parcels'] if p['center'][1]>2000}
        road(c,[[900,800],[900,1400]])
        for pid,old in remote.items():
            self.assertEqual(c.parcelmap[pid]['points'],old['points']);self.assertEqual(c.parcelmap[pid]['landValue'],old['landValue'])
        self.assertLess(c.s['geometryUpdate']['recomputedRoads'],c.s['geometryUpdate']['totalRoads'])

    def test_heavy_uses_assemble_real_land_without_overlaps(self):
        c=City(flat_world());c.s['settings']['autoGrow']=False;road(c,[[500,1500],[3000,1500]])
        for p in c.s['parcels']:p['use']='warehouse';p['freightTime']=1
        update_location_context(c);select_projects(c,USES,building_style)
        built=[p for p in c.s['parcels'] if p.get('building')]
        self.assertTrue(any(len(p.get('assembledFrom',[]))>=2 for p in built))
        for p in built:
            shape=Polygon(p['building']['footprint']);b=p['building']
            self.assertTrue(Polygon(p['points']).covers(shape))
            self.assertEqual(len(shape.exterior.coords),5)
            self.assertAlmostEqual(b['footprintArea'],shape.area,delta=.051)
            self.assertAlmostEqual(b['floorArea'],shape.area*b['floors'],delta=.051)
            self.assertEqual(b['capacity'],int(shape.area*b['floors']/USES[b['use']]['space']))
        polygons=[Polygon(p['points']) for p in c.s['parcels']]
        for i,p in enumerate(polygons):
            for q in polygons[i+1:]:self.assertLess(p.intersection(q).area,1)


class RegionalRailTests(unittest.TestCase):
    def setUp(self):
        c=self.city=City(flat_world());c.s['settings']['autoGrow']=False
        road(c,[[500,1600],[3800,1600]])
        self.rail=road(c,[[500,1500],[3800,1500]],'train',1)
        for role in ('passenger','freight'):
            for x,external in [(1200,False),(3800,True)]:
                c.command(dict(type='stop',mode='train',point=[x,1500],role=role,external=external,name=role))

    def test_external_passenger_journey_and_freight_separation(self):
        c=self.city;passenger=[s['id'] for s in c.s['stops'] if s['role']=='passenger'];freight=[s['id'] for s in c.s['stops'] if s['role']=='freight']
        with self.assertRaisesRegex(ValueError,'兼容'):c.command(dict(type='line',mode='train',stops=freight))
        c.command(dict(type='line',mode='train',stops=passenger,headway=2))
        p=min(c.s['parcels'],key=lambda p:abs(p['center'][0]-1200))
        journey=c.route(p['id'],passenger[1],False)
        self.assertIsNotNone(journey);self.assertEqual(journey['mainMode'],'train')
        self.assertEqual(c.route(p['id'],passenger[1],False,required_mode='train')['mainMode'],'train')
        c.command(dict(type='line_update',id=c.s['lines'][0]['id'],enabled=False))
        c.segment_load=defaultdict(float)
        self.assertIsNone(c.route(p['id'],passenger[1],False,allocate=True,required_mode='train'))
        self.assertFalse(c.segment_load)
        c.command(dict(type='stop_update',id=passenger[1],enabled=False))
        self.assertIsNone(c.route(p['id'],passenger[1],False))

    def test_freight_capacity_drays_cost_and_track_failure(self):
        c=self.city;ids=[s['id'] for s in c.s['stops'] if s['role']=='freight']
        c.command(dict(type='freight_service',start=ids[0],end=ids[1],trainsPerDay=1,tonnesPerTrain=10))
        p=min(c.s['parcels'],key=lambda p:abs(p['center'][0]-1200));complete(c,p,'industrial',capacity=100);p['building']['employees']=100
        c.rebuild();c.road_load=defaultdict(float)
        trips,km,flows=assign_freight(c)
        self.assertEqual(c.s['regionalFreight']['tonnes'],10)
        self.assertGreater(trips,0);self.assertGreater(km,0);self.assertTrue(any(f['mode']=='road' for f in flows))
        c.finance();self.assertGreater(c.s['operatingAccounts']['transitOperation'],0)
        c.command(dict(type='delete',id=self.rail))
        self.assertFalse(c.s['regionalServices'][0]['valid'])
        c.road_load=defaultdict(float);assign_freight(c);self.assertEqual(c.s['regionalFreight']['tonnes'],0)

    def test_boundary_and_role_validation(self):
        with self.assertRaisesRegex(ValueError,'边界'):self.city.command(dict(type='stop',mode='train',point=[2000,1500],external=True))
        with self.assertRaisesRegex(ValueError,'铁路'):self.city.command(dict(type='stop',mode='bus',point=[2000,1600],role='freight'))


class ControlledEconomyTests(unittest.TestCase):
    def test_reverse_accessibility_matches_directed_forward_search(self):
        c=City(flat_world());road(c,[[500,1000],[3000,1000]],oneway=True)
        employer=c.s['parcels'][-1];complete(c,employer,'office',50)
        fields=opportunity_fields(c,[employer],{},[])
        for p in c.s['parcels'][::7]:
            public=c.distances(p['id'],'public')[0].get(employer['id'],float('inf'))
            car=c.distances(p['id'],'car')[0].get(employer['id'],float('inf'))+4
            self.assertEqual(fields[p['id']]['jobs30'],50 if min(public,car)<=30 else 0)
            self.assertEqual(fields[p['id']]['publicJobs'],50 if public<=30 else 0)

    def test_bridge_changes_network_jobs_and_land_on_two_banks(self):
        c=City(flat_world(True));c.s['settings']['autoGrow']=False
        road(c,[[800,1600],[1750,1600]]);road(c,[[2250,1600],[3200,1600]])
        east=next(p for p in c.s['parcels'] if p['center'][0]>2600);complete(c,east,'office',200)
        c.rebuild();a=City.restore(c.snapshot());b=City.restore(c.snapshot())
        # New cross-level roads require the same explicit endpoint targets
        # produced by magnetic snapping in the editor.
        b.command(dict(type='road',level=1,points=[[1750,1600],[2250,1600]],snap=False,
                       connections=[dict(road=b.s['roads'][0]['id'],point=[1750,1600]),
                                    dict(road=b.s['roads'][1]['id'],point=[2250,1600])]))
        for branch in (a,b):
            for month in range(12):branch.s['month']+=1;branch.update_market()
        west=next(p['id'] for p in a.s['parcels'] if p['center'][0]<1400)
        self.assertEqual(a.parcelmap[west]['accessJobs'],0);self.assertEqual(b.parcelmap[west]['accessJobs'],200)
        self.assertGreater(b.parcelmap[west]['landValue'],a.parcelmap[west]['landValue'])

    def test_two_line_transfer_counts_one_complete_journey(self):
        c=City(flat_world());c.s['settings']['autoGrow']=False;c.s['settings']['fare']=0
        road(c,[[500,1800],[2000,1800]]);road(c,[[2000,1800],[2000,3500]])
        road(c,[[2000,1800],[2000,3500]],'metro',-1)
        for mode,points in [('bus',[[550,1800],[2000,1800]]),('metro',[[2000,1800],[2000,3450]])]:
            ids=[]
            for point in points:
                c.command(dict(type='stop',mode=mode,point=point));ids.append(c.s['stops'][-1]['id'])
            c.command(dict(type='line',mode=mode,stops=ids,headway=2))
        start=min(c.s['parcels'],key=lambda p:p['center'][0]);end=max(c.s['parcels'],key=lambda p:p['center'][1])
        trip=c.route(start['id'],end['id'],False)
        self.assertEqual(trip['mode'],'public');self.assertEqual(trip['transfers'],1)
        self.assertEqual(sum(e['kind']=='board' for e in trip['path']),2)

    def test_sustained_unaffordable_housing_causes_real_population_loss(self):
        c=block_city();c.step(12);self.assertTrue(c.s['households'])
        a=City.restore(c.snapshot());b=City.restore(c.snapshot())
        for branch in (a,b):branch.s['settings'].update(migration=0,growth=0)
        original=sum(h['size'] for h in c.s['households'])
        for h in a.s['households']:h['income']=20000
        for h in b.s['households']:h['income']=1000
        out=0
        for _ in range(10):
            for branch in (a,b):
                branch.s['month']+=1;branch.s['movedOut']=0
                for p in branch.s['parcels']:p['rent']=20
                branch.populate()
            out+=b.s['movedOut']
        self.assertGreater(len(a.s['households']),len(b.s['households']))
        self.assertEqual(original-sum(h['size'] for h in b.s['households']),out)

    def test_calibration_units_validation_and_persistence(self):
        c=block_city();self.assertTrue(all('unit' in v for v in definitions(c.s['policy']).values()))
        start,end=c.s['parcels'][0]['id'],c.s['parcels'][12]['id']
        slow=c.route(start,end,False)['minutes']
        c.command(dict(type='policy',values=dict(walkingMetersPerMinute=160)))
        self.assertLess(c.route(start,end,False)['minutes'],slow*.6)
        c.command(dict(type='policy',values=dict(parkingMinutes=9,priceMonthlyLimit=.04)))
        restored=City.restore(c.snapshot());self.assertEqual(restored.s['policy'],c.s['policy'])
        with self.assertRaises(ValueError):c.command(dict(type='policy',values=dict(trafficIterations=1000)))
        self.assertEqual(c.s['policy']['trafficIterations'],2)

if __name__=='__main__':unittest.main()
