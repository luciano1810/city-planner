"""Measure actual monthly simulation and persistence; never implies UI FPS."""
import argparse,gzip,json,platform,resource,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from city.engine import City,MODEL_VERSION
parser=argparse.ArgumentParser();parser.add_argument('--snapshot',required=True);parser.add_argument('--months',type=int,default=3);parser.add_argument('--output',required=True)
a=parser.parse_args()
with gzip.open(a.snapshot,'rt') as f: snapshot=json.load(f)
t=time.perf_counter();city=City.restore(snapshot);restore=time.perf_counter()-t
samples=[]
for _ in range(a.months):
 t=time.perf_counter();city.step();samples.append(round(time.perf_counter()-t,4))
t=time.perf_counter();payload=gzip.compress(json.dumps(city.snapshot(),ensure_ascii=False).encode());save=time.perf_counter()-t
report=dict(model=MODEL_VERSION,machine=platform.machine(),os=platform.platform(),python=platform.python_version(),month=city.s['month'],terrainKm=[city.terrain.width/1000,city.terrain.height/1000],buildings=city.s['stats']['buildings'],parcels=len(city.s['parcels']),roads=len(city.s['roads']),edges=len(city.network['edges']),population=city.s['stats']['population'],households=len(city.s['households']),lines=len(city.s['lines']),trafficPeriods=3,trafficIterations=city.s['policy']['trafficIterations'],restoreSeconds=round(restore,4),monthSeconds=samples,saveEncodeSeconds=round(save,4),compressedBytes=len(payload),peakMemoryMiB=round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/(1024**2 if sys.platform=='darwin' else 1024),1),limits='当前快照的单进程实测；界面 FPS/P95 另见同目录 UI 报告，不外推其他规模')
Path(a.output).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False))
