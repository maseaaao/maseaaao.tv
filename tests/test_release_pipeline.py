"""Offline bundle packaging checks; never contact GitHub or install applications."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pipeline_packager', ROOT / 'tooling/bundle-release.py')
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)

FILES = {
    'CHANGELOG.md': '# Bundle\n\n## 1.0.0\n\nReal change\n',
    'app/package.json': '{"version":"1.0.0"}',
    'app/dist/index.html': 'built',
    'packages/design/licenses/Unbounded-OFL.txt': 'license',
    'docs/windows-releases.md': 'Manual only',
    'tooling/windows/update.py': '# bootstrap',
}
PRODUCT = dict(id='alpha', path='app', files=[dict(source='app/dist', target='.')],
               activation='reload', requires={})


def fixture(root):
    for name, data in FILES.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(data, encoding='utf-8')
    (root / 'tooling/release-products.json').write_text(
        json.dumps(dict(schemaVersion=2, repository='owner/repo', products=[PRODUCT])))


class BundleTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        fixture(self.root)
        with patch.object(subprocess, 'check_output', return_value='a' * 40), \
                contextlib.redirect_stdout(io.StringIO()):
            self.output = packager.package('v1.0.0', self.root)

    def test_bundle_assets_are_complete_and_prefixed(self):
        names = {p.name for p in self.output.iterdir()}
        self.assertEqual(names, {'maseaaao-1.0.0.zip', 'maseaaao-1.0.0.manifest.json',
                                 'SHA256SUMS', 'notes.md'})
        doc = json.loads((self.output / 'maseaaao-1.0.0.manifest.json').read_text())
        self.assertEqual(doc['schemaVersion'], 2)
        self.assertEqual(doc['tag'], 'v1.0.0')
        self.assertEqual(doc['commit'], 'a' * 40)
        self.assertEqual(doc['products'][0]['id'], 'alpha')
        self.assertEqual(doc['products'][0]['version'], '1.0.0')
        paths = [f['path'] for f in doc['files']]
        self.assertIn('alpha/index.html', paths)
        self.assertIn('alpha/licenses/Unbounded-OFL.txt', paths)
        self.assertTrue(all(p.startswith(('alpha/', 'updater/')) for p in paths))
        self.assertEqual(doc['archive']['name'], 'maseaaao-1.0.0.zip')
        with zipfile.ZipFile(self.output / 'maseaaao-1.0.0.zip') as archive:
            self.assertEqual(set(archive.namelist()), set(paths))
        with zipfile.ZipFile(self.output / 'maseaaao-1.0.0.zip') as archive:
            self.assertIn('updater/products.json', archive.namelist())
            self.assertIn('updater/update.py', archive.namelist())

    def test_single_file_target_has_no_trailing_slash(self):
        product = dict(PRODUCT, files=[dict(source='app/dist/index.html', target='nested/page.html')])
        files = packager.collect(product, '1.0.0', self.root)
        self.assertEqual(files['alpha/nested/page.html'], b'built')

    def test_duplicate_case_colliding_and_unsafe_targets_rejected(self):
        for target in ['index.html', 'INDEX.html', '../escape', '/absolute', 'C:/ads']:
            product = dict(PRODUCT, files=[PRODUCT['files'][0],
                dict(source='app/dist/index.html', target=target)])
            with self.subTest(target=target), self.assertRaises(ValueError):
                packager.collect(product, '1.0.0', self.root)

    def test_bundle_zip_is_byte_deterministic(self):
        first = (self.output / 'maseaaao-1.0.0.zip').read_bytes()
        with patch.object(subprocess, 'check_output', return_value='a' * 40), \
                contextlib.redirect_stdout(io.StringIO()):
            second = packager.package('v1.0.0', self.root) / 'maseaaao-1.0.0.zip'
        self.assertEqual(first, second.read_bytes())

    def test_package_rejects_tampered_files_and_manifest(self):
        doc = json.loads((self.output / 'maseaaao-1.0.0.manifest.json').read_text())
        doc['files'][0]['sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'checksum'):
            packager.verify_bundle(self.output / 'maseaaao-1.0.0.zip', doc)
        with zipfile.ZipFile(self.output / 'maseaaao-1.0.0.zip', 'a') as stream:
            stream.writestr('alpha/extra.txt', b'extra')
        doc['files'][0]['sha256'] = packager.sha256(b'built')
        with self.assertRaisesRegex(ValueError, 'mismatch'):
            packager.verify_bundle(self.output / 'maseaaao-1.0.0.zip', doc)

    def test_tag_and_changelog_are_required(self):
        for tag in ['1.0.0', 'alpha-v1.0.0', 'v1.0', 'v01.0.0']:
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                packager.bundle_version(tag)
        (self.root / 'CHANGELOG.md').write_text('## 1.0.0\n\n## 0.9.0\nOlder\n')
        with self.assertRaisesRegex(ValueError, 'CHANGELOG'):
            packager.notes_for('1.0.0', self.root)

    def test_missing_build_output_and_old_catalog_schema_are_rejected(self):
        shutil.rmtree(self.root / 'app/dist')
        with self.assertRaisesRegex(ValueError, 'Build product first'):
            packager.collect(PRODUCT, '1.0.0', self.root)
        (self.root / 'tooling/release-products.json').write_text(
            json.dumps(dict(schemaVersion=1, repository='owner/repo', products=[PRODUCT])))
        with self.assertRaisesRegex(ValueError, 'catalog schema'):
            packager.catalog(self.root)


if __name__ == '__main__':
    unittest.main()
