"""Synthetic capacity probe, explicitly separate from natural-growth evidence.

10,000 occupied/buildable buildings, 100,000 actual residents, 20 bus lines.
Creates an inspectable save; a bounded child process measures one simulation month.
"""
import argparse,base64,gzip,json,os,platform,resource,subprocess,sys,time
from pathlib import Path
from collections import Counter
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from city.engine import City,MODEL_VERSION
from city.scenario import valley_world
from city.geometry import building_footprint
from city.urban import building_style

def fixture():
    world=valley_world();world['config'].update(seed='CAPACITY-10000',widthKm=8,heightKm=8)
    world['grid'].update(widthMeters=8000,heightMeters=8000,pixelSizeMeters=[8000/240]*2)
    world['channels']=[];world['elevation']=base64.b64encode(np.full((240,240),int(.22*65535),dtype='<u2').tobytes()).decode()
    world['water']=base64.b64encode(np.zeros((240,240),dtype='<u2').tobytes()).decode()
    world['waterBodies']['ocean']=base64.b64encode(bytes(240*240//8)).decode()
    world['stats'].update(riverCount=0,maxElevation=144,landPercent=100)
    c=City(world,'规模压力样本 1万建筑 10万人');c.s['settings'].update(autoGrow=False,growth=0,migration=0)
    for row in range(100):c.add_road(dict(kind='street',points=[[500,500+row*60],[6500,500+row*60]]))
    for column in range(11):c.add_road(dict(kind='street',points=[[500+column*600,500],[500+column*600,6500]]))
    for row in range(100):
        for col in range(100):
            x,y=500+col*60,500+row*60;index=row*100+col
            use=['residential']*4+['office','office','commercial','commercial','industrial','warehouse']
            use=use[index%10]
            p=dict(id=f'p-scale-{index}',road=c.s['roads'][row]['id'],points=[[x+10,y+12],[x+50,y+12],[x+50,y+52],[x+10,y+52],[x+10,y+12]],
                center=[x+30,y+32],frontage=[x+30,y],area=1600,buildableArea=1600,connected=True,landValue=200,rent=10,age=24,use='auto')
            shape=building_footprint(p,use);floors=3 if use=='residential' else 1 if use in ('industrial','warehouse') else 4
            p['building']=dict(id=f'b-scale-{index}',use=use,floors=floors,floorArea=shape.area*floors,footprintArea=shape.area,footprint=[list(q) for q in shape.exterior.coords],
                capacity=10 if use=='residential' else int(shape.area*floors/40),occupied=10 if use=='residential' else 0,positions=0,employees=0,status='active',age=24,vacantMonths=0,cost=1000000,**building_style(p,use,floors))
            c.s['parcels'].append(p)
            if use=='residential':
                for h in range(10):c.s['households'].append(dict(id=f'h-scale-{index}-{h}',home=p['id'],size=2+h%2,income=7000,car=h%2==0,job=None,stress=0,burden=.1,commute=None,commuteFailed=False))
    for line in range(20):
        row=line*5;ids=[]
        for i in range(6):
            sid=f's-scale-{line}-{i}';ids.append(sid)
            c.s['stops'].append(dict(id=sid,name=f'压力线{line+1}站{i+1}',point=[550+i*1100,500+row*60],mode='bus',enabled=True,role='passenger'))
        c.s['lines'].append(dict(id=f'l-scale-{line}',name=f'压力线 {line+1}',mode='bus',stops=ids,headway=8,capacity=70,hours=16,enabled=True,mixed=False,startHour=6,dwell=.6,speed=35,oneway=False,boardings=0,load=0,color='#387e8c'))
    c.rebuild()
    # A prepared rendering/load fixture: no monthly demand has yet been assigned.
    c.s['stats'].update(population=100000,households=40000,housing=40000,buildings=10000,laborForce=40000,unemployment=100,vacancy=0,
        roadKm=sum(r['length'] for r in c.s['roads'])/1000,landValue=200,rent=10,floorArea=sum(p['building']['floorArea'] for p in c.s['parcels']),developedArea=16000000)
    c.s['scenarioNote']='人工构造的容量/渲染压力样本；非自然生长城市，尚未进行月度就业与出行分配。'
    return c

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);parser.add_argument('--month',action='store_true');parser.add_argument('--timeout',type=int,default=120);args=parser.parse_args()
    root=Path(args.output);root.parent.mkdir(parents=True,exist_ok=True)
    if args.month:
        with gzip.open(root.with_suffix('.json.gz'),'rt') as f:c=City.restore(json.load(f))
        start=time.perf_counter();c.step();elapsed=time.perf_counter()-start
        root.with_suffix('.month.json').write_text(json.dumps(dict(monthSeconds=elapsed,peakMemoryMiB=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024**2,stats=c.s['stats'])))
    else:
        started=time.perf_counter();c=fixture();prepare=time.perf_counter()-started
        started=time.perf_counter();data=gzip.compress(json.dumps(c.snapshot(),ensure_ascii=False,separators=(',',':')).encode());save=time.perf_counter()-started
        root.with_suffix('.json.gz').write_bytes(data)
        report=dict(model=MODEL_VERSION,machine=platform.machine(),os=platform.platform(),buildings=10000,population=100000,households=40000,edges=len(c.network['edges']),roads=len(c.s['roads']),lines=len(c.s['lines']),periods=3,precision='实际家庭；两轮代表日分配',prepareSeconds=round(prepare,2),saveSeconds=round(save,2),compressedBytes=len(data),status='prepared')
        root.with_suffix('.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False),flush=True)
