"""Install products from the single maseaaao.tv bundle release; Python 3.10+, stdlib only."""

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile

from release_bundle import (ID, MAX_BYTES, json_bytes, product_manifest, read_json, reject_links,
                            safe_name, sha256, validate_bundle_manifest, validate_manifest,
                            version_tuple, write_json)

HERE = Path(__file__).resolve().parent
STATE = 'installed.json'
MARKER = '.maseaaao-runtime.json'


class Redirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        require_github_url(newurl)
        redirected = super().redirect_request(request, fp, code, msg, headers, newurl)
        if urllib.parse.urlsplit(newurl).netloc != urllib.parse.urlsplit(request.full_url).netloc:
            redirected.remove_header('Authorization')
        return redirected


def require_github_url(url):
    parts = urllib.parse.urlsplit(url)
    host = parts.hostname or ''
    if (parts.scheme != 'https' or parts.username or parts.password or parts.port not in (None, 443)
            or not (host in ('api.github.com', 'github.com') or host.endswith('.githubusercontent.com'))):
        raise ValueError('Release URL must use HTTPS on GitHub')


class GitHub:
    def __init__(self, repository):
        if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
            raise ValueError('Invalid repository')
        self.repository = repository
        self.base = f'https://api.github.com/repos/{repository}'
        self.opener = urllib.request.build_opener(Redirect())

    def fetch(self, url, limit, binary=False):
        require_github_url(url)
        headers = {'User-Agent': 'maseaaao-tv-updater/1',
                   'Accept': 'application/octet-stream' if binary else 'application/vnd.github+json',
                   'X-GitHub-Api-Version': '2022-11-28'}
        token = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
        if token and urllib.parse.urlsplit(url).hostname == 'api.github.com':
            headers['Authorization'] = 'Bearer ' + token
        started = time.monotonic()
        for attempt in range(3):
            try:
                with self.opener.open(urllib.request.Request(url, headers=headers), timeout=30) as response:
                    data = bytearray()
                    while chunk := response.read(min(1024 * 1024, limit + 1 - len(data))):
                        data.extend(chunk)
                        if len(data) > limit or time.monotonic() - started > 180:
                            raise ValueError('Release download exceeded size/time limit')
                    return bytes(data)
            except urllib.error.HTTPError as error:
                if error.code in (502, 503, 504) and attempt < 2:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                raise ValueError(f'GitHub HTTP {error.code}; check connectivity, rate limit and read access') from None
        raise ValueError('Download failed')

    def releases(self):
        result = []
        for page in range(1, 101):
            batch = json.loads(self.fetch(f'{self.base}/releases?per_page=100&page={page}', 16 * 1024**2))
            if not isinstance(batch, list):
                raise ValueError('Unexpected GitHub releases response')
            result.extend(batch)
            if len(batch) < 100:
                return result
        raise ValueError('Release pagination limit reached; refusing an incomplete latest selection')

    def asset(self, release, name, limit):
        matches = [a for a in release.get('assets', []) if a.get('name') == name]
        if len(matches) != 1:
            raise ValueError(f"{release['tag_name']}: missing/duplicate {name}; publish a new-format release")
        item = matches[0]
        if item.get('state') != 'uploaded' or not 0 < item.get('size', 0) <= limit:
            raise ValueError(f'Invalid release asset: {name}')
        url = item['url']
        if not re.fullmatch(re.escape(self.base) + r'/releases/assets/[0-9]+', url):
            raise ValueError('Asset does not belong to the configured repository')
        data = self.fetch(url, limit, binary=True)
        if len(data) != item['size']:
            raise ValueError(f'Incomplete download: {name}')
        digest = item.get('digest')
        if digest and digest != 'sha256:' + sha256(data):
            raise ValueError(f'GitHub asset checksum mismatch: {name}')
        return data


def load_catalog():
    file = HERE / 'products.json'
    if not file.exists():
        file = HERE.parent / 'release-products.json'
    doc = read_json(file)
    if doc.get('schemaVersion') != 2:
        raise ValueError('Unsupported catalog; update the updater first')
    ids = [p['id'] for p in doc['products']]
    if len(ids) != len(set(ids)) or any(not ID.fullmatch(p) for p in ids):
        raise ValueError('Invalid catalog products')
    return doc


