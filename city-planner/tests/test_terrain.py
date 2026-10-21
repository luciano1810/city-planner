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
from height_format import decode_heights, sea_level_meters


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
                data = decode_heights(result)[0].ravel()
                self.assertEqual(data.size, result['width'] * result['height'])
                self.assertGreater(float(data.max()) - float(data.min()), 550)
                self.assertGreaterEqual(result['stats']['landPercent'], 0)
                self.assertLessEqual(result['stats']['landPercent'], 100)
                self.assertEqual(len(base64.b64decode(result['moisture'])), data.size)
                self.assertEqual(len(base64.b64decode(result['water'])), data.size * 4)
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
        field = decode_heights(result)[0]
        sea = sea_level_meters(result['config'])
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
        self.assertGreater(np.count_nonzero(np.isfinite(decode_heights(with_lakes)[1])), 0)

    def test_delta_adds_coastal_deposition_and_channels(self):
        bay = generate({**self.options, 'preset': 'bay'})
        delta = generate({**self.options, 'preset': 'bay', 'delta': 90})
        self.assertNotEqual(bay['elevation'], delta['elevation'])
        self.assertGreater(np.count_nonzero(np.isfinite(decode_heights(delta)[1])), 0)
        self.assertFalse(any(c['kind'] == 'distributary' for c in bay['channels']))
        self.assertTrue(any(c['kind'] == 'estuary' for c in bay['channels']))
        self.assertTrue(any(c['kind'] == 'distributary' for c in delta['channels']))
        disabled = generate({**self.options, 'preset': 'bay', 'delta': 90, 'riverDensity': 0})
        self.assertEqual(np.count_nonzero(np.isfinite(decode_heights(disabled)[1])), 0)

    def test_rivers_are_incised_water_bodies_with_increasing_width(self):
        result = self.result
        shape = (result['height'], result['width'])
        heights = decode_heights(result)[0].ravel().reshape(shape)
        water = decode_heights(result)[1]
        self.assertTrue(result['channels'])
        for river in result['channels']:
            self.assertGreaterEqual(river['widths'][-1], river['widths'][0])
            self.assertTrue(np.all(np.diff(river['levels']) <= 1e-3))
            points = np.rint(np.asarray(river['points']) * [shape[1] - 1, shape[0] - 1]).astype(int)
            covered = np.maximum(sea_level_meters(result['config']), water[points[:, 1], points[:, 0]]) > heights[points[:, 1], points[:, 0]]
            self.assertGreater(covered.mean(), .9)
        wide = generate({**self.options, 'riverWidth': 300})
        self.assertGreater(np.count_nonzero(np.isfinite(decode_heights(wide)[1])), np.count_nonzero(np.isfinite(water)))

    def test_delta_has_staggered_junctions_and_open_sea_outlets(self):
        result = generate({**self.options, 'preset': 'bay', 'delta': 80})
        channels = [c for c in result['channels'] if c['kind'] == 'distributary']
        starts = [tuple(np.round(c['points'][0], 5)) for c in channels]
        junctions = {p for p in starts if starts.count(p) > 1}
        self.assertGreaterEqual(len(junctions), 2)
        field = decode_heights(result)[0]
        outlets = [c for c in channels if c.get('outlet')]
        self.assertGreaterEqual(len(outlets), 3)
        for river in outlets:
            x, y = river['points'][-1]
            self.assertLess(field[round(y * (result['height'] - 1)), round(x * (result['width'] - 1))], sea_level_meters(result['config']))

    def test_invalid_inputs_are_rejected(self):
        for options in [[], {'preset': 'unknown'}, {'seed': ''}, {'seed': 'x' * 81}, {'resolution': 100000}, {'resolution': True}, {'elevation': float('nan')}, {'sea': -1}, {'roughness': True}, {'moisture': 'wet'}, {'widthKm': 0}, {'widthKm': 1000, 'heightKm': 1}, {'lakeCount': 2.5}, {'riverWidth': -1}, {'delta': 101}]:
            with self.subTest(options=options), self.assertRaises(ValueError):
                validate(options)


class RiverMouthTests(unittest.TestCase):
    def test_channel_and_bank_modifications_stop_at_original_shoreline(self):
        h = np.full((50, 100), 3312, dtype=np.float32)
        h[:, 50:75] = 2879.28
        h[:, 75:] = 2304
        original = h.copy()
        water = np.full_like(h, -np.inf)
        river = {'points': [[.1, .5], [.95, .5]], 'widths': [8, 8], 'levels': [2916, 2880], 'kind': 'distributary'}
        carve_channels(h, water, [river], 2880)
        ocean = original < 2880
        np.testing.assert_array_equal(h[ocean], original[ocean])
        self.assertFalse(np.any(np.isfinite(water[ocean])))
        self.assertGreater(water[25, 49], h[25, 49])
        self.assertLess(h[25, 49], original[25, 49])

    def test_tributaries_can_still_join_previously_carved_water(self):
        h = np.full((40, 80), 3240, dtype=np.float32)
        water = np.full_like(h, -np.inf)
        main = {'points': [[.05, .5], [.95, .5]], 'widths': [7, 7], 'levels': [2880, 2880], 'kind': 'estuary'}
        branch = {'points': [[.5, .1], [.5, .5]], 'widths': [3, 4], 'levels': [2952, 2880], 'kind': 'river'}
        carve_channels(h, water, [main], 2880)
        carve_channels(h, water, [branch], 2880)
        self.assertGreater(water[20, 40], h[20, 40])


