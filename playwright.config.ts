import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    browserName: 'chromium',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
    trace: 'off',
  },
  webServer: {
    env: { MCP_EXPERIMENT_ENABLED: 'false' },
    command: 'pnpm --filter @weight-tracker/web start --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
