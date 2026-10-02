/**
 * UpdatePrompt — the launch-time update dialog.
 *
 * Shown when an automatic (or manual) check finds a newer build. DSECT
 * Dialog, Light-theme default. Download shows live progress, then hands
 * off to the Android installer.
 */
import { Dialog } from '@dsect/ui/components/overlays';
import { ProgressBar } from '@dsect/ui/components/feedback';
import { QButton } from '../lib/untitled';
import { describeRelease } from '../lib/updater';
import type { useUpdater } from '../lib/useUpdater';

type Updater = ReturnType<typeof useUpdater>;

export function UpdatePrompt({ updater }: { updater: Updater }) {
  const { status, release, progress, needsInstallPermission } = updater;
  const open = status === 'update-available' || status === 'downloading' || status === 'ready-to-install';
  if (!open || !release) return null;

  return (
    <Dialog
      open={open}
      onClose={() => updater.dismiss()}
      title="Update available"
      closeLabel="Later"
      footer={
        status === 'update-available' ? (
          <>
            <QButton color="secondary" onPress={() => updater.dismiss()}>
              Later
            </QButton>
            <QButton color="primary" onPress={() => updater.download()}>
              Download
            </QButton>
          </>
        ) : status === 'downloading' ? (
          <QButton color="secondary" onPress={() => updater.dismiss()}>
            Background
          </QButton>
        ) : needsInstallPermission ? (
          <>
            <QButton color="secondary" onPress={() => updater.dismiss()}>
              Later
            </QButton>
            <QButton color="primary" onPress={() => updater.openPermissionSettings()}>
              Open install settings
            </QButton>
          </>
        ) : (
          <>
            <QButton color="secondary" onPress={() => updater.dismiss()}>
              Later
            </QButton>
            <QButton color="primary" onPress={() => updater.install()}>
              Install now
            </QButton>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <p className="font-medium">{describeRelease(release)}</p>
        {release.notes && (
          <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-sm text-text-secondary">
            {release.notes.slice(0, 800)}
          </p>
        )}
        {status === 'downloading' && (
          <div className="flex flex-col gap-2">
            <ProgressBar value={Math.round(progress * 100)} label="Downloading update" />
            <p className="text-sm text-text-secondary">{Math.round(progress * 100)}%</p>
          </div>
        )}
        {status === 'ready-to-install' && !needsInstallPermission && (
          <p className="text-sm text-text-secondary">
            Download complete — ready to install.
          </p>
        )}
        {status === 'ready-to-install' && needsInstallPermission && (
          <p className="text-sm text-text-secondary">
            Android needs permission before Quantum can install updates. Open
            install settings, allow “install unknown apps” for Quantum, then
            install.
          </p>
        )}
      </div>
    </Dialog>
  );
}
