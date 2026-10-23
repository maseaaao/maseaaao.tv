"""Exercise release packages and real filesystem transactions without live applications."""

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

spec = importlib.util.spec_from_file_location('packager', ROOT / 'tooling/package-release.py')
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


def make_release(product, version, files=None, requires=None):
    files = files or {'index.html': f'{product} {version}'.encode()}
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, 'w') as stream:
        for name, data in files.items():
            stream.writestr(name, data)
    data = archive.getvalue()
    tag = f'{product}-v{version}'
    doc = dict(schemaVersion=1, runtimeLayout=1, product=product, version=version, tag=tag,
               activation='Manual activation required', requires=requires or {},
               files=[dict(path=n, size=len(b), sha256=bundle.sha256(b)) for n, b in files.items()],
               archive=dict(name=f'{product}-{version}.zip', size=len(data), sha256=bundle.sha256(data)))
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
        self.root = Path(self.temp.name) / 'runtime'
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()

    def tearDown(self):
        self.output.__exit__(None, None, None)
        self.temp.cleanup()

    def install(self, entries):
        client = FakeGitHub(entries)
        products = list(dict.fromkeys(e[1]['product'] for e in entries))
        releases = updater.select_releases(client.releases(), products, all_products=True)
        with updater.locked(self.root, 'owner/repo'):
            state = updater.installed(self.root)
            updater.verify_current(self.root, state)
            changes, state = updater.plan(client, releases, state)
            updater.apply_changes(self.root, client, changes, state)
        return client

    def test_latest_is_semver_per_product_and_excludes_drafts_prereleases(self):
        entries = [make_release('alpha', v) for v in ['1.9.0', '1.10.0', '2.0.0', '3.0.0']]
        entries[2][0]['draft'] = True
        entries[3][0]['prerelease'] = True
        entries.append(make_release('beta', '1.0.0'))
        result = updater.select_releases([e[0] for e in entries], ['alpha', 'beta', 'missing'], all_products=True)
        self.assertEqual(result['alpha']['tag_name'], 'alpha-v1.10.0')
        self.assertEqual(set(result), {'alpha', 'beta'})

    def test_exact_version_selection_and_missing_version(self):
        rows = [make_release('alpha', v)[0] for v in ['1.0.0', '2.0.0']]
        self.assertEqual(updater.select_releases(rows, ['alpha'], {'alpha': '1.0.0'})['alpha']['tag_name'], 'alpha-v1.0.0')
        with self.assertRaises(ValueError):
            updater.select_releases(rows, ['alpha'], {'alpha': '9.0.0'})

    def test_bundle_cli_installs_pinned_versions(self):
        entries = [make_release('alpha', '1.0.0'), make_release('alpha', '2.0.0'), make_release('beta', '1.0.0')]
        catalog = dict(repository='owner/repo', products=[dict(id=p) for p in ['alpha', 'beta']])
        file = Path(self.temp.name) / 'set.json'
        bundle.write_json(file, dict(schemaVersion=1, repository='owner/repo', products={'alpha': '1.0.0', 'beta': '1.0.0'}))
        with patch.object(updater, 'load_catalog', return_value=catalog), patch.object(updater, 'GitHub', return_value=FakeGitHub(entries)):
            updater.main(['--bundle', str(file), '--root', str(self.root), '--apply'])
        self.assertEqual(updater.installed(self.root)['products']['alpha']['version'], '1.0.0')

    def test_all_cli_plans_without_writes_then_installs_all_and_is_idempotent(self):
        entries = [make_release('alpha', '1.0.0'), make_release('beta', '2.0.0')]
        catalog = dict(repository='owner/repo', products=[dict(id=p) for p in ['alpha', 'beta']])
        client = FakeGitHub(entries)
        with patch.object(updater, 'load_catalog', return_value=catalog), patch.object(updater, 'GitHub', return_value=client):
            updater.main(['--all', '--root', str(self.root)])
            self.assertFalse(self.root.exists())
            updater.main(['--all', '--root', str(self.root), '--apply'])
            self.assertEqual(set(updater.installed(self.root)['products']), {'alpha', 'beta'})
            client.downloads.clear()
            updater.main(['--all', '--root', str(self.root), '--apply'])
            self.assertFalse(any(n.endswith('.zip') for n in client.downloads))

    def test_complete_replacement_removes_stale_files_preserves_other_product_and_rolls_back(self):
        self.install([make_release('alpha', '1.0.0', {'old.txt': b'old'}), make_release('beta', '1.0.0')])
        self.install([make_release('alpha', '2.0.0', {'new.txt': b'new'})])
        self.assertFalse((self.root / 'current/alpha/old.txt').exists())
        self.assertTrue((self.root / 'current/beta/index.html').exists())
        snapshot = next((self.root / 'previous').iterdir()).name
        with updater.locked(self.root, 'owner/repo'):
            updater.rollback(self.root, snapshot)
        self.assertEqual((self.root / 'current/alpha/old.txt').read_bytes(), b'old')
        self.assertFalse((self.root / 'current/alpha/new.txt').exists())

    def test_bad_second_archive_does_not_partially_install_all(self):
        self.install([make_release('alpha', '1.0.0'), make_release('beta', '1.0.0')])
        first = make_release('alpha', '2.0.0')
        row, doc, data = make_release('beta', '2.0.0')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            self.install([first, (row, doc, data + b'corrupted')])
        self.assertEqual(updater.installed(self.root)['products']['alpha']['version'], '1.0.0')
        self.assertEqual(updater.installed(self.root)['products']['beta']['version'], '1.0.0')

    def test_local_changes_are_preserved_and_block_update(self):
        self.install([make_release('alpha', '1.0.0')])
        file = self.root / 'current/alpha/index.html'
        file.write_bytes(b'local changes')
        with self.assertRaisesRegex(ValueError, 'changed/missing'):
            self.install([make_release('alpha', '2.0.0')])
        self.assertEqual(file.read_bytes(), b'local changes')

    def test_unmanaged_files_and_nonempty_destination_are_rejected(self):
        self.root.mkdir()
        (self.root / 'personal.txt').write_text('private')
        with self.assertRaisesRegex(ValueError, 'empty dedicated'):
            self.install([make_release('alpha', '1.0.0')])
        self.assertEqual((self.root / 'personal.txt').read_text(), 'private')

    def test_dependencies_downgrade_and_mutated_version_are_rejected(self):
        self.install([make_release('alpha', '2.0.0')])
        for entry in [make_release('alpha', '1.0.0'), make_release('alpha', '2.0.0', {'index.html': b'mutated'}),
                      make_release('beta', '1.0.0', requires={'alpha': '3.0.0'})]:
            with self.assertRaises(ValueError):
                self.install([entry])
        self.assertEqual(set(updater.installed(self.root)['products']), {'alpha'})

    def test_recovery_after_interruption_between_renames(self):
        self.install([make_release('alpha', '1.0.0')])
        backup = self.root / 'previous/interrupted'
        backup.parent.mkdir(exist_ok=True)
        (self.root / 'current').rename(backup)
        source = self.root / '.staging/interrupted/current'
        source.mkdir(parents=True)
        bundle.write_json(self.root / 'transaction.json', dict(source='.staging/interrupted/current', backup='previous/interrupted', hadCurrent=True))
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
        self.install([make_release('alpha', '1.0.0')])
        original = Path.rename

        def fail_candidate(path, target):
            if path.name == 'current' and path.parent.name.startswith('update-'):
                raise PermissionError('Simulated locked directory')
            return original(path, target)

        with patch.object(Path, 'rename', fail_candidate), self.assertRaises(PermissionError):
            self.install([make_release('alpha', '2.0.0')])
        self.assertEqual(updater.installed(self.root)['products']['alpha']['version'], '1.0.0')

    def test_failed_first_install_can_be_retried(self):
        original = Path.rename

        def fail_candidate(path, target):
            if path.name == 'current':
                raise PermissionError('Simulated first install failure')
            return original(path, target)

        with patch.object(Path, 'rename', fail_candidate), self.assertRaises(PermissionError):
            self.install([make_release('alpha', '1.0.0')])
        self.assertFalse((self.root / 'transaction.json').exists())
        self.install([make_release('alpha', '1.0.0')])
        self.assertTrue((self.root / 'current/alpha/index.html').exists())

    def test_redirect_removes_auth_from_download_host(self):
        import urllib.request
        request = urllib.request.Request('https://api.github.com/repos/owner/repo/releases/assets/1', headers={'Authorization': 'Bearer test-only'})
        redirected = updater.Redirect().redirect_request(request, None, 302, 'Found', {}, 'https://release-assets.githubusercontent.com/file')
        self.assertIsNone(redirected.get_header('Authorization'))

    def test_missing_latest_metadata_is_not_silently_skipped(self):
        entries = [make_release('alpha', '1.0.0')]
        client = FakeGitHub(entries)
        releases = updater.select_releases(client.releases(), ['alpha'], all_products=True)
        with patch.object(client, 'asset', side_effect=ValueError('missing metadata')), self.assertRaises(ValueError):
            updater.plan(client, releases, updater.installed(self.root))
        self.assertFalse(self.root.exists())

    def test_windows_paths_case_collisions_and_zip_extras_rejected(self):
        for name in ['../escape', '/absolute', 'C:/absolute', 'x\\y', 'x:ads', 'CON.txt', 'a./b', 'a /b']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                bundle.safe_name(name)
        _, doc, data = make_release('alpha', '1.0.0', {'A.txt': b'1', 'a.txt': b'2'})
        with self.assertRaises(ValueError):
            bundle.validate_manifest(doc)
        _, doc, data = make_release('alpha', '1.0.0')
        archive = Path(self.temp.name) / 'bad.zip'
        archive.write_bytes(data)
        with zipfile.ZipFile(archive, 'a') as stream:
            stream.writestr('../escape', b'bad')
        with self.assertRaises(ValueError):
            bundle.verify_archive(archive, doc, Path(self.temp.name) / 'extract')

    def test_archive_file_hash_and_symlink_rejected(self):
        _, doc, data = make_release('alpha', '1.0.0')
        archive = Path(self.temp.name) / 'bad.zip'
        with zipfile.ZipFile(archive, 'w') as stream:
            entry = zipfile.ZipInfo('index.html')
            entry.external_attr = 0o120777 << 16
            stream.writestr(entry, b'alpha 1.0.0')
        with self.assertRaises(ValueError):
            bundle.verify_archive(archive, doc)
        archive.write_bytes(data)
        doc['files'][0]['sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'checksum'):
            bundle.verify_archive(archive, doc)

    def test_network_pagination_and_non_github_url(self):
        client = updater.GitHub('owner/repo')
        with patch.object(client, 'fetch', side_effect=[json.dumps([{}] * 100).encode(), b'[]']) as fetch:
            self.assertEqual(len(client.releases()), 100)
            self.assertIn('page=2', fetch.call_args.args[0])
        for url in ['http://github.com/file', 'https://evil.example/file', 'https://github.com@evil.example/file']:
            with self.assertRaises(ValueError):
                updater.require_github_url(url)

    def test_catalog_all_current_versions_validate(self):
        for product in packager.catalog()['products']:
            version = bundle.read_json(ROOT / product.get('versionFile', product['path'] + '/package.json'))['version']
            packager.select(product['tagPrefix'] + version)

    def test_packager_roundtrip_directory_binary_hidden_files_and_bootstrap(self):
        root = Path(self.temp.name) / 'repository'
        for name, data in {
            'app/package.json': b'{"version":"1.0.0"}',
            'app/CHANGELOG.md': b'# App\n\n## 1.0.0\n\n- Release\n',
            'app/dist/.well-known/test.txt': b'hidden',
            'app/dist/picture.png': b'\x89PNGbinary',
            'packages/design/licenses/Unbounded-OFL.txt': b'license',
            'docs/windows-releases.md': b'Updater instructions',
            'tooling/windows/update_releases.py': b'# updater',
        }.items():
            file = root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(data)
        product = dict(id='alpha', tagPrefix='alpha-v', path='app', files=[dict(source='app/dist', target='.')],
                       activation='reload', requires={})
        bundle.write_json(root / 'tooling/release-products.json', dict(schemaVersion=1, products=[product], repository='owner/repo'))
        with patch.object(subprocess, 'check_output', return_value='a' * 40):
            output = packager.package('alpha-v1.0.0', root=root)
        doc = bundle.read_json(output / 'alpha-v1.0.0.manifest.json')
        bundle.verify_archive(output / doc['archive']['name'], doc)
        self.assertIn('.well-known/test.txt', [i['path'] for i in doc['files']])
        with zipfile.ZipFile(output / 'windows-updater.zip') as stream:
            self.assertIn('products.json', stream.namelist())


if __name__ == '__main__':
    unittest.main()
