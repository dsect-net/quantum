/**
 * Auth — universal DSECT organization credentials + sessions.
 *
 * Identity sources, in priority order (docs/MEMORY.md — identity & secrets):
 *   1. Session bearer token issued by POST /api/v1/auth/login. Tokens are
 *      random 32-byte URL-safe strings; only their SHA-256 hash is stored.
 *   2. The org credential `SINGULARITY_ORG_TOKEN` (same idea as the hub MCP
 *      worker key) — used by agents and the universal MCP gateway.
 *   3. Trusted tailnet identity headers (X-Tailscale-User-Login /
 *      X-DSECT-User) when SINGULARITY_TRUST_IDENTITY=1 behind the tailnet
 *      proxy that strips client-supplied copies.
 *
 * Per-user credentials are salted SHA-256 hashes (`users.credential_hash`),
 * set via POST /api/v1/auth/credential. The org credential works for any
 * seeded account until that account sets its own — the bootstrap path for
 * Scotty's first login. Secrets are never logged and never leave the server.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { User, UserCard } from './types.js';
import { errBadRequest, errForbidden, errNotFound, errUnauthorized } from './types.js';

export interface SessionUser extends User {
  session_id?: string;
}

export interface AuthConfig {
  /** Universal org credential. Empty/undefined disables token auth. */
  orgToken?: string;
  /** Trust reverse-proxy identity headers (tailnet SSO). Off by default. */
  trustIdentity?: boolean;
  /** Session lifetime in days (default 30). */
  sessionDays?: number;
}

interface UserRow {
  id: string;
  handle: string;
  email: string;
  display_name: string;
  kind: 'human' | 'agent';
  team: string | null;
  bio: string;
  interests: string;
  avatar_url: string | null;
  avatar_data: string | null;
  role: 'owner' | 'admin' | 'member';
  status: 'active' | 'suspended';
  credential_hash: string | null;
  credential_salt: string | null;
  created_at: string;
  updated_at: string;
}

