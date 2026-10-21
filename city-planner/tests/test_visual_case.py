"""The visual reference remains an editable, valid city rather than a raster backdrop."""
import copy
import json
import math
from pathlib import Path
import sys
import tempfile
import unittest
from shapely import affinity
from shapely.geometry import Polygon, LineString, Point, box

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from city.service import CityService
from city.engine import City
from city.geometry import building_footprint
from city.visual_case import SITES


class ArchitecturalCaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.service = CityService(cls.directory.name)
        cls.result = cls.service.handle('scenario', {'variant': 'architectural'})
        cls.city = cls.service.cities[cls.result['id']]

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def test_every_building_remains_inside_its_parcel_and_clear_of_roads(self):
        state = self.result['city']
        self.assertEqual(len(state['parcels']), 16)
        for p in state['parcels']:
            footprint = Polygon(p['building']['footprint'])
            self.assertTrue(Polygon(p['points']).buffer(.001).covers(footprint))
            for road in state['roads']:
                width = state['meta']['roadTypes'][road['kind']]['width']
                self.assertLess(footprint.intersection(LineString(road['points']).buffer(width/2)).area, .01)

    def test_export_restores_the_editable_objects_clock_and_actual_traffic(self):
        snapshot = json.loads(json.dumps(self.city.snapshot(), allow_nan=False))
        restored = City.restore(snapshot)
        self.assertEqual(restored.s['roads'], self.city.s['roads'])
        self.assertEqual(restored.s['parcels'], self.city.s['parcels'])
        self.assertEqual(restored.s['facilities'], self.city.s['facilities'])
        self.assertEqual(restored.s['sceneTimeSeconds'], 36000)
        self.assertEqual(restored.live_traffic.view(), self.city.live_traffic.view())
        self.assertGreater(len(restored.live_traffic.cars), 0)
        self.assertEqual(self.result['terrain']['config']['preset'], 'hills')

    def test_front_walls_follow_the_actual_local_road_tangent(self):
        roads={r['id']:LineString(r['points']) for r in self.city.s['roads']}
        diagonal=0
        for p in self.city.s['parcels']:
            line=roads[p['road']];d=line.project(Point(p['building']['center']))
            a,b=line.interpolate(max(0,d-1)),line.interpolate(min(line.length,d+1))
            angle=math.degrees(math.atan2(b.y-a.y,b.x-a.x))
            self.assertAlmostEqual(p['streetAngle'],angle)
            local=affinity.rotate(Polygon(p['building']['footprint']),-angle,origin=p['center'])
            self.assertAlmostEqual(local.area,box(*local.bounds).area,places=6)
            diagonal+=abs(math.sin(math.radians(angle*2)))>.15
        self.assertGreaterEqual(diagonal,5)

    def legacy_snapshot(self):
        snapshot=self.city.snapshot();snapshot['state'].pop('visualLayoutVersion')
        for p,(x,y,w,d,_,_) in zip(snapshot['state']['parcels'],SITES):
            p['streetAngle']=0
            p['building']['footprint']=[list(q) for q in box(x-w/2,y-d/2,x+w/2,y+d/2).exterior.coords]
        return snapshot

    def test_old_showcase_saves_upgrade_without_changing_land_capacity_or_time(self):
        snapshot=self.legacy_snapshot();before=copy.deepcopy(snapshot)
        restored=City.restore(snapshot)
        self.assertEqual(snapshot,before)
        for key in ('roads','households','treasury','history','month','simulation','sceneTimeSeconds'):
            self.assertEqual(restored.s[key],before['state'][key],key)
        changed=0
        for old,p in zip(before['state']['parcels'],restored.s['parcels']):
            self.assertEqual(old['points'],p['points'])
            for key in ('id','capacity','positions','floors','floorArea','footprintArea','cost'):
                self.assertEqual(old['building'][key],p['building'][key])
            changed+=not Polygon(old['building']['footprint']).equals_exact(Polygon(p['building']['footprint']),1e-6)
            self.assertTrue(Polygon(p['points']).covers(Polygon(p['building']['footprint'])))
        self.assertGreaterEqual(changed,5)
        self.assertEqual(restored.live_traffic.clock,self.city.live_traffic.clock)
        self.assertEqual(len(restored.live_traffic.cars),len(self.city.live_traffic.cars))
        self.assertEqual(City.restore(restored.snapshot()).s['parcels'],restored.s['parcels'])

    def test_upgrade_retains_user_edits_and_respects_new_reservations(self):
        snapshot=self.legacy_snapshot();parcels=snapshot['state']['parcels']
        edited=parcels[1];shape=affinity.rotate(Polygon(edited['building']['footprint']),10,origin=edited['center'])
        edited['building']['footprint']=[list(q) for q in shape.exterior.coords]
        blocked=parcels[2];old=Polygon(blocked['building']['footprint'])
        rotated=Polygon(self.city.s['parcels'][2]['building']['footprint'])
        reserved=rotated.difference(old.buffer(.1)).representative_point().buffer(.1)
        facility=copy.deepcopy(snapshot['state']['facilities'][0])
        facility.update(id='edited-park',kind='park',point=list(reserved.centroid.coords[0]),points=[list(q) for q in reserved.exterior.coords])
        snapshot['state']['facilities'].append(facility)
        restored=City.restore(snapshot)
        for original in (edited,blocked):
            self.assertEqual(restored.parcelmap[original['id']]['building']['footprint'],original['building']['footprint'])

    def test_ordinary_frontage_uses_the_road_axis_even_with_an_offset_lot_centroid(self):
        for angle in (0,27,64,135):
            land=affinity.rotate(Polygon([(0,8),(64,8),(42,60),(0,60)]),angle,origin=(0,0))
            parcel=dict(id='offset-frontage',points=list(land.exterior.coords),streetAngle=angle,
                frontage=list(affinity.rotate(Point(8,0),angle,origin=(0,0)).coords[0]),center=list(land.centroid.coords[0]))
            for use in ('office','residential','commercial'):
                footprint=building_footprint(parcel,use,maximum=420)
                self.assertTrue(land.covers(footprint))
                local=affinity.rotate(footprint,-angle,origin=(0,0));coords=list(local.exterior.coords);rear=local.bounds[3]
                self.assertTrue(any(abs(a[1]-rear)<1e-6 and abs(b[1]-rear)<1e-6 and math.dist(a,b)>10 for a,b in zip(coords,coords[1:])))
