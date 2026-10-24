import { packageModule } from '../shared/package-module.mjs';

packageModule(new URL('./', import.meta.url), 'SystemAudioHelper.exe', 'request.json', [
  'Newtonsoft.Json.dll',
]);
