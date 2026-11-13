import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts',
  workers: 1, fullyParallel: false, timeout: 25000,
  reporter: [['list']],
  use: { screenshot: 'only-on-failure' },
});
