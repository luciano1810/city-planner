"""Industrial halls must not inherit cadastral seams as arbitrary wall notches."""
import copy,json,math,unittest
from pathlib import Path
from shapely import affinity
from shapely.geometry import Polygon,Point,box
from tests.test_city import City,flat_world,road
from tests.test_city_v3 import complete
from city.geometry import building_footprint
from city.engine import MODEL_VERSION


class IndustrialHallTests(unittest.TestCase):
    def test_reported_assembled_sites_get_rectangular_halls_with_usable_area(self):
        sites=json.loads((Path(__file__).parent/'fixtures'/'industrial-frontages.json').read_text())
        for site in sites:
            for rotation in (0,37,91):
                p=copy.deepcopy(site)
                land=affinity.rotate(Polygon(p['points']),rotation,origin=(0,0))
                p['points']=list(land.exterior.coords)
                for key in ('center','frontage'):
                    p[key]=list(affinity.rotate(Point(p[key]),rotation,origin=(0,0)).coords[0])
                p['streetAngle']+=rotation
                shape=building_footprint(p,p['use'],.5)
                self.assertIsNotNone(shape)
                self.assertTrue(land.buffer(-1.99).covers(shape))
                self.assertTrue(shape.is_valid)
                self.assertEqual(len(shape.exterior.coords),5)
                self.assertAlmostEqual(shape.area,shape.minimum_rotated_rectangle.area,places=5)
                local=affinity.rotate(shape,-p['streetAngle'],origin=(0,0))
                self.assertAlmostEqual(local.area,box(*local.bounds).area,places=5)
                self.assertGreater(shape.area/land.area,.40)
                self.assertLess(shape.area/land.area,.90)
                self.assertEqual(shape.wkb,building_footprint(p,p['use'],.5).wkb)

    def test_concave_sites_and_split_setbacks_never_get_bridged_by_the_hall(self):
        lands=[box(0,0,100,65).difference(box(35,20,65,66)),
               box(0,0,100,65).difference(box(35,20,65,40).union(box(49,39,51,66))),
               box(0,0,100,65).difference(box(45,-1,55,66))]
        for index,land in enumerate(lands):
            # The split-envelope case starts from a single parcel with a neck.
            if land.geom_type=='MultiPolygon':
                land=land.union(box(40,0,60,2))
            p=dict(id=str(index),points=list(land.exterior.coords),frontage=[50,-5],center=[50,30],streetAngle=0)
            shape=building_footprint(p,'warehouse',.5,900)
            self.assertIsNotNone(shape)
            self.assertLessEqual(shape.area,900.00001)
            self.assertTrue(land.buffer(-1.99).covers(shape))
            self.assertEqual(len(shape.exterior.coords),5)
        tiny=dict(id='tiny',points=list(box(0,0,8,8).exterior.coords),center=[4,4],frontage=[4,-5],streetAngle=0)
        self.assertIsNone(building_footprint(tiny,'warehouse'))

    def test_version_seven_occupied_footprints_survive_migration(self):
        c=City(flat_world());road(c,[[500,1500],[1000,1500]])
        p=c.s['parcels'][0];complete(c,p,'warehouse');c.rebuild()
        saved=c.snapshot();saved['model']=saved['state']['version']='shanhai-city-7'
        before=copy.deepcopy(p['building'])
        restored=City.restore(saved)
        self.assertEqual(restored.s['version'],MODEL_VERSION)
        self.assertEqual(before,restored.parcelmap[p['id']]['building'])


if __name__=='__main__':unittest.main()
