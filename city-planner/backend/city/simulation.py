"""Accelerated city calendar with an independently persisted sun and bounded fast-forward lighting."""
import calendar
import copy
import math

DAY = 86400
SPEEDS = (1, 2, 3, 5, 15, 60, 300, 3600, 21600, 86400, 604800, 2592000)
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
    # Discrete monthly steps do not change the viewing illumination.


def advance(city, seconds, speed=None, mode='observed', reset=False, daylight_seconds=None, *, settlement=None):
    from .signals import LiveTraffic
    if type(seconds) not in (int, float) or not math.isfinite(seconds) or not 0 <= seconds <= MAX_STEP:
        raise ValueError('每次模拟推进须为 0–31 天')
    if speed is not None and (type(speed) not in (int, float) or speed not in SPEEDS):
        raise ValueError('未知模拟速度')
    if mode not in ('observed', 'test') or type(reset) is not bool:
        raise ValueError('无效的交通设置')
    state = city.s['simulation']
    if daylight_seconds is None:
        rate = speed if speed is not None else state['speed']
        daylight_seconds = seconds if rate < DAY else seconds / rate
    if type(daylight_seconds) not in (int, float) or not math.isfinite(daylight_seconds) or not 0 <= daylight_seconds <= MAX_STEP:
        raise ValueError('无效的光照推进时长')
    crosses_month = state['monthSeconds']+seconds >= month_days(city.s['month'])*DAY
    before = (copy.deepcopy(city.s), city.rng.getstate(), city.runtime(),
              copy.deepcopy(city.undo), copy.deepcopy(city.redo)) if crosses_month else None
    initial_month = city.s['month']
    previous_live = city.live_traffic
    prepared_view = None
    def road_signature():
        return [(r['id'],r['kind'],r['level'],r['oneway'],r['points']) for r in city.s['roads']]
    previous_roads = copy.deepcopy(road_signature()) if crosses_month and previous_live else None
    try:
        if speed is not None:
            state['speed'] = speed
        remaining = float(seconds)
        while remaining > 1e-9:
            duration = month_days(city.s['month'])*DAY
            chunk = min(remaining, duration-state['monthSeconds'])
            state['monthSeconds'] += chunk
            state['elapsedSeconds'] += chunk
            city.s['sceneTimeSeconds'] += daylight_seconds * chunk / seconds
            remaining = max(0., remaining-chunk)
            if state['monthSeconds'] >= duration-1e-8:
                state['monthSeconds'] = 0.
                if settlement is None:city.step(1, advance_clock=False)
                else:prepared_view=settlement(city)
                state = city.s['simulation']
        if not seconds:city.s['sceneTimeSeconds']+=daylight_seconds
        target = state['elapsedSeconds']
        live = city.live_traffic
        if live is None and previous_live and previous_roads == road_signature():
            # Frontage and demand can change at settlement without changing
            # roads. Keep in-flight journeys, reservations and vehicle IDs.
            from .vehicle_trips import build_demand
            live = city.live_traffic = previous_live
            balances = live.balances
            build_demand(live,live.terminals)
            live.balances.update({key:balances[key] for key in live.balances if key in balances})
        replaced = live is None or reset or live.mode != mode
        if replaced:
            live = city.live_traffic = LiveTraffic(city, mode)
        # Traffic has a continuous visual clock. Never jump the signal clock to
        # a different phase while vehicles are still traversing the junction.
        # Above 5x, show a bounded 5x sample while the calendar advances fully.
        rate = state['speed']
        sampled = rate > 5 or seconds > 10
        window = min(10., seconds if rate <= 5 else seconds/rate*5)
        if replaced and not sampled:
            live.clock = max(0.,target-window)
            live.signal_clock = live.clock
        live.advance(window)
        live.clock = target
        if seconds:
            state['sampled'] = sampled
        result = dict(simulation=copy.deepcopy(state), sceneTimeSeconds=city.s['sceneTimeSeconds'],
                      month=city.s['month'], monthsAdvanced=city.s['month']-initial_month,
                      traffic=live.view(),trafficAnimation=live.animation(),trafficReset=replaced)
        if result['monthsAdvanced']:
            if prepared_view is None:result['city']=city.view()
            else:
                # The heavy map/statistics projection is already prepared in
                # the worker. Rebase only fields changed by the live clock.
                prepared_view.update(simulation=copy.deepcopy(state),sceneTimeSeconds=city.s['sceneTimeSeconds'],
                    month=city.s['month'],name=city.s['name'],liveTraffic=result['traffic'],
                    canUndo=bool(city.undo),canRedo=bool(city.redo))
                if 'saveGroup' in city.s:prepared_view['saveGroup']=city.s['saveGroup']
                result['city']=prepared_view
        return result
    except Exception:
        if before:
            city.s, rng, runtime, city.undo, city.redo = before
            city.rng.setstate(rng)
            city.rebuild()
            city.restore_runtime(runtime)
        raise
