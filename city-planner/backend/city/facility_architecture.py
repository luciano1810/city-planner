"""Deterministic polygon architecture, fitted to the reserved street-block land.

All geometry is local metres. Courtyards remain holes; roofs carry explicit
triangles so both renderers agree on concave boundaries and setbacks.
"""
import hashlib
import math
import random
from shapely import affinity, constrained_delaunay_triangles
from shapely.geometry import Point, Polygon, LineString, box
from shapely.ops import triangulate, unary_union

STYLES = ('perimeter', 'courtyard', 'L', 'U', 'T', 'H', 'parallel', 'pavilions', 'terraced', 'round', 'fan', 'zigzag')
UTILITY = {'power_plant','substation','water_plant','sewage_plant','recycling_center','logistics_hub','industrial_plant'}

def parts(g):
    if g.is_empty:return []
    if g.geom_type == 'Polygon':return [g]
    return [p for q in getattr(g,'geoms',[]) for p in parts(q)]

def coords(r):return [[round(x,5),round(y,5)] for x,y in r.coords]

def surface(g):
    return [coords(t.exterior)[:3] for t in constrained_delaunay_triangles(g).geoms]

def local_site(f):
    origin=f.get('origin',f['point'])
    return affinity.rotate(affinity.translate(Polygon(f['points']),-origin[0],-origin[1]),-f.get('rotation',0),origin=(0,0))

