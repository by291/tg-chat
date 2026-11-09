import { defineConfig } from '@playwright/test';
import accounts from './playwright.accounts.config';

export default defineConfig({
  ...accounts,
  outputDir: './test-results/communities',
  testIgnore: [],
  testMatch: 'communities.spec.ts',
  timeout: 120_000,
});
