"""Renewal invariants: pure previews, phased supply, people, geometry and saves."""
import copy
import json
import tempfile
import unittest
from unittest.mock import patch
from shapely.geometry import Polygon, LineString
from shapely.ops import unary_union
from tests.test_city import City, flat_world, road
from tests.test_city_v3 import complete
from city import renewal
from city.development import planned_supply
from city.service import CityService
from city.engine import MODEL_VERSION


def neighborhood():
    c=City(flat_world());c.s['settings'].update(autoGrow=False,growth=0,migration=0)
    with patch('city.blocks.choose_layout',return_value='frontage'):
        for a,b in [((600,600),(780,600)),((780,600),(780,700)),((780,700),(600,700)),((600,700),(600,600))]:road(c,[a,b])
    plots=[p for p in c.s['parcels'] if p.get('block') and not p.get('blockCommon')]
    for p in plots:complete(c,p,'commercial',20)
    c.rebuild();c.summarize()
    return c,plots


def begin(c,p,**options):
    args=dict(id=p['id'],**options);plan=renewal.preview(c,args)
    c.command(dict(type='renewal_start',token=plan['token'],**args))
    return c.s['renewals'][-1]


def tick(c):
    # Isolate construction accounting from unrelated market growth.
    c.s['month']+=1;c.s['movedOut']=c.s['relocated']=0
    renewal.advance(c);c.complete_projects();c.summarize()


