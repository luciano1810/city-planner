"""Editable architectural district for inspecting the rendering at street scale."""
import base64
import math
import numpy as np
from shapely.geometry import Point, Polygon, LineString, box
from shapely.ops import unary_union
from shapely import affinity
from height_format import HEIGHT_ENCODING, encode_heights
from .engine import City
from .construction import day
from .urban import building_style

LAYOUT_VERSION = 2
SITES = [(466,518,28,25,4,'office'),(464,559,24,22,3,'office'),
    (390,566,27,24,3,'commercial'),(375,527,26,24,3,'office'),
    (544,513,32,26,4,'office'),(587,518,31,28,3,'commercial'),
    (623,548,28,23,4,'office'),(617,512,25,24,3,'office'),
    (550,654,31,29,4,'office'),(643,625,16,16,3,'commercial'),
    (543,706,31,25,4,'office'),(593,704,34,26,3,'office'),
    (447,654,30,30,4,'office'),(396,654,29,25,3,'commercial'),
    (448,707,34,27,3,'office'),(393,708,28,24,3,'office')]


def street_front(line, center):
    distance=line.project(Point(center))
    front=line.interpolate(distance)
    a,b=line.interpolate(max(0,distance-1)),line.interpolate(min(line.length,distance+1))
    return [front.x,front.y],math.degrees(math.atan2(b.y-a.y,b.x-a.x))


def upgrade_visual_layout(city):
    """Repair only original axis-aligned showcase buildings in old saves.

    Preserve edited geometry, parcel boundaries, capacity and simulation state.
    Recheck reservations because users may have edited this district since then.
    """
    s=city.s
    if city.terrain.data['config']['seed']!='SHANHAI-ARCHITECTURAL-DISTRICT' or s.get('visualLayoutVersion',0)>=LAYOUT_VERSION:return
    roads={r['id']:LineString(r['points']) for r in s['roads'] if r['level']==0}
    from .geometry import ROAD_TYPES
    road_area=unary_union([roads[r['id']].buffer(ROAD_TYPES[r['kind']]['width']/2+2) for r in s['roads'] if r['id'] in roads])
    facilities=[Polygon(f['points']) for f in s['facilities'] if f.get('points')]
    original={(x,y):box(x-w/2,y-d/2,x+w/2,y+d/2) for x,y,w,d,_,_ in SITES}
    for p in s['parcels']:
        b=p.get('building');line=roads.get(p.get('road'))
        if not b or line is None:continue
        center=tuple(b.get('center',p['center']));expected=original.get(center)
        if expected is None or p.get('streetAngle',0)!=0:continue
        old=Polygon(b['footprint'])
        if not old.equals(expected):continue
        front,angle=street_front(line,center)
        footprint=affinity.rotate(old,angle,origin=center)
        if not Polygon(p['points']).buffer(1e-6).covers(footprint) or footprint.intersection(road_area).area>1e-6:continue
        obstacles=facilities+[Polygon(q['building']['footprint']) for q in s['parcels'] if q is not p and q.get('building')]
        if any(footprint.intersection(q).area>1e-6 for q in obstacles):continue
        p.update(frontage=front,streetAngle=angle)
        b['footprint']=[list(q) for q in footprint.exterior.coords]
    s['visualLayoutVersion']=LAYOUT_VERSION


