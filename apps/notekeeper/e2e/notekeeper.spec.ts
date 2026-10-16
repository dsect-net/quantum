import { test, expect } from '@playwright/test';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let serviceProcess: ChildProcess;
let tempDbPath: string;

test.beforeAll(async () => {
  tempDbPath = path.join(os.tmpdir(), `notekeeper-e2e-${Date.now()}.db`);

  // 1. Boot the service on a temp DB
  const serverScript = path.resolve('../../services/notekeeper/dist/server.js');
  serviceProcess = spawn('node', [serverScript], {
    env: {
      ...process.env,
      NOTEKEEPER_DB: tempDbPath,
      PORT: '8791',
    },
    stdio: 'ignore',
  });

  // Poll until health endpoint is ready
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch('http://127.0.0.1:8791/health');
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // wait
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  if (!ready) {
    throw new Error('Service failed to start on http://127.0.0.1:8791');
  }

  // 2. Create fixture items via REST API
  const apiBase = 'http://127.0.0.1:8791/api/v1';

  // Fixture 1: Search fixture in Quantum list
  await fetch(`${apiBase}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Quantum Telemetry Analysis',
      body: 'Deep system performance metrics and telemetry',
      list: 'Quantum',
      type: 'note',
      author: 'cooper',
    }),
  });

  // Fixture 2: Overdue task in Business list (due 2 days ago)
  const overdueDate = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  await fetch(`${apiBase}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Overdue Project Audit',
      type: 'task',
      due_at: overdueDate,
      priority: 1,
      list: 'Business',
      author: 'scotty',
    }),
  });

  // Fixture 3: Task in Ideas & Tasks to complete
  await fetch(`${apiBase}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Deploy Fleet Monitoring Agent',
      type: 'task',
      list: 'Ideas & Tasks',
      author: 'scotty',
    }),
  });

  // Fixture 4: Item to edit and reload
  await fetch(`${apiBase}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Initial Draft Document',
      body: 'Original draft paragraph content',
      list: 'Ideas & Tasks',
      author: 'scotty',
    }),
  });

  // Fixture 5: Item due TODAY (date-only)
  const now = new Date();
  const todayDateOnly = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  await fetch(`${apiBase}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Submit Daily Review Report',
      type: 'task',
      due_at: todayDateOnly,
      priority: 2,
      list: 'Ideas & Tasks',
      author: 'scotty',
    }),
  });
});

test.afterAll(async () => {
  if (serviceProcess) {
    serviceProcess.kill();
  }
  for (const ext of ['', '-wal', '-shm']) {
    const file = `${tempDbPath}${ext}`;
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch {
        // ignore
      }
    }
  }
});

test.describe('Quantum Notekeeper E2E Tests', () => {
  test('1. lists home renders 7 lists with Ideas & Tasks first and Mental Health lock', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('[data-testid="lists-home"]')).toBeVisible();

    // Verify 7 list cards
    const listCards = page.locator('[data-testid^="list-card-"]');
    await expect(listCards).toHaveCount(7);

    // Verify Ideas & Tasks is first and has Inbox badge
    const firstList = listCards.first();
    await expect(firstList).toContainText('Ideas & Tasks');
    await expect(firstList).toContainText('Inbox');

    // Verify Mental Health has lock glyph
    const mentalHealthCard = page.locator('[data-testid^="list-card-"]').filter({ hasText: 'Mental Health' });
    await expect(mentalHealthCard.locator('[data-testid="lock-glyph"]')).toBeVisible();
  });

  test('2. capture flow adds an item via UI and it appears in the list without page reload', async ({ page }) => {
    await page.goto('/');

    // Open capture sheet via header "+ Add"
    await page.click('[data-testid="global-add-btn"]');
    await expect(page.locator('[data-testid="capture-sheet"]')).toBeVisible();

    // Fill in title
    await page.fill('[data-testid="capture-title-input"]', 'Buy Groceries For Dinner');
    await page.fill('[data-testid="capture-body-input"]', 'Apples, milk, and bread');
    await page.selectOption('[data-testid="capture-type-select"]', 'task');

    // Save
    await page.click('[data-testid="capture-save-btn"]');

    // Capture sheet closes
    await expect(page.locator('[data-testid="capture-sheet"]')).not.toBeVisible();

    // Navigate to Ideas & Tasks (where item was added)
    const inboxCard = page.locator('[data-testid^="list-card-"]').filter({ hasText: 'Ideas & Tasks' });
    await inboxCard.click();

    // Item appears in the list!
    await expect(page.locator('[data-testid="list-view"]')).toBeVisible();
    await expect(page.locator('text=Buy Groceries For Dinner')).toBeVisible();
  });

  test('3. checkbox completes an item and it moves to Done section', async ({ page }) => {
    await page.goto('/');

    // Navigate to Ideas & Tasks
    const inboxCard = page.locator('[data-testid^="list-card-"]').filter({ hasText: 'Ideas & Tasks' });
    await inboxCard.click();

    // Locate "Deploy Fleet Monitoring Agent" item row
    const taskRow = page.locator('.item-row').filter({ hasText: 'Deploy Fleet Monitoring Agent' });
    await expect(taskRow).toBeVisible();

    // Toggle its checkbox
    const checkbox = taskRow.locator('input[type="checkbox"]');
    await checkbox.click();

    // Should disappear from open items
    await expect(page.locator('[data-testid="open-items-container"]').filter({ hasText: 'Deploy Fleet Monitoring Agent' })).toHaveCount(0);

    // Expand Done section
    const toggleDoneBtn = page.locator('[data-testid="toggle-done-btn"]');
    await expect(toggleDoneBtn).toBeVisible();
    await toggleDoneBtn.click();

    // Should appear in done items container
    await expect(page.locator('[data-testid="done-items-container"]').filter({ hasText: 'Deploy Fleet Monitoring Agent' })).toBeVisible();
  });

  test('4. item detail edit persists after reload', async ({ page }) => {
    await page.goto('/');

    // Navigate to Ideas & Tasks
    const inboxCard = page.locator('[data-testid^="list-card-"]').filter({ hasText: 'Ideas & Tasks' });
    await inboxCard.click();

    // Click on "Initial Draft Document" to open Item Detail
    const itemRow = page.locator('.item-row').filter({ hasText: 'Initial Draft Document' });
    await itemRow.click();

    await expect(page.locator('[data-testid="item-detail-view"]')).toBeVisible();

    // Edit title
    const titleInput = page.locator('[data-testid="item-title-input"]');
    await titleInput.fill('Updated Draft Document Title');

    // Click Save
    await page.click('[data-testid="item-explicit-save-btn"]');

    // Wait for save confirmation
    await expect(page.locator('[data-testid="save-status"]')).toContainText('Saved');

    // Reload the page
    await page.reload();

    // Verify edited title persists!
    await expect(page.locator('[data-testid="item-title-input"]')).toHaveValue('Updated Draft Document Title');
  });

  test('5. search finds a fixture item with meaning match tag when relevant', async ({ page }) => {
    await page.goto('/');

    // Click Search tab in bottom nav
    await page.click('[data-testid="tab-search"]');
    await expect(page.locator('[data-testid="search-view"]')).toBeVisible();

    // Type query "Telemetry"
    const searchInput = page.locator('[data-testid="search-query-input"]');
    await searchInput.fill('Telemetry');

    // Expect fixture item "Quantum Telemetry Analysis" in search results
    const resultRow = page.locator('[data-testid^="search-result-"]').filter({ hasText: 'Quantum Telemetry Analysis' });
    await expect(resultRow).toBeVisible();
  });

  test('6. due view shows an overdue fixture in Overdue section', async ({ page }) => {
    await page.goto('/');

    // Click Due tab in bottom nav
    await page.click('[data-testid="tab-due"]');
    await expect(page.locator('[data-testid="due-view"]')).toBeVisible();

    // Overdue section must be present and contain "Overdue Project Audit"
    const overdueSection = page.locator('[data-testid="section-overdue"]');
    await expect(overdueSection).toBeVisible();
    await expect(overdueSection).toContainText('Overdue Project Audit');
  });

  test('7. date-only due date regression: item due today appears in Today (not Overdue) without time', async ({ page }) => {
    await page.goto('/');

    // Navigate to Due tab
    await page.click('[data-testid="tab-due"]');
    await expect(page.locator('[data-testid="due-view"]')).toBeVisible();

    // Today section must be present and contain "Submit Daily Review Report"
    const todaySection = page.locator('[data-testid="section-today"]');
    await expect(todaySection).toBeVisible();
    await expect(todaySection).toContainText('Submit Daily Review Report');

    // Ensure it does NOT appear in Overdue section
    const overdueSection = page.locator('[data-testid="section-overdue"]');
    await expect(overdueSection.locator('text=Submit Daily Review Report')).toHaveCount(0);

    // Verify the due badge renders as e.g. "Due: Oct 15" without time component
    const todayItem = todaySection.locator('.item-row').filter({ hasText: 'Submit Daily Review Report' });
    const dueBadge = todayItem.locator('.badge').filter({ hasText: 'Due:' });
    await expect(dueBadge).toBeVisible();
    const badgeText = await dueBadge.textContent();
    expect(badgeText).toMatch(/^Due:\s+[A-Za-z]+\s+\d{1,2}$/);
  });
});