def generate(f):
    site=local_site(f); k=f['kind']
    identity=(f['id'],k,f['points'])
    if 'architectureSeed' in f:identity+=(f['architectureSeed'],)
    seed=int(hashlib.sha256(str(identity).encode()).hexdigest()[:14],16)
    rng=random.Random(seed)
    inset=site.buffer(-max(2.0,min(4.5,math.sqrt(site.area)*.035)),join_style=2)
    options=parts(inset)
    if not options:return None
    core=max(options,key=lambda p:p.area)
    x0,y0,x1,y1=core.bounds; w=x1-x0; d=y1-y0; cx=(x0+x1)/2;cy=(y0+y1)/2
    if min(w,d)<9:return None
    def rect(a,b,c,e):return box(x0+a*w,y0+b*d,x0+c*w,y0+e*d)
    allowed=STYLES
    if k in UTILITY:allowed=('parallel','L','terraced','zigzag','pavilions','T')
    if k in ('gas_station','charging_station'):allowed=('L','parallel','fan','zigzag','pavilions')
    if k in ('sports_arena','theater','museum'):allowed=('round','fan','zigzag','terraced','courtyard','pavilions')
    style=f.get('architectureStyle') if f.get('architectureStyle') in allowed else rng.choice(allowed)
    wing=rng.uniform(.19,.29)
    void=None
    if style in ('perimeter','courtyard'):
        thickness=min(w,d)*wing
        void=core.buffer(-thickness,join_style=2)
        footprint=core.difference(void)
        if style=='perimeter':footprint=footprint.difference(rect(.40,0,.60,.40))
    elif style=='L':footprint=unary_union([rect(0,0,wing,1),rect(0,1-wing,1,1)])
    elif style=='U':footprint=unary_union([rect(0,0,wing,1),rect(1-wing,0,1,1),rect(0,1-wing,1,1)])
    elif style=='T':footprint=unary_union([rect(.5-wing/2,0,.5+wing/2,1),rect(0,1-wing,1,1)])
    elif style=='H':footprint=unary_union([rect(0,0,wing,1),rect(1-wing,0,1,1),rect(0,.45,1,.45+wing)])
    elif style=='parallel':
        n=rng.choice((2,3,4));footprint=unary_union([rect(i/n+.025,.10,(i+1)/n-.045,.95) for i in range(n)])
    elif style=='pavilions':
        n=rng.choice((2,3));footprint=unary_union([rect(i/n+.04,j/2+.045,(i+1)/n-.05,(j+1)/2-.05) for i in range(n) for j in range(2)])
    elif style=='round':
        ellipse=affinity.scale(Point(cx,cy).buffer(1,quad_segs=12),w*.48,d*.48,origin=(cx,cy))
        footprint=ellipse
        if k=='museum':footprint=ellipse.difference(affinity.scale(ellipse,.48,.48,origin=(cx,cy)))
    elif style=='fan':
        wings=[]
        for angle in (-32,0,32):wings.append(affinity.rotate(rect(.36,.12,.64,.94),angle,origin=(cx,y0+d*.78)))
        footprint=unary_union(wings)
    elif style=='zigzag':
        line=LineString([(x0+w*.13,y0+d*.12),(x0+w*.75,y0+d*.35),(x0+w*.25,y0+d*.65),(x0+w*.85,y0+d*.88)])
        footprint=line.buffer(min(w,d)*.13,cap_style=2,join_style=2)
    else:footprint=core
    if k in UTILITY or k in ('gas_station','charging_station'):
        footprint=footprint.intersection(rect(0,.65,1,1))
    footprint=footprint.intersection(core).buffer(0)
    pieces=[p for p in parts(footprint) if p.area>35 and min(p.bounds[2]-p.bounds[0],p.bounds[3]-p.bounds[1])>4]
    if not pieces:pieces=[core]
    masses=[]
    base_height=f.get('height',20)
    for i,p in enumerate(pieces):
        height=max(4,round(base_height*rng.uniform(.65,1.1)/3.4)*3.4)
        roof='flat'
        if k in ('theater','sports_arena'):roof='dome' if style=='round' else 'vault'
        elif k in ('convention_center','industrial_plant','logistics_hub'):roof='sawtooth'
        masses.append(dict(rings=[coords(p.exterior)]+[coords(r) for r in p.interiors],triangles=surface(p),base=0,height=height,roof=roof,tone=i%3,center=list(p.representative_point().coords)[0]))
        if style=='terraced':
            for level in range(1,rng.choice((3,4,5))):
                shrunk=p.buffer(-min(w,d)*.075*level,join_style=2)
                for q in parts(shrunk):
                    if q.area<30:continue
                    masses.append(dict(rings=[coords(q.exterior)]+[coords(r) for r in q.interiors],triangles=surface(q),base=height+(level-1)*3.4,height=3.4,roof='flat',tone=level%3,center=list(q.representative_point().coords)[0]))
    occupied=unary_union(pieces);free=core.difference(occupied.buffer(2.0))
    features=[]
    # Process equipment occupies actual free land; it is never stretched into roads.
    feature_type={'water_plant':'water_tank','sewage_plant':'settling_tank','power_plant':'cooling_tower','substation':'transformer','gas_station':'fuel_canopy','charging_station':'solar_canopy','recycling_center':'recycling_bay','industrial_plant':'silo','logistics_hub':'container'}.get(k)
    if feature_type:
        count=0; radius=min(w,d)*(.105 if k=='power_plant' else .085)
        for iy in range(2):
            for ix in range(3):
                pt=Point(x0+w*(.18+ix*.32),y0+d*(.18+iy*.28))
                if free.covers(pt.buffer(radius+1)):
                    features.append(dict(kind=feature_type,x=pt.x,y=pt.y,radius=radius,height=base_height*rng.uniform(.7,1.05),seed=seed%10000+count));count+=1
    amenity={'hospital':'ambulance','fire_station':'fire_truck','police_station':'patrol_car','hotel':'pool','university':'sports_court','city_hall':'fountain','museum':'sculpture','cinema':'billboard','theater':'sculpture','sports_arena':'sculpture','convention_center':'billboard'}.get(k)
    if amenity:
        r=5 if amenity in ('pool','sports_court') else 3.4
        for iy in range(4):
            for ix in range(4):
                pt=Point(x0+w*(.12+ix*.25),y0+d*(.12+iy*.25))
                if free.covers(pt.buffer(r+1)) and not features:
                    features.append(dict(kind=amenity,x=pt.x,y=pt.y,radius=r,height=3,seed=seed%10000))
    trees=[]
    for i in range(24):
        pt=Point(rng.uniform(x0,x1),rng.uniform(y0,y1));r=1.3
        if free.covers(pt.buffer(r+1)) and all(pt.distance(Point(t['x'],t['y']))>5 for t in trees) and all(pt.distance(Point(e['x'],e['y']))>e['radius']+r+1 for e in features):trees.append(dict(x=pt.x,y=pt.y,radius=r,height=rng.uniform(3.5,5.5),variant=rng.choice((8,9,10,18))))
    roof_layout(f,masses,seed)
    return dict(version=1,seed=seed%2147483647,style=style,site=[coords(site.exterior)]+[coords(r) for r in site.interiors],ground=surface(site),masses=masses,features=features,trees=trees,coverage=round(occupied.area/site.area,3),floorArea=round(sum(Polygon(m['rings'][0],m['rings'][1:]).area*max(1,int(m['height']/3.4)) for m in masses)))


