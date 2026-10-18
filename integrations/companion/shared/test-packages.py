"""Read-only checks of built Companion archives; never loads helpers or modules."""
import base64
import hashlib
import json
from pathlib import Path, PurePosixPath
import tarfile

ROOT = Path(__file__).resolve().parents[1]
MODULES = [
    ('system-microphone', 'SystemAudioHelper.exe', 'request.json', ['Newtonsoft.Json.dll']),
    ('voice-control', 'AudioHelper.exe', 'install.json', []),
]

for directory, helper, request, extra in MODULES:
    module = ROOT / directory
    manifest = json.loads((module / 'companion/manifest.json').read_text(encoding='utf-8'))
    source_package = json.loads((module / 'package.json').read_text(encoding='utf-8'))
    module_id, version = manifest['id'], manifest['version']
    assert source_package['version'] == version, 'source/manifest version mismatch'
    assert manifest['runtime']['type'] == 'node22'
    assert manifest['runtime']['entrypoint'] == '../main.js'
    archive = module / f'{module_id}-{version}.tgz'
    files = ['main.js', helper, 'NAudio.Core.dll', 'NAudio.Wasapi.dll',
             'companion/manifest.json', 'companion/HELP.md', *extra]
    with tarfile.open(archive, 'r:gz') as package:
        members = package.getmembers()
        names = [m.name for m in members]
        expected = {module_id, f'{module_id}/package.json',
                    *(f'{module_id}/{name}' for name in files)}
        assert len(names) == len(set(names)), 'duplicate archive entries'
        assert set(names) == expected, 'unexpected or missing archive files'
        for member in members:
            path = PurePosixPath(member.name)
            assert not path.is_absolute() and '..' not in path.parts
            assert member.isfile() or member.isdir(), 'archive links are forbidden'
        for name in files:
            stream = package.extractfile(f'{module_id}/{name}')
            assert stream is not None
            data = stream.read()
            assert data == (module / name).read_bytes(), f'stale archive content: {name}'
            if name.endswith(('.exe', '.dll')):
                assert data.startswith(b'MZ'), f'invalid Windows binary: {name}'
        package_stream = package.extractfile(f'{module_id}/package.json')
        assert package_stream is not None
        packed = json.load(package_stream)
        assert packed['name'] == module_id and packed['version'] == version
        assert packed['type'] == 'module'
    payload = json.loads((module / request).read_text(encoding='utf-8'))
    assert payload['path'] == 'instances.modulesManager.installModuleTar'
    assert base64.b64decode(payload['input']['tarBuffer'], validate=True) == archive.read_bytes()
    print(f'PASS: {archive.name}: {len(files) + 1} files; exact source bytes, versions, entrypoint, PE headers, safe paths, install payload')
    print(f'SHA256 {hashlib.sha256(archive.read_bytes()).hexdigest()}')
