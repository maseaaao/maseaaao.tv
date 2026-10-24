import { packageModule } from '../shared/package-module.mjs';

packageModule(new URL('./', import.meta.url), 'AudioHelper.exe', 'install.json');