class RenewalTests(unittest.TestCase):
    def setUp(self):self.c,self.plots=neighborhood()

    def test_preview_is_pure_and_respects_geometry_and_use_targets(self):
        c=self.c;before=c.snapshot()
        plan=renewal.preview(c,dict(id=self.plots[0]['id'],target='mixed'))
        self.assertEqual(before,c.snapshot())
        self.assertEqual(plan,renewal.preview(c,dict(id=self.plots[0]['id'],target='mixed')))
        self.assertGreater(plan['housingCapacity'],0);self.assertGreater(plan['jobCapacity'],0)
        self.assertEqual(plan['minimumMonths'],sum(p['demolitionMonths']+p['constructionMonths']+1 for p in plan['phases']))
        shapes=[]
        for phase in plan['phases']:
            original=unary_union([Polygon(points) for points in phase['sourcePoints']]).buffer(.41)
            for site in phase['sites']:
                shape=Polygon(site['points']);shapes.append(shape)
                self.assertTrue(original.covers(shape))
                b=site.get('targetBuilding')
                if b:
                    fp=Polygon(b['footprint']);self.assertTrue(shape.covers(fp))
                    self.assertLessEqual(fp.area/site['area'],.651)
                    self.assertLessEqual(b['floorArea']/site['area'],4.001)
        self.assertLess(sum(a.intersection(b).area for i,a in enumerate(shapes) for b in shapes[i+1:]),.02)

    def test_stale_preview_rejected_and_undo_restores_reservations(self):
        c=self.c;args=dict(id=self.plots[0]['id']);plan=renewal.preview(c,args)
        c.command(dict(type='settings',values=dict(externalJobs=500)))
        before=c.snapshot()
        with self.assertRaisesRegex(ValueError,'重新预览'):c.command(dict(type='renewal_start',token=plan['token'],**args))
        self.assertEqual(before,c.snapshot())
        begin(c,self.plots[0]);self.assertTrue(any(p.get('renewalProject') for p in c.s['parcels']))
        c.command(dict(type='undo'));self.assertFalse(c.s['renewals']);self.assertFalse(any(p.get('renewalProject') for p in c.s['parcels']))
        c.command(dict(type='redo'));self.assertEqual(len(c.s['renewals']),1)

    def test_phases_supply_finance_and_save_continuation(self):
        c=self.c;project=begin(c,self.plots[0],target='residential',primaryShare=100,phases=2)
        expected=project['housingCapacity'];self.assertEqual(planned_supply(c)['residential'],expected)
        originals=set(project['phases'][1]['sourceIds']);original_buildings={p['id']:copy.deepcopy(p['building']) for p in c.s['parcels'] if p['id'] in originals}
        treasury=c.s['treasury'];tick(c)
        self.assertEqual(project['phases'][0]['status'],'demolition')
        self.assertEqual(c.s['treasury'],treasury-project['phases'][0]['cost'])
        for pid,b in original_buildings.items():self.assertEqual(c.parcelmap[pid]['building']['id'],b['id'])
        self.assertEqual(c.s['stats']['housing'],0)
        for _ in range(2):tick(c)
        self.assertEqual(project['phases'][0]['status'],'construction')
        self.assertEqual(planned_supply(c)['residential'],expected)
        restored=City.restore(json.loads(json.dumps(c.snapshot())))
        for _ in range(24):tick(c);tick(restored)
        self.assertEqual(c.snapshot(),restored.snapshot())
        self.assertEqual(project['status'],'complete');self.assertEqual(c.s['stats']['housing'],expected)
        self.assertEqual(project['spent'],project['cost']);self.assertEqual(c.s['capitalAccounts']['街区更新'],project['cost'])
        self.assertEqual(c.s['stats']['population'],0)
        c.rebuild(regenerate=True)
        self.assertTrue(all(s['id'] in c.parcelmap for phase in project['phases'] for s in phase['sites']))
        shapes=[Polygon(p['points']) for p in c.s['parcels']]
        self.assertLess(sum(a.intersection(b).area for i,a in enumerate(shapes) for b in shapes[i+1:]),.02)

    def test_delivered_phase_is_available_before_whole_project_finishes(self):
        c=self.c;project=begin(c,self.plots[0],target='residential',primaryShare=100,phases=2)
        duration=project['phases'][0]['demolitionMonths']+project['phases'][0]['constructionMonths']+1
        for _ in range(duration+2):
            tick(c)
            if project['phases'][0]['status']=='complete':break
        self.assertEqual(project['phases'][0]['status'],'complete')
        self.assertEqual(project['phases'][1]['status'],'planned')
        delivered={p['id'] for p in project['phases'][0]['sites'] if p.get('targetBuilding')}
        self.assertTrue(delivered <= {p['id'] for p in c.available_homes()})
        c.command(dict(type='renewal_cancel',id=project['id']))
        self.assertTrue(delivered <= set(c.parcelmap))
        self.assertGreater(c.s['stats']['housing'],0)
        City.restore(c.snapshot())

    def test_wait_for_housing_then_relocate_without_erasing_people(self):
        c=self.c;p=self.plots[0];complete(c,p,'residential',5)
        c.s['households']=[dict(id='h-test',home=p['id'],size=3,income=10000,car=False,job=None,stress=0,commute=None,commuteFailed=False)]
        c.summarize();project=begin(c,p,phases=1)
        before=c.s['treasury'];tick(c)
        self.assertEqual(project['status'],'waiting');self.assertIn('住房',project['reason'])
        self.assertEqual(c.s['treasury'],before);self.assertIsNotNone(c.parcelmap[p['id']]['building'])
        external=next(q for q in c.s['parcels'] if q['id'] not in project['sourceIds'] and not q.get('blockCommon'))
        complete(c,external,'residential',2);external['rent']=5
        tick(c)
        self.assertEqual(project['status'],'active');self.assertEqual(c.s['households'][0]['home'],external['id'])
        self.assertEqual(project['relocated'],3);self.assertEqual(project['movedOut'],0)
        self.assertEqual(c.s['stats']['population'],3)

    def test_explicit_exit_and_budget_wait_are_atomic(self):
        c=self.c;p=self.plots[0];complete(c,p,'residential',2)
        c.s['households']=[dict(id='h-test',home=p['id'],size=2,income=7000,car=False,job=None,stress=0)]
        project=begin(c,p,allowExit=True,phases=1)
        c.s['settings']['budget']=True;c.s['treasury']=0;tick(c)
        self.assertEqual(project['status'],'waiting');self.assertEqual(len(c.s['households']),1);self.assertEqual(project['spent'],0)
        c.s['treasury']=project['cost'];tick(c)
        self.assertEqual(project['movedOut'],2);self.assertEqual(c.s['movedOut'],2);self.assertFalse(c.s['households'])

    def test_protected_land_and_pending_project_cannot_be_overwritten(self):
        c=self.c;protected=self.plots[-1];protected['use']='protected';shape=copy.deepcopy(protected['points'])
        project=begin(c,self.plots[0]);self.assertIn(protected['id'],project['preservedIds'])
        for cmd in [dict(type='delete',id=self.plots[0]['id']),dict(type='zone',id=self.plots[0]['id'],use='office'),dict(type='delete',id=self.plots[0]['road'])]:
            with self.assertRaisesRegex(ValueError,'更新'):c.command(cmd)
        c.rebuild(regenerate=True);self.assertEqual(c.parcelmap[protected['id']]['points'],shape)
        self.assertTrue(all(pid in c.parcelmap for pid in project['sourceIds']))
        c.command(dict(type='renewal_cancel',id=project['id']))
        project=c.s['renewals'][-1]
        self.assertEqual(project['status'],'cancelled')
        self.assertFalse(any(p.get('renewalProject')==project['id'] for p in c.s['parcels']))

    def test_renovation_retains_building_and_capacity(self):
        c=self.c;p=self.plots[0];p['building']['condition']=35
        old=copy.deepcopy(p['building']);project=begin(c,p,mode='renovate')
        tick(c)
        from city.construction import EPOCH
        import datetime
        date=EPOCH+datetime.timedelta(days=project['phases'][0]['completionDay'])
        c.s['month']=(date.year-2026)*12+date.month-1
        c.s['simulation']['monthSeconds']=(date.day-1)*86400
        c.complete_projects();renewal.advance(c)
        b=c.parcelmap[p['id']]['building'];self.assertEqual(project['status'],'complete')
        self.assertEqual(b['id'],old['id']);self.assertEqual(b['footprint'],old['footprint']);self.assertEqual(b['capacity'],old['capacity'])
        self.assertEqual(b['condition'],100);self.assertGreater(b['age'],old['age'])
        self.assertEqual(c.s['capitalAccounts']['建筑翻新'],project['cost'])

    def test_onsite_rebuild_keeps_parcel_and_outline_but_replaces_building(self):
        c=self.c;p=self.plots[0];old=copy.deepcopy(p)
        project=begin(c,p,mode='onsite',target='residential',residentialFloors=4,floorRatio=8)
        tick(c);self.assertIsNone(c.parcelmap[p['id']]['building'])
        for _ in range(15):tick(c)
        new=c.parcelmap[p['id']];self.assertEqual(project['status'],'complete')
        self.assertEqual(new['points'],old['points']);self.assertEqual(new['building']['footprint'],old['building']['footprint'])
        self.assertNotEqual(new['building']['id'],old['building']['id']);self.assertEqual(new['building']['use'],'residential')
        self.assertEqual(new['building']['floors'],4)

    def test_completed_commercial_project_can_become_housing(self):
        c=self.c;first=begin(c,self.plots[0],phases=1,primaryShare=100)
        for _ in range(15):tick(c)
        self.assertEqual(first['status'],'complete')
        p=next(p for p in c.s['parcels'] if p.get('renewalProject')==first['id'] and p.get('building'))
        second=begin(c,p,target='residential',primaryShare=100,phases=1)
        for _ in range(15):tick(c)
        self.assertEqual(second['status'],'complete');self.assertGreater(c.s['stats']['housing'],0)
        self.assertTrue(all(p['building']['use']=='residential' for p in c.s['parcels'] if p.get('renewalProject')==second['id'] and p.get('building')))
        City.restore(c.snapshot())

    def test_demand_wait_does_not_charge_or_demolish(self):
        c=self.c;project=begin(c,self.plots[0],target='office',primaryShare=100,waitForDemand=True)
        old=c.s['treasury'];tick(c)
        self.assertEqual(project['status'],'waiting');self.assertIn('需求',project['reason']);self.assertEqual(c.s['treasury'],old)
        self.assertTrue(all(c.parcelmap[pid].get('building') for pid in project['sourceIds']))

    def test_firm_relocation_and_closure_leave_no_job_references(self):
        c=self.c;p=self.plots[0];other=next(q for q in c.s['parcels'] if q['id']!=p['id'] and q.get('block'))
        c.s['firms']=[dict(id='firm-a',parcel=p['id'],industry='commercial',status='active',opened=0,lossMonths=0,relocations=0,employees=2)]
        project=begin(c,p,mode='onsite',target='residential',floorRatio=8)
        tick(c)
        self.assertEqual(project['firmsRelocated'],1);self.assertNotEqual(c.s['firms'][0]['parcel'],p['id'])
        self.assertEqual(c.s['firms'][0]['status'],'active')
        self.assertTrue(c.parcelmap[c.s['firms'][0]['parcel']]['building'])

    def test_load_validation_legacy_migration_and_service_preview(self):
        c=self.c;legacy=c.snapshot();legacy['model']=legacy['state']['version']='shanhai-city-8';legacy['state'].pop('renewals')
        restored=City.restore(legacy);self.assertEqual(restored.s['version'],MODEL_VERSION);self.assertEqual(restored.s['renewals'],[])
        project=begin(c,self.plots[0]);bad=c.snapshot();bad['state']['renewals'][0]['phases'][0]['sourceIds']=['missing']
        with self.assertRaisesRegex(ValueError,'关联地块'):City.restore(bad)
        with tempfile.TemporaryDirectory() as directory:
            service=CityService(directory);service.cities['test']=c
            service.save(c,'更新');loaded=service.handle('load',dict(name='更新'))
            self.assertEqual(loaded['city']['renewals'][0]['id'],project['id'])
            service.cities['preview']=restored
            plan=service.handle('renewal_preview',dict(id='preview',command=dict(id=self.plots[0]['id'])))
            self.assertIn('token',plan)

    def test_real_monthly_pipeline_preserves_population_and_serializes(self):
        c=self.c;begin(c,self.plots[0],target='residential',primaryShare=100,phases=1)
        c.step(12)
        self.assertEqual(c.s['renewals'][0]['status'],'complete')
        self.assertGreater(c.s['stats']['housing'],0);self.assertEqual(c.s['stats']['population'],0)
        restored=City.restore(c.snapshot());c.step();restored.step();self.assertEqual(c.snapshot(),restored.snapshot())


