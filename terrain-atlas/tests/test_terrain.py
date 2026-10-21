import base64
import json
from pathlib import Path
import subprocess
import sys
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from terrain import generate, validate, PRESETS, flatten_terrain
from hydrology import carve_channels, lake_outlets, terrain_path


class TerrainTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.options = {'bayStyle': 'gulf', 'seed': 'repeatable-测试', 'resolution': 768, 'lakeCount': 0, 'delta': 0}
        cls.result = generate(cls.options)

    def test_seed_reproduces_field(self):
        again = generate(self.options)
        self.assertEqual(self.result['elevation'], again['elevation'])
        self.assertEqual(self.result['moisture'], again['moisture'])
        self.assertEqual(self.result['rivers'], again['rivers'])
        self.assertNotEqual(self.result['elevation'], generate({**self.options, 'seed': 'another'})['elevation'])

    def test_each_preset_has_valid_distinct_elevations(self):
        fingerprints = set()
        for preset in PRESETS:
            with self.subTest(preset=preset):
                result = generate({**self.options, 'preset': preset})
                data = np.frombuffer(base64.b64decode(result['elevation']), dtype='<u2')
                self.assertEqual(data.size, result['width'] * result['height'])
                self.assertGreater(int(data.max()) - int(data.min()), 5000)
                self.assertGreaterEqual(result['stats']['landPercent'], 0)
                self.assertLessEqual(result['stats']['landPercent'], 100)
                self.assertEqual(len(base64.b64decode(result['moisture'])), data.size)
                self.assertEqual(len(base64.b64decode(result['water'])), data.size * 2)
                for river in result['rivers']:
                    self.assertTrue(all(0 <= x <= 1 and 0 <= y <= 1 for x, y in river))
                fingerprints.add(result['elevation'])
        self.assertEqual(len(fingerprints), len(PRESETS))

    def test_sea_level_and_humidity_have_expected_effects(self):
        baseline = generate({**self.options, 'riverDensity': 0})
        high_sea = generate({**self.options, 'sea': 60, 'riverDensity': 0})
        self.assertEqual(baseline['elevation'], high_sea['elevation'])
        self.assertLess(high_sea['stats']['landPercent'], baseline['stats']['landPercent'])
        dry = generate({**self.options, 'moisture': 0})
        wet = generate({**self.options, 'moisture': 100})
        self.assertEqual(dry['elevation'], wet['elevation'])
        self.assertLess(np.frombuffer(base64.b64decode(dry['moisture']), dtype='u1').mean(), np.frombuffer(base64.b64decode(wet['moisture']), dtype='u1').mean())

    def test_bay_has_an_open_mouth_and_connected_rivers(self):
        result = generate({**self.options, 'preset': 'bay'})
        field = np.frombuffer(base64.b64decode(result['elevation']), dtype='<u2').reshape(result['height'], result['width']) / 65535
        sea = result['config']['sea'] / 100
        mid = result['height'] // 2
        self.assertLess(field[mid, -1], sea)
        self.assertGreater(field[mid, 0], sea)
        self.assertGreater(len(result['rivers']), 0)
        for river in result['rivers']:
            for (x1, y1), (x2, y2) in zip(river, river[1:]):
                self.assertLess(abs(x2 - x1), .02)
                self.assertLess(abs(y2 - y1), .02)

    def test_world_extent_controls_aspect_and_water_parameters(self):
        narrow = generate({**self.options, 'widthKm': 20, 'heightKm': 40, 'riverDensity': 0})
        self.assertEqual((narrow['width'], narrow['height']), (384, 768))
        self.assertEqual(narrow['rivers'], [])
        self.assertEqual(narrow['stats']['lakeCount'], 0)
        with_lakes = generate({**self.options, 'lakeCount': 4, 'lakeSize': 2, 'preset': 'hills'})
        self.assertEqual(with_lakes['stats']['lakeCount'], 4)
        self.assertGreater(np.count_nonzero(np.frombuffer(base64.b64decode(with_lakes['water']), dtype='<u2')), 0)

    def test_delta_adds_coastal_deposition_and_channels(self):
        bay = generate({**self.options, 'preset': 'bay'})
        delta = generate({**self.options, 'preset': 'bay', 'delta': 90})
        self.assertNotEqual(bay['elevation'], delta['elevation'])
        self.assertGreater(np.count_nonzero(np.frombuffer(base64.b64decode(delta['water']), dtype='<u2')), 0)
        self.assertFalse(any(c['kind'] == 'distributary' for c in bay['channels']))
        self.assertTrue(any(c['kind'] == 'estuary' for c in bay['channels']))
        self.assertTrue(any(c['kind'] == 'distributary' for c in delta['channels']))
        disabled = generate({**self.options, 'preset': 'bay', 'delta': 90, 'riverDensity': 0})
        self.assertEqual(np.count_nonzero(np.frombuffer(base64.b64decode(disabled['water']), dtype='<u2')), 0)

    def test_rivers_are_incised_water_bodies_with_increasing_width(self):
        result = self.result
        shape = (result['height'], result['width'])
        heights = np.frombuffer(base64.b64decode(result['elevation']), dtype='<u2').reshape(shape)
        water = np.frombuffer(base64.b64decode(result['water']), dtype='<u2').reshape(shape)
        self.assertTrue(result['channels'])
        for river in result['channels']:
            self.assertGreaterEqual(river['widths'][-1], river['widths'][0])
            self.assertTrue(np.all(np.diff(river['levels']) <= 1e-6))
            points = np.rint(np.asarray(river['points']) * [shape[1] - 1, shape[0] - 1]).astype(int)
            covered = np.maximum(result['config']['sea'] / 100 * 65535, water[points[:, 1], points[:, 0]]) > heights[points[:, 1], points[:, 0]]
            self.assertGreater(covered.mean(), .9)
        wide = generate({**self.options, 'riverWidth': 300})
        self.assertGreater(np.count_nonzero(np.frombuffer(base64.b64decode(wide['water']), dtype='<u2')), np.count_nonzero(water))

    def test_delta_has_staggered_junctions_and_open_sea_outlets(self):
        result = generate({**self.options, 'preset': 'bay', 'delta': 80})
        channels = [c for c in result['channels'] if c['kind'] == 'distributary']
        starts = [tuple(np.round(c['points'][0], 5)) for c in channels]
        junctions = {p for p in starts if starts.count(p) > 1}
        self.assertGreaterEqual(len(junctions), 2)
        field = np.frombuffer(base64.b64decode(result['elevation']), dtype='<u2').reshape(result['height'], result['width']) / 65535
        outlets = [c for c in channels if c.get('outlet')]
        self.assertGreaterEqual(len(outlets), 3)
        for river in outlets:
            x, y = river['points'][-1]
            self.assertLess(field[int(y * (result['height'] - 1)), int(x * (result['width'] - 1))], result['config']['sea'] / 100)

    def test_invalid_inputs_are_rejected(self):
        for options in [[], {'preset': 'unknown'}, {'seed': ''}, {'seed': 'x' * 81}, {'resolution': 100000}, {'resolution': True}, {'elevation': float('nan')}, {'sea': -1}, {'roughness': True}, {'moisture': 'wet'}, {'widthKm': 0}, {'widthKm': 1000, 'heightKm': 1}, {'lakeCount': 2.5}, {'riverWidth': -1}, {'delta': 101}]:
            with self.subTest(options=options), self.assertRaises(ValueError):
                validate(options)


