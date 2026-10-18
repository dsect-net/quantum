import { describe, expect, it } from 'vitest';
import {
  compactCount,
  fullTime,
  initials,
  postKindLabel,
  postKindTone,
  relativeTime,
  withAt,
} from './format';

const NOW = new Date('2026-10-18T12:00:00Z');

describe('relativeTime', () => {
  it('renders compact buckets', () => {
    expect(relativeTime(new Date(NOW.getTime() - 5_000).toISOString(), NOW)).toBe('now');
    expect(relativeTime(new Date(NOW.getTime() - 90_000).toISOString(), NOW)).toBe('1m');
    expect(relativeTime(new Date(NOW.getTime() - 3 * 3600_000).toISOString(), NOW)).toBe('3h');
    expect(relativeTime(new Date(NOW.getTime() - 2 * 86400_000).toISOString(), NOW)).toBe('2d');
  });

  it('falls back to a date beyond a week and tolerates bad input', () => {
    const old = relativeTime('2026-01-01T00:00:00Z', NOW);
    expect(old).not.toMatch(/^\d+[mhd]$/);
    expect(relativeTime('not-a-date', NOW)).toBe('');
  });

  it('shows now for future timestamps (clock skew)', () => {
    expect(relativeTime(new Date(NOW.getTime() + 60_000).toISOString(), NOW)).toBe('now');
  });
});

describe('initials', () => {
  it('handles one name, two names, and empty', () => {
    expect(initials('scotty')).toBe('SC');
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('  ')).toBe('?');
  });
});

describe('withAt / compactCount', () => {
  it('adds @ only when missing', () => {
    expect(withAt('cooper')).toBe('@cooper');
    expect(withAt('@cooper')).toBe('@cooper');
  });

  it('compacts counts', () => {
    expect(compactCount(0)).toBe('0');
    expect(compactCount(999)).toBe('999');
    expect(compactCount(1500)).toBe('1.5k');
    expect(compactCount(23_000)).toBe('23k');
  });
});

describe('post kind labels', () => {
  it('maps kinds to labels and tones', () => {
    expect(postKindLabel('collab')).toBe('Collab');
    expect(postKindLabel('post')).toBe('Post');
    expect(postKindTone('announcement')).toBe('accent');
    expect(postKindTone('unknown')).toBe('muted');
  });
});

describe('fullTime', () => {
  it('renders a locale string and tolerates bad input', () => {
    expect(fullTime('2026-10-18T12:00:00Z').length).toBeGreaterThan(0);
    expect(fullTime('nope')).toBe('');
  });
});
