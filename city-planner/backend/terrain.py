"""Deterministic, vectorized procedural terrain generation."""
from __future__ import annotations
import base64
import hashlib
import time
import numpy as np
from hydrology import drainage, estuary, carve_channels, lake_outlets
from startup_land import reserve_startup_land, restore_startup_land, outside_startup
from coastal import BAY_STYLES, bay_height, random_bay_height
from height_format import HEIGHT_ENCODING, encode_heights, sea_level_meters

PRESETS = {'island', 'bay', 'mountains', 'desert', 'hills', 'archipelago', 'tundra'}
RESOLUTIONS = {768, 1024, 1536, 2048, 4096}


def validate(options):
    if not isinstance(options, dict):
        raise ValueError('参数必须是 JSON 对象')
    preset = options.get('preset', 'island')
    if preset not in PRESETS:
        raise ValueError('未知的地貌类型')
    seed = str(options.get('seed', 'SHANHAI-2026')).strip()
    if not seed or len(seed) > 80:
        raise ValueError('种子长度须为 1–80 个字符')
    resolution = options.get('resolution', 1024)
    if type(resolution) is not int or resolution not in RESOLUTIONS:
        raise ValueError('不支持的分辨率')
    bay_style = options.get('bayStyle', 'random')
    if not isinstance(bay_style, str) or bay_style not in BAY_STYLES:
        raise ValueError('未知的海湾结构')
    result = {'preset': preset, 'seed': seed, 'resolution': resolution, 'bayStyle': bay_style}
    for key, default, lo, hi in [('sea', 42, 15, 70), ('elevation', 65, 15, 100),
                                  ('roughness', 55, 10, 100), ('flatness', 0, 0, 100), ('moisture', 65, 0, 100),
                                  ('widthKm', 64, 1, 1000), ('heightKm', 48, 1, 1000),
                                  ('riverDensity', 55, 0, 100), ('riverWidth', 90, 10, 500),
                                  ('lakeCount', 3, 0, 12), ('lakeSize', 2, .2, 10), ('delta', 65, 0, 100)]:
        val = options.get(key, default)
        if isinstance(val, bool) or not isinstance(val, (int, float)) or not np.isfinite(val) or not lo <= val <= hi:
            raise ValueError(f'{key} 超出允许范围 {lo}–{hi}')
        result[key] = float(val)
    if not .125 <= result['widthKm'] / result['heightKm'] <= 8:
        raise ValueError('地图长宽比需要在 1:8 至 8:1 之间')
    if not result['lakeCount'].is_integer():
        raise ValueError('湖泊数量必须为整数')
    return result


def noise(x, y, frequency, rng):
    # Coordinates are normalized; lattice padding accommodates domain warping.
    gx = (x + .25) * frequency + 2
    gy = (y + .25) * frequency + 2
    ix, iy = np.floor(gx).astype(np.int32), np.floor(gy).astype(np.int32)
    lattice = rng.random((int(iy.max()) + 3, int(ix.max()) + 3), dtype=np.float32)
    tx, ty = gx - ix, gy - iy
    tx = tx * tx * tx * (tx * (tx * 6 - 15) + 10)
    ty = ty * ty * ty * (ty * (ty * 6 - 15) + 10)
    a = lattice[iy, ix] * (1 - tx) + lattice[iy, ix + 1] * tx
    b = lattice[iy + 1, ix] * (1 - tx) + lattice[iy + 1, ix + 1] * tx
    return (a * (1 - ty) + b * ty).astype(np.float32)


def fractal(x, y, rng, frequency=3, persistence=.5, octaves=7):
    result = np.zeros_like(x)
    amplitude = 1.0
    total = 0.0
    for i in range(octaves):
        result += noise(x, y, frequency * 2 ** i, rng) * amplitude
        total += amplitude
        amplitude *= persistence
    return result / total


def flatten_terrain(h, sea, amount):
    """Reduce metre-based local slopes, keeping the original coastline."""
    if amount <= 0:
        return h
    strength = amount / 100
    radius = max(1, round(max(h.shape) * .035 * strength))
    broad = h.astype(np.float64)
    for _ in range(3):
        for axis in (0, 1):
            padding = [(0, 0), (0, 0)]
            padding[axis] = (radius, radius)
            data = np.pad(broad, padding, mode='edge')
            cumulative = np.cumsum(data, axis=axis)
            zero = list(cumulative.shape); zero[axis] = 1
            cumulative = np.concatenate((np.zeros(zero), cumulative), axis=axis)
            first = [slice(None), slice(None)]; last = first.copy()
            first[axis] = slice(2 * radius + 1, None)
            last[axis] = slice(None, -(2 * radius + 1))
            broad = (cumulative[tuple(first)] - cumulative[tuple(last)]) / (2 * radius + 1)
    land = h > sea
    result = h.copy()
    softened = h * (1 - strength) + broad * strength
    result[land] = sea + np.maximum(.36, softened[land] - sea) * (1 - .45 * strength)
    return result


