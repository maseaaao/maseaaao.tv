import base64, io, json, tarfile
from pathlib import Path
d = Path(__file__).resolve().parent
m = json.loads((d/'companion/manifest.json').read_text())
p = d / (m['id']+'-'+m['version']+'.tgz')
with tarfile.open(p,'w:gz') as t:
    h=tarfile.TarInfo(m['id']+'/'); h.type=tarfile.DIRTYPE; t.addfile(h)
    for f in ['main.js','SystemAudioHelper.exe','NAudio.Core.dll','NAudio.Wasapi.dll','Newtonsoft.Json.dll','companion/manifest.json','companion/HELP.md']:
        t.add(d/f,arcname=m['id']+'/'+f)
    data=json.dumps({'name':m['id'],'version':m['version'],'type':'module','dependencies':{}}).encode()
    h=tarfile.TarInfo(m['id']+'/package.json'); h.size=len(data); t.addfile(h,io.BytesIO(data))
(d/'request.json').write_text(json.dumps({'path':'instances.modulesManager.installModuleTar','input':{'tarBuffer':base64.b64encode(p.read_bytes()).decode()}}))
print(p.name)
