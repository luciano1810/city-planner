"""Natural small-block example: roads only, no manually placed buildings."""
import argparse,gzip,json,sys,time
from collections import Counter
from pathlib import Path
from shapely.geometry import Polygon,LineString
from shapely.ops import unary_union
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from city.engine import City,MODEL_VERSION
from city.scenario import valley_world,build_small_blocks
from grow_valley import morphology


def shared_access(state):
    parcels={p['id']:p for p in state['parcels']}
    paths=[p for p in state['localPaths'] if p.get('block')]
    buildings=[p for p in state['parcels'] if p.get('block') and p.get('building') and any(q.get('block')==p.get('block') and q.get('blockCommon') and q.get('openSpace') for q in state['parcels'])]
    obstacles=unary_union([Polygon(p['building']['footprint']).buffer(-.05) for p in state['parcels'] if p.get('building')])
    errors=[Polygon(l['points']).symmetric_difference(unary_union([Polygon(parcels[pid]['points']) for pid in l['parcels']])).area for l in state['blockLayouts']]
    return dict(paths=len(paths),inwardDoors=sum(p['kind']=='neighbourhood' for p in paths),
        buildingSitesWithoutInwardDoor=sum(not any(q['kind']=='neighbourhood' and q['parcel']==p['id'] for q in paths) for p in buildings),
        buildingCrossings=sum(LineString(p['points']).intersects(obstacles) for p in paths),maximumUnallocatedArea=round(max(errors,default=0),6))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--regular',action='store_true');args=parser.parse_args()
    city=build_small_blocks(City(valley_world(),'街区自然生长案例'),irregular=not args.regular)
    start=time.perf_counter();history=[]
    for month in range(48):
        city.step();history.append(dict(month=city.s['month'],population=city.s['stats']['population'],buildings=city.s['stats']['buildings']))
        if (month+1)%12==0:print(json.dumps(history[-1]),flush=True)
    root=Path(__file__).resolve().parents[2]/'docs'/'experiments'/('blocks-v8-regular' if args.regular else 'blocks-v8-final')
    with gzip.open(root.with_suffix('.json.gz'),'wt') as f:json.dump(city.snapshot(),f,ensure_ascii=False,separators=(',',':'))
    summary=[]
    for layout in city.s['blockLayouts']:
        ps=[city.parcelmap[pid] for pid in layout['parcels']]
        summary.append(dict(id=layout['id'],kind=layout['kind'],area=layout['area'],buildingSites=layout['buildingSites'],
            buildings=sum(bool(p.get('building')) for p in ps),sharedSpace=any(p.get('blockCommon') and p.get('openSpace') for p in ps),
            publicSpaces=[f['kind'] for f in city.s['facilities'] if f.get('parcel') in layout['parcels']]))
    report=dict(model=MODEL_VERSION,months=city.s['month'],elapsedSeconds=round(time.perf_counter()-start,2),settings=city.s['settings'],policy=city.s['policy'],
        stats=city.s['stats'],morphology=morphology(city),sharedAccess=shared_access(city.s),layouts=summary,history=history,
        layoutDiversity=dict(kinds=dict(Counter(l['kind'] for l in summary)),siteCounts=sorted(set(l['buildingSites'] for l in summary)),
            withoutCommon=sum(l['commonArea']==0 for l in city.s['blockLayouts'])),irregular=not args.regular)
    halls=[p for p in city.s['parcels'] if not p.get('block') and p.get('building') and p['building']['use'] in ('industrial','warehouse')]
    shapes=[Polygon(p['building']['footprint']) for p in halls]
    report['industrialHalls']=dict(count=len(halls),rectangular=sum(len(s.exterior.coords)==5 and abs(s.minimum_rotated_rectangle.area-s.area)<.001 for s in shapes),
        outsideSetback=sum(not Polygon(p['points']).buffer(-1.99).covers(s) for p,s in zip(halls,shapes)),
        footprintRatioRange=[round(f([s.area/Polygon(p['points']).area for p,s in zip(halls,shapes)],default=0),3) for f in (min,max)])
    root.with_suffix('.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(dict(morphology=report['morphology'],layouts=summary),ensure_ascii=False),flush=True)