def select_bundle(releases, pin=None):
    """Newest published bundle release (tag vX.Y.Z); optionally an exact pinned version."""
    candidates = []
    for release in releases:
        if release.get('draft') or release.get('prerelease'):
            continue
        tag = release.get('tag_name', '')
        if not tag.startswith('v'):
            continue
        try:
            value = version_tuple(tag[1:])
        except ValueError:
            continue
        if pin is not None and tag != 'v' + pin:
            continue
        candidates.append((value, release))
    if not candidates:
        if pin is not None:
            raise ValueError(f'No published bundle release v{pin}')
        raise ValueError('No published bundle release')
    candidates.sort(key=lambda entry: entry[0], reverse=True)
    return candidates[0][1]


def bundle_manifest_name(release):
    return f"maseaaao-{release['tag_name'][1:]}.manifest.json"


def installed(root):
    path = root / 'current' / STATE
    if not path.exists():
        if (root / 'current').exists():
            raise ValueError('Current directory has no installation record')
        return dict(schemaVersion=1, products={})
    state = read_json(path)
    if state.get('schemaVersion') != 1 or not isinstance(state.get('products'), dict):
        raise ValueError('Unsupported installation record')
    for product, doc in state['products'].items():
        validate_manifest(doc)
        if doc['product'] != product:
            raise ValueError('Installation product mismatch')
    return state


def verify_current(root, state):
    current = root / 'current'
    if not current.exists():
        return
    expected = {STATE}
    for product, doc in state['products'].items():
        for entry in doc['files']:
            rel = product + '/' + entry['path']
            file = reject_links(current / rel)
            if not file.is_file() or file.stat().st_size != entry['size'] or sha256(file.read_bytes()) != entry['sha256']:
                raise ValueError(f'Installed file changed/missing: {rel}; preserve local edits before updating')
            expected.add(rel)
    actual = set()
    for file in current.rglob('*'):
        reject_links(file)
        if file.is_file():
            actual.add(file.relative_to(current).as_posix())
    if actual != expected:
        raise ValueError('Unmanaged files in current; move them outside the runtime before updating')


def check_dependencies(products):
    for doc in products.values():
        for name, minimum in doc.get('requires', {}).items():
            if name not in products or version_tuple(products[name]['version']) < version_tuple(minimum):
                raise ValueError(f"{doc['product']} requires {name} >= {minimum}")


def plan(client, release, products, state):
    bundle = validate_bundle_manifest(
        json.loads(client.asset(release, bundle_manifest_name(release), 4 * 1024**2)))
    if bundle['tag'] != release['tag_name']:
        raise ValueError('Bundle manifest identity mismatch')
    archive = bundle['archive']
    if (not re.fullmatch(r'maseaaao-[0-9]+\.[0-9]+\.[0-9]+\.zip', archive.get('name', ''))
            or type(archive.get('size')) is not int or not 0 < archive['size'] <= MAX_BYTES
            or not re.fullmatch('[0-9a-f]{64}', archive.get('sha256', ''))):
        raise ValueError('Invalid bundle archive metadata')
    changes, combined = {}, dict(state['products'])
    for product in products:
        doc = product_manifest(bundle, product)
        before = state['products'].get(product)
        if before and version_tuple(doc['version']) < version_tuple(before['version']):
            raise ValueError(f'{product}: refusing downgrade; use --rollback')
        if before and before['tag'].startswith('v') and version_tuple(doc['tag'][1:]) < version_tuple(before['tag'][1:]):
            raise ValueError(f'{product}: refusing bundle downgrade; use --rollback')
        if before and before['tag'] == doc['tag'] and before['files'] != doc['files']:
            raise ValueError(f'{product}: published version was modified')
        if before and before['files'] == doc['files']:
            print(f'KEEP {product} {doc["version"]}')
        else:
            print(f"UPDATE {product}: {before['version'] if before else 'not installed'} -> {doc['version']}")
            changes[product] = doc
        combined[product] = doc
    check_dependencies(combined)
    return changes, dict(schemaVersion=1, products=combined), archive