def ensure(f):
    f['architecture']=generate(f)


def roof_layout(f, masses, seed):
    """Lay out supported, non-overlapping roof programs on exposed roof polygons."""
    rng=random.Random(seed ^ 0x524f4f46)
    kind=f['kind'];helipad=False
    programs={
        'hospital':['plantroom','chiller','chiller','duct','skylight','solar'],
        'university':['skylight','solar','solar','garden','plantroom'],
        'hotel':['garden','pergola','terrace','garden','plantroom'],
        'city_hall':['skylight','terrace','garden','plantroom'],
        'fire_station':['solar','plantroom','duct','skylight'],
        'police_station':['solar','plantroom','skylight','terrace'],
        'museum':['skylight','skylight','garden','pergola'],
        'cinema':['chiller','plantroom','duct','solar'],
        'gas_station':['solar','plantroom','skylight'],
        'charging_station':['solar','solar','garden'],
        'substation':['plantroom','duct','solar'],
        'water_plant':['solar','chiller','duct'],
        'sewage_plant':['duct','chiller','solar'],
        'power_plant':['plantroom','duct','chiller'],
        'recycling_center':['solar','duct','skylight'],
    }
    footprints=[Polygon(m['rings'][0],m['rings'][1:]) for m in masses]
    main=max(range(len(masses)),key=lambda i:masses[i]['base']+masses[i]['height'])
    for i,m in enumerate(masses):
        p=footprints[i];top=m['base']+m['height']
        upper=unary_union([q for j,q in enumerate(footprints) if j!=i and masses[j]['base']>=top-.01])
        available=p.difference(upper.buffer(.6)).buffer(-.85,join_style=2)
        if kind in ('university','city_hall','museum') and m['roof']=='flat' and not p.interiors and m['base']==0 and ((kind=='university' and i==0) or rng.random()<.45):m['roof']='hip'
        x0,y0,x1,y1=p.bounds;w=x1-x0;d=y1-y0
        finish='roofTiles' if m['roof']=='hip' else 'metal' if m['roof']!='flat' else rng.choice(('roof','gravel','roof','metal'))
        plan=dict(version=1,finish=finish,variant=rng.randrange(4),uvAngle=rng.choice((0,math.pi/2,math.pi)),uvScale=rng.uniform(5.5,10),uvOffset=[rng.uniform(0,20),rng.uniform(0,20)],zones=[],units=[],marker=None)
        if available.is_empty:m['roofPlan']=plan;continue
        if kind=='hospital' and i==main:
            for pt in [Point(m['center'])]+[t.centroid for t in triangulate(available) if available.covers(t)]:
                if available.covers(pt.buffer(3)):
                    plan['marker']=[pt.x,pt.y];available=available.difference(pt.buffer(4));break
        if m['roof']=='flat' and kind=='hospital' and not helipad:
            for pt in [available.representative_point()]+[t.centroid for t in triangulate(available) if available.covers(t)]:
                if available.covers(box(pt.x-7.4,pt.y-7.4,pt.x+7.4,pt.y+7.4)):
                    plan['units'].append(dict(type='helipad',x=pt.x,y=pt.y,w=14,d=14));available=available.difference(box(pt.x-8,pt.y-8,pt.x+8,pt.y+8));helipad=True;break
        # Large coherent material panels, not a noisy color on every triangle.
        horizontal=rng.choice((True,False));count=rng.choice((2,3,4));start=y0 if horizontal else x0;span=d if horizontal else w
        for n in range(count):
            zone=box(x0,start+span*n/count,x1,start+span*(n+1)/count) if horizontal else box(start+span*n/count,y0,start+span*(n+1)/count,y1)
            zone=zone.intersection(p).difference(upper)
            if zone.area>4:plan['zones'].append(dict(triangles=surface(zone),finish=finish if n%2==0 else 'metal' if finish=='roof' else finish,tone=n%3))
        if m['roof']=='flat':
            step=rng.uniform(7.2,9.5);slots=[]
            yy=y0+step*.6
            while yy<y1-step*.35:
                xx=x0+step*.6
                while xx<x1-step*.35:
                    slots.append((xx,yy));xx+=step
                yy+=step
            rng.shuffle(slots)
            for x,y in slots:
                if len(plan['units'])>=min(28,max(3,int(p.area/85))):break
                ww=rng.uniform(4.2,6.2);dd=rng.uniform(3.8,5.7)
                rect=box(x-ww/2,y-dd/2,x+ww/2,y+dd/2)
                if not available.covers(rect.buffer(.55,join_style=2)):continue
                typ=rng.choice(programs.get(kind,['solar','skylight','plantroom','duct']))
                plan['units'].append(dict(type=typ,x=x,y=y,w=ww,d=dd))
                available=available.difference(rect.buffer(.9,join_style=2))
            # Narrow wings need compact modules rather than an empty roof.
            if len(plan['units'])<3:
                for attempt in range(8):
                    inner=available.buffer(-1.35,join_style=2)
                    if inner.is_empty:break
                    candidates=[q.representative_point() for q in sorted(parts(inner),key=lambda q:q.area,reverse=True)]
                    placed=False
                    for pt in candidates:
                        for ww,dd in ((2.6,3.0),(3.0,2.6)):
                            rect=box(pt.x-ww/2,pt.y-dd/2,pt.x+ww/2,pt.y+dd/2)
                            if not available.covers(rect.buffer(.2,join_style=2)):continue
                            typ=(['garden','pergola','terrace'] if kind in ('hotel','museum','city_hall') else ['solar','skylight','plantroom'])[attempt%3]
                            plan['units'].append(dict(type=typ,x=pt.x,y=pt.y,w=ww,d=dd));available=available.difference(rect.buffer(.55,join_style=2));placed=True;break
                        if placed:break
                    if not placed:break
        else:
            # Glazing is mounted on the actual curved or pitched surface.
            for y in [y0+d*t for t in (.18,.34,.5,.66,.82)]:
                for x in [x0+w*t for t in (.18,.34,.5,.66,.82)]:
                    ww=min(5,w*.13);dd=min(9,d*.22)
                    rect=box(x-ww/2,y-dd/2,x+ww/2,y+dd/2)
                    if available.covers(rect.buffer(.3)):
                        plan['units'].append(dict(type='rooflight',x=x,y=y,w=ww,d=dd))
                        available=available.difference(rect.buffer(.4))
            if not plan['units']:
                for part in parts(available.buffer(-.8)):
                    pt=part.representative_point()
                    for ww,dd in ((1.4,3.0),(3.0,1.4)):
                        if available.covers(box(pt.x-ww/2,pt.y-dd/2,pt.x+ww/2,pt.y+dd/2)):
                            plan['units'].append(dict(type='rooflight',x=pt.x,y=pt.y,w=ww,d=dd));break
        m['roofPlan']=plan
