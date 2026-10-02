/**
 * TypeScript surface for the native UpdaterNative Capacitor plugin
 * (android/.../updater/UpdaterPlugin.java).
 *
 * The plugin only exists in the Android build. Every call must be guarded
 * by isNativeUpdaterAvailable() — on web the calls reject, and the UI
 * reports "not available on this platform" honestly.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface DownloadProgress {
  /** one of: pending | running | paused | complete | failed */
  status: string;
  bytesDownloaded: number;
  bytesTotal: number;
}

export interface UpdaterNativePlugin {
  downloadUpdate(options: { url: string }): Promise<{ downloadId: string }>;
  getDownloadProgress(options: { downloadId: string }): Promise<DownloadProgress>;
  /** Launches the Android package installer for the downloaded APK. */
  installUpdate(options: { downloadId: string }): Promise<{ started: boolean }>;
  /** Android 8+: whether the app may request package installs. */
  canInstallPackages(): Promise<{ granted: boolean }>;
  /** Android 8+: opens the per-app "install unknown apps" settings page. */
  openUnknownSourcesSettings(): Promise<void>;
}

const UpdaterNative = registerPlugin<UpdaterNativePlugin>('UpdaterNative', {
  // No web implementation: web builds genuinely cannot self-install.
});

export function isNativeUpdaterAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

export { UpdaterNative };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Download an APK via the native DownloadManager, polling progress.
 * Resolves when the download completes; rejects on failure/cancel.
 */
export async function downloadUpdateWithProgress(
  url: string,
  onProgress: (fraction: number) => void,
  pollMs = 500,
): Promise<string> {
  const { downloadId } = await UpdaterNative.downloadUpdate({ url });
  for (;;) {
    const s = await UpdaterNative.getDownloadProgress({ downloadId });
    if (s.status === 'complete') return downloadId;
    if (s.status === 'failed') {
      throw new Error('Download failed — please retry.');
    }
    if (s.bytesTotal > 0) {
      onProgress(Math.min(1, s.bytesDownloaded / s.bytesTotal));
    }
    await sleep(pollMs);
  }
}
