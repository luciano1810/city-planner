"""Dated construction, weekly cashflow, rollback and deterministic restore."""
import tempfile
import unittest
from unittest.mock import patch
from tests.test_city import block_city
from city.engine import City
from city import construction
from city.simulation import DAY, advance, advance_calendar, period_factor
from city.service import CityService

class WeeklyCalendarTests(unittest.TestCase):
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

    def test_weekly_finance_never_charges_at_month_end(self):
        c=self.city();initial=c.s['treasury'];monthly=sum(r['constructionCost'] for r in c.s['roads'])*.0006
        advance_calendar(c,6*DAY-c.s['simulation']['monthSeconds']);self.assertEqual(c.s['treasury'],initial)
        advance_calendar(c,DAY)
        self.assertEqual(len(c.s['weeklyHistory']),1)
        self.assertAlmostEqual(initial-c.s['treasury'],round(monthly*7/31,2),2)
        advance_calendar(c,23*DAY);self.assertEqual(len(c.s['weeklyHistory']),4)
        balance=c.s['treasury'];advance_calendar(c,DAY)
        self.assertEqual(c.s['month'],1);self.assertEqual(c.s['treasury'],balance)
        self.assertEqual(len(c.s['history']),1)

    def test_month_and_leap_year_rate_conversion(self):
        self.assertAlmostEqual(period_factor(0,31),1.)
        self.assertAlmostEqual(period_factor(28,35),3/31+4/28)
        self.assertAlmostEqual(period_factor(365+365+31,365+365+60),1.)

    def test_restore_preserves_progress_and_future_outcome(self):
        c=self.city();self.building(c,c.s['parcels'][0],2,12);advance_calendar(c,4*DAY)
        other=City.restore(c.snapshot());advance_calendar(c,12*DAY);advance_calendar(other,12*DAY)
        for k in ('parcels','weeklyHistory','calendar','events','treasury','simulation'):self.assertEqual(c.s[k],other.s[k],k)
        self.assertEqual(c.rng.getstate(),other.rng.getstate())

    def test_large_tick_matches_daily_ticks(self):
        c=self.city();other=City.restore(c.snapshot());advance_calendar(c,25*DAY)
        for _ in range(25):advance_calendar(other,DAY)
        for k in ('parcels','weeklyHistory','calendar','treasury','events'):self.assertEqual(c.s[k],other.s[k],k)

    def test_failed_second_week_rolls_back_entire_tick(self):
        c=self.city();self.building(c,c.s['parcels'][0],2,12);c.rebuild();before=c.snapshot();original=c.finance;calls=0
        def fail():
            nonlocal calls
            calls+=1
            if calls==2:raise RuntimeError('weekly failure')
            original()
        with patch.object(c,'finance',side_effect=fail):
            with self.assertRaisesRegex(RuntimeError,'weekly failure'):advance(c,20*DAY)
        self.assertEqual(c.snapshot(),before)

    def test_month_button_uses_the_same_daily_rules(self):
        c=self.city();self.building(c,c.s['parcels'][0],2,12);other=City.restore(c.snapshot())
        c.step();advance_calendar(other,31*DAY)
        self.assertEqual(c.s,other.s);self.assertEqual(len(c.s['weeklyHistory']),4)

    def test_plans_reserve_capacity_without_becoming_available_homes(self):
        c=self.city();c.s['settings']['growth']=1;advance_calendar(c,7*DAY)
        planned=[p for p in c.s['parcels'] if p.get('building')]
        self.assertTrue(planned);self.assertTrue(all(p['building']['status']=='planned' for p in planned))
        self.assertFalse(c.available_homes());self.assertTrue(all(7<p['building']['startDay']<=14 for p in planned))
        self.assertEqual(c.s['stats']['buildings'],0);self.assertEqual(c.s['stats']['construction'],0)
        self.assertEqual(c.s['stats']['plannedBuildings'],len(planned))

    def test_legacy_save_migrates_without_retroactive_cashflow(self):
        c=self.city();b=self.building(c,c.s['parcels'][0],2,12);b['status']='construction'
        for k in ('startDay','completionDay','startDate','completionDate','constructionProgress'):b.pop(k)
        c.s['simulation']['monthSeconds']=10*DAY;data=c.snapshot()
        data['state'].pop('calendar');data['state'].pop('weeklyHistory');other=City.restore(data)
        self.assertEqual(other.s['calendar']['nextWeekDay'],17)
        self.assertIn('completionDay',other.s['parcels'][0]['building']);self.assertEqual(other.s['treasury'],c.s['treasury'])

    def test_background_week_matches_direct_settlement(self):
        c=self.city();advance_calendar(c,6*DAY-c.s['simulation']['monthSeconds'])
        other=City.restore(c.snapshot());advance_calendar(other,DAY)
        with tempfile.TemporaryDirectory() as directory:
            service=CityService(directory);service.cities['test']=c
            try:
                service.handle('simulate',dict(id='test',seconds=DAY,incremental=True,speed=2592000))
                job=service.preparation;self.assertIsNotNone(job);job.thread.join(20)
                self.assertIsNone(job.error);self.assertIsNotNone(job.result)
                r=service.handle('simulate',dict(id='test',seconds=DAY,incremental=True,speed=2592000))
                self.assertEqual(r['weeksAdvanced'],1);self.assertIsNone(service.preparation)
                for k in ('parcels','weeklyHistory','calendar','treasury','events'):self.assertEqual(c.s[k],other.s[k],k)
            finally:service.close()

    def test_invalid_saved_schedule_and_credit_are_rejected(self):
        import copy
        c=self.city();self.building(c,c.s['parcels'][0],2,12);snapshot=c.snapshot()
        for field,value in [('completionDay',1),('startDay',-1),('constructionProgress',1.1)]:
            data=copy.deepcopy(snapshot);data['state']['parcels'][0]['building'][field]=value
            with self.assertRaises(ValueError):City.restore(data)
        data=copy.deepcopy(snapshot);data['state']['calendar']['projectCredit']=-1
        with self.assertRaises(ValueError):City.restore(data)

    def test_weekly_commit_on_calendar_month_boundary(self):
        from city.monthly import Preparation
        c=self.city();c.s['month']=8;c.s['simulation']['monthSeconds']=29*DAY
        c.s['calendar'].update(lastWeekDay=266,nextWeekDay=273)
        expected=City.restore(c.snapshot());advance_calendar(expected,DAY)
        with tempfile.TemporaryDirectory() as directory:
            service=CityService(directory);service.cities['test']=c
            try:
                service.handle('simulate',dict(id='test',seconds=DAY,incremental=True,speed=2592000))
                job=service.preparation;job.thread.join(20);self.assertIsNone(job.error)
                result=service.handle('simulate',dict(id='test',seconds=DAY,incremental=True,speed=2592000))
                self.assertEqual(result['weeksAdvanced'],1);self.assertEqual(result['monthsAdvanced'],1)
                for key in ('calendar','weeklyHistory','history','treasury','month'):
                    self.assertEqual(c.s[key],expected.s[key],key)
            finally:service.close()

if __name__=='__main__':unittest.main()
