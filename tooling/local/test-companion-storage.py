import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from importlib.util import spec_from_file_location, module_from_spec

spec = spec_from_file_location('storage', Path(__file__).with_name('compare-companion-storage.py'))
storage = module_from_spec(spec)
spec.loader.exec_module(storage)


class StorageChecks(unittest.TestCase):
    def setUp(self):
        self.config = {'moduleInstanceType': 'connection', 'moduleId': 'local-test',
                       'moduleVersionId': '1', 'enabled': True, 'label': 'Test',
                       'config': {'directory': 'C:/Проекты/стрим', 'a': 1}, 'secrets': {'test': 'fixture'}}

    def test_surface_and_key_order_do_not_create_false_warning(self):
        reordered = {**self.config, 'config': {'a': 1, 'directory': 'C:/Проекты/стрим'}}
        self.assertTrue(storage.compare({'c': reordered, 's': {'moduleInstanceType': 'surface'}}, {'c': self.config}))

    def test_missing_extra_or_changed_connection_is_detected(self):
        live = {'c': self.config}
        for stored in ({}, {'c': self.config, 'extra': self.config},
                       {'c': {**self.config, 'moduleVersionId': '2'}},
                       {'c': {**self.config, 'secrets': {'test': 'changed'}}}):
            self.assertFalse(storage.compare(stored, live))

    def test_reads_database_from_application_archive(self):
        with tempfile.TemporaryDirectory(prefix='companion-readonly-test-') as directory:
            target = Path(directory).resolve()
            self.assertEqual(target.parent, Path(tempfile.gettempdir()).resolve())
            db = sqlite3.connect(target / 'db.sqlite')
            db.execute('CREATE TABLE instances (id TEXT, value TEXT)')
            db.execute('INSERT INTO instances VALUES (?, ?)', ('c', json.dumps(self.config)))
            db.commit()
            db.close()
            raw = io.BytesIO()
            with zipfile.ZipFile(raw, 'w') as archive:
                archive.write(target / 'db.sqlite', 'db.sqlite')
                archive.writestr('../untrusted.txt', 'must never be extracted')
            with patch.object(storage.urllib.request, 'urlopen', return_value=io.BytesIO(raw.getvalue())):
                result = storage.inspect('http://local-test', {'c': self.config})
            self.assertTrue(result['matchesLive'])
            self.assertEqual(result['storedConnections'], 1)
            self.assertEqual(result['integrity'], 'ok')


if __name__ == '__main__':
    unittest.main()
