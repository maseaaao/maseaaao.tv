import pathlib,json,tarfile,io,base64
p=pathlib.Path(__file__).resolve().parent
m=json.loads((p/'companion/manifest.json').read_text())
tgz=p/('local-voice-stream-'+m['version']+'.tgz')
with tarfile.open(tgz,'w:gz') as t:
 h=tarfile.TarInfo('local-voice-stream/');h.type=tarfile.DIRTYPE;t.addfile(h)
 for f in ['main.js','AudioHelper.exe','NAudio.Core.dll','NAudio.Wasapi.dll','companion/manifest.json','companion/HELP.md']: t.add(p/f,arcname='local-voice-stream/'+f)
 b=json.dumps({'name':'local-voice-stream','version':m['version'],'type':'module'}).encode();h=tarfile.TarInfo('local-voice-stream/package.json');h.size=len(b);t.addfile(h,io.BytesIO(b))
(p/'install.json').write_text(json.dumps({'path':'instances.modulesManager.installModuleTar','input':{'tarBuffer':base64.b64encode(tgz.read_bytes()).decode()}}))
