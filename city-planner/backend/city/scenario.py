"""Reproducible river-valley scenario. All buildings and residents are simulated."""
import base64
import math
import numpy as np
from height_format import HEIGHT_ENCODING, encode_heights


def valley_world():
    n=240; extent=6000
    y,x=np.mgrid[0:n,0:n]/(n-1)*extent
    river=3120+95*np.sin(y/610)
    height=32+9*np.sin(x/1700)+7*np.cos(y/1350)
    height+=240*np.exp(-((x-650)/650)**2-((y-1050)/900)**2)
    height+=170*np.exp(-((x-4900)/650)**2-((y-1500)/1000)**2)
    wet=np.abs(x-river)<36
    height[wet]=-3
    encode=lambda a:base64.b64encode(a.tobytes()).decode()
    elevation=encode_heights(height)
    water=encode_heights(np.where(wet,0,-np.inf), water=True)
    points=[[float((3120+95*math.sin(v/610))/extent),float(v/extent)] for v in np.linspace(0,extent,100)]
    return dict(width=n,height=n,heightEncoding=HEIGHT_ENCODING,config=dict(seed='RIVER-VALLEY-2026',widthKm=6,heightKm=6,preset='hills',sea=20,detail=240),
        grid=dict(widthMeters=extent,heightMeters=extent,seaLevelMeters=0,verticalDatum='local',elevationUnit='m',pixelSizeMeters=[25,25]),
        elevation=elevation,water=water,moisture=encode(np.full((n,n),150,dtype='u1')),
        waterBodies=dict(ocean=encode(np.packbits(wet)),lakes=encode(np.zeros(n*n//8,dtype='u1'))),
        channels=[dict(points=points,widths=[2.8]*len(points),kind='river')],
        stats=dict(maxElevation=float(height.max()),landPercent=float((~wet).mean()*100),generationMs=0,riverCount=1,lakeCount=0))


def build_small_blocks(city,irregular=False):
    """Only roads and regional demand; all buildings and shared spaces grow."""
    if city.s['roads']:raise ValueError('街区案例需要空白城市')
    xs=[2000,2060,2130,2230,2370,2530];ys=[2200,2260,2340,2450,2580]
    if irregular:
        nodes=[[[x+18*math.sin((y-2200)/95+i*.65),y+13*math.sin((x-2000)/115+j*.45)] for j,y in enumerate(ys)] for i,x in enumerate(xs)]
        for i,row in enumerate(nodes):city.add_road(dict(kind='street',level=0,points=row,shape='curve',name=f'弯曲纵街{i+1}'))
        for j in range(len(ys)):city.add_road(dict(kind='street',level=0,points=[row[j] for row in nodes],shape='curve',name=f'弯曲横街{j+1}'))
    else:
        for x in xs:city.add_road(dict(kind='street',level=0,points=[[x,ys[0]],[x,ys[-1]]],name='街区纵街'))
        for y in ys:city.add_road(dict(kind='street',level=0,points=[[xs[0],y],[xs[-1],y]],name='街区横街'))
    city.s['settings'].update(migration=65,externalJobs=500,growth=1.5,maxProjects=18)
    city.rebuild(regenerate=True)
    city.event('规划','20 个不同面积的小街区已接入；建筑、公园、广场与内部步行空间由模拟形成')
    city.summarize()
    return city


def build_valley(city):
    if city.s['roads']: raise ValueError('复杂案例需要空白城市')
    # Two banks, a connected main-street core and less regular hill-side roads.
    routes=[('avenue',0,[[1250,2100],[2850,2100]]),('avenue',0,[[1250,2750],[2870,2750]]),
        ('street',0,[[1250,3400],[2820,3400]]),('street',0,[[1250,2100],[1250,3400]]),
        ('avenue',0,[[2050,1750],[2050,3650]]),('street',0,[[2720,1950],[2800,2650],[2740,3450]]),
        ('street',0,[[1250,2100],[1450,1660],[1850,1450],[2350,1600],[2720,1950]]),
        ('avenue',0,[[3400,2100],[4350,2100]]),('street',0,[[3390,2750],[4350,2750]]),
        ('street',0,[[3380,3400],[4280,3400]]),('street',0,[[3400,2100],[3390,2750],[3380,3400]]),
        ('street',0,[[3900,2100],[3900,3400]]),('street',0,[[4350,2100],[4400,2700],[4280,3400]]),
        ('avenue',1,[[2850,2100],[3400,2100]]),('avenue',1,[[2870,2750],[3390,2750]]),
        ('street',1,[[2820,3400],[3380,3400]]),
        ('highway',1,[[800,3700],[2050,3650],[3000,3900],[4450,3700]]),
        ('street',0,[[1250,3400],[1200,3700],[2050,3650]]),
        ('street',0,[[4280,3400],[4450,3700]]),
        ('train',1,[[800,3780],[2050,3570],[3000,3820],[4450,3780],[5400,3900]]),
        ('metro',-1,[[1250,2750],[2050,2750],[2780,2750],[3390,2750],[4350,2750]]),
        ('tram',0,[[2046,1750],[2046,2100],[2046,2750],[2046,3400]])]
    for kind,level,points in routes:
        city.add_road(dict(kind=kind,level=level,points=points,shape='curve' if len(points)>2 else 'polyline',name=f'河谷{len(city.s["roads"])+1}号路'))
    city.rebuild(regenerate=True)
    city.s['gateway']=[1200,3700]
    services=[('bus',[[1250,2100],[2050,2100],[2800,2100],[3400,2100],[4350,2100]],8,'滨河巴士'),
        ('bus',[[1250,3400],[2050,3400],[2740,3400],[3380,3400],[4280,3400]],10,'南岸巴士'),
        ('metro',[[1250,2750],[2050,2750],[2780,2750],[3390,2750],[4350,2750]],6,'东西地铁'),
        ('tram',[[2046,1750],[2046,2100],[2046,2750],[2046,3400]],7,'中央电车'),
        ('train',[[800,3780],[2050,3570],[4450,3780],[5400,3900]],25,'河谷区域铁路')]
    for mode,points,headway,name in services:
        ids=[]
        for i,point in enumerate(points):
            sid=city.uid('s');ids.append(sid)
            city.s['stops'].append(dict(id=sid,mode=mode,point=point,name=name[:2]+str(i+1)+'站',enabled=True,role='passenger',external=mode=='train' and i==len(points)-1,constructionCost=25000 if mode=='bus' else 500000))
            city.spend(city.s['stops'][-1]['constructionCost'],'车站建设')
        city.rebuild()
        city.add_line(dict(mode=mode,stops=ids,headway=headway,name=name))
    if 'regionalServices' in city.s:
        ids=[]
        for i,point in enumerate([[2050,3570],[5400,3900]]):
            sid=city.uid('s');ids.append(sid)
            city.s['stops'].append(dict(id=sid,mode='train',point=point,name='中央货场' if i==0 else '区域货运门户',enabled=True,role='freight',external=i==1,constructionCost=500000))
            city.spend(500000,'车站建设')
        city.s['regionalServices'].append(dict(id=city.uid('freight'),name='河谷对外货运',start=ids[0],end=ids[1],enabled=True,trainsPerDay=4,tonnesPerTrain=500))
    city.s['settings'].update(migration=110,externalJobs=900,growth=1.6,maxProjects=18)
    city.rebuild()
    city.summarize()
    return city
