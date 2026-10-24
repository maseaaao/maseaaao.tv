"""Build and pack the single maseaaao.tv release bundle; publication lives in release.yml."""

import argparse
from pathlib import Path
import re
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tooling/windows'))
from release_bundle import (ID, json_bytes, read_json, reject_links, safe_name,
                            sha256, version_tuple, _validate_files, validate_bundle_manifest)


def catalog(root=ROOT):
    doc = read_json(root / 'tooling/release-products.json')
    if doc.get('schemaVersion') != 2:
        raise ValueError('Unsupported release catalog schema')
    ids = set()
    for product in doc['products']:
        name = product['id']
        if not ID.fullmatch(name) or name in ids or not product['files']:
            raise ValueError('Invalid/duplicate release product')
        ids.add(name)
        version_tuple(read_json(root / product.get('versionFile', product['path'] + '/package.json'))['version'])
        for mapping in product['files']:
            safe_name(mapping['source'].replace('{version}', '1.0.0'))
            if mapping['target'] != '.':
                safe_name(mapping['target'].replace('{version}', '1.0.0'))
    return doc


def bundle_version(tag):
    if not tag.startswith('v'):
        raise ValueError('Bundle tag must look like v1.2.3')
    return version_tuple(tag[1:]), tag[1:]


def notes_for(version, root=ROOT):
    notes = (root / 'CHANGELOG.md').read_text(encoding='utf-8')
    section = re.search(r'^## ' + re.escape(version) + r'[ \t]*\r?\n(.*?)(?=^## |\Z)', notes, re.M | re.S)
    if not section or not section[1].strip():
        raise ValueError('Missing CHANGELOG.md section for this bundle version')
    return section[1].strip()


def product_version(product, root=ROOT):
    doc = read_json(root / product.get('versionFile', product['path'] + '/package.json'))
    version_tuple(doc['version'])
    return doc['version']


def collect(product, version, root=ROOT):
    """Product files with every path prefixed by the product folder."""
    result = {}
    seen = set()

    def add(source, target):
        safe_name(target)
        reject_links(source)
        if not source.is_relative_to(root):
            raise ValueError('Source escapes repository')
        if target.casefold() in seen:
            raise ValueError(f'Duplicate/case-colliding target: {target}')
        seen.add(target.casefold())
        result[target] = source.read_bytes()

    prefix = product['id'] + '/'
    for mapping in product['files']:
        relative = mapping['source'].replace('{version}', version)
        safe_name(relative)
        source = root / relative
        reject_links(source)
        target = mapping['target'].replace('{version}', version)
        if target != '.':
            safe_name(target)
        target = '' if target == '.' else target
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
                add(file, prefix + (target + '/' if target else '') + rel.as_posix())
        else:
            add(source, prefix + (target or source.name))
        if len(result) == before:
            raise ValueError(f'Empty release mapping: {relative}')
    app = root / product['path']
    for name in ['LICENSE', 'THIRD_PARTY_NOTICES.md']:
        if (app / name).is_file() and prefix + name not in result:
            add(app / name, prefix + name)
    if (app / 'licenses').is_dir():
        for file in sorted((app / 'licenses').rglob('*')):
            if file.is_file():
                name = prefix + 'licenses/' + file.relative_to(app / 'licenses').as_posix()
                if name not in result:
                    add(file, name)
    font_license = prefix + 'licenses/Unbounded-OFL.txt'
    if font_license not in result:
        add(root / 'packages/design/licenses/Unbounded-OFL.txt', font_license)
    _validate_files([dict(path=n, size=len(b), sha256=sha256(b)) for n, b in result.items()])
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
    bootstrap['products.json'] = json_bytes(dict(
        schemaVersion=2, repository=catalog(root)['repository'],
        products=[dict(id=p['id']) for p in catalog(root)['products']]))
    bootstrap['README.md'] = (root / 'docs/windows-releases.md').read_bytes()
    return bootstrap


def verify_bundle(archive, manifest):
    """Strict allowlist verification of the finished bundle zip."""
    expected = {item['path']: item for item in manifest['files']}
    with zipfile.ZipFile(archive) as bundle:
        entries = [e for e in bundle.infolist() if not e.is_dir()]
        if {e.filename for e in entries} != set(expected) or len(entries) != len(expected):
            raise ValueError('Bundle zip file list mismatch')
        for info in entries:
            safe_name(info.filename)
            entry = expected[info.filename]
            data = bundle.read(info)
            if len(data) != entry['size'] or sha256(data) != entry['sha256']:
                raise ValueError(f'Bundle file checksum mismatch: {info.filename}')


def package(tag, root=ROOT):
    _, version = bundle_version(tag)
    notes = notes_for(version, root)
    products = catalog(root)['products']
    payload, entries = {}, []
    for product in products:
        files = collect(product, product_version(product, root), root)
        entries.append(dict(id=product['id'], version=product_version(product, root),
                            activation=product['activation'], requires=product['requires']))
        payload.update(files)
    payload.update({'updater/' + n: b for n, b in bootstrap_payload(root).items()})
    _validate_files([dict(path=n, size=len(b), sha256=sha256(b)) for n, b in payload.items()])
    output = reject_links(root / 'build/release' / tag)
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    if not re.fullmatch('[0-9a-f]{40}', commit):
        raise ValueError('Unexpected commit id')
    manifest = dict(schemaVersion=2, runtimeLayout=1, tag=tag, commit=commit,
                    products=entries,
                    files=[dict(path=n, size=len(b), sha256=sha256(b)) for n, b in sorted(payload.items())])
    archive = output / f'maseaaao-{version}.zip'
    create_zip(archive, payload)
    manifest['archive'] = dict(name=archive.name, size=archive.stat().st_size,
                               sha256=sha256(archive.read_bytes()))
    validate_bundle_manifest(manifest)
    verify_bundle(archive, manifest)
    (output / f'maseaaao-{version}.manifest.json').write_bytes(json_bytes(manifest))
    sums = {p.name: sha256(p.read_bytes()) for p in sorted(output.iterdir()) if p.is_file()}
    (output / 'SHA256SUMS').write_text(''.join(f'{digest}  {name}\n' for name, digest in sums.items()),
                                      encoding='utf-8')
    (output / 'notes.md').write_text(notes + '\n', encoding='utf-8')
    print(f'Packaged and verified {tag}: {len(payload)} files, {len(products)} products -> {output}')
    return output


def build(root=ROOT):
    """Run every product build and test in catalog order before packaging."""
    for product in catalog(root)['products']:
        for command in (product['build'], product['test']):
            print(f'==> {command}', flush=True)
            result = subprocess.run(command, cwd=root, shell=True)
            if result.returncode:
                raise ValueError(f'Failed ({result.returncode}): {command}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('tag', nargs='?')
    parser.add_argument('--validate-catalog', action='store_true')
    parser.add_argument('--build', action='store_true')
    args = parser.parse_args()
    if args.validate_catalog:
        catalog()
        print('Release catalog is valid')
    elif args.build:
        if not args.tag:
            parser.error('a bundle tag is required')
        bundle_version(args.tag)
        build()
    elif not args.tag:
        parser.error('a bundle tag is required')
    else:
        package(args.tag)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, zipfile.BadZipFile) as error:
        sys.exit(str(error))
