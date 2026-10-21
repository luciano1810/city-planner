"""Physical elevations, shared frontend decoding, city queries and persistence."""
import base64
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from height_format import HEIGHT_ENCODING, encode_heights, decode_heights
from terrain import generate
from city.geometry import Terrain
from city.service import CityService
from city.scenario import valley_world
from tests.test_city import flat_world


class HeightFormatTests(unittest.TestCase):
    def test_shared_renderer_fixture_preserves_metres_and_no_water(self):
        fixture = json.loads((Path(__file__).parent / 'fixtures/metric-heights.json').read_text())
        elevation, water, sea, _ = decode_heights(fixture['data'])
        np.testing.assert_array_equal(elevation.ravel(), fixture['elevation'])
        np.testing.assert_array_equal(water.ravel(), [v if v is not None else -np.inf for v in fixture['water']])
        self.assertEqual(sea, -10)
        self.assertEqual(encode_heights(elevation), fixture['data']['elevation'])
        self.assertEqual(encode_heights(water, water=True), fixture['data']['water'])

    def test_generation_does_not_cap_or_compress_high_mountains(self):
        result = generate(dict(preset='mountains', seed='SHANHAI-2026', resolution=768,
                               elevation=100, roughness=80, riverDensity=0, lakeCount=0))
        elevation, water, sea, _ = decode_heights(result)
        peaks = elevation[elevation > 7200]
        self.assertGreater(peaks.size, 100)
        self.assertGreater(np.unique(peaks).size, 100)
        self.assertGreater(float(elevation.max()), 7500)
        self.assertLess(np.count_nonzero(elevation == elevation.max()), elevation.size * .001)
        self.assertTrue(np.all(np.isneginf(water)))
        self.assertEqual(result['stats']['maxElevation'], int(float(elevation.max()) - sea))

    def test_float_storage_preserves_submetre_relief_above_the_old_limit(self):
        raw = np.linspace(9000, 9001, 1000, dtype=np.float32).reshape(20, 50)
        data = dict(width=50, height=20, heightEncoding=HEIGHT_ENCODING, grid=dict(seaLevelMeters=0),
                    elevation=encode_heights(raw), water=encode_heights(np.full_like(raw, -np.inf), water=True))
        restored, _, _, _ = decode_heights(data)
        np.testing.assert_array_equal(restored, raw)
        self.assertTrue(np.all(np.diff(restored.ravel()) > 0))

    def test_rejects_old_or_invalid_height_data(self):
        data = flat_world()
        for encoding in (None, 'uint16', 'float64'):
            with self.subTest(encoding=encoding), self.assertRaisesRegex(ValueError, '重新生成'):
                decode_heights({**data, 'heightEncoding': encoding})
        for value in (np.nan, np.inf, -np.inf):
            with self.subTest(value=value), self.assertRaises(ValueError):
                encode_heights(np.array([value]))
        for value in (np.nan, np.inf):
            with self.assertRaises(ValueError):
                encode_heights(np.array([value]), water=True)
        bad = copy.deepcopy(data)
        bad['elevation'] = base64.b64encode(np.array([np.nan], dtype='<f4').tobytes()).decode()
        with self.assertRaises(ValueError):
            decode_heights(bad)

    def test_city_samples_height_and_grade_in_metres_with_zero_water_surface(self):
        world = flat_world()
        n = world['width']
        # Exactly 100 m of rise per 50 m grid cell: slope = 2.
        h = np.tile(np.arange(n, dtype=np.float32) * 100 + 9000, (n, 1))
        world['elevation'] = encode_heights(h)
        terrain = Terrain(world)
        sample = terrain.sample([2000, 2000])
        self.assertAlmostEqual(sample['height'], 12950)
        self.assertAlmostEqual(sample['slope'], 2)
        # A zero metre lake above negative ground remains wet even below sea datum.
        world['grid']['seaLevelMeters'] = -20
        world['elevation'] = encode_heights(np.full((n,n), -10, dtype='<f4'))
        water = np.full((n,n), -np.inf, dtype='<f4'); water[:, :n//2] = 0
        world['water'] = encode_heights(water, water=True)
        terrain = Terrain(world)
        self.assertTrue(terrain.sample([500,2000])['water'])
        self.assertFalse(terrain.sample([3500,2000])['water'])

    def test_metric_city_save_and_reload_preserve_height_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            service = CityService(folder)
            world = flat_world()
            key = service.register(world)
            created = service.handle('create', dict(worldId=key))
            service.handle('save', dict(id=created['id'], name='米制地图', mode='new'))
            restored = CityService(folder).handle('load', dict(name='米制地图'))
            self.assertEqual(restored['terrain']['heightEncoding'], HEIGHT_ENCODING)
            for field in ('elevation', 'water', 'grid'):
                self.assertEqual(restored['terrain'][field], world[field])
        scenario = valley_world()
        self.assertEqual(scenario['heightEncoding'], HEIGHT_ENCODING)
        self.assertTrue(Terrain(scenario).sample([3120,0])['water'])
