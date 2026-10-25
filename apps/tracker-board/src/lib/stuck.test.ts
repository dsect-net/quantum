import { describe, expect, it } from 'vitest';
import { STUCK_WIP_DAYS, countStuckWip, isStuckWip } from './stale';

const NOW = Date.parse('2026-10-25T12:00:00Z');
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const item = (o: Partial<{ status: string; updated_at: string; last_activity_at: string; tags: string[] }>) => ({
  status: 'in_progress', updated_at: ago(5), ...o,
});

describe('isStuckWip', () => {
  it('threshold is 3 days', () => expect(STUCK_WIP_DAYS).toBe(3));
  it('in_progress / in_review > 3d are stuck', () => {
    expect(isStuckWip(item({}), NOW)).toBe(true);
    expect(isStuckWip(item({ status: 'in_review' }), NOW)).toBe(true);
  });
  it('exactly 3d or less is not stuck', () => expect(isStuckWip(item({ updated_at: ago(3) }), NOW)).toBe(false));
  it('later event resets', () => expect(isStuckWip(item({ last_activity_at: ago(1) }), NOW)).toBe(false));
  it.each(['planned', 'blocked', 'done', 'cancelled', 'backlog'])('ignores status %s', (s) =>
    expect(isStuckWip(item({ status: s }), NOW)).toBe(false));
  it('bad dates never stuck', () => expect(isStuckWip(item({ updated_at: 'x' }), NOW)).toBe(false));
  it('countStuckWip', () =>
    expect(countStuckWip([item({}), item({ status: 'planned' }), item({ updated_at: ago(1) })], NOW)).toBe(1));
});
