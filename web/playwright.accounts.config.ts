import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  outputDir: './test-results/accounts',
  testDir: './e2e-accounts',
  // prettier-ignore
  testIgnore: [
    'synchronization.spec.ts',
    'communities.spec.ts',
    'media-messaging.spec.ts',
    'message-interactions.spec.ts',
    'administration.spec.ts',
    'notifications.spec.ts',
    'livekit-contract.spec.ts',
  ],
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 90_000,
  reporter: 'list',
  use: {
    baseURL: process.env.TG_CHAT_ACCOUNT_TEST_URL ?? 'http://127.0.0.1:65413',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
