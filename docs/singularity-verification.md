# Singularity verification — 2026-10-18

Run from the monorepo on `arena/b91bee0a-quantum`. No production deployment.

| Check | Result |
|---|---|
| App Vitest parser/handle/routing/renderer/domain/feed-filter tests | 17 passed |
| Service Vitest persistence/auth/REST/MCP/HTTP/backend contracts | 11 passed |
| App strict TypeScript + production/PWA build | Passed |
| Service strict TypeScript | Passed |
| Playwright actual service/browser, 390×844 | Passed |
| Playwright actual service/browser, 1280×900 | Passed |
| Root Quantum strict TypeScript + production build | Passed |
| Root-only suite (excluding independent apps/services) | 264 passed, 2 failed in unchanged Nebula/Create tests |
| Private hub-api source | HTTP 403; live integration unverified |
| Native signed builds | Not attempted; native projects not generated |

Root failures: `src/api/nebula.test.ts` thumbnail blob auth test and
`src/screens/Create/Create.test.tsx` finished-job outputs test. Those source and
test files are unchanged by this work. The root's unrestricted suite also sweeps
legacy Notekeeper service tests without their independent dependencies; it is
not a monorepo test orchestrator. Singularity is excluded from that jsdom sweep
because it has its own aliases/Node runtime. `npm run test:singularity` explicitly
runs both new packages and must remain a required check for this feature.

Browser tests run against the SQLite demo service, not live Tritium. They verify
a successful POST response before checking new content, then comment/reaction,
profile persistence across reload, developer checks, shell availability offline
and absence of `/api/` cache entries. The demo's pings prove routing intent,
not actual agent contact. Service tests separately exercise the official MCP
SDK over in-memory **and real HTTP** transports. Backend adapter tests verify
existing collab URLs and `quantum_agent_ping` payload/handshake using controlled
fetch responses, not unapproved calls to real agents.

Screenshots in `apps/universal-hub/screenshots/verified-*` cover login, feed,
composer, goal, task, pings, profile and settings for both viewports. Rendered
feed/composer/card screenshots were opened for visual inspection. Chromium was
obtained as an npm-distributed sandbox executable due to network restrictions;
`CHROMIUM_EXECUTABLE_PATH` points at that executable only for local testing. No
browser binary, build bundle, database or test dependency cache is committed.

Repeat commands and setup: [app README](../apps/universal-hub/README.md),
[service README](../services/singularity/README.md). Known integration/security
and platform gates: [handoff](singularity-universal-hub.md).

## Workspace modernization follow-up

Updated the light corporate UI with icon-led navigation, a desktop context rail,
a new access screen, responsive composer toolbar and quieter reference cards.
Context counts are calculated from the loaded snapshot, not fabricated presence.
Search matches loaded post text, author names/handles and reference handles;
Mentions and Linked work filters inspect structured tokens. Saved posts store
only IDs per actor on the current device; no server sync or cached private body.
Storage errors are explicitly session-only. The `/` keyboard shortcut focuses
feed search without interrupting an existing edit.

Expanded both viewport E2E flows: search/no-result/reset, structural filters,
save/reload/unsave, mention insertion, keyboard focus and desktop contextual
navigation. Added `verified-search-*` and `verified-saved-*` screenshots. Re-ran
all 28 app/service tests, production build/typechecks and both browser flows.
