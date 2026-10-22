"""Spatial demand shared by development, employment and firm revenue.

Local demand belongs to a household origin. A distant supplier can cover only
the travel-discounted part of that demand, even if it has unlimited floor area.
External demand is a single citywide pool, never one pool per growth center.
"""
import math
from collections import Counter

from .housing import commutes
from .parameters import USES


def demand_parts(city, kind='space'):
    p=city.s['policy'];external=city.s['settings']['externalJobs']
    if kind=='jobs':
        local={u:p['job'+u.title()+'Population'] for u in USES if u!='residential'}
        regional=dict(commercial=p['commercialBaseDemand']*p['jobCommercialPopulation']/max(.001,p['commercialPopulationDemand']),
                      **{u:external*p['job'+u.title()+'External'] for u in ('office','industrial','warehouse')})
    else:
        local={u:p[u+'PopulationDemand'] for u in USES if u!='residential'}
        regional={u:external*p.get(u+'ExternalDemand',0)+p.get(u+'BaseDemand',0) for u in local}
    return local,regional


def workplace_supply(city, planned=True, exclude_project=None, exclude_parcels=(), reopening=False):
    """Each delivered, extended or replacement unit is represented once."""
    rows=[];replaced=set(exclude_parcels)
    if planned:
        for project in city.s.get('renewals',[]):
            if project['status'] in ('complete','cancelled') or project['options']['mode']=='renovate' or project['id']==exclude_project:continue
            for phase in project['phases']:
                if phase['status'] not in ('planned','waiting','demolition'):continue
                replaced.update(phase['sourceIds'])
                sources=[city.parcelmap[pid] for pid in phase['sourceIds'] if pid in city.parcelmap]
                for site in phase['sites']:
                    b=site.get('targetBuilding')
                    if not b or b['use']=='residential' or not sources:continue
                    p=min(sources,key=lambda p:(math.dist(p['center'],site['center']),p['id']))
                    if p.get('connected'):rows.append(dict(parcel=p,use=b['use'],capacity=b['capacity'],future=True))
    for p in city.s['parcels']:
        b=p.get('building')
        if p['id'] in replaced or not p.get('connected') or not b or b['use']=='residential':continue
        active=b['status']=='active' and (b.get('businessActive',True) or reopening and b.get('firmCooldown',0)<=city.s['month'])
        if planned or active:
            rows.append(dict(parcel=p,use=b['use'],capacity=b['capacity'],future=b['status'] in ('planned','construction')))
        if planned and b.get('extensionReady'):
            rows.append(dict(parcel=p,use=b['use'],capacity=int(b['footprintArea']*b.get('extensionFloors',1)/USES[b['use']]['space']),future=True))
    return rows


