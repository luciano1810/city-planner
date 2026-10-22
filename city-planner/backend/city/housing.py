"""Job-linked housing demand and joint home/job allocation.

Demand belongs to an employment destination and a household transport/income
profile, not to a citywide vacancy balance. Shared housing and job capacities
are consumed once, including overlapping catchments and committed projects.
"""
import math
from collections import Counter, defaultdict

from .routing import shortest_paths
from .employment import workplaces

INCOMES = (3500, 5000, 7000, 10000, 16000)


def profiles(count):
    """Deterministic legacy/forecast cohorts, without advancing simulation RNG."""
    rows = []
    for income in INCOMES:
        car_share = min(.9, income / 14000)
        for car, share in ((False, 1-car_share), (True, car_share)):
            exact = count * share / len(INCOMES)
            rows.append(dict(income=income, car=car, count=int(exact), fraction=exact % 1))
    for row in sorted(rows, key=lambda r: (-r['fraction'], r['income'], r['car']))[:count-sum(r['count'] for r in rows)]:
        row['count'] += 1
    return [dict(income=r['income'], car=r['car'], count=r['count']) for r in rows if r['count']]


def ensure_queue(city):
    # The scalar remains the public total for old saves and API consumers.
    queue = city.s.setdefault('migrationQueue', [])
    if sum(r['count'] for r in queue) != city.s['pendingHousing']:
        queue = city.s['migrationQueue'] = profiles(city.s['pendingHousing'])
    return queue


def vacancies(city):
    employed = Counter(h.get('job') for h in city.s['households'])
    return {p['id']: max(0, p['building'].get('positions', 0)-employed[p['id']])
            for p in workplaces(city)}


def migration_rate(city, openings=None):
    settings, policy = city.s['settings'], city.s['policy']
    if settings['growth'] <= 0 or settings['migration'] <= 0:
        return 0
    openings = sum(vacancies(city).values()) if openings is None else openings
    return int(min(policy['migrationMonthlyMaximum'],
                   (settings['migration'] + openings * policy['migrationVacancyResponse']) * settings['growth']))


class Commutes:
    """Reverse network searches shared by every housing candidate.

    The public graph has two layers so a long all-walking path cannot masquerade
    as transit. The destination must have been reached using at least one ride.
    """
    def __init__(self, city):
        self.city = city
        self.graphs = city.graphs
        self.public_is_walk = city.graphs['public'] == city.graphs['walk']
        self.reverse = {mode: defaultdict(list) for mode in ('walk', 'car', 'public')}
        self.cache = {}
        self.origins = {}
        self.economic_weights = {}
        for mode in ('walk', 'car'):
            for source, edges in city.graphs[mode].items():
                for edge in edges:
                    self.reverse[mode][edge['to']].append(dict(to=source, time=edge['time']))
        for source, edges in (() if self.public_is_walk else city.graphs['public'].items()):
            for edge in edges:
                for layer in (0, 1):
                    target_layer = 1 if edge['kind'] == 'ride' else layer
                    self.reverse['public'][(edge['to'], target_layer)].append(
                        dict(to=(source, layer), time=edge['time']))

    def minutes(self, home, job, car, bounded_walk=True):
        if not bounded_walk:
            # Economic catchments compare every candidate with relatively few
            # occupied origins. Forward fields avoid three searches per lot.
            if home not in self.origins:
                self.origins[home]={mode:shortest_paths(self.graphs[mode],home)[0]
                                   for mode in (('walk','car') if self.public_is_walk else ('walk','car','public'))}
                if self.public_is_walk:self.origins[home]['public']=self.origins[home]['walk']
            fields=self.origins[home]
            return min(fields['walk'].get(job,math.inf),fields['public'].get(job,math.inf),
                       fields['car'].get(job,math.inf)+self.city.s['policy']['parkingMinutes'] if car else math.inf)
        if job not in self.cache:
            self.cache[job] = {mode: shortest_paths(graph, (job, 1) if mode == 'public' else job)[0]
                               for mode, graph in self.reverse.items() if mode!='public' or not self.public_is_walk}
            if self.public_is_walk:self.cache[job]['public']={}
        fields = self.cache[job]
        walk = fields['walk'].get(home, math.inf)
        if bounded_walk and walk > self.city.s['policy']['walkMaximumMinutes']:
            walk = math.inf
        transit = fields['public'].get((home, 0), math.inf)
        drive = fields['car'].get(home, math.inf) + self.city.s['policy']['parkingMinutes'] if car else math.inf
        return min(walk, transit, drive)


def commutes(city):
    cached = getattr(city, '_housing_commutes', None)
    signature = (id(city.graphs), city.s['policy']['walkMaximumMinutes'], city.s['policy']['parkingMinutes'])
    if cached is None or cached[0] != signature:
        cached = city._housing_commutes = (signature, Commutes(city))
    return cached[1]


