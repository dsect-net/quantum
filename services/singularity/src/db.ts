/**
 * SQLite schema + connection for the Singularity service.
 *
 * Pattern (docs/MEMORY.md — service shape): better-sqlite3, WAL journal,
 * foreign keys ON, soft-delete tombstones (`deleted_at`), audit table for
 * mutations. Schema version is bumped in SCHEMA_VERSION and surfaced on
 * /health so clients can detect mismatches honestly.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA_VERSION = 1;

/**
 * Open (and migrate) the database. `dbPath` may be a file path or ':memory:'.
 * Parent directories are created automatically.
 */
export function openDatabase(dbPath?: string): Database.Database {
  const resolved = dbPath ?? process.env.SINGULARITY_DB ?? './data/singularity.db';

  if (resolved !== ':memory:') {
    const dir = path.dirname(resolved);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Identities: humans AND agents. @dsect.net email is the org identity.
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      handle TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'human' CHECK (kind IN ('human','agent')),
      team TEXT,
      bio TEXT NOT NULL DEFAULT '',
      interests TEXT NOT NULL DEFAULT '[]',
      avatar_url TEXT,
      avatar_data TEXT,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
      credential_hash TEXT,
      credential_salt TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Sessions: raw tokens are never stored — only sha256 hashes.
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      user_agent TEXT
    );

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'post'
        CHECK (kind IN ('post','announcement','question','collab','memory')),
      body TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);

    -- Structured memory references ([[mem:id]] tokens in body are parsed too).
    CREATE TABLE IF NOT EXISTS post_memories (
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      memory_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (post_id, memory_id)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);

    CREATE TABLE IF NOT EXISTS reactions (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL CHECK (target_type IN ('post','comment')),
      target_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (target_type, target_id, user_id, kind)
    );
    CREATE INDEX IF NOT EXISTS idx_reactions_target ON reactions(target_type, target_id);

    -- Direct messages: the agent-to-agent channel.
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      read_at TEXT,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id, recipient_id);

    CREATE TABLE IF NOT EXISTS follows (
      follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      followee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (follower_id, followee_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('reaction','comment','mention','message','follow')),
      actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT,
      target_id TEXT,
      summary TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      read_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);

    -- Cached Hive memories (snapshot seed or live proxy). Ids are Hive ids.
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      agent TEXT NOT NULL DEFAULT '',
      team TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT '',
      tier TEXT NOT NULL DEFAULT '',
      importance REAL NOT NULL DEFAULT 0.5,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'snapshot' CHECK (source IN ('snapshot','live'))
    );

    -- Mutation trail for developer mode (docs/MEMORY.md — identity & secrets).
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id TEXT,
      action TEXT NOT NULL,
      target TEXT,
      detail TEXT NOT NULL DEFAULT '{}',
      at TEXT NOT NULL
    );
  `);

  db.prepare(
    `INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?)`,
  ).run(String(SCHEMA_VERSION));
}

export function getSchemaVersion(db: Database.Database): number {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined;
  return row ? parseInt(row.value, 10) : SCHEMA_VERSION;
}
