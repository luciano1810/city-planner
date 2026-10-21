import copy
import json
import unittest
from shapely.geometry import Polygon, Point, LineString
from shapely.ops import unary_union
from city.facility_architecture import generate, STYLES, local_site
from city.auto_facilities import CATALOG, Context, propose_site
from tests.test_city import City, flat_world, road

SHAPES={
 'triangle':[(0,0),(140,0),(30,110),(0,0)],
 'trapezoid':[(0,0),(130,0),(100,100),(12,100),(0,0)],
 'concave':[(0,0),(130,0),(130,45),(65,45),(65,110),(0,110),(0,0)],
 'skew':[(0,0),(120,20),(145,110),(35,90),(0,0)],
}

def facility(kind,shape,style='courtyard',seed='test'):
 return dict(id=seed,kind=kind,name=CATALOG[kind]['name'],points=[[x+1000,y+1000] for x,y in shape],origin=[1060,1050],point=[1060,1050],rotation=23,width=150,depth=120,height=CATALOG[kind]['height'],architectureStyle=style)

class ArchitectureTests(unittest.TestCase):
 def test_all_types_and_shapes_preserve_site_and_roof_holes(self):
  for kind in CATALOG:
   for shape in SHAPES.values():
    for style in STYLES:
     f=facility(kind,shape,style);before=copy.deepcopy(f);a=generate(f);self.assertEqual(f,before);site=local_site(f)
     self.assertIsNotNone(a,kind)
     self.assertLess(abs(sum(Polygon(t).area for t in a['ground'])-site.area),.02)
     for m in a['masses']:
      p=Polygon(m['rings'][0],m['rings'][1:]);self.assertTrue(p.is_valid)
      self.assertTrue(site.buffer(.001).covers(p))
      self.assertLess(abs(sum(Polygon(t).area for t in m['triangles'])-p.area),.02)
      self.assertTrue(all(p.buffer(.001).covers(Polygon(t)) for t in m['triangles']))
     for e in a['features']:self.assertTrue(site.covers(Point(e['x'],e['y']).buffer(e['radius'])))
 def test_seeded_shapes_are_stable_and_not_three_templates(self):
  signatures=set()
  for i in range(30):
   f=facility('hospital',SHAPES['trapezoid'],None,str(i));a=generate(f)
   self.assertEqual(a,generate(json.loads(json.dumps(f))))
   signatures.add(json.dumps(a['masses']))
  self.assertGreater(len(signatures),25)
 def test_road_block_footprints_are_clipped_and_keep_access(self):
  c=City(flat_world(),'街区测试');c.s['settings']['autoGrow']=False
  for points in [[[1000,1000],[1230,1000]],[[1230,1000],[1160,1180]],[[1160,1180],[1000,1180]],[[1000,1180],[1000,1000]]]:road(c,points,'street')
  ctx=Context(c)
  # Isolate spatial placement from population and service-demand eligibility.
  from unittest.mock import patch
  with patch('city.auto_facilities.suitability',return_value=1):
   sites=[f for p in ctx.empty if (f:=propose_site(ctx,'university',p,.78)) and f['siteMode']=='block']
  self.assertTrue(sites)
  self.assertTrue(any(len(f['points'])>5 or Polygon(f['points']).area<f['width']*f['depth']*.95 for f in sites))
  for f in sites:
   p=Polygon(f['points']);self.assertTrue(Polygon(f['blockPoints']).covers(p))
   self.assertFalse(len(ctx.road_tree.query(p,predicate='intersects')))
   self.assertLess(p.boundary.distance(Point(f['accessPoint'])),.01)


class RoofProgramTests(unittest.TestCase):
 def test_roof_modules_are_supported_clear_and_reproducible(self):
  from shapely.geometry import box
  types=set();transforms=set()
  for kind in CATALOG:
   for shape in SHAPES.values():
    f=facility(kind,shape,None,kind+str(shape));a=generate(f)
    self.assertEqual(a,generate(copy.deepcopy(f)))
    for i,m in enumerate(a['masses']):
     p=Polygon(m['rings'][0],m['rings'][1:]);top=m['base']+m['height'];plan=m['roofPlan'];footprints=[]
     transforms.add((plan['variant'],plan['uvAngle'],round(plan['uvScale'],2)))
     for u in plan['units']:
      types.add(u['type']);rect=box(u['x']-u['w']/2,u['y']-u['d']/2,u['x']+u['w']/2,u['y']+u['d']/2)
      self.assertTrue(p.buffer(.001).covers(rect),kind)
      for j,other in enumerate(a['masses']):
       if i!=j and other['base']>=top-.01:self.assertLess(rect.intersection(Polygon(other['rings'][0],other['rings'][1:])).area,.001)
      for prev in footprints:self.assertLess(rect.intersection(prev).area,.001)
      footprints.append(rect)
      if plan['marker']:self.assertFalse(rect.intersects(Point(plan['marker']).buffer(3)))
  self.assertTrue({'plantroom','chiller','solar','garden','terrace','pergola','skylight','rooflight','duct'}<=types,types)
  self.assertGreater(len(transforms),40)
