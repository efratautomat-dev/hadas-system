import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the marketing DEMO walkthrough.
 *
 * It boots the local Vite dev server and records a Chromium video of
 * e2e/demo-walkthrough.spec.ts running against the app in demo mode
 * (the spec navigates to "/?demo=1", so all data is fictitious and no
 * real Supabase project is ever contacted).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1280, height: 720 },
    video: 'on',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
  ],

  // Auto-start the dev server before the walkthrough. Reuses an already-running
  // `npm run dev` if you started one yourself.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
