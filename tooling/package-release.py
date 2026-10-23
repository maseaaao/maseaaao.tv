"""Build product archives/metadata locally; publication belongs to release.yml."""

import argparse
from pathlib import Path
import re
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tooling/windows'))
from release_bundle import (SCHEMA, ID, json_bytes, read_json, reject_links, safe_name,
                            sha256, validate_manifest, verify_archive, version_tuple)


def catalog(root=ROOT):
    doc = read_json(root / 'tooling/release-products.json')
    if doc.get('schemaVersion') != SCHEMA:
        raise ValueError('Unsupported release catalog schema')
    ids = set()
    for product in doc['products']:
        name = product['id']
        if not ID.fullmatch(name) or name in ids or product['tagPrefix'] != name + '-v':
            raise ValueError('Invalid/duplicate release product')
        ids.add(name)
        version_tuple(read_json(root / product.get('versionFile', product['path'] + '/package.json'))['version'])
        if not product['files']:
            raise ValueError('Empty product mapping')
        for mapping in product['files']:
            safe_name(mapping['source'].replace('{version}', '1.0.0'))
            if mapping['target'] != '.':
                safe_name(mapping['target'].replace('{version}', '1.0.0'))
    return doc


def select(tag, root=ROOT):
    product = next((p for p in catalog(root)['products'] if tag.startswith(p['tagPrefix'])), None)
    if product is None:
        raise ValueError('Unsupported product tag')
    version = tag[len(product['tagPrefix']):]
    version_tuple(version)
    package = read_json(root / product.get('versionFile', product['path'] + '/package.json'))
    if package['version'] != version:
        raise ValueError('Tag must match product version')
    companion = root / product['path'] / 'companion/manifest.json'
    if companion.exists() and read_json(companion)['version'] != version:
        raise ValueError('Companion manifest version differs')
    notes = (root / product['path'] / 'CHANGELOG.md').read_text(encoding='utf-8')
    section = re.search(r'^## ' + re.escape(version) + r'[ \t]*\r?\n(.*?)(?=^## |\Z)', notes, re.M | re.S)
    if not section or not section[1].strip():
        raise ValueError('Missing product changelog section')
    return product, version, section[1].strip()


def collect(product, version, root=ROOT):
    result = {}

    def add(source, target):
        safe_name(target)
        reject_links(source)
        if not source.is_relative_to(root):
            raise ValueError('Source escapes repository')
        if target.casefold() in {n.casefold() for n in result}:
            raise ValueError('Duplicate release destination')
        result[target] = source.read_bytes()

    for mapping in product['files']:
        relative = mapping['source'].replace('{version}', version)
        safe_name(relative)
        source = root / relative
        reject_links(source)
        target = mapping['target'].replace('{version}', version)
        if not source.exists():
            raise ValueError(f'Build product first: {relative}')
        before = len(result)
        if source.is_dir():
            for file in sorted(source.rglob('*')):
                reject_links(file)
                if not file.is_file():
                    continue
                rel = file.relative_to(source)
                if 'review' in rel.parts or file.name.endswith('-report.json'):
                    continue
                if product.get('extensions') and file.suffix.lower() not in product['extensions']:
                    continue
                add(file, (rel if target == '.' else Path(target) / rel).as_posix())
        else:
            add(source, target)
        if len(result) == before:
            raise ValueError(f'Empty release mapping: {relative}')
    app = root / product['path']
    for name in ['LICENSE', 'THIRD_PARTY_NOTICES.md']:
        if (app / name).is_file() and name not in result:
            add(app / name, name)
    if (app / 'licenses').is_dir():
        for file in sorted((app / 'licenses').rglob('*')):
            if file.is_file():
                name = 'licenses/' + file.relative_to(app / 'licenses').as_posix()
                if name not in result:
                    add(file, name)
    font_license = 'licenses/Unbounded-OFL.txt'
    if font_license not in result:
        add(root / 'packages/design/licenses/Unbounded-OFL.txt', font_license)
    return result


def create_zip(path, payload):
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(payload.items()):
            info = zipfile.ZipInfo(safe_name(name), date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)


def bootstrap_payload(root):
    bootstrap = {p.name: p.read_bytes() for p in (root / 'tooling/windows').iterdir()
                 if p.is_file() and p.suffix in ('.py', '.ps1')}
    bootstrap['products.json'] = json_bytes(dict(schemaVersion=1, repository=catalog(root)['repository'],
        products=[dict(id=p['id'], tagPrefix=p['tagPrefix']) for p in catalog(root)['products']]))
    bootstrap['README.md'] = (root / 'docs/windows-releases.md').read_bytes()
    return bootstrap


