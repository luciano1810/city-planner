"""One calendar for street activity, daylight and monthly city settlement."""
import calendar
import copy
import math

DAY = 86400
SPEEDS = (1, 5, 15, 60, 300, 3600, 21600, 86400, 604800, 2592000)
MAX_STEP = 31 * DAY


def month_days(month):
    return calendar.monthrange(2026 + month // 12, month % 12 + 1)[1]


def initial_state(scene_seconds=32400., elapsed=0.):
    return dict(monthSeconds=scene_seconds % DAY, elapsedSeconds=elapsed, speed=1, sampled=False)


def validate(state, month):
    if not isinstance(state, dict):
        raise ValueError('无效的统一模拟状态')
    for key, high in [('monthSeconds', month_days(month)*DAY), ('elapsedSeconds', 1e12)]:
        value = state.get(key)
        if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= high:
            raise ValueError('无效的统一模拟时钟')
    if state['monthSeconds'] >= month_days(month)*DAY:
        raise ValueError('月内时刻超过当月范围')
    if type(state.get('speed')) not in (int, float) or state['speed'] not in SPEEDS or type(state.get('sampled')) is not bool:
        raise ValueError('无效的模拟速度')


def shift_month(city, previous_month):
    """Legacy month commands use the same calendar and retain the time of day."""
    state = city.s['simulation']
    before = state['monthSeconds']
    day = min(int(before // DAY), month_days(previous_month+1)-1)
    after = day*DAY + before % DAY
    elapsed = month_days(previous_month)*DAY + after-before
    state['monthSeconds'] = after
    state['elapsedSeconds'] += elapsed
    state['sampled'] = True
    city.s['sceneTimeSeconds'] += elapsed


def advance(city, seconds, speed=None, mode='observed', reset=False):
    from .signals import LiveTraffic
    if type(seconds) not in (int, float) or not math.isfinite(seconds) or not 0 <= seconds <= MAX_STEP:
        raise ValueError('每次模拟推进须为 0–31 天')
    if speed is not None and (type(speed) not in (int, float) or speed not in SPEEDS):
        raise ValueError('未知模拟速度')
    if mode not in ('observed', 'test') or type(reset) is not bool:
        raise ValueError('无效的交通设置')
    state = city.s['simulation']
    crosses_month = state['monthSeconds']+seconds >= month_days(city.s['month'])*DAY
    before = (copy.deepcopy(city.s), city.rng.getstate(), city.runtime(),
              copy.deepcopy(city.undo), copy.deepcopy(city.redo)) if crosses_month else None
    initial_month = city.s['month']
    try:
        if speed is not None:
            state['speed'] = speed
        remaining = float(seconds)
        while remaining > 1e-9:
            duration = month_days(city.s['month'])*DAY
            chunk = min(remaining, duration-state['monthSeconds'])
            state['monthSeconds'] += chunk
            state['elapsedSeconds'] += chunk
            city.s['sceneTimeSeconds'] += chunk
            remaining = max(0., remaining-chunk)
            if state['monthSeconds'] >= duration-1e-8:
                state['monthSeconds'] = 0.
                city.step(1, advance_clock=False)
                state = city.s['simulation']
        target = state['elapsedSeconds']
        live = city.live_traffic
        replaced = live is None or reset or live.mode != mode
        if replaced:
            live = city.live_traffic = LiveTraffic(city, mode)
        # At fast-forward speeds, retain a bounded, signal-safe traffic sample.
        # The full elapsed interval still advances the calendar and settlements.
        sampled = seconds > 10
        window = min(seconds, 3.) if sampled else seconds
        if replaced or sampled:
            live.clock = max(0., target-window)
        live.advance(window)
        live.clock = target
        if seconds:
            state['sampled'] = sampled
        result = dict(simulation=copy.deepcopy(state), sceneTimeSeconds=city.s['sceneTimeSeconds'],
                      month=city.s['month'], monthsAdvanced=city.s['month']-initial_month,
                      traffic=live.view())
        if result['monthsAdvanced']:
            result['city'] = city.view()
        return result
    except Exception:
        if before:
            city.s, rng, runtime, city.undo, city.redo = before
            city.rng.setstate(rng)
            city.rebuild()
            city.restore_runtime(runtime)
        raise
