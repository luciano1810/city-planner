"""Map confirmation and explicit save-slot semantics, including failure recovery."""
import gzip
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tests.test_city import flat_world
from city.service import CityService


class MapWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.service = CityService(self.folder.name)
        self.world = self.service.register(flat_world())

    def create(self):
        return self.service.handle('create', dict(worldId=self.world, saveTerrain=True))

    def snapshot(self, name):
        with gzip.open(Path(self.folder.name) / (name + '.json.gz'), 'rt') as stream:
            return json.load(stream)

    def test_confirmed_terrain_survives_restart_and_city_changes(self):
        created = self.create()
        initial = created['initialSave']['name']
        self.service.handle('command', dict(id=created['id'], command=dict(type='road', points=[[500,500],[1500,500]])))
        self.service.handle('save', dict(id=created['id'], name='海湾新城', mode='new'))
        restarted = CityService(self.folder.name)
        original = restarted.handle('load', dict(name=initial))
        planned = restarted.handle('load', dict(name='海湾新城'))
        self.assertEqual(original['city']['roads'], [])
        self.assertIsNone(original['saveName'])
        self.assertEqual(len(planned['city']['roads']), 1)
        self.assertEqual(planned['saveName'], '海湾新城')
        self.assertEqual(planned['city']['name'], '海湾新城')
        self.assertEqual(original['terrain']['elevation'], planned['terrain']['elevation'])
        self.assertEqual(len(restarted.handle('saves', {})['saves']), 2)

    def test_new_save_never_replaces_existing_and_overwrite_is_explicit(self):
        key = self.create()['id']
        self.service.handle('save', dict(id=key, name='方案一', mode='new'))
        old = (Path(self.folder.name) / '方案一.json.gz').read_bytes()
        self.service.handle('command', dict(id=key, command=dict(type='road', points=[[500,500],[1500,500]])))
        with self.assertRaisesRegex(ValueError, '同名存档'):
            self.service.handle('save', dict(id=key, name='方案一', mode='new'))
        self.assertEqual((Path(self.folder.name) / '方案一.json.gz').read_bytes(), old)
        self.service.handle('save', dict(id=key, name='方案二', mode='new'))
        self.assertEqual(self.snapshot('方案一')['state']['roads'], [])
        self.service.handle('save', dict(id=key, name='方案一', mode='overwrite'))
        self.assertEqual(len(self.snapshot('方案一')['state']['roads']), 1)
        self.assertEqual(self.service.cities[key].s['name'], '方案一')
        with self.assertRaisesRegex(ValueError, '不存在'):
            self.service.handle('save', dict(id=key, name='不存在', mode='overwrite'))

    def test_first_save_requires_valid_name(self):
        key = self.create()['id']
        for name in (None, '', '   ', '../outside', 'a' * 61):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.service.handle('save', dict(id=key, name=name, mode='new'))
        with self.assertRaises(ValueError):
            self.service.handle('save', dict(id=key, name='城市', mode='replace'))
        self.assertEqual(len(self.service.handle('saves', {})['saves']), 1)

    def test_autosaves_and_branches_do_not_overwrite_other_maps(self):
        first, second = self.create(), self.create()
        one = self.service.handle('checkpoint', dict(id=first['id']))
        two = self.service.handle('checkpoint', dict(id=second['id']))
        self.assertNotEqual(one['name'], two['name'])
        self.assertNotEqual(first['initialSave']['name'], second['initialSave']['name'])
        again = self.service.handle('checkpoint', dict(id=first['id']))
        self.assertEqual(one['name'], again['name'])
        self.service.handle('save', dict(id=first['id'], name='原方案', mode='new'))
        old = (Path(self.folder.name) / '原方案.json.gz').read_bytes()
        branch = self.service.handle('branch', dict(id=first['id'], name='分支'))
        three = self.service.handle('checkpoint', dict(id=branch['id']))
        self.assertNotIn(three['name'], (one['name'], two['name']))
        self.assertEqual((Path(self.folder.name) / '原方案.json.gz').read_bytes(), old)

    def test_disk_failure_keeps_existing_save_and_session_name(self):
        key = self.create()['id']
        self.service.handle('save', dict(id=key, name='原名', mode='new'))
        self.service.handle('save', dict(id=key, name='另一方案', mode='new'))
        old = (Path(self.folder.name) / '原名.json.gz').read_bytes()
        with patch('city.service.os.replace', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                self.service.handle('save', dict(id=key, name='原名', mode='overwrite'))
        self.assertEqual((Path(self.folder.name) / '原名.json.gz').read_bytes(), old)
        self.assertEqual(self.service.cities[key].s['name'], '另一方案')
        self.assertEqual(list(Path(self.folder.name).glob('.saving-*')), [])

    def test_failed_initial_save_does_not_publish_session(self):
        with patch.object(self.service, 'save', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                self.create()
        self.assertEqual(self.service.cities, {})
        self.assertEqual(self.service.handle('saves', {})['saves'], [])

    def test_existing_saves_without_metadata_remain_loadable(self):
        created = self.create()
        snapshot = self.service.cities[created['id']].snapshot()
        with gzip.open(Path(self.folder.name) / '旧存档.json.gz', 'wt') as stream:
            json.dump(snapshot, stream)
        loaded = self.service.handle('load', dict(name='旧存档'))
        self.assertEqual(loaded['saveName'], '旧存档')
        self.assertEqual(loaded['city']['roads'], [])
