/**
 * AuthService tests — universal DSECT org credentials, sessions, tailnet
 * identity (docs/MEMORY.md — identity & secrets). Uses :memory: SQLite.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '../src/db.js';
import { AuthService, hashToken, validateDsectEmail, validateHandle } from '../src/auth.js';
import { ServiceError } from '../src/types.js';
import type { Database } from 'better-sqlite3';

function seedUser(db: Database, handle = 'scotty', email = 'scotty@dsect.net'): string {
  const id = `u-${handle}`;
  db.prepare(
    `INSERT INTO users (id, handle, email, display_name, kind, team, bio, interests,
                        avatar_url, avatar_data, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'human', 'dsect', '', '[]', NULL, NULL, 'owner', 'active', ?, ?)`,
  ).run(id, handle, email, handle, new Date().toISOString(), new Date().toISOString());
  return id;
}

describe('AuthService', () => {
  let db: Database;
  let auth: AuthService;

  beforeEach(() => {
    db = openDatabase(':memory:');
    seedUser(db);
    auth = new AuthService(db, {
      orgToken: 'org-secret',
      trustIdentity: false,
      sessionDays: 30,
    });
  });

  it('validates @dsect.net emails and handles', () => {
    expect(validateDsectEmail('scotty@dsect.net')).toBeNull();
    expect(validateDsectEmail('scotty@gmail.com')).toMatch(/@dsect\.net/);
    expect(validateDsectEmail('')).toBeTruthy();
    expect(validateHandle('cooper')).toBeNull();
    expect(validateHandle('x')).toBeTruthy();
    expect(validateHandle('Bad Handle')).toBeTruthy();
  });

  it('logs in with the universal org credential', () => {
    const session = auth.login('scotty@dsect.net', 'org-secret', 'vitest');
    expect(session.token).toBeTruthy();
    expect(session.user.handle).toBe('scotty');

    const { user, via } = auth.resolve({ authorization: `Bearer ${session.token}` });
    expect(via).toBe('session');
    expect(user?.handle).toBe('scotty');
    expect(user?.session_id).toBeTruthy();
  });

  it('rejects invalid credentials and unknown accounts', () => {
    expect(() => auth.login('scotty@dsect.net', 'wrong')).toThrow(ServiceError);
    expect(() => auth.login('ghost@dsect.net', 'org-secret')).toThrow(/No Singularity account/);
    expect(() => auth.login('scotty@gmail.com', 'org-secret')).toThrow(/@dsect\.net/);
  });

  it('accepts a personal credential once set and revokes old sessions on rotate', () => {
    const user = auth.getUserByHandle('scotty')!;
    auth.setCredential(user, 'personal-pass-1');

    const s1 = auth.login('scotty@dsect.net', 'personal-pass-1');
    expect(auth.resolve({ authorization: `Bearer ${s1.token}` }).user?.handle).toBe('scotty');

    // Org credential still works too (bootstrap stays valid).
    expect(() => auth.login('scotty@dsect.net', 'org-secret')).not.toThrow();

    auth.setCredential(user, 'personal-pass-2');
    // s1 was revoked by rotation.
    expect(auth.resolve({ authorization: `Bearer ${s1.token}` }).user).toBeNull();

    expect(() => auth.login('scotty@dsect.net', 'personal-pass-1')).toThrow(/Invalid/);
    expect(() => auth.login('scotty@dsect.net', 'personal-pass-2')).not.toThrow();
  });

  it('rejects weak personal credentials', () => {
    const user = auth.getUserByHandle('scotty')!;
    expect(() => auth.setCredential(user, 'short')).toThrow(/at least 8/);
  });

  it('issues sessions with hashed tokens only', () => {
    const session = auth.login('scotty@dsect.net', 'org-secret');
    const row = db.prepare(`SELECT token_hash FROM sessions LIMIT 1`).get() as { token_hash: string };
    expect(row.token_hash).toBe(hashToken(session.token));
    expect(row.token_hash).not.toBe(session.token);
  });

  it('logout revokes the session', () => {
    const session = auth.login('scotty@dsect.net', 'org-secret');
    auth.logout(session.token);
    expect(auth.resolve({ authorization: `Bearer ${session.token}` }).user).toBeNull();
  });

  it('authRequired reflects the org token configuration', () => {
    expect(auth.authRequired).toBe(true);
    const open = new AuthService(db, { orgToken: '' });
    expect(open.authRequired).toBe(false);
  });

  it('resolves trusted tailnet identity headers when enabled', () => {
    const tailnet = new AuthService(db, { orgToken: '', trustIdentity: true });
    const { user, via } = tailnet.resolve({ 'x-tailscale-user-login': 'scotty@fairy-chinstrap.ts.net' });
    expect(via).toBe('tailnet');
    expect(user?.handle).toBe('scotty');
    // Unknown tailnet identities resolve to null (HTTP layer turns it into 401).
    expect(tailnet.resolve({ 'x-dsect-user': 'nobody' }).user).toBeNull();
  });

  it('maps org-token callers to X-DSECT-Actor (or the admin)', () => {
    const { user, via } = auth.resolve({
      authorization: 'Bearer org-secret',
      'x-dsect-actor': 'scotty',
    });
    expect(via).toBe('org-token');
    expect(user?.handle).toBe('scotty');

    const fallback = auth.resolve({ authorization: 'Bearer org-secret' });
    expect(fallback.user?.handle).toBe('scotty');
  });

  it('require() throws 401 without credentials', () => {
    expect(() => auth.require({})).toThrow(/Sign in/);
  });

  it('open dev mode (no org token) accepts seeded-account logins and audits them', () => {
    const open = new AuthService(db, { orgToken: '' });
    const session = open.login('scotty@dsect.net', 'any-local-credential', 'vitest');
    expect(session.user.handle).toBe('scotty');
    const { user } = open.resolve({ authorization: `Bearer ${session.token}` });
    expect(user?.handle).toBe('scotty');
    const log = db
      .prepare(`SELECT action FROM audit_log WHERE action = 'session.open_mode_login'`)
      .get();
    expect(log).toBeTruthy();
  });
});
