"""Portable release format shared by the Linux packager and Windows updater."""

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import zipfile

SCHEMA = 1
MAX_FILES = 10000
MAX_BYTES = 512 * 1024**2
ID = re.compile(r"[a-z][a-z0-9-]{0,63}\Z")
VERSION = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z")


def version_tuple(value):
    if not isinstance(value, str) or not VERSION.fullmatch(value):
        raise ValueError(f"Invalid stable version: {value!r}")
    return tuple(map(int, value.split('.')))


def safe_name(value):
    """Reject traversal and Windows aliases/ADS even when packaging on Linux."""
    if not isinstance(value, str) or not value or len(value) > 240:
        raise ValueError('Invalid package path')
    parts = value.split('/')
    for part in parts:
        if (part in ('', '.', '..') or part[-1:] in (' ', '.')
                or re.search(r'[<>:"\\|?*\x00-\x1f]', part)
                or re.fullmatch(r'(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\..*)?', part, re.I)):
            raise ValueError(f'Unsafe package path: {value!r}')
    return value


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode('utf-8')


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def write_json(path, value):
    path = reject_links(path)
    temp = reject_links(path.with_name(path.name + '.tmp'))
    with temp.open('wb') as stream:
        stream.write(json_bytes(value))
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


def reject_links(path):
    """Check every existing ancestor, including Windows junctions/reparse points."""
    path = Path(os.path.abspath(path))
    for item in [path, *path.parents]:
        try:
            info = item.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise ValueError(f'Links/reparse points are not supported: {item}')
    return path


def validate_manifest(doc):
    if doc.get('schemaVersion') != SCHEMA or doc.get('runtimeLayout') != 1:
        raise ValueError('Unsupported package schema/runtime layout; update the updater')
    if not ID.fullmatch(doc.get('product', '')):
        raise ValueError('Invalid product id')
    safe_name(doc['product'])
    version_tuple(doc.get('version'))
    if doc.get('tag') != f"{doc['product']}-v{doc['version']}":
        raise ValueError('Package tag mismatch')
    files = doc.get('files')
    if not isinstance(files, list) or not 0 < len(files) <= MAX_FILES:
        raise ValueError('Invalid package file count')
    seen, total = set(), 0
    for entry in files:
        name = safe_name(entry['path'])
        if name.casefold() in seen:
            raise ValueError('Duplicate/case-colliding package path')
        seen.add(name.casefold())
        if type(entry['size']) is not int or entry['size'] < 0:
            raise ValueError('Invalid file size')
        if not re.fullmatch('[0-9a-f]{64}', entry['sha256']):
            raise ValueError('Invalid SHA256')
        total += entry['size']
    if total > MAX_BYTES:
        raise ValueError('Package too large')
    for name in seen:
        if any('/'.join(name.split('/')[:n]) in seen for n in range(1, len(name.split('/')))):
            raise ValueError('File/directory collision')
    requirements = doc.get('requires', {})
    if not isinstance(requirements, dict):
        raise ValueError('Invalid requirements')
    for product, minimum in requirements.items():
        if not ID.fullmatch(product):
            raise ValueError('Invalid required product')
        version_tuple(minimum)
    return doc


def verify_archive(archive, doc, destination=None):
    """Exact allowlist extraction: no extractall, symlinks, duplicate paths or extras."""
    validate_manifest(doc)
    expected = {item['path']: item for item in doc['files']}
    with zipfile.ZipFile(archive) as bundle:
        entries = bundle.infolist()
        if len(entries) != len(expected) or len({i.filename for i in entries}) != len(entries):
            raise ValueError('ZIP file list mismatch')
        if {i.filename for i in entries} != set(expected):
            raise ValueError('ZIP has missing/unexpected files')
        for info in entries:
            safe_name(info.filename)
            if info.is_dir() or stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 1:
                raise ValueError('ZIP directories, links and encryption are not supported')
            entry = expected[info.filename]
            if info.file_size != entry['size']:
                raise ValueError('ZIP file size mismatch')
            digest, count = hashlib.sha256(), 0
            target = None
            if destination is not None:
                target = reject_links(Path(destination) / info.filename)
                target.parent.mkdir(parents=True, exist_ok=True)
            with bundle.open(info) as source:
                output = target.open('xb') if target else None
                try:
                    while chunk := source.read(1024 * 1024):
                        count += len(chunk)
                        if count > entry['size']:
                            raise ValueError('Expanded file is too large')
                        digest.update(chunk)
                        if output:
                            output.write(chunk)
                finally:
                    if output:
                        output.close()
            if count != entry['size'] or digest.hexdigest() != entry['sha256']:
                raise ValueError(f"File checksum mismatch: {info.filename}")
