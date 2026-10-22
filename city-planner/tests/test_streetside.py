"""Street aprons and narrow infill seams are shared by every building type."""
import math
import unittest
from types import SimpleNamespace
from shapely.affinity import rotate
from shapely.geometry import Point, LineString, Polygon, box
from shapely.ops import unary_union
from tests.test_city import flat_world
from city import streetside
from city.geometry import Terrain
from tests.test_facility_employment import fixture
from city.engine import City


def shape(rows):
    return unary_union([Polygon(r['points'],r.get('holes',[])) for r in rows])


class StreetsideTests(unittest.TestCase):
    def test_frontage_covers_full_width_but_not_building_or_back(self):
        site=box(100,140,160,190);road=LineString([(0,100),(300,100)])
        apron=streetside.frontage(site,road)
        self.assertAlmostEqual(apron.area,60*40)
        self.assertTrue(apron.covers(Point(101,120)))
        self.assertEqual(apron.intersection(site).area,0)
        self.assertFalse(apron.covers(Point(120,195)))
        for angle in (37,90,170):
            self.assertAlmostEqual(streetside.frontage(rotate(site,angle,origin=(0,0)),rotate(road,angle,origin=(0,0))).area,apron.area,places=5)

    def test_special_apron_parking_trees_reservation_and_restore(self):
        c,home,f=fixture()
        apron=shape(f['forecourt']);road=next(r for r in c.s['roads'] if r['id']==f['accessRoad'])
        self.assertTrue(apron.covers(Point(1460,1025)))
        self.assertTrue(apron.covers(Point(1540,1025)))
        self.assertEqual(apron.intersection(Polygon(f['points'])).area,0)
        self.assertEqual(apron.intersection(LineString(road['points']).buffer(7)).area,0)
        plan=next(p for p in c.s['streetside']['sites'] if p['id']==f['id'])
        self.assertTrue(plan['parking']);self.assertTrue(plan['trees'])
        driveway=LineString(f['accessPath']).buffer(f['accessWidth']/2)
        for lot in plan['parking']:
            rect=rotate(box(-lot['width']/2,-lot['depth']/2,lot['width']/2,lot['depth']/2),math.degrees(lot['angle']),origin=(0,0))
            from shapely.affinity import translate
            rect=translate(rect,*lot['point'])
            self.assertTrue(apron.covers(rect));self.assertFalse(rect.intersects(driveway))
        for tree in plan['trees']:
            root=Point(tree['point'])
            self.assertTrue(apron.covers(root.buffer(tree['radius'])))
            self.assertGreater(root.distance(driveway),tree['radius'])
        for p in c.s['parcels']:
            if not p.get('building') and Polygon(p['points']).intersection(apron).area>.1:
                self.assertEqual(p.get('openSpace'),f['id'])
        self.assertTrue(home.get('forecourt'))
        restored=City.restore(c.snapshot())
        self.assertEqual(restored.s['streetside'],c.s['streetside'])
        c.s['roads']=[];c.rebuild()
        self.assertNotIn('forecourt',f)
        self.assertEqual(c.s['streetside']['sites'],[])

    def test_gaps_fill_only_between_developed_sites_and_preserve_protected_land(self):
        def parcel(id,x0,x1,built=True,use='residential'):
            points=list(box(x0,100,x1,140).exterior.coords)
            return dict(id=id,points=points,use=use,connected=False,building=dict(footprint=points,status='active') if built else None)
        a,b=parcel('a',100,130),parcel('b',134,164)
        c=SimpleNamespace(s=dict(parcels=[a,b,parcel('empty',170,200,False)],facilities=[],roads=[]),terrain=Terrain(flat_world()))
        streetside.update(c)
        self.assertTrue(shape(c.s['streetside']['surfaces']).covers(Point(132,120)))
        self.assertFalse(shape(c.s['streetside']['surfaces']).covers(Point(167,120)))
        c.s['parcels'].append(parcel('park',131,133,False,'protected'));streetside.update(c)
        self.assertFalse(shape(c.s['streetside']['surfaces']).covers(Point(132,120)))
        c.s['parcels'].remove(b);streetside.update(c)
        self.assertTrue(shape(c.s['streetside']['surfaces']).is_empty)

    def test_forecourt_clips_other_sites_and_water(self):
        c,_,f=fixture()
        # Off the entrance axis, so the facility remains connected.
        blocked=box(1455,1018,1475,1035)
        c.s['facilities'].append(dict(id='park-blocker',kind='park',name='保留公园',point=[1465,1025],points=list(blocked.exterior.coords),capacity=0))
        c.rebuild();self.assertTrue(f['connected'])
        self.assertEqual(shape(f['forecourt']).intersection(blocked).area,0)
        c.terrain.river_geometry=box(1520,1010,1530,1040)
        c._streetside_key=None;streetside.update(c)
        self.assertEqual(shape(f.get('forecourt',[])).intersection(c.terrain.river_geometry).area,0)

    def test_wide_building_gaps_and_block_interiors_have_continuous_paving(self):
        def parcel(ident, bounds):
            points=list(box(*bounds).exterior.coords)
            return dict(id=ident,points=points,use='residential',connected=False,block='block',
                        building=dict(footprint=points,status='active'))
        a,b=parcel('a',(100,100,130,140)),parcel('b',(150,100,180,140))
        c=SimpleNamespace(s=dict(parcels=[a,b],facilities=[],roads=[]),terrain=Terrain(flat_world()))
        streetside.update(c)
        self.assertTrue(shape(c.s['streetside']['surfaces']).covers(Point(140,120)))
        self.assertFalse(shape(c.s['streetside']['surfaces']).covers(Point(95,120)))
        c.s['blockLayouts']=[dict(id='block',points=list(box(100,100,180,180).exterior.coords))]
        streetside.update(c)
        self.assertTrue(shape(c.s['streetside']['surfaces']).covers(Point(140,160)))
        c.s['facilities']=[dict(id='garden',kind='park',points=list(box(135,150,145,170).exterior.coords))]
        streetside.update(c)
        self.assertFalse(shape(c.s['streetside']['surfaces']).covers(Point(140,160)))
        a['building']=b['building']=None
        streetside.update(c)
        self.assertTrue(shape(c.s['streetside']['surfaces']).is_empty)

    def test_frontage_save_paves_side_street_without_adding_an_entrance(self):
        points=list(box(100,140,160,190).exterior.coords)
        site=dict(id='home',points=points,use='residential',connected=True,road='front',
                  center=[130,165],entrance=[130,140],building=dict(footprint=points,status='active'))
        roads=[dict(id='front',kind='street',level=0,points=[[0,100],[300,100]]),
               dict(id='side',kind='street',level=0,points=[[80,100],[80,250]])]
        c=SimpleNamespace(s=dict(parcels=[site],facilities=[],roads=roads),terrain=Terrain(flat_world()))
        streetside.update(c)
        paving=shape(c.s['streetside']['surfaces'])
        self.assertTrue(paving.covers(Point(94,165)))
        self.assertFalse(paving.covers(Point(80,165)))
        self.assertFalse(paving.covers(Point(65,165)))
        self.assertEqual(len(c.s['streetside']['sites']),1)
        self.assertEqual(c.s['streetside']['sites'][0]['accessPath'],[[130,100],[130,140]])
        roads.pop()
        streetside.update(c)
        self.assertFalse(shape(c.s['streetside']['surfaces']).covers(Point(94,165)))


if __name__=='__main__':
    unittest.main()
