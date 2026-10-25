/** Canonical stale rule (Coda, 2026-10-25; TRK-0204 / PR #299).
 *
 * An item is stale when its last activity — updated_at, or the newest
 * event (edit, status change, comment) if later — is more than
 * STALE_THRESHOLD_DAYS old. Terminal statuses and items parked on purpose
 * (status or label `blocked`, label `needs-scotty`) are never stale.
 * Counted across all owners (no assignee filter).
 *
 * The stopgap board_server.py used a different rule (in_progress/in_review
 * only, > 3 days), which is why it showed 88; the difference is expected. */
export const STALE_THRESHOLD_DAYS = 14;
export const STALE_EXCLUDED_STATUSES = ['done', 'closed', 'archived', 'cancelled', 'blocked'] as const;
export const STALE_EXCLUDED_LABELS = ['blocked', 'needs-scotty'] as const;

export interface StaleInput {
  status: string;
  updated_at: string;
  last_activity_at?: string | null;
  tags?: string[] | null;
}

const DAY_MS = 86_400_000;

export function lastActivityMs(i: StaleInput): number {
  const a = Date.parse(i.updated_at);
  const b = i.last_activity_at ? Date.parse(i.last_activity_at) : NaN;
  if (Number.isNaN(a)) return b;
  return Number.isNaN(b) ? a : Math.max(a, b);
}

export function isStale(i: StaleInput, now: number = Date.now()): boolean {
  if ((STALE_EXCLUDED_STATUSES as readonly string[]).includes(i.status.toLowerCase())) return false;
  const tags = (i.tags ?? []).map((t) => t.toLowerCase());
  if (tags.some((t) => (STALE_EXCLUDED_LABELS as readonly string[]).includes(t))) return false;
  const t = lastActivityMs(i);
  if (Number.isNaN(t)) return false;
  return now - t > STALE_THRESHOLD_DAYS * DAY_MS;
}

export function countStale(items: StaleInput[], now: number = Date.now()): number {
  return items.reduce((n, i) => n + (isStale(i, now) ? 1 : 0), 0);
}

export function daysSinceActivity(i: StaleInput, now: number = Date.now()): number {
  const t = lastActivityMs(i);
  return Number.isNaN(t) ? 0 : Math.floor((now - t) / DAY_MS);
}

/** Stuck WIP (separate signal from stale): active work with no activity
 * (same last-activity definition) for more than STUCK_WIP_DAYS. */
export const STUCK_WIP_DAYS = 3;
export const STUCK_WIP_STATUSES = ['in_progress', 'in_review'] as const;

export function isStuckWip(i: StaleInput, now: number = Date.now()): boolean {
  if (!(STUCK_WIP_STATUSES as readonly string[]).includes(i.status.toLowerCase())) return false;
  const t = lastActivityMs(i);
  if (Number.isNaN(t)) return false;
  return now - t > STUCK_WIP_DAYS * DAY_MS;
}

export function countStuckWip(items: StaleInput[], now: number = Date.now()): number {
  return items.reduce((n, i) => n + (isStuckWip(i, now) ? 1 : 0), 0);
}
