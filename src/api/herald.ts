/**
 * Herald digest — per-agent mail-triage digest.
 *
 * Herald (TRI-014) is a daemon on Tritium: it watches every agent mailbox
 * (<agent>@dsect.net), runs rules-based + NPU triage (needs_action, urgency,
 * one-line summary), and writes a per-agent `inbox_status.json`.
 *
 * EXPOSURE STATUS (verified Oct 2, 2026 — see evidence below):
 *   NO hub-api HTTP endpoint serves inbox_status.json today.
 *
 * Evidence:
 *  - Phase-1 inventory report, section 9 (dsect-net/herald): "daemon only;
 *    value = per-agent inbox_status.json ... Mobile digest = NEW UI over
 *    existing files" — no HTTP surface listed.
 *  - Local hub-api checkout (~/workspace/hub-api, server.js routes + lib/):
 *    grep for inbox/herald routes returns nothing. Herald data is reachable
 *    only inside the MCP gateway's dsect_mail_* tools (POST /mcp, Bearer
 *    worker key, agent tool-calling protocol over the HERALD_DB sqlite) —
 *    not a REST digest endpoint a mobile screen can build on.
 *
 * So the digest screen ships with an honest "not yet exposed via API" state.
 * NO endpoints are invented here, and NO digest data is faked. When hub-api
 * grows a real digest route, wire it through probeHeraldDigest below and flip
 * HERALD_DIGEST_EXPOSED with the route name in the evidence comment.
 */

export type HeraldUrgency = 'low' | 'normal' | 'high' | 'urgent';

export interface HeraldInboxItem {
  from: string;
  subject: string;
  /** One-line NPU/rules summary. */
  summary: string;
  urgency: HeraldUrgency;
  needsAction: boolean;
}

/** The per-agent inbox_status.json contract, as herald writes it. */
export interface HeraldAgentStatus {
  agent: string;
  unread: number;
  needsAction: number;
  urgent: number;
  items: HeraldInboxItem[];
}

export interface HeraldDigest {
  generatedAt: string | null;
  agents: HeraldAgentStatus[];
}

/** Render states for the digest screen. `data` is fully supported by the
 *  view component (and unit-tested) for the day a real endpoint exists —
 *  production never fabricates one, so it always receives `not-exposed`. */
export type HeraldDigestState =
  | { status: 'data'; digest: HeraldDigest }
  | { status: 'not-exposed'; hubBaseUrl: string }
  | { status: 'error'; message: string };

/** Flip to true only when a real hub-api route serves the digest. */
export const HERALD_DIGEST_EXPOSED = false;

export async function probeHeraldDigest(hubBaseUrl: string): Promise<HeraldDigestState> {
  // Deliberately no network call: there is no documented route to probe, and
  // guessing URLs would invent an endpoint the task forbids inventing.
  if (!HERALD_DIGEST_EXPOSED) {
    return { status: 'not-exposed', hubBaseUrl };
  }
  return { status: 'error', message: 'Digest route flagged exposed but not implemented.' };
}
