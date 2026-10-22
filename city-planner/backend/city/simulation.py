"""Accelerated city calendar with an independently persisted sun and bounded fast-forward lighting."""
import calendar
import copy
import math

DAY = 86400
SPEEDS = (1, 2, 3, 5, 15, 60, 300, 3600, 21600, 86400, 259200, 604800, 2592000)
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


def ensure_calendar(city):
    from .construction import day
    now = int(day(city))
    city.s.setdefault('calendar', dict(nextSettlementDay=now+1, lastSettlementDay=now,
        projectCredit=0., migrationCredit=0., monthRevenue=0., monthMaintenance=0.))
    city.s.setdefault('dailyHistory', [])
    state = city.s['calendar']
    if not isinstance(state,dict):raise ValueError('无效的日结算状态')
    if 'lastWeekDay' in state:
        for key in ('lastWeekDay','nextWeekDay'):
            if type(state.get(key)) is not int or state[key]<0:
                raise ValueError('无效的历史周结算日期')
        if state['nextWeekDay']<=state['lastWeekDay'] or state['lastWeekDay']>now:
            raise ValueError('无效的历史周结算间隔')
        # The first daily close includes the uncharged tail of the old week.
        # Its record carries the full date range; old weekly rows are archived.
        state['lastSettlementDay']=state.pop('lastWeekDay')
        state.pop('nextWeekDay')
        state['nextSettlementDay']=now+1
        previous={key:city.s.get(key,0) for key in ('revenue','maintenance','movedIn','movedOut','relocated')}
        city.s['legacyWeeklyAccounts']=previous
        for key in previous:
            city.s[key]=0
            city.s.get('stats',{})[key]=0
    for key in ('projectCredit','migrationCredit','monthRevenue','monthMaintenance','monthMovedIn','monthMovedOut','monthRelocated'):
        state.setdefault(key, 0.)
        if type(state[key]) not in (int,float) or not math.isfinite(state[key]) or state[key]<0:
            raise ValueError('无效的日结算余额')
    for key in ('nextSettlementDay','lastSettlementDay'):
        if type(state.get(key)) is not int or state[key] < 0:
            raise ValueError('无效的日结算日期')
    if state['nextSettlementDay'] <= state['lastSettlementDay']:
        raise ValueError('无效的日结算间隔')
    return state


def period_factor(start, end):
    """Convert actual days to monthly rate fractions, including leap months."""
    import datetime
    from .construction import EPOCH
    return sum(1 / calendar.monthrange((EPOCH+datetime.timedelta(days=d)).year,
               (EPOCH+datetime.timedelta(days=d)).month)[1] for d in range(start, end))


def daily_boundary(city, month_changed=False):
    from . import construction, renewal
    ledger=ensure_calendar(city)
    today=int(construction.day(city))
    _,network_changed=construction.advance(city)
    if network_changed:
        from .urban import update_entrances
        update_entrances(city)
        city.build_graphs()
        city.live_traffic=None
    before_moves={key:city.s[key] for key in ('movedIn','movedOut','relocated')}
    renewal.advance(city)
    for key,previous in before_moves.items():
        ledger['month'+key[0].upper()+key[1:]]+=city.s[key]-previous
    daily = today >= ledger['nextSettlementDay']
    if daily:
        start=ledger['lastSettlementDay']
        factor=period_factor(start, today)
        ledger['lastSettlementDay']=today
        ledger['nextSettlementDay']=today+1
        city.settle_day(factor, start_day=start)
    else:
        city.refresh_construction_stats()
        city.s['revision']+=1
        city.undo=[];city.redo=[]
    if month_changed:
        city.close_month()
    return int(daily)


def advance_calendar(city, seconds, daylight_seconds=0., settlement=None):
    """Process every midnight, dated construction event and daily close."""
    from .construction import day
    ensure_calendar(city)
    state=city.s['simulation'];remaining=float(seconds);settlements=0;days=0
    # Even a sub-nanosecond remainder may be the last representable step to
    # midnight. Dropping it leaves a ready background settlement stuck forever.
    while remaining > 0:
        duration=month_days(city.s['month'])*DAY
        midnight=(int(state['monthSeconds']//DAY)+1)*DAY
        chunk=min(remaining,midnight-state['monthSeconds'])
        from . import rail_runtime
        rail_runtime.advance(city,chunk)
        state['monthSeconds']+=chunk
        state['elapsedSeconds']+=chunk
        city.s['sceneTimeSeconds']+=daylight_seconds*chunk/seconds
        remaining=max(0.,remaining-chunk)
        if state['monthSeconds'] >= midnight:
            month_changed=state['monthSeconds'] >= duration
            if month_changed:
                state['monthSeconds']=0.
                city.s['month']+=1
            if settlement is not None and int(day(city)) >= city.s['calendar']['nextSettlementDay']:
                settlement(city)
                settlements+=1
            else:
                settlements+=daily_boundary(city,month_changed)
            days+=1
            state=city.s['simulation']
    if not seconds:city.s['sceneTimeSeconds']+=daylight_seconds
    return days,settlements


def step_months(city, months):
    """A month button fast-forwards dated events; it never invokes a batch build."""
    import datetime
    from .construction import EPOCH, day
    now=EPOCH+datetime.timedelta(days=day(city))
    index=city.s['month']+months
    target=datetime.date(2026+index//12,index%12+1,min(now.day,month_days(index)))
    seconds=((target-EPOCH).days-int(day(city)))*DAY
    before=city.checkpoint()
    try:
        advance_calendar(city,seconds)
    except Exception:
        city.rollback(before)
        raise


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
    crosses_day = seconds > 0 and int((state['monthSeconds']+seconds)//DAY) > int(state['monthSeconds']//DAY)
    before = city.checkpoint() if crosses_day else None
    initial_month = city.s['month']
    previous_live = city.live_traffic
    def road_signature():
        return [(r['id'],r['kind'],r['level'],r['oneway'],r['points']) for r in city.s['roads']]
    previous_roads = copy.deepcopy(road_signature()) if crosses_day and previous_live else None
    try:
        if speed is not None:
            state['speed'] = speed
        days,settlements=advance_calendar(city,seconds,daylight_seconds,settlement)
        state=city.s['simulation']
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
                      month=city.s['month'], monthsAdvanced=city.s['month']-initial_month, daysAdvanced=days, settlementsAdvanced=settlements,
                      railRuntime=__import__('city.rail_runtime',fromlist=['view']).view(city),traffic=live.view(),trafficAnimation=live.animation(),trafficReset=replaced)
        if days:result['city']=city.view()
        return result
    except Exception:
        if before:
            city.rollback(before)
        raise