class RiverMouthTests(unittest.TestCase):
    def test_channel_and_bank_modifications_stop_at_original_shoreline(self):
        # Include a very shallow shelf: a depth tolerance used to let rivers
        # continue into this area even though it was already open sea.
        h = np.full((50, 100), .46, dtype=np.float32)
        h[:, 50:75] = .3999
        h[:, 75:] = .32
        original = h.copy()
        water = np.zeros_like(h)
        river = {'points': [[.1, .5], [.95, .5]], 'widths': [8, 8], 'levels': [.405, .4], 'kind': 'distributary'}
        carve_channels(h, water, [river], .4)
        ocean = original < .4
        np.testing.assert_array_equal(h[ocean], original[ocean])
        self.assertFalse(np.any(water[ocean]))
        self.assertGreater(water[25, 49], h[25, 49])
        self.assertLess(h[25, 49], original[25, 49])

    def test_tributaries_can_still_join_previously_carved_water(self):
        h = np.full((40, 80), .45, dtype=np.float32)
        water = np.zeros_like(h)
        main = {'points': [[.05, .5], [.95, .5]], 'widths': [7, 7], 'levels': [.4, .4], 'kind': 'estuary'}
        branch = {'points': [[.5, .1], [.5, .5]], 'widths': [3, 4], 'levels': [.41, .4], 'kind': 'river'}
        carve_channels(h, water, [main], .4)
        carve_channels(h, water, [branch], .4)
        self.assertGreater(water[20, 40], h[20, 40])


