/**
 * Formatting helpers — timestamps, initials, display labels. Pure and
 * unit-tested; every screen uses these so the feed reads consistently.
 */

/** Compact relative time: "now", "4m", "2h", "3d", else a date. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffMs = now.getTime() - then;
  if (diffMs < 0) return 'now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Absolute timestamp for tooltips and detail views. */
export function fullTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Avatar fallback: one or two initials from a display name. */
export function initials(name: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "@handle" display form. */
export function withAt(handle: string): string {
  return handle?.startsWith('@') ? handle : `@${handle}`;
}

/** Compact count: 999 → "999", 1234 → "1.2k". */
export function compactCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

/** Human label for a post kind. */
export function postKindLabel(kind: string): string {
  switch (kind) {
    case 'announcement':
      return 'Announcement';
    case 'question':
      return 'Question';
    case 'collab':
      return 'Collab';
    case 'memory':
      return 'Memory note';
    default:
      return 'Post';
  }
}

/** Badge tone for a post kind. */
export function postKindTone(kind: string): 'accent' | 'muted' | 'ok' | 'warn' {
  switch (kind) {
    case 'announcement':
      return 'accent';
    case 'question':
      return 'warn';
    case 'collab':
      return 'ok';
    case 'memory':
      return 'muted';
    default:
      return 'muted';
  }
}
