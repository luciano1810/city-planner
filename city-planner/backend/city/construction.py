"""Dated construction commitments. Capacity is reserved before work starts."""
import calendar
import datetime
import hashlib

EPOCH = datetime.date(2026, 1, 1)
FUTURE = ('planned', 'construction')


def day(city):
    month = city.s['month']
    start = datetime.date(2026 + month // 12, month % 12 + 1, 1)
    return (start - EPOCH).days + city.s['simulation']['monthSeconds'] / 86400


def date_string(value):
    return (EPOCH + datetime.timedelta(days=int(value))).isoformat()


def add_months(value, months):
    start = EPOCH + datetime.timedelta(days=int(value))
    index = start.year * 12 + start.month - 1 + int(months)
    year, month = divmod(index, 12)
    return (datetime.date(year, month + 1, min(start.day, calendar.monthrange(year, month + 1)[1])) - EPOCH).days


def offset(key, maximum=7):
    return 1 + int(hashlib.sha256(key.encode()).hexdigest()[:8], 16) % maximum


def schedule(city, building, *, start=None, months=None):
    now = int(day(city))
    start = now + offset(building['id']) if start is None else int(start)
    months = max(1, building.get('ready', city.s['month'] + 3) - city.s['month']) if months is None else months
    # Site-specific durations prevent identical floor counts completing together.
    end = max(start + 1, add_months(start, months) + offset(building['id'] + ':duration', 13) - 7)
    building.update(status='planned' if start > now else 'construction', startDay=start, completionDay=end,
                    startDate=date_string(start), completionDate=date_string(end), constructionProgress=0.)


def schedule_extension(city, building, months):
    start=int(day(city))+offset(building['id']+':extension')
    building['extensionStartDay']=start
    building['extensionCompletionDay']=add_months(start,months)
    building['extensionProgress']=0.


def migrate(city):
    """Old month-only commitments get a deterministic remaining daily schedule."""
    now = int(day(city))
    for p in city.s['parcels']:
        b = p.get('building')
        if not b:
            continue
        b.setdefault('lastAgeDay',now)
        if b['status'] in FUTURE and 'completionDay' not in b:
            schedule(city, b, start=now, months=max(1, b.get('ready', city.s['month'] + 1) - city.s['month']))
        if b.get('extensionReady') and 'extensionCompletionDay' not in b:
            b['extensionStartDay'] = now
            b['extensionCompletionDay'] = add_months(now, max(1, b['extensionReady'] - city.s['month']))


def advance(city):
    now = int(day(city))
    changed = False
    network_changed = False
    for p in city.s['parcels']:
        b = p.get('building')
        if not b:
            continue
        if b['status'] in FUTURE:
            if 'completionDay' not in b:
                schedule(city, b, start=now)
            if now >= b['startDay']:
                if b['status'] == 'planned':
                    b['status'] = 'construction'
                    network_changed = True
                    city.event('开工', f"{city.use_name(b['use'])}开工，预计 {b['completionDate']} 竣工", p['center'])
                b['constructionProgress'] = round(min(1., (now - b['startDay']) / max(1, b['completionDay'] - b['startDay'])), 6)
                changed = True
                if now >= b['completionDay']:
                    b['status'] = 'active'
                    b['lastAgeDay'] = now
                    network_changed = True
                    city.event('竣工', f"{city.use_name(b['use'])}竣工，可用容量 {b['capacity']}", p['center'])
        if b.get('extensionCompletionDay'):
            start=b['extensionStartDay'];end=b['extensionCompletionDay']
            previous=b.get('extensionProgress',0.)
            b['extensionProgress']=round(max(0.,min(1.,(now-start)/max(1,end-start))),6)
            changed=changed or b['extensionProgress']!=previous
        if b.get('extensionCompletionDay') and now >= b['extensionCompletionDay']:
            city.finish_extension(p)
            changed = True
        if b['status'] not in FUTURE:
            elapsed=max(0,now-b.get('lastAgeDay',now-1))
            b['age'] = b.get('age', 0) + elapsed / 30.436875
            b['condition'] = round(max(20, b.get('condition', 100) - .08 * elapsed / 30.436875), 6)
        b['lastAgeDay']=now
    return changed, network_changed


def validate(city):
    import math
    for p in city.s['parcels']:
        b=p.get('building')
        if not b:continue
        for key in ('startDay','completionDay','extensionStartDay','extensionCompletionDay','lastAgeDay'):
            if key in b and (type(b[key]) is not int or not 0<=b[key]<=1000000):
                raise ValueError('无效的建筑施工日期')
        if 'completionDay' in b:
            if 'startDay' not in b or b['completionDay']<=b['startDay']:
                raise ValueError('建筑竣工日期必须晚于开工日期')
            b['startDate']=date_string(b['startDay']);b['completionDate']=date_string(b['completionDay'])
        if 'extensionCompletionDay' in b and ('extensionStartDay' not in b or b['extensionCompletionDay']<=b['extensionStartDay']):
            raise ValueError('加层竣工日期必须晚于开工日期')
        for key in ('constructionProgress','extensionProgress'):
            if key in b and (type(b[key]) not in (int,float) or not math.isfinite(b[key]) or not 0<=b[key]<=1):
                raise ValueError('无效的建筑施工进度')
