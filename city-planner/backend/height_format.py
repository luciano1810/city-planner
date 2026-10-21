"""Versioned height storage. Runtime elevation and water surfaces use metres.

The local vertical datum is fixed; seaLevelMeters is the water plane relative
to it. A missing inland water surface is -Infinity, never a physical height.
Only the explicit metre-based format is accepted.
"""
import base64
import numpy as np

HEIGHT_ENCODING = 'float32-le-meters'
MAX_SAVE_BYTES = 350_000_000  # Includes two float32 grids at 4096² plus city data.


def sea_level_meters(config):
    # The sea control is a generation parameter (15–70%), not a storage scale.
    return float(config['sea']) * 72


def encode_heights(values, *, water=False):
    field = np.asarray(values, dtype='<f4')
    valid = np.isfinite(field) | (water & np.isneginf(field))
    if not np.all(valid):
        raise ValueError('高度必须为有限的米值；无水区域使用 -Infinity')
    return base64.b64encode(field.tobytes()).decode()


def decode_heights(data):
    """Return elevation, inland water surface, sea level and wet tolerance in m."""
    if data.get('heightEncoding') != HEIGHT_ENCODING:
        raise ValueError('不支持的高度格式，请重新生成米制地图')
    shape = (data['height'], data['width'])
    grids = [np.frombuffer(base64.b64decode(data[key], validate=True), dtype='<f4').reshape(shape)
             for key in ('elevation', 'water')]
    elevation, water = grids
    sea = float(data['grid']['seaLevelMeters'])
    tolerance = .001
    if not np.isfinite(sea) or not np.all(np.isfinite(elevation)) or not np.all(np.isfinite(water) | np.isneginf(water)):
        raise ValueError('无效的地形高度')
    return elevation, water, sea, tolerance
