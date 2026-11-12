import { defineConfig } from '@playwright/test';
import accounts from './playwright.accounts.config';

export default defineConfig({
  ...accounts,
  outputDir: './test-results/synchronization',
  testIgnore: [],
  // The runtime resets the isolated admission budget between browser suites.
  // prettier-ignore
  testMatch: [
    'synchronization.spec.ts',
    'connection-recovery.spec.ts',
    'read-time.spec.ts',
  ],
});
