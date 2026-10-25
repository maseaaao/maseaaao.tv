import { packageModule } from '../shared/package-module.ts';

packageModule(new URL('./', import.meta.url), 'AudioHelper.exe', 'install.json');
