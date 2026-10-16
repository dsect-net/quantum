import { test, expect } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer, ViteDevServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import real economy service from quantum-credits clone
const qcServerPath = '/mnt/fast/quantum-os/antigravity/work/credits-build/quantum-credits/dist/server.js';
const qcMinerPath = '/mnt/fast/quantum-os/antigravity/work/credits-build/quantum-credits/dist/miner.js';
const qcDbPath = '/mnt/fast/quantum-os/antigravity/work/credits-build/quantum-credits/dist/db.js';

let economyServer: any = null;
let viteServer: ViteDevServer | null = null;
let tempDbPath = '';
let serverAddress = '';
let appUrl = '';

test.beforeAll(async () => {
  tempDbPath = path.join(
    os.tmpdir(),
    `quantum-bank-e2e-${Date.now()}-${randomUUID()}.db`
  );

  console.log(`[E2E Setup] Creating fresh temp db at: ${tempDbPath}`);

  const { createServer } = await import(qcServerPath);
  economyServer = await createServer({
    dbPath: tempDbPath,
    port: 8793,
    host: '127.0.0.1',
    seedBounties: true,
    seedCatalogue: true,
    seedQuests: true,
  });

  serverAddress = await economyServer.start();
  console.log(`[E2E Setup] Economy service listening at: ${serverAddress}`);

  // Start Vite dev server on dynamic port
  const appsBankDir = path.resolve(__dirname, '..');
  viteServer = await createViteServer({
    root: appsBankDir,
    server: {
      port: 0,
      host: '127.0.0.1',
    },
    define: {
      'import.meta.env.VITE_ECONOMY_API_URL': JSON.stringify(serverAddress),
    },
  });
  await viteServer.listen();
  const addressInfo = viteServer.httpServer?.address();
  const port = typeof addressInfo === 'object' && addressInfo ? addressInfo.port : 5174;
  appUrl = `http://127.0.0.1:${port}`;
  console.log(`[E2E Setup] Vite server listening at: ${appUrl}`);
});

