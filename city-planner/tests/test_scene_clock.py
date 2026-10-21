"""World daylight follows the same elapsed seconds as live traffic, and survives saves."""
import copy
import tempfile
import unittest

from tests.test_city import flat_world
from city.engine import City
from city.service import CityService


class SceneClockTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.service=CityService(self.folder.name)
        self.city=City(flat_world())
        self.service.cities['scene']=self.city

    def call(self,action,**payload):
        return self.service.handle(action,dict(id='scene',**payload))

    def test_clock_follows_actual_simulated_seconds_and_crosses_midnight(self):
        self.call('clock',minute=1439)
        for _ in range(7):result=self.call('traffic',seconds=10)
        self.assertEqual(result['sceneTimeSeconds'],86410)
        self.assertEqual(result['seconds'],70)
        self.assertEqual(self.call('traffic',seconds=0),result)

    def test_reset_and_mode_switch_preserve_daylight_but_time_scrubbing_preserves_traffic(self):
        first=self.call('traffic',seconds=5)
        second=self.call('traffic',seconds=0,reset=True,mode='test')
        self.assertEqual(first['sceneTimeSeconds'],second['sceneTimeSeconds'])
        self.assertEqual(second['seconds'],0)
        self.call('traffic',seconds=3,mode='test')
        before=copy.deepcopy(self.city.live_traffic.snapshot())
        self.call('clock',minute=21*60)
        self.assertEqual(before,self.city.live_traffic.snapshot())
        self.assertEqual(self.city.s['sceneTimeSeconds'],21*3600)

    def test_save_and_legacy_restore_keep_a_valid_clock(self):
        self.call('clock',minute=1140)
        self.call('traffic',seconds=3)
        restored=City.restore(self.city.snapshot())
        self.assertEqual(restored.s['sceneTimeSeconds'],68403)
        self.assertEqual(restored.live_traffic.view(),self.city.live_traffic.view())
        legacy=self.city.snapshot();legacy['state'].pop('sceneTimeSeconds')
        self.assertEqual(City.restore(legacy).s['sceneTimeSeconds'],9*3600)

    def test_invalid_clock_values_are_atomic(self):
        before=self.city.snapshot()
        for minute in (-1,1440,True,1.5,float('nan'),float('inf')):
            with self.assertRaises(ValueError):self.call('clock',minute=minute)
            self.assertEqual(before,self.city.snapshot())
        invalid=copy.deepcopy(before);invalid['state']['sceneTimeSeconds']=float('nan')
        with self.assertRaises(ValueError):City.restore(invalid)


if __name__=='__main__':unittest.main()
