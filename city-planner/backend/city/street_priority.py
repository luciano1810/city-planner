"""Compare local street proposals using unmet demand and engineering cost.

This is an explicit development-benefit estimate, not a cash-flow forecast.
Existing parcels provide access/catchment evidence for the proposed street.
"""
import math

from shapely.geometry import Point, Polygon
from shapely.strtree import STRtree

from .business import BusinessMarket
from .housing import HousingMarket
from .parameters import ROAD_TYPES, USES


class StreetPriorities:
    def __init__(self, city):
        self.city=city
        self.housing=HousingMarket(city)
        self.business=BusinessMarket(city)
        self.parcels=[p for p in city.s['parcels'] if p.get('connected') and p['use']!='protected']
        self.tree=STRtree([Point(p['center']) for p in self.parcels])
        self.cache={}

    def nearby(self, line, block=None, origin=None, heading=None):
        indices=sorted(map(int,self.tree.query(line.buffer(120),predicate='intersects')))
        parcels=[self.parcels[i] for i in indices]
        if block is not None:
            region=Polygon(block)
            parcels=[p for p in parcels if region.covers(Point(p['center']))]
        if origin is not None:
            # Opposite arms may serve different neighbourhoods. Do not let
            # demand behind the parent road choose the other side's branch.
            dx,dy=math.cos(heading),math.sin(heading)
            parcels=[p for p in parcels if (p['center'][0]-origin.x)*dx+(p['center'][1]-origin.y)*dy>=-5]
        return parcels

    def evaluate(self, line, parcels):
        if not parcels or line.length<20:return None
        key=tuple(sorted(p['id'] for p in parcels))
        if key not in self.cache:
            # Catchment unions count a household / external demand pool once,
            # regardless of the number of frontage parcels or buildings.
            homes=self.housing.demand_for(parcels)
            business={u:self.business.demand_for(parcels,u) for u in self.business.needs}
            needed=any(self.housing.needed(p) or any(self.business.needed(p,u) for u in business) for p in parcels)
            demand=homes*self.city.s['policy']['householdSpace']+sum(business[u]*USES[u]['space'] for u in business)
            self.cache[key]=(demand if needed else 0,homes,business)
        demand,homes,business=self.cache[key]
        if demand<=0:return None
        weights=[math.exp(-line.distance(Point(p['center']))/120) for p in parcels]
        value=sum(max(0,p.get('landValue',80))*w for p,w in zip(parcels,weights))/sum(weights)
        # Ready serviced land is a reason to infill before paying for roads.
        empty=sum(p.get('buildableArea',p['area'])*w for p,w in zip(parcels,weights)
                  if not p.get('building') and not p.get('openSpace') and not p.get('renewalProject') and not p.get('blockCommon'))
        scarcity=demand/(demand+empty)
        try:cost=line.length*ROAD_TYPES['lane']['cost']*self.city.terrain.profile(line,'lane',0)['costFactor']
        except ValueError:return None
        # Two ~30 m frontage strips at an indicative FAR of 1. Cap the benefit
        # so a tiny connector cannot claim all of a large district's demand.
        served=min(demand,line.length*60)
        score=served*scarcity*(1+math.log1p(value/80))/max(1,cost)
        return dict(score=score,demandFloorArea=demand,housingGap=homes,businessGaps=business,
                    landValue=value,availableLand=empty,scarcity=scarcity,estimatedCost=cost)