test.afterAll(async () => {
  if (viteServer) {
    await viteServer.close();
  }
  if (economyServer) {
    await economyServer.close();
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
  console.log(`[E2E Teardown] Cleaned up temporary test database`);
});

test('Complete Quantum Bank E2E Verification & View Inspection Flow', async ({ page }) => {
  const screenshotsDir = path.resolve(__dirname, '../screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  // =========================================================================
  // 1. Accounts View on Primary Mobile Viewport (390x844)
  // =========================================================================
  console.log('[E2E Step 1] Visiting Accounts View on Mobile (390x844)');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(appUrl);

  // Verify accounts view renders with real balances
  await expect(page.locator('[data-testid="accounts-view"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="net-worth-card"]')).toBeVisible();
  await expect(page.locator('[data-testid="net-worth-amount"]')).toBeVisible();
  await expect(page.locator('[data-testid="checking-account-card"]')).toBeVisible();
  await expect(page.locator('[data-testid="checking-balance-amount"]')).toBeVisible();

  // Verify prompt to open savings exists before creation
  await expect(page.locator('[data-testid="create-savings-prompt-card"]')).toBeVisible();

  // Capture Screenshot 1: Mobile Accounts View (Initial state without savings)
  await page.screenshot({ path: path.join(screenshotsDir, '01-accounts-initial-mobile.png') });

  // =========================================================================
  // 1b. Desktop Accounts View (1280x800)
  // =========================================================================
  console.log('[E2E Step 1b] Verifying Desktop Accounts View (1280x800)');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(screenshotsDir, '01b-accounts-desktop.png') });

  // Reset back to primary phone viewport (390x844)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);

  // =========================================================================
  // 2. Open Savings Sub-Account Flow
  // =========================================================================
  console.log('[E2E Step 2] Opening Savings Sub-Account via UI');
  await page.click('[data-testid="create-savings-button"]');

  // Verify savings account card renders with live rate and account number
  await expect(page.locator('[data-testid="savings-account-card"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="savings-account-number"]')).toContainText('QB-SAV-COOPER');
  await expect(page.locator('[data-testid="savings-rate-display"]')).toBeVisible();

  // Capture Screenshot 2: Accounts View with Active Savings Account
  await page.screenshot({ path: path.join(screenshotsDir, '02-accounts-with-savings-mobile.png') });

  // =========================================================================
  // 3. Move Money: Transfer from Checking to Savings
  // =========================================================================
  console.log('[E2E Step 3] Moving Money from Checking to Savings');
  await page.click('[data-testid="mobile-nav-move-money"]');
  await expect(page.locator('[data-testid="move-money-view"]')).toBeVisible();

  // Verify default is 'own' and direction 'to_savings'
  await page.fill('[data-testid="transfer-amount-input"]', '100.00');
  await page.fill('[data-testid="transfer-memo-input"]', 'Initial savings reserve deposit');

  // Verify exact integer preview shows 10,000 units
  await expect(page.locator('[data-testid="amount-integer-preview"]')).toContainText('10,000 integer units');

  // Click review transfer to open confirmation modal
  await page.click('[data-testid="review-transfer-button"]');
  await expect(page.locator('[data-testid="transfer-confirmation-modal"]')).toBeVisible();
  await expect(page.locator('[data-testid="confirm-amount-credits"]')).toContainText('100.00 QC');
  await expect(page.locator('[data-testid="confirm-amount-units"]')).toContainText('10,000 units');

  // Capture Screenshot 3: Move Money Confirmation Modal
  await page.screenshot({ path: path.join(screenshotsDir, '03-move-money-confirm-modal-mobile.png') });

  // Confirm transfer
  await page.click('[data-testid="confirm-transfer-button"]');
  await expect(page.locator('[data-testid="transfer-success-banner"]')).toBeVisible({ timeout: 10000 });

  // Capture Screenshot 3b: Move Money Success
  await page.screenshot({ path: path.join(screenshotsDir, '03b-move-money-success-mobile.png') });

  // =========================================================================
  // 4. Move Money: Transfer to Another Account (scotty)
  // =========================================================================
  console.log('[E2E Step 4] Transferring to Another Account (scotty)');
  await page.click('[data-testid="mode-third-party-button"]');
  await page.selectOption('[data-testid="recipient-select"]', 'scotty');
  await page.fill('[data-testid="transfer-amount-input"]', '25.00');
  await page.fill('[data-testid="transfer-memo-input"]', 'Quarterly server maintenance subsidy');

  await page.click('[data-testid="review-transfer-button"]');
  await expect(page.locator('[data-testid="transfer-confirmation-modal"]')).toBeVisible();
  await expect(page.locator('[data-testid="confirm-amount-credits"]')).toContainText('25.00 QC');
  await expect(page.locator('[data-testid="confirm-amount-units"]')).toContainText('2,500 units');

  await page.click('[data-testid="confirm-transfer-button"]');
  await expect(page.locator('[data-testid="transfer-success-banner"]')).toBeVisible({ timeout: 10000 });

  // Seal Block 1 with Miner to seal transactions
  console.log('[E2E Step Helper] Sealing Block 1 with Miner');
  const { openDatabase } = await import(qcDbPath);
  const { Miner } = await import(qcMinerPath);
  const db = openDatabase(tempDbPath);
  const cooperKeyRow: any = db.prepare('SELECT private_key FROM account_keys WHERE account_id = ?').get('cooper');
  const qubitKeyRow: any = db.prepare('SELECT private_key FROM account_keys WHERE account_id = ?').get('qubit');
  const miner = new Miner(db);
  const sealedBlock1 = miner.sealBlock({
    validators: [
      { id: 'cooper', privateKeyPem: cooperKeyRow.private_key },
      { id: 'qubit', privateKeyPem: qubitKeyRow.private_key },
    ],
  });
  console.log(`[E2E Helper] Sealed Block 1 at height ${sealedBlock1?.height} with ${sealedBlock1?.tx_count} txs`);

  // =========================================================================
  // 5. Activity View with Running Balances & Statements Export
  // =========================================================================
  console.log('[E2E Step 5] Checking Activity View & Running Balances');
  await page.click('[data-testid="mobile-nav-activity"]');
  await expect(page.locator('[data-testid="activity-view"]')).toBeVisible();
  await expect(page.locator('[data-testid="activity-transactions-list"]')).toBeVisible();

  // Verify running balance badges exist on rows
  const runningBalLocators = page.locator('[data-testid^="tx-running-balance-"]');
  const txCount = await runningBalLocators.count();
  console.log(`[E2E] Found ${txCount} transactions with running balance badges`);
  expect(txCount).toBeGreaterThanOrEqual(2);

  // Capture Screenshot 4: Activity & Statements View
  await page.screenshot({ path: path.join(screenshotsDir, '04-activity-statements-mobile.png') });

  // =========================================================================
  // 6. Paychecks & Income View
  // =========================================================================
  console.log('[E2E Step 6] Checking Paychecks & Income View');
  await page.click('[data-testid="mobile-nav-income"]');
  await expect(page.locator('[data-testid="income-view"]')).toBeVisible();
  await expect(page.locator('[data-testid="income-summary-card"]')).toBeVisible();
  await expect(page.locator('[data-testid="total-income-amount"]')).toBeVisible();
  await expect(page.locator('[data-testid="paychecks-section"]')).toBeVisible();
  await expect(page.locator('[data-testid="quests-earnings-section"]')).toBeVisible();

  // Capture Screenshot 5: Paychecks & Income View
  await page.screenshot({ path: path.join(screenshotsDir, '05-paychecks-income-mobile.png') });

  // =========================================================================
  // 7. Economy Snapshot View
  // =========================================================================
  console.log('[E2E Step 7] Checking Economy Snapshot View');
  await page.click('[data-testid="mobile-nav-economy"]');
  await expect(page.locator('[data-testid="economy-snapshot-view"]')).toBeVisible();
  await expect(page.locator('[data-testid="supply-cap-card"]')).toBeVisible();
  await expect(page.locator('[data-testid="issued-supply-amount"]')).toBeVisible();
  await expect(page.locator('[data-testid="policy-savings-card"]')).toBeVisible();
  await expect(page.locator('[data-testid="economy-savings-rate"]')).toBeVisible();
  await expect(page.locator('[data-testid="treasury-reserve-card"]')).toBeVisible();

  // Capture Screenshot 6: Economy Snapshot View
  await page.screenshot({ path: path.join(screenshotsDir, '06-economy-snapshot-mobile.png') });

  console.log('[E2E Success] All views inspected, interactions verified, and screenshots captured.');
});
