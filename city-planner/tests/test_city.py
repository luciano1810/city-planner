"""Behavioral city regression suite: geometry, conservation, transit and recovery."""
import base64
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np
from shapely.geometry import Polygon

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from height_format import HEIGHT_ENCODING, encode_heights
from city.engine import City
from city.geometry import Terrain, make_network, building_footprint
from city.routing import shortest_paths
from city.service import CityService


def flat_world(water=False):
    n=80
    height=np.full((n,n),864,dtype=np.float32)
    if water:
        height[:,38:42]=-720
    elevation=encode_heights(height)
    empty=encode_heights(np.full((n,n),-np.inf,dtype='<f4'),water=True)
    encode=lambda a:base64.b64encode(a.tobytes()).decode()
    return dict(width=n,height=n,heightEncoding=HEIGHT_ENCODING,config=dict(seed='city-regression',widthKm=4,heightKm=4,preset='hills',sea=20),
                grid=dict(widthMeters=4000,heightMeters=4000,seaLevelMeters=0,verticalDatum='local',elevationUnit='m',
                          pixelSizeMeters=[50,50]),channels=[],
                elevation=elevation,water=empty,moisture=encode(np.zeros((n,n),dtype='u1')),
                waterBodies=dict(ocean=encode(np.packbits(height<0)),lakes=encode(np.zeros(n*n//8,dtype='u1'))),
                stats=dict(maxElevation=864,landPercent=100,generationMs=0,riverCount=0,lakeCount=0))


def road(city,points,kind='street',level=0,oneway=False):
    city.command(dict(type='road',points=[list(p) for p in points],kind=kind,level=level,oneway=oneway))
    return city.s['roads'][-1]['id']


def block_city():
    city=City(flat_world())
    city.s['settings']['autoGrow']=False
    for points in [((600,600),(1800,600)),((1800,600),(1800,1800)),((1800,1800),(600,1800)),
                   ((600,1800),(600,600)),((600,1200),(1800,1200)),((1200,600),(1200,1800))]:
        road(city,points)
    return city


class NetworkTests(unittest.TestCase):
    def test_frontage_stable_and_closed_blocks(self):
        city=City(flat_world())
        road(city,[(500,1000),(1500,1000)])
        first={p['id']:p['points'] for p in city.s['parcels']}
        self.assertGreater(len(first),20)
        road(city,[(2500,2500),(3500,2500)])
        for p in city.s['parcels']:
            if p['id'] in first:
                self.assertEqual(first[p['id']],p['points'])
        polys=[Polygon(p['points']) for p in city.s['parcels']]
        for i,p in enumerate(polys):
            for q in polys[i+1:]:
                self.assertLess(p.intersection(q).area,1)
        self.assertGreater(len(block_city().network['blocks']),0)

    def test_crossings_and_overpasses(self):
        city=City(flat_world())
        road(city,[(500,1000),(1500,1000)])
        road(city,[(1000,500),(1000,1500)])
        center='road:0:1000.0:1000.0'
        self.assertEqual(sum(e['a']==center or e['b']==center for e in city.network['edges']),4)
        p1=min(city.s['parcels'],key=lambda p:p['center'][0])
        p2=max(city.s['parcels'],key=lambda p:p['center'][1])
        self.assertIsNotNone(city.route(p1['id'],p2['id']))
        bridge=City(flat_world())
        road(bridge,[(500,1000),(1500,1000)])
        road(bridge,[(1000,500),(1000,1500)],level=1)
        self.assertEqual(sum(e['level']==1 for e in bridge.network['edges']),1)
        a=bridge.network['edges'][0]['a']
        b=next(e for e in bridge.network['edges'] if e['level']==1)['b']
        self.assertNotIn(b,shortest_paths(bridge.graphs['car'],a)[0])

    def test_water_requires_structure(self):
        city=City(flat_world(water=True))
        with self.assertRaisesRegex(ValueError,'水面|坡度'):
            road(city,[(1000,1000),(3000,1000)])
        self.assertEqual(city.s['roads'],[])
        road(city,[(1000,1000),(3000,1000)],level=1)
        self.assertEqual(len(city.s['roads']),1)
        self.assertEqual(city.s['parcels'],[])

    def test_oneway_and_no_walk_on_highway(self):
        city=City(flat_world())
        road(city,[(500,500),(1500,500)],kind='highway',oneway=True)
        e=city.network['edges'][0]
        self.assertIn(e['b'],shortest_paths(city.graphs['car'],e['a'])[0])
        self.assertNotIn(e['a'],shortest_paths(city.graphs['car'],e['b'])[0])
        self.assertNotIn(e['b'],shortest_paths(city.graphs['walk'],e['a'])[0])

    def test_transaction_revision_and_undo(self):
        city=City(flat_world())
        original=city.snapshot()
        with self.assertRaises(ValueError):
            road(city,[(500,500),(501,501)])
        self.assertEqual(city.snapshot(),original)
        road(city,[(500,500),(1500,500)])
        with self.assertRaisesRegex(ValueError,'更新'):
            city.command(dict(type='delete',id=city.s['roads'][0]['id'],revision=0))
        city.command(dict(type='undo'))
        self.assertEqual(city.s['roads'],[])
        city.command(dict(type='redo'))
        self.assertEqual(len(city.s['roads']),1)
        city.step()
        self.assertFalse(city.undo)


class SimulationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.city=block_city()
        cls.city.step(12)
        cls.saved=cls.city.snapshot()

    def test_real_growth_and_conservation(self):
        city=self.city
        self.assertGreater(city.s['stats']['population'],0)
        self.assertGreater(city.s['stats']['employed'],0)
        self.assertGreater(city.s['stats']['buildings'],0)
        self.assertEqual(city.s['stats']['population'],sum(h['size'] for h in city.s['households']))
        homes={p['id']:p for p in city.s['parcels']}
        occupied={}
        employed={}
        for h in city.s['households']:
            occupied[h['home']]=occupied.get(h['home'],0)+1
            if h['job']:
                employed[h['job']]=employed.get(h['job'],0)+1
        for hid,n in occupied.items():
            self.assertLessEqual(n,homes[hid]['building']['capacity'])
            self.assertNotEqual(homes[hid]['building']['status'],'construction')
        for pid,n in employed.items():
            self.assertLessEqual(n,homes[pid]['building']['positions'])
        previous=0
        for row in city.s['history']:
            self.assertEqual(row['population'],previous+row['movedIn']-row['movedOut'])
            previous=row['population']

    def test_construction_does_not_create_people(self):
        city=block_city()
        city.step()
        self.assertGreater(city.s['stats']['construction'],0)
        self.assertEqual(city.s['stats']['population'],0)
        self.assertEqual(city.s['stats']['housing'],0)

    def test_buildings_vary_in_actual_area_and_stay_inside_lots(self):
        city=self.city
        areas=[]
        for p in city.s['parcels']:
            b=p.get('building')
            if not b:
                continue
            footprint=Polygon(b['footprint'])
            areas.append(round(footprint.area))
            self.assertLess(footprint.difference(Polygon(p['points'])).area,.001)
            self.assertAlmostEqual(b['floorArea'],footprint.area*b['floors'],delta=.11)
            self.assertAlmostEqual(b['footprintArea'],footprint.area,delta=.06)
        self.assertGreater(len(set(areas)),len(areas)*.75)
        self.assertGreater(max(areas)/min(areas),1.5)
        lots=city.s['parcels'][:20]
        # Dense street housing can cover a similar fraction of an equal lot.
        # Industrial assembly must still produce genuinely larger buildings.
        housing=[p['building']['footprintArea'] for p in city.s['parcels'] if p.get('building') and p['building']['use']=='residential']
        warehouses=[p['building']['footprintArea'] for p in city.s['parcels'] if p.get('building') and p['building']['use']=='warehouse']
        self.assertTrue(housing and warehouses)
        self.assertGreater(sum(warehouses)/len(warehouses),sum(housing)/len(housing)*1.25)
        self.assertEqual(building_footprint(lots[0],'office').wkt,
                         building_footprint(lots[0],'office').wkt)

    def test_vacancy_accumulates_and_committed_extension_finishes(self):
        city=City.restore(self.saved)
        p=next(p for p in city.s['parcels'] if p.get('building') and p['building']['use']=='residential')
        city.s['households']=[h for h in city.s['households'] if h['home']!=p['id']]
        b=p['building']
        b.update(status='vacant',vacantMonths=23,occupied=0)
        city.update_market()
        self.assertEqual(b['vacantMonths'],24)
        b.update(status='active',extensionReady=city.s['month'],age=40)
        floors=b['floors']
        area=b['floorArea']
        city.s['settings']['growth']=0
        city.develop()
        self.assertEqual(b['floors'],floors+1)
        self.assertAlmostEqual(b['floorArea'],area/floors*(floors+1),delta=.1)

    def test_save_continuation_deterministic(self):
        a=City.restore(json.loads(json.dumps(self.saved)))
        b=City.restore(json.loads(json.dumps(self.saved)))
        a.step(3); b.step(3)
        self.assertEqual(a.snapshot(),b.snapshot())
        live=City.restore(self.saved)
        live.step()
        restored=City.restore(json.loads(json.dumps(live.snapshot())))
        live.step(); restored.step()
        self.assertEqual(live.snapshot(),restored.snapshot())

    def test_road_demolition_breaks_access_not_building(self):
        city=City.restore(self.saved)
        p=next(p for p in city.s['parcels'] if p.get('building'))
        building=copy.deepcopy(p['building'])
        city.command(dict(type='delete',id=p['road']))
        orphan=city.parcelmap[p['id']]
        self.assertFalse(orphan['connected'])
        self.assertEqual(orphan['building']['id'],building['id'])
        self.assertIsNone(city.route(p['id'],next(q['id'] for q in city.s['parcels'] if q['id']!=p['id'])))

    def test_price_rent_and_supply_are_distinct(self):
        self.assertTrue(all(p['landValue']>0 and p['rent']>0 for p in self.city.s['parcels']))
        self.assertTrue(any(p['landValue']!=p['rent'] for p in self.city.s['parcels']))
        for p in self.city.s['parcels']:
            self.assertEqual(len(p['history']),12)
            history=p['history']
            for a,b in zip(history,history[1:]):
                self.assertLessEqual(abs(b['land']-a['land']),a['land']*.071+.02)

    def test_protected_land_and_budget(self):
        city=block_city()
        for p in city.s['parcels']:
            p['use']='protected'
        city.step(3)
        self.assertEqual(city.s['stats']['buildings'],0)
        city.s['settings']['budget']=True
        city.s['treasury']=0
        with self.assertRaisesRegex(ValueError,'预算'):
            road(city,[(2500,2500),(3500,2500)])

    def test_corrupt_import_rejected(self):
        bad=copy.deepcopy(self.saved)
        bad['state']['households'][0]['home']='nonexistent'
        with self.assertRaises(ValueError):
            City.restore(bad)
        bad=copy.deepcopy(self.saved)
        bad['model']='future'
        with self.assertRaises(ValueError):
            City.restore(bad)


class TransitTests(unittest.TestCase):
    def transit_city(self,mode='bus'):
        city=City(flat_world())
        road(city,[(200,1000),(3800,1000)],kind='avenue')
        if mode!='bus':
            road(city,[(200,1050),(3800,1050)],kind=mode,level=-1 if mode=='metro' else 0)
        y=1000 if mode=='bus' else 1050
        stops=[]
        for x in (250,1950,3750):
            city.command(dict(type='stop',mode=mode,name=f'{x}站',point=[x,y]))
            stops.append(city.s['stops'][-1]['id'])
        homes=sorted(city.s['parcels'],key=lambda p:p['center'][0])
        return city,stops,homes[0]['id'],homes[-1]['id']

    def test_four_modes_infrastructure_service_and_headway(self):
        for mode in ('bus','metro','tram','train'):
            with self.subTest(mode=mode):
                city,stops,a,b=self.transit_city(mode)
                self.assertIsNone(city.route(a,b,False))
                city.command(dict(type='line',name='测试线',mode=mode,stops=stops,headway=10))
                result=city.route(a,b,False)
                self.assertIsNotNone(result)
                self.assertEqual(result['mode'],'public')
                self.assertEqual(sum(e['kind']=='board' for e in result['path']),1)
                fast=result['minutes']
                line=city.s['lines'][0]
                fleet=line['fleet']
                city.command(dict(type='line_update',id=line['id'],headway=18))
                slow=city.route(a,b,False)
                self.assertGreater(slow['minutes'],fast)
                self.assertLessEqual(city.s['lines'][0]['fleet'],fleet)
                city.command(dict(type='line_update',id=line['id'],enabled=False))
                self.assertIsNone(city.route(a,b,False))

    def test_capacity_and_no_phantom_transfer(self):
        city,stops,a,b=self.transit_city()
        city.command(dict(type='line',name='容量测试',mode='bus',stops=stops,headway=10,capacity=10))
        from collections import defaultdict
        city.segment_load=defaultdict(float); city.road_load=defaultdict(float)
        for key,seg in city.line_segments.items():
            city.segment_load[('am',key)]=seg['capacity']
        self.assertIsNone(city.route(a,b,False,allocate=True))
        result=city.route(a,b,True,allocate=True)
        self.assertEqual(result['mode'],'car')

    def test_deleted_track_invalidates_service(self):
        city,stops,a,b=self.transit_city('metro')
        city.command(dict(type='line',name='地铁测试',mode='metro',stops=stops))
        rail=next(r for r in city.s['roads'] if r['kind']=='metro')
        city.command(dict(type='delete',id=rail['id']))
        self.assertFalse(city.s['lines'][0]['valid'])
        self.assertIsNone(city.route(a,b,False))

    def test_facility_requires_actual_access(self):
        city=City(flat_world())
        road(city,[(200,1000),(1500,1000)])
        city.command(dict(type='facility',kind='school',point=[800,1060]))
        self.assertTrue(city.s['facilities'][0]['connected'])
        city.command(dict(type='facility',kind='park',point=[3000,3000]))
        self.assertFalse(city.s['facilities'][1]['connected'])


class PersistenceTests(unittest.TestCase):
    def test_atomic_save_load_branch_and_path_validation(self):
        with tempfile.TemporaryDirectory() as folder:
            service=CityService(folder)
            world=service.register(flat_world())
            result=service.handle('create',dict(worldId=world))
            key=result['id']
            service.handle('command',dict(id=key,command=dict(type='road',points=[[500,500],[1500,500]])))
            service.handle('step',dict(id=key,months=1))
            service.handle('save',dict(id=key,name='原方案'))
            saved=service.handle('saves',{})['saves']
            self.assertEqual(len(saved), 2)
            self.assertIn('原方案', {s['name'] for s in saved})
            self.assertEqual(sum(s['name'].startswith('自动保存 ') for s in saved), 1)
            loaded=service.handle('load',dict(name='原方案'))
            self.assertEqual(loaded['city']['stats'],service.cities[key].s['stats'])
            fresh=service.handle('create',dict(worldId=loaded['terrain']['worldId']))
            self.assertEqual(fresh['city']['roads'],[])
            original_roads = len(service.cities[key].s['roads'])
            branch=service.handle('branch',dict(id=key,name='分支'))
            service.handle('command',dict(id=branch['id'],command=dict(type='delete',id=branch['city']['roads'][0]['id'])))
            self.assertEqual(len(service.cities[key].s['roads']),original_roads)
            with self.assertRaises(ValueError):
                service.handle('save',dict(id=key,name='../outside'))


if __name__=='__main__':
    unittest.main()
