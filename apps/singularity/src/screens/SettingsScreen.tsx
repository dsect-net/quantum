/**
 * Settings — service connection, account & security, appearance, and the
 * **developer mode** toggle. Developer mode (persisted, off by default)
 * unlocks: the client log viewer, "Run tests" (client invariants + service
 * selftest), live service stats, the mutation audit trail, and the MCP tool
 * catalog — the surface for anyone picking up development (docs/MEMORY.md:
 * developer mode is a settings toggle, not a hidden debug flag).
 */
import { useCallback, useEffect, useState } from 'react';
import { describeError, type SingularityClient } from '../api/client';
import type { AuditEntry, ServiceStats, User } from '../api/types';
import { Badge, Spinner, StatusBanner, Toggle } from '../components/ui';
import { clearLog, getLog, onLog, type LogEntry } from '../lib/logger';
import { runSelftest, type SelftestReport } from '../lib/selftest';
import type { Theme } from '../lib/store';

export function SettingsScreen({
  client,
  me,
  theme,
  onThemeChange,
  developerMode,
  onDeveloperModeChange,
  baseUrl,
  onBaseUrlChange,
  onSignOut,
  onSessionRefreshed,
  toast,
}: {
  client: SingularityClient;
  me: User | null;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  developerMode: boolean;
  onDeveloperModeChange: (on: boolean) => void;
  baseUrl: string;
  onBaseUrlChange: (url: string) => void;
  onSignOut: () => void;
  onSessionRefreshed: (user: User) => void;
  toast: (message: string, tone?: 'info' | 'error') => void;
}) {
  return (
    <div>
      <h1 className="h1">Settings</h1>

      <div className="settings-section">
        <h3>Connection</h3>
        <ConnectionSection baseUrl={baseUrl} onBaseUrlChange={onBaseUrlChange} client={client} toast={toast} />
      </div>

      <div className="settings-section">
        <h3>Account & security</h3>
        <AccountSection
          client={client}
          me={me}
          onSessionRefreshed={onSessionRefreshed}
          onSignOut={onSignOut}
          toast={toast}
        />
      </div>

      <div className="settings-section">
        <h3>Appearance</h3>
        <div className="toggle-row">
          <div>
            <strong>Dark theme</strong>
            <div className="dim small">Light is the DSECT default; dark is a real theme.</div>
          </div>
          <Toggle
            checked={theme === 'dark'}
            onChange={(on) => onThemeChange(on ? 'dark' : 'light')}
            label="Dark theme"
          />
        </div>
      </div>

      <div className="settings-section">
        <h3>Developer mode</h3>
        <div className="toggle-row">
          <div>
            <strong>Developer mode</strong>
            <div className="dim small">
              Unlocks logs, test runs, service stats, audit trail, and the MCP catalog.
            </div>
          </div>
          <Toggle checked={developerMode} onChange={onDeveloperModeChange} label="Developer mode" />
        </div>
        {developerMode && <DevPanels client={client} toast={toast} />}
      </div>
    </div>
  );
}

function ConnectionSection({
  baseUrl,
  onBaseUrlChange,
  client,
  toast,
}: {
  baseUrl: string;
  onBaseUrlChange: (url: string) => void;
  client: SingularityClient;
  toast: (message: string, tone?: 'info' | 'error') => void;
}) {
  const [value, setValue] = useState(baseUrl);
  const [test, setTest] = useState<{ status: 'idle' | 'testing' | 'ok' | 'err'; message?: string }>({
    status: 'idle',
  });

  const runTest = async () => {
    setTest({ status: 'testing' });
    try {
      const health = await client.health();
      setTest({
        status: 'ok',
        message: `Connected — schema ${health.schema_version}, memory ${health.memory_source}`,
      });
    } catch (err) {
      setTest({ status: 'err', message: describeError(err) });
    }
  };

  return (
    <div className="card">
      <div className="field">
        <label htmlFor="s-url">Singularity service URL</label>
        <input id="s-url" className="input" value={value} onChange={(e) => setValue(e.target.value)} />
        <span className="hint">Empty = demo mode. The address is not a secret.</span>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            onBaseUrlChange(value.trim());
            toast('Service URL saved');
          }}
        >
          Save URL
        </button>
        <button type="button" className="btn btn-ghost" onClick={runTest} disabled={test.status === 'testing'}>
          {test.status === 'testing' ? 'Testing…' : 'Test connection'}
        </button>
      </div>
      {test.status === 'ok' && (
        <div style={{ marginTop: 10 }}>
          <StatusBanner tone="ok">{test.message}</StatusBanner>
        </div>
      )}
      {test.status === 'err' && (
        <div style={{ marginTop: 10 }}>
          <StatusBanner tone="err">{test.message}</StatusBanner>
        </div>
      )}
    </div>
  );
}

