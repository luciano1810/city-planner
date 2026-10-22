"""Shared physical approach layout for markings, editing and vehicle paths."""
from collections import defaultdict
import math

from .vehicle_paths import LANES


def clearance(arm, approaches):
    distance = arm['width']/2
    ax, ay = arm['tangent']
    for other in approaches:
        if other is arm:
            continue
        bx, by = other['tangent']
        cross = abs(ax*by-ay*bx)
        if cross > .05:
            distance = max(distance, (other['width']/2+arm['width']/2*(ax*bx+ay*by))/cross)
    return distance


def configure(network):
    positions = defaultdict(set)
    ends = defaultdict(float)
    for edge in network['edges']:
        ends[edge['road']] = max(ends[edge['road']], edge['endDistance'])
    for junction in network.get('junctions', []):
        for arm in junction['approaches']:
            positions[arm['road']].add(arm['distance'])
    for junction in network.get('junctions', []):
        for arm in junction['approaches']:
            if arm['kind'] not in LANES:
                continue
            extent = clearance(arm, junction['approaches'])
            arm['crossingDistance'] = extent+1
            arm['stopDistance'] = extent+5
            base = LANES[arm['kind']] // (1 if arm.get('oneway') else 2)
            width = arm['width'] / (1 if arm.get('oneway') else 2)
            available = ends[arm['road']]-arm['distance'] if arm['direction'] > 0 else arm['distance']
            distances = [(d-arm['distance'])*arm['direction'] for d in positions[arm['road']]]
            room = min([available]+[d/2 for d in distances if d > .1])
            count = base
            full = arm['stopDistance']+12
            # Repartition existing asphalt only: no buildings, footways or
            # opposing lanes are consumed. Reserve 24 m for a gentle taper.
            if (arm['incoming'] and arm['level'] == 0 and arm['kind'] in ('street', 'avenue')
                    and junction['control'] == 'signals' and room >= full+24):
                count = max(base, min(base+1, math.floor(width/3.25)))
            arm.update(laneCount=count, laneWidth=width/count, baseLaneCount=base,
                       laneFullDistance=full, laneTaperDistance=full+24,
                       autoLanes=count > base)