@contextmanager
def locked(root, repository):
    reject_links(root)
    root.mkdir(parents=True, exist_ok=True)
    marker = reject_links(root / MARKER)
    if not marker.exists() and any(p.name != '.update.lock' for p in root.iterdir()):
        raise ValueError('Destination must be an empty dedicated runtime directory')
    if marker.exists() and read_json(marker) != dict(schemaVersion=1, repository=repository):
        raise ValueError('Runtime belongs to a different repository or schema')
    lock = reject_links(root / '.update.lock').open('a+b')
    lock.seek(0, 2)
    if lock.tell() == 0:
        lock.write(b'0')
        lock.flush()
    lock.seek(0)
    try:
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise ValueError('Another updater is using this directory') from None
        for name in ('current', 'previous', 'packages', '.staging', 'transaction.json'):
            reject_links(root / name)
        if not marker.exists():
            write_json(marker, dict(schemaVersion=1, repository=repository))
        yield
    finally:
        lock.close()


def snapshot_id():
    return datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex[:8]


def recover(root):
    journal = root / 'transaction.json'
    if not journal.exists():
        print('No interrupted transaction')
        return
    transaction = read_json(journal)
    source_rel, backup_rel = safe_name(transaction['source']), safe_name(transaction['backup'])
    if not (source_rel.startswith('.staging/') or source_rel.startswith('previous/')) or not backup_rel.startswith('previous/'):
        raise ValueError('Invalid transaction journal')
    current, source, backup = root / 'current', reject_links(root / source_rel), reject_links(root / backup_rel)
    if not current.exists() and backup.exists():
        backup.rename(current)
        print('Restored previous current after interrupted update')
    elif not current.exists() and transaction['hadCurrent']:
        raise ValueError('Cannot recover automatically: current and backup are missing')
    elif not current.exists() and not source.exists():
        raise ValueError('Cannot recover: staged installation is missing')
    # If current exists, either no rename happened or the new installation committed.
    if current.exists():
        verify_current(root, installed(root))
    journal.unlink()


def switch(root, source):
    current = root / 'current'
    had_current = current.exists()
    backup = root / 'previous' / snapshot_id()
    backup.parent.mkdir(exist_ok=True)
    journal = root / 'transaction.json'
    if journal.exists():
        raise ValueError('Interrupted update detected; run --recover --apply first')
    write_json(journal, dict(source=source.relative_to(root).as_posix(),
                            backup=backup.relative_to(root).as_posix(), hadCurrent=had_current))
    try:
        if current.exists():
            current.rename(backup)
        source.rename(current)
    except OSError:
        if not current.exists() and backup.exists():
            backup.rename(current)
        if current.exists() or not had_current:
            journal.unlink()
        raise
    journal.unlink()
    return backup.name if backup.exists() else None


def verify_subset(archive, doc, destination):
    """Allowlist extraction of one product folder from the shared bundle zip."""
    prefix = doc['product'] + '/'
    expected = {prefix + item['path']: item for item in doc['files']}
    found = set()
    with zipfile.ZipFile(archive) as bundle:
        for info in bundle.infolist():
            if info.filename not in expected:
                continue
            found.add(info.filename)
            entry = expected[info.filename]
            safe_name(info.filename)
            if info.is_dir() or stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 1:
                raise ValueError('ZIP directories, links and encryption are not supported')
            target = reject_links(Path(destination) / entry['path'])
            target.parent.mkdir(parents=True, exist_ok=True)
            digest, count = hashlib.sha256(), 0
            with bundle.open(info) as source, target.open('xb') as output:
                while chunk := source.read(1024 * 1024):
                    count += len(chunk)
                    if count > entry['size']:
                        raise ValueError('Expanded file is too large')
                    digest.update(chunk)
                    output.write(chunk)
            if count != entry['size'] or digest.hexdigest() != entry['sha256']:
                raise ValueError(f"File checksum mismatch: {info.filename}")
    if found != set(expected):
        raise ValueError('Bundle misses product files')


def apply_changes(root, client, release, changes, state, archive_meta):
    if not changes:
        print('Already up to date')
        return
    stage_parent = root / '.staging'
    stage_parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='update-', dir=stage_parent) as temporary:
        stage = Path(temporary)
        candidate = stage / 'current'
        if (root / 'current').exists():
            shutil.copytree(root / 'current', candidate)
        else:
            candidate.mkdir()
        data = client.asset(release, archive_meta['name'], MAX_BYTES)
        if len(data) != archive_meta['size'] or sha256(data) != archive_meta['sha256']:
            raise ValueError('Bundle archive checksum mismatch')
        downloaded = stage / archive_meta['name']
        downloaded.write_bytes(data)
        for product, doc in changes.items():
            destination = candidate / product
            if destination.exists():
                shutil.rmtree(destination)
            verify_subset(downloaded, doc, destination)
            cache = root / 'packages' / product / doc['version']
            reject_links(cache)
            cache.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(downloaded, reject_links(cache / archive_meta['name']))
            write_json(cache / 'manifest.json', doc)
        state['updatedAt'] = datetime.now(timezone.utc).isoformat()
        write_json(candidate / STATE, state)
        previous = switch(root, candidate)
        print(f'Installed files: {root / "current"}')
        if previous:
            print(f'Rollback snapshot: {previous}')
        for product, doc in changes.items():
            print(f"NEXT {product}: {doc.get('activation', 'Files installed')}")


