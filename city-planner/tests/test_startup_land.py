"""Generated starter land must support the real city construction pipeline."""
import unittest
import numpy as np
from shapely.geometry import box
from tests.test_terrain import generate, PRESETS
from city.engine import City
from city.geometry import Terrain
from startup_land import reserve_startup_land

class StartupLandTests(unittest.TestCase):
    def test_every_preset_has_dry_buildable_start_even_at_high_sea(self):
        for preset in sorted(PRESETS):
            with self.subTest(preset=preset):
                world=generate(dict(seed='startup-extreme',preset=preset,resolution=768,widthKm=1,heightKm=1,
                                    sea=70,elevation=100,roughness=100,lakeCount=2,riverDensity=100,riverWidth=500))
                site=world['startupArea'];cx,cy=site['center'];half=site['sizeMeters']/2
                terrain=Terrain(world)
                self.assertTrue(terrain.buildable(box(cx-half,cy-half,cx+half,cy+half),.08))
                city=City(world);city.s['settings']['autoGrow']=False
                city.command(dict(type='road',kind='street',points=[[cx-half*.8,cy],[cx+half*.8,cy]]))
                self.assertGreater(len(city.s['parcels']),3)
                city.step(1)
                self.assertTrue(any(p.get('building') for p in city.s['parcels']))

    def test_extreme_aspect_ratios_and_coarse_large_maps(self):
        for width,height in [(1,8),(8,1),(1000,125),(125,1000)]:
            with self.subTest(width=width,height=height):
                world=generate(dict(seed='starter-aspect',preset='mountains',resolution=768,
                                    widthKm=width,heightKm=height,sea=70,riverDensity=0,lakeCount=0))
                site=world['startupArea'];cx,cy=site['center'];r=site['sizeMeters']/2
                self.assertTrue(Terrain(world).buildable(box(cx-r,cy-r,cx+r,cy+r),.08))

    def test_terrace_is_local_and_repeatable_across_extents(self):
        for width,height,cols,rows in [(1,1,768,768),(1,8,96,768),(1000,125,768,96)]:
            cfg=dict(widthKm=width,heightKm=height)
            h=np.random.default_rng(12).uniform(0,6000,(rows,cols)).astype('f4')
            before=h.copy();site=reserve_startup_land(h,5000,cfg)
            other=before.copy();again=reserve_startup_land(other,5000,cfg)
            np.testing.assert_array_equal(h,other)
            self.assertEqual(site['center'],again['center'])
            self.assertLess(np.count_nonzero(h!=before)/h.size,.8)
            y0,y1,x0,x1=site['bounds'];changed=np.zeros_like(h,dtype=bool)
            changed[y0:y1,x0:x1]=site['mask']
            np.testing.assert_array_equal(h[~changed],before[~changed])