def add_lakes(h, x, y, detail, cfg, rng, startup=None):
    """Carve irregular enclosed basins; retain each lake's own water surface."""
    sea = sea_level_meters(cfg)
    water = np.full_like(h, -np.inf)
    candidates = np.argwhere((h > sea + 720) & (h < 6192) & (x > .08) & (x < .9) & (y > .10) & (y < .90))
    if len(candidates) == 0:
        return water, 0
    rng.shuffle(candidates)
    centers, count = [], 0
    radius = cfg['lakeSize'] / 2
    for cy, cx in candidates[:2000]:
        if count >= cfg['lakeCount']:
            break
        px, py = float(x[cy, cx]), float(y[cy, cx])
        if any(((px - a) * cfg['widthKm']) ** 2 + ((py - b) * cfg['heightKm']) ** 2 < (radius * 2.8) ** 2 for a, b in centers):
            continue
        rx = min(.14, radius / cfg['widthKm'])
        ry = min(.14, radius / cfg['heightKm'])
        distance = np.sqrt(((x - px) / rx) ** 2 + ((y - py) / ry) ** 2)
        angle = np.arctan2((y - py) / ry, (x - px) / rx)
        shoreline = 1 + np.sin(angle * 3 + count) * .15 + np.sin(angle * 5 - count) * .09
        irregular = distance / shoreline + (detail - .5) * 1.8
        footprint = irregular < 1.30
        if startup:
            y0,y1,x0,x1=startup['bounds']
            if np.any(footprint[y0:y1,x0:x1] & startup['mask']):continue
        if np.any(h[footprint] < sea + 324):
            continue
        level = max(sea + 252, float(h[cy, cx]) - 86.4)
        basin = level - 180 + irregular ** 2 * 180
        blend = np.clip((1.30 - irregular) / .3, 0, 1)
        h[:] = h * (1 - blend) + np.minimum(h, basin) * blend
        mask = (h < level) & (irregular < 1.25)
        water[mask] = level
        centers.append((px, py)); count += 1
    return water, count


