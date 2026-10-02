/**
 * Updater lib: version comparison, release parsing, settings defaults.
 *
 * Network calls are fully mocked — these tests never hit GitHub.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  UpdaterError,
  DEFAULT_UPDATER_SETTINGS,
  describeRelease,
  fetchLatestRelease,
  getUpdaterSettings,
  isUpdateAvailable,
  mayDownloadNow,
  parseVersionComment,
  parseVersionJson,
  saveUpdaterSettings,
  stripVersionComment,
} from './updater';

const VERSION_JSON = {
  versionCode: 42,
  versionName: '2026.10.02-42',
  commitSha: 'abc123def456',
  builtAt: '2026-10-02T15:00:00Z',
};

function releaseApi(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: 'latest',
    body: '## Changes\n- things',
    assets: [
      {
        name: 'version.json',
        browser_download_url: 'https://example.com/version.json',
      },
      {
        name: 'app-debug.apk',
        browser_download_url: 'https://example.com/app-debug.apk',
      },
    ],
    ...overrides,
  };
}

/** Minimal fetch stub keyed by URL. */
function mockFetch(
  handlers: Record<string, { status: number; json: unknown } | { throws: Error }>,
): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const h = handlers[url];
    if (!h) throw new Error(`unexpected fetch: ${url}`);
    if ('throws' in h) throw h.throws;
    return {
      ok: h.status >= 200 && h.status < 300,
      status: h.status,
      json: async () => h.json,
    } as Response;
  }) as typeof fetch;
}

const RELEASE_URL = 'https://api.github.com/repos/dsect-net/quantum/releases/tags/latest';

describe('isUpdateAvailable', () => {
  it('is true when the release build is newer', () => {
    expect(isUpdateAvailable({ versionCode: 41, versionName: 'x' }, { versionCode: 42 })).toBe(
      true,
    );
  });

  it('is false when builds are equal', () => {
    expect(isUpdateAvailable({ versionCode: 42, versionName: 'x' }, { versionCode: 42 })).toBe(
      false,
    );
  });

  it('is false when installed is newer (downgrade guard)', () => {
    expect(isUpdateAvailable({ versionCode: 50, versionName: 'x' }, { versionCode: 42 })).toBe(
      false,
    );
  });
});

describe('parseVersionJson', () => {
  it('parses a valid version.json', () => {
    expect(parseVersionJson(VERSION_JSON)).toEqual(VERSION_JSON);
  });

  it('rejects a missing versionCode', () => {
    expect(() => parseVersionJson({ versionName: 'x' })).toThrowError(UpdaterError);
    try {
      parseVersionJson({ versionName: 'x' });
    } catch (e) {
      expect((e as UpdaterError).code).toBe('bad-release');
    }
  });

  it('rejects non-object bodies', () => {
    expect(() => parseVersionJson(null)).toThrowError(UpdaterError);
    expect(() => parseVersionJson('nope')).toThrowError(UpdaterError);
  });

  it('rejects negative or fractional versionCodes', () => {
    expect(() => parseVersionJson({ ...VERSION_JSON, versionCode: -1 })).toThrowError(
      UpdaterError,
    );
    expect(() => parseVersionJson({ ...VERSION_JSON, versionCode: 1.5 })).toThrowError(
      UpdaterError,
    );
  });
});