class BusinessMarket:
    def __init__(self, city, *, kind='space', supply=None, exclude_project=None, exclude_parcels=()):
        self.city=city;self.travel=commutes(city);self.kind=kind
        scale=max(.001,city.s['policy']['economicCatchmentMinutes'])
        # These weights depend only on the graph, transport profile and policy,
        # not on this market's population, supply or remaining demand.
        self.weights=self.travel.economic_weights.setdefault(scale,{})
        self.gaps={};self.local_demand={}
        local,self.regional=demand_parts(city,kind)
        self.regional=dict(self.regional);self.initial_regional=dict(self.regional)
        population=Counter()
        for h in city.s['households']:population[(h['home'],h['car'])]+=h['size']
        self.population=[dict(home=home,car=car,count=count) for (home,car),count in sorted(population.items())]
        self.needs={u:[dict(home=home,car=car,initial=count*rate,covered=0.)
                       for (home,car),count in sorted(population.items())] for u,rate in local.items()}
        self.totals={u:self.regional[u]+sum(n['initial'] for n in rows) for u,rows in self.needs.items()}
        self.allocations={u:Counter() for u in local};self.local_allocations={u:Counter() for u in local}
        self.external_allocations={u:Counter() for u in local}
        rows=workplace_supply(city,exclude_project=exclude_project,exclude_parcels=exclude_parcels) if supply is None else supply
        self.rows=list(rows)
        self.allocate_supply()

    def allocate_supply(self):
        if self.kind=='space':
            # Construction status does not discount committed supply or change
            # its catchment. Delivery must not reorder the development budget.
            self.allocate(self.rows)
        else:
            # Forecasts cannot evict jobs at already delivered workplaces.
            for future in (False,True):self.allocate([r for r in self.rows if bool(r.get('future'))==future])

    def weight(self, p, n):
        key=(n['home'],n['car'],p['id'])
        if key not in self.weights:
            minutes=self.travel.minutes(n['home'],p['id'],n['car'],bounded_walk=False)
            scale=max(.001,self.city.s['policy']['economicCatchmentMinutes'])
            self.weights[key]=math.exp(-.5*(minutes/scale)**2)
        return self.weights[key]

    def allocate(self, rows):
        self.gaps.clear()
        free=[max(0,r['capacity']) for r in rows]
        for use,needs in self.needs.items():
            indices=[i for i,r in enumerate(rows) if r['use']==use]
            for n in needs:
                choices=sorted(indices,key=lambda i:(-self.weight(rows[i]['parcel'],n),rows[i]['parcel']['id'],i))
                for i in choices:
                    p=rows[i]['parcel']
                    take=min(free[i],max(0,n['initial']*self.weight(p,n)-n['covered']))
                    free[i]-=take;n['covered']+=take
                    self.local_allocations[use][p['id']]+=take;self.allocations[use][p['id']]+=take
            # Capacity-weighted competition for the one external pool. Local
            # accessibility matters, but neither rank nor a center label does.
            remaining=[i for i in indices if free[i]>1e-9]
            while remaining and self.regional[use]>1e-9:
                weights={i:free[i]*(1+sum(n['initial']*self.weight(rows[i]['parcel'],n) for n in needs)/max(1,self.totals[use])) for i in remaining}
                total=sum(weights.values());budget=self.regional[use]
                for i in remaining:
                    take=min(free[i],budget*weights[i]/total);p=rows[i]['parcel']
                    free[i]-=take;self.regional[use]-=take
                    self.external_allocations[use][p['id']]+=take;self.allocations[use][p['id']]+=take
                remaining=[i for i in remaining if free[i]>1e-9]

    def gap(self, p, use):
        if not p.get('connected'):return 0.
        key=(p['id'],use)
        if key not in self.gaps:
            self.gaps[key]=self.regional[use]+sum(max(0,n['initial']*self.weight(p,n)-n['covered']) for n in self.needs[use])
        return self.gaps[key]

    def accessible_population(self, p):
        return sum(n['count']*self.weight(p,n) for n in self.population)

    def demand_for(self, parcels, use):
        parcels=[p for p in parcels if p.get('connected')]
        if not parcels:return 0.
        return self.regional[use]+sum(max(0,n['initial']*max(self.weight(p,n) for p in parcels)-n['covered']) for n in self.needs[use])

    def shortage(self, use):
        return self.regional[use]+sum(n['initial']-n['covered'] for n in self.needs[use])

    def needed(self, p, use):
        gap=self.gap(p,use);policy=self.city.s['policy']
        if gap>=policy['minimumProjectUnits']:return True
        key=(p['id'],use)
        if key not in self.local_demand:
            self.local_demand[key]=self.initial_regional[use]+sum(n['initial']*self.weight(p,n) for n in self.needs[use])
        return gap/max(1,self.local_demand[key])>=policy['minimumDevelopmentDemand']

    def pressure(self, p, use):
        return self.gap(p,use)/max(1,self.totals[use])

    def reserve(self, p, use, capacity):
        self.rows.append(dict(parcel=p,use=use,capacity=capacity,future=True))
        self.regional=dict(self.initial_regional)
        for u,needs in self.needs.items():
            for n in needs:n['covered']=0.
            self.allocations[u].clear();self.local_allocations[u].clear();self.external_allocations[u].clear()
        self.allocate_supply()

    def positions(self):
        """Integer posts with conserved sector totals; no minimum per building."""
        result={}
        for allocation in self.allocations.values():
            counts={pid:int(value+1e-9) for pid,value in allocation.items()}
            remainder=max(0,int(sum(allocation.values())+1e-9)-sum(counts.values()))
            for pid in sorted(counts,key=lambda pid:(-(allocation[pid]-counts[pid]),pid))[:remainder]:counts[pid]+=1
            for pid,count in counts.items():result[pid]=result.get(pid,0)+count
        return result