class AutomaticRenewalTests(unittest.TestCase):
    def setUp(self):
        self.c,self.plots=neighborhood()
        self.c.s['settings'].update(growth=1,autoRenew=True,externalJobs=0)
        self.c.s['month']=6

    def test_natural_renovation_respects_interval_toggle_and_cooldown(self):
        c=self.c;p=self.plots[0];p['building'].update(age=360,condition=40,occupied=20)
        p['rent']=26
        c.s['month']=5;renewal.automatic(c);self.assertFalse(c.s['renewals'])
        c.s['month']=6;c.s['settings']['autoRenew']=False;renewal.automatic(c);self.assertFalse(c.s['renewals'])
        c.s['settings']['autoRenew']=True;renewal.automatic(c)
        self.assertEqual(len(c.s['renewals']),1)
        project=c.s['renewals'][0];self.assertEqual(project['options']['mode'],'renovate')
        self.assertEqual(project['origin'],'automatic');self.assertIn('状况',project['decision'])
        for _ in range(4):tick(c)
        c.parcelmap[p['id']]['building'].update(condition=40,occupied=20)
        c.s['month']=12;renewal.automatic(c);self.assertEqual(len(c.s['renewals']),1)

    def test_vacant_building_can_change_use_automatically_in_monthly_step(self):
        c=self.c;p=self.plots[0];complete(c,p,'office',20)
        p['building'].update(age=180,status='vacant',vacantMonths=48)
        c.s['policy']['commercialBaseDemand']=2000;c.s['month']=5
        c.step()
        automatic=[q for q in c.s['renewals'] if q.get('origin')=='automatic']
        self.assertEqual(len(automatic),1)
        project=automatic[0];self.assertEqual(project['options']['mode'],'onsite')
        self.assertEqual(project['options']['target'],'commercial');self.assertFalse(project['options']['allowExit'])
        self.assertEqual(project['spent'],0)
        restored=City.restore(c.snapshot());self.assertEqual(restored.s['renewals'],c.s['renewals'])

    def test_automatic_project_stays_within_cash_limit(self):
        c=self.c;p=self.plots[0];p['building'].update(age=360,condition=40,occupied=20);p['rent']=26
        c.s['treasury']=100;renewal.automatic(c);self.assertFalse(c.s['renewals'])
        c.s['treasury']=100000000;c.s['settings']['growth']=0;renewal.automatic(c);self.assertFalse(c.s['renewals'])

    def test_widespread_vacancy_can_trigger_whole_block_replanning(self):
        c=self.c
        for p in self.plots:
            p['building'].update(age=180,status='vacant',vacantMonths=48,occupied=0)
            p['centrality']=1
        c.s['treasury']=10000000000
        workplace=next(p for p in c.s['parcels'] if not p.get('building') and not p.get('block'))
        complete(c,workplace,'office',10000)
        c.s['pendingHousing']=10000
        # Limited additional retail demand makes tall commercial replacements
        # less useful than a block plan dominated by needed housing.
        c.s['policy']['commercialBaseDemand']=300
        renewal.automatic(c)
        self.assertEqual(len(c.s['renewals']),1)
        project=c.s['renewals'][0]
        self.assertEqual(project['options']['mode'],'rebuild')
        self.assertEqual(project['options']['target'],'residential')
        self.assertIn('空置面积',project['decision']);self.assertGreater(project['housingCapacity'],0)
        self.assertLessEqual(project['cost'],c.s['treasury']*c.s['policy']['renewalBudgetShare'])


if __name__=='__main__':unittest.main()
