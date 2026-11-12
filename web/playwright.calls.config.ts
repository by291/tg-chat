import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  outputDir: './test-results/calls',
  testDir: './e2e-accounts',
  testMatch: 'livekit-contract.spec.ts',
  workers: 1,
  reporter: 'list',
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // The disposable provider advertises an ICE candidate on loopback.
          args: ['--allow-loopback-in-peer-connection'],
        },
      },
    },
  ],
});