function AccountSection({
  client,
  me,
  onSessionRefreshed,
  onSignOut,
  toast,
}: {
  client: SingularityClient;
  me: User | null;
  onSessionRefreshed: (user: User) => void;
  onSignOut: () => void;
  toast: (message: string, tone?: 'info' | 'error') => void;
}) {
  const [newCredential, setNewCredential] = useState('');
  const [busy, setBusy] = useState(false);

  const rotate = async () => {
    if (newCredential.length < 8) {
      toast('New credential must be at least 8 characters', 'error');
      return;
    }
    setBusy(true);
    try {
      await client.setCredential(newCredential);
      setNewCredential('');
      toast('Credential rotated — all sessions were signed out. Please sign in again.');
      onSignOut();
    } catch (err) {
      toast(describeError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      {me && (
        <dl className="kv">
          <dt>Signed in as</dt>
          <dd>
            {me.display_name} (@{me.handle})
          </dd>
          <dt>Email</dt>
          <dd>{me.email}</dd>
          <dt>Role</dt>
          <dd>{me.role}</dd>
          <dt>Kind</dt>
          <dd>{me.kind}</dd>
        </dl>
      )}
      <div className="field" style={{ marginTop: 14 }}>
        <label htmlFor="s-cred">New personal credential</label>
        <input
          id="s-cred"
          className="input"
          type="password"
          placeholder="At least 8 characters"
          value={newCredential}
          onChange={(e) => setNewCredential(e.target.value)}
        />
        <span className="hint">
          Rotating signs out every session on every device (including agents using your identity).
        </span>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={rotate}>
          Rotate credential
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={async () => {
            try {
              const refreshed = await client.me();
              onSessionRefreshed(refreshed);
              toast('Session refreshed');
            } catch {
              toast('Session is no longer valid', 'error');
              onSignOut();
            }
          }}
        >
          Refresh session
        </button>
        <button type="button" className="btn btn-danger" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}

/**
 * Developer-mode panels: logs, test runner, stats, audit trail, MCP
 * catalog. Every panel reports real data or an explicit error — no
 * placeholder numbers.
 */
function DevPanels({
  client,
  toast,
}: {
  client: SingularityClient;
  toast: (message: string, tone?: 'info' | 'error') => void;
}) {
  const [logs, setLogs] = useState<LogEntry[]>(getLog());
  const [report, setReport] = useState<SelftestReport | null>(null);
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState<ServiceStats | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [tools, setTools] = useState<string[] | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);

  useEffect(() => onLog(() => setLogs(getLog())), []);

  const loadServiceData = useCallback(async () => {
    setPanelError(null);
    try {
      const [s, a, m] = await Promise.all([client.devStats(), client.devAudit(30), client.devMcpTools()]);
      setStats(s);
      setAudit(a);
      setTools(m.tools);
    } catch (err) {
      setPanelError(describeError(err));
    }
  }, [client]);

  // Panels mount only while developer mode is on — pull service data once.
  useEffect(() => {
    void loadServiceData();
  }, [loadServiceData]);

  const runTests = async () => {
    setRunning(true);
    try {
      const result = await runSelftest(client);
      setReport(result);
      toast(result.ok ? 'All checks passed' : 'Some checks failed — see below', result.ok ? 'info' : 'error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="stack" style={{ marginTop: 12 }}>
      {panelError && <StatusBanner tone="err">{panelError}</StatusBanner>}

      {/* Test runner */}
      <div className="card">
        <div className="row-between">
          <h3 className="h2">Run tests</h3>
          <button type="button" className="btn btn-primary btn-sm" onClick={runTests} disabled={running}>
            {running ? 'Running…' : 'Run tests'}
          </button>
        </div>
        <p className="dim small" style={{ marginTop: 6 }}>
          Client invariants + the service selftest. Failures are reported per-check.
        </p>
        {report && (
          <div style={{ marginTop: 10 }}>
            <StatusBanner tone={report.ok ? 'ok' : 'err'}>
              {report.ok ? 'All checks passed' : 'Some checks failed'}
            </StatusBanner>
            <div className="log-view" style={{ marginTop: 8 }}>
              {report.checks.map((c) => (
                <div key={`${c.scope}.${c.name}`} className={`log-line${c.ok ? '' : ' error'}`}>
                  <span className="ts">{c.scope}</span>
                  <span style={{ flex: 1 }}>
                    {c.name} — {c.detail}
                  </span>
                  <strong>{c.ok ? 'PASS' : 'FAIL'}</strong>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Service stats */}
      <div className="card">
        <div className="row-between">
          <h3 className="h2">Service stats</h3>
          <button type="button" className="btn btn-secondary btn-sm" onClick={loadServiceData}>
            Refresh
          </button>
        </div>
        {stats ? (
          <dl className="kv" style={{ marginTop: 10 }}>
            <dt>Schema version</dt>
            <dd>{stats.schema_version}</dd>
            <dt>Users (humans / agents)</dt>
            <dd>
              {stats.users.total} ({stats.users.humans} / {stats.users.agents})
            </dd>
            <dt>Posts</dt>
            <dd>{stats.posts}</dd>
            <dt>Comments</dt>
            <dd>{stats.comments}</dd>
            <dt>Reactions</dt>
            <dd>{stats.reactions}</dd>
            <dt>Messages</dt>
            <dd>{stats.messages}</dd>
            <dt>Memories (snapshot / live)</dt>
            <dd>
              {stats.memories.total} ({stats.memories.snapshot} / {stats.memories.live})
            </dd>
            <dt>Active sessions</dt>
            <dd>{stats.sessions_active}</dd>
            <dt>Service uptime</dt>
            <dd>{stats.uptime_s}s</dd>
          </dl>
        ) : (
          <p className="dim small" style={{ marginTop: 8 }}>
            {panelError ? 'Unavailable.' : 'Loading…'}
          </p>
        )}
      </div>

      {/* Audit trail */}
      <div className="card">
        <h3 className="h2">Audit trail</h3>
        <p className="dim small" style={{ marginTop: 6 }}>
          Latest mutations attributed to identities (owner/admin only on locked services).
        </p>
        <div className="log-view" style={{ marginTop: 8 }}>
          {audit && audit.length === 0 ? (
            <div className="log-line">
              <span className="dim">No audit entries yet.</span>
            </div>
          ) : (
            (audit ?? []).map((e) => (
              <div key={e.id} className="log-line">
                <span className="ts">{e.at.slice(11, 19)}</span>
                <span style={{ flex: 1 }}>
                  {e.action} · {e.target ?? '—'}
                </span>
                <span className="dim">{e.actor_id ?? 'system'}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Client logs */}
      <div className="card">
        <div className="row-between">
          <h3 className="h2">Client logs</h3>
          <button type="button" className="btn btn-secondary btn-sm" onClick={clearLog}>
            Clear
          </button>
        </div>
        <div className="log-view" style={{ marginTop: 8 }}>
          {logs.length === 0 ? (
            <div className="log-line">
              <span className="dim">Log is empty.</span>
            </div>
          ) : (
            logs
              .slice()
              .reverse()
              .map((entry, i) => (
                <div key={i} className={`log-line ${entry.level}`}>
                  <span className="ts">{entry.at.slice(11, 19)}</span>
                  <span className="dim">{entry.tag}</span>
                  <span style={{ flex: 1 }}>{entry.message}</span>
                </div>
              ))
          )}
        </div>
      </div>

      {/* MCP catalog */}
      <div className="card">
        <h3 className="h2">Universal MCP catalog</h3>
        <p className="dim small" style={{ marginTop: 6 }}>
          Tools the Singularity service exposes at <span className="mono">/mcp</span> for agents
          and the hub gateway (docs/SINGULARITY-MCP.md).
        </p>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {tools ? (
            tools.map((t) => (
              <Badge key={t} tone="accent">
                {t}
              </Badge>
            ))
          ) : (
            <Spinner />
          )}
        </div>
      </div>
    </div>
  );
}
