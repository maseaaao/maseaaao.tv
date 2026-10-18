"""Read application-provided DB files, including WAL; never modify the working DB.

The support archive is an observation, not a transactional backup for restoration.
Only comparison booleans/counts leave this process; configuration stays private.
"""
import io
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import urllib.request
import zipfile


def connections(rows):
    return {key: value for key, value in rows.items()
            if value.get('moduleInstanceType', 'connection') == 'connection'}


def project(value):
    return {key: value.get(key) for key in
            ('moduleId', 'moduleVersionId', 'enabled', 'label', 'config', 'secrets')}


def compare(stored, live):
    stored = connections(stored)
    return (stored.keys() == live.keys()
            and all(project(stored[key]) == project(value) for key, value in live.items()))


def inspect(base_url, live):
    with urllib.request.urlopen(base_url + '/int/export/support', timeout=12) as response:
        raw = response.read(32 * 1024 * 1024 + 1)
    if len(raw) > 32 * 1024 * 1024:
        raise ValueError('archive limit')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        # Never extract arbitrary paths or overwrite an application's files.
        with tempfile.TemporaryDirectory(prefix='companion-readonly-') as temporary:
            target = Path(temporary).resolve()
            if target.parent != Path(tempfile.gettempdir()).resolve():
                raise ValueError('unexpected temporary directory')
            for name in ('db.sqlite', 'db.sqlite-wal', 'db.sqlite-shm'):
                try:
                    info = archive.getinfo(name)
                except KeyError:
                    if name == 'db.sqlite':
                        raise ValueError('database absent')
                    continue
                if info.file_size > 64 * 1024 * 1024:
                    raise ValueError('database size limit')
                (target / name).write_bytes(archive.read(info))
            db = sqlite3.connect((target / 'db.sqlite').as_uri() + '?mode=ro', uri=True)
            try:
                if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                    raise ValueError('inconsistent archive')
                stored = {key: json.loads(value) for key, value in
                          db.execute('SELECT id, value FROM instances')}
                return {'matchesLive': compare(stored, live),
                        'storedConnections': len(connections(stored)),
                        'source': 'companion-application-files', 'integrity': 'ok'}
            finally:
                db.close()


if __name__ == '__main__':
    try:
        sys.stdin.reconfigure(encoding='utf-8')
        request = json.load(sys.stdin)
        print(json.dumps(inspect(request['baseUrl'], request['instances'])))
    except Exception:
        # Exception messages may contain private paths/addresses; keep output generic.
        print(json.dumps({'verified': False, 'reason': 'Application database observation unavailable'}))
        sys.exit(1)
