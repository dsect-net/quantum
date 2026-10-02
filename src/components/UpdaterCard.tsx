/**
 * UpdaterCard — the full updater UI for Settings (and reuse in Debug).
 *
 * Shows installed build, check state, toggles, download progress, and the
 * install handoff. Every state comes from the useUpdater hook — nothing is
 * faked. DSECT components only, Light-theme default.
 */
import { Badge, ProgressBar, Spinner } from '@dsect/ui/components/feedback';
import { Card } from '@dsect/ui/components/surfaces';
import { QButton, QToggle } from '../lib/untitled';
import { useLongPress } from '../lib/useLongPress';
import { describeRelease } from '../lib/updater';
import type { useUpdater } from '../lib/useUpdater';

type Updater = ReturnType<typeof useUpdater>;

function StatusBadge({ updater }: { updater: Updater }) {
  const { status } = updater;
  if (status === 'checking' || status === 'downloading') {
    return (
      <span className="inline-flex items-center gap-2">
        <Spinner size="sm" label={status === 'checking' ? 'Checking' : 'Downloading'} />
        <Badge tone="info" size="sm" dot>
          {status === 'checking' ? 'Checking…' : 'Downloading…'}
        </Badge>
      </span>
    );
  }
  if (status === 'up-to-date') {
    return (
      <Badge tone="ok" size="sm" dot>
        Up to date
      </Badge>
    );
  }
  if (status === 'update-available') {
    return (
      <Badge tone="warn" size="sm" dot>
        Update available
      </Badge>
    );
  }
  if (status === 'ready-to-install') {
    return (
      <Badge tone="info" size="sm" dot>
        Ready to install
      </Badge>
    );
  }
  if (status === 'error') {
    return (
      <Badge tone="err" size="sm" dot>
        Error
      </Badge>
    );
  }
  if (status === 'unsupported') {
    return (
      <Badge tone="slate" size="sm">
        Not available here
      </Badge>
    );
  }
  return (
    <Badge tone="slate" size="sm">
      Idle
    </Badge>
  );
}

export function UpdaterCard({ updater }: { updater: Updater }) {
  const { status, installed, release, progress, error, needsInstallPermission, settings } = updater;
  // Long-press the card header to force a fresh check.
  const lp = useLongPress({ onLongPress: () => updater.check() });

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div {...lp} className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">App updates</h3>
          <StatusBadge updater={updater} />
        </div>

        <p className="text-sm text-text-secondary">
          Installed:{' '}
          <span className="font-mono">
            {installed ? `v${installed.versionName} (build ${installed.versionCode})` : '—'}
          </span>
        </p>

        {status === 'unsupported' && (
          <p className="text-sm text-text-secondary">
            Self-update only works in the installed Android app — not in a
            browser preview.
          </p>
        )}

        {status === 'update-available' && release && (
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <p className="font-medium">{describeRelease(release)}</p>
            {release.notes && (
              <p className="max-h-24 overflow-y-auto whitespace-pre-wrap text-sm text-text-secondary">
                {release.notes.slice(0, 600)}
              </p>
            )}
            <QButton color="primary" onPress={() => updater.download()}>
              Download update
            </QButton>
          </div>
        )}

        {status === 'downloading' && (
          <div className="flex flex-col gap-2">
            <ProgressBar value={Math.round(progress * 100)} label="Downloading update" />
            <p className="text-sm text-text-secondary">{Math.round(progress * 100)}%</p>
          </div>
        )}

        {status === 'ready-to-install' && (
          <div className="flex flex-col gap-2">
            {needsInstallPermission ? (
              <>
                <p className="text-sm text-text-secondary">
                  Android needs your permission before Quantum can install
                  updates. Allow “install unknown apps” for Quantum, then come
                  back and tap Install.
                </p>
                <div className="flex flex-wrap gap-2">
                  <QButton color="primary" onPress={() => updater.openPermissionSettings()}>
                    Open install settings
                  </QButton>
                  <QButton color="secondary" onPress={() => updater.install()}>
                    I've allowed it — install
                  </QButton>
                </div>
              </>
            ) : (
              <QButton color="primary" onPress={() => updater.install()}>
                Install update
              </QButton>
            )}
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-text-danger">{error ?? 'Something went wrong.'}</p>
            <div className="flex flex-wrap gap-2">
              <QButton color="secondary" onPress={() => updater.check()}>
                Retry
              </QButton>
              <QButton color="secondary" onPress={() => updater.dismiss()}>
                Dismiss
              </QButton>
            </div>
          </div>
        )}

        {(status === 'idle' || status === 'up-to-date' || status === 'error') && (
          <div className="flex flex-wrap gap-2">
            <QButton
              color="secondary"
              size="md"
              onPress={() => updater.check()}
            >
              Check for updates
            </QButton>
          </div>
        )}

        <div className="flex flex-col gap-3 border-t pt-3">
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block font-medium">Check on launch</span>
              <span className="block text-sm text-text-secondary">
                Look for updates every time the app starts.
              </span>
            </span>
            <QToggle
              aria-label="Check for updates on launch"
              isSelected={settings.autoCheck}
              onChange={(v) => updater.updateSettings({ autoCheck: v })}
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block font-medium">Wi-Fi only downloads</span>
              <span className="block text-sm text-text-secondary">
                Wait for Wi-Fi before downloading an update.
              </span>
            </span>
            <QToggle
              aria-label="Download updates on Wi-Fi only"
              isSelected={settings.wifiOnly}
              onChange={(v) => updater.updateSettings({ wifiOnly: v })}
            />
          </label>
        </div>

        <p className="text-xs text-text-tertiary">
          Tip: long-press this card's header to force a fresh check.
        </p>
      </div>
    </Card>
  );
}
