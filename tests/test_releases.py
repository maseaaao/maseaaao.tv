"""Exercise bundle releases and real filesystem transactions without live applications."""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tooling/windows'))
import release_bundle as bundle
import update_releases as updater

spec = importlib.util.spec_from_file_location('packager', ROOT / 'tooling/bundle-release.py')
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


def make_bundle(products, tag='v1.0.0'):
    """products: {id: (version, files or None, requires or None)} -> (release, manifest, zip)."""
    payload, entries = {}, []
    for product, (version, files, requires) in products.items():
        files = files or {'index.html': f'{product} {version}'.encode()}
        entries.append(dict(id=product, version=version, activation='Manual activation required',
                            requires=requires or {}))
        for name, data in files.items():
            payload[f'{product}/{name}'] = data
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, 'w') as stream:
        for name, data in sorted(payload.items()):
            stream.writestr(name, data)
    data = archive.getvalue()
    doc = dict(schemaVersion=2, runtimeLayout=1, tag=tag, commit='a' * 40, products=entries,
               files=[dict(path=n, size=len(b), sha256=bundle.sha256(b)) for n, b in sorted(payload.items())],
               archive=dict(name=f'maseaaao-{tag[1:]}.zip', size=len(data), sha256=bundle.sha256(data)))
    return dict(tag_name=tag, draft=False, prerelease=False, assets=[]), doc, data


class FakeGitHub:
    def __init__(self, entries):
        self.entries = {entry[0]['tag_name']: entry for entry in entries}
        self.downloads = []

    def releases(self):
        return [r for r, _, _ in self.entries.values()]

    def asset(self, release, name, limit):
        self.downloads.append(name)
        _, doc, data = self.entries[release['tag_name']]
        result = bundle.json_bytes(doc) if name.endswith('.manifest.json') else data
        if len(result) > limit:
            raise ValueError('Too large')
        return result


class ReleasesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'runtime'
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()
        self.addCleanup(self.output.__exit__, None, None, None)

    def catalog(self, products):
        return dict(schemaVersion=2, repository='owner/repo',
                    products=[dict(id=p) for p in products])

    def install(self, entries, pin=None):
        client = FakeGitHub(entries)
        release = updater.select_bundle(client.releases(), pin)
        _, doc, _ = client.entries[release['tag_name']]
        products = [p['id'] for p in doc['products']]
        with updater.locked(self.root, 'owner/repo'):
            state = updater.installed(self.root)
            updater.verify_current(self.root, state)
            changes, state, archive = updater.plan(client, release, products, state)
            updater.apply_changes(self.root, client, release, changes, state, archive)
        return client

    def test_latest_bundle_is_semver_and_ignores_drafts_prereleases_and_legacy_tags(self):
        entries = [make_bundle({'alpha': ('1.9.0', None, None)}, tag='v1.9.0'),
                   make_bundle({'alpha': ('1.10.0', None, None)}, tag='v1.10.0'),
                   make_bundle({'alpha': ('2.0.0', None, None)}, tag='v2.0.0'),
                   make_bundle({'alpha': ('3.0.0', None, None)}, tag='v3.0.0')]
        entries[2][0]['draft'] = True
        entries[3][0]['prerelease'] = True
        legacy = dict(tag_name='alpha-v9.9.9', draft=False, prerelease=False, assets=[])
        rows = [e[0] for e in entries] + [legacy]
        self.assertEqual(updater.select_bundle(rows)['tag_name'], 'v1.10.0')
        self.assertEqual(updater.select_bundle(rows, '1.9.0')['tag_name'], 'v1.9.0')
        with self.assertRaises(ValueError):
            updater.select_bundle(rows, '9.0.0')
        with self.assertRaises(ValueError):
            updater.select_bundle([legacy])

    def test_all_cli_plans_without_writes_then_installs_all_and_is_idempotent(self):
        entries = [make_bundle({'alpha': ('1.0.0', None, None), 'beta': ('2.0.0', None, None)})]
        client = FakeGitHub(entries)
        with patch.object(updater, 'load_catalog', return_value=self.catalog(['alpha', 'beta'])), \
                patch.object(updater, 'GitHub', return_value=client):
            updater.main(['--all', '--root', str(self.root)])
            self.assertFalse(self.root.exists())
            updater.main(['--all', '--root', str(self.root), '--apply'])
            self.assertEqual(set(updater.installed(self.root)['products']), {'alpha', 'beta'})
            client.downloads.clear()
            updater.main(['--all', '--root', str(self.root), '--apply'])
            self.assertFalse(any(n.endswith('.zip') for n in client.downloads))

    def test_product_cli_installs_only_that_folder_and_version_pin_selects_older_bundle(self):
        older = make_bundle({'alpha': ('1.0.0', {'old.txt': b'old'}, None)}, tag='v1.0.0')
        newer = make_bundle({'alpha': ('2.0.0', None, None), 'beta': ('1.0.0', None, None)}, tag='v2.0.0')
        with patch.object(updater, 'load_catalog', return_value=self.catalog(['alpha', 'beta'])), \
                patch.object(updater, 'GitHub', return_value=FakeGitHub([older, newer])):
            updater.main(['--product', 'alpha', '--version', '1.0.0', '--root', str(self.root), '--apply'])
        state = updater.installed(self.root)['products']
        self.assertEqual(set(state), {'alpha'})
        self.assertEqual(state['alpha']['version'], '1.0.0')
        self.assertTrue((self.root / 'current/alpha/old.txt').exists())

    def test_complete_replacement_removes_stale_files_preserves_other_product_and_rolls_back(self):
        self.install([make_bundle({'alpha': ('1.0.0', {'old.txt': b'old'}, None),
                                   'beta': ('1.0.0', None, None)})])
        self.install([make_bundle({'alpha': ('2.0.0', {'new.txt': b'new'}, None),
                                   'beta': ('1.0.0', None, None)}, tag='v2.0.0')])
        self.assertFalse((self.root / 'current/alpha/old.txt').exists())
        self.assertTrue((self.root / 'current/beta/index.html').exists())
        snapshot = next((self.root / 'previous').iterdir()).name
        with updater.locked(self.root, 'owner/repo'):
            updater.rollback(self.root, snapshot)
        self.assertEqual((self.root / 'current/alpha/old.txt').read_bytes(), b'old')
        self.assertFalse((self.root / 'current/alpha/new.txt').exists())

    def test_bad_bundle_archive_does_not_partially_install(self):
        self.install([make_bundle({'alpha': ('1.0.0', None, None), 'beta': ('1.0.0', None, None)})])
        row, doc, data = make_bundle({'alpha': ('2.0.0', None, None), 'beta': ('2.0.0', None, None)},
                                     tag='v2.0.0')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            self.install([(row, doc, data + b'corrupted')])
        self.assertEqual(updater.installed(self.root)['products']['alpha']['version'], '1.0.0')
        self.assertEqual(updater.installed(self.root)['products']['beta']['version'], '1.0.0')

    def test_new_bundle_updates_files_without_product_version_bump(self):
        self.install([make_bundle({'alpha': ('1.0.0', {'index.html': b'old'}, None)}, tag='v1.0.0')])
        self.install([make_bundle({'alpha': ('1.0.0', {'index.html': b'new'}, None)}, tag='v1.1.0')])
        self.assertEqual((self.root / 'current/alpha/index.html').read_bytes(), b'new')
        self.assertEqual(updater.installed(self.root)['products']['alpha']['tag'], 'v1.1.0')

    def test_local_changes_are_preserved_and_block_update(self):
        self.install([make_bundle({'alpha': ('1.0.0', None, None)})])
        file = self.root / 'current/alpha/index.html'
        file.write_bytes(b'local changes')
        with self.assertRaisesRegex(ValueError, 'changed/missing'):
            self.install([make_bundle({'alpha': ('2.0.0', None, None)}, tag='v2.0.0')])
        self.assertEqual(file.read_bytes(), b'local changes')

    def test_unmanaged_files_and_nonempty_destination_are_rejected(self):
        self.root.mkdir()
        (self.root / 'personal.txt').write_text('private')
        with self.assertRaisesRegex(ValueError, 'empty dedicated'):
            self.install([make_bundle({'alpha': ('1.0.0', None, None)})])
        self.assertEqual((self.root / 'personal.txt').read_text(), 'private')

    def test_downgrade_mutated_version_and_unmet_dependency_are_rejected(self):
        self.install([make_bundle({'alpha': ('2.0.0', None, None)})])
        rows = [make_bundle({'alpha': ('1.0.0', None, None)}, tag='v2.0.0'),
                make_bundle({'alpha': ('2.0.0', {'index.html': b'mutated'}, None)}, tag='v1.0.0'),
                make_bundle({'alpha': ('2.0.0', None, None), 'beta': ('1.0.0', None, {'alpha': '3.0.0'})},
                            tag='v2.0.0')]
        for entry in rows:
            with self.assertRaises(ValueError):
                self.install([entry])
        self.assertEqual(set(updater.installed(self.root)['products']), {'alpha'})

    def test_recovery_after_interruption_between_renames(self):
        self.install([make_bundle({'alpha': ('1.0.0', None, None)})])
        backup = self.root / 'previous/interrupted'
        backup.parent.mkdir(exist_ok=True)
        (self.root / 'current').rename(backup)
        source = self.root / '.staging/interrupted/current'
        source.mkdir(parents=True)
        bundle.write_json(self.root / 'transaction.json',
                          dict(source='.staging/interrupted/current', backup='previous/interrupted',
                               hadCurrent=True))
        with updater.locked(self.root, 'owner/repo'):
            updater.recover(self.root)
        self.assertEqual(updater.installed(self.root)['products']['alpha']['version'], '1.0.0')
        self.assertFalse((self.root / 'transaction.json').exists())

    def test_file_lock_prevents_concurrent_update(self):
        with updater.locked(self.root, 'owner/repo'):
            with self.assertRaisesRegex(ValueError, 'Another updater'):
                with updater.locked(self.root, 'owner/repo'):
                    pass

    def test_failed_switch_restores_original(self):
        self.install([make_bundle({'alpha': ('1.0.0', None, None)})])
        original = Path.rename

        def fail_candidate(path, target):
            if path.name == 'current' and path.parent.name.startswith('update-'):
                raise PermissionError('Simulated locked directory')
            return original(path, target)

        with patch.object(Path, 'rename', fail_candidate), self.assertRaises(PermissionError):
            self.install([make_bundle({'alpha': ('2.0.0', None, None)}, tag='v2.0.0')])
        self.assertEqual(updater.installed(self.root)['products']['alpha']['version'], '1.0.0')

    def test_failed_first_install_can_be_retried(self):
        original = Path.rename

        def fail_candidate(path, target):
            if path.name == 'current':
                raise PermissionError('Simulated first install failure')
            return original(path, target)

        with patch.object(Path, 'rename', fail_candidate), self.assertRaises(PermissionError):
            self.install([make_bundle({'alpha': ('1.0.0', None, None)})])
        self.assertFalse((self.root / 'transaction.json').exists())
        self.install([make_bundle({'alpha': ('1.0.0', None, None)})])
        self.assertTrue((self.root / 'current/alpha/index.html').exists())

    def test_redirect_removes_auth_from_download_host(self):
        import urllib.request
        request = urllib.request.Request('https://api.github.com/repos/owner/repo/releases/assets/1',
                                         headers={'Authorization': 'Bearer test-only'})
        redirected = updater.Redirect().redirect_request(
            request, None, 302, 'Found', {}, 'https://release-assets.githubusercontent.com/file')
        self.assertIsNone(redirected.get_header('Authorization'))

    def test_missing_bundle_metadata_is_not_silently_skipped(self):
        entries = [make_bundle({'alpha': ('1.0.0', None, None)})]
        client = FakeGitHub(entries)
        release = updater.select_bundle(client.releases())
        with patch.object(client, 'asset', side_effect=ValueError('missing metadata')), \
                self.assertRaises(ValueError):
            updater.plan(client, release, ['alpha'], updater.installed(self.root))
        self.assertFalse(self.root.exists())

    def test_windows_paths_case_collisions_and_bundle_manifest_rejected(self):
        for name in ['../escape', '/absolute', 'C:/absolute', 'x\\y', 'x:ads', 'CON.txt', 'a./b', 'a /b']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                bundle.safe_name(name)
        _, doc, _ = make_bundle({'alpha': ('1.0.0', {'A.txt': b'1', 'a.txt': b'2'}, None)})
        with self.assertRaises(ValueError):
            bundle.validate_bundle_manifest(doc)
        _, doc, data = make_bundle({'alpha': ('1.0.0', None, None)})
        with self.assertRaises(ValueError):
            bundle.validate_bundle_manifest(dict(doc, tag='alpha-v1.0.0'))
        with self.assertRaises(ValueError):
            bundle.product_manifest(dict(doc, products=[dict(id='alpha', version='1.0.0')]), 'beta')

    def test_verify_subset_checksum_and_symlink_rejected(self):
        _, doc, data = make_bundle({'alpha': ('1.0.0', None, None)})
        alpha = bundle.product_manifest(doc, 'alpha')
        archive = Path(self.temp.name) / 'bad.zip'
        archive.write_bytes(data)
        alpha['files'][0]['sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'checksum'):
            updater.verify_subset(archive, alpha, Path(self.temp.name) / 'extract')
        with zipfile.ZipFile(archive, 'w') as stream:
            entry = zipfile.ZipInfo('alpha/index.html')
            entry.external_attr = 0o120777 << 16
            stream.writestr(entry, b'alpha 1.0.0')
        with self.assertRaises(ValueError):
            updater.verify_subset(archive, alpha, Path(self.temp.name) / 'extract2')

    def test_network_pagination_and_non_github_url(self):
        client = updater.GitHub('owner/repo')
        with patch.object(client, 'fetch', side_effect=[json.dumps([{}] * 100).encode(), b'[]']) as fetch:
            self.assertEqual(len(client.releases()), 100)
            self.assertIn('page=2', fetch.call_args.args[0])
        for url in ['http://github.com/file', 'https://evil.example/file', 'https://***@evil.example/file']:
            with self.assertRaises(ValueError):
                updater.require_github_url(url)

    def test_catalog_all_current_versions_validate(self):
        for product in packager.catalog()['products']:
            version = bundle.read_json(ROOT / product.get('versionFile', product['path'] + '/package.json'))['version']
            bundle.version_tuple(version)

    def test_packager_roundtrip_folders_hidden_files_and_bootstrap(self):
        root = Path(self.temp.name) / 'repository'
        for name, data in {
            'CHANGELOG.md': b'# Bundle\n\n## 1.0.0\n\n- Everything\n',
            'app/package.json': b'{"version":"1.0.0"}',
            'app/dist/.well-known/test.txt': b'hidden',
            'app/dist/picture.png': b'\x89PNGbinary',
            'packages/design/licenses/Unbounded-OFL.txt': b'license',
            'docs/windows-releases.md': b'Updater instructions',
            'tooling/windows/update_releases.py': b'# updater',
        }.items():
            file = root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(data)
        product = dict(id='alpha', path='app', files=[dict(source='app/dist', target='.')],
                       activation='reload', requires={})
        bundle.write_json(root / 'tooling/release-products.json',
                          dict(schemaVersion=2, products=[product], repository='owner/repo'))
        with patch.object(subprocess, 'check_output', return_value='a' * 40):
            output = packager.package('v1.0.0', root=root)
        doc = bundle.read_json(output / 'maseaaao-1.0.0.manifest.json')
        bundle.validate_bundle_manifest(doc)
        packager.verify_bundle(output / doc['archive']['name'], doc)
        paths = [i['path'] for i in doc['files']]
        self.assertIn('alpha/.well-known/test.txt', paths)
        self.assertTrue(all(p.startswith(('alpha/', 'updater/')) for p in paths))
        with zipfile.ZipFile(output / 'maseaaao-1.0.0.zip') as stream:
            products = json.loads(stream.read('updater/products.json'))
        self.assertEqual(products['schemaVersion'], 2)


if __name__ == '__main__':
    unittest.main()
