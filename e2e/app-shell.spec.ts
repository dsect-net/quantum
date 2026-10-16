import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * App-shell smoke E2E for the Quantum everything app.
 *
 * A clean profile means NO service is configured, so the contract under
 * test is the house honesty rule: every tab renders, and every screen
 * shows its real demo / not-connected state instead of fake data.
 * Screenshots are committed under e2e/screenshots/ (same convention as
 * apps/bank and apps/bounty) so reviewers can see the rendered app.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(__dirname, 'screenshots');

function shot(page: Page, name: string) {
  return page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
}

/** The bottom tab bar (the kit renders <nav aria-label="Primary">). */
function tabBar(page: Page) {
  return page.getByRole('navigation', { name: 'Primary' });
}

async function openTab(page: Page, label: string) {
  await tabBar(page).getByRole('button', { name: label, exact: true }).click();
}

async function expectTabCurrent(page: Page, label: string) {
  await expect(
    tabBar(page).getByRole('button', { name: label, exact: true }),
  ).toHaveAttribute('aria-current', 'page');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // App bar proves the shell mounted.
  await expect(page.getByText('Quantum · DSECT')).toBeVisible();
});

test('loads on Home in honest demo mode with all six tabs', async ({ page }) => {
  await expectTabCurrent(page, 'Home');
  for (const label of ['Home', 'Chat', 'Create', 'Collab', 'Mail', 'More']) {
    await expect(
      tabBar(page).getByRole('button', { name: label, exact: true }),
    ).toBeVisible();
  }
  // Personal greeting from the hub hero + the honest demo-mode labelling.
  await expect(page.getByRole('heading', { name: /Scotty\./ })).toBeVisible();
  await expect(page.getByText('Demo mode').first()).toBeVisible();
  await shot(page, '01-home-mobile.png');
});

test('every tab renders its real unconfigured state', async ({ page }) => {
  await openTab(page, 'Chat');
  await expectTabCurrent(page, 'Chat');
  await expect(page.getByText("Chat isn't connected")).toBeVisible();
  await shot(page, '02-chat-mobile.png');

  await openTab(page, 'Create');
  await expectTabCurrent(page, 'Create');
  // Nebula module: demo banner up, sub-view switcher present (a tablist).
  await expect(page.getByText('Demo mode').first()).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Jobs' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Gallery' })).toBeVisible();
  await shot(page, '03-create-mobile.png');

  await openTab(page, 'Collab');
  await expectTabCurrent(page, 'Collab');
  await expect(page.getByText('Collaboration is not connected')).toBeVisible();
  await shot(page, '04-collab-mobile.png');

  await openTab(page, 'Mail');
  await expectTabCurrent(page, 'Mail');
  await expect(page.getByText('Mail is not connected')).toBeVisible();
  await shot(page, '05-mail-mobile.png');

  await openTab(page, 'More');
  await expectTabCurrent(page, 'More');
  await expect(page.getByText('Services & tools')).toBeVisible();
  await expect(page.getByText('Connection settings')).toBeVisible();
  await shot(page, '06-more-mobile.png');
});

test('More → Services shows the not-connected state and Back returns', async ({ page }) => {
  await openTab(page, 'More');
  await page.getByRole('button', { name: /Services & tools/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Services & tools', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Not connected', { exact: true })).toBeVisible();
  await shot(page, '07-services-mobile.png');

  await page.getByRole('button', { name: 'Back to More' }).click();
  await expect(page.getByText('Memory explorer')).toBeVisible();
});

test('debug toggle reveals the Scotty-only Debug tools', async ({ page }) => {
  // Off by default: no Debug tools row under More.
  await openTab(page, 'More');
  await expect(page.getByText('Debug tools')).toHaveCount(0);

  // The kit toggle is a react-aria Switch whose input sits in a 1px
  // visually-hidden span — no pointer click can ever be "actionable" on
  // it or its parent. Keyboard toggling (focus + Space) is the reliable
  // gesture, and it is how a keyboard user flips it too.
  const debugSwitch = page.getByRole('switch', { name: 'Debug mode' });
  await debugSwitch.focus();
  await page.keyboard.press('Space');
  await expect(debugSwitch).toBeChecked();
  await expect(page.getByText('DBG')).toBeVisible();
  await expect(page.getByText('Debug tools')).toBeVisible();
  await shot(page, '08-more-debug-mobile.png');

  await page.getByRole('button', { name: /Debug tools/ }).click();
  await expect(
    page.getByRole('button', { name: 'Back to More' }),
  ).toBeVisible();
  await shot(page, '09-debug-screen-mobile.png');
});

test('connection settings persist across reload and flip Home out of demo mode', async ({ page }) => {
  await openTab(page, 'More');
  await page.getByRole('button', { name: /Connection settings/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Connection settings', exact: true }),
  ).toBeVisible();

  // An unreachable loopback address: settings must save honestly and Home
  // must switch from "demo mode" to a real "unreachable" error — never to
  // invented live data.
  const hubInput = page.getByLabel('Hub API base URL');
  await hubInput.fill('http://127.0.0.1:9');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await shot(page, '10-settings-mobile.png');

  // Reload resets the shell to Home (tab state is in-memory); navigate
  // back into settings — the stored value itself must have survived.
  await page.reload();
  await expect(page.getByText('Quantum · DSECT')).toBeVisible();
  await openTab(page, 'More');
  await page.getByRole('button', { name: /Connection settings/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Connection settings', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Hub API base URL')).toHaveValue('http://127.0.0.1:9');

  await openTab(page, 'Home');
  await expect(page.getByText('Hub API unreachable')).toBeVisible();
  await shot(page, '11-home-unreachable-mobile.png');
});
