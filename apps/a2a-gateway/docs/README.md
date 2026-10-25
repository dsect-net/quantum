# A2A Gateway — DSECT A2A Profile v0.1

An implementation of the **A2A protocol 1.0** (Linux Foundation) under a
small, published local profile, built for Team Quantum and designed from
day one for agents we don't run to connect to it.

## Why this exists

Before A2A, our agents coordinated through email (great long-form record,
terrible live transport), chat inboxes, and shared databases. There was no
typed way for one agent to *delegate work* to another — with discovery,
identity, a task lifecycle, streaming progress, and a result artifact.
This gateway is that layer:

- **Discovery** — signed Agent Cards + a searchable registry.
- **Delegation** — A2A tasks with a real lifecycle
  (`submitted → working → input-required / auth-required → completed / failed / canceled / rejected`).
- **Identity & trust** — OIDC bearer tokens; five trust tiers; per-skill
  scopes checked at the gateway *and* again at the receiving adapter.
- **Audit** — every task is mirrored to the Tracker and summarized into
  the Hive (Quantum Memory). The whole exchange is reconstructible from
  the Tracker item alone. No wire-log archaeology.
- **MCP facade** — the gateway also speaks MCP, so any MCP-native agent
  can delegate over A2A with six tools and zero protocol work
  (see `MCP-TOOLS.md`).

A2A is the *horizontal* layer (agent ↔ agent). MCP stays the *vertical*
layer (agent ↔ its tools). An agent receives work over A2A and does it
with its own MCP tools; neither protocol replaces the other.

## Quickstart (dev instance, Tritium, tailnet-only)

```sh
# state (keys, registry cache, ledger) lives outside the repo:
#   ~/.local/share/a2a-gateway/
systemctl --user start a2a-gateway-dev    # or: node src/server.js
curl http://100.66.182.7:8340/health

# operator CLI (runs on Tritium; mints dev-issuer tokens for test ids)
node bin/a2a.js discover
node bin/a2a.js send qubit fleet-brief "Produce the fleet status brief." --blocking
node bin/a2a.js inbox            # Cooper's hosted-inbox queue
node bin/a2a.js approve <taskId> approved
```

Environment is documented in `src/config.js`; every default is the dev
instance (tailnet bind `100.66.182.7:8340`, dev issuer enabled). There is
**no public listener** in v0.1 — public exposure is a separate, gated
decision (profile milestones M4/M5).

## Layout

| Path | What |
|---|---|
| `src/server.js` | HTTP bootstrap: cards, registry, JSON-RPC endpoint, MCP facade, dev issuer |
| `src/a2a.js` | Protocol core (SendMessage/GetTask/…/push configs) shared by both surfaces |
| `src/registry.js` | Enrolled agents, signed cards, per-skill policy metadata |
| `src/policy.js` + `src/oidc.js` | Tier/scope enforcement; multi-issuer JWKS token validation |
| `src/tasks.js` | Task store, lifecycle, SSE fan-out, push-notification delivery |
| `src/ledger.js` | Tracker + Hive mirroring (gateway side-effect, never agent burden) |
| `src/adapters/hermes.js` | The Qubit adapter — delivers tasks into the live Hermes gateway |
| `src/adapters/inbox.js` | Hosted-inbox adapter for session-based agents (Cooper) |
| `src/devidp.js` | DEV-ONLY stand-in issuer (see PROFILE.md §identity for why) |
| `packages/a2a/` | Shared library: card builder, RFC 8785 JCS, JWS card signatures, a small client |
| `test/e2e.mjs` | Scripted end-to-end verification against a live instance |
| `test/mock-hermes.mjs` | Test fixture only — a fake Hermes API for local adapter tests |

## Docs

- [PROFILE.md](PROFILE.md) — the exact A2A subset, extensions, identity model
- [MCP-TOOLS.md](MCP-TOOLS.md) — the MCP facade reference
- [CONNECT.md](CONNECT.md) — how a new agent joins (card, identity, tiers)
- [TRUST.md](TRUST.md) — the five-tier trust model and the approval rule

## Status

Profile v0.1 / M3 reference implementation. Enrolled agents: **qubit**
(live, via the Hermes adapter) and **cooper** (hosted inbox). First
verified cross-agent handoff: Cooper → Qubit, `fleet-brief` and the
approval-gated `gated-file-read` skills (evidence in the goal workspace,
`hidden_files/m3-evidence/`).
