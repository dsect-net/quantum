import { defineConfig, devices } from '@playwright/test';

/**
 * E2E for The Singularity — phone viewport (390×844) against a production
 * build served by `vite preview`, with the real service on :8795 behind the
 * Vite dev proxy pattern (here the spec points the app at the service URL
 * through the login screen's service-URL field).
 *
 * First run on a machine: `npm run test:e2e:install`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 1,
  use: {
    ...devices['iPhone 14'],
    baseURL: process.env.SINGULARITY_WEB_URL ?? 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm run preview -- --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
