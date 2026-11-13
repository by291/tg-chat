import { defineConfig, devices } from '@playwright/test';

const EXTENDED_TEST_TIMEOUT_MS = 120_000;
const ACTION_TIMEOUT_MS = 15_000;

export default defineConfig({
  testDir: './e2e-accounts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 90_000,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.TG_CHAT_ACCOUNT_TEST_URL ?? 'http://127.0.0.1:65413',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'accounts',
      testMatch: ['accounts.spec.ts', 'direct-messaging.spec.ts'],
      outputDir: './test-results/accounts',
    },
    {
      name: 'sync',
      // prettier-ignore
      testMatch: [
        'synchronization.spec.ts',
        'connection-recovery.spec.ts',
        'read-time.spec.ts',
      ],
      outputDir: './test-results/synchronization',
      // Report a stalled action before the test times out during context teardown.
      use: { actionTimeout: ACTION_TIMEOUT_MS },
    },
    {
      name: 'communities',
      testMatch: 'communities.spec.ts',
      outputDir: './test-results/communities',
      timeout: EXTENDED_TEST_TIMEOUT_MS,
    },
    {
      name: 'media',
      testMatch: 'media-messaging.spec.ts',
      outputDir: './test-results/media',
      timeout: EXTENDED_TEST_TIMEOUT_MS,
      use: {
        launchOptions: {
          args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
        },
      },
    },
    {
      name: 'interactions',
      testMatch: 'message-interactions.spec.ts',
      outputDir: './test-results/interactions',
      timeout: EXTENDED_TEST_TIMEOUT_MS,
      use: { actionTimeout: ACTION_TIMEOUT_MS },
    },
    {
      name: 'lifecycle',
      testMatch: ['administration.spec.ts', 'notifications.spec.ts'],
      outputDir: './test-results/lifecycle',
      timeout: EXTENDED_TEST_TIMEOUT_MS,
      use: { actionTimeout: ACTION_TIMEOUT_MS },
    },
  ],
});
