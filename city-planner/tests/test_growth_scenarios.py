"""End-to-end acceptance scenarios for transit and demand-led street growth."""
import copy
import math
import unittest
from shapely.geometry import LineString, Polygon

from tests.test_city import City, flat_world, road
from tests.test_city_v3 import complete
from city.geometry import building_footprint, branch_anchors, stable_id, ROAD_TYPES
from city.housing import HousingMarket
from city.urban import grow_lanes


def family(city, home, job=None):
    return dict(id=city.uid('h'),home=home,job=job,size=3,income=7000,car=False,
                stress=0,unemployedMonths=0,burden=.1,commute=None,commuteFailed=False)


def separated_towns():
    city=City(flat_world())
    city.s['settings'].update(autoGrow=False,autoRenew=False,migration=0,externalJobs=250,maxProjects=4)
    jobs_road=road(city,[[300,1200],[900,1200]])
    homes_road=road(city,[[3000,1200],[3700,1200]])
    # Regional road provides a real bus connection, but no pedestrian shortcut.
    road(city,[[900,1200],[3000,1200]],kind='highway')
    work=min((p for p in city.s['parcels'] if p['road']==jobs_road),key=lambda p:math.dist(p['center'],[650,1200]))
    home=min((p for p in city.s['parcels'] if p['road']==homes_road),key=lambda p:math.dist(p['center'],[3250,1200]))
    for p in city.s['parcels']:p['use']='office' if p['road']==jobs_road else 'residential'
    complete(city,work,'office',120);complete(city,home,'residential',40)
    home['rent']=2
    city.s['households']=[family(city,home['id']) for _ in range(20)]
    city.s['pendingHousing']=30
    city.s['migrationQueue']=[dict(income=7000,car=False,count=30)]
    for x in (650,3250):city.command(dict(type='stop',point=[x,1200],mode='bus'))
    city.command(dict(type='line',name='两城联络线',stops=[s['id'] for s in city.s['stops']],mode='bus',headway=6,capacity=80))
    city.command(dict(type='line_update',id=city.s['lines'][0]['id'],enabled=False))
    city.rebuild();city.match_jobs()
    return city,dict(work=work['id'],home=home['id'],jobsRoad=jobs_road,homesRoad=homes_road,line=city.s['lines'][0]['id'])


def full_frontage():
    city=City(flat_world())
    city.s['settings'].update(autoGrow=True,autoRenew=False,migration=0,externalJobs=1000,maxProjects=4)
    parent=road(city,[[900,1800],[1600,1800]])
    for p in city.s['parcels']:
        if building_footprint(p,'office') is not None:complete(city,p,'office',40)
    city.s['pendingHousing']=60
    city.s['migrationQueue']=[dict(income=7000,car=False,count=60)]
    # Beyond the initial-road grace period; growth must earn its own eligibility.
    city.s['month']=12
    city.rebuild();city.match_jobs()
    return city,parent


def metrics(city, ids=None):
    buildings=[p for p in city.s['parcels'] if p.get('building')]
    generated={r['id'] for r in city.s['roads'] if r.get('generated')}
    row=dict(month=city.s['month'],households=len(city.s['households']),
        population=sum(h['size'] for h in city.s['households']),employed=sum(bool(h.get('job')) for h in city.s['households']),
        jobs=sum(p['building'].get('positions',0) for p in buildings),waiting=city.s['pendingHousing'],
        buildings=len(buildings),generatedRoads=len(generated),
        newRoadBuildings=sum(p['road'] in generated for p in buildings),
        newRoadHomes=sum(p['road'] in generated and p['building']['use']=='residential' for p in buildings))
    if ids:
        journey=city.route(ids['home'],ids['work'],False,7000)
        row.update(commuteMinutes=journey['minutes'] if journey else None,
            commuteMode=journey['mode'] if journey else None,
            employmentAreaWorkers=sum(bool(h.get('job')) and city.parcelmap.get(h['job'],{}).get('road')==ids['jobsRoad'] for h in city.s['households']),
            employmentAreaBuildings=sum(p['road']==ids['jobsRoad'] for p in buildings),
            housingAreaBuildings=sum(p['road']==ids['homesRoad'] for p in buildings))
    return row


def run_comparison(months=6, states=None):
    transit,ids=separated_towns();off=City.restore(transit.snapshot());on=City.restore(transit.snapshot())
    on.command(dict(type='line_update',id=ids['line'],enabled=True))
    series={'transitOff':[metrics(off,ids)],'transitOn':[metrics(on,ids)]}
    streets,parent=full_frontage();manual=City.restore(streets.snapshot());automatic=City.restore(streets.snapshot())
    manual.s['settings']['autoGrow']=False
    series.update(autoRoadsOff=[metrics(manual)],autoRoadsOn=[metrics(automatic)])
    for _ in range(months):
        for key,city,context in (('transitOff',off,ids),('transitOn',on,ids),('autoRoadsOff',manual,None),('autoRoadsOn',automatic,None)):
            city.step();series[key].append(metrics(city,context))
    if states is not None:
        states.update(transitOff=off,transitOn=on,autoRoadsOff=manual,autoRoadsOn=automatic,
                      originalFootprints={p['id']:copy.deepcopy(p['building']['footprint']) for p in streets.s['parcels'] if p.get('building')})
    return series


class GrowthScenarioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.states={}
        cls.results=run_comparison(states=cls.states)

    def test_operating_transit_unlocks_jobs_migration_and_building_in_both_towns(self):
        off=self.results['transitOff'][-1];on=self.results['transitOn'][-1]
        self.assertIsNone(off['commuteMinutes'])
        self.assertEqual(off['employed'],0)
        self.assertEqual(off['waiting'],30)
        self.assertEqual(on['commuteMode'],'public')
        self.assertLess(on['commuteMinutes'],30)
        self.assertGreater(on['employmentAreaWorkers'],off['employmentAreaWorkers'])
        self.assertGreater(on['jobs'],off['jobs'])
        self.assertEqual(on['households'],50)
        self.assertEqual(on['waiting'],0)
        self.assertGreater(on['employmentAreaBuildings'],off['employmentAreaBuildings'])
        self.assertGreater(on['housingAreaBuildings'],off['housingAreaBuildings'])
        self.assertFalse(any(h.get('commuteFailed') for h in self.states['transitOn'].s['households']))

    def test_stops_or_closed_line_do_not_provide_phantom_access(self):
        city,ids=separated_towns()
        self.assertIsNone(city.route(ids['home'],ids['work'],False))
        self.assertEqual(sum(bool(h.get('job')) for h in city.s['households']),0)
        city.command(dict(type='line_update',id=ids['line'],enabled=True))
        self.assertEqual(sum(bool(h.get('job')) for h in city.s['households']),20)
        city.command(dict(type='stop_update',id=city.s['stops'][0]['id'],enabled=False))
        self.assertFalse(city.s['lines'][0]['valid'])
        self.assertIsNone(city.route(ids['home'],ids['work'],False))
        self.assertEqual(sum(bool(h.get('job')) for h in city.s['households']),0)

    def test_full_frontage_demand_creates_streets_homes_and_actual_residents(self):
        off=self.results['autoRoadsOff'][-1];on=self.results['autoRoadsOn'][-1]
        self.assertEqual(off['generatedRoads'],0)
        self.assertEqual(off['households'],0)
        self.assertGreater(on['generatedRoads'],0)
        self.assertGreater(on['newRoadHomes'],0)
        self.assertGreater(on['households'],off['households'])
        self.assertLess(on['waiting'],off['waiting'])
        city=self.states['autoRoadsOn']
        for before,after in zip(self.results['autoRoadsOn'],self.results['autoRoadsOn'][1:]):
            self.assertLessEqual(after['generatedRoads']-before['generatedRoads'],city.s['policy']['autoLanesPerMonth'])
        self.assertTrue(all(p['connected'] for p in city.s['parcels'] if p.get('building')))

    def test_automatic_streets_preserve_existing_buildings_and_clearance(self):
        city=self.states['autoRoadsOn'];original=self.states['originalFootprints']
        for pid,footprint in original.items():
            self.assertEqual(city.parcelmap[pid]['building']['footprint'],footprint)
        for r in city.s['roads']:
            if not r.get('generated'):continue
            corridor=LineString(r['points']).buffer(ROAD_TYPES[r['kind']]['width']/2+2)
            self.assertTrue(all(corridor.intersection(Polygon(fp)).area<=1 for fp in original.values()))

    def test_failed_road_can_retry_after_budget_is_available(self):
        city,_=full_frontage();city.s['settings']['budget']=True;city.s['treasury']=0
        self.assertFalse(grow_lanes(city))
        self.assertFalse(city.s['growthAttempts'])
        city.s['treasury']=100000000
        self.assertTrue(grow_lanes(city))
        self.assertTrue(city.s['growthAttempts'])

    def test_legacy_failed_attempts_do_not_permanently_block_reserved_gaps(self):
        city,_=full_frontage()
        city.s.pop('laneClearanceVersion',None)
        city.s['growthAttempts']=[stable_id('lane-',(r['id'],index,side)) for r in city.s['roads']
                                 for index,_ in branch_anchors(r) for side in (-1,1)]
        self.assertTrue(grow_lanes(city))
        self.assertEqual(set(city.s['growthAttempts']),{r['growthKey'] for r in city.s['roads'] if r.get('generated')})

    def test_demand_uses_existing_frontage_before_extending_empty_roads(self):
        city,_=full_frontage()
        for p in city.s['parcels'][1:]:p['building']=None
        city.rebuild();city.match_jobs()
        self.assertGreater(HousingMarket(city).summary()['shortage'],0)
        self.assertFalse(grow_lanes(city))
        self.assertTrue(any(not p.get('building') and p['connected'] for p in city.s['parcels']))
        city.develop()
        self.assertTrue(any(p.get('building') and p['building']['use']=='residential' for p in city.s['parcels']))

    def test_waiting_without_jobs_or_roads_does_not_create_a_disconnected_street(self):
        city=City(flat_world());city.s['pendingHousing']=60
        city.s['migrationQueue']=[dict(income=7000,car=False,count=60)]
        self.assertEqual(HousingMarket(city).summary()['shortage'],0)
        self.assertFalse(grow_lanes(city))
        self.assertFalse(city.s['roads'])

    def test_both_scenarios_continue_identically_after_save(self):
        for key in ('transitOn','autoRoadsOn'):
            with self.subTest(scenario=key):
                city=self.states[key]
                original=copy.deepcopy(city);restored=City.restore(city.snapshot())
                original.step();restored.step()
                self.assertEqual(original.snapshot(),restored.snapshot())


if __name__=='__main__':unittest.main()
