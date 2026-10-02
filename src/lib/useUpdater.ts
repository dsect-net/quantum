/**
 * useUpdater — state machine for the in-app updater.
 *
 * States: idle → checking → up-to-date | update-available | error
 *          update-available → downloading → ready-to-install → (installing)
 *          error carries a human message + retry. 'unsupported' on web.
 *
 * The hook never fakes a state: every transition comes from a real check,
 * a real download, or a real native call.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { debugLog } from './debug';
import {
  UpdaterError,
  describeRelease,
  fetchLatestRelease,
  getInstalledBuild,
  getUpdaterSettings,
  isUpdateAvailable,
  mayDownloadNow,
  saveUpdaterSettings,
  type InstalledBuild,
  type ReleaseInfo,
  type UpdaterSettings,
  type UpdaterStatus,
} from './updater';
import {
  UpdaterNative,
  downloadUpdateWithProgress,
  isNativeUpdaterAvailable,
} from './updaterNative';

export interface UpdaterState {
  status: UpdaterStatus;
  installed: InstalledBuild | null;
  release: ReleaseInfo | null;
  progress: number;
  error: string | null;
  /** Android 8+: the app still needs the "install unknown apps" grant. */
  needsInstallPermission: boolean;
  settings: UpdaterSettings;
}

const INITIAL: UpdaterState = {
  status: 'idle',
  installed: null,
  release: null,
  progress: 0,
  error: null,
  needsInstallPermission: false,
  settings: { autoCheck: true, wifiOnly: false },
};

export function useUpdater() {
  const [state, setState] = useState<UpdaterState>(INITIAL);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    setState((s) => ({ ...s, settings: getUpdaterSettings() }));
    return () => {
      mounted.current = false;
    };
  }, []);

  const set = useCallback((patch: Partial<UpdaterState>) => {
    if (mounted.current) setState((s) => ({ ...s, ...patch }));
  }, []);

  const fail = useCallback(
    (e: unknown) => {
      const message =
        e instanceof UpdaterError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Something went wrong.';
      debugLog('updater', `Update check failed: ${message}`, 'error');
      set({ status: 'error', error: message, progress: 0 });
    },
    [set],
  );

  /** Check for an update. Silent mode never surfaces errors to state. */
  const check = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      const { silent = false } = opts;
      if (!isNativeUpdaterAvailable()) {
        if (!silent) set({ status: 'unsupported', error: null });
        return;
      }
      set({ status: 'checking', error: null, progress: 0, needsInstallPermission: false });
      debugLog('updater', 'Checking for updates…');
      // allSettled, not all: a release-fetch failure must never blank the
      // Installed readout — the two halves are independent facts.
      const [installedRes, releaseRes] = await Promise.allSettled([
        getInstalledBuild(),
        fetchLatestRelease(),
      ]);
      const installed = installedRes.status === 'fulfilled' ? installedRes.value : null;
      if (releaseRes.status === 'rejected') {
        const e = releaseRes.reason;
        if (silent) {
          debugLog(
            'updater',
            `Silent check failed: ${e instanceof Error ? e.message : String(e)}`,
            'warn',
          );
          set({ status: 'idle', installed });
        } else {
          if (installed) set({ installed });
          fail(e);
        }
        return;
      }
      const release = releaseRes.value;
      if (!installed) {
        // Extremely unlikely (App.getInfo failed) — still report the release.
        fail(new UpdaterError('network', 'Could not read the installed app version.'));
        return;
      }
      if (isUpdateAvailable(installed, release)) {
        debugLog('updater', `Update available: ${describeRelease(release)}`);
        set({ status: 'update-available', installed, release });
      } else {
        debugLog('updater', `Up to date (build ${installed.versionCode}).`);
        set({ status: 'up-to-date', installed, release });
      }
    },
    [fail, set],
  );

  // Ref so callbacks always see fresh state without re-creating.
  const stateRef = useRef(state);
  stateRef.current = state;

  const download = useCallback(async () => {
    const { release, settings } = stateRef.current;
    if (!release) return;
    if (!isNativeUpdaterAvailable()) {
      set({ status: 'unsupported' });
      return;
    }
    const gate = await mayDownloadNow(settings);
    if (!gate.ok) {
      set({ status: 'error', error: gate.reason ?? 'Download blocked.' });
      return;
    }
    set({ status: 'downloading', progress: 0, error: null });
    debugLog('updater', `Downloading ${describeRelease(release)}…`);
    try {
      const downloadId = await downloadUpdateWithProgress(release.apkUrl, (p) =>
        set({ progress: p }),
      );
      debugLog('updater', `Download complete (id ${downloadId}).`);
      set({ status: 'ready-to-install', progress: 1 });
    } catch (e) {
      fail(e);
    }
  }, [fail, set]);

  const install = useCallback(async () => {
    if (!isNativeUpdaterAvailable()) {
      set({ status: 'unsupported' });
      return;
    }
    try {
      const { granted } = await UpdaterNative.canInstallPackages();
      if (!granted) {
        debugLog('updater', 'Install permission not granted — guiding user to settings.', 'warn');
        set({ needsInstallPermission: true });
        return;
      }
      set({ needsInstallPermission: false });
      // The download id is not needed by installUpdate (single-slot cache),
      // but the plugin API takes it for future multi-download support.
      await UpdaterNative.installUpdate({ downloadId: 'latest' });
      debugLog('updater', 'Handed APK to the package installer.');
    } catch (e) {
      fail(e);
    }
  }, [fail, set]);

  const openPermissionSettings = useCallback(async () => {
    try {
      await UpdaterNative.openUnknownSourcesSettings();
      debugLog('updater', 'Opened unknown-sources settings.');
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  const dismiss = useCallback(() => {
    set({
      status: 'idle',
      release: null,
      progress: 0,
      error: null,
      needsInstallPermission: false,
    });
  }, [set]);

  const updateSettings = useCallback(
    async (patch: Partial<UpdaterSettings>) => {
      const next = { ...stateRef.current.settings, ...patch };
      await saveUpdaterSettings(next);
      set({ settings: next });
      debugLog('updater', `Settings: autoCheck=${next.autoCheck} wifiOnly=${next.wifiOnly}.`);
    },
    [set],
  );

  return { ...state, check, download, install, openPermissionSettings, dismiss, updateSettings };
}
