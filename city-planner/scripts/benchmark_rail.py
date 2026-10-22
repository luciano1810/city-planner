"""A reproducible rail scale boundary, separate from city-growth benchmarks."""
import json
import sys
import time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from tests.test_city import City,flat_world,road
from city import rail_runtime

start=time.perf_counter();city=City(flat_world())
city.s['settings'].update(autoGrow=False,autoRenew=False,growth=0,migration=0)
all_lines=[]
for row,y in enumerate((900,2500)):
    road(city,[(200,y+50),(3800,y+50)])
    stops=[]
    for x in range(400,3400,300):
        city.command(dict(type='rail_station',mode='metro',point=[x,y],level=-1,platformCount=2))
        stops.append(city.s['stops'][-1])
    for a,b in zip(stops,stops[1:]):
        city.command(dict(type='road',kind='train',level=-1,points=[a['platforms'][0]['ports'][1],b['platforms'][0]['ports'][0]],snap=False,railManaged=True))
    for s in (stops[0],stops[-1]):city.command(dict(type='rail_facility',kind='turnback',point=s['point'],platform=s['platforms'][0]['id']))
    for i in range(4):
        city.command(dict(type='line',mode='metro',name=f'{row+1} 走廊 {i+1} 线',stops=[s['id'] for s in stops],platforms={s['id']:s['platforms'][0]['id'] for s in stops},headway=5,formation=2))
        all_lines.append(city.s['lines'][-1])
built=time.perf_counter();city.trips=[]
for line in all_lines:
    for i in range(30):
        city.trips.append(dict(source=f"home-{line['id']}-{i}",target='work',purpose='work',people=1,completed=True,transitCalls=[
            dict(line=line['id'],stop=line['stops'][0],kind='board',minute=600,direction=0),
            dict(line=line['id'],stop=line['stops'][-1],kind='alight',minute=630,direction=0)]))
rail_runtime.advance(city,86400);ended=time.perf_counter();view=rail_runtime.view(city)
counts=view['totals'].get('network',{})
assert counts['entry']==240 and counts.get('exit',0)==240 and view['waiting']==0 and view['onboard']==0,counts
result=dict(stations=20,platforms=40,lines=8,roads=len(city.s['roads']),attemptedPassengers=240,
            buildSeconds=round(built-start,3),simulate24HoursSeconds=round(ended-built,3),
            counts=counts,trainCountAtEnd=len(view['trains']),rules='两条走廊，每条四线共线；逐命令建设；运行不抽样。仅基准，不是生产规模性能承诺。')
city.trips=[]
rail_runtime.advance(city,19*3600)
assert not city.s['railRuntime']['trains'],[(t['line'],t['status'],t['blockReason']) for t in city.s['railRuntime']['trains']]
result['allTrainsFinishAfterClose']=True
output=ROOT/'output/playwright/rail-reconstruction/scale.json';output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False),flush=True)
