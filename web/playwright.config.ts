import { defineConfig, devices } from '@playwright/test';

const TEST_SERVER_URL = 'http://127.0.0.1:5193';
const SERVER_START_TIMEOUT = 60_000;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 2,
  reporter: 'list',
  use: {
    baseURL: TEST_SERVER_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm build && pnpm preview --port 5193 --strictPort',
    url: TEST_SERVER_URL,
    reuseExistingServer: false,
    timeout: SERVER_START_TIMEOUT,
  },
});
