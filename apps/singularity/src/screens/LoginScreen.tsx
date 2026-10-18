/**
 * Login — universal DSECT organization credentials (docs/MEMORY.md:
 * identity & secrets). First-run setup collects the Singularity service URL
 * (it lives on Tritium; the address is not a secret). Sessions are issued by
 * the service and kept only on this device.
 */
import { useState } from 'react';
import { ApiError, describeError, SingularityClient, type Session } from '../api/client';
import { log } from '../lib/logger';

export function LoginScreen({
  client,
  onSession,
  onSavedBaseUrl,
}: {
  client: SingularityClient;
  onSession: (session: Session) => void;
  onSavedBaseUrl: (url: string) => void;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [serviceUrl, setServiceUrl] = useState(client.baseUrl);
  const [email, setEmail] = useState('scotty@dsect.net');
  const [credential, setCredential] = useState('');
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const url = serviceUrl.trim();
      onSavedBaseUrl(url);
      // A fresh client each submit so a changed URL takes effect immediately.
      const live = new SingularityClient({ baseUrl: url });

      const res =
        mode === 'login'
          ? await live.login(email.trim(), credential)
          : await live.register({
              handle: handle.trim(),
              email: email.trim(),
              display_name: displayName.trim() || handle.trim(),
              credential,
              join_code: joinCode.trim() || undefined,
            });

      const session: Session = {
        token: res.token,
        user: res.user,
        expires_at: res.expires_at,
      };
      log('auth', `Signed in as ${res.user.handle} (${mode})`);
      onSession(session);
    } catch (err) {
      const message =
        err instanceof ApiError ? describeError(err) : err instanceof Error ? err.message : 'Sign-in failed';
      setError(message);
      log('auth', `Sign-in failed: ${message}`, 'warn');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="login-mark">Σ</div>
        <h1>The Singularity</h1>
        <p className="tagline">
          The collaboration hub and feed for everything Quantum. Sign in with
          your DSECT organization credentials.
        </p>

        <div className="stack">
          <div className="field">
            <label htmlFor="service-url">Singularity service URL</label>
            <input
              id="service-url"
              className="input"
              placeholder="https://singularity.team.dsect.net"
              value={serviceUrl}
              onChange={(e) => setServiceUrl(e.target.value)}
              autoComplete="url"
            />
            <span className="hint">
              Usually pre-filled on the tailnet. Leave empty only for offline demo mode.
            </span>
          </div>

          <div className="field">
            <label htmlFor="email">DSECT email</label>
            <input
              id="email"
              className="input"
              type="email"
              placeholder="you@dsect.net"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="credential">Organization credential</label>
            <input
              id="credential"
              className="input"
              type="password"
              placeholder="Your universal DSECT credential"
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
            />
            <span className="hint">
              Stored only on this device. Rotating it in Settings signs out every session.
            </span>
          </div>

          {mode === 'register' && (
            <>
              <div className="field">
                <label htmlFor="handle">Handle</label>
                <input
                  id="handle"
                  className="input"
                  placeholder="e.g. scotty"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="display-name">Display name</label>
                <input
                  id="display-name"
                  className="input"
                  placeholder="e.g. Scotty"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="join-code">Organization join code</label>
                <input
                  id="join-code"
                  className="input"
                  type="password"
                  placeholder="Join code (the org credential)"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  required
                />
                <span className="hint">
                  New accounts need the org join code once — it proves membership.
                </span>
              </div>
            </>
          )}

          {error && <p className="error-text">{error}</p>}

          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>

          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
          >
            {mode === 'login' ? 'New to the org? Create an account' : 'Have an account? Sign in'}
          </button>
        </div>
      </form>
    </div>
  );
}