def rollback(root, name):
    safe_name(name)
    if '/' in name:
        raise ValueError('Use a snapshot name, not a path')
    source = reject_links(root / 'previous' / name)
    if not source.is_dir():
        raise ValueError('Snapshot not found')
    # Validate using the same layout without changing the source snapshot.
    doc = read_json(source / STATE)
    for product, manifest in doc['products'].items():
        validate_manifest(manifest)
        if product != manifest['product']:
            raise ValueError('Snapshot product mismatch')
    verify_current_directory(source, doc)
    undo = switch(root, source)
    print(f'Restored {name}; undo snapshot: {undo}')


def verify_current_directory(directory, state):
    # verify_current normally takes a root; accept a snapshot without symlinks.
    expected = {STATE}
    for product, doc in state['products'].items():
        for item in doc['files']:
            rel = product + '/' + item['path']
            file = reject_links(directory / rel)
            if not file.is_file() or sha256(file.read_bytes()) != item['sha256']:
                raise ValueError(f'Snapshot file checksum mismatch: {rel}')
            expected.add(rel)
    actual = set()
    for file in directory.rglob('*'):
        reject_links(file)
        if file.is_file():
            actual.add(file.relative_to(directory).as_posix())
    if actual != expected:
        raise ValueError('Snapshot file set mismatch')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--all', action='store_true', help='every catalog product from the latest bundle')
    mode.add_argument('--product', help='one product from the bundle')
    mode.add_argument('--rollback', metavar='SNAPSHOT')
    mode.add_argument('--recover', action='store_true')
    parser.add_argument('--root', type=Path, required=True, help='dedicated Windows runtime folder')
    parser.add_argument('--version', help='exact bundle version, e.g. 1.2.3; default is the latest')
    parser.add_argument('--apply', action='store_true', help='apply the displayed update; default is plan only')
    args = parser.parse_args(argv)
    doc = load_catalog()
    repository = doc['repository']
    root = reject_links(args.root)
    if args.recover or args.rollback:
        if not (root / MARKER).exists():
            raise ValueError('Runtime directory is not initialized')
        if not args.apply:
            print('PLAN recovery' if args.recover else f'PLAN rollback to {args.rollback}')
            return
        with locked(root, repository):
            if args.recover:
                recover(root)
            else:
                verify_current(root, installed(root))
                rollback(root, args.rollback)
        return
    if (root / 'transaction.json').exists():
        raise ValueError('Interrupted update detected; run --recover --apply first')
    known = [p['id'] for p in doc['products']]
    products = known if args.all else [args.product]
    if any(p not in known for p in products):
        raise ValueError('Unknown product; update the updater/catalog first')
    if args.version:
        version_tuple(args.version)
    client = GitHub(repository)
    release = select_bundle(client.releases(), args.version)
    missing = [p['id'] for p in
               validate_bundle_manifest(
                   json.loads(client.asset(release, bundle_manifest_name(release), 4 * 1024**2)))['products']
               if p['id'] not in known]
    if missing:
        raise ValueError(f'Bundle contains unknown products: {", ".join(missing)}')
    if not args.apply:
        changes, _, _ = plan(client, release, products, installed(root))
        print(f'PLAN: {len(changes)} product(s). Use --apply to download and install files.')
        return
    with locked(root, repository):
        if (root / 'transaction.json').exists():
            raise ValueError('Interrupted update detected; run --recover --apply first')
        state = installed(root)
        verify_current(root, state)
        changes, next_state, archive = plan(client, release, products, state)
        apply_changes(root, client, release, changes, next_state, archive)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, zipfile.BadZipFile) as error:
        sys.exit(f'Update stopped: {error}')
