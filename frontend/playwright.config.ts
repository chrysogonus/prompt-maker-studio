import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:13000';

export default defineConfig({
  testDir: './e2e',
  // screenshots.spec.ts writes README assets into the repository instead of
  // asserting behaviour, so it is excluded from every ordinary run — including
  // CI's. `make screenshots` sets CAPTURE_SCREENSHOTS to opt back in.
  // (A CLI path filter alone would not be enough: testIgnore wins over it.)
  testIgnore: process.env.CAPTURE_SCREENSHOTS ? undefined : /screenshots\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
});
