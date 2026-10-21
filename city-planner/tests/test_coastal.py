import base64
from collections import deque
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from terrain import generate, validate
from height_format import decode_heights
from coastal import BAY_STYLES
from hydrology import drainage, soften_reach, carve_channels


def heights(result):
    return decode_heights(result)[0]


class RandomBayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.options = dict(preset='bay', resolution=768, lakeCount=0,
                           riverDensity=55, delta=65)
        cls.maps = [generate({**cls.options, 'seed': seed}) for seed in
                    ('SHANHAI-2026', 'open-coast', 'branching-bay', 'island-harbour')]

    def test_default_is_repeatable_compositional_coast(self):
        self.assertEqual(validate({})['bayStyle'], 'random')
        self.assertEqual(self.maps[0]['elevation'],
                         generate({**self.options, 'seed':'SHANHAI-2026'})['elevation'])
        self.assertEqual(len({r['elevation'] for r in self.maps}), 4)

    def test_sea_is_open_and_orientation_varies(self):
        orientations = set()
        for result in self.maps:
            with self.subTest(seed=result['config']['seed']):
                wet = heights(result) < 3023.28
                self.assertGreater(wet.mean(), .08)
                self.assertLess(wet.mean(), .90)
                edges = [wet[:,0].mean(), wet[:,-1].mean(),
                         wet[0,:].mean(), wet[-1,:].mean()]
                orientations.add(int(np.argmax(edges)))
                seen = np.zeros_like(wet)
                edge = np.zeros_like(wet)
                edge[[0,-1],:] = True
                edge[:,[0,-1]] = True
                seen[wet & edge] = True
                queue = deque(map(tuple, np.argwhere(seen)))
                while queue:
                    y, x = queue.popleft()
                    for dy, dx in ((-1,0),(1,0),(0,-1),(0,1)):
                        ny, nx = y+dy, x+dx
                        if 0 <= ny < wet.shape[0] and 0 <= nx < wet.shape[1] and wet[ny,nx] and not seen[ny,nx]:
                            seen[ny,nx] = True
                            queue.append((ny,nx))
                self.assertGreater(seen.sum()/wet.sum(), .97)
        self.assertGreaterEqual(len(orientations), 2)

    def test_river_outlets_and_disabled_controls(self):
        for result in self.maps:
            outlets = [c for c in result['channels'] if c.get('outlet')]
            self.assertTrue(outlets, result['config']['seed'])
            h = heights(result)
            for channel in outlets:
                self.assertTrue(np.all(np.diff(channel['levels']) <= 1e-3))
                x,y = np.rint(np.asarray(channel['points'][-1])*[h.shape[1]-1,h.shape[0]-1]).astype(int)
                self.assertLessEqual(h[y,x], 3024.36)
        dry = generate({**self.options, 'seed':'SHANHAI-2026', 'riverDensity':0})
        self.assertEqual(dry['channels'], [])
        self.assertFalse(np.any(np.isfinite(decode_heights(dry)[1])))


class CoastalRegionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.options = dict(preset='bay', seed='SHANHAI-2026', resolution=768,
                           lakeCount=0, riverDensity=55, delta=65)
        cls.maps = {style: generate({**cls.options, 'bayStyle': style})
                    for style in sorted(BAY_STYLES - {'gulf', 'random'})}

    def test_six_distinct_regions_and_open_sea(self):
        self.assertEqual(len({result['elevation'] for result in self.maps.values()}), 6)
        for style, result in self.maps.items():
            with self.subTest(style=style):
                h = heights(result)
                wet = h < 3024
                self.assertGreater(wet.mean(), .12)
                self.assertLess(wet.mean(), .85)
                # Connected sea must dominate: don't mistake a large inland
                # lake enclosed by a broken entrance for a bay.
                seen = np.zeros_like(wet)
                edge = np.zeros_like(wet)
                edge[[0, -1], :] = True
                edge[:, [0, -1]] = True
                queue = deque(map(tuple, np.argwhere(wet & edge)))
                seen[wet & edge] = True
                while queue:
                    y, x = queue.popleft()
                    for dy, dx in ((-1,0),(1,0),(0,-1),(0,1)):
                        ny, nx = y+dy, x+dx
                        if 0 <= ny < h.shape[0] and 0 <= nx < h.shape[1] and wet[ny,nx] and not seen[ny,nx]:
                            seen[ny,nx] = True
                            queue.append((ny,nx))
                self.assertGreater(seen.sum()/wet.sum(), .97)

    def test_lowlands_and_mountains_are_regionally_distributed(self):
        tokyo, hk, van = (heights(self.maps[s]) for s in ('tokyo','hong_kong','vancouver'))
        low = lambda h: np.count_nonzero((h > 3024) & (h < 3168)) / np.count_nonzero(h > 3024)
        self.assertGreater(low(tokyo), low(hk))
        north, south = van[:van.shape[0]//3], van[van.shape[0]*2//3:]
        self.assertGreater(np.median(north[north > 3024]), np.median(south[south > 3024]) + 144)

    def test_main_rivers_reach_sea_and_descend(self):
        for style in ('tokyo', 'vancouver', 'san_francisco'):
            result = self.maps[style]
            h = heights(result)
            trunks = [c for c in result['channels'] if c.get('outlet')]
            with self.subTest(style=style):
                self.assertTrue(trunks)
                for river in trunks:
                    self.assertTrue(np.all(np.diff(river['levels']) <= 1e-3))
                    x, y = np.rint(np.asarray(river['points'][-1]) * [h.shape[1]-1,h.shape[0]-1]).astype(int)
                    self.assertLessEqual(h[y,x], 3024.36)
                    self.assertGreater(len(river['points']), 10)

    def test_seed_repeatability_and_variation(self):
        opts = {**self.options, 'bayStyle': 'tokyo'}
        self.assertEqual(self.maps['tokyo']['elevation'], generate(opts)['elevation'])
        self.assertNotEqual(self.maps['tokyo']['elevation'], generate({**opts, 'seed':'other-coast'})['elevation'])

    def test_deposition_and_river_controls(self):
        for style in ('tokyo', 'vancouver'):
            plain = generate({**self.options, 'bayStyle': style, 'delta': 0})
            developed = self.maps[style]
            self.assertGreater(np.count_nonzero(heights(developed) > 3024), np.count_nonzero(heights(plain) > 3024))
        dry = generate({**self.options, 'bayStyle': 'vancouver', 'riverDensity': 0})
        self.assertEqual(dry['channels'], [])
        self.assertFalse(np.any(np.isfinite(decode_heights(dry)[1])))

    def test_style_validation_and_legacy_api(self):
        self.assertEqual(validate({})['bayStyle'], 'random')
        for invalid in ('missing-city', [], None):
            with self.assertRaises(ValueError):
                validate({'bayStyle': invalid})


class RiverNetworkTests(unittest.TestCase):
    def test_vector_water_bodies_do_not_include_incised_river_pixels(self):
        opts = dict(preset='bay', seed='open-coast', resolution=768,
                    lakeCount=0, delta=0)
        dry = generate({**opts, 'riverDensity':0})
        wet = generate({**opts, 'riverDensity':55})
        self.assertEqual(dry['waterBodies'],wet['waterBodies'])
        size = wet['width']*wet['height']
        ocean = np.unpackbits(np.frombuffer(base64.b64decode(wet['waterBodies']['ocean']),dtype='u1'))[:size]
        lakes = np.unpackbits(np.frombuffer(base64.b64decode(wet['waterBodies']['lakes']),dtype='u1'))[:size]
        self.assertTrue(np.any(ocean))
        self.assertFalse(np.any(lakes))
        self.assertTrue(wet['channels'])
        h = heights(dry).ravel()
        stable = np.abs(h-3024) > .001
        np.testing.assert_array_equal(ocean[stable],h[stable] < 3024)

    def test_channel_depth_is_independent_of_output_resolution(self):
        depths = []
        for scale in (1, 2):
            h = np.full((60*scale,120*scale), 3312, dtype=np.float32)
            water = np.full_like(h, -np.inf)
            # Coordinates pin the center to a pixel at either resolution.
            y = 30*scale/(h.shape[0]-1)
            river = {'points': [[.1,y],[.9,y]], 'widths': [10*scale]*2,
                     'levels': [3240]*2, 'kind': 'river'}
            carve_channels(h, water, [river], 2880, cell_size_m=10/scale)
            depths.append(3240-float(h[30*scale,60*scale]))
        self.assertAlmostEqual(depths[0], depths[1], places=3)
        self.assertGreater(depths[0], 1)
        self.assertLess(depths[0], 8)

    def test_regional_river_does_not_excavate_a_broad_corridor(self):
        opts = dict(preset='bay', bayStyle='vancouver', seed='SHANHAI-2026',
                    resolution=768, lakeCount=0, delta=0)
        dry = generate({**opts, 'riverDensity': 0})
        wet = generate({**opts, 'riverDensity': 55})
        before, after = heights(dry), heights(wet)
        # A wide valley stamp changed large swaths by tens/hundreds of metres.
        # Only the local bed and banks should change when rivers are enabled.
        changed = (before-after) > 1
        self.assertLess(changed.mean(), .07)
        self.assertTrue(any(c.get('outlet') for c in wet['channels']))

    def test_thin_existing_channel_between_samples_receives_tributaries(self):
        yy, xx = np.mgrid[:192, :320]
        h = (3240 + np.abs(yy-95)*5.04 + 108*np.sin(xx*.05)**2).astype(np.float32)
        water = np.full_like(h, -np.inf)
        h[95, :] = 3168
        water[95, :] = 3204  # Odd row: old stride-2 point sampling missed it.
        cfg = validate({'riverDensity': 100, 'riverWidth': 10})
        rivers = drainage(h, 1440, water, cfg)
        mouths = [np.asarray(r['points'][-1])*[319,191] for r in rivers]
        connected = [p for p in mouths if abs(p[1]-95) < .01]
        self.assertGreaterEqual(len(connected), 2)
        edges = []
        for r in rivers:
            pts = [tuple(np.round(p, 7)) for p in r['points']]
            edges.extend((a,b) for a,b in zip(pts[:-1],pts[1:]) if a != b)
            self.assertTrue(np.all(np.diff(r['levels']) <= 1e-3))
        self.assertEqual(len(edges), len(set(edges)))

    def test_curve_smoothing_stays_inside_its_routing_corridor(self):
        points = np.array([[.1,.2],[.2,.2],[.2,.3],[.3,.3],[.3,.4],[.4,.4]])
        result = soften_reach(points, 8, (256,256))
        offset = np.linalg.norm((result-points)*255, axis=1)
        self.assertLessEqual(offset.max(), 8*.45 + 1e-6)
        np.testing.assert_array_equal(result[[0,-1]], points[[0,-1]])
