"""Dated, paired rail operation comparisons, including adverse conditions."""
import copy
import json
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from tests.test_growth_scenarios import separated_towns
from tests.test_city import City
from city import simulation,construction,rail_runtime
BASELINE=None
BASE_IDS=None


def scenario():
    if BASELINE is not None:return City.restore(copy.deepcopy(BASELINE)),dict(BASE_IDS)
    city,ids=separated_towns();stations=[]
    for i,x in enumerate((650,3250)):
        city.command(dict(type='rail_station',mode='metro' if i==0 else 'train',point=[x,1140],level=-1,platformCount=2))
        stations.append(city.s['stops'][-1])
    a,b=[s['platforms'][0] for s in stations]
    city.command(dict(type='road',kind='train',level=-1,points=[a['ports'][1],b['ports'][0]],snap=False,railManaged=True))
    for s in stations:city.command(dict(type='rail_facility',kind='turnback',platform=s['platforms'][0]['id'],point=s['point']))
    city.command(dict(type='line',mode='metro',name='两城直通',stops=[s['id'] for s in stations],platforms={s['id']:s['platforms'][0]['id'] for s in stations},headway=6))
    identity=city.s['lines'][-1]['id'];city.command(dict(type='line_update',id=identity,enabled=False))
    return city,dict(ids,line=identity,stations=[s['id'] for s in stations])


def metrics(city,ids):
    route=city.route(ids['home'],ids['work'],False,7000)
    result=dict(date=construction.date_string(construction.day(city)),commute=route['minutes'] if route else None,
        population=sum(h['size'] for h in city.s['households']),employed=sum(bool(h.get('job')) for h in city.s['households']),
        treasury=city.s['treasury'],revenue=city.s['revenue'],maintenance=city.s['maintenance'],areas={})
    for name,rid in [('housing',ids['homesRoad']),('employment',ids['jobsRoad'])]:
        ps=[p for p in city.s['parcels'] if p['road']==rid];pids={p['id'] for p in ps};bs=[p['building'] for p in ps if p.get('building')]
        result['areas'][name]=dict(buildings=len(bs),active=sum(b['status']=='active' for b in bs),
            residential=sum(b['use']=='residential' for b in bs),commercial=sum(b['use']=='commercial' for b in bs),office=sum(b['use']=='office' for b in bs),
            residents=sum(h['size'] for h in city.s['households'] if h['home'] in pids),workers=sum(h.get('job') in pids for h in city.s['households']),
            publicJobs=sum(p.get('publicJobs',0) for p in ps),land=sum(p.get('landValue',0) for p in ps)/max(1,len(ps)))
    actual=rail_runtime.view(city);counts=actual['totals'].get('network',{})
    result['railActual']={k:counts.get(k,0) for k in ('entry','board','alight','exit','transfer','denied','unmet','departure')}
    result['railActual'].update(waiting=actual['waiting'],onboard=actual['onboard'])
    result['typicalRailBoardings']=sum(l.get('boardings',0) for l in city.s['lines'] if l['mode'] in ('metro','train'))
    result['commuteWait']=route.get('wait') if route else None
    return result


def run(name,days,modify=None):
    base,ids=scenario()
    if modify:modify(base,ids)
    snap=base.snapshot();off=City.restore(snap);on=City.restore(snap)
    assert off.snapshot()==on.snapshot()
    initial=metrics(off,ids)
    on.command(dict(type='line_update',id=ids['line'],enabled=True))
    assert off.s['treasury']==on.s['treasury'] and off.rng.getstate()==on.rng.getstate()
    series=dict(stopped=[metrics(off,ids)],operating=[metrics(on,ids)])
    for day in range(days):
        for key,c in [('stopped',off),('operating',on)]:
            simulation.advance_calendar(c,86400);series[key].append(metrics(c,ids))
    report=dict(condition=name,days=days,initial=initial,series=series,
                delta={k:series['operating'][-1][k]-series['stopped'][-1][k] for k in ('population','employed','treasury')})
    print(json.dumps(dict(condition=name,delta=report['delta']),ensure_ascii=False),flush=True)
    return report


def main():
    import argparse
    global BASELINE,BASE_IDS
    parser=argparse.ArgumentParser();parser.add_argument('--snapshot');parser.add_argument('--ids');parser.add_argument('--output')
    args=parser.parse_args()
    if args.snapshot:
        BASELINE=json.loads(Path(args.snapshot).read_text());BASE_IDS=json.loads(Path(args.ids).read_text())
    results=[]
    results.append(run('正常需求与接驳',120))
    def low(c,ids):
        c.s['households']=[];c.s['pendingHousing']=0;c.s['migrationQueue']=[];c.s['settings'].update(migration=0,growth=0)
        c.rebuild();c.match_jobs();c.assign_traffic()
    results.append(run('零实际出行需求',14,low))
    def bad_access(c,ids):
        for s in c.s['stops']:
            if s['id'] in ids['stations']:
                for e in s['entrances']:e['enabled']=False
        c.rebuild();c.match_jobs();c.assign_traffic()
    results.append(run('接驳入口关闭',14,bad_access))
    def frequency(c,ids):c.command(dict(type='line_update',id=ids['line'],headway=120,assignedFleet=None))
    results.append(run('低频服务（120 分钟班距）',14,frequency))
    def congestion(c,ids):
        l=next(l for l in c.s['lines'] if l['id']==ids['line'])
        c.command(dict(type='line',mode='metro',name='共线普通服务',stops=l['stops'],platforms=l['platforms'],headway=1,dwell=5))
    results.append(run('共线高停站时间',14,congestion))
    def cost(c,ids):c.command(dict(type='line_update',id=ids['line'],assignedFleet=50,formation=6))
    results.append(run('高配车运营成本',14,cost))
    positive=results[0];a,b=positive['series']['stopped'][-1],positive['series']['operating'][-1]
    checks=dict(jobsReachable=b['commute'] is not None and a['commute'] is None,employmentImproved=b['employed']>a['employed'],
                housingResidentsImproved=b['areas']['housing']['residents']>a['areas']['housing']['residents'],
                housingDevelopment=b['areas']['housing']['buildings']>a['areas']['housing']['buildings'],
                employmentDevelopment=b['areas']['employment']['buildings']>a['areas']['employment']['buildings'],
                noUnconditionalPopulation=results[1]['delta']['population']==0,
                noAccessNoBenefit=results[2]['delta']['employed']==0,
                operationHasCost=results[1]['delta']['treasury']<0,actualRailUsage=b['railActual']['board']>0,actualConservation=b['railActual']['entry']>=b['railActual']['exit'])
    output=Path(args.output) if args.output else ROOT/'output/playwright/rail-reconstruction/development.json';output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(dict(checks=checks,results=results,method='每种条件各自从同一快照分叉；两臂仅改变目标线开通状态。日期、资金、建筑、居民、随机状态保持相同起点。按日记录，建设成本两臂相同。',limitation='客流意图按典型日旅程生成，属于游戏模型证据，不是现实城市预测。'),ensure_ascii=False,indent=2))
    assert all(checks.values()),checks
    print('PASS '+str(output),flush=True)
if __name__=='__main__':main()