def visual_world():
    n=128;extent=1000
    encode=lambda a:base64.b64encode(a.tobytes()).decode()
    return dict(width=n,height=n,heightEncoding=HEIGHT_ENCODING,
        config=dict(seed='SHANHAI-ARCHITECTURAL-DISTRICT',widthKm=1,heightKm=1,preset='hills',sea=0,detail=n),
        grid=dict(widthMeters=extent,heightMeters=extent,seaLevelMeters=0,verticalDatum='local',elevationUnit='m',pixelSizeMeters=[extent/n,extent/n]),
        elevation=encode_heights(np.full((n,n),18,dtype='float32')),
        water=encode_heights(np.full((n,n),-np.inf,dtype='float32'),water=True),
        moisture=encode(np.full((n,n),115,dtype='u1')),
        waterBodies=dict(ocean=encode(np.zeros(n*n//8,dtype='u1')),lakes=encode(np.zeros(n*n//8,dtype='u1'))),
        channels=[],stats=dict(maxElevation=18,landPercent=100,generationMs=0,riverCount=0,lakeCount=0))


def build_visual_case():
    city=City(visual_world(),'林荫大道 · 实景街区')
    city.s['settings'].update(autoGrow=False,autoRenew=False,migration=0)
    city.add_road(dict(kind='avenue',level=0,points=[[500,330],[500,850]],name='中央林荫大道'))
    city.add_road(dict(kind='avenue',level=0,points=[[265,636],[365,618],[445,604],[500,600],[770,600]],shape='curve',name='东西景观大道'))
    main=LineString(city.s['roads'][1]['points']);join=main.interpolate(main.project(Point(451,603)))
    city.add_road(dict(kind='avenue',level=0,points=[[310,415],[361,449],[405,510],[join.x,join.y]],shape='curve',name='西北景观路'))
    city.add_road(dict(kind='avenue',level=0,points=[[580,600],[602,631],[636,655],[710,664]],shape='curve',name='东南景观路'))
    # Peripheral streets remain outside the focal junction and provide frontage.
    city.add_road(dict(kind='street',level=0,points=[[365,735],[660,735]],name='南街'))
    city.add_road(dict(kind='street',level=0,points=[[665,430],[665,735]],name='东街'))
    roads={r['id']:LineString(r['points']) for r in city.s['roads']}
    road_area=unary_union([line.buffer(12 if city.s['roads'][i]['kind']=='avenue' else 7) for i,line in enumerate(roads.values())])
    for i,(x,y,w,d,floors,use) in enumerate(SITES):
        road=min(roads,key=lambda rid:roads[rid].distance(Point(x,y)))
        front,angle=street_front(roads[road],[x,y])
        footprint=affinity.rotate(box(x-w/2,y-d/2,x+w/2,y+d/2),angle,origin=(x,y))
        if footprint.intersection(road_area).area>.1:raise ValueError(f'visual building {i} crosses a road')
        lot=box(x-w/2-10,y-d/2-16,x+w/2+10,y+d/2+16).difference(road_area.buffer(2.2))
        if lot.geom_type=='MultiPolygon':lot=next(g for g in lot.geoms if g.covers(footprint))
        if not lot.covers(footprint):raise ValueError(f'visual building {i} exceeds its lot')
        p=dict(id=city.uid('p'),road=road,points=[list(q) for q in lot.exterior.coords],center=[x,y],area=round(lot.area,2),buildableArea=round(lot.area,2),
            frontage=front,use='auto',age=0,landValue=185,rent=22,history=[],streetAngle=angle,source='frontage',connected=True,
            terrain=city.terrain.features(lot),amenity=1,accessJobs=0,pollution=0,centrality=.5,urbanity=.8)
        style=building_style(p,use,floors)
        area=footprint.area*floors;cap=int(area/25)
        p['building']=dict(id=city.uid('b'),use=use,floors=floors,floorArea=area,footprintArea=footprint.area,footprint=[list(q) for q in footprint.exterior.coords],
            center=[x,y],capacity=cap,status='active',ready=0,age=12,lastAgeDay=int(day(city)),occupied=0,positions=cap,employees=0,cost=int(area*2400),vacantMonths=0,
            usableArea=area*.85,useAreas={use:area},businessActive=True,**style)
        p['building']['height']=floors*3.3;p['building']['roof']=i%4
        city.s['parcels'].append(p)
    # Plaza and planted spaces are real facility polygons in the editable city.
    spaces=[('plaza',[(520,544),(574,544),(574,584),(520,584)],'喷泉广场'),
        ('park',[(520,618),(534,618),(534,674),(520,674)],'东南街角花园'),
        ('park',[(538,616),(570,616),(580,633),(568,637),(562,629),(538,629)],'东南景观花园'),
        ('park',[(466,620),(480,620),(480,684),(466,684)],'西南街角花园'),
        ('park',[(377,625),(422,625),(422,634),(377,634)],'街边绿地'),
        ('park',[(578,543),(587,543),(587,585),(578,585)],'停车场绿带')]
    footprints=unary_union([Polygon(p['building']['footprint']) for p in city.s['parcels']])
    for kind,ps,name in spaces:
        shape=Polygon(ps).difference(road_area.buffer(2)).difference(footprints.buffer(1))
        if shape.geom_type=='MultiPolygon':shape=max(shape.geoms,key=lambda p:p.area)
        c=shape.centroid
        city.s['facilities'].append(dict(id=city.uid('f'),kind=kind,name=name,point=[c.x,c.y],points=[list(q) for q in shape.exterior.coords],
            capacity=int(shape.area*.2),cost=int(shape.area*20),maintenance=100,created=0,connected=True,visits=0,generated=False))
    parking=box(588,563,614,585)
    city.s['facilities'].append(dict(id=city.uid('f'),kind='parking_lot',name='广场公共停车场',generated=True,
        points=[list(q) for q in parking.exterior.coords],point=[601,574],origin=[601,574],rotation=0,width=26,depth=22,
        floors=1,height=0,parkingSpaces=18,capacity=0,created=0,cost=62920,maintenance=126))
    city.s['visualLayoutVersion']=LAYOUT_VERSION
    city.s['sceneTimeSeconds']=10*3600
    city.rebuild(regenerate=False);city.summarize()
    from .signals import LiveTraffic
    city.live_traffic=LiveTraffic(city,'test')
    for _ in range(6):city.live_traffic.advance(10)
    city.event('规划','曲线主干道、建筑庭院和街角绿地已就绪')
    return city
