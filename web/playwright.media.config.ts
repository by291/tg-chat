import { defineConfig } from '@playwright/test';
import accounts from './playwright.accounts.config';

export default defineConfig({
  ...accounts,
  outputDir: './test-results/media',
  testIgnore: [],
  testMatch: 'media-messaging.spec.ts',
  timeout: 120_000,
  use: {
    ...accounts.use,
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
});
