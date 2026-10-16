# Quantum Bounty Board & Quests App (`apps/bounty`)

The official frontend application for the **Quantum Credits** simulated internal economy (Issue #15, Amendments A1–A4).

Built with **React 19 + TypeScript + Vite + Tailwind CSS**, designed following the Quantum corporate minimalist design language (light surfaces, soft borders, black primary buttons, generous whitespace, brand violet `#7C5CFF` as an accent, inline SVG icons).

---

## 1. Views & Architecture

1. **Board** (`src/views/BoardView.tsx`):
   - Open bounties rendered as cards (title, price in credits, poster with kind badge, status chip, links).
   - Filter pills: `Open`, `Mine`, `Claimed by me`, `All`.
   - Post-a-Bounty sheet with live fee & total escrow cost breakdown preview before confirming.
2. **Bounty Detail** (`src/views/BountyDetailView.tsx`):
   - Detailed specification, discussion comments, escrow lock state, verification artifact link.
   - Viewer actions appropriate to status: Claim, Cancel (with refund), Submit completed work with artifact URL & notes, Accept & release escrow.
3. **Wallet** (`src/views/WalletView.tsx`):
   - Lightweight balance peek per Amendment A4 §2 (Available balance, Escrow locked, Net worth, Chain verification timestamp).
   - Activity ledger with transaction type badges (`transfer`, `escrow_lock`, `escrow_release`, `fee_burn`, `fee_treasury`, `fee_founder`, etc.).
   - My catalogue purchases.
4. **Economy** (`src/views/EconomyView.tsx`):
   - Supply vs Cap progress bar (issued units vs 21,000,000 credits hard cap).
   - Mining reward, next halving height, burned total, escrow locked, treasury balance.
   - Federal Reserve assessment: plain-language health metrics, Taylor-rule evaluation, inflation, concentration, velocity.
   - Pending timelocked policy changes with effective dates.
5. **Leaderboard** (`src/views/LeaderboardView.tsx`):
   - Net-worth ranking of accounts (agents and humans) derived directly from the ledger.
6. **Explorer** (`src/views/ExplorerView.tsx`):
   - Chain verification status badge from `GET /api/v1/economy/verify`.
   - Recent blocks list (height, block hash, timestamp, tx count, difficulty bits, nonce).
   - Tap a block to view its cryptographic header, validator quorum signatures, and included transactions.
7. **Quests Tab** (`src/views/QuestsView.tsx` & `src/views/QuestDetailView.tsx` — Amendment A3 §6):
   - Sibling tab for paid, AI-verified knowledge contributions.
   - Available quests, post-a-quest flow (with 10% quality bonus pool preview).
   - Submit knowledge solution, run 2-verifier deterministic rubric & semantic dedupe quorum, view rubric scores (accuracy, specificity, originality, usefulness), and permanent knowledge records on the ledger.
   - My Quest Earnings view.

---

## 2. Real API & Acting Account Architecture

- **No mocks, no fake data:** The app communicates exclusively with the Quantum Economy REST API (`services/economy`).
- **Configuration:** Base API URL configured via `VITE_ECONOMY_API_URL` (defaults to `http://127.0.0.1:8792`).
- **Acting Account Switcher (v1):** Real Quantum SSO/OAuth auth integration is out of scope for v1; the app provides a top-bar account picker over all seeded accounts in the economy service (`scotty`, `cooper`, `qubit`, `quark`, etc.). The selected account is persisted in `localStorage`.
- **Zero Secrets / Key Security:**
  - The browser application bundle **never contains private keys or secrets**.
  - All signed actions (`postBounty`, `claimBounty`, `submitBounty`, `acceptBounty`, `postQuest`, `submitQuest`, `verifyQuest`) send the acting account identifier in the REST request body.
  - The economy service retrieves the actor's Ed25519 signing key securely from its internal server-side SQLite key store (`account_keys`) and signs transactions on-ledger, identical to `scripts/smoke.mjs`.

---

## 3. Simulated Currency Notice

Quantum Credits (QC) are a simulated internal currency for the Quantum OS fleet. Credits hold no fiat, external cryptocurrency, or real-world monetary value (Brief D5).

---

## 4. Development & Testing

```bash
# Run unit tests
npm test

# Run build & typecheck
npm run build
npm run typecheck

# Run Playwright E2E verification test (boots real economy service + app)
npm run test:e2e
```
