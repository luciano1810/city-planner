"""Dated construction, daily cashflow, rollback and deterministic restore."""
import tempfile
import math
import unittest
from unittest.mock import patch
from tests.test_city import block_city
from city.engine import City
from city import construction
from city.simulation import DAY, advance, advance_calendar, period_factor
from city.service import CityService

class DailyCalendarTests(unittest.TestCase):
    def city(self):
        c=block_city();c.s['settings'].update(autoGrow=False,autoRenew=False,growth=0)
        return c

    def building(self,c,p,start,end):
        from city.geometry import building_footprint
        from city.urban import building_style
        foot=building_footprint(p,'residential',.1,200)
        b=dict(id=c.uid('b'),use='residential',floors=3,floorArea=600,footprintArea=200,
            footprint=[list(q) for q in foot.exterior.coords],center=list(foot.centroid.coords[0]),
            capacity=5,status='planned',ready=2,age=0,occupied=0,positions=0,employees=0,
            cost=1000,vacantMonths=0,**building_style(p,'residential',3))
        construction.schedule(c,b,start=start,months=1)
        b.update(completionDay=end,completionDate=construction.date_string(end));p['building']=b
        return b

    def test_individual_start_progress_and_delivery_before_month_end(self):
        c=self.city();a=self.building(c,c.s['parcels'][0],2,5);b=self.building(c,c.s['parcels'][1],3,6)
        advance_calendar(c,2*DAY-c.s['simulation']['monthSeconds'])
        self.assertEqual((a['status'],b['status']),('construction','planned'))
        advance_calendar(c,DAY)
        self.assertEqual(b['status'],'construction');self.assertAlmostEqual(a['constructionProgress'],1/3,5)
        advance_calendar(c,2*DAY)
        self.assertEqual((a['status'],b['status']),('active','construction'))
        self.assertEqual(c.s['month'],0);self.assertEqual(len(c.available_homes()),1)
        advance_calendar(c,DAY);self.assertEqual(b['status'],'active')
        self.assertEqual([e['date'] for e in c.s['events'] if e['category']=='竣工'],['2026-01-06','2026-01-07'])

    def test_daily_finance_charges_once_including_month_end(self):
        c=self.city();initial=c.s['treasury'];monthly=sum(r['constructionCost'] for r in c.s['roads'])*.0006
        advance_calendar(c,DAY-c.s['simulation']['monthSeconds']-1)
        self.assertEqual(c.s['treasury'],initial)
        advance_calendar(c,1)
        daily=round(monthly/31,2)
        self.assertEqual(len(c.s['dailyHistory']),1)
        self.assertAlmostEqual(initial-c.s['treasury'],daily,2)
        self.assertTrue(all(len(p['history'])==1 for p in c.s['parcels']))
        advance_calendar(c,30*DAY)
        self.assertEqual(c.s['month'],1);self.assertEqual(len(c.s['dailyHistory']),31)
        self.assertAlmostEqual(initial-c.s['treasury'],31*daily,2)
        self.assertEqual(len(c.s['history']),1)
        self.assertAlmostEqual(c.s['history'][0]['maintenance'],31*daily,2)
        balance=c.s['treasury'];advance_calendar(c,0)
        self.assertEqual(c.s['treasury'],balance)
        advance_calendar(c,DAY)
        self.assertAlmostEqual(balance-c.s['treasury'],round(monthly/28,2),2)
        self.assertEqual(c.s['dailyHistory'][-1]['periodDays'],1)

    def test_rail_fares_settle_once_and_facility_upkeep_is_prorated(self):
        city=self.city();baseline=City.restore(city.snapshot())
        city._period_factor=baseline._period_factor=1/31
        city.s['railRuntime']['pendingFare']=125.
        city.s['railInfrastructure']['facilities'].append(dict(constructionCost=310000))
        city.finance();baseline.finance()
        self.assertEqual(city.s['railRuntime']['pendingFare'],0.)
        self.assertAlmostEqual(city.s['revenue']-baseline.s['revenue'],125.,2)
        self.assertAlmostEqual(city.s['maintenance']-baseline.s['maintenance'],40.,2)
        self.assertAlmostEqual(city.s['treasury']-baseline.s['treasury'],85.,2)
        city.finance();baseline.finance()
        self.assertEqual(city.s['revenue'],baseline.s['revenue'])
        self.assertAlmostEqual(city.s['maintenance']-baseline.s['maintenance'],40.,2)
        self.assertAlmostEqual(city.s['treasury']-baseline.s['treasury'],45.,2)

    def test_month_and_leap_year_rate_conversion(self):
        self.assertAlmostEqual(period_factor(0,31),1.)
        self.assertAlmostEqual(period_factor(28,35),3/31+4/28)
        self.assertAlmostEqual(period_factor(365+365+31,365+365+60),1.)

    def test_sub_nanosecond_midnight_remainder_is_settled_exactly_once(self):
        c=self.city();boundary=24*DAY
        c.s['simulation']['monthSeconds']=math.nextafter(boundary,0.)
        c.s['calendar'].update(lastSettlementDay=23,nextSettlementDay=24)
        remainder=boundary-c.s['simulation']['monthSeconds']
        self.assertLess(remainder,1e-9)
        result=advance(c,remainder)
        self.assertEqual(result['settlementsAdvanced'],1)
        self.assertEqual(c.s['simulation']['monthSeconds'],boundary)
        self.assertEqual(c.s['calendar']['lastSettlementDay'],24)
        advance(c,0)
        self.assertEqual(len(c.s['dailyHistory']),1)

    def test_near_midnight_tick_does_not_run_an_early_boundary(self):
        c=self.city();boundary=24*DAY
        c.s['simulation']['monthSeconds']=boundary-1
        c.s['calendar'].update(lastSettlementDay=23,nextSettlementDay=24)
        revision=c.s['revision']
        days,settlements=advance_calendar(c,1-5e-9)
        self.assertEqual((days,settlements),(0,0))
        self.assertEqual(c.s['revision'],revision)
        self.assertEqual(advance_calendar(c,boundary-c.s['simulation']['monthSeconds']),(1,1))

    def test_tiny_midnight_commit_failure_rolls_back(self):
        c=self.city();boundary=24*DAY
        c.s['simulation']['monthSeconds']=math.nextafter(boundary,0.)
        c.s['calendar'].update(lastSettlementDay=23,nextSettlementDay=24)
        before=c.snapshot()
        with patch.object(c,'finance',side_effect=RuntimeError('daily failure')):
            with self.assertRaisesRegex(RuntimeError,'daily failure'):
                advance(c,boundary-c.s['simulation']['monthSeconds'])
        self.assertEqual(c.snapshot(),before)

    def test_restore_preserves_progress_and_future_outcome(self):
        c=self.city();self.building(c,c.s['parcels'][0],2,12);advance_calendar(c,4*DAY)
        other=City.restore(c.snapshot());advance_calendar(c,12*DAY);advance_calendar(other,12*DAY)
        for k in ('parcels','dailyHistory','calendar','events','treasury','simulation'):self.assertEqual(c.s[k],other.s[k],k)
        self.assertEqual(c.rng.getstate(),other.rng.getstate())

    def test_large_tick_matches_daily_ticks(self):
        c=self.city();other=City.restore(c.snapshot());advance_calendar(c,25*DAY)
        for _ in range(25):advance_calendar(other,DAY)
        for k in ('parcels','dailyHistory','calendar','treasury','events'):self.assertEqual(c.s[k],other.s[k],k)

    def test_failed_second_day_rolls_back_entire_tick(self):
        c=self.city();self.building(c,c.s['parcels'][0],2,12);c.rebuild();before=c.snapshot();original=c.finance;calls=0
        def fail():
            nonlocal calls
            calls+=1
            if calls==2:raise RuntimeError('daily failure')
            original()
        with patch.object(c,'finance',side_effect=fail):
            with self.assertRaisesRegex(RuntimeError,'daily failure'):advance(c,20*DAY)
        self.assertEqual(c.snapshot(),before)

    def test_month_button_uses_the_same_daily_rules(self):
        c=self.city();self.building(c,c.s['parcels'][0],2,12);other=City.restore(c.snapshot())
        c.step();advance_calendar(other,31*DAY)
        self.assertEqual(c.s,other.s);self.assertEqual(len(c.s['dailyHistory']),31)

    def test_plans_reserve_capacity_without_becoming_available_homes(self):
        c=self.city();c.s['settings']['growth']=1;advance_calendar(c,3*DAY-c.s['simulation']['monthSeconds'])
        planned=[p for p in c.s['parcels'] if p.get('building')]
        self.assertTrue(planned);self.assertTrue(all(p['building']['status']=='planned' for p in planned))
        self.assertFalse(c.available_homes());self.assertTrue(all(3<p['building']['startDay']<=6 for p in planned))
        self.assertEqual(c.s['stats']['buildings'],0);self.assertEqual(c.s['stats']['construction'],0)
        self.assertEqual(c.s['stats']['plannedBuildings'],len(planned))

    def test_legacy_save_migrates_without_retroactive_cashflow(self):
        c=self.city();b=self.building(c,c.s['parcels'][0],2,12);b['status']='construction'
        for k in ('startDay','completionDay','startDate','completionDate','constructionProgress'):b.pop(k)
        c.s['simulation']['monthSeconds']=10*DAY;data=c.snapshot()
        data['state'].pop('calendar');data['state'].pop('dailyHistory');other=City.restore(data)
        self.assertEqual(other.s['calendar']['nextSettlementDay'],11)
        self.assertIn('completionDay',other.s['parcels'][0]['building']);self.assertEqual(other.s['treasury'],c.s['treasury'])

    def test_background_day_matches_direct_settlement(self):
        c=self.city();advance_calendar(c,6*DAY-c.s['simulation']['monthSeconds'])
        other=City.restore(c.snapshot());advance_calendar(other,DAY)
        with tempfile.TemporaryDirectory() as directory:
            service=CityService(directory);service.cities['test']=c
            try:
                service.handle('simulate',dict(id='test',seconds=DAY,incremental=True,speed=2592000))
                job=service.preparation;self.assertIsNotNone(job);job.thread.join(20)
                self.assertIsNone(job.error);self.assertIsNotNone(job.result)
                r=service.handle('simulate',dict(id='test',seconds=DAY,incremental=True,speed=2592000))
                self.assertEqual(r['settlementsAdvanced'],1);self.assertIsNone(service.preparation)
                for k in ('parcels','dailyHistory','calendar','treasury','events'):self.assertEqual(c.s[k],other.s[k],k)
            finally:service.close()

    def test_invalid_saved_schedule_and_credit_are_rejected(self):
        import copy
        c=self.city();self.building(c,c.s['parcels'][0],2,12);snapshot=c.snapshot()
        for field,value in [('completionDay',1),('startDay',-1),('constructionProgress',1.1)]:
            data=copy.deepcopy(snapshot);data['state']['parcels'][0]['building'][field]=value
            with self.assertRaises(ValueError):City.restore(data)
        data=copy.deepcopy(snapshot);data['state']['calendar']['projectCredit']=-1
        with self.assertRaises(ValueError):City.restore(data)

    def test_daily_commit_on_calendar_month_boundary(self):
        from city.monthly import Preparation
        c=self.city();c.s['month']=8;c.s['simulation']['monthSeconds']=29*DAY
        c.s['calendar'].update(lastSettlementDay=272,nextSettlementDay=273)
        expected=City.restore(c.snapshot());advance_calendar(expected,DAY)
        with tempfile.TemporaryDirectory() as directory:
            service=CityService(directory);service.cities['test']=c
            try:
                service.handle('simulate',dict(id='test',seconds=DAY,incremental=True,speed=2592000))
                job=service.preparation;job.thread.join(20);self.assertIsNone(job.error)
                result=service.handle('simulate',dict(id='test',seconds=DAY,incremental=True,speed=2592000))
                self.assertEqual(result['settlementsAdvanced'],1);self.assertEqual(result['monthsAdvanced'],1)
                for key in ('calendar','dailyHistory','history','treasury','month'):
                    self.assertEqual(c.s[key],expected.s[key],key)
            finally:service.close()

    def test_weekly_save_migration_keeps_paid_balance_credit_and_unsettled_days(self):
        c=self.city();c.s['simulation']['monthSeconds']=10*DAY+43200
        data=c.snapshot();data['model']=data['state']['version']='shanhai-city-11'
        state=data['state'];state.pop('dailyHistory')
        weekly_row=dict(day=7,date='2026-01-08',revenue=70,maintenance=35)
        state['weeklyHistory']=[weekly_row]
        state['calendar'].update(lastWeekDay=7,nextWeekDay=14,projectCredit=.25,migrationCredit=.75)
        state['calendar'].pop('lastSettlementDay');state['calendar'].pop('nextSettlementDay')
        state['revenue']=70;state['maintenance']=35
        other=City.restore(data);initial=other.s['treasury']
        self.assertEqual(other.s['dailyHistory'],[])
        self.assertEqual(other.s['weeklyHistory'],[weekly_row])
        self.assertEqual(other.s['revenue'],0);self.assertEqual(other.s['maintenance'],0)
        self.assertEqual(other.s['calendar']['lastSettlementDay'],7)
        self.assertEqual(other.s['calendar']['nextSettlementDay'],11)
        self.assertEqual(other.s['calendar']['projectCredit'],.25)
        self.assertEqual(other.s['calendar']['migrationCredit'],.75)
        self.assertEqual(other.s['treasury'],initial)
        advance_calendar(other,DAY/2)
        row=other.s['dailyHistory'][-1]
        self.assertEqual(row['periodDays'],4);self.assertEqual(row['periodStartDate'],'2026-01-08')
        monthly=sum(r['constructionCost'] for r in other.s['roads'])*.0006
        self.assertAlmostEqual(initial-other.s['treasury'],round(monthly*4/31,2),2)
        restored=City.restore(other.snapshot())
        advance_calendar(other,DAY);advance_calendar(restored,DAY)
        self.assertEqual(other.s,restored.s)
        self.assertEqual(other.s['dailyHistory'][-1]['periodDays'],1)
        self.assertAlmostEqual(other.s['maintenance'],round(monthly/31,2),2)

    def test_daily_project_quota_preserves_monthly_total_and_fractional_credit(self):
        c=self.city();c.s['settings']['growth']=1;limits=[]
        for _ in range(31):
            advance_calendar(c,DAY)
            limits.append(c.s['housingDemand']['projectLimit'])
        self.assertEqual(sum(limits),c.s['settings']['maxProjects'])
        self.assertAlmostEqual(c.s['calendar']['projectCredit'],0.)
        self.assertGreater(sum(n>0 for n in limits),1)

if __name__=='__main__':unittest.main()
