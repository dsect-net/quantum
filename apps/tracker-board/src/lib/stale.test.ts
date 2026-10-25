import { describe, expect, it } from 'vitest';
import { STALE_THRESHOLD_DAYS, countStale, isStale } from './stale';

const NOW = Date.parse('2026-10-25T12:00:00Z');
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const item = (o: Partial<{ status: string; updated_at: string; last_activity_at: string; tags: string[] }>) => ({
  status: 'planned', updated_at: ago(20), ...o,
});

describe('isStale (canonical rule)', () => {
  it('threshold is 14 days', () => expect(STALE_THRESHOLD_DAYS).toBe(14));
  it('stale when last update > 14 days', () => expect(isStale(item({}), NOW)).toBe(true));
  it('not stale at exactly 14 days or less', () => {
    expect(isStale(item({ updated_at: ago(14) }), NOW)).toBe(false);
    expect(isStale(item({ updated_at: ago(3) }), NOW)).toBe(false);
  });
  it('a later comment/event resets staleness', () =>
    expect(isStale(item({ last_activity_at: ago(2) }), NOW)).toBe(false));
  it.each(['done', 'Closed', 'archived', 'cancelled', 'blocked'])('excludes status %s', (s) =>
    expect(isStale(item({ status: s }), NOW)).toBe(false));
  it.each(['blocked', 'needs-scotty', 'Needs-Scotty'])('excludes label %s', (t) =>
    expect(isStale(item({ tags: ['x', t] }), NOW)).toBe(false));
  it('counts any open status across owners', () => {
    for (const s of ['planned', 'in_progress', 'in_review', 'backlog']) expect(isStale(item({ status: s }), NOW)).toBe(true);
  });
  it('bad dates are never stale', () => expect(isStale(item({ updated_at: 'nope' }), NOW)).toBe(false));
  it('countStale', () =>
    expect(countStale([item({}), item({ status: 'done' }), item({ updated_at: ago(1) }), item({ tags: ['needs-scotty'] })], NOW)).toBe(1));
});
