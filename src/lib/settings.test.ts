/**
 * Settings validation: malformed URLs are rejected, empty stays valid
 * (empty = honest demo mode), and well-formed URLs pass.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_SETTINGS,
  isDemoMode,
  normalizeBaseUrl,
  validateBaseUrl,
} from './settings';

describe('validateBaseUrl', () => {
  it('accepts empty as demo mode', () => {
    expect(validateBaseUrl('')).toBeNull();
    expect(validateBaseUrl('   ')).toBeNull();
    expect(validateBaseUrl(undefined)).toBeNull();
  });

  it('accepts well-formed http/https URLs', () => {
    expect(validateBaseUrl('https://tritium-linux.fairy-chinstrap.ts.net')).toBeNull();
    expect(validateBaseUrl('https://tritium-linux.fairy-chinstrap.ts.net:8188')).toBeNull();
    expect(validateBaseUrl('http://100.66.182.7:8088/v1')).toBeNull();
  });

  it('rejects malformed URLs', () => {
    expect(validateBaseUrl('not a url')).not.toBeNull();
    expect(validateBaseUrl('tritium-linux')).not.toBeNull();
    expect(validateBaseUrl('ftp://files.example.com')).not.toBeNull();
    expect(validateBaseUrl('://missing-scheme')).not.toBeNull();
  });
});

describe('normalizeBaseUrl', () => {
  it('trims and drops trailing slashes', () => {
    expect(normalizeBaseUrl('  https://x.ts.net/  ')).toBe('https://x.ts.net');
    expect(normalizeBaseUrl('https://x.ts.net///')).toBe('https://x.ts.net');
    expect(normalizeBaseUrl('')).toBe('');
  });
});

describe('isDemoMode', () => {
  it('is true when nothing is configured', () => {
    expect(isDemoMode(EMPTY_SETTINGS)).toBe(true);
  });

  it('is false when any service has a URL', () => {
    expect(
      isDemoMode({
        ...EMPTY_SETTINGS,
        relay: { baseUrl: 'https://team.dsect.net/api/relay' },
      }),
    ).toBe(false);
  });
});
