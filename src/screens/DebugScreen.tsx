/**
 * Debug screen (Scotty-only, behind the upper-right debug toggle).
 *
 * Dev capabilities: per-service connection diagnostics with re-test,
 * a settings inspector (redacted — shows only whether secrets are set,
 * never their values), an in-memory log viewer, and a full settings
 * reset back to honest demo mode.
 */
import { useCallback, useEffect, useState } from 'react';
import { Badge, EmptyState, Spinner } from '@dsect/ui/components/feedback';
import { Card } from '@dsect/ui/components/surfaces';
import { QButton, QToggle } from '../lib/untitled';
import { useLongPress } from '../lib/useLongPress';
import {
  SERVICE_META,
  getSettings,
  saveSettings,
  testServiceConnection,
  type QuantumSettings,
  type ServiceId,
} from '../lib/settings';
import { clearLog, debugLog, getLog, onLog, type LogEntry } from '../lib/debug';
import { bootTheme } from '../theme';
import { useUpdater } from '../lib/useUpdater';
import { describeRelease } from '../lib/updater';

type ProbeState = 'idle' | 'running' | 'ok' | 'fail';

interface Probe {
  state: ProbeState;
  detail: string;
}

const SERVICE_IDS: ServiceId[] = ['hub', 'nebula', 'relay', 'sol'];

function redact(settings: QuantumSettings): Record<string, string> {
  const rows: Record<string, string> = {};
  for (const id of SERVICE_IDS) {
    rows[`${SERVICE_META[id].label} URL`] = settings[id].baseUrl || '(not set — demo mode)';
  }
  rows['MCP worker key'] = settings.mcpKey ? '(set)' : '(not set)';
  rows['Nebula passphrase'] = settings.nebulaPassphrase ? '(set)' : '(not set)';
  return rows;
}

function DiagnosticRow({
  service,
  probe,
  onTest,
}: {
  service: ServiceId;
  probe: Probe;
  onTest: () => void;
}) {
  // Long-press a diagnostic row to re-run its probe.
  const lp = useLongPress({ onLongPress: () => onTest() });
  const meta = SERVICE_META[service];
  return (
    <li
      {...lp}
      className="flex items-center justify-between gap-3 rounded-lg border border-dashed p-2"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{meta.label}</p>
        <p className="truncate font-mono text-xs text-text-secondary">
          {probe.state === 'idle' && 'not probed yet'}
          {probe.state === 'running' && 'probing…'}
          {probe.state !== 'idle' && probe.state !== 'running' && probe.detail}
        </p>
      </div>
      {probe.state === 'running' ? (
        <Spinner label={`Probing ${meta.label}`} />
      ) : (
        <QButton size="sm" onClick={onTest} aria-label={`Test ${meta.label} connection`}>
          {probe.state === 'idle' ? 'Test' : 'Re-test'}
        </QButton>
      )}
    </li>
  );
}

