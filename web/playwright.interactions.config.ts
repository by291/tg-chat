import { defineConfig } from '@playwright/test';
import accounts from './playwright.accounts.config';

export default defineConfig({
  ...accounts,
  outputDir: './test-results/interactions',
  testIgnore: [],
  testMatch: 'message-interactions.spec.ts',
  timeout: 120_000,
  use: { ...accounts.use, actionTimeout: 15_000 },
});
