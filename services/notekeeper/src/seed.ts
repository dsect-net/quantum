import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface SeedListDefinition {
  name: string;
  category: string;
  sort_order: number;
  private: number;
  sync_excluded: number;
}

export const SEED_LISTS: readonly SeedListDefinition[] = [
  {
    name: 'Ideas & Tasks',
    category: 'inbox',
    sort_order: 0,
    private: 0,
    sync_excluded: 0,
  },
  {
    name: 'Quantum',
    category: 'quantum',
    sort_order: 1,
    private: 0,
    sync_excluded: 0,
  },
  {
    name: 'Mental Health',
    category: 'mental-health',
    sort_order: 2,
    private: 1,
    sync_excluded: 1,
  },
  {
    name: 'Creative',
    category: 'creative',
    sort_order: 3,
    private: 0,
    sync_excluded: 0,
  },
  {
    name: 'Business',
    category: 'business',
    sort_order: 4,
    private: 0,
    sync_excluded: 0,
  },
  {
    name: 'Home & Family',
    category: 'home-family',
    sort_order: 5,
    private: 0,
    sync_excluded: 0,
  },
  {
    name: 'Finance',
    category: 'finance',
    sort_order: 6,
    private: 0,
    sync_excluded: 0,
  },
] as const;

export function seedLists(db: Database.Database): number {
  const now = new Date().toISOString();
  let inserted = 0;

  const insertStmt = db.prepare(`
    INSERT INTO lists (id, name, category, parent_list_id, sort_order, private, sync_excluded, archived_at, created_at, updated_at)
    VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?)
  `);

  const findStmt = db.prepare('SELECT id FROM lists WHERE name = ?');

  const runSeed = db.transaction(() => {
    for (const list of SEED_LISTS) {
      const existing = findStmt.get(list.name);
      if (!existing) {
        insertStmt.run(
          randomUUID(),
          list.name,
          list.category,
          list.sort_order,
          list.private,
          list.sync_excluded,
          now,
          now
        );
        inserted++;
      }
    }
  });

  runSeed();
  return inserted;
}

export function seedIfEmpty(db: Database.Database): boolean {
  const row = db.prepare('SELECT COUNT(*) as count FROM lists').get() as { count: number };
  if (row.count === 0) {
    seedLists(db);
    return true;
  }
  return false;
}
