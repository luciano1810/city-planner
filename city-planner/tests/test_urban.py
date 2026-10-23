"""Behavioral acceptance for terrain-driven autonomous cities and editing."""
import base64
import copy
import json
import tempfile
import unittest
from pathlib import Path
import sys

import numpy as np
from shapely.geometry import LineString, Polygon

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from city.engine import City,MODEL_VERSION
from city.geometry import Terrain,curve_points,building_footprint
from city.service import CityService
from city.urban import clustered_districts,update_entrances,observe_changes,aggregate_flows
from city.reporting import metric_definitions
from tests.test_city import flat_world,road,block_city
from height_format import encode_heights


def sloped_world():
    world=flat_world()
    elevation=np.tile(np.linspace(864,1152,80),(80,1))
    world['elevation']=encode_heights(elevation)
    return world


class TerrainAndCurveTests(unittest.TestCase):
    def test_curve_uses_real_geometry_cost_and_endpoints(self):
        city=City(flat_world())
        controls=[[500,600],[900,1200],[1600,900],[2100,1300]]
        preview=city.preview_road(dict(points=controls,shape='curve',kind='street'))
        self.assertTrue(preview['valid'])
        self.assertEqual(city.s['roads'],[])
        city.command(dict(type='road',points=controls,shape='curve',kind='street'))
        r=city.s['roads'][0]
        self.assertEqual(r['controls'],controls)
        self.assertEqual(r['points'][0],controls[0]);self.assertEqual(r['points'][-1],controls[-1])
        self.assertGreater(len(r['points']),20)
        self.assertAlmostEqual(r['length'],LineString(r['points']).length)
        self.assertGreater(r['length'],LineString(controls).length)
        self.assertEqual(r['constructionCost'],preview['road']['constructionCost'])
        before=copy.deepcopy(r)
        city.command(dict(type='road_edit',id=r['id'],points=[[500,600],[950,1300],[2100,1300]],shape='curve'))
        self.assertEqual(city.s['roads'][0]['id'],before['id'])
        self.assertNotEqual(city.s['roads'][0]['points'],before['points'])
        city.command(dict(type='undo'))
        self.assertEqual(city.s['roads'][0],before)

    def test_terrain_changes_cost_time_land_and_height_limit(self):
        flat,slope=City(flat_world()),City(sloped_world())
        for city in (flat,slope):
            city.s['settings']['autoGrow']=False
            road(city,[[600,1200],[2600,1200]])
            city.update_market()
        self.assertGreater(slope.s['roads'][0]['constructionCost'],flat.s['roads'][0]['constructionCost'])
        self.assertGreater(slope.s['roads'][0]['profile']['freeTime'],flat.s['roads'][0]['profile']['freeTime'])
        a,b=flat.s['parcels'][0],slope.s['parcels'][0]
        self.assertGreater(b['terrain']['slope'],a['terrain']['slope'])
        self.assertLess(b['terrain']['maxFloors'],a['terrain']['maxFloors'])
        # Prices have a monthly cap, so compare the actual terrain contribution.
        self.assertLess(b['priceDrivers']['terrainCost'],a['priceDrivers']['terrainCost'])
        self.assertGreater(b['terrain']['costFactor'],a['terrain']['costFactor'])

    def test_real_frontage_access_does_not_detour_to_road_ends(self):
        city=City(flat_world());road(city,[[500,1000],[3000,1000]])
        parcels=sorted([p for p in city.s['parcels'] if p['center'][1]>1000],key=lambda p:p['center'][0])
        a,b=parcels[4:6]
        route=city.route(a['id'],b['id'],False)
        self.assertIsNotNone(route)
        self.assertLess(route['minutes'],5)

    def test_invalid_road_preview_locates_first_terrain_conflict(self):
        city=City(flat_world(water=True))
        result=city.preview_road(dict(points=[[500,1000],[3500,1000]],kind='street'))
        self.assertFalse(result['valid']);self.assertIsNotNone(result['point'])
        sample=city.terrain.sample(result['point'])
        self.assertTrue(sample['water'] or sample['slope']>.42)
        self.assertLess(abs(result['point'][0]-2000),250)


class AutonomousCityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.city=City(flat_world())
        road(cls.city,[[800,1800],[2300,1800]])
        cls.city.step(8)

    def test_road_only_creates_lanes_public_spaces_and_entrances(self):
        city=self.city
        lanes=[r for r in city.s['roads'] if r.get('generated')]
        self.assertGreater(len(lanes),0)
        roadmap={r['id']:r for r in city.s['roads']}
        for lane in lanes:
            self.assertEqual(lane['kind'],'lane')
            seen={lane['id']};parent=lane['parent']
            while roadmap[parent].get('generated'):
                self.assertNotIn(parent,seen);seen.add(parent)
                parent=roadmap[parent]['parent']
            self.assertEqual(parent,city.s['roads'][0]['id'])
        self.assertTrue({'park','plaza'}<={f['kind'] for f in city.s['facilities']})
        self.assertTrue(all(f['connected'] for f in city.s['facilities']))
        self.assertGreater(len(city.s['localPaths']),0)
        self.assertGreater(city.s['stats']['population'],0)
        self.assertTrue(all(p['connected'] for p in city.s['parcels'] if p.get('building')))
        for p in city.s['parcels']:
            if p.get('building'):
                self.assertFalse(p.get('openSpace'))
                self.assertTrue(Polygon(p['points']).covers(Polygon(p['building']['footprint'])))
                self.assertLessEqual(p['building']['floors'],p['terrain']['maxFloors'])
                self.assertIn('form',p['building'])
        for i,p in enumerate(city.s['parcels']):
            for q in city.s['parcels'][i+1:]:
                self.assertLess(Polygon(p['points']).intersection(Polygon(q['points'])).area,1)

    def test_autogrowth_can_pause_and_does_not_cross_water(self):
        city=City(flat_world(water=True))
        road(city,[[1500,600],[1500,2500]])
        city.s['settings']['autoGrow']=False
        city.step(1)
        self.assertFalse(any(r.get('generated') for r in city.s['roads']))
        city.s['settings']['autoGrow']=True
        city.step(3)
        for r in city.s['roads']:
            city.terrain.valid_link(LineString(r['points']),r['kind'],r['level'])

    def test_growth_save_continuation_and_area_summary(self):
        original=City.restore(self.city.snapshot())
        restored=City.restore(json.loads(json.dumps(self.city.snapshot())))
        original.step();restored.step()
        self.assertEqual(original.snapshot(),restored.snapshot())
        result=original.query(dict(kind='area',bounds=[[0,0],[4000,4000]]))
        self.assertEqual(result['stats']['population'],original.s['stats']['population'])
        self.assertEqual(result['stats']['jobs'],original.s['stats']['jobs'])
        self.assertTrue(all(d['polygons'] for d in original.s['districts']))
        self.assertEqual(sum(d['population'] for d in original.s['districts']),original.s['stats']['population'])

    def test_legacy_save_migration_preserves_built_footprint(self):
        snapshot=self.city.snapshot();snapshot['model']='shanhai-city-1';snapshot['state']['version']='shanhai-city-1'
        for key in ('firms','localPaths','growthAttempts','districtCells','policy','annual'):
            snapshot['state'].pop(key,None)
        restored=City.restore(snapshot)
        self.assertEqual(restored.s['version'],MODEL_VERSION)
        self.assertIn('migrationNote',restored.s)
        a=next(p['building']['footprint'] for p in self.city.s['parcels'] if p.get('building'))
        b=next(p['building']['footprint'] for p in restored.s['parcels'] if p.get('building'))
        self.assertEqual(a,b)

    def test_old_save_keeps_unclassified_historical_construction(self):
        snapshot=self.city.snapshot();snapshot['state'].pop('capitalAccounts',None)
        restored=City.restore(snapshot)
        self.assertAlmostEqual(sum(restored.s['capitalAccounts'].values()),restored.s['constructionCost'])
        self.assertIn('历史建设（未分项）',restored.s['capitalAccounts'])

    def test_neighbourhood_walkways_are_real_graph_connections(self):
        city=City(flat_world());road(city,[[500,1000],[1800,1000]])
        parcels=sorted([p for p in city.s['parcels'] if p['center'][1]>1000],key=lambda p:p['center'][0])
        for p in parcels[:3]:
            shape=building_footprint(p,'residential')
            p['building']=dict(footprint=[list(q) for q in shape.exterior.coords],use='residential',status='active')
        update_entrances(city);city.build_graphs()
        paths=[p for p in city.s['localPaths'] if p['kind']=='neighbourhood']
        self.assertTrue(paths)
        for path in paths:
            self.assertTrue(any(e['to']==path['target'] and e['ref']==path['id'] for e in city.graphs['walk'][path['parcel']]))
            self.assertTrue(city.terrain.buildable(LineString(path['points']).buffer(.8),.25))

    def test_rejects_corrupt_occupancy_and_queries_station_access(self):
        snapshot=self.city.snapshot();snapshot['state']['households'][0]['job']='missing'
        with self.assertRaisesRegex(ValueError,'岗位'): City.restore(snapshot)
        city=City.restore(self.city.snapshot())
        city.command(dict(type='stop',mode='bus',point=[1300,1800],name='网络查询站'))
        result=city.query(dict(kind='isochrone',source=city.s['stops'][0]['id'],mode='walk',minutes=30))
        self.assertGreater(result['stats']['buildings'],0)

    def test_sustained_events_have_cooldown(self):
        city=City.restore(self.city.snapshot());city.s['events']=[]
        city.s['stats'].update(vacancy=60,housing=100,congestion=0)
        for month in range(100,110):
            city.s['month']=month;observe_changes(city)
        self.assertEqual(sum(e['category']=='空置' for e in city.s['events']),1)

    def test_reporting_and_accounts_reconcile_with_authoritative_state(self):
        city=City.restore(self.city.snapshot())
        definitions=metric_definitions(city.s['stats'],MODEL_VERSION)
        self.assertEqual(set(definitions),set(city.s['stats']))
        self.assertEqual(sum(f['people'] for f in aggregate_flows(city)),len(city.trips))
        self.assertAlmostEqual(sum(city.s['capitalAccounts'].values()),city.s['constructionCost'])
        self.assertEqual({row['period'] for row in city.s['accessibilityGroups']},{'am','pm','off'})
        for kind,field in [('in','movedIn'),('out','movedOut'),('relocation','relocated')]:
            self.assertEqual(sum(f['people'] for f in city.s['migrationFlows'] if f['kind']==kind),city.s[field])
        for district in city.s['districts']:
            shares=[v for v in district['modeShare'].values() if v is not None]
            if shares: self.assertAlmostEqual(sum(shares),100)

    def test_station_maintenance_and_interrupted_line_location(self):
        city=City(flat_world());road(city,[[500,1000],[3300,1000]])
        for x in (600,3000): city.command(dict(type='stop',point=[x,1000],mode='bus',name='车站'))
        city.command(dict(type='line',stops=[s['id'] for s in city.s['stops']],mode='bus'))
        city.finance()
        self.assertGreater(city.s['operatingAccounts']['stationMaintenance'],0)
        city.command(dict(type='stop_update',id=city.s['stops'][0]['id'],enabled=False))
        self.assertFalse(city.s['lines'][0]['valid']);self.assertTrue(city.s['lines'][0]['breakPoints'])

    def test_centers_reflect_delivered_activity_and_can_have_subcenter(self):
        city=block_city()
        for p in city.s['parcels']:
            if p['center'][0]<850 or p['center'][0]>1550:
                p['building']=dict(use='office',status='active',floorArea=5000,age=30,positions=200,employees=150)
                p['accessJobs']=600
        clustered_districts(city)
        first=copy.deepcopy(city.s['districts'])
        clustered_districts(city)
        self.assertEqual([(d['id'],d['kind'],d['name']) for d in first],
                         [(d['id'],d['kind'],d['name']) for d in city.s['districts']])
        centers=[d for d in city.s['districts'] if d['kind']=='CBD']
        self.assertGreaterEqual(len(centers),2)
        self.assertTrue(any(d.get('centerRank',0)>1 for d in centers))
        self.assertEqual(len({d['name'] for d in centers}),len(centers))
        for p in city.s['parcels']:
            if p.get('building'): p['building'].update(use='residential',positions=0,floors=30)
        for month in (4,5,6):
            city.s['month']=month;clustered_districts(city)
        self.assertFalse(any(d['kind']=='CBD' for d in city.s['districts']))

    def test_single_large_office_is_not_a_cbd(self):
        city=block_city();p=city.s['parcels'][0]
        p['building']=dict(use='office',status='active',floorArea=20000,age=30,positions=800,employees=500)
        p['accessJobs']=1000
        for month in (1,2,3,4):
            city.s['month']=month;clustered_districts(city)
        self.assertFalse(any(d['kind']=='CBD' for d in city.s['districts']))

    def test_comparison_reports_conditions_and_isolates_branches(self):
        with tempfile.TemporaryDirectory() as folder:
            service=CityService(folder)
            key=service.handle('import',dict(snapshot=self.city.snapshot()))['id']
            branch=service.handle('branch',dict(id=key,name='方案乙'))
            service.handle('save',dict(id=key,name='对照'))
            result=service.handle('compare',dict(id=branch['id'],name='对照'))
            self.assertEqual(result['warnings'],[])
            self.assertEqual(result['deltas']['population'],0)
            service.handle('command',dict(id=branch['id'],command=dict(type='settings',values={'fare':0})))
            self.assertNotEqual(service.cities[key].s['settings']['fare'],service.cities[branch['id']].s['settings']['fare'])
            self.assertIn('区域情景参数不同',service.handle('compare',dict(id=branch['id'],name='对照'))['warnings'])


if __name__=='__main__': unittest.main()
