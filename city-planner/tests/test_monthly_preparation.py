"""Daily work stays isolated; short ticks commit only a complete revision."""
import copy
import math
import tempfile
import unittest
from unittest.mock import patch

from tests.test_city import block_city
from city.engine import City
from city.monthly import Preparation
from city.service import CityService
from city.simulation import DAY, advance_calendar
from city.construction import day


class HeldPreparation(Preparation):
    def __init__(self,city):
        self.city=city;self.signature=(city.s['revision'],city.s['month'])
        self.start=day(city)*DAY;self.end=city.s['calendar']['nextSettlementDay']*DAY
        self.progress=(0.,'测试阶段');self.result=None;self.error=None;self.stopped=False
    def cancel(self):self.stopped=True


class MonthlyPreparationTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory();self.addCleanup(self.folder.cleanup)
        self.service=CityService(self.folder.name);self.addCleanup(self.service.close)
        self.city=block_city();self.city.s['saveGroup']='daily-test'
        self.city.s['simulation']['monthSeconds']=0.
        self.service.cities['test']=self.city

    def call(self,seconds=DAY,**extra):
        return self.service.handle('simulate',dict(id='test',seconds=seconds,speed=2592000,
                                                 incremental=True,daylightSeconds=.1,**extra))

    def test_waiting_ticks_are_bounded_preserve_economics_and_advance_sun(self):
        city=self.city;job=self.service.preparation=HeldPreparation(city)
        stats=copy.deepcopy(city.s['stats']);month=city.s['month'];clock=city.s['simulation']['monthSeconds']
        sunlight=city.s['sceneTimeSeconds']
        self.assertEqual(self.call(31*DAY)['advancedSeconds'],0)
        job.progress=(.5,'交通分配')
        result=self.call(31*DAY)
        self.assertEqual(result['advancedSeconds'],DAY/2)
        self.assertEqual(city.s['simulation']['monthSeconds'],clock+DAY/2)
        self.assertEqual(city.s['month'],month);self.assertEqual(city.s['stats'],stats)
        self.assertAlmostEqual(city.s['sceneTimeSeconds'],sunlight+.2)
        self.assertTrue(result['settlement']['pending'])

    def test_fractional_tick_immediately_before_midnight_does_not_stall(self):
        self.city.s['simulation']['monthSeconds']=math.nextafter(DAY,0)
        job=self.service.preparation=HeldPreparation(self.city)
        job.result=City.restore(self.city.snapshot())
        advance_calendar(job.result,DAY-self.city.s['simulation']['monthSeconds'])
        result=self.call()
        self.assertGreater(result['advancedSeconds'],0)
        self.assertEqual(self.city.s['simulation']['monthSeconds'],DAY)
        with patch('city.monthly.Preparation',HeldPreparation):
            self.call()
        self.assertIsNotNone(self.service.preparation)
        self.service.preparation.progress=(.5,'继续计算')
        self.assertGreater(self.call()['advancedSeconds'],DAY*.49)

    def test_ready_commit_preserves_current_clock_name_and_save_identity(self):
        city=self.city;city.s['simulation']['monthSeconds']=DAY-10
        job=self.service.preparation=HeldPreparation(city)
        prepared=City.restore(city.snapshot());advance_calendar(prepared,10)
        job.result=prepared
        city.s['name']='计算中改名';city.s['saveGroup']='new-save-group'
        clock=city.s['simulation']['elapsedSeconds'];sun=city.s['sceneTimeSeconds']
        expected_stats=copy.deepcopy(prepared.s['stats'])
        with patch.object(City,'step',side_effect=AssertionError('request must not run settlement')):
            result=self.call(31*DAY)
        self.assertEqual(result['advancedSeconds'],10)
        self.assertEqual(result['settlementsAdvanced'],1)
        self.assertEqual(city.s['stats'],expected_stats)
        self.assertEqual(city.s['simulation']['monthSeconds'],DAY)
        self.assertEqual(city.s['simulation']['elapsedSeconds'],clock+10)
        self.assertAlmostEqual(city.s['sceneTimeSeconds'],sun+.1)
        self.assertEqual(city.s['name'],'计算中改名');self.assertEqual(city.s['saveGroup'],'new-save-group')
        self.assertIsNone(self.service.preparation)
        self.assertTrue(list(self.service.directory.glob('自动保存 new-save-group.json.gz')))

    def test_failed_worker_does_not_publish_and_can_be_retried(self):
        job=self.service.preparation=HeldPreparation(self.city);job.error='worker failed'
        before=self.city.snapshot()
        with self.assertRaisesRegex(ValueError,'尚未提交'):self.call()
        self.assertEqual(self.city.snapshot(),before)
        self.assertTrue(job.stopped);self.assertIsNone(self.service.preparation)
        with patch('city.monthly.Preparation',HeldPreparation):self.call()
        self.assertIsNotNone(self.service.preparation)

    def test_ready_day_commits_the_last_fraction_before_midnight(self):
        for month, boundary in ((0,24), (0,31), (9,24)):
            with self.subTest(month=month,boundary=boundary):
                city=self.city
                city.s['month']=month
                city.s['simulation']['monthSeconds']=(boundary-1)*DAY
                today=int(day(city))
                city.s['calendar'].update(lastSettlementDay=today,nextSettlementDay=today+1)
                job=self.service.preparation=HeldPreparation(city)
                prepared=City.restore(city.snapshot());advance_calendar(prepared,DAY)
                job.result=prepared
                city.s['simulation']['monthSeconds']=math.nextafter(boundary*DAY,0.)
                result=self.call(3*DAY)
                self.assertEqual(result['settlementsAdvanced'],1)
                self.assertEqual(city.s['month'],prepared.s['month'])
                self.assertEqual(city.s['simulation']['monthSeconds'],0. if boundary==31 else boundary*DAY)
                self.assertEqual(city.s['calendar']['lastSettlementDay'],today+1)
                self.assertIsNone(self.service.preparation)
                self.assertIsNone(result['settlement'])

    def test_failure_after_commit_rolls_back_and_discards_prepared_rng(self):
        city=self.city;city.s['simulation']['monthSeconds']=DAY-10
        job=self.service.preparation=HeldPreparation(city)
        job.result=City.restore(city.snapshot());advance_calendar(job.result,10)
        before=city.snapshot()
        with patch('city.signals.LiveTraffic.advance',side_effect=RuntimeError('traffic failed')):
            with self.assertRaisesRegex(RuntimeError,'traffic failed'):self.call()
        self.assertEqual(city.snapshot(),before)
        self.assertTrue(job.stopped);self.assertIsNone(self.service.preparation)

    def test_edits_and_loading_invalidate_old_preparation_and_pending_saves_are_clean(self):
        job=self.service.preparation=HeldPreparation(self.city)
        self.service.handle('save',dict(id='test',name='月内存档',mode='new'))
        self.assertIs(self.service.preparation,job)
        loaded=self.service.handle('load',dict(name='月内存档'))
        self.assertTrue(job.stopped);self.assertNotIn('settlement',loaded['city'])
        self.assertEqual(loaded['city']['month'],self.city.s['month'])
        job=self.service.preparation=HeldPreparation(self.city)
        self.service.handle('command',dict(id='test',command=dict(type='road',points=[[200,200],[1000,200]],kind='street')))
        self.assertTrue(job.stopped);self.assertIsNone(self.service.preparation)

    def test_revision_mismatch_discards_result_before_any_commit(self):
        old=self.service.preparation=HeldPreparation(self.city)
        old.result=City.restore(self.city.snapshot())
        self.city.s['revision']+=1
        with patch('city.monthly.Preparation',HeldPreparation):result=self.call()
        self.assertTrue(old.stopped);self.assertEqual(result['monthsAdvanced'],0)
        self.assertIsNot(self.service.preparation,old)

    def test_real_process_matches_daily_rules_and_does_not_modify_city_until_commit(self):
        expected=City.restore(self.city.snapshot());advance_calendar(expected,DAY)
        self.call();job=self.service.preparation
        job.thread.join(timeout=15)
        self.assertFalse(job.thread.is_alive());self.assertIsNone(job.error)
        self.assertIsNotNone(job.result);self.assertEqual(self.city.s['month'],0)
        for _ in range(32):
            result=self.call()
            if result['settlementsAdvanced']:break
        self.assertEqual(result['settlementsAdvanced'],1)
        for key in ('stats','parcels','households','history','events','treasury'):
            self.assertEqual(self.city.s[key],expected.s[key],key)
        self.assertEqual(self.city.rng.getstate(),expected.rng.getstate())

    def test_process_cancellation_leaves_no_worker_and_no_partial_month(self):
        self.call();job=self.service.preparation
        self.service.close();job.thread.join(timeout=10)
        self.assertFalse(job.thread.is_alive())
        self.assertFalse(job.process.pid is not None and job.process.is_alive())
        self.assertEqual(self.city.s['month'],0)

    def test_invalid_payload_does_not_start_a_worker(self):
        for payload in (dict(seconds=-1),dict(seconds=32*DAY),dict(speed=7),dict(daylightSeconds=-1),dict(reset=1)):
            with self.assertRaises(ValueError):
                self.service.handle('simulate',dict(id='test',incremental=True,**payload))
            self.assertIsNone(self.service.preparation)
