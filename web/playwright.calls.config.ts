import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  outputDir: './test-results/calls',
  testDir: './e2e-accounts',
  testMatch: ['calls.spec.ts', 'livekit-contract.spec.ts'],
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 90_000,
  reporter: 'list',
  use: {
    baseURL: process.env.TG_CHAT_ACCOUNT_TEST_URL ?? 'http://127.0.0.1:65413',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // The headless shell does not support getUserMedia on the test image.
        channel: 'chromium',
        launchOptions: {
          // The disposable provider advertises an ICE candidate on loopback.
          args: ['--allow-loopback-in-peer-connection', '--use-fake-device-for-media-stream'],
        },
        permissions: ['microphone', 'camera'],
      },
    },
  ],
});
