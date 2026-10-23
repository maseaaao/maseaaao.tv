"""Offline staging/download checks; never contact GitHub or install applications."""
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
spec = importlib.util.spec_from_file_location('pipeline_packager', ROOT / 'tooling/package-release.py')
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class StagingTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.tag = 'alpha-v1.0.0'
        self.sha = 'a' * 40
        files = {
            'app/package.json': '{"version":"1.0.0"}',
            'app/CHANGELOG.md': '## 1.0.0\n\nReal change\n',
            'app/dist/index.html': 'built',
            'packages/design/licenses/Unbounded-OFL.txt': 'license',
            'docs/windows-releases.md': 'Manual only',
            'tooling/windows/update.py': '# bootstrap',
        }
        for name, data in files.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(data, encoding='utf8')
        product = dict(id='alpha', tagPrefix='alpha-v', path='app', files=[dict(source='app/dist', target='.')], activation='reload', requires={}, looseFiles=['index.html'])
        (self.root / 'tooling/release-products.json').write_text(json.dumps(dict(schemaVersion=1, repository='owner/repo', products=[product])))
        with patch.object(subprocess, 'check_output', return_value=self.sha), contextlib.redirect_stdout(io.StringIO()):
            self.output = packager.package(self.tag, self.root)
        self.downloaded = self.root / 'build/downloaded' / self.tag
        shutil.copytree(self.output, self.downloaded, ignore=shutil.ignore_patterns('notes.md'))

    def test_download_rejects_extra_assets(self):
        (self.downloaded / 'unexpected.txt').write_text('extra')
        with self.assertRaisesRegex(ValueError, 'asset set'):
            packager.verify_download(self.tag, self.root)

    def test_transferred_package_is_verified_against_expected_commit_before_remote_use(self):
        packager.verify_package(self.tag, self.root, commit=self.sha)
        for commit in ['', 'b' * 40, 'not-a-sha']:
            with self.subTest(commit=commit), self.assertRaisesRegex(ValueError, 'commit'):
                packager.verify_package(self.tag, self.root, commit=commit)
        (self.output / 'index.html').write_text('tampered')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            packager.verify_package(self.tag, self.root, commit=self.sha)

    def test_select_rejects_empty_changelog_section(self):
        (self.root / 'app/CHANGELOG.md').write_text('## 1.0.0\n\n## 0.9.0\nOlder release\n')
        with self.assertRaisesRegex(ValueError, 'changelog'):
            packager.select(self.tag, self.root)

    def rewrite_checksums(self):
        entries = sorted(p for p in self.output.iterdir() if p.name not in ('notes.md', 'SHA256SUMS'))
        (self.output / 'SHA256SUMS').write_text(''.join(f'{packager.sha256(p.read_bytes())}  {p.name}\n' for p in entries))

    def test_staging_rejects_zip_extras_even_with_matching_outer_checksums(self):
        archive = self.output / 'alpha-1.0.0.zip'
        with zipfile.ZipFile(archive, 'a') as stream:
            stream.writestr('../escape', b'extra')
        manifest_file = self.output / (self.tag + '.manifest.json')
        doc = json.loads(manifest_file.read_text())
        doc['archive'] = dict(name=archive.name, size=archive.stat().st_size, sha256=packager.sha256(archive.read_bytes()))
        manifest_file.write_text(json.dumps(doc))
        self.rewrite_checksums()
        with self.assertRaisesRegex(ValueError, 'ZIP'):
            packager.verify_package(self.tag, self.root, self.sha)

    def test_staging_checks_bootstrap_zip_against_pinned_updater_sources(self):
        with zipfile.ZipFile(self.output / 'windows-updater.zip', 'a') as stream:
            stream.writestr('unexpected.ps1', b'not the pinned bootstrap')
        self.rewrite_checksums()
        with self.assertRaisesRegex(ValueError, 'ZIP'):
            packager.verify_package(self.tag, self.root, self.sha)

    def test_staging_rejects_missing_and_unexpected_assets(self):
        (self.output / 'unexpected.txt').write_text('extra')
        with self.assertRaisesRegex(ValueError, 'asset set'):
            packager.verify_package(self.tag, self.root, self.sha)
        (self.output / 'unexpected.txt').unlink()
        (self.output / 'index.html').unlink()
        with self.assertRaisesRegex(ValueError, 'asset set'):
            packager.verify_package(self.tag, self.root, self.sha)
