import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    description: 'Initial schema per brief §6 (lists, items, tags, item_tags, item_links, embeddings, revisions, schema_version, items_fts + triggers)',
    up: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS lists (
          id            TEXT PRIMARY KEY,
          name          TEXT NOT NULL,
          category      TEXT NOT NULL,
          parent_list_id TEXT NULL REFERENCES lists(id),
          sort_order    INTEGER NOT NULL DEFAULT 0,
          private       INTEGER NOT NULL DEFAULT 0,
          sync_excluded INTEGER NOT NULL DEFAULT 0,
          archived_at   TEXT NULL,
          created_at    TEXT NOT NULL,
          updated_at    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS items (
          id               TEXT PRIMARY KEY,
          list_id          TEXT NOT NULL REFERENCES lists(id),
          parent_item_id   TEXT NULL REFERENCES items(id),
          type             TEXT NOT NULL CHECK (type IN ('note','task','todo')),
          title            TEXT NOT NULL,
          body             TEXT NOT NULL DEFAULT '',
          author           TEXT NOT NULL,
          status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','archived')),
          priority         INTEGER NULL CHECK (priority IN (1,2,3)),
          due_at           TEXT NULL,
          linked_source    TEXT NULL,
          created_at       TEXT NOT NULL,
          updated_at       TEXT NOT NULL,
          completed_at     TEXT NULL,
          deleted_at       TEXT NULL
        );

        CREATE TABLE IF NOT EXISTS tags (
          id   TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS item_tags (
          item_id TEXT NOT NULL REFERENCES items(id),
          tag_id  TEXT NOT NULL REFERENCES tags(id),
          PRIMARY KEY (item_id, tag_id)
        );

        CREATE TABLE IF NOT EXISTS item_links (
          id           TEXT PRIMARY KEY,
          from_item_id TEXT NOT NULL REFERENCES items(id),
          to_item_id   TEXT NULL REFERENCES items(id),
          external_url TEXT NULL,
          relation     TEXT NOT NULL CHECK (relation IN ('spawned','blocks','related','reference')),
          created_at   TEXT NOT NULL,
          CHECK (to_item_id IS NOT NULL OR external_url IS NOT NULL)
        );

        CREATE TABLE IF NOT EXISTS embeddings (
          item_id     TEXT NOT NULL REFERENCES items(id),
          model_id    TEXT NOT NULL,
          vector      BLOB NOT NULL,
          embedded_at TEXT NOT NULL,
          PRIMARY KEY (item_id, model_id)
        );

        CREATE TABLE IF NOT EXISTS revisions (
          id         TEXT PRIMARY KEY,
          item_id    TEXT NOT NULL REFERENCES items(id),
          snapshot   TEXT NOT NULL,
          author     TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5 (
          title,
          body,
          content='items',
          content_rowid='rowid'
        );

        CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
          INSERT INTO items_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
        END;

        CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
          INSERT INTO items_fts(items_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
        END;

        CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
          INSERT INTO items_fts(items_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
          INSERT INTO items_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
        END;
      `);
    },
  },
  {
    version: 2,
    description: 'Add embedding_status to items and kind column to revisions per §13b',
    up: (db: Database.Database) => {
      const itemCols = db.prepare('PRAGMA table_info(items)').all() as Array<{ name: string }>;
      if (!itemCols.some((c) => c.name === 'embedding_status')) {
        db.exec(
          "ALTER TABLE items ADD COLUMN embedding_status TEXT NOT NULL DEFAULT 'pending' CHECK (embedding_status IN ('pending', 'done', 'failed'))"
        );
      }

      const revCols = db.prepare('PRAGMA table_info(revisions)').all() as Array<{ name: string }>;
      if (!revCols.some((c) => c.name === 'kind')) {
        db.exec(
          "ALTER TABLE revisions ADD COLUMN kind TEXT NOT NULL DEFAULT 'edit' CHECK (kind IN ('create','edit','complete','reopen','delete','restore','move'))"
        );
      }
    },
  },
];

export function getDatabasePath(): string {
  return process.env.NOTEKEEPER_DB || './data/notekeeper.db';
}

export function getCurrentSchemaVersion(db: Database.Database): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL,
      description TEXT
    );
  `);
  const row = db.prepare('SELECT MAX(version) as current_version FROM schema_version').get() as {
    current_version: number | null;
  };
  return row?.current_version ?? 0;
}

export function migrate(db: Database.Database): number {
  const currentVersion = getCurrentSchemaVersion(db);

  for (const m of migrations) {
    if (m.version > currentVersion) {
      const applyMigration = db.transaction(() => {
        m.up(db);
        db.prepare(
          'INSERT INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)'
        ).run(m.version, new Date().toISOString(), m.description);
      });
      applyMigration();
    }
  }

  return getCurrentSchemaVersion(db);
}

export function openDatabase(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? getDatabasePath();

  if (resolvedPath !== ':memory:') {
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  migrate(db);

  return db;
}
