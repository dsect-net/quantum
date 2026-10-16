# Quantum Bank (`apps/bank`) — Amendment A4

**Quantum Bank** is the official simulated banking application and interface for the Quantum Credits economy, built in accordance with Amendment A4, Amendment A1 (Founder paycheck in checking), and Amendment A3 (Quest payouts).

---

## 1. Architecture & Design Principles

Quantum Bank serves as the primary retail banking interface for all human and agent participants within the Quantum OS ecosystem.

### Corporate Minimalist Design Language
- Light surfaces (`#ffffff`, `#f8f9fa`, `#f1f3f5`)
- Soft, refined borders (`#e5e7eb`, `#d1d5db`)
- Black primary buttons (`#111827` / `#1f2937`) with generous whitespace
- Brand violet (`#7c5cff`) used sparingly for yield badges, icons, and focus rings
- Mobile-first layout optimized for standard phone viewports (`390x844`), fully responsive on desktop viewports (`1280x800`)

### Core Denomination Invariant
- **1 credit = 100 integer units**: All ledger calculations, internal state, and transaction payloads operate exclusively on integer units. Floating-point arithmetic is strictly prohibited in accounting paths.

---

## 2. Views & Features

1. **Accounts (`AccountsView.tsx`)**:
   - Total liquid Net Worth card (checking + savings).
   - Quantum Checking account card with bank-style account numbering (`QB-CHK-<ACCOUNT>`), total balance, available balance, and unvested balance indicator (enforcing Amendment A1 founder cliff vesting for Scotty).
   - Quantum Savings account card with live Fed policy interest rate (`savings_rate_bps`) and Treasury-funded yield disclosure.
   - 1-click **Open Savings Account** sub-account creation flow (`POST /api/v1/accounts/:id/savings`) if none exists.
2. **Activity & Statements (`ActivityView.tsx`)**:
   - Full transaction history with **chronological running balance** tracking for every transaction.
   - Filter by transaction type (Transfers, Paychecks, Interest, Quests, Bounties, Mining, Purchases) and period (All Time, Today, 7 Days, 30 Days).
   - Live search by counterparty, memo, or transaction ID.
   - Client-side **CSV Statement Export** with RFC 4180 escaping and download.
3. **Move Money (`MoveMoneyView.tsx`)**:
   - Immediate transfers between own accounts (Checking ↔ Savings) and third-party participants (`POST /api/v1/transfers`).
   - Client-side balance checks preventing overdrafts or self-transfers.
   - Confirmation modal displaying amounts in decimal QC and exact integer units before dispatch.
   - Success state with transaction ID and automatic balance synchronization.
4. **Paychecks & Income (`IncomeView.tsx`)**:
   - Dedicated "my paycheck lands here" dashboard.
   - Founder paycheck history (Amendment A1) showing rule-bound salary paid from Treasury.
   - AI-verified quest earnings (Amendment A3) via `GET /api/v1/quests/earnings/:account`.
   - Proof-of-Work mining & PoUW compute reward tracking (Amendment A2).
   - Savings interest distribution history.
   - Informative, honest empty states for non-founder accounts or uncompleted quest streams.
5. **Economy Snapshot (`EconomySnapshotView.tsx`)**:
   - Mini economy dashboard rendering live metrics from `GET /api/v1/economy/summary` and `GET /api/v1/fed/policy`.
   - Circulating supply vs 21M supply cap progress bar.
   - Live Fed savings interest rate and statutory policy bounds.
   - Block mining reward, Treasury reserves, escrow locked, and burned fee totals.

---

## 3. Honest Currency & Protocol Disclosures

- **Simulated Currency (Brief D5)**: Quantum Credits (QC) are a simulated internal economic unit for the Quantum OS fleet. They hold no real-world monetary value, no fiat backing, and are not financial instruments.
- **Treasury-Funded Interest (Amendment A4 §3)**: Savings interest is set by Fed policy within algorithmic bounds and funded exclusively from the Treasury allocation. Interest is never minted out of thin air and will pay zero if Treasury funds are depleted.
- **Founder Vesting (Amendment A1 §1)**: Founder genesis allocation is subject to a 12-month cliff vesting schedule. Unvested credits remain visible but locked against spending or escrow until block maturity.

---

## 4. Signing & Acting Account Model in v1

In v1, the bank application interacts with the economy service via a custodial service-side signing model:
- The acting account is selected using the Customer Account Switcher (defaulting to seeded accounts like `cooper` or `scotty`, persisted in `localStorage`).
- Transaction payloads sent from the client contain `from_account`, `to_account`, `amount_units`, and optional `memo`.
- The economy service maintains private keys securely in the database `account_keys` table.
- When an atomic transfer is requested, the service retrieves the corresponding key (or shares the owner's key for `:savings` sub-accounts) and signs the transaction server-side.
- **Security Invariant**: No private keys, mnemonic seeds, or secrets are ever embedded in the web bundle or exposed to browser storage.

---

## 5. Scheduled Payments Protocol Gap

> **KNOWN PROTOCOL GAP**: The core economy service does not currently include a scheduled, deferred, or recurring payments daemon or REST endpoint.
>
> In accordance with project instructions, scheduled payments are not faked with local-only client state presented as real. Quantum Bank ships Move Money for immediate atomic transfers on the ledger. Scheduled and standing payment orders are formally documented as candidates for Chunk 5 protocol extensions.

---

## 6. Verification & Test Commands

All commands run inside `apps/bank/`:

```bash
# Run unit test suite (currency, statements, validation, API client)
npm test

# Verify TypeScript types
npm run typecheck

# Production build
npm run build

# Run Playwright E2E verification suite with real economy service & screenshots
npm run test:e2e
```
