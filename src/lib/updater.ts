/**
 * Quantum in-app updater — release discovery, version comparison, settings.
 *
 * The rolling release lives at:
 *   https://api.github.com/repos/dsect-net/quantum/releases/tags/latest
 * CI publishes every main build there (tag `latest`, prerelease) with two
 * assets: `app-debug.apk` and `version.json`
 *   { versionCode, versionName, commitSha, builtAt }.
 * The app compares the release's versionCode against the installed
 * versionCode (Capacitor App.getInfo().build on Android).
 *
 * Native download/install lives in the UpdaterNative Capacitor plugin
 * (android/.../updater/UpdaterPlugin.java); this module never touches it
 * directly — see useUpdater.ts for the orchestrated flow.
 */
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { Preferences } from '@capacitor/preferences';

export const RELEASE_API_URL =
  'https://api.github.com/repos/dsect-net/quantum/releases/tags/latest';

/** Update-check states surfaced to the UI. Never fake one. */
export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'update-available'
  | 'downloading'
  | 'ready-to-install'
  | 'error'
  | 'unsupported';

export interface InstalledBuild {
  versionCode: number;
  versionName: string;
}

export interface ReleaseInfo {
  tagName: string;
  versionCode: number;
  versionName: string;
  commitSha: string;
  builtAt: string;
  /** Direct download URL for app-debug.apk. */
  apkUrl: string;
  /** Release notes body (what's new), may be empty. */
  notes: string;
}

export interface UpdaterSettings {
  /** Check for updates automatically on launch. Default true. */
  autoCheck: boolean;
  /** Only download updates on Wi-Fi. Default false. */
  wifiOnly: boolean;
}

export type UpdaterErrorCode =
  | 'not-found'
  | 'network'
  | 'bad-release'
  | 'native-unavailable';

export class UpdaterError extends Error {
  readonly code: UpdaterErrorCode;
  constructor(code: UpdaterErrorCode, message: string) {
    super(message);
    this.name = 'UpdaterError';
    this.code = code;
  }
}

const UPDATER_SETTINGS_KEY = 'quantum.updater';

export const DEFAULT_UPDATER_SETTINGS: UpdaterSettings =
  Object.freeze({ autoCheck: true, wifiOnly: false });

const memoryStore = new Map<string, string>();

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memoryStore.get(key) ?? null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    memoryStore.set(key, value);
  }
}

export function getUpdaterSettings(): UpdaterSettings {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(storageGet(UPDATER_SETTINGS_KEY) ?? '{}') as Record<string, unknown>;
  } catch {
    raw = {};
  }
  return {
    autoCheck:
      typeof raw.autoCheck === 'boolean' ? raw.autoCheck : DEFAULT_UPDATER_SETTINGS.autoCheck,
    wifiOnly:
      typeof raw.wifiOnly === 'boolean' ? raw.wifiOnly : DEFAULT_UPDATER_SETTINGS.wifiOnly,
  };
}

export async function saveUpdaterSettings(settings: UpdaterSettings): Promise<void> {
  const clean: UpdaterSettings = {
    autoCheck: !!settings.autoCheck,
    wifiOnly: !!settings.wifiOnly,
  };
  const serialized = JSON.stringify(clean);
  storageSet(UPDATER_SETTINGS_KEY, serialized);
  try {
    await Preferences.set({ key: UPDATER_SETTINGS_KEY, value: serialized });
  } catch {
    // localStorage fallback already written above
  }
}

