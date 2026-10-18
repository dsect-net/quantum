# Singularity development memory

Last updated 2026-10-18. Repository-local engineering memory, not a fabricated
write to Quantum Hive or Notion. No live memory API was available in this checkout.

## Retrieved context and decisions

- Read the attached `universal-hub-design-prompt-2026-10-18.md` and issue #15's
  Oct 18 comment before coding. The supplied sentence is the acceptance fixture.
- Read `docs/MONOREPO.md`, root README, sibling Notekeeper app/service, root
  collab client and MCP client. Keep collab/tasks and agent pings upstream.
- Discovered existing open draft #66. Reused its app as a foundation via its
  Git tree; did not switch branches or create another repository. This work's
  draft must explicitly acknowledge and reconcile that overlap.
- Fixed draft #66's speculative password endpoint and unknown-email→Scotty
  identity fallback. Authentication is now server-derived and fail-closed.
- `hub-api` source access returned HTTP 403. No live gateway integration is
  claimed. Backend paths come from the existing checked-in collab/MCP clients.
- Chose Node 22.13+ built-in SQLite (experimental on Node 22), avoiding new native
  addon builds; use one service writer process and back up SQLite coherently.
- Browser render tests found and fixed a genuine offline bug: Vite's `Vary:
  Origin` prevented cached module reuse. Immutable same-origin static assets use
  ignoreVary; API/auth responses are never in that cache.

## Follow-up memory for the next developer

1. Integrate gateway federation and trusted organization ingress in hub-api.
2. Reconcile outbox needs-review rows upstream; add idempotency before retries.
3. Add canonical memory/issue/bounty/service resolvers with visibility filtering;
   demo memory is not a live Hive record and should never masquerade as one.
4. Complete signed native targets and device acceptance; PWA is the present
   downloadable surface. Device-layout buttons do not prove native support.
5. Keep draft #66 and this branch from being merged independently; files overlap.

Architecture and safety rationale: [Singularity handoff](../singularity-universal-hub.md).
