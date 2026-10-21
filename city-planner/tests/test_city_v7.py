"""Urban variety must conserve land, preserve access and survive a reload."""
import copy,math,unittest
from shapely import affinity
from shapely.geometry import Polygon,LineString,box
from shapely.ops import unary_union
from tests.test_city import City,flat_world
from tests.test_city_v3 import complete
from city.blocks import varied_partition,inside_route,grow_block_commons
from city.scenario import build_small_blocks
from city.geometry import building_footprint
from city.engine import MODEL_VERSION


class VariedBlockTests(unittest.TestCase):
    def test_subdivision_varies_grain_and_conserves_irregular_land(self):
        land=affinity.rotate(Polygon([(0,0),(142,5),(132,104),(9,112)]),19)
        counts=set();ratios=[]
        for kind in ('frontage','court','mews','garden'):
            for seed in ('a','b','c'):
                sites,common=varied_partition(land,kind,seed)
                self.assertGreaterEqual(len(sites),2,(kind,seed))
                parts=sites+([common] if common is not None else [])
                self.assertLess(land.symmetric_difference(unary_union(parts)).area,1e-6)
                self.assertLess(sum(a.intersection(b).area for i,a in enumerate(parts) for b in parts[i+1:]),1e-6)
                self.assertTrue(all(p.is_valid and not p.interiors for p in parts))
                counts.add(len(sites));ratios.append(max(p.area for p in sites)/min(p.area for p in sites))
                self.assertEqual([p.wkb for p in parts],[p.wkb for p in (lambda x:x[0]+([x[1]] if x[1] is not None else []))(varied_partition(land,kind,seed))])
        self.assertGreaterEqual(len(counts),4)
        self.assertGreater(max(ratios),2)

    def test_dogleg_route_stays_in_reserved_land_and_accounts_for_distance(self):
        allowed=unary_union([box(0,0,40,5),box(35,0,40,35),box(35,30,80,35)])
        route=inside_route([1,2],[79,33],allowed)
        self.assertIsNotNone(route);self.assertGreater(len(route),2)
        self.assertTrue(allowed.buffer(.02).covers(LineString(route)))
        self.assertGreater(LineString(route).length,math.dist(route[0],route[-1])+8)

    def test_curved_blocks_grow_courts_with_real_access_and_no_collisions(self):
        c=build_small_blocks(City(flat_world()),irregular=True)
        layouts=c.s['blockLayouts']
        self.assertGreaterEqual(len(layouts),14)
        self.assertGreaterEqual(len({l['kind'] for l in layouts}),4)
        self.assertTrue(any(l['commonArea']==0 and l['buildingSites']>2 for l in layouts))
        self.assertGreaterEqual(len({l['buildingSites'] for l in layouts}),4)
        # Curved whole-block reservations must also exclude independently
        # generated frontage lots, including shared courtyard land.
        polygons=[Polygon(p['points']) for p in c.s['parcels']]
        self.assertLess(sum(a.intersection(b).area for i,a in enumerate(polygons) for b in polygons[i+1:]),.001)
        planned=copy.deepcopy(layouts)
        c.rebuild(regenerate=True);self.assertEqual(planned,c.s['blockLayouts'])
        shared_blocks={p['block'] for p in c.s['parcels'] if p.get('blockCommon')}
        sites=[p for p in c.s['parcels'] if p.get('block') in shared_blocks and not p.get('blockCommon')]
        for p in sites:complete(c,p,'residential')
        c.rebuild();self.assertTrue(grow_block_commons(c));c.rebuild()
        links=[p for p in c.s['localPaths'] if p.get('block')]
        obstacles=unary_union([Polygon(p['building']['footprint']).buffer(-.05) for p in sites])
        for p in sites:
            link=next((q for q in links if q['parcel']==p['id'] and q['kind']=='neighbourhood'),None)
            self.assertIsNotNone(link,p['id'])
            self.assertAlmostEqual(link['length'],LineString(link['points']).length)
            self.assertTrue(any(e['to']==link['target'] for e in c.graphs['walk'][p['id']]))
        self.assertTrue(all(LineString(q['points']).intersection(obstacles).length<.01 for q in links))
        for p in c.s['parcels']:
            if p.get('blockCommon'):
                road_distance=min(p['access']['da'],p['access']['db'])
                edges=[e for e in c.graphs['walk'][p['id']] if e['to'] in (p['access']['a'],p['access']['b'])]
                self.assertAlmostEqual(min(e['length'] for e in edges),road_distance+p['accessLength'])
        restored=City.restore(c.snapshot())
        self.assertEqual(c.s['blockLayouts'],restored.s['blockLayouts'])
        self.assertEqual(c.s['localPaths'],restored.s['localPaths'])

    def test_footprints_follow_use_and_keep_street_access(self):
        c=build_small_blocks(City(flat_world()))
        sites=[p for p in c.s['parcels'] if p.get('layoutVersion')==7 and not p.get('blockCommon')]
        areas=[];concave=0
        for p in sites:
            for use in ('residential','commercial','office','warehouse'):
                shape=building_footprint(p,use,.7)
                self.assertIsNotNone(shape,(p['id'],use))
                self.assertTrue(Polygon(p['points']).buffer(.001).covers(shape))
                self.assertFalse(shape.interiors)
                areas.append(shape.area);concave+=shape.convex_hull.area-shape.area>20
        self.assertGreater(max(areas)/min(areas),5)
        self.assertGreater(concave,5)

    def test_model_six_occupied_layout_is_preserved(self):
        c=build_small_blocks(City(flat_world()))
        p=next(p for p in c.s['parcels'] if p.get('blockLayout')=='single')
        complete(c,p,'commercial');c.rebuild()
        snapshot=c.snapshot();snapshot['model']=snapshot['state']['version']='shanhai-city-6'
        before=copy.deepcopy(snapshot['state']['blockLayouts'])
        restored=City.restore(snapshot);restored.rebuild(regenerate=True)
        self.assertEqual(restored.s['version'],MODEL_VERSION)
        self.assertEqual(before,restored.s['blockLayouts'])
        self.assertEqual(p['building']['footprint'],restored.parcelmap[p['id']]['building']['footprint'])


if __name__=='__main__':unittest.main()
