"""Continuous street frontages and occupancy-gated automatic road extension."""
import copy,math,statistics,unittest
from shapely.geometry import Point,Polygon,LineString
from tests.test_city import City,flat_world,road,block_city
from tests.test_city_v3 import complete
from city.geometry import building_footprint
from city.development import update_location_context
from city.planning import street_extension_ready,grow_block_streets
from city.engine import MODEL_VERSION


class StreetFrontageTests(unittest.TestCase):
    def test_small_floorplates_keep_street_alignment_and_individual_areas(self):
        c=City(flat_world());road(c,[[500,1800],[3500,1800]])
        sites=[p for p in c.s['parcels'] if p['center'][1]>1800][:18]
        shapes=[]
        for p in sites:
            shape=building_footprint(p,'office',.9,350)
            self.assertIsNotNone(shape)
            self.assertTrue(Polygon(p['points']).covers(shape))
            self.assertLessEqual(shape.area,350.01)
            self.assertLess(shape.distance(Point(p['frontage'])),12)
            shapes.append(shape)
        gaps=[a.distance(b) for a,b in zip(shapes,shapes[1:])]
        self.assertLess(statistics.median(gaps),5)
        self.assertEqual(sum(a.intersection(b).area for i,a in enumerate(shapes) for b in shapes[i+1:]),0)
        residential=[building_footprint(p,'residential',.8) for p in sites]
        self.assertGreater(len({round(s.area,1) for s in residential}),len(sites)*.8)
        self.assertGreater(statistics.median(s.area/p['area'] for s,p in zip(residential,sites)),.5)

    def test_gap_between_existing_frontages_gets_fill_priority(self):
        c=City(flat_world());road(c,[[500,1800],[3500,1800]])
        sites=sorted([p for p in c.s['parcels'] if p['center'][1]>1800],key=lambda p:p['frontage'][0])
        for p in (sites[4],sites[6]):complete(c,p,'residential')
        update_location_context(c)
        gap=sites[5];far=sites[-1]
        self.assertTrue(gap['infillGap']);self.assertFalse(far['infillGap'])
        self.assertGreater(gap['frontageFill'],far['frontageFill'])
        opposite=min((p for p in c.s['parcels'] if p['center'][1]<1800),key=lambda p:math.dist(p['frontage'],gap['frontage']))
        self.assertFalse(opposite['infillGap'])

    def test_empty_roads_do_not_create_endless_streets_but_filled_blocks_expand(self):
        c=block_city();c.s['settings']['autoGrow']=True;c.s['month']=12;c.rebuild(regenerate=True)
        self.assertFalse(grow_block_streets(c))
        target=c.s['streetPlans'][0];region=Polygon(target['block'])
        for p in c.s['parcels']:
            if region.covers(Point(p['center'])):complete(c,p,'residential')
        self.assertTrue(street_extension_ready(c,LineString(target['points']),block=target['block']))
        self.assertTrue(grow_block_streets(c))
        self.assertTrue(any(r.get('generated') for r in c.s['roads']))

    def test_v4_save_keeps_existing_footprints_and_adds_new_policy(self):
        c=block_city();complete(c,c.s['parcels'][0],'residential')
        s=c.snapshot();s['model']=s['state']['version']='shanhai-city-4'
        for key in ('streetFillThreshold','frontageInfillMeters','frontageInfillBonus'):s['state']['policy'].pop(key)
        restored=City.restore(copy.deepcopy(s))
        self.assertEqual(restored.s['version'],MODEL_VERSION)
        self.assertEqual(restored.s['parcels'][0]['building']['footprint'],s['state']['parcels'][0]['building']['footprint'])
        self.assertGreater(restored.s['policy']['streetFillThreshold'],0)


if __name__=='__main__':unittest.main()
