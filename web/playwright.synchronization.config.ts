import { defineConfig } from '@playwright/test';
import accounts from './playwright.accounts.config';

const ACTION_TIMEOUT_MS = 15_000;

export default defineConfig({
  ...accounts,
  // Bound individual actions so a stalled locator is reported before context teardown.
  use: { ...accounts.use, actionTimeout: ACTION_TIMEOUT_MS },
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
