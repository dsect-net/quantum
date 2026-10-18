import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase } from '../src/db.js';
import { seedLists, seedIfEmpty, SEED_LISTS } from '../src/seed.js';
import { List } from '../src/types.js';

describe('Seed Data', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('seeds exactly the 7 expected lists on an empty database', () => {
    const inserted = seedLists(db);
    expect(inserted).toBe(7);

    const rows = db.prepare('SELECT * FROM lists ORDER BY sort_order ASC').all() as List[];
    expect(rows).toHaveLength(7);

    const names = rows.map((r) => r.name);
    expect(names).toEqual([
      'Ideas & Tasks',
      'Quantum',
      'Mental Health',
      'Creative',
      'Business',
      'Home & Family',
      'Finance',
    ]);
  });

  it('is completely idempotent when run twice (or multiple times)', () => {
    seedLists(db);
    const countAfterFirst = (db.prepare('SELECT COUNT(*) as count FROM lists').get() as { count: number }).count;
    expect(countAfterFirst).toBe(7);

    const secondInsertCount = seedLists(db);
    expect(secondInsertCount).toBe(0);

    const countAfterSecond = (db.prepare('SELECT COUNT(*) as count FROM lists').get() as { count: number }).count;
    expect(countAfterSecond).toBe(7);
  });

  it('correctly sets Mental Health to private=1 and sync_excluded=1', () => {
    seedLists(db);

    const mentalHealth = db.prepare('SELECT * FROM lists WHERE name = ?').get('Mental Health') as List;
    expect(mentalHealth).toBeDefined();
    expect(mentalHealth.category).toBe('mental-health');
    expect(mentalHealth.private).toBe(1);
    expect(mentalHealth.sync_excluded).toBe(1);

    // Verify all other seed lists have private=0 and sync_excluded=0
    const otherLists = db
      .prepare('SELECT * FROM lists WHERE name != ?')
      .all('Mental Health') as List[];
    expect(otherLists).toHaveLength(6);
    for (const list of otherLists) {
      expect(list.private).toBe(0);
      expect(list.sync_excluded).toBe(0);
    }
  });

  it('correctly configures Ideas & Tasks as the inbox', () => {
    seedLists(db);

    const inbox = db.prepare('SELECT * FROM lists WHERE name = ?').get('Ideas & Tasks') as List;
    expect(inbox).toBeDefined();
    expect(inbox.category).toBe('inbox');
    expect(inbox.sort_order).toBe(0);
  });

  it('seedIfEmpty only seeds if the table has no lists', () => {
    const seeded = seedIfEmpty(db);
    expect(seeded).toBe(true);

    const seededAgain = seedIfEmpty(db);
    expect(seededAgain).toBe(false);

    const count = (db.prepare('SELECT COUNT(*) as count FROM lists').get() as { count: number }).count;
    expect(count).toBe(7);
  });
});