export function DebugScreen() {
  const [settings, setSettings] = useState<QuantumSettings>(() => getSettings());
  const [probes, setProbes] = useState<Record<ServiceId, Probe>>({
    hub: { state: 'idle', detail: '' },
    nebula: { state: 'idle', detail: '' },
    relay: { state: 'idle', detail: '' },
    sol: { state: 'idle', detail: '' },
  });
  const [log, setLog] = useState<LogEntry[]>(() => getLog());
  const [theme, setTheme] = useState<string>('?');
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    bootTheme().then(setTheme).catch(() => setTheme('?'));
    return onLog(() => setLog(getLog()));
  }, []);

  const test = useCallback(
    async (service: ServiceId) => {
      setProbes((p) => ({ ...p, [service]: { state: 'running', detail: '' } }));
      debugLog('diagnostics', `Probing ${SERVICE_META[service].label}…`);
      try {
        const r = await testServiceConnection(service, settings[service].baseUrl);
        setProbes((p) => ({ ...p, [service]: { state: 'ok', detail: `HTTP ${r.status}` } }));
        debugLog('diagnostics', `${SERVICE_META[service].label}: HTTP ${r.status}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setProbes((p) => ({ ...p, [service]: { state: 'fail', detail: msg } }));
        debugLog('diagnostics', `${SERVICE_META[service].label} failed: ${msg}`, 'error');
      }
    },
    [settings],
  );

  const testAll = useCallback(() => {
    for (const s of SERVICE_IDS) void test(s);
  }, [test]);

  async function resetAll() {
    const { EMPTY_SETTINGS } = await import('../lib/settings');
    await saveSettings({ ...EMPTY_SETTINGS });
    setSettings(getSettings());
    setConfirmReset(false);
    debugLog('debug', 'All settings cleared — back to demo mode.', 'warn');
  }

  const rows = redact(settings);

  return (
    <div className="flex flex-col gap-4 p-4">
      <Card className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
            Connection diagnostics
          </h2>
          <QButton size="sm" onClick={testAll}>
            Test all
          </QButton>
        </div>
        <ul className="flex flex-col gap-2">
          {SERVICE_IDS.map((s) => (
            <DiagnosticRow key={s} service={s} probe={probes[s]} onTest={() => test(s)} />
          ))}
        </ul>
        <p className="mt-2 text-xs text-text-secondary">
          Tip: long-press a row to re-run its probe.
        </p>
      </Card>

      <Card className="p-3">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-secondary">
          Settings inspector
        </h2>
        <dl className="flex flex-col gap-1">
          {Object.entries(rows).map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 text-sm">
              <dt className="text-text-secondary">{k}</dt>
              <dd className="truncate font-mono text-xs">{v}</dd>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="text-text-secondary">Theme</dt>
            <dd className="font-mono text-xs">{theme}</dd>
          </div>
        </dl>
        {!confirmReset ? (
          <QButton size="sm" className="mt-3" onClick={() => setConfirmReset(true)}>
            Reset all settings…
          </QButton>
        ) : (
          <div className="mt-3 flex gap-2">
            <QButton size="sm" color="primary-destructive" onClick={resetAll}>
              Confirm reset
            </QButton>
            <QButton size="sm" onClick={() => setConfirmReset(false)}>
              Cancel
            </QButton>
          </div>
        )}
      </Card>

      <Card className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
            Log viewer
          </h2>
          <div className="flex items-center gap-2">
            <Badge tone="slate" size="sm">
              {log.length} entries
            </Badge>
            <QButton size="sm" onClick={() => clearLog()}>
              Clear
            </QButton>
          </div>
        </div>
        {log.length === 0 ? (
          <EmptyState mark="◌" title="No log entries yet" text="App events will appear here." />
        ) : (
          <ol className="flex max-h-64 flex-col gap-1 overflow-y-auto font-mono text-xs">
            {[...log].reverse().map((e, i) => (
              <li key={`${e.at}-${i}`} className="rounded border border-dashed p-1.5">
                <span className="text-text-secondary">{e.at.slice(11, 19)}</span>{' '}
                <span
                  className={
                    e.level === 'error'
                      ? 'font-bold text-red-600'
                      : e.level === 'warn'
                        ? 'font-bold text-amber-600'
                        : 'text-text-secondary'
                  }
                >
                  [{e.tag}]
                </span>{' '}
                {e.message}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card className="p-3">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-secondary">
          Demo mode
        </h2>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-text-secondary">
            Force every service into honest demo mode (no network calls), regardless of settings.
          </p>
          <QToggle
            size="md"
            isSelected={false}
            isDisabled
            aria-label="Force demo mode (coming soon)"
          />
        </div>
        <p className="mt-1 text-xs text-text-secondary">
          Coming soon — today, "Reset all settings" is the way back to demo mode.
        </p>
      </Card>

      <UpdaterDiagnostics />
    </div>
  );
}

/** Updater internals for Scotty: installed build, release state, force check. */
function UpdaterDiagnostics() {
  const updater = useUpdater();
  const { status, installed, release, error, settings } = updater;
  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
          Updater diagnostics
        </h2>
        <QButton size="sm" onClick={() => updater.check()}>
          Force check
        </QButton>
      </div>
      <dl className="flex flex-col gap-1 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-text-secondary">Installed build</dt>
          <dd className="font-mono text-xs">
            {installed ? `${installed.versionName} (#${installed.versionCode})` : '—'}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-text-secondary">Latest release</dt>
          <dd className="font-mono text-xs">{release ? describeRelease(release) : '—'}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-text-secondary">State</dt>
          <dd className="font-mono text-xs">{status}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-text-secondary">Auto-check on launch</dt>
          <dd className="font-mono text-xs">{settings.autoCheck ? 'on' : 'off'}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-text-secondary">Wi-Fi only</dt>
          <dd className="font-mono text-xs">{settings.wifiOnly ? 'on' : 'off'}</dd>
        </div>
        {release?.commitSha && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-text-secondary">Release commit</dt>
            <dd className="truncate font-mono text-xs">{release.commitSha.slice(0, 12)}</dd>
          </div>
        )}
        {error && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-text-secondary">Last error</dt>
            <dd className="text-right font-mono text-xs text-text-danger">{error}</dd>
          </div>
        )}
      </dl>
    </Card>
  );
}
