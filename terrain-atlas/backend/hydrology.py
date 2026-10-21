"""Drainage, channel incision and seeded estuary deposition on a height field."""
from __future__ import annotations
import heapq
import numpy as np


def smooth(points, widths, levels):
    """One corner-cutting pass; preserve junctions and outlet positions exactly."""
    p = np.asarray(points, dtype=np.float32)
    values = np.column_stack((p, widths, levels))
    if len(p) < 3:
        return values
    result = [values[0]]
    for a, b in zip(values[:-1], values[1:]):
        result.extend((a * .75 + b * .25, a * .25 + b * .75))
    result.append(values[-1])
    return np.asarray(result)


def channel(points, widths, levels, kind='river'):
    values = smooth(points, widths, levels)
    return {'points': values[:, :2].tolist(), 'widths': values[:, 2].tolist(),
            'levels': values[:, 3].tolist(), 'kind': kind}


def ease(value):
    t = np.clip(value, 0, 1)
    return t * t * (3 - 2 * t)


def soften_reach(coords, stride, shape):
    """Round a drainage reach while keeping its confluences fixed.

    Work in pixel space; limit lateral movement to the routing cell corridor.
    A small, spatially coherent displacement removes long lattice-aligned runs.
    """
    scale = np.array([shape[1] - 1, shape[0] - 1])
    original = coords * scale
    points = original.copy()
    if len(points) < 4:
        return coords
    for _ in range(8):
        points[1:-1] = .25 * points[:-2] + .5 * points[1:-1] + .25 * points[2:]
    tangent = np.gradient(points, axis=0)
    normal = np.column_stack((-tangent[:, 1], tangent[:, 0]))
    normal /= np.maximum(np.linalg.norm(normal, axis=1)[:, None], .001)
    phase = points[:, 0] / (stride * 3.7) + points[:, 1] / (stride * 5.3)
    fade = ease(np.minimum(np.arange(len(points)), np.arange(len(points))[::-1]) / 4)
    points += normal * (np.sin(phase) * stride * .15 * fade)[:, None]
    offset = points - original
    distance = np.linalg.norm(offset, axis=1)
    points = original + offset * np.minimum(1, stride * .45 / np.maximum(distance, .001))[:, None]
    return np.clip(points / scale, 0, 1)


def carve_channels(h, water, channels, sea, cell_size_m=20):
    """Rasterize variable-width river beds and graded banks, not vector overlays."""
    rows, cols = h.shape
    targets = np.full_like(h, np.inf)
    coverage = np.zeros_like(h)
    # Freeze the shoreline BEFORE incising any river. Existing inland water
    # remains eligible so tributaries can join a carved channel or lake.
    land = (h >= sea) | (water > 0)
    for river in channels:
        points = np.asarray(river['points']) * [cols - 1, rows - 1]
        for i, (a, b) in enumerate(zip(points[:-1], points[1:])):
            r0, r1 = np.asarray(river['widths'][i:i + 2]) / 2
            bank_span = 5 if river['kind'] == 'river' else 2.5
            margin = max(r0, r1) * bank_span + 3
            x0, x1 = max(0, int(min(a[0], b[0]) - margin)), min(cols, int(max(a[0], b[0]) + margin) + 2)
            y0, y1 = max(0, int(min(a[1], b[1]) - margin)), min(rows, int(max(a[1], b[1]) + margin) + 2)
            yy, xx = np.mgrid[y0:y1, x0:x1]
            delta = b - a
            t = np.clip(((xx - a[0]) * delta[0] + (yy - a[1]) * delta[1]) / max(float(delta @ delta), 1e-8), 0, 1)
            distance = np.hypot(xx - a[0] - t * delta[0], yy - a[1] - t * delta[1])
            radius = r0 * (1 - t) + r1 * t
            level = river['levels'][i] * (1 - t) + river['levels'][i + 1] * t
            inner = distance <= radius
            local_land = land[y0:y1, x0:x1]
            influence = ease(1 - np.maximum(0, distance - radius) / (radius * (bank_span - 1) + 2)) * local_land
            # Metre-based depths: increasing output resolution must not dig
            # deeper channels merely because they occupy more pixels.
            depth = np.minimum(20, 1.4 + .28*np.sqrt(2*radius*cell_size_m)) / 7200
            bed = level - depth * np.sqrt(np.clip(1 - (distance / np.maximum(radius, .1)) ** 2, 0, 1))
            bank = level + (1 + np.maximum(0, distance-radius)*cell_size_m*.12) / 7200
            target = np.where(inner, bed, bank)
            target_patch = targets[y0:y1, x0:x1]
            target_patch[:] = np.minimum(target_patch, target)
            coverage[y0:y1, x0:x1] = np.maximum(coverage[y0:y1, x0:x1], influence)
            wpatch = water[y0:y1, x0:x1]
            # Ocean already has a water surface: do not paint river-coloured
            # strokes past the shoreline into deep open water.
            visible = inner & local_land
            wpatch[visible] = np.maximum(wpatch[visible], level[visible])
    active = coverage > 0
    h[active] = np.minimum(h[active], h[active] * (1 - coverage[active]) + targets[active] * coverage[active])


