"""Persistent per-junction timing and inbound lane arrow assignments."""
import copy
from .parameters import DRIVABLE_ROADS
from .vehicle_paths import LANES

TURNS = ('left', 'straight', 'right')


def key(arm):
    return f"{arm['road']}:{arm['direction']}"


def turns_for(arm, approaches):
    incoming = [-v for v in arm['tangent']]
    result = set()
    for other in approaches:
        if other is arm or not other['outgoing'] or other['kind'] not in DRIVABLE_ROADS:
            continue
        dot = sum(a*b for a, b in zip(incoming, other['tangent']))
        cross = incoming[0]*other['tangent'][1]-incoming[1]*other['tangent'][0]
        if dot > .82:
            result.add('straight')
        elif dot > -.82:
            result.add('right' if cross > 0 else 'left')
    return [turn for turn in TURNS if turn in result]


def defaults(arm, approaches):
    turns = turns_for(arm, approaches)
    count = arm.get('laneCount', LANES[arm['kind']] // (1 if arm.get('oneway') else 2))
    lanes = [[turn for turn in turns if turn == 'straight' or count == 1
              or turn == 'left' and lane == 0 or turn == 'right' and lane == count-1]
             for lane in range(count)]
    lanes = [row or ([turns[0 if lane < count/2 else -1]] if turns else []) for lane, row in enumerate(lanes)]
    if arm.get('autoLanes') and count > 1 and 'left' in turns and len(turns) > 1:
        lanes[0] = ['left']
        lanes[1:] = [[t for t in row if t != 'left'] or [t for t in turns if t != 'left'] for row in lanes[1:]]
    return turns, lanes


def valid_lanes(lanes, turns, count):
    return (isinstance(lanes, list) and len(lanes) == count
            and all(isinstance(row, list) and row and all(isinstance(t, str) and t in turns for t in row)
                    and len(row) == len(set(row)) for row in lanes)
            and set(turns) == {turn for row in lanes for turn in row})


def apply(junction, settings):
    for arm in junction['approaches']:
        if not arm['incoming'] or arm['kind'] not in DRIVABLE_ROADS:
            continue
        turns, lanes = defaults(arm, junction['approaches'])
        custom = settings.get('laneTurns', {}).get(key(arm))
        # A road upgrade or a removed exit can invalidate the saved lane layout.
        # Use current geometry's defaults instead of stale lane counts or exits.
        arm['availableTurns'] = turns
        arm['laneTurns'] = copy.deepcopy(custom if valid_lanes(custom, turns, len(lanes)) else lanes)


def update(city, command, timing_limits):
    junction = next((j for j in city.network['junctions'] if j['id'] == command.get('id')), None)
    if junction is None:
        raise ValueError('路口不存在')
    saved = city.s.setdefault('junctionSettings', {})
    if command.get('reset') is True:
        saved.pop(junction['id'], None)
        return
    timing = command.get('timing', {})
    if not isinstance(timing, dict) or any(k not in timing_limits for k in timing):
        raise ValueError('未知路口配时参数')
    if timing and junction['control'] != 'signals':
        raise ValueError('此路口没有信号灯')
    for name, value in timing.items():
        low, high = timing_limits[name]
        if type(value) is not int or not low <= value <= high:
            raise ValueError('路口配时超出范围：'+name)
    lanes = command.get('laneTurns', {})
    if not isinstance(lanes, dict):
        raise ValueError('车道箭头格式无效')
    arms = {key(a): a for a in junction['approaches'] if a['incoming'] and a['kind'] in DRIVABLE_ROADS}
    for approach, rows in lanes.items():
        if approach not in arms:
            raise ValueError('路口入口不存在')
        turns, baseline = defaults(arms[approach], junction['approaches'])
        if not valid_lanes(rows, turns, len(baseline)):
            raise ValueError('每条车道须选择可达方向，且每个方向至少保留一条车道')
    previous = saved.get(junction['id'], {})
    saved[junction['id']] = dict(timing={**previous.get('timing', {}), **timing},
                                laneTurns={**previous.get('laneTurns', {}), **copy.deepcopy(lanes)})