def package(tag, root=ROOT, output=None):
    product, version, notes = select(tag, root)
    payload = collect(product, version, root)
    output = output or root / 'build/release' / tag
    reject_links(output)
    if output.exists():
        # Only this tag's staging directory is replaced, never other products.
        if output.parent != root / 'build/release':
            raise ValueError('Output already exists')
        shutil.rmtree(output)
    output.mkdir(parents=True)
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    manifest = dict(schemaVersion=SCHEMA, runtimeLayout=1, product=product['id'], version=version,
                    tag=tag, commit=commit, activation=product['activation'], requires=product['requires'],
                    files=[dict(path=n, size=len(b), sha256=sha256(b)) for n, b in sorted(payload.items())])
    validate_manifest(manifest)
    archive = output / f"{product['id']}-{version}.zip"
    create_zip(archive, payload)
    manifest['archive'] = dict(name=archive.name, size=archive.stat().st_size, sha256=sha256(archive.read_bytes()))
    (output / f'{tag}.manifest.json').write_bytes(json_bytes(manifest))
    verify_archive(archive, manifest)
    for name in product.get('looseFiles', []):
        (output / name).write_bytes(payload[name])
    # A self-contained bootstrap accompanies every new-format product release.
    create_zip(output / 'windows-updater.zip', bootstrap_payload(root))
    sums = {p.name: sha256(p.read_bytes()) for p in sorted(output.iterdir()) if p.is_file()}
    (output / 'SHA256SUMS').write_text(''.join(f'{digest}  {name}\n' for name, digest in sums.items()), encoding='utf-8')
    (output / 'notes.md').write_text(notes + '\n\n' + product['activation'] + '\n', encoding='utf-8')
    print(f'Packaged and verified {tag}: {len(payload)} files -> {output}')
    return output


def verify_package(tag, root=ROOT, commit=None):
    """Recheck a same-run transferred package before any authenticated operation."""
    product, version, notes = select(tag, root)
    output = reject_links(root / 'build/release' / tag)
    archive_name = f"{product['id']}-{version}.zip"
    metadata_name = f'{tag}.manifest.json'
    hashed = {archive_name, metadata_name, 'windows-updater.zip', *product.get('looseFiles', [])}
    expected = hashed | {'SHA256SUMS', 'notes.md'}
    if {p.name for p in output.iterdir()} != expected:
        raise ValueError('Staged asset set differs from the product catalog')
    for path in output.iterdir():
        reject_links(path)
        if not path.is_file():
            raise ValueError('Assets must be regular files')
    sums = {}
    for line in (output / 'SHA256SUMS').read_text(encoding='utf-8').splitlines():
        match = re.fullmatch(r'([0-9a-f]{64})  (.+)', line)
        if not match or match[2] in sums:
            raise ValueError('Invalid/duplicate checksum entry')
        sums[match[2]] = match[1]
    if set(sums) != hashed:
        raise ValueError('Checksum asset set differs from the product catalog')
    for name, digest in sums.items():
        if sha256((output / name).read_bytes()) != digest:
            raise ValueError(f'Asset checksum mismatch: {name}')
    doc = validate_manifest(read_json(output / metadata_name))
    if (doc['tag'] != tag or doc['product'] != product['id'] or doc['version'] != version
            or doc['requires'] != product['requires'] or doc['activation'] != product['activation']):
        raise ValueError('Staged manifest differs from product catalog')
    if not re.fullmatch('[0-9a-f]{40}', doc.get('commit', '')) or (commit is not None and doc['commit'] != commit):
        raise ValueError('Staged commit differs from pinned commit')
    archive = output / archive_name
    if doc['archive'] != dict(name=archive_name, size=archive.stat().st_size, sha256=sha256(archive.read_bytes())):
        raise ValueError('Archive metadata mismatch')
    verify_archive(archive, doc)
    with zipfile.ZipFile(archive) as bundle:
        for name in product.get('looseFiles', []):
            if (output / name).read_bytes() != bundle.read(name):
                raise ValueError('Loose asset differs from archive')
    bootstrap = bootstrap_payload(root)
    bootstrap_doc = dict(doc, files=[dict(path=n, size=len(b), sha256=sha256(b)) for n, b in bootstrap.items()])
    verify_archive(output / 'windows-updater.zip', bootstrap_doc)
    if (output / 'notes.md').read_text(encoding='utf-8') != notes + '\n\n' + product['activation'] + '\n':
        raise ValueError('Staged notes differ from product changelog')
    print('Staged release assets and archives are valid')
    return expected - {'notes.md'}


def verify_download(tag, root=ROOT, commit=None):
    verify_package(tag, root, commit)
    output, downloaded = root / 'build/release' / tag, root / 'build/downloaded' / tag
    expected = {p.name for p in output.iterdir() if p.name != 'notes.md'}
    if {p.name for p in downloaded.iterdir()} != expected:
        raise ValueError('Downloaded asset set differs from the verified build')
    for file in output.iterdir():
        if file.name != 'notes.md' and file.read_bytes() != (downloaded / file.name).read_bytes():
            raise ValueError(f'Download differs: {file.name}')
    doc = read_json(downloaded / f'{tag}.manifest.json')
    verify_archive(downloaded / doc['archive']['name'], doc)
    print('All downloaded release assets match the verified build')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('tag', nargs='?')
    parser.add_argument('--validate', action='store_true')
    parser.add_argument('--validate-catalog', action='store_true')
    parser.add_argument('--verify-download', action='store_true')
    parser.add_argument('--verify-package', action='store_true')
    parser.add_argument('--commit')
    args = parser.parse_args()
    if args.validate_catalog:
        catalog()
        print('Release catalog is valid')
    elif not args.tag:
        parser.error('a product tag is required')
    elif args.validate:
        select(args.tag)
        print(f'Validated {args.tag}')
    elif args.verify_package:
        verify_package(args.tag, commit=args.commit)
    elif args.verify_download:
        verify_download(args.tag, commit=args.commit)
    else:
        package(args.tag)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, zipfile.BadZipFile) as error:
        sys.exit(str(error))