def affordable(city, rent, income, share=.45):
    return rent * city.s['policy']['householdSpace'] < income * share


def projected_rent(parcel):
    return 10 * (1 + parcel.get('centrality', 0)*.35 + parcel.get('cluster', 0)*.35)


class HomeJobMatcher:
    def __init__(self, city):
        from .renewal import displacing
        self.city = city
        self.travel = commutes(city)
        occupied = Counter(h['home'] for h in city.s['households'])
        self.homes = {p['id']: p for p in city.s['parcels'] if p.get('connected') and p.get('building')
                      and p['building']['use'] == 'residential' and p['building']['status'] in ('active', 'vacant')
                      and not displacing(city, p)}
        self.free = {pid: max(0, p['building']['capacity']-occupied[pid]) for pid, p in self.homes.items()}
        self.jobs = vacancies(city)
        self.choices = {}

    def choose(self, income, car, exclude=None, job=None):
        key = (income, car, job)
        if key not in self.choices:
            options = []
            for pid, p in self.homes.items():
                if not affordable(self.city, p['rent'], income):
                    continue
                for jid in ([job] if job else self.jobs):
                    minutes = self.travel.minutes(pid, jid, car)
                    if minutes <= min(self.city.s['policy']['housingCommuteMinutes'], self.city.s['policy']['workMaximumMinutes']):
                        score = minutes + p['rent']*self.city.s['policy']['householdSpace']/income*15 - p.get('amenity', 0)*2
                        options.append((score, pid, jid))
            self.choices[key] = sorted(options)
        return next(((self.homes[pid], jid) for _, pid, jid in self.choices[key]
                     if pid != exclude and self.free[pid] > 0 and (job is not None or self.jobs[jid] > 0)), None)

    def take(self, home, job, previous=None, already_employed=False):
        self.free[home['id']] -= 1
        if previous in self.free:
            self.free[previous] += 1
        if not already_employed:
            self.jobs[job] -= 1
        home['building'].update(status='active', vacantMonths=0)


def future_homes(city, exclude_project=None):
    """Net unused supply; replacements reserve space for displaced residents."""
    occupied = Counter(h['home'] for h in city.s['households'])
    replaced, rows = set(), []
    for project in city.s.get('renewals', []):
        if project['status'] in ('complete', 'cancelled') or project['options']['mode'] == 'renovate' or project['id'] == exclude_project:
            continue
        for phase in project['phases']:
            if phase['status'] not in ('planned', 'waiting', 'demolition'):
                continue
            replaced.update(phase['sourceIds'])
            retained = sum(occupied[pid] for pid in phase['sourceIds'])
            for site in phase['sites']:
                b = site.get('targetBuilding')
                if not b or b['use'] != 'residential':
                    continue
                access = min((city.parcelmap[pid] for pid in phase['sourceIds']),
                             key=lambda p: math.dist(p['center'], site['center']))
                units = max(0, b['capacity']-retained)
                retained = max(0, retained-b['capacity'])
                rows.append(dict(access=access['id'], units=units, rent=projected_rent(access), future=True))
    for p in city.s['parcels']:
        b = p.get('building')
        if p['id'] in replaced or not p.get('connected') or not b or b['use'] != 'residential':
            continue
        rows.append(dict(access=p['id'], units=max(0, b['capacity']-occupied[p['id']]), rent=p['rent'],
                         future=b['status'] in ('planned','construction')))
        if b.get('extensionReady'):
            rows.append(dict(access=p['id'], units=int(b['footprintArea']*b.get('extensionFloors', 1)/city.s['policy']['householdSpace']),
                             rent=p['rent'], future=True))
    return rows


