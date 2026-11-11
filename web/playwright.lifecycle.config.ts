import { defineConfig } from '@playwright/test';
import accounts from './playwright.accounts.config';

export default defineConfig({
  ...accounts,
  outputDir: './test-results/lifecycle',
  testIgnore: [],
  testMatch: ['administration.spec.ts', 'notifications.spec.ts'],
  timeout: 120_000,
  use: { ...accounts.use, actionTimeout: 15_000 },
});
