"""Small-block land conservation, actual shared access and demand thresholds."""
import copy,unittest
from unittest.mock import patch
from shapely.geometry import Polygon,LineString,box
from shapely.ops import unary_union
from tests.test_city import City,flat_world,road,block_city
from tests.test_city_v3 import complete
from city.blocks import block_partition,grow_block_commons
from city.scenario import build_small_blocks
from city.geometry import building_footprint
from city.development import update_location_context,select_projects
from city.urban import grow_public_spaces,building_style
from city.engine import USES,MODEL_VERSION


class BlockLayoutTests(unittest.TestCase):
    def test_partitions_allocate_all_land_without_overlaps(self):
        land=Polygon([(0,0),(120,7),(130,105),(4,110)])
        for kind,count in [('single',1),('pair',2),('cluster',4)]:
            sites,common=block_partition(land,kind,'irregular')
            self.assertEqual(len(sites),count)
            shapes=sites+([common] if common is not None else [])
            self.assertLess(land.symmetric_difference(unary_union(shapes)).area,1e-6)
            self.assertLess(sum(a.intersection(b).area for i,a in enumerate(shapes) for b in shapes[i+1:]),1e-6)
            self.assertTrue(all(p.is_valid and not p.interiors for p in shapes))

    def test_road_only_layouts_and_rebuild_preserve_geometry(self):
        c=build_small_blocks(City(flat_world()))
        self.assertIn('single',{l['kind'] for l in c.s['blockLayouts']})
        self.assertGreaterEqual(len({l['kind'] for l in c.s['blockLayouts']}),4)
        original={p['id']:copy.deepcopy(p['points']) for p in c.s['parcels']}
        c.rebuild(regenerate=True)
        self.assertEqual(original,{p['id']:p['points'] for p in c.s['parcels']})
        shapes=[Polygon(p['points']) for p in c.s['parcels']]
        self.assertLess(sum(a.intersection(b).area for i,a in enumerate(shapes) for b in shapes[i+1:]),.01)
        for layout in c.s['blockLayouts']:
            sites=[c.parcelmap[pid] for pid in layout['parcels']]
            self.assertAlmostEqual(sum(p['area'] for p in sites),layout['area'],delta=.05)
            self.assertTrue(all(p['connected'] for p in sites))

    def test_whole_block_building_and_whole_block_public_spaces(self):
        c=build_small_blocks(City(flat_world()))
        single=[p for p in c.s['parcels'] if p.get('blockLayout')=='single']
        self.assertGreaterEqual(len(single),3)
        p=single[0];shape=building_footprint(p,'commercial',.5,520)
        self.assertGreater(shape.area,800)
        self.assertGreater(shape.area/p['area'],.75)
        complete(c,p,'commercial');c.rebuild()
        self.assertTrue(grow_public_spaces(c));c.rebuild()
        self.assertFalse(any(f['kind']=='park' for f in c.s['facilities']))
        home=next(p for p in c.s['parcels'] if p.get('blockLayout')!='single'
                  and not p.get('blockCommon') and not p.get('building') and not p.get('openSpace'))
        complete(c,home,'residential',10)
        c.s['households']=[dict(id=c.uid('h'),home=home['id'],job=None,size=4,income=6000,car=False,
                              stress=0,unemployedMonths=0,burden=.1,commute=None,commuteFailed=False) for _ in range(10)]
        c.rebuild();self.assertTrue(grow_public_spaces(c));c.rebuild()
        for kind in ('park','plaza'):
            f=next(f for f in c.s['facilities'] if f['kind']==kind)
            self.assertEqual(c.parcelmap[f['parcel']]['blockLayout'],'single')
            self.assertGreater(Polygon(f['points']).area/c.parcelmap[f['parcel']]['area'],.7)
            self.assertTrue(f['connected'])

    def test_two_buildings_share_real_walkable_court_and_restore(self):
        with patch('city.blocks.choose_layout',return_value='pair'):
            c=build_small_blocks(City(flat_world()))
        layout=next(l for l in c.s['blockLayouts'] if l['kind']=='pair')
        sites=[c.parcelmap[pid] for pid in layout['parcels']]
        common=next(p for p in sites if p.get('blockCommon'));buildings=[p for p in sites if not p.get('blockCommon')]
        self.assertFalse(grow_block_commons(c))
        for p in buildings:complete(c,p,'residential')
        c.rebuild();self.assertTrue(grow_block_commons(c));c.rebuild()
        links=[p for p in c.s['localPaths'] if p.get('block')==layout['id']]
        self.assertEqual(sum(p['kind']=='neighbourhood' for p in links),2)
        obstacles=unary_union([Polygon(p['building']['footprint']).buffer(-.01) for p in buildings])
        self.assertTrue(all(not LineString(p['points']).intersects(obstacles) for p in links))
        for p in buildings:
            self.assertTrue(any(e['to']==common['id'] for e in c.graphs['walk'][p['id']]))
        self.assertIsNotNone(c.route(buildings[0]['id'],buildings[1]['id'],False))
        with self.assertRaisesRegex(ValueError,'共享'):c.command(dict(type='zone',id=common['id'],use='residential'))
        restored=City.restore(c.snapshot())
        self.assertEqual(restored.s['blockLayouts'],c.s['blockLayouts'])
        self.assertEqual(restored.s['localPaths'],c.s['localPaths'])
        self.assertGreater(restored.s['capitalAccounts']['街区公共空间'],0)

    def test_occupied_legacy_blocks_are_not_replaced(self):
        c=City(flat_world());c.s['settings']['autoGrow']=False
        road(c,[[1000,1000],[1120,1000]])
        p=next(p for p in c.s['parcels'] if p['center'][1]>1000);complete(c,p,'residential')
        footprint=copy.deepcopy(p['building']['footprint']);pid=p['id']
        for pts in ([[1120,1000],[1120,1100]],[[1120,1100],[1000,1100]],[[1000,1100],[1000,1000]]):road(c,pts)
        self.assertEqual(c.parcelmap[pid]['building']['footprint'],footprint)
        self.assertFalse(c.s['blockLayouts'])
        snap=c.snapshot();snap['model']=snap['state']['version']='shanhai-city-5';snap['state'].pop('blockLayouts')
        restored=City.restore(snap)
        self.assertEqual(restored.s['version'],MODEL_VERSION)
        self.assertEqual(restored.parcelmap[pid]['building']['footprint'],footprint)

    def test_absolute_shortage_still_starts_projects_below_eight_percent(self):
        c=City(flat_world());c.s['settings'].update(autoGrow=False,externalJobs=10000,maxProjects=1)
        road(c,[[500,1800],[3000,1800]])
        for p in c.s['parcels']:p['use']='office'
        complete(c,c.s['parcels'][0],'office',4900)
        update_location_context(c);select_projects(c,USES,building_style)
        self.assertGreater(sum(bool(p.get('building')) for p in c.s['parcels']),1)


if __name__=='__main__':unittest.main()
