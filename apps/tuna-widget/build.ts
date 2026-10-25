import { build } from 'vite';
import config from './vite.config.ts';

await build({ ...config, build: { ...config.build, modulePreload: false }, configFile: false });