def drainage(h, sea, water, cfg, inflow_edge=None):
    """Priority-flood spill heights, acyclic steepest descent, then catchment area."""
    if cfg['riverDensity'] <= 0:
        return []
    stride = max(2, max(h.shape) // 240)
    field = h[::stride, ::stride]
    rows, cols = field.shape
    flat = field.ravel()
    style = cfg.get('bayStyle') if cfg.get('preset') == 'bay' else None
    inflow = None
    if style == 'random' and inflow_edge:
        values = {'left':field[:,0], 'right':field[:,-1],
                  'top':field[0,:], 'bottom':field[-1,:]}[inflow_edge]
        options = np.arange(round(len(values)*.15),round(len(values)*.85))
        options = options[values[options] > sea+.001]
        if len(options):
            best = int(options[np.argmin(values[options])])
            inflow = {'left':best*cols, 'right':best*cols+cols-1,
                      'top':best, 'bottom':(rows-1)*cols+best}[inflow_edge]
    elif style == 'tokyo':
        inflow_edge = 'top'
        xs = np.arange(round(cols*.38), round(cols*.75))
        index = xs[np.argmin(field[0, xs])]
        if field[0, index] > sea:
            inflow = int(index)
    elif style in ('vancouver', 'san_francisco'):
        inflow_edge = 'right'
        lo, hi = (.68,.88) if style == 'vancouver' else (.04,.29)
        ys = np.arange(round(rows*lo), round(rows*hi))
        index = ys[np.argmin(field[ys, -1])]
        if field[index,-1] > sea:
            inflow = int(index*cols + cols-1)
    # Point subsampling misses thin rivers between routing-grid samples.
    # Pool actual wet pixels in every cell so tributaries stop at an existing
    # channel instead of running beside it or crossing it repeatedly.
    visible_water = np.where(water > h, water, 0)
    surface_grid = np.maximum.reduceat(np.maximum.reduceat(
        visible_water, np.arange(0, h.shape[0], stride), axis=0),
        np.arange(0, h.shape[1], stride), axis=1)
    surface = surface_grid.ravel()
    wet = (flat <= sea) | (surface > 0)
    filled = np.maximum(flat, surface).copy()
    filled[surface > 0] = surface[surface > 0]
    visited = np.zeros(flat.size, dtype=bool)
    parent = np.full(flat.size, -1, dtype=np.int32)
    order, queue = [], []
    for y in range(rows):
        for x in range(cols):
            index = y * cols + x
            boundary = y in (0, rows - 1) or x in (0, cols - 1)
            on_inflow_edge = {'left':x==0, 'right':x==cols-1, 'top':y==0, 'bottom':y==rows-1}.get(inflow_edge,False)
            if inflow is not None and on_inflow_edge:
                boundary = False
            if boundary or wet[index]:
                visited[index] = True
                heapq.heappush(queue, (float(filled[index]), index))
    neighbors = [(dy, dx, np.hypot(dx, dy)) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dx or dy]
    while queue:
        level, index = heapq.heappop(queue)
        order.append(index)
        y, x = divmod(index, cols)
        for dy, dx, _ in neighbors:
            ny, nx = y + dy, x + dx
            if not (0 <= ny < rows and 0 <= nx < cols):
                continue
            other = ny * cols + nx
            if not visited[other]:
                visited[other] = True
                parent[other] = index
                filled[other] = max(float(filled[other]), level + .000002)
                heapq.heappush(queue, (float(filled[other]), other))
    # Use maximum slope rather than the first visited flood neighbor.
    downstream = parent.copy()
    for index in order:
        if wet[index] or parent[index] < 0:
            continue
        y, x = divmod(index, cols)
        best = 0
        for dy, dx, distance in neighbors:
            ny, nx = y + dy, x + dx
            if 0 <= ny < rows and 0 <= nx < cols:
                other = ny * cols + nx
                slope = (filled[index] - filled[other]) / distance
                if slope > best:
                    best, downstream[index] = slope, other
    accumulation = np.ones(flat.size, dtype=np.float32)
    regional = np.zeros(flat.size, dtype=bool)
    if inflow is not None:
        # Upstream catchment outside this fictional map supplies one main stem.
        # Routing still follows the very same terrain and confluence graph.
        accumulation[inflow] += flat.size * .12
        regional[inflow] = True
    for index in np.argsort(filled)[::-1]:
        target = downstream[index]
        if target >= 0:
            accumulation[target] += accumulation[index]
            regional[target] |= regional[index]
    threshold = max(35, flat.size / (40 + cfg['riverDensity'] * 4))
    active = (accumulation >= threshold) & ~wet
    incoming = np.zeros(flat.size, dtype=np.int32)
    for index in np.flatnonzero(active):
        if downstream[index] >= 0:
            incoming[downstream[index]] += 1
    heads = np.flatnonzero(active & (incoming == 0))
    candidates = []
    for head in heads:
        indices, index = [], int(head)
        while index >= 0:
            indices.append(index)
            if wet[index]:
                break
            index = int(downstream[index])
        if len(indices) >= 10:
            candidates.append(indices)
    candidates.sort(key=lambda path: (bool(np.any(regional[path])), len(path)), reverse=True)
    result = []
    base_width = cfg['riverWidth'] / (cfg['widthKm'] * 1000) * h.shape[1]
    minimum = max(1.5, max(h.shape) / 1000)
    # Split the selected network at confluences and render each reach once.
    # Smoothing whole head-to-mouth paths independently separates tributaries.
    selected = []
    used_edges = set()
    min_branch = max(6, round(12 - cfg['riverDensity'] * .06))
    for path in candidates:
        # Count only the NEW upstream reach, not a long shared downstream
        # trunk. Otherwise tiny spurs qualify as long rivers and clutter banks.
        fresh = []
        for a, b in zip(path[:-1], path[1:]):
            if (a, b) in used_edges:
                break
            fresh.append((a, b))
        if len(fresh) < min_branch:
            continue
        selected.append([fresh[0][0]] + [b for _, b in fresh])
        used_edges.update(fresh)
        if len(selected) >= max(1, round(cfg['riverDensity'] * .30)):
            break
    # Confluences are based on the selected network, not discarded headwaters.
    incoming[:] = 0
    for a, b in used_edges:
        incoming[b] += 1
    reaches = []
    for path in selected:
        reach = [path[0]]
        for a, b in zip(path[:-1], path[1:]):
            reach.append(b)
            if incoming[b] > 1 or b == path[-1]:
                reaches.append(reach)
                reach = [b]
    for indices in reaches:
        indices = np.asarray(indices)
        coords = np.column_stack(((indices % cols) * stride / (h.shape[1] - 1), (indices // cols) * stride / (h.shape[0] - 1)))
        if surface[indices[-1]] > 0:
            cy, cx = divmod(int(indices[-1]), cols)
            tile = visible_water[cy*stride:(cy+1)*stride, cx*stride:(cx+1)*stride]
            choices = np.argwhere(tile > 0)
            if len(choices):
                # Snap to the actual wet pixel, not the coarse cell's corner.
                previous = coords[-2] * [h.shape[1]-1,h.shape[0]-1]
                candidates_px = choices[:, ::-1] + [cx*stride,cy*stride]
                point = candidates_px[np.argmin(np.sum((candidates_px-previous)**2, axis=1))]
                coords[-1] = point / [h.shape[1]-1,h.shape[0]-1]
        coords = soften_reach(coords, stride, h.shape)
        if inflow is not None and indices[0] == inflow:
            coords[0, 0 if inflow_edge in ('left','right') else 1] = 0 if inflow_edge in ('left','top') else 1
        flow = accumulation[indices] / threshold
        widths = np.maximum(minimum, base_width * (.7 + np.power(flow, .45) * .7))
        widths = np.minimum(widths, max(minimum * 5, base_width * 6))
        # Spill heights descend continuously, including across filled depressions.
        levels = np.maximum(sea, filled[indices] - .00035)
        if surface[indices[-1]] > 0:
            levels[-1] = max(sea, surface[indices[-1]])
        levels = np.maximum.accumulate(levels[::-1])[::-1]
        main = bool(np.any(regional[indices]))
        reach = channel(coords, widths, levels, 'estuary' if main else 'river')
        if main and flat[indices[-1]] <= sea and surface[indices[-1]] == 0:
            reach['outlet'] = True
        result.append(reach)
    return result


def lake_outlets(h, water, lake_water, sea, cfg):
    """Connect overflowing lakes; retain basins with a substantial closed rim."""
    if cfg['riverDensity'] <= 0 or not np.any(lake_water):
        return []
    stride = max(2, max(h.shape) // 280)
    field = np.maximum(h, water)[::stride, ::stride].copy()
    rows, cols = field.shape
    filled = field.copy()
    visited = np.zeros(field.shape, dtype=bool)
    parent = np.full((rows, cols, 2), -1, dtype=int)
    wet = (h[::stride, ::stride] <= sea) | ((water[::stride, ::stride] > h[::stride, ::stride]) &
                                            (lake_water[::stride, ::stride] == 0))
    wet[[0, -1], :] = True
    wet[:, [0, -1]] = True
    queue = []
    for cy, cx in np.argwhere(wet):
        visited[cy, cx] = True
        heapq.heappush(queue, (float(filled[cy, cx]), int(cy), int(cx)))
    steps = [(dy, dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dx or dy]
    while queue:
        level, cy, cx = heapq.heappop(queue)
        for dy, dx in steps:
            ny, nx = cy + dy, cx + dx
            if 0 <= ny < rows and 0 <= nx < cols and not visited[ny, nx]:
                visited[ny, nx] = True
                parent[ny, nx] = (cy, cx)
                filled[ny, nx] = max(float(filled[ny, nx]), level + .000001)
                heapq.heappush(queue, (float(filled[ny, nx]), ny, nx))
    channels = []
    coarse_lakes = lake_water[::stride, ::stride]
    for surface in np.unique(lake_water[lake_water > 0]):
        cells = np.argwhere(coarse_lakes == surface)
        if not len(cells):
            continue
        cy, cx = cells[np.argmin(filled[cells[:, 0], cells[:, 1]])]
        # Allow a shallow spill notch in moist climates; never force a river
        # through a high enclosing ridge just to connect every lake to the sea.
        allowance = .002 + cfg['moisture'] / 100 * .010
        if filled[cy, cx] > surface + allowance:
            continue
        path = [(cy, cx)]
        while not wet[cy, cx]:
            cy, cx = parent[cy, cx]
            if cy < 0:
                break
            path.append((cy, cx))
            if 0 < coarse_lakes[cy, cx] < surface - .0001:
                break
        if len(path) < 3:
            continue
        pixels = np.array(path)
        coords = pixels[:, ::-1] * stride / [h.shape[1] - 1, h.shape[0] - 1]
        coords = soften_reach(coords, stride, h.shape)
        levels = np.minimum(surface, filled[pixels[:, 0], pixels[:, 1]])
        levels = np.minimum.accumulate(np.maximum(sea, levels))
        levels[0] = surface
        width = max(1.8, cfg['riverWidth'] / (cfg['widthKm'] * 1000) * h.shape[1])
        river = channel(coords, np.linspace(width, width * 1.35, len(coords)), levels, 'lake_outlet')
        channels.append(river)
    return channels


def bezier(a, b, bend, rng, samples=35):
    """A smooth meander with exact endpoints and seeded, asymmetric curvature."""
    a, b = np.asarray(a), np.asarray(b)
    delta = b - a
    normal = np.array([-delta[1], delta[0]])
    normal /= max(np.linalg.norm(normal), .0001)
    t = np.linspace(0, 1, samples)
    c1 = a + delta * float(rng.uniform(.2, .4)) + normal * float(rng.uniform(-bend * 2.8, bend * 2.8))
    c2 = a + delta * float(rng.uniform(.6, .8)) + normal * float(rng.uniform(-bend * 2.8, bend * 2.8))
    t = t[:, None]
    return (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * c1 + 3 * (1 - t) * t ** 2 * c2 + t ** 3 * b


def terrain_path(h, start, end, sea, corridor=None):
    """Least excavation path, respecting hills rather than crossing them."""
    stride = max(2, max(h.shape) // 320)
    field = h[::stride, ::stride]
    rows, cols = field.shape
    scale = np.array([h.shape[1] - 1, h.shape[0] - 1]) / stride
    source = np.clip(np.rint(np.asarray(start) * scale).astype(int), [0, 0], [cols - 1, rows - 1])
    target = np.clip(np.rint(np.asarray(end) * scale).astype(int), [0, 0], [cols - 1, rows - 1])
    cost = 1 + np.maximum(0, (field - sea) / .035) ** 2 * 12
    if corridor is not None:
        # The delta route must stay in deposited sediment until its mouth.
        cost = 1 + np.maximum(0, (field - sea + .004) / .003) ** 2 * 4
        cost += (~corridor[::stride, ::stride]) * 150
    dist = np.full(field.shape, np.inf)
    parent = np.full((rows, cols, 2), -1, dtype=int)
    sx, sy = source; tx, ty = target
    dist[sy, sx] = 0
    queue = [(0, int(sy), int(sx))]
    steps = [(dy, dx, np.hypot(dx, dy)) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dx or dy]
    while queue:
        score, cy, cx = heapq.heappop(queue)
        if score != dist[cy, cx]:
            continue
        if (cx, cy) == (tx, ty):
            break
        for dy, dx, length in steps:
            ny, nx = cy + dy, cx + dx
            if 0 <= ny < rows and 0 <= nx < cols:
                trial = score + (cost[cy, cx] + cost[ny, nx]) * .5 * length
                if trial < dist[ny, nx]:
                    dist[ny, nx] = trial
                    parent[ny, nx] = (cy, cx)
                    heapq.heappush(queue, (trial, ny, nx))
    path = [(tx, ty)]
    while (tx, ty) != (sx, sy):
        ty, tx = parent[ty, tx]
        if tx < 0:
            return np.array([start, end])
        path.append((tx, ty))
    coords = np.array(path[::-1]) / scale
    coords[0], coords[-1] = start, end
    softened = soften_reach(coords, stride, h.shape)
    size = np.array([h.shape[1] - 1, h.shape[0] - 1])
    before = np.clip(np.rint(coords * size).astype(int), [0, 0], size)
    after = np.clip(np.rint(softened * size).astype(int), [0, 0], size)
    crosses_ridge = h[after[:, 1], after[:, 0]] > h[before[:, 1], before[:, 0]] + .008
    softened[crosses_ridge] = coords[crosses_ridge]
    return softened


def marsh_texture(shape, rng):
    """Coherent floodplain microrelief, independent of the mountain noise."""
    yy, xx = np.indices(shape, dtype=np.float32)
    total = np.zeros(shape, dtype=np.float32)
    for cells, amplitude in [(23, .58), (51, .28), (103, .14)]:
        gx, gy = xx / max(shape[1] - 1, 1) * cells, yy / max(shape[0] - 1, 1) * cells
        ix, iy = gx.astype(int), gy.astype(int)
        fx, fy = ease(gx - ix), ease(gy - iy)
        grid = rng.random((cells + 2, cells + 2), dtype=np.float32)
        total += amplitude * ((grid[iy, ix] * (1 - fx) + grid[iy, ix + 1] * fx) * (1 - fy) +
                              (grid[iy + 1, ix] * (1 - fx) + grid[iy + 1, ix + 1] * fx) * fy)
    return total


def sediment_transport(h, root, sea, strength, detail, rng):
    """Directional parcels deposit in the bay and divert around filled cells.

    This small transport model uses finite sediment volume and a settling
    distance; it deliberately omits tides and wave-driven redistribution.
    """
    stride = max(2, max(h.shape) // 320)
    original = h[::stride, ::stride].copy()
    bed = original.copy()
    rows, cols = bed.shape
    ceiling = sea + .009 + (detail[::stride, ::stride] - .5) * .003
    rx, ry = np.rint(np.asarray(root) * [h.shape[1] - 1, h.shape[0] - 1] / stride).astype(int)
    # Inject parcels just offshore, never inside existing coastal hills.
    candidates = np.argwhere((original < sea) & (np.indices(bed.shape)[1] >= rx))
    if not len(candidates):
        return np.zeros_like(h)
    nearest = candidates[np.argmin((candidates[:, 1] - rx) ** 2 + (candidates[:, 0] - ry) ** 2)]
    ry, rx = nearest
    reach = cols * (.095 + strength * .18)
    moves = np.array([[0, 1], [-1, 1], [1, 1], [-1, 0], [1, 0]])
    bias = np.array([1.8, 1.0, 1.0, .45, .45])
    for _ in range(round(38 + strength * 55)):
        px, py = np.full(96, rx), np.full(96, ry)
        # Some sediment settles early; some travels farther along the plume.
        travel = rng.uniform(.5, 1.25, 96) * reach
        load = np.full(96, .12 + strength * .12)
        for age in range(int(reach * 1.7)):
            alive = (load > .00001) & ((px - rx) < travel)
            if not np.any(alive):
                break
            nx = np.clip(px[:, None] + moves[:, 1], 0, cols - 1)
            ny = np.clip(py[:, None] + moves[:, 0], 0, rows - 1)
            levels = bed[ny, nx]
            # Prefer open low routes, but keep sufficient spreading to allow
            # a new distributary once an older channel belt fills with sediment.
            weights = bias * np.exp(np.clip((sea - levels) * 35, -18, 5))
            weights[levels > sea + .015] *= .0001
            cdf = np.cumsum(weights, axis=1)
            choices = (rng.random(96)[:, None] * cdf[:, -1:] > cdf).sum(axis=1)
            px, py = nx[np.arange(96), choices], ny[np.arange(96), choices]
            amount = np.minimum(load, .0022 * np.exp(-(px - rx) / max(reach, 1))) * alive
            amount *= original[py, px] < sea
            index = py * cols + px
            counts = np.bincount(index, minlength=rows * cols)[index]
            capacity = np.maximum(0, ceiling[py, px] - bed[py, px]) / counts
            amount = np.minimum(amount, capacity)
            np.add.at(bed, (py, px), amount)
            bed[:] = np.minimum(np.maximum(original, ceiling), bed)
            load -= amount
    added = np.maximum(0, bed - original)
    # Diffuse sub-cell deposits to remove the simulation lattice, preserving
    # the irregular outline produced by the transport rather than a fan mask.
    for _ in range(3):
        pad = np.pad(added, 1, mode='edge')
        added = (4 * pad[1:-1, 1:-1] + pad[:-2, 1:-1] + pad[2:, 1:-1] +
                 pad[1:-1, :-2] + pad[1:-1, 2:]) / 8
    small_x, small_y = np.arange(cols) * stride, np.arange(rows) * stride
    across = np.array([np.interp(np.arange(h.shape[1]), small_x, row) for row in added], dtype=np.float32)
    deposit = np.array([np.interp(np.arange(h.shape[0]), small_y, col) for col in across.T], dtype=np.float32).T
    microrelief = marsh_texture(h.shape, rng)
    marsh_level = sea + .0009 + (microrelief - .5) * .009
    h[:] = np.maximum(h, np.minimum(marsh_level, h + deposit))
    return ease(deposit / .025)


def estuary(h, water, x, y, detail, cfg, rng):
    """A routed valley feeding a sediment-built delta.

    A simplified directional parcel model deposits in the receiving bay.
    It is not a calibrated hydrodynamic model; tides and waves are omitted.
    """
    sediment = np.zeros_like(h)
    if cfg['preset'] != 'bay' or cfg['riverDensity'] <= 0:
        return [], sediment
    sea, strength = cfg['sea'] / 100, cfg['delta'] / 100
    ys = .52 + np.sin(np.linspace(0, 1, h.shape[1]) * 8) * .035
    samples = h[np.clip((ys * (h.shape[0] - 1)).astype(int), 0, h.shape[0] - 1), np.arange(h.shape[1])]
    shoreline = np.flatnonzero((samples < sea) & (np.linspace(0, 1, h.shape[1]) > .16))
    if len(shoreline) == 0:
        return [], sediment
    mouth = float(np.clip(shoreline[0] / (h.shape[1] - 1), .20, .72))
    root = np.array([max(.14, mouth - .045), .52 + np.sin(mouth * 8) * .035])
    source_column = h[:, 0].copy()
    source_column[(np.arange(h.shape[0]) < h.shape[0] * .22) | (np.arange(h.shape[0]) > h.shape[0] * .78)] = np.inf
    source = [.0, int(np.argmin(source_column)) / (h.shape[0] - 1)]
    main = terrain_path(h, source, root, sea)
    pixel = np.rint(main * [h.shape[1] - 1, h.shape[0] - 1]).astype(int)
    first_ocean = np.flatnonzero(h[pixel[:, 1], pixel[:, 0]] < sea)
    if len(first_ocean) and first_ocean[0] > 1:
        main = main[:first_ocean[0]]
        pixel = pixel[:first_ocean[0]]
        root = main[-1].copy()
        mouth = root[0] + .008
    levels = h[pixel[:, 1], pixel[:, 0]].copy()
    for _ in range(8):
        padded = np.pad(levels, 2, mode='edge')
        levels = sum(padded[j:j + len(levels)] for j in range(5)) / 5
    levels[-1] = sea + .0012
    levels = np.maximum(sea + .0012, np.maximum.accumulate(levels[::-1])[::-1] - .004)
    levels[-1] = sea + .0012
    base_width = cfg['riverWidth'] / (cfg['widthKm'] * 1000) * h.shape[1]
    main_width = max(max(h.shape) / 220, base_width * 3.4)
    # Gradual valley-side erosion follows the routed river. There is no
    # constant-height, horizontal corridor cut across the entire landscape.
    influence = np.zeros_like(h)
    floor = np.full_like(h, np.inf)
    for i, position in enumerate(main):
        radius = .012 + .014 * i / max(1, len(main) - 1)
        aspect = cfg['widthKm'] / cfg['heightKm']
        x0 = max(0, int((position[0] - radius * 3.5) * h.shape[1]))
        x1 = min(h.shape[1], int((position[0] + radius * 3.5) * h.shape[1]) + 2)
        y0 = max(0, int((position[1] - radius * 3.5 * aspect) * h.shape[0]))
        y1 = min(h.shape[0], int((position[1] + radius * 3.5 * aspect) * h.shape[0]) + 2)
        patch = np.s_[y0:y1, x0:x1]
        distance = np.hypot(x[patch] - position[0], (y[patch] - position[1]) / aspect)
        weight = np.exp(-(distance / radius) ** 2) * .82
        influence[patch] = np.maximum(influence[patch], weight)
        floor[patch] = np.minimum(floor[patch], levels[i] + .002 + (distance / radius) ** 1.6 * .025)
    active = influence > 0
    h[active] = h[active] * (1 - influence[active]) + np.minimum(h[active], floor[active]) * influence[active]
    sediment = influence * .35
    root_level = levels[-1]
    channels = [channel(main, np.linspace(main_width * .62, main_width, len(main)), levels, 'estuary')]
    if strength <= 0:
        end = terrain_path(h, root, [mouth + .025, root[1]], sea)
        channels.append(channel(end, np.full(len(end), main_width), np.linspace(root_level, sea, len(end)), 'estuary'))
        return channels, sediment

    original = h.copy()
    sediment = np.maximum(sediment, sediment_transport(h, root, sea, strength, detail, rng))
    new_land = (original < sea) & (h >= sea)
    reach = .12 + strength * .19
    progress = (x - root[0]) / reach
    # Mouth candidates must be newly deposited land adjoining pre-existing
    # open bay water. This prevents a distributary tunnelling into a headland.
    ocean = h < sea
    adjacent = np.zeros_like(ocean)
    for dy, dx in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
        adjacent |= np.roll(np.roll(ocean, dy, axis=0), dx, axis=1)
    candidates = np.argwhere(new_land & adjacent & (progress > .32))
    if len(candidates) < 3:
        # At extreme sea levels the bay may not accommodate a delta.
        end = bezier(root, [mouth + .025, root[1]], .004, rng)
        channels.append(channel(end, np.full(len(end), main_width), np.linspace(root_level, sea, len(end)), 'estuary'))
        return channels, sediment
    coords = candidates[:, ::-1] / [h.shape[1] - 1, h.shape[0] - 1]
    angles = np.arctan2(coords[:, 1] - root[1], coords[:, 0] - root[0])
    targets = []
    for bearing in [-.42, -.015, .34]:
        score = np.abs(angles - bearing) + .10 * (1 - (coords[:, 0] - root[0]) / reach)
        point = coords[int(np.argmin(score))]
        iy, ix = np.rint(point * [h.shape[1] - 1, h.shape[0] - 1]).astype(int)[::-1]
        # End in the immediately adjacent sea cell; raster incision still uses
        # the frozen land mask, so no blue extension is drawn over open water.
        choices = [(ny, nx) for ny, nx in [(iy, ix + 1), (iy - 1, ix), (iy + 1, ix), (iy, ix - 1)]
                   if 0 <= ny < h.shape[0] and 0 <= nx < h.shape[1] and ocean[ny, nx]]
        ny, nx = min(choices, key=lambda q: float(h[q]))
        targets.append(np.array([nx / (h.shape[1] - 1), ny / (h.shape[0] - 1)]))

    # Two staggered avulsions from a sinuous trunk, with unequal discharge.
    # The main channel supplies the long central mouth; lateral mouths emerge
    # at different distances along the irregular coastline.
    corridor = (h >= sea) & ((h < sea + .018) | (x < mouth))
    route_surface = h + (detail - .5) * .009
    trunk = terrain_path(route_surface, root, targets[1], sea, corridor)
    j1, j2 = max(1, len(trunk) // 3), max(2, len(trunk) * 2 // 3)
    pieces = [(trunk[:j1 + 1], 1.0, False),
              (trunk[j1:j2 + 1], .73, False),
              (trunk[j2:], .47, True),
              (terrain_path(route_surface, trunk[j1], targets[0], sea, corridor), .27, True),
              (terrain_path(route_surface, trunk[j2], targets[2], sea, corridor), .26, True)]
    for points, discharge, outlet in pieces:
        distance = np.clip((points[:, 0] - root[0]) / max(targets[1][0] - root[0], .01), 0, 1)
        levels = sea + .0012 * (1 - distance)
        if outlet:
            levels = np.linspace(levels[0], sea, len(points))
        widths = np.full(len(points), main_width * discharge ** .55)
        river = channel(points, widths, levels, 'distributary')
        if outlet:
            river['outlet'] = True
        channels.append(river)
    return channels, sediment