class HousingMarket:
    def __init__(self, city, exclude_project=None):
        self.city, self.travel = city, commutes(city)
        self.limit = min(city.s['policy']['housingCommuteMinutes'], city.s['policy']['workMaximumMinutes'])
        self.needs = []
        jobs = vacancies(city)
        # Committed employment supports nearby housing, but does not admit
        # households or create workers until those workplaces actually open.
        from .business import BusinessMarket, workplace_supply
        future = sorted((p for p in city.s['parcels'] if p.get('connected') and p.get('building')
                         and p['building']['use'] != 'residential' and p['building']['status'] in ('planned','construction')), key=lambda p: p['id'])
        if future:
            supply=workplace_supply(city,planned=False)
            supply.extend(dict(parcel=p,use=p['building']['use'],capacity=p['building']['capacity'],future=True) for p in future)
            projected=BusinessMarket(city,kind='jobs',supply=supply).positions()
            for p in future:jobs[p['id']]=projected.get(p['id'],0)
        # A zero-vacancy workplace can never receive an allocation in this
        # market. Exclude it before building home/job combinations.
        jobs={jid:count for jid,count in jobs.items() if count>0}
        original_jobs = sum(jobs.values())
        residents = Counter((h['income'], h['car'], h['home']) for h in city.s['households'] if not h.get('job'))
        groups = [dict(income=income, car=car, home=home, count=count, resident=True)
                  for (income, car, home), count in sorted(residents.items())]
        queue = ensure_queue(city)
        groups += [dict(r, resident=False) for r in queue]
        forecast = max(0, migration_rate(city)*city.s['policy']['housingLookaheadMonths']-city.s['pendingHousing'])
        groups += [dict(r, resident=False, forecast=True) for r in profiles(forecast)]
        allocated_migrants = 0
        self.covered = self.committed = 0
        supply = future_homes(city, exclude_project)
        # Prefer a feasible home/job pair before creating unmet demand. A
        # profile must not be tied arbitrarily to a job in the wrong district.
        profile_options = {}
        car_options = {}
        for group in groups:
            left = group['count']
            home = city.parcelmap.get(group.get('home'))
            own_jobs = [jid for jid in jobs if home and affordable(city, home['rent'], group['income'])
                        and self.travel.minutes(home['id'], jid, group['car']) <= self.limit]
            profile = (group['income'], group['car'])
            if profile not in profile_options:
                car=group['car']
                if car not in car_options:
                    choices=[]
                    for jid in jobs:
                        for j,row in enumerate(supply):
                            minutes=self.travel.minutes(row['access'],jid,car)
                            if minutes<=self.limit:choices.append((row['future'],minutes,jid,j))
                    car_options[car]=sorted(choices)
                # Income changes affordability, not the network travel time
                # or ordering. Filter the shared order instead of re-routing.
                profile_options[profile]=[option for option in car_options[car]
                    if affordable(city,supply[option[3]]['rent'],group['income'])]
            allocations = [(jid, None) for jid in sorted(own_jobs)] + [(jid, j) for _, _, jid, j in profile_options[profile]]
            allocations += [(jid, -1) for jid in sorted(jobs)]
            for jid, index in allocations:
                available = left if index is None or index == -1 else supply[index]['units']
                take = min(left, jobs[jid], available)
                if not take:
                    continue
                jobs[jid] -= take; left -= take
                if not group['resident'] and not group.get('forecast'):
                    allocated_migrants += take
                if index is not None:
                    covered = index != -1
                    self.needs.append(dict(group, job=jid, count=0 if covered else take, initial=take))
                    if covered:
                        supply[index]['units'] -= take
                        if supply[index]['future']: self.committed += take
                        else: self.covered += take
                if not left:
                    break
        self.waiting_jobs = max(0, city.s['pendingHousing']-allocated_migrants)
        self.employment_opportunities = original_jobs
        self.total = sum(n['initial'] for n in self.needs)

    def eligible(self, p, n, rent=None):
        return (p.get('connected') and affordable(self.city, projected_rent(p) if rent is None else rent, n['income'])
                and self.travel.minutes(p['id'], n['job'], n['car']) <= self.limit)

    def gap(self, p):
        return sum(n['count'] for n in self.needs if n['count'] and self.eligible(p, n))

    def demand_for(self, parcels):
        """Union of catchments, never the sum of overlapping parcel gaps."""
        return sum(n['count'] for n in self.needs if n['count'] and any(self.eligible(p, n) for p in parcels))

    def pressure(self, p):
        return sum(n['count'] * math.exp(-self.travel.minutes(p['id'], n['job'], n['car'])/15)
                   for n in self.needs if n['count'] and self.eligible(p, n)) / max(1, self.total)

    def needed(self, p):
        gap = self.gap(p)
        total = sum(n['initial'] for n in self.needs if self.eligible(p, n))
        policy = self.city.s['policy']
        return gap >= policy['minimumProjectUnits'] or gap / max(1, total) >= policy['minimumDevelopmentDemand']

    def reserve(self, p, units, rent=None):
        before = units
        for n in sorted(self.needs, key=lambda n: (self.travel.minutes(p['id'], n['job'], n['car']), n['income'])):
            if self.eligible(p, n, rent):
                take = min(units, n['count']); n['count'] -= take; units -= take
            if units <= 0: break
        self.committed += before-units
        return before-units

    def summary(self):
        regions = {}
        destinations = {p['id']: p['center'] for p in self.city.s['parcels']}
        destinations.update({f['id']: f['point'] for f in self.city.s['facilities']})
        for n in self.needs:
            row = regions.setdefault(n['job'], dict(job=n['job'], point=destinations[n['job']], demand=0, shortage=0))
            row['demand'] += n['initial']; row['shortage'] += n['count']
        return dict(scope='就业地点与实际通勤范围；跨区供应只分配一次', commuteMinutes=self.limit,
                    waitingForJobs=self.waiting_jobs, linkedDemand=self.total, availableCoverage=self.covered,
                    committedCoverage=self.committed, shortage=sum(n['count'] for n in self.needs), regions=list(regions.values()))
