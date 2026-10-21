"""A deterministic small dry terrace, reserved before water generation."""
import math
import numpy as np
from shapely.geometry import LineString, Point


def reserve_startup_land(h, sea, cfg):
    rows, cols=h.shape
    width,height=cfg['widthKm']*1000,cfg['heightKm']*1000
    dx,dy=width/(cols-1),height/(rows-1)
    side=min(600.,min(width,height)*.4)
    # Keep gradient samples and road-side lots well inside the level core.
    core=side/math.sqrt(2)+3*max(dx,dy)
    outer=core+max(side*.4,2*max(dx,dy))
    margin=outer+max(dx,dy)
    best=None
    for cy in np.linspace(margin,height-margin,11):
        for cx in np.linspace(margin,width-margin,11):
            ix,iy=round(cx/dx),round(cy/dy)
            rx,ry=math.ceil(core/dx),math.ceil(core/dy)
            patch=h[max(0,iy-ry):min(rows,iy+ry+1),max(0,ix-rx):min(cols,ix+rx+1)]
            # Prefer existing dry, gentle ground; high-sea maps get a small island.
            score=float(np.mean(patch<=sea))*10000+float(np.std(patch))+abs(float(np.median(patch))-sea-150)*.05
            if best is None or score<best[0]:best=(score,cx,cy)
    _,cx,cy=best
    x0,x1=max(0,math.floor((cx-outer)/dx)),min(cols,math.ceil((cx+outer)/dx)+1)
    y0,y1=max(0,math.floor((cy-outer)/dy)),min(rows,math.ceil((cy+outer)/dy)+1)
    yy,xx=np.mgrid[y0:y1,x0:x1]
    distance=np.hypot(xx*dx-cx,yy*dy-cy)
    patch=h[y0:y1,x0:x1]
    level=max(sea+30,float(np.median(patch[distance<=core])))
    t=np.clip((distance-core)/(outer-core),0,1)
    blend=1-t*t*(3-2*t)
    patch[:]=patch*(1-blend)+level*blend
    return dict(center=[cx,cy],sizeMeters=side,elevationMeters=level,
                radius=outer,coreRadius=core,bounds=(y0,y1,x0,x1),
                mask=distance<outer,surface=patch.copy())


def restore_startup_land(h,water,site):
    y0,y1,x0,x1=site['bounds'];mask=site['mask']
    h[y0:y1,x0:x1][mask]=site['surface'][mask]
    water[y0:y1,x0:x1][mask]=-np.inf


def outside_startup(channels,site,cfg,cols):
    """Reserve the terrace and transition from channel beds and bank carving."""
    width,height=cfg['widthKm']*1000,cfg['heightKm']*1000
    center=Point(site['center']);cell=width/cols
    return [c for c in channels if LineString([(x*width,y*height) for x,y in c['points']]).distance(center)
            >site['radius']+(max(c.get('widths',[1]))*5+3)*cell]