describe('fetchLatestRelease', () => {
  it('returns release info on the happy path', async () => {
    const fetchFn = mockFetch({
      [RELEASE_URL]: { status: 200, json: releaseApi() },
      'https://example.com/version.json': { status: 200, json: VERSION_JSON },
    });
    const r = await fetchLatestRelease(fetchFn);
    expect(r.versionCode).toBe(42);
    expect(r.versionName).toBe('2026.10.02-42');
    expect(r.apkUrl).toBe('https://example.com/app-debug.apk');
    expect(r.commitSha).toBe('abc123def456');
    expect(r.notes).toContain('Changes');
  });

  it('throws not-found on 404 (no release published yet)', async () => {
    const fetchFn = mockFetch({ [RELEASE_URL]: { status: 404, json: {} } });
    await expect(fetchLatestRelease(fetchFn)).rejects.toMatchObject({ code: 'not-found' });
  });

  it('throws network on 5xx', async () => {
    const fetchFn = mockFetch({ [RELEASE_URL]: { status: 500, json: {} } });
    await expect(fetchLatestRelease(fetchFn)).rejects.toMatchObject({ code: 'network' });
  });

  it('throws network when fetch itself fails', async () => {
    const fetchFn = mockFetch({ [RELEASE_URL]: { throws: new Error('down') } });
    await expect(fetchLatestRelease(fetchFn)).rejects.toMatchObject({ code: 'network' });
  });

  it('throws bad-release when version.json asset is missing', async () => {
    const fetchFn = mockFetch({
      [RELEASE_URL]: {
        status: 200,
        json: releaseApi({
          assets: [{ name: 'app-debug.apk', browser_download_url: 'https://example.com/a.apk' }],
        }),
      },
    });
    await expect(fetchLatestRelease(fetchFn)).rejects.toMatchObject({ code: 'bad-release' });
  });

  it('throws bad-release when no APK asset is attached', async () => {
    const fetchFn = mockFetch({
      [RELEASE_URL]: {
        status: 200,
        json: releaseApi({
          assets: [{ name: 'version.json', browser_download_url: 'https://example.com/v.json' }],
        }),
      },
      'https://example.com/v.json': { status: 200, json: VERSION_JSON },
    });
    await expect(fetchLatestRelease(fetchFn)).rejects.toMatchObject({ code: 'bad-release' });
  });

  it('throws bad-release when version.json is malformed', async () => {
    const fetchFn = mockFetch({
      [RELEASE_URL]: { status: 200, json: releaseApi() },
      'https://example.com/version.json': { status: 200, json: { nope: true } },
    });
    await expect(fetchLatestRelease(fetchFn)).rejects.toMatchObject({ code: 'bad-release' });
  });

  it('prefers the embedded version comment and never fetches the asset', async () => {
    const body =
      '## Changes\n- things\n\n<!-- quantum-version: {"versionCode":43,"versionName":"2026.10.02-43","commitSha":"deadbeef","builtAt":"2026-10-02T16:00:00Z"} -->';
    // Note: no handler for the version.json URL — mockFetch throws on any
    // unexpected fetch, so this proves the asset is never requested.
    const fetchFn = mockFetch({ [RELEASE_URL]: { status: 200, json: releaseApi({ body }) } });
    const r = await fetchLatestRelease(fetchFn);
    expect(r.versionCode).toBe(43);
    expect(r.versionName).toBe('2026.10.02-43');
    expect(r.commitSha).toBe('deadbeef');
    expect(r.notes).toContain('Changes');
    expect(r.notes).not.toContain('quantum-version');
  });

  it('falls back to the version.json asset when the body has no comment (older releases)', async () => {
    const fetchFn = mockFetch({
      [RELEASE_URL]: { status: 200, json: releaseApi() },
      'https://example.com/version.json': { status: 200, json: VERSION_JSON },
    });
    const r = await fetchLatestRelease(fetchFn);
    expect(r.versionCode).toBe(42);
  });

  it('falls back to the asset when the comment JSON is malformed', async () => {
    const body = 'notes\n<!-- quantum-version: {not json} -->';
    const fetchFn = mockFetch({
      [RELEASE_URL]: { status: 200, json: releaseApi({ body }) },
      'https://example.com/version.json': { status: 200, json: VERSION_JSON },
    });
    const r = await fetchLatestRelease(fetchFn);
    expect(r.versionCode).toBe(42);
  });

  it('treats an asset-fetch CORS-style failure as bad-release, not network', async () => {
    // In the Android WebView the asset fetch dies with a TypeError (no
    // ACAO header on the redirect target) — that is a broken release
    // path, not a network outage: the metadata fetch above succeeded.
    const fetchFn = mockFetch({
      [RELEASE_URL]: { status: 200, json: releaseApi() },
      'https://example.com/version.json': { throws: new TypeError('Failed to fetch') },
    });
    await expect(fetchLatestRelease(fetchFn)).rejects.toMatchObject({ code: 'bad-release' });
  });

  it('throws bad-release when neither comment nor version.json asset exists', async () => {
    const fetchFn = mockFetch({
      [RELEASE_URL]: {
        status: 200,
        json: releaseApi({
          assets: [{ name: 'app-debug.apk', browser_download_url: 'https://example.com/a.apk' }],
        }),
      },
    });
    await expect(fetchLatestRelease(fetchFn)).rejects.toMatchObject({ code: 'bad-release' });
  });
});

