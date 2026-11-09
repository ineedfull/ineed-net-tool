import { defineConfig } from '@playwright/test';
import { prepareElectronExecutable } from './scripts/dev-electron.mjs';
process.env.ELECTRON_BINARY ||= await prepareElectronExecutable();
export default defineConfig({ testDir: './tests/ui', timeout: 60000, workers: 1, reporter: 'list', use: { trace: 'retain-on-failure' } });
