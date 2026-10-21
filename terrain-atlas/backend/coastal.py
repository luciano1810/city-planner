"""Regional coastal landforms, inspired by bay cities rather than copied DEMs.

Signed coastal fields define connectivity first. Regional uplift and lowland
envelopes then give the same shore either a rocky slope or an alluvial plain.
All coordinates describe fictional regions, not georeferenced city replicas.
"""
import numpy as np

BAY_STYLES = {'random', 'gulf', 'san_francisco', 'tokyo', 'hong_kong', 'sydney', 'rio', 'vancouver'}


def ellipse(x, y, cx, cy, rx, ry, angle=0):
    u = (x - cx) * np.cos(angle) + (y - cy) * np.sin(angle)
    v = -(x - cx) * np.sin(angle) + (y - cy) * np.cos(angle)
    return (np.sqrt((u / rx) ** 2 + (v / ry) ** 2) - 1) * min(rx, ry)


def corridor(x, y, points, radii):
    result = np.full_like(x, np.inf)
    for a, b, r0, r1 in zip(points[:-1], points[1:], radii[:-1], radii[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        t = np.clip(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy), 0, 1)
        d = np.hypot(x - a[0] - t * dx, y - a[1] - t * dy) - (r0 + t * (r1 - r0))
        result = np.minimum(result, d)
    return result


def random_bay_height(x, y, wx, wy, base, detail, cfg, rng):
    """Compose a coast from independent continuous landform parameters.

    No city template is selected. Rotation, branching, enclosure, islands,
    uplands and the alluvial basin are sampled separately from the seed.
    """
    angle = float(rng.uniform(-np.pi, np.pi))
    c, s = np.cos(angle), np.sin(angle)
    dx = x-.5 + (wx-x)*1.6 + (detail-.5)*.08
    dy = y-.5 + (wy-y)*1.6 + (base-.5)*.10
    u, v = .5+dx*c+dy*s, .5-dx*s+dy*c
    coast = float(rng.uniform(.64,.83))
    head_x = float(rng.uniform(.16,.43))
    head_y = float(rng.uniform(.32,.68))
    mouth_y = float(rng.uniform(.36,.64))
    mouth_width = float(rng.uniform(.022,.13))
    inner_width = float(rng.uniform(.045,.20))
    points = [(coast+.25,mouth_y), (coast,mouth_y),
              ((coast+head_x)*.55, head_y+float(rng.uniform(-.10,.10))),
              (head_x,head_y)]
    radii = [mouth_width*2, mouth_width, inner_width, inner_width*float(rng.uniform(.3,.9))]
    d = np.minimum(coast-u + .025*np.sin(v*float(rng.uniform(5,12))), corridor(u,v,points,radii))
    # Tributary drowned valleys share a trunk junction, taper inland, and can
    # appear on either side independently. Their number is not a preset class.
    for _ in range(int(rng.integers(0,6))):
        t = float(rng.uniform(.28,.88))
        root = np.array(points[1])*(1-t) + np.array(points[-1])*t
        side = float(rng.choice([-1,1]))
        end = root + [float(rng.uniform(-.18,.05)), side*float(rng.uniform(.12,.34))]
        elbow = root*.45 + end*.55 + [float(rng.uniform(-.06,.06)),0]
        width = float(rng.uniform(.012,.055))
        d = np.minimum(d, corridor(u,v,[root,elbow,end],[inner_width*.6,width,.004]))
    # Some coasts have no islands; others have several irregular ridge tips.
    for _ in range(int(rng.integers(0,7))):
        cx, cy = rng.uniform(coast-.06,coast+.23), rng.uniform(.13,.87)
        if abs(cy-mouth_y) < mouth_width*1.6:
            continue  # Keep an outlet around the main entrance.
        island = ellipse(u,v,cx,cy,float(rng.uniform(.025,.075)),
                         float(rng.uniform(.035,.13)),float(rng.uniform(-1.2,1.2)))
        d = np.maximum(d,-island)
    # Protect narrow connections while still perturbing wider bays and coasts.
    coast_detail = np.clip((detail-.5)*.11+(base-.5)*.06,-.045,.045)
    d += coast_detail*np.minimum(1,np.abs(d)/.06)
    strength = cfg['delta']/100 if cfg['riverDensity'] > 0 else 0
    d += strength*.055*np.exp(-((u-head_x)/.13)**2-((v-head_y)/.13)**2)
    inland = np.maximum(d,0)
    rise = 1-np.exp(-inland/.05)
    uplift = np.zeros_like(x)
    for _ in range(int(rng.integers(2,6))):
        cx, cy = rng.uniform(.08,.80), rng.uniform(.04,.96)
        rx, ry = rng.uniform(.08,.21), rng.uniform(.12,.34)
        uplift += float(rng.uniform(.15,.85))*np.exp(-((u-cx)/rx)**2-((v-cy)/ry)**2)
    # A broad basin can range from a small valley to an extensive coastal plain.
    plain_width = float(rng.uniform(.07,.30))
    basin_center = head_y + .035*np.sin(u*float(rng.uniform(5,11))+(base-.5)*2)
    plain_weight = np.exp(-((v-basin_center)/plain_width)**4)
    uplift *= 1-plain_weight*float(rng.uniform(.65,.98))
    texture = .55*np.exp((base-.5)*3.2+(detail-.5)*2)
    relief = inland*.055 + rise*(.004+uplift*.15*texture)
    # The basin falls toward its bay head instead of following an engraved line.
    plain = rise*(.002+np.maximum(head_x-u,0)*.055 + ((v-basin_center)/plain_width)**2*.008)
    relief = relief*(1-plain_weight*.85) + plain*plain_weight*.85
    relief += rise*((base-.5)*.003+(detail-.5)*.001)
    land = .42+np.maximum(relief,.00001)
    seabed = .42-.23*(1-np.exp(np.minimum(d,0)*7))
    edge = ('left' if c > 0 else 'right') if abs(c) >= abs(s) else ('top' if s > 0 else 'bottom')
    return np.where(d>0,land,seabed).astype(np.float32), edge


def bay_height(x, y, wx, wy, base, detail, cfg):
    """Positive signed distance is land; negative distance is connected sea."""
    style = cfg['bayStyle']
    # Coherent deformation at three scales breaks geometric shore outlines.
    u = x + (wx - x) * 1.8 + (detail - .5) * .12
    v = y + (wy - y) * 1.8 + (base - .5) * .14
    strength = cfg['delta'] / 100 if cfg['riverDensity'] > 0 else 0
    if style == 'san_francisco':
        d = np.minimum(u - .19, ellipse(u, v, .57, .64, .105, .29, -.37))
        d = np.minimum(d, ellipse(u, v, .53, .27, .15, .14))
        d = np.minimum(d, corridor(u, v, [( .15,.44),(.30,.42),(.45,.44),(.53,.48)], [.034,.022,.03,.06]))
        d = np.minimum(d, corridor(u, v, [(.53,.28),(.70,.23),(.85,.18)], [.08,.025,.065]))
        uplift = .75 * np.exp(-((u - .32) / .10) ** 2) + .95 * np.exp(-((u - .84) / .13) ** 2)
        uplift *= .4 + .6 * np.sin(v * 7 + .5) ** 2
    elif style == 'tokyo':
        # Broad, oblique bay head grading into a narrower southward entrance.
        west = .30 + .25 * (v - .30) + .025 * np.sin(v * 17)
        east = .83 - .21 * (v - .30) + .025 * np.sin(v * 12)
        sides = np.maximum(west - u, u - east)
        head = .31 - v + .045 * np.sin(u * 10)
        basin = .5 * (sides + head + np.sqrt((sides-head)**2 + .035**2))
        d = np.minimum(.91 - v + .06 * np.sin(u * 8), basin)
        # A broad inland basin: western mountains, eastern low terraces.
        uplift = .95 * np.exp(-((u - .07) / .19) ** 2) + .18 * np.exp(-((u - .92) / .16) ** 2)
        d += strength * .05 * np.exp(-((u - .56) / .14) ** 2 - ((v - .32) / .15) ** 2)
    elif style == 'hong_kong':
        d = .50 - v - .12 * np.sin(u * 8) - .13 * (u - .4)
        d = np.minimum(d, ellipse(u, v, .76, .24, .10, .20, .55))
        d = np.minimum(d, corridor(u, v, [(.92,.51),(.69,.36),(.55,.27)], [.10,.04,.015]))
        for island in [(.28,.72,.20,.095,-.48), (.64,.67,.15,.085,.20),
                       (.52,.86,.05,.07,.2), (.88,.58,.065,.10,.5), (.84,.79,.04,.055,0)]:
            d = np.maximum(d, -ellipse(u, v, *island))
        uplift = .55 + .40 * np.sin((u * 1.5 + v) * 10) ** 2
        uplift *= 1 - .75 * np.exp(-((u - .15) / .21) ** 2 - ((v - .16) / .24) ** 2)
    elif style == 'sydney':
        d = .83 - u + .035 * np.sin(v * 9)
        # Drowned trunk valley with tributary coves; widths taper inland.
        networks = [
            ([(.92,.50),(.77,.47),(.63,.55),(.47,.48),(.29,.50),(.12,.36)], [.08,.033,.055,.04,.021,.003]),
            ([(.64,.54),(.62,.36),(.49,.28),(.43,.12)], [.043,.028,.015,.003]),
            ([(.46,.48),(.39,.65),(.23,.74),(.15,.88)], [.032,.021,.012,.003]),
            ([(.30,.50),(.26,.31),(.14,.22)], [.018,.013,.002]),
            ([(.62,.37),(.76,.27),(.74,.12)], [.022,.014,.002]),
            ([(.39,.65),(.52,.76),(.55,.90)], [.017,.010,.002]),
        ]
        for points, radii in networks:
            d = np.minimum(d, corridor(u, v, points, radii))
        uplift = .13 + .20 * (1 - u)
    elif style == 'rio':
        d = .79 - v + .035 * np.sin(u * 13)
        d = np.minimum(d, ellipse(u, v, .57, .39, .19, .25, -.18))
        d = np.minimum(d, corridor(u, v, [(.59,.52),(.55,.68),(.61,.89)], [.10,.037,.10]))
        for island in [(.52,.35,.045,.07,.3), (.64,.23,.04,.035,0)]:
            d = np.maximum(d, -ellipse(u, v, *island))
        uplift = (np.exp(-((u - .24) / .15) ** 2 - ((v - .58) / .20) ** 2)
                  + .85 * np.exp(-((u - .82) / .13) ** 2 - ((v - .55) / .20) ** 2)
                  + .65 * np.exp(-((v - .02) / .16) ** 2))
    else:  # vancouver: mountainous north, sheltered inlet, broad southern delta.
        d = u - (.29 + .05 * np.sin(v * 7))
        d += strength * .12 * np.exp(-((v - .74) / .19) ** 2)
        d = np.minimum(d, corridor(u, v, [(.23,.43),(.45,.39),(.67,.40),(.83,.30)], [.065,.024,.022,.003]))
        d = np.minimum(d, corridor(u, v, [(.62,.40),(.64,.23),(.58,.10)], [.022,.021,.002]))
        uplift = 1.15 / (1 + np.exp((v - .29) * 24))
        uplift += .20 * np.exp(-((u - .98) / .13) ** 2)
        d = np.maximum(d, -ellipse(u, v, .075, .13, .105, .22, -.2))
    # Small-scale irregularity stays subordinate to the regional structure.
    coast_detail = (detail - .5) * .13 + (base - .5) * .07
    if style == 'sydney':
        # Narrow drowned tributaries must retain their topology. Deformed
        # coordinates already bend their shores; don't dam them with noise.
        coast_detail = np.clip(coast_detail, -.045, .045) * np.minimum(1, np.abs(d)/.06)
    d += coast_detail
    inland = np.maximum(d, 0)
    coast_rise = 1 - np.exp(-inland / .055)
    texture = .55 * np.exp((base - .5) * 3.2 + (detail - .5) * 2)
    land = .42 + inland * .075 + coast_rise * (.005 + uplift * .15 * texture)
    # Low-amplitude coherent variation survives on plains, so drainage can
    # choose minor valleys without a hand-drawn, uniformly excavated corridor.
    land += coast_rise * ((base-.5)*.005 + (detail-.5)*.002)
    if style == 'vancouver':
        # The alluvial basin drains west, not to the nearest northern inlet.
        # Shape this broad regional surface BEFORE routing water; no channel
        # path is used to cut or colour a strip across it.
        center = .74 + .035*np.sin(u*9) + (base-.5)*.08
        plain = .002 + np.maximum(u-.20,0)*.025 + .012*((v-center)/.22)**2
        plain += (detail-.5)*.0015
        weight = np.clip((v-.46)/.20,0,1)
        weight = weight*weight*(3-2*weight)
        land = land*(1-weight) + (.42+coast_rise*plain)*weight
    seabed = .42 - .23 * (1 - np.exp(np.minimum(d, 0) * 7))
    return np.where(d > 0, land, seabed).astype(np.float32)