export function rowToUser(row: UserRow): User {
  let interests: string[] = [];
  try {
    interests = JSON.parse(row.interests);
  } catch {
    interests = [];
  }
  return {
    id: row.id,
    handle: row.handle,
    email: row.email,
    display_name: row.display_name,
    kind: row.kind,
    team: row.team,
    bio: row.bio,
    interests,
    avatar_url: row.avatar_url,
    avatar_data: row.avatar_data,
    role: row.role,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function toUserCard(user: User): UserCard {
  return {
    id: user.id,
    handle: user.handle,
    email: user.email,
    display_name: user.display_name,
    kind: user.kind,
    team: user.team,
    avatar_url: user.avatar_url,
    avatar_data: user.avatar_data,
  };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function hashCredential(credential: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${credential}`).digest('hex');
}

/** Constant-time string compare for tokens. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

const EMAIL_RE = /^[^\s@]+@dsect\.net$/i;
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,38}$/;

export function validateDsectEmail(email: string): string | null {
  if (!email || !EMAIL_RE.test(email.trim())) {
    return 'Email must be an @dsect.net organization address';
  }
  return null;
}

export function validateHandle(handle: string): string | null {
  if (!handle || !HANDLE_RE.test(handle.trim().toLowerCase())) {
    return 'Handle must be 2-39 chars: lowercase letters, digits, - or _';
  }
  return null;
}

export class AuthService {
  private db: Database;
  private config: Required<AuthConfig>;

  constructor(db: Database, config: AuthConfig = {}) {
    this.db = db;
    this.config = {
      orgToken: config.orgToken ?? process.env.SINGULARITY_ORG_TOKEN ?? '',
      trustIdentity:
        config.trustIdentity ?? (process.env.SINGULARITY_TRUST_IDENTITY ?? '0') === '1',
      sessionDays: config.sessionDays ?? parseInt(process.env.SINGULARITY_SESSION_DAYS ?? '30', 10),
    };
  }

  /** Auth is enforced only when an org token is configured (dev default: open). */
  get authRequired(): boolean {
    return Boolean(this.config.orgToken);
  }

  get trustIdentity(): boolean {
    return this.config.trustIdentity;
  }

  getUserByHandle(handle: string): User | null {
    const row = this.db
      .prepare(`SELECT * FROM users WHERE lower(handle) = lower(?)`)
      .get(handle.trim()) as UserRow | undefined;
    return row ? rowToUser(row) : null;
  }

  getUserByEmail(email: string): User | null {
    const row = this.db
      .prepare(`SELECT * FROM users WHERE lower(email) = lower(?)`)
      .get(email.trim()) as UserRow | undefined;
    return row ? rowToUser(row) : null;
  }

  getUserById(id: string): User | null {
    const row = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
    return row ? rowToUser(row) : null;
  }

  /**
   * Login with universal DSECT org credentials: email + credential, where
   * credential is either the org token or the account's own credential.
   * Returns the issued session (raw token included exactly once).
   */
  login(
    email: string,
    credential: string,
    userAgent?: string,
  ): { user: User; token: string; expires_at: string } {
    const err = validateDsectEmail(email);
    if (err) throw errBadRequest(err);

    const user = this.getUserByEmail(email);
    if (!user) throw errNotFound(`No Singularity account for ${email}`);
    if (user.status !== 'active') throw errForbidden('Account is suspended');

    const row = this.db
      .prepare(`SELECT credential_hash, credential_salt FROM users WHERE id = ?`)
      .get(user.id) as { credential_hash: string | null; credential_salt: string | null };

    const orgOk = Boolean(this.config.orgToken) && safeEqual(credential, this.config.orgToken);
    const personalOk =
      row.credential_hash && row.credential_salt
        ? hashCredential(credential, row.credential_salt) === row.credential_hash
        : false;

    // Open dev mode (no org token configured): the whole REST surface is
    // already open — accept any credential for a seeded account so the app
    // login loop works locally. Audit-tagged so it is never silent.
    const openModeOk = !this.authRequired;

    if (!orgOk && !personalOk && !openModeOk) {
      throw errUnauthorized('Invalid DSECT organization credential');
    }
    if (!orgOk && !personalOk && openModeOk) {
      this.audit(user.id, 'session.open_mode_login', user.handle, {});
    }

    return this.issueSession(user, userAgent);
  }

  /** True when `credential` is the configured universal org credential. */
  checkOrgCredential(credential: string): boolean {
    return Boolean(this.config.orgToken) && safeEqual(credential, this.config.orgToken);
  }

  /** Set (or rotate) the caller's personal credential. */
  setCredential(user: User, credential: string): void {
    if (!credential || credential.length < 8) {
      throw errBadRequest('Credential must be at least 8 characters', 'weak_credential');
    }
    const salt = randomBytes(16).toString('hex');
    const hash = hashCredential(credential, salt);
    this.db
      .prepare(`UPDATE users SET credential_hash = ?, credential_salt = ?, updated_at = ? WHERE id = ?`)
      .run(hash, salt, new Date().toISOString(), user.id);
    // Rotating a credential revokes every existing session for safety.
    this.db
      .prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`)
      .run(new Date().toISOString(), user.id);
    this.audit(user.id, 'credential.rotate', user.handle, {});
  }

  issueSession(user: User, userAgent?: string): { user: User; token: string; expires_at: string } {
    const token = randomBytes(32).toString('base64url');
    const id = randomBytes(16).toString('hex');
    const now = new Date();
    const expires = new Date(now.getTime() + this.config.sessionDays * 24 * 60 * 60 * 1000);
    this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, user_agent)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, user.id, hashToken(token), now.toISOString(), expires.toISOString(), userAgent ?? null);
    this.audit(user.id, 'session.issue', user.handle, { ua: (userAgent ?? '').slice(0, 120) });
    return { user, token, expires_at: expires.toISOString() };
  }

  logout(token: string): void {
    this.db
      .prepare(`UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`)
      .run(new Date().toISOString(), hashToken(token));
  }

  /**
   * Resolve an HTTP request to an authenticated user. Total function: an
   * unrecognized/expired credential yields `{ user: null }` (the HTTP layer
   * decides between "invalid token" and "sign in" messages).
   * `headers` values may be string | string[] | undefined (Node raw headers).
   */
  resolve(
    headers: Record<string, string | string[] | undefined>,
  ): { user: SessionUser | null; via: 'session' | 'org-token' | 'tailnet' | 'none' } {
    const auth = String(headers['authorization'] ?? '');
    if (auth.startsWith('Bearer ')) {
      const token = auth.slice(7).trim();
      const session = this.db
        .prepare(
          `SELECT s.id AS session_id, s.expires_at, u.*
           FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.revoked_at IS NULL`,
        )
        .get(hashToken(token)) as (UserRow & { session_id: string; expires_at: string }) | undefined;

      if (session) {
        if (new Date(session.expires_at).getTime() < Date.now()) {
          return { user: null, via: 'none' }; // expired — treat as signed out
        }
        const user = rowToUser(session);
        return { user: { ...user, session_id: session.session_id }, via: 'session' };
      }

      if (this.config.orgToken && safeEqual(token, this.config.orgToken)) {
        // Org credential without a session: identify via X-DSECT-Actor (an
        // agent handle) or fall back to the seeded admin account.
        const actorHandle = String(headers['x-dsect-actor'] ?? '').trim();
        const user = actorHandle
          ? this.getUserByHandle(actorHandle)
          : this.getUserByEmail(process.env.SINGULARITY_ADMIN_EMAIL ?? 'scotty@dsect.net');
        return { user, via: 'org-token' };
      }

      return { user: null, via: 'none' };
    }

    if (this.config.trustIdentity) {
      const login =
        String(headers['x-tailscale-user-login'] ?? '') || String(headers['x-dsect-user'] ?? '');
      if (login) {
        const handle = login.split('@')[0];
        const user = this.getUserByHandle(handle) ?? this.getUserByEmail(
          handle.includes('@') ? handle : `${handle}@dsect.net`,
        );
        return { user, via: 'tailnet' };
      }
    }

    return { user: null, via: 'none' };
  }

  /** Require an authenticated user (REST guards). */
  require(headers: Record<string, string | string[] | undefined>): SessionUser {
    const { user } = this.resolve(headers);
    if (!user) throw errUnauthorized('Sign in with your DSECT organization credentials');
    return user;
  }

  /** Append an audit row (developer-mode trail). Never stores secrets. */
  audit(actorId: string | null, action: string, target: string | null, detail: object): void {
    this.db
      .prepare(`INSERT INTO audit_log (actor_id, action, target, detail, at) VALUES (?, ?, ?, ?, ?)`)
      .run(actorId, action, target, JSON.stringify(detail), new Date().toISOString());
  }
}