class HydrologyRefinementTests(unittest.TestCase):
    def test_flatness_reduces_slopes_without_moving_coast(self):
        yy, xx = np.mgrid[:100, :160]
        h = (2880 + xx * 9 + np.sin(xx * .8) * 144 + np.cos(yy * .7) * 144).astype('f4')
        h[:, :20] = 2160
        smooth = flatten_terrain(h, 2880, 85)
        np.testing.assert_array_equal(h < 2880, smooth < 2880)
        np.testing.assert_array_equal(h[:, :20], smooth[:, :20])
        original_slope = sum(np.abs(g[:, 30:]).mean() for g in np.gradient(h))
        new_slope = sum(np.abs(g[:, 30:]).mean() for g in np.gradient(smooth))
        self.assertLess(new_slope, original_slope * .5)
        self.assertEqual(validate({'flatness': 80})['flatness'], 80)
        for value in [-1, 101, True, float('nan')]:
            with self.assertRaises(ValueError):
                validate({'flatness': value})

    def test_overflow_lake_connects_but_closed_basin_remains(self):
        h = np.tile(np.linspace(3744, 2160, 100, dtype='f4'), (80, 1))
        water = np.full_like(h, -np.inf)
        water[36:44, 28:36] = 3312
        h[36:44, 28:36] = 3168
        cfg = validate({'riverDensity': 60, 'moisture': 70})
        outlets = lake_outlets(h, water, water.copy(), 2880, cfg)
        self.assertEqual(len(outlets), 1)
        self.assertTrue(np.all(np.diff(outlets[0]['levels']) <= 1e-3))
        carve_channels(h, water, outlets, 2880)
        pts = np.rint(np.array(outlets[0]['points']) * [99, 79]).astype(int)
        self.assertGreater((np.maximum(2880, water[pts[:, 1], pts[:, 0]]) > h[pts[:, 1], pts[:, 0]]).mean(), .9)
        closed = np.full((80, 100), 5400, dtype='f4')
        closed[:, 80:] = 2160
        closed[36:44, 28:36] = 3168
        lake = np.full_like(closed, -np.inf); lake[36:44, 28:36] = 3312
        self.assertEqual(lake_outlets(closed, lake, lake, 2880, cfg), [])

    def test_main_route_avoids_a_high_ridge(self):
        h = np.full((100, 140), 3096, dtype='f4')
        h[25:75, 55:85] = 6480
        path = terrain_path(h, [.1, .5], [.9, .5], 2880)
        pixels = np.rint(path * [139, 99]).astype(int)
        self.assertLess(h[pixels[:, 1], pixels[:, 0]].max(), 3600)
        np.testing.assert_allclose(path[[0, -1]], [[.1, .5], [.9, .5]])

    def test_delta_reproducibility_and_different_seed_outlets(self):
        options = {'preset': 'bay', 'bayStyle': 'gulf', 'resolution': 768, 'lakeCount': 0, 'delta': 80}
        first = generate({**options, 'seed': 'SHANHAI-2026'})
        self.assertEqual(first['elevation'], generate({**options, 'seed': 'SHANHAI-2026'})['elevation'])
        for result in [first, generate({**options, 'seed': 'bay-regression-2'})]:
            field = decode_heights(result)[0]
            outlets = [c for c in result['channels'] if c.get('outlet')]
            self.assertGreaterEqual(len(outlets), 2)
            for river in outlets:
                self.assertTrue(np.all(np.diff(river['levels']) <= 1e-3))
                px, py = np.rint(np.array(river['points'][-1]) * [result['width'] - 1, result['height'] - 1]).astype(int)
                self.assertLess(field[py, px], sea_level_meters(result['config']))

    def test_4k_is_generated_at_native_resolution_with_metric_grid(self):
        # A narrow 4K map exercises the real high-resolution path with bounded
        # memory. The full-size bay is also checked in the desktop preview.
        result = generate({'resolution': 4096, 'widthKm': 8, 'heightKm': 1,
                           'riverDensity': 0, 'lakeCount': 0, 'flatness': 50})
        self.assertEqual((result['width'], result['height']), (4096, 512))
        self.assertEqual(len(base64.b64decode(result['elevation'])), 4096 * 512 * 4)
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
