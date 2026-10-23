"""Stable geographic identity and probabilistic, collision-free place names."""
import copy
import json
import random
import unittest
from collections import Counter
from tests import test_naming
from city import naming
from city.name_context import Context


class HierarchyTests(unittest.TestCase):
    def city(self):
        c = test_naming.NamingTests().regional_city()
        c.s['name'] = '云川'
        naming.ensure_names(c)
        return c

    def test_three_levels_migrate_and_roundtrip_without_renaming(self):
        c = self.city()
        road = c.s['roads'][0]
        area = next(a for a in c.s['namingRegions'] if a['id'] == road['nameRegion'])
        parent = next(d for d in c.s['namingDistricts'] if d['id'] == road['nameDistrict'])
        self.assertEqual(area['district'], parent['id'])
        self.assertIn(area['id'], parent['regions'])
        self.assertTrue(parent['name'].endswith('城区'))
        self.assertTrue(area['name'].endswith('片区'))
        before = copy.deepcopy(c.s)
        c.s = json.loads(json.dumps(c.s))
        naming.ensure_names(c)
        self.assertEqual(c.s, before)
        c.s.pop('namingDistricts')
        for a in c.s['namingRegions']:a.pop('district')
        naming.ensure_names(c)
        self.assertEqual(road['name'], c.s['roads'][0]['name'])
        c.s['name'] = '新云川'
        naming.ensure_names(c)
        self.assertEqual(road['name'], c.s['roads'][0]['name'])

    def test_center_levels_and_public_building_bias(self):
        c = self.city();context = Context(c)
        area = c.s['namingRegions'][0];point = area['center']
        results = {}
        for level, key in [('city','city'),('district',area['district']),('region',area['id'])]:
            context.peaks = {key:(100, point, 'peak')}
            rng = random.Random(55)
            counts = Counter(context.choose(rng,'facilities',{'kind':'school'},area,point)[1] for _ in range(3000))
            self.assertEqual(counts.most_common(1)[0][0], level)
            results[level]=counts
        context.peaks = {'city':(100, point, 'peak')}
        rng = random.Random(55)
        ordinary = Counter(context.choose(rng,'buildings',{'use':'residential'},area,point)[1] for _ in range(3000))
        self.assertGreater(ordinary['independent'], 1000)
        self.assertLess(results['city']['independent'], 350)
        self.assertGreater(ordinary['city'], 500)

    def test_dense_names_unique_without_digits_and_keep_existing_names(self):
        c = self.city()
        c.s['parcels'] = [dict(id=f'p-{i}',center=[650,600],building=dict(use='commercial')) for i in range(600)]
        c.s['facilities'] = [dict(id=f'f-{i}',point=[650,600],kind='school') for i in range(150)]
        naming.ensure_names(c)
        names = [o['name'] for _,_,o in naming.objects(c)]
        self.assertEqual(len(names),len(set(names)))
        self.assertFalse(any(ch.isdigit() for name in names for ch in name))
        before = copy.deepcopy(c.s)
        naming.ensure_names(c)
        self.assertEqual(c.s,before)

    def test_long_city_titles_do_not_create_unloadable_names(self):
        c = self.city();c.s['name']='云川'*30
        c.s['facilities']=[dict(id=f'long-{i}',kind='school',point=[650,600]) for i in range(100)]
        naming.ensure_names(c)
        self.assertTrue(all(len(o['name'])<=60 for _,_,o in naming.objects(c)))

    def test_old_district_name_follows_largest_surviving_overlap(self):
        c = test_naming.sample();c.s['districts'] = [dict(id='old',name='旧城片区',nameSource='custom',parcels=list('abcde'))]
        naming.ensure_names(c);previous=copy.deepcopy(c.s['districts'])
        c.s['districts']=[dict(id='expanded',parcels=['a']+list(range(10))),dict(id='survivor',parcels=list('bcde'))]
        naming.name_districts(c,previous)
        self.assertEqual(c.s['districts'][1]['name'],'旧城片区')
        self.assertNotEqual(c.s['districts'][0]['name'],'旧城片区')
