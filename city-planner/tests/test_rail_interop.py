import json
import unittest
from tests.test_city import City, flat_world

class RailInteropTests(unittest.TestCase):
    def setUp(self):
        self.city=City(flat_world())
    def road(self,kind,points,level=0,**kw):
        self.city.command(dict(type='road',kind=kind,points=points,level=level,snap=False,**kw))
        return self.city.s['roads'][-1]['id']
    def shared(self,a,b):
        nodes=lambda rid:{e[k] for e in self.city.network['edges'] if e['road']==rid for k in ('a','b')}
        return nodes(a)&nodes(b)
    def test_same_level_intersection(self):
        for level in (-1,0,1):
            self.city=City(flat_world())
            a=self.road('train',[[500,1000],[1500,1000]],level)
            b=self.road('metro',[[1000,500],[1000,1500]],level)
            self.assertEqual(len(self.shared(a,b)),1)
    def test_cross_level_requires_explicit_connection(self):
        a=self.road('train',[[500,1000],[1500,1000]])
        b=self.road('metro',[[1000,1000],[1000,1500]],-1,connections=[])
        self.assertFalse(self.shared(a,b))
        self.city.command(dict(type='road_edit',id=b,kind='metro',level=-1,points=[[1000,1000],[1000,1500]],snap=False,connections=[dict(road=a,point=[1000,1000])]))
        self.assertTrue(self.shared(a,b))
    def test_curved_mixed_network_supports_both_lines_and_reload(self):
        self.road('train',[[500,1000],[1000,1000]])
        self.road('metro',[[1000,1000],[1250,1070],[1500,1200]],shape='curve')
        ids=[]
        for mode,p in [('metro',[500,1000]),('train',[1500,1200])]:
            self.city.command(dict(type='stop',mode=mode,point=p))
            ids.append(self.city.s['stops'][-1]['id'])
        for mode in ('train','metro'):
            self.city.command(dict(type='line',mode=mode,stops=ids))
            self.assertTrue(self.city.s['lines'][-1]['valid'])
            self.assertGreater(self.city.s['lines'][-1]['length'],1000)
        restored=City.restore(json.loads(json.dumps(self.city.snapshot())))
        self.assertTrue(all(l['valid'] for l in restored.s['lines']))
    def test_road_and_tram_stay_separate(self):
        a=self.road('train',[[500,1000],[1500,1000]])
        for kind,x in [('tram',900),('street',1100)]:
            b=self.road(kind,[[x,500],[x,1500]])
            self.assertFalse(self.shared(a,b))
    def test_backend_snap_to_other_rail_type(self):
        self.road('train',[[500,1000],[1500,1000]])
        self.city.command(dict(type='road',kind='metro',points=[[1000,1008],[1000,1500]]))
        self.assertEqual(self.city.s['roads'][-1]['points'][0],[1000,1000])
