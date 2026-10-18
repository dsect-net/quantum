# Quantum platform memory — durable knowledge log

**Purpose.** This is the monorepo's long-term working memory: decisions, patterns,
and "why" context that new contributors (human or agent) need when picking up
work. It is append-only in spirit — add dated entries; do not rewrite history.
Every feature doc and non-obvious code comment should reference an entry here
rather than re-explaining the same context inline.

**Related memory sources (outside this repo):**
- `dsect-net/hive-memory` — the Hive: cross-agent episodic memory
  (`data/memories.json`, ids referenced as `[[mem:<id>]]` everywhere in Quantum).
  The Quantum app vendors a read-only sample at `src/data/hiveSnapshot.ts`
  (labeled "Snapshot — not live" in all UI).
- `dsect-net/quantum-codex` — the vault / operating-system docs (org rules).
- `docs/MONOREPO.md` — repo topology decisions (Scotty, Oct 15 2026).

---

## Entries

### 2026-10-15 — Monorepo is the default home for Quantum-flavored apps
New Quantum apps that share Quantum's login, design language, and Tritium home
**start in this repo** (`dsect-net/quantum`) under `apps/` + `services/`. Spin
out, don't start out. Foreign-runtime / heavyweight services stay isolated and
talk over the same contracts (stack-affinity guardrail). Merging a fold =
deploying it. See `docs/MONOREPO.md`.

### 2026-10-15 — Service shape: one business layer, two faces
`services/notekeeper` established the canonical service layout (reused by
`services/singularity`):
- `service.ts` holds **all** business logic; `rest.ts` and `mcp.ts` are thin
  adapters over it. A tool and the equivalent REST route must return the same
  shapes (contract tests enforce this).
- SQLite (`better-sqlite3`) with WAL + foreign keys ON; soft-delete tombstones;
  audit log rows for mutations.
- MCP: `@modelcontextprotocol/sdk` Streamable HTTP transport mounted at `/mcp`.
  Tool handlers never throw raw — they return `{ isError: true, content }`.
- Fastify central error handler + JSON 404 handler; CORS open for web dev;
  optional single Bearer token per service in local dev.
- Honest degradation: if an optional dependency (embeddings, hive-memory) is
  unavailable, degrade with a labeled `degraded` flag — never fake data.

### 2026-10-15 — Identity & secrets
- On the tailnet: **Tailscale identity headers**, no passwords.
- Secrets (worker keys, org tokens, passphrases) are user-entered, stored
  on-device via Capacitor Preferences (localStorage fallback), never in code.
- Identity is always attributable: mutations carry an actor/author; audit log
  records who did what. `dsect_whoami` on the hub MCP shows role/key id.
- `@dsect.net` email is the canonical org identity for profiles.

### 2026-10-15 — Design language
- Corporate minimalism: Inter/system-ui, neutral surfaces, one accent, flat
  rectangular badges (never pills for DSECT badges), 44px touch floor,
  light theme default with real dark mode via `data-theme`.
- CSS layering is not optional in the main shell (see root README). Standalone
  apps (`apps/*`) use plain CSS design tokens so they can run anywhere
  (Electron, TV, watch) without the Tailwind toolchain.
- "Every screen shows real data or an explicitly labeled degraded state."
  No faked data. Demo mode must be labeled on-screen.

### 2026-10-15 — Testing bar
- Services: vitest (unit + service + contract) + a `scripts/smoke.mjs` e2e
  against a fresh temp DB. Apps: vitest for pure logic + Playwright e2e at the
  390×844 phone viewport with screenshots as artifacts.
- Node 22+ required (undici/jsdom worker_threads), Node 24 in CI. Java 21 for
  Capacitor 8 Android builds.

### 2026-10-18 — The Singularity is a monorepo app + service pair
"The Singularity" (social/collaboration hub + feed for everything Quantum) lives
in this repo per the monorepo rule: `services/singularity` (Fastify + SQLite +
REST `/api/v1` + MCP `/mcp`) and `apps/singularity` (React 19 + Vite, Electron
desktop wrapper, Capacitor mobile). Key decisions:
- Humans **and agents** are `users` rows (`kind: 'human' | 'agent'`) — agent to
  agent communication is first-class (DMs + feed posts + collaboration posts).
- Posts reference Hive memories as `[[mem:<id>]]` tokens plus structured
  `post_memories` rows; memory chips must always show provenance
  (`source: snapshot | live`).
- The Singularity MCP toolset is the universal-MCP extension point for social
  actions (`singularity_*` tools). The hub gateway (`dsect-net/hub-api`, separate
  repo) aggregates it at deploy time — registration steps in
  `docs/SINGULARITY-MCP.md`. Nothing outside this repo is edited here.
- Login = universal DSECT org credentials (org token and/or per-user credential
  hashes) + trusted tailnet identity headers; sessions are hashed bearer
  tokens. Scotty (`scotty@dsect.net`) is seeded as owner.
- "Developer mode" is a settings toggle (persisted) that unlocks logs, service
  selftest, stats, audit trail, and the MCP catalog — not a hidden debug flag.

### 2026-10-18 — Platform coverage rule for Singularity
One React codebase ships everywhere: Web (Vite), Desktop (Electron builder →
Windows NSIS, Linux AppImage/deb, macOS dmg), Android (Capacitor), iOS/macOS
(Capacitor iOS). Google TV / WearOS / Android Auto are Android flavors with
their own entry constraints (leanback, watch faces/complications, automotive
distraction templates) — `docs/SINGULARITY-PLATFORMS.md` documents exactly what
is real vs. scaffolded. Never claim a platform works before its build is green.

### 2026-10-18 — Reconciliation with the universal-hub fleet feed (merge with main)
A parallel session landed `apps/universal-hub/` + an earlier `services/singularity/`
(fleet feed, ping/assignment routing, fail-closed gateway identity) via PR #78 —
same product name, different brief. Reconciled as **one service, two surfaces**:
- `services/singularity/` hosts the social hub (`/api/v1`, `/mcp`, 22
  `singularity_*` tools, explicit `actor` args — notekeeper convention) **and**
  the fleet feed (`/api/singularity/*`, `/mcp/fleet`, 11 fleet tools,
  transport-bound identity — never a tool argument), the latter a faithful port
  in `src/fleet/` so `apps/universal-hub` is unchanged. Both test suites pass
  together (65 tests).
- Env contract is split to avoid collision: `DATABASE_PATH` = social store;
  `SINGULARITY_DB` = fleet store. Service default port is **8795** (the
  universal-hub ingress contract). Runtime is `tsx` (the fleet code imports
  shared modules from `apps/universal-hub/src/singularity/` with `.ts`
  extensions); `npm run typecheck` replaces `npm run build`.
- Fleet surface mounts only with `SINGULARITY_DEMO=true` or full live env
  (directory + proxy secret + Quantum hub). Fail-closed otherwise — never a
  silent demo. See `docs/memory/singularity.md` (fleet-side memory) and
  `docs/singularity-universal-hub.md`.
- Tool catalogs stay separate on purpose: `/mcp` = social 22, `/mcp/fleet` =
  fleet 11. `src/gateway.ts` federates either endpoint and injects the
  authenticated principal as `actor` for social tools (transport-bound
  identity in the gateway context).
