/**
 * useUpdater check(): the Installed readout must survive a release-fetch
 * failure (Promise.allSettled, not Promise.all).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({}),
}));

vi.mock('@capacitor/app', () => ({
  App: {
    getInfo: vi.fn(async () => ({
      id: 'net.dsect.quantum',
      name: 'Quantum',
      build: '7',
      version: '2026.10.02-7',
    })),
  },
}));

const fetchLatestRelease = vi.fn();

vi.mock('./updater', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return { ...orig, fetchLatestRelease };
});

import { UpdaterError } from './updater';
import { useUpdater } from './useUpdater';

const RELEASE = {
  tagName: 'latest',
  versionCode: 7,
  versionName: '2026.10.02-7',
  commitSha: 'abc',
  builtAt: '2026-10-02T17:00:00Z',
  apkUrl: 'https://example.com/app-debug.apk',
  notes: 'notes',
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('useUpdater check() resilience', () => {
  it('still shows Installed when the release fetch fails (non-silent)', async () => {
    fetchLatestRelease.mockRejectedValueOnce(
      new UpdaterError('bad-release', 'Could not read the release version info.'),
    );
    const { result } = renderHook(() => useUpdater());
    await act(async () => {
      await result.current.check();
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toContain('Could not read the release version info.');
    // The installed build readout survives the release failure.
    expect(result.current.installed).toMatchObject({ versionCode: 7 });
  });

  it('keeps Installed on silent-check failure without surfacing the error', async () => {
    fetchLatestRelease.mockRejectedValueOnce(new UpdaterError('network', 'down'));
    const { result } = renderHook(() => useUpdater());
    await act(async () => {
      await result.current.check({ silent: true });
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.installed).toMatchObject({ versionCode: 7 });
  });

  it('reports up-to-date when builds match', async () => {
    fetchLatestRelease.mockResolvedValueOnce(RELEASE);
    const { result } = renderHook(() => useUpdater());
    await act(async () => {
      await result.current.check();
    });
    expect(result.current.status).toBe('up-to-date');
    expect(result.current.installed).toMatchObject({ versionCode: 7 });
    expect(result.current.release?.versionCode).toBe(7);
  });

  it('reports update-available when the release is newer', async () => {
    fetchLatestRelease.mockResolvedValueOnce({ ...RELEASE, versionCode: 8 });
    const { result } = renderHook(() => useUpdater());
    await act(async () => {
      await result.current.check();
    });
    expect(result.current.status).toBe('update-available');
    expect(result.current.installed).toMatchObject({ versionCode: 7 });
  });
});
