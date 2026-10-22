"""Spatial coherence, demand-limited buildings, service catchments and CBD scale."""
import copy,datetime,math,unittest
from collections import Counter
from tests.test_city import City,flat_world,road,block_city
from tests.test_city_v3 import complete
from city.development import update_location_context,select_projects,desired_floors
from city.urban import building_style,grow_public_spaces,clustered_districts
from city.engine import USES,MODEL_VERSION
from city.parameters import ROAD_TYPES
from city.routing import shortest_paths
from city import construction
from shapely.geometry import Point,Polygon

class UrbanFormTests(unittest.TestCase):
    def test_office_cluster_affinity_and_height_gradient(self):
        c=City(flat_world());c.s['settings']['autoGrow']=False
        road(c,[[500,1800],[3500,1800]])
        sites=sorted(c.s['parcels'],key=lambda p:abs(p['center'][0]-1800))
        for p in sites[:3]:complete(c,p,'office',100)
        update_location_context(c)
        near=next(p for p in sites[3:] if abs(p['center'][0]-1800)<120)
        far=max(sites,key=lambda p:abs(p['center'][0]-1800))
        self.assertGreater(near['useAffinity']['office'],far['useAffinity'].get('office',0))
        self.assertGreater(near['businessCore'],far['businessCore'])
        c.s['settings']['externalJobs']=8000
        self.assertGreater(desired_floors(c,near,'office'),desired_floors(c,far,'office')+8)
        self.assertGreater(desired_floors(c,near,'office'),desired_floors(c,near,'residential')+8)
        self.assertLessEqual(desired_floors(c,near,'office'),near['terrain']['maxFloors'])

    def test_multiple_demand_limited_office_projects_instead_of_one_giant(self):
        c=block_city();c.s['settings']['externalJobs']=900
        for p in c.s['parcels']:p['use']='office'
        update_location_context(c);select_projects(c,USES,building_style)
        offices=[p['building'] for p in c.s['parcels'] if p.get('building')]
        self.assertGreaterEqual(len(offices),4)
        self.assertTrue(all(b['footprintArea']<=520.1 for b in offices))
        self.assertTrue(all(b['capacity']<=90 for b in offices))
        self.assertLess(sum(b['capacity'] for b in offices),550)

    def test_existing_occupied_offices_can_add_floors_before_new_projects(self):
        c=block_city();c.s['settings']['externalJobs']=900
        p=c.s['parcels'][0];complete(c,p,'office',40)
        p['building'].update(age=48,occupied=38,employees=38)
        p['businessCore']=1
        before=p['building']['floors'];c.develop()
        self.assertGreater(p['building'].get('extensionFloors',0),0)
        ready=p['building']['extensionCompletionDay'];extra=p['building']['extensionFloors']
        capacity=p['building']['capacity']
        self.assertEqual(p['building']['floors'],before)
        c.s['settings']['growth']=0
        date=construction.EPOCH+datetime.timedelta(days=ready-1)
        c.s['month']=(date.year-2026)*12+date.month-1
        c.s['simulation']['monthSeconds']=(date.day-1)*86400
        construction.advance(c)
        self.assertEqual(p['building']['floors'],before)
        self.assertEqual(p['building']['capacity'],capacity)
        c.s['simulation']['monthSeconds']+=86400
        construction.advance(c)
        self.assertEqual(p['building']['floors'],before+extra)
        self.assertGreater(p['building']['capacity'],capacity)
        self.assertNotIn('extensionCompletionDay',p['building'])
        construction.advance(c)
        self.assertEqual(p['building']['floors'],before+extra)

    def test_public_services_keep_distinct_catchments(self):
        c=block_city();c.s['settings']['autoGrow']=True
        homes=c.s['parcels'][::12][:12]
        for p in homes:complete(c,p,'residential',100)
        c.s['households']=[dict(home=p['id'],size=4) for p in homes for _ in range(100)]
        for _ in range(5):grow_public_spaces(c);c.rebuild()
        counts=Counter(f['kind'] for f in c.s['facilities'])
        self.assertEqual(counts['school'],2);self.assertEqual(counts['clinic'],1)
        for kind in counts:
            sites=[f for f in c.s['facilities'] if f['kind']==kind]
            for i,a in enumerate(sites):
                for b in sites[i+1:]:self.assertGreaterEqual(math.dist(a['point'],b['point']),c.s['policy'][kind+'Separation'])

    def test_large_office_among_houses_is_not_cbd(self):
        c=block_city();sites=[p for p in c.s['parcels'] if 800<p['center'][0]<1200 and 800<p['center'][1]<1200]
        self.assertGreater(len(sites),6)
        for p in sites:complete(c,p,'residential',20);p['accessJobs']=5000
        complete(c,sites[0],'office',3000);sites[0]['building'].update(employees=1800,floorArea=150000)
        for month in range(1,5):c.s['month']=month;clustered_districts(c)
        self.assertFalse(any(d['kind']=='CBD' for d in c.s['districts']))

    def test_v3_migration_preserves_existing_geometry_and_calibration(self):
        c=block_city();complete(c,c.s['parcels'][0],'residential')
        snap=c.snapshot();snap['model']=snap['state']['version']='shanhai-city-3';snap['state'].pop('growthCenters')
        snap['state']['policy']['walkingMetersPerMinute']=72
        restored=City.restore(copy.deepcopy(snap))
        self.assertEqual(restored.s['version'],MODEL_VERSION)
        self.assertEqual(restored.s['policy']['walkingMetersPerMinute'],72)
        self.assertEqual(restored.s['parcels'][0]['building']['footprint'],snap['state']['parcels'][0]['building']['footprint'])
        parameters=restored.view()['meta']['parameters']
        self.assertIn('parkResidents',parameters)
        self.assertNotIn('parkPerBuildings',parameters)
        self.assertNotIn('plazaPerBuildings',parameters)


