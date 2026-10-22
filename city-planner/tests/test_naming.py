"""Place identity survives rebuilds, migration, undo and district changes."""
import copy
import json
import random
import re
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from city import naming, place_regions
from city.geometry import Terrain
from height_format import encode_heights
import numpy as np
from city.engine import City
from tests.test_city import flat_world


def sample(seed='naming-test'):
    state=dict(roads=[dict(id=f'r-{i}',kind='street',name='普通路') for i in range(25)],
               facilities=[dict(id=f'f-{i}',kind=kind) for i,kind in enumerate(naming.FACILITY_SUFFIXES)],
               stops=[dict(id='s-1',mode='bus',name='新站')],lines=[dict(id='l-1',mode='bus',name='巴士线')],
               regionalServices=[dict(id='freight-1',name='区域货运')],
               blockLayouts=[dict(id='block-1')],districts=[dict(id='d-1',kind='居住区')],
               parcels=[dict(id=f'p-{i}',block='block-1',building=dict(use=use)) for i,use in enumerate(naming.BUILDING_SUFFIXES)])
    return SimpleNamespace(s=state,terrain=SimpleNamespace(data={'config':{'seed':seed}}),rng=random.Random(seed))


class NamingTests(unittest.TestCase):

    def regional_city(self, world=None):
        city = sample()
        city.terrain = Terrain(world or flat_world())
        city.s['roads'] = [dict(id='r-local', kind='street', points=[[550,600],[750,600]])]
        city.s['facilities'] = [dict(id='f-local', kind='school', point=[650,600])]
        city.s['parcels'] = [dict(id='p-local', center=[650,600], building=dict(use='commercial'))]
        city.s['blockLayouts'] = []
        city.s['districts'] = []
        return city

    def test_local_roads_shops_and_facilities_keep_region_identity(self):
        city = self.regional_city()
        state = city.rng.getstate()
        naming.ensure_names(city)
        road = city.s['roads'][0]
        shop = city.s['parcels'][0]['building']
        facility = city.s['facilities'][0]
        region = next(r for r in city.s['namingRegions'] if r['id'] == road['nameRegion'])
        for category, obj in (('roads', road), ('buildings', shop), ('facilities', facility)):
            self.assertTrue(obj['name'].endswith(naming.suffixes(category, obj)))
            self.assertEqual(obj['nameRegion'], region['id'])
        self.assertEqual(state, city.rng.getstate())
        saved = copy.deepcopy(city.s)
        naming.ensure_names(city)
        self.assertEqual(saved, city.s)

    def test_districts_and_blocks_use_short_names_in_a_shared_region(self):
        city = self.regional_city()
        city.s['districts'] = [dict(id=f'd-{i}', center=[650,600], parcels=[]) for i in range(40)]
        city.s['blockLayouts'] = [dict(id=f'b-{i}', center=[650,600]) for i in range(40)]
        naming.ensure_names(city)
        names = []
        for category in ('districts', 'blockLayouts'):
            for obj in city.s[category]:
                suffix = max((s for s in naming.suffixes(category, obj) if obj['name'].endswith(s)), key=len)
                stem = obj['name'][:-len(suffix)]
                self.assertIn(len(stem), (2,3))
                self.assertFalse(re.search(r'\d', stem))
                names.append(obj['name'])
        self.assertEqual(len(names), len(set(names)))
        saved = copy.deepcopy(city.s)
        naming.ensure_names(city)
        self.assertEqual(saved, city.s)

    def test_four_character_place_names_migrate_without_renaming_buildings(self):
        city = self.regional_city()
        naming.ensure_names(city)
        shop_name = city.s['parcels'][0]['building']['name']
        city.s['districts'] = [dict(id='legacy-d', name='长汀春和片区', nameSource='generated',
                                    nameVersion=3, center=[650,600], parcels=['p-local'])]
        city.s['blockLayouts'] = [dict(id='legacy-b', name='长汀文澜街坊', nameSource='generated',
                                       nameVersion=3, center=[650,600])]
        custom = dict(id='custom-d', name='用户自定四字片区', nameSource='custom', center=[650,600], parcels=[])
        city.s['districts'].append(custom)
        for category in ('districts', 'blockLayouts'):
            for obj in city.s[category]:
                city.s['placeNames'][category + ':' + obj['id']] = obj['name']
        naming.ensure_names(city)
        for category in ('districts', 'blockLayouts'):
            obj = city.s[category][0]
            self.assertTrue(obj['name'].startswith('长汀'))
            self.assertLessEqual(len(obj['name']), 4)
            self.assertEqual(city.s['placeNames'][category + ':' + obj['id']], obj['name'])
        self.assertEqual(custom['name'], '用户自定四字片区')
        self.assertEqual(city.s['parcels'][0]['building']['name'], shop_name)
        restored = copy.deepcopy(city)
        restored.s = json.loads(json.dumps(city.s))
        naming.ensure_names(restored)
        self.assertEqual(city.s, restored.s)

    def test_long_district_names_migrate_before_split_inheritance(self):
        city = self.regional_city()
        naming.ensure_names(city)
        old = dict(id='old-d', name='长汀春和片区', nameSource='generated', nameVersion=3,
                   center=[650,600], parcels=['a','b','c'])
        city.s['placeNames']['districts:old-d'] = old['name']
        city.s['districts'] = [dict(id='big', center=[650,600], parcels=['b','c']),
                               dict(id='small', center=[650,600], parcels=['a'])]
        naming.name_districts(city, [old])
        big, small = city.s['districts']
        self.assertTrue(big['name'].startswith('长汀'))
        self.assertLessEqual(len(big['name']), 4)
        self.assertNotEqual(big['name'], small['name'])
        previous = copy.deepcopy(city.s['districts'])
        city.s['districts'] = [dict(id='merged', center=[650,600], parcels=['a','b','c'])]
        naming.name_districts(city, previous)
        self.assertEqual(city.s['districts'][0]['name'], big['name'])
        saved = copy.deepcopy(city.s)
        naming.ensure_names(city)
        self.assertEqual(saved, city.s)

    def test_water_and_narrow_river_channels_separate_regions(self):
        for explicit_channel in (False, True):
            world = flat_world(water=not explicit_channel)
            if explicit_channel:
                # The explicit channel is narrower than the analysis grid.
                world['channels'] = [dict(points=[[.5,0],[.5,1]], widths=[.1])]
            terrain = Terrain(world)
            plan, regions = place_regions.build(terrain)
            left, right = set(), set()
            for i, label in enumerate(plan['labels']):
                if label < 0:
                    continue
                x = (i % plan['columns'] + .5) * plan['width'] / plan['columns']
                (left if x < 2000 else right).add(label)
            self.assertTrue(left and right)
            self.assertFalse(left & right)

    def test_mountain_ridge_separates_regions_and_plain_is_subdivided(self):
        world = flat_world()
        heights = np.full((80,80), 864., dtype=np.float32)
        heights[:, 35:45] += np.array([0,100,250,450,600,600,450,250,100,0])
        world['elevation'] = encode_heights(heights)
        plan, regions = place_regions.build(Terrain(world))
        west, east = set(), set()
        for i, label in enumerate(plan['labels']):
            if label < 0:
                continue
            x = i % plan['columns']
            if x < plan['columns']*.4:
                west.add(label)
            elif x > plan['columns']*.6:
                east.add(label)
        self.assertTrue(west and east)
        self.assertFalse(west & east)
        plain, regions = place_regions.build(Terrain(flat_world()))
        self.assertGreater(len(regions), 1)
        self.assertNotIn(-1, plain['labels'])
        self.assertEqual((plain, regions), place_regions.build(Terrain(flat_world())))

    def test_upgrade_generated_names_once_preserve_custom_and_resolve_local_collisions(self):
        city = self.regional_city()
        city.s['roads'][0].update(name='旧的随机路', nameSource='generated')
        city.s['facilities'][0].update(name='我的学校', nameSource='custom')
        city.s['parcels'] = [dict(id=f'local-{i}', center=[650,600], building=dict(use='commercial')) for i in range(100)]
        naming.ensure_names(city)
        road = city.s['roads'][0]
        self.assertNotEqual(road['name'], '旧的随机路')
        self.assertEqual(city.s['facilities'][0]['name'], '我的学校')
        shops = [p['building'] for p in city.s['parcels']]
        root = next(r['name'][:-2] for r in city.s['namingRegions'] if r['id'] == road['nameRegion'])
        self.assertTrue(all(b['nameRegion'] == road['nameRegion'] for b in shops))
        self.assertTrue(any(b['name'].startswith(root) for b in shops))
        self.assertTrue(any(not b['name'].startswith(root) for b in shops))
        self.assertTrue(all(not re.search(r'\d', b['name']) for b in shops))
        self.assertEqual(len({b['name'] for b in shops}), 100)
        previous = copy.deepcopy(city.s)
        naming.ensure_names(city)
        self.assertEqual(previous, city.s)
        # Movement across a naming boundary does not rename an established place.
        road['points'] = [[3200,3200],[3400,3200]]
        naming.ensure_names(city)
        self.assertEqual(road['name'], previous['roads'][0]['name'])

    def test_dense_region_has_distinct_building_stems_without_numbers(self):
        city = self.regional_city()
        city.s['parcels'] = [dict(id=f'dense-{i}', center=[650,600],
                                 building=dict(use='commercial')) for i in range(2000)]
        naming.ensure_names(city)
        buildings = [p['building'] for p in city.s['parcels']]
        names = [b['name'] for b in buildings]
        self.assertEqual(len(set(names)), len(names))
        self.assertTrue(all(not re.search(r'\d', name) and len(name) <= 60 for name in names))
        stems = {name[:-len(max((suffix for suffix in naming.BUILDING_SUFFIXES['commercial']
                                if name.endswith(suffix)), key=len))] for name in names}
        self.assertGreater(len(stems), 1000)
        saved = copy.deepcopy(city.s)
        city.s['parcels'].append(dict(id='new-shop', center=[650,600], building=dict(use='commercial')))
        naming.ensure_names(city)
        self.assertEqual(names, [p['building']['name'] for p in city.s['parcels'][:-1]])
        restored = copy.deepcopy(city)
        restored.s = json.loads(json.dumps(city.s))
        naming.ensure_names(restored)
        self.assertEqual(city.s, restored.s)
        self.assertEqual(saved['namingRegions'], city.s['namingRegions'])

    def test_numbered_v2_names_upgrade_and_current_duplicates_are_repaired(self):
        city = self.regional_city()
        city.s['parcels'] = [dict(id=f'old-{i}', center=[650,600],
                                 building=dict(use='commercial', name=f'清川{i}商场',
                                               nameSource='generated', nameVersion=2)) for i in range(5)]
        custom = dict(use='commercial', name='我的1号商店', nameSource='custom')
        city.s['parcels'].append(dict(id='custom', center=[650,600], building=custom))
        naming.ensure_names(city)
        self.assertEqual(custom['name'], '我的1号商店')
        self.assertTrue(all(not re.search(r'\d', p['building']['name']) for p in city.s['parcels'][:-1]))
        # Even a saved name already marked current must not duplicate a custom
        # place; restoring the registry must not make that collision permanent.
        victim = city.s['parcels'][0]
        victim['building']['name'] = custom['name']
        city.s['placeNames']['buildings:' + victim['id']] = custom['name']
        naming.ensure_names(city)
        names = [p['building']['name'] for p in city.s['parcels']]
        self.assertEqual(len(names), len(set(names)))
        self.assertEqual(custom['name'], '我的1号商店')
        saved = copy.deepcopy(city.s)
        naming.ensure_names(city)
        self.assertEqual(saved, city.s)

    def test_region_order_is_reproducible_and_all_water_falls_back_safely(self):
        a, b = self.regional_city(), self.regional_city()
        for city in (a, b):
            city.s['roads'].extend(dict(id=f'near-{i}', kind='street', points=[[600,600],[700,600]]) for i in range(12))
        b.s['roads'].reverse()
        naming.ensure_names(a); naming.ensure_names(b)
        self.assertEqual(a.s['placeNames'], b.s['placeNames'])
        world = flat_world()
        world['elevation'] = encode_heights(np.full((80,80), -100., dtype=np.float32))
        city = self.regional_city(world)
        naming.ensure_names(city)
        self.assertEqual(city.s['namingRegions'], [])
        self.assertTrue(city.s['roads'][0]['name'])

    def test_region_names_survive_save_reload_and_are_exposed_without_analysis_grid(self):
        city = City(flat_world())
        city.command(dict(type='road', kind='street', points=[[500,500],[1000,500]]))
        saved = city.snapshot()
        restored = City.restore(json.loads(json.dumps(saved)))
        self.assertEqual(city.s['namingRegions'], restored.s['namingRegions'])
        self.assertEqual(city.s['namingGeography'], restored.s['namingGeography'])
        self.assertEqual(city.s['roads'][0]['name'], restored.s['roads'][0]['name'])
        self.assertIn('namingRegions', restored.view())
        self.assertNotIn('namingGeography', restored.view())

    def test_every_place_gets_a_distinct_type_appropriate_name_without_consuming_simulation_rng(self):
        city=sample();rng=city.rng.getstate();naming.ensure_names(city)
        names=[o['name'] for _,_,o in naming.objects(city)]
        self.assertEqual(len(names),len(set(names)))
        self.assertEqual(rng,city.rng.getstate())
        for category,_,obj in naming.objects(city):
            self.assertTrue(obj['name'].endswith(naming.suffixes(category,obj)))
            self.assertEqual(obj['nameSource'],'generated')
        self.assertTrue(all(p['blockName']==city.s['blockLayouts'][0]['name'] for p in city.s['parcels']))

    def test_reproducible_across_seed_order_and_repeated_updates(self):
        a,b=sample(),sample();b.s['roads'].reverse()
        naming.ensure_names(a);naming.ensure_names(b)
        self.assertEqual(a.s['placeNames'],b.s['placeNames'])
        saved=copy.deepcopy(a.s);naming.ensure_names(a);self.assertEqual(saved,a.s)
        c=sample('different-city');naming.ensure_names(c)
        self.assertNotEqual(a.s['placeNames'],c.s['placeNames'])

    def test_large_city_names_do_not_collide_or_rename_existing_places(self):
        city=sample();city.s['roads']=[dict(id=f'r-{i}',kind='street') for i in range(2000)]
        naming.ensure_names(city);before=[r['name'] for r in city.s['roads']]
        self.assertEqual(len(before),len(set(before)))
        city.s['facilities'].append(dict(id='later',kind='plaza'));naming.ensure_names(city)
        self.assertEqual(before,[r['name'] for r in city.s['roads']])

    def test_custom_names_are_preserved_and_reserved(self):
        city=sample();city.s['roads'][0]['name']='用户指定的枫林路'
        city.s['facilities'][0].update(name='公园',nameSource='custom')
        naming.ensure_names(city)
        self.assertEqual(city.s['roads'][0]['name'],'用户指定的枫林路')
        self.assertEqual(city.s['facilities'][0]['name'],'公园')
        city.s['roads'][0]['name']='更名后的路';naming.ensure_names(city)
        self.assertEqual(city.s['placeNames']['roads:r-0'],'更名后的路')

    def test_owned_train_stop_shares_facility_name_but_explicit_rename_survives(self):
        city=sample();city.s['facilities']=[dict(id='f-1',kind='train_station',stop='s-1',ownsStop=True)]
        naming.ensure_names(city)
        self.assertEqual(city.s['stops'][0]['name'],city.s['facilities'][0]['name'])
        city.s['stops'][0].update(name='自定义站名',nameSource='custom');naming.ensure_names(city)
        self.assertEqual(city.s['stops'][0]['name'],'自定义站名')

    def test_district_identity_survives_expansion_split_merge_and_reclassification(self):
        city=sample();city.s['districts']=[dict(id='old',kind='居住区',parcels=['a','b','c'])]
        naming.ensure_names(city);original=city.s['districts'][0]['name'];old=copy.deepcopy(city.s['districts'])
        city.s['districts']=[dict(id='larger',kind='CBD',parcels=['a','b','c','d'])]
        naming.name_districts(city,old);self.assertEqual(city.s['districts'][0]['name'],original)
        old=copy.deepcopy(city.s['districts'])
        city.s['districts']=[dict(id='small',kind='居住区',parcels=['a']),dict(id='big',kind='商业区',parcels=['b','c','d'])]
        naming.name_districts(city,old)
        self.assertEqual(city.s['districts'][1]['name'],original)
        self.assertNotEqual(city.s['districts'][0]['name'],original)
        old=copy.deepcopy(city.s['districts'])
        city.s['districts']=[dict(id='merged',kind='混合城区',parcels=['a','b','c','d'])]
        naming.name_districts(city,old);self.assertEqual(city.s['districts'][0]['name'],original)
        old=copy.deepcopy(city.s['districts'])
        city.s['districts']=[dict(id='old',kind='居住区',parcels=['a']),dict(id='merged',kind='商业区',parcels=['b','c','d'])]
        naming.name_districts(city,old)
        self.assertEqual(len({d['name'] for d in city.s['districts']}),2)

    def test_save_reload_legacy_migration_and_undo_redo(self):
        city=City(flat_world())
        city.command(dict(type='road',kind='street',points=[[500,500],[1000,500]]))
        name=city.s['roads'][0]['name'];rng=city.rng.getstate()
        snapshot=city.snapshot();restored=City.restore(json.loads(json.dumps(snapshot)))
        self.assertEqual(restored.s['roads'][0]['name'],name)
        self.assertEqual(restored.rng.getstate(),rng)
        city.command(dict(type='undo'));self.assertEqual(city.s['roads'],[])
        city.command(dict(type='redo'));self.assertEqual(city.s['roads'][0]['name'],name)
        snapshot['state'].pop('placeNames');snapshot['state']['roads'][0].pop('nameSource');snapshot['state']['roads'][0]['name']='普通路'
        restored=City.restore(snapshot);view=restored.view()
        self.assertEqual(view['roads'][0]['name'],name)
        self.assertNotIn('placeNames',view)
        self.assertEqual(City.restore(restored.snapshot()).view()['roads'][0]['name'],name)

    def test_preview_does_not_reserve_names_and_new_lines_use_random_names(self):
        city=City(flat_world());before=city.snapshot()
        cmd=dict(type='road',kind='street',points=[[500,500],[1500,500]])
        preview=city.preview_road(cmd)
        self.assertTrue(preview['valid'])
        self.assertEqual(city.snapshot(),before)
        city.command(cmd)
        self.assertEqual(city.s['roads'][0]['name'],preview['road']['name'])
        for point in ([700,500],[1300,500]):
            city.command(dict(type='stop',mode='bus',point=point,name=''))
        city.command(dict(type='line',mode='bus',stops=[s['id'] for s in city.s['stops']],name=''))
        line=city.s['lines'][0]
        self.assertNotEqual(line['name'],'巴士线')
        self.assertIn(line['name'],city.s['events'][-1]['message'])
        city.command(dict(type='line_update',id=line['id'],name='我的公交线'))
        self.assertEqual(city.s['lines'][0]['name'],'我的公交线')

    def test_legacy_buildings_and_squares_receive_names_visible_to_frontend(self):
        path=Path(__file__).resolve().parent/'fixtures/lighting-materials-city.json'
        city=City.restore(json.loads(path.read_text()));view=city.view()
        self.assertTrue(all(p['building'].get('name') for p in view['parcels'] if p.get('building')))
        self.assertTrue(all(f.get('name') and f['name'] not in ('公园','广场') for f in view['facilities']))
        names=copy.deepcopy(city.s['placeNames']);city.rebuild();city.summarize()
        self.assertEqual(names,city.s['placeNames'])


if __name__=='__main__':unittest.main()
