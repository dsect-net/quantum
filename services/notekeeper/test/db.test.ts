import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase, getCurrentSchemaVersion, migrate } from '../src/db.js';

describe('Database Schema & Migrations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('applies schema cleanly on a fresh database to version 2', () => {
    expect(getCurrentSchemaVersion(db)).toBe(2);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain('lists');
    expect(tableNames).toContain('items');
    expect(tableNames).toContain('tags');
    expect(tableNames).toContain('item_tags');
    expect(tableNames).toContain('item_links');
    expect(tableNames).toContain('embeddings');
    expect(tableNames).toContain('revisions');
    expect(tableNames).toContain('schema_version');
    expect(tableNames).toContain('items_fts');

    // Verify embedding_status exists on items and kind exists on revisions
    const itemCols = db.prepare('PRAGMA table_info(items)').all() as Array<{ name: string }>;
    expect(itemCols.some((c) => c.name === 'embedding_status')).toBe(true);

    const revCols = db.prepare('PRAGMA table_info(revisions)').all() as Array<{ name: string }>;
    expect(revCols.some((c) => c.name === 'kind')).toBe(true);
  });

  it('is idempotent when migrate() is run multiple times', () => {
    const v1 = getCurrentSchemaVersion(db);
    expect(v1).toBe(2);

    const v2 = migrate(db);
    expect(v2).toBe(2);

    const v3 = migrate(db);
    expect(v3).toBe(2);
  });

  it('migrates an existing v1 database cleanly to v2', () => {
    const v1Db = new Database(':memory:');
    // Simulate v1 schema
    v1Db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT, description TEXT);
      INSERT INTO schema_version VALUES (1, datetime('now'), 'Initial schema v1');
      CREATE TABLE lists (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
        parent_list_id TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
        private INTEGER NOT NULL DEFAULT 0, sync_excluded INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE items (
        id TEXT PRIMARY KEY, list_id TEXT NOT NULL REFERENCES lists(id),
        parent_item_id TEXT, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', priority INTEGER, due_at TEXT,
        linked_source TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT, deleted_at TEXT
      );
      CREATE TABLE revisions (
        id TEXT PRIMARY KEY, item_id TEXT NOT NULL, snapshot TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `);

    expect(getCurrentSchemaVersion(v1Db)).toBe(1);

    const newVersion = migrate(v1Db);
    expect(newVersion).toBe(2);

    const itemCols = v1Db.prepare('PRAGMA table_info(items)').all() as Array<{ name: string }>;
    expect(itemCols.some((c) => c.name === 'embedding_status')).toBe(true);

    const revCols = v1Db.prepare('PRAGMA table_info(revisions)').all() as Array<{ name: string }>;
    expect(revCols.some((c) => c.name === 'kind')).toBe(true);

    v1Db.close();
  });

  it('keeps FTS5 items_fts synchronized via triggers on insert, update, and delete', () => {
    const listId = 'test-list-1';
    db.prepare(`
      INSERT INTO lists (id, name, category, sort_order, created_at, updated_at)
      VALUES (?, 'Test List', 'test', 0, datetime('now'), datetime('now'))
    `).run(listId);

    // Insert item -> trigger items_ai
    const itemId = 'test-item-1';
    db.prepare(`
      INSERT INTO items (id, list_id, type, title, body, author, created_at, updated_at)
      VALUES (?, ?, 'note', 'Quantum Architecture', 'Local first notes design', 'scotty', datetime('now'), datetime('now'))
    `).run(itemId, listId);

    const ftsInsert = db
      .prepare("SELECT * FROM items_fts WHERE items_fts MATCH 'Quantum'")
      .all() as Array<{ title: string; body: string }>;
    expect(ftsInsert).toHaveLength(1);
    expect(ftsInsert[0].title).toBe('Quantum Architecture');

    // Update item -> trigger items_au
    db.prepare(`
      UPDATE items SET title = 'Evolved Architecture', body = 'Updated text' WHERE id = ?
    `).run(itemId);

    const ftsOld = db
      .prepare("SELECT * FROM items_fts WHERE items_fts MATCH 'Quantum'")
      .all();
    expect(ftsOld).toHaveLength(0);

    const ftsNew = db
      .prepare("SELECT * FROM items_fts WHERE items_fts MATCH 'Evolved'")
      .all() as Array<{ title: string; body: string }>;
    expect(ftsNew).toHaveLength(1);
    expect(ftsNew[0].title).toBe('Evolved Architecture');

    // Delete item -> trigger items_ad
    db.prepare('DELETE FROM items WHERE id = ?').run(itemId);

    const ftsDeleted = db
      .prepare("SELECT * FROM items_fts WHERE items_fts MATCH 'Evolved'")
      .all();
    expect(ftsDeleted).toHaveLength(0);
  });
});
