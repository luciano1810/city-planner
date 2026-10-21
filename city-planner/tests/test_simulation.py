"""Calendar boundaries, sampling and save continuity of the unified clock."""
import copy
import tempfile
import unittest
from unittest.mock import patch

from city.engine import City
from city.service import CityService
from city.simulation import DAY, month_days
from city.signals import phase
from tests.test_signals import cross_city


class UnifiedSimulationTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.service = CityService(self.folder.name)
        self.city = cross_city()
        self.city.s['settings'].update(growth=0, autoGrow=False, autoRenew=False)
        self.service.cities['sim'] = self.city

    def call(self, **payload):
        return self.service.handle('simulate', dict(id='sim', mode='test', **payload))

    def test_live_seconds_advance_walkers_lamps_and_daylight_together(self):
        first = self.call(seconds=0)
        second = self.call(seconds=8, speed=5)
        self.assertEqual(second['traffic']['seconds'], 8)
        self.assertEqual(second['sceneTimeSeconds'], 32408)
        self.assertEqual(second['simulation']['monthSeconds'], 32408)
        self.assertEqual(second['month'], 0)
        self.assertFalse(second['simulation']['sampled'])
        self.assertNotEqual(first['traffic']['pedestrians'], second['traffic']['pedestrians'])
        before = self.city.snapshot()
        self.call(seconds=0, speed=2592000)
        self.assertEqual(self.city.live_traffic.snapshot(), before['runtime']['liveTraffic'])
        self.assertEqual(self.city.s['simulation']['elapsedSeconds'], 8)

    def test_midnight_changes_day_without_monthly_settlement(self):
        self.service.handle('clock', dict(id='sim', minute=1439))
        result = self.call(seconds=120, speed=3600)
        self.assertEqual(result['simulation']['monthSeconds'], DAY+60)
        self.assertEqual(result['sceneTimeSeconds'], DAY+60)
        self.assertEqual(result['monthsAdvanced'], 0)
        self.assertEqual(self.city.s['history'], [])

    def test_month_boundary_settles_once_and_keeps_the_remainder(self):
        self.city.s['simulation']['monthSeconds'] = 31*DAY-5
        self.city.s['sceneTimeSeconds'] = 31*DAY-5
        result = self.call(seconds=8, speed=60)
        self.assertEqual(result['month'], 1)
        self.assertEqual(result['simulation']['monthSeconds'], 3)
        self.assertEqual(result['simulation']['elapsedSeconds'], 8)
        self.assertEqual(result['traffic']['seconds'], 8)
        self.assertEqual(len(self.city.s['history']), 1)
        self.assertEqual(result['city']['month'], 1)
        self.call(seconds=0)
        self.assertEqual(len(self.city.s['history']), 1)
        self.assertEqual(len(self.service.handle('saves', {})['saves']), 1)

    def test_fast_forward_settles_every_crossed_month_and_samples_safe_traffic(self):
        expected=City.restore(self.city.snapshot())
        expected.step(2)
        self.call(seconds=31*DAY, speed=2592000)
        result = self.call(seconds=31*DAY)
        self.assertEqual(result['month'], 2)
        self.assertEqual(result['simulation']['monthSeconds'], 3*DAY+32400)
        self.assertEqual(result['traffic']['seconds'], 62*DAY)
        self.assertTrue(result['simulation']['sampled'])
        self.assertEqual(len(self.city.s['history']), 2)
        for key in ['stats','history','parcels','treasury']:
            self.assertEqual(self.city.s[key],expected.s[key])
        self.assertEqual(self.city.rng.getstate(),expected.rng.getstate())
        for event in self.city.live_traffic.events:
            junction=self.city.live_traffic.junctions[event['junction']]
            self.assertEqual(phase(junction, event['time'])['lamps'][event['approach']], 'green')
        ids = [v['id'] for v in result['traffic']['vehicles']]
        resumed = self.call(seconds=1, speed=1)
        self.assertEqual(resumed['traffic']['seconds'], 62*DAY+1)
        self.assertFalse(resumed['simulation']['sampled'])
        self.assertTrue(set(ids) & {v['id'] for v in resumed['traffic']['vehicles']})

    def test_gregorian_leap_day_is_not_an_extra_month(self):
        self.assertEqual(month_days(1), 28)
        self.assertEqual(month_days(25), 29)
        self.city.s['month'] = 25
        self.city.s['simulation']['monthSeconds'] = 28*DAY-1
        result = self.call(seconds=2)
        self.assertEqual(result['month'], 25)
        self.assertEqual(result['simulation']['monthSeconds'], 28*DAY+1)

    def test_save_restore_preserves_partial_month_speed_and_exact_next_tick(self):
        self.call(seconds=130, speed=300)
        self.service.handle('save', dict(id='sim', name='统一模拟', mode='new'))
        loaded = self.service.handle('load', dict(name='统一模拟'))
        self.assertEqual(loaded['city']['simulation'], self.city.s['simulation'])
        expected = self.call(seconds=1, speed=1)
        actual = self.service.handle('simulate', dict(id=loaded['id'], mode='test', seconds=1, speed=1))
        self.assertEqual(actual, expected)
        legacy = self.city.snapshot()
        legacy['state'].pop('simulation')
        restored = City.restore(legacy)
        self.assertEqual(restored.s['simulation']['elapsedSeconds'], self.city.live_traffic.clock)
        self.assertEqual(restored.s['simulation']['monthSeconds'] % DAY, restored.s['sceneTimeSeconds'] % DAY)

    def test_invalid_requests_and_saved_clocks_do_not_change_the_city(self):
        self.call(seconds=0)
        before = self.city.snapshot()
        for payload in [dict(seconds=-1), dict(seconds=32*DAY), dict(seconds=True),
                        dict(seconds=float('nan')), dict(speed=2), dict(speed=True), dict(reset=1)]:
            with self.assertRaises(ValueError): self.call(**payload)
            self.assertEqual(self.city.snapshot(), before)
        for value in [-1, 31*DAY, float('nan')]:
            bad=copy.deepcopy(before)
            bad['state']['simulation']['monthSeconds']=value
            with self.assertRaises(ValueError): City.restore(bad)

    def test_failure_in_second_settlement_rolls_back_the_entire_tick(self):
        self.city.s['simulation']['monthSeconds']=30*DAY+32400
        self.call(seconds=0)
        before=self.city.snapshot()
        finance=self.city.finance
        count=0
        def fail_second():
            nonlocal count
            count+=1
            if count==2:raise RuntimeError('settlement failed')
            finance()
        with patch.object(self.city,'finance',side_effect=fail_second):
            with self.assertRaises(RuntimeError):self.call(seconds=30*DAY)
        self.assertEqual(self.city.snapshot(),before)

    def test_legacy_month_step_uses_the_calendar_without_resetting_clock(self):
        self.call(seconds=4)
        self.city.step(1)
        self.assertEqual(self.city.s['sceneTimeSeconds'],31*DAY+32404)
        self.assertEqual(self.city.s['simulation']['elapsedSeconds'],31*DAY+4)
        result=self.call(seconds=1)
        self.assertEqual(result['traffic']['seconds'],31*DAY+5)

    def test_edit_undo_and_redo_never_rewind_the_shared_clock(self):
        self.city.command(dict(type='settings',values=dict(growth=2)))
        self.call(seconds=8,speed=15)
        clock=copy.deepcopy(self.city.s['simulation'])
        daylight=self.city.s['sceneTimeSeconds']
        self.city.command(dict(type='undo'))
        self.assertEqual(self.city.s['simulation'],clock)
        self.assertEqual(self.city.s['sceneTimeSeconds'],daylight)
        self.city.command(dict(type='redo'))
        self.assertEqual(self.city.s['simulation'],clock)
        self.assertEqual(self.call(seconds=1)['traffic']['seconds'],9)


if __name__=='__main__': unittest.main()
