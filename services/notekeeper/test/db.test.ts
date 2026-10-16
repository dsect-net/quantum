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

  it('applies schema cleanly on a fresh database', () => {
    expect(getCurrentSchemaVersion(db)).toBe(1);

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
  });

  it('is idempotent when migrate() is run multiple times', () => {
    const v1 = getCurrentSchemaVersion(db);
    expect(v1).toBe(1);

    const v2 = migrate(db);
    expect(v2).toBe(1);

    const v3 = migrate(db);
    expect(v3).toBe(1);
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