class HydrologyRefinementTests(unittest.TestCase):
    def test_flatness_reduces_slopes_without_moving_coast(self):
        yy, xx = np.mgrid[:100, :160]
        h = (.4 + xx / 800 + np.sin(xx * .8) * .02 + np.cos(yy * .7) * .02).astype('f4')
        h[:, :20] = .3
        smooth = flatten_terrain(h, .4, 85)
        np.testing.assert_array_equal(h < .4, smooth < .4)
        np.testing.assert_array_equal(h[:, :20], smooth[:, :20])
        original_slope = sum(np.abs(g[:, 30:]).mean() for g in np.gradient(h))
        new_slope = sum(np.abs(g[:, 30:]).mean() for g in np.gradient(smooth))
        self.assertLess(new_slope, original_slope * .5)
        self.assertEqual(validate({'flatness': 80})['flatness'], 80)
        for value in [-1, 101, True, float('nan')]:
            with self.assertRaises(ValueError):
                validate({'flatness': value})

    def test_overflow_lake_connects_but_closed_basin_remains(self):
        h = np.tile(np.linspace(.52, .3, 100, dtype='f4'), (80, 1))
        water = np.zeros_like(h)
        water[36:44, 28:36] = .46
        h[36:44, 28:36] = .44
        cfg = validate({'riverDensity': 60, 'moisture': 70})
        outlets = lake_outlets(h, water, water.copy(), .4, cfg)
        self.assertEqual(len(outlets), 1)
        self.assertTrue(np.all(np.diff(outlets[0]['levels']) <= 1e-6))
        carve_channels(h, water, outlets, .4)
        pts = np.rint(np.array(outlets[0]['points']) * [99, 79]).astype(int)
        self.assertGreater((np.maximum(.4, water[pts[:, 1], pts[:, 0]]) > h[pts[:, 1], pts[:, 0]]).mean(), .9)
        closed = np.full((80, 100), .75, dtype='f4')
        closed[:, 80:] = .3
        closed[36:44, 28:36] = .44
        lake = np.zeros_like(closed); lake[36:44, 28:36] = .46
        self.assertEqual(lake_outlets(closed, lake, lake, .4, cfg), [])

    def test_main_route_avoids_a_high_ridge(self):
        h = np.full((100, 140), .43, dtype='f4')
        h[25:75, 55:85] = .9
        path = terrain_path(h, [.1, .5], [.9, .5], .4)
        pixels = np.rint(path * [139, 99]).astype(int)
        self.assertLess(h[pixels[:, 1], pixels[:, 0]].max(), .5)
        np.testing.assert_allclose(path[[0, -1]], [[.1, .5], [.9, .5]])

    def test_delta_reproducibility_and_different_seed_outlets(self):
        options = {'preset': 'bay', 'bayStyle': 'gulf', 'resolution': 768, 'lakeCount': 0, 'delta': 80}
        first = generate({**options, 'seed': 'SHANHAI-2026'})
        self.assertEqual(first['elevation'], generate({**options, 'seed': 'SHANHAI-2026'})['elevation'])
        for result in [first, generate({**options, 'seed': 'bay-regression-2'})]:
            field = np.frombuffer(base64.b64decode(result['elevation']), dtype='<u2').reshape(result['height'], result['width']) / 65535
            outlets = [c for c in result['channels'] if c.get('outlet')]
            self.assertGreaterEqual(len(outlets), 2)
            for river in outlets:
                self.assertTrue(np.all(np.diff(river['levels']) <= 1e-6))
                px, py = np.rint(np.array(river['points'][-1]) * [result['width'] - 1, result['height'] - 1]).astype(int)
                self.assertLess(field[py, px], result['config']['sea'] / 100)

    def test_4k_is_generated_at_native_resolution_with_metric_grid(self):
        # A narrow 4K map exercises the real high-resolution path with bounded
        # memory. The full-size bay is also checked in the desktop preview.
        result = generate({'resolution': 4096, 'widthKm': 8, 'heightKm': 1,
                           'riverDensity': 0, 'lakeCount': 0, 'flatness': 50})
        self.assertEqual((result['width'], result['height']), (4096, 512))
        self.assertEqual(len(base64.b64decode(result['elevation'])), 4096 * 512 * 2)
        self.assertEqual(result['grid']['pixelSizeMeters'], [1.953125, 1.953125])
        self.assertEqual(validate({'resolution': 2048})['resolution'], 2048)


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import os
        cls.proc = subprocess.Popen([sys.executable, str(ROOT / 'backend/server.py')], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, env={**os.environ, 'TERRAIN_API_TOKEN': 'test-token'})
        ready = json.loads(cls.proc.stdout.readline())
        cls.url = f"http://127.0.0.1:{ready['port']}"

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=5)
        cls.proc.stdout.close()

    def test_health_and_unavailable_static_files(self):
        with urlopen(self.url + '/api/health', timeout=5) as response:
            self.assertEqual(json.load(response)['status'], 'ok')
        with self.assertRaises(HTTPError) as context:
            urlopen(self.url + '/', timeout=5)
        self.assertEqual(context.exception.code, 404)
        context.exception.close()

    def test_generation_auth_validation_and_protocol(self):
        request = Request(self.url + '/api/generate', data=b'{}', headers={'Content-Type': 'application/json'})
        with self.assertRaises(HTTPError) as context:
            urlopen(request, timeout=5)
        self.assertEqual(context.exception.code, 403)
        context.exception.close()
        request.add_header('X-Terrain-Token', 'test-token')
        with urlopen(request, timeout=30) as response:
            result = json.load(response)
            self.assertEqual(result['width'], 1024)
            self.assertIn('elevation', result)
        invalid = Request(self.url + '/api/generate', data=b'{"resolution":99999}', headers={'Content-Type': 'application/json', 'X-Terrain-Token': 'test-token'})
        with self.assertRaises(HTTPError) as context:
            urlopen(invalid, timeout=5)
        self.assertEqual(context.exception.code, 400)
        context.exception.close()


if __name__ == '__main__':
    unittest.main()
