"""A reproducible long-run experiment, with no hand-placed/zoned buildings."""
import argparse,gzip,json,os,platform,resource,sys,time
from collections import Counter
from pathlib import Path
sys.path.insert(0,os.environ.get('CITY_BACKEND',str(Path(__file__).resolve().parents[1]/'backend')))
from city.engine import City,MODEL_VERSION
from city.scenario import valley_world,build_valley

def morphology(city):
    import math
    from shapely.geometry import Polygon,Point,LineString
    from shapely.strtree import STRtree
    built=[p for p in city.s['parcels'] if p.get('building')]
    shapes=[Polygon(p['building']['footprint']) for p in built]
    tree=STRtree(shapes)
    overlaps=sum(shapes[i].intersection(shapes[int(j)]).area>1 for i,s in enumerate(shapes) for j in tree.query(s) if int(j)>i)
    cfg=city.view()['meta']['roadTypes']
    roadshapes=[LineString(r['points']).buffer(cfg[r['kind']]['width']/2) for r in city.s['roads'] if r['level']==0]
    rt=STRtree(roadshapes)
    encroach=sum(any(s.intersection(roadshapes[int(j)]).area>1 for j in rt.query(s)) for s in shapes)
    road_nodes=Counter()
    for e in city.network['edges']:
        if e['kind'] in ('street','avenue','lane'):
            road_nodes[e['a']]+=1;road_nodes[e['b']]+=1
    intersections=sum(v>=3 for v in road_nodes.values());dead=sum(v==1 for v in road_nodes.values())
    nearest=[]
    for i,p in enumerate(built):
        if len(built)>1:nearest.append(min(math.dist(p['center'],q['center']) for j,q in enumerate(built) if i!=j))
    return dict(buildings=len(built),uses=dict(Counter(p['building']['use'] for p in built)),
        floors=dict(Counter(p['building']['floors'] for p in built)),forms=dict(Counter(p['building'].get('form') for p in built)),
        footprintRange=[min((s.area for s in shapes),default=0),max((s.area for s in shapes),default=0)],
        overlapPairs=overlaps,roadEncroachments=encroach,waterEncroachments=sum(not city.terrain.buildable(s) for s in shapes),
        disconnectedBuildings=sum(not p['connected'] for p in built),intersections=intersections,deadEnds=dead,
        deadEndShare=round(dead/max(1,intersections+dead),3),meanNearestBuilding=round(sum(nearest)/max(1,len(nearest)),1),
        closedBlocks=len(city.network['blocks']),districts=[dict(kind=d['kind'],buildings=d['buildings'],jobs=d['jobs']) for d in city.s['districts']],
        validLines=sum(l['valid'] for l in city.s['lines']),transitModes=sorted(set(l['mode'] for l in city.s['lines'] if l['valid'])))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--months',type=int,default=96);parser.add_argument('--output',required=True);parser.add_argument('--resume');args=parser.parse_args()
    if args.resume:
        with gzip.open(args.resume,'rt') as f:city=City.restore(json.load(f))
    else:city=build_valley(City(valley_world(),'双岸河谷复杂测试城市'))
    start=time.perf_counter();samples=[];history=[]
    root=Path(args.output);root.parent.mkdir(parents=True,exist_ok=True)
    def save():
        with gzip.open(root.with_suffix('.json.gz'),'wt') as f:json.dump(city.snapshot(),f,ensure_ascii=False,separators=(',',':'))
    save()
    for index in range(args.months):
        tick=time.perf_counter();city.step();elapsed=time.perf_counter()-tick;samples.append(round(elapsed,3))
        history.append(dict(month=city.s['month'],seconds=round(elapsed,3),**{k:city.s['stats'][k] for k in ('population','buildings','jobs','employed','boardings','landValue','vacancy')}))
        if (index+1)%12==0:
            save();print(json.dumps(history[-1],ensure_ascii=False),flush=True)
    save();report=dict(model=MODEL_VERSION,seed=city.terrain.data['config']['seed'],settings=city.s['settings'],policy=city.s['policy'],months=city.s['month'],
        machine=platform.machine(),os=platform.platform(),elapsedSeconds=round(time.perf_counter()-start,2),monthSeconds=samples,
        peakMemoryMiB=round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/(1024**2 if sys.platform=='darwin' else 1024),1),
        morphology=morphology(city),stats=city.s['stats'],history=history)
    root.with_suffix('.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report['morphology'],ensure_ascii=False),flush=True)