describe('parseVersionComment', () => {
  const comment =
    '<!-- quantum-version: {"versionCode":7,"versionName":"2026.10.02-7","commitSha":"abc","builtAt":"2026-10-02T17:00:00Z"} -->';

  it('parses a valid embedded comment', () => {
    const v = parseVersionComment(`Some notes\n\n${comment}\n`);
    expect(v).toMatchObject({ versionCode: 7, versionName: '2026.10.02-7' });
  });

  it('returns null when no comment is present', () => {
    expect(parseVersionComment('## Changes\n- things')).toBeNull();
    expect(parseVersionComment('')).toBeNull();
    expect(parseVersionComment(null)).toBeNull();
  });

  it('returns null when the comment JSON is malformed', () => {
    expect(parseVersionComment('<!-- quantum-version: {oops} -->')).toBeNull();
  });

  it('returns null when the comment fails version validation', () => {
    expect(
      parseVersionComment('<!-- quantum-version: {"versionCode":"x","versionName":"y"} -->'),
    ).toBeNull();
  });

  it('takes the first comment when several are present', () => {
    const body = `${comment}\n<!-- quantum-version: {"versionCode":99,"versionName":"z","commitSha":"","builtAt":""} -->`;
    expect(parseVersionComment(body)?.versionCode).toBe(7);
  });

  it('tolerates whitespace variants', () => {
    const v = parseVersionComment(
      '<!--quantum-version:{"versionCode":8,"versionName":"n","commitSha":"","builtAt":""}-->',
    );
    expect(v?.versionCode).toBe(8);
  });
});

describe('stripVersionComment', () => {
  it('removes the comment and trims the notes', () => {
    expect(stripVersionComment('Notes here\n\n<!-- quantum-version: {"a":1} -->\n')).toBe(
      'Notes here',
    );
  });

  it('leaves clean bodies alone', () => {
    expect(stripVersionComment('## Changes')).toBe('## Changes');
    expect(stripVersionComment(null)).toBe('');
  });
});

describe('updater settings', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to auto-check on, Wi-Fi-only off', () => {
    expect(getUpdaterSettings()).toEqual(DEFAULT_UPDATER_SETTINGS);
    expect(DEFAULT_UPDATER_SETTINGS).toEqual({ autoCheck: true, wifiOnly: false });
  });

  it('round-trips through save/load', async () => {
    await saveUpdaterSettings({ autoCheck: false, wifiOnly: true });
    expect(getUpdaterSettings()).toEqual({ autoCheck: false, wifiOnly: true });
  });

  it('ignores malformed stored values', () => {
    window.localStorage.setItem('quantum.updater', '{oops');
    expect(getUpdaterSettings()).toEqual(DEFAULT_UPDATER_SETTINGS);
  });
});

describe('mayDownloadNow', () => {
  it('allows downloads when Wi-Fi-only is off', async () => {
    const r = await mayDownloadNow({ autoCheck: true, wifiOnly: false });
    expect(r.ok).toBe(true);
  });

  it('blocks honestly when Wi-Fi-only is on but the connection cannot be checked (web)', async () => {
    // jsdom is not a native platform: the Network plugin is absent.
    const r = await mayDownloadNow({ autoCheck: true, wifiOnly: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Wi-Fi/);
  });
});

describe('describeRelease', () => {
  it('formats version, build, and date', () => {
    expect(
      describeRelease({
        tagName: 'latest',
        versionCode: 42,
        versionName: '2026.10.02-42',
        commitSha: 'abc',
        builtAt: '2026-10-02T15:00:00Z',
        apkUrl: 'https://example.com/a.apk',
        notes: '',
      }),
    ).toBe('v2026.10.02-42 (build 42) · built 2026-10-02');
  });

  it('omits the date when builtAt is empty', () => {
    expect(
      describeRelease({
        tagName: 'latest',
        versionCode: 7,
        versionName: 'x',
        commitSha: '',
        builtAt: '',
        apkUrl: '',
        notes: '',
      }),
    ).toBe('vx (build 7)');
  });
});

describe('UpdaterError', () => {
  it('carries its code', () => {
    const e = new UpdaterError('not-found', 'none yet');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('not-found');
    expect(e.message).toBe('none yet');
  });

  it('is the only thing fetchLatestRelease throws', async () => {
    const fetchFn = mockFetch({ [RELEASE_URL]: { throws: new Error('boom') } });
    const err = await fetchLatestRelease(fetchFn).catch((e) => e);
    expect(err).toBeInstanceOf(UpdaterError);
    expect(vi.isMockFunction(fetchFn)).toBe(false); // plain stub, sanity
  });
});