def generate(options):
    started = time.perf_counter()
    cfg = validate(options)
    seed_int = int.from_bytes(hashlib.sha256(cfg['seed'].encode()).digest()[:8], 'little')
    rng = np.random.default_rng(seed_int)
    ratio = cfg['widthKm'] / cfg['heightKm']
    width = cfg['resolution'] if ratio >= 1 else round(cfg['resolution'] * ratio)
    height = round(cfg['resolution'] / ratio) if ratio >= 1 else cfg['resolution']
    x, y = np.meshgrid(np.linspace(0, 1, width, dtype=np.float32), np.linspace(0, 1, height, dtype=np.float32))
    warp_x = noise(x, y, 3, rng) - .5
    warp_y = noise(x, y, 3, rng) - .5
    wx, wy = x + warp_x * .16, y + warp_y * .16
    rough = cfg['roughness'] / 100
    base = fractal(wx, wy, rng, frequency=3.5, persistence=.38 + rough * .24)
    detail = fractal(wx, wy, rng, frequency=9, persistence=.5, octaves=5)
    ridges = 1 - np.abs(2 * fractal(wx, wy, rng, frequency=4.5, persistence=.55) - 1)
    radial = np.sqrt(((x - .5 + warp_x * .10) * 1.9) ** 2 + ((y - .5 + warp_y * .10) * 1.9) ** 2)
    kind = cfg['preset']
    inflow_edge = None
    if kind == 'island':
        h = .48 + (base - .5) * .98 + (ridges - .65) * .32 - radial ** 2.1 * .47 + .22
    elif kind == 'bay' and cfg['bayStyle'] == 'random':
        h, inflow_edge = random_bay_height(x,y,wx,wy,base,detail,cfg,np.random.default_rng(seed_int+737))
    elif kind == 'bay' and cfg['bayStyle'] != 'gulf':
        h = bay_height(x, y, wx, wy, base, detail, cfg)
    elif kind == 'bay':
        # An open gulf cut into a continuous coast, with two enclosing headlands.
        center = .52 + np.sin(x * 8) * .035 + warp_y * .12
        mouth = .035 + np.clip((x - .28) / .72, 0, 1) ** .8 * .31
        distance = np.abs(y - center) - mouth + (base - .5) * .16 + (detail - .5) * .09
        inlet = np.clip((x - .23) / .14, 0, 1)
        coastal_height = .45 + np.tanh(distance * 10) * .21
        land_height = .61 + (base - .5) * .47 + (detail - .5) * .20
        h = land_height * (1 - inlet) + (coastal_height + (base - .5) * .25 + (detail - .5) * .10) * inlet
        h -= np.clip((x - .87) / .13, 0, 1) * .20
    elif kind == 'archipelago':
        islands = fractal(wx, wy, rng, frequency=6, persistence=.42)
        h = .40 + (islands - .5) * 1.5 + (detail - .5) * .2 - radial ** 3 * .13
    elif kind == 'mountains':
        ridge = 1 - np.abs(2 * base - 1)
        h = .32 + ridge ** 3 * .5 + (detail - .4) * .36
    elif kind == 'desert':
        dunes = np.sin((wx * 26 + wy * 13 + base * 4) * np.pi)
        h = .47 + (base - .3) * .45 + dunes * .032 + (detail - .5) * .11
    elif kind == 'hills':
        h = .50 + (base - .45) * .73 + (detail - .5) * .10
    else:
        h = .48 + (base - .4) * .7 + (ridges - .7) * .16 + (detail - .5) * .15
    # Relief changes land height around the fixed reference datum.
    datum = .42 if kind == 'bay' and cfg['bayStyle'] != 'gulf' else .4
    h = datum + (h - datum) * (.5 + cfg['elevation'] / 100)
    # Noise is dimensionless. Convert its amplitude to metres once, then keep
    # all physical terrain operations in metres, without clipping or compression.
    h = (h * 7200).astype(np.float32)
    del warp_x, warp_y, wx, wy, base, ridges, radial
    if kind == 'bay' and cfg['bayStyle'] == 'gulf':
        del center, mouth, distance, inlet, coastal_height, land_height
    wet = np.clip(fractal(x, y, rng, frequency=4, octaves=4) + cfg['moisture'] / 100 - .5, 0, 1)
    sea = sea_level_meters(cfg)
    h = flatten_terrain(h, sea, cfg['flatness'])
    startup=reserve_startup_land(h,sea,cfg)
    water, lake_count = add_lakes(h, x, y, detail, cfg, np.random.default_rng(seed_int + 17),startup)
    lake_water = water.copy()
    if kind == 'bay' and cfg['bayStyle'] != 'gulf':
        # Regional trunks use the same drainage graph as their tributaries.
        # No independent spline or broad valley excavation is stamped on top.
        coastal, sediment = [], np.zeros_like(h)
    else:
        coastal, sediment = estuary(h, water, x, y, detail, cfg, np.random.default_rng(seed_int + 913))
    restore_startup_land(h,water,startup)
    coastal=outside_startup(coastal,startup,cfg,width)
    # Preserve receiving water bodies before channel incision. Vector rendering
    # uses these shores plus the continuous channel geometry, not raster beds.
    water_bodies = {
        'encoding': 'packbits-big',
        'ocean': base64.b64encode(np.packbits(h < sea).tobytes()).decode(),
        'lakes': base64.b64encode(np.packbits((lake_water > h) & (h >= sea)).tobytes()).decode(),
    }
    cell_size_m = cfg['widthKm'] * 1000 / width
    carve_channels(h, water, coastal, sea, cell_size_m)
    outlets = lake_outlets(h, water, lake_water, sea, cfg)
    outlets=outside_startup(outlets,startup,cfg,width)
    carve_channels(h, water, outlets, sea, cell_size_m)
    inland = drainage(h, sea, water, cfg, inflow_edge=inflow_edge)
    inland=outside_startup(inland,startup,cfg,width)
    carve_channels(h, water, inland, sea, cell_size_m)
    channels = inland + coastal + outlets
    land = (h > sea) & (water <= h)
    paths = [item['points'] for item in channels]
    max_m = max(0, int(float(h.max()) - sea))
    data = {
        'width': width, 'height': height, 'config': cfg, 'heightEncoding': HEIGHT_ENCODING,
        'startupArea': {k:startup[k] for k in ('center','sizeMeters','elevationMeters')},
        'grid': {'widthMeters': cfg['widthKm'] * 1000, 'heightMeters': cfg['heightKm'] * 1000,
                 'pixelSizeMeters': [cfg['widthKm'] * 1000 / width, cfg['heightKm'] * 1000 / height],
                 'seaLevelMeters': sea, 'verticalDatum': 'local', 'elevationUnit': 'm', 'origin': 'top-left',
                 'axes': ['east', 'south'], 'crs': 'local-fictional'},
        'elevation': encode_heights(h),
        'moisture': base64.b64encode((wet * 255).astype('u1').tobytes()).decode(),
        'water': encode_heights(water, water=True),
        'rivers': paths,
        'channels': channels,
        'waterBodies': water_bodies,
        'sediment': base64.b64encode((np.clip(sediment, 0, 1) * 255).astype('u1').tobytes()).decode(),
        'stats': {'landPercent': round(float(land.mean()) * 100, 1), 'maxElevation': max_m, 'lakeCount': lake_count, 'riverCount': len(paths),
                  'lakeOutletCount': len(outlets),
                  'generationMs': round((time.perf_counter() - started) * 1000)}
    }
    return data
