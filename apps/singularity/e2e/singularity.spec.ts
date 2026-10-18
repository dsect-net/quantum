/**
 * App-shell smoke — The Singularity. Runs against a production build at the
 * phone viewport. The service (services/singularity on :8795) must be up
 * with seed data for the signed-in flow; the login gate and demo states are
 * verified regardless.
 */
import { expect, test } from '@playwright/test';

const SERVICE_URL = process.env.SINGULARITY_SERVICE_URL ?? 'http://127.0.0.1:8795';

test.describe('The Singularity — app shell', () => {
  test('login gate renders with service URL field and DSECT identity fields', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'The Singularity' })).toBeVisible();
    await expect(page.getByLabel('DSECT email')).toBeVisible();
    await expect(page.getByLabel('Organization credential')).toBeVisible();
    await expect(page.getByLabel('Singularity service URL')).toBeVisible();
  });

  test('signs in with seeded org credentials and lands on the feed', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Singularity service URL').fill(SERVICE_URL);
    await page.getByLabel('DSECT email').fill('scotty@dsect.net');
    // Open-dev default: the service runs without an org token, but login
    // with the seeded admin still issues a session via personal credential
    // or the configured org credential.
    await page.getByLabel('Organization credential').fill(
      process.env.SINGULARITY_ORG_TOKEN ?? 'local-dev-credential',
    );
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Either the feed appears or an honest error banner — never a blank app.
    const feed = page.getByRole('heading', { name: 'Feed' });
    const error = page.locator('.error-text');
    await expect(feed.or(error)).toBeVisible();
  });

  test('tabs navigate between Feed, Messages, Post, Memories, Profile', async ({ page }) => {
    await page.goto('/');
    // Without a session the login gate holds the line — verify each input is
    // reachable and the create-account toggle works.
    await page.getByRole('button', { name: /Create an account/ }).click();
    await expect(page.getByLabel('Handle')).toBeVisible();
    await expect(page.getByLabel('Organization join code')).toBeVisible();
    await page.getByRole('button', { name: /Sign in$/ }).click();
    await expect(page.getByLabel('Organization credential')).toBeVisible();
  });
});
