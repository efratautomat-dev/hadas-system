import { defineConfig, devices } from '@playwright/test'

/**
 * Marketing walkthrough — recorded against the STANDALONE demo build.
 *
 * NOT the dev server. `npm run dev` + `?demo=1` runs the app under the client's
 * own branding — the name "הדס" and the Hadas wordmark — which is exactly what a
 * video shown outside the business must not carry. Only the standalone build
 * renames itself to `incontrol` and swaps the logo (`.env.demo`, applied through
 * src/brand.config.ts), so the recording has to run on that bundle.
 *
 *   npm run build:demo && npx playwright test --config=playwright.marketing.config.ts
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /marketing-walkthrough\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'line',
  timeout: 180_000,

  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1440, height: 900 },
    video: { mode: 'on', size: { width: 1440, height: 900 } },
    trace: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],

  webServer: {
    command: 'npx vite preview --outDir dist-demo --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
