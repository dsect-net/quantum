import { defineConfig } from '@playwright/test';

/**
 * Quantum (main app) E2E harness.
 *
 * The Oct 15, 2026 rule: app work is verified by SEEING the rendered app —
 * E2E tests and screenshots, phone viewport included, are part of the
 * deliverable. apps/bank and apps/bounty already had Playwright harnesses;
 * this gives the flagship app the same floor.
 *
 * The app-shell specs run against the Vite dev server with a clean
 * browser profile, so every service is unconfigured and the app must
 * show its honest demo / not-connected states — no live Tritium, no
 * keys, no faked data. The live-mode specs (e2e/live-mode.spec.ts) cover
 * the opposite contract — configured base URLs rendering real returned
 * data — against the deterministic stub API in e2e/fixtures/hub-api.ts,
 * still with no live Tritium and no keys.
 *
 * Run: npm run test:e2e   (screenshots land in e2e/screenshots/)
 */
const PORT = 5199;

export default defineConfig({
  testDir: './e2e',
  timeout: 120000,
  expect: {
    timeout: 15000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // Build once, then serve the production bundle: page loads stay fast
    // and deterministic (the Vite dev server re-transforms on cold loads,
    // which made simple assertions take tens of seconds).
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 300000,
  },
  // Mobile only, on purpose: Quantum is designed purely for mobile
  // devices (Scotty's standing constraint for this app) — at desktop
  // widths the shell does not even render the bottom tab bar. The
  // standalone apps (bank, bounty) keep their own desktop coverage.
  projects: [
    {
      name: 'Chromium Mobile 390x844',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