class RoadGradeTests(unittest.TestCase):
    def test_draw_and_change_every_road_grade(self):
        c=City(flat_world());rid=road(c,[[500,1000],[3500,1000]],kind='lane')
        name=c.s['roads'][0]['name'];self.assertTrue(name)
        speeds=[];widths=[];capacities=[];times=[]
        for kind in ('lane','street','avenue','highway','motorway'):
            c.command(dict(type='road_update',id=rid,kind=kind))
            cfg=ROAD_TYPES[kind];speeds.append(cfg['speed']);widths.append(cfg['width']);capacities.append(cfg['capacity'])
            times.append(sum(e['freeTime'] for e in c.network['edges']))
            self.assertEqual(c.s['roads'][0]['kind'],kind)
            self.assertEqual(c.s['roads'][0]['name'],name)
            self.assertEqual(bool(c.s['parcels']),kind in ('lane','street','avenue'))
        self.assertEqual(speeds,sorted(set(speeds)));self.assertEqual(widths,sorted(set(widths)))
        self.assertEqual(capacities,sorted(set(capacities)));self.assertEqual(times,sorted(times,reverse=True))
        restored=City.restore(c.snapshot());self.assertEqual(restored.s['roads'][0]['kind'],'motorway')
        self.assertEqual(restored.s['roads'][0]['name'],name)
        restored.command(dict(type='road_update',id=rid,kind='lane'))
        self.assertGreater(len(restored.s['parcels']),0)

    def test_motorway_is_drivable_but_not_walkable_or_a_bus_stop(self):
        c=City(flat_world());road(c,[[500,1000],[3500,1000]],kind='motorway',oneway=True)
        e=c.network['edges'][0]
        self.assertIn(e['b'],shortest_paths(c.graphs['car'],e['a'])[0])
        self.assertNotIn(e['a'],shortest_paths(c.graphs['car'],e['b'])[0])
        self.assertNotIn(e['b'],shortest_paths(c.graphs['walk'],e['a'])[0])
        with self.assertRaisesRegex(ValueError,'兼容的道路'):
            c.command(dict(type='stop',mode='bus',point=[2000,1000],name='无法直接接驳'))
        self.assertEqual(c.s['stops'],[])
        road(c,[[500,1000],[500,1800]],kind='lane')
        target=next(e for e in c.network['edges'] if e['kind']=='lane')['b']
        # A one-way motorway cannot be traversed backwards to the local exit.
        self.assertNotIn(target,shortest_paths(c.graphs['car'],'road:0:3500.0:1000.0')[0])

    def test_upgrading_generated_lane_preserves_origin_and_rejects_land_conflict(self):
        c=City(flat_world());rid=road(c,[[500,1000],[3500,1000]],kind='lane')
        c.s['roads'][0].update(generated=True,parent='historic-main-road',name='自动社区支路')
        c.command(dict(type='road_update',id=rid,kind='street'))
        self.assertTrue(c.s['roads'][0]['generated']);self.assertEqual(c.s['roads'][0]['parent'],'historic-main-road')
        self.assertEqual(c.s['roads'][0]['name'],'自动社区支路')
        p=c.s['parcels'][0];p['use']='protected'
        before=c.snapshot()
        with self.assertRaisesRegex(ValueError,'保护用地'):
            c.command(dict(type='road_update',id=rid,kind='motorway'))
        self.assertEqual(c.snapshot(),before)

    def test_controlled_access_upgrade_removes_direct_building_access(self):
        c=City(flat_world());rid=road(c,[[500,1000],[3500,1000]])
        p=max(c.s['parcels'],key=lambda p:abs(p['center'][1]-1000));complete(c,p,'residential')
        shape=Point(p['center']).buffer(5,cap_style=3)
        self.assertTrue(Polygon(p['points']).covers(shape))
        p['building'].update(footprint=[list(v) for v in shape.exterior.coords],footprintArea=100,floorArea=200)
        pid=p['id'];footprint=copy.deepcopy(p['building']['footprint'])
        c.command(dict(type='road_update',id=rid,kind='motorway'))
        p=c.parcelmap[pid]
        self.assertEqual(p['building']['footprint'],footprint)
        self.assertFalse(p['connected']);self.assertIsNone(p['access'])
        self.assertFalse(c.graphs['walk'].get(pid));self.assertFalse(c.graphs['car'].get(pid))

if __name__=='__main__':unittest.main()
