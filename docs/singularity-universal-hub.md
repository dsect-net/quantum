# The Singularity — architecture and handoff

**Home:** `dsect-net/quantum`, `apps/universal-hub/` + `services/singularity/`.
**Tracking:** [#15](https://github.com/dsect-net/quantum/issues/15), especially the
2026-10-18 design capture. Builds upon the unmerged [draft #66](https://github.com/dsect-net/quantum/pull/66).
This session uses `arena/b91bee0a-quantum`; do not merge either draft without reconciling overlapping files.

## Ownership and design

React + TypeScript + Vite, matching sibling apps' independent npm packages. Light
warm-gray/white surfaces, soft 1px borders, black actions, sparse #7C5CFF, system
sans typography, no gradients/emoji/dark mode. Shared functions remain under
`apps/universal-hub/src/singularity/` so browser demo, service and tests use one
parser/routing implementation. The service imports these pure TS modules; moving
them into `packages/` is a future monorepo phase, not an excuse to duplicate them.

The root Quantum app and Android release workflow are intentionally unchanged.
This app is independently hosted at an origin root; it does not silently replace
the existing Collab tab or ship in Quantum's existing APK.

## Two explicit demo paths, one live path

| Mode | Storage | Identity | Agent effects |
|---|---|---|---|
| Offline sandbox button | Device localStorage | Clearly labeled seeded Scotty | Simulated only |
| Shared service, `SINGULARITY_DEMO=true` | SQLite | Clearly labeled demo Scotty | Simulated only |
| Live service, default/fail-closed | SQLite feed + existing collab backend | Trusted Quantum proxy identity / per-worker key | Existing collab REST + `quantum_agent_ping` MCP |

A database records its demo/live mode and cannot be reused across modes. Browser
server sessions are not persisted or accepted as authority. No password form,
new password database, or speculative `/api/auth/login` exists. “Continue with
DSECT” calls `/api/singularity/session` behind the existing organization gateway.
It fails honestly if the gateway/service is unavailable. That integration must
be tested on Tritium with an actual organization session before deployment.

## Structured tokens and routing

`parse.ts` stores text/mention/reference tokens, not snapshots of object titles.
Emails and embedded URL/identifier tokens are not actionable. Unknown mentions
remain visible without effects. Rendering uses React text escaping, not HTML.

Every agent mention creates a ping intent. Assignment uses a conservative,
deterministic heuristic: the same sentence must contain a task, an agent, and an
explicit work verb (assign, work on, take, implement, build, handle, pick up,
go ahead), with no recognized negation. The last agent in that sentence is the
assignee. This is **not general natural-language intent understanding**; complex
or ambiguous prose should use separate sentences. Composer previews the plan.
The exact supplied Cooper/Iris example is covered by browser and unit tests.
Comments use precisely the same pipeline.

Handles map canonical source IDs to per-kind sequential handles in SQLite.
They survive refresh/restart and are never recycled. Seed slugs support bare
aliases (`#goal-001` → `#goal-001-example`). Live goals/tasks are fetched from
`/api/collab/goals` and `/api/collab/board`; assignments PATCH the existing task.
Progress normalizes the existing 0–1 scale into the UI's 0–100. Refresh is every
20 seconds or after a mutation, not a claim of real-time streaming.

**Remaining adapters:** live memory, issue, bounty and service ingestion are not
implemented; those cards currently have demo fixtures only. Do not copy private
memory content into a public feed or invent unverified API paths. See
[development memory](memory/singularity.md) for provenance and follow-up gates.

## Durability and external effects

SQLite owns posts, structured comments, reactions, mutable profile fields,
handle mappings, and a delivery outbox. Publishing and enqueueing effects commit
atomically. Live collab objects remain authoritative; their local records are
read-through views, not a second task database. Demo assignment changes status
to `doing`; the live adapter changes **assignee only**, respecting upstream status.

No network I/O occurs inside a SQLite transaction. Delivery states are pending,
sending, sent, needs-review. Errors do not erase a published post. Unknown ping
outcomes are **not automatically retried**, since the existing ping API has no
verified idempotency guarantee. A process interrupted while sending marks those
rows needs-review on restart. An operator must reconcile them with upstream
before any manual replay. There is no automatic retry button or exactly-once
claim. Future work: upstream idempotency keys, reconciliation UI and dependency
ordering when assignment fails. A task ping can currently be delivered even if
its assignment delivery needs review; inspect both statuses before relying on it.

## MCP

Eleven real registered tools, not a JSON-only promise, in `services/singularity/src/mcp.ts`:

- `singularity_feed_list`, `singularity_post_get`, `singularity_post_create`
- `singularity_comment_create`, `singularity_react`
- `singularity_profile_get`, `singularity_profile_update`
- `singularity_directory_list`, `singularity_reference_list`, `singularity_delivery_list`
- `singularity_ping_ack`

The service exposes stateless Streamable HTTP `/mcp`, tested with the official
SDK over actual HTTP. Tool identity comes from authentication, never an `author`
argument. `gateway.ts` provides `registerRemoteSingularityTools` to federate
these into the universal gateway using **one worker key bound to that session's
principal**, not a global admin identity. Close its returned cleanup on session
teardown. The private `hub-api` repository returned HTTP 403 here, so **the live
universal gateway has not been modified or registered**. Shipping requires that
maintainer to load this bridge and verify ACLs and compatibility on Tritium.

## Profiles, developer mode, safety

Directory identity fields (`id`, handle, role, `@dsect.net` email) are immutable.
Signed-in actors can update their own bio/title/interests and PNG/JPEG/WebP
photo (small data URI or HTTPS URL). Initial photos may be supplied by the
existing organization directory/database export. No mail accounts are provisioned.
External image URLs can disclose the viewer's network address; prefer the
organization's image host. Live feed snapshots are intended for the private
fleet, not public multi-tenant use.

Developer mode reveals bounded logs, parser/routing self-checks, delivery status,
and experimental device layouts. It is **not authorization**, remote shell access,
or a full CI/test runner. Production test commands remain CLI/CI only.

## Distribution and acceptance gates

Installable PWA: manifest, PNG icons, standalone display and build-generated
shell-only service worker. Desktop Chrome/Edge: browser Install action. iOS/iPadOS:
Safari Share → Add to Home Screen; supported macOS Safari: Add to Dock. Android:
browser Install. Browser/platform support varies. HTTPS required outside localhost.
API responses are never cached; live writes require connectivity. Offline sandbox
is explicitly separate. No failed live write is queued secretly for later delivery.

Capacitor config is a starting point only: native Android/iOS projects, secure
native identity/session handling, signing, store metadata and binaries are **not
built**. Windows/Linux desktop use the PWA, not signed MSI/AppImage packages.
Google TV/Wear OS are layout experiments only; native D-pad/rotary/accessibility
and packaging remain. Android Auto is not a general-purpose social-feed target;
any future supported experience needs an eligible category, policy review and a
restricted driving-safe native design. A CSS “car” layout is not Android Auto support.

Acceptance before live use: trusted ingress + identity checks, real directory,
backend adapter permission tests, gateway registration, private memory ACLs,
backups/restore rehearsal, rate/body quotas at ingress, assignment/ping failure
reconciliation, target-device testing and signed builds. No merge or production
deployment was performed.
