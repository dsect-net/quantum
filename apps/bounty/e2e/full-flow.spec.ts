import { test, expect } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer, ViteDevServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamically import from quantum-credits clone
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
    `quantum-economy-e2e-${Date.now()}-${randomUUID()}.db`
  );

  console.log(`[E2E Setup] Creating fresh temp db at: ${tempDbPath}`);

  const { createServer } = await import(qcServerPath);
  economyServer = await createServer({
    dbPath: tempDbPath,
    port: 8792,
    host: '127.0.0.1',
    seedBounties: true,
    seedCatalogue: true,
    seedQuests: true,
  });

  serverAddress = await economyServer.start();
  console.log(`[E2E Setup] Economy service listening at: ${serverAddress}`);

  // Start Vite dev server on dynamic port
  const appsBountyDir = path.resolve(__dirname, '..');
  viteServer = await createViteServer({
    root: appsBountyDir,
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
  const port = typeof addressInfo === 'object' && addressInfo ? addressInfo.port : 5173;
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

test('Complete Quantum Bounty Board & Quests E2E Verification Flow', async ({ page }) => {
  const screenshotsDir = path.resolve(__dirname, '../screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  // 1. Visit Board View on Mobile (390x844)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(appUrl);

  // Verify seeded bounties render
  await expect(page.locator('[data-testid="bounty-card-list"]')).toBeVisible({ timeout: 10000 });
  const bountyCards = page.locator('[data-testid^="bounty-card-"]');
  const count = await bountyCards.count();
  console.log(`[E2E] Found ${count} bounty cards on board`);
  expect(count).toBeGreaterThanOrEqual(3);

  // Capture Screenshot 1: Mobile Board View
  await page.screenshot({ path: path.join(screenshotsDir, '01-board-mobile.png') });

  // Capture Screenshot 1b: Desktop Board View (1280x800)
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(screenshotsDir, '01-board-desktop.png') });

  // Reset back to primary mobile viewport 390x844
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);

  // 2. Post a Bounty with Live Fee & Escrow Preview
  await page.click('[data-testid="open-post-bounty-button"]');
  await expect(page.locator('[data-testid="post-bounty-form"]')).toBeVisible();

  await page.fill('[data-testid="bounty-title-input"]', 'Deploy Prometheus node exporter on Tritium');
  await page.fill(
    '[data-testid="bounty-description-input"]',
    'Deploy node exporter metrics daemon on Tritium and register scraping target with Prometheus fleet monitor.'
  );
  await page.fill('[data-testid="bounty-price-input"]', '20.00');

  // Verify Escrow Preview calculations: 20.00 price + 2% fee (0.40) = 20.40 total
  await expect(page.locator('[data-testid="escrow-preview-card"]')).toBeVisible();
  await expect(page.locator('[data-testid="escrow-preview-card"]')).toContainText('20.00 credits');
  await expect(page.locator('[data-testid="escrow-preview-card"]')).toContainText('0.40 credits');
  await expect(page.locator('[data-testid="escrow-preview-card"]')).toContainText('20.40 credits');
  await expect(page.locator('[data-testid="escrow-preview-card"]')).toContainText('Sufficient');

  // Capture Screenshot 2: Post Bounty Preview
  await page.screenshot({ path: path.join(screenshotsDir, '02-post-bounty-preview-mobile.png') });

  // Confirm and post bounty
  await page.click('[data-testid="confirm-post-bounty-button"]');

  // 3. Bounty Detail View
  await expect(page.locator('[data-testid="bounty-detail-view"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="bounty-detail-view"]')).toContainText('Deploy Prometheus node exporter on Tritium');
  await expect(page.locator('[data-testid="status-chip-open"]')).toBeVisible();

  // Capture Screenshot 3: Bounty Detail View
  await page.screenshot({ path: path.join(screenshotsDir, '03-bounty-detail-mobile.png') });

  // 4. Claim, Submit, Accept Flow
  console.log('[E2E Step] Switching to qubit to claim bounty');
  await page.click('[data-testid="account-switcher-button"]');
  await page.click('[data-testid="account-option-qubit"]');
  await page.waitForTimeout(300);

  // Claimant claims bounty
  console.log('[E2E Step] Claiming bounty as qubit');
  await page.click('[data-testid="claim-bounty-button"]');
  await expect(page.locator('[data-testid="status-chip-claimed"]')).toBeVisible({ timeout: 10000 });

  // Claimant submits completed work
  console.log('[E2E Step] Submitting work');
  await page.click('[data-testid="open-submit-work-button"]');
  await page.fill('[data-testid="artifact-url-input"]', 'https://github.com/dsect-net/quantum/commit/1a2b3c4d5e');
  await page.fill('[data-testid="submission-notes-input"]', 'Exporter running on port 9100. Prometheus scraping active.');
  await page.click('[data-testid="confirm-submit-work-button"]');
  await expect(page.locator('[data-testid="status-chip-submitted"]')).toBeVisible({ timeout: 10000 });

  // Switch back to poster 'cooper' to accept
  console.log('[E2E Step] Switching to cooper to accept');
  await page.click('[data-testid="account-switcher-button"]');
  await page.click('[data-testid="account-option-cooper"]');
  await page.waitForTimeout(300);

  // Poster accepts and releases escrow
  console.log('[E2E Step] Accepting bounty as cooper');
  await page.click('[data-testid="accept-bounty-button"]');
  await expect(page.locator('[data-testid="status-chip-accepted"]')).toBeVisible({ timeout: 10000 });

  // Mine Block 1 to seal pending transactions into the ledger
  console.log('[E2E Step] Sealing Block 1 with Miner');
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

  // 5. Wallet View
  await page.click('[data-testid="mobile-nav-wallet"]');
  await expect(page.locator('[data-testid="wallet-view"]')).toBeVisible();
  await expect(page.locator('[data-testid="wallet-available-balance"]')).toBeVisible();

  // Capture Screenshot 4: Wallet View
  await page.screenshot({ path: path.join(screenshotsDir, '04-wallet-mobile.png') });

  // 6. Economy View
  await page.click('[data-testid="mobile-nav-economy"]');
  await expect(page.locator('[data-testid="economy-view"]')).toBeVisible();
  await expect(page.locator('[data-testid="supply-cap-card"]')).toBeVisible();
  await expect(page.locator('[data-testid="fed-assessment-card"]')).toBeVisible();

  // Capture Screenshot 5: Economy View
  await page.screenshot({ path: path.join(screenshotsDir, '05-economy-mobile.png') });

  // 7. Leaderboard View
  await page.click('[data-testid="mobile-nav-leaderboard"]');
  await expect(page.locator('[data-testid="leaderboard-view"]')).toBeVisible();
  await expect(page.locator('[data-testid="leaderboard-entries"]')).toBeVisible();

  // Capture Screenshot 6: Leaderboard View
  await page.screenshot({ path: path.join(screenshotsDir, '06-leaderboard-mobile.png') });

  // 8. Explorer View
  console.log('[E2E Step] Navigating to Explorer view');
  await page.locator('[data-testid="mobile-nav-explorer"]').click({ force: true });
  console.log('[E2E Step] Waiting for explorer-view');
  await expect(page.locator('[data-testid="explorer-view"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-testid="chain-verification-badge"]')).toContainText(/chain cryptographically valid/i);
  await expect(page.locator('[data-testid="blocks-list"]')).toBeVisible({ timeout: 10000 });

  // Capture Screenshot 7: Explorer View
  await page.screenshot({ path: path.join(screenshotsDir, '07-explorer-mobile.png') });

  // 9. Quests Tab & End-to-End Quest Flow (Amendment A3)
  console.log('[E2E Step] Navigating to Quests view');
  await page.locator('[data-testid="mobile-nav-quests"]').click({ force: true });
  await expect(page.locator('[data-testid="quests-view"]')).toBeVisible();
  await expect(page.locator('[data-testid="quests-list"]')).toBeVisible();

  // Capture Screenshot 8: Quests Tab
  await page.screenshot({ path: path.join(screenshotsDir, '08-quests-mobile.png') });

  // Click seeded quest "Explain the Architecture of Quantum Credits Ledger"
  await page.click('[data-testid="quest-card-quest_seed_ledger_arch"]');
  await expect(page.locator('[data-testid="quest-detail-view"]')).toBeVisible();
  await expect(page.locator('[data-testid="quest-detail-view"]')).toContainText('Explain the Architecture of Quantum Credits Ledger');

  // Submit Knowledge Solution
  await page.fill(
    '[data-testid="quest-solution-input"]',
    'The Quantum Credits ledger utilizes a hash-chained append-only block structure sealed with Proof-of-Work leading zero bits and a two-validator signature quorum. Difficulty retargeting dynamically modulates mining cadence while Fed policies tune emission bounds deterministically.'
  );
  await page.click('[data-testid="confirm-submit-quest-button"]');

  // Trigger AI Verifier Evaluation (2-verifier quorum + rubric + semantic dedupe)
  await expect(page.locator('[data-testid="run-ai-verification-button"]')).toBeVisible();
  await page.click('[data-testid="run-ai-verification-button"]');

  // Verify verification feedback and rubric score appear
  await expect(page.locator('[data-testid="verification-results-card"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="verification-results-card"]')).toContainText('Quorum Verified');
  await expect(page.locator('[data-testid="status-chip-paid"]')).toBeVisible();

  // Capture Screenshot 9: Quest Detail Verified View
  await page.screenshot({ path: path.join(screenshotsDir, '09-quest-detail-verified-mobile.png') });

  // Return to Quests tab and check earnings panel
  await page.click('[data-testid="mobile-nav-quests"]');
  await page.click('[data-testid="quest-filter-earnings"]');
  await expect(page.locator('[data-testid="quest-earnings-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="quest-total-earnings"]')).toContainText('credits');
});
