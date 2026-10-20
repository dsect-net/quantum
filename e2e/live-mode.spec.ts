import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installStubApi, seedLiveSettings, type StubApiOptions } from './fixtures/hub-api';

/**
 * Live-mode E2E for the Quantum everything app.
 *
 * The app-shell spec covers a clean profile: no service configured, and
 * every screen must show its honest demo / not-connected state. This
 * spec covers the other half of the contract: with hub + nebula base
 * URLs configured, the screens must render the data the API returned —
 * the fixture data from e2e/fixtures/hub-api.ts, served by route
 * interception, so the run is deterministic and needs no live Tritium,
 * no tailnet, and no keys.
 *
 * Covered:
 *  - Home renders the stubbed live estate (summary, services + probes,
 *    vitals, agents, docket) and shows no demo labelling anywhere.
 *  - The services search filters the stubbed registry client-side.
 *  - One failing endpoint (/api/agents → 500) degrades only its own
 *    section, per the client's Promise.allSettled design — the rest of
 *    the dashboard stays live.
 *  - Create → Jobs renders the stubbed Nebula queue (active + recent).
 *
 * Screenshots continue the app-shell numbering under e2e/screenshots/.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(__dirname, 'screenshots');

function shot(page: Page, name: string) {
  return page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
}

function tabBar(page: Page) {
  return page.getByRole('navigation', { name: 'Primary' });
}

async function openTab(page: Page, label: string) {
  await tabBar(page).getByRole('button', { name: label, exact: true }).click();
}

/** Boot the app in live mode against the stub API. */
async function openLive(page: Page, opts: StubApiOptions = {}) {
  await installStubApi(page, opts);
  await seedLiveSettings(page);
  await page.goto('/');
  await expect(page.getByText('Quantum · DSECT')).toBeVisible();
  await expect(tabBar(page).getByRole('button', { name: 'Home', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
}

test('Home renders the stubbed live estate, not demo mode', async ({ page }) => {
  await openLive(page);

  // No demo labelling anywhere on the live dashboard.
  await expect(page.getByText('Demo mode')).toHaveCount(0);

  // Hero + glance come from /api/summary (2 of 4 services up).
  await expect(page.getByText(/4 services indexed/)).toBeVisible();
  await expect(page.getByText('2 SERVICES DOWN')).toBeVisible();
  await expect(page.getByText('Services online')).toBeVisible();
  await expect(page.getByText('50% reachable')).toBeVisible();

  // Services section: registry merged with probes. 2/4 up, and the
  // median probe the section computes from 12/34/58 ms is 34 ms.
  const summary = page.getByTestId('services-summary');
  await expect(summary).toContainText('2/4');
  await expect(summary).toContainText('34 ms');
  const list = page.getByTestId('services-list');
  for (const name of ['Hub API', 'Nebula', 'Eclipse (Jellyfin)', 'DSECT Mail']) {
    await expect(list.getByText(name)).toBeVisible();
  }

  // Vitals from /api/vitals.
  await expect(page.getByText('37%').first()).toBeVisible();

  // Roster from /api/agents, wishlist from /api/docket/items.
  await expect(page.getByText('Cooper', { exact: true })).toBeVisible();
  await expect(page.getByText('128 ledger entries')).toBeVisible();
  await expect(page.getByText('OVMS kit for Jinx')).toBeVisible();

  await shot(page, '12-home-live-mobile.png');
});

test('services search filters the stubbed registry', async ({ page }) => {
  await openLive(page);
  const list = page.getByTestId('services-list');
  await expect(list.getByText('Nebula')).toBeVisible();

  await page.getByLabel('Search services').fill('eclipse');
  await expect(list.getByText('Eclipse (Jellyfin)')).toBeVisible();
  await expect(list.getByText('Nebula')).toHaveCount(0);
  await expect(list.getByText('Hub API')).toHaveCount(0);

  await shot(page, '13-home-live-search-mobile.png');
});

test('a failing endpoint degrades only its own section', async ({ page }) => {
  await openLive(page, { fail: { '/api/agents': 500 } });

  // The rest of the dashboard is live and unaffected.
  await expect(page.getByTestId('services-summary')).toContainText('2/4');
  await expect(page.getByText('OVMS kit for Jinx')).toBeVisible();
  await expect(page.getByText('Demo mode')).toHaveCount(0);

  // Exactly one section — Agents — shows the honest error state,
  // naming the failing endpoint, with no roster data invented.
  await expect(page.getByText("Couldn't load this section")).toHaveCount(1);
  await expect(page.getByText(/HTTP 500 for \/api\/agents/)).toBeVisible();
  await expect(page.getByText('128 ledger entries')).toHaveCount(0);

  await shot(page, '14-home-partial-failure-mobile.png');
});

test('Create → Jobs renders the stubbed Nebula queue', async ({ page }) => {
  await openLive(page);

  await openTab(page, 'Create');
  await expect(page.getByText('Demo mode')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Jobs' }).click();

  // Queue note from the stub: 1 waiting, 1 active.
  await expect(page.getByText(/waiting for a free backend/)).toBeVisible();
  await expect(page.getByText('Stub render — fox portrait')).toBeVisible();
  await expect(page.getByText('Stub render — harbour at dusk')).toBeVisible();

  await shot(page, '15-create-jobs-live-mobile.png');
});