/** Installed build identity. On web there is no native build — honest fallback. */
export async function getInstalledBuild(): Promise<InstalledBuild> {
  if (!Capacitor.isNativePlatform()) {
    return { versionCode: 0, versionName: 'web' };
  }
  const info = await App.getInfo();
  const versionCode = Number.parseInt(info.build, 10);
  return {
    versionCode: Number.isFinite(versionCode) ? versionCode : 0,
    versionName: info.version || 'unknown',
  };
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface ReleaseApiResponse {
  tag_name: string;
  body: string | null;
  assets: ReleaseAsset[];
}

interface VersionJson {
  versionCode: number;
  versionName: string;
  commitSha: string;
  builtAt: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Validate the version.json asset body. Throws UpdaterError('bad-release'). */
export function parseVersionJson(raw: unknown): VersionJson {
  if (!isRecord(raw)) {
    throw new UpdaterError('bad-release', 'Release version.json is not an object.');
  }
  const versionCode = Number(raw.versionCode);
  const versionName = String(raw.versionName ?? '');
  if (!Number.isInteger(versionCode) || versionCode < 0 || !versionName) {
    throw new UpdaterError(
      'bad-release',
      'Release version.json is missing a valid versionCode/versionName.',
    );
  }
  return {
    versionCode,
    versionName,
    commitSha: String(raw.commitSha ?? ''),
    builtAt: String(raw.builtAt ?? ''),
  };
}

/**
 * Fetch the rolling release and its version.json. Throws:
 *  - UpdaterError('not-found') when no `latest` release exists yet (404)
 *  - UpdaterError('network') on transport failure
 *  - UpdaterError('bad-release') when the release lacks version.json/APK
 */
export async function fetchLatestRelease(
  fetchFn: typeof fetch = fetch,
  timeoutMs = 15000,
): Promise<ReleaseInfo> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchFn(RELEASE_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw new UpdaterError(
      'network',
      e instanceof Error && e.name === 'AbortError'
        ? 'Update check timed out.'
        : 'Could not reach the update server.',
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) {
    throw new UpdaterError('not-found', 'No published update yet — check back later.');
  }
  if (!res.ok) {
    throw new UpdaterError('network', `Update server returned HTTP ${res.status}.`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new UpdaterError('bad-release', 'Update server returned an unreadable response.');
  }
  if (!isRecord(body) || !Array.isArray(body.assets)) {
    throw new UpdaterError('bad-release', 'Update server returned an unexpected response.');
  }
  const release = body as unknown as ReleaseApiResponse;

  const versionAsset = release.assets.find((a) => a.name === 'version.json');
  if (!versionAsset) {
    throw new UpdaterError('bad-release', 'Release is missing its version.json asset.');
  }
  const apkAsset = release.assets.find((a) => a.name.endsWith('.apk'));
  if (!apkAsset) {
    throw new UpdaterError('bad-release', 'Release has no APK attached yet.');
  }

  const vctrl = new AbortController();
  const vtimer = setTimeout(() => vctrl.abort(), timeoutMs);
  let versionRaw: unknown;
  try {
    const vres = await fetchFn(versionAsset.browser_download_url, { signal: vctrl.signal });
    if (!vres.ok) {
      throw new UpdaterError('bad-release', 'Could not read the release version info.');
    }
    versionRaw = await vres.json();
  } catch (e) {
    if (e instanceof UpdaterError) throw e;
    throw new UpdaterError('bad-release', 'Could not read the release version info.');
  } finally {
    clearTimeout(vtimer);
  }

  const version = parseVersionJson(versionRaw);
  return {
    tagName: String(release.tag_name ?? 'latest'),
    versionCode: version.versionCode,
    versionName: version.versionName,
    commitSha: version.commitSha,
    builtAt: version.builtAt,
    apkUrl: apkAsset.browser_download_url,
    notes: String(release.body ?? ''),
  };
}

/** True when the release is newer than what's installed. */
export function isUpdateAvailable(
  installed: InstalledBuild,
  latest: Pick<ReleaseInfo, 'versionCode'>,
): boolean {
  return latest.versionCode > installed.versionCode;
}

/**
 * True when a download may start right now under the Wi-Fi-only setting.
 * On native, uses the Capacitor Network plugin; on web the plugin is
 * absent, so a Wi-Fi-only restriction cannot be verified — report blocked
 * honestly rather than guessing.
 */
export async function mayDownloadNow(settings: UpdaterSettings): Promise<{
  ok: boolean;
  reason?: string;
}> {
  if (!settings.wifiOnly) return { ok: true };
  if (!Capacitor.isNativePlatform()) {
    return { ok: false, reason: 'Wi-Fi-only is on, but the connection type cannot be checked here.' };
  }
  try {
    const status = await Network.getStatus();
    if (status.connectionType === 'wifi') return { ok: true };
    return {
      ok: false,
      reason: 'Waiting for Wi-Fi — connect to Wi-Fi or turn off “Wi-Fi only” in Settings.',
    };
  } catch {
    return { ok: false, reason: 'Could not check the connection type.' };
  }
}

/** Human-readable one-liner for a release, used in prompts and diagnostics. */
export function describeRelease(r: ReleaseInfo): string {
  const when = r.builtAt ? ` · built ${r.builtAt.slice(0, 10)}` : '';
  return `v${r.versionName} (build ${r.versionCode})${when}`;
}
