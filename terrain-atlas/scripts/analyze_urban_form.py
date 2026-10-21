"""Measure built form from saved authoritative geometry, without advancing time."""
import argparse,gzip,json,math,statistics
from collections import Counter
from pathlib import Path
from shapely.geometry import Point,Polygon

def analyze(snapshot):
    s=snapshot['state'];built=[p for p in s['parcels'] if p.get('building')]
    uses={u:[p for p in built if p['building']['use']==u] for u in ('residential','commercial','office','industrial','warehouse')}
    tall=[p for p in uses['office'] if p['building']['floors']>=10]
    clusters=[];visited=set()
    for p in tall:
        if p['id'] in visited:continue
        queue=[p];component=[]
        while queue:
            q=queue.pop()
            if q['id'] in visited:continue
            visited.add(q['id']);component.append(q)
            queue.extend(r for r in tall if r['id'] not in visited and math.dist(q['center'],r['center'])<=180)
        clusters.append(component)
    affinity={}
    for use,sites in uses.items():
        nearest=[];same=0
        for p in sites:
            others=[q for q in built if q['id']!=p['id']]
            if not others:continue
            q=min(others,key=lambda q:math.dist(q['center'],p['center']))
            same+=q['building']['use']==use
            peers=[q for q in sites if q['id']!=p['id']]
            if peers:nearest.append(min(math.dist(q['center'],p['center']) for q in peers))
        shapes=[Polygon(p['building']['footprint']) for p in sites]
        affinity[use]=dict(buildings=len(sites),sameUseNearestShare=round(same/max(1,len(sites)),3),meanSameUseNearestMeters=round(sum(nearest)/max(1,len(nearest)),1),floors=dict(Counter(p['building']['floors'] for p in sites)),
            medianPlotCoverage=round(statistics.median((shape.area/p['area'] for p,shape in zip(sites,shapes))),3) if sites else None,
            medianDistanceToRoadCenter=round(statistics.median((shape.distance(Point(p['frontage'])) for p,shape in zip(sites,shapes))),1) if sites else None,
            medianBuildingGap=round(statistics.median((min(shape.distance(q) for j,q in enumerate(shapes) if i!=j) for i,shape in enumerate(shapes))),1) if len(sites)>1 else None)
    services={}
    for kind in ('park','plaza','school','clinic'):
        points=[f['point'] for f in s['facilities'] if f['kind']==kind]
        services[kind]=dict(count=len(points),minimumSeparation=min((math.dist(a,b) for i,a in enumerate(points) for b in points[i+1:]),default=None))
    return dict(model=snapshot['model'],month=s['month'],population=s['stats']['population'],parcels=len(s['parcels']),builtParcels=len(built),generatedRoads=sum(bool(r.get('generated')) for r in s['roads']),uses=affinity,tallOffices=len(tall),largestTallOfficeCluster=max(map(len,clusters),default=0),
        tallOfficeClusters=[dict(buildings=len(g),floors=sorted(p['building']['floors'] for p in g),center=[sum(p['center'][i] for p in g)/len(g) for i in (0,1)]) for g in sorted(clusters,key=lambda g:-len(g))],facilities=services,
        centers=s.get('growthCenters',[]),districts=[{k:d[k] for k in ('kind','buildings','jobs','population','floorRatio')} for d in s['districts']])

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--snapshot',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    with gzip.open(a.snapshot,'rt') as f:report=analyze(json.load(f))
    Path(a.output).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False))
