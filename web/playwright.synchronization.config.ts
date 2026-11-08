import { defineConfig } from '@playwright/test';
import accounts from './playwright.accounts.config';

export default defineConfig({
  ...accounts,
  outputDir: './test-results/synchronization',
  testIgnore: [],
  testMatch: 'synchronization.spec.ts',
});
