"""Split a road into ground approaches and elevated water crossings."""
import math
from shapely.ops import substring


def segments(terrain, line):
    if not terrain.bounds.covers(line):
        return [(0, line)]
    step = min(10, terrain.width / max(1, terrain.w - 1) / 2,
               terrain.height / max(1, terrain.h - 1) / 2)
    count = max(1, math.ceil(line.length / step))
    spans = []
    # Test river geometry along each interval as well as raster water samples.
    # Bank margins provide space for the existing bridge approach rendering.
    for i in range(count):
        a, b = line.length * i / count, line.length * (i + 1) / count
        piece = substring(line, a, b)
        if terrain.river_geometry.intersects(piece) or any(
                terrain.sample(line.interpolate(d).coords[0])['water']
                for d in (a, (a+b)/2, b)):
            spans.append((max(0, a-80), min(line.length, b+80)))
    if not spans:
        return [(0, line)]
    merged = []
    for a, b in spans:
        if merged and a - merged[-1][1] < 20:
            merged[-1][1] = max(b, merged[-1][1])
        else:
            merged.append([a, b])
    if merged[0][0] < 20:
        merged[0][0] = 0
    if line.length - merged[-1][1] < 20:
        merged[-1][1] = line.length
    result = []
    cursor = 0
    for a, b in merged:
        if a > cursor:
            result.append((0, substring(line, cursor, a)))
        result.append((1, substring(line, a, b)))
        cursor = b
    if cursor < line.length:
        result.append((0, substring(line, cursor, line.length)))
    return result
