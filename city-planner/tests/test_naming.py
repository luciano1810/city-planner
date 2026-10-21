"""Place identity survives rebuilds, migration, undo and district changes."""
import copy
import json
import random
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from city import naming
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
        path=Path(__file__).resolve().parents[2]/'docs/experiments/lighting-materials-city.json'
        city=City.restore(json.loads(path.read_text()));view=city.view()
        self.assertTrue(all(p['building'].get('name') for p in view['parcels'] if p.get('building')))
        self.assertTrue(all(f.get('name') and f['name'] not in ('公园','广场') for f in view['facilities']))
        names=copy.deepcopy(city.s['placeNames']);city.rebuild();city.summarize()
        self.assertEqual(names,city.s['placeNames'])


if __name__=='__main__':unittest.main()
