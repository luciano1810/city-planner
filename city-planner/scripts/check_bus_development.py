"""Controlled six-month bus-development acceptance using the curbside workflow.

Both arms have identical buildings, roads, stops, depot, funds and random state.
Only line operation differs. Results are model evidence, not a city forecast.
"""
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tests.test_city import City, flat_world, road
from tests.test_city_v3 import complete
from tests.test_growth_scenarios import family


def scenario():
    city = City(flat_world(), '公交发展对照')
    city.s['settings'].update(autoGrow=False, autoRenew=False, migration=0,
                              externalJobs=250, maxProjects=4)
    jobs = road(city, [[300,1200],[900,1200]])
    homes = road(city, [[3000,1200],[3700,1200]])
    road(city, [[900,1200],[3000,1200]], kind='highway')
    for p in city.s['parcels']:
        p['use'] = 'office' if p['road'] == jobs else 'residential'
    work = min((p for p in city.s['parcels'] if p['road'] == jobs), key=lambda p:math.dist(p['center'],[650,1200]))
    home = min((p for p in city.s['parcels'] if p['road'] == homes), key=lambda p:math.dist(p['center'],[3250,1200]))
    complete(city, work, 'office', 120)
    complete(city, home, 'residential', 40)
    home['rent'] = 2
    city.s['households'] = [family(city, home['id']) for _ in range(20)]
    city.s['pendingHousing'] = 30
    city.s['migrationQueue'] = [dict(income=7000, car=False, count=30)]
    city.command(dict(type='special_building', kind='bus_depot', point=[420,1100]))
    city.command(dict(type='bus_line', name='两城联络线', headway=6, capacity=80,
                      stops=[dict(road=jobs, anchor=[650,1200], side=1),
                             dict(road=homes, anchor=[3250,1200], side=1)]))
    line = city.s['lines'][0]['id']
    city.command(dict(type='line_update', id=line, enabled=False))
    return city, dict(work=work['id'], home=home['id'], jobs=jobs, homes=homes, line=line)


def metrics(city, ids):
    buildings = [p for p in city.s['parcels'] if p.get('building') and p['building']['status']=='active']
    route = city.route(ids['home'], ids['work'], False, 7000)
    line = next(l for l in city.s['lines'] if l['id']==ids['line'])
    areas = {}
    for name, rid in [('employment',ids['jobs']), ('housing',ids['homes'])]:
        parcels = [p for p in city.s['parcels'] if p['road']==rid]
        pids = {p['id'] for p in parcels}
        sites = [p for p in buildings if p['id'] in pids]
        areas[name] = dict(buildings=len(sites),
            homes=sum(p['building']['use']=='residential' for p in sites),
            businesses=sum(p['building']['use']!='residential' for p in sites),
            residents=sum(h['size'] for h in city.s['households'] if h['home'] in pids),
            workers=sum(h.get('job') in pids for h in city.s['households']),
            jobs=sum(p['building'].get('positions',0) for p in sites),
            publicJobs=round(sum(p.get('publicJobs',0) for p in parcels)/max(1,len(parcels)),2))
    return dict(month=city.s['month'], households=len(city.s['households']),
                population=sum(h['size'] for h in city.s['households']),
                employed=sum(bool(h.get('job')) for h in city.s['households']),
                waiting=city.s['pendingHousing'],
                commuteMinutes=round(route['minutes'],2) if route else None,
                commuteMode=route['mode'] if route else None,
                boardings=line['boardings'], failedCommutes=sum(h.get('commuteFailed',False) for h in city.s['households']),
                treasury=round(city.s['treasury'],2), areas=areas)


def main():
    base, ids = scenario()
    off = City.restore(base.snapshot())
    on = City.restore(base.snapshot())
    assert off.snapshot()==on.snapshot()
    on.command(dict(type='line_update',id=ids['line'],enabled=True))
    assert off.s['treasury']==on.s['treasury']
    assert off.s['roads']==on.s['roads']
    assert [[s[k] for k in ('id','road','anchor','side')] for s in off.s['stops']]==[[s[k] for k in ('id','road','anchor','side')] for s in on.s['stops']]
    series = dict(stopped=[metrics(off,ids)], operating=[metrics(on,ids)])
    for _ in range(6):
        off.step();on.step()
        series['stopped'].append(metrics(off,ids));series['operating'].append(metrics(on,ids))
        print(json.dumps(dict(month=on.s['month'],stopped=series['stopped'][-1],operating=series['operating'][-1]),ensure_ascii=False),flush=True)
    a,b=series['stopped'][-1],series['operating'][-1]
    checks = dict(
        stoppedNoCommute=a['commuteMinutes'] is None,
        operatingBusCommute=b['commuteMode']=='public' and b['commuteMinutes']<30,
        jobsGained=b['employed']>a['employed'],
        housingPopulationGained=b['areas']['housing']['residents']>a['areas']['housing']['residents'],
        housingBuildingsGained=b['areas']['housing']['homes']>a['areas']['housing']['homes'],
        employmentBuildingsGained=b['areas']['employment']['businesses']>a['areas']['employment']['businesses'],
        employmentJobsGained=b['areas']['employment']['jobs']>a['areas']['employment']['jobs'],
        migrantQueueCleared=b['waiting']==0 and a['waiting']==30,
        allCommutersServed=b['failedCommutes']==0,
        dailySettlementCadence=all(
            len(city.s['dailyHistory'])==181
            and all(row['periodDays']==1 for row in city.s['dailyHistory'])
            and len({row['day'] for row in city.s['dailyHistory']})==181
            for city in (off,on)),
    )
    # The operating case must continue identically after persistence.
    restored = City.restore(on.snapshot())
    restored.step();on.step()
    checks['saveContinuationIdentical']=metrics(restored,ids)==metrics(on,ids)
    report=dict(passed=all(checks.values()),months=6,settlement='daily-midnight',checks=checks,series=series,
        design='同一快照、相同初始资金/道路/总站/站点/建筑/居民/随机状态，仅改变线路运营。20 户居民、30 户迁入意向、就业与住宅两端通过机动车道路连接；无汽车、无步行跨区连接。',
        limitation='验证当前游戏模型中可达性改善的作用；发展还取决于就业和迁入需求、建造用地、资金与服务，公交不会无条件触发增长。')
    output=ROOT/'output/playwright/bus-lifecycle/development-report.json'
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2))
    assert report['passed'], checks
    print('PASS '+str(output),flush=True)


if __name__=='__main__':
    main()
